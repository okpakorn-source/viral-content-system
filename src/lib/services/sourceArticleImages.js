/**
 * =====================================================
 * Agent 0: Source Article Images
 * =====================================================
 * ดึงภาพจากบทความข่าวต้นทางโดยตรง (og:image + <img> ในเนื้อข่าว)
 *
 * เหตุผล: ภาพ "กิจกรรมจริงของเรื่อง" (บ้านที่กำลังสร้าง สวนจริง เหตุการณ์จริง)
 * แทบไม่มีใน Google Images — มีอยู่ที่เดียวคือในบทความข่าวเอง
 * การค้นด้วยชื่อคนได้แต่ portrait → ปก "คนถูกแต่ผิดเรื่อง"
 *
 * Timeout 10s, ไม่มี dependency เพิ่ม — fail เงียบคืน []
 */

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'th,en;q=0.8',
};

const SKIP_PATTERN = /\.svg|logo|icon|avatar|sprite|banner|advert|[\/._-]ads?[\/._-]|pixel|emoji|button|placeholder|share|widget/i;

export async function extractSourceArticleImages(articleUrl, maxImages = 8) {
  if (!articleUrl || !/^https?:\/\//i.test(articleUrl)) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(articleUrl, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.log(`[Agent0:Article] HTTP ${res.status} from source article`);
      return [];
    }
    const html = await res.text();
    const urls = new Set();

    // 1) og:image / twitter:image — ภาพหลักที่กองบรรณาธิการเลือกเอง
    for (const re of [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
    ]) {
      let m;
      while ((m = re.exec(html)) !== null) urls.add(m[1]);
    }

    // 2) <img> ในเนื้อข่าว — ข้าม icon/logo/ads และรูปที่ประกาศ width เล็ก
    const imgRe = /<img[^>]+(?:data-src|data-lazy-src|src)=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = imgRe.exec(html)) !== null && urls.size < maxImages + 8) {
      const src = m[1];
      if (!src || src.startsWith('data:') || SKIP_PATTERN.test(src)) continue;
      const wMatch = m[0].match(/width=["']?(\d+)/i);
      if (wMatch && parseInt(wMatch[1], 10) < 300) continue;
      urls.add(src);
    }

    // ทำ absolute URL + กรองซ้ำ
    const base = new URL(articleUrl);
    const absolute = [...urls]
      .map(u => { try { return new URL(u, base).href; } catch { return null; } })
      .filter(u => u && /^https?:\/\//i.test(u))
      .slice(0, maxImages);

    console.log(`[Agent0:Article] ✅ ${absolute.length} images extracted from source article`);
    return absolute;
  } catch (e) {
    console.log('[Agent0:Article] Error:', e.message?.slice(0, 60));
    return [];
  }
}
