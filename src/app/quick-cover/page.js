'use client';

// ============================================================
// 📱 /quick-cover — หน้าเทสปกเร็ว "แบบสไลด์" ใช้ง่ายบนมือถือ (9 ก.ค. 2026)
// ------------------------------------------------------------
// รวม 2 ระบบเทสปกไว้ที่เดียว + รันเบื้องหลัง (กดแล้วปิดจอได้ กลับมาดูผลทีหลัง)
//   สไลด์ 1 เลือกโหมด (⚡ ทางลัด / 🎯 เต็มท่อ) → สไลด์ 2 กรอก → สไลด์ 3 งาน (โพลเอง)
// ยิง /api/quick-test (สร้าง job → รันเบื้องหลัง) · ผลปกโหลดจากคลังคลาวด์เดิม
// public route (ดู AuthGuard.js + ClientLayout.js)
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';

const C = {
  bg: '#0f1226', card: '#191d38', card2: '#20244a', line: '#2c3160',
  text: '#eef1ff', dim: '#9aa0c8', accent: '#6d5cf5', accent2: '#f6339a',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
};

export default function QuickCoverPage() {
  const [slide, setSlide] = useState(0); // 0 เลือก · 1 กรอก · 2 งาน
  const [mode, setMode] = useState(null); // 'compose' | 'ref'

  // compose inputs
  const [cases, setCases] = useState([]);
  const [refs, setRefs] = useState([]);
  const [caseId, setCaseId] = useState('');
  const [refId, setRefId] = useState('');
  const [heroHint, setHeroHint] = useState('');
  // ref inputs
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [jobs, setJobs] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [now, setNow] = useState(0); // ★ ตัวจับเวลาสด (mount แล้วค่อยตั้ง เลี่ยง hydration mismatch)

  const touchX = useRef(null);

  // โหลดรายการเคส/ref สำหรับโหมดทางลัด
  useEffect(() => {
    fetch('/api/mega/compose-test?list=1').then((r) => r.json()).then((d) => {
      if (d.success) { setCases(d.cases || []); setRefs(d.refs || []); if (d.cases?.[0]) setCaseId(d.cases[0].id); }
    }).catch(() => {});
  }, []);

  // โพลรายการงาน — ทุก 4 วิถ้ามีงานค้างหรืออยู่สไลด์งาน, ไม่งั้น 12 วิ
  const loadJobs = useCallback(() => {
    fetch('/api/quick-test?limit=40').then((r) => r.json()).then((d) => {
      if (d.success) setJobs(d.jobs || []);
    }).catch(() => {});
  }, []);
  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'pending' || j.status === 'running');
    const ms = (hasActive || slide === 2) ? 4000 : 12000;
    const id = setInterval(loadJobs, ms);
    return () => clearInterval(id);
  }, [jobs, slide, loadJobs]);
  // นาฬิกาสดสำหรับงานที่กำลังรัน
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const goForm = (m) => { setMode(m); setErr(''); setSlide(1); };

  async function submit() {
    setErr('');
    if (mode === 'compose' && !caseId) { setErr('เลือกเคสก่อน'); return; }
    // ★ 15 ก.ค. 69: gate สองชั้นเหมือนฝั่ง server — content ≥100 ตัว และ (title+content ตาม filter(Boolean)) รวม ≥200 ตัว
    if (mode === 'ref') {
      const c = content.trim();
      if (c.length < 100) { setErr(`วางเนื้อข่าวเต็มก่อน (≥100 ตัวอักษร — ตอนนี้มี ${c.length} ตัวอักษร)`); return; }
      const combinedLen = [title.trim(), c].filter(Boolean).join('\n\n').length;
      if (combinedLen < 200) { setErr(`เนื้อหารวม (หัวข่าว+เนื้อข่าว) ต้อง ≥200 ตัวอักษร — ตอนนี้มี ${combinedLen} ตัวอักษร`); return; }
    }
    const payload = mode === 'compose'
      ? { kind: 'compose', caseId, refId: refId || undefined, heroPersonHint: heroHint || undefined }
      : { kind: 'ref', newsTitle: title, content };
    setSubmitting(true);
    setSlide(2); // ไปหน้างานทันที — งานโผล่จากการโพล (คลาวรัน compose sync ~80 วิ ก็ไม่บล็อกจอ)
    setTimeout(loadJobs, 500); setTimeout(loadJobs, 2500);
    try {
      const r = await fetch('/api/quick-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!d.success) { setErr(d.error || 'ส่งงานไม่สำเร็จ'); setSlide(1); }
      else { setOpenId(d.jobId); loadJobs(); }
    } catch (e) { setErr('เรียก API ล้ม: ' + e.message); setSlide(1); }
    finally { setSubmitting(false); }
  }

  // ลบงาน 1 อัน (กำลังรันก็ลบได้ — runJob เจองานหาย แล้วหยุดเอง)
  async function delJob(id) {
    setJobs((prev) => prev.filter((j) => j.id !== id)); // เอาออกจากจอทันที
    if (openId === id) setOpenId(null);
    await fetch('/api/quick-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', jobId: id }) }).catch(() => {});
    setTimeout(loadJobs, 500);
  }
  // ล้างคิวค้างทั้งหมด (รอคิว + กำลังรัน)
  async function clearActive() {
    const active = jobs.filter((j) => j.status === 'pending' || j.status === 'running');
    if (!active.length) return;
    if (typeof window !== 'undefined' && !window.confirm(`ลบงานที่ค้าง (รอคิว + กำลังรัน) ${active.length} งาน?`)) return;
    setJobs((prev) => prev.filter((j) => j.status !== 'pending' && j.status !== 'running'));
    await fetch('/api/quick-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', scope: 'active' }) }).catch(() => {});
    setTimeout(loadJobs, 500);
  }

  // ปัดซ้าย-ขวาเปลี่ยนสไลด์
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 60) setSlide((s) => Math.max(0, Math.min(2, s + (dx < 0 ? 1 : -1))));
    touchX.current = null;
  };

  const steps = ['เลือก', 'กรอก', 'งาน'];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '14px 14px 96px', boxSizing: 'border-box' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>📱 เทสปกเร็ว</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <a href="/mega-covers" style={{ fontSize: 12, color: C.dim, textDecoration: 'none', border: `1px solid ${C.line}`, borderRadius: 999, padding: '5px 12px' }}>🗂️ คลังปก</a>
            <a href="/cover-techniques" style={{ fontSize: 12, color: C.dim, textDecoration: 'none', border: `1px solid ${C.line}`, borderRadius: 999, padding: '5px 12px' }}>📚 เทคนิค</a>
          </div>
        </div>

        {/* stepper */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {steps.map((s, i) => (
            <button key={s} onClick={() => (i !== 1 || mode) && setSlide(i)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 800,
                background: slide === i ? C.accent : C.card, color: slide === i ? '#fff' : C.dim }}>
              {i + 1}. {s}
            </button>
          ))}
        </div>

        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {/* ── สไลด์ 0: เลือกโหมด ── */}
          {slide === 0 && (
            <div style={{ animation: 'qcIn .22s ease' }}>
              <ModeCard active={mode === 'compose'} onClick={() => goForm('compose')}
                emoji="⚡" title="ทางลัด (เร็ว)" time="~20-80 วิ" accent={C.accent}
                lines={['ใช้คลังเคสที่ตาคัดแล้ว', 'ประกอบปกตรงๆ ไม่ค้นภาพใหม่', 'ไว้จูนครอป/โครง/ตาเทียบ ref']} />
              <div style={{ height: 12 }} />
              <ModeCard active={mode === 'ref'} onClick={() => goForm('ref')}
                emoji="🎯" title="เต็มท่อ MEGA" time="~3-6 นาที" accent={C.accent2}
                lines={['วางเนื้อข่าวเต็ม → รันทั้งท่อ', 'analyze → ค้น 4 แหล่ง → ตาคัด → ปก', 'สร้างเคส AC ใหม่จริง']} />
              <p style={{ fontSize: 12, color: C.dim, marginTop: 16, textAlign: 'center' }}>ทั้งสองโหมด <b style={{ color: C.text }}>รันเบื้องหลัง</b> — กดแล้วปิดจอได้ กลับมาดูผลที่สไลด์ “งาน”</p>
            </div>
          )}

          {/* ── สไลด์ 1: ฟอร์ม ── */}
          {slide === 1 && mode === 'compose' && (
            <div style={{ animation: 'qcIn .22s ease' }}>
              <SectionTitle emoji="⚡" text="ทางลัดประกอบปก" />
              <Field label="เคส (มีภาพตาคัดแล้ว)">
                <select value={caseId} onChange={(e) => setCaseId(e.target.value)} style={selStyle}>
                  {cases.map((c) => <option key={c.id} value={c.id}>{c.id} · {(c.headline || '').slice(0, 34)} · หน้าเดี่ยว {c.cleanFace}</option>)}
                </select>
              </Field>
              <Field label="ปก ref">
                <select value={refId} onChange={(e) => setRefId(e.target.value)} style={selStyle}>
                  <option value="">— auto-match ตามอารมณ์ข่าว —</option>
                  {refs.map((r) => <option key={r.id} value={r.id}>{(r.styleName || r.id).slice(0, 26)} · {r.panelCount} ช่อง</option>)}
                </select>
              </Field>
              <Field label="ชื่อ hero (ช่วยล็อกตัวเอก — ว่างได้)">
                <input value={heroHint} onChange={(e) => setHeroHint(e.target.value)} placeholder="เช่น นุ่น วรนุช" style={inpStyle} />
              </Field>
            </div>
          )}
          {slide === 1 && mode === 'ref' && (
            <div style={{ animation: 'qcIn .22s ease' }}>
              <SectionTitle emoji="🎯" text="เต็มท่อ MEGA" />
              <Field label="หัวข่าว (ไม่บังคับ)">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น นุ่น วรนุช ทำบุญ" style={inpStyle} />
              </Field>
              <Field label={`เนื้อข่าวเต็ม * (${content.trim().length} ตัวอักษร)`}>
                <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="วางเนื้อข่าวเต็ม (ห้ามเนื้อสั้นตัดทอน)"
                  style={{ ...inpStyle, minHeight: 200, resize: 'vertical' }} />
              </Field>
            </div>
          )}

          {/* ── สไลด์ 2: งาน ── */}
          {slide === 2 && (
            <div style={{ animation: 'qcIn .22s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>งานเทสปก</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {jobs.some((j) => j.status === 'pending' || j.status === 'running') && (
                    <button onClick={clearActive} style={{ fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 999, padding: '5px 12px', cursor: 'pointer', fontWeight: 700 }}>🗑️ ล้างคิวค้าง</button>
                  )}
                  <button onClick={loadJobs} style={{ fontSize: 12, color: C.dim, background: C.card, border: `1px solid ${C.line}`, borderRadius: 999, padding: '5px 12px', cursor: 'pointer' }}>↻ รีเฟรช</button>
                </div>
              </div>
              {jobs.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 13 }}>ยังไม่มีงาน — กดสร้างจากสไลด์แรก</div>}
              {jobs.map((j) => <JobCard key={j.id} job={j} open={openId === j.id} onToggle={() => setOpenId(openId === j.id ? null : j.id)} onDelete={delJob} now={now} />)}
            </div>
          )}
        </div>
      </div>

      {/* ── ปุ่มลอยล่าง (สไลด์กรอกเท่านั้น) ── */}
      {slide === 1 && mode && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'linear-gradient(to top, ' + C.bg + ' 70%, transparent)', padding: '12px 14px 18px' }}>
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            {err && <div style={{ marginBottom: 8, padding: 10, background: 'rgba(239,68,68,.15)', color: '#fca5a5', borderRadius: 10, fontSize: 13 }}>{err}</div>}
            <button onClick={submit} disabled={submitting}
              style={{ width: '100%', padding: 16, borderRadius: 14, border: 'none', cursor: submitting ? 'default' : 'pointer',
                background: submitting ? C.card2 : `linear-gradient(135deg, ${C.accent}, ${C.accent2})`, color: '#fff', fontSize: 16, fontWeight: 900 }}>
              {submitting ? '⏳ กำลังส่ง...' : '▶ รันเบื้องหลัง'}
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes qcIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
        select option{color:#111}`}</style>
    </div>
  );
}

// ── ชิ้นส่วนย่อย ──
function ModeCard({ active, onClick, emoji, title, time, lines, accent }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
      background: C.card, border: `2px solid ${active ? accent : C.line}`, borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 26 }}>{emoji}</span>
        <span style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#fff', background: accent, borderRadius: 999, padding: '3px 10px' }}>{time}</span>
      </div>
      {lines.map((l, i) => <div key={i} style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.7 }}>• {l}</div>)}
    </button>
  );
}
function SectionTitle({ emoji, text }) {
  return <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 10 }}>{emoji} {text}</div>;
}
function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.dim, marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}
const inpStyle = { width: '100%', padding: '13px 14px', borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: C.text, fontSize: 16, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' };
const selStyle = { ...inpStyle, appearance: 'none' };

function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function JobCard({ job, open, onToggle, onDelete, now }) {
  const st = job.status;
  const color = st === 'done' ? C.green : st === 'failed' ? C.red : C.amber;
  const badge = st === 'done' ? '✅ เสร็จ' : st === 'failed' ? '❌ ล้ม' : st === 'running' ? '⏳ กำลังรัน' : '🕐 เข้าคิว';
  const r = job.result || {};
  const running = st === 'pending' || st === 'running';
  const startMs = job.startedAt ? Date.parse(job.startedAt) : (job.createdAt ? Date.parse(job.createdAt) : 0);
  const liveDur = running && startMs && now ? fmtDur(now - startMs) : (r.elapsed || '');

  return (
    <div style={{ background: C.card, border: `1px solid ${st === 'done' ? 'rgba(34,197,94,.4)' : st === 'failed' ? 'rgba(239,68,68,.4)' : C.line}`, borderRadius: 14, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button onClick={onToggle} style={{ display: 'flex', flex: 1, minWidth: 0, gap: 10, alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: C.text, textAlign: 'left', padding: 0 }}>
        {r.coverImgUrl && st === 'done'
          ? <img src={r.coverImgUrl} alt="ปก" style={{ width: 54, height: 68, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: `1px solid ${C.line}` }} />
          : <div style={{ width: 54, height: 68, borderRadius: 8, flexShrink: 0, background: C.card2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{st === 'failed' ? '⚠️' : '🎬'}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.label || job.kind}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color }}>{badge}</span>
            {job.dispatch === 'team' && <span style={{ fontSize: 10.5, color: C.dim, background: C.card2, borderRadius: 6, padding: '1px 6px' }}>🖥️ เครื่องทีม</span>}
            {job.dispatch === 'cloud' && <span style={{ fontSize: 10.5, color: C.dim, background: C.card2, borderRadius: 6, padding: '1px 6px' }}>☁️ คลาว</span>}
            {liveDur && <span style={{ fontSize: 11.5, color: C.dim }}>· {liveDur}</span>}
            {st === 'done' && (r.refSimilarity != null) && <span style={{ fontSize: 11.5, color: C.dim }}>· เหมือน ref {r.refSimilarity}%</span>}
            {st === 'done' && r.score && r.score !== '-' && (r.refSimilarity == null) && <span style={{ fontSize: 11.5, color: C.dim }}>· {r.score}</span>}
          </div>
        </div>
        <span style={{ color: C.dim, fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>
        <button onClick={() => onDelete && onDelete(job.id)} title="ลบงานนี้"
          style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, border: `1px solid ${C.line}`, background: C.card2, color: '#f87171', fontSize: 15, cursor: 'pointer', lineHeight: 1 }}>🗑️</button>
      </div>

      {open && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          {st === 'failed' && <div style={{ padding: 10, background: 'rgba(239,68,68,.12)', color: '#fca5a5', borderRadius: 10, fontSize: 12.5, marginBottom: 10 }}>{job.error || 'ล้มเหลว'}</div>}
          {running && <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 10 }}>⏳ {job.progress?.step || 'กำลังรัน'} — กดปิดจอได้ เดี๋ยวผลมาเอง</div>}

          {(r.coverImgUrl || r.refImgUrl) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>ปกที่ได้</div>
                {r.coverImgUrl ? <img src={r.coverImgUrl} alt="ปก" style={{ width: '100%', borderRadius: 10, border: `2px solid ${C.accent}` }} /> : <div style={{ fontSize: 12, color: C.dim }}>—</div>}
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>ref เป้า</div>
                {r.refImgUrl ? <img src={r.refImgUrl} alt="ref" style={{ width: '100%', borderRadius: 10, border: `1px solid ${C.line}` }} /> : <div style={{ fontSize: 12, color: C.dim }}>—</div>}
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, color: C.dim, marginTop: 10, lineHeight: 1.8 }}>
            {r.template && <div>โครง: <b style={{ color: C.text }}>{r.template}</b>{r.eyeFixed ? ` · ตาแก้ ${r.eyeFixed} จุด` : ''}</div>}
            {r.poolSize != null && <div>พูล: {r.poolSize} ใบ{r.imageCaseId ? ` · ${r.imageCaseId}` : ''}{r.caseId ? ` · ${r.caseId}` : ''}</div>}
            {Array.isArray(r.refDiffs) && r.refDiffs.length > 0 && <div style={{ color: '#fbbf24' }}>จุดต่าง: {r.refDiffs.join(' · ')}</div>}
            {Array.isArray(r.trace) && r.trace.length > 0 && <div style={{ color: '#a3a3a3' }}>{r.trace.map((t) => `${t.stage}${t.status === 'failed' ? '❌' : '✓'}`).join(' → ')}</div>}
            {r.archivedId && <a href="/mega-covers" style={{ color: C.green, fontWeight: 700, textDecoration: 'none' }}>🗂️ เข้าคลังแล้ว ({r.archivedId})</a>}
          </div>
          {r.coverImgUrl && st === 'done' && (
            <a href={`${r.coverImgUrl}${r.coverImgUrl.includes('?') ? '&' : '?'}dl=1`} style={{ display: 'inline-block', marginTop: 10, padding: '9px 16px', borderRadius: 10, background: C.accent, color: '#fff', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>⬇️ โหลดภาพ</a>
          )}
        </div>
      )}
    </div>
  );
}
