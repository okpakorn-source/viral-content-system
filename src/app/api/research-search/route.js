import { NextResponse } from 'next/server';
import { performResearch } from '@/lib/services/researchService';
import { isNewsResearchOn } from '@/lib/utils/researchSwitch';

export async function POST(request) {
  try {
    const body = await request.json();
    const { newsBody, newsTitle, breakdownData, workflowId } = body;

    // 🔎 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้ — จุดตายที่เกือบหลุดขึ้นระบบ):
    //   ปุ่ม "🔎 AI หาข้อมูลเพิ่มเติม" ที่หน้า /content/new เรียก route นี้ แล้วผลที่ได้
    //   **ไหลเข้าเนื้อข่าวจริง** (content/new/page.js:1163 → เก็บใน researchData → ส่งเข้าตอนเจนที่บรรทัด 1056/1111)
    //   ⇒ ถ้าปล่อยปุ่มนี้ทำงานทั้งที่สั่งปิดรีเสิร์ช = รูยังเปิด ข้อมูลนอกต้นฉบับยังเข้าข่าวได้อยู่ดี
    //   ⛔ และห้ามปล่อยให้ประตูข้างใน performResearch คืน items:[] เฉยๆ ด้วย —
    //      หน้าเว็บเช็คแค่ .length > 0 ⇒ ผู้ใช้จะเห็น "จอว่างเปล่า" ไม่มี error ไม่รู้ว่าโดนปิดหรือระบบเสีย
    //   → ตอบให้ชัดตรงนี้เลย ผู้ใช้จะได้รู้ทันทีว่า "ปิดอยู่" ไม่ใช่ "ระบบพัง"
    if (!isNewsResearchOn()) {
      return NextResponse.json({
        success: false,
        error: 'ระบบค้นข้อมูลเสริมถูกปิดอยู่ตามคำสั่งเจ้าของ — ข่าวจะเขียนจากเนื้อต้นฉบับที่วางเข้ามาเท่านั้น',
        errorType: 'RESEARCH_DISABLED',
      }, { status: 503 });
    }

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
