'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function CoverLabPage() {
  // === Input State ===
  const [newsTitle, setNewsTitle] = useState('');
  const [content, setContent] = useState('');
  const [manualCharacters, setManualCharacters] = useState('');
  const [manualKeywords, setManualKeywords] = useState('');
  const [templateId, setTemplateId] = useState('auto');
  const [templates, setTemplates] = useState([]);

  // === Pipeline State ===
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [coverResult, setCoverResult] = useState(null);
  const [selectedCoverIndex, setSelectedCoverIndex] = useState(0);
  const [sessionId, setSessionId] = useState(null);
  const [identity, setIdentity] = useState(null);

  // === Image Bank State ===
  const [imageBank, setImageBank] = useState([]);
  const [bankFilter, setBankFilter] = useState('all');
  const [bankLoading, setBankLoading] = useState(false);

  // === Cover Library State ===
  const [uploadCategory, setUploadCategory] = useState('ทั่วไป');
  const [uploading, setUploading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, results: [] });
  const [library, setLibrary] = useState([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const fileRef = useRef(null);

  // === Manual Slot Assignment + Crop State ===
  const [slotAssignment, setSlotAssignment] = useState({});
  const [slotCrops, setSlotCrops] = useState({});
  const [cropEditorState, setCropEditorState] = useState(null); // { slotId, imageUrl, zoom, panX, panY }
  const [templateSlots, setTemplateSlots] = useState([]);

  // โหลด templates
  useEffect(() => {
    fetch('/api/auto-cover/templates')
      .then(r => r.json())
      .then(data => { if (data.success) setTemplates(data.templates); })
      .catch(() => setTemplates([{ id: 'auto', name: '🤖 Auto', desc: 'AI เลือกให้' }]));
  }, []);

  // === Generate Cover ===
  async function handleGenerate(isRegenerate = false) {
    if (!newsTitle && !content) return setError('ใส่หัวข้อหรือเนื้อหาข่าว');
    setLoading(true);
    setError('');
    if (!isRegenerate) { setCoverResult(null); setImageBank([]); setIdentity(null); }
    try {
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
        body: JSON.stringify({
          newsTitle, content, templateId: useTemplate, regenerate: isRegenerate,
          manualCharacters: manualCharacters ? manualCharacters.split(',').map(s => s.trim()).filter(Boolean) : [],
          manualKeywords: manualKeywords ? manualKeywords.split(',').map(s => s.trim()).filter(Boolean) : [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCoverResult(data);
        // ★ Reset selected cover index when new covers arrive
        setSelectedCoverIndex(0);
        if (data.sessionId) {
          setSessionId(data.sessionId);
          loadImageBank(data.sessionId);
        }
        if (data.identity) setIdentity(data.identity);
        // Load template slots for manual assignment
        if (data.templateUsed) loadTemplateSlots(data.templateUsed);
      } else {
        setError(data.error || 'เกิดข้อผิดพลาด');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // === Load Image Bank ===
  async function loadImageBank(sid) {
    if (!sid) return;
    setBankLoading(true);
    try {
      const res = await fetch(`/api/auto-cover/image-bank?sessionId=${sid}`);
      const data = await res.json();
      if (data.success) setImageBank(data.images || []);
    } catch {}
    setBankLoading(false);
  }

  // === Toggle Image Selection ===
  async function toggleImageSelect(img) {
    const newSelected = !img.is_selected;
    // Optimistic UI update
    setImageBank(prev => prev.map(i => i.id === img.id ? { ...i, is_selected: newSelected } : i));
    try {
      await fetch('/api/auto-cover/image-bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: img.id, isSelected: newSelected }),
      });
    } catch {
      // Revert on error
      setImageBank(prev => prev.map(i => i.id === img.id ? { ...i, is_selected: !newSelected } : i));
    }
  }

  // === Regenerate from selected images ===
  async function handleRegenerateFromSelection() {
    const selected = imageBank.filter(i => i.is_selected);
    if (selected.length < 2) return setError('เลือกอย่างน้อย 2 ภาพ');
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auto-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsTitle, content, templateId,
          regenerate: true,
          selectedImageUrls: selected.map(i => i.image_url),
        }),
      });
      const data = await res.json();
      if (data.success) setCoverResult(data);
      else setError(data.error || 'เกิดข้อผิดพลาด');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // === Cover Library ===
  async function handleBatchUpload() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    const results = [];
    setBatchProgress({ current: 0, total: files.length, results: [] });
    for (let i = 0; i < files.length; i++) {
      setBatchProgress(prev => ({ ...prev, current: i + 1 }));
      try {
        const formData = new FormData();
        formData.append('image', files[i]);
        formData.append('title', files[i].name.replace(/\.[^.]+$/, ''));
        formData.append('category', uploadCategory);
        const res = await fetch('/api/cover-library', { method: 'POST', body: formData });
        const data = await res.json();
        results.push({ name: files[i].name, success: data.success, layout: data.cover?.analysis?.layout_type || '', score: data.cover?.analysis?.quality_score || 0, error: data.error });
      } catch (e) {
        results.push({ name: files[i].name, success: false, error: e.message });
      }
      setBatchProgress({ current: i + 1, total: files.length, results: [...results] });
    }
    setUploading(false);
    loadLibrary();
    if (fileRef.current) fileRef.current.value = '';
  }

  async function loadLibrary() {
    setLoadingLib(true);
    try {
      const res = await fetch('/api/cover-library?limit=20');
      const data = await res.json();
      if (data.success) setLibrary(data.covers || []);
    } catch {}
    setLoadingLib(false);
  }

  // === Filter Image Bank ===
  const filteredBank = imageBank.filter(img => {
    if (bankFilter === 'all') return true;
    if (bankFilter === 'selected') return img.is_selected;
    if (bankFilter === 'hero') return img.ai_role === 'HERO_FACE' || img.ai_role === 'HERO';
    if (bankFilter === 'context') return img.ai_role === 'CONTEXT_SCENE';
    if (bankFilter === 'emotion') return img.ai_role === 'EMOTION' || img.ai_role === 'FAMILY_SUPPORT';
    if (bankFilter === 'reject') return img.ai_role === 'REJECT' || img.ai_score < 4;
    return true;
  });

  const selectedCount = imageBank.filter(i => i.is_selected).length;

  // === Load Template Slots ===
  function loadTemplateSlots(tmplId) {
    fetch('/api/auto-cover/templates')
      .then(r => r.json())
      .then(d => {
        const tmpl = d.templates?.find(t => t.id === tmplId);
        if (tmpl?.slots) setTemplateSlots(tmpl.slots);
      })
      .catch(() => {});
  }

  // === Open Crop Editor ===
  function openCropEditor(slotId) {
    const imgUrl = slotAssignment[slotId];
    if (!imgUrl) return;
    const existing = slotCrops[slotId] || { zoom: 1.0, panX: 0, panY: 0 };
    setCropEditorState({ slotId, imageUrl: imgUrl, ...existing });
  }

  // === Handle Manual Generate ===
  async function handleManualGenerate() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auto-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsTitle, content, templateId,
          regenerate: true,
          manualSlots: slotAssignment,
          slotCrops,
        }),
      });
      const data = await res.json();
      if (data.success) setCoverResult(data);
      else setError(data.error || 'เกิดข้อผิดพลาด');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fbbf24', margin: 0 }}>
              🖼️ Cover Lab — สร้างปกอัตโนมัติ
            </h1>
            <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>AI วิเคราะห์ + ค้นหาภาพ + สร้างปกให้อัตโนมัติ</p>
          </div>
          <button onClick={() => setShowLibrary(!showLibrary)} style={{
            padding: '8px 16px', background: showLibrary ? '#f59e0b' : '#1e293b',
            color: showLibrary ? '#000' : '#94a3b8', border: '1px solid #374151',
            borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>
            📚 {showLibrary ? 'ซ่อนคลังปก' : 'คลังปกไวรัล'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: showLibrary ? '1fr 380px' : '1fr', gap: 24 }}>
          {/* ========== MAIN COLUMN ========== */}
          <div>
            {/* INPUT SECTION */}
            <div style={{ background: '#111827', borderRadius: 12, padding: 24, border: '1px solid #1e293b', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#60a5fa', marginBottom: 16 }}>📝 ใส่เนื้อหาข่าว</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>หัวข้อข่าว</label>
                  <input value={newsTitle} onChange={e => setNewsTitle(e.target.value)}
                    placeholder="เช่น: ตัก บงกช สร้างบ้าน 800 ไร่ให้ครอบครัว" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Template ({templates.length} แบบ)</label>
                  <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={inputStyle}>
                    <option value="auto">🤖 Auto — AI เลือกให้</option>
                    <optgroup label="── ปกข่าว ──">
                      {templates.filter(t => t.id !== 'auto').map(t => (
                        <option key={t.id} value={t.id}>{t.name} — {t.desc}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>
              <label style={labelStyle}>เนื้อหาข่าว (ช่วยให้ AI วิเคราะห์ได้ดีขึ้น)</label>
              <textarea value={content} onChange={e => setContent(e.target.value)}
                placeholder="วางเนื้อหาข่าวที่ต้องการทำปก..." rows={3}
                style={{ ...inputStyle, resize: 'vertical' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <div>
                  <label style={{ ...labelStyle, color: '#f59e0b' }}>👤 ตัวละครสำคัญ (คั่นด้วย ,)</label>
                  <input value={manualCharacters} onChange={e => setManualCharacters(e.target.value)}
                    placeholder="เช่น: เชียร์ ทีชัมพร, พิมประภา" style={inputStyle} />
                </div>
                <div>
                  <label style={{ ...labelStyle, color: '#34d399' }}>🏷️ คีย์เวิร์ดสำคัญ (คั่นด้วย ,)</label>
                  <input value={manualKeywords} onChange={e => setManualKeywords(e.target.value)}
                    placeholder="เช่น: ร้องไห้, ช่วยใช้หนี้, ครอบครัว" style={inputStyle} />
                </div>
              </div>
              <button onClick={() => handleGenerate(false)} disabled={loading} style={{
                width: '100%', padding: '14px', marginTop: 12,
                background: loading ? '#374151' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700,
                cursor: loading ? 'wait' : 'pointer',
              }}>
                {loading ? '⏳ กำลังสร้างปก... (30-120 วินาที)' : '🚀 สร้างปกอัตโนมัติ'}
              </button>
              {error && <div style={{ marginTop: 8, padding: 10, background: '#7f1d1d', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>❌ {error}</div>}
            </div>

            {/* KEYWORDS SECTION */}
            {identity && (
              <div style={{ background: '#111827', borderRadius: 12, padding: 20, border: '1px solid #1e293b', marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#a78bfa', marginBottom: 12 }}>🔍 Keywords ที่วิเคราะห์ได้</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {/* Characters */}
                  {identity.characters?.map((c, i) => (
                    <span key={i} style={{ ...tagStyle, background: '#1e3a5f', borderColor: '#3b82f6' }}>👤 {c}</span>
                  ))}
                  {/* Emotions */}
                  {identity.emotion && <span style={{ ...tagStyle, background: '#3b1f3f', borderColor: '#a855f7' }}>💗 {identity.emotion}</span>}
                  {identity.coverEmotion && <span style={{ ...tagStyle, background: '#3b1f3f', borderColor: '#a855f7' }}>🎭 {identity.coverEmotion}</span>}
                  {/* Location */}
                  {identity.location && <span style={{ ...tagStyle, background: '#1a3a2a', borderColor: '#22c55e' }}>📍 {identity.location}</span>}
                </div>
                {/* Keywords */}
                {identity.keywords?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: '#64748b', marginRight: 8 }}>🏷️ Keywords:</span>
                    {identity.keywords.map((k, i) => (
                      <span key={i} style={{ ...tagStyle, background: '#1e293b', borderColor: '#475569', fontSize: 11 }}>{k}</span>
                    ))}
                  </div>
                )}
                {/* Character Roles */}
                {identity.characterRoles?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: '#64748b', marginRight: 8 }}>👥 ตัวละคร:</span>
                    {identity.characterRoles.map((cr, i) => (
                      <span key={i} style={{ ...tagStyle, background: '#1f2937', borderColor: '#6b7280', fontSize: 11 }}>
                        {cr.name} ({cr.role}: {cr.relation})
                      </span>
                    ))}
                  </div>
                )}
                {/* Story */}
                {identity.story && <p style={{ fontSize: 13, color: '#94a3b8', margin: '8px 0 0' }}>📰 {identity.story}</p>}
                {/* Key Scenes */}
                {identity.keyScenes?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>🎬 ซีนที่ต้องการ: </span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{identity.keyScenes.join(' • ')}</span>
                  </div>
                )}
              </div>
            )}

            {/* COVER RESULT */}
            {coverResult && (
              <div style={{ background: '#111827', borderRadius: 12, padding: 20, border: '1px solid #1e293b', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#22c55e', margin: 0 }}>
                    🖼️ ปกที่สร้างได้ {coverResult.covers && coverResult.covers.length > 1 ? `(${coverResult.covers.length} แบบ)` : ''}
                  </h2>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={badgeStyle}>🖼️ {coverResult.imageCount} ภาพ</span>
                    <span style={badgeStyle}>⏱️ {coverResult.elapsed}</span>
                  </div>
                </div>

                {/* ★ Dual cover comparison */}
                {coverResult.covers && coverResult.covers.length > 1 ? (
                  <div>
                    <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                      {coverResult.covers.map((cover, idx) => (
                        <div key={idx} style={{
                          flex: '1 1 280px', maxWidth: 420, position: 'relative',
                          border: selectedCoverIndex === idx ? '3px solid #22c55e' : '2px solid #374151',
                          borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                          background: '#0f172a', transition: 'all 0.25s ease',
                          boxShadow: selectedCoverIndex === idx ? '0 0 20px rgba(34,197,94,0.25)' : 'none',
                        }} onClick={() => setSelectedCoverIndex(idx)}>
                          <img src={cover.base64} alt={`Cover ${idx + 1}`}
                            style={{ width: '100%', display: 'block', borderRadius: '10px 10px 0 0' }} />
                          {/* Info bar */}
                          <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ ...badgeStyle, fontSize: 10 }}>📐 {cover.templateUsed}</span>
                              <span style={{
                                ...badgeStyle, fontSize: 10,
                                background: cover.score >= 7 ? '#14532d' : '#7c2d12',
                                borderColor: cover.score >= 7 ? '#22c55e' : '#f97316',
                              }}>⭐ {cover.score}/10</span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setSelectedCoverIndex(idx); }} style={{
                              padding: '5px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                              background: selectedCoverIndex === idx ? '#22c55e' : '#374151',
                              color: selectedCoverIndex === idx ? '#000' : '#94a3b8',
                              transition: 'all 0.2s',
                            }}>
                              {selectedCoverIndex === idx ? '✅ เลือกปกนี้' : 'เลือก'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* ★ Single cover (backward compat) */
                  <div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, justifyContent: 'center' }}>
                      <span style={badgeStyle}>📐 {coverResult.templateUsed}</span>
                      <span style={{
                        ...badgeStyle,
                        background: coverResult.score >= 7 ? '#14532d' : '#7c2d12',
                        borderColor: coverResult.score >= 7 ? '#22c55e' : '#f97316',
                      }}>⭐ {coverResult.score}/10</span>
                    </div>
                    <img src={coverResult.base64} alt="Generated cover"
                      style={{ width: '100%', maxWidth: 600, borderRadius: 8, border: '2px solid #374151', display: 'block', margin: '0 auto' }} />
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                  <button onClick={() => handleGenerate(true)} disabled={loading} style={{
                    padding: '10px 20px', background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                    color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
                  }}>
                    🔄 สร้างใหม่ (หาภาพใหม่)
                  </button>
                  <button onClick={handleRegenerateFromSelection} disabled={loading || selectedCount < 2} style={{
                    padding: '10px 20px', background: selectedCount >= 2 ? 'linear-gradient(135deg, #8b5cf6, #3b82f6)' : '#374151',
                    color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    cursor: selectedCount >= 2 ? 'pointer' : 'not-allowed',
                  }}>
                    ✨ สร้างจากภาพที่เลือก ({selectedCount})
                  </button>
                  <a href={coverResult.covers && coverResult.covers.length > 1 ? coverResult.covers[selectedCoverIndex]?.base64 : coverResult.base64}
                    download={`cover-${Date.now()}.jpg`} style={{
                    padding: '10px 20px', background: '#065f46', color: '#fff', border: 'none',
                    borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none',
                  }}>
                    💾 ดาวน์โหลด{coverResult.covers && coverResult.covers.length > 1 ? ` (ปก ${selectedCoverIndex + 1})` : ''}
                  </a>
                </div>

                {coverResult.judgeComment && (
                  <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 8 }}>
                    🤖 AI: {coverResult.judgeComment}
                  </p>
                )}
              </div>
            )}

            {/* MANUAL SLOT ASSIGNMENT */}
            {coverResult && imageBank.length > 0 && templateSlots.length > 0 && (
              <div style={{ background: '#111827', borderRadius: 12, padding: 20, border: '1px solid #1e293b', marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#c084fc', marginBottom: 12 }}>🎛️ Manual Slot Assignment</h2>
                <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>เลือกภาพที่ต้องการใส่ในแต่ละ slot หรือปล่อย Auto ให้ AI เลือก</p>
                {templateSlots.map(slot => (
                  <div key={slot.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, padding: '8px 12px', background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', minWidth: 120 }}>
                      {slot.id} <span style={{ fontSize: 11, color: '#64748b' }}>({slot.role})</span>
                    </span>
                    <select
                      value={slotAssignment[slot.id] || ''}
                      onChange={e => setSlotAssignment(prev => ({ ...prev, [slot.id]: e.target.value }))}
                      style={{ ...inputStyle, flex: 1, fontSize: 12, padding: '6px 8px' }}
                    >
                      <option value="">🤖 Auto</option>
                      {imageBank.filter(i => i.is_selected || i.ai_score >= 4).map(img => (
                        <option key={img.id} value={img.image_url}>
                          {img.ai_role} (⭐{img.ai_score}) — {img.image_url?.substring(0, 40)}…
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => openCropEditor(slot.id)}
                      disabled={!slotAssignment[slot.id]}
                      style={{
                        padding: '6px 12px', background: slotAssignment[slot.id] ? '#7c3aed' : '#374151',
                        color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: slotAssignment[slot.id] ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
                      }}
                    >
                      ✂️ Crop
                    </button>
                    {slotCrops[slot.id] && (
                      <span style={{ fontSize: 10, color: '#22c55e', whiteSpace: 'nowrap' }}>✅ {slotCrops[slot.id].zoom.toFixed(1)}x</span>
                    )}
                  </div>
                ))}
                <button onClick={handleManualGenerate} disabled={loading} style={{
                  width: '100%', padding: '12px', marginTop: 8,
                  background: loading ? '#374151' : 'linear-gradient(135deg, #7c3aed, #ec4899)',
                  color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
                  cursor: loading ? 'wait' : 'pointer',
                }}>
                  {loading ? '⏳ กำลังสร้าง...' : '🖼️ สร้างปก Manual'}
                </button>
              </div>
            )}

            {/* IMAGE BANK */}
            {(imageBank.length > 0 || bankLoading) && (
              <div style={{ background: '#111827', borderRadius: 12, padding: 20, border: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b', margin: 0 }}>
                    📸 คลังภาพ (Image Bank) — {imageBank.length} ภาพ
                  </h2>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <span style={{ fontSize: 12, color: '#22c55e' }}>✅ {selectedCount} เลือก</span>
                    <span style={{ fontSize: 12, color: '#64748b', margin: '0 4px' }}>|</span>
                    <span style={{ fontSize: 12, color: '#ef4444' }}>❌ {imageBank.length - selectedCount} ไม่เลือก</span>
                  </div>
                </div>

                {/* Filter Tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
                  {[
                    { key: 'all', label: `ทั้งหมด (${imageBank.length})` },
                    { key: 'selected', label: `✅ เลือกแล้ว (${selectedCount})` },
                    { key: 'hero', label: '👤 Hero' },
                    { key: 'context', label: '🏞️ Context' },
                    { key: 'emotion', label: '💗 Emotion/Family' },
                    { key: 'reject', label: '❌ Reject' },
                  ].map(tab => (
                    <button key={tab.key} onClick={() => setBankFilter(tab.key)} style={{
                      padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      background: bankFilter === tab.key ? '#3b82f6' : '#1e293b',
                      color: bankFilter === tab.key ? '#fff' : '#94a3b8',
                      border: '1px solid', borderColor: bankFilter === tab.key ? '#3b82f6' : '#374151',
                      cursor: 'pointer',
                    }}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Image Grid */}
                {bankLoading ? (
                  <p style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>⏳ กำลังโหลดคลังภาพ...</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                    {filteredBank.map(img => {
                      const roleBg = ROLE_COLORS[img.ai_role] || '#475569';
                      return (
                        <div key={img.id} onClick={() => toggleImageSelect(img)} style={{
                          position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                          border: `3px solid ${img.is_selected ? '#22c55e' : '#374151'}`,
                          background: '#1e293b', transition: 'all 0.2s',
                          opacity: img.ai_role === 'REJECT' && !img.is_selected ? 0.5 : 1,
                          transform: img.is_selected ? 'scale(1.02)' : 'scale(1)',
                        }}>
                          {img.image_url ? (
                            <img src={img.image_url} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }}
                              onError={e => { e.target.style.display = 'none'; }} />
                          ) : img.thumbnail_base64 ? (
                            <img src={img.thumbnail_base64} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                          ) : (
                            <div style={{ width: '100%', height: 100, background: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>🖼️</div>
                          )}
                          {/* Selected badge */}
                          {img.is_selected && (
                            <div style={{ position: 'absolute', top: 4, left: 4, width: 22, height: 22, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff', fontWeight: 700 }}>✓</div>
                          )}
                          {/* Role + Score badge */}
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.85)', padding: '3px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ display: 'inline-block', background: roleBg, borderRadius: 3, padding: '1px 5px', fontSize: 9, fontWeight: 700, color: '#fff' }}>
                              {img.ai_role?.replace('_', ' ')}
                            </span>
                            <span style={{ fontSize: 10, color: '#fbbf24', fontWeight: 700 }}>⭐{img.ai_score}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Tip */}
                <p style={{ fontSize: 11, color: '#64748b', marginTop: 8, textAlign: 'center' }}>
                  💡 คลิกภาพเพื่อเลือก/ยกเลิก → กด &quot;สร้างจากภาพที่เลือก&quot; เพื่อสร้างปกใหม่
                </p>
              </div>
            )}
          </div>

          {/* ========== RIGHT SIDEBAR: Cover Library ========== */}
          {showLibrary && (
            <div style={{ background: '#111827', borderRadius: 12, padding: 20, border: '1px solid #1e293b', maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b', marginBottom: 16 }}>📚 คลังปกไวรัล</h2>

              <label style={labelStyle}>อัปโหลดปกตัวอย่าง</label>
              <div onClick={() => fileRef.current?.click()} style={{
                border: '2px dashed #374151', borderRadius: 8, padding: '16px', textAlign: 'center',
                cursor: 'pointer', background: '#0f172a', fontSize: 13,
              }}>
                <input type="file" ref={fileRef} accept="image/*" multiple
                  onChange={e => setBatchProgress(p => ({ ...p, total: e.target.files?.length || 0 }))}
                  style={{ display: 'none' }} />
                <p style={{ margin: 0, color: '#94a3b8' }}>📂 คลิกเลือกภาพ (1-50)</p>
                {fileRef.current?.files?.length > 0 && !uploading && (
                  <p style={{ color: '#fbbf24', fontWeight: 700, margin: '4px 0 0' }}>📎 {fileRef.current.files.length} ภาพ</p>
                )}
              </div>

              <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} style={{ ...inputStyle, marginTop: 8 }}>
                {['ทั่วไป','ข่าวบันเทิง','ดราม่า','ข่าวเศร้า','การเมือง','สู้ชีวิต','อาชญากรรม','กีฬา'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <button onClick={handleBatchUpload} disabled={uploading} style={{
                width: '100%', padding: '10px', marginTop: 8,
                background: uploading ? '#374151' : 'linear-gradient(135deg, #f59e0b, #ef4444)',
                color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>
                {uploading ? `⏳ ${batchProgress.current}/${batchProgress.total}...` : '📤 อัปโหลด + AI วิเคราะห์'}
              </button>

              {uploading && batchProgress.total > 0 && (
                <div style={{ marginTop: 8, background: '#1e293b', borderRadius: 8, height: 20, overflow: 'hidden' }}>
                  <div style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #f59e0b, #22c55e)', borderRadius: 8, transition: 'width 0.3s' }} />
                </div>
              )}

              {batchProgress.results.length > 0 && (
                <div style={{ marginTop: 8, maxHeight: 150, overflowY: 'auto', fontSize: 11 }}>
                  {batchProgress.results.map((r, i) => (
                    <div key={i} style={{ padding: '3px 6px', borderRadius: 4, marginBottom: 2, background: r.success ? '#14532d' : '#7f1d1d', color: r.success ? '#86efac' : '#fca5a5' }}>
                      {r.success ? '✅' : '❌'} {r.name?.substring(0, 25)} {r.success && `| ${r.layout} ⭐${r.score}`}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 16, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>ปกในคลัง ({library.length})</h3>
                  <button onClick={loadLibrary} disabled={loadingLib} style={{
                    padding: '4px 12px', background: '#1e293b', color: '#94a3b8',
                    border: '1px solid #374151', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                  }}>
                    {loadingLib ? '...' : '🔄'}
                  </button>
                </div>
                {library.length === 0 && <p style={{ color: '#64748b', fontSize: 12 }}>ยังไม่มีปก — อัปโหลดด้านบน</p>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {library.map(cover => (
                    <div key={cover.id} style={{ background: '#1e293b', borderRadius: 6, padding: 6, border: '1px solid #374151' }}>
                      {cover.thumbnail && <img src={cover.thumbnail} alt="" style={{ width: '100%', borderRadius: 4, marginBottom: 4 }} />}
                      <p style={{ fontSize: 10, fontWeight: 600, margin: 0 }}>{cover.title?.substring(0, 30)}</p>
                      <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                        <span style={{ fontSize: 9, background: '#374151', borderRadius: 3, padding: '1px 4px', color: '#94a3b8' }}>{cover.category}</span>
                        <span style={{ fontSize: 9, color: '#fbbf24' }}>⭐{cover.quality_score}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CropEditor Modal */}
      {cropEditorState && (
        <CropEditor
          state={cropEditorState}
          onApply={(slotId, cropData) => {
            setSlotCrops(prev => ({ ...prev, [slotId]: cropData }));
            setCropEditorState(null);
          }}
          onCancel={() => setCropEditorState(null)}
        />
      )}
    </div>
  );
}

// === CropEditor Component ===
function CropEditor({ state, onApply, onCancel }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [zoom, setZoom] = useState(state.zoom || 1.0);
  const [panX, setPanX] = useState(state.panX || 0);
  const [panY, setPanY] = useState(state.panY || 0);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; setImgLoaded(true); };
    img.onerror = () => setImgLoaded(false);
    img.src = state.imageUrl;
  }, [state.imageUrl]);

  // Render preview
  useEffect(() => {
    if (!imgLoaded || !canvasRef.current || !imgRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const img = imgRef.current;
    const cW = 400, cH = 400;
    ctx.clearRect(0, 0, cW, cH);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, cW, cH);

    const srcW = img.width / zoom;
    const srcH = img.height / zoom;
    const sx = Math.max(0, Math.min((img.width - srcW) / 2 - panX, img.width - srcW));
    const sy = Math.max(0, Math.min((img.height - srcH) / 2 - panY, img.height - srcH));
    ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, cW, cH);

    // Draw crosshair guides
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(cW / 3, 0); ctx.lineTo(cW / 3, cH);
    ctx.moveTo((cW * 2) / 3, 0); ctx.lineTo((cW * 2) / 3, cH);
    ctx.moveTo(0, cH / 3); ctx.lineTo(cW, cH / 3);
    ctx.moveTo(0, (cH * 2) / 3); ctx.lineTo(cW, (cH * 2) / 3);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [imgLoaded, zoom, panX, panY]);

  function handleMouseDown(e) {
    setDragging(true);
    setDragStart({ x: e.clientX - panX, y: e.clientY - panY });
  }
  function handleMouseMove(e) {
    if (!dragging) return;
    setPanX(e.clientX - dragStart.x);
    setPanY(e.clientY - dragStart.y);
  }
  function handleMouseUp() { setDragging(false); }
  function handleWheel(e) {
    e.preventDefault();
    setZoom(prev => Math.min(5, Math.max(1, prev + (e.deltaY < 0 ? 0.15 : -0.15))));
  }
  function handleReset() { setZoom(1.0); setPanX(0); setPanY(0); }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ background: '#1e293b', borderRadius: 16, padding: 24, maxWidth: 500, width: '90%', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
          ✂️ Crop & Zoom — <span style={{ color: '#c084fc' }}>{state.slotId}</span>
        </h3>

        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          style={{
            border: '2px solid #374151', borderRadius: 8, cursor: dragging ? 'grabbing' : 'grab',
            display: 'block', margin: '0 auto', maxWidth: '100%',
            background: '#0f172a',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />

        {!imgLoaded && (
          <p style={{ textAlign: 'center', color: '#64748b', marginTop: 8, fontSize: 13 }}>⏳ กำลังโหลดภาพ...</p>
        )}

        {/* Zoom Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
          <button onClick={() => setZoom(prev => Math.max(1, prev - 0.25))} style={cropBtnStyle}>➖</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24', minWidth: 50, textAlign: 'center' }}>
            {zoom.toFixed(1)}x
          </span>
          <button onClick={() => setZoom(prev => Math.min(5, prev + 0.25))} style={cropBtnStyle}>➕</button>
          <button onClick={handleReset} style={{ ...cropBtnStyle, background: '#374151', marginLeft: 8 }}>🔄 Reset</button>
        </div>

        {/* Zoom Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '0 20px' }}>
          <span style={{ fontSize: 10, color: '#64748b' }}>1x</span>
          <input
            type="range" min="1" max="5" step="0.1" value={zoom}
            onChange={e => setZoom(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: '#7c3aed' }}
          />
          <span style={{ fontSize: 10, color: '#64748b' }}>5x</span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '10px 24px', background: '#374151', color: '#94a3b8',
            border: '1px solid #475569', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            ✖️ Cancel
          </button>
          <button onClick={() => onApply(state.slotId, { zoom, panX, panY })} style={{
            padding: '10px 24px', background: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
            color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            ✅ Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// === CONSTANTS ===
const cropBtnStyle = {
  padding: '6px 14px', background: '#1e293b', color: '#e2e8f0',
  border: '1px solid #475569', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer',
};

const ROLE_COLORS = {
  HERO_FACE: '#dc2626', HERO: '#ea580c', CONTEXT_SCENE: '#2563eb',
  EVIDENCE: '#ca8a04', EMOTION: '#db2777', RELATIONSHIP: '#7c3aed',
  FAMILY_SUPPORT: '#059669', SUPPORT: '#475569', REJECT: '#374151',
};

const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#94a3b8', marginTop: 10, marginBottom: 4 };
const inputStyle = {
  width: '100%', padding: '10px 12px', background: '#1e293b', color: '#e2e8f0',
  border: '1px solid #374151', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
const badgeStyle = {
  display: 'inline-block', padding: '3px 8px', background: '#1e293b',
  borderRadius: 6, fontSize: 11, color: '#94a3b8', border: '1px solid #374151',
};
const tagStyle = {
  display: 'inline-block', padding: '3px 10px', borderRadius: 20,
  fontSize: 12, fontWeight: 600, color: '#e2e8f0', border: '1px solid',
  marginBottom: 4,
};
