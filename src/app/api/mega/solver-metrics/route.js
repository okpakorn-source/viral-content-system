// ============================================================
// GET /api/mega/solver-metrics — สถิติ "เงา" solver (คำนวณล้วน) เทียบ LLM (สมอง) จากปกจริงที่ทำไปแล้ว
// ------------------------------------------------------------
// ขั้น A ของแผนเปิด solver — read-only เต็มร้อย: อ่าน solverShadow/solverShadowV2 ที่ท่อ MEGA
// บันทึกไว้แล้วใน job.dossier.pickImages (megaJobStore 'mega-jobs') + เผื่ออนาคตใน
// megaCoverArchive ('mega-cover-runs') แล้วสรุปสถิติ — ไม่แตะ/ไม่เปลี่ยนพฤติกรรมท่อจริง
// ไม่เปิดสวิตช์ solver ใดๆ ทั้งสิ้น
//
// query: ?jobLimit=5000&coverLimit=500 (optional, override จำนวน record สูงสุดที่จะอ่าน)
// ============================================================

import { NextResponse } from 'next/server';
import { collectSolverShadowRecords } from '@/lib/solverShadowSource';
import { aggregateSolverShadow } from '@/lib/solverShadowMetrics';

export const runtime = 'nodejs';

function parseIntParam(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function GET(req) {
  try {
    let jobLimit = 5000;
    let coverLimit = 500;
    try {
      const sp = (req && req.nextUrl && req.nextUrl.searchParams)
        ? req.nextUrl.searchParams
        : new URL(req.url).searchParams;
      jobLimit = parseIntParam(sp.get('jobLimit'), jobLimit);
      coverLimit = parseIntParam(sp.get('coverLimit'), coverLimit);
    } catch { /* ใช้ default */ }

    const records = await collectSolverShadowRecords({ jobLimit, coverLimit });
    const summary = aggregateSolverShadow(records);

    return NextResponse.json({ success: true, summary });
  } catch (e) {
    console.error('[api/mega/solver-metrics] ผิดพลาด:', e?.message || e);
    return NextResponse.json(
      { success: false, error: 'อ่านสถิติ solver shadow ไม่สำเร็จ', errorType: 'SOLVER_METRICS_READ_FAILED' },
      { status: 500 },
    );
  }
}
