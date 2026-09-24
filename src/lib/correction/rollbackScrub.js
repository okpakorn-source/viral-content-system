/**
 * L4+ — ล้างเนื้อ rollback (rollback scrub) ฉบับ "ขอบคำ + คง engagement-bait removal"
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S4 · เจ้าของอนุมัติ) — PL-05
 *
 * ที่มา: เมื่อด่านข้อเท็จจริง (L4) ตีผล L3 ว่า drift สูง (เลข/ชื่อหาย) ท่อจะ "ย้อน" ไปใช้เนื้อก่อน L3 (rollbackContent)
 *   ซึ่งยังมีคำต้องห้าม/คำชวนเมนต์อยู่ครบ → บล็อกเดิมใน correctionPipeline.js ล้างซ้ำด้วยตัวเอง แล้วพัง 3 ทาง (พิสูจน์ด้วยโค้ดจริง + AI stub):
 *   (1) split/join ทุกตำแหน่ง ไม่สน lookaround/ขอบคำของกฎ L2 → "ระดับน้ำ"→"ระจากไปน้ำ" · "ตามลำดับ"→"ตามลำจากไป" · "สองตายาย"→"สองจากไปาย" ·
 *       "เส้นเลือดในสมอง"→"เส้นร่องรอยเหตุการณ์ในสมอง" (เคสจริง 10 ก.ค./1 ส.ค. 69 กลับมาทางนี้) — S2 ปิดไปแล้วเฉพาะ issue ที่มี ruleId
 *       (replaceRiskWordIssue all) แต่ issue ที่ไม่มี ruleId (โหมดถอย S2 / issue ทำมือ) ยัง split/join
 *   (2) รับกฎ suggestion ว่าง ('' ยาว 0 ≤ 25 ผ่านตัวกรอง) → 'ด่วน'/'AV'/'xxx' ถูกลบทุกตัว: "เร่งด่วน"→"เร่ง" · "ทางด่วน"→"ทาง" · "ข่าวด่วน"→"ข่าว"
 *       ทั้งที่เส้นหลัก L3A ข้ามกฎ suggestion ว่างโดยตั้งใจ (safeCorrectionService: `issue.type === 'forbidden_word' && issue.suggestion`)
 *   (3) กรองเฉพาะ type 'forbidden_word' → คำชวนเมนต์ (engagement_bait: ห้ามพลาด/แชร์ด่วน/พิมพ์ 1/…) ที่ L3 ลบไปแล้วกลับเข้าโพสต์ ทั้งที่ Facebook ลด reach
 *
 * วิธีใหม่ (ค่าเริ่มต้น · สวิตช์ถอย CORR_ROLLBACK_LEGACY=1 = บล็อกเดิมใน correctionPipeline.js ทุกไบต์ รวมกิ่ง S2):
 *   (ก) คำต้องห้าม: ข้ามกฎ suggestion ว่าง (เหมือน L3A) · issue มี ruleId → แทนทุกตำแหน่งที่กฎเดียวกันจับ (replaceRiskWordIssue ของ S2) ·
 *       issue ไม่มี ruleId → แทนทุกตำแหน่งที่ "ทั้งวลี" อยู่บนขอบคำ Intl.Segmenter 'th' (เครื่องสแกน scanRiskRules ของ S1 กับกฎเฉพาะกิจ {find, to, needsBoundary})
 *       = ตัวแทนคำขอบคำตัวเดียวกับตัวกรอง S1 · ไม่มีเครื่องตัดคำ = ไม่แทน (ทิศเดียวกับ S1: ไม่แทนดีกว่าแทนกลางคำ)
 *       ยกเว้น RISK_WORDS_LEGACY=1 ซึ่ง S2 สัญญาไว้ว่า "scrub = split/join เดิม" → คงตามสัญญา (ถอย S2 = ได้ S2 เดิม · ถอย S4 = ได้บล็อกเดิม)
 *   (ข) คำชวนเมนต์: issue type 'engagement_bait' ที่ text สั้นกว่า 30 ตัวอักษร (เกณฑ์เดียวกับ L3A) → ลบทุกตำแหน่งบนขอบคำ แล้วเก็บกวาดช่องว่างซ้อนแบบ L3
 *       ลบจริงเฉพาะเมื่อ opts.verify(ฉบับหลังลบ) ผ่าน — ท่อส่ง verify = ด่านข้อเท็จจริง (checkFactPreservation กับต้นฉบับ) เพราะ L4 นับเลขทุกตัว
 *       และวลีหลัง "คุณ" เป็นข้อเท็จจริง ("พิมพ์ 1" ลบแล้วเลข 1 หาย = number_missing · "คุณคิดยังไง?" ถูก regex ชื่อนับเป็นชื่อ = name_missing)
 *       → ถ้าฝืนลบ ด่านท้ายของท่อจะทิ้ง "ทั้ง scrub" (รวมคำต้องห้ามที่ล้างไว้) แล้วคืนต้นฉบับ = แย่กว่าเดิม จึงคง bait นั้นไว้แล้วจดเหตุผล (reason 'fact-gate')
 *   ทิศทางเมื่อพลาด: "ไม่แตะ" — โมดูลล้ม = ท่อจับ error แล้วปล่อยเนื้อ rollback เดิมผ่าน (fail-open เดิมของท่อ)
 *
 * ไฟล์นี้ import เฉพาะเครื่องสแกนของ S1/S2 (../ai/safetyFilter.js · ../ai/riskWords.js) — ข้อสอบโหลด/กลายพันธุ์ผ่าน tests/helpers/temp-module.mjs ได้
 */

import { scanRiskRules, applyRiskHits, replaceRiskWordIssue } from '../ai/safetyFilter.js';
import { isRiskWordsLegacy } from '../ai/riskWords.js';

const LEGACY_VALUES = new Set(['1', 'true', 'on', 'yes', 'legacy']);

/** สวิตช์ถอย CORR_ROLLBACK_LEGACY — อ่านตอนเรียกทุกครั้ง (ไม่แคช) · ไม่ตั้ง/0/off/false = ฉบับใหม่ (ค่าเริ่มต้น) */
export function isCorrRollbackLegacy() {
  const raw = process.env.CORR_ROLLBACK_LEGACY;
  if (raw == null) return false;
  return LEGACY_VALUES.has(String(raw).trim().replace(/^["']|["']$/g, '').toLowerCase());
}

// เกณฑ์เดิมของบล็อก rollback scrub (คงทุกค่า) — เพิ่มข้อเดียว: suggestion ต้องไม่ว่าง (ข้อ 2)
export const SUGGESTION_MAX_CHARS = 25;
export const SUGGESTION_BLOCK_RE = /เช่น|สำนวน|บริบท|\//;
// เกณฑ์ bait ของ L3A (safeCorrectionService: `issue.text.length < 30`) — ท่อนยาวกว่านี้คือ "ประโยคท้ายที่เป็นคำถาม" ให้ L4.6/คนตรวจ
export const BAIT_MAX_CHARS = 30;

/** issue คำต้องห้ามที่ scrub จะแทน: เกณฑ์เดิมทุกข้อ + suggestion ไม่ว่าง (กฎ '' = ลบ ซึ่ง L3A ก็ข้าม) */
export function isScrubbableForbidden(issue) {
  return !!(issue && issue.type === 'forbidden_word' && issue.text
    && typeof issue.suggestion === 'string' && issue.suggestion.length > 0
    && issue.suggestion.length <= SUGGESTION_MAX_CHARS && !SUGGESTION_BLOCK_RE.test(issue.suggestion));
}

/**
 * แทนสตริงตรงตัวทุกตำแหน่งที่ "ทั้งวลี" อยู่บนขอบคำ (ตัวแทนคำขอบคำของ S1: scanRiskRules + applyRiskHits)
 *   คงกติกาของเครื่องสแกน: ชื่อ/ข้อความในเครื่องหมายคำพูดสั้น ๆ ไม่แตะ · ไม่มี Intl.Segmenter → needsBoundary = ไม่แทน
 * @param {string} text
 * @param {string} find   สตริงตรงตัว (ไม่ใช่ regex)
 * @param {string} to     คำแทน ('' = ลบ)
 * @param {{ segmenter?: Intl.Segmenter|null }} [opts]  segmenter: null = จำลองรันไทม์ที่ไม่มี Intl.Segmenter (ใช้ในเทส)
 * @returns {string|null} ข้อความที่แทนแล้ว · null = ไม่มีตำแหน่งบนขอบคำให้แทน (caller คงข้อความเดิม)
 */
export function replaceAllAtWordBoundaries(text, find, to, opts) {
  if (typeof text !== 'string' || !text || typeof find !== 'string' || !find) return null;
  const hits = scanRiskRules(text, [{ find, to: String(to ?? ''), needsBoundary: true }], opts);
  return hits.length ? applyRiskHits(text, hits) : null;
}

// เก็บกวาดหลังลบ bait — บรรทัดเดียวกับท้าย safeCorrect (L3): ช่องว่างซ้อน + บรรทัดว่างเกิน
const cleanupAfterRemoval = (s) => s.replace(/  +/g, ' ').replace(/\n{3,}/g, '\n\n');

/**
 * ล้างเนื้อ rollback: (ก) คำต้องห้าม → (ข) คำชวนเมนต์
 * @param {string} content   เนื้อ rollback (ก่อน L3) ที่ท่อจะส่งต่อ L4.5/L4.6/L5
 * @param {Array} issues     issues จาก auditOutput (reAudit) ของเนื้อนี้
 * @param {{ verify?: (candidate: string) => boolean, segmenter?: Intl.Segmenter|null }} [opts]
 *   verify: คืน true = ยอมให้ลบ bait ชิ้นนั้น (ท่อส่งด่านข้อเท็จจริง) · ไม่ส่ง = ลบโดยไม่ตรวจ
 *   segmenter: null = จำลองรันไทม์ที่ไม่มี Intl.Segmenter (ใช้ในเทส) — มีผลกับเส้นขอบคำ/bait (เส้น ruleId ใช้เครื่องสแกนกลางเสมอ)
 * @returns {{ content: string, changed: boolean,
 *   forbidden: Array<{ text: string, suggestion: string, ruleId: string|null, via: 'rule'|'boundary'|'split-join', changed: boolean }>,
 *   skippedEmpty: string[],
 *   bait: Array<{ text: string, removed: boolean, reason: null|'too-long'|'not-on-boundary'|'fact-gate' }> }}
 */
export function scrubRollbackContent(content, issues, opts = {}) {
  const text = String(content ?? '');
  const list = Array.isArray(issues) ? issues : [];
  const scanOpts = Object.prototype.hasOwnProperty.call(opts, 'segmenter') ? { segmenter: opts.segmenter } : undefined;
  const verify = typeof opts.verify === 'function' ? opts.verify : null;
  const result = { content: text, changed: false, forbidden: [], skippedEmpty: [], bait: [] };
  if (!text) return result;
  let out = text;

  // (ก) คำต้องห้าม — ลำดับตาม reAudit แทนต่อเนื่องบนเนื้อที่เปลี่ยนไปแล้ว (เหมือนลูปเดิม)
  for (const iss of list) {
    if (!iss || iss.type !== 'forbidden_word' || !iss.text) continue;
    if (typeof iss.suggestion === 'string' && iss.suggestion.length === 0) {
      result.skippedEmpty.push(iss.text); // ข้อ 2: กฎ '' = ลบ — L3A ไม่ลบ scrub ก็ไม่ลบ (เร่งด่วน/ทางด่วน/ข่าวด่วน คง)
      continue;
    }
    if (!isScrubbableForbidden(iss)) continue;
    const before = out;
    let via;
    if (iss.ruleId) {
      via = 'rule'; // S2: แทนทุกตำแหน่งที่กฎเดียวกันจับจริง (prevBlock/nextBlock/ขอบคำ/ชื่อในเครื่องหมายคำพูด)
      const r = replaceRiskWordIssue(out, iss, { all: true });
      if (r !== null) out = r;
    } else if (isRiskWordsLegacy()) {
      via = 'split-join'; // สัญญา S2: RISK_WORDS_LEGACY=1 → scrub = split/join เดิม (ห้ามแก้ที่นี่ — ถอย S2 ต้องได้ S2 เดิม)
      out = out.split(iss.text).join(iss.suggestion);
    } else {
      via = 'boundary'; // ข้อ 1: issue ไม่มี ruleId → ขอบคำ Intl.Segmenter (ตัวแทนคำของ S1) ไม่ใช่ split/join
      const r = replaceAllAtWordBoundaries(out, iss.text, iss.suggestion, scanOpts);
      if (r !== null) out = r;
    }
    result.forbidden.push({ text: iss.text, suggestion: iss.suggestion, ruleId: iss.ruleId || null, via, changed: out !== before });
  }

  // (ข) คำชวนเมนต์ — ข้อ 3: คง engagement-bait removal ไว้แม้ rollback (เกณฑ์ <30 ของ L3A · ลบทุกตำแหน่งบนขอบคำ · ผ่าน verify ก่อน)
  const seen = new Set();
  for (const iss of list) {
    if (!iss || iss.type !== 'engagement_bait' || typeof iss.text !== 'string' || !iss.text) continue;
    if (seen.has(iss.text)) continue;
    seen.add(iss.text);
    if (iss.text.length >= BAIT_MAX_CHARS) { result.bait.push({ text: iss.text, removed: false, reason: 'too-long' }); continue; }
    const removed = replaceAllAtWordBoundaries(out, iss.text, '', scanOpts);
    if (removed === null) { result.bait.push({ text: iss.text, removed: false, reason: 'not-on-boundary' }); continue; }
    const candidate = cleanupAfterRemoval(removed);
    if (verify && !verify(candidate)) { result.bait.push({ text: iss.text, removed: false, reason: 'fact-gate' }); continue; }
    out = candidate;
    result.bait.push({ text: iss.text, removed: true, reason: null });
  }

  result.content = out;
  result.changed = out !== text;
  return result;
}
