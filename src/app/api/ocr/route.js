import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/ocr
 * รับ 2 formats:
 *  1. FormData: form.get('image') — single file upload (ใช้จาก manual UI)
 *  2. JSON: { images: string[], mode: string } — base64 array (ใช้จาก /api/auto/process)
 */
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let dataUrls = [];
    let mode = 'full';

    // ── Format 1: FormData (single image upload from UI) ──────────
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const imageFile = formData.get('image');

      if (!imageFile) {
        return NextResponse.json({ success: false, error: 'ไม่พบภาพ' }, { status: 400 });
      }

      const bytes    = await imageFile.arrayBuffer();
      const buffer   = Buffer.from(bytes);
      const base64   = buffer.toString('base64');
      const mimeType = imageFile.type || 'image/png';
      dataUrls = [`data:${mimeType};base64,${base64}`];
      console.log(`[OCR] FormData: ${imageFile.name}, ${(buffer.length / 1024).toFixed(0)}KB`);

    // ── Format 2: JSON { images: base64[], mode } (from process route) ─
    } else {
      const body = await request.json();
      mode = body.mode || 'full';

      const rawImages = body.images || (body.imageData ? [body.imageData] : []);
      if (!rawImages || rawImages.length === 0) {
        return NextResponse.json({ success: false, error: 'ไม่พบภาพ' }, { status: 400 });
      }

      // Normalize each image to data URL format
      dataUrls = rawImages.slice(0, 4).map(img => {
        if (!img || typeof img !== 'string') return null;
        // Already a data URL
        if (img.startsWith('data:')) return img;
        // Raw base64 — assume JPEG
        return `data:image/jpeg;base64,${img}`;
      }).filter(Boolean);

      if (dataUrls.length === 0) {
        return NextResponse.json({ success: false, error: 'รูปภาพไม่ถูกต้อง' }, { status: 400 });
      }
      console.log(`[OCR] JSON: ${dataUrls.length} image(s), mode: ${mode}`);
    }

    // ── Build vision message content ─────────────────────────────
    const imageContent = dataUrls.map(url => ({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    }));

    // ── GPT-4o Vision OCR ─────────────────────────────────────────
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
            { type: 'text', text: `อ่านข้อความทั้งหมดจาก ${dataUrls.length > 1 ? dataUrls.length + ' ภาพ' : 'ภาพ'}นี้ให้ครบถ้วน:` },
            ...imageContent,
          ],
        },
      ],
    });

    const ocrText = response.choices[0]?.message?.content || '';

    if (!ocrText || ocrText.length < 20) {
      return NextResponse.json({ success: false, error: 'ไม่สามารถอ่านข้อความจากภาพได้' });
    }

    // Extract title from first meaningful line
    const lines = ocrText.split('\n').filter(l => l.trim() && !l.startsWith('==='));
    const title = lines.find(l => l.length > 15 && l.length < 200) || 'ข่าวจากภาพ';

    console.log(`[OCR] ✅ ${dataUrls.length} image(s) → ${ocrText.length}ch, title: "${title.substring(0, 50)}..."`);

    return NextResponse.json({
      success: true,
      text:    ocrText,
      result:  ocrText,   // alias for process/route.js compatibility
      title:   title.substring(0, 100),
      chars:   ocrText.length,
      source:  'gpt-4o-vision',
      imageCount: dataUrls.length,
    });

  } catch (error) {
    console.error('[OCR] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'อ่านภาพไม่สำเร็จ: ' + (error.message || 'Unknown error'),
    }, { status: 500 });
  }
}
