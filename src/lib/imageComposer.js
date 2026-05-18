/**
 * Image Composer — Sharp.js Engine (Fixed)
 * รับ Layout JSON จาก AI + รูปจริง → composite เป็นปกข่าว 1080x1080
 */

import sharp from 'sharp';
import { TEMPLATES } from './imageTemplates.js';

const CANVAS_SIZE = 1080;

// ─── Buffer helpers ────────────────────────────────────────────
async function fetchImageBuffer(src) {
  if (!src) throw new Error('No image source');
  if (src.startsWith('data:')) {
    const b64 = src.split(',')[1];
    if (!b64) throw new Error('Invalid base64 data URL');
    return Buffer.from(b64, 'base64');
  }
  if (src.startsWith('http')) {
    const res = await fetch(src, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
    return Buffer.from(await res.arrayBuffer());
  }
  // plain base64
  return Buffer.from(src, 'base64');
}

// ─── Circle crop ───────────────────────────────────────────────
async function circleCrop(imgBuf, size) {
  const resized = await sharp(imgBuf)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const mask = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>` +
    `</svg>`
  );

  return sharp(resized)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ─── Colored border box ────────────────────────────────────────
async function addBorder(imgBuf, w, h, color, borderW = 7) {
  const iw = Math.max(1, w - borderW * 2);
  const ih = Math.max(1, h - borderW * 2);

  const resized = await sharp(imgBuf)
    .resize(iw, ih, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const bgSvg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${w}" height="${h}" fill="${color}"/>` +
    `</svg>`
  );

  return sharp(bgSvg)
    .composite([{ input: resized, left: borderW, top: borderW }])
    .png()
    .toBuffer();
}

// ─── Soft edge mask ───────────────────────────────────────────
async function applySoftEdge(imgBuf, direction, w, h) {
  const resized = await sharp(imgBuf)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  let gradDef;
  switch (direction) {
    case 'soft_right':
      gradDef = `<linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="white" stop-opacity="1"/><stop offset="82%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>`;
      break;
    case 'soft_left':
      gradDef = `<linearGradient id="g" x1="1" x2="0" y1="0" y2="0"><stop offset="0%" stop-color="white" stop-opacity="1"/><stop offset="82%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>`;
      break;
    case 'soft_top':
      gradDef = `<linearGradient id="g" x1="0" x2="0" y1="1" y2="0"><stop offset="0%" stop-color="white" stop-opacity="1"/><stop offset="78%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>`;
      break;
    default: // soft_all
      gradDef = `<radialGradient id="g" cx="50%" cy="45%" r="55%"><stop offset="55%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient>`;
  }

  const mask = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>${gradDef}</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `</svg>`
  );

  return sharp(resized)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ─── Apply basic effect ────────────────────────────────────────
async function applyBasicEffect(imgBuf, effect, w, h) {
  let s = sharp(imgBuf).resize(w, h, { fit: 'cover', position: 'centre' });
  switch (effect) {
    case 'blur_dark':   s = s.blur(10).modulate({ brightness: 0.55 }); break;
    case 'blur_light':  s = s.blur(6).modulate({ brightness: 0.85 });  break;
    case 'overlay_dark':s = s.modulate({ brightness: 0.45 });           break;
    default: break;
  }
  return s.png().toBuffer();
}

// ─── Main Composer ─────────────────────────────────────────────
/**
 * @param {Object} opts
 * @param {string}  opts.templateId
 * @param {Object}  opts.assignments  { zone_id: base64orURL }
 * @param {Object} [opts.colorOverride]
 * @returns {Promise<Buffer>} JPEG buffer 1080x1080
 */
export async function composeImage({ templateId, assignments, colorOverride }) {
  const tmpl = TEMPLATES[templateId] || TEMPLATES.accident;
  const { zones } = tmpl.layout;

  // Black canvas
  const canvasBuf = await sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: { r: 12, g: 12, b: 20, alpha: 1 },
    },
  }).png().toBuffer();

  const layers = []; // all layers to composite on top

  for (const zone of zones) {
    const src = assignments[zone.id] ?? assignments[zone.role];
    if (!src) continue;

    const { x, y, w, h } = zone.position;

    try {
      const raw = await fetchImageBuffer(src);

      let buf;

      if (zone.effect === 'circle_bw' || zone.effect === 'circle_color') {
        const size = Math.min(w, h);
        buf = await circleCrop(raw, size);
        if (zone.effect === 'circle_bw') {
          buf = await sharp(buf).grayscale().png().toBuffer();
        }

      } else if (zone.effect === 'border_green') {
        buf = await addBorder(raw, w, h, '#22c55e', 7);

      } else if (zone.effect === 'border_red') {
        buf = await addBorder(raw, w, h, '#ef4444', 7);

      } else if (zone.effect === 'border_gold') {
        buf = await addBorder(raw, w, h, '#f59e0b', 7);

      } else if (['soft_right', 'soft_left', 'soft_top', 'soft_all'].includes(zone.effect)) {
        buf = await applySoftEdge(raw, zone.effect, w, h);

      } else {
        buf = await applyBasicEffect(raw, zone.effect, w, h);
      }

      layers.push({ input: buf, left: Math.round(x), top: Math.round(y), blend: 'over' });

    } catch (e) {
      console.warn(`[Composer] Zone "${zone.id}" skipped:`, e.message);
    }
  }

  // Subtle dark vignette overlay
  const vignette = Buffer.from(
    `<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="rgba(0,0,0,0.12)"/>` +
    `</svg>`
  );
  layers.push({ input: vignette, blend: 'over' });

  const result = await sharp(canvasBuf)
    .composite(layers)
    .jpeg({ quality: 93 })
    .toBuffer();

  return result;
}

export default composeImage;
