/**
 * Image Composer — Sharp.js Engine
 * NO SVG — ใช้ raw pixel buffer ทั้งหมด เพื่อหลีกเลี่ยง librsvg compatibility issues
 */
import sharp from 'sharp';
import { TEMPLATES, getZones } from './imageTemplates.js';


const CANVAS_SIZE = 1080;

// ─── Hex color parser ──────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// ─── Fetch image buffer ────────────────────────────────────────
async function fetchImageBuffer(src) {
  if (!src) throw new Error('No image source');
  if (src.startsWith('data:')) {
    const b64 = src.split(',')[1];
    if (!b64) throw new Error('Invalid base64 data URL');
    return Buffer.from(b64, 'base64');
  }
  if (src.startsWith('http')) {
    const res = await fetch(src, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return Buffer.from(src, 'base64');
}

// ─── Circle crop — raw pixel mask ─────────────────────────────
async function circleCrop(imgBuf, size) {
  const sz = Math.round(size);
  const resized = await sharp(imgBuf)
    .resize(sz, sz, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = resized;
  const cx = sz / 2, cy = sz / 2, r = sz / 2;
  const out = Buffer.from(data);

  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const idx = (y * sz + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      // Soft anti-alias edge
      const edge = r - 1;
      if (dist > r) {
        out[idx + 3] = 0;
      } else if (dist > edge) {
        out[idx + 3] = Math.round((r - dist) * 255);
      }
    }
  }

  return sharp(out, { raw: { width: sz, height: sz, channels: 4 } }).png().toBuffer();
}

// ─── Soft edge — gradient alpha mask via raw pixels ───────────
async function applySoftEdge(imgBuf, direction, w, h) {
  const iw = Math.round(w), ih = Math.round(h);
  const resized = await sharp(imgBuf)
    .resize(iw, ih, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data } = resized;
  const out = Buffer.from(data);

  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const idx = (y * iw + x) * 4;
      let alpha = 1.0;

      if (direction === 'soft_right') {
        const fade = iw * 0.80;
        if (x > fade) alpha = 1 - (x - fade) / (iw - fade);
      } else if (direction === 'soft_left') {
        const fade = iw * 0.20;
        if (x < fade) alpha = x / fade;
      } else if (direction === 'soft_top') {
        const fade = ih * 0.75;
        if (y > fade) alpha = 1 - (y - fade) / (ih - fade);
      } else { // soft_all radial
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

// ─── Colored border ────────────────────────────────────────────
async function addBorder(imgBuf, w, h, hexColor, borderW = 7) {
  const iw = Math.max(1, Math.round(w - borderW * 2));
  const ih = Math.max(1, Math.round(h - borderW * 2));
  const bw = Math.round(w), bh = Math.round(h);

  const resized = await sharp(imgBuf)
    .resize(iw, ih, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const { r, g, b } = hexToRgb(hexColor);
  const bgBuf = await sharp({
    create: { width: bw, height: bh, channels: 3, background: { r, g, b } },
  }).png().toBuffer();

  return sharp(bgBuf)
    .composite([{ input: resized, left: Math.round(borderW), top: Math.round(borderW) }])
    .png()
    .toBuffer();
}

// ─── Basic effects ─────────────────────────────────────────────
async function applyBasicEffect(imgBuf, effect, w, h) {
  let s = sharp(imgBuf).resize(Math.round(w), Math.round(h), { fit: 'cover', position: 'centre' });
  switch (effect) {
    case 'blur_dark':    s = s.blur(10).modulate({ brightness: 0.55 }); break;
    case 'blur_light':   s = s.blur(6).modulate({ brightness: 0.85 });  break;
    case 'overlay_dark': s = s.modulate({ brightness: 0.45 });           break;
    case 'desaturate':   s = s.modulate({ saturation: 0.35 });           break;
    default: break;
  }
  return s.png().toBuffer();
}


// ─── Main Composer ─────────────────────────────────────────────
export async function composeImage({ templateId, assignments, colorOverride }) {
  const tmpl = TEMPLATES[templateId] || TEMPLATES.accident;
  const zones = getZones(tmpl); // รองรับทั้ง structure เดิมและใหม่

  // Black canvas
  let canvas = await sharp({
    create: {
      width: CANVAS_SIZE, height: CANVAS_SIZE,
      channels: 3, background: { r: 12, g: 12, b: 20 },
    },
  }).png().toBuffer();

  // Process zones sequentially
  for (const zone of zones) {

    const src = assignments[zone.id] ?? assignments[zone.role];
    if (!src) continue;

    const { x, y, w, h } = zone.position;
    if (w <= 0 || h <= 0) continue;

    try {
      const raw = await fetchImageBuffer(src);
      let buf;

      if (zone.effect === 'circle_bw' || zone.effect === 'circle_color') {
        const size = Math.min(w, h);
        let circleBuf = await circleCrop(raw, size);
        if (zone.effect === 'circle_bw') {
          circleBuf = await sharp(circleBuf).grayscale().png().toBuffer();
        } else {
          // circle_color: add thin white border ring
          const ringSize = size + 12;
          const bgBuf = await sharp({ create: { width: ringSize, height: ringSize, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
          circleBuf = await sharp(bgBuf).composite([{ input: circleBuf, left: 6, top: 6 }]).png().toBuffer();
        }
        buf = circleBuf;
      } else if (zone.effect === 'border_green') {
        buf = await addBorder(raw, w, h, '#22c55e', 7);
      } else if (zone.effect === 'border_lime') {
        buf = await addBorder(raw, w, h, '#a3e635', 8);
      } else if (zone.effect === 'border_red') {
        buf = await addBorder(raw, w, h, '#ef4444', 7);
      } else if (zone.effect === 'border_gold') {
        buf = await addBorder(raw, w, h, '#f59e0b', 7);
      } else if (['soft_right', 'soft_left', 'soft_top', 'soft_all'].includes(zone.effect)) {
        buf = await applySoftEdge(raw, zone.effect, w, h);
      } else {
        buf = await applyBasicEffect(raw, zone.effect, w, h);
      }

      // Composite onto canvas
      canvas = await sharp(canvas)
        .composite([{ input: buf, left: Math.round(x), top: Math.round(y), blend: 'over' }])
        .png()
        .toBuffer();

    } catch (e) {
      console.warn(`[Composer] Zone "${zone.id}" skipped:`, e.message);
    }
  }

  // Subtle dark vignette — NO SVG, use raw RGBA buffer
  const vigAlpha = Math.round(0.15 * 255); // 15% opacity
  const vigData = Buffer.alloc(CANVAS_SIZE * CANVAS_SIZE * 4, 0);
  for (let i = 3; i < vigData.length; i += 4) vigData[i] = vigAlpha;
  const vignette = await sharp(vigData, {
    raw: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 4 },
  }).png().toBuffer();

  canvas = await sharp(canvas)
    .composite([{ input: vignette, blend: 'over' }])
    .jpeg({ quality: 93 })
    .toBuffer();

  return canvas;
}

export default composeImage;
