'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import { useWorkflow } from '@/components/WorkflowContext';
import UniversalInputBox from '@/components/UniversalInputBox';
import InputSection from '@/components/content/InputSection';
import ExtractedView from '@/components/content/ExtractedView';
import ResultVersions from '@/components/content/ResultVersions';

// Client-side image resize — ป้องกัน 413 Request Too Large
function resizeImage(file, maxPx = 800, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else       { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const SOURCE_TYPES = [
  { value: 'url', label: '🔗 URL ข่าว/เว็บไซต์', desc: 'วางลิงก์ข่าว, บทความ, โพสต์' },
  { value: 'image', label: '📷 แคปภาพ/รูปโพสต์', desc: 'วางภาพ (Ctrl+V) หรือลากไฟล์มา' },
  { value: 'raw', label: '📝 ข้อความ', desc: 'วางข้อความหรือพิมพ์เอง' },
  { value: 'facebook', label: '📘 Facebook', desc: 'วาง URL โพสต์ Facebook' },
  { value: 'tiktok', label: '🎵 TikTok', desc: 'วาง URL วิดีโอ TikTok' },
  { value: 'youtube', label: '📺 YouTube', desc: 'ดึง transcript จาก YouTube' },
];

const getErrorMessage = (error) => {
  if (!error) return 'เกิดข้อผิดพลาดในการประมวลผล';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    return error.message || error.error || JSON.stringify(error);
  }
  return String(error);
};

function NewContentPageInner() {
  const [sourceType, setSourceType] = useState('url');
  const [url, setUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');

  // Flow state
  const [step, setStep] = useState('input'); // input → extracted → analyzed
  const [extracted, setExtracted] = useState(null);
  const [newsData, setNewsData] = useState(null);
  const [breakdownData, setBreakdownData] = useState(null);
  const [breakdownPromptText, setBreakdownPromptText] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [showDebug, setShowDebug] = useState(false);

  const [workflowId, setWorkflowId] = useState(null);
  const [researchData, setResearchData] = useState(null);
  const [selectedResearch, setSelectedResearch] = useState([]);
  const [researching, setResearching] = useState(false);
  const [contentLength, setContentLength] = useState('short'); // short | medium | long
  const [addedResearchItems, setAddedResearchItems] = useState([]); // เก็บ research ที่เพิ่มแล้ว
  const [archiveSaved, setArchiveSaved] = useState(false); // ป้องกัน save ซ้ำ
  const [blueprintData, setBlueprintData] = useState(null); // Emotional Blueprint จาก AI
  const [editedBlueprint, setEditedBlueprint] = useState(null); // version ที่ user แก้ไขแล้ว
  const [blueprinting, setBlueprinting] = useState(false); // loading state
  const [simulatedComments, setSimulatedComments] = useState([]); // AI Simulated Comments
  const [factPoolData, setFactPoolData] = useState(null); // Smart Research Fact Pool
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [tiktokNeedUpload, setTiktokNeedUpload] = useState(false);

  // === โหลดข้อมูลจากคลังข่าว (ถ้ามี ?archive_id) ===
  const searchParams = useSearchParams();
  useEffect(() => {
    const archiveId = searchParams?.get('archive_id');
    if (!archiveId) return;
    fetch(`/api/news-archive/${archiveId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          const item = d.data;
          setNewsData({ newsTitle: item.title, newsBody: item.body, sourceUrl: item.source_url || '' });
          setExtracted({ title: item.title, text: item.body, url: item.source_url || '' });
          setStep('extracted');
          setUrl(item.source_url || '');
          setArchiveSaved(true);
          console.log('[Archive] ✅ Loaded from archive:', archiveId);
        }
      })
      .catch(() => {});
  }, [searchParams]);

  // === Auto-save เข้าคลังข่าว ===
  const autoSaveToArchive = useCallback(async (newsDataArg, breakdownDataArg) => {
    if (archiveSaved) return;
    try {
      const res = await fetch('/api/news-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newsDataArg?.newsTitle || '',
          newsBody: newsDataArg?.newsBody || '',
          sourceUrl: newsDataArg?.sourceUrl || newsDataArg?.url || '',
          sourceType: sourceType || 'web',
          breakdownData: breakdownDataArg || null,
          workflowId,
          archivedBy: 'auto',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setArchiveSaved(true);
        console.log('[Archive] ✅ Auto-saved:', data.data?.id, '|', data.data?.category);
      }
    } catch (e) {
      console.warn('[Archive] Auto-save failed (non-critical):', e.message);
    }
  }, [archiveSaved, sourceType, workflowId]);
  const [videoFile, setVideoFile] = useState(null);
  const [youtubeNeedUpload, setYoutubeNeedUpload] = useState(false);
  const [sentToReview, setSentToReview] = useState({}); // { versionIndex: true }
  const [sendingReview, setSendingReview] = useState(null);
  const [autoMode, setAutoMode] = useState(false);
  const [autoProgress, setAutoProgress] = useState('');
  const [autoLog, setAutoLog] = useState([]);
  const [universalDetection, setUniversalDetection] = useState(null); // ✅ Phase 6: detection result from /api/auto/process
  const [liveDetection, setLiveDetection] = useState(null); // ✅ Phase 6: live detection from UniversalInputBox

  // Queue system states
  const [queueJobId, setQueueJobId] = useState(null);
  const [queuePosition, setQueuePosition] = useState(0);
  const [queueStatus, setQueueStatus] = useState(null); // 'pending' | 'processing' | 'completed' | 'failed'
  const [queuePolling, setQueuePolling] = useState(false);

  // Image Composer states
  const [newsImages, setNewsImages] = useState([]);         // File[] ที่ user อัปโหลด
  const [newsImagePreviews, setNewsImagePreviews] = useState([]); // base64 preview
  const [composingImage, setComposingImage] = useState(false);
  const [composedImages, setComposedImages] = useState(null); // { layout, text }
  const [imageLayout, setImageLayout] = useState(null);     // layout JSON จาก AI

  // Workflow tracker
  const { startWorkflow, startStep: wfStart, completeStep: wfComplete, failStep: wfFail, finishWorkflow } = useWorkflow();

  // === 📋 Queue System — ส่งผ่านคิวเพื่อป้องกันระบบล่ม ===
  const submitViaQueue = async (payload) => {
    // 1. Add to queue
    const addRes = await fetch('/api/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const addData = await addRes.json();
    if (!addData.success) {
      throw new Error(addData.error || 'ส่งคิวไม่สำเร็จ');
    }

    const { jobId, position, queuesAhead } = addData;
    const workerUrl = addData._workerUrl; // fallback trigger URL
    setQueueJobId(jobId);
    setQueuePosition(position);
    setQueueStatus('pending');
    setQueuePolling(true);

    if (queuesAhead > 0) {
      setAutoProgress(`📋 อยู่ในคิวลำดับที่ ${position} (รอ ${queuesAhead} คิวก่อนหน้า) ประมาณ ${queuesAhead * 3} นาที`);
    } else {
      setAutoProgress('⚡ กำลังประมวลผล...');
    }

    // 2. Poll for result
    const maxPollTime = 15 * 60 * 1000; // 15 minutes max (pipeline can take >12min)
    const startTime = Date.now();
    let workerRetriggerCount = 0;
    let notFoundCount = 0; // ★ Track consecutive 'job not found' responses
    let lastSeenStatus = 'pending'; // ★ Track last known status

    while (Date.now() - startTime < maxPollTime) {
      await new Promise(r => setTimeout(r, 3000)); // poll every 3s

      try {
        // ★ cache:'no-store' + AbortSignal.timeout — แยก signal ออกจาก React lifecycle
        // ป้องกัน React concurrent re-render abort ทำให้ poll ตาย
        const statusRes = await fetch(`/api/queue/status?id=${jobId}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000), // 8s per poll — independent from React
        });
        const statusData = await statusRes.json();

        if (!statusData.success) {
          notFoundCount++;
          console.warn(`[Queue] Job ${jobId.slice(0,8)} not found (${notFoundCount}/5) — last status: ${lastSeenStatus}`);
          // ★★ ถ้า job หายไปหลังจากเคยเห็น processing → backend เสร็จแล้วแต่ถูก purge!
          if (notFoundCount >= 5 || (notFoundCount >= 3 && lastSeenStatus === 'processing')) {
            console.warn('[Queue] Job was purged after completion — treating as success');
            setQueuePolling(false);
            // Return empty result — handleAutoMode will check and show error
            return { data: null, _jobPurged: true };
          }
          continue;
        }
        
        notFoundCount = 0; // reset on successful poll
        lastSeenStatus = statusData.status;

        setQueueStatus(statusData.status);
        setQueuePosition(statusData.position || 0);

        // === Fallback: re-trigger worker if still pending after 10s ===
        if (statusData.status === 'pending' && (Date.now() - startTime > 10000) && workerRetriggerCount < 3) {
          workerRetriggerCount++;
          console.log(`[Queue] Job still pending, re-triggering worker (attempt ${workerRetriggerCount})`);
          fetch('/api/queue/worker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'retry' }), cache: 'no-store' }).catch(() => {});
        }

        if (statusData.status === 'pending') {
          const ahead = statusData.queuesAhead || 0;
          setAutoProgress(`📋 รอคิว (ลำดับที่ ${statusData.position}) มี ${ahead} คิวก่อนหน้า ประมาณ ${ahead * 3} นาที`);
        } else if (statusData.status === 'processing') {
          setAutoProgress('⚡ กำลังประมวลผล... (อาจใช้เวลา 2-4 นาที)');
        } else if (statusData.status === 'completed') {
          setQueuePolling(false);
          return statusData.result; // Return the result data
        } else if (statusData.status === 'failed') {
          setQueuePolling(false);
          throw new Error(statusData.error || 'คิวประมวลผลไม่สำเร็จ');
        }
      } catch (pollErr) {
        // ★ AbortError/TimeoutError = React lifecycle หรือ 8s timeout → retry ทันที
        if (pollErr.name === 'AbortError' || pollErr.name === 'TimeoutError') {
          console.warn(`[Queue] Poll ${pollErr.name} — retrying...`);
          continue; // ไม่นับเป็น error จริง — retry loop
        }
        if (pollErr.message?.includes('คิวประมวลผลไม่สำเร็จ')) throw pollErr;
        console.warn('[Queue] Poll error:', pollErr.message);
      }
    }

    setQueuePolling(false);
    throw new Error('หมดเวลารอคิว (15 นาที) กรุณาลองใหม่');
  };

  // === ⚡ Auto Mode — วาง URL → ได้ผลลัพธ์ ===
  const handleAutoMode = async (inputData) => {
    if (autoMode || loading) return;
    const { url: targetUrl, type } = inputData;
    if (!targetUrl || targetUrl.length < 5) { setError('กรุณาใส่แหล่งข้อมูล'); return; }
    
    setAutoMode(true);
    setAutoProgress('🔍 กำลังตรวจจับแหล่งข้อมูล...');
    setAutoLog([]);
    setError('');
    setStep('input');
    setNewsData(null); setBreakdownData(null); setAnalysisResult(null);
    setSourceType(type || 'url');
    setUrl(targetUrl);

    // Start workflow tracker
    const domain = targetUrl ? (() => { try { return new URL(targetUrl).hostname; } catch { return targetUrl.slice(0, 30); } })() : 'unknown';
    startWorkflow('Auto Pipeline V2', [
      { id: 'auto_detect', label: 'ตรวจจับแหล่งข้อมูล' },
      { id: 'auto_scrape', label: 'ดึงเนื้อหา' },
      { id: 'auto_extract', label: 'สกัดเนื้อข่าว (AI)' },
      { id: 'auto_breakdown', label: 'แตกประเด็น (AI)' },
      { id: 'auto_blueprint', label: '🧬 วาง Emotional Blueprint' },
      { id: 'auto_research', label: '🔍 ค้นหาข้อมูล (Google)' },
      { id: 'auto_classic', label: '⚡ Classic Generate' },
      { id: 'auto_enhanced', label: '🧬 Enhanced Generate' },
    ], { type: 'URL', label: domain });
    wfStart('auto_detect', { detail: 'ตรวจสอบประเภท URL...' });

    try {
      setAutoProgress('⚡ AI กำลังประมวลผลทุกขั้นตอนอัตโนมัติ...');
      wfComplete('auto_detect', `Source: ${domain}`);
      wfStart('auto_scrape', { api: '/api/auto', detail: 'กำลังส่งข้อมูลไป Auto Pipeline...' });

      // === ตั้ง timer animate steps ระหว่าง polling (ให้ UI ไม่ค้าง) ===
      // Real timings: Scrape 8s | Extract 12s | Breakdown 30-60s | Blueprint+Research 15s | Generate A1 60-120s | Generate A2 60-120s
      const stepTimeline = [
        { at: 8,   fn: () => { wfComplete('auto_scrape', 'ดึงเนื้อหาสำเร็จ'); wfStart('auto_extract', { model: 'Gemini 2.0 Flash', api: '/api/summarize?mode=extract', detail: 'อ่านเนื้อเว็บ → สกัด newsTitle + newsBody...' }); } },
        { at: 22,  fn: () => { wfComplete('auto_extract', 'สกัดเนื้อข่าวสำเร็จ'); wfStart('auto_breakdown', { model: 'GPT-5.5', api: '/api/summarize?mode=breakdown', detail: 'วิเคราะห์ core story + key points + possible angles...' }); } },
        { at: 60,  fn: () => { wfComplete('auto_breakdown', 'วิเคราะห์มุมข่าวสำเร็จ'); wfStart('auto_blueprint', { model: 'GPT-5.5', api: '/api/summarize?mode=blueprint', detail: 'วาง emotional arc: hook → twist → CTA...' }); } },
        { at: 78,  fn: () => { wfComplete('auto_blueprint', 'วาง Blueprint สำเร็จ'); wfStart('auto_research', { api: 'Serper Google Search API', detail: 'ค้นหาข้อเท็จจาก Google × angles...' }); } },
        { at: 95,  fn: () => { wfComplete('auto_research', 'ค้นหาข้อมูลสำเร็จ'); wfStart('auto_classic', { model: 'Claude Sonnet 4', api: '/api/summarize?mode=analyze', detail: 'Angle 1: Research → Generate 2 เวอร์ชัน...' }); } },
        { at: 200, fn: () => { wfComplete('auto_classic', '✅ Angle 1 สำเร็จ'); wfStart('auto_enhanced', { model: 'Claude Sonnet 4', api: '/api/summarize?mode=analyze', detail: 'กำลังเขียน Angle 2 + Blueprint inject + research facts — อาจใช้เวลา 2-4 นาที...' }); } },
      ];
      const animateStart = Date.now();
      let animateIdx = 0;
      const animateTimer = setInterval(() => {
        const elapsed = (Date.now() - animateStart) / 1000;
        while (animateIdx < stepTimeline.length && elapsed >= stepTimeline[animateIdx].at) {
          stepTimeline[animateIdx].fn();
          animateIdx++;
        }
        if (animateIdx >= stepTimeline.length) clearInterval(animateTimer);
      }, 1000);

      // === Queue-based submission ===
      const queueResult = await submitViaQueue({
        input: targetUrl,
        url: targetUrl,
        contentLength,
        userId: 'web-user',
      });
      clearInterval(animateTimer); // หยุด animation
      
      // ★ ถ้า job ถูก purge ก่อน polling จะเอาผลลัพธ์ → แจ้ง error
      if (queueResult?._jobPurged) {
        throw new Error('ประมวลผลเสร็จแล้วแต่ผลลัพธ์หายไป — กรุณาลองใหม่อีกครั้ง');
      }
      
      const data = { success: true, data: queueResult?.data || queueResult };

      if (!data.success) {
        const errMsg = getErrorMessage(data.error);
        const errorWithStep = new Error(errMsg);
        errorWithStep.failedStep = data.failedStep || 'auto_scrape';
        throw errorWithStep;
      }

      const st = data.data.stepTimings || {};
      const pi = data.data.usedPromptInfo;
      const newsTitle = data.data.newsData?.newsTitle || '';
      const anglesCount = data.data.breakdownData?.possible_angles?.length || 0;
      const versionsCount = data.data.analysisResult?.versions?.length || 0;
      const classicCount = data.data.classicVersionCount || 0;
      const enhancedCount = data.data.enhancedVersionCount || 0;

      // ─── ✅ Sequential replay with actual stepTimings from API ────
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      const resCount = data.data.researchItems?.length || 0;
      const promptLabel = pi?.source === 'library' ? `🏛️ ${pi.name?.slice(0, 20)}` : `📦 Library`;

      wfComplete('auto_scrape', `ดึง ${data.data.newsData?.newsBody?.length || 0} ตัวอักษร | ${st.scrape || '?'}s`);
      await delay(200);

      wfStart('auto_extract', { api: '/api/auto → GPT-4o-mini', detail: `EXTRACT prompt → "${newsTitle.slice(0,30)}..."` });
      await delay(280);
      wfComplete('auto_extract', `"${newsTitle.slice(0, 40)}" | ${st.extract || '?'}s`);
      await delay(200);

      wfStart('auto_breakdown', { api: '/api/auto → GPT-4o-mini', detail: 'BREAKDOWN prompt → วิเคราะห์มุมข่าว' });
      await delay(280);
      wfComplete('auto_breakdown', `${anglesCount} มุมข่าว | ${st.breakdown || '?'}s`);
      await delay(200);

      wfStart('auto_blueprint', { api: '/api/auto → GPT-4o', detail: 'BLUEPRINT prompt → Emotional Architecture' });
      await delay(280);
      wfComplete('auto_blueprint', data.data.blueprint?.core_emotion
        ? `"${data.data.blueprint.core_emotion}" | ${st.blueprint || '?'}s`
        : `⚠️ Blueprint ข้ามไป`);
      await delay(200);

      wfStart('auto_research', { api: 'KEYWORD prompt → Serper API', detail: 'ค้นหาข้อมูลจริงจาก Google...' });
      await delay(280);
      wfComplete('auto_research', resCount > 0
        ? `✅ ${resCount} แหล่งข้อมูล | ${st.research || '?'}s`
        : `⚠️ ไม่พบข้อมูลเพิ่มเติม`);
      await delay(200);

      wfStart('auto_classic', { api: `/api/summarize ×${classicCount} → Claude`, detail: `Classic prompts from Library` });
      await delay(280);
      wfComplete('auto_classic', `✅ ${classicCount} เวอร์ชัน | ${st.classic || '?'}s`);
      await delay(200);

      wfStart('auto_enhanced', { api: `/api/summarize ×${enhancedCount} → Claude`, detail: `Enhanced + Blueprint inject` });
      await delay(280);
      wfComplete('auto_enhanced', `✅ ${enhancedCount} เวอร์ชัน | ${st.enhanced || '?'}s`);
      await delay(150);

      finishWorkflow(`✅ ${data.data.totalTimeSeconds || '?'}s — ${versionsCount} เวอร์ชัน (${classicCount}+${enhancedCount}) | ${promptLabel}`);

      setNewsData(data.data.newsData);
      setBreakdownData(data.data.breakdownData);
      setAnalysisResult(data.data.analysisResult);
      setSourceType(data.data.sourceType);
      setAutoLog(data.data.log || []);
      // inject blueprint + research จาก enhanced pipeline
      if (data.data.blueprint) {
        setBlueprintData(data.data.blueprint);
        setEditedBlueprint(JSON.parse(JSON.stringify(data.data.blueprint)));
      }
      if (data.data.researchItems?.length > 0) {
        setResearchData({ items: data.data.researchItems, keywords: [] });
      }
      if (data.data.simulatedComments?.length > 0) {
        setSimulatedComments(data.data.simulatedComments);
      }
      if (data.data.factPool) {
        setFactPoolData(data.data.factPool);
      }
      
      // ✅ Handle Auto Image Cover
      if (data.data.autoCoverResult?.success && data.data.autoCoverResult?.base64) {
        setComposedImages({
          layout: { imageBase64: data.data.autoCoverResult.base64 }
        });
      }

      // === ⚡ Image Pipeline (ถ้ามีรูป) ===
      if (newsImagePreviews.length > 0) {
        setComposingImage(true);
        setAutoProgress('🖼️ AI กำลังวิเคราะห์รูปและสร้างปกข่าว...');
        try {
          // Step 1: Analyze layout
          const analyzeRes = await fetch('/api/image-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              images: newsImagePreviews,
              newsTitle: data.data.newsData?.newsTitle || '',
              newsType: data.data.breakdownData?.category || '',
            }),
          });
          const analyzeData = await analyzeRes.json();
          if (analyzeData.success) {
            setImageLayout(analyzeData.layout);
            // Step 2: Compose
            const composeRes = await fetch('/api/image-compose', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                images: newsImagePreviews,
                layout: analyzeData.layout,
                newsTitle: data.data.newsData?.newsTitle || '',
                generateText: true,
              }),
            });
            const composeData = await composeRes.json();
            if (composeData.success) setComposedImages(composeData.versions);
          }
        } catch (imgErr) {
          console.warn('[ImagePipeline] non-critical error:', imgErr.message);
        } finally {
          setComposingImage(false);
        }
      }
      setStep('analyzed');
      setAutoProgress('');
      // 📦 Auto-save เข้าคลังข่าว
      autoSaveToArchive(data.data.newsData, data.data.breakdownData).catch(() => {});
    } catch (err) {
      const failStep = err.failedStep || 'auto_scrape';
      wfFail(failStep, err.message);
      setError('Auto Pipeline: ' + err.message);
      setAutoProgress('');
    } finally {
      setAutoMode(false);
      setQueuePolling(false);
    }
  };

  // === 🌐 Universal Auto Submit — รองรับทุก input type ===

  const handleUniversalSubmit = async (inputText, inputImages) => {
    if (autoMode || loading) return;
    if (!inputText && inputImages.length === 0) return;

    const hasUrl  = /https?:\/\//.test(inputText);
    const hasImg  = inputImages.length > 0;
    const textOnly = inputText.replace(/https?:\/\/\S+/g, '').trim();
    const hasText  = textOnly.length > 20;

    // ถ้าเป็น URL เดียว ไม่มีรูป → ใช้ /api/auto เดิม (full enhanced pipeline)
    if (hasUrl && !hasImg) {
      const urlMatch = inputText.match(/https?:\/\/\S+/);
      if (urlMatch) {
        setUrl(urlMatch[0]);
        setSourceType('url');
        // เรียก handleAutoMode ด้วย URL ที่ detect ได้
        await handleAutoMode({ url: urlMatch[0], type: 'url' });
        return;
      }
    }

    // Universal route → /api/auto/process (image, text, hybrid, multi-url)
    setAutoMode(true);
    setAutoProgress('🔍 ตรวจจับและ route pipeline...');
    setAutoLog([]);
    setError('');
    setStep('input');
    setNewsData(null); setBreakdownData(null); setAnalysisResult(null);

    const inputLabel = hasImg ? `รูปภาพ ${inputImages.length} ใบ` : textOnly.slice(0, 30) || 'input';
    const pipelineType = hasImg ? 'Image + Text' : 'Text Pipeline';
    // แสดง 8 steps ตรงกับ Enhanced Pipeline ตั้งแต่แรก (text ทำ 8 steps จริง)
    startWorkflow(`Enhanced Pipeline — ${pipelineType}`, [
      { id: 'auto_detect',    label: '🔍 ตรวจจับแหล่งข้อมูล' },
      { id: 'auto_scrape',    label: '📡 ดึงเนื้อหา' },
      { id: 'auto_extract',   label: '📰 สกัดเนื้อข่าว (AI)' },
      { id: 'auto_breakdown', label: '🔎 แตกประเด็น (AI)' },
      { id: 'auto_blueprint', label: '🧬 วาง Emotional Blueprint' },
      { id: 'auto_research',  label: '🔍 ค้นหาข้อมูล (Google)' },
      { id: 'auto_classic',   label: '⚡ Multi-Angle Generate' },
      { id: 'auto_enhanced',  label: '🧬 Enhanced Generate' },
    ], { type: pipelineType, label: inputLabel });

    try {
      wfStart('auto_detect', { detail: 'กำลัง detect ประเภทข้อมูล...' });
      setAutoProgress('⚡ Enhanced AI Pipeline กำลังประมวลผล...');

      // === ตั้ง timer animate steps ระหว่าง polling ===
      // Timing based on real pipeline measurements
      const stepTimeline = [
        { at: 3,   fn: () => { wfComplete('auto_detect', `✅ ${pipelineType}`); wfStart('auto_scrape', { detail: 'ดึงเนื้อหา...' }); } },
        { at: 8,   fn: () => { wfComplete('auto_scrape', 'ดึงเนื้อหาสำเร็จ'); wfStart('auto_extract', { model: 'Gemini 2.0 Flash', api: '/api/summarize?mode=extract', detail: 'อ่านเนื้อเว็บ → สกัด newsTitle + newsBody...' }); } },
        { at: 22,  fn: () => { wfComplete('auto_extract', 'สกัดเนื้อข่าวสำเร็จ'); wfStart('auto_breakdown', { model: 'GPT-5.5', api: '/api/summarize?mode=breakdown', detail: 'วิเคราะห์ core story + key points + possible angles...' }); } },
        { at: 60,  fn: () => { wfComplete('auto_breakdown', 'วิเคราะห์มุมข่าวสำเร็จ'); wfStart('auto_blueprint', { model: 'GPT-5.5', api: '/api/summarize?mode=blueprint', detail: 'วาง emotional arc: hook → twist → CTA...' }); } },
        { at: 78,  fn: () => { wfComplete('auto_blueprint', 'วาง Blueprint สำเร็จ'); wfStart('auto_research', { api: 'Serper Google Search API', detail: 'ค้นหาข้อเท็จจาก Google × angles...' }); } },
        { at: 95,  fn: () => { wfComplete('auto_research', 'ค้นหาข้อมูลสำเร็จ'); wfStart('auto_classic', { model: 'Claude Sonnet 4', api: '/api/summarize?mode=analyze', detail: 'Multi-Angle generate × 3 angles ทำพร้อมกัน...' }); } },
        { at: 170, fn: () => { wfComplete('auto_classic', '✅ สร้าง Classic สำเร็จ'); wfStart('auto_enhanced', { model: 'Claude Sonnet 4', api: '/api/summarize?mode=analyze (enhanced)', detail: 'กำลังเขียน Enhanced + Blueprint inject + research facts — อาจใช้เวลา 2-4 นาที...' }); } },
      ];
      const animateStart = Date.now();
      let animateIdx = 0;
      const animateTimer = setInterval(() => {
        const elapsed = (Date.now() - animateStart) / 1000;
        while (animateIdx < stepTimeline.length && elapsed >= stepTimeline[animateIdx].at) {
          stepTimeline[animateIdx].fn();
          animateIdx++;
        }
        if (animateIdx >= stepTimeline.length) clearInterval(animateTimer);
      }, 1000);

      // === Queue-based submission ===
      const queueResult = await submitViaQueue({
        input: inputText,
        images: inputImages,
        contentLength,
        userId: 'web-user',
      });

      clearInterval(animateTimer); // หยุด animation
      const data = { success: true, ...(queueResult || {}) };
      if (!data.success) {
        const errMsg = getErrorMessage(data.error || 'Universal process failed');
        const errorWithStep = new Error(errMsg);
        errorWithStep.failedStep = data.failedStep || 'auto_extract';
        throw errorWithStep;
      }

      // ─── Finalize steps กับข้อมูลจริงจาก API ───
      const st = data.data?.stepTimings || {};
      const pi = data.data?.usedPromptInfo;
      const newsTitle = data.data?.newsData?.newsTitle || data.newsData?.newsTitle || '';
      const anglesCount = data.data?.breakdownData?.possible_angles?.length || data.breakdownData?.possible_angles?.length || 0;
      const versionsCount = data.data?.analysisResult?.versions?.length || data.analysisResult?.versions?.length || 0;
      const classicCount = data.data?.classicVersionCount || 0;
      const enhancedCount = data.data?.enhancedVersionCount || 0;
      const resCount = data.data?.researchItems?.length || 0;
      const promptLabel = pi?.source === 'library' ? `🏛️ ${pi.name?.slice(0, 20)}` : `📦 Library`;
      const pipelineIcon = data.detection?.pipelineIcon || '📝';
      const pipelineLbl = data.detection?.pipelineLabel || pipelineType;

      const delay = (ms) => new Promise(r => setTimeout(r, ms));

      // Finalize ทุก step ด้วยข้อมูลจริง (ไม่ว่า animated ไปถึงไหนแล้ว)
      wfComplete('auto_detect', `${pipelineIcon} ${pipelineLbl} (${Math.round((data.detection?.confidence || 0.9) * 100)}%)`);
      wfComplete('auto_scrape', `ดึง ${data.data?.newsData?.newsBody?.length || data.newsData?.newsBody?.length || 0} ตัวอักษร | ${st.scrape || '✓'}s`);
      await delay(100);
      wfComplete('auto_extract', `"${newsTitle.slice(0, 40)}" | ${st.extract || '✓'}s`);
      wfComplete('auto_breakdown', `${anglesCount} มุมข่าว | ${st.breakdown || '✓'}s`);
      await delay(100);
      const bpData = data.data?.blueprint || null;
      wfComplete('auto_blueprint', bpData?.core_emotion
        ? `"${bpData.core_emotion}" | ${st.blueprint || '✓'}s`
        : `⚠️ Blueprint ข้ามไป`);
      wfComplete('auto_research', resCount > 0
        ? `✅ ${resCount} แหล่งข้อมูล | ${st.research || '✓'}s`
        : `⚠️ ไม่พบข้อมูลเพิ่มเติม`);
      await delay(100);
      wfComplete('auto_classic', `✅ ${classicCount} เวอร์ชัน | ${st.classic || '✓'}s`);
      wfComplete('auto_enhanced', `✅ ${enhancedCount} เวอร์ชัน | ${st.enhanced || '✓'}s`);

      finishWorkflow(`✅ ${data.data?.totalTimeSeconds || data.debug?.durationSeconds || '?'}s — ${versionsCount} เวอร์ชัน (${classicCount}+${enhancedCount}) | ${promptLabel}`);

      // Store detection info for debug panel
      setUniversalDetection(data.detection);

      // ✅ Phase 3: use data.analysisResult directly (top-level from process route)
      setNewsData(data.newsData);
      setBreakdownData(data.breakdownData);
      setAnalysisResult(data.analysisResult || {
        versions:  data.data?.versions || [],
        usedPreset:{ name: data.detection?.pipelineLabel },
      });
      setSourceType(data.detection?.platform || 'universal');
      setAutoLog(data.debug?.log || []);

      // ✅ Phase 3: set url from response for result display
      const sourceUrl = data.newsData?.sourceUrl || data.normalized?.title && data.detection?.primaryUrl;
      if (sourceUrl) setUrl(sourceUrl);

      autoSaveToArchive(data.newsData, data.breakdownData).catch(() => {});
      if (data.simulatedComments?.length > 0) {
        setSimulatedComments(data.simulatedComments);
      }
      // ✅ Smart Research Fact Pool from Universal flow
      const universalFactPool = data.factPool || data.data?.factPool;
      if (universalFactPool) {
        setFactPoolData(universalFactPool);
      }
      
      // ✅ Handle Auto Image Cover
      if (data.autoCoverResult?.success && data.autoCoverResult?.base64) {
        setComposedImages({
          layout: { imageBase64: data.autoCoverResult.base64 }
        });
      } else if (data.autoCoverResult?.status === 'NEED_MANUAL_COVER') {
        setAutoLog(prev => [...prev, `⚠️ แจ้งเตือน: หาภาพของจริงเพื่อสร้างปกอัตโนมัติไม่สำเร็จ (${data.autoCoverResult.message}) โปรดอัปโหลดภาพเอง`]);
      }

      setStep('analyzed');
      setAutoProgress('');
    } catch (err) {
      wfFail(err.failedStep || (err.name === 'AbortError' ? 'u_timeout' : 'u_unknown'), err.message);
      setError('❌ ' + (err.name === 'AbortError' ? 'หมดเวลา (Timeout 15 นาที) กรุณาลองใหม่' : err.message));
      setAutoProgress('');
    } finally {
      setAutoMode(false);
      setQueuePolling(false);
    }
  };

  const handleSendToReview = async (version, index) => {
    setSendingReview(index);
    try {
      const angles = breakdownData?.possible_angles?.map(a => a.angle_name) || [];
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: version.title || newsData?.newsTitle || 'ไม่มีหัวข้อ',
          content: version.content || '',
          hook: version.hook || '',
          closing: version.closing || '',
          style: version.style || '',
          tone: version.tone || '',
          target: version.target || '',
          sourceType,
          presetLabel: analysisResult?.usedPreset?.name || analysisResult?.usedPreset?.id || '🏛️ Library',
          contentLength,
          wordCount: version.content?.split(/\s+/).length || 0,
          angles,
          newsTitle: newsData?.newsTitle || '',
          newsSource: url || '',
          sourceVersion: version._source || 'classic', // 'classic' | 'enhanced'
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSentToReview(prev => ({ ...prev, [index]: true }));
      } else {
        setError('ส่งไม่สำเร็จ: ' + (data.error || 'ไม่ทราบสาเหตุ'));
      }
    } catch (err) {
      setError('ส่งไม่สำเร็จ: ' + err.message);
    } finally {
      setSendingReview(null);
    }
  };




  // === STEP 1: ดึงเนื้อหาจาก URL ===
  const handleExtract = async () => {
    // Auto-detect TikTok URL → สลับไปใช้ Whisper ถอดเสียงอัตโนมัติ
    if (url && (url.includes('tiktok.com') || url.includes('vm.tiktok.com'))) {
      setSourceType('tiktok');
      handleTikTokTranscribe('url');
      return;
    }

    // Auto-detect YouTube URL → สลับไปดึง transcript
    if (url && (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('youtube.com/shorts'))) {
      setSourceType('youtube');
      handleYouTubeTranscribe('url');
      return;
    }

    setExtracting(true);
    setError('');
    setExtracted(null);
    startWorkflow('ดึงเนื้อหา', [{ id: 'scrape', label: 'ดึงเนื้อหาจาก URL' }], { type: sourceType, label: url?.slice(0, 40) });
    wfStart('scrape', { api: '/api/extract', detail: `Scraping ${url?.slice(0, 40)}...` });
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: sourceType }),
      });
      let data;
      try {
        const text = await res.text();
        data = JSON.parse(text);
      } catch (err) {
        throw new Error(`ดึงข้อมูลไม่สำเร็จ (${res.status}): ได้รับการตอบรับที่ผิดพลาดจากเซิร์ฟเวอร์`);
      }
      const result = data.data || data;

      if (result.success && result.text) {
        setExtracted(result);
        setRawText(result.text);
        wfComplete('scrape', `ได้ ${result.text.length} ตัวอักษร`);
        finishWorkflow(`ดึงเนื้อหาสำเร็จ`);
      } else {
        setExtracted({ success: false, error: result.error || 'ดึงเนื้อหาไม่ได้', suggestion: 'paste' });
        setError((result.error || 'ดึงเนื้อหาไม่ได้') + ' — วาง/พิมพ์ข้อความด้านล่างแทนได้เลย');
        wfFail('scrape', result.error || 'ดึงเนื้อหาไม่ได้');
      }
    } catch (err) {
      setExtracted({ success: false, error: err.message, suggestion: 'paste' });
      setError(err.message + ' — วาง/พิมพ์ข้อความด้านล่างแทนได้เลย');
      wfFail('scrape', err.message);
    } finally {
      setExtracting(false);
    }
  };

  // === Image OCR Handlers ===
  const processImageFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const handleImagePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        processImageFile(item.getAsFile());
        return;
      }
    }
  };

  const handleImageDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) processImageFile(file);
  };

  const handleImageOCR = async () => {
    if (!imageFile) return;
    setExtracting(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('image', imageFile);
      const res = await fetch('/api/ocr', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.text) {
        setRawText(data.text);
        setExtracted({ success: true, title: data.title || 'ข่าวจากภาพ' });
      } else {
        setError(data.error || 'อ่านภาพไม่สำเร็จ');
      }
    } catch (err) {
      setError('อ่านภาพไม่สำเร็จ: ' + err.message);
    } finally {
      setExtracting(false);
    }
  };

  // === TikTok Transcription Handler ===

  const handleTikTokTranscribe = async (mode = 'url') => {
    setExtracting(true);
    setError('');
    try {
      let res;
      if (mode === 'upload' && videoFile) {
        const formData = new FormData();
        formData.append('video', videoFile);
        res = await fetch('/api/tiktok', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/tiktok', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
      }
      const data = await res.json();
      if (data.success && data.text) {
        setRawText(data.text);
        setExtracted({ success: true, title: data.title || 'คลิป TikTok' });
        setTiktokNeedUpload(false);
      } else if (data.needUpload) {
        setTiktokNeedUpload(true);
        setError('ดาวน์โหลดอัตโนมัติไม่สำเร็จ — อัปโหลดไฟล์วิดีโอแทนได้เลย');
      } else {
        setError(data.error || 'ถอดเสียงไม่สำเร็จ');
      }
    } catch (err) {
      setError('ถอดเสียงไม่สำเร็จ: ' + err.message);
    } finally {
      setExtracting(false);
    }
  };

  // === YouTube Transcript Handler ===

  const handleYouTubeTranscribe = async (mode = 'url') => {
    setExtracting(true);
    setError('');
    try {
      let res;
      if (mode === 'upload' && videoFile) {
        const formData = new FormData();
        formData.append('video', videoFile);
        res = await fetch('/api/youtube', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
      }
      const data = await res.json();
      if (data.success && data.text) {
        setRawText(data.text);
        setExtracted({ success: true, title: data.title || 'คลิป YouTube' });
        setYoutubeNeedUpload(false);
      } else if (data.needUpload) {
        setYoutubeNeedUpload(true);
        setError(data.error || 'ไม่มี subtitle — อัปโหลดไฟล์วิดีโอแทนได้');
      } else {
        setError(data.error || 'ดึง transcript ไม่สำเร็จ');
      }
    } catch (err) {
      setError('ดึง transcript ไม่สำเร็จ: ' + err.message);
    } finally {
      setExtracting(false);
    }
  };

  // === STEP 2: สกัดเนื้อข่าว (AI extraction) ===
  const handleExtractNews = async () => {
    if (!rawText) return;
    setLoading(true);
    setError('');
    startWorkflow('สกัดเนื้อข่าว', [{ id: 'ai_extract', label: 'สกัดเนื้อข่าว (AI)' }]);
    wfStart('ai_extract', { api: '/api/summarize (extract)', detail: 'AI กำลังอ่านและสกัดข่าว...' });
    try {
      let wfId = workflowId;
      if (!wfId) {
        const wfRes = await fetch('/api/workflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceType }) });
        const wfData = await wfRes.json();
        if (wfData.success) { wfId = wfData.workflowId; setWorkflowId(wfId); }
      }
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText, sourceType, customPrompt, mode: 'extract', workflowId: wfId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(getErrorMessage(data.error));
      setNewsData(data.data);
      setStep('extracted');
      wfComplete('ai_extract', `"${data.data?.newsTitle?.slice(0, 40) || '...'}"`);
      finishWorkflow('สกัดเนื้อข่าวสำเร็จ');
    } catch (err) {
      setError(err.message);
      wfFail('ai_extract', err.message);
    } finally {
      setLoading(false);
    }
  };

  // === STEP 2.5: แตกประเด็น + สรุปใจความ (Full Context Pipeline) ===
  const handleBreakdown = async () => {
    if (!newsData?.newsBody) return;
    setLoading(true);
    setError('');
    startWorkflow('แตกประเด็น', [{ id: 'ai_breakdown', label: 'แตกประเด็น + สรุป (AI)' }]);
    wfStart('ai_breakdown', { api: '/api/summarize (breakdown)', detail: 'AI กำลังวิเคราะห์มุมข่าว...' });
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newsData.newsBody,
          newsTitle: newsData.newsTitle,
          customPrompt: breakdownPromptText,
          mode: 'breakdown',
          workflowId,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(getErrorMessage(data.error));
      setBreakdownData(data.data);
      if (data.debug) {
        console.log('[Breakdown Debug]', data.debug);
      }
      wfComplete('ai_breakdown', `${data.data?.possible_angles?.length || 0} มุมข่าว, ${data.data?.key_points?.length || 0} ประเด็น`);
      finishWorkflow('แตกประเด็นสำเร็จ');
      // 📦 Auto-save เข้าคลังข่าว (fire-and-forget)
      autoSaveToArchive(newsData, data.data).catch(() => {});
    } catch (err) {
      setError(err.message);
      wfFail('ai_breakdown', err.message);
    } finally {
      setLoading(false);
    }
  };

  // === Blueprint: วางแผน Emotional Architecture ===
  const handleBlueprint = async () => {
    if (!newsData?.newsBody) return;
    setBlueprinting(true);
    setError('');
    setBlueprintData(null);
    setEditedBlueprint(null);
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newsData.newsBody,
          newsTitle: newsData.newsTitle,
          mode: 'blueprint',
          breakdownData: breakdownData || null,
          workflowId,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(getErrorMessage(data.error));
      setBlueprintData(data.data.blueprint);
      setEditedBlueprint(JSON.parse(JSON.stringify(data.data.blueprint))); // deep copy for editing
      console.log('[Blueprint] ✅ Got blueprint:', data.data.blueprint?.core_emotion);
    } catch (err) {
      setError(err.message);
    } finally {
      setBlueprinting(false);
    }
  };

  // === STEP 4: AI วิเคราะห์แนวข่าว → เลือก Prompt จากหอสมุด → สร้างเนื้อหา ===
  const handleAnalyze = async () => {
    if (!newsData?.newsBody) return;
    setLoading(true);
    setError('');
    startWorkflow('สร้างผลลัพธ์', [
      { id: 'lib_check', label: '🧠 วิเคราะห์แนวข่าว → ค้นหอสมุด' },
      { id: 'ai_analyze', label: 'สร้างเนื้อหา (AI เลือก Prompt)' },
    ]);
    wfStart('lib_check', { detail: '🧠 AI กำลังวิเคราะห์แนวข่าว → เทียบกับ Prompt Library...' });
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newsData.newsBody,
          newsTitle: newsData.newsTitle,
          sourceType,
          customPrompt,
          mode: 'analyze',
          breakdownData: breakdownData || null,
          researchData: researchData || (addedResearchItems.length > 0 ? { items: addedResearchItems } : null),
          contentLength,
          workflowId,
          emotionalBlueprint: editedBlueprint || blueprintData || null, // inject blueprint
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(getErrorMessage(data.error));
      // แสดง prompt source ใน tracker (เหมือน Auto mode)
      const ps = data.data?.usedPreset;
      const nt = data.data?.debug?.newsTypeDetected || '';
      if (nt && ps?.source === 'library') {
        wfComplete('lib_check', `🧠 ข่าว${nt} → 🏛️ "${ps.name}" (Viral: ${ps.viralScore || '-'})`);
      } else if (nt && ps?.source !== 'library') {
        wfComplete('lib_check', `🧠 ข่าว${nt} → ❌ ไม่พบ Prompt ที่เหมาะในหอสมุด`);
      } else if (ps?.source === 'library') {
        wfComplete('lib_check', `🏛️ ใช้: ${ps.name} (Score: ${ps.viralScore || '-'})`);
      } else {
        wfComplete('lib_check', `❌ ไม่พบ Prompt ที่ตรงในหอสมุด`);
      }
      const promptLabel = ps?.source === 'library' ? `🏛️ ${ps.name?.slice(0, 20)}` : `📦 ${ps?.name || 'Preset'}`;
      wfStart('ai_analyze', { api: '/api/summarize (analyze)', detail: `✍️ ${promptLabel} → กำลังสร้างเนื้อหา...` });
      setAnalysisResult(data.data);
      setStep('analyzed');
      wfComplete('ai_analyze', `${data.data?.versions?.length || 0} เวอร์ชัน`);
      finishWorkflow(`สร้างเสร็จ — ${data.data?.versions?.length || 0} เวอร์ชัน | ${promptLabel}`);
    } catch (err) {
      setError(err.message);
      wfFail(err.message?.includes('Prompt') ? 'lib_check' : 'ai_analyze', err.message);
    } finally {
      setLoading(false);
    }
  };

  // === STEP 4B: AI ผสมมุมข่าว — เลือกหัวข้อดีที่สุดมาผสมเป็นเนื้อหาใหม่ ===
  const handleMixAngles = async () => {
    if (!newsData?.newsBody || !breakdownData) return;
    setLoading(true);
    setError('');
    startWorkflow('ผสมมุมข่าว', [
      { id: 'lib_check', label: 'ตรวจ Prompt Library' },
      { id: 'ai_mix', label: 'AI ผสมมุมข่าว' },
    ]);
    wfStart('lib_check', { detail: 'กำลังค้น Prompt จากหอสมุดไวรัล...' });
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newsData.newsBody,
          newsTitle: newsData.newsTitle,
          sourceType,
          customPrompt,
          mode: 'mix',
          breakdownData,
          researchData: researchData || (addedResearchItems.length > 0 ? { items: addedResearchItems } : null),
          contentLength,
          workflowId,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(getErrorMessage(data.error));
      const ps = data.data?.usedPreset;
      const nt = data.data?.debug?.newsTypeDetected || '';
      if (nt && ps?.source === 'library') {
        wfComplete('lib_check', `🧠 ข่าว${nt} → 🏛️ "${ps.name}" (Viral: ${ps.viralScore || '-'})`);
      } else if (nt) {
        wfComplete('lib_check', `🧠 ข่าว${nt} → ❌ ไม่พบ Prompt ที่เหมาะในหอสมุด`);
      } else if (ps?.source === 'library') {
        wfComplete('lib_check', `🏛️ ใช้: ${ps.name} (Score: ${ps.viralScore || '-'})`);
      } else {
        wfComplete('lib_check', `❌ ไม่พบ Prompt ที่ตรงในหอสมุด`);
      }
      const promptLabel = ps?.source === 'library' ? `🏛️ ${ps.name?.slice(0, 20)}` : `📦 Preset`;
      wfStart('ai_mix', { api: '/api/summarize (mix)', detail: `✍️ ${promptLabel} → AI กำลังผสมมุมที่ดีที่สุด...` });
      setAnalysisResult(data.data);
      setStep('analyzed');
      wfComplete('ai_mix', `${data.data?.versions?.length || 0} เวอร์ชัน`);
      finishWorkflow(`ผสมเสร็จ — ${data.data?.versions?.length || 0} เวอร์ชัน | ${promptLabel}`);
    } catch (err) {
      setError(err.message);
      wfFail('ai_mix', err.message);
    } finally {
      setLoading(false);
    }
  };

  // === AI หาข้อมูลเพิ่มเติม (Serper Real Search) ===
  const handleResearch = async () => {
    if (!newsData?.newsTitle) return;
    setResearching(true);
    setError('');
    setResearchData(null);
    setSelectedResearch([]);
    try {
      const res = await fetch('/api/research-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsBody: newsData.newsBody,
          newsTitle: newsData.newsTitle,
          breakdownData: breakdownData || null,
          workflowId,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(getErrorMessage(data.error));
      setResearchData(data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setResearching(false);
    }
  };

  // Toggle เลือก/ไม่เลือก research item
  const toggleResearchItem = (idx) => {
    setSelectedResearch(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  // เพิ่มข้อมูลที่เลือกเข้า newsBody (ไม่ auto-breakdown — ให้ผู้ใช้กดเอง)
  const handleAddResearch = async () => {
    if (selectedResearch.length === 0 || !researchData?.items) return;
    const selectedItems = researchData.items.filter((_, i) => selectedResearch.includes(i));

    // สร้างข้อความเพิ่มเติม — ใส่ source URL ด้วย
    const additionalText = '\n\n=== ข้อมูลเพิ่มเติมจาก Google Search (ข้อมูลจริง) ===\n' +
      selectedItems.map(item =>
        `[${item.keyword || item.type}] ${item.title}\n${item.content}` +
        (item.sourceUrl ? `\nแหล่งอ้างอิง: ${item.sourceName || item.sourceUrl} (${item.sourceUrl})` : '') +
        (item.relevance ? `\nเกี่ยวข้อง: ${item.relevance}` : '')
      ).join('\n\n') +
      '\n=== จบข้อมูลเพิ่มเติม ===';

    // เพิ่มเข้า newsBody ทันที
    const enrichedBody = (newsData.newsBody || '') + additionalText;
    setNewsData(prev => ({ ...prev, newsBody: enrichedBody }));

    // แสดง feedback
    setCopied('research_added');
    setTimeout(() => setCopied(''), 3000);

    console.log(`[Research] ✅ Added ${selectedItems.length} items with URLs (${additionalText.length}ch) to newsBody.`);

    // เคลียร์ selection + ซ่อน panel + เก็บ items ที่เพิ่มแล้ว
    setAddedResearchItems(prev => [...prev, ...selectedItems]);
    setSelectedResearch([]);
    setResearchData(null);
  };

  // Copy
  const copyText = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  // Reset
  const handleReset = () => {
    setStep('input'); setExtracted(null); setRawText(''); setUrl('');
    setError(''); setNewsData(null); setBreakdownData(null); setAnalysisResult(null);
    setWorkflowId(null); setResearchData(null); setSelectedResearch([]); setAddedResearchItems([]);
    setCustomPrompt(''); setBreakdownPromptText('');
    setImageFile(null); setImagePreview(null);
    setTiktokNeedUpload(false); setVideoFile(null); setYoutubeNeedUpload(false);
    setSentToReview({}); setSendingReview(null);
    setAutoMode(false); setAutoProgress(''); setAutoLog([]);
    setQueueJobId(null); setQueuePosition(0); setQueueStatus(null); setQueuePolling(false);
    setSimulatedComments([]);
    setFactPoolData(null);
    // W12 fix: clear state ที่เคยขาด
    setArchiveSaved(false);
    setBlueprintData(null); setEditedBlueprint(null); setBlueprinting(false);
    setComposedImages(null); setComposingImage(false);
    setNewsImages([]); setNewsImagePreviews([]);
    setUniversalDetection(null); setLiveDetection(null);
  };

  const needsUrl = ['url', 'facebook', 'tiktok', 'youtube'].includes(sourceType);
  const placeholders = {
    url: 'https://www.thairath.co.th/news/...',
    facebook: 'https://www.facebook.com/username/posts/...',
    tiktok: 'https://www.tiktok.com/@user/video/...',
    youtube: 'https://www.youtube.com/watch?v=...',
  };

  return (
    <>
      <Header title="✨ สร้างคอนเทนต์ใหม่" subtitle="1. ป้อนข้อมูล → 2. สกัด+แตกประเด็น+หาข้อมูล → 3. เลือก Prompt สร้างเนื้อหา" />
      <div className="page-content">
        {loading && (
          <div className="loading-overlay">
            <div className="spinner" />
            <div className="loading-text">
              {step === 'input' ? '📥 กำลังสกัดเนื้อข่าว...' :
               step === 'extracted' ? (researching ? '🔎 AI กำลังหาข้อมูลเพิ่มเติม...' : '🔍 กำลังแตกประเด็น...') :
               '🤖 กำลังสร้างเนื้อหาด้วย AI...'}
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: '14px 20px', marginBottom: 20, color: 'var(--danger)', fontSize: 13 }}>
            ❌ {error}
            <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        )}

        {/* Pipeline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
          {['1. ป้อนข้อมูล', '2. สกัด + แตกประเด็น + หาข้อมูล', '3. ผลลัพธ์เนื้อหา'].map((label, i) => {
            const steps = ['input', 'extracted', 'analyzed'];
            const currentIdx = steps.indexOf(step);
            const status = i < currentIdx ? 'done' : i === currentIdx ? 'active' : '';
            return (
              <span key={i} style={{ display: 'contents' }}>
                <div className={`pipeline-step ${status}`} onClick={() => i <= currentIdx && setStep(steps[i])} style={{ cursor: i <= currentIdx ? 'pointer' : 'default' }}>
                  {label}
                </div>
                {i < 2 && <span className="pipeline-arrow">→</span>}
              </span>
            );
          })}
          {step !== 'input' && (
            <button onClick={handleReset} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>🔄 เริ่มใหม่</button>
          )}
        </div>

        {/* ===== STEP 1: Input ===== */}
        {step === 'input' && (
          <div className="card slide-up">
      <InputSection
        states={{ autoMode, liveDetection, contentLength, newsImagePreviews, autoProgress, composingImage, universalDetection, autoLog, composedImages, imageLayout, sourceType, url, tiktokNeedUpload, youtubeNeedUpload, videoFile, imagePreview, imageFile, extracting, extracted, rawText, customPrompt, loading, queuePolling, queuePosition, queueStatus }}
        setters={{ setLiveDetection, setContentLength, setNewsImages, setNewsImagePreviews, setSourceType, setExtracted, setRawText, setError, setImageFile, setImagePreview, setTiktokNeedUpload, setVideoFile, setYoutubeNeedUpload, setUrl, setCustomPrompt }}
        handlers={{ handleUniversalSubmit, handleTikTokTranscribe, handleAutoMode, handleYouTubeTranscribe, handleExtract, handleImagePaste, handleImageDrop, handleImageOCR, handleExtractNews, processImageFile }}
        utils={{ resizeImage, SOURCE_TYPES, placeholders }}
      />
    </div>
        )}

        {/* ===== STEP 2: Extracted — แสดงเนื้อข่าวสะอาด + เลือก preset วิเคราะห์ ===== */}
        {step === 'extracted' && newsData && (
          <div className="card slide-up">
      <ExtractedView
        states={{ newsData, copied, breakdownPromptText, loading, blueprinting, blueprintData, editedBlueprint, researchData, researching, selectedResearch, addedResearchItems, breakdownData, customPrompt, sourceType, contentLength, workflowId }}
        handlers={{ copyText, setBreakdownPromptText, handleBreakdown, handleBlueprint, setEditedBlueprint, handleResearch, toggleResearchItem, setSelectedResearch, handleAddResearch, handleMixAngles, handleAnalyze, setContentLength }}
      />
    </div>
        )}

        {/* ===== STEP 4: Analyzed — ผลลัพธ์หลายเวอร์ชัน ===== */}
        {step === 'analyzed' && analysisResult && (
          <div className="card slide-up">
      <ResultVersions
        states={{ analysisResult, composedImages, composingImage, imageLayout, newsData, copied, sentToReview, sendingReview, simulatedComments, loading, researchData, factPoolData }}
        handlers={{ copyText, handleSendToReview, setCopied, handleAnalyze, handleReset }}
      />
    </div>
        )}
      </div>
    </>
  );
}

export default function NewContentPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>กำลังโหลด...</div>}>
      <NewContentPageInner />
    </Suspense>
  );
}
