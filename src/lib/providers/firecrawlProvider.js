/**
 * Firecrawl + Jina Reader Provider
 * ─────────────────────────────────────────────────────
 * Primary:  Firecrawl  (FIRECRAWL_API_KEY)
 * Fallback: Jina Reader (r.jina.ai — free)
 * Last:     Built-in /api/extract (always available)
 *
 * scrapeArticle(url) → NormalizedArticle
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';
const JINA_BASE      = 'https://r.jina.ai';
const TIMEOUT_MS     = 15000;

// ─── Firecrawl ──────────────────────────────────────────────────────

async function scrapeWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        url,
        formats:           ['markdown', 'html'],
        onlyMainContent:   true,
        waitFor:           1000,
        timeout:           12000,
        actions:           [],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Firecrawl ${res.status}: ${err.slice(0, 100)}`);
    }

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
  } finally {
    clearTimeout(timer);
  }
}

// ─── Jina Reader ───────────────────────────────────────────────────

async function scrapeWithJina(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const jinaUrl = `${JINA_BASE}/${url}`;
    const headers = {
      'Accept':          'application/json',
      'X-Return-Format': 'markdown',
      'X-No-Cache':      'true',
    };

    const apiKey = process.env.JINA_API_KEY;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(jinaUrl, { headers, signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`Jina ${res.status}: ${res.statusText}`);

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
  } finally {
    clearTimeout(timer);
  }
}

// ─── Built-in Fallback (calls /api/extract) ────────────────────────

async function scrapeWithBuiltin(url, baseUrl = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/api/extract`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'extract failed');

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
  } finally {
    clearTimeout(timer);
  }
}

// ─── MAIN: scrapeArticle with fallback chain ───────────────────────

/**
 * @param {string} url
 * @param {object} opts — { baseUrl: string (for builtin fallback) }
 * @returns {ArticleResult}
 */
export async function scrapeArticle(url, opts = {}) {
  const errors = [];

  // 1. Firecrawl (primary)
  if (process.env.FIRECRAWL_API_KEY) {
    try {
      const result = await scrapeWithFirecrawl(url);
      if (result.text?.length > 100) {
        console.log(`[firecrawlProvider] ✅ Firecrawl OK: ${result.text.length}ch`);
        return { ...result, success: true, fallbackUsed: false };
      }
    } catch (e) {
      errors.push({ provider: 'firecrawl', error: e.message });
      console.warn(`[firecrawlProvider] Firecrawl failed: ${e.message} — trying Jina`);
    }
  }

  // 2. Jina Reader (fallback)
  try {
    const result = await scrapeWithJina(url);
    if (result.text?.length > 80) {
      console.log(`[firecrawlProvider] ✅ Jina fallback OK: ${result.text.length}ch`);
      return { ...result, success: true, fallbackUsed: true, fallbackProvider: 'jina', errors };
    }
  } catch (e) {
    errors.push({ provider: 'jina', error: e.message });
    console.warn(`[firecrawlProvider] Jina failed: ${e.message} — trying builtin`);
  }

  // 3. Built-in scraper (last resort)
  try {
    const result = await scrapeWithBuiltin(url, opts.baseUrl || '');
    if (result.text?.length > 50) {
      console.log(`[firecrawlProvider] ✅ Builtin fallback OK: ${result.text.length}ch`);
      return { ...result, success: true, fallbackUsed: true, fallbackProvider: 'builtin', errors };
    }
  } catch (e) {
    errors.push({ provider: 'builtin', error: e.message });
  }

  // All failed
  return {
    success:      false,
    provider:     'none',
    url,
    title:        '',
    text:         '',
    errors,
    fallbackUsed: true,
    error:        `ไม่สามารถดึงเนื้อหาได้จากทุก provider (${errors.map(e => e.provider).join(', ')})`,
  };
}
