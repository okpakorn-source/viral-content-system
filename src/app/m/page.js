'use client';
// 📱 /m — ViralFlow Mobile (26 ก.ค. 69): หน้ามือถือเต็มจอ ต่อระบบจริงทุกเส้น
//   ส่งข่าว → /api/queue/add (คิวเดียวกับบอทดิสคอร์ด) · ถอดคลิป → /api/clip-transcript/* (คิว+คลังร่วมกับเว็บ)
//   สกัดเนื้อ → /api/news-filter/* · ผลงาน → /api/generation-logs — ไม่แตะไฟล์ระบบเขียนข่าวที่ล็อก
//   ★ รอบสมาชิก (เจ้าของสั่ง): ตัวตนจาก session จริง (เลิกพิมพ์ชื่อ) + สมุดใช้งาน /api/usage + จอโปรไฟล์/ทีม/สร้างยูส
import { useState, useEffect, useRef, useCallback } from 'react';

const CSS = `
:root{--bg:#F7F5F7;--panel:#FFFFFF;--card:#F1EEF3;--line:#E6E1E8;--line2:#D8D1DB;--ink:#1C1522;--sub:#655C6E;--mut:#9C93A6;--pink:#E5136E;--pinkD:#B80E58;--pinkS:#FBE3EE;--onp:#fff;--ok:#0E8A5F;--okS:#DFF2E9;--warn:#95660D;--warnS:#F8ECD2;--glow:rgba(229,19,110,.13)}
@media(prefers-color-scheme:dark){:root{--bg:#0D0E13;--panel:#14161D;--card:#1B1E27;--line:#272B37;--line2:#333848;--ink:#F1F2F7;--sub:#A6ABB9;--mut:#6E7383;--pink:#FF2D8A;--pinkD:#D11670;--pinkS:#3A1226;--onp:#fff;--ok:#3DDC97;--okS:#0F2E22;--warn:#FFC24B;--warnS:#332609;--glow:rgba(255,45,138,.20)}}
*{box-sizing:border-box;margin:0;-webkit-tap-highlight-color:transparent;min-width:0}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
html,body{background:var(--bg)!important;color:var(--ink);width:100%;max-width:100%;overflow-x:hidden;overscroll-behavior-x:none}
.vf{min-height:100dvh;width:100%;max-width:560px;margin:0 auto;overflow-x:clip;font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans Thai","Sarabun","Leelawadee UI",sans-serif;font-variant-numeric:tabular-nums;padding-bottom:86px;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}
.hdr{display:flex;align-items:center;gap:9px;padding:14px 16px 10px;position:sticky;top:0;background:var(--bg);z-index:5}
.mk{width:30px;height:30px;border-radius:9px;background:var(--pink);color:var(--onp);display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px var(--glow);font-weight:800}
.hname{font-weight:800;font-size:16px;letter-spacing:-.01em;flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.livepill{margin-left:auto;flex:none;font-size:11px;font-weight:700;color:var(--pink);border:1px solid var(--pink);border-radius:99px;padding:3px 10px;letter-spacing:.05em;display:flex;align-items:center;gap:6px;white-space:nowrap}
.dotb{width:6px;height:6px;border-radius:50%;background:var(--pink);animation:bl 1.2s infinite}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.25}}
@media(prefers-reduced-motion:reduce){.dotb{animation:none}}
.meBtn{width:34px;height:34px;border-radius:11px;background:var(--pinkS);color:var(--pink);border:1.5px solid var(--pink);font-size:14px;font-weight:800;font-family:inherit;cursor:pointer;flex:none}
.wrap{padding:6px 16px 16px}
h1{font-size:22px;font-weight:800;letter-spacing:-.02em;margin:4px 0 3px}
.sub{font-size:13px;color:var(--sub);margin-bottom:13px}
h2{font-size:12px;font-weight:700;color:var(--mut);letter-spacing:.09em;margin:18px 0 8px}
.compose{background:var(--card);border:1.5px solid var(--line);border-radius:18px;padding:13px;margin-bottom:11px}
.compose:focus-within{border-color:var(--pink);box-shadow:0 0 0 3px var(--glow)}
.ta{width:100%;min-height:120px;background:transparent;border:0;font-family:inherit;font-size:16px;line-height:1.65;color:var(--ink);resize:vertical}
.ta:focus{outline:none}.ta::placeholder{color:var(--mut)}
.in{width:100%;background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:12px 14px;font-family:inherit;font-size:16px;color:var(--ink)}
.in:focus{outline:none;border-color:var(--pink);box-shadow:0 0 0 3px var(--glow)}
.cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--pink);color:var(--onp);border:0;border-radius:15px;padding:15px;font-size:16px;font-weight:800;font-family:inherit;cursor:pointer;box-shadow:0 6px 20px var(--glow)}
.cta:disabled{opacity:.5;box-shadow:none}
.cta:active{transform:scale(.98)}
.gh{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;background:none;border:1.5px solid var(--line2);color:var(--ink);border-radius:13px;padding:11px;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer}
.gh:active{transform:scale(.98)}
.row{display:flex;gap:8px}
.job{display:flex;align-items:center;gap:11px;background:var(--card);border:1px solid var(--line);border-radius:15px;padding:11px 13px;margin-bottom:8px;cursor:pointer}
.job:active{transform:scale(.988)}
.ava{width:34px;height:34px;border-radius:11px;background:var(--pinkS);color:var(--pink);font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
.tt{font-size:13.5px;font-weight:600;line-height:1.4}
.mm{font-size:11.5px;color:var(--mut);margin-top:1px}
.right{margin-left:auto;flex:none}
.chip{font-size:11px;font-weight:700;padding:4px 10px;border-radius:99px;white-space:nowrap}
.cok{background:var(--okS);color:var(--ok)}.cwr{background:var(--warnS);color:var(--warn)}.cmu{border:1px solid var(--line2);color:var(--mut)}.cpk{background:var(--pinkS);color:var(--pink)}
.tabs{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;background:var(--panel);border-top:1px solid var(--line);z-index:9;padding:6px 8px calc(10px + env(safe-area-inset-bottom))}
.tabsin{display:flex;gap:4px;width:100%;max-width:560px}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;background:none;border:0;border-radius:12px;padding:7px 0 5px;font-family:inherit;font-size:10.5px;font-weight:700;color:var(--mut);cursor:pointer}
.tab.on{color:var(--pink);background:var(--pinkS)}
.tab svg{width:21px;height:21px}
.tl{position:relative;padding-left:28px;margin-top:8px}
.tl:before{content:"";position:absolute;left:9px;top:8px;bottom:12px;width:2px;background:var(--line2)}
.ts{position:relative;padding:9px 0 13px}
.nd{position:absolute;left:-28px;top:10px;width:20px;height:20px;border-radius:50%;background:var(--panel);border:2px solid var(--line2);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--ok)}
.ts.done .nd{border-color:var(--ok);background:var(--okS)}
.ts.run .nd{border-color:var(--pink)}
.ts.run .nd:after{content:"";width:7px;height:7px;border-radius:50%;background:var(--pink);animation:bl 1s infinite}
.th{font-size:14.5px;font-weight:700}.ts.run .th{color:var(--pink)}
.td{font-size:12px;color:var(--mut);margin-top:1px}
.timer{font-size:36px;font-weight:800;letter-spacing:-.03em}
.hint{background:var(--pinkS);border-radius:14px;padding:11px 14px;margin-top:10px;font-size:13px;color:var(--pink);font-weight:600}
.seg{display:flex;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:4px;margin-bottom:11px;overflow-x:auto}
.seg button{flex:1;border:0;background:none;border-radius:10px;padding:9px 6px;font-family:inherit;font-size:13px;font-weight:700;color:var(--mut);cursor:pointer;white-space:nowrap}
.seg button.on{background:var(--pink);color:var(--onp)}
.reader{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:15px}
.bd{font-size:14.5px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere}
.ft{display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--line2);padding-top:10px;margin-top:10px}
.topic{display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--line);background:var(--card);border-radius:15px;padding:12px 13px;margin-bottom:8px;cursor:pointer}
.topic .num{width:24px;height:24px;border-radius:8px;background:var(--panel);border:1px solid var(--line2);color:var(--mut);font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
.topic.sel{border-color:var(--pink);background:var(--pinkS)}
.topic.sel .num{background:var(--pink);border-color:var(--pink);color:var(--onp)}
.tx{font-size:13.5px;font-weight:600;line-height:1.5}
.du{font-size:11px;color:var(--mut);margin-top:2px}
.err{background:var(--warnS);color:var(--warn);border-radius:13px;padding:11px 14px;font-size:13px;font-weight:600;margin:9px 0}
.toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:var(--ink);color:var(--panel);font-size:13px;font-weight:600;padding:10px 20px;border-radius:18px;z-index:99;box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:calc(100vw - 40px);text-align:center}
.evrow span{overflow-wrap:anywhere}
details.raw summary{font-size:12px;color:var(--mut);cursor:pointer;margin-top:8px}
details.raw div{font-size:12.5px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px;max-height:220px;overflow-y:auto;margin-top:6px}
a.lnk{color:var(--pink);font-weight:700;text-decoration:none;font-size:13px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:11px 13px}
.stat .l{font-size:11px;color:var(--mut);font-weight:700}
.stat b{display:block;font-size:21px;font-weight:800;margin-top:1px}
.evrow{display:flex;gap:9px;font-size:12.5px;padding:8px 2px;border-bottom:1px solid var(--line)}
.evrow .t{color:var(--mut);flex:none;width:78px;font-size:11px;padding-top:2px}
`;

const IC = {
  send: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  clip: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>,
  lib: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>,
  fil: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
};

const fmtTime = (iso) => { try { const d = new Date(iso); return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const EV_LABEL = {
  app_open: '🔑 เปิดแอพ', submit_news: '📨 ส่งข่าวเข้าคิว', job_done: '✅ ข่าวเสร็จ', job_failed: '❌ งานล้ม',
  clip_submit: '🎬 ส่งคลิปเข้าคิวถอด', clip_done: '🎬 ถอดคลิปเสร็จ', filter_run: '🧃 สกัดเนื้อ', split_run: '🔀 แยกประเด็น',
  send_topic: '📌 ส่งประเด็นเข้าเขียน', copy_version: '📋 คัดลอกเวอร์ชัน', regen: '🔁 สั่งเจนใหม่', view_case: '📖 เปิดอ่านเคส',
};
const evText = (e) => {
  const m = e.meta || {};
  let x = EV_LABEL[e.action] || e.action;
  if (e.action === 'job_done' && m.secs) x += ` ${m.secs} วิ`;
  if (e.action === 'job_done' && m.promptScore) x += ` · การ์ด ${m.promptScore}`;
  if (e.action === 'clip_done' && m.topics) x += ` (${m.topics} ประเด็น)`;
  if (e.action === 'filter_run') x += ` (${m.mode || ''}${m.removed != null ? ` · ตัด ${m.removed}%` : ''})`;
  if (e.refId) x += ` · ${String(e.refId).slice(0, 12)}`;
  return x;
};

export default function MobileApp() {
  const [tab, setTab] = useState('write');
  const [toast, setToast] = useState('');
  const [ov, setOv] = useState(null);

  // ── สมาชิก (session จริง) ──
  const [member, setMember] = useState(null);     // {id,username,displayName,role,avatar}
  const [sessChecked, setSessChecked] = useState(false);
  const me = member?.username || 'guest';
  const isAdmin = member?.role === 'admin';

  // ── โปรไฟล์/ทีม ──
  const [meStats, setMeStats] = useState(null);
  const [team, setTeam] = useState(null);
  const [teamSel, setTeamSel] = useState(null);   // {userKey, events}
  const [nu, setNu] = useState({ username: '', displayName: '', password: '', role: 'editor' });
  const [nuBusy, setNuBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [showRates, setShowRates] = useState(false);

  // ── ส่งข่าว ──
  const [text, setText] = useState('');
  const [phase, setPhase] = useState('idle');
  const [jobId, setJobId] = useState('');
  const [pos, setPos] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [vIdx, setVIdx] = useState(0);
  const [errMsg, setErrMsg] = useState('');
  const pollRef = useRef(null);
  const t0Ref = useRef(0);

  // ── ถอดคลิป ──
  const [clipUrl, setClipUrl] = useState('');
  const [clipPhase, setClipPhase] = useState('idle');
  const [clipPos, setClipPos] = useState(0);
  const [insight, setInsight] = useState(null);
  const [selTopics, setSelTopics] = useState([]);
  const [clipErr, setClipErr] = useState('');
  const [insightCases, setInsightCases] = useState([]);
  const clipPollRef = useRef(null);

  // ── สกัดเนื้อหา ──
  const [nfUrl, setNfUrl] = useState('');
  const [nfText, setNfText] = useState('');
  const [nfMode, setNfMode] = useState('balanced');
  const [nfAI, setNfAI] = useState(true);
  const [nfBusy, setNfBusy] = useState('');
  const [nfOut, setNfOut] = useState(null);
  const [nfSplit, setNfSplit] = useState(null);
  const [nfErr, setNfErr] = useState('');

  // ── ผลงาน ──
  const [cases, setCases] = useState([]);
  const [caseDetail, setCaseDetail] = useState(null);
  const [caseLoading, setCaseLoading] = useState(false);

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };

  // 📓 สมุดใช้งาน — fire-and-forget (พังเงียบ ไม่กวนงานจริง)
  const log = useCallback((action, refId = '', meta = {}) => {
    try { fetch('/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, refId, meta }) }).catch(() => {}); } catch {}
  }, []);

  useEffect(() => {
    fetch('/api/auth', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (d.loggedIn && d.member) { setMember(d.member); }
      setSessChecked(true);
    }).catch(() => setSessChecked(true));
    fetch('/api/queue/status').then(r => r.json()).then(setOv).catch(() => {});
    const iv = setInterval(() => fetch('/api/queue/status').then(r => r.json()).then(setOv).catch(() => {}), 30000);
    return () => { clearInterval(iv); clearInterval(pollRef.current); clearInterval(clipPollRef.current); };
  }, []);
  useEffect(() => { if (member) log('app_open'); }, [member, log]);

  const loadCases = useCallback(() => {
    fetch('/api/generation-logs?limit=30', { cache: 'no-store' }).then(r => r.json())
      .then(d => setCases(d.cases || [])).catch(() => {});
  }, []);
  const loadInsightCases = useCallback(() => {
    fetch('/api/clip-transcript/cases?kind=insight&limit=20', { cache: 'no-store' }).then(r => r.json())
      .then(d => setInsightCases(d.cases || [])).catch(() => {});
  }, []);
  const loadMe = useCallback(() => {
    fetch('/api/usage?view=me', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d.success) setMeStats(d); }).catch(() => {});
  }, []);
  const loadTeam = useCallback(() => {
    fetch('/api/usage?view=team', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d.success) setTeam(d); }).catch(() => {});
  }, []);
  const loadReport = useCallback(() => {
    fetch('/api/usage?view=report', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d.success) setReport(d); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (tab === 'works') loadCases();
    if (tab === 'clip') loadInsightCases();
    if (tab === 'me') { loadMe(); if (isAdmin) { loadTeam(); loadReport(); } }
  }, [tab, isAdmin, loadCases, loadInsightCases, loadMe, loadTeam, loadReport]);

  // ═══ ส่งเข้าคิวเขียนจริง ═══
  const submitNews = async (input, { forceNew = false, source = 'text' } = {}) => {
    const body = (forceNew ? 'ทำใหม่ ' : '') + input.trim();
    if (body.replace('ทำใหม่ ', '').length < 60) { say('เนื้อสั้นเกินไป — ขอความยาวสักหน่อย'); return; }
    setErrMsg(''); setResult(null); setPhase('queued'); setPos(0); setElapsed(0); setTab('write');
    t0Ref.current = Date.now();
    try {
      const r = await fetch('/api/queue/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: body, contentLength: 'short', userId: 'mobile-' + me }),
      });
      const d = await r.json();
      if (!d.success) {
        if (d.errorType === 'NEAR_DUPLICATE') { setPhase('neardup'); setErrMsg(d.error || 'ข่าวนี้เพิ่งถูกทำไป'); return; }
        throw new Error(d.error || 'เข้าคิวไม่สำเร็จ');
      }
      setJobId(d.jobId);
      log(forceNew ? 'regen' : 'submit_news', d.jobId, { source });
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        setElapsed(Math.floor((Date.now() - t0Ref.current) / 1000));
        try {
          const st = await (await fetch('/api/queue/status?id=' + d.jobId, { cache: 'no-store' })).json();
          if (!st.success) return;
          if (st.status === 'pending') { setPhase('queued'); setPos(st.queuesAhead || 0); }
          else if (st.status === 'processing') setPhase('processing');
          else if (st.status === 'completed') {
            clearInterval(pollRef.current);
            const data = st.result?.data || st.result || {};
            const secs = Math.floor((Date.now() - t0Ref.current) / 1000);
            const pr = data.usedPromptInfo || null;
            setResult({
              title: data.newsData?.newsTitle || st.result?.newsData?.newsTitle || '',
              versions: data.analysisResult?.versions || st.result?.analysisResult?.versions || [],
              prompt: pr, research: (data.researchItems || []).length,
              caseId: data.caseId || st.result?.caseId || null, secs,
            });
            setVIdx(0); setPhase('done'); say('ข่าวเสร็จแล้ว');
            log('job_done', d.jobId, { secs, promptScore: pr?.matchScore ?? null });
          } else if (st.status === 'failed') {
            clearInterval(pollRef.current); setPhase('error'); setErrMsg(st.error || 'งานล้มเหลว');
            log('job_failed', d.jobId, {});
          }
        } catch {}
      }, 3000);
    } catch (e) { setPhase('error'); setErrMsg(String(e.message || e)); }
  };

  // ═══ ถอดคลิป ═══
  const startClip = async () => {
    const u = clipUrl.trim();
    if (!/^https?:\/\//i.test(u)) { say('วางลิงก์คลิปก่อน (TikTok / YouTube / FB)'); return; }
    setClipErr(''); setInsight(null); setSelTopics([]); setClipPhase('queued'); setClipPos(0);
    try {
      const r = await fetch('/api/clip-transcript/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u, kind: 'insight', user: 'mobile-' + me }),
      });
      const d = await r.json();
      if (!d.success || !d.jobId) throw new Error(d.error || 'ส่งเข้าคิวคลิปไม่สำเร็จ');
      log('clip_submit', d.jobId, {});
      clearInterval(clipPollRef.current);
      let tries = 0;
      clipPollRef.current = setInterval(async () => {
        tries++;
        try {
          const st = await (await fetch('/api/clip-transcript/job-status?id=' + d.jobId, { cache: 'no-store' })).json();
          if (st.status === 'pending') { setClipPhase('queued'); setClipPos(st.position || 0); }
          else if (st.status === 'processing') setClipPhase('processing');
          else if (st.status === 'done') {
            clearInterval(clipPollRef.current);
            setInsight(st.result || {}); setClipPhase('done'); loadInsightCases(); say('ถอดเสร็จ — เลือกประเด็นได้เลย');
            log('clip_done', d.jobId, { topics: insightTopics(st.result || {}).length });
          } else if (st.status === 'error') { clearInterval(clipPollRef.current); setClipPhase('error'); setClipErr(st.error || 'ถอดไม่สำเร็จ'); }
          if (tries > 200) { clearInterval(clipPollRef.current); setClipPhase('error'); setClipErr('งานยังทำอยู่เบื้องหลัง — เสร็จแล้วจะโผล่ในคลังถอดประเด็นด้านล่าง'); }
        } catch {}
      }, 4000);
    } catch (e) { setClipPhase('error'); setClipErr(String(e.message || e)); }
  };

  const insightTopics = (ins) => {
    if (!ins) return [];
    if (ins.subStories?.length) return ins.subStories.map((s, i) => ({ topic: s.topic, time: s.timeRange, raw: s.rawData, quotes: s.quotes, no: s.no || i + 1 }));
    if (ins.topics?.length) return ins.topics.map((t, i) => ({ topic: t.topic || t.title, time: t.timeRange, raw: t.rawData || t.detail || '', no: t.no || i + 1 }));
    return [{ topic: ins.headline || ins.overview || 'ประเด็นจากคลิป', time: '', raw: ins.rawData || '', no: 1 }];
  };

  const sendTopicsToWrite = () => {
    const tps = insightTopics(insight).filter((_, i) => selTopics.includes(i));
    if (!tps.length) { say('เลือกอย่างน้อย 1 ประเด็นก่อน'); return; }
    const input = tps.map(t =>
      `${t.topic}${t.time ? ` (ช่วง ${t.time})` : ''}\n\n${t.raw || ''}${t.quotes?.length ? '\n\nคำพูดจากคลิป:\n' + t.quotes.map(q => `"${q}"`).join('\n') : ''}`
    ).join('\n\n———\n\n');
    log('send_topic', '', { from: 'clip', count: tps.length });
    submitNews(input, { source: 'clip' });
  };

  // ═══ สกัดเนื้อหา ═══
  const nfScrape = async () => {
    const u = nfUrl.trim();
    if (!/^https?:\/\//i.test(u)) { say('วางลิงก์ข่าวก่อน'); return; }
    setNfBusy('scrape'); setNfErr('');
    try {
      const d = await (await fetch('/api/news-filter/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: u }) })).json();
      if (!d.success) throw new Error(d.error || 'ดึงเนื้อไม่สำเร็จ');
      setNfText((d.data?.title ? d.data.title + '\n\n' : '') + (d.data?.text || ''));
      say('ดึงเนื้อจากลิงก์แล้ว — กดสกัดต่อได้เลย');
    } catch (e) { setNfErr(String(e.message || e)); }
    setNfBusy('');
  };
  const nfRun = async () => {
    if (nfText.trim().length < 80) { say('วางเนื้อข่าวก่อน (ยาวสักหน่อย)'); return; }
    setNfBusy('filter'); setNfErr(''); setNfOut(null); setNfSplit(null);
    try {
      const d = await (await fetch('/api/news-filter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: nfText, mode: nfMode, useAI: nfAI, user: 'mobile-' + me }),
      })).json();
      if (!d.success) throw new Error(d.error || 'สกัดไม่สำเร็จ');
      setNfOut(d.data); say('สกัดเสร็จ — ตัดไป ' + (d.data?.removedPercent ?? '?') + '%');
      log('filter_run', '', { mode: nfMode, ai: nfAI, removed: d.data?.removedPercent ?? null });
    } catch (e) { setNfErr(String(e.message || e)); }
    setNfBusy('');
  };
  const nfDoSplit = async () => {
    if (!nfOut?.cleanText) return;
    setNfBusy('split'); setNfErr('');
    try {
      const d = await (await fetch('/api/news-filter/split', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: nfOut.cleanText }) })).json();
      if (!d.success) throw new Error(d.error || 'แยกประเด็นไม่สำเร็จ');
      setNfSplit(d.data);
      log('split_run', '', { topics: d.data?.topics?.length || 0 });
      say(d.data?.isSingleTopic ? 'ข่าวนี้เป็นประเด็นเดียว' : 'แยกได้ ' + (d.data?.topics?.length || 0) + ' ประเด็น');
    } catch (e) { setNfErr(String(e.message || e)); }
    setNfBusy('');
  };

  const openCase = async (id) => {
    setCaseLoading(true); setCaseDetail(null);
    try {
      const d = await (await fetch('/api/generation-logs/' + id, { cache: 'no-store' })).json();
      setCaseDetail(d.case || d.data || d);
      log('view_case', String(id), {});
    } catch { say('เปิดเคสไม่สำเร็จ'); }
    setCaseLoading(false);
  };

  const copyText = async (t, refId = '') => {
    try { await navigator.clipboard.writeText(t); say('คัดลอกแล้ว — พร้อมไปโพสต์'); log('copy_version', refId, { len: (t || '').length }); }
    catch { say('คัดลอกไม่ได้ — กดค้างที่ข้อความแทน'); }
  };
  const pasteClip = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { setText(t); say('วางจากคลิปบอร์ดแล้ว'); } }
    catch { say('เบราว์เซอร์ไม่ให้อ่านคลิปบอร์ด — แตะกล่องแล้ววางเอง'); }
  };

  const createUser = async () => {
    if (!nu.username.trim() || !nu.password.trim() || !nu.displayName.trim()) { say('กรอก ชื่อผู้ใช้ / ชื่อแสดง / รหัสผ่าน ให้ครบ'); return; }
    setNuBusy(true);
    try {
      const d = await (await fetch('/api/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', username: nu.username.trim(), password: nu.password, displayName: nu.displayName.trim(), role: nu.role }),
      })).json();
      if (!d.success) throw new Error(d.error || 'สร้างไม่สำเร็จ');
      say('สร้างยูส "' + nu.displayName + '" แล้ว'); setNu({ username: '', displayName: '', password: '', role: 'editor' }); loadTeam();
    } catch (e) { say('❌ ' + String(e.message || e)); }
    setNuBusy(false);
  };
  const openMemberHistory = async (userKey) => {
    try {
      const d = await (await fetch('/api/usage?view=history&userKey=' + encodeURIComponent(userKey) + '&limit=80', { cache: 'no-store' })).json();
      if (d.success) setTeamSel({ userKey, events: d.events || [] });
    } catch {}
  };

  const V = result?.versions || [];
  const cur = V[vIdx] || null;

  // จอกันเหนียว: ยังไม่ล็อกอิน (ปกติเว็บพาไปหน้า login เองอยู่แล้ว)
  if (sessChecked && !member) {
    return (<div className="vf"><style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap" style={{ paddingTop: 80, textAlign: 'center' }}>
        <div className="mk" style={{ margin: '0 auto 12px', width: 52, height: 52, fontSize: 24 }}>⚡</div>
        <h1>ViralFlow</h1>
        <p className="sub">ต้องล็อกอินด้วยยูสพนักงานก่อนใช้งาน</p>
        <a className="cta" style={{ textDecoration: 'none', maxWidth: 260, margin: '0 auto' }} href="/login?next=/m">ไปหน้าล็อกอิน</a>
      </div></div>);
  }

  return (
    <div className="vf">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="hdr">
        <span className="mk">⚡</span><span className="hname">ViralFlow</span>
        <span className="livepill"><span className="dotb" />{ov ? (ov.busy || ov.processing > 0 ? `คิวทำงาน ${ov.processing}` : 'คิวว่าง') : 'LIVE'}</span>
        <button className="meBtn" aria-label="โปรไฟล์ของฉัน" onClick={() => setTab('me')}>{(member?.displayName || '?').slice(0, 1)}</button>
      </div>

      {/* ═══ แท็บ ส่งข่าว ═══ */}
      {tab === 'write' && <div className="wrap">
        {phase === 'idle' || phase === 'neardup' || phase === 'error' ? <>
          <h1>ส่งข่าว</h1>
          <p className="sub">ส่งในชื่อ <b style={{ color: 'var(--pink)' }}>{member?.displayName || '…'}</b> · เข้าคิวเดียวกับบอทดิสคอร์ด</p>
          <div className="compose">
            <textarea className="ta" value={text} onChange={e => setText(e.target.value)} placeholder="วางเนื้อข่าวเต็มตรงนี้… (ระบบจะเขียนให้ 2 เวอร์ชัน 2 มุมเล่า)" />
            <div className="row" style={{ marginTop: 9 }}>
              <button className="gh" onClick={pasteClip}>วางจากคลิปบอร์ด</button>
              <button className="gh" onClick={() => setTab('clip')}>จากคลิป</button>
            </div>
          </div>
          {phase === 'neardup' && <div className="err">{errMsg}<button className="gh" style={{ marginTop: 9 }} onClick={() => submitNews(text, { forceNew: true })}>ยืนยันทำใหม่ (ข้ามด่านกันซ้ำ)</button></div>}
          {phase === 'error' && <div className="err">❌ {errMsg}</div>}
          <button className="cta" onClick={() => submitNews(text)}>สร้างข่าว 2 เวอร์ชัน — เข้าคิวจริง</button>
        </> : null}

        {(phase === 'queued' || phase === 'processing') && <>
          <h1>กำลังทำข่าว</h1>
          <p className="timer">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</p>
          <p className="sub">{phase === 'queued' ? (pos > 0 ? `รอคิว — มี ${pos} งานข้างหน้า` : 'เข้าคิวแล้ว กำลังเริ่ม…') : 'กำลังเขียน · ปกติ ~2-3 นาที'}</p>
          <div className="tl">
            <div className={'ts ' + (phase === 'processing' ? 'done' : 'run')}><span className="nd">{phase === 'processing' ? '✓' : ''}</span><p className="th">เข้าคิวเซิร์ฟเวอร์</p><p className="td">job {String(jobId).slice(0, 10)}</p></div>
            <div className={'ts ' + (phase === 'processing' ? 'run' : '')}><span className="nd" /><p className="th">สกัด → แตกประเด็น → จับคู่การ์ด → เขียน 2 เวอร์ชัน</p><p className="td">ท่อเดียวกับบอทดิสคอร์ดทุกขั้น</p></div>
            <div className="ts"><span className="nd" /><p className="th">เกลาสำนวน + ด่านตรวจ + เข้าคลังผลงาน</p><p className="td">เสร็จแล้วเปิดดูย้อนหลังได้ในแท็บผลงาน</p></div>
          </div>
          <div className="hint">ปิดหน้านี้ได้ — งานวิ่งบนเซิร์ฟเวอร์ กลับมาดูในแท็บ "ผลงาน" ได้เสมอ</div>
        </>}

        {phase === 'done' && result && <>
          <h1>ข่าวเสร็จแล้ว · {result.secs} วิ</h1>
          <p className="sub">{result.title || 'อ่านเทียบแล้วเลือกเวอร์ชันที่ใช่'}</p>
          {V.length > 1 && <div className="seg">{V.map((v, i) => <button key={i} className={i === vIdx ? 'on' : ''} onClick={() => setVIdx(i)}>เวอร์ชัน {i + 1}{v._sourceLabel ? ` · ${String(v._sourceLabel).slice(0, 14)}` : ''}</button>)}</div>}
          {cur && <div className="reader">
            {cur.title && <p style={{ fontWeight: 800, fontSize: 15.5, marginBottom: 9 }}>{cur.title}</p>}
            <div className="bd">{cur.content || cur.text || ''}</div>
            <div className="ft">
              {result.prompt?.promptName && <span className="chip cpk">การ์ด: {String(result.prompt.promptName).slice(0, 26)}</span>}
              {typeof result.prompt?.matchScore === 'number' && <span className="chip cpk">{result.prompt.matchType || ''} {result.prompt.matchScore}</span>}
              {result.research > 0 && <span className="chip cmu">รีเสิร์ช {result.research} แหล่ง</span>}
              <span className="chip cmu">{(cur.content || '').length} ตัวอักษร</span>
            </div>
          </div>}
          <div className="row" style={{ margin: '11px 0 9px' }}>
            <button className="gh" onClick={() => copyText(cur?.content || '', result.caseId || jobId)}>คัดลอกเวอร์ชันนี้</button>
            <button className="gh" onClick={() => submitNews(text || cur?.content || '', { forceNew: true })}>เจนใหม่</button>
          </div>
          <button className="cta" onClick={() => { setPhase('idle'); setText(''); }}>ส่งข่าวเรื่องถัดไป</button>
        </>}
      </div>}

      {/* ═══ แท็บ ถอดคลิป ═══ */}
      {tab === 'clip' && <div className="wrap">
        <h1>ถอดประเด็นจากคลิป</h1>
        <p className="sub">ระบบเดียวกับหน้าเว็บ /clip-transcript — เข้าคิวคลิปจริง คลังเดียวกัน</p>
        <input className="in" value={clipUrl} onChange={e => setClipUrl(e.target.value)} placeholder="วางลิงก์ TikTok / YouTube / Facebook…" inputMode="url" />
        <button className="cta" style={{ marginTop: 9 }} disabled={clipPhase === 'queued' || clipPhase === 'processing'} onClick={startClip}>
          {clipPhase === 'queued' ? (clipPos > 0 ? `รอคิวคลิป — ข้างหน้า ${clipPos} งาน…` : 'เข้าคิวแล้ว รอเริ่ม…') : clipPhase === 'processing' ? 'กำลังถอดเสียง + แตกประเด็น…' : 'ถอดเสียง + แตกประเด็น'}
        </button>
        {clipErr && <div className="err">{clipErr}</div>}

        {clipPhase === 'done' && insight && <>
          <h2>เจอ {insightTopics(insight).length} ประเด็น — แตะเลือกแล้วส่งเขียน</h2>
          {insight.category && <p className="sub" style={{ marginBottom: 8 }}>หมวด: {insight.category}{insight.engine ? ` · ${String(insight.engine).includes('gemini-video') ? 'Gemini ดูคลิป' : 'จากบทถอดเสียง'}` : ''}</p>}
          {insightTopics(insight).map((t, i) => (
            <div key={i} className={'topic' + (selTopics.includes(i) ? ' sel' : '')} onClick={() => setSelTopics(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i])}>
              <span className="num">{t.no}</span>
              <div><p className="tx">{t.topic}</p>{t.time && <p className="du">ช่วง {t.time}</p>}
                {t.raw && <details className="raw" onClick={e => e.stopPropagation()}><summary>เนื้อดิบ ({t.raw.length} ตัวอักษร)</summary><div>{t.raw}</div></details>}
              </div>
            </div>
          ))}
          <button className="cta" style={{ marginTop: 6 }} onClick={sendTopicsToWrite}>ส่งประเด็นที่เลือกเข้าเขียนข่าว</button>
        </>}

        <h2>คลังถอดประเด็น (ล่าสุด — คลังเดียวกับเว็บ)</h2>
        {insightCases.length === 0 && <p className="sub">ยังไม่มี / กำลังโหลด…</p>}
        {insightCases.slice(0, 10).map(c => (
          <div key={c.id} className="job" onClick={() => { setInsight(c.insight || {}); setSelTopics([]); setClipPhase('done'); window.scrollTo({ top: 0 }); }}>
            <span className="ava">▶</span>
            <div style={{ overflow: 'hidden' }}><p className="tt" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title || c.url}</p><p className="mm">{fmtTime(c.createdAt)}{c.insight?.category ? ` · ${c.insight.category}` : ''}</p></div>
            <span className="right chip cmu">หยิบใช้</span>
          </div>
        ))}
      </div>}

      {/* ═══ แท็บ สกัดเนื้อ ═══ */}
      {tab === 'filter' && <div className="wrap">
        <h1>สกัดเนื้อหา</h1>
        <p className="sub">ตัดคำฟุ่มเฟือย/อารมณ์เกิน เหลือแก่นข่าว — ระบบเดียวกับหน้า /news-filter</p>
        <div className="row" style={{ marginBottom: 9 }}>
          <input className="in" value={nfUrl} onChange={e => setNfUrl(e.target.value)} placeholder="วางลิงก์ข่าว (ไม่บังคับ)…" inputMode="url" />
          <button className="gh" style={{ width: 'auto', flex: 'none', padding: '0 16px' }} disabled={nfBusy === 'scrape'} onClick={nfScrape}>{nfBusy === 'scrape' ? 'กำลังดึง…' : 'ดึงเนื้อ'}</button>
        </div>
        <div className="compose">
          <textarea className="ta" value={nfText} onChange={e => setNfText(e.target.value)} placeholder="หรือวางเนื้อข่าวดิบตรงนี้…" />
        </div>
        <div className="seg">
          {[['soft', 'เบา'], ['balanced', 'สมดุล'], ['strict', 'เข้ม']].map(([k, l]) => <button key={k} className={nfMode === k ? 'on' : ''} onClick={() => setNfMode(k)}>{l}</button>)}
          <button className={nfAI ? 'on' : ''} onClick={() => setNfAI(a => !a)}>{nfAI ? 'AI วิเคราะห์' : 'กฎล้วน'}</button>
        </div>
        {nfErr && <div className="err">{nfErr}</div>}
        <button className="cta" disabled={nfBusy === 'filter'} onClick={nfRun}>{nfBusy === 'filter' ? 'กำลังสกัด…' : 'สกัดแก่นข่าว'}</button>

        {nfOut && <>
          <h2>แก่นข่าวที่สกัดได้</h2>
          <div className="reader">
            <div className="bd">{nfOut.cleanText}</div>
            <div className="ft">
              <span className="chip cpk">{nfOut.originalWordCount} → {nfOut.cleanWordCount} คำ</span>
              <span className="chip cpk">ตัดไป {nfOut.removedPercent}%</span>
              <span className="chip cmu">{nfOut.useAI ? 'AI' : 'กฎ'} · {nfOut.mode}</span>
            </div>
          </div>
          <div className="row" style={{ margin: '10px 0 8px' }}>
            <button className="gh" onClick={() => copyText(nfOut.cleanText)}>คัดลอก</button>
            <button className="gh" disabled={nfBusy === 'split'} onClick={nfDoSplit}>{nfBusy === 'split' ? 'กำลังแยก…' : 'แยกประเด็นย่อย'}</button>
          </div>
          <button className="cta" onClick={() => submitNews(nfOut.cleanText, { source: 'filter' })}>ส่งแก่นข่าวเข้าเขียน — เข้าคิวจริง</button>
        </>}

        {nfSplit?.topics?.length > 0 && <>
          <h2>{nfSplit.isSingleTopic ? 'ประเด็นเดียว' : `แยกได้ ${nfSplit.topics.length} ประเด็น — ส่งเจนทีละประเด็น`}</h2>
          {nfSplit.overview && <p className="sub">{nfSplit.overview}</p>}
          {nfSplit.topics.map((t, i) => (
            <div key={t.id || i} className="topic" style={{ cursor: 'default' }}>
              <span className="num">{t.emoji || i + 1}</span>
              <div style={{ flex: 1 }}>
                <p className="tx">{t.title}</p>
                <p className="du">{t.category || ''}{t.wordCount ? ` · ${t.wordCount} คำ` : ''}{t.viralAngle ? ` · มุมไวรัล: ${t.viralAngle}` : ''}</p>
                {t.summary && <p className="du" style={{ marginTop: 3 }}>{t.summary}</p>}
                {t.content && <details className="raw"><summary>เนื้อประเด็นนี้ ({t.content.length} ตัวอักษร)</summary><div>{t.content}</div></details>}
                <button className="gh" style={{ width: 'auto', padding: '6px 16px', fontSize: 12.5, marginTop: 8 }} onClick={() => { log('send_topic', '', { from: 'filter' }); submitNews((t.title ? t.title + '\n\n' : '') + (t.content || t.summary || ''), { source: 'filter-topic' }); }}>ส่งประเด็นนี้เข้าเขียน</button>
              </div>
            </div>
          ))}
        </>}
      </div>}

      {/* ═══ แท็บ ผลงาน ═══ */}
      {tab === 'works' && <div className="wrap">
        {!caseDetail && !caseLoading && <>
          <h1>ผลงานที่เขียนแล้ว</h1>
          <p className="sub">คลังเดียวกับดิสคอร์ด/เว็บ — แตะเพื่ออ่านเต็ม · รวม {cases.length} เคสล่าสุด</p>
          {cases.map(c => (
            <div key={c.caseId || c.id} className="job" onClick={() => openCase(c.caseId || c.id)}>
              <span className="ava">{String(c.userId || 'ท').replace('discord-', '').replace('mobile-', '').slice(0, 1)}</span>
              <div style={{ overflow: 'hidden' }}><p className="tt" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.newsTitle || '(ไม่มีหัวข้อ)'}</p><p className="mm">#{c.caseId} · {fmtTime(c.createdAt || c.created_at)}</p></div>
              <span className="right chip cok">เปิด</span>
            </div>
          ))}
        </>}
        {caseLoading && <p className="sub" style={{ marginTop: 30, textAlign: 'center' }}>กำลังเปิดเคส…</p>}
        {caseDetail && <>
          <button className="gh" style={{ width: 'auto', padding: '7px 16px', marginBottom: 10 }} onClick={() => setCaseDetail(null)}>← กลับรายการ</button>
          <h1 style={{ fontSize: 18 }}>{caseDetail.newsTitle || '#' + caseDetail.caseId}</h1>
          <p className="sub">#{caseDetail.caseId} · {fmtTime(caseDetail.createdAt)} · <a className="lnk" href={'/generation-logs/' + caseDetail.caseId} target="_blank" rel="noreferrer">เปิดหน้าเต็มบนเว็บ ↗</a></p>
          {(caseDetail.versions || []).map((v, i) => (
            <div key={i} className="reader" style={{ marginBottom: 10 }}>
              <p style={{ fontWeight: 800, fontSize: 14, marginBottom: 8, color: 'var(--pink)' }}>เวอร์ชัน {i + 1}{v._sourceLabel ? ` · ${v._sourceLabel}` : ''}</p>
              {v.title && <p style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 8 }}>{v.title}</p>}
              <div className="bd">{v.content || ''}</div>
              <div className="ft">
                <span className="chip cmu">{(v.content || '').length} ตัวอักษร</span>
                <button className="gh" style={{ width: 'auto', padding: '5px 14px', fontSize: 12.5 }} onClick={() => copyText(v.content || '', caseDetail.caseId)}>คัดลอก</button>
              </div>
            </div>
          ))}
          {caseDetail.pipelineInfo?.promptName && <p className="sub">การ์ดที่ใช้: {caseDetail.pipelineInfo.promptName} · {caseDetail.pipelineInfo.promptMatchType} {caseDetail.pipelineInfo.promptScore}</p>}
        </>}
      </div>}

      {/* ═══ จอ โปรไฟล์/ทีม (เข้าจากปุ่มอวตารมุมขวาบน) ═══ */}
      {tab === 'me' && <div className="wrap">
        <button className="gh" style={{ width: 'auto', padding: '7px 16px', marginBottom: 12 }} onClick={() => { setTab('write'); setTeamSel(null); }}>← กลับ</button>
        {!teamSel && <>
          <div style={{ display: 'flex', gap: 11, alignItems: 'center', marginBottom: 12 }}>
            <span className="ava" style={{ width: 46, height: 46, fontSize: 18, borderRadius: 14 }}>{(member?.displayName || '?').slice(0, 1)}</span>
            <div><h1 style={{ fontSize: 19, margin: 0 }}>{member?.displayName}</h1><p className="mm">@{member?.username} · {isAdmin ? 'แอดมิน' : 'พนักงาน'}</p></div>
          </div>
          {meStats?.stats ? <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="stat"><span className="l">วันนี้ส่ง</span><b>{meStats.stats.today.submits} งาน</b></div>
              <div className="stat"><span className="l">วันนี้เสร็จ/ล้ม</span><b>{meStats.stats.today.done}/{meStats.stats.today.failed}</b></div>
              <div className="stat"><span className="l">7 วันส่ง</span><b>{meStats.stats.week.submits} งาน</b></div>
              <div className="stat"><span className="l">เวลาเฉลี่ย</span><b>{meStats.stats.avgSecs ? meStats.stats.avgSecs + ' วิ' : '—'}</b></div>
            </div>
            <div className="reader" style={{ padding: '10px 13px', marginBottom: 8 }}>
              <p style={{ fontSize: 12.5 }}>7 วัน: ถอดคลิป {meStats.stats.week.clips} · สกัดเนื้อ {meStats.stats.week.filters} · ส่งประเด็น {meStats.stats.week.topics} · คัดลอก {meStats.stats.week.copies} · เจนใหม่ {meStats.stats.week.regens}</p>
              <p style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 4 }}>ผลงานสะสมในคลัง (ช่องทางมือถือ): {meStats.stats.allTimeJobs} เคส</p>
            </div>
            <h2>ประวัติล่าสุดของฉัน</h2>
            {(meStats.recent || []).length === 0 && <p className="sub">ยังไม่มีเหตุการณ์ — เริ่มนับตั้งแต่ติดตั้งสมุดวันนี้</p>}
            {(meStats.recent || []).map(e => <div key={e.id} className="evrow"><span className="t">{fmtTime(e.at)}</span><span>{evText(e)}</span></div>)}
          </> : <p className="sub">กำลังโหลดสถิติ…</p>}

          {isAdmin && <>
            <h2>📊 รีพอร์ตการใช้งาน & ต้นทุน (เฉพาะแอดมิน · 30 วัน)</h2>
            {!report && <p className="sub">กำลังโหลดรีพอร์ต…</p>}
            {report && <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div className="stat"><span className="l">ต้นทุนรวมทั้งระบบ (ประมาณ)</span><b>฿{(report.totalThb || 0).toLocaleString()}</b></div>
                <div className="stat"><span className="l">อัตราแลก</span><b>{report.thbRate} ฿/$</b></div>
              </div>
              <div className="reader" style={{ padding: '10px 13px', marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)', marginBottom: 6 }}>แยกตามช่องทาง (งานข่าว 30 วัน)</p>
                {(report.channels || []).map(c => <p key={c.channel} style={{ fontSize: 12.5, marginBottom: 3 }}>{c.channel}: {c.jobs} งาน ≈ ฿{c.estThb.toLocaleString()}</p>)}
              </div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)', margin: '10px 0 6px' }}>รายยูส (แอพ) — ใช้อะไรบ้าง เป็นเงินเท่าไหร่</p>
              {(report.users || []).length === 0 && <p className="sub">ยังไม่มีเหตุการณ์จากยูสแอพ — เริ่มนับตั้งแต่ติดตั้งสมุด</p>}
              {(report.users || []).map(u => (
                <div key={u.username} className="job" onClick={() => openMemberHistory(u.username)}>
                  <span className="ava">{(u.displayName || '?').slice(0, 1)}</span>
                  <div><p className="tt">{u.displayName} <span style={{ color: 'var(--pink)' }}>฿{u.estThb.toLocaleString()}</span></p>
                    <p className="mm">ข่าว {u.d30.jobs} · คลิป {u.d30.clips} · สกัด AI {u.d30.filtersAI} · แยกประเด็น {u.d30.splits} · คัดลอก {u.d30.copies}</p></div>
                  <span className="right chip cmu">ประวัติ</span>
                </div>
              ))}
              <button className="gh" style={{ marginBottom: 6 }} onClick={() => setShowRates(v => !v)}>{showRates ? 'ซ่อนเรตการ์ด' : 'ดูเรตการ์ด (สูตรคิดเงิน — โปร่งใสตรวจได้)'}</button>
              {showRates && <div className="reader" style={{ padding: '10px 13px', marginBottom: 8 }}>
                {Object.values(report.rates || {}).map((r, i) => <p key={i} style={{ fontSize: 12, marginBottom: 4 }}><b>฿{r.thb}</b> / {r.label} — <span style={{ color: 'var(--mut)' }}>{r.note}</span></p>)}
                {report.realLogged && <p style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 6 }}>บิลที่บันทึกได้จริงล่าสุด ({report.realLogged.calls} calls): {Object.entries(report.realLogged.byProvider).map(([k, v]) => `${k} $${v}`).join(' · ')} — {report.realLogged.note}</p>}
                <p style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 6 }}>{report.disclosure}</p>
              </div>}
            </>}

            <h2>ทีม (แอดมินเท่านั้น)</h2>
            {!team && <p className="sub">กำลังโหลด…</p>}
            {team?.team?.map(t => (
              <div key={t.username} className="job" onClick={() => openMemberHistory(t.username)}>
                <span className="ava">{(t.displayName || '?').slice(0, 1)}</span>
                <div><p className="tt">{t.displayName}</p><p className="mm">วันนี้ {t.today.submits} งาน · 7 วัน {t.week.submits} · สะสม {t.allTimeJobs}{t.lastActive ? ` · ล่าสุด ${fmtTime(t.lastActive)}` : ''}</p></div>
                <span className="right chip cmu">ประวัติ</span>
              </div>
            ))}
            {team && Object.keys(team.otherChannels || {}).length > 0 &&
              <p className="sub" style={{ marginTop: 4 }}>ช่องทางอื่น (400 เคสล่าสุด): {Object.entries(team.otherChannels).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}

            <h2>สร้างยูสพนักงานใหม่</h2>
            <div className="compose" style={{ padding: 12 }}>
              <input className="in" style={{ marginBottom: 8 }} placeholder="ชื่อผู้ใช้ (อังกฤษ เช่น sun_igdara)" value={nu.username} onChange={e => setNu({ ...nu, username: e.target.value })} />
              <input className="in" style={{ marginBottom: 8 }} placeholder="ชื่อที่แสดง (เช่น ซัน)" value={nu.displayName} onChange={e => setNu({ ...nu, displayName: e.target.value })} />
              <input className="in" style={{ marginBottom: 8 }} type="password" placeholder="รหัสผ่านเริ่มต้น" value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} />
              <div className="seg" style={{ marginBottom: 8 }}>
                <button className={nu.role === 'editor' ? 'on' : ''} onClick={() => setNu({ ...nu, role: 'editor' })}>พนักงาน</button>
                <button className={nu.role === 'admin' ? 'on' : ''} onClick={() => setNu({ ...nu, role: 'admin' })}>แอดมิน</button>
              </div>
              <button className="cta" disabled={nuBusy} onClick={createUser}>{nuBusy ? 'กำลังสร้าง…' : 'สร้างยูส'}</button>
              <p className="mm" style={{ textAlign: 'center', marginTop: 8 }}>แก้รหัส/ลบยูส ทำได้ที่หน้าเว็บ <a className="lnk" href="/members" target="_blank" rel="noreferrer">/members ↗</a></p>
            </div>
          </>}
        </>}

        {teamSel && <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <button className="gh" style={{ width: 'auto', padding: '7px 14px' }} onClick={() => setTeamSel(null)}>←</button>
            <h1 style={{ fontSize: 18, margin: 0 }}>ประวัติ: {teamSel.userKey}</h1>
          </div>
          {teamSel.events.length === 0 && <p className="sub">ยังไม่มีเหตุการณ์ในสมุด</p>}
          {teamSel.events.map(e => <div key={e.id} className="evrow"><span className="t">{fmtTime(e.at)}</span><span>{evText(e)}</span></div>)}
        </>}
      </div>}

      <div className="tabs"><div className="tabsin">
        <button className={'tab' + (tab === 'write' ? ' on' : '')} onClick={() => setTab('write')}>{IC.send}ส่งข่าว</button>
        <button className={'tab' + (tab === 'clip' ? ' on' : '')} onClick={() => setTab('clip')}>{IC.clip}ถอดคลิป</button>
        <button className={'tab' + (tab === 'filter' ? ' on' : '')} onClick={() => setTab('filter')}>{IC.fil}สกัดเนื้อ</button>
        <button className={'tab' + (tab === 'works' ? ' on' : '')} onClick={() => setTab('works')}>{IC.lib}ผลงาน</button>
      </div></div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
