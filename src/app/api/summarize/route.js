import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';

/**
 * POST /api/summarize
 * AI สกัดเนื้อข่าวจริงออกมาแบบครบถ้วน (ไม่ย่อ ไม่ตัด)
 * ตัดเฉพาะส่วนที่ไม่ใช่ข่าว: เมนู, โฆษณา, ลิงก์โซเชียล
 */
export async function POST(request) {
  try {
    const { text, sourceType, customPrompt } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    // ===== AI ตัวที่ 1: สกัดเนื้อข่าวจริง (ครบถ้วน ไม่ย่อ) =====
    const systemPrompt = `คุณคือ AI News Content Extractor
หน้าที่ของคุณคือ: รับ raw text ที่ดึงมาจากเว็บไซต์ แล้วแยกเฉพาะ "เนื้อข่าว/เนื้อหาหลัก" ออกมา

สิ่งที่ต้องตัดออก:
- เมนูเว็บไซต์, navigation bar, breadcrumb
- ลิงก์โซเชียลมีเดีย (Facebook, TikTok, YouTube, X/Twitter URLs)
- โฆษณา, banner, popup
- ข้อความ copyright, footer
- ข้อความชวนติดตาม/subscribe
- ลิงก์ข่าวอื่นที่ไม่เกี่ยวข้อง
- ข้อความซ้ำ

สิ่งที่ต้องเก็บไว้:
- เนื้อข่าวทั้งหมด ครบทุกย่อหน้า ห้ามตัดทอน ห้ามย่อ
- คำพูด/คำให้สัมภาษณ์ของบุคคลในข่าว
- ข้อมูลตัวเลข สถิติ วันเวลา สถานที่
- ชื่อบุคคล องค์กร หน่วยงานที่เกี่ยวข้อง

ตอบเป็น JSON เท่านั้น`;

    const userPrompt = `สกัดเนื้อข่าวจริงจาก raw text ด้านล่าง
ห้ามย่อ ห้ามสรุป — เอาเนื้อข่าวมาทั้งหมดตามต้นฉบับ

${customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : ''}

=== RAW TEXT ===
${text.slice(0, 8000)}
================

ตอบเป็น JSON:
{
  "news_title": "หัวข้อข่าวหลัก (ถ้ามี)",
  "news_body": "เนื้อข่าวทั้งหมดที่สกัดได้ — ครบถ้วน ไม่ตัดทอน ไม่ย่อ คัดมาเฉพาะส่วนที่เป็นเนื้อหาข่าวจริงๆ",
  "news_source": "แหล่งที่มา/สำนักข่าว/ชื่อเว็บ (ถ้ามี)",
  "news_date": "วันที่ข่าว (ถ้ามี)",
  "news_category": "หมวดหมู่ เช่น การเมือง, บันเทิง, อาชญากรรม, เศรษฐกิจ, สังคม"
}`;

    const extractResult = await callAI({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
    });

    let newsData;
    try {
      const jsonMatch = extractResult.match(/\{[\s\S]*\}/);
      newsData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      newsData = null;
    }

    if (!newsData || !newsData.news_body || newsData.news_body.length < 20) {
      // Fallback: ใช้ raw text เดิมถ้า AI parse ไม่ได้
      newsData = {
        news_title: text.slice(0, 80),
        news_body: text.slice(0, 5000),
        news_source: '',
        news_date: '',
        news_category: 'ทั่วไป',
      };
    }

    // ===== AI ตัวที่ 2: วิเคราะห์ประเด็น (ใช้เนื้อข่าวที่สกัดแล้ว) =====
    const analysisPrompt = `วิเคราะห์ข่าวต่อไปนี้:

หัวข้อ: ${newsData.news_title}

เนื้อข่าว:
"""
${newsData.news_body.slice(0, 5000)}
"""

ตอบเป็น JSON:
{
  "summary": "สรุปใจความสำคัญของข่าวนี้ใน 2-4 ประโยค",
  "key_points": ["ประเด็นสำคัญ 1", "ประเด็นสำคัญ 2", "ประเด็นสำคัญ 3"],
  "people_involved": ["ชื่อบุคคลที่เกี่ยวข้อง"],
  "emotion": "อารมณ์หลักของข่าว (เช่น ตื่นเต้น, โกรธ, เศร้า, สะเทือนใจ)",
  "content_type": "ประเภทเนื้อหา",
  "viral_potential": "สูง/กลาง/ต่ำ — พร้อมเหตุผลสั้นๆ",
  "suggested_angles": ["มุมมองที่น่าสนใจสำหรับสร้างคอนเทนต์ 1", "มุมมอง 2", "มุมมอง 3"],
  "target_audience": "กลุ่มเป้าหมายที่เหมาะ"
}`;

    const analyzeResult = await callAI({
      systemPrompt: 'คุณคือ AI วิเคราะห์ข่าว — วิเคราะห์ประเด็นสำคัญ สรุปใจความ แนะนำมุมมอง ตอบเป็น JSON เท่านั้น',
      userPrompt: analysisPrompt,
      temperature: 0.5,
    });

    let analysis;
    try {
      const jsonMatch = analyzeResult.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      analysis = null;
    }

    if (!analysis) {
      analysis = {
        summary: 'ไม่สามารถวิเคราะห์อัตโนมัติได้',
        key_points: [],
        emotion: '', content_type: newsData.news_category || '',
        suggested_angles: [], viral_potential: '', target_audience: '',
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        // ผลจาก AI ตัวที่ 1 — เนื้อข่าวครบถ้วน
        newsTitle: newsData.news_title,
        newsBody: newsData.news_body,
        newsSource: newsData.news_source,
        newsDate: newsData.news_date,
        newsCategory: newsData.news_category,
        // ผลจาก AI ตัวที่ 2 — วิเคราะห์
        ...analysis,
      },
    });
  } catch (error) {
    console.error('Summarize API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
