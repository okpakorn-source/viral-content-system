/**
 * ========================================
 * CLAUDE CLIENT — Anthropic Claude Sonnet 4.6
 * ========================================
 * ใช้สำหรับ: Content Writing (ภาษาไทยดีกว่า GPT-4o)
 * ราคา: $3/M input, $15/M output tokens
 * 
 * ตั้งค่า: ANTHROPIC_API_KEY ใน .env
 */
import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './usageLogger';
import { sanitizeOutput } from './safetyFilter';

let claudeClient = null;

// ★ A/B switch: เปลี่ยน model เขียนได้จาก .env โดยไม่ต้องแก้โค้ด
//   เช่น CLAUDE_WRITE_MODEL=claude-opus-4-8 (default = claude-sonnet-4-6)
const DEFAULT_WRITE_MODEL = process.env.CLAUDE_WRITE_MODEL || 'claude-sonnet-4-6';

// Opus 4.7+ / Fable ไม่รับ sampling params (temperature/top_p/top_k → 400)
function modelRejectsSampling(model) {
  return /^claude-(opus-4-[78]|fable)/.test(model);
}

function getClaudeClient() {
  if (!claudeClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ ANTHROPIC_API_KEY not set — Claude disabled');
      return null;
    }
    claudeClient = new Anthropic({ apiKey });
  }
  return claudeClient;
}

/**
 * เรียก Claude — ส่ง prompt เดียว + system prompt
 * Return: parsed JSON object
 */
export async function callClaude({ prompt, systemPrompt, model = DEFAULT_WRITE_MODEL, temperature = 0.7, maxTokens = 8000 }) {
  const client = getClaudeClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY ไม่ได้ตั้งค่า — ไปตั้งค่าที่ Settings');

  const systemMsg = systemPrompt || `คุณเป็น AI assistant ที่เชี่ยวชาญการเขียนภาษาไทยสำหรับ Facebook
ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt

=== กฎเหล็ก DNA ระบบ (IRON RULES — บังคับทุกคำสั่ง ทุกโหมด ห้ามฝ่าฝืน) ===

[กฎที่ 1: ห้ามทำนอก Flow]
- ทำเฉพาะสิ่งที่คำสั่งสั่งเท่านั้น ห้ามคิดเอง ห้ามเพิ่มขั้นตอน ห้ามข้ามขั้นตอน
- ถ้าคำสั่งบอกให้ "สกัดข่าว" → ทำแค่สกัดข่าว ห้ามวิเคราะห์เพิ่ม
- ถ้าคำสั่งบอกให้ "แตกประเด็น" → ทำแค่แตกประเด็น ห้ามเขียนเนื้อหา

[กฎที่ 2: ห้ามแต่งเรื่อง]
- ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามเพิ่มข้อมูลจากความรู้ของตัวเอง
- ชื่อคน สถานที่ ตัวเลข วันที่ → ต้องตรงกับข่าวต้นฉบับ 100% ห้ามเดา ห้ามแก้
- ถ้าข่าวไม่ได้ระบุข้อมูลบางอย่าง → ห้ามสร้างขึ้นมาเอง ให้ข้ามไป

[กฎที่ 3: ติดขัดต้องแจ้ง ห้ามแก้เอง]
- ถ้าข้อมูลไม่เพียงพอ → ใส่ "_error": "ข้อมูลไม่เพียงพอ: [รายละเอียด]" ใน JSON
- ถ้าเนื้อข่าวไม่ชัด → ใส่ "_warning": "เนื้อข่าวคลุมเครือ: [จุดที่ไม่ชัด]"
- ห้ามเดาหรือสร้างข้อมูลขึ้นมาเพื่อ "แก้ปัญหา" ให้แจ้งปัญหาแทน

[กฎที่ 4: JSON เท่านั้น]
- ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt
- ถ้า prompt มีเนื้อข่าวอยู่ระหว่าง === เนื้อข่าว === ให้ใช้ข้อมูลจากส่วนนั้นเท่านั้น

[กฎที่ 5: โครงสร้างเนื้อหา Facebook]
- เนื้อหาต้องยาวอย่างน้อย 250 คำ หรือ 3 ย่อหน้าเต็ม (แต่ละย่อหน้า 3-5 ประโยค คั่นด้วย \n\n)
- โครงสร้าง: [เปิดแรง hook] → [เล่ารายละเอียด storytelling] → [ปิดด้วยประโยคบรรยายทรงพลัง]
- ⚠️ ห้ามตั้งคำถามปิดท้าย ห้ามจบด้วย "คุณคิดยังไง?" "เห็นด้วยไหม?" — ปิดด้วยบรรยายเท่านั้น
- ห้ามเขียนสั้น ห้ามสรุปรวบรัด ต้องเล่าเรื่องเต็มที่เหมือนโพสต์ Facebook จริง

=== จบกฎเหล็ก DNA ===

=== HUMAN WRITING DNA V2 (MASTER INSTRUCTION — บังคับทุกเนื้อหา) ===

คุณไม่ใช่ AI เขียนข่าว — คุณคือ "มนุษย์ที่เล่าเรื่องเก่งมาก"

[ MUST DO ]
- เขียนเหมือนเล่าให้เพื่อนฟัง ไม่ใช่รายงานข่าว
- ใช้สำนวนคนจริง: ใจหาย, ขนลุก, เจ็บแทน, น้ำตาจะไหล, อึ้งไปเลย
- สลับประโยคสั้น-ยาว สร้างจังหวะหายใจ
- ห้ามซ้ำคำเดียวกันเกิน 2 ครั้งในข่าวเดียว
- ห้ามเปิดทุกย่อหน้าด้วยรูปแบบเดิม
- ทุกคำต้องมีน้ำหนัก ตัดคำลอยออกหมด

[ AUTO CLEAN ก่อนส่ง ]
PASS 1: ลบคำฟุ่มเฟือย
PASS 2: เปลี่ยนภาษาทางการเป็นภาษามนุษย์
PASS 3: ตรวจคำซ้ำ — ถ้าซ้ำเกิน 2 ครั้งให้เปลี่ยนสำนวน
PASS 4: ตรวจกลิ่น AI — ถ้ามีคำจาก FORBIDDEN ให้เปลี่ยนทันที
PASS 5: อ่านใหม่เหมือนคนอ่านจริง — ถ้าสะดุด เขียนใหม่
=== จบ HUMAN WRITING DNA V2 ===

=== FACEBOOK SAFETY RULES ===
ห้ามใช้คำเสี่ยง: ฆ่า, ศพ, สยอง, โหด, เลือด, ข่มขืน, ผูกคอ, ดับสลด, เสียชีวิต, บาดเจ็บสาหัส, สะเก็ดระเบิด, ระเบิด, สนามรบ, คลิปหลุด, อาวุธ, กระสุน, เลือดสาด, ฆ่าตัวตาย
ใช้แทน: จากไป, ร่างผู้เสียหาย, น่าตกใจ, รุนแรง, ร่องรอยเหตุการณ์, ล่วงละเมิดทางเพศ, จากไปอย่างน่าเศร้า, ได้รับบาดเจ็บหนัก, เหตุการณ์ไม่คาดฝัน, พื้นที่ปฏิบัติหน้าที่
เปลี่ยน "ความแรง" → "อารมณ์" เน้น emotional storytelling
=== จบ SAFETY RULES ===`;

  const stripSampling = modelRejectsSampling(model);
  console.log(`[Claude] model=${model}, temp=${stripSampling ? 'n/a (opus4.7+)' : temperature}, maxTokens=${maxTokens}`);
  console.log(`[Claude] prompt preview: ${prompt.slice(0, 300)}...`);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    // ★ Opus 4.7/4.8/Fable: ห้ามส่ง temperature (API จะ 400) — คุมความหลากหลายผ่าน prompt แทน
    ...(stripSampling ? {} : { temperature }),
    system: systemMsg,
    messages: [
      { role: 'user', content: prompt + '\n\nตอบเป็น JSON เท่านั้น ห้ามมี text อื่นนอก JSON' }
    ],
  });

  const content = response.content?.[0]?.text;
  
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  console.log(`[Claude] OK: tokens input=${inputTokens}, output=${outputTokens}`);
  
  // Asynchronously log usage to DB
  logApiUsage({
    provider: 'anthropic',
    model,
    inputTokens,
    outputTokens,
    feature: 'callClaude'
  });

  if (!content) throw new Error('Claude ไม่ส่งข้อมูลกลับ');

  // Parse JSON จาก response
  try {
    // ★ BUG FIX: Strip ```json ``` wrapper before parsing (Claude wraps JSON in code blocks)
    let jsonStr = content;
    jsonStr = jsonStr.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();
    return sanitizeOutput(JSON.parse(jsonStr));
  } catch (e) {
    // ลอง parse ตรงๆ โดยหา { } ครอบ
    try {
      const startIdx = content.indexOf('{');
      const endIdx = content.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        return sanitizeOutput(JSON.parse(content.slice(startIdx, endIdx + 1)));
      }
    } catch (e2) {}
    console.error('[Claude] JSON parse failed:', content.slice(0, 500));
    throw new Error('Claude ส่งข้อมูลที่ parse ไม่ได้');
  }
}

/**
 * เช็คว่า Claude พร้อมใช้งานหรือไม่
 */
export function isClaudeAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}
