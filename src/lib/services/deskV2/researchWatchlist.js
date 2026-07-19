/**
 * =====================================================
 * 🎙️ Research Watchlist (โต๊ะข่าวกลาง v2, เฟส 6 — 19 ก.ค. 69) — เลนสัมภาษณ์คนดัง
 * =====================================================
 * รายชื่อคนดัง/รายการ "ที่เฝ้าดู" สำหรับเลนสัมภาษณ์ + ตัวช่วยเลือกโควตาต่อรอบ + ตัวช่วยจับชื่อแบบ exact
 * 🔴 pure JS + import ได้เฉพาะ sanitizeText จาก ./dnaContract.js เท่านั้น
 * 🔴 ห้ามพึ่งพาตัวช่วยเก็บข้อมูลถาวร (persist-store) / ค่าย AI ภายนอกทุกชนิด (เรียกโมเดลภาษา/จัดเส้นทางโมเดล/
 *    ขุดบทสัมภาษณ์อัตโนมัติ) ห้าม namespace-import ทั้งโมดูล (import ทุกอย่างจากไฟล์เดียว) ห้าม network/fs
 * 🔴 ห้ามใช้เวลาปัจจุบันของระบบหรือค่าสุ่มเป็นเมล็ดพันธุ์ — deterministic ล้วน (รับ runSeed/now เป็นพารามิเตอร์เมื่อจำเป็น)
 * 🔴 ห้ามเดาชื่อ/เพศคนในคลิป — โมดูลนี้แค่ "รายชื่อที่เฝ้าดู" ไม่ใช่ตัวยืนยันตัวตน (ยืนยันจริงอยู่ที่ researchInterview.js)
 *
 * WatchEntry = { id, name, aliases:string[], kind:'person'|'program', needsContext:boolean,
 *                sourceVersion:string, active:boolean }
 *   - needsContext:true = ชื่อกำกวม (พ้องกับคำทั่วไป/นามแฝงคนอื่น) — ผู้ใช้ปลายทางต้องใส่บริบทเพิ่มตอนค้น
 *   - aliases ว่างเสมอในชุด seed-v1 (ไม่เติมนามสกุล/ตัวตนเองที่ผู้ใช้ไม่ได้ให้มา — กันมั่ว)
 */

import { sanitizeText } from './dnaContract.js';

const MAX_NAME_LEN = 80;

function personEntry(id, name, { needsContext = false } = {}) {
  return Object.freeze({
    id,
    name: sanitizeText(name, MAX_NAME_LEN),
    aliases: Object.freeze([]),
    kind: 'person',
    needsContext: !!needsContext,
    sourceVersion: 'seed-v1',
    active: true,
  });
}

function programEntry(id, name) {
  return Object.freeze({
    id,
    name: sanitizeText(name, MAX_NAME_LEN),
    aliases: Object.freeze([]),
    kind: 'program',
    needsContext: false,
    sourceVersion: 'seed-v1',
    active: true,
  });
}

// ── seed v1 — 27 คน + 2 รายการ (ชื่อตามที่ผู้ใช้ให้เป๊ะ ห้ามเติมนามสกุล/ตัวตนเอง) ──
// 🔴 needsContext:true เฉพาะ 3 ชื่อกำกวม: 'คิว' (พ้องคำทั่วไป), 'พี่ช้าง' (คำเรียกทั่วไป), 'ป๋ากิ๊ก' (พ้องชื่อเล่นคนอื่น)
export const WATCHLIST_SEED_V1 = Object.freeze([
  personEntry('wl-p01', 'คิว', { needsContext: true }),
  personEntry('wl-p02', 'เป็กกี้ ศรีธัญญา'),
  personEntry('wl-p03', 'เสก โลโซ'),
  personEntry('wl-p04', 'ก้อย รัชวิน'),
  personEntry('wl-p05', 'เชน ธนา'),
  personEntry('wl-p06', 'ป๋อง กพล'),
  personEntry('wl-p07', 'ลูกเกด เมทินี'),
  personEntry('wl-p08', 'เก้า จิรายุ'),
  personEntry('wl-p09', 'เบิ้ล ปทุมราช'),
  personEntry('wl-p10', 'เสือ เสฏกานต์'),
  personEntry('wl-p11', 'แพท ณปภา'),
  personEntry('wl-p12', 'พี่ช้าง', { needsContext: true }),
  personEntry('wl-p13', 'ลำไย ไหทองคำ'),
  personEntry('wl-p14', 'หลุยส์ สก๊อต'),
  personEntry('wl-p15', 'นุ่น รมิดา'),
  personEntry('wl-p16', 'ท็อป ดารณีนุช'),
  personEntry('wl-p17', 'แจม ชลธร'),
  personEntry('wl-p18', 'หนิง ปณิตา'),
  personEntry('wl-p19', 'ปิ่น เก็จมณี'),
  personEntry('wl-p20', 'วี วิโอเลต'),
  personEntry('wl-p21', 'มาริโอ้ เมาเร่อ'),
  personEntry('wl-p22', 'แอน ทองประสม'),
  personEntry('wl-p23', 'อั้ม พัชราภา'),
  personEntry('wl-p24', 'บุ๋ม ปนัดดา'),
  personEntry('wl-p25', 'ตูน Bodyslam'),
  personEntry('wl-p26', 'พีท ทองเจือ'),
  personEntry('wl-p27', 'ป๋ากิ๊ก', { needsContext: true }),
  programEntry('wl-g01', 'Sad Bar'),
  programEntry('wl-g02', 'แฉ'),
]);

/**
 * getWatchlistSeed — คัดลอกชุด seed ทั้งหมด (เฉพาะ active) ให้ผู้เรียกแก้ต่อได้อย่างปลอดภัย
 * 🔴 คืน object/array ใหม่เสมอ (ไม่ใช่ ref เดิม) — แก้ผลลัพธ์ที่คืนไปแล้วต้องไม่กระทบ WATCHLIST_SEED_V1
 * @returns {Array<object>} WatchEntry[]
 */
export function getWatchlistSeed() {
  return WATCHLIST_SEED_V1.filter((e) => e.active).map((e) => ({
    ...e,
    aliases: e.aliases.slice(),
  }));
}

/**
 * selectWatchlistForRound — เลือก `limit` รายการ "ที่ถูกใช้น้อยสุด/นานสุด" ต่อรอบวิจัย (deterministic)
 * @param {object} input
 * @param {Array<object>} input.entries       WatchEntry[] ตั้งต้น (ลำดับเดิม = ลำดับ tie-break)
 * @param {Array<Array<string>>} [input.recentRunIds=[]]  ประวัติแต่ละรอบ (เก่า→ใหม่): recentRunIds[i] = entryId[] ที่ถูกใช้ในรอบ i
 * @param {number} input.limit                จำนวนที่ต้องการต่อรอบ
 * @returns {Array<object>} WatchEntry[] ยาว ≤ min(limit, entries.length), ไม่ mutate entries/recentRunIds
 */
export function selectWatchlistForRound({ entries, recentRunIds = [], limit } = {}) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.active !== false);
  const rounds = Array.isArray(recentRunIds) ? recentRunIds : [];

  // รอบล่าสุดที่แต่ละ id เคยถูกใช้ (ไม่เคย = -1) — รอบหลังทับรอบก่อนเสมอ (recentRunIds เรียงเก่า→ใหม่)
  const lastRoundOf = new Map();
  rounds.forEach((round, ri) => {
    for (const id of Array.isArray(round) ? round : []) lastRoundOf.set(id, ri);
  });

  const n = list.length;
  const rawLimit = Math.trunc(Number(limit));
  const cap = Math.max(0, Math.min(n, Number.isFinite(rawLimit) ? rawLimit : 0));

  const ranked = list
    .map((entry, idx) => ({
      entry,
      idx,
      lastRound: lastRoundOf.has(entry.id) ? lastRoundOf.get(entry.id) : -1,
    }))
    .sort((a, b) => (a.lastRound !== b.lastRound ? a.lastRound - b.lastRound : a.idx - b.idx));

  return ranked.slice(0, cap).map((r) => r.entry);
}

// ── ตัวช่วยภายใน: จับ "คำเต็ม" ไม่ใช่ substring ในคำยาวกว่า ──
// Thai ไม่มีตัวแบ่งคำแบบ \b ใช้ได้ตรง (JS \w ไม่รวมอักษรไทย) — เช็ค boundary เองด้วยชุดอักขระ "คำ" (ไทย+ละติน+ตัวเลข)
function isWordChar(ch) {
  return !!ch && /[A-Za-z0-9฀-๿]/.test(ch);
}
function indexOfWholeWord(haystack, needle, fromIndex = 0) {
  if (!haystack || !needle) return -1;
  let start = fromIndex;
  while (start <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, start);
    if (idx === -1) return -1;
    const before = idx > 0 ? haystack[idx - 1] : '';
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : '';
    if (!isWordChar(before) && !isWordChar(after)) return idx;
    start = idx + 1; // เจอแต่ไม่ใช่คำเต็ม (ฝังในคำยาวกว่า) → เลื่อนหาต่อ ไม่ยอมแพ้ทั้งสตริง
  }
  return -1;
}

const MAX_INDEX_ITEMS = 200; // กันคลัง watchlist โตเกินในอนาคต (27+2 ปัจจุบัน ห่างไกลเพดานนี้มาก)

/**
 * buildWatchlistIndex — สร้างโครงค้นเร็วจาก entries (name+aliases ทุกตัว) ให้ matchWatchlistNames ใช้ซ้ำได้
 * @param {Array<object>} entries WatchEntry[]
 * @returns {{items: Array<{entryId:string, name:string, matchText:string}>}}
 */
export function buildWatchlistIndex(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const items = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const entryId = sanitizeText(e.id, 40);
    const canonicalName = sanitizeText(e.name, MAX_NAME_LEN);
    if (!entryId || !canonicalName) continue;
    const aliasList = Array.isArray(e.aliases) ? e.aliases : [];
    const matchTexts = [canonicalName, ...aliasList.map((a) => sanitizeText(a, MAX_NAME_LEN))].filter(Boolean);
    for (const matchText of matchTexts) {
      items.push({ entryId, name: canonicalName, matchText });
    }
  }
  // เรียงข้อความจับคู่ยาว→สั้นก่อน (ชื่อยาวเจาะจงกว่าควรถูกลองก่อน) + entryId กันสลับลำดับไม่นิ่ง
  items.sort((a, b) => b.matchText.length - a.matchText.length || a.entryId.localeCompare(b.entryId));
  return Object.freeze({ items: Object.freeze(items.slice(0, MAX_INDEX_ITEMS)) });
}

/**
 * matchWatchlistNames — หาชื่อ/alias ใน watchlist ที่โผล่ใน text แบบ "คำเต็ม" เท่านั้น (ไม่ใช่ substring มั่ว)
 * @param {string} text
 * @param {{items: Array<{entryId:string,name:string,matchText:string}>}} index จาก buildWatchlistIndex()
 * @returns {Array<{entryId:string, name:string, matched:true}>} NameEvidence[] (unique ต่อ entryId, มีเพดาน)
 */
export function matchWatchlistNames(text, index) {
  const t = sanitizeText(text, 4000);
  const items = index && Array.isArray(index.items) ? index.items : [];
  const out = [];
  const seenEntry = new Set();
  if (!t) return out;
  for (const { entryId, name, matchText } of items) {
    if (seenEntry.has(entryId)) continue;
    if (indexOfWholeWord(t, matchText) === -1) continue;
    seenEntry.add(entryId);
    out.push({ entryId, name, matched: true });
    if (out.length >= MAX_INDEX_ITEMS) break;
  }
  return out;
}

function pushMaybe(target, value, maxLen) {
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = sanitizeText(v, maxLen);
      if (s) target.push(s);
    }
  } else if (typeof value === 'string') {
    const s = sanitizeText(value, maxLen);
    if (s) target.push(s);
  }
}

function dedupCap(list, capLen) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= capLen) break;
  }
  return out;
}

const MAX_STAFF_HINTS = 40;

/**
 * deriveStaffSignals — เก็บ "คน/รายการ" ที่พนักงานเจอมาแล้ว (best-effort, ทน field หาย/รูปแบบไม่ตรง)
 * ไม่ throw แม้ input ว่าง/รูปร่างแปลก — ใช้เสริม watchlist seed เท่านั้น ไม่ใช่แหล่งยืนยันตัวตน
 * @param {object} input
 * @param {Array<object>} [input.clipInsights=[]]
 * @param {Array<object>} [input.topicHunts=[]]
 * @returns {{peopleHints:string[], programHints:string[]}}
 */
export function deriveStaffSignals({ clipInsights, topicHunts } = {}) {
  const people = [];
  const programs = [];

  for (const item of Array.isArray(clipInsights) ? clipInsights : []) {
    if (!item || typeof item !== 'object') continue;
    pushMaybe(people, item.people, MAX_NAME_LEN);
    pushMaybe(people, item.speakers, MAX_NAME_LEN);
    pushMaybe(people, item.personName, MAX_NAME_LEN);
    pushMaybe(programs, item.program, MAX_NAME_LEN);
    pushMaybe(programs, item.programName, MAX_NAME_LEN);
    const insight = item.insight && typeof item.insight === 'object' ? item.insight : null;
    if (insight) {
      pushMaybe(people, insight.people, MAX_NAME_LEN);
      pushMaybe(people, insight.speakers, MAX_NAME_LEN);
      pushMaybe(programs, insight.program, MAX_NAME_LEN);
      pushMaybe(programs, insight.programName, MAX_NAME_LEN);
    }
  }

  for (const item of Array.isArray(topicHunts) ? topicHunts : []) {
    if (!item || typeof item !== 'object') continue;
    pushMaybe(people, item.people, MAX_NAME_LEN);
    pushMaybe(people, item.entities, MAX_NAME_LEN);
    pushMaybe(programs, item.programs, MAX_NAME_LEN);
  }

  return {
    peopleHints: dedupCap(people, MAX_STAFF_HINTS),
    programHints: dedupCap(programs, MAX_STAFF_HINTS),
  };
}
