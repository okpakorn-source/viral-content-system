'use client';
import Header from '@/components/layout/Header';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const PROMPT_LABELS = {
  extraction: { name: '📥 สกัดเนื้อข่าว', desc: 'AI ตัวที่ 1: แยกเนื้อข่าวจริงจาก raw text' },
  angle: { name: '🎯 มุมมองไวรัล', desc: 'สร้าง Headlines, Hooks, Comment Baits' },
  article: { name: '✍️ เขียนบทความ', desc: 'เขียนบทความไวรัลจากข้อมูลที่วิเคราะห์แล้ว' },
};

function PromptsPageInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'extraction';
  const [selected, setSelected] = useState(initialTab);
  const [prompts, setPrompts] = useState({});
  const [system, setSystem] = useState('');
  const [user, setUser] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Analysis Presets
  const [presets, setPresets] = useState([]);
  const [editPreset, setEditPreset] = useState(null);

  // Load
  useEffect(() => {
    fetch('/api/prompts').then(r => r.json()).then(d => {
      if (d.success) {
        setPrompts(d.data);
        if (initialTab !== 'analysis') {
          setSystem(d.data[initialTab]?.system || '');
          setUser(d.data[initialTab]?.user || '');
        }
      }
      if (d.analysisPresets) setPresets(d.analysisPresets);
      if (initialTab === 'analysis' && d.analysisPresets?.length > 0) {
        setEditPreset(d.analysisPresets[0]);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Switch tab
  const handleSelect = (key) => {
    setSelected(key);
    if (key === 'analysis') {
      if (presets.length > 0 && !editPreset) setEditPreset(presets[0]);
    } else {
      setSystem(prompts[key]?.system || '');
      setUser(prompts[key]?.user || '');
    }
    setMsg('');
  };

  // Save standard prompt
  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: selected, system, user }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg('✅ บันทึกแล้ว');
        setPrompts(prev => ({ ...prev, [selected]: { system, user } }));
      } else {
        setMsg('❌ ' + data.error);
      }
    } catch (e) {
      setMsg('❌ ' + e.message);
    }
    setSaving(false);
  };

  // Save analysis preset
  const handleSavePreset = async () => {
    if (!editPreset) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'analysisPreset', preset: editPreset }),
      });
      const data = await res.json();
      if (data.success && data.analysisPresets) {
        setPresets(data.analysisPresets);
        setMsg('✅ บันทึก Preset แล้ว');
      }
    } catch (e) {
      setMsg('❌ ' + e.message);
    }
    setSaving(false);
  };

  // Add new preset
  const handleAddPreset = () => {
    const newId = 'custom_' + Date.now();
    const newPreset = {
      id: newId,
      name: '🆕 Preset ใหม่',
      desc: 'คำอธิบาย',
      system: 'คุณคือนักวิเคราะห์คอนเทนต์ ตอบเป็น JSON เท่านั้น',
      user: `อ่านข่าวนี้แล้ววิเคราะห์:

หัวข้อ: {title}
เนื้อข่าว:
"""
{content}
"""
{custom_instruction}

ตอบเป็น JSON:
{
  "summary": "เนื้อหายาว 3-4 ย่อหน้า",
  "key_points": ["ประเด็น 1", "ประเด็น 2"],
  "people_involved": ["ชื่อ"],
  "emotion": "อารมณ์",
  "content_type": "ประเภท",
  "viral_potential": "สูง/กลาง/ต่ำ",
  "suggested_angles": ["มุมมอง 1"],
  "target_audience": "กลุ่มเป้าหมาย"
}`,
    };
    setEditPreset(newPreset);
  };

  // Delete preset
  const handleDeletePreset = async (id) => {
    if (presets.length <= 1) { setMsg('⚠️ ต้องมีอย่างน้อย 1 Preset'); return; }
    try {
      const res = await fetch('/api/prompts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'analysisPreset', id }),
      });
      const data = await res.json();
      if (data.success && data.analysisPresets) {
        setPresets(data.analysisPresets);
        setEditPreset(data.analysisPresets[0] || null);
        setMsg('🗑️ ลบแล้ว');
      }
    } catch (e) {
      setMsg('❌ ' + e.message);
    }
  };

  // Reset
  const handleReset = async () => {
    try {
      await fetch('/api/prompts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: selected }),
      });
      const res = await fetch('/api/prompts');
      const data = await res.json();
      if (data.success) {
        setPrompts(data.data);
        setSystem(data.data[selected]?.system || '');
        setUser(data.data[selected]?.user || '');
        setMsg('↩️ รีเซ็ตแล้ว');
      }
    } catch (e) {
      setMsg('❌ ' + e.message);
    }
  };

  const allTabs = { ...PROMPT_LABELS, analysis: { name: '🔍 วิเคราะห์ประเด็น', desc: `AI Presets (${presets.length} ชุด)` } };

  return (
    <>
      <Header />
      <div className="container" style={{ paddingTop: 20, paddingBottom: 40 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 20 }}>⚙️ จัดการ AI Prompts</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
          {/* Sidebar */}
          <div>
            {Object.entries(allTabs).map(([key, val]) => (
              <button key={key} onClick={() => handleSelect(key)}
                style={{
                  display: 'block', width: '100%', padding: '12px 14px', marginBottom: 6,
                  borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', textAlign: 'left',
                  background: selected === key ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: selected === key ? '#fff' : 'var(--text-primary)',
                }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{val.name}</div>
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{val.desc}</div>
              </button>
            ))}
          </div>

          {/* Content */}
          <div>
            {msg && <div style={{ padding: 10, borderRadius: 8, marginBottom: 12, background: 'var(--bg-tertiary)', fontSize: 13 }}>{msg}</div>}

            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>⏳ กำลังโหลด...</div>
            ) : selected === 'analysis' ? (
              /* ===== Analysis Presets Editor ===== */
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>🔍 Analysis Presets ({presets.length} ชุด)</h3>
                  <button className="btn btn-primary btn-sm" onClick={handleAddPreset}>➕ เพิ่ม Preset ใหม่</button>
                </div>

                {/* Preset List */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                  {presets.map(p => (
                    <button key={p.id} onClick={() => setEditPreset(p)}
                      style={{
                        padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: editPreset?.id === p.id ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: editPreset?.id === p.id ? '#fff' : 'var(--text-primary)',
                        fontSize: 12, fontWeight: 600,
                      }}>
                      {p.name}
                    </button>
                  ))}
                </div>

                {/* Preset Editor */}
                {editPreset && (
                  <div style={{ background: 'var(--bg-secondary)', padding: 20, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                      <div className="form-group">
                        <label className="form-label">ชื่อ Preset</label>
                        <input className="form-input" value={editPreset.name}
                          onChange={e => setEditPreset({ ...editPreset, name: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">คำอธิบาย</label>
                        <input className="form-input" value={editPreset.desc}
                          onChange={e => setEditPreset({ ...editPreset, desc: e.target.value })} />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">System Prompt (คำสั่งให้ AI)</label>
                      <textarea className="form-textarea" value={editPreset.system}
                        onChange={e => setEditPreset({ ...editPreset, system: e.target.value })}
                        style={{ minHeight: 200, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6 }} />
                    </div>

                    <div className="form-group">
                      <label className="form-label">User Prompt (ข้อมูลที่ส่งให้ AI)</label>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
                        ตัวแปร: <code style={{ color: 'var(--accent-light)' }}>{'{title}'}</code> <code style={{ color: 'var(--accent-light)' }}>{'{content}'}</code> <code style={{ color: 'var(--accent-light)' }}>{'{custom_instruction}'}</code>
                      </div>
                      <textarea className="form-textarea" value={editPreset.user}
                        onChange={e => setEditPreset({ ...editPreset, user: e.target.value })}
                        style={{ minHeight: 250, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6 }} />
                    </div>

                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button className="btn btn-primary" onClick={handleSavePreset} disabled={saving}>
                        {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึก Preset'}
                      </button>
                      <button className="btn btn-outline" onClick={() => handleDeletePreset(editPreset.id)} disabled={saving || presets.length <= 1}
                        style={{ color: 'var(--error)' }}>
                        🗑️ ลบ Preset
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* ===== Standard Prompt Editor ===== */
              <>
                <div className="form-group">
                  <label className="form-label">System Prompt (คำสั่งให้ AI)</label>
                  <textarea className="form-textarea" value={system} onChange={(e) => setSystem(e.target.value)}
                    style={{ minHeight: 250, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6 }} />
                </div>

                <div className="form-group">
                  <label className="form-label">User Prompt (ข้อมูลที่ส่งให้ AI)</label>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
                    ใช้ตัวแปร: <code style={{ color: 'var(--accent-light)' }}>{'{content}'}</code> <code style={{ color: 'var(--accent-light)' }}>{'{title}'}</code> <code style={{ color: 'var(--accent-light)' }}>{'{custom_instruction}'}</code> <code style={{ color: 'var(--accent-light)' }}>{'{tone}'}</code>
                  </div>
                  <textarea className="form-textarea" value={user} onChange={(e) => setUser(e.target.value)}
                    style={{ minHeight: 350, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6 }} />
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึก'}
                  </button>
                  <button className="btn btn-outline" onClick={handleReset} disabled={saving}>↩️ รีเซ็ตเป็นค่าเริ่มต้น</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function PromptsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PromptsPageInner />
    </Suspense>
  );
}
