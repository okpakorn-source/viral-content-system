'use client';

// ============================================================
// 🏭 /mega — ห้องควบคุมสายพานข่าวครบวงจร (UI ใหม่ของตัวเอง — เฟส 1+2: S1→S6)
// การ์ดต่องาน: ไฟสถานี · สถานะสด · ไทม์ไลน์ · เนื้อที่เลือก · ภาพลงช่อง · ปุ่มสั่งงาน
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
  { key: 's5_case', label: 'S5 เคสภาพ' },
  { key: 's5_keywords', label: 'S5 คีย์เวิร์ด' },
  { key: 's5_search', label: 'S5 ค้นภาพ' },
  { key: 's5_triage', label: 'S5 ตาคัด' },
  { key: 's6_slots', label: 'S6 ภาพลงช่อง' },
  { key: 'assets_ready', label: '🧺 ครบชุด' },
  { key: 's7_cover', label: 'S7 ส่งทำปก' },
  { key: 's7_wait', label: 'S7 ประกอบปก' },
  { key: 'cover_ready', label: '🏁 ปกเสร็จ' },
];

const STAGE_ORDER = STATIONS.filter((s) => !s.future).map((s) => s.key);
const DONE_STATUSES = ['content_ready', 'assets_ready', 'cover_ready'];

function lightColor(job, stationKey) {
  if (STATIONS.find((s) => s.key === stationKey)?.future) return '#333';
  // งานเก่าที่จบเฟส 1 (content_ready) = ผ่านถึง S4 — ไฟ S5+ ยังไม่ถึง
  const cur = STAGE_ORDER.indexOf(job.stage === 'content_ready' ? 's5_case' : job.stage);
  const idx = STAGE_ORDER.indexOf(stationKey);
  if (job.status === 'assets_ready' && stationKey === 'assets_ready') return '#22c55e';
  if (idx < cur) return '#22c55e'; // ผ่านแล้ว
  if (idx === cur && !DONE_STATUSES.includes(job.status)) {
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
        <span style={chipStyle('rgba(96,165,250,0.12)', '#60a5fa')}>เฟส 1+2: คัดข่าว → เนื้อ+ภาพครบชุด</span>
        {flags.paused && <span style={chipStyle('rgba(239,68,68,0.15)', '#f87171')}>⛔ พักสายพาน (ล้มติดกัน {flags.consecutiveFails})</span>}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted, #8a8fa3)', marginBottom: 14 }}>
        ระบบทำงานแทนคน: คัดข่าวจากโต๊ะข่าว → เช็ควัตถุดิบ → สกัดเนื้อ → เข็มทิศเรื่อง → เจนข่าว (คิวเดิม) → บก.เลือกเวอร์ชันดีสุด → ค้นภาพ 4 แหล่ง+ตาคัด → ผู้กำกับจับคู่ 5 ช่องปก — ทุกสมองอ่าน/เขียน "แฟ้มงาน" เดียวกัน
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
          DONE_STATUSES.includes(job.status) ? chipStyle('rgba(34,197,94,0.15)', '#22c55e')
          : job.status === 'failed' ? chipStyle('rgba(239,68,68,0.15)', '#f87171')
          : job.status === 'waiting' ? chipStyle('rgba(234,179,8,0.15)', '#eab308')
          : chipStyle('rgba(96,165,250,0.12)', '#60a5fa');
        const statusText = { pending: 'รอเริ่ม', running: 'กำลังทำ', waiting: 'รอขั้นถัดไป', content_ready: '📄 เนื้อพร้อม (จบเฟส 1)', assets_ready: '🧺 เนื้อ+ภาพครบชุด', cover_ready: '🏁 ปกเสร็จครบวงจร', failed: 'ล้มเหลว', skipped: 'ข้าม' }[job.status] || job.status;
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

            {/* เฟส 2: สถิติภาพ + ตาราง 5 ช่อง */}
            {d.images?.caseId && (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted, #8a8fa3)', marginTop: 6 }}>
                🖼️ เคสภาพ <a href={`/image-search?case=${d.images.caseId}`} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>{d.images.caseId}</a>
                {d.images.triage && <> · ตายืนยันเกี่ยวจริง <b style={{ color: (d.images.triage.relevant || 0) >= 8 ? '#22c55e' : '#eab308' }}>{d.images.triage.relevant}</b>/{d.images.triage.total} ใบ</>}
                {(d.images.searchStats || []).length > 0 && <> · {(d.images.searchStats || []).map((s) => `${s.platform}:${s.error ? '✗' : s.added}`).join(' ')}</>}
              </div>
            )}
            {d.pickImages?.slots && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {['hero', 'reaction', 'action', 'context', 'circle'].map((slot) => {
                  const s = d.pickImages.slots[slot];
                  return (
                    <div key={slot} style={{ width: 110, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border, #2a2a3a)', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ height: 72, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {s?.imageUrl
                          ? <img src={s.imageUrl} alt={slot} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 11, color: '#666' }}>— ว่าง —</span>}
                      </div>
                      <div style={{ padding: '5px 7px' }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: slot === 'hero' ? '#f59e0b' : '#8a8fa3' }}>{slot}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted, #8a8fa3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s?.reason || ''}>
                          {s?.person || s?.category || (s ? '' : 'ไม่มีภาพเข้าเกณฑ์')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* เฟส 3: ปกเสร็จ — โชว์ปกจริง */}
            {d.cover?.coverPath && (
              <div style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <a href={d.cover.coverPath} target="_blank" rel="noreferrer">
                  <img src={d.cover.coverPath} alt="ปกที่ประกอบเสร็จ" style={{ width: 230, borderRadius: 12, border: '2px solid rgba(34,197,94,0.5)', display: 'block' }} />
                </a>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted, #8a8fa3)', maxWidth: 380, lineHeight: 1.7 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#22c55e' }}>🏁 ปกเสร็จ · QC {d.cover.score ?? '-'} คะแนน</div>
                  <div>เทมเพลต {d.cover.template || '-'} · เคสปก {d.cover.coverCaseId || '-'}</div>
                  {d.cover.directorReason && <div style={{ marginTop: 4 }}>🎬 {d.cover.directorReason}</div>}
                  <a href={d.cover.coverPath} download style={{ color: '#60a5fa' }}>⬇️ ดาวน์โหลดปกเต็ม</a>
                </div>
              </div>
            )}

            {/* งานจบเฟส 1 ค้างเก่า → ปุ่มต่อเฟส 2 */}
            {job.status === 'content_ready' && (
              <button onClick={() => act('retry', { id: job.id, stage: 's5_case' })} disabled={!!busy}
                style={{ marginTop: 10, padding: '9px 15px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(96,165,250,0.4)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', fontFamily: 'inherit' }}>
                🖼️ ทำภาพต่อ (เฟส 2: ค้นภาพ + จับคู่ช่อง)
              </button>
            )}
            {/* งานจบเฟส 2 → ปุ่มต่อเฟส 3 ทำปก */}
            {job.status === 'assets_ready' && (
              <button onClick={() => act('retry', { id: job.id, stage: 's7_cover' })} disabled={!!busy}
                style={{ marginTop: 10, padding: '9px 15px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontFamily: 'inherit' }}>
                🎬 ทำปกต่อ (เฟส 3: ประกอบปกจากภาพ 5 ช่อง)
              </button>
            )}

            {/* เนื้อที่เลือก */}
            {DONE_STATUSES.includes(job.status) && d.pick?.chosenText && (
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
