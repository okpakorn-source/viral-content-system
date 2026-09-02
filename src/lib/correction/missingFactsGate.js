/**
 * L4.7 — ด่านข้อเท็จจริงหาย (เตือนเท่านั้น ห้ามแก้เนื้อ) — ไฟล์นี้ไม่มี import เพื่อให้เทสดึงใช้ตรงได้
 *
 * ★ 2 ก.ย. 69 — ที่มา: เทสสนามจริงเคสศรราม (C:\tmp\news-r233-run) V2 รอบ 1 ทำ "ห่วงเรื่องการขับรถ" หายทั้งที่อยู่ในต้นฉบับ
 *   ด่านเดิม (factPreservationCheck) เทียบ "ร่างนักเขียน ↔ ผลแก้" จึงมองไม่เห็นของที่นักเขียนทิ้งตั้งแต่ร่างแรก
 *   ด่านนี้เทียบ "ต้นฉบับดิบ ↔ ผลสุดท้าย" แล้วรายงานสิ่งที่หาย 5 ชนิด:
 *     number = ตัวเลขพร้อมหน่วย (209,678 บาท · 16 บาท · 8 เดือน · 19.00 น.)
 *     date   = วันที่ไทย/ปี (10 ส.ค. 2569 · 10 สิงหาคม · ปี 2569 · 10/8/2569)
 *     quote  = ข้อความในเครื่องหมายคำพูด “…” "…" ‘…’ ที่ยาว ≥ 4 คำ
 *     name   = คำหลังคำนำหน้า (นาย/นาง/น.ส./น้อง/พี่/คุณ/ลุง/ป้า/ยาย/ตา/หลวงปู่/หลวงพ่อ/พระ/ครู/หมอ) + ชื่อในเครื่องหมายคำพูดสั้นๆ
 *     detail = ประเด็นย่อยรูป "กริยา+เรื่อง+หัวข้อ" (ห่วงเรื่องการขับรถ · สอนเรื่องสัมมาคารวะ) — ชนิดที่จับเคสศรรามได้จริง
 *
 * กติกา: เตือนอย่างเดียว (version._missingFacts) · ไม่แตะ content · ผู้เรียก (correctionPipeline) ครอบ try = fail-open
 *   ⚠️ diagnostics เท่านั้น (ผู้ตรวจไขว้ 2 ก.ย. 69): ผลไม่เข้า pipelineQualityWarnings/UI — พนักงานยังไม่เห็น
 *   ดูได้จาก version._missingFacts / _correctionDebug.missingFacts / กล่องดำ / console.warn · จะให้พนักงานเห็นจริงต้องแยกเป็นงานใหม่ (เปลี่ยนสิ่งที่ UI แสดง — รอเจ้าของเคาะ)
 * สวิตช์: MISSING_FACTS_GATE=0 ปิด (ค่าเริ่มต้นเปิด · รับเฉพาะ '0' ตรงตัว) — อ่านที่ correctionPipeline.runMissingFactsGate
 *
 * วิธีเทียบ (normalizeFactText): ตัดช่องว่าง/เครื่องหมายคำพูด/ตัวคั่นหลักพัน · เลขไทย→อารบิก · ตัวพิมพ์เล็ก
 *   number = พบถ้าเลขเดียวกันโผล่ (ไม่ติดเลขอื่น) · date = วัน+เดือนตรง (ปีตรงถ้ามีทั้งคู่ · ค.ศ.↔พ.ศ. แปลงให้)
 *   quote  = พบถ้ามีอักษรต่อเนื่อง ≥ 60% ของคำพูดโผล่ · name = โผล่ตรงตัว · detail = หัวข้อโผล่ (ตัด การ/ความ นำหน้าได้)
 */

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

const MONTHS = [
  ['ม.ค.', 1], ['มกราคม', 1], ['ก.พ.', 2], ['กุมภาพันธ์', 2], ['มี.ค.', 3], ['มีนาคม', 3],
  ['เม.ย.', 4], ['เมษายน', 4], ['พ.ค.', 5], ['พฤษภาคม', 5], ['มิ.ย.', 6], ['มิถุนายน', 6],
  ['ก.ค.', 7], ['กรกฎาคม', 7], ['ส.ค.', 8], ['สิงหาคม', 8], ['ก.ย.', 9], ['กันยายน', 9],
  ['ต.ค.', 10], ['ตุลาคม', 10], ['พ.ย.', 11], ['พฤศจิกายน', 11], ['ธ.ค.', 12], ['ธันวาคม', 12],
];
const MONTH_INDEX = new Map(MONTHS);
const MONTH_SRC = MONTHS.map(([m]) => m.replace(/\./g, '\\.')).sort((a, b) => b.length - a.length).join('|');

// หน่วยที่ตามหลังตัวเลข (ยาวก่อนสั้น กันจับครึ่งคำ) — ใช้ทั้งแสดงผลและกัน "2500 บาท" ไม่ให้ถูกอ่านเป็นปี
const UNITS = [
  'ล้านบาท', 'แสนบาท', 'หมื่นบาท', 'พันบาท', 'บาท', 'ล้าน', 'แสน', 'หมื่น', 'พัน', 'ร้อย',
  'เปอร์เซ็นต์', '%', 'กิโลกรัม', 'กก.', 'กรัม', 'กิโลเมตร', 'กม.', 'เซนติเมตร', 'ซม.', 'เมตร', 'ตารางวา', 'ตร.ม.', 'ไร่', 'ลิตร',
  'ชั่วโมง', 'ชม.', 'นาที', 'วินาที', 'สัปดาห์', 'เดือน', 'ปีการศึกษา', 'ปี', 'วัน', 'ขวบ', 'น.',
  'คน', 'ราย', 'ศพ', 'คัน', 'ตัว', 'ครั้ง', 'รอบ', 'ใบ', 'เม็ด', 'ชิ้น', 'หลัง', 'ห้อง', 'แห่ง', 'จุด', 'ข้อ', 'ชั้น', 'คะแนน', 'เท่า',
  'ดอลลาร์', 'เหรียญ', 'ยูโร', 'หยวน', 'เยน', 'องศา', 'เครื่อง', 'ลำ', 'คู่', 'ชุด', 'กล่อง', 'ถุง', 'ขวด', 'แก้ว', 'จาน', 'ต้น', 'ดอก', 'ฟอง', 'ก้อน', 'แผ่น', 'เล่ม', 'ฉบับ', 'หน้า', 'ตอน',
];
const UNIT_SRC = UNITS.map((u) => u.replace(/[.%]/g, (c) => `\\${c}`)).sort((a, b) => b.length - a.length).join('|');

// คำนำหน้าชื่อ (ยาวก่อนสั้น) + คำที่ตามหลังแล้ว "ไม่ใช่ชื่อคน" — ไทยไม่เว้นวรรค จึงต้องกันคำสามัญที่ขึ้นต้นเหมือนกัน
const NAME_PREFIXES = ['หลวงปู่', 'หลวงพ่อ', 'นางสาว', 'น.ส.', 'นาย', 'นาง', 'น้อง', 'พี่', 'คุณ', 'ลุง', 'ป้า', 'ยาย', 'ตา', 'พระ', 'ครู', 'หมอ'];
const NAME_PREFIX_SRC = NAME_PREFIXES.map((p) => p.replace(/\./g, '\\.')).join('|');
const NAME_NOT_AFTER = {
  'นาย': ['ก', 'กฯ', 'กรัฐมนตรี', 'จ้าง', 'ทุน', 'ท่าน', 'แบบ', 'อำเภอ', 'ตำรวจ', 'ทหาร', 'พล', 'ร้อย', 'สิบ', 'ช่าง', 'หน้า', 'ประกัน', 'ทะเบียน', 'สถานี', 'พราน', 'เรือ', 'พัน', 'ธนาคาร', 'ตรวจ', 'ทวาร', 'ด่าน', 'ห้าง', 'หัวหน้า'],
  'นาง': ['ฟ้า', 'แบบ', 'งาม', 'เอก', 'พยาบาล', 'รำ', 'ร้าย', 'บำเรอ', 'สนอง', 'กวัก', 'มาร', 'ไม้', 'เงือก', 'ตะเคียน', 'สิบ'],
  'น้อง': ['ชาย', 'สาว', 'หมา', 'แมว', 'ใหม่', 'เล็ก', 'เขย', 'สะใภ้', 'คนเล็ก', 'ใน', 'นักเรียน', 'นักศึกษา'],
  'พี่': ['ชาย', 'สาว', 'น้อง', 'เลี้ยง', 'เขย', 'สะใภ้', 'ใหญ่', 'คนโต', 'ใน', 'นักเรียน', 'ลูก'],
  'คุณ': ['ภาพ', 'ค่า', 'สมบัติ', 'แม่', 'พ่อ', 'หมอ', 'ครู', 'ตา', 'ยาย', 'ลุง', 'ป้า', 'นาย', 'ธรรม', 'หญิง', 'ย่า', 'ปู่', 'น้า', 'อา', 'ลักษณะ', 'ประโยชน์', 'วุฒิ', 'ชาย', 'ผู้หญิง', 'ผู้ชาย', 'เธอ', 'ลูก', 'พี่', 'น้อง', 'ท่าน', 'หนู', 'ตำรวจ', 'ทหาร', 'ครับ', 'คะ'],
  'ลุง': ['ป้า', 'น้า', 'อา', 'แก', 'คนนี้', 'คนนั้น', 'ข้างบ้าน'],
  'ป้า': ['ย', 'ยฯ', 'น้า', 'ข้างบ้าน', 'คนนี้', 'คนนั้น', 'แก'],
  'ยาย': ['ตา', 'ทวด', 'แก', 'คนนี้', 'คนนั้น', 'ข้างบ้าน'],
  'ตา': ['ม', 'ย', 'ก', 'ล', 'ข่าย', 'ราง', 'ชั่ง', 'เหล่', 'บอด', 'ลิง', 'ไม่', 'ต่อ', 'ฝาด', 'แดง', 'ทวด', 'ยาย', 'ข้าง', 'เดียว', 'เปล่า', 'ขวา', 'ซ้าย', 'หวาน', 'โต', 'เล็ก', 'ดำ', 'สว่าง', 'ร้อน', 'ปลา', 'ปี', 'สับปะรด', 'แมว', 'ข้อ', 'ตุ่ม', 'สี', 'พร่า', 'พอง', 'ค้าง', 'ลาย', 'ทิพย์', 'วิเศษ'],
  'พระ': ['ราช', 'พุทธ', 'สงฆ์', 'เครื่อง', 'ธาตุ', 'พรหม', 'อาทิตย์', 'จันทร์', 'บรม', 'ศาสดา', 'เจ้า', 'องค์', 'ที่นั่ง', 'นคร', 'บาท', 'พิฆเนศ', 'อินทร์', 'ศิวะ', 'นารายณ์', 'ภิกษุ', 'เณร', 'คุณ', 'ธรรม', 'ไตร', 'พิรุณ', 'เอก', 'รอง', 'นาง', 'ประธาน', 'ราม', 'ลักษณ์', 'ชนม์', 'อุโบสถ', 'วิหาร', 'เมรุ', 'บิดา', 'มารดา', 'แม่', 'พี่', 'ตำหนัก', 'ยา'],
  'ครู': ['ใหญ่', 'ประจำชั้น', 'ผู้สอน', 'พิเศษ', 'บา', 'ฝึก', 'สอน', 'อาจารย์', 'ผู้ช่วย', 'พี่เลี้ยง', 'ภาษา', 'คณิต', 'วิทย์', 'พละ', 'ศิลปะ', 'ดนตรี', 'เวร', 'แนะแนว', 'สาว', 'หนุ่ม'],
  'หมอ': ['ดู', 'นวด', 'น', 'ฟัน', 'ผี', 'ลำ', 'ยา', 'ตำแย', 'ผ่าตัด', 'เด็ก', 'สัตว์', 'ความ', 'กระดูก', 'หัวใจ', 'ผิวหนัง', 'ตา', 'ประจำ', 'เจ้าของไข้', 'ชาวบ้าน', 'พื้นบ้าน', 'เถื่อน', 'อนามัย'],
};

// กริยาที่ตามด้วย "เรื่อง…" = ประเด็นย่อยที่มักหายเมื่อนักเขียนเรียบเรียงใหม่
const DETAIL_VERBS = ['ห่วง', 'กังวล', 'สอน', 'เตือน', 'ถาม', 'บ่น', 'ปรึกษา', 'ร้องเรียน', 'แจ้ง', 'ร้องขอ', 'ขอ', 'โพสต์', 'เล่า', 'โวย', 'มีปัญหา', 'พูดคุย', 'คุย', 'ยอมรับ', 'ปฏิเสธ', 'ทะเลาะ', 'ขัดแย้ง', 'กลัว', 'สงสัย', 'ถกเถียง', 'สอบถาม', 'อธิบาย', 'ชี้แจง'];
const DETAIL_VERB_SRC = DETAIL_VERBS.sort((a, b) => b.length - a.length).join('|');
const DETAIL_CUT = ['และ', 'แต่', 'จน', 'ว่า', 'ให้', 'กับ', 'ของ', 'โดย', 'เพื่อ', 'ซึ่ง', 'หรือ', 'แล้ว', 'ก็', 'จึง', 'เพราะ', 'ที่', 'ไว้', 'อยู่', 'มาก', 'ด้วย'];
const DETAIL_STOP = new Set(['ต่าง', 'นี้', 'นั้น', 'ดังกล่าว', 'อื่น', 'ทั่วไป', 'ใด', 'การ', 'ความ', 'ราว', 'เดิม', 'เดียวกัน', 'นั่น', 'โน้น', 'ไหน', 'อะไร', 'อะไรบ้าง', 'ทั้งหมด', 'เหล่านี้', 'เหล่านั้น', 'บาง', 'บางอย่าง', 'ส่วนตัว']);
const NAME_STOP = new Set(['คน', 'ที่', 'ว่า', 'ก็', 'จะ', 'ได้', 'ไม่', 'และ', 'กับ', 'ของ', 'ให้', 'เขา', 'เธอ', 'มัน', 'นี้', 'นั้น', 'หนึ่ง', 'สอง', 'สาม', 'ท่าน', 'เอง', 'ทั้ง', 'ตัว', 'ผม', 'ฉัน', 'หนู']);

let _segmenter = null;
let _segmenterTried = false;
function countThaiWords(text) {
  if (!_segmenterTried) {
    _segmenterTried = true;
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') _segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    } catch {
      _segmenter = null;
    }
  }
  const clean = String(text || '');
  if (_segmenter) {
    let n = 0;
    for (const s of _segmenter.segment(clean)) if (s.isWordLike) n++;
    return n;
  }
  return Math.max(1, Math.ceil(clean.replace(/\s+/g, '').length / 4)); // สำรอง: ไทยเฉลี่ย ~4 ตัวอักษร/คำ
}

function thaiDigitsToArabic(text) {
  return String(text ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/** ข้อความสำหรับเทียบ: NFC · เลขไทย→อารบิก · ตัดตัวคั่นหลักพัน · ตัดเครื่องหมายคำพูด · ตัดช่องว่าง (เลขที่เคยคั่นช่องว่างกันคงเส้นแบ่ง '|') · ตัวพิมพ์เล็ก */
export function normalizeFactText(text) {
  return thaiDigitsToArabic(String(text ?? '').normalize('NFC'))
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d):(?=\d{2}(?!\d))/g, '$1.')
    .replace(/[“”"‘’'«»「」]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(?<=\d) (?=\d)/g, '|')
    .replace(/ /g, '')
    .toLowerCase();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prepareRaw(raw) {
  return thaiDigitsToArabic(String(raw ?? '').normalize('NFC'))
    .replace(/https?:\/\/\S+/g, ' ')
    // เลขลำดับหัวข้อ "1. " / "2) " ต้นบรรทัด = ไม่ใช่ข้อเท็จจริง (ต้องทำก่อนยุบบรรทัด)
    .replace(/(^|\n)[ \t]*\d{1,2}[.)](?=[ \t])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function toBuddhistYear(value) {
  if (value == null) return null;
  const y = Number(value);
  if (!Number.isFinite(y)) return null;
  if (y < 100) return 2500 + y;
  if (y < 2400) return y + 543;
  return y;
}

function maskSpan(text, start, length) {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
}

/** ดึงวันที่ออกจากข้อความ (คืน facts + ข้อความที่ถูกปิดทับช่วงวันที่ เพื่อไม่ให้ตัวเลขในวันที่ถูกนับซ้ำ) */
function extractDates(text) {
  let work = text;
  const facts = [];
  const push = (m, day, month, year) => {
    facts.push({ text: m[0].trim(), day: day == null ? null : Number(day), month: month == null ? null : Number(month), year: toBuddhistYear(year) });
    work = maskSpan(work, m.index, m[0].length);
  };
  const unitGuard = `(?!\\s*(?:${UNIT_SRC}))`;
  const dayMonth = new RegExp(`(?<![\\d.])(\\d{1,2})\\s*(${MONTH_SRC})\\s*(?:พ\\.ศ\\.\\s*|ค\\.ศ\\.\\s*)?(\\d{4}(?!\\d)|[4-9]\\d(?![\\d.:])${unitGuard})?`, 'g');
  for (const m of text.matchAll(dayMonth)) push(m, m[1], MONTH_INDEX.get(m[2]), m[3]);
  const numeric = /(?<![\d.\/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d\/])/g;
  for (const m of work.matchAll(numeric)) push(m, m[1], m[2], m[3]);
  const explicitYear = /(?:ปี|พ\.ศ\.|ค\.ศ\.)\s*(\d{4})(?!\d)/g;
  for (const m of work.matchAll(explicitYear)) push(m, null, null, m[1]);
  const bareYear = new RegExp(`(?<![\\d.,])((?:25[4-9]|20[0-3]|19[6-9])\\d)(?![\\d.,])${unitGuard}`, 'g');
  for (const m of work.matchAll(bareYear)) push(m, null, null, m[1]);
  return { facts, masked: work };
}

function extractNumbers(text) {
  let work = text;
  const facts = [];
  const push = (m, display, key) => {
    facts.push({ text: display, key });
    work = maskSpan(work, m.index, m[0].length);
  };
  for (const m of work.matchAll(/(?<!\d)(0\d{1,2})-(\d{3,4})-(\d{4})(?!\d)/g)) push(m, m[0], `${m[1]}${m[2]}${m[3]}`);
  for (const m of work.matchAll(/(?<![\d.])(\d{1,2})[.:](\d{2})\s*น\./g)) push(m, `${m[1]}.${m[2]} น.`, `${m[1]}.${m[2]}`);
  const general = new RegExp(`(?<![\\d.,])(\\d[\\d,]*(?:\\.\\d+)?)(?![\\d,]|\\.\\d)\\s*(${UNIT_SRC})?`, 'g');
  for (const m of work.matchAll(general)) {
    const key = m[1].replace(/,/g, '');
    if (!/\d/.test(key)) continue;
    push(m, m[2] ? `${m[1]} ${m[2]}` : m[1], key);
  }
  return facts;
}

function extractQuotesAndShortNames(text) {
  const quotes = [];
  const names = [];
  const patterns = [/“([^“”]{2,400})”/g, /"([^"\n]{2,400})"/g, /‘([^‘’]{2,400})’/g, /«([^«»]{2,400})»/g, /「([^「」]{2,400})」/g];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const inner = m[1].replace(/\s+/g, ' ').trim();
      if (inner.length < 2) continue;
      if (countThaiWords(inner) >= 4) quotes.push(inner);
      else if (inner.length <= 40 && /[\p{L}]/u.test(inner)) names.push(inner);
    }
  }
  return { quotes, names };
}

function extractPrefixedNames(text) {
  const names = [];
  const re = new RegExp(`(?<![\\p{Script=Thai}])(${NAME_PREFIX_SRC})\\s?([\\p{Script=Thai}]{2,12})(?=$|[\\s“”"‘’'(),.!?:;\\-–—/]|[A-Za-z0-9])`, 'gu');
  for (const m of text.matchAll(re)) {
    const prefix = m[1];
    const name = m[2];
    const blocked = NAME_NOT_AFTER[prefix] || [];
    if (blocked.some((b) => name.startsWith(b))) continue;
    if (NAME_STOP.has(name)) continue;
    if (NAME_PREFIXES.includes(name)) continue;
    names.push(name);
  }
  return names;
}

function extractDetails(text) {
  const details = [];
  const re = new RegExp(`(?:เป็น)?(${DETAIL_VERB_SRC})(?:กัน|ลูก|เขา|เธอ|ผม|ฉัน)?เรื่อง([\\p{Script=Thai}]{2,24})`, 'gu');
  for (const m of text.matchAll(re)) {
    let topic = m[2];
    let cutAt = -1;
    for (const cut of DETAIL_CUT) {
      const idx = topic.indexOf(cut, 2);
      if (idx >= 2 && (cutAt < 0 || idx < cutAt)) cutAt = idx;
    }
    if (cutAt >= 2) topic = topic.slice(0, cutAt);
    if (topic.length < 2 || DETAIL_STOP.has(topic)) continue;
    details.push(`${m[1]}เรื่อง${topic}`);
  }
  return details;
}

function uniqueBy(list, keyOf) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** โครงละเอียด (มี key สำหรับเทียบ) — extractSourceFacts ห่อให้เป็นข้อความล้วนตามสัญญา */
export function extractSourceFactsDetailed(raw) {
  const text = prepareRaw(raw);
  if (!text) return { numbers: [], dates: [], quotes: [], names: [], details: [] };
  const dated = extractDates(text);
  const numbers = uniqueBy(extractNumbers(dated.masked), (n) => n.key);
  const dates = uniqueBy(dated.facts, (d) => `${d.day}/${d.month}/${d.year}`);
  const q = extractQuotesAndShortNames(text);
  const quotes = uniqueBy(q.quotes.map((t) => ({ text: t, key: normalizeFactText(t) })), (x) => x.key);
  const names = uniqueBy(
    [...q.names, ...extractPrefixedNames(text)].map((t) => ({ text: t, key: normalizeFactText(t) })),
    (x) => x.key,
  );
  const details = uniqueBy(
    extractDetails(text).map((t) => {
      const topic = t.slice(t.indexOf('เรื่อง') + 'เรื่อง'.length);
      const keys = [normalizeFactText(topic)];
      const stripped = topic.replace(/^(?:การ|ความ)/u, '');
      if (stripped !== topic && stripped.length >= 3) keys.push(normalizeFactText(stripped));
      return { text: t, keys };
    }),
    (x) => x.keys[0],
  );
  return { numbers, dates, quotes, names, details };
}

/**
 * @param {string} raw ต้นฉบับดิบ
 * @returns {{ numbers: string[], dates: string[], quotes: string[], names: string[], details: string[] }}
 */
export function extractSourceFacts(raw) {
  const d = extractSourceFactsDetailed(raw);
  return {
    numbers: d.numbers.map((x) => x.text),
    dates: d.dates.map((x) => x.text),
    quotes: d.quotes.map((x) => x.text),
    names: d.names.map((x) => x.text),
    details: d.details.map((x) => x.text),
  };
}

/** ความยาวอักษรต่อเนื่องที่ยาวที่สุดของ needle ที่โผล่ใน haystack (binary search — ถ้ายาว k โผล่ ยาว k-1 ก็โผล่) */
export function longestCommonRun(needle, haystack) {
  const a = String(needle || '');
  const b = String(haystack || '');
  if (!a || !b) return 0;
  const has = (k) => {
    for (let i = 0; i + k <= a.length; i++) if (b.includes(a.slice(i, i + k))) return true;
    return false;
  };
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (has(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function numberFound(key, out) {
  const re = new RegExp(`(?<!\\d|\\d\\.)${escapeRegExp(key)}(?!\\d|\\.\\d)`);
  return re.test(out);
}

function dateFound(fact, outDates, out) {
  for (const o of outDates) {
    if (fact.day != null && o.day !== fact.day) continue;
    if (fact.month != null && o.month !== fact.month) continue;
    if (fact.year != null && o.year != null && o.year !== fact.year) continue;
    if (fact.day == null && fact.month == null && o.year !== fact.year) continue;
    return true;
  }
  if (fact.day == null && fact.month == null && fact.year != null) return numberFound(String(fact.year), out);
  return false;
}

/**
 * เทียบต้นฉบับกับผลลัพธ์ แล้วคืนรายการที่หาย — เตือนเท่านั้น
 * @param {string} raw ต้นฉบับดิบ
 * @param {string} output เนื้อที่จะโพสต์
 * @param {{ quoteCoverage?: number, maxMissing?: number }} [opts]
 * @returns {{ missing: Array<{ type: string, text: string }>, checked: number, coverage: number, byType: object }}
 */
export function findMissingFacts(raw, output, opts = {}) {
  const facts = extractSourceFactsDetailed(raw);
  const out = normalizeFactText(output);
  const quoteCoverage = Number.isFinite(opts.quoteCoverage) ? opts.quoteCoverage : 0.6;
  const maxMissing = Number.isInteger(opts.maxMissing) && opts.maxMissing > 0 ? opts.maxMissing : 20;
  const outDates = extractDates(prepareRaw(output)).facts;
  const missing = [];
  const byType = { number: 0, date: 0, quote: 0, name: 0, detail: 0 };
  let checked = 0;
  const check = (type, text, found) => {
    checked++;
    byType[type]++;
    if (!found) missing.push({ type, text });
  };
  for (const n of facts.numbers) check('number', n.text, numberFound(n.key, out));
  for (const d of facts.dates) check('date', d.text, dateFound(d, outDates, out));
  for (const q of facts.quotes) {
    const need = Math.max(1, Math.ceil(q.key.length * quoteCoverage));
    check('quote', q.text, q.key.length > 0 && longestCommonRun(q.key, out) >= need);
  }
  for (const n of facts.names) check('name', n.text, n.key.length > 0 && out.includes(n.key));
  for (const d of facts.details) check('detail', d.text, d.keys.some((k) => k && out.includes(k)));
  const coverage = checked > 0 ? Math.round(((checked - missing.length) / checked) * 1000) / 1000 : 1;
  return {
    missing: missing.slice(0, maxMissing),
    checked,
    coverage,
    byType,
    ...(missing.length > maxMissing ? { truncated: missing.length - maxMissing } : {}),
  };
}
