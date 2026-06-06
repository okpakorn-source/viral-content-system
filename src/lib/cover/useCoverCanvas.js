'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { W, H } from './constants';
import { drawBlurredBg, drawRectSlot, drawCircleSlot, drawTextSlot, drawTextBg, getEffSlot, drawHandles } from './canvasDrawing';
import { getCoordsRaw, hitTest, hitTestAll, hitTestText } from './hitTesting';

/**
 * React hook for interactive cover canvas editing.
 * Returns state, handlers, and render/export functions.
 * 
 * @param {Object} template - Template definition with slots[], textSlots[], textBg
 * @param {Object} initialImages - { slotId: HTMLImageElement } mapping
 */
export function useCoverCanvas(template, initialImages = {}) {
  const canvasRef = useRef(null);
  const [slotImages, setSlotImages] = useState(initialImages);
  const [slotOffsets, setSlotOffsets] = useState({});
  const [slotScales, setSlotScales] = useState({});
  const [slotCrops, setSlotCrops] = useState({});
  const [textValues, setTextValues] = useState({});
  const [textOverrides, setTextOverrides] = useState({});
  const [textBgColors, setTextBgColors] = useState({});
  const [dragState, setDragState] = useState(null);
  const [hoverCursor, setHoverCursor] = useState('default');

  // Update images when initialImages change
  useEffect(() => {
    if (initialImages && Object.keys(initialImages).length > 0) {
      setSlotImages(initialImages);
    }
  }, [initialImages]);

  // Reset offsets/scales when template changes
  useEffect(() => {
    setSlotOffsets({});
    setSlotScales({});
    setSlotCrops({});
  }, [template?.id]);

  const draggableSlots = template ? template.slots.filter(sl => sl.draggable) : [];

  // --- Pointer handlers ---
  const handleDown = useCallback((cx, cy) => {
    const canvas = canvasRef.current;
    if (!canvas || !template) return;
    const { mx, my } = getCoordsRaw(cx, cy, canvas);

    // 1. Text drag
    const textHit = hitTestText(mx, my, template.textSlots, textValues, textOverrides);
    if (textHit) {
      const ov = textOverrides[textHit.id] || {};
      setDragState({ slotId: textHit.id, mode: 'textmove', startX: mx, startY: my, origDx: ov.dx || 0, origDy: ov.dy || 0 });
      return;
    }

    // 2. Draggable slots (move/resize/crop)
    const hit = hitTest(mx, my, draggableSlots, slotImages, slotOffsets, slotScales);
    if (hit) {
      if (hit.mode === 'crop') {
        const crop = slotCrops[hit.slot.id] || { zoom: 1, panX: 0, panY: 0 };
        setDragState({ slotId: hit.slot.id, mode: 'crop', startX: mx, startY: my, origPanX: crop.panX || 0, origPanY: crop.panY || 0 });
      } else {
        const off = slotOffsets[hit.slot.id] || { dx: 0, dy: 0 };
        const sc = slotScales[hit.slot.id] || 1;
        const eff = getEffSlot(hit.slot, sc);
        if (hit.mode === 'resize') {
          const ecx = eff.x + off.dx + (eff.shape === 'circle' ? eff.diameter / 2 : eff.w / 2);
          const ecy = eff.y + off.dy + (eff.shape === 'circle' ? eff.diameter / 2 : eff.h / 2);
          const startDist = Math.hypot(mx - ecx, my - ecy);
          setDragState({ slotId: hit.slot.id, mode: 'resize', startX: mx, startY: my, origDx: off.dx, origDy: off.dy, origScale: sc, startDist });
        } else {
          setDragState({ slotId: hit.slot.id, mode: 'move', startX: mx, startY: my, origDx: off.dx, origDy: off.dy, origScale: sc, startDist: 0 });
        }
      }
      return;
    }

    // 3. Any slot for crop-pan
    const anySlot = hitTestAll(mx, my, template, slotImages, slotOffsets, slotScales);
    if (anySlot) {
      const crop = slotCrops[anySlot.id] || { zoom: 1, panX: 0, panY: 0 };
      setDragState({ slotId: anySlot.id, mode: 'crop', startX: mx, startY: my, origPanX: crop.panX || 0, origPanY: crop.panY || 0 });
    }
  }, [template, slotImages, slotOffsets, slotScales, slotCrops, textValues, textOverrides, draggableSlots]);

  const handleMove = useCallback((cx, cy) => {
    const canvas = canvasRef.current;
    if (!canvas || !template) return;
    const { mx, my } = getCoordsRaw(cx, cy, canvas);

    if (!dragState) {
      // Hover cursor
      const textHover = hitTestText(mx, my, template.textSlots, textValues, textOverrides);
      if (textHover) { setHoverCursor('grab'); return; }
      const hit = hitTest(mx, my, draggableSlots, slotImages, slotOffsets, slotScales);
      if (hit) { setHoverCursor(hit.mode === 'resize' ? 'nwse-resize' : hit.mode === 'crop' ? 'move' : 'grab'); }
      else {
        const anySlot = hitTestAll(mx, my, template, slotImages, slotOffsets, slotScales);
        setHoverCursor(anySlot ? 'move' : 'default');
      }
      return;
    }

    if (dragState.mode === 'textmove') {
      setTextOverrides(prev => ({
        ...prev,
        [dragState.slotId]: {
          ...(prev[dragState.slotId] || {}),
          dx: dragState.origDx + (mx - dragState.startX),
          dy: dragState.origDy + (my - dragState.startY),
        },
      }));
      return;
    }
    if (dragState.mode === 'crop') {
      const dx = mx - dragState.startX;
      const dy = my - dragState.startY;
      setSlotCrops(prev => {
        const old = prev[dragState.slotId] || { zoom: 1, panX: 0, panY: 0 };
        return { ...prev, [dragState.slotId]: { ...old, panX: (dragState.origPanX || 0) + dx, panY: (dragState.origPanY || 0) + dy } };
      });
    } else if (dragState.mode === 'move') {
      setSlotOffsets(prev => ({
        ...prev,
        [dragState.slotId]: { dx: dragState.origDx + (mx - dragState.startX), dy: dragState.origDy + (my - dragState.startY) },
      }));
    } else {
      // Resize
      const slot = template.slots.find(sl => sl.id === dragState.slotId);
      const off = { dx: dragState.origDx, dy: dragState.origDy };
      const eff = getEffSlot(slot, dragState.origScale);
      const ecx = eff.x + off.dx + (eff.shape === 'circle' ? eff.diameter / 2 : eff.w / 2);
      const ecy = eff.y + off.dy + (eff.shape === 'circle' ? eff.diameter / 2 : eff.h / 2);
      const curDist = Math.hypot(mx - ecx, my - ecy);
      const ratio = dragState.startDist > 10 ? curDist / dragState.startDist : 1;
      const newScale = Math.max(0.3, Math.min(2.5, +(dragState.origScale * ratio).toFixed(2)));
      setSlotScales(prev => ({ ...prev, [dragState.slotId]: newScale }));
    }
  }, [template, slotImages, slotOffsets, slotScales, dragState, textValues, textOverrides, draggableSlots]);

  const handleUp = useCallback(() => setDragState(null), []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas || !template) return;
    const { mx, my } = getCoordsRaw(e.clientX, e.clientY, canvas);
    const slot = hitTestAll(mx, my, template, slotImages, slotOffsets, slotScales);
    if (!slot) return;
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setSlotCrops(prev => {
      const old = prev[slot.id] || { zoom: 1, panX: 0, panY: 0 };
      const newZoom = Math.max(1, Math.min(5, old.zoom + delta));
      return { ...prev, [slot.id]: { ...old, zoom: newZoom } };
    });
  }, [template, slotImages, slotOffsets, slotScales]);

  // Attach native wheel listener (non-passive)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // --- Render ---
  const render = useCallback((showHandles = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111119';
    ctx.fillRect(0, 0, W, H);
    if (!template) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('เลือกแทมเพลตเพื่อเริ่มต้น', W / 2, H / 2);
      return;
    }

    drawBlurredBg(ctx, slotImages, template);
    const sorted = [...template.slots].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    // Pass 1: background + main (zIndex < 3)
    for (const slot of sorted) {
      if ((slot.zIndex || 0) >= 3) continue;
      const img = slotImages[slot.id];
      if (!img) continue;
      const eff = getEffSlot(slot, slotScales[slot.id]);
      if (eff.shape === 'circle') drawCircleSlot(ctx, img, eff, slotOffsets[slot.id], slotCrops[slot.id]);
      else drawRectSlot(ctx, img, eff, slotOffsets[slot.id], slotCrops[slot.id]);
    }

    if (template.textBg) drawTextBg(ctx, template.textBg);
    for (const ts of (template.textSlots || [])) drawTextSlot(ctx, ts, textValues[ts.id], textBgColors[ts.id], textOverrides[ts.id]);

    // Pass 2: top elements (zIndex >= 3)
    for (const slot of sorted) {
      if ((slot.zIndex || 0) < 3) continue;
      const img = slotImages[slot.id];
      if (!img) continue;
      const eff = getEffSlot(slot, slotScales[slot.id]);
      if (eff.shape === 'circle') drawCircleSlot(ctx, img, eff, slotOffsets[slot.id], slotCrops[slot.id]);
      else drawRectSlot(ctx, img, eff, slotOffsets[slot.id], slotCrops[slot.id]);
    }

    // Empty state
    if (!Object.keys(slotImages).length) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(template.name, W / 2, H / 2 - 20);
      ctx.font = '24px sans-serif';
      ctx.fillText('อัปโหลดรูปเพื่อดูตัวอย่าง', W / 2, H / 2 + 30);
    }

    // Handles
    if (showHandles && draggableSlots.length > 0) {
      drawHandles(ctx, draggableSlots, slotImages, slotOffsets, slotScales, dragState);
    }
  }, [slotImages, slotOffsets, slotScales, slotCrops, template, textValues, textBgColors, textOverrides, dragState, draggableSlots]);

  // Auto-render
  useEffect(() => { render(); }, [render]);

  // --- Export ---
  const exportAsBlob = useCallback((filename) => {
    return new Promise((resolve) => {
      render(false); // render without handles
      const canvas = canvasRef.current;
      if (!canvas) { resolve(null); return; }
      canvas.toBlob((blob) => {
        if (filename) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        }
        resolve(blob);
        // Re-render with handles
        setTimeout(() => render(true), 100);
      }, 'image/jpeg', 0.95);
    });
  }, [render]);

  const resetAll = useCallback(() => {
    setSlotOffsets({});
    setSlotScales({});
    setSlotCrops({});
    setTextOverrides({});
  }, []);

  return {
    canvasRef,
    slotImages, setSlotImages,
    slotOffsets, setSlotOffsets,
    slotScales, setSlotScales,
    slotCrops, setSlotCrops,
    textValues, setTextValues,
    textOverrides, setTextOverrides,
    textBgColors, setTextBgColors,
    dragState,
    hoverCursor,
    handleDown, handleMove, handleUp,
    render, exportAsBlob, resetAll,
    draggableSlots,
  };
}
