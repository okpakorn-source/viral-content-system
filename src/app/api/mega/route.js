// ============================================================
// 🏭 MEGA — GET/POST /api/mega : จัดการงานสายพาน
// GET → รายการงาน + ธงระบบ
// POST { action:'create', mode? }  → เปิดงานใหม่ (MG-xxxx)
// POST { action:'resume' }         → ปลด circuit breaker
// POST { action:'retry', id }      → ปลุกงาน failed กลับมาเดินต่อจากขั้นเดิม
// ============================================================

import { NextResponse } from 'next/server';
import { newJob, listJobs, getJob, updateJob, listRuns, getFlags, setFlags } from '@/lib/megaJobStore';
import { cancelRefTestJob, duplicateRefTestJob } from '@/lib/refTestPipeline'; // ★ R2: จัดการงานคิว cover-ref-test

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const [jobs, flags] = await Promise.all([listJobs(30), getFlags()]);
    return NextResponse.json({ success: true, jobs, flags });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || '';

    if (action === 'create') {
      // ทีละงาน: มีงานเดินอยู่แล้ว → ไม่เปิดซ้อน (serial-first)
      const jobs = await listJobs(20);
      const active = jobs.find((j) => ['pending', 'running', 'waiting'].includes(j.status));
      if (active) {
        return NextResponse.json({ success: false, error: `มีงาน ${active.id} เดินอยู่ (${active.stage}) — รอจบก่อน`, errorType: 'BUSY' }, { status: 409 });
      }
      const job = await newJob({ mode: body.mode || 'auto' });
      return NextResponse.json({ success: true, job });
    }

    if (action === 'resume') {
      const flags = await setFlags({ paused: false, consecutiveFails: 0 });
      return NextResponse.json({ success: true, flags });
    }

    if (action === 'retry') {
      const job = await getJob(body.id);
      if (!job) return NextResponse.json({ success: false, error: 'ไม่พบงาน' }, { status: 404 });
      const patch = { status: 'running', quality: job.quality === 'red' ? 'yellow' : job.quality };
      // ★ 15 ก.ค. (แบตช์ 2 sol R3): operator กด retry = เจตนาให้โอกาสใหม่ — รีเซ็ตตัวนับ V2 hold
      //   ไม่งั้น hold ถัดไปนับต่อ 3→4 ตายทันทีแทนที่จะได้หน้าต่างใหม่ 3 รอบ (เฉพาะงานที่มี field — งานอื่น patch เดิมเป๊ะ)
      if (job.refHeroV2HoldCount) patch.refHeroV2HoldCount = 0;
      // ย้อนขั้นได้ (เช่น กลับไปส่งเจนใหม่แบบสะอาด): {action:'retry', id, stage:'s3_generate'}
      if (body.stage) {
        patch.stage = body.stage;
        // 🔑 เลขรอบ rewind เข้า basis ของ idempotency — บทเรียน MG-0001: ล้าง generate แล้ว basis
        //   กลับไปเหมือนรอบแรกเป๊ะ → โดน "เคยสำเร็จ" ข้ามยาวถึง content_ready ทั้งที่ 0 เวอร์ชัน
        patch.dossier = { rewind: Date.now() };
        if (body.stage === 's3_generate') patch.dossier.generate = null;
      }
      const updated = await updateJob(job.id, patch);
      await setFlags({ paused: false, consecutiveFails: 0 });
      return NextResponse.json({ success: true, job: updated });
    }

    if (action === 'runs') {
      const runs = await listRuns(body.id);
      return NextResponse.json({ success: true, runs });
    }

    // ★ R2: ยกเลิกงานคิว cover-ref-test — pending/waiting/running → cancelled (terminal · tick ไม่หยิบ)
    if (action === 'cancel') {
      const { status, body: out } = await cancelRefTestJob(body.id, { getJob, updateJob });
      return NextResponse.json(out, { status });
    }

    // ★ R2: ทำซ้ำงานคิว cover-ref-test — clone seed dossier (desk/extract/generate/refIdLock) เป็น job ใหม่ pending
    if (action === 'duplicate') {
      const { status, body: out } = await duplicateRefTestJob(body.id, { getJob, newJob, updateJob });
      return NextResponse.json(out, { status });
    }

    return NextResponse.json({ success: false, error: 'action ไม่รู้จัก: ' + action }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
