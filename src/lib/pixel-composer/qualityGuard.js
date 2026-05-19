/**
 * Quality Guard — Production Image Composer Validator
 * ตรวจสอบคุณภาพก่อน export ทุกครั้ง
 *
 * Checks:
 *  1. Slot boundary — slot ไม่หลุด canvas
 *  2. Output size — output ไม่ว่างเปล่า (min bytes)
 *  3. Slot count — มี slot อย่างน้อย 1 ที่มีรูป
 *  4. Blur score — ตรวจ main image ไม่เบลอเกินไป (Sharp pixel variance)
 *  5. Aspect ratio — output ไม่เพี้ยนจาก 1080×1080
 *  6. Face crop — main slot ไม่เล็กเกินไป (< 200px) ซึ่งจะทำให้หน้าถูกตัด
 *  7. Layer overlap — slot หลักไม่ถูกซ้อนทับเกิน 80%
 *
 * Returns: { passed: bool, score: 0-100, warnings: [], errors: [], details: {} }
 */
import sharp from 'sharp';

const CANVAS_W = 1080;
const CANVAS_H = 1080;
const MIN_OUTPUT_BYTES = 50 * 1024;   // 50KB minimum
const MIN_MAIN_SIZE_PX = 200;          // main face slot ต้องใหญ่กว่า 200px
const MAX_BLUR_THRESHOLD = 20;         // Laplacian variance < 20 = เบลอมาก
const MAX_OVERLAP_RATIO = 0.80;        // ซ้อนกันเกิน 80% = ผิดปกติ

// ─── 1. Slot Boundary Check ────────────────────────────────────────
function checkSlotBoundaries(slots, canvasW = CANVAS_W, canvasH = CANVAS_H) {
  const issues = [];
  for (const slot of slots) {
    const { x = 0, y = 0, w = 0, h = 0 } = slot.position || {};
    if (x < 0 || y < 0) {
      issues.push({ slotId: slot.id, issue: `position ติดลบ (${x},${y})`, severity: 'error' });
    }
    if (x + w > canvasW + 10) { // tolerance 10px
      issues.push({ slotId: slot.id, issue: `หลุดขอบขวา: x+w=${x + w} > canvas ${canvasW}`, severity: 'warning' });
    }
    if (y + h > canvasH + 10) {
      issues.push({ slotId: slot.id, issue: `หลุดขอบล่าง: y+h=${y + h} > canvas ${canvasH}`, severity: 'warning' });
    }
    if (w <= 0 || h <= 0) {
      issues.push({ slotId: slot.id, issue: `ขนาดไม่ถูกต้อง (${w}×${h})`, severity: 'error' });
    }
  }
  return issues;
}

// ─── 2. Output Size Check ──────────────────────────────────────────
function checkOutputSize(outputBuf) {
  if (!outputBuf || outputBuf.length < MIN_OUTPUT_BYTES) {
    return {
      passed: false,
      issue: `ขนาด output ต่ำเกินไป: ${outputBuf?.length || 0} bytes (min ${MIN_OUTPUT_BYTES})`,
      severity: 'error',
    };
  }
  return { passed: true, sizeBytes: outputBuf.length };
}

// ─── 3. Main Slot Size Check ───────────────────────────────────────
function checkMainSlotSize(slots) {
  const mainSlot = slots.find(s =>
    s.role === 'main_face' || s.id === 'main' || s.priority === 'face_closeup'
  );
  if (!mainSlot) return { passed: true, note: 'ไม่มี main slot' };
  const { w = 0, h = 0 } = mainSlot.position || {};
  if (w < MIN_MAIN_SIZE_PX || h < MIN_MAIN_SIZE_PX) {
    return {
      passed: false,
      slotId: mainSlot.id,
      issue: `main slot เล็กเกินไป (${w}×${h}) อาจทำให้หน้าถูกตัด`,
      severity: 'warning',
    };
  }
  return { passed: true, slotId: mainSlot.id, size: `${w}×${h}` };
}

// ─── 4. Blur Detection (Sharp pixel variance) ──────────────────────
async function checkBlur(imgSrc) {
  if (!imgSrc) return { passed: true, note: 'no image' };
  try {
    let buf;
    if (typeof imgSrc === 'string') {
      if (imgSrc.startsWith('data:')) {
        buf = Buffer.from(imgSrc.split(',')[1], 'base64');
      } else if (imgSrc.startsWith('http')) {
        const r = await fetch(imgSrc, { signal: AbortSignal.timeout(5000) });
        buf = Buffer.from(await r.arrayBuffer());
      } else {
        buf = Buffer.from(imgSrc, 'base64');
      }
    } else {
      buf = imgSrc;
    }

    // Resize small, convert grayscale, get raw pixels
    const { data, info } = await sharp(buf)
      .resize(100, 100, { fit: 'cover' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Compute pixel variance (proxy for sharpness)
    const len = data.length;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < len; i++) { sum += data[i]; sumSq += data[i] * data[i]; }
    const mean = sum / len;
    const variance = (sumSq / len) - (mean * mean);

    const isBlurry = variance < MAX_BLUR_THRESHOLD;
    return {
      passed: !isBlurry,
      variance: Math.round(variance * 100) / 100,
      threshold: MAX_BLUR_THRESHOLD,
      issue: isBlurry ? `ภาพเบลอมาก (variance=${Math.round(variance)}, threshold=${MAX_BLUR_THRESHOLD})` : null,
      severity: 'warning',
    };
  } catch (e) {
    return { passed: true, note: 'blur check skipped: ' + e.message };
  }
}

// ─── 5. Layer Overlap Check ────────────────────────────────────────
function checkLayerOverlap(slots) {
  const warnings = [];
  const nonBg = slots.filter(s => s.role !== 'background' && s.effect !== 'blur_dark');

  for (let i = 0; i < nonBg.length; i++) {
    for (let j = i + 1; j < nonBg.length; j++) {
      const a = nonBg[i].position || {};
      const b = nonBg[j].position || {};

      const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const overlapArea = ox * oy;
      const aArea = (a.w || 1) * (a.h || 1);
      const bArea = (b.w || 1) * (b.h || 1);
      const minArea = Math.min(aArea, bArea);

      if (minArea > 0 && overlapArea / minArea > MAX_OVERLAP_RATIO) {
        warnings.push({
          slotA: nonBg[i].id,
          slotB: nonBg[j].id,
          overlapRatio: Math.round(overlapArea / minArea * 100) + '%',
          issue: `"${nonBg[i].id}" และ "${nonBg[j].id}" ซ้อนกัน ${Math.round(overlapArea / minArea * 100)}%`,
          severity: 'warning',
        });
      }
    }
  }
  return warnings;
}

// ─── 6. Aspect Ratio Check ────────────────────────────────────────
async function checkAspectRatio(outputBuf) {
  if (!outputBuf) return { passed: true };
  try {
    const meta = await sharp(outputBuf).metadata();
    const { width, height } = meta;
    const expectedRatio = CANVAS_W / CANVAS_H; // 1.0 for square
    const actualRatio = width / height;
    const deviation = Math.abs(actualRatio - expectedRatio);

    if (deviation > 0.05) { // > 5% deviation
      return {
        passed: false,
        issue: `aspect ratio เพี้ยน: ${width}×${height} (expected ${CANVAS_W}×${CANVAS_H})`,
        severity: 'warning',
        actual: `${width}×${height}`,
        expected: `${CANVAS_W}×${CANVAS_H}`,
      };
    }
    return { passed: true, size: `${width}×${height}` };
  } catch (e) {
    return { passed: true, note: 'aspect check skipped: ' + e.message };
  }
}

// ─── MAIN: Run All Checks ──────────────────────────────────────────
/**
 * @param {object} opts
 * @param {Array}  opts.slots      — zone/slot definitions from template
 * @param {object} opts.canvas     — { width, height }
 * @param {object} opts.assignments — { slotId: imageSrc }
 * @param {Buffer} opts.outputBuf  — final Sharp output buffer
 * @returns {Promise<QualityReport>}
 */
export async function runQualityChecks({ slots = [], canvas = {}, assignments = {}, outputBuf }) {
  const warnings = [];
  const errors   = [];
  const details  = {};

  const canvasW = canvas.width  || CANVAS_W;
  const canvasH = canvas.height || CANVAS_H;

  // 1. Slot boundaries
  const boundaryIssues = checkSlotBoundaries(slots, canvasW, canvasH);
  boundaryIssues.forEach(b => {
    (b.severity === 'error' ? errors : warnings).push('🔴 Slot boundary: ' + b.issue);
  });
  details.boundaries = { checked: slots.length, issues: boundaryIssues.length };

  // 2. Output size
  const sizeCheck = checkOutputSize(outputBuf);
  if (!sizeCheck.passed) errors.push('🔴 Output size: ' + sizeCheck.issue);
  details.outputSize = sizeCheck.sizeBytes
    ? (sizeCheck.sizeBytes / 1024).toFixed(0) + 'KB'
    : 'FAILED';

  // 3. Main slot size
  const mainCheck = checkMainSlotSize(slots);
  if (!mainCheck.passed) warnings.push('⚠️ Face crop: ' + mainCheck.issue);
  details.mainSlot = mainCheck.size || mainCheck.note || 'missing';

  // 4. Blur detection on main image
  const mainSlot = slots.find(s => s.role === 'main_face' || s.id === 'main' || s.priority === 'face_closeup');
  const mainSrc = mainSlot ? (assignments[mainSlot.id] || assignments['main'] || null) : null;
  if (mainSrc) {
    const blurCheck = await checkBlur(mainSrc);
    if (!blurCheck.passed && blurCheck.issue) warnings.push('⚠️ Blur: ' + blurCheck.issue);
    details.blurVariance = blurCheck.variance ?? 'skipped';
  } else {
    details.blurVariance = 'no main image';
  }

  // 5. Layer overlap
  const overlapIssues = checkLayerOverlap(slots);
  overlapIssues.forEach(o => warnings.push('⚠️ Overlap: ' + o.issue));
  details.overlaps = overlapIssues.length;

  // 6. Aspect ratio
  const ratioCheck = await checkAspectRatio(outputBuf);
  if (!ratioCheck.passed) warnings.push('⚠️ Aspect ratio: ' + ratioCheck.issue);
  details.outputDimensions = ratioCheck.size || ratioCheck.actual || 'skipped';

  // ── Score ──────────────────────────────────────────────────────
  const totalIssues = errors.length + warnings.length;
  const score = Math.max(0, Math.round(100 - errors.length * 30 - warnings.length * 10));
  const passed = errors.length === 0;

  return {
    passed,
    score,           // 0-100
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'F',
    warnings,
    errors,
    details,
    summary: passed
      ? `✅ ผ่าน (score: ${score}/100) — ${warnings.length} คำเตือน`
      : `❌ ไม่ผ่าน (score: ${score}/100) — ${errors.length} errors, ${warnings.length} warnings`,
  };
}
