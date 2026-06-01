import { NextResponse } from 'next/server';

// === STUB: Select Final Version API ===
// ⚠️ ยังไม่มี implementation จริง — รอ API จาก user
// ใช้โดย: EvaluationDashboard.js → เลือก version สุดท้ายที่จะ publish

export async function POST(request) {
  try {
    const body = await request.json();
    const { caseId, selectedIndex, reason } = body;

    // TODO: Implement — บันทึก version ที่เลือกลง DB
    return NextResponse.json({
      success: true,
      stub: true,
      message: '⚠️ Select Final API ยังไม่ได้ implement — รอ API จริง',
      data: { caseId, selectedIndex, reason },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
      errorType: 'SELECT_FINAL_STUB_ERROR',
    }, { status: 500 });
  }
}
