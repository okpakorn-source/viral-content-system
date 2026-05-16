import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getPrompt, getAnalysisPreset } from '@/lib/ai/promptStore';
import { getWorkflow, saveExtraction, saveBreakdown, saveAnalysis, buildFullContext, validateOutput } from '@/lib/workflow/workflowEngine';

/**
 * ดึง summary จาก AI response ไม่ว่า key จะชื่ออะไร
 */
function extractSummary(result) {
  const directKeys = ['main_post', 'summary', 'content', 'analysis', 'post', 'body', 'text', 'article'];
  for (const k of directKeys) {
    if (result[k] && typeof result[k] === 'string' && result[k].length > 20) {
      return result[k];
    }
  }
  let longest = '';
  for (const [key, val] of Object.entries(result)) {
    if (typeof val === 'string' && val.length > longest.length) longest = val;
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
    const { text, sourceType, customPrompt, analysisPresetId, mode, newsTitle, breakdownData, workflowId } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    // ===== MODE: extract — สกัดเนื้อข่าวอย่างเดียว =====
    if (mode === 'extract') {
      const extractionPrompt = getPrompt('extraction');
      try {
        const prompt = extractionPrompt.prompt
          .replace('{content}', text.slice(0, 8000))
          .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

        console.log('[Extract] Extracting...');
        const result = await callAI({ prompt, temperature: 0.2 });

        if (result?.news_body && result.news_body.length >= 20) {
          console.log(`[Extract] OK: "${result.news_title}" (${result.news_body.length}ch)`);
          // Save to workflow DB
          if (workflowId) {
            await saveExtraction(workflowId, {
              newsTitle: result.news_title, newsBody: result.news_body,
              newsSource: result.news_source, newsDate: result.news_date,
              newsCategory: result.news_category, rawInput: text.slice(0, 5000),
            }).catch(e => console.error('[Extract] DB save err:', e.message));
          }
          return NextResponse.json({
            success: true,
            data: {
              newsTitle: result.news_title,
              newsBody: result.news_body,
              newsSource: result.news_source,
              newsDate: result.news_date,
              newsCategory: result.news_category,
            },
          });
        }
      } catch (err) {
        console.error('[Extract] ERROR:', err.message);
      }

      // Fallback
      return NextResponse.json({
        success: true,
        data: {
          newsTitle: text.slice(0, 80).replace(/\n/g, ' ').trim(),
          newsBody: text.slice(0, 5000),
          newsSource: '', newsDate: '', newsCategory: 'ทั่วไป',
        },
      });
    }

    // ===== MODE: breakdown — แตกประเด็น + สรุปใจความ =====
    if (mode === 'breakdown') {
      const breakdownPrompt = getPrompt('breakdown');
      console.log(`[Breakdown] newsTitle: "${(newsTitle || '').slice(0, 80)}", textLen: ${text?.length}`);

      const prompt = breakdownPrompt.prompt
        .replace('{title}', newsTitle || text.slice(0, 100))
        .replace('{content}', text.slice(0, 6000))
        .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

      try {
        const result = await callAI({ prompt, model: 'gpt-4o', temperature: 0.4, maxTokens: 6000 });
        console.log(`[Breakdown] OK, keys: ${Object.keys(result || {}).join(', ')}`);

        const bdData = {
          news_summary: result.news_summary || '',
          key_points: result.key_points || [],
          best_sections: result.best_sections || [],
          key_facts: result.key_facts || { people: [], places: [], numbers: [], dates: [] },
          emotional_hooks: result.emotional_hooks || [],
          suggested_angles: result.suggested_angles || [],
          quotes: result.quotes || [],
          conflicts: result.conflicts || [],
          pain_points: result.pain_points || [],
        };

        // Save to workflow DB
        if (workflowId) {
          await saveBreakdown(workflowId, bdData).catch(e => console.error('[Breakdown] DB save err:', e.message));
        }

        return NextResponse.json({ success: true, data: bdData });
      } catch (err) {
        console.error('[Breakdown] ERROR:', err.message);
        return NextResponse.json({ success: false, error: `แตกประเด็นไม่สำเร็จ: ${err.message}` }, { status: 500 });
      }
    }

    // ===== MODE: analyze — วิเคราะห์ด้วย Preset (ใช้ Persistent Context) =====
    if (mode === 'analyze') {
      const preset = getAnalysisPreset(analysisPresetId || 'viral_fb');
      console.log(`[Analyze] Preset: "${preset.id}" "${preset.name}"`);

      // โหลด context จาก DB ถ้ามี workflowId
      let wfContext = null;
      let actualNewsBody = text;
      let actualNewsTitle = newsTitle;
      let actualBreakdown = breakdownData;

      if (workflowId) {
        wfContext = await getWorkflow(workflowId).catch(() => null);
        if (wfContext) {
          actualNewsBody = wfContext.newsBody || text;
          actualNewsTitle = wfContext.newsTitle || newsTitle;
          actualBreakdown = wfContext.breakdownData || breakdownData;
          console.log(`[Analyze] ✅ Loaded from DB: title="${(actualNewsTitle||'').slice(0,60)}", body=${actualNewsBody?.length}ch, breakdown=${actualBreakdown?.key_points?.length || 0} points`);
        }
      }

      console.log(`[Analyze] newsTitle: "${(actualNewsTitle || '').slice(0,80)}", textLen: ${actualNewsBody?.length}`);

      // สร้าง prompt จาก preset — replace placeholders
      let prompt = preset.prompt;
      // Replace placeholders ด้วยค่าจริง (จาก DB หรือ request)
      prompt = prompt.replace('{title}', actualNewsTitle || actualNewsBody.slice(0, 100));
      prompt = prompt.replace('{content}', actualNewsBody.slice(0, 8000));
      prompt = prompt.replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

      // === บังคับ inject Full Context จาก Workflow Engine ===
      const fullCtx = buildFullContext({
        newsBody: actualNewsBody,
        newsTitle: actualNewsTitle,
        breakdownData: actualBreakdown,
      });

      // ถ้า prompt ยังไม่มีเนื้อข่าว → append context ทั้งหมด
      if (!prompt.includes(actualNewsBody.slice(0, 50))) {
        prompt += '\n\n' + fullCtx;
        console.log('[Analyze] ✅ Full context injected via buildFullContext()');
      } else {
        // มีข่าวแล้ว แต่ยังไม่มี breakdown → append breakdown เท่านั้น
        if (actualBreakdown?.key_points?.length > 0 && !prompt.includes('ผลการแตกประเด็น')) {
          prompt += '\n\n' + fullCtx.split('=== จบเนื้อข่าว ===')[1] || '';
          console.log('[Analyze] ✅ Breakdown context appended');
        }
      }

      console.log(`[Analyze] Final prompt length: ${prompt.length}ch`);
      console.log(`[Analyze] Context: news=${actualNewsBody?.length}ch, breakdown=${actualBreakdown?.key_points?.length || 0} points`);

      // === สร้าง Multi-Version Writing Prompt ===
      let multiPrompt = prompt;
      multiPrompt += `\n\n=== คำสั่งสำคัญสำหรับการเขียน ===
คุณต้องสร้างเนื้อหาหลายเวอร์ชันจากข่าวนี้ โดยแต่ละเวอร์ชันใช้มุมเขียนต่างกัน
แต่ละเวอร์ชัน:
- ต้องยาวอย่างน้อย 280 คำ (ห้ามสั้นกว่านี้เด็ดขาด)
- ต้องอ้างอิงข้อมูลจริงจากข่าว ห้ามแต่งเรื่องที่ไม่มีในข่าว
- ต้องครอบคลุมประเด็นสำคัญจากข่าว
- ต้องมีโครงสร้าง: เปิดเรื่อง(hook) → เล่าเรื่อง → รายละเอียด → ปิดกระตุ้นอารมณ์

สร้างอย่างน้อย 5 เวอร์ชัน ในแนวต่างๆ:
1. แนวดราม่า/เดือด - เน้นความขัดแย้ง ความรุนแรงทางอารมณ์
2. แนวซึ้ง/สะเทือนใจ - เน้นอารมณ์ ความเห็นอกเห็นใจ
3. แนวไวรัล/แชร์ง่าย - เปิดแรง กระตุ้นอารมณ์ให้แชร์
4. แนวชวนถกเถียง/คอมเมนต์ - ตั้งคำถาม ให้คนมาแสดงความเห็น
5. แนวเล่าเรื่อง/บรรยาย - เล่าเป็นเรื่องราวยาว มีรายละเอียด

ตอบเป็น JSON:
{
  "versions": [
    {"style": "ชื่อแนว", "title": "พาดหัว", "content": "เนื้อหายาว 280+ คำ", "hook": "ประโยคเปิด", "closing": "ประโยคปิดกระตุ้น", "tone": "โทนเสียง", "target": "กลุ่มเป้าหมาย"}
  ],
  "news_reference": "สรุปข่าวต้นฉบับที่ใช้อ้างอิง 2-3 ประโยค"
}`;

      try {
        const result = await callAI({ prompt: multiPrompt, model: 'gpt-4o', temperature: 0.7, maxTokens: 16000 });
        console.log('[Analyze] AI keys:', Object.keys(result || {}));
        console.log('[Analyze] versions count:', result?.versions?.length || 0);

        // Debug info — ใช้ค่าจริง
        const debugInfo = {
          promptLength: multiPrompt.length,
          newsBodyLength: actualNewsBody?.length || 0,
          newsTitle: actualNewsTitle || '',
          breakdownPointsCount: actualBreakdown?.key_points?.length || 0,
          presetUsed: preset.name,
          hasBreakdown: !!actualBreakdown,
          workflowId: workflowId || 'none',
          contextSource: wfContext ? 'DB (persistent)' : 'request (stateless)',
          promptPreview: multiPrompt.slice(0, 500) + '...',
        };

        if (result && typeof result === 'object') {
          let versions = result.versions || [];
          if (versions.length === 0 && result.main_post) {
            versions = [{ style: preset.name, title: actualNewsTitle, content: extractSummary(result), hook: '', closing: result.engagement_ending || '', tone: result.emotion || '', target: '' }];
          }

          // Validate output
          const validation = validateOutput(result, { newsTitle: actualNewsTitle, newsBody: actualNewsBody });
          console.log(`[Analyze] Validation: ${validation.valid ? '✅ PASS' : '⚠️ ISSUES: ' + validation.issues.join(', ')}`);

          // Save to workflow DB
          if (workflowId) {
            await saveAnalysis(workflowId, { versions, news_reference: result.news_reference }, preset.id)
              .catch(e => console.error('[Analyze] DB save err:', e.message));
          }

          return NextResponse.json({
            success: true,
            data: {
              usedPreset: { id: preset.id, name: preset.name },
              versions,
              news_reference: result.news_reference || '',
              summary: extractSummary(result) || versions[0]?.content || '',
              key_points: extractArray(result, 'key_points', 'keyPoints', 'viral_headlines'),
              emotion: extractString(result, 'emotion', 'tone'),
              viral_potential: extractString(result, 'viral_potential', 'facebook_safety_level'),
              engagement_ending: result.engagement_ending || '',
              facebook_safe_check: result.facebook_safe_check || null,
              validation,
              debug: debugInfo,
            },
          });
        }
      } catch (err) {
        console.error('[Analyze] ERROR:', err.message);
        return NextResponse.json({
          success: false,
          error: `วิเคราะห์ไม่สำเร็จ: ${err.message}`,
        }, { status: 500 });
      }
    }

    // ===== DEFAULT: legacy flow (extract + analyze in one) =====
    const extractionPrompt = getPrompt('extraction');
    let newsData;
    try {
      const prompt = extractionPrompt.prompt
        .replace('{content}', text.slice(0, 8000))
        .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');
      const result = await callAI({ prompt, temperature: 0.2 });
      if (result?.news_body && result.news_body.length >= 20) newsData = result;
    } catch (err) { console.error('[S1] ERROR:', err.message); }

    if (!newsData) {
      newsData = { news_title: text.slice(0, 80).replace(/\n/g, ' ').trim(), news_body: text.slice(0, 5000), news_source: '', news_date: '', news_category: 'ทั่วไป' };
    }

    const preset = getAnalysisPreset(analysisPresetId || 'viral_fb');
    let analysis;
    try {
      const prompt = preset.prompt
        .replace('{title}', newsData.news_title || '')
        .replace('{content}', newsData.news_body.slice(0, 6000))
        .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');
      const result = await callAI({ prompt, temperature: 0.6, maxTokens: 8000 });
      if (result && typeof result === 'object') {
        const summary = extractSummary(result);
        analysis = {
          summary: summary || '', key_points: extractArray(result, 'key_points', 'viral_headlines'),
          people_involved: extractArray(result, 'people_involved'), emotion: extractString(result, 'emotion', 'tone', 'emotional_direction'),
          content_type: extractString(result, 'content_type', 'selected_main_angle'), viral_potential: extractString(result, 'viral_potential', 'facebook_safety_level'),
          suggested_angles: extractArray(result, 'suggested_angles', 'viral_headlines'), target_audience: extractString(result, 'target_audience'),
          engagement_ending: result.engagement_ending || '', selected_main_angle: result.selected_main_angle || '',
          facebook_safe_check: result.facebook_safe_check || null, emotion_analysis: result.emotion_analysis || null,
        };
      }
    } catch (err) {
      analysis = { summary: `⚠️ ${err.message}`, key_points: [], people_involved: [], emotion: '', content_type: '', viral_potential: '', suggested_angles: [], target_audience: '' };
    }

    return NextResponse.json({
      success: true,
      data: { newsTitle: newsData.news_title, newsBody: newsData.news_body, newsSource: newsData.news_source, newsDate: newsData.news_date, newsCategory: newsData.news_category, usedPreset: { id: preset.id, name: preset.name }, ...analysis },
    });
  } catch (error) {
    console.error('[Summarize] Fatal:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
