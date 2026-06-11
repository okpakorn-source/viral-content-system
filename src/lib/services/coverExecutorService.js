/**
 * =====================================================
 * Cover v3 — Deterministic Pixel Executor (rev.2)
 * =====================================================
 * "โง่โดยตั้งใจ" — ครอป → ย่อ → วาง ตามคำสั่ง Director เท่านั้น
 * rev.2 (feedback ผู้ใช้ 11 มิ.ย. "อันนี้เหมือนภาพเรียง"): รองรับ template ปกไวรัลจริง
 * จาก coverTemplateRegistry — โซนซ้อนเหลื่อม (zIndex), กรอบสีไฮไลต์, ช่องวงกลม
 * ยังคงพิกเซลต้นฉบับ 100% (มีแค่ extract/resize/mask — ไม่มีการวาดเนื้อภาพใหม่)
 */

import sharp from 'sharp';

// Template v3 — "viral-safe": ฐานตารางสะอาด (พิสูจน์จาก CASE-031/037) + องค์ประกอบไวรัล
// (วงกลมขอบขาว + กรอบเหลือง) แบบทับเฉพาะมุมที่ควบคุมได้ — ไม่มีช่องลอยกลางผืนแบบ template_5
// (บทเรียน CASE-038: highlight ลอยกลางผืนบังหน้าฮีโร่)
export const V3_TEMPLATES = {
  v3_grid3: {
    id: 'v3_grid3',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'main',   x: 0,   y: 0,   w: 720, h: 1350, zIndex: 0, note: '★ ฮีโร่ — โซนใหญ่สุด หน้าต้องเด่น' },
      { id: 'top',    x: 726, y: 0,   w: 474, h: 672,  zIndex: 0, note: 'โมเมนต์ที่สอง' },
      { id: 'bottom', x: 726, y: 678, w: 474, h: 672,  zIndex: 0, note: 'โมเมนต์ที่สาม/ฉากเหตุการณ์' },
    ],
  },
  v3_viral4: {
    id: 'v3_viral4',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'main',   x: 0,   y: 0,   w: 720, h: 1350, zIndex: 1, note: '★ ฮีโร่ — วางหน้าคนใน "ครึ่งบน" ของช่อง (วงกลมจะทับมุมล่างซ้าย)' },
      { id: 'top',    x: 726, y: 0,   w: 474, h: 668,  zIndex: 0, note: 'โมเมนต์ที่สอง' },
      { id: 'bottom', x: 726, y: 674, w: 474, h: 676,  zIndex: 0, border: '#FFD700', borderWidth: 6, note: '⭐ กรอบเหลือง — วินาทีสำคัญ/หลักฐานเหตุการณ์' },
      { id: 'circle', shape: 'circle', x: 40, y: 950, w: 360, h: 360, zIndex: 3, border: '#FFFFFF', borderWidth: 8, note: '⭕ หน้าคนแน่นเต็มวง 1 คน — โมเมนต์อบอุ่น/อารมณ์' },
    ],
  },
  v3_viral5: {
    id: 'v3_viral5',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'main',   x: 0,   y: 0,   w: 660, h: 1350, zIndex: 1, note: '★ ฮีโร่ — วางหน้าคนใน "ครึ่งบน" ของช่อง (วงกลมจะทับมุมล่างซ้าย)' },
      { id: 'top',    x: 666, y: 0,   w: 534, h: 444,  zIndex: 0, note: 'โมเมนต์ที่สอง' },
      { id: 'mid',    x: 666, y: 450, w: 534, h: 444,  zIndex: 0, border: '#FFD700', borderWidth: 6, note: '⭐ กรอบเหลือง — วินาทีสำคัญ/หลักฐานเหตุการณ์' },
      { id: 'bottom', x: 666, y: 900, w: 534, h: 450,  zIndex: 0, note: 'ฉากเหตุการณ์/บริบท' },
      { id: 'circle', shape: 'circle', x: 36, y: 960, w: 350, h: 350, zIndex: 3, border: '#FFFFFF', borderWidth: 8, note: '⭕ หน้าคนแน่นเต็มวง 1 คน — โมเมนต์อบอุ่น/อารมณ์' },
    ],
  },
};

const ROLE_NOTES = {
  main: '★ ฮีโร่ — โซนใหญ่สุด หน้า/ตัวบุคคลต้องกิน ≥50% ของกรอบครอป',
  bg_top: 'ฉาก/โมเมนต์ที่สอง — ขวาบน',
  bg_bottom: 'ฉาก/โมเมนต์ที่สาม — ขวาล่าง',
  highlight: '⭐ ไฮไลต์ (มีกรอบสีลอยทับ) — โมเมนต์เด็ด/หลักฐาน/วินาทีสำคัญ',
  sub_left: 'ภาพรอง (กรอบขาว) — บริบทเสริม',
  emotion: 'อารมณ์ — หน้าคนอารมณ์ชัด',
  circle: '⭕ วงกลม — ครอปหน้าแน่น 1 คน หรือโมเมนต์อบอุ่น (เห็นหน้าชัดเต็มวง)',
};

/** แปลง template จาก coverTemplateRegistry → spec ของ v3 (รวม circle เป็น slot ชนิดวงกลม) */
export function adaptRegistryTemplate(reg) {
  const slots = (reg.slots || []).map(s => ({
    id: s.id,
    x: s.x, y: s.y, w: s.w, h: s.h,
    zIndex: s.zIndex ?? 0,
    border: s.border || null,
    borderWidth: s.borderWidth || 0,
    note: ROLE_NOTES[s.id] || ROLE_NOTES[s.role] || s.role || '',
  }));
  if (reg.circle) {
    slots.push({
      id: 'circle', shape: 'circle',
      x: reg.circle.x, y: reg.circle.y,
      w: reg.circle.diameter, h: reg.circle.diameter,
      zIndex: reg.circle.zIndex ?? 5,
      border: reg.circle.border || '#FFFFFF',
      borderWidth: reg.circle.borderWidth || 6,
      note: ROLE_NOTES.circle,
    });
  }
  return { id: reg.id, canvasW: reg.canvasW, canvasH: reg.canvasH, slots };
}

/** ขยายกรอบครอปให้สัดส่วนตรงกับช่อง (รอบจุดกลาง, clamp ขอบภาพ) */
function fitCropToSlotAspect(crop, imgW, imgH, slotAspect) {
  let px = crop.x * imgW, py = crop.y * imgH, pw = crop.w * imgW, ph = crop.h * imgH;
  const cropAspect = pw / ph;

  if (cropAspect > slotAspect) {
    const targetH = pw / slotAspect;
    py -= (targetH - ph) / 2;
    ph = targetH;
  } else if (cropAspect < slotAspect) {
    const targetW = ph * slotAspect;
    px -= (targetW - pw) / 2;
    pw = targetW;
  }

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

/** ครอป+ย่อภาพลงช่องสี่เหลี่ยม (+กรอบสีถ้ามี) */
async function renderRectTile(src, crop, slot) {
  const meta = await sharp(src).metadata();
  const region = fitCropToSlotAspect(crop, meta.width || 1, meta.height || 1, slot.w / slot.h);
  let tile = await sharp(src).extract(region).resize(slot.w, slot.h, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();

  if (slot.border && slot.borderWidth > 0) {
    const bw = slot.borderWidth;
    tile = await sharp({
      create: { width: slot.w + bw * 2, height: slot.h + bw * 2, channels: 3, background: slot.border },
    })
      .composite([{ input: tile, left: bw, top: bw }])
      .jpeg({ quality: 92 })
      .toBuffer();
    return { input: tile, left: slot.x - bw, top: slot.y - bw };
  }
  return { input: tile, left: slot.x, top: slot.y };
}

/** ครอป+ย่อ+มาส์กวงกลม+วงแหวนขอบ */
async function renderCircleTile(src, crop, slot) {
  const d = slot.w;
  const bw = slot.borderWidth || 6;
  const meta = await sharp(src).metadata();
  const region = fitCropToSlotAspect(crop, meta.width || 1, meta.height || 1, 1);

  const squared = await sharp(src).extract(region).resize(d, d, { fit: 'fill' }).png().toBuffer();
  const mask = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`);
  const circled = await sharp(squared).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();

  const total = d + bw * 2;
  const ring = Buffer.from(
    `<svg width="${total}" height="${total}"><circle cx="${total / 2}" cy="${total / 2}" r="${(d + bw) / 2}" fill="none" stroke="${slot.border || '#FFFFFF'}" stroke-width="${bw}"/></svg>`
  );
  const withRing = await sharp({ create: { width: total, height: total, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: circled, left: bw, top: bw }, { input: ring, left: 0, top: 0 }])
    .png()
    .toBuffer();

  return { input: withRing, left: slot.x - bw, top: slot.y - bw };
}

/**
 * ประกอบปกตามคำสั่ง Director — เรียงตาม zIndex (ต่ำ→สูง) ให้โซนซ้อนเหลื่อมแบบปกไวรัลจริง
 * @returns {Promise<Buffer>} JPEG buffer
 */
export async function executeCover({ assignments, imageBuffers, templateSpec }) {
  const { canvasW, canvasH } = templateSpec;

  const ordered = [...assignments].sort((a, b) => {
    const za = templateSpec.slots.find(s => s.id === a.slotId)?.zIndex ?? 0;
    const zb = templateSpec.slots.find(s => s.id === b.slotId)?.zIndex ?? 0;
    return za - zb;
  });

  const composites = [];
  for (const a of ordered) {
    const slot = templateSpec.slots.find(s => s.id === a.slotId);
    const src = imageBuffers[a.imageIndex]?.buffer;
    if (!slot || !src) throw new Error(`EXECUTE_MISSING: slot=${a.slotId} image=#${a.imageIndex}`);
    composites.push(slot.shape === 'circle'
      ? await renderCircleTile(src, a.crop, slot)
      : await renderRectTile(src, a.crop, slot));
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
