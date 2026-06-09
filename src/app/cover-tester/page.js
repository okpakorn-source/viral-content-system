'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';

// ═══════════════════════════════════════════════════════════
const W = 1200, H = 1350;
const HANDLE_SIZE = 36; // corner handle hit zone (px in canvas space)
const EDGE_RING = 35;   // circle edge hit zone (px)

// ═══════════════════════════════════════════════════════════
// TEMPLATE DEFINITIONS
// ═══════════════════════════════════════════════════════════
// แทมเพลต builtin — วิเคราะห์จากตัวอย่างจริง (Layout: 4-quadrant)
// Canvas = 1200 x 1350 px
// แต่ละรูปครอบคลุม ~55-60% ของ canvas แล้ว fade เข้าหากัน ไม่มีจุดดำ
const BUILTIN_TEMPLATES = [
  // ═══════════════════════════════════════════════════════════
  // Template 1: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง + Sub ซ้ายล่าง
  // อ้างอิง: ปกข่าวดารายิ้ม + สถานที่ปฏิบัติธรรม + ป้ายเรือนธรรม + กลุ่มนั่งสมาธิ
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_1', name: 'ข่าวดราม่า 5 ช่อง', desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight + ภาพรอง', textSlots: [],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup ยาวจากบนลงล่าง, fade ขวาเพื่อ blend กับ scene
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 750, h: 1350, fadeRight: 320,                  zIndex: 2 },
      // Scene: ขวาบน — สถานที่/เหตุการณ์, fade ซ้าย + ล่าง
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 380, y: 0,   w: 820, h: 720,  fadeLeft: 380, fadeBottom: 250,  zIndex: 0 },
      // Context: ขวาล่าง — ภาพบริบท/ความสัมพันธ์, fade ซ้าย + บน
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 350, y: 580, w: 850, h: 770,  fadeLeft: 320, fadeTop: 280,    zIndex: 1 },
      // Highlight: กลาง-ขวา กรอบเหลืองเขียว — ป้าย/หลักฐาน
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเขียว)',     x: 370, y: 280, w: 560, h: 400,  border: '#CCFF00', borderWidth: 5, zIndex: 3, draggable: true },
      // Sub: ซ้ายล่าง กรอบขาว — ภาพกลุ่ม/บริบทเสริม
      { id: 'sub_left',  label: '🖼 ภาพรอง (ซ้ายล่าง)',      x: 15,  y: 610, w: 520, h: 430,  border: '#FFFFFF', borderWidth: 4, zIndex: 4, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 2: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง (ไม่มี Circle)
  // อ้างอิง: หญิงชุดขาว closeup + วัด/อุโบสถ + เดินถือดอกไม้ + ป้ายกุฏิ
  // Layout สะอาด 4 slots — เหมาะกับข่าวที่มีภาพน้อย (3 ภาพ + 1 หลักฐาน)
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_2', name: 'ข่าวสะอาด 4 ช่อง', desc: '4 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง', textSlots: [],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup, fade ขวา blend กับวัด/สถานที่
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 300,                  zIndex: 2 },
      // Scene: ขวาบน — สถานที่ (วัด/อาคาร), fade ซ้าย + ล่าง
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 400, y: 0,   w: 800, h: 740,  fadeLeft: 360, fadeBottom: 260,  zIndex: 0 },
      // Context: ขวาล่าง — full body / กิจกรรม, fade ซ้าย + บน
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 380, y: 520, w: 820, h: 830,  fadeLeft: 340, fadeTop: 280,    zIndex: 1 },
      // Highlight: กลาง-ล่างซ้าย กรอบเข้ม — ป้ายชื่อ/หลักฐาน
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเข้ม)',      x: 120, y: 580, w: 560, h: 360,  border: '#333333', borderWidth: 5, zIndex: 3, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 3: Hero ซ้ายเต็ม + Scene ขวาบน + Emotion ขวาล่าง + Highlight กลาง + Circle ซ้ายล่าง
  // อ้างอิง: ชาย profile + หญิงที่ซากไฟไหม้ + หญิงเช็ดน้ำตา + 2 คนนั่งพื้น + ภาพคู่วงกลม
  // Layout ครบ 5 ช่อง มี Circle — เหมาะกับข่าวดราม่าที่มีตัวละคร 2+ คน
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_3', name: 'ข่าวดราม่า + วงกลม', desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Emotion ขวาล่าง + Highlight + Circle', textSlots: [],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า profile/closeup, fade ขวา
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 740, h: 1350, fadeRight: 310,                  zIndex: 2 },
      // Scene: ขวาบน — สถานที่/เหตุการณ์, fade ซ้าย + ล่าง
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 400, y: 0,   w: 800, h: 720,  fadeLeft: 360, fadeBottom: 240,  zIndex: 0 },
      // Emotion: ขวาล่าง — อารมณ์ close-up, fade ซ้าย + บน
      { id: 'bg_bottom', label: '🖼 อารมณ์ล่าง-ขวา',         x: 380, y: 580, w: 820, h: 770,  fadeLeft: 320, fadeTop: 260,    zIndex: 1 },
      // Highlight: กลาง-ขวา กรอบเหลืองเขียว — ภาพหลักฐาน/บริบท
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเขียว)',     x: 340, y: 280, w: 630, h: 440,  border: '#CCFF00', borderWidth: 5, zIndex: 3, draggable: true },
      // Circle: ซ้ายล่าง กรอบขาว — ภาพคู่/ความสัมพันธ์
      { id: 'circle',    label: '⭕ วงกลม (ซ้ายล่าง)',       x: 25,  y: 680, shape: 'circle', diameter: 440, border: '#FFFFFF', borderWidth: 6, zIndex: 4, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 4: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Circle ซ้ายล่าง + Circle เล็กแดง + ข้อความ 2 บรรทัด
  // อ้างอิง: ตำรวจ + คนนอนทางเท้า + closeup คนนอน + วงกลมข้าวของ + วงแดงคนนั่ง + ข้อความ
  // Layout 6 ช่อง: 3 พื้นหลัง + 2 วงกลม + 2 ข้อความ — เหมาะข่าวสังคม/สะเทือนใจ
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_4', name: 'ข่าวสังคม + 2 วงกลม', desc: '5 รูป + 2 ข้อความ — Hero + Scene + Context + Circle ใหญ่ + Circle เล็กแดง',
    textSlots: [
      { id: 'line1', label: '📝 บรรทัด 1 (ขาว)', x: 730, y: 680, fontSize: 48, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 4, placeholder: 'พาดหัวหลัก...' },
      { id: 'line2', label: '📝 บรรทัด 2 (เหลือง)', x: 730, y: 760, fontSize: 40, color: '#FFD700', fontWeight: 'bold', align: 'center', maxWidth: 520, stroke: '#000', strokeWidth: 3, bg: 'rgba(0,0,0,0.65)', bgPadY: 12, bgFullWidth: false, bgEditable: true, placeholder: 'รายละเอียด...' },
    ],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup, fade ขวา
      { id: 'main',         label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 300,                  zIndex: 2 },
      // Scene: ขวาบน — wide shot, fade ซ้าย + ล่าง
      { id: 'bg_top',       label: '🖼 ฉากบน-ขวา',             x: 380, y: 0,   w: 820, h: 700,  fadeLeft: 350, fadeBottom: 240,  zIndex: 0 },
      // Context: ขวาล่าง — close-up, fade ซ้าย + บน
      { id: 'bg_bottom',    label: '🖼 ฉากล่าง-ขวา',            x: 350, y: 550, w: 850, h: 800,  fadeLeft: 320, fadeTop: 260,    zIndex: 1 },
      // Circle: ซ้ายล่าง — ภาพหลักฐาน/detail
      { id: 'circle',       label: '⭕ วงกลมใหญ่ (ซ้ายล่าง)',   x: 25,  y: 680, shape: 'circle', diameter: 400, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
      // Circle Small: ขวาบน กรอบแดง — zoom detail
      { id: 'circle_small', label: '⭕ วงกลมเล็ก (แดง ขวาบน)',  x: 890, y: 15,  shape: 'circle', diameter: 200, border: '#FF0000', borderWidth: 4, zIndex: 5, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 5: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง-ขวา + Circle ซ้ายล่างใหญ่
  // อ้างอิง: นักสำรวจถ้ำ + ภายในถ้ำ wide + คนในถ้ำ + กลุ่มคน + 2 คน closeup
  // Layout 5 ช่อง ไม่มีข้อความ — เหมาะข่าวผจญภัย/เหตุการณ์มืด/กลางคืน
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_5', name: 'ข่าวเหตุการณ์ 5 ช่อง', desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight เหลือง + Circle ขาว', textSlots: [],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup, fade ขวา
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 730, h: 1350, fadeRight: 300,                  zIndex: 2 },
      // Scene: ขวาบน — wide shot สถานที่, fade ซ้าย + ล่าง
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 400, y: 0,   w: 800, h: 700,  fadeLeft: 360, fadeBottom: 240,  zIndex: 0 },
      // Context: ขวาล่าง — บุคคล/บริบท, fade ซ้าย + บน
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 350, y: 560, w: 850, h: 790,  fadeLeft: 320, fadeTop: 260,    zIndex: 1 },
      // Highlight: กลาง-ขวา กรอบเหลือง — ภาพกลุ่ม/หลักฐาน
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเหลือง)',    x: 420, y: 310, w: 580, h: 410,  border: '#FFD700', borderWidth: 5, zIndex: 3, draggable: true },
      // Circle: ซ้ายล่าง กรอบขาว ใหญ่ — ภาพ closeup
      { id: 'circle',    label: '⭕ วงกลม (ซ้ายล่าง)',       x: 15,  y: 630, shape: 'circle', diameter: 460, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 6: Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Circle เล็กแดงกลาง + Circle ใหญ่ขาว + ข้อความ 2 บรรทัด
  // อ้างอิง: ทหารหนุ่ม + ปฏิบัติการ + ทหารอาวุโสร้องไห้ + zoom + ภาพบุคคล + "รอบนี้ผิดหวังครับ"
  // Layout 5 ช่อง + ข้อความกลาง — เหมาะข่าวสะเทือนใจ/ทหาร/ตำรวจ
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_6', name: 'ข่าวสะเทือนใจ + ข้อความ', desc: '5 รูป + 2 ข้อความ — Hero + Scene + Context + Circle แดงกลาง + Circle ขาวล่าง',
    textSlots: [
      { id: 'line1', label: '📝 บรรทัด 1 (ขาว)', x: 620, y: 580, fontSize: 46, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 480, stroke: '#000', strokeWidth: 4, placeholder: 'พาดหัวหลัก...' },
      { id: 'line2', label: '📝 บรรทัด 2 (ขาว)', x: 620, y: 660, fontSize: 40, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 3, placeholder: 'รายละเอียด...' },
    ],
    slots: [
      // Hero: ซ้ายเต็มสูง — ใบหน้า closeup, fade ขวา
      { id: 'main',         label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 700, h: 1350, fadeRight: 280,                  zIndex: 2 },
      // Scene: ขวาบน — สถานการณ์/ปฏิบัติการ, fade ซ้าย + ล่าง
      { id: 'bg_top',       label: '🖼 ฉากบน-ขวา',             x: 380, y: 0,   w: 820, h: 650,  fadeLeft: 350, fadeBottom: 220,  zIndex: 0 },
      // Context: ขวาล่าง — อารมณ์/ผู้เกี่ยวข้อง, fade ซ้าย + บน
      { id: 'bg_bottom',    label: '🖼 ฉากล่าง-ขวา',            x: 340, y: 520, w: 860, h: 830,  fadeLeft: 320, fadeTop: 260,    zIndex: 1 },
      // Circle เล็ก: กลาง-บน กรอบแดง — zoom detail
      { id: 'circle_small', label: '⭕ วงกลมเล็ก (แดง กลาง)',   x: 440, y: 180, shape: 'circle', diameter: 160, border: '#FF0000', borderWidth: 3, zIndex: 5, draggable: true },
      // Circle ใหญ่: ซ้ายล่าง กรอบขาว — portrait
      { id: 'circle',       label: '⭕ วงกลมใหญ่ (ซ้ายล่าง)',   x: 50,  y: 680, shape: 'circle', diameter: 360, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
    ],
  },
  // ═══════════════════════════════════════════════════════════
  // Template 9: 3 Background Split (Hero 50% + 2 Split Scene on Right) + 1 Central Circle
  // Layout from sample: Left Hero half, Right split top/bottom, Central Circle overlap
  // ═══════════════════════════════════════════════════════════
  {
    id: 'template_9', name: '3 ฉากแยกชัด + วงกลมกลาง', desc: '4 รูป — Hero ซ้าย 50% + ฉากขวาบน 50% + ฉากขวาล่าง 50% + วงกลมกลางซ้อนทับ', textSlots: [],
    slots: [
      // Hero: ซ้าย 50% สูงเต็ม 1350 — fade ขวาเพื่อ blend
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 650, h: 1350, fadeRight: 100, zIndex: 1 },
      // ฉากขวาบน (Scene): สูง 675, กว้าง 600
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 600, y: 0,   w: 600, h: 680,  fadeLeft: 80, fadeBottom: 80, zIndex: 0 },
      // ฉากขวาล่าง (Context): สูง 675, กว้าง 600
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 600, y: 670, w: 600, h: 680,  fadeLeft: 80, fadeTop: 80, zIndex: 0 },
      // Circle: กลาง ซ้อนทับ — วงกลมพอร์ตเทรตคนเดี่ยว
      { id: 'circle',    label: '⭕ วงกลมกลาง (ซ้อนทับ)',    x: 380, y: 390, shape: 'circle', diameter: 460, border: '#FFFFFF', borderWidth: 10, zIndex: 3, draggable: true },
    ],
  },
];

// ═══════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════
const s = {
  card: { background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, marginBottom: 16 },
  head: { fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 },
  body: { padding: 18 },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 },
  scaleBtn: {
    width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-primary)', color: 'var(--text-primary)',
    fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
};

// ═══════════════════════════════════════════════════════════
// Canvas Helpers
// ═══════════════════════════════════════════════════════════

/** Rounded rectangle path (cross-browser) */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}
function coverFit(img, tw, th, focusY = 0.3, crop) {
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

function createFadeMask(w, h, f) {
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

function drawRectSlot(ctx, img, slot, offset, crop) {
  const ox = offset?.dx||0, oy = offset?.dy||0;
  const { x:bx, y:by, w, h, fadeRight:fR=0, fadeLeft:fL=0, fadeTop:fT=0, fadeBottom:fB=0, border, borderWidth:bw=0 } = slot;
  const x = bx+ox, y = by+oy;
  const dw = border ? w-bw*2 : w, dh = border ? h-bw*2 : h;
  const dx = border ? x+bw : x, dy = border ? y+bw : y;
  if (border) { ctx.save(); ctx.fillStyle=border; ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=12; ctx.shadowOffsetY=4; ctx.fillRect(x,y,w,h); ctx.restore(); }
  const o = document.createElement('canvas'); o.width=dw; o.height=dh;
  const c = o.getContext('2d');
  const {sx,sy,sw,sh} = coverFit(img,dw,dh,0.3,crop);
  c.drawImage(img,sx,sy,sw,sh,0,0,dw,dh);
  if (!border && (fR||fL||fT||fB)) { const mask = createFadeMask(dw,dh,{right:fR,left:fL,top:fT,bottom:fB}); c.globalCompositeOperation='destination-in'; c.drawImage(mask,0,0); c.globalCompositeOperation='source-over'; }
  ctx.drawImage(o,dx,dy);
}

function drawCircleSlot(ctx, img, slot, offset, crop) {
  const ox = offset?.dx||0, oy = offset?.dy||0;
  const { x:bx, y:by, diameter:d, border='#fff', borderWidth:bw=4 } = slot;
  const x = bx+ox, y = by+oy, r = d/2, cx = x+r, cy = y+r;
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r+bw,0,Math.PI*2);
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=16; ctx.shadowOffsetY=4;
  ctx.fillStyle=border; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
  const {sx,sy,sw,sh} = coverFit(img,d,d,0.3,crop);
  ctx.drawImage(img,sx,sy,sw,sh,x,y,d,d); ctx.restore();
}

function drawTextSlot(ctx, ts, val, overrideBg, overrides) {
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
function drawBlurredBg(ctx, slotImages, template) {
  // Find best image for background: prefer 'main', fallback to first available
  const mainSlot = template.slots.find(sl => sl.id === 'main');
  const bgImg = slotImages['main'] || slotImages[template.slots[0]?.id];
  if (!bgImg) return;
  ctx.save();
  ctx.filter = 'blur(30px) brightness(0.3)';
  const { sx, sy, sw, sh } = coverFit(bgImg, W + 40, H + 40);
  ctx.drawImage(bgImg, sx, sy, sw, sh, -20, -20, W + 40, H + 40);
  ctx.filter = 'none';
  ctx.restore();
}

/** Draw text area background — solid rounded rect or gradient overlay */
function drawTextBg(ctx, tb) {
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
function getEffSlot(slot, scale) {
  const sc = scale || 1;
  if (sc === 1) return slot;
  if (slot.shape === 'circle') {
    const d = slot.diameter * sc;
    return { ...slot, x: slot.x + (slot.diameter - d)/2, y: slot.y + (slot.diameter - d)/2, diameter: d };
  }
  const sw = slot.w * sc, sh = slot.h * sc;
  return { ...slot, x: slot.x + (slot.w - sw)/2, y: slot.y + (slot.h - sh)/2, w: sw, h: sh };
}

// ═══════════════════════════════════════════════════════════
function TemplateThumbnail({ template, isActive, onClick }) {
  const sc = 72/W, th = H*sc;
  return (
    <button onClick={onClick} style={{ padding:0, border: isActive ? '2px solid #a3e635':'2px solid var(--border)', borderRadius:8, background:'#1a1a2e', cursor:'pointer', width:76, height:th+4, overflow:'hidden', transition:'all .15s', boxShadow: isActive ? '0 0 12px rgba(163,230,53,0.3)':'none', flexShrink:0 }}>
      <svg width={72} height={th} viewBox={`0 0 ${W} ${H}`}>
        <rect width={W} height={H} fill="#111"/>
        {template.slots.map(sl => sl.shape==='circle'
          ? <circle key={sl.id} cx={sl.x+sl.diameter/2} cy={sl.y+sl.diameter/2} r={sl.diameter/2} fill="none" stroke={sl.border||'#4FC3F7'} strokeWidth={14} opacity={0.7}/>
          : <rect key={sl.id} x={sl.x} y={sl.y} width={sl.w} height={sl.h} fill={sl.border||(sl.id==='main'?'#a3e635':'#556')} opacity={sl.id==='main'?0.4:0.25} stroke={sl.border||'none'} strokeWidth={sl.border?12:0}/>
        )}
      </svg>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════
export default function CoverPage() {
  const [templateId, setTemplateId] = useState('template_1');
  const [slotImages, setSlotImages] = useState({});
  const [slotOffsets, setSlotOffsets] = useState({});
  const [slotScales, setSlotScales] = useState({});
  const [slotCrops, setSlotCrops] = useState({}); // { slotId: { zoom: 1.2, panX: 0, panY: -1 } }
  const [textValues, setTextValues] = useState({});
  const [dragState, setDragState] = useState(null);
  const [downloaded, setDownloaded] = useState(false);
  const [hoverCursor, setHoverCursor] = useState('default');
  const [textBgColors, setTextBgColors] = useState({}); // override bg color per text slot
  const [textOverrides, setTextOverrides] = useState({}); // { lineId: { fontSize, color, dx, dy } }
  const [showGuide, setShowGuide] = useState(false);
  const canvasRef = useRef(null);
  const fileRefs = useRef({});

  // Dynamic template management
  const [templates, setTemplates] = useState([...BUILTIN_TEMPLATES]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // Load templates from API on mount
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const res = await fetch('/api/templates');
        const data = await res.json();
        if (data.success && data.templates?.length > 0) {
          // Filter only cover-format templates (have slots array with x/y/w/h)
          const coverTemplates = data.templates.filter(t => t.slots && t.slots.length > 0);
          setTemplates([...BUILTIN_TEMPLATES, ...coverTemplates]);
          if (coverTemplates.length > 0 && !BUILTIN_TEMPLATES.find(t => t.id === templateId)) {
            setTemplateId(coverTemplates[0].id);
          }
        }
      } catch (e) {
        console.warn('[CoverTester] Failed to load templates:', e.message);
      } finally {
        setLoadingTemplates(false);
      }
    };
    loadTemplates();
  }, []);

  // Upload new template via AI analyzer
  const handleUploadTemplate = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingTemplate(true);
    setUploadProgress('🔍 AI กำลังวิเคราะห์รูปแบบ...');
    try {
      // Convert to base64
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setUploadProgress('🧠 AI กำลังสร้างแทมเพลต... (ประมาณ 5-10 วินาที)');

      const res = await fetch('/api/template-analyzer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          templateName: file.name.replace(/\.[^.]+$/, ''),
          format: 'cover',
          autoSave: true,
        }),
      });
      const data = await res.json();

      if (data.success && data.template) {
        setTemplates(prev => [...prev, data.template]);
        setTemplateId(data.template.id);
        setUploadProgress('');
        // Clear slot images for new template
        setSlotImages({});
        setSlotOffsets({});
        setSlotScales({});
      } else {
        setUploadProgress('❌ ' + (data.error || 'วิเคราะห์ไม่สำเร็จ'));
        setTimeout(() => setUploadProgress(''), 3000);
      }
    } catch (err) {
      setUploadProgress('❌ ' + err.message);
      setTimeout(() => setUploadProgress(''), 3000);
    } finally {
      setUploadingTemplate(false);
      e.target.value = ''; // reset file input
    }
  };

  // Delete template
  const handleDeleteTemplate = async (id) => {
    if (!confirm('ลบแทมเพลตนี้?')) return;
    try {
      await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      setTemplates(prev => prev.filter(t => t.id !== id));
      if (templateId === id) {
        const remaining = templates.filter(t => t.id !== id);
        if (remaining.length > 0) setTemplateId(remaining[0].id);
      }
    } catch (e) {
      console.warn('Delete failed:', e.message);
    }
  };

  const template = templates.find(t => t.id === templateId);
  const allSlotsFilled = template ? template.slots.every(sl => slotImages[sl.id]) : false;
  const draggableSlots = template ? template.slots.filter(sl => sl.draggable) : [];
  const hasDraggables = draggableSlots.some(sl => slotImages[sl.id]);
  const hasOffsets = Object.values(slotOffsets).some(o => o.dx || o.dy);
  const hasScaleChanges = Object.values(slotScales).some(s => s !== 1 && s !== undefined);
  const [enhancing, setEnhancing] = useState({});
  const [enhanceResults, setEnhanceResults] = useState({}); // per-slot enhancement metadata

  // ── AI Enhance Image ──
  const enhanceSlotImage = async (slotId, forceScale) => {
    const img = slotImages[slotId];
    if (!img) return;
    setEnhancing(prev => ({ ...prev, [slotId]: true }));
    try {
      // Convert Image to base64
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const dataUrl = c.toDataURL('image/jpeg', 0.95);
      const base64 = dataUrl.split(',')[1];

      const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = forceScale || (maxDim < 400 ? 4 : 2);

      const res = await fetch('/api/assets/enhance-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64,
          mode: 'auto',
          upscale: scale,
          faceRestore: true,
          quality: 95,
        }),
      });
      const data = await res.json();
      if (data.success && data.data?.base64) {
        const enhanced = new Image();
        enhanced.onload = () => setSlotImages(prev => ({ ...prev, [slotId]: enhanced }));
        enhanced.src = `data:image/jpeg;base64,${data.data.base64}`;
        // Store enhancement metadata
        setEnhanceResults(prev => ({ ...prev, [slotId]: {
          enhancerUsed: data.data.enhancerUsed,
          originalResolution: data.data.originalResolution,
          enhancedResolution: data.data.enhancedResolution,
          sharpnessBefore: data.data.sharpnessBefore,
          sharpnessAfter: data.data.sharpnessAfter,
          similarityScore: data.data.similarityScore,
          qualityGain: data.data.qualityGain,
          processingTime: data.data.processingTime,
          rejected: data.data.rejected || false,
        }}));
        console.log(`[Cover] ✨ Enhanced ${slotId}: ${data.data.originalResolution} → ${data.data.enhancedResolution} (${data.data.enhancerUsed}) | similarity: ${data.data.similarityScore}%`);
      }
    } catch (e) {
      console.error(`[Cover] ❌ Enhance error:`, e);
    } finally {
      setEnhancing(prev => ({ ...prev, [slotId]: false }));
    }
  };

  // ── File upload (auto-enhance if small) ──
  const handleFile = (slotId, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setSlotImages(prev => ({ ...prev, [slotId]: img }));
        // Auto-enhance if image is too small for cover (< 600px)
        const maxDim = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
        if (maxDim > 0 && maxDim < 600) {
          console.log(`[Cover] ⚠️ Image ${slotId} is small (${img.naturalWidth}×${img.naturalHeight}) — auto-enhancing...`);
          // Slight delay so state updates first
          setTimeout(() => enhanceSlotImage(slotId), 100);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  const removeImage = (slotId) => {
    setSlotImages(prev => { const n = {...prev}; delete n[slotId]; return n; });
    if (fileRefs.current[slotId]) fileRefs.current[slotId].value = '';
  };

  // ── Scale controls ──
  const adjustScale = (slotId, delta) => {
    setSlotScales(prev => {
      const cur = prev[slotId] || 1;
      return { ...prev, [slotId]: Math.max(0.3, Math.min(2.5, +(cur + delta).toFixed(2))) };
    });
  };

  // ── Canvas coords ──
  const getCoords = (cx, cy) => {
    const c = canvasRef.current; if (!c) return {mx:0,my:0};
    const r = c.getBoundingClientRect();
    return { mx: (cx-r.left)*(W/r.width), my: (cy-r.top)*(H/r.height) };
  };

  // ── Hit test: draggable slots — 3 zones: corner=resize, border=move, center=crop ──
  const MOVE_BORDER = 25; // px border zone for move (smaller = more crop area)
  const hitTest = (mx, my) => {
    const sorted = [...draggableSlots].filter(sl => slotImages[sl.id]).sort((a,b) => (b.zIndex||0)-(a.zIndex||0));
    for (const slot of sorted) {
      const off = slotOffsets[slot.id] || {dx:0,dy:0};
      const eff = getEffSlot(slot, slotScales[slot.id]);
      const sx = eff.x + off.dx, sy = eff.y + off.dy;

      if (slot.shape === 'circle') {
        const r = eff.diameter/2, ecx = sx+r, ecy = sy+r;
        const dist = Math.hypot(mx-ecx, my-ecy);
        if (dist <= r + (slot.borderWidth||0)) {
          if (dist >= r - EDGE_RING) return { slot, mode: 'resize' };
          if (dist >= r * 0.55) return { slot, mode: 'move' };
          return { slot, mode: 'crop' };
        }
      } else {
        const ew = eff.w, eh = eff.h;
        if (mx >= sx && mx <= sx+ew && my >= sy && my <= sy+eh) {
          const nearL = mx - sx < HANDLE_SIZE, nearR = sx+ew - mx < HANDLE_SIZE;
          const nearT = my - sy < HANDLE_SIZE, nearB = sy+eh - my < HANDLE_SIZE;
          const nearCorner = (nearL || nearR) && (nearT || nearB);
          if (nearCorner) return { slot, mode: 'resize' };
          // Border zone = move, center = crop
          const inBorderL = mx - sx < MOVE_BORDER, inBorderR = sx+ew - mx < MOVE_BORDER;
          const inBorderT = my - sy < MOVE_BORDER, inBorderB = sy+eh - my < MOVE_BORDER;
          if (inBorderL || inBorderR || inBorderT || inBorderB) return { slot, mode: 'move' };
          return { slot, mode: 'crop' };
        }
      }
    }
    return null;
  };

  // ── Hit test TEXT slots (for drag) ──
  const hitTestText = (mx, my) => {
    if (!template?.textSlots?.length) return null;
    for (const ts of template.textSlots) {
      const ov = textOverrides[ts.id] || {};
      const tx = (ts.x || 0) + (ov.dx || 0);
      const ty = (ts.y || 0) + (ov.dy || 0);
      const fs = ov.fontSize || ts.fontSize || 40;
      const val = textValues[ts.id];
      if (!val) continue;
      // Approximate text bounding box
      const textW = Math.min(ts.maxWidth || 600, val.length * fs * 0.55);
      const textH = fs * 1.4;
      const left = (ts.align === 'center') ? tx - textW/2 : tx;
      const top = ty - fs * 0.3;
      if (mx >= left && mx <= left + textW && my >= top && my <= top + textH) {
        return ts;
      }
    }
    return null;
  };

  // ── Hit test ALL slots (for crop pan) ──
  const hitTestAll = (mx, my) => {
    if (!template) return null;
    const sorted = [...template.slots].filter(sl => slotImages[sl.id]).sort((a,b) => (b.zIndex||0)-(a.zIndex||0));
    for (const slot of sorted) {
      const off = slotOffsets[slot.id] || {dx:0,dy:0};
      const eff = getEffSlot(slot, slotScales[slot.id]);
      const sx = eff.x + off.dx, sy = eff.y + off.dy;
      if (slot.shape === 'circle') {
        const r = eff.diameter/2;
        if (Math.hypot(mx-(sx+r), my-(sy+r)) <= r + (slot.borderWidth||0)) return slot;
      } else {
        if (mx >= sx && mx <= sx+(eff.w||0) && my >= sy && my <= sy+(eff.h||0)) return slot;
      }
    }
    return null;
  };

  // ── Pointer handlers ──
  const handleDown = (cx, cy) => {
    const {mx,my} = getCoords(cx,cy);
    // First try text drag
    const textHit = hitTestText(mx, my);
    if (textHit) {
      const ov = textOverrides[textHit.id] || {};
      setDragState({ slotId: textHit.id, mode: 'textmove', startX: mx, startY: my, origDx: ov.dx || 0, origDy: ov.dy || 0 });
      return;
    }
    // Then try draggable slots (move/resize/crop)
    const hit = hitTest(mx,my);
    if (hit) {
      if (hit.mode === 'crop') {
        // Center of draggable slot → crop pan
        const crop = slotCrops[hit.slot.id] || { zoom: 1, panX: 0, panY: 0 };
        setDragState({ slotId: hit.slot.id, mode:'crop', startX:mx, startY:my, origPanX: crop.panX || 0, origPanY: crop.panY || 0 });
      } else {
        const off = slotOffsets[hit.slot.id] || {dx:0,dy:0};
        const sc = slotScales[hit.slot.id] || 1;
        const eff = getEffSlot(hit.slot, sc);
        if (hit.mode === 'resize') {
          const ecx = eff.x + off.dx + (eff.shape==='circle' ? eff.diameter/2 : eff.w/2);
          const ecy = eff.y + off.dy + (eff.shape==='circle' ? eff.diameter/2 : eff.h/2);
          const startDist = Math.hypot(mx-ecx, my-ecy);
          setDragState({ slotId: hit.slot.id, mode:'resize', startX:mx, startY:my, origDx:off.dx, origDy:off.dy, origScale:sc, startDist });
        } else {
          setDragState({ slotId: hit.slot.id, mode:'move', startX:mx, startY:my, origDx:off.dx, origDy:off.dy, origScale:sc, startDist:0 });
        }
      }
      return;
    }
    // Then try ANY slot for crop-pan
    const anySlot = hitTestAll(mx,my);
    if (anySlot) {
      const crop = slotCrops[anySlot.id] || { zoom: 1, panX: 0, panY: 0 };
      setDragState({ slotId: anySlot.id, mode:'crop', startX:mx, startY:my, origPanX: crop.panX || 0, origPanY: crop.panY || 0 });
    }
  };

  const handleMove = (cx, cy) => {
    const {mx,my} = getCoords(cx,cy);

    if (!dragState) {
      // Hover cursor — check text first
      const textHover = hitTestText(mx, my);
      if (textHover) {
        setHoverCursor('grab');
        return;
      }
      const hit = hitTest(mx,my);
      if (hit) {
        setHoverCursor(hit.mode === 'resize' ? 'nwse-resize' : hit.mode === 'crop' ? 'move' : 'grab');
      } else {
        const anySlot = hitTestAll(mx,my);
        setHoverCursor(anySlot ? 'move' : 'default');
      }
      return;
    }

    if (dragState.mode === 'textmove') {
      // Text drag — update dx, dy in textOverrides
      setTextOverrides(prev => ({
        ...prev,
        [dragState.slotId]: {
          ...(prev[dragState.slotId] || {}),
          dx: dragState.origDx + (mx - dragState.startX),
          dy: dragState.origDy + (my - dragState.startY),
        },
      }));
      return;
    }
    if (dragState.mode === 'crop') {
      // Direct pixel offset — drag = move image naturally
      const dx = mx - dragState.startX;
      const dy = my - dragState.startY;
      setSlotCrops(prev => {
        const old = prev[dragState.slotId] || { zoom: 1, panX: 0, panY: 0 };
        return { ...prev, [dragState.slotId]: {
          ...old,
          panX: (dragState.origPanX || 0) + dx,
          panY: (dragState.origPanY || 0) + dy,
        }};
      });
    } else if (dragState.mode === 'move') {
      setSlotOffsets(prev => ({
        ...prev,
        [dragState.slotId]: {
          dx: dragState.origDx + (mx - dragState.startX),
          dy: dragState.origDy + (my - dragState.startY),
        },
      }));
    } else {
      // Resize
      const slot = template.slots.find(sl => sl.id === dragState.slotId);
      const off = { dx: dragState.origDx, dy: dragState.origDy };
      const eff = getEffSlot(slot, dragState.origScale);
      const ecx = eff.x + off.dx + (eff.shape==='circle' ? eff.diameter/2 : eff.w/2);
      const ecy = eff.y + off.dy + (eff.shape==='circle' ? eff.diameter/2 : eff.h/2);
      const curDist = Math.hypot(mx-ecx, my-ecy);
      const ratio = dragState.startDist > 10 ? curDist / dragState.startDist : 1;
      const newScale = Math.max(0.3, Math.min(2.5, +(dragState.origScale * ratio).toFixed(2)));
      setSlotScales(prev => ({ ...prev, [dragState.slotId]: newScale }));
    }
  };

  const handleUp = () => setDragState(null);

  // ── Mouse wheel: smooth zoom in slot ──
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const {mx,my} = getCoords(e.clientX, e.clientY);
    const slot = hitTestAll(mx,my);
    if (!slot) return;
    // Smooth zoom — faster steps
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setSlotCrops(prev => {
      const old = prev[slot.id] || { zoom: 1, panX: 0, panY: 0 };
      const newZoom = Math.max(1, Math.min(5, old.zoom + delta));
      return { ...prev, [slot.id]: { ...old, zoom: newZoom } };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, slotImages, slotOffsets, slotScales]);

  // Native wheel listener with passive:false (React onWheel is passive)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const resetAll = () => { setSlotOffsets({}); setSlotScales({}); setSlotCrops({}); };

  // ── Render ──
  const render = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111119'; ctx.fillRect(0,0,W,H);
    if (!template) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('เลือกแทมเพลตเพื่อเริ่มต้น', W/2, H/2);
      return;
    }

    // Blurred background — fills gaps so no black areas when elements are moved/resized
    drawBlurredBg(ctx, slotImages, template);

    const sorted = [...template.slots].sort((a,b) => (a.zIndex||0)-(b.zIndex||0));

    // Pass 1: background + main images (zIndex < 3)
    for (const slot of sorted) {
      if ((slot.zIndex||0) >= 3) continue;
      const img = slotImages[slot.id]; if (!img) continue;
      const offset = slotOffsets[slot.id];
      const eff = getEffSlot(slot, slotScales[slot.id]);
      if (eff.shape === 'circle') drawCircleSlot(ctx, img, eff, offset, slotCrops[slot.id]);
      else drawRectSlot(ctx, img, eff, offset, slotCrops[slot.id]);
    }

    // Text background (dark banner or gradient)
    if (template.textBg) drawTextBg(ctx, template.textBg);

    // Text slots
    for (const ts of (template.textSlots||[])) drawTextSlot(ctx, ts, textValues[ts.id], textBgColors[ts.id], textOverrides[ts.id]);

    // Pass 2: top elements — circles, highlights (zIndex >= 3)
    for (const slot of sorted) {
      if ((slot.zIndex||0) < 3) continue;
      const img = slotImages[slot.id]; if (!img) continue;
      const offset = slotOffsets[slot.id];
      const eff = getEffSlot(slot, slotScales[slot.id]);
      if (eff.shape === 'circle') drawCircleSlot(ctx, img, eff, offset, slotCrops[slot.id]);
      else drawRectSlot(ctx, img, eff, offset, slotCrops[slot.id]);
    }

    // Empty state
    if (!Object.keys(slotImages).length) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(template.name, W/2, H/2-20);
      ctx.font = '24px sans-serif'; ctx.fillText('อัปโหลดรูปเพื่อดูตัวอย่าง', W/2, H/2+30);
    }

    // ── Draw resize handles on draggable elements ──
    for (const slot of draggableSlots) {
      if (!slotImages[slot.id]) continue;
      const off = slotOffsets[slot.id] || {dx:0,dy:0};
      const eff = getEffSlot(slot, slotScales[slot.id]);
      const sx = eff.x + off.dx, sy = eff.y + off.dy;
      const isActive = dragState?.slotId === slot.id;
      const handleColor = isActive ? 'rgba(163,230,53,0.9)' : 'rgba(255,255,255,0.5)';
      const hs = 10; // handle visual size

      ctx.save();
      if (slot.shape === 'circle') {
        // Small resize arrows at bottom-right of circle
        const r = eff.diameter/2;
        const cx = sx+r, cy = sy+r;
        const ax = cx + r*0.7, ay = cy + r*0.7;
        ctx.fillStyle = handleColor; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ax, ay, 8, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        // Arrows icon
        ctx.fillStyle = isActive ? '#000' : '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('↔', ax, ay);
      } else {
        // Corner handles for rectangle
        const ew = eff.w, eh = eff.h;
        const corners = [[sx,sy],[sx+ew,sy],[sx,sy+eh],[sx+ew,sy+eh]];
        for (const [hx,hy] of corners) {
          ctx.fillStyle = handleColor; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
          ctx.fillRect(hx-hs/2, hy-hs/2, hs, hs);
          ctx.strokeRect(hx-hs/2, hy-hs/2, hs, hs);
        }
      }

      // Dashed outline when active
      if (isActive) {
        ctx.strokeStyle = 'rgba(163,230,53,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([8,4]);
        if (slot.shape === 'circle') { const r = eff.diameter/2; ctx.beginPath(); ctx.arc(sx+r,sy+r,r+8,0,Math.PI*2); ctx.stroke(); }
        else ctx.strokeRect(sx-4, sy-4, eff.w+8, eff.h+8);
      }
      ctx.restore();
    }
  }, [slotImages, slotOffsets, slotScales, slotCrops, template, textValues, textBgColors, dragState, draggableSlots]);

  useEffect(() => { render(); }, [render]);

  // ── Download ──
  const handleDownload = () => {
    const canvas = canvasRef.current; if (!canvas || !template) return;
    // Render clean (no handles)
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111119'; ctx.fillRect(0,0,W,H);
    drawBlurredBg(ctx, slotImages, template);
    const sorted = [...template.slots].sort((a,b) => (a.zIndex||0)-(b.zIndex||0));
    // Pass 1: zIndex < 3
    for (const slot of sorted) {
      if ((slot.zIndex||0) >= 3) continue;
      const img = slotImages[slot.id]; if (!img) continue;
      const eff = getEffSlot(slot, slotScales[slot.id]);
      if (eff.shape === 'circle') drawCircleSlot(ctx, img, eff, slotOffsets[slot.id], slotCrops[slot.id]);
      else drawRectSlot(ctx, img, eff, slotOffsets[slot.id], slotCrops[slot.id]);
    }
    // TextBg
    if (template.textBg) drawTextBg(ctx, template.textBg);
    // Text
    for (const ts of (template.textSlots||[])) drawTextSlot(ctx, ts, textValues[ts.id], textBgColors[ts.id], textOverrides[ts.id]);
    // Pass 2: zIndex >= 3
    for (const slot of sorted) {
      if ((slot.zIndex||0) < 3) continue;
      const img = slotImages[slot.id]; if (!img) continue;
      const eff = getEffSlot(slot, slotScales[slot.id]);
      if (eff.shape === 'circle') drawCircleSlot(ctx, img, eff, slotOffsets[slot.id], slotCrops[slot.id]);
      else drawRectSlot(ctx, img, eff, slotOffsets[slot.id], slotCrops[slot.id]);
    }

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `cover_${template.name}_${Date.now()}.jpg`; a.click();
      URL.revokeObjectURL(url);
      setDownloaded(true); setTimeout(() => setDownloaded(false), 2500);
    }, 'image/jpeg', 0.95);
    // Re-render with handles after short delay
    setTimeout(render, 100);
  };

  const switchTemplate = (id) => { setTemplateId(id); setSlotOffsets({}); setSlotScales({}); };

  // Sort slots for UI
  const uiSlots = template ? [...template.slots].sort((a,b) => {
    const o = {main:0, sub_left:1, highlight:2, circle:3}; return (o[a.id]??5) - (o[b.id]??5);
  }) : [];

  return (
    <>
      <Header title="🖼️ ปกข่าว" subtitle="สร้างปกข่าว 1200×1350 — เลือกแทมเพลต อัปโหลดรูป ลากจัดตำแหน่ง ปรับขนาด" />

      {/* ===== HELP BUTTON + GUIDE ===== */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={() => setShowGuide(!showGuide)}
            style={{
              padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              border: `1px solid ${showGuide ? 'rgba(234,179,8,0.4)' : 'var(--border)'}`,
              background: showGuide ? 'rgba(234,179,8,0.1)' : 'rgba(255,255,255,0.04)',
              color: showGuide ? '#eab308' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.3s',
            }}
          >
            {showGuide ? '✕ ปิดคู่มือ' : '❓ วิธีใช้งาน'}
          </button>
        </div>

        {showGuide && (
          <div style={{
            marginBottom: 20, padding: 24, borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(234,179,8,0.05), rgba(249,115,22,0.05))',
            border: '1px solid rgba(234,179,8,0.15)',
            animation: 'fadeUp 0.3s ease-out both',
          }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 18 }}>
              📖 คู่มือการใช้งาน — แทมเพลตปก 14 แบบ
            </div>

            {/* Steps */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div style={{ padding: 16, borderRadius: 12, background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.12)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#eab308', marginBottom: 12 }}>🎯 ขั้นตอนการใช้</div>
                {[
                  { s: '1', t: 'เลือกแทมเพลตจาก 14 แบบ (แถบซ้าย)', i: '🖼️' },
                  { s: '2', t: 'อัปโหลดรูปตามช่อง (★ ภาพหลัก, 🖼 ฉากหลัง, ⭐ ไฮไลท์, ⭕ วงกลม)', i: '📤' },
                  { s: '3', t: 'ลากจัดตำแหน่งภาพ ⭐ และ ⭕ ได้อิสระ', i: '✋' },
                  { s: '4', t: 'ปรับขนาดภาพด้วย slider (50%–200%)', i: '🔍' },
                  { s: '5', t: 'พิมพ์ข้อความ (ถ้าแทมเพลตรองรับ)', i: '✏️' },
                  { s: '6', t: 'กด 📥 Download — ได้ภาพ 1200×1350px', i: '💾' },
                ].map(x => (
                  <div key={x.s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(234,179,8,0.08)' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(234,179,8,0.15)', color: '#eab308', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{x.s}</div>
                    <span style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.5 }}>{x.i} {x.t}</span>
                  </div>
                ))}
              </div>

              <div style={{ padding: 16, borderRadius: 12, background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.12)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#8b5cf6', marginBottom: 12 }}>📐 ประเภทแทมเพลต</div>
                {[
                  { cat: 'ฮีโร่ + กรอบ', ids: '1, 2, 4, 8, 10, 12, 14', color: '#FFD700' },
                  { cat: 'ฮีโร่ + วงกลม', ids: '3, 5', color: '#4FC3F7' },
                  { cat: 'ซ้อนภาพ + ข้อความ', ids: '6, 7, 9, 13', color: '#FFFFFF' },
                  { cat: 'ฮีโร่ + กรอบดำ', ids: '11', color: '#666' },
                ].map(c => (
                  <div key={c.cat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(139,92,246,0.08)' }}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, background: c.color, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{c.cat}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>แบบ {c.ids}</span>
                  </div>
                ))}
                <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(139,92,246,0.08)', fontSize: 11, color: '#a78bfa' }}>
                  💡 แทมเพลตที่มี 📝 ข้อความ: แบบ 6, 7, 8, 9, 13
                </div>
              </div>
            </div>

            {/* Slot types legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { icon: '★', label: 'ภาพหลัก', desc: 'รูปคนหลัก/เหตุการณ์หลัก', color: '#22c55e' },
                { icon: '🖼', label: 'ฉากหลัง', desc: 'ภาพประกอบเบลอด้านหลัง', color: '#3b82f6' },
                { icon: '⭐', label: 'ไฮไลท์', desc: 'กรอบสี ลากได้', color: '#FFD700' },
                { icon: '⭕', label: 'วงกลม', desc: 'รูปวงกลม ลากได้', color: '#4FC3F7' },
                { icon: '📝', label: 'ข้อความ', desc: 'พิมพ์ข้อความบนภาพ', color: '#f97316' },
                { icon: '🤖', label: 'AI Enhance', desc: 'ปรับภาพด้วย AI', color: '#8b5cf6' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, background: `${s.color}10`, border: `1px solid ${s.color}25`, fontSize: 11 }}>
                  <span>{s.icon}</span>
                  <span style={{ fontWeight: 700, color: s.color }}>{s.label}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>— {s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>

          {/* ═══ LEFT ═══ */}
          <div>
            {/* ── Template Selector ── */}
            <div style={s.card}>
              <div style={s.head}>
                ① เลือกแทมเพลต
                <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 'auto' }}>{templates.length} แบบ</span>
              </div>
              <div style={{ ...s.body, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {loadingTemplates ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, width: '100%' }}>⏳ กำลังโหลดแทมเพลต...</div>
                ) : templates.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', width: '100%' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🖼️</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>ยังไม่มีแทมเพลต — อัพโหลดรูปตัวอย่างเพื่อเริ่มต้น</div>
                  </div>
                ) : (
                  templates.map(t => (
                    <div key={t.id} style={{ textAlign: 'center', position: 'relative' }}>
                      <TemplateThumbnail template={t} isActive={templateId===t.id} onClick={() => switchTemplate(t.id)} />
                      <div style={{ fontSize: 10, color: templateId===t.id ? '#a3e635':'var(--text-muted)', marginTop: 4, fontWeight: 700 }}>{t.name}</div>
                      {t.source === 'ai_analyzed' && (
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id); }}
                          style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(239,68,68,0.8)', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: '18px', padding: 0 }}>×</button>
                      )}
                    </div>
                  ))
                )}
              </div>
              {/* Upload new template button */}
              <div style={{ padding: '8px 18px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '10px 16px', borderRadius: 10,
                  border: '2px dashed rgba(163,230,53,0.3)',
                  background: 'rgba(163,230,53,0.05)',
                  color: '#a3e635', fontSize: 12, fontWeight: 700,
                  cursor: uploadingTemplate ? 'wait' : 'pointer',
                  transition: 'all .15s',
                  opacity: uploadingTemplate ? 0.6 : 1,
                }}>
                  {uploadingTemplate ? uploadProgress : '➕ อัพโหลดแทมเพลตใหม่ (AI วิเคราะห์อัตโนมัติ)'}
                  <input type="file" accept="image/*" onChange={handleUploadTemplate} disabled={uploadingTemplate} style={{ display: 'none' }} />
                </label>
                {template && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>📐 {template.desc}</div>}
              </div>
            </div>

            {/* ── Image Upload ── */}
            <div style={s.card}>
              <div style={s.head}>② อัปโหลดรูป <span style={{ fontSize:10, fontWeight:400, color:'var(--text-muted)', marginLeft:'auto' }}>{template ? `${Object.keys(slotImages).filter(k => template.slots.some(sl => sl.id===k)).length}/${template.slots.length}` : '0/0'}</span></div>
              <div style={s.body}>
                {uiSlots.map(slot => (
                  <div key={slot.id} style={{ marginBottom: 16 }}>
                    <label style={s.label}>
                      {slot.label}
                      {slot.draggable && <span style={{ color:'#fbbf24', marginLeft:6, fontSize:10 }}>🔀 ลาก+ปรับขนาดได้</span>}
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <label style={{
                        flex:1, padding:'10px 14px', borderRadius:10,
                        border: slotImages[slot.id] ? '1px solid rgba(163,230,53,0.3)':'1px dashed var(--border)',
                        background: slotImages[slot.id] ? 'rgba(163,230,53,0.06)':'var(--bg-primary)',
                        color: slotImages[slot.id] ? '#a3e635':'var(--text-muted)',
                        fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'center', transition:'all .15s',
                      }}>
                        {slotImages[slot.id] ? `✅ ${slotImages[slot.id].naturalWidth}×${slotImages[slot.id].naturalHeight}` : '📷 เลือกรูป'}
                        <input type="file" accept="image/*" style={{display:'none'}}
                          ref={el => fileRefs.current[slot.id]=el}
                          onChange={e => handleFile(slot.id, e.target.files?.[0])} />
                      </label>
                      {slotImages[slot.id] && (
                        <>
                          <button
                            onClick={() => enhanceSlotImage(slot.id, 2)}
                            disabled={enhancing[slot.id]}
                            title="Enhance 2x — Real-ESRGAN"
                            style={{
                              padding:'8px 10px', borderRadius:10,
                              border:'1px solid rgba(168,85,247,0.3)',
                              background: enhancing[slot.id] ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.06)',
                              color:'#a855f7', fontSize:10, fontWeight:700,
                              cursor: enhancing[slot.id] ? 'wait' : 'pointer',
                              fontFamily:'inherit', opacity: enhancing[slot.id] ? 0.7 : 1,
                              animation: enhancing[slot.id] ? 'pulse 1.5s infinite' : 'none',
                            }}
                          >
                            {enhancing[slot.id] ? '⏳' : '2x'}
                          </button>
                          <button
                            onClick={() => enhanceSlotImage(slot.id, 4)}
                            disabled={enhancing[slot.id]}
                            title="Enhance 4x — Real-ESRGAN"
                            style={{
                              padding:'8px 10px', borderRadius:10,
                              border:'1px solid rgba(234,179,8,0.3)',
                              background:'rgba(234,179,8,0.06)',
                              color:'#eab308', fontSize:10, fontWeight:700,
                              cursor: enhancing[slot.id] ? 'wait' : 'pointer',
                              fontFamily:'inherit',
                            }}
                          >
                            4x
                          </button>
                          <button
                            onClick={() => enhanceSlotImage(slot.id)}
                            disabled={enhancing[slot.id]}
                            title="Auto Best — เลือก model อัตโนมัติ"
                            style={{
                              padding:'8px 10px', borderRadius:10,
                              border:'1px solid rgba(34,197,94,0.3)',
                              background:'rgba(34,197,94,0.06)',
                              color:'#22c55e', fontSize:10, fontWeight:700,
                              cursor: enhancing[slot.id] ? 'wait' : 'pointer',
                              fontFamily:'inherit',
                            }}
                          >
                            Auto
                          </button>
                          <button onClick={() => removeImage(slot.id)} style={{ padding:'8px 10px', borderRadius:10, border:'1px solid rgba(239,68,68,0.3)', background:'rgba(239,68,68,0.06)', color:'#f87171', fontSize:10, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
                        </>
                      )}
                    </div>
                    {/* Small image warning + enhancing status */}
                    {slotImages[slot.id] && (() => {
                      const iw = slotImages[slot.id].naturalWidth || 0;
                      const ih = slotImages[slot.id].naturalHeight || 0;
                      const maxDim = Math.max(iw, ih);
                      const isSmall = maxDim > 0 && maxDim < 600;
                      const isVerySmall = maxDim > 0 && maxDim < 300;
                      if (enhancing[slot.id]) {
                        return (
                          <div style={{ marginTop:4, padding:'6px 10px', borderRadius:8, background:'rgba(168,85,247,0.1)', border:'1px solid rgba(168,85,247,0.2)', fontSize:10, color:'#a855f7', fontWeight:600 }}>
                            ⏳ กำลังเพิ่มความชัดด้วย Real-ESRGAN... (อาจใช้เวลา 10-30 วินาที)
                          </div>
                        );
                      }
                      // Show enhancement results
                      const eResult = enhanceResults[slot.id];
                      if (eResult && !isSmall && !isVerySmall) {
                        return (
                          <div style={{ marginTop:4, padding:'8px 10px', borderRadius:8, background:'rgba(34,197,94,0.06)', border:'1px solid rgba(34,197,94,0.15)', fontSize:10, lineHeight:1.7 }}>
                            <div style={{ fontWeight:700, color:'#22c55e', marginBottom:2 }}>✅ Enhanced — {eResult.enhancerUsed}</div>
                            <div style={{ color:'var(--text-muted)' }}>
                              📐 {eResult.originalResolution} → <span style={{color:'#22c55e',fontWeight:700}}>{eResult.enhancedResolution}</span>
                              {' | '}
                              🔍 Sharpness: {eResult.sharpnessBefore} → {eResult.sharpnessAfter}
                              {' | '}
                              🎯 Similarity: <span style={{color: eResult.similarityScore >= 95 ? '#22c55e' : '#ef4444', fontWeight:700}}>{eResult.similarityScore}%</span>
                              {' | '}
                              ⏱ {eResult.processingTime}
                            </div>
                          </div>
                        );
                      }
                      if (isVerySmall) {
                        return (
                          <div style={{ marginTop:4, padding:'4px 10px', borderRadius:6, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)', fontSize:10, color:'#f87171', fontWeight:600 }}>
                            ⚠️ ภาพเล็กมาก ({iw}×{ih}) — กด ✨ เพิ่มความชัดก่อนทำปก!
                          </div>
                        );
                      }
                      if (isSmall) {
                        return (
                          <div style={{ marginTop:4, padding:'4px 10px', borderRadius:6, background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.2)', fontSize:10, color:'#fbbf24', fontWeight:600 }}>
                            ⚠️ ภาพเล็ก ({iw}×{ih}) — แนะนำกด ✨ เพิ่มความชัด
                          </div>
                        );
                      }
                      return null;
                    })()}
                    {/* Scale controls for draggable */}
                    {slot.draggable && slotImages[slot.id] && (
                      <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:8, padding:'6px 10px', background:'rgba(251,191,36,0.04)', borderRadius:8, border:'1px solid rgba(251,191,36,0.12)' }}>
                        <span style={{ fontSize:10, color:'#fbbf24', fontWeight:600, whiteSpace:'nowrap' }}>📐 ขนาด</span>
                        <button onClick={() => adjustScale(slot.id, -0.1)} style={s.scaleBtn}>−</button>
                        <div style={{ flex:1, textAlign:'center', fontSize:12, fontWeight:700, color:'var(--text-primary)', minWidth:40 }}>
                          {Math.round((slotScales[slot.id]||1)*100)}%
                        </div>
                        <button onClick={() => adjustScale(slot.id, 0.1)} style={s.scaleBtn}>+</button>
                        <button onClick={() => setSlotScales(prev => ({...prev,[slot.id]:1}))} style={{ ...s.scaleBtn, fontSize:10, width:36 }} title="รีเซ็ต">↺</button>
                      </div>
                    )}
                    {slotImages[slot.id] && (
                      <div style={{ marginTop:6, height:46, borderRadius:6, overflow:'hidden', background:'#111', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <img src={slotImages[slot.id].src} alt={slot.label} style={{ height:'100%', width:'auto', objectFit:'cover' }} />
                      </div>
                    )}
                    {/* ── Zoom + Crop Controls ── */}
                    {slotImages[slot.id] && (() => {
                      const crop = slotCrops[slot.id] || { zoom: 1, panX: 0, panY: 0 };
                      const isDefault = (!crop.zoom || crop.zoom <= 1) && !crop.panX && !crop.panY;
                      return (
                        <div style={{ marginTop:6, padding:'6px 10px', background:'rgba(59,130,246,0.04)', borderRadius:8, border:'1px solid rgba(59,130,246,0.12)' }}>
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            <span style={{ fontSize:10, color:'#60a5fa', fontWeight:600 }}>🔍</span>
                            <button onClick={() => setSlotCrops(prev => {
                              const old = prev[slot.id] || { zoom: 1, panX: 0, panY: 0 };
                              return { ...prev, [slot.id]: { ...old, zoom: Math.max(1, Math.round((old.zoom - 0.2) * 10) / 10) } };
                            })} style={s.scaleBtn}>−</button>
                            <div style={{ flex:1, textAlign:'center', fontSize:11, fontWeight:700, color: (crop.zoom||1) > 1 ? '#60a5fa' : 'var(--text-muted)' }}>
                              {(crop.zoom||1).toFixed(1)}x
                            </div>
                            <button onClick={() => setSlotCrops(prev => {
                              const old = prev[slot.id] || { zoom: 1, panX: 0, panY: 0 };
                              return { ...prev, [slot.id]: { ...old, zoom: Math.min(5, Math.round((old.zoom + 0.2) * 10) / 10) } };
                            })} style={s.scaleBtn}>+</button>
                            {!isDefault && (
                              <button onClick={() => setSlotCrops(prev => ({...prev, [slot.id]: { zoom: 1, panX: 0, panY: 0 }}))} style={{ ...s.scaleBtn, fontSize:10, width:28 }} title="รีเซ็ต">↺</button>
                            )}
                          </div>
                          <div style={{ fontSize:9, color:'var(--text-muted)', marginTop:4, textAlign:'center' }}>
                            🖱️ ลากบนปก = เลื่อนภาพ • Scroll = ซูม
                          </div>
                        </div>
                      );
                    })()}
                    {/* ── Position Offset Controls ── */}
                    {slotImages[slot.id] && (() => {
                      const off = slotOffsets[slot.id] || { dx: 0, dy: 0 };
                      const hasOff = off.dx || off.dy;
                      const moveSlot = (axis, delta) => {
                        setSlotOffsets(prev => {
                          const old = prev[slot.id] || { dx: 0, dy: 0 };
                          return { ...prev, [slot.id]: { ...old, [axis]: (old[axis] || 0) + delta } };
                        });
                      };
                      return (
                        <div style={{ marginTop:4, padding:'4px 10px', background:'rgba(251,191,36,0.04)', borderRadius:8, border:'1px solid rgba(251,191,36,0.12)', display:'flex', gap:4, alignItems:'center' }}>
                          <span style={{ fontSize:10, color:'#fbbf24', fontWeight:600, width:32 }}>📐</span>
                          <button onClick={() => moveSlot('dx', -30)} style={s.scaleBtn} title="เลื่อนซ้าย">◀</button>
                          <button onClick={() => moveSlot('dy', -30)} style={s.scaleBtn} title="เลื่อนขึ้น">▲</button>
                          <button onClick={() => moveSlot('dy', 30)} style={s.scaleBtn} title="เลื่อนลง">▼</button>
                          <button onClick={() => moveSlot('dx', 30)} style={s.scaleBtn} title="เลื่อนขวา">▶</button>
                          {hasOff && (
                            <>
                              <button onClick={() => setSlotOffsets(prev => ({...prev, [slot.id]: {dx:0,dy:0}}))} style={{...s.scaleBtn, fontSize:10, width:28}} title="รีเซ็ต">↺</button>
                              <span style={{ fontSize:9, color:'var(--text-muted)', marginLeft:2 }}>
                                X:{off.dx||0} Y:{off.dy||0}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Text Inputs ── */}
            {template?.textSlots?.length > 0 && (
              <div style={s.card}>
                <div style={s.head}>③ ใส่ข้อความ</div>
                <div style={s.body}>
                  {template.textSlots.map(ts => {
                    const ov = textOverrides[ts.id] || {};
                    const curSize = ov.fontSize || ts.fontSize || 42;
                    const curColor = ov.color || ts.color || '#FFD700';
                    return (
                    <div key={ts.id} style={{ marginBottom:14 }}>
                      <label style={s.label}>{ts.label}</label>
                      <input type="text" value={textValues[ts.id]||''} onChange={e => setTextValues(p => ({...p,[ts.id]:e.target.value}))}
                        placeholder={ts.placeholder||'พิมพ์ข้อความ...'} style={{
                          width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid var(--border)',
                          background:'var(--bg-primary)', color:curColor,
                          fontSize:13, fontFamily:'inherit', boxSizing:'border-box', outline:'none',
                        }} />
                      {/* Font Size + Text Color controls */}
                      <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:6, padding:'6px 10px', background:'rgba(163,230,53,0.04)', borderRadius:8, border:'1px solid rgba(163,230,53,0.12)', flexWrap:'wrap' }}>
                        <span style={{ fontSize:10, color:'#a3e635', fontWeight:600, whiteSpace:'nowrap' }}>🔤 ขนาด</span>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], fontSize: Math.max(20, curSize - 4)}}))} style={s.scaleBtn}>−</button>
                        <span style={{ fontSize:11, fontWeight:700, color:'var(--text-primary)', minWidth:30, textAlign:'center' }}>{curSize}</span>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], fontSize: Math.min(80, curSize + 4)}}))} style={s.scaleBtn}>+</button>
                        <span style={{ width:1, height:16, background:'var(--border)', margin:'0 4px' }} />
                        <span style={{ fontSize:10, color:'#a3e635', fontWeight:600, whiteSpace:'nowrap' }}>🎨 สี</span>
                        <input type="color" value={curColor}
                          onChange={e => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], color: e.target.value}}))}
                          style={{ width:24, height:24, border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', padding:0, background:'none' }} />
                      </div>
                      {/* Position controls */}
                      <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:4, padding:'6px 10px', background:'rgba(96,165,250,0.04)', borderRadius:8, border:'1px solid rgba(96,165,250,0.12)' }}>
                        <span style={{ fontSize:10, color:'#60a5fa', fontWeight:600, whiteSpace:'nowrap' }}>📍 ตำแหน่ง</span>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], dy: (ov.dy||0) - 30}}))} style={s.scaleBtn}>▲</button>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], dy: (ov.dy||0) + 30}}))} style={s.scaleBtn}>▼</button>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], dx: (ov.dx||0) - 30}}))} style={s.scaleBtn}>◀</button>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], dx: (ov.dx||0) + 30}}))} style={s.scaleBtn}>▶</button>
                        {(ov.dx || ov.dy) && <span style={{ fontSize:9, color:'var(--text-muted)' }}>x{ov.dx>0?'+':''}{ov.dx||0} y{ov.dy>0?'+':''}{ov.dy||0}</span>}
                        {(ov.fontSize || ov.color || ov.dx || ov.dy) && (
                          <button onClick={() => setTextOverrides(p => { const n={...p}; delete n[ts.id]; return n; })}
                            style={{ fontSize:10, padding:'2px 8px', borderRadius:4, border:'1px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer', fontFamily:'inherit', marginLeft:'auto' }}>↺ รีเซ็ต</button>
                        )}
                      </div>
                      {/* Color picker for editable bg */}
                      {(ts.bg || ts.bgEditable) && (
                        <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:4, padding:'6px 10px', background:'rgba(255,215,0,0.04)', borderRadius:8, border:'1px solid rgba(255,215,0,0.12)' }}>
                          <span style={{ fontSize:10, color:'#fbbf24', fontWeight:600, whiteSpace:'nowrap' }}>🎨 สีแถบ</span>
                          <input type="color" value={textBgColors[ts.id] || ts.bg || '#1a1a2e'}
                            onChange={e => setTextBgColors(p => ({...p,[ts.id]:e.target.value}))}
                            style={{ width:24, height:24, border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', padding:0, background:'none' }} />
                          <span style={{ fontSize:10, color:'var(--text-muted)', flex:1 }}>{textBgColors[ts.id] || ts.bg || 'default'}</span>
                          {textBgColors[ts.id] && (
                            <button onClick={() => setTextBgColors(p => { const n={...p}; delete n[ts.id]; return n; })}
                              style={{ fontSize:10, padding:'2px 8px', borderRadius:4, border:'1px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer', fontFamily:'inherit' }}>↺</button>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Drag/Resize hint ── */}
            {hasDraggables && (
              <div style={{ padding:'10px 14px', borderRadius:10, marginBottom:12, background:'rgba(251,191,36,0.06)', border:'1px solid rgba(251,191,36,0.2)', fontSize:11, color:'#fbbf24', lineHeight:1.7 }}>
                🔀 <strong>ลาก</strong>ตรงกลาง = ขยับ &nbsp;|&nbsp; ลาก<strong>ขอบ/มุม</strong> = ปรับขนาด
                {(hasOffsets || hasScaleChanges) && (
                  <button onClick={resetAll} style={{ display:'block', marginTop:6, padding:'4px 12px', borderRadius:6, border:'1px solid rgba(251,191,36,0.3)', background:'rgba(251,191,36,0.1)', color:'#fbbf24', fontSize:10, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>🔄 รีเซ็ตตำแหน่ง+ขนาดทั้งหมด</button>
                )}
              </div>
            )}

            {/* ── Download ── */}
            <button onClick={handleDownload} disabled={!allSlotsFilled} style={{
              width:'100%', padding:'16px', borderRadius:12, border:'none',
              background: allSlotsFilled ? 'linear-gradient(135deg,#a3e635,#059669)':'var(--bg-elevated)',
              color: allSlotsFilled ? '#000':'var(--text-muted)',
              fontWeight:900, fontSize:15, cursor: allSlotsFilled ? 'pointer':'not-allowed',
              fontFamily:'inherit', transition:'all .2s',
              boxShadow: allSlotsFilled ? '0 6px 25px rgba(163,230,53,0.25)':'none',
            }}>
              {downloaded ? '✅ ดาวน์โหลดแล้ว!' : `📥 ดาวน์โหลดปก (${W}×${H})`}
            </button>

            <div style={{ marginTop:12, padding:'12px 14px', background:'rgba(163,230,53,0.04)', borderRadius:10, fontSize:11, color:'var(--text-muted)', lineHeight:1.8 }}>
              💡 <strong style={{ color:'var(--text-secondary)' }}>วิธีใช้:</strong><br/>
              1. เลือกแทมเพลต (แบบ 1-{templates.length})<br/>
              2. อัปโหลดรูปแต่ละช่อง<br/>
              3. ลากตรงกลาง = ขยับ / ลากมุม = ปรับขนาด<br/>
              4. ใช้ปุ่ม +/− ปรับขนาดละเอียด<br/>
              5. กดดาวน์โหลด JPEG คุณภาพสูง
            </div>
          </div>

          {/* ═══ RIGHT: Canvas ═══ */}
          <div style={{ ...s.card, position: 'sticky', top: 70, alignSelf: 'start' }}>
            <div style={s.head}>
              ตัวอย่างปก
              <span style={{ fontSize:10, fontWeight:400, color:'var(--text-muted)', marginLeft:'auto' }}>{W}×{H}px • {template?.name || '—'}</span>
            </div>
            <div style={{ ...s.body, display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{
                borderRadius:12, overflow:'hidden',
                border: allSlotsFilled ? '2px solid #a3e635':'2px dashed rgba(255,255,255,0.08)',
                background:'#111119',
                cursor: dragState ? (dragState.mode==='resize' ? 'nwse-resize':'grabbing') : hoverCursor,
              }}>
                <canvas ref={canvasRef} width={W} height={H}
                  style={{ width:'100%', height:'auto', display:'block', touchAction:'none' }}
                  onMouseDown={e => handleDown(e.clientX, e.clientY)}
                  onMouseMove={e => handleMove(e.clientX, e.clientY)}
                  onMouseUp={handleUp} onMouseLeave={handleUp}
                  onTouchStart={e => { const t=e.touches[0]; handleDown(t.clientX, t.clientY); }}
                  onTouchMove={e => { e.preventDefault(); const t=e.touches[0]; handleMove(t.clientX, t.clientY); }}
                  onTouchEnd={handleUp}
                />
              </div>
              {/* Quick download + status */}
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <button onClick={handleDownload} disabled={!Object.keys(slotImages).length}
                  style={{
                    flex:1, padding:'10px 0', borderRadius:10, border:'none',
                    background: allSlotsFilled ? 'linear-gradient(135deg,#a3e635,#22c55e)' : 'rgba(163,230,53,0.15)',
                    color: allSlotsFilled ? '#000' : '#a3e635',
                    fontSize:13, fontWeight:800, cursor:'pointer', fontFamily:'inherit',
                    opacity: Object.keys(slotImages).length ? 1 : 0.4,
                    transition:'all .2s',
                  }}>
                  📥 {downloaded ? 'ดาวน์โหลดอีกครั้ง' : 'Download JPEG'}
                </button>
                <span style={{ fontSize:10, color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                  {template ? `${Object.keys(slotImages).filter(k => template.slots.some(sl => sl.id===k)).length}/${template.slots.length} รูป` : ''}
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
