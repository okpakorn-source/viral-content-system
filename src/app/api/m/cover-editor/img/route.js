/**
 * /api/m/cover-editor/img?url=... — proxy ภาพเว็บนอกให้เป็น same-origin
 * เหตุผล: canvas ที่วาดภาพข้ามโดเมนจะ "taint" → toDataURL() ล้ม = ปุ่มบันทึกพังเงียบ
 * ต้องล็อกอินก่อน · https เท่านั้น · ไฟล์ใหม่ล้วน ไม่แตะระบบเดิม
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';

export async function GET(request) {
  try {
    const c = await cookies();
    const token = c.get('auth_token')?.value;
    const s = token ? await getSession(token) : null;
    if (!s) return NextResponse.json({ success: false, error: 'ต้องล็อกอินก่อน', errorType: 'UNAUTHORIZED' }, { status: 401 });

    const raw = request.nextUrl.searchParams.get('url') || '';
    let u;
    try { u = new URL(raw); } catch { return NextResponse.json({ success: false, error: 'ลิงก์ไม่ถูกต้อง' }, { status: 400 }); }
    if (u.protocol !== 'https:') return NextResponse.json({ success: false, error: 'รับเฉพาะ https' }, { status: 400 });

    const r = await fetch(u.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ViralFlowApp/1.0)' },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return NextResponse.json({ success: false, error: `โหลดภาพไม่ได้ (${r.status})` }, { status: 502 });
    const ct = r.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return NextResponse.json({ success: false, error: 'ลิงก์นี้ไม่ใช่ไฟล์ภาพ' }, { status: 415 });

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 12 * 1024 * 1024) return NextResponse.json({ success: false, error: 'ภาพใหญ่เกิน 12MB' }, { status: 413 });

    return new NextResponse(buf, {
      status: 200,
      headers: { 'Content-Type': ct, 'Cache-Control': 'private, max-age=3600', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'IMG_PROXY_ERROR' }, { status: 500 });
  }
}
