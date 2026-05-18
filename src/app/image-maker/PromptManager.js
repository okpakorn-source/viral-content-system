'use client';
import { useState, useEffect } from 'react';

export const DEFAULT_PROMPTS = {
  // Prompt 1: Logic เลือกรูป → ส่งไป GPT-4o Vision
  imageSelect: `วิเคราะห์รูปแต่ละรูปตามหลักการนี้เท่านั้น:

1. MAIN ZONE — เลือกรูปที่มี: ใบหน้าคมชัด / หันตรง / แสดงอารมณ์ชัด / แสง & contrast ดี
2. MEMORIAL ZONE — ถ้ามีรูป ID card / รูปทางการ / รูปเดี่ยวพื้นหลังเรียบ → กำหนดเป็น memorial (ขาวดำ)  
3. EVENT ZONE — เลือกรูปที่แสดงเหตุการณ์โดยตรง: รถเสียหาย / ที่เกิดเหตุ / ควัน / ไฟ
4. CONTEXT ZONE — รูปแสดงบริบท: โรงพยาบาล / เจ้าหน้าที่ / ครอบครัว / สถานที่
5. ถ้ารูปไม่พอ — ใช้รูปซ้ำได้ โดย main ต้องดีที่สุดเสมอ

ห้ามเลือกโดยเดาสุ่ม ต้องมีเหตุผลจาก visual element จริงๆ`,

  // Prompt 2: Layout DNA → ส่งไป Ideogram สร้าง layout preview
  layoutDNA: `สร้าง layout concept สำหรับปกข่าวไทย 1:1 (1080x1080px)
แบ่งพื้นที่ชัดเจน:
- ซ้ายบน 55%: ใบหน้าหลัก (soft edge ละลายไปทางขวา)
- ขวาบน: แบ่งเป็น 2 ช่อง — บริบทด้านบน, เหตุการณ์ด้านล่าง (มีกรอบสี)
- ล่างซ้าย: วงกลมรูปบุคคลรอง (ขาวดำ)
- ล่างขวา: บุคคลที่เกี่ยวข้อง
- ล่างสุด: แถบข้อความข่าวหนา สีเด่น
พื้นหลัง: สีเข้ม #0c0c14 ดูหนักแน่น จริงจัง`,

  // Prompt 3: Text Style → ส่งไป Ideogram text overlay
  textStyle: `ใส่ข้อความหัวข้อข่าวไทยที่ด้านล่างของภาพ
สไตล์: ตัวหนา สีขาว มีเงา/ขอบดำ อ่านง่าย
ตำแหน่ง: ล่างสุด 20% ของภาพ จัดกลาง
พื้นหลังข้อความ: แถบสีดำโปร่งใส 65% opacity
ขนาด Font: ใหญ่ กระทบสายตา เหมาะกับข่าว
ห้ามเปลี่ยนองค์ประกอบภาพเดิม — เพิ่มแค่ข้อความที่ด้านล่างเท่านั้น`
};

export default function PromptManager({ prompts, onChange, newsType }) {
  const [showLayoutGen, setShowLayoutGen] = useState(false);
  const [layoutGenLoading, setLayoutGenLoading] = useState(false);
  const [layoutPreviews, setLayoutPreviews] = useState([]);
  const [layoutGenError, setLayoutGenError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const save = () => {
    localStorage.setItem('imgPrompts_v2', JSON.stringify(prompts));
    setSavedMsg('✅ บันทึกแล้ว'); setTimeout(() => setSavedMsg(''), 2000);
  };
  const reset = () => {
    onChange(DEFAULT_PROMPTS);
    localStorage.removeItem('imgPrompts_v2');
  };

  const generateLayout = async () => {
    setLayoutGenLoading(true); setLayoutGenError(''); setLayoutPreviews([]);
    try {
      const res = await fetch('/api/layout-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutPrompt: prompts.layoutDNA, newsType }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setLayoutPreviews(data.previews);
    } catch (e) { setLayoutGenError('❌ ' + e.message); }
    finally { setLayoutGenLoading(false); }
  };

  const PROMPT_CONFIGS = [
    {
      key: 'imageSelect',
      icon: '🧠',
      label: 'Logic เลือกรูป',
      sub: 'GPT-4o Vision — ควบคุมว่า AI จะเลือกรูปแต่ละรูปด้วยเหตุผลอะไร',
      tip: '💡 เทคนิค: ระบุ visual element ที่ชัดเจน เช่น "มีใบหน้า", "เห็นยานพาหนะเสียหาย" → AI แม่นขึ้น',
      color: '#818cf8',
    },
    {
      key: 'layoutDNA',
      icon: '🎨',
      label: 'Layout DNA',
      sub: 'Ideogram — กำหนดโครงสร้าง zone ของภาพ (สามารถ Generate Preview ได้)',
      tip: '💡 เทคนิค: ระบุ % ของพื้นที่แต่ละ zone, ทิศทาง soft edge, และ role ของแต่ละมุม',
      color: '#34d399',
      hasPreview: true,
    },
    {
      key: 'textStyle',
      icon: '✏️',
      label: 'Text Style',
      sub: 'Ideogram — ควบคุมสไตล์ข้อความบนรูป (font, สี, ตำแหน่ง, opacity)',
      tip: '💡 เทคนิค: ระบุ opacity ของ bar, ขนาด font เป็น relative (ใหญ่/กลาง), และบอกว่า "ห้ามเปลี่ยนรูป"',
      color: '#f472b6',
    },
  ];

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 16 }}>
        🔧 Prompt Manager <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>— ทุก prompt ฝังใน DNA การสร้างภาพ ห้าม AI ทำนอกเหนือคำสั่ง</span>
      </div>

      {PROMPT_CONFIGS.map(cfg => (
        <div key={cfg.key} style={{ marginBottom: 18, padding: 14, background: 'var(--bg-primary)', borderRadius: 10, border: `1px solid ${cfg.color}33` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: cfg.color }}>
                {cfg.icon} Prompt {PROMPT_CONFIGS.indexOf(cfg)+1}: {cfg.label}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{cfg.sub}</div>
            </div>
            {cfg.hasPreview && (
              <button onClick={() => setShowLayoutGen(p => !p)}
                style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${cfg.color}`, background: 'transparent', color: cfg.color, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', marginLeft: 8 }}>
                {showLayoutGen ? '▲ ซ่อน' : '🖼️ Generate Preview'}
              </button>
            )}
          </div>

          <textarea value={prompts[cfg.key]}
            onChange={e => onChange({ ...prompts, [cfg.key]: e.target.value })}
            rows={4}
            style={{ width: '100%', background: '#0a0a14', border: `1px solid ${cfg.color}44`, borderRadius: 8, padding: 10, color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }}
          />

          <div style={{ fontSize: 10, color: cfg.color, marginTop: 6, fontStyle: 'italic' }}>{cfg.tip}</div>

          {/* Layout Preview Generator */}
          {cfg.hasPreview && showLayoutGen && (
            <div style={{ marginTop: 12, padding: 12, background: '#0a0a14', borderRadius: 8, border: `1px solid ${cfg.color}33` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color, marginBottom: 8 }}>
                🎨 Generate Layout Preview (ดูตัวอย่าง Layout ก่อนสร้างจริง)
              </div>
              <button onClick={generateLayout} disabled={layoutGenLoading}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: layoutGenLoading ? 'var(--bg-elevated)' : `linear-gradient(135deg,${cfg.color},#7c3aed)`, color: '#fff', fontWeight: 700, fontSize: 12, cursor: layoutGenLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {layoutGenLoading ? '⏳ กำลัง Generate...' : '🎨 Generate Layout Concept'}
              </button>
              {layoutGenError && <div style={{ color: '#fca5a5', fontSize: 11, marginTop: 8 }}>{layoutGenError}</div>}

              {layoutPreviews.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>เลือก concept ที่ชอบ → นำมาเป็น template reference:</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                    {layoutPreviews.map((src, i) => (
                      <div key={i} style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${cfg.color}44` }}>
                        <img src={src} alt={`layout${i+1}`} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                        <div style={{ display: 'flex', gap: 4, padding: 6 }}>
                          <button onClick={() => {
                            onChange({ ...prompts, layoutDNA: prompts.layoutDNA + '\n\n[Reference concept ' + (i+1) + ' selected]' });
                            setShowLayoutGen(false);
                          }} style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: `1px solid ${cfg.color}`, background: 'transparent', color: cfg.color, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            ✅ ใช้ concept นี้
                          </button>
                          <a href={src} download={`layout-concept-${i+1}.jpg`}
                            style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            📥 Save
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Save/Reset */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={save} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--success)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          💾 บันทึก Prompts
        </button>
        <button onClick={reset} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          ↩️ Reset
        </button>
        {savedMsg && <span style={{ fontSize: 12, color: 'var(--success)' }}>{savedMsg}</span>}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>localStorage — เฉพาะ Image Maker เท่านั้น</span>
      </div>

      {/* Tips */}
      <div style={{ marginTop: 14, padding: 12, background: 'rgba(249,24,128,0.05)', border: '1px solid rgba(249,24,128,0.1)', borderRadius: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#f472b6', marginBottom: 8 }}>🚀 เทคนิค Prompt Engineering สำหรับสร้างรูปข่าว</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <div><strong style={{ color: 'var(--text-secondary)' }}>✅ ดี:</strong> "เลือกรูปที่มีใบหน้าคมชัด หันตรง" → ระบุ visual element</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>❌ ไม่ดี:</strong> "เลือกรูปที่ดีที่สุด" → คลุมเครือ AI เดาสุ่ม</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>✅ Layout:</strong> ระบุ % พื้นที่ เช่น "ซ้าย 55% = ใบหน้า"</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>✅ Text:</strong> ระบุ opacity, ห้ามเปลี่ยนรูปพื้นหลัง</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>✅ Memorial:</strong> "ID card / รูปเดี่ยว → memorial zone"</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>✅ ล็อค AI:</strong> ลงท้ายด้วย "ห้ามทำนอกเหนือคำสั่งนี้"</div>
        </div>
      </div>
    </div>
  );
}
