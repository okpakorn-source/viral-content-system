'use client';
import Header from '@/components/layout/Header';
import { useState, useEffect } from 'react';

const PROMPT_LABELS = {
  extraction: { name: '📥 สกัดเนื้อข่าว', desc: 'AI ตัวที่ 1: แยกเนื้อข่าวจริงจาก raw text' },
  analysis: { name: '🔍 วิเคราะห์ประเด็น', desc: 'AI ตัวที่ 2: วิเคราะห์ศักยภาพไวรัล + สรุป' },
  angle: { name: '🎯 มุมมองไวรัล', desc: 'สร้าง Headlines, Hooks, Comment Baits' },
  article: { name: '✍️ เขียนบทความ', desc: 'เขียนบทความไวรัลจากข้อมูลที่วิเคราะห์แล้ว' },
};

export default function PromptsPage() {
  const [selected, setSelected] = useState('extraction');
  const [prompts, setPrompts] = useState({});
  const [system, setSystem] = useState('');
  const [user, setUser] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Load prompts
  useEffect(() => {
    fetch('/api/prompts').then(r => r.json()).then(d => {
      if (d.success) {
        setPrompts(d.data);
        setSystem(d.data[selected]?.system || '');
        setUser(d.data[selected]?.user || '');
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Switch tab
  const handleSelect = (key) => {
    setSelected(key);
    setSystem(prompts[key]?.system || '');
    setUser(prompts[key]?.user || '');
    setMsg('');
  };

  // Save
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
        setPrompts(prev => ({ ...prev, [selected]: { system, user } }));
        setMsg('✅ บันทึกสำเร็จ!');
      } else {
        setMsg('❌ ' + data.error);
      }
    } catch (err) { setMsg('❌ ' + err.message); }
    finally { setSaving(false); setTimeout(() => setMsg(''), 3000); }
  };

  // Reset
  const handleReset = async () => {
    if (!confirm('รีเซ็ต prompt นี้กลับเป็นค่าเริ่มต้น?')) return;
    setSaving(true);
    try {
      const res = await fetch('/api/prompts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: selected }),
      });
      const data = await res.json();
      if (data.success) {
        setPrompts(data.data);
        setSystem(data.data[selected]?.system || '');
        setUser(data.data[selected]?.user || '');
        setMsg('✅ รีเซ็ตสำเร็จ!');
      }
    } catch (err) { setMsg('❌ ' + err.message); }
    finally { setSaving(false); setTimeout(() => setMsg(''), 3000); }
  };

  return (
    <>
      <Header title="🤖 จัดการ AI Prompts" subtitle="แก้ไข prompt templates ที่ใช้จริงในทุกขั้นตอนของระบบ" />
      <div className="page-content">
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
          {/* Sidebar */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase' }}>Pipeline Prompts</div>
            {Object.entries(PROMPT_LABELS).map(([key, info]) => (
              <button key={key} onClick={() => handleSelect(key)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '12px 14px', marginBottom: 6,
                  background: selected === key ? 'var(--accent-glow)' : 'transparent',
                  border: selected === key ? '1px solid var(--accent)' : '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  color: selected === key ? 'var(--accent-light)' : 'var(--text-secondary)',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                  fontWeight: selected === key ? 600 : 400,
                  transition: 'all var(--transition)',
                }}>
                {info.name}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{info.desc}</div>
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>{PROMPT_LABELS[selected]?.name}</h3>
              {msg && <span style={{ fontSize: 12, color: msg.includes('✅') ? 'var(--success)' : 'var(--danger)' }}>{msg}</span>}
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>กำลังโหลด...</div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">System Prompt</label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>กำหนดบทบาทและพฤติกรรมของ AI</div>
                  <textarea className="form-textarea" value={system} onChange={(e) => setSystem(e.target.value)}
                    style={{ minHeight: 150, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6 }} />
                </div>

                <div className="form-group">
                  <label className="form-label">User Prompt Template</label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
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
