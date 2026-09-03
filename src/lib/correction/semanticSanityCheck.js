/**
 * Layer 4.6 — Semantic Sanity Check
 * 
 * ตรวจจับ "ประโยคไร้ความหมาย" ที่เกิดจาก LLM Token Prediction Error
 * เช่น: "อบอุ่นขึ้นไปอีกระเสียชีวิต" (ไม่มีความหมาย)
 * 
 * ใช้ GPT-4o-mini ตรวจ (~0.5s/version, ~0.007 บาท/version)
 * 
 * Safety rules:
 * - ถ้า AI call fail → ข้าม (return original content)
 * - ถ้าพบปัญหา → ลบประโยคนั้นออก (safe removal)
 * - ไม่แก้ fact, ชื่อ, ตัวเลข — แค่ลบส่วนที่ไร้ความหมาย
 */

import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';
import { callClaude, isClaudeAvailable } from '@/lib/ai/claudeClient'; // ★ 1 ส.ค. 69: ชั้นตัดสิน/ตัดประโยคจริง → opus-5 ก่อน

const SANITY_CHECK_PROMPT = `คุณเป็นบรรณาธิการภาษาไทยระดับสูง ตรวจสอบเนื้อหาด้านล่างว่ามี "ประโยคที่ไร้ความหมาย" หรือ "คำผิดร้ายแรง" หรือไม่

ตัวอย่างปัญหาที่ต้องจับ:
- คำที่ติดกันแล้วอ่านไม่รู้เรื่อง เช่น "อบอุ่นขึ้นไปอีกระเสียชีวิต" (ไม่มีความหมาย)
- คำที่ขัดแย้งกันในประโยคเดียว เช่น "ยิ้มอย่างมีความสุขกับความตาย"
- ประโยคที่ grammar เพี้ยนจนอ่านไม่เข้าใจ
- คำที่ถูกตัดครึ่งหรือเชื่อมกับคำอื่นจนไร้ความหมาย

สิ่งที่ไม่ถือว่าผิด (ห้ามแจ้ง):
- สำนวนไทย เช่น "ใจหาย" "ใจสลาย" "น้ำตาไหล"
- ภาษาพูดทั่วไป เช่น "โคตรเศร้า" "แรงมาก"
- อารมณ์ dramatic แต่ยังอ่านรู้เรื่อง

=== เนื้อหาที่ต้องตรวจ ===
{CONTENT}
=== จบเนื้อหา ===

ตอบเป็น JSON:
{
  "hasIssues": true/false,
  "issues": [
    {
      "brokenText": "ข้อความที่มีปัญหา (copy ตรงจากเนื้อหา)",
      "reason": "เหตุผลสั้นๆ ว่าทำไมมันผิด",
      "severity": "high/medium"
    }
  ]
}

ถ้าไม่พบปัญหา: { "hasIssues": false, "issues": [] }`;

// ═══ ★ 14 ส.ค. 69 — Seam Guard (เจ้าของสั่ง "ทำเลย ระมัดระวังที่สุด" · สเปก Sol 9.1/10 ใน sol-seam-verdict.md) ═══
// หลัก "ถ้าเย็บไม่ได้ อย่าผ่า": เดิมลบวลีพังแล้วทิ้งรอยต่อ (เคสจริง #03995 เครื่องหมายคำพูดกำพร้า / #03997 เปิดเรื่องด้วย "แต่...")
// (1) วลีพังแตะประโยคเปิด → no-op ทั้งก้อน คืน input ไบต์ต่อไบต์ (ตรวจก่อน commit ทุก issue — กัน partial edit)
// (2) การลบที่จะสร้างคำเชื่อมกำพร้าหัวย่อหน้า/ทำเครื่องหมายคำพูดเสียคู่ → ยกเลิกการลบ issue นั้น (ห้ามลบเพิ่มเพื่อซ่อม)

// ลิสต์ "ตรวจแล้วไม่ commit" — กว้างได้เพราะ false positive = คงข้อความเดิม (Sol ห้ามใช้ replace เด็ดขาด)
const UNSAFE_BLOCK_PREFIX_RE = /^[ \t]*(?:แต่|และ|ซึ่ง|จึง|ส่วน|ก็|แล้ว|เพราะ|โดย)/u;

// ภาษาไทยไม่มีตัวจบประโยคที่เชื่อถือได้ทุกเคส: ใช้ ? ! … 。 หรือบรรทัดว่างเป็นขอบแข็ง · ไม่พบ = คุ้มครองทั้งบล็อกเปิด
const OPENING_HARD_BOUNDARY_RE = /(?:[!?！？。…]+(?=\s|$)|\n[ \t]*\n)/u;

function getOpeningRange(text) {
  const start = text.search(/\S/u);
  if (start < 0) return { start: 0, end: 0 };
  const hit = OPENING_HARD_BOUNDARY_RE.exec(text.slice(start));
  return { start, end: hit ? start + hit.index + hit[0].length : text.length };
}

function getParagraphStart(text, index) {
  const head = text.slice(0, index);
  let start = 0;
  for (const hit of head.matchAll(/\n[ \t]*\n/g)) {
    start = hit.index + hit[0].length;
  }
  return start;
}

function startsParagraph(text, index) {
  return !/\S/u.test(text.slice(getParagraphStart(text, index), index));
}

// นับเฉพาะ " และ smart quotes — จงใจไม่นับ apostrophe เดี่ยว (ชนชื่อ/ภาษาอังกฤษง่าย)
function quoteDebt(text) {
  let straightDouble = 0;
  let debt = 0;
  const stack = [];
  const closeFor = { '“': '”', '‘': '’' };
  for (const ch of text) {
    if (ch === '"') straightDouble += 1;
    else if (ch === '“' || ch === '‘') stack.push(ch);
    else if (ch === '”' || ch === '’') {
      if (stack.length > 0 && closeFor[stack.at(-1)] === ch) stack.pop();
      else debt += 1;
    }
  }
  return debt + stack.length + (straightDouble % 2);
}

/**
 * ตรวจเนื้อหา 1 version ด้วย AI
 * @param {string} content - เนื้อหาที่จะตรวจ
 * @returns {{ sanitizedContent: string, issuesFound: Array, fixed: boolean }}
 */
// ═══ ★ 2 ก.ย. 69 — Fact-bearing Guard (เทสสนามจริงเคส #05234 ศรราม/ป๋าเดียร์) ═══
// ด่านนี้ "ลบทั้งประโยค" เมื่อ AI ชี้ว่าสำนวนพัง → เคสจริง: ตัวสำรอง (luna) ชี้ประโยค "พ่อยังเป็นห่วงเรื่องการขับรถ…"
// ว่าไม่สมบูรณ์ แล้วลบทิ้ง = ข้อเท็จจริงจากต้นฉบับหายเงียบ (FactCheck ท้ายท่อจับไม่ได้ เพราะเช็คแค่ของที่ยังอยู่)
// กติกา: ประโยคที่มีอักษรต่อเนื่องตรงกับเนื้อดิบ ≥ FACT_OVERLAP_MIN_CHARS = แบกข้อเท็จจริง → คงไว้ให้คนตรวจ (ห้ามลบ)
// ประโยคไร้ความหมายจริง (เช่น "อบอุ่นขึ้นไปอีกระเสียชีวิต") ไม่มีในต้นฉบับ → ยังลบได้เหมือนเดิม · ไม่ส่ง sourceBody = พฤติกรรมเดิม 100%
const FACT_OVERLAP_MIN_CHARS = 12;
const _normForOverlap = (s) => String(s || '').replace(/[\s"“”'‘’]+/g, '');
export function longestCommonRun(a, b) {
  let best = 0;
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(b.length + 1);
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      if (ca === b.charCodeAt(j - 1)) { const v = prev[j - 1] + 1; cur[j] = v; if (v > best) best = v; }
    }
    prev = cur;
  }
  return best;
}
export function sharesSourceFact(text, sourceBody) {
  const t = _normForOverlap(text);
  const s = _normForOverlap(sourceBody);
  if (t.length < FACT_OVERLAP_MIN_CHARS || s.length < FACT_OVERLAP_MIN_CHARS) return false;
  return longestCommonRun(t, s) >= FACT_OVERLAP_MIN_CHARS;
}

// ═══ ★ 3 ก.ย. 69 — Sentence Guard: ด่านกลไก "ห้ามทิ้งประโยคค้าง" หลังการลบ (SEMANTIC_FIX_SENTENCE_GUARD=0 ปิด = พฤติกรรมเดิมไบต์ต่อไบต์) ═══
// เคสจริง 2 ก.ย. 69 (#05243 จิ่งป๋อหราน · กรรมการให้ 26/50 ต่ำสุดเพราะจบค้าง): AI ชี้ลบท่อนท้ายเรื่อง
// "เคยกำข้าวของหนักเดินส่งน้ำเพื่อคุณย่า…" → เนื้อจบค้างกลางอากาศ "…พระเอกที่หลายคนไม่รู้ว่า"
// หลัก: ทุกการลบต้องทิ้ง "หน่วยประโยค" ที่อ่านจบได้ — ถ้ารอยลบทำให้หน่วยนั้นจบด้วยคำเชื่อม/คำที่ต้องมีส่วนขยาย
// หรือเหลือเศษสั้นผิดปกติ → ลบทั้งหน่วยแทน เฉพาะเมื่อพิสูจน์ได้ว่าไม่มีข้อเท็จจริงหาย (ตัวเลข/ชื่อ/คำพูดที่หน่วยอื่นไม่มี
// ไม่ตรงต้นฉบับ ไม่แตะประโยคเปิด ไม่สร้างรอยใหม่) — ไม่งั้นคืนเนื้อเดิมของประโยคนั้นทั้งก้อน (ยกเลิกการลบ = ห้ามแย่กว่าเดิม)

// คำที่จบหน่วยไม่ได้ — ต้องมีส่วนขยายตามหลังเสมอ (เรียงยาว→สั้นตอนใช้ · export ให้เทสตรวจตรง)
export const DANGLING_TAIL_WORDS = [
  'ไม่รู้ว่า', 'รู้ว่า', 'บอกว่า', 'กล่าวว่า', 'เผยว่า', 'ยอมรับว่า', 'เชื่อว่า', 'คิดว่า', 'พบว่า', 'ว่า',
  'ที่', 'ซึ่ง', 'และ', 'แต่', 'หรือ', 'เพื่อ', 'กับ', 'ของ', 'ให้', 'จน', 'เพราะ', 'ถ้า', 'หาก', 'แม้',
  'เมื่อ', 'โดย', 'จาก', 'ใน', 'ก็', 'จึง', 'คือ', 'ทั้ง', 'ระหว่าง', 'เช่น', 'ได้แก่', 'รวมถึง',
  'กลายเป็น', 'เนื่องจาก', 'หลังจาก',
];
// คำเต็มที่ "ลงท้ายพ้องรูป" กับคำข้างบนแต่จบประโยคได้ปกติ — เจอแล้วถือว่าไม่ค้าง (กัน false positive)
export const DANGLING_TAIL_EXCEPTIONS = [
  'กว่า',            // มากกว่า/ดีกว่า — ไม่ใช่ 'ว่า' ค้าง
  'ข้าวของ', 'สิ่งของ', 'เจ้าของ', // คำนามจบได้ — ไม่ใช่ 'ของ' ค้าง
  'ยากจน', 'คนจน',   // ไม่ใช่ 'จน' ค้าง
  'กำกับ',           // ผู้กำกับ — ไม่ใช่ 'กับ' ค้าง
  'ภายใน',           // ไม่ใช่ 'ใน' ค้าง
  'ลาจาก',           // ไม่ใช่ 'จาก' ค้าง
  'ทุกเมื่อ',         // ไม่ใช่ 'เมื่อ' ค้าง
];
const _DANGLING_SORTED = [...DANGLING_TAIL_WORDS].sort((a, b) => b.length - a.length);
const SENTENCE_REMNANT_MIN_CHARS = 15;      // หน่วยเหลือสั้นกว่านี้ (แต่ไม่ว่าง) = เศษ
const SENTENCE_GUARD_MAX_EXTRA_CHARS = 120; // เศษที่จะลบเพิ่มยาวเกินนี้ = เสี่ยงเกิน ห้ามลบ → คืนเนื้อเดิม
const SENTENCE_HARD_END_RE = /[!?！？。…]/u;  // เครื่องหมายจบประโยคแข็ง (ขอบหน่วย ร่วมนิยามกับ OPENING_HARD_BOUNDARY_RE)

/** ท้ายข้อความจบด้วยคำที่ต้องมีส่วนขยายไหม — คืนคำที่ค้าง หรือ null ถ้าจบได้ปกติ */
export function findDanglingTail(text) {
  const t = String(text || '').replace(/\s+$/u, '');
  if (!t) return null;
  if (/[!?！？。…"”'’)\]』」.]$/u.test(t)) return null; // จบด้วยเครื่องหมายจบ/ปิด = สมบูรณ์
  let hit = null;
  for (const w of _DANGLING_SORTED) if (t.endsWith(w)) { hit = w; break; }
  if (!hit) return null;
  // ไทยเขียนติดกัน คำพ้องท้ายชนกันได้สองทาง — ใช้กติกา "match ยาวสุดชนะ":
  // exception หักล้างได้เฉพาะเมื่อยาวกว่าคำค้างที่จับได้ (เช่น "มากกว่า"(กว่า)>ว่า → จบปกติ ·
  // แต่ "บอกว่า"(6) ชนะพ้องรูป "กว่า"(4) → ยังเป็นคำค้าง)
  for (const ex of DANGLING_TAIL_EXCEPTIONS) if (ex.length > hit.length && t.endsWith(ex)) return null;
  return hit;
}

// ตัวเลข (อารบิก/ไทย) และคำละติน (ชื่อคน/ชื่อเรื่อง) ใน fragment ที่ไม่เหลืออยู่ในเนื้อส่วนอื่น = ข้อเท็จจริงจะหาย
const _FACT_TOKEN_RE = /[0-9๐-๙][0-9๐-๙,.:]*|[A-Za-z][A-Za-z0-9.'’-]*/g;
function hasUniqueFactToken(fragment, remainingText) {
  for (const raw of String(fragment).match(_FACT_TOKEN_RE) || []) {
    const tok = raw.replace(/[,.:]+$/u, '');
    if (/^[A-Za-z]$/.test(tok)) continue; // อักษรละตินโดดตัวเดียวไม่นับเป็นชื่อ
    if (tok && !remainingText.includes(tok)) return true;
  }
  for (const m of String(fragment).matchAll(/["“]([^"“”]{3,120})["”]/g)) {
    if (!remainingText.includes(m[1])) return true; // คำพูดในเครื่องหมายคำพูดหายทั้งก้อน
  }
  return false;
}

/**
 * ตัดสินรอยลบหนึ่งจุด: หน่วยประโยคที่ครอบรอยลบใน candidate ยังอ่านจบได้ไหม
 * @returns {{action:'pass'}|{action:'revert',trigger,reason,remnantPreview}|{action:'extend',trigger,content,removedUnit,extraRemoved,remnantPreview}}
 */
function judgeSeamRemnant(before, candidate, seam, removedLen, sourceBody) {
  // ขอบหน่วย = ขึ้นบรรทัด หรือเครื่องหมายจบประโยคแข็ง (ภาษาไทยไม่มีจุดจบประโยคที่เชื่อถือได้ — ช่องว่างไม่ใช่ขอบ)
  let uStart = seam;
  while (uStart > 0) {
    const ch = candidate[uStart - 1];
    if (ch === '\n' || SENTENCE_HARD_END_RE.test(ch)) break;
    uStart--;
  }
  let uEnd = seam;
  while (uEnd < candidate.length) {
    const ch = candidate[uEnd];
    if (ch === '\n') break;
    uEnd++;
    if (SENTENCE_HARD_END_RE.test(ch)) break; // รวมเครื่องหมายจบไว้ในหน่วย
  }
  const tail = candidate.slice(uStart, seam);
  const right = candidate.slice(seam, uEnd);
  const remnant = (tail + right).trim();
  if (remnant.length === 0) return { action: 'pass' }; // ลบทั้งหน่วยพอดี = รอยสะอาด

  // ตรวจคำค้างเฉพาะเมื่อรอยลบชิดท้ายหน่วย (ท้ายใหม่ที่การลบเพิ่งสร้าง) — รอยกลางหน่วยเนื้อยังต่อกันเอง
  const danglingWord = right.search(/\S/u) < 0 ? findDanglingTail(tail) : null;
  const isFragment = remnant.length < SENTENCE_REMNANT_MIN_CHARS;
  if (!danglingWord && !isFragment) return { action: 'pass' };

  const trigger = danglingWord ? `dangling "${danglingWord}"` : `fragment (${remnant.length} chars)`;
  const remnantPreview = remnant.slice(-40);

  // ── ทางที่ 1: ลบทั้งหน่วยแทน — เฉพาะเมื่อพิสูจน์ได้ว่าปลอดภัยทุกข้อ ──
  const extStart = uStart;                 // พิกัดตรงกันใน before (ก่อน seam ไม่เลื่อน)
  const extEnd = uEnd + removedLen;        // พิกัด candidate → before (uEnd อยู่หลัง seam เสมอ)
  const extraText = tail + right;          // เนื้อที่จะหายเพิ่มจากการลบทั้งหน่วย
  const extCandidate = before.slice(0, extStart) + before.slice(extEnd);
  const opening = getOpeningRange(before);
  let blocked = null;
  if (extraText.trim().length > SENTENCE_GUARD_MAX_EXTRA_CHARS) blocked = 'unit-too-long';
  else if (extStart < opening.end && extEnd > opening.start) blocked = 'opening-sentence';
  else if (hasUniqueFactToken(extraText, extCandidate)) blocked = 'unique-fact-in-remnant';
  else if (sourceBody && sharesSourceFact(extraText, sourceBody)) blocked = 'remnant-matches-source';
  else if (startsParagraph(before, extStart) && UNSAFE_BLOCK_PREFIX_RE.test(extCandidate.slice(extStart))) blocked = 'orphan-prefix';
  else if (quoteDebt(extCandidate) > quoteDebt(before)) blocked = 'quote-pair';

  // ── ทางที่ 2 (fail-safe): คืนเนื้อเดิมของประโยคนั้น = ยกเลิกการลบทั้ง issue ──
  if (blocked) return { action: 'revert', trigger, reason: blocked, remnantPreview };
  return {
    action: 'extend', trigger, content: extCandidate,
    removedUnit: before.slice(extStart, extEnd), extraRemoved: extraText.trim(), remnantPreview,
  };
}

export async function semanticSanityCheck(content, { sourceBody = null } = {}) {
  if (!content || content.length < 50) {
    return { sanitizedContent: content, issuesFound: [], fixed: false };
  }

  try {
    const prompt = SANITY_CHECK_PROMPT.replace('{CONTENT}', content);

    // ★ 1 ส.ค. 69 (เจ้าของสั่ง "GPT ที่แตะภาษาตรง → opus5"): ชั้นนี้ชี้ประโยคที่จะถูกตัดจริง → claude-opus-5 ก่อน · ล้ม/ไม่มีคีย์ → luna เดิม
    let result;
    let usedFallback = false;
    try {
      if (!isClaudeAvailable()) throw new Error('no-claude-key');
      result = await callClaude({ model: 'claude-opus-5', maxTokens: 800, prompt });
    } catch (_clErr) {
      // ★ 2 ก.ย. 69: เดิมถอยเงียบ (เทสสนามจริง: Claude ล้มโดยไม่มีร่องรอยในล็อก) → บอกสาเหตุ + ติดธงให้กล่องดำ
      usedFallback = true;
      console.warn(`  L4.6 Semantic: Claude ล้ม → ถอยใช้ ${MODEL_FAST} (${_clErr?.message || _clErr})`);
      result = await callAI({ model: MODEL_FAST, temperature: 0.1, maxTokens: 500, prompt });
    }

    if (!result || !result.hasIssues || !Array.isArray(result.issues) || result.issues.length === 0) {
      return { sanitizedContent: content, issuesFound: [], fixed: false, usedFallback };
    }

    // ★ Seam Guard ขั้น 1 (atomic): ตรวจทุก issue ก่อน commit ใดๆ — เคส #03995 issue เปิดเรื่องมาเป็นลำดับสอง
    //   ถ้าลบไปทีละอันจะ partial-edit ก่อนเจอด่าน · แตะประโยคเปิด = no-op ทั้งก้อน คืน input ไบต์ต่อไบต์
    const applicableIssues = result.issues
      .filter((issue) => typeof issue?.brokenText === 'string' && issue.brokenText.length >= 5)
      .map((issue) => ({ issue, at: content.indexOf(issue.brokenText) }))
      .filter(({ at }) => at >= 0);

    const opening = getOpeningRange(content);
    const touchesOpening = applicableIssues.some(({ issue, at }) =>
      at < opening.end && at + issue.brokenText.length > opening.start);

    if (touchesOpening) {
      console.warn('  L4.6 Semantic Guard: opening deletion blocked — kept input');
      return { sanitizedContent: content, issuesFound: [], fixed: false, error: 'OPENING_SEAM_GUARD', usedFallback };
    }

    // Apply fixes: ลบประโยคที่มีปัญหาออก — ★ Seam Guard ขั้น 2: จำลองผลก่อนตัดทุกครั้ง เย็บไม่ได้=ไม่ตัด
    let fixedContent = content;
    const appliedFixes = [];
    let guardedSeam = false;
    const factGuarded = []; // ★ 2 ก.ย. 69 ประโยคที่กันไว้เพราะแบกข้อเท็จจริง
    // ★ 3 ก.ย. 69 Sentence Guard: ค่าเริ่มต้นเปิด · =0 = พฤติกรรมเดิมไบต์ต่อไบต์ (อ่านสดทุกครั้ง — เทสสลับ env ได้)
    const sentenceGuardOn = process.env.SEMANTIC_FIX_SENTENCE_GUARD !== '0';
    const sentenceGuardEvents = [];

    for (const issue of result.issues) {
      if (typeof issue?.brokenText !== 'string' || issue.brokenText.length < 5) continue;

      // เหมือน replace เดิม: ใช้ occurrence แรกที่ยังอยู่ในเนื้อปัจจุบัน
      const seam = fixedContent.indexOf(issue.brokenText);
      if (seam < 0) continue;

      // ★ 2 ก.ย. 69 Fact-bearing Guard: ตรงกับต้นฉบับ ≥12 ตัวอักษร → คงไว้ ห้ามลบ (คนตรวจอ่านจากธง)
      if (sourceBody && sharesSourceFact(issue.brokenText, sourceBody)) {
        factGuarded.push(issue.brokenText);
        console.warn(`  L4.6 Semantic Guard: fact-bearing sentence kept — deletion skipped ("${issue.brokenText.slice(0, 40)}…")`);
        continue;
      }

      const wasParagraphStart = startsParagraph(fixedContent, seam);
      const candidate = fixedContent.slice(0, seam) + fixedContent.slice(seam + issue.brokenText.length);

      // ลบแล้วเหลือคำเชื่อมกำพร้าขึ้นหัวย่อหน้า → ตัดสินทางภาษาไม่ได้ ไม่ commit (Sol ห้ามตัดคำเชื่อมเพิ่ม)
      if (wasParagraphStart && UNSAFE_BLOCK_PREFIX_RE.test(candidate.slice(seam))) {
        guardedSeam = true;
        console.warn('  L4.6 Semantic Guard: orphan-prefix risk — deletion skipped');
        continue;
      }

      // ลบแล้วเครื่องหมายคำพูดเสียคู่ → คง issue เดิมไว้ ไม่ลบเพิ่ม
      if (quoteDebt(candidate) > quoteDebt(fixedContent)) {
        guardedSeam = true;
        console.warn('  L4.6 Semantic Guard: quote-pair risk — deletion skipped');
        continue;
      }

      // ★ 3 ก.ย. 69 Sentence Guard: ก่อน commit ตรวจว่าหน่วยประโยคที่เหลือหลังลบยังอ่านจบได้
      if (sentenceGuardOn) {
        const verdict = judgeSeamRemnant(fixedContent, candidate, seam, issue.brokenText.length, sourceBody);
        if (verdict.action === 'extend') {
          fixedContent = verdict.content;
          appliedFixes.push({
            removed: verdict.removedUnit,
            reason: `${issue.reason || 'ประโยคไร้ความหมาย'} · sentence guard: ลบทั้งหน่วยกันประโยคค้าง`,
            severity: issue.severity || 'medium',
          });
          sentenceGuardEvents.push({ action: 'extended', trigger: verdict.trigger, brokenText: issue.brokenText, extraRemoved: verdict.extraRemoved });
          console.warn(`  L4.6 Sentence Guard: ${verdict.trigger} after removal → removed whole unit instead (+${verdict.extraRemoved.length} chars "${verdict.remnantPreview}")`);
          continue;
        }
        if (verdict.action === 'revert') {
          sentenceGuardEvents.push({ action: 'reverted', trigger: verdict.trigger, reason: verdict.reason, brokenText: issue.brokenText, remnant: verdict.remnantPreview });
          console.warn(`  L4.6 Sentence Guard: ${verdict.trigger} after removal — deletion reverted, kept original sentence (${verdict.reason} "${verdict.remnantPreview}")`);
          continue;
        }
      }

      fixedContent = candidate;
      appliedFixes.push({
        removed: issue.brokenText,
        reason: issue.reason || 'ประโยคไร้ความหมาย',
        severity: issue.severity || 'medium',
      });

      console.log(`  L4.6 Semantic Fix: "${issue.brokenText.slice(0, 50)}..." → removed (${issue.reason})`);
    }

    // ★ byte parity (Sol): ไม่มีการลบที่ commit จริง → คืน input เดิมเป๊ะ ห้ามให้ cleanup/trim เปลี่ยนไบต์
    if (appliedFixes.length === 0) {
      // ★ 3 ก.ย. 69: ธง SENTENCE_GUARD ต่อท้ายลำดับเดิม (ขึ้นเฉพาะเมื่อการลบทั้งหมดถูกด่านประโยคค้างยกเลิก)
      const _sentenceReverted = sentenceGuardEvents.some((e) => e.action === 'reverted');
      return {
        sanitizedContent: content,
        issuesFound: [],
        fixed: false,
        ...(guardedSeam ? { error: 'UNSAFE_SEAM_GUARD' } : factGuarded.length ? { error: 'FACT_BEARING_GUARD' } : _sentenceReverted ? { error: 'SENTENCE_GUARD' } : {}),
        ...(factGuarded.length ? { guardedFactBearing: factGuarded } : {}),
        ...(sentenceGuardEvents.length ? { sentenceGuard: sentenceGuardEvents } : {}),
        usedFallback,
      };
    }

    // Clean up: ลบช่องว่างซ้ำ, บรรทัดว่างซ้ำ (คงพฤติกรรมเดิม — ห้าม refactor เพิ่มใน logical change นี้)
    fixedContent = fixedContent
      .replace(/\s{3,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      sanitizedContent: fixedContent,
      issuesFound: appliedFixes,
      fixed: true,
      ...(factGuarded.length ? { guardedFactBearing: factGuarded } : {}),
      ...(sentenceGuardEvents.length ? { sentenceGuard: sentenceGuardEvents } : {}), // ★ 3 ก.ย. 69
      usedFallback,
    };

  } catch (err) {
    // FAIL-SAFE: ถ้า AI call fail → ข้าม ใช้ content เดิม
    console.warn(`  L4.6 Semantic Check: SKIPPED (${err.message})`);
    return { sanitizedContent: content, issuesFound: [], fixed: false, error: err.message };
  }
}
