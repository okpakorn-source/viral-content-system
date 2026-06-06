import { W, H } from './constants';

/** Rounded rectangle path (cross-browser) */
export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

export function coverFit(img, tw, th, focusY = 0.3, crop) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const imgAr = iw / ih, tgtAr = tw / th;
  let sw, sh;
  if (imgAr > tgtAr) { sh = ih; sw = ih * tgtAr; }
  else { sw = iw; sh = iw / tgtAr; }
  const zoom = (crop?.zoom && crop.zoom > 1) ? crop.zoom : 1;
  sw = sw / zoom;
  sh = sh / zoom;
  let sx = (iw - sw) / 2;
  let sy = imgAr > tgtAr ? (ih - sh) / 2 : Math.max(0, Math.min((ih - sh) * focusY, ih - sh));
  if (crop?.panX) sx -= crop.panX;
  if (crop?.panY) sy -= crop.panY;
  sx = Math.max(0, Math.min(sx, Math.max(0, iw - sw)));
  sy = Math.max(0, Math.min(sy, Math.max(0, ih - sh)));
  return { sx, sy, sw, sh };
}

export function createFadeMask(w, h, f) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const m = c.getContext('2d');
  m.fillStyle = '#000'; m.fillRect(0, 0, w, h);
  m.globalCompositeOperation = 'destination-out';
  const grad = (x1,y1,x2,y2) => { const g = m.createLinearGradient(x1,y1,x2,y2); return g; };
  if (f.right > 0)  { const g = grad(w-f.right,0,w,0); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,1)'); m.fillStyle=g; m.fillRect(w-f.right,0,f.right,h); }
  if (f.left > 0)   { const g = grad(0,0,f.left,0);    g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)'); m.fillStyle=g; m.fillRect(0,0,f.left,h); }
  if (f.bottom > 0) { const g = grad(0,h-f.bottom,0,h); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,1)'); m.fillStyle=g; m.fillRect(0,h-f.bottom,w,f.bottom); }
  if (f.top > 0)    { const g = grad(0,0,0,f.top);      g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)'); m.fillStyle=g; m.fillRect(0,0,w,f.top); }
  return c;
}

export function drawRectSlot(ctx, img, slot, offset, crop) {
  const ox = offset?.dx||0, oy = offset?.dy||0;
  const { x:bx, y:by, w, h, fadeRight:fR=0, fadeLeft:fL=0, fadeTop:fT=0, fadeBottom:fB=0, border, borderWidth:bw=0 } = slot;
  const x = bx+ox, y = by+oy;
  const dw = border ? w-bw*2 : w, dh = border ? h-bw*2 : h;
  const dx = border ? x+bw : x, dy = border ? y+bw : y;
  if (border) { ctx.save(); ctx.fillStyle=border; ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=12; ctx.shadowOffsetY=4; ctx.fillRect(x,y,w,h); ctx.restore(); }
  const o = document.createElement('canvas'); o.width=dw; o.height=dh;
  const c = o.getContext('2d');
  const {sx,sy,sw,sh} = coverFit(img,dw,dh,0.3,crop);
  c.drawImage(img,sx,sy,sw,sh,0,0,dw,dh);
  if (!border && (fR||fL||fT||fB)) { const mask = createFadeMask(dw,dh,{right:fR,left:fL,top:fT,bottom:fB}); c.globalCompositeOperation='destination-in'; c.drawImage(mask,0,0); c.globalCompositeOperation='source-over'; }
  ctx.drawImage(o,dx,dy);
}

export function drawCircleSlot(ctx, img, slot, offset, crop) {
  const ox = offset?.dx||0, oy = offset?.dy||0;
  const { x:bx, y:by, diameter:d, border='#fff', borderWidth:bw=4 } = slot;
  const x = bx+ox, y = by+oy, r = d/2, cx = x+r, cy = y+r;
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r+bw,0,Math.PI*2);
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=16; ctx.shadowOffsetY=4;
  ctx.fillStyle=border; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
  const {sx,sy,sw,sh} = coverFit(img,d,d,0.3,crop);
  ctx.drawImage(img,sx,sy,sw,sh,x,y,d,d); ctx.restore();
}

export function drawTextSlot(ctx, ts, val, overrideBg, overrides) {
  if (!val) return;
  ctx.save();
  const fSize = overrides?.fontSize || ts.fontSize || 42;
  const textColor = overrides?.color || ts.color || '#FFD700';
  const posX = ts.x + (overrides?.dx || 0);
  const posY = ts.y + (overrides?.dy || 0);
  ctx.font = `${ts.fontWeight||'bold'} ${fSize}px "Noto Sans Thai","Sarabun",sans-serif`;
  ctx.textAlign = ts.align||'center'; ctx.textBaseline = 'middle';
  const bgColor = overrideBg || ts.bg;
  if (bgColor) {
    const py = ts.bgPadY || 10;
    if (ts.bgFullWidth) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, posY - fSize / 2 - py, W, fSize + py * 2);
    } else {
      const metrics = ctx.measureText(val);
      const tw = Math.min(metrics.width, ts.maxWidth || 1100);
      const px = ts.bgPadX || 16;
      let bx = posX - px;
      if (ts.align === 'center') bx = posX - tw / 2 - px;
      else if (ts.align === 'right') bx = posX - tw - px;
      ctx.fillStyle = bgColor;
      ctx.fillRect(bx, posY - fSize / 2 - py, tw + px * 2, fSize + py * 2);
    }
  }
  if (ts.stroke) { ctx.strokeStyle = ts.stroke; ctx.lineWidth = ts.strokeWidth || 3; ctx.lineJoin = 'round'; ctx.strokeText(val, posX, posY, ts.maxWidth || 1100); }
  ctx.fillStyle = textColor; ctx.fillText(val, posX, posY, ts.maxWidth || 1100);
  ctx.restore();
}

export function drawBlurredBg(ctx, slotImages, template) {
  const bgImg = slotImages['main'] || slotImages[template.slots[0]?.id];
  if (!bgImg) return;
  ctx.save();
  ctx.filter = 'blur(30px) brightness(0.3)';
  const { sx, sy, sw, sh } = coverFit(bgImg, W + 40, H + 40);
  ctx.drawImage(bgImg, sx, sy, sw, sh, -20, -20, W + 40, H + 40);
  ctx.filter = 'none';
  ctx.restore();
}

export function drawTextBg(ctx, tb) {
  ctx.save();
  if (tb.gradient) {
    const g = ctx.createLinearGradient(tb.x, tb.y, tb.x, tb.y + tb.h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, tb.bg || 'rgba(0,0,0,0.85)');
    g.addColorStop(1, tb.bg || 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(tb.x, tb.y, tb.w, tb.h);
  } else {
    ctx.fillStyle = tb.bg || 'rgba(0,0,0,0.75)';
    roundRectPath(ctx, tb.x, tb.y, tb.w, tb.h, tb.radius || 0);
    ctx.fill();
  }
  ctx.restore();
}

export function getEffSlot(slot, scale) {
  const sc = scale || 1;
  if (sc === 1) return slot;
  if (slot.shape === 'circle') {
    const d = slot.diameter * sc;
    return { ...slot, x: slot.x + (slot.diameter - d)/2, y: slot.y + (slot.diameter - d)/2, diameter: d };
  }
  const sw = slot.w * sc, sh = slot.h * sc;
  return { ...slot, x: slot.x + (slot.w - sw)/2, y: slot.y + (slot.h - sh)/2, w: sw, h: sh };
}

/** Draw resize handles on draggable elements */
export function drawHandles(ctx, draggableSlots, slotImages, slotOffsets, slotScales, dragState) {
  for (const slot of draggableSlots) {
    if (!slotImages[slot.id]) continue;
    const off = slotOffsets[slot.id] || {dx:0,dy:0};
    const eff = getEffSlot(slot, slotScales[slot.id]);
    const sx = eff.x + off.dx, sy = eff.y + off.dy;
    const isActive = dragState?.slotId === slot.id;
    const handleColor = isActive ? 'rgba(163,230,53,0.9)' : 'rgba(255,255,255,0.5)';
    const hs = 10;
    ctx.save();
    if (slot.shape === 'circle') {
      const r = eff.diameter/2;
      const cx = sx+r, cy = sy+r;
      const ax = cx + r*0.7, ay = cy + r*0.7;
      ctx.fillStyle = handleColor; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ax, ay, 8, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = isActive ? '#000' : '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('↔', ax, ay);
    } else {
      const ew = eff.w, eh = eff.h;
      const corners = [[sx,sy],[sx+ew,sy],[sx,sy+eh],[sx+ew,sy+eh]];
      for (const [hx,hy] of corners) {
        ctx.fillStyle = handleColor; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
        ctx.fillRect(hx-hs/2, hy-hs/2, hs, hs);
        ctx.strokeRect(hx-hs/2, hy-hs/2, hs, hs);
      }
    }
    if (isActive) {
      ctx.strokeStyle = 'rgba(163,230,53,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([8,4]);
      if (slot.shape === 'circle') { const r = eff.diameter/2; ctx.beginPath(); ctx.arc(sx+r,sy+r,r+8,0,Math.PI*2); ctx.stroke(); }
      else ctx.strokeRect(sx-4, sy-4, eff.w+8, eff.h+8);
    }
    ctx.restore();
  }
}
