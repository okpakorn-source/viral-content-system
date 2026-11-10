/**
 * =====================================================
 * Teacher Library — คลังครู 254 โพสต์จริงของเพจ (10 พ.ย. 69)
 * =====================================================
 * เจ้าของสั่ง 10 พ.ย. 69: "ระบบต้องเขียนได้ระบบเดียวกับครูไวรัล"
 *   - ต้นแบบ = โพสต์จริงของเพจ 254 โพสต์ (ยอดวิว ≥ 3 ล้าน) พร้อมเนื้อโพสต์ "ฉบับเต็ม"
 *   - ข่าว 1 ข่าว → เลือกครู 3 โพสต์ที่เข้ากับข่าว ไม่ซ้ำแนวกัน → เขียน 3 เวอร์ชัน เวอร์ชันละครู
 *
 * ไฟล์นี้ทำ 2 อย่างเท่านั้น: โหลดคลัง + เลือกครู
 *   ไม่เรียก AI · ไม่แตะฐานข้อมูล · ไม่มี import แบบ alias (รันด้วย node ตรงๆ ได้ — เทสใช้โค้ดจริง)
 * ตัวให้คะแนน "ข่าว↔ครู" ไม่ได้เขียนซ้ำที่นี่ — ผู้เรียกส่งผลคะแนนจากสมองจับคู่กลาง
 *   (src/lib/services/promptMatcher.js → scoreLibraryPrompts) เข้ามาเอง กันสูตรแตกเป็นสองชุด
 */
import fs from 'fs';
import path from 'path';

const LIBRARY_FILE = ['data', 'teacher-library.json'];

let _cache = null; // { file, teachers }

/**
 * โหลดคลังครู (อ่านไฟล์ครั้งเดียวต่อ process)
 * @param {{file?: string}} [opts] file = พาธไฟล์เต็ม (ใช้ในเทส) · ไม่ส่ง = data/teacher-library.json ของโปรเจกต์
 * @returns {Array<object>} รายการครู — โยน error ที่มี errorType ชัดเจนเมื่อไฟล์หาย/เสีย/ว่าง (ห้ามเขียนต่อแบบไม่มีครู)
 */
export function loadTeacherLibrary({ file } = {}) {
  const target = file || path.join(process.cwd(), ...LIBRARY_FILE);
  if (_cache && _cache.file === target) return _cache.teachers;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    const err = new Error(`โหลดคลังครูไม่ได้ (${path.basename(target)}): ${e.message}`);
    err.errorType = 'TEACHER_LIBRARY_UNREADABLE';
    throw err;
  }
  const teachers = (Array.isArray(parsed) ? parsed : parsed?.teachers || []).filter(isUsableTeacher);
  if (teachers.length === 0) {
    const err = new Error('คลังครูว่าง — ไม่มีโพสต์ต้นแบบให้เลียน');
    err.errorType = 'TEACHER_LIBRARY_EMPTY';
    throw err;
  }
  _cache = { file: target, teachers };
  return teachers;
}

/** ล้างแคช (ใช้ในเทสเท่านั้น) */
export function _resetTeacherLibraryCache() { _cache = null; }

function isUsableTeacher(t) {
  return !!t && typeof t.id === 'string' && typeof t.post === 'string' && t.post.trim().length >= 200;
}

/** นับคำไทยด้วยตัวตัดคำมาตรฐานของระบบ (ตัวเดียวกับที่ใช้วัดโพสต์ครู — ค่ากลางครู 183 คำ) */
export function countWordsThai(text) {
  const seg = new Intl.Segmenter('th', { granularity: 'word' });
  let n = 0;
  for (const part of seg.segment(String(text || ''))) if (part.isWordLike) n++;
  return n;
}

/**
 * จัดประเภท "วิธีเปิดเรื่อง" ของโพสต์ จากย่อหน้าแรก — ใช้กระจายครู 3 โพสต์ไม่ให้เปิดเหมือนกัน
 * ลำดับตรวจคือ ลำดับความเฉพาะ: คำพูด → ไว้อาลัย → ชื่นชม → หักมุม(แม้…แต่) → ตัวเลข → เล่าตรง
 */
export function classifyOpening(post) {
  const first = String(post || '').trim().split(/\n/)[0] || '';
  const head = first.slice(0, 60);
  if (/^\s*["“”'‘’]/.test(first)) return 'quote';
  if (/ไว้อาลัย|สดุดี|ขอแสดงความเสียใจ|ร่วมส่ง|สู่สุคติ/.test(head)) return 'tribute';
  if (/ชื่นชม|นับถือ|ยกนิ้ว|สุดยอด|กราบ|น่ารัก|ประทับใจ|ดีใจ|ขอบคุณ|น่าเห็นใจ|เห็นใจ|ปรบมือ|หัวใจ/.test(head)) return 'admire';
  if (/(แม้|ถึง)[^\n]{0,80}แต่|ไม่ใช่แค่[^\n]{0,60}แต่|ไม่ได้[^\n]{0,60}แต่/.test(first.slice(0, 200))) return 'contrast';
  if (/[0-9๐-๙]/.test(first.slice(0, 90))) return 'number';
  return 'plain';
}

/** เนื้อข่าวมีคำพูดในเครื่องหมายคำพูดให้ยกไหม (ครูที่เปิดด้วยคำพูดใช้ได้เฉพาะข่าวที่มีคำพูด — ไม่งั้นนักเขียนต้องแต่งคำพูดเอง) */
export function rawHasQuote(rawText) {
  return /["“”][^"“”\n]{8,}["“”]/.test(String(rawText || ''));
}

/**
 * คัดครูรอบแรกด้วยโค้ด → ได้ "รายชื่อผู้เข้ารอบ" ให้บรรณารักษ์ (AI) อ่านเลือกต่อ
 *   - ตัดครูที่วิธีเขียนใช้กับข่าวนี้ไม่ได้ (ครูเปิดด้วยคำพูด แต่ข่าวไม่มีคำพูด)
 *   - ตัดครูที่เพิ่งใช้ (avoidIds) — บังคับหมุนเวียน กันทั้งเพจเขียนซ้ำอยู่ไม่กี่แบบ
 *   - เรียงตามคะแนนเข้ากับข่าว เอา size ใบแรก
 * @returns {Array<object>} ครู (มี _matchScore) เรียงคะแนนมาก→น้อย
 */
export function shortlistTeachers({ teachers, scored, rawText = '', size = 60, avoidIds = [] }) {
  if (!Array.isArray(teachers) || teachers.length === 0) return [];
  const avoid = new Set((avoidIds || []).map(String));
  const quoteOk = rawHasQuote(rawText);
  const ranked = (Array.isArray(scored) ? scored : [])
    .filter((s) => s && Number.isInteger(s.index) && teachers[s.index])
    .slice()
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const usable = ranked.filter((s) => {
    const t = teachers[s.index];
    return !avoid.has(t.id) && (quoteOk || t.openingType !== 'quote');
  });
  // ตัดแล้วเหลือน้อยเกินจะเลือก (คลังเล็ก/ใช้ไปเกือบหมด) → คืนสิทธิ์ใบที่เพิ่งใช้ แต่ยังไม่คืนครูที่ใช้กับข่าวนี้ไม่ได้
  const pool = usable.length >= 3 ? usable : ranked.filter((s) => quoteOk || teachers[s.index].openingType !== 'quote');
  const final = pool.length >= 3 ? pool : ranked;
  return final.slice(0, Math.max(3, size)).map((s) => ({ ...teachers[s.index], _matchScore: s.score }));
}

/**
 * เลือกครูจาก "ลำดับที่บรรณารักษ์จัดมา" (rankedIds = id ครูเรียงเหมาะสุด→รอง)
 *   รอบแรก: เดินตามลำดับ หยิบเฉพาะใบที่วิธีเปิดเรื่องยังไม่ซ้ำ · รอบสอง: ถ้ายังไม่ครบ เติมตามลำดับเดิม
 *   id ที่ไม่มีในรายชื่อผู้เข้ารอบถูกข้าม (กัน AI ตอบ id มั่ว)
 * @returns {Array<object>} ครูที่เลือก (ไม่เกิน count)
 */
export function chooseRankedTeachers({ shortlist, rankedIds, count = 3 }) {
  const byId = new Map((shortlist || []).map((t) => [t.id, t]));
  const ordered = [];
  for (const id of rankedIds || []) {
    const t = byId.get(String(id));
    if (t && !ordered.includes(t)) ordered.push(t);
  }
  const picked = [];
  const openings = new Set();
  for (const t of ordered) {
    if (picked.length >= count) break;
    if (!openings.has(t.openingType)) { picked.push(t); openings.add(t.openingType); }
  }
  for (const t of ordered) {
    if (picked.length >= count) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked;
}

/**
 * เลือกครูสำหรับข่าว 1 ข่าว แบบโค้ดล้วน — ใช้เป็น "ทางสำรอง" เมื่อบรรณารักษ์ (AI) ล้ม/ตอบไม่ครบ
 *
 * หลักเหตุผล (เรียงตามลำดับที่โค้ดทำ):
 *   1. เอาเฉพาะครูที่ "เข้ากับข่าว" — คะแนนห่างจากอันดับ 1 ไม่เกิน scoreWindow (ไม่งั้นได้ครูผิดแนวเรื่อง)
 *   2. เลี่ยงครูที่เพิ่งถูกใช้ (avoidIds) ถ้ายังเหลือครูให้เลือกครบ — กันทั้งเพจเขียนซ้ำอยู่ไม่กี่แบบ
 *   3. หยิบทีละโพสต์ โดยให้สิทธิ์ครูที่ "วิธีเปิดเรื่อง" ยังไม่ซ้ำกับที่หยิบไปแล้วก่อน — 3 เวอร์ชันต้องอ่านแล้วต่างกัน
 *   4. ในกลุ่มที่เหลือ สุ่มถ่วงน้ำหนักด้วย คะแนนเข้ากับข่าว × รากที่สองของยอดวิว — โพสต์ที่ปังกว่ามีสิทธิ์มากกว่า แต่ทุกโพสต์ยังมีสิทธิ์
 *
 * @param {object} p
 * @param {Array<object>} p.teachers  คลังครู (จาก loadTeacherLibrary)
 * @param {Array<{index:number, score:number}>} p.scored  คะแนนต่อครู (index ชี้เข้า teachers) จากสมองจับคู่กลาง
 * @param {number} [p.count=3]
 * @param {() => number} [p.rand=Math.random]  ตัวสุ่ม 0..1 (เทสส่งตัวคุมผลได้)
 * @param {Array<string>} [p.avoidIds=[]]  id ครูที่เพิ่งใช้
 * @param {number} [p.scoreWindow=15]
 * @param {number} [p.minPool=9]  ถ้ากลุ่มเข้าเกณฑ์น้อยกว่านี้ ขยายลงมาตามอันดับคะแนนจนครบ
 * @returns {Array<object>} ครูที่เลือก (ไม่เกิน count) แต่ละตัวมี _matchScore แนบมา
 */
export function pickTeachers({ teachers, scored, count = 3, rand = Math.random, avoidIds = [], scoreWindow = 15, minPool = 9 }) {
  if (!Array.isArray(teachers) || teachers.length === 0) return [];
  const ranked = (Array.isArray(scored) ? scored : [])
    .filter((s) => s && Number.isInteger(s.index) && teachers[s.index])
    .slice()
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  if (ranked.length === 0) return [];

  const top = ranked[0].score;
  let pool = ranked.filter((s) => s.score >= top - scoreWindow);
  if (pool.length < minPool) pool = ranked.slice(0, Math.min(minPool, ranked.length));

  const avoid = new Set((avoidIds || []).map(String));
  const fresh = pool.filter((s) => !avoid.has(teachers[s.index].id));
  let candidates = fresh.length >= count ? fresh : pool;

  const floor = Math.min(...candidates.map((s) => s.score));
  const weightOf = (s) => {
    const t = teachers[s.index];
    const views = Math.max(1, Number(t.views) || 0);
    return Math.max(1, s.score - floor + 1) * Math.sqrt(views / 1e6 + 1);
  };

  const picked = [];
  const usedOpenings = new Set();
  while (picked.length < count && candidates.length > 0) {
    const unseen = candidates.filter((s) => !usedOpenings.has(teachers[s.index].openingType));
    const from = unseen.length > 0 ? unseen : candidates;
    const total = from.reduce((sum, s) => sum + weightOf(s), 0);
    let r = Math.min(Math.max(rand(), 0), 0.999999) * total;
    let chosen = from[from.length - 1];
    for (const s of from) { r -= weightOf(s); if (r < 0) { chosen = s; break; } }
    const teacher = teachers[chosen.index];
    picked.push({ ...teacher, _matchScore: chosen.score });
    usedOpenings.add(teacher.openingType);
    candidates = candidates.filter((s) => s !== chosen);
  }
  return picked;
}
