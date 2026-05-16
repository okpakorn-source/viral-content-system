import * as cheerio from 'cheerio';

/**
 * ดึงเนื้อหาจาก URL — ใช้ Firecrawl API เป็นตัวหลัก
 * Firecrawl ผ่าน Cloudflare + render JS ได้ = ดึงข่าวไทยได้ทุกเว็บ
 * สมัครฟรี: https://firecrawl.dev → 500 credits/เดือน
 */
export async function extractFromUrl(url) {
  const methods = [
    { name: 'firecrawl', fn: () => fetchWithFirecrawl(url) },
    { name: 'jina', fn: () => fetchWithJina(url) },
    { name: 'direct', fn: () => fetchDirect(url) },
  ];

  for (const { name, fn } of methods) {
    try {
      const result = await fn();
      if (result?.success && result.text?.length > 80) {
        result.method = name;
        return result;
      }
    } catch (e) {
      console.log(`[Extract] ${name} failed: ${e.message}`);
    }
  }

  return {
    success: false, type: 'url',
    error: 'ไม่สามารถดึงเนื้อหาอัตโนมัติ — กรุณา copy ข้อความจากเว็บมาวาง',
    url, suggestion: 'paste',
  };
}

// ============================================================
// 1. Firecrawl API (ฟรี 500/เดือน, ผ่าน CF, render JS)
// ============================================================
async function fetchWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('No FIRECRAWL_API_KEY');

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: 20000,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Firecrawl ${res.status}: ${err.slice(0, 100)}`);
  }

  const data = await res.json();
  if (!data.success || !data.data?.markdown) throw new Error('No content');

  const markdown = data.data.markdown;
  const title = data.data.metadata?.title || '';
  const image = data.data.metadata?.ogImage || data.data.metadata?.image || '';
  const text = cleanMarkdown(markdown);

  if (text.length < 50) throw new Error('Content too short');

  return {
    success: true, type: 'url',
    title: title.slice(0, 200),
    text: text.slice(0, 15000),
    image, url,
    extractedAt: new Date().toISOString(),
  };
}

// ============================================================
// 2. Jina Reader (ฟรี, ไม่ต้อง key)
// ============================================================
async function fetchWithJina(url) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const raw = await res.text();
  if (raw.length < 50 || raw.includes('blocked') || raw.includes('SecurityCompromise')) throw new Error('Blocked');

  const lines = raw.split('\n');
  const titleLine = lines.find(l => l.startsWith('#'));
  const title = titleLine ? titleLine.replace(/^#+\s*/, '').trim() : '';
  const body = cleanMarkdown(raw);
  if (body.length < 50) throw new Error('Empty');

  return {
    success: true, type: 'url',
    title: title || body.slice(0, 80),
    text: body.slice(0, 15000),
    url, extractedAt: new Date().toISOString(),
  };
}

// ============================================================
// 3. Direct fetch (สำหรับเว็บที่ไม่มี CF)
// ============================================================
async function fetchDirect(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html', 'Accept-Language': 'th-TH,th;q=0.9',
    },
    redirect: 'follow', signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const html = await res.text();
  if (html.includes('challenge-platform') || html.includes('cf_chl')) throw new Error('CF');
  return parseHtml(html, url);
}

function parseHtml(html, url) {
  const $ = cheerio.load(html);
  $('script,style,nav,footer,header,aside,.ads,.social-share,.comments,.related-posts,.sidebar,iframe,noscript,svg').remove();
  const title = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || '';
  const image = $('meta[property="og:image"]').attr('content') || '';
  const sels = ['.entry-content','.article-content','.content-detail','[itemprop="articleBody"]','article','main'];
  let text = '';
  for (const s of sels) {
    const p = []; $(s).find('p').each((_,el) => { const t = $(el).text().trim(); if(t.length>20) p.push(t); });
    if (p.length >= 2) { text = p.join('\n\n'); break; }
  }
  if (!text || text.length < 80) {
    const ap = []; $('p').each((_,el) => { const t = $(el).text().trim(); if(t.length>25) ap.push(t); });
    text = ap.slice(0,50).join('\n\n');
  }
  if (!text || text.length < 50) return { success: false };
  return { success: true, type: 'url', title: title.slice(0,200), text: text.slice(0,15000), image, url, extractedAt: new Date().toISOString() };
}

function cleanMarkdown(text) {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, '').replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s*/gm, '').replace(/^[>\-*]\s*/gm, '')
    .replace(/`([^`]+)`/g, '$1').replace(/```[\s\S]*?```/g, '')
    .replace(/\|.*\|/g, '').replace(/^---+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
