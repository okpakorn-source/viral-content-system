'use client';

// ============================================================
// 🎯 Cover Ref Test — หน้าเทสปกเทียบ "ภาพแสนไลค์ reference" (vt_ref_5x4)
// ------------------------------------------------------------
// ผู้ใช้กดเทสเอง: ใส่เนื้อข่าวเต็ม (+ลิงก์ภาพถ้ามี) → เลือกโครง → สร้างปก
// → โชว์ปกที่ได้เทียบ reference ข้างกัน + คะแนน QC + เหตุผล Director
// เรียก /api/auto-cover-v3 ตรงๆ (ต้องรันบนเซิร์ฟเวอร์ที่มีโค้ดใหม่ = rebuild/dev)
// ============================================================

import { useState, useRef, useEffect } from 'react';
// ★ 18 ก.ค. 69: ปุ่ม "แก้ต่อในเอดิเตอร์" ฝั่ง sync — reuse ตัวสร้างสูตร PURE ชุดเดียวกับโหมดคิว/ทางลัด
//   (สูตรยึด manifest ผังประกอบจริงหลังทุกการสลับ — หลักการเดียวกับ f500b59)
import { buildEditorRecipe } from '@/lib/editorRecipe';

// ★ Preview MVP item 5 — client error formatter ที่ปลอดภัยกับค่าทุกชนิด (string/Error/plain-object/unknown)
//   ไม่มีทาง [object Object] เด็ดขาด · ไม่ JSON.stringify ค่าดิบ (กันหลุด secret/provider body ยาว) · bounded length
function formatClientError(value) {
  if (typeof value === 'string') return value.slice(0, 500) || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ';
  if (value instanceof Error) return String(value.message || value.name || 'เกิดข้อผิดพลาด').slice(0, 500);
  if (value && typeof value === 'object') {
    if (typeof value.message === 'string' && value.message) return value.message.slice(0, 500);
    if (typeof value.error === 'string' && value.error) return value.error.slice(0, 500);
    return 'เกิดข้อผิดพลาด (รูปแบบไม่คาดคิด)';
  }
  if (value == null) return 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ';
  return String(value).slice(0, 500);
}

export default function CoverRefTestPage() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // ★ 15 ก.ค. 69 บัค #5: ถอดช่องฟอร์มที่ไม่ได้ต่อสายจริงออกจากหน้า (เดิมเก็บค่าแต่ไม่เคยส่งเข้า body) — จะใส่กลับเมื่อ wire จริง
  const [refLock, setRefLock] = useState('');
  const [clipLinks, setClipLinks] = useState(''); // ★ โหมดคลิปต้นทาง (18 ก.ค.): ลิงก์คลิปที่ข่าวมาจาก (บรรทัดละลิงก์ ≤3)
  // ★ 15 ก.ค. 69 แบตช์ 5: คีย์ทีมสำหรับด่านตรวจสิทธิ์ src/middleware.js (เรียกผ่านโฮสต์/cloud) — เก็บใน localStorage เครื่องผู้ใช้เอง ไม่ hardcode
  const [teamKey, setTeamKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [failInfo, setFailInfo] = useState(null);
  const [cancelled, setCancelled] = useState(false);
  // ★ 18 ก.ค. 69: สถานะปุ่ม "แก้ต่อในเอดิเตอร์" ฝั่ง sync (กันกดซ้ำระหว่างดึงพูลภาพ)
  const [editorBusy, setEditorBusy] = useState(false);
  const timerRef = useRef(null);
  const abortRef = useRef(null);

  // ── 📥 โหมดคิว (Q2) ──
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueText, setQueueText] = useState('');
  const [queueSubmitting, setQueueSubmitting] = useState(false);
  const [queueSubmitResult, setQueueSubmitResult] = useState(null); // {jobs?, rejected?, errorType?}
  const [queueError, setQueueError] = useState('');
  const [queueJobs, setQueueJobs] = useState([]); // งาน mode==='reftest' จาก GET /api/mega
  const [rowBusy, setRowBusy] = useState(''); // `${id}:${action}` ระหว่างสั่ง action ต่อแถว
  const pollInflightRef = useRef(false); // กัน GET /api/mega ซ้อน
  const tickInflightRef = useRef(false); // กัน POST /api/mega/tick ซ้อน
  const queueJobsRef = useRef([]); // mirror ให้ tick driver อ่าน active โดยไม่ผูก closure เก่า
  useEffect(() => { queueJobsRef.current = queueJobs; }, [queueJobs]);

  const startTimer = () => {
    setElapsed(0);
    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
  };
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };

  // ★ audit แบตช์ 3 (terra): ออกจากหน้า = abort fetch ค้าง + หยุด timer (กัน interval รั่ว/setState หลัง unmount)
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); if (timerRef.current) clearInterval(timerRef.current); }, []);

  // ★ 15 ก.ค. 69 แบตช์ 5: โหลดคีย์ทีมจาก localStorage ครั้งแรก (เครื่องทีมปล่อยว่างได้ — ด่านผ่าน localhost อยู่แล้ว)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('coverTestKey');
      if (saved) setTeamKey(saved);
    } catch { /* localStorage ไม่พร้อม (private mode ฯลฯ) — ปล่อยว่างไว้ */ }
  }, []);
  // ★ 15 ก.ค. 69 แบตช์ 5: เซฟคีย์ทีมกลับ localStorage ทุกครั้งที่เปลี่ยน
  useEffect(() => {
    try { window.localStorage.setItem('coverTestKey', teamKey); } catch { /* ignore */ }
  }, [teamKey]);

  // ★ 15 ก.ค. 69 บัค #j: gate สองชั้นเหมือนฝั่ง server — content ≥100 ตัว และ (title+content ตาม filter(Boolean)) รวม ≥200 ตัว
  function gateMessage() {
    const c = content.trim();
    const t = title.trim();
    if (c.length < 100) return `ใส่เนื้อข่าวเต็มก่อน (อย่างน้อย 100 ตัวอักษร — ตอนนี้มี ${c.length} ตัวอักษร — กฎ: ห้ามเนื้อสั้นตัดทอน)`;
    const combinedLen = [t, c].filter(Boolean).join('\n\n').length;
    if (combinedLen < 200) return `เนื้อหารวม (หัวข่าว+เนื้อข่าว) ต้องอย่างน้อย 200 ตัวอักษร — ตอนนี้มี ${combinedLen} ตัวอักษร`;
    return '';
  }

  async function generate() {
    const gateMsg = gateMessage();
    if (gateMsg) { setError(gateMsg); return; }
    setError(''); setResult(null); setFailInfo(null); setCancelled(false); setLoading(true); startTimer();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const body = {
        newsTitle: title.trim(),
        content: content.trim(),
      };
      if (refLock.trim()) body.forceTemplateId = refLock.trim();
      // ★ โหมดคลิปต้นทาง: ส่งลิงก์คลิป (บรรทัด/เว้นวรรค/คอมมาคั่นได้) — ฝั่งท่อจะแคปเฟรมจากลิงก์เป็นแหล่งหลักก่อน
      if (clipLinks.trim()) body.clipUrls = clipLinks.split(/[\n\s,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);

      // ★ 15 ก.ค. 69 แบตช์ 5: แนบคีย์ทีมเมื่อกรอกไว้ (localhost/เครื่องทีมไม่ต้องมีก็ผ่านด่านได้)
      const headers = { 'content-type': 'application/json' };
      if (teamKey.trim()) headers['x-cover-test-key'] = teamKey.trim();

      const res = await fetch('/api/cover-ref-test', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      // ★ audit แบตช์ 3 (terra): abort ระหว่างอ่าน body ต้องไปเส้นยกเลิก ไม่ใช่โดนกลืนเป็น {} แล้วป้าย error มั่ว
      const j = await res.json().catch((err) => { if (err?.name === 'AbortError') throw err; return {}; });
      if (!res.ok || !j.success) {
        // ★ 15 ก.ค. 69 แบตช์ 5: 401 จากด่านตรวจสิทธิ์ (middleware) → ชี้ให้กรอกคีย์ทีมในช่องนี้แทนข้อความ error ทั่วไป
        if (res.status === 401 && j.errorType === 'COVER_TEST_KEY_REQUIRED') {
          setError('เรียกผ่านโฮสต์นี้ต้องมีคีย์ทีม — กรอกคีย์ทีมในช่อง "คีย์ทีม" ด้านล่างฟอร์มแล้วลองใหม่');
        } else {
          const errText = j.error ? formatClientError(j.error) : String(res.status);
          setError(`สร้างปกไม่สำเร็จ: ${errText} ${j.errorType ? `(${j.errorType})` : ''}`);
        }
        setFailInfo(j);
      } else {
        setResult(j);
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        setCancelled(true);
        setError('ยกเลิกฝั่งหน้าจอแล้ว (งานฝั่งเซิร์ฟเวอร์จะวิ่งจนจบเอง)');
      } else {
        setError('เรียก API ล้ม: ' + formatClientError(e));
      }
    } finally {
      setLoading(false); stopTimer(); abortRef.current = null;
    }
  }

  // ★ 15 ก.ค. 69 บัค #14: ปุ่มยกเลิก — abort fetch เท่านั้น (งานฝั่งเซิร์ฟเวอร์วิ่งต่อจนจบเอง)
  function cancelGenerate() {
    if (abortRef.current) abortRef.current.abort();
  }

  // ★ 18 ก.ค. 69: "แก้ต่อในเอดิเตอร์" ฝั่ง sync — สร้างสูตรจากผลตรงหน้า (manifest = ความจริงสุดท้ายหลังทุกการสลับ)
  //   แล้วส่งข้ามแท็บผ่าน localStorage แบบเดียวกับ /mega-compose-test เป๊ะ (crtRecipeHandoff → ?recipeLocal=1)
  //   ไม่แตะท่อ strict ฝั่ง server เลย — วัตถุดิบครบใน response เดิม: matchedRef.dna.template + manifest + qcVerdict + imageCaseId
  async function openInEditor() {
    if (!result || editorBusy) return;
    setEditorBusy(true);
    try {
      // ดึงพูลภาพของเคส (AC-xxxx) ให้คนสลับภาพเองในเอดิเตอร์ได้ — ล้ม/ไม่มีเคส = เปิดต่อด้วยพูลว่าง
      let caseImages = [];
      if (result.imageCaseId) {
        try {
          const r = await fetch(`/api/images/${encodeURIComponent(result.imageCaseId)}`);
          const j = await r.json().catch(() => ({}));
          if (j && j.success && Array.isArray(j.images)) caseImages = j.images;
        } catch { /* พูลว่าง — ภาพต่อช่องยังมาจาก manifest ได้ */ }
      }
      // ประกอบ job-shape ให้ตัวสร้างสูตร PURE ตัวเดียวกับโหมดคิว (/api/mega/recipe) — สูตรจึงหน้าตาเดียวกันทุกทาง
      const recipe = buildEditorRecipe({
        job: {
          id: result.outputId || result.imageCaseId || 'REFTEST',
          status: null,
          dossier: {
            desk: { title: title.trim() },
            images: { caseId: result.imageCaseId || null },
            refMatch: { dna: result.matchedRef?.dna || null, styleName: result.matchedRef?.styleName || null },
            pickImages: { slots: {} }, // ว่างโดยตั้งใจ — ภาพต่อช่องยึด manifest (ผังจริง) เท่านั้น
            cover: { manifest: result.manifest || null, qcVerdict: result.qcVerdict || null },
          },
        },
        caseImages,
      });
      window.localStorage.setItem('crtRecipeHandoff', JSON.stringify({ at: Date.now(), recipe }));
      window.open('/cover-tester?recipeLocal=1', '_blank');
    } catch {
      alert('ส่งสูตรไปเอดิเตอร์ไม่สำเร็จ (localStorage ไม่พร้อม)');
    } finally {
      setEditorBusy(false);
    }
  }

  // ── โหมดคิว: โหลดรายการงาน reftest จาก GET /api/mega (มี in-flight guard) ──
  async function loadQueueJobs() {
    if (pollInflightRef.current) return;
    pollInflightRef.current = true;
    try {
      const r = await fetch('/api/mega');
      const j = await r.json().catch(() => ({}));
      if (j && j.success) setQueueJobs((j.jobs || []).filter((x) => x && x.mode === 'reftest'));
    } catch { /* เงียบ — รอบโพลถัดไปลองใหม่ */ } finally {
      pollInflightRef.current = false;
    }
  }

  // ── โหมดคิว: poll GET /api/mega ทุก 5 วิ ระหว่างเปิดส่วนคิว (ล้าง interval ตอนปิด/unmount) ──
  useEffect(() => {
    if (!queueOpen) return undefined;
    loadQueueJobs();
    const id = setInterval(loadQueueJobs, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueOpen]);

  // ── โหมดคิว: tick driver — ระหว่างส่วนคิวเปิด + มีงาน active ≥1 → POST /api/mega/tick ทุก 6 วิ ──
  //    (in-flight guard, อ่าน active จาก ref กัน closure เก่า, หยุดเมื่อไม่มี active/ปิดส่วน/unmount)
  useEffect(() => {
    if (!queueOpen) return undefined;
    const drive = async () => {
      if (tickInflightRef.current) return;
      const hasActive = (queueJobsRef.current || []).some((j) => RT_ACTIVE_STATUSES.includes(j.status));
      if (!hasActive) return; // ไม่มีงานเดินอยู่ = ไม่ต้องปลุก tick
      tickInflightRef.current = true;
      try { await fetch('/api/mega/tick', { method: 'POST' }); } catch { /* เงียบ */ } finally {
        tickInflightRef.current = false;
      }
    };
    const id = setInterval(drive, 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueOpen]);

  // ── โหมดคิว: ส่งหลายข่าวเข้าคิว ──
  async function submitQueue() {
    const items = parseQueueItems(queueText);
    if (items.length === 0) {
      setQueueError('ยังไม่มีรายการ — วางเนื้อข่าว (คั่นแต่ละข่าวด้วยบรรทัดที่มีแค่ ---)');
      return;
    }
    setQueueSubmitting(true); setQueueError(''); setQueueSubmitResult(null);
    try {
      const headers = { 'content-type': 'application/json' };
      if (teamKey.trim()) headers['x-cover-test-key'] = teamKey.trim();
      const res = await fetch('/api/cover-ref-test', {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'queue', items }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401 && j.errorType === 'COVER_TEST_KEY_REQUIRED') {
        setQueueError('เรียกผ่านโฮสต์นี้ต้องมีคีย์ทีม — กรอกคีย์ทีมในช่อง "คีย์ทีม" ด้านบนฟอร์มแล้วลองใหม่');
      } else {
        setQueueSubmitResult(j);
        // พังหมด = 400 NO_CONTENT (server ยังคืน rejected ต่อรายการ) — โชว์ผลได้ ไม่ต้องขึ้น error ซ้ำถ้ามี rejected
        if (!res.ok && !(Array.isArray(j.rejected) && j.rejected.length > 0)) {
          const errText = j.error ? formatClientError(j.error) : String(res.status);
          setQueueError(`ส่งเข้าคิวไม่สำเร็จ: ${errText} ${j.errorType ? `(${j.errorType})` : ''}`);
        }
      }
      loadQueueJobs(); // เห็นงานใหม่ในตารางทันที
    } catch (e) {
      setQueueError('เรียก API ล้ม: ' + formatClientError(e));
    } finally {
      setQueueSubmitting(false);
    }
  }

  // ── โหมดคิว: action ต่อแถว (cancel/retry/duplicate) ผ่าน POST /api/mega → refresh ทันที ──
  async function queueAction(action, id) {
    setRowBusy(`${id}:${action}`);
    setQueueError('');
    try {
      const res = await fetch('/api/mega', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setQueueError(`สั่ง "${action}" ไม่สำเร็จ: ${formatClientError(j.error || j)}${j.errorType ? ` (${j.errorType})` : ''}`);
      }
    } catch (e) {
      setQueueError('เรียก API ล้ม: ' + formatClientError(e));
    } finally {
      setRowBusy('');
      loadQueueJobs(); // refresh ทันทีทุกกรณี
    }
  }

  // ★ 18 ก.ค.: เคลียงานที่ตาย (failed/cancelled) ออกจากคิว — ลบถาวร (declutter) · ยืนยันก่อนลบ · ไม่แตะงานที่กำลังทำ/สำเร็จ
  async function clearDeadJobs() {
    const dead = queueJobs.filter((j) => j && (j.status === 'failed' || j.status === 'cancelled'));
    if (dead.length === 0) return;
    if (!window.confirm(`ลบงานที่ตาย (ล้มเหลว/ยกเลิก) ${dead.length} งานออกจากคิวถาวร?\n(ไม่แตะงานที่กำลังทำ และงานที่ได้ปกแล้ว)`)) return;
    setRowBusy('clear'); setQueueError('');
    try {
      const res = await fetch('/api/mega', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clearTerminal' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) setQueueError(`เคลียงานไม่สำเร็จ: ${formatClientError(j.error || j)}${j.errorType ? ` (${j.errorType})` : ''}`);
    } catch (e) {
      setQueueError('เรียก API ล้ม: ' + formatClientError(e));
    } finally {
      setRowBusy('');
      loadQueueJobs();
    }
  }
  // จำนวนงานที่ตาย (failed/cancelled) — ขับปุ่มเคลีย
  const deadJobCount = queueJobs.filter((j) => j && (j.status === 'failed' || j.status === 'cancelled')).length;

  const label = { display: 'block', fontSize: 13, fontWeight: 700, margin: '10px 0 4px', color: '#334155' };
  const input = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box' };

  // preview รายการคิว (คำนวณสด จาก textarea) — นับ + ความยาว + เตือนสั้น
  const parsedQueue = parseQueueItems(queueText);
  // ★ 18 ก.ค. 69: เปิดเอดิเตอร์ได้เมื่อผลรอบนี้มีวัตถุดิบครบ (โครง ref แบบ % + ผังประกอบจริง) — ขาดอย่างใดอย่างหนึ่ง = ซ่อนปุ่ม
  const canOpenEditor = !!(result
    && Array.isArray(result.manifest?.slots) && result.manifest.slots.length > 0
    && Array.isArray(result.matchedRef?.dna?.template?.slots) && result.matchedRef.dna.template.slots.length > 0);
  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11.5, fontWeight: 800, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
  const td = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' };
  const rowBtn = (bg, color, brd) => ({ padding: '4px 8px', borderRadius: 7, border: `1px solid ${brd}`, background: bg, color, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', marginRight: 4, marginBottom: 4 });

  return (
    <div className="crtRoot" style={{ maxWidth: 1100, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      {/* ★ 17 ก.ค. (มือถือ): media query ชุดเดียวครอบทั้งหน้า — จอแคบ: กริด 2 คอลัมน์พับเป็น 1 ·
          input/textarea ≥16px กัน iOS ซูมเด้งตอนแตะ · ปุ่มในตารางคิวขยายเต็มนิ้ว (แถวละบรรทัด) */}
      <style>{`
        @media (max-width: 700px) {
          .crtRoot { padding: 12px !important; }
          .crtTwoCol { grid-template-columns: 1fr !important; gap: 14px !important; }
          .crtRoot input, .crtRoot textarea { font-size: 16px !important; }
          .crtQueueTable button { padding: 10px 14px !important; font-size: 13.5px !important; min-height: 42px; margin-bottom: 6px !important; display: inline-block; }
          .crtQueueTable td, .crtQueueTable th { padding: 8px 8px !important; }
        }
      `}</style>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>🎯 Cover Ref Test — เทียบภาพแสนไลค์</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        ผ่านท่อ MEGA เต็มทุกขั้น: analyze → keywords → search 4 แหล่ง → triage → เลือก 5 ช่อง → ปก · สร้าง AC-xxxx จริง (ช้ากว่าเดิม ~8-11 นาที)
        {' · '}<a href="/mega-compose-test" style={{ color: '#4f46e5', fontWeight: 700 }}>⚡ ทางลัดประกอบจากเคสเดิม (~20 วิ)</a>
      </p>

      <div className="crtTwoCol" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* ── ฟอร์ม ── */}
        <div>
          <label style={label}>หัวข่าว</label>
          <input style={input} value={title} onChange={e => setTitle(e.target.value)} placeholder="เช่น เบสท์ คำสิงห์ ซื้อรถให้แม่" />

          <label style={label}>เนื้อข่าวเต็ม *</label>
          <textarea style={{ ...input, minHeight: 200, resize: 'vertical', fontFamily: 'inherit' }} value={content} onChange={e => setContent(e.target.value)} placeholder="วางเนื้อข่าวเต็ม (ห้ามเนื้อสั้นตัดทอน)" />
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{content.trim().length} ตัวอักษร</div>

          {/* ★ โหมดคลิปต้นทาง (18 ก.ค.): ข่าวจากคลิปมีต้นทางเสมอ — แคปเฟรมจากคลิปจริง = ภาพตรงข่าวที่สุด */}
          <label style={label}>🎬 ลิงก์คลิปต้นทาง (ทางเลือก — TikTok / YouTube / Facebook, ≤3 ลิงก์)</label>
          <textarea style={{ ...input, minHeight: 54, resize: 'vertical', fontFamily: 'inherit' }} value={clipLinks} onChange={e => setClipLinks(e.target.value)} placeholder={'วางลิงก์คลิปที่ข่าวมาจาก (บรรทัดละลิงก์) — ระบบจะแคปเฟรมจากคลิปเป็น "ภาพหลัก" ก่อน แล้วค่อยค้นเว็บเสริม\nไม่กรอกก็ได้: ถ้าเนื้อข่าวมีลิงก์คลิปแปะอยู่ ระบบดึงให้อัตโนมัติ'} />

          <label style={label}>ล็อก ref ID (ทางเลือก — ปล่อยว่าง = match อัตโนมัติ)</label>
          <input style={input} value={refLock} onChange={e => setRefLock(e.target.value)} placeholder="เช่น vt_ref_5x4 (ปล่อยว่างถ้าไม่ต้องล็อก)" />

          {/* ★ 15 ก.ค. 69 แบตช์ 5: คีย์ทีม — ด่านตรวจสิทธิ์ (middleware) ต้องใช้เมื่อเรียกผ่านโฮสต์ cloud เท่านั้น */}
          <label style={label}>คีย์ทีม (ใช้เมื่อเรียกผ่านโฮสต์ — เครื่องทีมปล่อยว่างได้)</label>
          <input type="password" style={input} value={teamKey} onChange={e => setTeamKey(e.target.value)} placeholder="กรอกเฉพาะตอนเรียกผ่านโฮสต์ (cloud) — เครื่องทีม/localhost ไม่ต้องกรอก" />

          <div style={{ marginTop: 10, padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534' }}>
            🎯 โครงปก = ตามปกเป้าจาก <a href="/ref-covers" style={{ color: '#166534', fontWeight: 700 }}>คลัง reference</a> อัตโนมัติ (ระบบ match แนวข่าว → ใช้ template จาก DNA ปกนั้นจริง)
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              onClick={generate}
              disabled={loading}
              style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: loading ? '#94a3b8' : '#2563eb', color: '#fff', fontSize: 15, fontWeight: 800, cursor: loading ? 'wait' : 'pointer' }}
            >
              {loading ? `⏳ กำลังสร้างปก… ${elapsed}s` : '🎨 สร้างปก'}
            </button>
            {loading && (
              <button
                type="button"
                onClick={cancelGenerate}
                style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                ✋ ยกเลิก
              </button>
            )}
          </div>
          {error && (
            <div style={{ marginTop: 10, padding: 10, background: cancelled ? '#f1f5f9' : '#fef2f2', border: `1px solid ${cancelled ? '#cbd5e1' : '#fecaca'}`, borderRadius: 8, color: cancelled ? '#475569' : '#b91c1c', fontSize: 13 }}>{error}</div>
          )}
          {failInfo && (
            <div style={{ marginTop: 10, padding: 10, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, fontSize: 12, color: '#7c2d12' }}>
              <div><b>errorType:</b> {failInfo.errorType || '-'}</div>
              {failInfo.holdReason && <div style={{ marginTop: 4 }}><b>holdReason:</b> {failInfo.holdReason}</div>}
              {Array.isArray(failInfo.qcVerdict?.reasons) && failInfo.qcVerdict.reasons.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <b>QC reasons:</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {failInfo.qcVerdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {Array.isArray(failInfo.trace) && failInfo.trace.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <b>trace:</b>
                  <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11, background: '#fff', border: '1px solid #fed7aa', borderRadius: 6, padding: 6, maxHeight: 180, overflowY: 'auto' }}>
                    {failInfo.trace.filter(Boolean).map((t, i) => (
                      <div key={i}>{t.stage || '?'} · {t.status || '?'}{t.summary ? ` · ${t.summary}` : ''}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── reference (จากคลัง — match ตามข่าว) ── */}
        <div>
          <label style={label}>📌 reference เป้าหมาย {result?.matchedRef ? `— จากคลัง: ${result.matchedRef.styleName || 'ref'}` : '(จากคลัง)'}</label>
          {/* ★ 9 ก.ค.: เลิก fallback /_ref/reference_5x4.jpg — เทมเพลตนั้นถูกผู้ใช้สั่งลบ (ห้ามโผล่ให้เข้าใจผิดว่ายังใช้) */}
          {result?.matchedRef?.imagePath ? (
            <img src={result.matchedRef.imagePath} alt="reference" style={{ width: '100%', borderRadius: 10, border: '2px solid #e2e8f0' }} />
          ) : (
            <div style={{ width: '100%', padding: '48px 16px', borderRadius: 10, border: '2px dashed #cbd5e1', color: '#94a3b8', fontSize: 13, textAlign: 'center', boxSizing: 'border-box' }}>ยังไม่ได้เลือก ref — ระบบจะ match จากคลังตอนกดสร้าง</div>
          )}
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            {result?.matchedRef
              ? `🎯 match: ${result.matchedRef.reason}${result.matchedRef.dna?.layoutType ? ' · โครง: ' + result.matchedRef.dna.layoutType : ''}`
              : <>ระบบจะเลือกปกเป้าจาก <a href="/ref-covers" style={{ color: '#2563eb' }}>คลัง reference</a> ที่แนวตรงข่าว ตอนกดสร้าง (คลังว่าง = ใช้รูปตั้งต้น)</>}
          </div>
        </div>
      </div>

      {/* ── ผลลัพธ์ ── */}
      {result && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>ผลลัพธ์</h2>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap', fontSize: 13 }}>
            <span style={{ padding: '4px 10px', background: '#eff6ff', borderRadius: 6 }}>โครง: <b>{result.template}</b></span>
            {/* ★ 15 ก.ค. 69 บัค #4: ขับด้วย qcVerdict.pass (result.score เป็นสตริง "เหมือน ref X%" เทียบตัวเลขไม่ได้) */}
            <span style={{ padding: '4px 10px', background: result.qcVerdict?.pass == null ? '#f1f5f9' : result.qcVerdict.pass ? '#dcfce7' : '#fee2e2', borderRadius: 6 }}>
              QC: <b>{result.qcVerdict?.pass == null ? 'ไม่มีผล QC' : result.qcVerdict.pass ? 'ผ่าน' : 'ไม่ผ่าน'}</b>
              {typeof result.refSimilarity === 'number' ? ` · เหมือน ref ${result.refSimilarity}%` : ''}
            </span>
            {/* ★ 15 ก.ค. 69 บัค #12: result.elapsed ไม่มีจริง — ใช้ elapsedTotal */}
            <span style={{ padding: '4px 10px', background: '#f1f5f9', borderRadius: 6 }}>เวลา: {result.elapsedTotal || '-'}</span>
            {result.caseId && <span style={{ padding: '4px 10px', background: '#f1f5f9', borderRadius: 6 }}>เคส: {result.caseId}</span>}
            {/* ★ Preview MVP item 5: โหมดต้องเห็นชัดเสมอ — ไม่มี mode selector, เป็นแค่การแสดงผลความจริง */}
            <span style={{ padding: '4px 10px', background: result.effectiveMode === 'strict' ? '#ede9fe' : '#fef9c3', borderRadius: 6 }}>
              โหมด: <b>{result.effectiveMode === 'strict' ? 'Strict (Production parity)' : 'Preview / Advisory'}</b>
            </span>
            {result.outputId && <span style={{ padding: '4px 10px', background: '#f1f5f9', borderRadius: 6 }}>outputId: {result.outputId}</span>}
          </div>
          {result.effectiveMode !== 'strict' && (
            <div style={{ marginBottom: 10, padding: 10, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#854d0e' }}>
              ℹ️ โหมด Preview/Advisory — ผลนี้เป็นตัวอย่างให้ดูเท่านั้น ไม่ใช่ผลที่ผ่านมาตรฐาน Strict Production
              (ปกจริงบน Production ต้องผ่าน strict carrier + identity + QC ครบทุกด่านเท่านั้นถึงจะออก)
            </div>
          )}
          {result.productionQcPass === false && (
            <div style={{ marginBottom: 10, padding: 10, background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, fontSize: 12, color: '#9a3412' }}>
              ⚠️ QC ไม่ผ่าน (ผล advisory เท่านั้น) — Production จริงจะปฏิเสธปกนี้ (422 QC_REJECTED) และจะไม่บันทึกเข้าคลัง
              ผลที่แสดงด้านล่างมีไว้ดูตัวอย่างเท่านั้น
            </div>
          )}
          {/* ★ 15 ก.ค. 69 บัค #11: โชว์ qcVerdict.reasons เต็มในเคสสำเร็จ */}
          {Array.isArray(result.qcVerdict?.reasons) && result.qcVerdict.reasons.length > 0 && (
            <div style={{ marginBottom: 10, padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#334155' }}>
              <b>QC reasons:</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {result.qcVerdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {result.throughMega && (
            <div style={{ margin: '4px 0 10px', padding: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534' }}>
              ✅ ผ่านท่อ MEGA จริง · AC: <b>{result.imageCaseId || '-'}</b> · คีย์เวิร์ด {result.keywordsCount ?? '-'} · พูล {result.poolSize ?? '-'} ใบ · รวม {result.elapsedTotal || '-'}
              {Array.isArray(result.trace) && (
                <div style={{ marginTop: 4, color: '#3f6212' }}>
                  {result.trace.filter(Boolean).map((t) => `${t.stage}${t.status === 'failed' ? '❌' : '✓'}`).join(' → ')}
                </div>
              )}
              {result.pickedSlots && (
                <div style={{ marginTop: 4, color: '#3f6212' }}>
                  ช่อง: {Object.entries(result.pickedSlots).filter(([, v]) => v).map(([k, v]) => `${k}=${v.person || v.category || '?'}`).join(' · ')}
                </div>
              )}
            </div>
          )}
          {result.directorReason && <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 12px' }}>🎬 {result.directorReason}</p>}
          <div className="crtTwoCol" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>ปกที่ระบบสร้าง</span>
                {/* ★ 18 ก.ค. 69: แก้ต่อในเอดิเตอร์ (sync) — สูตรจาก manifest ผังจริง ส่งข้ามแท็บเหมือนท่อทางลัด */}
                {canOpenEditor && (
                  <button type="button" onClick={openInEditor} disabled={editorBusy}
                    style={{ padding: '3px 10px', borderRadius: 6, background: editorBusy ? '#94a3b8' : '#0d9488', color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', cursor: editorBusy ? 'wait' : 'pointer' }}>
                    {editorBusy ? '⏳ กำลังเตรียมสูตร…' : '🎨 แก้ต่อในเอดิเตอร์'}
                  </button>
                )}
              </div>
              <img src={result.base64} alt="cover" style={{ width: '100%', borderRadius: 10, border: '2px solid #2563eb' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4 }}>reference (เป้า){result.matchedRef?.styleName ? ` — ${result.matchedRef.styleName}` : ''}</div>
              {result.matchedRef?.imagePath ? (
                <img src={result.matchedRef.imagePath} alt="reference" style={{ width: '100%', borderRadius: 10, border: '2px solid #e2e8f0' }} />
              ) : (
                <div style={{ width: '100%', padding: '48px 16px', borderRadius: 10, border: '2px dashed #cbd5e1', color: '#94a3b8', fontSize: 13, textAlign: 'center', boxSizing: 'border-box' }}>รอบนี้ไม่ได้ใช้ ref จากคลัง</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* 📥 โหมดคิว (Q2) — หลายข่าว, ปิดบราวเซอร์ได้ (collapsible, default ปิด) */}
      {/* ═══════════════════════════════════════════════════════ */}
      <div style={{ marginTop: 28, borderTop: '2px dashed #e2e8f0', paddingTop: 16 }}>
        <button
          type="button"
          onClick={() => setQueueOpen((v) => !v)}
          style={{ width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#0f172a', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}
        >
          {queueOpen ? '▲' : '▼'} 📥 โหมดคิว (หลายข่าว — ปิดบราวเซอร์ได้)
        </button>

        {queueOpen && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 8px' }}>
              วางหลายข่าวในกล่องเดียว คั่นแต่ละข่าวด้วยบรรทัดที่มีแค่ <b>---</b> · แต่ละข่าว: บรรทัดแรก = หัวข่าว, ที่เหลือ = เนื้อข่าวเต็ม ·
              ส่งเข้าคิวแล้วปิดหน้าได้ — สายพานเดินเองจนได้ปก (เปิดหน้านี้ค้างไว้ = ช่วยเดินเครื่องให้ด้วย)
            </p>
            <textarea
              style={{ ...input, minHeight: 200, resize: 'vertical', fontFamily: 'inherit' }}
              value={queueText}
              onChange={(e) => setQueueText(e.target.value)}
              placeholder={'หัวข่าวที่ 1\nเนื้อข่าวเต็มของข่าวที่ 1...\n(หลายบรรทัดได้)\n---\nหัวข่าวที่ 2\nเนื้อข่าวเต็มของข่าวที่ 2...'}
            />

            {/* preview นับรายการ + ความยาว + เตือนสั้น */}
            {parsedQueue.length > 0 && (
              <div style={{ marginTop: 8, padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, color: '#334155' }}>
                <b>พบ {parsedQueue.length} รายการ</b> (ส่งทุกรายการให้เซิร์ฟเวอร์ตัดสิน — server รายงานรายการที่ถูกปฏิเสธกลับมา):
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {parsedQueue.map((it, i) => {
                    const warn = queueItemWarning(it);
                    return (
                      <li key={i} style={{ marginBottom: 2 }}>
                        <b>{i + 1}.</b> {it.newsTitle ? it.newsTitle.slice(0, 60) : <i style={{ color: '#94a3b8' }}>(ไม่มีหัวข่าว)</i>}
                        <span style={{ color: '#94a3b8' }}> · เนื้อ {String(it.content || '').trim().length} ตัวอักษร</span>
                        {warn && <span style={{ color: '#b91c1c', fontWeight: 700 }}> · ⚠️ {warn}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={submitQueue}
              disabled={queueSubmitting || parsedQueue.length === 0}
              style={{ marginTop: 12, padding: '11px 18px', borderRadius: 10, border: 'none', background: (queueSubmitting || parsedQueue.length === 0) ? '#94a3b8' : '#7c3aed', color: '#fff', fontSize: 14, fontWeight: 800, cursor: (queueSubmitting || parsedQueue.length === 0) ? 'not-allowed' : 'pointer' }}
            >
              {queueSubmitting ? '⏳ กำลังส่ง…' : `🚀 ส่งเข้าคิว (${parsedQueue.length} รายการ)`}
            </button>

            {queueError && (
              <div style={{ marginTop: 10, padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 13 }}>{queueError}</div>
            )}

            {/* ผลการส่งเข้าคิว: เข้าคิว (jobId+title) + ถูกปฏิเสธ (index+error) */}
            {queueSubmitResult && (
              <div style={{ marginTop: 10, padding: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12.5, color: '#166534' }}>
                {Array.isArray(queueSubmitResult.jobs) && queueSubmitResult.jobs.length > 0 && (
                  <div>
                    ✅ เข้าคิว {queueSubmitResult.jobs.length} งาน:
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {queueSubmitResult.jobs.map((jb, i) => <li key={i}><b>{jb.jobId}</b> — {jb.title || '(ไม่มีหัวข่าว)'}</li>)}
                    </ul>
                  </div>
                )}
                {Array.isArray(queueSubmitResult.rejected) && queueSubmitResult.rejected.length > 0 && (
                  <div style={{ marginTop: 6, color: '#9a3412' }}>
                    ⚠️ ถูกปฏิเสธ {queueSubmitResult.rejected.length} รายการ:
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {queueSubmitResult.rejected.map((rj, i) => <li key={i}>รายการที่ {typeof rj.index === 'number' ? rj.index + 1 : '?'} — {formatClientError(rj.error)}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── ตารางสถานะคิว ── */}
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>📋 สถานะคิว ({queueJobs.length})</h3>
                <button type="button" onClick={loadQueueJobs} style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>🔄 รีเฟรช</button>
                {/* ★ 18 ก.ค.: เคลียงานที่ตาย (failed/cancelled) — โผล่เฉพาะเมื่อมีงานตาย */}
                {deadJobCount > 0 && (
                  <button type="button" onClick={clearDeadJobs} disabled={rowBusy === 'clear'}
                    title="ลบงานที่ล้มเหลว/ยกเลิกออกจากคิวถาวร (ไม่แตะงานที่กำลังทำ/ได้ปกแล้ว)"
                    style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #fecaca', background: rowBusy === 'clear' ? '#fca5a5' : '#fef2f2', color: '#b91c1c', fontSize: 12, fontWeight: 700, cursor: rowBusy === 'clear' ? 'wait' : 'pointer' }}>
                    {rowBusy === 'clear' ? '⏳ กำลังเคลีย…' : `🧹 เคลียงานที่ตาย (${deadJobCount})`}
                  </button>
                )}
                <span style={{ fontSize: 11, color: '#94a3b8' }}>อัปเดตอัตโนมัติทุก 5 วิ</span>
              </div>
              {queueJobs.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13, border: '1px dashed #cbd5e1', borderRadius: 8 }}>ยังไม่มีงานในคิว — ส่งข่าวเข้าคิวด้านบน</div>
              ) : (
                <div className="crtQueueTable" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={th}>id</th>
                        <th style={th}>หัวข่าว</th>
                        <th style={th}>ขั้น</th>
                        <th style={th}>สถานะ</th>
                        <th style={th}>อายุ</th>
                        <th style={th}>ล่าสุด</th>
                        <th style={th}>จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueJobs.map((job) => {
                        const d = job.dossier || {};
                        const st = rtStatusStyle(job.status);
                        const stageLabel = RT_STAGE_LABELS[job.stage] || job.stage || '-';
                        const ageMin = job.createdAt ? Math.max(0, Math.round((Date.now() - new Date(job.createdAt).getTime()) / 60000)) : null;
                        const lastDone = Array.isArray(job.stagesDone) && job.stagesDone.length > 0 ? job.stagesDone[job.stagesDone.length - 1] : null;
                        const coverPath = d.cover?.coverPath;
                        const isActive = RT_ACTIVE_STATUSES.includes(job.status);
                        const isTerminal = !isActive; // cover_ready / failed / cancelled ฯลฯ
                        // ★ แบตช์ E (E2b): งานที่มีการเลือกภาพแล้ว (pickImages) → เปิดแก้เองในเอดิเตอร์ได้ทุกสถานะ (รวม failed)
                        const hasPick = !!(d.pickImages && d.pickImages.slots && Object.keys(d.pickImages.slots).length > 0);
                        return (
                          <tr key={job.id}>
                            <td style={{ ...td, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{job.id}</td>
                            <td style={{ ...td, maxWidth: 220 }}>{d.desk?.title || <i style={{ color: '#94a3b8' }}>-</i>}</td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{stageLabel}</td>
                            <td style={td}>
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.color, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {RT_STATUS_TEXT[job.status] || job.status}
                              </span>
                            </td>
                            <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748b' }}>{ageMin == null ? '-' : `${ageMin} นาที`}</td>
                            {/* ★ Q3 hotfix: งานล้ม = โชว์สาเหตุจาก job.summary ก่อน (tick เขียนตอน fail) — งานตายต้องเห็นสาเหตุ */}
                            <td style={{ ...td, maxWidth: 200, color: job.status === 'failed' ? '#b91c1c' : '#64748b' }}>
                              {(job.status === 'failed' && job.summary) ? job.summary : (lastDone ? (lastDone.summary || lastDone.label || '') : '')}
                            </td>
                            <td style={{ ...td, minWidth: 180 }}>
                              {coverPath && (
                                <a href={coverPath} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} title="เปิดปกแท็บใหม่">
                                  <img src={coverPath} alt="ปก" style={{ width: 34, height: 42, objectFit: 'cover', borderRadius: 5, border: '1px solid #86efac' }} />
                                </a>
                              )}
                              {isActive && (
                                <button type="button" disabled={!!rowBusy} onClick={() => queueAction('cancel', job.id)} style={rowBtn('#fef2f2', '#b91c1c', '#fecaca')}>
                                  {rowBusy === `${job.id}:cancel` ? '…' : '✋ ยกเลิก'}
                                </button>
                              )}
                              {job.status === 'failed' && (
                                <button type="button" disabled={!!rowBusy} onClick={() => queueAction('retry', job.id)} style={rowBtn('#fffbeb', '#92400e', '#fde68a')}>
                                  {rowBusy === `${job.id}:retry` ? '…' : '🔁 ลองใหม่'}
                                </button>
                              )}
                              {isTerminal && (
                                <button type="button" disabled={!!rowBusy} onClick={() => queueAction('duplicate', job.id)} style={rowBtn('#eff6ff', '#1d4ed8', '#bfdbfe')}>
                                  {rowBusy === `${job.id}:duplicate` ? '…' : '🧬 ทำซ้ำ'}
                                </button>
                              )}
                              {coverPath && (
                                <a href={coverPath} target="_blank" rel="noreferrer" style={{ ...rowBtn('#f0fdf4', '#166534', '#bbf7d0'), display: 'inline-block', textDecoration: 'none' }}>🖼️ ดูปก</a>
                              )}
                              {/* ★ แบตช์ E (E2b): แก้ต่อในเอดิเตอร์ — ทุกงานที่เลือกภาพแล้ว รวม failed */}
                              {hasPick && (
                                <a href={`/cover-tester?recipe=${encodeURIComponent(job.id)}`} target="_blank" rel="noreferrer"
                                  title={job.status === 'failed' ? 'ระบบทำไม่ผ่าน — เปิดแก้เอง' : 'เปิดจัดภาพต่อในเอดิเตอร์'}
                                  style={{ ...rowBtn('#faf5ff', '#7c3aed', '#e9d5ff'), display: 'inline-block', textDecoration: 'none' }}>🎨 แก้ต่อ</a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 📥 โหมดคิว (Q2) — ตัวช่วยฝั่ง client (pure, ไม่ import megaAdapters เข้าหน้า)
//   วางไว้ท้ายไฟล์ (นอกกรอบ formatClientError↔component ที่ ac0099 วัดขนาด) — ใช้ตอน render เท่านั้น
// ============================================================

// ★ Q3-3 ชุดเดียวกับ /mega — ป้ายไทยของขั้น rt_* (สาย reftest) · terminal cover_ready รวมไว้ด้วย
const RT_STAGE_LABELS = {
  rt_compass: 'เข็มทิศ',
  rt_s5case: 'เปิดเคสภาพ',
  rt_s5keywords: 'สกัดคีย์เวิร์ด',
  rt_s5search: 'ค้นภาพหลายแหล่ง',
  rt_s5triage: 'ตาคัดคลัง',
  rt_s5clipframe: 'เฟรมคลิป',
  rt_s6slots: 'เลือกภาพลงช่อง',
  rt_s7compose: 'ประกอบปก + QC + คลัง',
  cover_ready: '🏁 ปกเสร็จ',
};

// สถานะที่ยัง "เดินอยู่" (tick ต้องขับต่อ + ปุ่มยกเลิกใช้ได้)
const RT_ACTIVE_STATUSES = ['pending', 'running', 'waiting'];

// ชิปสีตามสถานะงานคิว (ตาม SPEC: pending เทา / running ฟ้า / waiting เหลือง / failed แดง / cancelled เทาเข้ม / cover_ready เขียว)
function rtStatusStyle(status) {
  const map = {
    pending: { bg: '#e2e8f0', color: '#475569' },
    running: { bg: '#dbeafe', color: '#1d4ed8' },
    waiting: { bg: '#fef9c3', color: '#854d0e' },
    failed: { bg: '#fee2e2', color: '#b91c1c' },
    cancelled: { bg: '#475569', color: '#e2e8f0' },
    cover_ready: { bg: '#dcfce7', color: '#166534' },
  };
  return map[status] || { bg: '#f1f5f9', color: '#475569' };
}

const RT_STATUS_TEXT = {
  pending: 'รอเริ่ม',
  running: 'กำลังทำ',
  waiting: 'รอขั้นถัดไป',
  failed: 'ล้มเหลว',
  cancelled: 'ยกเลิกแล้ว',
  cover_ready: '🏁 ปกเสร็จ',
};

// แยกข้อความหลายข่าว: คั่นแต่ละข่าวด้วยบรรทัดที่มีแค่ --- · บล็อกละ: บรรทัดแรก=หัวข่าว, ที่เหลือ=เนื้อข่าวเต็ม
function parseQueueItems(text) {
  const lines = String(text || '').split(/\r?\n/);
  const groups = [];
  let cur = [];
  for (const line of lines) {
    if (line.trim() === '---') { groups.push(cur); cur = []; }
    else cur.push(line);
  }
  groups.push(cur);
  const items = [];
  for (const g of groups) {
    const gl = g.slice();
    while (gl.length && gl[0].trim() === '') gl.shift();            // ตัดบรรทัดว่างนำหน้า
    while (gl.length && gl[gl.length - 1].trim() === '') gl.pop();  // ตัดบรรทัดว่างท้าย
    if (gl.length === 0) continue;                                  // บล็อกว่างล้วน = ข้าม
    const newsTitle = (gl[0] || '').trim();
    const content = gl.slice(1).join('\n').trim();
    items.push({ newsTitle, content });
  }
  return items;
}

// เตือนรายการที่สั้นกว่าเกณฑ์ (เหมือน gate ฝั่ง server: เนื้อ≥100 · หัว+เนื้อ≥200) — เตือนเฉยๆ ส่งทุกรายการให้ server ตัดสิน
function queueItemWarning(it) {
  const c = String(it.content || '').trim();
  const combinedLen = [String(it.newsTitle || '').trim(), c].filter(Boolean).join('\n\n').length;
  if (c.length < 100) return `เนื้อสั้น (${c.length}/100 ตัวอักษร)`;
  if (combinedLen < 200) return `เนื้อหารวมสั้น (${combinedLen}/200 ตัวอักษร)`;
  return '';
}
