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
];

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
      if (d.success) { setItems(d.items); setMixToday(d.mixToday || {}); setSentToday(d.sentToday || 0); }
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
    setMsg(`🚀 ส่ง "${item.title.slice(0, 40)}..." เข้าคิวเขียนแล้ว`);
    try {
      const res = await fetch('/api/queue/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: item.url, contentLength: 'short', userId: `desk-${user}` }),
      });
      const d = await res.json();
      if (d.success) {
        await act(item.id, 'sent');
        setMsg(`✅ เข้าคิวแล้ว (คิวที่ ${d.position}) — ดูผลในหน้า Generation Log`);
      } else setMsg(`❌ ${d.error}`);
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
          <button onClick={harvest} disabled={harvesting}
            style={{
              padding: '8px 18px', borderRadius: 10, border: 'none', cursor: harvesting ? 'wait' : 'pointer',
              background: harvesting ? '#4b5563' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)', color: '#fff', fontWeight: 700, fontSize: 14,
            }}>{harvesting ? '⏳ กำลังคัดกรอง...' : '🔄 หาข่าวรอบใหม่'}</button>
        </div>

        {/* แถบส่วนผสมวันนี้ */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, fontSize: 13, color: '#94a3b8' }}>
          <span>วันนี้ส่งทำแล้ว <b style={{ color: '#f59e0b' }}>{sentToday}</b> ข่าว</span>
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
                      {it.lane === 'good' ? '💎 ' : '🔥 '}{it.title}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
                      <span style={{ padding: '2px 9px', borderRadius: 999, background: (CAT_COLORS[it.category] || '#666') + '22', color: CAT_COLORS[it.category] || '#999', fontWeight: 600 }}>{it.category}</span>
                      <span style={{ color: '#64748b' }}>{it.source}</span>
                      {it.status === 'claimed' && <span style={{ color: '#f59e0b', fontWeight: 700 }}>📌 {it.claimedBy} จองแล้ว</span>}
                      {it.status === 'sent' && <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ ส่งทำแล้ว</span>}
                    </div>
                    {it.judgeReason && (
                      <div style={{ marginTop: 6, fontSize: 13, color: '#94a3b8' }}>🧠 {it.judgeReason}</div>
                    )}
                    {(it.angles || []).length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12.5, color: '#7dd3fc' }}>
                        💡 {it.angles.join(' · ')}
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
