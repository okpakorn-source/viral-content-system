// ============================================================
// [ระบบทำปกออโต้] GET /api/cases — ดึงรายการคลังผลลัพธ์ล่าสุด
// ============================================================

import { NextResponse } from 'next/server';
import { listRecent } from '@/lib/caseStore';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const items = await listRecent(20);
    return NextResponse.json({ success: true, items });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'อ่านคลังไม่สำเร็จ', errorType: 'STORE_READ_FAILED' },
      { status: 500 }
    );
  }
}
