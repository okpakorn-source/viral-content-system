'use client';
/**
 * ♻️ คลังแตกประเด็นข่าว (เนื้อหาดิบ) — ดูผลทุกครั้งที่ระบบแตกข่าวท็อกซิก/ดราม่า → เนื้อหาดิบหลายมุมเชิงบวก
 *   แสดงข่าวต้นทาง + แหล่งอ้างอิง/ลิงก์ ให้ตรวจสอบที่มาที่ไปของข้อมูลได้ · เก็บทั้งแบบทดสอบและทำจริง
 *   ผู้จัดการสร้างไว้ให้กลับมาเช็กย้อนหลังได้ — 17 มิ.ย. 69
 */
import { useState, useEffect } from 'react';

const scoreColor = (s) => s == null ? 'var(--text-muted)' : s >= 8 ? 'var(--desk-green)' : s >= 6 ? 'var(--desk-amber)' : s >= 4 ? '#f97316' : 'var(--desk-red)';

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
    setRunning(true); setMsg('⏳ กำลังรันชุดทดสอบ (แตกประเด็นเป็นเนื้อหาดิบ + ประเมินคุณภาพ) ~1-2 นาที...');
    try {
      const r = await fetch('/api/news-desk/reframe-cases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'runTest' }),
      });
      const d = await r.json();
      if (d.success) {
        const s = d.stats;
        setMsg(`✅ เสร็จ: แตกประเด็นสำเร็จ ${s.reframed}/${s.total} เคส · บล็อก ${s.blocked} · คะแนนเฉลี่ยคุณภาพเนื้อหาดิบ ${s.avgScore}/10`);
        await load('all'); setFilter('all');
      } else { setMsg('❌ ' + (d.error || 'รันไม่สำเร็จ')); }
    } catch (e) { setMsg('❌ ' + e.message); }
    setRunning(false);
  };

  const copy = (t) => { navigator.clipboard?.writeText(t); setMsg('📋 คัดลอกเนื้อหาดิบแล้ว'); setTimeout(() => setMsg(''), 1500); };

  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, color: 'var(--text-primary)' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px', color: 'var(--text-primary)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4, color: 'var(--text-primary)' }}>♻️ คลังแตกประเด็นข่าว (เนื้อหาดิบ)</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        แตกข่าวกระแส/ดราม่า/ท็อกซิก → "เนื้อหาดิบ" หลายมุมเชิงบวก (ที่มาที่ไป+เหตุผล+บริบท ไม่บิดเบือน) สำหรับเอาไปป้อนระบบทำข่าวอัตโนมัติเจนต่อ · มีข่าวต้นทาง + แหล่งอ้างอิงพร้อมลิงก์ให้ตรวจที่มา · เก็บทั้งทดสอบและทำจริง
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
            <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.k}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: b.c || 'var(--text-primary)' }}>{b.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* ปุ่ม + ฟิลเตอร์ */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <button onClick={runTest} disabled={running}
          style={{ background: running ? 'var(--bg-elevated)' : 'linear-gradient(135deg,#f91880,#7c3aed)', color: running ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800, cursor: running ? 'default' : 'pointer', fontSize: 14 }}>
          {running ? '⏳ กำลังรัน...' : '▶ รันชุดทดสอบใหม่'}
        </button>
        {['all', 'test', 'real'].map(m => (
          <button key={m} onClick={() => setFilter(m)}
            style={{ background: filter === m ? '#7c3aed' : 'var(--bg-card)', color: filter === m ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
            {m === 'all' ? 'ทั้งหมด' : m === 'test' ? '🧪 ทดสอบ' : '💼 ทำจริง'}
          </button>
        ))}
        <button onClick={() => load(filter)} style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>↻ รีเฟรช</button>
      </div>

      {msg && <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 14, fontSize: 13, color: 'var(--text-primary)' }}>{msg}</div>}

      {loading ? <div style={{ color: 'var(--text-muted)', padding: 30, textAlign: 'center' }}>กำลังโหลด...</div>
        : cases.length === 0 ? <div style={{ color: 'var(--text-muted)', padding: 30, textAlign: 'center' }}>ยังไม่มีเคสในคลัง — กด “รันชุดทดสอบใหม่” เพื่อเริ่ม</div>
        : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {cases.map((c) => (
            <div key={c.id} style={card}>
              {/* หัวเคส: ป้ายโหมด + เวลา + คะแนน */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 6, background: 'var(--bg-elevated)', color: c.mode === 'test' ? 'var(--desk-amber)' : 'var(--desk-green)', marginRight: 8 }}>
                    {c.mode === 'test' ? '🧪 ทดสอบ' : c.mode === 'auto' ? '🤖 อัตโนมัติ' : '💼 ทำจริง'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(c.at).toLocaleString('th-TH')}</span>
                </div>
                {typeof c.evalScore === 'number' && (
                  <div style={{ textAlign: 'center', minWidth: 64 }}>
                    <div style={{ fontSize: 26, fontWeight: 900, color: scoreColor(c.evalScore), lineHeight: 1 }}>{c.evalScore}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>คุณภาพดิบ /10</div>
                  </div>
                )}
              </div>

              {/* ── ข่าวต้นทาง (ที่มาของการแตกประเด็น) ── */}
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 3 }}>📰 ข่าวต้นทาง{c.sourceName ? ` · ${c.sourceName}` : ''}</div>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.45 }}>{c.sourceTitle}</div>
                {c.sourceSnippet && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.55 }}>{c.sourceSnippet}</div>}
                {c.sourceUrl && (
                  <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: 'var(--desk-blue)', textDecoration: 'underline', wordBreak: 'break-all' }}>
                    🔗 เปิดข่าวต้นทาง
                  </a>
                )}
              </div>

              {/* ── แหล่งอ้างอิง / รีเสิร์ช (ตรวจที่มาที่ไปได้) ── */}
              {Array.isArray(c.sources) && c.sources.length > 0 && (
                <div style={{ background: 'rgba(125,211,252,0.07)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 4 }}>
                    🔎 แหล่งอ้างอิง ({c.sources.length}){c.researchUsed ? ' · ใช้ข้อมูลรีเสิร์ชเสริม' : ''}
                  </div>
                  {c.sources.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, marginTop: 2 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{s.type}: </span>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--desk-blue)', textDecoration: 'underline', wordBreak: 'break-all' }}>{s.title || s.url}</a>
                    </div>
                  ))}
                </div>
              )}

              {c.cleanBrief && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  <b style={{ color: 'var(--text-primary)' }}>📋 แก่นข่าว (สะอาด):</b> {c.cleanBrief}
                </div>
              )}

              {c.evalNote && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.55 }}>🤖 <b style={{ color: scoreColor(c.evalScore) }}>ผู้ตรวจคุณภาพ:</b> {c.evalNote}</div>
              )}

              {/* ── เนื้อหาดิบหลายมุม (คัดลอกไปป้อนระบบเจน) ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(c.angles || []).map((a, i) => {
                  const raw = a.rawContent || a.caption || ''; // รองรับเคสเก่า
                  return (
                  <div key={i} style={{ borderLeft: '3px solid #a855f7', paddingLeft: 11 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>🎯 มุม{a.type} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {a.focus}</span></div>
                    {raw && (
                      <div onClick={() => copy(raw)} title="คลิกเพื่อคัดลอกเนื้อหาดิบ (เอาไปป้อนระบบเจน)"
                        style={{ fontSize: 13, marginTop: 5, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', cursor: 'pointer', whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--text-primary)' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>📝 เนื้อหาดิบ (คลิกคัดลอก):</span><br />{raw}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
