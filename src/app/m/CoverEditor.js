'use client';
// ✋ เครื่องมือแต่งปกแมนวลบนมือถือ — พนักงานใส่รูปเอง ลาก/ซูมเอง (26 ก.ค. 69 เจ้าของสั่ง)
//   วาดด้วย canvas ในเครื่องล้วน (ใช้หัวใจการวาดชุดเดียวกับ /cover-tester) → บันทึกปุ่มเดียวลงคลัง
import { useState, useRef, useEffect, useCallback } from 'react';
import { W, H } from '@/lib/cover-editor/draw';
import { renderCover, hitSlot, exportCover, loadScaledImage } from '@/lib/cover-editor/compose';

const newDraftId = () => 'MED-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export default function CoverEditor({ onLog, say, initialTitle = '' }) {
  const [templates, setTemplates] = useState([]);
  const [tpl, setTpl] = useState(null);
  const [images, setImages] = useState({});      // slotId → HTMLImageElement
  const [crops, setCrops] = useState({});        // slotId → {zoom,panX,panY}
  const [offsets, setOffsets] = useState({});    // slotId → {dx,dy}
  const [scales, setScales] = useState({});      // slotId → number
  const [texts, setTexts] = useState({});
  const [sel, setSel] = useState(null);
  const [fadeOn, setFadeOn] = useState(true);
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);      // {id, imgUrl}
  const [archive, setArchive] = useState([]);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('img');       // img=เลื่อนรูปในช่อง · slot=ย้าย/ย่อช่อง

  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const draftRef = useRef(newDraftId());
  const rafRef = useRef(0);
  const gestureRef = useRef(null);
  const selRef = useRef(sel);           // ✋ กัน state ค้าง: นิ้ว 2 แตะเร็วกว่า setSel ของนิ้ว 1 คอมมิต
  selRef.current = sel;

  const state = { template: tpl, slotImages: images, slotCrops: crops, slotOffsets: offsets, slotScales: scales, textValues: texts, fadeOn };
  const stateRef = useRef(state);
  stateRef.current = state;

  // โหลดเทมเพลต
  useEffect(() => {
    fetch('/api/m/cover-editor?view=templates', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d.success && d.templates?.length) { setTemplates(d.templates); setTpl(d.templates[0]); } })
      .catch(() => setErr('โหลดเทมเพลตไม่ได้'));
    loadArchive();
  }, []);

  const loadArchive = useCallback(() => {
    fetch('/api/m/cover-editor?view=archive&limit=12', { cache: 'no-store' })
      .then(r => r.json()).then(d => { if (d.success) setArchive(d.items || []); }).catch(() => {});
  }, []);

  // วาดใหม่ทุกครั้งที่ state เปลี่ยน (throttle ด้วย rAF)
  const paint = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      renderCover(ctx, stateRef.current, { clean: false, selSlot: sel });
    });
  }, [sel]);
  useEffect(() => { paint(); }, [tpl, images, crops, offsets, scales, texts, sel, fadeOn, paint]);

  // ── สัมผัส ──
  const toCanvasPt = (touch) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: (touch.clientX - r.left) * (W / r.width), y: (touch.clientY - r.top) * (H / r.height) };
  };
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const onTouchStart = (e) => {
    const t = e.touches;
    if (t.length === 1) {
      const p = toCanvasPt(t[0]);
      const hit = hitSlot(stateRef.current, p.x, p.y);
      if (hit && hit !== selRef.current) setSel(hit);
      gestureRef.current = { kind: 'drag', id: hit || selRef.current, x: t[0].clientX, y: t[0].clientY, moved: false };
    } else if (t.length === 2) {
      gestureRef.current = null; // นิ้วที่ 2 ลง = ยกเลิกลาก 1 นิ้วที่ค้างอยู่ทันที
      const mid = { clientX: (t[0].clientX + t[1].clientX) / 2, clientY: (t[0].clientY + t[1].clientY) / 2 };
      const p = toCanvasPt(mid);
      const hit = hitSlot(stateRef.current, p.x, p.y);
      // hit ใช้ได้เฉพาะช่องที่มีรูปจริง — ถ้าจุดกลางไปโดนช่องว่าง ให้ fallback ไปช่องที่เลือกอยู่แทน (จาก ref กัน state ค้าง)
      const target = (hit && stateRef.current.slotImages[hit]) ? hit : selRef.current;
      if (target && stateRef.current.slotImages[target]) {
        if (target !== selRef.current) setSel(target);
        gestureRef.current = { kind: 'pinch', id: target, d0: dist(t[0], t[1]), z0: (stateRef.current.slotCrops[target]?.zoom || 1) };
      }
    }
  };
  const onTouchMove = (e) => {
    const g = gestureRef.current;
    if (!g) return;
    const t = e.touches;
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const k = W / r.width; // px จอ → px canvas

    if (g.kind === 'drag' && t.length === 1 && g.id) {
      const dx = (t[0].clientX - g.x) * k, dy = (t[0].clientY - g.y) * k;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) g.moved = true;
      g.x = t[0].clientX; g.y = t[0].clientY;
      if (mode === 'slot') {
        setOffsets(o => ({ ...o, [g.id]: { dx: (o[g.id]?.dx || 0) + dx, dy: (o[g.id]?.dy || 0) + dy } }));
      } else {
        setCrops(cr => ({ ...cr, [g.id]: { ...(cr[g.id] || { zoom: 1 }), panX: (cr[g.id]?.panX || 0) + dx, panY: (cr[g.id]?.panY || 0) + dy } }));
      }
      e.preventDefault();
    } else if (g.kind === 'pinch' && t.length === 2 && g.id) {
      // ✋ จีบ 2 นิ้ว = ซูมรูปในช่องเสมอ ทั้ง 2 โหมด — เฟรม (offsets/scales) ห้ามขยับ/ขยายจากการจีบ
      const ratio = dist(t[0], t[1]) / (g.d0 || 1);
      setCrops(cr => ({ ...cr, [g.id]: { ...(cr[g.id] || {}), zoom: Math.max(1, Math.min(5, g.z0 * ratio)) } }));
      e.preventDefault();
    }
  };
  const onTouchEnd = () => { gestureRef.current = null; };

  // ── ใส่รูป ──
  const pickFor = (slotId) => { setSel(slotId); fileRef.current?.click(); };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !sel) return;
    try {
      const img = await loadScaledImage(f);
      setImages(im => ({ ...im, [sel]: img }));
      setCrops(cr => ({ ...cr, [sel]: { zoom: 1, panX: 0, panY: 0 } }));
      say?.('ใส่รูปแล้ว — ลากเลื่อน/จีบ 2 นิ้วซูมได้');
    } catch { setErr('เปิดรูปไม่ได้ ลองรูปอื่น'); }
  };
  const clearSlot = (id) => {
    setImages(im => { const n = { ...im }; delete n[id]; return n; });
    setCrops(cr => { const n = { ...cr }; delete n[id]; return n; });
  };

  const nudge = (key, val) => {
    if (!sel) return;
    if (key === 'zoom') setCrops(cr => ({ ...cr, [sel]: { ...(cr[sel] || {}), zoom: Math.max(1, Math.min(5, (cr[sel]?.zoom || 1) + val)) } }));
    if (key === 'scale') setScales(s => ({ ...s, [sel]: Math.max(0.3, Math.min(2.5, (s[sel] || 1) + val)) }));
    if (key === 'reset') { setCrops(cr => ({ ...cr, [sel]: { zoom: 1, panX: 0, panY: 0 } })); setOffsets(o => ({ ...o, [sel]: { dx: 0, dy: 0 } })); setScales(s => ({ ...s, [sel]: 1 })); }
  };

  // ── บันทึก & เซฟ (ปุ่มเดียว) ──
  const saveCover = async () => {
    if (!tpl) return;
    if (Object.keys(images).length === 0) { setErr('ใส่รูปอย่างน้อย 1 ช่องก่อน'); return; }
    setErr(''); setSaving(true);
    try {
      let b64 = exportCover(stateRef.current, 0.9);
      if (b64.length > 3_500_000) b64 = exportCover(stateRef.current, 0.8);
      const d = await (await fetch('/api/m/cover-editor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', base64: b64, title: title.trim(), draftId: draftRef.current, templateId: tpl.id }),
      })).json();
      if (!d.success) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
      setSaved({ id: d.id, imgUrl: d.imgUrl });
      onLog?.('cover_save', d.id || '', { template: tpl.id, slots: Object.keys(images).length });
      say?.(d.confirmed ? 'บันทึกลงคลังแล้ว' : 'บันทึกภาพแล้ว (รอขึ้นคลัง)');
      loadArchive();
    } catch (e2) {
      const m = String(e2.message || e2);
      setErr(m.includes('SecurityError') || m.includes('tainted') ? 'มีรูปจากเว็บนอกที่บันทึกไม่ได้ — ลองใช้รูปจากเครื่องแทน' : m);
    }
    setSaving(false);
  };

  const newDraft = () => {
    draftRef.current = newDraftId();
    setImages({}); setCrops({}); setOffsets({}); setScales({}); setTexts({}); setSel(null); setSaved(null); setTitle('');
    say?.('เริ่มปกใบใหม่');
  };

  const slots = tpl?.slots || [];
  const filled = Object.keys(images).length;

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />

      {/* เลือกเทมเพลต */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 10 }}>
        {templates.map(t => (
          <button key={t.id} onClick={() => { setTpl(t); setSel(null); }}
            style={{ flex: 'none', padding: '9px 14px', borderRadius: 12, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
              border: tpl?.id === t.id ? '2px solid var(--pink)' : '1px solid var(--line)',
              background: tpl?.id === t.id ? 'var(--pinkS)' : 'var(--card)', color: tpl?.id === t.id ? 'var(--pink)' : 'var(--sub)' }}>
            {t.name || t.id}
          </button>
        ))}
        {templates.length === 0 && <span className="sub">กำลังโหลดเทมเพลต…</span>}
      </div>

      {/* ปก */}
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', background: '#0b0b0f' }}>
        <canvas ref={canvasRef} width={W} height={H}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
          style={{ width: '100%', display: 'block', touchAction: 'none' }} />
      </div>

      {/* โหมดลาก */}
      <div className="seg" style={{ marginTop: 10 }}>
        <button className={mode === 'img' ? 'on' : ''} onClick={() => setMode('img')}>เลื่อนรูปในช่อง</button>
        <button className={mode === 'slot' ? 'on' : ''} onClick={() => setMode('slot')}>ย้าย/ย่อช่อง</button>
        <button className={fadeOn ? 'on' : ''} onClick={() => setFadeOn(v => !v)}>{fadeOn ? 'ไล่ขอบ: เปิด' : 'ไล่ขอบ: ปิด'}</button>
      </div>

      {/* ชิปช่อง */}
      <p className="sub" style={{ margin: '4px 0 8px' }}>ใส่รูปแล้ว {filled}/{slots.length} ช่อง · แตะช่องบนปกหรือชิปด้านล่างเพื่อเลือก</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
        {slots.map(s => {
          const has = !!images[s.id];
          const on = sel === s.id;
          return (
            <button key={s.id} onClick={() => (has ? setSel(s.id) : pickFor(s.id))}
              style={{ padding: '8px 12px', borderRadius: 11, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                border: on ? '2px solid var(--pink)' : '1px solid var(--line)',
                background: on ? 'var(--pinkS)' : 'var(--card)', color: on ? 'var(--pink)' : has ? 'var(--ink)' : 'var(--mut)' }}>
              {has ? '✓ ' : '+ '}{String(s.label || s.id).replace(/\s*\(.*\)\s*$/, '')}
            </button>
          );
        })}
      </div>

      {/* แผงเครื่องมือของช่องที่เลือก */}
      {sel && <div className="reader" style={{ padding: 12, marginBottom: 10 }}>
        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>ช่อง: {String(slots.find(s => s.id === sel)?.label || sel).replace(/\s*\(.*\)\s*$/, '')}</p>
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="gh" onClick={() => pickFor(sel)}>{images[sel] ? 'เปลี่ยนรูป' : 'เลือกรูป'}</button>
          {images[sel] && <button className="gh" onClick={() => clearSlot(sel)}>เอารูปออก</button>}
        </div>
        {images[sel] && <div className="row" style={{ marginBottom: 8 }}>
          <button className="gh" onClick={() => nudge(mode === 'slot' ? 'scale' : 'zoom', -0.15)}>− เล็กลง</button>
          <button className="gh" onClick={() => nudge(mode === 'slot' ? 'scale' : 'zoom', 0.15)}>+ ใหญ่ขึ้น</button>
          <button className="gh" onClick={() => nudge('reset')}>รีเซ็ต</button>
        </div>}
        <p className="mm">ลาก 1 นิ้วบนปก = {mode === 'slot' ? 'ย้ายทั้งช่อง' : 'เลื่อนรูปในช่อง'} · จีบ 2 นิ้ว = ซูมรูปในช่องเสมอ (ทุกโหมด)</p>
      </div>}

      {/* ข้อความบนปก (เฉพาะเทมเพลตที่มี) */}
      {(tpl?.textSlots || []).length > 0 && <div style={{ marginBottom: 10 }}>
        {tpl.textSlots.map(ts => (
          <input key={ts.id} className="in" style={{ marginBottom: 7 }} value={texts[ts.id] || ''}
            onChange={e => setTexts(t => ({ ...t, [ts.id]: e.target.value }))}
            placeholder={ts.placeholder || ts.label} />
        ))}
      </div>}

      {/* ชื่อ + บันทึก */}
      <input className="in" style={{ marginBottom: 9 }} value={title} onChange={e => setTitle(e.target.value)} placeholder="ชื่อปก (ไว้ค้นในคลัง)…" />
      {err && <div className="err">{err}</div>}
      <button className="cta" disabled={saving} onClick={saveCover}>{saving ? 'กำลังบันทึก…' : '💾 บันทึก & เซฟลงคลัง'}</button>

      {saved && <div className="reader" style={{ marginTop: 10 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ok)', marginBottom: 8 }}>✅ เข้าคลังแล้ว · {saved.id}</p>
        {saved.imgUrl && <img src={saved.imgUrl} alt="ปกที่บันทึก" style={{ width: '100%', borderRadius: 12 }} />}
        <div className="row" style={{ marginTop: 9 }}>
          {saved.imgUrl && <a className="gh" style={{ textDecoration: 'none' }} href={saved.imgUrl} download={`${saved.id}.jpg`}>⬇️ โหลดลงเครื่อง</a>}
          <button className="gh" onClick={newDraft}>ทำปกใบใหม่</button>
        </div>
      </div>}

      {archive.length > 0 && <>
        <h2>ปกที่แต่งจากแอพ</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
          {archive.map(a => (
            <a key={a.id} href={`/api/mega-covers/img?id=${a.id}`} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
              <img src={`/api/mega-covers/img?id=${a.id}`} alt={a.title || a.id}
                style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
            </a>
          ))}
        </div>
      </>}
    </div>
  );
}
