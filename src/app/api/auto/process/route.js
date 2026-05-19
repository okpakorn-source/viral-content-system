/**
 * POST /api/auto/process
 * ─────────────────────────────────────────────────────
 * Universal Auto Processor — รัน pipeline จาก detection result
 *
 * Body: {
 *   input: string,         — raw input (URL / text)
 *   images: string[],      — base64 images
 *   detection: object,     — from /api/auto/detect (optional, skip detect if present)
 *   route: object,         — route plan (optional)
 *   contentLength: string, — 'short'|'medium'|'long'
 *   preset: string,        — style preset
 * }
 *
 * Returns: same as /api/auto (backward compatible)
 */
import { NextResponse } from 'next/server';
import { detectInputType } from '@/lib/input-engine/detector';
import { routePipeline }   from '@/lib/input-engine/router';
import { normalizeToSchema } from '@/lib/input-engine/normalizer';
import { scrapeArticle }   from '@/lib/providers/firecrawlProvider';
import { scrapeTikTok, scrapeFacebook } from '@/lib/providers/apifyProvider';
import { getYouTubeData }  from '@/lib/providers/youtubeProvider';
import { logPipeline }     from '@/lib/pipelineLogger';
import { createLogger }    from '@/lib/logger';

const rlog = createLogger('AUTO-PROCESS');

export async function POST(request) {
  const startTime = Date.now();
  const log       = [];

  const addLog = (step, msg) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const entry   = `[${elapsed}s] ${step}: ${msg}`;
    log.push(entry);
    rlog.step(step, msg);
  };

  try {
    const body = await request.json();
    const {
      input          = '',
      images         = [],
      detection: preDetection = null,
      route:     preRoute     = null,
      contentLength  = 'medium',
      preset         = '',
      workflowId,
    } = body;

    const _wfId = workflowId || ('unify_' + Date.now());
    const origin  = new URL(request.url).origin;

    // Helper to call internal APIs
    const callInternal = async (path, bodyData) => {
      const res = await fetch(`${origin}${path}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(bodyData),
      });
      return res.json();
    };

    await logPipeline({ workflowId: _wfId, step: 'unified-auto', status: 'started', detail: input?.slice(0, 80) }).catch(() => {});

    // ─── STEP 0: Detect ───────────────────────────────────────
    const detection = preDetection || detectInputType(input, images);
    const route     = preRoute     || routePipeline(detection);

    addLog('Detect', `${detection.label} → ${route.pipelineId} (${(detection.confidence * 100).toFixed(0)}% confident)`);

    if (detection.inputType === 'empty') {
      return NextResponse.json({ success: false, error: detection.error || 'ไม่มี input' }, { status: 400 });
    }

    const fallbacksUsed = [];
    let   normalizedData = null;

    // ─── STEP 1: Extract by pipeline type ─────────────────────
    addLog('Route', `🔀 Pipeline: ${route.pipeline.icon} ${route.pipeline.label}`);

    switch (route.pipelineId) {

      // ── Article / Website ───────────────────────────────────
      case 'article_pipeline':
      case 'social_pipeline': {
        const url = detection.primaryUrl || input;
        addLog('Scrape', `🌐 Scraping: ${url.slice(0, 60)}`);
        const raw = await scrapeArticle(url, { baseUrl: origin });
        if (raw.fallbackUsed) fallbacksUsed.push(raw.fallbackProvider || 'jina');
        normalizedData = normalizeToSchema(raw, 'article', { originalUrl: url, inputImages: images });
        addLog('Scrape', `${raw.success ? '✅' : '⚠️'} ${raw.provider}: ${normalizedData.rawText.length}ch`);
        break;
      }

      // ── TikTok ──────────────────────────────────────────────
      case 'tiktok_pipeline': {
        const url = detection.primaryUrl || input;
        addLog('TikTok', `🎵 Extracting TikTok: ${url.slice(0, 60)}`);
        const raw = await scrapeTikTok(url, { baseUrl: origin });
        if (raw.fallbackUsed) fallbacksUsed.push(raw.fallbackProvider || 'builtin_tiktok');
        normalizedData = normalizeToSchema(raw, 'tiktok', { originalUrl: url, inputImages: images });
        addLog('TikTok', `${raw.success ? '✅' : '⚠️'} ${raw.provider}: ${normalizedData.rawText.length}ch`);
        break;
      }

      // ── YouTube ─────────────────────────────────────────────
      case 'youtube_pipeline': {
        const url = detection.primaryUrl || input;
        addLog('YouTube', `📺 Extracting YouTube: ${url.slice(0, 60)}`);
        const raw = await getYouTubeData(url, { baseUrl: origin });
        if (raw.fallbackUsed) fallbacksUsed.push(raw.fallbackProvider || 'builtin_youtube');
        normalizedData = normalizeToSchema(raw, 'youtube', { originalUrl: url, inputImages: images });
        addLog('YouTube', `${raw.success ? '✅' : '⚠️'} ${raw.provider}: ${normalizedData.rawText.length}ch`);
        break;
      }

      // ── Facebook ────────────────────────────────────────────
      case 'facebook_pipeline': {
        const url = detection.primaryUrl || input;
        addLog('Facebook', `📘 Extracting Facebook: ${url.slice(0, 60)}`);
        const raw = await scrapeFacebook(url, { baseUrl: origin });
        if (raw.fallbackUsed) fallbacksUsed.push(raw.fallbackProvider || 'jina');
        normalizedData = normalizeToSchema(raw, 'facebook', { originalUrl: url, inputImages: images });
        addLog('Facebook', `${raw.success ? '✅' : '⚠️'} ${raw.provider}: ${normalizedData.rawText.length}ch`);
        break;
      }

      // ── Image Only ──────────────────────────────────────────
      case 'vision_pipeline': {
        addLog('Vision', `🔍 Analyzing ${images.length} image(s) with GPT-4o Vision`);
        const ocrRes = await callInternal('/api/ocr', {
          images,
          mode: 'full', // OCR + context + entities
        });
        const ocrText = ocrRes.text || ocrRes.result || ocrRes.content || '';
        normalizedData = normalizeToSchema({
          provider:   'gpt4o_vision',
          platform:   'image',
          success:    ocrRes.success !== false,
          title:      ocrRes.title || 'ภาพที่วิเคราะห์',
          text:       ocrText,
          images:     images.slice(0, 3),
        }, 'image', { inputImages: images });
        addLog('Vision', `✅ OCR: ${ocrText.length}ch`);
        break;
      }

      // ── Plain Text ──────────────────────────────────────────
      case 'text_pipeline': {
        const text = detection.textContent || input;
        addLog('Text', `📝 Processing plain text: ${text.length}ch`);
        normalizedData = normalizeToSchema({
          provider: 'direct_text',
          platform: 'text',
          success:  true,
          title:    text.slice(0, 80),
          text,
        }, 'text', { inputImages: images });
        break;
      }

      // ── Hybrid ──────────────────────────────────────────────
      case 'hybrid_pipeline':
      case 'hybrid_text_image':
      case 'url_with_context': {
        addLog('Hybrid', `🔀 Hybrid pipeline: URL + ${images.length} image(s) + text`);

        // Parallel: scrape URL + OCR images
        const tasks = [];
        const primaryUrl = detection.primaryUrl;

        if (primaryUrl) {
          tasks.push(scrapeArticle(primaryUrl, { baseUrl: origin }).catch(e => ({ success: false, error: e.message, text: '', title: '' })));
        } else {
          tasks.push(Promise.resolve({ success: true, provider: 'none', text: detection.textContent || '', title: '' }));
        }

        if (images.length > 0) {
          tasks.push(callInternal('/api/ocr', { images, mode: 'full' }).catch(e => ({ success: false, text: '' })));
        } else {
          tasks.push(Promise.resolve({ text: '' }));
        }

        const [articleRaw, ocrRes] = await Promise.all(tasks);
        if (articleRaw.fallbackUsed) fallbacksUsed.push(articleRaw.fallbackProvider || 'fallback');

        // Merge contexts
        const mergedText = [
          articleRaw.text || '',
          ocrRes.text  || ocrRes.result || '',
          detection.textContent || '',
        ].filter(t => t.length > 0).join('\n\n---\n\n');

        normalizedData = normalizeToSchema({
          provider:   'hybrid',
          platform:   'hybrid',
          success:    true,
          title:      articleRaw.title || detection.label,
          text:       mergedText,
          images:     [...(articleRaw.images || []), ...images.slice(0, 2)],
          description:articleRaw.description || '',
        }, 'hybrid', { originalUrl: primaryUrl, inputImages: images });
        addLog('Hybrid', `✅ Merged: ${mergedText.length}ch (url:${articleRaw.text?.length || 0} + ocr:${ocrRes.text?.length || 0})`);
        break;
      }

      // ── Multi URL ────────────────────────────────────────────
      case 'multi_url_pipeline': {
        addLog('MultiURL', `🔗 Processing ${detection.urls.length} URLs`);
        const urlTasks = detection.urls.slice(0, 3).map(url =>
          scrapeArticle(url, { baseUrl: origin }).catch(e => ({ success: false, text: '', title: '', url, error: e.message }))
        );
        const results = await Promise.all(urlTasks);
        const mergedText = results.map((r, i) =>
          `[ข้อมูลจาก URL ${i + 1}: ${detection.urls[i]?.slice(0, 50)}]\n${r.text || ''}`
        ).join('\n\n---\n\n');

        normalizedData = normalizeToSchema({
          provider: 'multi_url',
          platform: 'multi',
          success:  true,
          title:    results.find(r => r.title)?.title || 'หลาย URL',
          text:     mergedText,
          images:   results.flatMap(r => r.images || []).slice(0, 3),
        }, 'article', { inputImages: images });
        addLog('MultiURL', `✅ Merged ${results.length} URLs: ${mergedText.length}ch`);
        break;
      }

      default:
        addLog('Route', `⚠️ Unknown pipeline: ${route.pipelineId} — falling back to article`);
        const url = detection.primaryUrl || input;
        const raw = await scrapeArticle(url, { baseUrl: origin });
        normalizedData = normalizeToSchema(raw, 'article', { originalUrl: url });
    }

    // ─── Check viability ──────────────────────────────────────
    if (!normalizedData?.summary?.isViable) {
      return NextResponse.json({
        success:   false,
        error:     'ไม่สามารถดึงเนื้อหาได้เพียงพอ — ลองวางข้อความเพิ่มเติม',
        detection: { label: detection.label, pipelineId: route.pipelineId },
        normalized: normalizedData,
        log,
      }, { status: 422 });
    }

    // ─── STEP 2: Extract (via /api/summarize) ─────────────────
    addLog('Extract', `📰 AI extracting news from ${normalizedData.rawText.length}ch`);
    const extractRes = await callInternal('/api/summarize', {
      text:       normalizedData.rawText,
      sourceType: normalizedData.sourceType,
      mode:       'extract',
    });
    if (!extractRes.success || !extractRes.data?.newsBody) {
      return NextResponse.json({
        success:    false,
        error:      `Extract failed: ${extractRes.error || 'no content'}`,
        normalized: normalizedData,
        log,
      }, { status: 422 });
    }
    const newsData = extractRes.data;
    addLog('Extract', `✅ "${newsData.newsTitle?.slice(0, 40)}" (${newsData.newsBody?.length}ch)`);

    // ─── STEP 3: Breakdown ────────────────────────────────────
    addLog('Breakdown', '🔍 AI analyzing angles...');
    const breakRes = await callInternal('/api/summarize', {
      text:       newsData.newsBody,
      sourceType: normalizedData.sourceType,
      mode:       'breakdown',
      newsTitle:  newsData.newsTitle,
    });
    const breakdownData = breakRes.success ? breakRes.data : null;
    if (breakdownData) addLog('Breakdown', `✅ ${breakdownData.angles?.length || 0} angles`);

    // ─── STEP 4: Generate ─────────────────────────────────────
    addLog('Generate', '✍️ Generating viral content...');
    const genRes = await callInternal('/api/summarize', {
      text:       newsData.newsBody,
      sourceType: normalizedData.sourceType,
      mode:       'generate',
      newsTitle:  newsData.newsTitle,
      breakdown:  breakdownData,
      contentLength,
      preset,
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog('Done', `✅ Total: ${totalTime}s | pipeline: ${route.pipelineId} | fallbacks: ${fallbacksUsed.join(',') || 'none'}`);

    await logPipeline({ workflowId: _wfId, step: 'unified-auto', status: 'success', duration: Date.now() - startTime, detail: newsData.newsTitle?.slice(0, 60) }).catch(() => {});

    return NextResponse.json({
      success:        true,
      data:           genRes.data || genRes,
      newsData,
      breakdownData,
      // ── Universal metadata ───────────────────────────────
      detection: {
        inputType:    detection.inputType,
        platform:     detection.platform,
        label:        detection.label,
        confidence:   detection.confidence,
        pipelineUsed: route.pipelineId,
        pipelineLabel:route.pipeline.label,
        pipelineIcon: route.pipeline.icon,
        provider:     normalizedData.metadata?.provider,
        fallbacksUsed,
      },
      normalized: {
        title:       normalizedData.title,
        language:    normalizedData.language,
        category:    normalizedData.contentCategory,
        keywords:    normalizedData.keywords,
        imageCount:  normalizedData.images.length,
        confidence:  normalizedData.confidence,
      },
      debug: {
        log,
        durationSeconds: parseFloat(totalTime),
        fallbacksUsed,
        pipelineId:  route.pipelineId,
        provider:    normalizedData.metadata?.provider,
        textLength:  normalizedData.rawText.length,
      },
    });

  } catch (err) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    rlog.error('Universal process error: ' + err.message);
    return NextResponse.json({
      success: false,
      error:   err.message,
      log,
      debug: { durationSeconds: parseFloat(totalTime) },
    }, { status: 500 });
  }
}
