/**
 * GET /api/news-studio/status — สถานะของระบบเขียนตัวใหม่: คีย์ (มี/ไม่มี) โมเดลที่ใช้ คลัง กติกา ตัวเลขงานล่าสุด
 */
import { NextResponse } from 'next/server';
import { studioStatus } from '@/lib/services/newsStudio/server';
import { studioSession, canWrite, unauthorized, serviceError } from '@/lib/services/newsStudio/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await studioSession();
    if (!session) return unauthorized();
    const status = await studioStatus();
    return NextResponse.json({ success: true, status, me: { displayName: session.displayName || session.username, role: session.role, canWrite: canWrite(session) } });
  } catch (e) {
    return serviceError(e, 'STATUS_FAILED');
  }
}
