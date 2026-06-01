'use client';
import Header from '@/components/layout/Header';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const CATEGORY_LABELS = {
  pipeline: { label: '🔄 Pipeline', color: '#22c55e' },
  preset: { label: '🎨 Preset', color: '#f59e0b' },
  utility: { label: '🔧 Utility', color: '#3b82f6' },
};

function PromptsPageInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'extraction';
  const [selected, setSelected] = useState(initialTab);
  const [prompts, setPrompts] = useState({});
  const [promptText, setPromptText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [presets, setPresets] = useState([]);
  const [editPreset, setEditPreset] = useState(null);

  useEffect(() => {
    fetch('/api/prompts').then(r => r.json()).then(d => {
      if (d.success) {
        setPrompts(d.data);
        if (d.data[initialTab]) setPromptText(d.data[initialTab].prompt || '');
        if (d.analysisPresets) setPresets(d.analysisPresets);
      }
      setLoading(false);
    });
  }, []);

  const handleSelect = (key) => {
    setSelected(key);
    setPromptText(prompts[key]?.prompt || '');
    setMsg('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: selected, prompt: promptText }),
      });
      const d = await res.json();
      if (d.success) {
        setMsg('✅ บันทึกแล้ว');
        setPrompts(prev => ({ ...prev, [selected]: { ...prev[selected], prompt: promptText } }));
      } else setMsg('❌ ' + d.error);
    } catch { setMsg('❌ เกิดข้อผิดพลาด'); }
    setSaving(false);
    setTimeout(() => setMsg(''), 3000);
  };

  const handleReset = async () => {
    if (!confirm('คืนค่า prompt นี้เป็นค่าเริ่มต้น?')) return;
    const res = await fetch('/api/prompts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: selected }),
    });
    const d = await res.json();
    if (d.success && d.data) {
      setPrompts(prev => ({ ...prev, [selected]: d.data }));
      setPromptText(d.data.prompt || '');
      setMsg('✅ คืนค่าแล้ว');
      setTimeout(() => setMsg(''), 3000);
    }
  };

  const handleSavePreset = async () => {
    if (!editPreset) return;
    const res = await fetch('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'analysisPreset', preset: editPreset }),
    });
    const d = await res.json();
    if (d.success) { setPresets(d.analysisPresets); setEditPreset(null); setMsg('✅ บันทึกแล้ว'); }
    setTimeout(() => setMsg(''), 3000);
  };

  const promptKeys = Object.keys(prompts);
  const currentMeta = prompts[selected] || {};

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>กำลังโหลด...</div>;

  return (
    <div>
      <Header title="จัดการ AI Prompts" subtitle="แก้ไข prompt ทุกตัวในระบบ — พร้อมกำกับว่าส่งผลกับอะไร" />
      <div style={{ padding: '0 24px 24px', maxWidth: 1200, margin: '0 auto' }}>

        {msg && (
          <div style={{ background: msg.includes('✅') ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, color: msg.includes('✅') ? '#22c55e' : '#ef4444' }}>
            {msg}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
          {/* Sidebar - Prompt List */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
              📋 Standard Prompts ({promptKeys.length})
            </div>
            {promptKeys.map(key => {
              const meta = prompts[key];
              const cat = CATEGORY_LABELS[meta.category] || CATEGORY_LABELS.pipeline;
              return (
                <button key={key} onClick={() => handleSelect(key)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                    background: selected === key ? 'var(--accent-glow)' : 'var(--bg-secondary)',
                    border: selected === key ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: 8, marginBottom: 6, cursor: 'pointer', fontFamily: 'inherit',
                    color: 'var(--text-primary)',
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
                    {meta.label || key}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                    {meta.description || ''}
                  </div>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 10, fontSize: 9,
                    background: `${cat.color}20`, color: cat.color, fontWeight: 600,
                  }}>
                    {cat.label}
                  </span>
                </button>
              );
            })}

            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginTop: 20, marginBottom: 8, textTransform: 'uppercase' }}>
              🎨 Analysis Presets ({presets.length})
            </div>
            {presets.map(p => (
              <button key={p.id} onClick={() => setEditPreset({ ...p })}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                  background: editPreset?.id === p.id ? 'rgba(249,24,128,0.1)' : 'var(--bg-secondary)',
                  border: editPreset?.id === p.id ? '1px solid #f91880' : '1px solid var(--border)',
                  borderRadius: 8, marginBottom: 6, cursor: 'pointer', fontFamily: 'inherit',
                  color: 'var(--text-primary)',
                }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.desc}</div>
              </button>
            ))}
          </div>

          {/* Main Editor */}
          <div>
            {!editPreset ? (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{currentMeta.label || selected}</h3>
                    {currentMeta.description && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{currentMeta.description}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={handleReset} style={{ padding: '6px 12px', fontSize: 11, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      🔄 คืนค่า
                    </button>
                    <button onClick={handleSave} disabled={saving} style={{ padding: '6px 16px', fontSize: 11, background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {saving ? '⏳...' : '💾 บันทึก'}
                    </button>
                  </div>
                </div>

                {/* Metadata badges */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {currentMeta.usedIn?.map((u, i) => (
                    <span key={i} style={{ padding: '2px 8px', borderRadius: 10, fontSize: 9, background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 600 }}>
                      📍 {u}
                    </span>
                  ))}
                  {currentMeta.affectsAPI && (
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 9, background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontWeight: 600 }}>
                      🔗 {currentMeta.affectsAPI}
                    </span>
                  )}
                </div>

                {/* Editor */}
                <textarea
                  value={promptText}
                  onChange={e => setPromptText(e.target.value)}
                  style={{
                    width: '100%', minHeight: 500, padding: 14, borderRadius: 8,
                    background: 'var(--bg-primary)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 12,
                    lineHeight: 1.6, resize: 'vertical',
                  }}
                />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  📐 {promptText.length} ตัวอักษร | ตัวแปร: {'{title}'} {'{content}'} {'{custom_instruction}'} {'{source_platform}'} {'{analysis_context}'}
                </div>
              </div>
            ) : (
              /* Preset Editor */
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>✏️ แก้ไข Preset: {editPreset.name}</h3>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setEditPreset(null)} style={{ padding: '6px 12px', fontSize: 11, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      ❌ ยกเลิก
                    </button>
                    <button onClick={handleSavePreset} style={{ padding: '6px 16px', fontSize: 11, background: '#f91880', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      💾 บันทึก Preset
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {editPreset.usedIn?.map((u, i) => (
                    <span key={i} style={{ padding: '2px 8px', borderRadius: 10, fontSize: 9, background: 'rgba(249,24,128,0.15)', color: '#f91880', fontWeight: 600 }}>
                      📍 {u}
                    </span>
                  ))}
                  {editPreset.affectsAPI && (
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 9, background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontWeight: 600 }}>
                      🔗 {editPreset.affectsAPI}
                    </span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>ชื่อ</label>
                    <input value={editPreset.name} onChange={e => setEditPreset({ ...editPreset, name: e.target.value })}
                      className="form-input" style={{ width: '100%', marginTop: 4 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>คำอธิบาย</label>
                    <input value={editPreset.desc} onChange={e => setEditPreset({ ...editPreset, desc: e.target.value })}
                      className="form-input" style={{ width: '100%', marginTop: 4 }} />
                  </div>
                </div>

                <textarea
                  value={editPreset.prompt || ''}
                  onChange={e => setEditPreset({ ...editPreset, prompt: e.target.value })}
                  style={{
                    width: '100%', minHeight: 500, padding: 14, borderRadius: 8,
                    background: 'var(--bg-primary)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 12,
                    lineHeight: 1.6, resize: 'vertical',
                  }}
                />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  📐 {(editPreset.prompt || '').length} ตัวอักษร
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PromptsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>กำลังโหลด...</div>}>
      <PromptsPageInner />
    </Suspense>
  );
}
