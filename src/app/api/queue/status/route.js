import { NextResponse } from 'next/server';
import { getJobStatus, getQueueOverview, cleanupStaleJobs } from '@/lib/services/queueService';
import { createLogger } from '@/lib/logger';
// ★ 2 ต.ค. 69 (ท่อข่าวขนาน · SPEC-v3 ส่วน 11 · W6): เพดานงานข่าวพร้อมกัน — ตัวช่วยเดียวกับตัวหยิบงาน (queueService.getNextPendingJobs)
import { getNewsConcurrency } from '@/lib/services/queueConcurrency';

const logger = createLogger('QUEUE_STATUS');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ★ Track last cleanup time to avoid running cleanup every poll (every 3s)
let _lastCleanupAt = 0;
let _lastReviveAt = 0;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('id');
    
    // ★ Auto-cleanup stale jobs every 60 seconds during polling
    // This is crucial because the client polls /api/queue/status every 3s
    // If a processing job is stuck, this will reset it so new jobs can proceed
    const now = Date.now();
    if (now - _lastCleanupAt > 60_000) {
      _lastCleanupAt = now;
      cleanupStaleJobs(15).catch(() => {}); // fire-and-forget, 15 min threshold (pipeline uses 5-12 min)
    }

    // ★ Self-heal (11 มิ.ย.): ลูกโซ่ worker ขาดได้ (trigger next batch ตาย / server restart)
    // → งาน pending ค้างเงียบจนกว่าจะมีคนยิง worker เอง — UI poll ทุก 3s อยู่แล้ว
    // ถ้าเห็น pending แต่ไม่มีงานวิ่ง ให้ปลุก worker เอง (throttle 20s กันยิงรัว)
    // ★ 2 ต.ค. 69 (ท่อข่าวขนาน · SPEC-v3 ส่วน 11 · W6): ปลุกเมื่อ "ยังมีช่องว่าง" (processing < เพดานข่าว) แทน "ไม่มีงานวิ่งเลย"
    //   เพดาน = getNewsConcurrency ตัวเดียวกับตัวหยิบงาน · throttle 20 วิเดิม · worker ที่ถูกปลุกยังหยิบ 1 งาน/ครั้ง (atomic claim กันซ้ำ)
    //   ไม่ตั้ง QUEUE_NEWS_CONCURRENCY = 1 → processing < 1 ≡ processing === 0 (processing = จำนวนแถวจริง เป็นจำนวนเต็ม ≥ 0) = เดิมทุกไบต์
    //   ปลุกเปล่า (ช่องบนเครื่องเต็มจริง/งานถูกชะลอรอรีเสิร์ช) = worker ตอบ "No pending jobs" แล้วจบ · ไม่มี self-fetch worker→worker
    //   ของเดิม: if (ov.pending > 0 && ov.processing === 0) {
    if (now - _lastReviveAt > 20_000) {
      _lastReviveAt = now;
      getQueueOverview().then((ov) => {
        const newsMax = getNewsConcurrency(process.env); // ★ W6: ไม่ตั้ง env = 1
        if (ov.pending > 0 && ov.processing < newsMax) {
          logger.info(ov.processing === 0 // ★ W6: ไม่มีงานวิ่ง = ข้อความเดิมทุกไบต์ · มีงานวิ่งแต่ยังมีช่อง = บอกจำนวนที่วิ่ง/เพดาน
            ? `[Queue Status] 🚑 Self-heal: ${ov.pending} pending แต่ไม่มี worker วิ่ง — ปลุก worker`
            : `[Queue Status] 🚑 Self-heal: ${ov.pending} pending · วิ่งอยู่ ${ov.processing}/${newsMax} งาน — ปลุก worker หยิบงานเพิ่ม`);
          fetch(`${req.nextUrl.origin}/api/queue/worker`, { method: 'POST' }).catch(() => {});
        }
      }).catch(() => {});
    }
    
    if (!jobId) {
      // No job ID = return queue overview
      const overview = await getQueueOverview();
      return NextResponse.json({ success: true, ...overview });
    }
    
    const jobStatus = await getJobStatus(jobId);
    
    if (!jobStatus) {
      // ★ 24 มิ.ย.: งานไม่เจอ (เก่าเกิน/ถูกล้าง) — ข้อความที่บอก "ต้องทำอะไรต่อ" แทน "Job not found" ดิบๆ
      return NextResponse.json({
        success: false,
        error: 'ไม่พบงานนี้แล้ว (อาจเสร็จไปแล้วหรือถูกส่งใหม่) — ถ้ายังไม่ได้ผล ส่งข่าวใหม่อีกครั้งได้เลย',
        errorType: 'JOB_NOT_FOUND',
      }, { status: 404 });
    }
    
    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3): งาน pending ที่คิวชะลอรอรีเสิร์ช (research hold)
    //   → ตอบเพิ่ม researchHold {heldMs, maxMs} ให้บอทโชว์ "⏳ กำลังค้นคว้าก่อนเขียน" · ตัวช่วยเดียวกับตัวหยิบงาน (research-agent/queueHold.js)
    //   additive + fail-open (อ่านไม่ได้/ช้า/ไม่ถูก hold = ไม่มีช่องนี้ = คำตอบเดิม) · ไม่ตั้ง RESEARCH_AGENT=1 + MODE=write = ไม่ import อะไร
    //   self-heal ด้านบนคงเดิม: ปลุก worker ทุก 20 วิ (งานที่ hold ถูกข้ามใน getNextPendingJobs เอง · ปลุกนี้ทำให้หยิบทันทีเมื่อ hold จบ)
    const _raEnv = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '').trim(); // = cleanEnv ของ research-agent/modes.js
    const researchHold = (jobStatus.status === 'pending'
        && _raEnv(process.env.RESEARCH_AGENT) === '1' && _raEnv(process.env.RESEARCH_AGENT_MODE).toLowerCase() === 'write')
      ? await import('@/lib/research-agent/queueHold').then((m) => m.getResearchHoldInfo(jobStatus)).catch(() => null)
      : null;

    return NextResponse.json({
      success: true,
      jobId: jobStatus.id,
      status: jobStatus.status,
      position: jobStatus.position,
      queuesAhead: jobStatus.queuesAhead,
      result: jobStatus.result,
      error: jobStatus.error,
      errorType: jobStatus.errorType || null,
      failedStep: jobStatus.failedStep || null,
      startedAt: jobStatus.startedAt,
      completedAt: jobStatus.completedAt,
      ...(researchHold ? { researchHold } : {}), // ★ W3 — ของเดิม: completedAt เป็นช่องสุดท้าย (ไม่มีช่องนี้)
    });
    
  } catch (error) {
    logger.error(`[Queue Status Error] ${error.message}`);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve job status',
      errorType: 'QUEUE_STATUS_ERROR'
    }, { status: 500 });
  }
}
