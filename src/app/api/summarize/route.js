import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getPrompt, getAnalysisPreset } from '@/lib/ai/promptStore';

/**
 * ดึง summary จาก AI response ไม่ว่า key จะชื่ออะไร
 */
function extractSummary(result) {
  // ลอง key ที่เป็นไปได้ทั้งหมด
  const directKeys = ['summary', 'main_post', 'content', 'analysis', 'post', 'body', 'text', 'article'];
  for (const k of directKeys) {
    if (result[k] && typeof result[k] === 'string' && result[k].length > 20) {
      return result[k];
    }
  }

  // ถ้ามี key ที่เป็น string ยาวๆ ให้ใช้อันที่ยาวสุด
  let longest = '';
  for (const [key, val] of Object.entries(result)) {
    if (typeof val === 'string' && val.length > longest.length) {
      longest = val;
    }
  }
  if (longest.length > 30) return longest;

  return '';
}

function extractArray(result, ...keys) {
  for (const k of keys) {
    if (Array.isArray(result[k]) && result[k].length > 0) return result[k];
  }
  return [];
}

function extractString(result, ...keys) {
  for (const k of keys) {
    if (result[k] && typeof result[k] === 'string') return result[k];
  }
  return '';
}

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
      const prompt = preset.prompt
        .replace('{title}', newsData.news_title || '')
        .replace('{content}', newsData.news_body.slice(0, 4000))
        .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

      console.log(`[S2] Prompt: ${prompt.length}ch`);

      const result = await callAI({ prompt, temperature: 0.6, maxTokens: 8000 });
      console.log('[S2] AI keys:', Object.keys(result || {}));

      if (result && typeof result === 'object') {
        const summary = extractSummary(result);

        analysis = {
          summary: summary || `(AI ตอบแต่ไม่มี summary — keys: ${Object.keys(result).join(', ')})`,
          key_points: extractArray(result, 'key_points', 'keyPoints', 'possible_angles', 'viral_headlines'),
          people_involved: extractArray(result, 'people_involved', 'people'),
          emotion: extractString(result, 'emotion', 'tone', 'emotional_direction'),
          content_type: extractString(result, 'content_type', 'type'),
          viral_potential: extractString(result, 'viral_potential', 'viralPotential', 'risk_level'),
          suggested_angles: extractArray(result, 'suggested_angles', 'angles', 'possible_angles'),
          target_audience: extractString(result, 'target_audience', 'audience'),
        };
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
