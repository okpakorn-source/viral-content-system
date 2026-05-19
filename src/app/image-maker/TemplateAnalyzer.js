'use client';
import { useState, useCallback } from 'react';

function resizeImage(file, maxPx = 1200, quality = 0.85) {
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
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function TemplateAnalyzer({ onTemplateSaved }) {
  const [image, setImage]         = useState(null);
  const [name, setName]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [step, setStep]           = useState('');
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState('');
  const [saved, setSaved]         = useState(false);
  const [saving, setSaving]       = useState(false);
  const [autoSave, setAutoSave]   = useState(true);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setError(''); setResult(null); setSaved(false);
    try {
      const b64 = await resizeImage(file);
      setImage(b64);
      setName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '));
    } catch { setError('โหลดรูปไม่ได้'); }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const analyze = async () => {
    if (!image) { setError('กรุณาอัปโหลดรูป template ก่อน'); return; }
    setLoading(true); setError(''); setResult(null); setSaved(false);
    try {
      setStep('🤖 GPT-4o Vision กำลังวิเคราะห์โครงสร้าง...');
      const res = await fetch('/api/template-analyzer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: image, templateName: name || 'custom_template' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'วิเคราะห์ไม่สำเร็จ');
      setResult(data);
      setStep('');
    } catch (e) { setError('❌ ' + e.message); setStep(''); }
    finally { setLoading(false); }
  };

  const saveTemplate = async () => {
    if (!result || saving) return;
    setSaving(true); setError('');
    const tmpl = {
      ...result.template,
      id: result.templateId,
      previewImage: image,
      color: '#a3e635',
    };
    try {
      // 1. Save to API (primary)
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: tmpl }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      // 2. Save to localStorage (backward compat)
      try {
        const existing = JSON.parse(localStorage.getItem('customTemplates') || '[]');
        const filtered = existing.filter(t => t.id !== tmpl.id);
        localStorage.setItem('customTemplates', JSON.stringify([tmpl, ...filtered]));
      } catch {}

      onTemplateSaved?.(tmpl);
      setSaved(true);
    } catch (e) {
      setError('บันทึกไม่สำเร็จ: ' + e.message);
    } finally {
      setSaving(false);
    }
  };


  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#a3e635', marginBottom: 4 }}>
          🤖 Template Analyzer Agent
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          อัปโหลดรูป template จาก Facebook — GPT-4o Vision วิเคราะห์โครงสร้างให้อัตโนมัติ
        </div>
      </div>

      {/* ชื่อ template */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
          ชื่อ Template
        </label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="เช่น grid_circle_v2, big_face_news..."
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13,
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Upload Zone */}
      <label
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        style={{
          display: 'block', cursor: 'pointer', borderRadius: 12,
          border: image ? '2px solid #a3e635' : '2px dashed rgba(163,230,53,0.3)',
          background: image ? 'transparent' : 'rgba(163,230,53,0.03)',
          overflow: 'hidden', marginBottom: 12, position: 'relative',
          minHeight: image ? 'auto' : 160,
        }}
      >
        <input type="file" accept="image/*" style={{ display: 'none' }}
          onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; }} />
        {image ? (
          <>
            <img src={image} alt="template" style={{ width: '100%', display: 'block', borderRadius: 10 }} />
            <div style={{
              position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)',
              color: '#a3e635', fontSize: 10, padding: '3px 8px', borderRadius: 6, fontWeight: 700,
            }}>
              คลิกเพื่อเปลี่ยนรูป
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 160, gap: 10, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40 }}>📸</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a3e635' }}>อัปโหลดรูป Template</div>
            <div style={{ fontSize: 11 }}>ลากมาวาง หรือคลิกเพื่อเลือกรูป</div>
            <div style={{ fontSize: 10, color: 'rgba(163,230,53,0.5)' }}>รองรับ JPG · PNG · WebP</div>
          </div>
        )}
      </label>

      {/* Analyze Button */}
      <button
        onClick={analyze}
        disabled={!image || loading}
        style={{
          width: '100%', padding: '12px', borderRadius: 10, border: 'none',
          background: (!image || loading) ? 'var(--bg-elevated)' : 'linear-gradient(135deg,#a3e635,#16a34a)',
          color: (!image || loading) ? 'var(--text-muted)' : '#000',
          fontWeight: 800, fontSize: 14, cursor: (!image || loading) ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', marginBottom: 12,
          boxShadow: (!image || loading) ? 'none' : '0 4px 16px rgba(163,230,53,0.3)',
          transition: 'all .2s',
        }}
      >
        {loading ? '⏳ กำลังวิเคราะห์...' : '🔍 วิเคราะห์ Template'}
      </button>

      {/* Progress */}
      {loading && step && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(163,230,53,0.06)', borderRadius: 8, marginBottom: 12 }}>
          <div style={{ width: 16, height: 16, border: '3px solid #a3e635', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#a3e635', fontWeight: 700 }}>{step}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 12, color: '#fca5a5', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ border: '1px solid rgba(163,230,53,0.25)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: 'rgba(163,230,53,0.08)', borderBottom: '1px solid rgba(163,230,53,0.15)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#a3e635' }}>✅ วิเคราะห์เสร็จแล้ว</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              ใช้ {result.tokensUsed} tokens | GPT-4o Vision
            </div>
          </div>
          <div style={{ padding: 16 }}>
            {/* Template info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[
                ['📛 ชื่อ', result.template?.name],
                ['📐 Canvas', `${result.template?.canvas?.width}×${result.template?.canvas?.height}`],
                ['🖼️ Zone ทั้งหมด', `${result.template?.zones?.length} zones`],
                ['📸 ต้องการรูป', `${result.template?.totalPhotosNeeded} รูป`],
              ].map(([label, val]) => (
                <div key={label} style={{ padding: '8px 10px', background: 'var(--bg-primary)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Analysis text */}
            {result.template?.analysis && (
              <div style={{ padding: '10px 12px', background: 'rgba(99,102,241,0.08)', borderRadius: 8, fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: 12, borderLeft: '3px solid #6366f1' }}>
                "{result.template.analysis}"
              </div>
            )}

            {/* Zones list */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>ZONES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.template?.zones?.map((z, i) => (
                  <div key={z.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 6, fontSize: 11 }}>
                    <span style={{ background: '#a3e635', color: '#000', borderRadius: 4, padding: '1px 6px', fontWeight: 800, fontSize: 10, minWidth: 24, textAlign: 'center' }}>{i+1}</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)', minWidth: 60 }}>{z.id}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{z.role}</span>
                    <span style={{ marginLeft: 'auto', color: 'rgba(163,230,53,0.7)', fontSize: 10, fontFamily: 'monospace' }}>
                      {z.position.w}×{z.position.h} @ ({z.position.x},{z.position.y})
                    </span>
                    {z.effect !== 'none' && <span style={{ fontSize: 9, padding: '1px 5px', background: 'rgba(163,230,53,0.15)', color: '#a3e635', borderRadius: 4 }}>{z.effect}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Save button */}
            <button
              onClick={saveTemplate}
              disabled={saved || saving}
              style={{
                width: '100%', padding: '11px', borderRadius: 8, border: 'none',
                background: saved ? 'rgba(163,230,53,0.15)' : saving ? 'var(--bg-elevated)' : '#a3e635',
                color: saved ? '#a3e635' : saving ? 'var(--text-muted)' : '#000',
                fontWeight: 800, fontSize: 13, cursor: (saved || saving) ? 'default' : 'pointer',
                fontFamily: 'inherit', transition: 'all .2s',
              }}
            >
              {saved ? '✅ บันทึกแล้ว — ดูใน Template Library' : saving ? '⏳ กำลังบันทึก...' : '💾 บันทึก Template นี้'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
