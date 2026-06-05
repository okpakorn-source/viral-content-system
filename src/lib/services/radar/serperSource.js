/**
 * serperSource.js
 * ค้นหาข่าวผ่าน Serper API (Google Search)
 * รองรับ: news, search, images, videos
 * มี rate limiter (สูงสุด 10 req/นาที) + concurrency pool (สูงสุด 5 พร้อมกัน)
 */

import { normalizeArticle } from './sourceNormalizer.js';

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_BASE = 'https://google.serper.dev';

// === Rate Limiter: สูงสุด 10 requests ต่อนาที ===
const rateLimiter = {
  timestamps: [],
  maxRequests: 10,
  windowMs: 60_000,

  /** ตรวจสอบและรอถ้าเกิน rate limit */
  async waitIfNeeded() {
    const now = Date.now();
    // ลบ timestamp ที่เก่ากว่า 1 นาที
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldestInWindow = this.timestamps[0];
      const waitTime = this.windowMs - (now - oldestInWindow) + 100;
      console.log(`[SerperSource] ⏳ Rate limit — รอ ${Math.ceil(waitTime / 1000)}s`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.timestamps.push(Date.now());
  },
};

/**
 * Promise Pool: รัน promises พร้อมกันสูงสุด N ตัว
 */
async function promisePool(tasks, maxConcurrent = 5) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task().then(result => {
      executing.delete(p);
      return result;
    });
    executing.add(p);
    results.push(p);

    if (executing.size >= maxConcurrent) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

/**
 * เรียก Serper API สำหรับ 1 query
 */
async function fetchSerper(query, type = 'news', num = 10) {
  if (!SERPER_API_KEY) {
    console.warn('[SerperSource] ⚠️ SERPER_API_KEY ไม่ได้ตั้งค่า');
    return [];
  }

  await rateLimiter.waitIfNeeded();

  const body = {
    q: query,
    gl: 'th',
    hl: 'th',
    num,
  };

  // สำหรับ news type → เพิ่ม tbs เพื่อจำกัดช่วงเวลา
  if (type === 'news') {
    body.tbs = 'qdr:d';
  }

  try {
    const res = await fetch(`${SERPER_BASE}/${type}`, {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn(`[SerperSource] ❌ HTTP ${res.status} สำหรับ query: "${query}" (${type})`);
      return [];
    }

    const data = await res.json();

    // ดึงผลลัพธ์ตาม type ที่แตกต่างกัน
    let rawItems = [];
    if (type === 'news') {
      rawItems = data.news || [];
    } else if (type === 'search') {
      rawItems = [...(data.organic || []), ...(data.topStories || [])];
    } else if (type === 'images') {
      rawItems = data.images || [];
    } else if (type === 'videos') {
      rawItems = data.videos || [];
    }

    // Normalize แต่ละรายการ — ใช้ type เป็น sourceName เพื่อแยก news/search/images/videos
    return rawItems
      .map(item => normalizeArticle(item, `serper-${type}`))
      .filter(a => a && a.url && a.title);

  } catch (err) {
    console.warn(`[SerperSource] ❌ Error query "${query}":`, err.message);
    return [];
  }
}

/**
 * ค้นหาข่าวจาก Serper API
 * @param {string[]} queries - อาร์เรย์ของคำค้นหา
 * @param {Object} options - ตัวเลือก
 * @param {number} options.num - จำนวนผลลัพธ์ต่อ query (default: 10)
 * @param {string} options.timeRange - ช่วงเวลา (default: '24h')
 * @param {'news'|'search'|'images'|'videos'} options.type - ประเภทการค้นหา (default: 'news')
 * @returns {Promise<NormalizedArticle[]>} - อาร์เรย์ของบทความที่ normalize แล้ว
 */
export async function searchSerper(queries, options = {}) {
  const { num = 10, type = 'news' } = options;

  if (!Array.isArray(queries) || queries.length === 0) {
    console.warn('[SerperSource] ⚠️ ไม่มี queries ที่จะค้นหา');
    return [];
  }

  try {
    // สร้าง task functions สำหรับแต่ละ query
    const tasks = queries.map(q => () => fetchSerper(q, type, num));

    // รัน parallel สูงสุด 5 ตัวพร้อมกัน
    const results = await promisePool(tasks, 5);

    // รวมผลลัพธ์เป็น flat array
    const articles = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value || []);

    console.log(`[SerperSource] ✅ ค้นหา ${queries.length} queries → ได้ ${articles.length} บทความ (${type})`);
    return articles;

  } catch (err) {
    console.error('[SerperSource] ❌ searchSerper ล้มเหลว:', err.message);
    return [];
  }
}
