import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  // GPT-4o Vision OCR
  const response = await openai.chat.completions.create({
    model:      'gpt-4o',
    max_tokens: 4000,
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

  const ocrText = response.choices[0]?.message?.content || '';

  if (!ocrText || ocrText.length < 20) {
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
