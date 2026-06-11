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

    // ★ เติมคะแนนจากโต๊ะข่าวให้เคสที่ป้าย desk ยังไม่มีคะแนน (เคสก่อน 12 มิ.ย.) — ใช้ติดป้าย "ความควรทำ"
    try {
      const needJoin = casesResult.cases.filter(c => c.desk?.newsId && c.desk.judgeScore == null);
      if (needJoin.length > 0) {
        const { createStore } = await import('@/lib/persistStore');
        const deskItems = await createStore('news-desk').getAll();
        const byId = new Map(deskItems.map(i => [i.id, i]));
        for (const c of needJoin) {
          const it = byId.get(c.desk.newsId);
          if (it) {
            c.desk.judgeScore = it.judgeScore ?? null;
            c.desk.finalScore = it.finalScore ?? null;
          }
        }
      }
    } catch { /* join ไม่ได้ = แค่ไม่มีป้าย ไม่พังรายการ */ }

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
