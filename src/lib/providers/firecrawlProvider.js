/**
 * Firecrawl + Jina Reader Provider (Phase 4 Refactor)
 * ─────────────────────────────────────────────────────
 * Primary:  Firecrawl  (FIRECRAWL_API_KEY)
 * Fallback: Jina Reader (JINA_API_KEY or free)
 * Last:     Built-in /api/extract (always available)
 *
 * Uses: baseProvider (retry, timeout, error classification)
 */
import {
  ProviderError, classifyHttpError,
  validateEnv, withTimeout, withRetry,
  runProviderChain,
} from './baseProvider';

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';
const JINA_BASE      = 'https://r.jina.ai';

const CONFIG = {
  firecrawl: { timeoutMs: 15000, retryLimit: 2, retryDelay: 1000 },
  jina:      { timeoutMs: 12000, retryLimit: 1, retryDelay: 500  },
  builtin:   { timeoutMs: 10000, retryLimit: 0, retryDelay: 0    },
};

// ─── Firecrawl ──────────────────────────────────────────────────────

async function scrapeWithFirecrawl(url) {
  const env = validateEnv('FIRECRAWL_API_KEY', 'firecrawl');
  if (!env.available) throw new ProviderError('FIRECRAWL_API_KEY not set', 'firecrawl', 'auth', 0, false);

  return withRetry(
    () => withTimeout(async (signal) => {
      const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.value}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          url,
          formats:         ['markdown', 'html'],
          onlyMainContent: true,
          waitFor:         1000,
          timeout:         12000,
        }),
        signal,
      });

      if (!res.ok) throw classifyHttpError(res.status, 'firecrawl');

      const data = await res.json();
      const page = data.data || data;

      return {
        provider:   'firecrawl',
        url,
        title:      page.metadata?.title || page.title || '',
        text:       page.markdown || page.content || '',
        html:       page.html || '',
        description:page.metadata?.description || '',
        author:     page.metadata?.author || '',
        publishedAt:page.metadata?.publishedTime || page.metadata?.modifiedTime || '',
        images:     page.metadata?.ogImage ? [page.metadata.ogImage] : [],
        siteName:   page.metadata?.siteName || '',
        language:   page.metadata?.language || 'th',
        statusCode: page.metadata?.statusCode || 200,
      };
    }, CONFIG.firecrawl.timeoutMs, 'firecrawl'),
    CONFIG.firecrawl.retryLimit,
    CONFIG.firecrawl.retryDelay,
    'firecrawl',
  );
}

// ─── Jina Reader ───────────────────────────────────────────────────

async function scrapeWithJina(url) {
  return withRetry(
    () => withTimeout(async (signal) => {
      const headers = {
        'Accept':          'application/json',
        'X-Return-Format': 'markdown',
        'X-No-Cache':      'true',
      };

      const env = validateEnv('JINA_API_KEY', 'jina');
      if (env.available) headers['Authorization'] = `Bearer ${env.value}`;

      const res = await fetch(`${JINA_BASE}/${url}`, { headers, signal });
      if (!res.ok) throw classifyHttpError(res.status, 'jina');

      const data = await res.json();
      return {
        provider:   'jina',
        url,
        title:      data.data?.title || '',
        text:       data.data?.content || data.data?.text || '',
        html:       '',
        description:data.data?.description || '',
        author:     '',
        publishedAt:'',
        images:     data.data?.images?.map(i => i.url).slice(0, 3) || [],
        siteName:   '',
        language:   'th',
        statusCode: 200,
      };
    }, CONFIG.jina.timeoutMs, 'jina'),
    CONFIG.jina.retryLimit,
    CONFIG.jina.retryDelay,
    'jina',
  );
}

// ─── Built-in Fallback ─────────────────────────────────────────────

async function scrapeWithBuiltin(url, baseUrl = '') {
  return withTimeout(async (signal) => {
    const res = await fetch(`${baseUrl}/api/extract`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
      signal,
    });

    const data = await res.json();
    if (!data.success) throw new ProviderError(data.error || 'extract failed', 'builtin', 'server', 0, false);

    return {
      provider:   'builtin',
      url,
      title:      data.data?.title || '',
      text:       data.data?.text  || data.text || '',
      html:       '',
      description:'',
      author:     '',
      publishedAt:'',
      images:     [],
      siteName:   '',
      language:   'th',
      statusCode: 200,
    };
  }, CONFIG.builtin.timeoutMs, 'builtin');
}

// ─── MAIN: scrapeArticle with provider chain ────────────────────────

/**
 * @param {string} url
 * @param {object} opts — { baseUrl: string }
 * @returns {ArticleResult}
 */
export async function scrapeArticle(url, opts = {}) {
  const chain = [
    {
      name:   'firecrawl',
      envKey: 'FIRECRAWL_API_KEY',
      fn:     () => scrapeWithFirecrawl(url),
    },
    {
      name:   'jina',
      envKey: null,  // Jina works without key (slower rate limit)
      fn:     () => scrapeWithJina(url),
    },
    {
      name:   'builtin',
      envKey: null,  // always available
      fn:     () => scrapeWithBuiltin(url, opts.baseUrl || ''),
    },
  ];

  const result = await runProviderChain(chain, `Article: ${url.slice(0, 60)}`);

  // Ensure minimum text check
  if (result.success && result.text?.length < 50) {
    console.warn(`[firecrawlProvider] ⚠️ Very short content (${result.text.length}ch) from ${result.provider}`);
  }

  return result;
}
