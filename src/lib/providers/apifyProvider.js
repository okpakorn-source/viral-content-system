/**
 * Apify Provider — TikTok + Facebook (Phase 4 Refactor)
 * ─────────────────────────────────────────────────────
 * Primary:  Apify (APIFY_API_TOKEN)
 * Fallback: Built-in extractors (/api/tiktok, /api/extract, Jina)
 *
 * Uses: baseProvider (retry, timeout, error classification)
 */
import {
  ProviderError, classifyHttpError,
  validateEnv, withTimeout, withRetry,
  runProviderChain,
} from './baseProvider';

const APIFY_BASE    = 'https://api.apify.com/v2';
const JINA_BASE     = 'https://r.jina.ai';
const POLL_INTERVAL = 2000;
const POLL_MAX      = 10;

const CONFIG = {
  apify:   { timeoutMs: 30000, retryLimit: 1, retryDelay: 2000 },
  jina:    { timeoutMs: 12000, retryLimit: 1, retryDelay: 500  },
  builtin: { timeoutMs: 15000, retryLimit: 0, retryDelay: 0    },
};

// Apify Actor IDs
const ACTORS = {
  tiktok:   'clockworks~free-tiktok-scraper',
  facebook: 'apify~facebook-posts-scraper',
};

// ─── Apify Runner (shared) ─────────────────────────────────────────

async function runApifyActor(actorId, input) {
  const env = validateEnv('APIFY_API_TOKEN', 'apify');
  if (!env.available) throw new ProviderError('APIFY_API_TOKEN not set', 'apify', 'auth', 0, false);

  // 1. Start run
  const runRes = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${env.value}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  });

  if (!runRes.ok) throw classifyHttpError(runRes.status, 'apify');

  const runData = await runRes.json();
  const runId   = runData.data?.id;
  if (!runId) throw new ProviderError('Apify run ID not returned', 'apify', 'server', 0, true);

  // 2. Poll for completion
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const statusRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${env.value}`);
    const statusData = await statusRes.json();
    const status = statusData.data?.status;

    if (status === 'SUCCEEDED') {
      const resultsRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${env.value}&clean=true&limit=5`);
      return await resultsRes.json();
    }
    if (status === 'FAILED' || status === 'ABORTED') {
      throw new ProviderError(`Apify run ${status}`, 'apify', 'server', 0, true);
    }
  }

  throw new ProviderError(`Apify timeout after ${POLL_MAX * POLL_INTERVAL / 1000}s`, 'apify', 'timeout', 0, true);
}

// ─── TikTok ────────────────────────────────────────────────────────

async function scrapeTikTokApify(url) {
  return withRetry(
    async () => {
      const items = await runApifyActor(ACTORS.tiktok, {
        postURLs:            [url],
        maxItems:            1,
        shouldDownloadVideos:false,
        shouldDownloadCovers:true,
      });

      if (!items || items.length === 0) throw new ProviderError('Apify TikTok: ไม่มีผลลัพธ์', 'apify_tiktok', 'not_found', 0, false);
      const item = items[0];

      return {
        provider:   'apify_tiktok',
        platform:   'tiktok',
        url,
        title:      item.text || item.desc || '',
        text:       item.text || item.desc || '',
        transcript: '',
        author:     item.authorMeta?.nickname || item.author?.nickname || '',
        likes:      item.diggCount || 0,
        comments:   item.commentCount || 0,
        shares:     item.shareCount || 0,
        views:      item.playCount || 0,
        images:     item.covers ? [item.covers[0]] : [],
        hashtags:   (item.textExtra || []).filter(t => t.hashtagName).map(t => t.hashtagName),
        publishedAt:item.createTime ? new Date(item.createTime * 1000).toISOString() : '',
      };
    },
    CONFIG.apify.retryLimit,
    CONFIG.apify.retryDelay,
    'apify_tiktok',
  );
}

async function scrapeTikTokBuiltin(url, baseUrl = '') {
  return withTimeout(async (signal) => {
    const res = await fetch(`${baseUrl}/api/tiktok`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
      signal,
    });
    const data = await res.json();
    if (!data.success) throw new ProviderError(data.error || 'Built-in TikTok failed', 'builtin_tiktok', 'server', 0, false);

    return {
      provider:   'builtin_tiktok',
      platform:   'tiktok',
      url,
      title:      data.title || '',
      text:       data.transcript || data.text || data.caption || '',
      transcript: data.transcript || '',
      author:     data.author || '',
      likes: 0, comments: 0, shares: 0, views: 0,
      images:     data.thumbnail ? [data.thumbnail] : [],
      hashtags:   [],
      publishedAt:'',
    };
  }, CONFIG.builtin.timeoutMs, 'builtin_tiktok');
}

// ─── Facebook ──────────────────────────────────────────────────────

async function scrapeFacebookApify(url) {
  return withRetry(
    async () => {
      const items = await runApifyActor(ACTORS.facebook, {
        startUrls:   [{ url }],
        maxPosts:    1,
        maxComments: 0,
      });

      if (!items || items.length === 0) throw new ProviderError('Apify Facebook: ไม่มีผลลัพธ์', 'apify_facebook', 'not_found', 0, false);
      const item = items[0];

      return {
        provider:   'apify_facebook',
        platform:   'facebook',
        url,
        title:      item.text?.slice(0, 120) || '',
        text:       item.text || item.postText || '',
        author:     item.ownerName || item.pageName || '',
        likes:      item.likes || 0,
        comments:   item.comments || 0,
        shares:     item.shares || 0,
        images:     item.media?.map(m => m.url).filter(Boolean).slice(0, 3) || [],
        publishedAt:item.time || '',
      };
    },
    CONFIG.apify.retryLimit,
    CONFIG.apify.retryDelay,
    'apify_facebook',
  );
}

async function scrapeFacebookJina(url) {
  return withTimeout(async (signal) => {
    const headers = { 'Accept': 'application/json' };
    const env = validateEnv('JINA_API_KEY', 'jina');
    if (env.available) headers['Authorization'] = `Bearer ${env.value}`;

    const res = await fetch(`${JINA_BASE}/${url}`, { headers, signal });
    if (!res.ok) throw classifyHttpError(res.status, 'jina');

    const data = await res.json();
    const text = data.data?.content || data.data?.text || '';

    if (text.length < 50) throw new ProviderError('Jina: เนื้อหาสั้นเกินไป', 'jina', 'not_found', 0, false);

    return {
      provider:   'jina_facebook',
      platform:   'facebook',
      url,
      title:      data.data?.title || 'Facebook Post',
      text,
      author: '', likes: 0, comments: 0, shares: 0, images: [], publishedAt: '',
    };
  }, CONFIG.jina.timeoutMs, 'jina_facebook');
}

async function scrapeFacebookBuiltin(url, baseUrl = '') {
  return withTimeout(async (signal) => {
    const res = await fetch(`${baseUrl}/api/extract`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
      signal,
    });
    const data = await res.json();
    return {
      provider:   'builtin_facebook',
      platform:   'facebook',
      url,
      title:      data.data?.title || 'Facebook Post',
      text:       data.data?.text || data.text || '',
      author: '', likes: 0, comments: 0, shares: 0, images: [], publishedAt: '',
    };
  }, CONFIG.builtin.timeoutMs, 'builtin_facebook');
}

// ─── MAIN EXPORTS ──────────────────────────────────────────────────

/**
 * @param {string} url
 * @param {object} opts — { baseUrl }
 * @returns {SocialResult}
 */
export async function scrapeTikTok(url, opts = {}) {
  const result = await runProviderChain([
    { name: 'apify_tiktok',  envKey: 'APIFY_API_TOKEN', fn: () => scrapeTikTokApify(url) },
    { name: 'builtin_tiktok', envKey: null,              fn: () => scrapeTikTokBuiltin(url, opts.baseUrl || '') },
  ], `TikTok: ${url.slice(0, 60)}`);

  // If all failed, return meaningful fallback text
  if (!result.success) {
    result.title = `TikTok: ${url.slice(0, 50)}`;
    result.text  = `[TIKTOK_FAILED] ลิงก์: ${url}`;
    result.error = 'ไม่สามารถดึง TikTok ได้ — ลองวางข้อความเนื้อหาเองแทน';
    result.platform = 'tiktok';
  }

  return result;
}

/**
 * @param {string} url
 * @param {object} opts — { baseUrl }
 * @returns {SocialResult}
 */
export async function scrapeFacebook(url, opts = {}) {
  const result = await runProviderChain([
    { name: 'apify_facebook',  envKey: 'APIFY_API_TOKEN', fn: () => scrapeFacebookApify(url) },
    { name: 'jina_facebook',   envKey: null,              fn: () => scrapeFacebookJina(url) },
    { name: 'builtin_facebook', envKey: null,             fn: () => scrapeFacebookBuiltin(url, opts.baseUrl || '') },
  ], `Facebook: ${url.slice(0, 60)}`);

  if (!result.success) {
    result.title = 'Facebook Post';
    result.error = 'Facebook ป้องกัน scraping — กรุณาคัดลอกข้อความมาวางด้วยตนเอง';
    result.platform = 'facebook';
  }

  return result;
}
