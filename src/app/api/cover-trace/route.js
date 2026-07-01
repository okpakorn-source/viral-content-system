import { NextResponse } from 'next/server';
import fs from 'fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cover Trace API — อ่านคลัง trace ของท่อทำปก (สำหรับหน้า /cover-lab)
 *   GET /api/cover-trace                → รายการรันล่าสุด (index)
 *   GET /api/cover-trace?runId=xxx      → รายละเอียดทุกขั้นของรันนั้น
 *   GET /api/cover-trace?img=xxx        → ภาพปกของรันนั้น (jpg)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const img = searchParams.get('img');
    const runId = searchParams.get('runId');

    const trace = await import('@/lib/services/coverTrace');

    if (img) {
      const p = trace.getCoverPath(img);
      if (!p) {
        return NextResponse.json({ success: false, error: 'ไม่พบภาพปกของรันนี้', errorType: 'COVER_NOT_FOUND' }, { status: 404 });
      }
      const buf = fs.readFileSync(p);
      return new NextResponse(buf, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' },
      });
    }

    if (runId) {
      const run = trace.getRun(runId);
      if (!run) {
        return NextResponse.json({ success: false, error: 'ไม่พบรันนี้', errorType: 'RUN_NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ success: true, run });
    }

    return NextResponse.json({ success: true, runs: trace.listRuns() });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message || 'trace read failed', errorType: 'TRACE_READ_ERROR' }, { status: 500 });
  }
}
