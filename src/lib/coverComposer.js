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
  safeFacePadding: 60,  // FIX: เพิ่มจาก 24 → 60px เพื่อให้ fade ห่างจากหน้าคนมากขึ้น
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
async function smartCropPhoto(imageBuffer, w, h, faceData = null, cropStrategy = null, opts = {}) {
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
        // Multi-face: crop ต้องใหญ่พอครอบทุกหน้า + padding
        // ★ ใช้ bounding box + 40% padding (ไม่ใช่ *2 ที่ทำให้สูงเกิน)
        const padX = 1.4;
        const padY = 1.6; // แนวตั้งต้อง padding มากกว่า (หัว-คาง)
        const neededW = focusW * padX;
        const neededH = focusH * padY;
        if (neededW / neededH > targetRatio) {
          cropW = Math.round(Math.min(neededW, srcW));
          cropH = Math.round(cropW / targetRatio);
        } else {
          cropH = Math.round(Math.min(neededH, srcH));
          cropW = Math.round(cropH * targetRatio);
        }
        cropW = Math.min(Math.max(cropW, Math.round(srcW * 0.4)), srcW);
        cropH = Math.min(Math.max(cropH, Math.round(srcH * 0.4)), srcH);
      } else if (srcW / srcH > targetRatio) {
        cropH = srcH;
        cropW = Math.round(cropH * targetRatio);
        // ★ portrait-upper: ป้องกันภาพหลุดเฟรม — ใช้อย่างน้อย 80% ของ srcW
        if (cropStrategy === 'portrait-upper' && faces.length === 1) {
          const minCropW = Math.round(srcW * 0.80);
          if (cropW < minCropW) {
            cropW = Math.min(minCropW, srcW);
            cropH = Math.round(cropW / targetRatio);
            cropH = Math.min(cropH, srcH);
          }
        }
      } else {
        cropW = srcW;
        cropH = Math.round(cropW / targetRatio);
      }

      // ★ ตำแหน่ง crop — ทุก strategy ต้องให้ใบหน้าอยู่ใน crop region เสมอ
      let cropX, cropY;
      
      if (cropStrategy === 'portrait-upper') {
        cropX = Math.round(focusCX - cropW / 2);
        cropY = Math.round(focusCY - cropH * 0.30);
        
        if (cropY < 0) cropY = 0;
        if (cropY + cropH > srcH) cropY = Math.max(0, srcH - cropH);
        
        const faceTop = focusCY - focusH / 2;
        const faceBottom = focusCY + focusH / 2;
        if (faceTop < cropY) {
          cropY = Math.max(0, Math.round(faceTop - focusH * 0.3));
        }
        if (faceBottom > cropY + cropH) {
          cropY = Math.max(0, Math.round(faceBottom - cropH + focusH * 0.3));
        }
      } else {
        // center-face / face-tight / scene-with-face: center ที่จุดกลางหน้า
        cropX = Math.round(focusCX - cropW / 2);
        cropY = Math.round(focusCY - cropH / 2);
        
        // FIX: ถ้า slot มี fadeLeft → push cropX ออกจาก fade zone ให้ subject อยู่ในพื้นที่ใช้ได้จริง
        if (opts.fadeLeftPx > 0) {
          // usable area เริ่มจาก fadeLeft px จาก slot left edge
          // target: face center อยู่ใน usable area (right of fadeLeft)
          // ถ้า face จะโดน fade → เลื่อน crop ไปทางซ้าย เพื่อ face อยู่ right-of-fade
          const fadePx = Math.round(opts.fadeLeftPx);
          // face ใน source image: focusCX, ใน slot coords หลัง crop: face อยู่ที่ focusCX - cropX
          // ต้องการให้ focusCX - cropX >= fadePx + 60 (พื้นที่ปลอดภัย 60px จาก fade edge)
          const minFaceInSlot = fadePx + 60;
          const currentFaceInSlot = focusCX - cropX;
          if (currentFaceInSlot < minFaceInSlot) {
            const delta = minFaceInSlot - currentFaceInSlot;
            cropX = Math.max(0, cropX - delta); // เลื่อน crop ไปซ้าย → face ชิดขวามากขึ้น
            console.log(`[SmartCrop] FadeLeft(${fadePx}px) push: cropX ${Math.round(cropX + delta)} → ${Math.round(cropX)}`);
          }
        }
        
        // ★ Safety: ตรวจสอบทุกใบหน้าอยู่ใน crop (padding 30% รอบหน้า)
        for (const face of faces) {
          const fx = face.x;
          const fy = face.y;
          const fw = face.width;
          const fh = face.height;
          const facePad = 0.3; // ★ 30% padding รอบใบหน้า
          // ถ้าหน้าตกขอบซ้าย → เลื่อน crop ไปซ้าย
          if (fx - fw * facePad < cropX) cropX = Math.max(0, Math.round(fx - fw * facePad));
          // ถ้าหน้าตกขอบขวา → เลื่อน crop ไปขวา
          if (fx + fw + fw * facePad > cropX + cropW) cropX = Math.min(srcW - cropW, Math.round(fx + fw + fw * facePad - cropW));
          // ถ้าหน้าตกขอบบน → เลื่อน crop ขึ้น
          if (fy - fh * facePad < cropY) cropY = Math.max(0, Math.round(fy - fh * facePad));
          // ถ้าหน้าตกขอบล่าง → เลื่อน crop ลง
          if (fy + fh + fh * facePad > cropY + cropH) cropY = Math.min(srcH - cropH, Math.round(fy + fh + fh * facePad - cropH));
        }
        
        // ★ Final safety: ถ้ายังมีหน้าหลุดอยู่ → ขยาย crop ให้ครอบ
        for (const face of faces) {
          if (face.x < cropX || face.x + face.width > cropX + cropW ||
              face.y < cropY || face.y + face.height > cropY + cropH) {
            // ขยาย crop ให้ครอบทุกหน้า
            const allMinX = Math.min(cropX, ...faces.map(f => f.x));
            const allMinY = Math.min(cropY, ...faces.map(f => f.y));
            const allMaxX = Math.max(cropX + cropW, ...faces.map(f => f.x + f.width));
            const allMaxY = Math.max(cropY + cropH, ...faces.map(f => f.y + f.height));
            cropX = Math.max(0, allMinX - 20);
            cropY = Math.max(0, allMinY - 20);
            cropW = Math.min(allMaxX - allMinX + 40, srcW - cropX);
            cropH = Math.min(allMaxY - allMinY + 40, srcH - cropY);
            // รักษา aspect ratio
            if (cropW / cropH > targetRatio) {
              cropH = Math.round(cropW / targetRatio);
            } else {
              cropW = Math.round(cropH * targetRatio);
            }
            cropW = Math.min(cropW, srcW - cropX);
            cropH = Math.min(cropH, srcH - cropY);
            console.log(`[Composer] ⚠️ Face overflow → expanded crop to (${cropX},${cropY},${cropW}x${cropH})`);
            break;
          }
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

  // ═══ Step 2: Sort slots by zIndex (low → high) ═══
  const sortedSlots = [...layoutSlots].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  // ═══ Step 2.5: ★★★ Smart Placement Engine — หาตำแหน่งวาง highlight/circle ที่ไม่ทับหน้าคน ═══
  // รวบรวมหน้าจากทุก slot → ค้นหาตำแหน่งที่ดีที่สุด

  // 1. รวบรวม face bounding boxes จากทุก slot → canvas coordinates
  const allCanvasFaces = [];
  for (let si = 0; si < layoutSlots.length; si++) {
    const imgIdx = photoOrder[si];
    if (imgIdx === undefined || imgIdx >= imageBuffers.length) continue;
    const fd = faceDataMap?.get?.(String(imgIdx));
    if (!fd?.hasFaces || !fd.faces?.length) continue;
    
    const slot = layoutSlots[si];
    const srcW = fd.imageWidth || slot.w || W;
    const srcH = fd.imageHeight || slot.h || H;
    
    for (const face of fd.faces) {
      allCanvasFaces.push({
        x: (slot.x || 0) + (face.x / srcW) * (slot.w || W),
        y: (slot.y || 0) + (face.y / srcH) * (slot.h || H),
        w: (face.width / srcW) * (slot.w || W),
        h: (face.height / srcH) * (slot.h || H),
        slot: slot.id,
      });
    }
  }

  // ★★★ Hero Zone Protection — แม้ face detection ล้มเหลว ก็ต้องปกป้อง hero!
  // ถ้า face detection ล้มเหลว → ประมาณ "virtual face" จากตำแหน่ง hero slot
  const heroSlot = layoutSlots.find(s => s.id === 'main' || s.role === 'hero');
  if (heroSlot) {
    const heroImgIdx = photoOrder[layoutSlots.indexOf(heroSlot)];
    const heroFD = faceDataMap?.get?.(String(heroImgIdx));
    const heroHasFace = heroFD?.hasFaces && heroFD.faces?.length > 0;
    
    if (!heroHasFace) {
      // ★ Face detection ล้มเหลวสำหรับ hero → สร้าง virtual face zone
      // ภาพ hero มักมีหน้าคนอยู่ center-top ของ slot (portrait-upper crop)
      const vfX = (heroSlot.x || 0) + (heroSlot.w || 700) * 0.15;
      const vfY = (heroSlot.y || 0) + (heroSlot.h || 1350) * 0.05;
      const vfW = (heroSlot.w || 700) * 0.55;
      const vfH = (heroSlot.h || 1350) * 0.45;
      allCanvasFaces.push({ x: vfX, y: vfY, w: vfW, h: vfH, slot: 'hero_virtual' });
      console.log(`[SmartPlace] ★ Added virtual hero face zone: (${Math.round(vfX)},${Math.round(vfY)}) ${Math.round(vfW)}x${Math.round(vfH)}`);
    }
    
    // ★ ตรวจ bg_top/bg_bottom ด้วย — ถ้า face detection ล้มเหลว → ประมาณ face zone
    for (const bgSlot of layoutSlots.filter(s => s.id === 'bg_top' || s.id === 'bg_bottom')) {
      const bgImgIdx = photoOrder[layoutSlots.indexOf(bgSlot)];
      const bgFD = faceDataMap?.get?.(String(bgImgIdx));
      if (bgFD?.hasFaces || !bgImgIdx) continue;
      
      // ภาพ bg มักมีหน้าคนอยู่ตรงกลาง
      const vfX = (bgSlot.x || 0) + (bgSlot.w || 800) * 0.25;
      const vfY = (bgSlot.y || 0) + (bgSlot.h || 700) * 0.1;
      const vfW = (bgSlot.w || 800) * 0.5;
      const vfH = (bgSlot.h || 700) * 0.6;
      allCanvasFaces.push({ x: vfX, y: vfY, w: vfW, h: vfH, slot: bgSlot.id + '_virtual' });
      console.log(`[SmartPlace] ★ Added virtual ${bgSlot.id} face zone: (${Math.round(vfX)},${Math.round(vfY)}) ${Math.round(vfW)}x${Math.round(vfH)}`);
    }
  }
  
  console.log(`[SmartPlace] Found ${allCanvasFaces.length} face zones (real + virtual) from ${layoutSlots.length} slots`);

  // 2. ฟังก์ชันตรวจ overlap
  const PAD = EDITORIAL_GEOMETRY.safeFacePadding;
  const rectsOverlap = (ax, ay, aw, ah, bx, by, bw, bh) => {
    return ax < bx + bw + PAD && ax + aw + PAD > bx &&
           ay < by + bh + PAD && ay + ah + PAD > by;
  };

  // 3. ★★★ ฟังก์ชันหาตำแหน่งที่ "ปลอดภัย" — ไม่ทับหน้าคน, ไม่ทับ hero zone
  // แนวคิดใหม่: แทนที่จะ "ลองเลื่อน" → สแกนหาจุดที่ปลอดภัยจริงๆ
  
  // ★ เพิ่ม hero slot เป็น obstacle zone — highlight ห้ามทับ hero!
  const heroSlotForPlacement = layoutSlots.find(s => s.id === 'main' || s.role === 'hero' || s.role === 'hero1');
  const heroProtectionZone = heroSlotForPlacement ? {
    // ปกป้องเฉพาะส่วนบน 55% ของ hero (ที่มีหน้าคน) — ส่วนล่างไม่เป็นไร
    x: heroSlotForPlacement.x || 0,
    y: heroSlotForPlacement.y || 0,
    w: (heroSlotForPlacement.w || 700) * 0.85, // ปกป้อง 85% กว้าง
    h: (heroSlotForPlacement.h || 1350) * 0.55, // ปกป้อง 55% สูง (ส่วนบนที่มีหน้า)
  } : null;

  const findBestPosition = (defaultX, defaultY, elW, elH, avoid = []) => {
    const obstacles = [...allCanvasFaces, ...avoid];
    if (heroProtectionZone) obstacles.push(heroProtectionZone);

    const hasOverlapAt = (testX, testY, testW, testH) => {
      for (const ob of obstacles) {
        if (rectsOverlap(testX, testY, testW, testH, ob.x, ob.y, ob.w, ob.h)) {
          return true;
        }
      }
      return false;
    };

    // ★ ถ้า default ไม่ทับ → ใช้เลย!
    if (!hasOverlapAt(defaultX, defaultY, elW, elH)) {
      return { x: defaultX, y: defaultY, w: elW, h: elH, moved: false };
    }

    console.log(`[SmartPlace] Default (${defaultX},${defaultY}) ${elW}x${elH} ทับ obstacle → scanning...`);

    // ★ Strategy: สร้าง candidates จากจุดที่มักปลอดภัย (เรียงตาม priority)
    const candidates = [];
    
    // Priority 1: ขอบขวาของ canvas (ห่างจาก hero)
    const rightZone = Math.max(W * 0.5, W - elW - 30);
    for (let y = 50; y + elH <= H - 50; y += 50) {
      for (let x = Math.round(rightZone); x + elW <= W - 10; x += 50) {
        candidates.push({ x, y, priority: 1 });
      }
    }
    
    // Priority 2: กลางล่างของ canvas
    for (let y = Math.round(H * 0.55); y + elH <= H - 30; y += 50) {
      for (let x = 30; x + elW <= W - 30; x += 50) {
        candidates.push({ x, y, priority: 2 });
      }
    }
    
    // Priority 3: สแกนทั้ง canvas (ทุก 60px)
    for (let y = 20; y + elH <= H - 20; y += 60) {
      for (let x = 20; x + elW <= W - 20; x += 60) {
        candidates.push({ x, y, priority: 3 });
      }
    }

    // Priority 4: ขนาดเล็กลง (75%)
    const smallW = Math.round(elW * 0.75);
    const smallH = Math.round(elH * 0.75);
    for (let y = 50; y + smallH <= H - 50; y += 80) {
      for (let x = 20; x + smallW <= W - 20; x += 80) {
        candidates.push({ x, y, w: smallW, h: smallH, priority: 4 });
      }
    }

    // Priority 5: ขนาดเล็กลงอีก (60%)
    const tinyW = Math.round(elW * 0.60);
    const tinyH = Math.round(elH * 0.60);
    for (let y = 30; y + tinyH <= H - 30; y += 60) {
      for (let x = 20; x + tinyW <= W - 20; x += 60) {
        candidates.push({ x, y, w: tinyW, h: tinyH, priority: 5 });
      }
    }

    // Priority 6: ขนาดเล็กสุด (50%) — ยังดีกว่าไม่มี
    const miniW = Math.round(elW * 0.50);
    const miniH = Math.round(elH * 0.50);
    for (let y = 30; y + miniH <= H - 30; y += 60) {
      for (let x = 20; x + miniW <= W - 20; x += 60) {
        candidates.push({ x, y, w: miniW, h: miniH, priority: 6 });
      }
    }

    // ★ หา candidate แรกที่ไม่ทับ (priority ต่ำ = ดีกว่า)
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const distA = Math.sqrt((a.x - defaultX) ** 2 + (a.y - defaultY) ** 2);
      const distB = Math.sqrt((b.x - defaultX) ** 2 + (b.y - defaultY) ** 2);
      return distA - distB;
    });

    for (const c of candidates) {
      const cw = c.w || elW;
      const ch = c.h || elH;
      if (!hasOverlapAt(c.x, c.y, cw, ch)) {
        console.log(`[SmartPlace] ✅ Safe position: (${c.x},${c.y}) ${cw}x${ch} (priority ${c.priority})`);
        return { x: c.x, y: c.y, w: cw, h: ch, moved: true };
      }
    }

    // ★ Fallback: มุมซ้ายล่าง (ห่างจาก circle ที่มักอยู่ขวาล่าง)
    const fallbackX = 20;
    const fallbackY = H - elH - 20;
    console.log(`[SmartPlace] ⚠️ All positions blocked — fallback to (${fallbackX},${fallbackY})`);
    return { x: fallbackX, y: fallbackY, w: Math.min(elW, W * 0.4), h: Math.min(elH, H * 0.3), moved: true };
  };

  // 4. ★ จัดตำแหน่ง circle ก่อน (อยู่ล่าง, ทับ hero น้อยกว่า)
  let circleCanvasRect = null;
  if (layoutCircle) {
    const cd = layoutCircle.diameter || 380;
    const cbw = (layoutCircle.borderWidth || 5) * 2;
    const fullD = cd + cbw;
    const defCX = layoutCircle.x ?? 25;
    const defCY = layoutCircle.y ?? 680;
    
    const circlePlacement = findBestPosition(defCX, defCY, fullD, fullD);
    layoutCircle.x = circlePlacement.x;
    layoutCircle.y = circlePlacement.y;
    if (circlePlacement.w < fullD) {
      layoutCircle.diameter = circlePlacement.w - cbw;
    }
    circleCanvasRect = { x: circlePlacement.x, y: circlePlacement.y, w: circlePlacement.w, h: circlePlacement.w };
    if (circlePlacement.moved) {
      console.log(`[SmartPlace] 🔵 Circle moved: (${defCX},${defCY}) → (${circlePlacement.x},${circlePlacement.y})`);
    }
  }

  // 5. ★ จัดตำแหน่ง highlight/bordered slots (หลบ faces + circle)
  // ★ circle avoid rect ต้อง inflate ขึ้นเพื่อให้ highlight ห่างจาก circle มากพอ!
  const OVERLAY_SPACING = 40; // ระยะห่างขั้นต่ำระหว่าง overlay elements
  for (const slot of sortedSlots) {
    if (!slot.border || !slot.borderWidth) continue;
    if (slot.shape === 'circle') continue;
    
    const avoid = [];
    if (circleCanvasRect) {
      // ★ Inflate circle rect ให้ใหญ่ขึ้น เพื่อห้ามวาง highlight ใกล้เกินไป
      avoid.push({
        x: circleCanvasRect.x - OVERLAY_SPACING,
        y: circleCanvasRect.y - OVERLAY_SPACING,
        w: circleCanvasRect.w + OVERLAY_SPACING * 2,
        h: circleCanvasRect.h + OVERLAY_SPACING * 2,
      });
    }
    const placement = findBestPosition(slot.x, slot.y, slot.w, slot.h, avoid);
    
    if (placement.moved) {
      console.log(`[SmartPlace] 🟨 Highlight "${slot.id}" moved: (${slot.x},${slot.y}) ${slot.w}x${slot.h} → (${placement.x},${placement.y}) ${placement.w}x${placement.h}`);
      slot.x = placement.x;
      slot.y = placement.y;
      slot.w = placement.w;
      slot.h = placement.h;
    }
  }

  // 6. ★ จัดตำแหน่ง circle_small (ถ้ามี)
  for (const slot of sortedSlots) {
    if (slot.shape !== 'circle') continue;
    const avoid = circleCanvasRect ? [circleCanvasRect] : [];
    // เพิ่ม highlight ที่จัดแล้วเข้า avoid
    for (const s2 of sortedSlots) {
      if (s2.border && s2.borderWidth && s2.shape !== 'circle') {
        avoid.push({ x: s2.x, y: s2.y, w: s2.w, h: s2.h });
      }
    }
    const placement = findBestPosition(slot.x, slot.y, slot.w || slot.diameter || 200, slot.h || slot.diameter || 200, avoid);
    if (placement.moved) {
      console.log(`[SmartPlace] 🔴 CircleSmall "${slot.id}" moved: (${slot.x},${slot.y}) → (${placement.x},${placement.y})`);
      slot.x = placement.x;
      slot.y = placement.y;
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
        if (slotRole === 'hero' || slotRole === 'hero2' || slotRole === 'main' || slot.id === 'main') {
          cropStrat = 'portrait-upper'; // Hero/Hero2: ครึ่งตัวบน หน้าชัด
        } else if (slotRole === 'emotion') {
          cropStrat = 'portrait-upper'; // Emotion: ครึ่งตัวบน
        } else if (slotRole === 'highlight') {
          cropStrat = 'center-face';    // Highlight: center ที่หน้า
        } else if (slotFaceData?.hasFaces) {
          cropStrat = 'center-face';    // Scene/Context ที่มีคน: center ที่คน ไม่ตัดหน้า
        } else {
          cropStrat = 'attention';      // Scene ไม่มีคน: ใช้ saliency
        }
        let resized = await smartCropPhoto(imageBuffers[imgIdx], safeW, safeH, slotFaceData, cropStrat, { fadeLeftPx: slot.fadeLeft || 0 });

        // ★ Sharpen ทุกภาพ — เพิ่มความคมชัด!
        try {
          resized = await sharp(resized)
            .sharpen({ sigma: 0.8, m1: 1.0, m2: 0.5 })
            .png()
            .toBuffer();
        } catch (e) { /* sharpen fail → ใช้ภาพเดิม */ }

        // Apply fade ทั้ง 4 ทิศพร้อมกัน (เหมือน cover-tester createFadeMask)
        let fR = slot.fadeRight || 0;
        let fL = slot.fadeLeft || 0;
        let fT = slot.fadeTop || 0;
        let fB = slot.fadeBottom || 0;
        
        // ★★★ Face-aware fade: ถ้าเป็น hero/hero2 slot → ห้าม fade กินหน้าคน!
        if ((slotRole === 'hero' || slotRole === 'hero2' || slot.id === 'main') && slotFaceData?.hasFaces && fR > 0) {
          const face = slotFaceData.faces[0];
          // คำนวณ face right edge ใน slot coordinates (หลัง crop)
          const faceRightRatio = (face.x + face.width) / (slotFaceData.imageWidth || safeW);
          const faceRightPx = faceRightRatio * safeW;
          const safeFadeStart = faceRightPx + EDITORIAL_GEOMETRY.safeFacePadding;
          const maxSafeFade = safeW - safeFadeStart;
          
          if (fR > maxSafeFade && maxSafeFade > 50) {
            console.log(`[Composer] ★ Hero fade adjusted: ${fR}px → ${Math.round(maxSafeFade)}px (face at ${Math.round(faceRightPx)}px)`);
            fR = Math.round(maxSafeFade);
          }
        }
        
        // ★ BG slots: ถ้ามีหน้าคนใน BG → ลด fadeLeft/fadeTop ไม่ให้กินหน้า
        // FIX: ใช้ safeFacePadding=60px (เพิ่มจาก 24px) + ลด threshold จาก 50 → 30px
        if ((slot.id === 'bg_top' || slot.id === 'bg_bottom') && slotFaceData?.hasFaces) {
          const face = slotFaceData.faces[0];
          if (fL > 0) {
            const faceLeftRatio = face.x / (slotFaceData.imageWidth || safeW);
            const faceLeftPx = faceLeftRatio * safeW;
            if (fL > faceLeftPx - EDITORIAL_GEOMETRY.safeFacePadding && faceLeftPx > 30) {
              const newFadeL = Math.max(40, Math.round(faceLeftPx - EDITORIAL_GEOMETRY.safeFacePadding));
              console.log(`[Composer] ★ BG ${slot.id} fadeLeft adjusted: ${fL}px → ${newFadeL}px (face at ${Math.round(faceLeftPx)}px, safePad=${EDITORIAL_GEOMETRY.safeFacePadding}px)`);
              fL = newFadeL;
            }
          }
        }
        
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
    .sharpen({ sigma: 0.5, m1: 0.8, m2: 0.3 }) // ★ Final sharpen — ภาพรวมคมขึ้น
    .jpeg({ quality: 95 }) // ★ คุณภาพสูงขึ้น
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
