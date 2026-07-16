/**
 * 🧬 DNA Runs API — ประวัติการรันวิจัย/อัพโหลดไฟล์เข้าคลังข่าวต้นแบบ (โต๊ะข่าวกลาง v2, เฟส 1 — 16 ก.ค. 69)
 *  GET  ?limit                                   → ประวัติการรัน ใหม่สุดก่อน
 *  POST { action:'create', runId, fileName, counts, costEstimate, model } → เริ่มบันทึกการรัน
 *  POST { action:'finish', runId, resultCounts, costActual, synthesis }  → ปิดงานการรัน
 */
import { NextResponse } from 'next/server';
import { listRuns, createRun, finishRun } from '@/lib/services/deskV2/dnaLibrary.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const runs = await listRuns(limit);
    return NextResponse.json({ success: true, runs });
  } catch (error) {
    console.error('[DnaRuns GET]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'DNA_RUNS_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body.action === 'create') {
      if (!body.runId) {
        return NextResponse.json({ success: false, error: 'ต้องระบุ runId', errorType: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const run = await createRun({
        runId: body.runId,
        fileName: body.fileName,
        counts: body.counts,
        costEstimate: body.costEstimate,
        model: body.model,
      });
      return NextResponse.json({ success: true, run });
    }

    if (body.action === 'finish') {
      if (!body.runId) {
        return NextResponse.json({ success: false, error: 'ต้องระบุ runId', errorType: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const run = await finishRun(body.runId, {
        resultCounts: body.resultCounts,
        costActual: body.costActual,
        synthesis: body.synthesis,
      });
      return NextResponse.json({ success: true, run });
    }

    return NextResponse.json({ success: false, error: 'action ไม่รู้จัก', errorType: 'VALIDATION_ERROR' }, { status: 400 });
  } catch (error) {
    console.error('[DnaRuns POST]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'DNA_RUNS_ERROR' }, { status: 500 });
  }
}
