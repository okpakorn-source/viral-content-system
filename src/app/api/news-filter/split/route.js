export const maxDuration = 60; // 60 วินาที — เพียงพอสำหรับ AI แยกประเด็น
import { NextResponse } from 'next/server';
import { splitTopics } from '@/lib/services/newsFilterService';

/**
 * POST /api/news-filter/split
 * แยก "เนื้อแก่นข่าว" ที่สกัดแล้ว ออกเป็นประเด็นย่อย (รัก/เงิน/ครอบครัว/อาชีพ)
 * เพื่อให้พนักงานหยิบส่งเจนทีละประเด็น → โพสต์ที่ชัดเจนประเด็นเดียว
 *
 * Body: { text: string }  — เนื้อแก่นข่าว (cleanText จากการสกัด)
 * Response: { success, data: { isSingleTopic, overview, topics: [{ id, emoji, category, title, summary, content, viralAngle, wordCount }] } }
 */
export async function POST(request) {
  try {
    const { text } = await request.json();
    if (!text || typeof text !== 'string' || text.trim().length < 20) {
      return NextResponse.json(
        { success: false, error: 'เนื้อหาสั้นเกินไป (ต้องมีอย่างน้อย 20 ตัวอักษร)', errorType: 'TEXT_TOO_SHORT' },
        { status: 400 }
      );
    }

    console.log(`[NewsFilter Split API] textLength=${text.length}`);
    const result = await splitTopics(text, {});

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[NewsFilter Split API] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'แยกประเด็นไม่สำเร็จ', errorType: 'SPLIT_FAILED' },
      { status: 500 }
    );
  }
}
