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
    
    if (authHeader || apiKeyHeader) {
      const isAuthorized = 
        (authHeader === `Bearer ${expectedKey}` || apiKeyHeader === expectedKey) ||
        (discordKey && apiKeyHeader === discordKey);
        
      if (!isAuthorized) {
        if (process.env.NODE_ENV !== 'development') {
          return NextResponse.json({ success: false, error: 'Unauthorized', errorType: 'UNAUTHORIZED' }, { status: 401 });
        }
      }
    } else if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ success: false, error: 'Unauthorized', errorType: 'UNAUTHORIZED' }, { status: 401 });
    }
    
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
    
    // 4. Trigger the worker asynchronously in the background
    // Fire and forget using fetch to the worker route. We don't await the response.
    const baseUrl = req.nextUrl.origin;
    fetch(`${baseUrl}/api/queue/worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': expectedKey
      },
      body: JSON.stringify({ trigger: 'new_job' })
    }).catch(err => {
      logger.error(`[Queue] Failed to trigger worker: ${err.message}`);
    });
    
    // 5. Return immediate response with queue position
    return NextResponse.json({
      success: true,
      jobId: queueData.jobId,
      position: queueData.position,
      queuesAhead: queueData.queuesAhead,
      status: queueData.status,
      message: `Job queued at position ${queueData.position}`
    });
    
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
