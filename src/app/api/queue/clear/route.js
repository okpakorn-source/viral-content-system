import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { createLogger } from '@/lib/logger';

const logger = createLogger('QUEUE_CLEAR');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/queue/clear — Clear all stuck/stale jobs from the queue
 * 
 * Body (optional):
 * { mode: 'stale' | 'all' }
 * - 'stale' (default): only clear stuck processing + old failed/completed jobs
 * - 'all': clear everything — full reset
 */
export async function POST(req) {
  try {
    let mode = 'stale';
    try {
      const body = await req.json();
      mode = body.mode || 'stale';
    } catch { /* no body = default 'stale' */ }

    // ★ 1 ส.ค. 69 (ออดิต): โหมด 'all' = ล้างคิวทั้งระบบ — ด่าน fail-closed (ไม่ตั้ง env = ปฏิเสธเสมอ)
    // ★ 1 ก.ย. 69 (บั๊กระดับกลาง พิสูจน์แล้ว): โหมด 'stale' ก็ลบงานที่ "กำลังทำ" ได้ (ยิงโดยไม่ต้องมีกุญแจ)
    //   → ครอบด่านเดียวกันทุกโหมด · ไม่มี UI เรียก endpoint นี้ (grep แล้ว) จึงไม่กระทบหน้าใช้งาน
    {
      const adminKey = process.env.ADMIN_API_KEY;
      const gotKey = req.headers.get('x-admin-key') || '';
      if (!adminKey || gotKey !== adminKey) {
        return NextResponse.json({
          success: false,
          error: adminKey ? 'รหัสยืนยันไม่ถูกต้อง' : 'การล้างคิวถูกล็อก — ตั้ง ADMIN_API_KEY ใน env ก่อนใช้',
          errorType: 'ADMIN_KEY_REQUIRED',
        }, { status: 403 });
      }
    }

    const store = createStore('job_queue');
    const allJobs = await store.getAll();
    
    if (allJobs.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'Queue is already empty',
        cleared: 0,
        remaining: 0
      });
    }

    let cleared = 0;
    // ★ 1 ก.ย. 69: เดิม 8 นาทีทุกสถานะ — สั้นกว่าเวลาทำข่าวจริง (ถึง ~13 นาที) และลบผลที่ยังไม่มีใครอ่าน
    //   ใหม่: ทำอยู่/รอคิว ต้องค้างเกิน 15 นาที (ตรงกับตัวกวาดของ worker) · เสร็จ/ล้ม ต้องเกิน 30 นาที
    const STUCK_MS = 15 * 60 * 1000;
    const DONE_MS = 30 * 60 * 1000;
    const stuckCutoff = new Date(Date.now() - STUCK_MS);
    const doneCutoff = new Date(Date.now() - DONE_MS);
    const cutoff = stuckCutoff;

    if (mode === 'all') {
      // ★ Nuclear option — clear everything
      for (const job of allJobs) {
        try { await store.remove(job.id); } catch {}
        cleared++;
      }
      logger.info(`[Queue Clear] 💥 FULL RESET — cleared ${cleared} jobs`);
    } else {
      // ★ Smart clear — only stale/stuck jobs
      for (const job of allJobs) {
        const doneAt = new Date(job.completedAt || job.updatedAt || job.createdAt);
        const shouldClear =
          // Stuck processing > 15 minutes
          (job.status === 'processing' && new Date(job.startedAt || job.createdAt) < cutoff) ||
          // Completed/failed older than 30 minutes (ให้เวลาคนอ่านผล)
          ((job.status === 'completed' || job.status === 'failed') && doneAt < doneCutoff) ||
          // Pending older than 15 minutes
          (job.status === 'pending' && new Date(job.createdAt) < cutoff);
          
        if (shouldClear) {
          try { await store.remove(job.id); } catch {}
          cleared++;
        }
      }
      logger.info(`[Queue Clear] 🧹 Smart clear — cleared ${cleared}/${allJobs.length} stale jobs`);
    }

    const remaining = allJobs.length - cleared;

    return NextResponse.json({
      success: true,
      message: `Cleared ${cleared} jobs (mode: ${mode})`,
      cleared,
      remaining,
      details: {
        total: allJobs.length,
        mode,
      }
    });

  } catch (error) {
    logger.error(`[Queue Clear Error] ${error.message}`);
    return NextResponse.json({
      success: false,
      error: error.message,
      errorType: 'QUEUE_CLEAR_ERROR'
    }, { status: 500 });
  }
}
