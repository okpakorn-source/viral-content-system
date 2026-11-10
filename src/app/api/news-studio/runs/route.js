/**
 * GET /api/news-studio/runs?limit=60 — ประวัติงานของระบบเขียนตัวใหม่ (แถวย่อ ใหม่สุดก่อน) + ตัวเลขรวม
 */
import { NextResponse } from 'next/server';
import { listRuns } from '@/lib/services/newsStudio/server';
import { studioSession, unauthorized, serviceError } from '@/lib/services/newsStudio/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    if (!(await studioSession())) return unauthorized();
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '60', 10) || 60;
    const data = await listRuns({ limit });
    return NextResponse.json({ success: true, ...data });
  } catch (e) {
    return serviceError(e, 'RUN_LIST_FAILED');
  }
}
