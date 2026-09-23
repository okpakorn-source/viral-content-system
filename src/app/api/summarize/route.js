export const maxDuration = 400; // Allow ~6.5 minutes for heavy LLM operations — ★ 23 ก.ย. 69 (เจ้าของสั่ง): 300→400 เพราะโซ่นักเขียนหน้า content/new (opus-5-5 150 + fable 90 + sol 90 = 330s) เกิน 300 เดิม (ของเดิม: 300)
import { NextResponse } from 'next/server';
import { performSummarize } from '@/lib/services/summarizeService';

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await performSummarize(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Summarize API Endpoint] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'เกิดข้อผิดพลาดในการประมวลผล' },
      { status: 500 }
    );
  }
}
