/**
 * Image Composer — Sharp.js Engine
 * รับ Layout JSON จาก AI + รูปจริง → composite เป็นปกข่าว 1080x1080
 */

import sharp from 'sharp';
import { TEMPLATES } from './imageTemplates.js';

const CANVAS_SIZE = 1080;

// ─── Buffer helpers ────────────────────────────────────────────
async function fetchImageBuffer(src) {
  // src = base64 string or URL
  if (src.startsWith('data:')) {
    const b64 = src.split(',')[1];
    return Buffer.from(b64, 'base64');
  }
  if (src.startsWith('http')) {
    const res = await fetch(src);
    return Buffer.from(await res.arrayBuffer());
  }
  return Buffer.from(src, 'base64');
}

// ─── Effect processors ────────────────────────────────────────
async function applyEffect(imgBuf, effect, zone) {
  let s = sharp(imgBuf);

  const { w, h } = zone.position;

  // Resize to fit zone
  s = s.resize(w, h, { fit: 'cover', position: 'centre' });

  switch (effect) {
    case 'blur_dark':
      s = s.blur(12).modulate({ brightness: 0.6 });
      break;
    case 'blur_light':
      s = s.blur(8).modulate({ brightness: 0.85 });
      break;
    case 'grayscale':
    case 'circle_bw':
      s = s.grayscale();
      break;
    case 'overlay_dark':
      s = s.modulate({ brightness: 0.5 });
      break;
    default:
      break;
  }

  return s.png().toBuffer();
}

// ─── Soft edge mask (vignette on one side) ──────────────────
async function applySoftEdge(imgBuf, direction, w, h) {
  const buf = await sharp(imgBuf).resize(w, h, { fit: 'cover' }).png().toBuffer();

  // Create gradient mask SVG
  let gradientDef = '';
  if (direction === 'soft_right') {
    gradientDef = `<linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="white" stop-opacity="1"/><stop offset="85%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>`;
  } else if (direction === 'soft_left') {
    gradientDef = `<linearGradient id="g" x1="1" x2="0" y1="0" y2="0"><stop offset="0%" stop-color="white" stop-opacity="1"/><stop offset="85%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>`;
  } else if (direction === 'soft_top') {
    gradientDef = `<linearGradient id="g" x1="0" x2="0" y1="1" y2="0"><stop offset="0%" stop-color="white" stop-opacity="1"/><stop offset="80%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>`;
  } else {
    // soft_all — radial
    gradientDef = `<radialGradient id="g" cx="50%" cy="45%" r="55%"><stop offset="60%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient>`;
  }

  const maskSvg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs>${gradientDef}</defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`
  );

  return sharp(buf)
    .composite([{ input: maskSvg, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ─── Circle crop ───────────────────────────────────────────────
async function circlecrop(imgBuf, size) {
  const resized = await sharp(imgBuf).resize(size, size, { fit: 'cover' }).png().toBuffer();
  const circleSvg = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`
  );
  return sharp(resized)
    .composite([{ input: circleSvg, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ─── Colored border box ────────────────────────────────────────
async function addBorder(imgBuf, w, h, color, borderW = 7) {
  const inner = w - borderW * 2;
  const innerH = h - borderW * 2;
  const resized = await sharp(imgBuf).resize(inner, innerH, { fit: 'cover' }).png().toBuffer();

  const borderSvg = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${color}"/></svg>`
  );

  const borderBuf = await sharp(borderSvg)
    .composite([{ input: resized, left: borderW, top: borderW }])
    .png()
    .toBuffer();

  return borderBuf;
}

// ─── Main Composer ─────────────────────────────────────────────
/**
 * @param {Object} opts
 * @param {string} opts.templateId
 * @param {Object} opts.assignments — { zone_id: imageSrc (base64 or URL) }
 * @param {Object} [opts.colorOverride] — override border color
 * @returns {Promise<Buffer>} — PNG buffer 1080x1080
 */
export async function composeImage({ templateId, assignments, colorOverride }) {
  const tmpl = TEMPLATES[templateId] || TEMPLATES.accident;
  const { zones } = tmpl.layout;
  const borderColor = colorOverride?.border || tmpl.colorScheme.border;

  // 1. Black canvas base
  const canvas = sharp({
    create: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 4, background: { r: 15, g: 15, b: 25, alpha: 1 } },
  }).png();

  const layers = [];

  // 2. Process each zone
  for (const zone of zones) {
    const src = assignments[zone.id] || assignments[zone.role];
    if (!src) continue;

    const { x, y, w, h } = zone.position;
    let buf;

    try {
      const raw = await fetchImageBuffer(src);

      if (zone.effect === 'circle_bw' || zone.effect === 'circle_color') {
        const size = Math.min(w, h);
        let cb = await circlecp(raw, size);
        if (zone.effect === 'circle_bw') cb = await sharp(cb).grayscale().png().toBuffer();
        buf = cb;
        layers.push({ input: buf, left: x, top: y, blend: 'over' });
        continue;
      }

      if (zone.effect === 'border_green') buf = await addBorder(raw, w, h, '#22c55e', 7);
      else if (zone.effect === 'border_red') buf = await addBorder(raw, w, h, '#ef4444', 7);
      else if (zone.effect === 'border_gold') buf = await addBorder(raw, w, h, '#f59e0b', 7);
      else if (['soft_right', 'soft_left', 'soft_top', 'soft_all'].includes(zone.effect)) {
        buf = await applySoftEdge(raw, zone.effect, w, h);
      } else {
        buf = await applyEffect(raw, zone.effect, zone);
        buf = await sharp(buf).resize(w, h, { fit: 'cover' }).png().toBuffer();
      }

      layers.push({ input: buf, left: x, top: y, blend: 'over' });
    } catch (e) {
      console.warn(`[Composer] Zone ${zone.id} skip:`, e.message);
    }
  }

  // 3. Dark overlay on full canvas for mood
  const overlayBuf = Buffer.from(
    `<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}"><rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="rgba(0,0,0,0.15)"/></svg>`
  );
  layers.push({ input: overlayBuf, blend: 'over' });

  // 4. Composite all layers
  const result = await canvas
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();

  return result;
}

// fix typo helper
async function circlecp(buf, size) { return circlecp_real(buf, size); }
async function circlecp_real(imgBuf, size) { return circlecrop(imgBuf, size); }

export default composeImage;
