/**
 * UNIFIED AUTO INPUT ENGINE — Pipeline Router
 * ─────────────────────────────────────────────
 * รับ DetectionResult → เลือก pipeline + providers ที่ถูกต้อง
 * ไม่ execute — แค่ route และ return plan
 *
 * Pipeline Types:
 *  article_pipeline   → Firecrawl / Jina → extract → summarize
 *  tiktok_pipeline    → Apify / /api/tiktok → transcript → extract
 *  youtube_pipeline   → YouTube Data API + transcript → extract
 *  facebook_pipeline  → Apify / Jina → text → extract
 *  social_pipeline    → Jina reader → extract
 *  vision_pipeline    → GPT-4o Vision → OCR + context → extract
 *  text_pipeline      → direct → extract (no scraping needed)
 *  hybrid_pipeline    → parallel: url pipeline + vision pipeline → merge
 *  multi_url_pipeline → sequential/parallel: article_pipeline × N
 */

// ─── Provider Registry ─────────────────────────────────────────────
// ลำดับ: primary ก่อน ถ้า key ไม่มี → ขยับ fallback ถัดไป

const PROVIDERS = {
  article: [
    { id: 'firecrawl',    envKey: 'FIRECRAWL_API_KEY',  label: 'Firecrawl',     apiRoute: '/api/auto/providers/firecrawl' },
    { id: 'jina',         envKey: 'JINA_API_KEY',        label: 'Jina Reader',   apiRoute: '/api/auto/providers/jina' },
    { id: 'extract',      envKey: null,                  label: 'Built-in Scraper', apiRoute: '/api/extract' }, // always available
  ],
  tiktok: [
    { id: 'apify_tiktok', envKey: 'APIFY_API_KEY',    label: 'Apify TikTok',  apiRoute: '/api/auto/providers/apify-tiktok' },
    { id: 'tiktok_native',envKey: null,                  label: 'Built-in TikTok', apiRoute: '/api/tiktok' }, // always available
  ],
  youtube: [
    { id: 'youtube_api',  envKey: 'YOUTUBE_API_KEY',    label: 'YouTube Data API', apiRoute: '/api/auto/providers/youtube' },
    { id: 'youtube_native',envKey: null,                 label: 'Built-in YouTube', apiRoute: '/api/youtube' }, // always available
  ],
  facebook: [
    { id: 'apify_fb',     envKey: 'APIFY_API_KEY',    label: 'Apify Facebook', apiRoute: '/api/auto/providers/apify-facebook' },
    { id: 'jina',         envKey: 'JINA_API_KEY',        label: 'Jina Reader',   apiRoute: '/api/auto/providers/jina' },
    { id: 'extract',      envKey: null,                  label: 'Built-in Scraper', apiRoute: '/api/extract' },
  ],
  social: [
    { id: 'jina',         envKey: 'JINA_API_KEY',        label: 'Jina Reader',   apiRoute: '/api/auto/providers/jina' },
    { id: 'extract',      envKey: null,                  label: 'Built-in Scraper', apiRoute: '/api/extract' },
  ],
  vision: [
    { id: 'gpt4o_vision', envKey: 'OPENAI_API_KEY',     label: 'GPT-4o Vision', apiRoute: '/api/ocr' }, // uses existing OCR route
    { id: 'gemini_vision',envKey: 'GEMINI_API_KEY',     label: 'Gemini Vision', apiRoute: '/api/auto/providers/gemini-vision' },
  ],
};

// ─── Pipeline Definitions ──────────────────────────────────────────

const PIPELINES = {
  article_pipeline: {
    label:       'เว็บข่าว / บทความ',
    icon:        '🌐',
    steps:       ['scrape', 'extract', 'breakdown', 'generate'],
    providerKey: 'article',
    timeout:     30000,
    retryLimit:  2,
    parallel:    false,
  },
  tiktok_pipeline: {
    label:       'TikTok Video',
    icon:        '🎵',
    steps:       ['transcript', 'extract', 'breakdown', 'generate'],
    providerKey: 'tiktok',
    timeout:     45000,
    retryLimit:  1,
    parallel:    false,
  },
  youtube_pipeline: {
    label:       'YouTube Video',
    icon:        '📺',
    steps:       ['transcript', 'extract', 'breakdown', 'generate'],
    providerKey: 'youtube',
    timeout:     30000,
    retryLimit:  2,
    parallel:    false,
  },
  facebook_pipeline: {
    label:       'Facebook Post',
    icon:        '📘',
    steps:       ['scrape', 'extract', 'breakdown', 'generate'],
    providerKey: 'facebook',
    timeout:     25000,
    retryLimit:  1,
    parallel:    false,
  },
  social_pipeline: {
    label:       'Social Media',
    icon:        '📱',
    steps:       ['scrape', 'extract', 'breakdown', 'generate'],
    providerKey: 'social',
    timeout:     25000,
    retryLimit:  1,
    parallel:    false,
  },
  vision_pipeline: {
    label:       'วิเคราะห์รูปภาพ',
    icon:        '🔍',
    steps:       ['ocr', 'extract', 'breakdown', 'generate'],
    providerKey: 'vision',
    timeout:     20000,
    retryLimit:  1,
    parallel:    false,
  },
  text_pipeline: {
    label:       'ข้อความ / บทความ',
    icon:        '📝',
    steps:       ['extract', 'breakdown', 'generate'], // ไม่มี scrape
    providerKey: null, // ไม่ต้องการ provider
    timeout:     20000,
    retryLimit:  2,
    parallel:    false,
  },
  hybrid_pipeline: {
    label:       'หลาย Source รวมกัน',
    icon:        '🔀',
    steps:       ['parallel_extract', 'merge', 'breakdown', 'generate'],
    providerKey: 'article', // ใช้สำหรับ URL part
    timeout:     45000,
    retryLimit:  1,
    parallel:    true,
  },
  multi_url_pipeline: {
    label:       'หลาย URL',
    icon:        '🔗',
    steps:       ['parallel_scrape', 'merge', 'extract', 'breakdown', 'generate'],
    providerKey: 'article',
    timeout:     60000,
    retryLimit:  1,
    parallel:    true,
  },
  none: {
    label:       'ไม่มี input',
    icon:        '❌',
    steps:       [],
    providerKey: null,
    timeout:     0,
    retryLimit:  0,
    parallel:    false,
  },
};

// ─── ENV Checker ───────────────────────────────────────────────────

/**
 * ตรวจว่า provider key มีอยู่จริงหรือไม่ (server-side only)
 * ถ้า key === null → always available
 */
function isProviderAvailable(provider) {
  if (provider.envKey === null) return true;
  // เช็ค process.env (server-side)
  try {
    return Boolean(process.env[provider.envKey]);
  } catch {
    return false;
  }
}

/**
 * คืน providers ที่ available สำหรับ pipeline นั้น
 * primary = ตัวแรกที่มี key, fallbacks = ที่เหลือ
 */
function resolveProviders(providerKey) {
  if (!providerKey) return { primary: null, fallbacks: [], availableCount: 0 };
  const list = PROVIDERS[providerKey] || [];
  const available = list.filter(isProviderAvailable);
  const unavailable = list.filter(p => !isProviderAvailable(p));
  return {
    primary:        available[0]  || null,
    fallbacks:      available.slice(1),
    unavailable,
    availableCount: available.length,
    missingKeys:    unavailable.filter(p => p.envKey).map(p => p.envKey),
  };
}

// ─── MAIN ROUTER ───────────────────────────────────────────────────

/**
 * @param {DetectionResult} detection — from detector.detectInputType()
 * @returns {RoutePlan}
 */
export function routePipeline(detection) {
  const pipelineId = detection.priorityPipeline || 'article_pipeline';
  const pipeline   = PIPELINES[pipelineId] || PIPELINES.article_pipeline;
  const providers  = resolveProviders(pipeline.providerKey);

  // Cost estimate (rough, per run)
  const costEstimate = estimateCost(pipelineId, providers.primary?.id);

  const warnings = [];
  if (providers.availableCount === 0 && pipeline.providerKey) {
    warnings.push(`⚠️ ไม่มี provider พร้อมใช้งานสำหรับ ${pipeline.label}`);
  }
  if (providers.missingKeys?.length > 0) {
    warnings.push(`🔑 Missing API keys: ${providers.missingKeys.join(', ')} — ใช้ fallback แทน`);
  }

  // ─── useEnhancedPipeline: single clean URL, no images OR plain text ───────────
  // Signals to process/route.js to delegate to /api/auto (full Blueprint+Research pipeline)
  const useEnhancedPipeline = (
    (pipelineId === 'article_pipeline' && !detection.hasImage && detection.urls.length === 1 && detection.textContent?.length < 50) ||
    (pipelineId === 'text_pipeline' && detection.hasText && !detection.hasImage && detection.urls.length === 0)
  );

  // ─── broken URL warning ──────────────────────────────────────────
  if (detection.primaryUrl) {
    try { new URL(detection.primaryUrl); }
    catch { warnings.push('⚠️ URL ไม่ถูกต้อง — อาจดึงข้อมูลไม่ได้'); }
  }

  // ─── route quality score (0-100) ────────────────────────────────
  let routeQuality = 50;
  if (providers.availableCount > 0) routeQuality += 30;
  if (providers.availableCount > 1) routeQuality += 10; // has fallback
  if (detection.confidence > 0.8)   routeQuality += 10;
  if (useEnhancedPipeline)          routeQuality = Math.min(100, routeQuality + 10);
  routeQuality = Math.min(100, routeQuality);

  return {
    pipelineId,
    pipeline: {
      label:    pipeline.label,
      icon:     pipeline.icon,
      steps:    pipeline.steps,
      timeout:  pipeline.timeout,
      parallel: pipeline.parallel,
    },
    providers: {
      primary:        providers.primary,
      fallbacks:      providers.fallbacks,
      availableCount: providers.availableCount,
    },
    input: {
      type:       detection.inputType,
      platform:   detection.platform,
      primaryUrl: detection.primaryUrl,
      urls:       detection.urls,
      hasImage:   detection.hasImage,
      hasText:    detection.hasText,
      imageCount: detection.images?.length || 0,
    },
    costEstimate,
    warnings,
    canExecute:          providers.availableCount > 0 || pipeline.providerKey === null,
    useEnhancedPipeline, // ✅ Phase 3: delegate to /api/auto for full pipeline
    routeQuality,        // ✅ Phase 3: 0-100 confidence in this route
    routedAt:   new Date().toISOString(),
  };
}

// ─── Cost Estimator ────────────────────────────────────────────────

function estimateCost(pipelineId, primaryProviderId) {
  const costs = {
    firecrawl:    { usd: 0.006, label: '~$0.006/page (Firecrawl)' },
    apify_tiktok: { usd: 0.010, label: '~$0.01/run (Apify)' },
    apify_fb:     { usd: 0.010, label: '~$0.01/run (Apify)' },
    youtube_api:  { usd: 0.000, label: 'ฟรี (YouTube Data API)' },
    gpt4o_vision: { usd: 0.003, label: '~$0.003/image (GPT-4o)' },
    jina:         { usd: 0.001, label: '~$0.001/page (Jina)' },
    extract:      { usd: 0.000, label: 'ฟรี (Built-in)' },
    tiktok_native:{ usd: 0.000, label: 'ฟรี (Built-in)' },
    youtube_native:{ usd: 0.000, label: 'ฟรี (Built-in)' },
  };

  // AI summarize cost (always applied)
  const aiCost = 0.005; // ~$0.005 per GPT-4o mini call

  const providerCost = costs[primaryProviderId]?.usd || 0;
  const total = providerCost + aiCost;

  return {
    estimatedUSD: Math.round(total * 1000) / 1000,
    breakdown:    costs[primaryProviderId]?.label || 'ฟรี',
    aiCost:       `~$${aiCost} (AI summarize)`,
  };
}

// ─── Export helpers ────────────────────────────────────────────────

export { PIPELINES, PROVIDERS, resolveProviders };
