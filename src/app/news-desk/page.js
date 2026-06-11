'use client';

/**
 * 🗞️ โต๊ะข่าวกลาง (News Desk) — เฟส 1
 * feed ข่าวคัดกรองแล้วเรียงคะแนน · จองกันชนกัน · ส่งเข้า workflow คลิกเดียว
 */
import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';

const TABS = [
  { id: 'all', label: '📋 ทั้งหมด' },
  { id: 'trend', label: '🔥 กระแสวันนี้' },
  { id: 'good', label: '💎 ข่าวน้ำดี' },
  { id: 'evergreen', label: '🗄️ ข่าวเก่าน้ำดี' },
  { id: 'buzz', label: '📊 แชร์จริง' },
  { id: 'followup', label: '🔁 ตามรอย' },
  { id: 'interview', label: '🎙️ คลิปสัมภาษณ์' },
  { id: 'ready', label: '✅ พร้อมใช้' },
];

const LANE_ICONS = { trend: '🔥', good: '💎', evergreen: '🗄️', interview: '🎙️', followup: '🔁', buzz: '📊' };

const CAT_COLORS = {
  'น้ำใจ/ช่วยเหลือ': '#22c55e', 'กตัญญู/ครอบครัวอบอุ่น': '#10b981', 'สู้ชีวิต': '#06b6d4',
  'คนดังทำดี/ติดดิน': '#a3e635', 'สัมภาษณ์/บทสนทนาดี': '#8b5cf6', 'บันเทิงกระแส': 'var(--desk-amber)',
  'ดราม่าสังคม': '#ef4444', 'เตือนภัย/อุทาหรณ์': '#f97316', 'อื่นๆ': '#6b7280',
};

function scoreColor(s) {
  if (s >= 75) return '#22c55e';
  if (s >= 55) return 'var(--desk-amber)';
  return '#6b7280';
}

export default function NewsDeskPage() {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [mixToday, setMixToday] = useState({});
  const [sentToday, setSentToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [harvesting, setHarvesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [me, setMe] = useState('');
  const [governor, setGovernor] = useState(null);
  const [clipUrl, setClipUrl] = useState('');
  const [mining, setMining] = useState(false);
  const [jobStatus, setJobStatus] = useState({}); // jobId → { status, position, error }
  const [chiefBrief, setChiefBrief] = useState(null);
  const [mktUrl, setMktUrl] = useState('');
  const [mktSending, setMktSending] = useState(false);
  const [researching, setResearching] = useState({}); // id → true

  useEffect(() => {
    setMe(localStorage.getItem('desk_username') || '');
  }, []);

  const ensureName = () => {
    let name = localStorage.getItem('desk_username');
    if (!name) {
      name = prompt('ชื่อของคุณ (ใช้ติดป้ายตอนจองข่าว):') || '';
      if (name) { localStorage.setItem('desk_username', name); setMe(name); }
    }
    return name;
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/news-desk?tab=${tab}&limit=80`, { cache: 'no-store' });
      const d = await res.json();
      if (d.success) { setItems(d.items); setMixToday(d.mixToday || {}); setSentToday(d.sentToday || 0); setGovernor(d.governor || null); setChiefBrief(d.chiefBrief || null);
        setEditorStats(d.editorStats || {}); setQueueDepth(d.queueDepth || { pending: 0, processing: 0 }); setReadyCount(d.readyCount || 0);
        // ★ ติดตามสถานะงานเขียนของการ์ดที่ส่งทำใน 2 ชม.ล่าสุด
        const recent = (d.items || []).filter(i => i.status === 'sent' && i.jobId && Date.now() - new Date(i.sentAt || 0).getTime() < 2 * 3600e3).slice(0, 8);
        for (const it of recent) {
          fetch(`/api/queue/status?id=${it.jobId}`, { cache: 'no-store' })
            .then(r => r.json())
            .then(q => setJobStatus(prev => ({ ...prev, [it.jobId]: { status: q.status, position: q.position, error: q.error } })))
            .catch(() => {});
        }
      }
    } catch {} finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const harvest = async () => {
    setHarvesting(true); setMsg('🔄 กำลังเก็บ+คัดกรองข่าวรอบใหม่ (~2-4 นาที — AI ให้คะแนนทีละข่าว)...');
    try {
      const res = await fetch('/api/news-desk/harvest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json();
      setMsg(d.success ? `✅ เก็บมา ${d.harvested} · ผ่านคัด ${d.added} · AI ให้คะแนน ${d.judged}` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setHarvesting(false);
  };

  const act = async (id, action) => {
    const user = ensureName();
    if (!user && action !== 'dismiss') return;
    const res = await fetch('/api/news-desk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id, user }),
    });
    const d = await res.json();
    if (!d.success) alert(d.error);
    load();
  };

  const sendToWorkflow = async (item) => {
    const user = ensureName();
    if (!user) return;
    setMsg(`🚀 กำลังส่ง "${item.title.slice(0, 40)}..." เข้าคิวเขียน...`);
    try {
      // ฝั่งเซิร์ฟเวอร์จัดการเอง: คลิปสัมภาษณ์ → ส่งบทถอดเสียงเต็ม / ข่าวปกติ → ส่งลิงก์
      const res = await fetch('/api/news-desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sendWorkflow', id: item.id, user }),
      });
      const d = await res.json();
      if (d.success) setMsg(`✅ เข้าคิวแล้ว (คิวที่ ${d.position}) — ดูผลในหน้า Generation Log`);
      else setMsg(`❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
  };

  const mineClip = async () => {
    if (!/^https?:\/\//.test(clipUrl)) { setMsg('❌ วางลิงก์คลิปก่อน (YouTube / Facebook / IG / TikTok)'); return; }
    setMining(true);
    setMsg('⛏️ กำลังถอดเสียง + ขุดนาทีทอง... (คลิปยาวใช้เวลาหลายนาที)');
    try {
      const res = await fetch('/api/news-desk/mine-clip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clipUrl }),
      });
      const d = await res.json();
      if (d.success) {
        setMsg(`✅ ขุดสำเร็จ: "${d.item.title}" — นาทีทอง ${d.golden?.length || 0} จุด (อยู่แท็บ 🎙️)`);
        setClipUrl('');
        setTab('interview');
      } else setMsg(`❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setMining(false);
  };

  const research = async (item) => {
    setResearching(prev => ({ ...prev, [item.id]: true }));
    setMsg(`🔬 กำลังเจาะลึก "${item.title.slice(0, 40)}..." (หาแหล่งเพิ่ม+สังเคราะห์ ~1 นาที)`);
    try {
      const res = await fetch('/api/news-desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'research', id: item.id, user: me || 'ไม่ระบุ' }),
      });
      const d = await res.json();
      setMsg(d.success ? `✅ เจาะลึกเสร็จ — พร้อมเขียน ${d.research.readyScore}/10 (${d.research.keyFacts?.length || 0} ข้อเท็จจริง)` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setResearching(prev => ({ ...prev, [item.id]: false }));
  };

  const sendMarketPost = async () => {
    if (!/^https?:\/\//.test(mktUrl)) { setMsg('❌ วางลิงก์โพสต์/คลิปที่เห็นว่าแรงก่อน'); return; }
    setMktSending(true);
    setMsg('📈 กำลังดึงเนื้อ+ถอด pattern โพสต์แรง...');
    try {
      const res = await fetch('/api/news-desk/market-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mktUrl, user: me || 'ไม่ระบุ' }),
      });
      const d = await res.json();
      setMsg(d.success ? `✅ เข้าคลังตลาดแล้ว: "${d.item.topic}" — ${d.item.whyViral}` : `❌ ${d.error}`);
      if (d.success) setMktUrl('');
    } catch (e) { setMsg('❌ ' + e.message); }
    setMktSending(false);
  };

  const consult = async (item) => {
    setResearching(prev => ({ ...prev, ['c_' + item.id]: true }));
    setMsg(`💼 บก.ประจำแนวกำลังวิเคราะห์ "${item.title.slice(0, 40)}..." (~1 นาที)`);
    try {
      const res = await fetch('/api/news-desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'consult', id: item.id, user: me || 'ไม่ระบุ' }),
      });
      const d = await res.json();
      setMsg(d.success ? `${d.consult.icon} ${d.consult.by}: ${d.consult.verdict} — แนะนำแนว "${d.consult.bestAngle}"` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setResearching(prev => ({ ...prev, ['c_' + item.id]: false }));
  };

  const callChief = async (instruction = '') => {
    setMsg(instruction ? `🧠 บก.ใหญ่รับคำสั่ง: "${instruction.slice(0, 60)}" กำลังทำ (~2-4 นาที)...` : '🧠 บก.ใหญ่ AI กำลังวิเคราะห์ภาพรวม+สั่งเก็บเพิ่ม (~2-4 นาที)...');
    try {
      const res = await fetch('/api/news-desk/chief', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(instruction ? { instruction } : {}),
      });
      const d = await res.json();
      setMsg(d.success ? `🧠 ${(d.orders || []).join(' · ') || d.brief || 'เสร็จแล้ว'}` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
  };

  const [chiefCmd, setChiefCmd] = useState('');
  const [expanded, setExpanded] = useState({}); // id → versions[] (แท็บพร้อมใช้)
  const [autopilot, setAutopilot] = useState(true);
  const [editorStats, setEditorStats] = useState({});
  const [queueDepth, setQueueDepth] = useState({ pending: 0, processing: 0 });
  const [readyCount, setReadyCount] = useState(0);
  const [editorRunning, setEditorRunning] = useState('');

  const runEditor = async (key, label) => {
    setEditorRunning(key);
    setMsg(`${label} กำลังสแกนเลนตัวเอง + เลือกส่งเจน (~1-3 นาที)...`);
    try {
      const res = await fetch('/api/news-desk/editor-run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editor: key }),
      });
      const d = await res.json();
      setMsg(d.success ? d.summary : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setEditorRunning('');
  };

  const toggleAutopilot = async () => {
    const next = !autopilot;
    setAutopilot(next);
    await fetch('/api/news-desk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'autopilot', enabled: next }),
    }).catch(() => {});
    setMsg(next ? '🤖 Auto-Pilot เปิด — บก.จะเลือกข่าวคะแนน 8+ ส่งเจนเองทุกรอบเก็บข่าว' : '⏸️ Auto-Pilot ปิด — บก.แนะนำอย่างเดียว ทีมกดส่งเอง');
  };

  const openVersions = async (item) => {
    if (expanded[item.id]) { setExpanded(prev => ({ ...prev, [item.id]: null })); return; }
    if (!item.jobId) { setMsg('❌ การ์ดนี้ไม่มีงานเขียนผูกอยู่'); return; }
    setMsg('📖 กำลังเปิดเนื้อที่เจนไว้...');
    try {
      const res = await fetch(`/api/queue/status?id=${item.jobId}`, { cache: 'no-store' });
      const d = await res.json();
      const data = d.result?.data || d.result || {};
      const versions = data?.analysis?.versions || data?.versions || [];
      if (d.status !== 'completed') { setMsg(d.status === 'failed' ? `❌ งานเขียนล้มเหลว: ${d.error || ''}` : '⏳ ยังเขียนไม่เสร็จ รอแป๊บ'); return; }
      if (!versions.length) { setMsg('❌ ไม่พบเวอร์ชันในงานนี้ — ดูใน Generation Log แทน'); return; }
      setExpanded(prev => ({ ...prev, [item.id]: versions }));
      setMsg('');
    } catch (e) { setMsg('❌ ' + e.message); }
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setMsg('📋 คัดลอกแล้ว — เอาไปทำโพสต์/ปกได้เลย'); }
    catch { setMsg('❌ คัดลอกไม่สำเร็จ'); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #0f1419)' }}>
      <Header title="🗞️ โต๊ะข่าวกลาง" subtitle="ข่าวคัดกรองด้วยสมอง 4 ชั้น — เรียงตามความน่าทำของเพจเรา" />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 20px 60px' }}>
        {/* แถวบน: แท็บ + ปุ่มเก็บข่าว */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer',
                background: tab === t.id ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'rgba(255,255,255,0.05)',
                color: tab === t.id ? '#000' : 'var(--text-primary)', fontWeight: 600, fontSize: 14,
              }}>{t.label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={toggleAutopilot} title="เปิด: บก.เลือกข่าวคะแนน 8+ ส่งเจนเองทุกรอบ / ปิด: บก.แนะนำอย่างเดียว"
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid ' + (autopilot ? 'rgba(34,197,94,0.45)' : 'var(--border)'), cursor: 'pointer', background: autopilot ? 'rgba(34,197,94,0.12)' : 'var(--bg-card)', color: autopilot ? '#22c55e' : 'var(--text-muted)', fontWeight: 700, fontSize: 13.5 }}>
            {autopilot ? '🤖 Auto-Pilot: เปิด' : '⏸️ Auto-Pilot: ปิด'}</button>
          <button onClick={() => callChief()}
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(139,92,246,0.4)', cursor: 'pointer', background: 'rgba(139,92,246,0.12)', color: 'var(--desk-purple)', fontWeight: 700, fontSize: 13.5 }}>
            🧠 เรียก บก.ใหญ่</button>
          <button onClick={harvest} disabled={harvesting}
            style={{
              padding: '8px 18px', borderRadius: 10, border: 'none', cursor: harvesting ? 'wait' : 'pointer',
              background: harvesting ? '#4b5563' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)', color: '#fff', fontWeight: 700, fontSize: 14,
            }}>{harvesting ? '⏳ กำลังคัดกรอง...' : '🔄 หาข่าวรอบใหม่'}</button>
        </div>

        {/* ช่องวางลิงก์คลิปสัมภาษณ์ (เหมืองนาทีทอง) */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={clipUrl} onChange={e => setClipUrl(e.target.value)} disabled={mining}
            placeholder="🎙️ วางลิงก์คลิปสัมภาษณ์/รายการ (YouTube / FB Reel / TikTok) — ระบบถอดเสียง+ขุดนาทีทองให้"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13.5, outline: 'none' }} />
          <button onClick={mineClip} disabled={mining}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: mining ? 'wait' : 'pointer', background: mining ? '#4b5563' : 'linear-gradient(135deg,#06b6d4,#0e7490)', color: '#fff', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>
            {mining ? '⏳ กำลังขุด...' : '⛏️ ขุดนาทีทอง'}</button>
        </div>

        {/* ช่องรายงานโพสต์แรงตลาด — ตา engagement ของระบบ */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={mktUrl} onChange={e => setMktUrl(e.target.value)} disabled={mktSending}
            placeholder="📈 เห็นโพสต์ไหนกำลังแรงในฟีด? วางลิงก์ตรงนี้ — ระบบเก็บเข้าคลังตลาด ให้ บก.ใหญ่เรียนรู้ว่าตลาดเล่นอะไร"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.05)', color: 'var(--text-primary)', fontSize: 13.5, outline: 'none' }} />
          <button onClick={sendMarketPost} disabled={mktSending}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: mktSending ? 'wait' : 'pointer', background: mktSending ? '#4b5563' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>
            {mktSending ? '⏳...' : '📈 รายงานโพสต์แรง'}</button>
        </div>

        {/* brief จาก บก.ใหญ่ AI — รูปแบบหัวข้อสั้น */}
        {(chiefBrief?.orders?.length > 0 || chiefBrief?.brief) && (
          <div style={{ marginBottom: 12, padding: '12px 16px', borderRadius: 12, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)' }}>
            <div style={{ fontSize: 13.5, color: 'var(--desk-purple)', fontWeight: 700 }}>🧠 บก.ใหญ่ AI ({new Date(chiefBrief.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.)</div>
            {(chiefBrief.orders || []).map((o, i) => (
              <div key={i} style={{ fontSize: 13.5, color: 'var(--desk-purple-soft)', marginTop: 4 }}>📌 {o}</div>
            ))}
            {(chiefBrief.warnings || []).map((w, i) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--desk-red)', marginTop: 4 }}>⚠️ {w}</div>
            ))}
            {(chiefBrief.pushNow || []).length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--desk-green-soft)', marginTop: 4 }}>🚀 ดันทันที: {chiefBrief.pushNow.join(' · ')}</div>
            )}
            {!chiefBrief.orders?.length && chiefBrief.brief && (
              <div style={{ fontSize: 13.5, color: 'var(--desk-purple-soft)', marginTop: 4 }}>{chiefBrief.brief}</div>
            )}
            {chiefBrief.extraQueries?.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--desk-purple)', marginTop: 4 }}>🔎 สั่งเก็บเพิ่ม {chiefBrief.extraQueries.length} คำค้น (+{chiefBrief.harvested} ใบ)</div>
            )}
          </div>
        )}

        {/* ★ สั่ง บก.ใหญ่ ด้วยข้อความ — ไม่ต้องรอรอบ */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={chiefCmd} onChange={e => setChiefCmd(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && chiefCmd.trim()) { callChief(chiefCmd.trim()); setChiefCmd(''); } }}
            placeholder="🧠 สั่ง บก.ใหญ่ได้เลย เช่น: หาข่าวสัตว์น่ารักช่วยคน 3 เรื่อง / วิเคราะห์ว่าทำไมวันนี้ส่งทำน้อย / เช็คว่าคลังขาดหมวดไหน"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.06)', color: 'var(--text-primary)', fontSize: 13.5, outline: 'none' }} />
          <button onClick={() => { if (chiefCmd.trim()) { callChief(chiefCmd.trim()); setChiefCmd(''); } }}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', color: '#fff', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>
            🧠 สั่งเลย</button>
        </div>

        {/* ★ แถวสั่ง บก.รายฝ่ายทำทันที + สถานะคิว */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 700 }}>สั่ง บก.ทำทันที:</span>
          {[['good', '💚 บก.น้ำดี'], ['drama', '🌶️ บก.ดราม่า'], ['interview', '🎙️ บก.สัมภาษณ์']].map(([key, label]) => (
            <button key={key} onClick={() => runEditor(key, label)} disabled={!!editorRunning}
              style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid var(--border)', cursor: editorRunning ? 'wait' : 'pointer', background: editorRunning === key ? 'rgba(139,92,246,0.2)' : 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
              {editorRunning === key ? '⏳ กำลังสแกน...' : label + ' ลุย'}</button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            ✍️ กำลังเขียน <b style={{ color: 'var(--desk-blue)' }}>{queueDepth.processing}</b> · รอคิว <b style={{ color: 'var(--desk-amber)' }}>{queueDepth.pending}</b> · ✅ พร้อมใช้ <b style={{ color: 'var(--desk-green)' }}>{readyCount}</b>
          </span>
        </div>

        {/* แถบส่วนผสมวันนี้ + Mix Governor */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span>วันนี้ส่งทำแล้ว <b style={{ color: '#f59e0b' }}>{sentToday}</b> ข่าว</span>
          {Object.entries(editorStats).map(([who, n]) => (
            <span key={who} style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(139,92,246,0.12)', color: 'var(--desk-purple)', fontWeight: 700 }}>{who} ×{n}</span>
          ))}
          {governor && governor.total > 0 && (
            <>
              <span style={{ padding: '3px 10px', borderRadius: 999, fontWeight: 700, background: governor.positiveOk ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: governor.positiveOk ? '#22c55e' : 'var(--desk-red)' }}>
                💚 น้ำดี {governor.positivePct}% {governor.positiveOk ? '✓' : '(เป้า ≥40%)'}
              </span>
              <span style={{ padding: '3px 10px', borderRadius: 999, fontWeight: 700, background: governor.dramaOk ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.2)', color: governor.dramaOk ? 'var(--text-secondary)' : 'var(--desk-red)' }}>
                🌶️ ดราม่า {governor.dramaPct}% {governor.dramaOk ? '✓' : '⚠️ เกินเพดาน 20% — การ์ดดราม่าถูกกดลงแล้ว'}
              </span>
            </>
          )}
          {Object.entries(mixToday).map(([cat, n]) => (
            <span key={cat} style={{ padding: '3px 10px', borderRadius: 999, background: (CAT_COLORS[cat] || '#666') + '22', color: CAT_COLORS[cat] || '#999', fontWeight: 600 }}>
              {cat} ×{n}
            </span>
          ))}
        </div>

        {msg && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(139,92,246,0.12)', color: 'var(--desk-purple)', fontSize: 14 }}>{msg}</div>}

        {/* รายการข่าว */}
        {loading ? (
          <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>⏳ โหลด...</div>
        ) : items.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>
            คลังยังว่าง — กด <b>🔄 หาข่าวรอบใหม่</b> เพื่อให้ระบบไปเก็บ+คัดกรองข่าวชุดแรก
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(it => (
              <div key={it.id} style={{
                padding: '14px 16px', borderRadius: 14, background: 'var(--bg-card)',
                border: it.status === 'claimed' ? '1px solid rgba(245,158,11,0.5)' : it.status === 'sent' ? '1px solid rgba(34,197,94,0.4)' : '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {/* คะแนน */}
                  <div style={{ minWidth: 52, textAlign: 'center', padding: '8px 0', borderRadius: 12, background: scoreColor(it.finalScore) + '1d', color: scoreColor(it.finalScore), fontWeight: 800, fontSize: 20 }}>
                    {it.finalScore ?? '-'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 15, lineHeight: 1.45 }}>
                      {(LANE_ICONS[it.lane] || '📰') + ' '}{it.title}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
                      <span style={{ padding: '2px 9px', borderRadius: 999, background: (CAT_COLORS[it.category] || '#666') + '22', color: CAT_COLORS[it.category] || '#999', fontWeight: 600 }}>{it.category}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{it.source}</span>
                      {it.pickedBy && <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(139,92,246,0.15)', color: 'var(--desk-purple)', fontWeight: 700 }}>{it.pickedByIcon || '🤖'} {it.pickedBy} เลือก</span>}
                      {it.status === 'claimed' && <span style={{ color: 'var(--desk-amber)', fontWeight: 700 }}>📌 {it.claimedBy} จองแล้ว</span>}
                      {it.status === 'sent' && (() => {
                        const js = it.jobId ? jobStatus[it.jobId] : null;
                        if (!js) return <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ ส่งทำแล้ว</span>;
                        if (js.status === 'pending') return <span style={{ color: 'var(--desk-amber)', fontWeight: 700 }}>⏳ รอคิว{js.position ? `ที่ ${js.position}` : ''}</span>;
                        if (js.status === 'processing') return <span style={{ color: 'var(--desk-blue)', fontWeight: 700 }}>✍️ AI กำลังเขียน...</span>;
                        if (js.status === 'completed') return <a href="/generation-logs" style={{ color: '#22c55e', fontWeight: 700, textDecoration: 'underline' }}>✅ เขียนเสร็จ — เปิดดูใน Generation Log</a>;
                        if (js.status === 'failed') return <span style={{ color: 'var(--desk-red)', fontWeight: 700 }} title={js.error}>❌ เขียนล้มเหลว — ลองส่งใหม่</span>;
                        return <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ ส่งทำแล้ว</span>;
                      })()}
                      {it.performance === 'viral' && <span style={{ color: '#fb923c', fontWeight: 700 }}>🔥 ปังจริง</span>}
                      {it.performance === 'flop' && <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>🧊 แป้ก</span>}
                      {it.followupOf && <span style={{ color: '#c084fc' }}>🔁 ตามรอย: {String(it.followupOf).slice(0, 40)}</span>}
                    </div>
                    {it.judgeReason && (
                      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>🧠 {it.judgeReason}</div>
                    )}
                    {(it.angles || []).length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--desk-blue)' }}>
                        💡 {it.angles.join(' · ')}
                      </div>
                    )}
                    {it.research?.enrichedSummary && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)' }}>
                        <div style={{ fontSize: 12, color: 'var(--desk-green)', fontWeight: 700 }}>🔬 เจาะลึกแล้ว — พร้อมเขียน {it.research.readyScore}/10 ({it.research.sources?.length || 1} แหล่ง)</div>
                        {(it.research.keyFacts || []).slice(0, 3).map((f, fi) => (
                          <div key={fi} style={{ fontSize: 12.5, color: 'var(--desk-green-soft)', marginTop: 3 }}>• {f}</div>
                        ))}
                        {(it.research.quotes || []).slice(0, 1).map((q, qi) => (
                          <div key={qi} style={{ fontSize: 12.5, color: 'var(--desk-green-soft)', marginTop: 3, fontStyle: 'italic' }}>&ldquo;{q}&rdquo;</div>
                        ))}
                      </div>
                    )}
                    {it.consult?.angles?.length > 0 && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.22)' }}>
                        <div style={{ fontSize: 12.5, color: 'var(--desk-purple)', fontWeight: 700 }}>
                          {it.consult.icon} {it.consult.by} — {it.consult.verdict} <span style={{ fontWeight: 400 }}>({it.consult.verdictWhy})</span>
                        </div>
                        {it.consult.angles.map((a, ai) => (
                          <div key={ai} style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                            <b style={{ color: a.name === it.consult.bestAngle ? 'var(--desk-green)' : 'var(--text-primary)' }}>
                              {a.name === it.consult.bestAngle ? '⭐ ' : '• '}{a.name}
                            </b> — {a.how}{a.risk ? <span style={{ color: 'var(--desk-red)' }}> ⚠ {a.risk}</span> : ''}
                          </div>
                        ))}
                        {it.consult.doNot && <div style={{ fontSize: 12, color: 'var(--desk-red)', marginTop: 4 }}>🚫 ห้าม: {it.consult.doNot}</div>}
                      </div>
                    )}
                    {(it.goldenMoments || []).length > 0 && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)' }}>
                        {it.goldenMoments.map((g, gi) => (
                          <div key={gi} style={{ fontSize: 12.5, color: 'var(--desk-cyan)', marginBottom: 4 }}>
                            ⛏️ &ldquo;{g.quote}&rdquo; <span style={{ color: 'var(--text-muted)' }}>— {g.why}</span>
                          </div>
                        ))}
                        {it.captionSkeleton && <div style={{ fontSize: 12, color: 'var(--desk-blue)', marginTop: 4 }}>📝 โครงเล่า: {it.captionSkeleton}</div>}
                      </div>
                    )}
                  </div>
                </div>
                {/* ★ เนื้อที่เจนเสร็จ — คนหยิบ copy ไปทำโพสต์/ปกได้เลย */}
                {expanded[it.id] && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {expanded[it.id].map((v, vi) => (
                      <div key={vi} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <b style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>เวอร์ชัน {vi + 1}{v.title ? ` — ${String(v.title).slice(0, 60)}` : ''}</b>
                          <button onClick={() => copyText(v.content || v.text || '')}
                            style={{ padding: '4px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                            📋 คัดลอก</button>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
                          {String(v.content || v.text || '')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* ปุ่ม */}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <a href={it.url} target="_blank" rel="noreferrer"
                    style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>🔗 เปิดลิงก์</a>
                  {it.status !== 'sent' && (
                    <button onClick={() => sendToWorkflow(it)}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                      🚀 ส่งเข้า workflow</button>
                  )}
                  {it.status !== 'sent' && !it.consult && (
                    <button onClick={() => consult(it)} disabled={researching['c_' + it.id]}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: researching['c_' + it.id] ? 'wait' : 'pointer', background: 'rgba(139,92,246,0.15)', color: 'var(--desk-purple)', fontSize: 13, fontWeight: 700 }}>
                      {researching['c_' + it.id] ? '⏳ บก.กำลังดู...' : '💼 ปรึกษา บก.'}</button>
                  )}
                  {it.status !== 'sent' && it.lane !== 'interview' && !it.research && (
                    <button onClick={() => research(it)} disabled={researching[it.id]}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: researching[it.id] ? 'wait' : 'pointer', background: 'rgba(6,182,212,0.15)', color: 'var(--desk-cyan)', fontSize: 13, fontWeight: 700 }}>
                      {researching[it.id] ? '⏳ กำลังเจาะ...' : '🔬 เจาะลึก'}</button>
                  )}
                  {it.status === 'new' && (
                    <button onClick={() => act(it.id, 'claim')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(245,158,11,0.2)', color: 'var(--desk-amber)', fontSize: 13, fontWeight: 700 }}>
                      📌 จองข่าวนี้</button>
                  )}
                  {it.status === 'claimed' && it.claimedBy === me && (
                    <button onClick={() => act(it.id, 'unclaim')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13 }}>
                      ↩️ ปล่อยคืน</button>
                  )}
                  {it.status !== 'sent' && (
                    <button onClick={() => act(it.id, 'dismiss')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: 'var(--desk-red)', fontSize: 13 }}>
                      🗑 ไม่เอา</button>
                  )}
                  {it.status === 'sent' && (
                    <button onClick={() => openVersions(it)}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: 'var(--desk-green)', fontSize: 13, fontWeight: 700 }}>
                      {expanded[it.id] ? '📕 ปิดเนื้อ' : '📖 เปิดเนื้อที่เจนแล้ว'}</button>
                  )}
                  {it.status === 'sent' && !it.used && (
                    <button onClick={() => act(it.id, 'used')} title="หยิบเนื้อไปทำโพสต์แล้ว — เก็บการ์ดออกจากชั้นวาง"
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, border: '1px solid var(--border)' }}>
                      ✔️ หยิบไปใช้แล้ว</button>
                  )}
                  {it.status === 'sent' && !it.performance && (
                    <>
                      <button onClick={() => act(it.id, 'viral')} title="โพสต์แล้วปัง — สอนระบบให้หาแนวนี้เพิ่ม"
                        style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(251,146,60,0.18)', color: '#fb923c', fontSize: 13, fontWeight: 700 }}>
                        🔥 ปังจริง</button>
                      <button onClick={() => act(it.id, 'flop')} title="โพสต์แล้วแป้ก — สอนระบบให้เลี่ยงแนวนี้"
                        style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(148,163,184,0.12)', color: 'var(--text-secondary)', fontSize: 13 }}>
                        🧊 แป้ก</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
