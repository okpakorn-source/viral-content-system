'use client';
import { useState, useCallback, useEffect } from 'react';
import Header from '@/components/layout/Header';
import TemplateAnalyzer from './TemplateAnalyzer';

const BUILT_IN = {
  grid_circle:    { label: 'Grid + วงกลม',        icon: '⊞', color: '#a3e635', photos: 5, desc: '2×2 grid + วงกลมกลาง' },
  big_face_multi: { label: 'ใบหน้าใหญ่ + Multi',  icon: '👤', color: '#a3e635', photos: 5, desc: 'หน้าใหญ่ซ้าย + 4 โซนขวา' },
  big_face_ev:    { label: 'หน้า + หลักฐาน',      icon: '🔍', color: '#a3e635', photos: 4, desc: 'หน้า bg + หลักฐาน bordered' },
  accident:       { label: 'อุบัติเหตุ',            icon: '🚨', color: '#22c55e', photos: 5, desc: 'ข่าวอุบัติเหตุ / ภัยพิบัติ' },
  crime:          { label: 'อาชญากรรม',             icon: '🔴', color: '#ef4444', photos: 4, desc: 'ข่าวอาชญากรรม' },
  politics:       { label: 'การเมือง',               icon: '🏛️', color: '#3b82f6', photos: 4, desc: 'ข่าวการเมือง' },
  economy:        { label: 'เศรษฐกิจ',               icon: '💰', color: '#f59e0b', photos: 4, desc: 'ข่าวเศรษฐกิจ / ธุรกิจ' },
  entertainment:  { label: 'บันเทิง',                icon: '🎬', color: '#ec4899', photos: 3, desc: 'ข่าวบันเทิง / ไลฟ์สไตล์' },
};

function resizeImg(file, maxPx = 900, q = 0.78) {
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

const s = {
  card: { background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, marginBottom: 16 },
  sectionHead: { fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', padding: '14px 18px', borderBottom: '1px solid var(--border)' },
  body: { padding: 18 },
};

export default function ImageMakerPage() {
  const [tab, setTab]               = useState('compose'); // 'compose' | 'analyze'
  const [images, setImages]         = useState([]);
  const [newsTitle, setNewsTitle]   = useState('');
  const [template, setTemplate]     = useState('grid_circle');
  const [withText, setWithText]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [step, setStep]             = useState('');
  const [error, setError]           = useState('');
  const [result, setResult]         = useState(null);
  const [downloaded, setDownloaded] = useState({});
  const [customTemplates, setCustomTemplates] = useState([]);

  useEffect(() => {
    try {
      const ct = localStorage.getItem('customTemplates');
      if (ct) setCustomTemplates(JSON.parse(ct));
    } catch {}
  }, []);

  // เพิ่ม helper: ดึง zones ของ custom template จาก localStorage
  const getCustomZones = (templateId) => {
    try {
      const ct = JSON.parse(localStorage.getItem('customTemplates') || '[]');
      return ct.find(t => t.id === templateId)?.zones || null;
    } catch { return null; }
  };

  const allTemplates = {
    ...BUILT_IN,
    ...Object.fromEntries(customTemplates.map(t => [t.id, {
      label: t.name || 'Custom Template', // ✅ ใช้ name ไม่ใช่ id
      icon: '⭐',
      color: t.color || '#a3e635',
      photos: t.totalPhotosNeeded || t.zones?.length || '?',
      desc: `${t.zones?.length || '?'} zones • custom`,
      previewImage: t.previewImage,
    }])),
  };

  const handleFiles = useCallback(async (files) => {
    const toAdd = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 5 - images.length);
    for (const f of toAdd) {
      try { const b64 = await resizeImg(f); setImages(p => [...p, b64]); } catch {}
    }
  }, [images.length]);

  const handleDrop = useCallback((e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }, [handleFiles]);

  const handleCompose = async () => {
    if (!images.length) { setError('กรุณาอัปโหลดรูปอย่างน้อย 1 รูป'); return; }
    setError(''); setResult(null); setLoading(true); setDownloaded({});

    // ✅ FIX: ดึง zones ของ custom template
    const isBuiltIn = Boolean(BUILT_IN[template]);
    const customZones = isBuiltIn ? null : getCustomZones(template);
    const customTmplInfo = isBuiltIn ? null : customTemplates.find(t => t.id === template);

    try {
      setStep('🤖 AI วิเคราะห์รูปและ layout...');
      const aRes = await fetch('/api/image-analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images,
          newsTitle,
          newsType: template,
          // ✅ ส่ง custom zones ถ้ามี
          customZones: customZones || undefined,
          templateName: customTmplInfo?.name || undefined,
        }),
      });
      const aData = await aRes.json();
      if (!aData.success) throw new Error(aData.error);

      setStep('🖼️ Sharp.js กำลัง composite รูป...');
      const cRes = await fetch('/api/image-compose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, layout: aData.layout, newsTitle, generateText: withText }),
      });
      const cData = await cRes.json();
      if (!cData.success) throw new Error(cData.error);
      setResult(cData.versions);
      if (cData.textError) setError('⚠️ ' + cData.textError);
    } catch (e) { setError('❌ ' + e.message); }
    finally { setLoading(false); setStep(''); }
  };

  const download = (b64, fname, key) => {
    const a = document.createElement('a'); a.href = b64; a.download = fname; a.click();
    setDownloaded(p => ({ ...p, [key]: true }));
    setTimeout(() => setDownloaded(p => ({ ...p, [key]: false })), 2500);
  };

  const tmplInfo = allTemplates[template] || BUILT_IN.grid_circle;

  return (
    <>
      <Header title="🖼️ Image Maker" subtitle="สร้างปกข่าว 1080×1080 ด้วย AI" />
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 16px 40px' }}>

        {/* Tab Bar */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, padding: '6px', background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border)' }}>
          {[
            { id: 'compose', label: '🖼️ สร้างรูป', desc: 'compose ปกข่าว' },
            { id: 'analyze', label: '🔍 วิเคราะห์ Template', desc: 'อัปโหลด template ใหม่' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '10px 8px', borderRadius: 8, border: 'none', fontFamily: 'inherit',
              background: tab === t.id ? 'var(--accent)' : 'transparent',
              color: tab === t.id ? '#fff' : 'var(--text-muted)',
              fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all .15s',
            }}>
              {t.label}
              <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.7, marginTop: 1 }}>{t.desc}</div>
            </button>
          ))}
        </div>

        {/* ══ TAB: ANALYZE ══ */}
        {tab === 'analyze' && (
          <div style={s.card}>
            <TemplateAnalyzer onTemplateSaved={t => {
              setCustomTemplates(p => [...p, t]);
              setTab('compose');
              setTemplate(t.id);
            }} />
          </div>
        )}

        {/* ══ TAB: COMPOSE ══ */}
        {tab === 'compose' && (
          <>
            {/* Step 1: เลือก Template */}
            <div style={s.card}>
              <div style={s.sectionHead}>① เลือก Template</div>
              <div style={s.body}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                  {Object.entries(allTemplates).map(([k, v]) => (
                    <button key={k} onClick={() => setTemplate(k)} style={{
                      padding: 10, borderRadius: 10, border: `2px solid ${template === k ? v.color : 'var(--border)'}`,
                      background: template === k ? `${v.color}15` : 'var(--bg-primary)',
                      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'all .15s',
                      position: 'relative', overflow: 'hidden',
                    }}>
                      {v.previewImage && (
                        <img src={v.previewImage} alt="" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 6, display: 'block', marginBottom: 6 }} />
                      )}
                      {!v.previewImage && (
                        <div style={{ fontSize: 26, marginBottom: 4, textAlign: 'center' }}>{v.icon}</div>
                      )}
                      <div style={{ fontSize: 11, fontWeight: 700, color: template === k ? v.color : 'var(--text-primary)', lineHeight: 1.3 }}>{v.label}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{v.desc}</div>
                      <div style={{ fontSize: 9, color: template === k ? v.color : 'var(--text-muted)', marginTop: 2, fontWeight: 700 }}>📸 {v.photos} รูป</div>
                      {template === k && (
                        <div style={{ position: 'absolute', top: 5, right: 5, width: 16, height: 16, borderRadius: '50%', background: v.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#000' }}>✓</div>
                      )}
                    </button>
                  ))}
                  {/* Add new template button */}
                  <button onClick={() => setTab('analyze')} style={{
                    padding: 10, borderRadius: 10, border: '2px dashed rgba(163,230,53,0.3)',
                    background: 'rgba(163,230,53,0.03)', cursor: 'pointer', fontFamily: 'inherit',
                    textAlign: 'center', minHeight: 100, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .15s',
                  }}>
                    <div style={{ fontSize: 26 }}>+</div>
                    <div style={{ fontSize: 10, color: '#a3e635', fontWeight: 700 }}>วิเคราะห์ Template ใหม่</div>
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2: อัปโหลดรูป */}
            <div style={s.card}>
              <div style={s.sectionHead}>
                ② อัปโหลดรูปประกอบข่าว
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                  ต้องการ {tmplInfo.photos} รูป • อัปโหลด {images.length}/{tmplInfo.photos}
                </span>
              </div>
              <div style={s.body}>
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  style={{ border: '2px dashed rgba(255,255,255,0.1)', borderRadius: 10, padding: 16, minHeight: 100 }}
                >
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    {images.map((src, i) => (
                      <div key={i} style={{ position: 'relative', width: 90, height: 90, borderRadius: 8, overflow: 'hidden', border: `2px solid ${tmplInfo.color}55`, flexShrink: 0 }}>
                        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.65)', fontSize: 9, textAlign: 'center', color: '#fff', padding: '2px 0' }}>รูป {i + 1}</div>
                        <button onClick={() => setImages(p => p.filter((_, j) => j !== i))} style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.8)', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                      </div>
                    ))}
                    {images.length < 5 && (
                      <label style={{ width: 90, height: 90, borderRadius: 8, border: '1px dashed rgba(255,255,255,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 28 }}>+</span>
                        <span style={{ fontSize: 10 }}>เพิ่มรูป</span>
                        <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
                      </label>
                    )}
                    {!images.length && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '16px 8px', lineHeight: 1.6 }}>
                        ลากรูปมาวาง หรือคลิก +<br />
                        <span style={{ fontSize: 10 }}>JPG · PNG · WebP</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3: ตัวเลือก */}
            <div style={s.card}>
              <div style={s.sectionHead}>③ ตัวเลือก</div>
              <div style={{ ...s.body, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>หัวข้อข่าว (สำหรับ text overlay)</label>
                  <input value={newsTitle} onChange={e => setNewsTitle(e.target.value)}
                    placeholder="เช่น รถตู้ชนกัน เสียชีวิต 3 ราย..."
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Text Overlay</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { v: false, l: '🖼️ Layout Only', desc: 'เร็ว ไม่เสียเครดิต' },
                      { v: true, l: '✏️ ใส่ข้อความ', desc: 'ใช้ Ideogram' },
                    ].map(opt => (
                      <button key={String(opt.v)} onClick={() => setWithText(opt.v)} style={{
                        padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                        border: `1px solid ${withText === opt.v ? tmplInfo.color : 'var(--border)'}`,
                        background: withText === opt.v ? `${tmplInfo.color}18` : 'transparent',
                        color: withText === opt.v ? tmplInfo.color : 'var(--text-muted)',
                        fontSize: 12, fontWeight: 700, textAlign: 'left',
                      }}>
                        {opt.l}
                        <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2 }}>{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Compose Button */}
            <button onClick={handleCompose} disabled={loading || !images.length} style={{
              width: '100%', padding: '14px', borderRadius: 12, border: 'none',
              background: (loading || !images.length) ? 'var(--bg-elevated)' : `linear-gradient(135deg,${tmplInfo.color},#7c3aed)`,
              color: (loading || !images.length) ? 'var(--text-muted)' : '#fff',
              fontWeight: 800, fontSize: 15, cursor: (loading || !images.length) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', marginBottom: 16,
              boxShadow: (loading || !images.length) ? 'none' : `0 6px 24px ${tmplInfo.color}33`,
              transition: 'all .2s',
            }}>
              {loading ? `⏳ ${step}` : `${tmplInfo.icon} Compose รูป`}
            </button>

            {error && <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, fontSize: 13, color: '#fca5a5', marginBottom: 16 }}>{error}</div>}

            {/* Result */}
            {result && !loading && (
              <div style={s.card}>
                <div style={s.sectionHead}>✅ ปกข่าวที่สร้างได้</div>
                <div style={{ ...s.body, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20 }}>
                  {result.layout && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 8 }}>🖼️ Layout Only</div>
                      <img src={result.layout.imageBase64} alt="" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', display: 'block' }} />
                      <button onClick={() => download(result.layout.imageBase64, `layout-${Date.now()}.jpg`, 'layout')} style={{ width: '100%', marginTop: 10, padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {downloaded.layout ? '✅ ดาวน์โหลดแล้ว' : '📥 Download'}
                      </button>
                    </div>
                  )}
                  {result.text && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#f472b6', marginBottom: 8 }}>✏️ พร้อมข้อความ (Ideogram)</div>
                      <img src={result.text.imageBase64} alt="" style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(249,24,128,0.3)', display: 'block' }} />
                      <button onClick={() => download(result.text.imageBase64, `text-${Date.now()}.jpg`, 'text')} style={{ width: '100%', marginTop: 10, padding: 10, borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#f91880,#7c3aed)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {downloaded.text ? '✅ ดาวน์โหลดแล้ว' : '📥 Download + ข้อความ'}
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ padding: '0 18px 18px' }}>
                  <button onClick={() => { setImages([]); setResult(null); setError(''); }} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    🔄 เริ่มใหม่
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
