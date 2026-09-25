/**
 * ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S8 · เจ้าของอนุมัติ) — OV-04 / MC-16: system prompt สั้นเฉพาะงาน สำหรับงานที่ไม่ใช่การเขียนโพสต์
 * ─────────────────────────────────────────────────────────────
 * บั๊ก (ผู้ตรวจ 2 คนยืนยัน · วัดจากโค้ดจริงด้วย SDK ปลอม):
 *   (1) OV-04 — system prompt ค่าเริ่มต้นของ callAI (openai.js ≈5,958 ตัวอักษร / 14.8KB) และ callClaude (claudeClient.js ≈3,890 ตัวอักษร)
 *       = HUMAN WRITING DNA นักเขียน + กฎที่ 5 "อย่างน้อย 180 คำ · 3 ย่อหน้า" + รายการคำเสี่ยง FACEBOOK SAFETY — งานที่ไม่ใช่การเขียน
 *       (แตกประเด็น sol/terra · blueprint sol · วิเคราะห์ DNA ข่าว luna · ตัวเลือกการ์ด B สาย luna · รีเสิร์ช · L3B/L3A) ไม่ส่ง systemPrompt
 *       จึงได้ก้อนนี้ไปด้วย ≈7 นัด/ข่าว (repo ประเมินเอง ~5,000 โทเคนเข้า/นัด ใน aiRouter.js) และได้คำสั่งขัดกันเอง
 *       (งาน JSON วิเคราะห์ถูกสั่งโครงโพสต์/ความยาว · L3B/L3A ถูกสั่ง "อย่างน้อย 180 คำ" ทั้งที่พรอมต์สั่ง "ห้ามยาวขึ้น")
 *   (2) MC-16 — ขั้นสกัด: มีแต่ claude-extract ที่ได้ system กฎสกัดล้วน (EXTRACT_CLAUDE_SYSTEM_PROMPT รอบแก้ M1 9 ก.ย. 69) ตัวสำรอง gemini ได้
 *       systemInstruction ฝังตายตัว (มีรายการคำห้าม) · gpt ได้ system สายเขียนทั้งก้อน → ข่าวเดียวกันได้ผลสกัดต่างกันตามโมเดลที่ตอบ
 * วิธีแก้ (ค่าเริ่มต้น):
 *   - ไฟล์นี้ = แหล่งเดียวของ system สั้นเฉพาะงาน: บทบาท 1–2 บรรทัด + บรรทัด JSON + กฎเหล็ก 1–4 "ยกข้อความตรง" จาก claudeClient.js
 *     (ไม่เขียนกฎใหม่ · ไม่ตัดกฎ · ไม่ใส่กฎที่ 5–6 / HUMAN WRITING DNA / FACEBOOK SAFETY wordlist — แนวเดียวกับ EXTRACT_CLAUDE_SYSTEM_PROMPT
 *     รอบแก้ M1 และ correctionAiGuard.js ของ S7) · ตัวเลือกการ์ด = บรรทัดเดียวชุดเดียวกับสาย claude ที่ใช้อยู่แล้ว
 *   - slimSystem(prompt) → { systemPrompt } spread ท้าย args ของ callAI/callClaude/callGemini ที่ call site งานที่ไม่ใช่การเขียน
 *     · โหมดถอยคืน {} = args เดิมทุกไบต์
 *   - taskSystemPrompt(task, callerSystemPrompt) → ค่าเริ่มต้นระดับ aiRouter (extract/breakdown/analyze) เมื่อ caller ไม่ส่ง · 'write' ไม่แทรกเด็ดขาด
 *   - EXTRACT_SYSTEM_PROMPT (ชื่อเดิม EXTRACT_CLAUDE_SYSTEM_PROMPT ใน aiRouter.js — ข้อความเดิมทุกไบต์) ใช้กับ "ทุกโมเดล" ใน chain สกัด
 *     (claude-extract → gemini → gpt) = MC-16 · callGemini รับ systemPrompt แล้ว (ไม่ส่ง = systemInstruction ฝังเดิมทุกไบต์)
 *   - ⚠️ system ของงานเขียน (callSmartAI('write') → systemMsg ค่าเริ่มต้นของ claudeClient/openai) ไม่ถูกแตะแม้แต่ไบต์เดียว (แคช + สูตรยุคปัง)
 * สวิตช์ถอย (อ่านตอนเรียกทุกครั้ง ไม่แคช):
 *   SYSTEM_PROMPT_SLIM = 0 | off | false | no | legacy → slimSystem คืน {} · router ไม่แทรกค่าเริ่มต้นและไม่ส่ง systemPrompt ให้ gemini/gpt4o
 *     = พฤติกรรมเดิมทุกไบต์ (claude-extract ยังได้ EXTRACT_SYSTEM_PROMPT ตามรอบแก้ M1 · ตัวสำรองได้ system ฝังของ client เดิม · งานอื่นได้ system สายเขียนเดิม)
 *   ไม่ตั้ง / ว่าง / ค่าอื่น = เปิด (ค่าเริ่มต้น)
 * ข้อสอบ: tests/system-prompt-slim-ov04.test.mjs (ทั้ง 2 โหมดสวิตช์ · router/gemini/openai/claude/safeCorrect จริง · mutation 8 แบบ)
 * ตัวอย่างก่อน/หลัง + โทเคนที่ลดได้ต่อ call site: C:\tmp\news-g1-samples\S8.md
 */

const SLIM_OFF_VALUES = new Set(['0', 'off', 'false', 'no', 'legacy']);
const cleanEnv = (raw) => String(raw).trim().replace(/^["']|["']$/g, '').trim().toLowerCase();

/** เปิดโหมด system สั้นเฉพาะงานหรือไม่ (ค่าเริ่มต้น = เปิด) — อ่าน env ทุกครั้ง ไม่แคช เพื่อให้เทสสลับค่าได้ */
export function isSystemPromptSlim() {
  const raw = process.env.SYSTEM_PROMPT_SLIM;
  if (raw == null) return true;
  const v = cleanEnv(raw);
  if (v === '') return true;
  return !SLIM_OFF_VALUES.has(v);
}

/**
 * ก้อน args เพิ่มสำหรับ callAI/callClaude/callGemini — spread ท้าย object เดิม
 * @param {string} [systemPrompt]  system สั้นเฉพาะงาน
 * @returns {{ systemPrompt?: string }}  โหมดถอย (SYSTEM_PROMPT_SLIM=0) หรือไม่มีข้อความ = {} → args เดิมทุกไบต์
 */
export function slimSystem(systemPrompt) {
  if (!systemPrompt || !isSystemPromptSlim()) return {};
  return { systemPrompt };
}

// กฎเหล็ก 1–4 ยกข้อความตรงจาก claudeClient.js (systemMsg ค่าเริ่มต้น) — ห้ามเขียนกฎใหม่ที่นี่ · กฎ 5–6 (ความยาว/โครงสร้างโพสต์/ลักษณนาม)
//   และ HUMAN WRITING DNA / FACEBOOK SAFETY เป็นกฎสายเขียน ไม่ใส่ (งานวิเคราะห์/สกัด/เกลาเฉพาะจุดต้องคงคำต้นฉบับ — รายการคำห้ามทำให้โมเดลเลี่ยงคำ)
//   ⚠️ ข้อความต้องเหมือน claudeClient.js/aiRouter.js (เดิม)/correctionAiGuard.js ทุกไบต์ — ข้อสอบล็อกไว้
export const IRON_RULES_1_TO_4 = `=== กฎเหล็ก DNA ระบบ (IRON RULES — บังคับทุกคำสั่ง ทุกโหมด ห้ามฝ่าฝืน) ===

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

const JSON_LINE = 'ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt';

/**
 * ขั้นสกัดข้อเท็จจริง — ทุกโมเดลใน chain (claude-extract → gemini → gpt) ได้ชุดเดียวกัน (MC-16)
 * ชื่อเดิม EXTRACT_CLAUDE_SYSTEM_PROMPT ใน aiRouter.js (★ 9 ก.ย. 69 รอบแก้ 1 finding M1 ผู้ตรวจอิสระ — เจ้าของอนุมัติ NEWS-LOCK-APPROVED) — ข้อความเดิมทุกไบต์
 */
export const EXTRACT_SYSTEM_PROMPT = `คุณเป็น AI ผู้สกัดข้อเท็จจริงจากเนื้อข่าว
${JSON_LINE}

${IRON_RULES_1_TO_4}`;

/** ขั้นแตกประเด็น (breakdown — sol → terra ถอย): ผลคือ JSON วิเคราะห์มุมเล่า ไม่ใช่เนื้อโพสต์ */
export const BREAKDOWN_SYSTEM_PROMPT = `คุณเป็น AI ผู้แตกประเด็นและวิเคราะห์มุมเล่าของข่าว — ผลลัพธ์คือ JSON วิเคราะห์ตามโครงที่ prompt กำหนด ไม่ใช่ข้อความโพสต์ ห้ามเขียนเนื้อหาโพสต์
${JSON_LINE}

${IRON_RULES_1_TO_4}`;

/** ขั้นวางโครงอารมณ์ (blueprint — sol): วางแผนอย่างเดียว ห้ามเขียนเนื้อหาจริง */
export const BLUEPRINT_SYSTEM_PROMPT = `คุณเป็น AI ผู้วางโครงอารมณ์ (blueprint) ของโพสต์ข่าวก่อนเขียน — วางแผนตามโครงที่ prompt กำหนดเท่านั้น ห้ามเขียนเนื้อหาจริง
${JSON_LINE}

${IRON_RULES_1_TO_4}`;

/** วิเคราะห์ DNA ข่าว (luna) เพื่อจับคู่การ์ดพร้อมท์ — STAGE 1 ทั้งในโหมด analyze และ getTopPrompts: ผลคือ metadata ไม่ใช่ข้อความโพสต์ */
export const NEWS_DNA_SYSTEM_PROMPT = `คุณเป็น AI วิเคราะห์ DNA ข่าว (หมวด/อารมณ์/ความขัดแย้ง/โครงเรื่อง) เพื่อให้ระบบจับคู่การ์ดพร้อมท์ — ผลลัพธ์คือ metadata วิเคราะห์ตามโครงที่ prompt กำหนด ไม่ใช่ข้อความโพสต์
${JSON_LINE}

${IRON_RULES_1_TO_4}`;

/** ขั้นรีเสิร์ช (callSmartAI('analyze') + callAI ถอย): ผลคือรายการข้อมูลเสริมตามโครงที่ prompt กำหนด */
export const RESEARCH_SYSTEM_PROMPT = `คุณเป็น AI ผู้ค้นข้อมูลเสริมข่าว (สถิติ กรณีคล้าย ความเห็นผู้เชี่ยวชาญ กฎหมาย ข้อมูลพื้นหลัง) — ผลลัพธ์คือรายการข้อมูลตามโครงที่ prompt กำหนด ไม่ใช่ข้อความโพสต์
${JSON_LINE}

${IRON_RULES_1_TO_4}`;

/**
 * ตัวเลือกการ์ด (จุดชี้ขาด B สาย luna + ตัวเลือกตรง STAGE 2.5) — ข้อความเดียวกับที่สาย claude ของจุด B ใช้อยู่แล้ว (15 ส.ค. 69)
 * งานเลือกจากตัวเลือกไม่ต้องการกฎเหล็กเต็มชุด (ตามแบบตัวเลือก A/B สาย claude ที่ใช้บรรทัดเดียว)
 */
export const CARD_PICKER_SYSTEM_PROMPT = 'คุณเป็นผู้เชี่ยวชาญเลือกการ์ดพร้อมท์ข่าวไวรัล ตอบเป็น JSON ตามที่สั่งเท่านั้น';

/** L3B — เกลาคำเสี่ยงเฉพาะจุด (rewrite ทั้งเนื้อแต่แก้เฉพาะคำที่สั่ง): ผลคือเนื้อฉบับแก้ ต้องไม่ยาวขึ้น */
export const CORRECTION_RISK_REWRITE_SYSTEM_PROMPT = `คุณเป็นบรรณาธิการเกลาคำเสี่ยงในโพสต์ข่าวให้ปลอดภัยสำหรับ Facebook แบบเฉพาะจุดตามคำสั่ง — แก้เฉพาะคำที่สั่ง ส่วนอื่นต้องเหมือนเดิมทุกตัวอักษร ห้ามเพิ่ม/ลดข้อเท็จจริง ห้ามเปลี่ยนโทน ห้ามยาวขึ้น
${JSON_LINE}

${IRON_RULES_1_TO_4}`;

/** L3A — เกลาวลีที่ฟังเหมือน AI ทีละประโยค: ผลคือประโยคฉบับแก้ ต้องไม่ยาวขึ้น */
export const CORRECTION_PHRASE_FIX_SYSTEM_PROMPT = `คุณเป็นบรรณาธิการเกลาประโยคในโพสต์ข่าวให้เป็นภาษาคนพูดจริงบน Facebook แบบเฉพาะจุดตามคำสั่ง — แก้เฉพาะคำ/วลีที่สั่ง ส่วนอื่นต้องเหมือนเดิมทุกตัวอักษร ห้ามเพิ่ม/ลดข้อเท็จจริง ห้ามเปลี่ยนโทน ห้ามยาวขึ้น
${JSON_LINE}

${IRON_RULES_1_TO_4}`;

/**
 * ค่าเริ่มต้นระดับ aiRouter ต่อ task เมื่อ caller ไม่ส่ง systemPrompt — ไม่มี 'write' โดยเจตนา (system นักเขียนเดิมทุกไบต์)
 * extract: ทุกโมเดลใน chain ได้ชุดเดียวกัน (MC-16) · breakdown/analyze: chain gpt4o/claude/gemini ได้ system วิเคราะห์แทน system สายเขียน
 */
export const TASK_SYSTEM_PROMPT = Object.freeze({
  extract: EXTRACT_SYSTEM_PROMPT,
  breakdown: BREAKDOWN_SYSTEM_PROMPT,
  analyze: RESEARCH_SYSTEM_PROMPT,
});

/**
 * system ที่ aiRouter ส่งต่อให้ทุกโมเดลใน chain ของ task นั้น
 * @param {string} task  'extract' | 'breakdown' | 'write' | 'analyze' | อื่นๆ
 * @param {string} [callerSystemPrompt]  ค่าที่ caller ส่งมา — ชนะเสมอ
 * @returns {string|undefined}  โหมดถอย / 'write' / task ที่ไม่มีในตาราง = ค่าจาก caller เท่านั้น (เหมือนเดิม)
 */
export function taskSystemPrompt(task, callerSystemPrompt) {
  if (callerSystemPrompt || task === 'write' || !isSystemPromptSlim()) return callerSystemPrompt;
  return TASK_SYSTEM_PROMPT[task];
}
