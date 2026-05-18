/**
 * Image Composer — Sharp.js Engine (Fixed SVG + Color handling)
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
  return Buffer.from(src, 'base64');
}

// ─── Circle crop ───────────────────────────────────────────────
async function circleCrop(imgBuf, size) {
  const resized = await sharp(imgBuf)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  // NOTE: Sharp/librsvg needs fill-opacity NOT rgba() in SVG
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${Math.floor(size / 2)}" cy="${Math.floor(size / 2)}" r="${Math.floor(size / 2)}" fill="white"/>` +
    `</svg>`
  );

  return sharp(resized)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ─── Colored border box ────────────────────────────────────────
async function addBorder(imgBuf, w, h, hexColor, borderW = 7) {
  const iw = Math.max(1, w - borderW * 2);
  const ih = Math.max(1, h - borderW * 2);

  const resized = await sharp(imgBuf)
    .resize(iw, ih, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  // Use hex color directly (no rgba)
  const bgSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="${hexColor}"/>` +
    `</svg>`
  );

  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .png()
    .composite([
      { input: bgSvg },
      { input: resized, left: borderW, top: borderW },
    ])
    .png()
    .toBuffer();
}

// ─── Soft edge (gradient alpha mask) ──────────────────────────
async function applySoftEdge(imgBuf, direction, w, h) {
  const resized = await sharp(imgBuf)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  // Build SVG gradient — use stop-opacity (not rgba)
  let gradDef;
  const gid = 'g1';
  switch (direction) {
    case 'soft_right':
      gradDef = `<linearGradient id="${gid}" x1="0" x2="1" y1="0" y2="0">` +
        `<stop offset="0%" stop-color="white" stop-opacity="1"/>` +
        `<stop offset="80%" stop-color="white" stop-opacity="1"/>` +
        `<stop offset="100%" stop-color="white" stop-opacity="0"/>` +
        `</linearGradient>`;
      break;
    case 'soft_left':
      gradDef = `<linearGradient id="${gid}" x1="1" x2="0" y1="0" y2="0">` +
        `<stop offset="0%" stop-color="white" stop-opacity="1"/>` +
        `<stop offset="80%" stop-color="white" stop-opacity="1"/>` +
        `<stop offset="100%" stop-color="white" stop-opacity="0"/>` +
        `</linearGradient>`;
      break;
    case 'soft_top':
      gradDef = `<linearGradient id="${gid}" x1="0" x2="0" y1="1" y2="0">` +
        `<stop offset="0%" stop-color="white" stop-opacity="1"/>` +
        `<stop offset="75%" stop-color="white" stop-opacity="1"/>` +
        `<stop offset="100%" stop-color="white" stop-opacity="0"/>` +
        `</linearGradient>`;
      break;
    default: // soft_all radial
      gradDef = `<radialGradient id="${gid}" cx="50%" cy="45%" r="52%">` +
        `<stop offset="50%" stop-color="white" stop-opacity="1"/>` +
        `<stop offset="100%" stop-color="white" stop-opacity="0"/>` +
        `</radialGradient>`;
  }

  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<defs>${gradDef}</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${gid})"/>` +
    `</svg>`
  );

  return sharp(resized)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ─── Basic effects ─────────────────────────────────────────────
async function applyBasicEffect(imgBuf, effect, w, h) {
  let s = sharp(imgBuf).resize(w, h, { fit: 'cover', position: 'centre' });
  switch (effect) {
    case 'blur_dark':    s = s.blur(10).modulate({ brightness: 0.55 }); break;
    case 'blur_light':   s = s.blur(6).modulate({ brightness: 0.85 });  break;
    case 'overlay_dark': s = s.modulate({ brightness: 0.45 });           break;
    default: break;
  }
  return s.png().toBuffer();
}

// ─── Main Composer ─────────────────────────────────────────────
export async function composeImage({ templateId, assignments, colorOverride }) {
  const tmpl = TEMPLATES[templateId] || TEMPLATES.accident;
  const { zones } = tmpl.layout;

  // Dark canvas
  const canvasBuf = await sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: { r: 12, g: 12, b: 20, alpha: 255 },
    },
  }).png().toBuffer();

  const layers = [];

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

  // Subtle dark vignette — use fill-opacity NOT rgba()
  const vignette = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}">` +
    `<rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="black" fill-opacity="0.15"/>` +
    `</svg>`
  );
  layers.push({ input: vignette, blend: 'over' });

  return sharp(canvasBuf)
    .composite(layers)
    .jpeg({ quality: 93 })
    .toBuffer();
}

export default composeImage;
