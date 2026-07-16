/**
 * ============================================================
 * 🧾 /api/desk/research/trace — สมุดบันทึกย้อนหลัง Research Engine (โต๊ะข่าวกลาง v2, 17 ก.ค. 69 — อ้างแบบ trace-design)
 * ============================================================
 * GET  ?jobId=      → เช็คสถานะงานเขียนที่ผูกกับ jobId (อ่านอย่างเดียวจาก /api/queue/status ผ่าน getJobInfo)
 * GET  ?runId=      → รายละเอียดรอบล่า 1 รอบ (ครบ field)
 * GET  (ไม่มี query) → ประวัติรอบล่าทั้งหมด เรียงใหม่→เก่า (?limit=)
 * POST { action:'logRun', run }               — บันทึกสรุปรอบล่า 1 รอบ (เรียกตอนจบ startHunt ฝั่ง UI)
 * POST { action:'leadEvents', leadId, events } — ต่อ timeline เข้าลีด 1 ใบ
 * 🔴 ห้ามแตะ researchLeads.js / dnaContract.js / api/queue/** — route นี้เรียกผ่าน researchTrace.js เท่านั้น
 * 🔴 endpoint นี้ถูกออกแบบให้ผู้เรียก (UI) ยิงแบบ fire-and-forget — error ที่ตอบกลับมาไม่ควรทำ flow หลักพัง
 */
import { NextResponse } from 'next/server';
import { listRuns, getRun, logRun, appendLeadEvents, getJobInfo } from '@/lib/services/deskV2/researchTrace.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  try {
    const { searchParams } = request.nextUrl;

    const jobId = searchParams.get('jobId');
    if (jobId) {
      const info = await getJobInfo(jobId, request.nextUrl.origin);
      return NextResponse.json(info);
    }

    const runId = searchParams.get('runId');
    if (runId) {
      const run = await getRun(runId);
      if (!run) {
        return NextResponse.json({
          success: false,
          error: `ไม่พบรอบล่า: ${runId}`,
          errorType: 'RESEARCH_TRACE_ERROR',
        }, { status: 404 });
      }
      return NextResponse.json({ success: true, run });
    }

    const limitRaw = searchParams.get('limit');
    const runs = await listRuns(limitRaw != null ? Number(limitRaw) : undefined);
    return NextResponse.json({ success: true, runs });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error?.message || 'ดึงประวัติรอบล่าล้มเหลว',
      errorType: 'RESEARCH_TRACE_ERROR',
    }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;

    if (action === 'logRun') {
      if (!body?.run?.runId) {
        return NextResponse.json({
          success: false,
          error: 'ต้องระบุ run.runId',
          errorType: 'RESEARCH_TRACE_ERROR',
        }, { status: 400 });
      }
      const run = await logRun(body.run);
      return NextResponse.json({ success: true, run });
    }

    if (action === 'leadEvents') {
      if (!body?.leadId) {
        return NextResponse.json({
          success: false,
          error: 'ต้องระบุ leadId',
          errorType: 'RESEARCH_TRACE_ERROR',
        }, { status: 400 });
      }
      const lead = await appendLeadEvents(body.leadId, body.events);
      return NextResponse.json({ success: true, lead });
    }

    return NextResponse.json({
      success: false,
      error: `action ไม่รู้จัก: ${action}`,
      errorType: 'RESEARCH_TRACE_ERROR',
    }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error?.message || 'บันทึกสมุด trace ล้มเหลว',
      errorType: 'RESEARCH_TRACE_ERROR',
    }, { status: 500 });
  }
}
