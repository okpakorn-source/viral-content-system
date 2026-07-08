'use client';
import { useState, useEffect } from 'react';

// ★ 25 มิ.ย.: อ่าน response แบบปลอดภัย — กัน "Unexpected token 'A'..." เมื่อเซิร์ฟเวอร์
//   timeout แล้ว Vercel คืน error page เป็น text (ไม่ใช่ JSON) → แปลงเป็นข้อความที่อ่านออก
async function safeJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); }
  catch {
    if (!r.ok && /timeout|FUNCTION_INVOCATION|error occurred|deadline/i.test(text)) {
      return { success: false, error: 'เซิร์ฟเวอร์ใช้เวลานานเกินไป (timeout) — คลิปอาจยาว/Gemini แน่น กดใหม่อีกครั้งได้เลย' };
    }
    return { success: false, error: !r.ok ? `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${r.status}) — ลองใหม่อีกครั้ง` : 'อ่านผลลัพธ์ไม่ได้ ลองใหม่อีกครั้ง' };
  }
}

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
  // ★ 26 มิ.ย.: ไฟสัญญาณ Gemini แบบเรียลไทม์ (เขียว=พร้อม แดง=แน่น เหลือง=ช้า/ไม่แน่ใจ)
  const [gem, setGem] = useState(null); // { light, msg, ms }
  // ★ 26 มิ.ย.: นาฬิกาเดินวินาที — ใช้นับถอยหลัง "ลองใหม่ในอีก ~X" ตอนงานรอ Gemini หาย (retry_wait)
  const [nowMs, setNowMs] = useState(Date.now());
  // ★ 26 มิ.ย.: แผงคิวรวม — เห็นทุกคลิปที่รออยู่/กำลังลองใหม่/เสร็จล่าสุด
  const [queueList, setQueueList] = useState(null); // { counts, active[], recent[] }
  const [queueListOpen, setQueueListOpen] = useState(true);

  const loadCases = async () => {
    try { const r = await fetch('/api/clip-transcript/cases?limit=40', { cache: 'no-store' }); const d = await r.json(); if (d.success) setCases(d.cases || []); } catch {}
  };
  const loadInsightCases = async () => {
    try { const r = await fetch('/api/clip-transcript/cases?kind=insight&limit=40', { cache: 'no-store' }); const d = await r.json(); if (d.success) setInsightCases(d.cases || []); } catch {}
  };
  // ★ 26 มิ.ย.: โหลดแผงคิวรวม (ทุกคลิปที่กำลังรอ/ลองใหม่/เสร็จล่าสุด)
  const loadQueueList = async () => {
    try { const r = await fetch('/api/clip-transcript/queue-list', { cache: 'no-store' }); const d = await r.json(); if (d.success) setQueueList(d); } catch {}
  };
  // ★ 27 มิ.ย. (ผู้ใช้สั่ง): ลบงานคลิปออกจากคิวจริงๆ — หยุดถอด/หยุด retry (ลิงก์เสีย/วนซ้ำ)
  const cancelClip = async (id) => {
    if (!confirm('ลบคลิปนี้ออกจากคิว? (หยุดถอด/หยุดลองใหม่)')) return;
    try {
      await fetch('/api/clip-transcript/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    } catch {}
    loadQueueList(); // รีเฟรชให้คลิปหายจากคิวทันที
  };
  useEffect(() => { loadCases(); loadInsightCases(); loadQueueList(); }, []);
  // ★ 26 มิ.ย.: รีเฟรชแผงคิวทุก 10 วิ — เห็นคิวเดินสด แม้ไม่ได้ส่งงานเอง (คนอื่นในทีมส่งก็เห็น)
  useEffect(() => { const t = setInterval(loadQueueList, 10000); return () => clearInterval(t); }, []);
  // ★ 26 มิ.ย.: เช็กสถานะ Gemini เรียลไทม์ — โหลดหน้า + ทุก 45 วิ (server cache 30 วิ กันยิงถี่)
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch('/api/clip-transcript/gemini-health', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
        const d = await r.json();
        if (alive) setGem(d);
      } catch { if (alive) setGem({ light: 'yellow', msg: 'เช็กสถานะไม่ได้ชั่วคราว' }); }
    };
    check();
    const t = setInterval(check, 45000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // ★ 26 มิ.ย.: เดินนาฬิกาทุก 1 วิ เฉพาะตอนมีงาน "รอลองใหม่" (retry_wait) — ให้ตัวนับถอยหลังขยับเห็นชัด
  useEffect(() => {
    if (queueJob?.status !== 'retry_wait' || !queueJob?.nextRetryAt) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [queueJob?.status, queueJob?.nextRetryAt]);

  const platformIcon = (p) => p === 'youtube' ? '📺' : p === 'tiktok' ? '🎵' : p === 'meta' ? '📘' : '🎬';

  const extract = async () => {
    if (!url.trim()) { setErr('วางลิงก์คลิปก่อน'); return; }
    setLoading(true); setErr(''); setOut(null);
    try {
      const r = await fetch('/api/clip-transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), tidy }) });
      const d = await safeJson(r);
      if (!d.success) { setErr(d.error || 'ถอดไม่สำเร็จ'); }
      else { setOut(d.data); setView(d.data.tidyText ? 'tidy' : 'raw'); loadCases(); }
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  // ★ ถอดประเด็นข่าว → ข้อมูลดิบ (Gemini ดูคลิป YouTube / ถอดเสียง+LLM สำหรับ TikTok-FB)
  //   ★ 8 ก.ค.: force=true (ปุ่ม "ถอดใหม่") ข้ามผลจากคลัง ถอดสดเสมอ + ส่ง user เก็บ metadata คลัง
  const extractInsight = async (force = false) => {
    if (!url.trim()) { setErr('วางลิงก์คลิปก่อน'); return; }
    setInsightLoading(true); setErr(''); setInsight(null); setQueueJob(null);
    try {
      const me = (typeof window !== 'undefined' && localStorage.getItem('clip_user')) || '';
      const r = await fetch('/api/clip-transcript/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), force: !!force, user: me }) });
      const d = await safeJson(r);
      if (d.success) { setInsight(d.data); loadInsightCases(); }   // ★ รีเฟรชคลังประเด็นทันทีที่ถอดสำเร็จ
      // ★ 26 มิ.ย.: กดถอด "ทันที" แล้ว Gemini แน่น → ชวนไปกด "ส่งเข้าคิว" (ระบบรอ+รันเองจน Gemini ว่าง)
      //   ปุ่มถอดตรง = ลองเดี๋ยวนี้ (ไม่วนเงียบ) · ปุ่มคิว = หย่อนทิ้งไว้ ระบบจัดการให้ → แยกชัด ไม่งง
      else if (/Gemini มีคนใช้งานหนัก|แน่นชั่วคราว|503|overload/i.test(String(d.error || ''))) {
        setErr('⏳ ตอนนี้ Gemini แน่น ถอดทันทีไม่ผ่าน — กดปุ่ม "📥 ส่งเข้าคิว" ด้านล่างแทน ระบบจะรอแล้วรันให้เองจน Gemini ว่าง (ปิดหน้าได้ ผลเข้าคลังเอง ไม่ต้องเฝ้า/กดซ้ำ)');
      }
      else setErr(d.error || 'ถอดประเด็นไม่สำเร็จ');
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
      const d = await safeJson(r);
      if (!d.success) { setErr(d.error || 'ส่งเข้าคิวไม่สำเร็จ'); setSubmitting(false); return; }
      setQueueJob({ jobId: d.jobId, status: d.status || 'pending', position: d.position, platform: d.platform });
      pollJob(d.jobId);
    } catch (e) { setErr(e.message); }
    setSubmitting(false);
  };
  const pollJob = async (jobId) => {
    // poll นานพอครอบ ~4 ชม. (retry_wait หน่วง 15 วิ ลดภาระ) — ปิดหน้าได้ งานทำต่อเบื้องหลัง ผลเข้าคลังเอง
    for (let i = 0; i < 2000; i++) {
      let st = 'pending';
      try {
        const r = await fetch('/api/clip-transcript/job-status?id=' + jobId, { cache: 'no-store' });
        const d = await safeJson(r);
        if (!d.success) { setQueueJob(j => ({ ...j, status: 'error', error: d.error || 'หางานในคิวไม่เจอ' })); return; }
        st = d.status;
        // ★ 26 มิ.ย.: เก็บ statusNote/attempts/nextRetryAt → โชว์ตอน retry_wait (Gemini แน่น รอลองใหม่อัตโนมัติ + นับถอยหลัง)
        setQueueJob({ jobId, status: d.status, position: d.position, platform: d.platform, result: d.result, error: d.error, statusNote: d.statusNote, attempts: d.attempts, nextRetryAt: d.nextRetryAt });
        if (d.status === 'done') { setInsight(d.result); loadInsightCases(); return; }
        if (d.status === 'error') return;
        // 'pending' | 'processing' | 'retry_wait' → poll ต่อ (retry_wait = Gemini แน่น ระบบลองใหม่เองทุก ~3 นาที)
      } catch { /* เน็ตสะดุด — รอบหน้าลองใหม่ */ }
      await new Promise(res => setTimeout(res, st === 'retry_wait' ? 15000 : 4000));
    }
    // poll หมดเวลาแสดงผลสด — งานยัง "ทำต่อเบื้องหลัง" ผลจะเข้าคลังเอง (ไม่ใช่ error)
    setQueueJob(j => ({ ...(j || {}), _pollEnded: true }));
  };

  const copy = (text, key) => { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 2000); };
  const deleteCase = async (id) => { await fetch('/api/clip-transcript/cases?id=' + id, { method: 'DELETE' }); loadCases(); };
  const deleteInsightCase = async (id) => { await fetch('/api/clip-transcript/cases?kind=insight&id=' + id, { method: 'DELETE' }); loadInsightCases(); };

  // ข้อความคัดลอกของ "1 ประเด็น" (ใช้ทั้งคลิปยาวรายประเด็น)
  const topicText = (t) => {
    const lines = [`【${t.no}】 ${t.title || ''}${(t.timeStart || t.timeEnd) ? `  (${t.timeStart || '?'}–${t.timeEnd || '?'})` : ''}`];
    if (t.summary) lines.push(t.summary);
    if (t.keyPoints?.length) lines.push(t.keyPoints.map((k) => `• ${k}`).join('\n'));
    if (t.quotes?.length) lines.push(t.quotes.map((q) => `“${q}”`).join('\n'));
    return lines.join('\n');
  };

  // รวมข้อความข้อมูลดิบของเคสประเด็น (เอาไปคัดลอกทั้งก้อน) — รองรับทั้ง single + multi-topic (คลิปยาว)
  const insightCaseText = (ins) => {
    if (!ins) return '';
    const parts = [];
    if (ins.headline) parts.push(`📌 ${ins.headline}`);
    if (ins.overview) parts.push(ins.overview);
    if (ins.multiTopic && ins.topics?.length) {
      parts.push(`— แยก ${ins.topics.length} ประเด็น —`);
      ins.topics.forEach((t) => parts.push(topicText(t)));
      return parts.join('\n\n');
    }
    if (ins.keyPoints?.length) parts.push('— ประเด็นสำคัญ —\n' + ins.keyPoints.map((k, i) => `${i + 1}. ${k.point}${k.detail ? ' — ' + k.detail : ''}`).join('\n'));
    if (ins.quotes?.length) parts.push('— คำพูดสำคัญ —\n' + ins.quotes.map(q => `“${q}”`).join('\n'));
    if (ins.rawData) parts.push('— ข้อมูลดิบรวม —\n' + ins.rawData);
    // ★ 25 มิ.ย.: เนื้อดิบแยกประเด็น
    if (ins.subStories?.length) {
      ins.subStories.forEach((s, i) => parts.push(`— เนื้อดิบประเด็น ${s.no || i + 1}: ${s.topic}${s.timeRange ? ` (${s.timeRange})` : ''} —\n${s.rawData}${s.quotes?.length ? '\n\nคำพูด:\n' + s.quotes.map(q => `“${q}”`).join('\n') : ''}`));
    }
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
            <button onClick={() => extractInsight()} disabled={loading || insightLoading}
              style={{ padding: '12px 22px', borderRadius: 10, border: 'none', background: insightLoading ? '#4b5563' : 'linear-gradient(135deg,#2563eb,#0891b2)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: insightLoading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {insightLoading ? '⏳ Gemini กำลังดูคลิป...' : '🎯 ถอดประเด็นข่าว (ข้อมูลดิบ)'}
            </button>
            <button onClick={submitToQueue} disabled={loading || insightLoading || submitting || (queueJob && !queueJob._pollEnded && queueJob.status !== 'done' && queueJob.status !== 'error')}
              title="ส่งลิงก์ให้เครื่องทีมถอดให้ — เหมาะกับ Facebook/IG หรือเมื่อทำในเว็บไม่ได้"
              style={{ padding: '12px 22px', borderRadius: 10, border: '1px solid #f59e0b', background: submitting ? '#4b5563' : 'rgba(245,158,11,0.12)', color: '#fbbf24', fontWeight: 800, fontSize: 14, cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {submitting ? '⏳ กำลังส่ง...' : '📥 ส่งเข้าคิว (เครื่องทีม)'}
            </button>
          </div>

          {/* ★ 26 มิ.ย.: ไฟสัญญาณ Gemini เรียลไทม์ — งานจะได้รู้ว่าควรกดถอดตอนนี้ไหม */}
          {gem && (() => {
            const c = gem.light === 'green' ? { dot: '#22c55e', bg: 'rgba(34,197,94,0.10)', bd: '#22c55e', label: '🟢 Gemini พร้อม' }
              : gem.light === 'red' ? { dot: '#ef4444', bg: 'rgba(239,68,68,0.10)', bd: '#ef4444', label: '🔴 Gemini แน่น' }
              : { dot: '#f59e0b', bg: 'rgba(245,158,11,0.10)', bd: '#f59e0b', label: '🟡 Gemini ช้า/ไม่แน่ใจ' };
            return (
              <div style={{ marginTop: 10, padding: '9px 13px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
                display: 'flex', alignItems: 'center', gap: 9, border: '1px solid ' + c.bd, background: c.bg }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.dot, flexShrink: 0, boxShadow: `0 0 7px ${c.dot}` }} />
                <span><b>{c.label}</b> — {gem.msg || ''}{gem.ms ? ` (${(gem.ms / 1000).toFixed(1)} วิ)` : ''}
                  {gem.light === 'red' && <span style={{ opacity: 0.85 }}> · กดได้ ระบบจะลองให้เองจน Gemini ว่าง หรือรอไฟเขียวค่อยกด</span>}
                  {gem.light === 'green' && <span style={{ opacity: 0.85 }}> · กดถอดประเด็นได้เลย</span>}
                </span>
              </div>
            );
          })()}

          {/* ★ สถานะงานในคิวเครื่องทีม */}
          {queueJob && (
            <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, fontSize: 13, lineHeight: 1.6,
              border: '1px solid ' + (queueJob.status === 'error' ? '#ef4444' : queueJob.status === 'done' ? '#22c55e' : '#f59e0b'),
              background: queueJob.status === 'error' ? 'rgba(239,68,68,0.08)' : queueJob.status === 'done' ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)' }}>
              {queueJob.status === 'pending' && <>⏳ <b>อยู่ในคิวเครื่องทีม</b> — ลำดับที่ {queueJob.position || '?'} · {platformIcon({ youtube: 'youtube', tiktok: 'tiktok', meta: 'meta' }[queueJob.platform])} กำลังรอเครื่องทีมดึงไปถอด (เปิดหน้านี้ค้างไว้ ผลจะเด้งขึ้นเอง)</>}
              {queueJob.status === 'processing' && <>🔧 <b>เครื่องทีมกำลังถอดอยู่...</b>{queueJob.attempts > 0 ? <span style={{ color: '#fbbf24' }}> (ลองรอบที่ {queueJob.attempts + 1} — Gemini แน่น กำลังสู้อยู่)</span> : ''} {platformIcon(queueJob.platform)} (อาจใช้เวลา 1-3 นาทีต่อคลิป)</>}
              {/* ★ 26 มิ.ย.: Gemini แน่น → ระบบลองใหม่เองทุก ~3 นาที จนได้ผล + นับถอยหลังสด (ปิดหน้าได้ ผลเข้าคลัง) */}
              {queueJob.status === 'retry_wait' && (() => {
                const remainS = Math.max(0, Math.round(((queueJob.nextRetryAt ? new Date(queueJob.nextRetryAt).getTime() : nowMs) - nowMs) / 1000));
                const mm = Math.floor(remainS / 60), ss = remainS % 60;
                return <>🟡 <b>Gemini แน่นอยู่ — งานของคุณ &quot;อยู่ในคิว&quot; ระบบลองใหม่ให้เองอัตโนมัติ</b><br />
                  ✅ ลองไปแล้ว <b>{queueJob.attempts || 0}</b> ครั้ง · {remainS > 0
                    ? <>⏱️ รอบถัดไปในอีก <b>{mm > 0 ? `${mm} นาที ` : ''}{ss} วินาที</b></>
                    : <>🔄 <b>กำลังลองใหม่เดี๋ยวนี้…</b></>}
                  <br /><span style={{ fontSize: 11.5, opacity: 0.85 }}>👉 ปิดหน้านี้/ปิดมือถือได้เลย ไม่ต้องเฝ้า/ไม่ต้องส่งซ้ำ — พอ Gemini ว่าง ระบบถอดให้แล้วเก็บเข้า &quot;คลังประเด็นข่าว&quot; ด้านล่างอัตโนมัติ</span></>;
              })()}
              {queueJob.status === 'done' && <>✅ <b>ถอดเสร็จแล้ว</b> — ผลอยู่ด้านล่าง + เก็บเข้าคลังประเด็นข่าวให้แล้ว</>}
              {queueJob.status === 'error' && <>❌ <b>ถอดไม่สำเร็จ</b> — {queueJob.error || 'ลองส่งใหม่อีกครั้ง'}</>}
              {queueJob._pollEnded && queueJob.status !== 'done' && queueJob.status !== 'error' && <><br /><span style={{ fontSize: 11.5, opacity: 0.85 }}>⏱️ หยุดอัปเดตสดแล้ว แต่ <b>งานยังทำต่อเบื้องหลัง</b> — กลับมาดูผลที่ "คลังบทถอด" ด้านล่างได้เลย</span></>}
            </div>
          )}
          {/* ★ 26 มิ.ย.: แผงคิวรวม — เห็นทุกคลิปที่ส่งเข้าคิว (รออยู่/รอ Gemini หาย/ถอดอยู่/เสร็จล่าสุด) */}
          {queueList && (queueList.counts.active > 0 || (queueList.recent && queueList.recent.length > 0)) && (
            <div style={{ marginTop: 14, border: '1px solid rgba(245,158,11,0.25)', borderRadius: 12, background: 'rgba(245,158,11,0.04)', overflow: 'hidden' }}>
              <button onClick={() => setQueueListOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800 }}>
                <span>📋 คิวคลิป {queueList.counts.active > 0 ? `— รออยู่ ${queueList.counts.active} คลิป` : '— ว่าง'}{queueList.counts.retry_wait > 0 ? ` · 🟡 รอ Gemini ${queueList.counts.retry_wait}` : ''}{queueList.counts.processing > 0 ? ` · 🔧 ถอดอยู่ ${queueList.counts.processing}` : ''}</span>
                <span style={{ opacity: 0.6 }}>{queueListOpen ? '▲' : '▼'}</span>
              </button>
              {queueListOpen && (
                <div style={{ padding: '0 12px 12px' }}>
                  {queueList.active.length === 0 && <div style={{ fontSize: 12, opacity: 0.7, padding: '4px 2px' }}>ไม่มีคลิปรออยู่ — ส่งลิงก์เข้าคิวได้เลย</div>}
                  {queueList.active.map(j => {
                    const remainS = j.status === 'retry_wait' && j.nextRetryAt ? Math.max(0, Math.round((new Date(j.nextRetryAt).getTime() - nowMs) / 1000)) : 0;
                    const badge = j.status === 'retry_wait'
                      ? `🟡 รอ Gemini (ลอง ${j.attempts} ครั้ง${remainS > 0 ? ` · อีก ${Math.floor(remainS / 60) > 0 ? `${Math.floor(remainS / 60)}น ` : ''}${remainS % 60}ว` : ' · กำลังลอง'})`
                      : j.status === 'processing' ? `🔧 กำลังถอด${j.attempts > 0 ? ` (รอบ ${j.attempts + 1})` : ''}` : '⏳ รอคิว';
                    return (
                      <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12 }}>
                        <span>{platformIcon(j.platform)}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 }}>{String(j.url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</span>
                        <span style={{ fontWeight: 700, color: j.status === 'retry_wait' ? '#fbbf24' : j.status === 'processing' ? '#60a5fa' : '#9ca3af', whiteSpace: 'nowrap' }}>{badge}</span>
                        {/* ★ 27 มิ.ย.: retry ≥3 รอบ = น่าจะลิงก์เสีย/ไม่พบคอนเทนต์ → เตือน + ปุ่มลบ */}
                        {(j.attempts || 0) >= 3 && <span style={{ fontSize: 10.5, color: '#f87171', whiteSpace: 'nowrap' }}>· อาจลิงก์เสีย</span>}
                        <button onClick={() => cancelClip(j.id)} title="ลบออกจากคิว (หยุดถอด/หยุดลองใหม่)"
                          style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>🗑️ ลบ</button>
                      </div>
                    );
                  })}
                  {queueList.recent && queueList.recent.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
                      <div style={{ fontSize: 10.5, opacity: 0.55, marginBottom: 3 }}>เสร็จ/ล้ม ล่าสุด</div>
                      {queueList.recent.map(j => (
                        <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px', fontSize: 11.5, opacity: 0.7 }}>
                          <span>{j.status === 'done' ? '✅' : '❌'}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(j.url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 36)}</span>
                          {/* ★ 27 มิ.ย.: โชว์เหตุผลที่ล้ม (ไม่พบคอนเทนต์/ลิงก์เสีย ฯลฯ) ให้รู้ว่าลิงก์เสียจริง */}
                          {j.status === 'error' && j.error && <span title={j.error} style={{ fontSize: 10.5, color: '#f87171', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.error.slice(0, 34)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                {insight.category && <span style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 20, background: 'rgba(245,158,11,0.16)', color: '#f59e0b', fontWeight: 800 }}>📂 {insight.category}</span>}
                {insight.multiTopic && <span style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 20, background: 'rgba(245,158,11,0.18)', color: '#fbbf24', fontWeight: 800 }}>📚 คลิปยาว · {insight.totalTopics || insight.topics?.length || 0} ประเด็น</span>}
                <span style={{ fontSize: 10, color: 'var(--text-muted,#888)' }}>{String(insight.engine || '').includes('gemini-video') ? '👁️ Gemini ดูคลิป' : '📝 จากบทถอดเสียง'}</span>
                <button onClick={() => copy(insightCaseText(insight), 'insight-raw')} style={{ padding: '4px 11px', borderRadius: 8, border: 'none', background: copied === 'insight-raw' ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.15)', color: copied === 'insight-raw' ? '#22c55e' : '#3b82f6', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'insight-raw' ? '✅ คัดลอกแล้ว' : '📋 คัดลอกทั้งหมด'}</button>
              </div>
            </div>

            {/* ★ 8 ก.ค.: dedup — คลิปนี้เคยถอดแล้ว ระบบคืนผลจากคลังทันที (ฟรี ไม่เสียเวลา Gemini) + ปุ่มถอดสดใหม่ */}
            {insight.cached && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, padding: '9px 12px', borderRadius: 9, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', marginBottom: 12 }}>
                <span>⚡ <b>ผลจากคลัง</b> — คลิปนี้เคยถอดไว้เมื่อ {insight.cachedAt ? new Date(insight.cachedAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ก่อนหน้านี้'} (ไม่เสียเวลา/ค่าถอดซ้ำ)</span>
                <button onClick={() => extractInsight(true)} style={{ padding: '4px 12px', borderRadius: 7, border: '1px solid rgba(34,197,94,0.5)', background: 'transparent', color: '#22c55e', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🔁 ถอดใหม่</button>
              </div>
            )}
            {/* ★ 8 ก.ค.: ด่านตรวจคุณภาพ — ผลไม่สมบูรณ์ (ลองซ้ำแล้ว) → เตือนชัด อย่าใช้เงียบๆ */}
            {insight.lowQuality && (
              <div style={{ fontSize: 12, padding: '9px 12px', borderRadius: 9, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', marginBottom: 12 }}>
                ⚠️ <b>{insight.qualityNote || 'ผลอาจไม่สมบูรณ์ — แนะนำกดถอดใหม่'}</b>
              </div>
            )}

            {/* ★ 24 มิ.ย.: คลิปยาว = แยกทุกประเด็น (รายงานทุกช่วง) · คลิปสั้น = แสดงแบบเดิม */}
            {insight.multiTopic ? (
              <>
                {insight.headline && <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>📌 {insight.headline}</div>}
                {insight.overview && <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-muted,#bbb)', marginBottom: 14, whiteSpace: 'pre-wrap' }}>{insight.overview}</div>}
                <div style={{ fontSize: 12, fontWeight: 800, color: '#fbbf24', marginBottom: 10 }}>📚 แยกได้ {insight.topics?.length || 0} ประเด็น (เรียงตามเวลาในคลิป)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(insight.topics || []).map((t, i) => (
                    <div key={i} style={{ borderRadius: 11, background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(245,158,11,0.25)', padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, flex: 1, minWidth: 160 }}><span style={{ color: '#fbbf24' }}>【{t.no}】</span> {t.title}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {(t.timeStart || t.timeEnd) && <span style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>⏱️ {t.timeStart || '?'}–{t.timeEnd || '?'}</span>}
                          <button onClick={() => copy(topicText(t), 'tp-' + i)} style={{ padding: '3px 9px', borderRadius: 7, border: 'none', background: copied === 'tp-' + i ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.07)', color: copied === 'tp-' + i ? '#22c55e' : 'var(--text-muted,#aaa)', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === 'tp-' + i ? '✅' : '📋'}</button>
                        </div>
                      </div>
                      {t.summary && <div style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', marginBottom: (t.keyPoints?.length || t.quotes?.length) ? 8 : 0 }}>{t.summary}</div>}
                      {t.keyPoints?.length > 0 && <ul style={{ margin: '0 0 6px', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-muted,#bbb)' }}>{t.keyPoints.map((k, j) => <li key={j}>{k}</li>)}</ul>}
                      {t.quotes?.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{t.quotes.map((q, j) => <div key={j} style={{ fontSize: 12, lineHeight: 1.55, padding: '5px 9px', borderRadius: 7, background: 'rgba(34,197,94,0.06)', borderLeft: '2px solid #22c55e' }}>&ldquo;{q}&rdquo;</div>)}</div>}
                    </div>
                  ))}
                </div>
              </>
            ) : (<>
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
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted,#888)', marginBottom: 5 }}>📄 ข้อมูลดิบรวม (ภาพรวมทั้งคลิป)</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.8, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 14, maxHeight: 360, overflowY: 'auto' }}>{insight.rawData}</div>
              </div>
            )}
            {/* ★ 25 มิ.ย.: เนื้อดิบแยกประเด็น (เพิ่มจากของรวม) — คลิปหลายประเด็นเท่านั้น */}
            {insight.subStories?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24', marginBottom: 9 }}>🧩 เนื้อดิบแยกประเด็น ({insight.subStories.length}) — แต่ละอันเจาะลึก พร้อมเขียนเป็นข่าวเดี่ยว</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {insight.subStories.map((s, i) => (
                    <div key={i} style={{ border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: 12, background: 'rgba(245,158,11,0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800 }}>
                          <span style={{ color: '#fbbf24' }}>ประเด็น {s.no || i + 1}:</span> {s.topic}
                          {s.timeRange && <span style={{ fontSize: 11, color: '#60a5fa', fontFamily: 'monospace', fontWeight: 600, marginLeft: 6 }}>⏱️ {s.timeRange}</span>}
                        </div>
                        <button onClick={() => navigator.clipboard?.writeText(`${s.topic}\n\n${s.rawData}${s.quotes?.length ? '\n\nคำพูด:\n' + s.quotes.map(q => `“${q}”`).join('\n') : ''}`)}
                          style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(245,158,11,0.4)', background: 'transparent', color: '#fbbf24', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>📋 คัดลอก</button>
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 11 }}>{s.rawData}</div>
                      {s.keyPoints?.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-muted,#bbb)' }}>{s.keyPoints.map((k, j) => <li key={j}>{k}</li>)}</ul>}
                      {s.quotes?.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>{s.quotes.map((q, j) => <div key={j} style={{ fontSize: 12, lineHeight: 1.55, padding: '5px 9px', borderRadius: 7, background: 'rgba(34,197,94,0.06)', borderLeft: '2px solid #22c55e' }}>&ldquo;{q}&rdquo;</div>)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            </>)}
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
                        {(c.category || ins.category) && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(245,158,11,0.16)', color: '#f59e0b', fontWeight: 800 }}>📂 {c.category || ins.category}</span>}
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(37,99,235,0.15)', color: '#60a5fa', fontWeight: 700 }}>{String(ins.engine || '').includes('gemini-video') ? '👁️ ดูคลิป' : '📝 บทถอด'}</span>
                        {/* ★ 8 ก.ค.: ธงคุณภาพ — เคสที่ไม่ผ่านด่านตรวจ (ลองซ้ำแล้ว) เห็นชัด ไม่ปนกับเคสดี */}
                        {c.lowQuality && <span title={c.qualityNote || ''} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(239,68,68,0.14)', color: '#f87171', fontWeight: 800 }}>⚠️ ไม่สมบูรณ์</span>}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platformIcon(c.platform)} {ins.headline || c.title || c.url}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted, #888)', marginTop: 3 }}>{c.platform} · {ins.multiTopic ? `📚 ${ins.topics?.length || 0} ประเด็น (คลิปยาว)` : `${ins.keyPoints?.length || 0} ประเด็น${ins.subStories?.length ? ` · 🧩 ${ins.subStories.length} เนื้อดิบแยก` : ''}`}{c.user ? ` · 👤 ${c.user}` : ''} · {new Date(c.createdAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
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
                      {ins.multiTopic && ins.topics?.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                          {ins.topics.map((t, i) => (
                            <div key={i} style={{ padding: '9px 11px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(245,158,11,0.2)' }}>
                              <div style={{ fontSize: 12.5, fontWeight: 800 }}><span style={{ color: '#fbbf24' }}>【{t.no}】</span> {t.title} {(t.timeStart || t.timeEnd) && <span style={{ fontSize: 10.5, color: '#60a5fa', fontFamily: 'monospace', fontWeight: 600 }}>⏱️{t.timeStart || '?'}–{t.timeEnd || '?'}</span>}</div>
                              {t.summary && <div style={{ fontSize: 12, color: 'var(--text-muted,#aaa)', marginTop: 3, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{t.summary}</div>}
                              {t.keyPoints?.length > 0 && <ul style={{ margin: '5px 0 0', paddingLeft: 18, fontSize: 11.5, lineHeight: 1.6, color: 'var(--text-muted,#aaa)' }}>{t.keyPoints.map((k, j) => <li key={j}>{k}</li>)}</ul>}
                            </div>
                          ))}
                        </div>
                      )}
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
                      {/* ★ 26 มิ.ย.: เติมให้คลังแสดงครบเท่าเรียลไทม์ — คำพูด + ช่วงเวลา + เนื้อดิบแยกประเด็น (รองรับทุกทรงผลลัพธ์) */}
                      {ins.quotes?.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted,#888)', marginBottom: 5 }}>💬 คำพูดสำคัญ ({ins.quotes.length})</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {ins.quotes.map((q, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.55, padding: '6px 10px', borderRadius: 7, background: 'rgba(34,197,94,0.06)', borderLeft: '2px solid #22c55e' }}>&ldquo;{q}&rdquo;</div>)}
                          </div>
                        </div>
                      )}
                      {ins.timeline?.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted,#888)', marginBottom: 5 }}>⏱️ ช่วงจังหวะในคลิป</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {ins.timeline.map((t, i) => <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12 }}><span style={{ color: '#60a5fa', fontWeight: 700, minWidth: 80, flexShrink: 0 }}>{t.time || '—'}</span><span style={{ color: 'var(--text-muted,#aaa)' }}>{t.topic}</span></div>)}
                          </div>
                        </div>
                      )}
                      {ins.subStories?.length > 0 && (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 800, color: '#fbbf24', marginBottom: 8 }}>🧩 เนื้อดิบแยกประเด็น ({ins.subStories.length}) — แต่ละอันพร้อมเขียนเป็นข่าวเดี่ยว</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {ins.subStories.map((s, i) => (
                              <div key={i} style={{ border: '1px solid rgba(245,158,11,0.3)', borderRadius: 9, padding: 11, background: 'rgba(245,158,11,0.04)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                                  <div style={{ fontSize: 13, fontWeight: 800 }}><span style={{ color: '#fbbf24' }}>ประเด็น {s.no || i + 1}:</span> {s.topic}{s.timeRange && <span style={{ fontSize: 10.5, color: '#60a5fa', fontFamily: 'monospace', fontWeight: 600, marginLeft: 6 }}>⏱️ {s.timeRange}</span>}</div>
                                  <button onClick={() => copy(`${s.topic}\n\n${s.rawData}${s.quotes?.length ? '\n\nคำพูด:\n' + s.quotes.map(q => `“${q}”`).join('\n') : ''}`, 'ic-sub-' + c.id + '-' + i)} style={{ padding: '3px 9px', borderRadius: 7, border: '1px solid rgba(245,158,11,0.4)', background: 'transparent', color: '#fbbf24', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{copied === 'ic-sub-' + c.id + '-' + i ? '✅' : '📋'}</button>
                                </div>
                                <div style={{ fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10 }}>{s.rawData}</div>
                                {s.keyPoints?.length > 0 && <ul style={{ margin: '7px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.65, color: 'var(--text-muted,#bbb)' }}>{s.keyPoints.map((k, j) => <li key={j}>{k}</li>)}</ul>}
                                {s.quotes?.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>{s.quotes.map((q, j) => <div key={j} style={{ fontSize: 11.5, lineHeight: 1.5, padding: '5px 9px', borderRadius: 7, background: 'rgba(34,197,94,0.06)', borderLeft: '2px solid #22c55e' }}>&ldquo;{q}&rdquo;</div>)}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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
