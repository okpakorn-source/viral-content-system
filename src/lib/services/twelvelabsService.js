/**
 * Twelve Labs Video Understanding Service
 * เสริม YouTube API: ค้นหาฉาก/คน/เฟรมสำคัญในวิดีโอ
 * 
 * ใช้สำหรับ:
 * - ค้นหาฉากเฉพาะในวิดีโอข่าว (เช่น "ฉากร้องไห้", "ฉากมอบเงิน")
 * - หาเฟรมที่เห็นหน้าคนชัดจากวิดีโอ
 * - วิเคราะห์เนื้อหาวิดีโอ
 */

const TWELVELABS_API_KEY = process.env.TWELVELABS_API_KEY;
const TWELVELABS_API_URL = 'https://api.twelvelabs.io/v1.3';

/**
 * สร้าง index สำหรับเก็บวิดีโอ (ต้องทำครั้งแรก)
 */
export async function createIndex(name = 'news-covers') {
  if (!TWELVELABS_API_KEY) return null;

  try {
    const res = await fetch(`${TWELVELABS_API_URL}/indexes`, {
      method: 'POST',
      headers: {
        'x-api-key': TWELVELABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        index_name: name,
        engines: [
          { engine_name: 'marengo2.7', engine_options: ['visual', 'conversation', 'text_in_video'] }
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.log(`[TwelveLabs] ❌ Create index failed: ${err.substring(0, 100)}`);
      return null;
    }

    const data = await res.json();
    console.log(`[TwelveLabs] ✅ Index created: ${data._id}`);
    return data._id;
  } catch (err) {
    console.error(`[TwelveLabs] ❌ Error: ${err.message}`);
    return null;
  }
}

/**
 * ส่งวิดีโอ URL เข้า index (จะถูก process แบบ async)
 */
export async function indexVideoByUrl(indexId, videoUrl) {
  if (!TWELVELABS_API_KEY || !indexId) return null;

  try {
    console.log(`[TwelveLabs] 📤 Indexing video: ${videoUrl.substring(0, 80)}`);

    const res = await fetch(`${TWELVELABS_API_URL}/tasks`, {
      method: 'POST',
      headers: {
        'x-api-key': TWELVELABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        index_id: indexId,
        url: videoUrl,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.log(`[TwelveLabs] ❌ Index video failed: ${err.substring(0, 100)}`);
      return null;
    }

    const data = await res.json();
    console.log(`[TwelveLabs] ✅ Task created: ${data._id}`);
    return data._id;
  } catch (err) {
    console.error(`[TwelveLabs] ❌ Error: ${err.message}`);
    return null;
  }
}

/**
 * ค้นหาฉากในวิดีโอ — ★ ฟีเจอร์หลัก!
 * เช่น: "ฉากที่คนร้องไห้", "ฉากที่ถือป้าย", "closeup face"
 * @param {string} indexId — index ที่มีวิดีโออยู่
 * @param {string} query — คำค้น (ภาษาอังกฤษหรือไทย)
 * @param {object} options
 * @returns {Array<{ videoId, start, end, confidence, thumbnailUrl }>}
 */
export async function searchScenes(indexId, query, options = {}) {
  if (!TWELVELABS_API_KEY || !indexId) return [];

  const { searchOptions = ['visual', 'conversation'], threshold = 'medium' } = options;

  try {
    console.log(`[TwelveLabs] 🔍 Searching scenes: "${query}"`);

    const res = await fetch(`${TWELVELABS_API_URL}/search`, {
      method: 'POST',
      headers: {
        'x-api-key': TWELVELABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        index_id: indexId,
        query_text: query,
        search_options: searchOptions,
        threshold,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.log(`[TwelveLabs] ❌ Search failed: ${err.substring(0, 100)}`);
      return [];
    }

    const data = await res.json();
    const results = (data.data || []).map(item => ({
      videoId: item.video_id,
      start: item.start,
      end: item.end,
      confidence: item.confidence,
      thumbnailUrl: item.thumbnail_url || '',
      metadata: item.metadata || {},
    }));

    console.log(`[TwelveLabs] ✅ Found ${results.length} scenes`);
    return results;
  } catch (err) {
    console.error(`[TwelveLabs] ❌ Error: ${err.message}`);
    return [];
  }
}

/**
 * ดึง thumbnail จากฉากเฉพาะ — ใช้ทำปกข่าว
 * @param {string} videoId
 * @param {number} time — timestamp in seconds
 * @returns {string|null} — thumbnail URL
 */
export async function getFrameThumbnail(videoId, time) {
  if (!TWELVELABS_API_KEY || !videoId) return null;

  try {
    const res = await fetch(`${TWELVELABS_API_URL}/videos/${videoId}/thumbnail?time=${time}`, {
      headers: { 'x-api-key': TWELVELABS_API_KEY },
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.thumbnail || null;
  } catch {
    return null;
  }
}

/**
 * Quick search — ค้นฉากสำคัญจากวิดีโอสำหรับ Cover Pipeline
 * ★ ฟังก์ชันนี้ใช้ใน multiAgentImageScraper (Agent 2 YouTube เสริม)
 */
export async function findKeyFramesForCover(indexId, newsTitle, mainCharacter) {
  if (!TWELVELABS_API_KEY || !indexId) return [];

  const queries = [
    `${mainCharacter} closeup face`,
    `${mainCharacter} emotional moment`,
    newsTitle.substring(0, 50),
  ].filter(q => q.trim());

  const allFrames = [];
  
  for (const query of queries) {
    const scenes = await searchScenes(indexId, query, { threshold: 'low' });
    for (const scene of scenes.slice(0, 2)) {
      if (scene.thumbnailUrl) {
        allFrames.push({
          url: scene.thumbnailUrl,
          source: 'twelvelabs',
          confidence: scene.confidence,
          timestamp: scene.start,
        });
      }
    }
  }

  console.log(`[TwelveLabs] 🎬 Found ${allFrames.length} key frames for cover`);
  return allFrames;
}

export function isTwelveLabsAvailable() {
  return Boolean(TWELVELABS_API_KEY);
}
