/**
 * YouTube Provider
 * ─────────────────────────────────────────────────────
 * Primary:  YouTube Data API v3 (YOUTUBE_API_KEY) + youtube-transcript
 * Fallback: Built-in /api/youtube (always available)
 *
 * getYouTubeData(url) → NormalizedVideoData
 */

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS  = 20000;

// ─── Extract video ID ──────────────────────────────────────────────

function extractVideoId(url) {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── YouTube Data API v3 ───────────────────────────────────────────

async function getYouTubeMetadata(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      part:  'snippet,statistics,contentDetails',
      id:    videoId,
      key:   apiKey,
    });

    const res = await fetch(`${YT_API_BASE}/videos?${params}`, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`YouTube API ${res.status}: ${res.statusText}`);

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) throw new Error('Video not found or private');

    const snippet = item.snippet || {};
    const stats   = item.statistics || {};

    return {
      videoId,
      title:       snippet.title || '',
      description: snippet.description || '',
      channelName: snippet.channelTitle || '',
      publishedAt: snippet.publishedAt || '',
      thumbnail:   snippet.thumbnails?.maxres?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
      tags:        snippet.tags || [],
      views:       parseInt(stats.viewCount || 0),
      likes:       parseInt(stats.likeCount || 0),
      comments:    parseInt(stats.commentCount || 0),
      duration:    item.contentDetails?.duration || '',
      language:    snippet.defaultAudioLanguage || snippet.defaultLanguage || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── YouTube Transcript (via Supadata API) ─────────────────────────
// Supadata: https://supadata.ai — free tier 100 req/day, paid from $9/mo

async function getTranscriptSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error('SUPADATA_API_KEY not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&lang=th`, {
      headers: {
        'x-api-key': apiKey,
        'Accept':    'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`Supadata ${res.status}`);

    const data = await res.json();
    const segments = data.content || [];
    const transcript = segments.map(s => s.text).join(' ').trim();
    return transcript;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Built-in YouTube Fallback ─────────────────────────────────────

async function getYouTubeBuiltin(url, baseUrl = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/api/youtube`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'YouTube builtin failed');

    return {
      provider:    'builtin_youtube',
      videoId:     extractVideoId(url) || '',
      url,
      title:       data.title || '',
      description: data.description || '',
      text:        data.transcript || data.text || '',
      transcript:  data.transcript || '',
      channelName: data.channelName || data.channel || '',
      publishedAt: data.publishedAt || '',
      thumbnail:   data.thumbnail || '',
      tags:        data.tags || [],
      views:       data.views || 0,
      likes:       data.likes || 0,
      duration:    data.duration || '',
      language:    data.language || 'th',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── MAIN EXPORT ───────────────────────────────────────────────────

/**
 * @param {string} url   — YouTube URL
 * @param {object} opts  — { baseUrl }
 * @returns {YouTubeResult}
 */
export async function getYouTubeData(url, opts = {}) {
  const videoId = extractVideoId(url);
  const errors  = [];

  // 1. YouTube Data API + Transcript (if keys available)
  if (process.env.YOUTUBE_API_KEY) {
    try {
      const meta = await getYouTubeMetadata(videoId);
      let transcript = '';

      // Try Supadata for transcript
      if (process.env.SUPADATA_API_KEY) {
        try {
          transcript = await getTranscriptSupadata(videoId);
        } catch (e) {
          console.warn(`[youtubeProvider] Supadata transcript failed: ${e.message}`);
        }
      }

      // Combine text: transcript > description
      const text = transcript || meta.description || '';

      if (text.length > 50 || meta.title) {
        console.log(`[youtubeProvider] ✅ YouTube API OK: "${meta.title?.slice(0,40)}"`);
        return {
          success:      true,
          provider:     'youtube_api',
          fallbackUsed: false,
          videoId,
          url,
          title:        meta.title,
          description:  meta.description,
          text,
          transcript,
          channelName:  meta.channelName,
          publishedAt:  meta.publishedAt,
          thumbnail:    meta.thumbnail,
          tags:         meta.tags,
          views:        meta.views,
          likes:        meta.likes,
          duration:     meta.duration,
          language:     meta.language || 'th',
          errors,
        };
      }
    } catch (e) {
      errors.push({ provider: 'youtube_api', error: e.message });
      console.warn(`[youtubeProvider] YouTube API failed: ${e.message}`);
    }
  }

  // 2. Built-in /api/youtube fallback
  try {
    const result = await getYouTubeBuiltin(url, opts.baseUrl || '');
    console.log(`[youtubeProvider] ✅ Built-in fallback OK: "${result.title?.slice(0,40)}"`);
    return { ...result, success: true, fallbackUsed: true, errors, url };
  } catch (e) {
    errors.push({ provider: 'builtin_youtube', error: e.message });
    console.error(`[youtubeProvider] All providers failed`);
  }

  return {
    success:      false,
    provider:     'none',
    videoId,
    url,
    title:        `YouTube: ${url.slice(0, 50)}`,
    text:         '',
    transcript:   '',
    errors,
    fallbackUsed: true,
    error:        'ไม่สามารถดึง YouTube ได้ — ลองใช้ URL แบบเต็มหรือวาง transcript เอง',
  };
}

export { extractVideoId };
