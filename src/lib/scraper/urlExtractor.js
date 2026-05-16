import * as cheerio from 'cheerio';

/**
 * ดึงเนื้อหาจาก URL เว็บไซต์ข่าว/บทความ
 * ใช้หลายวิธีอัตโนมัติ รวมถึง headless browser APIs
 */
export async function extractFromUrl(url) {
  const methods = [
    { name: 'jina-reader', fn: () => fetchWithJinaReader(url) },
    { name: 'scrapingdog', fn: () => fetchWithScrapingDog(url) },
    { name: 'direct', fn: () => fetchDirect(url) },
    { name: 'allorigins', fn: () => fetchWithProxy(url) },
  ];

  for (const { name, fn } of methods) {
    try {
      const result = await fn();
      if (result?.success && result.text?.length > 80) {
        result.method = name;
        console.log(`[URL Extract] ✅ Success via ${name}: ${result.text.length} chars`);
        return result;
      }
    } catch (e) {
      console.log(`[URL Extract] ❌ ${name}: ${e.message}`);
      continue;
    }
  }

  return {
    success: false, type: 'url',
    error: 'เว็บนี้มีระบบป้องกัน bot — กรุณา copy ข้อความจากเว็บมาวางในช่องด้านล่าง',
    url, suggestion: 'paste',
  };
}

// ============================================================
// 1. Jina AI Reader (ฟรี, render JS ได้)
// ============================================================
async function fetchWithJinaReader(url) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text', 'X-Timeout': '15' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const text = await res.text();
  if (text.length < 50 || text.includes('blocked') || text.includes('SecurityCompromise')) throw new Error('Blocked');
  return parseMarkdownResponse(text, url);
}

// ============================================================
// 2. ScrapingDog Free (1000 free/month, render JS)
// ============================================================
async function fetchWithScrapingDog(url) {
  // ใช้ free tier — ไม่ต้อง API key สำหรับ basic scraping
  const apiUrl = `https://api.scrapingdog.com/scrape?api_key=free&url=${encodeURIComponent(url)}&dynamic=true`;
  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status}`);
  const html = await res.text();
  if (html.length < 200) throw new Error('Empty');
  return parseHtml(html, url);
}

// ============================================================
// 3. Direct fetch (สำหรับเว็บที่ไม่มี Cloudflare)
// ============================================================
async function fetchDirect(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'th-TH,th;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const html = await res.text();
  // Check if it's a Cloudflare challenge page
  if (html.includes('challenge-platform') || html.includes('cf_chl') || html.includes('Just a moment')) {
    throw new Error('Cloudflare blocked');
  }
  return parseHtml(html, url);
}

// ============================================================
// 4. AllOrigins Proxy
// ============================================================
async function fetchWithProxy(url) {
  const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const html = await res.text();
  if (html.includes('challenge-platform') || html.includes('cf_chl')) throw new Error('CF blocked');
  return parseHtml(html, url);
}

// ============================================================
// Parsers
// ============================================================
function parseMarkdownResponse(text, url) {
  const lines = text.split('\n');
  let title = '';
  let body = text;

  const titleLine = lines.find(l => l.startsWith('#'));
  if (titleLine) {
    title = titleLine.replace(/^#+\s*/, '').trim();
    body = text.slice(text.indexOf(titleLine) + titleLine.length).trim();
  }

  body = cleanMarkdown(body);
  if (body.length < 50) return { success: false };

  return {
    success: true, type: 'url',
    title: title || body.slice(0, 80),
    text: body.slice(0, 10000),
    url, extractedAt: new Date().toISOString(),
  };
}

function parseHtml(html, url) {
  const $ = cheerio.load(html);

  // Remove noise
  $('script, style, nav, footer, header, aside, .ads, .ad, .advertisement, .social-share, .comments, .related-posts, .sidebar, .widget, iframe, noscript, svg, .cookie, .subscribe, .popup, .modal, .breadcrumb').remove();

  const title = $('meta[property="og:title"]').attr('content')
    || $('h1').first().text().trim()
    || $('title').text().trim() || '';
  const image = $('meta[property="og:image"]').attr('content') || '';

  // Try article-specific selectors
  const selectors = [
    '.entry-content', '.content-detail', '.detail-content',
    '.article-content', '.article-body', '.article-detail',
    '.td-post-content', '.post-content', '.single-content',
    '[itemprop="articleBody"]', '#article-content',
    '.news-content', '.news-detail',
    'article .content', 'article', 'main',
  ];

  let bodyText = '';
  for (const sel of selectors) {
    const el = $(sel);
    if (!el.length) continue;
    const paras = [];
    el.find('p, div.paragraph, .text-body p').each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 20 && !isNoise(t)) paras.push(t);
    });
    if (paras.length >= 2 && paras.join(' ').length > 100) {
      bodyText = paras.join('\n\n');
      break;
    }
  }

  // Fallback
  if (!bodyText || bodyText.length < 100) {
    const allP = [];
    $('p').each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 25 && !isNoise(t)) allP.push(t);
    });
    bodyText = allP.slice(0, 50).join('\n\n');
  }

  if (!bodyText || bodyText.length < 50) return { success: false };

  return {
    success: true, type: 'url',
    title: title.slice(0, 200),
    text: bodyText.slice(0, 10000),
    image, url,
    extractedAt: new Date().toISOString(),
  };
}

function isNoise(text) {
  const noise = ['อ่านข่าว', 'อ่านต่อ', 'คลิก', 'ติดตาม', 'แชร์', 'ที่มา:', 'copyright', 'cookie', 'subscribe', 'advertisement'];
  const lower = text.toLowerCase();
  return noise.some(n => lower.includes(n) && text.length < 60);
}

function cleanMarkdown(text) {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^[>\-*]\s*/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\|.*\|/g, '')
    .replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
