'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import { useWorkflow } from '@/components/WorkflowContext';
import UniversalInputBox from '@/components/UniversalInputBox';
import InputSection from '@/components/content/InputSection';
import ExtractedView from '@/components/content/ExtractedView';
import ResultVersions from '@/components/content/ResultVersions';
import { getPublishablePostText } from '@/lib/utils/publishablePostText';

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

function readQueueRecoveryToken(storage) {
  try {
    const target = storage || globalThis.localStorage;
    const token = JSON.parse(target.getItem('vf_last_job') || 'null');
    return token?.jobId ? token : null;
  } catch {
    return null;
  }
}

function queueRecoveryTokenMatches(current, expected) {
  return Boolean(
    current?.jobId
      && expected?.jobId
      && current.jobId === expected.jobId
      && Number(current.at || 0) === Number(expected.at || 0),
  );
}

function clearQueueRecoveryTokenIfOwned(expected, storage) {
  try {
    const target = storage || globalThis.localStorage;
    if (!queueRecoveryTokenMatches(readQueueRecoveryToken(target), expected)) return false;
    target.removeItem('vf_last_job');
    return true;
  } catch {
    return false;
  }
}

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
  const archiveSavedRef = useRef(false); // ป้องกัน save ซ้ำโดยไม่ใช้ state ที่ไม่มีจุดแสดงผล
  const setArchiveSavedFlag = useCallback((value) => {
    archiveSavedRef.current = Boolean(value);
  }, []);
  const [blueprintData, setBlueprintData] = useState(null); // Emotional Blueprint จาก AI
  const [editedBlueprint, setEditedBlueprint] = useState(null); // version ที่ user แก้ไขแล้ว
  const [blueprinting, setBlueprinting] = useState(false); // loading state
  const [simulatedComments, setSimulatedComments] = useState([]); // AI Simulated Comments
  const [factPoolData, setFactPoolData] = useState(null); // Smart Research Fact Pool
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [tiktokNeedUpload, setTiktokNeedUpload] = useState(false);

  const [autoMode, setAutoMode] = useState(false);
  const [autoProgress, setAutoProgress] = useState('');
  const [autoLog, setAutoLog] = useState([]);
  const [universalDetection, setUniversalDetection] = useState(null); // detection result from /api/auto/process
  const [liveDetection, setLiveDetection] = useState(null);
  const [recoveryJob, setRecoveryJob] = useState(null); // { jobId, at, result }

  // Queue system states
  const [queueJobId, setQueueJobId] = useState(null);
  const [queuePosition, setQueuePosition] = useState(0);
  const [queueStatus, setQueueStatus] = useState(null); // 'pending' | 'processing' | 'completed' | 'failed'
  const [queuePolling, setQueuePolling] = useState(false);

  // Image Composer states
  const [newsImages, setNewsImages] = useState([]);
  const [newsImagePreviews, setNewsImagePreviews] = useState([]);
  const [composingImage, setComposingImage] = useState(false);
  const [composedImages, setComposedImages] = useState(null);
  const [imageLayout, setImageLayout] = useState(null);

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
          setArchiveSavedFlag(true);
          console.log('[Archive] ✅ Loaded from archive:', archiveId);
        }
      })
      .catch(() => {});
  }, [searchParams, setArchiveSavedFlag]);

  // === Auto-save เข้าคลังข่าว ===
  // ★ ใช้ ref กัน stale closure — เดิม callback จำค่า archiveSaved เก่า ทำให้ run ที่ 2 ใน session เดียวไม่ถูก save
  const autoSaveToArchive = useCallback(async (newsDataArg, breakdownDataArg, coverBase64Arg, metadataOverride = {}) => {
    if (archiveSavedRef.current && !metadataOverride.forceSave) return true;
    try {
      const res = await fetch('/api/news-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newsDataArg?.newsTitle || '',
          newsBody: newsDataArg?.newsBody || '',
          sourceUrl: newsDataArg?.sourceUrl || newsDataArg?.url || '',
          sourceType: metadataOverride.sourceType || sourceType || 'raw',
          breakdownData: breakdownDataArg || null,
          workflowId: metadataOverride.workflowId ?? workflowId,
          archivedBy: 'auto',
          coverImage: coverBase64Arg || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setArchiveSavedFlag(true);
        console.log('[Archive] ✅ Auto-saved:', data.data?.id, '|', data.data?.category, data.deduped ? '(deduped)' : '');
        return true;
      }
      console.warn('[Archive] Auto-save rejected:', data.error || `HTTP ${res.status}`);
      return false;
    } catch (e) {
      console.warn('[Archive] Auto-save failed (non-critical):', e.message);
      return false;
    }
  }, [sourceType, workflowId, setArchiveSavedFlag]);

  // ข่าวจากคิวจะถือว่า "จบ" ก็ต่อเมื่อคลังบันทึกสำเร็จจริงอย่างน้อยหนึ่งฝั่ง
  // เก็บ vf_last_job ไว้เมื่อทั้ง server/client ล้ม เพื่อให้ refresh แล้วกู้ผล+ลองบันทึกซ้ำได้
  const finalizeQueueArchive = useCallback(async (
    serverArchiveSaved,
    newsDataArg,
    breakdownDataArg,
    coverBase64Arg,
    metadataOverride = {},
    recoveryToken = null,
  ) => {
    const saved = serverArchiveSaved === true
      || await autoSaveToArchive(newsDataArg, breakdownDataArg, coverBase64Arg, metadataOverride);
    if (saved) {
      setArchiveSavedFlag(true);
      clearQueueRecoveryTokenIfOwned(recoveryToken, localStorage);
      return true;
    }
    setError('แสดงผลข่าวได้แล้ว แต่บันทึกเข้าคลังยังไม่สำเร็จ — งานยังไม่หาย กรุณารีเฟรชหน้าแล้วกด “ดูผลลัพธ์” เพื่อลองบันทึกอีกครั้ง');
    return false;
  }, [autoSaveToArchive, setArchiveSavedFlag]);

  // ★ Recovery: นำผลลัพธ์จาก queue job ที่เสร็จแล้วมาแสดง (ใช้ตอน UI หลุดจากการ poll)
  const applyQueueResult = useCallback(async (result) => {
    if (!result || typeof result !== 'object') {
      setError('ผลลัพธ์ที่กู้คืนไม่ถูกต้อง — ระบบไม่เปิดหน้าข่าวว่าง');
      return false;
    }
    const d = result.data || result;
    const nd = result.newsData || d.newsData || null;
    const bd = result.breakdownData || d.breakdownData || null;
    const ar = result.analysisResult || d.analysisResult || null;
    const recoveredWorkflowId = result.workflowId || d.workflowId || null;
    const recoveredSourceType = result.detection?.inputType
      || result.detection?.platform
      || d.detection?.inputType
      || d.detection?.platform
      || result.normalized?.sourceType
      || d.normalized?.sourceType
      || 'raw';
    if (!Array.isArray(ar?.versions) || ar.versions.length === 0) {
      setError('ผลลัพธ์ที่กู้คืนไม่มีเวอร์ชันข่าว — ระบบไม่เปิดหน้าข่าวว่าง');
      return false;
    }
    setNewsData(nd);
    setBreakdownData(bd);
    setAnalysisResult(ar);
    setWorkflowId(recoveredWorkflowId);
    setSourceType(recoveredSourceType);
    if (d.blueprint) { setBlueprintData(d.blueprint); setEditedBlueprint(JSON.parse(JSON.stringify(d.blueprint))); }
    if (d.researchItems?.length > 0) setResearchData({ items: d.researchItems, keywords: [] });
    if (d.factPool) setFactPoolData(d.factPool);
    setAutoLog(d.log || []);
    setStep('analyzed');
    setError('');
    setAutoProgress('');
    if (!(result.archiveSaved === true || d.archiveSaved === true)) {
      const coverBase64 = result.autoCoverResult?.success
        ? result.autoCoverResult.base64
        : (d.autoCoverResult?.success ? d.autoCoverResult.base64 : null);
      const saved = await autoSaveToArchive(nd, bd, coverBase64, {
        sourceType: recoveredSourceType,
        workflowId: recoveredWorkflowId,
        forceSave: true,
      });
      if (!saved) {
        setError('แสดงผลข่าวได้แล้ว แต่บันทึกเข้าคลังยังไม่สำเร็จ — กด “ดูผลลัพธ์” ซ้ำเพื่อลองบันทึกอีกครั้ง');
        return false;
      }
    }
    return true;
  }, [autoSaveToArchive, setWorkflowId, setSourceType]);

  // ★ Recovery: ตอนเปิดหน้า — เช็คว่ามี job ค้างที่เสร็จแล้วรอให้กู้ไหม
  useEffect(() => {
    let saved = null;
    saved = readQueueRecoveryToken(localStorage);
    if (!saved?.jobId) return;
    const expiresAt = (saved.at || 0) + 60 * 60 * 1000;
    if (Date.now() >= expiresAt) { // เกิน 1 ชม. — หมดอายุ
      clearQueueRecoveryTokenIfOwned(saved, localStorage);
      return;
    }

    let active = true;
    let pollTimer = null;
    let requestController = null;
    const ownsSavedJob = () => queueRecoveryTokenMatches(
      readQueueRecoveryToken(localStorage),
      saved,
    );
    const scheduleNext = () => {
      if (!active || !ownsSavedJob()) {
        active = false;
        return;
      }
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        clearQueueRecoveryTokenIfOwned(saved, localStorage);
        active = false;
        return;
      }
      pollTimer = setTimeout(() => {
        pollTimer = null;
        void pollStatus();
      }, Math.min(3000, remaining));
    };
    async function pollStatus() {
      if (!active || !ownsSavedJob()) {
        active = false;
        return;
      }
      const controller = new AbortController();
      requestController = controller;
      const requestTimeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`/api/queue/status?id=${saved.jobId}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const st = await response.json();
        if (!active || !ownsSavedJob()) {
          active = false;
          return;
        }
        if (st.success && st.status === 'completed') {
          if (!st.result || typeof st.result !== 'object') {
            setError('งานล่าสุดแจ้งว่าเสร็จแต่ไม่มีผลลัพธ์ — ระบบหยุดกู้เพื่อไม่แสดงข่าวว่าง');
            clearQueueRecoveryTokenIfOwned(saved, localStorage);
            active = false;
            return;
          }
          const recoveredData = st.result.data || st.result;
          const recoveredAnalysis = st.result.analysisResult || recoveredData.analysisResult;
          if (Array.isArray(recoveredAnalysis?.versions) && recoveredAnalysis.versions.length > 0) {
            setRecoveryJob({ jobId: saved.jobId, at: saved.at, result: st.result });
          } else {
            setError('งานล่าสุดแจ้งว่าเสร็จแต่ไม่มีเวอร์ชันข่าว — ระบบไม่กู้ผลลัพธ์ว่าง');
            clearQueueRecoveryTokenIfOwned(saved, localStorage);
          }
          active = false;
        } else if (st.success && st.status === 'failed') {
          setError(st.error || 'งานล่าสุดในคิวประมวลผลไม่สำเร็จ');
          clearQueueRecoveryTokenIfOwned(saved, localStorage);
          active = false;
        } else if (!st.success && (st.errorType === 'JOB_NOT_FOUND' || response.status === 404)) {
          setError(st.error || 'ไม่พบงานล่าสุดในคิวแล้ว กรุณาส่งข่าวใหม่อีกครั้ง');
          clearQueueRecoveryTokenIfOwned(saved, localStorage);
          active = false;
        } else {
          // pending/processing และข้อผิดพลาด status ชั่วคราว — เก็บ token แล้วติดตามต่อ
          scheduleNext();
        }
      } catch {
        // เน็ตสะดุด/คำขอหมดเวลา: เก็บ token และลองใหม่จนกว่าจะครบอายุ
        if (active) scheduleNext();
      } finally {
        clearTimeout(requestTimeout);
        if (requestController === controller) requestController = null;
      }
    }

    void pollStatus();
    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
      requestController?.abort();
    };
  }, []);

  const [videoFile, setVideoFile] = useState(null);
  const [youtubeNeedUpload, setYoutubeNeedUpload] = useState(false);
  const [sentToReview, setSentToReview] = useState({}); // { versionIndex: true }
  const [sendingReview, setSendingReview] = useState(null);

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
    const recoveryToken = { jobId, at: Date.now() };
    setQueueJobId(jobId);
    setQueuePosition(position);
    setQueueStatus('pending');
    setQueuePolling(true);

    // ★ Recovery: จำ jobId ไว้ — ถ้า UI หลุด/รีเฟรช/เน็ตสะดุด ระบบกู้ผลลัพธ์คืนได้
    setRecoveryJob(null);
    try { localStorage.setItem('vf_last_job', JSON.stringify(recoveryToken)); } catch {}

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
    let consecutiveNetErrors = 0; // ★ network error ติดกัน — ต้องโชว์ให้ผู้ใช้เห็น ห้ามเงียบ

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
          const isJobNotFound = statusData.errorType === 'JOB_NOT_FOUND' || statusRes.status === 404;
          if (!isJobNotFound) {
            notFoundCount = 0;
            consecutiveNetErrors++;
            console.warn(`[Queue] Status temporarily unavailable (${consecutiveNetErrors} ครั้ง) — preserving job ${jobId.slice(0,8)}`);
            if (consecutiveNetErrors >= 3) {
              setAutoProgress(`⚠️ อ่านสถานะคิวไม่ได้ชั่วคราว (พยายามใหม่ครั้งที่ ${consecutiveNetErrors}) — งานยังไม่ถูกลบและระบบกำลังติดตามต่อ`);
            }
            continue;
          }
          notFoundCount++;
          console.warn(`[Queue] Job ${jobId.slice(0,8)} not found (${notFoundCount}/5) — last status: ${lastSeenStatus}`);
          // ถ้า job หาย ห้ามเดาว่าสำเร็จ เพราะไม่มีผลลัพธ์ให้ตรวจหรือแสดง
          if (notFoundCount >= 5 || (notFoundCount >= 3 && lastSeenStatus === 'processing')) {
            setQueuePolling(false);
            clearQueueRecoveryTokenIfOwned(recoveryToken, localStorage);
            const missingError = new Error('ไม่พบผลลัพธ์ของงานในคิว — ระบบหยุดเพื่อไม่แสดงข่าวว่าง กรุณาลองใหม่');
            missingError.errorType = 'QUEUE_RESULT_MISSING';
            missingError.failedStep = 'queue_result';
            throw missingError;
          }
          continue;
        }
        
        notFoundCount = 0; // reset on successful poll
        consecutiveNetErrors = 0; // ★ เชื่อมต่อกลับมาแล้ว
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
          if (!statusData.result || typeof statusData.result !== 'object') {
            clearQueueRecoveryTokenIfOwned(recoveryToken, localStorage);
            const missingError = new Error('คิวแจ้งว่าเสร็จแต่ไม่มีผลลัพธ์ — ระบบหยุดเพื่อไม่แสดงข่าวว่าง');
            missingError.errorType = 'QUEUE_RESULT_MISSING';
            missingError.failedStep = 'queue_result';
            throw missingError;
          }
          return { result: statusData.result, recoveryToken };
        } else if (statusData.status === 'failed') {
          setQueuePolling(false);
          clearQueueRecoveryTokenIfOwned(recoveryToken, localStorage);
          const queueError = new Error(statusData.error || 'คิวประมวลผลไม่สำเร็จ');
          queueError.errorType = statusData.errorType || 'QUEUE_JOB_FAILED';
          queueError.failedStep = statusData.failedStep || 'queue_process';
          queueError.isQueueTerminal = true;
          throw queueError;
        }
      } catch (pollErr) {
        // ★ AbortError/TimeoutError = React lifecycle หรือ 8s timeout → retry ทันที
        if (pollErr.name === 'AbortError' || pollErr.name === 'TimeoutError') {
          console.warn(`[Queue] Poll ${pollErr.name} — retrying...`);
          continue; // ไม่นับเป็น error จริง — retry loop
        }
        if (pollErr.errorType === 'QUEUE_RESULT_MISSING'
            || pollErr.isQueueTerminal) throw pollErr;
        // ★ FIX: network error (server restart/เน็ตหลุด) เดิมกลืนเงียบ → UI ค้างตลอดกาล
        //   ตอนนี้โชว์สถานะ + ระบบ recovery จะกู้ผลลัพธ์ให้เมื่อกลับมาเชื่อมต่อได้
        consecutiveNetErrors++;
        console.warn(`[Queue] Poll error (${consecutiveNetErrors} ติดกัน):`, pollErr.message);
        if (consecutiveNetErrors >= 3) {
          setAutoProgress(`⚠️ การเชื่อมต่อสะดุด (พยายามใหม่ครั้งที่ ${consecutiveNetErrors}) — งานยังประมวลผลอยู่ฝั่งเซิร์ฟเวอร์ ไม่หาย ถ้าหน้าค้างนาน รีเฟรชหน้าได้เลย ระบบจะกู้ผลลัพธ์ให้`);
        }
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
    setArchiveSavedFlag(false); // Reset เพื่อให้ save ได้ทุกครั้ง
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
        { at: 22,  fn: () => { wfComplete('auto_extract', 'สกัดเนื้อข่าวสำเร็จ'); wfStart('auto_breakdown', { model: 'GPT-5.6 Sol', api: '/api/summarize?mode=breakdown', detail: 'วิเคราะห์ core story + key points + 4 มุมข่าว...' }); } },
        { at: 60,  fn: () => { wfComplete('auto_breakdown', 'วิเคราะห์มุมข่าวสำเร็จ'); wfStart('auto_blueprint', { model: 'GPT-5.5', api: '/api/summarize?mode=blueprint', detail: 'วาง emotional arc: hook → twist → CTA...' }); } },
        { at: 78,  fn: () => { wfComplete('auto_blueprint', 'วาง Blueprint สำเร็จ'); wfStart('auto_research', { api: 'Serper Google Search API', detail: 'ค้นหาข้อเท็จจาก Google × angles...' }); } },
        { at: 95,  fn: () => { wfComplete('auto_research', 'ค้นหาข้อมูลสำเร็จ'); wfStart('auto_classic', { model: 'Claude Opus 4.8', api: '/api/summarize?mode=analyze', detail: 'Angle 1: Research → Generate 2 เวอร์ชัน...' }); } },
        { at: 200, fn: () => { wfComplete('auto_classic', '✅ Angle 1 สำเร็จ'); wfStart('auto_enhanced', { model: 'Claude Opus 4.8', api: '/api/summarize?mode=analyze', detail: 'กำลังเขียน Angle 2 + Blueprint inject + research facts — อาจใช้เวลา 2-4 นาที...' }); } },
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
      const { result: queueResult, recoveryToken } = await submitViaQueue({
        input: targetUrl,
        url: targetUrl,
        contentLength,
        userId: 'web-user',
      });
      clearInterval(animateTimer); // หยุด animation
      
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

      wfStart('auto_extract', { api: '/api/auto → Gemini Flash', detail: `EXTRACT prompt → "${newsTitle.slice(0,30)}..."` });
      await delay(280);
      wfComplete('auto_extract', `"${newsTitle.slice(0, 40)}" | ${st.extract || '?'}s`);
      await delay(200);

      wfStart('auto_breakdown', { api: '/api/auto → GPT-5.6 Sol', detail: 'BREAKDOWN prompt → วิเคราะห์ 4 มุมข่าว' });
      await delay(280);
      wfComplete('auto_breakdown', `${anglesCount} มุมข่าว | ${st.breakdown || '?'}s`);
      await delay(200);

      wfStart('auto_blueprint', { api: '/api/auto → GPT-5.4-mini', detail: 'BLUEPRINT prompt → Emotional Architecture' });
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
      wfComplete('auto_classic', `✅ ${classicCount} เวอร์ชัน | ${st.generate || '?'}s`);
      await delay(200);

      wfStart('auto_enhanced', { api: `/api/summarize ×${enhancedCount} → Claude`, detail: `Enhanced + Blueprint inject` });
      await delay(280);
      wfComplete('auto_enhanced', `✅ ${enhancedCount} เวอร์ชัน | ${st.generate || '?'}s`);
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
              newsType: data.data.breakdownData?.primaryCategory || data.data.breakdownData?.category || '',
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
      // 📦 รอผลบันทึกจริงก่อนล้าง recovery token; ถ้าทั้งสองฝั่งล้ม ข่าวยังแสดงและลองบันทึกซ้ำได้
      const coverBase64 = data.data?.autoCoverResult?.success ? data.data.autoCoverResult.base64 : null;
      await finalizeQueueArchive(
        queueResult?.archiveSaved === true,
        data.data.newsData,
        data.data.breakdownData,
        coverBase64,
        {
          sourceType: data.data.detection?.inputType || data.data.detection?.platform || 'raw',
          workflowId: data.data.workflowId || null,
        },
        recoveryToken,
      );
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

    // ถ้าเป็น URL ล้วน ไม่มีรูป → ใช้ /api/auto เดิม; ถ้ามีข้อความประกอบห้ามทิ้งข้อความทั้งก้อน
    if (hasUrl && !hasImg && !hasText) {
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
    setArchiveSavedFlag(false); // Reset เพื่อให้ save ได้ทุกครั้ง
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
        { at: 22,  fn: () => { wfComplete('auto_extract', 'สกัดเนื้อข่าวสำเร็จ'); wfStart('auto_breakdown', { model: 'GPT-5.6 Sol', api: '/api/summarize?mode=breakdown', detail: 'วิเคราะห์ core story + key points + 4 มุมข่าว...' }); } },
        { at: 60,  fn: () => { wfComplete('auto_breakdown', 'วิเคราะห์มุมข่าวสำเร็จ'); wfStart('auto_blueprint', { model: 'GPT-5.5', api: '/api/summarize?mode=blueprint', detail: 'วาง emotional arc: hook → twist → CTA...' }); } },
        { at: 78,  fn: () => { wfComplete('auto_blueprint', 'วาง Blueprint สำเร็จ'); wfStart('auto_research', { api: 'Serper Google Search API', detail: 'ค้นหาข้อเท็จจาก Google × angles...' }); } },
        { at: 95,  fn: () => { wfComplete('auto_research', 'ค้นหาข้อมูลสำเร็จ'); wfStart('auto_classic', { model: 'Claude Opus 4.8', api: '/api/summarize?mode=analyze', detail: 'Multi-Angle generate × 3 angles ทำพร้อมกัน...' }); } },
        { at: 170, fn: () => { wfComplete('auto_classic', '✅ สร้าง Classic สำเร็จ'); wfStart('auto_enhanced', { model: 'Claude Opus 4.8', api: '/api/summarize?mode=analyze (enhanced)', detail: 'กำลังเขียน Enhanced + Blueprint inject + research facts — อาจใช้เวลา 2-4 นาที...' }); } },
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
      const { result: queueResult, recoveryToken } = await submitViaQueue({
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

      const resolvedAnalysis = data.analysisResult
        || data.data?.analysisResult
        || (Array.isArray(data.data?.versions) ? { versions: data.data.versions } : null);
      if (!Array.isArray(resolvedAnalysis?.versions) || resolvedAnalysis.versions.length === 0) {
        const missingResultError = new Error('ระบบประมวลผลเสร็จแต่ไม่มีเวอร์ชันข่าว — หยุดเพื่อไม่แสดงผลลัพธ์ว่าง');
        missingResultError.errorType = 'ANALYSIS_RESULT_MISSING';
        missingResultError.failedStep = 'auto_analyze';
        throw missingResultError;
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
      wfComplete('auto_classic', `✅ ${classicCount} เวอร์ชัน | ${st.generate || '✓'}s`);
      wfComplete('auto_enhanced', `✅ ${enhancedCount} เวอร์ชัน | ${st.generate || '✓'}s`);

      finishWorkflow(`✅ ${data.data?.totalTimeSeconds || data.debug?.durationSeconds || '?'}s — ${versionsCount} เวอร์ชัน (${classicCount}+${enhancedCount}) | ${promptLabel}`);

      // Store detection info for debug panel
      setUniversalDetection(data.detection);

      // ✅ Phase 3: use data.analysisResult directly (top-level from process route)
      setNewsData(data.newsData);
      setBreakdownData(data.breakdownData);
      setAnalysisResult(resolvedAnalysis);
      setWorkflowId(data.workflowId || data.data?.workflowId || null);
      setSourceType(data.detection?.inputType || data.detection?.platform || 'raw');
      setAutoLog(data.debug?.log || []);

      // ✅ Phase 3: set url from response for result display
      const sourceUrl = data.newsData?.sourceUrl || data.normalized?.title && data.detection?.primaryUrl;
      if (sourceUrl) setUrl(sourceUrl);

      // ★ รอผลบันทึกจริงก่อนล้าง recovery token; ถ้าทั้งสองฝั่งล้ม ข่าวยังแสดงและลองบันทึกซ้ำได้
      const coverBase64 = data.autoCoverResult?.success ? data.autoCoverResult.base64 : null;
      await finalizeQueueArchive(
        data.archiveSaved === true,
        data.newsData || data.data?.newsData,
        data.breakdownData || data.data?.breakdownData,
        coverBase64,
        {
          sourceType: data.detection?.inputType || data.detection?.platform || 'raw',
          workflowId: data.workflowId || data.data?.workflowId || null,
        },
        recoveryToken,
      );
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
      const publishableContent = getPublishablePostText(version);
      const reviewTitle = publishableContent.split(/\r?\n/u).find(line => line.trim())?.trim().slice(0, 160)
        || 'เนื้อข่าวรอตรวจ';
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: reviewTitle,
          content: publishableContent,
          hook: '',
          closing: '',
          style: version.style || '',
          tone: version.tone || '',
          target: version.target || '',
          sourceType,
          presetLabel: analysisResult?.usedPreset?.name || analysisResult?.usedPreset?.id || '🏛️ Library',
          contentLength,
          wordCount: publishableContent ? publishableContent.split(/\s+/u).length : 0,
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
      autoSaveToArchive(newsData, data.data, null).catch(() => {});
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
    setArchiveSavedFlag(false);
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

        {/* ★ Recovery Banner — งานล่าสุดเสร็จแล้วแต่ UI ไม่ได้รับผล (เน็ตหลุด/รีเฟรช/server restart) */}
        {recoveryJob && !autoMode && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid #10b981', borderRadius: 'var(--radius-md)', padding: '14px 20px', marginBottom: 20, fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>🧭</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, color: '#10b981' }}>พบงานล่าสุดที่ประมวลผลเสร็จแล้ว</div>
              <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                “{(recoveryJob.result?.newsData?.newsTitle || recoveryJob.result?.data?.newsData?.newsTitle || 'ข่าวที่สร้างเสร็จ').slice(0, 60)}” — {(recoveryJob.result?.analysisResult?.versions || recoveryJob.result?.data?.analysisResult?.versions || []).length} เวอร์ชัน
              </div>
            </div>
            <button
              onClick={async () => {
                if (!queueRecoveryTokenMatches(readQueueRecoveryToken(localStorage), recoveryJob)) {
                  setRecoveryJob(null);
                  return;
                }
                if (await applyQueueResult(recoveryJob.result)) {
                  clearQueueRecoveryTokenIfOwned(recoveryJob, localStorage);
                  setRecoveryJob(null);
                }
              }}
              className="btn btn-sm"
              style={{ background: '#10b981', color: '#fff', border: 'none', fontWeight: 700 }}
            >📥 ดูผลลัพธ์</button>
            <button
              onClick={() => {
                clearQueueRecoveryTokenIfOwned(recoveryJob, localStorage);
                setRecoveryJob(null);
              }}
              className="btn btn-ghost btn-sm"
            >ปิด</button>
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
