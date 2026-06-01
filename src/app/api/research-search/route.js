import { NextResponse } from 'next/server';
import { performResearch } from '@/lib/services/researchService';

export async function POST(request) {
  try {
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
