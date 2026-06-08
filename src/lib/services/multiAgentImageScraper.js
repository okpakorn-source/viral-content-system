import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import { MODEL_VISION } from '@/lib/ai/modelConfig';

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
  try {
    const response = await fetch(resource, {
      ...options,
      headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
      signal: controller.signal,
      redirect: 'follow'
    });
    return response;
  } finally {
    clearTimeout(id);
  }
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
  'twitter.com', 'x.com', 'twimg.com',
  // ★ Stock photo sites — ห้ามเด็ดขาด (ภาพไม่ใช่คนในข่าว!)
  'shutterstock.com', 'istockphoto.com', 'freepik.com', 'pexels.com',
  'pixabay.com', '123rf.com', 'dreamstime.com', 'gettyimages.com',
  'unsplash.com', 'canva.com', 'depositphotos.com', 'rawpixel.com',
  'stock.adobe.com', 'alamy.com', 'bigstockphoto.com',
];

const BLOCKED_URL_KEYWORDS = ['logo', 'icon', 'banner', 'watermark', 'avatar', 'sprite', 'pixel', 'tracking', 'crawler', 'widget'];

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
    // === ภาพบุคคลหลัก (หน้าชัด portrait) ===
    { q: sq.person_portrait || identity?.mainCharacter || '', label: 'person portrait', num: 10 },
    { q: sq.person_closeup || (identity?.mainCharacter ? `${identity.mainCharacter} ภาพถ่ายหน้าชัด` : ''), label: 'person closeup', num: 8 },
    { q: sq.secondary_person || identity?.secondaryCharacter || '', label: 'secondary person', num: 6 },
    // === ★★★ Story-specific queries (ผูกกับเนื้อข่าวโดยตรง — สำคัญที่สุด!) ===
    { q: sq.person_context || identity?.searchGoogle || '', label: 'person context', num: 8 },
    { q: sq.event_scene || '', label: 'event scene', num: 8 },
    { q: sq.emotion_moment || '', label: 'emotion moment', num: 6 },
    { q: sq.location_photo || identity?.location || '', label: 'location', num: 6 },
    { q: sq.related_people || '', label: 'related people', num: 5 },
    { q: sq.person_emotion || '', label: 'person emotion', num: 8 },
    // === ★★★ Story-driven queries ใหม่ (เล่าเรื่องผ่านภาพ) ===
    { q: sq.person_past || '', label: 'person past/timeline', num: 6 },
    { q: sq.key_relationship || '', label: 'key relationship', num: 8 },
    { q: sq.key_activity || '', label: 'key activity', num: 8 },
    { q: sq.story_contrast || '', label: 'story contrast', num: 6 },
  ].filter(q => q.q && q.q.trim());

  // ถ้าไม่มี searchQueries เลย → fallback queries เดิม
  if (queries.length === 0) {
    if (identity?.searchGoogle) queries.push({ q: identity.searchGoogle, label: 'main search', num: 10 });
    if (identity?.mainCharacter) queries.push({ q: identity.mainCharacter, label: 'character', num: 5 });
  }

  const allMeta = []; // ★ เก็บ metadata สำหรับ Distribution Report

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
          const imgs = data.images.filter(img => isCleanImageUrl(img.imageUrl));
          console.log(`[Agent1: Google] (${queryObj.label}) got ${imgs.length} clean images`);
          for (const img of imgs) {
            allImages.push(img.imageUrl);
            allMeta.push({ url: img.imageUrl, title: img.title || '', source: img.source || '', link: img.link || '', queryLabel: queryObj.label, queryText: queryObj.q });
          }
        }
      }
    } catch (e) { console.log(`[Agent1: Google] (${queryObj.label}) error: ${e.message}`); }
  }

  const unique = [...new Set(allImages)].slice(0, 25);
  console.log(`[Agent1: Google] ✅ Total: ${unique.length} unique clean images`);
  // ★ Return พร้อม metadata สำหรับ Distribution Report
  return Object.assign(unique, { _meta: allMeta });
}

// ==========================================
// Agent 2: YouTube Frame Capture (3-Tier Search)
// Tier 1: YouTube API search (max 1 query — save quota)
// Tier 2: Serper site:youtube.com/watch (fallback — no quota!)
// Tier 3: extractYouTubeFrames (storyboard — no API needed!)
// ==========================================
async function agentYouTubeFrames(identity) {
  const mainChar = identity?.mainCharacter || '';

  // ★★★ ใช้ coreImageQueries ชุดเดียวกับทุก Agent — ไม่ถือคีย์คนละชุดอีกแล้ว!
  const coreQueries = identity?.coreImageQueries || [];
  const sq = identity?.searchQueries || {};
  const sd = identity?.specific_details || {};

  // Priority: coreImageQueries → searchYouTube → searchGoogle → fallback
  let youtubeQueries = [];
  if (coreQueries.length > 0) {
    // ★ ใช้ coreImageQueries ทุกตัว (max 3) — เหมือน Google + Tavily
    youtubeQueries = coreQueries.slice(0, 3);
    console.log(`[Agent2: YouTube] ★ Using coreImageQueries: ${JSON.stringify(youtubeQueries)}`);
  } else {
    // Fallback เดิม
    const searchQuery = identity?.searchYouTube || identity?.searchGoogle || '';
    youtubeQueries = [
      searchQuery,
      sq.person_context || (mainChar && identity?.story ? `${mainChar} ${identity.story.substring(0, 30)}` : ''),
      sq.event_scene || (sd.place_names?.[0] ? `${mainChar} ${sd.place_names[0]}` : ''),
    ].filter(q => q && q.trim());
    console.log(`[Agent2: YouTube] ⚠️ No coreImageQueries, using legacy: ${JSON.stringify(youtubeQueries)}`);
  }

  if (youtubeQueries.length === 0) {
    console.log('[Agent2: YouTube] ❌ No search queries available');
    return [];
  }

  console.log(`[Agent2: YouTube] 🎬 3-Tier search with ${youtubeQueries.length} queries`);

  const MIN_WIDTH = 500;
  const MIN_HEIGHT = 350;

  try {
    // === Tier 1: YouTube API (max 1 query เพื่อประหยัด quota) ===
    let videoIds = [];
    const apiKey = process.env.YOUTUBE_API_KEY;
    
    if (apiKey) {
      try {
        const firstQuery = youtubeQueries[0];
        console.log(`[Agent2: YouTube] 📡 Tier 1: YouTube API → "${firstQuery.substring(0, 50)}"`);
        
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(firstQuery)}&type=video&key=${apiKey}&maxResults=5&relevanceLanguage=th&regionCode=TH`;
        const response = await fetchWithTimeout(searchUrl, { timeout: 8000 });
        
        if (response.ok) {
          const data = await response.json();
          videoIds = (data.items || [])
            .map(item => item.id?.videoId)
            .filter(Boolean);
          console.log(`[Agent2: YouTube] ✅ Tier 1: Found ${videoIds.length} videos`);
        } else if (response.status === 429 || response.status === 403) {
          console.log(`[Agent2: YouTube] ⚠️ Tier 1: HTTP ${response.status} (quota exceeded) → switching to Tier 2`);
        } else {
          console.log(`[Agent2: YouTube] ⚠️ Tier 1: HTTP ${response.status} → switching to Tier 2`);
        }
      } catch (e) {
        console.log(`[Agent2: YouTube] ⚠️ Tier 1 error: ${e.message?.substring(0, 60)} → Tier 2`);
      }
    } else {
      console.log('[Agent2: YouTube] ⚠️ No YOUTUBE_API_KEY → skipping to Tier 2');
    }

    // === Tier 2: Serper site:youtube.com/watch (ไม่กิน YouTube quota!) ===
    if (videoIds.length === 0) {
      const serperKey = process.env.SERPER_API_KEY;
      if (serperKey) {
        console.log('[Agent2: YouTube] 🔄 Tier 2: Serper site:youtube.com fallback');
        
        // ค้นหลาย query ผ่าน Serper (max 2 queries)
        for (const query of youtubeQueries.slice(0, 2)) {
          try {
            const serperQuery = `site:youtube.com/watch "${query}"`;
            console.log(`[Agent2: YouTube] 🔍 Serper: "${serperQuery.substring(0, 60)}"`);
            
            const serperRes = await fetchWithTimeout('https://google.serper.dev/search', {
              method: 'POST',
              headers: {
                'X-API-KEY': serperKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                q: serperQuery,
                num: 5,
                gl: 'th',
                hl: 'th'
              }),
              timeout: 8000
            });

            if (serperRes.ok) {
              const serperData = await serperRes.json();
              const results = serperData.organic || [];
              
              // Parse video_id จาก YouTube URLs
              for (const result of results) {
                const url = result.link || '';
                const vidMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                if (vidMatch && !videoIds.includes(vidMatch[1])) {
                  videoIds.push(vidMatch[1]);
                }
              }
              console.log(`[Agent2: YouTube] ✅ Serper found ${results.length} results → ${videoIds.length} unique video IDs`);
            }
          } catch (e) {
            console.log(`[Agent2: YouTube] Serper error: ${e.message?.substring(0, 60)}`);
          }
        }
        
        if (videoIds.length > 0) {
          console.log(`[Agent2: YouTube] ✅ Tier 2: Got ${videoIds.length} video IDs via Serper (NO YouTube quota used!)`);
        }
      } else {
        console.log('[Agent2: YouTube] ⚠️ No SERPER_API_KEY → cannot fallback');
      }
    }

    // === ถ้ายังไม่มี video_id → return เปล่า ===
    if (videoIds.length === 0) {
      console.log('[Agent2: YouTube] ❌ No video IDs found from any tier');
      return [];
    }

    // === Tier 3: Extract frames จาก storyboard (ไม่ใช้ API เลย!) ===
    console.log(`[Agent2: YouTube] 🎞️ Tier 3: Extracting frames from ${videoIds.length} videos (storyboard — no API)...`);
    
    const { extractYouTubeFrames } = await import('@/lib/services/youtubeFrameExtractor');
    const frames = await extractYouTubeFrames(videoIds.slice(0, 5));

    // กรอง + upscale เฟรม (storyboard frames มักเล็ก 160x90 หรือ 320x180)
    const qualityFrames = [];
    for (const frame of frames) {
      if (!frame.buffer) continue;
      try {
        const meta = await sharp(frame.buffer).metadata();
        const w = meta.width || 0;
        const h = meta.height || 0;
        
        // ★ Reject เฉพาะ tiny frames (< 160px) — เล็กเกินจะ upscale
        if (w < 160 || h < 90) {
          console.log(`[Agent2: YouTube] ❌ Rejected tiny frame ${w}x${h}`);
          continue;
        }
        
        // ★ Upscale frames 160-500px → ~960px (lanczos3 + sharpen)
        if (w < MIN_WIDTH) {
          const scale = Math.min(3, Math.ceil(960 / w));
          const targetW = w * scale;
          const targetH = h * scale;
          frame.buffer = await sharp(frame.buffer)
            .resize(targetW, targetH, { 
              fit: 'inside', 
              kernel: 'lanczos3',
              withoutEnlargement: false 
            })
            .sharpen({ sigma: 1.2 })
            .jpeg({ quality: 92 })
            .toBuffer();
          console.log(`[Agent2: YouTube] ⬆️ Upscaled frame ${w}x${h} → ${targetW}x${targetH}`);
        }
        
        qualityFrames.push(frame);
      } catch {
        qualityFrames.push(frame); // ถ้าเช็ค meta ไม่ได้ ให้ผ่านไป
      }
    }

    console.log(`[Agent2: YouTube] Quality filter: ${qualityFrames.length}/${frames.length} frames passed`);

    // ถ้าไม่มีเฟรมคุณภาพ → ใช้ maxresdefault (1280x720) แทน
    if (qualityFrames.length === 0 && videoIds.length > 0) {
      console.log('[Agent2: YouTube] ⚠️ No quality frames, using maxresdefault thumbnails');
      const thumbUrls = [];
      for (const videoId of videoIds.slice(0, 5)) {
        thumbUrls.push(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`);
        thumbUrls.push(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
      }
      console.log(`[Agent2: YouTube] ✅ Fallback: ${thumbUrls.length} thumbnail URLs`);
      return thumbUrls;
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

  // ★★★ ใช้ coreImageQueries ชุดเดียวก่อน — เหมือนทุก Agent
  const coreQueries = identity?.coreImageQueries || [];
  const queries = [];
  const blockTerms = '-ลายน้ำ -watermark -ปกข่าว -ปกคลิป';

  // Prepend coreImageQueries เป็นกลุ่มแรก (highest priority)
  for (const cq of coreQueries) {
    queries.push({
      q: `${cq} ภาพจริง -ปก -cover -thumbnail ${blockTerms}`,
      label: `core: ${cq.substring(0, 30)}`,
    });
  }

  // Query 1: บุคคลจริง (ไม่ใช่ข่าว ไม่ใช่ปก)
  if (sq.person_closeup || mainChar) {
    queries.push({
      q: `"${sq.person_closeup || mainChar}" ภาพจริง -ปก -ข่าว -cover -thumbnail -screenshot ${blockTerms}`,
      label: 'person real photo',
    });
  }

  // Query 2: ★ บริบทข่าว (ค้นบุคคล+เหตุการณ์เฉพาะของข่าวนี้)
  if (sq.person_context || (mainChar && identity?.story)) {
    queries.push({
      q: `${sq.person_context || `${mainChar} ${identity?.story?.substring(0, 30) || ''}`} -ปก -cover -thumbnail ${blockTerms}`,
      label: 'person in news context',
    });
  }

  // Query 3: ★ อารมณ์ตามโทนข่าว (เศร้า ยิ้ม ร้องไห้)
  if (sq.person_emotion || mainChar) {
    queries.push({
      q: `${sq.person_emotion || `${mainChar}`} -ปก -cover -thumbnail ${blockTerms}`,
      label: 'person emotion',
    });
  }

  // Query 4: เหตุการณ์/บริบท
  if (sq.event_scene || identity?.searchTikTok) {
    queries.push({
      q: `${sq.event_scene || identity.searchTikTok} ภาพเหตุการณ์ -designed -collage ${blockTerms}`,
      label: 'event context',
    });
  }

  // Query 5: อารมณ์/ซีน
  if (sq.emotion_moment || (scenes.length > 0 && mainChar)) {
    queries.push({
      q: `${sq.emotion_moment || `${mainChar} ${scenes[0]}`} -thumbnail -cover -ปก ${blockTerms}`,
      label: 'emotion moment',
    });
  }

  // Query 6: สถานที่
  if (sq.location_photo || identity?.location) {
    queries.push({
      q: `${sq.location_photo || identity.location} ภาพ -ปก -logo -banner ${blockTerms}`,
      label: 'location',
    });
  }

  // Query 7: คนอื่นที่เกี่ยวข้อง
  if (sq.related_people) {
    queries.push({
      q: `${sq.related_people} ภาพ -ปก -cover ${blockTerms}`,
      label: 'related people',
    });
  }

  // ★ Fix 8: queries จาก specific_details (ชื่อสถานที่/หลักฐานเฉพาะ)
  if (identity?.specific_details?.place_names) {
    for (const place of identity.specific_details.place_names.slice(0, 3)) {
      if (place && place.length > 3) {
        queries.push({ q: `${place} ภาพ -ปก -cover ${blockTerms}`, label: 'specific place' });
      }
    }
  }
  if (identity?.specific_details?.evidence_items) {
    for (const item of identity.specific_details.evidence_items.slice(0, 2)) {
      if (item && item.length > 3) {
        queries.push({ q: `${item} ${mainChar || ''} ${blockTerms}`, label: 'evidence' });
      }
    }
  }
  
  // ★★★ Story-driven queries ใหม่ (เล่าเรื่องผ่านภาพ)
  if (sq.person_past) {
    queries.push({ q: `${sq.person_past} -ปก -cover ${blockTerms}`, label: 'person past' });
  }
  if (sq.key_relationship) {
    queries.push({ q: `${sq.key_relationship} -ปก -cover ${blockTerms}`, label: 'key relationship' });
  }
  if (sq.key_activity) {
    queries.push({ q: `${sq.key_activity} -ปก -cover ${blockTerms}`, label: 'key activity' });
  }
  if (sq.story_contrast) {
    queries.push({ q: `${sq.story_contrast} -ปก -cover ${blockTerms}`, label: 'story contrast' });
  }

  // fallback ถ้าไม่มี query
  if (queries.length === 0 && identity?.searchGoogle) {
    queries.push({
      q: `${identity.searchGoogle} ภาพจริง -ปก -cover ${blockTerms}`,
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

    // ★ เช็ค resolution ขั้นต่ำ 350x250 (ลดเกณฑ์ — ภาพจาก blog/news ไทยมักเล็ก)
    if (meta.width && meta.height && (meta.width < 350 || meta.height < 250)) {
      console.log(`[Judge] 🚫 Rejected (low res ${meta.width}x${meta.height}, need 350x250+): ${candidates[i].substring(0, 70)}`);
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

  // ★ ย้ายมาไว้นอก try เพื่อให้ catch block เข้าถึง prompt ได้ (แก้ "prompt is not defined")
  const mainChar = identity?.mainCharacter || 'ตัวละครหลักในข่าว';
  const storyContext = identity?.story || newsTitle;
  const emotion = identity?.emotion || 'neutral';
  const coverEmotion = identity?.coverEmotion || 'drama';

  // ★ ใช้เนื้อข่าวเต็ม (ถูก inject จาก auto-cover route) แทนแค่ 1 ประโยค
  const newsContent = identity?._newsContent || identity?.story || storyContext;
  const keyEvents = identity?.specific_details?.key_events?.join(', ') || '';

  // ★ สร้าง source URL map เพื่อส่งให้ AI judge ตรวจสอบ
  const sourceUrlMap = validCandidates.map((url, idx) => {
    try {
      const u = new URL(url);
      return `#${idx}: ${u.hostname} (${u.pathname.split('/').pop() || 'image'})`;
    } catch { return `#${idx}: (data/unknown)`; }
  }).join('\n');
  const keyScenes = identity?.keyScenes?.join(', ') || '';

  const prompt = `คุณคือ Photo Editor ระดับ Senior สำหรับสำนักข่าวไวรัลระดับมืออาชีพ กำลังเลือกภาพทำปกข่าว
You are a senior photo editor selecting images for a viral news cover.

📰 ข่าว: "${storyContext}"
📝 เนื้อข่าว (เต็ม): "${(newsContent || '').slice(0, 800)}"
🎭 ตัวละครหลัก: "${mainChar}"

📦 แหล่งที่มาของภาพ (Source URLs):
${sourceUrlMap}

★★★ กฎใหม่ — ตรวจสอบแหล่งที่มาของภาพ!
- ภาพจาก stock photo sites (shutterstock, istock, freepik, pexels, pixabay, 123rf, dreamstime, gettyimages, unsplash, canva) → REJECT ทันที (score=0)! เป็น stock photo!
- ภาพจาก blog/เว็บทั่วไป ที่ไม่ใช่สำนักข่าว/social media ของคนในข่าว → ลด score 3 คะแนน!
- ภาพจาก social media ของคนในข่าว (instagram, facebook, tiktok) → ดี score ปกติ
- ภาพจากเว็บข่าวจริง (thairath, khaosod, mgronline, pptvhd36, sanook, kapook, matichon) → ดี score ปกติ
- ★ ดู hostname ของแต่ละภาพด้านบน แล้วพิจารณาร่วมกับเนื้อหาภาพ!
👤 ตัวละครรอง: "${identity?.secondaryCharacter || 'ไม่มี'}"
💢 อารมณ์ข่าว: ${emotion} → Cover mood: ${coverEmotion}
📋 ประเด็นสำคัญ: ${keyEvents || keyScenes || 'ไม่ระบุ'}
📍 สถานที่: ${identity?.location || 'ไม่ระบุ'}
🔑 กิจกรรมหลัก: ${identity?.searchQueries?.key_activity || identity?.searchQueries?.event_scene || 'ไม่ระบุ'}
🎬 ซีนที่ต้องการ: ${keyScenes || keyEvents || 'ไม่ระบุ'}

★★★ เป้าหมาย: เลือกภาพที่ "เล่าเรื่อง" ข่าวนี้ ไม่ใช่เลือกภาพ "สวย" ของคน!
- ภาพที่แสดง กิจกรรม/สถานที่/เหตุการณ์ ในข่าว → score สูง (7-10)
- ภาพ ${mainChar} ที่สวยแต่ไม่เกี่ยวข่าว → score ต่ำ (≤ 3!)

★★★ GOLD STANDARD — 2-SECOND TEST ★★★
ก่อนให้ score ทุกภาพ ถามตัวเองว่า:
"ถ้าคนดูเห็นภาพนี้ 2 วินาที พวกเขาจะเข้าใจว่าข่าวนี้พูดถึง '${identity?.coreStory?.celebratedAction || 'เรื่องหลักในข่าว'}' ไหม?"
- ถ้าใช่ → score สูง (7-10)
- ถ้าไม่ใช่ → score ต่ำ (1-4)

🎯 สิ่งที่ข่าวนี้ต้องการยกย่อง (celebratedAction):
"${identity?.coreStory?.celebratedAction || identity?.coreStory?.emotionalHook || 'ไม่ระบุ'}"

🔗 ความสัมพันธ์หลัก: "${identity?.coreStory?.relationship || 'ไม่ระบุ'}"

⛔⛔⛔ STORY FORBIDDEN — SCORE = 0 ทันที ⛔⛔⛔
สิ่งต่อไปนี้ห้ามใช้เป็น dominant visual ในข่าวนี้:
${(identity?.coreStory?.negativeFocus || []).map(f => `- ${f}`).join('\n') || '- (ไม่มี negativeFocus)'}
- ถ้าภาพมี element เหล่านี้เป็นใจกลาง (>30% ของภาพ) → score = 0, role = REJECT
- ยกเว้น: ปรากฏในภาพแต่ไม่ใช่ main subject → ลด score 3 คะแนน (ยังใช้ได้ถ้าจำเป็น)

✅ ภาพที่ได้ score สูงสำหรับข่าวนี้ (8-10):
- ภาพ ${mainChar} กับ ${identity?.coreStory?.relationship || 'ตัวละครรอง'} (แม่-ลูก, การดูแล, อ้อมกอด)
- ภาพ ${mainChar} กำลัง${identity?.coreStory?.celebratedAction || 'ทำกิจกรรมหลักในข่าว'}
- ภาพใบหน้า ${identity?.coreStory?.relationship || 'ตัวละครรอง'} (emotional proof)
- ภาพ ${mainChar} ในบริบทการดูแล/ช่วยเหลือ (ป้อนข้าว, ดูแลข้างเตียง, กอด)

มีภาพ ${imageParts.length} ภาพ (index 0 ถึง ${imageParts.length - 1}) ให้ตัดสิน

=== ★★★ กฎสำคัญที่สุด: ตรวจสอบตัวตนคน! ===
- ภาพในแต่ละรูปต้องเป็น ${mainChar} จริงๆ! ห้ามเอาภาพคนอื่นมา!
- ถ้าภาพเป็นคนละคน คนละเชื้อชาติ คนละวงการ → REJECT ทันที!
  ตัวอย่าง: ข่าว "เจนนี่ ได้หมดถ้าสดชื่น" แต่ภาพเป็น Jennie BLACKPINK → REJECT!
- ดูบริบทภาพ: ถ้ามีข้อมูลใน metadata/label ที่ชี้ว่าเป็นคนอื่น → REJECT!

=== ★★★ กฎสำคัญเท่ากัน: ตรวจสอบความเกี่ยวข้องกับข่าว! ===
- ภาพต้องเกี่ยวกับเนื้อหาข่าว! ไม่ใช่แค่ภาพคนถูกคน!
- ★★★ ภาพ ${mainChar} ที่สวยแต่ไม่เกี่ยวข่าว (แฟชั่น/ท่องเที่ยว/ชายหาด/ไลฟ์สไตล์/งานอีเวนท์อื่น) → score = 4 (ต่ำแต่ยังใช้ได้)
- ตัวอย่าง: ข่าว "ก้อย รัชวิน บริจาคโรงเรียน" แต่ภาพเป็นก้อยถ่ายแบบริมทะเล → score = 4 (คนถูก แต่บริบทผิด!)
- ตัวอย่าง: ข่าว "ก้อย รัชวิน บริจาคโรงเรียน" ภาพก้อยถ่ายกับเด็กนักเรียน → score 9! (คนถูก + บริบทถูก!)
- ★ เน้นเลือกภาพที่ "เล่าเรื่อง" ข่าว ไม่ใช่ภาพ "สวย" ของคน!

=== ROLE ASSIGNMENTS ===

★ สัดส่วนที่ดีสำหรับปกข่าวไวรัล:
  ภาพคน (HERO+PERSON_SUPPORT): 2-3 ภาพ
  ภาพเล่าเรื่อง (KEY_ACTIVITY+CONTEXT+RELATIONSHIP+EVIDENCE): 2-3 ภาพ
  ★ ต้องมีภาพ "เล่าเรื่อง" อย่างน้อย 2 ภาพ! ห้ามมีแค่ภาพหน้าคน!

🏷️ HERO_FACE (1 ภาพ — สำคัญที่สุด!):
- ภาพ close-up หน้า ${mainChar} ที่คมชัดที่สุด
- ใบหน้ากินพื้นที่ >30% ของเฟรม
- ⚠️ ไม่จำเป็นต้องมาจากข่าวนี้! ภาพจาก Social media, สัมภาษณ์, อีเวนท์ ใช้ได้!
- ⚠️ ต้องเป็น ${mainChar} จริงๆ! ไม่ใช่คนอื่นที่ชื่อคล้ายกัน!
- Score 7-10

🏷️ PERSON_SUPPORT (0-1 ภาพเท่านั้น!):
- ภาพ ${mainChar} ในบริบทที่เกี่ยวกับข่าว เท่านั้น!
- ★★★ ภาพ ${mainChar} ที่สวยแต่ไม่เกี่ยวข่าว → Score = 4 เท่านั้น!
  ❌ ภาพถ่ายแบบ/แฟชั่น/ท่องเที่ยว/ชายหาด/งานอีเวนท์อื่น → score = 4
  ❌ ภาพคู่กับคนรัก/ครอบครัว ที่ไม่เกี่ยวกับข่าว → score = 4
  ✅ ภาพ ${mainChar} ในบริบทข่าว (เช่น ถ่ายกับเด็กนักเรียน) → score 6-7
- ★ จำกัดแค่ 0-1 ภาพ! ห้ามเกิน 1 ภาพ!
- Score 4-7 (ขึ้นกับบริบท)

🏷️ KEY_ACTIVITY (1-2 ภาพ — ★ สำคัญมาก!):
- ★★★ ภาพกิจกรรม/การกระทำหลักในข่าว
- เช่น: ภาพไลฟ์สด, ภาพทำสวน, ภาพช่วยหมา, ภาพทำอาหาร, ภาพบริจาค
- ภาพที่เห็นแล้วรู้ว่า "ข่าวนี้เกี่ยวกับอะไร" โดยไม่ต้องอ่าน!
- ★ ถ้ามีภาพ ${mainChar} กำลังทำกิจกรรมที่เกี่ยวกับข่าว → Score 8-9!
- Score 6-9

🏷️ TIMELINE_PAST (0-1 ภาพ — ถ้าข่าวมีไทม์ไลน์):
- ภาพอดีต/สมัยหนุ่มสาว ที่เห็นความเปลี่ยนแปลง
- เช่น: ภาพแต่งงาน, ภาพสมัยเด็ก, ภาพยุคทำละคร
- Score 6-8

🏷️ EMOTION (0-1 ภาพ):
- Close-up อารมณ์ — ร้องไห้, ตกใจ, โกรธ, ยิ้ม, เศร้า
- ต้องเห็น ${mainChar} แสดงอารมณ์ชัดเจน

🏷️ RELATIONSHIP (0-1 ภาพ):
- ภาพ ${mainChar} กับคนอื่น — ต้องเกี่ยวกับข่าว!
- ★ ภาพคู่กับตัวละครรองในข่าว + บริบทตรง → score 6-8
- ★ ภาพคู่/ครอบครัว ที่ไม่เกี่ยวข่าว (งานแต่ง/ท่องเที่ยว/อีเวนท์อื่น) → score = 4

🏷️ CONTEXT_SCENE (0-2 ภาพ):
- Wide shot สถานที่/เหตุการณ์/บริบท — ภาพกว้างไม่ใช่ portrait!
- ★ กลุ่มคน (เด็กนักเรียน, ผู้เข้าร่วม) ในฉากที่เกี่ยวข่าว → CONTEXT_SCENE score 6-8
- ★ ภาพป้ายสถานที่ = EVIDENCE ไม่ใช่ CONTEXT_SCENE
- ★★★ ห้ามเอาภาพ portrait/closeup ของคนแปลกหน้ามาเป็น CONTEXT_SCENE!

🏷️ EVIDENCE (0-1 ภาพ):
- ป้ายจริง, เอกสาร, หลักฐาน, แอป, screenshot ที่เกี่ยวกับข่าว
- ★★ text บนป้ายจริง ≠ text overlay → ห้าม reject ป้ายจริง!

=== ❌ REJECT ทันที (score = 0, role = "REJECT") ===
1. ★★★ ภาพคนผิดคน! ไม่ใช่ ${mainChar} → REJECT ทันที!
   - ★★★ ภาพ portrait/closeup ของคนแปลกหน้า (ไม่ใช่ ${mainChar}) → REJECT!
   - ★★★ ภาพบัตรนักศึกษา/yearbook/ID photo ของคนอื่น → REJECT!
   - ★ ยกเว้น: ภาพกลุ่มคน (group shot) ที่ไม่มี ${mainChar} → ใช้เป็น CONTEXT_SCENE ได้ (score 5-7)
   - ★ ยกเว้น: ภาพ wide shot สถานที่ที่มีคนเดินผ่าน → ใช้เป็น CONTEXT_SCENE ได้
2. ภาพเบลอ, pixelated, resolution ต่ำมาก
3. Stock photo — ภาพ generic ไม่มีตัวละครจริง
3b. ★★★ ภาพการ์ตูน / illustration / clip art / vector / AI-generated → REJECT ทันที!
    - ภาพวาด, ภาพกราฟิก, ภาพ 3D render
    - ภาพจาก stock ที่ไม่ใช่ภาพถ่ายจริง
    - infographic / diagram / chart
3c. ★★★ ภาพทางการแพทย์ / โฆษณา / สินค้า → REJECT ทันที!
    - ภาพอวัยวะ / แผนภาพกายวิภาค / medical diagram
    - โฆษณาครีม / สกินแคร์ / คลินิกความงาม / โฆษณาสินค้า
    - before-after ผิว / สิว / ศัลยกรรม
    - ภาพที่มีชื่อสินค้า/แบรนด์เด่น
4. ★★★ มี "text แต่งเติม" (designed text) ซ้อนทับภาพ → REJECT:
   - headline ข่าว / หัวข้อข่าวซ้อนทับด้วย font สี
   - subtitle / lower-third / caption bar
   - text banner สี / แถบข้อความ / กราฟิกข่าว
   - ชื่อรายการ / โลโก้ข่าว / โลโก้ช่อง ขนาดใหญ่
   - ปกข่าว / ปกคลิป / YouTube thumbnail ที่มี text ออกแบบ
   - ลายน้ำ (watermark) ขนาดใหญ่กลางภาพ
   - ข้อความโฆษณา / promotion / แบนเนอร์
5. เป็น designed cover / thumbnail / collage / ปกคลิป
6. Screenshot จอทีวี / screenshot ข่าว (มีกรอบรายการ, logo ช่อง)
7. ภาพ collage ปก — หลายภาพจัดเรียงเป็น layout

⚠️ ★★★ ข้อยกเว้นสำคัญมาก — "text ธรรมชาติ" ห้าม REJECT!
"text ธรรมชาติ" = ตัวหนังสือที่อยู่ในโลกจริง ถ่ายติดมาตามธรรมชาติ เช่น:
- ป้ายโรงเรียน / ป้ายโรงพยาบาล / ป้ายสถานที่
- ป้ายบอกชื่อผู้บริจาค / แผ่นป้ายเกียรติคุณ
- ป้ายงานอีเวนต์จริง / แบนเนอร์งานจริง
- ป้ายถนน / ป้ายร้านค้า / ป้ายประกาศจริง
- เอกสารจริง / ใบประกาศ / ใบเสร็จ
→ ภาพเหล่านี้เป็น EVIDENCE ที่มีค่ามาก! ให้ score ≥ 7 + role = EVIDENCE

วิธีแยก: 
- text แต่งเติม = font สวย สีสด มี drop shadow/outline อยู่ "ลอย" บนภาพ → REJECT
- text ธรรมชาติ = อยู่บนป้าย/กระดาน/ผนัง ในฉากจริง มีมิติ 3D → KEEP (EVIDENCE)

⚠️ ข้อยกเว้นอื่น — ห้าม REJECT ภาพเหล่านี้:
- ภาพ ${mainChar} ที่ชัดแต่มี text เบาๆ ที่มุม → score ≥ 4 (PERSON_SUPPORT)
- ภาพ ${mainChar} ที่มี watermark เล็กๆ ที่มุม → score ≥ 4
- ภาพ ${mainChar} จากโซเชียล (TikTok, Instagram, YouTube) ที่เห็นหน้าชัด → score ≥ 5

=== SCORING GUIDE ===
- 9-10: สมบูรณ์แบบ คมชัดสุด ไม่มี text ไม่มี watermark
- 7-8: ดีมาก ใช้ได้ชัวร์
- 5-6: พอใช้ได้ อาจมี text เบาๆ แต่เห็นคนชัด
- 4: มีปัญหาบ้าง แต่ยังใช้ได้ถ้าจำเป็น
- 1-3: ปัญหาชัดเจน
- 0: REJECT

=== OUTPUT FORMAT ===
Return JSON array เท่านั้น ห้ามมี markdown blocks ห้ามมี \`\`\`
ตัดสินทุกภาพ (แม้แต่ REJECT ก็ต้องใส่ score=0)
★ ต้องมีภาพ ${mainChar} อย่างน้อย 2 ภาพ (1 HERO_FACE + 1 KEY_ACTIVITY/CONTEXT_SCENE/RELATIONSHIP)
★ ต้องมีภาพเล่าเรื่อง (KEY_ACTIVITY/CONTEXT/RELATIONSHIP/EVIDENCE) อย่างน้อย 2 ภาพ
★ PERSON_SUPPORT ห้ามเกิน 1 ภาพ! เน้นเอาภาพเล่าเรื่องแทน!

[{"index": 0, "score": 10, "role": "HERO_FACE", "reason": "..."}, {"index": 1, "score": 9, "role": "KEY_ACTIVITY", "reason": "ภาพไลฟ์สดตรงกับข่าว"}, {"index": 5, "score": 0, "role": "REJECT", "reason": "คนผิดคน ไม่ใช่ตัวละครในข่าว"}]`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

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

      // ★ POST-PROCESSING: ลด score ภาพจาก stock/generic domains
      const STOCK_DOMAINS = ['shutterstock', 'istock', 'freepik', 'pexels', 'pixabay', '123rf', 'dreamstime', 'gettyimages', 'unsplash', 'canva', 'depositphotos', 'adobe.stock', 'rawpixel'];
      const GENERIC_DOMAINS = ['pinterest', 'aliexpress', 'shopee', 'lazada', 'amazon', 'ebay'];
      
      for (const item of parsed) {
        if (item.index >= 0 && item.index < validCandidates.length) {
          try {
            const imgUrl = new URL(validCandidates[item.index]);
            const host = imgUrl.hostname.toLowerCase();
            const isStock = STOCK_DOMAINS.some(d => host.includes(d));
            const isGeneric = GENERIC_DOMAINS.some(d => host.includes(d));
            
            if (isStock) {
              const oldScore = item.score;
              item.score = 0;
              item.role = 'REJECT';
              item.reason = `[AUTO-REJECT] Stock photo from ${host} (was score ${oldScore})`;
              console.log(`[Judge] 🚫 AUTO-REJECT stock: #${item.index} from ${host} (was ${oldScore})`);
            } else if (isGeneric) {
              const oldScore = item.score;
              item.score = Math.max(0, item.score - 4);
              item.reason = `[AUTO-PENALIZED] Generic source ${host}: ${oldScore} → ${item.score}`;
              console.log(`[Judge] ⚠️ Penalized generic: #${item.index} from ${host} (${oldScore} → ${item.score})`);
            }
          } catch {}
        }
      }
      
      // แยก accepted vs rejected สำหรับ log — ★ ลดเกณฑ์จาก 5 → 4 เพื่อให้ได้ภาพเพียงพอ
      const accepted = parsed.filter(s => s.score >= 4);
      const nearMiss = parsed.filter(s => s.score === 3);
      const rejected = parsed.filter(s => s.score < 3);

      console.log(`[Judge] AI scores: ${parsed.map(s => `#${s.index}=${s.score}(${s.role})`).join(', ')}`);
      console.log(`[Judge] 📊 Accepted(≥4): ${accepted.length}, Near-miss(3): ${nearMiss.length}, Rejected(<3): ${rejected.length}`);

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

    console.log('[Judge] ⚠️ Could not parse AI response, trying GPT-4o fallback...');
    return await judgeWithFallback(validCandidates, imageParts, prompt, newsTitle, identity);
  } catch (e) {
    console.log('[Judge] ❌ Gemini Vision Error:', e.message?.substring(0, 80));
    console.log('[Judge] 🔄 Trying GPT-4o Vision fallback...');
    return await judgeWithFallback(validCandidates, imageParts, prompt, newsTitle, identity);
  }
}

// ★★★ GPT-4o Vision Fallback Judge ★★★
async function judgeWithFallback(validCandidates, imageParts, prompt, newsTitle, identity) {
  // === Attempt 1: GPT-4o Vision ===
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      console.log('[Judge Fallback] 📤 Sending to GPT-4o Vision...');
      
      // สร้าง content array สำหรับ GPT-4o (text + images)
      const gptContent = [{ type: 'text', text: prompt }];
      
      // เพิ่มภาพ (จำกัด 28 ภาพ — ต้องครอบคลุม context/evidence ที่อยู่ท้ายด้วย!)
      const maxImages = Math.min(imageParts.length, 28);
      for (let i = 0; i < maxImages; i++) {
        const part = imageParts[i];
        if (part?.inlineData) {
          gptContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
              detail: 'low' // ประหยัด token
            }
          });
        }
      }

      // ★ GPT-5.5 compatibility
      const _isNew = MODEL_VISION.startsWith('gpt-5') || MODEL_VISION.startsWith('o1') || MODEL_VISION.startsWith('o3');
      const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODEL_VISION,
          messages: [{ role: 'user', content: gptContent }],
          ...(_isNew ? { max_completion_tokens: 4000 } : { max_tokens: 4000 }),
          ...(_isNew ? {} : { temperature: 0.2 })
        })
      });

      if (gptRes.ok) {
        const gptData = await gptRes.json();
        const gptText = gptData.choices?.[0]?.message?.content || '';
        const gptMatch = gptText.match(/\[\s*\{[\s\S]*\}\s*\]/);
        
        if (gptMatch) {
          const parsed = JSON.parse(gptMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`[Judge Fallback] ✅ GPT-4o scored ${parsed.length} images`);
            return processJudgeResults(parsed, validCandidates);
          }
        }
        console.log('[Judge Fallback] ⚠️ GPT-4o returned unparseable response');
      } else {
        const errData = await gptRes.json().catch(() => ({}));
        console.log(`[Judge Fallback] ❌ GPT-4o HTTP ${gptRes.status}: ${errData.error?.message?.substring(0, 80) || ''}`);
      }
    } catch (gptErr) {
      console.log(`[Judge Fallback] ❌ GPT-4o Error: ${gptErr.message?.substring(0, 80)}`);
    }
  }

  // === Attempt 2: Claude Sonnet Vision ===
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      console.log('[Judge Fallback] 📤 Sending to Claude Sonnet Vision...');
      
      const claudeContent = [{ type: 'text', text: prompt }];
      const maxImages = Math.min(imageParts.length, 28);
      for (let i = 0; i < maxImages; i++) {
        const part = imageParts[i];
        if (part?.inlineData) {
          claudeContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.inlineData.mimeType,
              data: part.inlineData.data
            }
          });
        }
      }

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{ role: 'user', content: claudeContent }]
        })
      });

      if (claudeRes.ok) {
        const claudeData = await claudeRes.json();
        const claudeText = claudeData.content?.[0]?.text || '';
        const claudeMatch = claudeText.match(/\[\s*\{[\s\S]*\}\s*\]/);
        
        if (claudeMatch) {
          const parsed = JSON.parse(claudeMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`[Judge Fallback] ✅ Claude scored ${parsed.length} images`);
            return processJudgeResults(parsed, validCandidates);
          }
        }
        console.log('[Judge Fallback] ⚠️ Claude returned unparseable response');
      } else {
        const errData = await claudeRes.json().catch(() => ({}));
        console.log(`[Judge Fallback] ❌ Claude HTTP ${claudeRes.status}: ${errData.error?.message?.substring(0, 80) || ''}`);
      }
    } catch (claudeErr) {
      console.log(`[Judge Fallback] ❌ Claude Error: ${claudeErr.message?.substring(0, 80)}`);
    }
  }

  // === Last Resort: Random (ไม่ควรถึงจุดนี้) ===
  console.log('[Judge Fallback] ⚠️ All AI providers failed! Using random fallback (last resort)');
  return fallbackSelection(validCandidates);
}

// ★ แยก processJudgeResults ออกมาเพื่อใช้ร่วมกัน (Gemini, GPT-4o, Claude)
function processJudgeResults(parsed, validCandidates) {
  const accepted = parsed.filter(s => s.score >= 4);
  const nearMiss = parsed.filter(s => s.score === 3);
  const rejected = parsed.filter(s => s.score < 3);

  console.log(`[Judge] AI scores: ${parsed.map(s => `#${s.index}=${s.score}(${s.role})`).join(', ')}`);
  console.log(`[Judge] 📊 Accepted(≥4): ${accepted.length}, Near-miss(3): ${nearMiss.length}, Rejected(<3): ${rejected.length}`);

  let heroAssigned = false;
  const HERO_ROLE = 'HERO_FACE';

  const validScores = accepted
    .filter(s => s.index >= 0 && s.index < validCandidates.length)
    .sort((a, b) => {
      if (a.role === HERO_ROLE && b.role !== HERO_ROLE) return -1;
      if (b.role === HERO_ROLE && a.role !== HERO_ROLE) return 1;
      return b.score - a.score;
    });

  const selectedImages = [];
  for (const s of validScores) {
    let role = s.role || 'CONTEXT_SCENE';
    if (role === HERO_ROLE) {
      if (heroAssigned) role = 'EMOTION';
      else heroAssigned = true;
    }
    selectedImages.push({ url: validCandidates[s.index], role, score: s.score });
  }

  if (selectedImages.length > 0) {
    // Supplement: near-miss
    if (selectedImages.length < 5 && nearMiss.length > 0) {
      const selectedUrls = new Set(selectedImages.map(i => i.url));
      const sortedNearMiss = nearMiss
        .filter(s => s.index >= 0 && s.index < validCandidates.length)
        .sort((a, b) => b.score - a.score);
      for (const s of sortedNearMiss) {
        if (selectedImages.length >= 8) break;
        const url = validCandidates[s.index];
        if (!selectedUrls.has(url)) {
          selectedImages.push({ url, role: s.role === 'REJECT' ? 'SUPPORT' : (s.role || 'SUPPORT'), score: s.score });
          selectedUrls.add(url);
        }
      }
      console.log(`[Judge] 📦 Supplemented with near-miss → total ${selectedImages.length}`);
    }

    // Low-scored supplement
    if (selectedImages.length < 4) {
      const selectedUrls = new Set(selectedImages.map(i => i.url));
      const lowScored = rejected
        .filter(s => s.score > 0 && s.index >= 0 && s.index < validCandidates.length)
        .sort((a, b) => b.score - a.score);
      for (const s of lowScored) {
        if (selectedImages.length >= 6) break;
        const url = validCandidates[s.index];
        if (!selectedUrls.has(url)) {
          selectedImages.push({ url, role: 'SUPPORT', score: s.score });
          selectedUrls.add(url);
        }
      }
      if (lowScored.length > 0) {
        console.log(`[Judge] 📦 Added low-scored supplements → total ${selectedImages.length}`);
      }
    }

    const roleCounts = {};
    for (const img of selectedImages) {
      roleCounts[img.role] = (roleCounts[img.role] || 0) + 1;
    }
    const roleStr = Object.entries(roleCounts).map(([r, c]) => `${c} ${r}`).join(', ');
    console.log(`[Judge] ✅ Selected ${selectedImages.length} images: ${roleStr}`);
    return selectedImages;
  }

  return fallbackSelection(validCandidates);
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

  // Run all agents in parallel — ★ เพิ่ม Agent 4: Tavily AI Search
  let tavilyPromise = Promise.resolve([]);
  try {
    const { tavilyImageSearch, isTavilyAvailable } = await import('@/lib/services/tavilyService');
    if (isTavilyAvailable()) {
      const sq = identity?.searchQueries || {};
      const tavilyQuery = identity?.coreImageQueries?.[0] || sq.person_context || sq.key_activity || identity?.searchGoogle || newsTitle || '';
      if (tavilyQuery) {
        tavilyPromise = tavilyImageSearch(tavilyQuery).catch(() => []);
      }
    }
  } catch { /* Tavily not available */ }

  const [googleResult, youtubeResult, contextResult, tavilyResult] = await Promise.allSettled([
    agentGoogleCleanImages(identity),
    agentYouTubeFrames(identity),
    agentContextImages(identity),
    tavilyPromise
  ]);

  // Collect results from each agent
  const googleImages = googleResult.status === 'fulfilled' ? googleResult.value : [];
  const youtubeImages = youtubeResult.status === 'fulfilled' ? youtubeResult.value : [];
  const contextImages = contextResult.status === 'fulfilled' ? contextResult.value : [];
  const tavilyImages = tavilyResult.status === 'fulfilled' ? (tavilyResult.value || []).filter(u => typeof u === 'string' && u.startsWith('http')) : [];

  console.log('============================================');
  console.log(`[MultiAgent] Agent results:`);
  console.log(`  Agent 1 (Google):   ${googleImages.length} images ${googleResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + googleResult.reason : ''}`);
  console.log(`  Agent 2 (YouTube):  ${youtubeImages.length} frames ${youtubeResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + youtubeResult.reason : ''}`);
  console.log(`  Agent 3 (Context):  ${contextImages.length} images ${contextResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + contextResult.reason : ''}`);
  console.log(`  Agent 4 (Tavily):   ${tavilyImages.length} images ${tavilyResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + tavilyResult.reason : ''}`);

  // ══════════════════════════════════════════════════════════════
  // ★ CANDIDATE DISTRIBUTION REPORT
  // จัดหมวดหมู่ภาพทั้งหมดจาก query label + metadata
  // ไม่ใช้ Vision API — ใช้ keyword matching บน title/queryText
  // ══════════════════════════════════════════════════════════════
  {
    const negFocus = (identity?.coreStory?.negativeFocus || []).map(f => f.toLowerCase());
    const coreQueries = (identity?.coreImageQueries || []).map(q => q.toLowerCase());
    const allMeta = [
      ...((googleResult.value?._meta) || []),
      ...contextImages.map((url, i) => ({ url, queryLabel: `context-${i}`, queryText: '' })),
      ...youtubeImages.map((url, i) => ({ url, queryLabel: 'youtube-core', queryText: coreQueries[0] || '' })),
      ...tavilyImages.map((url, i) => ({ url, queryLabel: 'tavily-core', queryText: coreQueries[0] || '' })),
    ];

    function categorizeImage(meta) {
      const text = `${meta.title} ${meta.source} ${meta.link} ${meta.queryLabel} ${meta.queryText}`.toLowerCase();
      // ★ Forbidden categories (from negativeFocus)
      if (negFocus.some(nf => text.includes(nf))) {
        if (/ช้าง|elephant|งาช้าง|pachyderm/.test(text)) return 'elephant';
        return 'occupation';
      }
      if (/ช้าง|elephant|งาช้าง/.test(text)) return 'elephant';
      if (/สัตวแพทย์|veterinar|animal clinic|zoo/.test(text)) return 'occupation';
      // ★ Story categories
      if (/แม่|มารดา|mother|mom|อัลไซ|alzheimer/.test(text)) return 'mother';
      if (/ดูแล|caregiving|ป้อน|bedside|ช่วยเหลือ|feeding/.test(text)) return 'caregiving';
      if (/ครอบครัว|family|พ่อแม่|พ่อ|พ่อ|น้อง/.test(text)) return 'family';
      // ★ Core query = story relevant by default
      if (meta.queryLabel?.startsWith('core:') || meta.queryLabel === 'youtube-core' || meta.queryLabel === 'tavily-core') return 'family';
      return 'unrelated';
    }

    const dist = { mother: 0, caregiving: 0, family: 0, occupation: 0, elephant: 0, unrelated: 0 };
    for (const meta of allMeta) {
      const cat = categorizeImage(meta);
      dist[cat] = (dist[cat] || 0) + 1;
    }
    const total = allMeta.length || 1;
    const pct = (n) => `${n} (${((n/total)*100).toFixed(1)}%)`;

    console.log('============================================');
    console.log('[MultiAgent] ★ CANDIDATE DISTRIBUTION REPORT');
    console.log(`  ✅ mother:      ${pct(dist.mother)}`);
    console.log(`  ✅ caregiving:  ${pct(dist.caregiving)}`);
    console.log(`  ✅ family:      ${pct(dist.family)}`);
    console.log(`  ⛔ occupation:  ${pct(dist.occupation)}`);
    console.log(`  ⛔ elephant:    ${pct(dist.elephant)}`);
    console.log(`  ❓ unrelated:  ${pct(dist.unrelated)}`);
    console.log(`  Total:          ${total} images`);
    console.log('============================================');

    const forbiddenPct = (dist.occupation + dist.elephant) / total;
    if (forbiddenPct > 0.2 && total > 10) {
      console.log(`[MultiAgent] ❌ SEARCH STAGE FAIL: occupation+elephant = ${(forbiddenPct*100).toFixed(1)}% > 20% threshold`);
      console.log(`[MultiAgent]    Root cause: search queries still returning forbidden content`);
      console.log(`[MultiAgent]    Continuing pipeline but cover quality will be poor — check QUERY OVERRIDE logs above`);
      // ★ ไม่ fail hard ตอนนี้ — log เพื่อ debug ก่อน
      // TODO: return { error: 'SEARCH_STAGE_FAIL', dist } เมื่อ fix สมบูรณ์
    } else if (forbiddenPct <= 0.2) {
      console.log(`[MultiAgent] ✅ SEARCH STAGE PASS: forbidden content = ${(forbiddenPct*100).toFixed(1)}% ≤ 20%`);
    }
  }

  // ★★★ จัดลำดับความสำคัญ — ตัวละครหลักต้องมาก่อน!
  // Priority: ตัวละครหลัก (18 ภาพ) → บริบท/สถานที่ (8 ภาพ) → YouTube (4 ภาพ)
  // เหตุผล: ปกต้องมีทั้งภาพคน + ภาพบริบทข่าว (หมา, สถานที่, หลักฐาน)
  // ★ ใช้ TRUE INTERLEAVE: สลับ 2 คน + 1 บริบท ซ้ำๆ
  // ไม่ให้ภาพคนท่วม 14 ตำแหน่งแรก → context ตกรอบ Judge!
  
  const prioritized = [];
  const seen = new Set();
  
  // สร้าง queue แยก: Google (ภาพคน) vs Context (ภาพบริบท) + Tavily (AI search)
  const googleQueue = googleImages.filter(img => !seen.has(img));
  const contextQueue = [
    ...contextImages.filter(img => !googleQueue.includes(img)),
    ...tavilyImages.filter(img => !googleQueue.includes(img) && !contextImages.includes(img)),
  ]; // ★ รวม Tavily เข้า context queue
  const ytQueue = youtubeImages.filter(img => !googleQueue.includes(img) && !contextQueue.includes(img));
  
  let gIdx = 0, cIdx = 0, yIdx = 0;
  
  // ★ Interleave: 2 คน → 1 บริบท → 2 คน → 1 บริบท → ...
  while (prioritized.length < 30) {
    // ใส่ภาพคน 2 ภาพ (ค้นจากชื่อ → ได้ภาพคนถูกคน)
    let personAdded = 0;
    while (personAdded < 2 && gIdx < googleQueue.length) {
      const img = googleQueue[gIdx++];
      if (!seen.has(img)) {
        seen.add(img);
        prioritized.push(img);
        personAdded++;
      }
    }
    
    // ใส่ภาพบริบท 1 ภาพ (ค้นจากสถานที่ → อาจได้เหตุการณ์อื่น)
    while (cIdx < contextQueue.length) {
      const img = contextQueue[cIdx++];
      if (!seen.has(img)) {
        seen.add(img);
        prioritized.push(img);
        break; // แค่ 1 ภาพ
      }
    }
    
    // ถ้าทั้ง Google และ Context หมดแล้ว → ใส่ YouTube
    if (gIdx >= googleQueue.length && cIdx >= contextQueue.length) {
      while (yIdx < ytQueue.length && prioritized.length < 30) {
        const img = ytQueue[yIdx++];
        if (!seen.has(img)) {
          seen.add(img);
          prioritized.push(img);
        }
      }
      break;
    }
  }
  
  let candidates = prioritized;
  if (candidates.length > 30) {
    candidates = candidates.slice(0, 30);
  }
  const personCount = Math.min(gIdx, googleQueue.length);
  const contextCount = Math.min(cIdx, contextQueue.length);
  const ytCount = prioritized.length - personCount - contextCount;
  console.log(`[MultiAgent] ★ Interleaved: ${candidates.length} candidates (Person ~${personCount} ↔ Context ~${contextCount} + YT ~${Math.max(0, ytCount)})`);

  console.log(`[MultiAgent] 🏛️ Sending ${candidates.length} candidates to AI Judge...`);
  console.log('============================================');

  const selectedImages = await judgeImages(candidates, newsTitle, identity);

  console.log('============================================');
  console.log(`[MultiAgent] 🏁 Final selection: ${selectedImages.length} images`);
  console.log('============================================');

  return selectedImages;
}
