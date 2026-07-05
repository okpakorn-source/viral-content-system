// ============================================================
// [ระบบทำปกออโต้] POST /api/images/clear
// เคลียร์คลังรูปตามแหล่ง { caseId, platform }  (platform='all' = ล้างหมด)
// ============================================================

import { NextResponse } from 'next/server';
import { removeByPlatform } from '@/lib/imageStore';

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const { caseId, platform } = await req.json().catch(() => ({}));
    if (!caseId || !platform) {
      return NextResponse.json(
        { success: false, error: 'ต้องมี caseId และ platform', errorType: 'BAD_INPUT' },
        { status: 400 }
      );
    }
    const res = await removeByPlatform(caseId, platform);
    return NextResponse.json({ success: true, caseId, platform, ...res });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'เคลียร์คลังไม่สำเร็จ', errorType: 'UNEXPECTED' },
      { status: 500 }
    );
  }
}
