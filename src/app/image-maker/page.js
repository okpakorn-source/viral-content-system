'use client';
import { useState, useCallback, useEffect } from 'react';
import Header from '@/components/layout/Header';
import TemplateDiagram from './TemplateDiagram';

const TEMPLATES_META = {
  accident:      { label: 'อุบัติเหตุ / ภัยพิบัติ', icon: '🚨', color: '#22c55e' },
  crime:         { label: 'อาชญากรรม',              icon: '🔴', color: '#ef4444' },
  politics:      { label: 'การเมือง',                icon: '🏛️', color: '#3b82f6' },
  economy:       { label: 'เศรษฐกิจ / ธุรกิจ',     icon: '💰', color: '#f59e0b' },
  entertainment: { label: 'บันเทิง / ไลฟ์สไตล์',   icon: '🎬', color: '#ec4899' },
};

const DEFAULT_PROMPTS = {
  analyze: `คุณคือผู้เชี่ยวชาญออกแบบปกข่าวไทย วิเคราะห์รูปที่ได้รับและกำหนดว่ารูปไหนเป็น role อะไร (main_face, context, event, memorial) ตอบเป็น JSON`,
  text: `Add bold Thai news headline text at the bottom of this news thumbnail. Style: white bold text with dark shadow, modern Thai news style. Position: bottom 20% centered. Add semi-transparent dark bar behind text. Do NOT change the main photo composition.`,
};

function resizeImage(file, maxPx = 800, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ImageMakerPage() {
  const [images, setImages]         = useState([]);
  const [newsTitle, setNewsTitle]   = useState('');
  const [newsType, setNewsType]     = useState('accident');
  const [withText, setWithText]     = useState(true);
  const [loading, setLoading]       = useState(false);
  const [step, setStep]             = useState('');
  const [error, setError]           = useState('');
  const [result, setResult]         = useState(null);
  const [layoutInfo, setLayoutInfo] = useState(null);
  const [downloaded, setDownloaded] = useState({});
  const [showPrompts, setShowPrompts] = useState(false);
  const [prompts, setPrompts]       = useState(DEFAULT_PROMPTS);
  const [promptsSaved, setPromptsSaved] = useState(false);

  // Load saved prompts from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('imageMakerPrompts');
      if (saved) setPrompts(JSON.parse(saved));
    } catch {}
  }, []);

  const savePrompts = () => {
    localStorage.setItem('imageMakerPrompts', JSON.stringify(prompts));
    setPromptsSaved(true);
    setTimeout(() => setPromptsSaved(false), 2000);
  };
  const resetPrompts = () => {
    setPrompts(DEFAULT_PROMPTS);
    localStorage.removeItem('imageMakerPrompts');
  };

  const handleFiles = useCallback(async (files) => {
    const remaining = 5 - images.length;
    const toAdd = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
    for (const file of toAdd) {
      try {
        const b64 = await resizeImage(file, 800, 0.72);
        setImages(prev => [...prev, b64]);
      } catch (e) { console.warn('resize failed:', e); }
    }
  }, [images.length]);

  const removeImage = (idx) => setImages(prev => prev.filter((_, i) => i !== idx));

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleCompose = async () => {
    if (images.length === 0) { setError('กรุณาอัปโหลดรูปอย่างน้อย 1 รูป'); return; }
    setError(''); setResult(null); setLayoutInfo(null); setLoading(true); setDownloaded({});
    try {
      setStep('🧠 AI วิเคราะห์รูปและกำหนด layout...');
      const analyzeRes = await fetch('/api/image-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, newsTitle, newsType, customPrompt: prompts.analyze }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeData.success) throw new Error('วิเคราะห์ layout ล้มเหลว: ' + analyzeData.error);
      setLayoutInfo(analyzeData.layout);

      setStep('🖼️ กำลัง composite รูปด้วย Sharp.js...');
      const composeRes = await fetch('/api/image-compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images,
          layout: analyzeData.layout,
          newsTitle,
          generateText: withText,
          customTextPrompt: prompts.text,
        }),
      });
      const composeData = await composeRes.json();
      if (!composeData.success) throw new Error('สร้างรูปล้มเหลว: ' + composeData.error);
      setResult(composeData.versions);
      setStep('');
      if (composeData.textError) setError('⚠️ Text version: ' + composeData.textError);
    } catch (e) {
      setError('❌ ' + e.message);
      setStep('');
    } finally {
      setLoading(false);
    }
  };

  const download = (b64, filename, key) => {
    const a = document.createElement('a'); a.href = b64; a.download = filename; a.click();
    setDownloaded(p => ({ ...p, [key]: true }));
    setTimeout(() => setDownloaded(p => ({ ...p, [key]: false })), 2500);
  };

  const reset = () => { setImages([]); setResult(null); setLayoutInfo(null); setError(''); setStep(''); };
  const tmpl = TEMPLATES_META[newsType] || TEMPLATES_META.accident;

  return (
    <>
      <Header title="🖼️ Image Maker" subtitle="สร้างปกข่าว 1080×1080 ด้วย AI — อัปโหลดรูป เลือก Template กด Compose" />
      <div className="page-content" style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* ── Config Card ── */}
        <div className="card" style={{ marginBottom: 14 }}>

          {/* Headline */}
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label className="form-label">📰 หัวข้อข่าว <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(สำหรับ text overlay)</span></label>
            <input className="form-input" value={newsTitle} onChange={e => setNewsTitle(e.target.value)}
              placeholder="เช่น นักศึกษาแพทย์เสียชีวิตจากอุบัติเหตุรถตู้..." style={{ fontSize:14 }} />
          </div>

          {/* Text Toggle */}
          <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center' }}>
            <span style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)' }}>✏️ Text overlay:</span>
            {[{v:true,l:'✅ มีข้อความ (Ideogram)'},{v:false,l:'🖼️ Layout only'}].map(opt => (
              <button key={String(opt.v)} onClick={() => setWithText(opt.v)} style={{
                padding:'5px 14px', borderRadius:20, fontSize:11, fontWeight:700,
                cursor:'pointer', fontFamily:'inherit',
                background: withText===opt.v ? 'var(--accent)' : 'var(--bg-primary)',
                color: withText===opt.v ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${withText===opt.v ? 'var(--accent)' : 'var(--border)'}`,
              }}>{opt.l}</button>
            ))}
            {withText && !newsTitle && <span style={{fontSize:10,color:'#fbbf24'}}>⚠️ ใส่หัวข้อด้วยเพื่อให้ Ideogram มีข้อความ</span>}
          </div>

          {/* ── Visual Template Selector ── */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', marginBottom:10 }}>🎨 เลือก Template (เห็นตัวอย่าง Layout)</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8 }}>
              {Object.entries(TEMPLATES_META).map(([k, v]) => (
                <TemplateDiagram key={k} templateId={k} selected={newsType===k}
                  onClick={() => setNewsType(k)} label={v.label} icon={v.icon} />
              ))}
            </div>
          </div>

          {/* ── Image Upload ── */}
          <div>
            <label className="form-label">📸 รูปประกอบข่าว <span style={{fontWeight:400,color:'var(--text-muted)'}}>1-5 รูป — AI จัดวางให้อัตโนมัติ</span></label>
            <div onDrop={handleDrop} onDragOver={e => e.preventDefault()} style={{
              marginTop:8, padding:14, border:'2px dashed rgba(255,255,255,0.13)',
              borderRadius:'var(--radius-md)', background:'rgba(255,255,255,0.02)', minHeight:90,
            }}>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-start' }}>
                {images.map((src, i) => (
                  <div key={i} style={{ position:'relative', width:88, height:88, borderRadius:8, overflow:'hidden', border:`2px solid ${tmpl.color}55`, flexShrink:0 }}>
                    <img src={src} alt={`img${i}`} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                    <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'rgba(0,0,0,0.6)', fontSize:9, textAlign:'center', color:'#fff', padding:'2px 0' }}>รูป {i+1}</div>
                    <button onClick={() => removeImage(i)} style={{ position:'absolute', top:3, right:3, width:20, height:20, borderRadius:'50%', background:'rgba(0,0,0,0.8)', border:'none', color:'#fff', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
                  </div>
                ))}
                {images.length < 5 && (
                  <label style={{ width:88, height:88, borderRadius:8, border:'1px dashed rgba(255,255,255,0.18)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--text-muted)', gap:4, flexShrink:0 }}>
                    <span style={{ fontSize:26 }}>+</span>
                    <span style={{ fontSize:10 }}>เพิ่มรูป</span>
                    <input type="file" accept="image/*" multiple style={{ display:'none' }}
                      onChange={e => { handleFiles(e.target.files); e.target.value=''; }} />
                  </label>
                )}
                {images.length === 0 && <div style={{ color:'var(--text-muted)', fontSize:12, padding:'18px 8px' }}>ลากรูปมาวาง หรือคลิก + เพื่อเลือกรูป (JPG/PNG/WebP)</div>}
              </div>
            </div>
          </div>

          {/* ── Action Buttons ── */}
          <div style={{ display:'flex', gap:10, marginTop:14, alignItems:'center' }}>
            <button onClick={handleCompose} disabled={loading || images.length===0} style={{
              padding:'11px 28px', borderRadius:'var(--radius-md)', border:'none', fontFamily:'inherit',
              background: loading||images.length===0 ? 'var(--bg-elevated)' : `linear-gradient(135deg,${tmpl.color},#7c3aed)`,
              color:'#fff', fontWeight:800, fontSize:14, cursor: loading||images.length===0 ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : `0 4px 18px ${tmpl.color}44`,
            }}>
              {loading ? '⏳ กำลังสร้าง...' : `${tmpl.icon} Compose รูป`}
            </button>
            {(result||error) && (
              <button onClick={reset} style={{ padding:'9px 18px', borderRadius:'var(--radius-md)', border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                🔄 เริ่มใหม่
              </button>
            )}
          </div>
        </div>

        {/* ── Progress ── */}
        {loading && step && (
          <div className="card" style={{ marginBottom:14, display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:20, height:20, border:'3px solid var(--accent)', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite', flexShrink:0 }} />
            <span style={{ fontSize:13, fontWeight:700, color:'var(--accent-light)' }}>{step}</span>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div style={{ padding:14, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:'var(--radius-md)', marginBottom:14, fontSize:13, color:'#fca5a5' }}>
            {error}
          </div>
        )}

        {/* ── Layout Info ── */}
        {layoutInfo && (
          <div style={{ padding:'10px 14px', background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:'var(--radius-md)', marginBottom:12, fontSize:11 }}>
            <span style={{ fontWeight:800, color:'#818cf8' }}>🧠 AI Layout: </span>
            <span style={{ color:'var(--text-secondary)' }}>
              Template <strong>{layoutInfo.templateName}</strong> • Confidence {layoutInfo.confidence}%{layoutInfo.hasMemorial ? ' • 🕊️ มีรูป memorial' : ''}
            </span>
            {layoutInfo.reasoning && <div style={{ marginTop:4, color:'var(--text-muted)', fontStyle:'italic' }}>"{layoutInfo.reasoning}"</div>}
          </div>
        )}

        {/* ── Result ── */}
        {result && !loading && (
          <div className="card" style={{ marginBottom:14 }}>
            <div style={{ fontSize:15, fontWeight:800, marginBottom:16 }}>✅ ปกข่าวที่สร้างได้</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:20 }}>
              {result.layout && (
                <div>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--text-muted)', marginBottom:8 }}>🖼️ Layout Only (ไม่มีข้อความ)</div>
                  <div style={{ borderRadius:12, overflow:'hidden', border:'1px solid var(--border)', aspectRatio:'1/1', background:'#000' }}>
                    <img src={result.layout.imageBase64} alt="layout" style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} />
                  </div>
                  <button onClick={() => download(result.layout.imageBase64,`news-layout-${Date.now()}.jpg`,'layout')} style={{
                    width:'100%', marginTop:10, padding:10, borderRadius:8,
                    border:'1px solid var(--border)', background:'var(--bg-elevated)',
                    color:'var(--text-secondary)', fontWeight:700, fontSize:12, cursor:'pointer', fontFamily:'inherit',
                  }}>{downloaded.layout ? '✅ ดาวน์โหลดแล้ว' : '📥 Download Layout'}</button>
                </div>
              )}
              {result.text && (
                <div>
                  <div style={{ fontSize:11, fontWeight:800, color:'#f472b6', marginBottom:8 }}>✏️ พร้อมข้อความ (Ideogram)</div>
                  <div style={{ borderRadius:12, overflow:'hidden', border:'1px solid rgba(249,24,128,0.3)', aspectRatio:'1/1', background:'#000' }}>
                    <img src={result.text.imageBase64} alt="text" style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} />
                  </div>
                  <button onClick={() => download(result.text.imageBase64,`news-text-${Date.now()}.jpg`,'text')} style={{
                    width:'100%', marginTop:10, padding:10, borderRadius:8,
                    border:'none', background:'linear-gradient(135deg,#f91880,#7c3aed)',
                    color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer', fontFamily:'inherit',
                  }}>{downloaded.text ? '✅ ดาวน์โหลดแล้ว' : '📥 Download พร้อมข้อความ'}</button>
                </div>
              )}
              {!result.text && withText && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.02)', border:'1px dashed rgba(255,255,255,0.1)', borderRadius:12, minHeight:200 }}>
                  <div style={{ textAlign:'center', color:'var(--text-muted)', fontSize:12, padding:20 }}>
                    <div style={{ fontSize:32, marginBottom:8 }}>⚠️</div>
                    <div>Text version ไม่สำเร็จ</div>
                    <div style={{ fontSize:10, marginTop:4 }}>ตรวจสอบ IDEOGRAM_API_KEY</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Prompt Manager ── */}
        <div className="card">
          <button onClick={() => setShowPrompts(p => !p)} style={{
            width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
            background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', padding:0,
          }}>
            <div style={{ fontSize:13, fontWeight:800, color:'var(--text-primary)' }}>
              🔧 Prompt Manager <span style={{ fontSize:10, fontWeight:400, color:'var(--text-muted)' }}>(ปรับแต่ง AI prompt สำหรับการสร้างรูป)</span>
            </div>
            <span style={{ color:'var(--text-muted)', fontSize:14 }}>{showPrompts ? '▲' : '▼'}</span>
          </button>

          {showPrompts && (
            <div style={{ marginTop:16 }}>

              {/* Analyze Prompt */}
              <div className="form-group" style={{ marginBottom:14 }}>
                <label className="form-label" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span>🧠 Prompt วิเคราะห์รูป (GPT-4o Vision)</span>
                  <span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:400 }}>ส่งผลต่อการจัด layout zone</span>
                </label>
                <textarea
                  value={prompts.analyze}
                  onChange={e => setPrompts(p => ({...p, analyze: e.target.value}))}
                  rows={4}
                  style={{ width:'100%', background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:8, padding:10, color:'var(--text-primary)', fontSize:12, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }}
                />
              </div>

              {/* Text Prompt */}
              <div className="form-group" style={{ marginBottom:14 }}>
                <label className="form-label" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span>✏️ Prompt ใส่ข้อความ (Ideogram)</span>
                  <span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:400 }}>ส่งผลต่อสไตล์ข้อความบนรูป</span>
                </label>
                <textarea
                  value={prompts.text}
                  onChange={e => setPrompts(p => ({...p, text: e.target.value}))}
                  rows={4}
                  style={{ width:'100%', background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:8, padding:10, color:'var(--text-primary)', fontSize:12, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }}
                />
              </div>

              <div style={{ display:'flex', gap:8 }}>
                <button onClick={savePrompts} style={{
                  padding:'8px 18px', borderRadius:8, border:'none',
                  background:'var(--success)', color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer', fontFamily:'inherit',
                }}>{promptsSaved ? '✅ บันทึกแล้ว' : '💾 บันทึก Prompt'}</button>
                <button onClick={resetPrompts} style={{
                  padding:'8px 14px', borderRadius:8, border:'1px solid var(--border)',
                  background:'transparent', color:'var(--text-muted)', fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit',
                }}>↩️ Reset เป็นค่าเริ่มต้น</button>
                <div style={{ fontSize:10, color:'var(--text-muted)', alignSelf:'center', marginLeft:4 }}>
                  บันทึกใน localStorage — ใช้เฉพาะหน้านี้เท่านั้น
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
