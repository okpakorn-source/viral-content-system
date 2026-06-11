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

  // ═══ 5 โครงแม่บทแกะจากปกไวรัลจริง 10 ใบ (11 มิ.ย. — วัดพิกัดจากภาพต้นแบบ) ═══

  // A. "hero_stack" — พบ 4/10: ผู้ดูแล/ผู้ช่วยเหลือ (หมอโบว์, บ้านพักคนชรา, ขอโทษที่ช่วยได้เท่านี้)
  vt_hero_stack: {
    id: 'vt_hero_stack',
    storyFit: 'เรื่องผู้ดูแล/ผู้ช่วยเหลือ/ผู้เสียสละ — มีตัวหลัก + ผู้รับ + เหตุการณ์ช่วยเหลือ',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'main',         x: 0,   y: 0,   w: 660, h: 810, zIndex: 1, note: '★ ฮีโร่ — หน้าตัวหลักใหญ่ชัด อารมณ์เด่น' },
      { id: 'top_right',    x: 660, y: 0,   w: 540, h: 470, zIndex: 0, note: 'ฉากการกระทำ/สถานที่ของเรื่อง' },
      { id: 'clip',         x: 624, y: 470, w: 576, h: 350, zIndex: 2, border: '#CCFF00', borderWidth: 6, note: '⭐ คลิปเหตุการณ์สำคัญ (กรอบเขียว) — วินาทีช่วยเหลือ/ดูแล' },
      { id: 'bottom_right', x: 624, y: 820, w: 576, h: 530, zIndex: 0, note: 'หน้าผู้รับ/คู่เรื่อง — อารมณ์ชัด' },
      { id: 'bottom_left',  x: 0,   y: 810, w: 624, h: 540, zIndex: 0, note: 'ฉากเสริม/บริบท (วงกลมจะทับบางส่วน)' },
      { id: 'circle', shape: 'circle', x: 24, y: 850, w: 470, h: 470, zIndex: 4, border: '#FFFFFF', borderWidth: 8, note: '⭕ โมเมนต์อบอุ่นสองคน/หน้าอีกบุคคล' },
    ],
  },

  // B. "quad_circle" — พบ 3/10: เรื่องสองฝ่าย ให้-รับ / then-vs-now (วงกลมกลาง = วินาทีสำคัญ)
  vt_quad_circle: {
    id: 'vt_quad_circle',
    storyFit: 'เรื่องสองฝ่าย (ผู้ให้-ผู้รับ/สองตัวละคร) หรือ then-vs-now — วงกลมกลาง = วินาทีส่งมอบ/อดีต',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'tl', x: 0,   y: 0,   w: 600, h: 672, zIndex: 0, note: 'บุคคลที่ 1 — หน้าชัด' },
      { id: 'tr', x: 606, y: 0,   w: 594, h: 672, zIndex: 0, note: 'บุคคลที่ 2 — หน้าชัด' },
      { id: 'bl', x: 0,   y: 678, w: 600, h: 672, zIndex: 0, note: 'บุคคลที่ 1 ในแอ็กชัน/อีกอารมณ์' },
      { id: 'br', x: 606, y: 678, w: 594, h: 672, zIndex: 0, note: 'บุคคลที่ 2 ในแอ็กชัน/อีกอารมณ์' },
      { id: 'circle', shape: 'circle', x: 390, y: 465, w: 420, h: 420, zIndex: 4, border: '#FFFFFF', borderWidth: 8, note: '⭕ กลางผืน — วินาทีสำคัญที่สุด (ส่งมอบ/กอด/อดีต)' },
    ],
  },

  // C. "hero_br" — ปูไปรยา: อารมณ์น้ำตาคือจุดขาย — ฮีโร่ใหญ่ขวาล่าง
  vt_hero_br: {
    id: 'vt_hero_br',
    storyFit: 'อารมณ์ (น้ำตา/ซึ้ง) ของตัวหลักคือจุดขาย — ฮีโร่อารมณ์พีคช่องใหญ่ขวาล่าง',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'tall_left',   x: 0,   y: 0,   w: 516, h: 702, zIndex: 0, note: 'โมเมนต์ความสัมพันธ์ (กอด/ช่วยเหลือ)' },
      { id: 'clip',        x: 528, y: 30,  w: 648, h: 430, zIndex: 2, border: '#FFD700', borderWidth: 6, note: '⭐ คลิปเหตุการณ์ (กรอบเหลือง)' },
      { id: 'main',        x: 516, y: 460, w: 684, h: 890, zIndex: 1, note: '★ ฮีโร่อารมณ์พีค (น้ำตา/ตื้นตัน) — หน้าใหญ่มาก' },
      { id: 'bottom_left', x: 0,   y: 702, w: 516, h: 648, zIndex: 0, note: 'อีกบุคคลในเรื่อง/ผู้รับ' },
    ],
  },

  // D. "faces_circle" — ใยบัว: ครอบครัว/เด็กเด่น
  vt_faces_circle: {
    id: 'vt_faces_circle',
    storyFit: 'เรื่องครอบครัว/เด็ก — ตัวเด่นซ้ายบน หน้าผู้ใหญ่ขวาล่าง วงกลมครอบครัว',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'main',         x: 0,   y: 0,   w: 660, h: 837, zIndex: 0, note: '★ ตัวเด่นของเรื่อง (เด็ก/ตัวหลัก) หน้าชัดใหญ่' },
      { id: 'top_right',    x: 660, y: 0,   w: 540, h: 610, zIndex: 0, note: 'โมเมนต์ความสัมพันธ์ (อุ้ม/กอด)' },
      { id: 'bottom_right', x: 630, y: 610, w: 570, h: 740, zIndex: 1, note: 'หน้าบุคคลที่สอง — อารมณ์ชัด' },
      { id: 'bottom_left',  x: 0,   y: 837, w: 630, h: 513, zIndex: 0, note: 'ฉากเสริม (วงกลมจะทับบางส่วน)' },
      { id: 'circle', shape: 'circle', x: 30, y: 860, w: 460, h: 460, zIndex: 4, border: '#FFFFFF', borderWidth: 8, note: '⭕ ครอบครัวพร้อมหน้า/โมเมนต์อบอุ่น' },
    ],
  },

  // E. "hero_wide" — แม่ค้า: คนพูด/สัมภาษณ์เด่น + คู่กรณี + คลิปกรอบขาว
  vt_hero_wide: {
    id: 'vt_hero_wide',
    storyFit: 'คนเล่า/ให้สัมภาษณ์เป็นตัวเด่น + มีคู่กรณี/บุคคลที่สอง — คลิปหลักฐานกรอบขาว',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'main',         x: 0,   y: 0,   w: 744, h: 742, zIndex: 0, note: '★ ฮีโร่กว้าง — คนเล่าเรื่อง หน้าใหญ่ชัด' },
      { id: 'top_right',    x: 744, y: 0,   w: 456, h: 608, zIndex: 0, note: 'บุคคลที่สอง/คู่เรื่อง' },
      { id: 'bottom_right', x: 696, y: 608, w: 504, h: 742, zIndex: 1, note: 'ตัวหลักอีกอารมณ์/บุคคลที่สาม' },
      { id: 'clip',         x: 12,  y: 810, w: 672, h: 420, zIndex: 2, border: '#FFFFFF', borderWidth: 6, note: '⭐ คลิปหลักฐาน/อดีต (กรอบขาว)' },
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

/** apply QC fixes: ทับ crop ของช่องที่สั่งแก้ + rev.8: สลับรูปได้ด้วย imageIndex */
export function applyFixes(assignments, fixes) {
  const map = new Map(fixes.map(f => [f.slotId, f]));
  return assignments.map(a => {
    const f = map.get(a.slotId);
    if (!f) return a;
    return {
      ...a,
      ...(Number.isInteger(f.imageIndex) ? { imageIndex: f.imageIndex } : {}),
      ...(f.crop ? { crop: f.crop } : {}),
    };
  });
}
