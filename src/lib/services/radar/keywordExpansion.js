/**
 * keywordExpansion.js — ขยาย keyword เดียวเป็น 8-15 search queries
 *
 * ใช้ AI (gpt-4o-mini) + Serper autocomplete แล้ว merge/deduplicate
 * มี cache 10 นาทีเพื่อลดการเรียก API ซ้ำ
 */

import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

// === Cache แบบ Map + TTL 10 นาที ===
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

/**
 * ดึงข้อมูลจาก cache ถ้ายังไม่หมดอายุ
 * @param {string} key - cache key
 * @returns {any|null} ข้อมูลที่ cache ไว้ หรือ null ถ้าหมดอายุ/ไม่มี
 */
function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * บันทึกข้อมูลลง cache
 * @param {string} key - cache key
 * @param {any} data - ข้อมูลที่จะ cache
 */
function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * เรียก AI เพื่อขยาย keyword เป็น search queries หลายรูปแบบ
 * @param {string} keyword - คำค้นหาต้นฉบับ
 * @returns {Promise<Array<{query: string, type: string}>>} รายการ queries จาก AI
 */
async function expandWithAI(keyword) {
  try {
    const prompt = `จากคำค้นหา "${keyword}" ให้สร้าง search queries เพื่อค้นหาข่าวที่เกี่ยวข้อง

สร้าง queries ตามหมวดหมู่เหล่านี้:
1. ชื่อจริง (fullname) — ชื่อ-นามสกุลเต็ม ถ้าเป็นคนดัง
2. ชื่อเล่น (nickname) — ชื่อเรียกทั่วไป
3. ชื่ออังกฤษ (english) — ชื่อภาษาอังกฤษ (ถ้ามี)
4. ชื่อสะกดผิด (misspelling) — การสะกดผิดที่พบบ่อย
5. keyword + ล่าสุด (trending)
6. keyword + ดราม่า (drama)
7. keyword + ครอบครัว (family)
8. keyword + เปิดใจ (interview)
9. keyword + hashtag (hashtag)
10. keyword + บริจาค/ช่วยเหลือ (charity)

ตอบเป็น JSON: { "queries": [{ "query": "...", "type": "fullname|nickname|english|misspelling|trending|drama|family|interview|hashtag|charity" }] }
สร้าง 8-15 queries ที่สมเหตุสมผล ถ้าหมวดไหนไม่เกี่ยวข้องให้ข้ามไป`;

    const result = await callAI({
      prompt,
      model: MODEL_FAST,
      temperature: 0.3,
      maxTokens: 1500,
    });

    if (result?.queries && Array.isArray(result.queries)) {
      return result.queries;
    }

    console.warn('[keywordExpansion] AI ตอบกลับรูปแบบไม่ตรง:', JSON.stringify(result).slice(0, 200));
    return [];
  } catch (err) {
    console.error('[keywordExpansion] AI expansion ล้มเหลว:', err.message);
    return [];
  }
}

/**
 * เรียก Serper autocomplete เพื่อดู trending suggestions
 * @param {string} keyword - คำค้นหา
 * @returns {Promise<Array<{query: string, type: string}>>} รายการ suggestions จาก Serper
 */
async function expandWithSerper(keyword) {
  try {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      console.warn('[keywordExpansion] SERPER_API_KEY ไม่ได้ตั้งค่า — ข้าม autocomplete');
      return [];
    }

    const response = await fetch('https://google.serper.dev/autocomplete', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: keyword }),
    });

    if (!response.ok) {
      console.warn(`[keywordExpansion] Serper autocomplete ผิดพลาด: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const suggestions = data.suggestions || [];

    return suggestions.map((s) => ({
      query: typeof s === 'string' ? s : s.value || s.query || '',
      type: 'autocomplete',
    })).filter((s) => s.query);
  } catch (err) {
    console.error('[keywordExpansion] Serper autocomplete ล้มเหลว:', err.message);
    return [];
  }
}

/**
 * ขยาย keyword เดียวเป็น search queries หลายรูปแบบ
 *
 * รวมผลจาก AI + Serper autocomplete แล้ว deduplicate
 * Cache ผลลัพธ์ 10 นาที
 *
 * @param {string} keyword - คำค้นหาต้นฉบับ
 * @returns {Promise<Array<{query: string, type: string, enabled: boolean}>>}
 *
 * @example
 * const queries = await expandKeywords('เอวา');
 * // [
 * //   { query: 'เอวา', type: 'original', enabled: true },
 * //   { query: 'เอวา ปวรวรรณ', type: 'fullname', enabled: true },
 * //   { query: 'Eva Pavornwan', type: 'english', enabled: true },
 * //   { query: 'เอวา ล่าสุด', type: 'trending', enabled: true },
 * //   ...
 * // ]
 */
export async function expandKeywords(keyword) {
  if (!keyword || typeof keyword !== 'string') {
    console.warn('[keywordExpansion] keyword ว่างเปล่าหรือไม่ใช่ string');
    return [];
  }

  const trimmed = keyword.trim();
  if (!trimmed) return [];

  // ตรวจ cache ก่อน
  const cached = getCached(trimmed);
  if (cached) {
    console.log(`[keywordExpansion] ใช้ cache สำหรับ "${trimmed}"`);
    return cached;
  }

  // เริ่มจาก original keyword
  const original = { query: trimmed, type: 'original' };

  // เรียก AI + Serper พร้อมกัน
  const [aiQueries, serperQueries] = await Promise.all([
    expandWithAI(trimmed),
    expandWithSerper(trimmed),
  ]);

  // รวม + deduplicate ด้วย Set ของ query ที่ lowercase + trim
  const seen = new Set();
  const merged = [];

  const addUnique = (item) => {
    const normalized = item.query.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push({
      query: item.query.trim(),
      type: item.type || 'unknown',
      enabled: true,
    });
  };

  // ใส่ original ก่อน → AI → Serper
  addUnique(original);
  aiQueries.forEach(addUnique);
  serperQueries.forEach(addUnique);

  // บันทึก cache
  setCache(trimmed, merged);

  console.log(`[keywordExpansion] "${trimmed}" → ${merged.length} queries (AI: ${aiQueries.length}, Serper: ${serperQueries.length})`);
  return merged;
}
