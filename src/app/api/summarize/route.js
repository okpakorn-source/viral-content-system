import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getPrompt, getAnalysisPreset } from '@/lib/ai/promptStore';

export async function POST(request) {
  try {
    const { text, sourceType, customPrompt, analysisPresetId } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    const extractionPrompt = getPrompt('extraction');

    // ===== Step 1: สกัดเนื้อข่าว =====
    let newsData;
    try {
      const extractUser = extractionPrompt.user
        .replace('{content}', text.slice(0, 8000))
        .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

      console.log('[S1] Extracting news...');
      const result = await callAI({
        systemPrompt: extractionPrompt.system,
        userPrompt: extractUser,
        temperature: 0.2,
      });

      if (result?.news_body && result.news_body.length >= 20) {
        newsData = result;
        console.log(`[S1] OK: "${result.news_title}" (${result.news_body.length}ch)`);
      } else {
        console.log('[S1] Response missing news_body, keys:', Object.keys(result || {}));
        newsData = null;
      }
    } catch (err) {
      console.error('[S1] ERROR:', err.message);
      newsData = null;
    }

    // Extraction fallback
    if (!newsData) {
      newsData = {
        news_title: text.slice(0, 80).replace(/\n/g, ' ').trim(),
        news_body: text.slice(0, 5000),
        news_source: '',
        news_date: '',
        news_category: 'ทั่วไป',
      };
    }

    // ===== Step 2: วิเคราะห์ด้วย Preset =====
    const preset = getAnalysisPreset(analysisPresetId || 'viral_fb');
    console.log(`[S2] Analyzing: preset="${preset.name}" (${preset.id})`);

    let analysis;
    try {
      const analyzeUser = preset.user
        .replace('{title}', newsData.news_title || '')
        .replace('{content}', newsData.news_body.slice(0, 4000))
        .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

      console.log(`[S2] System prompt: ${preset.system.length}ch, User prompt: ${analyzeUser.length}ch`);

      const result = await callAI({
        systemPrompt: preset.system,
        userPrompt: analyzeUser,
        temperature: 0.5,
        maxTokens: 4000,
      });

      console.log('[S2] AI returned keys:', Object.keys(result || {}));

      // ยอมรับ result ถ้ามี summary หรือ key ที่เกี่ยวข้อง
      if (result && typeof result === 'object') {
        analysis = {
          summary: result.summary || result.analysis || result.content || JSON.stringify(result).slice(0, 2000),
          key_points: result.key_points || result.keyPoints || [],
          people_involved: result.people_involved || result.people || [],
          emotion: result.emotion || '',
          content_type: result.content_type || result.type || '',
          viral_potential: result.viral_potential || result.viralPotential || '',
          suggested_angles: result.suggested_angles || result.angles || [],
          target_audience: result.target_audience || result.audience || '',
        };
        console.log(`[S2] OK: summary=${analysis.summary?.length}ch`);
      } else {
        analysis = null;
      }
    } catch (err) {
      console.error('[S2] ERROR:', err.message);
      analysis = {
        summary: `⚠️ AI วิเคราะห์ไม่สำเร็จ: ${err.message}`,
        key_points: [],
        people_involved: [],
        emotion: '',
        content_type: newsData.news_category || '',
        viral_potential: '',
        suggested_angles: [],
        target_audience: '',
      };
    }

    // Final fallback
    if (!analysis) {
      analysis = {
        summary: '⚠️ AI ไม่ส่งข้อมูลกลับ — ลองเปลี่ยน Preset หรือตรวจสอบ API Key',
        key_points: [],
        people_involved: [],
        emotion: '',
        content_type: '',
        viral_potential: '',
        suggested_angles: [],
        target_audience: '',
      };
    }

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
    console.error('[Summarize] Fatal:', error.message, error.stack);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
