import OpenAI from 'openai';
import { MODEL_VISION } from '@/lib/ai/modelConfig';
import { callGeminiVision, isGeminiAvailable } from '@/lib/ai/geminiClient';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * ★ Gemini Vision fallback — เดิม router ประกาศว่ามี fallback แต่โค้ดจริงใช้ OpenAI อย่างเดียว
 * (OpenAI ล่ม = pipeline รูปภาพตายทั้งเส้น)
 */
async function performOcrWithGemini(dataUrls) {
  const images = dataUrls.map(url => {
    const m = url.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    return m
      ? { mimeType: m[1], data: m[2] }
      : { mimeType: 'image/jpeg', data: url.replace(/^data:[^,]*,/, '') };
  });

  const result = await callGeminiVision({
    prompt: `อ่านข้อความทั้งหมดจากภาพ (OCR ภาษาไทย) ให้ครบถ้วน — หัวข้อข่าว เนื้อหา ชื่อเพจ/แหล่งที่มา วันที่ ข้อความบนภาพ ยอดไลก์/แชร์
ตอบเป็น JSON: { "title": "หัวข้อที่สรุปจากภาพ", "ocr_text": "ข้อความทั้งหมดที่อ่านได้ จัดรูปแบบให้อ่านง่าย แยกส่วน ===แหล่งที่มา=== ===เนื้อหาหลัก=== ===ข้อความจากภาพ===" }`,
    images,
    temperature: 0.1,
    maxTokens: 4000,
  });

  const ocrText = result?.ocr_text || result?.text || '';
  if (!ocrText || ocrText.length < 20) {
    throw new Error('Gemini Vision อ่านข้อความจากภาพไม่ได้');
  }
  return {
    success: true,
    text:    ocrText,
    result:  ocrText,
    title:   (result?.title || ocrText.slice(0, 80)).substring(0, 100),
    chars:   ocrText.length,
    source:  'gemini-vision-fallback',
    imageCount: dataUrls.length,
  };
}

/**
 * Perform GPT-4o Vision OCR on base64 images or data URLs
 * 
 * @param {object} params
 * @param {string[]} [params.images] - Array of base64 strings or data URLs
 * @param {string} [params.mode] - OCR mode (e.g. 'full')
 * @param {string[]} [params.dataUrls] - Optional pre-normalized data URLs
 * @returns {Promise<object>} - OCR result with text, title, chars, etc.
 */
export async function performOcr({ images = [], mode = 'full', dataUrls = [] }) {
  let finalDataUrls = [...dataUrls];

  if (finalDataUrls.length === 0) {
    if (!images || images.length === 0) {
      throw new Error('ไม่พบภาพสำหรับประมวลผล OCR');
    }

    // Normalize each image to data URL format
    finalDataUrls = images.slice(0, 4).map(img => {
      if (!img || typeof img !== 'string') return null;
      if (img.startsWith('data:')) return img;
      return `data:image/jpeg;base64,${img}`;
    }).filter(Boolean);
  }

  if (finalDataUrls.length === 0) {
    throw new Error('รูปภาพไม่ถูกต้อง');
  }

  console.log(`[OCR-Service] Processing ${finalDataUrls.length} image(s), mode: ${mode}`);

  // Build vision message content
  const imageContent = finalDataUrls.map(url => ({
    type: 'image_url',
    image_url: { url, detail: 'high' },
  }));

  // ★ GPT-5.5 compatibility
  const _isNew = MODEL_VISION.startsWith('gpt-5') || MODEL_VISION.startsWith('o1') || MODEL_VISION.startsWith('o3');
  let response;
  try {
    response = await openai.chat.completions.create({
    model:      MODEL_VISION,
    ...(_isNew ? { max_completion_tokens: 4000 } : { max_tokens: 4000 }),
    messages: [
      {
        role: 'system',
        content: `คุณเป็นผู้เชี่ยวชาญอ่านข้อความจากภาพ (OCR) โดยเฉพาะภาษาไทย
งานของคุณ:
1. อ่านข้อความทั้งหมดจากภาพ — ทั้งหัวข้อข่าว เนื้อหา ชื่อเพจ/แหล่งที่มา วันที่ ยอดไลก์/แชร์
2. จัดรูปแบบให้อ่านง่าย แยกส่วนชัดเจน
3. ระบุแหล่งที่มาจากภาพ (เช่น ชื่อเพจ Facebook, สำนักข่าว)
4. รวมข้อมูลเสริมจากภาพ เช่น ตัวเลข สถิติ ข้อความบนภาพ
5. แปลข้อความเทพ — อ่านแม้ข้อความเล็ก/เอียง/ซ้อนบนรูป

ตอบในรูปแบบ:
===แหล่งที่มา===
[ชื่อเพจ/สำนักข่าว + วันที่ + ยอดปฏิสัมพันธ์ถ้ามี]

===เนื้อหาหลัก===
[ข้อความเนื้อหาจากโพสต์/ข่าว]

===ข้อความจากภาพ/กราฟิก===
[ข้อความที่พิมพ์อยู่บนรูปภาพ เช่น ข้อความบนภาพ thumbnail]

===ข้อมูลเสริม===
[ข้อมูลอื่นๆ เช่น ยอดไลก์ คอมเมนต์ แชร์ แฮชแท็ก]`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `อ่านข้อความทั้งหมดจาก ${finalDataUrls.length > 1 ? finalDataUrls.length + ' ภาพ' : 'ภาพ'}นี้ให้ครบถ้วน:` },
          ...imageContent,
        ],
      },
    ],
    });
  } catch (openaiErr) {
    // ★ OpenAI Vision ล่ม → fallback Gemini Vision (เดิมตายทั้ง pipeline รูปภาพ)
    console.warn(`[OCR-Service] ⚠️ OpenAI Vision failed: ${openaiErr.message}`);
    if (isGeminiAvailable()) {
      console.log('[OCR-Service] 🔄 Falling back to Gemini Vision...');
      return performOcrWithGemini(finalDataUrls);
    }
    throw openaiErr;
  }

  const ocrText = response.choices[0]?.message?.content || '';

  if (!ocrText || ocrText.length < 20) {
    // ★ OpenAI อ่านไม่ได้ → ลอง Gemini ก่อนยอมแพ้
    if (isGeminiAvailable()) {
      console.log('[OCR-Service] 🔄 OpenAI returned empty — falling back to Gemini Vision...');
      return performOcrWithGemini(finalDataUrls);
    }
    throw new Error('ไม่สามารถอ่านข้อความจากภาพได้');
  }

  // Extract title from first meaningful line
  const lines = ocrText.split('\n').filter(l => l.trim() && !l.startsWith('==='));
  const title = lines.find(l => l.length > 15 && l.length < 200) || 'ข่าวจากภาพ';

  console.log(`[OCR-Service] ✅ Done: ${ocrText.length}ch, title: "${title.substring(0, 50)}..."`);

  return {
    success: true,
    text:    ocrText,
    result:  ocrText,
    title:   title.substring(0, 100),
    chars:   ocrText.length,
    source:  'gpt-4o-vision',
    imageCount: finalDataUrls.length,
  };
}
