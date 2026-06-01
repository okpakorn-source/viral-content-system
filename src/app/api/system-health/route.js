import { NextResponse } from 'next/server';
import { isSupabaseReady } from '@/lib/supabase';
import { createLogger } from '@/lib/logger';

const rlog = createLogger('SYSTEM-HEALTH');

/**
 * GET /api/system-health
 * Quick health check รวม Unified Auto Input Engine providers
 */
export async function GET(request) {
  const startTime = Date.now();
  rlog.start('quick health check');

  const checks = {};
  let overallStatus = 'healthy';

  const maskKey = (key, show = 6) =>
    key ? key.slice(0, show) + '...' + key.slice(-4) : 'missing';

  // ─── AI Models ───────────────────────────────────────────────
  checks.openai = {
    label: 'OpenAI (GPT-4o)',
    configured: Boolean(process.env.OPENAI_API_KEY),
    keyPrefix: maskKey(process.env.OPENAI_API_KEY),
    usedFor: 'Vision OCR + Generate content',
    critical: true,
  };
  if (!checks.openai.configured) overallStatus = 'degraded';

  checks.anthropic = {
    label: 'Anthropic (Claude)',
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    keyPrefix: maskKey(process.env.ANTHROPIC_API_KEY),
    usedFor: 'Thai content writing',
  };

  checks.gemini = {
    label: 'Gemini Flash',
    configured: Boolean(process.env.GEMINI_API_KEY),
    keyPrefix: maskKey(process.env.GEMINI_API_KEY),
    usedFor: 'Fast news extraction',
  };

  // ─── Scrapers / Input Engine ─────────────────────────────────
  checks.firecrawl = {
    label: 'Firecrawl',
    configured: Boolean(process.env.FIRECRAWL_API_KEY),
    keyPrefix: maskKey(process.env.FIRECRAWL_API_KEY),
    usedFor: 'Article scraping (Primary)',
    fallback: 'Jina → Built-in',
  };

  checks.jina = {
    label: 'Jina Reader',
    configured: Boolean(process.env.JINA_API_KEY),
    keyPrefix: maskKey(process.env.JINA_API_KEY),
    usedFor: 'Article fallback + Facebook text',
    fallback: 'Built-in scraper (free)',
  };

  checks.apify = {
    label: 'Apify',
    configured: Boolean(process.env.APIFY_API_KEY),
    keyPrefix: maskKey(process.env.APIFY_API_KEY),
    usedFor: 'TikTok + Facebook scraping',
    fallback: 'Built-in extractors',
  };

  checks.youtube = {
    label: 'YouTube Data API v3',
    configured: Boolean(process.env.YOUTUBE_API_KEY),
    keyPrefix: maskKey(process.env.YOUTUBE_API_KEY),
    usedFor: 'YouTube metadata + transcript',
    fallback: 'Built-in YouTube route',
  };

  // ─── Search ──────────────────────────────────────────────────
  checks.serper = {
    label: 'Serper (Google Search)',
    configured: Boolean(process.env.SERPER_API_KEY),
    keyPrefix: maskKey(process.env.SERPER_API_KEY),
    usedFor: 'Research / fact expansion',
  };

  // ─── Image AI ────────────────────────────────────────────────
  checks.fal = {
    label: 'FAL.ai (Flux)',
    configured: Boolean(process.env.FAL_KEY),
    keyPrefix: maskKey(process.env.FAL_KEY),
    usedFor: 'Image enhancement',
  };

  checks.ideogram = {
    label: 'Ideogram',
    configured: Boolean(process.env.IDEOGRAM_API_KEY),
    keyPrefix: maskKey(process.env.IDEOGRAM_API_KEY),
    usedFor: 'Thai text on image',
  };

  // ─── Database ────────────────────────────────────────────────
  try {
    const { prisma } = await import('@/lib/db');
    const count = await prisma.content.count();
    checks.database = { label: 'SQLite DB', status: 'connected', contentItems: count };
  } catch (e) {
    checks.database = { label: 'SQLite DB', status: 'error', error: e.message.slice(0, 80) };
    overallStatus = 'degraded';
  }

  checks.supabase = {
    label: 'Supabase',
    configured: isSupabaseReady(),
    status: isSupabaseReady() ? 'ready' : 'not configured (fallback)',
    usedFor: 'Template library (optional)',
  };

  checks.environment = {
    nodeVersion: process.version,
    nextEnv: process.env.NODE_ENV || 'development',
  };

  // ─── Provider summary ────────────────────────────────────────
  const providerList = ['openai','anthropic','gemini','firecrawl','jina','apify','youtube','serper','fal','ideogram'];
  const configuredCount = providerList.filter(k => checks[k]?.configured).length;
  const totalProviders  = providerList.length;

  const elapsed = Date.now() - startTime;
  rlog.done(`status: ${overallStatus} | providers: ${configuredCount}/${totalProviders} | ${elapsed}ms`);

  return NextResponse.json({
    success:        true,
    status:         overallStatus,
    timestamp:      new Date().toISOString(),
    responseTimeMs: elapsed,
    checks,
    unifiedInputEngine: {
      ready:              checks.openai.configured,
      providersConfigured:`${configuredCount}/${totalProviders}`,
      pipelines: {
        article:  checks.firecrawl.configured ? '✅ Firecrawl' : checks.jina.configured ? '⚠️ Jina fallback' : '⚠️ Built-in only',
        tiktok:   checks.apify.configured     ? '✅ Apify'     : '⚠️ Built-in fallback',
        facebook: checks.apify.configured     ? '✅ Apify'     : '⚠️ Jina/Built-in fallback',
        youtube:  checks.youtube.configured   ? '✅ YouTube API': '⚠️ Built-in fallback',
        image:    checks.openai.configured    ? '✅ GPT-4o Vision' : '❌ unavailable',
        text:     '✅ always ready',
        hybrid:   '✅ always ready',
      },
    },
    message: overallStatus === 'healthy'
      ? `✅ All systems operational — ${configuredCount}/${totalProviders} providers configured`
      : `⚠️ System degraded — some services unavailable`,
    hint: 'For full test suite, call GET /api/system-test',
  }, { status: 200 });
}
