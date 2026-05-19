/**
 * Apify Provider — TikTok + Facebook scraping
 * ─────────────────────────────────────────────────────
 * Primary: Apify (APIFY_API_TOKEN)
 * Fallback: Built-in extractors (/api/tiktok, /api/extract)
 *
 * scrapeTikTok(url) → NormalizedSocialPost
 * scrapeFacebook(url) → NormalizedSocialPost
 */

const APIFY_BASE    = 'https://api.apify.com/v2';
const TIMEOUT_MS    = 25000;
const POLL_INTERVAL = 2000;
const POLL_MAX      = 10; // max 10 polls = 20s

// Apify Actor IDs (ดีที่สุดที่ผ่านการทดสอบ)
const ACTORS = {
  tiktok:   'clockworks~free-tiktok-scraper',  // free TikTok scraper
  facebook: 'apify~facebook-posts-scraper',    // Facebook posts
};

// ─── Apify Runner ──────────────────────────────────────────────────

async function runApifyActor(actorId, input) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN not set');

  // 1. Start run
  const runRes = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${token}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  });

  if (!runRes.ok) {
    const err = await runRes.text().catch(() => runRes.statusText);
    throw new Error(`Apify start failed (${runRes.status}): ${err.slice(0, 100)}`);
  }

  const runData = await runRes.json();
  const runId   = runData.data?.id;
  if (!runId) throw new Error('Apify run ID not returned');

  // 2. Poll for completion
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const statusRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`);
    const statusData = await statusRes.json();
    const status = statusData.data?.status;

    if (status === 'SUCCEEDED') {
      // 3. Get results
      const resultsRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${token}&clean=true&limit=5`);
      const results = await resultsRes.json();
      return results;
    }
    if (status === 'FAILED' || status === 'ABORTED') {
      throw new Error(`Apify run ${status}`);
    }
    // RUNNING or READY — continue polling
  }

  throw new Error(`Apify timeout after ${POLL_MAX * POLL_INTERVAL / 1000}s`);
}

// ─── TikTok ────────────────────────────────────────────────────────

async function scrapeTikTokApify(url) {
  const items = await runApifyActor(ACTORS.tiktok, {
    postURLs:         [url],
    maxItems:         1,
    shouldDownloadVideos: false,
    shouldDownloadCovers: true,
  });

  if (!items || items.length === 0) throw new Error('Apify TikTok: ไม่มีผลลัพธ์');
  const item = items[0];

  return {
    provider:   'apify_tiktok',
    platform:   'tiktok',
    url,
    title:      item.text || item.desc || '',
    text:       item.text || item.desc || '',
    transcript: '', // TikTok ไม่มี official transcript
    author:     item.authorMeta?.nickname || item.author?.nickname || '',
    likes:      item.diggCount || 0,
    comments:   item.commentCount || 0,
    shares:     item.shareCount || 0,
    views:      item.playCount || 0,
    images:     item.covers ? [item.covers[0]] : [],
    hashtags:   (item.textExtra || []).filter(t => t.hashtagName).map(t => t.hashtagName),
    publishedAt:item.createTime ? new Date(item.createTime * 1000).toISOString() : '',
  };
}

async function scrapeTikTokBuiltin(url, baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/tiktok`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Built-in TikTok failed');

  return {
    provider:   'builtin_tiktok',
    platform:   'tiktok',
    url,
    title:      data.title || '',
    text:       data.transcript || data.text || data.caption || '',
    transcript: data.transcript || '',
    author:     data.author || '',
    likes:      0,
    comments:   0,
    shares:     0,
    views:      0,
    images:     data.thumbnail ? [data.thumbnail] : [],
    hashtags:   [],
    publishedAt:'',
  };
}

// ─── Facebook ──────────────────────────────────────────────────────

async function scrapeFacebookApify(url) {
  const items = await runApifyActor(ACTORS.facebook, {
    startUrls:  [{ url }],
    maxPosts:   1,
    maxComments:0,
  });

  if (!items || items.length === 0) throw new Error('Apify Facebook: ไม่มีผลลัพธ์');
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
}

async function scrapeFacebookBuiltin(url, baseUrl = '') {
  // Facebook ไม่มี official API — ใช้ Jina หรือ extract
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const headers = { 'Accept': 'application/json' };
    const apiKey = process.env.JINA_API_KEY;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(jinaUrl, { headers });
    const data = await res.json();
    const text = data.data?.content || data.data?.text || '';

    if (text.length > 50) {
      return {
        provider:   'jina_facebook',
        platform:   'facebook',
        url,
        title:      data.data?.title || 'Facebook Post',
        text,
        author:     '',
        likes:      0,
        comments:   0,
        shares:     0,
        images:     [],
        publishedAt:'',
      };
    }
  } catch {}

  // Last resort: plain extract
  const res = await fetch(`${baseUrl}/api/extract`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url }),
  });
  const data = await res.json();
  return {
    provider:   'builtin_facebook',
    platform:   'facebook',
    url,
    title:      data.data?.title || 'Facebook Post',
    text:       data.data?.text || data.text || '',
    author:     '',
    likes:      0, comments:   0, shares:     0, images:     [], publishedAt:'',
  };
}

// ─── MAIN EXPORTS ──────────────────────────────────────────────────

/**
 * @param {string} url
 * @param {object} opts — { baseUrl }
 * @returns {SocialResult}
 */
export async function scrapeTikTok(url, opts = {}) {
  const errors = [];

  if (process.env.APIFY_API_TOKEN) {
    try {
      const result = await scrapeTikTokApify(url);
      if (result.text?.length > 10) {
        return { ...result, success: true, fallbackUsed: false };
      }
    } catch (e) {
      errors.push({ provider: 'apify_tiktok', error: e.message });
      console.warn(`[apifyProvider] Apify TikTok failed: ${e.message}`);
    }
  }

  try {
    const result = await scrapeTikTokBuiltin(url, opts.baseUrl || '');
    return { ...result, success: true, fallbackUsed: true, fallbackProvider: 'builtin_tiktok', errors };
  } catch (e) {
    errors.push({ provider: 'builtin_tiktok', error: e.message });
  }

  return {
    success:      false,
    provider:     'none',
    platform:     'tiktok',
    url,
    title:        `TikTok: ${url.slice(0, 50)}`,
    text:         `[TIKTOK_FAILED] ลิงก์: ${url}`,
    errors,
    fallbackUsed: true,
    error:        'ไม่สามารถดึง TikTok ได้ — ลองวางข้อความเนื้อหาเองแทน',
  };
}

/**
 * @param {string} url
 * @param {object} opts — { baseUrl }
 * @returns {SocialResult}
 */
export async function scrapeFacebook(url, opts = {}) {
  const errors = [];

  if (process.env.APIFY_API_TOKEN) {
    try {
      const result = await scrapeFacebookApify(url);
      if (result.text?.length > 20) {
        return { ...result, success: true, fallbackUsed: false };
      }
    } catch (e) {
      errors.push({ provider: 'apify_facebook', error: e.message });
      console.warn(`[apifyProvider] Apify Facebook failed: ${e.message}`);
    }
  }

  try {
    const result = await scrapeFacebookBuiltin(url, opts.baseUrl || '');
    return { ...result, success: true, fallbackUsed: true, fallbackProvider: 'jina/builtin', errors };
  } catch (e) {
    errors.push({ provider: 'builtin_facebook', error: e.message });
  }

  return {
    success:      false,
    provider:     'none',
    platform:     'facebook',
    url,
    title:        'Facebook Post',
    text:         '',
    errors,
    fallbackUsed: true,
    error:        'Facebook ป้องกัน scraping — กรุณาคัดลอกข้อความมาวางด้วยตนเอง',
  };
}
