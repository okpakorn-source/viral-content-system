// ============================================================
// 🏭 MEGA — POST /api/mega/tick : เดินสายพาน 1 จังหวะ (ตัวขับหลัก)
// ------------------------------------------------------------
// - ทำ "ทีละงาน ทีละขั้น" (serial-first ตามแผน v3)
// - idempotent: ขั้นที่เคยสำเร็จด้วย input เดิม = ข้าม ไม่จ่ายซ้ำ
// - circuit breaker: งานล้มติดกัน 3 → พักทั้งสาย (ปลดที่ /mega)
// ผู้เรียก: worker เครื่องทีมตอนว่าง / ปุ่มบนหน้า /mega / cron
// ============================================================

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { listJobs, getJob, updateJob, addRun, findDoneRun, listRuns, getFlags, setFlags } from '@/lib/megaJobStore';
import { STAGE_FLOW, unclaimCard } from '@/lib/megaAdapters';

export const runtime = 'nodejs';
export const maxDuration = 600;

const MAX_STAGE_ATTEMPTS = 2;

function stageInputHash(job) {
  // input ประจำขั้น — เปลี่ยนเมื่อของที่ขั้นนี้ใช้เปลี่ยน (กันเอาผลเก่าปน input ใหม่)
  const d = job.dossier || {};
  const basis = {
    stage: job.stage,
    card: d.desk?.cardId || null,
    extractChars: d.extract?.chars || 0,
    queueJobId: d.generate?.queueJobId || null,
    versions: (d.generate?.versions || []).length,
    // รอบแก้ตัว S3 ต้องได้ key ใหม่ (บั๊กเทสทองคำ: basis ซ้ำรอบแรก → โดน idempotent ข้ามการส่งใหม่)
    retriedWithText: !!d.generate?.retriedWithText,
  };
  return crypto.createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 16);
}

export async function POST(req) {
  let locked = false;
  try {
    const flags = await getFlags();
    if (flags.paused) {
      return NextResponse.json({ success: true, idle: true, paused: true, message: `⛔ สายพานถูกพัก (ล้มติดกัน ${flags.consecutiveFails}) — ปลดที่หน้า /mega` });
    }
    // 🔒 ล็อกกัน tick ซ้อน (worker+UI พร้อมกัน = รันขั้นซ้ำจ่ายซ้ำ) — ล็อกเก่าเกิน 10 นาที = ถือว่าตาย
    if (flags.tickLockAt && Date.now() - new Date(flags.tickLockAt).getTime() < 10 * 60 * 1000) {
      return NextResponse.json({ success: true, idle: true, busy: true, message: 'มี tick อื่นกำลังเดินอยู่' });
    }
    await setFlags({ tickLockAt: new Date().toISOString() });
    locked = true;

    // เลือกงาน: running > waiting > pending (ทีละงาน)
    const jobs = await listJobs(50);
    const job =
      jobs.find((j) => j.status === 'running') ||
      jobs.find((j) => j.status === 'waiting') ||
      jobs.slice().reverse().find((j) => j.status === 'pending') ||
      null;
    if (!job) return NextResponse.json({ success: true, idle: true, message: 'ไม่มีงานให้เดิน' });

    const stageDef = STAGE_FLOW[job.stage];
    if (!stageDef) {
      await updateJob(job.id, { status: 'failed' });
      return NextResponse.json({ success: false, error: `ไม่รู้จักขั้น ${job.stage}` });
    }

    const origin = req.nextUrl.origin;
    const idemKey = `${job.id}:${job.stage}:${stageInputHash(job)}`;

    // idempotency: ขั้นนี้+input นี้เคยสำเร็จแล้ว → เลื่อนต่อเลย ไม่รันซ้ำ
    const prior = await findDoneRun(job.id, job.stage, idemKey);
    if (prior) {
      const next = stageDef.next;
      const patch = next === 'content_ready' ? { status: 'content_ready', stage: next } : { stage: next, status: 'running' };
      await updateJob(job.id, patch);
      return NextResponse.json({ success: true, jobId: job.id, stage: job.stage, skipped: 'เคยสำเร็จแล้ว (idempotent) → เลื่อนขั้นถัดไป' });
    }

    if (job.status === 'pending') await updateJob(job.id, { status: 'running' });

    // นับ attempt ของขั้นนี้
    const runs = await listRuns(job.id);
    const attempt = runs.filter((r) => r.stage === job.stage && r.idempotencyKey === idemKey).length + 1;

    let result;
    try {
      result = await stageDef.run(job, { origin });
    } catch (err) {
      result = { status: 'failed', nextAction: attempt >= MAX_STAGE_ATTEMPTS ? 'fail' : 'retry', summary: 'ขั้นพัง: ' + err.message };
    }

    await addRun(job.id, job.stage, {
      status: result.status,
      attempt,
      idempotencyKey: idemKey,
      summary: result.summary || '',
      error: result.status === 'failed' ? result.summary : undefined,
    });

    // บันทึกผลลงแฟ้ม + ไทม์ไลน์
    const stagesDone = [...(job.stagesDone || [])];
    if (result.status === 'done') stagesDone.push({ stage: job.stage, label: stageDef.label, at: new Date().toISOString(), summary: result.summary });
    const worstQuality = result.quality === 'red' ? 'red' : result.quality === 'yellow' && job.quality !== 'red' ? 'yellow' : job.quality;
    const basePatch = { dossier: result.dossierPatch || {}, stagesDone, quality: worstQuality };

    // เดินหน้า/หยุด ตาม nextAction
    const act = result.nextAction || 'continue';
    if (act === 'continue') {
      const next = stageDef.next;
      if (next === 'content_ready') {
        await updateJob(job.id, { ...basePatch, stage: next, status: 'content_ready' });
        await setFlags({ consecutiveFails: 0 });
      } else {
        await updateJob(job.id, { ...basePatch, stage: next, status: 'running' });
      }
    } else if (act === 'wait') {
      await updateJob(job.id, { ...basePatch, status: 'waiting' });
    } else if (act.startsWith('goto:')) {
      await updateJob(job.id, { ...basePatch, stage: act.slice(5), status: 'running' });
    } else if (act === 'retry') {
      if (attempt >= MAX_STAGE_ATTEMPTS) {
        await updateJob(job.id, { ...basePatch, status: 'failed', quality: 'red' });
        await unclaimCard(job, { origin }).catch(() => {});
        const f = await getFlags();
        await setFlags({ consecutiveFails: (f.consecutiveFails || 0) + 1, paused: (f.consecutiveFails || 0) + 1 >= 3 });
      } else {
        await updateJob(job.id, basePatch); // คงขั้นเดิม รอ tick หน้า retry
      }
    } else {
      // fail
      await updateJob(job.id, { ...basePatch, status: 'failed' });
      await unclaimCard(job, { origin }).catch(() => {});
      const f = await getFlags();
      await setFlags({ consecutiveFails: (f.consecutiveFails || 0) + 1, paused: (f.consecutiveFails || 0) + 1 >= 3 });
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      stage: job.stage,
      stageLabel: stageDef.label,
      result: { status: result.status, nextAction: act, summary: result.summary },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  } finally {
    // ปลดล็อกทุกทางออก (รวม idle/idempotent-return) — กันล็อกค้างขวางสายพาน
    if (locked) await setFlags({ tickLockAt: null }).catch(() => {});
  }
}
