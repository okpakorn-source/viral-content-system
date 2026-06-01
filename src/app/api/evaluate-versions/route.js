import { NextResponse } from 'next/server';

// === STUB: Evaluate Versions API ===
// ⚠️ ยังไม่มี implementation จริง — รอ API จาก user
// ใช้โดย: EvaluationDashboard.js ใน /generation-logs

export async function POST(request) {
  try {
    const body = await request.json();
    const { versions, newsTitle, sourceText } = body;

    // TODO: Implement real AI evaluation
    // ควรส่ง versions ไปให้ AI ประเมินคุณภาพ 7 มิติ:
    // accuracy, completeness, readability, viralPotential, originality, safety, publishReadiness

    return NextResponse.json({
      success: true,
      stub: true,
      message: '⚠️ Evaluate Versions API ยังไม่ได้ implement — รอ API จริง',
      evaluation: {
        versions: (versions || []).map((v, i) => ({
          index: i,
          title: v?.title || `Version ${i + 1}`,
          scores: {
            accuracy: 0,
            completeness: 0,
            readability: 0,
            viralPotential: 0,
            originality: 0,
            safety: 0,
            publishReadiness: 0,
          },
          totalScore: 0,
          summary: 'รอ implementation จริง',
        })),
        recommendation: 'ยังไม่สามารถประเมินได้ — API นี้เป็น stub',
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
      errorType: 'EVALUATE_VERSIONS_STUB_ERROR',
    }, { status: 500 });
  }
}
