import { extractContent } from '@/lib/scraper/index.js';
import { transcribeTiktok } from '@/lib/services/tiktokService';
import { transcribeYoutube } from '@/lib/services/youtubeService';
import { transcribeMetaReel, isMetaVideoUrl } from '@/lib/services/metaReelsService';
import { performResearch } from '@/lib/services/researchService';
import { isNewsResearchOn } from '@/lib/utils/researchSwitch'; // 🔎 ใช้แยก log "ปิดอยู่" ออกจาก "ค้นแล้วไม่เจอ"
import { performSummarize, getTopPrompts } from '@/lib/services/summarizeServiceText';
import { smartResearch } from '@/lib/services/achievementResearch';
import { logGeneration } from '@/lib/services/generationLogger';
import { getSession } from '@/lib/auth';
import { logPipeline } from '@/lib/pipelineLogger';
import { createLogger } from '@/lib/logger';
import { withTimeout, withTimeoutSignal } from '@/lib/utils/withTimeout';
import { runCorrectionPipeline } from '@/lib/correction/correctionPipeline';
import {
  enforceRawFactCompleteness,
  isRawFactCompletenessGateEnabled,
  persistFactualReviewOrThrow,
} from '@/lib/services/rawFactCompletenessGate';
import { saveAnalysis, saveFactualReview } from '@/lib/workflow/workflowEngine';
import {
  buildPublishableAnalysisResult,
  countFinalVersionSources,
  enforceTextNewsPublicationFloor,
  getPublishablePostText,
  resolveFinalUsedPreset,
} from '@/lib/utils/publishablePostText';
import { getBuiltinFallbackPrompt } from '@/lib/ai/builtinFallbackPrompt';
import { isLegacyLengthOn, NEW_LENGTH_CFG } from '@/lib/ai/legacyLengthRules';
// ★ 19 ส.ค. 69 รอบ 3 (ANGLE_CLOSING_SPLIT): กติกาจับคู่แผนจบ+เงื่อนไขทุบท้าย อยู่ที่เดียวใน narrativePayloadText
//   (ปลายทาง dependency — ไม่เกิด circular import) เพื่อให้ log ฝั่งนี้ตรงกับที่ฝั่งเขียนใช้จริงเสมอ
import { assignAngleClosings, closingTailMatches } from '@/lib/input-engine/narrativePayloadText';
import { isCardAuthorityR6Enabled } from '@/lib/ai/cardAuthority'; // 🎛️ สวิตช์ปลดหาง "ห้ามขึ้นต้นด้วยวันที่" (19 ส.ค. 69) — ห้ามอ่าน env CARD_AUTH* เอง ต้อง import จากไฟล์กลางเท่านั้น
import {
  getActivePipelineDeadline,
  rethrowPipelineDeadline,
} from '@/lib/utils/pipelineDeadline';

const rlog = createLogger('AUTO-SERVICE');

// หลังข่าวผ่านด่านข้อเท็จจริงและบันทึก workflow แล้ว telemetry เป็น best-effort เท่านั้น
// ต้องคืนการควบคุมก่อน hard deadline เสมอ เพื่อไม่ให้ข่าวที่จ่ายค่า AI สำเร็จถูกตีเป็น failed
export async function settleTelemetryWithinReserve(task, {
  deadline = getActivePipelineDeadline(),
  maxWaitMs = 2_000,
  reserveMs = 10_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const remaining = typeof deadline?.remainingMs === 'function'
    ? deadline.remainingMs()
    : Number.POSITIVE_INFINITY;
  const waitMs = Math.max(0, Math.min(maxWaitMs, remaining - reserveMs));
  if (waitMs <= 0) return { status: 'skipped', error: 'response reserve' };

  let timer;
  const taskResult = Promise.resolve()
    .then(task)
    .then(value => ({ status: 'completed', value }), error => ({ status: 'failed', error }));
  const timeoutResult = new Promise(resolve => {
    timer = setTimer(() => resolve({ status: 'timeout', error: 'telemetry timeout' }), waitMs);
    timer?.unref?.();
  });
  try {
    return await Promise.race([taskResult, timeoutResult]);
  } finally {
    if (timer) clearTimer(timer);
  }
}

export async function processAutoFlowText({ url, text, sourceType: forceType, preset, contentLength, workflowId, user, deskMeta, onProgress }) {
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

  if (detectedType === 'text' || detectedType === 'plain_text') {
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
    // ★ 12 มิ.ย.: กำจัดขยะเว็บก่อนเข้าไลน์ (คำเตือนเบราว์เซอร์/คุกกี้/เมนู/ลิสต์ข่าวแนะนำ) —
    //   ข่าวที่ส่งเป็นลิงก์จากโต๊ะ/บอทเจอขยะพวกนี้บ่อย ต่างจากคนวางเนื้อเองที่สะอาด (#00206 ตัวเลขมั่วเพราะแบบนี้)
    const { cleanScrapedText } = await import('@/lib/utils/textCleaner');
    const _rawScrape = scrapeData.text || '';
    rawText = cleanScrapedText(_rawScrape);
    addLog('Step1', `✅ ดึงเนื้อหา ${_rawScrape.length} ตัวอักษร → ตัดขยะเหลือ ${rawText.length} (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
  }

  if (!rawText || rawText.length < 20) {
    throwStep('auto_scrape', 'ไม่สามารถดึงเนื้อหาได้ (ข้อความสั้นเกินไป)');
  }
  // ★ ผนวกข้อความเพิ่มเติมที่ผู้ใช้พิมพ์มาพร้อม URL (url_with_context) — เดิมถูกทิ้งไม่ได้ใช้
  if (url && text && text.length > 20 && !text.includes(url) && (detectedType !== 'text' && detectedType !== 'plain_text')) {
    rawText += `\n\n[ข้อมูลเพิ่มเติมจากผู้ใช้]\n${text}`;
    addLog('Step1', `➕ ผนวกข้อความจากผู้ใช้ ${text.length} ตัวอักษร`);
  }

  // ★ 21 ส.ค. 69: เก็บข้อความที่ผู้ใช้วางไว้แยกจาก newsData.newsBody ซึ่งผ่าน AI สกัด
  //   ส่งเฉพาะสายข้อความดิบไปให้นักเขียนอ่านก่อนวัตถุดิบเดิมทั้งหมด สาย URL/คลิปไม่เปลี่ยน
  const writerRawSourceText = (detectedType === 'text' || detectedType === 'plain_text')
    ? rawText
    : undefined;

  if (contentFallback) addLog('Step1', '⚠️ ใช้ URL fallback — AI จะวิเคราะห์เนื้อหาจาก context ที่มี (ผลลัพธ์อาจจำกัด)');

  // === STEP 2: สกัดข่าว (Extract) ===
  const step2Start = Date.now();
  addLog('Step2', '📰 AI กำลังสกัดเนื้อข่าว...');
  rlog.api('summarize', 'mode=EXTRACT');
  rlog.prompt('transcript_extraction / news_extraction', `input: ${rawText.length}ch | source: ${detectedType}`);
  
  const extractRes = await withTimeoutSignal((stageSignal) => performSummarize({
    text: rawText,
    sourceType: detectedType,
    mode: 'extract',
    workflowId: _autoWorkflowId,
    user: _user,
    signal: stageSignal,
  }), 120000, 'extract'); // ★ 120s (was 60s) — โดน timeout จริงบน production (Discord 11 มิ.ย.) เหตุผลเดียวกับ blueprint

  if (!extractRes.success || !extractRes.data?.newsBody) {
    throwStep('auto_extract', `สกัดข่าวไม่สำเร็จ: ${extractRes.error || 'ไม่มีเนื้อหา'}`);
  }
  const newsData = extractRes.data;

  // ★★★ Circuit Breaker — หยุดถ้า AI สกัดข่าวไม่ได้จริง
  const _noContentPhrases = ['ไม่พบเนื้อหาข่าว', 'ไม่พบเนื้อหา', 'ไม่มีเนื้อหาข่าว', 'ไม่มีแก่นข่าว', 'ไม่สามารถระบุ', 'ไม่พบข้อมูลข่าว'];
  const _titleLower = (newsData.newsTitle || '').toLowerCase();
  const _hasNoContent = _noContentPhrases.some(p => _titleLower.includes(p.toLowerCase()));
  if (_hasNoContent) {
    addLog('Step2', `❌ Circuit Breaker: AI สกัดข่าวไม่ได้ — "${newsData.newsTitle}"`);
    throwStep('auto_extract', `ไม่สามารถสกัดเนื้อข่าวได้ (${newsData.newsTitle}) — กรุณา copy เนื้อข่าวมาวางแทน`);
  }
  if (newsData.newsBody.length < 80) {
    addLog('Step2', `❌ Circuit Breaker: newsBody สั้นเกินไป (${newsData.newsBody.length} chars)`);
    throwStep('auto_extract', `เนื้อข่าวสั้นเกินไป (${newsData.newsBody.length} ตัวอักษร) — กรุณา copy เนื้อข่าวมาวางแทน`);
  }

  // ★ 16 ก.ค. 69 (B3): AI สกัดล้มแล้วตกมาใช้ raw text — เดิมเงียบสนิท ไม่มีใครรู้ว่างานนี้ไม่ได้ผ่าน AI
  //   นโยบายเจ้าของ (D2-ก): เตือนดังๆ + ประทับธงติดงาน แต่ให้เดินต่อ (เนื้อ text สรุปมาแล้วมักใช้ได้)
  if (extractRes.extractFallback) {
    addLog('Step2', `⚠️ EXTRACT-FALLBACK: AI สกัดไม่สำเร็จ (${(extractRes.extractError || '').slice(0, 80)}) — ใช้ข้อความดิบเดินท่อต่อ`);
    newsData._extractFallback = true;
    newsData._extractError = extractRes.extractError || '';
    await logPipeline({ workflowId: _autoWorkflowId, step: 'extract', status: 'fallback', detail: 'ใช้ raw text: ' + (extractRes.extractError || '').slice(0, 100) }).catch(() => {});
  }

  rlog.inject('newsTitle', `"${(newsData.newsTitle||'').slice(0,50)}"`);
  rlog.inject('newsBody', `${newsData.newsBody.length}ch | category: ${newsData.newsCategory||'-'}`);
  addLog('Step2', `✅ "${newsData.newsTitle?.slice(0, 40)}..." (${newsData.newsBody.length} ตัวอักษร, ${((Date.now() - step2Start) / 1000).toFixed(1)}s)`);
  await logPipeline({ workflowId: _autoWorkflowId, step: 'extract', status: 'success', duration: Date.now() - step2Start, detail: (newsData.newsTitle || '').slice(0, 60) }).catch(() => {});

  // === STEP 3: แตกประเด็น (Breakdown) ===
  const step3Start = Date.now();
  addLog('Step3', '🔍 AI กำลังวิเคราะห์มุมข่าว...');
  rlog.api('summarize', 'mode=BREAKDOWN');
  
  const breakRes = await withTimeoutSignal((stageSignal) => performSummarize({
    text: newsData.newsBody,
    newsTitle: newsData.newsTitle,
    sourceType: detectedType,
    mode: 'breakdown',
    workflowId: _autoWorkflowId,
    user: _user,
    signal: stageSignal,
  }), 300000, 'breakdown'); // ★ 300s (10 ก.ค. 69) = inner gpt-5.5 200s + fallback gpt-4o 60s + เผื่อ 40s — ห้ามต่ำกว่าผลรวมชั้นใน ไม่งั้น job ตายทั้งงานทั้งที่ fallback กำลังจะรอด

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
  // ★ 14 ส.ค. 69 (Sol 9.5/10 — sol-backlog4 ข้อ 4a): จับเวลาจริงของแต่ละงานใน finally —
  //   เดิม stepTimings รายงาน blueprint/research เป็นช่วงขนานรวมก้อนเดียว = เลขซ้ำกันทุกเคส วัดคอขวดจริงไม่ได้
  const _taskElapsed = { blueprint: null, research: null };
  // ★ 18 ส.ค. 69 (แบบ ก — เฟเบิ้ล-สุด): ANGLE_CLOSING_SPLIT — ให้ Blueprint วางแผนจบแยกรายมุม "ในใบเดียว"
  //   (ยังเรียก Blueprint ครั้งเดียวต่อข่าวเหมือนเดิม — ไม่เพิ่มค่า API)
  //   ปัญหา: ท่อนจบ 2 มุมออกมาแฝดกัน (RUN5 นกจริยา — สองฉบับจบ "วันที่เกือบปล่อยมือ..." ~15 คำติดเหมือนกัน)
  //   เพราะแผนจบ 3 ชั้น (ประโยคทุบท้าย/forbidden/ปิด: จาก breakdown) แชร์ข้ามมุมทั้งหมด
  //   เปิด: ANGLE_CLOSING_SPLIT=1 · ปิด (ค่าเริ่มต้น — ไม่ตั้ง env): พฤติกรรมเดิมทุกไบต์
  //   ⚠️ สูตรจำนวนมุมต้องตรงกับ GEN_ANGLES ในบล็อก MULTI-ANGLE ด้านล่าง — แก้ที่หนึ่งต้องแก้อีกที่ด้วย
  const isAngleClosingSplitEnabled = process.env.ANGLE_CLOSING_SPLIT === '1';
  // ★ 19 ส.ค. 69 (ANGLE2_BY_SCORE — สเปคเฟเบิ้ล-สุด): มุมแรกคงหมวดแรกตามเดิม · มุมที่ 2 เป็นต้นไปเลือกตาม facebook_viral_score
  //   เปิด: ANGLE2_BY_SCORE=1 · ปิด (ค่าเริ่มต้น — ไม่ตั้ง env): เดินโค้ดหั่นมุมเดิมทุกไบต์
  //   ⚠️ จุดหั่นมุมมี 3 จุด (แผนจบรายมุมตรงนี้ · anglesToUse ใน MULTI-ANGLE · ตัวหั่นมุมของ blueprint ต่อมุม)
  //   ต้องสลับด้วยตัวเลือกเดียวกันครบทุกจุด — ขาดจุดเดียว รายชื่อมุมไม่ตรงกันแล้วการจับคู่ชื่อล้มเงียบ (ดูโน้ตที่ selectAnglesForGen)
  const isAngle2ByScoreEnabled = process.env.ANGLE2_BY_SCORE === '1';
  let _closingAngleList = null;
  if (isAngleClosingSplitEnabled) {
    // 🔧 19 ส.ค. 69 (🟡 FIXLIST-planK): สูตรจำนวนมุมรวมศูนย์ที่ getGenAnglesCount() — เดิมก๊อปสูตรมา 2 ที่
    const _nAngles = getGenAnglesCount();
    _closingAngleList = (isAngle2ByScoreEnabled
      ? selectAnglesForGen(breakdownData, _nAngles)
      : (breakdownData.possible_angles || []).slice(0, _nAngles))
      .map((a) => ({ angle_name: String(a?.angle_name || '').trim(), description: String(a?.description || '').trim() }))
      .filter((a) => a.angle_name);
    if (_closingAngleList.length < 2) _closingAngleList = null; // มุมเดียวไม่มีปัญหาจบแฝด — ใช้พฤติกรรมเดิม
  }
  // ★ 18 ส.ค. 69 (แบบ A — ANGLE_BLUEPRINT_MODE=per_angle): Blueprint หนึ่งใบต่อหนึ่งมุม
  //   ค่าที่รับมีค่าเดียวคือ "per_angle"; ไม่ตั้งค่า / "off" / ค่าอื่น = เส้นเดิมด้านล่างทุกประการ
  //   รายการนี้คำนวณด้วยเพดานเดียวกับ MULTI-ANGLE (1-4) และใช้ชื่อมุมเป็น key ตั้งแต่ต้น
  const isAngleBlueprintPerAngle = isAngleBlueprintPerAngleMode(process.env.ANGLE_BLUEPRINT_MODE);
  const _perAngleBlueprintAngles = isAngleBlueprintPerAngle
    ? selectPerAngleBlueprintAngles(breakdownData, process.env.GEN_ANGLES)
    : null;
  const _bpT0 = Date.now();
  const _srT0 = Date.now();
  // เริ่ม N calls ตรงนี้พร้อมกันทั้งหมด และยังทำขนานกับ SmartResearch เหมือนเส้นเดิม
  // เมื่อเปิดพร้อม ANGLE_CLOSING_SPLIT: ไม่ส่ง angleList ให้แต่ละ call เพราะใบต่อมุมมี closing เฉพาะตัวอยู่แล้ว
  // ป้องกันไม่ให้ Blueprint ใบเดียวต้องวางซ้ำทุกมุมอีกชั้นและไม่ให้สองแผนขัดกัน (per_angle มี precedence)
  const _perAngleBlueprintTask = isAngleBlueprintPerAngle
    ? runPerAngleBlueprintCalls(_perAngleBlueprintAngles, (blueprintAngle) => withTimeoutSignal((stageSignal) => performSummarize({
        text: newsData.newsBody,
        newsTitle: newsData.newsTitle,
        mode: 'blueprint',
        breakdownData,
        workflowId: _autoWorkflowId,
        user: _user,
        blueprintAngle,
        signal: stageSignal,
      }), 120000, `blueprint:${blueprintAngle.angle_name || 'unnamed'}`))
      .catch((error) => {
        rethrowPipelineDeadline(error, 'blueprint_per_angle');
        return null;
      })
      .finally(() => { _taskElapsed.blueprint = Date.now() - _bpT0; })
    : null;
  const [bpSettled, srSettled] = await Promise.allSettled([
    // Task 1: Blueprint
    _perAngleBlueprintTask ||
    withTimeoutSignal((stageSignal) => performSummarize({
      text: newsData.newsBody,
      newsTitle: newsData.newsTitle,
      mode: 'blueprint',
      breakdownData,
      workflowId: _autoWorkflowId,
      user: _user,
      signal: stageSignal,
      // ★ ANGLE_CLOSING_SPLIT=1 เท่านั้นถึงส่งรายชื่อมุม — ไม่ตั้ง env = ไม่มี key นี้ = prompt Blueprint เดิมไบต์ต่อไบต์
      ...(_closingAngleList ? { angleList: _closingAngleList } : {}),
    }), 120000, 'blueprint').catch((error) => {
      rethrowPipelineDeadline(error, 'blueprint');
      return null;
    }).finally(() => { _taskElapsed.blueprint = Date.now() - _bpT0; }), // ★ 120s — GPT-5.5 needs more time

    // Task 2: Smart Research
    withTimeoutSignal(
      (stageSignal) => smartResearch(newsData, breakdownData, { signal: stageSignal }),
      60000, // ★ 16 ก.ค. 69 (B4): 60s (was 30s) — sync สาย URL: SmartResearch มี 2 AI calls + 7 Serper HTTP calls
             //   ค่า 30s พิสูจน์แล้วว่าไม่พอ → factPool เป็น null เงียบๆ ข่าวขาดข้อมูลเสริม
      'smart_research'
    ).catch((error) => {
      rethrowPipelineDeadline(error, 'smart_research');
      return null;
    }).finally(() => { _taskElapsed.research = Date.now() - _srT0; }),
  ]);
  if (bpSettled.status === 'rejected') rethrowPipelineDeadline(bpSettled.reason, 'blueprint');
  if (srSettled.status === 'rejected') rethrowPipelineDeadline(srSettled.reason, 'smart_research');

  // Extract Blueprint result
  const bpResult = bpSettled.status === 'fulfilled' ? bpSettled.value : null;
  const blueprint = bpResult?.success ? bpResult.data?.blueprint : null;
  const angleBlueprintsByName = isAngleBlueprintPerAngle && bpResult?.data?.angleBlueprintsByName instanceof Map
    ? bpResult.data.angleBlueprintsByName
    : null;
  const _perAngleBlueprintFailedKeys = new Set(
    isAngleBlueprintPerAngle && Array.isArray(bpResult?.meta?.failedAngleKeys) ? bpResult.meta.failedAngleKeys : []
  );
  addLog('Enhanced', `Blueprint: ${blueprint ? blueprint.core_emotion : '❌'}`);
  if (isAngleBlueprintPerAngle) {
    const _bpOk = Number(bpResult?.meta?.successCount || 0);
    const _bpTotal = _perAngleBlueprintAngles.length;
    addLog('Enhanced', `🎯 Blueprint per-angle: สำเร็จ ${_bpOk}/${_bpTotal} มุม${blueprint ? ` · fallback=${bpResult?.meta?.fallbackSourceAngleName || 'มุมแรก'}` : ' · ล้มหมด ใช้ null แล้วเขียนต่อ'}`);
  }

  // Extract SmartResearch result
  let factPool = null;
  const srResult = srSettled.status === 'fulfilled' ? srSettled.value : null;
  if (srResult && srResult.facts?.length > 0) {
    factPool = srResult;
    addLog('SmartResearch', `✅ พบ ${factPool.facts.length} ข้อเท็จจริงเกี่ยวกับ "${factPool.entityName || '?'}" (${factPool.duration || '?'}s)`);
    await logPipeline({ workflowId: _autoWorkflowId, step: 'smart-research', status: 'success', duration: (factPool.duration || 0) * 1000, detail: `${factPool.facts.length} facts for "${factPool.entityName}"` }).catch(() => {});
  } else if (!isNewsResearchOn()) {
    // ★ 16 ส.ค. 69 (ผู้ตรวจอิสระท้วง): ข้อความเดิมอ่านแล้วเหมือน "ค้นแล้วไม่เจอ"
    //   ทั้งที่ความจริงคือ "ถูกปิดตามคำสั่ง" — คนสืบย้อนทีหลังจะหลงทางว่าระบบค้นล้มเหลว
    addLog('SmartResearch', '⏭️ ปิดอยู่ตามคำสั่ง — ข่าวนี้ใช้เนื้อต้นฉบับอย่างเดียว (เปิดคืน: NEWS_RESEARCH=1)');
  } else {
    addLog('SmartResearch', '⚠️ ไม่พบข้อมูลเพียงพอ — ใช้ flow เดิม');
  }
  
  addLog('Parallel', `⏱️ Blueprint+Research เสร็จใน ${((Date.now() - stepParallelStart) / 1000).toFixed(1)}s (แทนที่จะ ~90s sequential)`);
  const stepGenStart = Date.now(); // ★ จุดเริ่ม generate จริง — แยก timing blueprint/research ออกจาก generate

  // ===================================================================
  // === MULTI-ANGLE PARALLEL PIPELINE ===
  // ===================================================================
  rlog.divider('MULTI-ANGLE PARALLEL PIPELINE');
  
  // ★ ปรับ 10 ก.ค. 69 (คำสั่งทีม หลังเคส #01641): default 2 มุม — ฝืนหามุมที่ 3 = พร้อมท์อันดับท้ายธีมผิดเรื่อง
  //   "ออกแค่ 1-2 แต่มุมจริง แมตช์จริง ไม่บิดเบือน" — ปรับได้ผ่าน .env: GEN_ANGLES
  const GEN_ANGLES = getGenAnglesCount(); // 🔧 19 ส.ค. 69 (🟡 FIXLIST-planK): สูตรเดียวกับสวิตช์แบบ ก — รวมศูนย์ helper เดียว ค่าเท่าเดิมเป๊ะ
  const GEN_PER_ANGLE = Math.max(1, Math.min(3, parseInt(process.env.GEN_PER_ANGLE || '1', 10) || 1));
  // ★ REVERT 10 ก.ค. 69 (เคส #01635): ห้ามเรียงตามคะแนนไวรัล — มุมคะแนนสูงมักเป็นมุมพี่น้องเรื่องเดียวกัน
  //   → 3 เวอร์ชันเปิดเหมือนกันหมด + ชื่อมุมแคบจนจับคู่พร้อมท์คลังเพี้ยน (เจอพร้อมท์ไว้อาลัยกับข่าวมูฟออน)
  //   ใช้ลำดับเดิมของ template 12 หมวด = ความหลากหลายมาในตัว (หมวด 1,2,3 คนละแนวเสมอ)
  // ★ 19 ส.ค. 69 (ANGLE2_BY_SCORE=1 เท่านั้น): จุดหั่นมุมจุดที่ 2 — มุมแรกยังคงหมวดแรกตาม REVERT ข้างบน
  //   เฉพาะมุมที่ 2+ ที่เลือกตามคะแนน · ต้องได้รายชื่อชุดเดียวกับแผนจบรายมุมและตัวหั่นมุมของ blueprint ต่อมุมเสมอ
  const anglesToUse = (isAngle2ByScoreEnabled
    ? selectAnglesForGen(breakdownData, GEN_ANGLES)
    : breakdownData.possible_angles?.slice(0, GEN_ANGLES)) || [];
  if (anglesToUse.length === 0) {
    anglesToUse.push({ angle_name: 'นำเสนอข่าวสารทั่วไป', description: 'เล่าเหตุการณ์ตามจริง' });
  }

  const versionsPerAngle = GEN_PER_ANGLE;
  let totalVersions = anglesToUse.length * versionsPerAngle;
  
  addLog('Generate', `🚀 ${anglesToUse.length} มุมมอง × ${versionsPerAngle} เวอร์ชัน = รวม ${totalVersions} เวอร์ชัน (parallel — ทุก angle ทำงานพร้อมกัน)...`);

  // === PRE-SELECT: เลือก prompt ล่วงหน้าทุก angle (sequential — ป้องกันซ้ำ) ===
  // ★ BUG FIX: Cache AI analysis + prompt lib จาก angle แรก → ใช้ซ้ำทุก angle
  const usedPromptIds = [];
  // 18 ส.ค. 69 (แบบ 2 — สถาปนิกออกแบบ · โซลตรวจไขว้ · เจ้าของอนุมัติ): มุมถัดไปเห็นการ์ดที่มุมก่อนหน้าใช้ไปแล้ว เพื่อไม่ให้ 2 ฉบับเปิดซ้ำ
  // ปิดกลับเดิม: ANGLE_CARD_CONTEXT=0
  const usedCardInfo = [];
  const isAngleCardContextEnabled = process.env.ANGLE_CARD_CONTEXT !== '0';
  const MIN_ANGLE_MATCH = Math.max(0, parseInt(process.env.ANGLE_MIN_MATCH_SCORE || '45', 10) || 45);
  const anglePrompts = [];
  const anglePromptCandidates = [];
  let _cachedNewsAnalysis = null;
  let _cachedPromptLib = null;
  let _cachedCatalogPicks = null; // ★ สารบัญ 201: โผเข้ารอบต่อข่าว — จ่ายค่าสารบัญครั้งเดียว มุมถัดไปใช้ซ้ำ

  for (const angleObj of anglesToUse) {
    const focusAngle = `${angleObj.angle_name}: ${angleObj.description}`;
    const promptsRes = await getTopPrompts({
      newsTitle: newsData.newsTitle,
      text: newsData.newsBody,
      focusAngle,
      workflowId: _autoWorkflowId,
      excludePromptIds: [...usedPromptIds],
      ...(isAngleCardContextEnabled ? { usedCardInfo: [...usedCardInfo] } : {}),
      _cachedNewsAnalysis,
      _cachedPromptLib,
      _cachedCatalogPicks,
    }).catch((error) => {
      rethrowPipelineDeadline(error, 'card_picker');
      return null;
    });

    // Cache จากผลลัพธ์ครั้งแรก → ใช้ซ้ำครั้งถัดไป
    if (!_cachedNewsAnalysis && promptsRes?.newsAnalysis) {
      _cachedNewsAnalysis = promptsRes.newsAnalysis;
    }
    if (!_cachedPromptLib && promptsRes?._promptLib?.length > 0) {
      _cachedPromptLib = promptsRes._promptLib;
    }
    // ★ Opus P2-C: แคชแม้ตอนล้ม ([]) — มุมถัดไปจะได้ไม่จ่ายค่าสารบัญซ้ำเปล่าๆ
    if (_cachedCatalogPicks === null && Array.isArray(promptsRes?._catalogPicks)) {
      _cachedCatalogPicks = promptsRes._catalogPicks;
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
    if (process.env.REF_WEIGHT_BY_MATCH === '1' && anglePrompts.length === 0 && topPrompt && topPrompt.id !== 'fallback_builtin'
        && topPrompt._matchType !== 'AI_PICKED' /* ★ Opus P2-A: ใบที่ luna เลือกห้ามถูกสลับทิ้งด้วยคะแนนสูตร */) {
      const _s0 = Number(topPrompt._matchScore ?? 0);
      if (_s0 < MIN_ANGLE_MATCH) {
        addLog('PromptSelect', `🔁 มุมแรกจับคู่หลวม (score ${_s0} < ${MIN_ANGLE_MATCH}) → ใช้ Built-in V12 แทนพร้อมท์ผิดเรื่อง (REF_WEIGHT_BY_MATCH)`);
        topPrompt = getBuiltinFallbackPrompt();
      }
    }
    const rankedPromptCandidates = [
      topPrompt,
      ...(Array.isArray(promptsRes?.prompts) ? promptsRes.prompts : []),
    ].filter((prompt, promptIndex, list) => prompt && list.findIndex(item => String(item?.id || '') === String(prompt?.id || '')) === promptIndex);
    anglePromptCandidates.push(rankedPromptCandidates);
    anglePrompts.push(topPrompt);
    // ★ ผู้ตรวจ (โซล) จับได้: มุม 2+ ที่จะถูกตัดทีหลัง ห้ามเก็บเป็นบริบทให้มุมถัดไป (เงื่อนไขต้องตรงกับลูปตัดด้านล่าง)
    if (isAngleCardContextEnabled && (anglePrompts.length === 1 || topPrompt._matchType === 'AI_PICKED' || Number(topPrompt._matchScore ?? 0) >= MIN_ANGLE_MATCH)) {
      const cleanCardField = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      usedCardInfo.push({ name: topPrompt.promptName, tone: cleanCardField(topPrompt.tone), hookStyle: cleanCardField(topPrompt.hookStyle) });
    }
  }

  // ★ 10 ก.ค. 69 (เคส #01641 "แม่ยังอยู่"): มุมจริง-แมตช์จริงเท่านั้น — ห้ามฝืนเขียนด้วยพร้อมท์ธีมผิดเรื่อง
  //   มุมที่ 2 เป็นต้นไป ถ้าจับคู่หลวม (_matchScore < 45 หรือหลุดไป Built-in Fallback ซึ่งไม่มี score)
  //   → ตัดมุมทิ้ง ออกน้อยเวอร์ชันแต่ไม่บิดเบือน (พร้อมท์อันดับท้ายเคยพาตัวเขียนละข้อเท็จจริง "แม่เสียชีวิต")
  //   มุมแรกเก็บเสมอ = การันตีมีผลลัพธ์อย่างน้อย 1 เวอร์ชัน
  for (let i = anglesToUse.length - 1; i >= 1; i--) {
    // ★ 1 ส.ค. 69 (Opus P2-A): ใบที่ luna ตั้งใจเลือก (AI_PICKED) อ่านการ์ดเต็ม+เนื้อข่าวแล้ว — ห้ามใช้คะแนนสูตร
    //   (ที่มันตัดสินว่าด้อยกว่าอยู่แล้ว) มาโยนทิ้ง ไม่งั้นฟีเจอร์ถูกล้างเงียบๆ ในเคสที่ควรช่วยที่สุด
    if (anglePrompts[i]?._matchType === 'AI_PICKED') continue;
    const _score = Number(anglePrompts[i]?._matchScore ?? 0);
    if (_score < MIN_ANGLE_MATCH) {
      addLog('PromptSelect', `✂️ ตัดมุม "${anglesToUse[i].angle_name}" — พร้อมท์จับคู่หลวม (score ${_score} < ${MIN_ANGLE_MATCH}) เอาเฉพาะมุมที่แมตช์จริง`);
      anglesToUse.splice(i, 1);
      anglePrompts.splice(i, 1);
      anglePromptCandidates.splice(i, 1);
    }
  }

  totalVersions = anglesToUse.length * versionsPerAngle;
  const finalAngleNames = anglesToUse.map(angle => String(angle?.angle_name || '').trim());
  if (finalAngleNames.some(name => !name)
      || new Set(finalAngleNames.map(name => name.toLowerCase())).size !== finalAngleNames.length) {
    throwStep('auto_breakdown', 'รายชื่อมุมข่าวที่รอดไม่ครบหรือซ้ำกัน — หยุดเพื่อไม่ส่งเวอร์ชันผิดมุม');
  }
  addLog('Generate', `✅ แผนสุดท้ายหลังตรวจ prompt: ${anglesToUse.length} มุม × ${versionsPerAngle} เวอร์ชัน = ${totalVersions} เวอร์ชัน`);

  // ★ 19 ส.ค. 69 (ร้ายแรง 3 — FIXLIST-planK): จองแผนจบ "ก่อนยิงขนาน" — closing ใบเดียวห้ามถูกใช้ 2 มุม
  //   ทำตรงนี้ (หลังลูปตัดมุม) ลำดับจองจึงแน่นอนตามลำดับมุมที่รอด — ถ้าไปจองใน task ขนานลำดับจะแข่งกันเอง
  // 🔧 19 ส.ค. 69 รอบ 3 (โซลตรวจ): 3 อย่างในบล็อกเดียว —
  //   1) จับคู่ two-pass ผ่าน assignAngleClosings (exact ครบทุกมุมก่อน แล้วค่อย contain จากใบว่าง — แก้เคสกลับด้าน
  //      "มุมแรก contain ไปคว้าใบ exact ของมุมหลัง" + ใบที่เจอถูกจองแล้วต้องค้นใบว่างถัดไป ไม่ยอมแพ้)
  //   2) log ตรงกับของจริง: เช็ค closingTailMatches (เงื่อนไขเดียวกับฝั่งเขียนใน narrativePayloadText) ก่อนแนบ+ก่อน log
  //      — เดิม log ขึ้น "ใช้แผนเฉพาะมุม" ทั้งที่ฝั่งเขียนถอยเพราะ regex ไม่ติด (log โกหก ห้ามใช้ตัดสินผลเทส)
  //   3) เปิดคู่กับ per_angle (แบบ A): ไม่แนบและไม่ log เลย — per_angle ทับ blueprint ทั้งใบอยู่แล้ว
  //      log "ใช้แผนเฉพาะมุม" ของแบบ ก จะเป็นเท็จทันที (ของโซลไม่ถูกแตะ — บล็อกนี้แค่หลบทาง)
  let _angleClosingPicks = null;
  if (isAngleClosingSplitEnabled && !isAngleBlueprintPerAngle && blueprint && Array.isArray(blueprint.angle_closings)) {
    if (closingTailMatches(blueprint.emotional_timeline)) {
      _angleClosingPicks = assignAngleClosings(blueprint.angle_closings, anglesToUse.map((a) => a.angle_name));
      addLog('ClosingSplit', `🔚 แผนจบรายมุมจับคู่ได้จริง ${_angleClosingPicks.filter(Boolean).length}/${anglesToUse.length} มุม (ไม่ซ้ำใบ)`);
    } else {
      addLog('ClosingSplit', '⚠️ ข้อสุดท้าย timeline ของ Blueprint ไม่ใช่ "ประโยคทุบท้าย" — ฝั่งเขียนจะถอยแผนกลางทุกมุม จึงไม่แนบแผนรายมุม');
    }
  }

  // ★ HOTFIX (10 มิ.ย.): สไตล์เปิดเรื่องหมุนเวียนต่อ angle — กันทุกเวอร์ชันเปิดเหมือนกัน (ดู autoFlowService.js)
  //   (12 มิ.ย. ทีมสั่งย้อนกลับสูตรนี้ — เวอร์ชันที่ทีมชอบ (#00189) เขียนด้วยสูตรนี้)
  // 🎛️ CARD_AUTHORITY R6 (19 ส.ค. 69): เปิดสวิตช์ = ถอดหาง " ห้ามขึ้นต้นด้วยวันที่" ทั้ง 4 สูตร + หางพร้อมท์ด้านล่าง · ปิด (default) = ข้อความเดิมทุกไบต์
  const _caR6Tail = isCardAuthorityR6Enabled() ? '' : ' ห้ามขึ้นต้นด้วยวันที่';
  const blueprintPlansForRepair = new Array(anglesToUse.length).fill(null);

  // === PARALLEL GENERATE: สร้างเนื้อหาขนานด้วย prompt ที่เลือกไว้แล้ว ===
  const generationTasks = anglesToUse.map((angleObj, index) => {
    return withTimeoutSignal((stageSignal) => (async () => {
      const count = versionsPerAngle;
      const focusAngle = `${angleObj.angle_name}: ${angleObj.description}`;
      // 18 ส.ค. 69 เจ้าของสั่งถอด 3 รอบ (2132c6a · eb6ff50 · 9b9a689) คืนสภาพยุคปัง
      // เหตุผล: ให้การ์ดกับสไตล์ไวรัลเป็นแนวทาง ห้ามสั่งทับ · กู้ของเดิม: git show <sha>
      const _ap = anglePrompts[index];
      const _promptHook = (_ap && Number(_ap._matchScore) >= 60 && _ap.hookStyle) ? String(_ap.hookStyle) : null;
      const _reservedOpeningAngles = anglesToUse.slice(0, index)
        .map(item => `${item?.angle_name || ''}: ${item?.description || ''}`.trim())
        .filter(Boolean);
      const _openingStyle = buildAngleOpeningContract(index, _promptHook, _reservedOpeningAngles, _caR6Tail);
      const writeAngle = _openingStyle ? `${focusAngle}\nสไตล์เปิดเรื่องบังคับของเวอร์ชันนี้: ${_openingStyle}` : focusAngle; // ★ 2 ก.ย. 69 สัญญาว่าง (สวิตช์ทดลอง) → ไม่ใส่บรรทัดเปล่า
      
      // 1. Research for this angle
      const resResult = await performResearch({
        newsTitle: newsData.newsTitle,
        newsBody: newsData.newsBody,
        breakdownData,
        focusAngle,
        workflowId: _autoWorkflowId,
        signal: stageSignal,
      }).catch((resErr) => {
        rethrowPipelineDeadline(resErr, `research_A${index + 1}`);
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
      // ★ 18 ส.ค. 69 (แบบ ก — ANGLE_CLOSING_SPLIT): มุมนี้รับเฉพาะแผนจบของมุมตัวเอง — กันท่อนจบแฝดข้ามมุม
      //   ผลจับคู่มาจาก _angleClosingPicks (two-pass · จองใบไม่ซ้ำ · เช็คเงื่อนไขทุบท้ายแล้ว) ที่สร้างหลังลูปตัดมุม
      //   index ของ map นี้จึงชี้มุมเดียวกันแน่นอน (แพตเทิร์นเดียวกับ anglePrompts[index])
      //   🔧 19 ส.ค. 69 รอบ 3: _angleClosingPicks non-null = ฝั่งเขียนจะใช้แผนที่แนบแน่นอน (เงื่อนไข gate ฝั่งเขียน
      //   ถูกเช็คครบตั้งแต่ precompute: env เปิด + ใบมีเนื้อ + ทุบท้ายติด) → log สองบรรทัดล่างเป็นความจริงเสมอ
      //   มุมที่ได้ null = ใช้แผนกลางเดิมทั้งใบเงียบๆ ห้ามทำข่าวล้ม
      let angleBlueprint = blueprint;
      if (isAngleClosingSplitEnabled && blueprint && _angleClosingPicks) {
        const _angleClosing = _angleClosingPicks[index];
        if (_angleClosing) {
          angleBlueprint = { ...blueprint, angle_closing: _angleClosing };
          addLog('ClosingSplit', `🔚 มุม "${angleObj.angle_name}" ใช้แผนจบเฉพาะมุม [${_angleClosing.match_type === 'exact' ? 'ชื่อตรง' : 'ชื่อคาบเกี่ยว'}]: ${(_angleClosing.closing_direction || _angleClosing.closing_sketch || '').slice(0, 60)}`);
        } else {
          addLog('ClosingSplit', `⚠️ มุม "${angleObj.angle_name}" ไม่ได้แผนจบรายมุม (ชื่อไม่แมตช์/ใบถูกมุมอื่นจองไป) — ใช้แผนกลางเดิม`);
        }
      }
      // ★ แบบ A: เลือกด้วยชื่อมุมหลังขั้นตัดมุมแล้ว จึงไม่ผูกกับ index ที่อาจเลื่อน
      //   ถ้า call ของมุมนี้ล้ม Map จะชี้ไปแผนมุมแรก; ถ้าล้มหมดจะได้ null และ analyze เดินต่อเหมือนเดิม
      //   วางหลังบล็อกแบบ ก โดยเจตนา: เมื่อเปิดสองสวิตช์ per_angle เป็นแผนที่ละเอียดกว่าและมี precedence
      if (isAngleBlueprintPerAngle) {
        angleBlueprint = pickPerAngleBlueprint(angleBlueprintsByName, angleObj.angle_name, blueprint);
        const _angleKey = normalizeAngleBlueprintKey(angleObj.angle_name);
        addLog('BlueprintAngle', angleBlueprint
          ? `🎯 มุม "${angleObj.angle_name}" ใช้ Blueprint "${angleBlueprint.angle_blueprint?.angle_name || bpResult?.meta?.fallbackSourceAngleName || 'มุมแรก'}"${_perAngleBlueprintFailedKeys.has(_angleKey) ? ' (fallback)' : ''}`
          : `⚠️ มุม "${angleObj.angle_name}" ไม่มี Blueprint — เขียนต่อด้วย flow เดิม`);
      }
      const generationInput = {
        text: newsData.newsBody,
        rawSourceText: writerRawSourceText,
        newsTitle: newsData.newsTitle,
        breakdownData,
        sourceType: detectedType,
        mode: 'analyze',
        contentLength: selectedLength,
        presetPrompt: topPrompt,
        targetCount: count,
        emotionalBlueprint: angleBlueprint, // ★ สวิตช์ปิด = ตัวแปรนี้คือ blueprint ก้อนเดิมเป๊ะ (reference เดียวกัน)
        researchData: researchItems.length > 0 ? { items: researchItems } : null,
        factPool: factPool,
        focusAngle: writeAngle, // ★ มุมเล่า + สไตล์เปิดเรื่องบังคับของ angle นี้
        workflowId: _autoWorkflowId,
        deferAnalysisPersistence: true,
        user: _user,
        signal: stageSignal,
      };
      blueprintPlansForRepair[index] = generationInput.emotionalBlueprint;
      const genResult = await performSummarize(generationInput);
      
      return {
        ...genResult,
        _sourceLabel: angleObj.angle_name,
        _pIndex: index + 1,
        _researchItems: researchItems,
        _topPrompt: topPrompt
      };
    })(), 420000, `generate_A${index + 1}`); // ★ 16 ก.ค. 69 (B4 review fix): 420s (เดิม 300s) — งบนี้ "แชร์" กัน
    // ระหว่าง performResearch (ไม่มี inner cap, ~30-60s) + write_inner 180s + write_fallback 90s + STAGE 2.5/prep
    // เดิม 300s: write ช้าชน inner 180s แล้ว fallback เหลือเวลาไม่พอ → มุมตายทั้งที่ fallback กำลังจะรอด
    // (มุมทั้งหมดวิ่งขนาน — wall-clock รวมไม่เพิ่มในเคสปกติ; เพดานงานทั้งใบมี AbortController 900s ที่ worker ครอบอยู่)
  });

  const genResults = await Promise.allSettled(generationTasks);
  for (const [angleIndex, settled] of genResults.entries()) {
    if (settled.status === 'rejected') {
      rethrowPipelineDeadline(settled.reason, `generate_A${angleIndex + 1}`);
    }
  }
  
  const allVersions = [];
  let primaryResult = null;
  let classicVersionCount = 0;
  let enhancedVersionCount = 0;
  const totalResearchItems = [];
  const angleFailures = [];
  const usedPresetByPromptId = new Map();

  genResults.forEach((res, angleIndex) => {
    const expectedAngle = finalAngleNames[angleIndex] || `มุม ${angleIndex + 1}`;
    if (res.status !== 'fulfilled' || !res.value?.success || !res.value.data) {
      const reason = res.reason?.message || res.reason || res.value?.error || 'Unknown Error';
      angleFailures.push(`${expectedAngle}: ${reason}`);
      addLog('Error', `❌ Generation Failed for "${expectedAngle}": ${reason}`);
      return;
    }

    const data = res.value.data;
    const rawVersions = data.versions;
    const writerModel = typeof data.usedModel === 'string' ? data.usedModel.trim() : '';
    const promptEntry = res.value._topPrompt;
    const promptId = promptEntry?.id === null || promptEntry?.id === undefined
      ? ''
      : String(promptEntry.id).trim();
    if (!Array.isArray(rawVersions) || rawVersions.length !== versionsPerAngle
        || !writerModel || !promptId) {
      const reason = `contract ไม่ครบ (versions=${Array.isArray(rawVersions) ? rawVersions.length : 'invalid'}/${versionsPerAngle}, model=${writerModel || '-'}, promptId=${promptId || '-'})`;
      angleFailures.push(`${expectedAngle}: ${reason}`);
      addLog('Error', `❌ Generation contract failed for "${expectedAngle}": ${reason}`);
      return;
    }

    const invalidVersion = rawVersions.findIndex(v => !v || typeof v !== 'object'
      || typeof v.title !== 'string' || !v.title.trim()
      || typeof v.content !== 'string' || !v.content.trim());
    if (invalidVersion >= 0) {
      const reason = `version ${invalidVersion + 1} ไม่มี title/content ที่ใช้งานได้`;
      angleFailures.push(`${expectedAngle}: ${reason}`);
      addLog('Error', `❌ Generation contract failed for "${expectedAngle}": ${reason}`);
      return;
    }

    if (!primaryResult) primaryResult = data;
    if (data.usedPreset && typeof data.usedPreset === 'object') {
      usedPresetByPromptId.set(promptId, data.usedPreset);
    }
    const researchItems = Array.isArray(res.value._researchItems) ? res.value._researchItems : [];
    const hasResearch = researchItems.length > 0;
    totalResearchItems.push(...researchItems);
    const versions = rawVersions.map((v, i) => {
      if (hasResearch) enhancedVersionCount++; else classicVersionCount++;
      const pIdx = res.value._pIndex;
      return {
        ...stampWriterModel(v, writerModel),
        _source: hasResearch ? 'enhanced' : 'classic',
        _sourceLabel: expectedAngle,
        promptId,
        style: v.style ? `[A${pIdx}] ${v.style}` : `A${pIdx}_v${i + 1}`,
      };
    });
    allVersions.push(...versions);
  });

  if (angleFailures.length > 0 || allVersions.length !== totalVersions) {
    throwStep('auto_generate_contract', `ผลเขียนไม่ครบทุกมุม (${allVersions.length}/${totalVersions} เวอร์ชัน) — ${angleFailures.join(' | ') || 'จำนวนเวอร์ชันไม่ตรงแผน'}`);
  }

  addLog('Summary', `📊 รวมครบ ${allVersions.length}/${totalVersions} เวอร์ชัน (Classic: ${classicVersionCount}, Enhanced: ${enhancedVersionCount})`);
  if (blueprint) addLog('Summary', `🧬 Blueprint: ${blueprint.core_emotion}`);
  if (totalResearchItems.length) addLog('Summary', `🔍 Research: ${totalResearchItems.length} แหล่งข้อมูล`);

  let usedPreset = primaryResult.usedPreset || null;
  // ★ 16 ก.ค. 69 (B4): พอร์ต FIX จากสาย URL (autoFlowService.js:504) — breakdownData.primaryCategory มักมีค่าเสมอ
  //   ส่วน debug.newsTypeDetected ว่างเมื่อใช้ presetPrompt (Stage 1 ถูกข้าม = flow ปกติของคิว) → newsType เคยว่างทุกงาน
  const newsType = breakdownData?.primaryCategory || primaryResult.debug?.newsTypeDetected || '';
  if (newsType) addLog('Prompt', `🧠 AI วิเคราะห์: ข่าว${newsType}`);
  if (usedPreset?.source === 'library') {
    addLog('Prompt', `🏛️ ใช้ Library: "${usedPreset.name}" (Viral: ${usedPreset.viralScore || '-'})`);
  }
  if (primaryResult.debug?.promptMatchReason) {
    addLog('Prompt', `${primaryResult.debug.promptMatchReason}`);
  }

  // Correction เป็นด่านคุณภาพ: ถ้าด่านนี้ล้ม ให้รักษาร่างนักเขียนที่ยังครบไว้พร้อมคำเตือน
  // แล้วบังคับผ่าน factual gate จาก RAW เต็มด้านล่างเสมอ ห้ามถือ fallback ว่าเป็น factual pass
  const applyCorrectionFallback = (corrected, originals, label = 'Correction') => {
    const warnings = [];
    const safeCorrected = Array.isArray(corrected) ? corrected : [];
    const versions = originals.map((original, index) => {
      const candidate = safeCorrected[index];
      const valid = candidate && typeof candidate === 'object'
        && typeof candidate.title === 'string' && candidate.title.trim()
        && typeof candidate.content === 'string' && candidate.content.trim()
        && !candidate._correctionError
        && candidate.usedModel === original.usedModel
        && candidate._source === original._source
        && candidate._sourceLabel === original._sourceLabel
        && candidate.promptId === original.promptId;
      if (valid) return candidate;
      const reason = candidate?._correctionError
        || (!candidate ? 'ไม่คืนผลฉบับนี้' : 'ผลแก้ไม่ครบหรือ provenance เปลี่ยน');
      const warning = `${label} V${index + 1} ล้ม — ใช้ร่างนักเขียนเดิมและส่งเข้าด่าน RAW เต็ม (${reason})`;
      warnings.push(warning);
      return {
        ...original,
        _correctionApplied: false,
        _correctionWarning: warning,
        ...(Array.isArray(candidate?._blackbox) ? { _blackbox: candidate._blackbox } : {}),
      };
    });
    return { versions, warnings };
  };

  // === POST-GENERATION CORRECTION PIPELINE ===
  let finalVersions;
  const pipelineQualityWarnings = [];
  const correctionResearchFacts = (factPool?.facts || [])
    .map((x) => (typeof x === 'string' ? x : (x?.text || x?.content || '')))
    .filter(Boolean)
    .join('\n') || null;
  const groundingSourceText = (detectedType === 'text' || detectedType === 'plain_text')
    ? rawText
    : newsData.newsBody;
  try {
    // ★ 14 ส.ค. 69: ส่งข้อเท็จจริงรีเสิร์ชให้ด่าน L1.8 — ของจริงจากรีเสิร์ชไม่ใช่ "ของเกิน"
    finalVersions = await runCorrectionPipeline(
      allVersions,
      newsData,
      breakdownData,
      correctionResearchFacts,
      groundingSourceText,
    );
    const correctionOutcome = applyCorrectionFallback(finalVersions, allVersions);
    finalVersions = correctionOutcome.versions;
    pipelineQualityWarnings.push(...correctionOutcome.warnings);
    addLog('Correction', `🔧 Correction Pipeline: ${finalVersions.filter(v => v._correctionApplied).length}/${finalVersions.length} corrected${correctionOutcome.warnings.length ? ` · fallback ${correctionOutcome.warnings.length}` : ''}`);
  } catch (corrErr) {
    rethrowPipelineDeadline(corrErr, 'correction');
    const correctionOutcome = applyCorrectionFallback(
      allVersions.map(version => ({ ...version, _correctionError: corrErr?.message || String(corrErr) })),
      allVersions,
    );
    finalVersions = correctionOutcome.versions;
    pipelineQualityWarnings.push(...correctionOutcome.warnings);
    addLog('Quality', `⚠️ Correction pipeline ล้มทั้งชุด — ใช้ร่างนักเขียนเดิม ${allVersions.length} ฉบับ แล้วตรวจ RAW เต็มต่อ`);
  }

  // ด่านสุดท้ายก่อนบันทึก: ข่าวจากข้อความดิบห้ามเขียนเหมือนไปยืนเห็นเอง
  // และข้อความด้านสุขภาพต้องคงที่มาของคำกล่าวไว้ ห้ามแปลงเป็นคำแนะนำทั่วไป
  // Plain-text jobs must be grounded against the user's immutable paste, not the AI extraction.
  // URL/transcript jobs keep their existing extracted-body authority outside this scoped fix.
  let grounding = assessRawTextSafety(finalVersions, groundingSourceText);
  let groundingWarnings = groundingIssuesToWarnings(grounding.issues);
  pipelineQualityWarnings.push(...groundingWarnings);
  if (groundingWarnings.length > 0) {
    addLog('Quality', `⚠️ Grounding พบ ${groundingWarnings.length} จุดให้พนักงานตรวจ — ไม่ทิ้งข่าวและไม่เรียกนักเขียนซ้ำ`);
  }

  // ความคล้ายเป็นคำเตือนสำหรับพนักงาน ไม่ใช่เหตุให้เสีย API เขียนใหม่อัตโนมัติ
  // พนักงานเป็นผู้เลือกจาก 2 ฉบับเดิม จึงรักษาผลงานนักเขียนและ provenance ไว้ครบ
  const diversity = assessVersionDiversity(finalVersions);
  let diversityWarning = '';
  ({ versions: finalVersions, warning: diversityWarning } = annotateDiversityWarning(finalVersions, diversity));
  if (diversityWarning) {
    pipelineQualityWarnings.push(diversityWarning);
    addLog('Quality', `⚠️ ${diversityWarning}`);
  } else {
    addLog('Quality', `${groundingWarnings.length > 0 ? '⚠️ Grounding ผ่านแบบมีคำเตือน' : '✅ Grounding ผ่าน'} · ความซ้ำสูงสุด ${Math.round(diversity.maxSimilarity * 100)}%`);
  }

  // === FULL-RAW FACTUAL GATE (plain text only) ===
  // ตรวจเฉพาะ content ที่พนักงานโพสต์จริง หากผิดให้ Sol แก้ทุกฉบับพร้อมกันหนึ่งครั้ง
  // ห้ามเรียก writer/Fable ซ้ำและห้ามวนซ่อม เพื่อจำกัดค่า API แบบพิสูจน์ call-count ได้
  let factualGateSummary = null;
  let textLengthGateSummary = null;
  if ((detectedType === 'text' || detectedType === 'plain_text') && isRawFactCompletenessGateEnabled()) {
    try {
      const factOutcome = await enforceRawFactCompleteness({
        rawText,
        versions: finalVersions,
      });
      const failingIndexes = factOutcome.finalAudit.failingVersionIndexes;
      const issueDiagnostics = factOutcome.finalAudit.issues.map(issue => ({
        version: issue.versionIndex + 1,
        scope: issue.scope,
        reasonCode: issue.reasonCode,
      }));
      const missingDiagnostics = factOutcome.finalAudit.missingFacts.map(item => ({
        version: item.versionIndex + 1,
        reasonCode: 'MISSING_FACT',
      }));
      if (failingIndexes.length > 0) {
        // ข้อความจริงเก็บเฉพาะใน secure runtime log เพื่อให้ตรวจเหตุผลได้ ไม่เปิดผ่าน workflow API
        console.warn('[FactGate] final rejected claims', JSON.stringify({
          workflowId: _autoWorkflowId,
          issues: factOutcome.finalAudit.issues.map(issue => ({
            version: issue.versionIndex + 1,
            scope: issue.scope,
            reasonCode: issue.reasonCode,
            original: issue.original,
            reason: issue.reason,
          })),
          missingFacts: factOutcome.finalAudit.missingFacts.map(item => ({
            version: item.versionIndex + 1,
            rawExcerpt: item.rawExcerpt,
            reason: item.reason,
          })),
        }));
      }
      factualGateSummary = {
        status: failingIndexes.length > 0 ? 'partial' : 'passed',
        model: factOutcome.finalAudit.model,
        contextHash: factOutcome.finalAudit.contextHash,
        editorModel: factOutcome.repairedIndexes.length > 0 ? 'gpt-5.6-sol' : null,
        repairedVersions: factOutcome.repairedIndexes.map(index => index + 1),
        quarantinedVersions: failingIndexes.map(index => index + 1),
        diagnostics: [...issueDiagnostics, ...missingDiagnostics],
      };
      if (factOutcome.passingVersions.length === 0) {
        const reviewDiagnostic = {
          ...factualGateSummary,
          status: 'factual_review',
          publishable: false,
          contextHash: factOutcome.finalAudit.contextHash,
        };
        await persistFactualReviewOrThrow({
          workflowId: _autoWorkflowId,
          diagnostic: reviewDiagnostic,
          save: saveFactualReview,
        });
        const reviewError = new Error('ไม่มีฉบับที่ผ่านด่านข้อเท็จจริง เนื้อข่าวถูกกักไว้ให้ตรวจและไม่ถูกส่งออก');
        reviewError.code = 'FACTUAL_REVIEW_REQUIRED';
        reviewError.errorType = 'FACTUAL_REVIEW_REQUIRED';
        reviewError.failedStep = 'auto_factual_gate';
        throw reviewError;
      }

      finalVersions = factOutcome.passingVersions;
      if (failingIndexes.length > 0) {
        const warning = `Sol กักฉบับที่ไม่ผ่านข้อเท็จจริง ${failingIndexes.map(index => `V${index + 1}`).join(', ')} · ส่งให้พนักงานเฉพาะ ${finalVersions.length} ฉบับที่ผ่าน`;
        pipelineQualityWarnings.push(warning);
        addLog('FactGate', `⚠️ ${warning}`);
      } else if (factOutcome.repairedIndexes.length > 0) {
        addLog('FactGate', `🛠️ Sol แก้ content แบบก้อนเดียว ${factOutcome.repairedIndexes.map(index => `V${index + 1}`).join(', ')} และตรวจ RAW ซ้ำผ่าน`);
      } else {
        addLog('FactGate', '✅ Sol ตรวจเนื้อโพสต์ทุกย่อหน้ากับ RAW เต็มผ่านทุกฉบับ');
      }

      if (factOutcome.repairedIndexes.length > 0) {
        pipelineQualityWarnings.splice(
          0,
          pipelineQualityWarnings.length,
          ...pipelineQualityWarnings.filter(warning => !groundingWarnings.includes(warning)),
        );
        grounding = assessRawTextSafety(finalVersions, rawText);
        groundingWarnings = groundingIssuesToWarnings(grounding.issues);
        pipelineQualityWarnings.push(...groundingWarnings);

        const postFactDiversity = assessVersionDiversity(finalVersions);
        pipelineQualityWarnings.splice(0, pipelineQualityWarnings.length,
          ...pipelineQualityWarnings.filter(warning => warning !== diversityWarning));
        finalVersions = finalVersions.map(version => {
          const { _diversityWarning, ...withoutOldWarning } = version;
          return withoutOldWarning;
        });
        diversityWarning = '';
        if (!postFactDiversity.ok) {
          ({ versions: finalVersions, warning: diversityWarning } = annotateDiversityWarning(
            finalVersions,
            postFactDiversity,
            `${finalVersions.length} เวอร์ชันหลัง factual editor`,
          ));
          pipelineQualityWarnings.push(diversityWarning);
          addLog('Quality', `⚠️ ${diversityWarning}`);
        }
      }
    } catch (factError) {
      if (factError?.failedStep || factError?.errorType === 'FACTUAL_REVIEW_REQUIRED') throw factError;
      throwStep('auto_factual_gate', `ด่านตรวจ RAW เต็มไม่ผ่าน: ${factError?.message || factError}`);
    }
  } else if (detectedType === 'text' || detectedType === 'plain_text') {
    addLog('FactGate', '⏭️ ปิดด่าน Sol ตรวจ RAW ชั่วคราวด้วย RAW_FACT_COMPLETENESS_GATE=0');
  }

  // === FINAL TEXT PUBLICATION FLOOR ===
  // Writer อาจทำตามพื้น 146 แล้ว แต่ correction/factual editor เปลี่ยน content ภายหลังได้
  // จึงตรวจข้อความที่พนักงานโพสต์จริงตรงนี้เป็นด่านสุดท้าย: กักทั้งฉบับ ห้าม pad/rerun AI
  // LEGACY_LENGTH_RULES=1 ต้องถอยพฤติกรรมเดิมครบ และท่อ URL ไม่ผ่าน service TEXT นี้อยู่แล้ว
  if ((detectedType === 'text' || detectedType === 'plain_text') && !isLegacyLengthOn()) {
    const lengthOutcome = enforceTextNewsPublicationFloor(finalVersions, {
      minimumWords: NEW_LENGTH_CFG.min,
    });
    finalVersions = lengthOutcome.passingVersions;
    textLengthGateSummary = {
      status: lengthOutcome.status,
      publishable: true,
      minimumWords: lengthOutcome.minimumWords,
      checks: lengthOutcome.checks,
      quarantinedVersions: lengthOutcome.checks
        .filter(check => !check.passes)
        .map(check => check.version),
    };
    if (lengthOutcome.quarantinedVersions.length > 0) {
      const rejected = lengthOutcome.checks
        .filter(check => !check.passes)
        .map(check => `V${check.version} (${check.wordCount} คำ)`)
        .join(', ');
      const warning = `กักฉบับหลังตรวจที่สั้นกว่าขั้นต่ำ ${NEW_LENGTH_CFG.min} คำ: ${rejected} · ส่งเฉพาะ ${finalVersions.length} ฉบับที่ผ่าน โดยไม่เติมคำหรือเรียก AI ซ้ำ`;
      pipelineQualityWarnings.push(warning);
      addLog('LengthGate', `⚠️ ${warning}`);
    } else {
      addLog('LengthGate', `✅ ผลสุดท้ายทุกฉบับยาวอย่างน้อย ${NEW_LENGTH_CFG.min} คำ · ไม่มีเพดานสูงสุด`);
    }
  }

  ({ classic: classicVersionCount, enhanced: enhancedVersionCount } = countFinalVersionSources(finalVersions));
  usedPreset = resolveFinalUsedPreset(finalVersions, usedPresetByPromptId, usedPreset);

  const usedModels = [...new Set(finalVersions.map(version => version.usedModel).filter(Boolean))];
  if (usedModels.length === 0) {
    throwStep('auto_generate_contract', 'ไม่พบชื่อโมเดลผู้เขียนจริงในผลลัพธ์');
  }
  const aggregateUsedModel = usedModels.length === 1 ? usedModels[0] : 'mixed';
  const prePersistTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // === WORKFLOW FINAL SNAPSHOT ===
  // AutoFlow ปิดการบันทึกร่างชั่วคราวของ writer ทุกสายไว้
  // จุดนี้เป็นผู้มีอำนาจสุดท้ายเพียงครั้งเดียว: เก็บทุกฉบับหลัง correction/grounding/diversity/factual audit ผ่านแล้ว
  const analysisResult = buildPublishableAnalysisResult({
    primaryResult,
    usedPreset,
    usedModel: aggregateUsedModel,
    usedModels,
    versions: finalVersions,
    researchItems: totalResearchItems,
    qualityWarnings: [...new Set(pipelineQualityWarnings.filter(Boolean))],
    factualGate: factualGateSummary,
    lengthGate: textLengthGateSummary,
  });
  const finalPresetId = usedPreset?.promptId || finalVersions[0]?.promptId
    || anglePrompts[0]?.id || usedPreset?.id || 'library';
  getActivePipelineDeadline()?.throwIfExpired('final_workflow_persist');
  let finalWorkflowSave;
  try {
    finalWorkflowSave = await saveAnalysis(_autoWorkflowId, analysisResult, finalPresetId);
    getActivePipelineDeadline()?.throwIfExpired('final_workflow_persist');
  } catch (workflowSaveError) {
    rethrowPipelineDeadline(workflowSaveError, 'final_workflow_persist');
    throwStep('auto_workflow_persist', `บันทึกผล workflow สุดท้ายไม่สำเร็จ: ${workflowSaveError.message || workflowSaveError}`);
  }
  if (!finalWorkflowSave) {
    throwStep('auto_workflow_persist', 'บันทึกผล workflow สุดท้ายไม่สำเร็จ: ไม่พบแถว workflow ที่อัปเดต');
  }
  addLog('Workflow', `💾 บันทึกผลสุดท้ายครบ ${finalVersions.length} เวอร์ชัน`);

  // === GENERATION LOG: บันทึกทุก case เข้าระบบ ===
  const generationLogAttempt = await settleTelemetryWithinReserve(() => logGeneration({
      newsTitle: newsData.newsTitle,
      sourceType: detectedType,
      sourceUrl: url || '',
      sourceText: rawText,
      versions: finalVersions,
      breakdownData,
      pipelineInfo: {
        blueprint: blueprint?.core_emotion || null,
        researchCount: totalResearchItems.length,
        factPoolEntity: factPool?.entityName || null,
        classicCount: classicVersionCount,
        enhancedCount: enhancedVersionCount,
        totalTime: parseFloat(prePersistTime),
        contentLength: selectedLength,
        // ★ 30 มิ.ย.: บันทึกพร้อมท์ที่ใช้จริง (ปิดจุดบอด — ท่อ text เดิมไม่บันทึก promptName)
        promptName: usedPreset?.promptName || usedPreset?.name || anglePrompts[0]?.promptName || '',
        promptSource: usedPreset?.promptSource || usedPreset?.source || (anglePrompts[0] ? 'library' : ''),
        promptScore: usedPreset?.matchScore ?? usedPreset?.viralScore ?? anglePrompts[0]?.viralScore ?? 0,
        promptMatchType: usedPreset?.matchType || (usedPreset?.isBorrowed ? 'BORROWED' : (anglePrompts[0] ? 'MATCHED' : '')),
        promptId: usedPreset?.promptId || anglePrompts[0]?.id || '',
        newsType: newsType || '',
        writerModels: usedModels,
        diversityWarning: diversityWarning || null,
        desk: deskMeta || null, // ★ ป้ายโต๊ะข่าว {newsId, lane, category, editor, editorIcon}
        // ★ 16 ก.ค. 69 (B4): พอร์ตจากสาย URL — เดิม stepTimings มีเฉพาะใน return data ไม่เข้า Generation Log
        //   ทำสถิติ latency รายขั้นเอียงไปทางสาย URL ทั้งที่ตัวแปรมีครบอยู่แล้ว
        stepTimings: {
          detect: ((step1Start - step0Start) / 1000).toFixed(1),
          scrape: ((step2Start - step1Start) / 1000).toFixed(1),
          extract: ((step3Start - step2Start) / 1000).toFixed(1),
          breakdown: ((stepParallelStart - step3Start) / 1000).toFixed(1),
          // ★ 14 ส.ค. 69 (Sol 4a): เวลาจริงรายงาน — เดิมสองตัวนี้ใช้ช่วงขนานรวม = เลขซ้ำทุกเคส
          blueprint: _taskElapsed.blueprint != null ? (_taskElapsed.blueprint / 1000).toFixed(1) : null,
          research: _taskElapsed.research != null ? (_taskElapsed.research / 1000).toFixed(1) : null,
          generate: ((Date.now() - stepGenStart) / 1000).toFixed(1),
        },
      },
      userId: _user.userId,
    }));
  const generationLogResult = generationLogAttempt.status === 'completed'
    ? generationLogAttempt.value
    : {
        success: false,
        error: generationLogAttempt.error?.message
          || String(generationLogAttempt.error || generationLogAttempt.status),
      };
  if (generationLogResult?.success) {
    addLog('GenLog', `📋 บันทึก Generation Log สำเร็จ (${generationLogResult.caseId})`);
  } else {
    // ข่าวถูกเขียน ตรวจ และบันทึก workflow สำเร็จแล้ว — สมุดสถิติล้มต้องไม่ทิ้งข่าวจนเสีย API ยิงใหม่
    addLog('GenLog', `⚠️ บันทึก Generation Log ไม่สำเร็จ แต่ยังส่งข่าวที่เสร็จแล้ว: ${generationLogResult?.error || 'unknown error'}`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  addLog('Done', `✅ เสร็จสมบูรณ์ ${totalTime}s | ${finalVersions.length} เวอร์ชัน`);
  const finalDeadline = getActivePipelineDeadline();
  await settleTelemetryWithinReserve(
    () => logPipeline(
      { workflowId: _autoWorkflowId, step: 'auto-pipeline', status: 'success', duration: Date.now() - startTime, detail: `Total: ${totalTime}s | ${finalVersions.length} versions` },
      { signal: finalDeadline?.signal },
    ),
    { deadline: finalDeadline, maxWaitMs: 1_000, reserveMs: 7_000 },
  );

  return {
    success: true,
    data: {
      newsData,
      breakdownData,
      analysisResult,
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
      generationLog: {
        caseId: generationLogResult?.caseId || null,
        success: generationLogResult?.success === true,
        error: generationLogResult?.success ? null : (generationLogResult?.error || 'unknown error'),
      },
      usedPromptInfo: usedPreset ? {
        source: usedPreset.source,
        name: usedPreset.name,
        viralScore: usedPreset.viralScore || null,
        matchReason: primaryResult.debug?.promptMatchReason || '',
        newsType: newsType || '',
        // ★ 16 ก.ค. 69 (B5): ฟิลด์ตรวจย้อน — ส่งคะแนนจับคู่จริงทะลุถึง job_queue (เดิมถูกตัดทิ้งเป็นทอดๆ)
        promptName: usedPreset.promptName || '',
        promptId: usedPreset.promptId || null,
        promptSource: usedPreset.promptSource || usedPreset.source || '',
        matchScore: (typeof usedPreset.matchScore === 'number') ? usedPreset.matchScore : null,
        matchType: usedPreset.matchType || null,
        isBorrowed: usedPreset.isBorrowed || false,
        aiPickReason: usedPreset.aiPickReason || null, // ★ 1 ส.ค. (Opus P2-E): เหตุผล luna ต้องทะลุถึงกล่องดำ/job_queue จริง
      } : null,
      stepTimings: {
        detect: ((step1Start - step0Start) / 1000).toFixed(1),
        scrape: ((step2Start - step1Start) / 1000).toFixed(1),
        extract: ((step3Start - step2Start) / 1000).toFixed(1),
        breakdown: ((stepParallelStart - step3Start) / 1000).toFixed(1),
        // ★ 14 ส.ค. 69 (Sol 4a): เวลาจริงรายงาน — logger กับ response ใช้ก้อนเดียวกัน
        blueprint: _taskElapsed.blueprint != null ? (_taskElapsed.blueprint / 1000).toFixed(1) : null,
        research: _taskElapsed.research != null ? (_taskElapsed.research / 1000).toFixed(1) : null,
        generate: ((Date.now() - stepGenStart) / 1000).toFixed(1),
      },
      log,
    },
  };
}

// ชื่อโมเดลระดับ version ต้องมาจากผลของ client ไม่ใช่ JSON ที่ AI เขียนเอง
// วางหลัง spread เพื่อทับ usedModel ปลอม และรักษา provenance ของแต่ละ angle ตอนรวมผลขนาน
export function stampWriterModel(version, model) {
  return {
    ...version,
    usedModel: typeof model === 'string' ? model : '',
  };
}


/**
 * กำหนดตระกูลบทเปิดไม่ซ้ำต่อมุม โดยให้ hook จากการ์ดเป็นเทคนิครองเท่านั้น
 * การ์ดคนละใบในคลังอาจมี hookStyle เดียวกัน จึงห้ามให้การ์ดทับ family ที่จองไว้
 */
// ★ 2 ก.ย. 69 — สวิตช์ทดลองเปิดเรื่อง (ค่าเริ่มต้น = พฤติกรรมเดิม 100% · เจ้าของสั่ง 18 ส.ค. "ห้ามสั่งทับการ์ด" จึงไม่เปิดเอง)
//   ที่มา: เทสสนามจริงเคส #05234 V2 — มุมที่ 2 ถูกสัญญานี้บังคับตระกูล "ความต่าง" → นักเขียนเปิดเป็นฉากปัจจุบัน
//   ("สายโทรศัพท์กลางดึกยังดังขึ้นเสมอ") ทั้งที่พ่อเสียชีวิตแล้ว และไม่บอกว่าป๋าเดียร์คือใครจนประโยคที่ 3 → คนอ่านงง "สลับบริบท"
//   OPENING_FAMILY_CONTRACT=0 → เลิกบังคับตระกูลเปิดต่อมุม (การ์ด/ครูนำ · ยังกันแกนซ้ำกับมุมก่อน)
//   OPENING_IDENTITY_RULE=1  → เติมกติกา: 2 ประโยคแรกต้องบอก ใคร/อะไร/เมื่อไหร่ · ผู้ล่วงลับห้ามเล่าเป็นปัจจุบัน
export const OPENING_IDENTITY_RULE_TEXT = 'ไม่ว่าจะเปิดแบบไหน ภายในสองประโยคแรกคนอ่านต้องรู้ว่า ใคร (ชื่อจริง + ความสัมพันธ์หรือบทบาทตามต้นฉบับ) เกิดอะไร และเป็นเรื่องช่วงเวลาไหน — ถ้าต้นฉบับบอกว่าบุคคลเสียชีวิตแล้ว ห้ามเล่าเหมือนเหตุการณ์ยังเกิดอยู่ตอนนี้ (เช่น "ยัง…อยู่เสมอ") ให้เล่าเป็นความทรงจำหรืออดีตตั้งแต่ประโยคแรก';
export function buildAngleOpeningContract(index, cardHook = '', reservedAngles = [], tail = '') {
  const familyContractOff = process.env.OPENING_FAMILY_CONTRACT === '0';
  const identityRuleOn = process.env.OPENING_IDENTITY_RULE === '1';
  const families = [
    'เปิดด้วยภาพหรือการกระทำจริงที่อยู่ในต้นฉบับ แล้วพาคนอ่านเข้าเหตุการณ์ทันที',
    'เปิดด้วยตัวเลขหรือความต่างที่มีอยู่จริงในต้นฉบับ และเขียนเป็นประโยคสมบูรณ์',
    'เปิดด้วยคำพูดจริง หรือความรู้สึกที่อนุมานตรงจากเหตุการณ์โดยไม่เสกฉาก',
    'เปิดด้วยผลลัพธ์หรือปลายทางจริงของเรื่องก่อน แล้วค่อยย้อนเล่าที่มา',
  ];
  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  const primaryFamily = families[safeIndex % families.length];
  const cleanHook = String(cardHook || '').replace(/\s+/gu, ' ').trim();
  const cleanReserved = (Array.isArray(reservedAngles) ? reservedAngles : [])
    .map(value => String(value || '').replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  return [
    familyContractOff ? '' : `${primaryFamily}${String(tail || '')} — นี่คือตระกูลเปิดหลัก ห้ามเปลี่ยนไปใช้ตระกูลของมุมอื่น`,
    cleanHook
      ? (familyContractOff ? `เทคนิคเปิดเรื่องจากการ์ด (แนวทาง ไม่ใช่คำสั่งทับ): ${cleanHook}` : `เทคนิคจากการ์ดใช้ปรับจังหวะภายในตระกูลนี้เท่านั้น: ${cleanHook}`)
      : '',
    cleanReserved.length > 0
      ? `แกนที่มุมก่อนหน้าจองใช้เปิดแล้ว ห้ามใช้เป็นแกนประโยคแรกซ้ำ: ${cleanReserved.join(' | ')}`
      : '',
    identityRuleOn ? OPENING_IDENTITY_RULE_TEXT : '',
  ].filter(Boolean).join('\n');
}

/** ตรวจความซ้ำข้ามเวอร์ชันด้วย Thai character 5-gram + หัว/ท้ายซ้ำตรง */
export function assessVersionDiversity(versions) {
  const list = Array.isArray(versions) ? versions : [];
  // ภาษาไทยมีสระ/วรรณยุกต์เป็น Unicode Mark — ต้องเก็บ \p{M} ไว้ ไม่งั้นหัว/ท้ายซ้ำจริงจะเลื่อนแล้วหลุดรอด
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
  const grams = value => {
    const out = new Set();
    for (let i = 0; i + 5 <= value.length; i++) out.add(value.slice(i, i + 5));
    return out;
  };
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const left = normalize(list[i]?.content);
      const right = normalize(list[j]?.content);
      const a = grams(left), b = grams(right);
      let shared = 0;
      for (const gram of a) if (b.has(gram)) shared++;
      const similarity = shared / Math.max(1, a.size + b.size - shared);
      const sameOpening = left.length >= 30 && right.length >= 30 && left.slice(0, 30) === right.slice(0, 30);
      const sameClosing = left.length >= 30 && right.length >= 30 && left.slice(-30) === right.slice(-30);
      const threshold = Math.min(left.length, right.length) >= 300 ? 0.37 : 0.5;
      pairs.push({
        left: i,
        right: j,
        similarity,
        sameOpening,
        sameClosing,
        tooSimilar: sameOpening || sameClosing || similarity >= threshold,
      });
    }
  }
  return {
    ok: pairs.every(pair => !pair.tooSimilar),
    maxSimilarity: pairs.reduce((max, pair) => Math.max(max, pair.similarity), 0),
    pairs,
  };
}

/** ติดคำเตือนความคล้ายโดยไม่เรียก AI เขียนซ้ำ และไม่เปลี่ยนเนื้อหา/provenance เดิม */
export function annotateDiversityWarning(versions, report, label = '2 เวอร์ชันยังคล้ายกัน') {
  const list = Array.isArray(versions) ? versions : [];
  if (report?.ok) return { versions: list, warning: '' };
  const worst = Array.isArray(report?.pairs)
    ? report.pairs.find(pair => pair?.tooSimilar)
    : null;
  const details = [
    `${Math.round((Number(worst?.similarity) || 0) * 100)}%`,
    worst?.sameOpening ? 'เปิดซ้ำ' : '',
    worst?.sameClosing ? 'จบซ้ำ' : '',
  ].filter(Boolean).join(' · ');
  const warning = `${label} ${details} — ส่งฉบับเดิมให้พนักงานอ่านเลือกโดยไม่เขียนซ้ำ เพื่อลดเวลาและค่า API`;
  return {
    versions: list.map(version => ({ ...version, _diversityWarning: warning })),
    warning,
  };
}

/** ด่านเสี่ยงที่ตรวจได้แบบแน่นอนจากข้อความดิบ โดยไม่เปิดตัวผ่าข่าวเก่า */
export function assessRawTextSafety(versions, sourceText) {
  const list = Array.isArray(versions) ? versions : [];
  const source = String(sourceText || '');
  const issues = [];
  const witnessFrame = /ภาพ[^\n.!?ฯ]{0,180}(?:เล่าเรื่อง|บอกเล่า|พูดแทน|ชัดกว่า|มากกว่าคำ)/u;
  const healthBenefit = /(?:กิน|รับประทาน|อาหาร|เครื่องดื่ม|สมุนไพร|วิตามิน|ช็อกโกแลต|ใช้ยา|ให้ยา|(?<!\p{Script=Thai})ยา)[^\n.!?ฯ]{0,180}(?:ช่วย(?:ให้)?|รักษา|ป้องกัน|ลดอาการ|ลดความเสี่ยง|ส่งเสริม|บำรุง|ทำให้ดีขึ้น|ทำให้หาย)/u;
  const attribution = /(?:เล่าว่า|เผยว่า|ระบุว่า|บอกว่า|กล่าวว่า|อธิบายว่า|ได้รับคำแนะนำ|คำแนะนำให้|ตามคำแนะนำ|แพทย์แนะนำ|ผู้เชี่ยวชาญ)/u;
  const healthComparableText = (text) => String(text || '').replace(/\./gu, ' ');
  const splitHealthClauses = (text) => String(text || '')
    // ห้ามแยกด้วยจุด: เวลา 19.00 น. จะทำให้ที่มากับประโยชน์สุขภาพขาดจากกัน
    .split(/\n+|[!?ฯ]+|\s*(?:แต่|ขณะที่|ส่วน)\s*/u)
    .map(part => part.trim())
    .filter(Boolean);
  const healthClaimKey = (paragraph) => {
    const comparable = healthComparableText(paragraph);
    if (!healthBenefit.test(comparable)) return '';
    const categories = [
      ['ช็อกโกแลต', /ช็อกโกแลต/u], ['วิตามิน', /วิตามิน/u], ['สมุนไพร', /สมุนไพร/u],
      ['เครื่องดื่ม', /เครื่องดื่ม/u], ['อาหาร', /อาหาร/u],
      ['ยา', /(?:ใช้ยา|ให้ยา|(?<!\p{Script=Thai})ยา)/u],
      ['รับประทาน', /รับประทาน/u], ['กิน', /กิน/u],
    ];
    const effects = [
      'ลดความเสี่ยง', 'ทำให้ดีขึ้น', 'ทำให้หาย', 'ลดอาการ', 'ช่วยให้',
      'รักษา', 'ป้องกัน', 'ส่งเสริม', 'บำรุง', 'ช่วย',
    ];
    const category = categories.find(([, pattern]) => pattern.test(comparable))?.[0] || '';
    const effect = effects.find(term => comparable.includes(term)) || '';
    return category && effect ? `${category}|${effect}` : '';
  };
  const sleepFrequencies = ['ทุกคืน'];
  // ตรวจเฉพาะปริมาณอาหาร/ยาแบบแคบ ๆ — ไม่ไล่เทียบเลขทุกตัว เพราะอายุ เวลา และเงินเขียนต่างรูปได้โดยไม่ใช่ข้อเท็จจริงใหม่
  const thaiCounts = new Map([
    ['ศูนย์', '0'], ['หนึ่ง', '1'], ['สอง', '2'], ['สาม', '3'], ['สี่', '4'], ['ห้า', '5'],
    ['หก', '6'], ['เจ็ด', '7'], ['แปด', '8'], ['เก้า', '9'], ['สิบ', '10'], ['ครึ่ง', '0.5'],
  ]);
  const normalizeThaiDigits = (value) => String(value || '').replace(/[๐-๙]/gu, digit => String(digit.charCodeAt(0) - 0x0E50));
  const thaiDigitValues = new Map([
    ['ศูนย์', 0], ['หนึ่ง', 1], ['เอ็ด', 1], ['สอง', 2], ['ยี่', 2], ['สาม', 3],
    ['สี่', 4], ['ห้า', 5], ['หก', 6], ['เจ็ด', 7], ['แปด', 8], ['เก้า', 9],
  ]);
  const thaiPlaceValues = new Map([
    ['สิบ', 10], ['ร้อย', 100], ['พัน', 1000], ['หมื่น', 10000], ['แสน', 100000],
  ]);
  const parseThaiInteger = (part) => {
    const tokens = part.match(/ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|เอ็ด|ยี่|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน/gu) || [];
    if (tokens.length === 0 || tokens.join('') !== part) return null;
    let total = 0n;
    let section = 0n;
    let digit = 0n;
    for (const token of tokens) {
      if (thaiDigitValues.has(token)) {
        digit = BigInt(thaiDigitValues.get(token));
      } else if (thaiPlaceValues.has(token)) {
        section += (digit || 1n) * BigInt(thaiPlaceValues.get(token));
        digit = 0n;
      } else if (token === 'ล้าน') {
        total = (total + section + digit) * 1000000n;
        section = 0n;
        digit = 0n;
      }
    }
    return total + section + digit;
  };
  const vulgarFractionValues = new Map([
    ['¼', [1n, 4n]], ['½', [1n, 2n]], ['¾', [3n, 4n]], ['⅓', [1n, 3n]], ['⅔', [2n, 3n]],
    ['⅛', [1n, 8n]], ['⅜', [3n, 8n]], ['⅝', [5n, 8n]], ['⅞', [7n, 8n]],
  ]);
  const gcdBigInt = (left, right) => {
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b !== 0n) [a, b] = [b, a % b];
    return a || 1n;
  };
  const makeScalar = (numerator, denominator = 1n) => {
    if (denominator === 0n) return null;
    let n = BigInt(numerator);
    let d = BigInt(denominator);
    if (d < 0n) { n = -n; d = -d; }
    const divisor = gcdBigInt(n, d);
    return { kind: 'scalar', numerator: n / divisor, denominator: d / divisor };
  };
  const isScalar = value => value?.kind === 'scalar';
  const addScalars = (left, right) => (isScalar(left) && isScalar(right)
    ? makeScalar(
      left.numerator * right.denominator + right.numerator * left.denominator,
      left.denominator * right.denominator,
    )
    : null);
  const divideScalars = (left, right) => (isScalar(left) && isScalar(right) && right.numerator !== 0n
    ? makeScalar(left.numerator * right.denominator, left.denominator * right.numerator)
    : null);
  const multiplyScalar = (value, multiplier) => (isScalar(value)
    ? makeScalar(value.numerator * BigInt(multiplier), value.denominator)
    : null);
  const compareScalars = (left, right) => {
    const delta = left.numerator * right.denominator - right.numerator * left.denominator;
    return delta < 0n ? -1 : (delta > 0n ? 1 : 0);
  };
  const scalarFromNumericText = (value) => {
    let numericText = String(value || '').trim().toLowerCase();
    if (/^[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?(?:e[+-]?\d+)?$/u.test(numericText)) {
      numericText = numericText.replace(/,/gu, '');
    } else if (/^[0-9]+,[0-9]+(?:e[+-]?\d+)?$/u.test(numericText)) {
      numericText = numericText.replace(',', '.');
    }
    const match = numericText.match(/^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/u);
    if (!match || (!match[1] && !match[2])) return null;
    const exponent = match[3] ? Number(match[3]) : 0;
    // Bound allocation only; ordinary quantities remain exact well beyond any realistic news input.
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
    const integerDigits = match[1] || '0';
    const fractionDigits = match[2] || '';
    const digits = `${integerDigits}${fractionDigits}`.replace(/^0+(?=\d)/u, '') || '0';
    const scale = fractionDigits.length - exponent;
    if (scale >= 0) return makeScalar(BigInt(digits), 10n ** BigInt(scale));
    return makeScalar(BigInt(digits) * (10n ** BigInt(-scale)), 1n);
  };
  const wrapCount = (kind, value, inner) => (inner ? { kind: 'wrapper', wrapperKind: kind, value, inner } : null);
  const canonicalCount = (node) => {
    if (isScalar(node)) return `${node.numerator}/${node.denominator}`;
    if (node?.kind === 'pair') {
      return `${node.pairKind}(${node.values.map(canonicalCount).join(',')})`;
    }
    if (node?.kind === 'wrapper') {
      const wrappers = [];
      let inner = node;
      while (inner?.kind === 'wrapper') {
        wrappers.push(`${inner.wrapperKind}:${inner.value}`);
        inner = inner.inner;
      }
      wrappers.sort((a, b) => {
        const rank = value => value.startsWith('qual:') ? 0 : 1;
        return rank(a) - rank(b) || a.localeCompare(b);
      });
      return `${wrappers.join('>')}(${canonicalCount(inner)})`;
    }
    return '';
  };
  const mapCountScalars = (node, transform) => {
    if (isScalar(node)) return transform(node);
    if (node?.kind === 'pair') return { ...node, values: node.values.map(value => mapCountScalars(value, transform)) };
    if (node?.kind === 'wrapper') return { ...node, inner: mapCountScalars(node.inner, transform) };
    return null;
  };
  const normalizeCount = (value) => {
    const raw = normalizeThaiDigits(value).trim().toLowerCase().replace(/／/gu, '⁄');
    const normalizedPair = (left, right, tag) => {
      const first = normalizeCount(left);
      const second = normalizeCount(right);
      if (!isScalar(first) || !isScalar(second)) return null;
      const values = (tag === 'alt' || tag === 'and')
        ? [first, second].sort(compareScalars)
        : [first, second];
      return { kind: 'pair', pairKind: tag, values };
    };
    const scientificMatch = raw.match(/^(\d+(?:[,.]\d+)?)[e]([+-]?\d+)$/iu);
    if (scientificMatch) {
      // ให้ตัวแปลงฐานสิบตัวเดียวตัดสิน comma: 1,2e3 = 1.2e3 แต่ 1,234e3 = 1,234 x 10^3
      return scalarFromNumericText(raw);
    }
    const qualifierMatch = raw.match(/^(ไม่เกิน|ไม่มากกว่า|อย่างมาก|สูงสุด|ไม่น้อยกว่า|ไม่ต่ำกว่า|อย่างน้อย|มากกว่า|เกิน|น้อยกว่า|ต่ำกว่า|ไม่ถึง|ประมาณ|ราว|เฉลี่ย|เกือบ|[<>≤≥~≈])\s*(.+)$/u);
    if (qualifierMatch) {
      const qualifierAliases = new Map([
        ['ไม่เกิน', 'lte'], ['ไม่มากกว่า', 'lte'], ['อย่างมาก', 'lte'], ['สูงสุด', 'lte'], ['≤', 'lte'],
        ['ไม่น้อยกว่า', 'gte'], ['ไม่ต่ำกว่า', 'gte'], ['อย่างน้อย', 'gte'], ['≥', 'gte'],
        ['มากกว่า', 'gt'], ['เกิน', 'gt'], ['>', 'gt'], ['น้อยกว่า', 'lt'], ['ต่ำกว่า', 'lt'], ['ไม่ถึง', 'lt'], ['<', 'lt'],
        ['ประมาณ', 'approx'], ['ราว', 'approx'], ['~', 'approx'], ['≈', 'approx'],
        ['เฉลี่ย', 'average'], ['เกือบ', 'nearly'],
      ]);
      const count = normalizeCount(qualifierMatch[2]);
      return wrapCount('qual', qualifierAliases.get(qualifierMatch[1]), count);
    }
    const frequencyMatch = raw.match(/^(วันละ|ครั้งละ|มื้อละ)\s*(.+)$/u);
    if (frequencyMatch) {
      const frequencyAliases = new Map([['วันละ', 'daily'], ['ครั้งละ', 'per-time'], ['มื้อละ', 'per-meal']]);
      const count = normalizeCount(frequencyMatch[2]);
      return wrapCount('freq', frequencyAliases.get(frequencyMatch[1]), count);
    }
    const betweenMatch = raw.match(/^ระหว่าง\s*(.+?)\s*กับ\s*(.+)$/u);
    if (betweenMatch) return normalizedPair(betweenMatch[1], betweenMatch[2], 'range');
    const alternativeMatch = raw.match(/^(.+?)\s*หรือ\s*(.+)$/u);
    if (alternativeMatch) return normalizedPair(alternativeMatch[1], alternativeMatch[2], 'alt');
    const conjunctionMatch = raw.match(/^(.+?)\s*และ\s*(.+)$/u);
    if (conjunctionMatch) return normalizedPair(conjunctionMatch[1], conjunctionMatch[2], 'and');
    const plusMinusMatch = raw.match(/^(.+?)\s*±\s*(.+)$/u);
    if (plusMinusMatch) return normalizedPair(plusMinusMatch[1], plusMinusMatch[2], 'plusminus');
    const ratioMatch = raw.match(/^(.+?)\s*:\s*(.+)$/u);
    if (ratioMatch) return normalizedPair(ratioMatch[1], ratioMatch[2], 'ratio');
    const multiplicationMatch = raw.match(/^(.+?)\s*×\s*(.+)$/u);
    if (multiplicationMatch) return normalizedPair(multiplicationMatch[1], multiplicationMatch[2], 'times');
    const rangeMatch = raw.match(/^(.+?)\s*(?:-|‐|‑|‒|–|—|−|ถึง)\s*(.+)$/u);
    if (rangeMatch) return normalizedPair(rangeMatch[1], rangeMatch[2], 'range');
    const mixedFractionMatch = raw.match(/^(.+?)\s+(.+?)\s*[\/⁄]\s*(.+)$/u);
    if (mixedFractionMatch) {
      const whole = normalizeCount(mixedFractionMatch[1]);
      const numerator = normalizeCount(mixedFractionMatch[2]);
      const denominator = normalizeCount(mixedFractionMatch[3]);
      return addScalars(whole, divideScalars(numerator, denominator));
    }
    const fractionMatch = raw.match(/^(.+?)\s*[\/⁄]\s*(.+)$/u);
    if (fractionMatch) {
      return divideScalars(normalizeCount(fractionMatch[1]), normalizeCount(fractionMatch[2]));
    }
    const thaiFractionMatch = raw.match(/^(.+?)ส่วน(.+)$/u);
    if (thaiFractionMatch) {
      return divideScalars(normalizeCount(thaiFractionMatch[1]), normalizeCount(thaiFractionMatch[2]));
    }
    const vulgarFractionMatch = raw.match(/^(.*?)([¼½¾⅓⅔⅛⅜⅝⅞])$/u);
    if (vulgarFractionMatch) {
      const wholeText = vulgarFractionMatch[1].trim();
      const whole = wholeText ? normalizeCount(wholeText) : makeScalar(0n);
      const fractionParts = vulgarFractionValues.get(vulgarFractionMatch[2]);
      const fraction = fractionParts ? makeScalar(fractionParts[0], fractionParts[1]) : null;
      return addScalars(whole, fraction);
    }
    if (thaiCounts.has(raw)) return scalarFromNumericText(thaiCounts.get(raw));
    const decimalParts = raw.split('จุด');
    if (decimalParts.length === 2) {
      const whole = decimalParts[0] ? parseThaiInteger(decimalParts[0]) : 0n;
      const fractionTokens = decimalParts[1].match(/ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|เอ็ด|ยี่/gu) || [];
      if (whole !== null && fractionTokens.length > 0 && fractionTokens.join('') === decimalParts[1]) {
        const fraction = fractionTokens.map(token => thaiDigitValues.get(token)).join('');
        return scalarFromNumericText(`${whole}.${fraction}`);
      }
      const fractionInteger = parseThaiInteger(decimalParts[1]);
      if (whole !== null && fractionInteger !== null) {
        return scalarFromNumericText(`${whole}.${fractionInteger}`);
      }
    }
    const thaiInteger = parseThaiInteger(raw);
    if (thaiInteger !== null) return makeScalar(thaiInteger);
    return scalarFromNumericText(raw);
  };
  const normalizeUnit = (value) => {
    const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    if (/^(?:มิลลิลิตร|ซีซี|มล\.?|ml|cc)$/u.test(raw)) return 'ml';
    if (/^(?:มิลลิกรัม|มก\.?|mg)$/u.test(raw)) return 'mg';
    return raw.replace(/\.$/u, '');
  };
  const consumableQuantities = (text) => {
    const claims = [];
    const categories = ['ช็อกโกแลต', 'อาหารเสริม', 'เครื่องดื่ม', 'วิตามิน', 'กาแฟ', 'น้ำ', 'นม', 'ชา', 'ยา'];
    const shortCategories = new Set(['น้ำ', 'นม', 'ชา', 'ยา']);
    const thaiLetter = /\p{Script=Thai}/u;
    const thaiIntegerWordPattern = '(?:(?:ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|เอ็ด|ยี่|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน))+';
    const thaiNumberWordPattern = `(?:${thaiIntegerWordPattern}(?:จุด${thaiIntegerWordPattern})?|จุด${thaiIntegerWordPattern})`;
    const fractionIntegerPattern = `(?:\\d+|${thaiIntegerWordPattern})`;
    const slashFractionPattern = `(?:${fractionIntegerPattern})\\s*[\\/⁄／]\\s*(?:${fractionIntegerPattern})`;
    const thaiFractionPattern = `(?:${thaiIntegerWordPattern})ส่วน(?:${thaiIntegerWordPattern})`;
    const vulgarFractionPattern = '(?:\\d+\\s*)?[¼½¾⅓⅔⅛⅜⅝⅞]';
    const mixedFractionPattern = `(?:${fractionIntegerPattern})\\s+(?:${slashFractionPattern})`;
    const scientificPattern = '\\d+(?:[,.]\\d+)?[eE][+-]?\\d+';
    const scalarCountPattern = `(?:${mixedFractionPattern}|${slashFractionPattern}|${thaiFractionPattern}|${vulgarFractionPattern}|${scientificPattern}|\\d+(?:[,.]\\d+)*|\\.\\d+|ครึ่ง|${thaiNumberWordPattern})`;
    const rangeCountPattern = `(?:${scalarCountPattern})\\s*(?:-|‐|‑|‒|–|—|−|ถึง)\\s*(?:${scalarCountPattern})`;
    const betweenCountPattern = `ระหว่าง\\s*(?:${scalarCountPattern})\\s*กับ\\s*(?:${scalarCountPattern})`;
    const alternativeCountPattern = `(?:${scalarCountPattern})\\s*หรือ\\s*(?:${scalarCountPattern})`;
    const conjunctionCountPattern = `(?:${scalarCountPattern})\\s*และ\\s*(?:${scalarCountPattern})`;
    const plusMinusCountPattern = `(?:${scalarCountPattern})\\s*±\\s*(?:${scalarCountPattern})`;
    const ratioCountPattern = `(?:${scalarCountPattern})\\s*[:×]\\s*(?:${scalarCountPattern})`;
    const compoundCountPattern = `(?:${betweenCountPattern}|${alternativeCountPattern}|${conjunctionCountPattern}|${plusMinusCountPattern}|${ratioCountPattern}|${rangeCountPattern}|${scalarCountPattern})`;
    const frequencyPrefixPattern = '(?:วันละ|ครั้งละ|มื้อละ)';
    const qualifierPrefixPattern = '(?:ไม่เกิน|ไม่มากกว่า|อย่างมาก|สูงสุด|ไม่น้อยกว่า|ไม่ต่ำกว่า|อย่างน้อย|มากกว่า|เกิน|น้อยกว่า|ต่ำกว่า|ไม่ถึง|ประมาณ|ราว|เฉลี่ย|เกือบ|[<>≤≥~≈])';
    const frequencyCountPattern = `${frequencyPrefixPattern}\\s*(?:${compoundCountPattern})`;
    const qualifiedCountPattern = `${qualifierPrefixPattern}\\s*(?:${frequencyCountPattern}|${compoundCountPattern})`;
    const frequencyQualifiedCountPattern = `${frequencyPrefixPattern}\\s*(?:${qualifierPrefixPattern}\\s*(?:${compoundCountPattern}))`;
    const quantityCountPattern = `(?:${qualifiedCountPattern}|${frequencyQualifiedCountPattern}|${frequencyCountPattern}|${compoundCountPattern})`;
    const quantityUnitPattern = '(?:มิลลิลิตร|มิลลิกรัม|ช้อนโต๊ะ|ช้อนชา|แคปซูล|ลิตร|กล่อง|ช็อต|หยด|ชิ้น|เม็ด|ซอง|แท่ง|แก้ว|ขวด|ซีซี|มล\\.?|ml|cc|กรัม|มก\\.?|mg)';
    const postfixQualifierPattern = '(?:โดยประมาณ|โดยเฉลี่ย|ประมาณ|โดยราว)';
    const postfixQualifierAliases = new Map([['โดยประมาณ', 'approx'], ['ประมาณ', 'approx'], ['โดยราว', 'approx'], ['โดยเฉลี่ย', 'average']]);
    const amountAndUnit = new RegExp(`(${quantityCountPattern})\\s*(${quantityUnitPattern})(?:\\s*(ครึ่ง))?(?:\\s*(${postfixQualifierPattern}))?`, 'giu');
    const partialNumericPrefixPattern = new RegExp(`(?:(?:(?:\\d+(?:[.,]\\d+)*|${thaiNumberWordPattern})\\s*)(?:[.,:×\\/⁄／+<>=≤≥~≈±\\-‐‑‒–—−]|จุด|ถึง|บวก|หรือ|และ|กับ|ส่วน|e)|(?:[.,:×\\/⁄／+<>=≤≥~≈±\\-‐‑‒–—−]|จุด|ถึง|บวก|ส่วน|e|ประมาณ|ราว|เฉลี่ย|เกือบ|วันละ|ครั้งละ|มื้อละ))\\s*$`, 'iu');
    const thaiWordSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('th', { granularity: 'word' })
      : null;
    const categoryModifierRules = new Map([
      ['ช็อกโกแลต', /^(?:|ดาร์ก|นม|ร้อน|เย็น|สำหรับสุขภาพ)$/u],
      ['อาหารเสริม', /^(?:|สุขภาพ|ชนิดผง|ชนิดเม็ด|แบบผง|แบบเม็ด|โปรตีน)$/u],
      ['เครื่องดื่ม', /^(?:|ชูกำลัง|เกลือแร่|เพื่อสุขภาพ|พร้อมดื่ม)$/u],
      ['วิตามิน', /^(?:|(?:เอ|บี|ซี|ดี|อี|เค|a|b|c|d|e|k)(?:\d+)?|บีรวม|รวม)$/u],
      ['กาแฟ', /^(?:|ดำ|เย็น|ร้อน|นม|ลาเต้|เอสเปรสโซ|สำเร็จรูป)$/u],
      ['น้ำ', /^(?:|เปล่า|ดื่ม|แร่|มะพร้าว|ผลไม้|อัดลม|หวาน)$/u],
      ['นม', /^(?:|ถั่วเหลือง|วัว|แพะ|สด|จืด|เปรี้ยว|พร่องมันเนย|อัลมอนด์)$/u],
      ['ชา', /^(?:|เขียว|ดำ|ไทย|เย็น|นม|สมุนไพร|มะนาว)$/u],
      ['ยา', /^(?:|น้ำ|แก้(?:ไอ|ปวด(?:หัว|ท้อง|หลัง|ฟัน)?|ไข้|แพ้|ท้องเสีย|อักเสบ)|ลด(?:ไข้|กรด|น้ำมูก|ความดัน)|ฆ่าเชื้อ|พาราเซตามอล|นอนหลับ|คลายกล้ามเนื้อ)$/u],
    ]);
    const categoryUnits = new Map([
      ['ช็อกโกแลต', new Set(['ชิ้น', 'แท่ง', 'เม็ด', 'ซอง', 'กล่อง', 'แก้ว', 'ขวด', 'กรัม', 'mg', 'ml'])],
      ['อาหารเสริม', new Set(['เม็ด', 'แคปซูล', 'ซอง', 'กล่อง', 'หยด', 'ช้อนชา', 'ช้อนโต๊ะ', 'ขวด', 'กรัม', 'mg', 'ml'])],
      ['เครื่องดื่ม', new Set(['แก้ว', 'ขวด', 'กล่อง', 'ลิตร', 'ซอง', 'ช้อนชา', 'ช้อนโต๊ะ', 'กรัม', 'ml'])],
      ['วิตามิน', new Set(['เม็ด', 'แคปซูล', 'ซอง', 'กล่อง', 'หยด', 'ช้อนชา', 'ช้อนโต๊ะ', 'ขวด', 'กรัม', 'mg', 'ml'])],
      ['กาแฟ', new Set(['แก้ว', 'ขวด', 'กล่อง', 'ลิตร', 'ช็อต', 'ซอง', 'ช้อนชา', 'ช้อนโต๊ะ', 'กรัม', 'ml'])],
      ['น้ำ', new Set(['แก้ว', 'ขวด', 'กล่อง', 'ลิตร', 'ซอง', 'ช้อนชา', 'ช้อนโต๊ะ', 'กรัม', 'ml'])],
      ['นม', new Set(['แก้ว', 'ขวด', 'กล่อง', 'ลิตร', 'ซอง', 'ช้อนชา', 'ช้อนโต๊ะ', 'กรัม', 'ml'])],
      ['ชา', new Set(['แก้ว', 'ขวด', 'กล่อง', 'ลิตร', 'ซอง', 'ช้อนชา', 'ช้อนโต๊ะ', 'กรัม', 'ml'])],
      ['ยา', new Set(['เม็ด', 'แคปซูล', 'ซอง', 'กล่อง', 'หยด', 'ช้อนชา', 'ช้อนโต๊ะ', 'ขวด', 'กรัม', 'mg', 'ml'])],
    ]);
    const readyProductSuffix = /(?:พร้อมรับประทาน|พร้อมดื่ม|พร้อมทาน)$/u;
    const doseTimingPattern = `(?:ทุก\\s*(?:\\d+|${thaiIntegerWordPattern})\\s*(?:ชั่วโมง|ชม\\.?)|ก่อนนอน|หลังอาหาร|หลังมื้อ(?:เช้า|กลางวัน|เย็น)?|เมื่อมีอาการ|ตามอาการ|ก่อนเดินทาง|พร้อมอาหาร|ตอน(?:เช้า|สาย|กลางวัน|บ่าย|เย็น|ค่ำ|กลางคืน)|ทุกเช้า|ทุกคืน|ทุกวัน|ทุกมื้อ|ทุกสัปดาห์|วันเว้นวัน|เช้าและเย็น|ต่อวัน|ต่อสัปดาห์)`;
    const doseTimingSuffix = new RegExp(`(${doseTimingPattern})$`, 'u');
    const doseTimingPrefix = new RegExp(`^\\s*(${doseTimingPattern})`, 'u');
    const politeSuffix = /(?:นะครับ|นะคะ|ครับ|ค่ะ|คะ|จ้ะ|จ้า)$/u;
    const nonIdentityTailSuffix = /(?:ด้วย|แก่ผู้ป่วย)$/u;
    const unrelatedBridgeWords = /(?:หยิบ|มอบ|ซื้อ|แจก|กล่าว|บอก|เล่า|รับประทาน|ของขวัญ|ดอกไม้|ขนม|สิ่งของ|รางวัล)/u;
    const uncertainRelationWords = /(?:พร้อม|ก่อน|หลัง|และ|กับ|ข้าง|ใกล้|ติดกับ|เคียงกับ|คู่กับ|ร่วมกับ|เพื่อ|เพราะ|จากนั้น|เมื่อ|โดย|แล้ว|แต่|หรือ|ของ)/u;
    const embeddedAmountAndUnit = new RegExp(`${quantityCountPattern}\\s*${quantityUnitPattern}(?:\\s*ครึ่ง)?`, 'iu');
    const normalizeDoseTiming = (timing) => {
      const value = normalizeThaiDigits(timing).replace(/\s+/gu, '').replace(/\.$/u, '').toLowerCase();
      const aliases = new Map([
        ['ก่อนนอน', 'before-bed'], ['หลังอาหาร', 'after-meal'], ['หลังมื้อ', 'after-meal'],
        ['หลังมื้อเช้า', 'after-breakfast'], ['หลังมื้อกลางวัน', 'after-lunch'], ['หลังมื้อเย็น', 'after-dinner'],
        ['เมื่อมีอาการ', 'as-needed'], ['ตามอาการ', 'as-needed'], ['ก่อนเดินทาง', 'before-travel'], ['พร้อมอาหาร', 'with-food'],
        ['ตอนเช้า', 'at-morning'], ['ตอนสาย', 'at-late-morning'], ['ตอนกลางวัน', 'at-noon'], ['ตอนบ่าย', 'at-afternoon'],
        ['ตอนเย็น', 'at-evening'], ['ตอนค่ำ', 'at-nightfall'], ['ตอนกลางคืน', 'at-night'],
        ['ทุกเช้า', 'every-morning'], ['ทุกคืน', 'every-night'], ['ทุกวัน', 'daily'], ['ทุกมื้อ', 'every-meal'],
        ['ทุกสัปดาห์', 'weekly'], ['วันเว้นวัน', 'alternate-day'], ['เช้าและเย็น', 'morning-evening'],
        ['ต่อวัน', 'daily'], ['ต่อสัปดาห์', 'weekly'],
      ]);
      if (aliases.has(value)) return aliases.get(value);
      const hourly = value.match(/^ทุก(.+?)(?:ชั่วโมง|ชม)$/u);
      if (hourly) {
        const hours = /^\d+$/u.test(hourly[1]) ? BigInt(hourly[1]) : parseThaiInteger(hourly[1]);
        if (hours !== null) return `every-hours:${hours}`;
      }
      return null;
    };
    const mergeSchedules = (...groups) => [...new Set(groups.flat().filter(Boolean))].sort();
    const readLeadingDoseTimings = (value) => {
      let remaining = String(value || '');
      let consumed = 0;
      const schedules = [];
      while (remaining) {
        const match = remaining.match(doseTimingPrefix);
        if (!match) break;
        const schedule = normalizeDoseTiming(match[1]);
        if (!schedule) break;
        schedules.push(schedule);
        consumed += match[0].length;
        remaining = remaining.slice(match[0].length);
      }
      return { schedules: mergeSchedules(schedules), consumed };
    };
    const splitCountSchedules = (node) => {
      const schedules = [];
      const visit = (current) => {
        if (current?.kind === 'wrapper') {
          if (current.wrapperKind === 'freq') {
            const schedule = new Map([
              ['daily', 'daily'], ['per-time', 'per-time'], ['per-meal', 'every-meal'],
            ]).get(current.value);
            if (schedule) schedules.push(schedule);
            return visit(current.inner);
          }
          return { ...current, inner: visit(current.inner) };
        }
        if (current?.kind === 'pair') return { ...current, values: current.values.map(visit) };
        return current;
      };
      return { count: visit(node), schedules: mergeSchedules(schedules) };
    };
    const makeClaimKey = (category, count, unit, schedules) => JSON.stringify([
      category,
      count,
      unit,
      mergeSchedules(schedules),
    ]);
    const getThaiWordStarts = (line) => {
      if (!thaiWordSegmenter) return null;
      return new Set([...thaiWordSegmenter.segment(line)]
        .filter(segment => segment.isWordLike)
        .map(segment => segment.index));
    };
    const validCategoryStart = (line, index, category, wordStarts) => {
      if (!shortCategories.has(category)) return true;
      if (wordStarts) return wordStarts.has(index);
      const previous = line[index - 1] || '';
      return !previous || !thaiLetter.test(previous);
    };
    const parseCategoryBridge = (category, gap) => {
      let value = String(gap || '').trim();
      value = value.replace(/^[:：]\s*/u, '').trim();
      value = value.replace(/\s+/gu, '').toLowerCase();
      const schedules = [];
      let previous;
      do {
        previous = value;
        value = value.replace(politeSuffix, '');
        value = value.replace(nonIdentityTailSuffix, '');
        value = value.replace(/(?:วันละ|ครั้งละ|มื้อละ|เพียง|แค่|จำนวน)$/u, '');
        const timingMatch = value.match(doseTimingSuffix);
        if (timingMatch) {
          const schedule = normalizeDoseTiming(timingMatch[1]);
          if (schedule) schedules.push(schedule);
          value = value.slice(0, -timingMatch[1].length);
        }
      } while (value !== previous);
      const rule = categoryModifierRules.get(category);
      if (!value) return { keyCategory: category, allowBaseAlias: true, confidence: 3, schedules: mergeSchedules(schedules) };
      const hasReadyIdentity = /(?:พร้อมรับประทาน|พร้อมดื่ม|พร้อมทาน)/u.test(value);
      if (hasReadyIdentity && !embeddedAmountAndUnit.test(value)) {
        const isGenericReadyProduct = readyProductSuffix.test(value);
        const readyRemainder = value.replace(/^.*?(?:พร้อมรับประทาน|พร้อมดื่ม|พร้อมทาน)/u, '');
        if (/(?:และ|กับ|เพราะ|จากนั้น|เมื่อ|โดย|แล้ว|แต่|หรือ)/u.test(readyRemainder)) return null;
        return { keyCategory: `${category}:${value}`, allowBaseAlias: isGenericReadyProduct, confidence: isGenericReadyProduct ? 3 : 4, schedules: mergeSchedules(schedules) };
      }
      if (rule?.test(value) || (readyProductSuffix.test(value) && !embeddedAmountAndUnit.test(value))) {
        return { keyCategory: `${category}:${value}`, allowBaseAlias: true, confidence: 3, schedules: mergeSchedules(schedules) };
      }

      // ชื่อสินค้าไทยต่อท้ายหมวดได้หลากหลายเกินกว่าจะทำ allowlist ให้ครบ เช่น ยาพารา/นมโอ๊ต
      // unknown เก็บเป็น exact-only: ห้ามเอาจำนวนของวลีข้างเคียงมาออกสิทธิ์ให้ชื่อหมวดสั้น
      if (unrelatedBridgeWords.test(value)) return null;
      const keyValue = value;
      const uncertain = value.length > 32
        || !/^[\p{L}\p{M}\p{N}_-]+$/u.test(value)
        || embeddedAmountAndUnit.test(value)
        || uncertainRelationWords.test(value);
      return {
        keyCategory: `${category}:${keyValue}`,
        allowBaseAlias: false,
        confidence: uncertain ? 1 : 2,
        schedules: mergeSchedules(schedules),
      };
    };
    const findCategoryBefore = (line, amountStart, wordStarts, unit) => {
      const candidates = [];
      for (const category of categories) {
        let index = line.indexOf(category);
        while (index !== -1 && index < amountStart) {
          const prefixSpan = category === 'ช็อกโกแลต'
            ? line.slice(Math.max(0, index - 16), index).match(/ดาร์ก(?:\s*[-‐‑–—]\s*|\s*)$/u)?.[0] || ''
            : '';
          const prefixModifier = prefixSpan ? 'ดาร์ก' : '';
          const categoryStart = index - prefixSpan.length;
          const gap = line.slice(index + category.length, amountStart);
          const bridge = parseCategoryBridge(category, `${prefixModifier}${gap}`);
          if (bridge
              && categoryUnits.get(category)?.has(unit)
              && validCategoryStart(line, categoryStart, category, wordStarts)) {
            candidates.push({
              category,
              keyCategory: bridge.keyCategory,
              allowBaseAlias: bridge.allowBaseAlias,
              confidence: bridge.confidence,
              schedules: bridge.schedules,
              index: categoryStart,
            });
          }
          index = line.indexOf(category, index + category.length);
        }
      }
      // เลือกหมวดนอกสุดของชื่อสินค้าติดกัน: ยาน้ำต้องเป็นยา ไม่ใช่น้ำ และกาแฟนมต้องเป็นกาแฟ ไม่ใช่นม
      return candidates.sort((a, b) => Number(b.confidence >= 2) - Number(a.confidence >= 2)
        || a.index - b.index
        || b.category.length - a.category.length)[0] || null;
    };
    const findCategoryAfter = (line, amountEnd, wordStarts, unit) => {
      const window = line.slice(amountEnd);
      const candidates = [];
      for (const category of categories) {
        let index = window.indexOf(category);
        while (index !== -1) {
          const absoluteIndex = amountEnd + index;
          const prefix = window.slice(0, index).replace(/\s+/gu, '').replace(/ดาร์ก[-‐‑–—]$/u, 'ดาร์ก');
          if (/^(?:(?:ของ|เป็น)?(?:ดาร์ก)?)$/u.test(prefix)
              && categoryUnits.get(category)?.has(unit)
              && validCategoryStart(line, absoluteIndex, category, wordStarts)) {
            const prefixModifier = prefix.replace(/^(?:ของ|เป็น)/u, '');
            const tail = window.slice(index + category.length).trimStart();
            let tailEnd = tail.length;
            for (let tailIndex = 0; tailIndex < tail.length; tailIndex += 1) {
              const character = tail[tailIndex];
              if (/[,!?ฯ;\n]/u.test(character)
                  || (character === '.' && !(/\d/u.test(tail[tailIndex - 1] || '') && /\d/u.test(tail[tailIndex + 1] || '')))) {
                tailEnd = tailIndex;
                break;
              }
            }
            const clauseWords = new Set(['และ', 'กับ', 'แต่', 'หรือ', 'แล้ว', 'โดย', 'เมื่อ', 'เพราะ', 'จากนั้น', 'ขณะที่', 'ซึ่ง']);
            let tailModifier = tail.slice(0, tailEnd).trimEnd();
            let bridge = parseCategoryBridge(category, `${prefixModifier}${tailModifier}`);
            if (!bridge || bridge.confidence < 2) {
              let clauseBoundary = -1;
              if (thaiWordSegmenter) {
                for (const segment of thaiWordSegmenter.segment(tailModifier)) {
                  if (segment.isWordLike && clauseWords.has(segment.segment.trim())) {
                    clauseBoundary = segment.index;
                    break;
                  }
                }
              } else {
                clauseBoundary = tailModifier.search(/(?:^|\s)(?:และ|กับ|แต่|หรือ|แล้ว|โดย|เมื่อ|เพราะ|จากนั้น|ขณะที่|ซึ่ง)(?=\s|$)/u);
              }
              if (clauseBoundary >= 0) tailModifier = tailModifier.slice(0, clauseBoundary).trimEnd();
              bridge = parseCategoryBridge(category, `${prefixModifier}${tailModifier}`);
            }
            if (bridge) {
              const endIndex = absoluteIndex + category.length + tailModifier.length;
              candidates.push({ category, keyCategory: bridge.keyCategory, allowBaseAlias: bridge.allowBaseAlias, confidence: bridge.confidence, schedules: bridge.schedules, index: absoluteIndex, endIndex });
            }
          }
          index = window.indexOf(category, index + category.length);
        }
      }
      return candidates.sort((a, b) => Number(b.confidence >= 2) - Number(a.confidence >= 2)
        || a.index - b.index
        || b.category.length - a.category.length)[0] || null;
    };
    const isKnownNonUnitCompound = (line, amountEnd, unit) => {
      const suffix = line.slice(amountEnd);
      return (unit === 'ชิ้น' && /^งาน/u.test(suffix))
        || (unit === 'แก้ว' && /^รางวัล/u.test(suffix))
        || (unit === 'ml' && /^พิษ/u.test(suffix));
    };
    for (const rawLine of String(text || '').split(/\r?\n/u)) {
      // เลขไทย ๐–๙ ยาวเท่าเลขอารบิก จึง normalize เพื่อจับค่าได้โดย index สำหรับข้อความ error ยังตรงต้นฉบับ
      const line = normalizeThaiDigits(rawLine);
      const wordStarts = getThaiWordStarts(line);
      for (const match of line.matchAll(amountAndUnit)) {
        const amountStart = match.index;
        const amountEnd = amountStart + match[0].length;
        const numericPrefixContext = line.slice(Math.max(0, amountStart - 32), amountStart);
        const invalidNumericPrefixMatch = numericPrefixContext.match(partialNumericPrefixPattern);
        const invalidNumericPrefix = Boolean(invalidNumericPrefixMatch);
        const unit = normalizeUnit(match[2]);
        if (isKnownNonUnitCompound(line, amountEnd, unit)) continue;
        const before = findCategoryBefore(line, amountStart, wordStarts, unit);
        const after = findCategoryAfter(line, amountEnd, wordStarts, unit);
        // product-first ที่ชื่อชัดเจนมาก่อนต้องมาก่อนหมวดของประโยคถัดไป; ถ้าฝั่งก่อนเป็นเพียงวลีเชื่อมค่อยใช้ amount-first ที่ติดหลังหน่วย
        const categoryMatch = before?.confidence >= 2 ? before : (after || before);
        if (!categoryMatch) continue;
        const category = categoryMatch.category.toLowerCase();
        const keyCategory = String(categoryMatch.keyCategory || category).toLowerCase();
        let normalizedCount = normalizeCount(match[1]);
        if (match[3]) {
          normalizedCount = isScalar(normalizedCount)
            ? addScalars(normalizedCount, makeScalar(1n, 2n))
            : null;
        }
        if (match[4]) normalizedCount = wrapCount('qual', postfixQualifierAliases.get(match[4]), normalizedCount);
        const countParts = splitCountSchedules(normalizedCount);
        normalizedCount = countParts.count;
        const postTiming = readLeadingDoseTimings(line.slice(amountEnd));
        const schedules = mergeSchedules(categoryMatch.schedules, countParts.schedules, postTiming.schedules);
        let canonicalUnit = unit;
        if (!categoryUnits.get(category)?.has(unit)) continue;
        const invalidPrefixStart = amountStart - (invalidNumericPrefixMatch?.[0]?.length || 0);
        const rawStart = Math.min(before ? before.index : amountStart, invalidPrefixStart);
        const rawEnd = before ? amountEnd + postTiming.consumed : categoryMatch.endIndex;
        const rawClaim = rawLine.slice(rawStart, rawEnd).trim();
        if (invalidNumericPrefix || !normalizedCount) {
          claims.push({
            key: makeClaimKey(`__invalid__:${keyCategory}`, normalizeThaiDigits(match[1]).trim().toLowerCase(), unit, schedules),
            baseKey: makeClaimKey(`__invalid__:${category}`, normalizeThaiDigits(match[1]).trim().toLowerCase(), unit, schedules),
            allowBaseAlias: false,
            invalid: true,
            raw: rawClaim,
          });
          continue;
        }
        if (unit === 'ลิตร') {
          normalizedCount = mapCountScalars(normalizedCount, count => multiplyScalar(count, 1000n));
          canonicalUnit = 'ml';
        } else if (unit === 'กรัม') {
          normalizedCount = mapCountScalars(normalizedCount, count => multiplyScalar(count, 1000n));
          canonicalUnit = 'mg';
        }
        const count = canonicalCount(normalizedCount);
        claims.push({
          key: makeClaimKey(keyCategory, count, canonicalUnit, schedules),
          baseKey: makeClaimKey(category, count, canonicalUnit, schedules),
          allowBaseAlias: Boolean(categoryMatch.allowBaseAlias),
          raw: rawClaim,
        });
      }
    }
    return claims;
  };
  const sourceQuantityKeys = new Set(consumableQuantities(source)
    .filter(claim => !claim.invalid)
    .flatMap(claim => claim.allowBaseAlias ? [claim.key, claim.baseKey] : [claim.key]));
  const isSleepFrequency = (text, phrase) => {
    let offset = 0;
    while ((offset = text.indexOf(phrase, offset)) !== -1) {
      const nearby = text.slice(Math.max(0, offset - 80), offset + phrase.length + 80);
      if (/(?:เข้านอน|เวลานอน|การนอน|นอน)/u.test(nearby)) return true;
      offset += phrase.length;
    }
    return false;
  };
  const sourceHealthAuthority = new Map();
  for (const paragraph of splitHealthClauses(source)) {
    const claimKey = healthClaimKey(paragraph);
    if (!claimKey) continue;
    const authority = sourceHealthAuthority.get(claimKey) || { attributed: false, unattributed: false };
    if (attribution.test(paragraph)) authority.attributed = true;
    else authority.unattributed = true;
    sourceHealthAuthority.set(claimKey, authority);
  }
  list.forEach((version, index) => {
    const combined = getPublishablePostText(version);
    const imagined = combined.match(witnessFrame);
    if (imagined && !source.includes(imagined[0])) {
      issues.push(`V${index + 1}: สร้างภาพเหตุการณ์แทนข้อความดิบ`);
    }
    const unsupportedFrequencies = sleepFrequencies
      .filter(phrase => isSleepFrequency(combined, phrase) && !isSleepFrequency(source, phrase));
    if (unsupportedFrequencies.length > 0) {
      issues.push(`V${index + 1}: เพิ่มความถี่ที่ต้นฉบับไม่ได้ระบุ (${unsupportedFrequencies.join(', ')})`);
    }
    const unsupportedConsumableQuantities = consumableQuantities(combined)
      .filter(claim => !sourceQuantityKeys.has(claim.key));
    if (unsupportedConsumableQuantities.length > 0) {
      issues.push(`V${index + 1}: เพิ่มปริมาณ/โดสที่ต้นฉบับไม่ได้ระบุ (${unsupportedConsumableQuantities.map(claim => claim.raw).join(', ')})`);
    }
    for (const paragraph of splitHealthClauses(combined)) {
      const hasHealthBenefit = healthBenefit.test(healthComparableText(paragraph));
      const hasAttribution = attribution.test(paragraph);
      const healthAuthority = sourceHealthAuthority.get(healthClaimKey(paragraph));
      if (hasHealthBenefit && !hasAttribution && !healthAuthority?.unattributed) {
        issues.push(`V${index + 1}: ข้อความสุขภาพไม่ระบุที่มา`);
        break;
      }
      if (hasHealthBenefit && hasAttribution && !healthAuthority?.attributed) {
        issues.push(`V${index + 1}: เพิ่มที่มาของข้อความสุขภาพที่ต้นฉบับไม่ได้ระบุ`);
        break;
      }
    }
  });
  return { ok: issues.length === 0, issues };
}

/**
 * กฎคำ/regex เป็นเพียงสัญญาณให้พนักงานตรวจ ไม่ใช่เหตุทิ้งข่าวที่จ่าย API ไปแล้ว
 * technical failures (queue, DB, deadline, AI transport) อยู่นอก helper นี้และยังล้มตามเดิม
 */
export function groundingIssuesToWarnings(issues) {
  return [...new Set((Array.isArray(issues) ? issues : [])
    .map(issue => String(issue || '').trim())
    .filter(Boolean))]
    .map(issue => `${issue} — ให้พนักงานตรวจบริบทก่อนโพสต์`);
}

// ★ 19 ส.ค. 69 (🟡 FIXLIST-planK): สูตรจำนวนมุม 1-4 (default 2) รวมศูนย์ที่เดียว — เดิมก๊อปสูตรไว้ 2 จุด
//   (สวิตช์แบบ ก + MULTI-ANGLE) เสี่ยงแก้ที่หนึ่งลืมอีกที่ · export เพื่อให้ข้อสอบหน่วยเรียกได้
export function getGenAnglesCount() {
  return Math.max(1, Math.min(4, parseInt(process.env.GEN_ANGLES || '2', 10) || 2));
}

// ★ 19 ส.ค. 69 (ANGLE2_BY_SCORE — สเปคเฟเบิ้ล-สุด): ตัวเลือกมุมแบบอิงคะแนนไวรัล
//   มุมแรก = หมวดแรกตามเดิมเสมอ (คงบทเรียนเคส #01635 — ห้ามเรียงคะแนนทั้งชุด กันมุมพี่น้องเรื่องเดียวกันยกแผง)
//   มุมที่ 2 เป็นต้นไป = เลือกจากมุมที่เหลือตาม facebook_viral_score มาก→น้อย · คะแนนเท่ากันหรือไม่มีคะแนน = ลำดับต้นก่อน
//   นิยาม "มีคะแนน" (ผู้ตรวจโซล+คิมิชี้ตรงกัน 19 ส.ค. — Number(null)===0 ทำ null ชนะ key หายผิดสเปค):
//   นับเฉพาะ number หรือสตริงตัวเลขจริงที่ finite เท่านั้น — ไม่มีฟิลด์/null/สตริงว่าง/boolean/NaN/±Infinity
//   = ไม่มีคะแนนทั้งหมด (แพ้ทุกคะแนนจริง รวมถึงติดลบ · เสมอกันเรียงตามลำดับต้น)
//   pure function — ผู้เรียกเป็นคนเช็คสวิตช์ ANGLE2_BY_SCORE === '1' เองทุกจุด (ปิด = เดินโค้ด slice เดิม ไม่ผ่านตัวนี้)
//   ⚠️ จุดหั่นมุมมี 3 จุดที่ต้องเรียกตัวนี้พร้อมกันเมื่อสวิตช์เปิด:
//     ① แผนจบรายมุม (_closingAngleList ใน ANGLE_CLOSING_SPLIT) · ② anglesToUse ใน MULTI-ANGLE · ③ ตัวหั่นมุมของ blueprint ต่อมุม
//   ขาดจุดเดียว = รายชื่อมุม 3 ชุดไม่ตรงกัน แล้วการจับคู่ด้วยชื่อมุม (closing/blueprint ต่อมุม) ล้มเงียบ
export function selectAnglesForGen(breakdownData, count) {
  const possibleAngles = Array.isArray(breakdownData?.possible_angles) ? breakdownData.possible_angles : [];
  const n = Math.max(1, parseInt(String(count ?? ''), 10) || 1);
  if (possibleAngles.length <= 1 || n <= 1) return possibleAngles.slice(0, n);
  // synthetic best จัดมุมคู่ที่ต่างที่สุดไว้แล้ว — ห้ามคะแนนไวรัลดึงมุมพี่น้องกลับมาทับอันดับ 2
  if (possibleAngles[0]?._selectedFromBestMainAngle === true) return possibleAngles.slice(0, n);
  const rest = possibleAngles.slice(1).map((angle, idx) => {
    const v = angle?.facebook_viral_score;
    const raw = (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) ? Number(v) : NaN;
    return { angle, idx, score: Number.isFinite(raw) ? raw : -Infinity };
  });
  rest.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx));
  return [possibleAngles[0], ...rest.slice(0, n - 1).map((r) => r.angle)];
}

// ★ 18 ส.ค. 69 (แบบ ก — ANGLE_CLOSING_SPLIT): หาแผนจบของมุมเดียวจาก blueprint.angle_closings
// 🔧 19 ส.ค. 69 รอบ 3 (โซลตรวจ): กติกาจับคู่จริงย้ายไปรวมศูนย์ที่ assignAngleClosings
//   (two-pass: exact ครบทุกมุมก่อน → contain จากใบว่าง · จองใบไม่ซ้ำ · กัน [object Object] · catch มี log)
//   ใน narrativePayloadText.js — ตัวนี้เหลือเป็นทางลัดเรียกมุมเดียว (ยัง export ให้ข้อสอบ/โค้ดเก่าเรียกได้)
//   ⚠️ งานหลายมุมห้ามเรียกตัวนี้วนทีละมุม (จะไม่เห็นการจองข้ามมุม) — ใช้ assignAngleClosings ทีเดียวทั้งชุด
export function pickAngleClosing(blueprint, angleName) {
  return assignAngleClosings(Array.isArray(blueprint?.angle_closings) ? blueprint.angle_closings : null, [angleName])[0] || null;
}

// ─── ANGLE_BLUEPRINT_MODE helpers (pure/testable; ห้ามผูกด้วย index) ───
export function isAngleBlueprintPerAngleMode(value) {
  return String(value ?? '') === 'per_angle';
}

export function normalizeAngleBlueprintKey(angleName) {
  return String(angleName ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function selectPerAngleBlueprintAngles(breakdownData, rawAngleCount) {
  const parsedCount = parseInt(String(rawAngleCount ?? '2'), 10);
  const count = Math.max(1, Math.min(4, parsedCount || 2));
  const possibleAngles = Array.isArray(breakdownData?.possible_angles) ? breakdownData.possible_angles : [];
  // ★ 19 ส.ค. 69 (ANGLE2_BY_SCORE): จุดหั่นมุมจุดที่ 3 — ต้องสลับพร้อมอีก 2 จุดเสมอ (ดูโน้ตที่ selectAnglesForGen)
  const pickedAngles = process.env.ANGLE2_BY_SCORE === '1'
    ? selectAnglesForGen(breakdownData, count)
    : possibleAngles.slice(0, count);
  const selected = pickedAngles.map((angle, index) => ({
    angle_name: String(angle?.angle_name || '').trim() || `มุมข่าว ${index + 1}`,
    description: String(angle?.description || '').trim(),
  }));
  return selected.length > 0
    ? selected
    : [{ angle_name: 'นำเสนอข่าวสารทั่วไป', description: 'เล่าเหตุการณ์ตามจริง' }];
}

export async function runPerAngleBlueprintCalls(angles, callBlueprint) {
  const selected = Array.isArray(angles) ? angles.slice(0, 4) : [];
  if (selected.length === 0 || typeof callBlueprint !== 'function') {
    return {
      success: false,
      data: { blueprint: null, angleBlueprintsByName: new Map() },
      meta: { successCount: 0, totalCount: selected.length, failedAngleKeys: [], fallbackSourceAngleName: '' },
    };
  }

  // Promise.allSettled ยืนยันว่า N มุมเริ่มเป็น N promises พร้อมกัน และความล้มเหลวรายมุมไม่โยนข่าวทั้งงาน
  const settled = await Promise.allSettled(
    selected.map((angle) => Promise.resolve().then(() => callBlueprint(angle)))
  );
  const ownBlueprints = new Map();
  const outcomes = settled.map((result, index) => {
    const angle = selected[index];
    const key = normalizeAngleBlueprintKey(angle.angle_name);
    const rawBlueprint = result.status === 'fulfilled' && result.value?.success
      ? result.value?.data?.blueprint
      : null;
    const blueprintForAngle = rawBlueprint && typeof rawBlueprint === 'object'
      ? {
          ...rawBlueprint,
          angle_blueprint: {
            mode: 'per_angle',
            angle_name: angle.angle_name,
            description: angle.description,
          },
        }
      : null;
    if (blueprintForAngle && !ownBlueprints.has(key)) ownBlueprints.set(key, blueprintForAngle);
    return { key, angleName: angle.angle_name, blueprint: blueprintForAngle };
  });

  const firstAngleKey = normalizeAngleBlueprintKey(selected[0]?.angle_name);
  // ปกติ fallback คือแผนมุมแรกตามข้อกำหนด; ถ้ามุมแรกเองล้ม ใช้แผนแรกที่รอดแทน เพื่อให้ "ล้มหมดเท่านั้นจึง null"
  const fallbackBlueprint = ownBlueprints.get(firstAngleKey)
    || outcomes.find((outcome) => outcome.blueprint)?.blueprint
    || null;
  const resolvedBlueprints = new Map();
  const failedAngleKeys = [];
  for (const outcome of outcomes) {
    if (!outcome.blueprint) failedAngleKeys.push(outcome.key);
    resolvedBlueprints.set(outcome.key, outcome.blueprint || fallbackBlueprint);
  }

  return {
    success: Boolean(fallbackBlueprint),
    data: { blueprint: fallbackBlueprint, angleBlueprintsByName: resolvedBlueprints },
    meta: {
      successCount: outcomes.filter((outcome) => outcome.blueprint).length,
      totalCount: selected.length,
      failedAngleKeys,
      fallbackSourceAngleName: fallbackBlueprint?.angle_blueprint?.angle_name || '',
    },
  };
}

export function pickPerAngleBlueprint(angleBlueprintsByName, angleName, fallbackBlueprint = null) {
  const key = normalizeAngleBlueprintKey(angleName);
  if (!angleBlueprintsByName || typeof angleBlueprintsByName.get !== 'function') return fallbackBlueprint;
  return angleBlueprintsByName.get(key) || fallbackBlueprint;
}
