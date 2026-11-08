import { NextResponse } from 'next/server';
import { performResearch } from '@/lib/services/researchService';

export async function POST(request) {
  try {
    const body = await request.json();
    const { newsBody, newsTitle, breakdownData, workflowId } = body;

    // Primary: Serper
    if (process.env.SERPER_API_KEY) {
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
    }

    // Fallback: Tavily
    if (process.env.TAVILY_API_KEY) {
      console.log('[Research-Route] ℹ️ SERPER_API_KEY ไม่มี — ใช้ Tavily fallback');
      try {
        const { tavilySearch } = await import('@/lib/services/tavilyService');

        const searchQuery = newsTitle || (newsBody ? newsBody.slice(0, 200) : '');
        if (!searchQuery) {
          return NextResponse.json({
            success: false,
            error: 'ไม่มีข้อมูลสำหรับค้นหา',
            errorType: 'KEYWORD_INPUT_EMPTY',
          }, { status: 400 });
        }

        const tavilyResults = await tavilySearch(searchQuery, {
          maxResults: 10,
          searchDepth: 'advanced',
          includeAnswer: true,
        });

        return NextResponse.json({
          success: true,
          data: {
            results: tavilyResults.results || [],
            answer: tavilyResults.answer || null,
            provider: 'tavily',
          },
        });
      } catch (tavilyErr) {
        console.error('[Research-Route] ❌ Tavily fallback failed:', tavilyErr.message);
        return NextResponse.json({
          success: false,
          error: `Tavily fallback ล้มเหลว: ${tavilyErr.message}`,
          errorType: 'TAVILY_FALLBACK_FAILED',
        }, { status: 500 });
      }
    }

    // No search provider available
    return NextResponse.json({
      success: false,
      error: 'ไม่มี SERPER_API_KEY หรือ TAVILY_API_KEY — ระบบ Research ไม่สามารถใช้งานได้',
      errorType: 'MISSING_SEARCH_PROVIDER',
    }, { status: 503 });

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
