'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

// ระดับความชัด (ตรงกับ ENHANCE_TIERS ฝั่งเซิร์ฟเวอร์)
const TIERS = [
  { key: 'standard', label: '🟢 ชัดมาตรฐาน', detail: 'ขยาย 2 เท่า — เร็ว ประหยัด', price: '~0.05 บาท/ภาพ' },
  { key: 'high', label: '🔵 ชัดสูงสุด', detail: 'ขยาย 4 เท่า — คมสุด ละเอียดสุด', price: '~0.12 บาท/ภาพ' },
];
const MAX_FILES = 10;
const MAX_CONCURRENT = 3; // ★ คิว: ทำพร้อมกันสูงสุด 3 ภาพ (กันยิง Replicate ทีเดียวเยอะ + คุมต้นทุน/เรตลิมิต)

let _uid = 0;

export default function PhotoEnhancePage() {
  const [tier, setTier] = useState('high');
  const [jobs, setJobs] = useState([]); // {uid, name, preview, dataUri, predId, status, output, error}
  const fileRef = useRef(null);
  const jobsRef = useRef([]); // ★ กระจกของ jobs ล่าสุด (ให้ปั๊มคิว/poll อ่านสถานะปัจจุบันไม่ค้าง closure)
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  // ★ ชื่อผู้ใช้ (บังคับ ไม่มีรหัสผ่าน) — key เดียวกับโต๊ะข่าว/news-filter
  const [me, setMe] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);
  const [nameInput, setNameInput] = useState('');
  useEffect(() => { setMe(localStorage.getItem('desk_username') || ''); setNameLoaded(true); }, []);
  const submitName = () => {
    const n = (nameInput || '').trim();
    if (n.length < 2) { alert('กรุณาใส่ชื่ออย่างน้อย 2 ตัวอักษร'); return; }
    localStorage.setItem('desk_username', n); setMe(n);
  };
  const changeName = () => {
    const n = (prompt('เปลี่ยนชื่อผู้ใช้:', me) || '').trim();
    if (n) { localStorage.setItem('desk_username', n); setMe(n); }
  };

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(f => /^image\//.test(f.type));
    if (!files.length) return;
    // นับโควต้าจาก "งานที่ยังไม่จบ" — งานที่เสร็จ/ล้มเหลว ลบทิ้งได้ ไม่กินที่
    const room = MAX_FILES - jobs.filter(j => j.status !== 'succeeded' && j.status !== 'failed').length;
    if (room <= 0) { alert(`ทำพร้อมกันได้สูงสุด ${MAX_FILES} ภาพ — ลบงานที่เสร็จแล้วออกก่อน หรือกด "ล้างที่เสร็จ"`); return; }
    files.slice(0, room).forEach(f => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUri = e.target.result;
        setJobs(prev => [...prev, { uid: ++_uid, name: f.name, preview: dataUri, dataUri, predId: null, status: 'pending', output: null, error: null }]);
      };
      reader.readAsDataURL(f);
    });
  };

  const removeJob = (uid) => setJobs(prev => prev.filter(j => j.uid !== uid));
  const clearAll = () => setJobs([]);
  const clearDone = () => setJobs(prev => prev.filter(j => j.status !== 'succeeded' && j.status !== 'failed'));

  // ★ สร้างงาน 1 ภาพ (มี timeout 30 วิ กัน fetch ค้างจนปุ่ม/คิวค้าง)
  const startJob = useCallback(async (uid, dataUri) => {
    setJobs(prev => prev.map(x => x.uid === uid ? { ...x, status: 'starting', error: null } : x));
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch('/api/photo-enhance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUri, tier }), signal: ctrl.signal,
      });
      clearTimeout(timer);
      const d = await res.json();
      if (d.success) setJobs(prev => prev.map(x => x.uid === uid ? { ...x, predId: d.id, status: 'processing' } : x));
      else setJobs(prev => prev.map(x => x.uid === uid ? { ...x, status: 'failed', error: d.error || 'เริ่มงานไม่สำเร็จ' } : x));
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'หมดเวลาเริ่มงาน — กด "ลองใหม่"' : (e?.message || 'เริ่มงานไม่สำเร็จ');
      setJobs(prev => prev.map(x => x.uid === uid ? { ...x, status: 'failed', error: msg } : x));
    }
  }, [tier]);

  // ★ ปั๊มคิว: เริ่มงาน "queued" ทีละไม่เกิน MAX_CONCURRENT (ที่เหลือรอคิว)
  const pump = useCallback(() => {
    const list = jobsRef.current;
    const active = list.filter(j => j.status === 'starting' || j.status === 'processing').length;
    let slots = MAX_CONCURRENT - active;
    if (slots <= 0) return;
    for (const j of list) {
      if (slots <= 0) break;
      if (j.status === 'queued') { slots--; startJob(j.uid, j.dataUri); }
    }
  }, [startJob]);

  // กด "เพิ่มความชัด" = ส่งทุกภาพ pending เข้าคิว (ปั๊มคิวทำงานเองผ่าน effect)
  const enhanceAll = () => {
    setJobs(prev => prev.map(j => j.status === 'pending' ? { ...j, status: 'queued' } : j));
  };
  const retryJob = (uid) => setJobs(prev => prev.map(j => j.uid === uid ? { ...j, status: 'queued', error: null, predId: null } : j));

  // มีงานในคิว + ช่องว่าง → ปั๊ม
  useEffect(() => {
    if (!jobs.some(j => j.status === 'queued')) return;
    const active = jobs.filter(j => j.status === 'starting' || j.status === 'processing').length;
    if (active < MAX_CONCURRENT) pump();
  }, [jobs, pump]);

  // poll งานที่กำลังประมวลผลทุก 2.5 วิ (มี timeout กันค้างสะสม) — จบแล้วปั๊มคิวต่อ
  const pollOnce = useCallback(async () => {
    const active = jobsRef.current.filter(j => j.predId && j.status === 'processing');
    if (!active.length) return;
    await Promise.all(active.map(async (j) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch('/api/photo-enhance?id=' + encodeURIComponent(j.predId), { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);
        const d = await res.json();
        if (!d.success) return;
        if (d.status === 'succeeded') setJobs(prev => prev.map(x => x.uid === j.uid ? { ...x, status: 'succeeded', output: d.output } : x));
        else if (d.status === 'failed' || d.status === 'canceled') setJobs(prev => prev.map(x => x.uid === j.uid ? { ...x, status: 'failed', error: d.error || 'ปรับไม่สำเร็จ' } : x));
      } catch { /* timeout/เน็ตสะดุด — รอบหน้า poll ใหม่ */ }
    }));
  }, []);

  useEffect(() => {
    const hasActive = jobs.some(j => j.predId && j.status === 'processing');
    if (!hasActive) return;
    const t = setInterval(pollOnce, 2500);
    return () => clearInterval(t);
  }, [jobs, pollOnce]);

  const copyLink = (url) => { navigator.clipboard?.writeText(url); };

  const pendingCount = jobs.filter(j => j.status === 'pending').length;
  const queuedList = jobs.filter(j => j.status === 'queued').map(j => j.uid);
  const activeCount = jobs.filter(j => j.status === 'starting' || j.status === 'processing').length;
  const doneCount = jobs.filter(j => j.status === 'succeeded').length;
  const tierInfo = TIERS.find(t => t.key === tier);

  const statusBadge = (j) => {
    if (j.status === 'succeeded') return { t: '✅ คมขึ้นแล้ว', bg: 'rgba(34,197,94,0.9)' };
    if (j.status === 'failed') return { t: '❌ ไม่สำเร็จ', bg: 'rgba(239,68,68,0.9)' };
    if (j.status === 'pending') return { t: '⏳ รอเริ่ม', bg: 'rgba(107,114,128,0.9)' };
    if (j.status === 'queued') { const pos = queuedList.indexOf(j.uid) + 1; return { t: `🕒 อยู่ในคิว #${pos}`, bg: 'rgba(168,85,247,0.9)' }; }
    if (j.status === 'starting') return { t: '🔄 กำลังเริ่ม...', bg: 'rgba(59,130,246,0.9)' };
    return { t: '🔵 กำลังปรับ...', bg: 'rgba(59,130,246,0.9)' };
  };

  // ── ประตูกรอกชื่อ (บังคับใส่ชื่อก่อนใช้งาน ไม่ต้องล็อกอิน) ──
  if (!nameLoaded) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary,#0d0d1a)' }}>
        <div style={{ color: '#888', fontSize: 13 }}>⚡ กำลังโหลด...</div>
      </div>
    );
  }
  if (!me) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%)', padding: 20 }}>
        <div style={{ width: '100%', maxWidth: 420, padding: 40, borderRadius: 20,
          background: 'rgba(26,26,46,0.85)', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center',
          boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>✍️</div>
          <h2 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 8px', color: '#fff' }}>ใส่ชื่อของคุณก่อนเริ่มใช้งาน</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '0 0 22px' }}>
            ใช้กำกับว่าใครเป็นคนใช้งาน (ไม่ต้องมีรหัสผ่าน)
          </p>
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitName(); }}
            placeholder="เช่น สมชาย, น้องเอ, ทีมข่าว A"
            autoFocus
            style={{ width: '100%', padding: '13px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 15, fontFamily: 'inherit', marginBottom: 16, outline: 'none', boxSizing: 'border-box' }}
          />
          <button onClick={submitName}
            style={{ width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', fontSize: 15, fontWeight: 800,
              cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 25px rgba(59,130,246,0.3)' }}>
            🚀 เริ่มใช้งาน
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary,#0d0d1a)', color: 'var(--text-primary,#e8e8f0)', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>🔍 เพิ่มความชัดภาพข่าว</h1>
          <button onClick={changeName} title="เปลี่ยนชื่อ"
            style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid var(--border,#2a2a3e)', background: 'var(--bg-card,#1a1a2e)', color: 'var(--text-secondary,#bbb)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            👤 {me} (เปลี่ยนชื่อ)
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted,#888)', margin: '6px 0 0' }}>
          อัปโหลดภาพ → ระบบเพิ่มความละเอียด/ความชัดให้คมที่สุด แล้วคืนลิงก์ให้ดาวน์โหลด (ทำเป็นคิว สูงสุด {MAX_CONCURRENT} ภาพพร้อมกัน · ใช้พร้อมกันหลายคนได้)
        </p>

        {/* กฎเหล็ก */}
        <div style={{ marginTop: 14, padding: '11px 15px', borderRadius: 10, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary,#bbb)' }}>
          🔒 <b>คงต้นฉบับ 100%</b> — เพิ่มความละเอียดด้วยการ upscale เท่านั้น <b>ไม่เจนภาพใหม่ ไม่แตะหน้า/บริบท/รูปลักษณ์คน</b> (ปิดระบบแต่งหน้าตาย) ภาพที่ได้คือภาพเดิมที่คมขึ้น
        </div>

        {/* เลือกระดับความชัด + ราคา */}
        <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {TIERS.map(t => (
            <button key={t.key} onClick={() => setTier(t.key)}
              style={{
                flex: '1 1 240px', textAlign: 'left', padding: '12px 16px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                border: tier === t.key ? '2px solid #3b82f6' : '2px solid var(--border,#2a2a3e)',
                background: tier === t.key ? 'rgba(59,130,246,0.12)' : 'var(--bg-card,#1a1a2e)', color: 'inherit',
              }}>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>{t.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted,#888)', marginTop: 3 }}>{t.detail}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#22c55e', marginTop: 5 }}>💰 {t.price}</div>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted,#777)', marginTop: 6 }}>* ราคาประมาณการ ขึ้นกับขนาดภาพจริง (คิดตามเวลาประมวลผล Replicate)</div>

        {/* อัปโหลด */}
        <div onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          style={{ marginTop: 16, padding: 28, borderRadius: 14, border: '2px dashed var(--border,#2a2a3e)', background: 'rgba(255,255,255,0.02)', textAlign: 'center', cursor: 'pointer' }}>
          <div style={{ fontSize: 34, opacity: 0.4 }}>📷</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>คลิกเลือก หรือ ลากภาพมาวาง (สูงสุด {MAX_FILES} ภาพต่อรอบ)</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted,#888)', marginTop: 4 }}>รองรับ JPG / PNG / WebP — ไฟล์ละไม่เกิน ~10MB · ทำเสร็จภาพไหนเพิ่มภาพใหม่ต่อได้เลย</div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>

        {/* ปุ่มทำงาน */}
        {jobs.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={enhanceAll} disabled={!pendingCount}
              style={{ padding: '12px 26px', borderRadius: 11, border: 'none', cursor: pendingCount ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                background: pendingCount ? 'linear-gradient(135deg,#3b82f6,#6366f1)' : '#4b5563', color: '#fff', fontWeight: 800, fontSize: 14.5 }}>
              ✨ เพิ่มความชัด ({pendingCount} ภาพ)
            </button>
            {doneCount > 0 && (
              <button onClick={clearDone} style={{ padding: '12px 16px', borderRadius: 11, border: '1px solid var(--border,#2a2a3e)', background: 'var(--bg-card,#1a1a2e)', color: 'var(--text-secondary,#bbb)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>🧹 ล้างที่เสร็จ ({doneCount})</button>
            )}
            <button onClick={clearAll} style={{ padding: '12px 18px', borderRadius: 11, border: '1px solid var(--border,#2a2a3e)', background: 'var(--bg-card,#1a1a2e)', color: 'var(--text-muted,#888)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>🗑️ ล้างทั้งหมด</button>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted,#888)' }}>
              {jobs.length} ภาพ · เสร็จ {doneCount}{activeCount > 0 ? ` · กำลังทำ ${activeCount}` : ''}{queuedList.length > 0 ? ` · รอคิว ${queuedList.length}` : ''}
            </span>
          </div>
        )}

        {/* การ์ดงาน (คิว) */}
        {jobs.length > 0 && (
          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {jobs.map(j => {
              const sb = statusBadge(j);
              return (
                <div key={j.uid} style={{ border: '1px solid var(--border,#2a2a3e)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-card,#1a1a2e)' }}>
                  <div style={{ position: 'relative', aspectRatio: '4/3', background: '#000', overflow: 'hidden' }}>
                    <img src={j.output || j.preview} alt={j.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    <div style={{ position: 'absolute', top: 8, left: 8, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: sb.bg, color: '#fff' }}>
                      {sb.t}
                    </div>
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted,#999)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</div>
                    {j.error && <div style={{ fontSize: 11.5, color: '#ef4444', marginTop: 4 }}>{j.error}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {j.status === 'succeeded' && j.output && (
                        <>
                          <a href={j.output} target="_blank" rel="noopener noreferrer" download
                            style={{ flex: 1, textAlign: 'center', padding: '7px 0', borderRadius: 8, background: 'rgba(34,197,94,0.18)', color: '#22c55e', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>⬇️ ดาวน์โหลด</a>
                          <button onClick={() => copyLink(j.output)} style={{ padding: '7px 12px', borderRadius: 8, border: 'none', background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🔗 ลิงก์</button>
                          <button onClick={() => removeJob(j.uid)} title="เอาออกจากรายการ" style={{ padding: '7px 10px', borderRadius: 8, border: 'none', background: 'rgba(148,163,184,0.12)', color: '#94a3b8', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                        </>
                      )}
                      {j.status === 'failed' && (
                        <button onClick={() => retryJob(j.uid)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 ลองใหม่</button>
                      )}
                      {(j.status === 'pending' || j.status === 'queued' || j.status === 'failed') && (
                        <button onClick={() => removeJob(j.uid)} style={{ padding: '7px 12px', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>ลบ</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {doneCount > 0 && (
          <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--text-muted,#888)' }}>💡 ลิงก์ดาวน์โหลดอยู่ชั่วคราว (~1 ชม.) — โหลดเก็บไว้ก่อนนะ</div>
        )}
      </div>
    </div>
  );
}
