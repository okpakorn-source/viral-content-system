/**
 * =====================================================
 * 🎙️ Research Interview Lane (โต๊ะข่าวกลาง v2, เฟส 6 — 19 ก.ค. 69)
 * =====================================================
 * แผนคำค้นเลนสัมภาษณ์ (bucket:'people', lane:'interview') + ตัวจัดประเภทผลลัพธ์ + ตัวยืนยันชื่อ
 * 🔴 pure JS + import ได้เฉพาะ sanitizeText จาก ./dnaContract.js เท่านั้น
 * 🔴 ห้ามพึ่งพาตัวช่วยเก็บข้อมูลถาวร (persist-store) / ค่าย AI ภายนอกทุกชนิด (เรียกโมเดลภาษา/จัดเส้นทางโมเดล/
 *    ขุดบทสัมภาษณ์อัตโนมัติ) ห้าม namespace-import ทั้งโมดูล (import ทุกอย่างจากไฟล์เดียว) ห้าม network/fs
 * 🔴 ห้ามใช้เวลาปัจจุบันของระบบหรือค่าสุ่มเป็นเมล็ดพันธุ์ — deterministic ล้วน (runSeed เป็น string, hash เองภายใน)
 *
 * 🔴🔴 หัวใจของไฟล์นี้ = "ห้ามเดาชื่อ/สรรพนามระบุเพศ" (กฎเหล็กทั้งโปรเจกต์ ผิดไม่ได้)
 *   - query ที่ planInterviewQueries สร้าง มี expectedName = ชื่อที่ "คาดว่า" มาจากคำค้น ไม่ใช่หลักฐาน
 *   - classifyInterviewCandidate เริ่มทุกใบด้วย nameStatus จาก confirmObservedName เท่านั้น
 *     (ไม่มีหลักฐาน exact ใน title/snippet/speakers/transcript → ตกไปที่ 'expected' หรือ 'unknown'
 *      ไม่เคยเดาว่า "เป็นใคร" เอง)
 *   - ห้ามสร้างคำสรรพนามระบุเพศจากชื่อ (ไม่มี logic เดาเพศจากชื่อที่ไหนในไฟล์นี้เลย)
 *   - observedName ต้องเป็นข้อความที่ "สไลซ์มาจากแหล่งจริง" (title/snippet/speaker/transcript)
 *     ไม่ใช่แค่ echo expectedName กลับไป — แม้ผลจะเท่ากันเพราะ exact match แต่ที่มาไม่เดา
 */

import { sanitizeText } from './dnaContract.js';

// ── constants (ตามสเปกเป๊ะ — ห้ามเปลี่ยนชื่อ/ค่า) ──
export const OPENERS = Object.freeze([
  Object.freeze({ text: 'เผย', weight: 31 }),
  Object.freeze({ text: 'เปิดใจ', weight: 12 }),
]);
export const SECONDARY = Object.freeze([
  Object.freeze({ text: 'ควง', weight: 2 }),
  Object.freeze({ text: 'แฉ', weight: 1 }),
]);
export const ANGLES = Object.freeze([
  Object.freeze({ text: 'น้ำตา', weight: 6 }),
  Object.freeze({ text: 'มรสุม' }),
  Object.freeze({ text: 'จุดเปลี่ยน' }),
  Object.freeze({ text: 'เบื้องหลัง' }),
  Object.freeze({ text: 'เรื่องเศร้าที่สุด' }),
  Object.freeze({ text: 'บทเรียนชีวิต' }),
  Object.freeze({ text: 'เคยลำบาก' }),
]);

const DEFAULT_VARIANTS_PER_PERSON = 2;
const DEFAULT_MAX_CALLS = 40;
const HARD_CAP_CALLS = 500; // เพดานแข็ง กัน maxCalls ที่ผู้เรียกส่งมาเกินจริง
const MAX_PROGRAM_PAIR_PEOPLE = 3; // 1 รายการ ผูกกับคนไม่เกินกี่คน (กัน Cartesian ระเบิด)
const MAX_QUERY_TEXT_LEN = 140;

// ════════════════════════════════════════════════════
// ตัวช่วยภายใน — deterministic ล้วน (ห้ามใช้ค่าสุ่ม/เวลาปัจจุบันเป็นเมล็ดพันธุ์)
// ════════════════════════════════════════════════════

/** FNV-1a 32-bit — hash string → uint (ใช้เลือกแบบถ่วงน้ำหนักจาก runSeed แทนค่าสุ่มจริง) */
function hashSeedString(input) {
  const s = String(input ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** เลือก 1 รายการจาก bank ({text,weight}[]) แบบถ่วงน้ำหนัก deterministic ตาม seedKey (weight ไม่ระบุ = 1) */
function pickWeighted(bank, seedKey) {
  const items = Array.isArray(bank) ? bank : [];
  if (!items.length) return null;
  const weights = items.map((it) => (Number(it.weight) > 0 ? Number(it.weight) : 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const roll = hashSeedString(seedKey) % total;
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weights[i];
    if (roll < acc) return items[i];
  }
  return items[items.length - 1];
}

function personLabel(p) {
  if (typeof p === 'string') return sanitizeText(p, 80);
  if (p && typeof p === 'object') return sanitizeText(p.name, 80);
  return '';
}
function personKeyOf(p, fallbackIndex) {
  if (p && typeof p === 'object' && p.id) return sanitizeText(p.id, 40);
  const label = personLabel(p);
  return label ? `n:${label}` : `idx:${fallbackIndex}`;
}
function cleanOrNull(v, max) {
  const s = sanitizeText(v, max);
  return s || null;
}

// ════════════════════════════════════════════════════
// 1) planInterviewQueries
// ════════════════════════════════════════════════════
/**
 * @typedef {object} QueryPlanV2Interview
 * @property {string} id
 * @property {string} text            คำค้น sanitize แล้ว (unique ทั้งแผน)
 * @property {'people'} bucket
 * @property {'interview'} lane
 * @property {number} weight
 * @property {null} preset
 * @property {null} clusterId
 * @property {string|null} targetChannel  ช่องเป้าหมายของคำค้นใบนี้ (null ถ้าไม่ส่ง channels มา)
 * @property {string} expectedName    ชื่อที่ "คาดว่า" มาจาก query นี้ — ไม่ใช่หลักฐานยืนยันตัวตน
 * @property {string|null} program
 * @property {string} opener
 * @property {string} angle
 *
 * @param {object} input
 * @param {Array<string|{id?:string,name:string}>} [input.people=[]]
 * @param {Array<string|{id?:string,name:string}>} [input.programs=[]]
 * @param {string[]} [input.channels=[]]  ไม่ส่ง → ได้ query ชุดเดียวต่อ (คน,variant) โดย targetChannel=null
 * @param {number} [input.variantsPerPerson=2]  สูตรต่อคน (>=2 ตัวแรกใช้ OPENERS ที่เหลือใช้ SECONDARY)
 * @param {number} [input.maxCalls=40]   เพดานรวมทั้งแผน (people×variants×channels + program calls ≤ นี้)
 * @param {string} [input.runSeed='']
 * @returns {QueryPlanV2Interview[]} deterministic ล้วน, ไม่สร้าง Cartesian เต็มก่อนตัด (หยุดทันทีที่ถึงเพดาน)
 */
export function planInterviewQueries({
  people = [],
  programs = [],
  channels = [],
  variantsPerPerson = DEFAULT_VARIANTS_PER_PERSON,
  maxCalls = DEFAULT_MAX_CALLS,
  runSeed = '',
} = {}) {
  const peopleList = Array.isArray(people) ? people : [];
  const programList = Array.isArray(programs) ? programs : [];
  const cleanChannels = (Array.isArray(channels) ? channels : [])
    .map((c) => sanitizeText(c, 30))
    .filter(Boolean);
  const chans = cleanChannels.length ? cleanChannels : [null];

  const rawVariants = Math.trunc(Number(variantsPerPerson));
  const variants = Number.isFinite(rawVariants) && rawVariants > 0 ? rawVariants : DEFAULT_VARIANTS_PER_PERSON;
  const rawCap = Math.trunc(Number(maxCalls));
  const cap = Math.min(HARD_CAP_CALLS, Math.max(0, Number.isFinite(rawCap) ? rawCap : 0));

  const results = [];
  const seedBase = sanitizeText(runSeed, 60);
  const usedTexts = new Set();
  let seq = 0;

  function emit({ text, expectedName, program, opener, angle, targetChannel }) {
    results.push({
      id: `interview-${seq++}`,
      text: sanitizeText(text, MAX_QUERY_TEXT_LEN),
      bucket: 'people',
      lane: 'interview',
      weight: 25,
      preset: null,
      clusterId: null,
      targetChannel: targetChannel ?? null,
      expectedName,
      program: program || null,
      opener,
      angle,
    });
  }

  // ── ก้อนที่ 1: person queries เดี่ยว — people × variants × channels (มีเพดาน) ──
  personLoop:
  for (let pi = 0; pi < peopleList.length; pi++) {
    const name = personLabel(peopleList[pi]);
    if (!name) continue;
    const pKey = personKeyOf(peopleList[pi], pi);

    for (let v = 0; v < variants; v++) {
      const useSecondary = v >= OPENERS.length;
      const bank = useSecondary ? SECONDARY : OPENERS;
      const laneTag = useSecondary ? 'secondary' : 'opener';
      const openerPick = pickWeighted(bank, `${seedBase}|${laneTag}|${pKey}|${v}`) || bank[0];
      let anglePick = pickWeighted(ANGLES, `${seedBase}|angle|${pKey}|${v}`) || ANGLES[0];

      // กันข้อความชนกัน (opener+angle ซ้ำของคนเดิม) — เลื่อน angle แบบ deterministic ไม่เกินจำนวน ANGLES
      let attempt = 0;
      let dupKey = `${pKey}|${openerPick.text}|${anglePick.text}`;
      while (usedTexts.has(dupKey) && attempt < ANGLES.length) {
        attempt++;
        anglePick = pickWeighted(ANGLES, `${seedBase}|angle|${pKey}|${v}|retry${attempt}`) || ANGLES[0];
        dupKey = `${pKey}|${openerPick.text}|${anglePick.text}`;
      }
      usedTexts.add(dupKey);

      const text = `"${name}" ${openerPick.text} ${anglePick.text}`;
      for (const ch of chans) {
        if (results.length >= cap) break personLoop;
        emit({ text, expectedName: name, program: null, opener: openerPick.text, angle: anglePick.text, targetChannel: ch });
      }
    }
  }

  // ── ก้อนที่ 2: program calls — แยกงบจากก้อนที่ 1 (โปรแกรม × คนบางส่วน × channels, มีเพดานคนต่อรายการ) ──
  programLoop:
  for (let gi = 0; gi < programList.length; gi++) {
    const program = personLabel(programList[gi]);
    if (!program) continue;
    const pairCount = Math.min(peopleList.length, MAX_PROGRAM_PAIR_PEOPLE);

    for (let pi = 0; pi < pairCount; pi++) {
      const name = personLabel(peopleList[pi]);
      if (!name) continue;
      const pKey = personKeyOf(peopleList[pi], pi);
      const openerPick = pickWeighted(OPENERS, `${seedBase}|prog-opener|${program}|${pKey}`) || OPENERS[0];
      const anglePick = pickWeighted(ANGLES, `${seedBase}|prog-angle|${program}|${pKey}`) || ANGLES[0];
      const text = `"${program}" "${name}" ${openerPick.text} ${anglePick.text}`;

      for (const ch of chans) {
        if (results.length >= cap) break programLoop;
        emit({ text, expectedName: name, program, opener: openerPick.text, angle: anglePick.text, targetChannel: ch });
      }
    }
  }

  return results;
}

// ════════════════════════════════════════════════════
// 2) confirmObservedName — 🔴 หัวใจกฎห้ามเดาชื่อ
// ════════════════════════════════════════════════════

// Thai ไม่มี \b ใช้ได้ตรง (JS \w ไม่รวมอักษรไทย) — เช็ค boundary เองด้วยชุดอักขระ "คำ" (ไทย+ละติน+ตัวเลข)
function isWordChar(ch) {
  return !!ch && /[A-Za-z0-9฀-๿]/.test(ch);
}
/** หา needle แบบ "คำเต็ม" ใน haystack แล้วคืน "ข้อความจริงที่พบ" (สไลซ์จาก haystack ไม่ใช่ echo needle) */
function findExactPhrase(haystack, needle) {
  if (!haystack || !needle) return null;
  let start = 0;
  while (start <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, start);
    if (idx === -1) return null;
    const before = idx > 0 ? haystack[idx - 1] : '';
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : '';
    if (!isWordChar(before) && !isWordChar(after)) return haystack.slice(idx, idx + needle.length);
    start = idx + 1;
  }
  return null;
}

const MAX_SPEAKERS = 20;
const MAX_TITLE_LEN = 300;
const MAX_SNIPPET_LEN = 600;
const MAX_TRANSCRIPT_LEN = 4000;

/**
 * confirmObservedName — ยืนยันชื่อจากหลักฐานจริงเท่านั้น (title→snippet→speakers→transcript ตามลำดับ)
 * 🔴 ไม่เคยเดา: ไม่มีหลักฐาน exact แต่มีเนื้อหาอื่น (เช่น headline ทั่วไป) → 'expected' (ไม่ใช่ 'matched')
 * 🔴 ไม่มีเนื้อหาให้ตรวจเลยสักฟิลด์ → 'unknown'
 * 🔴 ไม่มี logic เดาเพศ/สร้างสรรพนามจากชื่อในฟังก์ชันนี้เลย — observedName มาจากการสไลซ์ข้อความจริงเท่านั้น
 * @param {object} input
 * @param {string} input.expectedName
 * @param {string} [input.title]
 * @param {string} [input.snippet]
 * @param {string[]} [input.speakers]
 * @param {string} [input.transcript]
 * @returns {{observedName:string|null, nameStatus:'matched'|'expected'|'unknown', nameEvidence:'title'|'snippet'|'speaker'|'transcript'|null}}
 */
export function confirmObservedName({ expectedName, title, snippet, speakers, transcript, needsContext = false } = {}) {
  const name = sanitizeText(expectedName, 80);
  if (!name) return { observedName: null, nameStatus: 'unknown', nameEvidence: null };

  const cleanTitle = sanitizeText(title, MAX_TITLE_LEN);
  const cleanSnippet = sanitizeText(snippet, MAX_SNIPPET_LEN);
  const cleanTranscript = sanitizeText(transcript, MAX_TRANSCRIPT_LEN);
  const speakerList = (Array.isArray(speakers) ? speakers : [])
    .map((s) => sanitizeText(s, 120))
    .filter(Boolean)
    .slice(0, MAX_SPEAKERS);

  // 🔒 F2 (Fable audit): ชื่อกำกวม (needsContext=true เช่น 'คิว') — หัวข้อ/snippet ที่มีสตริงชื่อ "ยังไม่พอยืนยันตัวตน"
  //   (คำสั้นโผล่ในหัวข้อของใครก็ได้) → ต้องมีหลักฐานแข็งกว่า (speaker ผู้พูด / transcript) จึงจะ matched; ไม่งั้นตกไป expected
  const inTitle = findExactPhrase(cleanTitle, name);
  if (inTitle && !needsContext) return { observedName: inTitle, nameStatus: 'matched', nameEvidence: 'title' };

  const inSnippet = findExactPhrase(cleanSnippet, name);
  if (inSnippet && !needsContext) return { observedName: inSnippet, nameStatus: 'matched', nameEvidence: 'snippet' };

  for (const sp of speakerList) {
    const hit = findExactPhrase(sp, name);
    if (hit) return { observedName: hit, nameStatus: 'matched', nameEvidence: 'speaker' };
  }

  const inTranscript = findExactPhrase(cleanTranscript, name);
  if (inTranscript) return { observedName: inTranscript, nameStatus: 'matched', nameEvidence: 'transcript' };

  const hasAnyContent = !!(cleanTitle || cleanSnippet || speakerList.length || cleanTranscript);
  if (hasAnyContent) return { observedName: null, nameStatus: 'expected', nameEvidence: null };
  return { observedName: null, nameStatus: 'unknown', nameEvidence: null };
}

// ════════════════════════════════════════════════════
// 3) classifyInterviewCandidate
// ════════════════════════════════════════════════════
/**
 * classifyInterviewCandidate — แปะ field `interview` ลง candidate (ไม่ mutate input, คืน object ใหม่)
 * nameStatus/observedName/nameEvidence มาจาก confirmObservedName เท่านั้น (ไม่มี default เดาเอง)
 * @param {object} candidate  ผลค้นดิบ (title/snippet/speakers/transcript เผื่อมี — ทนฟิลด์หาย)
 * @param {object} queryPlan  QueryPlanV2Interview จาก planInterviewQueries (หรือ shape ใกล้เคียง)
 * @returns {object} candidate เดิม + { interview: {expectedName,observedName,nameStatus,nameEvidence,program,opener,angle,queryId} }
 */
export function classifyInterviewCandidate(candidate, queryPlan) {
  const base = candidate && typeof candidate === 'object' ? candidate : {};
  const q = queryPlan && typeof queryPlan === 'object' ? queryPlan : {};
  const expectedName = sanitizeText(q.expectedName, 80);

  // ทนฟิลด์หาย: รับทั้งฟิลด์ตรงระดับบนและใน insight ซ้อน (รูปแบบผลถอดคลิปอาจต่างกัน)
  const insight = base.insight && typeof base.insight === 'object' ? base.insight : null;
  const confirmed = confirmObservedName({
    expectedName,
    title: base.title,
    snippet: base.snippet,
    speakers: base.speakers || (insight && insight.speakers),
    transcript: base.transcript || (insight && insight.transcript),
    needsContext: !!q.needsContext, // 🔒 F2 (Fable audit): ชื่อกำกวม (คิว/พี่ช้าง/ป๋ากิ๊ก) ต้องมีหลักฐานแข็งกว่าหัวข้อ
  });

  return {
    ...base,
    interview: {
      expectedName: expectedName || null,
      observedName: confirmed.observedName,
      nameStatus: confirmed.nameStatus,
      nameEvidence: confirmed.nameEvidence,
      program: cleanOrNull(q.program, 80),
      opener: cleanOrNull(q.opener, 20),
      angle: cleanOrNull(q.angle, 30),
      queryId: cleanOrNull(q.id, 40),
    },
  };
}

// ════════════════════════════════════════════════════
// 4) confirmTranscriptHighlights (เฟส 7) — ยืนยันไฮไลต์จาก transcript จริง
// ════════════════════════════════════════════════════
/** รวบ whitespace หลายตัว → เว้นวรรคเดียว + trim (ให้ quote เทียบ substring ได้เสถียร) */
function normalizeWs(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
/**
 * 🔴 ไม่มี AI / ไม่ใช้ keyQuote สังเคราะห์ — quote ทุกอันต้องเป็น "substring ของ transcript หลัง normalize whitespace"
 *   (สไลซ์จากข้อความจริงเท่านั้น). ก่อนมี transcript ผู้เรียกตั้ง status='estimated'; ไม่มี transcript = 'unavailable'
 * @param {object} input
 * @param {string} input.rawText  - transcript ดิบ (extract.raw)
 * @param {string[]} [input.signals] - คำสัญญาณ (opener/angle จากเลนสัมภาษณ์)
 * @param {string[]} [input.names]   - ชื่อที่คาด/ที่ยืนยันแล้ว
 * @returns {{status:'confirmed'|'not_found'|'unavailable', signals:string[], evidence:Array<{quote,source:'transcript',matchedBy}>}}
 */
export function confirmTranscriptHighlights({ rawText, signals = [], names = [] } = {}) {
  const text = normalizeWs(rawText);
  if (!text) return { status: 'unavailable', signals: [], evidence: [] }; // ยังไม่มี transcript (FB/IG ยังไม่ถอด ฯลฯ)

  const needles = [
    ...(Array.isArray(names) ? names : []).map((n) => ({ v: normalizeWs(sanitizeText(n, 80)), by: 'name' })),
    ...(Array.isArray(signals) ? signals : []).map((s) => ({ v: normalizeWs(sanitizeText(s, 40)), by: 'signal' })),
  ].filter((x) => x.v);

  const foundSignals = [];
  const evidence = [];
  const seen = new Set();
  for (const n of needles) {
    const idx = text.indexOf(n.v);
    if (idx === -1) continue; // 🔴 ไม่พบ = ไม่ยืนยัน (ไม่เดา)
    if (!seen.has(n.v)) { foundSignals.push(n.v); seen.add(n.v); }
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + n.v.length + 40);
    evidence.push({ quote: text.slice(start, end), source: 'transcript', matchedBy: n.by }); // quote = substring จริง
    if (evidence.length >= 8) break;
  }
  return { status: evidence.length ? 'confirmed' : 'not_found', signals: foundSignals.slice(0, 10), evidence };
}
