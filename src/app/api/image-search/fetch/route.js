// ============================================================
// 🔎 GET /api/image-search/fetch?url=...&dl=1
// proxy ดึงภาพจากเว็บนอก → คืน same-origin (ดาวน์โหลดจากมือถือได้ ตั้งชื่อไฟล์ให้)
// ★ 4 ก.ค. 2026 — คู่กับหน้า /image-search (เลือกภาพที่ดีที่สุดไปทำปกเอง)
// ============================================================

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

export async function GET(req) {
  try {
    const url = req.nextUrl.searchParams.get('url') || '';
    const dl = req.nextUrl.searchParams.get('dl') === '1';
    if (!/^https?:\/\//.test(url)) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ url (http/https)', errorType: 'BAD_URL' }, { status: 400 });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let res;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: url },
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      return NextResponse.json({ success: false, error: `โหลดภาพไม่ได้ (HTTP ${res.status})`, errorType: 'FETCH_FAILED' }, { status: 502 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ success: false, error: 'ไฟล์ใหญ่เกิน 20MB', errorType: 'TOO_LARGE' }, { status: 413 });
    }
    const ct = res.headers.get('content-type') || 'image/jpeg';
    const ext = /png/.test(ct) ? 'png' : /webp/.test(ct) ? 'webp' : /gif/.test(ct) ? 'gif' : 'jpg';
    const headers = { 'Content-Type': ct, 'Cache-Control': 'public, max-age=3600' };
    if (dl) headers['Content-Disposition'] = `attachment; filename="image_${Date.now().toString(36)}.${ext}"`;
    return new NextResponse(buf, { headers });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'FETCH_PROXY_ERROR' }, { status: 500 });
  }
}
