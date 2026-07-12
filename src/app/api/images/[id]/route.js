// ============================================================
// [ระบบทำปกออโต้] GET /api/images/[id] — ดึงคลังรูปของเคส
// (รวมทุกแพลตฟอร์ม + สถิติแยกหมวด) เพื่อแสดง/ดูย้อนหลัง
// ------------------------------------------------------------
// ★ Stage-A: default = พฤติกรรม legacy เป๊ะ (ไม่แตะ snapshot/authority เลย) ·
//   เปิด candidate-authority path เฉพาะ query '?candidateAuthority=1' เป๊ะ เท่านั้น
//   (opt-in สำเร็จ = อ่าน snapshot ครั้งเดียว, payload+authority มาจาก rows ชุดเดียว)
//   ตรรกะจริงอยู่ที่ buildImagesRouteResponse ใน src/lib/imageStore.js (แยกไว้ให้เทสได้ offline)
//   authority module ถูก dynamic-import เฉพาะใน opt-in branch — default path ไม่โหลดเลย
// ============================================================

import { NextResponse } from 'next/server';
import { buildImagesRouteResponse } from '@/lib/imageStore';

export const runtime = 'nodejs';

// ดึงค่า query 'candidateAuthority' แบบกันพลาด — parse ล้มด้วยเหตุใด = ถือว่าไม่มี (ตก default legacy)
function readAuthorityParam(req) {
  try {
    if (req && req.nextUrl && req.nextUrl.searchParams) return req.nextUrl.searchParams.get('candidateAuthority');
    return new URL(req.url).searchParams.get('candidateAuthority');
  } catch {
    return null;
  }
}

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { status, body } = await buildImagesRouteResponse(id, readAuthorityParam(req));
    return NextResponse.json(body, { status });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'อ่านคลังรูปไม่สำเร็จ', errorType: 'STORE_READ_FAILED' },
      { status: 500 }
    );
  }
}
