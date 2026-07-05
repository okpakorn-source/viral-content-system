// ============================================================
// [ระบบทำปกออโต้] GET /api/cases/[id] — ดึงเคสเต็มทีละใบ
// (ผลวิเคราะห์ + คีย์เวิร์ด + meta ทุกส่วน เพื่อดูย้อนหลัง)
// ============================================================

import { NextResponse } from 'next/server';
import { getCase } from '@/lib/caseStore';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const c = await getCase(id);
    if (!c) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบเคส ' + id, errorType: 'CASE_NOT_FOUND' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, case: c });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'อ่านเคสไม่สำเร็จ', errorType: 'STORE_READ_FAILED' },
      { status: 500 }
    );
  }
}
