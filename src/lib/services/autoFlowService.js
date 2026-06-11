import { extractContent } from '@/lib/scraper/index.js';
import { transcribeTiktok } from '@/lib/services/tiktokService';
import { transcribeYoutube } from '@/lib/services/youtubeService';
import { transcribeMetaReel, isMetaVideoUrl } from '@/lib/services/metaReelsService';
import { performResearch } from '@/lib/services/researchService';
import { performSummarize, getTopPrompts } from '@/lib/services/summarizeService';
import { smartResearch } from '@/lib/services/achievementResearch';
import { getSession } from '@/lib/auth';
import { logPipeline } from '@/lib/pipelineLogger';
import { createLogger } from '@/lib/logger';
import { withTimeout } from '@/lib/utils/withTimeout';
import { runCorrectionPipeline } from '@/lib/correction/correctionPipeline';
import { logGeneration } from '@/lib/services/generationLogger';
import { getBuiltinFallbackPrompt } from '@/lib/ai/builtinFallbackPrompt';

const rlog = createLogger('AUTO-SERVICE');

export async function processAutoFlow({ url, text, sourceType: forceType, preset, contentLength, workflowId, user, deskMeta, onProgress }) {
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
    else if (/instagram\.com/i.test(url)) detectedType = 'instagram';
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
  } else if ((detectedType === 'facebook' || detectedType === 'instagram') && isMetaVideoUrl(url)) {
    // ★ Reels/วิดีโอ Meta (11 มิ.ย. — คลิปข่าวส่วนใหญ่อยู่บน Meta): แคปชันโพสต์ + Whisper ถอดเสียงพากย์
    addLog('Step1', '🎞️ กำลังถอดเสียง Reels/วิดีโอจาก Meta...');
    const mRes = await transcribeMetaReel({ url });
    if (mRes.success) {
      rawText = mRes.text || '';
      addLog('Step1', `✅ Meta Reels: แคปชัน+เสียง ${rawText.length} ตัวอักษร (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
    } else {
      // วิดีโอดึงไม่ได้ (ส่วนตัว/ต้องล็อกอิน/ไม่มีเสียง) → ลอง scrape หน้าโพสต์ก่อนยอมแพ้
      addLog('Step1', `⚠️ Meta Reels: ${mRes.error} — ลอง scrape หน้าโพสต์แทน`);
      const scrapeData = await withTimeout(extractContent({ url }), 90000, 'scrape').catch(e => ({ success: false, error: e.message }));
      if (scrapeData.success && (scrapeData.text || '').length > 50) {
        const { cleanScrapedText } = await import('@/lib/utils/textCleaner');
        rawText = cleanScrapedText(scrapeData.text);
        addLog('Step1', `✅ scrape หน้าโพสต์แทนได้ ${rawText.length} ตัวอักษร (ตัดขยะแล้ว)`);
      } else {
        throwStep('auto_scrape', `Meta Reels: ${mRes.error}`);
      }
    }
  } else {
    addLog('Step1', `🌐 กำลังดึง HTML จาก ${domain}...`);
    const scrapeData = await withTimeout(extractContent({ url }), 90000, 'scrape'); // ★ 90s (was 60s) — เว็บข่าวไทยบางเจ้าช้า/กันบอท
    if (!scrapeData.success) throwStep('auto_scrape', `Scrape: ${scrapeData.error}`);
    // ★ 12 มิ.ย.: กำจัดขยะเว็บก่อนเข้าไลน์ — ข่าวที่ส่งเป็นลิงก์เจอขยะบ่อย (ดู textCleaner.js)
    const { cleanScrapedText } = await import('@/lib/utils/textCleaner');
    const _rawScrape = scrapeData.text || '';
    rawText = cleanScrapedText(_rawScrape);
    addLog('Step1', `✅ ดึงเนื้อหา ${_rawScrape.length} ตัวอักษร → ตัดขยะเหลือ ${rawText.length} (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
  }

  if (!rawText || rawText.length < 20) {
    throwStep('auto_scrape', 'ไม่สามารถดึงเนื้อหาได้ (ข้อความสั้นเกินไป)');
  }

  // ★★★ Content Quality Gate — ตรวจจับ garbage/template content
  if (detectedType !== 'text') {
    const _lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const _longLines = _lines.filter(l => l.length > 60); // ประโยคยาวที่เป็นเนื้อข่าวจริง
    const _navKeywords = ['ติดต่อเรา', 'คุกกี้', 'cookie', 'ข้อกำหนด', 'สงวนลิขสิทธิ์', 'All Rights Reserved', 'ยอมรับทั้งหมด', 'ติดต่อโฆษณา'];
    const _navHits = _navKeywords.filter(kw => rawText.includes(kw)).length;
    const _linkDensity = (rawText.match(/https?:\/\//g) || []).length;
    
    // ถ้ามีประโยคยาว < 3 + คำ nav ≥ 3 + ลิงก์เยอะ → เป็น template/garbage
    if (_longLines.length < 3 && _navHits >= 3) {
      addLog('Step1', `❌ Content Quality FAIL: เนื้อหาเป็น template เว็บ (${_longLines.length} ประโยคยาว, ${_navHits} nav keywords, ${_linkDensity} links)`);
      throwStep('auto_scrape', `เว็บไซต์นี้ไม่มีเนื้อข่าว (พบเฉพาะ template/navbar) — กรุณา copy เนื้อข่าวมาวางแทน`);
    }
    if (_longLines.length < 2 && rawText.length < 300) {
      addLog('Step1', `❌ Content Quality FAIL: เนื้อหาสั้นเกินไป (${_longLines.length} ประโยค, ${rawText.length} chars)`);
      throwStep('auto_scrape', `เว็บไซต์นี้มีเนื้อหาน้อยเกินไป — กรุณา copy เนื้อข่าวมาวางแทน`);
    }
  }

  // ★ ผนวกข้อความเพิ่มเติมที่ผู้ใช้พิมพ์มาพร้อม URL (url_with_context) — เดิมถูกทิ้งไม่ได้ใช้
  if (url && text && text.length > 20 && !text.includes(url)) {
    rawText += `\n\n[ข้อมูลเพิ่มเติมจากผู้ใช้]\n${text}`;
    addLog('Step1', `➕ ผนวกข้อความจากผู้ใช้ ${text.length} ตัวอักษร`);
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
  }), 120000, 'extract'); // ★ 120s (was 60s) — โดน timeout จริงบน production (Discord 11 มิ.ย.) เหตุผลเดียวกับ blueprint

  if (!extractRes.success || !extractRes.data?.newsBody) {
    throwStep('auto_extract', `สกัดข่าวไม่สำเร็จ: ${extractRes.error || 'ไม่มีเนื้อหา'}`);
  }
  const newsData = extractRes.data;
  if (url) newsData.sourceUrl = url;

  // ★★★ Circuit Breaker — หยุดถ้า AI สกัดข่าวไม่ได้จริง
  const _noContentPhrases = ['ไม่พบเนื้อหาข่าว', 'ไม่พบเนื้อหา', 'ไม่มีเนื้อหาข่าว', 'ไม่มีแก่นข่าว', 'ไม่สามารถระบุ', 'ไม่พบข้อมูลข่าว'];
  const _titleLower = (newsData.newsTitle || '').toLowerCase();
  const _hasNoContent = _noContentPhrases.some(p => _titleLower.includes(p.toLowerCase()));
  if (_hasNoContent) {
    addLog('Step2', `❌ Circuit Breaker: AI สกัดข่าวไม่ได้ — "${newsData.newsTitle}"`);
    throwStep('auto_extract', `ไม่สามารถสกัดเนื้อข่าวได้จาก URL นี้ (${newsData.newsTitle}) — กรุณา copy เนื้อข่าวมาวางแทน`);
  }
  // ★ เช็คว่า newsBody มีเนื้อหาจริง ไม่ใช่ AI แต่งขึ้น
  if (newsData.newsBody.length < 80) {
    addLog('Step2', `❌ Circuit Breaker: newsBody สั้นเกินไป (${newsData.newsBody.length} chars)`);
    throwStep('auto_extract', `เนื้อข่าวที่สกัดได้สั้นเกินไป (${newsData.newsBody.length} ตัวอักษร) — กรุณา copy เนื้อข่าวมาวางแทน`);
  }

  // Bug #3: Guard — หยุด pipeline ถ้าสกัดข่าวไม่ได้เลย (newsTitle ว่างหรือ newsBody สั้นมาก)
  const _guardTitle = newsData.newsTitle || '';
  const _guardBody = newsData.newsBody || '';
  if (!_guardTitle || _guardTitle.includes('ไม่พบเนื้อหาข่าว') || _guardBody.length < 100) {
    addLog('Step2', `❌ Extract Guard: newsTitle="${_guardTitle}", newsBody length=${_guardBody.length}`);
    throwStep('auto_extract', `ไม่สามารถสกัดเนื้อหาข่าวได้ — newsTitle: "${_guardTitle}", newsBody length: ${_guardBody.length}`);
  }

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
  }), 120000, 'breakdown'); // ★ 120s (was 210s) — perf: cut timeout to trigger fallback faster

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
    }), 120000, 'blueprint').catch(() => null), // ★ 120s (was 75s) — GPT-5.5 needs more time
    
    // Task 2: Smart Research
    withTimeout(
      smartResearch(newsData, breakdownData),
      60000,  // ★ 60s (was 30s) — เพิ่มเป็น 2× เพราะ SmartResearch มี 2 AI calls + 7 Serper HTTP calls
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
  const stepGenStart = Date.now(); // ★ จุดเริ่ม generate จริง — แยก timing blueprint/research ออกจาก generate

  // ===================================================================
  // === MULTI-ANGLE PARALLEL PIPELINE ===
  // ===================================================================
  rlog.divider('MULTI-ANGLE PARALLEL PIPELINE');
  
  // ★ ปรับ 10 มิ.ย. 2026: default 3 มุม × 1 เวอร์ชัน = 3 ชิ้นที่ "ต่างกันจริง" (คนละมุม คนละ prompt คนละ research)
  //   เดิม 2 มุม × 2 → เวอร์ชันในมุมเดียวกันแทบซ้ำกัน (V2/V4 เคยได้พาดหัวเหมือนกันคำต่อคำ)
  //   ปรับได้ผ่าน .env: GEN_ANGLES (1-4) / GEN_PER_ANGLE (1-3)
  const GEN_ANGLES = Math.max(1, Math.min(4, parseInt(process.env.GEN_ANGLES || '3', 10) || 3));
  const GEN_PER_ANGLE = Math.max(1, Math.min(3, parseInt(process.env.GEN_PER_ANGLE || '1', 10) || 1));
  const anglesToUse = breakdownData.possible_angles?.slice(0, GEN_ANGLES) || [];
  if (anglesToUse.length === 0) {
    anglesToUse.push({ angle_name: 'นำเสนอข่าวสารทั่วไป', description: 'เล่าเหตุการณ์ตามจริง' });
  }

  const versionsPerAngle = GEN_PER_ANGLE;
  const totalVersions = anglesToUse.length * versionsPerAngle;

  addLog('Generate', `🚀 ${anglesToUse.length} มุมมอง × ${versionsPerAngle} เวอร์ชัน = รวม ${totalVersions} เวอร์ชัน (parallel — ทุก angle ทำงานพร้อมกัน)...`);

  // === PRE-SELECT: เลือก prompt ล่วงหน้าทุก angle (sequential — ป้องกันซ้ำ) ===
  // ★ BUG FIX: Cache AI analysis + prompt lib จาก angle แรก → ใช้ซ้ำทุก angle
  const usedPromptIds = [];
  const anglePrompts = [];
  let _cachedNewsAnalysis = null;
  let _cachedPromptLib = null;
  
  for (const angleObj of anglesToUse) {
    const focusAngle = `${angleObj.angle_name}: ${angleObj.description}`;
    const promptsRes = await getTopPrompts({
      newsTitle: newsData.newsTitle,
      text: newsData.newsBody,
      focusAngle,
      workflowId: _autoWorkflowId,
      excludePromptIds: [...usedPromptIds],
      _cachedNewsAnalysis,   // ★ ส่ง cached analysis (null ครั้งแรก → AI วิเคราะห์ → cache)
      _cachedPromptLib,      // ★ ส่ง cached lib (null ครั้งแรก → load → cache)
    }).catch(() => null);
    
    // Cache จากผลลัพธ์ครั้งแรก → ใช้ซ้ำครั้งถัดไป
    if (!_cachedNewsAnalysis && promptsRes?.newsAnalysis) {
      _cachedNewsAnalysis = promptsRes.newsAnalysis;
    }
    if (!_cachedPromptLib && promptsRes?._promptLib?.length > 0) {
      _cachedPromptLib = promptsRes._promptLib;
    }
    
    let topPrompt = promptsRes?.prompts?.[0] || null;
    if (topPrompt?.id) usedPromptIds.push(topPrompt.id);
    // ★ ไม่มี prompt match → ใช้ Built-in Fallback V12 แทนการข้าม angle (เดิมเนื้อหาหายทั้ง angle)
    if (!topPrompt) {
      topPrompt = getBuiltinFallbackPrompt();
      addLog('PromptSelect', `📦 Angle "${angleObj.angle_name}" → ไม่มี match ใน library — ใช้ Built-in Fallback V12 แทน`);
    } else {
      addLog('PromptSelect', `📋 Angle "${angleObj.angle_name}" → ${topPrompt.promptName?.slice(0, 40)} (excluded: ${usedPromptIds.length - 1})${_cachedNewsAnalysis ? ' ♻️' : ''}`);
    }
    anglePrompts.push(topPrompt);
  }

  // ★ HOTFIX (10 มิ.ย.): สไตล์เปิดเรื่องหมุนเวียนต่อ angle — โหมด 1 เวอร์ชัน/call ไม่มีแรงบังคับ
  //   diversity ภายใน call ทำให้ทุกเวอร์ชันเปิดเหมือนกัน (เคยออกมาเปิด "วันที่ 8..." ทั้งหมด)
  // ★ ปรับ 12 มิ.ย. (feedback ทีม): จากสไตล์บังคับ → คำแนะนำที่เลือกเองได้ + กฎความเป็นธรรมชาติ/ตรรกะ
  const OPENING_STYLES = [
    'แนวเปิดที่แนะนำ: ภาพ/ฉากของเหตุการณ์ — แต่ถ้าไม่เข้ากับเรื่อง เลือกแนวอื่นที่เป็นธรรมชาติกว่าได้เลย',
    'แนวเปิดที่แนะนำ: ตัวเลขหรือ contrast ที่สะดุดใจ — แต่ถ้าไม่เข้ากับเรื่อง เลือกแนวอื่นที่เป็นธรรมชาติกว่าได้เลย',
    'แนวเปิดที่แนะนำ: คำพูดคนในเหตุการณ์ หรือเล่าตรงๆ แบบมีน้ำหนัก — แต่ถ้าไม่เข้ากับเรื่อง เลือกแนวอื่นที่เป็นธรรมชาติกว่าได้',
    'แนวเปิดที่แนะนำ: ผลลัพธ์/ปลายทางของเรื่องก่อน แล้วย้อนเล่าที่มา — แต่ถ้าไม่เข้ากับเรื่อง เลือกแนวอื่นได้',
  ];
  const OPENING_RULES = 'กฎเปิดเรื่อง (บังคับ): ห้ามขึ้นต้นด้วยวันที่ ห้าม "ลองนึก/ลองคิด" | ประโยคเปิดต้องเป็นเหตุเป็นผลตามหลักภาษา ห้ามใช้ "เพราะ/จึง" เชื่อมสิ่งที่ไม่ใช่เหตุผลของกันจริงๆ | อ่านแล้วต้องเหมือนแอดมินเพจเล่าเอง ไม่ใช่สูตรสำเร็จ ถ้าเปิดแบบเปรียบเปรยแล้วฝืน ให้เล่าตรงๆ แทน';

  // === PARALLEL GENERATE: สร้างเนื้อหาทุก angle พร้อมกัน (★ PARALLEL — save ~150-300s) ===
  addLog('Generate', `🚀 เริ่ม PARALLEL generate ${anglesToUse.length} angles พร้อมกัน...`);
  const genResultsRaw = await Promise.allSettled(
    anglesToUse.map(async (angleObj, index) => {
      addLog('Generate', `▶️ Angle ${index + 1}/${anglesToUse.length}: "${angleObj.angle_name}" (parallel)...`);
      return withTimeout((async () => {
        const focusAngle = `${angleObj.angle_name}: ${angleObj.description}`;
        // มุมเล่า + สไตล์เปิดเรื่องเฉพาะของเวอร์ชันนี้ (ส่งให้ตัวเขียนเท่านั้น — research ใช้ focusAngle เพียวๆ)
        const writeAngle = `${focusAngle}\n${OPENING_STYLES[index % OPENING_STYLES.length]}\n${OPENING_RULES}`;

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

        // 2. ใช้ prompt ที่เลือกไว้แล้ว
        const topPrompt = anglePrompts[index];
        if (!topPrompt) {
          addLog('PromptSkip', `⚠️ ข้าม Angle "${angleObj.angle_name}" — ไม่มี prompt match`);
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
          targetCount: versionsPerAngle,
          emotionalBlueprint: blueprint,
          researchData: researchItems.length > 0 ? { items: researchItems } : null,
          factPool: factPool,
          focusAngle: writeAngle, // ★ มุมเล่า + สไตล์เปิดเรื่องบังคับของ angle นี้
          workflowId: _autoWorkflowId,
          user: _user,
        });

        return {
          ...genResult,
          _sourceLabel: angleObj.angle_name,
          _pIndex: index + 1,
          _researchItems: researchItems,
          _topPrompt: topPrompt,
        };
      })(), 300000, `generate_A${index + 1}`); // ★ 300s per angle (เดิม 240s — Opus ช้ากว่า Sonnet ขยายกัน timeout)
    })
  );

  // Map Promise.allSettled results → format เดิม { status, value/reason }
  const genResults = genResultsRaw.map((raw, index) => {
    if (raw.status === 'fulfilled') {
      addLog('Generate', `✅ Angle ${index + 1} เสร็จ: ${raw.value?.data?.versions?.length || 0} เวอร์ชัน`);
      return { status: 'fulfilled', value: raw.value };
    } else {
      addLog('Generate', `❌ Angle ${index + 1} fail: ${raw.reason?.message || raw.reason}`);
      return { status: 'rejected', reason: raw.reason };
    }
  });

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
      const errDetail = res.reason?.message || res.reason || res.value?.error || 'Unknown Error';
      addLog('Error', `❌ Generation Failed for an Angle: ${errDetail}`);
      console.error(`[AutoFlow] ❌ ANGLE FAIL DETAIL:`, JSON.stringify({ status: res.status, reason: res.reason?.message, valueError: res.value?.error, valueSuccess: res.value?.success }));
    }
  });

  const skippedAngles = genResults.filter(r => r.status === 'fulfilled' && r.value?.error === 'NO_MATCHING_PROMPT').length;
  const failedAngles = genResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.success && r.value?.error !== 'NO_MATCHING_PROMPT')).length;

  if (allVersions.length === 0) {
    if (skippedAngles === genResults.length) {
      throwStep('auto_classic', `ถูกข้ามทั้งหมด (${skippedAngles} มุมมอง) เพราะไม่มี Prompt ในคลังที่ตรงกับข่าวนี้เลย โปรดเข้าไปเพิ่ม Prompt ให้ครอบคลุมหมวดหมู่ข่าวนี้`);
    } else {
      // Collect actual error details for debugging
      const errorDetails = genResults
        .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.success && r.value?.error !== 'NO_MATCHING_PROMPT'))
        .map(r => r.reason?.message || r.value?.error || 'unknown')
        .join('; ');
      throwStep('auto_classic', `สร้างเนื้อหาไม่สำเร็จในทุกมุมมอง (ล้มเหลว ${failedAngles} มุมมอง): ${errorDetails || 'ไม่ทราบสาเหตุ'}`);
    }
  }

  addLog('Summary', `📊 รวม ${allVersions.length}/${totalVersions} เวอร์ชัน (Classic: ${classicVersionCount}, Enhanced: ${enhancedVersionCount})${skippedAngles > 0 ? ` | ⚠️ ข้าม ${skippedAngles} angle (ไม่มี prompt match)` : ''}${failedAngles > 0 ? ` | ❌ ล้มเหลว ${failedAngles} angle` : ''}`);
  if (blueprint) addLog('Summary', `🧬 Blueprint: ${blueprint.core_emotion}`);
  if (totalResearchItems.length) addLog('Summary', `🔍 Research: ${totalResearchItems.length} แหล่งข้อมูล`);

  const usedPreset = primaryResult.usedPreset || null;
  // ★ FIX: breakdownData.primaryCategory มักมีค่าเสมอหลัง STEP 3
  // primaryResult.debug.newsTypeDetected ว่างเมื่อ presetPrompt ถูกเลือกไว้ล่วงหน้า (Stage 1 DNA analysis ถูกข้าม)
  const newsType = breakdownData?.primaryCategory || primaryResult.debug?.newsTypeDetected || '';
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
        contentLength: selectedLength,
        totalTime: parseFloat(totalTime),
        promptName: usedPreset?.name || anglePrompts[0]?.promptName || '',
        promptSource: usedPreset?.source || (anglePrompts[0] ? 'library' : ''),
        promptScore: usedPreset?.viralScore || anglePrompts[0]?.viralScore || 0,
        newsType: newsType || '',
        stepTimings: {
          detect: ((step1Start - step0Start) / 1000).toFixed(1),
          scrape: ((step2Start - step1Start) / 1000).toFixed(1),
          extract: ((step3Start - step2Start) / 1000).toFixed(1),
          breakdown: ((stepParallelStart - step3Start) / 1000).toFixed(1),
          blueprint: ((stepGenStart - stepParallelStart) / 1000).toFixed(1),
          research: ((stepGenStart - stepParallelStart) / 1000).toFixed(1),
          generate: ((Date.now() - stepGenStart) / 1000).toFixed(1),
        },
        desk: deskMeta || null, // ★ ป้ายโต๊ะข่าว {newsId, lane, category, editor, editorIcon}
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
        blueprint: ((stepGenStart - stepParallelStart) / 1000).toFixed(1),
        research: ((stepGenStart - stepParallelStart) / 1000).toFixed(1),
        generate: ((Date.now() - stepGenStart) / 1000).toFixed(1),
      },
      log,
    },
  };
}
