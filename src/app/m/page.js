'use client';
// 📱 /m — ViralFlow Mobile (26 ก.ค. 69): หน้ามือถือเต็มจอ ต่อระบบจริงทุกเส้น
//   ส่งข่าว → /api/queue/add (คิวเดียวกับบอทดิสคอร์ด) · ถอดคลิป → /api/clip-transcript/* (คิว+คลังร่วมกับเว็บ)
//   สกัดเนื้อ → /api/news-filter/* · ผลงาน → /api/generation-logs — ไม่แตะไฟล์ระบบเขียนข่าวที่ล็อก
//   ★ รอบสมาชิก (เจ้าของสั่ง): ตัวตนจาก session จริง (เลิกพิมพ์ชื่อ) + สมุดใช้งาน /api/usage + จอโปรไฟล์/ทีม/สร้างยูส
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
// 🗞️ โต๊ะข่าว (v1) — taxonomy.js isomorphic (ระบุไว้ในไฟล์ต้นทาง) ใช้ฝั่ง client ได้ตรงๆ ไม่ต้อง hardcode ซ้ำ
// ★ 27 ก.ค. 69 (เจ้าของอนุมัติ — อัปเกรดแท็บโต๊ะข่าวให้ครบเท่าโต๊ะกลาง): +LIBRARIES/isClip/enrichDeskItem
//   enrichDeskItem เติม library/sourceType/imageUrl/freshClass/reliability/editorial ให้ทุกใบฝั่ง client (API บาง tab ไม่ enrich มาให้)
import { HARVEST_MODES, LIBRARIES, isClip, enrichDeskItem } from '@/lib/services/newsDesk/taxonomy';
// ★ 28 ก.ค. 69 (แก้บั๊ก "มือถือค้างบันเดิลรุ่นเก่า"): เทียบรุ่นแอพนี้กับ mRev ที่ /api/m/cover ตอบมา — ต่างกันเตือนแตะรีโหลด
import { M_APP_REV } from '@/lib/mAppRev';

// เครื่องมือแต่งปกแมนวล — โหลดเฉพาะตอนเปิดแท็บ (ไฟล์หนัก ไม่ถ่วงจอแรก)
const CoverEditor = dynamic(() => import('./CoverEditor'), {
  ssr: false,
  loading: () => <p style={{ fontSize: 13, color: 'var(--mut)', padding: '20px 0' }}>กำลังเปิดเครื่องมือแต่งปก…</p>,
});

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
  img: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  desk: <span style={{ fontSize: 19, lineHeight: 1 }}>🗞️</span>,
};

const fmtTime = (iso) => { try { const d = new Date(iso); return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
// ★ ชุด① sol-review 26 ก.ค. 69: ตรวจลิงก์คลิปเข้มขึ้นก่อนส่ง (เกณฑ์เดียวกับฝั่ง server) — parse ผ่าน URL จริง + http(s) + hostname ไม่ว่าง + ยาว ≤500
function isValidClipUrl(u) {
  const s = String(u || '').trim();
  if (!s || s.length > 500) return false;
  try {
    const p = new URL(s);
    return (p.protocol === 'http:' || p.protocol === 'https:') && !!p.hostname;
  } catch { return false; }
}
const EV_LABEL = {
  app_open: '🔑 เปิดแอพ', submit_news: '📨 ส่งข่าวเข้าคิว', job_done: '✅ ข่าวเสร็จ', job_failed: '❌ งานล้ม',
  clip_submit: '🎬 ส่งคลิปเข้าคิวถอด', clip_done: '🎬 ถอดคลิปเสร็จ', filter_run: '🧃 สกัดเนื้อ', split_run: '🔀 แยกประเด็น',
  send_topic: '📌 ส่งประเด็นเข้าเขียน', copy_version: '📋 คัดลอกเวอร์ชัน', regen: '🔁 สั่งเจนใหม่', view_case: '📖 เปิดอ่านเคส',
  desk_harvest: '🔍 ล่าข่าวโต๊ะข่าว', desk_send: '✍️ ส่งข่าวจากโต๊ะข่าว', desk_dismiss: '🗑 ทิ้งข่าวจากโต๊ะข่าว',
  desk_search: '🔎 ค้นข่าวเองจากโต๊ะข่าว', // ★ 27 ก.ค. 69
};

// ═══ ทำปก — 5 ช่องของผัง "ปกไม่ถูกใจ" ปุ่ม "เปลี่ยนภาพรายช่อง" (27 ก.ค. ค่ำ) — ตรงกับ SLOT_ORDER ของ compose-test ═══
const SLOT_ROLES = [
  { key: 'hero', label: 'Hero' },
  { key: 'reaction', label: 'ขวาบน' },
  { key: 'action', label: 'ขวากลาง' },
  { key: 'context', label: 'ขวาล่าง' },
  { key: 'circle', label: 'วงกลม' },
];

// ═══ โต๊ะข่าว — ฟิลเตอร์ + ป้ายวันที่ (27 ก.ค. 69: อัปเกรดครบเท่าโต๊ะกลาง, เจ้าของอนุมัติ) ═══
// กรองฝั่งจอล้วน (ไม่ยิง API เพิ่ม) — ใช้ field ที่ enrichDeskItem เติมให้ทุกใบแล้ว (library/sourceType)
const DESK_TYPE_FILTERS = [
  { key: 'all', label: '🗂️ ทั้งหมด' },
  { key: 'clip', label: '🎬 คลิป' },
  { key: 'article', label: '📰 บทความ' },
];
const DESK_SRC_FILTERS = [
  { key: 'all', label: 'ทุกแหล่ง' },
  { key: 'youtube', label: '▶️ YT' },
  { key: 'tiktok', label: '🎵 TikTok' },
  { key: 'fb-clip', label: '🎬 FB' },
  { key: 'ig', label: '📷 IG' },
];
// หมวด 7 ปุ่ม = 'ทั้งหมด' + 6 คลังเนื้อหาจริงจาก taxonomy.js (เกณฑ์เดียวกับจอเว็บเดิม)
const DESK_LIB_FILTERS = [{ key: 'all', label: '🗂️ ทั้งหมด' }, ...LIBRARIES.map(l => ({ key: l.key, label: l.label }))];
// ★ 27 ก.ค. 69: ไอคอนแพลตฟอร์มเต็มบล็อก — ใบไม่มีรูป (ยังไม่เติม/เติมไม่สำเร็จ) โชว์ตัวนี้แทนจุดจิ๋วเดิม
const DESK_PLATFORM_ICON = { youtube: '▶️', tiktok: '🎵', 'fb-clip': '🎬', 'fb-post': '📘', ig: '📷', article: '📰' };

// ป้ายความสด — เกณฑ์เดียวกับจอเว็บเดิม (news-desk/page.js freshnessBadge): 🟢≤24ชม / 🟡≤72ชม / 🗓️เก่ากว่า / ⏳ไม่มีวันที่
function deskFreshBadge(it) {
  const p = it.publishedAt ? new Date(it.publishedAt).getTime() : null;
  if (!p || isNaN(p)) return { label: '⏳ ไม่ระบุวันที่', color: 'var(--mut)', bg: 'transparent' };
  const hrs = (Date.now() - p) / 36e5;
  if (hrs <= 24) return { label: hrs < 2 ? '🟢 สดมาก' : `🟢 วันนี้ · ${Math.round(hrs)} ชม.`, color: 'var(--ok)', bg: 'var(--okS)' };
  if (hrs <= 72) return { label: `🟡 ${Math.round(hrs / 24)} วันก่อน`, color: 'var(--warn)', bg: 'var(--warnS)' };
  const ds = new Date(p).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  return { label: `🗓️ ${ds}`, color: 'var(--mut)', bg: 'transparent' };
}
// ป้ายคุณภาพ บก. — เกณฑ์+สีเดียวกับจอเว็บเดิมเป๊ะ (qualityGrade): judgeScore ก่อน ไม่มีค่อย fallback finalScore
function deskQualityGrade(it) {
  const j = it.judgeScore;
  let tier;
  if (typeof j === 'number') tier = j >= 9 ? 3 : j >= 7 ? 2 : j >= 5 ? 1 : 0;
  else { const s = it.finalScore || 0; tier = s >= 85 ? 3 : s >= 70 ? 2 : s >= 55 ? 1 : 0; }
  return [
    { label: 'ผ่านเกณฑ์', emoji: '⚪', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
    { label: 'ดีปนกลาง', emoji: '🟡', color: '#d97706', bg: 'rgba(217,119,6,0.14)' },
    { label: 'ดี', emoji: '✅', color: '#16a34a', bg: 'rgba(22,163,74,0.14)' },
    { label: 'ดีมาก', emoji: '🌟', color: '#15803d', bg: 'rgba(21,128,61,0.16)' },
  ][tier];
}
// ปุ่มชิป overflow-x เลื่อนแนวนอน (แบบเดียวกับเลือกเทมเพลตใน CoverEditor.js)
const deskChipBtn = (active) => ({
  flex: 'none', padding: '7px 13px', borderRadius: 999, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  border: active ? '2px solid var(--pink)' : '1px solid var(--line)',
  background: active ? 'var(--pinkS)' : 'var(--card)', color: active ? 'var(--pink)' : 'var(--sub)',
});
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
  // ★ 27 ก.ค. 69 (เจ้าของอนุมัติ — อัปเกรดแท็บถอดคลิปให้ครบเท่าเว็บ /clip-transcript):
  //   insightMeta = เมตาของ insight ที่กำลังโชว์ (ลิงก์/แพลตฟอร์ม/คนส่ง/วันที่/หมวด) — งานสดใช้ค่าตอนส่ง · จากคลังใช้ค่าของเคสนั้น
  const [insightMeta, setInsightMeta] = useState(null);
  // topicEdits = ข้อความที่แก้ก่อนส่งเขียน {[idx]: {topic, raw}} — ทับเฉพาะช่องที่แก้ ช่องอื่นยังใช้ของเดิม
  const [topicEdits, setTopicEdits] = useState({});
  const [editingIdx, setEditingIdx] = useState(null); // idx การ์ดประเด็นที่กางช่องแก้ไขอยู่ (null = ปิดหมด)
  // ★ 27 ก.ค. ค่ำ (เจ้าของสั่งตรง): ดินสอแก้ก่อนส่งของ "กรอบเทา" (rawData) และ "กรอบม่วง" (transcriptQuotes.enrichedRaw)
  //   null = ยังไม่แก้ (ใช้ต้นฉบับ AI) · string = ฉบับที่แก้แล้ว — รีเซ็ตจุดเดียวกับ topicEdits (เริ่มถอดใหม่ + เปิดเคสจากคลัง)
  const [rawEdit, setRawEdit] = useState(null);
  const [rawEditing, setRawEditing] = useState(false); // กางช่องแก้กรอบเทาอยู่ไหม
  const [purpleEdit, setPurpleEdit] = useState(null);
  const [purpleEditing, setPurpleEditing] = useState(false); // กางช่องแก้กรอบม่วงอยู่ไหม
  // ★ 27 ก.ค. ค่ำ v2 (ฟีดแบ็กเจ้าของ: ช่องแก้เดิมเล็ก/เลื่อนหาคำยาก) — หน้าแก้เต็มจอใช้ร่วมกัน 3 จุด (การ์ดประเด็น/กรอบเทา/กรอบม่วง)
  //   editSnapshot = ค่า "ก่อนเปิดหน้าแก้รอบนี้" (undefined/null = ยังไม่เคยแก้มาก่อน) — ใช้เฉพาะปุ่ม "✖ ยกเลิก" คืนค่ากลับจุดที่เปิด (ต่างจาก "↩︎ คืนค่าเดิม" ที่ล้างกลับต้นฉบับ AI เสมอ)
  const [editSnapshot, setEditSnapshot] = useState(undefined);
  // ล็อกสกรอลพื้นหลังตอนหน้าแก้เต็มจอเปิดอยู่ — คืนค่าเดิมตอนปิด
  useEffect(() => {
    const open = editingIdx !== null || rawEditing || purpleEditing;
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [editingIdx, rawEditing, purpleEditing]);

  // ── สกัดเนื้อหา ── (ตรงตามเว็บ /news-filter ยกเครื่อง 19-24 มิ.ย.: ปิดดึงลิงก์ + เหลือโหมดเดียว)
  const [nfText, setNfText] = useState('');
  const [nfAI, setNfAI] = useState(true);
  const [nfQuotes, setNfQuotes] = useState(true);
  const [nfBusy, setNfBusy] = useState('');
  const [nfOut, setNfOut] = useState(null);
  const [nfSplit, setNfSplit] = useState(null);
  const [nfErr, setNfErr] = useState('');

  // ── ทำปก (ต่อท่อ /quick-cover ผ่านประตู /api/m/cover) ──
  const [cvTitle, setCvTitle] = useState('');
  const [cvContent, setCvContent] = useState('');
  const [cvJobs, setCvJobs] = useState([]);
  const [cvErr, setCvErr] = useState('');
  const [cvBusy, setCvBusy] = useState(false);
  const [cvOpen, setCvOpen] = useState(null);
  const [cvMode, setCvMode] = useState('manual'); // manual = แต่งเอง (default ตามเจ้าของสั่ง) · auto = AI หาภาพ · quick = ⚡ ทางลัดประกอบจากคลังเคสเดิม
  const [cvClips, setCvClips] = useState(['', '', '']); // ★ ชุด① 26 ก.ค. 69: ลิงก์คลิปต้นทาง 1-3 (โหมด 🤖 ให้ AI หา)
  const [cvSrcOnly, setCvSrcOnly] = useState(false);     // สวิตช์ไม่ค้นเพิ่ม — ใช้เฟรมจากคลิปเป็นแหล่งเดียว
  // ★ sol-review: ลิงก์ถูกลบจนไม่เหลือลิงก์ที่ผ่าน validation → รีเซ็ตสวิตช์เอง (กันปุ่มค้าง on แต่กดปิดไม่ได้เพราะ disabled)
  useEffect(() => { if (cvSrcOnly && !cvClips.some(isValidClipUrl)) setCvSrcOnly(false); }, [cvClips, cvSrcOnly]);
  // ★ 27 ก.ค. 69 (เจ้าของสั่ง): ล็อกโหมด 🤖 ให้ AI หา / ⚡ ทางลัด เฉพาะแอดมิน — พนักงานบังคับกลับ manual เสมอ (กัน member โหลดช้า/สลับยูสค้าง state)
  useEffect(() => { if (!isAdmin && cvMode !== 'manual') setCvMode('manual'); }, [isAdmin, cvMode]);
  const cvMineRef = useRef(new Set()); // job ที่เราส่งเอง — ไว้ log ตอนเสร็จครั้งเดียว
  // ⚡ ทางลัดประกอบ (kind='compose' — ประกอบจากคลังเคสเดิม ไม่ค้นรูปใหม่ ~20-80 วิ)
  const [qcCases, setQcCases] = useState([]);
  const [qcSel, setQcSel] = useState(null);
  const [qcHero, setQcHero] = useState('');
  const [qcBusy, setQcBusy] = useState(false);
  // ★ 29 ก.ค. 69 (lane2 audit-queue-stability #3 — ปุ่ม "⚡ ทางลัด" กันกดซ้ำ): ref sync (อัปเดตทันที ไม่รอ re-render)
  //   ต่างจาก qcBusy (state — อัปเดตช้ากว่าคลิกรัว/แตะจอซ้อนบนมือถือได้) กันเคส submitQuickCover ถูกเรียกซ้ำก่อนที่
  //   ปุ่ม disabled จะทันเปลี่ยนจริงในจอ (คนละชั้นกับ error-then-retry ปกติที่ยังอนุญาตให้กดใหม่ได้หลังงานจบ/ล้มจริง)
  const qcBusyRef = useRef(false);
  // ★ "ช่องเคส" (27 ก.ค. 69, เจ้าของขอ) — ดูภาพดิบของเคสในโหมด ⚡ ทางลัด · ต่อ /api/m/cover?view=caseImages
  const [caseImgOpen, setCaseImgOpen] = useState(null); // caseId ที่กางกริดภาพอยู่ (null = ปิดหมด)
  const [caseImgList, setCaseImgList] = useState({}); // {[caseId]: items[] | undefined (ยังไม่โหลด)}
  const caseImgLoadedRef = useRef(new Set()); // กันยิงซ้ำเคสเดิม
  // ★ 27 ก.ค. ค่ำ (เจ้าของอนุมัติ — "ปกไม่ถูกใจ" 4 ฟังก์ชันใต้ปกที่เสร็จแล้ว): ประกอบใหม่ทั้งปก / เปลี่ยนภาพรายช่อง / เปลี่ยนตัวเอก / เปลี่ยนต้นแบบ
  const [cvActionJob, setCvActionJob] = useState(null);   // id งานที่กำลังกางแผงฟังก์ชันอยู่ (null = ปิดหมด)
  const [cvActionMode, setCvActionMode] = useState(null); // 'slots' | 'hero' | 'ref' — โหมดย่อยที่เปิดอยู่ในแผงนั้น
  const [cvSlotRole, setCvSlotRole] = useState(null);     // ช่อง (hero/reaction/action/context/circle) ที่กำลังเลือกภาพแทน
  const [cvHeroName, setCvHeroName] = useState('');       // ชื่อตัวเอกที่พิมพ์ (โหมด "เปลี่ยนตัวเอก" — เข้าถึงรายชื่อจริงยาก ใช้ช่องพิมพ์เองตามที่เจ้าของอนุมัติ)
  const [cvRefList, setCvRefList] = useState(null);       // แคชรายชื่อต้นแบบจากคลัง (null = ยังไม่โหลด · [] = โหลดแล้วว่าง)
  // ★ แก้บั๊ก (รีวิว 27 ก.ค. ค่ำ รอบ 3): เดิมเป็น boolean เดี่ยว — เปลี่ยนเป็น key เฉพาะปุ่ม/งานที่กำลังทำ ให้ปุ่มที่กดจริงขึ้น "⏳" ได้
  //   (ปุ่มอื่นแค่ disabled ตามเดิม — ใช้ !!cvActionBusyKey แทนที่เดิมใช้ cvActionBusy ตรงๆ)
  const [cvActionBusyKey, setCvActionBusyKey] = useState(null); // e.g. `${jobId}:reroll` | `${jobId}:hero` | `${jobId}:ref` | `${jobId}:slot:${role}`
  // ★ 27 ก.ค. 69: คลังปกล่าสุด (โหมด auto/quick) — ต่อ /api/m/cover?view=archive (forward /api/mega-covers)
  const [cvArchive, setCvArchive] = useState([]);
  // ★ 28 ก.ค. 69 (แก้บั๊ก "มือถือค้างบันเดิลรุ่นเก่า"): true = เซิร์ฟเวอร์ตอบ mRev ไม่ตรงกับ M_APP_REV ของตัวเอง → โชว์แบนเนอร์แตะรีโหลด
  const [cvOutdated, setCvOutdated] = useState(false);
  // ★ 28 ก.ค. 69 (แก้บั๊ก "เปิดแผงแล้วดูเหมือนไม่มีอะไรเกิด" — แผงโผล่ใต้จอที่มองไม่เห็น): ref เดียวใช้ร่วมกันได้เพราะ
  //   แผงย่อย (slots/hero/ref) เปิดได้ทีละแผงเท่านั้น (cvActionJob/cvActionMode เป็น state เดี่ยว ไม่ใช่ต่อการ์ด)
  const cvPanelRef = useRef(null);
  const cvHeroInputRef = useRef(null);
  useEffect(() => {
    if (!cvActionJob || !cvActionMode) return;
    const raf = requestAnimationFrame(() => {
      cvPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (cvActionMode === 'hero') cvHeroInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [cvActionJob, cvActionMode]);

  // ── โต๊ะข่าว (v1) — ต่อท่อผ่านประตู /api/m/desk (เฉพาะแอดมิน) ──
  const [deskTab, setDeskTab] = useState('all'); // all | trend | good | shortlist | ready
  const [deskItems, setDeskItems] = useState([]);
  const [deskExpanded, setDeskExpanded] = useState(null); // id การ์ดที่กางอยู่
  const [deskModeOpen, setDeskModeOpen] = useState(false); // กางชิปเลือกโหมดล่าข่าว
  const [deskHarvestBusy, setDeskHarvestBusy] = useState(false);
  const [deskChiefBusy, setDeskChiefBusy] = useState(false);
  const [deskCardBusy, setDeskCardBusy] = useState({}); // {[id]: 'sendWorkflow'|'dismiss'}
  const [deskBrief, setDeskBrief] = useState(null); // สรุปวินิจฉัยล่าสุดจาก บก.ใหญ่
  // ★ 27 ก.ค. 69: ฟิลเตอร์ฝั่งจอ (ไม่ยิง API เพิ่ม) + ช่องค้นเอง + ภาพตัวอย่างล้ม
  const [deskTypeFilter, setDeskTypeFilter] = useState('all');   // all | clip | article
  const [deskSrcFilter, setDeskSrcFilter] = useState('all');     // all | youtube | tiktok | fb-clip | ig
  const [deskLibFilter, setDeskLibFilter] = useState('all');     // all | 6 คลัง
  const [deskSearchKw, setDeskSearchKw] = useState('');
  const [deskSearchBusy, setDeskSearchBusy] = useState(false);
  const [deskImgFail, setDeskImgFail] = useState({}); // {[id]: true} ภาพตัวอย่างโหลดไม่ขึ้น → โชว์ ▶ แทน
  // ★ 27 ก.ค. 69 (ชุดนี้): ล่าข่าว/ค้นเอง/บก.ใหญ่ → งานเบื้องหลังผ่านคิว /api/quick-test (เหมือนทำปก) — โพลดูสถานะที่นี่
  const [deskJobs, setDeskJobs] = useState([]);
  const [deskJobOpen, setDeskJobOpen] = useState(null); // id งาน บก.ใหญ่ ที่กางอยู่ (โชว์ result.summary จากตัวงานเอง — sol-review ข้อ 7)
  const deskMineRef = useRef(new Set()); // job ที่เราส่งเอง — toast/loadDesk ตอนเสร็จครั้งเดียว (เหมือน cvMineRef ของทำปก)

  // ── ผลงาน ──
  const [cases, setCases] = useState([]);
  const [caseDetail, setCaseDetail] = useState(null);
  const [caseLoading, setCaseLoading] = useState(false);

  // ★ 27 ก.ค. 69: useCallback (deps [] — setToast เสถียรอยู่แล้ว) เพื่อให้ loadDeskJobs อ้างอิงได้แบบ stable ไม่ชน react-hooks/exhaustive-deps
  const say = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 2400); }, []);

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

  // ★ 28 ก.ค. 69 (รอบ 2 — ยกเช็ครุ่นเป็น global ทั้งแอพ): ตอน mount + แท็บกลับมา visible + focus หน้าต่าง
  //   ไม่ผูกกับ login/แท็บที่เปิดอยู่ — /api/m/cover?view=rev ไม่ต้องล็อกอิน เช็คได้แม้ session หลุด
  //   throttle: เช็คจาก visibility/focus ไม่ถี่กว่า 1 ครั้ง/60 วิ (ตอน mount เช็คเสมอ ไม่ throttle) · ล้มเงียบ (เน็ตสะดุด/timeout ไม่กวนผู้ใช้)
  //   ห้าม auto-reload เอง (กันข้อมูลที่พิมพ์ค้างหาย) — ใช้แบนเนอร์ให้แตะเสมอ
  const revLastCheckRef = useRef(0);
  const checkAppRev = useCallback((force) => {
    const now = Date.now();
    if (!force && now - revLastCheckRef.current < 60000) return;
    revLastCheckRef.current = now;
    fetch('/api/m/cover?view=rev', { cache: 'no-store', signal: AbortSignal.timeout(6000) })
      .then(r => r.json())
      .then(d => { if (d.success && d.mRev && d.mRev !== M_APP_REV) setCvOutdated(true); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    checkAppRev(true);
    const onVis = () => { if (document.visibilityState === 'visible') checkAppRev(false); };
    const onFocus = () => checkAppRev(false);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onFocus); };
  }, [checkAppRev]);

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
  const loadCovers = useCallback(() => {
    fetch('/api/m/cover', { cache: 'no-store' }).then(r => r.json()).then(d => {
      // ★ 28 ก.ค. 69 (แก้บั๊ก "มือถือค้างบันเดิลรุ่นเก่า"): เช็คก่อน success — เซิร์ฟเวอร์รุ่นใหม่ตอบ mRev มาเสมอไม่ว่างานจะดึงสำเร็จไหม
      if (d.mRev && d.mRev !== M_APP_REV) setCvOutdated(true);
      if (!d.success) return;
      const jobs = d.jobs || [];
      // ★ แก้บั๊ก (รีวิว 27 ก.ค. ค่ำ รอบ 2): งานจำลอง "frozen-…" (ปุ่มเปลี่ยนภาพรายช่อง) ไม่ผ่านคิวจริง —
      //   เดิม setCvJobs(jobs) ทับทิ้งทุกครั้งที่ poll (ทุก 800ms/3s หลังส่งงานอื่น) ทำให้หายไปใน 5-12 วิ ทั้งที่ผู้ใช้เพิ่งรอผล
      //   คงไว้ด้านบนสุดเสมอ — รายการจริงจากเซิร์ฟเวอร์ไม่มีทางมี id ขึ้นต้น "frozen-" ชนกันอยู่แล้ว
      setCvJobs(prev => [...prev.filter(j => String(j.id).startsWith('frozen-')), ...jobs]);
      // งานที่เราส่งเองเพิ่งเสร็จ → log ครั้งเดียว
      for (const j of jobs) {
        if (j.status === 'done' && cvMineRef.current.has(j.id)) {
          cvMineRef.current.delete(j.id);
          log('cover_done', j.id, { sim: j.result?.refSimilarity ?? null });
        }
      }
    }).catch(() => {});
  }, [log]);
  // 🗞️ โต๊ะข่าว — /api/m/desk ล็อกเฉพาะแอดมินฝั่ง server เหมือน /api/m/cover (พนักงานไม่ยิงเลย กันโดน 403 เปล่าๆ)
  // ★ sol-review 27 ก.ค. 69: ไม่ตั้ง state แบบ sync ใน effect (react-hooks/set-state-in-effect) — setState เกิดใน .then เท่านั้น
  //   เหมือน loadCovers/loadMe ข้างบน (ไม่มี loading flag แยก — ใช้ deskItems.length===0 บอกสถานะ "ยังไม่มี/กำลังโหลด" แทน)
  // ★ 27 ก.ค. 69: เติมรูปอัตโนมัติ — ใบไหนไม่มีรูป → ยิงหลังบ้านหา og:image เงียบๆ (ล้มได้ จอห้ามพัง) แล้ว merge เข้า state
  // ★ sol-review ข้อ 3: merge เป็น `thumbUrl` (ไม่ใช่ `imageUrl` — ฟิลด์นั้นมีผลคะแนนคัดข่าวฝั่งเซิร์ฟเวอร์) จอแสดงผล
  //   ใช้ it.imageUrl || it.thumbUrl ตรงจุด render แทน (ดู DESK_PLATFORM_ICON block ด้านล่าง)
  // 🔴 กำชับเจ้าของ 27 ก.ค. 69: "หารูปไม่เจอไม่เป็นไร ไม่ต้องพยายาม เดี๋ยวพัง" — ห้าม say()/toast เมื่อล้ม (ไม่เจอ = ปกติ
  //   ไม่ใช่ error) · ห้ามรีทราย/เรียกซ้ำจากจอเอง — ให้ negative-cache ฝั่งเซิร์ฟเวอร์ (thumbTriedAt) เป็นตัวกันยิงซ้ำ
  const fetchDeskThumbs = useCallback((ids) => {
    // ★ 27 ก.ค. 69 (เจ้าของสั่ง): แท็บโต๊ะข่าวเปิดให้ทุกคนที่ล็อกอินใช้ได้แล้ว — ตัด isAdmin guard ออก
    if (!ids || !ids.length) return;
    fetch('/api/m/desk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fetchThumbs', ids }),
    }).then(r => r.json()).then(d => {
      if (!d.success || !d.images) return;
      setDeskItems(prev => prev.map(it => (d.images[it.id] && !it.imageUrl && !it.thumbUrl) ? { ...it, thumbUrl: d.images[it.id] } : it));
    }).catch(() => {}); // เติมรูปล้ม = จอยังใช้งานได้ปกติ แค่ไม่มีรูป
  }, []);
  const loadDesk = useCallback(() => {
    fetch('/api/m/desk?view=feed&tab=' + deskTab, { cache: 'no-store' }).then(r => r.json())
      // ★ 27 ก.ค. 69: enrich ทุกใบฝั่ง client — บาง tab (all/trend/good/ready) ฝั่ง server ไม่เติม library/sourceType/reliability ให้
      //   (เฉพาะ zone clip/link + browse + shortlist ของจอเว็บเดิมที่ enrich มาให้) เติมเองที่นี่แทน ไม่ต้องยิง API เพิ่ม
      .then(d => {
        if (!d.success) return;
        const enriched = (d.items || []).map(enrichDeskItem);
        setDeskItems(enriched);
        // ★ 27 ก.ค. 69 (sol-review ข้อ 3): 30 ใบแรกที่ยังไม่มีรูป (youtube ได้ thumb จาก enrichDeskItem ไปแล้ว)
        //   + ไม่เคยลองมาก่อน (thumbUrl/thumbTriedAt ว่างทั้งคู่) → เติมรูปเบื้องหลัง · เลิกส่ง id ที่มี thumbTriedAt
        //   แล้ว (ไม่ว่าเจอหรือไม่) กันยิงซ้ำเว็บเดิมทุกครั้งที่จอโหลด (server มี negative-cache 7 วันเป็นด่านสำรอง)
        const missingIds = enriched.slice(0, 30).filter(it => !it.imageUrl && !it.thumbUrl && !it.thumbTriedAt).map(it => it.id);
        if (missingIds.length) fetchDeskThumbs(missingIds);
      })
      .catch(() => {});
  }, [deskTab, fetchDeskThumbs]);
  // ★ 27 ก.ค. 69: รายการงานเบื้องหลังโต๊ะข่าว (harvest/search/chief) — โพลจากที่นี่ + toast/loadDesk อัตโนมัติตอนเสร็จ
  //   เฉพาะงานที่เราส่งเอง (deskMineRef) ถึง toast — งานเก่าจากรอบก่อน/เครื่องอื่นไม่เด้งซ้ำ (เหมือน loadCovers)
  const loadDeskJobs = useCallback(() => {
    fetch('/api/m/desk?view=jobs', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (!d.success) return;
      const jobs = d.jobs || [];
      setDeskJobs(jobs);
      for (const j of jobs) {
        if (!deskMineRef.current.has(j.id)) continue;
        if (j.status === 'done') {
          deskMineRef.current.delete(j.id);
          if (j.kind === 'desk_chief') {
            setDeskBrief(j.result || null);
            say('🧠 บก.ใหญ่วินิจฉัยเสร็จแล้ว');
          } else {
            const kw = j.input?.keyword;
            log(j.kind === 'desk_search' ? 'desk_search' : 'desk_harvest', j.id, { mode: j.input?.mode, keyword: kw, added: j.result?.added ?? null });
            say(`🔍 ${j.kind === 'desk_search' ? `ค้น "${kw}"` : 'ล่าข่าว'}เสร็จ — เจอใหม่ ${j.result?.added ?? 0} ใบ`);
            loadDesk();
          }
        } else if (j.status === 'failed') {
          deskMineRef.current.delete(j.id);
          say(`❌ ${j.label || 'งานโต๊ะข่าว'} ล้มเหลว: ${String(j.error || '').slice(0, 60)}`);
        }
      }
    }).catch(() => {});
  }, [log, loadDesk, say]);
  // เปลี่ยนกระดาน/แท็บย่อย → เคลียร์ฟิลเตอร์เดิม (กันค้างฟิลเตอร์ที่ทำให้จอว่างงงๆ)
  // ★ ทำในตัว handler เอง ไม่ใช้ useEffect (กัน react-hooks/set-state-in-effect — ทำตามแบบที่โปรเจกต์นี้เคยชี้ปัญหาไว้แล้วที่จุดอื่น)
  const changeDeskTab = (next) => {
    setDeskTab(next); setDeskTypeFilter('all'); setDeskSrcFilter('all'); setDeskLibFilter('all');
  };
  // ฟิลเตอร์ล้วนฝั่งจอ — กรองจาก field ที่มีในการ์ดอยู่แล้ว (isClip/library/sourceType จาก taxonomy.js)
  const deskFiltered = useMemo(() => {
    let list = deskItems;
    if (deskTypeFilter === 'clip') list = list.filter(isClip);
    else if (deskTypeFilter === 'article') list = list.filter(it => !isClip(it));
    if (deskSrcFilter !== 'all') list = list.filter(it => it.sourceType === deskSrcFilter);
    if (deskLibFilter !== 'all') list = list.filter(it => it.library === deskLibFilter);
    return list;
  }, [deskItems, deskTypeFilter, deskSrcFilter, deskLibFilter]);

  useEffect(() => {
    if (tab === 'works') loadCases();
    if (tab === 'clip') loadInsightCases();
    // ★ 27 ก.ค. 69 (sol แจ้งตกค้าง): /api/m/cover ล็อกเฉพาะแอดมินแล้วฝั่ง server — พนักงานไม่ต้องยิงเลย กันโดน 403 เปล่าๆ
    if (tab === 'cover' && isAdmin) loadCovers();
    if (tab === 'me') { loadMe(); if (isAdmin) { loadTeam(); loadReport(); } }
    if (tab === 'desk') { loadDesk(); loadDeskJobs(); } // ★ 27 ก.ค. 69 (เจ้าของสั่ง): เปิดให้ทุกคนที่ล็อกอินใช้ได้แล้ว
  }, [tab, isAdmin, loadCases, loadInsightCases, loadCovers, loadMe, loadTeam, loadReport, loadDesk, loadDeskJobs]);

  // ⚡ ทางลัดประกอบ — โหลดรายการเคสจากคลัง (ครั้งแรกที่เข้าโหมด หรือกดรีเฟรชเอง)
  const loadQcCases = useCallback(() => {
    fetch('/api/m/cover?view=cases', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (d.success) setQcCases((d.cases || []).slice(0, 15));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    // ★ 27 ก.ค. 69: โหมดทางลัดล็อกเฉพาะแอดมิน — พนักงานไม่ยิง /api/m/cover?view=cases เลย
    if (tab === 'cover' && isAdmin && cvMode === 'quick' && qcCases.length === 0) loadQcCases();
  }, [tab, isAdmin, cvMode, qcCases.length, loadQcCases]);

  // ★ "ช่องเคส" (27 ก.ค. 69, เจ้าของขอ) — เปิด/ปิดกริดภาพดิบของเคส · ล้มเงียบถ้าโหลดไม่ได้ (คืน [] เงียบ ไม่ retry ไม่ error แดง จอห้ามพัง)
  const toggleCaseImages = useCallback((caseId) => {
    setCaseImgOpen(prev => (prev === caseId ? null : caseId));
    if (!caseId || caseImgLoadedRef.current.has(caseId)) return;
    caseImgLoadedRef.current.add(caseId);
    fetch(`/api/m/cover?view=caseImages&caseId=${encodeURIComponent(caseId)}&limit=60`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setCaseImgList(m => ({ ...m, [caseId]: (d && d.success && Array.isArray(d.items)) ? d.items : [] })))
      .catch(() => setCaseImgList(m => ({ ...m, [caseId]: [] })));
  }, []);

  // ★ 27 ก.ค. 69: คลังปกล่าสุด (โชว์ในโหมด auto/quick) — โหลดครั้งแรกที่เข้าโหมดใดโหมดหนึ่ง (guard isAdmin เหมือนบล็อกอื่น)
  const loadCoverArchive = useCallback(() => {
    fetch('/api/m/cover?view=archive&limit=24', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (d.success) setCvArchive(d.items || []);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    // ★ sol-review ข้อ 5: เดิมเช็คแค่ cvMode==='auto' — โหมด quick เข้ามาก่อนก็ไม่โหลดเลย (คลังว่างค้าง)
    if (tab === 'cover' && isAdmin && (cvMode === 'auto' || cvMode === 'quick') && cvArchive.length === 0) loadCoverArchive();
  }, [tab, isAdmin, cvMode, cvArchive.length, loadCoverArchive]);

  // โพลงานปก — 5 วิเมื่ออยู่แท็บปกหรือมีงานวิ่ง, ไม่งั้นหยุด (★ 27 ก.ค. 69: เฉพาะแอดมิน — พนักงานไม่โพลเลยเพราะ /api/m/cover ล็อกไว้แล้ว)
  useEffect(() => {
    if (!isAdmin) return;
    const active = cvJobs.some(j => j.status === 'pending' || j.status === 'running');
    if (tab !== 'cover' && !active) return;
    const iv = setInterval(loadCovers, active ? 5000 : 12000);
    return () => clearInterval(iv);
  }, [tab, isAdmin, cvJobs, loadCovers]);

  // ★ 27 ก.ค. 69: โพลงานเบื้องหลังโต๊ะข่าว — เฉพาะตอนอยู่แท็บโต๊ะข่าว+มีงานยังไม่จบ (ไม่โพลค้างถาวร)
  //   ★ เจ้าของสั่ง (ชุดนี้): เปิดให้ทุกคนที่ล็อกอินใช้ได้แล้ว — ตัด isAdmin guard ออก
  useEffect(() => {
    if (tab !== 'desk') return;
    const active = deskJobs.some(j => j.status === 'pending' || j.status === 'running');
    if (!active) return;
    const iv = setInterval(loadDeskJobs, 8000);
    return () => clearInterval(iv);
  }, [tab, deskJobs, loadDeskJobs]);

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
    setClipErr(''); setInsight(null); setSelTopics([]); setTopicEdits({}); setEditingIdx(null); setInsightMeta(null); setClipPhase('queued'); setClipPos(0);
    setRawEdit(null); setRawEditing(false); setPurpleEdit(null); setPurpleEditing(false);
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
            // ★ เก็บเมตาไว้โชว์เท่าเว็บ (ลิงก์เปิดคลิป/แพลตฟอร์ม/คนส่ง/วันที่/ธงคุณภาพ) — job-status ไม่ส่ง url กลับมาใน result จึงใช้ค่าที่พิมพ์ไว้ตอนส่ง
            //   ★ รีวิว: lowQuality/qualityNote ทางสดอยู่บน st.result ตรงๆ (ผลเดียวกับ /api/clip-transcript/insight) — ย้ายเข้า insightMeta ให้ใช้ทางเดียวกับเคสจากคลัง
            setInsightMeta({
              url: u, platform: st.platform || (st.result || {}).platform || '', user: 'mobile-' + me, createdAt: new Date().toISOString(),
              category: (st.result || {}).category || '', lowQuality: !!(st.result || {}).lowQuality, qualityNote: (st.result || {}).qualityNote || '',
            });
            log('clip_done', d.jobId, { topics: insightTopics(st.result || {}).length });
          } else if (st.status === 'error') { clearInterval(clipPollRef.current); setClipPhase('error'); setClipErr(st.error || 'ถอดไม่สำเร็จ'); }
          if (tries > 200) { clearInterval(clipPollRef.current); setClipPhase('error'); setClipErr('งานยังทำอยู่เบื้องหลัง — เสร็จแล้วจะโผล่ในคลังถอดประเด็นด้านล่าง'); }
        } catch {}
      }, 4000);
    } catch (e) { setClipPhase('error'); setClipErr(String(e.message || e)); }
  };

  const insightTopics = (ins) => {
    if (!ins) return [];
    const tq = ins.transcriptQuotes;
    if (tq?.enrichedTopics?.length) {
      const withRaw = tq.enrichedTopics.filter(t => t && typeof t.enrichedRaw === 'string' && t.enrichedRaw.trim());
      if (withRaw.length) return withRaw.map((t, i) => ({ topic: t.topic, time: t.timeRange, raw: t.enrichedRaw, no: t.no || i + 1 }));
    }
    if (typeof tq?.enrichedRaw === 'string' && tq.enrichedRaw.trim()) return [{ topic: ins.headline || ins.overview || 'ประเด็นจากคลิป', time: '', raw: tq.enrichedRaw, no: 1 }];
    if (ins.subStories?.length) return ins.subStories.map((s, i) => ({ topic: s.topic, time: s.timeRange, raw: s.rawData, quotes: s.quotes, no: s.no || i + 1 }));
    if (ins.topics?.length) return ins.topics.map((t, i) => ({ topic: t.topic || t.title, time: t.timeRange, raw: t.rawData || t.detail || '', no: t.no || i + 1 }));
    return [{ topic: ins.headline || ins.overview || 'ประเด็นจากคลิป', time: '', raw: ins.rawData || '', no: 1 }];
  };

  // ★ 27 ก.ค. 69: ประเด็นที่ "แก้แล้ว" (หัวข้อ/เนื้อดิบ) ทับของเดิมเฉพาะช่องที่แตะดินสอแก้ — ช่องอื่นใช้ผลจาก AI ตามปกติ
  const effectiveTopics = (ins) => insightTopics(ins).map((t, i) => {
    const e = topicEdits[i];
    return e ? { ...t, topic: e.topic ?? t.topic, raw: e.raw ?? t.raw } : t;
  });
  // ★ 27 ก.ค. ค่ำ v2: แตะไอคอนดินสอ → เปิด "หน้าแก้เต็มจอ" เสมอ (ไม่ toggle ปิดอีกต่อไป — ปิดทำผ่านปุ่ม 3 ปุ่มในหน้าแก้เท่านั้น)
  //   seed ค่าตั้งต้นจากเนื้อหาปัจจุบันครั้งแรกที่เปิด + เก็บ editSnapshot (ค่าก่อนเปิดรอบนี้) ไว้ให้ปุ่ม "✖ ยกเลิก" คืนกลับแม่นยำ
  const startEditTopic = (i) => {
    setEditSnapshot(topicEdits[i]);
    setTopicEdits(m => (m[i] ? m : { ...m, [i]: { topic: insightTopics(insight)[i]?.topic || '', raw: insightTopics(insight)[i]?.raw || '' } }));
    setEditingIdx(i);
  };
  // เปิดหน้าแก้เต็มจอของ "กรอบเทา" (ข้อมูลดิบรวม)
  const openRawEditor = () => {
    setEditSnapshot(rawEdit);
    if (rawEdit == null) setRawEdit(insight?.rawData || '');
    setRawEditing(true);
  };
  // เปิดหน้าแก้เต็มจอของ "กรอบม่วง" (เนื้อหลัก enrichedRaw เท่านั้น — ส่วนอื่นในกรอบม่วงไม่มีดินสอ)
  const openPurpleEditor = () => {
    setEditSnapshot(purpleEdit);
    if (purpleEdit == null) setPurpleEdit(insight?.transcriptQuotes?.enrichedRaw || '');
    setPurpleEditing(true);
  };
  const closeAllEditors = () => { setEditingIdx(null); setRawEditing(false); setPurpleEditing(false); };
  // ✅ เสร็จแล้ว — ปิดหน้าแก้ เก็บค่าที่พิมพ์ไว้ (ผูกกับ state จริงผ่าน onChange อยู่แล้ว ไม่ต้องทำอะไรเพิ่ม)
  const confirmEditor = () => { closeAllEditors(); };
  // ↩︎ คืนค่าเดิม — ล้างกลับ "ต้นฉบับ AI" ทั้งหมด (เหมือนปุ่ม ↩︎ นอกหน้าแก้เป๊ะ)
  const revertEditor = () => {
    if (editingIdx !== null) { const i = editingIdx; setTopicEdits(m => { const n = { ...m }; delete n[i]; return n; }); }
    else if (rawEditing) setRawEdit(null);
    else if (purpleEditing) setPurpleEdit(null);
    closeAllEditors();
  };
  // ✖ ยกเลิก — กลับค่า "ก่อนเปิดหน้าแก้รอบนี้" เป๊ะ (ต่างจาก ↩︎ ตรงที่ถ้าเคยแก้มาก่อนหน้านี้แล้ว จะไม่ล้างของเก่าทิ้งไปด้วย)
  const cancelEditor = () => {
    if (editingIdx !== null) { const i = editingIdx; setTopicEdits(m => ({ ...m, [i]: editSnapshot })); }
    else if (rawEditing) setRawEdit(editSnapshot ?? null);
    else if (purpleEditing) setPurpleEdit(editSnapshot ?? null);
    closeAllEditors();
  };
  // ข้อความ "คัดลอกทั้งหมด" — พอร์ตจากเว็บ /clip-transcript (insightCaseText + topicText) ตรงเป๊ะ รวม early-return ของ multiTopic ด้วย
  const clipAllText = (ins) => {
    if (!ins) return '';
    const parts = [];
    if (ins.headline) parts.push(`📌 ${ins.headline}`);
    if (ins.overview) parts.push(ins.overview);
    if (ins.multiTopic && ins.topics?.length) {
      parts.push(`— แยก ${ins.topics.length} ประเด็น —`);
      ins.topics.forEach((t) => {
        const lines = [`【${t.no}】 ${t.title || ''}${(t.timeStart || t.timeEnd) ? `  (${t.timeStart || '?'}–${t.timeEnd || '?'})` : ''}`];
        if (t.summary) lines.push(t.summary);
        if (t.keyPoints?.length) lines.push(t.keyPoints.map((k) => `• ${k}`).join('\n'));
        if (t.quotes?.length) lines.push(t.quotes.map((q) => `"${q}"`).join('\n'));
        parts.push(lines.join('\n'));
      });
      return parts.join('\n\n'); // ★ เท่าเว็บ: คลิปยาว (multiTopic) จบที่นี่ ไม่ต่อ rawData/subStories/transcriptQuotes
    }
    if (ins.keyPoints?.length) parts.push('— ประเด็นสำคัญ —\n' + ins.keyPoints.map((k, i) => `${i + 1}. ${k.point}${k.detail ? ' — ' + k.detail : ''}`).join('\n'));
    if (ins.quotes?.length) parts.push('— คำพูดสำคัญ —\n' + ins.quotes.map(q => `"${q}"`).join('\n'));
    if (ins.rawData) parts.push('— ข้อมูลดิบรวม —\n' + ins.rawData);
    if (ins.subStories?.length) {
      ins.subStories.forEach((s, i) => parts.push(`— เนื้อดิบประเด็น ${s.no || i + 1}: ${s.topic}${s.timeRange ? ` (${s.timeRange})` : ''} —\n${s.rawData}${s.quotes?.length ? '\n\nคำพูด:\n' + s.quotes.map(q => `"${q}"`).join('\n') : ''}`));
    }
    const tq = ins.transcriptQuotes;
    if (tq) {
      if (tq.enrichedRaw) parts.push('— เนื้อดิบมีมิติ (ประเด็น+คำพูดจริง พร้อมเขียนข่าว) —\n' + tq.enrichedRaw);
      if (tq.enrichedTopics?.length) tq.enrichedTopics.forEach((t, i) => parts.push(`— เนื้อดิบมีมิติ ประเด็น ${t.no || i + 1}: ${t.topic}${t.timeRange ? ` (${t.timeRange})` : ''} —\n${t.enrichedRaw}`));
      if (tq.punchyQuotes?.length) parts.push('— ประโยคเด็ด —\n' + tq.punchyQuotes.map(q => `"${q.quote}"${q.speaker ? ' — ' + q.speaker : ''}${q.why ? ' (' + q.why + ')' : ''}`).join('\n'));
      if (tq.transcript) parts.push('— บทพูดในคลิป (ไม่รวมเพลง) —\n' + tq.transcript);
    }
    return parts.join('\n\n');
  };

  const sendTopicsToWrite = () => {
    const picked = effectiveTopics(insight).filter((_, i) => selTopics.includes(i));
    if (!picked.length) { say('เลือกอย่างน้อย 1 ประเด็นก่อน'); return; }
    // ★ รีวิว: ประเด็นที่แก้จนว่างทั้งหัวข้อและเนื้อดิบ → ตัดทิ้งก่อนส่ง กันเจนจากช่องว่างเปล่า
    const tps = picked.filter(t => (t.topic || '').trim() || (t.raw || '').trim());
    if (!tps.length) { say('ประเด็นที่เลือกถูกแก้จนว่างหมด — เติมข้อความก่อนส่ง'); return; }
    if (tps.length < picked.length) say(`ข้าม ${picked.length - tps.length} ประเด็นที่แก้จนว่าง — ส่งเฉพาะที่มีเนื้อหา`);
    let input = tps.map(t =>
      `${t.topic}${t.time ? ` (ช่วง ${t.time})` : ''}\n\n${t.raw || ''}${t.quotes?.length ? '\n\nคำพูดจากคลิป:\n' + t.quotes.map(q => `"${q}"`).join('\n') : ''}`
    ).join('\n\n———\n\n');
    const pq = Array.isArray(insight?.transcriptQuotes?.punchyQuotes) ? insight.transcriptQuotes.punchyQuotes.filter(q => q && typeof q.quote === 'string' && q.quote.trim()) : [];
    if (pq.length) {
      input += '\n\nประโยคเด็ดจากคลิป:\n' + pq.map(q => `"${q.quote}"${q.speaker ? ' — ' + q.speaker : ''}`).join('\n');
    }
    log('send_topic', '', { from: 'clip', count: tps.length });
    submitNews(input, { source: 'clip' });
  };

  // ★ 27 ก.ค. ค่ำ (เจ้าของสั่งตรง): ปุ่มส่งเจนประจำกรอบเทา (ข้อมูลดิบรวม) — ใช้ฉบับที่แก้แล้วถ้ามี ไม่งั้นใช้ต้นฉบับ AI
  //   เส้นทางเดียวกับ sendTopicsToWrite ทุกอย่าง: log เดิม + submitNews ตัวเดิม (ด่านความยาว <60 ตัวอักษร อยู่ใน submitNews แล้ว)
  const sendRawToWrite = () => {
    const text = (rawEdit ?? insight?.rawData ?? '').trim();
    if (!text) { say('เนื้อดิบว่าง — เติมข้อความก่อนส่ง'); return; }
    if (text.length < 60) { say('เนื้อสั้นเกินไป — ขอความยาวสักหน่อย'); return; } // กัน toast "ส่งแล้ว" ทับข้อความบล็อกของ submitNews
    log('send_topic', '', { from: 'clip-raw' });
    submitNews(text, { source: 'clip-raw' });
    say('ส่งกรอบข้อมูลดิบเข้าเขียนข่าวแล้ว');
  };

  // ★ 27 ก.ค. ค่ำ (เจ้าของสั่งตรง): ปุ่มส่งเจนประจำกรอบม่วง (เนื้อดิบมีมิติ enrichedRaw) — เฉพาะเนื้อหลัก ไม่รวม enrichedTopics/punchyQuotes/transcript
  const sendPurpleToWrite = () => {
    const text = (purpleEdit ?? insight?.transcriptQuotes?.enrichedRaw ?? '').trim();
    if (!text) { say('เนื้อดิบมีมิติว่าง — เติมข้อความก่อนส่ง'); return; }
    if (text.length < 60) { say('เนื้อสั้นเกินไป — ขอความยาวสักหน่อย'); return; } // กัน toast "ส่งแล้ว" ทับข้อความบล็อก
    log('send_topic', '', { from: 'clip-purple' });
    submitNews(text, { source: 'clip-purple' });
    say('ส่งกรอบเนื้อดิบมีมิติเข้าเขียนข่าวแล้ว');
  };

  // ═══ สกัดเนื้อหา ═══ (ปิดดึงจากลิงก์ตามเว็บ — รับเฉพาะข้อความสรุปที่วางเอง)
  const nfRun = async () => {
    const t = nfText.trim();
    if (/^https?:\/\/\S+$/i.test(t)) { say('ปิดสกัดจากลิงก์แล้ว — สรุปใจความข่าวแล้ววางเป็นข้อความแทน'); return; }
    if (t.length < 80) { say('วางเนื้อข่าวก่อน (ยาวสักหน่อย)'); return; }
    setNfBusy('filter'); setNfErr(''); setNfOut(null); setNfSplit(null);
    try {
      const d = await (await fetch('/api/news-filter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: nfText, mode: 'soft', useAI: nfAI, user: 'mobile-' + me, options: { keepQuotes: nfQuotes } }),
      })).json();
      if (!d.success) throw new Error(d.error || 'สกัดไม่สำเร็จ');
      setNfOut(d.data); say('สกัดเสร็จ — ตัดไป ' + (d.data?.removedPercent ?? '?') + '%');
      log('filter_run', '', { mode: 'soft', ai: nfAI, removed: d.data?.removedPercent ?? null });
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

  // ═══ ทำปก ═══
  const submitCover = async () => {
    const c = cvContent.trim();
    if (c.length < 100) { setCvErr(`วางเนื้อข่าวเต็มก่อน (≥100 ตัวอักษร — ตอนนี้ ${c.length})`); return; }
    setCvErr(''); setCvBusy(true);
    // ★ ชุด① 26 ก.ค. 69: ลิงก์คลิปต้นทาง 1-3 + สวิตช์ไม่ค้นเพิ่ม
    //   sol-review: คงรูป payload เดิมเมื่อไม่ใช้ฟีเจอร์ — แนบ field เฉพาะมีค่าจริง (ไม่งั้น omit ไปเลย ห้าม [] / false)
    const clipUrls = cvClips.map(u => u.trim()).filter(isValidClipUrl).slice(0, 3);
    try {
      const d = await (await fetch('/api/m/cover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newsTitle: cvTitle.trim(), content: c, ...(clipUrls.length ? { clipUrls } : {}), ...((cvSrcOnly && clipUrls.length > 0) ? { sourceOnly: true } : {}) }),
      })).json();
      if (!d.success) throw new Error(d.error || 'ส่งงานปกไม่สำเร็จ');
      if (d.jobId) { cvMineRef.current.add(d.jobId); setCvOpen(d.jobId); }
      log('cover_submit', d.jobId || '', {});
      say('เข้าคิวทำปกแล้ว — ปิดจอได้ ~3-6 นาที');
      setTimeout(loadCovers, 800); setTimeout(loadCovers, 3000);
    } catch (e) { setCvErr(String(e.message || e)); }
    setCvBusy(false);
  };
  // ⚡ ทางลัดประกอบ — ประกอบปกจากคลังเคสเดิม (kind='compose')
  const submitQuickCover = async () => {
    // ★ 29 ก.ค. 69 (lane2 audit-queue-stability #3): เช็ค+ล็อก ref ทันทีแบบ synchronous ก่อน setState ใดๆ
    //   กันกดซ้ำ/แตะจอซ้อนที่มาถึงก่อนปุ่ม disabled จะสะท้อนใน DOM จริง (setQcBusy เป็น state มีดีเลย์ข้าม render)
    if (!qcSel || qcBusyRef.current) return;
    qcBusyRef.current = true;
    setCvErr(''); setQcBusy(true);
    try {
      const d = await (await fetch('/api/m/cover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'compose', caseId: qcSel, heroPersonHint: qcHero.trim() }),
      })).json();
      if (!d.success) throw new Error(d.error || 'ส่งงานปกไม่สำเร็จ');
      if (d.jobId) { cvMineRef.current.add(d.jobId); setCvOpen(d.jobId); }
      log('cover_submit', d.jobId || '', { mode: 'compose' });
      say('เข้าคิวประกอบปกแล้ว — รอสัก 20-80 วิ');
      setTimeout(loadCovers, 800); setTimeout(loadCovers, 3000);
    } catch (e) { setCvErr(String(e.message || e)); }
    qcBusyRef.current = false;
    setQcBusy(false);
  };
  const delCover = async (id) => {
    setCvJobs(p => p.filter(j => j.id !== id));
    // ★ 27 ก.ค. ค่ำ: งาน "จำลอง" จากปุ่มเปลี่ยนภาพรายช่อง (frozen-…) ไม่ผ่านคิวจริง — ลบแค่ฝั่งจอ ไม่มีอะไรให้ยิงลบที่เซิร์ฟเวอร์
    if (String(id).startsWith('frozen-')) return;
    await fetch('/api/m/cover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', jobId: id }) }).catch(() => {});
    setTimeout(loadCovers, 600);
  };
  // ★ แก้บั๊ก (รีวิว 27 ก.ค. ค่ำ รอบ 2): coverImgUrl ของงาน composeFrozen เป็น data: URL (ไม่มี archivedId ให้ต่อ ?dl=1) —
  //   ต่อ ?dl=1 ตรงๆ จะได้สตริงเพี้ยน + iOS Safari บล็อกเปิด data: ระดับหน้าเต็ม → แปลงเป็น blob URL ฝั่ง client แล้ว trigger ดาวน์โหลดแทน
  const downloadDataCover = async (dataUrl) => {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl; a.download = 'cover.jpg';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    } catch {
      say('โหลดอัตโนมัติไม่ได้ — กดค้างที่ภาพเพื่อบันทึกแทน');
    }
  };

  // ══ "ปกไม่ถูกใจ" (27 ก.ค. ค่ำ, เจ้าของอนุมัติ) — 4 ฟังก์ชันใต้ปกที่เสร็จแล้ว ══
  // ★ แก้บั๊ก (รีวิว รอบ 4): say() ปกติหายใน 2.4 วิ — สั้นไปสำหรับข้อความ error จริงจาก API ที่ต้องอ่านทัน
  //   ใช้เฉพาะจุดนี้ (ไม่แตะ say() ตัวกลางที่จุดอื่นทั้งแอพพึ่งอยู่) ค้าง ~4 วิ
  const sayLong = (m, ms = 4000) => { setToast(m); setTimeout(() => setToast(''), ms); };
  // ★ 28 ก.ค. 69 (แก้บั๊ก "กดปุ่มแก้ปกแล้วไม่มีอะไรเกิด"): ครอบทุก onClick ใน renderCoverActions ด้วยตัวนี้ —
  //   จับทั้ง throw synchronous และ promise reject แล้ว sayLong เสมอ ห้ามมีทางเงียบแม้โค้ดในอนาคตพัง
  const safeClick = (fn) => async (...args) => {
    try { await fn(...args); } catch (e) { sayLong('ปุ่มขัดข้อง: ' + String(e && e.message || e)); }
  };
  // ★ แก้บั๊ก (รีวิว รอบ 3 — งานเก่ากดปุ่มแล้ว "ไม่มีอะไรเกิด"): งานที่สร้างก่อนอัปเดตนี้ไม่มี r.caseId/r.imageCaseId ติดผลงาน
  //   (quick-test เพิ่งเริ่มเก็บให้ล่าสุด) แต่มี archivedId (compose)/archiveId (ref) ชี้เข้าคลัง /mega-covers ได้เสมอ
  //   (ก) เช็ค state คลังปกที่จอโหลดไว้แล้วก่อน (cvArchive) ฟรี ไม่ต้องยิง · (ข) ไม่เจอในจอ → เจาะถามเซิร์ฟเวอร์ใบเดียว (view=archive&id=)
  const resolveCaseId = async (j) => {
    const r = j.result || {};
    if (r.caseId || r.imageCaseId) return r.caseId || r.imageCaseId;
    const archivedId = r.archivedId || r.archiveId;
    if (!archivedId) return null;
    const hit = cvArchive.find(a => a.id === archivedId);
    if (hit?.imageCaseId) return hit.imageCaseId;
    try {
      const d = await (await fetch(`/api/m/cover?view=archive&id=${encodeURIComponent(archivedId)}`, { cache: 'no-store' })).json();
      if (d.success && d.item?.imageCaseId) return d.item.imageCaseId;
    } catch { /* เน็ตสะดุด — ตกไป toast เหตุผลที่เรียกใช้ */ }
    return null;
  };
  // ① 🎲 ประกอบใหม่ทั้งปก — ยิง kind='compose' รอบใหม่ของ caseId เดิม (ทางเดียวกับ ⚡ ทางลัด) ไม่ล็อกฮีโร่/ต้นแบบ ให้สุ่มใหม่ล้วน
  const rerollCover = async (j) => {
    const key = j.id + ':reroll';
    setCvActionBusyKey(key);
    say('⏳ กำลังหาเคสต้นทาง…');
    const caseId = await resolveCaseId(j);
    if (!caseId) { sayLong('ปกนี้เป็นงานเก่าก่อนอัปเดตนี้ — ไม่มีข้อมูลเคสต้นทางให้ยิงใหม่'); setCvActionBusyKey(null); return; }
    say('⏳ กำลังส่งประกอบใหม่…');
    try {
      const d = await (await fetch('/api/m/cover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'compose', caseId }) })).json();
      if (!d.success) throw new Error(d.error || 'ส่งงานไม่สำเร็จ');
      if (d.jobId) { cvMineRef.current.add(d.jobId); setCvOpen(d.jobId); }
      log('cover_submit', d.jobId || '', { mode: 'reroll' });
      say('เข้าคิวประกอบปกใหม่แล้ว — รอสัก 20-80 วิ');
      setTimeout(loadCovers, 800); setTimeout(loadCovers, 3000);
    } catch (e) { sayLong(String(e.message || e)); }
    setCvActionBusyKey(null);
  };
  // ③ 👤 เปลี่ยนตัวเอก — เข้าถึงรายชื่อตัวละครจริงของเคสยาก (คนละระบบกับ generation-logs) ใช้ช่องพิมพ์ชื่อเองตามที่เจ้าของอนุมัติไว้ (เหมือน qcHero โหมดทางลัด)
  const sendHeroCover = async (j) => {
    const hero = cvHeroName.trim();
    if (!hero) { say('พิมพ์ชื่อตัวเอกก่อน'); return; }
    const key = j.id + ':hero';
    setCvActionBusyKey(key);
    say('⏳ กำลังหาเคสต้นทาง…');
    const caseId = await resolveCaseId(j);
    if (!caseId) { sayLong('ปกนี้เป็นงานเก่าก่อนอัปเดตนี้ — ไม่มีข้อมูลเคสต้นทาง'); setCvActionBusyKey(null); return; }
    say('⏳ กำลังส่งประกอบใหม่…');
    try {
      const d = await (await fetch('/api/m/cover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'compose', caseId, heroPersonHint: hero }) })).json();
      if (!d.success) throw new Error(d.error || 'ส่งงานไม่สำเร็จ');
      if (d.jobId) { cvMineRef.current.add(d.jobId); setCvOpen(d.jobId); }
      log('cover_submit', d.jobId || '', { mode: 'hero', hero });
      say(`เข้าคิวประกอบปก (ตัวเอก: ${hero}) แล้ว`);
      setCvActionJob(null); setCvActionMode(null); setCvHeroName('');
      setTimeout(loadCovers, 800); setTimeout(loadCovers, 3000);
    } catch (e) { sayLong(String(e.message || e)); }
    setCvActionBusyKey(null);
  };
  // ④ 🎨 เปลี่ยนต้นแบบ — โหลดลิสต์ ref "เพจจริง" จากคลัง (แคชครั้งเดียว) + สุ่ม/เลือกเอง แล้วยิง compose ใหม่พร้อม refId
  const loadCvRefs = () => {
    fetch('/api/m/cover?view=refs', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d.success) setCvRefList(d.items || []); }).catch(() => setCvRefList([]));
  };
  const sendRefCover = async (j, refId) => {
    const key = j.id + ':ref';
    setCvActionBusyKey(key);
    say('⏳ กำลังหาเคสต้นทาง…');
    const caseId = await resolveCaseId(j);
    if (!caseId) { sayLong('ปกนี้เป็นงานเก่าก่อนอัปเดตนี้ — ไม่มีข้อมูลเคสต้นทาง'); setCvActionBusyKey(null); return; }
    say('⏳ กำลังส่งประกอบใหม่…');
    try {
      const d = await (await fetch('/api/m/cover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'compose', caseId, refId }) })).json();
      if (!d.success) throw new Error(d.error || 'ส่งงานไม่สำเร็จ');
      if (d.jobId) { cvMineRef.current.add(d.jobId); setCvOpen(d.jobId); }
      log('cover_submit', d.jobId || '', { mode: 'ref', refId });
      say('เข้าคิวประกอบปกต้นแบบใหม่แล้ว');
      setCvActionJob(null); setCvActionMode(null);
      setTimeout(loadCovers, 800); setTimeout(loadCovers, 3000);
    } catch (e) { sayLong(String(e.message || e)); }
    setCvActionBusyKey(null);
  };
  const pickRandomRef = (j) => {
    if (!cvRefList || !cvRefList.length) return;
    const pick = cvRefList[Math.floor(Math.random() * cvRefList.length)];
    sendRefCover(j, pick.id);
  };
  // ② 🖼️ เปลี่ยนภาพรายช่อง — เปิดกริดภาพจากเคส (คลังเดียวกับ "🖼 ดูภาพเคส" โหมดทางลัด) แตะเลือกแทนช่องที่กำลังแก้
  const ensureCaseImages = (caseId) => {
    if (!caseId || caseImgList[caseId] !== undefined) return;
    fetch(`/api/m/cover?view=caseImages&caseId=${encodeURIComponent(caseId)}&limit=60`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setCaseImgList(m => ({ ...m, [caseId]: (d && d.success && Array.isArray(d.items)) ? d.items : [] })))
      .catch(() => setCaseImgList(m => ({ ...m, [caseId]: [] })));
  };
  // แตะภาพในกริด → ยิงประกอบใหม่แบบ "แผนแช่แข็ง" (ของเดิมทุกช่อง แทนที่เฉพาะช่องที่เลือก) ผ่าน kind='composeFrozen'
  //   หมายเหตุ item③ ของรีวิว: ปุ่มนี้ disabled อยู่แล้วเมื่อไม่มี slotPlanUsed (canSlots) ซึ่งงานที่มี slotPlanUsed ย่อมมี caseId ติดมาด้วยเสมอ
  //   (มาจากจุด mapping เดียวกันใน quick-test) — ยังคง resolveCaseId ไว้เป็นตาข่ายกันพลาดชั้นสอง
  // ★ แก้บั๊ก (รีวิว รอบ 4 — "แตะภาพในกริดแล้วเงียบ"): ไล่ทุกจุดที่เคยคืนเงียบ (return เปล่า) → ต้อง sayLong เสมอ ห้ามเงียบเด็ดขาด
  //   ต้นตอตัวจริงคือ onClick ในกริด/ปุ่มอื่นอ้าง cvActionBusy (ตัวแปรเก่าที่เพิ่งเปลี่ยนชื่อเป็น cvActionBusyKey) — undefined ทำ throw
  //   เงียบตอนคลิก (ReferenceError ถูก React กลืนไม่ขึ้น error แดง) → แก้ครบทุกจุดอ้างอิงแล้ว (ดู renderCoverActions)
  const pickSlotImage = async (j, role, url) => {
    const r = j.result || {};
    const refId = r.refUsed?.id;
    const base = Array.isArray(r.slotPlanUsed) ? r.slotPlanUsed : [];
    if (!refId) { sayLong('ปกนี้ไม่มีข้อมูลต้นแบบ (refId) — ลองกดประกอบใหม่ก่อน'); return; }
    if (!base.length) { sayLong('ปกนี้ไม่มีข้อมูลผังช่อง — ลองกดประกอบใหม่ก่อน'); return; }
    const key = j.id + ':slot:' + role;
    setCvActionBusyKey(key);
    const caseId = await resolveCaseId(j);
    if (!caseId) { sayLong('ปกนี้เป็นงานเก่าก่อนอัปเดตนี้ — ไม่มีข้อมูลเคสต้นทาง'); setCvActionBusyKey(null); return; }
    const idx = base.findIndex(e => e.slot === role);
    const nextPlan = base.map(e => ({ ...e }));
    if (idx >= 0) nextPlan[idx] = { url, slot: role, isHero: role === 'hero' };
    else nextPlan.push({ url, slot: role, isHero: role === 'hero' });
    if (role === 'hero') nextPlan.forEach((e, i) => { if (i !== (idx >= 0 ? idx : nextPlan.length - 1)) e.isHero = false; });
    if (nextPlan.length < 3) { sayLong('ผังช่องน้อยเกินไป (ต้อง ≥3 ช่อง) — ประกอบใหม่ทั้งปกก่อนแล้วค่อยลองสลับช่อง'); setCvActionBusyKey(null); return; }
    try {
      const r2 = await fetch('/api/m/cover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'composeFrozen', caseId, refId, slotPlan: nextPlan }) });
      const d = await r2.json().catch(() => ({ success: false, error: `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${r2.status})` }));
      if (!d.success) throw new Error(d.error || `ประกอบใหม่ไม่สำเร็จ (${r2.status})`);
      // ★ งานนี้ไม่ผ่านคิว quick-test (frozen mode ยิงตรง compose-test — ดู /api/m/cover) → สร้าง "งานจำลอง" ใส่แถบงานเองให้ดูเหมือนงานปกติ
      const jr = d.result || {};
      if (!jr.coverImgUrl) { sayLong('ประกอบเสร็จแต่ไม่ได้ภาพกลับมา (base64 ว่าง) — ลองใหม่อีกครั้ง'); setCvActionBusyKey(null); return; }
      const fakeId = 'frozen-' + Date.now();
      setCvJobs(list => [{ id: fakeId, kind: 'compose', label: '🖼️ เปลี่ยนภาพรายช่อง', status: 'done', dispatch: 'local', result: jr }, ...list]);
      setCvOpen(fakeId);
      setCvActionJob(null); setCvActionMode(null); setCvSlotRole(null);
      say('ประกอบใหม่เสร็จแล้ว — ดูผลด้านบน');
      log('cover_submit', fakeId, { mode: 'slotSwap', role });
    } catch (e) { sayLong(String(e.message || e)); }
    setCvActionBusyKey(null);
  };
  const coverFromNews = () => {
    setCvTitle(result?.title || '');
    setCvContent(text || cur?.content || '');
    setTab('cover');
    say('ใส่เนื้อจากข่าวให้แล้ว — กดทำปกได้เลย');
  };

  // ═══ โต๊ะข่าว (v1) ═══
  // ★ 27 ก.ค. 69 (ชุดนี้): 3 ปุ่มนี้ → งานเบื้องหลังผ่านคิว /api/quick-test (เหมือนทำปก) — กดแล้วปิดจอได้เลย
  //   ไม่รอ response ยาวอีกต่อไป (/api/m/desk คืน {jobId} ทันที) ผลจริงมาทีหลังผ่าน loadDeskJobs (โพล + toast อัตโนมัติ)
  const runDeskHarvest = async (mode) => {
    // ★ 27 ก.ค. 69 (เจ้าของสั่ง): แท็บโต๊ะข่าวเปิดให้ทุกคนที่ล็อกอินใช้ได้แล้ว — ตัด isAdmin guard ออก
    setDeskHarvestBusy(true); setDeskModeOpen(false);
    try {
      const d = await (await fetch('/api/m/desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'harvest', mode }),
      })).json();
      if (!d.success) throw new Error(d.error || 'ล่าข่าวไม่สำเร็จ');
      if (d.jobId) deskMineRef.current.add(d.jobId);
      say('🗞️ เข้าคิวแล้ว — ปิดจอได้ เดี๋ยวผลมาเอง');
      setTimeout(loadDeskJobs, 800); setTimeout(loadDeskJobs, 3000);
    } catch (e) { say('❌ ' + String(e.message || e)); }
    setDeskHarvestBusy(false);
  };
  const runDeskChief = async () => {
    // ★ 27 ก.ค. 69 (เจ้าของสั่ง): แท็บโต๊ะข่าวเปิดให้ทุกคนที่ล็อกอินใช้ได้แล้ว — ตัด isAdmin guard ออก
    setDeskChiefBusy(true);
    try {
      const d = await (await fetch('/api/m/desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chief' }),
      })).json();
      if (!d.success) throw new Error(d.error || 'บก.ใหญ่ทำงานไม่สำเร็จ');
      if (d.jobId) deskMineRef.current.add(d.jobId);
      say('🧠 เข้าคิวแล้ว — ปิดจอได้ เดี๋ยวผลมาเอง');
      setTimeout(loadDeskJobs, 800); setTimeout(loadDeskJobs, 3000);
    } catch (e) { say('❌ ' + String(e.message || e)); }
    setDeskChiefBusy(false);
  };
  // ★ 27 ก.ค. 69: ช่องค้นเอง — ใส่ชื่อคน/แนว → เข้าคิว desk_search ผ่านประตู action 'searchKeyword' (ไม่ sync ค้างจอแล้ว)
  const runDeskSearch = async () => {
    // ★ 27 ก.ค. 69 (เจ้าของสั่ง): แท็บโต๊ะข่าวเปิดให้ทุกคนที่ล็อกอินใช้ได้แล้ว — ตัด isAdmin guard ออก
    const kw = deskSearchKw.trim();
    if (kw.length < 2) { say('ใส่ชื่อคน/แนวอย่างน้อย 2 ตัวอักษร'); return; }
    if (kw.length > 60) { say('ยาวเกินไป (สูงสุด 60 ตัวอักษร)'); return; }
    setDeskSearchBusy(true);
    try {
      const d = await (await fetch('/api/m/desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'searchKeyword', keyword: kw }),
      })).json();
      if (!d.success) throw new Error(d.error || 'ค้นข่าวไม่สำเร็จ');
      if (d.jobId) deskMineRef.current.add(d.jobId);
      say('🔎 เข้าคิวแล้ว — ปิดจอได้ เดี๋ยวผลมาเอง');
      setDeskSearchKw('');
      setTimeout(loadDeskJobs, 800); setTimeout(loadDeskJobs, 3000);
    } catch (e) { say('❌ ' + String(e.message || e)); }
    setDeskSearchBusy(false);
  };
  const deskCardAction = async (item, cardAction) => {
    setDeskCardBusy(p => ({ ...p, [item.id]: cardAction }));
    try {
      const d = await (await fetch('/api/m/desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'card', cardAction, id: item.id }),
      })).json();
      if (!d.success) throw new Error(d.error || 'ทำรายการไม่สำเร็จ');
      if (cardAction === 'dismiss') {
        setDeskItems(prev => prev.filter(x => x.id !== item.id));
        if (deskExpanded === item.id) setDeskExpanded(null);
        log('desk_dismiss', item.id, {});
        say('🗑 ทิ้งข่าวนี้แล้ว');
      } else if (cardAction === 'sendWorkflow') {
        setDeskItems(prev => prev.map(x => x.id === item.id ? { ...x, status: 'sent' } : x));
        log('desk_send', item.id, { jobId: d.jobId || null });
        say(`✅ ส่งเข้าคิวเขียนแล้ว (คิวที่ ${d.position ?? '-'})`);
        setDeskExpanded(null);
      }
    } catch (e) { say('❌ ' + String(e.message || e)); }
    setDeskCardBusy(p => { const n = { ...p }; delete n[item.id]; return n; });
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

  // ★ 27 ก.ค. 69: คลังปกล่าสุด — โชว์ซ้ำในโหมด auto/quick (เลย์เอาต์เดียวกับคลังในโหมดแต่งเอง ของ CoverEditor.js)
  //   คำนวณครั้งเดียวต่อ render ใช้ซ้ำ 2 จุด กัน copy-paste JSX ก้อนใหญ่
  const coverArchiveBlock = (
    <>
      <div className="row" style={{ alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>🖼️ คลังปกล่าสุด</h2>
        <button className="gh" style={{ width: 'auto', padding: '5px 12px', fontSize: 12, marginLeft: 'auto' }} onClick={loadCoverArchive}>🔄 รีเฟรช</button>
      </div>
      {cvArchive.length === 0 && <p className="sub">ยังไม่มีปกในคลัง</p>}
      {cvArchive.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
        {cvArchive.map(a => (
          <a key={a.id} href={`/api/mega-covers/img?id=${encodeURIComponent(a.id)}`} target="_blank" rel="noreferrer" style={{ display: 'block', position: 'relative' }}>
            <img src={`/api/mega-covers/img?id=${encodeURIComponent(a.id)}`} alt={a.title || a.id} loading="lazy"
              style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
            {/* ★ 27 ก.ค. 69 (นโยบาย "เก็บทุกใบ+ติดป้ายสถานะ"): ใบที่ QC ไม่ผ่านยังเข้าคลัง แต่ติดป้ายเตือนให้คนตรวจก่อนใช้จริง */}
            {a.qcStatus === 'manual_review' && (
              <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 9.5, fontWeight: 800, color: 'var(--warn)', background: 'var(--warnS)', borderRadius: 5, padding: '2px 5px', lineHeight: 1.4 }}>
                รอตรวจ
              </span>
            )}
          </a>
        ))}
      </div>}
    </>
  );

  // ★ 27 ก.ค. ค่ำ (เจ้าของอนุมัติ — "ปกไม่ถูกใจ"): ปุ่ม 4 ฟังก์ชัน + แผงย่อยของงานปกที่เสร็จแล้ว 1 ใบ
  //   ใช้ซ้ำ 2 จุด (โหมด 🤖 ให้ AI หา / ⚡ ทางลัด — job-list JSX เดิมก็ซ้ำกันอยู่แล้ว) กัน copy-paste ก้อนใหญ่
  const renderCoverActions = (j) => {
    if (j.status !== 'done') return null;
    const r = j.result || {};
    const effCaseId = r.caseId || r.imageCaseId; // ★ ref-kind jobs เก็บ caseId ไว้คนละชื่อฟิลด์ (imageCaseId) — รวมเป็นตัวเดียวให้ปุ่มใช้ได้ทั้งคู่
    const canSlots = !!(r.slotPlanUsed?.length && r.refUsed?.id);
    const busy = !!cvActionBusyKey; // ★ แก้บั๊ก (รีวิว รอบ 3): ปุ่มอื่นยัง disabled เหมือนเดิม แต่ปุ่มที่กดจริงขึ้น "⏳" ให้เห็นชัด (เทียบ key ด้านล่าง)
    return (
      <>
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
          <button className="gh" style={{ flex: '1 1 auto', minHeight: 44, fontSize: 12.5 }} disabled={busy} onClick={safeClick(() => rerollCover(j))}>
            {cvActionBusyKey === j.id + ':reroll' ? '⏳ กำลังทำ…' : '🎲 ประกอบใหม่ทั้งปก'}
          </button>
          {/* ★ แก้บั๊ก (รีวิว รอบ 5): เอา !canSlots ออกจาก disabled — เดิมกดไม่ได้แบบเงียบๆ เมื่องานมาจากท่อเต็ม (kind=ref ไม่เก็บ slotPlanUsed โดยดีไซน์)
              ตอนนี้กดได้เสมอ (แค่ busy ปิด) แล้วเช็ค canSlots ข้างในแทน — ไม่พร้อมก็ยัง sayLong บอกเหตุผล+ทางแก้ ไม่เงียบ */}
          <button className="gh" style={{ flex: '1 1 auto', minHeight: 44, fontSize: 12.5 }} disabled={busy}
            onClick={safeClick(() => {
              if (!canSlots) { sayLong('ปกใบนี้มาจากท่อเต็ม — ไม่ได้เก็บผังช่องไว้ · กด "🎲 ประกอบใหม่ทั้งปก" ก่อน แล้วค่อยสลับภาพรายช่องจากใบใหม่'); return; }
              const on = cvActionJob === j.id && cvActionMode === 'slots'; setCvActionJob(on ? null : j.id); setCvActionMode(on ? null : 'slots'); setCvSlotRole(null); if (!on && effCaseId) ensureCaseImages(effCaseId);
            })}>
            🖼️ เปลี่ยนภาพรายช่อง
          </button>
          <button className="gh" style={{ flex: '1 1 auto', minHeight: 44, fontSize: 12.5 }} disabled={busy}
            onClick={safeClick(() => { const on = cvActionJob === j.id && cvActionMode === 'hero'; setCvActionJob(on ? null : j.id); setCvActionMode(on ? null : 'hero'); setCvHeroName(''); })}>
            👤 เปลี่ยนตัวเอก
          </button>
          <button className="gh" style={{ flex: '1 1 auto', minHeight: 44, fontSize: 12.5 }} disabled={busy}
            onClick={safeClick(() => { const on = cvActionJob === j.id && cvActionMode === 'ref'; setCvActionJob(on ? null : j.id); setCvActionMode(on ? null : 'ref'); if (!on && cvRefList === null) loadCvRefs(); })}>
            🎨 เปลี่ยนต้นแบบ
          </button>
        </div>
        {!canSlots && <p className="sub" style={{ marginTop: 4, fontSize: 11 }}>* ปกใบนี้มาจากท่อเต็ม (kind=ref) — ไม่ได้เก็บผังช่องไว้ · แตะ &quot;🖼️ เปลี่ยนภาพรายช่อง&quot; จะเห็นเหตุผล + ทางแก้</p>}

        {cvActionJob === j.id && cvActionMode === 'slots' && (
          <div ref={cvPanelRef} style={{ marginTop: 8, padding: '10px 8px', border: '1px solid var(--line)', borderRadius: 12 }}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {SLOT_ROLES.map(sr => {
                const cur = (r.slotPlanUsed || []).find(e => e.slot === sr.key);
                const on = cvSlotRole === sr.key;
                return (
                  <button key={sr.key} className="gh" style={{ minHeight: 44, padding: '6px 10px', fontSize: 12, borderColor: on ? 'var(--pink)' : undefined, color: on ? 'var(--pink)' : undefined }}
                    onClick={safeClick(() => setCvSlotRole(sr.key))}>
                    {cur?.url && <img src={cur.url} alt="" style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover', verticalAlign: 'middle', marginRight: 5 }} />}
                    {sr.label}
                  </button>
                );
              })}
            </div>
            {cvSlotRole && (() => {
              const imgs = caseImgList[effCaseId];
              const curForRole = (r.slotPlanUsed || []).find(e => e.slot === cvSlotRole);
              const slotKey = j.id + ':slot:' + cvSlotRole;
              const slotBusy = cvActionBusyKey === slotKey;
              return (
                <>
                  <p className="sub" style={{ margin: '0 0 6px' }}>แตะภาพเพื่อแทนช่อง &quot;{SLOT_ROLES.find(s => s.key === cvSlotRole)?.label}&quot;</p>
                  {/* ★ แก้บั๊ก (รีวิว รอบ 4): ต้องเห็นสถานะ "กำลังประกอบ" ค้างตลอดช่วง ~20-30 วิ ไม่ใช่แค่ toast แวบเดียว */}
                  {slotBusy && <p className="sub" style={{ margin: '0 0 6px', color: 'var(--pink)', fontWeight: 700 }}>⏳ กำลังประกอบช่องใหม่… (ปกติ 20-30 วิ — อย่าเพิ่งปิดหน้านี้)</p>}
                  {imgs === undefined && <p className="sub" style={{ margin: 0 }}>⏳ กำลังโหลดภาพ…</p>}
                  {Array.isArray(imgs) && imgs.length === 0 && <p className="sub" style={{ margin: 0 }}>ไม่มีภาพในเคสนี้</p>}
                  {Array.isArray(imgs) && imgs.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, opacity: busy ? 0.55 : 1 }}>
                      {imgs.map((im, i) => {
                        const isCurrent = !!curForRole?.url && curForRole.url === im.url;
                        return (
                          <div key={im.id || im.url || i} onClick={safeClick(() => { if (!busy) return pickSlotImage(j, cvSlotRole, im.url); })} style={{ cursor: busy ? 'wait' : 'pointer' }}>
                            <img src={im.url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                              style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8, border: isCurrent ? '3px solid var(--pink)' : '1px solid var(--line)', display: 'block' }} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {cvActionJob === j.id && cvActionMode === 'hero' && (
          <div ref={cvPanelRef} style={{ marginTop: 8, padding: '10px 8px', border: '1px solid var(--line)', borderRadius: 12 }}>
            <input ref={cvHeroInputRef} className="in" style={{ marginBottom: 8 }} value={cvHeroName} onChange={e => setCvHeroName(e.target.value)} placeholder="ชื่อตัวเอกคนใหม่…" autoFocus />
            <button className="cta" style={{ minHeight: 44 }} disabled={busy || !cvHeroName.trim()} onClick={safeClick(() => sendHeroCover(j))}>
              {cvActionBusyKey === j.id + ':hero' ? '⏳ กำลังส่ง…' : '✅ ประกอบใหม่ด้วยตัวเอกนี้'}
            </button>
          </div>
        )}

        {cvActionJob === j.id && cvActionMode === 'ref' && (
          <div ref={cvPanelRef} style={{ marginTop: 8, padding: '10px 8px', border: '1px solid var(--line)', borderRadius: 12 }}>
            <button className="gh" style={{ minHeight: 44, marginBottom: 8 }} disabled={busy || !cvRefList?.length} onClick={safeClick(() => pickRandomRef(j))}>
              {cvActionBusyKey === j.id + ':ref' ? '⏳ กำลังส่ง…' : '🎲 สุ่มต้นแบบ'}
            </button>
            {cvRefList === null && <p className="sub">⏳ กำลังโหลดรายชื่อต้นแบบ…</p>}
            {Array.isArray(cvRefList) && cvRefList.length === 0 && <p className="sub">ยังไม่มีต้นแบบในคลัง</p>}
            {Array.isArray(cvRefList) && cvRefList.map(ref => (
              <div key={ref.id} className="job" style={{ marginBottom: 6, opacity: busy ? 0.55 : 1 }} onClick={safeClick(() => { if (!busy) return sendRefCover(j, ref.id); })}>
                <span className="ava">🎨</span>
                <div style={{ overflow: 'hidden' }}>
                  <p className="tt" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ref.title || ref.styleName}</p>
                  <p className="mm">{ref.likes ? `${ref.likes} ไลค์` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  // จอกันเหนียว: ยังไม่ล็อกอิน (ปกติเว็บพาไปหน้า login เองอยู่แล้ว)
  if (sessChecked && !member) {
    return (<div className="vf"><style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap" style={{ paddingTop: 80, textAlign: 'center' }}>
        <div className="mk" style={{ margin: '0 auto 12px', width: 52, height: 52, fontSize: 24 }}>⚡</div>
        <h1>รวมไอจีดารา</h1>
        <p className="sub">ต้องล็อกอินด้วยยูสพนักงานก่อนใช้งาน</p>
        <a className="cta" style={{ textDecoration: 'none', maxWidth: 260, margin: '0 auto' }} href="/login?next=/m">ไปหน้าล็อกอิน</a>
      </div></div>);
  }

  return (
    <div className="vf">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="hdr">
        <span className="mk">⚡</span><span className="hname">รวมไอจีดารา</span>
        <span className="livepill"><span className="dotb" />{ov ? (ov.busy || ov.processing > 0 ? `คิวทำงาน ${ov.processing}` : 'คิวว่าง') : 'LIVE'}</span>
        <button className="meBtn" aria-label="โปรไฟล์ของฉัน" onClick={() => setTab('me')}>{(member?.displayName || '?').slice(0, 1)}</button>
      </div>
      {/* ★ 28 ก.ค. 69 (รอบ 2 — ยกเป็น global ทั้งแอพ): แบนเนอร์รุ่นใหม่ ย้ายจากในแท็บปกมาไว้ใต้ header แสดงทุกแท็บ
          sticky top:0 ต่อจากเฮดเดอร์ที่ sticky top:0 อยู่แล้ว — เบราว์เซอร์วางซ้อนสติกกี้ให้เอง (โผล่ใต้เฮดเดอร์เสมอ ไม่ทับ safe-area/notch) */}
      {cvOutdated && (
        <button onClick={() => window.location.reload()}
          style={{ position: 'sticky', top: 0, zIndex: 4, display: 'block', width: '100%', border: 0, cursor: 'pointer',
            background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
            padding: '10px 16px', textAlign: 'center' }}>
          📦 แอพรุ่นใหม่ออกแล้ว — แตะที่นี่เพื่อโหลดใหม่
        </button>
      )}

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
          {/* 🛑 31 ก.ค. 69 (เจ้าของสั่ง): ปุ่ม "ทำปกจากข่าวนี้" ถูกถอดพร้อมแท็บทำปก — ท่อ MEGA ปิดใช้งาน
          <button className="gh" style={{ marginBottom: 9 }} onClick={coverFromNews}>🖼️ ทำปกจากข่าวนี้</button> */}
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

        {clipPhase === 'done' && insight && (() => {
          const baseTopics = insightTopics(insight);
          const topics = effectiveTopics(insight);
          // ★ 27 ก.ค. ค่ำ: ยกเลิก singleRawDup (item 8 เดิม) — เจ้าของสั่ง "เหมือนเว็บ 100%" กรอบเทาต้องโชว์เสมอแม้เนื้อซ้ำการ์ดประเด็น
          return <>
          {/* ★ 27 ก.ค. 69 (เจ้าของอนุมัติ — ครบเท่าเว็บ /clip-transcript): ป้ายหมวด + หัวเรื่อง + เมตา + ปุ่มเปิดคลิป/คัดลอก */}
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {insight.clipTypeLabel && <span className="chip cpk">{insight.emoji || '🎬'} {insight.clipTypeLabel}</span>}
            {(insightMeta?.category || insight.category) && <span className="chip" style={{ background: 'var(--warnS)', color: 'var(--warn)' }}>📂 {insightMeta?.category || insight.category}</span>}
            <span className="chip cmu">{String(insight.engine || '').includes('gemini-video') ? '👁️ Gemini ดูคลิป' : '📝 จากบทถอดเสียง'}</span>
            {insight.multiTopic && <span className="chip" style={{ background: 'var(--warnS)', color: 'var(--warn)' }}>📚 คลิปยาว · {insight.totalTopics || insight.topics?.length || 0} ประเด็น</span>}
          </div>

          {/* ★ item 2: ป้าย ⚡ ผลจากคลัง — เท่าเว็บ (เฉพาะทางสด insight.cached เพราะเคสจากคลังไม่ได้เก็บฟิลด์นี้) */}
          {insight.cached && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, padding: '9px 12px', borderRadius: 9, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.3)', color: '#22c55e', marginTop: 9 }}>
              ⚡ <b>ผลจากคลัง</b> — คลิปนี้เคยถอดไว้แล้ว{insight.cachedAt ? ` เมื่อ ${fmtTime(insight.cachedAt)}` : ''} (ไม่เสียเวลา/ค่าถอดซ้ำ)
            </div>
          )}

          {insight.headline && <p className="tt" style={{ fontSize: 16, marginTop: 9 }}>📌 {insight.headline}</p>}
          {insight.speakers?.length > 0 && <p className="mm" style={{ marginTop: 4 }}>🗣️ ผู้พูด: {insight.speakers.join(', ')}</p>}
          {insight.usageNote && <p className="bd" style={{ fontSize: 12.5, color: '#a78bfa', marginTop: 8, padding: '8px 11px', background: 'rgba(124,58,237,.07)', borderRadius: 8 }}>💡 {insight.usageNote}</p>}

          <p className="mm" style={{ marginTop: 8 }}>
            {insightMeta?.platform ? `${{ youtube: '📺 YouTube', tiktok: '🎵 TikTok', meta: '📘 Facebook/IG' }[insightMeta.platform] || insightMeta.platform} · ` : ''}
            {topics.length} ประเด็น
            {insight.subStories?.length ? ` · 🧩 ${insight.subStories.length} เนื้อดิบแยก` : ''}
            {insightMeta?.user ? ` · 👤 ${insightMeta.user}` : ''}
            {insightMeta?.createdAt ? ` · ${fmtTime(insightMeta.createdAt)}` : ''}
          </p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 9, marginBottom: 2 }}>
            {insightMeta?.url && <a className="lnk" href={insightMeta.url} target="_blank" rel="noreferrer">🔗 เปิดคลิป</a>}
            {insight.rawData && <button className="gh" style={{ width: 'auto', padding: '6px 14px', fontSize: 12.5 }} onClick={() => copyText(insight.rawData, insight.id || '')}>📋 คัดลอกข้อมูลดิบ</button>}
            <button className="gh" style={{ width: 'auto', padding: '6px 14px', fontSize: 12.5 }} onClick={() => copyText(clipAllText(insight), insight.id || '')}>📋 คัดลอกทั้งหมด</button>
          </div>
          {insight.overview && <p className="bd" style={{ fontSize: 13.5, marginTop: 6, marginBottom: 6 }}>{insight.overview}</p>}

          {/* ★ item 2: keyPoints / quotes / timeline — บล็อกที่เว็บมีแต่แอพเคยขาด */}
          {insight.keyPoints?.length > 0 && (
            <div style={{ marginTop: 10, marginBottom: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)', marginBottom: 6 }}>🎯 ประเด็นสำคัญ ({insight.keyPoints.length})</p>
              {insight.keyPoints.map((k, i) => (
                <div key={i} style={{ padding: '9px 11px', borderRadius: 9, background: 'var(--card)', borderLeft: '3px solid #2563eb', marginBottom: 6 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>{i + 1}. {k.point}</p>
                  {k.detail && <p className="mm" style={{ marginTop: 3 }}>{k.detail}</p>}
                </div>
              ))}
            </div>
          )}
          {/* ★ 27 ก.ค. ค่ำ (เจ้าของชี้ "กรอบเทาไม่มา ต้องเหมือนเว็บ 100%"): กล่องเทาเนื้อดิบรวม โชว์เต็มเสมอ
              ตำแหน่งเดียวกับเว็บเป๊ะ (คั่นระหว่างประเด็นสำคัญ กับ คำพูดสำคัญ) — เลิกพับซ่อน/เลิกเงื่อนไขข้าม
              ★ 27 ก.ค. ค่ำ (เจ้าของสั่งตรง): เพิ่มดินสอแก้ก่อนส่ง + ปุ่มส่งกรอบนี้เข้าเขียนข่าวตรง — คัดลอกยังใช้ต้นฉบับ AI เดิมเสมอ */}
          {insight.rawData && (
            <div style={{ marginTop: 10, marginBottom: 4 }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {rawEdit != null && <span className="chip cpk" style={{ fontSize: 10 }}>✏️ แก้แล้ว</span>}
                </div>
                <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                  {rawEdit != null && (
                    <button className="gh" title="คืนค่าเดิม" style={{ width: 40, height: 40, padding: 0, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onClick={() => setRawEdit(null)}>↩︎</button>
                  )}
                  <button className="gh" title="แก้ไขก่อนส่ง" style={{ width: 40, height: 40, padding: 0, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={openRawEditor}>✏️</button>
                </div>
              </div>
              <div className="bd" style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>{rawEdit ?? insight.rawData}</div>
              <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <button className="gh" style={{ width: 'auto', padding: '5px 12px', fontSize: 11.5 }} onClick={() => copyText(insight.rawData, insight.id || '')}>📋 คัดลอกข้อมูลดิบ</button>
                <button className="gh" style={{ width: 'auto', padding: '5px 12px', fontSize: 11.5, borderColor: 'var(--pink)', color: 'var(--pink)' }} onClick={sendRawToWrite}>🚀 ส่งกรอบนี้เข้าเขียนข่าว</button>
              </div>
            </div>
          )}
          {insight.quotes?.length > 0 && (
            <div style={{ marginTop: 10, marginBottom: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)', marginBottom: 6 }}>💬 คำพูดสำคัญ</p>
              {insight.quotes.map((q, i) => (
                <div key={i} style={{ fontSize: 12.5, padding: '7px 10px', marginBottom: 5, borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,.06)', borderRadius: 7 }}>&ldquo;{q}&rdquo;</div>
              ))}
            </div>
          )}
          {insight.timeline?.length > 0 && (
            <div style={{ marginTop: 10, marginBottom: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)', marginBottom: 6 }}>⏱️ ช่วงจังหวะในคลิป</p>
              {insight.timeline.map((tl, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, fontSize: 12.5, marginBottom: 3 }}>
                  <span style={{ color: '#60a5fa', fontWeight: 700, minWidth: 78, flexShrink: 0 }}>{tl.time || '—'}</span>
                  <span style={{ color: 'var(--mut)' }}>{tl.topic}</span>
                </div>
              ))}
            </div>
          )}

          <h2>เจอ {topics.length} ประเด็น — แตะเลือกแล้วส่งเขียน</h2>
          {topics.map((t, i) => (
            <div key={i} className={'topic' + (selTopics.includes(i) ? ' sel' : '')} onClick={() => setSelTopics(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i])}>
              <span className="num">{t.no}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="tx" style={{ overflowWrap: 'anywhere' }}>{t.topic}</p>
                    {topicEdits[i] && <span className="chip cpk" style={{ fontSize: 10, marginTop: 4, display: 'inline-block' }}>✏️ แก้แล้ว</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                    {topicEdits[i] && (
                      <button className="gh" title="คืนค่าเดิม" style={{ width: 40, height: 40, padding: 0, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={e => { e.stopPropagation(); setTopicEdits(m => { const n = { ...m }; delete n[i]; return n; }); }}>↩︎</button>
                    )}
                    <button className="gh" title="แก้ไขก่อนส่ง" style={{ width: 40, height: 40, padding: 0, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onClick={e => { e.stopPropagation(); startEditTopic(i); }}>✏️</button>
                  </div>
                </div>
                {t.time && <p className="du">ช่วง {t.time}</p>}
                {t.raw && <details className="raw" onClick={e => e.stopPropagation()}><summary>เนื้อดิบ ({t.raw.length} ตัวอักษร)</summary><div>{t.raw}</div>
                  <button className="gh" style={{ width: 'auto', padding: '6px 14px', fontSize: 12.5, marginTop: 7 }} onClick={e => { e.stopPropagation(); copyText(`${t.topic}${t.time ? ` (ช่วง ${t.time})` : ''}\n\n${t.raw}`); }}>📋 คัดลอกประเด็นนี้</button>
                </details>}
              </div>
            </div>
          ))}

          {/* ★ item 1: แถบเตือนแดง — ธงคุณภาพไม่สมบูรณ์ เหนือปุ่มส่ง เท่าเว็บ */}
          {insightMeta?.lowQuality && <div className="err">⚠️ {insightMeta.qualityNote || 'ผลอาจไม่สมบูรณ์ — แนะนำกดถอดใหม่'}</div>}
          <button className="cta" style={{ marginTop: 6 }} onClick={sendTopicsToWrite}>ส่งประเด็นที่เลือกเข้าเขียนข่าว</button>

          {/* ★ item 2: subStories เต็มกล่อง (ไม่ใช่แค่ตัวนับ) — เท่าเว็บ */}
          {insight.subStories?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24', marginBottom: 9 }}>🧩 เนื้อดิบแยกประเด็น ({insight.subStories.length}) — แต่ละอันพร้อมเขียนเป็นข่าวเดี่ยว</p>
              {insight.subStories.map((s, i) => (
                <div key={i} style={{ border: '1px solid rgba(245,158,11,.3)', borderRadius: 10, padding: 11, background: 'rgba(245,158,11,.05)', marginBottom: 10 }}>
                  <p style={{ fontSize: 13, fontWeight: 800 }}>ประเด็น {s.no || i + 1}: {s.topic}{s.timeRange ? ` (${s.timeRange})` : ''}</p>
                  <div className="bd" style={{ fontSize: 12.5, marginTop: 6, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>{s.rawData}</div>
                  {s.keyPoints?.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--mut)' }}>{s.keyPoints.map((k, j) => <li key={j}>{k}</li>)}</ul>}
                  {s.quotes?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {s.quotes.map((q, j) => <div key={j} style={{ fontSize: 12, padding: '5px 9px', marginBottom: 4, borderLeft: '2px solid #22c55e', background: 'rgba(34,197,94,.06)', borderRadius: 6 }}>&ldquo;{q}&rdquo;</div>)}
                    </div>
                  )}
                  <button className="gh" style={{ width: 'auto', padding: '5px 12px', fontSize: 11.5, marginTop: 7 }}
                    onClick={() => copyText(`${s.topic}\n\n${s.rawData}${s.quotes?.length ? '\n\nคำพูด:\n' + s.quotes.map(q => `"${q}"`).join('\n') : ''}`)}>📋 คัดลอก</button>
                </div>
              ))}
            </div>
          )}

          {/* ★ เนื้อดิบมีมิติ (transcriptQuotes) — กรอบม่วง เท่าเว็บ · item 3: เปิดกรอบเมื่อมี transcriptQuotes อยู่จริง (กัน punchyQuotes/transcript เดี่ยวๆ หายทั้งกรอบ) */}
          {insight.transcriptQuotes && (
            <div style={{ marginTop: 14, border: '1px solid rgba(124,58,237,.3)', background: 'rgba(124,58,237,.06)', borderRadius: 14, padding: 13 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa', marginBottom: 4 }}>🎙️ เนื้อดิบมีมิติ — ประเด็น + คำพูดจริง (ไม่รวมเพลง)</p>
              <p style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 10 }}>Gemini ถอดคำพูดจริงมาถักทอกับประเด็นข่าว · AI ถอด—โปรดตรวจชื่อ/คำเฉพาะ{insight.transcriptQuotes.note ? ` · ${insight.transcriptQuotes.note}` : ''}</p>
              {/* ★ 27 ก.ค. ค่ำ (เจ้าของสั่งตรง): ดินสอแก้ก่อนส่ง + ปุ่มส่งกรอบนี้เข้าเขียนข่าวตรง — เฉพาะเนื้อหลัก enrichedRaw เท่านั้น
                  (enrichedTopics/punchyQuotes/transcript ด้านล่างคงพฤติกรรมเดิม ไม่แตะ) · คัดลอกยังใช้ต้นฉบับ AI เดิมเสมอ */}
              {insight.transcriptQuotes.enrichedRaw && (
                <div style={{ marginBottom: 6 }}>
                  <div className="row" style={{ alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {purpleEdit != null && <span className="chip cpk" style={{ fontSize: 10 }}>✏️ แก้แล้ว</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                      {purpleEdit != null && (
                        <button className="gh" title="คืนค่าเดิม" style={{ width: 40, height: 40, padding: 0, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => setPurpleEdit(null)}>↩︎</button>
                      )}
                      <button className="gh" title="แก้ไขก่อนส่ง" style={{ width: 40, height: 40, padding: 0, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={openPurpleEditor}>✏️</button>
                    </div>
                  </div>
                  <div className="bd" style={{ fontSize: 13 }}>{purpleEdit ?? insight.transcriptQuotes.enrichedRaw}</div>
                  <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button className="gh" style={{ width: 'auto', padding: '6px 14px', fontSize: 12.5 }} onClick={() => copyText(insight.transcriptQuotes.enrichedRaw)}>📋 คัดลอกกรอบนี้</button>
                    <button className="gh" style={{ width: 'auto', padding: '6px 14px', fontSize: 12.5, borderColor: 'var(--pink)', color: 'var(--pink)' }} onClick={sendPurpleToWrite}>🚀 ส่งกรอบนี้เข้าเขียนข่าว</button>
                  </div>
                </div>
              )}
              {insight.transcriptQuotes.enrichedTopics?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {insight.transcriptQuotes.enrichedTopics.map((t, i) => (
                    <div key={i} style={{ marginBottom: 9, paddingTop: 9, borderTop: '1px dashed rgba(124,58,237,.25)' }}>
                      <p style={{ fontSize: 12.5, fontWeight: 700 }}>ประเด็น {t.no || i + 1}: {t.topic}{t.timeRange ? ` (${t.timeRange})` : ''}</p>
                      <p className="bd" style={{ fontSize: 12.5, marginTop: 3 }}>{t.enrichedRaw}</p>
                      <button className="gh" style={{ width: 'auto', padding: '4px 10px', fontSize: 11.5, marginTop: 5 }} onClick={() => copyText(`${t.topic}${t.timeRange ? ` (${t.timeRange})` : ''}\n\n${t.enrichedRaw}`)}>📋 คัดลอก</button>
                    </div>
                  ))}
                </div>
              )}
              {insight.transcriptQuotes.punchyQuotes?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--mut)' }}>🔥 ประโยคเด็ด</p>
                  {insight.transcriptQuotes.punchyQuotes.map((q, i) => (
                    <div key={i} style={{ fontSize: 12.5, padding: '6px 9px', marginTop: 5, borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,.06)', borderRadius: 6 }}>
                      &ldquo;{q.quote}&rdquo;{(q.speaker || q.why) && <span style={{ color: 'var(--mut)' }}> {q.speaker ? `— ${q.speaker}` : ''}{q.why ? `${q.speaker ? ' · ' : ''}${q.why}` : ''}</span>}
                    </div>
                  ))}
                </div>
              )}
              {insight.transcriptQuotes.transcript && (
                <details className="raw" style={{ marginTop: 10 }}>
                  <summary>💬 บทพูดในคลิป (ไม่รวมเพลง) — กดกาง{insight.transcriptQuotes.hasSong ? ' · มีเพลง (ข้ามเนื้อเพลง)' : ''}</summary>
                  <div>{insight.transcriptQuotes.transcript}</div>
                </details>
              )}
            </div>
          )}
          </>;
        })()}

        <h2>คลังถอดประเด็น (ล่าสุด — คลังเดียวกับเว็บ)</h2>
        {insightCases.length === 0 && <p className="sub">ยังไม่มี / กำลังโหลด…</p>}
        {insightCases.slice(0, 10).map(c => (
          <div key={c.id} className="job" onClick={() => {
            setInsight(c.insight || {}); setSelTopics([]); setTopicEdits({}); setEditingIdx(null);
            setRawEdit(null); setRawEditing(false); setPurpleEdit(null); setPurpleEditing(false);
            // ★ รีวิว item 1: lowQuality/qualityNote ของเคสจากคลังอยู่ที่ "ระดับเคส" (c.lowQuality) ไม่ใช่ c.insight — อ่านจากตรงนี้
            setInsightMeta({ url: c.url, platform: c.platform, user: c.user, createdAt: c.createdAt, category: c.category || c.insight?.category || '', lowQuality: !!c.lowQuality, qualityNote: c.qualityNote || '' });
            setClipPhase('done'); window.scrollTo({ top: 0 });
          }}>
            <span className="ava">▶</span>
            <div style={{ overflow: 'hidden', flex: 1 }}><p className="tt" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title || c.url}</p><p className="mm">{fmtTime(c.createdAt)}{c.insight?.category ? ` · ${c.insight.category}` : ''}</p></div>
            <span className="right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              {/* ★ รีวิว item 1: ป้าย ⚠️ ไม่สมบูรณ์ บนการ์ดคลัง — เทียบเว็บ src/app/clip-transcript/page.js:783 */}
              {c.lowQuality && <span className="chip" title={c.qualityNote || ''} style={{ background: 'rgba(239,68,68,.14)', color: '#f87171' }}>⚠️ ไม่สมบูรณ์</span>}
              <span className="chip cmu">หยิบใช้</span>
            </span>
          </div>
        ))}
      </div>}

      {/* ═══ แท็บ สกัดเนื้อ ═══ */}
      {tab === 'filter' && <div className="wrap">
        <h1>สกัดเนื้อหา</h1>
        <p className="sub">🔴 ต้องวาง &quot;สรุปใจความข่าว&quot; มาก่อนเท่านั้น — ห้ามก๊อปเนื้อข่าวเต็มๆ จากเว็บมาวาง (จะได้เนื้อกากๆ ไม่มีคุณภาพ)</p>
        <div className="compose">
          <textarea className="ta" value={nfText} onChange={e => setNfText(e.target.value)} placeholder="สรุปใจความข่าวก่อน แล้ววาง 'สรุป' ที่นี่…" />
        </div>
        <div className="row" style={{ alignItems: 'center', marginTop: 9, marginBottom: 2 }}>
          <span className="chip" style={{ background: 'var(--okS)', color: 'var(--ok)' }}>เก็บเนื้อครบ 🟢</span>
        </div>
        <p className="sub" style={{ marginTop: 2 }}>ตัดเฉพาะคำเฟ้อ/อารมณ์/เกริ่นที่ชัดเจน เก็บข้อเท็จจริง+รายละเอียดครบ</p>
        <div className="seg">
          <button className={nfQuotes ? 'on' : ''} onClick={() => setNfQuotes(q => !q)}>💬 เก็บคำพูดตรง</button>
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
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="gh" style={{ width: 'auto', padding: '6px 16px', fontSize: 12.5 }} onClick={() => { log('send_topic', '', { from: 'filter' }); submitNews((t.title ? t.title + '\n\n' : '') + (t.content || t.summary || ''), { source: 'filter-topic' }); }}>ส่งประเด็นนี้เข้าเขียน</button>
                  <button className="gh" style={{ width: 'auto', padding: '6px 14px', fontSize: 12.5 }} onClick={() => copyText((t.title ? t.title + '\n\n' : '') + (t.content || t.summary || ''))}>📋 คัดลอกประเด็นนี้</button>
                </div>
              </div>
            </div>
          ))}
        </>}
      </div>}

      {/* ═══ แท็บ ทำปก ═══ */}
      {tab === 'cover' && <div className="wrap">
        <h1>ทำปก</h1>
        {/* ★ 28 ก.ค. 69 (รอบ 2): แบนเนอร์รุ่นย้ายขึ้น global ใต้ header แล้ว (แสดงทุกแท็บ) — ดูตรง .hdr ด้านล่าง */}
        {/* ★ 27 ก.ค. 69 (เจ้าของสั่ง): แถวสลับโหมดเฉพาะแอดมิน — พนักงานไม่เห็นแถวปุ่มเลย เห็นแค่โหมดแต่งเอง */}
        {isAdmin && <div className="seg" style={{ marginBottom: 12 }}>
          <button className={cvMode === 'manual' ? 'on' : ''} onClick={() => setCvMode('manual')}>✋ แต่งเอง</button>
          <button className={cvMode === 'auto' ? 'on' : ''} onClick={() => setCvMode('auto')}>🤖 ให้ AI หา</button>
          <button className={cvMode === 'quick' ? 'on' : ''} onClick={() => setCvMode('quick')}>⚡ ทางลัด</button>
        </div>}
        {cvMode === 'manual' && <CoverEditor onLog={log} say={say} initialTitle={result?.title || ''} />}
      </div>}
      {tab === 'cover' && isAdmin && cvMode === 'auto' && <div className="wrap" style={{ paddingTop: 0 }}>
        <p className="sub">เต็มท่อ MEGA (~3-6 นาที) — AI ค้นภาพให้เอง · รันเบื้องหลัง ปิดจอได้</p>
        <input className="in" style={{ marginBottom: 8 }} value={cvTitle} onChange={e => setCvTitle(e.target.value)} placeholder="หัวข่าว (ไม่บังคับ)…" />
        <div className="compose">
          <textarea className="ta" value={cvContent} onChange={e => setCvContent(e.target.value)} placeholder={`วางเนื้อข่าวเต็ม ≥100 ตัวอักษร… (ตอนนี้ ${cvContent.trim().length})`} />
        </div>
        {/* ★ ชุด① 26 ก.ค. 69: ลิงก์คลิปต้นทาง 1-3 + สวิตช์ไม่ค้นเพิ่ม (sourceOnly) */}
        {[0, 1, 2].map(i => (
          <input key={i} className="in" style={{ marginBottom: 8 }} inputMode="url"
            value={cvClips[i]}
            onChange={e => setCvClips(p => p.map((v, idx) => idx === i ? e.target.value : v))}
            placeholder={`ลิงก์คลิป ${i + 1} (ไม่บังคับ)…`} />
        ))}
        <div className="seg" style={{ marginBottom: 6 }}>
          <button className={cvSrcOnly ? 'on' : ''} disabled={!cvClips.some(isValidClipUrl)}
            onClick={() => setCvSrcOnly(v => !v)}>
            🎬 เน้นแคปเฟรมจากคลิป (ไม่ค้นเว็บเพิ่ม)
          </button>
        </div>
        {!cvClips.some(isValidClipUrl) && <p className="sub" style={{ marginTop: 0 }}>ใส่ลิงก์คลิปอย่างน้อย 1 ช่องก่อน ถึงจะเปิดสวิตช์นี้ได้</p>}
        {cvErr && <div className="err">{cvErr}</div>}
        <button className="cta" disabled={cvBusy} onClick={submitCover}>{cvBusy ? 'กำลังส่ง…' : 'ทำปก — เข้าคิวจริง รันเบื้องหลัง'}</button>

        <h2>งานปกล่าสุด <span style={{ fontSize: 10, color: 'var(--mut)', fontWeight: 400, letterSpacing: 0 }}>{M_APP_REV}</span></h2>
        {cvJobs.length === 0 && <p className="sub">ยังไม่มีงานปก</p>}
        {cvJobs.map(j => {
          const r = j.result || {};
          const open = cvOpen === j.id;
          const chip = j.status === 'done' ? <span className="chip cok">เสร็จ</span>
            : j.status === 'failed' ? <span className="chip" style={{ background: 'var(--warnS)', color: 'var(--warn)' }}>ล้ม</span>
            : j.status === 'running' ? <span className="chip cwr">กำลังทำ</span> : <span className="chip cmu">รอคิว</span>;
          return (
            <div key={j.id} style={{ marginBottom: 8 }}>
              <div className="job" onClick={() => setCvOpen(open ? null : j.id)}>
                {r.coverImgUrl && j.status === 'done'
                  ? <img src={r.coverImgUrl} alt="ปก" style={{ width: 40, height: 50, objectFit: 'cover', borderRadius: 9, flex: 'none' }} />
                  : <span className="ava">🖼️</span>}
                <div style={{ overflow: 'hidden' }}>
                  <p className="tt" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.label || j.kind || 'งานปก'}</p>
                  <p className="mm">{j.dispatch === 'cloud' ? 'คลาวด์' : 'เครื่องทีม'}{j.progress?.step ? ` · ${j.progress.step}` : ''}{j.status === 'done' && r.refSimilarity != null ? ` · เหมือน ref ${r.refSimilarity}%` : ''}</p>
                </div>
                <span className="right">{chip}</span>
              </div>
              {open && <div className="reader" style={{ marginTop: 6 }}>
                {j.status === 'failed' && <div className="err" style={{ margin: 0 }}>{j.error || 'ล้มเหลว'}</div>}
                {(j.status === 'pending' || j.status === 'running') && <p className="sub" style={{ margin: 0 }}>⏳ {j.progress?.step || 'กำลังทำ'} — ปิดจอได้ เดี๋ยวผลมาเอง</p>}
                {r.coverImgUrl && <img src={r.coverImgUrl} alt="ปกเต็ม" style={{ width: '100%', borderRadius: 12, marginTop: 8 }} />}
                <div className="row" style={{ marginTop: 9 }}>
                  {r.coverImgUrl && j.status === 'done' && (
                    String(r.coverImgUrl).startsWith('data:')
                      ? <button className="gh" onClick={() => downloadDataCover(r.coverImgUrl)}>⬇️ โหลดภาพ</button>
                      : <a className="gh" style={{ textDecoration: 'none' }} href={`${r.coverImgUrl}${r.coverImgUrl.includes('?') ? '&' : '?'}dl=1`}>⬇️ โหลดภาพ</a>
                  )}
                  <button className="gh" onClick={() => delCover(j.id)}>ลบงานนี้</button>
                </div>
                {/* ★ แก้บั๊ก (รีวิว 27 ก.ค. ค่ำ รอบ 2): บางเบราว์เซอร์ (เช่น iOS Safari) เงียบไม่ดาวน์โหลดแม้ไม่มี error ให้จับ — เตือนทางสำรองไว้เสมอ */}
                {r.coverImgUrl && j.status === 'done' && String(r.coverImgUrl).startsWith('data:') && (
                  <p className="sub" style={{ marginTop: 4, fontSize: 11 }}>* ถ้ากด &quot;⬇️ โหลดภาพ&quot; แล้วไม่ลง — กดค้างที่ภาพเพื่อบันทึกแทน</p>
                )}
                {renderCoverActions(j)}
              </div>}
            </div>
          );
        })}

        {coverArchiveBlock}
      </div>}
      {tab === 'cover' && isAdmin && cvMode === 'quick' && <div className="wrap" style={{ paddingTop: 0 }}>
        <p className="sub">ประกอบจากเคสที่มีรูปแล้ว ~20-80 วิ (ไม่ค้นรูปใหม่)</p>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="gh" style={{ width: 'auto', padding: '7px 14px', fontSize: 12.5 }} onClick={loadQcCases}>🔄 รีเฟรชรายการ</button>
        </div>
        {qcCases.length === 0 && <p className="sub">ยังไม่มีเคสในคลัง — ลองรีเฟรช</p>}
        {qcCases.map(c => {
          const imgGridOpen = caseImgOpen === c.id;
          const imgs = caseImgList[c.id]; // undefined = ยังไม่โหลด · [] = โหลดแล้วแต่ว่าง/ล้มเงียบ
          return (
          <div key={c.id} style={{ marginBottom: 8 }}>
            <div className="job" style={qcSel === c.id ? { borderColor: 'var(--pink)', background: 'var(--pinkS)' } : undefined} onClick={() => setQcSel(c.id)}>
              <span className="ava">🖼️</span>
              <div style={{ overflow: 'hidden' }}>
                <p className="tt" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(c.headline || c.id || '').slice(0, 60)}</p>
                <p className="mm">รูปตรง {c.relevant ?? '-'}/{c.total ?? '-'} · หน้าชัด {c.cleanFace ?? '-'}{c.tone ? ` · ${c.tone}` : ''}</p>
              </div>
              <button className="gh" style={{ width: 'auto', flex: 'none', padding: '5px 8px', fontSize: 11, marginRight: 6 }}
                onClick={(e) => { e.stopPropagation(); toggleCaseImages(c.id); }}>
                {imgGridOpen ? '✕ ปิด' : '🖼 ดูภาพเคส'}
              </button>
              <span className="right">{qcSel === c.id ? <span className="chip cpk">เลือกแล้ว</span> : null}</span>
            </div>
            {imgGridOpen && (
              <div style={{ padding: '8px 6px', border: '1px solid var(--line)', borderTop: 'none', borderRadius: '0 0 12px 12px' }}>
                {imgs === undefined && <p className="sub" style={{ margin: 0 }}>⏳ กำลังโหลดภาพ…</p>}
                {Array.isArray(imgs) && imgs.length === 0 && <p className="sub" style={{ margin: 0 }}>ไม่มีภาพในเคสนี้</p>}
                {Array.isArray(imgs) && imgs.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {imgs.map((im, i) => (
                      <a key={im.id || im.url || i} href={im.url} target="_blank" rel="noopener noreferrer">
                        <img src={im.url} alt="" loading="lazy"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                          style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', display: 'block' }} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })}
        <input className="in" style={{ margin: '10px 0' }} value={qcHero} onChange={e => setQcHero(e.target.value)} placeholder="ชื่อคนตัวเด่น (ไม่บังคับ)…" />
        {cvErr && <div className="err">{cvErr}</div>}
        <button className="cta" disabled={!qcSel || qcBusy} onClick={submitQuickCover}>{qcBusy ? 'กำลังส่ง…' : '⚡ ประกอบปก — เข้าคิว รันเบื้องหลัง'}</button>

        <h2>งานปกล่าสุด <span style={{ fontSize: 10, color: 'var(--mut)', fontWeight: 400, letterSpacing: 0 }}>{M_APP_REV}</span></h2>
        {cvJobs.length === 0 && <p className="sub">ยังไม่มีงานปก</p>}
        {cvJobs.map(j => {
          const r = j.result || {};
          const open = cvOpen === j.id;
          const chip = j.status === 'done' ? <span className="chip cok">เสร็จ</span>
            : j.status === 'failed' ? <span className="chip" style={{ background: 'var(--warnS)', color: 'var(--warn)' }}>ล้ม</span>
            : j.status === 'running' ? <span className="chip cwr">กำลังทำ</span> : <span className="chip cmu">รอคิว</span>;
          return (
            <div key={j.id} style={{ marginBottom: 8 }}>
              <div className="job" onClick={() => setCvOpen(open ? null : j.id)}>
                {r.coverImgUrl && j.status === 'done'
                  ? <img src={r.coverImgUrl} alt="ปก" style={{ width: 40, height: 50, objectFit: 'cover', borderRadius: 9, flex: 'none' }} />
                  : <span className="ava">🖼️</span>}
                <div style={{ overflow: 'hidden' }}>
                  <p className="tt" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.label || j.kind || 'งานปก'}</p>
                  <p className="mm">{j.dispatch === 'cloud' ? 'คลาวด์' : 'เครื่องทีม'}{j.progress?.step ? ` · ${j.progress.step}` : ''}{j.status === 'done' && r.refSimilarity != null ? ` · เหมือน ref ${r.refSimilarity}%` : ''}</p>
                </div>
                <span className="right">{chip}</span>
              </div>
              {open && <div className="reader" style={{ marginTop: 6 }}>
                {j.status === 'failed' && <div className="err" style={{ margin: 0 }}>{j.error || 'ล้มเหลว'}</div>}
                {(j.status === 'pending' || j.status === 'running') && <p className="sub" style={{ margin: 0 }}>⏳ {j.progress?.step || 'กำลังทำ'} — ปิดจอได้ เดี๋ยวผลมาเอง</p>}
                {r.coverImgUrl && <img src={r.coverImgUrl} alt="ปกเต็ม" style={{ width: '100%', borderRadius: 12, marginTop: 8 }} />}
                <div className="row" style={{ marginTop: 9 }}>
                  {r.coverImgUrl && j.status === 'done' && (
                    String(r.coverImgUrl).startsWith('data:')
                      ? <button className="gh" onClick={() => downloadDataCover(r.coverImgUrl)}>⬇️ โหลดภาพ</button>
                      : <a className="gh" style={{ textDecoration: 'none' }} href={`${r.coverImgUrl}${r.coverImgUrl.includes('?') ? '&' : '?'}dl=1`}>⬇️ โหลดภาพ</a>
                  )}
                  <button className="gh" onClick={() => delCover(j.id)}>ลบงานนี้</button>
                </div>
                {/* ★ แก้บั๊ก (รีวิว 27 ก.ค. ค่ำ รอบ 2): บางเบราว์เซอร์ (เช่น iOS Safari) เงียบไม่ดาวน์โหลดแม้ไม่มี error ให้จับ — เตือนทางสำรองไว้เสมอ */}
                {r.coverImgUrl && j.status === 'done' && String(r.coverImgUrl).startsWith('data:') && (
                  <p className="sub" style={{ marginTop: 4, fontSize: 11 }}>* ถ้ากด &quot;⬇️ โหลดภาพ&quot; แล้วไม่ลง — กดค้างที่ภาพเพื่อบันทึกแทน</p>
                )}
                {renderCoverActions(j)}
              </div>}
            </div>
          );
        })}

        {coverArchiveBlock}
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

      {/* ═══ แท็บ โต๊ะข่าว (v1 — เปิดให้ทุกคนที่ล็อกอินใช้ได้ 27 ก.ค. 69 เจ้าของสั่ง) — อัปเกรดครบเท่าโต๊ะกลาง ═══ */}
      {tab === 'desk' && <div className="wrap">
        <h1>โต๊ะข่าว</h1>
        <p className="sub">ต่อท่อโต๊ะข่าวกลาง (v1) เดียวกับหน้าเว็บ</p>

        {/* 🔎 ค้นข่าวเอง — ยิง harvest ด้วยคำค้นตรงๆ (endpoint เดิมที่จอเว็บใช้ ผ่านประตู action ใหม่) */}
        <input className="in" style={{ marginBottom: 8 }} placeholder="🔎 ค้นข่าวเอง — ใส่ชื่อคน/แนว…" value={deskSearchKw} disabled={deskSearchBusy}
          onChange={e => setDeskSearchKw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') runDeskSearch(); }} maxLength={60} />
        <button className="gh" style={{ marginBottom: 9 }} disabled={deskSearchBusy || deskSearchKw.trim().length < 2} onClick={runDeskSearch}>
          {deskSearchBusy ? '⏳ กำลังส่งเข้าคิว…' : '🔎 ค้นข่าวนี้'}</button>

        <div className="row" style={{ marginBottom: 9 }}>
          <button className="gh" disabled={deskHarvestBusy} onClick={() => setDeskModeOpen(v => !v)}>
            {deskHarvestBusy ? '⏳ กำลังส่งเข้าคิว…' : '🔍 ล่าข่าวรอบใหม่'}</button>
          <button className="gh" disabled={deskChiefBusy} onClick={runDeskChief}>
            {deskChiefBusy ? '⏳ กำลังส่งเข้าคิว…' : '🧠 บก.ใหญ่'}</button>
        </div>

        {deskModeOpen && <div className="seg" style={{ marginBottom: 11 }}>
          {HARVEST_MODES.map(m => (
            <button key={m.key} disabled={deskHarvestBusy} onClick={() => runDeskHarvest(m.key)} title={m.desc}>{m.label}</button>
          ))}
        </div>}

        {/* ★ 27 ก.ค. 69: งานเบื้องหลังโต๊ะข่าว (ล่าข่าว/ค้นเอง/บก.ใหญ่) — เข้าคิวจริง กดแล้วปิดจอได้ ผลโผล่ที่นี่อัตโนมัติ */}
        {deskJobs.length > 0 && <>
          <h2>งานโต๊ะล่าสุด</h2>
          {deskJobs.map(j => {
            const chip = j.status === 'done' ? <span className="chip cok">เสร็จ</span>
              : j.status === 'failed' ? <span className="chip" style={{ background: 'var(--warnS)', color: 'var(--warn)' }}>ล้ม</span>
              : j.status === 'running' ? <span className="chip cwr">กำลังทำ</span> : <span className="chip cmu">รอคิว</span>;
            const icon = j.kind === 'desk_chief' ? '🧠' : j.kind === 'desk_search' ? '🔎' : '🗞️';
            // ★ sol-review ข้อ 7: การ์ด บก.ใหญ่ ที่เสร็จ → แตะกางได้ อ่าน result ของ "งานนี้เอง" ตรงๆ (ไม่พึ่ง deskBrief
            //   ที่เป็น state ชั่วคราว หายเมื่อรีโหลดหน้า/มาดูทีหลัง) · แก้ข้อความให้ตรงจริง (ไม่ใช่ "ดูด้านล่าง" อีกต่อไป)
            const isChiefDone = j.kind === 'desk_chief' && j.status === 'done';
            const openJ = deskJobOpen === j.id;
            const sub = j.status === 'failed' ? (j.error || 'ล้มเหลว').slice(0, 60)
              : j.status === 'done' && j.kind !== 'desk_chief' ? `เจอใหม่ ${j.result?.added ?? 0} ใบ`
                : j.status === 'done' ? 'วินิจฉัยเสร็จแล้ว — แตะดูผล'
                  : (j.progress?.step || 'กำลังทำ');
            return (
              <div key={j.id} style={{ marginBottom: 8 }}>
                <div className="job" style={{ cursor: isChiefDone ? 'pointer' : 'default' }}
                  onClick={() => { if (isChiefDone) setDeskJobOpen(openJ ? null : j.id); }}>
                  <span className="ava">{icon}</span>
                  <div style={{ overflow: 'hidden' }}>
                    <p className="tt" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.label || j.kind}</p>
                    <p className="mm">{sub}</p>
                  </div>
                  <span className="right">{chip}</span>
                </div>
                {isChiefDone && openJ && <div className="reader" style={{ marginTop: 6 }}>
                  {j.result?.diagnosis && <p className="bd" style={{ fontSize: 13.5 }}>{j.result.diagnosis}</p>}
                  {(j.result?.orders || []).length > 0 && <div style={{ marginTop: 8 }}>
                    <p className="mm" style={{ fontWeight: 700 }}>📌 คำสั่ง</p>
                    {j.result.orders.map((o, i) => <p key={i} style={{ fontSize: 12.5, marginTop: 3 }}>• {o}</p>)}
                  </div>}
                  {(j.result?.warnings || []).length > 0 && <div style={{ marginTop: 8 }}>
                    <p className="mm" style={{ fontWeight: 700, color: 'var(--warn)' }}>⚠️ ระวัง</p>
                    {j.result.warnings.map((w, i) => <p key={i} style={{ fontSize: 12.5, marginTop: 3 }}>• {w}</p>)}
                  </div>}
                  {!j.result?.diagnosis && !(j.result?.orders || []).length && !(j.result?.warnings || []).length && (
                    <p className="bd" style={{ fontSize: 13 }}>{j.result?.summary || 'ไม่มีผลสรุป'}</p>
                  )}
                </div>}
              </div>
            );
          })}
        </>}

        {deskBrief && <div className="reader" style={{ marginBottom: 12 }}>
          <p style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--pink)', marginBottom: 6 }}>🧠 วินิจฉัยล่าสุด</p>
          {deskBrief.diagnosis && <p className="bd" style={{ fontSize: 13.5 }}>{deskBrief.diagnosis}</p>}
          {(deskBrief.orders || []).length > 0 && <div style={{ marginTop: 8 }}>
            <p className="mm" style={{ fontWeight: 700 }}>📌 คำสั่ง</p>
            {deskBrief.orders.map((o, i) => <p key={i} style={{ fontSize: 12.5, marginTop: 3 }}>• {o}</p>)}
          </div>}
          {(deskBrief.warnings || []).length > 0 && <div style={{ marginTop: 8 }}>
            <p className="mm" style={{ fontWeight: 700, color: 'var(--warn)' }}>⚠️ ระวัง</p>
            {deskBrief.warnings.map((w, i) => <p key={i} style={{ fontSize: 12.5, marginTop: 3 }}>• {w}</p>)}
          </div>}
        </div>}

        {/* 📥⭐✅ สลับกระดาน — คลังส่งเช้า/พร้อมใช้ ต่อ endpoint เดิม (tab=shortlist|ready) ผ่านประตูเดิม */}
        <div className="seg" style={{ marginBottom: 9 }}>
          <button className={(deskTab !== 'shortlist' && deskTab !== 'ready') ? 'on' : ''} onClick={() => changeDeskTab('all')}>📥 กระดานหลัก</button>
          <button className={deskTab === 'shortlist' ? 'on' : ''} onClick={() => changeDeskTab('shortlist')}>⭐ คลังส่งเช้า</button>
          <button className={deskTab === 'ready' ? 'on' : ''} onClick={() => changeDeskTab('ready')}>✅ พร้อมใช้</button>
        </div>

        {deskTab !== 'shortlist' && deskTab !== 'ready' && (
          <div className="seg" style={{ marginBottom: 11 }}>
            <button className={deskTab === 'all' ? 'on' : ''} onClick={() => changeDeskTab('all')}>🗂️ ทั้งหมด</button>
            <button className={deskTab === 'trend' ? 'on' : ''} onClick={() => changeDeskTab('trend')}>🔥 กระแส</button>
            <button className={deskTab === 'good' ? 'on' : ''} onClick={() => changeDeskTab('good')}>💚 น้ำดี</button>
          </div>
        )}

        {/* ฟิลเตอร์ ประเภท/แหล่ง/หมวด — กรองฝั่งจอจากข้อมูลในการ์ด ไม่ยิง API เพิ่ม (เลื่อนแนวนอนแบบชิปเทมเพลตใน CoverEditor) */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 7 }}>
          {DESK_TYPE_FILTERS.map(o => (
            <button key={o.key} style={deskChipBtn(deskTypeFilter === o.key)} onClick={() => setDeskTypeFilter(o.key)}>{o.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 7 }}>
          {DESK_SRC_FILTERS.map(o => (
            <button key={o.key} style={deskChipBtn(deskSrcFilter === o.key)} onClick={() => setDeskSrcFilter(o.key)}>{o.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 9 }}>
          {DESK_LIB_FILTERS.map(o => (
            <button key={o.key} style={deskChipBtn(deskLibFilter === o.key)} onClick={() => setDeskLibFilter(o.key)}>{o.label}</button>
          ))}
        </div>

        <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
          <button className="gh" style={{ width: 'auto', padding: '6px 14px', fontSize: 12.5 }} onClick={loadDesk}>🔄 รีเฟรช</button>
          <span className="right mm">แสดง {deskFiltered.length}/{deskItems.length}</span>
        </div>

        {deskItems.length === 0 && <p className="sub">ยังไม่มี / กำลังโหลด… — ลองล่าข่าวรอบใหม่ได้เลย</p>}
        {deskItems.length > 0 && deskFiltered.length === 0 && <p className="sub">ไม่มีข่าวตรงตัวกรองที่เลือก — ลองเปลี่ยนตัวกรองดู</p>}

        {deskFiltered.map(it => {
          const open = deskExpanded === it.id;
          const busy = deskCardBusy[it.id];
          const ES = { ready: ['✅ พร้อมเขียน', '#16a34a'], needsResearch: ['🔎 ต้องหาเพิ่ม', '#d97706'], weakSource: ['⚠️ แหล่งอ่อน', '#ca8a04'], duplicate: ['🔁 มุมซ้ำ', '#6b7280'], lowValue: ['💤 คุณค่าน้อย', '#94a3b8'], reject: ['🚫 ไม่ควรทำ', '#dc2626'] };
          const [qLbl, qCol] = ES[it.editorial?.status] || ['', '#888'];
          const clip = isClip(it);
          const fresh = deskFreshBadge(it);
          const grade = deskQualityGrade(it);
          // ★ 27 ก.ค. 69: ภาพซ้ายขยายเด่นทุกใบ (ไม่ใช่เฉพาะคลิปแล้ว) — ไม่มีรูป/โหลดพัง = กล่องไอคอนแพลตฟอร์มเต็มบล็อกขนาดเดียวกัน
          // ★ sol-review ข้อ 3: imageUrl (จริง/youtube) มาก่อนเสมอ · thumbUrl (og:image ที่เติมทีหลัง) เป็น fallback
          const thumb = it.imageUrl || it.thumbUrl;
          const showImg = thumb && !deskImgFail[it.id];
          return (
            <div key={it.id} style={{ marginBottom: 8 }}>
              <div className="job" style={{ alignItems: 'flex-start' }} onClick={() => setDeskExpanded(open ? null : it.id)}>
                {showImg ? (
                  <div style={{ position: 'relative', flex: 'none' }}>
                    <img src={thumb} alt="" loading="lazy" onError={() => setDeskImgFail(p => ({ ...p, [it.id]: true }))}
                      style={{ width: 110, height: 82, borderRadius: 14, objectFit: 'cover', display: 'block', background: 'var(--card)' }} />
                    {clip && <span style={{ position: 'absolute', top: 5, left: 5, background: 'rgba(0,0,0,.68)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, letterSpacing: '.02em' }}>คลิป</span>}
                  </div>
                ) : (
                  <div style={{ width: 110, height: 82, borderRadius: 14, background: 'var(--pinkS)', color: 'var(--pink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, flex: 'none' }}>
                    {DESK_PLATFORM_ICON[it.sourceType] || (clip ? '▶️' : '📰')}
                  </div>
                )}
                <div style={{ overflow: 'hidden', flex: 1 }}>
                  <p className="tt">{it.title}</p>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                    {qLbl && <span className="chip" style={{ background: qCol + '22', color: qCol }}>{qLbl}</span>}
                    {it.freshClass && <span className="chip" style={{ background: it.freshClass === 'timeless' ? 'var(--okS)' : 'var(--warnS)', color: it.freshClass === 'timeless' ? 'var(--ok)' : 'var(--warn)' }}>{it.freshClass === 'timeless' ? '♾️ อมตะ' : '🔥 กระแส'}</span>}
                    {it.reliability?.label && <span className="chip cmu">{it.reliability.label}</span>}
                  </div>
                  {/* ★ 27 ก.ค. 69: บรรทัดวันที่ครบ — ความสด (เกณฑ์เดิม) + คุณภาพ บก. */}
                  <div className="row" style={{ flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                    <span className="chip" style={{ background: fresh.bg, color: fresh.color }}>{fresh.label}</span>
                    {grade && <span className="chip" style={{ background: grade.bg, color: grade.color }}>{grade.emoji} {grade.label}</span>}
                  </div>
                  <p className="mm" style={{ marginTop: 4 }}>{it.category || ''}{it.source ? ` · ${it.source}` : ''}</p>
                  {(it.publishedAt || it.harvestedAt) && (
                    <p className="mm" style={{ marginTop: 1 }}>
                      {it.publishedAt ? `โพสต์ ${fmtTime(it.publishedAt)}` : ''}{it.harvestedAt ? `${it.publishedAt ? ' · ' : ''}เก็บเข้าโต๊ะ ${fmtTime(it.harvestedAt)}` : ''}
                    </p>
                  )}
                </div>
                {it.status === 'sent' && <span className="right chip cok">ส่งแล้ว</span>}
              </div>
              {open && <div className="reader" style={{ marginTop: 6 }}>
                {it.editorial?.whyDo && <p className="bd" style={{ fontSize: 13 }}>💡 {it.editorial.whyDo}</p>}
                {(it.editorial?.coverageGap || []).length > 0 && <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>⛏️ ขาด: {it.editorial.coverageGap.join(' · ')}</p>}
                {it.judgeReason && <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>🧠 {it.judgeReason}</p>}
                {it.url && <a className="lnk" style={{ display: 'inline-block', marginTop: 8 }} href={it.url} target="_blank" rel="noreferrer">🔗 เปิดลิงก์ต้นทาง ↗</a>}
                {it.status !== 'sent' && <>
                  <button className="cta" style={{ marginTop: 10, background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
                    disabled={!!busy} onClick={(e) => { e.stopPropagation(); deskCardAction(it, 'sendWorkflow'); }}>
                    {busy === 'sendWorkflow' ? 'กำลังส่ง…' : '✍️ ส่งเขียน'}</button>
                  <button className="gh" style={{ marginTop: 8 }}
                    disabled={!!busy} onClick={(e) => { e.stopPropagation(); deskCardAction(it, 'dismiss'); }}>
                    {busy === 'dismiss' ? 'กำลังทิ้ง…' : '🗑 ทิ้ง'}</button>
                </>}
              </div>}
            </div>
          );
        })}
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
        {/* 🛑 31 ก.ค. 69 (เจ้าของสั่ง): ถอดแท็บ "ทำปก" ออกจากแอพ — ท่อ MEGA ปิดใช้งานแล้ว (ดู src/lib/megaPipelineGate.js)
            เปิดคืน: เอาคอมเมนต์ออก + ตั้ง env MEGA_PIPELINE=1 (โค้ดแท็บ/ฟังก์ชันทั้งหมดยังอยู่ครบ ไม่ได้ลบ)
        <button className={'tab' + (tab === 'cover' ? ' on' : '')} onClick={() => setTab('cover')}>{IC.img}ทำปก</button> */}
        <button className={'tab' + (tab === 'works' ? ' on' : '')} onClick={() => setTab('works')}>{IC.lib}ผลงาน</button>
        {/* ★ 27 ก.ค. 69 (เจ้าของสั่ง): เปิดให้ทุกคนที่ล็อกอินใช้ได้แล้ว — ตัด isAdmin guard ออก */}
        <button className={'tab' + (tab === 'desk' ? ' on' : '')} onClick={() => setTab('desk')}>{IC.desk}โต๊ะข่าว</button>
      </div></div>
      {toast && <div className="toast">{toast}</div>}

      {/* ★ 27 ก.ค. ค่ำ v2 (ฟีดแบ็กเจ้าของ — ช่องแก้เดิมเล็ก/เลื่อนหาคำยาก): หน้าแก้เต็มจอ ใช้ร่วมกันทั้ง 3 จุด (การ์ดประเด็น / กรอบเทา / กรอบม่วง)
          ครอบทั้งจอ (ทับแท็บบาร์ด้วย) กันสลับแท็บระหว่างแก้ · ล็อกสกรอลพื้นหลังด้วย useEffect ด้านบน · ทำงานได้ทั้งผลสดและเปิดจากคลัง (ไม่ผูกกับแหล่งที่มา) */}
      {(editingIdx !== null || rawEditing || purpleEditing) && (() => {
        const isTopic = editingIdx !== null;
        const i = editingIdx;
        const curTopic = isTopic ? effectiveTopics(insight)[i] : null;
        const kindTitle = isTopic ? `แก้ประเด็น ${curTopic?.no ?? i + 1}` : rawEditing ? 'แก้ข้อมูลดิบรวม' : 'แก้เนื้อดิบมีมิติ';
        const titleVal = isTopic ? (topicEdits[i]?.topic ?? curTopic?.topic ?? '') : '';
        const bodyVal = isTopic ? (topicEdits[i]?.raw ?? curTopic?.raw ?? '')
          : rawEditing ? (rawEdit ?? insight?.rawData ?? '')
          : (purpleEdit ?? insight?.transcriptQuotes?.enrichedRaw ?? '');
        const setTitleField = (v) => setTopicEdits(m => ({ ...m, [i]: { topic: v, raw: m[i]?.raw ?? curTopic?.raw ?? '' } }));
        const setBodyField = (v) => {
          if (isTopic) setTopicEdits(m => ({ ...m, [i]: { topic: m[i]?.topic ?? curTopic?.topic ?? '', raw: v } }));
          else if (rawEditing) setRawEdit(v);
          else setPurpleEdit(v);
        };
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--bg)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
            <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid var(--line)', flex: 'none' }}>
                <p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>✏️ {kindTitle}</p>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '12px 16px', gap: 8 }}>
                {isTopic && (
                  <input className="in" style={{ flex: 'none' }} value={titleVal} onChange={e => setTitleField(e.target.value)} placeholder="หัวข้อ" />
                )}
                <textarea
                  style={{ flex: 1, minHeight: '55vh', fontSize: 16, lineHeight: 1.8, background: 'var(--panel)', border: '1.5px solid var(--line)', borderRadius: 12, padding: 12, width: '100%', resize: 'none', fontFamily: 'inherit', color: 'inherit' }}
                  value={bodyVal} onChange={e => setBodyField(e.target.value)} placeholder="เนื้อดิบ" autoFocus
                />
                <p style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--mut)', flex: 'none', margin: 0 }}>{bodyVal.length.toLocaleString('th-TH')} ตัวอักษร</p>
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '10px 16px calc(10px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--line)', flex: 'none', background: 'var(--panel)' }}>
                <button className="cta" style={{ flex: 1, minHeight: 44, padding: '10px 6px', fontSize: 13.5 }} onClick={confirmEditor}>✅ เสร็จแล้ว</button>
                <button className="gh" style={{ flex: 1, minHeight: 44, padding: '10px 6px', fontSize: 13.5 }} onClick={revertEditor}>↩︎ คืนค่าเดิม</button>
                <button className="gh" style={{ flex: 1, minHeight: 44, padding: '10px 6px', fontSize: 13.5, borderColor: '#ef4444', color: '#ef4444' }} onClick={cancelEditor}>✖ ยกเลิก</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
