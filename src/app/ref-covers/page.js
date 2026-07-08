'use client';

// ============================================================
// 🎯 /ref-covers — คลังปก reference + DNA
//   อัพโหลดปกตัวอย่าง (หลายไฟล์) → ระบบสกัด DNA การจัดวาง → เก็บคลัง + โชว์
// ============================================================

import { useState, useEffect, useRef } from 'react';

const toDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(file);
});

export default function RefCoversPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState('');
  const [zoom, setZoom] = useState(null);
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const j = await (await fetch('/api/ref-covers', { cache: 'no-store' })).json();
      if (j.success) setItems(j.items || []);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  async function onFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    for (let i = 0; i < files.length; i++) {
      setUploading(`กำลังอัพโหลด+วิเคราะห์ DNA ${i + 1}/${files.length}…`);
      try {
        const dataUrl = await toDataUrl(files[i]);
        await fetch('/api/ref-covers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ image: dataUrl, styleName: files[i].name.replace(/\.[^.]+$/, '').slice(0, 60) }),
        });
      } catch {}
      await load();
    }
    setUploading('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function del(id) {
    if (!confirm('ลบปก ref นี้?')) return;
    await fetch(`/api/ref-covers?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  }
  async function reanalyze(id) {
    setUploading('กำลังวิเคราะห์ DNA ใหม่…');
    await fetch('/api/ref-covers', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, reanalyze: true }) });
    setUploading('');
    load();
  }
  async function reanalyzeAll() {
    const ids = items.map((x) => x.id);
    if (!ids.length || !confirm(`วิเคราะห์ DNA ใหม่ทั้งหมด ${ids.length} ปก (อัปเกรดเป็นชุดข้อมูลแบบใหม่)? ใช้ AI ~$0.02/ปก`)) return;
    for (let i = 0; i < ids.length; i++) {
      setUploading(`วิเคราะห์ DNA ใหม่ ${i + 1}/${ids.length}…`);
      await fetch('/api/ref-covers', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ids[i], reanalyze: true }) }).catch(() => {});
    }
    setUploading('');
    load();
  }

  const chip = (t, bg = '#eef2ff', c = '#3730a3') => <span key={t} style={{ padding: '1px 7px', borderRadius: 5, background: bg, color: c, fontSize: 11 }}>{t}</span>;

  // 🛠 เฟส 2 (8 ก.ค.): editor แก้เทมเพลตด้วยตาคน — ทางแก้ถาวรของ "ตา AI วัดโครงผิด"
  const [editId, setEditId] = useState(null);
  const [editSlots, setEditSlots] = useState([]);
  const ROLES = ['hero', 'reaction', 'action', 'context', 'moment', 'evidence', 'pair', 'victim'];
  const openEditor = (it) => {
    setEditId(it.id);
    setEditSlots((it.dna?.template?.slots || []).map((s) => ({
      role: s.role || 'context', shape: s.shape === 'circle' ? 'circle' : 'rect',
      xPct: Math.round(s.xPct || 0), yPct: Math.round(s.yPct || 0), wPct: Math.round(s.wPct || 30), hPct: Math.round(s.hPct || 30),
      border: !!s.border, borderColor: (s.borderColor && s.borderColor !== '-') ? s.borderColor : '#FFFFFF',
    })));
  };
  const setSlotVal = (i, k, v) => setEditSlots((arr) => arr.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const saveTemplate = async () => {
    setUploading('กำลังบันทึกเทมเพลต…');
    const r = await fetch('/api/ref-covers', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: editId, template: { slots: editSlots } }) }).then((x) => x.json()).catch(() => ({}));
    setUploading('');
    if (!r.success) { alert('บันทึกล้ม: ' + (r.error || '')); return; }
    setEditId(null); load();
  };
  const quickVerify = async (id, v) => {
    await fetch('/api/ref-covers', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, verified: v }) }).catch(() => {});
    load();
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>🎯 คลังปก reference + DNA</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>อัพโหลดปกตัวอย่างหลายแนว → ระบบถอด "ชุดข้อมูลครบ": แทมเพลต (พิกัด %) + การจัดวาง + สไตล์/สี + ตรรกะ + เงื่อนไข match ข่าว → MEGA ดึงไปสร้างปกได้จริง</p>
      {items.length > 0 && <button onClick={reanalyzeAll} disabled={!!uploading} style={{ marginBottom: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', cursor: uploading ? 'wait' : 'pointer', fontSize: 13, fontWeight: 700 }}>🔄 วิเคราะห์ DNA ใหม่ทั้งหมด (อัปเกรดชุดข้อมูล)</button>}

      {/* อัพโหลด */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        style={{ border: '2px dashed #c7d2fe', borderRadius: 12, padding: 24, textAlign: 'center', background: '#f8fafc', cursor: 'pointer', marginBottom: 16 }}
      >
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => onFiles(e.target.files)} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#4338ca' }}>📤 ลากปกวางที่นี่ หรือคลิกเพื่อเลือก (หลายไฟล์ได้)</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{uploading || `มีในคลัง ${items.length} ปก`}</div>
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>⏳ กำลังโหลด…</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {items.map((it) => {
          const d = it.dna || {};
          return (
            <div key={it.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
              {it.imagePath && (
                <div style={{ display: 'flex', background: '#0f172a' }}>
                  <img src={it.imagePath} alt={it.styleName} onClick={() => setZoom(it.imagePath)} style={{ flex: 1, minWidth: 0, display: 'block', cursor: 'zoom-in', maxHeight: 260, objectFit: 'contain' }} />
                  {/* ★ A3 (8 ก.ค.): wireframe "เทมเพลตเปล่า" จาก DNA — เห็นทันทีว่าถอดตรง ref ไหม (เพี้ยน = กด reanalyze) */}
                  {Array.isArray(it.dna?.template?.slots) && it.dna.template.slots.length > 0 && (
                    <svg viewBox="0 0 108 135" style={{ width: 84, height: 105, alignSelf: 'center', margin: '0 6px', background: '#1e293b', borderRadius: 4, flexShrink: 0 }}
                      title={`เทมเพลตเปล่า${it.dna._geometryRefined ? ' (วัดละเอียดแล้ว)' : ''}`}>
                      {it.dna.template.slots.filter((s) => s.shape !== 'circle').map((s, i) => (
                        <rect key={i} x={(Number(s.xPct) || 0) * 1.08} y={(Number(s.yPct) || 0) * 1.35}
                          width={(Number(s.wPct) || 0) * 1.08} height={(Number(s.hPct) || 0) * 1.35}
                          fill={['#334155', '#475569', '#3b4f6b', '#52525b', '#44403c'][i % 5]}
                          stroke={s.border ? (s.borderColor && s.borderColor !== '-' ? s.borderColor : '#fff') : '#0f172a'}
                          strokeWidth={s.border ? 2 : 0.6} />
                      ))}
                      {it.dna.template.slots.filter((s) => s.shape === 'circle').map((s, i) => (
                        <circle key={'c' + i}
                          cx={((Number(s.xPct) || 0) + (Number(s.wPct) || 0) / 2) * 1.08}
                          cy={((Number(s.yPct) || 0) + (Number(s.hPct) || 0) / 2) * 1.35}
                          r={((Number(s.wPct) || 10) / 2) * 1.08}
                          fill="#64748b" stroke="#fff" strokeWidth={2} />
                      ))}
                    </svg>
                  )}
                </div>
              )}
              <div style={{ padding: 10, fontSize: 12, color: '#334155', flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>{it.styleName || '(ไม่มีชื่อแนว)'}</div>
                {it.dnaError && <div style={{ color: '#b91c1c', fontSize: 11 }}>⚠️ สกัด DNA ล้ม: {it.dnaError}</div>}
                {d._geometryMismatch && <div style={{ color: '#b45309', background: '#fef3c7', borderRadius: 6, padding: '2px 8px', fontSize: 11, marginBottom: 4 }}>👁️ {d._geometryMismatch}</div>}
                {d._humanVerified
                  ? <div style={{ color: '#166534', background: '#dcfce7', borderRadius: 6, padding: '2px 8px', fontSize: 11, marginBottom: 4, fontWeight: 700 }}>✅ ตาคนยืนยันเทมเพลตแล้ว (ระบบใช้ก่อน)</div>
                  : d._geometryRefined && <div style={{ color: '#166534', fontSize: 10, marginBottom: 4 }}>✓ วัดละเอียด 2 ขั้น (AI — ยังไม่ผ่านตาคน)</div>}
                {d.layoutType && <div style={{ marginBottom: 4 }}><b>โครง:</b> {d.layoutType}{d.layoutFamily ? ` · ${d.layoutFamily}` : ''}</div>}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {d.aspectRatio && chip(d.aspectRatio, '#dcfce7', '#166534')}
                  {(d.style?.tone) && chip('โทน ' + d.style.tone)}
                  {d.emotion && chip(d.emotion, '#fef3c7', '#92400e')}
                  {d.layout?.circle?.present && chip('⭕ ' + (d.layout.circle.role || 'วงกลม'))}
                  {d.layout?.sidePanels?.split && d.layout.sidePanels.split !== '-' && chip('split ' + d.layout.sidePanels.split)}
                  {Array.isArray(d.template?.slots) && chip(`🧩 ${d.template.slots.length} slot`, '#ede9fe', '#6d28d9')}
                  {d.template?.seamStyle && chip(d.template.seamStyle, '#f1f5f9', '#475569')}
                </div>
                {Array.isArray(d.style?.palette) && d.style.palette.length > 0 && (
                  <div style={{ display: 'flex', gap: 3, marginBottom: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>สี:</span>
                    {d.style.palette.slice(0, 5).map((c, i) => <span key={i} title={c} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid #e2e8f0', display: 'inline-block' }} />)}
                  </div>
                )}
                {Array.isArray(d.template?.slots) && d.template.slots.length > 0 && (
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    🧩 {d.template.slots.map((s) => `${s.role}${s.shape === 'circle' ? '○' : ''}(${Math.round(s.xPct)},${Math.round(s.yPct)} ${Math.round(s.wPct)}×${Math.round(s.hPct)})`).join(' ')}
                  </div>
                )}
                {Array.isArray(d.style?.effects) && d.style.effects.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>{d.style.effects.slice(0, 6).map((f) => chip(f, '#f1f5f9', '#475569'))}</div>
                )}
                {Array.isArray(d.slots) && d.slots.length > 0 && (
                  <div style={{ marginBottom: 4, fontSize: 11 }}><b>ช่อง:</b> {d.slots.map((s) => `${s.role}=${s.subject || s.emotion || '?'}`).join(' · ')}</div>
                )}
                {Array.isArray(d.matchNewsType) && d.matchNewsType.length > 0 && (
                  <div style={{ marginBottom: 4 }}><b>เหมาะข่าว:</b> {d.matchNewsType.join(', ')}</div>
                )}
                {d.storyFlow && <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>📖 {d.storyFlow}</div>}
                {d.compositionLogic && <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>🧬 {d.compositionLogic}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                <button onClick={() => reanalyze(it.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>🔄 วิเคราะห์ใหม่</button>
                <button onClick={() => openEditor(it)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', cursor: 'pointer', fontWeight: 700 }}>🛠 แก้เทมเพลต</button>
                {!d._humanVerified
                  ? <button onClick={() => quickVerify(it.id, true)} title="wireframe ตรงกับปกจริงแล้ว — ยืนยันเลยไม่ต้องแก้" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', cursor: 'pointer', fontWeight: 700 }}>✔ ยืนยันถูกต้อง</button>
                  : <button onClick={() => quickVerify(it.id, false)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer' }}>↩ ถอนยืนยัน</button>}
                <button onClick={() => del(it.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>🗑️ ลบ</button>
              </div>

              {/* 🛠 editor แก้เทมเพลต (เฟส 2) — wireframe สดใหญ่ + ปรับเลขทีละช่อง */}
              {editId === it.id && (
                <div style={{ borderTop: '2px solid #4338ca', padding: 10, background: '#f8fafc' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <svg viewBox="0 0 108 135" style={{ width: 150, height: 187, background: '#1e293b', borderRadius: 6, flexShrink: 0 }}>
                      {editSlots.map((s, i) => s.shape !== 'circle' ? (
                        <g key={i}>
                          <rect x={s.xPct * 1.08} y={s.yPct * 1.35} width={s.wPct * 1.08} height={s.hPct * 1.35}
                            fill={['#334155', '#475569', '#3b4f6b', '#52525b', '#44403c', '#3f3f46'][i % 6]}
                            stroke={s.border ? s.borderColor : '#0f172a'} strokeWidth={s.border ? 2 : 0.6} />
                          <text x={s.xPct * 1.08 + 3} y={s.yPct * 1.35 + 10} fontSize="8" fill="#e2e8f0">{i + 1}</text>
                        </g>
                      ) : (
                        <g key={i}>
                          <circle cx={(s.xPct + s.wPct / 2) * 1.08} cy={(s.yPct + s.hPct / 2) * 1.35} r={(s.wPct / 2) * 1.08}
                            fill="#64748b" stroke={s.border ? s.borderColor : '#fff'} strokeWidth={2} />
                          <text x={(s.xPct + s.wPct / 2) * 1.08 - 3} y={(s.yPct + s.hPct / 2) * 1.35 + 3} fontSize="8" fill="#fff">{i + 1}</text>
                        </g>
                      ))}
                    </svg>
                    <div style={{ flex: 1, fontSize: 11 }}>
                      {editSlots.map((s, i) => (
                        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                          <b style={{ width: 14 }}>{i + 1}</b>
                          <select value={s.role} onChange={(e) => setSlotVal(i, 'role', e.target.value)} style={{ fontSize: 11, padding: 2 }}>
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <select value={s.shape} onChange={(e) => setSlotVal(i, 'shape', e.target.value)} style={{ fontSize: 11, padding: 2 }}>
                            <option value="rect">▭</option><option value="circle">⭕</option>
                          </select>
                          {['xPct', 'yPct', 'wPct', 'hPct'].map((k) => (
                            <input key={k} type="number" value={s[k]} min={0} max={100} title={k}
                              onChange={(e) => setSlotVal(i, k, +e.target.value)}
                              style={{ width: 44, fontSize: 11, padding: 2 }} />
                          ))}
                          <label style={{ fontSize: 10 }}><input type="checkbox" checked={s.border} onChange={(e) => setSlotVal(i, 'border', e.target.checked)} /> กรอบ</label>
                          <button onClick={() => setEditSlots((a) => a.filter((_, j) => j !== i))} style={{ fontSize: 10, border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer' }}>🗑</button>
                        </div>
                      ))}
                      <div style={{ fontSize: 10, color: '#94a3b8', margin: '2px 0 6px' }}>x,y = มุมซ้ายบน (%) · w,h = กว้าง,สูง (%) — ดู wireframe ซ้ายเทียบปกจริงด้านบน</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEditSlots((a) => [...a, { role: 'context', shape: 'rect', xPct: 60, yPct: 60, wPct: 40, hPct: 40, border: false, borderColor: '#FFFFFF' }])}
                          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>＋ เพิ่มช่อง</button>
                        <button onClick={saveTemplate} disabled={editSlots.length < 3}
                          style={{ fontSize: 11, padding: '3px 12px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>✔ บันทึก + ยืนยันเทมเพลต</button>
                        <button onClick={() => setEditId(null)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}>ปิด</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50, cursor: 'zoom-out' }}>
          <img src={zoom} alt="ref" style={{ maxHeight: '90vh', maxWidth: '90vw', borderRadius: 10 }} />
        </div>
      )}
    </div>
  );
}
