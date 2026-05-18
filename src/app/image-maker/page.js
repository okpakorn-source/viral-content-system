'use client';
import { useState, useCallback } from 'react';
import Header from '@/components/layout/Header';

// ── Resize image client-side before sending (ป้องกัน Vercel 4.5MB limit) ──
function resizeImage(file, maxPx = 800, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else       { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const TEMPLATES_META = {
  accident:      { label: 'อุบัติเหตุ / ภัยพิบัติ', icon: '🚨', color: '#22c55e' },
  crime:         { label: 'อาชญากรรม',              icon: '🔴', color: '#ef4444' },
  politics:      { label: 'การเมือง',                icon: '🏛️', color: '#3b82f6' },
  economy:       { label: 'เศรษฐกิจ / ธุรกิจ',     icon: '💰', color: '#f59e0b' },
  entertainment: { label: 'บันเทิง / ไลฟ์สไตล์',   icon: '🎬', color: '#ec4899' },
};

export default function ImageMakerPage() {
  const [images, setImages]         = useState([]);   // base64[]
  const [newsTitle, setNewsTitle]   = useState('');
  const [newsType, setNewsType]     = useState('accident');
  const [withText, setWithText]     = useState(true);
  const [loading, setLoading]       = useState(false);
  const [step, setStep]             = useState('');   // status text
  const [error, setError]           = useState('');
  const [result, setResult]         = useState(null); // { layout, text }
  const [layoutInfo, setLayoutInfo] = useState(null);
  const [downloaded, setDownloaded] = useState({});

  // ── Image Upload ──────────────────────────────────────────────
  const handleFiles = useCallback(async (files) => {
    const remaining = 5 - images.length;
    const toAdd = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
    for (const file of toAdd) {
      try {
        const b64 = await resizeImage(file, 800, 0.72);
        setImages(prev => [...prev, b64]);
      } catch (e) {
        console.warn('resize failed:', e);
      }
    }
  }, [images.length]);


  const removeImage = (idx) => setImages(prev => prev.filter((_, i) => i !== idx));

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // ── Main Compose ──────────────────────────────────────────────
  const handleCompose = async () => {
    if (images.length === 0) { setError('กรุณาอัปโหลดรูปอย่างน้อย 1 รูป'); return; }
    setError('');
    setResult(null);
    setLayoutInfo(null);
    setLoading(true);
    setDownloaded({});

    try {
      // Step 1: Analyze
      setStep('🧠 AI วิเคราะห์รูปและกำหนด layout...');
      const analyzeRes = await fetch('/api/image-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, newsTitle, newsType }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeData.success) throw new Error('วิเคราะห์ layout ไม่สำเร็จ: ' + analyzeData.error);

      setLayoutInfo(analyzeData.layout);
      setStep('🖼️ กำลัง composite รูป ด้วย Sharp.js...');

      // Step 2: Compose
      const composeRes = await fetch('/api/image-compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images,
          layout: analyzeData.layout,
          newsTitle,
          generateText: withText,
        }),
      });
      const composeData = await composeRes.json();
      if (!composeData.success) throw new Error('สร้างรูปไม่สำเร็จ: ' + composeData.error);

      setResult(composeData.versions);
      setStep('');
      if (composeData.textError) {
        setError('⚠️ Text version: ' + composeData.textError + ' (Layout version สำเร็จ)');
      }

    } catch (e) {
      setError('❌ ' + e.message);
      setStep('');
    } finally {
      setLoading(false);
    }
  };

  const download = (b64, filename, key) => {
    const a = document.createElement('a');
    a.href = b64;
    a.download = filename;
    a.click();
    setDownloaded(p => ({ ...p, [key]: true }));
    setTimeout(() => setDownloaded(p => ({ ...p, [key]: false })), 2500);
  };

  const reset = () => {
    setImages([]); setResult(null); setLayoutInfo(null);
    setError(''); setStep(''); setNewsTitle(''); setDownloaded({});
  };

  const tmplMeta = TEMPLATES_META[newsType] || TEMPLATES_META.accident;

  return (
    <>
      <Header
        title="🖼️ Image Maker"
        subtitle="สร้างปกข่าว 1080×1080 ด้วย AI — อัปโหลดรูป เลือก Template กด Compose"
      />
      <div className="page-content" style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* ── Config Panel ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

            {/* News Title */}
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">📰 หัวข้อข่าว <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(ใช้สำหรับ text overlay)</span></label>
              <input className="form-input" placeholder="เช่น นักศึกษาแพทย์เสียชีวิตจากอุบัติเหตุรถตู้..."
                value={newsTitle} onChange={e => setNewsTitle(e.target.value)} style={{ fontSize: 14 }} />
            </div>

            {/* Template */}
            <div className="form-group">
              <label className="form-label">🎨 ประเภทข่าว (Template)</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {Object.entries(TEMPLATES_META).map(([k, v]) => (
                  <button key={k} onClick={() => setNewsType(k)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s',
                      background: newsType === k ? v.color : 'var(--bg-primary)',
                      color: newsType === k ? '#fff' : 'var(--text-muted)',
                      border: `1px solid ${newsType === k ? v.color : 'var(--border)'}`,
                    }}>
                    {v.icon} {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Text toggle */}
            <div className="form-group">
              <label className="form-label">✏️ เพิ่มข้อความ (Ideogram)</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {[{ v: true, l: '✅ มีข้อความ' }, { v: false, l: '🖼️ Layout only' }].map(opt => (
                  <button key={String(opt.v)} onClick={() => setWithText(opt.v)}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit',
                      background: withText === opt.v ? 'var(--accent)' : 'var(--bg-primary)',
                      color: withText === opt.v ? '#fff' : 'var(--text-muted)',
                      border: `1px solid ${withText === opt.v ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                    {opt.l}
                  </button>
                ))}
              </div>
              {withText && !newsTitle && (
                <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 4 }}>⚠️ ใส่หัวข้อข่าวด้วยเพื่อให้ Ideogram มีข้อความใส่</div>
              )}
            </div>
          </div>

          {/* ── Image Upload Zone ── */}
          <div>
            <label className="form-label">📸 รูปประกอบข่าว <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(1-5 รูป — AI จะจัดวางให้อัตโนมัติ)</span></label>
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              style={{
                marginTop: 8, padding: 16, border: '2px dashed rgba(255,255,255,0.15)',
                borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)',
                minHeight: 100,
              }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {images.map((src, i) => (
                  <div key={i} style={{ position: 'relative', width: 90, height: 90, borderRadius: 10, overflow: 'hidden', border: `2px solid ${tmplMeta.color}55`, flexShrink: 0 }}>
                    <img src={src} alt={`img${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', fontSize: 9, textAlign: 'center', color: '#fff', padding: '2px 0' }}>
                      รูป {i + 1}
                    </div>
                    <button onClick={() => removeImage(i)}
                      style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.8)', border: 'none', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                      ✕
                    </button>
                  </div>
                ))}
                {images.length < 5 && (
                  <label style={{
                    width: 90, height: 90, borderRadius: 10, border: '1px dashed rgba(255,255,255,0.2)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'var(--text-muted)', gap: 4, flexShrink: 0,
                    background: 'rgba(255,255,255,0.02)', transition: 'border-color .2s',
                  }}>
                    <span style={{ fontSize: 28 }}>+</span>
                    <span style={{ fontSize: 10 }}>เพิ่มรูป</span>
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                      onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
                  </label>
                )}
                {images.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 8px' }}>
                    ลากรูปมาวาง หรือคลิก + เพื่อเลือกรูป (รองรับ 1-5 รูป, JPG/PNG/WebP)
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Compose Button ── */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
            <button onClick={handleCompose} disabled={loading || images.length === 0}
              style={{
                padding: '12px 28px', borderRadius: 'var(--radius-md)', border: 'none', fontFamily: 'inherit',
                background: loading || images.length === 0 ? 'var(--bg-elevated)' : `linear-gradient(135deg, ${tmplMeta.color}, #7c3aed)`,
                color: '#fff', fontWeight: 800, fontSize: 14, cursor: loading || images.length === 0 ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : `0 4px 20px ${tmplMeta.color}44`,
                transition: 'all .3s',
              }}>
              {loading ? '⏳ กำลังสร้าง...' : `${tmplMeta.icon} Compose รูป`}
            </button>
            {(result || error) && (
              <button onClick={reset} style={{ padding: '10px 18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                🔄 เริ่มใหม่
              </button>
            )}
          </div>
        </div>

        {/* ── Progress ── */}
        {loading && step && (
          <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 20, height: 20, border: '3px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-light)' }}>{step}</span>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div style={{ padding: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-md)', marginBottom: 16, fontSize: 13, color: '#fca5a5' }}>
            {error}
          </div>
        )}

        {/* ── Layout Info ── */}
        {layoutInfo && (
          <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 'var(--radius-md)', marginBottom: 14, fontSize: 11 }}>
            <span style={{ fontWeight: 800, color: '#818cf8' }}>🧠 AI Layout: </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Template <strong>{layoutInfo.templateName}</strong> •
              Confidence {layoutInfo.confidence}% •
              {layoutInfo.hasMemorial ? ' 🕊️ มีรูป memorial (ขาวดำ)' : ''}
            </span>
            {layoutInfo.reasoning && (
              <div style={{ marginTop: 4, color: 'var(--text-muted)', fontStyle: 'italic' }}>"{layoutInfo.reasoning}"</div>
            )}
          </div>
        )}

        {/* ── Result ── */}
        {result && !loading && (
          <div className="card">
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 16 }}>
              ✅ ปกข่าวที่สร้างได้
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>

              {/* Layout version */}
              {result.layout && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.08)', borderRadius: 10 }}>🖼️ Layout Only</span>
                    <span style={{ fontWeight: 400 }}>ไม่มีข้อความ</span>
                  </div>
                  <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', aspectRatio: '1/1', background: '#000' }}>
                    <img src={result.layout.imageBase64} alt="layout" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                  </div>
                  <button onClick={() => download(result.layout.imageBase64, `news-layout-${Date.now()}.jpg`, 'layout')}
                    style={{
                      width: '100%', marginTop: 10, padding: '10px', borderRadius: 8,
                      border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                      color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12,
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s',
                    }}>
                    {downloaded.layout ? '✅ ดาวน์โหลดแล้ว' : '📥 Download Layout'}
                  </button>
                </div>
              )}

              {/* Text version */}
              {result.text && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ padding: '2px 8px', background: 'rgba(249,24,128,0.12)', borderRadius: 10, color: '#f472b6', border: '1px solid rgba(249,24,128,0.2)' }}>✏️ พร้อมข้อความ</span>
                    <span style={{ fontWeight: 400 }}>Ideogram AI</span>
                  </div>
                  <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(249,24,128,0.3)', aspectRatio: '1/1', background: '#000' }}>
                    <img src={result.text.imageBase64} alt="with-text" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                  </div>
                  <button onClick={() => download(result.text.imageBase64, `news-text-${Date.now()}.jpg`, 'text')}
                    style={{
                      width: '100%', marginTop: 10, padding: '10px', borderRadius: 8,
                      border: 'none', background: 'linear-gradient(135deg, #f91880, #7c3aed)',
                      color: '#fff', fontWeight: 700, fontSize: 12,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {downloaded.text ? '✅ ดาวน์โหลดแล้ว' : '📥 Download พร้อมข้อความ'}
                  </button>
                </div>
              )}

              {/* If only layout and text was requested but failed */}
              {!result.text && withText && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 12, minHeight: 200 }}>
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 20 }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
                    <div>Text version ไม่สำเร็จ</div>
                    <div style={{ fontSize: 10, marginTop: 4 }}>ตรวจสอบ IDEOGRAM_API_KEY</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tips ── */}
        {!result && !loading && (
          <div className="card" style={{ marginTop: 16, opacity: 0.7 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>💡 Tips</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
              {[
                { t: '2-5 รูปดีที่สุด', d: 'AI จะเลือกรูปหลัก รูปบริบท รูปเหตุการณ์ให้อัตโนมัติ' },
                { t: 'ใส่หัวข้อข่าว', d: 'ถ้าต้องการ text overlay — AI จะใช้เป็น headline' },
                { t: 'เลือก Template ให้ตรง', d: 'ช่วยให้ AI จัด layout ได้ถูกต้องและสวยกว่า' },
                { t: 'Layout only เร็วกว่า', d: 'ไม่ต้องรอ Ideogram — ได้รูปใน ~10 วินาที' },
              ].map((tip, i) => (
                <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2 }}>✨ {tip.t}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{tip.d}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
