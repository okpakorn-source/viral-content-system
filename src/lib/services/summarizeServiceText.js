import { callAI } from '@/lib/ai/openai';
import { getPrompt, getAnalysisPreset } from '@/lib/ai/promptStoreText';
import { getWorkflow, saveExtraction, saveBreakdown, saveAnalysis, buildFullContext, validateOutput } from '@/lib/workflow/workflowEngine';
import { MasterAgent } from '@/lib/agents/masterAgent';
import { callSmartAI, getAvailableModels } from '@/lib/ai/aiRouter';
import { moderateVersions } from '@/lib/ai/moderationAgent';
import { createStore } from '@/lib/persistStore';
import { logPipeline } from '@/lib/pipelineLogger';
import { getSession } from '@/lib/auth';
import { buildNarrativePayload, formatNarrativePayload, checkNarrativeSimilarity } from '@/lib/input-engine/narrativePayloadText';
import { clusterMatch, findClusterScore, mapCategory, EMOTION_CLUSTERS, CONFLICT_CLUSTERS } from '@/lib/ai/semanticClusters';

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

export async function performSummarize({
  text,
  sourceType,
  customPrompt,
  analysisPresetId,
  presetPrompt,
  targetCount,
  mode,
  newsTitle,
  breakdownData,
  researchData,
  contentLength,
  workflowId,
  emotionalBlueprint,
  factPool,
  user
}) {
  const _pipelineStart = Date.now();
  let _user = user || { userId: null, userName: null };

  if (!_user.userId) {
    try {
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      const token = cookieStore.get('auth_token')?.value;
      const session = await getSession(token);
      if (session) _user = { userId: session.memberId, userName: session.displayName || session.username };
    } catch {}
  }

  // ══ PIPELINE LOG HEADER ══
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[🔄 PIPELINE-SERVICE] MODE: ${mode?.toUpperCase() || 'UNKNOWN'} | input: ${text?.length || 0}ch | source: ${sourceType || 'url'}`);
  console.log(`[🔄 PIPELINE-SERVICE] contentLength: ${contentLength || 'short'} | workflowId: ${workflowId || 'none'}`);
  console.log(`${'='.repeat(60)}\n`);

  await logPipeline({ workflowId, step: mode || 'unknown', status: 'started', detail: 'Input: ' + (text?.length || 0) + 'ch, sourceType=' + (sourceType || '-'), ..._user });

  if (!text || text.length < 10) {
    throw new Error('เนื้อหาสั้นเกินไป');
  }

  // === Content Length Config ===
  const lengthConfig = {
    short:  { min: 250, max: 300, paragraphs: '3', paraDesc: '3 ย่อหน้า', sentences: '3-5' },
    medium: { min: 400, max: 500, paragraphs: '4-5', paraDesc: '4-5 ย่อหน้า', sentences: '4-6' },
    long:   { min: 500, max: 1000, paragraphs: '6-8', paraDesc: '6-8 ย่อหน้า', sentences: '4-8' },
  };
  let lenCfg = lengthConfig[contentLength] || lengthConfig.short;

  // ===== MODE: extract — สกัดเนื้อข่าวอย่างเดียว =====
  if (mode === 'extract') {
    // === PATH A: TikTok/YouTube — ถอดเสียง → จัดรูปแบบ (รักษาคำพูดเดิม) ===
    if (sourceType === 'tiktok' || sourceType === 'youtube') {
      try {
        const tPromptObj = getPrompt('transcript_extraction');
        const platform = sourceType === 'tiktok' ? 'TikTok' : 'YouTube';
        const transcriptPrompt = tPromptObj.prompt
          .replace('{content}', text.slice(0, 8000))
          .replace('{source_platform}', platform)
          .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');

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
          return {
            success: true,
            data: {
              newsTitle: result.news_title,
              newsBody: result.news_body,
              newsSource: result.news_source,
              newsDate: result.news_date,
              newsCategory: result.news_category,
            },
          };
        }
      } catch (err) {
        console.error('[Extract-Transcript] ERROR:', err.message);
      }

      // Fallback — ส่ง raw transcript กลับ
      const cleanText = text
        .replace(/===.*?===/g, '')
        .replace(/ความยาว:.*นาที/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return {
        success: true,
        data: {
          newsTitle: cleanText.slice(0, 80).replace(/\n/g, ' ').trim(),
          newsBody: cleanText.slice(0, 5000),
          newsSource: `คลิป ${sourceType === 'tiktok' ? 'TikTok' : 'YouTube'}`,
          newsDate: '', newsCategory: 'ทั่วไป',
        },
      };
    }

    // === PATH B: URL/Image/Raw ===
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
      logPipeline({ workflowId, step: 'extract', status: 'success', model: usedModel, duration: Date.now() - _pipelineStart, detail: 'Extracted via ' + usedModel }).catch(() => {});

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
        return {
          success: true,
          data: {
            newsTitle: result.news_title,
            newsBody: result.news_body,
            newsSource: result.news_source,
            newsDate: result.news_date,
            newsCategory: result.news_category,
          },
        };
      }
    } catch (err) {
      console.error('[Extract-URL] ERROR:', err.message);
    }

    // Fallback
    return {
      success: true,
      data: {
        newsTitle: text.slice(0, 80).replace(/\n/g, ' ').trim(),
        newsBody: text.slice(0, 5000),
        newsSource: '', newsDate: '', newsCategory: 'ทั่วไป',
      },
    };
  }

  // ===== MODE: breakdown — แตกประเด็น + สรุปใจความ =====
  if (mode === 'breakdown') {
    const breakdownPrompt = getPrompt('breakdown');
    let actualNewsBody = text;
    let actualNewsTitle = newsTitle;
    let contextSource = 'request';

    if (workflowId) {
      const wf = await getWorkflow(workflowId).catch(() => null);
      if (wf?.newsBody && wf.newsBody.length > actualNewsBody.length) {
        actualNewsBody = wf.newsBody;
        actualNewsTitle = wf.newsTitle || newsTitle;
        contextSource = 'DB (workflow)';
        console.log(`[Breakdown-Service] ✅ Loaded full news from DB: ${actualNewsBody.length}ch`);
      }
    }

    console.log(`[Breakdown-Service] Context: source=${contextSource}, title="${(actualNewsTitle || '').slice(0, 60)}", bodyLen=${actualNewsBody?.length}ch`);

    const prompt = breakdownPrompt.prompt
      .replace('{title}', actualNewsTitle || actualNewsBody.slice(0, 100))
      .replace('{content}', actualNewsBody)
      .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติมจากผู้ใช้: "${customPrompt}"` : '');

    console.log(`[Breakdown-Service] 📋 PROMPT LENGTH: ${prompt.length}ch`);
    console.log(`[Breakdown-Service] 📋 NEWS IN PROMPT: ${actualNewsBody.length}ch of actual news content`);

    try {
      const result = await callAI({ prompt, model: 'gpt-4o', temperature: 0.4, maxTokens: 8000 });
      console.log(`[Breakdown-Service] ✅ OK, keys: ${Object.keys(result || {}).join(', ')}`);

      const bdData = {
        primaryCategory: result.primaryCategory || 'ทั่วไป',
        secondaryCategories: result.secondaryCategories || [],
        emotionalTags: result.emotionalTags || [],
        conflictTags: result.conflictTags || [],
        narrativeArchetype: result.narrativeArchetype || '',
        viralHooks: result.viralHooks || [],
        humanAngles: result.humanAngles || [],
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

      if (workflowId) {
        await saveBreakdown(workflowId, bdData).catch(e => console.error('[Breakdown-Service] DB save err:', e.message));
        const agent = new MasterAgent(workflowId);
        await agent.loadFromDB().catch(() => {});
        agent.onBreakdownComplete(bdData);
        await agent.saveMemoryToDB().catch(() => {});
      }

      logPipeline({ workflowId, step: 'breakdown', status: 'success', model: 'gpt-4o', duration: Date.now() - _pipelineStart, detail: (result.core_story || '').slice(0, 60) }).catch(() => {});
      return {
        success: true,
        data: bdData,
        debug: {
          contextSource,
          newsBodyLength: actualNewsBody.length,
          promptLength: prompt.length,
          newsTitle: actualNewsTitle || '',
        }
      };
    } catch (err) {
      console.error('[Breakdown-Service] ERROR:', err.message);
      logPipeline({ workflowId, step: 'breakdown', status: 'failed', duration: Date.now() - _pipelineStart, error: err.message }).catch(() => {});
      throw err;
    }
  }

  // ===== MODE: analyze — วิเคราะห์ด้วย Preset (Smart Match + Narrative Reconstruction) =====
  if (mode === 'analyze') {
    const preset = getAnalysisPreset(analysisPresetId || 'viral_fb');
    console.log(`[Analyze-Service] Preset fallback: "${preset.id}" "${preset.name}"`);

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
        console.log(`[Analyze-Service] ✅ Loaded from DB: title="${(actualNewsTitle||'').slice(0,60)}", body=${actualNewsBody?.length}ch, breakdown=${actualBreakdown?.key_points?.length || 0} points`);
      }
    }

    console.log(`[Analyze-Service] newsTitle: "${(actualNewsTitle || '').slice(0,80)}", textLen: ${actualNewsBody?.length}`);

    let smartPrompt = presetPrompt || null;
    let promptSource = presetPrompt ? 'library' : 'preset';
    let promptMatchReason = presetPrompt ? `🏛️ Pre-selected: "${presetPrompt.promptName || 'Library Prompt'}"` : '';
    let newsTypeDetected = '';
    let newsAnalysis = null;
    let top10PromptScores = [];
    let selectedPromptScore = 0;
    let matchType = 'BORROWED';
    let matchedDimensions = [];
    let whyFallbackUsed = '';
    let rejectedPromptsReason = '';
    let totalPromptsLoaded = 0;
    let validPromptsCount = 0;

    if (!smartPrompt) {
      try {
        const promptStore = createStore('prompt-library');
        let promptLib = [];
        try { promptLib = await promptStore.getAll(); } catch (e) { console.warn('[Analyze-Service] Supabase prompt load:', e.message); }

        if (promptLib.length === 0) {
          try {
            const { readFile: _rf } = await import('fs/promises');
            const { join: _join } = await import('path');
            const _localPath = _join(process.cwd(), 'data', 'prompt-library.json');
            const _localData = JSON.parse(await _rf(_localPath, 'utf-8'));
            if (Array.isArray(_localData) && _localData.length > 0) {
              promptLib = _localData;
              console.log('[Analyze-Service] ✅ FALLBACK: Loaded ' + promptLib.length + ' prompts from LOCAL FILE (Supabase empty)');
            }
          } catch (fileErr) {
            console.warn('[Analyze-Service] Local file fallback failed:', fileErr.message);
          }
        } else {
          console.log('[Analyze-Service] ✅ Supabase: ' + promptLib.length + ' prompts loaded');
        }

        totalPromptsLoaded = promptLib.length;
        const validPrompts = promptLib.filter(p => p.promptText);
        validPromptsCount = validPrompts.length;
        if (validPrompts.length > 0) {
          // --- STAGE 1: DEEP DNA NEWS ANALYZER (12 Dimensions) ---
          console.log(`[Analyze-Service] 🧠 STAGE 1: Analyzing Deep DNA for: "${actualNewsTitle}"`);
          
          if (actualBreakdown && actualBreakdown.primaryCategory) {
            console.log(`[Analyze-Service] ⚡ BYPASS AI: Using pre-extracted DNA from Breakdown Phase`);
            newsAnalysis = {
              primaryCategory: actualBreakdown.primaryCategory || 'ทั่วไป',
              secondaryCategories: actualBreakdown.secondaryCategories || [],
              emotionalTags: actualBreakdown.emotionalTags || [],
              conflictTags: actualBreakdown.conflictTags || [],
              narrativeArchetype: actualBreakdown.narrativeArchetype || '',
              viralHooks: actualBreakdown.viralHooks || [],
              humanAngles: actualBreakdown.humanAngles || []
            };
            newsTypeDetected = newsAnalysis.primaryCategory;
          } else {
            try {
              const analyzerPrompt = `คุณคือ AI วิเคราะห์ "DNA ข่าวต้นฉบับ" ระดับมืออาชีพ
หน้าที่: ถอดโครงสร้างข่าวออกมาเป็น "Deep DNA" เพื่อส่งต่อให้ระบบจับคู่ Prompt ที่แม่นยำที่สุด
ห้ามสรุปแบบผิวเผิน ให้คิดเหมือนนักวิเคราะห์พฤติกรรมคนแชร์และนักจิตวิทยา social media

=== ข่าวที่ต้องวิเคราะห์ ===
หัวข้อ: ${actualNewsTitle || 'ไม่มีหัวข้อ'}
เนื้อหาย่อ: ${(actualNewsBody || '').slice(0, 2500)}
=== จบข่าว ===

วิเคราะห์ข่าวนี้ออกมาเป็น JSON Format โดยมีโครงสร้างดังนี้:
{
  "dna_type": "ประเภทหลัก (เลือก 1 จาก: ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน)",
  "emotional_core": {
    "primary_emotion": "อารมณ์หลักที่ขับเคลื่อนข่าว",
    "emotional_patterns": ["เห็นใจ", "สงสาร", "โกรธ", "เดือด", "ซึ้ง", "ตื้นตัน", "กลัว", "ช็อก", "ภูมิใจ", "คาใจ", "เศร้า", "สนุก", "แค้น", "หวาดกลัว"] // เลือก 2-4 คำ
  },
  "stop_scrolling_hook": {
    "hook_type": "ประเภทฮุคที่คนน่าจะหยุดดู (เช่น สงสาร, ช็อก, เสียดาย, อยากรู้)",
    "why_it_stops": "เหตุผลสั้นๆ ว่าทำไมคนหยุดนิ้วอ่าน"
  },
  "comment_triggers": {
    "main_trigger": "ประเด็นหลักที่ชวนคอมเมนต์",
    "triggers": ["ความอยุติธรรม", "การตัดสิน", "การสูญเสีย", "การต่อสู้", "ความผิดพลาด", "การเอาเปรียบ", "ความขัดแย้ง"] // เลือก 1-3 คำที่เป็นประเด็นขัดแย้ง
  },
  "story_structure": {
    "narrative_archetype": "โครงเรื่อง (เลือก 1 จาก: สู้ชีวิต, ฮีโร่ชาวบ้าน, เปิดโปง, น้ำใจคนไทย, ชีวิตพลิกผัน, ผู้ถูกกระทำ, ดราม่าครอบครัว, ข่าวเตือนภัย)",
    "full_flow": "อธิบายสั้นๆ (เช่น Hook > เล่าปม > จุดพีค > Ending)"
  },
  "visual_imagination": "ภาพหลักที่เกิดในหัวคนอ่านเวลาอ่านข่าวนี้",
  "share_triggers": {
    "triggers": ["ข้อคิด", "เตือนภัย", "สะเทือนใจ", "อยากด่า", "อยากชื่นชม"] // ประเด็นมนุษย์ที่ชวนแชร์
  }
}`;

              const aiResult = await callAI({
                model: 'gpt-4o-mini',
                temperature: 0.1,
                maxTokens: 1000,
                prompt: analyzerPrompt
              });
              
              // Map Deep DNA to legacy fields for compatibility with Stage 2 Cluster Match
              newsAnalysis = {
                ...aiResult,
                primaryCategory: aiResult?.dna_type || 'ดราม่าสังคม',
                secondaryCategories: [aiResult?.story_structure?.narrative_archetype || ''],
                emotionalTags: aiResult?.emotional_core?.emotional_patterns || [],
                conflictTags: aiResult?.comment_triggers?.triggers || [],
                narrativeArchetype: aiResult?.story_structure?.narrative_archetype || '',
                viralHooks: [aiResult?.stop_scrolling_hook?.hook_type || 'ทั่วไป'],
                humanAngles: aiResult?.share_triggers?.triggers || []
              };
              
              newsTypeDetected = newsAnalysis.primaryCategory || '';
              console.log(`[Analyze-Service] 🧠 STAGE 1: Deep DNA Analysis complete. Type: ${newsTypeDetected}`);
            } catch (analyzErr) {
              console.warn('[Analyze-Service] STAGE 1 Analysis failed, using fallback:', analyzErr.message);
              newsAnalysis = {
                dna_type: 'ดราม่าสังคม',
                emotional_core: { primary_emotion: 'เห็นใจ', emotional_patterns: ['เห็นใจ', 'คาใจ'] },
                stop_scrolling_hook: { hook_type: 'ดราม่า', why_it_stops: 'ความขัดแย้งที่น่าติดตาม' },
                comment_triggers: { main_trigger: 'ข้อพิพาท', triggers: ['ความขัดแย้ง'] },
                story_structure: { narrative_archetype: 'ดราม่าสังคม', full_flow: 'เปิดประเด็น > ถกเถียง' },
                visual_imagination: 'ภาพคนทะเลาะกันหรือมีข้อพิพาท',
                share_triggers: { triggers: ['อยากด่า', 'เตือนภัย'] },
                // legacy
                primaryCategory: 'ดราม่าสังคม',
                secondaryCategories: ['สู้ชีวิต'],
                emotionalTags: ['เห็นใจ', 'คาใจ'],
                conflictTags: ['ความขัดแย้ง'],
                narrativeArchetype: 'สู้ชีวิต',
                viralHooks: ['ดราม่า'],
                humanAngles: ['ผลกระทบ'],
              };
              newsTypeDetected = 'ดราม่าสังคม';
            }
          }

          // --- STAGE 2: CLUSTER-BASED HYBRID SCORER & MATCHER (JS ENGINE v2) ---
          console.log(`[Analyze-Service] 🧠 STAGE 2: Cluster-Based Hybrid prompt scoring for ${validPrompts.length} candidates...`);
          
          try {
            const nPrimary = newsAnalysis?.primaryCategory || '';
            const nSecondary = (newsAnalysis?.secondaryCategories || []).map(s => String(s));
            const nEmos = (newsAnalysis?.emotionalTags || newsAnalysis?.emotionalThemes || []).map(e => String(e));
            const nConflicts = (newsAnalysis?.conflictTags || newsAnalysis?.conflictTypes || []).map(c => String(c));
            const nArchetype = newsAnalysis?.narrativeArchetype || '';
            const nHooks = (newsAnalysis?.viralHooks || []).map(h => String(h).toLowerCase());

            const scoredPrompts = validPrompts.map((p, index) => {
              let score = 0;
              let dims = [];

              // 1. Category Match (max 30)
              const pCat = mapCategory(p.category || '');
              const mappedPrimary = mapCategory(nPrimary);
              if (pCat && mappedPrimary && pCat === mappedPrimary) {
                score += 30; dims.push('category');
              } else if (pCat && mappedPrimary) {
                const catCluster = clusterMatch(pCat, mappedPrimary, CONFLICT_CLUSTERS);
                if (catCluster === 'cluster') {
                  score += 20; dims.push('category(cluster)');
                } else if (nSecondary.some(s => mapCategory(s) === pCat)) {
                  score += 10; dims.push('category(secondary)');
                }
              }

              // 2. Emotional Match (max 25) — cluster-based +12 per tag
              let emoScore = 0;
              const pEmoTags = (p.emotionalTags && Array.isArray(p.emotionalTags) && p.emotionalTags.length > 0)
                ? p.emotionalTags
                : ((p.emotionalType || '') + ' ' + (p.tone || '')).split(/[\s,|/]+/).filter(w => w.length > 1);
              for (const nEmo of nEmos) {
                for (const pTag of pEmoTags) {
                  const result = clusterMatch(pTag, nEmo, EMOTION_CLUSTERS);
                  if (result) { emoScore += 12; break; }
                }
              }
              if (emoScore > 25) emoScore = 25;
              if (emoScore > 0) { score += emoScore; dims.push('emotional'); }

              // 3. Conflict Match (max 15) — cluster-based +8 per tag
              let conflictScore = 0;
              const pConflictTags = (p.conflictTags && Array.isArray(p.conflictTags) && p.conflictTags.length > 0)
                ? p.conflictTags
                : ((p.promptName || '') + ' ' + (p.structure || '')).split(/[\s,|/]+/).filter(w => w.length > 2);
              for (const nConf of nConflicts) {
                for (const pTag of pConflictTags) {
                  const result = clusterMatch(pTag, nConf, CONFLICT_CLUSTERS);
                  if (result) { conflictScore += 8; break; }
                }
              }
              if (conflictScore > 15) conflictScore = 15;
              if (conflictScore > 0) { score += conflictScore; dims.push('conflict'); }

              // 4. Narrative Archetype Match (max 15) — enum match
              const pArchetype = (p.narrativeArchetype || p.structure || '').toLowerCase();
              let archScore = 0;
              if (pArchetype && nArchetype) {
                const nArchLower = nArchetype.toLowerCase();
                if (pArchetype === nArchLower || pArchetype.includes(nArchLower) || nArchLower.includes(pArchetype)) {
                  archScore = 15;
                  dims.push('archetype');
                } else {
                  const archWords = nArchLower.split(/[\s,|/]+/).filter(w => w.length > 2);
                  let archMatches = 0;
                  archWords.forEach(w => { if (pArchetype.includes(w)) archMatches++; });
                  archScore = Math.min(15, archMatches * 5);
                  if (archScore > 0) dims.push('archetype(partial)');
                }
              }
              score += archScore;

              // 5. Viral Hook Match (max 5)
              const pHook = (p.hookStyle || '').toLowerCase();
              let hookScore = 0;
              if (pHook) {
                for (const h of nHooks) {
                  if (h && (pHook.includes(h) || h.includes(pHook))) { hookScore += 5; break; }
                  const hw = h.split(/[\s,|/]+/).filter(w => w.length > 2);
                  if (hw.some(w => pHook.includes(w))) { hookScore += 3; break; }
                }
              }
              if (hookScore > 5) hookScore = 5;
              if (hookScore > 0) { score += hookScore; dims.push('hook'); }

              // 6. Historical Performance (max 10)
              let viral = Number(p.viralScore);
              if (isNaN(viral)) viral = 70;
              const successRate = Number(p.successRate);
              let histScore = viral * 0.05;
              if (!isNaN(successRate) && successRate > 0) histScore += successRate * 5;
              if (histScore > 10) histScore = 10;
              score += histScore;

              // 7. Cross-Dimensional Boost
              const uniqueDims = [...new Set(dims.map(d => d.replace(/\(.*\)/, '')))]; // strip (partial) etc.
              if (score > 0) {
                // Boost: category>=20 AND emotional>=12
                const catScore = dims.some(d => d.startsWith('category')) ? (dims.includes('category') ? 30 : 20) : 0;
                if (catScore >= 20 && emoScore >= 12) {
                  score += 10;
                  dims.push('boost(cat+emo)');
                }
                // Boost: 3+ dimensions matched
                if (uniqueDims.length >= 3) {
                  score += 5;
                  dims.push('boost(multi-dim)');
                }
              }

              return { index, score, dims: [...new Set(dims)] };
            });

            // เรียงจากคะแนนมากไปน้อย
            scoredPrompts.sort((a, b) => b.score - a.score);

            top10PromptScores = scoredPrompts.slice(0, 10).map(s => {
              const pr = validPrompts[s.index];
              const sDims = s.dims.filter(d => !d.startsWith('boost'));
              return {
                id: pr.id,
                name: pr.promptName,
                score: s.score,
                matchType: (s.score >= 60 && sDims.length >= 2) ? 'EXACT' : s.score >= 40 ? 'CLOSE' : 'BORROWED',
                matchedDimensions: s.dims,
                reason: `Cluster Score: ${s.score.toFixed(1)}`
              };
            });

            const winner = scoredPrompts[0];
            
            if (winner) {
              const selectedIndex = winner.index;
              selectedPromptScore = winner.score;
              matchedDimensions = winner.dims;
              const coreDims = matchedDimensions.filter(d => !d.startsWith('boost'));
              
              // กฎการตัดเกรด MatchType (updated thresholds)
              if (selectedPromptScore >= 60 && coreDims.length >= 2) {
                matchType = 'EXACT';
              } else if (selectedPromptScore >= 40) {
                matchType = 'CLOSE';
              } else {
                matchType = 'BORROWED';
              }

              const matchReason = `Cluster Score: ${selectedPromptScore.toFixed(1)}/100`;

              const matchLabel = matchType === 'EXACT' ? '✅ EXACT MATCH' : (matchType === 'CLOSE' ? '⚠️ CLOSE MATCH' : '❌ BORROWED (FALLBACK)');
              console.log(`[🧠 CLUSTER SCORE ENGINE v2] ${matchLabel} | Score: ${selectedPromptScore.toFixed(1)}/100`);
              console.log(`[🧠 CLUSTER SCORE ENGINE v2] Chosen Index: ${selectedIndex}/${validPrompts.length - 1} | Dimensions: ${matchedDimensions.join(', ')}`);

              smartPrompt = validPrompts[selectedIndex];
              promptSource = 'library';
              
              const isBorrowed = matchType === 'BORROWED';
              smartPrompt._isBorrowed = isBorrowed;
              smartPrompt._borrowReason = isBorrowed ? matchReason : null;
              smartPrompt._matchScore = selectedPromptScore;
              smartPrompt._matchType = matchType;
              smartPrompt._matchedDimensions = matchedDimensions;

              promptMatchReason = isBorrowed
                ? `⚠️ ไม่มี Prompt ตรงแนวข่าว${newsTypeDetected} — ยืม Prompt ใกล้เคียง: "${smartPrompt.promptName}" (Score: ${selectedPromptScore.toFixed(1)}/100, Match: ${matchType})`
                : `🧠 Cluster Match: "${smartPrompt.promptName}" (Score: ${selectedPromptScore.toFixed(1)}/100, Match: ${matchType}, Dimensions: ${matchedDimensions.join(', ')})`;
                
              smartPrompt.usageCount = (smartPrompt.usageCount || 0) + 1;
              smartPrompt.lastUsedAt = new Date().toISOString();
            } else {
              promptMatchReason = `🧠 Engine: ค้นหา Prompt ไม่พบในหอสมุด — ดำเนินการย้ายเข้าสู่ built-in fallback`;
            }
          } catch (scorerErr) {
            console.error('[Analyze-Service] STAGE 2 Engine failed:', scorerErr.message);
            promptMatchReason = `Engine match error: ${scorerErr.message}`;
          }

          // --- STAGE 2.5: AI SEMANTIC FALLBACK (Gemini Flash) ---
          // Only triggers when Stage 2 result is BORROWED (score < 40)
          if (matchType === 'BORROWED' && smartPrompt && top10PromptScores.length > 0) {
            console.log(`[Analyze-Service] 🤖 STAGE 2.5: AI Semantic Fallback triggered (matchType=BORROWED, score=${selectedPromptScore.toFixed(1)})`);
            try {
              const top5Candidates = top10PromptScores.slice(0, 5);
              const candidateList = top5Candidates.map((c, i) => 
                `${i + 1}. "${c.name}" (id: ${c.id}) — Score: ${c.score.toFixed(1)}, Dimensions: ${c.matchedDimensions.join(', ')}`
              ).join('\n');

              const aiFallbackPrompt = `คุณเป็นผู้เชี่ยวชาญการเลือก prompt สำหรับเขียนข่าวไวรัล

=== ข่าว ===
หัวข้อ: ${actualNewsTitle || 'ไม่มีหัวข้อ'}
หมวดหมู่: ${newsTypeDetected}
อารมณ์: ${(newsAnalysis?.emotionalTags || newsAnalysis?.emotionalThemes || []).join(', ')}
ความขัดแย้ง: ${(newsAnalysis?.conflictTags || newsAnalysis?.conflictTypes || []).join(', ')}
Archetype: ${newsAnalysis?.narrativeArchetype || '-'}
=== จบข่าว ===

=== ตัวเลือก Prompt (Top 5) ===
${candidateList}
=== จบตัวเลือก ===

จาก prompt ทั้ง 5 ตัวเลือกด้านบน เลือก 1 ตัวที่เหมาะสมที่สุดสำหรับข่าวนี้
ตอบเป็น JSON: { "selectedIndex": <1-5>, "reason": "..." }`;

              const { callGemini, isGeminiAvailable } = await import('@/lib/ai/geminiClient');
              let aiSelection = null;
              if (isGeminiAvailable()) {
                aiSelection = await callGemini({
                  prompt: aiFallbackPrompt,
                  model: 'gemini-2.5-flash',
                  temperature: 0.1,
                  maxTokens: 300,
                });
              } else {
                // Fallback to callAI if Gemini not available
                aiSelection = await callAI({
                  prompt: aiFallbackPrompt,
                  model: 'gpt-4o-mini',
                  temperature: 0.1,
                  maxTokens: 300,
                });
              }

              if (aiSelection && aiSelection.selectedIndex >= 1 && aiSelection.selectedIndex <= 5) {
                const aiPickIdx = aiSelection.selectedIndex - 1;
                const aiPickedCandidate = top5Candidates[aiPickIdx];
                const aiPickedPrompt = validPrompts.find(vp => vp.id === aiPickedCandidate.id);

                if (aiPickedPrompt && aiPickedPrompt.id !== smartPrompt.id) {
                  console.log(`[🤖 STAGE 2.5] AI picked different prompt: "${aiPickedCandidate.name}" (was: "${smartPrompt.promptName}") — Reason: ${aiSelection.reason || '-'}`);
                  smartPrompt = aiPickedPrompt;
                  promptSource = 'library(ai-fallback)';
                  smartPrompt._isBorrowed = true;
                  smartPrompt._borrowReason = `AI Fallback: ${aiSelection.reason || 'Gemini selected'}`;
                  smartPrompt._matchScore = aiPickedCandidate.score;
                  smartPrompt._matchType = 'BORROWED(AI)';
                  smartPrompt._matchedDimensions = aiPickedCandidate.matchedDimensions;
                  promptMatchReason = `🤖 AI Fallback: "${smartPrompt.promptName}" (AI Reason: ${aiSelection.reason || '-'}, Original Score: ${selectedPromptScore.toFixed(1)})`;
                } else {
                  console.log(`[🤖 STAGE 2.5] AI confirmed original pick: "${smartPrompt.promptName}"`);
                }
              } else {
                console.log(`[🤖 STAGE 2.5] AI returned invalid selection, keeping original pick`);
              }
            } catch (aiFallbackErr) {
              console.warn('[Analyze-Service] STAGE 2.5 AI Fallback failed (keeping Stage 2 result):', aiFallbackErr.message);
            }
          }
        } else {
          promptMatchReason = 'PROMPT_LIBRARY_MISSING — ใช้ built-in fallback V12';
          smartPrompt = {
            id: 'fallback_builtin', promptName: 'Built-in Fallback V12',
            category: 'ทั่วไป', emotionalType: 'สาระน่าสนใจ', viralScore: 70,
            promptText: '=== 🏛️ # FINAL MASTER PROMPT — HUMAN VIRAL FACEBOOK NEWS ENGINE V12 ===\n' +
              'คุณไม่ใช่นักเขียนบทความ | คุณไม่ใช่นักสรุปชีวิต | คุณไม่ใช่นักวิเคราะห์สังคม | คุณไม่ใช่นักเขียนคอลัมน์\n' +
              'คุณไม่ใช่ narrator หนัง | คุณไม่ใช่ AI motivational writer\n\n' +
              'คุณคือ: "คนที่อยู่ในเหตุการณ์จริง แล้วกำลังเล่าเรื่องให้คนบน Facebook ฟัง"\n\n' +
              '=== CORE HUMAN DNA & ABSOLUTE RULES ===\n' +
              '- RULE 1 — ห้ามอธิบายอารมณ์ (ให้รายละเอียด/ภาพแทน เช่น "ไม่มีใครพูดอะไรอยู่พักใหญ่" แทน "ทุกคนเศร้า")\n' +
              '- RULE 2 — ห้าม narrator อ่านใจตัวละคร (ใช้ quote, สีหน้า, silence, action จริง)\n' +
              '- RULE 3 — ห้ามสรุปข้อคิดชีวิต (ห้ามสอนคนอ่าน, ห้ามพูดว่า "ความรักที่แท้จริงคือ...")\n' +
              '- RULE 4 — ห้าม cinematic AI narration (ห้ามคำหรูหราที่ดูเหมือน AI เช่น "วินาทีที่เปลี่ยนทุกอย่าง")\n' +
              '- RULE 5 — ห้าม moralize (ให้เล่าแล้วปล่อยคนอ่านคิดเองอย่างอิสระ)\n\n' +
              '=== HUMAN DETAIL ENGINE & SILENCE ===\n' +
              '- ทุกเรื่องราวต้องมี object จริง, gesture จริง, และความเงียบ (เช่น "เก้าอี้พลาสติก", "มือสั่น", "เงียบไปพักหนึ่ง")\n' +
              '- ใช้ประโยคสั้นกระชับที่มีน้ำหนักสูง เล่าเหมือนโพสต์จริงบน Facebook\n' +
              '- เล่าโดยเคารพข้อเท็จจริง 100% ห้ามเติมแต่งข้อมูลเด็ดขาด',
            _isFallback: true,
          };
          promptSource = 'fallback';
        }
      } catch (err) {
        promptMatchReason = 'AI_MATCH_ERROR: ' + err.message;
        console.warn('[Analyze-Service] Smart Match error:', err.message);
      }
    }

    if (!smartPrompt) {
      smartPrompt = {
        id: 'fallback_builtin', promptName: 'Built-in Fallback V12 (Auto)',
        category: 'ทั่วไป', viralScore: 70,
        promptText: '=== 🏛️ # FINAL MASTER PROMPT — HUMAN VIRAL FACEBOOK NEWS ENGINE V12 ===\n' +
          'คุณไม่ใช่นักเขียนบทความ | คุณไม่ใช่นักสรุปชีวิต | คุณไม่ใช่นักวิเคราะห์สังคม | คุณไม่ใช่นักเขียนคอลัมน์\n' +
          'คุณไม่ใช่ narrator หนัง | คุณไม่ใช่ AI motivational writer\n\n' +
          'คุณคือ: "คนที่อยู่ในเหตุการณ์จริง แล้วกำลังเล่าเรื่องให้คนบน Facebook ฟัง"\n\n' +
          '=== CORE HUMAN DNA & ABSOLUTE RULES ===\n' +
          '- RULE 1 — ห้ามอธิบายอารมณ์ (ให้รายละเอียด/ภาพแทน เช่น "ไม่มีใครพูดอะไรอยู่พักใหญ่" แทน "ทุกคนเศร้า")\n' +
          '- RULE 2 — ห้าม narrator อ่านใจตัวละคร (ใช้ quote, สีหน้า, silence, action จริง)\n' +
          '- RULE 3 — ห้ามสรุปข้อคิดชีวิต (ห้ามสอนคนอ่าน, ห้ามพูดว่า "ความรักที่แท้จริงคือ...")\n' +
          '- RULE 4 — ห้าม cinematic AI narration (ห้ามคำหรูหราที่ดูเหมือน AI เช่น "วินาทีที่เปลี่ยนทุกอย่าง")\n' +
          '- RULE 5 — ห้าม moralize (ให้เล่าแล้วปล่อยคนอ่านคิดเองอย่างอิสระ)\n\n' +
          '=== HUMAN DETAIL ENGINE & SILENCE ===\n' +
          '- ทุกเรื่องราวต้องมี object จริง, gesture จริง, และความเงียบ (เช่น "เก้าอี้พลาสติก", "มือสั่น", "เงียบไปพักหนึ่ง")\n' +
          '- ใช้ประโยคสั้นกระชับที่มีน้ำหนักสูง เล่าเหมือนโพสต์จริงบน Facebook\n' +
          '- เล่าโดยเคารพข้อเท็จจริง 100% ห้ามเติมแต่งข้อมูลเด็ดขาด',
        _isFallback: true,
      };
      promptSource = 'fallback';
    }

    // Build Narrative Payload (Enriched with 5th argument: actualNewsBody)
    let narrativePayload = buildNarrativePayload(actualNewsTitle, actualBreakdown, researchData, emotionalBlueprint, actualNewsBody);
    console.log(`[Analyze-Service] 🔄 NARRATIVE PAYLOAD built: sourceRemoved=true | facts=${narrativePayload.coreFacts.length} | research=${narrativePayload.researchContexts.length} | quotes=${narrativePayload.quoteFragments.length}`);

    // Dynamic Word Count Scaling
    if (narrativePayload && (narrativePayload.factSufficiency === 'minimal' || narrativePayload.factSufficiency === 'insufficient')) {
      lenCfg = lengthConfig.short;
      console.log(`[Analyze-Service] ⚠️ Fact sufficiency is ${narrativePayload.factSufficiency}. Overriding length config to short to prevent AI filler.`);
    }

    let prompt = '';
    if (smartPrompt && smartPrompt.promptText) {
      prompt = '=== 🏛️ คำสั่งเขียนจากหอสมุดไวรัล ===\n' +
        `ประเภท: ${smartPrompt.category || '-'} | อารมณ์: ${smartPrompt.emotionalType || smartPrompt.emotionalTags?.[0] || '-'} | Viral Score: ${smartPrompt.viralScore || '-'}\n` +
        `สไตล์ Hook: ${smartPrompt.hookStyle || '-'} | โทน: ${smartPrompt.tone || '-'}\n` +
        `โครงสร้าง: ${smartPrompt.structure || '-'}\n\n`;

      if (smartPrompt.exampleHooks && Array.isArray(smartPrompt.exampleHooks) && smartPrompt.exampleHooks.length > 0) {
        prompt += '--- 🪝 ตัวอย่างประโยคเปิดเรื่อง (Hook Examples) ---\n' +
          'ให้นำ "สไตล์และโครงสร้าง" จากประโยคเหล่านี้ไปประยุกต์ใช้ ห้ามลอกเลียนแบบคำศัพท์ที่ผิดบริบทจากเนื้อหาข่าวจริงเด็ดขาด (เช่น ห้ามนำศัพท์ของสัตว์เลี้ยงมาใช้กับคน):\n' +
          smartPrompt.exampleHooks.map((h, i) => `${i + 1}. "${h}"`).join('\n') + '\n\n';
      }

      if (smartPrompt.ctaStyle) {
        prompt += '--- 📣 สไตล์การปิดท้าย (CTA Style) ---\n' +
          `เป้าหมายตอนจบ: ${smartPrompt.ctaStyle}\n\n`;
      }

      prompt += '--- ✍️ คำสั่งสไตล์การเขียน (Master Rules) ---\n' +
        '⚠️ คำเตือนสำคัญ (ANTI-HALLUCINATION): คำสั่งสไตล์หรือ "ตัวอย่าง" ด้านล่างนี้ อาจมีข้อมูลสมมติ เช่น ชื่อบุคคล (แม่ครู, ลุง), สถานที่ (เช่น อุบลราชธานี), วันที่ หรือตัวเลขต่างๆ\n' +
        '>> คุณ **ต้องห้ามคัดลอก** ข้อมูลเฉพาะเหล่านี้มาใส่ในเนื้อหาเด็ดขาด! ให้ยึด "ตัวละคร สถานที่ วันที่ และข้อเท็จจริง" จาก "ข่าวต้นฉบับ" เท่านั้น! <<\n' +
        smartPrompt.promptText + '\n\n';

      if (smartPrompt.doNot && Array.isArray(smartPrompt.doNot) && smartPrompt.doNot.length > 0) {
        prompt += '--- 🚨 ข้อห้ามทำเด็ดขาด (DO NOT VIOLATE) ---\n' +
          'หากคุณละเมิดกฎเหล่านี้ โพสต์จะถูกปฏิเสธ:\n' +
          smartPrompt.doNot.map(dn => `- ${dn}`).join('\n') + '\n\n';
      }

      prompt += '=== จบคำสั่งหอสมุด ===\n\n';
    }

    // Inject Positive Archetype
    let archetypePrompt = '=== 👤 POSITIVE WRITING ARCHETYPE ===\n';
    const cat = (smartPrompt?.category || newsTypeDetected || '').toLowerCase();
    if (['อุบัติเหตุ', 'อาชญากรรม', 'สลดใจ', 'ภัยพิบัติ', 'ดราม่าชีวิต', 'อบอุ่น', 'ความรัก', 'สะเทือนใจ', 'ชีวิต'].some(k => cat.includes(k))) {
      archetypePrompt += 'คุณกำลังสวมบทบาทเป็น: "ผู้เห็นเหตุการณ์จริง (The Witness)"\n' +
        '- เล่าเรื่องด้วยรายละเอียดทางกายภาพจริง (เช่น ลมพัด, เก้าอี้พลาสติก, เสียงหายใจ, มือที่สั่นเทา)\n' +
        '- ใช้ประโยคสั้น มีจังหวะหยุด (silence) ราวกับคุณกำลังยืนอยู่ในที่เกิดเหตุและมีอารมณ์ร่วมเบาๆ\n' +
        '- หลีกเลี่ยงการอธิบายอารมณ์ ให้รายละเอียดทางกายภาพเล่าอารมณ์แทน\n';
    } else if (['การเมือง', 'เศรษฐกิจ', 'ดราม่าสังคม', 'ธุรกิจ', 'บันเทิง', 'วงการ', 'สังคม'].some(k => cat.includes(k))) {
      archetypePrompt += 'คุณกำลังสวมบทบาทเป็น: "คนวงใน/ผู้บันทึกกระแส (The Insider)"\n' +
        '- เล่าเรื่องด้วยโทนที่มีความตึงเครียด หรือเบื้องลึกเบื้องหลังที่เป็นความจริงเชิงลึก\n' +
        '- ใช้คำพูดที่กระชับ ตรงประเด็น ชี้เป้าความขัดแย้ง (conflict) อย่างแม่นยำ\n' +
        '- เล่าแบบผู้เฝ้ามองเหตุการณ์ที่มีสายตาแหลมคม ไม่สั่งสอนศีลธรรม ชี้ให้เห็นผลกระทบของเหตุการณ์จริง\n';
    } else {
      archetypePrompt += 'คุณกำลังสวมบทบาทเป็น: "ผู้บันทึกความจริงที่ไม่ตัดสิน (The Narrator of Truth)"\n' +
        '- เล่าเรื่องราวแบบกระชับ ตรงไปตรงมา เน้นน้ำหนักของประโยคและการแสดงออกทางกายภาพ (actions/quotes)\n' +
        '- ห้ามคำสวยหรูหรือความหวังที่ดูเหมือน AI ค้นหา "แกนของความจริง" แล้ววางมันลงเพื่อให้คนอ่านคิดเอง\n' +
        '- ใช้ความเงียบและข้อเท็จจริงเป็นเครื่องนำทางอารมณ์อย่างทรงพลัง\n';
    }
    archetypePrompt += '=== จบ ARCHETYPE ===\n\n';
    prompt += archetypePrompt;

    // Append Narrative Payload exactly ONCE
    prompt += formatNarrativePayload(narrativePayload);

    if (customPrompt) {
      prompt += `\n=== คำสั่งเพิ่มเติมจากผู้ใช้ ===\n"${customPrompt}"\n\n`;
    }

    const _researchGrade = (researchData?.items?.length || 0) >= 3 ? 'strong'
      : (researchData?.items?.length || 0) >= 1 ? 'partial' : 'missing';

    const quoteSafetyRule = `

=== ADVANCED ANTI-DUPLICATE + FACTUAL REWRITE SYSTEM — กฎบังคับสูงสุด (ห้ามละเมิด) ===

━━━ CORE RULE ━━━
เป้าหมายไม่ใช่ "เปลี่ยนคำ" แต่คือ "ใช้ fact เดิม แต่เล่าใหม่"

━━━ SIMILARITY ENGINE ━━━
❌ ห้ามมีคำเรียงติดต้นฉบับเกิน 6–8 คำ
❌ ห้ามใช้ sentence structure เดิม
❌ ห้ามเปลี่ยนแค่ synonym 1-2 คำแล้วส่ง
❌ ห้ามย้ายคำเล็กน้อยแต่ยังอ่านเหมือนเดิม
❌ ห้ามเรียงลำดับข้อมูลเหมือนต้นฉบับเกิน 50%
CHECKLIST: 1.ปิดชื่อแล้วยังเหมือนต้นฉบับไหม? 2.ยัง rewrite ชัดไหม? 3.quote เยอะไหม? 4.จังหวะเดิมไหม? 5.เหมือน "ข่าวใหม่" จริงไหม?
→ ถ้าคำตอบใดคือ "ใช่" rewrite ใหม่ทันที

━━━ FORBIDDEN REWRITE PATTERNS ━━━
❌ เปลี่ยน synonym / เติมคำหน้าท้าย / ตัดบางคำ / สลับคำเล็กน้อย / เปลี่ยน "บอก"→"เผย" แต่ structure เดิม
ผิด: "เขามองว่ามันไม่แฟร์ที่ผู้หญิงต้องแต่งงานโดยไม่รู้ความจริง"
ถูก: "เขาเชื่อว่าความสัมพันธ์ไม่ควรเริ่มต้นจากเรื่องที่อีกฝ่ายไม่เคยรู้มาก่อน"

━━━ QUOTE REWRITE ENGINE ━━━
• quote ตรงรวมกันห้ามเกิน 10% / แต่ละก้อนไม่เกิน 8–15 คำ
• ห้ามเปิดบทความด้วย quote ยาว / ห้าม quote ตรงติดกันหลายย่อหน้า
✅ ยก quote สั้นๆ: "ถ้าโดนก็หล่น" / สรุปความ: "เขายืนยันว่าขึ้นเวทีแบบไม่คิดถอย"
✅ รูปแบบ: เจ้าตัวยอมรับว่า "..." / เขาทิ้งท้ายว่า "..."
❌ ห้ามแต่งคำพูดให้แรงกว่าเดิม / ห้ามเติมอารมณ์ที่ไม่มีในต้นฉบับ / ห้ามสร้าง quote ปลอม

━━━ FACTUAL SAFETY RULE (ข่าวแพทย์/ราชการ/อุบัติเหตุ/ตัวเลข) ━━━
ห้ามเปลี่ยน: ตัวเลข / ชื่อบุคคล / ชื่อสถานที่ / ข้อมูลทางแพทย์-กฎหมาย-ราชการ / ลำดับเหตุการณ์สำคัญ
ต้องเปลี่ยน: วิธีเล่า / narrative / emotional framing / opening / flow / sentence structure / มุมมอง
ห้าม: "เอาประโยคเดิมมาเรียงใหม่" — ต้อง: "ตีความใหม่จาก fact เดิม"
ผิด: "ทีมแพทย์ผ่าคลอดแฝด 4 สำเร็จ" (sentence เดิม)
ถูก: "กว่าจะพาเด็กทั้ง 4 ออกมาปลอดภัย ทีมแพทย์ต้องวางแผนกันหลายเดือน"

━━━ NARRATIVE ENGINE — เลือก Angle ใหม่ก่อนเขียนเสมอ ━━━
ห้ามเล่าตาม timeline / ห้ามสรุปทีละย่อหน้าแบบข่าวทีวี / ห้ามเรียงตาม statement ราชการ
เลือก Angle 1–3 มุม:
• ข่าวทั่วไป: คนพยายามเตือน / ผลกระทบจิตใจ / ความสัมพันธ์เปลี่ยน / consequence / แรงกดดันสังคม
• ข่าวแพทย์: ภารกิจช่วยชีวิต / เบื้องหลังห้องผ่าตัด / เคสหายาก / ทีมเวิร์ก / ความเสียสละบุคลากร
• ข่าวอุบัติเหตุ: วินาทีชีวิต / คนช่วยเหลือ / ผลกระทบต่อครอบครัว / ความประมาท
• ข่าวราชการ: ผลกระทบต่อประชาชน / สิ่งที่คนต้องรู้ / ผลดีผลเสีย / เบื้องหลังการตัดสินใจ

━━━ EDITORIAL THINKING MODE ━━━
ถามก่อนเขียน: "ถ้าบรรณาธิการเพจไวรัลเป็นคนเล่า เขาจะหยิบประเด็นไหนมาเป็นแกน?"
"ถ้าคนอ่านไม่เคยเห็นต้นฉบับ เขาจะจำข่าวนี้จากมุมไหน?" → ใช้มุมนั้นเป็นแกน
ต้องเลือก: emotional / social / conflict / consequence angle แล้วค่อยเขียน

━━━ ANTI-STRUCTURE COPY ━━━
ต้นฉบับ A→B→C→D ❌ ห้ามเรียงซ้ำแม้เปลี่ยนคำแล้ว
✅ สลับใหม่: เปิดด้วยผลกระทบ/อารมณ์/consequence/conflict/moment สำคัญ แล้วค่อยย้อนเล่า
เขียนเหมือน: นักเล่าข่าวไวรัล / storyteller / columnist ไม่ใช่ bot rewrite / AI summarize

━━━ FACTUAL EMOTIONAL WRITING ━━━
ข่าว factual ห้ามแห้งแบบราชการ — ต้องเติมความเป็นมนุษย์ / ภาพจำ / emotional framing / consequence
โดยไม่บิดเบือน fact และไม่แต่งข้อมูลเพิ่ม
แทน "ทีมแพทย์ร่วมระดมกำลัง":
→ ✅ "เคสนี้ทำให้หลายแผนกต้องทำงานพร้อมกันตั้งแต่ห้องผ่าตัดถึง ICU"

━━━ FINAL QUALITY CHECK (ตรวจก่อนส่งทุกครั้ง) ━━━
□ มี sentence factual เดิมติดต้นฉบับไหม
□ ยังเรียง flow เดิมไหม / ยังเหมือนประกาศราชการไหม
□ มี quote ตรงเกิน 10% ไหม
□ มี narrative ใหม่จริงไหม / มี editorial thinking ไหม
□ มี emotional framing ไหม / อ่านแล้วเหมือนมนุษย์ไหม
□ เอาต้นฉบับเทียบแล้วดูเหมือน "คนละบทความ" ไหม
→ ถ้ายังคล้าย: rewrite ใหม่ทันที

=== จบ ANTI-DUPLICATE + FACTUAL REWRITE SYSTEM ===
`;
    prompt += quoteSafetyRule;

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
      '=== NATIVE THAI SEMANTICS (ห้ามแปลในใจ) ===\n' +
      '❌ ห้ามแปลความหมายหรืออารมณ์จากภาษาไทยเป็นภาษาอังกฤษก่อนประมวลผล (เช่น ห้ามคิดว่า สลดใจ=Tragic, อบอุ่นใจ=Heartwarming แล้วค่อยแต่งเนื้อหา)\n' +
      '✅ ให้คิด ประมวลผล และเรียบเรียง โครงสร้างประโยคใน "ระบบคิดภาษาไทย" (Native Thai Framework) เท่านั้น เพื่อให้ได้สำนวนไทยแท้ๆ ที่ไม่เหมือนภาษาแปล\n\n' +
      '=== HUMAN WRITING DNA V3 — CORE RULE ===\n' +
      '⭐ หลักการสูงสุด: หน้าที่ของคุณไม่ใช่อธิบายความรู้สึก แต่คือสร้างเหตุการณ์ที่ทำให้คนรู้สึกเอง\n' +
      'คุณคือคนที่เล่าเรื่องจริงให้เพื่อนฟัง — ไม่ใช่นักเขียนบทความ ไม่ใช่ narrator สารคดี ไม่ใช่คอลัมนิสต์\n\n' +
      '[ FORBIDDEN PATTERNS — ห้ามเด็ดขาด ]\n' +
      '❌ ภาษาข่าวทีวี: ซึ่ง, ดังกล่าว, ทั้งนี้, อย่างไรก็ตาม, ถือเป็น, เรียกได้ว่า, นับว่า, ได้มีการ, ภายหลังจาก, สืบเนื่อง, ในส่วนของ, จากกรณีดังกล่าว\n' +
      '❌ คำ abstract ที่ AI ชอบ: ความรักอันยิ่งใหญ่, การปล่อยวาง, แรงบันดาลใจ, ความหวัง, แสงสว่าง, แสงนำทาง, ความหมายของชีวิต, ความงดงามของจิตใจ, ความแข็งแกร่ง, ความยุติธรรม\n' +
      '❌ AI Narrator: สิ่งที่น่าสนใจคือ, สิ่งที่สะเทือนใจที่สุดคือ, ทำให้เห็นว่า, สะท้อนให้เห็น, พิสูจน์ว่า, แสดงให้เห็นว่า, สร้างความฮือฮา, กลายเป็นกระแส\n' +
      '❌ บอกอารมณ์แทนคนอ่าน: ทำให้คนดูน้ำตาไหล, สะเทือนใจชาวเน็ต, เต็มไปด้วยความซาบซึ้ง, ทุกคนร้องไห้, น้ำตาคงไหลไปกับ...\n' +
      '❌ สรุปข้อคิดชีวิต: เป็นบทเรียนชีวิต, ความรักที่แท้จริง, ทำให้เราเข้าใจว่า, ไม่ใช่การสูญเสีย แต่เป็น..., สะท้อนถึงความรักที่...\n' +
      '❌ Ending ปรัชญา: ความรักไม่มีวันตาย, ชีวิตต้องเดินต่อ, แสงแห่งความหวัง, วันนี้ที่เราสูญเสีย คือวันที่..., ไม่ใช่แค่...แต่คือ...\n' +
      '❌ Over-drama: โลกพัง, สะเทือนใจที่สุดในโลก, ไม่มีใครให้อภัย, ความจริงอันโหดร้าย (ถ้าใหญ่เกินเหตุการณ์จริง)\n\n' +
      '[ VISUAL FIRST — บังคับทุกย่อหน้า ]\n' +
      '✅ ทุกอารมณ์ต้องแปลงเป็นภาพ action หรือ quote จริง\n' +
      'ตัวอย่าง → ห้าม: "ความรักของครอบครัว" | ต้องเป็น: "ลูกจับมือพ่อก่อนถอดท่อออกซิเจน"\n' +
      'ตัวอย่าง → ห้าม: "การปล่อยวางคือความรัก" | ต้องเป็น: "พ่อไม่ต้องห่วงอะไรแล้วนะ"\n' +
      'ตัวอย่าง → ห้าม: "ทุกคนร้องไห้" | ต้องเป็น: "ไม่มีใครพูดอะไรอยู่พักใหญ่"\n\n' +
      '[ HUMAN IMPERFECTION — ให้มีความเป็นมนุษย์ ]\n' +
      '✅ ใช้ประโยคสั้นสลับยาว — ไม่ต้องทุกประโยค flow สวย\n' +
      '✅ ใช้ quote ตรงๆ จากคนในข่าว ถ้ามี\n' +
      '✅ มี "ความเงียบ" — ไม่ต้องอธิบายทุกอารมณ์ บางทีเล่าแล้วหยุด\n' +
      '✅ ภาษาคนพูดจริง — ไม่ต้องสละสลวยทุกประโยค\n\n' +
      '[ HUMAN MEMORY CHECK — ถามก่อนทุกย่อหน้า ]\n' +
      'ก่อนเขียนทุกย่อหน้า ต้องถามตัวเอง:\n' +
      '→ คนในเหตุการณ์จริงจะพูดแบบนี้ไหม?\n' +
      '→ ประโยคนี้เป็น "ภาพ" หรือ "แนวคิด"?\n' +
      '→ ถ้าตัด sentence นี้ออก อารมณ์ยังอยู่ไหม? ถ้าใช่ → ตัดออก\n' +
      '→ นี่คือโพสต์จริงบน Facebook หรือเรียงความ?\n\n' +
      '[ AUTO CLEAN ] ลบคำฟุ่มเฟือย > เปลี่ยนภาษาทางการ > ตรวจกลิ่น AI > อ่านใหม่ ถ้าสะดุดเขียนใหม่\n' +
      '=== จบ HUMAN WRITING DNA V3 ===\n\n' +
      `สร้างอย่างน้อย ${targetCount || 5} เวอร์ชัน:\n` +
      'เขียนในมุมมองที่ต่างกันตามจำนวนที่ขอ (ตัวอย่างมุมมอง: ไทม์ไลน์เหตุการณ์, ขยี้จังหวะอารมณ์, เปิดเรื่องแรงๆ, มุมมองคนในเหตุการณ์, หรือเจาะลึกความจริง)\n\n' +
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
      `⚠️⚠️⚠️ คำสั่งเด็ดขาด: ต้องสร้างผลลัพธ์ให้ครบจำนวน ${targetCount || 5} เวอร์ชัน ห้ามขาดหาย เนื้อหาแต่ละเวอร์ชันต้องมีความยาวตามที่กำหนด ⚠️⚠️⚠️\n\n` +
      'ตอบเป็น JSON:\n' +
      '{\n' +
      '  "versions": [\n' +
      '    {"style": "ชื่อแนว", "title": "พาดหัว", "content": "เนื้อหายาว ${lenCfg.min}-${lenCfg.max} คำ แบ่ง ${lenCfg.paraDesc} คั่นด้วย \\n\\n", "hook": "ประโยคเปิด", "closing": "ประโยคปิดกระตุ้น", "tone": "โทนเสียง", "target": "กลุ่มเป้าหมาย"}\n' +
      '  ],\n' +
      '  "news_reference": "สรุปข่าวต้นฉบับที่ใช้อ้างอิง 2-3 ประโยค"\n' +
      '}';

    console.log(`\n📦 ${'─'.repeat(50)}`);
    console.log(`📦 NARRATIVE RECONSTRUCTION COMPOSE (mode=analyze)`);
    console.log(`📦  ① Library Prompt: "${smartPrompt?.promptName || '-'}" (${(smartPrompt?.promptText||'').length}ch)`);
    console.log(`📦  ② sourceRemovedFromCompose: ✅ TRUE`);
    console.log(`📦  ③ NarrativePayload: facts=${narrativePayload?.coreFacts?.length || '?'} | research=${narrativePayload?.researchContexts?.length || 0} | quotes=${narrativePayload?.quoteFragments?.length || 0}`);
    console.log(`📦  ④ Research Grade: ${_researchGrade || 'unknown'}`);
    console.log(`📦  ⑤ Fact Sufficiency: ${narrativePayload?.factSufficiency || 'unknown'}`);
    console.log(`📦  ⑥ Blueprint: ${emotionalBlueprint?.core_emotion || '❌ none'}`);
    console.log(`📦  ⑦ Anti-Duplicate+Factual System: ✅ injected`);
    console.log(`📦  TOTAL PROMPT LENGTH: ${multiPrompt?.length || 0}ch`);
    console.log(`📦 ${'─'.repeat(50)}\n`);

    try {
      console.log(`[🤖 AI CALL] mode=write | calling SmartAI (Claude > GPT-4o)...`);
      const { result, model: usedModel } = await callSmartAI('write', { prompt: multiPrompt, temperature: 0.7, maxTokens: 10000 });
      console.log(`[🤖 AI RESULT] model used: ${usedModel}`);
      console.log(`[🤖 AI RESULT] versions: ${result?.versions?.length || 0}`);

      const aiError = result?._error || null;
      const aiWarning = result?._warning || null;

      const debugInfo = {
        promptLength: multiPrompt.length,
        newsBodyLength: actualNewsBody?.length || 0,
        newsTitle: actualNewsTitle || '',
        breakdownPointsCount: actualBreakdown?.key_points?.length || 0,
        presetUsed: smartPrompt?.category || 'library',
        promptSource,
        promptMatchReason: promptMatchReason || 'unknown',
        isBorrowed: smartPrompt?._isBorrowed || false,
        borrowReason: smartPrompt?._borrowReason || null,
        newsTypeDetected: newsTypeDetected || '',
        smartPromptName: smartPrompt ? (smartPrompt.promptName || smartPrompt.category) : null,
        smartPromptScore: smartPrompt?.viralScore || null,
        hasBreakdown: !!actualBreakdown,
        workflowId: workflowId || 'none',
        contextSource: wfContext ? 'DB (persistent)' : 'request (stateless)',
        promptPreview: multiPrompt.slice(0, 500) + '...',
        aiError,
        aiWarning,
        sourceRemovedFromCompose: true,
        narrativePayload: narrativePayload ? {
          coreFactsCount: narrativePayload.coreFacts?.length || 0,
          researchCount: narrativePayload.researchContexts?.length || 0,
          quoteFragmentsCount: narrativePayload.quoteFragments?.length || 0,
          researchGrade: narrativePayload.researchGrade || _researchGrade || 'unknown',
          factSufficiency: narrativePayload.factSufficiency || 'unknown',
          hasBlueprint: !!narrativePayload.emotionalBlueprint,
          narrativeAngle: narrativePayload.narrativeAngle || '',
        } : null,
        smartMatch: {
          totalPromptsLoaded,
          candidatesBeforeFilter: totalPromptsLoaded,
          candidatesAfterFilter: validPromptsCount,
          top10PromptScores,
          selectedPrompt: smartPrompt ? {
            id: smartPrompt.id,
            name: smartPrompt.promptName,
            category: smartPrompt.category,
            emotionalType: smartPrompt.emotionalType,
            score: selectedPromptScore
          } : null,
          selectedPromptScore,
          matchType,
          matchedDimensions,
          whyFallbackUsed,
          rejectedPromptsReason,
          newsAnalysis
        }
      };

      if (result && typeof result === 'object') {
        let versions = result.versions || [];
        if (versions.length === 0 && result.main_post) {
          versions = [{ style: smartPrompt?.category || 'library', title: actualNewsTitle, content: extractSummary(result), hook: '', closing: result.engagement_ending || '', tone: result.emotion || '', target: '' }];
        }

        const validation = validateOutput(result, { newsTitle: actualNewsTitle, newsBody: actualNewsBody });
        const firstContent = versions[0]?.content || '';
        const similarity = checkNarrativeSimilarity(actualNewsBody || '', firstContent);
        debugInfo.similarity = similarity;

        if (workflowId) {
          await saveAnalysis(workflowId, { versions, news_reference: result.news_reference }, smartPrompt?.id || 'library'.id)
            .catch(e => console.error('[Analyze-Service] DB save err:', e.message));
          const agent = new MasterAgent(workflowId);
          await agent.loadFromDB().catch(() => {});
          agent.onAnalysisComplete({ versions, news_reference: result.news_reference });
          agent.onValidationComplete({ safetyPassed: validation.valid, issues: validation.issues, factCheckPassed: true, riskyWordsFound: [], riskyWordsReplaced: [] });
          await agent.saveMemoryToDB().catch(() => {});
        }

        let moderation = { overallSafe: true, results: [] };
        try {
          moderation = await moderateVersions(versions);
        } catch (modErr) {
          console.warn('[Analyze-Service] Moderation check skipped:', modErr.message);
        }

        if (promptSource === 'library' && smartPrompt?.id) {
          try {
            const trackStore = createStore('prompt-library');
            await trackStore.update(smartPrompt.id, (existing) => {
              existing.usageCount = (existing.usageCount || 0) + 1;
              existing.lastUsedAt = new Date().toISOString();
              return existing;
            });
          } catch (trackErr) {
            console.log('[Analyze-Service] Usage tracking skipped:', trackErr.message);
          }
        }

        logPipeline({ workflowId, step: 'analyze', status: 'success', model: usedModel, duration: Date.now() - _pipelineStart, detail: (versions?.length || 0) + ' versions' }).catch(() => {});
        return {
          success: true,
          data: {
            usedPreset: promptSource === 'library'
              ? {
                  id: 'library',
                  name: smartPrompt._isBorrowed ? `⚠️ ${smartPrompt.promptName || smartPrompt.category}` : `🏛️ ${smartPrompt.promptName || smartPrompt.category}`,
                  source: 'library',
                  viralScore: smartPrompt.viralScore,
                  isBorrowed: smartPrompt._isBorrowed || false,
                  borrowReason: smartPrompt._borrowReason || null,
                }
              : { id: 'library', name: '📦 Library', source: 'library' },
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
        };
      }
    } catch (err) {
      console.error('[Analyze-Service] ERROR:', err.message);
      logPipeline({ workflowId, step: 'analyze', status: 'failed', duration: Date.now() - _pipelineStart, error: err.message }).catch(() => {});
      throw err;
    }
  }

  // ===== MODE: BLUEPRINT — Emotional Architecture Planning =====
  if (mode === 'blueprint') {
    console.log('[Blueprint-Service] === EMOTIONAL ARCHITECTURE MODE ===');
    try {
      const actualNewsTitle = newsTitle || '';
      const actualNewsBody = text || '';
      const actualBreakdown = breakdownData || {};

      const coreStory = actualBreakdown.core_story || '';
      const keyPoints = actualBreakdown.key_points?.map(kp => kp.point || kp).join('\n') || '';
      const quotes = actualBreakdown.quotes?.join(' | ') || '';
      const conflicts = actualBreakdown.conflicts?.join(', ') || '';
      const bestAngle = actualBreakdown.best_main_angle?.angle_name || '';
      const emotionalCore = actualBreakdown.main_emotional_core || '';

      const blueprintPrompt = `คุณคือ Story Architect ผู้เชี่ยวชาญเขียนข่าวไวรัลที่อ่านลื่นและอินจริง
งาน: วางแผนโครงสร้างอารมณ์ก่อนเขียน — ห้ามเขียนเนื้อหาจริง วางแผนอย่างเดียว

=== ข่าวที่ต้องวางแผน ===
หัวข้อ: ${actualNewsTitle}
เนื้อหา: ${actualNewsBody.slice(0, 2500)}
${coreStory ? `แก่นข่าว: ${coreStory}` : ''}
${keyPoints ? `ประเด็นสำคัญ:\n${keyPoints}` : ''}
${quotes ? `คำพูดสำคัญ: ${quotes}` : ''}
${conflicts ? `จุดขัดแย้ง: ${conflicts}` : ''}
${bestAngle ? `มุมที่ดีสุด: ${bestAngle}` : ''}
${emotionalCore ? `แก่น Emotional: ${emotionalCore}` : ''}
=== จบข่าว ===

วางแผน 6 ส่วน:

1. CORE_EMOTION — แกนอารมณ์เดียวที่ทรงพลังที่สุดในข่าวนี้
   เลือกได้ 1 เท่านั้น: โกรธ | สงสาร | ช็อก | อึดอัด | สะเทือนใจ | อบอุ่น | ยินดี | ขำขัน
   พร้อม emotion_reason: เหตุผลที่เลือกแกนนี้ (1 ประโยค)

2. EMOTIONAL_BRANCHES — จุดที่จะ "ดันอารมณ์" แกนหลักนั้น (4-6 จุด)
   แต่ละจุดต้องเป็น: จุดเจ็บ | จุดช็อก | จุดขัดแย้ง | จุดสงสาร | จุดโกรธ | จุดที่คนอยากเถียง | จุดที่แชร์ต่อ
   content = ข้อมูลจริงจากข่าว (ไม่แต่ง)

3. CONTEXT_SELECTION — ข้อมูลที่ใส่ได้ พร้อมเหตุผลเดียว
   เลือกเฉพาะข้อมูลที่ตรงเงื่อนไขนี้เท่านั้น:
   - ขยายแผล: ทำให้เรื่องเจ็บกว่าเดิม
   - เพิ่มน้ำหนัก: ยืนยันความจริง
   - contrast: ภาพนอก vs ความจริง
   - tension: ดันความตึงเครียด
   - แรงจูงใจ: อธิบายว่าทำไมถึงทำ
   ถ้าข้อมูลไหนไม่เข้า 5 ข้อนี้ → ไม่ใส่

4. EMOTIONAL_TIMELINE — ลำดับปล่อยข้อมูลทีละชั้น (6-8 ขั้น)
   เริ่มจาก HOOK → จบด้วยประโยคทุบท้าย
   ห้ามเรียง timeline แบบ A→B→C ตามเหตุการณ์จริง
   ต้องเรียงตาม "ระดับอารมณ์" แทน

5. BRIDGES — ประโยคเชื่อมระหว่างประเด็น (3-5 ประโยค)
   ต้องเป็นภาษาคนพูดจริง ไม่ใช่ภาษาทางการ
   เช่น: "แต่สิ่งที่หนักกว่านั้นคือ..." / "ย้อนกลับไปก่อนหน้านี้..."

6. FORBIDDEN — สิ่งที่ห้ามเขียนในข่าวนี้โดยเฉพาะ (2-4 ข้อ)
   เจาะจงกับข่าวนี้เท่านั้น ไม่ใช่กฎทั่วไป

กฎเหล็ก:
- CORE_EMOTION เดียวเท่านั้น ห้ามหลายแกน
- ห้ามใส่ข้อมูลที่ไม่ดันอารมณ์แกนหลัก
- BRIDGES ต้องเป็นภาษาที่คนไทยพูดจริงบน Facebook
- ทุกอย่างต้องมาจากข่าวจริง ห้ามแต่ง

ตอบ JSON:
{
  "core_emotion": "อารมณ์หลัก",
  "emotion_reason": "เหตุผลที่เลือก",
  "emotional_branches": [
    { "branch_type": "จุดเจ็บ|จุดช็อก|จุดขัดแย้ง|จุดสงสาร|จุดโกรธ|จุดแชร์", "content": "ข้อมูลจริงจากข่าว" }
  ],
  "context_selection": [
    { "info": "ข้อมูลที่จะใส่", "purpose": "ขยายแผล|เพิ่มน้ำหนัก|contrast|tension|แรงจูงใจ" }
  ],
  "emotional_timeline": ["HOOK — ...", "จุดสะเทือนแรก — ...", "...", "ประโยคทุบท้าย — ..."],
  "bridges": ["ประโยคเชื่อม 1", "ประโยคเชื่อม 2", "ประโยคเชื่อม 3"],
  "forbidden": ["ห้ามเขียนว่า...", "ห้าม ending แบบ..."]
}`;

      const blueprintResult = await callAI({
        model: 'gpt-4o-mini',
        prompt: blueprintPrompt,
        temperature: 0.3,
        maxTokens: 1200,
      });

      if (!blueprintResult?.core_emotion) {
        throw new Error('AI ไม่สามารถวางแผน Blueprint ได้');
      }

      console.log(`[Blueprint-Service] ✅ Core emotion: ${blueprintResult.core_emotion} | Branches: ${blueprintResult.emotional_branches?.length}`);
      await logPipeline({ workflowId, step: 'blueprint', status: 'success', detail: `emotion=${blueprintResult.core_emotion}` }).catch(() => {});

      return {
        success: true,
        data: {
          blueprint: blueprintResult,
          usedModel: 'gpt-4o-mini',
        },
      };
    } catch (err) {
      console.error('[Blueprint-Service] ERROR:', err.message);
      throw err;
    }
  }

  // ===== MODE: RESEARCH — AI หาข้อมูลเพิ่มเติมจากหัวข้อข่าว =====
  if (mode === 'research') {
    console.log('[Research-Service] === AI RESEARCH MODE ===');
    try {
      const actualNewsTitle = newsTitle || '';
      const actualNewsBody = text || '';
      const actualBreakdown = breakdownData || {};

      const keyPointsSummary = actualBreakdown.key_points?.map(kp => kp.point).join(', ') || '';
      const coreStory = actualBreakdown.core_story || '';
      const keyPeople = actualBreakdown.key_facts?.people?.join(', ') || '';
      const keyPlaces = actualBreakdown.key_facts?.places?.join(', ') || '';

      const researchPromptTemplate = getPrompt('research');
      const analysisCtx = [
        coreStory && ('แก่นข่าว: ' + coreStory),
        keyPointsSummary && ('ประเด็นสำคัญ: ' + keyPointsSummary),
        keyPeople && ('บุคคลสำคัญ: ' + keyPeople),
        keyPlaces && ('สถานที่: ' + keyPlaces),
      ].filter(Boolean).join('\n');

      const researchPrompt = researchPromptTemplate.prompt
        .replace('{title}', actualNewsTitle)
        .replace('{content}', actualNewsBody.slice(0, 3000))
        .replace('{analysis_context}', analysisCtx);

      console.log('[Research-Service] Prompt from promptStore, length: ' + researchPrompt.length + 'ch');

      let result, usedModel;
      try {
        const smartResult = await callSmartAI('analyze', { prompt: researchPrompt, temperature: 0.5, maxTokens: 6000 });
        result = smartResult.result;
        usedModel = smartResult.model;
        logPipeline({ workflowId, step: 'research', status: 'success', model: usedModel, duration: Date.now() - _pipelineStart, detail: 'Research via ' + usedModel }).catch(() => {});
      } catch (err) {
        console.warn(`[Research-Service] SmartAI failed: ${err.message}, fallback GPT-4o`);
        result = await callAI({ prompt: researchPrompt, temperature: 0.5, maxTokens: 6000 });
        usedModel = 'gpt-4o';
      }

      if (result && result.items) {
        console.log(`[Research-Service] ✅ Found ${result.items.length} items`);
        return {
          success: true,
          data: {
            items: result.items,
            usedModel,
            newsTitle: actualNewsTitle,
          },
        };
      } else {
        throw new Error('AI ไม่สามารถหาข้อมูลเพิ่มเติมได้');
      }
    } catch (err) {
      console.error('[Research-Service] ERROR:', err.message);
      throw err;
    }
  }

  // ===== MODE: MIX — AI เลือกมุมดีที่สุด ผสมเป็นเนื้อหาใหม่ =====
  if (mode === 'mix') {
    console.log('[Mix-Service] === AI MIX ANGLES MODE ===');
    try {
      const actualNewsBody = text || '';
      const actualNewsTitle = newsTitle || '';
      const actualBreakdown = breakdownData || {};

      let fullCtx = '';
      if (workflowId) {
        const agent = new MasterAgent(workflowId);
        const loaded = await agent.loadFromDB().catch(() => false);
        if (loaded) {
          fullCtx = agent.compileContext();
          console.log(`[Mix-Service] ✅ Context compiled via MasterAgent (${fullCtx.length}ch)`);
        }
      }
      if (!fullCtx) {
        fullCtx = buildFullContext({ newsBody: actualNewsBody, newsTitle: actualNewsTitle, breakdownData: actualBreakdown });
        console.log('[Mix-Service] ⚠️ Fallback to buildFullContext');
      }

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

      let researchCtx = '';
      if (researchData?.items?.length > 0) {
        researchCtx = '\n\n=== ข้อมูลเพิ่มเติมจาก AI Research ===\n' +
          researchData.items.map((item, i) =>
            `${i+1}. [${item.type}] ${item.title}: ${item.content}\n   แหล่งอ้างอิง: ${item.sourceUrl || item.sourceName || '-'}`
          ).join('\n') +
          '\n⚠️ คำแนะนำการใช้ข้อมูล: เลือกหยิบข้อมูล ตัวเลข สถิติ หรือข้อเท็จจริง จาก "ข้อมูลเพิ่มเติมจาก AI Research" ด้านบน มาเขียนอธิบายเสริมในเนื้อหา **เฉพาะส่วนที่เข้ากับบริบทและมุมมองของเวอร์ชันนี้** เพื่อเพิ่มความลึกและน่าเชื่อถือ (ไม่จำเป็นต้องใช้ทั้งหมด และห้ามแทรก URL หรือคำว่าอ้างอิงลงในเนื้อหาโดยเด็ดขาด)\n' +
          '⚠️ กฎความยาว: เขียนเนื้อหาให้ยาว ลึกซึ้ง และมีรายละเอียดที่จับใจผู้อ่าน ห้ามเขียนสรุปรวบรัดสั้นๆ\n' +
          '\n=== จบข้อมูลเพิ่มเติม ===\n';
      }

      // === SMART RESEARCH: Fact Pool from 6 Agents ===
      let factPoolCtx = '';
      if (factPool && factPool.facts?.length > 0) {
        factPoolCtx = '\n\n=== 🧠 ข้อมูลเชิงลึกจาก Smart Research (ข้อเท็จจริงที่ค้นพบเกี่ยวกับบุคคลในข่าว) ===\n';
        if (factPool.entitySummary) {
          factPoolCtx += `บุคคล: ${factPool.entityName || ''} — ${factPool.entitySummary}\n\n`;
        }
        factPool.facts.forEach((fact, i) => {
          const catLabel = {
            achievement: '🏆 ผลงาน', numbers: '📊 ตัวเลข', quote: '🗣️ คำพูด',
            history: '⚡ ประวัติ', funfact: '💡 เรื่องน่ารู้', publicwork: '🎤 งานสาธารณะ'
          }[fact.category] || '📌 ข้อมูล';
          factPoolCtx += `${i+1}. [${catLabel}] ${fact.text}\n   (แหล่ง: ${fact.source || '-'})\n`;
        });
        factPoolCtx += `\n⚠️ คำแนะนำ Smart Research:\n`;
        factPoolCtx += `- เลือกหยิบข้อเท็จจริงที่ "เข้ากับมุมมองของเวอร์ชันนี้" มาเสริมเนื้อหา\n`;
        factPoolCtx += `- ตัวเลข สถิติ ยอดวิว รายได้ รางวัล → ใช้เป็นหลักฐานเสริมความน่าเชื่อถือ\n`;
        factPoolCtx += `- คำพูดเด็ด ประวัติ เรื่องเบื้องหลัง → ใช้เพิ่มมิติความลึกให้เนื้อหา\n`;
        factPoolCtx += `- ไม่จำเป็นต้องใช้ทั้งหมด เลือกแค่ที่เข้ากับ angle ของเวอร์ชันนี้\n`;
        factPoolCtx += `- ห้ามแทรก URL หรือคำว่า "อ้างอิง" ลงในเนื้อหาโดยเด็ดขาด\n`;
        factPoolCtx += `- ห้ามแต่งข้อมูลเพิ่มเอง ใช้เฉพาะข้อเท็จจริงที่ให้ไว้ข้างบนเท่านั้น\n`;
        factPoolCtx += `\n=== จบ Smart Research ===\n`;
      }

      let smartPromptCtx = '';
      try {
        const detectedCategory = actualBreakdown.content_type || actualBreakdown.category || '';
        if (detectedCategory) {
          const mixPromptStore = createStore('prompt-library');
          let promptLib = [];
          try { promptLib = await mixPromptStore.getAll(); } catch (e) { console.warn('[Mix-Service] Prompt library load:', e.message); }

          if (promptLib.length > 0) {
            const matched = promptLib
              .filter(p => p.category && detectedCategory.includes(p.category))
              .sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));

            const bestPrompt = matched[0] || promptLib.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0))[0];

            if (bestPrompt && bestPrompt.promptText) {
              smartPromptCtx = '\n\n=== 🏛️ Prompt จากหอสมุดไวรัล (Smart Match) ===\n' +
                `ประเภท: ${bestPrompt.category || '-'} | อารมณ์: ${bestPrompt.emotionalType || bestPrompt.emotionalTags?.[0] || '-'} | Viral Score: ${bestPrompt.viralScore || '-'}\n` +
                `สไตล์ Hook: ${bestPrompt.hookStyle || '-'} | โทน: ${bestPrompt.tone || '-'}\n` +
                `โครงสร้าง: ${bestPrompt.structure || '-'}\n\n` +
                '--- คำสั่งเขียนจาก DNA ไวรัล ---\n' +
                '⚠️ คำเตือนสำคัญ (ANTI-HALLUCINATION): คำสั่งสไตล์หรือ "ตัวอย่าง" ด้านล่างนี้ อาจมีข้อมูลสมมติ เช่น ชื่อบุคคล (แม่ครู, ลุง), สถานที่ (เช่น อุบลราชธานี), วันที่ หรือตัวเลขต่างๆ\n' +
                '>> คุณ **ต้องห้ามคัดลอก** ข้อมูลเฉพาะเหล่านี้มาใส่ในเนื้อหาเด็ดขาด! ให้ยึด "ตัวละคร สถานที่ วันที่ และข้อเท็จจริง" จาก "ข่าวต้นฉบับ" เท่านั้น! <<\n' +
                bestPrompt.promptText + '\n' +
                '--- จบคำสั่ง DNA ---\n' +
                '=== จบ Smart Match ===\n';
            }
          }
        }
      } catch (err) {
        console.log('[Mix-Service] Smart Match skipped:', err.message);
      }

      const mixPrompt = fullCtx + researchCtx + factPoolCtx + smartPromptCtx + '\n\n' +
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

      console.log(`[Mix-Service] Prompt length: ${mixPrompt.length}ch`);

      let result, usedModel;
      try {
        const smartResult = await callSmartAI('write', { prompt: mixPrompt, temperature: 0.7, maxTokens: 8000 });
        result = smartResult.result;
        usedModel = smartResult.model;
      } catch (err) {
        console.warn(`[Mix-Service] SmartAI failed (${err.message}), falling back to GPT-4o`);
        result = await callAI({ prompt: mixPrompt, temperature: 0.7, maxTokens: 8000 });
        usedModel = 'gpt-4o';
      }

      if (result && typeof result === 'object') {
        let versions = result.versions || [];
        if (versions.length === 0 && result.content) {
          versions = [{ style: '🧬 AI ผสมมุมข่าว', title: actualNewsTitle, content: result.content, hook: '', closing: '', tone: '', target: '', mixed_from: [] }];
        }

        const validation = validateOutput(result, { newsTitle: actualNewsTitle, newsBody: actualNewsBody });

        if (workflowId) {
          await saveAnalysis(workflowId, { versions, news_reference: result.news_reference }, 'mix_angles').catch(e => console.error('[Mix-Service] DB err:', e.message));
          const agent = new MasterAgent(workflowId);
          await agent.loadFromDB().catch(() => {});
          agent.onAnalysisComplete({ versions, news_reference: result.news_reference });
          agent.onValidationComplete({ safetyPassed: validation.valid, issues: validation.issues, factCheckPassed: true, riskyWordsFound: [], riskyWordsReplaced: [] });
          await agent.saveMemoryToDB().catch(() => {});
        }

        let moderation = { overallSafe: true, results: [] };
        try {
          moderation = await moderateVersions(versions);
        } catch (modErr) {
          console.warn('[Mix-Service] Moderation skipped:', modErr.message);
        }

        logPipeline({ workflowId, step: 'mix', status: 'success', model: usedModel, duration: Date.now() - _pipelineStart, detail: (versions?.length || 0) + ' mix versions' }).catch(() => {});
        return {
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
        };
      }
    } catch (err) {
      console.error('[Mix-Service] ERROR:', err.message);
      logPipeline({ workflowId, step: 'mix', status: 'failed', duration: Date.now() - _pipelineStart, error: err.message }).catch(() => {});
      throw err;
    }
  }

  // === SIMULATE COMMENTS MODE ===
  if (mode === 'simulate_comments') {
    console.log('[Comment-Simulator] === SIMULATE COMMENTS MODE ===');
    try {
      const actualBreakdown = breakdownData || {};
      const coreStory = actualBreakdown.core_story || text || '';
      const keyPoints = actualBreakdown.key_points?.map(kp => kp.point || kp).join('\n') || '';

      const prompt = `คุณคือ AI ผู้เชี่ยวชาญการวิเคราะห์พฤติกรรมชาวเน็ตไทย (Netizen Behavior Analyst)
หน้าที่ของคุณคือการ "จำลองคอมเมนต์ (Simulate Comments)" ที่คาดว่าจะเกิดขึ้นจริงหากข่าวนี้ถูกโพสต์ลงโซเชียลมีเดีย

=== ข้อมูลข่าว ===
เรื่องย่อ: ${coreStory}
ประเด็นสำคัญ:
${keyPoints}

=== คำสั่ง ===
ให้สร้างคอมเมนต์จำลอง 4 แบบ (แบบละ 1 คอมเมนต์ ความยาวไม่เกิน 1-3 ประโยค):
1. 'เห็นด้วย/สนับสนุน' (โทนบวก, เข้าอกเข้าใจ)
2. 'ขัดแย้ง/ดราม่า' (โทนลบ, ตั้งคำถาม, จิกกัด)
3. 'ตลก/แซว' (โทนขำขัน, หิวแสง, ประชดประชันแบบตลก)
4. 'เป็นกลาง/วิเคราะห์' (มองต่างมุม, ให้ข้อมูลเพิ่ม, มีสติ)

ห้ามใช้ภาษาทางการเกินไป ให้ใช้ภาษาพูดแบบชาวเน็ตไทยพิมพ์กันจริงๆ (เช่น พิมพ์ผิดนิดหน่อยได้, ใช้แสลงปัจจุบัน)

ส่งคืนผลลัพธ์เป็น JSON ล้วนๆ ห้ามมี Markdown ตามโครงสร้างนี้:
{
  "comments": [
    { "type": "agreement", "text": "...", "tone": "positive" },
    { "type": "drama", "text": "...", "tone": "negative" },
    { "type": "funny", "text": "...", "tone": "humorous" },
    { "type": "neutral", "text": "...", "tone": "neutral" }
  ]
}`;

      const res = await callAI({
        model: 'gpt-4o-mini',
        temperature: 0.8, // Slightly higher for creativity
        maxTokens: 500,
        prompt: prompt,
        responseFormat: { type: 'json_object' }
      });

      const parsed = res || {};
      return { success: true, data: parsed.comments || [] };

    } catch (err) {
      console.error('[Comment-Simulator] Failed:', err.message);
      return { success: false, data: [] };
    }
  }

  // === GENERATE MODE (Single style, legacy fallback) =====
  const extractionPrompt = getPrompt('extraction');
  let newsData;
  try {
    const prompt = extractionPrompt.prompt
      .replace('{content}', text.slice(0, 8000))
      .replace('{custom_instruction}', customPrompt ? `คำสั่งเพิ่มเติม: "${customPrompt}"` : '');
    const result = await callAI({ prompt, temperature: 0.2 });
    if (result?.news_body && result.news_body.length >= 20) newsData = result;
  } catch (err) { console.error('[Legacy-S1] ERROR:', err.message); }

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

  return {
    success: true,
    data: { newsTitle: newsData.news_title, newsBody: newsData.news_body, newsSource: newsData.news_source, newsDate: newsData.news_date, newsCategory: newsData.news_category, usedPreset: { id: preset.id, name: preset.name }, ...analysis },
  };
}

export async function getTopPrompts({ newsTitle, text, focusAngle, workflowId, excludePromptIds = [] }) {
  console.log(`[Analyze-Service] 🧠 getTopPrompts: Analyzing multi-angle news dimensions for: "${newsTitle}"${focusAngle ? ` | Angle: ${focusAngle}` : ''}${excludePromptIds.length > 0 ? ` | Excluding: ${excludePromptIds.length} prompts` : ''}`);
  let actualNewsBody = text;
  let actualNewsTitle = newsTitle;

  if (workflowId) {
    const wfContext = await getWorkflow(workflowId).catch(() => null);
    if (wfContext) {
      actualNewsBody = wfContext.newsBody || text;
      actualNewsTitle = wfContext.newsTitle || newsTitle;
    }
  }

  let newsAnalysis = null;
  let newsTypeDetected = '';

  try {
    const analyzerPrompt = `คุณเป็นนักวิเคราะห์ข่าวและผู้เชี่ยวชาญการทำไวรัลคอนเทนต์
จงวิเคราะห์ข่าวต่อไปนี้ในหลากหลายมิติ (Multi-Dimensional News Analysis) เพื่อใช้สำหรับการจับคู่กับสไตล์การเล่าเรื่องที่ดีที่สุด

=== ข่าวที่ต้องวิเคราะห์ ===
หัวข้อ: ${actualNewsTitle || 'ไม่มีหัวข้อ'}
เนื้อหาย่อ: ${(actualNewsBody || '').slice(0, 1500)}
=== จบข่าว ===
${focusAngle ? '\n=== มุมมองที่ต้องการเน้น (Focus Angle) ===\n' + focusAngle + '\n' : ''}
โปรดแตกมิติของข่าวตามหมวดหมู่ดังต่อไปนี้ (ต้องเลือกจากตัวเลือกที่กำหนดเท่านั้น):

1. primaryCategory: เลือก 1 จาก: ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน
2. secondaryCategories: เลือก 1-3 จากรายการเดียวกับ primaryCategory (ห้ามซ้ำกับ primaryCategory)
3. emotionalTags: เลือก 2-4 จาก: เห็นใจ, สงสาร, โกรธ, เดือด, ซึ้ง, ตื้นตัน, กลัว, ช็อก, ภูมิใจ, ชื่นชม, คาใจ, สงสัย, เศร้า, หดหู่, สนุก, ขำ, แค้น, อบอุ่น, สะเทือนใจ, หวาดกลัว
4. conflictTags: เลือก 1-3 จาก: ความอยุติธรรม, การตัดสิน, การสูญเสีย, การต่อสู้, การเอาเปรียบ, ความผิดพลาด, การทรยศ, ความขัดแย้ง, การกดขี่, ความเหลื่อมล้ำ
5. narrativeArchetype: เลือก 1 จาก: สู้ชีวิต, ฮีโร่ชาวบ้าน, เปิดโปง, น้ำใจคนไทย, ชีวิตพลิกผัน, ดราม่าครอบครัว, ข่าวเตือนภัย, ความรักข้ามขีดจำกัด, ผู้ถูกกระทำ, คนดีที่โลกลืม
6. viralHooks: จุดกระตุ้นให้คนแชร์หรือพูดถึงในโลกโซเชียล (ระบุเป็นอาร์เรย์ 1-3 ข้อ)
7. humanAngles: ประเด็นเชิงลึกของชีวิตมนุษย์ในข่าว (ระบุเป็นอาร์เรย์ 1-3 ข้อ)

ตอบเป็น JSON เท่านั้นในรูปแบบนี้:
{
  "primaryCategory": "...",
  "secondaryCategories": ["..."],
  "emotionalTags": ["...", "..."],
  "conflictTags": ["..."],
  "narrativeArchetype": "...",
  "viralHooks": ["..."],
  "humanAngles": ["..."]
}`;

    newsAnalysis = await callAI({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 800,
      prompt: analyzerPrompt
    });
    
    newsTypeDetected = newsAnalysis?.primaryCategory || '';
    console.log(`[Analyze-Service] 🧠 STAGE 1 (getTopPrompts): News analysis complete. Primary: ${newsTypeDetected}`);
  } catch (analyzErr) {
    console.warn('[Analyze-Service] STAGE 1 Analysis failed, using fallback:', analyzErr.message);
    newsAnalysis = {
      primaryCategory: 'ดราม่าสังคม',
      secondaryCategories: ['สู้ชีวิต'],
      emotionalTags: ['เห็นใจ', 'คาใจ'],
      conflictTags: ['ความขัดแย้ง'],
      narrativeArchetype: 'สู้ชีวิต',
      viralHooks: ['ดราม่า'],
      humanAngles: ['ผลกระทบ'],
    };
    newsTypeDetected = 'ดราม่าสังคม';
  }

  let validPrompts = [];
  try {
    const promptStore = createStore('prompt-library');
    let promptLib = [];
    try { promptLib = await promptStore.getAll(); } catch (e) { }

    if (promptLib.length === 0) {
      const { readFile: _rf } = await import('fs/promises');
      const { join: _join } = await import('path');
      const _localPath = _join(process.cwd(), 'data', 'prompt-library.json');
      const _localData = JSON.parse(await _rf(_localPath, 'utf-8'));
      if (Array.isArray(_localData) && _localData.length > 0) {
        promptLib = _localData;
      }
    }
    validPrompts = promptLib.filter(p => p.promptText && !excludePromptIds.includes(p.id));
  } catch (err) {
    console.warn('[Analyze-Service] Failed to load prompt library in getTopPrompts:', err.message);
  }

  if (validPrompts.length === 0) {
    return { prompts: [], newsAnalysis };
  }

  const nPrimary = newsAnalysis?.primaryCategory || '';
  const nSecondary = (newsAnalysis?.secondaryCategories || []).map(s => String(s));
  const nEmos = (newsAnalysis?.emotionalTags || newsAnalysis?.emotionalThemes || []).map(e => String(e));
  const nConflicts = (newsAnalysis?.conflictTags || newsAnalysis?.conflictTypes || []).map(c => String(c));
  const nArchetype = newsAnalysis?.narrativeArchetype || '';
  const nHooks = (newsAnalysis?.viralHooks || []).map(h => String(h).toLowerCase());

  const scoredPrompts = validPrompts.map((p, index) => {
    let score = 0;
    let dims = [];

    const pCat = mapCategory(p.category || '');
    const mappedPrimary = mapCategory(nPrimary);
    if (pCat && mappedPrimary && pCat === mappedPrimary) {
      score += 30; dims.push('category');
    } else if (pCat && mappedPrimary) {
      const catCluster = clusterMatch(pCat, mappedPrimary, CONFLICT_CLUSTERS);
      if (catCluster === 'cluster') {
        score += 20; dims.push('category(cluster)');
      } else if (nSecondary.some(s => mapCategory(s) === pCat)) {
        score += 10; dims.push('category(secondary)');
      } else {
        score -= 50; dims.push('category(mismatch)');
      }
    }

    let emoScore = 0;
    const pEmoTags = (p.emotionalTags && Array.isArray(p.emotionalTags) && p.emotionalTags.length > 0)
      ? p.emotionalTags
      : ((p.emotionalType || '') + ' ' + (p.tone || '')).split(/[\s,|/]+/).filter(w => w.length > 1);
    for (const nEmo of nEmos) {
      for (const pTag of pEmoTags) {
        const result = clusterMatch(pTag, nEmo, EMOTION_CLUSTERS);
        if (result) { emoScore += 12; break; }
      }
    }
    if (emoScore > 25) emoScore = 25;
    if (emoScore > 0) { score += emoScore; dims.push('emotional'); }

    let conflictScore = 0;
    const pConflictTags = (p.conflictTags && Array.isArray(p.conflictTags) && p.conflictTags.length > 0)
      ? p.conflictTags
      : ((p.promptName || '') + ' ' + (p.structure || '')).split(/[\s,|/]+/).filter(w => w.length > 2);
    for (const nConf of nConflicts) {
      for (const pTag of pConflictTags) {
        const result = clusterMatch(pTag, nConf, CONFLICT_CLUSTERS);
        if (result) { conflictScore += 8; break; }
      }
    }
    if (conflictScore > 15) conflictScore = 15;
    if (conflictScore > 0) { score += conflictScore; dims.push('conflict'); }

    const pArchetype = (p.narrativeArchetype || p.structure || '').toLowerCase();
    let archScore = 0;
    if (pArchetype && nArchetype) {
      const nArchLower = nArchetype.toLowerCase();
      if (pArchetype === nArchLower || pArchetype.includes(nArchLower) || nArchLower.includes(pArchetype)) {
        archScore = 15;
        dims.push('archetype');
      } else {
        const archWords = nArchLower.split(/[\s,|/]+/).filter(w => w.length > 2);
        let archMatches = 0;
        archWords.forEach(w => { if (pArchetype.includes(w)) archMatches++; });
        archScore = Math.min(15, archMatches * 5);
        if (archScore > 0) dims.push('archetype(partial)');
      }
    }
    score += archScore;

    const pHook = (p.hookStyle || '').toLowerCase();
    let hookScore = 0;
    if (pHook) {
      for (const h of nHooks) {
        if (h && (pHook.includes(h) || h.includes(pHook))) { hookScore += 5; break; }
        const hw = h.split(/[\s,|/]+/).filter(w => w.length > 2);
        if (hw.some(w => pHook.includes(w))) { hookScore += 3; break; }
      }
    }
    if (hookScore > 5) hookScore = 5;
    if (hookScore > 0) { score += hookScore; dims.push('hook'); }

    let viral = Number(p.viralScore);
    if (isNaN(viral)) viral = 70;
    const successRate = Number(p.successRate);
    let histScore = viral * 0.05;
    if (!isNaN(successRate) && successRate > 0) histScore += successRate * 5;
    if (histScore > 10) histScore = 10;
    score += histScore;

    const uniqueDims = [...new Set(dims.map(d => d.replace(/\(.*\)/, '')))];
    if (score > 0) {
      const catScore = dims.some(d => d.startsWith('category')) ? (dims.includes('category') ? 30 : 20) : 0;
      if (catScore >= 20 && emoScore >= 12) {
        score += 10;
        dims.push('boost(cat+emo)');
      }
      if (uniqueDims.length >= 3) {
        score += 5;
        dims.push('boost(multi-dim)');
      }
    }

    return { index, score, dims: [...new Set(dims)] };
  });

  scoredPrompts.sort((a, b) => b.score - a.score);

  const topPrompts = scoredPrompts.slice(0, 3).map(s => {
    const pr = validPrompts[s.index];
    return {
      ...pr,
      _matchScore: s.score,
      _matchedDimensions: s.dims
    };
  });

  console.log(`[Analyze-Service] 🧠 getTopPrompts: Selected Top ${topPrompts.length} Prompts`);
  
  return { prompts: topPrompts, newsAnalysis };
}
