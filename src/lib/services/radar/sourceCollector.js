/**
 * sourceCollector.js
 * ตัว Orchestrator รวมผลลัพธ์จากทุกแหล่งข่าว
 * เรียก 5 sources แบบ parallel → รวม → กรองคุณภาพ → ส่งคืน
 * ถ้า source ใดล้มเหลว จะไม่กระทบ source อื่น
 */

import { searchSerper } from './serperSource.js';
import { searchGDELT } from './gdeltSource.js';
import { searchRSS } from './rssSource.js';
import { searchYouTube } from './youtubeSource.js';
import { searchSocial } from './socialSource.js';
import { searchTavily } from './tavilySource.js';

// === แหล่งข่าวทั้งหมดที่รองรับ ===
const SOURCE_MAP = {
  serper: searchSerper,
  gdelt: searchGDELT,
  rss: searchRSS,
  youtube: searchYouTube,
  social: searchSocial,
  tavily: searchTavily,
};

// === ค่า default สำหรับ sources ที่เปิดใช้ ===
const DEFAULT_SOURCES = ['serper', 'gdelt', 'rss', 'youtube', 'social', 'tavily'];
const MIN_TITLE_LENGTH = 10;

/**
 * กรองบทความที่ไม่มีคุณภาพออก
 * - ต้องมี url
 * - ต้องมี title ที่ยาว >= 10 ตัวอักษร
 * - ลบ duplicate URL
 */
function qualityFilter(articles) {
  const seenUrls = new Set();
  const filtered = [];
  let removedCount = 0;

  for (const article of articles) {
    // ตรวจสอบว่ามี url และ title
    if (!article.url || !article.title) {
      removedCount++;
      continue;
    }

    // ตรวจสอบ title ยาวเพียงพอ
    if (article.title.length < MIN_TITLE_LENGTH) {
      removedCount++;
      continue;
    }

    // ตรวจสอบ URL ซ้ำ
    if (seenUrls.has(article.url)) {
      removedCount++;
      continue;
    }

    seenUrls.add(article.url);
    filtered.push(article);
  }

  return { filtered, removedCount };
}

/**
 * รวบรวมข่าวจากทุกแหล่ง
 * @param {string[]} expandedQueries - อาร์เรย์ของคำค้นหาที่ขยายแล้ว
 * @param {Object} options - ตัวเลือก
 * @param {string[]} options.sources - แหล่งที่เปิดใช้ (default: ทั้ง 5 แหล่ง)
 * @param {string} options.timeRange - ช่วงเวลา (default: '24h')
 * @returns {Promise<{articles: NormalizedArticle[], meta: Object}>}
 */
export async function collectFromAllSources(expandedQueries, options = {}) {
  const {
    sources = DEFAULT_SOURCES,
    timeRange = '24h',
  } = options;

  // กรองเฉพาะ sources ที่เปิดใช้และมีอยู่จริง
  const activeSources = sources.filter(s => SOURCE_MAP[s]);
  const perSource = {};
  const startTime = Date.now();

  // === แปลง expandedQueries เป็น string array (รองรับทั้ง object และ string) ===
  const queryStrings = expandedQueries.map(q => {
    if (typeof q === 'string') return q;
    if (typeof q === 'object' && q.query) return q.query;
    return String(q);
  }).filter(q => q && q.length > 0 && q !== '[object Object]');

  // หา keyword หลัก (original query) สำหรับ RSS
  const primaryKeyword = expandedQueries.find(q => 
    (typeof q === 'object' && q.type === 'original') 
  )?.query || queryStrings[0] || '';

  console.log(`[SourceCollector] 🚀 เริ่มรวบรวมจาก ${activeSources.length} แหล่ง: [${activeSources.join(', ')}]`);
  console.log(`[SourceCollector] 📝 queries: ${queryStrings.length} คำ (primary: "${primaryKeyword}")`);

  // === สร้าง tasks สำหรับแต่ละ source ===
  const tasks = activeSources.map(async (sourceName) => {
    const searchFn = SOURCE_MAP[sourceName];

    try {
      let results;

      // RSS ใช้ keyword หลัก
      if (sourceName === 'rss') {
        results = await searchFn(primaryKeyword, { timeRange });
      } else {
        // Serper, GDELT, YouTube, Social — ส่ง string array
        results = await searchFn(queryStrings, { timeRange });
      }

      perSource[sourceName] = results.length;
      return { sourceName, articles: results };

    } catch (err) {
      console.warn(`[SourceCollector] ⚠️ ${sourceName} ล้มเหลว:`, err.message);
      perSource[sourceName] = 0;
      return { sourceName, articles: [] };
    }
  });

  // === เรียกทุก source แบบ parallel ===
  const results = await Promise.allSettled(tasks);

  // รวมผลลัพธ์จากทุก source
  const allArticles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value?.articles || []);

  // === กรองคุณภาพ ===
  const { filtered, removedCount } = qualityFilter(allArticles);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // === Log สรุป ===
  console.log(`[SourceCollector] ────────────────────────`);
  console.log(`[SourceCollector] 📊 สรุปผลลัพธ์:`);
  for (const [src, count] of Object.entries(perSource)) {
    console.log(`[SourceCollector]   ${src}: ${count} บทความ`);
  }
  console.log(`[SourceCollector]   รวมทั้งหมด: ${allArticles.length}`);
  console.log(`[SourceCollector]   กรองออก: ${removedCount} (url/title ไม่ครบ หรือซ้ำ)`);
  console.log(`[SourceCollector]   ✅ ผ่านคุณภาพ: ${filtered.length} บทความ`);
  console.log(`[SourceCollector]   ⏱ ใช้เวลา: ${elapsed}s`);
  console.log(`[SourceCollector] ────────────────────────`);

  return {
    articles: filtered,
    meta: {
      perSource,
      total: allArticles.length,
      filtered: filtered.length,
      removed: removedCount,
      sources: activeSources,
      queryCount: expandedQueries.length,
      elapsedSeconds: parseFloat(elapsed),
      collectedAt: new Date().toISOString(),
    },
  };
}
