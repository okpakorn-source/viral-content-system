import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';

// ดึง saved prompts (ถ้ามี)
async function getSavedPrompts() {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/prompts`, { cache: 'no-store' });
    const data = await res.json();
    return data.success ? data.data : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/summarize — AI Pipeline:
 * 1. AI ตัวที่ 1: สกัดเนื้อข่าวจริง (ใช้ extraction prompt)
 * 2. AI ตัวที่ 2: วิเคราะห์ประเด็น + สรุป (ใช้ analysis prompt)
 */
export async function POST(request) {
  try {
    const { text, sourceType, customPrompt } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    // ===== AI ตัวที่ 1: สกัดเนื้อข่าวจริง =====
    const extractionSystem = 'คุณคือ AI สกัดเนื้อข่าว — ดึงเฉพาะเนื้อหาข่าวจริงออกมา ตัดส่วนที่ไม่เกี่ยวข้องออก เช่น เมนูเว็บ, โฆษณา, ลิงก์โซเชียล ตอบเป็น JSON เท่านั้น';

    const extractionUser = `จากข้อความที่ได้มาจากเว็บไซต์ด้านล่าง ให้สกัดเฉพาะ "เนื้อข่าว/เนื้อหาหลัก" ออกมา
ตัดส่วนที่ไม่เกี่ยวข้องออก เช่น เมนูเว็บ, โฆษณา, ลิงก์ข่าวอื่น, ข้อความ copyright, ลิงก์โซเชียลมีเดีย

${customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : ''}

ข้อความ:
"""
${text.slice(0, 6000)}
"""

ตอบเป็น JSON:
{
  "news_title": "หัวข้อข่าวหลัก",
  "news_body": "เนื้อข่าวทั้งหมดที่สกัดได้ (เขียนต่อเนื่อง ครบถ้วน ไม่ตัดทอน)",
  "news_source": "แหล่งที่มา/สำนักข่าว (ถ้ามี)",
  "news_date": "วันที่ข่าว (ถ้ามี)",
  "news_category": "หมวดหมู่ข่าว (เช่น บันเทิง, อาชญากรรม, การเมือง, เศรษฐกิจ)"
}`;

    const extractResult = await callAI({
      systemPrompt: extractionSystem,
      userPrompt: extractionUser,
      temperature: 0.3,
    });

    let newsData;
    try {
      const jsonMatch = extractResult.match(/\{[\s\S]*\}/);
      newsData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      newsData = { news_title: text.slice(0, 60), news_body: text.slice(0, 3000), news_category: 'ทั่วไป' };
    }

    // ===== AI ตัวที่ 2: วิเคราะห์ประเด็น =====
    const analysisSystem = 'คุณคือ AI วิเคราะห์ข่าว — วิเคราะห์ประเด็น สรุปใจความ แนะนำมุมมอง ตอบเป็น JSON เท่านั้น';

    const analysisUser = `วิเคราะห์ข่าวต่อไปนี้:

หัวข้อ: ${newsData.news_title}
เนื้อข่าว:
"""
${newsData.news_body?.slice(0, 4000)}
"""

ตอบเป็น JSON:
{
  "summary": "สรุปข่าวใน 3-5 ประโยค",
  "key_points": ["ประเด็นสำคัญ 1", "ประเด็นสำคัญ 2", "ประเด็นสำคัญ 3"],
  "people_involved": ["ชื่อบุคคลที่เกี่ยวข้อง"],
  "emotion": "อารมณ์หลักของข่าว",
  "content_type": "ประเภทเนื้อหา",
  "viral_potential": "สูง/กลาง/ต่ำ — พร้อมเหตุผลสั้นๆ",
  "suggested_angles": ["มุมมองที่น่าสนใจ 1", "มุมมอง 2", "มุมมอง 3"],
  "target_audience": "กลุ่มเป้าหมายที่เหมาะ"
}`;

    const analyzeResult = await callAI({
      systemPrompt: analysisSystem,
      userPrompt: analysisUser,
      temperature: 0.5,
    });

    let analysis;
    try {
      const jsonMatch = analyzeResult.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      analysis = {
        summary: newsData.news_body?.slice(0, 300),
        key_points: ['ไม่สามารถวิเคราะห์อัตโนมัติได้'],
        emotion: 'ไม่ระบุ', content_type: newsData.news_category || 'ทั่วไป',
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        newsTitle: newsData.news_title,
        newsBody: newsData.news_body,
        newsSource: newsData.news_source,
        newsDate: newsData.news_date,
        newsCategory: newsData.news_category,
        ...analysis,
      },
    });
  } catch (error) {
    console.error('Summarize API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
