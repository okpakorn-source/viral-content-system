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
 * 
 * cropStrategy:
 *   'portrait-upper' — ครึ่งตัวบน: หน้าที่ ~35% จากบน (สำหรับ hero/emotion)
 *   'face-tight'     — zoom เข้าหน้าเต็มพื้นที่ (สำหรับ circle)
 *   'center-face'    — center ที่หน้า (สำหรับ highlight)
 *   'attention'      — ภาพรวม saliency (สำหรับ scene)
 *   null             — auto detect จาก orientation
 */
async function smartCropPhoto(imageBuffer, w, h, faceData = null, cropStrategy = null) {
  // ★ Guard: dimensions ต้อง valid
  w = Math.round(Math.max(1, w || 1));
  h = Math.round(Math.max(1, h || 1));
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    return sharp(imageBuffer).resize(100, 100, { fit: 'cover' }).png().toBuffer();
  }
  try {
    const meta = await sharp(imageBuffer).metadata();
    const srcW = meta.width || w;
    const srcH = meta.height || h;

    // ถ้ามี face data → crop โดย focus ที่ใบหน้า ตาม strategy
    if (faceData && faceData.hasFaces && faceData.faces && faceData.faces.length > 0) {
      const faces = faceData.faces;
      
      // ★ Multi-face: คำนวณ bounding box ของทุกใบหน้า
      let focusCX, focusCY, focusW, focusH;
      
      if (faces.length === 1) {
        // ★ 1 คนเท่านั้น → zoom เข้าหน้าเดียว (face-tight หรือ portrait-upper)
        const face = faces[0];
        focusCX = face.x + face.width / 2;
        focusCY = face.y + face.height / 2;
        focusW = face.width;
        focusH = face.height;
      } else {
        // หลายคน → bounding box ครอบทุกหน้า
        let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
        for (const face of faces) {
          minX = Math.min(minX, face.x);
          minY = Math.min(minY, face.y);
          maxX = Math.max(maxX, face.x + face.width);
          maxY = Math.max(maxY, face.y + face.height);
        }
        focusCX = (minX + maxX) / 2;
        focusCY = (minY + maxY) / 2;
        focusW = maxX - minX;
        focusH = maxY - minY;
      }

      // คำนวณ crop region
      const targetRatio = w / h;
      let cropW, cropH;

      if (cropStrategy === 'face-tight') {
        // Circle: zoom เข้าหน้าเต็มวง
        const faceSize = Math.max(focusW, focusH);
        const zoomSize = Math.max(faceSize * 2.5, Math.min(srcW, srcH) * 0.4);
        cropW = Math.round(Math.min(zoomSize * targetRatio, srcW));
        cropH = Math.round(Math.min(zoomSize, srcH));
        if (cropW / cropH > targetRatio) cropW = Math.round(cropH * targetRatio);
        else cropH = Math.round(cropW / targetRatio);
      } else if (faces.length > 1) {
        // Multi-face: crop ต้องใหญ่พอครอบทุกหน้า + padding 30%
        const pad = 1.3;
        const neededW = focusW * pad;
        const neededH = focusH * pad * 2;
        if (neededW / neededH > targetRatio) {
          cropW = Math.round(Math.min(neededW, srcW));
          cropH = Math.round(cropW / targetRatio);
        } else {
          cropH = Math.round(Math.min(neededH, srcH));
          cropW = Math.round(cropH * targetRatio);
        }
        cropW = Math.min(Math.max(cropW, Math.round(srcW * 0.5)), srcW);
        cropH = Math.min(Math.max(cropH, Math.round(srcH * 0.5)), srcH);
      } else if (srcW / srcH > targetRatio) {
        cropH = srcH;
        cropW = Math.round(cropH * targetRatio);
      } else {
        cropW = srcW;
        cropH = Math.round(cropW / targetRatio);
      }

      // ★ ตำแหน่ง crop — ทุก strategy ต้องให้ใบหน้าอยู่ใน crop region เสมอ
      let cropX, cropY;
      
      if (cropStrategy === 'portrait-upper') {
        // ★ Hero: ให้หน้าอยู่ที่ ~25-30% จากบน — เห็นหัว+ไหล่+หน้าอก
        // Step 1: คำนวณให้ใบหน้าอยู่ที่ 28% จากบนของ crop region
        const faceTargetY = cropH * 0.28; // หน้าอยู่ 28% จากบน
        cropX = Math.round(focusCX - cropW / 2);
        cropY = Math.round(focusCY - faceTargetY);
        
        // ★ Safety: ต้องเห็นหัว → เหลือ padding ด้านบนหน้าอย่างน้อย 15% ของหน้า
        const headPadding = Math.max(focusH * 0.5, 20); // padding ด้านบนหัว
        const faceTop = focusCY - focusH / 2;
        if (faceTop - cropY < headPadding) {
          cropY = Math.max(0, Math.round(faceTop - headPadding));
        }
        
        // ★ Safety: ถ้า cropY ติดลบ = หน้าอยู่บนสุด → ให้เริ่มจาก 0
        if (cropY < 0) cropY = 0;
        // ★ Safety: ถ้า crop เกินล่าง → เลื่อนขึ้น
        if (cropY + cropH > srcH) cropY = Math.max(0, srcH - cropH);
        
        // ★ Safety: ใบหน้าต้องอยู่ใน crop region เด็ดขาด
        const faceBottom = focusCY + focusH / 2;
        if (faceTop < cropY) {
          cropY = Math.max(0, Math.round(faceTop - headPadding));
        }
        if (faceBottom > cropY + cropH) {
          cropY = Math.max(0, Math.round(faceBottom - cropH + focusH * 0.5));
        }
        
        // ★ Safety: ใบหน้าต้องไม่ตกขอบซ้าย-ขวา
        const faceLeft = focusCX - focusW / 2;
        const faceRight = focusCX + focusW / 2;
        const sidePadding = focusW * 0.3;
        if (faceLeft - cropX < sidePadding) {
          cropX = Math.max(0, Math.round(faceLeft - sidePadding));
        }
        if (faceRight > cropX + cropW - sidePadding) {
          cropX = Math.min(srcW - cropW, Math.round(faceRight - cropW + sidePadding));
        }
      } else {
        // center-face / face-tight / scene-with-face: center ที่จุดกลางหน้า
        cropX = Math.round(focusCX - cropW / 2);
        cropY = Math.round(focusCY - cropH / 2);
        
        // ★ Safety: ตรวจสอบทุกใบหน้าอยู่ใน crop — เพิ่ม padding 30%
        for (const face of faces) {
          const fx = face.x;
          const fy = face.y;
          const fw = face.width;
          const fh = face.height;
          // ถ้าหน้าตกขอบซ้าย → เลื่อน crop ไปซ้าย
          if (fx < cropX) cropX = Math.max(0, fx - Math.round(fw * 0.3));
          // ถ้าหน้าตกขอบขวา → เลื่อน crop ไปขวา
          if (fx + fw > cropX + cropW) cropX = Math.min(srcW - cropW, Math.round(fx + fw - cropW + fw * 0.3));
          // ถ้าหน้าตกขอบบน
          if (fy < cropY) cropY = Math.max(0, fy - Math.round(fh * 0.3));
          // ถ้าหน้าตกขอบล่าง
          if (fy + fh > cropY + cropH) cropY = Math.min(srcH - cropH, Math.round(fy + fh - cropH + fh * 0.3));
        }
      }

      // Clamp ไม่เกินขอบภาพ
      cropX = Math.max(0, Math.min(cropX, srcW - cropW));
      cropY = Math.max(0, Math.min(cropY, srcH - cropH));
      cropW = Math.min(cropW, srcW);
      cropH = Math.min(cropH, srcH);

      if (cropW > 0 && cropH > 0) {
        console.log(`[Composer] 🎯 Face crop: strategy=${cropStrategy||'center'}, faces=${faces.length}, focus=(${Math.round(focusCX)},${Math.round(focusCY)}), crop=(${cropX},${cropY},${cropW}x${cropH}), src=${srcW}x${srcH}`);
        return sharp(imageBuffer)
          .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
          .resize(w, h, { fit: 'cover', position: 'centre' })
          .png()
          .toBuffer();
      }
    }

    // Fallback: ★ ใช้ centre เสมอ (ไม่ใช้ top — เพราะหน้าอาจอยู่ตรงกลาง/ล่าง)
    return sharp(imageBuffer)
      .resize(w, h, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
  } catch (e) {
    // Ultimate fallback: force resize
    return sharp(imageBuffer)
      .resize(w, h, { fit: 'cover' })
      .png()
      .toBuffer();
  }
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

/**
 * สร้าง fade mask แบบ multi-direction เหมือน cover-tester/page.js createFadeMask()
 * รองรับ fade ทั้ง 4 ทิศพร้อมกัน: right, left, top, bottom
 * ★ แก้ไข: ใช้ multi-pass composite เพื่อให้มุมทับกัน multiply ได้ถูกต้อง
 */
async function applyMultiDirectionalFade(imageBuffer, w, h, fadeRight = 0, fadeLeft = 0, fadeTop = 0, fadeBottom = 0) {
  if (!fadeRight && !fadeLeft && !fadeTop && !fadeBottom) return imageBuffer;
  w = Math.round(Math.max(1, w || 1));
  h = Math.round(Math.max(1, h || 1));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return imageBuffer;

  // ★ Resize + ensure 4-channel RGBA → ดึง raw buffer
  const { data: rgbaData, info } = await sharp(imageBuffer)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // ★ Modify alpha channel โดยตรง — guaranteed to work
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4; // RGBA = 4 bytes per pixel
      let alphaMultiplier = 1.0;

      // Fade right
      if (fadeRight > 0 && x > w - fadeRight) {
        const t = (x - (w - fadeRight)) / fadeRight;
        alphaMultiplier = Math.min(alphaMultiplier, 1 - t);
      }
      // Fade left
      if (fadeLeft > 0 && x < fadeLeft) {
        const t = x / fadeLeft;
        alphaMultiplier = Math.min(alphaMultiplier, t);
      }
      // Fade bottom
      if (fadeBottom > 0 && y > h - fadeBottom) {
        const t = (y - (h - fadeBottom)) / fadeBottom;
        alphaMultiplier = Math.min(alphaMultiplier, 1 - t);
      }
      // Fade top
      if (fadeTop > 0 && y < fadeTop) {
        const t = y / fadeTop;
        alphaMultiplier = Math.min(alphaMultiplier, t);
      }

      // Apply: multiply existing alpha
      rgbaData[idx + 3] = Math.round(rgbaData[idx + 3] * alphaMultiplier);
    }
  }

  // ★ สร้างภาพใหม่จาก modified buffer
  return sharp(Buffer.from(rgbaData), { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}

// Legacy wrapper (backward compat)
async function applyFeatheredMask(imageBuffer, w, h, direction = 'bottom') {
  if (direction === 'bottom') return applyMultiDirectionalFade(imageBuffer, w, h, 0, 0, 0, Math.round(h * 0.4));
  if (direction === 'right') return applyMultiDirectionalFade(imageBuffer, w, h, Math.round(w * 0.4), 0, 0, 0);
  return imageBuffer;
}

// ═══ EDITORIAL LAYOUT DEFINITIONS ═══

function getLayout(layoutName, W, H, numPhotos) {
  const geo = EDITORIAL_GEOMETRY;
  const { margin, gap, heroCircleMaxRatio, circleBorder, circleOffsetY } = geo;

  switch (layoutName) {

    // Layout 2: Full-left hero + 2 right stacked + highlight + circle
    case 'hero-left-stack': {
      const leftW = Math.round(W * 0.55);
      const rightW = W - leftW - gap;
      const rightH = Math.round((H - gap) / 2);
      return {
        slots: [
          { x: margin, y: margin, w: leftW, h: H - margin * 2, role: 'hero', fade: 'right' },
          { x: leftW + gap + margin, y: margin, w: rightW - margin, h: rightH, role: 'scene', fade: 'left' },
          { x: leftW + gap + margin, y: margin + rightH + gap, w: rightW - margin, h: rightH, role: 'scene', fade: 'left' },
        ],
        circle: {
          cx: Math.round(W * 0.55),
          cy: Math.round(H * 0.5),
          r: Math.min(Math.round(W * 0.16), 170),
          border: geo.circleBorder,
        },
      };
    }

    // Layout 3: 4 quadrants equal + center circle (classic)
    case 'quad-circle': {
      const halfW = Math.round((W - margin * 2 - gap) / 2);
      const halfH = Math.round((H - margin * 2 - gap) / 2);
      return {
        slots: [
          { x: margin, y: margin, w: halfW, h: halfH, role: 'hero', fade: 'bottom-right' },
          { x: margin + halfW + gap, y: margin, w: halfW, h: halfH, role: 'scene', fade: 'bottom-left' },
          { x: margin, y: margin + halfH + gap, w: halfW, h: halfH, role: 'scene', fade: 'top-right' },
          { x: margin + halfW + gap, y: margin + halfH + gap, w: halfW, h: halfH, role: 'support', fade: 'top-left' },
        ],
        circle: {
          cx: Math.round(W / 2),
          cy: Math.round(H / 2),
          r: Math.min(Math.round(W * 0.18), 190),
          border: geo.circleBorder,
        },
      };
    }

    // Layout 4: Big top + 3 bottom columns
    case 'top-hero-tri': {
      const topH = Math.round(H * 0.55);
      const botH = H - topH - gap - margin * 2;
      const colW = Math.round((W - margin * 2 - gap * 2) / 3);
      return {
        slots: [
          { x: margin, y: margin, w: W - margin * 2, h: topH, role: 'hero', fade: 'bottom' },
          { x: margin, y: margin + topH + gap, w: colW, h: botH, role: 'scene', fade: 'top' },
          { x: margin + colW + gap, y: margin + topH + gap, w: colW, h: botH, role: 'scene', fade: 'top' },
          { x: margin + colW * 2 + gap * 2, y: margin + topH + gap, w: colW, h: botH, role: 'support', fade: 'top' },
        ],
        circle: null,
      };
    }

    // Layout 5: Horizontal strip (3 tall panels side by side)
    case 'tri-panel': {
      const panelW = Math.round((W - margin * 2 - gap * 2) / 3);
      const panelH = H - margin * 2;
      return {
        slots: [
          { x: margin, y: margin, w: panelW, h: panelH, role: 'hero', fade: 'right' },
          { x: margin + panelW + gap, y: margin, w: panelW, h: panelH, role: 'scene', fade: 'left-right' },
          { x: margin + panelW * 2 + gap * 2, y: margin, w: panelW, h: panelH, role: 'support', fade: 'left' },
        ],
        circle: {
          cx: Math.round(W / 2),
          cy: Math.round(H / 2),
          r: Math.min(Math.round(W * 0.15), 160),
          border: geo.circleBorder,
        },
      };
    }

    // Layout 1 (default): news-grid-circle — 2×2 grid with center circle
    case 'news-grid-circle':
    default: {
      const slotSize = Math.floor((W - margin * 2 - gap) / 2);
      const slots = [
        { x: margin, y: margin, w: slotSize, h: slotSize },
        { x: margin + slotSize + gap, y: margin, w: slotSize, h: slotSize },
        { x: margin, y: margin + slotSize + gap, w: slotSize, h: slotSize },
        { x: margin + slotSize + gap, y: margin + slotSize + gap, w: slotSize, h: slotSize },
      ];
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
  }
}

// ═══ MAIN COMPOSE FUNCTION ═══
// Render เหมือน cover-tester/page.js 100%:
// 1. Blurred background (ไม่มีจุดดำ)
// 2. zIndex sorting (low → high)
// 3. Multi-directional fade (fadeRight, fadeLeft, fadeTop, fadeBottom)
// 4. Highlight border + shadow
// 5. Circle with colored border + shadow
// 6. circleSmall support

export async function composeCover(plan, imageBuffers, faceDataMap = null) {
  const photoOrder = plan.photoOrder || imageBuffers.map((_, i) => i);

  // ★ ดึง template จาก registry (6 template จริงจากหน้าปกข่าว) ★
  let templateData = null;
  let W, H, layoutSlots, layoutCircle, layoutCircleSmall;

  try {
    const { getTemplateById } = await import('@/lib/coverTemplateRegistry');
    templateData = getTemplateById(plan.layout);
  } catch {}

  if (templateData) {
    W = templateData.canvasW;
    H = templateData.canvasH;
    layoutSlots = templateData.slots;
    layoutCircle = templateData.circle;
    layoutCircleSmall = templateData.circleSmall;
  } else {
    // Fallback: ใช้ old getLayout
    W = plan.width || 1080;
    H = plan.height || 1080;
    const layout = getLayout(plan.layout || 'news-grid-circle', W, H, imageBuffers.length);
    layoutSlots = layout.slots;
    layoutCircle = layout.circle;
    layoutCircleSmall = null;
  }

  const composites = [];

  // ═══ Step 1: Blurred background (เหมือน drawBlurredBg) ═══
  // ใช้ภาพ main blur+darken เต็ม canvas → ไม่มีจุดดำ
  const mainImgIdx = photoOrder[0];
  if (mainImgIdx !== undefined && imageBuffers[mainImgIdx]) {
    try {
      // resize ตรง W×H (ไม่ใช้ W+40 เพราะ Sharp ไม่ยอม composite ภาพที่ใหญ่กว่า canvas)
      // ★ Background เข้มขึ้น + blur มากขึ้น เหมือนปก Viral จริง
      // ★ Background สว่างขึ้น (0.35) เพื่อให้ fade เห็นชัด — ไม่ใช้ 0.15 เพราะมืดเกินไป
      const blurredBg = await sharp(imageBuffers[mainImgIdx])
        .resize(W, H, { fit: 'cover', position: 'centre' })
        .blur(60)
        .modulate({ brightness: 0.35, saturation: 0.4 })
        .png()
        .toBuffer();
      composites.push({ input: blurredBg, left: 0, top: 0 });
    } catch (bgErr) {
      console.log('[Composer] Blurred bg failed:', bgErr.message);
      // fallback: solid dark background
      composites.push({
        input: await sharp({
          create: { width: W, height: H, channels: 4, background: { r: 17, g: 17, b: 25, alpha: 1 } },
        }).png().toBuffer(),
        left: 0, top: 0,
      });
    }
  } else {
    composites.push({
      input: await sharp({
        create: { width: W, height: H, channels: 4, background: { r: 17, g: 17, b: 25, alpha: 1 } },
      }).png().toBuffer(),
      left: 0, top: 0,
    });
  }

  // ═══ Step 2: Sort slots by zIndex (low → high) เหมือน cover-tester ═══
  const sortedSlots = [...layoutSlots].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  // ═══ Step 2.5: ★ Anti-overlap: เลื่อน highlight ถ้าทับหน้าคนใน Hero ═══
  const heroSlotIdx = layoutSlots.findIndex(s => s.id === 'main' || s.role === 'hero');
  const heroImgIdx = heroSlotIdx >= 0 ? photoOrder[heroSlotIdx] : 0;
  const heroFaceData = faceDataMap?.get?.(String(heroImgIdx));
  
  if (heroFaceData?.hasFaces && heroFaceData.faces.length > 0) {
    const heroSlot = layoutSlots[heroSlotIdx] || layoutSlots[0];
    // คำนวณตำแหน่งหน้าใน canvas coordinates (ประมาณ)
    const heroMeta = imageBuffers[heroImgIdx] ? await sharp(imageBuffers[heroImgIdx]).metadata().catch(() => ({})) : {};
    const scaleX = (heroSlot.w || W) / (heroMeta.width || heroSlot.w || W);
    const scaleY = (heroSlot.h || H) / (heroMeta.height || heroSlot.h || H);
    
    for (const face of heroFaceData.faces) {
      const faceCanvasX = (heroSlot.x || 0) + face.x * scaleX;
      const faceCanvasY = (heroSlot.y || 0) + face.y * scaleY;
      const faceCanvasW = face.width * scaleX;
      const faceCanvasH = face.height * scaleY;
      
      // เช็คทุก slot ที่มี border (highlight/sub) ว่าทับหน้าไหม
      for (const slot of sortedSlots) {
        if (!slot.border || !slot.borderWidth) continue;
        
        // เช็ค overlap
        const overlapsX = slot.x < faceCanvasX + faceCanvasW && slot.x + slot.w > faceCanvasX;
        const overlapsY = slot.y < faceCanvasY + faceCanvasH && slot.y + slot.h > faceCanvasY;
        
        if (overlapsX && overlapsY) {
          console.log(`[Composer] ⚠️ Highlight "${slot.id}" ทับหน้าคน! กำลังเลื่อน...`);
          // ลองเลื่อนขวา
          const newX = Math.round(faceCanvasX + faceCanvasW + 20);
          if (newX + slot.w <= W) {
            slot.x = newX;
            console.log(`[Composer] ✅ เลื่อน highlight ไปขวา x=${newX}`);
          } else {
            // ลองเลื่อนลง
            const newY = Math.round(faceCanvasY + faceCanvasH + 20);
            if (newY + slot.h <= H) {
              slot.y = newY;
              console.log(`[Composer] ✅ เลื่อน highlight ลงล่าง y=${newY}`);
            }
          }
        }
      }
    }
  }

  // ═══ Step 3: Render rect slots — ตามลำดับ zIndex ═══
  for (const slot of sortedSlots) {
    // หา index ของ slot ใน layoutSlots เดิม เพื่อ map กับ photoOrder
    const slotIdx = layoutSlots.indexOf(slot);
    const imgIdx = photoOrder[slotIdx];

    if (imgIdx === undefined || !imageBuffers[imgIdx]) continue;

    // Clamp position ให้ไม่เกินขอบ canvas + ★ Guard dimensions
    // ★ Handle circle slots ที่ใช้ diameter แทน w/h
    const slotW = slot.w || slot.diameter || 1;
    const slotH = slot.h || slot.diameter || 1;
    const safeX = Math.max(0, Math.min(Math.round(slot.x || 0), W - 1));
    const safeY = Math.max(0, Math.min(Math.round(slot.y || 0), H - 1));
    const safeW = Math.max(1, Math.min(Math.round(slotW), W - safeX));
    const safeH = Math.max(1, Math.min(Math.round(slotH), H - safeY));

    if (safeW <= 1 || safeH <= 1) continue;

    // 3a. Circle shape → render เป็นวงกลม (เช่น circle_small ใน template_4)
    if (slot.shape === 'circle' && slot.diameter) {
      try {
        const d = Math.round(slot.diameter);
        const slotFaceData = faceDataMap?.get?.(String(imgIdx)) || null;
        const circleImg = await createCircleImageColored(
          imageBuffers[imgIdx], d, slot.borderWidth || 4, slot.border || '#FFFFFF', slotFaceData
        );
        composites.push({ input: circleImg, left: safeX, top: safeY });
      } catch (e) {
        console.log(`[Composer] Circle slot ${slot.id} error:`, e.message);
      }
    }
    // 3b. Highlight border → วาด border ก่อน image
    else if (slot.border && slot.borderWidth) {
      const bw = slot.borderWidth;
      const borderW = Math.max(4, Math.round(Math.min(safeW + 4, W - safeX + 2)));
      const borderH = Math.max(4, Math.round(Math.min(safeH + 4, H - safeY + 2)));
      const borderLeft = Math.max(0, safeX - 2);
      const borderTop = Math.max(0, safeY - 2);

      if (borderW > 4 && borderH > 4) {
        try {
          const borderSvg = Buffer.from(
            `<svg width="${borderW}" height="${borderH}" xmlns="http://www.w3.org/2000/svg">
              <defs><filter id="shadow"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.5"/></filter></defs>
              <rect x="2" y="2" width="${borderW - 4}" height="${borderH - 4}" fill="${slot.border}" filter="url(#shadow)"/>
            </svg>`
          );
          composites.push({ input: borderSvg, left: borderLeft, top: borderTop });
        } catch {}
      }

      const innerW = safeW - bw * 2;
      const innerH = safeH - bw * 2;
      if (innerW > 0 && innerH > 0) {
        try {
          const slotFaceData = faceDataMap?.get?.(String(imgIdx)) || null;
          const slotStrategy = (slot.role === 'hero' || slot.id === 'main') ? 'center-face' : 'center-face';
          const resized = await smartCropPhoto(imageBuffers[imgIdx], innerW, innerH, slotFaceData, slotStrategy);
          composites.push({ input: resized, left: safeX + bw, top: safeY + bw });
        } catch (e) {
          console.log(`[Composer] Slot ${slotIdx} border render error:`, e.message);
        }
      }
    } else {
      // 3b. Normal slot → smart crop + multi-directional fade
      try {
        // ★ เลือก crop strategy ตาม role ของ slot
        const slotRole = slot.role || slot.id || '';
        const slotFaceData = faceDataMap?.get?.(String(imgIdx)) || null;
        let cropStrat;
        if (slotRole === 'hero' || slotRole === 'main' || slot.id === 'main') {
          cropStrat = 'portrait-upper'; // Hero: ครึ่งตัวบน หน้าชัด
        } else if (slotRole === 'emotion') {
          cropStrat = 'portrait-upper'; // Emotion: ครึ่งตัวบน
        } else if (slotRole === 'highlight') {
          cropStrat = 'center-face';    // Highlight: center ที่หน้า
        } else if (slotFaceData?.hasFaces) {
          cropStrat = 'center-face';    // Scene/Context ที่มีคน: center ที่คน ไม่ตัดหน้า
        } else {
          cropStrat = 'attention';      // Scene ไม่มีคน: ใช้ saliency
        }
        let resized = await smartCropPhoto(imageBuffers[imgIdx], safeW, safeH, slotFaceData, cropStrat);

        // Apply fade ทั้ง 4 ทิศพร้อมกัน (เหมือน cover-tester createFadeMask)
        const fR = slot.fadeRight || 0;
        const fL = slot.fadeLeft || 0;
        const fT = slot.fadeTop || 0;
        const fB = slot.fadeBottom || 0;
        console.log(`[Composer] Slot ${slotIdx} (${slot.id}): fade R=${fR} L=${fL} T=${fT} B=${fB}, size=${safeW}x${safeH}`);
        if (fR || fL || fT || fB) {
          try {
            resized = await applyMultiDirectionalFade(resized, safeW, safeH, fR, fL, fT, fB);
            console.log(`[Composer] ✅ Fade applied to ${slot.id}`);
          } catch (fadeErr) {
            console.log(`[Composer] ❌ Fade error on ${slot.id}:`, fadeErr.message);
          }
        }

        // ★ ใช้ blend: 'over' เพื่อให้ alpha (fade) แสดงผลถูกต้อง
        composites.push({ input: resized, left: safeX, top: safeY, blend: 'over' });
      } catch (e) {
        console.log(`[Composer] Slot ${slotIdx} render error:`, e.message);
      }
    }
  }

  // ═══ Step 4: Circle (เหมือน drawCircleSlot) ═══
  async function renderCircleSlot(circleSlot, circleImgIdx) {
    if (!circleSlot || circleImgIdx === undefined || !imageBuffers[circleImgIdx]) return;

    const d = circleSlot.diameter || (circleSlot.r ? circleSlot.r * 2 : 380);
    const bw = circleSlot.borderWidth || 5;
    const borderColor = circleSlot.border || '#FFFFFF';

    // createCircleImage ต้องใช้ border สีที่ถูกต้อง
    const circleFaceData = faceDataMap?.get?.(String(circleImgIdx)) || null;
    const circleBuf = await createCircleImageColored(
      imageBuffers[circleImgIdx], d, bw, borderColor, circleFaceData
    );

    const totalSize = d + bw * 2;
    // คำนวณตำแหน่ง + clamp ให้ไม่เกินขอบ canvas
    const rawLeft = circleSlot.x !== undefined ? circleSlot.x : Math.round((circleSlot.cx || W / 2) - totalSize / 2);
    const rawTop = circleSlot.y !== undefined ? circleSlot.y : Math.round((circleSlot.cy || H / 2) - totalSize / 2);
    const left = Math.max(0, Math.min(rawLeft, W - totalSize));
    const top = Math.max(0, Math.min(rawTop, H - totalSize));

    composites.push({ input: circleBuf, left, top });
  }

  // วงกลมหลัก
  if (layoutCircle) {
    const circleImgIdx = plan.circlePhotoIndex !== undefined
      ? plan.circlePhotoIndex
      : photoOrder[layoutSlots.length]; // ภาพถัดจาก rect slots
    await renderCircleSlot(layoutCircle, circleImgIdx !== undefined ? circleImgIdx : 0);
  }

  // วงกลมเล็ก (builtin_3)
  if (layoutCircleSmall) {
    const smallCircleIdx = plan.circleSmallPhotoIndex !== undefined
      ? plan.circleSmallPhotoIndex
      : photoOrder[layoutSlots.length + 1]; // ภาพถัดจาก circle หลัก
    await renderCircleSlot(layoutCircleSmall, smallCircleIdx !== undefined ? smallCircleIdx : 1);
  }

  // ═══ Step 5: Compose final image ═══
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

/**
 * สร้าง circle image พร้อม border สีที่กำหนดได้ + shadow
 * เหมือน cover-tester drawCircleSlot()
 */
async function createCircleImageColored(imageBuffer, diameter, borderWidth = 5, borderColor = '#FFFFFF', faceData = null) {
  // Smart crop เป็นวงกลม
  let resized;
  if (faceData && faceData.hasFaces) {
    // ★ ถ้าหลายหน้า → ใช้ center-face (ครอบทุกหน้า) ไม่ใช่ face-tight (zoom หน้าเดียว)
    const strategy = (faceData.faceCount || faceData.faces?.length || 1) > 1 
      ? 'center-face'   // หลายคน → ครอบทุกหน้าให้เห็นครบ
      : 'face-tight';   // 1 คน → zoom เข้าหน้า
    console.log(`[Composer] Circle crop: ${faceData.faceCount || faceData.faces?.length || 0} faces → ${strategy}`);
    resized = await smartCropPhoto(imageBuffer, diameter, diameter, faceData, strategy);
  } else {
    // ★ fallback: ใช้ centre ไม่ใช้ top
    resized = await sharp(imageBuffer)
      .resize(diameter, diameter, {
        fit: 'cover',
        position: 'centre',
      })
      .png()
      .toBuffer();
  }

  // Circle mask
  const mask = Buffer.from(
    `<svg width="${diameter}" height="${diameter}"><circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2}" fill="white"/></svg>`
  );

  const circled = await sharp(resized)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Border ring + shadow (เหมือน cover-tester: shadow blur=16 + shadow offset Y=4)
  const totalSize = diameter + borderWidth * 2;
  const cx = totalSize / 2;
  const cy = totalSize / 2;

  const ringSvg = Buffer.from(
    `<svg width="${totalSize}" height="${totalSize}" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="cs"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.5"/></filter></defs>
      <circle cx="${cx}" cy="${cy}" r="${cx}" fill="${borderColor}" filter="url(#cs)"/>
    </svg>`
  );

  const ringBuf = await sharp(ringSvg).png().toBuffer();

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
