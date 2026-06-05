/**
 * socialSource.js
 * ค้นหาโพสต์จาก Social Media (Facebook, X/Twitter, TikTok)
 * ใช้ Serper Search endpoint พร้อม site: filter
 * ไม่ต้องใช้ API key ของแต่ละแพลตฟอร์ม
 */

import { normalizeArticle } from './sourceNormalizer.js';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// === กำหนดแพลตฟอร์ม Social Media ที่ค้นหา ===
const SOCIAL_PLATFORMS = [
  { name: 'facebook', siteFilter: 'site:facebook.com', num: 5, domain: 'facebook.com' },
  { name: 'twitter', siteFilter: 'site:x.com OR site:twitter.com', num: 5, domain: 'x.com' },
  { name: 'tiktok', siteFilter: 'site:tiktok.com', num: 5, domain: 'tiktok.com' },
];

/**
 * ค้นหาจาก Serper Search พร้อม site filter สำหรับ 1 แพลตฟอร์ม
 */
async function fetchSocialPlatform(query, platform) {
  if (!SERPER_API_KEY) {
    console.warn('[SocialSource] ⚠️ SERPER_API_KEY ไม่ได้ตั้งค่า');
    return [];
  }

  const searchQuery = `${query} ${platform.siteFilter}`;

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: searchQuery,
        gl: 'th',
        hl: 'th',
        num: platform.num,
      }),
    });

    if (!res.ok) {
      console.warn(`[SocialSource] ❌ HTTP ${res.status} สำหรับ ${platform.name}: "${query}"`);
      return [];
    }

    const data = await res.json();
    const results = data.organic || [];

    // Normalize แต่ละผลลัพธ์ — ใส่ sourceDomain ใน raw object
    return results
      .map(item => normalizeArticle(
        {
          title: item.title || '',
          url: item.link || '',
          snippet: item.snippet || '',
          date: item.date || '',
          sourceDomain: platform.domain,
        },
        `social-${platform.name}`
      ))
      .filter(a => a && a.url && a.title);

  } catch (err) {
    console.warn(`[SocialSource] ❌ Error ${platform.name} "${query}":`, err.message);
    return [];
  }
}

/**
 * ค้นหาโพสต์ Social Media จากหลายแพลตฟอร์ม
 * @param {string[]} queries - อาร์เรย์ของคำค้นหา
 * @param {Object} options - ตัวเลือก
 * @param {string[]} options.platforms - แพลตฟอร์มที่ต้องการ (default: ทั้งหมด)
 * @returns {Promise<NormalizedArticle[]>} - อาร์เรย์ของโพสต์ที่ normalize แล้ว
 */
export async function searchSocial(queries, options = {}) {
  const { platforms } = options;

  if (!Array.isArray(queries) || queries.length === 0) {
    console.warn('[SocialSource] ⚠️ ไม่มี queries ที่จะค้นหา');
    return [];
  }

  // เลือกแพลตฟอร์ม (ถ้าระบุ)
  const activePlatforms = platforms
    ? SOCIAL_PLATFORMS.filter(p => platforms.includes(p.name))
    : SOCIAL_PLATFORMS;

  try {
    // สร้าง tasks: ทุก query × ทุก platform
    const tasks = queries.flatMap(query =>
      activePlatforms.map(platform =>
        fetchSocialPlatform(query, platform)
      )
    );

    // เรียกทั้งหมดแบบ parallel
    const results = await Promise.allSettled(tasks);

    // รวมผลลัพธ์เป็น flat array
    const articles = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value || []);

    console.log(`[SocialSource] ✅ ค้นหา ${queries.length} queries × ${activePlatforms.length} platforms → ได้ ${articles.length} โพสต์`);
    return articles;

  } catch (err) {
    console.error('[SocialSource] ❌ searchSocial ล้มเหลว:', err.message);
    return [];
  }
}
