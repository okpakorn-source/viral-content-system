/**
 * Tavily Search Provider — AI-powered search
 * เสริม Serper: ค้นเชิงวิจัย + สรุปเนื้อหาอัตโนมัติ
 * 
 * ใช้สำหรับ:
 * - ค้นข้อมูลเชิงลึกเกี่ยวกับข่าว (research-grade)
 * - หาบริบทข่าวเพิ่มเติม (background context)
 * - ค้นภาพที่ Serper หาไม่เจอ
 */

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_API_URL = 'https://api.tavily.com';

/**
 * ค้นข้อมูลเชิงวิจัย — ได้ทั้งลิงก์ + สรุปเนื้อหา
 * @param {string} query — คำค้น
 * @param {object} options
 * @returns {{ results: Array<{title, url, content, score}>, answer: string }}
 */
export async function tavilySearch(query, options = {}) {
  if (!TAVILY_API_KEY) {
    console.log('[Tavily] ⚠️ TAVILY_API_KEY not set — skipping');
    return { results: [], answer: '' };
  }

  const {
    searchDepth = 'basic',     // 'basic' (เร็ว) | 'advanced' (ละเอียด)
    maxResults = 5,
    includeAnswer = true,
    includeImages = false,
    topic = 'news',            // 'general' | 'news'
  } = options;

  try {
    console.log(`[Tavily] 🔍 Searching: "${query}" (depth: ${searchDepth})`);

    const res = await fetch(`${TAVILY_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: includeAnswer,
        include_images: includeImages,
        topic,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.log(`[Tavily] ❌ HTTP ${res.status}: ${errText.substring(0, 100)}`);
      return { results: [], answer: '' };
    }

    const data = await res.json();
    
    console.log(`[Tavily] ✅ Got ${data.results?.length || 0} results`);
    if (data.answer) {
      console.log(`[Tavily] 📝 AI Answer: ${data.answer.substring(0, 100)}...`);
    }

    return {
      results: (data.results || []).map(r => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        score: r.score || 0,
      })),
      answer: data.answer || '',
      images: data.images || [],
    };
  } catch (err) {
    console.error(`[Tavily] ❌ Error: ${err.message}`);
    return { results: [], answer: '' };
  }
}

/**
 * ค้นภาพ AI-powered — ได้ภาพที่เกี่ยวข้องกับ query + context
 * @param {string} query
 * @returns {string[]} — array of image URLs
 */
export async function tavilyImageSearch(query) {
  if (!TAVILY_API_KEY) return [];

  try {
    console.log(`[Tavily] 🖼️ Image search: "${query}"`);

    const res = await fetch(`${TAVILY_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
        include_images: true,
        topic: 'general',
      }),
    });

    if (!res.ok) return [];

    const data = await res.json();
    const images = data.images || [];
    
    console.log(`[Tavily] ✅ Found ${images.length} images`);
    return images;
  } catch (err) {
    console.log(`[Tavily] ❌ Image search error: ${err.message}`);
    return [];
  }
}

/**
 * ค้นบริบทข่าว — ใช้สำหรับ StoryIdentity enrichment
 * ดึงข้อมูลเพิ่มเติมเกี่ยวกับคน/สถานที่/เหตุการณ์ในข่าว
 */
export async function tavilyResearchContext(newsTitle, mainCharacter) {
  if (!TAVILY_API_KEY) return null;

  try {
    const query = `${mainCharacter} ${newsTitle}`.slice(0, 200);
    
    const result = await tavilySearch(query, {
      searchDepth: 'advanced',
      maxResults: 3,
      includeAnswer: true,
      topic: 'news',
    });

    if (result.answer) {
      return {
        summary: result.answer,
        sources: result.results.map(r => ({ title: r.title, url: r.url })),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function isTavilyAvailable() {
  return Boolean(TAVILY_API_KEY);
}
