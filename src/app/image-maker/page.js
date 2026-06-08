'use client';
import { useState, useCallback, useEffect } from 'react';
import Header from '@/components/layout/Header';

// ═══ Quick Prompt Templates ═══
const QUICK_PROMPTS = [
  { id: 'q1', icon: '📰', label: 'ปกข่าว Grid + วงกลม', prompt: 'ทำภาพปกข่าว ขนาด 1080×1080 จัดวางรูปแบบ collage grid โดยมีวงกลมตรงกลาง1รูป สไตล์ข่าวไทยมืออาชีพ มีกรอบสีเขียว' },
  { id: 'q2', icon: '🔴', label: 'ปกข่าวด่วน (แดง)', prompt: 'ทำภาพปกข่าวด่วน ขนาด 1080×1080 สไตล์ breaking news มีกรอบสีแดง มีข้อความ "ข่าวด่วน!" ด้านบน จัดวางรูปแบบ collage' },
  { id: 'q3', icon: '💔', label: 'ปกข่าวดราม่า', prompt: 'ทำภาพปกข่าวดราม่า ขนาด 1080×1080 สไตล์ cinematic มีอารมณ์ จัดวางรูปแบบ collage grid มีวงกลมตรงกลาง สีโทนเข้ม' },
  { id: 'q4', icon: '💪', label: 'ปกข่าวสู้ชีวิต', prompt: 'ทำภาพปกข่าวแนวสู้ชีวิต ขนาด 1080×1080 สไตล์อบอุ่น โทนสีทอง จัดวางรูปแบบ collage มีวงกลมตรงกลางเป็นภาพหลัก' },
  { id: 'q5', icon: '🏛️', label: 'ปกข่าวการเมือง', prompt: 'ทำภาพปกข่าวการเมือง ขนาด 1080×1080 สไตล์ทางการ กรอบสีน้ำเงิน จัดวางรูปแบบ side-by-side comparison' },
  { id: 'q6', icon: '🎬', label: 'ปกข่าวบันเทิง', prompt: 'ทำภาพปกข่าวบันเทิง ขนาด 1080×1080 สไตล์สีสดใส มีกรอบสีชมพู จัดวางรูปแบบ collage สวยงาม' },
];

// ═══ Resize helper ═══
function resizeImg(file, maxPx = 1200, q = 0.85) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        res(c.toDataURL('image/jpeg', q));
      };
      img.onerror = rej;
      img.src = e.target.result;
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// ═══ Styles ═══
const s = {
  card: { background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, marginBottom: 16 },
  head: { fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 },
  body: { padding: 18 },
};

export default function CoverMakerPage() {
  const [images, setImages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [downloaded, setDownloaded] = useState({});
  const [selectedQuick, setSelectedQuick] = useState(null);

  const handleFiles = useCallback(async (files) => {
    const toAdd = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 6 - images.length);
    for (const f of toAdd) {
      try { const b64 = await resizeImg(f); setImages(p => [...p, b64]); } catch {}
    }
  }, [images.length]);

  const handleDrop = useCallback((e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }, [handleFiles]);

  const selectQuickPrompt = (qp) => {
    setSelectedQuick(qp.id);
    setPrompt(qp.prompt);
  };

  const handleGenerate = async () => {
    if (!images.length) { setError('กรุณาอัปโหลดรูปข่าวอย่างน้อย 1 รูป'); return; }
    if (!prompt.trim()) { setError('กรุณาระบุ Prompt'); return; }
    setError(''); setResult(null); setLoading(true); setDownloaded({});
    try {
      const res = await fetch('/api/gemini-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, referenceImages: images }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setResult(data);
    } catch (e) { setError('❌ ' + e.message); }
    finally { setLoading(false); }
  };

  const download = (b64, fname, key) => {
    const a = document.createElement('a'); a.href = b64; a.download = fname; a.click();
    setDownloaded(p => ({ ...p, [key]: true }));
    setTimeout(() => setDownloaded(p => ({ ...p, [key]: false })), 2500);
  };

  return (
    <>
      <Header title="🎨 Gemini Cover Maker" subtitle="สร้างภาพปกข่าวจากรูปจริง ด้วย Gemini AI" />
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px 60px' }}>

        {/* ① Upload Photos */}
        <div style={s.card}>
          <div style={s.head}>
            ① อัปโหลดรูปข่าว
            <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 'auto' }}>{images.length}/6 รูป</span>
          </div>
          <div style={s.body}>
            <div onDrop={handleDrop} onDragOver={e => e.preventDefault()}
              style={{ border: '2px dashed rgba(163,230,53,0.2)', borderRadius: 10, padding: 16, minHeight: 100 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {images.map((src, i) => (
                  <div key={i} style={{ position: 'relative', width: 100, height: 100, borderRadius: 8, overflow: 'hidden', border: '2px solid rgba(163,230,53,0.3)', flexShrink: 0 }}>
                    <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.65)', fontSize: 9, textAlign: 'center', color: '#fff', padding: '2px 0' }}>รูป {i + 1}</div>
                    <button onClick={() => setImages(p => p.filter((_, j) => j !== i))} style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.8)', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                ))}
                {images.length < 6 && (
                  <label style={{ width: 100, height: 100, borderRadius: 8, border: '1px dashed rgba(255,255,255,0.15)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)', gap: 4, flexShrink: 0, transition: 'all .15s' }}>
                    <span style={{ fontSize: 28 }}>+</span>
                    <span style={{ fontSize: 10 }}>เพิ่มรูป</span>
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                      onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
                  </label>
                )}
                {!images.length && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 8px', lineHeight: 1.8 }}>
                    📸 ลากรูปมาวาง หรือคลิก + เพื่ออัปโหลดรูปข่าวจริง<br />
                    <span style={{ fontSize: 10, opacity: 0.6 }}>JPG · PNG · WebP (สูงสุด 6 รูป)</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ② Quick Prompt Presets */}
        <div style={s.card}>
          <div style={s.head}>② เลือก Prompt สำเร็จรูป <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>— หรือพิมพ์เอง</span></div>
          <div style={{ ...s.body, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {QUICK_PROMPTS.map(qp => (
              <button key={qp.id} onClick={() => selectQuickPrompt(qp)} style={{
                padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                border: `2px solid ${selectedQuick === qp.id ? '#a3e635' : 'var(--border)'}`,
                background: selectedQuick === qp.id ? 'rgba(163,230,53,0.08)' : 'var(--bg-primary)',
                transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 18 }}>{qp.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: selectedQuick === qp.id ? '#a3e635' : 'var(--text-primary)' }}>{qp.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ③ Prompt (editable) */}
        <div style={s.card}>
          <div style={s.head}>③ Prompt <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>— พิมพ์ภาษาไทยได้เลย เหมือนสั่ง Gemini ตรงๆ</span></div>
          <div style={s.body}>
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setSelectedQuick(null); }}
              placeholder="เช่น: ทำภาพปกข่าว ขนาด 1080×1080 5ภาพ โดยมีวงกลมตรงกลาง1รูป"
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-primary)',
                color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit',
                boxSizing: 'border-box', lineHeight: 1.6, resize: 'vertical',
                minHeight: 100,
              }}
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
              💡 Gemini AI วางแผน Layout → Sharp.js จัดวางรูปจริง (ไม่บิดเบือน 100%)
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <button onClick={handleGenerate} disabled={loading || !images.length || !prompt.trim()} style={{
          width: '100%', padding: '18px', borderRadius: 14, border: 'none',
          background: (loading || !images.length || !prompt.trim()) ? 'var(--bg-elevated)' : 'linear-gradient(135deg, #a3e635, #059669)',
          color: (loading || !images.length || !prompt.trim()) ? 'var(--text-muted)' : '#000',
          fontWeight: 900, fontSize: 17, cursor: (loading || !images.length || !prompt.trim()) ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', marginBottom: 16, transition: 'all .2s',
          boxShadow: (loading || !images.length || !prompt.trim()) ? 'none' : '0 8px 30px rgba(163,230,53,0.3)',
        }}>
          {loading ? '⏳ Gemini กำลังสร้างภาพปก...' : `🎨 สร้างภาพปก — ${images.length} รูป`}
        </button>

        {/* Error */}
        {error && (
          <div style={{ padding: '14px 18px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, fontSize: 13, color: '#fca5a5', marginBottom: 16, lineHeight: 1.6 }}>
            {error}
          </div>
        )}

        {/* ④ Result */}
        {result && !loading && (
          <div style={s.card}>
            <div style={s.head}>
              ✅ ภาพปกข่าว
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {result.durationSeconds}s • {result.model}
              </span>
            </div>
            <div style={{ ...s.body, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {result.images.map((img, i) => (
                <div key={i} style={{ border: '2px solid #a3e635', borderRadius: 12, overflow: 'hidden' }}>
                  <img src={img.base64} alt={`cover-${i}`} style={{ width: '100%', display: 'block' }} />
                  <div style={{ padding: 12 }}>
                    <button onClick={() => download(img.base64, `cover-${Date.now()}-${i}.png`, `img${i}`)} style={{
                      width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                      background: 'linear-gradient(135deg, #a3e635, #16a34a)',
                      color: '#000', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      {downloaded[`img${i}`] ? '✅ ดาวน์โหลดแล้ว' : `📥 Download ภาพ ${i + 1}`}
                    </button>
                  </div>
                </div>
              ))}

              {result.plan && (
                <div style={{ padding: '12px 16px', background: 'rgba(163,230,53,0.06)', borderRadius: 10, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                  🧠 <strong style={{ color: '#a3e635' }}>Gemini วางแผน:</strong> Layout: {result.plan.layout} • Border: {result.plan.borderColor} • Accent: {result.plan.accentColor}
                  {result.plan.headline && <><br />📰 Headline: {result.plan.headline}</>}
                  {result.plan.subheadline && <><br />📝 Sub: {result.plan.subheadline}</>}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { handleGenerate(); }} style={{
                  flex: 1, padding: '10px', borderRadius: 8, border: '1px solid rgba(163,230,53,0.3)',
                  background: 'rgba(163,230,53,0.06)', color: '#a3e635',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  🔄 สร้างใหม่ (Prompt เดิม)
                </button>
                <button onClick={() => { setResult(null); setError(''); }} style={{
                  padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-muted)',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  ✏️ แก้ Prompt
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}