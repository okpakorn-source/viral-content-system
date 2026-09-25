/**
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S7 · เจ้าของอนุมัติ) — PL-11 / MC-14: เกราะเวลา + system prompt งานตรวจ ของชั้น correction
 * ─────────────────────────────────────────────────────────────
 * บั๊ก (ผู้ตรวจ 2 คนยืนยัน · ทำซ้ำได้ด้วยนาฬิกาเสมือน — ไม่เคยเห็นบน production แต่เป็นช่องโหว่เชิงออกแบบ):
 *   (1) PL-11 — ชั้น correction ไม่มีเพดานเวลาระดับขั้น: autoFlowServiceText เรียก runCorrectionPipeline ตรงๆ (ขั้นอื่น extract/breakdown/blueprint/generate
 *       ครอบ withTimeoutSignal หมด) และทุกจุดที่เรียก AI ในโฟลเดอร์นี้ (L4.6 claude→luna · L3B · L3A · L1.8 · flagFixer) ไม่ส่ง signal/timeout/maxRetries
 *       → เหลือแค่เส้นตายรวมของ route (700s ผูกอัตโนมัติผ่าน preparePipelineSignal) + ค่าเริ่มต้น SDK (600s · retry 2)
 *       · Claude ช้าแต่ไม่พัง (L4.6 ใช้ opus-5 เปิด thinking เพดาน 16000 โทเคน) = งานทั้งเวอร์ชันค้าง กินเวลาที่ด่าน Sol ต้องจอง 180s
 *       → assertCanStart('raw_fact_audit_initial') โยน PipelineDeadlineError → ข่าวล้ม 504 หลังจ่ายค่า AI ทุกขั้นก่อนหน้าครบแล้ว
 *   (2) MC-14 — semanticSanityCheck (L4.6) เรียก claude-opus-5 โดยไม่ส่ง systemPrompt → callClaude แนบ system สายเขียนทั้งก้อน (~3,900 ตัวอักษร:
 *       HUMAN WRITING DNA "ถ้าสะดุด เขียนใหม่" + กฎความยาว + รายการคำห้าม) ให้งานตรวจที่ผลคือ "ชี้ประโยคที่จะถูกลบ" (คำสั่งขัดกัน · จ่ายโทเคนเปล่าทุกเวอร์ชัน)
 *       · ทางถอย luna (callAI) ก็โดน system ยาวของ openai.js เหมือนกัน · flagFixer (ปลดออกจากท่อ 12 มิ.ย.) มีหนี้เดียวกัน · fabricationGate ส่ง system สั้นอยู่แล้ว
 * วิธีแก้ (ค่าเริ่มต้น):
 *   - correctionAiCall(step, factory, { signal }) = withTimeoutSignal ตัวเดิม (src/lib/utils/withTimeout.js) เพดานต่อครั้ง CORRECTION_AI_TIMEOUT_MS (ค่าเริ่มต้น 60000)
 *     · factory(signal) รับ AbortSignal ที่รวม เพดานต่อครั้ง + signal ผู้เรียก + เส้นตายรวม → ส่งต่อให้ client ยกเลิก HTTP จริง (ตัดจ่ายซ้อน)
 *     · เวลารวมเหลือไม่พอเพดาน → assertCanStart โยน PipelineDeadlineError ก่อนเรียก = ข้ามด่านนั้นทันที (ไม่จ่ายเงิน · fail-open ตามเดิม)
 *     · timeout/ยกเลิก = error ธรรมดาที่ catch ของแต่ละด่านกลืนแบบ fail-open อยู่แล้ว: L4.6 claude → luna → ข้าม (คงเนื้อ) · L3B → แทนคำสั้น+ธง needs_review
 *       · L3A → คงประโยคเดิม (+เบรกเกอร์: หมดเวลาครั้งแรก = ประโยคที่เหลือของเวอร์ชันนั้นไม่เรียกซ้ำ เพราะ L3A เรียกทีละประโยคแบบลำดับ) · L1.8 → ปล่อยเนื้อเดิม
 *       ห้ามทำให้งานล้ม: ไม่มีด่านไหนโยนออกไปถึง runCorrectionPipeline/autoFlowServiceText
 *   - correctionAiExtras(signal, systemPrompt) = ก้อน { signal, systemPrompt } ที่ spread ท้าย args ของ callClaude/callAI — โหมดถอยคืน {} = args เดิมทุกไบต์
 *   - CORRECTION_CHECK_SYSTEM_PROMPT (งานตรวจ: L4.6 · flagFixer ตรวจมุมเปิด) / CORRECTION_FIX_SYSTEM_PROMPT (งานแก้เฉพาะจุด: flagFixer) = system สั้น
 *     = บทบาท + กฎเหล็ก 1–4 ยกข้อความตรงจาก claudeClient.js (แนวเดียวกับ EXTRACT_CLAUDE_SYSTEM_PROMPT ใน aiRouter.js — ไม่เขียนกฎใหม่ ไม่ใส่กฎสายเขียน/wordlist)
 *     · L3A/L3B (งานเกลาคำเสี่ยง/วลี AI) ไม่เปลี่ยน system ในขั้นนี้ (S5 เพิ่งจูนพรอมต์ — เปลี่ยน system = เปลี่ยนสำนวนผลเกลา ต้องเทียบแยก) · fabricationGate ใช้ GATE_*_SYS เดิม
 *       ★ 24 ก.ย. 69 (S8 — OV-04): L3A/L3B ได้ system สั้นแล้วผ่าน ../ai/taskSystemPrompts.js slimSystem() — สวิตช์ SYSTEM_PROMPT_SLIM (แยกอิสระจาก CORRECTION_CHECK_SYSTEM ของไฟล์นี้)
 * สวิตช์ถอย (อ่านตอนเรียกทุกครั้ง ไม่แคช · แยกอิสระ 2 ตัว):
 *   CORRECTION_AI_TIMEOUT_MS = 0 | off | legacy | false | no → ไม่ครอบเวลา ไม่ส่ง signal (การเรียก AI เหมือนเดิมทุกไบต์) · ตัวเลข >0 = เพดานต่อครั้ง (ms)
 *     · ไม่ตั้ง/ว่าง/ค่าเพี้ยน (ไม่ใช่ตัวเลข/ติดลบ) = 60000 (กันตั้งค่าผิดแล้วเพดานหาย)
 *   CORRECTION_CHECK_SYSTEM = 0 | off | false | no | legacy → ไม่ส่ง systemPrompt (ได้ system สายเขียน/กฎเหล็กยาวของ client เหมือนเดิม)
 *   ตั้งทั้งสองตัว = พฤติกรรมเดิมทุกไบต์ (PL-11 + MC-14 กลับมา) — ใช้ทำซ้ำบั๊ก/เทียบเท่านั้น
 * ข้อสอบ: tests/correction-ai-timeout-pl11.test.mjs (ทั้ง 2 โหมดสวิตช์ · ท่อ runCorrectionPipeline จริง + เส้นตายรวมจริง · mutation 6 แบบ)
 * ตัวอย่างก่อน/หลัง: C:\tmp\news-g1-samples\S7.md
 */

import { withTimeoutSignal } from '../utils/withTimeout.js';

export const CORRECTION_AI_TIMEOUT_DEFAULT_MS = 60_000;

const TIMEOUT_LEGACY_VALUES = new Set(['0', 'off', 'legacy', 'false', 'no']);
const SYSTEM_OFF_VALUES = new Set(['0', 'off', 'false', 'no', 'legacy']);

const cleanEnv = (raw) => String(raw).trim().replace(/^["']|["']$/g, '').trim().toLowerCase();

/**
 * เพดานเวลาต่อการเรียก AI 1 ครั้งในชั้น correction (ms) · null = โหมดถอย (ไม่ครอบ ไม่ส่ง signal)
 */
export function correctionAiTimeoutMs() {
  const raw = process.env.CORRECTION_AI_TIMEOUT_MS;
  if (raw == null) return CORRECTION_AI_TIMEOUT_DEFAULT_MS;
  const v = cleanEnv(raw);
  if (v === '') return CORRECTION_AI_TIMEOUT_DEFAULT_MS;
  if (TIMEOUT_LEGACY_VALUES.has(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return CORRECTION_AI_TIMEOUT_DEFAULT_MS; // ค่าเพี้ยน = ค่าปลอดภัย (ไม่ใช่ "ไม่มีเพดาน")
  return Math.round(n);
}

export function isCorrectionAiTimeoutLegacy() {
  return correctionAiTimeoutMs() === null;
}

/** ส่ง system prompt สั้นเฉพาะงานตรวจ/แก้เฉพาะจุดหรือไม่ (ค่าเริ่มต้น = ส่ง) */
export function isCorrectionCheckSystemEnabled() {
  const raw = process.env.CORRECTION_CHECK_SYSTEM;
  if (raw == null) return true;
  return !SYSTEM_OFF_VALUES.has(cleanEnv(raw));
}

/**
 * เรียก AI ในชั้น correction ภายใต้เพดานต่อครั้ง (async เสมอ — assertCanStart ที่โยนแบบ synchronous กลายเป็น rejection ให้ catch ของด่านรับ)
 * @param {string} step  ชื่อขั้นสำหรับ error/log เช่น 'correction:L4.6:claude-opus-5' (ไปโผล่ใน err.failedStep ของ withTimeout)
 * @param {(signal: AbortSignal|undefined) => Promise} factory  สร้าง promise การเรียก — ต้อง spread correctionAiExtras(signal, …) ท้าย args
 * @param {{ signal?: AbortSignal }} [opts]  signal ของผู้เรียก (runCorrectionPipeline → ด่าน) ถ้ามี
 */
export async function correctionAiCall(step, factory, { signal } = {}) {
  const ms = correctionAiTimeoutMs();
  if (ms === null) return factory(undefined); // โหมดถอย: เรียกตรงเหมือนเดิม (extras คืน {} → args เดิมทุกไบต์)
  return withTimeoutSignal(factory, ms, step, signal);
}

/**
 * ก้อน args เพิ่มสำหรับ callClaude/callAI ตามสวิตช์ — spread ท้าย object เดิม (โหมดถอยทั้งคู่ = {} → args เดิมทุกไบต์)
 * @param {AbortSignal|undefined} signal  จาก factory ของ correctionAiCall
 * @param {string} [systemPrompt]  system สั้นเฉพาะงาน (ไม่ส่ง = ไม่แตะ systemPrompt ของ call นั้น เช่น L3A/L3B/fabricationGate · ★ S8: L3A/L3B ใช้ slimSystem ของ taskSystemPrompts แทน)
 */
export function correctionAiExtras(signal, systemPrompt) {
  const out = {};
  if (!isCorrectionAiTimeoutLegacy()) out.signal = signal;
  if (systemPrompt && isCorrectionCheckSystemEnabled()) out.systemPrompt = systemPrompt;
  return out;
}

/** error จากเพดานเวลา/การยกเลิก (withTimeout ติด failedStep = ชื่อขั้น · เส้นตายรวม = PipelineDeadlineError) — ใช้ตัดสินเบรกเกอร์ L3A */
export function isCorrectionAiTimeout(err) {
  if (!err || typeof err !== 'object') return false;
  if (String(err.failedStep || '').startsWith('correction:')) return true;
  if (err.code === 'PIPELINE_DEADLINE_EXCEEDED' || err.errorType === 'PIPELINE_DEADLINE_EXCEEDED' || err.name === 'PipelineDeadlineError') return true;
  return err.name === 'AbortError' || /^TIMEOUT:/u.test(String(err.message || ''));
}

// กฎเหล็ก 1–4 ยกข้อความตรงจาก claudeClient.js (systemMsg ค่าเริ่มต้น) — ห้ามเขียนกฎใหม่ที่นี่ · กฎ 5–6 (ความยาว/โครงสร้างโพสต์/ลักษณนาม) และ
//   HUMAN WRITING DNA / FACEBOOK SAFETY เป็นกฎสายเขียน ไม่ใส่ (งานตรวจต้องคัดลอกข้อความพังตรงตัว — รายการคำห้ามทำให้โมเดลเลี่ยงคัดลอกคำเสี่ยง)
const IRON_RULES_1_TO_4 = `=== กฎเหล็ก DNA ระบบ (IRON RULES — บังคับทุกคำสั่ง ทุกโหมด ห้ามฝ่าฝืน) ===

[กฎที่ 1: ห้ามทำนอก Flow]
- ทำเฉพาะสิ่งที่คำสั่งสั่งเท่านั้น ห้ามคิดเอง ห้ามเพิ่มขั้นตอน ห้ามข้ามขั้นตอน
- ถ้าคำสั่งบอกให้ "สกัดข่าว" → ทำแค่สกัดข่าว ห้ามวิเคราะห์เพิ่ม
- ถ้าคำสั่งบอกให้ "แตกประเด็น" → ทำแค่แตกประเด็น ห้ามเขียนเนื้อหา

[กฎที่ 2: ห้ามแต่งเรื่อง]
- ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามเพิ่มข้อมูลจากความรู้ของตัวเอง
- ชื่อคน สถานที่ ตัวเลข วันที่ → ต้องตรงกับข่าวต้นฉบับ 100% ห้ามเดา ห้ามแก้
- ถ้าข่าวไม่ได้ระบุข้อมูลบางอย่าง → ห้ามสร้างขึ้นมาเอง ให้ข้ามไป
- สถานะบุคคล "ยังมีชีวิต/เสียชีวิตแล้ว" ต้องตรงต้นฉบับ 100% และต้องบอกให้ชัดในเนื้อหา — ถ้าต้นฉบับบอกว่าใครเสียชีวิตแล้ว ห้ามเล่าฉากอดีตของคนนั้นแบบละคำบอกการจากไป จนคนอ่านเข้าใจว่ายังมีชีวิตอยู่ (นี่คือการบิดเบือนร้ายแรงที่สุด ห้ามเกิดเด็ดขาด แม้พร้อมท์จะสั่งโทนอบอุ่น/ห้ามเศร้าก็ตาม — ความจริงมาก่อนโทนเสมอ)

[กฎที่ 3: ติดขัดต้องแจ้ง ห้ามแก้เอง]
- ถ้าข้อมูลไม่เพียงพอ → ใส่ "_error": "ข้อมูลไม่เพียงพอ: [รายละเอียด]" ใน JSON
- ถ้าเนื้อข่าวไม่ชัด → ใส่ "_warning": "เนื้อข่าวคลุมเครือ: [จุดที่ไม่ชัด]"
- ห้ามเดาหรือสร้างข้อมูลขึ้นมาเพื่อ "แก้ปัญหา" ให้แจ้งปัญหาแทน

[กฎที่ 4: JSON เท่านั้น]
- ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt
- ถ้า prompt มีเนื้อข่าวอยู่ระหว่าง === เนื้อข่าว === ให้ใช้ข้อมูลจากส่วนนั้นเท่านั้น

=== จบกฎเหล็ก DNA ===`;

/** งานตรวจ (ผลคือรายการ/คำตัดสิน ไม่ใช่เนื้อใหม่): L4.6 ชี้ประโยคพัง · flagFixer ตรวจมุมเปิดซ้ำ */
export const CORRECTION_CHECK_SYSTEM_PROMPT = `คุณเป็น AI ผู้ตรวจต้นฉบับข่าวของกองบรรณาธิการ — ตรวจตามคำสั่งเท่านั้น ห้ามเขียนใหม่ ห้ามแต่งเติม ห้ามเสนอสำนวนของตัวเอง
ข้อความที่ต้องอ้างถึง (เช่น brokenText) ให้คัดลอกตรงตัวจากเนื้อหาที่ให้มา ห้ามแก้คำ ห้ามเลี่ยงคำ
ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt

${IRON_RULES_1_TO_4}`;

/** งานแก้เฉพาะจุดตามคำสั่ง (ผลคือเนื้อฉบับแก้): flagFixer แก้จุดที่ธงชี้ */
export const CORRECTION_FIX_SYSTEM_PROMPT = `คุณเป็นบรรณาธิการแก้โพสต์ข่าวแบบเฉพาะจุดตามคำสั่ง — แก้เฉพาะจุดที่สั่ง ส่วนอื่นต้องเหมือนเดิมทุกตัวอักษร ห้ามเพิ่ม/ลดข้อเท็จจริง ห้ามเปลี่ยนโทน
ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt

${IRON_RULES_1_TO_4}`;
