/**
 * L4.5 — ล้างชื่อสถานที่หลอน (place scrub) ฉบับ "ขอบคำ + ฐานความจริงเนื้อดิบ"
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S3 · เจ้าของอนุมัติ) — PL-01
 *
 * ปัญหาเดิม (บล็อก L4.5 ใน correctionPipeline.js · พิสูจน์จากซอร์สจริง + กล่องดำ 20 ส.ค. 69 trace unify_1787220733097):
 *   (1) regex `(จังหวัด|…|ถนน|วัด|…)\s*([ก-๙a-zA-Z]+)` กิน "ชื่อ" แบบโลภไปจนถึงช่องว่าง/เลข — ภาษาไทยไม่เว้นวรรคระหว่างคำ
 *       จึงได้ทั้งวลี "จังหวัดขอนแก่นมีเพื่อนบ้านกว่า" · "ถนนเส้นเดียวที่น้ำยังไม่ท่วม" · "วัดความดันที่โรงพยาบาลทุกเดือน" · "วัดเหล่านั้นไม่ใช่การลงโทษ"
 *       แล้วเช็คว่า "ทั้งก้อน" อยู่ในต้นฉบับไหม (ไม่อยู่แน่ เพราะเป็นวลีที่นักเขียนเรียบเรียง) → split/join ทิ้งทั้งก้อน
 *       = เนื้อจริงหาย ("ที่ในพื้นที่ 20 คน") · ใจความปฏิเสธหาย ("ในวัด แต่เป็น…") · บุพบทซ้อน ("บนบนถนน")
 *   (2) ฐานความจริง = newsData.newsBody (เนื้อที่ AI สกัด) ทั้งที่ท่อรับ rawSourceText มาแล้ว → ชื่อที่มีในเนื้อดิบแต่ตัวสกัดตัดทิ้ง ("ตำบลบ้านเป็ด") ก็โดนล้าง
 *   (3) "วัด" ความหมายกริยา (วัดความดัน/วัดไข้/วัดผล) และ "ไข้หวัด" ถูกนับเป็นสถานที่ชนิด "วัด"
 *
 * วิธีใหม่ (ค่าเริ่มต้น · สวิตช์ถอย L45_LEGACY=1 = บล็อกเดิมใน correctionPipeline.js ทุกไบต์):
 *   (ก) ฐานความจริง = rawSourceText (เนื้อดิบ) ถ้ามี · ไม่มีจึงถอยไป newsBody (สาย URL ไม่ส่ง raw) · + researchFacts (ข้อเท็จจริงรีเสิร์ชที่ยืนยันแล้ว)
 *       เป็นฐานเสริม — แบบเดียวกับด่าน L1.8 (14 ส.ค. 69 "ของจริงจากรีเสิร์ชไม่ใช่ของเกิน") · ไม่มีฐานเลย = ไม่แตะ (กติกาเดิม)
 *   (ข) ตัดคำด้วย Intl.Segmenter('th', word): คำนำหน้าต้องอยู่บนขอบคำ (ไข้|หวัด ไม่มี "วัด" บนขอบ · "วัดผล" เป็นโทเค็นเดียว = ไม่ใช่สถานที่ ·
 *       "จังหวัด" ไม่ถูกมองเป็น "วัด") · "ชื่อ" = โทเค็นถัดจากคำนำหน้าจนถึงขอบเขตวลี (ช่องว่าง/เลขอารบิก/เครื่องหมาย — ชุดอักขระเดิม)
 *       แล้วตัดที่ "คำหยุด" ตัวแรก (คำเชื่อม/บุพบท/คำชี้/กริยา/ลักษณนาม/คำขยาย/กรรมของกริยา "วัด" — STOP_WORDS)
 *       ชื่อมีจริง = ส่วนนำหน้าใดๆ ของชื่อ (โทเค็น 1..k) อยู่ในฐานความจริง (ตัดช่องว่างทั้งสองฝั่ง) → คงไว้
 *   (ค) ไม่มั่นใจ = ไม่แตะ: หัวชื่อเป็นคำหยุด (วัดความดัน · ถนนเส้นเดียว · วัดเหล่านั้น · วัดด้วยกัน · โรงพยาบาลใกล้บ้าน) ·
 *       ชื่อโทเค็นเดียวที่ "ติด" คำต่อเนื่องโดยไม่มีช่องว่าง (ถนนลื่นจน… · วัดร้างที่… · จังหวัดสมมุติใน…) แยกไม่ออกว่าชื่อหรือคำขยาย/กริยา
 *       (ยกเว้นตัวย่อ จ./อ./ต./ซ./ถ. ที่ตามด้วยคำเดียว = ชื่อเกือบแน่) · ชื่อยาวเกิน 3 โทเค็น หรือ 15 ตัวอักษร · สั้นกว่า 4 ตัวอักษร (กติกาเดิม) ·
 *       รันไทม์ไม่มี Intl.Segmenter · ไม่มีฐานความจริง
 *   ล้างจริงเมื่อ: ชื่อสะอาด 1–3 โทเค็น 4–15 ตัวอักษร และไม่มีส่วนนำหน้าใดอยู่ในฐานความจริง → แทน "คำนำหน้า+ชื่อ" ตรงตำแหน่งนั้น
 *       (ไม่ split/join ทั้งเนื้อ) ด้วยคำแทนตามชนิดสถานที่ (ตารางเดิม TYPE_REPLACEMENT) · ไม่ซ้อนบุพบท ("บน"+"บนถนน" → "บนถนน" · "ใน"+"ในซอย" → "ในซอย")
 *   ทิศทางเมื่อพลาด: "ไม่ลบ" — ด่านนี้ล้างเฉพาะชื่อเฉพาะโดดๆ ที่ไม่มีร่องรอยในเนื้อดิบเลย ที่เหลือปล่อยให้ Sol fact gate/คนตรวจ
 *
 * ไฟล์นี้ไม่มี import (pure) — ข้อสอบโหลดตรงและกลายพันธุ์ผ่าน tests/helpers/temp-module.mjs ได้
 */

const LEGACY_VALUES = new Set(['1', 'true', 'on', 'yes', 'legacy']);

/** สวิตช์ถอย L45_LEGACY — อ่านตอนเรียกทุกครั้ง (ไม่แคช) · ไม่ตั้ง/0/off/false = ฉบับใหม่ (ค่าเริ่มต้น) */
export function isL45Legacy() {
  const raw = process.env.L45_LEGACY;
  if (raw == null) return false;
  return LEGACY_VALUES.has(String(raw).trim().replace(/^["']|["']$/g, '').toLowerCase());
}

// คำนำหน้าชนิดสถานที่ — ชุดและลำดับเดียวกับ regex เดิมใน correctionPipeline.js
export const PLACE_PREFIXES = Object.freeze([
  'จ.', 'อ.', 'ต.', 'ซ.', 'ถ.', 'จังหวัด', 'อำเภอ', 'ตำบล', 'ซอย', 'ถนน',
  'โรงพยาบาล', 'สถานี', 'วัด', 'โรงเรียน', 'มหาวิทยาลัย', 'สนามบิน',
]);
// ตัวย่อ: Intl.Segmenter รวม "จ.ขอนแก่น" เป็นโทเค็นเดียว → เช็คขอบคำได้แค่จุดเริ่ม (ปลายคำย่อไม่ใช่ขอบคำ)
const ABBREVIATIONS = new Set(['จ.', 'อ.', 'ต.', 'ซ.', 'ถ.']);
const PREFIX_RE_SOURCE = `(${PLACE_PREFIXES.map((p) => p.replace('.', '\\.')).join('|')})`;

// คำแทนตามชนิดสถานที่ — ตารางเดิมทุกค่า (12 มิ.ย. 69 "แทนแบบรักษาชนิดสถานที่")
export const TYPE_REPLACEMENT = Object.freeze({
  'จ.': 'ในพื้นที่', 'จังหวัด': 'ในพื้นที่', 'อ.': 'ในพื้นที่', 'อำเภอ': 'ในพื้นที่',
  'ต.': 'ในพื้นที่', 'ตำบล': 'ในพื้นที่', 'ซ.': 'ในซอย', 'ซอย': 'ในซอย', 'ถ.': 'บนถนน', 'ถนน': 'บนถนน',
  'โรงพยาบาล': 'โรงพยาบาล', 'สถานี': 'สถานี', 'วัด': 'วัด', 'โรงเรียน': 'โรงเรียน',
  'มหาวิทยาลัย': 'มหาวิทยาลัย', 'สนามบิน': 'สนามบิน',
});

export const NAME_MIN_CHARS = 4;   // กติกาเดิม: ชื่อสั้นกว่านี้เสี่ยงจับคำทั่วไป → ไม่แตะ
export const NAME_MAX_CHARS = 15;  // ยาวกว่านี้มักเป็นวลี ไม่ใช่ชื่อเฉพาะโดดๆ → ไม่มั่นใจ → ไม่แตะ
export const NAME_MAX_TOKENS = 3;  // ชื่อเฉพาะไทยส่วนใหญ่ 1–3 โทเค็น (ขอนแก่น · บ้านเป็ด · ตำรวจภูธรเมือง)

/**
 * คำหยุด — โทเค็นที่ "ไม่ใช่หัวชื่อสถานที่": เจอเป็นโทเค็นแรกหลังคำนำหน้า = ไม่ใช่ชื่อ (ไม่แตะ) · เจอกลางทาง = ชื่อจบก่อนหน้านั้น
 * ตั้งใจไม่ใส่คำที่ขึ้นต้นชื่อสถานที่ไทยบ่อย (บ้าน หนอง โนน ดอน บาง ท่า ปาก หัว เขา คลอง ห้วย เมือง พระ ศรี ราช) —
 * คำที่ใส่แล้วไปโดนชื่อจริง (วัดกลาง/วัดใหม่/ถนนสายไหม/ต.ในเมือง) แค่ทำให้ "ไม่แตะ" ซึ่งเป็นทิศที่ปลอดภัย
 */
export const STOP_WORDS = new Set([
  // คำเชื่อม / บุพบท
  'ที่', 'ซึ่ง', 'อัน', 'และ', 'กับ', 'แก่', 'แด่', 'ต่อ', 'ต่อไป', 'ถัดไป', 'ของ', 'ใน', 'บน', 'ใต้', 'ล่าง', 'เหนือ', 'นอก', 'ข้าง',
  'ใกล้', 'ไกล', 'ริม', 'รอบ', 'ระหว่าง', 'ตาม', 'จาก', 'ถึง', 'สู่', 'แต่', 'หรือ', 'เพราะ', 'เพื่อ', 'เมื่อ', 'ตอน', 'ขณะ',
  'หลัง', 'ก่อน', 'หน้า', 'โดย', 'ด้วย', 'กว่า', 'จน', 'จนถึง', 'กระทั่ง', 'ทั้ง', 'แม้', 'หาก', 'ถ้า', 'เว้น', 'ยกเว้น',
  'เฉพาะ', 'แค่', 'เพียง', 'เท่า', 'เท่านั้น', 'ราว', 'ราวๆ', 'ประมาณ', 'เกือบ', 'ไม่ใช่',
  // คำชี้ / สรรพนาม / ปริมาณ
  'นี้', 'นั้น', 'โน้น', 'นี่', 'นั่น', 'โน่น', 'เหล่า', 'เหล่านี้', 'เหล่านั้น', 'ดังกล่าว', 'ต่างๆ', 'ทุก', 'แต่ละ', 'บาง', 'หลาย',
  'มาก', 'น้อย', 'ใด', 'ไหน', 'อะไร', 'ใคร', 'เขา', 'เธอ', 'ผม', 'ฉัน', 'เรา', 'มัน', 'ตัวเอง', 'ตนเอง', 'กัน', 'เอง', 'หนึ่ง',
  // กริยา / กริยาช่วย / คำปฏิเสธ
  'มี', 'เป็น', 'อยู่', 'คือ', 'ได้', 'ให้', 'ถูก', 'โดน', 'ไป', 'มา', 'จะ', 'ก็', 'ยัง', 'เคย', 'กำลัง', 'ต้อง', 'ควร', 'อาจ',
  'น่า', 'คง', 'ย่อม', 'เพิ่ง', 'เริ่ม', 'เลิก', 'หยุด', 'เกิด', 'เจอ', 'พบ', 'เห็น', 'ดู', 'บอก', 'พูด', 'เล่า', 'ว่า', 'ทำ',
  'ใช้', 'ช่วย', 'เข้า', 'ออก', 'ขึ้น', 'ลง', 'กลับ', 'ส่ง', 'รับ', 'นำ', 'พา', 'ตก', 'ท่วม', 'ประกาศ', 'เผย', 'แจ้ง', 'จับ',
  'ตรวจ', 'รักษา', 'ผ่าตัด', 'นอน', 'พัก', 'อาศัย', 'ตั้ง', 'เปิด', 'ปิด', 'สร้าง', 'ซ่อม', 'เดิน', 'วิ่ง', 'ขับ', 'จอด', 'ชน',
  'ล้ม', 'ไหม้', 'ระเบิด', 'รอ', 'หา', 'ซื้อ', 'ขาย', 'จ่าย', 'รู้', 'คิด', 'เชื่อ', 'กลัว', 'รัก', 'ชอบ', 'อยาก', 'ไม่', 'มิ', 'ห้าม',
  // ลักษณนาม / หน่วย / บริเวณ
  'เส้น', 'สาย', 'แห่ง', 'คัน', 'ตัว', 'คน', 'ใบ', 'ลูก', 'แถว', 'ช่วง', 'จุด', 'ด้าน', 'ฝั่ง', 'แถบ', 'ย่าน', 'บริเวณ', 'เขต',
  'พื้นที่', 'ละแวก', 'โซน', 'แปลง', 'ห้อง', 'ชั้น', 'หน่วย', 'แผนก', 'ฝ่าย', 'กม', 'กิโล', 'เมตร', 'สนาม',
  // คำขยาย / สภาพ (ถนนลื่น · ถนนตัน · ซอยเปลี่ยว · วัดร้าง · โรงเรียนเก่า)
  'ใหญ่', 'เล็ก', 'เก่า', 'ใหม่', 'ดัง', 'ชื่อ', 'ชื่อดัง', 'เดียว', 'เดียวกัน', 'เดิม', 'หลัก', 'รอง', 'สำคัญ', 'ประจำ', 'เอกชน',
  'รัฐ', 'รัฐบาล', 'ท้องถิ่น', 'ชุมชน', 'สาธารณะ', 'ส่วนตัว', 'กลาง', 'ทั่วไป', 'พิเศษ', 'เงียบ', 'เงียบๆ', 'ร้าง', 'เก่าแก่', 'สวย', 'สวยงาม',
  'ดี', 'แย่', 'ร้าย', 'นานาชาติ', 'แห่งชาติ', 'ภูมิภาค', 'เทศบาล', 'อนุบาล', 'ประถม', 'มัธยม', 'ปลายทาง', 'ต้นทาง', 'สุดท้าย', 'แรก',
  'ลื่น', 'ตัน', 'เปลี่ยว', 'มืด', 'แคบ', 'กว้าง', 'ขรุขระ', 'พัง', 'ทรุด', 'ขาด', 'ว่าง', 'โล่ง', 'แน่น', 'รก', 'เรียบ', 'ลาด', 'ชัน', 'คด',
  'ตรง', 'ยาว', 'สั้น', 'สูง', 'ต่ำ', 'หลวง', 'ลูกรัง', 'ดิน', 'คอนกรีต', 'ลาดยาง', 'ไทย', 'น้ำ', 'ฝน', 'ไฟ', 'รถ', 'ทาง', 'ท้าย', 'เลียบ',
  'ตัด', 'เชื่อม', 'ผ่าน', 'มุ่ง', 'ร้อน', 'เย็น', 'เปียก', 'แห้ง',
  // กรรมของกริยา "วัด" (วัดความดัน/วัดไข้/วัดอุณหภูมิ/วัดใจ/วัดดวง)
  'ความ', 'อุณหภูมิ', 'ไข้', 'ผล', 'ค่า', 'ระดับ', 'ขนาด', 'ระยะ', 'แสง', 'ดวง', 'ใจ', 'ฝีมือ', 'พลัง', 'น้ำหนัก', 'ส่วนสูง',
  'สายตา', 'ชีพจร', 'ออกซิเจน', 'น้ำตาล',
]);

const NAME_CHAR_RE = /[ก-๙a-zA-Z]/; // ชุดอักขระเดียวกับ regex เดิม → ขอบเขตวลี = ช่องว่าง/เลขอารบิก/เครื่องหมาย
const HSPACE_RE = /[ \t]/;          // regex เดิมยอมช่องว่างระหว่างคำนำหน้ากับชื่อ (\s*) — คงไว้เฉพาะแนวนอน

let _thaiSegmenter; // undefined = ยังไม่ลอง · null = รันไทม์ไม่มี Intl.Segmenter (Node ≥16 / Vercel มีครบ)
function getThaiSegmenter() {
  if (_thaiSegmenter !== undefined) return _thaiSegmenter;
  try {
    _thaiSegmenter = new Intl.Segmenter('th', { granularity: 'word' });
  } catch {
    _thaiSegmenter = null;
  }
  return _thaiSegmenter;
}

const stripSpaces = (s) => String(s).replace(/\s+/g, '');

function researchFactsToText(researchFacts) {
  if (researchFacts == null) return '';
  if (Array.isArray(researchFacts)) {
    return researchFacts.map((x) => (typeof x === 'string' ? x : (x?.text || x?.content || ''))).filter(Boolean).join('\n');
  }
  return String(researchFacts);
}

/**
 * ฐานความจริงของด่าน: raw ก่อน → newsBody → (+researchFacts เสริม)
 * @returns {{ authority: 'raw'|'newsBody'|'none', sources: string[], researchFactsLen: number }}
 */
export function buildPlaceAuthority({ rawSourceText, newsBody, researchFacts } = {}) {
  const raw = typeof rawSourceText === 'string' ? rawSourceText.trim() : '';
  const body = typeof newsBody === 'string' ? newsBody.trim() : '';
  const sources = [];
  let authority = 'none';
  if (raw) { sources.push(stripSpaces(raw)); authority = 'raw'; }
  else if (body) { sources.push(stripSpaces(body)); authority = 'newsBody'; }
  const research = researchFactsToText(researchFacts).trim();
  if (research && authority !== 'none') sources.push(stripSpaces(research));
  return { authority, sources, researchFactsLen: research.length };
}

// ชื่อมีจริง = ส่วนนำหน้าใดๆ ของชื่อ (โทเค็น 1..k, ≥2 ตัวอักษร) อยู่ในฐานความจริง — เอนไปทาง "คง" (บ้านเป็ด ที่ raw มีแค่ "บ้านเป็ด" ก็คง)
function isGrounded(text, nameTokens, sources) {
  for (let k = nameTokens.length; k >= 1; k -= 1) {
    const cand = stripSpaces(text.slice(nameTokens[0].start, nameTokens[k - 1].end));
    if (cand.length >= 2 && sources.some((s) => s.includes(cand))) return true;
  }
  return false;
}

/**
 * ล้างชื่อสถานที่หลอนแบบขอบคำ
 * @param {string} content  เนื้อที่จะล้าง (ผล L3/L4 ในท่อ)
 * @param {{ rawSourceText?: string|null, newsBody?: string|null, researchFacts?: string|string[]|null }} [sources]
 * @param {{ segmenter?: Intl.Segmenter|null, log?: (msg: string) => void }} [opts]
 *   segmenter: null = จำลองรันไทม์ที่ไม่มี Intl.Segmenter (ใช้ในเทส) → ไม่แตะทั้งเนื้อ
 * @returns {{ content: string, authority: string, segmenter: boolean, candidates: number, grounded: number,
 *   scrubbed: Array<{ place: string, replacement: string, index: number }>, skipped: Array<{ place: string, reason: string }> }}
 */
export function scrubHallucinatedPlaces(content, sources = {}, opts = {}) {
  const text = String(content ?? '');
  const log = typeof opts.log === 'function' ? opts.log : (msg) => console.log(msg);
  const result = { content: text, authority: 'none', segmenter: true, candidates: 0, grounded: 0, scrubbed: [], skipped: [] };

  const auth = buildPlaceAuthority(sources);
  result.authority = auth.authority;
  if (auth.authority === 'none' || !text) return result; // ไม่มีฐานความจริง = ไม่แตะ (กติกาเดิม: ไม่มี newsBody = ข้ามด่าน)

  const segmenter = Object.prototype.hasOwnProperty.call(opts, 'segmenter') ? opts.segmenter : getThaiSegmenter();
  if (!segmenter) {
    result.segmenter = false;
    result.skipped.push({ place: '*', reason: 'no-segmenter' }); // ไม่มีเครื่องตัดคำ = ตัดชื่อไม่ได้ → ไม่แตะ (ทิศไม่ลบ)
    return result;
  }

  const boundaries = new Set([0, text.length]);
  for (const seg of segmenter.segment(text)) boundaries.add(seg.index);
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

  const edits = [];
  const re = new RegExp(PREFIX_RE_SOURCE, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const prefix = m[1];
    const pStart = m.index;
    const pEnd = pStart + prefix.length;
    result.candidates += 1;

    // (ข) คำนำหน้าต้องอยู่บนขอบคำ — คำเต็มต้องจบบนขอบคำด้วย (วัดผล = โทเค็นเดียว · ไข้|หวัด/จังหวัด ไม่มี "วัด" ที่เริ่มบนขอบ)
    //     ตัวย่อที่ Segmenter รวมกับบุพบทหน้ามันเป็นโทเค็นเดียว ("ในซ.สมมุติ" · "บนถ.สมมุติ") ยอมเมื่อส่วนหน้าในโทเค็นนั้นเป็นคำหยุด
    if (!boundaries.has(pStart)) {
      if (!ABBREVIATIONS.has(prefix)) continue;
      let tokenStart = pStart;
      while (tokenStart > 0 && !boundaries.has(tokenStart)) tokenStart -= 1;
      if (!STOP_WORDS.has(text.slice(tokenStart, pStart))) continue;
    }
    if (!ABBREVIATIONS.has(prefix) && !boundaries.has(pEnd)) continue;

    // ชื่อ = อักขระไทย/ละตินต่อเนื่องหลังคำนำหน้า (ข้ามช่องว่างแนวนอนได้เหมือน regex เดิม) จนถึงขอบเขตวลี
    let nStart = pEnd;
    while (nStart < text.length && HSPACE_RE.test(text[nStart])) nStart += 1;
    let runEnd = nStart;
    while (runEnd < text.length && NAME_CHAR_RE.test(text[runEnd])) runEnd += 1;
    if (runEnd === nStart) continue; // ไม่มีชื่อตามหลัง ("ไปวัด แต่…" / "ในวัด")

    // แยกโทเค็นในช่วงชื่อด้วยขอบคำของ Segmenter (โทเค็นแรกอาจเป็นส่วนท้ายของโทเค็นตัวย่อ เช่น "จ.ขอนแก่น" → "ขอนแก่น")
    const tokens = [];
    let cur = nStart;
    for (const b of sortedBoundaries) {
      if (b <= nStart) continue;
      if (b >= runEnd) break;
      tokens.push({ text: text.slice(cur, b), start: cur, end: b });
      cur = b;
    }
    tokens.push({ text: text.slice(cur, runEnd), start: cur, end: runEnd });

    // (ค) หัวชื่อเป็นคำหยุด = ไม่ใช่ชื่อสถานที่ (วัดความดัน · ถนนเส้นเดียว · วัดเหล่านั้น · วัดด้วยกัน) → ไม่แตะ
    const stopAt = tokens.findIndex((t) => STOP_WORDS.has(t.text));
    if (stopAt === 0) {
      result.skipped.push({ place: text.slice(pStart, runEnd), reason: `stop-head:${tokens[0].text}` });
      continue;
    }
    const nameTokens = stopAt > 0 ? tokens.slice(0, stopAt) : tokens;
    const nameEnd = nameTokens[nameTokens.length - 1].end;
    const name = text.slice(nStart, nameEnd);
    const place = text.slice(pStart, nameEnd);

    // (ก) ชื่อมีจริงในฐานความจริง → คงไว้
    if (isGrounded(text, nameTokens, auth.sources)) {
      result.grounded += 1;
      re.lastIndex = nameEnd;
      continue;
    }

    // ไม่มั่นใจ = ไม่แตะ
    if (stopAt > 0 && nameTokens.length === 1 && !ABBREVIATIONS.has(prefix)) {
      // ชื่อโทเค็นเดียวติดคำต่อเนื่องโดยไม่มีช่องว่าง (ถนนลื่นจน… · วัดร้างที่… · จังหวัดสมมุติใน…) — แยกไม่ออกว่าชื่อหรือคำขยาย/กริยา
      // ชื่อจริงที่ติดคำต่อเนื่องส่วนใหญ่ถูกจับได้ก่อนแล้วว่ามีในฐาน · ตัวย่อ (จ.สมมุติใน…) ยังล้างเพราะตัวย่อ+คำเดียว = ชื่อเกือบแน่
      result.skipped.push({ place, reason: 'uncertain-glued' });
    } else if (name.length < NAME_MIN_CHARS) {
      result.skipped.push({ place, reason: 'too-short' });
    } else if (nameTokens.length > NAME_MAX_TOKENS || name.length > NAME_MAX_CHARS) {
      result.skipped.push({ place, reason: 'too-long' });
    } else {
      edits.push({ start: pStart, end: nameEnd, place, prefix });
    }
    re.lastIndex = nameEnd;
  }

  // แทนตรงตำแหน่ง (จากท้ายมาหน้า ตำแหน่งไม่เลื่อน) — ไม่ split/join ทั้งเนื้อ
  let out = text;
  for (const e of [...edits].reverse()) {
    let replacement = TYPE_REPLACEMENT[e.prefix] || 'ในพื้นที่';
    const before = out.slice(0, e.start);
    const beforeTrimmed = before.replace(/[ \t]+$/, '');
    for (const prep of ['ใน', 'บน']) {
      if (replacement.startsWith(prep) && beforeTrimmed.endsWith(prep)) replacement = replacement.slice(prep.length); // กันบุพบทซ้อน (บนบนถนน / ในในซอย / "ใน ในพื้นที่")
    }
    out = before + replacement + out.slice(e.end);
    log(`  L4.5 Hallucination Scrub: "${e.place}" -> "${replacement}" (รักษาชนิดสถานที่ · ฐาน=${auth.authority})`);
    result.scrubbed.unshift({ place: e.place, replacement, index: e.start });
  }
  result.content = out;
  return result;
}
