// ★ 25 ต.ค. 69 (เจ้าของสั่งแก้ข้อ 3 จากผลทดสอบท่อทีละขั้น — "กฎ+ด่านโค้ด"):
//   ข่าวพยาบาลร้อยเอ็ด: นักเขียนตัดวันเวลาทิ้งทั้งก้อนใน 1 เวอร์ชัน (Opus 4.8) และไม่มีด่านไหนจับ
//   เพราะด่าน Sol ตรวจ RAW ปิดอยู่ (RAW_FACT_COMPLETENESS_GATE=0 ตั้งแต่ 20 ส.ค. 69 — เคยวนแก้เผาเงิน ~86฿/รอบ)
//   → ด่านนี้เป็นโค้ดล้วน ไม่เรียก AI ไม่แก้เนื้อ: เช็คแค่ "วันที่ / อายุ / จำนวนเงิน" ที่อยู่ในข้อความดิบ
//     ว่ายังอยู่ในแต่ละเวอร์ชันไหม ถ้าไม่เจอ → ติดป้าย version._missingFacts (บอทโชว์ "⚠️ อาจตกข้อเท็จจริง" ใต้ข่าวชิ้นนั้น)
//   ไม่เช็คเวลา (นักเขียนเขียน "สี่โมงเย็น" แทน "16.00 น." ได้ถูกต้อง — เช็คด้วยโค้ดแล้วเตือนผิดบ่อย)
//   ★ รอบ 2 (ผู้ตรวจอิสระวัดคลังงานจริง 117 งาน: เตือนผิด 8/19 เวอร์ชัน): อายุรับ "ขวบ" และ "อายุ/วัย N" ที่ไม่มีคำว่าปี ·
//     เงินแปลง ล้าน/แสน/หมื่น/พัน เป็นค่าแล้วเทียบค่า (6 แสน = 600,000) · เลขวันที่ต้องไม่ติดเลขอื่น ("117 ตุลาคม" ≠ 17)
//   ถอย: RAW_FACT_PRESENCE_WARN=0 (0/off/false/no) = ไม่เช็ค ไม่ติดป้าย

const THAI_MONTHS = [
  ['มกราคม', 'ม.ค.'], ['กุมภาพันธ์', 'ก.พ.'], ['มีนาคม', 'มี.ค.'], ['เมษายน', 'เม.ย.'],
  ['พฤษภาคม', 'พ.ค.'], ['มิถุนายน', 'มิ.ย.'], ['กรกฎาคม', 'ก.ค.'], ['สิงหาคม', 'ส.ค.'],
  ['กันยายน', 'ก.ย.'], ['ตุลาคม', 'ต.ค.'], ['พฤศจิกายน', 'พ.ย.'], ['ธันวาคม', 'ธ.ค.'],
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_ALT = THAI_MONTHS.flat().map(esc).join('|');
const DATE_RE = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:เดือน\\s*)?(${MONTH_ALT})(?!ส\\.)`, 'gu'); // รอบ 4: "1 ส.ค.ส." ≠ 1 สิงหาคม · รอบ 5: กันแค่ ส.ค.ส. ("17 ตุลาคมพ.ศ.2569" ต้องยังจับได้)
const AGE_RE = /(?:(วัย|อายุ)\s*(\d{1,3})\s*(ปี|ขวบ)|(?<!\d)(\d{1,2})\s*ขวบ)/gu;
const MULT = { 'ล้าน': 1e6, 'แสน': 1e5, 'หมื่น': 1e4, 'พัน': 1e3 };
// เงิน = กลุ่ม "ตัวเลข+หน่วยคูณ" ต่อกันได้ ("1 ล้าน 2 แสน" · "2 หมื่น 5 พัน") + เลขท้าย (เฉพาะเมื่อมี "บาท" ตาม) + บาท? · หรือ ตัวเลข + บาท
//   ★ รอบ 3 (ผู้ตรวจรอบ 2): เดิมจับทีละกลุ่ม "2 หมื่น 5 พันบาท" ได้ 5,000 · "1 ล้าน 2 แสนบาท" ได้ 2 ก้อน → เตือนผิดเมื่อนักเขียนเขียน 25,000 / 1.2 ล้าน
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const MONEY_RE = new RegExp(`(?<![\\d.,])((?:${NUM}\\s*(?:ล้าน|แสน|หมื่น|พัน)\\s*)+)(?:(${NUM})\\s*(?=บาท))?(บาท)?|(?<![\\d.,])(${NUM})\\s*(บาท)|฿\\s*(${NUM})(?!\\s*(?:ล้าน|แสน|หมื่น|พัน)|[\\d.,])`, 'gu'); // รอบ 4: ฿500 = 500 บาท · รอบ 5 (ผู้ตรวจรอบ 4): "฿1.2 ล้าน" ไม่ใช่ 1.2 บาท
const GROUP_RE = new RegExp(`(${NUM})\\s*(ล้าน|แสน|หมื่น|พัน)`, 'gu');
const toNum = (s) => Number(String(s).replace(/,/g, ''));
// เพดานต่อชนิด — ข้อความดิบยาวมีเลขพื้นหลังเยอะ เช็คเฉพาะตัวแรกๆ ที่มักเป็นแก่นเหตุการณ์ (กันเตือนรก)
const MAX_PER_TYPE = { date: 2, age: 3, money: 3 };

export function isRawFactPresenceWarnEnabled() {
  const raw = String(process.env.RAW_FACT_PRESENCE_WARN ?? '').trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
  return !['0', 'off', 'false', 'no'].includes(raw);
}

function toArabicDigits(text) {
  return String(text || '').replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)));
}

// ตัวเลขเขียนเป็นคำไทยหน้าหน่วย (ฝั่งเวอร์ชันเท่านั้น): "เจ็ดสิบเอ็ดปี" → 71ปี · "ราวหมื่นบาท" → ราว1หมื่นบาท
//   (วัดคลังงานจริงรอบ 2: นักเขียนเขียน "ราวหมื่นบาท" แทน 10,000 บาท → เตือนผิด 2 ฉบับ) · รองรับ 1–99 พอสำหรับอายุ/วันที่/จำนวนคูณ
const TH_DIGIT = { 'หนึ่ง': 1, 'เอ็ด': 1, 'สอง': 2, 'ยี่': 2, 'สาม': 3, 'สี่': 4, 'ห้า': 5, 'หก': 6, 'เจ็ด': 7, 'แปด': 8, 'เก้า': 9 };
const TH_NUM_RE = new RegExp(`((?:${Object.keys(TH_DIGIT).join('|')}|สิบ|ร้อย)+)(?=\\s*(?:ปี|ขวบ|บาท|หมื่น|แสน|ล้าน|พัน|เดือน|${MONTH_ALT}))`, 'gu');
function thaiWordToInt(word) {
  const m = word.match(/^(?:(หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?(ร้อย))?(?:(หนึ่ง|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?(สิบ))?(หนึ่ง|เอ็ด|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?$/u);
  if (!m || (!m[2] && !m[4] && !m[5])) return null;
  return (m[2] ? (m[1] ? TH_DIGIT[m[1]] : 1) * 100 : 0) + (m[4] ? (m[3] ? TH_DIGIT[m[3]] : 1) * 10 : 0) + (m[5] ? TH_DIGIT[m[5]] : 0);
}
function thaiNumberWordsToDigits(text) {
  return text
    .replace(TH_NUM_RE, (w) => { const n = thaiWordToInt(w); return n === null ? w : String(n); })
    .replace(/(?<!\d\s?)(หมื่น|แสน|ล้าน|พัน)(?=\s*(?:บาท|\d))/gu, '1$1'); // รอบ 4: "หมื่น5พันบาท" → 1หมื่น5พันบาท
}

function monthIndex(name) {
  return THAI_MONTHS.findIndex((pair) => pair.includes(name));
}

/**
 * ค่าเงินทุกก้อนในข้อความ (บาท) — "6 แสนบาท" = 600000 · "2.5 ล้าน" = 2500000 · "40,000 บาท" = 40000 · "1 ล้าน 2 แสนบาท" = 1200000
 * lenient = ฝั่งเวอร์ชัน: นับหน่วยคูณที่ไม่มี "บาท" ทุกแบบ (กันเตือนผิดเมื่อนักเขียนละคำว่าบาท)
 * ฝั่งข้อความดิบเข้มกว่า: ต้องมี "บาท" เท่านั้น (★ รอบ 3 ผู้ตรวจรอบ 2: "ยอดวิวทะลุ 1 ล้าน!" เคยถูกนับเป็นเงิน — ยอมไม่เช็ค "6 ล้าน" ที่ละบาท ดีกว่าเตือนผิด)
 */
function moneyValues(text, { lenient = false } = {}) {
  const out = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const label = m[0].trim();
    if (m[4] || m[6]) { // ตัวเลข + บาท · ฿ + ตัวเลข
      const n = toNum(m[4] || m[6]);
      if (Number.isFinite(n)) out.push({ value: n, label });
      continue;
    }
    if (!m[3] && !lenient) continue;
    const groups = [...m[1].matchAll(GROUP_RE)].map((g) => ({ n: toNum(g[1]), mult: MULT[g[2]] }));
    if (groups.some((g) => !Number.isFinite(g.n))) continue;
    const descending = groups.every((g, i) => i === 0 || g.mult < groups[i - 1].mult);
    if (descending) {
      const tail = m[2] ? toNum(m[2]) : 0;
      out.push({ value: groups.reduce((s, g) => s + g.n * g.mult, 0) + (Number.isFinite(tail) ? tail : 0), label });
    } else {
      // ไม่เรียงจากใหญ่ไปเล็ก = ไม่ใช่จำนวนเดียวกัน (เช่น "3 แสน 2 แสน") → นับแยกก้อน (ฝั่งดิบเหลือก้อนสุดท้ายที่ติด "บาท")
      for (const g of lenient ? groups : groups.slice(-1)) out.push({ value: g.n * g.mult, label });
    }
  }
  return out;
}

/** ดึงข้อเท็จจริงที่เช็คด้วยโค้ดได้จากข้อความดิบ: [{ type, label, test(content) }] */
export function extractCheckableRawFacts(rawText) {
  const raw = toArabicDigits(rawText);
  const facts = [];
  const seen = new Set();
  const push = (type, key, label, test) => {
    if (seen.has(`${type}:${key}`)) return;
    if (facts.filter((f) => f.type === type).length >= MAX_PER_TYPE[type]) return;
    seen.add(`${type}:${key}`);
    facts.push({ type, label, test });
  };
  for (const m of raw.matchAll(DATE_RE)) {
    const day = Number(m[1]);
    const mi = monthIndex(m[2]);
    if (mi < 0 || day < 1 || day > 31) continue;
    const re = new RegExp(`(?<!\\d)${day}\\s*(?:เดือน\\s*)?(?:${THAI_MONTHS[mi].map(esc).join('|')})`, 'u');
    push('date', `${day}-${mi}`, `${day} ${THAI_MONTHS[mi][0]}`, (content) => re.test(content));
  }
  for (const m of raw.matchAll(AGE_RE)) {
    const n = m[2] || m[4];
    const unit = m[3] || 'ขวบ';
    // มีได้ทั้ง "N ปี/ขวบ" และเลขที่ตามหลัง "วัย/อายุ" ไม่เกิน 25 ตัวอักษร ไม่มีหน่วยก็ได้ (เช่น "อายุ 15 จนถึง 28")
    const re = new RegExp(`(?:(?:วัย|อายุ)[^\\n]{0,25}?(?<!\\d)${n}(?!\\d)|(?<!\\d)${n}\\s*(?:ปี|ขวบ))`, 'u');
    push('age', n, `${m[1] ? `${m[1]} ` : ''}${n} ${unit}`, (content) => re.test(content));
  }
  for (const { value, label } of moneyValues(raw)) {
    push('money', String(value), label, (content) => moneyValues(content, { lenient: true }).some((x) => Math.abs(x.value - value) < 0.5));
  }
  return facts;
}

/** ต่อเวอร์ชัน: ข้อเท็จจริงจากข้อความดิบที่ไม่เจอ → [{ version, missing: [{ type, text }] }] (เฉพาะเวอร์ชันที่ไม่เจอ) */
export function findMissingRawFacts(versions, rawText) {
  if (!isRawFactPresenceWarnEnabled() || !rawText || !Array.isArray(versions)) return [];
  const facts = extractCheckableRawFacts(rawText);
  if (facts.length === 0) return [];
  return versions
    .map((v, i) => {
      const content = thaiNumberWordsToDigits(toArabicDigits(typeof v === 'string' ? v : v?.content));
      if (!content) return null;
      const missing = facts.filter((f) => !f.test(content)).map((f) => ({ type: f.type, text: f.label }));
      return missing.length ? { version: i + 1, missing } : null;
    })
    .filter(Boolean);
}

/**
 * ติดป้าย _missingFacts ให้เวอร์ชันที่ไม่เจอข้อเท็จจริงจากต้นฉบับ — รูปเดียวกับที่บอทอ่าน (buildWarningLines: { missing: [{type, text}], checked })
 * คืนอาเรย์ใหม่ (ไม่แก้ของเดิม) · เวอร์ชันที่ครบ = ตัวเดิมทุกไบต์ · ถ้ามี _missingFacts อยู่แล้ว ต่อท้ายโดยไม่ซ้ำข้อความ
 */
export function annotateMissingRawFacts(versions, rawText) {
  if (!Array.isArray(versions)) return { versions, flagged: [] };
  const flagged = findMissingRawFacts(versions, rawText);
  if (flagged.length === 0) return { versions, flagged };
  const byIndex = new Map(flagged.map((f) => [f.version - 1, f.missing]));
  const out = versions.map((v, i) => {
    const add = byIndex.get(i);
    if (!add || !v || typeof v !== 'object') return v;
    const prev = Array.isArray(v._missingFacts?.missing) ? v._missingFacts.missing : [];
    const known = new Set(prev.map((m) => String(m?.text ?? m)));
    return { ...v, _missingFacts: { ...(v._missingFacts || {}), checked: true, missing: [...prev, ...add.filter((m) => !known.has(m.text))], source: v._missingFacts?.source || 'rawFactPresence' } };
  });
  return { versions: out, flagged };
}

// ★ กฎใบสั่งเขียน (คู่กับด่านนี้) — นักเขียนต้องคงวันที่/เสียงตอบรับ/สถานที่/ผลลัพธ์ของต้นฉบับ · summarizeServiceText เรียกตอนประกอบใบสั่ง
//   ถอย: WRITER_KEEP_FACTS_RULE=0/off/false/no (ทนอัญประกาศ/ช่องว่าง) = ไม่ใส่กฎ (ใบสั่งเหมือนก่อน 25 ต.ค. ทุกไบต์)
export const WRITER_KEEP_FACTS_RULE_TEXT = '- ★ ข้อเท็จจริงหลักของข้อความดิบต้องอยู่ครบทุกเวอร์ชัน: ถ้าข้อความดิบระบุวันที่หรือเวลา ต้องใส่ไว้ในเนื้อข่าวทุกเวอร์ชัน ห้ามตัดทิ้ง (วางย่อหน้าที่ 2 ได้ ไม่ต้องเปิดด้วยวันที่) — ถ้าไม่ระบุ ห้ามเติมวันที่/เวลาเอง · ถ้าต้นฉบับเล่าเสียงตอบรับหรือคำชม (มักอยู่ท้ายต้นฉบับ) ต้องมีในเนื้อข่าวด้วย · สถานที่ ผลลัพธ์ ใครยืนยัน ห้ามตัดทิ้งเพื่อเอาที่ไปใส่ประโยคปิดที่แต่งเอง — ถ้าจะปิดด้วยประโยคของตัวเอง ให้เล่าข้อเท็จจริงเหล่านั้นก่อน · กริยาสำคัญต้องตรงความหมายเดิม (เช่น "ประสาน" ห้ามกลายเป็น "สั่ง")\n';
export function isWriterKeepFactsRuleEnabled() {
  return !/^(?:0|off|false|no)$/i.test(String(process.env.WRITER_KEEP_FACTS_RULE ?? '').trim().replace(/^["']+|["']+$/g, '').trim());
}
export function writerKeepFactsRuleLine() {
  return isWriterKeepFactsRuleEnabled() ? WRITER_KEEP_FACTS_RULE_TEXT : '';
}
