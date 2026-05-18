'use client';
import { useState } from 'react';

export const DEFAULT_PROMPTS = {
  imageSelect: `วิเคราะห์รูปแต่ละรูปตามหลักการนี้เท่านั้น:

1. MAIN ZONE — ใบหน้าคมชัด / หันตรง / แสดงอารมณ์ชัด / แสง & contrast ดี
2. MEMORIAL ZONE — รูป ID card / รูปเดี่ยวพื้นหลังเรียบ → กำหนดเป็น memorial (ขาวดำ)
3. EVENT ZONE — เหตุการณ์โดยตรง: รถเสียหาย / ที่เกิดเหตุ / ควัน / ไฟ
4. CONTEXT ZONE — บริบท: โรงพยาบาล / เจ้าหน้าที่ / ครอบครัว / สถานที่
5. ถ้ารูปไม่พอ — ใช้รูปซ้ำได้ โดย main ต้องดีที่สุดเสมอ

ห้ามเดาสุ่ม ต้องมีเหตุผลจาก visual element จริงๆ ห้ามทำนอกเหนือคำสั่งนี้`,

  layoutDNA: `สร้าง layout concept สำหรับปกข่าวไทย 1:1 (1080x1080px)
- ซ้ายบน 55%: ใบหน้าหลัก soft edge ละลายไปทางขวา
- ขวาบน: 2 ช่อง บริบทด้านบน, เหตุการณ์ด้านล่าง (กรอบสี)
- ล่างซ้าย: วงกลมรูปบุคคลรอง (ขาวดำ)
- ล่างขวา: บุคคลที่เกี่ยวข้อง
- ล่างสุด: แถบข้อความข่าวหนา
พื้นหลัง: #0c0c14 ดูหนักแน่น จริงจัง`,

  textStyle: `ใส่ข้อความหัวข้อข่าวไทยที่ด้านล่างของภาพ
สไตล์: ตัวหนา สีขาว มีเงาดำ อ่านง่าย
ตำแหน่ง: ล่างสุด 20% จัดกลาง
พื้นหลัง: แถบดำโปร่งใส 65% opacity
Font: ใหญ่ กระทบสายตา เหมาะข่าว
ห้ามเปลี่ยนองค์ประกอบภาพเดิม — เพิ่มแค่ข้อความด้านล่าง`,
};

const BASE_ZONES = [
  { value: 'accident', label: '🚨 อุบัติเหตุ' },
  { value: 'crime', label: '🔴 อาชญากรรม' },
  { value: 'politics', label: '🏛️ การเมือง' },
  { value: 'economy', label: '💰 เศรษฐกิจ' },
  { value: 'entertainment', label: '🎬 บันเทิง' },
];

// ── Custom Template Builder (Prompt 4) ────────────────────────
function TemplateBuilder({ newsType, onSaved }) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [baseZone, setBaseZone] = useState('accident');
  const [color, setColor] = useState('#a855f7');
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState([]);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const generate = async () => {
    if (!prompt.trim()) { setErr('ใส่ Layout Prompt ก่อน'); return; }
    setLoading(true); setErr(''); setPreviews([]); setSelected(null);
    try {
      const res = await fetch('/api/layout-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutPrompt: prompt, newsType: baseZone }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setPreviews(data.previews);
    } catch (e) { setErr('❌ ' + e.message); }
    finally { setLoading(false); }
  };

  const save = () => {
    if (!name.trim()) { setErr('ใส่ชื่อ Template ก่อน'); return; }
    if (selected === null) { setErr('คลิกเลือก concept ที่ถูกใจก่อน'); return; }
    const tmpl = {
      id: 'custom_' + Date.now(),
      name: name.trim(), baseTemplate: baseZone,
      previewImage: previews[selected], prompt, color,
      createdAt: new Date().toISOString(),
    };
    const prev = JSON.parse(localStorage.getItem('customTemplates') || '[]');
    localStorage.setItem('customTemplates', JSON.stringify([...prev, tmpl]));
    setSavedMsg('✅ เพิ่มเข้าระบบแล้ว!'); setTimeout(() => setSavedMsg(''), 3000);
    setName(''); setPreviews([]); setSelected(null);
    onSaved?.(tmpl);
  };

  return (
    <div style={{ padding: 14, background: 'var(--bg-primary)', borderRadius: 10, border: '1px solid rgba(168,85,247,0.35)', marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#a855f7', marginBottom: 4 }}>🆕 Prompt 4: Custom Template Builder</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 12 }}>เขียน prompt → Generate จนถูกใจ → เพิ่มเข้า Template Selector ได้ทันที</div>

      {/* Row: name, color, base zones */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 150px', gap: 8, marginBottom: 10 }}>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="ชื่อ Template เช่น 'ข่าวอุบัติสไตล์ใหม่'"
          style={{ background: '#0a0a14', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 8, padding: '8px 10px', color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a14', border: '1px solid var(--border)', borderRadius: 8, gap: 4 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>สี</span>
          <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 28, height: 24, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
        </div>
        <select value={baseZone} onChange={e => setBaseZone(e.target.value)}
          style={{ background: '#0a0a14', border: '1px solid var(--border)', borderRadius: 8, padding: '0 8px', color: 'var(--text-muted)', fontSize: 10, fontFamily: 'inherit' }}>
          {BASE_ZONES.map(b => <option key={b.value} value={b.value}>{b.label} zones</option>)}
        </select>
      </div>

      {/* Layout Prompt */}
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
        placeholder="อธิบาย layout ที่ต้องการ เช่น: ใบหน้าหลักขนาดใหญ่ตรงกลาง พร้อมรูปเหตุการณ์ขวา มีวงกลมขาวดำล่างซ้าย แถบข้อความด้านล่าง..."
        style={{ width: '100%', background: '#0a0a14', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, padding: 10, color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6, marginBottom: 10 }} />

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button onClick={generate} disabled={loading} style={{
          padding: '8px 20px', borderRadius: 8, border: 'none', fontFamily: 'inherit',
          background: loading ? 'var(--bg-elevated)' : 'linear-gradient(135deg,#a855f7,#7c3aed)',
          color: '#fff', fontWeight: 700, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer',
        }}>{loading ? '⏳ Generating...' : '🎨 Generate Preview'}</button>
        {previews.length > 0 && (
          <button onClick={generate} disabled={loading} style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.4)',
            background: 'transparent', color: '#a855f7', fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}>🔄 Regenerate</button>
        )}
      </div>

      {err && <div style={{ color: '#fca5a5', fontSize: 11, marginBottom: 8 }}>{err}</div>}

      {/* Preview grid — click to select */}
      {previews.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
            👆 คลิกเลือก concept ที่ถูกใจ {selected !== null && <span style={{ color: '#a855f7', fontWeight: 700 }}>✅ เลือก concept {selected + 1}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 10 }}>
            {previews.map((src, i) => (
              <div key={i} onClick={() => setSelected(i)} style={{
                borderRadius: 8, overflow: 'hidden', cursor: 'pointer', position: 'relative',
                border: selected === i ? `3px solid ${color}` : '2px solid var(--border)',
                opacity: selected !== null && selected !== i ? 0.55 : 1, transition: 'all .15s',
              }}>
                <img src={src} alt="" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                {selected === i && <div style={{ position: 'absolute', top: 6, right: 6, background: color, borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>✅</div>}
                <div style={{ padding: '3px 6px', background: 'rgba(0,0,0,0.75)', fontSize: 9, color: '#fff', textAlign: 'center' }}>Concept {i + 1}</div>
              </div>
            ))}
          </div>

          {/* Add to system */}
          <button onClick={save} disabled={selected === null || !name.trim()} style={{
            width: '100%', padding: 10, borderRadius: 8, border: 'none', fontFamily: 'inherit',
            background: selected !== null && name.trim() ? `linear-gradient(135deg,${color},#7c3aed)` : 'var(--bg-elevated)',
            color: '#fff', fontWeight: 800, fontSize: 13, cursor: selected !== null && name.trim() ? 'pointer' : 'not-allowed',
            boxShadow: selected !== null && name.trim() ? `0 4px 16px ${color}44` : 'none',
          }}>
            {savedMsg || `✅ เพิ่ม "${name || 'ชื่อ Template'}" เข้าระบบ`}
          </button>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>บันทึกแล้วปรากฏใน Template Selector ทันที</div>
        </>
      )}
    </div>
  );
}

// ── Main PromptManager ─────────────────────────────────────────
export default function PromptManager({ prompts, onChange, newsType, onTemplateAdded }) {
  const [showPreview, setShowPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previews, setPreviews] = useState([]);
  const [previewErr, setPreviewErr] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const save = () => {
    localStorage.setItem('imgPrompts_v2', JSON.stringify(prompts));
    setSavedMsg('✅ บันทึกแล้ว'); setTimeout(() => setSavedMsg(''), 2000);
  };
  const reset = () => { onChange(DEFAULT_PROMPTS); localStorage.removeItem('imgPrompts_v2'); };

  const genPreview = async () => {
    setPreviewLoading(true); setPreviewErr(''); setPreviews([]);
    try {
      const res = await fetch('/api/layout-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutPrompt: prompts.layoutDNA, newsType }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setPreviews(data.previews);
    } catch (e) { setPreviewErr('❌ ' + e.message); }
    finally { setPreviewLoading(false); }
  };

  const CFGS = [
    { key: 'imageSelect', n: 1, icon: '🧠', label: 'Logic เลือกรูป', sub: 'GPT-4o Vision', tip: '💡 ระบุ visual element ชัดๆ → AI แม่น', color: '#818cf8' },
    { key: 'layoutDNA', n: 2, icon: '🎨', label: 'Layout DNA', sub: 'Ideogram Layout Preview', tip: '💡 ระบุ % พื้นที่แต่ละ zone และทิศทาง soft edge', color: '#34d399', preview: true },
    { key: 'textStyle', n: 3, icon: '✏️', label: 'Text Style', sub: 'Ideogram Text Overlay', tip: '💡 ระบุ opacity, ขนาด font, "ห้ามเปลี่ยนรูป"', color: '#f472b6' },
  ];

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 16 }}>
        🔧 Prompt Manager <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>— 4 prompts ฝัง DNA การสร้างรูป ห้าม AI ออกนอกคำสั่ง</span>
      </div>

      {CFGS.map(cfg => (
        <div key={cfg.key} style={{ marginBottom: 14, padding: 14, background: 'var(--bg-primary)', borderRadius: 10, border: `1px solid ${cfg.color}33` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: cfg.color }}>{cfg.icon} Prompt {cfg.n}: {cfg.label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{cfg.sub}</div>
            </div>
            {cfg.preview && (
              <button onClick={() => setShowPreview(p => !p)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${cfg.color}`, background: 'transparent', color: cfg.color, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 8 }}>
                {showPreview ? '▲' : '🖼️ Preview'}
              </button>
            )}
          </div>
          <textarea value={prompts[cfg.key]} onChange={e => onChange({ ...prompts, [cfg.key]: e.target.value })} rows={4}
            style={{ width: '100%', background: '#0a0a14', border: `1px solid ${cfg.color}44`, borderRadius: 8, padding: 10, color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }} />
          <div style={{ fontSize: 10, color: cfg.color, marginTop: 5, fontStyle: 'italic' }}>{cfg.tip}</div>

          {cfg.preview && showPreview && (
            <div style={{ marginTop: 10, padding: 10, background: '#0a0a14', borderRadius: 8, border: `1px solid ${cfg.color}33` }}>
              <button onClick={genPreview} disabled={previewLoading} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: previewLoading ? 'var(--bg-elevated)' : `linear-gradient(135deg,${cfg.color},#7c3aed)`, color: '#fff', fontWeight: 700, fontSize: 11, cursor: previewLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', marginBottom: 8 }}>
                {previewLoading ? '⏳ Generating...' : '🎨 Generate Layout Preview'}
              </button>
              {previewErr && <div style={{ color: '#fca5a5', fontSize: 11 }}>{previewErr}</div>}
              {previews.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                  {previews.map((src, i) => (
                    <div key={i} style={{ borderRadius: 7, overflow: 'hidden', border: `1px solid ${cfg.color}44` }}>
                      <img src={src} alt="" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                      <a href={src} download={`concept-${i + 1}.jpg`} style={{ display: 'block', padding: '4px 0', background: 'rgba(0,0,0,0.6)', textAlign: 'center', fontSize: 9, color: cfg.color, textDecoration: 'none' }}>📥 Save concept {i + 1}</a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Prompt 4 */}
      <TemplateBuilder newsType={newsType} onSaved={onTemplateAdded} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <button onClick={save} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--success)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>💾 บันทึก Prompts</button>
        <button onClick={reset} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↩️ Reset</button>
        {savedMsg && <span style={{ fontSize: 12, color: 'var(--success)' }}>{savedMsg}</span>}
      </div>

      <div style={{ padding: 10, background: 'rgba(249,24,128,0.05)', border: '1px solid rgba(249,24,128,0.1)', borderRadius: 8, fontSize: 10, color: 'var(--text-muted)' }}>
        <div style={{ fontWeight: 700, color: '#f472b6', marginBottom: 6 }}>🚀 เทคนิค</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          <div>✅ ระบุ visual element: "ใบหน้าคมชัด หันตรง"</div>
          <div>❌ คลุมเครือ: "รูปดีที่สุด" → AI เดาสุ่ม</div>
          <div>✅ Layout: "ซ้าย 55% = ใบหน้า soft-right"</div>
          <div>✅ ล็อค: ลงท้าย "ห้ามทำนอกเหนือคำสั่งนี้"</div>
        </div>
      </div>
    </div>
  );
}
