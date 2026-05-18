import { NextResponse } from 'next/server';
import { logPipeline } from '@/lib/pipelineLogger';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';

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
      log.push(`[${elapsed}s] ${step}: ${msg}`);
      console.log(`[AutoPipeline] [${elapsed}s] ${step}: ${msg}`);
    };

    // === STEP 0: Detect source type ===
    const step0Start = Date.now();
    let detectedType = forceType || 'url';
    if (!forceType) {
      if (/tiktok\.com/i.test(url)) detectedType = 'tiktok';
      else if (/youtube\.com|youtu\.be/i.test(url)) detectedType = 'youtube';
      else if (/facebook\.com|fb\.watch/i.test(url)) detectedType = 'facebook';
    }
    const domain = (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 30); } })();
    addLog('Detect', `📎 ${detectedType.toUpperCase()} → ${domain}`);

    // === STEP 1: ดึงเนื้อหา (Scrape / Transcribe) ===
    const step1Start = Date.now();
    let rawText = '';

    if (detectedType === 'tiktok') {
      addLog('Step1', '🎵 กำลัง transcribe TikTok...');
      const tikRes = await callInternal('/api/tiktok', { url });
      if (!tikRes.success) throw new Error(`TikTok: ${tikRes.error}`);
      rawText = tikRes.transcript || tikRes.text || '';
      addLog('Step1', `✅ TikTok transcript: ${rawText.length} ตัวอักษร (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
    } else if (detectedType === 'youtube') {
      addLog('Step1', '🎬 กำลังดึง YouTube transcript...');
      const ytRes = await callInternal('/api/youtube', { url });
      if (!ytRes.success) throw new Error(`YouTube: ${ytRes.error}`);
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
      if (!scrapeData.success) throw new Error(`Scrape: ${scrapeData.error}`);
      rawText = scrapeData.data?.text || scrapeData.text || '';
      addLog('Step1', `✅ ดึงเนื้อหา ${rawText.length} ตัวอักษร (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
    }

    if (!rawText || rawText.length < 20) {
      throw new Error('ไม่สามารถดึงเนื้อหาได้ (ข้อความสั้นเกินไป)');
    }

    // === STEP 2: สกัดข่าว (Extract) ===
    const step2Start = Date.now();
    addLog('Step2', '📰 AI กำลังสกัดเนื้อข่าว...');
    const extractRes = await callInternal('/api/summarize', {
      text: rawText,
      sourceType: detectedType,
      mode: 'extract',
    });
    if (!extractRes.success || !extractRes.data?.newsBody) {
      throw new Error('สกัดข่าวไม่สำเร็จ');
    }
    const newsData = extractRes.data;
    addLog('Step2', `✅ "${newsData.newsTitle?.slice(0, 40)}..." (${newsData.newsBody.length} ตัวอักษร, ${((Date.now() - step2Start) / 1000).toFixed(1)}s)`);
    await logPipeline({ workflowId: _autoWorkflowId, step: 'extract', status: 'success', duration: Date.now() - step2Start, detail: (newsData.newsTitle || '').slice(0, 60) }).catch(() => {});

    // === STEP 3: แตกประเด็น (Breakdown) ===
    const step3Start = Date.now();
    addLog('Step3', '🔍 AI กำลังวิเคราะห์มุมข่าว...');
    const breakRes = await callInternal('/api/summarize', {
      text: newsData.newsBody,
      newsTitle: newsData.newsTitle,
      sourceType: detectedType,
      mode: 'breakdown',
    });
    if (!breakRes.success || !breakRes.data) {
      throw new Error('แตกประเด็นไม่สำเร็จ');
    }
    const breakdownData = breakRes.data;
    addLog('Step3', `✅ ${breakdownData.key_points?.length || 0} ประเด็น, ${breakdownData.possible_angles?.length || 0} มุมข่าว (${((Date.now() - step3Start) / 1000).toFixed(1)}s)`);
    await logPipeline({ workflowId: _autoWorkflowId, step: 'breakdown', status: 'success', duration: Date.now() - step3Start, detail: (breakdownData.key_points?.length || 0) + ' key points' }).catch(() => {});

    // ===================================================================
    // === PIPELINE A (Classic) + PIPELINE B (Enhanced) รันพร้อมกัน ===
    // ===================================================================

    const stepParallelStart = Date.now();
    addLog('Parallel', '🚀 เริ่มรัน Classic + Enhanced พร้อมกัน...');

    const [classicResult, enhancedBundle] = await Promise.allSettled([

      // ── PIPELINE A: Classic (เหมือนเดิม ไม่เปลี่ยน) ──────────────────
      (async () => {
        const t = Date.now();
        addLog('Classic', '📝 สร้างเนื้อหา Classic...');
        const res = await callInternal('/api/summarize', {
          text: newsData.newsBody,
          newsTitle: newsData.newsTitle,
          breakdownData,
          sourceType: detectedType,
          mode: 'analyze',
          contentLength: selectedLength,
        });
        if (!res.success) throw new Error(res.error || 'Classic generate ไม่สำเร็จ');
        addLog('Classic', `✅ ${res.data.versions?.length || 0} เวอร์ชัน (${((Date.now() - t) / 1000).toFixed(1)}s)`);
        return res.data;
      })(),

      // ── PIPELINE B: Enhanced (Blueprint + Research → Generate) ─────────
      (async () => {
        // B1: Blueprint + Research ทำพร้อมกัน (Parallel)
        const bpStart = Date.now();
        addLog('Enhanced', '🧬 วาง Blueprint + 🔍 Research พร้อมกัน...');

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
          ? (resResult.value.data?.items || resResult.value.data?.results || []) : [];

        if (blueprint) {
          addLog('Enhanced', `✅ Blueprint: ${blueprint.core_emotion} | Research: ${researchItems.length} แหล่ง (${((Date.now() - bpStart) / 1000).toFixed(1)}s)`);
        } else {
          addLog('Enhanced', `⚠️ Blueprint ไม่สำเร็จ | Research: ${researchItems.length} แหล่ง`);
        }

        // B2: Generate ด้วย Blueprint + Research
        const genStart = Date.now();
        addLog('Enhanced', '✍️ สร้างเนื้อหา Enhanced...');
        const res = await callInternal('/api/summarize', {
          text: newsData.newsBody,
          newsTitle: newsData.newsTitle,
          breakdownData,
          sourceType: detectedType,
          mode: 'analyze',
          contentLength: selectedLength,
          emotionalBlueprint: blueprint,
          researchData: researchItems.length > 0 ? { items: researchItems } : null,
        });
        if (!res.success) throw new Error(res.error || 'Enhanced generate ไม่สำเร็จ');
        addLog('Enhanced', `✅ ${res.data.versions?.length || 0} เวอร์ชัน Enhanced (${((Date.now() - genStart) / 1000).toFixed(1)}s)`);
        return { analysisData: res.data, blueprint, researchItems };
      })(),
    ]);

    addLog('Parallel', `✅ ทั้งสอง pipeline เสร็จ (${((Date.now() - stepParallelStart) / 1000).toFixed(1)}s)`);

    // === รวม versions ทั้งหมด ===
    const classicData = classicResult.status === 'fulfilled' ? classicResult.value : null;
    const enhancedData = enhancedBundle.status === 'fulfilled' ? enhancedBundle.value : null;

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

    const blueprint = enhancedData?.blueprint || null;
    const researchItems = enhancedData?.researchItems || [];

    // log สรุป
    if (classicResult.status === 'rejected') addLog('Classic', `❌ ${classicResult.reason?.message || 'failed'}`);
    if (enhancedBundle.status === 'rejected') addLog('Enhanced', `❌ ${enhancedBundle.reason?.message || 'failed'}`);
    if (allVersions.length === 0) throw new Error('ทั้ง Classic และ Enhanced สร้างเนื้อหาไม่สำเร็จ');

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
