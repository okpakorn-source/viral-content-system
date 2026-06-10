/**
 * =====================================================
 * Cover v3 — Deterministic Pixel Executor
 * =====================================================
 * "โง่โดยตั้งใจ" — ไม่มีสูตรฉลาด ไม่มี face detection ไม่มี fade
 * รับคำสั่งจาก Director (ช่อง + กรอบครอป 0-1) → ครอป → ย่อ → วาง จบ
 * พิกเซลต้นฉบับ 100% โดยโครงสร้าง (มีแค่ extract/resize — ไม่มีการวาดใหม่)
 */

import sharp from 'sharp';

// Template ของ v3 — ตารางสะอาดไม่ทับซ้อน (สไตล์ CASE-031 ที่พิสูจน์แล้วว่าเวิร์ก)
export const V3_TEMPLATES = {
  v3_grid3: {
    id: 'v3_grid3',
    canvasW: 1200, canvasH: 1350, gap: 6,
    slots: [
      { id: 'main',   x: 0,   y: 0,   w: 720, h: 1350, note: '★ ฮีโร่ — โซนใหญ่สุด หน้าต้องเด่น' },
      { id: 'top',    x: 726, y: 0,   w: 474, h: 672,  note: 'โมเมนต์ที่สอง' },
      { id: 'bottom', x: 726, y: 678, w: 474, h: 672,  note: 'โมเมนต์ที่สาม/ฉากเหตุการณ์' },
    ],
  },
  v3_grid4: {
    id: 'v3_grid4',
    canvasW: 1200, canvasH: 1350, gap: 6,
    slots: [
      { id: 'main',   x: 0,   y: 0,   w: 660, h: 1350, note: '★ ฮีโร่ — โซนใหญ่สุด หน้าต้องเด่น' },
      { id: 'top',    x: 666, y: 0,   w: 534, h: 446,  note: 'โมเมนต์ที่สอง' },
      { id: 'mid',    x: 666, y: 452, w: 534, h: 446,  note: 'โมเมนต์ที่สาม' },
      { id: 'bottom', x: 666, y: 904, w: 534, h: 446,  note: 'โมเมนต์ที่สี่/ฉากเหตุการณ์' },
    ],
  },
};

/**
 * ขยายกรอบครอปให้สัดส่วนตรงกับช่องเป๊ะ (ขยายรอบจุดกลาง clamp ขอบภาพ)
 * → resize แบบ fill ได้โดยไม่บิดเบี้ยวและไม่ตัดเพิ่มเกินที่ Director ตั้งใจ
 */
function fitCropToSlotAspect(crop, imgW, imgH, slotAspect) {
  let px = crop.x * imgW, py = crop.y * imgH, pw = crop.w * imgW, ph = crop.h * imgH;
  const cropAspect = pw / ph;

  if (cropAspect > slotAspect) {
    // กรอบกว้างไป → เพิ่มความสูงรอบจุดกลาง
    const targetH = pw / slotAspect;
    py -= (targetH - ph) / 2;
    ph = targetH;
  } else if (cropAspect < slotAspect) {
    const targetW = ph * slotAspect;
    px -= (targetW - pw) / 2;
    pw = targetW;
  }

  // Clamp เข้าในภาพ — ถ้าเกินขอบ เลื่อนกรอบก่อน แล้วค่อยหดถ้ายังเกิน
  if (pw > imgW) { pw = imgW; ph = pw / slotAspect; }
  if (ph > imgH) { ph = imgH; pw = ph * slotAspect; }
  px = Math.min(Math.max(px, 0), imgW - pw);
  py = Math.min(Math.max(py, 0), imgH - ph);

  return {
    left: Math.round(px),
    top: Math.round(py),
    width: Math.max(8, Math.round(pw)),
    height: Math.max(8, Math.round(ph)),
  };
}

/**
 * ประกอบปกตามคำสั่ง Director
 * @returns {Promise<Buffer>} JPEG buffer
 */
export async function executeCover({ assignments, imageBuffers, templateSpec }) {
  const { canvasW, canvasH } = templateSpec;
  const composites = [];

  for (const a of assignments) {
    const slot = templateSpec.slots.find(s => s.id === a.slotId);
    const src = imageBuffers[a.imageIndex]?.buffer;
    if (!slot || !src) throw new Error(`EXECUTE_MISSING: slot=${a.slotId} image=#${a.imageIndex}`);

    const meta = await sharp(src).metadata();
    const region = fitCropToSlotAspect(a.crop, meta.width || 1, meta.height || 1, slot.w / slot.h);

    const tile = await sharp(src)
      .extract(region)
      .resize(slot.w, slot.h, { fit: 'fill' }) // สัดส่วนตรงกันแล้วจาก fitCrop — fill ไม่บิด
      .jpeg({ quality: 92 })
      .toBuffer();

    composites.push({ input: tile, left: slot.x, top: slot.y });
  }

  return sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** apply QC fixes: ทับเฉพาะ crop ของช่องที่สั่งแก้ */
export function applyFixes(assignments, fixes) {
  const map = new Map(fixes.map(f => [f.slotId, f.crop]));
  return assignments.map(a => (map.has(a.slotId) ? { ...a, crop: map.get(a.slotId) } : a));
}
