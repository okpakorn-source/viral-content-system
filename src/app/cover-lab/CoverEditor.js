'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useCoverCanvas } from '@/lib/cover/useCoverCanvas';
import { W, H } from '@/lib/cover/constants';

// ═══════════════════════════════════════════════════════════
// BUILTIN TEMPLATE DEFINITIONS (shared with page.js)
// Canvas = 1200 x 1350 px
// ═══════════════════════════════════════════════════════════
const BUILTIN_TEMPLATES = [
  {
    id: 'template_1', name: 'ข่าวดราม่า 5 ช่อง', desc: '5 รูป', textSlots: [],
    slots: [
      { id: 'main',      label: '★ ภาพหลัก',     x: 0,   y: 0,   w: 750, h: 1350, fadeRight: 150,                  zIndex: 2 },
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',   x: 380, y: 0,   w: 820, h: 720,  fadeLeft: 190, fadeBottom: 140,  zIndex: 0 },
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',  x: 350, y: 580, w: 850, h: 770,  fadeLeft: 160, fadeTop: 160,    zIndex: 1 },
      { id: 'highlight', label: '⭐ ไฮไลท์',      x: 370, y: 280, w: 560, h: 400,  border: '#CCFF00', borderWidth: 5, zIndex: 3, draggable: true },
      { id: 'sub_left',  label: '🖼 ภาพรอง',       x: 15,  y: 610, w: 520, h: 430,  border: '#FFFFFF', borderWidth: 4, zIndex: 4, draggable: true },
    ],
  },
  {
    id: 'template_2', name: 'ข่าวสะอาด 4 ช่อง', desc: '4 รูป', textSlots: [],
    slots: [
      { id: 'main',      label: '★ ภาพหลัก',     x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 170,                  zIndex: 2 },
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',   x: 400, y: 0,   w: 800, h: 740,  fadeLeft: 180, fadeBottom: 150,  zIndex: 0 },
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',  x: 380, y: 520, w: 820, h: 830,  fadeLeft: 170, fadeTop: 160,    zIndex: 1 },
      { id: 'highlight', label: '⭐ ไฮไลท์',      x: 120, y: 580, w: 560, h: 360,  border: '#333333', borderWidth: 5, zIndex: 3, draggable: true },
    ],
  },
  {
    id: 'template_3', name: 'ข่าวดราม่า + วงกลม', desc: '5 รูป', textSlots: [],
    slots: [
      { id: 'main',      label: '★ ภาพหลัก',     x: 0,   y: 0,   w: 740, h: 1350, fadeRight: 150,                  zIndex: 2 },
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',   x: 400, y: 0,   w: 800, h: 720,  fadeLeft: 180, fadeBottom: 140,  zIndex: 0 },
      { id: 'bg_bottom', label: '🖼 อารมณ์ล่าง',   x: 380, y: 580, w: 820, h: 770,  fadeLeft: 160, fadeTop: 150,    zIndex: 1 },
      { id: 'highlight', label: '⭐ ไฮไลท์',      x: 340, y: 280, w: 630, h: 440,  border: '#CCFF00', borderWidth: 5, zIndex: 3, draggable: true },
      { id: 'circle',    label: '⭕ วงกลม',       x: 25,  y: 680, shape: 'circle', diameter: 440, border: '#FFFFFF', borderWidth: 6, zIndex: 4, draggable: true },
    ],
  },
  {
    id: 'template_4', name: 'ข่าวสังคม + 2 วงกลม', desc: '5 รูป + ข้อความ',
    textSlots: [
      { id: 'line1', label: '📝 บรรทัด 1', x: 730, y: 680, fontSize: 48, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 4, placeholder: 'พาดหัวหลัก...' },
      { id: 'line2', label: '📝 บรรทัด 2', x: 730, y: 760, fontSize: 40, color: '#FFD700', fontWeight: 'bold', align: 'center', maxWidth: 520, stroke: '#000', strokeWidth: 3, bg: 'rgba(0,0,0,0.65)', bgPadY: 12, bgFullWidth: false, bgEditable: true, placeholder: 'รายละเอียด...' },
    ],
    slots: [
      { id: 'main',         label: '★ ภาพหลัก',     x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 170,                  zIndex: 2 },
      { id: 'bg_top',       label: '🖼 ฉากบน-ขวา',   x: 380, y: 0,   w: 820, h: 700,  fadeLeft: 170, fadeBottom: 140,  zIndex: 0 },
      { id: 'bg_bottom',    label: '🖼 ฉากล่าง-ขวา',  x: 350, y: 550, w: 850, h: 800,  fadeLeft: 160, fadeTop: 150,    zIndex: 1 },
      { id: 'circle',       label: '⭕ วงกลมใหญ่',   x: 25,  y: 680, shape: 'circle', diameter: 400, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
      { id: 'circle_small', label: '⭕ วงกลมเล็ก',   x: 890, y: 15,  shape: 'circle', diameter: 200, border: '#FF0000', borderWidth: 4, zIndex: 5, draggable: true },
    ],
  },
  {
    id: 'template_5', name: 'ข่าวเหตุการณ์ 5 ช่อง', desc: '5 รูป', textSlots: [],
    slots: [
      { id: 'main',      label: '★ ภาพหลัก',     x: 0,   y: 0,   w: 730, h: 1350, fadeRight: 170,                  zIndex: 2 },
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',   x: 400, y: 0,   w: 800, h: 700,  fadeLeft: 180, fadeBottom: 140,  zIndex: 0 },
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',  x: 350, y: 560, w: 850, h: 790,  fadeLeft: 160, fadeTop: 150,    zIndex: 1 },
      { id: 'highlight', label: '⭐ ไฮไลท์',      x: 420, y: 310, w: 580, h: 410,  border: '#FFD700', borderWidth: 5, zIndex: 3, draggable: true },
      { id: 'circle',    label: '⭕ วงกลม',       x: 15,  y: 630, shape: 'circle', diameter: 460, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
    ],
  },
  {
    id: 'template_6', name: 'ข่าวสะเทือนใจ + ข้อความ', desc: '5 รูป + ข้อความ',
    textSlots: [
      { id: 'line1', label: '📝 บรรทัด 1', x: 620, y: 580, fontSize: 46, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 480, stroke: '#000', strokeWidth: 4, placeholder: 'พาดหัวหลัก...' },
      { id: 'line2', label: '📝 บรรทัด 2', x: 620, y: 660, fontSize: 40, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 3, placeholder: 'รายละเอียด...' },
    ],
    slots: [
      { id: 'main',         label: '★ ภาพหลัก',     x: 0,   y: 0,   w: 700, h: 1350, fadeRight: 160,                  zIndex: 2 },
      { id: 'bg_top',       label: '🖼 ฉากบน-ขวา',   x: 380, y: 0,   w: 820, h: 650,  fadeLeft: 170, fadeBottom: 130,  zIndex: 0 },
      { id: 'bg_bottom',    label: '🖼 ฉากล่าง-ขวา',  x: 340, y: 520, w: 860, h: 830,  fadeLeft: 160, fadeTop: 150,    zIndex: 1 },
      { id: 'circle_small', label: '⭕ วงกลมเล็ก',   x: 440, y: 180, shape: 'circle', diameter: 160, border: '#FF0000', borderWidth: 3, zIndex: 5, draggable: true },
      { id: 'circle',       label: '⭕ วงกลมใหญ่',   x: 50,  y: 680, shape: 'circle', diameter: 360, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
    ],
  },
];

// ═══════════════════════════════════════════════════════════
// Template Thumbnail for selector
// ═══════════════════════════════════════════════════════════
function TemplateThumbnail({ template, isActive, onClick }) {
  const sc = 56 / W, th = H * sc;
  return (
    <button onClick={onClick} title={template.name} style={{
      padding: 0, border: isActive ? '2px solid #a3e635' : '2px solid #374151',
      borderRadius: 6, background: '#1a1a2e', cursor: 'pointer',
      width: 60, height: th + 4, overflow: 'hidden', transition: 'all .15s',
      boxShadow: isActive ? '0 0 10px rgba(163,230,53,0.3)' : 'none', flexShrink: 0,
    }}>
      <svg width={56} height={th} viewBox={`0 0 ${W} ${H}`}>
        <rect width={W} height={H} fill="#111" />
        {template.slots.map(sl => sl.shape === 'circle'
          ? <circle key={sl.id} cx={sl.x + sl.diameter / 2} cy={sl.y + sl.diameter / 2} r={sl.diameter / 2} fill="none" stroke={sl.border || '#4FC3F7'} strokeWidth={14} opacity={0.7} />
          : <rect key={sl.id} x={sl.x} y={sl.y} width={sl.w} height={sl.h} fill={sl.border || (sl.id === 'main' ? '#a3e635' : '#556')} opacity={sl.id === 'main' ? 0.4 : 0.25} stroke={sl.border || 'none'} strokeWidth={sl.border ? 12 : 0} />
        )}
      </svg>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
// Custom Text Overlay rendering on canvas (drawn after main render)
// ═══════════════════════════════════════════════════════════
function drawCustomTexts(ctx, customTexts) {
  for (const t of customTexts) {
    if (!t.text) continue;
    ctx.save();
    const fs = t.fontSize || 40;
    ctx.font = `${t.bold ? 'bold' : 'normal'} ${fs}px "Noto Sans Thai","Sarabun",sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    // Stroke
    if (t.stroke !== false) {
      ctx.strokeStyle = t.strokeColor || '#000';
      ctx.lineWidth = t.strokeWidth || Math.max(3, fs * 0.08);
      ctx.lineJoin = 'round';
      ctx.strokeText(t.text, t.x, t.y);
    }
    ctx.fillStyle = t.color || '#FFFFFF';
    ctx.fillText(t.text, t.x, t.y);
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN: CoverEditor Component
// ═══════════════════════════════════════════════════════════
export default function CoverEditor({ editImages, editTemplateId, setEditTemplateId, onClose, coverBase64 }) {
  const template = BUILTIN_TEMPLATES.find(t => t.id === editTemplateId) || BUILTIN_TEMPLATES[0];

  const {
    canvasRef, slotImages, setSlotImages,
    slotOffsets, setSlotOffsets, slotScales, setSlotScales,
    slotCrops, setSlotCrops,
    textValues, setTextValues, textOverrides, setTextOverrides,
    hoverCursor,
    handleDown, handleMove, handleUp,
    render, exportAsBlob, resetAll,
  } = useCoverCanvas(template, editImages);

  // ─── Active tool state ───
  const [activeTool, setActiveTool] = useState('move'); // move | text | zoom
  const [activeSlot, setActiveSlot] = useState(null);
  
  // ─── Custom text overlays ───
  const [customTexts, setCustomTexts] = useState([]);
  const [editingTextIdx, setEditingTextIdx] = useState(null);
  const [newTextDraft, setNewTextDraft] = useState({ text: '', color: '#FFFFFF', fontSize: 40, bold: true, strokeColor: '#000000', stroke: true });
  const [showTextPanel, setShowTextPanel] = useState(false);
  
  // ─── Dragging custom text ───
  const [draggingTextIdx, setDraggingTextIdx] = useState(null);
  const dragStartRef = useRef(null);
  
  // ─── Replace slot image ───
  const replaceFileRef = useRef(null);
  const [replaceSlotId, setReplaceSlotId] = useState(null);

  // ─── Collapsed panel state ───
  const [panelTab, setPanelTab] = useState('slots'); // slots | text | template

  // Sync editImages
  useEffect(() => {
    if (editImages && Object.keys(editImages).length > 0) {
      setSlotImages(editImages);
    }
  }, [editImages, setSlotImages]);

  // Re-render with custom texts after hook renders
  useEffect(() => {
    if (customTexts.length > 0 && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      drawCustomTexts(ctx, customTexts);
    }
  });

  // ─── Scale adjust ───
  const adjustScale = (slotId, delta) => {
    setSlotScales(prev => {
      const cur = prev[slotId] || 1;
      return { ...prev, [slotId]: Math.max(0.3, Math.min(2.5, +(cur + delta).toFixed(2))) };
    });
  };

  // ─── Offset adjust ───
  const adjustOffset = (slotId, axis, delta) => {
    setSlotOffsets(prev => {
      const old = prev[slotId] || { dx: 0, dy: 0 };
      return { ...prev, [slotId]: { dx: old.dx + (axis === 'x' ? delta : 0), dy: old.dy + (axis === 'y' ? delta : 0) } };
    });
  };

  // ─── Crop zoom adjust ───
  const adjustCropZoom = (slotId, delta) => {
    setSlotCrops(prev => {
      const old = prev[slotId] || { zoom: 1, panX: 0, panY: 0 };
      const newZoom = Math.max(1, Math.min(5, +(old.zoom + delta).toFixed(2)));
      return { ...prev, [slotId]: { ...old, zoom: newZoom } };
    });
  };

  // ─── Replace slot image handler ───
  const handleReplaceImage = (e) => {
    const file = e.target.files?.[0];
    if (!file || !replaceSlotId) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setSlotImages(prev => ({ ...prev, [replaceSlotId]: img }));
        setReplaceSlotId(null);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    if (replaceFileRef.current) replaceFileRef.current.value = '';
  };

  // ─── Custom text: add ───
  const addCustomText = () => {
    if (!newTextDraft.text.trim()) return;
    setCustomTexts(prev => [...prev, {
      ...newTextDraft,
      x: 100 + Math.random() * 300,
      y: 600 + Math.random() * 200,
      strokeWidth: Math.max(3, newTextDraft.fontSize * 0.08),
    }]);
    setNewTextDraft({ text: '', color: '#FFFFFF', fontSize: 40, bold: true, strokeColor: '#000000', stroke: true });
  };

  // ─── Custom text: update ───
  const updateCustomText = (idx, field, value) => {
    setCustomTexts(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  };

  // ─── Custom text: delete ───
  const deleteCustomText = (idx) => {
    setCustomTexts(prev => prev.filter((_, i) => i !== idx));
    if (editingTextIdx === idx) setEditingTextIdx(null);
  };

  // ─── Canvas pointer handler for custom text drag ───
  const handleCanvasPointerDown = (cx, cy) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const mx = (cx - r.left) * (W / r.width);
    const my = (cy - r.top) * (H / r.height);

    // Check if clicking on a custom text
    if (activeTool === 'text' || activeTool === 'move') {
      for (let i = customTexts.length - 1; i >= 0; i--) {
        const t = customTexts[i];
        const fs = t.fontSize || 40;
        const tw = t.text.length * fs * 0.55;
        const th = fs * 1.3;
        if (mx >= t.x && mx <= t.x + tw && my >= t.y && my <= t.y + th) {
          setDraggingTextIdx(i);
          dragStartRef.current = { mx, my, origX: t.x, origY: t.y };
          return; // capture this — don't pass to canvas handler
        }
      }
    }

    // Pass to canvas handler for slot drag
    handleDown(cx, cy);
  };

  const handleCanvasPointerMove = (cx, cy) => {
    if (draggingTextIdx !== null && dragStartRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const mx = (cx - r.left) * (W / r.width);
      const my = (cy - r.top) * (H / r.height);
      const dx = mx - dragStartRef.current.mx;
      const dy = my - dragStartRef.current.my;
      updateCustomText(draggingTextIdx, 'x', dragStartRef.current.origX + dx);
      updateCustomText(draggingTextIdx, 'y', dragStartRef.current.origY + dy);
      return;
    }
    handleMove(cx, cy);
  };

  const handleCanvasPointerUp = () => {
    setDraggingTextIdx(null);
    dragStartRef.current = null;
    handleUp();
  };

  // ─── Download ───
  const handleDownload = async () => {
    // Render without handles first
    const blob = await exportAsBlob(null);
    if (!blob) return;
    // Draw custom texts on a final export canvas
    if (customTexts.length > 0) {
      const expCanvas = document.createElement('canvas');
      expCanvas.width = W;
      expCanvas.height = H;
      const ectx = expCanvas.getContext('2d');
      // Draw the hook's output
      ectx.drawImage(canvasRef.current, 0, 0);
      drawCustomTexts(ectx, customTexts);
      expCanvas.toBlob((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cover-edited-${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
        // Re-render with handles
        setTimeout(() => render(true), 100);
      }, 'image/jpeg', 0.95);
    } else {
      // No custom texts — just use exportAsBlob
      exportAsBlob(`cover-edited-${Date.now()}.jpg`);
    }
  };

  // ─── Full Reset ───
  const handleFullReset = () => {
    resetAll();
    setCustomTexts([]);
    setEditingTextIdx(null);
    setTextValues({});
  };

  const filledSlots = template.slots.filter(sl => slotImages[sl.id]);

  // Hidden file input for slot image replacement
  const triggerReplace = (slotId) => {
    setReplaceSlotId(slotId);
    setTimeout(() => replaceFileRef.current?.click(), 50);
  };

  return (
    <div style={styles.wrapper}>
      {/* Hidden file input for replacing slot images */}
      <input type="file" ref={replaceFileRef} accept="image/*" style={{ display: 'none' }} onChange={handleReplaceImage} />

      {/* ═══ HEADER ═══ */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>✏️</span>
          <div>
            <h3 style={styles.title}>Cover Editor</h3>
            <p style={styles.subtitle}>{template.name}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={handleFullReset} style={styles.headerBtn} title="รีเซ็ตทั้งหมด">🔄</button>
          <button onClick={onClose} style={{ ...styles.headerBtn, background: '#dc2626' }} title="ปิด Editor">✕</button>
        </div>
      </div>

      {/* ═══ TOOLBAR ═══ */}
      <div style={styles.toolbar}>
        {[
          { id: 'move', icon: '🖱️', label: 'เลื่อน' },
          { id: 'zoom', icon: '🔍', label: 'ซูม' },
          { id: 'text', icon: '📝', label: 'ข้อความ' },
        ].map(tool => (
          <button
            key={tool.id}
            onClick={() => { setActiveTool(tool.id); if (tool.id === 'text') setShowTextPanel(true); }}
            style={{
              ...styles.toolBtn,
              background: activeTool === tool.id ? '#6366f1' : '#1e293b',
              color: activeTool === tool.id ? '#fff' : '#94a3b8',
              borderColor: activeTool === tool.id ? '#818cf8' : '#374151',
            }}
          >
            <span style={{ fontSize: 16 }}>{tool.icon}</span>
            <span style={{ fontSize: 10 }}>{tool.label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={handleDownload} style={styles.downloadBtn}>
          💾 ดาวน์โหลด
        </button>
      </div>

      {/* ═══ MAIN LAYOUT: Canvas + Sidebar ═══ */}
      <div style={styles.mainLayout}>
        {/* Canvas Area */}
        <div style={styles.canvasArea}>
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid #374151' }}>
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              style={{ width: '100%', cursor: draggingTextIdx !== null ? 'grabbing' : hoverCursor, display: 'block' }}
              onMouseDown={e => handleCanvasPointerDown(e.clientX, e.clientY)}
              onMouseMove={e => handleCanvasPointerMove(e.clientX, e.clientY)}
              onMouseUp={handleCanvasPointerUp}
              onMouseLeave={handleCanvasPointerUp}
              onTouchStart={e => { e.preventDefault(); const t = e.touches[0]; handleCanvasPointerDown(t.clientX, t.clientY); }}
              onTouchMove={e => { e.preventDefault(); const t = e.touches[0]; handleCanvasPointerMove(t.clientX, t.clientY); }}
              onTouchEnd={handleCanvasPointerUp}
            />
            {/* Canvas help hint */}
            <div style={styles.canvasHint}>
              {activeTool === 'move' && '🖱️ ลาก=เลื่อนรูป | ขอบ=ย้ายกรอบ | มุม=ปรับขนาด'}
              {activeTool === 'zoom' && '🔍 Scroll=ซูมภาพใน slot | หรือใช้ปุ่ม +/- ด้านข้าง'}
              {activeTool === 'text' && '📝 ลากข้อความเพื่อย้ายตำแหน่ง | เพิ่มข้อความจากแผงขวา'}
            </div>
          </div>
        </div>

        {/* ═══ SIDEBAR ═══ */}
        <div style={styles.sidebar}>
          {/* Tab selector */}
          <div style={styles.tabBar}>
            {[
              { id: 'slots', label: '🎛️ Slots' },
              { id: 'text', label: '📝 ข้อความ' },
              { id: 'template', label: '📐 Layout' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setPanelTab(tab.id)}
                style={{
                  ...styles.tabBtn,
                  background: panelTab === tab.id ? '#374151' : 'transparent',
                  color: panelTab === tab.id ? '#e2e8f0' : '#64748b',
                  borderBottom: panelTab === tab.id ? '2px solid #a3e635' : '2px solid transparent',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ─── TAB: Slots ─── */}
          {panelTab === 'slots' && (
            <div style={styles.panelContent}>
              <p style={styles.sectionLabel}>🎛️ ปรับแต่งรายช่อง</p>
              {filledSlots.length === 0 && (
                <p style={{ color: '#64748b', fontSize: 12 }}>ไม่มีภาพในช่อง</p>
              )}
              {filledSlots.map(slot => {
                const sc = slotScales[slot.id] || 1;
                const cropZoom = slotCrops[slot.id]?.zoom || 1;
                const isActive = activeSlot === slot.id;
                return (
                  <div
                    key={slot.id}
                    onClick={() => setActiveSlot(isActive ? null : slot.id)}
                    style={{
                      ...styles.slotCard,
                      borderColor: isActive ? '#6366f1' : '#1e293b',
                    }}
                  >
                    {/* Slot header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#a3e635', fontWeight: 700 }}>
                        {slot.label || slot.id}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); triggerReplace(slot.id); }}
                        style={styles.tinyBtn}
                        title="เปลี่ยนรูป"
                      >
                        📷
                      </button>
                    </div>

                    {/* Controls — shown when active */}
                    {isActive && (
                      <div style={{ marginTop: 8 }}>
                        {/* Scale */}
                        <div style={styles.controlRow}>
                          <span style={styles.controlLabel}>ขนาดช่อง</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button onClick={(e) => { e.stopPropagation(); adjustScale(slot.id, -0.1); }} style={styles.ctrlBtn}>−</button>
                            <span style={styles.controlVal}>{sc.toFixed(1)}x</span>
                            <button onClick={(e) => { e.stopPropagation(); adjustScale(slot.id, 0.1); }} style={styles.ctrlBtn}>+</button>
                          </div>
                        </div>
                        {/* Crop zoom */}
                        <div style={styles.controlRow}>
                          <span style={styles.controlLabel}>ซูมภาพ</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button onClick={(e) => { e.stopPropagation(); adjustCropZoom(slot.id, -0.2); }} style={styles.ctrlBtn}>−</button>
                            <span style={styles.controlVal}>{cropZoom.toFixed(1)}x</span>
                            <button onClick={(e) => { e.stopPropagation(); adjustCropZoom(slot.id, 0.2); }} style={styles.ctrlBtn}>+</button>
                          </div>
                        </div>
                        {/* Position */}
                        <div style={styles.controlRow}>
                          <span style={styles.controlLabel}>ตำแหน่ง</span>
                          <div style={{ display: 'flex', gap: 3 }}>
                            <button onClick={(e) => { e.stopPropagation(); adjustOffset(slot.id, 'x', -25); }} style={styles.ctrlBtn}>◀</button>
                            <button onClick={(e) => { e.stopPropagation(); adjustOffset(slot.id, 'y', -25); }} style={styles.ctrlBtn}>▲</button>
                            <button onClick={(e) => { e.stopPropagation(); adjustOffset(slot.id, 'y', 25); }} style={styles.ctrlBtn}>▼</button>
                            <button onClick={(e) => { e.stopPropagation(); adjustOffset(slot.id, 'x', 25); }} style={styles.ctrlBtn}>▶</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── TAB: Text ─── */}
          {panelTab === 'text' && (
            <div style={styles.panelContent}>
              {/* Template text slots */}
              {template.textSlots?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <p style={styles.sectionLabel}>📝 ข้อความ Template</p>
                  {template.textSlots.map(ts => (
                    <div key={ts.id} style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 3 }}>{ts.label}</label>
                      <input
                        value={textValues[ts.id] || ''}
                        onChange={e => setTextValues(prev => ({ ...prev, [ts.id]: e.target.value }))}
                        placeholder={ts.placeholder || 'พิมพ์ข้อความ...'}
                        style={styles.textInput}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Custom text overlays */}
              <p style={styles.sectionLabel}>✨ ข้อความเพิ่มเติม</p>
              
              {/* Add new text */}
              <div style={styles.addTextBox}>
                <input
                  value={newTextDraft.text}
                  onChange={e => setNewTextDraft(prev => ({ ...prev, text: e.target.value }))}
                  placeholder="พิมพ์ข้อความใหม่..."
                  style={styles.textInput}
                  onKeyDown={e => { if (e.key === 'Enter') addCustomText(); }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Color */}
                  <label style={styles.colorLabel}>
                    สี
                    <input type="color" value={newTextDraft.color} onChange={e => setNewTextDraft(prev => ({ ...prev, color: e.target.value }))} style={styles.colorInput} />
                  </label>
                  {/* Stroke color */}
                  <label style={styles.colorLabel}>
                    ขอบ
                    <input type="color" value={newTextDraft.strokeColor} onChange={e => setNewTextDraft(prev => ({ ...prev, strokeColor: e.target.value }))} style={styles.colorInput} />
                  </label>
                  {/* Font size */}
                  <select value={newTextDraft.fontSize} onChange={e => setNewTextDraft(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))} style={styles.selectSmall}>
                    {[24, 28, 32, 36, 40, 48, 56, 64, 72, 80].map(s => <option key={s} value={s}>{s}px</option>)}
                  </select>
                  {/* Bold */}
                  <button
                    onClick={() => setNewTextDraft(prev => ({ ...prev, bold: !prev.bold }))}
                    style={{ ...styles.ctrlBtn, fontWeight: newTextDraft.bold ? 900 : 400, background: newTextDraft.bold ? '#374151' : '#0f172a' }}
                  >
                    B
                  </button>
                  {/* Add button */}
                  <button onClick={addCustomText} style={styles.addTextBtn} disabled={!newTextDraft.text.trim()}>
                    ＋ เพิ่ม
                  </button>
                </div>
              </div>

              {/* List of custom texts */}
              {customTexts.map((ct, idx) => (
                <div key={idx} style={styles.customTextItem}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: ct.color, fontWeight: ct.bold ? 700 : 400, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ct.text}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => setEditingTextIdx(editingTextIdx === idx ? null : idx)} style={styles.tinyBtn}>✏️</button>
                      <button onClick={() => deleteCustomText(idx)} style={{ ...styles.tinyBtn, color: '#f87171' }}>🗑️</button>
                    </div>
                  </div>
                  {editingTextIdx === idx && (
                    <div style={{ marginTop: 6 }}>
                      <input value={ct.text} onChange={e => updateCustomText(idx, 'text', e.target.value)} style={styles.textInput} />
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        <label style={styles.colorLabel}>
                          สี <input type="color" value={ct.color} onChange={e => updateCustomText(idx, 'color', e.target.value)} style={styles.colorInput} />
                        </label>
                        <label style={styles.colorLabel}>
                          ขอบ <input type="color" value={ct.strokeColor || '#000'} onChange={e => updateCustomText(idx, 'strokeColor', e.target.value)} style={styles.colorInput} />
                        </label>
                        <select value={ct.fontSize} onChange={e => updateCustomText(idx, 'fontSize', parseInt(e.target.value))} style={styles.selectSmall}>
                          {[24, 28, 32, 36, 40, 48, 56, 64, 72, 80].map(s => <option key={s} value={s}>{s}px</option>)}
                        </select>
                        <button
                          onClick={() => updateCustomText(idx, 'bold', !ct.bold)}
                          style={{ ...styles.ctrlBtn, fontWeight: ct.bold ? 900 : 400, background: ct.bold ? '#374151' : '#0f172a' }}
                        >
                          B
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {customTexts.length === 0 && (
                <p style={{ color: '#475569', fontSize: 11, marginTop: 8 }}>ยังไม่มีข้อความเพิ่มเติม — พิมพ์ด้านบนเพื่อเพิ่ม</p>
              )}
            </div>
          )}

          {/* ─── TAB: Template ─── */}
          {panelTab === 'template' && (
            <div style={styles.panelContent}>
              <p style={styles.sectionLabel}>📐 เปลี่ยน Template</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {BUILTIN_TEMPLATES.map(t => (
                  <TemplateThumbnail
                    key={t.id}
                    template={t}
                    isActive={t.id === editTemplateId}
                    onClick={() => setEditTemplateId(t.id)}
                  />
                ))}
              </div>
              <p style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>
                ⚠️ เปลี่ยน template จะปรับ layout ใหม่ — ภาพยังคงเดิม
              </p>

              {/* Current template info */}
              <div style={{ marginTop: 16, padding: 10, background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#a3e635', marginBottom: 4 }}>{template.name}</p>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{template.desc}</p>
                <p style={{ fontSize: 10, color: '#64748b', marginTop: 4, margin: 0 }}>
                  📷 {template.slots.length} ช่องภาพ
                  {template.textSlots?.length > 0 && ` | 📝 ${template.textSlots.length} ข้อความ`}
                  {template.slots.filter(s => s.draggable).length > 0 && ` | 🖱️ ${template.slots.filter(s => s.draggable).length} ลากได้`}
                </p>
              </div>
            </div>
          )}

          {/* ─── Bottom actions ─── */}
          <div style={styles.bottomActions}>
            <button onClick={handleFullReset} style={styles.resetBtn}>
              🔄 รีเซ็ตทั้งหมด
            </button>
            <button onClick={handleDownload} style={styles.dlBtn}>
              💾 ดาวน์โหลด JPEG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════
const styles = {
  wrapper: {
    marginTop: 16, background: '#0a0f1a', borderRadius: 12,
    border: '2px solid #6366f1', overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', background: '#111827', borderBottom: '1px solid #1e293b',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#a78bfa', margin: 0 },
  subtitle: { fontSize: 11, color: '#64748b', margin: 0 },
  headerBtn: {
    width: 32, height: 32, borderRadius: 6, border: 'none', cursor: 'pointer',
    background: '#374151', color: '#e2e8f0', fontSize: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  toolbar: {
    display: 'flex', gap: 6, padding: '8px 12px', background: '#111827',
    borderBottom: '1px solid #1e293b', alignItems: 'center', overflowX: 'auto',
  },
  toolBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    padding: '6px 12px', borderRadius: 6, border: '1px solid',
    cursor: 'pointer', transition: 'all .15s', minWidth: 52,
  },
  downloadBtn: {
    padding: '8px 16px', background: 'linear-gradient(135deg, #065f46, #047857)',
    color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  mainLayout: {
    display: 'flex', gap: 0, minHeight: 400,
  },
  canvasArea: {
    flex: '1 1 60%', padding: 12, minWidth: 0,
  },
  canvasHint: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    background: 'rgba(0,0,0,0.75)', padding: '4px 10px', borderRadius: 6,
    fontSize: 10, color: '#94a3b8', textAlign: 'center',
  },
  sidebar: {
    flex: '0 0 260px', display: 'flex', flexDirection: 'column',
    background: '#111827', borderLeft: '1px solid #1e293b',
    maxHeight: 'calc(100vh - 200px)', overflow: 'hidden',
  },
  tabBar: {
    display: 'flex', borderBottom: '1px solid #1e293b',
  },
  tabBtn: {
    flex: 1, padding: '8px 4px', border: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 600, background: 'transparent', transition: 'all .15s',
  },
  panelContent: {
    padding: '12px 12px', flex: 1, overflowY: 'auto',
  },
  sectionLabel: {
    fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8, marginTop: 0,
  },
  slotCard: {
    padding: '8px 10px', background: '#1e293b', borderRadius: 8, marginBottom: 6,
    border: '1px solid #1e293b', cursor: 'pointer', transition: 'border-color .15s',
  },
  controlRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  controlLabel: { fontSize: 10, color: '#94a3b8' },
  controlVal: { fontSize: 11, color: '#e2e8f0', minWidth: 32, textAlign: 'center' },
  ctrlBtn: {
    width: 24, height: 24, borderRadius: 4, border: '1px solid #374151',
    background: '#0f172a', color: '#e2e8f0', fontSize: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  },
  tinyBtn: {
    background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 4px',
  },
  textInput: {
    width: '100%', padding: '6px 8px', background: '#1e293b', color: '#e2e8f0',
    border: '1px solid #374151', borderRadius: 6, fontSize: 12, outline: 'none',
    boxSizing: 'border-box',
  },
  addTextBox: {
    padding: 10, background: '#1e293b', borderRadius: 8, border: '1px solid #374151',
    marginBottom: 10,
  },
  colorLabel: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#94a3b8',
  },
  colorInput: {
    width: 22, height: 22, border: '1px solid #374151', borderRadius: 4,
    padding: 0, cursor: 'pointer', background: 'none',
  },
  selectSmall: {
    padding: '3px 6px', background: '#0f172a', color: '#e2e8f0',
    border: '1px solid #374151', borderRadius: 4, fontSize: 10, outline: 'none',
  },
  addTextBtn: {
    padding: '4px 12px', background: '#6366f1', color: '#fff', border: 'none',
    borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },
  customTextItem: {
    padding: 8, background: '#0f172a', borderRadius: 6, border: '1px solid #1e293b',
    marginBottom: 6,
  },
  bottomActions: {
    padding: '10px 12px', borderTop: '1px solid #1e293b',
    display: 'flex', gap: 6,
  },
  resetBtn: {
    flex: 1, padding: '10px', background: '#374151', color: '#94a3b8',
    border: '1px solid #4b5563', borderRadius: 8, fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
  },
  dlBtn: {
    flex: 1, padding: '10px', background: 'linear-gradient(135deg, #065f46, #047857)',
    color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700,
    cursor: 'pointer',
  },
};

// ═══════════════════════════════════════════════════════════
// Responsive: Override sidebar to stack below canvas on mobile
// This is applied via a <style> tag injected in the component
// ═══════════════════════════════════════════════════════════
export function CoverEditorStyles() {
  return (
    <style>{`
      @media (max-width: 768px) {
        .cover-editor-layout { flex-direction: column !important; }
        .cover-editor-sidebar { 
          flex: 1 1 auto !important; 
          max-height: 50vh !important;
          border-left: none !important;
          border-top: 1px solid #1e293b !important;
        }
      }
    `}</style>
  );
}
