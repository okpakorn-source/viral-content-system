/**
 * POST /api/auto/detect
 * ─────────────────────────────────────────────────────
 * Universal Input Detector API
 *
 * Body: { input: string, images: string[] }
 * Returns: { success, detection, route, debug }
 *
 * ใช้โดย:
 *  - UniversalInputBox UI (real-time detection)
 *  - /api/auto (pre-processing step)
 *  - Auto Mode pipeline before routing
 */
import { NextResponse } from 'next/server';
import { detectInputType } from '@/lib/input-engine/detector';
import { routePipeline } from '@/lib/input-engine/router';

export async function POST(request) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { input = '', images = [], imageCount } = body;

    // ✅ FIX Bug#3: client sends imageCount (not full base64) for lightweight detect
    // Build a synthetic marker array so detectInputType knows images exist
    const effectiveImages = images.length > 0
      ? images
      : imageCount > 0
        ? Array.from({ length: imageCount }, (_, i) => `__image_placeholder_${i}__`)
        : [];

    // ─── Validate ───────────────────────────────────────────────
    if (!input && effectiveImages.length === 0) {
      return NextResponse.json({
        success:   false,
        error:     'กรุณาส่ง input หรือ images อย่างน้อย 1 อย่าง',
        detection: null,
        route:     null,
      }, { status: 400 });
    }

    // ─── Detect ─────────────────────────────────────────────────
    const detection = detectInputType(input, effectiveImages);

    // ─── Route ──────────────────────────────────────────────────
    const route = routePipeline(detection);

    const elapsed = Date.now() - startTime;

    // ─── Build response ─────────────────────────────────────────
    return NextResponse.json({
      success:   true,
      detection: {
        inputType:       detection.inputType,
        platform:        detection.platform,
        label:           detection.label,
        hasImage:        detection.hasImage,
        hasText:         detection.hasText,
        hasUrls:         detection.hasUrls,
        primaryUrl:      detection.primaryUrl,
        urlCount:        detection.urls.length,
        imageCount:      detection.images?.length || 0,
        textLength:      detection.textContent?.length || 0,
        confidence:      detection.confidence,
        error:           detection.error || null,
      },
      route: {
        pipelineId:   route.pipelineId,
        pipelineLabel:route.pipeline.label,
        pipelineIcon: route.pipeline.icon,
        steps:        route.pipeline.steps,
        primaryProvider: route.providers.primary
          ? { id: route.providers.primary.id, label: route.providers.primary.label }
          : null,
        fallbackCount: route.providers.fallbacks.length,
        canExecute:   route.canExecute,
        warnings:     route.warnings,
        costEstimate: route.costEstimate,
      },
      // ─── Full payload for next step (auto/process) ──────────
      payload: {
        input:   detection.inputType !== 'image_only' ? input : null,
        images:  images.length > 0 ? images.map((_, i) => `[image_${i + 1}]`) : [], // don't echo back full base64
        urls:    detection.urls,
        textContent: detection.textContent || null,
        detectedType: detection.platform,
        pipelineId:   route.pipelineId,
      },
      debug: {
        elapsedMs:     elapsed,
        detectionRaw:  detection,
        routeRaw:      route,
      },
    });

  } catch (err) {
    console.error('[/api/auto/detect] ERROR:', err.message);
    return NextResponse.json({
      success:   false,
      error:     err.message,
      detection: null,
      route:     null,
    }, { status: 500 });
  }
}

// ─── GET: health check ──────────────────────────────────────────────
export async function GET() {
  // Quick env check for all provider keys
  const envCheck = {
    OPENAI_API_KEY:    Boolean(process.env.OPENAI_API_KEY),
    FIRECRAWL_API_KEY: Boolean(process.env.FIRECRAWL_API_KEY),
    APIFY_API_TOKEN:   Boolean(process.env.APIFY_API_TOKEN),
    YOUTUBE_API_KEY:   Boolean(process.env.YOUTUBE_API_KEY),
    JINA_API_KEY:      Boolean(process.env.JINA_API_KEY),
    ASSEMBLYAI_API_KEY:Boolean(process.env.ASSEMBLYAI_API_KEY),
    SERPER_API_KEY:    Boolean(process.env.SERPER_API_KEY),
  };

  const ready = Object.values(envCheck).filter(Boolean).length;
  const total = Object.keys(envCheck).length;

  return NextResponse.json({
    status:   'ready',
    message:  `Unified Auto Input Engine — ${ready}/${total} providers configured`,
    providers: envCheck,
    pipelines: ['article_pipeline', 'tiktok_pipeline', 'youtube_pipeline', 'facebook_pipeline', 'vision_pipeline', 'text_pipeline', 'hybrid_pipeline', 'multi_url_pipeline'],
    version:  '1.0.0',
  });
}
