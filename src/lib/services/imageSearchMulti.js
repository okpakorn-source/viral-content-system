// ============================================================
// 🔎 ค้นภาพหลายแหล่งพร้อมกัน (SerpApi) — สำหรับหน้า /image-search
// ------------------------------------------------------------
// ★ 4 ก.ค. 2026 พอร์ตส่วน "รีเสิร์ชภาพ" มาจากโปรเจกต์ระบบทำปกออโต้
//   (C:\Users\User\ระบบทำปกออโต้ src/lib/imageSearch.js) ตามคำสั่งผู้ใช้
//   — เอาเฉพาะการค้นภาพ: ผู้ใช้พิมพ์คำค้นเอง เลือกแหล่งเอง เลือกภาพลงปกเอง
// engine ที่ใช้: google_images (+site:filter FB/TikTok) · google_news ·
//   bing_images · bing_news · yandex_images · youtube (thumbnail) ·
//   google_lens (ค้นย้อนกลับ) · instagram_profile · facebook_profile
// คีย์: SERPAPI_KEY (.env.local / Vercel env)
// 🔴 แยกเดี่ยว 100% — ไม่แตะท่อทำข่าว/ท่อปกอัตโนมัติ
// ============================================================

export const PLATFORMS = ['google', 'google_news', 'yandex', 'bing', 'bing_news', 'facebook', 'tiktok', 'youtube'];

export const PLATFORM_LABEL = {
  google: '🌄 Google',
  google_news: '📰 Google News',
  yandex: '🌐 Yandex',
  bing: '🔷 Bing',
  bing_news: '📑 Bing News',
  facebook: '📘 FB (เว็บ)',
  tiktok: '🎵 TikTok',
  youtube: '▶️ YouTube',
  reverse: '🔍 ย้อนกลับ',
  instagram: '📷 IG',
  fb_profile: '📘 FB โปรไฟล์',
};

// แพลตฟอร์มที่ค้นผ่าน google_images พร้อม site: filter
const SITE_FILTER = { google: null, facebook: 'facebook.com', tiktok: 'tiktok.com' };

function isNoResults(err) {
  return typeof err === 'string' && /hasn't returned any results|no results/i.test(err);
}

function getKey() {
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    const e = new Error('ยังไม่ได้ตั้ง SERPAPI_KEY ใน env');
    e.errorType = 'NO_SERPAPI_KEY';
    throw e;
  }
  return key;
}

async function serpGet(params) {
  const usp = new URLSearchParams({ ...params, api_key: getKey() });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let res, data;
  try {
    res = await fetch('https://serpapi.com/search.json?' + usp.toString(), { signal: controller.signal });
    data = await res.json().catch(() => ({}));
  } finally { clearTimeout(timer); }
  if (!res.ok || data.error) {
    if (isNoResults(data.error)) return { _empty: true };
    const e = new Error('SerpApi: ' + (data.error || res.status));
    e.errorType = 'PROVIDER_ERROR';
    throw e;
  }
  return data;
}

// normalize รายการภาพให้รูปแบบเดียวกันทุก engine
function normItem(im) {
  const imageUrl =
    im.original || im.original_image?.link ||
    (typeof im.image === 'string' ? im.image : im.image?.link) ||
    im.display_url || im.thumbnail || im.thumbnail_src || im.link || '';
  const thumbnailUrl = im.thumbnail || im.serpapi_thumbnail_src || im.thumbnail_src || imageUrl;
  const src = im.source && typeof im.source === 'object' ? im.source.name || '' : im.source || im.domain || '';
  const link = im.link || (im.source && typeof im.source === 'object' ? im.source.link : '') || '';
  return {
    imageUrl,
    thumbnailUrl,
    title: (im.title || '').slice(0, 120),
    source: typeof src === 'string' ? src.slice(0, 50) : '',
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
    for (const it of obj) { const r = findArrayWith(it, field, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) { const r = findArrayWith(obj[k], field, depth + 1); if (r) return r; }
  }
  return null;
}

// ค้นภาพ 1 คำค้น ตามแพลตฟอร์ม → array ภาพ normalize แล้ว
export async function searchImagesMulti(platform, query, { num = 40, gl = 'th', hl = 'th' } = {}) {
  if (platform === 'youtube') {
    const d = await serpGet({ engine: 'youtube', search_query: query, gl, hl });
    if (d._empty) return [];
    return (d.video_results || []).slice(0, num).map((v) => {
      const thumb = typeof v.thumbnail === 'string' ? v.thumbnail : v.thumbnail?.static || '';
      return { imageUrl: thumb, thumbnailUrl: thumb, title: (v.title || '').slice(0, 120), source: v.channel?.name || 'YouTube', sourceLink: v.link || '', width: null, height: null };
    }).filter((x) => x.imageUrl);
  }
  if (platform === 'google_news') {
    const d = await serpGet({ engine: 'google_news', q: query, gl, hl });
    return d._empty ? [] : normList(d.news_results, num);
  }
  if (platform === 'bing_news') {
    const d = await serpGet({ engine: 'bing_news', q: query });
    return d._empty ? [] : normList(d.news_results || d.organic_results, num);
  }
  if (platform === 'yandex') {
    const d = await serpGet({ engine: 'yandex_images', text: query });
    return d._empty ? [] : normList(d.images_results, num);
  }
  if (platform === 'bing') {
    const d = await serpGet({ engine: 'bing_images', q: query });
    return d._empty ? [] : normList(d.images_results, num);
  }
  // google / facebook / tiktok → google_images (+ site filter)
  const site = SITE_FILTER[platform];
  const q = site ? `${query} site:${site}` : query;
  const d = await serpGet({ engine: 'google_images', q, gl, hl });
  return d._empty ? [] : normList(d.images_results, num);
}

// ค้นย้อนกลับ (Google Lens) จากภาพ 1 ใบ → ภาพคนเดิมจากทุกที่
export async function reverseImageMulti(imageUrl, { num = 30, hl = 'th' } = {}) {
  const d = await serpGet({ engine: 'google_lens', url: imageUrl, type: 'visual_matches', hl, country: 'th' });
  if (d._empty) return [];
  return normList(d.visual_matches, num);
}

// ดึงรูปจากโปรไฟล์ Instagram (ต้องรู้ username)
export async function instagramProfileImages(profileId, { num = 40 } = {}) {
  const d = await serpGet({ engine: 'instagram_profile', profile_id: profileId });
  if (d._empty) return [];
  const posts = findArrayWith(d, 'display_url') || findArrayWith(d, 'thumbnail_src') || [];
  return posts.slice(0, num).map((p) => ({
    imageUrl: p.display_url || p.thumbnail_src || p.serpapi_thumbnail_src || '',
    thumbnailUrl: p.serpapi_thumbnail_src || p.thumbnail_src || p.display_url || '',
    title: (p.caption || '').slice(0, 60),
    source: 'Instagram',
    sourceLink: p.shortcode ? `https://www.instagram.com/p/${p.shortcode}/` : '',
    width: null, height: null,
  })).filter((x) => x.imageUrl && /^https?:/.test(x.imageUrl));
}

// ดึงรูปจากโปรไฟล์ Facebook (profile pic + cover + photos)
export async function facebookProfileImages(profileId, { num = 40 } = {}) {
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
