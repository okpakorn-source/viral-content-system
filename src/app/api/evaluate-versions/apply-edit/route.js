import { NextResponse } from 'next/server';

// === STUB: Apply Edit API ===
// ⚠️ ยังไม่มี implementation จริง — รอ API จาก user
// ใช้โดย: EvaluationDashboard.js → ส่ง AI แก้ไขเนื้อหาตาม recommendation

export async function POST(request) {
  try {
    const body = await request.json();
    const { caseId, versionIndex, editInstructions, originalContent } = body;

    // TODO: Implement — ส่ง originalContent + editInstructions ไป AI แก้ไข
    return NextResponse.json({
      success: true,
      stub: true,
      message: '⚠️ Apply Edit API ยังไม่ได้ implement — รอ API จริง',
      data: {
        caseId,
        versionIndex,
        editedContent: originalContent || '',
        appliedEdits: [],
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
      errorType: 'APPLY_EDIT_STUB_ERROR',
    }, { status: 500 });
  }
}
