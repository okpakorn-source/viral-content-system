/**
 * Generation Logs API — รายการเคส + สถิติ
 */
import { NextResponse } from 'next/server';
import { getCases, getStats } from '@/lib/services/generationLogger';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const status = searchParams.get('status') || null;
    const sourceType = searchParams.get('sourceType') || null;
    const search = searchParams.get('search') || '';

    const [casesResult, stats] = await Promise.all([
      getCases({ limit, offset, status, sourceType, search }),
      getStats(),
    ]);

    return NextResponse.json({
      success: true,
      cases: casesResult.cases,
      total: casesResult.total,
      stats,
    });
  } catch (err) {
    console.error('[GenLogs API] Error:', err.message);
    return NextResponse.json({
      success: false,
      error: err.message,
      errorType: 'GENERATION_LOG_FETCH_ERROR',
    }, { status: 500 });
  }
}
