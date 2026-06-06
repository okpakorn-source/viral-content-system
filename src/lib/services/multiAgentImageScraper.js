import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';

// ==========================================
// Helper: Fetch with timeout
// ==========================================
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
};

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 10000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
    signal: controller.signal,
    redirect: 'follow'
  });
  clearTimeout(id);
  return response;
}

// ==========================================
// Helper: Compute blur score (Laplacian variance)
// Higher value = sharper image
// ==========================================
async function computeBlurScore(buffer) {
  try {
    const { data, info } = await sharp(buffer)
      .resize(100, 100, { fit: 'cover' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sum = 0;
    for (let i = 1; i < data.length - 1; i++) {
      sum += Math.abs(data[i - 1] + data[i + 1] - 2 * data[i]);
    }
    return sum / data.length; // Higher = sharper
  } catch {
    return 0;
  }
}

// ==========================================
// Helper: Download image for AI Vision
// Returns { inlineData, meta: { width, height, blurScore } } or null
// ==========================================
async function downloadForVision(url) {
  try {
    let rawBuffer;

    // รองรับ data: URI (จาก YouTube frame extractor)
    if (url.startsWith('data:image/')) {
      const base64Match = url.match(/base64,(.+)/);
      if (base64Match) {
        rawBuffer = Buffer.from(base64Match[1], 'base64');
      } else {
        return null;
      }
    } else {
      const res = await fetchWithTimeout(url, { timeout: 8000 });
      if (!res.ok) {
        console.log(`[Download] Failed ${res.status} for ${url.substring(0, 80)}`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      rawBuffer = Buffer.from(arrayBuffer);
    }

    if (rawBuffer.length < 2000) {
      console.log(`[Download] Too small (${rawBuffer.length} bytes), skipping: ${url.substring(0, 80)}`);
      return null;
    }

    // ดึง metadata ของภาพต้นฉบับ (resolution)
    const originalMeta = await sharp(rawBuffer).metadata();
    const origWidth = originalMeta.width || 0;
    const origHeight = originalMeta.height || 0;

    // Resize สำหรับ Vision API
    const resized = await sharp(rawBuffer)
      .resize(512, 512, { fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    // คำนวณ blur score จาก resized buffer
    const blurScore = await computeBlurScore(resized);

    return {
      inlineData: {
        data: resized.toString('base64'),
        mimeType: 'image/jpeg'
      },
      meta: {
        width: origWidth,
        height: origHeight,
        blurScore: blurScore
      }
    };
  } catch (e) {
    console.log(`[Download] Error for ${url.substring(0, 60)}: ${e.message}`);
    return null;
  }
}

// ==========================================
// Blocked domains & URL filters
// ==========================================
const BLOCKED_DOMAINS = [
  'amarintv.com', 'amarin.co.th', 'thairath.co.th', 'khaosod.co.th',
  'sanook.com', 'mgronline.com', 'ch7.com', 'thaipbs.or.th',
  'matichon.co.th', 'dailynews.co.th', 'bangkokpost.com',
  'nationtv.tv', 'pptvhd36.com', 'one31.net', 'ch3thailand.com',
  'workpointtoday.com', 'mono29.com', 'tnn16.com', 'springnews.co.th',
  // Social media — ดาวน์โหลดภาพตรงไม่ได้ (403/redirect)
  'tiktok.com', 'fbsbx.com', 'fbcdn.net', 'facebook.com',
  'lookaside.instagram.com', 'instagram.com', 'cdninstagram.com',
  'twitter.com', 'x.com', 'twimg.com'
];

const BLOCKED_URL_KEYWORDS = ['logo', 'icon', 'banner', 'watermark', 'avatar', 'sprite', 'pixel', 'tracking', 'crawler', 'widget', 'cover', 'poster', 'preview', 'thumb'];

function isCleanImageUrl(url) {
  if (!url || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  if (BLOCKED_DOMAINS.some(domain => lower.includes(domain))) return false;
  if (BLOCKED_URL_KEYWORDS.some(kw => lower.includes(kw))) return false;
  // Prefer direct image file URLs
  const hasImageExt = /\.(jpg|jpeg|png|webp|gif)/i.test(url);
  const isApiUrl = /\/api\//i.test(url);
  // If it's an API URL without image extension, skip it
  if (isApiUrl && !hasImageExt) return false;
  return true;
}

// ==========================================
// Agent 1: Google Clean Image Search (Serper API)
// 6 targeted searches from AI-generated queries
// ==========================================
async function agentGoogleCleanImages(identity) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.log('[Agent1: Google] ❌ No SERPER_API_KEY, skipping');
    return [];
  }

  const blockSitesParam = BLOCKED_DOMAINS.map(d => `-site:${d}`).join(' ');
  const allImages = [];

  // ดึง search queries จาก AI — รวม person-only + story-specific
  const sq = identity?.searchQueries || {};
  const queries = [
    // === Person-only queries (ค้นชื่อตรงๆ ไม่ผูกข่าว — หาหน้าชัดจากแหล่งไหนก็ได้) ===
    { q: sq.person_portrait || identity?.mainCharacter || '', label: 'person portrait', num: 10 },
    { q: sq.person_interview || (identity?.mainCharacter ? `${identity.mainCharacter} สัมภาษณ์` : ''), label: 'person interview', num: 8 },
    { q: sq.person_drama || (identity?.mainCharacter ? `${identity.mainCharacter} ละคร` : ''), label: 'person drama', num: 8 },
    { q: sq.person_emotion || '', label: 'person emotion', num: 8 },
    { q: sq.secondary_person || identity?.secondaryCharacter || '', label: 'secondary person', num: 6 },
    // === Story-specific queries (ผูกกับเนื้อข่าวโดยตรง) ===
    { q: sq.person_closeup || identity?.mainCharacter || '', label: 'person closeup', num: 8 },
    { q: sq.person_context || identity?.searchGoogle || '', label: 'person context', num: 8 },
    { q: sq.event_scene || '', label: 'event scene', num: 8 },
    { q: sq.emotion_moment || '', label: 'emotion moment', num: 6 },
    { q: sq.location_photo || identity?.location || '', label: 'location', num: 6 },
    { q: sq.related_people || '', label: 'related people', num: 5 },
  ].filter(q => q.q && q.q.trim());

  // ถ้าไม่มี searchQueries เลย → fallback queries เดิม
  if (queries.length === 0) {
    if (identity?.searchGoogle) queries.push({ q: identity.searchGoogle, label: 'main search', num: 10 });
    if (identity?.mainCharacter) queries.push({ q: identity.mainCharacter, label: 'character', num: 5 });
  }

  for (const queryObj of queries) {
    console.log(`[Agent1: Google] Search (${queryObj.label}): "${queryObj.q}" (${queryObj.num} results)`);
    try {
      const res = await fetchWithTimeout('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: `${queryObj.q} ${blockSitesParam}`,
          gl: 'th', hl: 'th', num: queryObj.num,
          imgSize: 'large', imgType: 'photo'
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.images) {
          const urls = data.images.map(img => img.imageUrl).filter(isCleanImageUrl);
          console.log(`[Agent1: Google] (${queryObj.label}) got ${urls.length} clean images`);
          allImages.push(...urls);
        }
      }
    } catch (e) { console.log(`[Agent1: Google] (${queryObj.label}) error: ${e.message}`); }
  }

  // === Pexels Supplement (ฟรี!) ===
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (pexelsKey && identity?.searchPexels) {
    try {
      console.log(`[Agent1: Pexels] Search: "${identity.searchPexels}" (5 results)`);
      const res = await fetchWithTimeout(`https://api.pexels.com/v1/search?query=${encodeURIComponent(identity.searchPexels)}&per_page=5&orientation=portrait`, {
        headers: { 'Authorization': pexelsKey }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.photos) {
          const urls = data.photos.map(p => p.src?.large2x || p.src?.large).filter(Boolean);
          console.log(`[Agent1: Pexels] Got ${urls.length} stock images`);
          allImages.push(...urls);
        }
      }
    } catch (e) { console.log('[Agent1: Pexels] error:', e.message); }
  }

  const unique = [...new Set(allImages)].slice(0, 25);
  console.log(`[Agent1: Google] ✅ Total: ${unique.length} unique clean images`);
  return unique;
}

// ==========================================
// Agent 2: YouTube Frame Capture (YouTube Data API v3)
// Search → 5 videos → extract REAL frames from storyboard sprites
// ไม่ดึง thumbnail (maxresdefault etc.) เด็ดขาด!
// ==========================================
async function agentYouTubeFrames(identity) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.log('[Agent2: YouTube] ❌ No YOUTUBE_API_KEY, skipping');
    return [];
  }

  // ★ ค้นหลาย query: ไม่แค่ข่าวเดียว แต่ค้นชื่อ+สัมภาษณ์+ผลงานด้วย
  const mainChar = identity?.mainCharacter || '';
  const youtubeQueries = [
    identity?.searchYouTube || identity?.searchGoogle || '',
    mainChar ? `${mainChar} สัมภาษณ์` : '',
    mainChar ? `${mainChar} ละคร ซีรีส์ ฉาก` : '',
    mainChar ? `${mainChar}` : '',
  ].filter(q => q.trim());
  
  if (youtubeQueries.length === 0) {
    console.log('[Agent2: YouTube] ❌ No search query available');
    return [];
  }

  console.log(`[Agent2: YouTube] 🎬 Searching ${youtubeQueries.length} queries → extract real frames`);

  // ★ ลดเกณฑ์: 500x350 — landscape images (686x386) ต้องผ่าน!
  const MIN_WIDTH = 500;
  const MIN_HEIGHT = 350;

  try {
    const { searchAndExtractFrames } = await import('@/lib/services/youtubeFrameExtractor');
    
    // ★ ค้นหลาย query แบบ parallel
    let allFrames = [];
    for (const query of youtubeQueries.slice(0, 3)) { // max 3 queries
      try {
        console.log(`[Agent2: YouTube] 🔍 Query: "${query}"`);
        const frames = await searchAndExtractFrames(query, 3);
        allFrames.push(...frames);
      } catch {}
    }
    
    const frames = allFrames;

    // กรองเฉพาะเฟรมที่ resolution ดีพอ
    const qualityFrames = [];
    for (const frame of frames) {
      if (!frame.buffer) continue;
      try {
        const meta = await sharp(frame.buffer).metadata();
        if ((meta.width || 0) >= MIN_WIDTH && (meta.height || 0) >= MIN_HEIGHT) {
          qualityFrames.push(frame);
        } else {
          console.log(`[Agent2: YouTube] ❌ Rejected frame ${meta.width}x${meta.height} (min ${MIN_WIDTH}x${MIN_HEIGHT})`);
        }
      } catch {
        qualityFrames.push(frame); // ถ้าเช็ค meta ไม่ได้ ให้ผ่านไป
      }
    }

    console.log(`[Agent2: YouTube] Quality filter: ${qualityFrames.length}/${frames.length} frames passed`);

    // ถ้าไม่มีเฟรมคุณภาพ → ใช้ maxresdefault (1280x720) แทน
    if (qualityFrames.length === 0) {
      console.log('[Agent2: YouTube] ⚠️ No quality frames, using maxresdefault thumbnails');
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&key=${apiKey}&maxResults=5&relevanceLanguage=th&regionCode=TH`;
      const response = await fetchWithTimeout(searchUrl, { timeout: 8000 });
      
      if (response.ok) {
        const data = await response.json();
        const thumbUrls = [];
        for (const item of (data.items || [])) {
          const videoId = item.id?.videoId;
          if (!videoId) continue;
          // maxresdefault = 1280x720 (สูงสุด), fallback hqdefault = 480x360
          thumbUrls.push(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`);
          thumbUrls.push(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
        }
        console.log(`[Agent2: YouTube] ✅ Fallback: ${thumbUrls.length} thumbnail URLs from ${data.items?.length || 0} videos`);
        return thumbUrls;
      }
      return [];
    }

    // แปลง frame buffers เป็น data URLs
    const frameUrls = [];
    for (const frame of qualityFrames) {
      if (frame.buffer) {
        const base64 = frame.buffer.toString('base64');
        frameUrls.push(`data:image/jpeg;base64,${base64}`);
      } else if (frame.url) {
        frameUrls.push(frame.url);
      }
    }

    console.log(`[Agent2: YouTube] ✅ Total: ${frameUrls.length} quality frames`);
    return frameUrls;
  } catch (e) {
    console.log('[Agent2: YouTube] Error:', e.message);
    return [];
  }
}

// ==========================================
// Agent 3: Multi-Context Image Search (Serper)
// 5 targeted queries จากหลายมุมมอง
// ==========================================
async function agentContextImages(identity) {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    console.log('[Agent3: Context] ❌ No SERPER_API_KEY, skipping');
    return [];
  }

  const mainChar = identity?.mainCharacter || '';
  const sq = identity?.searchQueries || {};
  const scenes = identity?.keyScenes || [];

  // สร้าง queries จาก AI-generated searchQueries (5 มุม)
  const queries = [];

  // Query 1: บุคคลจริง (ไม่ใช่ข่าว ไม่ใช่ปก)
  if (sq.person_closeup || mainChar) {
    queries.push({
      q: `"${sq.person_closeup || mainChar}" ภาพจริง -ปก -ข่าว -cover -thumbnail -screenshot`,
      label: 'person real photo',
    });
  }

  // Query 2: ★ ผลงาน/ละคร/ซีรีส์ (หาภาพจากผลงานอื่น ไม่ใช่ข่าวนี้)
  if (sq.person_drama || mainChar) {
    queries.push({
      q: `${sq.person_drama || `${mainChar} ละคร ซีรีส์`} -ปก -cover -thumbnail`,
      label: 'person drama/work',
    });
  }

  // Query 3: ★ อารมณ์ตามโทนข่าว (เศร้า ยิ้ม ร้องไห้)
  if (sq.person_emotion || mainChar) {
    queries.push({
      q: `${sq.person_emotion || `${mainChar}`} -ปก -cover -thumbnail`,
      label: 'person emotion',
    });
  }

  // Query 4: เหตุการณ์/บริบท
  if (sq.event_scene || identity?.searchTikTok) {
    queries.push({
      q: `${sq.event_scene || identity.searchTikTok} ภาพเหตุการณ์ -ปกข่าว -designed -collage`,
      label: 'event context',
    });
  }

  // Query 5: อารมณ์/ซีน
  if (sq.emotion_moment || (scenes.length > 0 && mainChar)) {
    queries.push({
      q: `${sq.emotion_moment || `${mainChar} ${scenes[0]}`} -thumbnail -cover -ปก`,
      label: 'emotion moment',
    });
  }

  // Query 6: สถานที่
  if (sq.location_photo || identity?.location) {
    queries.push({
      q: `${sq.location_photo || identity.location} ภาพ -ปก -logo -banner`,
      label: 'location',
    });
  }

  // Query 7: คนอื่นที่เกี่ยวข้อง
  if (sq.related_people) {
    queries.push({
      q: `${sq.related_people} ภาพ -ปก -cover`,
      label: 'related people',
    });
  }

  // fallback ถ้าไม่มี query
  if (queries.length === 0 && identity?.searchGoogle) {
    queries.push({
      q: `${identity.searchGoogle} ภาพจริง -ปก -cover`,
      label: 'fallback',
    });
  }

  if (queries.length === 0) {
    console.log('[Agent3: Context] ❌ No search queries available');
    return [];
  }

  const blockSitesParam = BLOCKED_DOMAINS.map(d => `-site:${d}`).join(' ');
  const allImages = [];

  for (const queryObj of queries) {
    console.log(`[Agent3: Context] Search (${queryObj.label}): "${queryObj.q}" (8 results)`);
    try {
      const res = await fetchWithTimeout('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: `${queryObj.q} ${blockSitesParam}`,
          gl: 'th', hl: 'th', num: 8,
          imgSize: 'large',
          imgType: 'photo',
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.images) {
          const urls = data.images.map(img => img.imageUrl).filter(isCleanImageUrl);
          console.log(`[Agent3: Context] (${queryObj.label}) got ${urls.length} clean images`);
          allImages.push(...urls);
        }
      }
    } catch (e) {
      console.log(`[Agent3: Context] (${queryObj.label}) error: ${e.message}`);
    }
  }

  const unique = [...new Set(allImages)].slice(0, 25);
  console.log(`[Agent3: Context] ✅ Total: ${unique.length} unique context images from ${queries.length} searches`);
  return unique;
}

// ==========================================
// AI Judge: Strict image selection with Gemini Vision
// Pre-filters by resolution & blur, then assigns cover roles:
// HERO_FACE, CONTEXT_SCENE, EVIDENCE, EMOTION, RELATIONSHIP
// ==========================================
async function judgeImages(candidates, newsTitle, identity) {
  if (!candidates || candidates.length === 0) return [];

  console.log(`[Judge] 🔍 Downloading ${candidates.length} candidates for AI Vision analysis...`);

  // ดาวน์โหลดทั้งหมดพร้อม metadata
  const downloadResults = await Promise.allSettled(candidates.map(url => downloadForVision(url)));

  // === PRE-FILTER: Resolution & Blur ===
  const imageParts = [];
  const validCandidates = [];
  let rejectedResolution = 0;
  let rejectedBlur = 0;

  for (let i = 0; i < downloadResults.length; i++) {
    if (downloadResults[i].status !== 'fulfilled' || !downloadResults[i].value) continue;

    const downloaded = downloadResults[i].value;
    const meta = downloaded.meta || {};

    // ★ เช็ค resolution ขั้นต่ำ 500x350 (ลดเกณฑ์ — landscape ต้องผ่าน)
    if (meta.width && meta.height && (meta.width < 500 || meta.height < 350)) {
      console.log(`[Judge] 🚫 Rejected (low res ${meta.width}x${meta.height}, need 500x350+): ${candidates[i].substring(0, 70)}`);
      rejectedResolution++;
      continue;
    }

    // ★ เช็ค blur score ขั้นต่ำ 8 (ผ่อนลงนิดจาก 12 — ไม่ reject มากเกินไป)
    if (meta.blurScore !== undefined && meta.blurScore < 8) {
      console.log(`[Judge] 🚫 Rejected (too blurry, score=${meta.blurScore.toFixed(1)}, need 8+): ${candidates[i].substring(0, 70)}`);
      rejectedBlur++;
      continue;
    }

    // ส่งเฉพาะ inlineData ให้ Vision API (ไม่ส่ง meta)
    imageParts.push({ inlineData: downloaded.inlineData });
    validCandidates.push(candidates[i]);
  }

  console.log(`[Judge] 📊 Pre-filter: ${validCandidates.length} passed, ${rejectedResolution} low-res, ${rejectedBlur} blurry`);

  if (validCandidates.length === 0) {
    console.log('[Judge] ❌ No images passed pre-filter');
    return [];
  }

  console.log(`[Judge] 📤 Sending ${imageParts.length} valid images to Gemini Vision...`);

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const mainChar = identity?.mainCharacter || 'ตัวละครหลักในข่าว';
    const storyContext = identity?.story || newsTitle;
    const emotion = identity?.emotion || 'neutral';
    const coverEmotion = identity?.coverEmotion || 'drama';

    const prompt = `คุณคือ Photo Editor ระดับ Senior สำหรับสำนักข่าวไวรัลระดับมืออาชีพ กำลังเลือกภาพทำปกข่าว 5 แบบ
You are a RUTHLESSLY STRICT senior photo editor selecting images for a professional viral news cover set.

📰 ข่าว / News: "${storyContext}"
🎭 ตัวละครหลัก / Main Character: "${mainChar}"
💢 อารมณ์ข่าว / Emotion: ${emotion} → Cover mood: ${coverEmotion}

มีภาพ ${imageParts.length} ภาพ (index 0 ถึง ${imageParts.length - 1}) ให้ตัดสิน

=== ROLE ASSIGNMENTS (ต้องกำหนด role ให้ทุกภาพที่ผ่าน) ===

🏷️ HERO_FACE (1 ภาพเท่านั้น!):
- ต้องเป็นภาพ close-up หน้า ${mainChar} ที่คมชัดที่สุด
- ใบหน้าต้องกินพื้นที่ >30% ของเฟรม
- ชัดมาก ไม่เบลอ
- ⚠️ ภาพ HERO_FACE ไม่จำเป็นต้องมาจากข่าวนี้! ภาพจากคลิปอื่น ละคร สัมภาษณ์อื่น งานอีเวนท์ ก็ใช้ได้
- ขอแค่เป็นรูปจริงของ ${mainChar} (ไม่ใช่ stock photo คนแปลกหน้า)
- Score 7-10
- ⚠️ ถ้ามีภาพหน้า ${mainChar} ชัด อย่า REJECT มัน! ถ้าไม่มี text overlay หนักๆ ให้ score ≥ 6
- 📐 ภาพ HERO_FACE ต้องเห็นใบหน้าชัดเจน ครึ่งตัวบน (คอ-ไหล่-หัว) ห้ามเป็นภาพเต็มตัว ห้ามเห็นขา ห้ามเห็นพื้นหลังเยอะเกินครึ่งภาพ
- 📊 เพิ่มคะแนน: คนอยู่กึ่งกลางเฟรม (+2), หน้าชัดไม่เบลอ (+2), ครึ่งตัวบน (+1). ลดคะแนน: พื้นหลังเยอะเกินครึ่ง (-2), เห็นทั้งตัวจนหน้าเล็ก (-2), มุมกำแพง/มุมโล่ง (-1)

🏷️ CONTEXT_SCENE (1-2 ภาพ):
- Wide shot แสดงสถานที่/เหตุการณ์/บริบท
- เช่น อาคาร, ที่เกิดเหตุ, โรงพยาบาล, ศาล, สถานีตำรวจ
- ภาพต้องเกี่ยวข้องกับข่าวจริง ไม่ใช่ภาพ generic

🏷️ EVIDENCE (1 ภาพ):
- ป้าย, เอกสาร, ข้อความ, ป้ายชื่อ, หลักฐาน
- สิ่งที่ "บอกเล่า" เรื่องราว — ป้ายร้าน, ป้ายสถานที่, เอกสารศาล

🏷️ EMOTION (1-2 ภาพ):
- Close-up อารมณ์ — ร้องไห้, ตกใจ, โกรธ, ยิ้ม, เศร้า
- ต้องเห็นอารมณ์ชัดเจน ไม่ใช่ neutral pose

🏷️ RELATIONSHIP (0-1 ภาพ):
- ภาพ ${mainChar} กับคนอื่น (คู่รัก, ครอบครัว, เพื่อน)
- ต้องเห็นความสัมพันธ์ชัดเจน

=== ❌ REJECT ทันที (score = 0, role = "REJECT") ===
1. ภาพเบลอ, pixelated, resolution ต่ำ
2. Stock photo — ภาพ generic ไม่ใช่คนจริงในข่าว
3. มี text overlay หนักๆ / news graphics / TV show graphics / lower-third
4. มี watermark, logo สำนักข่าว, แบนเนอร์, กราฟิกช่อง
5. เป็น designed cover / thumbnail / collage / ปกคลิป
6. หน้าถูกตัด / มองไม่ออกว่าเป็นใคร
7. ภาพซ้ำกัน (same person + same angle) → เก็บแค่คมสุด 1 ภาพ
8. Screenshot จอทีวี / screenshot ข่าว / news article screenshot
9. ภาพ collage ปก — หลายภาพจัดเรียงเป็น layout
10. มีกรอบ border สวยงาม / ถูกจัดวางตามดีไซน์
11. ภาพไม่เกี่ยวกับข่าวนี้เลย

=== SCORING GUIDE ===
- 9-10: สมบูรณ์แบบ คมชัดสุด ภาพใหญ่ high-res ไม่มี text ไม่มี watermark เหมาะกับ role อย่างยิ่ง
- 7-8: ดีมาก ใช้ได้ชัวร์ ภาพคม ไม่มี text
- 6: พอใช้ได้ ไม่สมบูรณ์แต่ไม่มีข้อเสียร้ายแรง
- 4-5: มีปัญหาบ้าง (เบลอเล็กน้อย, มุมไม่ดีนัก)
- 1-3: ปัญหาชัดเจน — ไม่ควรใช้
- 0: REJECT ตาม rules ด้านบน

⚠️ กฎเข้มงวด (ปกต้องสะอาดเหมือนปก Viral มืออาชีพ):
- ภาพที่มี text overlay (ไม่ว่าเล็กหรือใหญ่: ชื่อรายการ, lower-third, ข้อความซ้อน, ชื่อคน, subtitle) → score ≤ 3 เท่านั้น ห้ามให้สูงกว่านี้
- Screenshot จอทีวี, screenshot ข่าว, ภาพจากหน้าจอรายการ (มีกรอบรายการ, logo ช่อง, แบนเนอร์) → score = 0 REJECT
- ภาพ collage / designed cover / thumbnail → score = 0 REJECT
- ภาพเบลอ, pixelated, แตก, ภาพยืด → score ≤ 2
- ภาพที่มี watermark ใดๆ → score ≤ 2
- เน้นภาพ "สะอาด": ไม่มี text, ไม่มี graphics, หน้าคนชัด, background สะอาด → score ≥ 7
- REJECT เป็น 0 ทุกภาพที่ไม่ clean พอจะทำปกมืออาชีพได้

=== OUTPUT FORMAT ===
Return JSON array เท่านั้น ห้ามมี markdown blocks ห้ามมี \`\`\`
ตัดสินทุกภาพ (แม้แต่ REJECT ก็ต้องใส่ score=0)
HERO_FACE ต้องมีแค่ 1 ตัวเท่านั้น

[{"index": 0, "score": 10, "role": "HERO_FACE", "reason": "..."}, {"index": 3, "score": 8, "role": "CONTEXT_SCENE", "reason": "..."}, {"index": 5, "score": 0, "role": "REJECT", "reason": "..."}]`;

    const result = await model.generateContent([prompt, ...imageParts]);
    const responseText = result.response.text();

    // Parse JSON array from response (greedy match เพื่อจับ array ที่มี nested objects)
    const match = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);

      if (!Array.isArray(parsed) || parsed.length === 0) {
        console.log('[Judge] ⚠️ AI returned empty array, using fallback');
        return fallbackSelection(validCandidates);
      }

      // แยก accepted vs rejected สำหรับ log — ★ ลดเกณฑ์จาก 5 → 4 เพื่อให้ได้ภาพเพียงพอ
      const accepted = parsed.filter(s => s.score >= 4);
      const nearMiss = parsed.filter(s => s.score === 3);
      const rejected = parsed.filter(s => s.score < 3);

      console.log(`[Judge] AI scores: ${parsed.map(s => `#${s.index}=${s.score}(${s.role})`).join(', ')}`);
      console.log(`[Judge] 📊 Accepted(≥5): ${accepted.length}, Near-miss(4): ${nearMiss.length}, Rejected(<4): ${rejected.length}`);

      // === สร้าง selected list จากภาพที่ score >= 6 ===
      // HERO_FACE ต้องมีแค่ 1
      let heroAssigned = false;
      const HERO_ROLE = 'HERO_FACE';

      const validScores = accepted
        .filter(s => s.index >= 0 && s.index < validCandidates.length)
        .sort((a, b) => {
          // HERO_FACE มาก่อน
          if (a.role === HERO_ROLE && b.role !== HERO_ROLE) return -1;
          if (b.role === HERO_ROLE && a.role !== HERO_ROLE) return 1;
          return b.score - a.score;
        });

      const selectedImages = [];
      for (const s of validScores) {
        let role = s.role || 'CONTEXT_SCENE';
        if (role === HERO_ROLE) {
          if (heroAssigned) role = 'EMOTION'; // Demote extra HERO_FACE
          else heroAssigned = true;
        }
        selectedImages.push({
          url: validCandidates[s.index],
          role: role,
          score: s.score
        });
      }

      if (selectedImages.length > 0) {
        // === Supplement: ถ้าน้อยกว่า 5 ภาพ ดึง near-miss (score 4-5) มาเสริม ===
        if (selectedImages.length < 5 && nearMiss.length > 0) {
          const selectedUrls = new Set(selectedImages.map(i => i.url));
          const sortedNearMiss = nearMiss
            .filter(s => s.index >= 0 && s.index < validCandidates.length)
            .sort((a, b) => b.score - a.score);

          for (const s of sortedNearMiss) {
            if (selectedImages.length >= 8) break;
            const url = validCandidates[s.index];
            if (!selectedUrls.has(url)) {
              selectedImages.push({
                url: url,
                role: s.role === 'REJECT' ? 'SUPPORT' : (s.role || 'SUPPORT'),
                score: s.score
              });
              selectedUrls.add(url);
            }
          }
          console.log(`[Judge] 📦 Supplemented with near-miss → total ${selectedImages.length}`);
        }

        // ถ้ายังไม่พอ → ดึง score 1-3 มาเสริม (ดีกว่าไม่มีเลย)
        if (selectedImages.length < 4) {
          const selectedUrls = new Set(selectedImages.map(i => i.url));
          const lowScored = rejected
            .filter(s => s.score > 0 && s.index >= 0 && s.index < validCandidates.length)
            .sort((a, b) => b.score - a.score);

          for (const s of lowScored) {
            if (selectedImages.length >= 6) break;
            const url = validCandidates[s.index];
            if (!selectedUrls.has(url)) {
              selectedImages.push({
                url: url,
                role: 'SUPPORT',
                score: s.score
              });
              selectedUrls.add(url);
            }
          }
          if (lowScored.length > 0) {
            console.log(`[Judge] 📦 Added low-scored supplements → total ${selectedImages.length}`);
          }
        }

        // สรุป roles
        const roleCounts = {};
        for (const img of selectedImages) {
          roleCounts[img.role] = (roleCounts[img.role] || 0) + 1;
        }
        const roleStr = Object.entries(roleCounts).map(([r, c]) => `${c} ${r}`).join(', ');
        console.log(`[Judge] ✅ Selected ${selectedImages.length} images: ${roleStr}`);
        return selectedImages;
      }
    }

    console.log('[Judge] ⚠️ Could not parse AI response, using fallback');
    return fallbackSelection(validCandidates);
  } catch (e) {
    console.log('[Judge] ❌ AI Vision Error:', e.message);
    return fallbackSelection(validCandidates);
  }
}

function fallbackSelection(candidates) {
  const shuffled = [...candidates].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 10).map((url, i) => ({
    url,
    role: i === 0 ? 'HERO' : 'SUPPORT'
  }));
}

// ==========================================
// Main Orchestrator
// Run all 3 agents in parallel → deduplicate → judge
// ==========================================
export async function runMultiAgentImageSearch(url, sourceType, entities, newsTitle, identity) {
  console.log('============================================');
  console.log('[MultiAgent] 🚀 Starting parallel image search');
  console.log(`[MultiAgent] News: "${(newsTitle || '').slice(0, 60)}..."`);
  console.log(`[MultiAgent] Main character: ${identity?.mainCharacter || 'unknown'}`);
  console.log(`[MultiAgent] Search queries:`);
  console.log(`  Google: ${identity?.searchGoogle || 'N/A'}`);
  console.log(`  YouTube: ${identity?.searchYouTube || 'N/A'}`);
  console.log(`  TikTok: ${identity?.searchTikTok || 'N/A'}`);
  console.log('============================================');

  // Run all 3 agents in parallel
  const [googleResult, youtubeResult, contextResult] = await Promise.allSettled([
    agentGoogleCleanImages(identity),
    agentYouTubeFrames(identity),
    agentContextImages(identity)
  ]);

  // Collect results from each agent
  const googleImages = googleResult.status === 'fulfilled' ? googleResult.value : [];
  const youtubeImages = youtubeResult.status === 'fulfilled' ? youtubeResult.value : [];
  const contextImages = contextResult.status === 'fulfilled' ? contextResult.value : [];

  console.log('============================================');
  console.log(`[MultiAgent] Agent results:`);
  console.log(`  Agent 1 (Google):   ${googleImages.length} images ${googleResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + googleResult.reason : ''}`);
  console.log(`  Agent 2 (YouTube):  ${youtubeImages.length} frames ${youtubeResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + youtubeResult.reason : ''}`);
  console.log(`  Agent 3 (Context):  ${contextImages.length} images ${contextResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + contextResult.reason : ''}`);

  // Combine and deduplicate
  let candidates = [...googleImages, ...youtubeImages, ...contextImages];
  candidates = [...new Set(candidates)];

  console.log(`[MultiAgent] Combined unique candidates: ${candidates.length}`);

  // Cap at 30 for the judge
  if (candidates.length > 30) {
    candidates = candidates.sort(() => 0.5 - Math.random()).slice(0, 30);
    console.log(`[MultiAgent] Capped to 30 candidates for judging`);
  }

  console.log(`[MultiAgent] 🏛️ Sending ${candidates.length} candidates to AI Judge...`);
  console.log('============================================');

  const selectedImages = await judgeImages(candidates, newsTitle, identity);

  console.log('============================================');
  console.log(`[MultiAgent] 🏁 Final selection: ${selectedImages.length} images`);
  console.log('============================================');

  return selectedImages;
}
