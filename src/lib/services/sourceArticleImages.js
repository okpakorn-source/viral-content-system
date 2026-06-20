/**
 * =====================================================
 * Agent 0: Source Article Images (ปก — แยกจากระบบทำข่าว 100%)
 * =====================================================
 * ดึงภาพจากบทความข่าวต้นทางโดยตรง (og:image + <img> ในเนื้อข่าว)
 *
 * เหตุผล: ภาพ "เหตุการณ์จริงของเรื่อง + คนถูกตัว" (บ้านจริง/สวนจริง/งานแต่งจริง)
 * แทบไม่มีใน Google Images — มีอยู่ที่เดียวคือในบทความข่าวเอง
 *
 * ★ 19 มิ.ย. (ยกเครื่องปก #1): เพิ่ม fallback Firecrawl เรนเดอร์ JS
 *   เดิม fetch ธรรมดา → เว็บ JS หนัก/ภาพ lazy-load ดึงไม่ได้ → ภาพต้นทางหาย
 *   ใหม่: fetch เร็วก่อน ถ้าได้ภาพ <2 ใบ ค่อยใช้ Firecrawl (เรนเดอร์เต็ม) เก็บภาพให้ครบ
 */

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'th,en;q=0.8',
};

const SKIP_PATTERN = /\.svg|logo|icon|avatar|sprite|banner|advert|[\/._-]ads?[\/._-]|pixel|emoji|button|placeholder|share|widget/i;

// ── แกะภาพจาก HTML (og:image + <img> ในเนื้อ) ──
function parseImagesFromHtml(html, baseUrl, maxImages) {
  if (!html) return [];
  const urls = new Set();
  // 1) og:image / twitter:image — ภาพหลักที่กองบรรณาธิการเลือกเอง (ตัวจริง เหตุการณ์จริง)
  for (const re of [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
  ]) {
    let m;
    while ((m = re.exec(html)) !== null) urls.add(m[1]);
  }
  // 2) <img> ในเนื้อข่าว — ข้าม icon/logo/ads และรูปที่ประกาศ width เล็ก
  const imgRe = /<img[^>]+(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null && urls.size < maxImages + 12) {
    const src = m[1];
    if (!src || src.startsWith('data:') || SKIP_PATTERN.test(src)) continue;
    const wMatch = m[0].match(/width=["']?(\d+)/i);
    if (wMatch && parseInt(wMatch[1], 10) < 300) continue;
    urls.add(src);
  }
  // absolute + กรองซ้ำ
  let base; try { base = new URL(baseUrl); } catch { base = null; }
  return [...urls]
    .map(u => { try { return base ? new URL(u, base).href : u; } catch { return null; } })
    .filter(u => u && /^https?:\/\//i.test(u));
}

// ── Firecrawl: เรนเดอร์ JS แล้วคืน HTML เต็ม (ใช้เมื่อ fetch ธรรมดาได้ภาพน้อย) ──
async function firecrawlHtml(url) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['html'], onlyMainContent: false, timeout: 20000 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) { console.log('[Agent0:Article] Firecrawl HTTP', res.status); return ''; }
    const data = await res.json();
    return data?.data?.html || data?.html || '';
  } catch (e) { console.log('[Agent0:Article] Firecrawl error:', e.message?.slice(0, 50)); return ''; }
}

export async function extractSourceArticleImages(articleUrl, maxImages = 8) {
  if (!articleUrl || !/^https?:\/\//i.test(articleUrl)) return [];
  let imgs = [];

  // ── ทางเร็ว: fetch ธรรมดา (ฟรี เร็ว) ──
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(articleUrl, { headers: DEFAULT_HEADERS, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (res.ok) imgs = parseImagesFromHtml(await res.text(), articleUrl, maxImages);
    else console.log(`[Agent0:Article] HTTP ${res.status} (plain) → ลอง Firecrawl`);
  } catch (e) { console.log('[Agent0:Article] plain fetch fail:', e.message?.slice(0, 40), '→ ลอง Firecrawl'); }

  // ── ทาง fallback: Firecrawl เรนเดอร์ JS (เมื่อภาพน้อย — เว็บ JS หนัก/lazy-load/FB) ──
  if (imgs.length < 2 && process.env.FIRECRAWL_API_KEY) {
    const html = await firecrawlHtml(articleUrl);
    if (html) {
      const fc = parseImagesFromHtml(html, articleUrl, maxImages);
      if (fc.length) console.log(`[Agent0:Article] 🔥 Firecrawl ได้เพิ่ม ${fc.length} ภาพ (เรนเดอร์ JS)`);
      imgs = [...new Set([...imgs, ...fc])];
    }
  }

  imgs = imgs.slice(0, maxImages);
  console.log(`[Agent0:Article] ✅ ${imgs.length} images (source article${imgs.length > 0 ? '' : ' — none'})`);
  return imgs;
}
