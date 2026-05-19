import { NextResponse } from 'next/server';
import { logPipeline } from '@/lib/pipelineLogger';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';

const rlog = createLogger('AUTO');

/**
 * Auto Pipeline API V2
 * รัน 2 pipeline พร้อมกัน:
 *   Classic: Scrape → Extract → Breakdown → Generate (เหมือนเดิม)
 *   Enhanced: + Blueprint + Research → Generate (คุณภาพสูงขึ้น)
 * รวม versions ทั้งหมดเพื่อให้เลือกใช้ได้หลากหลาย
 */
export async function POST(request) {
  const startTime = Date.now();
  let _autoWorkflowId = null;

  try {
    const { url, sourceType: forceType, preset, contentLength, workflowId } = await request.json();
    _autoWorkflowId = workflowId || ('auto_' + Date.now());

    if (!url || url.length < 5) {
      return NextResponse.json({ success: false, error: 'กรุณาใส่ URL' }, { status: 400 });
    }

    let _user = { userId: null, userName: null };
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get('auth_token')?.value;
      const session = await getSession(token);
      if (session) _user = { userId: session.memberId, userName: session.displayName || session.username };
    } catch {}

    await logPipeline({ workflowId: _autoWorkflowId, step: 'auto-pipeline', status: 'started', detail: 'URL: ' + url.slice(0, 80), ..._user }).catch(() => {});

    const origin = new URL(request.url).origin;
    const baseUrl = origin;
    const selectedLength = contentLength || 'medium';

    // ══ PIPELINE START LOG ══ (defined after selectedLength)
    rlog.start(`URL: ${url.slice(0,80)} | type: ${forceType || 'auto-detect'} | length: ${selectedLength}`);

    // Helper — call internal API
    const callInternal = async (path, body) => {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json();
    };

    const log = [];
    const addLog = (step, msg) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const entry = `[${elapsed}s] ${step}: ${msg}`;
      log.push(entry);
      console.log(`[AUTO-PIPELINE] [${elapsed}s] [${step}] ${msg}`);
    };

    // === STEP 0: Detect source type ===
    const step0Start = Date.now();
    let detectedType = forceType || 'url';
    if (!forceType) {
      // ✅ รวม vt.tiktok.com (short link) และ vm.tiktok.com
      if (/tiktok\.com|vt\.tiktok|vm\.tiktok/i.test(url)) detectedType = 'tiktok';
      else if (/youtube\.com|youtu\.be/i.test(url)) detectedType = 'youtube';
      else if (/facebook\.com|fb\.watch/i.test(url)) detectedType = 'facebook';
    }
    const domain = (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 30); } })();
    addLog('Detect', `📎 ${detectedType.toUpperCase()} → ${domain}`);

    // ─── Helper: throw ด้วย failedStep ที่ถูกต้อง ────────────────
    const throwStep = (stepId, msg) => {
      const err = new Error(msg);
      err.failedStep = stepId; // บอกว่า step ไหน fail จริง
      throw err;
    };

    // === STEP 1: ดึงเนื้อหา (Scrape / Transcribe) ===
    const step1Start = Date.now();
    let rawText = '';
    let contentFallback = false;

    if (detectedType === 'tiktok') {
      addLog('Step1', '🎵 กำลัง transcribe TikTok...');
      const tikRes = await callInternal('/api/tiktok', { url });
      if (!tikRes.success) {
        if (tikRes.needUpload) {
          // ✅ FALLBACK: ดาวน์โหลดไม่ได้ → ใช้ URL + hint เป็น input ให้ AI วิเคราะห์ต่อ
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
      const ytRes = await callInternal('/api/youtube', { url });
      if (!ytRes.success) throwStep('auto_scrape', `YouTube: ${ytRes.error}`);
      rawText = ytRes.transcript || ytRes.text || '';
      addLog('Step1', `✅ YouTube transcript: ${rawText.length} ตัวอักษร (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
    } else {
      addLog('Step1', `🌐 กำลังดึง HTML จาก ${domain}...`);
      const scrapeRes = await fetch(`${baseUrl}/api/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const scrapeData = await scrapeRes.json();
      if (!scrapeData.success) throwStep('auto_scrape', `Scrape: ${scrapeData.error}`);
      rawText = scrapeData.data?.text || scrapeData.text || '';
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
    rlog.model('Gemini Flash (fast+cheap)', 'ใช้สำหรับ Extract เพื่อประหยัดค่าใช้จ่าย');
    const extractRes = await callInternal('/api/summarize', {
      text: rawText,
      sourceType: detectedType,
      mode: 'extract',
    });
    if (!extractRes.success || !extractRes.data?.newsBody) {
      throwStep('auto_extract', `สกัดข่าวไม่สำเร็จ: ${extractRes.error || 'ไม่มีเนื้อหา'}`);
    }
    const newsData = extractRes.data;
    rlog.inject('newsTitle', `"${(newsData.newsTitle||'').slice(0,50)}"`);
    rlog.inject('newsBody', `${newsData.newsBody.length}ch | category: ${newsData.newsCategory||'-'}`);
    addLog('Step2', `✅ "${newsData.newsTitle?.slice(0, 40)}..." (${newsData.newsBody.length} ตัวอักษร, ${((Date.now() - step2Start) / 1000).toFixed(1)}s)`);
    await logPipeline({ workflowId: _autoWorkflowId, step: 'extract', status: 'success', duration: Date.now() - step2Start, detail: (newsData.newsTitle || '').slice(0, 60) }).catch(() => {});

    // === STEP 3: แตกประเด็น (Breakdown) ===
    const step3Start = Date.now();
    addLog('Step3', '🔍 AI กำลังวิเคราะห์มุมข่าว...');
    rlog.api('summarize', 'mode=BREAKDOWN');
    rlog.prompt('breakdown_analysis', 'วิเคราะห์ประเด็น/มุมข่าว/อารมณ์หลัก');
    rlog.model('Gemini Flash', 'ใช้สำหรับ Breakdown');
    const breakRes = await callInternal('/api/summarize', {
      text: newsData.newsBody,
      newsTitle: newsData.newsTitle,
      sourceType: detectedType,
      mode: 'breakdown',
    });
    if (!breakRes.success || !breakRes.data) {
      throwStep('auto_breakdown', `แตกประเด็นไม่สำเร็จ: ${breakRes.error || ''}`);
    }
    const breakdownData = breakRes.data;
    rlog.inject('breakdownData', `${breakdownData.key_points?.length||0} key_points | ${breakdownData.possible_angles?.length||0} angles | core: "${(breakdownData.core_story||'').slice(0,40)}"`);
    addLog('Step3', `✅ ${breakdownData.key_points?.length || 0} ประเด็น, ${breakdownData.possible_angles?.length || 0} มุมข่าว (${((Date.now() - step3Start) / 1000).toFixed(1)}s)`);
    await logPipeline({ workflowId: _autoWorkflowId, step: 'breakdown', status: 'success', duration: Date.now() - step3Start, detail: (breakdownData.key_points?.length || 0) + ' key points' }).catch(() => {});

    // ===================================================================
    // === PIPELINE A: Classic (รันก่อน — เหมือนเดิม 100%) ===
    // ===================================================================
    const stepParallelStart = Date.now();

    rlog.divider('PIPELINE A: CLASSIC');
    addLog('Classic', '📝 สร้างเนื้อหา Classic (ไม่ใช้ Blueprint/Research)...');
    rlog.api('summarize', 'mode=ANALYZE (Classic)');
    rlog.prompt('Library Prompt (AI Match)', 'AI เลือก prompt จากหอสมุดอัตโนมัติ');
    rlog.inject('Anti-Duplicate+Factual System', 'injected | Breakdown data | Full context');
    rlog.model('Claude Sonnet (write) > GPT-4o (fallback)', 'Smart Router เลือก model');
    const classicRes = await callInternal('/api/summarize', {
      text: newsData.newsBody,
      newsTitle: newsData.newsTitle,
      breakdownData,
      sourceType: detectedType,
      mode: 'analyze',
      contentLength: selectedLength,
    });

    let classicData = null;
    if (classicRes.success) {
      classicData = classicRes.data;
      addLog('Classic', `✅ ${classicData.versions?.length || 0} เวอร์ชัน Classic (${((Date.now() - stepParallelStart) / 1000).toFixed(1)}s)`);
    } else {
      // Library ว่าง หรือ error อื่น — log แต่ไม่ throw ทันที
      addLog('Classic', `❌ ${classicRes.error || 'สร้างไม่สำเร็จ'}`);
      // ถ้า Library ว่างจริง → throw ทันทีเพราะ Enhanced จะล้มด้วย
      if (classicRes.libraryEmpty) {
        throw new Error(classicRes.error || 'กรุณาเพิ่ม Prompt ในหอสมุดก่อน');
      }
    }

    // ===================================================================
    // === PIPELINE B: Blueprint + Research (parallel) → Enhanced Generate ===
    // ===================================================================

    rlog.divider('PIPELINE B: ENHANCED');
    addLog('Enhanced', '🧬 Blueprint + 🔍 Research พร้อมกัน...');
    rlog.api('summarize', 'mode=BLUEPRINT (parallel)');
    rlog.prompt('emotional_blueprint', 'สร้างโครงสร้างอารมณ์ + emotional timeline');
    rlog.api('research-search', 'Serper Google Search');
    rlog.inject('SERPER_KEY', process.env.SERPER_API_KEY ? '✅ key set' : '❌ KEY MISSING — research will fail');
    const bpStart = Date.now();

    const [bpResult, resResult] = await Promise.allSettled([
      callInternal('/api/summarize', {
        text: newsData.newsBody,
        newsTitle: newsData.newsTitle,
        mode: 'blueprint',
        breakdownData,
      }),
      callInternal('/api/research-search', {
        newsTitle: newsData.newsTitle,
        newsBody: newsData.newsBody,
        breakdownData,
      }),
    ]);

    const blueprint = (bpResult.status === 'fulfilled' && bpResult.value?.success)
      ? bpResult.value.data?.blueprint : null;
    const researchItems = (resResult.status === 'fulfilled' && resResult.value?.success)
      ? (resResult.value.data?.items || []) : [];

    addLog('Enhanced', `Blueprint: ${blueprint ? blueprint.core_emotion : '❌'} | Research: ${researchItems.length} แหล่ง (${((Date.now() - bpStart) / 1000).toFixed(1)}s)`);
    if (blueprint) rlog.blueprint(`emotion: "${blueprint.core_emotion}" | steps: ${blueprint.emotional_timeline?.length || 0} | bridges: ${blueprint.bridges?.length || 0}`);
    if (researchItems.length) rlog.research(`${researchItems.length} items | topics: ${researchItems.map(i=>i.title).join(', ').slice(0,100)}`);
    else rlog.warn('Research: 0 items — ตรวจสอบ SERPER_API_KEY หรือ network');

    rlog.divider('ENHANCED GENERATE');
    addLog('Enhanced', '✍️ สร้างเนื้อหา Enhanced...');
    rlog.api('summarize', 'mode=ANALYZE (Enhanced)');
    rlog.prompt('Library Prompt (AI Match)', 'AI เลือก prompt จากหอสมุดอัตโนมัติ');
    rlog.inject('Blueprint', blueprint ? `core_emotion: ${blueprint.core_emotion}` : 'none');
    rlog.inject('Research', `${researchItems.length} items from Serper`);
    rlog.inject('Anti-Duplicate+Factual System', 'injected');
    rlog.model('Claude Sonnet (write) > GPT-4o (fallback)', 'Smart Router');
    const enhancedGenStart = Date.now();
    const enhancedRes = await callInternal('/api/summarize', {
      text: newsData.newsBody,
      newsTitle: newsData.newsTitle,
      breakdownData,
      sourceType: detectedType,
      mode: 'analyze',
      contentLength: selectedLength,
      emotionalBlueprint: blueprint,
      researchData: researchItems.length > 0 ? { items: researchItems } : null,
    });

    let enhancedData = null;
    if (enhancedRes.success) {
      enhancedData = { analysisData: enhancedRes.data, blueprint, researchItems };
      addLog('Enhanced', `✅ ${enhancedRes.data.versions?.length || 0} เวอร์ชัน Enhanced (${((Date.now() - enhancedGenStart) / 1000).toFixed(1)}s)`);
    } else {
      addLog('Enhanced', `❌ ${enhancedRes.error || 'Enhanced generate ไม่สำเร็จ'}`);
    }

    addLog('Parallel', `✅ ทั้งสอง pipeline เสร็จ (${((Date.now() - stepParallelStart) / 1000).toFixed(1)}s)`);

    // pseudo-allSettled result format for compatibility below
    const classicResult = classicData ? { status: 'fulfilled', value: classicData } : { status: 'rejected' };
    const enhancedBundle = enhancedData ? { status: 'fulfilled', value: enhancedData } : { status: 'rejected' };


    // === รวม versions ทั้งหมด ===
    // (classicData และ enhancedData ถูกประกาศด้านบนแล้ว — ใช้โดยตรง)

    // Classic versions — tag ว่า Classic
    const classicVersions = (classicData?.versions || []).map((v, i) => ({
      ...v,
      _source: 'classic',
      _sourceLabel: '⚡ Classic',
      style: v.style || `classic_${i + 1}`,
    }));

    // Enhanced versions — tag ว่า Enhanced
    const enhancedVersions = (enhancedData?.analysisData?.versions || []).map((v, i) => ({
      ...v,
      _source: 'enhanced',
      _sourceLabel: '🧬 Enhanced',
      style: v.style ? `enhanced_${v.style}` : `enhanced_${i + 1}`,
    }));

    // รวมกัน: Enhanced มาก่อน (คุณภาพสูงกว่า), ตามด้วย Classic
    const allVersions = [...enhancedVersions, ...classicVersions];

    // ใช้ analysisResult จาก Classic (หรือ Enhanced ถ้า Classic ล้มเหลว) สำหรับ meta
    const primaryResult = classicData || enhancedData?.analysisData || {};

    // log สรุป
    if (!classicData) addLog('Classic', '❌ Classic ไม่สำเร็จ');
    if (!enhancedData) addLog('Enhanced', '❌ Enhanced ไม่สำเร็จ');
    if (allVersions.length === 0) throwStep('auto_classic', 'ทั้ง Classic และ Enhanced สร้างเนื้อหาไม่สำเร็จ — ตรวจสอบ Prompt Library หรือ API key');

    addLog('Summary', `📊 รวม ${allVersions.length} เวอร์ชัน (Classic: ${classicVersions.length}, Enhanced: ${enhancedVersions.length})`);
    if (blueprint) addLog('Summary', `🧬 Blueprint: ${blueprint.core_emotion}`);
    if (researchItems.length) addLog('Summary', `🔍 Research: ${researchItems.length} แหล่งข้อมูล`);

    // === Prompt Library info ===
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

    return NextResponse.json({
      success: true,
      data: {
        newsData,
        breakdownData,
        analysisResult: {
          ...primaryResult,
          versions: allVersions, // รวมทั้งหมด
        },
        // Extra data สำหรับ UI แสดง
        blueprint,
        researchItems,
        classicVersionCount: classicVersions.length,
        enhancedVersionCount: enhancedVersions.length,
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
    });

  } catch (error) {
    console.error('[AutoPipeline] ERROR:', error.message);
    await logPipeline({ workflowId: _autoWorkflowId, step: 'auto-pipeline', status: 'failed', duration: Date.now() - startTime, error: error.message }).catch(() => {});
    return NextResponse.json({
      success: false,
      error: error.message,
      totalTimeSeconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
    }, { status: 500 });
  }
}
