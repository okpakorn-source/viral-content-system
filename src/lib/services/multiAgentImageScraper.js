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
  // ★ Stock photo sites — ห้ามเด็ดขาด (ภาพไม่ใช่คนในข่าว!)
  'shutterstock.com', 'istockphoto.com', 'freepik.com', 'pexels.com',
  'pixabay.com', '123rf.com', 'dreamstime.com',
  // ★★★ Getty Images — block ทุก CDN variant!
  'gettyimages.com', 'gettyimages.net', 'gettyimages.co.uk',
  'media.gettyimages.com', 'gi.gettyimages.com',
  'media2.gettyimages.com', 'media3.gettyimages.com',
  'unsplash.com', 'canva.com', 'depositphotos.com', 'rawpixel.com',
  'stock.adobe.com', 'alamy.com', 'bigstockphoto.com',
  'alamyimages.com', 'age.fotostock.com',
];


const BLOCKED_URL_KEYWORDS = ['logo', 'icon', 'banner', 'watermark', 'avatar', 'sprite', 'pixel', 'tracking', 'crawler', 'widget'];

// ═══ Source Reliability Score — เพิ่มก่อน Judge เพื่อ bias ภาพจากแหล่งที่เชื่อถือได้ ═══
const SOURCE_RELIABILITY = {
  // Official Social Media (highest trust)
  'instagram.com': 10,
  'facebook.com': 9,
  'youtube.com': 8,
  'tiktok.com': 7,
  'x.com': 7,
  'twitter.com': 7,
  // Thai News Sites (trusted)
  'thairath.co.th': 7,
  'khaosod.co.th': 7,
  'dailynews.co.th': 7,
  'mgronline.com': 7,
  'matichon.co.th': 7,
  'pptvhd36.com': 7,
  'ch3plus.com': 7,
  'ch7.com': 7,
  'one31.net': 7,
  'workpointtoday.com': 7,
  // Entertainment/Portal Sites
  'sanook.com': 6,
  'kapook.com': 6,
  'mthai.com': 6,
  'teenee.com': 5,
  'dek-d.com': 5,
  'pantip.com': 5,
  // Low quality sources
  'pinterest.com': 1,
  'pinterest.co.th': 1,
  'shutterstock.com': 0,
  'gettyimages.com': 0,
  'istockphoto.com': 0,
  'dreamstime.com': 0,
  'alamy.com': 0,
  '123rf.com': 0,
};

function getSourceScore(url) {
  try {
    // ★ Handle bare domain names (e.g. "thairath.co.th" from Serper's source field)
    const bare = url?.replace(/^www\./, '');
    if (bare && !bare.includes('/') && SOURCE_RELIABILITY[bare] !== undefined) {
      return SOURCE_RELIABILITY[bare];
    }
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Check exact match first
    if (SOURCE_RELIABILITY[hostname] !== undefined) return SOURCE_RELIABILITY[hostname];
    // Check parent domain (e.g., 'th.news.yahoo.com' -> 'yahoo.com')
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const parentDomain = parts.slice(-2).join('.');
      if (SOURCE_RELIABILITY[parentDomain] !== undefined) return SOURCE_RELIABILITY[parentDomain];
    }
    return 4; // default neutral score
  } catch {
    return 4;
  }
}

function isCleanImageUrl(url) {
  if (!url || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  if (BLOCKED_DOMAINS.some(domain => lower.includes(domain))) return false;
  // ★ Block Getty by URL keyword (ครอบคลุมทุก CDN path)
  if (lower.includes('gettyimages') || lower.includes('getty-images') || lower.includes('/gettyimages/')) return false;
  if (BLOCKED_URL_KEYWORDS.some(kw => lower.includes(kw))) return false;
  // Prefer direct image file URLs
  const hasImageExt = /\.(jpg|jpeg|png|webp|gif)/i.test(url);
  const isApiUrl = /\/api\//i.test(url);
  // If it's an API URL without image extension, skip it
  if (isApiUrl && !hasImageExt) return false;
  return true;
}

function sanitizeHeroName(name) {
  if (!name) return '';
  let clean = name;
  const badWords = [
    'สัตวแพทย์หญิง',
    'สัตวแพทย์',
    'ดูแลแม่ป่วยอัลไซเมอร์',
    'ดูแลแม่ป่วย',
    'ดูแลแม่อัลไซเมอร์',
    'ดูแลผู้ป่วย',
    'ป่วยอัลไซเมอร์',
    'อัลไซเมอร์',
    'ดูแลแม่',
    'ดูแลพ่อ',
    'ผู้ดูแล',
    'รักษาช้าง',
    'รักษาสัตว์',
    'รักษา',
    'บริจาค',
    'แพทย์หญิง',
    'นายแพทย์'
  ];
  for (const word of badWords) {
    const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    clean = clean.replace(regex, '');
  }
  return clean.replace(/\s+/g, ' ').trim();
}

function cleanQueryString(q, rawMainChar, mainChar) {
  if (!q) return '';
  let cleaned = q;
  if (rawMainChar && rawMainChar.length > 2) {
    const escaped = rawMainChar.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    cleaned = cleaned.replace(regex, mainChar);
  }
  return cleaned;
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

  const rawMainChar = identity?.mainCharacter || '';
  // rev.20j: ตัด "ชื่อรายการ + จังหวัด + คำว่าเด็ก/จังหวัด" ออกจากชื่อค้นภาพคน — กันได้ภาพวัด/วิว/สถานที่ (บทเรียน CASE-163 "สุโขทัย" ลากวัดเข้ามา)
  let mainChar = sanitizeHeroName(rawMainChar)
    .replace(/ปัญญาปันสุข|โหนกระแส|วู้ดดี้|ตีท้ายครัว|ทุบโต๊ะข่าว|เรื่องจริงผ่านจอ|คุยแซ่บ|รายการ\S*/g, '');
  if (identity?.location) {
    const _loc = String(identity.location).slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (_loc) mainChar = mainChar.replace(new RegExp(_loc, 'g'), '');
  }
  mainChar = mainChar.replace(/\bจังหวัด\b|^เด็ก\s|\sเด็ก(?=สุโขทัย|พิษณุโลก|จังหวัด)/g, '').replace(/\s+/g, ' ').trim() || sanitizeHeroName(rawMainChar);
  const secondaryChar = sanitizeHeroName(identity?.secondaryCharacter || '');
  // ★ storySubject: ไม่ผ่าน sanitizeHeroName เพราะต้องรักษาคำสำคัญเช่น "ดูแลแม่", "อัลไซเมอร์", "กอดแม่" ไว้ในการค้นหา
  const storySubject = identity?.coreStory?.storySubject || identity?.coreStory?.relationship || '';

  // Clean all strings in searchQueries to replace rawMainChar with mainChar
  const sq = {};
  if (identity?.searchQueries) {
    for (const [key, val] of Object.entries(identity.searchQueries)) {
      if (typeof val === 'string') {
        sq[key] = cleanQueryString(val, rawMainChar, mainChar);
      } else {
        sq[key] = val;
      }
    }
  }

  // ★ rev.14u: ข่าว "มีปม/ดราม่า" → ต้องดึงภาพ "อารมณ์/สัมภาษณ์/ครุ่นคิด" ของตัวหลักเข้าพูล
  //   เพื่อให้ HERO สื่ออารมณ์ข่าวได้ "ทุกรอบ ไม่ฟลุ๊ค" (บทเรียน CASE-107) ใช้ได้ทุกข่าวที่มีปม
  const _emoText = `${identity?.story || ''} ${identity?.coreStory?.emotionalHook || ''} ${identity?.coreStory?.storySubject || ''} ${identity?.coverEmotion || ''} ${identity?.emotion || ''} ${identity?.mainVisualShouldBe || ''}`;
  const hasConflictArc = /ปัญหา|ขัดแย้ง|แตกแยก|ห่างเหิน|ห่าง|ละเลย|เลิก|หย่า|ทะเลาะ|น้ำตา|ร้องไห้|สูญเสีย|เสียใจ|ดราม่า|drama|sad|tragedy|shock|เครียด|ป่วย|จากไป|เสียชีวิต|อาลัย|คิดถึง|เกือบ|วิกฤต|สำนึก|เปิดใจ|ตื้นตัน/.test(_emoText);

  const queries = [
    // === ภาพบุคคลหลัก ===
    { q: sq.person_portrait || mainChar || '', label: 'person portrait', num: 10 },
    { q: sq.person_closeup || (mainChar ? `${mainChar} หน้าตรง โคลสอัพ ภาพหน้าชัด` : ''), label: 'person closeup', num: 10 },
    // ★ ภาพอารมณ์/สัมภาษณ์ (เฉพาะข่าวมีปม) — ให้ hero สื่ออารมณ์
    ...(hasConflictArc && mainChar ? [
      { q: `${mainChar} สัมภาษณ์ เปิดใจ`, label: 'emotion interview', num: 10 },
      { q: `${mainChar} สีหน้าครุ่นคิด จริงจัง`, label: 'emotion reflective', num: 8 },
    ] : []),
    { q: sq.secondary_person || secondaryChar || '', label: 'secondary person', num: 8 },
    // ★★ 18 มิ.ย. (แก้ CASE-067 ลูกเยอะ-รูปเดี่ยว): โคลสอัพคนที่สอง + ภาพ "คู่ทั้งสองคน" สำหรับข่าวคู่รัก/สองฝ่าย
    { q: secondaryChar ? `${secondaryChar} หน้าตรง โคลสอัพ ภาพหน้าชัด` : '', label: 'secondary closeup', num: 8 },
    { q: (mainChar && secondaryChar) ? `${mainChar} ${secondaryChar}` : '', label: 'couple together', num: 10 },
    { q: (mainChar && secondaryChar) ? `${mainChar} ${secondaryChar} ภาพคู่` : '', label: 'couple photo', num: 8 },
    // === ★★★ storySubject direct search — ค้นสิ่งที่ข่าวเล่าถึงโดยตรงๆ! ===
    { q: storySubject && storySubject !== mainChar ? `${mainChar} ${storySubject}` : '', label: 'hero+storySubject', num: 10 },
    { q: storySubject && storySubject !== mainChar ? storySubject : '', label: 'storySubject direct', num: 8 },
    // === ★★★ Story-specific queries ===
    { q: sq.person_context || cleanQueryString(identity?.searchGoogle, rawMainChar, mainChar) || '', label: 'person context', num: 8 },
    { q: sq.event_scene || '', label: 'event scene', num: 8 },
    { q: sq.emotion_moment || '', label: 'emotion moment', num: 6 },
    { q: sq.location_photo || identity?.location || '', label: 'location', num: 6 },
    { q: sq.related_people || '', label: 'related people', num: 5 },
    { q: sq.person_emotion || '', label: 'person emotion', num: 8 },
    { q: sq.person_past || '', label: 'person past/timeline', num: 6 },
    { q: sq.key_relationship || '', label: 'key relationship', num: 8 },
    { q: sq.key_activity || '', label: 'key activity', num: 8 },
    { q: sq.story_contrast || '', label: 'story contrast', num: 6 },
    { q: sq.storySubject_direct || '', label: 'storySubject direct (AI)', num: 10 }, // ★ คำค้นตรงๆ ที่ AI สร้าง
  ].filter(q => q.q && q.q.trim());



  // ถ้าไม่มี searchQueries เลย → fallback queries เดิม
  if (queries.length === 0) {
    if (identity?.searchGoogle) queries.push({ q: cleanQueryString(identity.searchGoogle, rawMainChar, mainChar), label: 'main search', num: 10 });
    if (mainChar) queries.push({ q: mainChar, label: 'character', num: 5 });
  }

  const allMeta = []; // ★ เก็บ metadata สำหรับ Distribution Report

  for (const queryObj of queries) {
    // ★ Safeguard query: ลบคีย์เวิร์ดของช้าง/สัตว์แพทย์ออกหากเกี่ยวกับเรื่องแม่ลูก/อัลไซเมอร์
    const isAlzheimer = (identity?.story || mainChar || '').toLowerCase().match(/อัลไซเมอร์|ดูแลแม่|แม่ป่วย|ป่วยหนัก|ค่าน้ำนม/);
    if (isAlzheimer) {
      const prevQ = queryObj.q;
      queryObj.q = queryObj.q.replace(/ช้าง|elephant|สัตวแพทย์|รักษาสัตว์|หมอช้าง|vet|veterinary|animal/gi, '').replace(/\s+/g, ' ').trim();
      if (prevQ !== queryObj.q) {
        console.log(`[Agent1: Google] 🧹 Cleaned query for Alzheimer story: "${prevQ}" -> "${queryObj.q}"`);
      }
    }
    if (!queryObj.q) continue;

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

  const unique = [...new Set(allImages)].slice(0, 100);
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
  const rawMainChar = identity?.mainCharacter || '';
  const mainChar = sanitizeHeroName(rawMainChar);

  // Priority: storySubject-focused YouTube queries (DIFFERENT from Google Image queries!)
  // YouTube มี vlog/interview ที่มีเด็ก/ครอบครัว ซึ่ง Google Images ไม่มี!
  // ★ storySubject: ไม่ผ่าน sanitizeHeroName — ต้องรักษาคำเช่น "ดูแลแม่", "แม่ป่วย", "กอดแม่" ไว้สำหรับค้นหา YouTube
  const storySubject = identity?._storySubject || identity?.coreStory?.storySubject || identity?.coreStory?.relationship || '';
  const coreQueries = (identity?.coreImageQueries || []).map(q => cleanQueryString(q, rawMainChar, mainChar));
  
  const sq = {};
  if (identity?.searchQueries) {
    for (const [key, val] of Object.entries(identity.searchQueries)) {
      if (typeof val === 'string') {
        sq[key] = cleanQueryString(val, rawMainChar, mainChar);
      } else {
        sq[key] = val;
      }
    }
  }

  let youtubeQueries = [];

  // ★★★ Build YouTube-specific queries (เน้น family/children/vlog)
  if (storySubject && storySubject !== mainChar) {
    // ข่าวที่มี storySubject ชัดเจน (เช่น ลูก, แม่, พ่อ) → ค้น YouTube ตรงๆ
    youtubeQueries = [
      `${mainChar} ${storySubject}`,          // เช่น "ชมพู่ สายฟ้า พายุ"
      `${mainChar} ลูก ครอบครัว`,              // family vlog
      sq.storySubject_direct || `${mainChar} ${storySubject} วิดีโอ`, // from AI query
      sq.key_relationship || `${mainChar} ครอบครัว`,
    ].filter(q => q && q.trim() && q !== mainChar);
    console.log(`[Agent2: YouTube] ★ STORY SUBJECT mode: ${JSON.stringify(youtubeQueries)}`);
  } else if (coreQueries.length > 0) {
    youtubeQueries = coreQueries.slice(0, 3);
    console.log(`[Agent2: YouTube] ★ Using coreImageQueries: ${JSON.stringify(youtubeQueries)}`);
  } else {
    // Fallback เดิม
    const searchQuery = cleanQueryString(identity?.searchYouTube || identity?.searchGoogle || '', rawMainChar, mainChar);
    youtubeQueries = [
      searchQuery,
      sq.person_context || (mainChar && identity?.story ? `${mainChar} ${identity.story.substring(0, 30)}` : ''),
      sq.event_scene || '',
    ].filter(q => q && q.trim());
    console.log(`[Agent2: YouTube] ⚠️ No coreImageQueries, using legacy: ${JSON.stringify(youtubeQueries)}`);
  }

  // ★★★ rev.20j (ผู้ใช้ 21 มิ.ย.): ข่าว "คนธรรมดาออกรายการทีวี" — ล็อกคลิปจริงด้วย "ชื่อรายการ + ชื่อตัวละคร"
  //   บทเรียน CASE-163 (น้องข้าวหอม): ค้นยูทูปกว้างเกิน → ได้คลิปลูกเสือ/พระ/อนุบาลมั่ว (ไม่ใช่คลิปรายการตัวจริง)
  //   ภาพคนธรรมดาตัวจริงมีแค่ใน "คลิปรายการ" → ต้องค้นเจาะจงชื่อรายการก่อน
  const _showBlob = `${rawMainChar} ${identity?.story || ''} ${(identity?.keywords || []).join(' ')} ${identity?.newsTitle || ''}`;
  const _SHOWS = /ปัญญาปันสุข|โหนกระแส|วู้ดดี้|ตีท้ายครัว|ทุบโต๊ะข่าว|เรื่องจริงผ่านจอ|คุยแซ่บ|ลุยไม่รู้โรย|ฟ้ามีตา|บ่ายนี้มีคำตอบ|ดูให้รู้|ตกมันส์|3แซ่บ|โหนกระเเส/;
  const _showMatch = _showBlob.match(_SHOWS) || _showBlob.match(/รายการ\s*([ก-๙A-Za-z0-9]{2,18})/);
  const _showName = _showMatch ? (_showMatch[1] || _showMatch[0]).trim() : '';
  if (_showName) {
    // ชื่อตัวละครสะอาด: ตัดชื่อรายการ + จังหวัด + คำว่า "เด็ก/จังหวัด" ออก (เก็บ "น้องข้าวหอม" ไว้)
    let _nick = mainChar.replace(_SHOWS, '').replace(/รายการ/g, '');
    if (identity?.location) {
      const _loc = String(identity.location).slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (_loc) _nick = _nick.replace(new RegExp(_loc, 'g'), '');
    }
    _nick = _nick.replace(/เด็ก|จังหวัด/g, '').replace(/\s+/g, ' ').trim() || mainChar;
    const _showQ = `${_showName} ${_nick}`.trim();
    youtubeQueries = [_showQ, `${_showName} ${_nick} ${storySubject}`.trim(), ...youtubeQueries]
      .map(q => (q || '').trim()).filter((q, i, a) => q && q.length > 3 && a.indexOf(q) === i);
    console.log(`[Agent2: YouTube] 🎯 ล็อกคลิปรายการ: "${_showQ}" (show=${_showName})`);
  }

  // ★ Safeguard YouTube queries: ลบคีย์เวิร์ดช้าง/สัตวแพทย์สำหรับข่าวครอบครัว
  const isAlzheimer = (identity?.story || mainChar || '').toLowerCase().match(/อัลไซเมอร์|ดูแลแม่|แม่ป่วย|ป่วยหนัก|ค่าน้ำนม/);
  if (isAlzheimer) {
    youtubeQueries = youtubeQueries.map(q => 
      q.replace(/ช้าง|elephant|สัตวแพทย์|รักษาสัตว์|หมอช้าง|vet|veterinary|animal/gi, '').replace(/\s+/g, ' ').trim()
    ).filter(q => q.length > 1);
    console.log(`[Agent2: YouTube] 🧹 Cleaned YouTube queries: ${JSON.stringify(youtubeQueries)}`);
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

    const qualityFrames = [];

    // === Tier 2.8: Try Playwright Frame Capture first (highly reliable on local environment) ===
    // ★ FIX (11 มิ.ย.): Vercel serverless ไม่มี Chrome binary — การ launch browser พังแรงระดับ process
    //   (เกิน try/catch) → ข้ามไป Tier 3 storyboard (HTTP ล้วน) บน serverless
    if (process.env.VERCEL) {
      console.log('[Agent2: YouTube] ⏭️ Skip Playwright on serverless (no browser) → Tier 3 storyboard');
    } else
    try {
      console.log(`[Agent2: YouTube] 🚀 Tier 2.8: Trying Playwright frame capture...`);
      const { captureVideoFrames } = await import('@/lib/services/playwrightFrameCapture');
      const searchContext = identity?.story || mainChar || '';
      
      const playwrightFrames = [];
      // ดึงทีละวิดีโอ (จำกัดที่ 2 วิดีโอหลักเพื่อไม่ให้ช้าเกินไป)
      for (const videoId of videoIds.slice(0, 2)) {
        try {
          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const pFrames = await captureVideoFrames(videoUrl, 6, searchContext);
          if (pFrames && pFrames.length > 0) {
            playwrightFrames.push(...pFrames.map(f => ({
              url: f.url,
              source: 'youtube-playwright',
              videoId,
              width: f.width,
              height: f.height
            })));
          }
        } catch (pwVideoErr) {
          console.log(`[Agent2: YouTube] Playwright capture failed for video ${videoId}: ${pwVideoErr.message}`);
        }
      }
      
      if (playwrightFrames.length > 0) {
        console.log(`[Agent2: YouTube] ✅ Playwright frame capture succeeded! Got ${playwrightFrames.length} frames`);
        qualityFrames.push(...playwrightFrames);
      }
    } catch (pwErr) {
      console.log(`[Agent2: YouTube] ⚠️ Playwright capture not available or failed: ${pwErr.message}`);
    }

    if (qualityFrames.length === 0) {
      // === Tier 3: Extract frames จาก storyboard (ไม่ใช้ API เลย!) ===
      console.log(`[Agent2: YouTube] 🎞️ Tier 3: Extracting frames from ${videoIds.length} videos (storyboard — no API)...`);
      
      const { extractYouTubeFrames } = await import('@/lib/services/youtubeFrameExtractor');
      const frames = await extractYouTubeFrames(videoIds.slice(0, 5));

      // กรอง + upscale เฟรม (storyboard frames มักเล็ก 160x90 หรือ 320x180)
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
    }


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

  const rawMainChar = identity?.mainCharacter || '';
  const mainChar = sanitizeHeroName(rawMainChar);
  
  const sq = {};
  if (identity?.searchQueries) {
    for (const [key, val] of Object.entries(identity.searchQueries)) {
      if (typeof val === 'string') {
        sq[key] = cleanQueryString(val, rawMainChar, mainChar);
      } else {
        sq[key] = val;
      }
    }
  }
  const scenes = identity?.keyScenes || [];

  // ★★★ ใช้ coreImageQueries ชุดเดียวก่อน — เหมือนทุก Agent
  const coreQueries = (identity?.coreImageQueries || []).map(q => cleanQueryString(q, rawMainChar, mainChar));
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

  // ★ Query 7.5 (11 มิ.ย. — บทเรียน CASE-056 ปกกรรชัยล้วน 4 ช่อง ทั้งที่ข่าวมีหลายคน):
  //   ค้นภาพ "บุคคลรอง" แยกเป็นคนๆ + ภาพคู่กับตัวหลัก — ไม่งั้นคลังภาพมีแต่ตัวหลัก
  //   แล้วกฎห้ามหน้าซ้ำ/QC สลับรูป ไม่มีตัวเลือกให้ทำงานเลย
  const secondaries = [...new Set(
    [identity?.secondaryCharacter, ...(identity?.characters || [])]
      .map(c => (typeof c === 'string' ? c : c?.name || ''))
      .map(s => String(s).trim())
      .filter(n => n && n.length >= 3 && n !== rawMainChar && !rawMainChar.includes(n) && !n.includes(rawMainChar))
      // ★ ชื่อต้องค้นได้จริง — วลีบรรยาย ("ทราย ผู้เกี่ยวข้องกับตระกูล...") ค้นแล้วได้ขยะ judge คัดทิ้งหมด (CASE-057)
      .filter(n => n.length <= 30 && !/ผู้เกี่ยวข้อง|ผู้ใหญ่|คนใน|เกี่ยวกับ|ครอบครัวของ|ฝ่าย|บุคคล/.test(n))
  )].slice(0, 3);
  for (const sec of secondaries) {
    queries.push({ q: `"${sec}" ภาพจริง -ปก -cover -thumbnail ${blockTerms}`, label: `secondary: ${sec.slice(0, 20)}` });
    if (mainChar) {
      queries.push({ q: `${mainChar} ${sec} -ปก -cover ${blockTerms}`, label: `pair: ${sec.slice(0, 20)}` });
    }
  }
  if (secondaries.length > 0) console.log(`[Agent3: Context] 👥 บุคคลรอง ${secondaries.length} คน: ${secondaries.join(', ')}`);

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
    // ★ Safeguard query: ลบคีย์เวิร์ดของช้าง/สัตว์แพทย์ออกหากเกี่ยวกับเรื่องแม่ลูก/อัลไซเมอร์
    const isAlzheimer = (identity?.story || mainChar || '').toLowerCase().match(/อัลไซเมอร์|ดูแลแม่|แม่ป่วย|ป่วยหนัก|ค่าน้ำนม/);
    if (isAlzheimer) {
      const prevQ = queryObj.q;
      queryObj.q = queryObj.q.replace(/ช้าง|elephant|สัตวแพทย์|รักษาสัตว์|หมอช้าง|vet|veterinary|animal/gi, '').replace(/\s+/g, ' ').trim();
      if (prevQ !== queryObj.q) {
        console.log(`[Agent3: Context] 🧹 Cleaned query for Alzheimer story: "${prevQ}" -> "${queryObj.q}"`);
      }
    }
    if (!queryObj.q) continue;

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

  const unique = [...new Set(allImages)].slice(0, 60);
  console.log(`[Agent3: Context] ✅ Total: ${unique.length} unique context images from ${queries.length} searches`);
  return unique;
}

// ★ Fix 25: Story Anchor Keyword Extraction & Pre-Judge Batch Preparation
function getStoryAnchorKeywords(identity) {
  if (!identity) return [];
  const personWords = new Set();
  [identity.mainCharacter, identity.secondaryCharacter, ...(identity.characters || [])]
    .filter(Boolean)
    .forEach(name => {
      name.split(/[\s]+/).filter(w => w.length >= 2).forEach(w => personWords.add(w));
    });
  const GENERIC_WEAK = new Set([
    'ลูก','แม่','พ่อ','หลาน','ครอบครัว','น้อง','เอ',
    'กับ','พา','ที่','ใน','มา','ไป','ให้','ได้','กัน','อยู่','มี','เป็น','ว่า',
    'ภาพ','รูป','พร้อม','เผย','เปิด','อีก','มุม','การ','เลี้ยง','1','2',
    'คน','เรื่อง','วัน','เมื่อ','ก่อน','หลัง','แล้ว','ยัง','ก็','จะ','หรือ'
  ]);
  const strongTerms = new Set();
  const sources = [
    ...(identity.storyAnchorQueries || []),
    ...(identity.keyScenes || []),
    ...(identity.specific_details?.place_names || []),
    ...(identity.specific_details?.key_events || []),
    identity.location,
    identity.coreStory?.celebratedAction,
  ].filter(Boolean);
  for (const src of sources) {
    const words = src.split(/[\s,+/]+/).filter(w => w.length >= 2);
    for (const w of words) {
      if (!personWords.has(w) && !GENERIC_WEAK.has(w)) strongTerms.add(w);
    }
  }
  return [...strongTerms];
}

function checkStoryAnchorMatch(text, anchorKeywords) {
  if (!text || !anchorKeywords || anchorKeywords.length === 0) return false;
  const lower = text.toLowerCase();
  return anchorKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

function prepareJudgeBatch(candidates, identity) {
  if (!candidates || candidates.length === 0) return candidates;
  const anchorKeywords = getStoryAnchorKeywords(identity);
  console.log(`[StoryAnchor] 🔑 Anchor keywords (${anchorKeywords.length}): [${anchorKeywords.slice(0, 15).join(', ')}]`);
  const metaLookup = new Map();
  if (candidates._meta) {
    for (const m of candidates._meta) { if (m.url) metaLookup.set(m.url, m); }
  }
  const tagged = candidates.map((url, idx) => {
    const meta = metaLookup.get(url) || {};
    const titleText = `${meta.title || ''} ${meta.source || ''}`;
    const isAnchor = checkStoryAnchorMatch(titleText, anchorKeywords);
    return { url, idx, meta, isAnchor, title: meta.title || '' };
  });
  // Dedup: max 1 per URL, YouTube video ID, source page
  const seenUrls = new Set();
  const seenVideoIds = new Set();
  const seenSourcePages = new Set();
  const deduped = tagged.filter(item => {
    if (seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    const ytMatch = item.url.match(/(?:youtube\.com\/.*[?&]v=|youtu\.be\/|ytimg\.com\/vi\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      if (seenVideoIds.has(ytMatch[1])) return false;
      seenVideoIds.add(ytMatch[1]);
    }
    if (item.meta.link) {
      const normalizedLink = item.meta.link.replace(/[?#].*$/, '');
      if (seenSourcePages.has(normalizedLink)) return false;
      seenSourcePages.add(normalizedLink);
    }
    return true;
  });
  const dedupedCount = tagged.length - deduped.length;
  if (dedupedCount > 0) console.log(`[StoryAnchor] 🗑️ Deduped ${dedupedCount} candidates (${tagged.length} → ${deduped.length})`);
  const anchorBucket = deduped.filter(i => i.isAnchor);
  const otherBucket = deduped.filter(i => !i.isAnchor);
  console.log(`[StoryAnchor] 📦 Buckets: ${anchorBucket.length} storyAnchor, ${otherBucket.length} other`);
  if (anchorBucket.length > 0) {
    console.log(`[StoryAnchor] ★ Anchor candidates:`);
    anchorBucket.forEach(b => console.log(`  [#${b.idx}] "${b.title.substring(0, 60)}"`));
  }
  const MAX_JUDGE = 24;
  const anchorsToSend = anchorBucket.slice(0, 8);
  const othersToSend = otherBucket.slice(0, MAX_JUDGE - anchorsToSend.length);
  const batch = [...anchorsToSend, ...othersToSend];
  const resultUrls = batch.map(b => b.url);
  const anchorMap = new Map();
  for (const b of batch) { if (b.isAnchor) anchorMap.set(b.url, true); }
  return Object.assign([...resultUrls], {
    _meta: candidates._meta,
    _storyAnchorMap: anchorMap,
    _anchorKeywords: anchorKeywords,
    _bucketCounts: {
      totalBeforeDedup: tagged.length,
      totalAfterDedup: deduped.length,
      storyAnchor: anchorBucket.length,
      other: otherBucket.length,
      sentToJudge: batch.length,
    },
    _storyAnchorCandidates: anchorBucket.map(b => ({ originalIndex: b.idx, title: b.title, url: b.url })),
  });
}

// ==========================================
// AI Judge: Strict image selection with Gemini Vision
// Pre-filters by resolution & blur, then assigns cover roles:
// HERO_FACE, CONTEXT_SCENE, EVIDENCE, EMOTION, RELATIONSHIP
// ==========================================
async function judgeImages(candidates, newsTitle, identity) {
  if (!candidates || candidates.length === 0) return [];

  // ★ Fix 25: Story anchor tagging + dedup + bucket quotas before Judge
  const candidatesToDownload = prepareJudgeBatch(candidates, identity);
  console.log(`[Judge] 🔍 Downloading ${candidatesToDownload.length}/${candidates.length} candidates for AI Vision analysis...`);

  // ดาวน์โหลดเฉพาะตัวที่เลือกพร้อม metadata
  const downloadResults = await Promise.allSettled(candidatesToDownload.map(url => downloadForVision(url)));

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
      console.log(`[Judge] 🚫 Rejected (low res ${meta.width}x${meta.height}, need 350x250+): ${candidatesToDownload[i].substring(0, 70)}`);
      rejectedResolution++;
      continue;
    }

    // ★ เช็ค blur score ขั้นต่ำ 8 (ผ่อนลงนิดจาก 12 — ไม่ reject มากเกินไป)
    if (meta.blurScore !== undefined && meta.blurScore < 8) {
      console.log(`[Judge] 🚫 Rejected (too blurry, score=${meta.blurScore.toFixed(1)}, need 8+): ${candidatesToDownload[i].substring(0, 70)}`);
      rejectedBlur++;
      continue;
    }

    // ส่งเฉพาะ inlineData ให้ Vision API (ไม่ส่ง meta)
    imageParts.push({ inlineData: downloaded.inlineData });
    validCandidates.push(candidatesToDownload[i]);
  }

  console.log(`[Judge] 📊 Pre-filter: ${validCandidates.length} passed, ${rejectedResolution} low-res, ${rejectedBlur} blurry`);

  // ★ Fix 25: Transfer story anchor flags to validCandidates
  if (candidatesToDownload._storyAnchorMap) {
    validCandidates._storyAnchorMap = candidatesToDownload._storyAnchorMap;
    validCandidates._anchorKeywords = candidatesToDownload._anchorKeywords;
    validCandidates._bucketCounts = candidatesToDownload._bucketCounts;
    validCandidates._storyAnchorCandidates = candidatesToDownload._storyAnchorCandidates;
  }

  // ═══ Source Reliability Score — ให้คะแนนก่อน AI Judge ═══
  // ★ FIX: Use source page URL (from _meta.link/source) instead of image CDN URL!
  // Image CDN URLs like encrypted-tbn0.gstatic.com don't tell us the actual source.
  const _metaLookup = new Map();
  if (candidates._meta) {
    for (const m of candidates._meta) {
      if (m.url) _metaLookup.set(m.url, m);
    }
  }

  for (let i = 0; i < validCandidates.length; i++) {
    const imgUrl = validCandidates[i];
    const meta = _metaLookup.get(imgUrl);
    // ★ Use source page URL (meta.link) for scoring, NOT image CDN URL
    const sourceUrl = meta?.link || meta?.source || imgUrl;
    const sourceScore = getSourceScore(sourceUrl);
    let domain = '(unknown)';
    try { domain = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch {
      // meta.source might be just a domain name like "thairath.co.th" (not a full URL)
      domain = meta?.source || '(unknown)';
    }

    // Attach sourceScore as metadata on the URL string (will be used for sorting/tiebreak)
    // Store in a side-map since validCandidates are plain strings
    if (!validCandidates._sourceScores) validCandidates._sourceScores = {};
    validCandidates._sourceScores[imgUrl] = sourceScore;

    // Bias: trusted sources (score 5+) get a small boost in candidate ordering
    // Stock photo sites (score 0-1) get penalized by moving them down
    let bias = '';
    if (sourceScore >= 5) {
      bias = `+${Math.floor(sourceScore / 5)} boost`;
    } else if (sourceScore <= 1) {
      bias = '-2 penalty (stock/low-trust)';
    } else {
      bias = 'neutral';
    }
    console.log(`[SourceScore] #${i}: ${domain} (${sourceScore}) -> ${bias}`);
  }

  // ★ Re-sort validCandidates & imageParts by sourceScore DESC (trusted sources first → Judge sees them first)
  if (validCandidates._sourceScores && validCandidates.length > 1) {
    const indices = validCandidates.map((_, idx) => idx);
    indices.sort((a, b) => {
      const sa = validCandidates._sourceScores[validCandidates[a]] || 4;
      const sb = validCandidates._sourceScores[validCandidates[b]] || 4;
      return sb - sa; // descending — trusted sources first
    });
    const sortedCandidates = indices.map(i => validCandidates[i]);
    const sortedParts = indices.map(i => imageParts[i]);
    const savedScores = validCandidates._sourceScores;
    // Replace in-place
    for (let i = 0; i < sortedCandidates.length; i++) {
      validCandidates[i] = sortedCandidates[i];
      imageParts[i] = sortedParts[i];
    }
    validCandidates._sourceScores = savedScores;
    console.log(`[SourceScore] ✅ Re-sorted ${validCandidates.length} candidates by source reliability (trusted first)`);
  }

  if (validCandidates.length === 0) {
    console.log('[Judge] ❌ No images passed pre-filter');
    return [];
  }

  console.log(`[Judge] 📤 Sending ${imageParts.length} valid images to Gemini Vision...`);

  // ★ ย้ายมาไว้นอก try เพื่อให้ catch block เข้าถึง prompt ได้ (แก้ "prompt is not defined")
  const rawMainChar = identity?.mainCharacter || 'ตัวละครหลักในข่าว';
  const mainChar = sanitizeHeroName(rawMainChar);
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

  const prompt = `You are a Senior Photo Editor for a professional viral news agency, selecting images for a news cover.

📰 News story: "${storyContext}"
📝 Full news content: "${(newsContent || '').slice(0, 800)}"
🎭 Main character: "${mainChar}"

📦 Image source URLs:
${sourceUrlMap}

★★★ NEW RULE — Verify image source origin!
- Images from stock photo sites (shutterstock, istock, freepik, pexels, pixabay, 123rf, dreamstime, gettyimages, unsplash, canva) → REJECT immediately (score=0)! These are stock photos!
- Images from blogs/generic websites that are NOT news outlets or the subject's social media → Deduct 3 points from score!
- Images from the subject's social media (instagram, facebook, tiktok) → Normal score (acceptable)
- Images from legitimate news sites (thairath, khaosod, mgronline, pptvhd36, sanook, kapook, matichon) → Normal score (acceptable)
- ★ Check the hostname of each image listed above and evaluate alongside image content!
👤 Secondary character: "${identity?.secondaryCharacter || 'ไม่มี'}"
💢 News emotion: ${emotion} → Cover mood: ${coverEmotion}
📋 Key issues: ${keyEvents || keyScenes || 'ไม่ระบุ'}
📍 Location: ${identity?.location || 'ไม่ระบุ'}
🔑 Main activity: ${identity?.searchQueries?.key_activity || identity?.searchQueries?.event_scene || 'ไม่ระบุ'}
🎬 Desired scenes: ${keyScenes || keyEvents || 'ไม่ระบุ'}

🧠 ★★★ SMART SEARCH KEYWORDS (AI analyzed from news content) ★★★
These are the EXACT keywords used to search for images. Use them to verify if each image matches the story:
${(identity?._smartQueryKeywords || []).length > 0 ? identity._smartQueryKeywords.join(', ') : 'N/A'}

📋 Smart Search Queries used:
${(identity?.coreImageQueries || []).map((q, i) => `  ${i+1}. "${q}"`).join('\n') || '  (none)'}

🎯 Story Theme: "${identity?._smartQueryTheme || identity?.coreStory?.celebratedAction || 'ไม่ระบุ'}"

★ IMPORTANT: Images that match these smart keywords → HIGH score (7-10)!
★ Images that DON'T match any keyword but show ${mainChar} looking nice → LOW score (≤ 3)!

★★★ GOAL: Select images that TELL THE STORY of this news — NOT just "pretty" photos of the person!
- Images showing activities/locations/events from the news → High score (7-10)
- Images of ${mainChar} that look nice but are UNRELATED to the news → Low score (≤ 3!)

★★★ GOLD STANDARD — 2-SECOND TEST ★★★
Before scoring every image, ask yourself:
"If a viewer sees this image for 2 seconds, will they understand this news is about '${identity?.coreStory?.celebratedAction || 'เรื่องหลักในข่าว'}'?"
- If YES → High score (7-10)
- If NO → Low score (1-4)

🎯 What this news celebrates (celebratedAction):
"${identity?.coreStory?.celebratedAction || identity?.coreStory?.emotionalHook || 'ไม่ระบุ'}"

🔗 Key relationship: "${identity?.coreStory?.relationship || 'ไม่ระบุ'}"

★★★ STORY SUBJECT (Most important element on the cover!) ★★★
"${identity?._storySubject || identity?.coreStory?.storySubject || identity?.coreStory?.relationship || 'ไม่ระบุ'}"
→ This news is telling the story of "${identity?._storySubject || identity?.coreStory?.relationship || mainChar}"
→ Images showing this STORY SUBJECT get the highest score (8-10)
→ Images of the protagonist (${mainChar}) WITHOUT story subject → score ≤ 4
→ DO NOT give high scores to glamour/fashion/celebrity portrait images unrelated to the news!

⛔⛔⛔ FORBIDDEN — ZERO TOLERANCE — SCORE = 0 IMMEDIATELY ⛔⛔⛔
If ANY of the following appear in an image, even as a background element or in the smallest amount → score = 0, role = REJECT immediately:
${(identity?.coreStory?.negativeFocus || []).map(f => `- ${f}`).join('\n') || '- (no negativeFocus specified)'}
- Elephants or elephant care equipment (unless the news is specifically about tourism or elephants, not about family/Alzheimer's caregiving)
- Veterinary/vet/animal treatment scenes (unless the news is specifically about veterinary work, not about family devotion/Alzheimer's caregiving)
★ NO EXCEPTIONS! Even if the forbidden element appears in only 5% of the image or is in the background → REJECT!
★ DO NOT give score > 0 to ANY image containing a forbidden element!

⛔ GLAMOUR REJECT — Strictly forbidden:
- Images of ${mainChar} dressed up/red carpet/fashion/events/travel/lifestyle that are COMPLETELY UNRELATED to this news → score = 1 (MUST NOT be used as a main image!)
- Solo portrait photos of ${mainChar} without story subject or any news context → score ≤ 2
- If storySubject = "${identity?._storySubject || identity?.coreStory?.relationship || 'อื่นๆ'}" but the image contains NO storySubject, NO secondary characters/children/family/activity → score ≤ 2

${(() => {
  const st = (identity?.storyType || '').toLowerCase();
  const subj = (identity?._storySubject || identity?.coreStory?.relationship || identity?.coreStory?.storySubject || '');
  const isRel = /warm|family|relationship|romance|couple|love|marriage|wedding/.test(st)
    || /สามี|ภรรยา|คู่รัก|ครอบครัว|ความสัมพันธ์|แต่งงาน|รักกัน|คู่ชีวิต/.test(`${subj} ${identity?.story || ''}`);
  if (!isRel) return '';
  const sec = identity?.secondaryCharacter || 'คู่ของเขา';
  return `=== ★★★ RELATIONSHIP / FEEL-GOOD MODE (ข่าวความสัมพันธ์-ครอบครัว ไม่มีกิจกรรม/เหตุการณ์เฉพาะ) ★★★ ===
ตัวเรื่องคือ "ความสัมพันธ์ของ ${mainChar} กับ ${sec}" → ภาพพอร์ตเทรต/ภาพคู่ "คือเนื้อข่าวเอง" ไม่ใช่ glamour ลอยๆ ดังนั้น OVERRIDE กฎกดคะแนนพอร์ตเทรตด้านบนสำหรับข่าวแบบนี้:
- โคลสอัพ/พอร์ตเทรตหน้าตรง"เดี่ยว"ของ ${mainChar} หรือ ${sec} (จากสัมภาษณ์/รายการ/โซเชียล) = ON-STORY → score 6-8 (ห้ามตีเป็น "unrelated glamour"!)
- ภาพ"คู่สองคน" ${mainChar}+${sec} = ON-STORY ตรงแก่น → score 8-10
- ★ เก็บหน้าคมเดี่ยวของ "ทั้งสองคน" ได้หลายใบ — PERSON_SUPPORT ขยายเป็น 2-3 ใบได้ (เพื่อปกมีหน้าหลากหลาย ไม่ซ้ำคนเดิม/ท่าเดิม)
- ⛔★★★ ยังคง REJECT เด็ดขาด (สำคัญมาก — บทเรียน CASE-078 ปล่อยภาพแย่ผ่าน):
    (ก) คนผิด/คนละคน → ต้องเป็น ${mainChar} หรือ ${sec} จริงเท่านั้น ตรวจหน้าให้ชัด
    (ข) ภาพถอดเสื้อ/โชว์กล้าม/ฟิตเนส/ชุดว่ายน้ำ/ชุดชั้นใน → score 0 (ไม่เหมาะปกข่าวครอบครัว)
    (ค) เซลฟี่หน้าสดเบลอ/คุณภาพต่ำ/แสงแย่/หน้าแดง-เหงื่อ → score ≤2 (ห้ามเป็น HERO)
    (ง) เบลอ-แตก / สกรีนช็อต-แชต / ลายน้ำใหญ่ / ภาพยืนเต็มตัวฉากหลังรก
- ★ HERO ต้องเป็นภาพ "คุณภาพดี หน้าคมชัด" (สัมภาษณ์/รายการ/พอร์ตเทรตมืออาชีพ/โซเชียลที่ชัด) — ห้ามเซลฟี่หน้าสด
- ★ เป้าหมาย: ให้พูลมี "หน้าคมเดี่ยวหน้าตรงคุณภาพดี" ของทั้ง ${mainChar} และ ${sec} + ภาพคู่ ครบพอจัดปก 5 ช่องแบบไม่ต้องเอาภาพกว้าง/หมู่มาเติม

`;
})()}✅ Images that score HIGH for this news (8-10):
- ${mainChar} together with ${identity?.coreStory?.relationship || 'ตัวละครรอง'} (parent-child, caregiving, embrace)
- ${mainChar} performing ${identity?.coreStory?.celebratedAction || 'ทำกิจกรรมหลักในข่าว'}
- Close-up face of ${identity?.coreStory?.relationship || 'ตัวละครรอง'} (emotional proof)
- ${mainChar} in a caregiving/helping context (feeding, bedside care, hugging)

There are ${imageParts.length} images (index 0 to ${imageParts.length - 1}) to judge.

=== ★★★★ กฎสำคัญสุด: ตรวจตัวบุคคลให้ตรงข่าว — ผิดคน = หมิ่นประมาท ฟ้องร้องได้! ===
- ทุกหน้าในภาพต้องเป็น "${mainChar}"${identity?.secondaryCharacter ? ` หรือ "${identity.secondaryCharacter}"` : ''} — บุคคลที่ระบุชื่อในข่าวนี้
- ⛔⛔ REJECT score 0 เด็ดขาด ถ้าภาพเป็น "บุคคลอื่นที่ระบุได้ว่าไม่ใช่คนในข่าว" — ดาราคนอื่นที่หน้าคล้าย / เพื่อนร่วมงาน / คู่จิ้น / แฟนเก่า / คนในวงการเดียวกันแต่คนละคน (แม้สวย/แม้เกี่ยวข่าว)
- ★★★ "ตัวรอง"${identity?.secondaryCharacter ? ` (${identity.secondaryCharacter})` : ''} ต้องเข้มเท่าตัวหลัก: ห้ามเอาผู้หญิง/ผู้ชายคนอื่นมาสวมเป็นคู่/ภรรยา/สามี (บทเรียนร้ายแรง: เอา "แพททิเซีย" มาเป็น "ชมพู่ อารยา" ภรรยาน็อต = ผิดคน เสี่ยงฟ้อง)
- ★ แต่ "ภาพโคลสอัพ/พอร์ตเทรตของคนในข่าว" = ใช้ได้ปกติ — **อย่า REJECT เพราะแค่ "ไม่ชัวร์ 100%"** ให้ REJECT เฉพาะเมื่อ "มีหลักฐาน/จำได้ว่าเป็นคนอื่นจริงๆ" (กันเผลอตัดภาพคนในข่าวทิ้งหมด)
- ตรวจ context/metadata/แคปชั่นต้นทางประกอบ — ถ้าบ่งชี้ว่าเป็นคนอื่น → REJECT

=== ★★★ EQUALLY CRITICAL RULE: Verify news relevance! ===
- Images MUST be strongly relevant to the news content! Not just showing the right person!
- ★★★ Images of ${mainChar} in fashion/travel/beach/events/solo glamour selfies UNRELATED to news content → score = 2 only (very low, MUST NOT use as main image!)
- Example: News "ก้อย รัชวิน บริจาคโรงเรียน" but image shows ก้อย posing at the beach → score = 2 (right person, WRONG context!)
- Example: News "ก้อย รัชวิน บริจาคโรงเรียน" image of ก้อย with students in a classroom → score 9! (right person + right context, excellent storytelling!)
- ★ Prioritize images that provide "Storytelling" for this news — NOT glamour/fashion solo shots!

=== ROLE ASSIGNMENTS ===

★ Ideal ratio for viral news covers:
  People images (HERO+PERSON_SUPPORT): 2-3 images
  Storytelling images (KEY_ACTIVITY+CONTEXT+RELATIONSHIP+EVIDENCE): 2-3 images
  ★ MUST have at least 2 "storytelling" images! Do NOT select only face portraits!

🏷️ HERO_FACE (1 image — Most important!):
- Sharpest close-up face shot of ${mainChar}
- Face occupies >30% of the frame
- ⚠️ Does NOT need to be from this news story! Social media, interviews, events are acceptable!
- ⚠️ MUST actually be ${mainChar}! Not someone with a similar name!
- ★★★ HERO MUST be professional quality: interview, TV show, press photo, professional portrait
- ⛔ Selfie images (phone self-shot, wide angle, visible extended arm, too many faces too close) → MUST NOT be HERO_FACE! Assign to PERSON_SUPPORT only!
- ⛔ Images with prominent watermark/logo → MUST NOT be HERO_FACE! score ≤ 2
- ★★★★ สีหน้า HERO ต้องตรง "อารมณ์ข่าว" (ดู News emotion + เนื้อข่าวด้านบน) — rev.14v:
    • ข่าวมี "ปม/ดราม่า/ความสัมพันธ์ที่เคยห่าง/ละเลย/สูญเสีย/สำนึก/เปิดใจ/น้ำตา/วิกฤต" → HERO_FACE ที่ดีที่สุด = ภาพ "สีหน้าครุ่นคิด/จริงจัง/สะเทือนใจ/เหม่อ/ตอนสัมภาษณ์เปิดใจ" ของ ${mainChar} → score 9-10
    • ★ ภาพ "ยิ้มแฉ่ง/ถ่ายแบบกลามเมอร์" ของข่าวมีปมแบบนี้ → ไม่เหมาะเป็น HERO! ให้ role=PERSON_SUPPORT score 5-6 (เก็บรอยยิ้มไว้ช่องรอง เล่า before→after)
    • ข่าวอวยความสำเร็จ/ดีใจล้วน → HERO ยิ้มมั่นใจได้เต็มที่ score 9-10
- Score 7-10

🏷️ PERSON_SUPPORT (0-1 images ONLY!):
- ${mainChar} in a context RELATED to the news ONLY!
- ★★★ ${mainChar} looking good but UNRELATED to news → Score = 4 only!
  ❌ Modeling/fashion/travel/beach/other events → score = 4
  ❌ Couple/family photos UNRELATED to the news → score = 4
  ✅ ${mainChar} in news context (e.g., with students) → score 6-7
- ★ Limited to 0-1 images ONLY! MUST NOT exceed 1!
- Score 4-7 (depends on context)

🏷️ KEY_ACTIVITY (1-2 images — ★ Very important!):
- ★★★ Images of the main activity/action in the news
- Examples: live streaming, gardening, helping dogs, cooking, donating
- Images that instantly communicate "what this news is about" without reading!
- ★ If ${mainChar} is performing the news-related activity → Score 8-9!
- Score 6-9

🏷️ TIMELINE_PAST (0-1 images — if the news has a timeline):
- Historical/younger photos showing transformation over time
- Examples: wedding photos, childhood photos, acting career photos
- Score 6-8

🏷️ EMOTION (0-1 images):
- Close-up emotion shot — crying, shocked, angry, smiling, sad
- ${mainChar} MUST be visibly showing clear emotion

🏷️ RELATIONSHIP (0-1 images):
- ${mainChar} with another person — MUST be news-related!
- ★ Photo with the news story's secondary character + matching context → score 6-8
- ★ Couple/family photos UNRELATED to news (wedding/travel/other events) → score = 4

🏷️ CONTEXT_SCENE (0-2 images):
- Wide shot of location/event/context — wide angle, NOT a portrait!
- ★ Groups of people (students, participants) in a news-related scene → CONTEXT_SCENE score 6-8
- ★ Location signage → should be EVIDENCE, NOT CONTEXT_SCENE
- ★★★ DO NOT assign portrait/closeup of strangers as CONTEXT_SCENE!

🏷️ EVIDENCE (0-1 images):
- Real signage, documents, proof, apps, screenshots related to the news
- ★★ Text on real signs ≠ text overlay → DO NOT reject real signage!

=== ❌ REJECT immediately (score = 0, role = "REJECT") ===
1. ★★★ Wrong person! NOT ${mainChar} → REJECT immediately!
   - ★★★ Portrait/closeup of a stranger (not ${mainChar}) → REJECT!
   - ★★★ Student ID/yearbook/ID photo of a different person → REJECT!
   - ★ Exception: Group shots without ${mainChar} → Can be used as CONTEXT_SCENE (score 5-7)
   - ★ Exception: Wide shot of a location with passersby → Can be used as CONTEXT_SCENE
2. Blurry, pixelated, extremely low resolution images
3. Stock photos — generic images without actual news subjects
3b. ★★★ Cartoons / illustrations / clip art / vectors / AI-generated images → REJECT immediately!
    - Drawings, graphic designs, 3D renders
    - Stock images that are not real photographs
    - Infographics / diagrams / charts
3c. ★★★ Medical images / advertisements / product photos → REJECT immediately!
    - Organ images / anatomical diagrams / medical diagrams
    - Cream/skincare/beauty clinic/product advertisements
    - Before-after skin/acne/cosmetic surgery images
    - Images with prominent product names/brands
4. ★★★★★ Contains "overlay text" or "news graphics" → REJECT immediately score=0:
   - Images with ANY colored bar overlaying the image (green/red/orange/blue) + Thai text → REJECT!
   - News headline / title overlaid with colored font → REJECT!
   - News cover / clip cover / YouTube thumbnail with text → REJECT!
   - Lower-third / caption bar / program title bar → REJECT!
   - Large watermark / centered watermark → REJECT!
   - Images resembling "news cover collage" with graphic overlays → REJECT!
   ★★★ This rule is ABSOLUTE with NO exceptions, even if ${mainChar} appears in the image!
   - Advertisement text / promotion / banners
5. Designed cover / thumbnail / collage / clip cover
6. TV screen screenshot / news screenshot (with program frame, channel logo)
7. Cover collage — multiple images arranged in a layout

⚠️ ★★★ CRITICAL EXCEPTION — DO NOT reject "natural text"!
"Natural text" = text that exists in the real world, captured naturally in the photograph:
- School signs / hospital signs / location signs
- Donor name plaques / honor plaques
- Real event banners / real event signage
- Street signs / shop signs / real announcement boards
- Real documents / certificates / receipts
→ These are HIGH-VALUE EVIDENCE! Give score ≥ 7 + role = EVIDENCE

How to distinguish:
- Overlay text = stylized fonts, vivid colors, drop shadow/outline, "floating" on top of the image → REJECT
- Natural text = on signs/boards/walls in the real scene with 3D perspective → KEEP (EVIDENCE)

⚠️ Other exceptions — DO NOT reject these images:
- Clear image of ${mainChar} with light text in a corner → score ≥ 4 (PERSON_SUPPORT)
- Image of ${mainChar} with small watermark in a corner → score ≥ 4
- Image of ${mainChar} from social media (TikTok, Instagram, YouTube) with clearly visible face → score ≥ 5

=== ★★★ HERO IMAGE REQUIREMENTS (Check BEFORE assigning score!) ===
- HERO_FACE images MUST be professional quality (interview, TV show, news photo, professional portrait)
- Selfie images (self-shot, front camera, abnormally wide angle, visible arm holding phone, too many faces too close) → role=PERSON_SUPPORT ONLY (MUST NOT be HERO_FACE!)
- Single person, clear face, NOT a selfie (interview/news/portrait) → score 8-10 (ideal for hero)
- Group/couple selfie → score 5-6 (suitable for circle/PERSON_SUPPORT only)
- Solo selfie → score 5-6 (PERSON_SUPPORT, NOT HERO)
- ★★★ Images with prominent watermark/logo (center, large, obvious) → score ≤ 2 (REJECT!)
- ★★★ Images UNRELATED to news (stadium, ocean, unrelated building, generic scenery) → score ≤ 3

=== SCORING GUIDE ===
- 9-10: Perfect — sharpest quality, no text, no watermark, professional-grade image (not a selfie)
- 7-8: Very good — reliable quality, suitable for use
- 5-6: Acceptable — may have light text or is a usable selfie (MUST NOT be hero)
- 4: Has some issues but usable if necessary
- 1-3: Clear problems (watermark, irrelevant to news, low quality)
- 0: REJECT

=== IMAGE QUALITY PENALTIES ===
- ★★★ Prominent watermark/logo (center/large) → score ≤ 2 (REJECT!)
- Small watermark/logo in a corner → Deduct 2 points from score
- Pre-cropped image (incomplete/head cut off) → score ≤ 4
- Blurry/low resolution → score ≤ 4
- Image clearly showing a location/sign in full → bonus +1 score
- Image with complete composition (not cropped) → bonus +1 score

=== OUTPUT FORMAT ===
Return JSON array ONLY. No markdown blocks, no \`\`\`
Judge ALL images (even REJECT must include score=0)
★ MUST include at least 2 images of ${mainChar} (1 HERO_FACE + 1 KEY_ACTIVITY/CONTEXT_SCENE/RELATIONSHIP)
★ MUST include at least 2 storytelling images (KEY_ACTIVITY/CONTEXT/RELATIONSHIP/EVIDENCE)
★ PERSON_SUPPORT MUST NOT exceed 1 image! Prioritize storytelling images instead!

[{"index": 0, "score": 10, "role": "HERO_FACE", "reason": "..."}, {"index": 1, "score": 9, "role": "KEY_ACTIVITY", "reason": "..."}, {"index": 5, "score": 0, "role": "REJECT", "reason": "Wrong person, not the news subject"}]`;


  // Fix 16: Gemini 503 all day - skip directly to GPT-4o fallback
  console.log('[Judge] Gemini disabled - using GPT-4o directly');
  return await judgeWithFallback(validCandidates, imageParts, prompt, newsTitle, identity);

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

      // ★ STORY SUBJECT CHECK: ถ้า storySubject ไม่ใช่ตัวเอก ให้ filter glamour-only hero shots ออก
      const _subject = identity?._storySubject || identity?.coreStory?.storySubject || '';
      const _hero = sanitizeHeroName(identity?.mainCharacter || '');
      const storySubjectIsOther = _subject && _subject !== _hero;
      if (storySubjectIsOther) {
        // ภาพ HERO_FACE คนเดียว (ไม่มี relationship/storySubject) → ห้ามใช้ถ้า score ≤ 5
        const heroOnly = accepted.filter(s => s.role === 'HERO_FACE' && s.score <= 5);
        if (heroOnly.length > 0) {
          console.log(`[Judge] ⚠️ STORY SUBJECT ≠ HERO: removing ${heroOnly.length} low-score hero-only shots (score≤5) to force story images`);
          heroOnly.forEach(s => { s.score = 2; s.role = 'REJECT'; s.reason = '[GLAMOUR-PURGED] Hero-only without storySubject'; });
        }
      }

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

        // ════════════════════════════════════════════════
        // ★ TOP RANKED IMAGES REPORT
        // แสดงให้เห็นว่า Ranking เลือกอะไร — Debug ranking vs slot bug
        // ════════════════════════════════════════════════
        {
          const negFocusTerms = (identity?.coreStory?.negativeFocus || []).map(f => f.toLowerCase());
          function getRankCategory(role, reason, url) {
            const t = `${role} ${reason} ${url}`.toLowerCase();
            if (/ช้าง|elephant/.test(t)) return '🐘 elephant';
            if (/สัตวแพทย์|veterinar/.test(t)) return '🐑 occupation';
            if (negFocusTerms.some(nf => t.includes(nf))) return '⛔ occupation';
            if (role === 'RELATIONSHIP' || /แม่|ครอบครัว|mother|family/.test(t)) return '💚 mother/family';
            if (role === 'KEY_ACTIVITY' || /ดูแล|caregiving/.test(t)) return '💟 caregiving';
            if (role === 'HERO_FACE') return '👤 hero';
            if (role === 'EMOTION') return '📸 emotion';
            if (role === 'EVIDENCE') return '🔍 evidence';
            if (role === 'REJECT') return '❌ reject';
            return '❓ unrelated';
          }

          // Sort all scored images by score DESC
          const allSorted = [...parsed]
            .filter(s => s.index >= 0 && s.index < validCandidates.length)
            .sort((a, b) => b.score - a.score)
            .slice(0, 30);

          console.log('============================================');
          console.log('[Judge] ★ TOP RANKED IMAGES REPORT (top 30 by score)');
          console.log('  rank | score | role           | category      | reason');
          console.log('  -----|-------|----------------|---------------|-------');
          allSorted.forEach((s, rank) => {
            const cat = getRankCategory(s.role, s.reason || '', validCandidates[s.index] || '');
            const reasonSnip = (s.reason || '').substring(0, 50);
            console.log(`  #${String(rank+1).padStart(2)}: ${String(s.score).padStart(4)}  | ${(s.role || 'UNKNOWN').padEnd(14)} | ${cat.padEnd(13)} | ${reasonSnip}`);
          });

          // ★ Highlight if elephant/occupation scored HIGH
          const highForbidden = allSorted.filter(s => {
            const cat = getRankCategory(s.role, s.reason || '', validCandidates[s.index] || '');
            return (cat.includes('elephant') || cat.includes('occupation')) && s.score >= 5;
          });
          const highStory = allSorted.filter(s => {
            const cat = getRankCategory(s.role, s.reason || '', validCandidates[s.index] || '');
            return (cat.includes('mother') || cat.includes('caregiving') || cat.includes('family')) && s.score >= 5;
          });

          if (highForbidden.length > 0) {
            console.log(`[Judge] ❌ RANKING FAIL: ${highForbidden.length} forbidden image(s) scored HIGH (≥5):`);
            highForbidden.forEach(s => console.log(`         score=${s.score} role=${s.role} reason=${(s.reason||'').substring(0,60)}`));
            if (highStory.length > 0) {
              console.log('[Judge]    story images also scored high → likely SLOT ASSIGNMENT bug');
            } else {
              console.log('[Judge]    story images scored LOW → RANKING bug (Vision Judge gave wrong scores)');
            }
          } else {
            console.log(`[Judge] ✅ RANKING OK: no forbidden images in top scores`);
          }
          console.log('============================================');
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
          model: 'claude-sonnet-4-6', // ★ 10 มิ.ย.: sonnet-4-20250514 ปลดระวาง 15 มิ.ย. 2026
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
  // ★★★ POST-PROCESSING: Selfie & Watermark enforcement (safety net)
  // แม้ prompt จะบอกแล้ว AI อาจยัง assign HERO_FACE ให้ selfie/watermark → บังคับ demote
  const SELFIE_KEYWORDS = /selfie|เซลฟี่|ถ่ายตัวเอง|มือถือถ่าย|กล้องหน้า|แขนยื่น|wide.?angle.*face|arm.*visible|front.*camera/i;
  const WATERMARK_KEYWORDS = /watermark|ลายน้ำ|logo.*ใหญ่|logo.*ชัด|โลโก้.*เด่น|branded|stock.*photo/i;
  
  for (const item of parsed) {
    const reason = (item.reason || '').toLowerCase();
    const isSelfie = SELFIE_KEYWORDS.test(reason);
    const hasWatermark = WATERMARK_KEYWORDS.test(reason);
    
    // ★ Selfie → ห้ามเป็น HERO_FACE, demote เป็น PERSON_SUPPORT
    if (isSelfie && item.role === 'HERO_FACE') {
      console.log(`[Judge] ⛔ POST-FIX: Selfie detected in HERO_FACE #${item.index} → demoted to PERSON_SUPPORT (score ${item.score} → ${Math.min(item.score, 6)})`);
      item.role = 'PERSON_SUPPORT';
      item.score = Math.min(item.score, 6);
      item.reason = `[SELFIE-DEMOTED] ${item.reason}`;
    }
    
    // ★ Watermark ชัดเจน → REJECT
    if (hasWatermark && item.score > 2) {
      console.log(`[Judge] ⛔ POST-FIX: Watermark detected in #${item.index} (${item.role}) → score capped at 2`);
      item.score = Math.min(item.score, 2);
      if (item.role === 'HERO_FACE') item.role = 'REJECT';
      item.reason = `[WATERMARK-REJECTED] ${item.reason}`;
    }
  }

  // ═══ Source Reliability Bias — ปรับ AI score ตาม sourceScore ═══
  // ★ Also store sourceReliability as a SEPARATE field on each item
  if (validCandidates._sourceScores) {
    for (const item of parsed) {
      if (item.index >= 0 && item.index < validCandidates.length) {
        const imgUrl = validCandidates[item.index];
        const sourceScore = validCandidates._sourceScores[imgUrl];
        if (sourceScore !== undefined) {
          // ★ Store sourceReliability as separate field (not just baked into score)
          item.sourceReliability = sourceScore;
          const oldScore = item.score;
          if (sourceScore >= 5) {
            // ★ Fix 26: Don't revive REJECT (score 0) non-anchor images via source bonus
            const isAnchor = validCandidates._storyAnchorMap?.has(imgUrl);
            if (item.score === 0 && item.role === 'REJECT' && !isAnchor) {
              // Keep at 0 — source bonus shouldn't save unrelated rejected images
            } else {
              item.score = Math.min(10, item.score + Math.floor(sourceScore / 5));
            }
          } else if (sourceScore <= 1) {
            // Stock/low-trust: -2 penalty (min 0 for REJECT, min 1 otherwise)
            item.score = item.role === 'REJECT' ? 0 : Math.max(1, item.score - 2);
          }
          if (oldScore !== item.score) {
            let domain = '(unknown)';
            try { domain = new URL(imgUrl).hostname.replace(/^www\./, ''); } catch {}
            console.log(`[SourceScore] POST-JUDGE #${item.index}: ${domain} (src=${sourceScore}) score ${oldScore} → ${item.score}`);
          }
        }
      }
    }
  }

  // ★ Fix 26: Story Anchor Rescue — don't let Judge kill story-relevant images
  if (validCandidates._storyAnchorMap && validCandidates._storyAnchorMap.size > 0) {
    for (const item of parsed) {
      if (item.index >= 0 && item.index < validCandidates.length) {
        const imgUrl = validCandidates[item.index];
        const isAnchor = validCandidates._storyAnchorMap.has(imgUrl);
        if (isAnchor && item.score < 5) {
          const oldScore = item.score;
          const oldRole = item.role;
          item.score = Math.max(item.score, 6);
          if (item.role === 'REJECT') item.role = 'CONTEXT_SCENE';
          item._rescued = true;
          item._rescueReason = `Story anchor rescue: title matches story keywords (was ${oldScore}/${oldRole})`;
          console.log(`[Judge] ★ Story Anchor Rescue: #${item.index} score ${oldScore} → ${item.score}, role ${oldRole} → ${item.role}`);
        }
      }
    }
  }

  // ★ Fix 8: ลด threshold จาก ≥4 → ≥3 เพื่อให้ได้ภาพเพียงพอ (ข่าวใหม่อาจมีภาพน้อย)
  const accepted = parsed.filter(s => s.score >= 3);
  const nearMiss = parsed.filter(s => s.score === 2);
  const rejected = parsed.filter(s => s.score < 2);

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
    selectedImages.push({
      url: validCandidates[s.index],
      role, score: s.score, sourceReliability: s.sourceReliability,
      _storyAnchor: validCandidates._storyAnchorMap?.has(validCandidates[s.index]) || false,
      _rescued: s._rescued || false,
      _rescueReason: s._rescueReason || null,
    });
  }

  if (selectedImages.length > 0) {
    // Supplement: near-miss (ลดเกณฑ์ให้ได้ภาพเพิ่ม)
    if (selectedImages.length < 6 && nearMiss.length > 0) {
      const selectedUrls = new Set(selectedImages.map(i => i.url));
      const sortedNearMiss = nearMiss
        .filter(s => s.index >= 0 && s.index < validCandidates.length)
        .sort((a, b) => b.score - a.score);
      for (const s of sortedNearMiss) {
        if (selectedImages.length >= 8) break;
        const url = validCandidates[s.index];
        if (!selectedUrls.has(url)) {
          selectedImages.push({ url, role: s.role === 'REJECT' ? 'SUPPORT' : (s.role || 'SUPPORT'), score: s.score, sourceReliability: s.sourceReliability });
          selectedUrls.add(url);
        }
      }
      console.log(`[Judge] 📦 Supplemented with near-miss → total ${selectedImages.length}`);
    }

    // Low-scored supplement (ลดเกณฑ์จาก <4 → <5)
    if (selectedImages.length < 5) {
      const selectedUrls = new Set(selectedImages.map(i => i.url));
      const lowScored = rejected
        .filter(s => s.score > 0 && s.index >= 0 && s.index < validCandidates.length)
        .sort((a, b) => b.score - a.score);
      for (const s of lowScored) {
        if (selectedImages.length >= 6) break;
        const url = validCandidates[s.index];
        if (!selectedUrls.has(url)) {
          selectedImages.push({ url, role: 'SUPPORT', score: s.score, sourceReliability: s.sourceReliability });
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
    // ★ Fix 25: Propagate story anchor diagnostics
    selectedImages._storyAnchorCandidates = validCandidates._storyAnchorCandidates || [];
    selectedImages._bucketCounts = validCandidates._bucketCounts || null;
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
      const rawMainChar = identity?.mainCharacter || '';
      const mainChar = sanitizeHeroName(rawMainChar);
      const sq = {};
      if (identity?.searchQueries) {
        for (const [key, val] of Object.entries(identity.searchQueries)) {
          if (typeof val === 'string') {
            sq[key] = cleanQueryString(val, rawMainChar, mainChar);
          } else {
            sq[key] = val;
          }
        }
      }
      const rawTavilyQuery = identity?.coreImageQueries?.[0] || sq.person_context || sq.key_activity || identity?.searchGoogle || newsTitle || '';
      const tavilyQuery = cleanQueryString(rawTavilyQuery, rawMainChar, mainChar);
      if (tavilyQuery) {
        tavilyPromise = tavilyImageSearch(tavilyQuery).catch(() => []);
      }
    }
  } catch { /* Tavily not available */ }

  const [googleResult, reelsResult, contextResult, tavilyResult, youtubeResult, articleResult] = await Promise.allSettled([
    agentGoogleCleanImages(identity),
    // Agent 5: Facebook Reels (Serper thumbnail)
    (async () => {
      try {
        const { searchAndExtractReelFrames } = await import('@/lib/services/facebookReelsExtractor');
        return await searchAndExtractReelFrames(identity);
      } catch (e) { console.log('[Agent5:Reels] Error:', e.message); return []; }
    })(),
    agentContextImages(identity),
    tavilyPromise,
    // ★ Agent 2 (10 มิ.ย.): YouTube Frames กลับเข้าระบบ — เคยเขียนครบแต่ไม่ถูกเรียก (สล็อตถูกแทนด้วย Reels)
    //   เฟรมจากคลิปสัมภาษณ์/รายการ = แหล่งภาพ "อารมณ์พีค" ที่ Google Images ไม่มี
    agentYouTubeFrames(identity),
    // ★ Agent 0 (11 มิ.ย.): ภาพจากบทความข่าวต้นทาง — ภาพ "ตรงเนื้อ" ที่สุด (บ้านจริง/สวนจริง/เหตุการณ์จริง)
    //   แก้ปัญหา "คนถูกแต่ผิดเรื่อง" จากการค้นด้วยชื่อคนซึ่งได้แต่ portrait
    (async () => {
      try {
        if (!url || !/^https?:\/\//i.test(url)) return [];
        const { extractSourceArticleImages } = await import('@/lib/services/sourceArticleImages');
        return await extractSourceArticleImages(url);
      } catch (e) { console.log('[Agent0:Article] Error:', e.message); return []; }
    })()
  ]);

  // Collect results from each agent
  const googleImages = googleResult.status === 'fulfilled' ? googleResult.value : [];
  const reelsImages = reelsResult.status === 'fulfilled' ? (reelsResult.value || []) : [];
  const contextImages = contextResult.status === 'fulfilled' ? contextResult.value : [];
  const tavilyImages = tavilyResult.status === 'fulfilled' ? (tavilyResult.value || []).filter(u => typeof u === 'string' && u.startsWith('http')) : [];
  const youtubeImages = youtubeResult.status === 'fulfilled' ? (youtubeResult.value || []) : [];
  const articleImages = articleResult.status === 'fulfilled' ? (articleResult.value || []) : [];

  console.log('============================================');
  console.log(`[MultiAgent] Agent results:`);
  console.log(`  Agent 0 (Article):  ${articleImages.length} images ${articleResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + articleResult.reason : ''}`);
  console.log(`  Agent 1 (Google):   ${googleImages.length} images ${googleResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + googleResult.reason : ''}`);
  console.log(`  Agent 2 (YouTube):  ${youtubeImages.length} frames ${youtubeResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + youtubeResult.reason : ''}`);
  console.log(`  Agent 3 (Context):  ${contextImages.length} images ${contextResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + contextResult.reason : ''}`);
  console.log(`  Agent 4 (Tavily):   ${tavilyImages.length} images ${tavilyResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + tavilyResult.reason : ''}`);
  console.log(`  Agent 5 (FB Reels): ${reelsImages.length} thumbs ${reelsResult.status !== 'fulfilled' ? '⚠️ FAILED: ' + reelsResult.reason : ''}`);

  const coreQueriesForMeta = (identity?.coreImageQueries || []).map(q => q.toLowerCase());
  const allMeta = [
    ...((googleResult.value?._meta) || []),
    ...contextImages.map((url, i) => ({ url, queryLabel: `context-${i}`, queryText: '' })),
    ...youtubeImages.map((url, i) => ({ url, queryLabel: 'youtube-core', queryText: coreQueriesForMeta[0] || '' })),
    ...reelsImages.map((url, i) => ({ url, queryLabel: 'reels-core', queryText: coreQueriesForMeta[0] || '' })),
    ...articleImages.map((url, i) => ({ url, queryLabel: 'article-source', queryText: 'ภาพจากบทความข่าวต้นทาง' })),
    ...tavilyImages.map((url, i) => ({ url, queryLabel: 'tavily-core', queryText: coreQueriesForMeta[0] || '' })),
  ];

  // ══════════════════════════════════════════════════════════════
  // ★ CANDIDATE DISTRIBUTION REPORT
  // จัดหมวดหมู่ภาพทั้งหมดจาก query label + metadata
  // ไม่ใช้ Vision API — ใช้ keyword matching บน title/queryText
  // ══════════════════════════════════════════════════════════════
  {
    const negFocus = (identity?.coreStory?.negativeFocus || []).map(f => f.toLowerCase());
    const coreQueries = (identity?.coreImageQueries || []).map(q => q.toLowerCase());

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
    const unrelatedPct = dist.unrelated / total;
    if (forbiddenPct > 0.2 && total > 10) {
      console.log(`[MultiAgent] ❌ SEARCH STAGE FAIL: occupation+elephant = ${(forbiddenPct*100).toFixed(1)}% > 20% threshold`);
      console.log(`[MultiAgent]    Root cause: search queries still returning forbidden content`);
      console.log(`[MultiAgent]    Continuing pipeline but cover quality will be poor — check QUERY OVERRIDE logs above`);
    } else if (unrelatedPct > 0.1 && total > 10) {
      console.log(`[MultiAgent] ⚠️ SEARCH STAGE WARN: unrelated = ${(unrelatedPct*100).toFixed(1)}% > 10% — too much noise, cover quality may suffer`);
    } else {
      console.log(`[MultiAgent] ✅ SEARCH STAGE PASS: forbidden=${(forbiddenPct*100).toFixed(1)}% unrelated=${(unrelatedPct*100).toFixed(1)}%`);
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
  // ★ Agent 0 (ปรับ 11 มิ.ย. ตาม feedback): ภาพจากข่าวต้นทางสมัยนี้มักเป็นปกกราฟิกทางการ/มีตัวหนังสือ ใช้จริงไม่ได้
  //   → ไม่ให้ priority พิเศษ เข้าคิว context ปกติ แล้วให้ Judge + zero-tolerance กรองเหมือนภาพอื่น
  const articleQueue = articleImages.filter(img => !googleQueue.includes(img) && !contextQueue.includes(img));
  contextQueue.push(...articleQueue);
  // ★ Agent 2: เฟรม YouTube = ภาพคน (สัมภาษณ์/vlog) → เข้าฝั่ง person ต่อท้าย Google
  const youtubeQueue = youtubeImages.filter(img => !googleQueue.includes(img));
  googleQueue.push(...youtubeQueue);
  const reelsQueue = reelsImages.filter(img => !googleQueue.includes(img) && !contextQueue.includes(img));
  contextQueue.push(...reelsQueue);
  
  let gIdx = 0, cIdx = 0;
  
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
    
    // ถ้าทั้ง Google และ Context(+Reels) หมดแล้ว → break
    if (gIdx >= googleQueue.length && cIdx >= contextQueue.length) {
      break;
    }
  }
  
  let candidates = prioritized;
  // ★ Attach _meta to candidates so judgeImages can look up source page URLs for reliability scoring
  candidates._meta = allMeta;
  if (candidates.length > 100) {
    const savedMeta = candidates._meta;
    candidates = candidates.slice(0, 100);
    candidates._meta = savedMeta; // Preserve _meta after slice
  }
  const personCount = Math.min(gIdx, googleQueue.length);
  const contextCount = Math.min(cIdx, contextQueue.length);
  console.log(`[MultiAgent] ★ Interleaved: ${candidates.length} candidates (Person ~${personCount} [+YT ${youtubeQueue.length}] ↔ Context ~${contextCount} + Reels ~${reelsQueue.length})`);

  console.log(`[MultiAgent] 🏛️ Sending ${candidates.length} candidates to AI Judge...`);
  console.log('============================================');

  const selectedImages = await judgeImages(candidates, newsTitle, identity);

  console.log('============================================');
  console.log(`[MultiAgent] 🏁 Final selection: ${selectedImages.length} images`);
  console.log('============================================');

  const allScrapedUrls = [...new Set([
    ...articleImages,
    ...googleImages,
    ...contextImages,
    ...tavilyImages,
    ...youtubeImages,
    ...reelsImages
  ])];

  // Map metadata back to selected images so that they can be filtered properly in route.js
  const metadataMap = new Map();
  allMeta.forEach(meta => {
    const url = meta.url || meta.link;
    if (url) {
      metadataMap.set(url, {
        title: meta.title || '',
        snippet: meta.queryText || meta.title || '',
        evidenceCat: meta.queryLabel || '',
      });
    }
  });

  const result = (selectedImages || []).map(img => {
    const meta = metadataMap.get(img.url) || {};
    return {
      ...img,
      title: meta.title || img.title || '',
      snippet: meta.snippet || img.snippet || '',
      evidenceCat: meta.evidenceCat || img.evidenceCat || '',
    };
  });
  result.allCandidates = allScrapedUrls;
  // ★ Fix 25: Pass story anchor diagnostics to route.js
  result._storyAnchorCandidates = selectedImages._storyAnchorCandidates || candidates._storyAnchorCandidates || [];
  result._bucketCounts = selectedImages._bucketCounts || candidates._bucketCounts || null;
  return result;
}
