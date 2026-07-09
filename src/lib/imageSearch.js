// ============================================================
// [ระบบทำปกออโต้] ขั้นที่ 3 — ตัวค้นหาภาพ (SerpApi)
// ------------------------------------------------------------
// เอาคีย์เวิร์ดที่สกัดไว้ไปค้นภาพจริงจากแพลตฟอร์มต่างๆ
//   google   → engine=google_images
//   facebook → engine=google_images + "site:facebook.com"
//   tiktok   → engine=google_images + "site:tiktok.com"
//   youtube  → engine=youtube (ดึง thumbnail วิดีโอ)
// คีย์: SERPAPI_KEY
// ============================================================

import { recordSerp } from './costStore.js';

// แพลตฟอร์มที่ค้นผ่าน google_images พร้อม site: filter (null = ไม่ใส่ filter)
const SITE_FILTER = {
  google: null,
  facebook: 'facebook.com',
  tiktok: 'tiktok.com',
};

// แพลตฟอร์มที่ค้นด้วย "คำค้น" ผ่าน /api/images/search (reverse/profile/youtube มี endpoint แยก)
// ★ DEVIATION จากต้นฉบับ (ผู้ใช้สั่ง 6 ก.ค.): ตัด bing/bing_news ทิ้ง — bing อ่านคำไทยไม่ออก ตอบขยะ 100%
//   (พิสูจน์ AC-0002: 133/133 เป็นบทความแมวเปอร์เซีย) เปลืองทั้งเครดิต SerpApi และตา Gemini
export const PLATFORMS = ['google', 'google_news', 'yandex', 'facebook', 'tiktok'];

export const PLATFORM_LABEL = {
  google: 'Google',
  google_news: 'Google News',
  yandex: 'Yandex',
  bing: 'Bing',
  bing_news: 'Bing News',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  clip: '🎬 คลิปที่วางเอง', // ★ 6 ก.ค.: เฟรมจากลิงก์คลิปที่ผู้ใช้ระบุ — แยกหมวดให้เลือกดูง่าย
  reverse: 'ค้นย้อนกลับ',
  instagram: 'Instagram',
};

function isNoResults(err) {
  return typeof err === 'string' && /hasn't returned any results|no results/i.test(err);
}

function getKey() {
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    const e = new Error('ยังไม่ได้ตั้ง SERPAPI_KEY — ใส่ในไฟล์ .env.local ของโปรเจกต์นี้');
    e.errorType = 'NO_SERPAPI_KEY';
    throw e;
  }
  return key;
}

// เรียก SerpApi แบบ generic → คืน data (หรือ {_empty:true} ถ้าไม่มีผล)
// opts.caseId = ผูกต้นทุนกับเคส (ถ้ามี)
async function serpGet(params, opts = {}) {
  const usp = new URLSearchParams({ ...params, api_key: getKey() });
  const res = await fetch('https://serpapi.com/search.json?' + usp.toString());
  const data = await res.json().catch(() => ({}));
  // ทุกคำขอ = 1 เครดิต SerpApi (นับต้นทุน)
  await recordSerp({ engine: params.engine || params.tbm || 'search', step: 'ค้นภาพ', caseId: opts.caseId });
  if (!res.ok || data.error) {
    if (isNoResults(data.error)) return { _empty: true };
    const e = new Error('SerpApi error: ' + (data.error || res.status));
    e.errorType = 'PROVIDER_ERROR';
    throw e;
  }
  return data;
}

// normalize รายการภาพให้รูปแบบเดียวกันทุก engine
function normItem(im) {
  const imageUrl =
    im.original ||
    im.original_image?.link ||
    (typeof im.image === 'string' ? im.image : im.image?.link) ||
    im.display_url ||
    im.thumbnail ||
    im.thumbnail_src ||
    im.link ||
    '';
  const thumbnailUrl = im.thumbnail || im.serpapi_thumbnail_src || im.thumbnail_src || imageUrl;
  const src =
    im.source && typeof im.source === 'object' ? im.source.name || '' : im.source || im.domain || '';
  const link = im.link || (im.source && typeof im.source === 'object' ? im.source.link : '') || '';
  return {
    imageUrl,
    thumbnailUrl,
    title: im.title || '',
    source: typeof src === 'string' ? src : '',
    sourceLink: link,
    width: im.original_width || null,
    height: im.original_height || null,
  };
}

function normList(arr, num) {
  return (arr || []).slice(0, num).map(normItem).filter((x) => x.imageUrl && /^https?:/.test(x.imageUrl));
}

// หา array ก้อนแรกที่ item มี field ที่ต้องการ (เผื่อโครง response ต่างกัน)
function findArrayWith(obj, field, depth = 0) {
  if (!obj || depth > 4) return null;
  if (Array.isArray(obj)) {
    if (obj.length && obj[0] && typeof obj[0] === 'object' && obj[0][field] !== undefined) return obj;
    for (const it of obj) {
      const r = findArrayWith(it, field, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const r = findArrayWith(obj[k], field, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

// ค้นภาพ 1 คำค้น (router ตามแพลตฟอร์ม) → คืน array ภาพ normalize
export async function searchImages(platform, query, { num = 30, gl = 'th', hl = 'th', caseId } = {}) {
  const co = { caseId }; // ผูกต้นทุน SerpApi กับเคส
  if (platform === 'youtube') return searchYouTube(query, { num, gl, hl, key: getKey(), caseId });

  if (platform === 'google_news') {
    const d = await serpGet({ engine: 'google_news', q: query, gl, hl }, co);
    return d._empty ? [] : normList(d.news_results, num);
  }
  if (platform === 'yandex') {
    const d = await serpGet({ engine: 'yandex_images', text: query }, co);
    return d._empty ? [] : normList(d.images_results, num);
  }
  // google / facebook / tiktok → google_images (+ site filter)
  const site = SITE_FILTER[platform];
  const q = site ? `${query} site:${site}` : query;
  const d = await serpGet({ engine: 'google_images', q, gl, hl }, co);
  return d._empty ? [] : normList(d.images_results, num);
}

// ค้นภาพย้อนกลับ (Google Lens) จากภาพที่ยืนยัน 1 ใบ → เจอภาพคนคนนั้นจากทุกที่
// ★ 9 ก.ค.: รับ caseId ผูกต้นทุน — เดิมเครดิต Lens ถูก log แบบไม่รู้เคส (/cost มองไม่เห็น)
export async function reverseImage(imageUrl, { num = 25, hl = 'th', caseId } = {}) {
  const d = await serpGet({ engine: 'google_lens', url: imageUrl, type: 'visual_matches', hl, country: 'th' }, { caseId });
  if (d._empty) return [];
  return normList(d.visual_matches, num);
}

// ดึงรูปจากโปรไฟล์ Instagram (ต้องรู้ profile_id / username)
export async function instagramProfile(profileId, { num = 40 } = {}) {
  const d = await serpGet({ engine: 'instagram_profile', profile_id: profileId });
  if (d._empty) return [];
  const posts = findArrayWith(d, 'display_url') || findArrayWith(d, 'thumbnail_src') || [];
  return posts
    .slice(0, num)
    .map((p) => ({
      imageUrl: p.display_url || p.thumbnail_src || p.serpapi_thumbnail_src || '',
      thumbnailUrl: p.serpapi_thumbnail_src || p.thumbnail_src || p.display_url || '',
      title: (p.caption || '').slice(0, 60),
      source: 'Instagram',
      sourceLink: p.shortcode ? `https://www.instagram.com/p/${p.shortcode}/` : '',
      width: null,
      height: null,
    }))
    .filter((x) => x.imageUrl && /^https?:/.test(x.imageUrl));
}

// ดึงรูปจากโปรไฟล์ Facebook (profile pic + cover + photos ที่มี URL ภาพ)
export async function facebookProfile(profileId, { num = 40 } = {}) {
  const d = await serpGet({ engine: 'facebook_profile', profile_id: profileId });
  if (d._empty) return [];
  const out = [];
  if (d.profile_picture) out.push({ imageUrl: d.profile_picture, thumbnailUrl: d.profile_picture, title: 'profile', source: 'Facebook', sourceLink: `https://facebook.com/${profileId}`, width: null, height: null });
  if (d.cover_photo) out.push({ imageUrl: d.cover_photo, thumbnailUrl: d.cover_photo, title: 'cover', source: 'Facebook', sourceLink: '', width: null, height: null });
  const photos = d.photos || findArrayWith(d, 'image') || [];
  for (const p of photos.slice(0, num)) {
    const url = p.image || p.original || p.thumbnail;
    if (url) out.push({ imageUrl: url, thumbnailUrl: p.thumbnail || url, title: '', source: 'Facebook', sourceLink: p.link || '', width: null, height: null });
  }
  return out.filter((x) => x.imageUrl && /^https?:/.test(x.imageUrl));
}

async function searchYouTube(query, { num, gl, hl, key, caseId }) {
  const url =
    'https://serpapi.com/search.json?engine=youtube' +
    `&search_query=${encodeURIComponent(query)}&gl=${gl}&hl=${hl}&api_key=${key}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  await recordSerp({ engine: 'youtube', step: 'ค้นภาพ', caseId }); // ★ 9 ก.ค.: เดิมยิงตรงไม่ log = เครดิตล่องหน
  if (!res.ok || data.error) {
    if (isNoResults(data.error)) return [];
    const e = new Error('SerpApi error: ' + (data.error || res.status));
    e.errorType = 'PROVIDER_ERROR';
    throw e;
  }

  const vids = data.video_results || [];
  return vids.slice(0, num).map((v) => {
    const thumb =
      typeof v.thumbnail === 'string' ? v.thumbnail : v.thumbnail?.static || '';
    return {
      imageUrl: thumb,
      thumbnailUrl: thumb,
      title: v.title || '',
      source: v.channel?.name || 'YouTube',
      sourceLink: v.link || '',
      width: null,
      height: null,
    };
  });
}

// ค้นคลิป YouTube (metadata เต็ม: link/length/channel/views) สำหรับ pipeline แคปเฟรม
export async function searchYouTubeClips(query, { gl = 'th', hl = 'th', caseId } = {}) {
  const key = getKey();
  const url =
    'https://serpapi.com/search.json?engine=youtube' +
    `&search_query=${encodeURIComponent(query)}&gl=${gl}&hl=${hl}&api_key=${key}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  await recordSerp({ engine: 'youtube', step: 'ค้นคลิปแคปเฟรม', caseId }); // ★ 9 ก.ค.: เดิมยิงตรงไม่ log = เครดิตล่องหน
  if (!res.ok || data.error) {
    if (isNoResults(data.error)) return [];
    const e = new Error('SerpApi error: ' + (data.error || res.status));
    e.errorType = 'PROVIDER_ERROR';
    throw e;
  }

  const vids = data.video_results || [];
  return vids
    .map((v) => ({
      link: v.link || '',
      title: v.title || '',
      channel: v.channel?.name || '',
      lengthText: v.length || '',
      lengthSeconds: parseLength(v.length),
      views: viewsToNumber(v.views),
      thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : v.thumbnail?.static || '',
    }))
    .filter((v) => v.link);
}

function parseLength(s) {
  if (!s) return null;
  const parts = String(s).split(':').map((n) => parseInt(n, 10));
  if (parts.some((n) => isNaN(n))) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

function viewsToNumber(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const m = String(v).replace(/,/g, '').match(/([\d.]+)\s*([KMB]?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  return Math.round(n * mult);
}

function dedupeTake(arr, n) {
  const seen = new Set();
  const out = [];
  for (const q of arr) {
    const t = String(q || '').trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
    if (out.length >= n) break;
  }
  return out;
}

// คำ "วัตถุ/ทรัพย์สิน" — ใช้ตรวจจับ subject วัตถุ + คำค้นวัตถุลอย
const OBJECT_KW = /บ้าน|คฤหาสน์|ตำหนัก|วิลล่า|ที่ดิน|คอนโด|ทรัพย์สิน|รถยนต์|รถหรู|รถกระบะ|รถสปอร์ต|แบบบ้าน|โครงการ|mansion|villa|condo|\bhouse\b|\bhome\b|\bland\b|\bcar\b/i;
function isObjectSubject(s) {
  // ยึด kind ก่อน (จากคีย์เวิร์ดใหม่) — ถ้าไม่มี ค่อยเดาจาก "ชื่อ" (ไม่เดาจาก role กัน false positive)
  return s?.kind === 'object' || OBJECT_KW.test(String(s?.name || ''));
}

// จำนวนคำค้น "หลักฐาน/โมเมนต์" ที่การันตียิงเสมอ (เพิ่มจากโควตาปกติ)
const EVIDENCE_SLOTS = parseInt(process.env.IMAGES_EVIDENCE_SLOTS || '3', 10);
// จำนวนคำค้น "สถานที่สาธารณะชื่อเฉพาะ" ที่การันตียิงเสมอ (มหาลัย/รพ./วัด ที่ข่าวเอ่ยชื่อ)
const PLACE_SLOTS = parseInt(process.env.IMAGES_PLACE_SLOTS || '2', 10);
// ★ item #4 (พูลล้มเป็นพอร์ตเทรตซ้ำ CASE-349): จำนวนคำค้น "โมเมนต์/แอ็กชัน/ปฏิกิริยา" (ฉากไม่ใช่หน้าพอร์ตเทรต)
//   ที่การันตียิงเสมอ — แยกโควตาออกจาก "หลักฐานเอกสาร" ไม่ให้เอกสารเบียดทิ้ง (ปกแสนไลค์ต้องมีช่องแอ็กชัน/รีแอกชัน/โมเมนต์)
const MOMENT_SLOTS = parseInt(process.env.IMAGES_MOMENT_SLOTS || '3', 10);
// ★ 9 ก.ค. เฟส 4a: จำนวนคำค้น "เชิงเรื่องราว" (ความสัมพันธ์/ทริป/อัลบั้ม/แลนด์มาร์ก) ที่การันตียิงเสมอ
//   (ภาพเชิงบริบทที่เพจดังใช้แล้วแมส — ต้องได้ยิงแม้ event queries เยอะ) · kill-switch IMG_STORY_QUERIES=0 = ปิดหมวดใหม่ทั้งหมด
const STORY_SLOTS = parseInt(process.env.IMAGES_STORY_SLOTS || '3', 10);
// คำบ่ง "สถาบัน/สถานที่สาธารณะ" — ภาพจาก Google ใช้ได้เลย ไม่ต้องผูกชื่อคน (ชื่อเฉพาะระบุตัวตนสถานที่แล้ว)
// ★ 8 ก.ค. บั๊กซ่อนเดิม: "จังหวัด"/"หวัด" มีคำว่า "วัด" ซ่อนอยู่ → regex เคยตีความ "จังหวัดแม่ฮ่องสอน" เป็นชื่อวัด
//   แล้วปล่อยคำค้นพื้นที่เปล่าผ่านช่องสถาบัน (ที่มาวิวอำเภอ 14 ใบใน AC-0043) — ใส่ lookbehind กัน ห/หนำหน้า วัด
const PLACE_INST = /มหาวิทยาลัย|วิทยาลัย|โรงเรียน|โรงพยาบาล|(?<!ห)วัด|มูลนิธิ|สนามบิน|สถานี|ตลาด|ห้าง|อุทยาน|university|college|hospital|school|temple|airport/i;
// ★ 8 ก.ค. (ผู้ใช้สั่ง "ห้ามคีย์มั่ว"): คำบ่ง "เขตปกครอง/พื้นที่" — ค้นเปล่าๆ ได้แต่วิวทั่วไปของพื้นที่
//   ทั้งเน็ต ไม่ใช่ภาพข่าวนี้ (บทเรียน AC-0043: "อำเภอแม่สะเรียง จังหวัดแม่ฮ่องสอน" ได้วิวอำเภอ 14 ใบ)
//   → คำค้นแนวนี้ต้อง "ผูกชื่อคนในข่าว" เสมอ ถึงจะยิงได้ (ได้ภาพลงพื้นที่จริงแทน)
const GEO_KW = /หมู่บ้าน|ตำบล|อำเภอ|จังหวัด|แขวง|ชุมชน|ซอย|ถนน|พื้นที่|\bdistrict\b|\bprovince\b|\bvillage\b|\bsubdistrict\b/i;

// เลือกคำค้น "สมดุลต่อบุคคล" (round-robin) + P2: ผูกวัตถุกับเจ้าของ, ตัดคำค้นวัตถุลอย
export function buildQueries(keywords, maxQueries) {
  // ★ 9 ก.ค. เฟส 4a: เปิด/ปิดหมวดคำค้น "เชิงเรื่องราว" + emotion/source_show + สถานที่ตปท. (kill-switch)
  const STORY_ON = process.env.IMG_STORY_QUERIES !== '0';
  const subjects = keywords.subjects || [];
  const personNames = subjects.filter((s) => !isObjectSubject(s)).map((s) => s.name).filter(Boolean);
  const objectNames = subjects.filter(isObjectSubject).map((s) => s.name).filter(Boolean);
  const th = keywords.queries_th || [];
  const en = keywords.queries_en || [];
  const objq = keywords.object_queries || [];

  // pool = คำค้นบุคคล + คำค้นวัตถุ(ผูกชื่อ) + ชื่อ subject วัตถุ
  let pool = [...th, ...en, ...objq, ...objectNames];
  // 🚫 P2: ตัด "คำค้นวัตถุลอย" — มีคำ "วัตถุ" แต่ไม่มีชื่อบุคคลใดเลย (บ้าน/รถของใครก็ไม่รู้)
  const hasPerson = (q) => personNames.some((n) => String(q).toLowerCase().includes(n.toLowerCase()));
  pool = pool.filter((q) => !(OBJECT_KW.test(String(q)) && !hasPerson(q)));

  // 🧾 คำค้น "หลักฐาน/โมเมนต์" (object_queries + moment_action) = คุณค่าสูงสุดของข่าว → การันตียิงเสมอ
  //    (บั๊กเดิม: จดหมาย/เช็คถูกสกัดไว้ใน moment_action แต่ "ไม่เคยถูกยิง" เพราะไม่อยู่ใน pool
  //     และโควตา round-robin (~4 คำ) หมดไปกับคำ generic ชื่อดาราก่อน → ภาพหลักฐานไม่เคยเข้าคลัง)
  const mainName = personNames[0] || '';
  // ไม่มีชื่อบุคคลในคำค้น → ผูกชื่อตัวหลักเข้าไป (กันได้ภาพหลักฐาน/โมเมนต์ของใครก็ไม่รู้)
  const bindName = (q) => {
    const t = String(q || '').trim();
    if (!t) return '';
    return hasPerson(t) || !mainName ? t : `${t} ${mainName}`;
  };
  // ★ 8 ก.ค. (ผู้ใช้สั่ง "ห้ามคีย์มั่ว"): คำค้นภูมิศาสตร์เปล่าใน pool (ไม่เอ่ยชื่อคน) → ผูกชื่อตัวหลักก่อนยิง
  //   (ข่าวไม่มีบุคคลเลย = พื้นที่คือตัวข่าว เช่นน้ำท่วมอำเภอ X — คงไว้ตามเดิม)
  pool = pool.map((q) => (GEO_KW.test(String(q)) && !hasPerson(q) ? bindName(q) : q)).filter(Boolean);

  // ★ 9 ก.ค. เฟส 4a: หมวด "เชิงเรื่องราว" + emotion/source_show — ผูกชื่อคนเสมอ, ต่อท้าย pool
  //   ลำดับความสำคัญ: ชื่อคน+เหตุการณ์เดิม (th/en/objq) นำก่อน → หมวดเรื่องราว → emotion/source_show ท้ายสุด (ยิงเมื่อโควตาเหลือ)
  //   หมายเหตุ: "hashtags" ตั้งใจไม่รวมยิง — เครื่องหมาย # ทำ Google/Yandex/FB image match พัง + ซ้ำกับชื่อคน (คงไว้ในสคีมาสำหรับ IG/TikTok แมนนวล)
  const storyQ = STORY_ON && mainName
    ? [
        ...(keywords.relationship_archive || []),
        ...(keywords.landmark_context || []),
        ...(keywords.lifestyle_travel || []),
        ...(keywords.family_album || []),
      ].map(bindName).filter(Boolean)
    : [];
  const emoShowQ = STORY_ON && mainName
    ? [...(keywords.emotion || []), ...(keywords.source_show || [])].map(bindName).filter(Boolean)
    : [];
  pool = [...pool, ...storyQ, ...emoShowQ];

  const HARD_EVIDENCE = /จดหมาย|เช็ค|ป้าย|เอกสาร|ลายมือ|สลิป|แชท|ใบประกาศ|มอบเงิน|บริจาค|โพสต์/;
  const moments = keywords.moment_action || [];
  // 🧾 หลักฐาน (เอกสาร/ป้าย/วัตถุผูกชื่อ) = "ของเด็ด" ช่องวงกลม → การันตียิงเสมอ
  //    (บั๊กเดิม: จดหมาย/เช็คถูกสกัดไว้ใน moment_action แต่ "ไม่เคยถูกยิง" เพราะไม่อยู่ใน pool)
  const evidence = dedupeTake(
    [...objq, ...moments.filter((q) => HARD_EVIDENCE.test(String(q)))].map(bindName).filter(Boolean),
    EVIDENCE_SLOTS
  );
  // 🎬 ★ item #4: โมเมนต์/แอ็กชัน/ปฏิกิริยา (ฉากคนละแบบ ไม่ใช่หลักฐานเอกสาร) → ช่องแอ็กชัน/รีแอกชัน/โมเมนต์
  //    แยกโควตาต่างหาก ไม่ให้เอกสารเบียดทิ้ง (CASE-349 พูลล้มเป็นพอร์ตเทรตซ้ำเพราะฉากพวกนี้ไม่เคยได้ยิง)
  const momentScenes = dedupeTake(
    moments.filter((q) => !HARD_EVIDENCE.test(String(q))).map(bindName).filter(Boolean),
    MOMENT_SLOTS
  );

  // 🏛️ คำค้น "สถานที่สาธารณะชื่อเฉพาะ" จาก scene_place (เช่น "มหาวิทยาลัยแม่ฟ้าหลวง", "โรงเรียนนานาชาติโชรส์เบอรี")
  //    ค้นตรงได้เลยไม่ต้องผูกชื่อคน — ภาพป้าย/อาคารสถาบันจาก Google คือภาพถูกต้องเสมอ (ชื่อเฉพาะระบุตัวตนแล้ว)
  //    กัน generic 2 ชั้น: (1) ต้องมีอะไรตามหลังคำสถาบัน (2) คำขยาย generic (นานาชาติ/เอกชน/ดัง...) ไม่นับเป็นชื่อ
  //    — บทเรียน AC-0003: "งานจบการศึกษาโรงเรียนนานาชาติ" เคยผ่าน → ได้งานจบของเด็กใครก็ไม่รู้ทั้งเน็ต 188 ใบ
  const PLACE_GENERIC = /^(?:(?:นานาชาติ|เอกชน|รัฐบาล|อนุบาล|ประถม|มัธยม|ชั้นนำ|ชื่อดัง|ดัง|หรู|ใหญ่|ไทย|แห่งหนึ่ง)\s*)+/;
  const instPlaces = (keywords.scene_place || [])
    .map((s) => String(s || '').trim())
    .filter((s) => {
      const m = s.match(PLACE_INST);
      if (!m) return false;
      // ตัดคำขยาย generic หลังคำสถาบันออกก่อน — ต้องเหลือ "ชื่อเฉพาะจริง" ≥3 ตัวอักษร
      const after = s.slice(s.indexOf(m[0]) + m[0].length).trim().replace(PLACE_GENERIC, '');
      return after.length >= 3;
    });
  // ★ 8 ก.ค.: สถานที่แบบ "เขตปกครอง/พื้นที่" (หมู่บ้าน/ตำบล/อำเภอ — ไม่ใช่สถาบันชื่อเฉพาะ) ค้นเปล่าได้แต่วิว
  //   → ผูกชื่อตัวหลักแล้วค่อยยิง (ภาพลงพื้นที่จริงของข่าวนี้) · ไม่มีชื่อคนให้ผูก = ไม่ยิงเลย
  // ★ 9 ก.ค. เฟส 4a (เลิก regex ไทยล้วน): เดิมรับแต่ GEO_KW ไทย → "เมลเบิร์น"/"หอไอเฟล"/"สนามบินซิดนีย์" ตกรอบเงียบ
  //   ตอนนี้ (STORY_ON) รับ scene_place ที่ "ไม่ใช่สถาบันชื่อเฉพาะ" ทั้งหมด (รวมสถานที่ตปท./แลนด์มาร์ก) แล้วผูกชื่อคนก่อนยิง
  //   ปลอดภัยเพราะผูกชื่อคนเสมอ (ได้ภาพคน+สถานที่ ไม่ใช่วิวเปล่าของใครก็ไม่รู้) · ปิดหมวดใหม่ = กลับพฤติกรรม GEO ไทยเดิม
  const geoPlaces = mainName
    ? (keywords.scene_place || [])
        .map((s) => String(s || '').trim())
        .filter((s) => s && !PLACE_INST.test(s) && (GEO_KW.test(s) || STORY_ON))
        .map(bindName)
    : [];
  const places = dedupeTake([...instPlaces, ...geoPlaces], PLACE_SLOTS);

  // 📖 ★ 9 ก.ค. เฟส 4a: หมวด "เชิงเรื่องราว" การันตี STORY_SLOTS คำ (ยิงแม้ event queries เยอะ → ภาพบริบท ≥ STORY_SLOTS ต่อแหล่ง)
  const story = STORY_ON ? dedupeTake(storyQ, STORY_SLOTS) : [];

  // 🧾🎬🏛️📖 หลักฐาน + โมเมนต์/แอ็กชัน + สถานที่ + เรื่องราว = การันตียิงทุกช่อง (เพิ่มจากโควตา round-robin ต่อบุคคล — ไม่เบียดสมดุลคน)
  //    ลำดับ: หลักฐาน/โมเมนต์/สถานที่นำก่อน (ตามเดิม) แล้วเรื่องราวต่อท้าย — แต่ทั้งหมดยิงก่อน round-robin
  const guaranteed = dedupeTake(
    [...evidence, ...momentScenes, ...places, ...story],
    EVIDENCE_SLOTS + MOMENT_SLOTS + PLACE_SLOTS + STORY_SLOTS
  );

  // round-robin ยึด "ชื่อบุคคล" (ถ้าข่าวไม่มีบุคคลเลย ค่อยใช้ทุก subject)
  const names = personNames.length ? personNames : subjects.map((s) => s.name).filter(Boolean);

  if (names.length <= 1) {
    // คนเดียว = หลักฐาน+สถานที่ก่อน แล้วตามด้วยชื่อ+คำค้นตามลำดับ
    return dedupeTake([...guaranteed, ...names, ...pool], maxQueries + guaranteed.length);
  }

  // คิวต่อบุคคล: ชื่อตัวเองก่อน แล้วตามด้วยคำค้นที่เอ่ยชื่อคนนั้น
  const perSubject = names.map((name) => {
    const nl = name.toLowerCase();
    const mine = pool.filter((q) => String(q).toLowerCase().includes(nl));
    return [name, ...mine];
  });
  const shared = pool.filter((q) => !names.some((n) => String(q).toLowerCase().includes(n.toLowerCase())));

  // round-robin ให้ทุกคนได้เท่าๆ กัน
  const seen = new Set();
  const out = [];
  let idx = 0;
  while (out.length < maxQueries) {
    let added = false;
    for (const q of perSubject) {
      const cand = q[idx];
      if (!cand) continue;
      const t = String(cand).trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
        added = true;
        if (out.length >= maxQueries) break;
      }
    }
    if (!added) break;
    idx++;
  }
  // เติมด้วยคำค้นรวม/ที่เหลือ ถ้ายังไม่ครบ
  for (const q of [...shared, ...pool]) {
    if (out.length >= maxQueries) break;
    const t = String(q).trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  // 🧾🏛️ หลักฐาน+สถานที่นำหน้าเสมอ (เพิ่มจากโควตา round-robin — ไม่เบียดสมดุลต่อบุคคล)
  return dedupeTake([...guaranteed, ...out], maxQueries + guaranteed.length);
}
