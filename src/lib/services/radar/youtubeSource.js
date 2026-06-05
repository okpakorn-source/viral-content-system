/**
 * youtubeSource.js
 * ค้นหาวิดีโอข่าวไทยจาก YouTube ผ่าน Serper Videos endpoint
 * ใช้ SERPER_API_KEY เดิม ไม่ต้องมี YouTube Data API key
 */

import { normalizeArticle } from './sourceNormalizer.js';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

/**
 * ค้นหาวิดีโอจาก Serper Videos สำหรับ 1 query
 */
async function fetchYouTubeVideos(query, num = 5) {
  if (!SERPER_API_KEY) {
    console.warn('[YouTubeSource] ⚠️ SERPER_API_KEY ไม่ได้ตั้งค่า');
    return [];
  }

  try {
    const res = await fetch('https://google.serper.dev/videos', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: `${query} ข่าว`,
        gl: 'th',
        hl: 'th',
        num,
      }),
    });

    if (!res.ok) {
      console.warn(`[YouTubeSource] ❌ HTTP ${res.status} สำหรับ query: "${query}"`);
      return [];
    }

    const data = await res.json();
    const videos = data.videos || [];

    // Normalize วิดีโอเป็นรูปแบบบทความมาตรฐาน
    return videos
      .map(video => normalizeArticle(
        {
          title: video.title || '',
          url: video.link || '',
          snippet: video.snippet || video.description || '',
          date: video.date || '',
          imageUrl: video.imageUrl || video.thumbnail || null,
          channel: video.channel || '',
          duration: video.duration || '',
          sourceDomain: 'youtube.com',
        },
        'youtube'
      ))
      .filter(a => a && a.url && a.title);

  } catch (err) {
    console.warn(`[YouTubeSource] ❌ Error query "${query}":`, err.message);
    return [];
  }
}

/**
 * ค้นหาวิดีโอข่าวจาก YouTube
 * @param {string[]} queries - อาร์เรย์ของคำค้นหา
 * @param {Object} options - ตัวเลือก
 * @param {number} options.num - จำนวนผลลัพธ์ต่อ query (default: 5)
 * @returns {Promise<NormalizedArticle[]>} - อาร์เรย์ของวิดีโอที่ normalize แล้ว
 */
export async function searchYouTube(queries, options = {}) {
  const { num = 5 } = options;

  if (!Array.isArray(queries) || queries.length === 0) {
    console.warn('[YouTubeSource] ⚠️ ไม่มี queries ที่จะค้นหา');
    return [];
  }

  try {
    // เรียกค้นหาแบบ parallel
    const results = await Promise.allSettled(
      queries.map(q => fetchYouTubeVideos(q, num))
    );

    // รวมผลลัพธ์เป็น flat array
    const articles = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value || []);

    console.log(`[YouTubeSource] ✅ ค้นหา ${queries.length} queries → ได้ ${articles.length} วิดีโอ`);
    return articles;

  } catch (err) {
    console.error('[YouTubeSource] ❌ searchYouTube ล้มเหลว:', err.message);
    return [];
  }
}
