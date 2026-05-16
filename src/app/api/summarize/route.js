import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getPrompt, getAnalysisPreset } from '@/lib/ai/promptStore';

/**
 * POST /api/summarize
 * 
 * รองรับ 2 โหมด:
 * 1. ส่ง text มา → สกัดข่าว (extraction)
 * 2. ส่ง text + analysisPresetId → สกัด + วิเคราะห์ด้วย preset ที่เลือก
 */
export async function POST(request) {
  try {
    const { text, sourceType, customPrompt, analysisPresetId } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    // ===== ดึง Prompts =====
    const extractionPrompt = getPrompt('extraction');

    // ===== AI ตัวที่ 1: สกัดเนื้อข่าวจริง =====
    const extractUser = extractionPrompt.user
      .replace('{content}', text.slice(0, 8000))
      .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

    console.log('[Summarize] Step 1: Extracting...');
    
    let newsData;
    try {
      const extractResult = await callAI({
        systemPrompt: extractionPrompt.system,
        userPrompt: extractUser,
        temperature: 0.2,
      });
      
      if (extractResult && typeof extractResult === 'object' && extractResult.news_body) {
        newsData = extractResult;
      } else {
        newsData = null;
      }
    } catch (err) {
      console.error('[Summarize] Extraction error:', err.message);
      newsData = null;
    }

    // Fallback
    if (!newsData || !newsData.news_body || newsData.news_body.length < 20) {
      newsData = {
        news_title: text.slice(0, 80).replace(/\n/g, ' ').trim(),
        news_body: text.slice(0, 5000),
        news_source: '',
        news_date: '',
        news_category: 'ทั่วไป',
      };
    }

    console.log(`[Summarize] Extracted: "${newsData.news_title}" (${newsData.news_body.length} chars)`);

    // ===== AI ตัวที่ 2: วิเคราะห์ด้วย Preset ที่เลือก =====
    const preset = getAnalysisPreset(analysisPresetId || 'viral_fb');
    console.log(`[Summarize] Step 2: Analyzing with preset "${preset.name}" (${preset.id})...`);

    const analyzeUser = preset.user
      .replace('{title}', newsData.news_title || '')
      .replace('{content}', newsData.news_body.slice(0, 5000))
      .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

    let analysis;
    try {
      const analyzeResult = await callAI({
        systemPrompt: preset.system,
        userPrompt: analyzeUser,
        temperature: 0.5,
      });
      
      if (analyzeResult && typeof analyzeResult === 'object' && analyzeResult.summary) {
        analysis = analyzeResult;
      } else {
        analysis = null;
      }
    } catch (err) {
      console.error('[Summarize] Analysis error:', err.message);
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

    console.log(`[Summarize] Done: preset=${preset.id}, summary=${analysis.summary?.length}ch`);

    return NextResponse.json({
      success: true,
      data: {
        newsTitle: newsData.news_title,
        newsBody: newsData.news_body,
        newsSource: newsData.news_source,
        newsDate: newsData.news_date,
        newsCategory: newsData.news_category,
        usedPreset: { id: preset.id, name: preset.name },
        ...analysis,
      },
    });
  } catch (error) {
    console.error('Summarize API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
