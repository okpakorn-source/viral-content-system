'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

// ระดับความชัด (ตรงกับ ENHANCE_TIERS ฝั่งเซิร์ฟเวอร์)
const TIERS = [
  { key: 'standard', label: '🟢 ชัดมาตรฐาน', detail: 'ขยาย 2 เท่า — เร็ว ประหยัด', price: '~0.05 บาท/ภาพ' },
  { key: 'high', label: '🔵 ชัดสูงสุด', detail: 'ขยาย 4 เท่า — คมสุด ละเอียดสุด', price: '~0.12 บาท/ภาพ' },
];
const MAX_FILES = 10;

let _uid = 0;

export default function PhotoEnhancePage() {
  const [tier, setTier] = useState('high');
  const [jobs, setJobs] = useState([]); // {uid, name, preview, dataUri, predId, status, output, error}
  const [running, setRunning] = useState(false);
  const fileRef = useRef(null);

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(f => /^image\//.test(f.type));
    if (!files.length) return;
    const room = MAX_FILES - jobs.length;
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

  // เพิ่มความชัดทั้งหมดที่ยัง pending — สร้างงานฝั่ง Replicate (แต่ละภาพ = 1 งาน, คิวรองรับหลายคน/หลายภาพ)
  const enhanceAll = async () => {
    const pending = jobs.filter(j => j.status === 'pending');
    if (!pending.length || running) return;
    setRunning(true);
    try {
      for (const j of pending) {
        try {
          const res = await fetch('/api/photo-enhance', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: j.dataUri, tier }),
          });
          const d = await res.json();
          if (d.success) setJobs(prev => prev.map(x => x.uid === j.uid ? { ...x, predId: d.id, status: 'processing' } : x));
          else setJobs(prev => prev.map(x => x.uid === j.uid ? { ...x, status: 'failed', error: d.error } : x));
        } catch (e) {
          setJobs(prev => prev.map(x => x.uid === j.uid ? { ...x, status: 'failed', error: e.message } : x));
        }
      }
    } finally {
      // ★ ปลดล็อกปุ่มทันทีหลังส่งงานครบ — การประมวลผลจริงดูที่สถานะรายภาพ (กดเพิ่มภาพใหม่ได้เลย)
      setRunning(false);
    }
  };

  // poll งานที่ยังทำอยู่ทุก 2.5 วิ
  const pollOnce = useCallback(async () => {
    const active = jobs.filter(j => j.predId && (j.status === 'processing' || j.status === 'starting'));
    if (!active.length) return;
    await Promise.all(active.map(async (j) => {
      try {
        const res = await fetch('/api/photo-enhance?id=' + encodeURIComponent(j.predId), { cache: 'no-store' });
        const d = await res.json();
        if (!d.success) return;
        if (d.status === 'succeeded') setJobs(prev => prev.map(x => x.uid === j.uid ? { ...x, status: 'succeeded', output: d.output } : x));
        else if (d.status === 'failed' || d.status === 'canceled') setJobs(prev => prev.map(x => x.uid === j.uid ? { ...x, status: 'failed', error: d.error || 'ปรับไม่สำเร็จ' } : x));
      } catch {}
    }));
  }, [jobs]);

  useEffect(() => {
    const hasActive = jobs.some(j => j.predId && (j.status === 'processing' || j.status === 'starting'));
    if (!hasActive) return;
    const t = setInterval(pollOnce, 2500);
    return () => clearInterval(t);
  }, [jobs, pollOnce]);

  const copyLink = (url) => { navigator.clipboard?.writeText(url); };

  const pendingCount = jobs.filter(j => j.status === 'pending').length;
  const doneCount = jobs.filter(j => j.status === 'succeeded').length;
  const tierInfo = TIERS.find(t => t.key === tier);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary,#0d0d1a)', color: 'var(--text-primary,#e8e8f0)', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 20px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>🔍 เพิ่มความชัดภาพข่าว</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted,#888)', margin: '6px 0 0' }}>
          อัปโหลดภาพ → ระบบเพิ่มความละเอียด/ความชัดให้คมที่สุด แล้วคืนลิงก์ให้ดาวน์โหลด (รองรับหลายภาพ + ใช้พร้อมกันได้)
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
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>คลิกเลือก หรือ ลากภาพมาวาง (สูงสุด {MAX_FILES} ภาพ)</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted,#888)', marginTop: 4 }}>รองรับ JPG / PNG / WebP — ไฟล์ละไม่เกิน ~10MB</div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>

        {/* ปุ่มทำงาน */}
        {jobs.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={enhanceAll} disabled={!pendingCount || running}
              style={{ padding: '12px 26px', borderRadius: 11, border: 'none', cursor: pendingCount && !running ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                background: pendingCount && !running ? 'linear-gradient(135deg,#3b82f6,#6366f1)' : '#4b5563', color: '#fff', fontWeight: 800, fontSize: 14.5 }}>
              {running ? '⏳ กำลังเพิ่มความชัด...' : `✨ เพิ่มความชัด (${pendingCount} ภาพ)`}
            </button>
            <button onClick={clearAll} style={{ padding: '12px 18px', borderRadius: 11, border: '1px solid var(--border,#2a2a3e)', background: 'var(--bg-card,#1a1a2e)', color: 'var(--text-muted,#888)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>🗑️ ล้างทั้งหมด</button>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted,#888)' }}>{jobs.length} ภาพ · เสร็จแล้ว {doneCount}</span>
          </div>
        )}

        {/* การ์ดงาน (คิว) */}
        {jobs.length > 0 && (
          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {jobs.map(j => (
              <div key={j.uid} style={{ border: '1px solid var(--border,#2a2a3e)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-card,#1a1a2e)' }}>
                <div style={{ position: 'relative', aspectRatio: '4/3', background: '#000', overflow: 'hidden' }}>
                  <img src={j.output || j.preview} alt={j.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  <div style={{ position: 'absolute', top: 8, left: 8, padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                    background: j.status === 'succeeded' ? 'rgba(34,197,94,0.9)' : j.status === 'failed' ? 'rgba(239,68,68,0.9)' : j.status === 'pending' ? 'rgba(107,114,128,0.9)' : 'rgba(59,130,246,0.9)', color: '#fff' }}>
                    {j.status === 'succeeded' ? '✅ คมขึ้นแล้ว' : j.status === 'failed' ? '❌ ไม่สำเร็จ' : j.status === 'pending' ? '⏳ รอเริ่ม' : '🔵 กำลังปรับ...'}
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
                      </>
                    )}
                    {j.status !== 'succeeded' && (
                      <button onClick={() => removeJob(j.uid)} style={{ padding: '7px 12px', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>ลบ</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {doneCount > 0 && (
          <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--text-muted,#888)' }}>💡 ลิงก์ดาวน์โหลดอยู่ชั่วคราว (~1 ชม.) — โหลดเก็บไว้ก่อนนะ</div>
        )}
      </div>
    </div>
  );
}
