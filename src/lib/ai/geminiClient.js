/**
 * ========================================
 * GEMINI CLIENT — Google Gemini 3.5 Flash
 * ========================================
 * ใช้สำหรับ: Extraction (เร็ว + ถูก + แม่น)
 * ★ อัปเกรด 10 มิ.ย. 2026: gemini-2.5-pro → gemini-3.5-flash (GA stable)
 *   - ใหม่กว่า 2 รุ่น, เร็วกว่า ~4 เท่า, ราคา $1.50/$9.00 ต่อ 1M tokens
 *   - ของเดิมตั้ง default เป็น "Pro" ทั้งที่คอมเมนต์ตั้งใจใช้ Flash (แพง+ช้าโดยไม่จำเป็น)
 * Context window: 1M tokens
 *
 * ตั้งค่า: GEMINI_API_KEY ใน .env
 * สมัครฟรี: https://aistudio.google.com
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logApiUsage } from './usageLogger';
import { sanitizeOutput } from './safetyFilter';

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
export async function callGemini({ prompt, model = 'gemini-3.5-flash', temperature = 0.3, maxTokens = 4000 }) {
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
ห้ามใช้คำเสี่ยง: ฆ่า, ศพ, สยอง, โหด, เลือด, ข่มขืน, ผูกคอ, ดับสลด, เสียชีวิต, บาดเจ็บสาหัส, สะเก็ดระเบิด, ระเบิด, สนามรบ, คลิปหลุด, อาวุธ, กระสุน, เลือดสาด, ฆ่าตัวตาย
ใช้แทน: จากไป, ร่างผู้เสียหาย, น่าตกใจ, รุนแรง, ร่องรอยเหตุการณ์, ล่วงละเมิดทางเพศ, จากไปอย่างน่าเศร้า, ได้รับบาดเจ็บหนัก, เหตุการณ์ไม่คาดฝัน, พื้นที่ปฏิบัติหน้าที่
เปลี่ยน "ความแรง" → "อารมณ์" เน้น emotional storytelling
=== จบ SAFETY RULES ===`,
  });

  const result = await genModel.generateContent(prompt, { requestOptions: { timeout: 15000 } });
  const content = result.response?.text();
  const usageMetadata = result.response?.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

  console.log(`[Gemini] OK: tokens input=${inputTokens}, output=${outputTokens}`);
  
  // Asynchronously log usage to DB
  logApiUsage({
    provider: 'gemini',
    model,
    inputTokens,
    outputTokens,
    feature: 'callGemini'
  });

  if (!content) throw new Error('Gemini ไม่ส่งข้อมูลกลับ');

  try {
    return sanitizeOutput(JSON.parse(content));
  } catch (e) {
    // ลอง extract JSON
    try {
      const startIdx = content.indexOf('{');
      const endIdx = content.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        return sanitizeOutput(JSON.parse(content.slice(startIdx, endIdx + 1)));
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

/**
 * เรียก Gemini Vision — ส่งภาพ (Base64) เข้าไปวิเคราะห์
 * images: [{ data: "base64...", mimeType: "image/jpeg" }, ...]
 */
export async function callGeminiVision({ prompt, images, model = 'gemini-3.5-flash', temperature = 0.2, maxTokens = 4000 }) {
  const client = getGeminiClient();
  if (!client) throw new Error('GEMINI_API_KEY ไม่ได้ตั้งค่า');

  console.log(`[GeminiVision] model=${model}, imagesCount=${images?.length || 0}`);

  const genModel = client.getGenerativeModel({
    model,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
    },
  });

  const promptParts = [
    prompt,
    ...images.map(img => ({
      inlineData: {
        data: img.data,
        mimeType: img.mimeType || 'image/jpeg'
      }
    }))
  ];

  const result = await genModel.generateContent(promptParts, { requestOptions: { timeout: 25000 } });
  const content = result.response?.text();
  const usageMetadata = result.response?.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

  console.log(`[GeminiVision] OK: tokens input=${inputTokens}, output=${outputTokens}`);
  
  logApiUsage({
    provider: 'gemini_vision',
    model,
    inputTokens,
    outputTokens,
    feature: 'callGeminiVision'
  });

  if (!content) throw new Error('Gemini ไม่ส่งข้อมูลกลับ');

  try {
    return sanitizeOutput(JSON.parse(content));
  } catch (e) {
    try {
      const startIdx = content.indexOf('{');
      const endIdx = content.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        return sanitizeOutput(JSON.parse(content.slice(startIdx, endIdx + 1)));
      }
      const arrStartIdx = content.indexOf('[');
      const arrEndIdx = content.lastIndexOf(']');
      if (arrStartIdx !== -1 && arrEndIdx !== -1) {
         return sanitizeOutput(JSON.parse(content.slice(arrStartIdx, arrEndIdx + 1)));
      }
    } catch (e2) {}
    console.error('[GeminiVision] JSON parse failed:', content.slice(0, 500));
    throw new Error('Gemini ส่งข้อมูลที่ parse ไม่ได้');
  }
}
