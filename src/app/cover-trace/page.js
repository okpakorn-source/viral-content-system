'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════
// Cover Trace — พาเนลโปร่งใส: เห็นทุกขั้นตอนของท่อทำปก + เก็บทุกขั้นเข้าคลัง
//   ข่าวเข้า → คีย์เวิร์ด → ค้นภาพ (แหล่งไหน/ภาพดิบ) → Judge → Director → ปกจริง
// ═══════════════════════════════════════════════════════════════

const STEP_META = {
  input:      { icon: '📝', title: 'รับข่าวเข้าระบบ',            color: '#64748b' },
  identity:   { icon: '🧠', title: 'วิเคราะห์ประเด็น + คีย์เวิร์ด', color: '#8b5cf6' },
  search:     { icon: '🔎', title: 'ค้นภาพจากทุกแหล่ง',          color: '#0ea5e9' },
  judge:      { icon: '⚖️', title: 'Judge คัดภาพ + ให้บทบาท',     color: '#f59e0b' },
  download:   { icon: '⬇️', title: 'ดาวน์โหลดภาพดิบ',           color: '#06b6d4' },
  facedetect: { icon: '🙂', title: 'ตรวจใบหน้า + อารมณ์',        color: '#ec4899' },
  pool:       { icon: '🧹', title: 'จัดคิว/กรองภาพเข้าโครง',      color: '#84cc16' },
  director:   { icon: '🎬', title: 'Director จัดวางปก',          color: '#a855f7' },
  compose:    { icon: '🖼️', title: 'ประกอบปกจริง + QC',          color: '#22c55e' },
};

const c = {
  bg: '#0f172a', card: '#1e293b', card2: '#0b1220', border: '#334155',
  text: '#e2e8f0', dim: '#94a3b8', accent: '#38bdf8', good: '#22c55e', bad: '#ef4444', warn: '#f59e0b',
};

export default function CoverTracePage() {
  const [newsTitle, setNewsTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourceLinks, setSourceLinks] = useState('');
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState(null);
  const [finalResult, setFinalResult] = useState(null);
  const [toast, setToast] = useState(null);
  const [history, setHistory] = useState([]);
  const [viewingHistory, setViewingHistory] = useState(false);
  const pollRef = useRef(null);
  const lastStepCount = useRef(0);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/cover-trace');
      const d = await r.json();
      if (d.success) setHistory(d.runs || []);
    } catch {}
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function showToast(step) {
    const meta = STEP_META[step.name] || { icon: '•', title: step.name };
    setToast({ id: Date.now(), icon: meta.icon, label: step.label || meta.title });
  }

  const poll = useCallback(async (runId) => {
    try {
      const r = await fetch(`/api/cover-trace?runId=${runId}`);
      const d = await r.json();
      if (d.success && d.run) {
        setRun(d.run);
        if (d.run.steps.length > lastStepCount.current) {
          showToast(d.run.steps[d.run.steps.length - 1]);
          lastStepCount.current = d.run.steps.length;
        }
        if (d.run.status !== 'running') stopPoll();
      }
    } catch {}
  }, []);
  function stopPoll() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }

  async function generate() {
    if (!content.trim() && !newsTitle.trim()) { alert('ใส่หัวข้อหรือเนื้อข่าวก่อน'); return; }
    const traceId = (crypto.randomUUID ? crypto.randomUUID() : `run_${Date.now()}`);
    setRunning(true); setRun(null); setFinalResult(null); setViewingHistory(false); lastStepCount.current = 0;
    setToast({ id: Date.now(), icon: '🚀', label: 'เริ่มสร้างปก...' });

    stopPoll();
    pollRef.current = setInterval(() => poll(traceId), 1500);
    poll(traceId);

    const links = sourceLinks.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    try {
      const res = await fetch('/api/auto-cover-v3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newsTitle, content, sourceLinks: links, traceId }),
      });
      const data = await res.json();
      setFinalResult(data);
    } catch (e) {
      setFinalResult({ success: false, error: e.message || 'network error' });
    } finally {
      setRunning(false);
      stopPoll();
      await poll(traceId);
      loadHistory();
    }
  }

  async function openHistory(runId) {
    stopPoll(); setRunning(false); setFinalResult(null);
    try {
      const r = await fetch(`/api/cover-trace?runId=${runId}`);
      const d = await r.json();
      if (d.success) { setRun(d.run); setViewingHistory(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    } catch {}
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div style={{ background: c.bg, minHeight: '100vh', color: c.text, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', padding: '24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, margin: '0 0 4px' }}>🔬 Cover Trace — พาเนลโปร่งใส</h1>
        <p style={{ color: c.dim, margin: '0 0 20px', fontSize: 14 }}>เห็นทุกขั้นตอนการทำปกแบบสด + เก็บทุกขั้นเข้าคลัง (คีย์เวิร์ด · แหล่งภาพ · ภาพดิบ · คะแนน Judge · ปกจริง)</p>

        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 18, marginBottom: 20 }}>
          <input value={newsTitle} onChange={e => setNewsTitle(e.target.value)} placeholder="หัวข้อข่าว" style={inp} />
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="เนื้อข่าวเต็ม (วางที่นี่)" rows={5} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
          <input value={sourceLinks} onChange={e => setSourceLinks(e.target.value)} placeholder="ลิงก์แหล่งรูป (ไม่บังคับ · คั่นด้วยบรรทัด/จุลภาค)" style={inp} />
          <button onClick={generate} disabled={running} style={{ ...btn, opacity: running ? 0.6 : 1, cursor: running ? 'wait' : 'pointer' }}>
            {running ? '⏳ กำลังสร้าง... (ดูขั้นตอนสดด้านล่าง)' : '🚀 สร้างปก + ดูทุกขั้นตอน'}
          </button>
          {running && <span style={{ marginLeft: 12, color: c.dim, fontSize: 13 }}>ใช้เวลา ~3–6 นาที · ทุกขั้นตอนจะโผล่ทันทีที่ทำเสร็จ</span>}
        </div>

        {run && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
            <RunHeader run={run} viewingHistory={viewingHistory} />
            <Timeline run={run} />
            {run.steps.map((s, i) => <StepCard key={i} step={s} />)}
            <FinalCover run={run} finalResult={finalResult} />
          </div>
        )}

        <div style={{ marginTop: 30 }}>
          <h2 style={{ fontSize: 18, color: c.dim }}>📚 คลังรันย้อนหลัง ({history.length})</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 10 }}>
            {history.map(h => (
              <div key={h.runId} onClick={() => openHistory(h.runId)} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 10, padding: 12, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: c.dim }}>
                  <span>{new Date(h.startedAt).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <StatusPill status={h.status} />
                </div>
                <div style={{ fontSize: 13, margin: '6px 0', maxHeight: 40, overflow: 'hidden' }}>{h.newsTitle || '(ไม่มีหัวข้อ)'}</div>
                <div style={{ fontSize: 12, color: c.dim }}>{h.stepCount} ขั้น{h.score != null ? ` · score ${h.score}` : ''}{h.template ? ` · ${h.template}` : ''}</div>
              </div>
            ))}
            {history.length === 0 && <div style={{ color: c.dim, fontSize: 13 }}>ยังไม่มีรัน — กดสร้างปกด้านบน</div>}
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: c.card, border: `1px solid ${c.accent}`, borderRadius: 12, padding: '14px 18px', boxShadow: '0 8px 30px rgba(0,0,0,.5)', maxWidth: 360, animation: 'cfslide .3s ease' }}>
          <div style={{ fontSize: 12, color: c.accent, marginBottom: 2 }}>กำลังทำงาน</div>
          <div style={{ fontSize: 15 }}><span style={{ marginRight: 8 }}>{toast.icon}</span>{toast.label}</div>
        </div>
      )}
      <style>{`@keyframes cfslide{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
        input::placeholder,textarea::placeholder{color:#64748b}`}</style>
    </div>
  );
}

const inp = { width: '100%', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', marginBottom: 10, fontSize: 14, boxSizing: 'border-box' };
const btn = { background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 20px', fontSize: 15, fontWeight: 600 };

function StatusPill({ status }) {
  const map = { running: ['กำลังรัน', c.warn], done: ['สำเร็จ', c.good], failed: ['ล้ม', c.bad] };
  const [txt, col] = map[status] || [status, c.dim];
  return <span style={{ color: col, fontWeight: 600 }}>{txt}</span>;
}

function RunHeader({ run, viewingHistory }) {
  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 13, color: c.dim }}>{viewingHistory ? '📖 ดูย้อนหลัง' : '🔴 สด'} · </span>
          <StatusPill status={run.status} />
          {run.elapsedMs != null && <span style={{ color: c.dim, fontSize: 13 }}> · {(run.elapsedMs / 1000).toFixed(0)}s</span>}
        </div>
        <span style={{ fontSize: 12, color: c.dim }}>{run.steps.length} ขั้นตอน</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 15 }}>{run.newsTitle || '(ไม่มีหัวข้อ)'}</div>
      {run.error && <div style={{ marginTop: 8, color: c.bad, fontSize: 13 }}>⚠️ {run.error}</div>}
    </div>
  );
}

function Timeline({ run }) {
  const done = new Set(run.steps.map(s => s.name));
  const order = ['input', 'identity', 'search', 'judge', 'download', 'facedetect', 'pool', 'director', 'compose'];
  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {order.map((n, i) => {
        const m = STEP_META[n]; const isDone = done.has(n);
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isDone ? 1 : 0.35 }}>
            <span style={{ fontSize: 18 }}>{isDone ? m.icon : '⚪'}</span>
            <span style={{ fontSize: 12, color: isDone ? c.text : c.dim }}>{m.title}</span>
            {i < order.length - 1 && <span style={{ color: c.dim, margin: '0 2px' }}>→</span>}
          </div>
        );
      })}
    </div>
  );
}

function StepCard({ step }) {
  const [open, setOpen] = useState(true);
  const m = STEP_META[step.name] || { icon: '•', title: step.name, color: c.dim };
  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderLeft: `4px solid ${m.color}`, borderRadius: 12, padding: 16 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
        <div style={{ fontSize: 16 }}><span style={{ marginRight: 8 }}>{m.icon}</span><b>{step.label || m.title}</b></div>
        <span style={{ color: c.dim, fontSize: 12 }}>+{(step.tOffsetMs / 1000).toFixed(1)}s {open ? '▲' : '▼'}</span>
      </div>
      {open && <div style={{ marginTop: 12 }}><StepData step={step} /></div>}
    </div>
  );
}

function Thumb({ url }) {
  if (!url || url === '[video-frame]') {
    return <div style={{ ...thumbStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: c.dim }}>🎞️ frame</div>;
  }
  return <img src={url} alt="" style={thumbStyle} referrerPolicy="no-referrer"
    onError={e => { e.currentTarget.style.opacity = 0.2; e.currentTarget.title = 'โหลดภาพไม่ได้ (hotlink)'; }} />;
}
const thumbStyle = { width: 78, height: 78, objectFit: 'cover', borderRadius: 6, background: '#0b1220', border: '1px solid #334155' };

function chip(text, col = c.accent) {
  return <span style={{ display: 'inline-block', background: '#0b1220', border: `1px solid ${col}`, color: col, borderRadius: 6, padding: '2px 8px', margin: '2px', fontSize: 12 }}>{text}</span>;
}

function StepData({ step }) {
  const d = step.data || {};
  const label = { color: c.dim, fontSize: 12, marginBottom: 4 };

  if (step.name === 'input') {
    return (
      <div style={{ fontSize: 13 }}>
        <div style={label}>เนื้อข่าว ({d.contentLen} ตัวอักษร)</div>
        <div style={{ background: c.card2, borderRadius: 8, padding: 10, color: c.dim, whiteSpace: 'pre-wrap' }}>{d.contentPreview}...</div>
      </div>
    );
  }

  if (step.name === 'identity') {
    const sq = d.searchQueries || {};
    return (
      <div style={{ fontSize: 13 }}>
        <div style={label}>ตัวหลัก / รอง / อารมณ์ / ประเภท</div>
        <div>{chip('👤 ' + (d.mainCharacter || '?'), c.good)}{d.secondaryCharacter && chip('👥 ' + d.secondaryCharacter)}{d.coverEmotion && chip('🎭 ' + d.coverEmotion, c.warn)}{d.storyType && chip(d.storyType, c.dim)}</div>
        <div style={{ ...label, marginTop: 10 }}>คีย์เวิร์ดค้นภาพที่ AI แตกออกมา</div>
        <div>
          {Object.entries(sq).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => <div key={k} style={{ margin: '3px 0' }}><span style={{ color: c.dim }}>{k}:</span> {v}</div>)}
          {(d.coreImageQueries || []).map((q, i) => <span key={i}>{chip('🎯 ' + q, c.accent)}</span>)}
          {(!Object.keys(sq).length && !(d.coreImageQueries || []).length) && <span style={{ color: c.dim }}>{d.searchGoogle || '—'}</span>}
        </div>
      </div>
    );
  }

  if (step.name === 'search') {
    const ag = d.agents || {};
    const bySource = {};
    (d.raw || []).forEach(m => { const k = m.source || m.label || 'อื่นๆ'; (bySource[k] = bySource[k] || []).push(m); });
    return (
      <div style={{ fontSize: 13 }}>
        <div style={label}>จำนวนภาพดิบต่อแหล่ง (รวม {d.rawTotal})</div>
        <div style={{ marginBottom: 10 }}>
          {Object.entries(ag).map(([k, v]) => <span key={k}>{chip(`${k}: ${v}`, v > 0 ? c.accent : c.dim)}</span>)}
        </div>
        <div style={label}>ภาพดิบที่ค้นได้ (แยกตามแหล่ง/เว็บ)</div>
        {Object.entries(bySource).slice(0, 25).map(([src, imgs]) => (
          <div key={src} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: c.accent, marginBottom: 4 }}>🌐 {src} <span style={{ color: c.dim }}>({imgs.length})</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {imgs.slice(0, 12).map((m, i) => <div key={i} title={`${m.query || m.label || ''}`}><Thumb url={m.url} /></div>)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (step.name === 'judge') {
    const sel = d.selected || [];
    return (
      <div style={{ fontSize: 13 }}>
        <div style={label}>Judge รับ {d.acceptedCount} ภาพ (คะแนน + บทบาท)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {sel.map((m, i) => (
            <div key={i} style={{ width: 90 }}>
              <Thumb url={m.url} />
              <div style={{ fontSize: 11, color: c.good }}>★{m.score ?? '?'}</div>
              <div style={{ fontSize: 10, color: c.dim, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{m.role || ''}</div>
            </div>
          ))}
          {!sel.length && <span style={{ color: c.dim }}>—</span>}
        </div>
      </div>
    );
  }

  if (step.name === 'download') {
    return (
      <div style={{ fontSize: 13 }}>
        <div style={label}>ดาวน์โหลด {d.downloaded}/{d.candidates} ภาพ{d.preferFrames ? ' · โหมดเฟรมคลิปก่อน' : ''}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(d.images || []).map((m, i) => <Thumb key={i} url={m.url} />)}
        </div>
      </div>
    );
  }

  if (step.name === 'facedetect') {
    return (
      <div style={{ fontSize: 13 }}>
        <div style={label}>เจอหน้า {d.withFace}/{d.total} ภาพ · มีตัวหนังสือฝัง {d.withText}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(d.faces || []).map((f, i) => (
            <span key={i} style={{ fontSize: 11, background: c.card2, border: `1px solid ${f.hasFace ? c.good : c.border}`, borderRadius: 6, padding: '3px 7px' }}>
              #{f.idx} {f.hasFace ? `👤${f.faceCount}` : '—'}{f.faceEmotion ? ` ${f.faceEmotion}` : ''}{f.hasText ? ' 🔤' : ''}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (step.name === 'director') {
    if (d.failed) return <div style={{ color: c.bad, fontSize: 13 }}>Director ล้มเหลว (pool {d.poolSize})</div>;
    return (
      <div style={{ fontSize: 13 }}>
        <div>{chip('โครง ' + d.template, c.good)}</div>
        <div style={{ ...label, marginTop: 8 }}>เหตุผล</div>
        <div style={{ color: c.dim }}>{d.reason}</div>
        <div style={{ ...label, marginTop: 8 }}>การจัดวาง</div>
        {(d.assignments || []).map((a, i) => <div key={i} style={{ color: c.dim }}>• <b style={{ color: c.text }}>{a.slot}</b> ← ภาพ #{a.image} <span style={{ fontSize: 11 }}>{a.why}</span></div>)}
      </div>
    );
  }

  if (step.name === 'pool') {
    return <div style={{ fontSize: 13, color: c.dim }}>{JSON.stringify(d)}</div>;
  }

  if (step.name === 'compose') {
    return (
      <div style={{ fontSize: 13 }}>
        <div>{chip('โครง ' + d.template, c.good)}{chip('score ' + d.score, c.warn)}{d.qcApplied ? chip('QC แก้แล้ว') : ''}{d.caseId ? chip(d.caseId, c.dim) : ''}</div>
      </div>
    );
  }

  return <pre style={{ fontSize: 11, color: c.dim, overflow: 'auto' }}>{JSON.stringify(d, null, 1)}</pre>;
}

function FinalCover({ run, finalResult }) {
  const liveB64 = finalResult?.success && finalResult?.base64;
  const histUrl = run?.result?.coverUrl;
  const src = liveB64 || histUrl;
  const err = finalResult && !finalResult.success ? finalResult.error : (run?.status === 'failed' ? run?.error : null);
  if (!src && !err) return null;
  return (
    <div style={{ background: c.card, border: `1px solid ${src ? c.good : c.bad}`, borderRadius: 12, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 15, marginBottom: 10 }}>{src ? '🎉 ปกที่ได้' : '❌ ไม่ได้ปก'}</div>
      {src && <img src={src} alt="cover" style={{ maxWidth: 380, width: '100%', borderRadius: 10, border: `1px solid ${c.border}` }} />}
      {err && <div style={{ color: c.bad, fontSize: 13 }}>{err}</div>}
    </div>
  );
}
