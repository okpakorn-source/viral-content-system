'use client';
import { useState, useRef, useEffect } from 'react';

export default function CoverLabPage() {
  // Auto Cover state
  const [newsTitle, setNewsTitle] = useState('');
  const [content, setContent] = useState('');
  const [templateId, setTemplateId] = useState('auto');
  const [coverResult, setCoverResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState([]);

  // Cover Library state
  const [uploadCategory, setUploadCategory] = useState('ทั่วไป');
  const [uploading, setUploading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, results: [] });
  const [library, setLibrary] = useState([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const fileRef = useRef(null);

  // โหลด template จริง 6 แบบจากหน้าปกข่าว
  useEffect(() => {
    fetch('/api/auto-cover/templates')
      .then(r => r.json())
      .then(data => {
        if (data.success) setTemplates(data.templates);
      })
      .catch(() => {
        // Fallback ถ้า API ยังไม่พร้อม
        setTemplates([
          { id: 'auto', name: '🤖 Auto', desc: 'AI เลือกให้' },
        ]);
      });
  }, []);

  // Generate auto cover
  async function handleGenerate(isRegenerate = false) {
    if (!newsTitle && !content) return setError('ใส่หัวข้อหรือเนื้อหาข่าว');
    setLoading(true);
    setError('');
    if (!isRegenerate) setCoverResult(null);
    try {
      // ถ้า regenerate ให้สุ่ม template ใหม่
      let useTemplate = templateId;
      if (isRegenerate && templateId === 'auto') {
        const builtins = templates.filter(t => t.id !== 'auto');
        if (builtins.length > 0) {
          const prev = coverResult?.templateUsed || '';
          const others = builtins.filter(t => t.id !== prev);
          useTemplate = others.length > 0
            ? others[Math.floor(Math.random() * others.length)].id
            : builtins[0].id;
        }
      }

      const res = await fetch('/api/auto-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newsTitle, content, templateId: useTemplate, regenerate: isRegenerate }),
      });
      const data = await res.json();
      if (data.success) {
        setCoverResult(data);
      } else {
        setError(data.error || 'เกิดข้อผิดพลาด');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Batch upload cover examples
  async function handleBatchUpload() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    
    setUploading(true);
    const total = files.length;
    const results = [];
    setBatchProgress({ current: 0, total, results: [] });

    for (let i = 0; i < total; i++) {
      const file = files[i];
      setBatchProgress(prev => ({ ...prev, current: i + 1 }));
      
      try {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('title', file.name.replace(/\.[^.]+$/, ''));
        formData.append('category', uploadCategory);
        
        const res = await fetch('/api/cover-library', { method: 'POST', body: formData });
        const data = await res.json();
        results.push({ 
          name: file.name, 
          success: data.success, 
          layout: data.cover?.analysis?.layout_type || '',
          score: data.cover?.analysis?.quality_score || 0,
          error: data.error 
        });
      } catch (e) {
        results.push({ name: file.name, success: false, error: e.message });
      }
      
      setBatchProgress({ current: i + 1, total, results: [...results] });
    }

    setUploading(false);
    loadLibrary();
    if (fileRef.current) fileRef.current.value = '';
  }

  // Load library
  async function loadLibrary() {
    setLoadingLib(true);
    try {
      const res = await fetch('/api/cover-library?limit=20');
      const data = await res.json();
      if (data.success) setLibrary(data.covers || []);
    } catch {}
    setLoadingLib(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', color: '#e2e8f0', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, color: '#fbbf24' }}>
          🖼️ Cover Lab — ทดสอบระบบปกอัตโนมัติ
        </h1>
        <p style={{ color: '#94a3b8', marginBottom: 32 }}>ทดสอบ Auto Cover + คลังปกไวรัล</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Left: Auto Cover */}
          <div style={{ background: '#111827', borderRadius: 12, padding: 24, border: '1px solid #1e293b' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: '#60a5fa' }}>
              🚀 สร้างปกอัตโนมัติ
            </h2>

            <label style={labelStyle}>หัวข้อข่าว</label>
            <input
              value={newsTitle}
              onChange={e => setNewsTitle(e.target.value)}
              placeholder="เช่น: ตัก บงกช สร้างบ้าน 800 ไร่ให้ครอบครัว"
              style={inputStyle}
            />

            <label style={labelStyle}>เนื้อหาข่าว (optional)</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="วางเนื้อหาข่าวที่ต้องการทำปก..."
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />

            <label style={labelStyle}>Template ปก ({templates.length} แบบ)</label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              style={inputStyle}
            >
              <option value="auto">🤖 Auto — AI เลือก template ที่เหมาะสม</option>
              <optgroup label="── ปกข่าว (6 แบบ) ──">
                {templates.filter(t => t.id !== 'auto').map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.desc}{t.imageSlots ? ` (${t.imageSlots} รูป)` : ''}
                  </option>
                ))}
              </optgroup>
            </select>

            <button
              onClick={() => handleGenerate(false)}
              disabled={loading}
              style={{
                width: '100%', padding: '14px 24px', marginTop: 16,
                background: loading ? '#374151' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? '⏳ กำลังสร้างปก... (30-60 วินาที)' : '🖼️ สร้างปกอัตโนมัติ'}
            </button>

            {error && (
              <div style={{ marginTop: 12, padding: 12, background: '#7f1d1d', borderRadius: 8, color: '#fca5a5' }}>
                ❌ {error}
              </div>
            )}

            {coverResult && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span style={badgeStyle}>📐 {coverResult.templateUsed}</span>
                  <span style={badgeStyle}>🖼️ {coverResult.imageCount} ภาพ</span>
                  <span style={badgeStyle}>⭐ {coverResult.score}/10</span>
                  <span style={badgeStyle}>⏱️ {coverResult.elapsed}</span>
                </div>
                {coverResult.identity && (
                  <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
                    👤 {coverResult.identity.mainCharacter} | 💗 {coverResult.identity.emotion}
                  </p>
                )}
                <img
                  src={coverResult.base64}
                  alt="Auto generated cover"
                  style={{ width: '100%', borderRadius: 8, border: '2px solid #374151' }}
                />

                {/* 🔄 ปุ่มสร้างปกใหม่ */}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => handleGenerate(true)}
                    disabled={loading}
                    style={{
                      flex: 1, padding: '12px', background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                      color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
                      cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
                    }}
                  >
                    {loading ? '⏳ กำลังสร้างใหม่...' : '🔄 สร้างปกใหม่ (สลับ template)'}
                  </button>
                  <a
                    href={coverResult.base64}
                    download={`cover-${Date.now()}.jpg`}
                    style={{
                      padding: '12px 20px', background: '#065f46',
                      color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
                      textDecoration: 'none', display: 'flex', alignItems: 'center',
                    }}
                  >
                    💾 ดาวน์โหลด
                  </a>
                </div>

                {/* ข้อมูลคลัง */}
                {coverResult.cachedImages > 0 && (
                  <p style={{ color: '#6b7280', fontSize: 12, marginTop: 8 }}>
                    📦 บันทึก {coverResult.cachedImages} ภาพลงคลังแล้ว
                  </p>
                )}

                {/* 🖼️ Gallery: ภาพที่ AI ค้นพบ */}
                {coverResult.gallery?.length > 0 && (
                  <div style={{ marginTop: 16, padding: 12, background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b' }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#a78bfa', marginBottom: 10 }}>
                      🖼️ ภาพที่ AI ค้นพบ ({coverResult.gallery.length} ภาพ)
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {coverResult.gallery.map((img, i) => {
                        const roleBg = {
                          HERO_FACE: '#dc2626', HERO: '#ea580c', CONTEXT_SCENE: '#2563eb',
                          EVIDENCE: '#ca8a04', EMOTION: '#db2777', RELATIONSHIP: '#7c3aed', SUPPORT: '#475569'
                        }[img.role] || '#475569';
                        return (
                          <div key={i} style={{
                            position: 'relative', width: 80, height: 80,
                            borderRadius: 6, overflow: 'hidden', border: `2px solid ${roleBg}`,
                            background: '#1e293b',
                          }}>
                            {img.url && <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            <div style={{
                              position: 'absolute', bottom: 0, left: 0, right: 0,
                              background: 'rgba(0,0,0,0.8)', padding: '2px 4px',
                              fontSize: 9, color: '#fff', textAlign: 'center',
                            }}>
                              <span style={{
                                display: 'inline-block', background: roleBg, borderRadius: 3,
                                padding: '1px 4px', fontSize: 8, fontWeight: 700,
                              }}>{img.role?.replace('_', ' ')}</span>
                              {img.hasFace && <span style={{ marginLeft: 3 }}>👤{img.faceCount}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Cover Library */}
          <div style={{ background: '#111827', borderRadius: 12, padding: 24, border: '1px solid #1e293b' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: '#f59e0b' }}>
              📚 คลังปกไวรัล (AI เรียนรู้)
            </h2>

            <label style={labelStyle}>เลือกภาพปก (เลือกได้หลายภาพพร้อมกัน)</label>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: '2px dashed #374151', borderRadius: 12, padding: '24px 16px',
                textAlign: 'center', cursor: 'pointer', background: '#0f172a',
                transition: 'border-color 0.2s',
              }}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#f59e0b'; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = '#374151'; }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = '#374151';
                if (fileRef.current) {
                  fileRef.current.files = e.dataTransfer.files;
                  setBatchProgress(p => ({ ...p, total: e.dataTransfer.files.length }));
                }
              }}
            >
              <input
                type="file"
                ref={fileRef}
                accept="image/*"
                multiple
                onChange={e => setBatchProgress(p => ({ ...p, total: e.target.files?.length || 0 }))}
                style={{ display: 'none' }}
              />
              <p style={{ fontSize: 32, margin: 0 }}>📂</p>
              <p style={{ color: '#94a3b8', fontSize: 14, margin: '8px 0 0' }}>
                คลิกเลือก หรือลากไฟล์มาวาง
              </p>
              <p style={{ color: '#64748b', fontSize: 12 }}>
                รองรับ JPG, PNG — เลือกได้ 1-50 ภาพพร้อมกัน
              </p>
              {fileRef.current?.files?.length > 0 && !uploading && (
                <p style={{ color: '#fbbf24', fontSize: 14, fontWeight: 700, marginTop: 8 }}>
                  📎 เลือกแล้ว {fileRef.current.files.length} ภาพ
                </p>
              )}
            </div>

            <label style={labelStyle}>หมวดหมู่ (ใช้กับทุกภาพ)</label>
            <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} style={inputStyle}>
              {['ทั่วไป','ข่าวบันเทิง','ดราม่า','ข่าวเศร้า','การเมือง','สู้ชีวิต','อาชญากรรม','กีฬา'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <button
              onClick={handleBatchUpload}
              disabled={uploading}
              style={{
                width: '100%', padding: '14px 24px', marginTop: 16,
                background: uploading ? '#374151' : 'linear-gradient(135deg, #f59e0b, #ef4444)',
                color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700,
                cursor: uploading ? 'wait' : 'pointer',
              }}
            >
              {uploading 
                ? `⏳ AI วิเคราะห์ ${batchProgress.current}/${batchProgress.total}...` 
                : '📤 อัปโหลดทั้งหมด + AI วิเคราะห์'}
            </button>

            {/* Progress Bar */}
            {uploading && batchProgress.total > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ background: '#1e293b', borderRadius: 8, height: 24, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #f59e0b, #22c55e)',
                    borderRadius: 8,
                    transition: 'width 0.3s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: '#000',
                  }}>
                    {batchProgress.current}/{batchProgress.total}
                  </div>
                </div>
              </div>
            )}

            {/* Batch Results */}
            {batchProgress.results.length > 0 && (
              <div style={{ marginTop: 12, maxHeight: 200, overflowY: 'auto' }}>
                {batchProgress.results.map((r, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 10px', borderRadius: 6, marginBottom: 4, fontSize: 12,
                    background: r.success ? '#14532d' : '#7f1d1d',
                    color: r.success ? '#86efac' : '#fca5a5',
                  }}>
                    <span>{r.success ? '✅' : '❌'} {r.name?.substring(0, 30)}</span>
                    {r.success && <span style={{ color: '#94a3b8' }}>{r.layout} | ⭐{r.score}</span>}
                  </div>
                ))}
                <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>
                  ✅ สำเร็จ: {batchProgress.results.filter(r => r.success).length} | 
                  ❌ ล้มเหลว: {batchProgress.results.filter(r => !r.success).length} | 
                  📚 รวมในคลัง: {library.length + batchProgress.results.filter(r => r.success).length}
                </p>
              </div>
            )}

            <div style={{ marginTop: 24, borderTop: '1px solid #1e293b', paddingTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>ปกในคลัง ({library.length})</h3>
                <button
                  onClick={loadLibrary}
                  disabled={loadingLib}
                  style={{
                    padding: '6px 16px', background: '#1e293b', color: '#94a3b8',
                    border: '1px solid #374151', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  }}
                >
                  {loadingLib ? '...' : '🔄 โหลด'}
                </button>
              </div>

              {library.length === 0 && (
                <p style={{ color: '#64748b', fontSize: 14 }}>ยังไม่มีปกในคลัง — อัปโหลดปกตัวอย่างด้านบน</p>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {library.map(cover => (
                  <div key={cover.id} style={{
                    background: '#1e293b', borderRadius: 8, padding: 8, border: '1px solid #374151',
                  }}>
                    {cover.thumbnail && (
                      <img src={cover.thumbnail} alt={cover.title} style={{
                        width: '100%', borderRadius: 6, marginBottom: 6,
                      }} />
                    )}
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>
                      {cover.title?.substring(0, 40)}
                    </p>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <span style={{ ...badgeStyle, fontSize: 10, padding: '2px 6px' }}>{cover.category}</span>
                      <span style={{ ...badgeStyle, fontSize: 10, padding: '2px 6px' }}>⭐{cover.quality_score}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#94a3b8', marginTop: 12, marginBottom: 4 };
const inputStyle = {
  width: '100%', padding: '10px 12px', background: '#1e293b', color: '#e2e8f0',
  border: '1px solid #374151', borderRadius: 8, fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
};
const badgeStyle = {
  display: 'inline-block', padding: '4px 10px', background: '#1e293b',
  borderRadius: 6, fontSize: 12, color: '#94a3b8', border: '1px solid #374151',
};
