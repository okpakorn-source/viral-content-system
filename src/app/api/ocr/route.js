import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image');

    if (!imageFile) {
      return NextResponse.json({ success: false, error: 'ไม่พบภาพ' }, { status: 400 });
    }

    // Convert to base64
    const bytes = await imageFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    const mimeType = imageFile.type || 'image/png';
    const dataUrl = `data:${mimeType};base64,${base64}`;

    console.log(`[OCR] Processing image: ${imageFile.name}, ${(buffer.length / 1024).toFixed(0)}KB, ${mimeType}`);

    // GPT-4o Vision OCR
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
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
[ข้อมูลอื่นๆ เช่น ยอดไลก์ คอมเมนต์ แชร์ แฮชแท็ก]`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'อ่านข้อความทั้งหมดจากภาพนี้ให้ครบถ้วน:' },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ]
        }
      ]
    });

    const ocrText = response.choices[0]?.message?.content || '';

    if (!ocrText || ocrText.length < 20) {
      return NextResponse.json({ success: false, error: 'ไม่สามารถอ่านข้อความจากภาพได้' });
    }

    // Extract title from first meaningful line
    const lines = ocrText.split('\n').filter(l => l.trim() && !l.startsWith('==='));
    const title = lines.find(l => l.length > 15 && l.length < 200) || 'ข่าวจากภาพ';

    console.log(`[OCR] ✅ Extracted ${ocrText.length}ch, title: "${title.substring(0, 50)}..."`);

    return NextResponse.json({
      success: true,
      text: ocrText,
      title: title.substring(0, 100),
      chars: ocrText.length,
      source: 'gpt-4o-vision',
    });

  } catch (error) {
    console.error('[OCR] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'อ่านภาพไม่สำเร็จ: ' + (error.message || 'Unknown error')
    }, { status: 500 });
  }
}
