import { NextResponse } from 'next/server';
import { enqueueJob } from '@/lib/services/queueService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('QUEUE_ADD');

export const runtime = 'nodejs'; // Use Node.js runtime for API
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req) {
  try {
    // 1. Verify API Key
    const authHeader = req.headers.get('authorization') || '';
    const apiKeyHeader = req.headers.get('x-api-key') || '';
    const expectedKey = process.env.API_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-key';
    const discordKey = process.env.DISCORD_API_SECRET;
    
    // Auth: allow same-origin web requests (no auth header needed)
    // Only enforce auth for external callers (Discord, etc)
    if (authHeader || apiKeyHeader) {
      const isAuthorized = 
        (authHeader === `Bearer ${expectedKey}` || apiKeyHeader === expectedKey) ||
        (discordKey && apiKeyHeader === discordKey);
        
      if (!isAuthorized) {
        return NextResponse.json({ success: false, error: 'Unauthorized', errorType: 'UNAUTHORIZED' }, { status: 401 });
      }
    }
    // No auth header = same-origin web request = allowed
    
    // 2. Parse payload
    let payload;
    try {
      payload = await req.json();
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    
    if (!payload.input && !payload.url && !payload.text) {
      return NextResponse.json({ success: false, error: 'Missing input/url/text in payload' }, { status: 400 });
    }
    
    // 3. Add to Queue
    const sourceUserId = payload.userId || 'discord-bot';
    const queueData = await enqueueJob(payload, sourceUserId);
    
    logger.info(`[Queue] Job added: ${queueData.jobId} (Position: ${queueData.position})`);
    
    // 4. Trigger the worker — Use waitUntil pattern to prevent Vercel kill
    // We don't await the full response (worker takes 5 min), just initiate it
    const baseUrl = req.nextUrl.origin;
    const workerPromise = fetch(`${baseUrl}/api/queue/worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': expectedKey
      },
      body: JSON.stringify({ trigger: 'new_job' })
    }).then(() => {
      logger.info(`[Queue] Worker triggered successfully`);
    }).catch(err => {
      logger.error(`[Queue] Worker trigger failed: ${err.message}`);
    });
    
    // 5. Return response immediately — include workerTriggerUrl for client fallback
    const response = NextResponse.json({
      success: true,
      jobId: queueData.jobId,
      position: queueData.position,
      queuesAhead: queueData.queuesAhead,
      status: queueData.status,
      message: `Job queued at position ${queueData.position}`,
      _workerUrl: `${baseUrl}/api/queue/worker`,
    });
    
    // Wait for worker trigger before sending response (max 3s)
    await Promise.race([
      workerPromise,
      new Promise(r => setTimeout(r, 3000))
    ]);
    
    return response;
    
  } catch (error) {
    // Duplicate check — ไม่ใช่ error จริง แค่ข่าวซ้ำ
    const isDuplicate = error.message?.includes('กำลังประมวลผลอยู่') || error.message?.includes('อยู่ในคิวแล้ว');
    if (isDuplicate) {
      logger.info(`[Queue] Duplicate rejected: ${error.message}`);
      return NextResponse.json({
        success: false,
        error: error.message,
        errorType: 'DUPLICATE_JOB'
      }, { status: 409 });
    }
    
    logger.error(`[Queue Add Error] ${error.message}`);
    return NextResponse.json({
      success: false,
      error: `Failed to add job to queue: ${error.message}`,
      errorType: 'QUEUE_ADD_ERROR'
    }, { status: 500 });
  }
}
