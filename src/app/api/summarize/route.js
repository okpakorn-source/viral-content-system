import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';

/**
 * POST /api/summarize — สรุปใจความสำคัญจากเนื้อหาต้นทาง
 */
export async function POST(request) {
  try {
    const { text, sourceType } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    const sourceLabel = {
      url: 'บทความ/ข่าว',
      raw: 'ข้อความ',
      facebook: 'โพสต์ Facebook',
      tiktok: 'คลิป TikTok',
      youtube: 'วิดีโอ YouTube',
    }[sourceType] || 'เนื้อหา';

    const prompt = `สรุปใจความสำคัญจาก${sourceLabel}ต่อไปนี้ ให้ได้ประเด็นหลักที่ชัดเจน กระชับ เข้าใจง่าย

เนื้อหาต้นทาง:
"""
${text.slice(0, 4000)}
"""

ตอบเป็น JSON:
{
  "title": "หัวข้อหลักของเนื้อหา (1 บรรทัด)",
  "summary": "สรุปใจความ 3-5 บรรทัด เขียนเป็นภาษาที่เข้าใจง่าย",
  "key_points": ["ประเด็นสำคัญ 1", "ประเด็นสำคัญ 2", "ประเด็นสำคัญ 3"],
  "people_involved": ["ชื่อบุคคลที่เกี่ยวข้อง (ถ้ามี)"],
  "emotion": "อารมณ์หลักของเนื้อหา (เช่น สะเทือนใจ, ตื่นเต้น, โกรธ, ตลก)",
  "content_type": "ประเภทเนื้อหา (เช่น ข่าว, ดราม่า, ให้ความรู้, บันเทิง)",
  "word_count": ${text.split(/\s+/).length}
}`;

    const result = await callAI({
      systemPrompt: 'คุณคือ AI สรุปเนื้อหา — สรุปใจความสำคัญให้กระชับ ชัดเจน เข้าใจง่าย ตอบเป็น JSON เท่านั้น',
      userPrompt: prompt,
    });

    let summary;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      summary = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      summary = {
        title: text.slice(0, 60),
        summary: text.slice(0, 300),
        key_points: ['ไม่สามารถสรุปอัตโนมัติได้'],
        emotion: 'ไม่ระบุ',
        content_type: 'ทั่วไป',
      };
    }

    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error('Summarize API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
