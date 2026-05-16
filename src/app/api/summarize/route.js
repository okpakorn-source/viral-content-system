import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getPrompt, getAnalysisPreset } from '@/lib/ai/promptStore';

// กฎเหล็กระดับระบบ — บังคับทุก Preset ห้ามมั่ว
const SYSTEM_STRICT_RULE = `
[กฎเหล็กของระบบ — บังคับเหนือทุกคำสั่ง]
1. ห้ามแต่งเรื่องใหม่ ห้ามเพิ่มข้อมูลที่ไม่มีในเนื้อข่าว
2. ใช้เฉพาะข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น
3. ห้ามสร้างชื่อคน สถานที่ ตัวเลข เหตุการณ์ ที่ไม่มีในต้นฉบับ
4. ถ้าข่าวไม่มีข้อมูลส่วนไหน ให้ข้ามไป อย่าเดา
5. ตอบเป็น JSON ตามโครงสร้างที่กำหนด`;

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
        console.log('[S1] No news_body, keys:', Object.keys(result || {}));
        newsData = null;
      }
    } catch (err) {
      console.error('[S1] ERROR:', err.message);
      newsData = null;
    }

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
    console.log(`[S2] Preset: "${preset.name}" (${preset.id})`);

    // สร้าง system prompt = กฎระบบ + preset prompt
    const fullSystemPrompt = `${preset.system}\n${SYSTEM_STRICT_RULE}`;

    // สร้าง user prompt โดยใส่เนื้อข่าวจริงเข้าไปตรงๆ
    const newsContent = newsData.news_body.slice(0, 4000);
    const newsTitle = newsData.news_title || '';

    const fullUserPrompt = `จากเนื้อข่าวด้านล่างนี้เท่านั้น ให้เขียนใหม่ตามสไตล์ที่กำหนด

=== หัวข้อข่าว ===
${newsTitle}

=== เนื้อข่าวที่สกัดมาแล้ว (ใช้ข้อมูลจากนี้เท่านั้น ห้ามแต่งเพิ่ม) ===
${newsContent}
=== จบเนื้อข่าว ===

${customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : ''}

ตอบเป็น JSON ตามโครงสร้างนี้เท่านั้น:
{
  "summary": "เนื้อหาที่เขียนใหม่จากข่าวข้างต้น ยาว 3-4 ย่อหน้า ห้ามแต่งข้อมูลใหม่",
  "key_points": ["ประเด็นจากข่าว 1", "ประเด็นจากข่าว 2", "ประเด็นจากข่าว 3"],
  "people_involved": ["ชื่อบุคคลจากข่าว"],
  "emotion": "อารมณ์หลักของข่าว",
  "content_type": "ประเภทข่าว",
  "viral_potential": "สูง/กลาง/ต่ำ — เหตุผล",
  "suggested_angles": ["มุมมอง 1", "มุมมอง 2"],
  "target_audience": "กลุ่มเป้าหมาย"
}`;

    console.log(`[S2] System: ${fullSystemPrompt.length}ch, User: ${fullUserPrompt.length}ch, News: ${newsContent.length}ch`);

    let analysis;
    try {
      const result = await callAI({
        systemPrompt: fullSystemPrompt,
        userPrompt: fullUserPrompt,
        temperature: 0.4,
        maxTokens: 4000,
      });

      console.log('[S2] AI keys:', Object.keys(result || {}));

      if (result && typeof result === 'object') {
        analysis = {
          summary: result.summary || result.analysis || result.content || '',
          key_points: result.key_points || result.keyPoints || [],
          people_involved: result.people_involved || result.people || [],
          emotion: result.emotion || '',
          content_type: result.content_type || result.type || '',
          viral_potential: result.viral_potential || result.viralPotential || '',
          suggested_angles: result.suggested_angles || result.angles || [],
          target_audience: result.target_audience || result.audience || '',
        };

        if (!analysis.summary) {
          // ถ้าไม่มี summary แต่มี key อื่น ให้ log เพื่อ debug
          console.error('[S2] No summary field! Full response:', JSON.stringify(result).slice(0, 500));
          analysis.summary = `AI ตอบไม่ตรง format — keys: ${Object.keys(result).join(', ')}`;
        }
      }
    } catch (err) {
      console.error('[S2] ERROR:', err.message);
      analysis = {
        summary: `⚠️ วิเคราะห์ไม่สำเร็จ: ${err.message}`,
        key_points: [],
        people_involved: [],
        emotion: '',
        content_type: '',
        viral_potential: '',
        suggested_angles: [],
        target_audience: '',
      };
    }

    if (!analysis) {
      analysis = {
        summary: '⚠️ AI ไม่ส่งข้อมูลกลับ',
        key_points: [], people_involved: [], emotion: '',
        content_type: '', viral_potential: '', suggested_angles: [], target_audience: '',
      };
    }

    console.log(`[S2] Done: summary=${analysis.summary?.length}ch`);

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
