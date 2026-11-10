/**
 * GET /api/news-studio/library — คลังที่ระบบเขียนตัวใหม่ใช้ (อ่านอย่างเดียว)
 *   ?kind=exemplars                              ต้นแบบประเด็น 33 ปก (ตัวกำหนดทิศทางข่าว)
 *   ?kind=teachers&q=&category=&opening=&offset=&limit=   โพสต์ครู (ตัวเสริมสำนวน) เรียงยอดวิวมากสุดก่อน
 *   ?kind=teacher&id=<รหัสครู>                    โพสต์ครูใบเดียวฉบับเต็ม
 */
import { NextResponse } from 'next/server';
import { libraryExemplars, libraryTeachers, teacherById } from '@/lib/services/newsStudio/server';
import { studioSession, unauthorized, errorJson, serviceError } from '@/lib/services/newsStudio/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    if (!(await studioSession())) return unauthorized();
    const sp = request.nextUrl.searchParams;
    const kind = sp.get('kind') || '';
    if (kind === 'exemplars') return NextResponse.json({ success: true, ...libraryExemplars() });
    if (kind === 'teachers') {
      return NextResponse.json({ success: true, ...libraryTeachers({ q: sp.get('q') || '', category: sp.get('category') || '', opening: sp.get('opening') || '', offset: sp.get('offset') || 0, limit: sp.get('limit') || 30 }) });
    }
    if (kind === 'teacher') return NextResponse.json({ success: true, teacher: teacherById(sp.get('id')) });
    return errorJson('ต้องระบุ kind เป็น exemplars, teachers หรือ teacher', 'BAD_LIBRARY_KIND', 400);
  } catch (e) {
    return serviceError(e, 'LIBRARY_FAILED');
  }
}
