/**
 * ========================================
 * CLAUDE CLIENT — Anthropic Claude 3.5 Sonnet
 * ========================================
 * ใช้สำหรับ: Content Writing (ภาษาไทยดีกว่า GPT-4o)
 * ราคา: $3/M input, $15/M output tokens
 * 
 * ตั้งค่า: ANTHROPIC_API_KEY ใน .env
 */
import Anthropic from '@anthropic-ai/sdk';

let claudeClient = null;

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
export async function callClaude({ prompt, systemPrompt, model = 'claude-sonnet-4-20250514', temperature = 0.7, maxTokens = 8000 }) {
  const client = getClaudeClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY ไม่ได้ตั้งค่า — ไปตั้งค่าที่ Settings');

  const systemMsg = systemPrompt || `คุณเป็น AI assistant ที่เชี่ยวชาญการเขียนภาษาไทยสำหรับ Facebook
ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt
ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามแต่งเรื่องเพิ่ม

=== กฎความยาว ===
- เนื้อหาต้องยาวอย่างน้อย 250 คำ หรือ 3 ย่อหน้าเต็ม
- แต่ละย่อหน้าต้องมี 3-5 ประโยค คั่นด้วย \\n\\n
- โครงสร้าง: [เปิดแรง hook] → [เล่ารายละเอียด storytelling] → [ปิดด้วยประโยคบรรยายทรงพลัง สรุปแก่นอารมณ์]
- ห้ามเขียนสั้น ห้ามสรุปรวบรัด ต้องเล่าเรื่องให้เต็มที่
- ⚠️ ห้ามตั้งคำถามปิดท้ายเด็ดขาด ห้ามจบด้วย "คุณคิดยังไง?" "เห็นด้วยไหม?" — ปิดด้วยการบรรยายเท่านั้น
=== จบกฎความยาว ===

=== HUMAN WRITING DNA V2 ===
คุณไม่ใช่ AI เขียนข่าว — คุณคือ "มนุษย์ที่เล่าเรื่องเก่งมาก"

[ FORBIDDEN — ห้ามใช้คำเหล่านี้เด็ดขาด ]
ซึ่ง, ดังกล่าว, ทั้งนี้, อย่างไรก็ตาม, ถือเป็น, เรียกได้ว่า, นับว่า,
ได้มีการ, ภายหลังจาก, เพื่อเป็นการ, ในส่วนของ, จากกรณีดังกล่าว,
สร้างความฮือฮา, กลายเป็นกระแส, เป็นอย่างมาก, เป็นจำนวนมาก,
ท่ามกลาง, สร้างความประทับใจ, ได้ออกมาเปิดเผย, ถูกพูดถึง,
สร้างเสียงฮือฮา, ในขณะเดียวกัน, ซึ่งถือว่า, สืบเนื่อง,
เป็นอย่างยิ่ง, อย่างแท้จริง, สะท้อนให้เห็น, เป็นเครื่องยืนยัน
ห้ามใช้ภาษาข่าวทีวี ห้ามใช้ภาษาประกาศ ห้ามใช้ภาษารายงาน

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
ห้ามใช้คำเสี่ยง: ฆ่า, ศพ, สยอง, โหด, เลือด, ข่มขืน, ผูกคอ, ดับสลด
ใช้แทน: เสียชีวิต, ร่างผู้เสียชีวิต, สะเทือนใจ, รุนแรง, ร่องรอยเหตุการณ์, ล่วงละเมิดทางเพศ, เสียชีวิตอย่างน่าเศร้า
เปลี่ยน "ความแรง" → "อารมณ์" เน้น emotional storytelling
=== จบ SAFETY RULES ===`;

  console.log(`[Claude] model=${model}, temp=${temperature}, maxTokens=${maxTokens}`);
  console.log(`[Claude] prompt preview: ${prompt.slice(0, 300)}...`);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemMsg,
    messages: [
      { role: 'user', content: prompt + '\n\nตอบเป็น JSON เท่านั้น ห้ามมี text อื่นนอก JSON' }
    ],
  });

  const content = response.content?.[0]?.text;
  console.log(`[Claude] OK: tokens input=${response.usage?.input_tokens || '?'}, output=${response.usage?.output_tokens || '?'}`);

  if (!content) throw new Error('Claude ไม่ส่งข้อมูลกลับ');

  // Parse JSON จาก response
  try {
    // Claude อาจครอบ JSON ด้วย markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = jsonMatch[1].trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    // ลอง parse ตรงๆ
    try {
      const startIdx = content.indexOf('{');
      const endIdx = content.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        return JSON.parse(content.slice(startIdx, endIdx + 1));
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
