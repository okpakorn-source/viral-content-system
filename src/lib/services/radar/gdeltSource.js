/**
 * gdeltSource.js
 * ค้นหาข่าวจาก GDELT DOC 2.0 API (ฟรี ไม่ต้องใช้ API key)
 * เหมาะสำหรับข่าวต่างประเทศและข่าวที่ถูกรายงานในสื่อไทย
 * Timeout: 10 วินาที (GDELT อาจช้า)
 */

import { normalizeArticle } from './sourceNormalizer.js';

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

/**
 * Fetch พร้อม timeout (GDELT อาจตอบช้ามาก)
 */
async function fetchWithTimeout(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ค้นหาข่าวจาก GDELT สำหรับ 1 query
 */
async function fetchGDELT(query, timespan = '24h', maxRecords = 50) {
  // เข้ารหัส query สำหรับ URL
  const encodedQuery = encodeURIComponent(query);
  const url = `${GDELT_BASE}?query=${encodedQuery}&mode=artlist&maxrecords=${maxRecords}&format=json&sourcelang=tha&timespan=${timespan}`;

  try {
    const res = await fetchWithTimeout(url, 10_000);

    if (!res.ok) {
      console.warn(`[GDELTSource] ❌ HTTP ${res.status} สำหรับ query: "${query}"`);
      return [];
    }

    const data = await res.json();
    const articles = data.articles || [];

    // Normalize แต่ละบทความจาก GDELT format
    return articles
      .map(item => normalizeArticle(
        {
          title: item.title || '',
          url: item.url || '',
          date: item.seendate || '',
          sourceDomain: item.domain || '',
          snippet: item.title || '', // GDELT ไม่มี snippet → ใช้ title แทน
          language: item.language || 'Thai',
          sourcecountry: item.sourcecountry || '',
        },
        'gdelt'
      ))
      .filter(a => a && a.url && a.title);

  } catch (err) {
    // จัดการ timeout แยกต่างหาก
    if (err.name === 'AbortError') {
      console.warn(`[GDELTSource] ⏰ Timeout (10s) สำหรับ query: "${query}"`);
    } else {
      console.warn(`[GDELTSource] ❌ Error query "${query}":`, err.message);
    }
    return [];
  }
}

/**
 * ค้นหาข่าวจาก GDELT DOC 2.0 API
 * @param {string[]} queries - อาร์เรย์ของคำค้นหา
 * @param {Object} options - ตัวเลือก
 * @param {string} options.timespan - ช่วงเวลา (default: '24h')
 * @param {number} options.maxRecords - จำนวนผลลัพธ์สูงสุดต่อ query (default: 50)
 * @returns {Promise<NormalizedArticle[]>} - อาร์เรย์ของบทความที่ normalize แล้ว
 */
export async function searchGDELT(queries, options = {}) {
  const { timespan = '24h', maxRecords = 50 } = options;

  if (!Array.isArray(queries) || queries.length === 0) {
    console.warn('[GDELTSource] ⚠️ ไม่มี queries ที่จะค้นหา');
    return [];
  }

  try {
    // เรียก GDELT แบบ parallel สำหรับทุก queries
    const results = await Promise.allSettled(
      queries.map(q => fetchGDELT(q, timespan, maxRecords))
    );

    // รวมผลลัพธ์เป็น flat array
    const articles = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value || []);

    console.log(`[GDELTSource] ✅ ค้นหา ${queries.length} queries → ได้ ${articles.length} บทความ`);
    return articles;

  } catch (err) {
    console.error('[GDELTSource] ❌ searchGDELT ล้มเหลว:', err.message);
    return [];
  }
}
