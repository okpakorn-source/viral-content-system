'use client';
/**
 * ♻️ คลังแปลงมุมข่าว — ดูผลทุกครั้งที่ระบบแปลงข่าวท็อกซิก/ดราม่า → มุมเชิงบวก
 *   ทั้งแบบ "ทดสอบ" (รันชุดเทส + ให้ AI ประเมินความใกล้บทความไวรัล) และ "ทำจริง" (ทีมกด ♻️ บนการ์ด)
 *   ผู้จัดการสร้างไว้ให้กลับมาเช็กย้อนหลังได้ — 17 มิ.ย. 69
 */
import { useState, useEffect } from 'react';

const scoreColor = (s) => s == null ? '#64748b' : s >= 8 ? '#22c55e' : s >= 6 ? '#eab308' : s >= 4 ? '#f97316' : '#ef4444';

export default function ReframeCasesPage() {
  const [cases, setCases] = useState([]);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async (mode = filter) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/news-desk/reframe-cases?mode=${mode}`);
      const d = await r.json();
      if (d.success) { setCases(d.cases || []); setStats(d.stats || null); }
    } catch (e) { setMsg('โหลดไม่สำเร็จ: ' + e.message); }
    setLoading(false);
  };

  useEffect(() => { load(filter); /* eslint-disable-next-line */ }, [filter]);

  const runTest = async () => {
    setRunning(true); setMsg('⏳ กำลังรันชุดทดสอบ (แปลงมุม + ประเมินความใกล้ไวรัล) ~1-2 นาที...');
    try {
      const r = await fetch('/api/news-desk/reframe-cases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'runTest' }),
      });
      const d = await r.json();
      if (d.success) {
        const s = d.stats;
        setMsg(`✅ เสร็จ: แปลงสำเร็จ ${s.reframed}/${s.total} เคส · บล็อก ${s.blocked} · คะแนนเฉลี่ยความใกล้ไวรัล ${s.avgScore}/10`);
        await load('all'); setFilter('all');
      } else { setMsg('❌ ' + (d.error || 'รันไม่สำเร็จ')); }
    } catch (e) { setMsg('❌ ' + e.message); }
    setRunning(false);
  };

  const copy = (t) => { navigator.clipboard?.writeText(t); setMsg('📋 คัดลอกแล้ว'); setTimeout(() => setMsg(''), 1500); };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>♻️ คลังแปลงมุมข่าว</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        บันทึกทุกครั้งที่ระบบแปลงข่าวกระแส/ดราม่า/ท็อกซิก → มุมนำเสนอเชิงบวก · ทั้งแบบทดสอบและทำจริง · มี AI ประเมินว่าใกล้บทความไวรัลแค่ไหน
      </p>

      {/* สถิติ */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { k: 'ทั้งหมด', v: stats.total },
            { k: 'ทดสอบ', v: stats.tests },
            { k: 'ทำจริง', v: stats.reals },
            { k: 'คะแนนเฉลี่ย (เทส)', v: stats.avgTestScore != null ? `${stats.avgTestScore}/10` : '—', c: scoreColor(stats.avgTestScore) },
            { k: 'คะแนนดีสุด', v: stats.bestScore != null ? `${stats.bestScore}/10` : '—', c: scoreColor(stats.bestScore) },
          ].map((b, i) => (
            <div key={i} style={{ background: 'var(--surface, #1e293b)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.k}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: b.c || 'inherit' }}>{b.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* ปุ่ม + ฟิลเตอร์ */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <button onClick={runTest} disabled={running}
          style={{ background: running ? '#475569' : 'linear-gradient(135deg,#f91880,#7c3aed)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800, cursor: running ? 'default' : 'pointer', fontSize: 14 }}>
          {running ? '⏳ กำลังรัน...' : '▶ รันชุดทดสอบใหม่'}
        </button>
        {['all', 'test', 'real'].map(m => (
          <button key={m} onClick={() => setFilter(m)}
            style={{ background: filter === m ? '#7c3aed' : 'var(--surface,#1e293b)', color: filter === m ? '#fff' : 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
            {m === 'all' ? 'ทั้งหมด' : m === 'test' ? '🧪 ทดสอบ' : '💼 ทำจริง'}
          </button>
        ))}
        <button onClick={() => load(filter)} style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>↻ รีเฟรช</button>
      </div>

      {msg && <div style={{ padding: '10px 14px', background: 'rgba(124,58,237,0.12)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 14, fontSize: 13 }}>{msg}</div>}

      {loading ? <div style={{ color: 'var(--text-muted)', padding: 30, textAlign: 'center' }}>กำลังโหลด...</div>
        : cases.length === 0 ? <div style={{ color: 'var(--text-muted)', padding: 30, textAlign: 'center' }}>ยังไม่มีเคสในคลัง — กด “รันชุดทดสอบใหม่” เพื่อเริ่ม</div>
        : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {cases.map((c) => (
            <div key={c.id} style={{ background: 'var(--surface,#1e293b)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 6, background: c.mode === 'test' ? 'rgba(234,179,8,0.18)' : 'rgba(34,197,94,0.18)', color: c.mode === 'test' ? '#eab308' : '#22c55e', marginRight: 8 }}>
                    {c.mode === 'test' ? '🧪 ทดสอบ' : c.mode === 'auto' ? '🤖 อัตโนมัติ' : '💼 ทำจริง'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(c.at).toLocaleString('th-TH')}</span>
                  <div style={{ fontWeight: 800, fontSize: 15, marginTop: 4 }}>{c.sourceTitle}</div>
                </div>
                {typeof c.evalScore === 'number' && (
                  <div style={{ textAlign: 'center', minWidth: 64 }}>
                    <div style={{ fontSize: 26, fontWeight: 900, color: scoreColor(c.evalScore), lineHeight: 1 }}>{c.evalScore}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>ใกล้ไวรัล /10</div>
                  </div>
                )}
              </div>

              {c.cleanBrief && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', background: 'rgba(0,0,0,0.15)', borderRadius: 8, padding: '8px 10px', marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                  <b style={{ color: 'var(--text)' }}>📋 แก่นข่าว (สะอาด):</b> {c.cleanBrief}
                </div>
              )}

              {c.evalNote && (
                <div style={{ fontSize: 12, color: scoreColor(c.evalScore), marginBottom: 10 }}>🤖 ผู้ตรวจ: {c.evalNote}</div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(c.angles || []).map((a, i) => (
                  <div key={i} style={{ borderLeft: '3px solid #7c3aed', paddingLeft: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>🎯 {a.type} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {a.focus}</span></div>
                    {a.how && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>วิธีเล่น: {a.how}</div>}
                    {a.caption && (
                      <div onClick={() => copy(a.caption)} title="คลิกเพื่อคัดลอก"
                        style={{ fontSize: 13, marginTop: 4, background: 'rgba(124,58,237,0.1)', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}>
                        💬 {a.caption}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
