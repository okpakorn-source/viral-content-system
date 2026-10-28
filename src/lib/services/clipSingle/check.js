/**
 * 🔎 clipSingle/check.js — ตรวจเนื้อข่าวช่องเดียวเทียบบทถอดด้วยโค้ดล้วน (ไม่เรียก AI · ฟังก์ชันบริสุทธิ์)
 * ------------------------------------------------------------------
 * เจ้าของเคาะ 25 ต.ค. 69 "ตรวจเบาด้วยโค้ด": แก้เฉพาะคำพูดที่ใกล้เคียงบทถอดมาก ส่วนที่ยืนยันไม่ได้ขึ้นเป็น "จุดที่ควรเช็ค"
 *   ① คำพูดใน “ ” ต้องตรงบทถอด — ใกล้มาก (≥0.9) แทนด้วยคำจริง · ใกล้บางส่วนหรือไม่พบ = ควรเช็ค
 *   ② ชื่อที่คนเขียนใช้ ต้องมีในเสียง/จอ/ชื่อคลิป (ลอกคำนำหน้าและคำบทบาทออกก่อน — บทเรียนด่านเดิมตีคำบทบาทว่าชื่อแต่ง)
 *   ③ ตัวเลขในพาดหัว/เนื้อ ต้องมีในคลิป (อ่านเลขไทย/คำอ่านตัวเลข/หน่วยพัน-ล้านได้)
 *   ④ ประเด็นสำคัญของทุกช่วงต้องถูกเขียนถึง (ตัดคำไทยด้วย Intl.Segmenter — บทเรียนด่านเดิมเทียบทั้งวลี)
 *   ⑤ ใช้ "เธอ" ทั้งที่คลิปไม่บอกเพศ · ⑥ ช่วงที่ดูไม่สำเร็จ
 */

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
export const toArabicDigits = (s) => String(s ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));

/** ตัดช่องว่าง/เครื่องหมายทิ้ง เก็บแผนที่ตำแหน่งกลับไปข้อความเดิม (ใช้ยกคำจริงจากบทถอดมาแทน) */
export function normalizeWithMap(src) {
  const s = String(src ?? '');
  let norm = '';
  const map = [];
  for (let i = 0; i < s.length; i += 1) {
    let ch = s[i];
    const td = THAI_DIGITS.indexOf(ch);
    if (td >= 0) ch = String(td);
    if (/[ก-๎0-9a-zA-Z]/.test(ch)) { norm += ch.toLowerCase(); map.push(i); }
  }
  return { norm, map };
}
export const normalize = (s) => normalizeWithMap(s).norm;

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
export function similarity(a, b) {
  const L = Math.max(a.length, b.length);
  return L ? 1 - levenshtein(a, b) / L : 1;
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i += 1) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
function dice(qg, qn, w) {
  const wg = bigrams(w);
  let hit = 0;
  for (const [g, c] of wg) hit += Math.min(c, qg.get(g) || 0);
  return (2 * hit) / Math.max(1, (qn - 1) + (w.length - 1));
}

/** หาช่วงในบทถอดที่ใกล้คำพูดที่สุด → { score 0–1, start, end } (ตำแหน่งในข้อความ normalize) */
export function bestMatch(q, t) {
  if (!q || !t) return null;
  const exact = t.indexOf(q);
  if (exact >= 0) return { score: 1, start: exact, end: exact + q.length };
  const L = q.length;
  if (L < 4 || t.length < 4) return null;
  const qg = bigrams(q);
  const step = Math.max(1, Math.floor(L / 6));
  const cands = [];
  for (let s = 0; s <= Math.max(0, t.length - Math.floor(L * 0.8)); s += step) {
    cands.push({ s, d: dice(qg, L, t.slice(s, s + L)) });
  }
  cands.sort((a, b) => b.d - a.d);
  let best = null;
  const stride = Math.max(1, Math.floor(step / 3));
  for (const c of cands.slice(0, 5)) {
    for (let s = Math.max(0, c.s - step); s <= c.s + step; s += stride) {
      for (const f of [0.9, 1, 1.1]) {
        const len = Math.max(4, Math.round(L * f));
        if (s + len > t.length + 2) continue;
        const score = similarity(q, t.slice(s, s + len));
        if (!best || score > best.score) best = { score, start: s, end: Math.min(t.length, s + len) };
      }
    }
  }
  if (!best) return null;
  // ขยับขอบทีละตัว (สระ/วรรณยุกต์ไทยทำให้ความยาวจริงต่างจากคำพูดได้ 1–2 ตัว) — เลือกช่วงที่ใกล้สุด
  const delta = Math.max(3, Math.ceil(L * 0.15));
  let refined = best;
  for (let s = Math.max(0, best.start - 2); s <= best.start + 2; s += 1) {
    for (let e = Math.max(s + 4, best.end - delta); e <= Math.min(t.length, best.end + delta); e += 1) {
      const score = similarity(q, t.slice(s, e));
      if (score > refined.score) refined = { score, start: s, end: e };
    }
  }
  return refined;
}

/** หาช่วงที่ตรงที่สุด "ภายในบรรทัดเดียว" ของบทถอด — คืนตำแหน่งในข้อความ normalize ของทั้งบทถอด */
//   ★ ผู้ตรวจอิสระรอบ 2: ค้นเฉพาะบรรทัดที่ช่วงเดิมคร่อม (±1) — เดิมไล่ทุกบรรทัดของบทถอด คลิป 2 ชม. ใช้ถึง 92 วิ (เครื่องค้าง)
function bestWithinLine(qNorm, raw, tMap, lineStarts, fromLine, toLine) {
  const firstNormAt = (rawIdx) => { // ตำแหน่งแรกในข้อความ normalize ที่มาจากตัวอักษร ≥ rawIdx (ค้นแบบแบ่งครึ่ง)
    let lo = 0, hi = tMap.map.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tMap.map[mid] < rawIdx) lo = mid + 1; else hi = mid; }
    return lo;
  };
  let best = null;
  for (let li = Math.max(0, fromLine - 1); li <= Math.min(lineStarts.length - 1, toLine + 1); li += 1) {
    const a = lineStarts[li];
    const b = li + 1 < lineStarts.length ? lineStarts[li + 1] - 1 : raw.length;
    const startNorm = firstNormAt(a);
    const lineNorm = tMap.norm.slice(startNorm, firstNormAt(b));
    if (lineNorm.length < Math.min(qNorm.length * 0.6, 8)) continue;
    const h = bestMatch(qNorm, lineNorm);
    if (h && (!best || h.score > best.score)) best = { score: h.score, start: startNorm + h.start, end: startNorm + h.end };
  }
  return best;
}

const THAI_MARK = /[ัิ-ฺ็-๎]/;
/** ยกข้อความจริงจากบทถอดตามช่วง normalize — ไม่ตัดสระ/วรรณยุกต์ที่ห้อยท้ายตัวสุดท้าย */
function sliceOriginal(raw, map, start, end) {
  const from = map[start];
  let to = map[Math.max(start, end - 1)] + 1;
  while (to < raw.length && THAI_MARK.test(raw[to])) to += 1;
  return raw.slice(from, to);
}

/** คำพูดในเครื่องหมาย “ ” หรือ " " (ข้างในยาวพอให้ตรวจได้) */
export function extractQuotes(body) {
  const out = [];
  // ★ ผู้ตรวจอิสระ 25 ต.ค.: ห้ามจับคู่เครื่องหมายคำพูดข้ามบรรทัด/ย่อหน้า (ได้ "คำพูด" ยาวทั้งย่อหน้าแล้วตัวหาช้าจนเครื่องค้าง)
  const re = /“([^”\n]+)”|"([^"\n]+)"/g;
  let m;
  while ((m = re.exec(String(body ?? '')))) {
    const inner = (m[1] ?? m[2] ?? '').trim();
    if (normalize(inner).length >= 6) out.push({ full: m[0], inner, open: m[0][0], close: m[0][m[0].length - 1] });
  }
  return out;
}

// ── ตัวเลข ──
const NUM_WORD = { ศูนย์: 0, หนึ่ง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 };
const UNIT_WORD = { สิบ: 10, ร้อย: 100, พัน: 1000, หมื่น: 10000, แสน: 100000, ล้าน: 1000000 };
const THAI_NUM_RUN = /(?:ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)+/g;
const TOKEN = /ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน/g;

/**
 * ภาษาพูด "พันห้า" = 1500 · "แสนห้า" = 150000 (เลขตัวเดียวต่อท้ายหน่วยใหญ่ = หลักถัดลงไป) — คืนค่าแบบพูดถ้าเข้ารูปนี้ · ไม่เข้า = null
 *   ใช้คู่กับ parseThaiNumberWords (ค่าทางการ) โดยผู้เรียกเก็บทั้งสองค่าเป็นหลักฐาน (ผู้ตรวจอิสระ 25 ต.ค.: "พันห้า" ถูกอ่านเป็น 1005 แล้วติดธงผิด)
 */
export function parseThaiColloquial(run) {
  const toks = String(run ?? '').match(TOKEN);
  if (!toks || toks.length < 2) return null;
  const last = toks[toks.length - 1];
  const prev = toks[toks.length - 2];
  if (!(last in NUM_WORD) || !(prev in UNIT_WORD) || UNIT_WORD[prev] < 100) return null;
  const head = parseThaiNumberWords(toks.slice(0, -1).join(''));
  return head == null ? null : head + NUM_WORD[last] * (UNIT_WORD[prev] / 10);
}

/** คำอ่านตัวเลขไทย → จำนวน ("หนึ่งล้านห้าแสน" → 1500000) · อ่านไม่ได้ = null */
export function parseThaiNumberWords(run) {
  const toks = String(run ?? '').match(TOKEN);
  if (!toks) return null;
  let result = 0, section = 0, digit = null;
  for (const tok of toks) {
    if (tok in NUM_WORD) {
      digit = tok === 'เอ็ด' ? (digit ?? 0) + 1 : NUM_WORD[tok];
    } else if (tok === 'ล้าน') {
      section += digit ?? (section || result ? 0 : 1);
      result = (result + section) * 1000000;
      section = 0; digit = null;
    } else {
      section += (digit ?? 1) * UNIT_WORD[tok];
      digit = null;
    }
  }
  return result + section + (digit ?? 0);
}

const UNIT_AFTER = /^\s*(พัน|หมื่น|แสน|ล้าน)/;
const canon = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));

// ── เวลาแบบพูด ──
// ★ 26 ต.ค. 69 (เทียบคนเขียนเฟส 2 คลิป 4): ในคลิปพูด "สามทุ่ม" คนเขียนเขียน "21.00 น." ถูกต้อง แต่ตัวตรวจไม่รู้จักคำบอกเวลา → ธงผิด
//   คืนชั่วโมงแบบ 24 ชม. ที่คำพูดนั้นหมายถึงได้ ("สี่โมง" กำกวม = ทั้ง 4 และ 16) · "ครึ่ง" = นาที 30 (เขียน 21.30 → 21.3)
//   🔴 ผู้ตรวจอิสระ 26 ต.ค.: ชั่วโมงเหล่านี้เป็นหลักฐานได้เฉพาะ "ตัวเลขที่เขียนแบบเวลา" (21.00 / 21:00 / 21 น.)
//      เดิมใส่รวมกับหลักฐานตัวเลขทั้งหมด → คลิปพูด "บ่ายสองโมง" แล้ว "เสียหาย 14 ล้าน" ผ่านไปด้วย
//   · คำที่หน้าตาเหมือนเวลาแต่ไม่ใช่: "ทุ่มเท/ทุ่มทุน" · "เที่ยงธรรม/เที่ยงตรง/เที่ยงแท้"
const HOUR_WORD = '(\\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบเอ็ด|สิบสอง|สิบ)';
const CLOCK_RULES = [
  [new RegExp(`${HOUR_WORD}\\s*ทุ่ม(?!เท|ทุน|สุด)`, 'g'), (n) => (n >= 1 && n <= 6 ? [18 + n] : [])],
  [/ทุ่ม(?:นึง|หนึ่ง)/g, () => [19]],
  [new RegExp(`ตี\\s*${HOUR_WORD}`, 'g'), (n) => (n >= 1 && n <= 5 ? [n] : [])],
  [new RegExp(`บ่าย\\s*${HOUR_WORD}?\\s*โมง`, 'g'), (n) => (n == null ? [13] : n >= 1 && n <= 5 ? [12 + n] : [])],
  [new RegExp(`บ่าย\\s*${HOUR_WORD}`, 'g'), (n) => (n >= 1 && n <= 5 ? [12 + n] : [])],
  [new RegExp(`${HOUR_WORD}\\s*โมง`, 'g'), (n) => (n >= 1 && n <= 12 ? (n <= 6 ? [n, n + 12] : [n]) : [])],
  [/เที่ยงคืน/g, () => [0, 24]],
  [/เที่ยง(?!คืน|ธรรม|ตรง|แท้)/g, () => [12]],
];
export function clockHours(textIn) {
  const s = toArabicDigits(textIn);
  const out = [];
  for (const [re, toHours] of CLOCK_RULES) {
    for (const m of s.matchAll(re)) {
      const w = m[1];
      const n = w == null ? null : /^\d+$/.test(w) ? Number(w) : parseThaiNumberWords(w);
      for (const h of toHours(n)) {
        out.push(h);
        if (/^\s*ครึ่ง/.test(s.slice(m.index + m[0].length))) out.push(h + 0.3);
      }
    }
  }
  return out;
}

/** ตัวเลขทุกแบบในข้อความ → ชุดค่า (รวมค่าคูณหน่วยท้าย เช่น "1.5 ล้าน" = 1.5 และ 1500000) */
export function numbersIn(textIn) {
  const s = toArabicDigits(textIn);
  const set = new Set();
  const re = /\d+(?:,\d{3})*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(s))) {
    const n = Number(m[0].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    set.add(canon(n));
    const unit = s.slice(m.index + m[0].length).match(UNIT_AFTER);
    if (unit) set.add(canon(n * UNIT_WORD[unit[1]]));
    const pair = s.slice(m.index + m[0].length).match(TIME_PAIR); // บนจอเขียน "21:45" = เวลา 21.45
    if (pair && pair[1] !== '00' && isTimePair(n, pair[1])) set.add(canon(n + Number(pair[1]) / 100));
  }
  for (const run of s.match(THAI_NUM_RUN) || []) {
    const n = parseThaiNumberWords(run);
    if (n != null) set.add(canon(n));
    const spoken = parseThaiColloquial(run);
    if (spoken != null) set.add(canon(spoken));
  }
  return set;
}

// ★ 26 ต.ค. 69 (เทียบคนเขียนเฟส 2 คลิป 10): "โควิด-19" คือชื่อโรค ไม่ใช่ข้อเท็จจริงเชิงตัวเลข
//   🔴 ผู้ตรวจอิสระ: ข้ามเฉพาะเลข 19 — "ผู้ป่วยโควิด 350 ราย" ยังต้องตรวจ
const NAMED_NUMBER_BEFORE = /(?:โควิด|โควิท|covid|โคโรนา)\s*-?\s*$/i;
// ตัวเลขที่เขียนแบบเวลา (21.00 · 21:30 · 21 น. · 21 นาฬิกา) — ใช้หลักฐานคำบอกเวลาแบบพูดได้
const TIME_SHAPE = /^\d{1,2}[.:]\d{2}$/;
const TIME_AFTER = /^\s*(?:น\.|นาฬิกา)/;
// 🔴 ผู้ตรวจอิสระรอบ 2: คู่ "ชั่วโมง:นาที" ต้องเป็นเวลาได้จริง (ชม. ≤ 24 · นาที 2 หลัก ≤ 59) และตรวจเป็นค่าเดียว (21:45 = 21.45)
//   — ห้ามเก็บชั่วโมงเดี่ยวไว้ด้วย (เดิม "21:45" ผ่านเพราะ 21 ตรงกับ "สามทุ่ม") · คู่ที่ไม่ใช่เวลา ("1:250") ตรวจทีละตัว
const TIME_PAIR = /^:(\d{2})(?!\d)/;
function isTimePair(h, mm) { return Number.isInteger(h) && h <= 24 && Number(mm) <= 59; }

/** ตัวเลขที่ต้องมีหลักฐาน (เขียนเป็นหลัก) — คืน [{ shown, values:Set, time:boolean }] */
function writtenNumbers(textIn) {
  const s = toArabicDigits(textIn);
  const out = [];
  const re = /\d+(?:,\d{3})*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(s))) {
    const n = Number(m[0].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    if (m[0] === '19' && NAMED_NUMBER_BEFORE.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
    const hourBefore = s.slice(Math.max(0, m.index - 4), m.index).match(/(?:^|\D)(\d{1,2}):$/);
    if (hourBefore && /^\d{2}$/.test(m[0]) && isTimePair(Number(hourBefore[1]), m[0])) continue; // นาทีของเวลา — ตรวจรวมกับชั่วโมงแล้ว
    const after = s.slice(m.index + m[0].length);
    const pair = after.match(TIME_PAIR);
    const minute = pair && isTimePair(n, pair[1]) ? pair[1] : null;
    const values = new Set([minute && minute !== '00' ? canon(n + Number(minute) / 100) : canon(n)]); // 21:30 = 21.3 แบบเดียวกับ 21.30
    const unit = minute ? null : after.match(UNIT_AFTER);
    if (unit) values.add(canon(n * UNIT_WORD[unit[1]]));
    const time = !unit && n <= 24.59 && (TIME_SHAPE.test(m[0]) || !!minute || TIME_AFTER.test(after));
    out.push({ shown: unit ? `${m[0]} ${unit[1]}` : minute ? `${m[0]}:${minute}` : m[0], values, time });
  }
  return out;
}

// ── ชื่อ ──
// ยศเต็ม/ย่อ ต้องมาก่อนคำสั้น (พล. ก่อน พ.) · คำนำหน้าสั้นที่ชนกับชื่อจริง (ตา/แม่/พ่อ) ลอกเฉพาะเมื่อเหลือชื่อยาวพอ
const HONORIFIC = /^(พลตำรวจ(?:เอก|โท|ตรี)|พันตำรวจ(?:เอก|โท|ตรี)|ร้อยตำรวจ(?:เอก|โท|ตรี)|จ่าสิบตำรวจ|สิบตำรวจ(?:เอก|โท|ตรี)|พลเอก|พลโท|พลตรี|พันเอก|พันโท|พันตรี|ร้อยเอก|ร้อยโท|ร้อยตรี|จ่าสิบ(?:เอก|โท|ตรี)|สิบ(?:เอก|โท|ตรี)|นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|คุณ|หลวงพ่อ|หลวงพี่|พระ|ดร\.|ศ\.|รศ\.|ผศ\.|พล\.[ตอร]\.[อทต]\.?|พล\.[อทต]\.?|พ\.[ตอ]\.[ตอท]\.?|ร\.[ตอท]\.[ตอท]\.?|ส\.[ตอท]\.[ตอท]\.?|จ\.ส\.[ตอท]\.?|ดีเจ|น้อง|พี่|ป้า|ลุง|ยาย|ตา|แม่|พ่อ|เจ๊|เฮีย|อาจารย์|ครู|หมอ)/;
// ★ ผู้ตรวจอิสระ 25 ต.ค.: เทียบคำบทบาทแบบขึ้นต้นทำให้ชื่อจริงหาย ("คนึงนิจ" ขึ้นต้นด้วย "คน") → คำบทบาทต้องตรงทั้งคำ
//   หรือเป็นวลีบทบาทชัดเจน (ขึ้นต้นด้วย ผู้/เจ้าของ/เจ้าหน้าที่… หรือมีคำบทบาทซ้อนอยู่ เช่น "ลูกสาวเจ้าของร้าน")
const ROLE_EXACT = new Set(['พิธีกร', 'ชาย', 'หญิง', 'เด็ก', 'คน', 'ทีมงาน', 'ลูกค้า', 'พนักงาน', 'ชาวบ้าน', 'เพื่อน', 'ญาติ', 'สามี', 'ภรรยา', 'ลูก', 'ลูกสาว', 'ลูกชาย', 'หลาน', 'แฟน', 'เสียง', 'บุคคล', 'กลุ่ม', 'นักข่าว', 'ตำรวจ', 'ทหาร', 'แพทย์', 'พยาบาล', 'ไม่ทราบชื่อ', 'แม่', 'พ่อ', 'ยาย', 'ตา', 'ป้า', 'ลุง',
  'บิดา', 'มารดา']); // ★ 26 ต.ค. 69 (เทียบคนเขียนเฟส 2): คนเขียนใส่ "บิดา" ในรายชื่อ → ธงชื่อผิด
const ROLE_PHRASE = /^(ผู้|เจ้าของ|เจ้าหน้าที่|ทีมงาน|พนักงาน|ชาวบ้าน|นักข่าว|ผู้สื่อข่าว|อดีต|เสียง|กลุ่ม)|ในคลิป|เจ้าของร้าน|ผู้ให้สัมภาษณ์|ผู้ดำเนินรายการ|^(ชาย|หญิง|เด็ก|ลูกสาว|ลูกชาย|ภรรยา|สามี|แม่|พ่อ)(ของ|ใน|ที่|วัย|ผู้|เจ้า|ชาว)/;

export function nameTokens(name) {
  return String(name ?? '').split(/[\s()/,，、]+/).map((w) => w.trim()).filter(Boolean)
    .filter((w) => !ROLE_PHRASE.test(w)) // วลีบทบาทตัดสินจากคำเดิมก่อนลอกคำนำหน้า ("แม่ของน้อง…" ห้ามเหลือ "ของน้อง…")
    .map((w) => {
      let t = w;
      for (let i = 0; i < 2; i += 1) { const m = t.match(HONORIFIC); if (m && t.length > m[0].length + 1) t = t.slice(m[0].length); }
      return t;
    })
    .filter((w) => !ROLE_EXACT.has(w) && !ROLE_PHRASE.test(w) && (/[ก-๙]{2,}/.test(w) || /[A-Za-z]{2,}/.test(w)));
}

// ── ความครบของประเด็น ──
const STOP = new Set(['และ', 'หรือ', 'ที่', 'ซึ่ง', 'ของ', 'ใน', 'ได้', 'ให้', 'ว่า', 'กับ', 'จาก', 'เป็น', 'มี', 'การ', 'ความ', 'ไป', 'มา', 'แล้ว', 'อยู่', 'ถึง', 'เรื่อง', 'โดย', 'เพื่อ', 'จะ', 'ก็', 'แต่', 'ยัง', 'นี้', 'นั้น', 'คือ', 'เมื่อ', 'กัน', 'ทั้ง', 'ตัว', 'เอง', 'ช่วง', 'คลิป']);
let _seg = null;
function contentWords(s) {
  try { _seg = _seg || new Intl.Segmenter('th', { granularity: 'word' }); } catch { _seg = null; }
  const words = _seg
    ? [..._seg.segment(String(s ?? ''))].filter((x) => x.isWordLike).map((x) => normalize(x.segment))
    : String(s ?? '').split(/\s+/).map(normalize);
  return [...new Set(words.filter((w) => w.length >= 2 && !STOP.has(w)))];
}
// ★ 26 ต.ค. 69 (เทียบคนเขียนเฟส 2 คลิป 9–10): ช่วงโฆษณา/ปิดรายการ คนเขียนข้ามตามกฎ "ห้ามเอ่ยรายการ/พิธีกร/โปรโมต"
//   ตัวตรวจความครบจึงไม่ควรเรียกร้องประเด็นเหล่านี้ (เดิมขึ้นธง "อาจไม่ได้เขียนถึง" 3 จุดในคลิปเดียว)
//   🔴 ผู้ตรวจอิสระ: คำเดี่ยว (โฆษณา/แบรนด์/ส่วนลด) กลืนข่าวจริง ("แบรนด์ดังยื่นฟ้อง…" · "โฆษณาเกินจริง…")
//      → ข้ามเฉพาะวลีปิดรายการ/ขอบคุณสปอนเซอร์ หรือ "สินค้า/แบรนด์" คู่กับท่าทีเชียร์ให้ลอง/เป็นพรีเซนเตอร์
//   🔴 ผู้ตรวจอิสระรอบ 2: ข่าวผลิตภัณฑ์อันตราย/ของปลอม/เด็กหาย ("ลองกินผลิตภัณฑ์…จนเสียชีวิต" · "ฝากติดตามหาเด็ก…")
//      ถูกข้ามด้วย → ประเด็นที่มีคำแนวข่าวร้ายไม่ถือเป็นโปรโมตเด็ดขาด · "แนะนำให้" ต้องตามด้วย "ลอง" · "ฝากติดตาม" ต้องเป็นช่อง/รายการ
//   🔴 ผู้ตรวจอิสระรอบ 3: คู่คำ "สินค้า/แบรนด์ + ลอง…/สูตรใหม่/พรีเซนเตอร์" ยังกลืนข่าวจริง (นักเรียนคิดค้นผลิตภัณฑ์สูตรใหม่ ·
//      ยูทูบเบอร์ลองกินขนมแบรนด์ใหม่ · ดราม่าพรีเซนเตอร์) → คู่คำนี้ "ไม่ข้าม" แค่ต่อป้ายบอกว่าอาจเป็นช่วงโปรโมต (ไม่ซ่อนอะไร)
//      ข้ามจริงเฉพาะวลีปิดรายการ/ขอบคุณผู้สนับสนุน · คำแนวข่าวร้ายเป็นคำเต็ม (เดิม "สาร"/"หาย" ไปโดน "สารสกัด"/"หายเหนื่อย")
//   🔴 ผู้ตรวจอิสระรอบ 4: "กดซับ/กดไลก์/กดติดตาม/ช่วงโฆษณา" คำเดี่ยวกลืนข่าวจริง ("ยายวัย 80 มีผู้กดซับทะลุล้าน" ·
//      "พิธีกรหลุดพูดคำหยาบช่วงโฆษณา") → ต้องเป็นประโยคชวน (ฝาก/อย่าลืม/ช่วยกัน… กดไลก์) หรือ "เข้า/พักช่วงโฆษณา"
//   🔴 รอบ 5: คำชวนต้องมี "กด…" หรือ "ติดตาม/ซับ + ช่อง/รายการ/เพจ/คลิป/ตอน" ("ช่วยกันซับน้ำมัน" · "ชวนติดตาม" = สำนวนน่าติดตาม)
//      · "แจ้งเตือน" (กดกระดิ่งแจ้งเตือน) ไม่นับเป็นคำข่าวร้าย
//   🔴 รอบ 6: "ช่องทาง" (ลงทะเบียน/รับบริจาค) กับ "รายการชื่อ/สินค้า" ไม่ใช่ช่อง/รายการทีวี · "กดกระดิ่ง" = ประโยคชวน
const PROMO_CLOSING = /ขอบคุณสถานที่|ขอบคุณผู้สนับสนุน|ฝาก(?:กด)?ติดตาม(?:ช่อง(?!ทาง)|รายการ(?!ชื่อ|สินค้า)|เพจ|ผลงาน|คลิป)|(?:ฝาก|ขอให้|ชวน|อย่าลืม|ช่วย)(?:ผู้ชม|ทุกคน|กัน)?\s*(?:กด(?:ไลก์|ไลค์|ซับ|ติดตาม|subscribe|กระดิ่ง)|(?:ติดตาม|ซับ)(?:ช่อง(?!ทาง)|รายการ(?!ชื่อ|สินค้า)|เพจ|คลิป|ตอน))|(?:เข้า|ตัดเข้า|พัก)(?:ช่วง)?โฆษณา|กล่าวปิดรายการ|ปิดท้ายรายการ/i;
const PROMO_BRAND = /แบรนด์|ผลิตภัณฑ์|สินค้า|สปอนเซอร์|sponsor/i;
const PROMO_ENDORSE = /แนะนำให้ลอง|ลองดื่ม|ลองใช้|ลองทาน|ลองกิน|ให้เป็นพรีเซนเตอร์|เป็นพรีเซนเตอร์ให้|สูตรใหม่|สูตรปรับปรุง/;
const NEWS_HARM = /เสียชีวิต|ตาย|ป่วย|อันตราย|ปลอม|เถื่อน|จับกุม|ถูกจับ|หลอก|(?<!แจ้ง)เตือน|หยุดใช้|สารพิษ|สารต้องห้าม|สารอันตราย|สารปรอท|สเตียรอยด์|อย\.|ร้องเรียน|ฟ้อง|ผิดกฎหมาย|เกินมาตรฐาน|สั่งเก็บ|แพ้|โกง|หายตัว|สูญหาย|มิจฉาชีพ|ดราม่า|หลุด|คำหยาบ/;
/** ประเด็นปิดรายการ/ขอบคุณผู้สนับสนุน — ตัวตรวจความครบข้ามได้ */
export const isPromoPoint = (point) => !NEWS_HARM.test(point) && PROMO_CLOSING.test(point);
/** ประเด็นที่อาจเป็นช่วงโปรโมตสินค้า — ยังตรวจความครบตามเดิม แค่ต่อป้ายให้คนตัดสิน */
export const maybePromoPoint = (point) => !NEWS_HARM.test(point) && PROMO_BRAND.test(point) && PROMO_ENDORSE.test(point);
/** สัดส่วนคำเนื้อหาของประเด็นที่พบในเนื้อข่าว (0–1) · คำน้อยเกินตัดสินไม่ได้ = null */
export function coverageRatio(point, bodyNorm) {
  const words = contentWords(point);
  if (words.length < 3) return null;
  return words.filter((w) => bodyNorm.includes(w)).length / words.length;
}

// ★ ผู้ตรวจอิสระ 25 ต.ค.: คำใบ้กว้างไปทำให้ธง "เธอ" ไม่ขึ้น ("คะ" ใน "คะแนน" · "แม่" ใน "แม่น้ำ") → เหลือคำที่บอกเพศชัด
//   "คะ" นับเฉพาะท้ายประโยค/ก่อนเว้นวรรค · "แม่" นับเฉพาะรูปที่หมายถึงคน
const FEMALE_HINT = /เธอ|ค่ะ|คะ(?=[\s,.!?…”"')]|$)|ผู้หญิง|หญิง|นางสาว|น\.ส\.|ภรรยา|ลูกสาว|น้องสาว|พี่สาว|ยาย|ป้า|คุณนาย|ดิฉัน|คุณแม่|เป็นแม่|แม่ของ|ตัวแม่/m;
const mmss = (sec) => { const s = Math.max(0, Math.round(Number(sec) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ★ ผู้ตรวจอิสระ 25 ต.ค. (วัดจริง): ค้นแบบใกล้เคียงกับคำพูดยาว 1,500+ ตัวบนบทถอด 265K ตัว ใช้ 31–77 วิ (เครื่องค้าง)
//   → คำพูดยาวเกินนี้ตรวจแบบตรงตัวอย่างเดียว ไม่ตรง = ขึ้นจุดเช็ค (ไม่แก้อัตโนมัติ)
export const QUOTE_FUZZY_MAX = 300;
export const QUOTE_FIX_MIN = 0.9;
export const QUOTE_PARTIAL_MIN = 0.6;
export const COVERAGE_MIN = 0.34;
const MAX_FLAGS_PER_KIND = 8;

/**
 * ★ 28 ต.ค. 69 ร้อยแก้วกระชับ (คลิป ≤8 นาที ดูแล้วเขียนรอบเดียว): ไม่มีบทถอดให้เทียบ
 *   ด่านคำพูด/ชื่อ/ตัวเลข/ความครบ เทียบกับความว่างจะติดธงผิดทุกข้อ → ข้าม แล้วบอกพนักงานตรง ๆ ว่าคำพูดยังไม่ได้เทียบ
 *   (ห้องทดลองพบฉบับดูรอบเดียวอ่านชื่อบนจอผิดและยกคำพูดไม่ตรงบางส่วนได้)
 */
function checkWithoutTranscript(draft, caption) {
  const body = String(draft?.body ?? '');
  const headline = String(draft?.headline ?? '');
  const checks = [];
  const stats = { quotes: 0, quotesFixed: 0, quotesFlagged: 0, names: 0, namesFlagged: 0, numbers: 0, numbersFlagged: 0, keyPoints: 0, keyPointsUncovered: 0, keyPointsSkipped: 0, noTranscript: true };
  stats.quotes = extractQuotes(body).length;
  // ★ ผู้ตรวจอิสระ 28 ต.ค.: ขึ้นทุกใบ — ไม่มีจุดเช็คเลย หน้าจอจะขึ้น "✓ ตัวตรวจไม่พบจุดที่ต้องเช็ค" ทั้งที่ยังไม่ได้เทียบอะไร
  const what = stats.quotes ? `ชื่อ ตัวเลข และคำพูดในเครื่องหมายคำพูด (${stats.quotes} จุด)` : 'ชื่อและตัวเลข';
  checks.push({ level: 'check', kind: 'unverified', text: `ฉบับนี้ดูคลิปแล้วเขียนรอบเดียว ไม่มีบทถอดให้ระบบเทียบ — ${what} ควรเช็คกับคลิปก่อนใช้` });
  if (/เธอ/.test(`${headline}\n${body}`) && !FEMALE_HINT.test(caption)) {
    checks.push({ level: 'check', kind: 'gender', text: 'ใช้คำว่า "เธอ" — ฉบับดูรอบเดียวไม่มีบทถอดให้ระบบยืนยันเพศ ตรวจกับคลิปก่อนใช้' });
  }
  return { headline, body, checks, stats };
}

/**
 * @param {{headline:string, body:string, names?:string[]}} draft
 * @param {{segments:Array, caption?:string, noTranscript?:boolean}} ev  segments = ผลดูคลิปที่ normalizeWatch แล้ว + {no,startSec,endSec,ok}
 *   noTranscript = ฉบับดูรอบเดียวไม่มีบทถอด (28 ต.ค. 69)
 * @returns {{headline:string, body:string, checks:Array<{level:'fixed'|'check', kind:string, text:string}>, stats:object}}
 */
export function checkSingleBody(draft, ev = {}) {
  const segments = Array.isArray(ev.segments) ? ev.segments : [];
  const okSegs = segments.filter((s) => s.ok);
  const caption = String(ev.caption ?? '');
  if (ev.noTranscript) return checkWithoutTranscript(draft, caption);
  // หนึ่งรายการคำพูด = หนึ่งบรรทัดเสมอ (ยุบขึ้นบรรทัดใหม่ภายในข้อความ กันบรรทัดเลื่อนจากป้ายผู้พูด)
  const transcriptRaw = okSegs.flatMap((s) => s.transcript.map((t) => String(t.text ?? '').replace(/\s*[\r\n]+\s*/g, ' '))).join('\n');
  const tMap = normalizeWithMap(transcriptRaw);
  const evidenceAll = [
    transcriptRaw,
    okSegs.flatMap((s) => s.transcript.map((t) => t.speaker)).join('\n'),
    okSegs.flatMap((s) => s.screen.map((x) => x.text)).join('\n'),
    okSegs.flatMap((s) => s.visuals).join('\n'),
    caption,
  ].join('\n');
  const evNorm = normalize(evidenceAll);
  const evNumbers = numbersIn(evidenceAll);
  const evClock = new Set(clockHours(evidenceAll).map(canon)); // ใช้ได้กับตัวเลขที่เขียนแบบเวลาเท่านั้น

  let body = String(draft?.body ?? '');
  const headline = String(draft?.headline ?? '');
  const checks = [];
  const stats = { quotes: 0, quotesFixed: 0, quotesFlagged: 0, names: 0, namesFlagged: 0, numbers: 0, numbersFlagged: 0, keyPoints: 0, keyPointsUncovered: 0, keyPointsSkipped: 0 };
  const push = (level, kind, textMsg) => {
    if (checks.filter((c) => c.kind === kind).length < MAX_FLAGS_PER_KIND) checks.push({ level, kind, text: textMsg });
  };

  // ⑥ ช่วงที่ดูไม่สำเร็จ — เนื้อข่าวขาดช่วงนั้นแน่นอน
  for (const s of segments.filter((x) => !x.ok)) {
    push('check', 'segment', `ช่วง ${mmss(s.startSec)}–${mmss(s.endSec)} ดูคลิปไม่สำเร็จ เนื้อข่าวไม่มีเนื้อหาช่วงนี้`);
  }

  // ① คำพูด
  // บรรทัดของบทถอด = คำพูดทีละท่อนพร้อมผู้พูด → ใช้กันคำพูดที่รวมคำของหลายคน (ผู้ตรวจอิสระ 25 ต.ค.)
  // ตัวตนผู้พูดต่อบรรทัด: ป้ายทั่วไป ("ผู้พูด 1") ใช้ได้แค่ในช่วงเดียวกัน (แต่ละช่วงดูแยกกัน "ผู้พูด 1" คนละช่วงอาจคนละคน)
  //   · บรรทัดไม่มีป้าย = คนไม่ทราบตัว นับเป็นคนละคนเสมอ (ผู้ตรวจอิสระรอบ 2)
  const lineSpk = okSegs.flatMap((s) => s.transcript.map((t, j) => {
    const label = String(t.speaker || '').trim();
    if (!label) return `?${s.no}:${j}`;
    return /^ผู้พูด\s*\d+$/.test(label) ? `${s.no}:${label}` : label;
  }));
  const lineStarts = [0];
  for (let i = 0; i < transcriptRaw.length; i += 1) if (transcriptRaw[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (rawIdx) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= rawIdx) lo = mid; else hi = mid - 1; } return lo; };
  const linesOf = (hit) => [lineAt(tMap.map[hit.start]), lineAt(tMap.map[Math.max(hit.start, hit.end - 1)])];
  const speakersIn = (hit) => {
    const [a, b] = linesOf(hit);
    return new Set(lineSpk.slice(a, b + 1));
  };
  const flagQuote = (msg) => { stats.quotesFlagged += 1; push('check', 'quote', msg); };
  const fixQuote = (q, real) => {
    // แทนด้วยฟังก์ชัน — กัน $& $' ในบทถอดถูกตีความเป็นรูปแบบแทนที่
    body = body.replace(q.full, () => `${q.open}${real}${q.close}`);
    stats.quotesFixed += 1;
    push('fixed', 'quote', `แก้คำพูดให้ตรงคลิป: “${q.inner}” → “${real}”`);
  };
  for (const q of extractQuotes(body)) {
    stats.quotes += 1;
    const qNorm = normalize(q.inner);
    let hit;
    if (qNorm.length > QUOTE_FUZZY_MAX) {
      const at = tMap.norm.indexOf(qNorm);
      if (at < 0) { flagQuote(`คำพูดยาว “${q.inner.slice(0, 80)}…” ไม่ตรงบทถอดตัวต่อตัว — ตรวจกับคลิปก่อนใช้`); continue; }
      hit = { score: 1, start: at, end: at + qNorm.length };
    } else {
      hit = bestMatch(qNorm, tMap.norm);
      // ช่วงที่ตรงกันคร่อมบรรทัด → ลองหาใหม่ภายในบรรทัดเดียวก่อนตัดสิน
      if (hit && hit.score < 0.999 && sliceOriginal(transcriptRaw, tMap.map, hit.start, hit.end).includes('\n')) {
        const [fromLine, toLine] = linesOf(hit);
        const inLine = bestWithinLine(qNorm, transcriptRaw, tMap, lineStarts, fromLine, toLine);
        if (inLine && inLine.score >= hit.score - 0.02) hit = inLine;
      }
    }
    if (!hit || hit.score < QUOTE_PARTIAL_MIN) { flagQuote(`ไม่พบคำพูด “${q.inner}” ในบทถอด — อาจถูกเรียบเรียงหรือแต่งเพิ่ม`); continue; }
    if (speakersIn(hit).size > 1) {
      flagQuote(`คำพูด “${q.inner.slice(0, 120)}” รวมคำของผู้พูดมากกว่าหนึ่งคนในคลิป — แยกหรือระบุผู้พูดให้ถูก`);
      continue;
    }
    // ผู้พูดคนเดียว: ท่อนที่คร่อมบรรทัดต่อด้วยเว้นวรรค · เติมสระ/วรรณยุกต์ที่ขาดท้ายคำ
    const real = sliceOriginal(transcriptRaw, tMap.map, hit.start, hit.end)
      .replace(/\s*\n\s*/g, ' ').replace(/^[\s,.!?…“”"']+|[\s,.!?…“”"']+$/g, '');
    if (hit.score >= 0.999) {
      if (real && normalize(real) !== qNorm) fixQuote(q, real); // ตรงทุกตัวแต่ตัดกลางคำ (ขาดสระ/วรรณยุกต์ท้าย)
      continue;
    }
    if (hit.score >= QUOTE_FIX_MIN && real) { if (real !== q.inner) fixQuote(q, real); continue; }
    flagQuote(`คำพูด “${q.inner}” ตรงคลิปแค่บางส่วน — ในคลิปพูดว่า “${real}”`);
  }

  // ② ชื่อ
  const names = [...new Set((Array.isArray(draft?.names) ? draft.names : []).map((n) => String(n ?? '').trim()).filter(Boolean))];
  for (const name of names) {
    const toks = nameTokens(name);
    if (!toks.length) continue;
    stats.names += 1;
    const missing = toks.filter((tok) => !evNorm.includes(normalize(tok)));
    if (missing.length) {
      stats.namesFlagged += 1;
      push('check', 'name', `ชื่อ "${name}" ไม่พบในคลิปหรือแคปชั่น (${missing.join(', ')}) — ตรวจก่อนใช้`);
    }
  }

  // ③ ตัวเลข
  const seen = new Set();
  for (const n of writtenNumbers(`${headline}\n${body}`)) {
    if (seen.has(n.shown)) continue;
    seen.add(n.shown);
    stats.numbers += 1;
    if (![...n.values].some((v) => evNumbers.has(v) || (n.time && evClock.has(v)))) {
      stats.numbersFlagged += 1;
      push('check', 'number', `ตัวเลข "${n.shown}" ไม่พบในคลิป — ตรวจก่อนใช้`);
    }
  }

  // ④ ความครบของประเด็น
  const bodyNorm = normalize(`${headline}\n${body}`);
  for (const s of okSegs) {
    for (const point of s.keyPoints || []) {
      if (isPromoPoint(point)) { stats.keyPointsSkipped += 1; continue; }
      const r = coverageRatio(point, bodyNorm);
      if (r == null) continue;
      stats.keyPoints += 1;
      if (r < COVERAGE_MIN) {
        stats.keyPointsUncovered += 1;
        push('check', 'coverage', `ประเด็นช่วง ${mmss(s.startSec)}–${mmss(s.endSec)} อาจไม่ได้เขียนถึง: ${point}${maybePromoPoint(point) ? ' (อาจเป็นช่วงโปรโมต — ถ้าใช่ ไม่ต้องเขียนถึง)' : ''}`);
      }
    }
  }

  // ⑤ เดาเพศ
  if (/เธอ/.test(`${headline}\n${body}`) && !FEMALE_HINT.test(evidenceAll)) {
    push('check', 'gender', 'ใช้คำว่า "เธอ" แต่คลิปไม่ได้บอกเพศชัด — ควรเปลี่ยนเป็นชื่อหรือบทบาท');
  }

  return { headline, body, checks, stats };
}
