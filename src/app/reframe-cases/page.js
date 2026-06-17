'use client';
/**
 * ♻️ คลังแตกประเด็นข่าว (เนื้อหาดิบ) — ดูผลทุกครั้งที่ระบบแตกข่าวท็อกซิก/ดราม่า → เนื้อหาดิบหลายมุมเชิงบวก
 *   แสดงข่าวต้นทาง + แหล่งอ้างอิง/ลิงก์ ให้ตรวจสอบที่มาที่ไปของข้อมูลได้ · เก็บทั้งแบบทดสอบและทำจริง
 *   ผู้จัดการสร้างไว้ให้กลับมาเช็กย้อนหลังได้ — 17 มิ.ย. 69
 */
import { useState, useEffect } from 'react';

const scoreColor = (s) => s == null ? 'var(--text-muted)' : s >= 8 ? 'var(--desk-green)' : s >= 6 ? 'var(--desk-amber)' : s >= 4 ? '#f97316' : 'var(--desk-red)';
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'แหล่งอ้างอิง'; } };
// แยกเนื้อหลอมรวมเป็นท่อนๆ: ท่อนที่ครอบด้วย ⟦n⟧...⟦/⟧ = มาจากรีเสิร์ช (ref=n)
const parseMerged = (s) => {
  const out = []; const re = /⟦(\d+)⟧([\s\S]*?)⟦\/⟧/g; let last = 0, m;
  while ((m = re.exec(s))) { if (m.index > last) out.push({ t: s.slice(last, m.index) }); out.push({ t: m[2], ref: Number(m[1]) }); last = m.index + m[0].length; }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out;
};
const stripMarkers = (s) => String(s || '').replace(/⟦\d+⟧/g, '').replace(/⟦\/⟧/g, '');

export default function ReframeCasesPage() {
  const [cases, setCases] = useState([]);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [manualRunning, setManualRunning] = useState(false);
  const [manualInfo, setManualInfo] = useState(null);
  const [enrichId, setEnrichId] = useState(null); // เคสที่กำลังหาข้อมูลเสริม

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

  const runManual = async () => {
    if (manualInput.trim().length < 10) { setManualInfo({ err: 'กรอกข้อความข่าว หรือวางลิงก์ก่อน' }); return; }
    setManualRunning(true); setManualInfo(null);
    try {
      const r = await fetch('/api/news-desk/reframe-manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: manualInput.trim() }),
      });
      const d = await r.json();
      if (d.success) {
        const cl = d.classify || {};
        setManualInfo({ ok: true, title: d.extracted?.title, isUrl: d.extracted?.isUrl, chars: d.extracted?.chars, category: cl.category, dramaType: cl.dramaType, angles: d.reframe?.angles?.length });
        setManualInput('');
        await load('all'); setFilter('all');
      } else {
        setManualInfo({ err: d.error || 'แตกประเด็นไม่สำเร็จ' });
      }
    } catch (e) { setManualInfo({ err: e.message }); }
    setManualRunning(false);
  };

  const runEnrich = async (id) => {
    setEnrichId(id); setMsg('🔎 กำลังค้นข้อมูลเสริม (เฉพาะคนดัง) ~20-40 วิ...');
    try {
      const r = await fetch('/api/news-desk/reframe-cases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enrich', id }),
      });
      const d = await r.json();
      if (d.success) { setMsg(`✅ ได้ข้อมูลเสริม ${d.enrichment?.facts?.length || 0} ข้อ + เทียบเคียง ${d.enrichment?.comparables?.length || 0} ข้อ`); await load(filter); }
      else setMsg('ℹ️ ' + (d.error || 'หาข้อมูลเสริมไม่ได้'));
    } catch (e) { setMsg('❌ ' + e.message); }
    setEnrichId(null);
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
        แตกข่าวกระแส/ดราม่า/ท็อกซิก → "เนื้อหาดิบเชิงลึก" 1 มุมที่ดีที่สุด (มากสุด 2 ทางเลือก) เล่าแกนเดียวให้ลึก ไม่กระชากอารมณ์หลายมุม · ใช้ข้อเท็จจริงไม่บิดเบือน · เอาไปป้อนระบบทำข่าวอัตโนมัติเจนต่อ · มีข่าวต้นทาง+แหล่งอ้างอิงให้ตรวจที่มา
      </p>

      {/* ── ช่องแตกประเด็นแบบแมนนวล: วาง Text/URL → สกัด → ตัดขยะ → จัดหมวด → แตกประเด็น ── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--desk-purple)', borderRadius: 14, padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 3 }}>✍️ แตกประเด็นเอง (วางข่าว/ลิงก์)</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 9, lineHeight: 1.55 }}>
          วาง <b>ข้อความข่าวเต็ม</b> หรือ <b>ลิงก์ข่าวต้นทาง</b> → ระบบจะสกัดเนื้อ (จากลิงก์), ตัดขยะ/ด่านคำต้องห้าม, จัดหมวด+วัดดราม่า แล้วแตกประเด็นเป็นเนื้อหาดิบให้ (เก็บเข้าคลังหมวด "ทำจริง")
        </div>
        <textarea value={manualInput} onChange={(e) => setManualInput(e.target.value)} disabled={manualRunning}
          placeholder="วางข้อความข่าว เช่น 'พี่หนุ่ม กรรชัย ถามกลางรายการ...' หรือวางลิงก์ https://..."
          style={{ width: '100%', minHeight: 90, resize: 'vertical', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '10px 12px', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 9, flexWrap: 'wrap' }}>
          <button onClick={runManual} disabled={manualRunning}
            style={{ background: manualRunning ? 'var(--bg-elevated)' : 'linear-gradient(135deg,#a855f7,#7c3aed)', color: manualRunning ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontWeight: 800, cursor: manualRunning ? 'default' : 'pointer', fontSize: 14 }}>
            {manualRunning ? '⏳ กำลังสกัด+แตกประเด็น... (~20-40 วิ)' : '🔍 สกัด + แตกประเด็น'}
          </button>
          {manualInfo?.ok && (
            <span style={{ fontSize: 12.5, color: 'var(--desk-green)' }}>
              ✅ เสร็จ — {manualInfo.isUrl ? 'สกัดจากลิงก์' : 'จากข้อความ'} {manualInfo.chars ? `(${manualInfo.chars} ตัว)` : ''} · หมวด {manualInfo.category || '—'}{manualInfo.dramaType ? ` · ดราม่า ${manualInfo.dramaType}` : ''} · ได้ {manualInfo.angles} มุม (ดูด้านล่าง ↓)
            </span>
          )}
          {manualInfo?.err && <span style={{ fontSize: 12.5, color: 'var(--desk-red)' }}>❌ {manualInfo.err}</span>}
        </div>
      </div>

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

              {/* ป้ายเกณฑ์ที่ใช้คัด/หยิบข่าวนี้ (จากสมองโต๊ะข่าว) */}
              {c.classify && (c.classify.category || c.classify.dramaType) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  {c.classify.category && <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 5, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>หมวด: {c.classify.category}</span>}
                  {c.classify.dramaType && c.classify.dramaType !== 'none' && <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 5, background: 'var(--bg-elevated)', color: 'var(--desk-amber)' }}>ดราม่า: {c.classify.dramaType}</span>}
                  {c.classify.tone && <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 5, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>โทน: {c.classify.tone}</span>}
                  {c.classify.subject && <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 5, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{c.classify.subject === 'celeb' ? 'ดารา/คนดัง' : c.classify.subject === 'public' ? 'บุคคลสาธารณะ' : 'คนทั่วไป'}</span>}
                </div>
              )}

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

              {/* ───────── STEP ③ มุมที่ดีที่สุด → เนื้อหาดิบเชิงลึก (เลือก 1 ไปป้อนระบบเจน) ───────── */}
              <div style={stepHeader('#a855f7')}>③ มุมที่ดีที่สุด{(c.angles || []).length > 1 ? ` (${(c.angles || []).length} ทางเลือก — เลือก 1)` : ''} <span style={stepNote}>— เล่าแกนเดียวให้ลึก คัดลอกไปป้อนระบบเจน</span></div>
              {/* ป้ายบอกที่มาเนื้อหา — กันเข้าใจผิดว่ารีเสิร์ช/นั่งเทียน */}
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 7px', lineHeight: 1.5 }}>
                📌 ที่มาเนื้อหาดิบ: <b style={{ color: 'var(--desk-green)' }}>สรุปจากข่าวต้นทางที่ให้มาเท่านั้น (ข้อ ①) — ไม่ได้แต่งขึ้นเอง ไม่ได้รีเสิร์ชเว็บเพิ่ม</b>{c.enrichment?.ok ? ' · มีข้อมูลเสริมจากรีเสิร์ช (ดูแหล่งอ้างอิงพร้อมลิงก์ด้านล่าง ↓)' : ' · กด 🔎 ด้านล่างถ้าต้องการข้อมูลเสริมจากเว็บพร้อมแหล่งอ้างอิง'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(c.angles || []).map((a, i) => {
                  const raw = a.rawContent || a.caption || ''; // รองรับเคสเก่า
                  const many = (c.angles || []).length > 1;
                  return (
                  <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    {/* แถบหัวมุม: บอกชัดว่าเป็นมุม/ทางเลือกไหน + ชื่อแกน */}
                    <div style={{ background: 'rgba(168,85,247,0.14)', padding: '7px 11px', fontWeight: 800, fontSize: 13.5, color: 'var(--text-primary)' }}>
                      🎯 {many ? `ทางเลือกที่ ${i + 1}` : 'มุมที่เลือก'} · {a.type}
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

              {/* ── 🔎 ข้อมูลเสริม (เฉพาะคนดัง) — กดเอง ── */}
              {c.enrichment?.ok && (() => { const srcFacts = (c.enrichment.facts || []).filter(f => f.sourceUrl); return (
                <div style={{ marginTop: 10, background: 'rgba(125,211,252,0.08)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ ...fieldLabel, color: 'var(--desk-blue)', marginBottom: 5 }}>🔎 ข้อมูลเสริม{c.enrichment.person ? ` · ${c.enrichment.person}` : ''} (เอาไปประกอบการเขียน)</div>

                  {/* ★ ฉบับหลอมรวม: เนื้อหาดิบ + ข้อมูลเสริมแทรกเข้าจุดที่เนียน (ไฮไลต์ = มาจากรีเสิร์ช) */}
                  {c.enrichment.merged?.content && (
                    <div style={{ marginBottom: 9 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--desk-green)', marginBottom: 3 }}>📰 ฉบับหลอมรวม — เนื้อหาดิบ + ข้อมูลเสริม (พร้อมป้อนระบบเจน · คลิกคัดลอก · ส่วนไฮไลต์ = มาจากรีเสิร์ช)</div>
                      <div onClick={() => copy(stripMarkers(c.enrichment.merged.content))} title="คลิกคัดลอก (เอาเครื่องหมายออกให้อัตโนมัติ)"
                        style={{ fontSize: 13, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', cursor: 'pointer', whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--text-primary)' }}>
                        {parseMerged(c.enrichment.merged.content).map((p, pi) => p.ref ? (
                          <span key={pi} style={{ background: 'rgba(125,211,252,0.28)', borderRadius: 3, padding: '0 1px' }}>{p.t}<a href={srcFacts[p.ref - 1]?.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} style={{ color: 'var(--desk-blue)', fontSize: 9, verticalAlign: 'super', textDecoration: 'none' }}>[{p.ref}]</a></span>
                        ) : <span key={pi}>{p.t}</span>)}
                      </div>
                    </div>
                  )}

                  {srcFacts.length > 0 && (
                    <div style={{ marginBottom: (c.enrichment.comparables || []).length ? 8 : 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 3 }}>📋 แหล่งอ้างอิงข้อมูลเสริม (เลข [n] ตรงกับท่อนไฮไลต์ในฉบับหลอมรวม):</div>
                      {srcFacts.map((f, fi) => (
                        <div key={fi} style={{ fontSize: 12.5, color: 'var(--text-primary)', marginTop: 3, lineHeight: 1.5 }}>
                          <b style={{ color: 'var(--desk-blue)' }}>[{fi + 1}]</b> {f.text}
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> — 📍 รีเสิร์ชจาก <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--desk-blue)', textDecoration: 'underline' }}>{domainOf(f.sourceUrl)}</a></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(c.enrichment.comparables || []).length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--desk-amber)', marginBottom: 3 }}>≈ ข้อมูลเทียบเคียง (ภาพรวมที่จริง รู้กันกว้าง — ไม่ใช่ตัวเลขตายตัว ไม่ผูกแหล่งเดียว):</div>
                      {c.enrichment.comparables.map((cm, ci) => (
                        <div key={ci} style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>• {cm}</div>
                      ))}
                    </div>
                  )}
                </div>
              ); })()}

              {/* ปุ่มหาข้อมูลเสริม — โชว์เมื่อยังไม่มี (backend จะข้ามถ้าไม่ใช่คนดัง) */}
              {!c.enrichment?.ok && (
                <button onClick={() => runEnrich(c.id)} disabled={enrichId === c.id}
                  style={{ marginTop: 10, background: 'transparent', color: 'var(--desk-blue)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', fontWeight: 700, cursor: enrichId === c.id ? 'default' : 'pointer', fontSize: 12.5 }}>
                  {enrichId === c.id ? '⏳ กำลังค้น...' : '🔎 หาข้อมูลเสริม (เฉพาะคนดัง)'}
                </button>
              )}

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
