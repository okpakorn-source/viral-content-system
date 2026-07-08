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
// ★ 27 มิ.ย. (ผู้ใช้สั่ง): ลบโครง 3 ภาพ "v3_grid3" ออกถาวร — ปกต้อง 4 ช่องขึ้นไปเท่านั้น (ทั้งเทส/ทำจริง)
export const V3_TEMPLATES = {
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
  // ★ rev.14i: hero เต็มความสูงซ้าย + ขวา 3 ช่อง + วงกลมทับ "ตัว" hero (เลิก bottom_left ที่คนโดนวงทับ)
  vt_hero_stack: {
    id: 'vt_hero_stack',
    storyFit: 'ตัวหลักเด่น + บุคคลที่สอง + โมเมนต์ — hero เต็มซ้าย ขวาเรียง 3 ช่อง',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'main',         x: 0,   y: 0,   w: 648, h: 1350, zIndex: 0, note: '★ ฮีโร่เต็มความสูง — หน้าใหญ่เด่นบน ตัวยาวลงล่าง (วงกลมทับช่วงตัวล่าง)' },
      { id: 'top_right',    x: 648, y: 0,   w: 552, h: 445, zIndex: 0, note: 'คู่/บุคคลที่สอง — หน้าชัด' },
      { id: 'clip',         x: 648, y: 450, w: 552, h: 440, zIndex: 2, border: '#CCFF00', borderWidth: 6, note: '⭐ โมเมนต์เด่น (กรอบเขียว) — หน้าชัด' },
      { id: 'bottom_right', x: 648, y: 895, w: 552, h: 455, zIndex: 0, note: 'บุคคลที่สอง/โมเมนต์ — หน้าชัด' },
      { id: 'circle', shape: 'circle', x: 40, y: 876, w: 446, h: 446, zIndex: 4, border: '#FFFFFF', borderWidth: 8, note: '⭕ ทับช่วง "ตัว" ฮีโร่ (ไม่ทับหน้าใคร) — หน้าอีกบุคคล/โมเมนต์อบอุ่น' },
    ],
  },

  // ★ "ref_tri" (20 มิ.ย. — ผู้ใช้ยืนยันจากปกตัวอย่าง): ฮีโร่เต็มซ้าย + ขวา 3 ภาพสะอาด + วงกลมกรอบทองทับตัวฮีโร่
  //   ผู้ใช้สั่ง: "ทางขวาต้องมี 3 ภาพ (ไม่ใช่ 2) — คมชัด หน้าอยู่กลางกรอบ สะอาด" + ฮีโร่เด่นเหมือนเดิม
  vt_ref_tri: {
    id: 'vt_ref_tri',
    storyFit: '★ โครงตัวอย่างทอง — ตัวหลักเด่นมาก + เล่าหลายโมเมนต์: ฮีโร่เต็มซ้าย + ขวา 3 ภาพหน้าชัด + วงกลมโมเมนต์อบอุ่น',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'main',         x: 0,   y: 0,   w: 660, h: 1350, zIndex: 0, note: '★ ฮีโร่เต็มความสูง — หน้าใหญ่เด่นบน รู้ทันทีว่าใคร (วงกลมทับช่วงตัวล่าง ไม่ทับหน้า)' },
      { id: 'right_top',    x: 666, y: 0,   w: 534, h: 448, zIndex: 0, note: 'โมเมนต์ที่ 2 — ★ ครอปแน่นที่ใบหน้า หน้าอยู่กลางกรอบ คมชัด สะอาด (ตัดไมค์/ป้าย/ฉากกว้างทิ้ง)' },
      { id: 'right_mid',    x: 666, y: 452, w: 534, h: 448, zIndex: 0, note: 'โมเมนต์ที่ 3 — ★ ครอปแน่นที่ใบหน้า หน้าอยู่กลางกรอบ คมชัด สะอาด (ตัดไมค์/ป้าย/ฉากกว้างทิ้ง)' },
      { id: 'right_bottom', x: 666, y: 904, w: 534, h: 446, zIndex: 0, note: 'โมเมนต์ที่ 4 — ★ ครอปแน่นที่ใบหน้า หน้าอยู่กลางกรอบ คมชัด สะอาด (ตัดไมค์/ป้าย/ฉากกว้างทิ้ง)' },
      { id: 'circle', shape: 'circle', x: 285, y: 890, w: 420, h: 420, zIndex: 4, border: '#FFFFFF', borderWidth: 8, note: '⭕ วงกลมกรอบขาว ล่างค่อนกลาง คร่อมขอบฮีโร่ (= ภาพตัวอย่างผู้ใช้ 27 มิ.ย.) — ขอบขวา 705 ห่างหน้าช่องขวา(~933) ไม่ทับหน้าใคร · ใส่หลักฐาน/เอกสาร/หน้าคน 1 คนแน่นเต็มวง' },
    ],
  },

  // ★ vt_ref_5x4 (7 ก.ค. — ยึดภาพแสนไลค์ reference "cover fable" เป็นกฎ): 4:5 · ฮีโร่ซ้ายเต็มสูง + ขวา 2 ช่อง + วงกลมล่างซ้าย
  //   ต่างจาก vt_ref_tri: (1) canvas 4:5 (1080×1350) ไม่ใช่ 8:9 (2) ขวา 2 ช่องใหญ่ ไม่ใช่ 3 ช่องเล็ก
  //   (3) ชนขอบไม่มีเส้นขาว/ช่องว่าง (4) ไม่มีขอบสีสี่เหลี่ยม — มีแค่วงกลมขอบขาวหนา (สไตล์ collage ไวรัลจริง)
  vt_ref_5x4: {
    id: 'vt_ref_5x4',
    storyFit: '★★ โครงแสนไลค์ 4:5 (reference lock): ฮีโร่ close-up ซ้ายเต็มสูง + ขวาบนคู่/ปฏิกิริยา + ขวาล่าง close-up คนที่สอง + วงกลมโมเมนต์ล่างซ้าย',
    canvasW: 1080, canvasH: 1350,
    feather: 26, // ★ B: เบลอรอยต่อระหว่างช่อง (ลบเส้นกริดคม) — สไตล์ collage ไวรัลตาม reference (เฉพาะเทมเพลตนี้)
    slots: [
      { id: 'main',         x: 0,   y: 0,   w: 616, h: 1350, zIndex: 0, note: '★ ฮีโร่ close-up เต็มสูง ~57% กว้าง — หน้าใหญ่ครึ่งบน (วงกลมทับช่วงตัวล่าง ไม่ทับหน้า)' },
      { id: 'right_top',    x: 616, y: 0,   w: 464, h: 540, zIndex: 0, note: 'ขวาบน 40% — คู่/ปฏิกิริยา/บริบท (เล็กกว่าตาม ref) ชนขอบฮีโร่' },
      { id: 'right_bottom', x: 616, y: 540, w: 464, h: 810, zIndex: 0, note: 'ขวาล่าง 60% — close-up คนที่สอง/เหยื่อ หน้าใหญ่เด่น (ใหญ่กว่าตาม ref)' },
      { id: 'circle', shape: 'circle', x: 34, y: 940, w: 380, h: 380, zIndex: 4, border: '#FFFFFF', borderWidth: 14, note: '⭕ วงกลมกรอบขาวหนา ล่างซ้ายคร่อมตัวฮีโร่ (ขวาสุด 414 < 616 ไม่ทับช่องขวา) — โมเมนต์/หลักฐาน/คนคู่' },
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

  // D. "faces_circle" — ★ rev.14i: โครงตัวอย่างหนุ่มกรรชัยเป๊ะ — hero เต็มความสูงซ้าย + ขวา 2 ช่อง + วงกลมทับ "ตัว" hero
  //   (แก้ปัญหาทุกเคส: เดิมวงกลมทับช่อง bottom_left ที่มีคน → คนโดนทับสกปก. ตัด bottom_left ทิ้ง วงกลมทับตัว hero แทน)
  vt_faces_circle: {
    id: 'vt_faces_circle',
    storyFit: 'ตัวหลักเด่น + คู่/บุคคลที่สอง — hero เต็มซ้าย วงกลมโมเมนต์อบอุ่น',
    canvasW: 1200, canvasH: 1350,
    slots: [
      { id: 'main',         x: 0,   y: 0,   w: 648, h: 1350, zIndex: 0, note: '★ ฮีโร่เต็มความสูง — หน้าใหญ่เด่นข้างบน ตัวยาวลงล่าง (วงกลมจะทับช่วงตัวล่าง)' },
      { id: 'top_right',    x: 648, y: 0,   w: 552, h: 672,  zIndex: 0, note: 'คู่/บุคคลที่สอง — หน้าชัดเต็มกรอบ' },
      { id: 'bottom_right', x: 648, y: 678, w: 552, h: 672,  zIndex: 0, note: 'บุคคลที่สอง/โมเมนต์ — หน้าชัดเต็มกรอบ' },
      { id: 'circle', shape: 'circle', x: 40, y: 876, w: 446, h: 446, zIndex: 4, border: '#FFFFFF', borderWidth: 8, note: '⭕ ทับช่วง "ตัว" ของฮีโร่ (ไม่ทับหน้าใคร) — หน้าอีกบุคคล/โมเมนต์อบอุ่น' },
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

/**
 * rev.14: คำนวณกรอบครอปจาก "พิกัดใบหน้า" โดยตรง — ให้หน้าเต็มช่องตามสัดส่วนช่องเป๊ะ
 * แก้ปัญหาหลักที่ผู้ใช้ชี้: รูปไม่เต็มเฟรม / หน้าจมตัว-ฉากหลัง / หัวขาด-หลุดกรอบ
 * - สัดส่วนกรอบ = สัดส่วนช่อง → resize fill ไม่ยืดไม่เพี้ยน
 * - หน้ากิน faceFrac ของความกว้าง + การันตี headroom (หน้า ≤60% ความสูงกรอบ)
 * - จัดหน้าให้อยู่กึ่งกลางแนวนอน + faceTopAt (กันหัวชนขอบ/คางหลุด)
 * ใช้กับ "ช่องหน้าเดี่ยว 1 คน" เท่านั้น (ภาพคู่/หมู่ใช้กรอบจาก Director ตามเดิม)
 */
function faceRegionForSlot(fb, imgW, imgH, slotAspect, faceFrac, faceTopAt, maxFaceHFrac = 0.60, minFaceHFrac = 0, faceCxAt = 0.5) {
  // rev.14k: ขยาย "face box" → "หัว" (รวมผม) ก่อนคำนวณ — กันผมตกขอบ (บทเรียน CASE-090 hero ผมตก)
  const fwN = fb.x2 - fb.x1, fhN = fb.y2 - fb.y1;
  const hx1 = fb.x1 - fwN * 0.20, hx2 = fb.x2 + fwN * 0.20; // เผื่อผม/หูข้าง
  // ★ 29 มิ.ย. (CASE-237/239 ผู้ใช้ย้ำ 2 รอบ: ฮีโร่เหลือช่องว่างเหนือหัว เห็นหน้าต่าง/บันได = พื้นหลังแย่งจุดเด่น):
  //   ฮีโร่ (minFaceHFrac>0) ลด padding เผื่อผมเหนือหัว 0.50→0.30 → กล่องหัวชิดผมจริง พื้นหลังเหนือหัวน้อยลง หน้าเต็มเฟรมขึ้น
  //   ช่องรอง (minFaceHFrac=0) คง 0.50 เผื่อผม (กัน CASE-090 ผมตก) · การ์ดกันผมตก (บรรทัด ~213) ยังทำงานปกติ
  const topPad = minFaceHFrac > 0 ? 0.42 : 0.50; // ★ เฟส2.5b จุด1 (Hermes CASE-261 ฮีโร่บนหัวตัด+อึดอัด): ฮีโร่ 0.30→0.42 เผื่อเหนือหัวมากขึ้น (หัวครบ+ไม่อึดอัด แต่ยังไม่โล่งเท่า 0.50 = CASE-237/239)
  const hy1 = fb.y1 - fhN * topPad, hy2 = fb.y2 + fhN * 0.32; // เผื่อผมบน + คาง (เฟส2.5 จุด1: 0.18→0.32 กล่องหัวคลุมถึงใต้คาง/คอ กันตัดคาง ทุกช่อง — Hermes CASE-254)
  const faceWpx = (hx2 - hx1) * imgW;       // ความกว้าง "หัว"
  const faceHpx = (hy2 - hy1) * imgH;       // ความสูง "หัว"
  const faceCxPx = ((hx1 + hx2) / 2) * imgW;
  const faceCyPx = ((hy1 + hy2) / 2) * imgH;

  // rev.15j: มงกุฎหัว/หน้าชิดขอบบนในภาพต้นฉบับเอง (ส่วนหัวที่หลุดเฟรม crop ไหนก็กู้ไม่ได้)
  //   → ซูมออก + ดันหน้าลงนิด ให้ส่วนขาดเป็นสัดส่วนเล็กลง ดูตั้งใจ ไม่เหมือนหัวขาด (แก้ CASE-141 ช่องล่าง)
  // rev.21f: ขยายเกณฑ์ 0.03→0.06 — หัว/มงกุฎหัวชิดขอบบนในภาพต้นฉบับ → ซูมออก+ดันหน้าลง (กันหัวขาด ครอบคลุมเคสมากขึ้น)
  if (typeof fb.y1 === 'number' && fb.y1 < 0.06) {
    faceFrac = faceFrac * 0.85;             // ซูมออก หน้าเล็กลง เห็นไหล่/บริบทมากขึ้น
    faceTopAt = Math.max(faceTopAt, 0.40);  // ดันหน้าลงจากขอบบน
  }
  let regionWpx = faceWpx / faceFrac;       // หน้ากิน faceFrac ของความกว้างกรอบ
  let regionHpx = regionWpx / slotAspect;    // สัดส่วนตรงช่อง → fill ไม่ยืด
  const minH = faceHpx / maxFaceHFrac;       // หน้า ≤maxFaceHFrac ของความสูงกรอบ (สูงขึ้น=หน้าใหญ่ขึ้น)
  if (regionHpx < minH) { regionHpx = minH; regionWpx = regionHpx * slotAspect; }

  // ★ HERO เท่านั้น (minFaceHFrac>0 — moment/circle ส่ง 0 ไม่เข้าบล็อกนี้):
  //   พื้นหน้าขั้นต่ำ — หน้าต้องกิน ≥minFaceHFrac ของความสูงกรอบ ถ้าหลวมกว่านี้ "ซูมเข้า"
  //   กันฮีโร่หน้าเล็ก/เน้นลำตัว+พื้นหลังเยอะ จนดูไม่ออกว่าใคร (แก้ CASE-200) · ภาพหน้าใหญ่อยู่แล้วไม่กระทบ
  if (minFaceHFrac > 0) {
    const maxRegionH = faceHpx / minFaceHFrac;
    if (regionHpx > maxRegionH) { regionHpx = maxRegionH; regionWpx = regionHpx * slotAspect; }
  }

  if (regionWpx > imgW) { regionWpx = imgW; regionHpx = regionWpx / slotAspect; }
  if (regionHpx > imgH) { regionHpx = imgH; regionWpx = regionHpx * slotAspect; }

  // ★ HERO เท่านั้น — ล็อกหน้าไว้ "กึ่งกลาง": ถ้ากรอบล้นขอบภาพ ให้ "ซูมเข้า" พอดี
  //   ไม่ปล่อยให้ clamp ด้านล่างดันหน้าเบี้ยวออกข้างจนหน้าโดนตัดครึ่ง (แก้ CASE-198)
  //   🔒 กันซูมแรงเกิน: ทำเฉพาะเมื่อ "ยังครอบหัวได้เต็ม" (maxHalfW*2 ≥ ความกว้างหัว)
  //      ถ้าหน้าชิดขอบมากจนซูมแล้วหัวขาด → ไม่ซูม (ปล่อย clamp เดิม ดีกว่าหัวโดนตัด)
  if (minFaceHFrac > 0) {
    const maxHalfW = Math.min(faceCxPx, imgW - faceCxPx);
    const zoomW = maxHalfW * 2, zoomH = zoomW / slotAspect;
    // ซูมได้เฉพาะเมื่อกรอบที่เล็กลงยัง "ครอบหัวได้ครบทั้งกว้างและสูง" (ไม่งั้นหัวขาด → ปล่อย clamp เดิม)
    if (maxHalfW > 0 && regionWpx / 2 > maxHalfW && zoomW >= faceWpx && zoomH >= faceHpx) {
      regionWpx = zoomW; regionHpx = zoomH;
    } else if (maxHalfW > 0 && regionWpx / 2 > maxHalfW) {
      // ★ 9 ก.ค. (ผู้ใช้: "hero บางปกไม่เด่น" — เคสหน้าชิดขอบภาพ): เดิมยอมแพ้ไม่ซูม → หน้าจมฉากกว้าง
      //   ซูมแบบ "ไม่บังคับกึ่งกลาง": กรอบเล็กสุดที่ยังคลุมหัวครบ วางออฟเซ็นเตอร์ได้ (ปกไวรัลจริงก็ทำ)
      //   การ์ดกล่องหัว (จุด4 ด้านล่าง) ยังตรวจซ้ำ — หัวโผล่พ้นกรอบเมื่อไหร่ถูก re-center ทันที
      const nW = Math.min(imgW, Math.max(faceWpx * 1.12, regionWpx * 0.62));
      const nH = nW / slotAspect;
      if (nW < regionWpx && nH >= faceHpx * 1.06 && nH <= imgH) {
        regionWpx = nW; regionHpx = nH;
        console.log('[CoverV3] 🔍 hero หน้าชิดขอบ → ซูมออฟเซ็นเตอร์ (คลุมหัวครบ)');
      }
    }
  }

  // ★ 9 ก.ค.3: faceCxAt = ตำแหน่งแนวนอนของหน้าในเฟรม (0.5=กึ่งกลาง) — ช่องโดน inset/วงทับใช้ค่าโซนมองเห็น
  let left = faceCxPx - regionWpx * faceCxAt;
  let top = faceCyPx - regionHpx * faceTopAt;
  left = Math.min(Math.max(left, 0), imgW - regionWpx);
  top = Math.min(Math.max(top, 0), imgH - regionHpx);

  // ★ เฟส 2.5 จุด4 (safety clamp — Hermes CASE-255/256 ฮีโร่ตัดบนหัว(ผม)+หูขวา):
  //   เช็ค "กล่องหัว(รวมผม+หู)" vs กรอบจริง *หลัง* clamp ขอบ — ถ้ายื่นออก จัดใหม่ให้คลุมหัวครบ
  //   ★ ส่วนใหญ่ guard เดิมทำกรอบใหญ่พอแล้ว แค่ "วางผิดตำแหน่ง" (faceTopAt ดันสูงไป/edge-clamp เลื่อน) →
  //     re-center บนกล่องหัว = หน้าคงขนาดเดิม ไม่ซูมออก (กัน regression หน้าเล็ก CASE-224/235)
  //   ★ ขยาย region "เฉพาะเท่าที่หัวใหญ่กว่ากรอบจริง" เท่านั้น (targeted) · ฮีโร่เท่านั้น (minFaceHFrac>0) · ไม่เกินขอบภาพ
  if (minFaceHFrac > 0) {
    const hL = hx1 * imgW, hT = hy1 * imgH, hR = hx2 * imgW, hB = hy2 * imgH; // กล่องหัว (px)
    const pokes = (hL < left - 0.5) || (hR > left + regionWpx + 0.5) || (hT < top - 0.5) || (hB > top + regionHpx + 0.5);
    if (pokes) {
      let nW = Math.max(regionWpx, (hR - hL) * 1.06), nH = Math.max(regionHpx, (hB - hT) * 1.06); // ขยายเฉพาะเท่าที่หัวใหญ่กว่า (+~3%/ข้าง)
      if (nW / nH > slotAspect) nH = nW / slotAspect; else nW = nH * slotAspect;                   // คง aspect ช่อง
      nW = Math.min(nW, imgW); nH = Math.min(nH, imgH);                                            // ไม่เกินภาพ
      if (nW / nH > slotAspect) nW = nH * slotAspect; else nH = nW / slotAspect;
      regionWpx = nW; regionHpx = nH;
      const hcx = (hL + hR) / 2, hcy = (hT + hB) / 2;                                              // วางกรอบกลางกล่องหัว → หัวครบทุกด้าน
      left = Math.min(Math.max(hcx - regionWpx / 2, 0), imgW - regionWpx);
      top = Math.min(Math.max(hcy - regionHpx / 2, 0), imgH - regionHpx);
    }
  } else if (minFaceHFrac === 0 && (hy1 * imgH) < top - 0.5) {
    // ★ เฟส 2.5b จุด2 (Hermes CASE-261 ช่องรองตัดบนหัว): ช่องรอง (MOMENT/circle) กันตัดบนหัว — top-only (ไม่ re-center/ไม่แตะขนาด กัน regression ช่องรองที่ดีอยู่แล้ว)
    top = Math.max(0, hy1 * imgH); // ดัน top ขึ้นคลุมบนหัว (regionH ใหญ่พอคลุมคางอยู่แล้ว = maxFaceHFrac 0.74)
  }
  // ★ 9 ก.ค. (ผู้ใช้: "หัวแหว่งตรงผม เกินขอบบน — เน้นหน้า ลดช่วงตัว จัดกึ่งกลาง"): การ์ดผมทรงสูง/มัดจุก
  //   กล่องหัว (topPad 0.42/0.50) ประเมินผมทรงสูงต่ำไป → ใช้ "เส้นผมสูงสุด" = y1 - 0.55·fh
  //   ครอปเริ่มต่ำกว่าเส้นนี้ = เสี่ยงผมล้นขอบ → เลื่อนกรอบขึ้นเท่าที่ขาด (ขนาดเดิม: ผมครบ + ตัดช่วงตัวล่างแทน
  //   หน้ายังกึ่งกลางแนวนอน) · ช่องที่ top อยู่เหนือเส้นอยู่แล้ว = ไม่ถูกแตะ · เลื่อนขึ้นอย่างเดียว bottom ไม่มีทางหลุดภาพ
  //   (คางปลอดภัย: regionH ≥ ~2.3·fh เสมอ — เลื่อนสุด bottom ยังต่ำกว่าคาง ≥0.8·fh)
  const hairTopPx = Math.max(0, (fb.y1 - fhN * 0.55) * imgH);
  if (top > hairTopPx) top = hairTopPx;
  return { left: Math.round(left), top: Math.round(top), width: Math.max(8, Math.round(regionWpx)), height: Math.max(8, Math.round(regionHpx)) };
}

// ════════════════════════════════════════════════════════════════════════════
// 🧠 ค่าครอป "แยกต่อเลย์เอาต์" — แก้ตัวไหนกระทบแค่ตัวนั้น (ผู้ใช้สั่ง 24 มิ.ย.)
//   🔴 กฎเหล็ก: สั่งแก้ "ฮีโร่" → แตะ HERO_CROP เท่านั้น · สั่งแก้ "ช่องรอง" → แตะ MOMENT_CROP เท่านั้น
//      วงกลมมีโค้ด+ค่าของตัวเองใน renderCircleTile แยกอีกชั้น — แก้วงกลมไปแตะที่นั่น
//   ⛔ ห้ามแก้ค่าเลย์เอาต์อื่นเวลาแก้เลย์เอาต์เดียว (กันแก้ 1 พัง 10)
// ════════════════════════════════════════════════════════════════════════════
// ── HERO (ช่องเอกใหญ่) — rev.22e: คืนค่า rev-14v ที่ "หน้าเด่นเต็มเฟรม ไม่ตัด" (ยุค CASE-096/159) ──
//   (ค่าก่อนหน้า 0.90/0.26/0.82 ดัน faceTopAt 0.26 ชิดบนเกิน → หน้าโดนตัด/โชว์ตัว+กีตาร์ = CASE-183)
//   + minFaceHFrac (25 มิ.ย.): หน้าต้องเด่นขั้นต่ำ — ซูมเข้าถ้าหน้าเล็ก/เน้นลำตัว (แก้ CASE-200) · ล็อกแบบ CASE-199
// ★ 27 มิ.ย. (ผู้ใช้สั่ง CASE-224): ฮีโร่หน้าเล็กไป เหลือพื้นที่ว่าง/ตัวเยอะ หน้าไม่นำทรง → ซูมหน้าเข้าให้เต็มเฟรม
//   faceFrac 0.82→0.94 (หน้ากินกว้างเฟรมเกือบเต็ม) + minFaceHFrac 0.50→0.60 (บังคับหน้าใหญ่ขั้นต่ำ)
//   ★ ภาพไม่เสีย: guard "ซูมเฉพาะเมื่อหัวยังครบทั้งกว้าง-สูง" (บรรทัด ~234-241) กันหัวขาด/หน้าตัดครึ่งอยู่แล้ว
// rev.23 (CASE-235 ผู้ใช้สั่ง: ฮีโร่หน้าต้องเด่น ห้ามโชว์เต็มตัว/ครึ่งตัว): ดันกล่องหัวจาก 60-78% → 72-84% ของความสูงกรอบ
//   กล่องหัวรวม hair padding ใหญ่กว่าหน้าจริง ~1.68× → ค่าเดิม 0.60 ทำหน้าจริงเหลือ ~36% (โชว์ตัว) · ค่าใหม่ → หน้าจริง ~45% เด่นขึ้นชัด
//   (การ์ดกันหัวขาด: บรรทัด 210-213 + 234-241 ยังทำงาน — ภาพหน้าชิดขอบบนจะซูมออกอัตโนมัติ ไม่ตัดหัว)
// ★ เฟส 2.5 (Hermes CASE-254 ฮีโร่ตัดคาง): ผ่อนจาก 0.94/0.34/0.84/0.72 → หน้าครบไม่ตัดคาง/หัว/หู แต่ยังเด่น
//   maxFaceHFrac 0.84→0.74 (เพดานหน้าใหญ่ลง ไม่บีบจนคางหลุด) · minFaceHFrac 0.72→0.60 (ซูมเบาลง ยังเด่น)
//   faceTopAt 0.34→0.40 (ดันหน้าลงจากขอบบน กันตัดหัว) · faceFrac 0.94→0.88 (เผื่อหู/แก้มข้าง ไม่ชิดขอบ)
//   ⚠️ ถ้าเทสแล้วหน้าเล็กไป (ติแบบ CASE-200/224) ปรับขึ้นทีละ 0.02-0.04
const HERO_CROP   = { faceFrac: 0.88, faceTopAt: 0.40, maxFaceHFrac: 0.74, minFaceHFrac: 0.60 };
// ── CIRCLE (วงกลม) — ⛔ คงค่าเดิม ห้ามแก้เมื่อแก้เลย์เอาต์อื่น ──
// ★ เฟส 2.5: วงกลมตัดมุมโค้ง → ต้องเผื่อมากกว่าสี่เหลี่ยม (กันตัดบนหัว+คางพร้อมกัน — Hermes CASE-254)
//   faceFrac 0.80→0.66 (หน้ากินกว้างน้อยลง เผื่อขอบโค้งตัดข้าง) · maxFaceHFrac 0.80→0.66 (หน้าเล็กลงในวง กันตัดบน-ล่าง)
// ★ เฟส 3B (CASE-267): ซูมหน้าเต็มวงขึ้น faceFrac 0.66→0.72 + maxFaceHFrac 0.66→0.72 (ยังเผื่อขอบโค้ง ไม่เกิน 0.74)
const CIRCLE_CROP = { faceFrac: 0.72, faceTopAt: 0.45, maxFaceHFrac: 0.72, minFaceHFrac: 0.35 }; // ★ rev.K1: หน้าต้อง ≥35% ของวง (กันคนเต็มตัวจมวง CASE-321)
// ── MOMENT (ช่องรอง) ──
// ★ เฟส 3B (CASE-267 เจมส์ ช่องรองหน้าเล็กเห็นตัว/หมา/เวที): ซูมหน้าเด่นเต็มเฟรม faceFrac 0.76→0.84 + maxFaceHFrac 0.74→0.80
// ★ rev.K1 (CASE-321 ลายตา — เทียบปกแสนไลค์: "ทุกช่อง" หน้าคน ~40-70% ของช่อง ไม่ใช่แค่ hero):
//   เพิ่ม minFaceHFrac ช่องรอง 0.30 + วงกลม 0.35 — เดิม 0 = ภาพ wide หน้าจิ๋วผ่านออกทั้งฉาก (จมโซฟา/ป้ายไฟ)
const MOMENT_CROP = { faceFrac: 0.84, faceTopAt: 0.40, maxFaceHFrac: 0.80, minFaceHFrac: 0.30 };

/** พารามิเตอร์การจัดหน้าตามชนิด/ขนาดช่อง — ดึงจากค่าที่แยกต่อเลย์เอาต์ด้านบน (แก้ที่ const นั้นๆ) */
function faceParamsForSlot(slot) {
  if (slot.shape === 'circle') return { ...CIRCLE_CROP };
  const big = (slot.w * slot.h) >= (520 * 800); // ช่องเด่น/ฮีโร่
  if (slot.id === 'main' || big) return { ...HERO_CROP };
  return { ...MOMENT_CROP };
}

/** มี face box เดี่ยวใช้ได้ไหม (1 หน้า) */
function usableSingleFace(fb) {
  return !!(fb && fb.x2 > fb.x1 && (fb.count || 1) === 1);
}

/** มีหลายหน้า (ภาพคู่/ครอบครัว) ใช้ group-crop ได้ไหม */
function usableGroupFaces(fb) {
  return !!(fb && Array.isArray(fb.allFaces) && fb.allFaces.length >= 2);
}

/**
 * rev.14b: กระชับ "กลุ่มหน้า" (ภาพคู่/ครอบครัว) ให้เต็มเฟรม — แก้ที่ผู้ใช้ติ CASE-072:
 * ภาพฝั่งขวาหน้าไกล/ไม่ชัด → ครอปให้กลุ่มหน้ากิน fillFrac ของความกว้าง หน้าทุกคนชัด
 * (bbox ของทุกหน้า + headroom, สัดส่วนตรงช่อง → fill ไม่เพี้ยน)
 */
function groupRegionForSlot(faces, imgW, imgH, slotAspect) {
  // bbox ของทุกหน้า (px)
  const x1 = Math.min(...faces.map(f => f.x1)) * imgW, x2 = Math.max(...faces.map(f => f.x2)) * imgW;
  const y1 = Math.min(...faces.map(f => f.y1)) * imgH, y2 = Math.max(...faces.map(f => f.y2)) * imgH;
  const avgFh = (faces.reduce((s, f) => s + (f.y2 - f.y1), 0) / faces.length) * imgH; // ความสูงหน้าเฉลี่ย

  // rev.15g (feedback CASE-126): ช่องรองซูมเข้า "หน้าใหญ่ขึ้น" — ลดระยะเผื่อ (แต่ยังกันตัดหัว-ไหล่)
  let L = x1 - avgFh * 0.24;   // ข้างซ้าย
  let R = x2 + avgFh * 0.24;   // ข้างขวา
  let T = y1 - avgFh * 0.38;   // headroom เหนือหัว
  let B = y2 + avgFh * 0.62;   // ไหล่-อก ใต้คาง
  let cx = (L + R) / 2, cy = (T + B) / 2;
  let regionWpx = R - L, regionHpx = B - T;

  // ปรับสัดส่วนให้ตรงช่อง โดย "ขยาย" ด้านที่ขาด (รอบจุดกลาง — ไม่หดกล่องเผื่อ → ไม่ตัด)
  if (regionWpx / regionHpx > slotAspect) regionHpx = regionWpx / slotAspect;
  else regionWpx = regionHpx * slotAspect;

  if (regionWpx > imgW) { regionWpx = imgW; regionHpx = regionWpx / slotAspect; }
  if (regionHpx > imgH) { regionHpx = imgH; regionWpx = regionHpx * slotAspect; }

  const left = Math.min(Math.max(cx - regionWpx / 2, 0), imgW - regionWpx);
  const top = Math.min(Math.max(cy - regionHpx / 2, 0), imgH - regionHpx);
  return { left: Math.round(left), top: Math.round(top), width: Math.max(8, Math.round(regionWpx)), height: Math.max(8, Math.round(regionHpx)) };
}

/**
 * rev.16 (ด่าน C — คุมโทนรวม): คำนวณ gain ปรับ white-balance แบบ gray-world
 *   ดึง mean แต่ละช่องสี (R/G/B) เข้าหาเทากลาง แบบเบลนด์ (strength) + clamp กันเพี้ยนแรง
 *   → ภาพจากแหล่งต่างกัน (เหลืองสตูดิโอ/ฟ้าเดย์ไลต์/ม่วงเวที) เข้าโทนเดียวกัน เหมือนปกที่เกรดมาทั้งใบ
 */
async function grayWorldGains(buf, strength = 0.5) {
  try {
    const { channels } = await sharp(buf).stats();
    if (!channels || channels.length < 3) return null;
    const [r, g, b] = channels;
    const gray = (r.mean + g.mean + b.mean) / 3;
    if (!(gray > 0)) return null;
    const clamp = (v) => Math.max(0.85, Math.min(1.2, v));
    const gain = (m) => clamp(1 + ((gray / (m || gray)) - 1) * strength);
    return [gain(r.mean), gain(g.mean), gain(b.mean)];
  } catch { return null; }
}

/** ★ rev.S4 (2 ก.ค. — ลายน้ำ "ผู้จัดการ" หลุดขึ้นปก CASE-300/304/305): หลบโซนลายน้ำระดับพิกเซล
 *  ต้องทำที่ executor เพราะช่องมีหน้า executor คำนวณ region เองจาก faceBox (ไม่ใช้ crop Director)
 *  หลักการ: คงสัดส่วน region เดิม (หด+จัดกึ่งกลางหน้า) — หัวถึงใต้คางต้องอยู่ครบ ไม่งั้นคงเดิม (หน้าขาดแย่กว่าลายน้ำ) */
function dodgeWatermarkPx(region, fb, imgW, imgH, tag = '') {
  // ★ S4b: หลบทั้ง "ลายน้ำ" และ "แคปชั่นฝัง" (textRegion) — บทเรียน CASE-308 วงกลมติดแคปชั่น
  let out = _dodgeBoxPx(region, fb, fb?.watermarkRegion, imgW, imgH, tag + '·ลายน้ำ');
  out = _dodgeBoxPx(out, fb, (fb?.hasText && fb?.textRegion) ? fb.textRegion : null, imgW, imgH, tag + '·แคปชั่น');
  return out;
}
function _dodgeBoxPx(region, fb, wm, imgW, imgH, tag = '') {
  if (!wm || !(wm.x2 > wm.x1) || !region) return region;
  const wy1 = wm.y1 * imgH, wy2 = wm.y2 * imgH, wx1 = wm.x1 * imgW, wx2 = wm.x2 * imgW;
  const rx2 = region.left + region.width, ry2 = region.top + region.height;
  const ox = Math.min(rx2, wx2) - Math.max(region.left, wx1);
  const oy = Math.min(ry2, wy2) - Math.max(region.top, wy1);
  if (ox <= 2 || oy <= 2) return region; // ไม่ทับ
  const ratio = region.width / Math.max(1, region.height);
  const hasFace = fb.x2 > fb.x1;
  const fhPx = hasFace ? (fb.y2 - fb.y1) * imgH : 0;
  const headTop = hasFace ? Math.max(0, fb.y1 * imgH - fhPx * 0.45) : 0;
  const chin = hasFace ? Math.min(imgH, fb.y2 * imgH + fhPx * 0.18) : 0;
  const faceL = hasFace ? fb.x1 * imgW : 0, faceR = hasFace ? fb.x2 * imgW : 0;
  const faceCx = hasFace ? ((fb.x1 + fb.x2) / 2) * imgW : region.left + region.width / 2;
  const fits = (nl, nt, nw, nh) => !hasFace || (faceL >= nl && faceR <= nl + nw && headTop >= nt && chin <= nt + nh);
  // ลายน้ำโซนล่างของ region → หดให้จบเหนือลายน้ำ
  if (wy1 > region.top + region.height * 0.45) {
    const nh = Math.floor(wy1 - region.top - 2);
    const nw = Math.floor(nh * ratio);
    const nl = Math.max(0, Math.min(Math.round(faceCx - nw / 2), imgW - nw));
    if (nh >= 60 && nw >= 60 && fits(nl, region.top, nw, nh)) {
      console.log(`[CoverV3] 💧 หลบลายน้ำ${tag} (โซนล่าง)`);
      return { left: nl, top: region.top, width: nw, height: nh };
    }
  }
  // ลายน้ำโซนบน → เลื่อนขอบบนลงใต้ลายน้ำ
  if (wy2 < region.top + region.height * 0.55) {
    const nt = Math.ceil(wy2 + 2);
    const nh = Math.floor(ry2 - nt);
    const nw = Math.floor(nh * ratio);
    const nl = Math.max(0, Math.min(Math.round(faceCx - nw / 2), imgW - nw));
    if (nh >= 60 && nw >= 60 && fits(nl, nt, nw, nh)) {
      console.log(`[CoverV3] 💧 หลบลายน้ำ${tag} (โซนบน)`);
      return { left: nl, top: nt, width: nw, height: nh };
    }
  }
  return region; // หลบแบบปลอดภัยไม่ได้ → คงเดิม
}

/** ★ rev.FINAL: ปรับ crop ของ Final Cropper เข้าสัดส่วนช่องด้วยการ "หด" เท่านั้น (ห้ามขยาย — ขยาย=ฉากรกกลับมา)
 *  แนวตั้งหดแบบ bias บน 20% (กันตัดหัว) · แนวนอนหดกึ่งกลาง */
function fitCropInsideAspect(crop, imgW, imgH, slotAspect) {
  let px = crop.x * imgW, py = crop.y * imgH, pw = crop.w * imgW, ph = crop.h * imgH;
  const ca = pw / Math.max(1, ph);
  // ★ FINAL2 (CASE-334 หน้าโดนเฉือน): มีสมอหน้า (_fx,_fy จาก gpt ที่เห็นภาพจริง) → หดแบบล็อกหน้าไว้ในเฟรมเสมอ
  const _hasAnchor = Number.isFinite(crop._fx) && Number.isFinite(crop._fy);
  const ax = _hasAnchor ? crop._fx * imgW : px + pw / 2;
  const ay = _hasAnchor ? crop._fy * imgH : py + ph * 0.35;
  if (ca > slotAspect) {
    const nw = ph * slotAspect;
    px = Math.min(Math.max(ax - nw / 2, px), px + pw - nw); // หน้าอยู่กึ่งกลางแนวนอน — clamp ในกรอบเดิม
    pw = nw;
  } else if (ca < slotAspect) {
    const nh = pw / slotAspect;
    py = Math.min(Math.max(ay - nh * 0.38, py), py + ph - nh); // หน้าอยู่ระดับ ~38% ของเฟรม (rule of thirds) — clamp ในกรอบเดิม
    ph = nh;
  }
  px = Math.min(Math.max(px, 0), Math.max(0, imgW - pw));
  py = Math.min(Math.max(py, 0), Math.max(0, imgH - ph));
  return { left: Math.round(px), top: Math.round(py), width: Math.max(8, Math.round(pw)), height: Math.max(8, Math.round(ph)) };
}

/** ครอป+ย่อภาพลงช่องสี่เหลี่ยม (+กรอบสีถ้ามี) */
async function renderRectTile(src, crop, slot, fb) {
  const meta = await sharp(src).metadata();
  const imgW = meta.width || 1, imgH = meta.height || 1;
  let region;
  if (crop && crop._final) {
    // ★ rev.FINAL: Final Cropper เห็นภาพจริงแล้วตัดสิน — เชื่อ 100% ห้ามชั้นไหนคำนวณทับ
    region = fitCropInsideAspect(crop, imgW, imgH, slot.w / slot.h);
  } else if (usableSingleFace(fb)) {
    let { faceFrac, faceTopAt, maxFaceHFrac, minFaceHFrac } = faceParamsForSlot(slot);
    let faceCxAt = 0.5;
    // ★ 9 ก.ค.3 (ผู้ใช้: "โดนทับแล้วหน้าหาย ต้องย่อ/ขยับ"): ช่องที่ composer ติด _vis (โซนมองเห็น
    //   หลัง inset/วงกลมทับ) → วางหน้ากลางโซนนั้น + จำกัดขนาดหน้าไม่ให้ล้นเข้าใต้ส่วนที่ถูกทับ
    if (slot._vis && slot.id !== 'main') {
      const v = slot._vis;
      faceTopAt = Math.max(0.18, Math.min(0.82, (v.y0 + v.y1) / 2));
      faceCxAt = Math.max(0.22, Math.min(0.78, (v.x0 + v.x1) / 2));
      const vh = Math.max(0.25, v.y1 - v.y0);
      maxFaceHFrac = Math.min(maxFaceHFrac, vh * 0.85);
      minFaceHFrac = Math.min(minFaceHFrac || 0, vh * 0.55);
    }
    region = faceRegionForSlot(fb, imgW, imgH, slot.w / slot.h, faceFrac, faceTopAt, maxFaceHFrac, minFaceHFrac || 0, faceCxAt);
  } else if (usableGroupFaces(fb)) {
    // ★ rev.15i (ผู้ใช้ติช่อง 3-4-5 พัง "ไม่จัดกึ่งกลาง ไม่เน้นคน มองไม่รู้เรื่อง"):
    //   ทุกช่องครอป "หน้าใหญ่สุด" จัดกึ่งกลาง+เด่นชัดเสมอ — เลิกครอปกลุ่มหลวมที่คนตัวเล็กจมฉาก
    const _sortedF = [...fb.allFaces].sort((a, b) => ((b.x2 - b.x1) * (b.y2 - b.y1)) - ((a.x2 - a.x1) * (a.y2 - a.y1)));
    const largest = _sortedF[0];
    const _second = _sortedF[1];
    const _aL = (largest.x2 - largest.x1) * (largest.y2 - largest.y1);
    const _aS = _second ? (_second.x2 - _second.x1) * (_second.y2 - _second.y1) : 0;
    const isHeroSlot = slot.id === 'main' || (slot.w * slot.h) >= (520 * 800);
    const { faceFrac, faceTopAt, maxFaceHFrac, minFaceHFrac } = faceParamsForSlot(slot);
    if (slot.id === 'circle' && _second && _aS >= 0.40 * _aL) {
      // ★ 1 ก.ค. (CASE-246): วงกลม = ช่องสื่อ "คู่/ความสัมพันธ์" → 2 หน้าเด่นขนาดใกล้กัน เก็บทั้งคู่
      //   (กันตัดคนที่ 2 เช่น พ่อ-ลูกสาว/คู่รัก — เดิมครอปหน้าใหญ่สุดอย่างเดียว ทำคนที่ 2 หลุดเฟรม)
      region = groupRegionForSlot([largest, _second], imgW, imgH, slot.w / slot.h);
    } else if (isHeroSlot) {
      // hero = หน้าเดี่ยวใหญ่สุดเด่น + เลื่อนพ้นคนข้างเคียง (บทเรียน CASE-119)
      region = faceRegionForSlot(largest, imgW, imgH, slot.w / slot.h, Math.min(0.96, faceFrac + 0.12), faceTopAt, Math.min(0.90, maxFaceHFrac + 0.08), minFaceHFrac || 0);
      const lcx = ((largest.x1 + largest.x2) / 2) * imgW;
      let rMin = 0, rMax = imgW;
      for (const f of fb.allFaces) {
        if (f === largest) continue;
        const fcx = ((f.x1 + f.x2) / 2) * imgW;
        if (fcx < lcx) rMin = Math.max(rMin, f.x2 * imgW);
        else rMax = Math.min(rMax, f.x1 * imgW);
      }
      let rl = region.left, rr = region.left + region.width;
      if (rr > rMax) { const sh = rr - rMax; rl -= sh; rr -= sh; }
      if (rl < rMin) { const sh = rMin - rl; rl += sh; rr += sh; }
      region.left = Math.round(Math.max(0, Math.min(rl, imgW - region.width)));
    } else {
      // ★ เฟส 3 จุด3 (CASE-265/266): วัด "การกระจายตัว" หน้าทุกคน = bbox กว้างรวม / ความกว้างภาพ
      const _spread = Math.max(...fb.allFaces.map(f => f.x2)) - Math.min(...fb.allFaces.map(f => f.x1));
      if (_spread > 0.55) {
        // คนยืนห่างกัน → group-crop คลุมทุกคน = คนริมโดนขอบตัดสกปรก → ครอปหน้าใหญ่สุดคนเดียวเด่น
        console.log(`[CoverV3] 👥 spread-crop: bbox ${(_spread * 100).toFixed(1)}% > 55% → ครอปหน้าเดียว (largest)`);
        region = faceRegionForSlot(largest, imgW, imgH, slot.w / slot.h, faceFrac, faceTopAt, maxFaceHFrac);
      } else {
        // คนชิดกัน (ครอบครัว/คู่ถ่ายใกล้กัน) → group-crop เก็บทุกคนพอดีเฟรม (คง CASE-104)
        region = groupRegionForSlot(fb.allFaces, imgW, imgH, slot.w / slot.h);
      }
    }
  } else if (fb && fb.subject && fb.subject.y2 > fb.subject.y1) {
    // ★ 30 มิ.ย.: ไม่เจอหน้าชัด แต่ AI ชี้ "บริเวณคน/ซับเจกต์หลัก" → ครอปรอบคน เผื่อเหนือหัว กันตัดหัว/หน้า
    //   (กฎ "ห้ามหน้าตก/ขาดท่อน" ใช้ตอน fallback ด้วย — เดิม fallback เดาครอป "ช่วงบน 55%" ทำหน้าท่อน)
    const s = fb.subject;
    const subH = Math.max(0.02, s.y2 - s.y1);
    const cy1 = Math.max(0, s.y1 - subH * 0.12);            // เผื่อเหนือหัว 12%
    const cy2 = Math.min(1, s.y2 + subH * 0.05);
    const sx1 = Math.max(0, Math.min(s.x1, 0.95));
    const _c = { x: sx1, y: cy1, w: Math.min(1 - sx1, Math.max(0.05, s.x2 - s.x1)), h: Math.max(0.05, cy2 - cy1) };
    region = fitCropToSlotAspect(_c, imgW, imgH, slot.w / slot.h);
  } else {
    // ★ rev.23 (CASE-237 ผู้ใช้สั่ง — กฎ "ห้ามภาพช่วงลำตัวเยอะ/ภาพยืนเต็มตัว" ทุกช่อง):
    //   ช่องที่ "ตรวจไม่เจอหน้า" + ครอป Director สูง (>0.5 ของภาพ = เห็นลำตัว/เต็มตัว) → ซูมเข้า "ช่วงบน-กลาง"
    //   (หัว-อก) แทนครอปเต็ม กันคนยืนเต็มตัวหลุดมา (รูที่ภาพคู่ยืนขวาล่างหลุด) · ภาพบริบท/ฉากได้ส่วนบนพอ (บริบทเป็นรอง)
    let _c = crop;
    if (crop && crop.h > 0.5) {
      const nw = crop.w * 0.80;                                  // แคบเข้าหน่อย (กันเก็บฉากซ้าย-ขวา)
      const nx = Math.max(0, Math.min(crop.x + (crop.w - nw) / 2, 1 - nw));
      _c = { x: nx, y: crop.y, w: nw, h: crop.h * 0.55 };        // เก็บช่วงบน 55% (หัว-อก) ทิ้งช่วงล่าง(ขา/ลำตัว)
    }
    region = fitCropToSlotAspect(_c, imgW, imgH, slot.w / slot.h);
  }
  if (!(crop && crop._final)) region = dodgeWatermarkPx(region, fb, imgW, imgH, ` ${slot.id}`); // ★ rev.S4 (FinalCrop เห็น text เองแล้ว — ไม่ทับ)
  // rev.16: ตัดต่อ/รีทัชจากภาพออริจินัล (ไม่เจเนอเรทใหม่) — WB คุมโทนรวม + รีทัชเบา
  //   (1) gray-world WB ดึงคาสต์สีเข้าโทนเดียว  (2) sat/contrast บางๆ  (3) คมขึ้นพอดี
  const base = await sharp(src).extract(region).resize(slot.w, slot.h, { fit: 'fill' }).toBuffer();
  const wb = await grayWorldGains(base);
  let pipe = sharp(base);
  if (wb) pipe = pipe.linear(wb, [0, 0, 0]);           // คุม white-balance ให้เข้าโทนช่องอื่น
  let tile = await pipe
    .modulate({ saturation: 1.05, brightness: 1.0 })   // สีสดขึ้นนิดเดียว ไม่ดันจนเพี้ยน
    .linear(1.03, -3)                                  // คอนทราสต์บางๆ
    .sharpen({ sigma: 0.8 })                           // คมขึ้นพอดี
    .jpeg({ quality: 92 }).toBuffer();

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
async function renderCircleTile(src, crop, slot, fb) {
  const d = slot.w;
  const bw = slot.borderWidth || 6;
  const meta = await sharp(src).metadata();
  const imgW = meta.width || 1, imgH = meta.height || 1;
  // rev.14L: วงกลม = "หน้าเดี่ยวใหญ่สุดเสมอ" (ผู้ใช้ย้ำ CASE-089/092: วงกลมต้องเห็นหน้าชัด ไม่ใช่กลุ่มหน้าเล็ก)
  //   ถ้าภาพมีหลายหน้า → ครอปหน้าใหญ่สุดเดี่ยว (ชัดกว่าโชว์ทั้งกลุ่มในวงเล็ก)
  let region;
  if (crop && crop._final) {
    // ★ rev.FINAL: เชื่อ Final Cropper 100% — หดเป็นจัตุรัสภายในกรอบ (bias บนกันตัดหัว)
    region = fitCropInsideAspect(crop, imgW, imgH, 1);
  } else if (fb && fb.x2 > fb.x1 && (!fb.allFaces || fb.allFaces.length <= 1)) {
    region = faceRegionForSlot(fb, imgW, imgH, 1, 0.66, 0.47, 0.66, 0.35); // ★rev.K1 +minFace 0.35 · เฟส2.5: วงกลมเผื่อขอบโค้ง (faceFrac/maxFaceHFrac 0.80→0.66) ให้ตรง CIRCLE_CROP
  } else if (fb && Array.isArray(fb.allFaces) && fb.allFaces.length >= 1) {
    const largest = fb.allFaces.reduce((b, f) => ((f.x2 - f.x1) * (f.y2 - f.y1) > (b.x2 - b.x1) * (b.y2 - b.y1) ? f : b), fb.allFaces[0]);
    region = faceRegionForSlot(largest, imgW, imgH, 1, 0.66, 0.47, 0.66, 0.35); // ★rev.K1 +minFace 0.35 · เฟส2.5: วงกลมเผื่อขอบโค้ง (faceFrac/maxFaceHFrac 0.80→0.66) ให้ตรง CIRCLE_CROP
  } else {
    // ★ rev.S3 (CASE-299 วงกลมครึ่งตัว): ภาพไม่มีพิกัดหน้า (เอกสาร EVIDENCE / ตรวจหน้าไม่เจอ)
    //   เดิม fitCropToSlotAspect "ขยาย" ด้านสั้นให้เป็นจัตุรัส = เห็นตัว/ฉากเพิ่ม → เปลี่ยนเป็น "หด" ด้านยาวลง
    //   จัตุรัสแน่นกึ่งกลางแนวนอน + เอนขึ้นบน (จุดสำคัญของภาพคน/เอกสารมักอยู่บนของกรอบ Director)
    let px = crop.x * imgW, py = crop.y * imgH, pw = crop.w * imgW, ph = crop.h * imgH;
    const side = Math.max(8, Math.min(pw, ph));
    px = px + (pw - side) / 2;
    py = py + (ph - side) * 0.25; // bias บน 25%
    px = Math.min(Math.max(px, 0), imgW - side);
    py = Math.min(Math.max(py, 0), imgH - side);
    region = { left: Math.round(px), top: Math.round(py), width: Math.round(side), height: Math.round(side) };
  }

  if (!(crop && crop._final)) region = dodgeWatermarkPx(region, fb, imgW, imgH, ' circle'); // ★ rev.S4 (FinalCrop เห็น text เองแล้ว — ไม่ทับ)
  const cbase = await sharp(src).extract(region).resize(d, d, { fit: 'fill' }).toBuffer();
  const cwb = await grayWorldGains(cbase);
  let cpipe = sharp(cbase);
  if (cwb) cpipe = cpipe.linear(cwb, [0, 0, 0]);        // rev.16: WB เข้าโทนเดียวกับช่องอื่น
  const squared = await cpipe
    .modulate({ saturation: 1.05, brightness: 1.0 }).linear(1.03, -3).sharpen({ sigma: 0.8 })
    .png().toBuffer();
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
export async function executeCover({ assignments, imageBuffers, templateSpec, faceBoxes = [] }) {
  const { canvasW, canvasH } = templateSpec;

  const ordered = [...assignments].sort((a, b) => {
    const za = templateSpec.slots.find(s => s.id === a.slotId)?.zIndex ?? 0;
    const zb = templateSpec.slots.find(s => s.id === b.slotId)?.zIndex ?? 0;
    return za - zb;
  });

  const rectComps = [];
  const circleComps = [];
  for (const a of ordered) {
    const slot = templateSpec.slots.find(s => s.id === a.slotId);
    const src = imageBuffers[a.imageIndex]?.buffer;
    if (!slot || !src) throw new Error(`EXECUTE_MISSING: slot=${a.slotId} image=#${a.imageIndex}`);
    const fb = faceBoxes?.[a.imageIndex] || null; // rev.14: ป้อนพิกัดหน้าให้ครอปหน้าเต็มช่อง
    if (slot.shape === 'circle') circleComps.push(await renderCircleTile(src, a.crop, slot, fb));
    else rectComps.push(await renderRectTile(src, a.crop, slot, fb));
  }

  const bg = { create: { width: canvasW, height: canvasH, channels: 3, background: { r: 255, g: 255, b: 255 } } };
  const feather = Number(templateSpec.feather) || 0;
  // เส้นทางเดิม (ไม่มี feather): composite รวดเดียว — ไม่แตะพฤติกรรมเทมเพลตเก่าทุกตัว
  if (!feather) {
    return sharp(bg).composite([...rectComps, ...circleComps]).jpeg({ quality: 90 }).toBuffer();
  }
  // ★ B feather path (vt_ref_5x4): วางสี่เหลี่ยมก่อน → เบลอ "แถบรอยต่อ" ให้นุ่ม (ลบเส้นกริดคม) → วางวงกลมทับ (คงกรอบขาว)
  let canvas = await sharp(bg).composite(rectComps).png().toBuffer();
  canvas = await featherSeams(canvas, templateSpec, feather);
  return sharp(canvas).composite(circleComps).jpeg({ quality: 90 }).toBuffer();
}

/** เบลอเฉพาะ "แถบรอยต่อ" ระหว่างช่องสี่เหลี่ยม (ขอบด้านในที่ติดช่องอื่น เท่านั้น) — รอยต่อนุ่มแบบ collage ไวรัล
 *  ไม่แตะกลางภาพ/หน้าคน (แถบกว้าง ~2·F รอบเส้นรอยต่อ) · extract จากสำเนา canvas เดิม → blur → composite กลับ */
async function featherSeams(canvasBuf, templateSpec, F) {
  const { canvasW: W, canvasH: H } = templateSpec;
  const bands = [];
  for (const s of templateSpec.slots) {
    // ★ 9 ก.ค.: ข้าม inset ลอย (z≥3) — กรอบสีของ inset ต้องคม ห้ามโดนเบลอตะเข็บ (ตาม ref จริง)
    if (s.shape === 'circle' || (Number(s.zIndex) || 0) >= 3) continue;
    if (s.x > 0) bands.push({ left: s.x - F, top: s.y, width: 2 * F, height: s.h });            // ขอบซ้ายด้านใน
    if (s.x + s.w < W) bands.push({ left: s.x + s.w - F, top: s.y, width: 2 * F, height: s.h }); // ขอบขวาด้านใน
    if (s.y > 0) bands.push({ left: s.x, top: s.y - F, width: s.w, height: 2 * F });             // ขอบบนด้านใน
    if (s.y + s.h < H) bands.push({ left: s.x, top: s.y + s.h - F, width: s.w, height: 2 * F }); // ขอบล่างด้านใน
  }
  const overlays = [];
  for (const raw of bands) {
    const left = Math.max(0, Math.min(raw.left, W - 1));
    const top = Math.max(0, Math.min(raw.top, H - 1));
    const width = Math.max(1, Math.min(raw.width, W - left));
    const height = Math.max(1, Math.min(raw.height, H - top));
    const patch = await sharp(canvasBuf).extract({ left, top, width, height }).blur(Math.max(0.4, F / 2)).toBuffer();
    overlays.push({ input: patch, left, top });
  }
  if (!overlays.length) return canvasBuf;
  return sharp(canvasBuf).composite(overlays).png().toBuffer();
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
