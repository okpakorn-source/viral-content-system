export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getQuizForApplicant } from '@/lib/services/castingService';

// GET /api/casting/quiz → คำถามทั้งหมด (ซ่อนเฉลย, สุ่มลำดับ choice)
export async function GET() {
  try {
    const questions = await getQuizForApplicant();
    return NextResponse.json({ success: true, questions, total: questions.length });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, questions: [] }, { status: 500 });
  }
}
