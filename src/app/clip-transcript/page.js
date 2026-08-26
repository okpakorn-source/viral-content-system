'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import JobBoard from './ui/JobBoard';
import StatsStrip from './ui/StatsStrip';
import InsightCard from './ui/InsightCard';
import { detectLink, recommendAction, platformIcon as platIcon } from './ui/statusMeta';

// โทนทั้งหน้า (พิมพ์เขียวข้อ 8) — สีเน้นเดียว #38bdf8 · เขียว/เหลือง/แดงสงวนให้สถานะ
const C = {
  bg: '#0f172a', card: '#1f2937', sub: '#111827', line: '#374151',
  text: '#e5e7eb', muted: '#9ca3af', accent: '#38bdf8',
};

// ★ อ่าน response แบบปลอดภัย — กัน "Unexpected token" เมื่อเซิร์ฟเวอร์ timeout แล้วคืน error page เป็น text
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

const PAGE_SIZE = 12;

export default function ClipTranscriptPage() {
  const [url, setUrl] = useState('');
  const [tidy, setTidy] = useState(true);
  const [err, setErr] = useState('');       // กล่องแดง = ข้อผิดพลาดจริงเท่านั้น
  const [notice, setNotice] = useState('');  // กล่องฟ้า = แจ้งข่าวดี/สถานะ (แยกจาก err — แก้บั๊กเดิมที่ปนกัน)

  // ผู้ใช้ (เดิมไม่มี UI ตั้งค่า — ช่อง 👤 ในคลังเลยว่าง)
  const [currentUser, setCurrentUser] = useState('');
  const [editUser, setEditUser] = useState(false);

  // ถอดบทสัมภาษณ์
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState(null);
  const [view, setView] = useState('tidy');

  // ถอดประเด็น
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightCases, setInsightCases] = useState([]);
  const [insightTotal, setInsightTotal] = useState(0);
  const [insightOffset, setInsightOffset] = useState(0);
  const [insightOpen, setInsightOpen] = useState(false); // พับ default (พิมพ์เขียวข้อ 8 ลดรก)
  const [copied, setCopied] = useState('');

  // คิวเครื่องทีม
  const [queueJob, setQueueJob] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [queueList, setQueueList] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // ไฟ Gemini
  const [gem, setGem] = useState(null);

  // ค้นประเด็น (hunt)
  const [hunting, setHunting] = useState(false);
  const [huntPhase, setHuntPhase] = useState(0);
  const [hunt, setHunt] = useState(null);
  const [huntCases, setHuntCases] = useState([]);
  const [huntOpen, setHuntOpen] = useState(false);
  const [huntExpanded, setHuntExpanded] = useState(null);
  const [huntFilter, setHuntFilter] = useState('all');

  // refs กัน polling รั่วหลัง unmount (แก้บั๊ก setInterval/pollJob เดิมไม่มี cleanup)
  const aliveRef = useRef(true);
  const pollRef = useRef(null);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const link = useMemo(() => detectLink(url), [url]);

  const loadInsightCases = async (offset = insightOffset) => {
    try {
      const r = await fetch(`/api/clip-transcript/cases?kind=insight&limit=${PAGE_SIZE}&offset=${offset}`, { cache: 'no-store' });
      const d = await r.json();
      if (!aliveRef.current) return;                       // UI-02: กันอัปเดตหลังปิดหน้า
      if (d.success) { setInsightCases(d.cases || []); if (typeof d.total === 'number') setInsightTotal(d.total); }
    } catch {}
  };
  const loadHuntCases = async () => {
    try {
      const r = await fetch('/api/clip-transcript/cases?kind=hunt&limit=40', { cache: 'no-store' });
      const d = await r.json();
      if (!aliveRef.current) return;                       // UI-02
      if (d.success) setHuntCases(d.cases || []);
    } catch {}
  };
  const loadQueueList = async () => {
    try { const r = await fetch('/api/clip-transcript/queue-list', { cache: 'no-store' }); const d = await r.json(); if (d.success && aliveRef.current) setQueueList(d); } catch {}
  };

  useEffect(() => {
    // อ่านชื่อผู้ใช้หลัง mount เท่านั้น (localStorage ไม่มีตอน render ฝั่งเซิร์ฟเวอร์ — อ่านตอน render จะทำให้ hydration เพี้ยน)
    const saved = (typeof window !== 'undefined' && localStorage.getItem('clip_user')) || '';
    if (saved) queueMicrotask(() => { if (aliveRef.current) setCurrentUser(saved); });
    loadInsightCases(0); loadHuntCases(); loadQueueList();
    const qTimer = setInterval(loadQueueList, 10000);
    return () => clearInterval(qTimer);
  }, []);

  // ไฟ Gemini ทุก 45 วิ
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch('/api/clip-transcript/gemini-health', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
        const d = await r.json();
        if (!stop && aliveRef.current) setGem({ light: d.light, msg: d.msg, ms: d.ms });
      } catch { if (!stop && aliveRef.current) setGem({ light: 'yellow', msg: 'เช็คสถานะไม่ได้ชั่วคราว' }); }
    };
    check();
    const t = setInterval(check, 45000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  // นาฬิกาวินาที — เดินเฉพาะตอนมีงานรอนับถอยหลัง (ลดงานเรนเดอร์)
  useEffect(() => {
    const needClock = (queueJob && queueJob.status === 'retry_wait') ||
      (queueList && queueList.active && queueList.active.some(j => j.status === 'retry_wait'));
    if (!needClock) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [queueJob, queueList]);

  const saveUser = (v) => {
    const name = String(v || '').trim().slice(0, 40);
    setCurrentUser(name);
    try { localStorage.setItem('clip_user', name); } catch {}
    setEditUser(false);
  };

  const platformIcon = (p) => platIcon(p);

  // signature (key, text) — ตรงกับสัญญา onCopy(key,text) ของ InsightCard (แก้บั๊ก UI-01 คัดลอกกลับด้าน)
  const copy = (key, text) => { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 2000); };

  // ── กลไก API (คงพฤติกรรมเดิมทุกเส้น) ──
  const extract = async () => {
    if (!url.trim()) { setErr('วางลิงก์คลิปก่อน'); return; }
    setLoading(true); setErr(''); setNotice(''); setOut(null);
    try {
      const r = await fetch('/api/clip-transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), tidy }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (!d.success) setErr(d.error || 'ถอดไม่สำเร็จ');
      else { setOut(d.data); setView(d.data.tidyText ? 'tidy' : 'raw'); }
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const extractInsight = async (force = false, targetUrl = null) => {
    const target = (targetUrl != null ? targetUrl : url).trim();  // UI-03: รับ URL ตรง กันใช้ state เก่าตอน "ถอดใหม่" จากคลัง
    if (!target) { setErr('วางลิงก์คลิปก่อน'); return; }
    if (targetUrl != null) setUrl(target);
    setInsightLoading(true); setErr(''); setNotice(''); setInsight(null); setQueueJob(null);
    try {
      const r = await fetch('/api/clip-transcript/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target, force: !!force, user: currentUser }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (d.success) { setInsight(d.data); loadInsightCases(0); setInsightOffset(0); }
      else if (/Gemini มีคนใช้งานหนัก|แน่นชั่วคราว|503|overload/i.test(String(d.error || ''))) {
        setNotice('⏳ ตอนนี้ Gemini แน่น ถอดทันทีไม่ผ่าน — กด "ส่งเข้าคิว" ให้เครื่องทีมลองเมื่อรับงาน (ปิดหน้าได้ ถ้าล้มระบบจะไม่วนถอดซ้ำอัตโนมัติ)');
      }
      else setErr(d.error || 'ถอดประเด็นไม่สำเร็จ');
    } catch (e) { setErr(e.message); }
    setInsightLoading(false);
  };

  const extractHunt = async () => {
    if (!url.trim()) { setErr('วางลิงก์คลิปก่อน'); return; }
    setHunting(true); setHuntPhase(1); setErr(''); setNotice(''); setHunt(null); setQueueJob(null);
    try {
      if (!link.platform || link.platform === 'article') { /* ปล่อยให้ backend ตัดสิน */ }
      if (link.platform !== 'meta') {
        const r1 = await fetch('/api/clip-transcript/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), user: currentUser }) });
        const d1 = await safeJson(r1);
        if (!aliveRef.current) return;
        if (!d1.success) {
          setErr(/แน่น|503|overload|ใช้งานหนัก/i.test(String(d1.error || ''))
            ? '⏳ Gemini แน่น ถอดเนื้อดิบไม่ผ่าน — รอสักครู่แล้วกดใหม่ (คลิปที่ถอดผ่านแล้วจะผ่านขั้นแรกทันที)'
            : (d1.error || 'ถอดเนื้อดิบไม่สำเร็จ'));
          setHunting(false); setHuntPhase(0); return;
        }
      }
      setHuntPhase(2);
      const r2 = await fetch('/api/clip-transcript/hunt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), user: currentUser }) });
      const d2 = await safeJson(r2);
      if (!aliveRef.current) return;
      if (d2.success && d2.queued) {
        setHuntPhase(3);
        let tries = 0;
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          tries++;
          try {
            const q = await (await fetch(`/api/clip-transcript/job-status?id=${d2.jobId}`, { cache: 'no-store' })).json();
            if (!aliveRef.current) { clearInterval(pollRef.current); return; }   // UI-02: callback ที่ค้างกลาง await
            if (q.status === 'done') { clearInterval(pollRef.current); setHunt(q.result || null); setHuntPhase(0); setHunting(false); loadHuntCases(); loadInsightCases(0); }
            else if (q.status === 'error') { clearInterval(pollRef.current); setErr(q.error || 'ถอด+ค้นไม่สำเร็จ'); setHuntPhase(0); setHunting(false); }
            else if (q.status === 'cancelled') { clearInterval(pollRef.current); setNotice('🚫 งานถูกยกเลิกแล้ว'); setHuntPhase(0); setHunting(false); }
            else if (tries > 80) { clearInterval(pollRef.current); setNotice('⏱️ งานยังทำต่อเบื้องหลัง — เสร็จแล้วผลจะโผล่ใน "คลังค้นประเด็น" ด้านล่างเอง'); setHuntPhase(0); setHunting(false); }
          } catch {}
        }, 15000);
        return;
      }
      if (d2.success) { setHunt(d2.data); loadHuntCases(); loadInsightCases(0); }
      else setErr(d2.error || 'ค้นข่าวคล้ายไม่สำเร็จ');
    } catch (e) { setErr(e.message); }
    setHuntPhase(0); setHunting(false);
  };

  const extractNewsHunt = async () => {
    if (!url.trim()) { setErr('วางลิงก์ข่าวก่อน'); return; }
    if (link.isClip) { setErr('ลิงก์นี้เป็นคลิป — ใช้ปุ่ม "คลิป → ค้นข่าวคล้าย" แทน (ปุ่มข่าวสำหรับลิงก์ข่าวเว็บ)'); return; }
    setHunting(true); setHuntPhase(2); setErr(''); setNotice(''); setHunt(null); setQueueJob(null);
    try {
      const r = await fetch('/api/clip-transcript/news-hunt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), user: currentUser }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (d.success) { setHunt(d.data); loadHuntCases(); }
      else setErr(d.error || 'วิจัยลิงก์ข่าวไม่สำเร็จ');
    } catch (e) { setErr(e.message); }
    setHuntPhase(0); setHunting(false);
  };

  const huntMore = async (c) => {
    setHunting(true); setHuntPhase(2); setErr(''); setNotice('');
    try {
      const endpoint = c.sourceType === 'article' ? '/api/clip-transcript/news-hunt' : '/api/clip-transcript/hunt';
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: c.sourceUrl, user: currentUser, caseId: c.id }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (d.success && d.queued) setNotice('⏳ ส่งเครื่องทีมค้นเพิ่มแล้ว — ผลรวมเข้าเคสเดิมในคลังเอง');
      else if (d.success) { setHunt(d.data); loadHuntCases(); }
      else setErr(d.error || 'ค้นเพิ่มไม่สำเร็จ');
    } catch (e) { setErr(e.message); }
    setHuntPhase(0); setHunting(false);
  };

  const submitToQueue = async (forceUrl = null, force = false) => {
    const target = (forceUrl || url).trim();
    if (!target) { setErr('วางลิงก์คลิปก่อน'); return; }
    setSubmitting(true); setErr(''); setNotice(''); setQueueJob(null);
    try {
      const r = await fetch('/api/clip-transcript/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target, kind: 'insight', tidy, user: currentUser, force: !!force }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (!d.success) { setErr(d.error || 'ส่งเข้าคิวไม่สำเร็จ'); setSubmitting(false); return; }
      if (d.dup) setNotice('คลิปนี้อยู่ในคิวอยู่แล้ว — ติดตามสถานะได้ที่บอร์ดงานด้านล่าง');
      setQueueJob({ jobId: d.jobId, status: d.status || 'pending', position: d.position, platform: d.platform, url: target });
      loadQueueList();
      pollJob(d.jobId, target);
    } catch (e) { setErr(e.message); }
    setSubmitting(false);
  };

  const pollJob = async (jobId, jobUrl = '') => {
    for (let i = 0; i < 2000; i++) {
      if (!aliveRef.current) return;
      let st = 'pending';
      try {
        const r = await fetch('/api/clip-transcript/job-status?id=' + jobId, { cache: 'no-store' });
        const d = await safeJson(r);
        if (!aliveRef.current) return;
        if (!aliveRef.current) return;   // UI-02: กันอัปเดต state หลังผู้ใช้ปิดหน้า (in-flight callback)
        if (!d.success) { setQueueJob(j => ({ ...j, status: 'error', error: d.error || 'หางานในคิวไม่เจอ' })); return; }
        st = d.status;
        setQueueJob({ jobId, status: d.status, position: d.position, platform: d.platform, result: d.result, error: d.error, statusNote: d.statusNote, lastError: d.lastError, attempts: d.attempts, nextRetryAt: d.nextRetryAt, startedAt: d.startedAt, url: jobUrl });
        if (d.status === 'done') { setInsight(d.result); loadInsightCases(0); return; }
        if (d.status === 'error' || d.status === 'cancelled') return;
      } catch {}
      await new Promise(res => setTimeout(res, st === 'retry_wait' ? 15000 : 4000));
    }
    if (aliveRef.current) setQueueJob(j => ({ ...(j || {}), _pollEnded: true }));
  };

  // ── handlers ให้ JobBoard ──
  const onCancel = async (jobId) => {
    try {
      const r = await fetch('/api/clip-transcript/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: jobId }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (!d.success) setErr(d.error || 'ยกเลิกไม่สำเร็จ');
      else setNotice('🚫 ยกเลิกงานแล้ว');
    } catch (e) { setErr(e.message); }
    loadQueueList();
  };
  const onRetry = (job) => { if (job?.url) submitToQueue(job.url, true); };
  const onViewResult = async (job) => {
    try {
      const r = await fetch('/api/clip-transcript/job-status?id=' + (job.jobId || job.id), { cache: 'no-store' });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (d.success && d.result) { setInsight(d.result); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else setNotice('งานนี้ยังไม่มีผลให้แสดง');
    } catch (e) { setErr(e.message); }
  };
  const deleteInsightCase = async (id) => {
    if (!confirm('ลบเคสนี้ออกจากคลัง?')) return;
    await fetch('/api/clip-transcript/cases?kind=insight&id=' + id, { method: 'DELETE' });
    loadInsightCases();
  };
  const pinInsightCase = async (id, chosen) => {
    try { await fetch('/api/clip-transcript/cases', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, chosen }) }); loadInsightCases(); } catch {}
  };
  const gotoPage = (offset) => { const o = Math.max(0, offset); setInsightOffset(o); loadInsightCases(o); };

  // myJob ให้ JobBoard (จาก queueJob)
  const busy = loading || insightLoading || hunting;
  const primaryAction = recommendAction(url);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 18px 60px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>🎬 ระบบถอดคลิป</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {editUser ? (
              <input autoFocus defaultValue={currentUser} placeholder="ชื่อผู้ใช้"
                onBlur={e => saveUser(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveUser(e.target.value)}
                style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.accent}`, background: C.sub, color: C.text, fontSize: 12.5, fontFamily: 'inherit', width: 140 }} />
            ) : (
              <button onClick={() => setEditUser(true)} title="ตั้งชื่อผู้ใช้ (เก็บในเครื่องนี้ ติดไปกับเคสที่ถอด)"
                style={{ padding: '5px 12px', borderRadius: 999, border: `1px solid ${C.line}`, background: C.sub, color: currentUser ? C.text : C.muted, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                👤 {currentUser || 'ตั้งชื่อผู้ใช้'}
              </button>
            )}
            {gem && (() => {
              const g = gem.light === 'green' ? { d: '#22c55e', t: 'Gemini พร้อม' } : gem.light === 'red' ? { d: '#ef4444', t: 'Gemini แน่น' } : { d: '#f59e0b', t: 'Gemini ช้า/ไม่แน่ใจ' };
              return (
                <span title={gem.msg || ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, border: `1px solid ${C.line}`, background: C.sub, fontSize: 12.5, color: C.muted }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.d, boxShadow: `0 0 6px ${g.d}` }} />
                  {g.t}{gem.ms ? ` · ${(gem.ms / 1000).toFixed(1)}s` : ''}
                </span>
              );
            })()}
          </div>
        </div>
        <p style={{ fontSize: 13, color: C.muted, margin: '0 0 18px' }}>
          วางลิงก์คลิป (YouTube / TikTok / Facebook / IG) หรือลิงก์ข่าวเว็บ → ถอดประเด็นเป็นข้อมูลพร้อมใช้ · แยกจากระบบทำข่าว 100%
        </p>

        {/* โซน 1 — งานใหม่ */}
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
              <input value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !busy) { primaryAction === 'news-hunt' ? extractNewsHunt() : extractInsight(); } }}
                placeholder="วางลิงก์ที่นี่…"
                style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.sub, color: C.text, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              {link.label && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11.5, color: C.muted, background: C.card, padding: '2px 8px', borderRadius: 999, border: `1px solid ${C.line}` }}>{link.label}</span>}
            </div>
            {/* ปุ่มหลัก 1 ปุ่ม */}
            <button onClick={() => (primaryAction === 'news-hunt' ? extractNewsHunt() : extractInsight())} disabled={busy}
              style={{ padding: '12px 22px', borderRadius: 10, border: 'none', background: busy ? '#334155' : C.accent, color: busy ? C.muted : '#04263b', fontWeight: 800, fontSize: 14, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {insightLoading ? '⏳ กำลังถอด…' : primaryAction === 'news-hunt' ? '📰 วิจัยลิงก์ข่าว' : '🎯 ถอดประเด็น'}
            </button>
          </div>

          {/* ปุ่มรอง ghost */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button onClick={extract} disabled={busy || submitting} style={ghostBtn(busy)}>
              {loading ? '⏳…' : '🎙️ ถอดบทสัมภาษณ์'}
            </button>
            <button onClick={extractHunt} disabled={busy || submitting} style={ghostBtn(busy)}>
              {hunting ? '⏳…' : '🧭 คลิป → ค้นข่าวคล้าย'}
            </button>
            <button onClick={extractNewsHunt} disabled={busy || submitting} style={ghostBtn(busy)}>
              {hunting ? '⏳…' : '📰 ลิงก์ข่าว → วิจัย'}
            </button>
            <button onClick={() => submitToQueue()} disabled={busy || submitting} style={ghostBtn(busy)}>
              {submitting ? '⏳…' : '📥 ส่งเข้าคิว (เครื่องทีม)'}
            </button>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.muted, marginLeft: 'auto' }}>
              <input type="checkbox" checked={tidy} onChange={e => setTidy(e.target.checked)} /> เรียบเรียงให้อ่านลื่น
            </label>
          </div>

          {notice && <div style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, fontSize: 13, lineHeight: 1.55, border: `1px solid ${C.accent}55`, background: 'rgba(56,189,248,.08)', color: '#bae6fd' }}>{notice}</div>}
          {err && <div style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, fontSize: 13, lineHeight: 1.55, border: '1px solid #ef444455', background: 'rgba(239,68,68,.08)', color: '#fca5a5' }}>❌ {err}</div>}
        </div>

        {/* โซน 2 — บอร์ดงาน + สถิติ */}
        <StatsStrip counts={queueList?.counts} casesTotal={insightTotal} cases={insightCases} />
        <div style={{ marginBottom: 16 }}>
          <JobBoard
            myJob={queueJob}
            queue={queueList}
            nowMs={nowMs}
            currentUser={currentUser}
            onCancel={onCancel}
            onRetry={onRetry}
            onViewResult={onViewResult}
          />
        </div>

        {/* โซน 3 — ผลลัพธ์ */}
        {/* ผลถอดบทสัมภาษณ์ (out) */}
        {out && (
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>🎙️ ผลถอดบทสัมภาษณ์</span>
              {out.tidyText && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setView('tidy')} style={tabBtn(view === 'tidy')}>เรียบเรียง</button>
                  <button onClick={() => setView('raw')} style={tabBtn(view === 'raw')}>ดิบ</button>
                </div>
              )}
              <button onClick={() => copy('out', view === 'tidy' && out.tidyText ? out.tidyText : out.rawText)} style={{ ...tabBtn(false), marginLeft: 'auto' }}>{copied === 'out' ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}</button>
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: C.sub, borderRadius: 8, padding: 12, maxHeight: 420, overflowY: 'auto' }}>
              {view === 'tidy' && out.tidyText ? out.tidyText : out.rawText}
            </div>
          </div>
        )}

        {/* ผลถอดประเด็นสด */}
        {insightLoading && <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, marginBottom: 16, textAlign: 'center', color: C.muted, fontSize: 13.5 }}>⏳ Gemini กำลังดูคลิปและถอดประเด็น…</div>}
        {insight && (
          <div style={{ marginBottom: 16 }}>
            <InsightCard
              rec={insight.insight ? insight : { insight, url, platform: insight.platform }}
              live
              copiedKey={copied}
              onCopy={copy}
              onRetry={(u) => extractInsight(true, u)}
            />
          </div>
        )}

        {/* คลังถอดประเด็น (พับ default) */}
        <Section title={`📚 คลังถอดประเด็น${insightTotal ? ` (${insightTotal})` : ''}`} open={insightOpen} onToggle={() => setInsightOpen(o => !o)} C={C}>
          {insightCases.length === 0 && <div style={{ fontSize: 13, color: C.muted, padding: '4px 2px' }}>ยังไม่มีเคสในคลัง</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {insightCases.map(rec => (
              <InsightCard key={rec.id} rec={rec} copiedKey={copied}
                onCopy={copy} onDelete={deleteInsightCase} onPin={pinInsightCase} onRetry={(u) => extractInsight(true, u)} />
            ))}
          </div>
          {insightTotal > PAGE_SIZE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 14 }}>
              <button onClick={() => gotoPage(insightOffset - PAGE_SIZE)} disabled={insightOffset <= 0} style={pageBtn(insightOffset <= 0, C)}>‹ ก่อนหน้า</button>
              <span style={{ fontSize: 12.5, color: C.muted }}>{Math.floor(insightOffset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(insightTotal / PAGE_SIZE))}</span>
              <button onClick={() => gotoPage(insightOffset + PAGE_SIZE)} disabled={insightOffset + PAGE_SIZE >= insightTotal} style={pageBtn(insightOffset + PAGE_SIZE >= insightTotal, C)}>ถัดไป ›</button>
            </div>
          )}
        </Section>

        {/* แถบขั้นตอน hunt ระหว่างทำ */}
        {hunting && huntPhase > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 13, color: C.muted }}>
            {huntPhase === 1 && '① กำลังอ่านต้นทาง / ถอดเนื้อดิบ…'}
            {huntPhase === 2 && '② กำลังวิเคราะห์ DNA แนวข่าว + ค้นข่าวคล้าย…'}
            {huntPhase === 3 && '③ เครื่องทีมกำลังถอด + ค้น (ปิดหน้าได้ ผลเข้าคลังเอง)…'}
          </div>
        )}

        {/* ผลค้นประเด็นสด */}
        {hunt && (
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            {renderHuntCase(hunt, 'live')}
          </div>
        )}

        {/* คลังค้นประเด็น (พับ default) */}
        <Section title={`🧭 คลังค้นประเด็น${huntCases.length ? ` (${huntCases.length})` : ''}`} open={huntOpen} onToggle={() => setHuntOpen(o => !o)} C={C}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {[['all', 'ทั้งหมด'], ['clip', '🎬 คลิป'], ['article', '📰 ลิงก์ข่าว']].map(([k, lb]) => (
              <button key={k} onClick={() => setHuntFilter(k)} style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${huntFilter === k ? C.accent : C.line}`, background: 'transparent', color: huntFilter === k ? C.accent : C.muted }}>{lb}</button>
            ))}
          </div>
          {huntCases.filter(c => huntFilter === 'all' || (huntFilter === 'article' ? c.sourceType === 'article' : c.sourceType !== 'article')).map(c => (
            <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
              <button onClick={() => setHuntExpanded(huntExpanded === c.id ? null : c.id)} style={{ width: '100%', textAlign: 'left', padding: '10px 13px', background: 'transparent', border: 'none', color: C.text, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{c.sourceType === 'article' ? '📰' : '🎬'} {c.title || c.sourceUrl}</span>
                <span style={{ color: C.muted }}>{huntExpanded === c.id ? '▲' : '▼'}</span>
              </button>
              {huntExpanded === c.id && <div style={{ padding: '0 13px 13px' }}>{renderHuntCase(c, c.id)}</div>}
            </div>
          ))}
          {huntCases.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>ยังไม่มีเคสค้นประเด็น</div>}
        </Section>
      </div>
    </div>
  );

  // ── hunt rendering (คงของเดิม คอมโพเนนต์ใหม่ยังไม่ครอบส่วนนี้) ──
  function resultKind(r) {
    if (r.tag === 'same' || r.tag === 'follow') return { group: 'same', level: 0 };
    const lvl = [1, 2, 3].includes(Number(r.level)) ? Number(r.level) : 3;
    return { group: 'dna', level: lvl };
  }
  function levelText(lv) { return lv === 1 ? 'ใกล้' : lv === 2 ? 'กลาง' : 'กว้าง'; }
  function huntCaseText(c) {
    if (!c) return '';
    const d = (c.styleProfile || {}).dna || {};
    const results = c.results || [];
    const dnaR = results.filter(r => resultKind(r).group === 'dna');
    const sameR = results.filter(r => resultKind(r).group === 'same');
    const rowTxt = (r, i) => `${i + 1}. [${r.score}/10 · ${r.type}${resultKind(r).group === 'dna' ? ' · ' + levelText(resultKind(r).level) : ''}] ${r.title}\n   ${r.url}${r.reason ? `\n   เหตุผล: ${r.reason}` : ''}`;
    const lines = [
      `${c.sourceType === 'article' ? '📰 เคสวิจัยลิงก์ข่าว' : '🎬 เคสค้นประเด็นจากคลิป'}: ${c.title || ''}`,
      `ลิงก์ต้นทาง: ${c.sourceUrl || ''}`,
      `DNA แนวข่าว: ${d.who || '-'} · ${d.what || '-'} · ${d.core || '-'} · ${d.emotion || '-'}`,
      '', `=== ${c.sourceType === 'article' ? 'ผลวิจัยเชิงลึก' : 'เนื้อดิบจากคลิป'} ===`, c.insight?.rawData || '-',
      '', `=== ข่าวแนวเดียวกัน — คนละคน (${dnaR.length}) ===`, ...dnaR.map(rowTxt),
    ];
    if (sameR.length) { lines.push('', `=== ข่าวคนเดิม/ตามต่อ (${sameR.length}) ===`, ...sameR.map(rowTxt)); }
    return lines.join('\n');
  }
  function huntRow(r, key) {
    const k = resultKind(r);
    const meta = k.group === 'same'
      ? { label: '👤 คนเดิม/ตามต่อ', color: '#fbbf24' }
      : { 1: { label: '🎯 ใกล้', color: '#34d399' }, 2: { label: '🧬 กลาง', color: '#22d3ee' }, 3: { label: '🌐 กว้าง', color: '#c084fc' } }[k.level];
    return (
      <div key={key} style={{ display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12.5 }}>
        <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 20, background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 800 }}>{r.score}</span>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: meta.color + '22', color: meta.color, fontWeight: 700 }}>{meta.label}</span>
        <a href={r.url} target="_blank" rel="noopener noreferrer" title={r.reason || ''} style={{ color: C.accent, textDecoration: 'none', fontWeight: 600 }}>{r.title}</a>
        <span style={{ fontSize: 10.5, color: C.muted }}>{r.source}</span>
        <button onClick={() => copy(key, `${r.title}\n${r.url}`)} style={{ padding: '1px 8px', borderRadius: 6, border: 'none', background: C.sub, color: copied === key ? '#22c55e' : C.muted, fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === key ? '✓' : '📋'}</button>
      </div>
    );
  }
  function renderHuntCase(c, kp) {
    const d = (c.styleProfile || {}).dna || {};
    const isArticle = c.sourceType === 'article';
    const results = c.results || [];
    const dnaR = results.filter(r => resultKind(r).group === 'dna');
    const sameR = results.filter(r => resultKind(r).group === 'same');
    return (
      <div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, fontWeight: 700, background: C.sub, color: isArticle ? '#60a5fa' : '#a78bfa' }}>{isArticle ? '📰 จากลิงก์ข่าว' : '🎬 จากคลิป'}</span>
          {c.insight?.category && <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: C.sub, color: C.muted }}>📂 {c.insight.category}</span>}
          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700 }}>คนละคน {dnaR.length}{sameR.length ? ` · คนเดิม ${sameR.length}` : ''}</span>
          <button onClick={() => copy(kp + '-all', huntCaseText(c))} style={{ padding: '4px 11px', borderRadius: 8, border: `1px solid ${C.line}`, background: 'transparent', color: copied === kp + '-all' ? '#22c55e' : C.accent, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>{copied === kp + '-all' ? '✓ คัดลอกแล้ว' : '📋 คัดลอกทั้งเคส'}</button>
          <button onClick={() => huntMore(c)} disabled={hunting} style={{ padding: '4px 11px', borderRadius: 8, border: `1px solid ${C.line}`, background: 'transparent', color: '#2dd4bf', fontSize: 11.5, cursor: hunting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>{hunting ? '⏳…' : '🔁 ค้นเพิ่ม'}</button>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{c.title} <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: C.accent, fontWeight: 400 }}>🔗 เปิด</a></div>
        {(d.who || d.what || d.core || d.emotion) && (
          <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>🧬 DNA: {[d.who, d.what, d.core, d.emotion].filter(Boolean).join(' · ')}</div>
        )}
        {c.insight?.rawData && (
          <details style={{ marginBottom: 10 }} open={isArticle}>
            <summary style={{ fontSize: 12, color: C.muted, cursor: 'pointer' }}>{isArticle ? '🔬 ผลวิจัยเชิงลึก' : '📄 เนื้อดิบ'} ({c.insight.rawData.length} ตัวอักษร)</summary>
            <div style={{ fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: C.sub, borderRadius: 8, padding: 11, maxHeight: 240, overflowY: 'auto', marginTop: 6 }}>{c.insight.rawData}</div>
          </details>
        )}
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#34d399', marginBottom: 7 }}>🎯 ข่าวแนวเดียวกัน — คนละคน ({dnaR.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {dnaR.map((r, i) => huntRow(r, kp + '-d' + i))}
            {!dnaR.length && <div style={{ fontSize: 12, color: C.muted }}>ยังไม่เจอที่ผ่านเกณฑ์ — กด &quot;ค้นเพิ่ม&quot; ให้สมองคิดคีย์ชุดใหม่</div>}
          </div>
          {sameR.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#fbbf24', marginBottom: 6 }}>👤 ข่าวคนเดิม/ตามต่อ ({sameR.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, opacity: 0.9 }}>{sameR.map((r, i) => huntRow(r, kp + '-s' + i))}</div>
            </div>
          )}
        </div>
      </div>
    );
  }
}

// ── helper components ──
function Section({ title, open, onToggle, C, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '13px 16px', background: 'transparent', border: 'none', color: C.text, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700 }}>
        <span>{title}</span><span style={{ color: C.muted }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 16px 16px' }}>{children}</div>}
    </div>
  );
}
const ghostBtn = (busy) => ({ padding: '8px 14px', borderRadius: 9, border: '1px solid #374151', background: 'transparent', color: '#9ca3af', fontSize: 12.5, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' });
const tabBtn = (active) => ({ padding: '5px 12px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${active ? '#38bdf8' : '#374151'}`, background: 'transparent', color: active ? '#38bdf8' : '#9ca3af', fontWeight: 600 });
const pageBtn = (disabled, C) => ({ padding: '6px 14px', borderRadius: 8, fontSize: 12.5, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', border: `1px solid ${C.line}`, background: 'transparent', color: disabled ? '#4b5563' : C.text, opacity: disabled ? 0.5 : 1 });
