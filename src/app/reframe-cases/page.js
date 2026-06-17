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
  // ป้ายขั้นตอน (มีเลข ①②③ + สีแถบ) ให้เห็นชัดว่าแต่ละส่วนคืออะไร
  const stepHeader = (clr) => ({ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 900, color: 'var(--text-primary)', borderLeft: `4px solid ${clr}`, paddingLeft: 9, margin: '14px 0 7px' });
  const stepNote = { fontWeight: 400, fontSize: 11.5, color: 'var(--text-muted)' };
  const sectionBox = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' };
  const fieldLabel = { fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 0.3, textTransform: 'uppercase' };

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

              {/* ───────── STEP ① ข่าวต้นทาง (ข่าวดิบที่รับเข้ามา) ───────── */}
              <div style={stepHeader('#7dd3fc')}>① ข่าวต้นทาง <span style={stepNote}>— ข่าวดิบที่รับเข้ามา (ยังไม่แปลง)</span></div>
              <div style={sectionBox}>
                <div style={fieldLabel}>หัวข้อข่าว</div>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.45, marginTop: 2 }}>
                  {c.sourceTitle}{c.sourceName ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}> · {c.sourceName}</span> : ''}
                </div>
                {c.sourceSnippet && <>
                  <div style={{ ...fieldLabel, marginTop: 9 }}>เนื้อข่าว</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{c.sourceSnippet}</div>
                </>}
                {c.sourceUrl && (
                  <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: 'var(--desk-blue)', textDecoration: 'underline', wordBreak: 'break-all' }}>
                    🔗 เปิดข่าวต้นทาง
                  </a>
                )}
                {Array.isArray(c.sources) && c.sources.length > 0 && (
                  <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                    <div style={fieldLabel}>🔎 แหล่งอ้างอิง ({c.sources.length}){c.researchUsed ? ' · ใช้ข้อมูลรีเสิร์ชเสริม' : ''}</div>
                    {c.sources.map((s, i) => (
                      <div key={i} style={{ fontSize: 12, marginTop: 3 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{s.type}: </span>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--desk-blue)', textDecoration: 'underline', wordBreak: 'break-all' }}>{s.title || s.url}</a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ───────── STEP ② แก่นข่าวที่ระบบสรุป (ตัดดราม่าออก) ───────── */}
              {c.cleanBrief && <>
                <div style={stepHeader('#4ade80')}>② แก่นข่าวที่ระบบสรุป <span style={stepNote}>— ใจความสะอาด ตัดโทนดราม่า/ฟาดออก (ระบบทำให้)</span></div>
                <div style={{ ...sectionBox, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>{c.cleanBrief}</div>
              </>}

              {/* ───────── STEP ③ มุมที่แตกได้ → เนื้อหาดิบป้อนระบบเจน ───────── */}
              <div style={stepHeader('#a855f7')}>③ มุมที่แตกได้ ({(c.angles || []).length} มุม) <span style={stepNote}>— เนื้อหาดิบแต่ละมุม คัดลอกไปป้อนระบบเจน</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(c.angles || []).map((a, i) => {
                  const raw = a.rawContent || a.caption || ''; // รองรับเคสเก่า
                  return (
                  <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    {/* แถบหัวมุม: บอกชัดว่า "มุมที่ N" + ชื่อมุม */}
                    <div style={{ background: 'rgba(168,85,247,0.14)', padding: '7px 11px', fontWeight: 800, fontSize: 13.5, color: 'var(--text-primary)' }}>
                      🎯 มุมที่ {i + 1} · {a.type}
                    </div>
                    <div style={{ padding: '9px 11px' }}>
                      {a.focus && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 7 }}><b style={{ color: 'var(--text-muted)' }}>โฟกัส:</b> {a.focus}</div>}
                      {raw && (
                        <div onClick={() => copy(raw)} title="คลิกเพื่อคัดลอกเนื้อหาดิบ (เอาไปป้อนระบบเจน)"
                          style={{ fontSize: 13, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', cursor: 'pointer', whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--text-primary)' }}>
                          <div style={{ ...fieldLabel, color: 'var(--desk-purple)', marginBottom: 4 }}>📝 เนื้อหาดิบของมุมนี้ ↓ (คลิกคัดลอก)</div>
                          {raw}
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* ผู้ตรวจคุณภาพ (ท้ายเคส) */}
              {c.evalNote && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 12, paddingTop: 9, borderTop: '1px solid var(--border)', lineHeight: 1.55 }}>🤖 <b style={{ color: scoreColor(c.evalScore) }}>ผู้ตรวจคุณภาพ:</b> {c.evalNote}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
