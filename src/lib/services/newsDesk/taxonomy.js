/**
 * News Desk Taxonomy (25 มิ.ย. 69) — โค้ดกลาง "จัดระเบียบโต๊ะข่าว" ใช้ร่วม API + UI + harvester
 * ─────────────────────────────────────────────────────────────────────────────
 * แกน 2 มิติ:
 *   1) sourceType — ชนิดแหล่งจาก URL (ยูทูป/TikTok/รีลส์FB/โพสต์FB/IG/บทความ)
 *   2) library    — คลังเนื้อหา 6 คลัง (ยุบจาก 15 หมวดเดิม)
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง — ไม่เกี่ยวระบบทำปก/ทำข่าวอัตโนมัติ
 * 🔴 isomorphic (pure JS) — import ได้ทั้งฝั่ง server (API) และ client (page.js)
 */

// ── 6 คลังเนื้อหา (ผู้ใช้เคาะ 25 มิ.ย.) ──
export const LIBRARIES = [
  { key: 'namdee',   label: '💚 น้ำดี',            emoji: '💚' },
  { key: 'interview', label: '🎤 สัมภาษณ์/รายการ', emoji: '🎤' },
  { key: 'drama',    label: '🎬 ดราม่า/กระแส',     emoji: '🎬' },
  { key: 'celeb',    label: '⭐ คนดัง/ดารา',       emoji: '⭐' },
  { key: 'commoner', label: '🧑‍🌾 ชาวบ้าน/พลเมืองดี', emoji: '🧑‍🌾' },
  { key: 'help',     label: '🆘 ช่วยเหลือ/บริจาค',  emoji: '🆘' },
];
export const LIBRARY_KEYS = LIBRARIES.map(l => l.key);

// ── ชนิดแหล่ง + ป้าย/สี (ใช้ทำ badge บนการ์ด) ──
export const SOURCE_TYPES = {
  youtube:   { label: '▶️ ยูทูป',     color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  tiktok:    { label: '🎵 TikTok',    color: '#0f172a', bg: 'rgba(15,23,42,0.12)' },
  'fb-clip': { label: '🎬 รีลส์ FB',  color: '#7c3aed', bg: 'rgba(124,58,237,0.14)' },
  'fb-post': { label: '📘 โพสต์เพจ',  color: '#2563eb', bg: 'rgba(37,99,235,0.13)' },
  ig:        { label: '📷 IG',        color: '#db2777', bg: 'rgba(219,39,119,0.12)' },
  article:   { label: '📰 สำนักข่าว', color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
};
// ตัวกรองชนิดแหล่งในโซนคลิป
export const CLIP_SOURCES = ['youtube', 'tiktok', 'fb-clip', 'ig'];

// ── ♾️ อมตะ vs 🔥 กระแส (28 มิ.ย. — ผู้ใช้สั่ง: แยก "ทำใหม่ได้ตลอด" ออกจาก "จบในตอนนั้น") ──
//   ใช้คู่กับ remakeable/lane จาก deskBrain — ป้ายนี้ช่วย บก คัดเฉพาะ "ข่าวที่หยิบมาทำใหม่ได้จริง"
export const FRESH_CLASSES = {
  timeless: { key: 'timeless', label: '♾️ อมตะ', emoji: '♾️', desc: 'ทำใหม่ได้ตลอด (บริจาค/กตัญญู/ช่วยเหลือ/สัมภาษณ์ชีวิต)' },
  trend:    { key: 'trend',    label: '🔥 กระแส', emoji: '🔥', desc: 'ผูกเหตุการณ์เฉพาะ ทำตอนนี้เท่านั้น (น้ำท่วม/ดราม่าสด)' },
};

/**
 * แยก "อมตะ (ทำใหม่ได้ตลอด)" vs "กระแส (จบในตอนนั้น)" — บทเรียนผู้ใช้:
 *   ดาราช่วยน้ำท่วมหาดใหญ่ = น้ำดี "กระแส" (ทำใหม่ไม่ได้) · บริจาคโรงพยาบาล/ปัญญาปันสุข = น้ำดี "อมตะ"
 *   อิงจาก remakeable (deskBrain ประเมินแล้ว) + lane เป็นหลัก → fallback ดู library
 */
export function freshClass(item) {
  const lane = String((item && item.lane) || '');
  const remakeable = item && item.remakeable;
  if (/evergreen|throwback/.test(lane)) return 'timeless'; // เลนของเก่าตั้งใจหยิบ = อมตะชัด
  if (/\b(trend|buzz)\b/.test(lane)) return 'trend';       // เลนกระแสสด
  if (remakeable === false) return 'trend';                 // บก ฟันธงว่าทำใหม่ไม่ได้
  if (remakeable === true) return 'timeless';               // บก ฟันธงว่าทำใหม่ได้
  // ไม่ชัด → ดราม่า/กระแสรายวัน มักเป็นกระแส · ที่เหลือ default อมตะ (กันตัดเกิน)
  return libraryOf(item) === 'drama' ? 'trend' : 'timeless';
}

/** ชนิดแหล่งจาก URL — เรียงเงื่อนไขเฉพาะก่อนกว้าง (รีลส์ FB ต้องมาก่อนโพสต์ FB) */
export function classifySource(item) {
  const u = String((item && item.url) || '');
  if (/youtube\.com|youtu\.be/.test(u)) return 'youtube';
  if (/tiktok\.com/.test(u)) return 'tiktok';
  if (/facebook\.com\/(reel|watch|share\/[rv]|[^/]+\/videos)|fb\.watch/.test(u)) return 'fb-clip';
  if (/instagram\.com/.test(u)) return 'ig';
  if (/facebook\.com|m\.facebook|fb\.com/.test(u)) return 'fb-post';
  return 'article';
}

/** เป็น "คลิป" ไหม → ใช้แยกโซนคลิป/ลิงก์ (คลิป = วิดีโอจากโซเชียล หรือมีบทถอดเสียง) */
export function isClip(item) {
  const s = classifySource(item);
  if (s === 'youtube' || s === 'tiktok' || s === 'fb-clip' || s === 'ig') return true;
  // เผื่อ url ไม่เข้าเงื่อนไขแต่เป็นคลิปจริง (เลน video/interview หรือมีบทถอดเสียง)
  return !!(item && (item.isVideo || item.lane === 'video' || item.lane === 'interview' || item.fullText));
}

/** ยุบ 15 หมวด/เลน/subject → 1 ใน 6 คลัง */
export function libraryOf(item) {
  const cat = (item && item.category) || '';
  const lane = (item && item.lane) || '';
  const subj = (item && item.subject) || '';

  // สัมภาษณ์/รายการ — ตามหมวดหรือเลนย้อนสัมภาษณ์
  if (cat === 'สัมภาษณ์/บทสนทนาดี' || lane === 'interview' || lane === 'throwback') return 'interview';
  // ช่วยเหลือ/บริจาค — แยกออกจากน้ำดีตามที่ผู้ใช้สั่ง
  if (cat === 'น้ำใจ/ช่วยเหลือ') return 'help';
  // ดราม่า/กระแส
  if (['คนดัง/ดราม่าบันเทิง', 'ดราม่าสังคม', 'กระแสรายวัน', 'บันเทิงกระแส', 'อาชญากรรม/คดีดัง', 'เตือนภัย/อุทาหรณ์'].includes(cat)) return 'drama';
  // น้ำดี (กตัญญู/สู้ชีวิต/คนดังทำดี) — ถ้าเป็นคนธรรมดา → เข้าคลังชาวบ้าน
  if (['กตัญญู/ครอบครัวอบอุ่น', 'สู้ชีวิต', 'คนดังทำดี/ติดดิน'].includes(cat)) {
    return subj === 'ordinary' ? 'commoner' : 'namdee';
  }
  // คนดัง/ดารา ทั่วไป (ความรัก/ไลฟ์สไตล์/กีฬา)
  if (['ความรัก/แต่งงาน', 'ไลฟ์สไตล์/ไวรัล', 'กีฬา'].includes(cat)) return 'celeb';
  // ที่เหลือ/อื่นๆ — คนธรรมดา → ชาวบ้าน, ไม่งั้นจัดเป็นคนดัง
  return subj === 'ordinary' ? 'commoner' : 'celeb';
}

/** ดึง videoId จาก URL ยูทูปทุกรูปแบบ (watch/shorts/embed/youtu.be) */
export function youtubeVideoId(url) {
  const u = String(url || '');
  let m = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = u.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** ภาพพรีวิวยูทูปจาก videoId — ทุกคลิปยูทูปมีพรีวิวเสมอ (เติมเมื่อ imageUrl ว่าง) */
export function youtubeThumb(url) {
  const id = youtubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** เติมฟิลด์จัดระเบียบให้ item (sourceType + library + เติม thumbnail ยูทูปถ้าว่าง) */
export function enrichDeskItem(item) {
  const sourceType = classifySource(item);
  let imageUrl = item.imageUrl || '';
  if (!imageUrl && sourceType === 'youtube') imageUrl = youtubeThumb(item.url) || '';
  return { ...item, sourceType, library: libraryOf(item), imageUrl, freshClass: freshClass(item) };
}
