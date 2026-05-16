import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getPrompt } from '@/lib/ai/promptStore';

/**
 * POST /api/summarize
 * 
 * ดึง prompt จากหน้าจัดการ Prompts มาใช้จริง:
 * 1. prompt "extraction" → AI สกัดเนื้อข่าวจริง (ตัด noise)
 * 2. prompt "analysis" → AI วิเคราะห์ประเด็นอย่างละเอียด
 */
export async function POST(request) {
  try {
    const { text, sourceType, customPrompt } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    // ===== ดึง Prompts จากหน้าจัดการ =====
    const extractionPrompt = getPrompt('extraction');
    const analysisPrompt = getPrompt('analysis');

    // ===== AI ตัวที่ 1: สกัดเนื้อข่าวจริง =====
    const extractUser = extractionPrompt.user
      .replace('{content}', text.slice(0, 8000))
      .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติมจากผู้ใช้: "${customPrompt}"` : '');

    console.log('[Summarize] Step 1: Extracting with prompt...');
    
    let newsData;
    try {
      // callAI returns parsed JSON already (uses response_format: json_object)
      const extractResult = await callAI({
        systemPrompt: extractionPrompt.system,
        userPrompt: extractUser,
        temperature: 0.2,
      });
      
      // callAI returns object directly (already parsed)
      if (extractResult && typeof extractResult === 'object' && extractResult.news_body) {
        newsData = extractResult;
      } else if (typeof extractResult === 'string') {
        const jsonMatch = extractResult.match(/\{[\s\S]*\}/);
        newsData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } else {
        newsData = extractResult;
      }
    } catch (err) {
      console.error('[Summarize] Extraction AI error:', err.message);
      newsData = null;
    }

    // Fallback
    if (!newsData || !newsData.news_body || newsData.news_body.length < 20) {
      console.log('[Summarize] Using raw text fallback');
      newsData = {
        news_title: text.slice(0, 80).replace(/\n/g, ' ').trim(),
        news_body: text.slice(0, 5000),
        news_source: '',
        news_date: '',
        news_category: 'ทั่วไป',
      };
    }

    console.log(`[Summarize] Extracted: "${newsData.news_title}" (${newsData.news_body.length} chars)`);

    // ===== AI ตัวที่ 2: วิเคราะห์ประเด็น =====
    const analyzeUser = analysisPrompt.user
      .replace('{title}', newsData.news_title || '')
      .replace('{content}', newsData.news_body.slice(0, 5000))
      .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

    console.log('[Summarize] Step 2: Analyzing with prompt...');
    
    let analysis;
    try {
      const analyzeResult = await callAI({
        systemPrompt: analysisPrompt.system,
        userPrompt: analyzeUser,
        temperature: 0.5,
      });
      
      if (analyzeResult && typeof analyzeResult === 'object' && analyzeResult.summary) {
        analysis = analyzeResult;
      } else if (typeof analyzeResult === 'string') {
        const jsonMatch = analyzeResult.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } else {
        analysis = analyzeResult;
      }
    } catch (err) {
      console.error('[Summarize] Analysis AI error:', err.message, err.stack);
      analysis = { _error: err.message };
    }

    // Fallback
    if (!analysis || !analysis.summary) {
      const errorMsg = analysis?._error || 'ไม่ทราบสาเหตุ';
      analysis = {
        summary: `วิเคราะห์ไม่สำเร็จ: ${errorMsg}`,
        key_points: [],
        people_involved: [],
        emotion: '',
        content_type: newsData.news_category || 'ทั่วไป',
        viral_potential: '',
        suggested_angles: [],
        target_audience: '',
      };
    }

    console.log(`[Summarize] Done: summary=${analysis.summary?.length}ch, angles=${analysis.suggested_angles?.length}`);

    return NextResponse.json({
      success: true,
      data: {
        newsTitle: newsData.news_title,
        newsBody: newsData.news_body,
        newsSource: newsData.news_source,
        newsDate: newsData.news_date,
        newsCategory: newsData.news_category,
        ...analysis,
      },
    });
  } catch (error) {
    console.error('Summarize API Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
