import { NextResponse } from 'next/server';
import { logPipeline } from '@/lib/pipelineLogger';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';

/**
 * Auto Pipeline API
 * รับ URL เดียว → ดึงเนื้อหา → สกัดข่าว → แตกประเด็น → สร้างผลลัพธ์
 * ทุก step ทำอัตโนมัติ ไม่ต้องกดอะไร
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
    await logPipeline({ workflowId: _autoWorkflowId, step: 'breakdown', status: 'success', duration: Date.now() - step3Start, detail: (breakdownData.key_points?.length || 0) + ' key points, ' + (breakdownData.possible_angles?.length || 0) + ' angles' }).catch(() => {});

    // === STEP 4: สร้างเนื้อหา (Analyze/Generate) ===
    const step4Start = Date.now();
    addLog('Step4', `📝 AI กำลังวิเคราะห์แนวข่าว → เทียบกับ Prompt Library → สร้างเนื้อหา...`);
    const analyzeRes = await callInternal('/api/summarize', {
      text: newsData.newsBody,
      newsTitle: newsData.newsTitle,
      breakdownData,
      sourceType: detectedType,
      mode: 'analyze',
      contentLength: selectedLength,
    });
    if (!analyzeRes.success) {
      // ส่ง error จริงออกมา (รวมถึง กรุณาเพิ่ม Prompt ในหอสมุดก่อน)
      throw new Error(analyzeRes.error || 'สร้างเนื้อหาไม่สำเร็จ');
    }
    const analysisResult = analyzeRes.data;
    addLog('Step4', `✅ สร้าง ${analysisResult.versions?.length || 0} เวอร์ชัน (${((Date.now() - step4Start) / 1000).toFixed(1)}s)`);
    await logPipeline({ workflowId: _autoWorkflowId, step: 'analyze', status: 'success', duration: Date.now() - step4Start, detail: (analysisResult.versions?.length || 0) + ' versions' }).catch(() => {});

    // === Prompt Library info ===
    const usedPreset = analysisResult.usedPreset || null;
    const newsType = analysisResult.debug?.newsTypeDetected || '';
    if (newsType) {
      addLog('Prompt', `🧠 AI วิเคราะห์: ข่าว${newsType}`);
    }
    if (usedPreset?.source === 'library') {
      addLog('Prompt', `🏛️ ใช้ Library: "${usedPreset.name}" (Viral: ${usedPreset.viralScore || '-'})`);
    } else if (usedPreset) {
      addLog('Prompt', `📦 ใช้ Preset: "${usedPreset.name}"`);
    }
    if (analysisResult.debug?.promptMatchReason) {
      addLog('Prompt', `${analysisResult.debug.promptMatchReason}`);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog('Done', `✅ เสร็จสมบูรณ์ ${totalTime}s`);
    await logPipeline({ workflowId: _autoWorkflowId, step: 'auto-pipeline', status: 'success', duration: Date.now() - startTime, detail: 'Total: ' + totalTime + 's' }).catch(() => {});

    return NextResponse.json({
      success: true,
      data: {
        newsData,
        breakdownData,
        analysisResult,
        sourceType: detectedType,
        preset: selectedPreset,
        contentLength: selectedLength,
        totalTimeSeconds: parseFloat(totalTime),
        usedPromptInfo: usedPreset ? {
          source: usedPreset.source,
          name: usedPreset.name,
          viralScore: usedPreset.viralScore || null,
          matchReason: analysisResult.debug?.promptMatchReason || '',
          newsType: newsType || '',
        } : null,
        stepTimings: {
          detect: ((step1Start - step0Start) / 1000).toFixed(1),
          scrape: ((step2Start - step1Start) / 1000).toFixed(1),
          extract: ((step3Start - step2Start) / 1000).toFixed(1),
          breakdown: ((step4Start - step3Start) / 1000).toFixed(1),
          generate: ((Date.now() - step4Start) / 1000).toFixed(1),
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
