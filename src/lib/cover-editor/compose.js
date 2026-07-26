// 🎨 ตัวประกอบปกสำหรับแอพมือถือ — ใช้หัวใจการวาดจาก draw.js (ก๊อปจาก cover-tester)
//   วาดทั้งหมดในเบราว์เซอร์ (canvas) ไม่พึ่งเซิร์ฟเวอร์/sharp/เครื่องทีม
import {
  W, H, drawBlurredBg, drawRectSlot, drawCircleSlot, drawTextSlot, getEffSlot, roundRectPath,
} from './draw';

/**
 * วาดปกลง ctx ตาม state
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} st - { template, slotImages, slotCrops, slotOffsets, slotScales, textValues, textOverrides, textBgColors, fadeOn }
 * @param {object} opt - { clean:boolean (ไม่วาดเส้นประ/ป้ายช่องว่าง), selSlot:string|null }
 */
export function renderCover(ctx, st, opt = {}) {
  const { clean = false, selSlot = null } = opt;
  const t = st.template;
  if (!t) return;
  const imgs = st.slotImages || {};
  const crops = st.slotCrops || {};
  const offs = st.slotOffsets || {};
  const scales = st.slotScales || {};

  // พื้นหลัง
  ctx.fillStyle = '#0b0b0f';
  ctx.fillRect(0, 0, W, H);
  try { drawBlurredBg(ctx, imgs, t); } catch {}

  const slots = [...(t.slots || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  for (const slot of slots) {
    const img = imgs[slot.id];
    const eff = getEffSlot(slot, scales[slot.id]);
    // ★ สวิตช์ไล่ขอบ: ปิด = ตัดค่า fade ออกทั้งหมด (ภาพคมเต็มกรอบ)
    const s2 = st.fadeOn === false
      ? { ...eff, fadeLeft: 0, fadeRight: 0, fadeTop: 0, fadeBottom: 0 }
      : eff;

    if (!img) {
      if (!clean) drawEmptySlot(ctx, eff, offs[slot.id], slot.id === selSlot);
      continue;
    }
    try {
      if (slot.shape === 'circle') drawCircleSlot(ctx, img, s2, offs[slot.id], crops[slot.id]);
      else drawRectSlot(ctx, img, s2, offs[slot.id], crops[slot.id]);
    } catch { /* ภาพเสีย = ข้ามช่องนั้น ไม่ล้มทั้งปก */ }

    if (!clean && slot.id === selSlot) drawSelRing(ctx, s2, offs[slot.id]);
  }

  // ข้อความ
  for (const ts of (t.textSlots || [])) {
    const val = (st.textValues || {})[ts.id];
    try { drawTextSlot(ctx, ts, val, (st.textBgColors || {})[ts.id], (st.textOverrides || {})[ts.id]); } catch {}
    if (!clean && !val && ts.placeholder) drawTextHint(ctx, ts);
  }
}

function slotBox(slot, offset) {
  const ox = offset?.dx || 0, oy = offset?.dy || 0;
  if (slot.shape === 'circle') return { x: slot.x + ox, y: slot.y + oy, w: slot.diameter, h: slot.diameter, circle: true };
  return { x: slot.x + ox, y: slot.y + oy, w: slot.w, h: slot.h, circle: false };
}

function drawEmptySlot(ctx, slot, offset, selected) {
  const b = slotBox(slot, offset);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  ctx.save();
  ctx.fillStyle = selected ? 'rgba(255,45,138,0.06)' : 'rgba(255,255,255,0.03)';
  if (b.circle) {
    ctx.beginPath(); ctx.arc(cx, cy, b.w / 2 - 2, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, b.x + 4, b.y + 4, b.w - 8, b.h - 8, 14);
  }
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = '#FF2D8A'; ctx.lineWidth = 4;
    ctx.shadowColor = 'rgba(255,45,138,0.55)'; ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.17)'; ctx.lineWidth = 2;
    ctx.stroke();
  }

  const label = String(slot.label || slot.id).replace(/\s*\(.*\)\s*$/, '');
  ctx.font = 'bold 30px "Noto Sans Thai","Sarabun",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const textW = ctx.measureText(label).width;
  const pillW = Math.min(textW + 36, b.w - 24);
  const pillH = 46;
  const pillCy = cy - 8;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRectPath(ctx, cx - pillW / 2, pillCy - pillH / 2, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.fillStyle = selected ? '#FF6AA9' : 'rgba(255,255,255,0.88)';
  ctx.fillText(label, cx, pillCy, pillW - 12);

  ctx.font = '22px "Noto Sans Thai","Sarabun",sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('แตะเพื่อใส่รูป', cx, cy + 34, b.w - 24);
  ctx.restore();
}

function drawSelRing(ctx, slot, offset) {
  const b = slotBox(slot, offset);
  ctx.save();
  ctx.lineWidth = 5; ctx.strokeStyle = '#FF2D8A';
  ctx.shadowColor = 'rgba(255,45,138,0.6)'; ctx.shadowBlur = 22;
  if (b.circle) {
    ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 3, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    roundRectPath(ctx, b.x - 2, b.y - 2, b.w + 4, b.h + 4, 12);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTextHint(ctx, ts) {
  ctx.save();
  ctx.font = `${ts.fontWeight || 'bold'} ${ts.fontSize || 42}px "Noto Sans Thai","Sarabun",sans-serif`;
  ctx.textAlign = ts.align || 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(ts.placeholder || 'พิมพ์ข้อความ…', ts.x, ts.y, ts.maxWidth || 1100);
  ctx.restore();
}

/** หา slot ที่ถูกแตะ (เรียงจาก zIndex สูง→ต่ำ เพื่อให้ช่องบนสุดชนะ) */
export function hitSlot(st, px, py) {
  const t = st.template;
  if (!t) return null;
  const slots = [...(t.slots || [])].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
  for (const slot of slots) {
    const eff = getEffSlot(slot, (st.slotScales || {})[slot.id]);
    const b = slotBox(eff, (st.slotOffsets || {})[slot.id]);
    if (b.circle) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      if ((px - cx) ** 2 + (py - cy) ** 2 <= (b.w / 2) ** 2) return slot.id;
    } else if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return slot.id;
  }
  return null;
}

/** เรนเดอร์ไฟล์จริง 1080×1350 แบบสะอาด → dataURL (jpeg) */
export function exportCover(st, quality = 0.9) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  renderCover(ctx, st, { clean: true });
  return c.toDataURL('image/jpeg', quality);
}

/** ย่อภาพก่อนใช้ — กัน OOM บนมือถือ (ของเดิมไม่มี = แอพเด้ง) */
export async function loadScaledImage(file, maxPx = 2000) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const cw = Math.max(1, Math.round(bmp.width * k));
  const ch = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, cw, ch);
  try { bmp.close(); } catch {}
  const img = new Image();
  img.src = c.toDataURL('image/jpeg', 0.92);
  await img.decode();
  return img;
}

/** โหลดภาพจาก URL ผ่าน proxy same-origin (กัน canvas taint) */
export async function loadProxyImage(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = '/api/m/cover-editor/img?url=' + encodeURIComponent(url);
  await img.decode();
  return img;
}
