'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import { useWorkflow } from '@/components/WorkflowContext';

const SOURCE_TYPES = [
  { value: 'url', label: '🔗 URL ข่าว/เว็บไซต์', desc: 'วางลิงก์ข่าว, บทความ, โพสต์' },
  { value: 'image', label: '📷 แคปภาพ/รูปโพสต์', desc: 'วางภาพ (Ctrl+V) หรือลากไฟล์มา' },
  { value: 'raw', label: '📝 ข้อความ', desc: 'วางข้อความหรือพิมพ์เอง' },
  { value: 'facebook', label: '📘 Facebook', desc: 'วาง URL โพสต์ Facebook' },
  { value: 'tiktok', label: '🎵 TikTok', desc: 'วาง URL วิดีโอ TikTok' },
  { value: 'youtube', label: '📺 YouTube', desc: 'ดึง transcript จาก YouTube' },
];

export default function NewContentPage() {
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
  const [workflowId, setWorkflowId] = useState(null);
  const [researchData, setResearchData] = useState(null);
  const [selectedResearch, setSelectedResearch] = useState([]);
  const [researching, setResearching] = useState(false);
  const [contentLength, setContentLength] = useState('short'); // short | medium | long
  const [addedResearchItems, setAddedResearchItems] = useState([]); // เก็บ research ที่เพิ่มแล้ว
  const [archiveSaved, setArchiveSaved] = useState(false); // ป้องกัน save ซ้ำ
  const [blueprintData, setBlueprintData] = useState(null); // Emotional Blueprint จาก AI
  const [editedBlueprint, setEditedBlueprint] = useState(null); // version ที่ user แก้ไขแล้ว
  const [blueprinting, setBlueprintting] = useState(false); // loading state
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

  // Workflow tracker
  const { startWorkflow, startStep: wfStart, completeStep: wfComplete, failStep: wfFail, finishWorkflow } = useWorkflow();

  // === ⚡ Auto Mode — วาง URL → ได้ผลลัพธ์ ===
  const handleAutoMode = async () => {
    if (!url || url.length < 5) { setError('กรุณาใส่ URL'); return; }
    setAutoMode(true);
    setAutoProgress('🔍 กำลังตรวจจับแหล่งข้อมูล...');
    setAutoLog([]);
    setError('');
    setStep('input');
    setNewsData(null); setBreakdownData(null); setAnalysisResult(null);

    // Start workflow tracker
    const domain = url ? (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 30); } })() : 'unknown';
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

      const res = await fetch('/api/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          contentLength,
        }),
      });
      const data = await res.json();

      if (!data.success) throw new Error(data.error);

      const st = data.data.stepTimings || {};
      const pi = data.data.usedPromptInfo;
      const newsTitle = data.data.newsData?.newsTitle || '';
      const anglesCount = data.data.breakdownData?.possible_angles?.length || 0;
      const versionsCount = data.data.analysisResult?.versions?.length || 0;
      const classicCount = data.data.classicVersionCount || 0;
      const enhancedCount = data.data.enhancedVersionCount || 0;

      // Tracker updates
      wfComplete('auto_scrape', `ดึงเนื้อหา ${data.data.newsData?.newsBody?.length || 0} ตัวอักษร (${st.scrape || '?'}s)`);

      wfStart('auto_extract', { detail: '📰 AI กำลังสกัดเนื้อข่าว...' });
      wfComplete('auto_extract', `"${newsTitle.slice(0, 35)}..." (${st.extract || '?'}s)`);

      wfStart('auto_breakdown', { detail: '🔍 AI กำลังวิเคราะห์มุมข่าว...' });
      wfComplete('auto_breakdown', `${anglesCount} มุมข่าว (${st.breakdown || '?'}s)`);

      // Blueprint step
      wfStart('auto_blueprint', { detail: '🧬 AI วางแผน Emotional Architecture...' });
      if (data.data.blueprint?.core_emotion) {
        wfComplete('auto_blueprint', `🧬 ${data.data.blueprint.core_emotion} | ${data.data.blueprint.emotional_timeline?.length || 0} steps`);
      } else {
        wfComplete('auto_blueprint', '⚠️ Blueprint ไม่สำเร็จ (ข้ามไป)');
      }

      // Research step
      wfStart('auto_research', { detail: '🔍 ค้นหาข้อมูลจาก Google...' });
      const resCount = data.data.researchItems?.length || 0;
      wfComplete('auto_research', resCount > 0 ? `✅ ${resCount} แหล่งข้อมูลจริง` : '⚠️ ไม่พบข้อมูลเพิ่มเติม');

      // Classic pipeline
      wfStart('auto_classic', { detail: '⚡ Classic pipeline กำลังสร้าง...' });
      wfComplete('auto_classic', `✅ ${classicCount} เวอร์ชัน Classic`);

      // Enhanced pipeline
      wfStart('auto_enhanced', { detail: '🧬 Enhanced pipeline กำลังสร้าง...' });
      wfComplete('auto_enhanced', `✅ ${enhancedCount} เวอร์ชัน Enhanced`);

      const promptLabel = pi?.source === 'library' ? `🏛️ ${pi.name?.slice(0, 20)}` : `📦 Library`;
      finishWorkflow(`Auto V2 ✅ ${data.data.totalTimeSeconds || ''}s — ${versionsCount} เวอร์ชัน (${classicCount} Classic + ${enhancedCount} Enhanced) | ${promptLabel}`);

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
      setStep('analyzed');
      setAutoProgress('');
      // 📦 Auto-save เข้าคลังข่าว
      autoSaveToArchive(data.data.newsData, data.data.breakdownData).catch(() => {});
    } catch (err) {
      wfFail('auto_scrape', err.message);
      setError('Auto Mode: ' + err.message);
      setAutoProgress('');
    } finally {
      setAutoMode(false);
    }
  };

  // === ส่งเข้าคลังรอตรวจ ===
  const handleSendToReview = async (version, index) => {
    setSendingReview(index);
    try {
      const angles = breakdownData?.possible_angles?.map(a => a.angle_name) || [];
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: version.title || newsData?.newsTitle || 'ไม่มีหัวข้อ',
          content: [version.hook ? `🪝 ${version.hook}` : '', version.title || '', version.content || '', version.closing ? `💬 ${version.closing}` : ''].filter(Boolean).join('\n\n'),
          sourceType,
          preset: analysisResult?.usedPreset?.id || 'library',
          presetLabel: analysisResult?.usedPreset?.name || '🏛️ Library',
          contentLength,
          wordCount: version.content?.split(/\s+/).length || 0,
          angles,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSentToReview(prev => ({ ...prev, [index]: true }));
      } else {
        setError(data.error || 'ส่งไม่สำเร็จ');
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
      const data = await res.json();
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
      if (!data.success) throw new Error(data.error);
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
      if (!data.success) throw new Error(data.error);
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
    setBlueprintting(true);
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
      if (!data.success) throw new Error(data.error);
      setBlueprintData(data.data.blueprint);
      setEditedBlueprint(JSON.parse(JSON.stringify(data.data.blueprint))); // deep copy for editing
      console.log('[Blueprint] ✅ Got blueprint:', data.data.blueprint?.core_emotion);
    } catch (err) {
      setError(err.message);
    } finally {
      setBlueprintting(false);
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
      if (!data.success) throw new Error(data.error);
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
      const promptLabel = ps?.source === 'library' ? `🏛️ ${ps.name?.slice(0, 20)}` : `📦 ${ps?.name || presetLabel}`;
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
      if (!data.success) throw new Error(data.error);
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
      if (!data.success) throw new Error(data.error);
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
            {/* ⚡ AUTO MODE */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(249,24,128,0.1), rgba(124,58,237,0.1))',
              border: '2px solid rgba(249,24,128,0.4)',
              borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 24,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 28 }}>⚡</span>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#f472b6' }}>Auto Mode</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>วาง URL แล้วรอรับผลลัพธ์ — AI คิดวิเคราะห์แทนทุกขั้นตอน</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <input
                  type="url" className="form-input"
                  placeholder="วาง URL ข่าว, TikTok, YouTube — ระบบตรวจจับอัตโนมัติ"
                  value={url} onChange={(e) => setUrl(e.target.value)}
                  disabled={autoMode}
                  style={{ flex: '1 1 200px', minWidth: 0 }}
                />
                <button onClick={handleAutoMode} disabled={!url || autoMode}
                  style={{
                    padding: '10px 20px', border: 'none', borderRadius: 'var(--radius-md)',
                    background: autoMode ? 'var(--bg-elevated)' : 'linear-gradient(135deg, #f91880, #7c3aed)',
                    color: '#fff', fontWeight: 800, fontSize: 13, cursor: autoMode ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap', boxShadow: autoMode ? 'none' : '0 4px 15px rgba(249,24,128,0.3)',
                    transition: 'all 0.3s',
                  }}>
                  {autoMode ? '⏳ กำลังประมวลผล...' : '⚡ Auto สร้างเลย'}
                </button>
              </div>

              {/* Preset + Length selectors */}
                            {/* ความยาวเนื้อหา */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {[
                  { id: 'short', label: '📝 สั้น' },
                  { id: 'medium', label: '📄 กลาง' },
                  { id: 'long', label: '📰 ยาว' },
                ].map(l => (
                  <button key={l.id} onClick={() => setContentLength(l.id)} disabled={autoMode}
                    style={{
                      padding: '4px 10px', fontSize: 10, fontWeight: 600,
                      background: contentLength === l.id ? 'var(--success)' : 'var(--bg-primary)',
                      color: contentLength === l.id ? '#fff' : 'var(--text-muted)',
                      border: `1px solid ${contentLength === l.id ? 'var(--success)' : 'var(--border)'}`,
                      borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {l.label}
                  </button>
                ))}
              </div>

              {/* Auto Progress */}
              {autoMode && (
                <div style={{
                  background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)', marginTop: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 20, height: 20, border: '3px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-light)' }}>{autoProgress}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    ⚡ ดึงเนื้อหา → สกัดข่าว → แตกประเด็น → สร้างผลลัพธ์ (ใช้เวลา ~20-40 วินาที)
                  </div>
                </div>
              )}

              {/* Auto Log (after done) */}
              {autoLog.length > 0 && !autoMode && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>📊 Log ({autoLog.length} steps)</summary>
                  <div style={{ background: 'var(--bg-primary)', padding: 8, borderRadius: 'var(--radius-sm)', marginTop: 4, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', maxHeight: 150, overflowY: 'auto' }}>
                    {autoLog.map((l, i) => <div key={i}>{l}</div>)}
                  </div>
                </details>
              )}
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>หรือใช้แบบ Manual</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📥 เลือกแหล่งข้อมูล</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 24 }}>
              {SOURCE_TYPES.map((s) => (
                <button key={s.value} onClick={() => { setSourceType(s.value); setExtracted(null); setRawText(''); setError(''); setImageFile(null); setImagePreview(null); setTiktokNeedUpload(false); setVideoFile(null); setYoutubeNeedUpload(false); }}
                  style={{
                    padding: '14px 16px', textAlign: 'left', fontFamily: 'inherit',
                    background: sourceType === s.value ? 'var(--accent-glow)' : 'var(--bg-primary)',
                    border: `1px solid ${sourceType === s.value ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', cursor: 'pointer',
                  }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.desc}</div>
                </button>
              ))}
            </div>

            {/* URL Input */}
            {needsUrl && (
              <div className="form-group">
                <label className="form-label">🔗 {sourceType === 'tiktok' ? 'URL คลิป TikTok' : sourceType === 'youtube' ? 'URL คลิป YouTube' : 'URL'}</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="url" className="form-input" placeholder={placeholders[sourceType]}
                    value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: '1 1 200px', minWidth: 0 }} />
                  {sourceType === 'tiktok' ? (
                    <button type="button" onClick={() => handleTikTokTranscribe('url')} disabled={!url || extracting}
                      className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
                      {extracting ? '⏳ กำลังถอดเสียง...' : '🎤 ถอดเสียงจากคลิป'}
                    </button>
                  ) : sourceType === 'youtube' ? (
                    <button type="button" onClick={() => handleYouTubeTranscribe('url')} disabled={!url || extracting}
                      className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
                      {extracting ? '⏳ กำลังดึง...' : '📺 ดึง Transcript'}
                    </button>
                  ) : (
                    <button type="button" onClick={handleExtract} disabled={!url || extracting}
                      className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
                      {extracting ? '⏳ กำลังดึง...' : '📥 ดึงเนื้อหา'}
                    </button>
                  )}
                </div>
                {sourceType === 'tiktok' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    AI จะดาวน์โหลดคลิปอัตโนมัติ → ถอดเสียงด้วย Whisper → ได้ข้อความ
                  </div>
                )}
                {sourceType === 'youtube' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    ดึง subtitle อัตโนมัติ (ฟรี) — ถ้าไม่มี subtitle จะให้อัปโหลดไฟล์ถอดเสียงแทน
                  </div>
                )}
              </div>
            )}

            {/* 🎵 TikTok Fallback: Upload Video */}
            {sourceType === 'tiktok' && (tiktokNeedUpload || !url) && (
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>📤 หรืออัปโหลดไฟล์วิดีโอโดยตรง</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                  {tiktokNeedUpload ? '⚠️ ดาวน์โหลดอัตโนมัติไม่สำเร็จ — ' : ''}ดาวน์โหลดคลิปจาก TikTok แล้วอัปโหลดที่นี่
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="file" accept="video/*"
                    onChange={(e) => setVideoFile(e.target.files?.[0])}
                    style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }} />
                  {videoFile && (
                    <button type="button" onClick={() => handleTikTokTranscribe('upload')} disabled={extracting}
                      className="btn btn-viral" style={{ whiteSpace: 'nowrap' }}>
                      {extracting ? '⏳ กำลังถอดเสียง...' : '🎤 ถอดเสียง'}
                    </button>
                  )}
                </div>
                {videoFile && (
                  <div style={{ fontSize: 11, color: 'var(--accent-light)', marginTop: 6 }}>
                    📁 {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                )}
              </div>
            )}

            {/* 📺 YouTube Fallback: Upload Video */}
            {sourceType === 'youtube' && youtubeNeedUpload && (
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)', marginBottom: 6 }}>⚠️ คลิปนี้ไม่มี subtitle — อัปโหลดไฟล์วิดีโอเพื่อถอดเสียงด้วย AI</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                  ดาวน์โหลดคลิปจาก YouTube แล้วอัปโหลดที่นี่ (Whisper จะถอดเสียงภาษาไทย)
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="file" accept="video/*,audio/*"
                    onChange={(e) => setVideoFile(e.target.files?.[0])}
                    style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }} />
                  {videoFile && (
                    <button type="button" onClick={() => handleYouTubeTranscribe('upload')} disabled={extracting}
                      className="btn btn-viral" style={{ whiteSpace: 'nowrap' }}>
                      {extracting ? '⏳ กำลังถอดเสียง...' : '🎤 ถอดเสียง'}
                    </button>
                  )}
                </div>
                {videoFile && (
                  <div style={{ fontSize: 11, color: 'var(--accent-light)', marginTop: 6 }}>
                    📁 {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                )}
              </div>
            )}

            {/* 📷 Image Upload Zone */}
            {sourceType === 'image' && (
              <div className="form-group">
                <label className="form-label">📷 วางภาพแคปหน้าจอ หรือลากไฟล์มาวาง</label>
                <div
                  onPaste={handleImagePaste}
                  onDrop={handleImageDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => document.getElementById('imageUpload')?.click()}
                  tabIndex={0}
                  style={{
                    border: `2px dashed ${imagePreview ? 'var(--success)' : 'var(--border-light)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: imagePreview ? 12 : 40,
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: imagePreview ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                    transition: 'all 0.2s',
                    outline: 'none',
                  }}
                >
                  {imagePreview ? (
                    <div>
                      <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, marginBottom: 10 }} />
                      <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✅ ได้รับภาพแล้ว — กดปุ่มด้านล่างเพื่ออ่านข้อความ</div>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setImageFile(null); setImagePreview(null); }}
                        style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                        🗑️ ลบภาพ วางใหม่
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Ctrl+V วางภาพที่แคปมา</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>หรือลากไฟล์ภาพมาวาง • หรือคลิกเลือกไฟล์</div>
                      <div style={{ fontSize: 11, color: 'var(--accent-light)', marginTop: 10, padding: '6px 12px', background: 'var(--accent-glow)', borderRadius: 20, display: 'inline-block' }}>
                        รองรับ: FB, Twitter, Line, TikTok, ข่าว ฯลฯ
                      </div>
                    </div>
                  )}
                  <input id="imageUpload" type="file" accept="image/*" hidden
                    onChange={(e) => processImageFile(e.target.files?.[0])} />
                </div>

                {/* ปุ่ม OCR */}
                {imageFile && (
                  <button type="button" onClick={handleImageOCR} disabled={extracting}
                    className="btn btn-viral btn-lg" style={{ width: '100%', marginTop: 12 }}>
                    {extracting ? '⏳ AI กำลังอ่านข้อความจากภาพ...' : '🔍 อ่านข้อความจากภาพ (AI Vision)'}
                  </button>
                )}
              </div>
            )}

            {/* Extracted Preview */}
            {extracted?.success && (
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--success)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>✅ {sourceType === 'image' ? 'อ่านข้อความจากภาพสำเร็จ' : 'ดึงเนื้อหาสำเร็จ'}</span>
                {extracted.title && <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>{extracted.title}</div>}
              </div>
            )}

            {/* Text area — แสดงกับทุก source ที่มีข้อความ */}
            {(sourceType === 'raw' || extracted || sourceType === 'facebook' || (sourceType === 'image' && rawText)) && (
              <div className="form-group">
                <label className="form-label">📝 {
                  extracted?.success ? 'เนื้อหาที่ดึงมา (แก้ไขได้)' :
                  extracted?.suggestion === 'paste' ? '📋 วาง/พิมพ์ข้อความจากเว็บแทน' :
                  'เนื้อหา'
                }</label>
                <textarea className="form-textarea" value={rawText} onChange={(e) => setRawText(e.target.value)}
                  placeholder="Copy เนื้อหาจากเว็บ/โพสต์/คลิป มาวางที่นี่..."
                  style={{ minHeight: 180 }} />
              </div>
            )}

            {/* Custom extraction prompt */}
            {rawText && (
              <div className="form-group" style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <label className="form-label">🤖 คำสั่งให้ AI สกัดเนื้อข่าว (ไม่บังคับ)</label>
                <textarea className="form-textarea" value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="สั่ง AI เช่น: แยกเฉพาะเนื้อข่าวจริง ตัดลิงก์โซเชียลมีเดียออก..."
                  style={{ minHeight: 50, fontSize: 13 }} />
              </div>
            )}

            {/* ปุ่มสกัดข่าว — ทุก source เข้าที่เดียวกัน */}
            <button type="button" onClick={handleExtractNews} className="btn btn-viral btn-lg"
              style={{ width: '100%', marginTop: 12 }} disabled={loading || !rawText}>
              {loading ? '⏳ กำลังสกัดเนื้อข่าว...' : '📥 สกัดเนื้อข่าว (AI แยกข่าวจริงจากขยะ)'}
            </button>
          </div>
        )}

        {/* ===== STEP 2: Extracted — แสดงเนื้อข่าวสะอาด + เลือก preset วิเคราะห์ ===== */}
        {step === 'extracted' && newsData && (
          <div className="card slide-up">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📋 เนื้อข่าวที่ AI สกัดได้</h3>

            {/* หัวข้อ */}
            <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--accent)', borderLeft: '4px solid var(--accent)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>🗞️ หัวข้อข่าว</div>
              <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.5 }}>{newsData.newsTitle}</div>
              {(newsData.newsSource || newsData.newsDate) && (
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  {newsData.newsSource && <span>📰 {newsData.newsSource}</span>}
                  {newsData.newsDate && <span>📅 {newsData.newsDate}</span>}
                  {newsData.newsCategory && <span>📂 {newsData.newsCategory}</span>}
                </div>
              )}
            </div>

            {/* เนื้อข่าวสะอาด */}
            <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20, border: newsData.newsBody?.includes('=== ข้อมูลเพิ่มเติมจาก AI Research ===') ? '2px solid #0ea5e9' : '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>📝 เนื้อข่าวที่สกัดได้ ({newsData.newsBody?.length || 0} ตัวอักษร)</span>
                  {newsData.newsBody?.includes('=== ข้อมูลเพิ่มเติมจาก AI Research ===') && (
                    <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(14,165,233,0.2)', color: '#38bdf8', borderRadius: 10, fontWeight: 700 }}>🔎 มีข้อมูลเสริม</span>
                  )}
                  {copied === 'research_added' && (
                    <span style={{ fontSize: 10, padding: '3px 10px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10, fontWeight: 700, animation: 'fadeIn 0.3s' }}>✅ เพิ่มข้อมูลเข้าเนื้อข่าวแล้ว!</span>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                  onClick={() => copyText(newsData.newsBody, 'news')}>
                  {copied === 'news' ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                </button>
              </div>
              <div style={{ fontSize: 14, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                {newsData.newsBody}
              </div>
            </div>

            {/* คำสั่งแตกประเด็น */}
            <div className="form-group" style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <label className="form-label">✏️ คำสั่งเพิ่มเติม (ไม่บังคับ — Prompt หลักถูกตั้งค่าในระบบแล้ว)</label>
              <textarea className="form-textarea" value={breakdownPromptText} onChange={(e) => setBreakdownPromptText(e.target.value)}
                placeholder="เช่น: เน้นมุมดราม่ามากขึ้น, แตกประเด็นเรื่องตัวเลขให้ละเอียด, หาจุดที่คนจะอิน..."
                style={{ minHeight: 50, fontSize: 13 }} />
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>🔍 ดู Prompt หลักที่ระบบใช้จริง (Viral News Angle Strategist 7-Step)</summary>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: 10, borderRadius: 6, marginTop: 4, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {`คุณคือ AI Viral News Angle Strategist + Emotional Storytelling Director\n\nSTEP 1: วิเคราะห์แก่นข่าว (core story, emotional core, conflict, characters)\nSTEP 2: แตกประเด็น 12 หมวด (ดราม่า, ความรัก, ครอบครัว, social pressure, แรงบันดาลใจ, ถกเถียง, ฟิน, ชื่นชม, เซอร์ไพรส์...)\nSTEP 3: วิเคราะห์พลัง viral ของแต่ละมุม (อิน/คอมเมนต์/แชร์/trigger)\nSTEP 4: เลือกมุมที่ดีที่สุด (emotional impact / share / FB friendly)\nSTEP 5: วิเคราะห์ลูกเล่นภาษา (opening/storytelling/pacing/ending)\nSTEP 6: Safety rules (ห้ามบิดข่าว ห้ามแต่งเรื่อง)\nSTEP 7: Output JSON (core_story, possible_angles, best_angle, language_strategy)\n\n⚠️ Prompt นี้ถูกใช้จริง 100% ทุกครั้งที่กดแตกประเด็น`}
                </div>
              </details>
            </div>

            <button type="button" onClick={handleBreakdown} className="btn btn-viral btn-lg"
              style={{ width: '100%' }} disabled={loading}>
              {loading ? '⏳ กำลังแตกประเด็น...' : '🔍 AI แตกประเด็น + สรุปใจความสำคัญ'}
            </button>

            {/* ===== Breakdown results แสดงต่อเลย (หน้าเดียวกัน) ===== */}
            {breakdownData && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>🔍 AI แตกประเด็น + สรุปใจความ</h3>


            {/* สรุปรวม */}
            <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--accent)', borderLeft: '4px solid var(--accent)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>📋 สรุปรวมข่าว</div>
              <div style={{ fontSize: 14, lineHeight: 2, color: 'var(--text-secondary)' }}>{breakdownData.news_summary}</div>
            </div>

            {/* Core Analysis Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              {breakdownData.core_story && (
                <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--info)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--info)', marginBottom: 4 }}>🎯 แก่นข่าว</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{breakdownData.core_story}</div>
                </div>
              )}
              {breakdownData.main_emotional_core && (
                <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--warning)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--warning)', marginBottom: 4 }}>💖 แก่น Emotional</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{breakdownData.main_emotional_core}</div>
                </div>
              )}
              {breakdownData.conflict_point && (
                <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--danger)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', marginBottom: 4 }}>⚔️ จุด Conflict</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{breakdownData.conflict_point}</div>
                </div>
              )}
              {breakdownData.viral_trigger && (
                <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--viral)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--viral)', marginBottom: 4 }}>🔥 Viral Trigger</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{breakdownData.viral_trigger}</div>
                </div>
              )}
            </div>

            {/* Key Points */}
            {breakdownData.key_points?.length > 0 && (
              <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>📌 ประเด็นสำคัญ ({breakdownData.key_points.length} ประเด็น)</div>
                {breakdownData.key_points.map((kp, i) => (
                  <div key={i} style={{ padding: '10px 12px', marginBottom: 8, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{i+1}. {kp.point}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {kp.category && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: 'var(--info-bg)', color: 'var(--info)' }}>🏷️ {kp.category}</span>}
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: kp.importance === 'สูง' ? 'var(--danger-bg)' : 'var(--bg-tertiary)', color: kp.importance === 'สูง' ? 'var(--danger)' : 'var(--text-muted)' }}>⚡ {kp.importance}</span>
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: kp.emotional_value === 'สูง' ? 'var(--warning-bg)' : 'var(--bg-tertiary)', color: kp.emotional_value === 'สูง' ? 'var(--warning)' : 'var(--text-muted)' }}>💖 {kp.emotional_value}</span>
                        {kp.viral_potential && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, background: kp.viral_potential === 'สูง' ? 'var(--viral-bg)' : 'var(--bg-tertiary)', color: kp.viral_potential === 'สูง' ? 'var(--viral)' : 'var(--text-muted)' }}>🔥 {kp.viral_potential}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>{kp.detail}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Possible Angles with Viral Scores */}
            {breakdownData.possible_angles?.length > 0 && (
              <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--viral)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--viral)', marginBottom: 10 }}>🎯 มุมเล่าทั้งหมด ({breakdownData.possible_angles.length} มุม)</div>
                {breakdownData.possible_angles.map((a, i) => (
                  <div key={i} style={{ padding: '12px', marginBottom: 8, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', borderLeft: `4px solid hsl(${(a.facebook_viral_score || 5) * 12}, 70%, 50%)` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 800 }}>{a.angle_name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: (a.facebook_viral_score || 0) >= 7 ? 'var(--success-bg)' : 'var(--bg-tertiary)', color: (a.facebook_viral_score || 0) >= 7 ? 'var(--success)' : 'var(--text-muted)' }}>🔥 {a.facebook_viral_score}/10</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{a.description}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      {a.target_emotion && <span style={{ fontSize: 9, padding: '2px 6px', background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: 8 }}>🎭 {a.target_emotion}</span>}
                      {a.share_trigger && <span style={{ fontSize: 9, padding: '2px 6px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 8 }}>📤 {a.share_trigger}</span>}
                      {a.comment_trigger && <span style={{ fontSize: 9, padding: '2px 6px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 8 }}>💬 {a.comment_trigger}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Best Main Angle */}
            {breakdownData.best_main_angle && (
              <div style={{ background: 'linear-gradient(135deg, var(--bg-primary), var(--accent-bg))', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '2px solid var(--accent)' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent-light)', marginBottom: 8 }}>🏆 มุมที่ดีที่สุด: {breakdownData.best_main_angle.angle_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 8 }}>{breakdownData.best_main_angle.why_best}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {breakdownData.best_main_angle.emotional_strength && <span style={{ fontSize: 9, padding: '3px 8px', background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: 10 }}>💪 {breakdownData.best_main_angle.emotional_strength}</span>}
                  {breakdownData.best_main_angle.facebook_safety && <span style={{ fontSize: 9, padding: '3px 8px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10 }}>🛡️ {breakdownData.best_main_angle.facebook_safety}</span>}
                  {breakdownData.best_main_angle.share_potential && <span style={{ fontSize: 9, padding: '3px 8px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 10 }}>📤 {breakdownData.best_main_angle.share_potential}</span>}
                </div>
              </div>
            )}

            {/* Language Strategy */}
            {breakdownData.language_strategy && (
              <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--info)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--info)', marginBottom: 8 }}>✍️ กลยุทธ์ภาษา</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {breakdownData.language_strategy.opening_style && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><strong>เปิด:</strong> {breakdownData.language_strategy.opening_style}</div>}
                  {breakdownData.language_strategy.storytelling_style && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><strong>เล่า:</strong> {breakdownData.language_strategy.storytelling_style}</div>}
                  {breakdownData.language_strategy.emotional_pacing && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><strong>จังหวะ:</strong> {breakdownData.language_strategy.emotional_pacing}</div>}
                  {breakdownData.language_strategy.ending_style && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><strong>ปิด:</strong> {breakdownData.language_strategy.ending_style}</div>}
                </div>
              </div>
            )}

            {/* Best Sections + Emotional Hooks */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              {breakdownData.best_sections?.length > 0 && (
                <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid var(--success)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 8 }}>⭐ ท่อนที่ดีที่สุด</div>
                  {breakdownData.best_sections.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', lineHeight: 1.7 }}>• {s}</div>
                  ))}
                </div>
              )}
              {breakdownData.emotional_hooks?.length > 0 && (
                <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid var(--warning)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)', marginBottom: 8 }}>🎣 จุดที่คนจะอิน</div>
                  {breakdownData.emotional_hooks.map((h, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0', lineHeight: 1.7 }}>• {h}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Key Facts */}
            {breakdownData.key_facts && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {breakdownData.key_facts.people?.map((p, i) => <span key={`p${i}`} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 10 }}>👤 {p}</span>)}
                {breakdownData.key_facts.places?.map((p, i) => <span key={`l${i}`} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10 }}>📍 {p}</span>)}
                {breakdownData.key_facts.numbers?.map((n, i) => <span key={`n${i}`} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: 10 }}>🔢 {n}</span>)}
                {breakdownData.key_facts.dates?.map((d, i) => <span key={`d${i}`} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--viral-bg)', color: 'var(--viral)', borderRadius: 10 }}>📅 {d}</span>)}
              </div>
            )}

            {/* Interactive Feedback — สั่ง AI แตกใหม่ */}
            <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', border: '2px solid var(--info)', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)', marginBottom: 8 }}>💬 สั่ง AI ปรับผลลัพธ์ (พิมพ์แล้วกดแตกใหม่)</div>
              <textarea className="form-textarea" value={breakdownPromptText} onChange={(e) => setBreakdownPromptText(e.target.value)}
                placeholder="เช่น: ประเด็นที่ 2 ไม่ดี ตัดออก, เน้นมุมดราม่ามากขึ้น, แตกประเด็นเรื่องตัวเลขให้ละเอียดกว่านี้..."
                style={{ minHeight: 60, fontSize: 13, marginBottom: 8 }} />
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 8 }}>💡 Prompt หลัก (7-Step Viral Angle Strategist) ถูกใช้จริงทุกครั้ง — ช่องนี้เป็น "คำสั่งเพิ่มเติม" เท่านั้น</div>
              <button onClick={handleBreakdown} className="btn btn-outline" disabled={loading} style={{ width: '100%' }}>
                {loading ? '⏳ กำลังแตกใหม่...' : '🔄 แตกประเด็นใหม่ตามคำสั่ง'}
              </button>
            </div>

            {/* 🧬 Emotional Architecture Blueprint */}
            <div style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.12), rgba(236,72,153,0.10))', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid rgba(168,85,247,0.4)', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 22 }}>🧬</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#c084fc' }}>Emotional Architecture Blueprint</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>AI วางแผนโครงสร้างอารมณ์ก่อนเขียน — ทำให้เนื้อหาอ่านลื่นและอินเหมือนมนุษย์เขียนจริง</div>
                  </div>
                </div>
                <button onClick={handleBlueprint} disabled={blueprinting || loading}
                  style={{ background: 'linear-gradient(135deg, #a855f7, #ec4899)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 12, padding: '10px 18px', borderRadius: 'var(--radius-md)', cursor: (blueprinting || loading) ? 'wait' : 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(168,85,247,0.3)' }}>
                  {blueprinting ? '⏳ วางแผน...' : (blueprintData ? '🔄 วางใหม่' : '🧬 วางแผนโครงสร้าง')}
                </button>
              </div>

              {/* Blueprint Result */}
              {editedBlueprint && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* Core Emotion */}
                  <div style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(168,85,247,0.2)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', marginBottom: 6 }}>🎯 CORE EMOTION — แกนอารมณ์หลัก</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: '#f0abfc' }}>{editedBlueprint.core_emotion}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1 }}>{editedBlueprint.emotion_reason}</span>
                    </div>
                  </div>

                  {/* Emotional Timeline */}
                  <div style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(168,85,247,0.2)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', marginBottom: 8 }}>📅 EMOTIONAL TIMELINE — ลำดับปล่อยข้อมูล</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(editedBlueprint.emotional_timeline || []).map((step, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 10, background: 'rgba(168,85,247,0.2)', color: '#c084fc', borderRadius: 4, padding: '2px 6px', flexShrink: 0, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{i + 1}</span>
                          <input
                            value={step}
                            onChange={e => {
                              const arr = [...(editedBlueprint.emotional_timeline || [])]; arr[i] = e.target.value;
                              setEditedBlueprint(prev => ({ ...prev, emotional_timeline: arr }));
                            }}
                            style={{ flex: 1, fontSize: 12, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', padding: '2px 0', outline: 'none' }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Emotional Branches */}
                  <div style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(168,85,247,0.2)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', marginBottom: 8 }}>⚡ EMOTIONAL BRANCHES — จุดดันอารมณ์</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(editedBlueprint.emotional_branches || []).map((b, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: 'rgba(236,72,153,0.15)', color: '#f9a8d4', flexShrink: 0, whiteSpace: 'nowrap' }}>{b.branch_type}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{b.content}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bridges */}
                  <div style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(168,85,247,0.2)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', marginBottom: 8 }}>🌉 BRIDGES — ประโยคเชื่อม</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(editedBlueprint.bridges || []).map((b, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 14, color: '#c084fc', flexShrink: 0 }}>•</span>
                          <input
                            value={b}
                            onChange={e => {
                              const arr = [...(editedBlueprint.bridges || [])]; arr[i] = e.target.value;
                              setEditedBlueprint(prev => ({ ...prev, bridges: arr }));
                            }}
                            style={{ flex: 1, fontSize: 12, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', padding: '3px 0', outline: 'none' }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Forbidden */}
                  {editedBlueprint.forbidden?.length > 0 && (
                    <div style={{ background: 'rgba(239,68,68,0.08)', borderRadius: 10, padding: '10px 14px', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#f87171', marginBottom: 6 }}>❌ ห้ามเฉพาะข่าวนี้</div>
                      {editedBlueprint.forbidden.map((f, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#fca5a5', marginBottom: 2 }}>• {f}</div>
                      ))}
                    </div>
                  )}

                  {/* Apply Blueprint badge */}
                  <div style={{ fontSize: 10, color: '#c084fc', textAlign: 'center', padding: '6px', background: 'rgba(168,85,247,0.08)', borderRadius: 8 }}>
                    ✅ Blueprint นี้จะถูกส่งไปพร้อมกับการสร้างเนื้อหาอัตโนมัติ — แก้ไขได้โดยตรงโดยตรงก่อนกด "สร้างเนื้อหา"
                  </div>
                </div>
              )}
            </div>

            {/* 🔎 AI หาข้อมูลเพิ่มเติม — Research Agent (Serper Real Search) */}
            <div style={{ background: 'linear-gradient(135deg, rgba(14,165,233,0.12), rgba(6,182,212,0.12))', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid rgba(14,165,233,0.4)', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 22 }}>🔎</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#38bdf8' }}>AI หาข้อมูลเพิ่มเติม</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ค้นหาจริงผ่าน Google — สกัด keyword จากเนื้อข่าว → ค้นพร้อมกัน 5-10 คำ → ข้อมูลจริงพร้อม URL แหล่งอ้างอิง</div>
                  </div>
                </div>
                <button onClick={handleResearch} className="btn" disabled={researching || loading}
                  style={{ background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 12, padding: '10px 20px', borderRadius: 'var(--radius-md)', cursor: (researching || loading) ? 'wait' : 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(14,165,233,0.3)' }}>
                  {researching ? '🔎 กำลังค้นหา...' : '+ หาข้อมูลเพิ่ม'}
                </button>
              </div>

              {/* แสดง keywords ที่ค้นหา */}
              {researchData?.keywords?.length > 0 && (
                <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>🔑 ค้นหา:</span>
                  {researchData.keywords.map((kw, i) => (
                    <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(14,165,233,0.15)', color: '#38bdf8', border: '1px solid rgba(14,165,233,0.3)' }}>{kw}</span>
                  ))}
                  {researchData.duration && <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 4 }}>({researchData.duration}s)</span>}
                </div>
              )}

              {/* แสดงผลข้อมูลที่หาได้ */}
              {researchData?.items?.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8' }}>
                      📚 พบ {researchData.items.length} รายการจากการค้นหาจริง
                    </div>
                    <button onClick={() => setSelectedResearch(researchData.items.map((_, i) => i))}
                      style={{ fontSize: 10, padding: '3px 10px', borderRadius: 8, background: 'rgba(14,165,233,0.2)', border: '1px solid #38bdf8', color: '#38bdf8', cursor: 'pointer' }}>
                      เลือกทั้งหมด
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {researchData.items.map((item, idx) => (
                      <div key={idx} onClick={() => toggleResearchItem(idx)}
                        style={{
                          padding: '12px 14px', borderRadius: 'var(--radius-sm)',
                          background: selectedResearch.includes(idx) ? 'rgba(14,165,233,0.12)' : 'var(--bg-secondary)',
                          border: selectedResearch.includes(idx) ? '2px solid #38bdf8' : '1px solid var(--border)',
                          cursor: 'pointer', transition: 'all 0.2s',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          {/* Checkbox */}
                          <div style={{
                            width: 20, height: 20, borderRadius: 4, border: '2px solid',
                            borderColor: selectedResearch.includes(idx) ? '#38bdf8' : 'var(--border)',
                            background: selectedResearch.includes(idx) ? '#38bdf8' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, marginTop: 2, fontSize: 12, color: '#fff',
                          }}>
                            {selectedResearch.includes(idx) && '✓'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Type badge + keyword + title */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: 9, padding: '2px 6px', borderRadius: 8, flexShrink: 0,
                                background: item.type === 'person' ? 'rgba(139,92,246,0.2)' :
                                  item.type === 'statistic' ? 'rgba(245,158,11,0.2)' :
                                  item.type === 'law' ? 'rgba(59,130,246,0.2)' :
                                  item.type === 'event' ? 'rgba(239,68,68,0.2)' :
                                  item.type === 'medical' ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)',
                                color: item.type === 'person' ? '#a78bfa' :
                                  item.type === 'statistic' ? '#fbbf24' :
                                  item.type === 'law' ? '#60a5fa' :
                                  item.type === 'event' ? '#f87171' :
                                  item.type === 'medical' ? '#34d399' : '#94a3b8',
                              }}>
                                {item.type === 'person' ? '👤' : item.type === 'statistic' ? '📊' :
                                 item.type === 'law' ? '⚖️' : item.type === 'event' ? '📰' :
                                 item.type === 'medical' ? '🏥' : '📋'} {item.keyword || item.type}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</span>
                            </div>
                            {/* Content */}
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 6 }}>{item.content}</div>
                            {/* Source URL */}
                            {item.sourceUrl && (
                              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                style={{ fontSize: 10, color: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', background: 'rgba(14,165,233,0.1)', padding: '2px 8px', borderRadius: 6, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                🌐 {item.sourceName || item.sourceUrl}
                              </a>
                            )}
                            {item.relevance && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>💡 {item.relevance}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ไม่พบ */}
                  {researchData?.notFound?.length > 0 && (
                    <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(100,116,139,0.1)', borderRadius: 8, fontSize: 10, color: 'var(--text-muted)' }}>
                      🔍 ไม่พบข้อมูล: {researchData.notFound.join(', ')}
                    </div>
                  )}

                  {/* ปุ่มเพิ่มข้อมูล */}
                  {selectedResearch.length > 0 && (
                    <button onClick={handleAddResearch} className="btn btn-lg"
                      style={{ width: '100%', marginTop: 12, background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)', border: 'none', color: '#fff', fontWeight: 800, fontSize: 13, padding: '12px 0', borderRadius: 'var(--radius-md)', cursor: 'pointer', boxShadow: '0 3px 12px rgba(14,165,233,0.3)' }}>
                      {`📥 เพิ่ม ${selectedResearch.length} ข้อมูล (พร้อม URL) เข้าเนื้อข่าว`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 🧬 AI ผสมมุมข่าว — เลือกหัวข้อดีมาผสมเป็นเนื้อหาใหม่ */}
            <div style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(236,72,153,0.15))', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid rgba(168,85,247,0.5)', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 22 }}>🧬</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#c084fc' }}>AI ผสมมุมข่าว — สร้างเนื้อหาไวรัลใหม่</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>AI จะเลือกมุมที่ดีที่สุดจากผลวิเคราะห์ด้านบน ผสมเข้าด้วยกัน สร้างเนื้อหาใหม่ที่น่าอ่านและไวรัลได้</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {breakdownData.possible_angles?.slice(0, 5).map((a, i) => (
                  <span key={i} style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(168,85,247,0.2)', color: '#c084fc', borderRadius: 10, border: '1px solid rgba(168,85,247,0.3)' }}>
                    {a.angle_name} {a.facebook_viral_score >= 7 ? '🔥' : ''}
                  </span>
                ))}
                <span style={{ fontSize: 9, padding: '3px 8px', color: 'var(--text-muted)' }}>→ AI เลือก + ผสม</span>
              </div>
              <button onClick={handleMixAngles} className="btn btn-lg" disabled={loading}
                style={{ width: '100%', background: 'linear-gradient(135deg, #7c3aed, #db2777)', border: 'none', color: '#fff', fontWeight: 800, fontSize: 14, padding: '14px 0', borderRadius: 'var(--radius-md)', cursor: loading ? 'wait' : 'pointer', transition: 'all 0.3s', boxShadow: '0 4px 15px rgba(124,58,237,0.3)' }}>
                {loading ? '🧬 AI กำลังผสมมุมข่าว...' : '🧬 AI เลือก + ผสมมุมข่าว สร้างเนื้อหาไวรัลใหม่'}
              </button>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>ยึด Prompt + Safety Rules ครบทุกข้อ • ใช้ข้อมูลจากข่าวจริงเท่านั้น</div>
            </div>

            {/* 📏 เลือกความยาวเนื้อหา */}
            <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>📏 เลือกความยาวเนื้อหา</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>ข่าวที่มีข้อมูลเสริมเยอะ ใช้ความยาวมากจะได้เนื้อหาครบถ้วนกว่า</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[
                  { id: 'short', label: '📝 สั้นกระชับ', range: '250-300 คำ', desc: 'โพสต์ไวรัลมาตรฐาน', para: '3 ย่อหน้า', color: '#22c55e' },
                  { id: 'medium', label: '📄 ปานกลาง', range: '400-500 คำ', desc: 'มีข้อมูลเสริมเพิ่ม', para: '4-5 ย่อหน้า', color: '#f59e0b' },
                  { id: 'long', label: '📰 ยาวครบถ้วน', range: '500-1000 คำ', desc: 'ข่าวเจาะลึก เต็มรายละเอียด', para: '6-8 ย่อหน้า', color: '#ef4444' },
                ].map(opt => (
                  <div key={opt.id} onClick={() => setContentLength(opt.id)}
                    style={{
                      padding: '14px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      background: contentLength === opt.id ? `${opt.color}15` : 'var(--bg-secondary)',
                      border: contentLength === opt.id ? `2px solid ${opt.color}` : '1px solid var(--border)',
                      transition: 'all 0.2s',
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: contentLength === opt.id ? opt.color : 'var(--text-primary)', marginBottom: 2 }}>{opt.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: opt.color, marginBottom: 4 }}>{opt.range}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{opt.para} • {opt.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* สร้างเนื้อหา — AI เลือก Prompt จากหอสมุดอัตโนมัติ */}
            <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', border: '2px solid var(--accent)' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-light)', marginBottom: 4 }}>🧠 AI เลือก Prompt จากหอสมุดอัตโนมัติ</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>AI จะวิเคราะห์แนวข่าว → เทียบกับ Prompt ในหอสมุด → เลือกที่ตรงที่สุดมาใช้</div>
              <button type="button" disabled={loading} onClick={() => handleAnalyze()}
                style={{ width: '100%', padding: '14px 20px', border: 'none', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, #7c3aed, #3b82f6)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: loading ? 'wait' : 'pointer', boxShadow: '0 4px 15px rgba(124,58,237,0.3)' }}>
                {loading ? '⏳ AI กำลังวิเคราะห์และเลือก Prompt...' : '⚡ สร้างเนื้อหา (AI เลือก Prompt จากหอสมุดให้)'}
              </button>
            </div>
              </div>
            )}
          </div>
        )}

        {/* ===== STEP 4: Analyzed — ผลลัพธ์หลายเวอร์ชัน ===== */}
        {step === 'analyzed' && analysisResult && (
          <div className="card slide-up">
            {/* ===== ส่วนหัว: หัวข้อข่าว + Prompt ที่ใช้ กำกับชัดเจน ===== */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>📝 ผลลัพธ์</h3>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{analysisResult.versions?.length || 0} เวอร์ชัน</span>
            </div>

            {/* 📰 หัวข้อข่าว + Prompt ที่ใช้ */}
            <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', marginBottom: 16, border: analysisResult.usedPreset?.source === 'library' ? '2px solid rgba(139,92,246,0.5)' : '1px solid var(--border)', overflow: 'hidden' }}>
              {/* Prompt Badge — ติดด้านบนหัวข้อข่าว */}
              {analysisResult.usedPreset?.source === 'library' ? (
                <div style={{
                  background: analysisResult.usedPreset?.isBorrowed
                    ? 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(239,68,68,0.1))'
                    : 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(59,130,246,0.2))',
                  padding: '10px 16px',
                  borderBottom: analysisResult.usedPreset?.isBorrowed
                    ? '1px solid rgba(245,158,11,0.4)'
                    : '1px solid rgba(139,92,246,0.3)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      background: analysisResult.usedPreset?.isBorrowed
                        ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                        : 'linear-gradient(135deg, #7c3aed, #3b82f6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                    }}>
                      {analysisResult.usedPreset?.isBorrowed ? '⚠️' : '🏛️'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
                        color: analysisResult.usedPreset?.isBorrowed ? '#fbbf24' : '#a78bfa',
                      }}>
                        {analysisResult.usedPreset?.isBorrowed ? 'ยืม PROMPT ใกล้เคียง (ไม่มีตรงแนว)' : 'PROMPT จากหอสมุดไวรัล'}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {analysisResult.usedPreset.name?.replace('🏛️ ', '').replace('⚠️ ', '')}
                      </div>
                    </div>
                    {analysisResult.usedPreset.viralScore && (
                      <div style={{
                        background: analysisResult.usedPreset?.isBorrowed
                          ? 'linear-gradient(135deg, #f59e0b, #f97316)'
                          : 'linear-gradient(135deg, #7c3aed, #6366f1)',
                        padding: '4px 10px', borderRadius: 16, color: '#fff', fontWeight: 900, fontSize: 12, textAlign: 'center', lineHeight: 1, flexShrink: 0,
                      }}>
                        <div style={{ fontSize: 7, opacity: 0.7, marginBottom: 1 }}>VIRAL</div>
                        {analysisResult.usedPreset.viralScore}
                      </div>
                    )}
                  </div>
                  {/* เหตุผล AI */}
                  {analysisResult.debug?.promptMatchReason && (
                    <div style={{
                      fontSize: 9, marginTop: 6, padding: '4px 8px', borderRadius: 4,
                      color: analysisResult.usedPreset?.isBorrowed ? 'rgba(251,191,36,0.95)' : 'rgba(167,139,250,0.9)',
                      background: analysisResult.usedPreset?.isBorrowed ? 'rgba(245,158,11,0.1)' : 'rgba(139,92,246,0.1)',
                    }}>
                      {analysisResult.debug.promptMatchReason}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ background: 'rgba(100,116,139,0.1)', padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>📦</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>PRESET: </span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{analysisResult.usedPreset?.name?.replace('📦 ', '') || 'Library'}</span>
                  </div>
                  {analysisResult.debug?.newsTypeDetected && (
                    <span style={{ fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                      ข่าว{analysisResult.debug.newsTypeDetected}
                    </span>
                  )}
                </div>
              )}
              {/* หัวข้อข่าวจริง */}
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{newsData?.newsTitle}</div>
                {analysisResult.news_reference && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>📰 {analysisResult.news_reference}</div>}
                {analysisResult.debug?.newsTypeDetected && analysisResult.usedPreset?.source === 'library' && (
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                    🧠 AI วิเคราะห์: ข่าว{analysisResult.debug.newsTypeDetected}
                  </div>
                )}
              </div>
              {/* ถ้าใช้ Preset → แสดงเหตุผลว่าทำไมไม่ใช้ Library */}
              {analysisResult.usedPreset?.source === 'preset' && analysisResult.debug?.promptMatchReason && (
                <div style={{ padding: '6px 16px 10px', fontSize: 9, color: '#94a3b8', borderTop: '1px solid rgba(100,116,139,0.15)' }}>
                  💡 {analysisResult.debug.promptMatchReason}
                </div>
              )}
            </div>

            {/* === กฎเหล็ก: แจ้งเตือน AI Error/Warning === */}
            {analysisResult.debug?.aiError && (
              <div style={{ background: 'rgba(239,68,68,0.15)', border: '2px solid rgba(239,68,68,0.5)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>🚨</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#ef4444' }}>AI แจ้งปัญหา (กฎเหล็ก: ติดขัดต้องแจ้ง)</div>
                    <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 2 }}>{analysisResult.debug.aiError}</div>
                  </div>
                </div>
              </div>
            )}
            {analysisResult.debug?.aiWarning && (
              <div style={{ background: 'rgba(245,158,11,0.12)', border: '2px solid rgba(245,158,11,0.4)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b' }}>AI เตือน (กฎเหล็ก: ข้อมูลไม่ชัดเจน)</div>
                    <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 2 }}>{analysisResult.debug.aiWarning}</div>
                  </div>
                </div>
              </div>
            )}

            {/* แสดงแต่ละ Version */}
            {analysisResult.versions?.map((v, i) => (
              <div key={i} style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--border)', borderLeft: `4px solid hsl(${i * 60}, 70%, 50%)` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 800 }}>#{i+1} {v.style?.replace(/^(classic|enhanced)_/, '')}</span>
                    {v._sourceLabel && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 10,
                        background: v._source === 'enhanced' ? 'rgba(168,85,247,0.2)' : 'rgba(234,179,8,0.15)',
                        color: v._source === 'enhanced' ? '#c084fc' : '#fbbf24',
                        border: `1px solid ${v._source === 'enhanced' ? 'rgba(168,85,247,0.4)' : 'rgba(234,179,8,0.3)'}`,
                      }}>
                        {v._sourceLabel}
                      </span>
                    )}
                    {v.tone && <span style={{ fontSize: 9, padding: '2px 8px', background: 'var(--info-bg)', color: 'var(--info)', borderRadius: 10 }}>🎭 {v.tone}</span>}
                    {v.target && <span style={{ fontSize: 9, padding: '2px 8px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10 }}>👤 {v.target}</span>}
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                    onClick={() => copyText(v.content, `v${i}`)}>
                    {copied === `v${i}` ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                  </button>
                </div>
                {v.title && <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 8 }}>{v.title}</div>}
                {v.hook && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)', marginBottom: 8, fontStyle: 'italic' }}>🪝 {v.hook}</div>}
                <div style={{ fontSize: 14, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{v.content}</div>
                {v.closing && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', marginTop: 10, fontStyle: 'italic' }}>💬 {v.closing}</div>}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>📊 {v.content?.split(/\s+/).length || 0} คำ</div>
                <button
                  onClick={() => handleSendToReview(v, i)}
                  disabled={sentToReview[i] || sendingReview === i}
                  style={{
                    marginTop: 10, width: '100%', padding: '10px 16px',
                    background: sentToReview[i] ? 'var(--success)' : 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    color: '#fff', fontWeight: 700, fontSize: 12,
                    cursor: sentToReview[i] ? 'default' : sendingReview === i ? 'wait' : 'pointer',
                    opacity: sentToReview[i] ? 0.7 : 1,
                    transition: 'all 0.3s',
                  }}>
                  {sentToReview[i] ? '✅ ส่งเข้าคลังแล้ว' : sendingReview === i ? '⏳ กำลังส่ง...' : '📤 ส่งเข้าคลังรอตรวจ'}
                </button>
              </div>
            ))}

            {/* ถ้าไม่มี versions แสดง summary แบบเดิม */}
            {(!analysisResult.versions || analysisResult.versions.length === 0) && analysisResult.summary && (
              <div style={{ background: 'var(--bg-primary)', padding: 20, borderRadius: 'var(--radius-md)', marginBottom: 16, border: '1px solid var(--warning)', borderLeft: '4px solid var(--warning)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)', marginBottom: 12 }}>🤖 ผลลัพธ์</div>
                <div style={{ fontSize: 15, lineHeight: 2, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{analysisResult.summary}</div>
              </div>
            )}

            {/* Debug Panel */}
            {analysisResult.debug && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', cursor: 'pointer', padding: '8px 0' }}>🔍 Debug — ตรวจสอบข้อมูลที่ส่งให้ AI</summary>
                <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-sm)', marginTop: 4, fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                  <div>📏 Prompt ความยาว: {analysisResult.debug.promptLength?.toLocaleString()} ตัวอักษร</div>
                  <div>📰 เนื้อข่าว: {analysisResult.debug.newsBodyLength?.toLocaleString()} ตัวอักษร</div>
                  <div>📌 ประเด็นที่แตก: {analysisResult.debug.breakdownPointsCount} ประเด็น</div>
                  <div>🎯 Preset: {analysisResult.debug.presetUsed}</div>
                  <div style={{ padding: '8px 10px', margin: '6px 0', borderRadius: 6, background: analysisResult.debug.promptSource === 'library' ? 'rgba(139,92,246,0.1)' : 'rgba(100,116,139,0.08)', border: `1px solid ${analysisResult.debug.promptSource === 'library' ? 'rgba(139,92,246,0.3)' : 'rgba(100,116,139,0.2)'}` }}>
                    <div style={{ fontWeight: 700, color: analysisResult.debug.promptSource === 'library' ? '#a78bfa' : '#94a3b8' }}>
                      {analysisResult.debug.promptSource === 'library' ? '🏛️ Prompt Library → ใช้จริง' : '📦 Prompt Library → ไม่ได้ใช้'}
                    </div>
                    {analysisResult.debug.smartPromptName && <div>📛 ชื่อ Prompt: {analysisResult.debug.smartPromptName}</div>}
                    {analysisResult.debug.smartPromptScore && <div>⭐ Viral Score: {analysisResult.debug.smartPromptScore}/100</div>}
                    {analysisResult.debug.promptMatchReason && <div>🔍 เหตุผล: {analysisResult.debug.promptMatchReason}</div>}
                  </div>
                  <div>🔗 มี Breakdown: {analysisResult.debug.hasBreakdown ? '✅ ใช่' : '❌ ไม่'}</div>
                  <div>🆔 Workflow: {analysisResult.debug.workflowId}</div>
                  <div>💾 Context: {analysisResult.debug.contextSource}</div>
                  {analysisResult.validation && (
                    <div style={{ marginTop: 6, color: analysisResult.validation.valid ? 'var(--success)' : 'var(--warning)' }}>
                      ✅ Validation: {analysisResult.validation.valid ? 'PASS' : `⚠️ ${analysisResult.validation.issues.join(', ')}`}
                    </div>
                  )}
                  <div style={{ marginTop: 8, wordBreak: 'break-all', maxHeight: 150, overflow: 'auto', background: 'var(--bg-secondary)', padding: 8, borderRadius: 4 }}>
                    <strong>Prompt Preview:</strong><br/>{analysisResult.debug.promptPreview}
                  </div>
                </div>
              </details>
            )}

            {/* ปุ่มวิเคราะห์ใหม่ */}
            <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)', marginBottom: 16 }}>
              <button className="btn btn-outline" disabled={loading} onClick={() => handleAnalyze()}
                style={{ fontSize: 12 }}>
                {loading ? '⏳ สร้างใหม่...' : '🔄 สร้างใหม่ (AI เลือก Prompt อัตโนมัติ)'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={handleReset} className="btn btn-primary btn-lg" style={{ flex: 1 }}>
                🔄 สร้างคอนเทนต์ใหม่
              </button>
              {Object.keys(sentToReview).length > 0 && (
                <a href="/review" className="btn btn-lg"
                  style={{ flex: 1, background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', border: 'none', color: '#fff', fontWeight: 700, textDecoration: 'none', textAlign: 'center', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  📋 ไปดูคลังรอตรวจ ({Object.keys(sentToReview).length} รายการ)
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
