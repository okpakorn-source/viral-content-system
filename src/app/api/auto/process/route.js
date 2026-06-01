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
export const maxDuration = 300; // Allow 5 minutes for heavy LLM operations
import { NextResponse } from 'next/server';
import { detectInputType } from '@/lib/input-engine/detector';
import { routePipeline }   from '@/lib/input-engine/router';
import { normalizeToSchema } from '@/lib/input-engine/normalizer';
import { scrapeArticle }   from '@/lib/providers/firecrawlProvider';
import { scrapeTikTok, scrapeFacebook } from '@/lib/providers/apifyProvider';
import { getYouTubeData }  from '@/lib/providers/youtubeProvider';
import { logPipeline }     from '@/lib/pipelineLogger';
import { createLogger }    from '@/lib/logger';

// Direct Service Imports
import { processAutoFlow } from '@/lib/services/autoFlowService';
import { processAutoFlowText } from '@/lib/services/autoFlowServiceText';
import { performOcr }      from '@/lib/services/ocrService';
import { performSummarize } from '@/lib/services/summarizeService';
import { createStore }     from '@/lib/persistStore';
import { callAI }          from '@/lib/ai/openai';

const rlog = createLogger('AUTO-PROCESS');

/**
 * Server-side auto-save to news archive.
 * Called after successful processing so Discord/queue content also gets archived.
 * Fire-and-forget — does not block the response.
 */
async function saveToArchiveServerSide({ newsData, breakdownData, sourceType, workflowId, archivedBy }) {
  try {
    if (!newsData?.newsTitle && !newsData?.newsBody) return;
    
    // AI classify category
    let category = 'ทั่วไป';
    let summary = '';
    let tags = [];
    try {
      const aiResult = await callAI({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 400,
        prompt: `วิเคราะห์ข่าวนี้แล้วตอบเป็น JSON\nหัวข้อ: ${newsData.newsTitle || ''}\nเนื้อหา: ${(newsData.newsBody || '').slice(0, 1500)}\nตอบ JSON:\n{\n  "category": "หมวดหมู่ข่าว (เลือก 1: การเมือง|สังคม|อาชญากรรม|อุบัติเหตุ|บันเทิง|กีฬา|เศรษฐกิจ|สุขภาพ|ต่างประเทศ|เทคโนโลยี|สิ่งแวดล้อม|ศาสนา|ทั่วไป)",\n  "summary": "สรุปข่าว 1-2 ประโยค",\n  "tags": ["tag1", "tag2", "tag3"]\n}`,
      });
      if (aiResult?.category) category = aiResult.category;
      if (aiResult?.summary) summary = aiResult.summary;
      if (aiResult?.tags) tags = aiResult.tags;
    } catch (e) {
      console.warn('[Archive-Server] AI classify failed:', e.message);
    }

    const keyPeople = breakdownData?.key_facts?.people || [];
    const keyPlaces = breakdownData?.key_facts?.places || [];
    const viralScore = breakdownData?.possible_angles?.[0]?.facebook_viral_score || null;
    const wordCount = (newsData.newsBody || '').split(/\s+/).filter(Boolean).length;

    const id = `archive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const item = {
      id,
      title: newsData.newsTitle || (newsData.newsBody || '').slice(0, 100) || 'ไม่มีหัวข้อ',
      body: newsData.newsBody || '',
      source_url: '',
      source_type: sourceType || 'discord',
      source_name: archivedBy || 'discord-bot',
      category,
      tags,
      summary,
      key_people: keyPeople,
      key_places: keyPlaces,
      viral_score: viralScore,
      word_count: wordCount,
      used_count: 0,
      last_used_at: null,
      archived_by: archivedBy || 'auto-server',
      archived_at: now,
      workflow_id: workflowId || null,
      createdAt: now,
      updatedAt: now,
    };

    const store = createStore('news-archive');
    await store.add(item);
    console.log(`[Archive-Server] ✅ Saved: "${item.title.slice(0, 50)}" [${category}]`);
  } catch (err) {
    console.warn('[Archive-Server] Save failed (non-critical):', err.message);
  }
}

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
    // ─── API Key Verification (For Discord Bot & External Apps) ───
    const apiKey = request.headers.get('x-api-key');
    if (apiKey) {
      if (!process.env.DISCORD_API_SECRET || apiKey !== process.env.DISCORD_API_SECRET) {
        return NextResponse.json({ success: false, error: 'Unauthorized: Invalid API Key' }, { status: 401 });
      }
    }

    const body = await request.json();
    const {
      input          = '',
      images         = [],
      detection: preDetection = null,
      route:     preRoute     = null,
      contentLength  = 'medium',
      preset         = '',
      workflowId,
      _queueJobId    = null,
    } = body;
    const isFromQueue = !!_queueJobId; // true = Discord/queue, false = web UI

    const _wfId = workflowId || ('unify_' + Date.now());
    const origin  = new URL(request.url).origin;

    await logPipeline({ workflowId: _wfId, step: 'unified-auto', status: 'started', detail: input?.slice(0, 80) }).catch(() => {});

    // ─── STEP 0: Detect ───────────────────────────────────────
    const detection = preDetection || detectInputType(input, images);
    const route     = preRoute     || routePipeline(detection);

    addLog('Detect', `${detection.label} → ${route.pipelineId} (${(detection.confidence * 100).toFixed(0)}% confident)`);

    if (detection.inputType === 'empty') {
      return NextResponse.json({ success: false, error: detection.error || 'ไม่มี input' }, { status: 400 });
    }

    // ─── PHASE 3: Delegate single URL to enhanced /api/auto ───────
    if (route.useEnhancedPipeline && (detection.primaryUrl || detection.hasText)) {
      let delegateRes;
      if (detection.inputType === 'plain_text' || (!detection.primaryUrl && detection.hasText)) {
        addLog('Route', `⚡ Delegating to /api/auto (TEXT pipeline)`);
        delegateRes = await processAutoFlowText({
          url:           null,
          text:          detection.textContent || input,
          sourceType:    'plain_text',
          contentLength,
          preset,
          workflowId:    _wfId,
        });
      } else {
        addLog('Route', `⚡ Delegating to /api/auto (URL pipeline) → ${detection.primaryUrl ? detection.primaryUrl.slice(0, 60) : 'Plain Text'}`);
        delegateRes = await processAutoFlow({
          url:           detection.primaryUrl || null,
          text:          detection.textContent || input,
          contentLength,
          preset,
          workflowId:    _wfId,
        });
      }

      if (delegateRes.success) {
        // Map /api/auto response to /api/auto/process shape
        const legacyData    = delegateRes.data || {};
        const versions      = legacyData.analysisResult?.versions || [];
        const analysisResult = {
          ...(legacyData.analysisResult || {}),
          versions,
          usedPreset:   legacyData.usedPromptInfo || { name: 'Enhanced Auto' },
          totalVersions:versions.length,
          pipeline:     'article_pipeline_enhanced',
        };
        addLog('Route', `✅ Enhanced pipeline: ${versions.length} versions in ${legacyData.totalTimeSeconds}s`);

        // 🗄️ Auto-save to news archive (only for queue/Discord — web UI saves client-side)
        if (isFromQueue) {
          saveToArchiveServerSide({
            newsData: legacyData.newsData,
            breakdownData: legacyData.breakdownData,
            sourceType: detection.inputType,
            workflowId: _wfId,
            archivedBy: 'discord-bot',
          }).catch(() => {});
        }

        return NextResponse.json({
          success:       true,
          data:          { ...legacyData, versions, analysisResult },
          newsData:      legacyData.newsData,
          breakdownData: legacyData.breakdownData,
          analysisResult,
          factPool:      legacyData.factPool || null,
          detection: {
            inputType:    detection.inputType,
            platform:     detection.platform,
            label:        detection.label,
            confidence:   detection.confidence,
            pipelineUsed: 'article_pipeline_enhanced',
            pipelineLabel:'เว็บข่าว / บทความ (Enhanced)',
            pipelineIcon: '⚡',
            provider:     legacyData.providerUsed || 'firecrawl',
            fallbacksUsed:[],
          },
          normalized: {
            title:    legacyData.newsData?.newsTitle || '',
            language: 'th',
            category: legacyData.breakdownData?.category || 'general',
            keywords: [],
            entities: [],
            imageCount: 0,
            confidence: detection.confidence,
          },
          debug: {
            log: [...log, ...(legacyData.log || [])],
            durationSeconds: legacyData.totalTimeSeconds || 0,
            fallbacksUsed:   [],
            pipelineId:      'article_pipeline_enhanced',
            delegatedTo:     '/api/auto',
          },
        });
      }
      addLog('Route', `⚠️ Enhanced pipeline delegation failed — using local pipeline`);
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
        const ocrRes = await performOcr({
          images,
          mode: 'full',
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

        const tasks = [];
        const primaryUrl = detection.primaryUrl;

        if (primaryUrl) {
          tasks.push(scrapeArticle(primaryUrl, { baseUrl: origin }).catch(e => ({ success: false, error: e.message, text: '', title: '' })));
        } else {
          tasks.push(Promise.resolve({ success: true, provider: 'none', text: detection.textContent || '', title: '' }));
        }

        if (images.length > 0) {
          tasks.push(performOcr({ images, mode: 'full' }).catch(e => ({ success: false, text: '' })));
        } else {
          tasks.push(Promise.resolve({ text: '' }));
        }

        const [articleRaw, ocrRes] = await Promise.all(tasks);
        if (articleRaw.fallbackUsed) fallbacksUsed.push(articleRaw.fallbackProvider || 'fallback');

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

    // ─── STEP 2: Extract (via performSummarize) ─────────────────
    addLog('Extract', `📰 AI extracting news from ${normalizedData.rawText.length}ch`);
    const extractRes = await performSummarize({
      text:       normalizedData.rawText,
      sourceType: normalizedData.sourceType,
      mode:       'extract',
      workflowId: _wfId,
      user:       body.user || null,
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
    const breakRes = await performSummarize({
      text:       newsData.newsBody,
      sourceType: normalizedData.sourceType,
      mode:       'breakdown',
      newsTitle:  newsData.newsTitle,
      workflowId: _wfId,
      user:       body.user || null,
    });
    const breakdownData = breakRes.success ? breakRes.data : null;
    if (breakdownData) addLog('Breakdown', `✅ ${breakdownData.possible_angles?.length || 0} angles`);

    // ─── STEP 4: Generate ─────────────────────────────────────
    addLog('Generate', '✍️ Generating viral content...');
    const genRes = await performSummarize({
      text:       newsData.newsBody,
      sourceType: normalizedData.sourceType,
      mode:       'analyze',
      newsTitle:  newsData.newsTitle,
      breakdownData: breakdownData,
      contentLength,
      analysisPresetId: preset,
      workflowId: _wfId,
      user:       body.user || null,
    });

    const genData        = genRes.data || genRes;
    const versions       = genData.versions || [];
    const analysisResult = {
      ...(genData || {}),
      versions,
      usedPreset:   genData.usedPreset || { name: route.pipeline.label },
      totalVersions:versions.length,
      pipeline:     route.pipelineId,
    };

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog('Done', `✅ Total: ${totalTime}s | ${versions.length} versions | pipeline: ${route.pipelineId} | fallbacks: ${fallbacksUsed.join(',') || 'none'}`);

    await logPipeline({ workflowId: _wfId, step: 'unified-auto', status: 'success', duration: Date.now() - startTime, detail: newsData.newsTitle?.slice(0, 60) }).catch(() => {});

    return NextResponse.json({
      success:        true,
      data:           { ...genData, versions, analysisResult },
      newsData,
      breakdownData,
      analysisResult,
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
        entities:    normalizedData.extractedEntities,
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
      failedStep: err.failedStep || 'u_extract',
      log,
      debug: { durationSeconds: parseFloat(totalTime) },
    }, { status: 500 });
  }
}
