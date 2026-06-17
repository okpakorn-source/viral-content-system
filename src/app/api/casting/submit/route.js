export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { scoreAndSave } from '@/lib/services/castingService';

// POST /api/casting/submit { name, answers:[{questionId,choiceId}] } → ให้คะแนนฝั่งเซิร์ฟเวอร์ + เก็บผล
export async function POST(request) {
  try {
    const { name, answers } = await request.json();
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ success: false, error: 'กรุณากรอกชื่อก่อนส่ง', errorType: 'MISSING_NAME' }, { status: 400 });
    }
    if (!Array.isArray(answers) || answers.length === 0) {
      return NextResponse.json({ success: false, error: 'ยังไม่มีคำตอบ', errorType: 'NO_ANSWERS' }, { status: 400 });
    }
    const result = await scoreAndSave({ name: name.trim(), answers });
    return NextResponse.json({ success: true, result });
  } catch (e) {
    console.error('[Casting submit]', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
