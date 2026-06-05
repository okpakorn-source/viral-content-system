/**
 * rssSource.js
 * ดึงข่าวจาก RSS Feed ของสำนักข่าวไทยหลัก 11 แห่ง
 * ใช้ regex parse XML (ไม่ต้องติดตั้ง parser ภายนอก)
 * Cache ผลลัพธ์ 15 นาที เพื่อลดภาระ network
 */

import { normalizeArticle } from './sourceNormalizer.js';

// === รายการ RSS Feed ของสำนักข่าวไทย ===
const RSS_FEEDS = [
  { name: 'ไทยรัฐ', url: 'https://www.thairath.co.th/rss', domain: 'thairath.co.th' },
  { name: 'ข่าวสด', url: 'https://www.khaosod.co.th/feed', domain: 'khaosod.co.th' },
  { name: 'มติชน', url: 'https://www.matichon.co.th/feed', domain: 'matichon.co.th' },
  { name: 'MGR', url: 'https://mgronline.com/rss/manager.xml', domain: 'mgronline.com' },
  { name: 'Sanook', url: 'https://www.sanook.com/rss/', domain: 'sanook.com' },
  { name: 'Kapook', url: 'https://www.kapook.com/feed', domain: 'kapook.com' },
  { name: 'PPTV', url: 'https://www.pptvhd36.com/rss', domain: 'pptvhd36.com' },
  { name: 'Workpoint', url: 'https://workpointtoday.com/feed/', domain: 'workpointtoday.com' },
  { name: 'Amarin', url: 'https://www.amarintv.com/feed/', domain: 'amarintv.com' },
  { name: 'Spring News', url: 'https://www.springnews.co.th/feed/', domain: 'springnews.co.th' },
  { name: 'เดลินิวส์', url: 'https://www.dailynews.co.th/rss', domain: 'dailynews.co.th' },
];

// === Cache: เก็บ RSS feed ไว้ 15 นาที ===
const rssCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 นาที

/**
 * Fetch RSS feed พร้อม timeout
 */
async function fetchFeed(feedUrl, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ViralRadar/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null; // timeout หรือ network error → ข้าม
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ลบ CDATA wrapper และ HTML tags ออกจากข้อความ
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')  // ลบ CDATA
    .replace(/<[^>]+>/g, '')                     // ลบ HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

/**
 * Parse RSS/Atom XML ด้วย regex (lightweight — ไม่ต้องใช้ xml parser)
 * ดึง <item> หรือ <entry> tags
 */
function parseRSSItems(xml) {
  const items = [];

  // จับ <item>...</item> หรือ <entry>...</entry>
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    // ดึง title
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = cleanText(titleMatch?.[1] || '');

    // ดึง link (รองรับหลายรูปแบบ)
    let link = '';
    const linkTagMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const linkHrefMatch = block.match(/<link[^>]*href=["']([^"']+)["']/i);
    const guidMatch = block.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/i);
    link = cleanText(linkTagMatch?.[1]) || linkHrefMatch?.[1] || guidMatch?.[1] || '';

    // ดึง pubDate
    const dateMatch = block.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i);
    const pubDate = cleanText(dateMatch?.[1] || '');

    // ดึง description
    const descMatch = block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i);
    const description = cleanText(descMatch?.[1] || '').slice(0, 300);

    if (title && link) {
      items.push({ title, link, pubDate, description });
    }
  }

  return items;
}

/**
 * ดึงข้อมูลจาก RSS Feed 1 แหล่ง พร้อม cache
 */
async function fetchAndParseFeed(feed) {
  const cacheKey = feed.url;
  const cached = rssCache.get(cacheKey);

  // ใช้ cache ถ้ายังไม่หมดอายุ
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.items;
  }

  const xml = await fetchFeed(feed.url);
  if (!xml) {
    console.warn(`[RSSSource] ⚠️ ดึง ${feed.name} ล้มเหลว — ข้าม`);
    return [];
  }

  const items = parseRSSItems(xml);

  // บันทึก cache
  rssCache.set(cacheKey, { items, timestamp: Date.now() });

  return items;
}

/**
 * ค้นหาข่าวจาก RSS Feed ตาม keyword
 * @param {string} keyword - คำค้นหา
 * @param {Object} options - ตัวเลือก
 * @param {string[]} options.feeds - รายชื่อ feed ที่ต้องการ (default: ทั้งหมด)
 * @param {number} options.maxPerFeed - จำนวนบทความสูงสุดต่อ feed (default: 10)
 * @returns {Promise<NormalizedArticle[]>} - อาร์เรย์ของบทความที่ normalize แล้ว
 */
export async function searchRSS(keyword, options = {}) {
  const { maxPerFeed = 10 } = options;

  if (!keyword || typeof keyword !== 'string') {
    console.warn('[RSSSource] ⚠️ ไม่มี keyword ที่จะค้นหา');
    return [];
  }

  const keywordLower = keyword.toLowerCase();

  try {
    // ดึง RSS feed ทั้งหมดแบบ parallel
    const feedResults = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        const items = await fetchAndParseFeed(feed);

        // กรองเฉพาะ item ที่ตรงกับ keyword
        const matched = items
          .filter(item => {
            const text = `${item.title} ${item.description}`.toLowerCase();
            return text.includes(keywordLower);
          })
          .slice(0, maxPerFeed);

        // Normalize แต่ละ item — ใส่ sourceDomain ใน raw object
        return matched.map(item =>
          normalizeArticle(
            {
              title: item.title,
              url: item.link,
              date: item.pubDate,
              description: item.description,
              sourceDomain: feed.domain,
            },
            `rss-${feed.name}`
          )
        ).filter(a => a && a.url && a.title);
      })
    );

    // รวมผลลัพธ์จากทุก feed
    const articles = feedResults
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value || []);

    const failedCount = feedResults.filter(r => r.status === 'rejected').length;
    if (failedCount > 0) {
      console.warn(`[RSSSource] ⚠️ ${failedCount}/${RSS_FEEDS.length} feeds ล้มเหลว`);
    }

    console.log(`[RSSSource] ✅ ค้นหา "${keyword}" → ได้ ${articles.length} บทความจาก ${RSS_FEEDS.length} feeds`);
    return articles;

  } catch (err) {
    console.error('[RSSSource] ❌ searchRSS ล้มเหลว:', err.message);
    return [];
  }
}
