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
import { withTimeout } from '@/lib/utils/withTimeout';
import { runCorrectionPipeline } from '@/lib/correction/correctionPipeline';
import { getBuiltinFallbackPrompt } from '@/lib/ai/builtinFallbackPrompt';
// ★ 19 ส.ค. 69 รอบ 3 (ANGLE_CLOSING_SPLIT): กติกาจับคู่แผนจบ+เงื่อนไขทุบท้าย อยู่ที่เดียวใน narrativePayloadText
//   (ปลายทาง dependency — ไม่เกิด circular import) เพื่อให้ log ฝั่งนี้ตรงกับที่ฝั่งเขียนใช้จริงเสมอ
import { assignAngleClosings, closingTailMatches } from '@/lib/input-engine/narrativePayloadText';
import { isCardAuthorityR6Enabled } from '@/lib/ai/cardAuthority'; // 🎛️ สวิตช์ปลดหาง "ห้ามขึ้นต้นด้วยวันที่" (19 ส.ค. 69) — ห้ามอ่าน env CARD_AUTH* เอง ต้อง import จากไฟล์กลางเท่านั้น

const rlog = createLogger('AUTO-SERVICE');

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
  
  const breakRes = await withTimeout(performSummarize({
    text: newsData.newsBody,
    newsTitle: newsData.newsTitle,
    sourceType: detectedType,
    mode: 'breakdown',
    workflowId: _autoWorkflowId,
    user: _user,
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
  let _closingAngleList = null;
  if (isAngleClosingSplitEnabled) {
    // 🔧 19 ส.ค. 69 (🟡 FIXLIST-planK): สูตรจำนวนมุมรวมศูนย์ที่ getGenAnglesCount() — เดิมก๊อปสูตรมา 2 ที่
    const _nAngles = getGenAnglesCount();
    _closingAngleList = (breakdownData.possible_angles || [])
      .slice(0, _nAngles)
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
    ? runPerAngleBlueprintCalls(_perAngleBlueprintAngles, (blueprintAngle) => withTimeout(performSummarize({
        text: newsData.newsBody,
        newsTitle: newsData.newsTitle,
        mode: 'blueprint',
        breakdownData,
        workflowId: _autoWorkflowId,
        user: _user,
        blueprintAngle,
      }), 120000, `blueprint:${blueprintAngle.angle_name || 'unnamed'}`))
      .catch(() => null)
      .finally(() => { _taskElapsed.blueprint = Date.now() - _bpT0; })
    : null;
  const [bpSettled, srSettled] = await Promise.allSettled([
    // Task 1: Blueprint
    _perAngleBlueprintTask ||
    withTimeout(performSummarize({
      text: newsData.newsBody,
      newsTitle: newsData.newsTitle,
      mode: 'blueprint',
      breakdownData,
      workflowId: _autoWorkflowId,
      user: _user,
      // ★ ANGLE_CLOSING_SPLIT=1 เท่านั้นถึงส่งรายชื่อมุม — ไม่ตั้ง env = ไม่มี key นี้ = prompt Blueprint เดิมไบต์ต่อไบต์
      ...(_closingAngleList ? { angleList: _closingAngleList } : {}),
    }), 120000, 'blueprint').catch(() => null).finally(() => { _taskElapsed.blueprint = Date.now() - _bpT0; }), // ★ 120s — GPT-5.5 needs more time

    // Task 2: Smart Research
    withTimeout(
      smartResearch(newsData, breakdownData),
      60000, // ★ 16 ก.ค. 69 (B4): 60s (was 30s) — sync สาย URL: SmartResearch มี 2 AI calls + 7 Serper HTTP calls
             //   ค่า 30s พิสูจน์แล้วว่าไม่พอ → factPool เป็น null เงียบๆ ข่าวขาดข้อมูลเสริม
      'smart_research'
    ).catch(() => null).finally(() => { _taskElapsed.research = Date.now() - _srT0; }),
  ]);

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
  // 18 ส.ค. 69 (แบบ 2 — สถาปนิกออกแบบ · โซลตรวจไขว้ · เจ้าของอนุมัติ): มุมถัดไปเห็นการ์ดที่มุมก่อนหน้าใช้ไปแล้ว เพื่อไม่ให้ 2 ฉบับเปิดซ้ำ
  // ปิดกลับเดิม: ANGLE_CARD_CONTEXT=0
  const usedCardInfo = [];
  const isAngleCardContextEnabled = process.env.ANGLE_CARD_CONTEXT !== '0';
  const MIN_ANGLE_MATCH = Math.max(0, parseInt(process.env.ANGLE_MIN_MATCH_SCORE || '45', 10) || 45);
  const anglePrompts = [];
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
    }).catch(() => null);

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
    }
  }

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
  const OPENING_STYLES = [
    'เปิดด้วยภาพ/ฉากของเหตุการณ์ (visual moment) — พาคนอ่านไปยืนอยู่ตรงนั้นตั้งแต่ประโยคแรก' + _caR6Tail,
    'เปิดด้วยตัวเลขหรือ contrast ที่สะดุดใจ — ขัดความคาดหมายตั้งแต่ประโยคแรก' + _caR6Tail,
    'เปิดด้วยคำพูดของคนในเหตุการณ์ หรือความรู้สึก/คำถามที่ค้างในใจคนอ่าน' + _caR6Tail,
    'เปิดด้วยผลลัพธ์/ปลายทางของเรื่องก่อน แล้วค่อยย้อนเล่าที่มา' + _caR6Tail,
  ];

  // === PARALLEL GENERATE: สร้างเนื้อหาขนานด้วย prompt ที่เลือกไว้แล้ว ===
  const generationTasks = anglesToUse.map((angleObj, index) => {
    return withTimeout((async () => {
      const count = versionsPerAngle;
      const focusAngle = `${angleObj.angle_name}: ${angleObj.description}`;
      // 18 ส.ค. 69 เจ้าของสั่งถอด 3 รอบ (2132c6a · eb6ff50 · 9b9a689) คืนสภาพยุคปัง
      // เหตุผล: ให้การ์ดกับสไตล์ไวรัลเป็นแนวทาง ห้ามสั่งทับ · กู้ของเดิม: git show <sha>
      const _ap = anglePrompts[index];
      const _promptHook = (_ap && Number(_ap._matchScore) >= 60 && _ap.hookStyle) ? String(_ap.hookStyle) : null;
      const _openingStyle = _promptHook
        ? `${_promptHook} — ตามเทคนิคเปิดของพร้อมท์ที่จับคู่${_caR6Tail}`
        : OPENING_STYLES[index % OPENING_STYLES.length];
      const writeAngle = `${focusAngle}\nสไตล์เปิดเรื่องบังคับของเวอร์ชันนี้: ${_openingStyle}`;
      
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
      const genResult = await performSummarize({
        text: newsData.newsBody,
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
        user: _user,
      });
      
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

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  addLog('Done', `✅ เสร็จสมบูรณ์ ${totalTime}s | ${allVersions.length} เวอร์ชัน`);
  await logPipeline({ workflowId: _autoWorkflowId, step: 'auto-pipeline', status: 'success', duration: Date.now() - startTime, detail: `Total: ${totalTime}s | ${allVersions.length} versions` }).catch(() => {});

  // === POST-GENERATION CORRECTION PIPELINE ===
  let finalVersions = allVersions;
  try {
    finalVersions = await runCorrectionPipeline(allVersions, newsData, breakdownData,
      // ★ 14 ส.ค. 69: ส่งข้อเท็จจริงรีเสิร์ชให้ด่าน L1.8 — ของจริงจากรีเสิร์ชไม่ใช่ "ของเกิน"
      (factPool?.facts || []).map((x) => (typeof x === 'string' ? x : (x?.text || x?.content || ''))).filter(Boolean).join('\n') || null);
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
        // ★ 30 มิ.ย.: บันทึกพร้อมท์ที่ใช้จริง (ปิดจุดบอด — ท่อ text เดิมไม่บันทึก promptName)
        promptName: usedPreset?.promptName || usedPreset?.name || anglePrompts[0]?.promptName || '',
        promptSource: usedPreset?.promptSource || usedPreset?.source || (anglePrompts[0] ? 'library' : ''),
        promptScore: usedPreset?.matchScore ?? usedPreset?.viralScore ?? anglePrompts[0]?.viralScore ?? 0,
        promptMatchType: usedPreset?.matchType || (usedPreset?.isBorrowed ? 'BORROWED' : (anglePrompts[0] ? 'MATCHED' : '')),
        promptId: usedPreset?.promptId || anglePrompts[0]?.id || '',
        newsType: newsType || '',
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
    });
    addLog('GenLog', `📋 บันทึก Generation Log สำเร็จ`);
  } catch (logErr) {
    console.warn('[AutoFlowText] Generation log failed (non-critical):', logErr.message);
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

// ★ 19 ส.ค. 69 (🟡 FIXLIST-planK): สูตรจำนวนมุม 1-4 (default 2) รวมศูนย์ที่เดียว — เดิมก๊อปสูตรไว้ 2 จุด
//   (สวิตช์แบบ ก + MULTI-ANGLE) เสี่ยงแก้ที่หนึ่งลืมอีกที่ · export เพื่อให้ข้อสอบหน่วยเรียกได้
export function getGenAnglesCount() {
  return Math.max(1, Math.min(4, parseInt(process.env.GEN_ANGLES || '2', 10) || 2));
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
  const selected = possibleAngles.slice(0, count).map((angle, index) => ({
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
