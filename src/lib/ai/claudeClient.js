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

  const systemMsg = systemPrompt || `คุณเป็น AI assistant ที่เชี่ยวชาญการเขียนภาษาไทย
ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt
ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามแต่งเรื่องเพิ่ม

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
