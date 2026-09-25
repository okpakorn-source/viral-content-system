/**
 * ด่านคำเสี่ยงหลัง Sol fact editor (editor post-sanitize) — หลัง editor · ก่อน final audit · ก่อนส่งออก
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S6 · เจ้าของอนุมัติ) — PL-06 / OV-13
 *
 * ปัญหาเดิม (พิสูจน์จากซอร์สจริง + สคริปต์ออฟไลน์ของผู้ตรวจ 2 คน — ไม่ยิง API):
 *   ลำดับท่อ TEXT: นักเขียน (callAI → sanitizeOutput ที่ client) → correction L2/L3/L4.x → grounding → ด่าน Sol ตรวจ RAW
 *   → Sol editor แทน content ทั้งก้อน (rawFactCompletenessGate.js repairRawFactContents: `content: item.content`)
 *   editor เรียก OpenAI SDK ตรง (client.chat.completions.create) ไม่ผ่าน callAI จึงไม่มี sanitizeOutput · พรอมต์ editor ไม่มีกฎคำเสี่ยง
 *   แต่สั่ง "คืน missingFacts" ซึ่ง rawExcerpt คัดตรงจาก RAW → ถ้า RAW มี "พบศพ / ถูกยิง / ยาบ้า" editor คืนถ้อยคำดิบกลับเข้าโพสต์
 *   และหลังด่านนี้ไม่มีตัวกรองใดอีก (grounding/diversity = คำเตือน · length floor = นับคำ · saveAnalysis/UI/บอท = ส่ง content ตรง)
 *   ผลจำลอง: passingVersions[0].content = "ตำรวจพบศพชายวัย 40 ปี ถูกยิงเสียชีวิต… พบยาบ้า 200 เม็ด" ผ่านทุกด่านถึง analysisResult.summary
 *   (ตอนนี้ production ปิดด่าน Sol ด้วย RAW_FACT_COMPLETENESS_GATE=0 → บั๊กแฝง จะเกิดทันทีเมื่อเปิดด่านคืน เพราะค่าเริ่มต้นในโค้ดคือเปิด)
 *
 * วิธีใหม่ (ค่าเริ่มต้น · สวิตช์ถอย EDITOR_POST_SANITIZE=0/off/false/no/legacy = ของเดิมทุกไบต์ ทั้งพรอมต์ auditor/editor และผล):
 *   ขั้น 1 sanitize: ผล editor ผ่าน sanitizeOutput ตัวเดียวกับที่ client นักเขียนใช้ (S1 ตัวกรองขอบคำ · SANITIZE_LEGACY=1 = ตารางเดิม เหมือน client)
 *   ขั้น 2 audit L2 แบบ read-only: findRiskWords (เครื่องสแกน + ตารางกลางชุด 'audit' ของ S2 — ตัวเดียวกับ outputAuditService) นับ hit ต่อกฎ
 *          บนผลขั้น 1 เทียบกับฉบับก่อน editor (content ที่ส่งให้ editor ซึ่งผ่าน L2/L3 มาแล้ว) · กฎที่จำนวน hit "เพิ่มขึ้น" = คำเสี่ยงใหม่ที่ editor ใส่มา
 *          → เฉพาะกฎที่ L3A แทนตรง (aiRewrite !== true): แทนทุกตำแหน่งที่กฎนั้นจับด้วยคำแทนของกฎเดียวกัน (hit.replacement — replaceRiskWordIssue) · ไม่ทิ้งฉบับ
 *          · กฎคำแทนว่าง (ด่วน/xxx/AV → '') ไม่ลบ (L3A/rollback scrub ก็ข้าม) จดไว้ใน skippedEmpty · hit ที่มีอยู่แล้วก่อน editor ไม่แตะ (ท่อ correction ตัดสินไปแล้ว)
 *          · แยกไม่ได้ว่าตำแหน่งไหน "ใหม่" (editor เรียบเรียงใหม่ทั้งก้อน) จึงแทนทุกตำแหน่งของกฎที่จำนวนเพิ่ม — ตำแหน่งเดิมที่รอดมาถึงตรงนี้ส่วนใหญ่มาจากด่านล้ม/ถอย
 *   ตำแหน่งในท่อ: enforceRawFactCompleteness หลังรับผล editor "ก่อน final audit" — final audit จึงตรวจข้อความที่จะโพสต์จริง และ contextHash ตรงกับที่โพสต์
 *          (สมมาตรกับสายนักเขียน: ผลนักเขียนก็ผ่าน sanitize ก่อนถูก audit)
 *   + พรอมต์ editor เพิ่มคู่คำแทนจากตารางกลาง ลดโอกาสที่ editor คืนถ้อยคำดิบตั้งแต่ต้น (ผลต่อพฤติกรรมโมเดลยังไม่ได้วัด — ห้ามยิง API · ด่านขั้น 1–2 คือตัวกันจริงที่พิสูจน์ได้)
 *   ทิศทางเมื่อพลาด: "ไม่แตะ" — ฟังก์ชันนี้ไม่โยน · ไม่มีคำเสี่ยง = คืนสตริงเดิม (อ้างอิงเดิม)
 *   RISK_WORDS_LEGACY=1: ด่านนี้ไม่มี "ตารางเดิมของตัวเอง" (ก่อน S6 ไม่มีด่านนี้) จึงใช้ตารางกลางเสมอ — ถอยด่านนี้ใช้ EDITOR_POST_SANITIZE=0
 *
 * ★ 24 ก.ย. 69 รอบแก้ 2 (ผู้ตรวจ FAIL รอบแรก — ปิด 2 ข้อ):
 *   [high] รอบแรกขั้น 2 แทนตรง "ทุกกฎ" รวมกฎที่ตารางกลางตั้ง aiRewrite:true (ตาย/ดับ/สิ้นใจ/เลือด/ระเบิด/บาดแผล + กลุ่มพนัน/ยา/เหล้า) ทั้งที่สายนักเขียน
 *     จงใจส่งกฎกลุ่มนี้ให้ L3B เกลาตามบริบท (safeCorrectionService.js needsAIRewrite · บทเรียน 16 ก.ค. 69 B2: แทนตรงได้ "พบร่องรอยเหตุการณ์ไหลออกมา")
 *     ผลจริงที่ผู้ตรวจพิสูจน์: "รอดตาย"→"รอดจากไป" (คนรอดถูกเขียนด้วยคำของคนตาย) · "เลือดออกในสมอง/ค่าน้ำตาลในเลือด/กรุ๊ปเลือด"→"ร่องรอยเหตุการณ์…"
 *     · "ดับเครื่องยนต์"→"จากไปเครื่องยนต์" · "ลูกระเบิด"→"ลูกเหตุการณ์รุนแรง" · "รณรงค์ไม่ดื่มสุรา"→"รณรงค์ไม่วงสังสรรค์" = เปลี่ยนข้อเท็จจริง ขัดหลัก S1
 *     → ตอนนี้ขั้น 2 แทนตรงเฉพาะกฎ aiRewrite !== true (ความหมาย L3A จริง) · กฎ aiRewrite:true "คงคำไว้" แล้วจดใน needsReview → ท่อขึ้นคำเตือน
 *       ให้พนักงานเกลาก่อนโพสต์ (ทางเลือกข้อ 1 ของผู้ตรวจ — ด่านนี้ห้ามยิง AI จึงไม่มี L3B ให้เกลา · ตัวกันบริบทแบบรายการคำ (รอด/ไม่/ตรวจ/ใน…)
 *       ไม่ครอบ ดับกระหาย/ลูกระเบิด/ระเบิดอารมณ์ ที่ผู้ตรวจยกมาเอง จึงไม่ใช้) · หลัก "ไม่เปลี่ยนข้อเท็จจริง" มาก่อน "ไม่มีคำเสี่ยง"
 *     + พรอมต์ editor ขยายจาก core 17 คู่ เป็น (ก) คู่คำแทนตรงทุกกฎ (มี ฆาตกรรม/พบศพ/ยิง/กระสุน ครบ) (ข) รายการคำที่ต้องเกลาตามบริบท
 *       (ตาย/ดับ/เลือด/ยาบ้า… — บอก editor ว่าระบบไม่แทนให้ ต้องเกลาเองในประโยค + ตัวรอดห้ามเขียนว่าเสียชีวิต + ศัพท์แพทย์คงคำเดิม) (ค) ข้อยกเว้น
 *       — editor (Sol) คือ "ผู้เกลาตามบริบท" ของสายนี้โดยไม่ต้องจ่ายเพิ่ม (คำขอเดิม)
 *   [medium] ด่านรันก่อน final audit จึง "ย้อน" ผลแก้ของ editor ที่คืนถ้อยคำ RAW ของคำชุดตัวกรอง (ฆาตกรรม→เหตุสูญเสีย) กลับเท่าฉบับก่อน editor
 *     ทุกตัวอักษร → auditor ที่ยึด RAW ตรงตัวจะตีตกซ้ำ → กักฉบับ/FACTUAL_REVIEW_REQUIRED · ต้นเหตุ: auditor ไม่รู้ว่าคำแทนของระบบ = ตรง RAW
 *     → ปิดที่ต้นเหตุตามข้อเสนอ OV-13: พรอมต์ auditor (ทั้งรอบแรกและรอบสุดท้าย) เพิ่มบรรทัดคู่ "คำ RAW=คำแทนของระบบ" (auditorEquivalenceLine
 *       จากตารางกลาง) สั่งว่าต่างกันแค่ถ้อยคำห้ามรายงานเป็น issue/missingFacts → รอบแรกไม่ตีตกคำเลี่ยงตั้งแต่ต้น (ไม่ต้องเรียก editor = ประหยัด)
 *       และรอบสุดท้ายไม่กักฉบับที่ด่านนี้แทนคำ · ผลจริงต่อโมเดลยังไม่ได้วัด (ห้ามยิง API) จึงเพิ่ม revertedToPrior + log ↩️ ไว้ให้เห็นเมื่อเกิดกรณีนี้
 *       (auditor ที่ไม่ทำตามบรรทัดนี้ยังกักฉบับได้ — ทิศทางเดิม: กักดีกว่าปล่อยคำเสี่ยงถึงโพสต์ · ตัวอย่างทั้งสองแบบใน C:\tmp\news-g1-samples\S6.md)
 *
 * ไฟล์นี้ import เฉพาะ ../ai/safetyFilter.js + ../ai/riskWords.js (ไม่มี alias @/) — ข้อสอบโหลด/กลายพันธุ์ผ่าน tests/helpers/temp-module.mjs ได้
 */

import { sanitizeOutput, findRiskWords, applyRiskHits } from '../ai/safetyFilter.js';
import { RISK_RULES } from '../ai/riskWords.js';

const OFF_VALUES = new Set(['0', 'off', 'false', 'no', 'legacy']);

/** สวิตช์ EDITOR_POST_SANITIZE — อ่านตอนเรียกทุกครั้ง (ไม่แคช) · ไม่ตั้ง/1/on/ค่าอื่น = เปิด (ค่าเริ่มต้น) · 0/off/false/no/legacy = ของเดิมทุกไบต์ */
export function isEditorPostSanitizeEnabled() {
  const raw = process.env.EDITOR_POST_SANITIZE;
  if (raw == null) return true;
  return !OFF_VALUES.has(String(raw).trim().replace(/^["']|["']$/g, '').toLowerCase());
}

/** นับ hit ของเครื่องสแกน L2 (read-only · ตารางกลางชุด 'audit') ต่อกฎ → Map<ruleId, count> */
export function countRiskHitsByRule(text) {
  const counts = new Map();
  for (const hit of findRiskWords(typeof text === 'string' ? text : String(text ?? ''))) {
    counts.set(hit.rule.id, (counts.get(hit.rule.id) || 0) + 1);
  }
  return counts;
}

/**
 * ด่านคำเสี่ยงหลัง editor — ขั้น 1 sanitize (ตัวกรองเดียวกับ client) → ขั้น 2 audit L2 read-only แล้วแทนคำเสี่ยง "ใหม่" เฉพาะกฎที่ L3A แทนตรง
 * @param {string} editedContent  ผล editor (content ทั้งก้อน)
 * @param {string} priorContent   content ฉบับเดิมที่ส่งให้ editor (ผ่าน L2/L3 มาแล้ว) — ฐานเทียบ "คำเสี่ยงใหม่" ต่อกฎ
 * @returns {{ content: string, changed: boolean, sanitizeChanged: boolean, newRiskWords: string[], replaced: number,
 *   needsReview: string[], skippedEmpty: string[], carried: number, remaining: number, revertedToPrior: boolean }}
 *   content        ข้อความหลังด่าน (ไม่มีคำเสี่ยง = สตริงเดิม อ้างอิงเดิม)
 *   sanitizeChanged ขั้น 1 เปลี่ยนข้อความไหม · newRiskWords ["ยิง→ใช้อาวุธปืน", …] คำเสี่ยงใหม่ที่ขั้น 2 แทน (ไม่ซ้ำ) · replaced = จำนวนตำแหน่งที่ขั้น 2 แทน
 *   needsReview    ★ รอบแก้ 2: คำเสี่ยงใหม่ของกฎ aiRewrite:true (ตาย/ดับ/เลือด/ระเบิด/ยาบ้า/วงเหล้า…) — "คงคำไว้" ไม่แทนตรง (กฎ L3B: แทนตรงแล้วเพี้ยน)
 *                  ผู้เรียกต้องขึ้นคำเตือนให้พนักงานเกลาก่อนโพสต์
 *   skippedEmpty   คำเสี่ยงใหม่ที่กฎคำแทนว่าง (คงไว้) · carried = hit ที่มีอยู่แล้วก่อน editor (ไม่แตะ) · remaining = hit ที่เหลือหลังด่าน (รวม needsReview/skippedEmpty/carried)
 *   revertedToPrior ★ รอบแก้ 2: ด่านแทนคำจนผลเท่ากับฉบับก่อน editor ทุกตัวอักษร (editor คืนถ้อยคำ RAW ของคำที่ตัวกรองแทนไว้) — auditor ที่ยึด RAW ตรงตัวจะตีตกซ้ำ
 */
export function postSanitizeEditedContent(editedContent, priorContent) {
  const edited = typeof editedContent === 'string' ? editedContent : String(editedContent ?? '');
  const prior = typeof priorContent === 'string' ? priorContent : String(priorContent ?? '');
  const result = {
    content: edited, changed: false, sanitizeChanged: false,
    newRiskWords: [], replaced: 0, needsReview: [], skippedEmpty: [], carried: 0, remaining: 0, revertedToPrior: false,
  };
  if (!edited) return result;

  // ขั้น 1 — ตัวกรองเดียวกับ client นักเขียน (sanitizeOutput รับสตริงตรง คืนสตริง · เคารพ SANITIZE_LEGACY/RISK_WORDS_LEGACY เหมือน client)
  const sanitized = sanitizeOutput(edited);
  result.sanitizeChanged = sanitized !== edited;

  // ขั้น 2 — audit L2 read-only: hit ต่อกฎบนผลขั้น 1 เทียบฉบับก่อน editor → กฎที่จำนวนเพิ่ม = คำเสี่ยงใหม่
  const before = countRiskHitsByRule(prior);
  const hits = findRiskWords(sanitized);
  const after = new Map();
  for (const hit of hits) after.set(hit.rule.id, (after.get(hit.rule.id) || 0) + 1);
  const selected = [];
  for (const hit of hits) {
    if ((after.get(hit.rule.id) || 0) <= (before.get(hit.rule.id) || 0)) { result.carried += 1; continue; }
    if (hit.rule.aiRewrite === true) { // ★ รอบแก้ 2: กฎ L3B (เกลาตามบริบท) — L3A ไม่เคยแทนตรง ด่านนี้ก็ไม่แทน → คงคำ + จดให้พนักงานเกลา
      if (!result.needsReview.includes(hit.text)) result.needsReview.push(hit.text);
      continue;
    }
    if (!hit.replacement) { // กฎคำแทนว่าง (ด่วน/xxx/AV → '') — L3A/rollback scrub ไม่ลบ ด่านนี้ก็ไม่ลบ
      if (!result.skippedEmpty.includes(hit.text)) result.skippedEmpty.push(hit.text);
      continue;
    }
    selected.push(hit); // hit ของ findRiskWords เรียงตามตำแหน่ง ไม่ซ้อนกัน → applyRiskHits ใช้ได้ตรง
    const label = `${hit.text}→${hit.replacement}`;
    if (!result.newRiskWords.includes(label)) result.newRiskWords.push(label);
  }
  const content = selected.length ? applyRiskHits(sanitized, selected) : sanitized;
  result.replaced = selected.length;
  result.content = content;
  result.changed = content !== edited;
  result.remaining = content === sanitized && selected.length === 0 ? hits.length : findRiskWords(content).length;
  result.revertedToPrior = result.changed && content === prior;
  return result;
}

// ═══ พรอมต์ (ตารางกลาง S2 — RISK_RULES) ═══════════════════════════════════════════════════════════════════════════════════════
// กลุ่มที่ไม่ใช่ "ข้อเท็จจริง" (bait/clickbait/explicit) ไม่ใส่ในพรอมต์ editor/auditor — editor ไม่คืนคำพวกนี้จาก RAW และ auditor ต้องรายงานปฏิกิริยาคนอ่านตามเดิม
const NON_FACT_GROUPS = new Set(['clickbait', 'bait', 'explicit']);
const uniq = (arr) => [...new Set(arr)];
/** กฎที่มี find+to (ไม่ใช่ regex/ไม่ใช่กฎลบ) ในกลุ่มข้อเท็จจริง — เรียงตามตาราง */
const factRules = () => RISK_RULES.filter((rule) => rule.find && rule.to && !NON_FACT_GROUPS.has(rule.group));
/** "ก/ข→คำแทน" รวมกฎที่คำแทนเดียวกันไว้ด้วยกัน (ลำดับตามที่พบครั้งแรก) · sep = เครื่องหมายระหว่างคำกับคำแทน */
function pairsByReplacement(rules, sep) {
  const byTo = new Map();
  for (const rule of rules) {
    if (!byTo.has(rule.to)) byTo.set(rule.to, []);
    byTo.get(rule.to).push(rule.find);
  }
  return [...byTo.entries()].map(([to, finds]) => `${uniq(finds).join('/')}${sep}${to}`).join(', ');
}
const promptNotes = () => uniq(RISK_RULES.filter((rule) => rule.promptNote).map((rule) => rule.promptNote)).join(' · ');

/**
 * บรรทัดกฎคำเสี่ยงสำหรับพรอมต์ editor (★ รอบแก้ 2: 3 บรรทัดจากตารางกลางทั้งตาราง — เดิมใช้ core 17 คู่ จึงไม่มี ฆาตกรรม/ตาย/ดับ)
 *   (ก) คู่คำแทนตรง (กฎ aiRewrite !== true — ด่านหลัง editor จะแทนให้อยู่แล้วถ้าหลุดมา)
 *   (ข) คำที่ต้องเกลาตามบริบท (กฎ aiRewrite:true — ด่านหลัง editor "ไม่แทน" จึงต้องให้ editor เกลาเองในประโยค: ตัวรอดห้ามเขียนว่าเสียชีวิต · ศัพท์แพทย์คงคำเดิม)
 *   (ค) ข้อยกเว้น (promptNote ทุกกฎ)
 * คืนสตริง 3 บรรทัดขึ้นต้น "- " ลงท้าย "\n" (ต่อเข้าบล็อกกติกาของ repairRawFactContents ได้ตรง) · ผู้เรียกเป็นคนดูสวิตช์
 */
export function editorSafetyPromptLines() {
  const rules = factRules();
  const direct = pairsByReplacement(rules.filter((rule) => rule.aiRewrite !== true), '→');
  const contextual = pairsByReplacement(rules.filter((rule) => rule.aiRewrite === true), '→');
  return `- ห้ามใช้คำเสี่ยง (ใช้คำแทนตามคู่นี้): ${direct} — รวมถึงตอนคืน missingFacts: เล่าข้อเท็จจริงจาก RAW ด้วยคำแทน ไม่คัดถ้อยคำเสี่ยงมาตรงๆ\n`
    + `- คำที่ต้องเกลาตามบริบท (ระบบไม่แทนตรงให้ ต้องเกลาเองในประโยค — ห้ามคัดคำซ้ายจาก RAW มาตรงๆ): ${contextual} — ใช้คำขวาหรือสำนวนสุภาพที่ความหมายเท่าเดิม ("เสียชีวิต"/"จากไป" ใช้ตรงๆ ได้) โดยไม่ทำให้ข้อเท็จจริงหาย · คนที่รอด/ยังไม่เสียชีวิต (รอดตาย/ช่วยทัน) ห้ามเขียนว่าเสียชีวิต · ศัพท์การแพทย์ (เลือดออกในสมอง/ค่าน้ำตาลในเลือด/กรุ๊ปเลือด/ตกเลือด) และคำประสม (ดับเครื่องยนต์/ลูกระเบิด/ระเบิดอารมณ์) คงคำเดิม\n`
    + `- ข้อยกเว้น: ${promptNotes()}\n`;
}

/**
 * ★ รอบแก้ 2 (OV-13 ต้นเหตุฝั่ง auditor): บรรทัดคู่ "คำ RAW=คำแทนของระบบ" สำหรับพรอมต์ auditor (รอบแรก+รอบสุดท้าย) — ตารางกลางทั้งตาราง
 *   ให้ auditor รู้ว่าฉบับที่ใช้คำขวาแทนคำซ้ายของ RAW "ตรงกับ RAW" (ต่างแค่ถ้อยคำ) ห้ามรายงานเป็น issue/missingFacts
 *   → รอบแรกไม่ตีตกคำเลี่ยงของตัวกรอง (ไม่ต้องเรียก editor) · รอบสุดท้ายไม่กักฉบับที่ด่านหลัง editor แทนคำ · ผลต่อโมเดลยังไม่ได้วัด (ห้ามยิง API)
 * คืนสตริง 1 บรรทัดขึ้นต้น "- " ลงท้าย "\n" (ต่อเข้าบล็อกกติกาของ buildAuditPrompt ได้ตรง) · ผู้เรียกเป็นคนดูสวิตช์
 */
export function auditorEquivalenceLine() {
  return `- คำแทนมาตรฐานของระบบ (ตัวกรองคำเสี่ยง Facebook) ถือว่าตรงกับ RAW: ถ้า RAW ใช้คำซ้าย แต่ block ใช้คำขวา (หรือสำนวนสุภาพความหมายเดียวกัน เช่น เสียชีวิต/จากไป แทน ตาย/ดับ/สิ้นใจ) ให้ถือว่าใจความเท่ากัน ห้ามรายงานเป็น issue หรือ missingFacts เพราะต่างกันแค่ถ้อยคำ: ${pairsByReplacement(factRules(), '=')}\n`;
}
