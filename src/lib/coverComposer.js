import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Cover Composer — Editorial Design Engine
 * Uses Sharp.js for composite layouts and advanced typography.
 *
 * Upgrades:
 *  1. Thai Font Fix — Noto Sans Thai Bold embedded as base64 @font-face in SVG
 *  2. Face Crop Protection — smartCropPhoto with portrait-aware positioning
 *  3. Editorial Geometry Config — centralised EDITORIAL_GEOMETRY object
 */

// ═══ EDITORIAL GEOMETRY CONFIG ═══
const EDITORIAL_GEOMETRY = {
  heroCircleMaxRatio: 0.32,   // circle ≤ 32% of canvas = 345px max
  circleBorder: 12,
  circleOffsetY: -20,
  margin: 32,
  gap: 12,
  safeFacePadding: 24,
  minImageSpacing: 10,
};

// ═══ THAI FONT LOADER (base64 embed) ═══
const THAI_FONT_PATH = (() => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.resolve(__dirname, '..', 'assets', 'fonts', 'NotoSansThai-Bold.ttf');
  } catch {
    return path.resolve(process.cwd(), 'src', 'assets', 'fonts', 'NotoSansThai-Bold.ttf');
  }
})();

const THAI_FONT_CDN_URL =
  'https://fonts.gstatic.com/s/notosansthai/v25/iJWnBXeUZi_OHPqn4wq6hQ2_hbJ1xyN9wd43SofNWcd1MKVQt_So_9CdU5RtpzF-QRvzzXg.ttf';

/** @type {string | null} */
let _cachedFontBase64 = null;

/**
 * Load Noto Sans Thai Bold as a base64 string.
 * Priority: local file → CDN (fetched once and cached in memory).
 */
async function loadThaiFontBase64() {
  if (_cachedFontBase64) return _cachedFontBase64;

  // Try local file first
  try {
    if (fs.existsSync(THAI_FONT_PATH)) {
      const buf = fs.readFileSync(THAI_FONT_PATH);
      _cachedFontBase64 = buf.toString('base64');
      return _cachedFontBase64;
    }
  } catch {
    // fall through to CDN
  }

  // Fetch from CDN
  try {
    const res = await fetch(THAI_FONT_CDN_URL);
    if (!res.ok) throw new Error(`Font CDN returned ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    _cachedFontBase64 = buf.toString('base64');

    // Opportunistically save to disk for future cold starts
    try {
      fs.mkdirSync(path.dirname(THAI_FONT_PATH), { recursive: true });
      fs.writeFileSync(THAI_FONT_PATH, buf);
    } catch {
      // Non-critical — we already have it in memory
    }

    return _cachedFontBase64;
  } catch (err) {
    console.warn('[coverComposer] Failed to load Thai font:', err.message);
    return null; // Will fall back to sans-serif only
  }
}

// ═══ FACE-CROP-PROTECTED IMAGE RESIZE ═══

/**
 * Smart-crop an image buffer to the target dimensions.
 * • Portrait sources (h > w): anchor to top to avoid cutting faces.
 * • Landscape / square: use sharp.strategy.attention for saliency crop.
 */
async function smartCropPhoto(imageBuffer, w, h) {
  const meta = await sharp(imageBuffer).metadata();
  const isPortrait = (meta.height || 0) > (meta.width || 0);

  return sharp(imageBuffer)
    .resize(w, h, {
      fit: 'cover',
      position: isPortrait ? 'top' : sharp.strategy.attention,
    })
    .png()
    .toBuffer();
}

/**
 * Create a circular avatar image with a white border ring.
 * Uses smartCropPhoto logic internally.
 */
async function createCircleImage(imageBuffer, size, borderWidth = 8) {
  // Smart-crop the source before circling
  const meta = await sharp(imageBuffer).metadata();
  const isPortrait = (meta.height || 0) > (meta.width || 0);

  const resized = await sharp(imageBuffer)
    .resize(size, size, {
      fit: 'cover',
      position: isPortrait ? 'top' : sharp.strategy.attention,
    })
    .png()
    .toBuffer();

  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`
  );

  const circled = await sharp(resized)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const totalSize = size + borderWidth * 2;
  const ring = Buffer.from(
    `<svg width="${totalSize}" height="${totalSize}">
      <circle cx="${totalSize / 2}" cy="${totalSize / 2}" r="${totalSize / 2}" fill="white"/>
      <circle cx="${totalSize / 2}" cy="${totalSize / 2}" r="${totalSize / 2 - borderWidth}" fill="black"/>
    </svg>`
  );

  const ringBuf = await sharp(ring).png().toBuffer();

  return sharp({
    create: {
      width: totalSize,
      height: totalSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: ringBuf, left: 0, top: 0 },
      { input: circled, left: borderWidth, top: borderWidth },
    ])
    .png()
    .toBuffer();
}

// ═══ HELPERS ═══

function hexToRgba(hex, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b, alpha };
}

function escapeXml(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══ 3-LINE TYPOGRAPHY SYSTEM (with embedded Thai font) ═══

/**
 * Build the SVG `<defs>` block that embeds the Thai font via @font-face.
 * Returns an empty string when the font is unavailable.
 */
function buildFontDefs(fontBase64) {
  if (!fontBase64) return '';
  return `
    <style type="text/css">
      @font-face {
        font-family: 'NotoSansThai';
        font-weight: bold;
        src: url(data:font/truetype;charset=utf-8;base64,${fontBase64}) format('truetype');
      }
    </style>`;
}

function createTextOverlaySvg(w, typography, accentColor = '#e11d48', fontBase64 = null) {
  const barH = 240;
  const paddingX = 40;
  const hookWidth = typography.hook.length * 15 + 40;
  const fontFamily = fontBase64
    ? "'NotoSansThai', sans-serif"
    : 'sans-serif';

  return Buffer.from(
    `<svg width="${w}" height="${barH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="textGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(0,0,0,0)" />
          <stop offset="40%" stop-color="rgba(0,0,0,0.7)" />
          <stop offset="100%" stop-color="rgba(0,0,0,0.95)" />
        </linearGradient>
        ${buildFontDefs(fontBase64)}
      </defs>
      <rect x="0" y="0" width="${w}" height="${barH}" fill="url(#textGrad)" />

      <!-- Bottom Accent Bar -->
      <rect x="0" y="${barH - 8}" width="${w}" height="8" fill="${accentColor}"/>

      <!-- Line 1: Hook -->
      <rect x="${paddingX}" y="20" width="${hookWidth}" height="36" fill="${accentColor}" rx="4"/>
      <text x="${paddingX + hookWidth / 2}" y="45" text-anchor="middle" font-size="20" font-weight="900" fill="white" font-family="${fontFamily}">${escapeXml(typography.hook)}</text>

      <!-- Line 2: Main Point -->
      <text x="${paddingX}" y="110" font-size="52" font-weight="900" fill="white" font-family="${fontFamily}">${escapeXml(typography.main)}</text>

      <!-- Line 3: Emotional Punch -->
      <text x="${paddingX}" y="170" font-size="34" font-weight="500" fill="rgba(255,255,255,0.85)" font-family="${fontFamily}">${escapeXml(typography.punch)}</text>
    </svg>`
  );
}

async function applyFeatheredMask(imageBuffer, w, h, direction = 'bottom') {
  const grad =
    direction === 'bottom'
      ? `<linearGradient id="grad" x1="0" y1="0" x2="0" y2="1"><stop offset="60%" stop-color="white"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>`
      : `<linearGradient id="grad" x1="0" y1="0" x2="1" y2="0"><stop offset="60%" stop-color="white"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>`;

  const svgMask = Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>${grad}</defs>
      <rect width="${w}" height="${h}" fill="url(#grad)" />
    </svg>
  `);

  return sharp(imageBuffer)
    .composite([{ input: svgMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ═══ EDITORIAL LAYOUT DEFINITION (news-grid-circle only) ═══

function getLayout(layoutName, W, H, numPhotos) {
  const { margin, gap, heroCircleMaxRatio, circleBorder, circleOffsetY } =
    EDITORIAL_GEOMETRY;

  const slotSize = Math.floor((W - margin * 2 - gap) / 2);

  // 4 background image slots in a 2×2 grid
  const slots = [
    { x: margin, y: margin, w: slotSize, h: slotSize },
    { x: margin + slotSize + gap, y: margin, w: slotSize, h: slotSize },
    { x: margin, y: margin + slotSize + gap, w: slotSize, h: slotSize },
    { x: margin + slotSize + gap, y: margin + slotSize + gap, w: slotSize, h: slotSize },
  ];

  // Circle — capped at heroCircleMaxRatio of the canvas
  const maxCircle = Math.floor(W * heroCircleMaxRatio);
  const circleSize = Math.min(maxCircle, 340);
  const totalCircle = circleSize + circleBorder * 2;
  const cx = Math.floor((W - totalCircle) / 2);
  const cy = Math.floor((H - totalCircle) / 2) + circleOffsetY;

  return {
    slots,
    circle: { x: cx, y: cy, size: circleSize, border: circleBorder },
  };
}

// ═══ MAIN COMPOSE FUNCTION ═══

export async function composeCover(plan, imageBuffers) {
  const W = plan.width || 1080;
  const H = plan.height || 1080;
  const bgColor = plan.borderColor || '#111827';
  const accentColor = plan.accentColor || '#e11d48';

  // Always use news-grid-circle layout
  const layout = getLayout('news-grid-circle', W, H, imageBuffers.length);
  const photoOrder = plan.photoOrder || [0, 1, 2, 3];
  const composites = [];

  // Pre-load Thai font (first call fetches, subsequent calls use cache)
  const fontBase64 = await loadThaiFontBase64();

  // 1. Background
  composites.push({
    input: await sharp({
      create: { width: W, height: H, channels: 4, background: hexToRgba(bgColor) },
    })
      .png()
      .toBuffer(),
    left: 0,
    top: 0,
  });

  // 2. Insert Photos (back to front)
  for (let i = layout.slots.length - 1; i >= 0; i--) {
    const slot = layout.slots[i];
    const imgIdx = photoOrder[i];

    if (imgIdx !== undefined && imageBuffers[imgIdx]) {
      let resized = await smartCropPhoto(imageBuffers[imgIdx], slot.w, slot.h);
      if (slot.featherBottom) {
        resized = await applyFeatheredMask(resized, slot.w, slot.h, 'bottom');
      }
      composites.push({ input: resized, left: slot.x, top: slot.y });
    }
  }

  // 3. Center Circle
  if (layout.circle) {
    const circleImgIdx =
      plan.circlePhotoIndex !== undefined ? plan.circlePhotoIndex : 0;
    if (imageBuffers[circleImgIdx]) {
      const circleBuf = await createCircleImage(
        imageBuffers[circleImgIdx],
        layout.circle.size,
        layout.circle.border
      );
      composites.push({
        input: circleBuf,
        left: layout.circle.x,
        top: layout.circle.y,
      });
    }
  }

  // 4. Advanced Typography Text Overlay
  // Removed per user request to keep the cover clean without text overlays
  // if (plan.typography) {
  //   const textSvg = createTextOverlaySvg(W, plan.typography, accentColor, fontBase64);
  //   composites.push({ input: textSvg, left: 0, top: H - 240 });
  // }

  // Compose final image — JPEG quality 92
  const result = await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toBuffer();

  return result;
}
