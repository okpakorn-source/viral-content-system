/**
 * GET   /api/news-studio/runs/<id> — งานเดียวฉบับเต็ม (เนื้อดิบ ทิศทาง 3 เวอร์ชัน ผลตรวจทุกด่าน)
 * PATCH /api/news-studio/runs/<id> — บันทึกผลรีวิวของคน { status: unreviewed|good|bad|used, pickedVersion?, note? }
 */
import { NextResponse } from 'next/server';
import { getRun, reviewRun } from '@/lib/services/newsStudio/server';
import { studioSession, canWrite, unauthorized, forbidden, errorJson, serviceError } from '@/lib/services/newsStudio/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    if (!(await studioSession())) return unauthorized();
    const { id } = await params;
    return NextResponse.json({ success: true, run: await getRun(id) });
  } catch (e) {
    return serviceError(e, 'RUN_DETAIL_FAILED');
  }
}

export async function PATCH(request, { params }) {
  try {
    const session = await studioSession();
    if (!session) return unauthorized();
    if (!canWrite(session)) return forbidden();
    const { id } = await params;
    let body;
    try { body = await request.json(); } catch { return errorJson('คำขอไม่ใช่ JSON ที่อ่านได้', 'INVALID_REQUEST_BODY', 400); }
    const review = await reviewRun(id, body, session);
    return NextResponse.json({ success: true, review });
  } catch (e) {
    return serviceError(e, 'REVIEW_FAILED');
  }
}
