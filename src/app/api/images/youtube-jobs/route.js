// ============================================================
// ★ DEVIATION จากระบบทำปกออโต้ (ผู้ใช้สั่ง 6 ก.ค. 2026)
// GET/POST /api/images/youtube-jobs — คิวงานแคปเฟรม "เว็บ → เครื่องทีม"
// ------------------------------------------------------------
// GET  ?status=pending        → ดูรายการงาน (ดีบัก/เช็คสถานะ)
// POST { action:'claim' }     → worker เครื่องทีมหยิบงานเก่าสุด (pending→running)
// POST { action:'done', id, added }   → worker รายงานสำเร็จ
// POST { action:'fail', id, error }   → worker รายงานล้มเหลว
// ============================================================

import { NextResponse } from 'next/server';
import { listJobs, claimJob, finishJob } from '@/lib/ytJobStore';

export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const status = new URL(req.url).searchParams.get('status') || null;
    const jobs = await listJobs(status);
    return NextResponse.json({ success: true, count: jobs.length, jobs });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || '';

    if (action === 'claim') {
      const job = await claimJob();
      return NextResponse.json({ success: true, job });
    }

    if (action === 'done' || action === 'fail') {
      if (!body.id) {
        return NextResponse.json({ success: false, error: 'ต้องมี id', errorType: 'BAD_INPUT' }, { status: 400 });
      }
      const job = await finishJob(body.id, {
        status: action === 'done' ? 'done' : 'failed',
        added: body.added ?? undefined,
        error: body.error ?? undefined,
      });
      return NextResponse.json({ success: true, job });
    }

    return NextResponse.json({ success: false, error: 'action ไม่รู้จัก: ' + action, errorType: 'BAD_INPUT' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
