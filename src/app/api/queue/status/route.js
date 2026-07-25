import { NextResponse } from 'next/server';
import { getJobStatus, getQueueOverview, cleanupStaleJobs } from '@/lib/services/queueService';
import { createLogger } from '@/lib/logger';

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
    if (now - _lastReviveAt > 20_000) {
      _lastReviveAt = now;
      getQueueOverview().then((ov) => {
        if (ov.pending > 0 && ov.processing === 0) {
          logger.info(`[Queue Status] 🚑 Self-heal: ${ov.pending} pending แต่ไม่มี worker วิ่ง — ปลุก worker`);
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
    
    return NextResponse.json({
      success: true,
      jobId: jobStatus.id,
      status: jobStatus.status,
      position: jobStatus.position,
      queuesAhead: jobStatus.queuesAhead,
      result: jobStatus.result,
      error: jobStatus.error,
      startedAt: jobStatus.startedAt,
      completedAt: jobStatus.completedAt
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
