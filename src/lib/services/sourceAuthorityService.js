/**
 * Source Authority Service
 * ให้คะแนนความน่าเชื่อถือของแหล่งที่มาของภาพ
 * ไม่ต้องใช้ AI — ตรวจ domain เท่านั้น (เร็วมาก)
 */

// ─── Authority scores (0.0 – 1.0) ────────────────────────────────────────────
const AUTHORITY_MAP = {
  'facebook.com':       0.90,
  'youtube.com':        0.90,
  'tiktok.com':         0.85,
  'instagram.com':      0.85,
  'thairath.co.th':     0.80,
  'khaosod.co.th':      0.80,
  'kapook.com':         0.75,
  'sanook.com':         0.75,
  'manager.co.th':      0.70,
  'dailynews.co.th':    0.70,
  'matichon.co.th':     0.70,
  'pptv36.com':         0.70,
  'nationtv.tv':        0.70,
  'tnn.th':             0.70,
  'pptvhd36.com':       0.68,
  'workpoint.com':      0.65,
  'amarintv.com':       0.65,
  'siamrath.co.th':     0.60,
  'komchadluek.net':    0.60,
  'naewna.com':         0.60,
  'bangkokbiznews.com': 0.65,
  'posttoday.com':      0.60,
  'pantip.com':         0.40,
  'blogspot.com':       0.30,
  'wordpress.com':      0.30,
  'pinterest.com':      0.20,
  'shutterstock.com':   0.05, // stock photo — ห้ามใช้
  'gettyimages.com':    0.05, // stock photo — ห้ามใช้
  'istockphoto.com':    0.05, // stock photo — ห้ามใช้
  'dreamstime.com':     0.05, // stock photo — ห้ามใช้
  'alamy.com':          0.05, // stock photo — ห้ามใช้
};

// Authority ต่ำกว่านี้ → ทิ้งทันที
const MIN_AUTHORITY_SCORE = 0.25;

// Stock photo domains — ห้ามใช้เด็ดขาด
const STOCK_PHOTO_DOMAINS = ['shutterstock.com', 'gettyimages.com', 'istockphoto.com', 'dreamstime.com', 'alamy.com'];

/**
 * getSourceAuthority — คืนคะแนนความน่าเชื่อถือของแหล่งที่มา
 * @param {string} imageUrl — URL ของภาพ
 * @param {string} [sourceUrl] — URL ของหน้าเว็บที่ภาพมาจาก
 * @returns {number} — authority score (0.0-1.0)
 */
export function getSourceAuthority(imageUrl, sourceUrl) {
  try {
    // ตรวจ sourceUrl ก่อน (น่าเชื่อถือกว่า imageUrl)
    const urlsToCheck = [sourceUrl, imageUrl].filter(Boolean);
    for (const url of urlsToCheck) {
      const domain = new URL(url).hostname.replace('www.', '');
      for (const [key, score] of Object.entries(AUTHORITY_MAP)) {
        if (domain.includes(key)) return score;
      }
    }
    return 0.35; // unknown source
  } catch {
    return 0.35;
  }
}

/**
 * isStockPhoto — ตรวจว่าเป็น stock photo ไหม
 * @param {string} imageUrl
 * @param {string} [sourceUrl]
 * @returns {boolean}
 */
export function isStockPhoto(imageUrl, sourceUrl) {
  const urlsToCheck = [imageUrl, sourceUrl].filter(Boolean);
  return urlsToCheck.some(url => {
    try {
      const domain = new URL(url).hostname.replace('www.', '');
      return STOCK_PHOTO_DOMAINS.some(d => domain.includes(d));
    } catch {
      return false;
    }
  });
}

/**
 * scoreAndFilterImages — เพิ่ม authorityScore และ filter images ที่มาจากแหล่งต่ำ
 * @param {Array} images — [{imageUrl, sourceUrl, ...}]
 * @returns {Array} — images พร้อม authorityScore, เรียงตาม score สูง→ต่ำ
 */
export function scoreAndFilterImages(images) {
  if (!images || images.length === 0) return [];

  const scored = images
    .map(img => {
      const authority = getSourceAuthority(img.imageUrl || img.url, img.sourceUrl || img.link);
      return { ...img, authorityScore: authority };
    })
    .filter(img => {
      // กรอง stock photo และแหล่งที่มาต่ำ
      if (isStockPhoto(img.imageUrl || img.url, img.sourceUrl || img.link)) {
        console.log(`[SourceAuthority] ❌ Stock photo filtered: ${(img.imageUrl || img.url)?.slice(0, 60)}`);
        return false;
      }
      if (img.authorityScore < MIN_AUTHORITY_SCORE) {
        return false;
      }
      return true;
    });

  // เรียงตาม authorityScore สูง→ต่ำ
  scored.sort((a, b) => (b.authorityScore || 0) - (a.authorityScore || 0));
  return scored;
}
