'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import JobBoard from './ui/JobBoard';
import StatsStrip from './ui/StatsStrip';
import InsightCard from './ui/InsightCard';
import { detectLink, platformIcon as platIcon, fmtDurSec, fmtClock, planClipRoute, workerChip, cardView, resultToRec } from './ui/statusMeta';

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
const MY_JOB_KEY = 'clip_my_job';
const MY_JOB_TTL_MS = 6 * 60 * 60 * 1000; // ★ 26 ต.ค. 69 (P20): รีเฟรชหน้าแล้ว "งานของฉัน" ไม่หาย (จำไว้ 6 ชม.)
const UNKNOWN_BACKUP_MS = 2 * 60 * 1000;  // ไม่รู้สถานะเครื่องแอดมินต่อเนื่องเท่านี้ ปุ่มสำรองจึงเปิด (กติกา 27 ส.ค. "คอมดับค่อยกดสำรอง")
const DONE_TITLE = { done: '✅ ถอดเสร็จ', error: '❌ ถอดไม่สำเร็จ' };
// ชื่อแท็บ (P20): บอกว่างานเสร็จตอนผู้ใช้ไปทำอย่างอื่น — แยกไว้นอกคอมโพเนนต์ (กฎ react-hooks ห้ามแก้ค่าภายนอกในตัวคอมโพเนนต์)
function setTabTitle(t) { if (t && typeof document !== 'undefined') document.title = t; }
const tabHidden = () => typeof document !== 'undefined' && document.hidden;

export default function ClipTranscriptPage() {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');       // กล่องแดง = ข้อผิดพลาดจริงเท่านั้น
  const [notice, setNotice] = useState('');  // กล่องฟ้า = แจ้งข่าวดี/สถานะ (แยกจาก err — แก้บั๊กเดิมที่ปนกัน)

  // ผู้ใช้ (เดิมไม่มี UI ตั้งค่า — ช่อง 👤 ในคลังเลยว่าง)
  const [currentUser, setCurrentUser] = useState('');
  const [editUser, setEditUser] = useState(false);

  // ถอดประเด็น
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightCases, setInsightCases] = useState([]);
  const [insightTotal, setInsightTotal] = useState(0);
  const [insightOffset, setInsightOffset] = useState(0);
  const [insightOpen, setInsightOpen] = useState(false); // พับ default (พิมพ์เขียวข้อ 8 ลดรก)
  const [insightExpanded, setInsightExpanded] = useState(null); // เคสที่กางอยู่ในคลัง (ทีละใบ)
  const [copied, setCopied] = useState('');

  // คิวเครื่องทีม
  const [queueJob, setQueueJob] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [queueList, setQueueList] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // เวลาที่เริ่ม "ไม่รู้สถานะเครื่องแอดมิน" (ไม่มีชีพจร/อ่านคิวไม่ได้) · 0 = รู้สถานะ — ใช้หน่วงก่อนเปิดปุ่มสำรอง
  const [unknownSince, setUnknownSince] = useState(0);

  // ไฟ Gemini
  const [gem, setGem] = useState(null);

  // refs กัน polling รั่วหลัง unmount (แก้บั๊ก setInterval/pollJob เดิมไม่มี cleanup)
  const aliveRef = useRef(true);
  // ★ 26 ต.ค. 69 (P12): ลูปติดตามผูกกับเลขงาน — ส่งงานใหม่แล้วลูปเก่าเลิกเอง ไม่เขียนทับการ์ดงานใหม่
  const activeJobRef = useRef(null);
  const baseTitleRef = useRef('');
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; activeJobRef.current = null; }; }, []);

  const link = useMemo(() => detectLink(url), [url]);

  const loadInsightCases = async (offset = insightOffset) => {
    try {
      const r = await fetch(`/api/clip-transcript/cases?kind=insight&limit=${PAGE_SIZE}&offset=${offset}`, { cache: 'no-store' });
      const d = await r.json();
      if (!aliveRef.current) return;                       // UI-02: กันอัปเดตหลังปิดหน้า
      if (d.success) { setInsightCases(d.cases || []); if (typeof d.total === 'number') setInsightTotal(d.total); }
    } catch {}
  };
  const loadQueueList = async () => {
    let known = false;
    try {
      const r = await fetch('/api/clip-transcript/queue-list', { cache: 'no-store' });
      const d = await r.json();
      if (!aliveRef.current) return;
      if (d.success) { setQueueList(d); known = !!d.worker?.known; }
    } catch {}
    // ★ ผู้ตรวจอิสระรอบ 2: อ่านคิวไม่ได้ หรือไม่มีชีพจร = ไม่รู้สถานะ (ไม่ใช้ภาพเก่าที่บอกว่าเครื่องพร้อม)
    if (aliveRef.current) setUnknownSince((p) => (known ? 0 : p || Date.now()));
  };

  useEffect(() => {
    // อ่านชื่อผู้ใช้หลัง mount เท่านั้น (localStorage ไม่มีตอน render ฝั่งเซิร์ฟเวอร์ — อ่านตอน render จะทำให้ hydration เพี้ยน)
    const saved = (typeof window !== 'undefined' && localStorage.getItem('clip_user')) || '';
    if (saved) queueMicrotask(() => { if (aliveRef.current) setCurrentUser(saved); });
    baseTitleRef.current = document.title;
    const restoreTitle = () => setTabTitle(baseTitleRef.current);
    window.addEventListener('focus', restoreTitle);
    loadInsightCases(0); loadQueueList();
    const qTimer = setInterval(loadQueueList, 10000);
    return () => { clearInterval(qTimer); window.removeEventListener('focus', restoreTitle); };
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

  // นาฬิกาวินาที — เดินเฉพาะตอนมีงานรอนับถอยหลัง หรืองานของฉันกำลังถอด (★ P13: เดิม "ถอดมาแล้ว" ไม่เดิน)
  useEffect(() => {
    const needClock = (queueJob && (queueJob.status === 'retry_wait' || queueJob.status === 'processing')) ||
      (queueList && queueList.active && queueList.active.some(j => j.status === 'retry_wait')) ||
      unknownSince > 0; // นับเวลาไม่รู้สถานะเครื่อง เพื่อเปิดปุ่มสำรองเมื่อครบ 2 นาที
    if (!needClock) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [queueJob, queueList, unknownSince]);

  const saveUser = (v) => {
    const name = String(v || '').trim().slice(0, 40);
    setCurrentUser(name);
    try { localStorage.setItem('clip_user', name); } catch {}
    setEditUser(false);
  };

  const platformIcon = (p) => platIcon(p);

  // signature (key, text) — ตรงกับสัญญา onCopy(key,text) ของ InsightCard (แก้บั๊ก UI-01 คัดลอกกลับด้าน)
  // ★ 26 ต.ค. 69: ขึ้น ✓ เฉพาะเมื่อคัดลอกสำเร็จจริง (เดิมขึ้นเสมอแม้เบราว์เซอร์ปฏิเสธ — พนักงานวางแล้วได้ของเก่า)
  const copy = (key, text) => {
    const fail = () => setErr('คัดลอกอัตโนมัติไม่สำเร็จ — ลากเลือกข้อความในเนื้อข่าวแล้วกด Ctrl+C');
    const p = navigator.clipboard?.writeText(text);
    if (!p) { fail(); return; }
    p.then(() => { if (!aliveRef.current) return; setCopied(key); setTimeout(() => setCopied(''), 2000); }, fail);
  };

  // ── กลไก API ──
  // ★ 26 ต.ค. 69: เลิกโหมดถอดบทสัมภาษณ์ + ค้นข่าวคล้าย/วิจัยลิงก์ข่าว (เจ้าของเคาะ) — เหลือถอดคลิปเป็นเนื้อข่าวช่องเดียวอย่างเดียว
  // ★ P20: ต้องมีชื่อผู้ส่งก่อน (คลังเดิม 361/400 ใบ "ไม่ระบุชื่อ") — ตั้งครั้งเดียว จำไว้ในเครื่อง
  const needUser = () => {
    if (currentUser) return false;
    setErr('ตั้งชื่อผู้ใช้ก่อนส่งงาน (ช่อง 👤 มุมขวาบน) — ชื่อจะติดไปกับงานในคลัง ตั้งครั้งเดียวเครื่องจำไว้');
    setEditUser(true);
    return true;
  };

  const extractInsight = async (force = false, targetUrl = null, opts = {}) => {
    const target = (targetUrl != null ? targetUrl : url).trim();  // UI-03: รับ URL ตรง กันใช้ state เก่าตอน "ถอดใหม่" จากคลัง
    if (!target) { setErr('วางลิงก์คลิปก่อน'); return; }
    if (needUser()) return;
    if (targetUrl != null) setUrl(target);
    // 🔴 ผู้ตรวจอิสระรอบ 2: ไม่แตะการ์ด/ลูปของงานในคิว — ถอดสำรองล้มแล้วงานในคิวยังติดตามต่อได้
    setInsightLoading(true); setErr(''); setNotice(opts.notice || ''); setInsight(null);
    try {
      const r = await fetch('/api/clip-transcript/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target, force: !!force, user: currentUser }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (d.success) { setInsight({ ...resultToRec(d.data, target), _from: 'backup' }); loadInsightCases(0); setInsightOffset(0); }
      else if (/Gemini มีคนใช้งานหนัก|แน่นชั่วคราว|503|overload/i.test(String(d.error || ''))) {
        setNotice('⏳ ตอนนี้ Gemini แน่น ถอดทันทีไม่ผ่าน — กด "ส่งเข้าคิว" ให้เครื่องทีมลองเมื่อรับงาน (ปิดหน้าได้ ถ้าล้มระบบจะไม่วนถอดซ้ำอัตโนมัติ)');
      }
      else setErr(d.error || 'ถอดคลิปไม่สำเร็จ');
    } catch (e) { if (aliveRef.current) setErr(e.message); }
    if (aliveRef.current) setInsightLoading(false);
  };

  const rememberJob = (jobId, jobUrl) => {
    try { localStorage.setItem(MY_JOB_KEY, JSON.stringify({ jobId, url: jobUrl, at: Date.now() })); } catch {}
  };
  const markTitle = (status) => {
    if (DONE_TITLE[status] && tabHidden()) setTabTitle(`${DONE_TITLE[status]} · ${baseTitleRef.current || 'ระบบถอดคลิป'}`);
  };

  const submitToQueue = async (forceUrl = null, force = false, opts = {}) => {
    const target = (forceUrl || url).trim();
    if (!target) { setErr('วางลิงก์คลิปก่อน'); return; }
    if (needUser()) return;
    setSubmitting(true); setErr(''); setNotice('');
    try {
      const r = await fetch('/api/clip-transcript/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target, kind: 'insight', user: currentUser, force: !!force }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      // 🔴 ผู้ตรวจอิสระ 26 ต.ค.: ส่งไม่สำเร็จต้องไม่ทำการ์ด/ลูปของงานที่กำลังถอดอยู่หาย — ล้างเฉพาะหลังส่งสำเร็จ
      if (!d.success) { setErr(d.error || 'ส่งเข้าคิวไม่สำเร็จ'); setSubmitting(false); return; }
      setTabTitle(baseTitleRef.current);
      // ★ P13: ข้อความแจ้ง (เช่น "เครื่องแอดมินดับ") ตั้งหลังส่งสำเร็จ — เดิมตั้งก่อนแล้วถูกล้างทันทีจนไม่เคยขึ้น
      if (d.dup) setNotice('คลิปนี้อยู่ในคิวอยู่แล้ว — ติดตามสถานะได้ที่บอร์ดงานด้านล่าง');
      else if (opts.notice) setNotice(opts.notice);
      setQueueJob({ jobId: d.jobId, status: d.status || 'pending', position: d.position, platform: d.platform, url: target });
      rememberJob(d.jobId, target);
      loadQueueList();
      pollJob(d.jobId, target);
    } catch (e) { if (aliveRef.current) setErr(e.message); }
    if (aliveRef.current) setSubmitting(false);
  };

  /**
   * ติดตามงาน 1 ใบจนจบ — ★ 26 ต.ค. 69 (P12)
   *   · ผูกกับเลขงาน: มีงานใหม่มาแทน (activeJobRef เปลี่ยน) = ลูปนี้เลิกเอง
   *   · อ่านพลาด (ฐานสะดุด 503/เน็ตหลุด) ไม่ใช่งานล้ม — ติดตามต่อ พลาด 3 ครั้งติดค่อยเตือนว่าเชื่อมต่อไม่ได้
   *   · "ไม่พบงาน" (404) ติดกัน 2 ครั้งจึงถือว่าใบหายจริง
   *   · ตั๋วต่อการเรียก: เรียกซ้ำด้วยเลขงานเดิม (ส่งลิงก์ซ้ำได้ dup) ลูปเก่าเลิก ไม่ยิงซ้อนสองลูป
   */
  const pollJob = async (jobId, jobUrl = '') => {
    const ticket = { jobId };
    activeJobRef.current = ticket;
    const mine = () => aliveRef.current && activeJobRef.current === ticket;
    const patch = (p) => setQueueJob(j => (j && j.jobId === jobId ? { ...j, ...p } : j));
    let fails = 0, notFound = 0;
    for (let i = 0; i < 2000; i++) {
      if (!mine()) return;
      let st = 'pending';
      try {
        const r = await fetch('/api/clip-transcript/job-status?id=' + encodeURIComponent(jobId), { cache: 'no-store' });
        const d = await safeJson(r);
        if (!mine()) return;
        if (d.success) {
          fails = 0; notFound = 0; st = d.status;
          setQueueJob({ jobId, status: d.status, position: d.position, platform: d.platform, error: d.error, statusNote: d.statusNote, lastError: d.lastError, attempts: d.attempts, nextRetryAt: d.nextRetryAt, startedAt: d.startedAt, url: jobUrl, connWarn: false });
          if (d.status === 'done') {
            // การ์ดของคลิปอื่นที่ผู้ใช้เปิดดูอยู่ (ถอดสำรอง/กดดูผล) ไม่ถูกผลงานคิวทับ (ผลงานคิวกด "ดูผล" ได้จากการ์ดงานของฉัน/คลัง)
            setInsight((cur) => (cur?._from && cur.url !== jobUrl ? cur : resultToRec(d.result, jobUrl)));
            loadInsightCases(0); markTitle('done'); return;
          }
          if (d.status === 'error' || d.status === 'cancelled') { markTitle(d.status === 'error' ? 'error' : ''); return; }
        } else if (r.status === 404 && ++notFound >= 2) {
          patch({ status: 'error', error: d.error || 'ไม่พบงานในคิว (อาจถูกล้าง — ส่งใหม่ได้)' });
          try { localStorage.removeItem(MY_JOB_KEY); } catch {}
          return;
        } else if (r.status !== 404 && ++fails >= 3) patch({ connWarn: true });
      } catch { if (++fails >= 3) patch({ connWarn: true }); }
      await new Promise(res => setTimeout(res, st === 'retry_wait' ? 15000 : fails >= 3 ? 10000 : 4000));
    }
    if (mine()) patch({ _pollEnded: true });
  };

  // ★ P20: งานที่ส่งไว้ก่อนรีเฟรช — ติดตามต่อ (เสร็จแล้วก็ได้ผลกลับมาแสดง) · อ่าน localStorage หลัง mount เท่านั้น
  useEffect(() => {
    try {
      const mine = JSON.parse(localStorage.getItem(MY_JOB_KEY) || 'null');
      if (mine?.jobId && Date.now() - (Number(mine.at) || 0) < MY_JOB_TTL_MS) {
        queueMicrotask(() => {
          if (!aliveRef.current) return;
          setQueueJob({ jobId: mine.jobId, status: 'pending', url: mine.url || '' });
          pollJob(mine.jobId, mine.url || '');
        });
      } else if (mine) localStorage.removeItem(MY_JOB_KEY);
    } catch {}
  }, []);

  // ── handlers ให้ JobBoard ──
  const onCancel = async (jobId, status) => {
    try {
      const r = await fetch('/api/clip-transcript/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: jobId }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (d.success) setQueueJob(j => (j && j.jobId === jobId ? { ...j, status: 'cancelled' } : j));
      if (!d.success) setErr(d.error || 'ยกเลิกไม่สำเร็จ');
      // ★ P13: งานที่เครื่องกำลังถอด หยุดกลางทางไม่ได้ — บอกตามจริง
      else if ((d.previousStatus || status) === 'processing') setNotice('🚫 ยกเลิกแล้ว — เครื่องกำลังถอดรอบนี้อยู่จึงทำต่อจนจบ (ผลอาจยังเข้าคลัง) แต่จะไม่ลองใหม่อีก');
      else setNotice('🚫 ยกเลิกงานแล้ว — ออกจากคิว ยังไม่เสียค่าถอด');
    } catch (e) { if (aliveRef.current) setErr(e.message); }
    loadQueueList();
  };
  const onRetry = (job) => { if (job?.url) submitToQueue(job.url, true); };
  const onViewResult = async (job) => {
    try {
      const r = await fetch('/api/clip-transcript/job-status?id=' + encodeURIComponent(job.jobId || job.id), { cache: 'no-store' });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (d.success && d.result) { setInsight({ ...resultToRec(d.result, job.url), _from: 'view' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else setNotice('งานนี้ยังไม่มีผลให้แสดง');
    } catch (e) { if (aliveRef.current) setErr(e.message); }
  };
  // ยืนยันการลบอยู่ในการ์ดแล้ว (เดิมถามซ้ำสองชั้น)
  const deleteInsightCase = async (id) => {
    try {
      const r = await fetch('/api/clip-transcript/cases?kind=insight&id=' + encodeURIComponent(id), { method: 'DELETE' });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (d.success) setNotice('🗑️ ลบใบนี้ออกจากคลังแล้ว');
      else setErr(d.error || 'ลบไม่สำเร็จ');
    } catch (e) { if (aliveRef.current) setErr(e.message); }
    loadInsightCases();
  };
  // ★ P10: เดิมส่งไม่ระบุคลัง → ไปหาในคลังบทสัมภาษณ์ ได้ 404 แล้วกลืนเงียบ ใบที่ตั้งใจปักจึงไม่ถูกกันลบ
  const pinInsightCase = async (id, chosen) => {
    try {
      const r = await fetch('/api/clip-transcript/cases?kind=insight', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, chosen }) });
      const d = await safeJson(r);
      if (!aliveRef.current) return;
      if (!d.success) setErr(d.error || 'ปักหมุดไม่สำเร็จ');
      else setNotice(d.warning || (chosen ? '📌 ปักใบนี้แล้ว — ส่งลิงก์เดิมจะได้ใบนี้คืน และไม่ถูกลบตอนล้างคลัง' : 'ปลดปักแล้ว'));
    } catch (e) { if (aliveRef.current) setErr(e.message); }
    loadInsightCases();
  };
  const gotoPage = (offset) => { const o = Math.max(0, offset); setInsightOffset(o); loadInsightCases(o); };

  const busy = insightLoading;
  // ★★ 27 ส.ค. 69 (เจ้าของสั่ง — ทับกติกา 26 ส.ค.):
  //    "บังคับรันในเครื่องทีมเท่านั้น เหลือ 2 ปุ่มพอ · ถ้าคอมฉันดับ ค่อยกดปุ่มสำรอง (Vercel)"
  //    🔴 เลิกสลับไปคลาวด์อัตโนมัติ — ปุ่มหลักไปเครื่องแอดมินเสมอ · คลาวด์ต้องกดเอง
  const worker = queueList?.worker;
  // ★ P13: "ไม่ทราบสถานะ" ไม่ใช่ "ดับ" — ส่ง null ให้ตรรกะกลางแยกเอง
  //   ไม่รู้ต่อเนื่องเกิน 2 นาที (UNKNOWN_BACKUP_MS) จึงเปิดปุ่มสำรอง — ตอนหน้าเพิ่งโหลด/ชีพจรสะดุดแวบเดียวยังปิด
  const workerKnown = !unknownSince && !!worker?.known;
  const route = planClipRoute(url, workerKnown ? !!worker.alive : null, { unknownLong: unknownSince > 0 && nowMs - unknownSince >= UNKNOWN_BACKUP_MS });
  const machineDown = route.mode === 'queue-offline' || route.mode === 'queue-blocked';
  const wchip = workerChip(unknownSince ? null : worker); // อ่านคิวไม่ได้ = ชิปบอก "ไม่ทราบสถานะ" ไม่ค้างภาพเก่า

  /** ปุ่ม 1 — ทางหลัก: เข้าคิวเครื่องแอดมินเสมอ */
  const runPrimary = () => {
    if (!url.trim()) { setErr('วางลิงก์คลิปก่อน'); return; }
    if (!route.primary.enabled) { setErr(route.primary.why); return; }
    return submitToQueue(null, false, machineDown
      ? { notice: '🔴 เครื่องแอดมินดับอยู่ — ส่งเข้าคิวไว้แล้ว เปิดเครื่องเมื่อไหร่จะถอดให้เองทันที (งานไม่หาย)' } : {});
  };
  /** ปุ่ม 2 — สำรอง: ต้องกดเอง และกดได้เฉพาะตอนเครื่องแอดมินดับจริง */
  const runBackup = () => {
    if (!route.backup.enabled) return;
    return extractInsight(false, null, { notice: '☁️ ถอดสำรองบน Vercel — เครื่องยนต์เดียวกับเครื่องแอดมิน แต่คลิปยาวอาจดูไม่ครบ เช็ค "จุดที่ควรเช็ค" ก่อนใช้' });
  };
  const primaryLabel = () => {
    if (submitting) return '⏳ กำลังส่ง…';
    return route.primary.label;
  };

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
            {/* 🖥️ สถานะเครื่องทีม — ตัวชี้ว่าปุ่มหลักจะไปทางไหน */}
            <span title={worker?.lastSeenAt ? `แตะชีพจรล่าสุด ${fmtClock(worker.lastSeenAt)}` : 'ยังไม่เคยได้รับชีพจรจากเครื่องทีม'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, border: `1px solid ${C.line}`, background: C.sub, fontSize: 12.5, color: wchip.color }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: wchip.dot, boxShadow: `0 0 6px ${wchip.dot}` }} />
              {wchip.text}
            </span>
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
          วางลิงก์คลิป (YouTube / TikTok / Facebook / IG) → ได้พาดหัว + เนื้อข่าวครบทุกประเด็นในช่องเดียว พร้อมจุดที่ควรเช็ค · แยกจากระบบทำข่าว 100%
        </p>

        {/* โซน 1 — งานใหม่ */}
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
              <input value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !busy && !submitting) runPrimary(); }}
                placeholder="วางลิงก์ที่นี่…"
                style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.sub, color: C.text, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              {link.label && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11.5, color: C.muted, background: C.card, padding: '2px 8px', borderRadius: 999, border: `1px solid ${C.line}` }}>{link.label}</span>}
            </div>
            {/* ปุ่ม 1 — ทางหลัก: เครื่องแอดมินเสมอ */}
            <button onClick={runPrimary} disabled={busy || submitting || !route.primary.enabled} data-testid="btn-primary" title={route.primary.why}
              style={{ padding: '12px 22px', borderRadius: 10, border: 'none', background: (busy || submitting || !route.primary.enabled) ? '#334155' : (machineDown ? '#f59e0b' : C.accent), color: (busy || submitting || !route.primary.enabled) ? C.muted : '#04263b', fontWeight: 800, fontSize: 14, cursor: (busy || submitting) ? 'wait' : !route.primary.enabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              {primaryLabel()}
            </button>
          </div>

          {/* ปุ่ม 2 — สำรองบน Vercel: กดได้เฉพาะตอนเครื่องแอดมินดับ (ไม่มีการสลับอัตโนมัติ) */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <button onClick={runBackup} data-testid="btn-backup"
              disabled={busy || submitting || !route.backup.enabled}
              title={route.backup.why}
              style={{
                padding: '9px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                border: `1px solid ${route.backup.enabled ? '#f59e0b' : C.line}`,
                background: 'transparent',
                color: route.backup.enabled ? '#fbbf24' : C.muted,
                cursor: (busy || submitting || !route.backup.enabled) ? 'not-allowed' : 'pointer',
                opacity: route.backup.enabled ? 1 : .55,
              }}>
              {insightLoading ? '⏳ กำลังถอดสำรอง…' : route.backup.label}
            </button>
          </div>

          {/* บอกล่วงหน้าว่าลิงก์นี้จะไปทางไหน — พนักงานไม่ต้องเดา */}
          {url.trim() && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 12, color: (machineDown || !route.primary.enabled) ? '#fbbf24' : C.muted }}>
                {!route.primary.enabled ? '⚠️' : machineDown ? '⏳' : '🖥️'} {route.primary.why}
              </div>
              <div style={{ fontSize: 12, color: route.backup.enabled ? '#fbbf24' : C.muted }}>
                ☁️ {route.backup.why}
              </div>
            </div>
          )}

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
        {insightLoading && <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, marginBottom: 16, textAlign: 'center', color: C.muted, fontSize: 13.5 }}>⏳ Gemini กำลังดูคลิปและเขียนเนื้อข่าว…</div>}
        {insight && (
          <div style={{ marginBottom: 16 }}>
            <InsightCard
              rec={insight}
              live
              copiedKey={copied}
              onCopy={copy}
              onRetry={(u) => submitToQueue(u, true)}
            />
          </div>
        )}

        {/* คลังผลถอดคลิป (พับ default) */}
        <Section title={`📚 คลังผลถอดคลิป${insightTotal ? ` (${insightTotal})` : ''}`} open={insightOpen} onToggle={() => setInsightOpen(o => !o)} C={C}>
          {insightCases.length === 0 && <div style={{ fontSize: 13, color: C.muted, padding: '4px 2px' }}>ยังไม่มีใบในคลัง</div>}
          {/* ★ 26 ส.ค. 69 (เจ้าของแจ้ง): เดิมกางเต็มทุกใบเรียงลงมา เลื่อนหายาก → เป็นลิสต์สั้นให้กดเลือกก่อน กางทีละใบ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insightCases.map(rec => {
              const open = insightExpanded === rec.id;
              const cv = cardView(rec);
              return (
                <div key={rec.id} style={{ border: `1px solid ${open ? C.accent + '66' : C.line}`, borderRadius: 10, overflow: 'hidden' }}>
                  <button
                    onClick={() => setInsightExpanded(open ? null : rec.id)}
                    style={{ width: '100%', textAlign: 'left', padding: '11px 13px', background: open ? 'rgba(56,189,248,.06)' : 'transparent', border: 'none', color: C.text, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', gap: 10, alignItems: 'flex-start' }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.5, display: 'block', overflowWrap: 'anywhere' }}>
                        {platformIcon(rec.platform)} {cv.headline}
                      </span>
                      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 5, fontSize: 11.5, color: C.muted }}>
                        {rec.clipDurationSec > 0 && <span>⏱️ {fmtDurSec(rec.clipDurationSec)}</span>}
                        <span>🕒 {fmtClock(rec.createdAt)}</span>
                        {rec.user && <span>👤 {rec.user}</span>}
                        {cv.checks.length > 0 && <span style={{ color: '#fbbf24' }}>🔎 เช็ค {cv.checks.length} จุด</span>}
                        {rec.lowQuality && <span style={{ color: '#f59e0b' }}>⚠️ ไม่สมบูรณ์</span>}
                        {rec.chosen && <span style={{ color: '#fbbf24' }}>📌 ปักไว้</span>}
                        {cv.legacy && <span>ใบรุ่นเก่า</span>}
                      </span>
                    </span>
                    <span style={{ color: C.muted, flexShrink: 0, fontSize: 12 }}>{open ? '▲ ย่อ' : '▼ เปิด'}</span>
                  </button>
                  {open && (
                    <div style={{ padding: '0 13px 13px' }}>
                      <InsightCard rec={rec} copiedKey={copied}
                        onCopy={copy} onDelete={deleteInsightCase} onPin={pinInsightCase} onRetry={(u) => submitToQueue(u, true)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {insightTotal > PAGE_SIZE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 14 }}>
              <button onClick={() => gotoPage(insightOffset - PAGE_SIZE)} disabled={insightOffset <= 0} style={pageBtn(insightOffset <= 0, C)}>‹ ก่อนหน้า</button>
              <span style={{ fontSize: 12.5, color: C.muted }}>{Math.floor(insightOffset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(insightTotal / PAGE_SIZE))}</span>
              <button onClick={() => gotoPage(insightOffset + PAGE_SIZE)} disabled={insightOffset + PAGE_SIZE >= insightTotal} style={pageBtn(insightOffset + PAGE_SIZE >= insightTotal, C)}>ถัดไป ›</button>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
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
const pageBtn = (disabled, C) => ({ padding: '6px 14px', borderRadius: 8, fontSize: 12.5, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', border: `1px solid ${C.line}`, background: 'transparent', color: disabled ? '#4b5563' : C.text, opacity: disabled ? 0.5 : 1 });
