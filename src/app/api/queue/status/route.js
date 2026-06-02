import { NextResponse } from 'next/server';
import { getJobStatus, getQueueOverview } from '@/lib/services/queueService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('QUEUE_STATUS');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('id');
    
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
