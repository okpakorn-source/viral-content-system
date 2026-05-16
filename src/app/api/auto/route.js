import { NextResponse } from 'next/server';

/**
 * Auto Pipeline API
 * รับ URL เดียว → ดึงเนื้อหา → สกัดข่าว → แตกประเด็น → สร้างผลลัพธ์
 * ทุก step ทำอัตโนมัติ ไม่ต้องกดอะไร
 */
export async function POST(request) {
  const startTime = Date.now();

  try {
    const { url, sourceType: forceType, preset, contentLength } = await request.json();

    if (!url || url.length < 5) {
      return NextResponse.json({ success: false, error: 'กรุณาใส่ URL' }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const selectedPreset = preset || 'viral_fb';
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
    let detectedType = forceType || 'url';
    if (!forceType) {
      if (/tiktok\.com/i.test(url)) detectedType = 'tiktok';
      else if (/youtube\.com|youtu\.be/i.test(url)) detectedType = 'youtube';
      else if (/facebook\.com|fb\.watch/i.test(url)) detectedType = 'facebook';
    }
    addLog('Detect', `Source: ${detectedType}`);

    // === STEP 1: ดึงเนื้อหา (Scrape / Transcribe) ===
    let rawText = '';

    if (detectedType === 'tiktok') {
      addLog('Step1', 'Transcribing TikTok...');
      const tikRes = await callInternal('/api/tiktok', { url });
      if (!tikRes.success) throw new Error(`TikTok: ${tikRes.error}`);
      rawText = tikRes.transcript || tikRes.text || '';
      addLog('Step1', `TikTok transcript: ${rawText.length}ch`);
    } else if (detectedType === 'youtube') {
      addLog('Step1', 'Getting YouTube transcript...');
      const ytRes = await callInternal('/api/youtube', { url });
      if (!ytRes.success) throw new Error(`YouTube: ${ytRes.error}`);
      rawText = ytRes.transcript || ytRes.text || '';
      addLog('Step1', `YouTube transcript: ${rawText.length}ch`);
    } else {
      // Web scraping
      addLog('Step1', 'Scraping URL...');
      const scrapeRes = await fetch(`${baseUrl}/api/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const scrapeData = await scrapeRes.json();
      if (!scrapeData.success) throw new Error(`Scrape: ${scrapeData.error}`);
      rawText = scrapeData.text || '';
      addLog('Step1', `Scraped: ${rawText.length}ch`);
    }

    if (!rawText || rawText.length < 20) {
      throw new Error('ไม่สามารถดึงเนื้อหาได้ (ข้อความสั้นเกินไป)');
    }

    // === STEP 2: สกัดข่าว (Extract) ===
    addLog('Step2', 'Extracting news...');
    const extractRes = await callInternal('/api/summarize', {
      text: rawText,
      sourceType: detectedType,
      mode: 'extract',
    });
    if (!extractRes.success || !extractRes.data?.newsBody) {
      throw new Error('สกัดข่าวไม่สำเร็จ');
    }
    const newsData = extractRes.data;
    addLog('Step2', `Extracted: "${newsData.newsTitle?.slice(0, 50)}" (${newsData.newsBody.length}ch)`);

    // === STEP 3: แตกประเด็น (Breakdown) ===
    addLog('Step3', 'Breaking down angles...');
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
    addLog('Step3', `Breakdown: ${breakdownData.key_points?.length || 0} points, ${breakdownData.possible_angles?.length || 0} angles`);

    // === STEP 4: สร้างเนื้อหา (Analyze/Generate) ===
    addLog('Step4', `Generating content (preset: ${selectedPreset}, length: ${selectedLength})...`);
    const analyzeRes = await callInternal('/api/summarize', {
      text: newsData.newsBody,
      newsTitle: newsData.newsTitle,
      breakdownData,
      sourceType: detectedType,
      mode: 'analyze',
      analysisPresetId: selectedPreset,
      contentLength: selectedLength,
    });
    if (!analyzeRes.success) {
      throw new Error('สร้างเนื้อหาไม่สำเร็จ');
    }
    const analysisResult = analyzeRes.data;
    addLog('Step4', `Generated: ${analysisResult.versions?.length || 0} versions`);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog('Done', `Total: ${totalTime}s`);

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
        log,
      },
    });

  } catch (error) {
    console.error('[AutoPipeline] ERROR:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
      totalTimeSeconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
    }, { status: 500 });
  }
}
