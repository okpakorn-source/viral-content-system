/**
 * tavilySource.js
 * ค้นหาข่าวผ่าน Tavily AI Search API
 * รองรับ: news search (AI-powered)
 * ใช้เป็น source เสริมสำหรับ radar system
 */

import { tavilySearch, isTavilyAvailable } from '@/lib/services/tavilyService';
import { normalizeArticle } from './sourceNormalizer.js';

/**
 * ค้นหาข่าวจาก Tavily AI Search
 * @param {string[]} queries - อาร์เรย์ของคำค้นหา
 * @param {Object} options - ตัวเลือก
 * @param {number} options.num - จำนวนผลลัพธ์ต่อ query (default: 5)
 * @param {string} options.timeRange - ช่วงเวลา (default: '24h')
 * @returns {Promise<NormalizedArticle[]>} - อาร์เรย์ของบทความที่ normalize แล้ว
 */
export async function searchTavily(queries, options = {}) {
  const { num = 5 } = options;

  if (!isTavilyAvailable()) {
    console.warn('[TavilySource] ⚠️ TAVILY_API_KEY ไม่ได้ตั้งค่า — ข้ามการค้นหา');
    return [];
  }

  if (!Array.isArray(queries) || queries.length === 0) {
    console.warn('[TavilySource] ⚠️ ไม่มี queries ที่จะค้นหา');
    return [];
  }

  try {
    console.log(`[TavilySource] 🔍 เริ่มค้นหา ${queries.length} queries...`);

    // ค้นหาแต่ละ query ผ่าน Tavily API
    const tasks = queries.map(async (query) => {
      try {
        const { results } = await tavilySearch(query, {
          topic: 'news',
          maxResults: num,
          searchDepth: 'basic',
          includeAnswer: false,
        });

        // แปลง Tavily results → normalizeArticle format
        // Tavily returns: { title, url, content, score }
        // normalizeArticle expects fields like: title, link, snippet, date
        return results.map(r => normalizeArticle({
          title: r.title || '',
          link: r.url || '',
          snippet: r.content || '',
          publishedAt: r.publishedDate || '',
          sourceType: 'tavily',
        }, 'tavily'));
      } catch (err) {
        console.warn(`[TavilySource] ⚠️ Error query "${query}":`, err.message);
        return [];
      }
    });

    const results = await Promise.allSettled(tasks);

    // รวมผลลัพธ์เป็น flat array
    const articles = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value || [])
      .filter(a => a && a.url && a.title);

    console.log(`[TavilySource] ✅ ค้นหา ${queries.length} queries → ได้ ${articles.length} บทความ`);
    return articles;

  } catch (err) {
    console.error('[TavilySource] ❌ searchTavily ล้มเหลว:', err.message);
    return [];
  }
}
