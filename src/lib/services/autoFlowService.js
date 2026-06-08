import { extractContent } from '@/lib/scraper/index.js';
import { transcribeTiktok } from '@/lib/services/tiktokService';
import { transcribeYoutube } from '@/lib/services/youtubeService';
import { performResearch } from '@/lib/services/researchService';
import { performSummarize, getTopPrompts } from '@/lib/services/summarizeService';
import { smartResearch } from '@/lib/services/achievementResearch';
import { getSession } from '@/lib/auth';
import { logPipeline } from '@/lib/pipelineLogger';
import { createLogger } from '@/lib/logger';
import { withTimeout } from '@/lib/utils/withTimeout';
import { runCorrectionPipeline } from '@/lib/correction/correctionPipeline';
import { logGeneration } from '@/lib/services/generationLogger';

const rlog = createLogger('AUTO-SERVICE');

export async function processAutoFlow({ url, text, sourceType: forceType, preset, contentLength, workflowId, user, onProgress }) {
  const startTime = Date.now();
  const _autoWorkflowId = workflowId || ('auto_' + Date.now());

  if ((!url || url.length < 5) && (!text || text.length < 20)) {
    throw new Error('กรุณาใส่ URL หรือข้อความที่ต้องการประมวลผล');
  }

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

  await logPipeline({ workflowId: _autoWorkflowId, step: 'auto-pipeline', status: 'started', detail: (url ? 'URL: ' + url.slice(0, 80) : 'Text: ' + text.slice(0, 80)), ..._user }).catch(() => {});

  const selectedLength = contentLength || 'medium';
  rlog.start(`${url ? 'URL: ' + url.slice(0,80) : 'TEXT: ' + text.slice(0,80)} | type: ${forceType || 'auto-detect'} | length: ${selectedLength}`);

  const log = [];
  const addLog = (step, msg) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const entry = `[${elapsed}s] ${step}: ${msg}`;
    log.push(entry);
    console.log(`[AUTO-PIPELINE-SERVICE] [${elapsed}s] [${step}] ${msg}`);
    if (typeof onProgress === 'function') {
      try { onProgress({ step, msg, elapsed }); } catch (e) {}
    }
  };

  // === STEP 0: Detect source type ===
  const step0Start = Date.now();
  let detectedType = forceType || (url ? 'url' : 'text');
  if (!forceType && url) {
    if (/tiktok\.com|vt\.tiktok|vm\.tiktok/i.test(url)) detectedType = 'tiktok';
    else if (/youtube\.com|youtu\.be/i.test(url)) detectedType = 'youtube';
    else if (/facebook\.com|fb\.watch/i.test(url)) detectedType = 'facebook';
  }
  const domain = url ? (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 30); } })() : 'plain-text';
  addLog('Detect', `📎 ${detectedType.toUpperCase()} → ${domain}`);

  const throwStep = (stepId, msg) => {
    const err = new Error(msg);
    err.failedStep = stepId;
    throw err;
  };

  // === STEP 1: ดึงเนื้อหา (Scrape / Transcribe) ===
  const step1Start = Date.now();
  let rawText = '';
  let contentFallback = false;

  if (detectedType === 'text') {
    addLog('Step1', '📝 ใช้งานข้อความโดยตรง (Plain Text)...');
    rawText = text || '';
    addLog('Step1', `✅ อ่านข้อความ ${rawText.length} ตัวอักษร (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
  } else if (detectedType === 'tiktok') {
    addLog('Step1', '🎵 กำลัง transcribe TikTok...');
    const tikRes = await transcribeTiktok({ url });
    if (!tikRes.success) {
      if (tikRes.needUpload) {
        contentFallback = true;
        rawText = `[TIKTOK_DOWNLOAD_FAILED] ไม่สามารถดาวน์โหลดวิดีโออัตโนมัติ
ลิงก์ TikTok: ${url}
โดเมน: ${domain}
คำอธิบาย: คลิป TikTok จาก ${domain} — กรุณาวิเคราะห์เนื้อหาจากลิงก์นี้
หากไม่มีเนื้อหาเพิ่มเติม ให้ผลลัพธ์เป็น: newsTitle="คลิป TikTok (${domain})", newsBody="ไม่สามารถดึงเนื้อหาอัตโนมัติได้ กรุณาวางลิงก์แบบเต็มหรือพิมพ์เนื้อหาเอง"`.trim();
        addLog('Step1', `⚠️ TIKTOK_DOWNLOAD_FAILED — ใช้ URL fallback แทน (${url.slice(0, 50)})`);
        rlog.warn('TIKTOK_DOWNLOAD_FAILED — ปิปไลน์ยังดำเนินต่อด้วย URL fallback');
      } else {
        throwStep('auto_scrape', `TikTok: ${tikRes.error}`);
      }
    } else {
      rawText = tikRes.transcript || tikRes.text || '';
      addLog('Step1', `✅ TikTok transcript: ${rawText.length} ตัวอักษร (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
    }
  } else if (detectedType === 'youtube') {
    addLog('Step1', '🎬 กำลังดึง YouTube transcript...');
    const ytRes = await transcribeYoutube({ url });
    if (!ytRes.success) throwStep('auto_scrape', `YouTube: ${ytRes.error}`);
    rawText = ytRes.transcript || ytRes.text || '';
    addLog('Step1', `✅ YouTube transcript: ${rawText.length} ตัวอักษร (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
  } else {
    addLog('Step1', `🌐 กำลังดึง HTML จาก ${domain}...`);
    const scrapeData = await withTimeout(extractContent({ url }), 60000, 'scrape');
    if (!scrapeData.success) throwStep('auto_scrape', `Scrape: ${scrapeData.error}`);
    rawText = scrapeData.text || '';
    addLog('Step1', `✅ ดึงเนื้อหา ${rawText.length} ตัวอักษร (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
  }

  if (!rawText || rawText.length < 20) {
    throwStep('auto_scrape', 'ไม่สามารถดึงเนื้อหาได้ (ข้อความสั้นเกินไป)');
  }
  if (contentFallback) addLog('Step1', '⚠️ ใช้ URL fallback — AI จะวิเคราะห์เนื้อหาจาก context ที่มี (ผลลัพธ์อาจจำกัด)');

  // === STEP 2: สกัดข่าว (Extract) ===
  const step2Start = Date.now();
  addLog('Step2', '📰 AI กำลังสกัดเนื้อข่าว...');
  rlog.api('summarize', 'mode=EXTRACT');
  rlog.prompt('transcript_extraction / news_extraction', `input: ${rawText.length}ch | source: ${detectedType}`);
  
  const extractRes = await withTimeout(performSummarize({
    text: rawText,
    sourceType: detectedType,
    mode: 'extract',
    workflowId: _autoWorkflowId,
    user: _user,
  }), 60000, 'extract');

  if (!extractRes.success || !extractRes.data?.newsBody) {
    throwStep('auto_extract', `สกัดข่าวไม่สำเร็จ: ${extractRes.error || 'ไม่มีเนื้อหา'}`);
  }
  const newsData = extractRes.data;
  if (url) newsData.sourceUrl = url;
  rlog.inject('newsTitle', `"${(newsData.newsTitle||'').slice(0,50)}"`);
  rlog.inject('newsBody', `${newsData.newsBody.length}ch | category: ${newsData.newsCategory||'-'}`);
  addLog('Step2', `✅ "${newsData.newsTitle?.slice(0, 40)}..." (${newsData.newsBody.length} ตัวอักษร, ${((Date.now() - step2Start) / 1000).toFixed(1)}s)`);
  await logPipeline({ workflowId: _autoWorkflowId, step: 'extract', status: 'success', duration: Date.now() - step2Start, detail: (newsData.newsTitle || '').slice(0, 60) }).catch(() => {});

  // === STEP 3: แตกประเด็น (Breakdown) ===
  const step3Start = Date.now();
  addLog('Step3', '🔍 AI กำลังวิเคราะห์มุมข่าว...');
  rlog.api('summarize', 'mode=BREAKDOWN');
  
  const breakRes = await withTimeout(performSummarize({
    text: newsData.newsBody,
    newsTitle: newsData.newsTitle,
    sourceType: detectedType,
    mode: 'breakdown',
    workflowId: _autoWorkflowId,
    user: _user,
  }), 60000, 'breakdown');

  if (!breakRes.success || !breakRes.data) {
    throwStep('auto_breakdown', `แตกประเด็นไม่สำเร็จ: ${breakRes.error || ''}`);
  }
  const breakdownData = breakRes.data;
  rlog.inject('breakdownData', `${breakdownData.key_points?.length||0} key_points | ${breakdownData.possible_angles?.length||0} angles | core: "${(breakdownData.core_story||'').slice(0,40)}"`);
  addLog('Step3', `✅ ${breakdownData.key_points?.length || 0} ประเด็น, ${breakdownData.possible_angles?.length || 0} มุมข่าว (${((Date.now() - step3Start) / 1000).toFixed(1)}s)`);
  await logPipeline({ workflowId: _autoWorkflowId, step: 'breakdown', status: 'success', duration: Date.now() - step3Start, detail: (breakdownData.key_points?.length || 0) + ' key points' }).catch(() => {});

  // ===================================================================
  // === PRE-GENERATE: BLUEPRINT + SMART RESEARCH (★ PARALLEL!)
  // ===================================================================
  const stepParallelStart = Date.now();

  rlog.divider('PRE-GENERATE: BLUEPRINT + SMART RESEARCH (PARALLEL)');
  addLog('Parallel', '🚀 Blueprint + SmartResearch ทำงานพร้อมกัน...');
  
  // ★ ทำ 2 งานพร้อมกัน แทนที่จะรอทีละตัว (ประหยัด 30-60 วินาที!)
  const [bpSettled, srSettled] = await Promise.allSettled([
    // Task 1: Blueprint
    withTimeout(performSummarize({
      text: newsData.newsBody,
      newsTitle: newsData.newsTitle,
      mode: 'blueprint',
      breakdownData,
      workflowId: _autoWorkflowId,
      user: _user,
    }), 45000, 'blueprint').catch(() => null),
    
    // Task 2: Smart Research
    withTimeout(
      smartResearch(newsData, breakdownData),
      30000,
      'smart_research'
    ).catch(() => null),
  ]);

  // Extract Blueprint result
  const bpResult = bpSettled.status === 'fulfilled' ? bpSettled.value : null;
  const blueprint = bpResult?.success ? bpResult.data?.blueprint : null;
  addLog('Enhanced', `Blueprint: ${blueprint ? blueprint.core_emotion : '❌'}`);

  // Extract SmartResearch result
  let factPool = null;
  const srResult = srSettled.status === 'fulfilled' ? srSettled.value : null;
  if (srResult && srResult.facts?.length > 0) {
    factPool = srResult;
    addLog('SmartResearch', `✅ พบ ${factPool.facts.length} ข้อเท็จจริงเกี่ยวกับ "${factPool.entityName || '?'}" (${factPool.duration || '?'}s)`);
    await logPipeline({ workflowId: _autoWorkflowId, step: 'smart-research', status: 'success', duration: (factPool.duration || 0) * 1000, detail: `${factPool.facts.length} facts for "${factPool.entityName}"` }).catch(() => {});
  } else {
    addLog('SmartResearch', '⚠️ ไม่พบข้อมูลเพียงพอ — ใช้ flow เดิม');
  }
  
  addLog('Parallel', `⏱️ Blueprint+Research เสร็จใน ${((Date.now() - stepParallelStart) / 1000).toFixed(1)}s (แทนที่จะ ~90s sequential)`);

  // ===================================================================
  // === MULTI-ANGLE PARALLEL PIPELINE ===
  // ===================================================================
  rlog.divider('MULTI-ANGLE PARALLEL PIPELINE');
  
  const anglesToUse = breakdownData.possible_angles?.slice(0, 4) || [];
  if (anglesToUse.length === 0) {
    anglesToUse.push({ angle_name: 'นำเสนอข่าวสารทั่วไป', description: 'เล่าเหตุการณ์ตามจริง' });
  }

  // Calculate target counts. Total = 7.
  const totalVersions = 7;
  const baseCount = Math.floor(totalVersions / anglesToUse.length);
  let remainder = totalVersions % anglesToUse.length;
  
  addLog('Parallel', `🚀 แยกทำงานขนาน ${anglesToUse.length} มุมมอง (เป้าหมายรวม 7 เวอร์ชัน)...`);

  // === PRE-SELECT: เลือก prompt ล่วงหน้าทุก angle (sequential — ป้องกันซ้ำ) ===
  const usedPromptIds = [];
  const anglePrompts = [];
  for (const angleObj of anglesToUse) {
    const focusAngle = `${angleObj.angle_name}: ${angleObj.description}`;
    const promptsRes = await getTopPrompts({
      newsTitle: newsData.newsTitle,
      text: newsData.newsBody,
      focusAngle,
      workflowId: _autoWorkflowId,
      excludePromptIds: [...usedPromptIds],
    }).catch(() => null);
    const topPrompt = promptsRes?.prompts?.[0] || null;
    if (topPrompt?.id) usedPromptIds.push(topPrompt.id);
    anglePrompts.push(topPrompt);
    addLog('PromptSelect', `📋 Angle "${angleObj.angle_name}" → ${topPrompt ? topPrompt.promptName?.slice(0, 40) : '❌ ไม่พบ'} (excluded: ${usedPromptIds.length - 1})`);
  }

  // === PARALLEL GENERATE: สร้างเนื้อหาขนานด้วย prompt ที่เลือกไว้แล้ว ===
  const generationTasks = anglesToUse.map((angleObj, index) => {
    return withTimeout((async () => {
      const count = baseCount + (index < remainder ? 1 : 0);
      const focusAngle = `${angleObj.angle_name}: ${angleObj.description}`;
      
      // 1. Research for this angle
      const resResult = await performResearch({
        newsTitle: newsData.newsTitle,
        newsBody: newsData.newsBody,
        breakdownData,
        focusAngle,
        workflowId: _autoWorkflowId,
      }).catch((resErr) => {
        addLog('Research', `⚠️ Research failed for "${angleObj.angle_name}": ${resErr.message || resErr}`);
        return null;
      });
      const researchItems = resResult?.items || [];
      
      // 2. ใช้ prompt ที่เลือกไว้แล้ว (ไม่ซ้ำกัน)
      const topPrompt = anglePrompts[index];
      
      if (!topPrompt) {
        addLog('PromptSkip', `⚠️ ข้าม Angle "${angleObj.angle_name}" — ไม่มี prompt ที่ match (เพิ่ม prompt ใน library เพื่อครอบคลุม)`);
        return { success: false, error: 'NO_MATCHING_PROMPT', _sourceLabel: angleObj.angle_name, _pIndex: index + 1, _researchItems: researchItems, _topPrompt: null };
      }
      
      // 3. Generate content
      const genResult = await performSummarize({
        text: newsData.newsBody,
        newsTitle: newsData.newsTitle,
        breakdownData,
        sourceType: detectedType,
        mode: 'analyze',
        contentLength: selectedLength,
        presetPrompt: topPrompt,
        targetCount: count,
        emotionalBlueprint: blueprint,
        researchData: researchItems.length > 0 ? { items: researchItems } : null,
        factPool: factPool,
        workflowId: _autoWorkflowId,
        user: _user,
      });
      
      return {
        ...genResult,
        _sourceLabel: angleObj.angle_name,
        _pIndex: index + 1,
        _researchItems: researchItems,
        _topPrompt: topPrompt
      };
    })(), 150000, `generate_A${index + 1}`); // ★ 150s per angle (was 240s — ลดจาก 4 นาที → 2.5 นาที)
  });

  const genResults = await Promise.allSettled(generationTasks);
  
  let allVersions = [];
  let primaryResult = null;
  let classicVersionCount = 0;
  let enhancedVersionCount = 0;
  let totalResearchItems = [];

  genResults.forEach((res) => {
    if (res.status === 'fulfilled' && res.value?.success && res.value.data) {
      const data = res.value.data;
      if (!primaryResult) primaryResult = data; // use the first successful one for base data

      const hasResearch = res.value._researchItems.length > 0;
      totalResearchItems.push(...res.value._researchItems);
      
      const versions = (data.versions || []).map((v, i) => {
        if (hasResearch) enhancedVersionCount++; else classicVersionCount++;
        const pIdx = res.value._pIndex;
        const promptEntry = res.value._topPrompt;
        return {
          ...v,
          _source: hasResearch ? 'enhanced' : 'classic',
          _sourceLabel: res.value._sourceLabel,
          promptId: promptEntry?.id || null,
          style: v.style ? `[A${pIdx}] ${v.style}` : `A${pIdx}_v${i + 1}`,
        };
      });
      allVersions.push(...versions);
    } else if (res.status === 'fulfilled' && res.value?.error === 'NO_MATCHING_PROMPT') {
      addLog('PromptSkip', `⏭️ ข้าม ${res.value._sourceLabel || 'Angle'} — ไม่มี prompt ที่ match ใน library`);
    } else {
      addLog('Error', `❌ Generation Failed for an Angle: ${res.reason?.message || res.reason || res.value?.error || 'Unknown Error'}`);
    }
  });

  const skippedAngles = genResults.filter(r => r.status === 'fulfilled' && r.value?.error === 'NO_MATCHING_PROMPT').length;
  const failedAngles = genResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.success && r.value?.error !== 'NO_MATCHING_PROMPT')).length;

  if (allVersions.length === 0) {
    if (skippedAngles === genResults.length) {
      throwStep('auto_classic', `ถูกข้ามทั้งหมด (${skippedAngles} มุมมอง) เพราะไม่มี Prompt ในคลังที่ตรงกับข่าวนี้เลย โปรดเข้าไปเพิ่ม Prompt ให้ครอบคลุมหมวดหมู่ข่าวนี้`);
    } else {
      throwStep('auto_classic', `สร้างเนื้อหาไม่สำเร็จในทุกมุมมอง (ล้มเหลว ${failedAngles} มุมมอง) — ตรวจสอบ API key หรือโควตาอาจจะเต็ม`);
    }
  }

  addLog('Summary', `📊 รวม ${allVersions.length}/${totalVersions} เวอร์ชัน (Classic: ${classicVersionCount}, Enhanced: ${enhancedVersionCount})${skippedAngles > 0 ? ` | ⚠️ ข้าม ${skippedAngles} angle (ไม่มี prompt match)` : ''}${failedAngles > 0 ? ` | ❌ ล้มเหลว ${failedAngles} angle` : ''}`);
  if (blueprint) addLog('Summary', `🧬 Blueprint: ${blueprint.core_emotion}`);
  if (totalResearchItems.length) addLog('Summary', `🔍 Research: ${totalResearchItems.length} แหล่งข้อมูล`);

  const usedPreset = primaryResult.usedPreset || null;
  const newsType = primaryResult.debug?.newsTypeDetected || '';
  if (newsType) addLog('Prompt', `🧠 AI วิเคราะห์: ข่าว${newsType}`);
  if (usedPreset?.source === 'library') {
    addLog('Prompt', `🏛️ ใช้ Library: "${usedPreset.name}" (Viral: ${usedPreset.viralScore || '-'})`);
  }
  if (primaryResult.debug?.promptMatchReason) {
    addLog('Prompt', `${primaryResult.debug.promptMatchReason}`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  addLog('Done', `✅ เสร็จสมบูรณ์ ${totalTime}s | ${allVersions.length} เวอร์ชัน`);
  await logPipeline({ workflowId: _autoWorkflowId, step: 'auto-pipeline', status: 'success', duration: Date.now() - startTime, detail: `Total: ${totalTime}s | ${allVersions.length} versions` }).catch(() => {});

  // === POST-GENERATION CORRECTION PIPELINE ===
  let finalVersions = allVersions;
  try {
    finalVersions = await runCorrectionPipeline(allVersions, newsData, breakdownData);
    addLog('Correction', `🔧 Correction Pipeline: ${finalVersions.filter(v => v._correctionApplied).length}/${finalVersions.length} corrected`);
  } catch (corrErr) {
    console.error('[AutoFlow] Correction pipeline failed, using original:', corrErr.message);
    addLog('Correction', `⚠️ Correction skipped: ${corrErr.message}`);
  }

  // === GENERATION LOG: บันทึกทุก case เข้าระบบ ===
  try {
    await logGeneration({
      newsTitle: newsData.newsTitle,
      sourceType: detectedType,
      sourceUrl: url || '',
      sourceText: rawText.slice(0, 5000),
      versions: finalVersions,
      breakdownData,
      pipelineInfo: {
        blueprint: blueprint?.core_emotion || null,
        researchCount: totalResearchItems.length,
        factPoolEntity: factPool?.entityName || null,
        classicCount: classicVersionCount,
        enhancedCount: enhancedVersionCount,
        totalTime: parseFloat(totalTime),
        contentLength: selectedLength,
      },
      userId: _user.userId,
    });
    addLog('GenLog', `📋 บันทึก Generation Log สำเร็จ`);
  } catch (logErr) {
    console.warn('[AutoFlow] Generation log failed (non-critical):', logErr.message);
  }

  return {
    success: true,
    data: {
      newsData,
      breakdownData,
      analysisResult: {
        ...primaryResult,
        versions: finalVersions,
        researchItems: totalResearchItems,
      },
      blueprint,
      researchItems: totalResearchItems,
      factPool: factPool || null,
      simulatedComments: [],
      classicVersionCount,
      enhancedVersionCount,
      sourceType: detectedType,
      preset: 'library',
      contentLength: selectedLength,
      totalTimeSeconds: parseFloat(totalTime),
      usedPromptInfo: usedPreset ? {
        source: usedPreset.source,
        name: usedPreset.name,
        viralScore: usedPreset.viralScore || null,
        matchReason: primaryResult.debug?.promptMatchReason || '',
        newsType: newsType || '',
      } : null,
      stepTimings: {
        detect: ((step1Start - step0Start) / 1000).toFixed(1),
        scrape: ((step2Start - step1Start) / 1000).toFixed(1),
        extract: ((step3Start - step2Start) / 1000).toFixed(1),
        breakdown: ((stepParallelStart - step3Start) / 1000).toFixed(1),
        generate: ((Date.now() - stepParallelStart) / 1000).toFixed(1),
      },
      log,
    },
  };
}
