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
    const cutoff = new Date(Date.now() - 8 * 60 * 1000); // 8 minutes

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
        const shouldClear = 
          // Stuck processing > 8 minutes
          (job.status === 'processing' && new Date(job.startedAt || job.createdAt) < cutoff) ||
          // Old completed/failed jobs
          (job.status === 'completed' || job.status === 'failed') ||
          // Pending jobs older than 10 minutes (user probably gave up)
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
