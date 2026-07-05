// ============================================================
// [ระบบทำปกออโต้] GET /api/images/[id] — ดึงคลังรูปของเคส
// (รวมทุกแพลตฟอร์ม + สถิติแยกหมวด) เพื่อแสดง/ดูย้อนหลัง
// ============================================================

import { NextResponse } from 'next/server';
import { readImages, countByPlatform } from '@/lib/imageStore';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const images = await readImages(id);
    return NextResponse.json({
      success: true,
      caseId: id,
      total: images.length,
      byPlatform: countByPlatform(images),
      images,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'อ่านคลังรูปไม่สำเร็จ', errorType: 'STORE_READ_FAILED' },
      { status: 500 }
    );
  }
}
