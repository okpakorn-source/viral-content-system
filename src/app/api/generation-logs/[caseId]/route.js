/**
 * Generation Logs — Case Detail API
 * GET: ดึงเคสเดียวแบบเต็ม
 * PATCH: อัปเดตรีวิว (status + reviewNote)
 */
import { NextResponse } from 'next/server';
import { getCaseDetail, updateCaseReview } from '@/lib/services/generationLogger';

export async function GET(request, { params }) {
  try {
    const { caseId } = await params;
    if (!caseId) {
      return NextResponse.json({
        success: false,
        error: 'กรุณาระบุ caseId',
        errorType: 'MISSING_CASE_ID',
      }, { status: 400 });
    }

    const caseData = await getCaseDetail(caseId);
    if (!caseData) {
      return NextResponse.json({
        success: false,
        error: `ไม่พบเคส #${caseId}`,
        errorType: 'CASE_NOT_FOUND',
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      case: caseData,
    });
  } catch (err) {
    console.error('[GenLogs Detail] Error:', err.message);
    return NextResponse.json({
      success: false,
      error: err.message,
      errorType: 'CASE_DETAIL_ERROR',
    }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { caseId } = await params;
    const body = await request.json();
    const { status, reviewNote } = body;

    if (!caseId || !status) {
      return NextResponse.json({
        success: false,
        error: 'กรุณาระบุ caseId และ status',
        errorType: 'MISSING_PARAMS',
      }, { status: 400 });
    }

    if (!['good', 'bad', 'unreviewed', 'used'].includes(status)) {
      return NextResponse.json({
        success: false,
        error: 'status ต้องเป็น good, bad, unreviewed หรือ used',
        errorType: 'INVALID_STATUS',
      }, { status: 400 });
    }

    const result = await updateCaseReview(caseId, { status, reviewNote });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[GenLogs Review] Error:', err.message);
    return NextResponse.json({
      success: false,
      error: err.message,
      errorType: 'CASE_REVIEW_ERROR',
    }, { status: 500 });
  }
}
