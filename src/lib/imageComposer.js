/**
 * Image Composer — Sharp.js Engine (Phase 1)
 * Fixed:
 *  1. Blurred background เต็ม canvas (ไม่ดำอีกต่อไป)
 *  2. Zone cycling — ทุก zone มีรูป (ไม่ว่าง)
 *  3. Circle ring เป็นวงกลมจริง ไม่มีกล่องขาว
 *  4. Smart fallback assignment
 */
import sharp from 'sharp';
import { TEMPLATES, getZones } from './imageTemplates.js';

const CANVAS_SIZE = 1080;

function hexToRgb(hex) {
  const h = (hex || '#ffffff').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 255,
    g: parseInt(h.slice(2, 4), 16) || 255,
    b: parseInt(h.slice(4, 6), 16) || 255,
  };
}

async function fetchImageBuffer(src) {
  if (!src) throw new Error('No image source');
  if (src.startsWith('data:')) {
    const b64 = src.split(',')[1];
    if (!b64) throw new Error('Invalid base64');
    return Buffer.from(b64, 'base64');
  }
  if (src.startsWith('http')) {
    const res = await fetch(src, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return Buffer.from(src, 'base64');
}

// ─── Circle crop with proper alpha ────────────────────────────────
async function circleCrop(imgBuf, size) {
  const sz = Math.round(size);
  const { data } = await sharp(imgBuf)
    .resize(sz, sz, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(data);
  const cx = sz / 2, cy = sz / 2, r = sz / 2 - 1;
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const idx = (y * sz + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist > r) out[idx + 3] = 0;
      else if (dist > r - 1.5) out[idx + 3] = Math.round((r - dist) / 1.5 * 255);
    }
  }
  return sharp(out, { raw: { width: sz, height: sz, channels: 4 } }).png().toBuffer();
}

// ─── FIX: Circle ring เป็นวงกลมจริง (ไม่มีกล่องขาว) ─────────────
async function circleWithRing(imgBuf, size, ringPx = 8) {
  const outerSz = Math.round(size) + ringPx * 2;

  // 1. สร้าง white solid square → crop เป็นวงกลมขาว (ring bg)
  const whiteSolid = await sharp({
    create: { width: outerSz, height: outerSz, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer();
  const whiteRing = await circleCrop(whiteSolid, outerSz); // วงกลมขาว

  // 2. รูปจริง crop เป็นวงกลม
  const imgCircle = await circleCrop(imgBuf, Math.round(size));

  // 3. วางรูปบนวงกลมขาว (center)
  const result = await sharp(whiteRing)
    .composite([{ input: imgCircle, left: ringPx, top: ringPx, blend: 'over' }])
    .png()
    .toBuffer();
  return result;
}

// ─── Soft edge fade ───────────────────────────────────────────────
async function applySoftEdge(imgBuf, direction, w, h) {
  const iw = Math.round(w), ih = Math.round(h);
  const { data } = await sharp(imgBuf)
    .resize(iw, ih, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(data);
  const fadeZone = 0.22; // 22% ของขอบ

  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const idx = (y * iw + x) * 4;
      let alpha = 1.0;
      if (direction === 'soft_right') {
        const start = iw * (1 - fadeZone);
        if (x > start) alpha = 1 - (x - start) / (iw - start);
      } else if (direction === 'soft_left') {
        const end = iw * fadeZone;
        if (x < end) alpha = x / end;
      } else if (direction === 'soft_top') {
        const start = ih * (1 - fadeZone);
        if (y > start) alpha = 1 - (y - start) / (ih - start);
      } else { // soft_all
        const cx = iw / 2, cy = ih * 0.45;
        const maxR = Math.min(iw, ih) * 0.52;
        const minR = maxR * 0.50;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist > maxR) alpha = 0;
        else if (dist > minR) alpha = 1 - (dist - minR) / (maxR - minR);
      }
      out[idx + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * out[idx + 3]);
    }
  }
  return sharp(out, { raw: { width: iw, height: ih, channels: 4 } }).png().toBuffer();
}

// ─── Colored border ───────────────────────────────────────────────
async function addBorder(imgBuf, w, h, hexColor, borderW = 7) {
  const iw = Math.max(1, Math.round(w - borderW * 2));
  const ih = Math.max(1, Math.round(h - borderW * 2));
  const { r, g, b } = hexToRgb(hexColor);
  const bgBuf = await sharp({
    create: { width: Math.round(w), height: Math.round(h), channels: 3, background: { r, g, b } },
  }).png().toBuffer();
  const resized = await sharp(imgBuf).resize(iw, ih, { fit: 'cover', position: 'centre' }).png().toBuffer();
  return sharp(bgBuf)
    .composite([{ input: resized, left: Math.round(borderW), top: Math.round(borderW) }])
    .png().toBuffer();
}

// ─── Basic effects ────────────────────────────────────────────────
async function applyBasicEffect(imgBuf, effect, w, h) {
  let s = sharp(imgBuf).resize(Math.round(w), Math.round(h), { fit: 'cover', position: 'centre' });
  switch (effect) {
    case 'blur_dark':    s = s.blur(12).modulate({ brightness: 0.50 }); break;
    case 'blur_light':   s = s.blur(6).modulate({ brightness: 0.82 });  break;
    case 'overlay_dark': s = s.modulate({ brightness: 0.42 });           break;
    case 'desaturate':   s = s.modulate({ saturation: 0.30 });           break;
    default: break;
  }
  return s.png().toBuffer();
}

// ─── Main Composer ────────────────────────────────────────────────
export async function composeImage({ templateId, zones: zonesOverride, assignments, colorOverride }) {
  // Resolve zones
  let zones;
  if (zonesOverride && Array.isArray(zonesOverride) && zonesOverride.length > 0) {
    zones = zonesOverride;
    console.log(`[Composer] ✅ Custom zones: ${zones.length}`);
  } else {
    const tmpl = TEMPLATES[templateId] || TEMPLATES.accident;
    zones = getZones(tmpl);
    console.log(`[Composer] 📦 Built-in: "${templateId}" → ${zones.length} zones`);
  }

  // ─── FIX 1: รวบรวมรูปทั้งหมดที่มี ────────────────────────────
  const availableSrcs = Object.values(assignments).filter(Boolean);
  if (!availableSrcs.length) throw new Error('ไม่มีรูปให้ compose');

  // ═══ FIX: bg source — ใช้ assignments.bg จาก AI ก่อน, fallback ถึง availableSrcs[0] ═══
  const bgSrc = assignments.bg || assignments.background || availableSrcs[0];
  const bgRaw = await fetchImageBuffer(bgSrc);
  const bgBlurred = await sharp(bgRaw)
    .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: 'cover', position: 'centre' })
    .blur(28)
    .modulate({ brightness: 0.38, saturation: 0.6 })
    .jpeg({ quality: 80 })
    .toBuffer();

  let canvas = await sharp(bgBlurred).png().toBuffer();
  console.log('[Composer] 🖼️ Blurred bg: ' + (assignments.bg ? 'from assignments.bg' : assignments.background ? 'from assignments.background' : 'fallback to first image') + ' | ' + availableSrcs.length + ' images available');

  // ─── FIX 3: Zone cycling — ทุก zone มีรูป ──────────────────
  let cycleIdx = 0;
  const resolveZoneSrc = (zone) => {
    const direct = assignments[zone.id] ?? assignments[zone.role];
    if (direct) return direct;
    // cycle รูปที่มี (ข้าม bg zones)
    if (zone.role === 'background') return availableSrcs[0];
    const src = availableSrcs[cycleIdx % availableSrcs.length];
    cycleIdx++;
    return src;
  };

  // ─── Process zones ────────────────────────────────────────────
  for (const zone of zones) {
    const src = resolveZoneSrc(zone);
    const { x, y, w, h } = zone.position;
    if (!src || w <= 0 || h <= 0) continue;

    try {
      const raw = await fetchImageBuffer(src);
      let buf;
      const effect = zone.effect || 'none';
      const borderRadius = zone.borderRadius || 0;
      const darkOverlay = zone.darkOverlay || 0; // 0.0 - 1.0

      if (effect === 'circle_bw' || effect === 'circle_color') {
        const sz = Math.min(w, h);
        buf = effect === 'circle_color'
          ? await circleWithRing(raw, sz, 8)
          : await sharp(await circleCrop(raw, sz)).grayscale().png().toBuffer();
      } else if (effect === 'border_green') {
        buf = await addBorder(raw, w, h, '#22c55e', 7);
      } else if (effect === 'border_lime') {
        buf = await addBorder(raw, w, h, '#a3e635', 8);
      } else if (effect === 'border_red') {
        buf = await addBorder(raw, w, h, '#ef4444', 7);
      } else if (effect === 'border_gold') {
        buf = await addBorder(raw, w, h, '#f59e0b', 7);
      } else if (['soft_right', 'soft_left', 'soft_top', 'soft_all'].includes(effect)) {
        buf = await applySoftEdge(raw, effect, w, h);
      } else {
        buf = await applyBasicEffect(raw, effect, w, h);
      }

      // ✅ Phase 1.3 NEW: borderRadius via SVG mask
      if (borderRadius > 0 && effect !== 'circle_bw' && effect !== 'circle_color') {
        const iw = Math.round(w), ih = Math.round(h);
        const r = Math.min(borderRadius, iw / 2, ih / 2);
        const svgMask = Buffer.from(
          `<svg><rect x="0" y="0" width="${iw}" height="${ih}" rx="${r}" ry="${r}"/></svg>`
        );
        const resized = await sharp(buf).resize(iw, ih, { fit: 'cover' }).ensureAlpha().toBuffer();
        buf = await sharp(resized).composite([{ input: svgMask, blend: 'dest-in' }]).png().toBuffer();
      }

      // ✅ Phase 1.3 NEW: darkOverlay อัดแยกสำหรับแต่ละ slot
      if (darkOverlay > 0) {
        const iw = Math.round(w), ih = Math.round(h);
        const alpha = Math.round(darkOverlay * 255);
        const overlayBuf = await sharp({
          create: { width: iw, height: ih, channels: 4, background: { r: 0, g: 0, b: 0, alpha } },
        }).png().toBuffer();
        buf = await sharp(buf).composite([{ input: overlayBuf, blend: 'over' }]).png().toBuffer();
      }

      canvas = await sharp(canvas)
        .composite([{ input: buf, left: Math.round(x), top: Math.round(y), blend: 'over' }])
        .png()
        .toBuffer();

      console.log(`[Composer] ✅ Zone "${zone.id}" (${effect}) @ (${Math.round(x)},${Math.round(y)}) ${Math.round(w)}x${Math.round(h)}`);
    } catch (e) {
      console.warn(`[Composer] ⚠️ Zone "${zone.id}" skipped:`, e.message);
    }
  }

  // ─── Vignette (raw pixel, no SVG) ────────────────────────────
  const vigAlpha = Math.round(0.18 * 255);
  const vigData = Buffer.alloc(CANVAS_SIZE * CANVAS_SIZE * 4, 0);
  for (let i = 3; i < vigData.length; i += 4) vigData[i] = vigAlpha;
  const vignette = await sharp(vigData, {
    raw: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 4 },
  }).png().toBuffer();

  const output = await sharp(canvas)
    .composite([{ input: vignette, blend: 'over' }])
    .jpeg({ quality: 93 })
    .toBuffer();

  console.log(`[Composer] 🎉 Done — ${output.length} bytes`);
  return output;
}

export default composeImage;
