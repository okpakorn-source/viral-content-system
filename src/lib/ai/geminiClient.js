/**
 * ========================================
 * GEMINI CLIENT — Google Gemini 2.0 Flash
 * ========================================
 * ใช้สำหรับ: Extraction (เร็ว + ถูก)
 * ราคา: $0.075/M input tokens (ถูกกว่า GPT-4o 50x!)
 * Context window: 1M tokens
 * 
 * ตั้งค่า: GEMINI_API_KEY ใน .env
 * สมัครฟรี: https://aistudio.google.com
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

let geminiClient = null;

function getGeminiClient() {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ GEMINI_API_KEY not set — Gemini disabled');
      return null;
    }
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  return geminiClient;
}

/**
 * เรียก Gemini — ส่ง prompt + response เป็น JSON
 * เหมาะสำหรับ: extraction, summarization, fast tasks
 */
export async function callGemini({ prompt, model = 'gemini-2.0-flash', temperature = 0.3, maxTokens = 4000 }) {
  const client = getGeminiClient();
  if (!client) throw new Error('GEMINI_API_KEY ไม่ได้ตั้งค่า — ไปตั้งค่าที่ Settings');

  console.log(`[Gemini] model=${model}, temp=${temperature}`);
  console.log(`[Gemini] prompt preview: ${prompt.slice(0, 300)}...`);

  const genModel = client.getGenerativeModel({
    model,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
    },
    systemInstruction: `คุณเป็น AI assistant ที่ต้องตอบเป็น JSON เท่านั้น
ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามแต่งเรื่องเพิ่ม

=== FACEBOOK SAFETY RULES ===
ห้ามใช้คำเสี่ยง ให้ rewrite เป็นคำปลอดภัย
เปลี่ยน "ความแรง" → "อารมณ์" เน้น emotional storytelling
=== จบ SAFETY RULES ===`,
  });

  const result = await genModel.generateContent(prompt);
  const content = result.response?.text();

  console.log(`[Gemini] OK: output=${content?.length || 0}ch`);

  if (!content) throw new Error('Gemini ไม่ส่งข้อมูลกลับ');

  try {
    return JSON.parse(content);
  } catch (e) {
    // ลอง extract JSON
    try {
      const startIdx = content.indexOf('{');
      const endIdx = content.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        return JSON.parse(content.slice(startIdx, endIdx + 1));
      }
    } catch (e2) {}
    console.error('[Gemini] JSON parse failed:', content.slice(0, 500));
    throw new Error('Gemini ส่งข้อมูลที่ parse ไม่ได้');
  }
}

/**
 * เช็คว่า Gemini พร้อมใช้งานหรือไม่
 */
export function isGeminiAvailable() {
  return !!process.env.GEMINI_API_KEY;
}
