import { W, H, HANDLE_SIZE, EDGE_RING, MOVE_BORDER } from './constants';
import { getEffSlot } from './canvasDrawing';

/** Convert screen coords to canvas coords */
export function getCoords(e, canvasRef) {
  const c = canvasRef.current || canvasRef;
  if (!c) return { mx: 0, my: 0 };
  const r = c.getBoundingClientRect();
  return { mx: (e.clientX - r.left) * (W / r.width), my: (e.clientY - r.top) * (H / r.height) };
}

// Also accept raw cx, cy for touch events
export function getCoordsRaw(cx, cy, canvas) {
  if (!canvas) return { mx: 0, my: 0 };
  const r = canvas.getBoundingClientRect();
  return { mx: (cx - r.left) * (W / r.width), my: (cy - r.top) * (H / r.height) };
}

/** Hit test draggable slots — 3 zones: corner=resize, border=move, center=crop */
export function hitTest(mx, my, draggableSlots, slotImages, slotOffsets, slotScales) {
  const sorted = [...draggableSlots].filter(sl => slotImages[sl.id]).sort((a,b) => (b.zIndex||0)-(a.zIndex||0));
  for (const slot of sorted) {
    const off = slotOffsets[slot.id] || {dx:0,dy:0};
    const eff = getEffSlot(slot, slotScales[slot.id]);
    const sx = eff.x + off.dx, sy = eff.y + off.dy;
    if (slot.shape === 'circle') {
      const r = eff.diameter/2, ecx = sx+r, ecy = sy+r;
      const dist = Math.hypot(mx-ecx, my-ecy);
      if (dist <= r + (slot.borderWidth||0)) {
        if (dist >= r - EDGE_RING) return { slot, mode: 'resize' };
        if (dist >= r * 0.55) return { slot, mode: 'move' };
        return { slot, mode: 'crop' };
      }
    } else {
      const ew = eff.w, eh = eff.h;
      if (mx >= sx && mx <= sx+ew && my >= sy && my <= sy+eh) {
        const nearL = mx - sx < HANDLE_SIZE, nearR = sx+ew - mx < HANDLE_SIZE;
        const nearT = my - sy < HANDLE_SIZE, nearB = sy+eh - my < HANDLE_SIZE;
        const nearCorner = (nearL || nearR) && (nearT || nearB);
        if (nearCorner) return { slot, mode: 'resize' };
        const inBorderL = mx - sx < MOVE_BORDER, inBorderR = sx+ew - mx < MOVE_BORDER;
        const inBorderT = my - sy < MOVE_BORDER, inBorderB = sy+eh - my < MOVE_BORDER;
        if (inBorderL || inBorderR || inBorderT || inBorderB) return { slot, mode: 'move' };
        return { slot, mode: 'crop' };
      }
    }
  }
  return null;
}

/** Hit test text slots (for drag repositioning) */
export function hitTestText(mx, my, textSlots, textValues, textOverrides) {
  if (!textSlots?.length) return null;
  for (const ts of textSlots) {
    const ov = textOverrides[ts.id] || {};
    const tx = (ts.x || 0) + (ov.dx || 0);
    const ty = (ts.y || 0) + (ov.dy || 0);
    const fs = ov.fontSize || ts.fontSize || 40;
    const val = textValues[ts.id];
    if (!val) continue;
    const textW = Math.min(ts.maxWidth || 600, val.length * fs * 0.55);
    const textH = fs * 1.4;
    const left = (ts.align === 'center') ? tx - textW/2 : tx;
    const top = ty - fs * 0.3;
    if (mx >= left && mx <= left + textW && my >= top && my <= top + textH) {
      return ts;
    }
  }
  return null;
}

/** Hit test ALL slots (for crop pan on any slot) */
export function hitTestAll(mx, my, template, slotImages, slotOffsets, slotScales) {
  if (!template) return null;
  const sorted = [...template.slots].filter(sl => slotImages[sl.id]).sort((a,b) => (b.zIndex||0)-(a.zIndex||0));
  for (const slot of sorted) {
    const off = slotOffsets[slot.id] || {dx:0,dy:0};
    const eff = getEffSlot(slot, slotScales[slot.id]);
    const sx = eff.x + off.dx, sy = eff.y + off.dy;
    if (slot.shape === 'circle') {
      const r = eff.diameter/2;
      if (Math.hypot(mx-(sx+r), my-(sy+r)) <= r + (slot.borderWidth||0)) return slot;
    } else {
      if (mx >= sx && mx <= sx+(eff.w||0) && my >= sy && my <= sy+(eff.h||0)) return slot;
    }
  }
  return null;
}
