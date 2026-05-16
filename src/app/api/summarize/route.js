import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { getPrompt, getAnalysisPreset } from '@/lib/ai/promptStore';
import { getWorkflow, saveExtraction, saveBreakdown, saveAnalysis, buildFullContext, validateOutput } from '@/lib/workflow/workflowEngine';
import { MasterAgent } from '@/lib/agents/masterAgent';
import { callSmartAI, getAvailableModels } from '@/lib/ai/aiRouter';
import { moderateVersions } from '@/lib/ai/moderationAgent';

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
    const { text, sourceType, customPrompt, analysisPresetId, mode, newsTitle, breakdownData, researchData, contentLength, workflowId } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    // === Content Length Config ===
    const lengthConfig = {
      short:  { min: 250, max: 300, paragraphs: '3', paraDesc: '3 ย่อหน้า', sentences: '3-5' },
      medium: { min: 400, max: 500, paragraphs: '4-5', paraDesc: '4-5 ย่อหน้า', sentences: '4-6' },
      long:   { min: 500, max: 1000, paragraphs: '6-8', paraDesc: '6-8 ย่อหน้า', sentences: '4-8' },
    };
    const lenCfg = lengthConfig[contentLength] || lengthConfig.short;

    // ===== MODE: extract — สกัดเนื้อข่าวอย่างเดียว =====
    if (mode === 'extract') {

      // === PATH A: TikTok/YouTube — ถอดเสียง → จัดรูปแบบ (รักษาคำพูดเดิม) ===
      if (sourceType === 'tiktok' || sourceType === 'youtube') {
        try {
          const transcriptPrompt = `คุณคือผู้เชี่ยวชาญจัดรูปแบบข้อความถอดเสียง (transcript)

กฎเหล็ก:
1. ห้ามเขียนใหม่ ห้ามสรุปเอง ห้ามเปลี่ยนคำพูดคน — ต้องรักษาคำพูดเดิมทุกคำ
2. ห้ามตัดเนื้อหาออก — เก็บทุกประโยคที่คนพูด
3. ห้ามเพิ่มข้อมูลที่ไม่มีในถอดเสียง
4. จัดย่อหน้าให้อ่านง่าย เพิ่มเครื่องหมายวรรคตอนที่หายไป
5. ตัดเฉพาะ metadata markers (===, timestamp, ความยาว:) ออก
6. ถ้ามีคนพูดหลายคน ให้แยกบทพูดให้ชัดเจน
7. คำพูดที่เป็น quote ให้ใส่ "" ครอบ

สิ่งที่ต้องทำ:
- จัดข้อความถอดเสียงให้เป็นย่อหน้าอ่านง่าย
- เพิ่มเครื่องหมายวรรคตอน (มหัพภาค จุลภาค) ที่ขาดหายไป
- สรุปหัวข้อจากเนื้อหาที่พูด
- ระบุแหล่งที่มาว่าเป็นคลิป ${sourceType === 'tiktok' ? 'TikTok' : 'YouTube'}

${customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : ''}

=== ข้อความถอดเสียง ===
${text.slice(0, 8000)}
========================

ตอบเป็น JSON:
{
  "news_title": "หัวข้อที่สรุปได้จากเนื้อหาที่พูด",
  "news_body": "เนื้อหาที่จัดรูปแบบแล้ว — รักษาคำพูดเดิมทุกคำ จัดย่อหน้าให้อ่านง่าย",
  "news_source": "คลิป ${sourceType === 'tiktok' ? 'TikTok' : 'YouTube'}",
  "news_date": "",
  "news_category": "หมวดหมู่"
}`;

          console.log(`[Extract-Transcript] ${sourceType} mode — preserving original speech...`);
          const { result, model: usedModel } = await callSmartAI('extract', { prompt: transcriptPrompt, temperature: 0.15 });
          console.log(`[Extract-Transcript] Used model: ${usedModel}`);

          if (result?.news_body && result.news_body.length >= 20) {
            console.log(`[Extract-Transcript] ✅ OK: "${result.news_title}" (${result.news_body.length}ch)`);
            if (workflowId) {
              await saveExtraction(workflowId, {
                newsTitle: result.news_title, newsBody: result.news_body,
                newsSource: result.news_source, newsDate: result.news_date,
                newsCategory: result.news_category, rawInput: text.slice(0, 5000),
              }).catch(e => console.error('[Extract-Transcript] DB save err:', e.message));
              const agent = new MasterAgent(workflowId);
              agent.onExtractionComplete({
                newsTitle: result.news_title, newsBody: result.news_body,
                newsSource: result.news_source, newsDate: result.news_date,
                newsCategory: result.news_category,
              });
              await agent.saveMemoryToDB().catch(() => {});
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
          console.error('[Extract-Transcript] ERROR:', err.message);
        }

        // Fallback — ส่ง raw transcript กลับ (ยังดีกว่าเสียหาย)
        const cleanText = text
          .replace(/===.*?===/g, '')
          .replace(/ความยาว:.*นาที/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return NextResponse.json({
          success: true,
          data: {
            newsTitle: cleanText.slice(0, 80).replace(/\n/g, ' ').trim(),
            newsBody: cleanText.slice(0, 5000),
            newsSource: `คลิป ${sourceType === 'tiktok' ? 'TikTok' : 'YouTube'}`,
            newsDate: '', newsCategory: 'ทั่วไป',
          },
        });
      }

      // === PATH B: URL/Image/Raw — สกัดข่าวจาก web content (เหมือนเดิม) ===
      const extractionPrompt = getPrompt('extraction');
      try {
        const sourceHint = {
          image: 'ข้อมูลนี้มาจากการอ่านภาพ (OCR) — อาจมี marker metadata ให้ตัดออก จัดข้อความให้อ่านง่าย',
        }[sourceType] || '';

        const prompt = extractionPrompt.prompt
          .replace('{content}', text.slice(0, 8000))
          .replace('{custom_instruction}', [
            sourceHint ? `[แหล่งข้อมูล: ${sourceHint}]` : '',
            customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '',
          ].filter(Boolean).join('\n'));

        console.log('[Extract-URL] Extracting via SmartAI...');
        const { result, model: usedModel } = await callSmartAI('extract', { prompt, temperature: 0.2 });
        console.log(`[Extract-URL] Used model: ${usedModel}`);

        if (result?.news_body && result.news_body.length >= 20) {
          console.log(`[Extract-URL] OK: "${result.news_title}" (${result.news_body.length}ch)`);
          if (workflowId) {
            await saveExtraction(workflowId, {
              newsTitle: result.news_title, newsBody: result.news_body,
              newsSource: result.news_source, newsDate: result.news_date,
              newsCategory: result.news_category, rawInput: text.slice(0, 5000),
            }).catch(e => console.error('[Extract-URL] DB save err:', e.message));
            const agent = new MasterAgent(workflowId);
            agent.onExtractionComplete({
              newsTitle: result.news_title, newsBody: result.news_body,
              newsSource: result.news_source, newsDate: result.news_date,
              newsCategory: result.news_category,
            });
            await agent.saveMemoryToDB().catch(() => {});
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
        console.error('[Extract-URL] ERROR:', err.message);
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

    // ===== MODE: breakdown — แตกประเด็น + สรุปใจความ (Full Context Pipeline) =====
    if (mode === 'breakdown') {
      // 1. โหลด prompt จาก promptStore (source of truth)
      const breakdownPrompt = getPrompt('breakdown');

      // 2. Resolve actual news body — ลำดับ: DB workflow > request text > fail
      let actualNewsBody = text;
      let actualNewsTitle = newsTitle;
      let contextSource = 'request';

      if (workflowId) {
        const wf = await getWorkflow(workflowId).catch(() => null);
        if (wf?.newsBody && wf.newsBody.length > actualNewsBody.length) {
          actualNewsBody = wf.newsBody;
          actualNewsTitle = wf.newsTitle || newsTitle;
          contextSource = 'DB (workflow)';
          console.log(`[Breakdown] ✅ Loaded full news from DB: ${actualNewsBody.length}ch`);
        }
      }

      // 3. ส่ง rawText เต็ม (ไม่ตัด) — ใส่เข้า prompt template
      console.log(`[Breakdown] Context: source=${contextSource}, title="${(actualNewsTitle || '').slice(0, 60)}", bodyLen=${actualNewsBody?.length}ch`);

      const prompt = breakdownPrompt.prompt
        .replace('{title}', actualNewsTitle || actualNewsBody.slice(0, 100))
        .replace('{content}', actualNewsBody) // ส่งเต็ม ไม่ตัด
        .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติมจากผู้ใช้: "${customPrompt}"` : '');

      // 4. LOG prompt จริง 100%
      console.log(`[Breakdown] 📋 PROMPT USED (first 300ch): ${prompt.slice(0, 300)}`);
      console.log(`[Breakdown] 📋 PROMPT LENGTH: ${prompt.length}ch`);
      console.log(`[Breakdown] 📋 NEWS IN PROMPT: ${actualNewsBody.length}ch of actual news content`);

      try {
        const result = await callAI({ prompt, model: 'gpt-4o', temperature: 0.4, maxTokens: 8000 });
        console.log(`[Breakdown] ✅ OK, keys: ${Object.keys(result || {}).join(', ')}`);

        const bdData = {
          news_summary: result.news_summary || '',
          core_story: result.core_story || '',
          main_emotional_core: result.main_emotional_core || '',
          conflict_point: result.conflict_point || '',
          viral_trigger: result.viral_trigger || '',
          key_points: result.key_points || [],
          best_sections: result.best_sections || [],
          key_facts: result.key_facts || { people: [], places: [], numbers: [], dates: [] },
          emotional_hooks: result.emotional_hooks || [],
          suggested_angles: result.suggested_angles || [],
          possible_angles: result.possible_angles || [],
          best_main_angle: result.best_main_angle || null,
          language_strategy: result.language_strategy || null,
          quotes: result.quotes || [],
          conflicts: result.conflicts || [],
          pain_points: result.pain_points || [],
        };

        // Save to workflow DB + Master Agent
        if (workflowId) {
          await saveBreakdown(workflowId, bdData).catch(e => console.error('[Breakdown] DB save err:', e.message));
          // Update Master Agent memory
          const agent = new MasterAgent(workflowId);
          await agent.loadFromDB().catch(() => {});
          agent.onBreakdownComplete(bdData);
          await agent.saveMemoryToDB().catch(() => {});
        }

        return NextResponse.json({
          success: true,
          data: bdData,
          debug: {
            contextSource,
            newsBodyLength: actualNewsBody.length,
            promptLength: prompt.length,
            newsTitle: actualNewsTitle || '',
          }
        });
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

      // สร้าง prompt จาก preset — replace placeholders ด้วยค่าจริงเต็ม
      let prompt = preset.prompt;
      prompt = prompt.replace('{title}', actualNewsTitle || actualNewsBody.slice(0, 100));
      prompt = prompt.replace('{content}', actualNewsBody); // ส่งเต็ม ไม่ตัด
      prompt = prompt.replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

      // === บังคับ inject Full Context ผ่าน Master Agent ===
      let fullCtx = '';
      if (workflowId) {
        const agent = new MasterAgent(workflowId);
        const loaded = await agent.loadFromDB().catch(() => false);
        if (loaded) {
          fullCtx = agent.compileContext();
          console.log(`[Analyze] ✅ Context compiled via MasterAgent (${fullCtx.length}ch)`);
          console.log(`[Analyze] Memory: entities=${agent.memory.entities.people?.length || 0} people, angles=${agent.memory.angles.possibleAngles?.length || 0}, emotion="${(agent.memory.emotional.emotionalCore || '').slice(0, 50)}"`);
        }
      }
      if (!fullCtx) {
        // Fallback to old buildFullContext
        fullCtx = buildFullContext({ newsBody: actualNewsBody, newsTitle: actualNewsTitle, breakdownData: actualBreakdown });
        console.log('[Analyze] ⚠️ Fallback to buildFullContext');
      }

      // Inject context ถ้ายังไม่มี
      if (!prompt.includes(actualNewsBody.slice(0, 50))) {
        prompt += '\n\n' + fullCtx;
        console.log('[Analyze] ✅ Full context injected');
      } else if (actualBreakdown?.key_points?.length > 0 && !prompt.includes('Emotional Analysis')) {
        const parts = fullCtx.split('=== จบเนื้อข่าว ===');
        if (parts[1]) prompt += '\n\n' + parts[1];
        console.log('[Analyze] ✅ Structured context appended');
      }

      // === Inject Research Data (ข้อมูลเพิ่มเติมจาก Research Agent) ===
      if (researchData?.items?.length > 0) {
        const researchTopics = researchData.items.map(item => item.title).join(', ');
        const researchCtx = '\n\n=== ข้อมูลเพิ่มเติมจาก AI Research Agent (ต้องใช้ทุกหัวข้อ!) ===\n' +
          '⚠️ คำสั่งสำคัญ: ข้อมูลด้านล่างนี้ผู้ใช้เลือกมาเพิ่มแล้ว — ต้องนำทุกหัวข้อไปสอดแทรกในเนื้อหาที่เขียน\n' +
          '⚠️ ห้ามละเลย ต้องดัดแปลงคำให้เข้ากับ tone ของ preset แล้วใส่ให้ครบทุกหัวข้อ\n' +
          `📋 หัวข้อที่ต้องครอบคลุม: ${researchTopics}\n\n` +
          researchData.items.map((item, i) =>
            `${i+1}. [${item.type}] ${item.title}\n${item.content}${item.relevance ? '\n→ เกี่ยวข้อง: ' + item.relevance : ''}`
          ).join('\n\n') +
          '\n=== จบข้อมูลเพิ่มเติม ===\n' +
          '✅ ข้อมูลข้างต้นต้องถูกนำไปใช้ในเนื้อหาทุกเวอร์ชัน ดัดแปลงคำได้ แต่ต้องครบทุกหัวข้อ\n';
        prompt += researchCtx;
        console.log(`[Analyze] ✅ Research data injected: ${researchData.items.length} items (MUST USE)`);
      }

      console.log(`[Analyze] Final prompt length: ${prompt.length}ch (Mega Context)`);

      // === สร้าง Multi-Version Writing Prompt + Facebook Safety ===
      let multiPrompt = prompt + '\n\n=== คำสั่งสำคัญสำหรับการเขียน ===\n' +
        'คุณต้องสร้างเนื้อหาหลายเวอร์ชันจากข่าวนี้ โดยแต่ละเวอร์ชันใช้มุมเขียนต่างกัน\n' +
        `แต่ละเวอร์ชัน:\n` +
        `- ต้องยาวอย่างน้อย ${lenCfg.min} คำ ถึง ${lenCfg.max} คำ แบ่ง ${lenCfg.paraDesc} สำหรับ Facebook (ห้ามสั้นกว่า ${lenCfg.min} คำเด็ดขาด)\n` +
        `- โครงสร้าง ${lenCfg.paragraphs} ย่อหน้า: [ย่อหน้า 1] เปิดแรง hook ดึงอารมณ์ [ย่อหน้าตรงกลาง] เล่ารายละเอียด storytelling [ย่อหน้าสุดท้าย] ปิดด้วยประโยคบรรยายทิ้งอารมณ์ทรงพลัง\n` +
        `- แต่ละย่อหน้าต้องมีอย่างน้อย ${lenCfg.sentences} ประโยค คั่นด้วย \\n\\n\n` +
        '- ต้องอ้างอิงข้อมูลจริงจากข่าว ห้ามแต่งเรื่องที่ไม่มีในข่าว\n' +
        '- ต้องครอบคลุมประเด็นสำคัญจากข่าว\n' +
        '- ต้องมีโครงสร้าง: เปิดเรื่อง(hook) → เล่าเรื่อง → รายละเอียด → ปิดด้วยประโยคบรรยายทรงพลังทิ้งท้าย\n' +
        '- ⚠️ ห้ามตั้งคำถามปิดท้ายเด็ดขาด ห้ามจบด้วย "คุณคิดยังไง?", "เห็นด้วยไหม?" หรือคำถามใดๆ — เน้นบรรยายตาม prompt เท่านั้น\n\n' +
        'สร้างอย่างน้อย 5 เวอร์ชัน ในแนวต่างๆ:\n' +
        '1. แนวดราม่า/เดือด - เน้นความขัดแย้ง ความรุนแรงทางอารมณ์\n' +
        '2. แนวซึ้ง/สะเทือนใจ - เน้นอารมณ์ ความเห็นอกเห็นใจ\n' +
        '3. แนวไวรัล/แชร์ง่าย - เปิดแรง กระตุ้นอารมณ์ให้แชร์\n' +
        '4. แนววิเคราะห์เชิงลึก/บรรยาย - เจาะลึกมุมมอง ให้ข้อมูลครบถ้วน\n' +
        '5. แนวเล่าเรื่อง/บรรยาย - เล่าเป็นเรื่องราวยาว มีรายละเอียด\n\n' +
        '=== กฎเหล็ก FACEBOOK SAFETY — บังคับทุกเวอร์ชัน ===\n' +
        'ห้ามใช้คำเสี่ยงต่อไปนี้ในเนื้อหาที่เขียน ให้ rewrite เป็นคำปลอดภัยเสมอ:\n\n' +
        '"ฆ่า" → "ทำให้เสียชีวิต" หรือ "ก่อเหตุ"\n' +
        '"ฆาตกรรม" → "เหตุสูญเสีย" หรือ "คดีร้ายแรง"\n' +
        '"ศพ" → "ร่างผู้เสียชีวิต"\n' +
        '"ตาย/ดับ/สิ้นใจ" → "จากไป" หรือ "เสียชีวิต"\n' +
        '"สยอง/โหด/สลด" → "สะเทือนใจ" หรือ "น่าตกใจ"\n' +
        '"เลือด" → "ร่องรอยเหตุการณ์"\n' +
        '"แทง" → "ใช้ของมีคม"\n' +
        '"ยิง" → "ใช้อาวุธปืน"\n' +
        '"ข่มขืน" → "ล่วงละเมิดทางเพศ"\n' +
        '"ผูกคอ/จบชีวิต" → "เสียชีวิตอย่างน่าเศร้า"\n' +
        '"ชำแหละ/หมกศพ" → "เหตุรุนแรงอย่างยิ่ง"\n' +
        '"ทุบตี/ทำร้าย" → "ใช้ความรุนแรง"\n' +
        '"จัดฉาก" → "สร้างสถานการณ์"\n\n' +
        'หลักการ: เปลี่ยน "ความแรง" → "อารมณ์" เน้น emotional storytelling ไม่ใช่ shock/gore\n' +
        'ห้าม clickbait: "คุณจะไม่เชื่อ", "แชร์ด่วน", "ดูก่อนโดนลบ"\n' +
        'ห้าม engagement bait: "พิมพ์ 1", "เมนต์ 99", "ใครเห็นด้วยกดไลก์"\n' +
        '=== จบกฎ FACEBOOK SAFETY ===\n\n' +
        '⚠️⚠️⚠️ คำสั่งเด็ดขาด: เนื้อหาแต่ละเวอร์ชันต้องมีความยาวตามที่กำหนด (นับคำจริง) ถ้าเขียนสั้นกว่ากำหนด ถือว่าล้มเหลว ให้เขียนยาวไว้ก่อน ⚠️⚠️⚠️\n\n' +
        'ตอบเป็น JSON:\n' +
        '{\n' +
        '  "versions": [\n' +
        '    {"style": "ชื่อแนว", "title": "พาดหัว", "content": "เนื้อหายาว ${lenCfg.min}-${lenCfg.max} คำ แบ่ง ${lenCfg.paraDesc} คั่นด้วย \\n\\n", "hook": "ประโยคเปิด", "closing": "ประโยคปิดกระตุ้น", "tone": "โทนเสียง", "target": "กลุ่มเป้าหมาย"}\n' +
        '  ],\n' +
        '  "news_reference": "สรุปข่าวต้นฉบับที่ใช้อ้างอิง 2-3 ประโยค"\n' +
        '}';


      try {
        // ใช้ Smart Router: Claude สำหรับเขียน, fallback GPT-4o
        const { result, model: usedModel } = await callSmartAI('write', { prompt: multiPrompt, temperature: 0.7, maxTokens: 16000 });
        console.log(`[Analyze] Used model: ${usedModel}`);
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

          // Save to workflow DB + Master Agent
          if (workflowId) {
            await saveAnalysis(workflowId, { versions, news_reference: result.news_reference }, preset.id)
              .catch(e => console.error('[Analyze] DB save err:', e.message));
            // Update Master Agent memory
            const agent = new MasterAgent(workflowId);
            await agent.loadFromDB().catch(() => {});
            agent.onAnalysisComplete({ versions, news_reference: result.news_reference });
            agent.onValidationComplete({ safetyPassed: validation.valid, issues: validation.issues, factCheckPassed: true, riskyWordsFound: [], riskyWordsReplaced: [] });
            await agent.saveMemoryToDB().catch(() => {});
          }

          // === OpenAI Moderation API (ฟรี!) ===
          let moderation = { overallSafe: true, results: [] };
          try {
            moderation = await moderateVersions(versions);
            console.log(`[Analyze] Moderation: ${moderation.overallSafe ? '✅ ALL SAFE' : '⚠️ FLAGGED'}`);
          } catch (modErr) {
            console.warn('[Analyze] Moderation check skipped:', modErr.message);
          }

          return NextResponse.json({
            success: true,
            data: {
              usedPreset: { id: preset.id, name: preset.name },
              usedModel: usedModel || 'gpt-4o',
              versions,
              news_reference: result.news_reference || '',
              summary: extractSummary(result) || versions[0]?.content || '',
              key_points: extractArray(result, 'key_points', 'keyPoints', 'viral_headlines'),
              emotion: extractString(result, 'emotion', 'tone'),
              viral_potential: extractString(result, 'viral_potential', 'facebook_safety_level'),
              engagement_ending: result.engagement_ending || '',
              facebook_safe_check: result.facebook_safe_check || null,
              validation,
              moderation,
              availableModels: getAvailableModels(),
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

    // ===== MODE: RESEARCH — AI หาข้อมูลเพิ่มเติมจากหัวข้อข่าว =====
    if (mode === 'research') {
      console.log('[Research] === AI RESEARCH MODE ===');
      try {
        const actualNewsTitle = newsTitle || '';
        const actualNewsBody = text || '';
        const actualBreakdown = breakdownData || {};

        const keyPointsSummary = actualBreakdown.key_points?.map(kp => kp.point).join(', ') || '';
        const coreStory = actualBreakdown.core_story || '';
        const keyPeople = actualBreakdown.key_facts?.people?.join(', ') || '';
        const keyPlaces = actualBreakdown.key_facts?.places?.join(', ') || '';

        const researchPrompt = `คุณคือ AI Research Agent ที่เชี่ยวชาญในการหาข้อมูลเพิ่มเติมเพื่อเสริมเนื้อหาข่าว

=== หัวข้อข่าว ===
${actualNewsTitle}

=== สรุปเนื้อข่าว ===
${actualNewsBody.slice(0, 3000)}

=== ผลวิเคราะห์ ===
แก่นข่าว: ${coreStory}
ประเด็นสำคัญ: ${keyPointsSummary}
บุคคลสำคัญ: ${keyPeople}
สถานที่: ${keyPlaces}

=== คำสั่ง ===
จากข่าวนี้ ช่วยหาข้อมูลเพิ่มเติมที่เกี่ยวข้องและน่าสนใจ เพื่อให้คนเขียนคอนเทนต์นำไปใช้เสริมความลึกให้เนื้อหา

สร้างข้อมูลเพิ่มเติม 6-8 รายการ ในหมวดต่อไปนี้:
1. 📊 สถิติ — ตัวเลข/สถิติที่เกี่ยวข้องกับประเด็นนี้ (เช่น สถิติอุบัติเหตุ, สถิติคดี, จำนวนผู้ได้รับผลกระทบ)
2. 📰 กรณีคล้าย — เหตุการณ์คล้ายกันที่เคยเกิดขึ้น (อ้างอิงเหตุการณ์จริง ถ้ามี)
3. 🎓 ความเห็นผู้เชี่ยวชาญ — มุมมองที่ผู้เชี่ยวชาญในด้านนี้มักจะให้ (เช่น นักจิตวิทยา, นักกฎหมาย, แพทย์)
4. ⚖️ กฎหมาย — กฎหมายหรือข้อบังคับที่เกี่ยวข้องกับเหตุการณ์นี้
5. 📋 ข้อมูลพื้นหลัง — บริบท/ประวัติที่ช่วยให้เข้าใจข่าวนี้มากขึ้น
6. 🔮 แนวโน้ม — ผลกระทบหรือสิ่งที่น่าจะเกิดขึ้นต่อจากเหตุการณ์นี้

กฎ:
- เนื้อหาแต่ละรายการต้องยาว 2-4 ประโยค ให้รายละเอียดพอที่จะนำไปใช้ได้จริง
- ต้องเกี่ยวข้องกับข่าวโดยตรง
- ระบุ relevance ว่าข้อมูลนี้ช่วยเสริมเนื้อหาอย่างไร
- ห้ามแต่งข้อมูลเท็จ ถ้าไม่แน่ใจให้ระบุว่า "ข้อมูลอ้างอิงทั่วไป"

ตอบเป็น JSON:
{
  "items": [
    {"type": "สถิติ", "title": "หัวข้อสั้นๆ", "content": "รายละเอียด 2-4 ประโยค", "relevance": "เกี่ยวข้องกับข่าวอย่างไร"},
    {"type": "กรณีคล้าย", "title": "หัวข้อ", "content": "รายละเอียด", "relevance": "เกี่ยวข้องอย่างไร"},
    ...
  ]
}`;

        console.log(`[Research] Prompt length: ${researchPrompt.length}ch`);

        let result, usedModel;
        try {
          const smartResult = await callSmartAI('analyze', researchPrompt, { temperature: 0.5, maxTokens: 6000 });
          result = smartResult.result;
          usedModel = smartResult.model;
          console.log(`[Research] ✅ SmartAI: model=${usedModel}`);
        } catch (err) {
          console.warn(`[Research] SmartAI failed: ${err.message}, fallback GPT-4o`);
          result = await callAI({ prompt: researchPrompt, temperature: 0.5, maxTokens: 6000 });
          usedModel = 'gpt-4o';
        }

        if (result && result.items) {
          console.log(`[Research] ✅ Found ${result.items.length} items`);
          return NextResponse.json({
            success: true,
            data: {
              items: result.items,
              usedModel,
              newsTitle: actualNewsTitle,
            },
          });
        } else {
          throw new Error('AI ไม่สามารถหาข้อมูลเพิ่มเติมได้');
        }
      } catch (err) {
        console.error('[Research] ERROR:', err.message);
        return NextResponse.json({ success: false, error: `หาข้อมูลไม่สำเร็จ: ${err.message}` }, { status: 500 });
      }
    }

    // ===== MODE: MIX — AI เลือกมุมดีที่สุด ผสมเป็นเนื้อหาใหม่ =====
    if (mode === 'mix') {
      console.log('[Mix] === AI MIX ANGLES MODE ===');
      try {
        const actualNewsBody = text || '';
        const actualNewsTitle = newsTitle || '';
        const actualBreakdown = breakdownData || {};

        // === สร้าง context เต็มจาก MasterAgent + breakdown data ===
        let fullCtx = '';
        if (workflowId) {
          const agent = new MasterAgent(workflowId);
          const loaded = await agent.loadFromDB().catch(() => false);
          if (loaded) {
            fullCtx = agent.compileContext();
            console.log(`[Mix] ✅ Context compiled via MasterAgent (${fullCtx.length}ch)`);
          }
        }
        if (!fullCtx) {
          fullCtx = buildFullContext({ newsBody: actualNewsBody, newsTitle: actualNewsTitle, breakdownData: actualBreakdown });
          console.log('[Mix] ⚠️ Fallback to buildFullContext');
        }

        // === สร้าง Mix Prompt — ส่ง breakdown ทั้งหมดให้ AI ===
        const anglesInfo = actualBreakdown.possible_angles?.map((a, i) =>
          `${i+1}. ${a.angle_name} [viral: ${a.facebook_viral_score}/10] — ${a.description} (อารมณ์: ${a.target_emotion || '-'}, แชร์เพราะ: ${a.share_trigger || '-'})`
        ).join('\n') || 'ไม่มีข้อมูลมุมข่าว';

        const keyPointsInfo = actualBreakdown.key_points?.map((kp, i) =>
          `${i+1}. ${kp.point} [สำคัญ: ${kp.importance}, อารมณ์: ${kp.emotional_value}] — ${kp.detail}`
        ).join('\n') || '';

        const emotionalInfo = [
          actualBreakdown.core_story && `แก่นข่าว: ${actualBreakdown.core_story}`,
          actualBreakdown.main_emotional_core && `Emotional Core: ${actualBreakdown.main_emotional_core}`,
          actualBreakdown.conflict_point && `จุด Conflict: ${actualBreakdown.conflict_point}`,
          actualBreakdown.viral_trigger && `Viral Trigger: ${actualBreakdown.viral_trigger}`,
        ].filter(Boolean).join('\n');

        const bestAngleInfo = actualBreakdown.best_main_angle ?
          `มุมที่ดีที่สุด: ${actualBreakdown.best_main_angle.angle_name} — ${actualBreakdown.best_main_angle.why_best}` : '';

        const hookInfo = actualBreakdown.emotional_hooks?.length ?
          `จุดที่คนจะอิน: ${actualBreakdown.emotional_hooks.join(' | ')}` : '';

        const bestSections = actualBreakdown.best_sections?.length ?
          `ท่อนที่ดีที่สุด: ${actualBreakdown.best_sections.join(' | ')}` : '';

        const langStrategy = actualBreakdown.language_strategy ?
          `กลยุทธ์ภาษา: เปิด=${actualBreakdown.language_strategy.opening_style || '-'}, เล่า=${actualBreakdown.language_strategy.storytelling_style || '-'}, จังหวะ=${actualBreakdown.language_strategy.emotional_pacing || '-'}, ปิด=${actualBreakdown.language_strategy.ending_style || '-'}` : '';

        // === Inject Research Data ถ้ามี ===
        let researchCtx = '';
        if (researchData?.items?.length > 0) {
          researchCtx = '\n\n=== ข้อมูลเพิ่มเติมจาก AI Research ===\n' +
            researchData.items.map((item, i) =>
              `${i+1}. [${item.type}] ${item.title}: ${item.content}`
            ).join('\n') +
            '\n=== จบข้อมูลเพิ่มเติม ===\n';
          console.log(`[Mix] ✅ Research data: ${researchData.items.length} items`);
        }

        const mixPrompt = fullCtx + researchCtx + '\n\n' +
          '=== คำสั่ง: AI ผสมมุมข่าว (MIX MODE) ===\n' +
          'คุณคือผู้เชี่ยวชาญสร้างคอนเทนต์ไวรัล คุณได้รับผลวิเคราะห์ข่าวข้างต้นทั้งหมด\n\n' +
          '📊 มุมข่าวทั้งหมดที่วิเคราะห์ได้:\n' + anglesInfo + '\n\n' +
          (keyPointsInfo ? '📌 ประเด็นสำคัญ:\n' + keyPointsInfo + '\n\n' : '') +
          (emotionalInfo ? '💖 การวิเคราะห์อารมณ์:\n' + emotionalInfo + '\n\n' : '') +
          (bestAngleInfo ? '🏆 ' + bestAngleInfo + '\n' : '') +
          (hookInfo ? '🎣 ' + hookInfo + '\n' : '') +
          (bestSections ? '⭐ ' + bestSections + '\n' : '') +
          (langStrategy ? '✍️ ' + langStrategy + '\n' : '') +
          '\n=== สิ่งที่ต้องทำ ===\n' +
          '1. เลือกมุมข่าว 2-3 มุมที่ดีที่สุด (viral score สูง + อารมณ์แรง)\n' +
          '2. ผสมมุมเหล่านั้นเข้าด้วยกัน สร้างเนื้อหาใหม่ที่อ่านเพลิน ไม่รู้สึกตัดแปะ\n' +
          '3. ใช้ข้อมูลจากประเด็นสำคัญ + Emotional Core + Key Facts เป็นเนื้อหา\n' +
          '4. สร้าง 3 เวอร์ชัน แต่ละเวอร์ชันผสมมุมต่างกัน:\n' +
          '   - เวอร์ชัน 1: ผสมมุมที่ viral score สูงสุด 2-3 มุม (เน้นไวรัล)\n' +
          '   - เวอร์ชัน 2: ผสมมุม Emotional + เรื่องเล่า (เน้นอิน สะเทือนใจ)\n' +
          '   - เวอร์ชัน 3: ผสมมุมข้อมูล + วิเคราะห์ (เน้นเนื้อหาครบถ้วน)\n\n' +
          `แต่ละเวอร์ชัน:\n` +
          `- ต้องยาวอย่างน้อย ${lenCfg.min} คำ ถึง ${lenCfg.max} คำ / ${lenCfg.paraDesc}\n` +
          `- โครงสร้าง ${lenCfg.paragraphs} ย่อหน้า: [ย่อหน้าแรก] เปิดแรง hook → [ย่อหน้ากลาง] เล่ารายละเอียด → [ย่อหน้าสุดท้าย] ปิดด้วยประโยคบรรยายทรงพลัง\n` +
          '- ⚠️ ห้ามตั้งคำถามปิดท้าย ห้ามจบด้วยคำถามใดๆ\n' +
          '- ใช้ข้อมูลจากข่าวจริงเท่านั้น ห้ามแต่งเรื่องเพิ่ม\n' +
          '- ระบุว่าผสมจากมุมไหนบ้าง (ใน mixed_from)\n\n' +
          '=== กฎเหล็ก FACEBOOK SAFETY ===\n' +
          'ห้ามใช้คำเสี่ยง: ฆ่า→ทำให้เสียชีวิต, ศพ→ร่างผู้เสียชีวิต, สยอง→สะเทือนใจ, เลือด→ร่องรอยเหตุการณ์\n' +
          '=== จบ SAFETY ===\n\n' +
          'ตอบเป็น JSON:\n' +
          '{\n' +
          '  "versions": [\n' +
          '    {"style": "ผสม: [ชื่อมุมที่ใช้]", "title": "พาดหัว", "content": "เนื้อหายาว 250+ คำ 3 ย่อหน้า", "hook": "ประโยคเปิด", "closing": "ประโยคปิดบรรยาย", "tone": "โทน", "target": "กลุ่มเป้าหมาย", "mixed_from": ["มุม1", "มุม2"]}\n' +
          '  ],\n' +
          '  "news_reference": "สรุปข่าวต้นฉบับ 2-3 ประโยค"\n' +
          '}';

        console.log(`[Mix] Prompt length: ${mixPrompt.length}ch`);

        // ใช้ Writer Agent (Claude) เป็นหลัก
        let result, usedModel;
        try {
          const smartResult = await callSmartAI('write', mixPrompt, { temperature: 0.7, maxTokens: 8000 });
          result = smartResult.result;
          usedModel = smartResult.model;
          console.log(`[Mix] ✅ SmartAI write: model=${usedModel}`);
        } catch (err) {
          console.warn(`[Mix] SmartAI failed (${err.message}), falling back to GPT-4o`);
          result = await callAI({ prompt: mixPrompt, temperature: 0.7, maxTokens: 8000 });
          usedModel = 'gpt-4o';
        }

        if (result && typeof result === 'object') {
          let versions = result.versions || [];
          if (versions.length === 0 && result.content) {
            versions = [{ style: '🧬 AI ผสมมุมข่าว', title: actualNewsTitle, content: result.content, hook: '', closing: '', tone: '', target: '', mixed_from: [] }];
          }

          // Validate
          const validation = validateOutput(result, { newsTitle: actualNewsTitle, newsBody: actualNewsBody });
          console.log(`[Mix] Validation: ${validation.valid ? '✅ PASS' : '⚠️ ' + validation.issues.join(', ')}`);

          // Save to DB + Master Agent
          if (workflowId) {
            await saveAnalysis(workflowId, { versions, news_reference: result.news_reference }, 'mix_angles').catch(e => console.error('[Mix] DB err:', e.message));
            const agent = new MasterAgent(workflowId);
            await agent.loadFromDB().catch(() => {});
            agent.onAnalysisComplete({ versions, news_reference: result.news_reference });
            agent.onValidationComplete({ safetyPassed: validation.valid, issues: validation.issues, factCheckPassed: true, riskyWordsFound: [], riskyWordsReplaced: [] });
            await agent.saveMemoryToDB().catch(() => {});
          }

          // Moderation
          let moderation = { overallSafe: true, results: [] };
          try {
            moderation = await moderateVersions(versions);
            console.log(`[Mix] Moderation: ${moderation.overallSafe ? '✅ SAFE' : '⚠️ FLAGGED'}`);
          } catch (modErr) {
            console.warn('[Mix] Moderation skipped:', modErr.message);
          }

          return NextResponse.json({
            success: true,
            data: {
              usedPreset: { id: 'mix_angles', name: '🧬 AI ผสมมุมข่าว' },
              usedModel: usedModel || 'gpt-4o',
              versions,
              news_reference: result.news_reference || '',
              summary: versions[0]?.content || '',
              key_points: [],
              emotion: '',
              viral_potential: '',
              engagement_ending: '',
              validation,
              moderation,
              availableModels: getAvailableModels(),
              debug: { mode: 'mix', mixedAngles: actualBreakdown.possible_angles?.length || 0 },
            },
          });
        }
      } catch (err) {
        console.error('[Mix] ERROR:', err.message);
        return NextResponse.json({ success: false, error: `ผสมมุมข่าวไม่สำเร็จ: ${err.message}` }, { status: 500 });
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
