/**
 * sourceNormalizer.js — แปลงข้อมูลดิบจากแหล่งข่าวต่างๆ ให้เป็นรูปแบบเดียวกัน
 *
 * รองรับ: Serper, GDELT, RSS, YouTube, Social media
 * รวม credibility score ของสำนักข่าวไทย
 */

import { randomUUID } from 'crypto';

// === ตาราง credibility ของสำนักข่าวไทย ===
/** @type {Record<string, {score: number, name: string, tier: string}>} */
export const SOURCE_AUTHORITY = {
  // Grade A (90+) — สำนักข่าวหลัก
  'thairath.co.th': { score: 95, name: 'ไทยรัฐ', tier: 'A' },
  'dailynews.co.th': { score: 92, name: 'เดลินิวส์', tier: 'A' },
  'matichon.co.th': { score: 93, name: 'มติชน', tier: 'A' },
  'bangkokpost.com': { score: 94, name: 'Bangkok Post', tier: 'A' },
  'nationtv.tv': { score: 90, name: 'Nation TV', tier: 'A' },
  'pptvhd36.com': { score: 90, name: 'PPTV', tier: 'A' },
  'thaipbs.or.th': { score: 95, name: 'Thai PBS', tier: 'A' },
  'mcot.net': { score: 90, name: 'MCOT', tier: 'A' },
  'khaosod.co.th': { score: 91, name: 'ข่าวสด', tier: 'A' },
  'bangkokbiznews.com': { score: 92, name: 'กรุงเทพธุรกิจ', tier: 'A' },

  // Grade B (75+) — เว็บข่าวรอง
  'sanook.com': { score: 80, name: 'Sanook', tier: 'B' },
  'kapook.com': { score: 78, name: 'Kapook', tier: 'B' },
  'mgronline.com': { score: 82, name: 'MGR Online', tier: 'B' },
  'workpointtoday.com': { score: 80, name: 'Workpoint', tier: 'B' },
  'amarintv.com': { score: 82, name: 'Amarin TV', tier: 'B' },
  'one31.net': { score: 78, name: 'One31', tier: 'B' },
  'ch3plus.com': { score: 80, name: 'CH3', tier: 'B' },
  'ch7.com': { score: 80, name: 'CH7', tier: 'B' },
  'tnn16.com': { score: 78, name: 'TNN', tier: 'B' },
  'springnews.co.th': { score: 78, name: 'Spring News', tier: 'B' },
  'thaipost.net': { score: 76, name: 'Thai Post', tier: 'B' },
  'komchadluek.net': { score: 80, name: 'คมชัดลึก', tier: 'B' },
  'brighttv.co.th': { score: 76, name: 'Bright TV', tier: 'B' },
  'thaiger.com': { score: 75, name: 'Thaiger', tier: 'B' },

  // Grade C (55+) — เว็บทั่วไป/บันเทิง
  'pantip.com': { score: 60, name: 'Pantip', tier: 'C' },
  'twitter.com': { score: 55, name: 'X/Twitter', tier: 'C' },
  'x.com': { score: 55, name: 'X', tier: 'C' },
  'facebook.com': { score: 50, name: 'Facebook', tier: 'C' },
  'youtube.com': { score: 60, name: 'YouTube', tier: 'C' },
  'tiktok.com': { score: 50, name: 'TikTok', tier: 'C' },
  'blockdit.com': { score: 55, name: 'Blockdit', tier: 'C' },

  // Grade D (30+) — ไม่รู้จัก
  '_default': { score: 40, name: 'Unknown', tier: 'D' },
};

// === Tracking params ที่ต้องลบ ===
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
  'msclkid', 'twclid', 'igshid', 'share_id',
]);

/**
 * ทำความสะอาด URL — ลบ tracking params, www, normalize
 *
 * @param {string} url - URL ดิบ
 * @returns {string} URL ที่ทำความสะอาดแล้ว
 *
 * @example
 * canonicalizeUrl('https://www.thairath.co.th/news/123?utm_source=fb&fbclid=abc')
 * // → 'https://thairath.co.th/news/123'
 */
export function canonicalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';

  try {
    const parsed = new URL(url.trim());

    // ลบ www. ออกจาก hostname
    parsed.hostname = parsed.hostname.replace(/^www\./, '');

    // lowercase domain
    parsed.hostname = parsed.hostname.toLowerCase();

    // ลบ tracking params
    const keysToDelete = [];
    parsed.searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => parsed.searchParams.delete(key));

    // ลบ trailing slash (เฉพาะ pathname ที่ไม่ใช่ root /)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    // ถ้าไม่เหลือ search params → ลบ ? ออก
    let result = parsed.toString();
    if (parsed.searchParams.toString() === '') {
      result = result.replace(/\?$/, '');
    }

    return result;
  } catch {
    // URL parse ไม่ได้ → คืนค่าเดิม
    console.warn('[sourceNormalizer] parse URL ล้มเหลว:', url.slice(0, 100));
    return url;
  }
}

/**
 * ดึง domain หลักจาก URL
 * @param {string} url - URL
 * @returns {string} domain เช่น 'thairath.co.th'
 */
function extractDomain(url) {
  if (!url) return '';
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return hostname;
  } catch {
    return '';
  }
}

/**
 * ค้นหา credibility score ของ domain
 *
 * @param {string} domain - domain เช่น 'thairath.co.th'
 * @returns {{score: number, name: string, tier: string}}
 *
 * @example
 * getSourceCredibilityScore('thairath.co.th')
 * // → { score: 95, name: 'ไทยรัฐ', tier: 'A' }
 *
 * getSourceCredibilityScore('unknown-blog.com')
 * // → { score: 40, name: 'Unknown', tier: 'D' }
 */
export function getSourceCredibilityScore(domain) {
  if (!domain || typeof domain !== 'string') {
    return { ...SOURCE_AUTHORITY['_default'] };
  }

  const cleaned = domain.replace(/^www\./, '').toLowerCase();

  // ค้นหาตรง
  if (SOURCE_AUTHORITY[cleaned]) {
    return { ...SOURCE_AUTHORITY[cleaned] };
  }

  // ค้นหา subdomain — เช่น news.sanook.com → ตรวจ sanook.com
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    // ลอง 2 ส่วนสุดท้าย (co.th, or.th = 3 ส่วน)
    const twoLevel = parts.slice(-2).join('.');
    const threeLevel = parts.slice(-3).join('.');

    if (SOURCE_AUTHORITY[threeLevel]) {
      return { ...SOURCE_AUTHORITY[threeLevel] };
    }
    if (SOURCE_AUTHORITY[twoLevel]) {
      return { ...SOURCE_AUTHORITY[twoLevel] };
    }
  }

  return { ...SOURCE_AUTHORITY['_default'] };
}

/**
 * แปลงข้อมูลดิบจากแหล่งข่าวต่างๆ ให้เป็นรูปแบบมาตรฐาน
 *
 * @param {Object} raw - ข้อมูลดิบจากแหล่งข่าว
 * @param {string} sourceName - ชื่อแหล่งที่มา: 'serper' | 'gdelt' | 'rss' | 'youtube' | 'social'
 * @returns {{
 *   id: string,
 *   title: string,
 *   summary: string,
 *   source: string,
 *   sourceDomain: string,
 *   url: string,
 *   publishedAt: string,
 *   author: string,
 *   imageUrl: string,
 *   matchedKeywords: string[],
 *   rawData: Object
 * }}
 *
 * @example
 * const article = normalizeArticle(serperResult, 'serper');
 */
export function normalizeArticle(raw, sourceName = 'unknown') {
  if (!raw || typeof raw !== 'object') {
    return createEmptyArticle(sourceName, raw);
  }

  // แต่ละ source มี field ต่างกัน → map เข้า schema เดียว
  const normalized = {
    id: raw.id || randomUUID(),
    title: extractField(raw, ['title', 'headline', 'name']) || '',
    summary: extractField(raw, ['snippet', 'summary', 'description', 'content', 'text']) || '',
    source: sourceName,
    sourceDomain: '',
    url: '',
    publishedAt: '',
    author: extractField(raw, ['author', 'creator', 'channel', 'username']) || '',
    imageUrl: extractField(raw, ['imageUrl', 'image', 'thumbnail', 'thumbnailUrl', 'img']) || '',
    matchedKeywords: raw.matchedKeywords || [],
    rawData: raw,
  };

  // URL — ทำความสะอาด
  const rawUrl = extractField(raw, ['link', 'url', 'href', 'sourceUrl']) || '';
  normalized.url = canonicalizeUrl(rawUrl);

  // Domain — ดึงจาก URL
  normalized.sourceDomain = raw.sourceDomain || raw.domain || extractDomain(rawUrl);

  // วันที่ — พยายาม parse เป็น ISO
  const rawDate = extractField(raw, ['date', 'publishedAt', 'pubDate', 'published', 'datePublished', 'createdAt']);
  normalized.publishedAt = parseDate(rawDate);

  return normalized;
}

/**
 * สร้าง article เปล่าสำหรับกรณีข้อมูลไม่ถูกต้อง
 * @param {string} sourceName - ชื่อแหล่งที่มา
 * @param {any} rawData - ข้อมูลดิบ
 * @returns {Object} article เปล่า
 */
function createEmptyArticle(sourceName, rawData) {
  return {
    id: randomUUID(),
    title: '',
    summary: '',
    source: sourceName,
    sourceDomain: '',
    url: '',
    publishedAt: '',
    author: '',
    imageUrl: '',
    matchedKeywords: [],
    rawData: rawData || {},
  };
}

/**
 * ดึงค่าจาก object โดยลอง field names หลายตัว
 * @param {Object} obj - object ที่จะดึงค่า
 * @param {string[]} fields - รายการ field names ที่จะลอง
 * @returns {string|undefined} ค่าที่พบ หรือ undefined
 */
function extractField(obj, fields) {
  for (const field of fields) {
    if (obj[field] !== undefined && obj[field] !== null && obj[field] !== '') {
      return String(obj[field]);
    }
  }
  return undefined;
}

/**
 * แปลงวันที่จากรูปแบบต่างๆ เป็น ISO string
 * @param {string|number|undefined} raw - วันที่ดิบ
 * @returns {string} ISO date string หรือ '' ถ้า parse ไม่ได้
 */
function parseDate(raw) {
  if (!raw) return '';

  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    return d.toISOString();
  } catch {
    return '';
  }
}
