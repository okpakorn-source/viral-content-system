// 📐 หัวใจการวาดปก — ก๊อปตรงจาก src/app/cover-tester/page.js (บรรทัด 6-419) วันที่ 26 ก.ค. 69
// 🔴 ห้ามแก้สูตร — จูนมาเป็นปี ถ้าแก้ปกหน้าตาเปลี่ยน · หน้าเว็บเดิมยังใช้ของตัวเองไม่ถูกแตะ
export const W = 1080, H = 1350;

// 🩹 Safari/iOS ไม่รองรับ ctx.filter — ตรวจครั้งเดียว (ฝั่ง server ไม่มี document → false อัตโนมัติ)
const CANVAS_FILTER_OK = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    return typeof c.filter === 'string'; // รองรับ = มีค่าเริ่ม 'none' · ไม่รองรับ = undefined
  } catch { return false; }
})();

export const BUILTIN_TEMPLATES = [
  // ═══════════════════════════════════════════════════════════
  // Template 1: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง + Sub ซ้ายล่าง
  // อ้างอิง: ปกข่าวดารายิ้ม + สถานที่ปฏิบัติธรรม + ป้ายเรือนธรรม + กลุ่มนั่งสมาธิ
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_1', name: 'ข่าวดราม่า 5 ช่อง', desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight + ภาพรอง', hint: 'ข่าวดราม่าทั่วไปที่มีภาพครบมือ (คนเด่น + สถานที่ + หลักฐานใส่กรอบเขียว)', textSlots: [],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup ยาวจากบนลงล่าง, fade ขวาเพื่อ blend กับ scene
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 675, h: 1350, fadeRight: 288,                  zIndex: 2 },
      // Scene: ขวาบน — สถานที่/เหตุการณ์, fade ซ้าย + ล่าง
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 342, y: 0,   w: 738, h: 720,  fadeLeft: 342, fadeBottom: 250,  zIndex: 0 },
      // Context: ขวาล่าง — ภาพบริบท/ความสัมพันธ์, fade ซ้าย + บน
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 315, y: 580, w: 765, h: 770,  fadeLeft: 288, fadeTop: 280,    zIndex: 1 },
      // Highlight: กลาง-ขวา กรอบเหลืองเขียว — ป้าย/หลักฐาน
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเขียว)',     x: 333, y: 280, w: 504, h: 400,  border: '#CCFF00', borderWidth: 5, zIndex: 3, draggable: true },
      // Sub: ซ้ายล่าง กรอบขาว — ภาพกลุ่ม/บริบทเสริม
      { id: 'sub_left',  label: '🖼 ภาพรอง (ซ้ายล่าง)',      x: 14,  y: 610, w: 468, h: 430,  border: '#FFFFFF', borderWidth: 4, zIndex: 4, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 2: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง (ไม่มี Circle)
  // อ้างอิง: หญิงชุดขาว closeup + วัด/อุโบสถ + เดินถือดอกไม้ + ป้ายกุฏิ
  // Layout สะอาด 4 slots — เหมาะกับข่าวที่มีภาพน้อย (3 ภาพ + 1 หลักฐาน)
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_2', name: 'ข่าวสะอาด 4 ช่อง', desc: '4 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง', hint: 'ข่าวที่มีภาพน้อย (3-4 ใบ) / ข่าวสายบุญ-เรียบง่าย ไม่มีวงกลม', textSlots: [],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup, fade ขวา blend กับวัด/สถานที่
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 648, h: 1350, fadeRight: 270,                  zIndex: 2 },
      // Scene: ขวาบน — สถานที่ (วัด/อาคาร), fade ซ้าย + ล่าง
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 360, y: 0,   w: 720, h: 740,  fadeLeft: 324, fadeBottom: 260,  zIndex: 0 },
      // Context: ขวาล่าง — full body / กิจกรรม, fade ซ้าย + บน
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 342, y: 520, w: 738, h: 830,  fadeLeft: 306, fadeTop: 280,    zIndex: 1 },
      // Highlight: กลาง-ล่างซ้าย กรอบเข้ม — ป้ายชื่อ/หลักฐาน
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเข้ม)',      x: 108, y: 580, w: 504, h: 360,  border: '#333333', borderWidth: 5, zIndex: 3, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 3: Hero ซ้ายเต็ม + Scene ขวาบน + Emotion ขวาล่าง + Highlight กลาง + Circle ซ้ายล่าง
  // อ้างอิง: ชาย profile + หญิงที่ซากไฟไหม้ + หญิงเช็ดน้ำตา + 2 คนนั่งพื้น + ภาพคู่วงกลม
  // Layout ครบ 5 ช่อง มี Circle — เหมาะกับข่าวดราม่าที่มีตัวละคร 2+ คน
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_3', name: 'ข่าวดราม่า + วงกลม', desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Emotion ขวาล่าง + Highlight + Circle', hint: 'ดราม่าที่มีตัวละคร 2 คนขึ้นไป — วงกลมไว้ใส่ภาพคู่/อีกฝ่าย', textSlots: [],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า profile/closeup, fade ขวา
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 666, h: 1350, fadeRight: 279,                  zIndex: 2 },
      // Scene: ขวาบน — สถานที่/เหตุการณ์, fade ซ้าย + ล่าง
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 360, y: 0,   w: 720, h: 720,  fadeLeft: 324, fadeBottom: 240,  zIndex: 0 },
      // Emotion: ขวาล่าง — อารมณ์ close-up, fade ซ้าย + บน
      { id: 'bg_bottom', label: '🖼 อารมณ์ล่าง-ขวา',         x: 342, y: 580, w: 738, h: 770,  fadeLeft: 288, fadeTop: 260,    zIndex: 1 },
      // Highlight: กลาง-ขวา กรอบเหลืองเขียว — ภาพหลักฐาน/บริบท
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเขียว)',     x: 306, y: 280, w: 567, h: 440,  border: '#CCFF00', borderWidth: 5, zIndex: 3, draggable: true },
      // Circle: ซ้ายล่าง กรอบขาว — ภาพคู่/ความสัมพันธ์
      { id: 'circle',    label: '⭕ วงกลม (ซ้ายล่าง)',       x: 23,  y: 680, shape: 'circle', diameter: 396, border: '#FFFFFF', borderWidth: 6, zIndex: 4, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 4: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Circle ซ้ายล่าง + Circle เล็กแดง + ข้อความ 2 บรรทัด
  // อ้างอิง: ตำรวจ + คนนอนทางเท้า + closeup คนนอน + วงกลมข้าวของ + วงแดงคนนั่ง + ข้อความ
  // Layout 6 ช่อง: 3 พื้นหลัง + 2 วงกลม + 2 ข้อความ — เหมาะข่าวสังคม/สะเทือนใจ
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_4', name: 'ข่าวสังคม + 2 วงกลม', desc: '5 รูป + 2 ข้อความ — Hero + Scene + Context + Circle ใหญ่ + Circle เล็กแดง', hint: 'ข่าวสังคม/พลเมืองดี — วงใหญ่ใส่ของกลาง วงแดงเล็กชี้จุด + พิมพ์พาดหัวได้ 2 บรรทัด',
    textSlots: [
      { id: 'line1', label: '📝 บรรทัด 1 (ขาว)', x: 657, y: 680, fontSize: 48, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 450, stroke: '#000', strokeWidth: 4, placeholder: 'พาดหัวหลัก...' },
      { id: 'line2', label: '📝 บรรทัด 2 (เหลือง)', x: 657, y: 760, fontSize: 40, color: '#FFD700', fontWeight: 'bold', align: 'center', maxWidth: 468, stroke: '#000', strokeWidth: 3, bg: 'rgba(0,0,0,0.65)', bgPadY: 12, bgFullWidth: false, bgEditable: true, placeholder: 'รายละเอียด...' },
    ],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup, fade ขวา
      { id: 'main',         label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 648, h: 1350, fadeRight: 270,                  zIndex: 2 },
      // Scene: ขวาบน — wide shot, fade ซ้าย + ล่าง
      { id: 'bg_top',       label: '🖼 ฉากบน-ขวา',             x: 342, y: 0,   w: 738, h: 700,  fadeLeft: 315, fadeBottom: 240,  zIndex: 0 },
      // Context: ขวาล่าง — close-up, fade ซ้าย + บน
      { id: 'bg_bottom',    label: '🖼 ฉากล่าง-ขวา',            x: 315, y: 550, w: 765, h: 800,  fadeLeft: 288, fadeTop: 260,    zIndex: 1 },
      // Circle: ซ้ายล่าง — ภาพหลักฐาน/detail
      { id: 'circle',       label: '⭕ วงกลมใหญ่ (ซ้ายล่าง)',   x: 23,  y: 680, shape: 'circle', diameter: 360, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
      // Circle Small: ขวาบน กรอบแดง — zoom detail
      { id: 'circle_small', label: '⭕ วงกลมเล็ก (แดง ขวาบน)',  x: 801, y: 15,  shape: 'circle', diameter: 180, border: '#FF0000', borderWidth: 4, zIndex: 5, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 5: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง-ขวา + Circle ซ้ายล่างใหญ่
  // อ้างอิง: นักสำรวจถ้ำ + ภายในถ้ำ wide + คนในถ้ำ + กลุ่มคน + 2 คน closeup
  // Layout 5 ช่อง ไม่มีข้อความ — เหมาะข่าวผจญภัย/เหตุการณ์มืด/กลางคืน
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_5', name: 'ข่าวเหตุการณ์ 5 ช่อง', desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight เหลือง + Circle ขาว', hint: 'ข่าวเหตุการณ์/กู้ภัย/ที่เกิดเหตุ — เน้นฉากสถานที่ + วงกลมโคลสอัพคน', textSlots: [],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup, fade ขวา
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 657, h: 1350, fadeRight: 270,                  zIndex: 2 },
      // Scene: ขวาบน — wide shot สถานที่, fade ซ้าย + ล่าง
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 360, y: 0,   w: 720, h: 700,  fadeLeft: 324, fadeBottom: 240,  zIndex: 0 },
      // Context: ขวาล่าง — บุคคล/บริบท, fade ซ้าย + บน
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 315, y: 560, w: 765, h: 790,  fadeLeft: 288, fadeTop: 260,    zIndex: 1 },
      // Highlight: กลาง-ขวา กรอบเหลือง — ภาพกลุ่ม/หลักฐาน
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเหลือง)',    x: 378, y: 310, w: 522, h: 410,  border: '#FFD700', borderWidth: 5, zIndex: 3, draggable: true },
      // Circle: ซ้ายล่าง กรอบขาว ใหญ่ — ภาพ closeup
      { id: 'circle',    label: '⭕ วงกลม (ซ้ายล่าง)',       x: 14,  y: 630, shape: 'circle', diameter: 414, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 6: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Circle เล็กแดงกลาง + Circle ใหญ่ขาว + ข้อความ 2 บรรทัด
  // อ้างอิง: ทหารหนุ่ม + ปฏิบัติการ + ทหารอาวุโสร้องไห้ + zoom + ภาพบุคคล + "รอบนี้ผิดหวังครับ"
  // Layout 5 ช่อง + ข้อความกลาง — เหมาะข่าวสะเทือนใจ/ทหาร/ตำรวจ
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_6', name: 'ข่าวสะเทือนใจ + ข้อความ', desc: '5 รูป + 2 ข้อความ — Hero + Scene + Context + Circle แดงกลาง + Circle ขาวล่าง', hint: 'ข่าวสะเทือนใจ/ทหาร-ตำรวจ — มีคำพูดเด่นกลางปก + วงแดงชี้รายละเอียด',
    textSlots: [
      { id: 'line1', label: '📝 บรรทัด 1 (ขาว)', x: 558, y: 580, fontSize: 46, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 432, stroke: '#000', strokeWidth: 4, placeholder: 'พาดหัวหลัก...' },
      { id: 'line2', label: '📝 บรรทัด 2 (ขาว)', x: 558, y: 660, fontSize: 40, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 450, stroke: '#000', strokeWidth: 3, placeholder: 'รายละเอียด...' },
    ],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup, fade ขวา
      { id: 'main',         label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 630, h: 1350, fadeRight: 252,                  zIndex: 2 },
      // Scene: ขวาบน — สถานการณ์/ปฏิบัติการ, fade ซ้าย + ล่าง
      { id: 'bg_top',       label: '🖼 ฉากบน-ขวา',             x: 342, y: 0,   w: 738, h: 650,  fadeLeft: 315, fadeBottom: 220,  zIndex: 0 },
      // Context: ขวาล่าง — อารมณ์/ผู้เกี่ยวข้อง, fade ซ้าย + บน
      { id: 'bg_bottom',    label: '🖼 ฉากล่าง-ขวา',            x: 306, y: 520, w: 774, h: 830,  fadeLeft: 288, fadeTop: 260,    zIndex: 1 },
      // Circle เล็ก: กลาง-บน กรอบแดง — zoom detail
      { id: 'circle_small', label: '⭕ วงกลมเล็ก (แดง กลาง)',   x: 396, y: 180, shape: 'circle', diameter: 144, border: '#FF0000', borderWidth: 3, zIndex: 5, draggable: true },
      // Circle ใหญ่: ซ้ายล่าง กรอบขาว — portrait
      { id: 'circle',       label: '⭕ วงกลมใหญ่ (ซ้ายล่าง)',   x: 45,  y: 680, shape: 'circle', diameter: 324, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 9: 3 Background Split (Hero 50% + 2 Split Scene on Right) + 1 Central Circle
  // Layout from sample: Left Hero half, Right split top/bottom, Central Circle overlap
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_9', name: '3 ฉากแยกชัด + วงกลมกลาง', desc: '4 รูป — Hero ซ้าย 50% + ฉากขวาบน 50% + ฉากขวาล่าง 50% + วงกลมกลางซ้อนทับ', hint: 'เล่าเรื่อง 3 ฉากแยกชัดไม่เบลนด์กัน + คนเดี่ยวเด่นในวงกลมกลาง', textSlots: [],
    slots: [
      // Hero: ซ้าย 50% สูงเต็ม 1350 — fade ขวาเพื่อ blend
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 585, h: 1350, fadeRight: 90, zIndex: 1 },
      // ฉากขวาบน (Scene): สูง 675, กว้าง 600
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 540, y: 0,   w: 540, h: 680,  fadeLeft: 72, fadeBottom: 80, zIndex: 0 },
      // ฉากขวาล่าง (Context): สูง 675, กว้าง 600
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 540, y: 670, w: 540, h: 680,  fadeLeft: 72, fadeTop: 80, zIndex: 0 },
      // Circle: กลาง ซ้อนทับ — วงกลมพอร์ตเทรตคนเดี่ยว
      { id: 'circle',    label: '⭕ วงกลมกลาง (ซ้อนทับ)',    x: 342, y: 390, shape: 'circle', diameter: 414, border: '#FFFFFF', borderWidth: 10, zIndex: 3, draggable: true },
    ],
  },
];

const LEGACY_CANVAS_W = 1200;
export function normalizeTemplateToCanvas(t) {
  if (!t) return t;
  const srcW = t.canvasW || LEGACY_CANVAS_W;
  if (srcW === W) return t;
  const k = W / srcW;
  const sx = (v) => Math.round((v || 0) * k);
  // ★ 14 ก.ค. รอบ 2: ความกว้างสเกลแบบยึดขอบขวา (round ที่ขอบ ไม่ round ความกว้างตรงๆ)
  //   กันเคสเศษ .5 ปัดขึ้นทั้ง x และ w แล้วขอบขวาล้น canvas 1px (เจอจริง 3 แทมเพลตตอนเทส :3988)
  const sw = (x, w) => sx((x || 0) + (w || 0)) - sx(x);
  const slots = (t.slots || []).map(s => ({
    ...s,
    x: sx(s.x),
    ...(s.shape === 'circle'
      ? { diameter: sw(s.x, s.diameter || 300) }
      : { w: sw(s.x, s.w ?? 300) }),
    ...(s.fadeLeft ? { fadeLeft: sx(s.fadeLeft) } : {}),
    ...(s.fadeRight ? { fadeRight: sx(s.fadeRight) } : {}),
  }));
  const textSlots = (t.textSlots || []).map(ts => ({
    ...ts, x: sx(ts.x), ...(ts.maxWidth ? { maxWidth: sx(ts.maxWidth) } : {}),
  }));
  return { ...t, slots, textSlots, canvasW: W, canvasH: H };
}

/** Rounded rectangle path (cross-browser) */
export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}
export function coverFit(img, tw, th, focusY = 0.3, crop) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const imgAr = iw / ih, tgtAr = tw / th;
  let sw, sh;
  if (imgAr > tgtAr) { sh = ih; sw = ih * tgtAr; }
  else { sw = iw; sh = iw / tgtAr; }
  // Apply zoom (zoom > 1 = crop window smaller = image looks bigger)
  const zoom = (crop?.zoom && crop.zoom > 1) ? crop.zoom : 1;
  sw = sw / zoom;
  sh = sh / zoom;
  // Center position
  let sx = (iw - sw) / 2;
  let sy = imgAr > tgtAr ? (ih - sh) / 2 : Math.max(0, Math.min((ih - sh) * focusY, ih - sh));
  // Apply pixel offsets from user drag
  if (crop?.panX) sx -= crop.panX;
  if (crop?.panY) sy -= crop.panY;
  // Clamp to image bounds
  sx = Math.max(0, Math.min(sx, Math.max(0, iw - sw)));
  sy = Math.max(0, Math.min(sy, Math.max(0, ih - sh)));
  return { sx, sy, sw, sh };
}

export function createFadeMask(w, h, f) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const m = c.getContext('2d');
  m.fillStyle = '#000'; m.fillRect(0, 0, w, h);
  m.globalCompositeOperation = 'destination-out';
  const grad = (x1,y1,x2,y2) => { const g = m.createLinearGradient(x1,y1,x2,y2); return g; };
  if (f.right > 0)  { const g = grad(w-f.right,0,w,0); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,1)'); m.fillStyle=g; m.fillRect(w-f.right,0,f.right,h); }
  if (f.left > 0)   { const g = grad(0,0,f.left,0);    g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)'); m.fillStyle=g; m.fillRect(0,0,f.left,h); }
  if (f.bottom > 0) { const g = grad(0,h-f.bottom,0,h); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,1)'); m.fillStyle=g; m.fillRect(0,h-f.bottom,w,f.bottom); }
  if (f.top > 0)    { const g = grad(0,0,0,f.top);      g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)'); m.fillStyle=g; m.fillRect(0,0,w,f.top); }
  return c;
}

export function drawRectSlot(ctx, img, slot, offset, crop) {
  const ox = offset?.dx||0, oy = offset?.dy||0;
  const { x:bx, y:by, w, h, fadeRight:fR=0, fadeLeft:fL=0, fadeTop:fT=0, fadeBottom:fB=0, border, borderWidth:bw=0, _gray=0 } = slot;
  const x = bx+ox, y = by+oy;
  const dw = border ? w-bw*2 : w, dh = border ? h-bw*2 : h;
  const dx = border ? x+bw : x, dy = border ? y+bw : y;
  if (border) { ctx.save(); ctx.fillStyle=border; ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=12; ctx.shadowOffsetY=4; ctx.fillRect(x,y,w,h); ctx.restore(); }

  // ★ 6 ก.ค. รอบ 4 (ผู้ใช้ชี้เป้าจากปกตัวอย่าง): โหมด "ละลายทับ" — เนื้อภาพคมทั้งใบ
  //   แต่ขยายภาพ "ลามออกนอกกรอบ" ด้านที่เลือก แล้วไล่ความใสเฉพาะส่วนที่ลาม
  //   → ส่วนที่ลามไปทับช่องข้างเคียง = สองภาพซ้อนจางเข้าหากันเนียนเป็นภาพเดียว (ไม่เบลอเนื้อภาพ)
  const me = (!border && slot._meltEdges && (slot._meltEdges.left || slot._meltEdges.right || slot._meltEdges.top || slot._meltEdges.bottom)) ? slot._meltEdges : null;
  const mpx = me ? Math.max(40, me.px || 200) : 0;
  // ★ รอบ 5: ละลาย "สมมาตร" — ครึ่งหนึ่งจางขอบตัวเอง (เห็นผลเสมอ) + อีกครึ่งลามทับเพื่อนบ้าน
  const ext = Math.round(mpx / 2); // ระยะลามออกนอกกรอบ
  const mL = me && me.left ? ext : 0, mR = me && me.right ? ext : 0, mT = me && me.top ? ext : 0, mB = me && me.bottom ? ext : 0;
  const ow = dw + mL + mR, oh = dh + mT + mB; // ขนาดผืนวาดจริง (รวมส่วนลาม)

  const o = document.createElement('canvas'); o.width=ow; o.height=oh;
  const c = o.getContext('2d');
  // ★ 6 ก.ค. (คุณภาพสูงสุด): ย่อ/ขยายภาพแบบเกรดสูง — ขอบคม ไม่หยาบ
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  const {sx,sy,sw,sh} = coverFit(img,ow,oh,0.3,crop);
  if (CANVAS_FILTER_OK && _gray > 0) c.filter = `grayscale(${_gray})`; // ★ 4 ก.ค.: โทนไว้อาลัยรายช่อง
  c.drawImage(img,sx,sy,sw,sh,0,0,ow,oh);
  c.filter = 'none';
  if (!CANVAS_FILTER_OK && _gray > 0) {
    // 🩹 Safari fallback: ไม่มี ctx.filter → desaturate ด้วย blend mode แทน grayscale()
    c.save();
    c.globalCompositeOperation = 'saturation';
    c.fillStyle = `rgba(128,128,128,${_gray})`;
    c.fillRect(0, 0, ow, oh);
    c.restore();
  }
  if (me) {
    // ไล่ความใสคร่อมเส้นขอบเดิม: เริ่มจางจาก "ครึ่งในกรอบ" → ใสสุดที่ปลายส่วนลาม
    // = ขอบตัวเองหายจาง (เห็นผลทันทีทุกกรณี) + เนื้อที่ลามซ้อนบนช่องข้างเคียงจางเข้าหากัน
    const mask = createFadeMask(ow, oh, {
      left: me.left ? mpx : 0,
      right: me.right ? mpx : 0,
      top: me.top ? mpx : 0,
      bottom: me.bottom ? mpx : 0,
    });
    c.globalCompositeOperation='destination-in'; c.drawImage(mask,0,0); c.globalCompositeOperation='source-over';
  }
  if (!border && !me && (fR||fL||fT||fB)) { const mask = createFadeMask(ow,oh,{right:fR,left:fL,top:fT,bottom:fB}); c.globalCompositeOperation='destination-in'; c.drawImage(mask,0,0); c.globalCompositeOperation='source-over'; }
  // ★ 6 ก.ค. รอบ 3 (ผู้ใช้สั่ง): โหมด "เบลอละลาย" — ขอบภาพเบลอฟุ้งค่อยๆ ชัดเข้าใน (ภาพละลายเข้าหากัน)
  //   ต่างจากเฟด: ภาพไม่จางหายเป็นใส แต่ขอบถูกเบลอแรงสุดที่ริมแล้วไล่กลับมาคม
  const be = slot._blurEdges;
  if (CANVAS_FILTER_OK && !border && !me && be && (be.left || be.right || be.top || be.bottom)) {
    const bpx = Math.max(40, be.px || 200);
    // ★ ความแรงเบลอปรับแยกได้ (be.blur) — ไม่ตั้ง = คำนวณจากระยะ (บทเรียน: ผู้ใช้ขอคุมเองได้)
    const k = Math.min(80, Math.max(2, be.blur || Math.round(bpx / 6)));
    const bo = document.createElement('canvas'); bo.width = ow; bo.height = oh;
    const bc = bo.getContext('2d');
    bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high';
    bc.filter = `blur(${k}px)`;
    bc.drawImage(o, 0, 0);
    bc.filter = 'none';
    // mask: โชว์ภาพเบลอเฉพาะแถบขอบที่เลือก (ทึบสุดริมขอบ → จางเข้าหากลางภาพ)
    const mk = document.createElement('canvas'); mk.width = ow; mk.height = oh;
    const mc = mk.getContext('2d');
    const strip = (x1, y1, x2, y2, rx, ry, rw, rh) => {
      const g = mc.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      mc.fillStyle = g;
      mc.fillRect(rx, ry, rw, rh);
    };
    const pw = Math.min(bpx, ow), ph = Math.min(bpx, oh);
    if (be.left) strip(0, 0, pw, 0, 0, 0, pw, oh);
    if (be.right) strip(ow, 0, ow - pw, 0, ow - pw, 0, pw, oh);
    if (be.top) strip(0, 0, 0, ph, 0, 0, ow, ph);
    if (be.bottom) strip(0, oh, 0, oh - ph, 0, oh - ph, ow, ph);
    bc.globalCompositeOperation = 'destination-in';
    bc.drawImage(mk, 0, 0);
    c.drawImage(bo, 0, 0);
  }
  ctx.drawImage(o, dx - mL, dy - mT);
}

export function drawCircleSlot(ctx, img, slot, offset, crop) {
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; // ★ คุณภาพสูงสุด
  const ox = offset?.dx||0, oy = offset?.dy||0;
  const { x:bx, y:by, diameter:d, border='#fff', borderWidth:bw=4, _gray=0 } = slot;
  const x = bx+ox, y = by+oy, r = d/2, cx = x+r, cy = y+r;
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r+bw,0,Math.PI*2);
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=16; ctx.shadowOffsetY=4;
  ctx.fillStyle=border; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
  if (CANVAS_FILTER_OK && _gray > 0) ctx.filter = `grayscale(${_gray})`; // ★ 4 ก.ค.: โทนไว้อาลัยรายช่อง
  const {sx,sy,sw,sh} = coverFit(img,d,d,0.3,crop);
  ctx.drawImage(img,sx,sy,sw,sh,x,y,d,d);
  if (!CANVAS_FILTER_OK && _gray > 0) {
    // 🩹 Safari fallback: ไม่มี ctx.filter → desaturate ด้วย blend mode แทน grayscale() (พื้นที่ถูก clip เป็นวงกลมอยู่แล้ว)
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `rgba(128,128,128,${_gray})`;
    ctx.fillRect(x, y, d, d);
    ctx.restore();
  }
  ctx.restore();
}

export function drawTextSlot(ctx, ts, val, overrideBg, overrides) {
  if (!val) return;
  ctx.save();
  const fSize = overrides?.fontSize || ts.fontSize || 42;
  const textColor = overrides?.color || ts.color || '#FFD700';
  const posX = ts.x + (overrides?.dx || 0);
  const posY = ts.y + (overrides?.dy || 0);
  ctx.font = `${ts.fontWeight||'bold'} ${fSize}px "Noto Sans Thai","Sarabun",sans-serif`;
  ctx.textAlign = ts.align||'center'; ctx.textBaseline = 'middle';

  // Per-line colored background
  const bgColor = overrideBg || ts.bg;
  if (bgColor) {
    const py = ts.bgPadY || 10;
    if (ts.bgFullWidth) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, posY - fSize / 2 - py, W, fSize + py * 2);
    } else {
      const metrics = ctx.measureText(val);
      const tw = Math.min(metrics.width, ts.maxWidth || 1100);
      const px = ts.bgPadX || 16;
      let bx = posX - px;
      if (ts.align === 'center') bx = posX - tw / 2 - px;
      else if (ts.align === 'right') bx = posX - tw - px;
      ctx.fillStyle = bgColor;
      ctx.fillRect(bx, posY - fSize / 2 - py, tw + px * 2, fSize + py * 2);
    }
  }

  if (ts.stroke) { ctx.strokeStyle = ts.stroke; ctx.lineWidth = ts.strokeWidth || 3; ctx.lineJoin = 'round'; ctx.strokeText(val, posX, posY, ts.maxWidth || 1100); }
  ctx.fillStyle = textColor; ctx.fillText(val, posX, posY, ts.maxWidth || 1100);
  ctx.restore();
}

/** Draw blurred + darkened background to fill gaps (no black areas) */
export function drawBlurredBg(ctx, slotImages, template) {
  // Find best image for background: prefer 'main', fallback to first available
  const mainSlot = template.slots.find(sl => sl.id === 'main');
  const bgImg = slotImages['main'] || slotImages[template.slots[0]?.id];
  if (!bgImg) return;
  ctx.save();
  if (CANVAS_FILTER_OK) {
    const { sx, sy, sw, sh } = coverFit(bgImg, W + 40, H + 40);
    ctx.filter = 'blur(30px) brightness(0.3)';
    ctx.drawImage(bgImg, sx, sy, sw, sh, -20, -20, W + 40, H + 40);
    ctx.filter = 'none';
  } else {
    // 🩹 Safari fallback: ไม่มี ctx.filter → เบลอด้วยย่อ-ขยายภาพ 2 จังหวะ + ทามืดด้วย fillRect แทน brightness()
    const stage1 = document.createElement('canvas'); stage1.width = 135; stage1.height = 169;
    const s1 = stage1.getContext('2d');
    s1.imageSmoothingEnabled = true; s1.imageSmoothingQuality = 'high';
    const { sx: fsx, sy: fsy, sw: fsw, sh: fsh } = coverFit(bgImg, 135, 169);
    s1.drawImage(bgImg, fsx, fsy, fsw, fsh, 0, 0, 135, 169);
    const stage2 = document.createElement('canvas'); stage2.width = 27; stage2.height = 34;
    const s2 = stage2.getContext('2d');
    s2.imageSmoothingEnabled = true; s2.imageSmoothingQuality = 'high';
    s2.drawImage(stage1, 0, 0, 27, 34);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(stage2, -20, -20, W + 40, H + 40);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** Draw text area background — solid rounded rect or gradient overlay */
export function drawTextBg(ctx, tb) {
  ctx.save();
  if (tb.gradient) {
    // Gradient: transparent at top → solid dark at bottom
    const g = ctx.createLinearGradient(tb.x, tb.y, tb.x, tb.y + tb.h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, tb.bg || 'rgba(0,0,0,0.85)');
    g.addColorStop(1, tb.bg || 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(tb.x, tb.y, tb.w, tb.h);
  } else {
    ctx.fillStyle = tb.bg || 'rgba(0,0,0,0.75)';
    roundRectPath(ctx, tb.x, tb.y, tb.w, tb.h, tb.radius || 0);
    ctx.fill();
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// Effective slot (applies scale, centered)
// ═══════════════════════════════════════════════════════════
export function getEffSlot(slot, scale) {
  const sc = scale || 1;
  if (sc === 1) return slot;
  if (slot.shape === 'circle') {
    const d = slot.diameter * sc;
    return { ...slot, x: slot.x + (slot.diameter - d)/2, y: slot.y + (slot.diameter - d)/2, diameter: d };
  }
  const sw = slot.w * sc, sh = slot.h * sc;
  return { ...slot, x: slot.x + (slot.w - sw)/2, y: slot.y + (slot.h - sh)/2, w: sw, h: sh };
}
