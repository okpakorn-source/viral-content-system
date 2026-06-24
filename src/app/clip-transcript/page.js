'use client';
import { useState, useEffect } from 'react';

export default function ClipTranscriptPage() {
  const [url, setUrl] = useState('');
  const [tidy, setTidy] = useState(true);
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState('tidy'); // tidy | raw
  const [cases, setCases] = useState([]);
  const [casesOpen, setCasesOpen] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [copied, setCopied] = useState('');
  // ★ 16 มิ.ย.: ถอดประเด็นข่าว → ข้อมูลดิบ (Gemini ดูคลิป)
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  // ★ 22 มิ.ย.: คลัง "ถอดประเด็นข่าว" แยก (เก็บทุกครั้งที่ถอดสำเร็จ หยิบกลับมาใช้ได้)
  const [insightCases, setInsightCases] = useState([]);
  const [insightCasesOpen, setInsightCasesOpen] = useState(true);
  const [insightExpanded, setInsightExpanded] = useState(null);
  // ★ 24 มิ.ย.: ส่งเข้าคิว "เครื่องทีม" (พนักงานทำงานที่บ้านส่งผ่านเว็บ → เครื่องทีมถอด FB/IG ให้)
  const [queueJob, setQueueJob] = useState(null); // { jobId, status, position, platform, result, error }
  const [submitting, setSubmitting] = useState(false);

  const loadCases = async () => {
    try { const r = await fetch('/api/clip-transcript/cases?limit=40', { cache: 'no-store' }); const d = await r.json(); if (d.success) setCases(d.cases || []); } catch {}
  };
  const loadInsightCases = async () => {
    try { const r = await fetch('/api/clip-transcript/cases?kind=insight&limit=40', { cache: 'no-store' }); const d = await r.json(); if (d.success) setInsightCases(d.cases || []); } catch {}
  };
  useEffect(() => { loadCases(); loadInsightCases(); }, []);

  const platformIcon = (p) => p === 'youtube' ? '📺' : p === 'tiktok' ? '🎵' : p === 'meta' ? '📘' : '🎬';

  const extract = async () => {
    if (!url.trim()) { setErr('วางลิงก์คลิปก่อน'); return; }
    setLoading(true); setErr(''); setOut(null);
    try {
      const r = await fetch('/api/clip-transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), tidy }) });
      const d = await r.json();
      if (!d.success) { setErr(d.error || 'ถอดไม่สำเร็จ'); }
      else { setOut(d.data); setView(d.data.tidyText ? 'tidy' : 'raw'); loadCases(); }
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  // ★ ถอดประเด็นข่าว → ข้อมูลดิบ (Gemini ดูคลิป YouTube / ถอดเสียง+LLM สำหรับ TikTok-FB)
  const extractInsight = async () => {
    if (!url.trim()) { setErr('วางลิงก์คลิปก่อน'); return; }
    setInsightLoading(true); setErr(''); setInsight(null);
    try {
      const r = await fetch('/api/clip-transcript/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) });
      const d = await r.json();
      if (!d.success) setErr(d.error || 'ถอดประเด็นไม่สำเร็จ');
      else { setInsight(d.data); loadInsightCases(); }   // ★ รีเฟรชคลังประเด็นทันทีที่ถอดสำเร็จ
    } catch (e) { setErr(e.message); }
    setInsightLoading(false);
  };

  // ★ ส่งลิงก์เข้าคิว "เครื่องทีม" → poll สถานะจนเสร็จ (สำหรับ FB/IG หรือเมื่อทำในเว็บไม่ได้)
  const submitToQueue = async () => {
    if (!url.trim()) { setErr('วางลิงก์คลิปก่อน'); return; }
    setSubmitting(true); setErr(''); setQueueJob(null);
    try {
      const me = (typeof window !== 'undefined' && localStorage.getItem('clip_user')) || '';
      const r = await fetch('/api/clip-transcript/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), kind: 'insight', tidy, user: me }) });
      const d = await r.json();
      if (!d.success) { setErr(d.error || 'ส่งเข้าคิวไม่สำเร็จ'); setSubmitting(false); return; }
      setQueueJob({ jobId: d.jobId, status: d.status || 'pending', position: d.position, platform: d.platform });
      pollJob(d.jobId);
    } catch (e) { setErr(e.message); }
    setSubmitting(false);
  };
  const pollJob = async (jobId) => {
    for (let i = 0; i < 240; i++) { // poll สูงสุด ~16 นาที (4 วิ/รอบ)
      await new Promise(res => setTimeout(res, 4000));
      try {
        const r = await fetch('/api/clip-transcript/job-status?id=' + jobId, { cache: 'no-store' });
        const d = await r.json();
        if (!d.success) { setQueueJob(j => ({ ...j, status: 'error', error: d.error || 'หางานในคิวไม่เจอ' })); return; }
        setQueueJob({ jobId, status: d.status, position: d.position, platform: d.platform, result: d.result, error: d.error });
        if (d.status === 'done') { setInsight(d.result); loadInsightCases(); return; }
        if (d.status === 'error') return;
      } catch { /* เน็ตสะดุด — รอบหน้าลองใหม่ */ }
    }
    setQueueJob(j => ({ ...(j || {}), status: 'error', error: 'รอนานเกินไป — ลองเช็กในคลังหรือส่งใหม่' }));
  };

  const copy = (text, key) => { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 2000); };
  const deleteCase = async (id) => { await fetch('/api/clip-transcript/cases?id=' + id, { method: 'DELETE' }); loadCases(); };
  const deleteInsightCase = async (id) => { await fetch('/api/clip-transcript/cases?kind=insight&id=' + id, { method: 'DELETE' }); loadInsightCases(); };

  // รวมข้อความข้อมูลดิบของเคสประเด็น (เอาไปคัดลอกทั้งก้อน)
  const insightCaseText = (ins) => {
    if (!ins) return '';
    const parts = [];
    if (ins.headline) parts.push(`📌 ${ins.headline}`);
    if (ins.overview) parts.push(ins.overview);
    if (ins.keyPoints?.length) parts.push('— ประเด็นสำคัญ —\n' + ins.keyPoints.map((k, i) => `${i + 1}. ${k.point}${k.detail ? ' — ' + k.detail : ''}`).join('\n'));
    if (ins.quotes?.length) parts.push('— คำพูดสำคัญ —\n' + ins.quotes.map(q => `“${q}”`).join('\n'));
    if (ins.rawData) parts.push('— ข้อมูลดิบ —\n' + ins.rawData);
    return parts.join('\n\n');
  };

  const shown = out ? (view === 'tidy' && out.tidyText ? out.tidyText : out.rawText) : '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #0d0d1a)', color: 'var(--text-primary, #e8e8f0)', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>🎙️ ถอดบทสัมภาษณ์จากคลิป</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted, #888)', margin: '6px 0 22px' }}>
          วางลิงก์ TikTok / YouTube / Facebook → ถอดบทพูด-บทสัมภาษณ์เป็นข้อความ → เก็บเข้าคลัง หยิบไปเรียบเรียงเป็นข่าวเอง (แยกจากระบบทำข่าว)
        </p>

        {/* Input */}
        <div className="card" style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid var(--border, #2a2a3e)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && !loading && extract()}
              placeholder="วางลิงก์คลิป เช่น https://www.tiktok.com/... หรือ https://youtu.be/..."
              style={{ flex: 1, minWidth: 280, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border, #2a2a3e)', background: 'rgba(0,0,0,0.2)', color: 'inherit', fontSize: 14, fontFamily: 'inherit' }} />
            <button onClick={extract} disabled={loading || insightLoading}
              style={{ padding: '12px 22px', borderRadius: 10, border: 'none', background: loading ? '#4b5563' : 'linear-gradient(135deg,#f91880,#7c3aed)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {loading ? '⏳ กำลังถอด...' : '🎙️ ถอดบทสัมภาษณ์'}
            </button>
            <button onClick={extractInsight} disabled={loading || insightLoading}
              style={{ padding: '12px 22px', borderRadius: 10, border: 'none', background: insightLoading ? '#4b5563' : 'linear-gradient(135deg,#2563eb,#0891b2)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: insightLoading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {insightLoading ? '⏳ Gemini กำลังดูคลิป...' : '🎯 ถอดประเด็นข่าว (ข้อมูลดิบ)'}
            </button>
            <button onClick={submitToQueue} disabled={loading || insightLoading || submitting || (queueJob && queueJob.status !== 'done' && queueJob.status !== 'error')}
              title="ส่งลิงก์ให้เครื่องทีมถอดให้ — เหมาะกับ Facebook/IG หรือเมื่อทำในเว็บไม่ได้"
              style={{ padding: '12px 22px', borderRadius: 10, border: '1px solid #f59e0b', background: submitting ? '#4b5563' : 'rgba(245,158,11,0.12)', color: '#fbbf24', fontWeight: 800, fontSize: 14, cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {submitting ? '⏳ กำลังส่ง...' : '📥 ส่งเข้าคิว (เครื่องทีม)'}
            </button>
          </div>

          {/* ★ สถานะงานในคิวเครื่องทีม */}
          {queueJob && (
            <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, fontSize: 13, lineHeight: 1.6,
              border: '1px solid ' + (queueJob.status === 'error' ? '#ef4444' : queueJob.status === 'done' ? '#22c55e' : '#f59e0b'),
              background: queueJob.status === 'error' ? 'rgba(239,68,68,0.08)' : queueJob.status === 'done' ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)' }}>
              {queueJob.status === 'pending' && <>⏳ <b>อยู่ในคิวเครื่องทีม</b> — ลำดับที่ {queueJob.position || '?'} · {platformIcon({ youtube: 'youtube', tiktok: 'tiktok', meta: 'meta' }[queueJob.platform])} กำลังรอเครื่องทีมดึงไปถอด (เปิดหน้านี้ค้างไว้ ผลจะเด้งขึ้นเอง)</>}
              {queueJob.status === 'processing' && <>🔧 <b>เครื่องทีมกำลังถอดอยู่...</b> {platformIcon(queueJob.platform)} (อาจใช้เวลา 1-3 นาทีต่อคลิป)</>}
              {queueJob.status === 'done' && <>✅ <b>ถอดเสร็จแล้ว</b> — ผลอยู่ด้านล่าง + เก็บเข้าคลังประเด็นข่าวให้แล้ว</>}
              {queueJob.status === 'error' && <>❌ <b>ถอดไม่สำเร็จ</b> — {queueJob.error || 'ลองส่งใหม่อีกครั้ง'}</>}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-muted, #888)', lineHeight: 1.6 }}>
            🎙️ <b>ถอดบทสัมภาษณ์</b> = ได้บทพูดเต็ม + บอกประเภทคลิป (สัมภาษณ์/พูดเดี่ยว/อ่านข่าว) · 🎯 <b>ถอดประเด็นข่าว</b> = Gemini ดูคลิปจริง (YouTube/TikTok/Reels — เห็นภาพ+ตัวหนังสือบนจอ) → ข้อมูลดิบ (ประเด็น+คำพูด+ช่วงเวลา) · FB/IG ทำได้บนเครื่องทีม
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: 'var(--text-muted, #888)', cursor: 'pointer' }}>
            <input type="checkbox" checked={tidy} onChange={e => setTidy(e.target.checked)} />
            ✨ เรียบเรียงให้อ่านลื่น (จัดลำดับ ตัดคำซ้ำ/เสียงเอ้อ — ไม่สรุป ไม่ตัดเนื้อหา) — ปิดถ้าอยากได้บทดิบเป๊ะ
          </label>
          {err && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 13 }}>❌ {err}</div>}
        </div>

        {/* Output */}
        {out && (
          <div className="card" style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 14, padding: 18, marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{platformIcon(out.platform)} บทถอด {out.caption ? `— ${out.caption.slice(0, 60)}` : ''}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {out.tidyText && <>
                  <button onClick={() => setView('tidy')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: view === 'tidy' ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.06)', color: view === 'tidy' ? '#a78bfa' : 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✨ เรียบเรียงแล้ว</button>
                  <button onClick={() => setView('raw')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: view === 'raw' ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.06)', color: view === 'raw' ? '#a78bfa' : 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>📄 บทดิบ</button>
                </>}
                <button onClick={() => copy(shown, 'out')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: copied === 'out' ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.15)', color: copied === 'out' ? '#22c55e' : '#3b82f6', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'out' ? '✅ คัดลอกแล้ว' : '📋 Copy'}</button>
              </div>
            </div>
            {out.classify && out.classify.clipType !== 'other' && (
              <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: '#a78bfa' }}>{out.classify.emoji} ประเภท: {out.classify.clipTypeLabel}</span>
                  {out.classify.speakerCount > 0 && <span style={{ fontSize: 11.5, color: 'var(--text-muted,#888)' }}>· {out.classify.speakerCount} คนพูด</span>}
                  {out.classify.speakers?.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--text-muted,#888)' }}>· 🗣️ {out.classify.speakers.join(', ')}</span>}
                </div>
                {out.classify.usageNote && <div style={{ fontSize: 11.5, color: 'var(--text-muted,#888)', marginTop: 5, lineHeight: 1.5 }}>💡 {out.classify.usageNote}</div>}
              </div>
            )}
            <div style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 420, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 14 }}>{shown}</div>
          </div>
        )}

        {/* ★ ถอดประเด็นข่าว → ข้อมูลดิบ (Gemini ดูคลิป) */}
        {insightLoading && (
          <div className="card" style={{ background: 'var(--bg-card,#1a1a2e)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 14, padding: 24, marginBottom: 22, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#60a5fa', fontWeight: 700 }}>🎯 Gemini กำลังดูคลิปและถอดประเด็น... (คลิปยาวอาจ 1-2 นาที)</div>
          </div>
        )}
        {insight && !insightLoading && (
          <div className="card" style={{ background: 'var(--bg-card,#1a1a2e)', border: '1px solid rgba(37,99,235,0.35)', borderRadius: 14, padding: 18, marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#60a5fa' }}>🎯 ข้อมูลดิบจากคลิป</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 20, background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontWeight: 700 }}>{insight.emoji} {insight.clipTypeLabel}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted,#888)' }}>{insight.engine === 'gemini-video' ? '👁️ Gemini ดูคลิป' : '📝 จากบทถอดเสียง'}</span>
                <button onClick={() => copy(insight.rawData, 'insight-raw')} style={{ padding: '4px 11px', borderRadius: 8, border: 'none', background: copied === 'insight-raw' ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.15)', color: copied === 'insight-raw' ? '#22c55e' : '#3b82f6', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'insight-raw' ? '✅ คัดลอกแล้ว' : '📋 คัดลอกข้อมูลดิบ'}</button>
              </div>
            </div>

            {insight.headline && <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>📌 {insight.headline}</div>}
            {insight.speakers?.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--text-muted,#888)', marginBottom: 10 }}>🗣️ ผู้พูด: {insight.speakers.join(', ')}</div>}
            {insight.usageNote && <div style={{ fontSize: 11.5, color: '#a78bfa', marginBottom: 12, padding: '7px 11px', borderRadius: 8, background: 'rgba(124,58,237,0.07)' }}>💡 {insight.usageNote}</div>}

            {insight.overview && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted,#888)', marginBottom: 5 }}>ภาพรวม</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{insight.overview}</div>
              </div>
            )}

            {insight.keyPoints?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted,#888)', marginBottom: 6 }}>🎯 ประเด็นสำคัญ ({insight.keyPoints.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {insight.keyPoints.map((k, i) => (
                    <div key={i} style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(0,0,0,0.2)', borderLeft: '3px solid #2563eb' }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{i + 1}. {k.point}</div>
                      {k.detail && <div style={{ fontSize: 12.5, color: 'var(--text-muted,#aaa)', marginTop: 4, lineHeight: 1.6 }}>{k.detail}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {insight.quotes?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted,#888)', marginBottom: 6 }}>💬 คำพูดสำคัญ</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {insight.quotes.map((q, i) => (<div key={i} style={{ fontSize: 12.5, lineHeight: 1.6, padding: '7px 11px', borderRadius: 8, background: 'rgba(34,197,94,0.06)', borderLeft: '3px solid #22c55e' }}>&ldquo;{q}&rdquo;</div>))}
                </div>
              </div>
            )}

            {insight.timeline?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted,#888)', marginBottom: 6 }}>⏱️ ช่วงจังหวะในคลิป</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {insight.timeline.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
                      <span style={{ color: '#60a5fa', fontWeight: 700, minWidth: 84, flexShrink: 0 }}>{t.time || '—'}</span>
                      <span style={{ color: 'var(--text-muted,#aaa)' }}>{t.topic}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {insight.rawData && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted,#888)', marginBottom: 5 }}>📄 ข้อมูลดิบ (พร้อมเอาไปใช้)</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.8, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 14, maxHeight: 360, overflowY: 'auto' }}>{insight.rawData}</div>
              </div>
            )}
          </div>
        )}

        {/* คลัง */}
        <button onClick={() => setCasesOpen(!casesOpen)} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border, #2a2a3e)', background: casesOpen ? 'rgba(99,102,241,0.12)' : 'var(--bg-card, #1a1a2e)', color: casesOpen ? '#818cf8' : 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          📦 คลังบทถอด ({cases.length}) {casesOpen ? '▲' : '▼'}
        </button>
        {casesOpen && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cases.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 13 }}>ยังไม่มีบทถอด — ถอดคลิปสักครั้งแล้วจะเก็บที่นี่อัตโนมัติ</div>}
            {cases.map((c) => (
              <div key={c.id} style={{ border: '1px solid var(--border, #2a2a3e)', borderRadius: 10, overflow: 'hidden' }}>
                <div onClick={() => setExpanded(expanded === c.id ? null : c.id)} style={{ padding: '11px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'var(--bg-card, #1a1a2e)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                      {(c.category || c.classify?.category) && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(245,158,11,0.16)', color: '#f59e0b', fontWeight: 800 }}>📂 {c.category || c.classify?.category}</span>}
                      {(c.clipTypeLabel || c.classify?.clipTypeLabel) && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontWeight: 700 }}>{c.classify?.emoji || '🎬'} {c.clipTypeLabel || c.classify?.clipTypeLabel}</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platformIcon(c.platform)} {c.title || c.url}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted, #888)', marginTop: 3 }}>{c.platform} · {c.wordCount} ตัวอักษร · {new Date(c.createdAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteCase(c.id); }} style={{ marginLeft: 10, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>ลบ</button>
                </div>
                {expanded === c.id && (
                  <div style={{ padding: 14, borderTop: '1px solid var(--border, #2a2a3e)' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#3b82f6' }}>🔗 เปิดคลิป</a>
                      {c.tidyText && <button onClick={() => copy(c.tidyText, 'c-tidy-' + c.id)} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'c-tidy-' + c.id ? '✅' : '📋 คัดลอกที่เรียบเรียง'}</button>}
                      <button onClick={() => copy(c.rawText, 'c-raw-' + c.id)} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'c-raw-' + c.id ? '✅' : '📋 คัดลอกบทดิบ'}</button>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 12 }}>{c.tidyText || c.rawText}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ★ 22 มิ.ย.: คลังถอดประเด็นข่าว (ข้อมูลดิบ) — เก็บทุกครั้งที่ถอดสำเร็จ */}
        <button onClick={() => setInsightCasesOpen(!insightCasesOpen)} style={{ marginTop: 16, padding: '10px 18px', borderRadius: 10, border: '1px solid rgba(37,99,235,0.3)', background: insightCasesOpen ? 'rgba(37,99,235,0.12)' : 'var(--bg-card, #1a1a2e)', color: insightCasesOpen ? '#60a5fa' : 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          🎯 คลังถอดประเด็นข่าว ({insightCases.length}) {insightCasesOpen ? '▲' : '▼'}
        </button>
        {insightCasesOpen && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insightCases.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 13 }}>ยังไม่มีประเด็นข่าว — กด &ldquo;ถอดประเด็นข่าว&rdquo; สักครั้งแล้วจะเก็บที่นี่อัตโนมัติ</div>}
            {insightCases.map((c) => {
              const ins = c.insight || {};
              return (
                <div key={c.id} style={{ border: '1px solid rgba(37,99,235,0.25)', borderRadius: 10, overflow: 'hidden' }}>
                  <div onClick={() => setInsightExpanded(insightExpanded === c.id ? null : c.id)} style={{ padding: '11px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'var(--bg-card, #1a1a2e)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                        {ins.clipTypeLabel && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontWeight: 700 }}>{ins.emoji || '🎬'} {ins.clipTypeLabel}</span>}
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(37,99,235,0.15)', color: '#60a5fa', fontWeight: 700 }}>{ins.engine === 'gemini-video' ? '👁️ ดูคลิป' : '📝 บทถอด'}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platformIcon(c.platform)} {ins.headline || c.title || c.url}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted, #888)', marginTop: 3 }}>{c.platform} · {ins.keyPoints?.length || 0} ประเด็น · {new Date(c.createdAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); deleteInsightCase(c.id); }} style={{ marginLeft: 10, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>ลบ</button>
                  </div>
                  {insightExpanded === c.id && (
                    <div style={{ padding: 14, borderTop: '1px solid rgba(37,99,235,0.2)' }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                        <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#3b82f6' }}>🔗 เปิดคลิป</a>
                        {ins.rawData && <button onClick={() => copy(ins.rawData, 'ic-raw-' + c.id)} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'ic-raw-' + c.id ? '✅' : '📋 คัดลอกข้อมูลดิบ'}</button>}
                        <button onClick={() => copy(insightCaseText(ins), 'ic-all-' + c.id)} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'ic-all-' + c.id ? '✅' : '📋 คัดลอกทั้งหมด'}</button>
                      </div>
                      {ins.overview && <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{ins.overview}</div>}
                      {ins.keyPoints?.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                          {ins.keyPoints.map((k, i) => (
                            <div key={i} style={{ padding: '8px 11px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', borderLeft: '3px solid #2563eb' }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{i + 1}. {k.point}</div>
                              {k.detail && <div style={{ fontSize: 12, color: 'var(--text-muted,#aaa)', marginTop: 3, lineHeight: 1.6 }}>{k.detail}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                      {ins.rawData && <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 280, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 12 }}>{ins.rawData}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
