/**
 * YouTube Provider (Phase 7 Refactor)
 * ─────────────────────────────────────────────────────
 * Primary:  YouTube Data API v3 (YOUTUBE_API_KEY) + Supadata transcript
 * Fallback: Built-in /api/youtube (always available)
 *
 * Uses: baseProvider (retry, timeout, error classification)
 *
 * Error Types:
 *  YOUTUBE_API_KEY_MISSING       — YOUTUBE_API_KEY not set
 *  YOUTUBE_METADATA_FAILED       — YouTube Data API call failed
 *  YOUTUBE_TRANSCRIPT_FAILED     — Supadata / transcript extraction failed
 *  YOUTUBE_PROVIDER_TIMEOUT      — provider timed out
 *  YOUTUBE_PROVIDER_FALLBACK_USED — primary failed, using built-in
 */
import {
  ProviderError, classifyHttpError,
  validateEnv, withTimeout, withRetry,
  runProviderChain,
} from './baseProvider';

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

const CONFIG = {
  metadata:   { timeoutMs: 15000, retryLimit: 2, retryDelay: 1000 },
  transcript: { timeoutMs: 12000, retryLimit: 1, retryDelay: 500  },
  builtin:    { timeoutMs: 20000, retryLimit: 0, retryDelay: 0    },
};

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
  const env = validateEnv('YOUTUBE_API_KEY', 'youtube_api');
  if (!env.available) {
    throw new ProviderError(
      'YOUTUBE_API_KEY not set',
      'youtube_api', 'auth', 0, false
    );
  }

  return withRetry(
    () => withTimeout(async (signal) => {
      const params = new URLSearchParams({
        part: 'snippet,statistics,contentDetails',
        id:   videoId,
        key:  env.value,
      });

      const res = await fetch(`${YT_API_BASE}/videos?${params}`, { signal });
      if (!res.ok) throw classifyHttpError(res.status, 'youtube_api');

      const data = await res.json();
      const item = data.items?.[0];
      if (!item) {
        throw new ProviderError(
          'Video not found or private',
          'youtube_api', 'not_found', 404, false
        );
      }

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
    }, CONFIG.metadata.timeoutMs, 'youtube_api'),
    CONFIG.metadata.retryLimit,
    CONFIG.metadata.retryDelay,
    'youtube_api',
  );
}

// ─── YouTube Transcript (via Supadata API) ─────────────────────────

async function getTranscriptSupadata(videoId) {
  const env = validateEnv('SUPADATA_API_KEY', 'supadata');
  if (!env.available) {
    throw new ProviderError(
      'SUPADATA_API_KEY not set — transcript skipped',
      'supadata', 'auth', 0, false
    );
  }

  return withRetry(
    () => withTimeout(async (signal) => {
      const res = await fetch(
        `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&lang=th`,
        {
          headers: {
            'x-api-key': env.value,
            'Accept':    'application/json',
          },
          signal,
        }
      );

      if (!res.ok) throw classifyHttpError(res.status, 'supadata');

      const data = await res.json();
      const segments = data.content || [];
      const transcript = segments.map(s => s.text).join(' ').trim();

      if (!transcript) {
        throw new ProviderError(
          'Supadata returned empty transcript',
          'supadata', 'not_found', 200, false
        );
      }

      return transcript;
    }, CONFIG.transcript.timeoutMs, 'supadata'),
    CONFIG.transcript.retryLimit,
    CONFIG.transcript.retryDelay,
    'supadata',
  );
}

// ─── Primary: YouTube API + Transcript ─────────────────────────────

async function getYouTubePrimary(url, videoId) {
  let meta = {};
  try {
    meta = await getYouTubeMetadata(videoId);
  } catch (e) {
    console.warn(`[youtubeProvider] getYouTubeMetadata failed: ${e.message} - Will try transcript anyway.`);
    meta = {
      title: 'YouTube Video (Metadata Restricted)',
      description: '',
      channelName: 'Unknown',
      views: 0,
      likes: 0,
      comments: 0,
      language: 'th'
    };
  }
  let transcript = '';
  let transcriptError = null;

  // Try Supadata for transcript (non-blocking failure)
  if (process.env.SUPADATA_API_KEY) {
    try {
      transcript = await getTranscriptSupadata(videoId);
    } catch (e) {
      transcriptError = {
        provider:  'supadata',
        error:     e.message,
        errorType: e.errorType || 'YOUTUBE_TRANSCRIPT_FAILED',
      };
      console.warn(`[youtubeProvider] Supadata transcript failed: ${e.message}`);
    }
  }

  // Combine text: transcript > description
  const text = transcript || meta.description || '';

  return {
    provider:    'youtube_api',
    platform:    'youtube',
    videoId,
    url,
    title:       meta.title,
    description: meta.description,
    text,
    transcript,
    channelName: meta.channelName,
    publishedAt: meta.publishedAt,
    thumbnail:   meta.thumbnail,
    tags:        meta.tags,
    views:       meta.views,
    likes:       meta.likes,
    comments:    meta.comments,
    duration:    meta.duration,
    language:    meta.language || 'th',
    // Transcript status
    transcriptAvailable: transcript.length > 0,
    transcriptError,
  };
}

// ─── Built-in YouTube Fallback ─────────────────────────────────────

async function getYouTubeBuiltin(url, baseUrl = '') {
  return withTimeout(async (signal) => {
    const res = await fetch(`${baseUrl}/api/youtube`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
      signal,
    });

    const data = await res.json();
    if (!data.success) {
      throw new ProviderError(
        data.error || 'YouTube builtin failed',
        'builtin_youtube', 'server', 0, false
      );
    }

    return {
      provider:    'builtin_youtube',
      platform:    'youtube',
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
      transcriptAvailable: Boolean(data.transcript),
    };
  }, CONFIG.builtin.timeoutMs, 'builtin_youtube');
}

// ─── MAIN EXPORT ───────────────────────────────────────────────────

/**
 * @param {string} url   — YouTube URL
 * @param {object} opts  — { baseUrl }
 * @returns {YouTubeResult} — same shape as before (backward compatible)
 */
export async function getYouTubeData(url, opts = {}) {
  const videoId = extractVideoId(url);

  const result = await runProviderChain([
    {
      name:   'youtube_api',
      envKey: 'YOUTUBE_API_KEY',
      fn:     () => getYouTubePrimary(url, videoId),
    },
    {
      name:   'builtin_youtube',
      envKey: null, // always available
      fn:     () => getYouTubeBuiltin(url, opts.baseUrl || ''),
    },
  ], `YouTube: ${url.slice(0, 60)}`);

  // Ensure backward-compatible fields
  if (!result.success) {
    result.videoId    = videoId;
    result.url        = url;
    result.title      = `YouTube: ${url.slice(0, 50)}`;
    result.text       = '';
    result.transcript = '';
    result.platform   = 'youtube';
    result.error      = 'ไม่สามารถดึง YouTube ได้ — ลองใช้ URL แบบเต็มหรือวาง transcript เอง';
  }

  return result;
}

export { extractVideoId };
