import * as cheerio from 'cheerio';

/**
 * ดึงเนื้อหาจาก URL เว็บไซต์ข่าว/บทความ
 * รองรับเว็บไทย: khaosod, thairath, matichon, prachachat, etc.
 */
export async function extractFromUrl(url) {
  // ลองหลายวิธีจนกว่าจะได้
  const methods = [
    () => fetchDirect(url),
    () => fetchWithGoogleCache(url),
    () => fetchWithAllOrigins(url),
  ];

  for (const method of methods) {
    try {
      const result = await method();
      if (result && result.success && result.text && result.text.length > 50) {
        return result;
      }
    } catch (e) {
      continue;
    }
  }

  // ทุกวิธีไม่ได้ — แนะนำ paste
  return {
    success: false,
    type: 'url',
    error: `ไม่สามารถดึงเนื้อหาจาก URL นี้ได้ (เว็บบล็อกการเข้าถึง) — กรุณา copy/paste ข้อความจากเว็บมาในช่องข้อความแทน`,
    url,
    suggestion: 'paste',
  };
}

/**
 * วิธีที่ 1: Fetch ตรงด้วย headers เหมือน browser
 */
async function fetchDirect(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.google.com/',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return parseHtml(html, url);
}

/**
 * วิธีที่ 2: ผ่าน Google Web Cache
 */
async function fetchWithGoogleCache(url) {
  const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
  const res = await fetch(cacheUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Cache HTTP ${res.status}`);
  const html = await res.text();
  return parseHtml(html, url);
}

/**
 * วิธีที่ 3: ผ่าน allorigins proxy (CORS proxy)
 */
async function fetchWithAllOrigins(url) {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  const html = await res.text();
  return parseHtml(html, url);
}

/**
 * Parse HTML เป็น structured data
 */
function parseHtml(html, url) {
  const $ = cheerio.load(html);

  // Remove noise
  $('script, style, nav, footer, header, aside, .ads, .advertisement, .social-share, .comments, .related-posts, iframe, noscript, .sidebar, .widget, .popup, .modal, .cookie-consent').remove();

  // Title
  const title = $('meta[property="og:title"]').attr('content')
    || $('h1').first().text().trim()
    || $('title').text().trim()
    || '';

  // Description
  const description = $('meta[property="og:description"]').attr('content')
    || $('meta[name="description"]').attr('content')
    || '';

  // Image
  const image = $('meta[property="og:image"]').attr('content') || '';

  // Body — try article selectors first
  const selectors = [
    '.entry-content', '.article-content', '.post-content',
    '.content-detail', '.detail-content', '.article-body',
    '[itemprop="articleBody"]', '#article-content',
    '.td-post-content', '.single-content',
    'article .content', 'article', '.post', 'main .content', 'main',
  ];

  let bodyText = '';
  for (const sel of selectors) {
    const el = $(sel);
    if (el.length) {
      const paragraphs = [];
      el.find('p').each((_, p) => {
        const t = $(p).text().trim();
        if (t.length > 15) paragraphs.push(t);
      });
      if (paragraphs.length >= 2) {
        bodyText = paragraphs.join('\n\n');
        break;
      }
    }
  }

  // Fallback: all <p> tags
  if (!bodyText || bodyText.length < 80) {
    const allP = [];
    $('p').each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 20) allP.push(t);
    });
    bodyText = allP.slice(0, 40).join('\n\n');
  }

  // Final fallback
  if (!bodyText || bodyText.length < 50) {
    bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 5000);
  }

  if (!bodyText || bodyText.length < 30) {
    return { success: false, type: 'url', error: 'ไม่พบเนื้อหาในหน้าเว็บ', url };
  }

  return {
    success: true,
    type: 'url',
    title: title.slice(0, 200),
    description: description.slice(0, 500),
    text: bodyText.slice(0, 8000),
    image,
    url,
    extractedAt: new Date().toISOString(),
  };
}
