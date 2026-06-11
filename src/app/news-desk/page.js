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
];

const LANE_ICONS = { trend: '🔥', good: '💎', evergreen: '🗄️', interview: '🎙️', followup: '🔁', buzz: '📊' };

const CAT_COLORS = {
  'น้ำใจ/ช่วยเหลือ': '#22c55e', 'กตัญญู/ครอบครัวอบอุ่น': '#10b981', 'สู้ชีวิต': '#06b6d4',
  'คนดังทำดี/ติดดิน': '#a3e635', 'สัมภาษณ์/บทสนทนาดี': '#8b5cf6', 'บันเทิงกระแส': '#f59e0b',
  'ดราม่าสังคม': '#ef4444', 'เตือนภัย/อุทาหรณ์': '#f97316', 'อื่นๆ': '#6b7280',
};

function scoreColor(s) {
  if (s >= 75) return '#22c55e';
  if (s >= 55) return '#f59e0b';
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

  const callChief = async () => {
    setMsg('🧠 บก.ใหญ่ AI กำลังวิเคราะห์ภาพรวม+สั่งเก็บเพิ่ม (~2-4 นาที)...');
    try {
      const res = await fetch('/api/news-desk/chief', { method: 'POST' });
      const d = await res.json();
      setMsg(d.success ? `🧠 ${d.brief}` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
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
                padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
                background: tab === t.id ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'rgba(255,255,255,0.05)',
                color: tab === t.id ? '#000' : '#cbd5e1', fontWeight: 600, fontSize: 14,
              }}>{t.label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={callChief}
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(139,92,246,0.4)', cursor: 'pointer', background: 'rgba(139,92,246,0.12)', color: '#c4b5fd', fontWeight: 700, fontSize: 13.5 }}>
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
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 13.5, outline: 'none' }} />
          <button onClick={mineClip} disabled={mining}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: mining ? 'wait' : 'pointer', background: mining ? '#4b5563' : 'linear-gradient(135deg,#06b6d4,#0e7490)', color: '#fff', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>
            {mining ? '⏳ กำลังขุด...' : '⛏️ ขุดนาทีทอง'}</button>
        </div>

        {/* ช่องรายงานโพสต์แรงตลาด — ตา engagement ของระบบ */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={mktUrl} onChange={e => setMktUrl(e.target.value)} disabled={mktSending}
            placeholder="📈 เห็นโพสต์ไหนกำลังแรงในฟีด? วางลิงก์ตรงนี้ — ระบบเก็บเข้าคลังตลาด ให้ บก.ใหญ่เรียนรู้ว่าตลาดเล่นอะไร"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.05)', color: '#e2e8f0', fontSize: 13.5, outline: 'none' }} />
          <button onClick={sendMarketPost} disabled={mktSending}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: mktSending ? 'wait' : 'pointer', background: mktSending ? '#4b5563' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>
            {mktSending ? '⏳...' : '📈 รายงานโพสต์แรง'}</button>
        </div>

        {/* brief จาก บก.ใหญ่ AI — รูปแบบหัวข้อสั้น */}
        {(chiefBrief?.orders?.length > 0 || chiefBrief?.brief) && (
          <div style={{ marginBottom: 12, padding: '12px 16px', borderRadius: 12, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)' }}>
            <div style={{ fontSize: 13.5, color: '#c4b5fd', fontWeight: 700 }}>🧠 บก.ใหญ่ AI ({new Date(chiefBrief.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.)</div>
            {(chiefBrief.orders || []).map((o, i) => (
              <div key={i} style={{ fontSize: 13.5, color: '#ddd6fe', marginTop: 4 }}>📌 {o}</div>
            ))}
            {(chiefBrief.warnings || []).map((w, i) => (
              <div key={i} style={{ fontSize: 13, color: '#fca5a5', marginTop: 4 }}>⚠️ {w}</div>
            ))}
            {(chiefBrief.pushNow || []).length > 0 && (
              <div style={{ fontSize: 13, color: '#86efac', marginTop: 4 }}>🚀 ดันทันที: {chiefBrief.pushNow.join(' · ')}</div>
            )}
            {!chiefBrief.orders?.length && chiefBrief.brief && (
              <div style={{ fontSize: 13.5, color: '#ddd6fe', marginTop: 4 }}>{chiefBrief.brief}</div>
            )}
            {chiefBrief.extraQueries?.length > 0 && (
              <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 4 }}>🔎 สั่งเก็บเพิ่ม {chiefBrief.extraQueries.length} คำค้น (+{chiefBrief.harvested} ใบ)</div>
            )}
          </div>
        )}

        {/* แถบส่วนผสมวันนี้ + Mix Governor */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, fontSize: 13, color: '#94a3b8' }}>
          <span>วันนี้ส่งทำแล้ว <b style={{ color: '#f59e0b' }}>{sentToday}</b> ข่าว</span>
          {governor && governor.total > 0 && (
            <>
              <span style={{ padding: '3px 10px', borderRadius: 999, fontWeight: 700, background: governor.positiveOk ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: governor.positiveOk ? '#22c55e' : '#f87171' }}>
                💚 น้ำดี {governor.positivePct}% {governor.positiveOk ? '✓' : '(เป้า ≥40%)'}
              </span>
              <span style={{ padding: '3px 10px', borderRadius: 999, fontWeight: 700, background: governor.dramaOk ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.2)', color: governor.dramaOk ? '#94a3b8' : '#f87171' }}>
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

        {msg && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(139,92,246,0.12)', color: '#c4b5fd', fontSize: 14 }}>{msg}</div>}

        {/* รายการข่าว */}
        {loading ? (
          <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>⏳ โหลด...</div>
        ) : items.length === 0 ? (
          <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>
            คลังยังว่าง — กด <b>🔄 หาข่าวรอบใหม่</b> เพื่อให้ระบบไปเก็บ+คัดกรองข่าวชุดแรก
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(it => (
              <div key={it.id} style={{
                padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.045)',
                border: it.status === 'claimed' ? '1px solid rgba(245,158,11,0.5)' : it.status === 'sent' ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(255,255,255,0.07)',
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {/* คะแนน */}
                  <div style={{ minWidth: 52, textAlign: 'center', padding: '8px 0', borderRadius: 12, background: scoreColor(it.finalScore) + '1d', color: scoreColor(it.finalScore), fontWeight: 800, fontSize: 20 }}>
                    {it.finalScore ?? '-'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 15, lineHeight: 1.45 }}>
                      {(LANE_ICONS[it.lane] || '📰') + ' '}{it.title}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
                      <span style={{ padding: '2px 9px', borderRadius: 999, background: (CAT_COLORS[it.category] || '#666') + '22', color: CAT_COLORS[it.category] || '#999', fontWeight: 600 }}>{it.category}</span>
                      <span style={{ color: '#64748b' }}>{it.source}</span>
                      {it.status === 'claimed' && <span style={{ color: '#f59e0b', fontWeight: 700 }}>📌 {it.claimedBy} จองแล้ว</span>}
                      {it.status === 'sent' && (() => {
                        const js = it.jobId ? jobStatus[it.jobId] : null;
                        if (!js) return <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ ส่งทำแล้ว</span>;
                        if (js.status === 'pending') return <span style={{ color: '#fbbf24', fontWeight: 700 }}>⏳ รอคิว{js.position ? `ที่ ${js.position}` : ''}</span>;
                        if (js.status === 'processing') return <span style={{ color: '#60a5fa', fontWeight: 700 }}>✍️ AI กำลังเขียน...</span>;
                        if (js.status === 'completed') return <a href="/generation-logs" style={{ color: '#22c55e', fontWeight: 700, textDecoration: 'underline' }}>✅ เขียนเสร็จ — เปิดดูใน Generation Log</a>;
                        if (js.status === 'failed') return <span style={{ color: '#f87171', fontWeight: 700 }} title={js.error}>❌ เขียนล้มเหลว — ลองส่งใหม่</span>;
                        return <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ ส่งทำแล้ว</span>;
                      })()}
                      {it.performance === 'viral' && <span style={{ color: '#fb923c', fontWeight: 700 }}>🔥 ปังจริง</span>}
                      {it.performance === 'flop' && <span style={{ color: '#94a3b8', fontWeight: 700 }}>🧊 แป้ก</span>}
                      {it.followupOf && <span style={{ color: '#c084fc' }}>🔁 ตามรอย: {String(it.followupOf).slice(0, 40)}</span>}
                    </div>
                    {it.judgeReason && (
                      <div style={{ marginTop: 6, fontSize: 13, color: '#94a3b8' }}>🧠 {it.judgeReason}</div>
                    )}
                    {(it.angles || []).length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12.5, color: '#7dd3fc' }}>
                        💡 {it.angles.join(' · ')}
                      </div>
                    )}
                    {it.research?.enrichedSummary && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)' }}>
                        <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>🔬 เจาะลึกแล้ว — พร้อมเขียน {it.research.readyScore}/10 ({it.research.sources?.length || 1} แหล่ง)</div>
                        {(it.research.keyFacts || []).slice(0, 3).map((f, fi) => (
                          <div key={fi} style={{ fontSize: 12.5, color: '#bbf7d0', marginTop: 3 }}>• {f}</div>
                        ))}
                        {(it.research.quotes || []).slice(0, 1).map((q, qi) => (
                          <div key={qi} style={{ fontSize: 12.5, color: '#86efac', marginTop: 3, fontStyle: 'italic' }}>&ldquo;{q}&rdquo;</div>
                        ))}
                      </div>
                    )}
                    {(it.goldenMoments || []).length > 0 && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)' }}>
                        {it.goldenMoments.map((g, gi) => (
                          <div key={gi} style={{ fontSize: 12.5, color: '#a5f3fc', marginBottom: 4 }}>
                            ⛏️ &ldquo;{g.quote}&rdquo; <span style={{ color: '#64748b' }}>— {g.why}</span>
                          </div>
                        ))}
                        {it.captionSkeleton && <div style={{ fontSize: 12, color: '#7dd3fc', marginTop: 4 }}>📝 โครงเล่า: {it.captionSkeleton}</div>}
                      </div>
                    )}
                  </div>
                </div>
                {/* ปุ่ม */}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <a href={it.url} target="_blank" rel="noreferrer"
                    style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.07)', color: '#cbd5e1', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>🔗 เปิดลิงก์</a>
                  {it.status !== 'sent' && (
                    <button onClick={() => sendToWorkflow(it)}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                      🚀 ส่งเข้า workflow</button>
                  )}
                  {it.status !== 'sent' && it.lane !== 'interview' && !it.research && (
                    <button onClick={() => research(it)} disabled={researching[it.id]}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: researching[it.id] ? 'wait' : 'pointer', background: 'rgba(6,182,212,0.15)', color: '#22d3ee', fontSize: 13, fontWeight: 700 }}>
                      {researching[it.id] ? '⏳ กำลังเจาะ...' : '🔬 เจาะลึก'}</button>
                  )}
                  {it.status === 'new' && (
                    <button onClick={() => act(it.id, 'claim')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(245,158,11,0.2)', color: '#fbbf24', fontSize: 13, fontWeight: 700 }}>
                      📌 จองข่าวนี้</button>
                  )}
                  {it.status === 'claimed' && it.claimedBy === me && (
                    <button onClick={() => act(it.id, 'unclaim')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.08)', color: '#94a3b8', fontSize: 13 }}>
                      ↩️ ปล่อยคืน</button>
                  )}
                  {it.status !== 'sent' && (
                    <button onClick={() => act(it.id, 'dismiss')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: '#f87171', fontSize: 13 }}>
                      🗑 ไม่เอา</button>
                  )}
                  {it.status === 'sent' && !it.performance && (
                    <>
                      <button onClick={() => act(it.id, 'viral')} title="โพสต์แล้วปัง — สอนระบบให้หาแนวนี้เพิ่ม"
                        style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(251,146,60,0.18)', color: '#fb923c', fontSize: 13, fontWeight: 700 }}>
                        🔥 ปังจริง</button>
                      <button onClick={() => act(it.id, 'flop')} title="โพสต์แล้วแป้ก — สอนระบบให้เลี่ยงแนวนี้"
                        style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(148,163,184,0.12)', color: '#94a3b8', fontSize: 13 }}>
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
