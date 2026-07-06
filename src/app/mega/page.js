'use client';

// ============================================================
// 🏭 /mega — ห้องควบคุมสายพานข่าวครบวงจร (UI ใหม่ของตัวเอง — เฟส 1: S1→S4)
// การ์ดต่องาน: ไฟ 8 สถานี · สถานะสด · ไทม์ไลน์ · เนื้อที่เลือก · ปุ่มสั่งงาน
// ============================================================

import { useEffect, useRef, useState } from 'react';

const STATIONS = [
  { key: 's1_pick', label: 'S1 คัดข่าว' },
  { key: 's1_5_preflight', label: 'S1.5 วัตถุดิบ' },
  { key: 's2_extract', label: 'S2 สกัดเนื้อ' },
  { key: 's2_5_compass', label: 'S2.5 เข็มทิศ' },
  { key: 's3_generate', label: 'S3 เจนข่าว' },
  { key: 's3_wait', label: 'S3 รอผล' },
  { key: 's4_choose', label: 'S4 เลือกเนื้อ' },
  { key: 'content_ready', label: '📄 เนื้อพร้อม' },
  { key: 's5', label: 'S5 ภาพ (เฟส 2)', future: true },
  { key: 's7', label: 'S7 ปก (เฟส 3)', future: true },
];

const STAGE_ORDER = STATIONS.filter((s) => !s.future).map((s) => s.key);

function lightColor(job, stationKey) {
  if (STATIONS.find((s) => s.key === stationKey)?.future) return '#333';
  const cur = STAGE_ORDER.indexOf(job.stage);
  const idx = STAGE_ORDER.indexOf(stationKey);
  if (job.status === 'content_ready' && stationKey === 'content_ready') return '#22c55e';
  if (idx < cur) return '#22c55e'; // ผ่านแล้ว
  if (idx === cur) {
    if (job.status === 'failed') return '#ef4444';
    if (job.status === 'waiting') return '#eab308';
    if (job.status === 'skipped') return '#666';
    return '#60a5fa'; // กำลังทำ
  }
  return '#2a2a3a'; // ยังไม่ถึง
}

const chipStyle = (bg, color) => ({
  display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
  background: bg, color,
});

export default function MegaPage() {
  const [jobs, setJobs] = useState([]);
  const [flags, setFlags] = useState({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [expand, setExpand] = useState(null);
  const timer = useRef(null);

  async function load() {
    try {
      const r = await fetch('/api/mega');
      const j = await r.json();
      if (j.success) {
        setJobs(j.jobs || []);
        setFlags(j.flags || {});
      }
    } catch { /* เงียบ */ }
  }

  useEffect(() => {
    load();
    timer.current = setInterval(load, 6000);
    return () => clearInterval(timer.current);
  }, []);

  async function act(action, extra = {}) {
    setBusy(action);
    setMsg('');
    try {
      const r = await fetch('/api/mega', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await r.json();
      if (!j.success) setMsg('❌ ' + (j.error || 'ไม่สำเร็จ'));
      else if (action === 'create') {
        setMsg(`✅ เปิดงาน ${j.job.id} แล้ว — สายพานจะเดินเอง (เครื่องทีม/ปุ่มเดินเครื่อง)`);
        tick(); // เดินจังหวะแรกทันที
      }
      await load();
    } catch (e) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy('');
    }
  }

  async function tick() {
    setBusy('tick');
    try {
      const r = await fetch('/api/mega/tick', { method: 'POST' });
      const j = await r.json();
      if (j.success && !j.idle) setMsg(`⚙️ ${j.jobId} · ${j.stageLabel || j.stage}: ${j.result?.summary || j.skipped || ''}`);
      else if (j.paused) setMsg(j.message);
      else if (j.idle) setMsg('ไม่มีงานให้เดิน — กด "ทำข่าวถัดไป" เพื่อเปิดงานใหม่');
      await load();
    } catch (e) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '18px 14px 60px', fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>🏭 สายพานข่าวครบวงจร</h1>
        <span style={chipStyle('rgba(96,165,250,0.12)', '#60a5fa')}>เฟส 1: คัดข่าว → เนื้อพร้อมโพสต์</span>
        {flags.paused && <span style={chipStyle('rgba(239,68,68,0.15)', '#f87171')}>⛔ พักสายพาน (ล้มติดกัน {flags.consecutiveFails})</span>}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted, #8a8fa3)', marginBottom: 14 }}>
        ระบบทำงานแทนคน: คัดข่าวจากโต๊ะข่าว → เช็ควัตถุดิบ → สกัดเนื้อ → เข็มทิศเรื่อง → เจนข่าว (คิวเดิม) → บก.เลือกเวอร์ชันดีสุด — ทุกสมองอ่าน/เขียน "แฟ้มงาน" เดียวกัน
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={() => act('create')} disabled={!!busy}
          style={{ padding: '11px 18px', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', border: 'none', background: '#2563eb', color: '#fff', fontFamily: 'inherit' }}>
          {busy === 'create' ? '⏳…' : '▶️ ทำข่าวถัดไป (เปิดงานใหม่)'}
        </button>
        <button onClick={tick} disabled={!!busy}
          style={{ padding: '11px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border, #333)', background: 'transparent', color: 'inherit', fontFamily: 'inherit' }}>
          {busy === 'tick' ? '⏳…' : '⚙️ เดินเครื่อง 1 จังหวะ'}
        </button>
        {flags.paused && (
          <button onClick={() => act('resume')} disabled={!!busy}
            style={{ padding: '11px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontFamily: 'inherit' }}>
            🔓 ปลดพักสายพาน
          </button>
        )}
      </div>

      {msg && <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', fontSize: 13, marginBottom: 14, whiteSpace: 'pre-wrap' }}>{msg}</div>}

      {jobs.length === 0 && <div style={{ color: 'var(--text-muted, #8a8fa3)', fontSize: 14, padding: 30, textAlign: 'center' }}>ยังไม่มีงาน — กด "▶️ ทำข่าวถัดไป" เพื่อเริ่มข่าวแรก</div>}

      {jobs.map((job) => {
        const d = job.dossier || {};
        const statusChip =
          job.status === 'content_ready' ? chipStyle('rgba(34,197,94,0.15)', '#22c55e')
          : job.status === 'failed' ? chipStyle('rgba(239,68,68,0.15)', '#f87171')
          : job.status === 'waiting' ? chipStyle('rgba(234,179,8,0.15)', '#eab308')
          : chipStyle('rgba(96,165,250,0.12)', '#60a5fa');
        const statusText = { pending: 'รอเริ่ม', running: 'กำลังทำ', waiting: 'รอคิวเจน', content_ready: '✅ เนื้อพร้อม', failed: 'ล้มเหลว', skipped: 'ข้าม' }[job.status] || job.status;
        const mins = Math.round((new Date(job.updatedAt) - new Date(job.createdAt)) / 60000);
        return (
          <div key={job.id} style={{ border: '1px solid var(--border, #333)', borderRadius: 14, padding: 16, marginBottom: 14, background: 'var(--bg-secondary, rgba(255,255,255,0.02))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15 }}>{job.id}</b>
              <span style={statusChip}>{statusText}</span>
              <span style={{ fontSize: 12, color: job.quality === 'red' ? '#f87171' : job.quality === 'yellow' ? '#eab308' : '#22c55e' }}>
                ● คุณภาพ{job.quality === 'green' ? 'ดี' : job.quality === 'yellow' ? 'กลาง' : 'แย่'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted, #8a8fa3)', marginLeft: 'auto' }}>{mins} นาที</span>
            </div>

            {d.desk?.title && <div style={{ fontSize: 14, fontWeight: 700, margin: '8px 0 2px' }}>📰 {d.desk.title}</div>}
            {d.compass?.angle && <div style={{ fontSize: 12.5, color: 'var(--text-muted, #8a8fa3)' }}>🧭 {d.compass.angle} · อารมณ์: {d.compass.primaryEmotion}</div>}

            {/* ไฟสถานี */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
              {STATIONS.map((st) => (
                <div key={st.key} title={st.label} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border, #2a2a3a)' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: lightColor(job, st.key), boxShadow: lightColor(job, st.key) === '#60a5fa' ? '0 0 6px #60a5fa' : 'none' }} />
                  <span style={{ fontSize: 11, color: st.future ? '#555' : 'inherit' }}>{st.label}</span>
                </div>
              ))}
            </div>

            {/* ไทม์ไลน์ */}
            {(job.stagesDone || []).length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted, #8a8fa3)', lineHeight: 1.8 }}>
                {(job.stagesDone || []).map((s, i) => (
                  <div key={i}>✓ <b>{s.label}</b> — {s.summary}</div>
                ))}
              </div>
            )}

            {/* เนื้อที่เลือก */}
            {job.status === 'content_ready' && d.pick?.chosenText && (
              <div style={{ marginTop: 10 }}>
                <button onClick={() => setExpand(expand === job.id ? null : job.id)}
                  style={{ padding: '8px 14px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontFamily: 'inherit' }}>
                  {expand === job.id ? '▲ ซ่อนเนื้อ' : `▼ ดูเนื้อที่ บก. เลือก (${d.pick.reason?.slice(0, 50) || ''})`}
                </button>
                {expand === job.id && (
                  <div style={{ marginTop: 8, padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.03)', fontSize: 13.5, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                    {d.pick.chosenText}
                    <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                      <button onClick={() => { navigator.clipboard?.writeText(d.pick.chosenText); }}
                        style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border, #333)', background: 'transparent', color: 'inherit', fontFamily: 'inherit' }}>
                        📋 คัดลอกเนื้อ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {job.status === 'failed' && (
              <button onClick={() => act('retry', { id: job.id })} disabled={!!busy}
                style={{ marginTop: 8, padding: '8px 14px', borderRadius: 9, fontSize: 13, cursor: 'pointer', border: '1px solid rgba(234,179,8,0.4)', background: 'rgba(234,179,8,0.08)', color: '#eab308', fontFamily: 'inherit' }}>
                ♻️ ลองต่อจากขั้นเดิม
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
