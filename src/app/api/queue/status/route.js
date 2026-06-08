import { NextResponse } from 'next/server';
import { getJobStatus, getQueueOverview, cleanupStaleJobs } from '@/lib/services/queueService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('QUEUE_STATUS');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ★ Track last cleanup time to avoid running cleanup every poll (every 3s)
let _lastCleanupAt = 0;

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
      cleanupStaleJobs(8).catch(() => {}); // fire-and-forget, 8 min threshold
    }
    
    if (!jobId) {
      // No job ID = return queue overview
      const overview = await getQueueOverview();
      return NextResponse.json({ success: true, ...overview });
    }
    
    const jobStatus = await getJobStatus(jobId);
    
    if (!jobStatus) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
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
