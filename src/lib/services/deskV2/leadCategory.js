/**
 * ============================================================
 * 🏷️ Lead Category (2 ส.ค. 69 — เจ้าของสั่ง "ปรับหมวดหมู่การแสดงผลข่าวให้ชัด")
 * ============================================================
 * ปัญหาที่เจอจากของจริง: ลีดบนโต๊ะ v2 274 ใบ **ไม่มีฟิลด์หมวดเลยสักใบ**
 *   (category/lane/subject ว่างหมด) — บนการ์ดมีแต่ "ชื่อคลัสเตอร์ครู" ที่เป็นประโยคยาว
 *   เช่น "เศรษฐีใจบุญจากจุดเริ่มต้นเล็กๆ ตอบแทนสังคมด้วยเงินก้อนใหญ่" → กวาดสายตาหาไม่ได้
 *
 * ทางแก้: จัดเข้า "6 คลัง" ที่ระบบมีอยู่แล้ว (LIBRARIES ใน taxonomy.js — ใช้จริงในแอพมือถือ)
 *   ① ถ้ามีผลจาก AI อยู่แล้ว (extract.insight.category) → ใช้อันนั้นก่อน แม่นสุด ไม่ต้องเดา
 *   ② ไม่มี → เทียบคำจาก "ชื่อคลัสเตอร์ + หัวข้อ + เหตุผล" กับคลังคำของแต่ละหมวด
 *   ③ คะแนนไม่ถึงเกณฑ์ → 'unknown' = "ยังไม่จัดหมวด" (🔴 ห้ามเดามั่วให้ดูเหมือนรู้)
 *
 * 🔴 ไม่มี AI · ไม่ยิงเน็ต · ไม่แตะเนื้อข่าว — เทียบคำล้วน ฟรี 100% และย้อนกลับได้ทันที
 * 🔴 isomorphic (pure) — import ได้ทั้ง client (การ์ด/ตัวกรอง) และ server
 * 🔴 import ได้เฉพาะ taxonomy.js (pure ไม่มี import ของตัวเอง) — กัน import วน
 */

import { LIBRARIES } from '../newsDesk/taxonomy.js';

/** ป้ายของ "ยังไม่จัดหมวด" — แยกจาก 6 คลังจริง เพื่อให้เห็นว่าอันไหนระบบยังไม่รู้ */
export const UNKNOWN_CATEGORY = { key: 'unknown', label: '❔ ยังไม่จัดหมวด', emoji: '❔' };

/** 6 คลัง + ยังไม่จัดหมวด — ลำดับนี้คือลำดับปุ่มกรองบน UI */
export const LEAD_CATEGORIES = [...LIBRARIES, UNKNOWN_CATEGORY];

// ── ① หมวดที่ AI ตัดสินไว้แล้ว (extract.insight.category) → คลัง ──
//    ค่าที่พบจริงในคลัง: 'น้ำใจ/ทำดี' · 'สังคม/ชีวิตคน' · 'บันเทิง/ดารา'
const INSIGHT_TO_LIBRARY = {
  'น้ำใจ/ทำดี': 'namdee',
  'สังคม/ชีวิตคน': 'commoner',
  'บันเทิง/ดารา': 'celeb',
  'ไลฟ์สไตล์/ไวรัล': 'celeb',
  'สัมภาษณ์/บทสนทนาดี': 'interview',
  'น้ำใจ/ช่วยเหลือ': 'help',
  'กตัญญู/ครอบครัวอบอุ่น': 'namdee',
  'สู้ชีวิต': 'commoner',
  'คนดังทำดี/ติดดิน': 'namdee',
  'คนดัง/ดราม่าบันเทิง': 'drama',
  'บันเทิงกระแส': 'drama',
  'ความรัก/แต่งงาน': 'celeb',
};

// ── ② คลังคำต่อหมวด ──
//   น้ำหนัก 2 = คำชี้ขาด (เจอแล้วแทบไม่ผิด) · น้ำหนัก 1 = คำบอกใบ้ (ต้องมีหลายคำถึงชนะ)
//   คำมาจาก archetype จริงที่พบบ่อยบนโต๊ะ + คลังคำ THEME_ACTIONS เดิม
const RULES = {
  help: {
    strong: ['บริจาค', 'ระดมทุน', 'ค่าผ่าตัด', 'ค่ารักษา', 'มอบเงิน', 'ทุนการศึกษา', 'ผู้ประสบภัย', 'ช่วยชีวิต', 'ส่งคืนเจ้าของ', 'เก็บเงินได้'],
    weak: ['ช่วยเหลือ', 'น้ำท่วม', 'ยื่นมือ', 'สงเคราะห์', 'มูลนิธิ', 'โรงพยาบาล', 'ไร้ที่พึ่ง', 'ให้โอกาส'],
  },
  interview: {
    strong: ['สัมภาษณ์', 'เปิดใจ', 'เปิดอก', 'ให้สัมภาษณ์', 'พอดแคสต์', 'ทอล์ก', 'คำสารภาพ', 'เล่าเบื้องหลัง', 'เปิดความลับ'],
    weak: ['รายการ', 'ตอบทุกคำถาม', 'เผยความในใจ', 'พูดถึงครั้งแรก'],
  },
  namdee: {
    strong: ['ใจบุญ', 'กตัญญู', 'ทำดี', 'น้ำใจ', 'ตอบแทนสังคม', 'ตอบแทนบุญคุณ', 'ติดดิน', 'ไม่ลืมราก', 'เสียสละ', 'เดอะแบก'],
    weak: ['ดูแลแม่', 'ดูแลพ่อ', 'ดูแลครอบครัว', 'ครอบครัวอบอุ่น', 'ความหรู', 'ทุ่มรายได้'],
  },
  drama: {
    strong: ['ดราม่า', 'ทัวร์ลง', 'ซัดกลับ', 'โต้กลับ', 'แฉ', 'ถูกถล่ม', 'ฟ้องร้อง', 'คดี', 'จับกุม'],
    weak: ['ปมร้อน', 'ถูกกดปม', 'ตอบโต้', 'เดือด', 'ชาวเน็ตวิจารณ์', 'ประเด็นร้อน'],
  },
  commoner: {
    strong: ['สู้ชีวิต', 'พลเมืองดี', 'ชนบท', 'ฐานะยากจน', 'หาบเร่', 'แม่ค้า', 'พ่อค้า', 'คนขับ', 'วินมอเตอร์ไซค์'],
    weak: ['ลุง', 'ป้า', 'ยาย', 'ตา', 'ขายของ', 'ออกจากบ้านไปสู้', 'เด็กไทยในต่างแดน', 'ประสบความสำเร็จ'],
  },
  // 🔴 คนดัง/ดารา = หมวด "เรื่องของคนดัง" (ความรัก/ไลฟ์สไตล์) ไม่ใช่ "ข่าวที่มีคนดังอยู่"
  //   คำว่า ดารา/คนดัง บอกแค่ "ใครอยู่ในข่าว" ไม่ได้บอก "ข่าวเรื่องอะไร" → ให้เป็นคำบอกใบ้ (1) เท่านั้น
  //   ไม่งั้น "ดาราบริจาคเงินล้าน" จะถูกจัดเป็นหมวดดารา ทั้งที่ควรเป็นน้ำดี
  //   (ตรงกับกฎเดิมของระบบใน taxonomy.js: คนดังทำดี/ติดดิน → คลังน้ำดี ไม่ใช่คลังคนดัง)
  celeb: {
    strong: ['แต่งงาน', 'ความรัก', 'คู่รัก', 'สะใภ้', 'ไลฟ์สไตล์', 'หย่า', 'คบหา', 'ควงแฟน'],
    weak: ['ดารา', 'นักแสดง', 'นักร้อง', 'ศิลปิน', 'เน็ตไอดอล', 'คนดัง', 'สามี', 'ภรรยา'],
  },
};

// เจอคะแนนเท่ากัน → ตัดสินตามลำดับนี้ (เฉพาะเจาะจงมาก่อนกว้าง)
const TIE_ORDER = ['help', 'interview', 'namdee', 'commoner', 'drama', 'celeb'];
const MIN_SCORE = 2; // ต่ำกว่านี้ = ยังไม่จัดหมวด (ห้ามเดา)

const libraryByKey = (key) => LEAD_CATEGORIES.find((l) => l.key === key) || UNKNOWN_CATEGORY;

/** รวมข้อความทุกช่องที่ใช้เทียบคำได้ (ตัดความยาวกันสตริงยักษ์) */
function leadText(lead) {
  if (!lead || typeof lead !== 'object') return '';
  const parts = [
    lead.clusterArchetype,
    lead.title,
    lead.reason,
    lead.snippet,
    lead.extract && lead.extract.insight ? lead.extract.insight.headline : '',
  ];
  return parts.filter(Boolean).map((s) => String(s)).join(' ').slice(0, 1200);
}

/**
 * categorizeLead — จัดลีดเข้า 1 ใน 6 คลัง (หรือ 'unknown')
 * @returns {{key:string, label:string, emoji:string, source:'ai'|'keyword'|'none', score:number}}
 */
export function categorizeLead(lead) {
  // ① AI เคยตัดสินไว้แล้ว — เชื่ออันนั้นก่อน (แม่นกว่าเทียบคำ และไม่ต้องจ่ายอะไรเพิ่ม)
  const insightCat = lead && lead.extract && lead.extract.insight ? String(lead.extract.insight.category || '').trim() : '';
  if (insightCat && INSIGHT_TO_LIBRARY[insightCat]) {
    const lib = libraryByKey(INSIGHT_TO_LIBRARY[insightCat]);
    return { key: lib.key, label: lib.label, emoji: lib.emoji, source: 'ai', score: 99 };
  }

  // ② เทียบคำ
  const text = leadText(lead);
  if (!text) return { ...UNKNOWN_CATEGORY, source: 'none', score: 0 };

  let bestKey = '';
  let bestScore = 0;
  for (const key of TIE_ORDER) {
    const r = RULES[key];
    if (!r) continue;
    let score = 0;
    for (const w of r.strong) if (text.includes(w)) score += 2;
    for (const w of r.weak) if (text.includes(w)) score += 1;
    if (score > bestScore) { bestScore = score; bestKey = key; } // > เท่านั้น → เสมอกันตัวแรกใน TIE_ORDER ชนะ
  }

  // ③ ไม่ถึงเกณฑ์ = ยอมรับว่ายังไม่รู้ ดีกว่าติดป้ายผิด
  if (!bestKey || bestScore < MIN_SCORE) return { ...UNKNOWN_CATEGORY, source: 'none', score: bestScore };
  const lib = libraryByKey(bestKey);
  return { key: lib.key, label: lib.label, emoji: lib.emoji, source: 'keyword', score: bestScore };
}

/**
 * freshTagOf — ป้าย "♾️ อมตะ (ทำใหม่ได้ตลอด)" vs "🔥 กระแส (ทำตอนนี้เท่านั้น)"
 * 🔴 อนุมานจาก "หมวดที่จัดได้" เท่านั้น ไม่เดาจากคำอื่น — หมวดที่ไม่ชัดคืน null (ไม่ติดป้าย)
 *   ดราม่า/กระแส = ผูกเหตุการณ์ → กระแส · ช่วยเหลือ/น้ำดี/สัมภาษณ์/ชาวบ้าน = ทำใหม่ได้ → อมตะ
 *   คนดัง/ดารา = มีทั้งสองแบบ → ไม่ติดป้าย (กันติดผิด)
 */
export function freshTagOf(lead) {
  const cat = categorizeLead(lead);
  if (cat.key === 'drama') return { key: 'trend', label: '🔥 กระแส', desc: 'ผูกเหตุการณ์ ทำตอนนี้เท่านั้น' };
  if (['help', 'namdee', 'interview', 'commoner'].includes(cat.key)) {
    return { key: 'timeless', label: '♾️ อมตะ', desc: 'ทำใหม่ได้ตลอด' };
  }
  return null;
}

/** นับจำนวนลีดต่อหมวด — ใช้โชว์ตัวเลขบนปุ่มกรอง (คืน map key → จำนวน) */
export function countByCategory(leads) {
  const out = {};
  for (const c of LEAD_CATEGORIES) out[c.key] = 0;
  for (const lead of Array.isArray(leads) ? leads : []) {
    const k = categorizeLead(lead).key;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
