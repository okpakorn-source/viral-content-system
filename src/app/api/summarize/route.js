import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getPrompt } from '@/lib/ai/promptStore';

/**
 * POST /api/summarize
 * 
 * Pipeline 2 ขั้นตอน:
 * 1. ดึง prompt "extraction" จากหน้าจัดการ → สกัดเนื้อข่าวจริง
 * 2. ดึง prompt "analysis" จากหน้าจัดการ → วิเคราะห์ประเด็นอย่างละเอียด
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

    if (!extractionPrompt || !analysisPrompt) {
      return NextResponse.json({ success: false, error: 'ไม่พบ Prompt templates' }, { status: 500 });
    }

    // ===== AI ตัวที่ 1: สกัดเนื้อข่าวจริง (ใช้ extraction prompt) =====
    const extractUserPrompt = extractionPrompt.user
      .replace('{content}', text.slice(0, 8000))
      .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติมจากผู้ใช้: "${customPrompt}"` : '');

    console.log('[Summarize] Step 1: Extracting news with extraction prompt...');
    
    const extractResult = await callAI({
      systemPrompt: extractionPrompt.system,
      userPrompt: extractUserPrompt,
      temperature: 0.2,
    });

    let newsData;
    try {
      const jsonMatch = extractResult.match(/\{[\s\S]*\}/);
      newsData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (parseErr) {
      console.error('[Summarize] JSON parse error (extraction):', parseErr.message);
      newsData = null;
    }

    // Fallback ถ้า AI parse ไม่ได้
    if (!newsData || !newsData.news_body || newsData.news_body.length < 20) {
      console.log('[Summarize] Extraction fallback: using raw text');
      newsData = {
        news_title: text.slice(0, 80).replace(/\n/g, ' ').trim(),
        news_body: text.slice(0, 5000),
        news_source: '',
        news_date: '',
        news_category: 'ทั่วไป',
      };
    }

    console.log(`[Summarize] Extracted: title="${newsData.news_title}", body=${newsData.news_body.length} chars`);

    // ===== AI ตัวที่ 2: วิเคราะห์ประเด็น (ใช้ analysis prompt) =====
    const analyzeUserPrompt = analysisPrompt.user
      .replace('{title}', newsData.news_title || '')
      .replace('{content}', newsData.news_body.slice(0, 5000))
      .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

    console.log('[Summarize] Step 2: Analyzing with analysis prompt...');
    
    const analyzeResult = await callAI({
      systemPrompt: analysisPrompt.system,
      userPrompt: analyzeUserPrompt,
      temperature: 0.5,
    });

    let analysis;
    try {
      const jsonMatch = analyzeResult.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (parseErr) {
      console.error('[Summarize] JSON parse error (analysis):', parseErr.message);
      analysis = null;
    }

    // Fallback
    if (!analysis || !analysis.summary) {
      console.log('[Summarize] Analysis fallback');
      analysis = {
        summary: 'ไม่สามารถวิเคราะห์อัตโนมัติได้ — กรุณาตรวจสอบ API Key',
        key_points: [],
        people_involved: [],
        emotion: '',
        content_type: newsData.news_category || 'ทั่วไป',
        viral_potential: '',
        suggested_angles: [],
        target_audience: '',
      };
    }

    console.log(`[Summarize] Analysis done: summary=${analysis.summary?.length} chars, key_points=${analysis.key_points?.length}`);

    return NextResponse.json({
      success: true,
      data: {
        // ผลจาก AI ตัวที่ 1 — เนื้อข่าวครบถ้วน
        newsTitle: newsData.news_title,
        newsBody: newsData.news_body,
        newsSource: newsData.news_source,
        newsDate: newsData.news_date,
        newsCategory: newsData.news_category,
        // ผลจาก AI ตัวที่ 2 — วิเคราะห์ประเด็น
        ...analysis,
      },
    });
  } catch (error) {
    console.error('Summarize API Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: `${error.message}${error.status === 401 ? ' — ตรวจสอบ OPENAI_API_KEY' : ''}` 
    }, { status: 500 });
  }
}
