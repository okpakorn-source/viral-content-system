'use client';

// ============================================================
// 🗞️ โต๊ะข่าวกลาง v2 — โมดูลแรก: 🧬 DNA Lab (เฟส 1)
// ------------------------------------------------------------
// อัปโหลด CSV (Meta export) → แมป → สแกน S/A → วิจัย DNA ทีละก้อน (เก็บทันทีทุกก้อน)
// → สังเคราะห์ภาพรวม → รีวิว/คลัง. อ่านไฟล์ฝั่ง browser เท่านั้น · resume ผ่านคลัง (existing)
// backend: /api/desk/dna/{analyze,library,runs,synthesize}
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { UI, apiFetch, fmtNum } from './components/ui.js';
import { autoMapColumns, rowsToPosts, summarizePosts } from '../../lib/services/deskV2/csvClient.js';
import UploadZone from './components/UploadZone.js';
import MappingConfirm from './components/MappingConfirm.js';
import ScanSummary from './components/ScanSummary.js';
import RunPanel from './components/RunPanel.js';
import ReviewList from './components/ReviewList.js';
import SynthesisReport from './components/SynthesisReport.js';
import LibraryTab from './components/LibraryTab.js';
import ResearchTab from './components/ResearchTab.js';
import ContentLibraryTab from './components/ContentLibraryTab.js';
import HistoryTab from './components/HistoryTab.js';

const LIB = '/api/desk/dna/library';
const LS_KEY = 'ndv2_dna_run';
const CHUNK = 5;
const UNIT = { primary: 1.1, fast: 0.12 };
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// ── สถิติกลุ่มควบคุม (ฝั่ง client) ──
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function topFreq(arr, n) {
  const f = {};
  for (const x of arr) f[x] = (f[x] || 0) + 1;
  return Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, n);
}
function controlStats(posts) {
  const valid = posts.filter((p) => p.title && p.title.length >= 10);
  const total = valid.length || 1;
  const contrast = valid.filter((p) => /แม้|ทั้งๆ?ที่|แต่กลับ/.test(p.title)).length;
  const numbers = valid.filter((p) => /\d/.test(p.title)).length;
  const metrics = valid.map((p) => Number(p.reach) || 0);
  const hours = valid.map((p) => (p.publishedAt ? new Date(p.publishedAt).getHours() : null)).filter((h) => h != null && !isNaN(h));
  const days = valid.map((p) => (p.publishedAt ? new Date(p.publishedAt).getDay() : null)).filter((d) => d != null && !isNaN(d));
  return {
    count: valid.length,
    contrastPct: Math.round((contrast / total) * 100),
    numbersPct: Math.round((numbers / total) * 100),
    medianMetric: median(metrics),
    topHours: topFreq(hours, 3).map(([h, c]) => ({ hour: Number(h), count: c })),
    topDays: topFreq(days, 3).map(([d, c]) => ({ day: Number(d), dayName: THAI_DAYS[Number(d)], count: c })),
  };
}
// ── ย่อ record → exemplar เล็กสำหรับส่งสังเคราะห์ ──
function toExemplar(r) {
  const d = r.dna || {};
  return {
    title: String(r.title || '').slice(0, 90),
    archetype: d.archetype || '',
    twist: d.twist || '',
    category: d.category || '',
    triggers: (d.emotionalTriggers || []).slice(0, 3),
    reach: Number(r.reach) || 0,
    confidence: Number(d.confidence) || 0,
  };
}

export default function NewsDeskV2Page() {
  // ── toast ──
  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((msg, type = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // ── โครง ──
  const [activeModule, setActiveModule] = useState('dna'); // 'dna' | 'research' (โมดูลระดับบน)
  const [dnaTab, setDnaTab] = useState('research'); // 'research' | 'library'
  const [stage, setStage] = useState('upload');     // upload|mapping|scan|run|done

  // ── ข้อมูลไฟล์/แมป ──
  const [header, setHeader] = useState(null);
  const [rows, setRows] = useState(null);
  const [sources, setSources] = useState([]);
  const [mapping, setMapping] = useState({});
  const [metricKey, setMetricKey] = useState('reach');
  const [thresholds, setThresholds] = useState({ S: 900000, A: 500000 });

  // ── สแกน ──
  const [posts, setPosts] = useState([]);
  const [summary, setSummary] = useState({ S: 0, A: 0, control: 0, bad: 0, total: 0, research: 0 });
  const [dupChecked, setDupChecked] = useState(false);
  const [dupCount, setDupCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const dupSetRef = useRef({ idSet: new Set(), titleSet: new Set(), isDup: () => false }); // audit R2: 2 ชั้น postId+title
  const [model, setModel] = useState('primary');
  const [starting, setStarting] = useState(false);

  // ── run ──
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [counters, setCounters] = useState({ researched: 0, saved: 0, dup: 0, failed: 0 });
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [results, setResults] = useState([]);
  const [synthesis, setSynthesis] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);

  // ── refs (กัน stale closure ใน loop) ──
  const pausedRef = useRef(false);
  const queueRef = useRef([]);
  const statsRef = useRef({ researched: 0, saved: 0, dup: 0, failed: 0 });
  const resultsRef = useRef([]);
  const runIdRef = useRef('');
  const metaRef = useRef({ model: 'primary', metricKey: 'reach', fileName: '' });

  // ── resume banner (จาก localStorage) ──
  const [pendingRun, setPendingRun] = useState(null);
  useEffect(() => {
    let raw = null;
    try { raw = typeof window !== 'undefined' ? window.localStorage.getItem(LS_KEY) : null; } catch { raw = null; }
    if (!raw) return undefined;
    let p = null;
    try { p = JSON.parse(raw); } catch { return undefined; }
    if (!(p && p.runId && p.status !== 'done' && (p.total || 0) > (p.cursor || 0))) return undefined;
    // เลี่ยง setState ตรงๆ ใน effect (กฎ react-hooks/set-state-in-effect) — เลื่อนไป tick ถัดไป
    const id = setTimeout(() => setPendingRun(p), 0);
    return () => clearTimeout(id);
  }, []);

  const persistRun = useCallback((patch) => {
    try {
      const cur = { runId: runIdRef.current, ...metaRef.current, ...patch };
      window.localStorage.setItem(LS_KEY, JSON.stringify(cur));
    } catch { /* ignore */ }
  }, []);
  const clearPersist = useCallback(() => {
    try { window.localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    setPendingRun(null);
  }, []);

  const pushLog = useCallback((line) => {
    const stamped = `${new Date().toLocaleTimeString('th-TH')} · ${line}`;
    setLog((l) => [stamped, ...l].slice(0, 5));
  }, []);

  // ============================================================
  //  ขั้น 1 → 2: โหลดไฟล์เสร็จ → auto-map → ไปหน้าแมป
  // ============================================================
  function handleLoaded({ header: h, rows: r, sources: s }) {
    setHeader(h);
    setRows(r);
    setSources(s);
    setMapping(autoMapColumns(h));
    setDupChecked(false);
    setDupCount(0);
    dupSetRef.current = { idSet: new Set(), titleSet: new Set(), isDup: () => false };
    setStage('mapping');
  }

  // ============================================================
  //  ขั้น 2 → 3: ยืนยันแมป → คำนวณ posts + summary → ไปสแกน
  // ============================================================
  function confirmMapping() {
    const tiers = { S: { min: Number(thresholds.S) || 900000 }, A: { min: Number(thresholds.A) || 500000, max: Number(thresholds.S) || 900000 } };
    const p = rowsToPosts(rows, mapping, { metricKey, tiers });
    setPosts(p);
    setSummary(summarizePosts(p));
    setStage('scan');
  }

  // ── เช็คซ้ำกับคลัง — 🔒 audit R2 (18 ก.ค.): เดิมเทียบ postId อย่างเดียวแต่คลังไม่เคยเก็บ field นี้ → ซ้ำ 0 เสมอ
  //   ใหม่: เทียบ 2 ชั้น postId (record ใหม่ที่เริ่มเก็บแล้ว) + title normalize (ครอบคลุมคลังเก่าทั้งหมด) ──
  const _normTitle = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  async function checkDup() {
    setChecking(true);
    const res = await apiFetch(`${LIB}?limit=500`);
    setChecking(false);
    if (!res.success) { pushToast(res.error || 'เช็คซ้ำไม่สำเร็จ', 'err'); return; }
    const idSet = new Set((res.exemplars || []).map((e) => String(e.postId || '')).filter(Boolean));
    const titleSet = new Set((res.exemplars || []).map((e) => _normTitle(e.title)).filter((t) => t.length >= 10));
    const isDup = (p) => idSet.has(String(p.postId || '')) || titleSet.has(_normTitle(p.title));
    dupSetRef.current = { idSet, titleSet, isDup };
    // นับเฉพาะ S/A ที่อยู่ในคลังแล้ว (ชั้นใดชั้นหนึ่งตรง)
    const dups = posts.filter((p) => (p.tier === 'S' || p.tier === 'A') && p.title.length >= 10 && isDup(p)).length;
    setDupCount(dups);
    setDupChecked(true);
    pushToast(`เช็คซ้ำแล้ว — พบซ้ำ ${fmtNum(dups)} ใบ`, 'ok');
  }

  // ============================================================
  //  ขั้น 3 → 4: เริ่มวิจัย (สร้าง run + เริ่ม loop)
  // ============================================================
  // queue คงที่ (deterministic) เพื่อให้ resume ตำแหน่งตรง — ไม่ตัด dup ออก (ปล่อย server ข้ามเอง)
  function buildQueue() {
    return posts
      .filter((p) => (p.tier === 'S' || p.tier === 'A') && p.title && p.title.length >= 10)
      .slice()
      .sort((a, b) => (Number(b.reach) || 0) - (Number(a.reach) || 0) || String(a.postId).localeCompare(String(b.postId)));
  }

  async function startResearch() {
    const queue = buildQueue();
    if (!queue.length) { pushToast('ไม่มีข่าวกลุ่ม S/A ที่ต้องวิจัย', 'warn'); return; }
    setStarting(true);

    const fileName = sources.map((s) => s.name).join(', ').slice(0, 120);
    // resume: ถ้า pendingRun ตรงชื่อไฟล์ → ใช้ runId เดิม + ต่อจาก cursor เดิม
    const resume = pendingRun && pendingRun.fileName === fileName ? pendingRun : null;
    const runId = resume ? resume.runId : 'run_' + Date.now().toString(36);
    runIdRef.current = runId;
    metaRef.current = { model, metricKey, fileName };

    const startCursor = resume ? Math.min(resume.cursor || 0, Math.ceil(queue.length / CHUNK)) : 0;
    statsRef.current = resume?.counters ? { ...resume.counters } : { researched: 0, saved: 0, dup: 0, failed: 0 };
    resultsRef.current = [];
    setCounters(statsRef.current);
    setResults([]);
    setSynthesis(null);

    // สร้าง run (ถ้า resume ไม่ต้องสร้างซ้ำ — create ซ้ำ id เดิมได้ แต่เลี่ยงไว้)
    if (!resume) {
      const netForCost = Math.max(0, (summary.research || 0) - (dupChecked ? dupCount : 0));
      const costEstimate = netForCost * (UNIT[model] ?? UNIT.primary) + 15;
      await apiFetch('/api/desk/dna/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', runId, fileName, counts: { queued: queue.length, S: summary.S, A: summary.A }, costEstimate, model }),
      });
    }

    queueRef.current = queue;
    setProgress({ done: startCursor, total: Math.ceil(queue.length / CHUNK) });
    setStarting(false);
    setStage('run');
    setPendingRun(null);
    persistRun({ cursor: startCursor, total: Math.ceil(queue.length / CHUNK), counters: statsRef.current, status: 'running' });
    runLoop(queue, startCursor);
  }

  // ── loop หัวใจ: วนก้อนละ 5 → analyze → saveBatch ทันที ──
  async function runLoop(queue, startCursor) {
    const total = Math.ceil(queue.length / CHUNK);
    pausedRef.current = false;
    setPaused(false);
    setRunning(true);

    let c = startCursor;
    for (; c < total; c++) {
      if (pausedRef.current) break;
      const chunk = queue.slice(c * CHUNK, c * CHUNK + CHUNK);

      // 1) analyze
      const aRes = await apiFetch('/api/desk/dna/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posts: chunk, model, runId: runIdRef.current, fileName: metaRef.current.fileName }),
      });

      let recs = [];
      let existingN = 0;
      let failedN = 0;
      if (aRes.success) {
        recs = aRes.results || [];
        existingN = (aRes.existing || []).length;
        failedN = (aRes.failed || []).length;
      } else {
        failedN = chunk.length;
        pushLog(`ก้อน ${c + 1}/${total}: วิจัยล้ม (${aRes.error || 'ไม่ทราบสาเหตุ'})`);
      }

      // 2) saveBatch ทันที (งานที่เสร็จเก็บเลย — ปิดแท็บไม่เสียของ)
      let savedN = 0;
      let skippedN = 0;
      if (recs.length) {
        const sRes = await apiFetch(LIB, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'saveBatch', records: recs }),
        });
        if (sRes.success) {
          savedN = (sRes.saved || 0) + (sRes.replaced || 0);
          skippedN = sRes.skipped || 0;
        } else {
          pushLog(`ก้อน ${c + 1}/${total}: เก็บคลังล้ม (${sRes.error || 'ไม่ทราบ'}) — วิจัยแล้วแต่ยังไม่เก็บ`);
        }
        resultsRef.current = [...resultsRef.current, ...recs];
        setResults((prev) => [...prev, ...recs]);
      }

      // 3) อัปเดตตัวนับ + log + persist
      statsRef.current = {
        researched: statsRef.current.researched + recs.length,
        saved: statsRef.current.saved + savedN,
        dup: statsRef.current.dup + existingN + skippedN,
        failed: statsRef.current.failed + failedN,
      };
      setCounters({ ...statsRef.current });
      setProgress({ done: c + 1, total });
      if (aRes.success) {
        pushLog(`ก้อน ${c + 1}/${total}: วิจัย ${recs.length} · เก็บ ${savedN} · ซ้ำ ${existingN + skippedN} · พลาด ${failedN}`);
      }
      persistRun({ cursor: c + 1, total, counters: statsRef.current, status: 'running' });
    }

    if (pausedRef.current && c < total) {
      setPaused(true);
      setRunning(true); // ยังอยู่หน้า run รอ "ทำต่อ"
      return;
    }
    // จบครบทุกก้อน
    setRunning(false);
    await finalize();
  }

  function pauseRun() { pausedRef.current = true; pushToast('จะหยุดหลังก้อนปัจจุบันเสร็จ', 'warn'); }
  function resumeRun() {
    const total = Math.ceil((queueRef.current || []).length / CHUNK);
    runLoop(queueRef.current, Math.min(progress.done, total));
  }

  // ============================================================
  //  ขั้น 5: สังเคราะห์ + ปิด run + ไปหน้า done
  // ============================================================
  async function finalize() {
    // สถิติกลุ่มควบคุม (ฝั่ง client)
    const controlPosts = posts.filter((p) => p.tier !== 'S' && p.tier !== 'A');
    const cstats = controlStats(controlPosts);

    // groups จากผลรอบนี้ (ย่อ ≤80/กลุ่ม)
    const sRecs = resultsRef.current.filter((r) => r.tier === 'S').slice(0, 80).map(toExemplar);
    const aRecs = resultsRef.current.filter((r) => r.tier === 'A').slice(0, 80).map(toExemplar);
    const groups = {
      S: { count: resultsRef.current.filter((r) => r.tier === 'S').length, exemplars: sRecs },
      A: { count: resultsRef.current.filter((r) => r.tier === 'A').length, exemplars: aRecs },
    };

    // สังเคราะห์ (endpoint อาจยังไม่มี → ข้ามอย่างสุภาพ)
    let synth = null;
    if (resultsRef.current.length > 0) {
      const res = await apiFetch('/api/desk/dna/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups, control: { count: cstats.count, stats: cstats }, runId: runIdRef.current, model }),
      });
      if (res.success && res.synthesis) {
        synth = res.synthesis;
      } else if (res._status === 404 || res.errorType === 'BAD_RESPONSE') {
        pushToast('ส่วนสังเคราะห์ยังไม่พร้อม (กำลังพัฒนา) — ข้ามไปก่อน ผลวิจัยเก็บครบแล้ว', 'warn');
      } else {
        pushToast('สังเคราะห์ไม่สำเร็จ: ' + (res.error || '') + ' — ข้ามไปก่อน', 'warn');
      }
    }
    setSynthesis(synth);

    // ปิด run
    const costActual = statsRef.current.researched * (UNIT[model] ?? UNIT.primary) + (synth ? 15 : 0);
    await apiFetch('/api/desk/dna/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'finish', runId: runIdRef.current, resultCounts: { ...statsRef.current }, costActual, synthesis: synth }),
    });

    clearPersist();
    setStage('done');
    pushToast(`วิจัยครบ! เก็บเข้าคลัง ${fmtNum(statsRef.current.saved)} ใบ`, 'ok');
  }

  // ── ลบ record ออกจากคลัง (จากหน้ารีวิว) ──
  async function deleteRecord(postKey) {
    if (!postKey) return;
    setDeletingKey(postKey);
    const res = await apiFetch(LIB, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', postKey }),
    });
    setDeletingKey(null);
    if (res.success) {
      setResults((prev) => prev.filter((r) => (r.postKey || r.id) !== postKey));
      pushToast('ลบออกจากคลังแล้ว', 'ok');
    } else {
      pushToast(res.error || 'ลบไม่สำเร็จ', 'err');
    }
  }

  // ── เริ่มรอบใหม่ ──
  function resetWizard() {
    setStage('upload');
    setHeader(null); setRows(null); setSources([]); setMapping({});
    setPosts([]); setSummary({ S: 0, A: 0, control: 0, bad: 0, total: 0, research: 0 });
    setDupChecked(false); setDupCount(0); dupSetRef.current = { idSet: new Set(), titleSet: new Set(), isDup: () => false };
    setProgress({ done: 0, total: 0 }); setCounters({ researched: 0, saved: 0, dup: 0, failed: 0 });
    setLog([]); setResults([]); setSynthesis(null); resultsRef.current = [];
    statsRef.current = { researched: 0, saved: 0, dup: 0, failed: 0 };
  }

  const metricLabel = metricKey === 'views' ? 'ยอดดู' : 'การเข้าถึง';
  const toastColor = { ok: UI.green, warn: UI.amber, err: UI.red };

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: UI.bg, minHeight: 0 }}>
      {/* keyframes สำหรับ Spinner */}
      <style>{`@keyframes nd-spin{to{transform:rotate(360deg)}}`}</style>

      {/* header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, background: UI.card,
        borderBottom: `1px solid ${UI.line}`, padding: 'clamp(12px,3vw,18px) clamp(14px,4vw,28px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'clamp(18px,4.5vw,24px)', fontWeight: 900, color: UI.text }}>🗞️ โต๊ะข่าวกลาง v2</span>
          {/* แท็บโมดูล */}
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', overflowX: 'auto' }}>
            {[{ k: 'dna', l: '🧬 DNA Lab' }, { k: 'research', l: '🔎 หาข่าวตามรอย' }, { k: 'content', l: '📚 คลังเนื้อพร้อมใช้' }, { k: 'history', l: '🧾 คลังประวัติ' }].map((m) => (
              <button key={m.k} type="button" onClick={() => setActiveModule(m.k)} style={{
                minHeight: 40, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: activeModule === m.k ? 800 : 700, whiteSpace: 'nowrap',
                background: activeModule === m.k ? `${UI.accent}22` : 'transparent',
                color: activeModule === m.k ? UI.accent : UI.muted,
                border: `1.5px solid ${activeModule === m.k ? UI.accent : UI.line2}`,
              }}>{m.l}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(14px,4vw,24px)' }}>
        {activeModule === 'research' && <ResearchTab onToast={pushToast} />}

        {activeModule === 'content' && <ContentLibraryTab onToast={pushToast} />}

        {activeModule === 'history' && <HistoryTab onToast={pushToast} />}

        {activeModule === 'dna' && (<>
        {/* แท็บย่อยของ DNA Lab */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, overflowX: 'auto' }}>
          {[{ k: 'research', l: '🔬 วิจัยใหม่' }, { k: 'library', l: '📚 คลัง DNA' }].map((t) => (
            <button key={t.k} type="button" onClick={() => setDnaTab(t.k)} style={{
              minHeight: 44, padding: '8px 20px', borderRadius: 12, cursor: 'pointer',
              fontSize: 14.5, fontWeight: 800, fontFamily: 'inherit', whiteSpace: 'nowrap',
              background: dnaTab === t.k ? UI.card : 'transparent',
              color: dnaTab === t.k ? UI.text : UI.dim,
              border: `1.5px solid ${dnaTab === t.k ? UI.line2 : 'transparent'}`,
            }}>{t.l}</button>
          ))}
        </div>

        {dnaTab === 'library' && <LibraryTab onToast={pushToast} />}

        {dnaTab === 'research' && (
          <div style={{ display: 'grid', gap: 16 }}>
            {/* stepper เล็ก */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12.5, color: UI.muted }}>
              {[['upload', '1 อัปโหลด'], ['mapping', '2 แมป'], ['scan', '3 สแกน'], ['run', '4 วิจัย'], ['done', '5 ผล']].map(([k, l], i, arr) => {
                const order = arr.map((x) => x[0]);
                const active = order.indexOf(stage) >= i;
                return (
                  <span key={k} style={{ color: stage === k ? UI.accent : active ? UI.dim : UI.muted, fontWeight: stage === k ? 800 : 600 }}>
                    {l}{i < arr.length - 1 ? ' ›' : ''}
                  </span>
                );
              })}
            </div>

            {/* banner งานค้าง */}
            {pendingRun && stage === 'upload' && (
              <div style={{ background: `${UI.amber}18`, border: `1px solid ${UI.amber}`, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: UI.text }}>⏳ มีงานวิจัยค้างอยู่</div>
                <div style={{ fontSize: 12.5, color: UI.dim, marginTop: 4, lineHeight: 1.6 }}>
                  ไฟล์ <b style={{ color: UI.text }}>{pendingRun.fileName}</b> — วิจัยไป {fmtNum(pendingRun.cursor || 0)}/{fmtNum(pendingRun.total || 0)} ก้อน
                  (เก็บ {fmtNum(pendingRun.counters?.saved || 0)} ใบ). <b>เลือกไฟล์เดิมอีกครั้ง</b> แล้วเริ่มวิจัย ระบบจะทำต่อให้ (ข้ามใบที่เก็บแล้วอัตโนมัติ)
                </div>
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={clearPersist} style={{
                    minHeight: 38, padding: '6px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                    background: 'transparent', color: UI.red, border: `1px solid ${UI.red}`, fontFamily: 'inherit',
                  }}>ล้างงานค้าง</button>
                </div>
              </div>
            )}

            {/* แสดงไฟล์ที่โหลด */}
            {sources.length > 0 && stage !== 'upload' && (
              <div style={{ fontSize: 12.5, color: UI.dim, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>📎 ไฟล์:</span>
                {sources.map((s, i) => (
                  <span key={i} style={{ padding: '3px 10px', borderRadius: 8, background: UI.card2, border: `1px solid ${UI.line}`, color: UI.text }}>
                    {s.name} <span style={{ color: UI.muted }}>({fmtNum(s.rows)} แถว)</span>
                  </span>
                ))}
              </div>
            )}

            {stage === 'upload' && <UploadZone onLoaded={handleLoaded} onToast={pushToast} />}

            {stage === 'mapping' && (
              <MappingConfirm
                header={header} rows={rows} mapping={mapping}
                onMapChange={(f, v) => setMapping((m) => ({ ...m, [f]: v }))}
                metricKey={metricKey} onMetricChange={setMetricKey}
                thresholds={thresholds} onThresholdChange={(k, v) => setThresholds((t) => ({ ...t, [k]: v }))}
                onConfirm={confirmMapping} onBack={() => setStage('upload')}
              />
            )}

            {stage === 'scan' && (
              <ScanSummary
                summary={summary} metricLabel={metricLabel}
                dupChecked={dupChecked} dupCount={dupCount} checking={checking} onCheckDup={checkDup}
                model={model} onModel={setModel}
                onStart={startResearch} onBack={() => setStage('mapping')} starting={starting}
              />
            )}

            {(stage === 'run' || stage === 'done') && (
              <RunPanel
                progress={progress} counters={counters} log={log}
                running={running} paused={paused} onPause={pauseRun} onResume={resumeRun}
              />
            )}

            {stage === 'done' && (
              <>
                {synthesis && <SynthesisReport synthesis={synthesis} />}
                <ReviewList records={results} onDelete={deleteRecord} deletingKey={deletingKey} />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" onClick={resetWizard} style={{
                    minHeight: 44, padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 800,
                    background: UI.accent, color: '#fff', border: 'none', fontFamily: 'inherit', flex: '1 1 200px',
                  }}>🔄 วิจัยไฟล์ใหม่</button>
                  <button type="button" onClick={() => setDnaTab('library')} style={{
                    minHeight: 44, padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 800,
                    background: UI.card2, color: UI.text, border: `1px solid ${UI.line2}`, fontFamily: 'inherit',
                  }}>📚 ไปดูคลัง</button>
                </div>
              </>
            )}
          </div>
        )}
        </>)}
      </div>

      {/* toast มุมล่าง */}
      <div style={{ position: 'fixed', bottom: 16, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, zIndex: 100, pointerEvents: 'none', padding: '0 12px' }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            pointerEvents: 'auto', maxWidth: 460, width: 'fit-content',
            background: UI.card, color: UI.text, border: `1px solid ${toastColor[t.type] || UI.line}`,
            borderLeft: `4px solid ${toastColor[t.type] || UI.accent}`,
            borderRadius: 12, padding: '10px 16px', fontSize: 13.5, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
          }}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
