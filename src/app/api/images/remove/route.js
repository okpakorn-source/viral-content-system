// ============================================================
// [ระบบทำปกออโต้] POST /api/images/remove
// ลบรูปที่เลือกเอง
//   { caseId, removeIds:[...] }         → ลบเฉพาะที่เลือก
//   { caseId, keepIds:[...] }           → เก็บเฉพาะที่เลือก (ลบที่เหลือ)
// ============================================================

import { NextResponse } from 'next/server';
import { readImages, removeByIds } from '@/lib/imageStore';

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const { caseId, removeIds, keepIds } = await req.json().catch(() => ({}));
    if (!caseId) {
      return NextResponse.json({ success: false, error: 'ต้องมี caseId', errorType: 'BAD_INPUT' }, { status: 400 });
    }

    let ids = [];
    if (Array.isArray(keepIds)) {
      const keep = new Set(keepIds);
      const all = await readImages(caseId);
      ids = all.filter((i) => !keep.has(i.id)).map((i) => i.id);
    } else if (Array.isArray(removeIds)) {
      ids = removeIds;
    } else {
      return NextResponse.json({ success: false, error: 'ต้องมี removeIds หรือ keepIds', errorType: 'BAD_INPUT' }, { status: 400 });
    }

    const out = await removeByIds(caseId, ids);
    return NextResponse.json({ success: true, caseId, ...out });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message || 'ลบไม่สำเร็จ', errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
