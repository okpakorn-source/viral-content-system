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
      return {
        sanitizedContent: content,
        issuesFound: [],
        fixed: false,
        ...(guardedSeam ? { error: 'UNSAFE_SEAM_GUARD' } : factGuarded.length ? { error: 'FACT_BEARING_GUARD' } : {}),
        ...(factGuarded.length ? { guardedFactBearing: factGuarded } : {}),
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
      usedFallback,
    };

  } catch (err) {
    // FAIL-SAFE: ถ้า AI call fail → ข้าม ใช้ content เดิม
    console.warn(`  L4.6 Semantic Check: SKIPPED (${err.message})`);
    return { sanitizedContent: content, issuesFound: [], fixed: false, error: err.message };
  }
}
