import { NextResponse } from 'next/server';
import { getLogs, getLogStats } from '@/lib/pipelineLogger';

/**
 * GET /api/pipeline-logs — ดู logs ทั้งระบบ
 * Query params:
 *   ?limit=50     — จำนวน logs
 *   ?step=extract — filter ตาม step
 *   ?status=failed — filter ตาม status
 *   ?workflowId=xxx — filter ตาม workflow
 *   ?stats=true   — ดูสรุปสถิติ
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Stats mode
    if (searchParams.get('stats') === 'true') {
      const stats = await getLogStats();
      return NextResponse.json({ success: true, stats });
    }

    // Logs mode
    const limit = parseInt(searchParams.get('limit') || '50');
    const step = searchParams.get('step') || undefined;
    const status = searchParams.get('status') || undefined;
    const workflowId = searchParams.get('workflowId') || undefined;

    const logs = await getLogs({ limit, step, status, workflowId });

    return NextResponse.json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
