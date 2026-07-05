// ============================================================
// [ระบบทำปกออโต้] GET /api/cost  → สรุปต้นทุน API
//                 DELETE /api/cost → ล้างประวัติต้นทุน
// ============================================================

import { NextResponse } from 'next/server';
import { summarizeCost, clearCostLog } from '@/lib/costStore';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const summary = await summarizeCost();
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'สรุปต้นทุนไม่สำเร็จ', errorType: 'UNEXPECTED' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await clearCostLog();
    return NextResponse.json({ success: true, cleared: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
