import { NextResponse } from 'next/server';
import { getNextPendingJobs, updateJobStatus, cleanupStaleJobs } from '@/lib/services/queueService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('QUEUE_WORKER');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800; // ~13 min server limit (pipeline >12min + buffer)

export async function POST(req) {
  try {
    // 1. Verify API Key — allow same-origin web triggers without auth
    const apiKeyHeader = req.headers.get('x-api-key') || '';
    const expectedKey = process.env.API_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-key';
    const discordKey = process.env.DISCORD_API_SECRET;
    
    if (apiKeyHeader) {
      const isAuthorized = 
        apiKeyHeader === expectedKey || 
        (discordKey && apiKeyHeader === discordKey);
      
      if (!isAuthorized) {
        return NextResponse.json({ success: false, error: 'Unauthorized', errorType: 'UNAUTHORIZED' }, { status: 401 });
      }
    }
    // No auth header = same-origin trigger (web client or server self-call) = allowed
    
    // 1.5. Cleanup stale jobs first (stuck > 10 minutes)
    const cleaned = await cleanupStaleJobs(10).catch(() => 0);
    if (cleaned > 0) {
      logger.info(`[Queue Worker] 🧹 Cleaned ${cleaned} stale jobs`);
    }
    
    // 2. Fetch next pending job (1 at a time — true queue behavior)
    //    getNextPendingJobs already marks them as 'processing' atomically
    const jobs = await getNextPendingJobs(1);
    
    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ success: true, message: 'No pending jobs or concurrency limit reached' });
    }
    
    logger.info(`[Queue Worker] 🔄 Processing ${jobs.length} job(s): ${jobs.map(j => j.id.slice(0, 8)).join(', ')}`);
    
    const baseUrl = req.nextUrl.origin;
    
    // 3. Process jobs ONE AT A TIME (sequential, not concurrent)
    for (const job of jobs) {
      try {
        logger.info(`[Queue Worker] ▶️ Starting job ${job.id.slice(0, 8)}`);
        
        // AbortController: pipeline ใช้เวลา >12min — timeout ต้องมากกว่านั้น
        // maxDuration=800 → ใช้ 900s (15 min) เป็น safety margin
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 900_000); // 900s = 15 min
        
        const res = await fetch(`${baseUrl}/api/auto/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ...job.payload, _queueJobId: job.id }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        
        const data = await res.json();
        
        if (res.ok && data.success) {
          await updateJobStatus(job.id, 'completed', { 
            result: data, 
            completedAt: new Date().toISOString() 
          });
          logger.info(`[Queue Worker] ✅ Job ${job.id.slice(0, 8)} completed successfully.`);
        } else {
          await updateJobStatus(job.id, 'failed', { 
            error: data.error || 'Unknown API Error', 
            completedAt: new Date().toISOString() 
          });
          logger.error(`[Queue Worker] ❌ Job ${job.id.slice(0, 8)} failed: ${data.error}`);
        }
      } catch (err) {
        await updateJobStatus(job.id, 'failed', { 
          error: err.message, 
          completedAt: new Date().toISOString() 
        });
        logger.error(`[Queue Worker] ❌ Job ${job.id.slice(0, 8)} threw error: ${err.message}`);
      }
    }
    
    // 4. Trigger next batch asynchronously (if more pending jobs exist)
    fetch(`${baseUrl}/api/queue/worker`, {
      method: 'POST',
      headers: { 'x-api-key': expectedKey }
    }).catch(e => logger.error(`[Queue Worker] Failed to trigger next batch: ${e.message}`));
    
    return NextResponse.json({ success: true, processed: jobs.length });
    
  } catch (error) {
    logger.error(`[Queue Worker Error] ${error.message}`);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
