// ============================================================
// 🖼️ GET /api/mega-covers/img?id=MCV-xxx[&dl=1] — เสิร์ฟภาพปกจากคลังงาน MEGA
// ลำดับ: ไฟล์เครื่อง (public/mega-covers/) → แถวภาพคลาวด์ (Vercel/คนละเครื่อง)
// &dl=1 = สั่งดาวน์โหลดเป็นไฟล์ (ปุ่มโหลดภาพในคลัง)
// ============================================================

import { NextResponse } from 'next/server';
import { getMegaCoverImage } from '@/lib/megaCoverArchive';

export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = (searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ id', errorType: 'BAD_INPUT' }, { status: 400 });
    }
    const img = await getMegaCoverImage(id);
    if (!img) {
      return NextResponse.json({ success: false, error: 'ไม่พบภาพของ ' + id, errorType: 'IMAGE_NOT_FOUND' }, { status: 404 });
    }
    const headers = {
      'Content-Type': img.mime,
      'Cache-Control': 'public, max-age=86400', // ปกในคลังไม่เปลี่ยน — cache ได้เต็มที่ ลด egress
    };
    if (searchParams.get('dl')) {
      headers['Content-Disposition'] = `attachment; filename="${id}.${img.mime === 'image/png' ? 'png' : 'jpg'}"`;
    }
    return new NextResponse(img.buffer, { status: 200, headers });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message || 'เสิร์ฟภาพล้ม', errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
