'use client';
// สตูดิโอเขียนข่าว — หน้าใช้งานของระบบเขียนข่าวตัวใหม่ (10 พ.ย. 69)
//   ต้นแบบปก 33 ใบกำหนดทิศทางข่าว → โพสต์ครู 254 โพสต์เสริมสำนวน → 3 เวอร์ชัน พร้อมผลตรวจทุกด่าน
//   หน้านี้คุย API ใต้ /api/news-studio/* เท่านั้น ไม่แตะท่อเขียนเดิม (/api/auto, /api/queue, /api/summarize)
import { useCallback, useEffect, useRef, useState } from 'react';
import Header from '@/components/layout/Header';
import './studio.css';
import { getJson, streamRun } from './ui/api';
import ComposeTab, { STEP_ORDER } from './ui/ComposeTab';
import ExemplarsTab from './ui/ExemplarsTab';
import TeachersTab from './ui/TeachersTab';
import HistoryTab from './ui/HistoryTab';
import StatusTab from './ui/StatusTab';

const TABS = [
  { id: 'compose', label: 'เขียนข่าว' },
  { id: 'exemplars', label: 'ต้นแบบประเด็น' },
  { id: 'teachers', label: 'คลังครู' },
  { id: 'history', label: 'ประวัติงาน' },
  { id: 'status', label: 'สถานะระบบ' },
];

const ACTIVE_KEY = 'ns_active_run'; // งานที่กำลังเขียนอยู่ — รีเฟรชหน้าแล้วตามผลต่อได้
const ACTIVE_TTL_MS = 12 * 60 * 1000;
const FOLLOW_EVERY_MS = 4000;
const FOLLOW_MAX_MS = 8 * 60 * 1000;

const blankSteps = () => Object.fromEntries(STEP_ORDER.map((id) => [id, { status: 'wait', detail: '' }]));
const idleJob = () => ({ phase: 'idle', steps: blankSteps(), run: null, error: '', errorType: '', startedAt: 0, seconds: null, following: false, notices: [] });

/** สถานะของแต่ละขั้น "ตามผลงานจริง" — ใช้เมื่อได้ผลจากคลังประวัติ (ไม่มีเหตุการณ์สดให้ดู) ห้ามติ๊กว่าสำเร็จทั้งหมดแบบเหมา */
function stepsFromRun(run) {
  const versions = run.versions || [];
  return {
    direction: run.direction?.ok
      ? { status: 'done', detail: `${(run.direction.angles || []).length} ทิศทาง` }
      : { status: 'failed', detail: run.direction?.error || 'กำหนดทิศทางไม่สำเร็จ ระบบเขียนต่อโดยไม่มีทิศทาง' },
    teachers: { status: 'done', detail: `${new Set(versions.map((v) => v.teacher?.id).filter(Boolean)).size} โพสต์` },
    writing: { status: 'done', detail: versions.map((v) => `เวอร์ชัน ${v.index} ${!v.content ? 'เขียนไม่สำเร็จ' : v.ok ? 'ผ่าน' : 'ยังมีจุดต้องดู'}`).join(' · ') },
  };
}

const remember = (id) => { try { localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id, at: Date.now() })); } catch { /* ใช้ไม่ได้ก็ไม่เป็นไร */ } };
const forget = () => { try { localStorage.removeItem(ACTIVE_KEY); } catch { /* เช่นกัน */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function NewsStudioPage() {
  const [tab, setTab] = useState('compose');
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [me, setMe] = useState(null);
  const [form, setForm] = useState({ rawText: '', useResearch: false });
  const [job, setJob] = useState(idleJob);
  const [openId, setOpenId] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);
  const alive = useRef(true);
  const ticket = useRef(0); // งานล่าสุดที่หน้านี้สนใจ — ผลของงานเก่าที่มาทีหลังถูกทิ้ง

  const applyStatus = useCallback((d) => {
    if (!alive.current) return;
    setStatusBusy(false);
    if (d.success) { setStatus(d.status); setMe(d.me); setStatusErr(''); } else setStatusErr(d.error || 'ตรวจสถานะระบบไม่สำเร็จ');
  }, []);
  const loadStatus = useCallback(() => { getJson('/api/news-studio/status').then(applyStatus); }, [applyStatus]);
  const reloadStatus = useCallback(() => { setStatusBusy(true); loadStatus(); }, [loadStatus]);

  const finish = useCallback((my, patch) => {
    if (!alive.current || my !== ticket.current) return;
    forget();
    setJob((j) => {
      const next = { ...j, ...patch, following: false };
      // เวลาที่แสดง = เวลาที่งานใช้จริงตามที่เซิร์ฟเวอร์วัด (ถ้ามีผล) — ไม่ใช่เวลาที่หน้านี้เฝ้ารอ ซึ่งผิดเมื่อกลับมาตามผลทีหลัง
      const measured = next.run?.timings?.total;
      next.seconds = Number.isFinite(measured) ? Math.round(measured / 1000) : (j.startedAt && !j.following ? Math.round((Date.now() - j.startedAt) / 1000) : null);
      // งานจบแบบไม่สำเร็จ: ขั้นที่ค้าง "กำลังทำ" ต้องหยุดหมุน
      if (next.phase === 'error') next.steps = Object.fromEntries(Object.entries(next.steps).map(([id, st]) => [id, st.status === 'start' ? { ...st, status: 'failed', detail: st.detail || 'หยุดก่อนเสร็จ' } : st]));
      return next;
    });
    setHistoryKey((k) => k + 1);
    loadStatus();
  }, [loadStatus]);

  /** ตามผลของงานจากคลังประวัติ (สายสตรีมหลุด หรือรีเฟรชหน้ากลางงาน) */
  const follow = useCallback(async (my, runId) => {
    const until = Date.now() + FOLLOW_MAX_MS;
    let misses = 0;
    while (alive.current && my === ticket.current && Date.now() < until) {
      const d = await getJson(`/api/news-studio/runs/${encodeURIComponent(runId)}`);
      if (!alive.current || my !== ticket.current) return;
      if (d.success) {
        misses = 0;
        if (d.run.status === 'done') return finish(my, { phase: 'done', run: d.run, steps: stepsFromRun(d.run) });
        if (d.run.status === 'failed') return finish(my, { phase: 'error', error: d.run.error || 'งานล้ม', errorType: d.run.errorType || '' });
        if (d.run.status === 'stale') return finish(my, { phase: 'error', error: 'งานเริ่มแล้วแต่ไม่มีผลกลับมาเกิน 12 นาที ระบบน่าจะหยุดกลางทาง ให้ส่งเนื้อดิบเข้าใหม่', errorType: 'RUN_STALE' });
      } else if (++misses >= 5) {
        return finish(my, { phase: 'error', error: `ตามผลงานไม่ได้: ${d.error || 'ไม่ทราบสาเหตุ'} เปิดดูที่แท็บ "ประวัติงาน" อีกครั้งภายหลัง`, errorType: d.errorType || 'FOLLOW_FAILED' });
      }
      await sleep(FOLLOW_EVERY_MS);
    }
    if (alive.current && my === ticket.current) finish(my, { phase: 'error', error: 'รอผลนานเกิน 8 นาที เปิดดูที่แท็บ "ประวัติงาน" อีกครั้งภายหลัง', errorType: 'FOLLOW_TIMEOUT' });
  }, [finish]);

  const start = useCallback(async () => {
    const my = ++ticket.current;
    setJob({ ...idleJob(), phase: 'running', startedAt: Date.now() });
    const onEvent = (e) => {
      if (!alive.current || my !== ticket.current) return;
      if (e.type === 'start') { if (e.saved) remember(e.runId); return; }
      if (e.type === 'warning') { setJob((j) => ({ ...j, notices: [...j.notices, e.message] })); return; }
      if (e.type === 'progress') {
        if (!STEP_ORDER.includes(e.step)) return;
        setJob((j) => {
          const cur = j.steps[e.step] || { status: 'wait', detail: '' };
          // เหตุการณ์ย่อยของขั้นเขียน (เวอร์ชันไหนเสร็จ) = ต่อท้ายรายละเอียด ไม่เปลี่ยนสถานะขั้น
          if (e.status === 'version') return { ...j, steps: { ...j.steps, [e.step]: { ...cur, detail: [cur.detail, e.detail].filter(Boolean).join(' · ') } } };
          const steps = { ...j.steps, [e.step]: { status: e.status, detail: e.status === 'start' ? '' : (e.detail || cur.detail) } };
          return { ...j, steps };
        });
        return;
      }
      if (e.type === 'result') {
        setJob((j) => ({ ...j, steps: { ...j.steps, writing: { status: 'done', detail: j.steps.writing?.detail || '' } } }));
        finish(my, { phase: 'done', run: e.run });
        return;
      }
      if (e.type === 'error') finish(my, { phase: 'error', error: e.error || 'เขียนไม่สำเร็จ', errorType: e.errorType || '' });
    };
    const { ended, runId } = await streamRun({ rawText: form.rawText, useResearch: form.useResearch }, onEvent);
    if (!alive.current || my !== ticket.current) return;
    if (ended !== 'broken') return;
    if (!runId) return finish(my, { phase: 'error', error: 'สายเชื่อมต่อหลุดก่อนงานเริ่ม ให้กดเขียนใหม่', errorType: 'STREAM_BROKEN' });
    setJob((j) => ({ ...j, following: true }));
    follow(my, runId);
  }, [form.rawText, form.useResearch, finish, follow]);

  const clear = useCallback(() => { ticket.current++; forget(); setJob(idleJob()); }, []);

  useEffect(() => {
    alive.current = true;
    getJson('/api/news-studio/status').then(applyStatus);
    // อ่านของที่เบราว์เซอร์จำไว้ "หลัง" หน้าขึ้นแล้ว (อ่านตอนเรนเดอร์แรก = หน้าจากเซิร์ฟเวอร์กับเบราว์เซอร์ไม่ตรงกัน)
    const restore = setTimeout(() => {
      if (!alive.current) return;
      // รีเฟรชหน้ากลางงาน: มีงานค้างที่ยังไม่เกินอายุ → ตามผลต่อ
      try {
        const saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null');
        if (saved?.id && Date.now() - saved.at < ACTIVE_TTL_MS) {
          const my = ++ticket.current;
          setJob({ ...idleJob(), phase: 'running', startedAt: saved.at, following: true });
          follow(my, saved.id);
        } else if (saved) forget();
      } catch { /* ไม่มีของค้าง */ }
      try { const t = sessionStorage.getItem('ns_tab'); if (TABS.some((x) => x.id === t)) setTab(t); } catch { /* ใช้แท็บแรก */ }
    }, 0);
    return () => { alive.current = false; clearTimeout(restore); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickTab = (id) => { setTab(id); try { sessionStorage.setItem('ns_tab', id); } catch { /* ไม่จำก็ได้ */ } };

  return (
    <>
      <Header title="สตูดิโอเขียนข่าว" subtitle="ต้นแบบปกกำหนดทิศทาง · โพสต์ครูเสริมสำนวน · 3 เวอร์ชันพร้อมผลตรวจ" />
      <div className="page-content">
        <div className="ns-page">
          <div className="ns-tabs" role="tablist" aria-label="ส่วนของสตูดิโอเขียนข่าว">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={`ns-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="ns-panel" className="ns-tab" onClick={() => pickTab(t.id)}>
                {t.label}
                {t.id === 'compose' && job.phase === 'running' && <span className="ns-tab-count">กำลังเขียน</span>}
                {t.id === 'exemplars' && status?.libraries?.exemplars?.count ? <span className="ns-tab-count">{status.libraries.exemplars.count}</span> : null}
                {t.id === 'teachers' && status?.libraries?.teachers?.count ? <span className="ns-tab-count">{status.libraries.teachers.count}</span> : null}
                {t.id === 'history' && status?.runs?.ok && status.runs.total ? <span className="ns-tab-count">{status.runs.total}</span> : null}
                {t.id === 'status' && status && !status.ready ? <span className="ns-tab-count">ไม่พร้อม</span> : null}
              </button>
            ))}
          </div>
          <div id="ns-panel" role="tabpanel" aria-labelledby={`ns-tab-${tab}`}>
            {tab === 'compose' && (
              <ComposeTab
                status={status} statusErr={statusErr} onReloadStatus={reloadStatus} me={me} form={form} setForm={setForm} job={job}
                onStart={start} onClear={clear}
                onRunChanged={(run) => { setJob((j) => ({ ...j, run })); setHistoryKey((k) => k + 1); }}
              />
            )}
            {tab === 'exemplars' && <ExemplarsTab />}
            {tab === 'teachers' && <TeachersTab />}
            {tab === 'history' && (
              <HistoryTab
                canWrite={!!me?.canWrite} openId={openId} setOpenId={setOpenId} refreshKey={historyKey}
                // ระหว่างมีงานกำลังเขียน ช่องเนื้อข่าวถูกล็อก จึงยังนำเนื้อดิบเก่าไปวางไม่ได้
                onReuseRaw={job.phase === 'running' ? null : (rawText) => { setForm((f) => ({ ...f, rawText })); pickTab('compose'); }}
              />
            )}
            {tab === 'status' && <StatusTab status={status} statusErr={statusErr} onReload={reloadStatus} busy={statusBusy} />}
          </div>
        </div>
      </div>
    </>
  );
}
