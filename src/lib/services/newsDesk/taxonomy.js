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

// ── 🌀 REFRESH MODES (เฟส 5 — 29 มิ.ย. ตามแผน GPT ข้อ 3/4/13) ──
//   ปุ่มหาข่าวไม่ทำงานแบบเดียว — แต่ละโหมด = ชุดเลน(query+scoring)คนละแบบ → ทุกรีเฟรชสำรวจพื้นที่ใหม่
export const HARVEST_MODES = [
  { key: 'fresh',     label: '⚡ สดวันนี้',     lanes: ['trend', 'buzz'],                                          desc: 'ข่าว/ดราม่ากระแสสดวันนี้' },
  { key: 'viral',     label: '🔥 ไวรัล',        lanes: ['trend', 'buzz', 'video'],                                desc: 'คลิป/โพสต์ไวรัลไทยกำลังขึ้น' },
  { key: 'evergreen', label: '♾️ น้ำดีอมตะ',    lanes: ['good', 'evergreen'],                                     desc: 'เรื่องน้ำดี/อมตะ ทำใหม่ได้ตลอด' },
  { key: 'celeb',     label: '⭐ ดารา',          lanes: ['celeb', 'good'],                                         desc: 'ข่าวดารา/คนดังไทยจาก watchlist' },
  { key: 'followup',  label: '🔁 ตามรอย',        lanes: ['followup'],                                              desc: 'ตามต่อข่าวที่เคยมี momentum' },
  { key: 'all',       label: '🌀 ครบทุกเลน',     lanes: ['trend', 'good', 'broad', 'exa', 'evergreen', 'followup', 'buzz'], desc: 'หากว้างทุกแนว (รอบใหญ่)' },
];
export const HARVEST_MODE_KEYS = HARVEST_MODES.map(m => m.key);

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

// ════════════════════════════════════════════════════════════════════════════
// 📋 EDITORIAL CARD (เฟส 1 — 29 มิ.ย. ตามแผน GPT ข้อ 1/9/14/15)
//   สังเคราะห์ "การ์ดบรรณาธิการ" จากฟิลด์ที่ deskBrain/harvester ประเมินไว้แล้ว — deterministic ไม่เพิ่ม AI call
//   เปลี่ยนโต๊ะข่าวจาก "กองลิงก์+คะแนน" → "ทำได้เลย/ต้องหาเพิ่มอะไร/ทำไมควร-ไม่ควร"
// ════════════════════════════════════════════════════════════════════════════
export const EDITORIAL_STATUS = {
  ready:         { key: 'ready',         label: '✅ พร้อมเขียน',  color: '#16a34a', desc: 'ข้อมูล/มุม/ภาพครบ ส่ง workflow ได้เลย' },
  needsResearch: { key: 'needsResearch', label: '🔎 ต้องหาเพิ่ม', color: '#d97706', desc: 'น่าทำ แต่ยังขาดบางอย่าง (ดู coverageGap)' },
  weakSource:    { key: 'weakSource',    label: '⚠️ แหล่งอ่อน',   color: '#ca8a04', desc: 'คน/แหล่งยังไม่แข็งพอ ควรหาแหล่งที่ดีกว่า' },
  duplicate:     { key: 'duplicate',     label: '🔁 มุมซ้ำ',      color: '#6b7280', desc: 'ประเด็นซ้ำของเดิม ไม่มีมุมใหม่' },
  lowValue:      { key: 'lowValue',      label: '💤 คุณค่าน้อย',  color: '#94a3b8', desc: 'มีข่าวแต่ไม่น่าทำ (ตื้น/ไม่มีตัวละคร)' },
  reject:        { key: 'reject',        label: '🚫 ไม่ควรทำ',    color: '#dc2626', desc: 'ไม่ควรเข้าสต็อก (อ่อนไหว/นอกไทย/พิษ)' },
};

/**
 * editorialCard — ประเมิน "ความพร้อมทำข่าว" จากฟิลด์ที่มี (ข้อ 1+9+14+15)
 * คืน { status, readiness(0-100), coverageGap[], whyDo, whyNot }
 */
export function editorialCard(item) {
  const it = item || {};
  const score = Number(it.judgeScore ?? it.score ?? 0);          // 0-10 (ถ้ายังไม่ judge = 0)
  const hasMainChar = it.hasMainChar !== false;
  const remakeable = it.remakeable !== false;
  const notability = it.notability || 'semiKnown';
  const staleTrend = it.staleTrend === true;
  const foreign = !!it.foreignCountry;
  const royalNeg = it.royalNegative === true;
  const toxicity = Number(it.toxicity || 0);
  const sType = classifySource(it);
  const hasImage = !!(it.imageUrl || sType === 'youtube'); // ยูทูปมี thumbnail เสมอ
  const isDup = !!(it.sameStoryAs || it.duplicateOf || it.dupOfArchive);
  const lib = libraryOf(it);
  const fresh = freshClass(it);

  // ── coverage gap: ข่าวนี้ขาดอะไร (ข้อ 14) ──
  const coverageGap = [];
  if (!hasMainChar) coverageGap.push('ขาดตัวละครหลักชัด');
  if (!hasImage) coverageGap.push('ขาดภาพ/คลิปประกอบ');
  if (foreign) coverageGap.push(`นอกไทย (${it.foreignCountry})`);
  if (notability === 'unknown') coverageGap.push('คนยังไม่เป็นที่รู้จัก');
  if (staleTrend) coverageGap.push('เป็นกระแสเก่าที่จบแล้ว');
  if (isDup) coverageGap.push('มุมซ้ำของเดิม');
  if (!score) coverageGap.push('ยังไม่ผ่าน บก.ประเมิน');
  const relScore = it.reliability ? Number(it.reliability.score) : 60; // ★ เฟส 4: ความน่าเชื่อแหล่ง
  if (relScore < 40) coverageGap.push('แหล่งอ่อน ควรหาแหล่งยืนยัน');

  // ── readiness 0-100 (ข้อ 9) ──
  let readiness = Math.round(score * 4);                          // คะแนน บก. → สูงสุด 40
  if (hasMainChar) readiness += 18;
  if (remakeable) readiness += 12;
  readiness += (notability === 'famous' ? 14 : notability === 'semiKnown' ? 7 : 0);
  if (!staleTrend) readiness += 6;
  if (!foreign) readiness += 6;
  if (hasImage) readiness += 14;
  if (toxicity >= 2) readiness -= 8;
  readiness = Math.max(0, Math.min(100, readiness));

  // ── status (ข้อ 1) ──
  let status;
  if (royalNeg || toxicity >= 3 || (foreign && notability !== 'famous')) status = 'reject';
  else if (!hasMainChar) status = 'lowValue';
  else if (isDup && !remakeable) status = 'duplicate';
  else if (notability === 'unknown' || relScore < 38) status = 'weakSource';
  else if (!remakeable && score < 6) status = 'lowValue';
  else if (readiness >= 78 && hasImage) status = 'ready';
  else if (readiness >= 55) status = 'needsResearch';
  else status = 'weakSource';

  // ── เหตุผลควรทำ / ไม่ควรทำ (ข้อ 15) ──
  const libWhy = {
    namdee: 'ข่าวน้ำดี อารมณ์ร่วมสูง', help: 'ข่าวน้ำใจ/ช่วยเหลือ ชวนแชร์',
    interview: 'สัมภาษณ์/รายการ มีคำพูดเจาะใจ', drama: 'ดราม่ากระแส คนกำลังพูดถึง',
    celeb: 'คนดังคนไทยรู้จัก ตามอยู่', commoner: 'คนธรรมดาเรื่องกินใจ',
  };
  let whyDo = libWhy[lib] || 'มีตัวละคร+ประเด็นเล่าได้';
  if (fresh === 'timeless') whyDo += ' · อมตะทำใหม่ได้ตลอด';
  const whyNot = status === 'reject'
    ? (royalNeg ? 'อ่อนไหวสถาบัน' : toxicity >= 3 ? 'เนื้อหารุนแรง/พิษ' : `นอกไทย (${it.foreignCountry || ''})`)
    : (coverageGap[0] || (status === 'ready' ? '' : 'ข้อมูลยังไม่แข็งพอ'));

  return { status, readiness, coverageGap, whyDo, whyNot };
}

// ════════════════════════════════════════════════════════════════════════════
// 📊 MULTI-DIMENSION SCORES (เฟส 2 — 29 มิ.ย. ตามแผน GPT ข้อ 11)
//   แยกคะแนนหลายมิติ — อย่าใช้ "ความสด" ตัดสินทุกข่าว (ข่าวเก่า freshness ต่ำ แต่ evergreen+emotional สูง = เก็บได้)
//   deterministic จากฟิลด์ที่ deskBrain ประเมินไว้แล้ว — ไม่เพิ่ม AI call
// ════════════════════════════════════════════════════════════════════════════
export function multiScores(item) {
  const it = item || {};
  const lane = String(it.lane || '');
  const lib = libraryOf(it);
  const remakeable = it.remakeable !== false;
  const pattern = it.storyNature !== 'event';
  const foreign = !!it.foreignCountry;
  const notability = it.notability || 'semiKnown';
  const tox = Number(it.toxicity || 0);
  const alt = Array.isArray(it.altSources) ? it.altSources.length : 0;
  const fresh = freshClass(it);
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  // อายุข่าว (วัน) — ใช้คำนวณ freshness
  let ageDays = null;
  const dt = it.publishedAt || it._rawDate || it.addedAt;
  if (dt) { const t = new Date(dt).getTime(); if (t > 0) ageDays = (Date.now() - t) / 86400e3; }

  // freshness: สด/กำลังเป็นกระแสไหม
  let freshness;
  if (/trend|buzz|video/.test(lane)) freshness = 88;
  else if (ageDays != null) freshness = ageDays <= 1 ? 95 : ageDays <= 3 ? 80 : ageDays <= 7 ? 60 : ageDays <= 30 ? 35 : 15;
  else freshness = fresh === 'trend' ? 70 : 40;

  // evergreen: เก่าแต่ยังทำได้ไหม
  let evergreen = remakeable ? (pattern ? 85 : 60) : 20;
  if (['namdee', 'interview', 'help', 'commoner'].includes(lib)) evergreen += 8;
  if (/evergreen|throwback/.test(lane)) evergreen += 7;

  // momentum: คนกำลังพูดถึงไหม
  let momentum = /trend|buzz/.test(lane) ? 78 : 45;
  momentum += alt * 8;                              // หลายสำนักรายงาน = กระแสแรง
  if (it.performance === 'viral') momentum = 100;
  if (it.trendTopic) momentum += 10;

  // emotional: พลังอารมณ์
  const emoBase = { namdee: 82, help: 85, commoner: 80, interview: 70, drama: 66, celeb: 55 };
  let emotional = (emoBase[lib] || 55) - tox * 4;

  // remake_potential: ทำใหม่ได้ไหม
  const remakePotential = remakeable ? (pattern ? 88 : 62) : 22;

  // thaiRelevance: ตรงตลาดไทยไหม
  let thaiRelevance;
  if (foreign) thaiRelevance = notability === 'famous' ? 55 : 18;
  else thaiRelevance = notability === 'famous' ? 95 : notability === 'semiKnown' ? 80 : 58;

  return {
    freshness: clamp(freshness), evergreen: clamp(evergreen), momentum: clamp(momentum),
    emotional: clamp(emotional), remakePotential: clamp(remakePotential), thaiRelevance: clamp(thaiRelevance),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 🧬 STORY CLUSTER (เฟส 3 — 29 มิ.ย. ตามแผน GPT ข้อ 2)
//   ซ้ำไม่ได้เกิดจาก URL อย่างเดียว — เรื่องเดียวกันมาคนละแพลตฟอร์ม/สำนัก = ควรเป็น cluster เดียว
//   storySignature: ลายเซ็นจาก "คำสำคัญในหัวข้อ" (ตัดคำทั่วไป) → เทียบข้ามลิงก์ได้
// ════════════════════════════════════════════════════════════════════════════
const _STOP_RE = /^(ข่าว|ล่าสุด|เปิดใจ|เผย|งานนี้|ชาวเน็ต|โซเชียล|คลิป|ภาพ|วิดีโอ|ที่|และ|กับ|ของ|ใน|เป็น|คือ|จาก|ให้|มา|ไป|ได้|แล้ว|ก็|จะ|ทำ|ถึง|นี้|นั้น|เมื่อ|the|and|a|an|to|of|in|on|for|with)$/;

export function storySignature(item) {
  const title = String((item && item.title) || '');
  const norm = title.toLowerCase().replace(/[^฀-๿a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = norm.split(' ').filter(w => w.length >= 3 && !_STOP_RE.test(w));
  // เก็บคำยาวสุด 5 คำ (มักเป็นชื่อ/คำสำคัญ) เรียง → ลายเซ็นคงที่
  const key = [...new Set(tokens)].sort((a, b) => b.length - a.length).slice(0, 5).sort();
  return key.join('|');
}

/** เรื่องเดียวกันไหม — ใช้เสริม dedup เดิม (กันเรื่องเดิมหัวข้อใกล้มากหลุดเข้าซ้ำ)
 *  ★ CONSERVATIVE โดยตั้งใจ: ทับ ≥2 คำสำคัญ "และ" ≥60% ของฝั่งสั้น → จับเฉพาะหัวข้อใกล้กันมาก
 *  ⚠️ ไม่พยายามจับ "เรื่องเดียวกันแต่เรียบเรียงต่างมาก" เพราะ token ไทยแยก "ซ้ำบุคคล(เบิร์ดป่วย≠เบิร์ดคอนเสิร์ต)"
 *     จาก "ซ้ำเหตุการณ์" ไม่ได้ → false-merge ทำข่าวดีหาย (อันตรายกว่าพลาดจับ)
 *  → cluster ข้ามแพลตฟอร์มเต็มรูป (story_cluster_id) ต้องใช้ AI สกัด person+event (งานเฟสอนาคต บน deskBrain) */
export function sameCluster(a, b) {
  const sa = storySignature(a).split('|').filter(Boolean);
  const sb = storySignature(b).split('|').filter(Boolean);
  if (sa.length < 2 || sb.length < 2) return false;
  const setB = new Set(sb);
  const overlap = sa.filter(t => setB.has(t)).length;
  // ★ ทับ 2 คำ = มักเป็นแค่ "ชื่อคน" (คนเดียวกันคนละข่าว) → ไม่รวม · ทับ ≥3 = ชื่อ+คำเหตุการณ์ตรงกัน = เรื่องเดียวกัน
  return overlap >= 3;
}

// ════════════════════════════════════════════════════════════════════════════
// 🏷️ SOURCE RELIABILITY (เฟส 4 — 29 มิ.ย. ตามแผน GPT ข้อ 10)
//   จัดชั้นความน่าเชื่อถือของแหล่งจากโดเมน + หลายแหล่งยืนยัน (altSources) = น่าเชื่อขึ้น
// ════════════════════════════════════════════════════════════════════════════
const NEWS_DOMAINS = /thairath|matichon|dailynews|khaosod|sanook|mgronline|posttoday|thaipbs|pptvhd36|ch3|ch7|one31|amarin|nationtv|nationthailand|bangkokpost|thaipost|komchadluek|naewna|springnews|tnnthailand|workpoint|thestandard|themomentum|siamrath|innnews|brighttv|mcot|prachachat|kapook|thairathonline|ejan|tnews|siamsport|goal\.com|footballthai/i;
const ENTERTAIN_PAGES = /entertain|dara|บันเทิง|spokedark|thairath-entertainment|gossip|mello/i;
const FARM_HINT = /blogspot|wordpress|medium\.com|\.xyz|\.info|\.top|content|viral.*blog/i;

export function sourceReliability(item) {
  const it = item || {};
  const url = String(it.url || '');
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const sType = classifySource(it);
  const altN = Array.isArray(it.altSources) ? it.altSources.length : 0;

  let tier, score;
  if (NEWS_DOMAINS.test(host)) { tier = 'newsOutlet'; score = 82; }       // สำนักข่าวไทยที่รู้จัก
  else if (sType === 'youtube') { tier = 'youtube'; score = 60; }          // ช่องยูทูป (ทางการ/รีโพสต์ปนกัน)
  else if (sType === 'fb-clip' || sType === 'tiktok' || sType === 'ig') { tier = 'socialCreator'; score = 52; }
  else if (ENTERTAIN_PAGES.test(host) || sType === 'fb-post') { tier = 'entertainPage'; score = 48; }
  else if (FARM_HINT.test(host) || (sType === 'article' && !NEWS_DOMAINS.test(host))) { tier = 'unverified'; score = 34; }
  else { tier = 'other'; score = 45; }

  // หลายแหล่งยืนยัน = ดันความน่าเชื่อ (ข้อ 10: source diversity)
  if (altN >= 1) score = Math.min(95, score + Math.min(20, altN * 7));

  const labels = { newsOutlet: '📰 สำนักข่าว', youtube: '▶️ ยูทูป', socialCreator: '🎬 ครีเอเตอร์โซเชียล', entertainPage: '📘 เพจบันเทิง', unverified: '⚠️ แหล่งไม่ยืนยัน', other: '• แหล่งทั่วไป' };
  return { tier, score, label: labels[tier] || tier, multiSource: altN >= 1 };
}

/** เติมฟิลด์จัดระเบียบให้ item (sourceType + library + thumbnail + editorial + scores + cluster + reliability) */
export function enrichDeskItem(item) {
  const sourceType = classifySource(item);
  let imageUrl = item.imageUrl || '';
  if (!imageUrl && sourceType === 'youtube') imageUrl = youtubeThumb(item.url) || '';
  const base = { ...item, sourceType, library: libraryOf(item), imageUrl, freshClass: freshClass(item) };
  base.reliability = sourceReliability(base); // ★ เฟส 4: ความน่าเชื่อแหล่ง (คำนวณก่อน — ให้ editorial ใช้)
  base.editorial = editorialCard(base);       // ★ เฟส 1: การ์ดบรรณาธิการ
  base.scores = multiScores(base);              // ★ เฟส 2: คะแนนหลายมิติ
  base.clusterKey = storySignature(base);       // ★ เฟส 3: ลายเซ็นเรื่อง
  return base;
}
