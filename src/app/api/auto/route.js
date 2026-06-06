export const maxDuration = 300; // Allow 5 minutes for heavy LLM operations
import { NextResponse } from 'next/server';
import { processAutoFlow } from '@/lib/services/autoFlowService';

export async function POST(request) {
  const startTime = Date.now();
  let _autoWorkflowId = null;

  try {
    const body = await request.json();
    _autoWorkflowId = body.workflowId || ('auto_' + Date.now());

    const result = await processAutoFlow({
      ...body,
      workflowId: _autoWorkflowId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Auto API Endpoint] Error:', error.message);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    return NextResponse.json({
      success: false,
      error: error.message,
      errorType: 'AUTO_PIPELINE_ERROR',
      failedStep: error.failedStep || 'auto_scrape',
      totalTimeSeconds: parseFloat(elapsed),
    }, { status: 500 });
  }
}
