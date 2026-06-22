import { NextResponse } from 'next/server';
import { scoreRawContent } from '@/lib/services/newsFilterService';

/**
 * POST /api/news-filter/score (22 มิ.ย. 69) — ให้คะแนน "เนื้อข่าวดิบ" ก่อนส่งเจน
 *  บอกพนักงาน: ภาพรวมกี่คะแนน / ผ่านอะไรแล้ว / ขาดอะไร / ต้องไปรีเสิร์ชอะไรเพิ่ม
 *  ★ เครื่องมือช่วยคนในระบบสกัดข่าว — แยกจากระบบทำข่าวอัตโนมัติ 100%
 * Body: { text } → { success, data: { total, grade, elements, strengths, missing, researchToAdd, verdict } }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const { text } = await request.json();
    if (!text || typeof text !== 'string' || text.trim().length < 30) {
      return NextResponse.json({ success: false, error: 'วางเนื้อข่าวดิบอย่างน้อย 1 ย่อหน้า', errorType: 'MISSING_TEXT' }, { status: 400 });
    }
    const result = await scoreRawContent(text);
    if (!result.success) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[NewsFilter:score]', error.message);
    return NextResponse.json({ success: false, error: error.message || 'ตรวจคะแนนล้มเหลว', errorType: 'SCORE_ERROR' }, { status: 500 });
  }
}
