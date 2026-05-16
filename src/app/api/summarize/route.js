import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getPrompt, getAnalysisPreset } from '@/lib/ai/promptStore';

export async function POST(request) {
  try {
    const { text, sourceType, customPrompt, analysisPresetId } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    // ===== Step 1: สกัดเนื้อข่าว =====
    const extractionPrompt = getPrompt('extraction');
    let newsData;
    try {
      const prompt = extractionPrompt.prompt
        .replace('{content}', text.slice(0, 8000))
        .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

      console.log('[S1] Extracting...');
      const result = await callAI({ prompt, temperature: 0.2 });

      if (result?.news_body && result.news_body.length >= 20) {
        newsData = result;
        console.log(`[S1] OK: "${result.news_title}" (${result.news_body.length}ch)`);
      }
    } catch (err) {
      console.error('[S1] ERROR:', err.message);
    }

    if (!newsData) {
      newsData = {
        news_title: text.slice(0, 80).replace(/\n/g, ' ').trim(),
        news_body: text.slice(0, 5000),
        news_source: '', news_date: '', news_category: 'ทั่วไป',
      };
    }

    // ===== Step 2: วิเคราะห์ด้วย Preset =====
    const preset = getAnalysisPreset(analysisPresetId || 'viral_fb');
    console.log(`[S2] Preset: "${preset.name}"`);

    let analysis;
    try {
      // ใส่เนื้อข่าวเข้าไปใน prompt ของ preset
      const prompt = preset.prompt
        .replace('{title}', newsData.news_title || '')
        .replace('{content}', newsData.news_body.slice(0, 4000))
        .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

      console.log(`[S2] Prompt: ${prompt.length}ch`);

      const result = await callAI({ prompt, temperature: 0.5, maxTokens: 4000 });

      if (result && typeof result === 'object') {
        analysis = {
          summary: result.summary || result.analysis || result.content || '',
          key_points: result.key_points || result.keyPoints || [],
          people_involved: result.people_involved || result.people || [],
          emotion: result.emotion || '',
          content_type: result.content_type || '',
          viral_potential: result.viral_potential || '',
          suggested_angles: result.suggested_angles || [],
          target_audience: result.target_audience || '',
        };
        if (!analysis.summary) {
          analysis.summary = `AI ตอบไม่ตรง format — keys: ${Object.keys(result).join(', ')}`;
        }
      }
    } catch (err) {
      console.error('[S2] ERROR:', err.message);
      analysis = {
        summary: `⚠️ วิเคราะห์ไม่สำเร็จ: ${err.message}`,
        key_points: [], people_involved: [], emotion: '',
        content_type: '', viral_potential: '', suggested_angles: [], target_audience: '',
      };
    }

    if (!analysis) {
      analysis = {
        summary: '⚠️ AI ไม่ส่งข้อมูลกลับ',
        key_points: [], people_involved: [], emotion: '',
        content_type: '', viral_potential: '', suggested_angles: [], target_audience: '',
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
    console.error('[Summarize] Fatal:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
