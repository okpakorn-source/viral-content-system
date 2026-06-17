'use client';
import { useState, useEffect } from 'react';

export default function CastingAdminPage() {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');
  const [building, setBuilding] = useState(false);

  const load = async () => {
    try { const r = await fetch('/api/casting/results', { cache: 'no-store' }); const d = await r.json(); if (d.success) setResults(d.results || []); } catch {}
  };
  useEffect(() => { load(); }, []);

  const build = async () => {
    if (!confirm('สร้าง/รีเฟรชคลังคำถามใหม่จากคลังเจน? (ใช้เวลา ~2-4 นาที + ใช้ AI แต่งตัวลวง)')) return;
    setBuilding(true); setMsg('🛠️ กำลังสร้างคลังคำถาม... (อย่าปิดหน้านี้)');
    try {
      const r = await fetch('/api/casting/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 35 }) });
      const d = await r.json();
      setMsg(d.success ? `✅ สร้างคลังคำถามแล้ว ${d.built} ข้อ` : `❌ ${d.error}`);
    } catch (e) { setMsg('❌ ' + e.message); }
    setBuilding(false);
  };

  const sorted = [...results].sort((a, b) => b.percent - a.percent);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary,#0d0d1a)', color: 'var(--text-primary,#e8e8f0)', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 18px 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>🗂️ ผลแบบทดสอบเซนส์ข่าว (แอดมิน)</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border,#2a2a3e)', background: 'var(--bg-card,#1a1a2e)', color: 'inherit', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 รีเฟรช</button>
            <button onClick={build} disabled={building} style={{ padding: '8px 14px', borderRadius: 9, border: 'none', background: building ? '#4b5563' : 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: building ? 'wait' : 'pointer', fontFamily: 'inherit' }}>{building ? '⏳ กำลังสร้าง...' : '🛠️ สร้าง/รีเฟรชคลังคำถาม'}</button>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted,#888)', margin: '6px 0 14px' }}>ผู้สมัครเรียงตามคะแนนสูง→ต่ำ · ลิงก์ทำแบบทดสอบ: <a href="/casting" style={{ color: '#3b82f6' }}>/casting</a></p>
        {msg && <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 9, background: 'rgba(59,130,246,0.1)', color: '#60a5fa', fontSize: 13 }}>{msg}</div>}

        <div style={{ fontSize: 12.5, color: 'var(--text-muted,#888)', marginBottom: 8 }}>ทั้งหมด {results.length} คน</div>
        {results.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted,#888)', fontSize: 13 }}>ยังไม่มีผู้ทำแบบทดสอบ</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map((r, i) => (
            <div key={r.id} style={{ border: '1px solid var(--border,#2a2a3e)', borderRadius: 11, overflow: 'hidden' }}>
              <div onClick={() => setOpen(open === r.id ? null : r.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer', background: 'var(--bg-card,#1a1a2e)' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-muted,#888)', minWidth: 24 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{r.total}/{r.maxScore}</span>
                <span style={{ fontSize: 13, fontWeight: 800, minWidth: 48, textAlign: 'right', color: r.percent >= 70 ? '#22c55e' : r.percent >= 45 ? '#eab308' : '#ef4444' }}>{r.percent}%</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted,#888)' }}>{new Date(r.completedAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {open === r.id && (
                <div style={{ padding: 14, borderTop: '1px solid var(--border,#2a2a3e)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {(r.detail || []).map((d, j) => (
                    <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ fontWeight: 800, minWidth: 26, color: d.score === 1 ? '#22c55e' : d.score === 0.5 ? '#eab308' : '#ef4444' }}>+{d.score}</span>
                      <span style={{ flex: 1, color: 'var(--text-secondary,#bbb)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.newsTitle}</span>
                      <span style={{ color: d.chosenQuality === 'best' ? '#22c55e' : d.chosenQuality === 'medium' ? '#eab308' : '#ef4444', fontWeight: 700 }}>{d.chosenQuality === 'best' ? 'ดีสุด' : d.chosenQuality === 'medium' ? 'กลาง' : 'ไม่ดี'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
