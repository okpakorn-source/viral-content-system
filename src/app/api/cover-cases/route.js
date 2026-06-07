import { NextResponse } from 'next/server';
import { listCases, getCase, getStatistics } from '@/lib/services/coverCaseArchive';

/**
 * GET /api/cover-cases
 *   → ?stats=true  → สถิติรวม
 *   → ?id=CASE-001 → ดึง case เดียว
 *   → (default)    → list cases (limit, offset)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const stats = searchParams.get('stats');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // ── Statistics ──
    if (stats === 'true') {
      const data = await getStatistics();
      return NextResponse.json({ success: true, ...data });
    }

    // ── Single case ──
    if (id) {
      const caseData = await getCase(id);
      if (!caseData) {
        return NextResponse.json({
          success: false,
          error: `ไม่พบ case: ${id}`,
          errorType: 'CASE_NOT_FOUND',
        }, { status: 404 });
      }
      return NextResponse.json({ success: true, case: caseData });
    }

    // ── List cases ──
    const cases = await listCases(limit, offset);
    return NextResponse.json({ success: true, cases, count: cases.length });

  } catch (error) {
    console.error('[API cover-cases] Error:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message || 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์',
      errorType: 'COVER_CASES_ERROR',
    }, { status: 500 });
  }
}
