/**
 * Base Provider Adapter — Shared Pattern for all providers
 * ─────────────────────────────────────────────────────
 * ทุก provider ต้องใช้:
 *  - validateEnv()   → ตรวจ API key ก่อน call
 *  - withTimeout()   → abort ถ้านาน
 *  - withRetry()     → retry N ครั้งก่อน fallback
 *  - ProviderError   → error type ชัดเจน
 *  - normalizeResponse() → output เดียวกัน
 */

// ─── Error Types ───────────────────────────────────────────────────

export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {string} provider    — 'firecrawl', 'apify', 'youtube', etc.
   * @param {string} errorType   — 'auth'|'timeout'|'rate_limit'|'not_found'|'server'|'network'|'parse'|'unknown'
   * @param {number} statusCode  — HTTP status or 0
   * @param {boolean} retryable  — should retry?
   */
  constructor(message, provider, errorType = 'unknown', statusCode = 0, retryable = false) {
    super(message);
    this.name       = 'ProviderError';
    this.provider   = provider;
    this.errorType  = errorType;
    this.statusCode = statusCode;
    this.retryable  = retryable;
    this.timestamp  = new Date().toISOString();
  }
}

/**
 * Classify HTTP status → error type
 */
export function classifyHttpError(status, provider) {
  if (status === 401 || status === 403)
    return new ProviderError(`${provider}: authentication failed (${status})`, provider, 'auth', status, false);
  if (status === 429)
    return new ProviderError(`${provider}: rate limit exceeded`, provider, 'rate_limit', status, true);
  if (status === 404)
    return new ProviderError(`${provider}: not found (404)`, provider, 'not_found', status, false);
  if (status >= 500)
    return new ProviderError(`${provider}: server error (${status})`, provider, 'server', status, true);
  return new ProviderError(`${provider}: HTTP ${status}`, provider, 'unknown', status, false);
}

// ─── Env Validation ────────────────────────────────────────────────

/**
 * ตรวจ env key ว่ามีหรือไม่
 * @param {string} envKey    — e.g. 'FIRECRAWL_API_KEY'
 * @param {string} provider  — e.g. 'firecrawl'
 * @returns {{ available: boolean, value: string|null, masked: string }}
 */
export function validateEnv(envKey, provider) {
  if (!envKey) return { available: true, value: null, masked: 'N/A (no key needed)' };

  const value = process.env[envKey] || '';
  const available = value.length > 0;
  const masked = available
    ? value.slice(0, 6) + '...' + value.slice(-4)
    : 'MISSING';

  if (!available) {
    console.warn(`[baseProvider] ⚠️ ${provider}: ${envKey} not set — will use fallback`);
  }
  return { available, value: available ? value : null, masked };
}

// ─── Timeout Wrapper ───────────────────────────────────────────────

/**
 * Wrap a fetch/async call with AbortController timeout
 * @param {Function} fn         — async function(signal) => result
 * @param {number}   timeoutMs  — milliseconds
 * @param {string}   provider   — for error message
 * @returns {Promise<any>}
 */
export async function withTimeout(fn, timeoutMs, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await fn(controller.signal);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ProviderError(`${provider}: timeout after ${timeoutMs}ms`, provider, 'timeout', 0, true);
    }
    throw err;
  }
}

// ─── Retry Wrapper ─────────────────────────────────────────────────

/**
 * Retry async function with exponential backoff
 * @param {Function}  fn          — async function()
 * @param {number}    maxRetries  — max retry count (default 2)
 * @param {number}    delayMs     — initial delay (default 1000)
 * @param {string}    provider    — for logging
 * @returns {Promise<any>}
 */
export async function withRetry(fn, maxRetries = 2, delayMs = 1000, provider = 'unknown') {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable = err.retryable !== false && attempt < maxRetries;

      if (isRetryable) {
        const wait = delayMs * Math.pow(2, attempt); // exponential backoff
        console.warn(`[baseProvider] ${provider}: attempt ${attempt + 1}/${maxRetries + 1} failed — retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        break;
      }
    }
  }

  throw lastError;
}

// ─── Fetch with all safeguards ─────────────────────────────────────

/**
 * Production-grade fetch:
 *  - env validation
 *  - timeout
 *  - retry
 *  - error classification
 *  - normalized error output
 *
 * @param {string}   url
 * @param {object}   fetchOpts     — fetch options (method, headers, body)
 * @param {object}   config
 * @param {string}   config.provider     — provider name
 * @param {string}   config.envKey       — env key to validate (null if none needed)
 * @param {number}   config.timeoutMs    — timeout in ms (default 15000)
 * @param {number}   config.maxRetries   — retry count (default 2)
 * @param {number}   config.retryDelayMs — initial retry delay (default 1000)
 * @returns {Promise<Response>}
 */
export async function safeFetch(url, fetchOpts = {}, config = {}) {
  const {
    provider     = 'unknown',
    envKey       = null,
    timeoutMs    = 15000,
    maxRetries   = 2,
    retryDelayMs = 1000,
  } = config;

  // 1. Env validation
  if (envKey) {
    const env = validateEnv(envKey, provider);
    if (!env.available) {
      throw new ProviderError(`${provider}: ${envKey} not configured`, provider, 'auth', 0, false);
    }
  }

  // 2. Retry + timeout
  return withRetry(
    () => withTimeout(
      async (signal) => {
        const res = await fetch(url, { ...fetchOpts, signal });
        if (!res.ok) throw classifyHttpError(res.status, provider);
        return res;
      },
      timeoutMs,
      provider,
    ),
    maxRetries,
    retryDelayMs,
    provider,
  );
}

// ─── Normalized Provider Response ──────────────────────────────────

/**
 * Standard provider response shape
 * All providers must return this or a superset
 */
export function createProviderResponse(provider, success, data = {}) {
  return {
    success,
    provider,
    timestamp:  new Date().toISOString(),
    // Content
    url:         data.url        || '',
    title:       data.title      || '',
    text:        data.text       || '',
    description: data.description|| '',
    images:      data.images     || [],
    author:      data.author     || '',
    publishedAt: data.publishedAt|| '',
    language:    data.language   || 'th',
    // Platform
    platform:    data.platform   || provider,
    // Metadata
    statusCode:  data.statusCode || 200,
    fallbackUsed:    data.fallbackUsed    || false,
    fallbackProvider:data.fallbackProvider|| null,
    errors:      data.errors     || [],
    // Stats (social)
    views:       data.views      || 0,
    likes:       data.likes      || 0,
    comments:    data.comments   || 0,
    shares:      data.shares     || 0,
    // Video
    videoId:     data.videoId    || '',
    transcript:  data.transcript || '',
    duration:    data.duration   || '',
    tags:        data.tags       || [],
    hashtags:    data.hashtags   || [],
    thumbnail:   data.thumbnail  || '',
    channelName: data.channelName|| '',
    // Timing
    durationMs:  data.durationMs || 0,
  };
}

// ─── Provider Registry Helper ──────────────────────────────────────

/**
 * Run a chain of provider attempts (primary → fallback1 → fallback2)
 * @param {Array<{name: string, fn: Function, envKey: string|null}>} chain
 * @param {string} context — for logging
 * @returns {Promise<ProviderResponse>}
 */
export async function runProviderChain(chain, context = '') {
  const errors = [];
  const startTime = Date.now();

  for (const { name, fn, envKey } of chain) {
    // Skip if env not available
    if (envKey && !process.env[envKey]) {
      errors.push({ provider: name, error: `${envKey} not set`, skipped: true });
      continue;
    }

    try {
      const result = await fn();
      if (result && (result.text?.length > 10 || result.title?.length > 5 || result.success)) {
        const durationMs = Date.now() - startTime;
        console.log(`[providers] ✅ ${name}: ${context} (${durationMs}ms)`);
        return {
          ...result,
          success:          true,
          provider:         name,
          fallbackUsed:     errors.length > 0,
          fallbackProvider: errors.length > 0 ? name : null,
          errors,
          durationMs,
        };
      }
    } catch (err) {
      errors.push({
        provider:  name,
        error:     err.message,
        errorType: err.errorType || 'unknown',
        retryable: err.retryable || false,
      });
      console.warn(`[providers] ⚠️ ${name} failed: ${err.message} — ${context}`);
    }
  }

  // All providers failed
  return createProviderResponse('none', false, {
    errors,
    durationMs: Date.now() - startTime,
  });
}
