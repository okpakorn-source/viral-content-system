import { NextResponse } from 'next/server';
import { performResearch } from '@/lib/services/researchService';

export async function POST(request) {
  try {
    if (!process.env.SERPER_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'SERPER_API_KEY ไม่ได้ตั้งค่า — ระบบ Research ไม่สามารถใช้งานได้',
        errorType: 'MISSING_SERPER_KEY',
      }, { status: 503 });
    }

    const body = await request.json();
    const { newsBody, newsTitle, breakdownData, workflowId } = body;

    const data = await performResearch({
      newsBody,
      newsTitle,
      breakdownData,
      workflowId
    });

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error) {
    const errorType = error.errorType || 'RESEARCH_SEARCH_FAILED';
    console.error('[Research-Route] Error:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message || 'งานวิจัยล้มเหลว',
      errorType,
    }, { status: errorType === 'KEYWORD_INPUT_EMPTY' ? 400 : 500 });
  }
}
