'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';
// ★ 14 พ.ย. 69: ปรับแสง/สี/ความคม แบบคำนวณพิกเซลตรงๆ (ไม่มี AI เจนภาพ — หน้าคนเหมือนต้นฉบับ) แยกโมดูล
import { adjustCanvas, adjustKey, getAutoLevelsForImage, isNeutralAdjust, ADJUST_PRESETS } from '@/lib/cover-editor/imageAdjust';
import AdjustPanel from './AdjustPanel';

// ═══════════════════════════════════════════════════════════
const W = 1080, H = 1350;
const HANDLE_SIZE = 36; // corner handle hit zone (px in canvas space)
const EDGE_RING = 35;   // circle edge hit zone (px)

// ═══════════════════════════════════════════════════════════
// TEMPLATE DEFINITIONS
// ═══════════════════════════════════════════════════════════
// แทมเพลต builtin — วิเคราะห์จากตัวอย่างจริง (Layout: 4-quadrant)
// Canvas = 1080 x 1350 px (★ 14 ก.ค.: เปลี่ยนจาก 1200 → 1080 ขนาดโพสต์ FB/IG 4:5 จริง)
// แต่ละรูปครอบคลุม ~55-60% ของ canvas แล้ว fade เข้าหากัน ไม่มีจุดดำ
const BUILTIN_TEMPLATES = [
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

// ★ 14 ก.ค.: แปลงแทมเพลตเก่า (สเปซ 1200×1350 ก่อนย่อ canvas) → สเปซ W ปัจจุบัน ตอนโหลด
//   แทมเพลตใน Supabase ที่ไม่มี canvasW = เซฟสมัย canvas 1200 — สเกลแกนนอน ×(W/1200) แกนตั้งคงเดิม
//   ไม่เขียนกลับ DB — แปลงเฉพาะตอนโหลด (เว็บเวอร์ชันเก่าที่ยัง 1200 อ่านข้อมูลเดิมได้ไม่พัง)
const LEGACY_CANVAS_W = 1200;
function normalizeTemplateToCanvas(t) {
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

// ═══════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════
const s = {
  card: { background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, marginBottom: 16 },
  head: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 },
  body: { padding: 18 },
  label: { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 },
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

// 🩹 Safari/iOS บางรุ่นไม่รองรับ ctx.filter — ตรวจครั้งเดียว (ฝั่ง server ไม่มี document → false อัตโนมัติ)
const CANVAS_FILTER_OK = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    return typeof c.filter === 'string';
  } catch { return false; }
})();

// ★ 14 พ.ย. 69 (เพิ่มความเร็ว): แคชหน้ากากเฟด — เดิมสร้าง canvas ใหม่ทุกช่องทุกเฟรมตอนลาก
const _maskCache = new Map();
function createFadeMask(w, h, f) {
  const key = `${w}x${h}|${f.right || 0},${f.left || 0},${f.bottom || 0},${f.top || 0}`;
  const hit = _maskCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const m = c.getContext('2d');
  m.fillStyle = '#000'; m.fillRect(0, 0, w, h);
  m.globalCompositeOperation = 'destination-out';
  const grad = (x1,y1,x2,y2) => { const g = m.createLinearGradient(x1,y1,x2,y2); return g; };
  if (f.right > 0)  { const g = grad(w-f.right,0,w,0); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,1)'); m.fillStyle=g; m.fillRect(w-f.right,0,f.right,h); }
  if (f.left > 0)   { const g = grad(0,0,f.left,0);    g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)'); m.fillStyle=g; m.fillRect(0,0,f.left,h); }
  if (f.bottom > 0) { const g = grad(0,h-f.bottom,0,h); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,1)'); m.fillStyle=g; m.fillRect(0,h-f.bottom,w,f.bottom); }
  if (f.top > 0)    { const g = grad(0,0,0,f.top);      g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)'); m.fillStyle=g; m.fillRect(0,0,w,f.top); }
  if (_maskCache.size >= 40) _maskCache.clear();
  _maskCache.set(key, c);
  return c;
}

// ★ 14 พ.ย. 69 (เพิ่มความเร็ว): แคช "แผ่นภาพของช่อง" (ครอป+ปรับแสง+เฟดเสร็จแล้ว) ต่อช่อง
//   ลากช่องหนึ่ง = วาดใหม่เฉพาะช่องนั้น ช่องอื่นแค่แปะแผ่นเดิม · ย้ายตำแหน่งช่อง = ไม่ต้องประกอบใหม่เลย
const _imgIds = new WeakMap();
let _imgSeq = 0;
function imgUid(img) {
  let id = _imgIds.get(img);
  if (!id) { id = ++_imgSeq; _imgIds.set(img, id); }
  return id;
}
const _tileCache = new Map(); // slot.id → { key, canvas, mL, mT }
function tileStore(slotId, tile) {
  _tileCache.delete(slotId);
  _tileCache.set(slotId, tile);
  if (_tileCache.size > 14) _tileCache.delete(_tileCache.keys().next().value); // กันกินแรมเมื่อสลับแทมเพลตหลายแบบ
  return tile;
}
// ลูกเล่นระดับพิกเซลของช่อง: ขาวดำ (_gray) + ปรับแสง/สี/ความคม (_adj) — คีย์ไว้เทียบแคช
const slotFxKey = (slot) => `${slot._gray || 0}|${slot._adjKey || '0'}|${slot._lite && slot._adj?.sharpen ? 'L' : 'F'}`;
const slotHasFx = (slot) => (slot._gray > 0) || !!slot._adj;
function applySlotFx(canvas, img, slot) {
  if (!slotHasFx(slot)) return;
  adjustCanvas(canvas, slot._adj || null, {
    autoLevels: slot._adj?.auto ? getAutoLevelsForImage(img) : null,
    gray: slot._gray || 0,
    skipSharpen: !!slot._lite, // ระหว่างลากเลื่อนภาพ: ข้ามขั้นความคมให้ลื่น ปล่อยมือแล้วคมกลับ
  });
}

function getRectTile(img, slot, crop) {
  const { w, h, fadeRight:fR=0, fadeLeft:fL=0, fadeTop:fT=0, fadeBottom:fB=0, border, borderWidth:bw=0 } = slot;
  const dw = border ? w-bw*2 : w, dh = border ? h-bw*2 : h;

  // ★ 6 ก.ค. รอบ 4 (ผู้ใช้ชี้เป้าจากปกตัวอย่าง): โหมด "ละลายทับ" — เนื้อภาพคมทั้งใบ
  //   แต่ขยายภาพ "ลามออกนอกกรอบ" ด้านที่เลือก แล้วไล่ความใสเฉพาะส่วนที่ลาม
  //   → ส่วนที่ลามไปทับช่องข้างเคียง = สองภาพซ้อนจางเข้าหากันเนียนเป็นภาพเดียว (ไม่เบลอเนื้อภาพ)
  const me = (!border && slot._meltEdges && (slot._meltEdges.left || slot._meltEdges.right || slot._meltEdges.top || slot._meltEdges.bottom)) ? slot._meltEdges : null;
  const mpx = me ? Math.max(40, me.px || 200) : 0;
  // ★ รอบ 5: ละลาย "สมมาตร" — ครึ่งหนึ่งจางขอบตัวเอง (เห็นผลเสมอ) + อีกครึ่งลามทับเพื่อนบ้าน
  const ext = Math.round(mpx / 2); // ระยะลามออกนอกกรอบ
  const mL = me && me.left ? ext : 0, mR = me && me.right ? ext : 0, mT = me && me.top ? ext : 0, mB = me && me.bottom ? ext : 0;
  const ow = dw + mL + mR, oh = dh + mT + mB; // ขนาดผืนวาดจริง (รวมส่วนลาม)
  const be0 = slot._blurEdges;
  const be = (CANVAS_FILTER_OK && !border && !me && be0 && (be0.left || be0.right || be0.top || be0.bottom)) ? be0 : null;
  const {sx,sy,sw,sh} = coverFit(img,ow,oh,0.3,crop);

  const edgeKey = (e) => (e ? `${+!!e.left}${+!!e.right}${+!!e.top}${+!!e.bottom}:${e.px || 0}:${e.blur || 0}` : '-');
  const key = [imgUid(img), ow, oh, sx, sy, sw, sh, border ? 1 : 0, fR, fL, fT, fB, edgeKey(me), edgeKey(be), slotFxKey(slot)].join('|');
  const hit = _tileCache.get(slot.id);
  if (hit && hit.key === key) return hit;

  const o = document.createElement('canvas'); o.width=ow; o.height=oh;
  const c = o.getContext('2d', slotHasFx(slot) ? { willReadFrequently: true } : undefined);
  // ★ 6 ก.ค. (คุณภาพสูงสุด): ย่อ/ขยายภาพแบบเกรดสูง — ขอบคม ไม่หยาบ
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(img,sx,sy,sw,sh,0,0,ow,oh);
  // ★ 14 พ.ย. 69: ปรับแสง/สี/ความคม + ขาวดำรายช่อง (★ 4 ก.ค.) ที่ระดับพิกเซล — ทำ "ก่อน" ใส่หน้ากากเฟด
  //   (เดิมขาวดำใช้ ctx.filter ซึ่ง Safari/iOS ไม่มี → บนไอโฟนกดแล้วไม่ขึ้น · สูตรใหม่เท่ากับ grayscale() ของ CSS)
  applySlotFx(o, img, slot);
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
  if (be) {
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
  return tileStore(slot.id, { key, canvas: o, mL, mT });
}

function drawRectSlot(ctx, img, slot, offset, crop) {
  const ox = offset?.dx||0, oy = offset?.dy||0;
  const { x:bx, y:by, w, h, border, borderWidth:bw=0 } = slot;
  const x = bx+ox, y = by+oy;
  const dx = border ? x+bw : x, dy = border ? y+bw : y;
  if (border) { ctx.save(); ctx.fillStyle=border; ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=12; ctx.shadowOffsetY=4; ctx.fillRect(x,y,w,h); ctx.restore(); }
  const tile = getRectTile(img, slot, crop);
  ctx.drawImage(tile.canvas, dx - tile.mL, dy - tile.mT);
}

function drawCircleSlot(ctx, img, slot, offset, crop) {
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; // ★ คุณภาพสูงสุด
  const ox = offset?.dx||0, oy = offset?.dy||0;
  const { x:bx, y:by, diameter:d, border='#fff', borderWidth:bw=4 } = slot;
  const x = bx+ox, y = by+oy, r = d/2, cx = x+r, cy = y+r;
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r+bw,0,Math.PI*2);
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=16; ctx.shadowOffsetY=4;
  ctx.fillStyle=border; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
  const {sx,sy,sw,sh} = coverFit(img,d,d,0.3,crop);
  if (slotHasFx(slot)) {
    // ★ 14 พ.ย. 69: มีปรับแสง/ขาวดำ → ประกอบลงแผ่นย่อยก่อน (แคชไว้) แล้วค่อยแปะในวง
    const cw = Math.max(1, Math.round(d));
    const key = [imgUid(img), cw, sx, sy, sw, sh, slotFxKey(slot)].join('|');
    let tile = _tileCache.get(slot.id);
    if (!tile || tile.key !== key) {
      const o = document.createElement('canvas'); o.width = cw; o.height = cw;
      const c = o.getContext('2d', { willReadFrequently: true });
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(img,sx,sy,sw,sh,0,0,cw,cw);
      applySlotFx(o, img, slot);
      tile = tileStore(slot.id, { key, canvas: o, mL: 0, mT: 0 });
    }
    ctx.drawImage(tile.canvas, 0, 0, cw, cw, x, y, d, d);
  } else {
    ctx.drawImage(img,sx,sy,sw,sh,x,y,d,d);
  }
  ctx.restore();
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
// ★ 14 พ.ย. 69 (เพิ่มความเร็ว): เบลอ 30px ทั้งผืนแพงมาก เดิมทำซ้ำทุกเฟรม → ทำครั้งเดียวต่อรูปแล้วแคช
let _bgCache = null; // { id, canvas }
function drawBlurredBg(ctx, slotImages, template) {
  // Find best image for background: prefer 'main', fallback to first available
  const bgImg = slotImages['main'] || slotImages[template.slots[0]?.id];
  if (!bgImg) return;
  const id = imgUid(bgImg);
  if (!_bgCache || _bgCache.id !== id) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const b = c.getContext('2d');
    if (CANVAS_FILTER_OK) {
      const { sx, sy, sw, sh } = coverFit(bgImg, W + 40, H + 40);
      b.filter = 'blur(30px) brightness(0.3)';
      b.drawImage(bgImg, sx, sy, sw, sh, -20, -20, W + 40, H + 40);
      b.filter = 'none';
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
      b.imageSmoothingEnabled = true; b.imageSmoothingQuality = 'high';
      b.drawImage(stage2, -20, -20, W + 40, H + 40);
      b.fillStyle = 'rgba(0,0,0,0.7)';
      b.fillRect(0, 0, W, H);
    }
    _bgCache = { id, canvas: c };
  }
  ctx.drawImage(_bgCache.canvas, 0, 0);
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

// สรุปส่วนประกอบแทมเพลตเป็นป้ายสั้น (🖼️รูป ⭕วงกลม ⭐กรอบ 📝ข้อความ)
function templateBadges(t) {
  const slots = t.slots || [];
  const circles = slots.filter((sl) => sl.shape === 'circle').length;
  const frames = slots.filter((sl) => sl.border && sl.shape !== 'circle').length;
  const texts = (t.textSlots || []).length;
  const parts = [`🖼️${slots.length}`];
  if (circles) parts.push(`⭕${circles}`);
  if (frames) parts.push(`⭐${frames}`);
  if (texts) parts.push(`📝${texts}`);
  return parts.join(' ');
}

// ชื่อไฟล์ดิบจากการอัปโหลด (ตัวเลข/ขีดล่างยาว) → ชื่ออ่านง่าย
function tidyTemplateName(t, idx) {
  const n = (t.name || '').trim();
  if (!n || /^[\d_()\s.\-]+$/.test(n) || /^\d{6,}/.test(n)) return `แทมเพลตอัปโหลด #${idx + 1}`;
  return n;
}

// ═══════════════════════════════════════════════════════════
function TemplateThumbnail({ template, isActive, onClick }) {
  const sc = 72/W, th = H*sc;
  return (
    <button onClick={onClick} style={{ padding:0, border: isActive ? '2px solid #60a5fa':'2px solid var(--border)', borderRadius:8, background:'#1a1a2e', cursor:'pointer', width:76, height:th+4, overflow:'hidden', transition:'all .15s', boxShadow: isActive ? '0 0 12px rgba(96,165,250,0.3)':'none', flexShrink:0 }}>
      <svg width={72} height={th} viewBox={`0 0 ${W} ${H}`}>
        <rect width={W} height={H} fill="#111"/>
        {template.slots.map(sl => sl.shape==='circle'
          ? <circle key={sl.id} cx={sl.x+sl.diameter/2} cy={sl.y+sl.diameter/2} r={sl.diameter/2} fill="none" stroke={sl.border||'#4FC3F7'} strokeWidth={14} opacity={0.7}/>
          : <rect key={sl.id} x={sl.x} y={sl.y} width={sl.w} height={sl.h} fill={sl.border||(sl.id==='main'?'#60a5fa':'#556')} opacity={sl.id==='main'?0.4:0.25} stroke={sl.border||'none'} strokeWidth={sl.border?12:0}/>
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
  // ★ 14 พ.ย. 69: เก็บสถานะลากใน ref คู่กับ state — ตัวจับเมาส์/นิ้วอ่านค่าล่าสุดได้ทันที ไม่ต้องรอ React วาดรอบใหม่
  //   (เดิม: เฟรมแรกๆ ของการลากหลุด เพราะ handleMove ยังเห็น dragState=null ของรอบ render ก่อน — เครื่องช้า/มือถืออาการชัด)
  const dragRef = useRef(null);
  const setDrag = (v) => { dragRef.current = v; setDragState(v); };
  const [downloaded, setDownloaded] = useState(false);
  const [hoverCursor, setHoverCursor] = useState('default');
  const [textBgColors, setTextBgColors] = useState({}); // override bg color per text slot
  const [textOverrides, setTextOverrides] = useState({}); // { lineId: { fontSize, color, dx, dy } }
  const [showGuide, setShowGuide] = useState(false);
  // ★ แบตช์ E: โหมด recipe — เปิดงานคิวปก MEGA มาจัดต่อ (?recipe=MG-xxxx)
  const [recipeMode, setRecipeMode] = useState(null);    // jobId หรือ null (หน้าเดิม)
  const [recipe, setRecipe] = useState(null);            // ข้อมูลสูตรจาก /api/mega/recipe
  const [recipeStatus, setRecipeStatus] = useState('');  // ข้อความสถานะโหลด/ผิดพลาด
  const [savingCover, setSavingCover] = useState(false);
  const [saveToast, setSaveToast] = useState(null);      // { ok, msg, id }
  // ★ E3 (E3a/E3b): พูลรูปรวม — ใช้ได้ทุกโหมด (recipe auto-load เดิม + ดึงจากเคส MEGA)
  //   เก็บพูลเป็น state เดียว {id,url,thumb,person,note} ให้ทั้งแถบล่างโหมด recipe + modal เลือกรูปใช้ร่วมกัน
  const [pool, setPool] = useState([]);                  // พูลรูปที่โหลดไว้ (จากเคส) — ว่าง = ใช้ recipe.pool
  const [poolCaseName, setPoolCaseName] = useState('');  // ป้ายชื่อแหล่งพูลที่โหลด (โชว์บนแถบ E3a)
  const [caseList, setCaseList] = useState(null);        // รายชื่อเคส (null=ยังไม่โหลด lazy)
  const [caseListLoading, setCaseListLoading] = useState(false);
  const [caseListErr, setCaseListErr] = useState('');
  const [casePickerOpen, setCasePickerOpen] = useState(false); // เปิด dropdown เลือกเคส
  const [poolLoading, setPoolLoading] = useState(false); // กำลังดึงคลังภาพเคส
  const [pickerSlotId, setPickerSlotId] = useState(null); // ช่องที่เปิด modal เลือกรูปอยู่ (null=ปิด)
  const canvasRef = useRef(null);
  const fileRefs = useRef({});
  const mountedRef = useRef(true);                       // กัน setState หลัง unmount (งาน async E3a)

  // ★ 4 ก.ค. (ผู้ใช้สั่ง "มือถือใช้ง่ายสุด เห็นทุกฟังก์ชัน"): จอเล็กเรียงคอลัมน์เดียว + เลือกช่องแล้วแต่งจากแผงรวมใต้ปก
  const [isMobile, setIsMobile] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  // ★ 4 ก.ค. รอบ 2 (ผู้ใช้สั่ง 4 ฟีเจอร์): เฟดเลือกได้ / วง-กรอบแดงเน้นจุด / สีขอบช่อง / โทนไว้อาลัยขาวดำ
  // ★ 6 ก.ค. รอบ 2 (ผู้ใช้สั่ง): เฟดรายขอบอิสระทุกช่องทุกแทมเพลต — ไม่ผูกกับค่าเฟดเดิมของแทมเพลต
  //   slotFadeEdges[slotId] = { left,right,top,bottom: bool, px: ความหนา } — ไม่มี entry = ตามแทมเพลต×ระดับรวม
  const [slotFadeEdges, setSlotFadeEdges] = useState({});
  const [fadeAllOff, setFadeAllOff] = useState(false);      // ปิดเฟดทั้งใบ
  const [fadeAllLevel, setFadeAllLevel] = useState(100);    // ★ 6 ก.ค. ระดับเฟดทั้งใบ % (ช่องที่ตั้งขอบเองไม่ถูกทับ)

  // ค่าตั้งต้นของตัวแก้เฟดรายขอบ: ช่องที่ยังไม่ปรับ = ตามแทมเพลต (ขอบไหนมีเฟด = ติ๊กอยู่)
  const fadeEdgesOf = (sl) => {
    const ov = slotFadeEdges[sl.id];
    if (ov) return ov;
    return {
      left: !!sl.fadeLeft, right: !!sl.fadeRight, top: !!sl.fadeTop, bottom: !!sl.fadeBottom,
      px: Math.max(sl.fadeLeft || 0, sl.fadeRight || 0, sl.fadeTop || 0, sl.fadeBottom || 0) || 300,
    };
  };

  // ตัวแก้เฟดรายขอบ (ใช้ซ้ำทั้งรายการช่องซ้าย + แผงใต้ปก) — ทุกช่องสี่เหลี่ยมทุกแทมเพลต
  const renderFadeEdges = (sl) => {
    if (sl.shape === 'circle') return null;
    const fe = fadeEdgesOf(sl);
    const btn = { padding: '7px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' };
    const setEdge = (edge) => setSlotFadeEdges(p => {
      const cur = p[sl.id] || fadeEdgesOf(sl);
      return { ...p, [sl.id]: { ...cur, [edge]: !cur[edge] } };
    });
    const chip = (edge, label) => (
      <button key={edge} onClick={() => setEdge(edge)}
        style={{ ...btn,
          color: fe[edge] ? '#60a5fa' : 'var(--text-muted)',
          background: fe[edge] ? 'rgba(96,165,250,0.12)' : 'var(--bg-primary)',
          border: `1px solid ${fe[edge] ? 'rgba(96,165,250,0.5)' : 'var(--border)'}` }}>
        {label}
      </button>
    );
    const anyOn = fe.left || fe.right || fe.top || fe.bottom;
    const mode = fe.mode || 'fade';
    const setMode = (m) => setSlotFadeEdges(p => {
      const cur = p[sl.id] || fadeEdgesOf(sl);
      return { ...p, [sl.id]: { ...cur, mode: m } };
    });
    const modeChip = (m, label, title) => (
      <button key={m} onClick={() => setMode(m)} title={title}
        style={{ ...btn,
          color: mode === m ? '#facc15' : 'var(--text-muted)',
          background: mode === m ? 'rgba(250,204,21,0.1)' : 'var(--bg-primary)',
          border: `1px solid ${mode === m ? 'rgba(250,204,21,0.5)' : 'var(--border)'}` }}>
        {label}
      </button>
    );
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>🌫️ ขอบภาพ</span>
        {chip('left', '◀ ซ้าย')}
        {chip('right', 'ขวา ▶')}
        {chip('top', '▲ บน')}
        {chip('bottom', 'ล่าง ▼')}
        {anyOn && (
          <>
            {modeChip('melt', '🫠 ละลายทับ', 'ภาพคมทั้งใบ แต่ลามออกทับช่องข้างเคียงแล้วจางเข้าหากัน = สองภาพหลอมเป็นภาพเดียว (แบบปกแสนไลค์)')}
            {modeChip('blur', '💧 เบลอฟุ้ง', 'ขอบภาพถูกเบลอฟุ้งไล่เข้าใน')}
            {modeChip('fade', '🌫️ จางใส', 'ขอบค่อยๆ จางหายเป็นใส (แบบแทมเพลตเดิม)')}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>บาง</span>
            <input type="range" min="40" max="600" step="20" value={fe.px}
              onChange={e => setSlotFadeEdges(p => {
                const cur = p[sl.id] || fadeEdgesOf(sl);
                return { ...p, [sl.id]: { ...cur, px: Number(e.target.value) } };
              })}
              style={{ width: 100 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>หนา</span>
            <span style={{ fontSize: 12, fontWeight: 800, minWidth: 42, color: slotFadeEdges[sl.id] ? '#60a5fa' : 'var(--text-muted)' }}>{fe.px}px</span>
            {/* ★ 6 ก.ค. รอบ 4 (ผู้ใช้ขอ): ความแรงเบลอปรับแยกจากระยะ — โชว์เฉพาะโหมดเบลอละลาย */}
            {mode === 'blur' && (
              <>
                <span style={{ fontSize: 12, color: '#facc15', fontWeight: 700, marginLeft: 4 }}>💧 แรงเบลอ</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>เบา</span>
                <input type="range" min="2" max="80" step="2"
                  value={fe.blur || Math.min(80, Math.max(2, Math.round((fe.px || 200) / 6)))}
                  onChange={e => setSlotFadeEdges(p => {
                    const cur = p[sl.id] || fadeEdgesOf(sl);
                    return { ...p, [sl.id]: { ...cur, blur: Number(e.target.value) } };
                  })}
                  style={{ width: 90 }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>แรง</span>
                <span style={{ fontSize: 12, fontWeight: 800, minWidth: 34, color: fe.blur ? '#facc15' : 'var(--text-muted)' }}>
                  {fe.blur || Math.min(80, Math.max(2, Math.round((fe.px || 200) / 6)))}
                </span>
              </>
            )}
          </>
        )}
        {slotFadeEdges[sl.id] && (
          <button onClick={() => setSlotFadeEdges(p => { const n = { ...p }; delete n[sl.id]; return n; })}
            title="กลับค่าแทมเพลต" style={{ ...btn, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>↺</button>
        )}
      </div>
    );
  };
  const [slotBorderColors, setSlotBorderColors] = useState({}); // slotId → สีขอบ override
  // ★ 14 พ.ย. 69: ปรับแสง/สี/ความคมรายช่อง (สูตรพิกเซลล้วน ไม่มี AI เจนภาพ) — slotAdjust[slotId] = { auto, brightness, ... }
  const [slotAdjust, setSlotAdjust] = useState({});
  const [compareOriginal, setCompareOriginal] = useState(false); // กดค้าง = ดูภาพก่อนปรับ
  const [adjLite, setAdjLite] = useState(false);                 // กำลังเลื่อนสไลเดอร์ปรับภาพ (พักขั้นความคมชั่วคราว)
  const adjLiteTimerRef = useRef(null);
  const [notice, setNotice] = useState(null);                    // แถบแจ้งเตือนสั้นๆ { msg, kind }
  const noticeTimerRef = useRef(null);
  const showNotice = (msg, kind = 'info') => {
    setNotice({ msg, kind });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 4200);
  };
  const [isWide, setIsWide] = useState(false);                   // จอกว้าง ≥1280: เครื่องมืออยู่ข้างปก ไม่ต้องเลื่อนลงไปหา
  const [dropActive, setDropActive] = useState(false);           // กำลังลากไฟล์มาเหนือปก
  const toolsRef = useRef(null);                                 // แผงเครื่องมือของช่องที่เลือก (ไว้เลื่อนจอไปหา)
  const liveRef = useRef({});                                    // ตัวชี้ฟังก์ชันรุ่นล่าสุด ให้ listener ระดับ window เรียก
  const [slotGray, setSlotGray] = useState({});             // slotId → 0..1 ขาวดำรายช่อง
  const [grayAll, setGrayAll] = useState(0);                // 0..1 ขาวดำทั้งใบ (โทนไว้อาลัย)
  const [markers, setMarkers] = useState([]);               // วง/กรอบแดงเน้นจุด [{id,type,x,y,w,h,color,width}]
  const [selectedMarkerId, setSelectedMarkerId] = useState(null);
  const touchScaleRef = useRef(1);  // canvas จริง (W) / ที่แสดงบนจอ — ใช้ขยาย hit zone ให้นิ้วจับถูกบนจอเล็ก
  const pinchRef = useRef(null);    // สถานะจีบ 2 นิ้ว (ซูมภาพในช่อง)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const apply = () => { setIsMobile(mq.matches || window.innerWidth <= 768); setIsWide(window.innerWidth >= 1280); };
    apply();
    mq.addEventListener('change', apply);
    window.addEventListener('resize', apply); // กันเคส matchMedia change ไม่ยิง (emulation/หมุนจอ/พับจอ)
    return () => { mq.removeEventListener('change', apply); window.removeEventListener('resize', apply); };
  }, []);

  // ★ E3: ตั้งธง mounted — งาน async ของ E3a เช็คก่อน setState ทุกครั้ง (กัน setState หลัง unmount)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (adjLiteTimerRef.current) clearTimeout(adjLiteTimerRef.current);
    };
  }, []);

  // ★ E3b: ล็อกสกอลล์ตัวหน้าเมื่อเปิด modal เลือกรูป + ปิดด้วย Esc + คืนค่าตอนปิด/unmount
  //   (hook เรียกทุกครั้งเสมอ เงื่อนไขอยู่ข้างใน — ไม่ผิดกติกา hooks)
  useEffect(() => {
    if (pickerSlotId == null) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setPickerSlotId(null); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener('keydown', onKey); };
  }, [pickerSlotId]);

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
          const coverTemplates = data.templates.filter(t => t.slots && t.slots.length > 0).map(normalizeTemplateToCanvas);
          // ★ แบตช์ E: คงแทมเพลต recipe-* ที่ hydrate ฉีดไว้ (กันโดน replace ทับหาย) — ไม่มี recipe = ผลเหมือนเดิมเป๊ะ
          setTemplates(prev => [...BUILTIN_TEMPLATES, ...coverTemplates, ...prev.filter(t => String(t.id).startsWith('recipe-'))]);
          // ★ แบตช์ E: อย่าสลับทับถ้าอยู่โหมด recipe (templateId ขึ้นต้น recipe-)
          if (coverTemplates.length > 0 && !String(templateId).startsWith('recipe-') && !BUILTIN_TEMPLATES.find(t => t.id === templateId)) {
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
        setTemplates(prev => [...prev, normalizeTemplateToCanvas(data.template)]);
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
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      // ★ 14 พ.ย. 69: เดิมลบออกจากจอทั้งที่ server ปฏิเสธ → รีเฟรชแล้วแทมเพลตกลับมา (ดูเหมือนลบไม่ติด)
      if (!res.ok) { showNotice(`ลบแทมเพลตไม่สำเร็จ (${res.status}) — ลองใหม่`, 'error'); return; }
      setTemplates(prev => prev.filter(t => t.id !== id));
      if (templateId === id) {
        const remaining = templates.filter(t => t.id !== id);
        if (remaining.length > 0) setTemplateId(remaining[0].id);
      }
    } catch (e) {
      console.warn('Delete failed:', e.message);
      showNotice('ลบแทมเพลตไม่สำเร็จ: ' + e.message, 'error');
    }
  };

  // เปลี่ยนชื่อแทมเพลตอัปโหลด (เก็บถาวรผ่าน PATCH /api/templates/[id])
  const handleRenameTemplate = async (t) => {
    const name = prompt('ตั้งชื่อแทมเพลตนี้', t.name || '');
    if (!name || !name.trim() || name === t.name) return;
    try {
      const res = await fetch(`/api/templates/${t.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (data.success) setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, name: name.trim() } : x));
      else alert('ตั้งชื่อไม่สำเร็จ: ' + (data.error || ''));
    } catch (e) {
      alert('ตั้งชื่อไม่สำเร็จ: ' + e.message);
    }
  };

  const template = templates.find(t => t.id === templateId);
  const allSlotsFilled = template ? template.slots.every(sl => slotImages[sl.id]) : false;
  const draggableSlots = template ? template.slots.filter(sl => sl.draggable) : [];
  const hasDraggables = draggableSlots.some(sl => slotImages[sl.id]);
  const hasOffsets = Object.values(slotOffsets).some(o => o.dx || o.dy);
  const hasScaleChanges = Object.values(slotScales).some(s => s !== 1 && s !== undefined);
  // ★ 14 พ.ย. 69: ถอดปุ่ม "AI Enhance 2x/4x/Auto" (Real-ESRGAN + face-restore ผ่าน /api/assets/enhance-image) ออกจากหน้านี้
  //   เหตุผล: เป็นโมเดลเจนที่ "วาดรายละเอียดใหม่" = ต้นเหตุหน้าคนเพี้ยน (บทเรียน 10 ก.ค. 69) + ช้า 10-30 วิ + มีค่า API
  //   แทนด้วยแผง 🎨 ปรับแสง/สี/ความคม (AdjustPanel) ที่คำนวณพิกเซลเดิมตรงๆ เห็นผลทันที — ตัว API เดิมไม่ได้ถูกแตะ

  // ── วางรูปลงช่อง (ทางเดียวที่ทุกแหล่งรูปใช้ร่วมกัน: อัปโหลด/ลากวาง/วางจากคลิปบอร์ด/ถาด/คลังเคส) ──
  // คืนหน่วยความจำของไฟล์ที่อัปโหลด: รูปไหน "หลุดออกจากทุกช่อง" (ถูกแทน/ลบ/ล้าง) → ปล่อย object URL ของรูปนั้น
  const prevImagesRef = useRef({});
  useEffect(() => {
    const live = new Set(Object.values(slotImages));
    for (const img of Object.values(prevImagesRef.current)) {
      if (live.has(img)) continue;
      try { if (img && typeof img.src === 'string' && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); } catch { /* เงียบ */ }
    }
    prevImagesRef.current = slotImages;
  }, [slotImages]);
  const placeImage = (slotId, img) => {
    setSlotImages(prev => ({ ...prev, [slotId]: img }));
    // รูปใหม่ = เริ่มครอป/การปรับภาพใหม่ (เดิม: อัปโหลดทับแล้วค่าเลื่อนภาพของรูปเก่าค้าง → รูปใหม่โผล่เบี้ยว)
    setSlotCrops(p => ({ ...p, [slotId]: { zoom: 1, panX: 0, panY: 0 } }));
    setSlotAdjust(p => { if (!p[slotId]) return p; const n = { ...p }; delete n[slotId]; return n; });
    setSelectedSlotId(slotId);
  };
  // ไฟล์ → Image ผ่าน object URL (เดิมแปลงเป็น base64 ทั้งไฟล์: รูปมือถือ 10MB กินแรมหลายเท่าและหน่วง)
  const loadFileImage = (file) => new Promise((resolve, reject) => {
    if (!file || (file.type && !file.type.startsWith('image/'))) { reject(new Error('NOT_IMAGE')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('DECODE_FAILED')); };
    img.src = url;
  });
  const fileErrorText = (e) => (e?.message === 'NOT_IMAGE'
    ? 'ไฟล์นี้ไม่ใช่รูปภาพ — เลือกไฟล์ JPG / PNG / WEBP'
    : 'เปิดรูปนี้ไม่ได้ (ไฟล์เสียหรือชนิดไม่รองรับ) — ลองบันทึกเป็น JPG/PNG แล้วอัปโหลดใหม่');

  // ── File upload ──
  //   ★ 6 ก.ค. (ผู้ใช้สั่ง): ห้าม AI แตะภาพเองทุกกรณี — ภาพที่อัปโหลดต้องเป็นต้นฉบับตรงๆ (ยังคงเดิม)
  const handleFile = async (slotId, file) => {
    if (!file) return;
    try { placeImage(slotId, await loadFileImage(file)); }
    catch (e) { showNotice(fileErrorText(e), 'error'); }
  };
  // ★ 14 พ.ย. 69: หลายรูปทีเดียว — ลงช่องที่ชี้ (ถ้ามี) แล้วเติมช่องว่างตามลำดับ
  const handleFiles = async (fileList, preferSlotId) => {
    const files = Array.from(fileList || []).filter(f => f && (!f.type || f.type.startsWith('image/')));
    if (!files.length) { showNotice('ไม่พบไฟล์รูปภาพ', 'error'); return; }
    if (!template) return;
    const cur = slotImages;
    const order = [...template.slots].sort((a, b) => {
      const o = { main: 0, sub_left: 1, highlight: 2, circle: 3 }; return (o[a.id] ?? 5) - (o[b.id] ?? 5);
    }).map(sl => sl.id);
    const empties = order.filter(id => !cur[id] && id !== preferSlotId);
    let targets;
    // รูปเดียว: ช่องที่ชี้ → ช่องที่เลือกอยู่ถ้ายังว่าง → ช่องว่างช่องแรก → (เต็มหมดแล้ว) เปลี่ยนรูปช่องที่เลือก
    if (files.length === 1) targets = [preferSlotId || (selectedSlotId && !cur[selectedSlotId] ? selectedSlotId : null) || empties[0] || selectedSlotId || order[0]];
    else targets = [...(preferSlotId ? [preferSlotId] : []), ...empties];
    let ok = 0, bad = 0;
    for (let i = 0; i < files.length && i < targets.length; i++) {
      try { placeImage(targets[i], await loadFileImage(files[i])); ok++; } catch { bad++; }
    }
    const unused = Math.max(0, files.length - targets.length);
    if (bad || unused || files.length > 1) {
      const parts = [`วางรูปแล้ว ${ok} ช่อง`];
      if (unused) parts.push(`เหลือ ${unused} รูปไม่ได้ใช้ (ช่องเต็ม — แตะช่องที่จะเปลี่ยนแล้วอัปโหลดทีละรูป)`);
      if (bad) parts.push(`เปิดไม่ได้ ${bad} ไฟล์`);
      showNotice(parts.join(' · '), bad || (unused && !ok) ? 'error' : 'info');
    }
  };
  const removeImage = (slotId) => {
    setSlotImages(prev => { const n = {...prev}; delete n[slotId]; return n; });
    setSlotAdjust(p => { if (!p[slotId]) return p; const n = { ...p }; delete n[slotId]; return n; });
    if (fileRefs.current[slotId]) fileRefs.current[slotId].value = '';
  };

  // ★ 6 ก.ค. (ผู้ใช้สั่ง): 🧺 ถาดภาพจากคลังค้นรูป — /image-search ส่งรูปที่ติ๊กมาทาง localStorage
  //   แตะรูปในถาด → แตะชิปช่อง = วางทันที ไม่ต้องเซฟลงเครื่อง · วางทับ = เปลี่ยนรูป สลับได้ตลอด
  const [tray, setTray] = useState([]);
  const [armedTray, setArmedTray] = useState(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('acs_picked_images');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) setTray(arr.slice(0, 60));
      }
    } catch { /* เงียบ */ }
  }, []);
  const loadUrlImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // รูป rehost อยู่ Supabase Storage = CORS เปิด วาดลง canvas ได้
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  const assignTrayToSlot = async (slotId) => {
    const t = armedTray != null ? tray[armedTray] : null;
    if (!t) return false;
    try {
      let img;
      try { img = await loadUrlImage(t.url); } catch { img = await loadUrlImage(t.thumb || t.url); }
      placeImage(slotId, img);
      setArmedTray(null);
      return true;
    } catch {
      alert('โหลดรูปนี้ไม่สำเร็จ (ต้นทางอาจบล็อก) — ลองรูปอื่นในถาด');
      return false;
    }
  };

  // ★ แบตช์ E (E1c): hydrate โหมด recipe — ?recipe=MG-xxxx → โหลดสูตรจาก /api/mega/recipe
  //   ฉีดแทมเพลตชั่วคราว (custom ไม่เซฟ Supabase) + วางภาพลงช่องอัตโนมัติ · ไม่มี ?recipe = ข้ามทั้งก้อน (byte-parity)
  useEffect(() => {
    let jobId = '';
    let useLocal = false;
    try {
      const sp = new URLSearchParams(window.location.search);
      jobId = (sp.get('recipe') || '').trim();
      // ★ 17 ก.ค.: แหล่งสูตรที่สอง — ?recipeLocal=1 รับสูตรจาก localStorage (ส่งจาก /mega-compose-test ข้ามแท็บ)
      useLocal = sp.get('recipeLocal') === '1';
    } catch { jobId = ''; }
    if (!jobId && !useLocal) return; // หน้าเดิมทุกพฤติกรรม
    let cancelled = false;
    setRecipeMode(jobId || 'ทางลัดประกอบ');
    setRecipeStatus('⏳ กำลังโหลดสูตรจากคิว...');
    (async () => {
      try {
        let rc = null;
        if (useLocal) {
          // อ่านสูตรจาก localStorage — สดไม่เกิน 15 นาที (กันเปิดลิงก์ค้างข้ามวันแล้วได้สูตรเก่า)
          try {
            const raw = window.localStorage.getItem('crtRecipeHandoff');
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed?.recipe && Date.now() - (parsed.at || 0) < 15 * 60 * 1000) rc = parsed.recipe;
          } catch { rc = null; }
          if (!rc) { setRecipeStatus('❌ ไม่พบสูตรที่ส่งมา (หมดอายุ/ถูกล้าง) — กลับไปกด "แก้ต่อในเอดิเตอร์" ใหม่'); return; }
          if (rc.jobId) setRecipeMode(String(rc.jobId));
        } else {
          const res = await fetch(`/api/mega/recipe?job=${encodeURIComponent(jobId)}`);
          const data = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (!res.ok || !data.success || !data.recipe) {
            setRecipeStatus(`❌ เปิดสูตรไม่สำเร็จ: ${data.error || res.status}${data.errorType ? ` (${data.errorType})` : ''}`);
            return;
          }
          rc = data.recipe;
        }
        setRecipe(rc);
        // ★ E3: ป้อนพูล recipe เข้า state รวม ให้ modal เลือกรูป (E3b) ใช้ได้ทันทีในโหมด recipe
        //   (แถบพูลล่างของโหมด recipe ยังอ่าน recipe.pool เหมือนเดิม — ไม่ regress)
        if (Array.isArray(rc.pool) && rc.pool.length) {
          setPool(rc.pool);
          setPoolCaseName(`คลังสูตร${rc.jobId ? ' ' + rc.jobId : ''} · ${rc.pool.length} ใบ`);
        }
        // ฉีดแทมเพลต recipe เข้า list (append — templates-load effect คง recipe-* ไว้)
        const tpl = { ...rc.template };
        setTemplates(prev => (prev.some(t => t.id === tpl.id) ? prev.map(t => t.id === tpl.id ? tpl : t) : [...prev, tpl]));
        setTemplateId(tpl.id);
        setSlotImages({}); setSlotOffsets({}); setSlotScales({}); setSlotCrops({});
        // วางภาพลงช่องอัตโนมัติ (โหลดขนาน — ใบไหนล้มก็ข้าม ให้คนใส่เองจากพูล)
        const entries = Object.entries(rc.imagesBySlot || {});
        setRecipeStatus(`🖼️ กำลังวางภาพ ${entries.length} ช่อง...`);
        const loaded = await Promise.all(entries.map(async ([slotId, url]) => {
          try { return [slotId, await loadUrlImage(url)]; } catch { return [slotId, null]; }
        }));
        if (cancelled) return;
        const map = {};
        let okCount = 0;
        for (const [slotId, img] of loaded) { if (img) { map[slotId] = img; okCount++; } }
        setSlotImages(map);
        setRecipeStatus(okCount === entries.length ? '' : `⚠️ วางภาพได้ ${okCount}/${entries.length} ช่อง (ที่เหลือใส่เองจากคลังภาพด้านล่าง)`);
      } catch (e) {
        if (!cancelled) setRecipeStatus('❌ เรียกสูตรล้ม: ' + (e?.message || 'ไม่ทราบสาเหตุ'));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ แบตช์ E: คลิกภาพในพูล → วางลงช่องที่เลือกอยู่ (ไม่มี = ช่องว่างช่องแรก → main)
  //   ★ E3b: รับ explicitSlotId ได้ (modal เลือกรูปส่งช่องเป้าหมายมาตรง) — ไม่ส่ง = พฤติกรรมเดิมเป๊ะ
  const assignPoolUrlToSlot = async (url, explicitSlotId) => {
    const target = explicitSlotId
      || selectedSlotId
      || (template && template.slots.find(sl => !slotImages[sl.id])?.id)
      || (template && template.slots[0]?.id);
    if (!target || !url) return;
    try {
      const img = await loadUrlImage(url);
      placeImage(target, img);
    } catch {
      alert('โหลดรูปนี้ไม่สำเร็จ (ต้นทางอาจบล็อก CORS) — ลองภาพที่ rehost แล้ว (มีเครื่องหมายเขียว)');
    }
  };

  // ★ E3a: พูลที่ modal/แถบใช้จริง — พูลจากเคสมาก่อน, ไม่มีก็ตกไป recipe.pool (ตามพฤติกรรมเดิม)
  const poolItems = pool.length > 0 ? pool : (recipe?.pool || []);

  // ★ E3a: โหลดรายชื่อเคสแบบ lazy (ครั้งแรกที่กดเปิด dropdown) จาก /api/mega/compose-test?list=1
  const loadCaseList = async () => {
    if (caseList || caseListLoading) return; // โหลดครั้งเดียวพอ
    setCaseListLoading(true); setCaseListErr('');
    try {
      const res = await fetch('/api/mega/compose-test?list=1');
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      setCaseList(Array.isArray(data.cases) ? data.cases : []);
    } catch {
      if (!mountedRef.current) return;
      setCaseListErr('โหลดรายชื่อเคสไม่สำเร็จ — ลองใหม่'); setCaseList([]);
    } finally {
      if (mountedRef.current) setCaseListLoading(false);
    }
  };
  const openCasePicker = () => { setCasePickerOpen(true); loadCaseList(); };

  // ★ E3a: ดึงคลังภาพของเคสที่เลือก → เก็บเป็น pool รวม (แปลงเป็นรูป {id,url,thumb,person,note})
  const loadCasePool = async (cs) => {
    if (!cs?.id) return;
    setPoolLoading(true);
    try {
      const res = await fetch(`/api/images/${encodeURIComponent(cs.id)}`);
      const data = await res.json().catch(() => ({}));
      // รองรับทั้ง 2 ทรง response: images ระดับบนสุด (ของจริง buildImagesRouteResponse) หรือ case.images
      const imgs = data?.case?.images || data?.images || [];
      const mapped = imgs.map((im, i) => ({
        id: im.id || `${cs.id}-${i}`,
        url: im.imageUrl,
        thumb: im.thumbnailUrl || im.imageUrl,
        person: im.person || im.triage?.person || '',
        note: im.note || im.source || '',
      })).filter(p => p.url);
      if (!mountedRef.current) return;
      setPool(mapped);
      setPoolCaseName(`${cs.headline || cs.id} · ${mapped.length} ใบ`);
      setCasePickerOpen(false);
    } catch {
      if (mountedRef.current) alert('ดึงคลังภาพเคสนี้ไม่สำเร็จ — ลองเคสอื่น');
    } finally {
      if (mountedRef.current) setPoolLoading(false);
    }
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
    touchScaleRef.current = W / Math.max(1, r.width); // จอเล็ก = ค่าสูง (มือถือ ~3.3, PC ~1.7)
    return { mx: (cx-r.left)*(W/r.width), my: (cy-r.top)*(H/r.height) };
  };

  // ── Hit test: draggable slots — 3 zones: corner=resize, border=move, center=crop ──
  const MOVE_BORDER = 25; // px border zone for move (smaller = more crop area)
  // ★ 4 ก.ค.: โซนจับขยายตามจอ — จอมือถือ canvas ถูกย่อ ~3 เท่า โซน 36px เหลือ ~11px จริง นิ้วจับไม่ถูก
  const _zoneScale = () => Math.min(2.4, Math.max(1, touchScaleRef.current / 1.7));

  // ★ 19 ก.ค.: ปุ่มย้ายทั้งช่อง/วง (✥) — จุดจับที่ "มองเห็นชัด" แก้ปัญหาเดิม "หาจุดเลื่อนวงไม่เจอ"
  // (โซนวงแบบเดิมเป็นแหวนบางๆ วงเล็ก/จอมือถือแทบจับไม่ได้เลย) — วางที่ขอบบนกึ่งกลางของช่อง
  const MOVE_GRIP_VR = 32; // รัศมีปุ่ม (canvas px)
  const getMoveHandle = (slot) => {
    const off = slotOffsets[slot.id] || { dx: 0, dy: 0 };
    const eff = getEffSlot(slot, slotScales[slot.id]);
    const sx = eff.x + off.dx, sy = eff.y + off.dy;
    const cx = slot.shape === 'circle' ? sx + eff.diameter / 2 : sx + eff.w / 2;
    // ติดขอบบนช่องเสมอ + clamp ไม่ให้หลุดผืนภาพ
    const hx = Math.max(MOVE_GRIP_VR + 2, Math.min(W - MOVE_GRIP_VR - 2, cx));
    const hy = Math.max(MOVE_GRIP_VR + 2, Math.min(H - MOVE_GRIP_VR - 2, sy));
    return { hx, hy, vr: MOVE_GRIP_VR };
  };
  // แตะโดนปุ่มย้ายของช่องที่เลือกอยู่ไหม (ตรวจก่อนทุกอย่าง — จับปุ่มได้แม้วางทับช่องอื่น)
  const hitMoveGrip = (mx, my) => {
    if (!selectedSlotId) return null;
    const sel = draggableSlots.find(sl => sl.id === selectedSlotId && slotImages[sl.id]);
    if (!sel) return null;
    const { hx, hy, vr } = getMoveHandle(sel);
    return Math.hypot(mx - hx, my - hy) <= vr * _zoneScale() ? sel : null;
  };

  const hitTest = (mx, my) => {
    const _zs = _zoneScale();
    const HS = HANDLE_SIZE * _zs, ER = EDGE_RING * _zs, MB = MOVE_BORDER * _zs;
    const sorted = [...draggableSlots].filter(sl => slotImages[sl.id]).sort((a,b) => (b.zIndex||0)-(a.zIndex||0));
    for (const slot of sorted) {
      const off = slotOffsets[slot.id] || {dx:0,dy:0};
      const eff = getEffSlot(slot, slotScales[slot.id]);
      const sx = eff.x + off.dx, sy = eff.y + off.dy;

      if (slot.shape === 'circle') {
        const r = eff.diameter/2, ecx = sx+r, ecy = sy+r;
        const dist = Math.hypot(mx-ecx, my-ecy);
        if (dist <= r + (slot.borderWidth||0)) {
          if (dist >= r - ER) return { slot, mode: 'resize' };
          if (dist >= r * 0.55) return { slot, mode: 'move' };
          return { slot, mode: 'crop' };
        }
      } else {
        const ew = eff.w, eh = eff.h;
        if (mx >= sx && mx <= sx+ew && my >= sy && my <= sy+eh) {
          const nearL = mx - sx < HS, nearR = sx+ew - mx < HS;
          const nearT = my - sy < HS, nearB = sy+eh - my < HS;
          const nearCorner = (nearL || nearR) && (nearT || nearB);
          if (nearCorner) return { slot, mode: 'resize' };
          // Border zone = move, center = crop
          const inBorderL = mx - sx < MB, inBorderR = sx+ew - mx < MB;
          const inBorderT = my - sy < MB, inBorderB = sy+eh - my < MB;
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
      // ★ 14 พ.ย. 69: ข้อความวาดแบบ textBaseline='middle' → กล่องจับต้องอยู่กึ่งกลางบรรทัด
      //   (เดิม top = ty - 0.3fs = กล่องเลื่อนลงต่ำ ครึ่งบนของตัวหนังสือจับลากไม่ติด) + รองรับชิดขวา
      const align = ts.align || 'center';
      const left = align === 'center' ? tx - textW/2 : align === 'right' ? tx - textW : tx;
      const top = ty - textH / 2;
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

  // ★ 14 พ.ย. 69: ช่องใต้นิ้ว/เมาส์ "รวมช่องว่าง" — ใช้ตอนลากไฟล์มาวางบนปก
  const slotAtPoint = (mx, my) => {
    if (!template) return null;
    const sorted = [...template.slots].sort((a,b) => (b.zIndex||0)-(a.zIndex||0));
    for (const slot of sorted) {
      const off = slotOffsets[slot.id] || {dx:0,dy:0};
      const eff = getEffSlot(slot, slotScales[slot.id]);
      const sx = eff.x + off.dx, sy = eff.y + off.dy;
      if (slot.shape === 'circle') {
        const r = eff.diameter/2;
        if (Math.hypot(mx-(sx+r), my-(sy+r)) <= r + (slot.borderWidth||0)) return slot;
      } else if (mx >= sx && mx <= sx+(eff.w||0) && my >= sy && my <= sy+(eff.h||0)) return slot;
    }
    return null;
  };

  // ── Pointer handlers ──
  const handleDown = (cx, cy) => {
    const {mx,my} = getCoords(cx,cy);
    // ★ 4 ก.ค. รอบ 2: วง/กรอบแดงอยู่บนสุด — เช็คก่อนทุกอย่าง
    const mHit = hitTestMarker(mx, my);
    if (mHit) {
      setSelectedMarkerId(mHit.marker.id);
      setDrag({ markerId: mHit.marker.id, mode: mHit.mode === 'move' ? 'marker-move' : 'marker-resize', startX: mx, startY: my, orig: { ...mHit.marker } });
      return;
    }
    // ★ 19 ก.ค.: จับปุ่มย้าย (✥) ของช่องที่เลือกอยู่ → ย้ายทั้งช่อง/วง (เช็คก่อนเลือกช่องใหม่ กันสลับช่อง)
    const gripSlot = hitMoveGrip(mx, my);
    if (gripSlot) {
      const off = slotOffsets[gripSlot.id] || { dx: 0, dy: 0 };
      const sc = slotScales[gripSlot.id] || 1;
      setDrag({ slotId: gripSlot.id, mode: 'move', startX: mx, startY: my, origDx: off.dx, origDy: off.dy, origScale: sc, startDist: 0 });
      return;
    }
    if (selectedMarkerId) setSelectedMarkerId(null); // แตะที่อื่น = วางมือจากวงแดง
    // ★ 4 ก.ค.: แตะช่องไหน = เลือกช่องนั้น (แผงเครื่องมือใต้ปกสลับตาม + วาดกรอบไฮไลต์)
    const _selHit = hitTestAll(mx, my);
    if (_selHit) setSelectedSlotId(_selHit.id);
    // First try text drag
    const textHit = hitTestText(mx, my);
    if (textHit) {
      const ov = textOverrides[textHit.id] || {};
      setDrag({ slotId: textHit.id, mode: 'textmove', startX: mx, startY: my, origDx: ov.dx || 0, origDy: ov.dy || 0 });
      return;
    }
    // Then try draggable slots (move/resize/crop)
    const hit = hitTest(mx,my);
    if (hit) {
      if (hit.mode === 'crop') {
        // Center of draggable slot → crop pan
        const crop = slotCrops[hit.slot.id] || { zoom: 1, panX: 0, panY: 0 };
        setDrag({ slotId: hit.slot.id, mode:'crop', startX:mx, startY:my, origPanX: crop.panX || 0, origPanY: crop.panY || 0 });
      } else {
        const off = slotOffsets[hit.slot.id] || {dx:0,dy:0};
        const sc = slotScales[hit.slot.id] || 1;
        const eff = getEffSlot(hit.slot, sc);
        if (hit.mode === 'resize') {
          const ecx = eff.x + off.dx + (eff.shape==='circle' ? eff.diameter/2 : eff.w/2);
          const ecy = eff.y + off.dy + (eff.shape==='circle' ? eff.diameter/2 : eff.h/2);
          const startDist = Math.hypot(mx-ecx, my-ecy);
          setDrag({ slotId: hit.slot.id, mode:'resize', startX:mx, startY:my, origDx:off.dx, origDy:off.dy, origScale:sc, startDist });
        } else {
          setDrag({ slotId: hit.slot.id, mode:'move', startX:mx, startY:my, origDx:off.dx, origDy:off.dy, origScale:sc, startDist:0 });
        }
      }
      return;
    }
    // Then try ANY slot for crop-pan
    const anySlot = hitTestAll(mx,my);
    if (anySlot) {
      const crop = slotCrops[anySlot.id] || { zoom: 1, panX: 0, panY: 0 };
      setDrag({ slotId: anySlot.id, mode:'crop', startX:mx, startY:my, origPanX: crop.panX || 0, origPanY: crop.panY || 0 });
    }
  };

  const handleMove = (cx, cy) => {
    const {mx,my} = getCoords(cx,cy);
    const dragState = dragRef.current; // ค่าล่าสุดจริง (ไม่รอ render)

    if (!dragState) {
      // ★ 19 ก.ค.: ชี้โดนปุ่มย้าย (✥) = เคอร์เซอร์มือจับ
      if (hitMoveGrip(mx, my)) { setHoverCursor('grab'); return; }
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

    // ★ 4 ก.ค. รอบ 2: ลากวง/กรอบแดง — ย้าย/ย่อขยายรอบจุดกึ่งกลาง (วงกลมคงความกลมเสมอ)
    if (dragState.mode === 'marker-move') {
      const dx = mx - dragState.startX, dy = my - dragState.startY;
      setMarkers(prev => prev.map(m => m.id === dragState.markerId ? { ...m, x: dragState.orig.x + dx, y: dragState.orig.y + dy } : m));
      return;
    }
    if (dragState.mode === 'marker-resize') {
      const o = dragState.orig;
      const ccx = o.x + o.w / 2, ccy = o.y + o.h / 2;
      const startDist = Math.hypot(dragState.startX - ccx, dragState.startY - ccy);
      const ratio = startDist > 5 ? Math.hypot(mx - ccx, my - ccy) / startDist : 1;
      setMarkers(prev => prev.map(m => {
        if (m.id !== dragState.markerId) return m;
        const w = Math.max(70, o.w * ratio);
        const h = m.type === 'circle' ? w : Math.max(70, o.h * ratio);
        return { ...m, w, h, x: ccx - w / 2, y: ccy - h / 2 };
      }));
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

  const handleUp = () => setDrag(null);

  // ★ 14 พ.ย. 69: ลากต่อเนื่องได้แม้เมาส์หลุดขอบปก — เดิมผูก mouseleave = จบการลาก ลากช่องไปชิดขอบแล้วหลุดมือ
  //   ระหว่างลาก: ฟัง mousemove/mouseup ที่ระดับ window (เรียกฟังก์ชันรุ่นล่าสุดผ่าน liveRef กัน state ค้าง)
  useEffect(() => {
    const mv = (e) => { if (dragRef.current && e.target !== canvasRef.current) liveRef.current.handleMove?.(e.clientX, e.clientY); };
    const up = () => { if (dragRef.current) liveRef.current.handleUp?.(); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, []);

  // ★ 14 พ.ย. 69: วางรูปจากคลิปบอร์ด (Ctrl+V) + คีย์ลัด — ลูกศร=ขยับรูป/วงแดงที่เลือก · Delete=ลบวงแดง · Esc=เลิกเลือก
  useEffect(() => {
    const isTyping = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    const onPaste = (e) => {
      const files = Array.from(e.clipboardData?.files || []).filter(f => f.type && f.type.startsWith('image/'));
      if (!files.length) return; // วางข้อความธรรมดา = ไม่ยุ่ง
      e.preventDefault();
      liveRef.current.handleFiles?.(files);
    };
    const onKey = (e) => { if (!isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) liveRef.current.onKey?.(e); };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('paste', onPaste); window.removeEventListener('keydown', onKey); };
  }, []);
  const onKeyShortcut = (e) => {
    if (pickerSlotId != null) return; // modal เลือกรูปเปิดอยู่ — ให้ modal จัดการเอง
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = arrows[e.key];
    const step = e.shiftKey ? 50 : 10;
    if (selectedMarkerId) {
      if (dir) { e.preventDefault(); setMarkers(prev => prev.map(m => m.id === selectedMarkerId ? { ...m, x: m.x + dir[0] * step, y: m.y + dir[1] * step } : m)); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setMarkers(prev => prev.filter(m => m.id !== selectedMarkerId)); setSelectedMarkerId(null); }
      else if (e.key === 'Escape') setSelectedMarkerId(null);
      return;
    }
    if (selectedSlotId && slotImages[selectedSlotId]) {
      if (dir) {
        e.preventDefault();
        const sid = selectedSlotId;
        setSlotCrops(prev => { const old = prev[sid] || { zoom: 1, panX: 0, panY: 0 }; return { ...prev, [sid]: { ...old, panX: (old.panX || 0) + dir[0] * step, panY: (old.panY || 0) + dir[1] * step } }; });
      } else if (e.key === 'Escape') setSelectedSlotId(null);
    }
  };

  // ── Mouse wheel: smooth zoom in slot ──
  const handleWheel = useCallback((e) => {
    const {mx,my} = getCoords(e.clientX, e.clientY);
    const slot = hitTestAll(mx,my);
    // ★ 14 พ.ย. 69: ไม่ได้ชี้บนรูป = ปล่อยให้หน้าเว็บเลื่อนตามปกติ (เดิมกลืนล้อเมาส์ทั้งผืนปก เลื่อนหน้าไม่ได้)
    if (!slot) return;
    e.preventDefault();
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

  // ★ 4 ก.ค. รอบ 2 — รวม override ต่อช่อง (เฟด/สีขอบ/ขาวดำ) ใช้ทั้งพรีวิว render และดาวน์โหลด
  const effWithOverrides = (slot, liteSlotId) => {
    let eff = getEffSlot(slot, slotScales[slot.id]);
    // ★ 14 พ.ย. 69: ปรับแสง/สี/ความคมรายช่อง (กดค้าง "ดูต้นฉบับ" = ข้ามชั่วคราว)
    const adj = compareOriginal ? null : slotAdjust[slot.id];
    if (adj && !isNeutralAdjust(adj)) eff = { ...eff, _adj: adj, _adjKey: adjustKey(adj), _lite: liteSlotId === slot.id };
    const ov = slotFadeEdges[slot.id];
    if (fadeAllOff) {
      // ปิดเฟดทั้งใบ = ขอบคมหมดทุกช่อง (ชนะทุกอย่าง — คาดเดาง่าย)
      eff = { ...eff, fadeLeft: 0, fadeRight: 0, fadeTop: 0, fadeBottom: 0 };
    } else if (ov) {
      // ★ 6 ก.ค. รอบ 2: ช่องนี้ตั้งขอบเอง — โหมดละลายทับ (melt) / เบลอฟุ้ง (blur) / จางใส (fade)
      if (ov.mode === 'melt') {
        eff = { ...eff, fadeLeft: 0, fadeRight: 0, fadeTop: 0, fadeBottom: 0, _meltEdges: ov };
      } else if (ov.mode === 'blur') {
        eff = { ...eff, fadeLeft: 0, fadeRight: 0, fadeTop: 0, fadeBottom: 0, _blurEdges: ov };
      } else {
        eff = {
          ...eff,
          fadeLeft: ov.left ? ov.px : 0,
          fadeRight: ov.right ? ov.px : 0,
          fadeTop: ov.top ? ov.px : 0,
          fadeBottom: ov.bottom ? ov.px : 0,
        };
      }
    } else if (eff.fadeLeft || eff.fadeRight || eff.fadeTop || eff.fadeBottom) {
      // ช่องที่ยังไม่ปรับเอง = ตามแทมเพลต × ระดับเฟดทั้งใบ
      if (fadeAllLevel !== 100) {
        const k = fadeAllLevel / 100;
        eff = {
          ...eff,
          fadeLeft: Math.round((eff.fadeLeft || 0) * k),
          fadeRight: Math.round((eff.fadeRight || 0) * k),
          fadeTop: Math.round((eff.fadeTop || 0) * k),
          fadeBottom: Math.round((eff.fadeBottom || 0) * k),
        };
      }
    }
    if (slotBorderColors[slot.id] && eff.border) eff = { ...eff, border: slotBorderColors[slot.id] };
    const g = slotGray[slot.id] || 0;
    if (g > 0) eff = { ...eff, _gray: g };
    return eff;
  };

  // ★ โทนไว้อาลัยทั้งใบ: ก๊อปภาพที่วาดเสร็จ → วาดทับตัวเองด้วย filter grayscale (ข้อความ/ขอบโดนด้วย = โทนเดียวทั้งใบ)
  const applyGlobalGray = (ctx) => {
    if (!grayAll || grayAll <= 0) return;
    const canvas = ctx.canvas; if (!canvas) return; // ★ 14 พ.ย. 69: ผืนที่กำลังวาดจริง (พรีวิว หรือ ผืนส่งออก)
    // 🩹 Safari/iOS ไม่มี ctx.filter → ทำขาวดำที่ระดับพิกเซลแทน (สูตรเดียวกับ grayscale() ของ CSS)
    if (!CANVAS_FILTER_OK) { adjustCanvas(canvas, null, { gray: grayAll }); return; }
    const snap = document.createElement('canvas'); snap.width = W; snap.height = H;
    snap.getContext('2d').drawImage(canvas, 0, 0);
    ctx.save(); ctx.filter = `grayscale(${grayAll})`; ctx.drawImage(snap, 0, 0); ctx.restore();
  };

  // ★ วง/กรอบแดงเน้นจุดข่าว — วาด "หลัง" โทนไว้อาลัย (วงยังแดงสด เด่นบนภาพขาวดำ)
  const drawMarkers = (ctx, showSelection) => {
    for (const m of markers) {
      ctx.save();
      ctx.strokeStyle = m.color || '#FF0000';
      ctx.lineWidth = m.width || 10;
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 7;
      if (m.type === 'circle') { ctx.beginPath(); ctx.ellipse(m.x + m.w / 2, m.y + m.h / 2, m.w / 2, m.h / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
      else ctx.strokeRect(m.x, m.y, m.w, m.h);
      if (showSelection && m.id === selectedMarkerId) {
        ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(96,165,250,0.9)'; ctx.lineWidth = 3; ctx.setLineDash([10, 6]);
        ctx.strokeRect(m.x - 10, m.y - 10, m.w + 20, m.h + 20);
      }
      ctx.restore();
    }
  };

  // hit test วง/กรอบแดง (อยู่บนสุด เช็คก่อนช่องภาพ) — วงกลม: ในวง=ย้าย ขอบวง=ย่อขยาย · กรอบ: ขอบ/มุม=จับ ตรงกลางทะลุลงช่องล่าง
  const hitTestMarker = (mx, my) => {
    const pad = 30 * _zoneScale();
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      if (m.type === 'circle') {
        const cx = m.x + m.w / 2, cy = m.y + m.h / 2, r = m.w / 2;
        const dist = Math.hypot(mx - cx, my - cy);
        if (Math.abs(dist - r) <= pad) return { marker: m, mode: 'resize' };
        if (dist < r) return { marker: m, mode: 'move' };
      } else {
        const nearCorner = [[m.x, m.y], [m.x + m.w, m.y], [m.x, m.y + m.h], [m.x + m.w, m.y + m.h]]
          .some(([hx, hy]) => Math.abs(mx - hx) <= pad && Math.abs(my - hy) <= pad);
        if (nearCorner) return { marker: m, mode: 'resize' };
        const inOuter = mx >= m.x - pad && mx <= m.x + m.w + pad && my >= m.y - pad && my <= m.y + m.h + pad;
        const inInner = mx > m.x + pad && mx < m.x + m.w - pad && my > m.y + pad && my < m.y + m.h - pad;
        if (inOuter && !inInner) return { marker: m, mode: 'move' };
      }
    }
    return null;
  };
  const addMarker = (type) => {
    const id = `mk_${Date.now().toString(36)}`;
    const m = type === 'circle'
      ? { id, type, x: W / 2 - 170, y: H / 2 - 170, w: 340, h: 340, color: '#FF0000', width: 10 }
      : { id, type, x: W / 2 - 260, y: H / 2 - 170, w: 520, h: 340, color: '#FF0000', width: 10 };
    setMarkers(prev => [...prev, m]);
    setSelectedMarkerId(id);
  };

  // ── Render ──
  // ★ 14 พ.ย. 69: รวมตัววาด "พรีวิว" กับ "ไฟล์ส่งออก" เป็นฟังก์ชันเดียว (เดิมก๊อปโค้ดกัน 2 ชุด เสี่ยงแก้ไม่ครบแล้วไฟล์ไม่ตรงพรีวิว)
  //   withHandles=true → พรีวิวบนจอ (มีจุดจับ/กรอบเลือก) · false → ไฟล์จริงสะอาด วาดลงผืนแยก ไม่แตะผืนบนจอ
  const paintCover = (ctx, withHandles) => {
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; // ★ คุณภาพสูงสุด
    ctx.fillStyle = '#111119'; ctx.fillRect(0,0,W,H);
    if (!template) {
      if (!withHandles) return;
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('เลือกแทมเพลตเพื่อเริ่มต้น', W/2, H/2);
      return;
    }
    // ระหว่างลากเลื่อนภาพในช่อง: ช่องนั้นข้ามขั้นความคมชั่วคราวให้ลื่น (ปล่อยมือ = คมกลับ · ไฟล์ส่งออกคมเต็มเสมอ)
    const liteId = !withHandles ? null : dragState?.mode === 'crop' ? dragState.slotId : adjLite ? selectedSlotId : null;

    // Blurred background — fills gaps so no black areas when elements are moved/resized
    drawBlurredBg(ctx, slotImages, template);

    const sorted = [...template.slots].sort((a,b) => (a.zIndex||0)-(b.zIndex||0));

    // Pass 1: background + main images (zIndex < 3)
    for (const slot of sorted) {
      if ((slot.zIndex||0) >= 3) continue;
      const img = slotImages[slot.id]; if (!img) continue;
      const offset = slotOffsets[slot.id];
      const eff = effWithOverrides(slot, liteId); // ★ 4 ก.ค. รอบ 2: เฟด/สีขอบ/ขาวดำ ตามที่ผู้ใช้ตั้ง
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
      const eff = effWithOverrides(slot, liteId); // ★ 4 ก.ค. รอบ 2
      if (eff.shape === 'circle') drawCircleSlot(ctx, img, eff, offset, slotCrops[slot.id]);
      else drawRectSlot(ctx, img, eff, offset, slotCrops[slot.id]);
    }

    // ★ 4 ก.ค. รอบ 2: โทนไว้อาลัยทั้งใบ → แล้วค่อยวาดวง/กรอบแดง (วงยังแดงสดบนภาพขาวดำ)
    applyGlobalGray(ctx);
    drawMarkers(ctx, withHandles);
    if (!withHandles) return; // ไฟล์ส่งออก: จบแค่นี้ (ไม่มีจุดจับ/เส้นประ/ข้อความแนะนำ)

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
      const handleColor = isActive ? 'rgba(96,165,250,0.9)' : 'rgba(255,255,255,0.5)';
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
        ctx.strokeStyle = 'rgba(96,165,250,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([8,4]);
        if (slot.shape === 'circle') { const r = eff.diameter/2; ctx.beginPath(); ctx.arc(sx+r,sy+r,r+8,0,Math.PI*2); ctx.stroke(); }
        else ctx.strokeRect(sx-4, sy-4, eff.w+8, eff.h+8);
      }
      ctx.restore();
    }

    // ★ 4 ก.ค.: กรอบฟ้าช่องที่เลือก (จากแตะ/ชิป) — เห็นชัดว่ากำลังแต่งช่องไหน ทุกช่องไม่ใช่แค่ draggable
    if (selectedSlotId) {
      const slot = template.slots.find(sl => sl.id === selectedSlotId);
      if (slot && slotImages[slot.id]) {
        const off = slotOffsets[slot.id] || { dx: 0, dy: 0 };
        const eff = getEffSlot(slot, slotScales[slot.id]);
        const sx = eff.x + off.dx, sy = eff.y + off.dy;
        ctx.save();
        ctx.strokeStyle = 'rgba(96,165,250,0.95)'; ctx.lineWidth = 5; ctx.setLineDash([14, 9]);
        if (slot.shape === 'circle') { const r = eff.diameter / 2; ctx.beginPath(); ctx.arc(sx + r, sy + r, r + 7, 0, Math.PI * 2); ctx.stroke(); }
        else ctx.strokeRect(sx - 4, sy - 4, eff.w + 8, eff.h + 8);
        ctx.restore();
      }
    }

    // ★ 19 ก.ค.: ปุ่มย้าย (✥) บนช่องที่เลือก (เฉพาะช่องที่ลากได้) — จุดจับมองเห็นชัด แก้ "หาจุดเลื่อนวงไม่เจอ"
    if (selectedSlotId) {
      const sel = draggableSlots.find(sl => sl.id === selectedSlotId && slotImages[sl.id]);
      if (sel) {
        const { hx, hy, vr } = getMoveHandle(sel);
        const active = dragState?.slotId === sel.id && dragState?.mode === 'move';
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(hx, hy, vr, 0, Math.PI * 2);
        ctx.fillStyle = active ? 'rgba(37,99,235,0.96)' : 'rgba(255,255,255,0.95)';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 3.5; ctx.strokeStyle = active ? '#ffffff' : '#2563eb'; ctx.stroke();
        ctx.fillStyle = active ? '#ffffff' : '#2563eb';
        ctx.font = `bold ${Math.round(vr * 1.2)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('✥', hx, hy + 1);
        ctx.restore();
      }
    }
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    paintCover(canvas.getContext('2d'), true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotImages, slotOffsets, slotScales, slotCrops, template, textValues, textBgColors, textOverrides, dragState, selectedSlotId,
      slotFadeEdges, fadeAllOff, fadeAllLevel, slotBorderColors, slotGray, grayAll, markers, selectedMarkerId, // ★ 4 ก.ค. รอบ 2 + เฟดรายขอบ 6 ก.ค.
      slotAdjust, compareOriginal, adjLite]); // ★ 14 พ.ย. 69: ปรับแสง/สี/ความคม

  // ★ 14 พ.ย. 69 (เพิ่มความเร็ว): วาดไม่เกิน 1 ครั้งต่อเฟรมจอ — ลากเร็วๆ มี state เปลี่ยนหลายรอบใน 1 เฟรม เดิมวาดซ้ำทุกรอบ
  useEffect(() => {
    const id = requestAnimationFrame(render);
    return () => cancelAnimationFrame(id);
  }, [render]);

  // ── Render clean (no handles) — ใช้ร่วม download + บันทึกเข้าคลัง ──
  // ★ 14 พ.ย. 69: วาดลง "ผืนแยก" (offscreen) — เดิมวาดทับผืนบนจอแล้วตั้งเวลา 100ms วาดจุดจับกลับ
  //   = จอกระพริบ + ถ้าผู้ใช้ขยับอะไรใน 100ms นั้น ไฟล์/จออาจไม่ตรงกัน
  const renderCleanCanvas = () => {
    if (!template) return null;
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    paintCover(off.getContext('2d'), false);
    return off;
  };

  // ── Download ──
  const handleDownload = () => {
    const canvas = renderCleanCanvas(); if (!canvas) return;
    const safeName = String(template.name || 'cover').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    const fail = () => showNotice('สร้างไฟล์ไม่สำเร็จ — มีรูปจากเว็บนอกที่เบราว์เซอร์ไม่ยอมให้ส่งออก ลองเปลี่ยนรูปช่องนั้นเป็นไฟล์จากเครื่อง', 'error');
    try {
      canvas.toBlob((blob) => {
        if (!blob) { fail(); return; } // ★ เดิม: blob=null แล้ว createObjectURL โยน error เงียบ ปุ่มกดแล้วไม่มีอะไรเกิดขึ้น
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `cover_${safeName}_${Date.now()}.jpg`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000); // ★ เดิม revoke ทันที — Safari บางรุ่นยังไม่ทันเริ่มโหลดไฟล์
        setDownloaded(true); setTimeout(() => setDownloaded(false), 2500);
      }, 'image/jpeg', 0.95);
    } catch { fail(); }
  };

  // ★ แบตช์ E (E2a): บันทึกปกที่แก้เองเข้าคลัง MEGA (โชว์เฉพาะโหมด recipe)
  const saveCoverToArchive = async () => {
    const canvas = renderCleanCanvas(); if (!canvas) return;
    setSavingCover(true); setSaveToast(null);
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    } catch {
      // canvas taint: มีภาพจากเว็บนอก (ไม่ rehost) → export ไม่ได้
      setSavingCover(false);
      setSaveToast({ ok: false, msg: 'บันทึกไม่ได้: มีภาพบางช่องมาจากเว็บนอก (CORS) — สลับเป็นภาพที่ rehost แล้วในคลังภาพก่อน' });
      return;
    }
    try {
      const res = await fetch('/api/mega-covers/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base64: dataUrl, title: recipe?.title || '', refJobId: recipeMode || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setSaveToast({ ok: true, msg: `บันทึกเข้าคลังแล้ว (${data.id})`, id: data.id });
      } else {
        setSaveToast({ ok: false, msg: `บันทึกไม่สำเร็จ: ${data.error || res.status}${data.errorType ? ` (${data.errorType})` : ''}` });
      }
    } catch (e) {
      setSaveToast({ ok: false, msg: 'เรียก API บันทึกล้ม: ' + (e?.message || 'ไม่ทราบสาเหตุ') });
    } finally {
      setSavingCover(false);
    }
  };

  const switchTemplate = (id) => { setTemplateId(id); setSlotOffsets({}); setSlotScales({}); };

  // ★ 14 พ.ย. 69: ตัวช่วยของแผงปรับแสง/สี/ความคม
  const setAdjustFor = (slotId, next) => {
    // เลื่อนสไลเดอร์แสง/สีต่อเนื่อง: พักขั้น "ความคม" (ขั้นที่หนักสุด) ไว้ 180ms ให้ภาพตามนิ้วทัน หยุดเลื่อนแล้วคมกลับเอง
    //   (ถ้ากำลังปรับตัวความคมเอง/กดชุดสำเร็จ = แสดงผลเต็มทันที)
    const prev = slotAdjust[slotId];
    if ((next?.sharpen || 0) > 0 && (prev?.sharpen || 0) === (next?.sharpen || 0)) {
      setAdjLite(true);
      if (adjLiteTimerRef.current) clearTimeout(adjLiteTimerRef.current);
      adjLiteTimerRef.current = setTimeout(() => setAdjLite(false), 180);
    }
    setSlotAdjust(p => { const n = { ...p }; if (next) n[slotId] = next; else delete n[slotId]; return n; });
  };
  const applyAdjustToAll = (adj, label) => {
    if (!template) return;
    const ids = template.slots.filter(sl => slotImages[sl.id]).map(sl => sl.id);
    if (!ids.length) { showNotice('ยังไม่มีรูปในช่องไหนเลย — ใส่รูปก่อน', 'error'); return; }
    setSlotAdjust(p => { const n = { ...p }; for (const id of ids) n[id] = { ...adj }; return n; });
    showNotice(`${label} ${ids.length} ช่องแล้ว — ไม่ถูกใจช่องไหน แตะช่องนั้นแล้วปรับ/ล้างได้`);
  };
  const adjustedCount = template ? template.slots.filter(sl => slotImages[sl.id] && slotAdjust[sl.id] && !isNeutralAdjust(slotAdjust[sl.id])).length : 0;
  const filledCount = template ? template.slots.filter(sl => slotImages[sl.id]).length : 0;
  // เลือกช่อง แล้วเลื่อนจอไปที่แผงเครื่องมือของช่องนั้น
  const focusTools = (slotId) => {
    setSelectedSlotId(slotId);
    setTimeout(() => toolsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
  };
  // listener ระดับ window (ลาก/วาง/คีย์ลัด) เรียกฟังก์ชันรุ่นล่าสุดผ่าน ref — อัปเดตหลังทุก render
  useEffect(() => { liveRef.current = { handleMove, handleUp, handleFiles, onKey: onKeyShortcut }; });

  // Sort slots for UI
  const uiSlots = template ? [...template.slots].sort((a,b) => {
    const o = {main:0, sub_left:1, highlight:2, circle:3}; return (o[a.id]??5) - (o[b.id]??5);
  }) : [];

  return (
    <>
      <Header title="🖼️ ปกข่าว" subtitle={`สร้างปกข่าว ${W}×${H} — เลือกแทมเพลต อัปโหลดรูป ลากจัดตำแหน่ง ปรับขนาด`} />

      {/* ===== HELP BUTTON + GUIDE ===== */}
      <div style={{ maxWidth: isWide ? 1560 : 1100, margin: '0 auto', padding: '0 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, gap: 8 }}>
          {/* ★ 5 ก.ค.: ปุ่มไปหน้าค้นภาพหลายแหล่ง (หน้านี้เป็น public ไม่มี sidebar — ผู้ใช้หาทางเข้าไม่เจอ) */}
          <a href="/image-search" style={{
            padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, textDecoration: 'none',
            border: '1px solid rgba(96,165,250,0.4)', background: 'rgba(96,165,250,0.1)', color: '#60a5fa',
          }}>
            🔎 หารูปจากทุกแหล่ง
          </a>
          <button
            onClick={() => setShowGuide(!showGuide)}
            style={{
              padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              border: `1px solid ${showGuide ? 'rgba(148,163,184,0.4)' : 'var(--border)'}`,
              background: showGuide ? 'rgba(148,163,184,0.1)' : 'rgba(255,255,255,0.04)',
              color: showGuide ? '#94a3b8' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.3s',
            }}
          >
            {showGuide ? '✕ ปิดคู่มือ' : '❓ วิธีใช้งาน'}
          </button>
        </div>

        {showGuide && (
          <div style={{
            marginBottom: 20, padding: 24, borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(148,163,184,0.05), rgba(249,115,22,0.05))',
            border: '1px solid rgba(148,163,184,0.15)',
            animation: 'fadeUp 0.3s ease-out both',
          }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 18 }}>
              📖 คู่มือการใช้งาน — แทมเพลตปก {templates.length} แบบ
            </div>

            {/* Steps */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div style={{ padding: 16, borderRadius: 12, background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.12)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#94a3b8', marginBottom: 12 }}>🎯 ขั้นตอนการใช้</div>
                {[
                  { s: '1', t: 'เลือกแทมเพลต — ดูป้าย 🖼️รูป ⭕วงกลม 📝ข้อความ ใต้แต่ละแบบ', i: '🖼️' },
                  { s: '2', t: 'ใส่รูป — กด “อัปโหลดหลายรูปทีเดียว” / ลากไฟล์มาวางบนปก / ก๊อปรูปแล้วกด Ctrl+V', i: '📤' },
                  { s: '3', t: 'แตะช่องบนปก → ลากกลางภาพ = เลื่อนรูป · สกอลล์/จีบ 2 นิ้ว = ซูม · ลากปุ่ม ✥ = ย้ายช่อง', i: '✋' },
                  { s: '4', t: 'กด ✨ ออโต้ทุกช่อง ให้แสง-สี-ความคมพอดี แล้วปรับรายช่องในแผง 🎨 ถ้ายังไม่ถูกใจ', i: '🎨' },
                  { s: '5', t: 'พิมพ์ข้อความ (ถ้าแทมเพลตรองรับ) · เพิ่มวง/กรอบแดงเน้นจุดข่าว', i: '✏️' },
                  { s: '6', t: `กด 📥 Download — ได้ภาพ ${W}×${H}px`, i: '💾' },
                ].map(x => (
                  <div key={x.s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(148,163,184,0.15)', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{x.s}</div>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>{x.i} {x.t}</span>
                  </div>
                ))}
              </div>

              <div style={{ padding: 16, borderRadius: 12, background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.12)' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#94a3b8', marginBottom: 12 }}>🎨 ปรับแสง · สี · ความคม</div>
                {[
                  { k: '✨ ออโต้', d: 'ระบบวัดแสงของรูปแล้วปรับให้พอดี + คมขึ้นเล็กน้อย — เริ่มจากปุ่มนี้เสมอ' },
                  { k: '🔎 คมชัด', d: 'ภาพแคปจากคลิป/ภาพมัว' },
                  { k: '🌤️ แก้ย้อนแสง', d: 'หน้ามืดเพราะฉากหลังสว่าง' },
                  { k: '👁 กดค้าง', d: 'ดูภาพต้นฉบับเทียบกับที่ปรับ ปล่อยมือ = กลับมา' },
                  { k: '📋 ใช้กับทุกช่อง', d: 'คัดลอกค่าของช่องนี้ไปทุกช่อง ให้ทั้งปกโทนเดียวกัน' },
                ].map(c => (
                  <div key={c.k} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                    <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 700, whiteSpace: 'nowrap' }}>{c.k}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>{c.d}</span>
                  </div>
                ))}
                <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.08)', fontSize: 12, color: '#22c55e', lineHeight: 1.6 }}>
                  🛡️ ระบบปรับภาพนี้ไม่ใช้ AI เจน/วาดภาพใหม่ — แค่ปรับค่าสีของพิกเซลเดิม รูปหน้าคนเหมือนต้นฉบับ 100%
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  ⌨️ คีย์ลัด (คอม): ลูกศร = ขยับรูปในช่องที่เลือก (กด Shift = ขยับไกล) · Delete = ลบวงแดงที่เลือก · Esc = เลิกเลือก
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
                { icon: '🎨', label: 'ปรับภาพ', desc: 'แสง สี ความคม (ไม่ใช้ AI เจนภาพ)', color: '#22c55e' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, background: `${s.color}10`, border: `1px solid ${s.color}25`, fontSize: 12 }}>
                  <span>{s.icon}</span>
                  <span style={{ fontWeight: 700, color: s.color }}>{s.label}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>— {s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ maxWidth: isWide ? 1560 : 1100, margin: '0 auto', padding: '0 16px 60px' }}>
        {/* ★ แบตช์ E (E1c): แถบโหมด recipe — เปิดงานคิวปก MEGA มาจัดต่อ */}
        {recipeMode && (
          <div style={{ marginBottom: 16, padding: 16, borderRadius: 14, background: 'linear-gradient(135deg, rgba(96,165,250,0.08), rgba(124,58,237,0.06))', border: '1px solid rgba(96,165,250,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>🗂️ แก้ต่อจากคิว: {recipeMode}</span>
              {recipe?.status && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>สถานะเดิม: {recipe.status}</span>}
              {recipe?.refStyle && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ref: {recipe.refStyle}</span>}
              {recipe?.caseId && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>เคส: {recipe.caseId}</span>}
            </div>
            {recipe?.title && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{recipe.title}</div>}
            {recipeStatus && <div style={{ fontSize: 12, color: '#facc15', marginTop: 6 }}>{recipeStatus}</div>}

            {/* แผงเหตุผล QC (โชว์เมื่อระบบตัดสินไม่ผ่าน) */}
            {recipe?.qc && recipe.qc.pass === false && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#f87171', marginBottom: 6 }}>⚠️ ระบบ QC ไม่ผ่าน — เช็คลิสต์ที่ต้องแก้</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{recipe.qc.summary}</div>
                {recipe.qc.reasons?.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    {recipe.qc.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>
            )}
            {recipe?.qc && recipe.qc.pass === true && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#4ade80' }}>✅ ระบบ QC ผ่าน — ปรับแต่งเพิ่มได้ตามใจ แล้วบันทึกทับ/เพิ่ม revision ได้</div>
            )}

            {/* คลังภาพข่าวนี้ — คลิก = ใส่ลงช่องที่เลือกอยู่ */}
            {recipe?.pool?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  🗂️ คลังภาพข่าวนี้ ({recipe.pool.length}) <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>— เลือกช่องบนปกก่อน แล้วคลิกภาพเพื่อวาง{selectedSlotId ? ` · ช่องที่เลือก: ${selectedSlotId}` : ' · (ยังไม่เลือกช่อง = ลงช่องว่างช่องแรก)'}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 200, overflowY: 'auto', padding: 4, background: 'rgba(0,0,0,0.15)', borderRadius: 8 }}>
                  {recipe.pool.map((p, i) => (
                    <button key={p.id || i} onClick={() => assignPoolUrlToSlot(p.url)}
                      title={`${p.person || ''}${p.note ? ' · ' + p.note : ''}${/supabase\.co\/storage/.test(p.url) ? ' · ✅ rehost แล้ว' : ' · ⚠️ เว็บนอก (บันทึกไม่ได้)'}`}
                      style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', width: 62, height: 78, background: '#111', position: 'relative', flexShrink: 0 }}>
                      <img src={p.thumb} alt={p.person || 'ภาพ'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      {/supabase\.co\/storage/.test(p.url) && (
                        <span style={{ position: 'absolute', top: 2, right: 2, width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '1px solid #fff' }} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* บันทึกเข้าคลัง */}
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={saveCoverToArchive} disabled={savingCover || !allSlotsFilled}
                style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: (savingCover || !allSlotsFilled) ? 'var(--bg-elevated)' : '#7c3aed', color: (savingCover || !allSlotsFilled) ? 'var(--text-muted)' : '#fff', fontSize: 13, fontWeight: 800, cursor: (savingCover || !allSlotsFilled) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {savingCover ? '⏳ กำลังบันทึก...' : '💾 บันทึกเข้าคลัง'}
              </button>
              {!allSlotsFilled && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ใส่ภาพให้ครบทุกช่องก่อน</span>}
              {saveToast && (
                <span style={{ fontSize: 12, fontWeight: 700, color: saveToast.ok ? '#4ade80' : '#f87171' }}>
                  {saveToast.ok ? '✅ ' : '❌ '}{saveToast.msg}
                  {saveToast.ok && <a href="/mega-covers" style={{ marginLeft: 8, color: '#60a5fa' }}>เปิดคลัง →</a>}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ★ 4 ก.ค.: จอเล็ก = คอลัมน์เดียว "ปกขึ้นก่อน" (order สลับ) เครื่องมือทั้งหมดอยู่ใต้ปก */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '340px 1fr', gap: 16, alignItems: 'start' }}>

          {/* ═══ LEFT ═══ */}
          <div style={{ order: isMobile ? 2 : 0, minWidth: 0 }}>
            {/* ── Template Selector ── */}
            <div style={s.card}>
              <div style={s.head}>
                ① เลือกแทมเพลต
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 'auto' }}>{templates.length} แบบ</span>
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
                  (() => {
                    const builtinIds = new Set(BUILTIN_TEMPLATES.map(t => t.id));
                    const builtins = templates.filter(t => builtinIds.has(t.id));
                    const customs = templates.filter(t => !builtinIds.has(t.id));
                    const card = (t, i, isCustom) => (
                      <div key={t.id} style={{ textAlign: 'center', position: 'relative', width: 92 }}>
                        <TemplateThumbnail template={t} isActive={templateId===t.id} onClick={() => switchTemplate(t.id)} />
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{isCustom ? `อัปโหลด ${i+1}` : `แบบ ${i+1}`} · {templateBadges(t)}</div>
                        <div style={{ fontSize: 11, color: templateId===t.id ? '#60a5fa':'var(--text-primary)', fontWeight: 700, lineHeight: 1.25, wordBreak: 'break-word' }}>
                          {isCustom ? tidyTemplateName(t, i) : t.name}
                        </div>
                        {isCustom && (
                          <>
                            <button onClick={(e) => { e.stopPropagation(); handleRenameTemplate(t); }} title="ตั้งชื่อแทมเพลต"
                              style={{ position: 'absolute', top: -6, right: 16, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(96,165,250,0.85)', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: '18px', padding: 0 }}>✏️</button>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id); }} title="ลบแทมเพลต"
                              style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(239,68,68,0.8)', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: '18px', padding: 0 }}>×</button>
                          </>
                        )}
                      </div>
                    );
                    return (
                      <div style={{ width: '100%' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>📐 แม่แบบมาตรฐาน ({builtins.length})</div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{builtins.map((t, i) => card(t, i, false))}</div>
                        {customs.length > 0 && (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', margin: '14px 0 8px', paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                              📤 แทมเพลตอัปโหลดเอง ({customs.length}) <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>— กด ✏️ ตั้งชื่อ / × ลบ</span>
                            </div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{customs.map((t, i) => card(t, i, true))}</div>
                          </>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
              {/* Upload new template button */}
              <div style={{ padding: '8px 18px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '10px 16px', borderRadius: 10,
                  border: '2px dashed rgba(96,165,250,0.3)',
                  background: 'rgba(96,165,250,0.05)',
                  color: '#60a5fa', fontSize: 12, fontWeight: 700,
                  cursor: uploadingTemplate ? 'wait' : 'pointer',
                  transition: 'all .15s',
                  opacity: uploadingTemplate ? 0.6 : 1,
                }}>
                  {uploadingTemplate ? uploadProgress : '➕ อัพโหลดแทมเพลตใหม่ (AI วิเคราะห์อัตโนมัติ)'}
                  <input type="file" accept="image/*" onChange={handleUploadTemplate} disabled={uploadingTemplate} style={{ display: 'none' }} />
                </label>
                {template && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                      📐 {template.name} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {templateBadges(template)}</span>
                    </div>
                    {template.hint && <div>🎯 เหมาะกับ: {template.hint}</div>}
                    <div>{template.desc}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {template.slots.map(sl => (
                        <span key={sl.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{sl.label}</span>
                      ))}
                      {(template.textSlots || []).map(ts => (
                        <span key={ts.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: '1px dashed var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{ts.label}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Image Upload ── */}
            <div style={s.card}>
              <div style={s.head}>② อัปโหลดรูป <span style={{ fontSize:11, fontWeight:400, color:'var(--text-muted)', marginLeft:'auto' }}>{template ? `${Object.keys(slotImages).filter(k => template.slots.some(sl => sl.id===k)).length}/${template.slots.length}` : '0/0'}</span></div>
              <div style={s.body}>
                {/* ★ E3a: ดึงคลังภาพจากเคส MEGA มาเป็นพูลเลือกรูปรายช่อง — ใช้ได้ทุกโหมด (เหนือโซนอัปโหลด) */}
                <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, border: '1px dashed rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.04)' }}>
                  {poolItems.length > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa' }}>🗂️ คลังภาพพร้อมใช้: {poolItems.length} ใบ</span>
                      {poolCaseName && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {poolCaseName}</span>}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexBasis: '100%' }}>กดปุ่ม “เลือกรูป” ของแต่ละช่อง จะเปิดคลังนี้ให้เลือก</span>
                      <button onClick={openCasePicker} disabled={poolLoading}
                        style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: poolLoading ? 'wait' : 'pointer', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                        {poolLoading ? '⏳ กำลังดึง...' : '🔄 เปลี่ยนเคส'}
                      </button>
                    </div>
                  ) : (
                    <button onClick={openCasePicker} disabled={poolLoading}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: poolLoading ? 'wait' : 'pointer', border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.06)', color: '#60a5fa' }}>
                      {poolLoading ? '⏳ กำลังดึงคลังภาพ...' : '🗂️ ดึงคลังภาพจากเคส'}
                    </button>
                  )}
                  {casePickerOpen && (
                    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>เลือกเคสข่าว</span>
                        <button onClick={() => setCasePickerOpen(false)}
                          style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 8, fontSize: 11, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>✕ ปิด</button>
                      </div>
                      {caseListLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>⏳ กำลังโหลดรายชื่อเคส...</div>}
                      {caseListErr && <div style={{ fontSize: 12, color: '#f87171' }}>{caseListErr}</div>}
                      {!caseListLoading && caseList && caseList.length === 0 && !caseListErr && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>ไม่พบเคส</div>
                      )}
                      {caseList && caseList.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                          {caseList.map((cs) => (
                            <button key={cs.id} onClick={() => loadCasePool(cs)} disabled={poolLoading}
                              style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', cursor: poolLoading ? 'wait' : 'pointer', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                              <span style={{ fontWeight: 700 }}>{cs.id}</span>
                              {cs.headline ? <span style={{ color: 'var(--text-muted)' }}> · {cs.headline}</span> : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* ★ 14 พ.ย. 69: อัปโหลดหลายรูปครั้งเดียว — เติมช่องว่างตามลำดับ (ภาพหลักก่อน) */}
                <label style={{ display:'block', marginBottom: 6, padding:'11px 14px', borderRadius:10, border:'1px solid rgba(96,165,250,0.4)', background:'rgba(96,165,250,0.1)', color:'#60a5fa', fontSize:13, fontWeight:800, cursor:'pointer', textAlign:'center' }}>
                  📤 อัปโหลดหลายรูปทีเดียว
                  <input type="file" accept="image/*" multiple style={{ display:'none' }}
                    onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
                </label>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.6, textAlign: 'center' }}>
                  ระบบเติมช่องว่างให้ตามลำดับ{isMobile ? '' : ' · ลากไฟล์มาวางบนปกได้ · ก๊อปรูปแล้วกด Ctrl+V ได้'}
                </div>
                {uiSlots.map(slot => (
                  <div key={slot.id} style={{ marginBottom: 16 }}>
                    <label style={s.label}>
                      {slot.label}
                      {slot.draggable && <span style={{ color:'#94a3b8', marginLeft:6, fontSize:11 }}>🔀 ลาก+ปรับขนาดได้</span>}
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {/* ★ E3b: มีพูล = เปิด modal เลือกรูป (preventDefault กันเปิด file dialog) · ไม่มีพูล = file input เดิมเป๊ะ */}
                      <label
                        onClick={(e) => { if (poolItems.length) { e.preventDefault(); setPickerSlotId(slot.id); } }}
                        style={{
                        flex:1, padding:'10px 14px', borderRadius:10,
                        border: slotImages[slot.id] ? '1px solid rgba(96,165,250,0.3)':'1px dashed var(--border)',
                        background: slotImages[slot.id] ? 'rgba(96,165,250,0.06)':'var(--bg-primary)',
                        color: slotImages[slot.id] ? '#60a5fa':'var(--text-muted)',
                        fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'center', transition:'all .15s',
                      }}>
                        {slotImages[slot.id] ? `✅ ${slotImages[slot.id].naturalWidth}×${slotImages[slot.id].naturalHeight}` : (poolItems.length ? '🗂️ เลือกรูป' : '📷 เลือกรูป')}
                        <input type="file" accept="image/*" style={{display:'none'}}
                          ref={el => fileRefs.current[slot.id]=el}
                          onChange={e => { handleFile(slot.id, e.target.files?.[0]); e.target.value = ''; }} />
                      </label>
                      {slotImages[slot.id] && (
                        <>
                          {/* ★ 14 พ.ย. 69: แทนปุ่ม AI Enhance 2x/4x/Auto — เปิดแผงปรับแสง/สี/ความคมของช่องนี้ (ไม่มี AI เจนภาพ) */}
                          {(() => {
                            const on = !!slotAdjust[slot.id] && !isNeutralAdjust(slotAdjust[slot.id]);
                            return (
                              <button onClick={() => focusTools(slot.id)} title="ปรับแสง สี ความคม ของรูปนี้"
                                style={{ padding:'8px 10px', borderRadius:10, whiteSpace:'nowrap',
                                  border: `1px solid ${on ? 'rgba(34,197,94,0.5)' : 'rgba(34,197,94,0.3)'}`,
                                  background: on ? 'rgba(34,197,94,0.14)' : 'rgba(34,197,94,0.06)',
                                  color:'#22c55e', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                                🎨 ปรับภาพ{on ? ' ✓' : ''}
                              </button>
                            );
                          })()}
                          <button onClick={() => removeImage(slot.id)} style={{ padding:'8px 10px', borderRadius:10, border:'1px solid rgba(239,68,68,0.3)', background:'rgba(239,68,68,0.06)', color:'#f87171', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
                        </>
                      )}
                    </div>
                    {/* ★ 6 ก.ค. รอบ 2: เฟดรายขอบ ตรงนี้เลย (จุดที่คนทำงานจริง) — รูปไหนเฟด รูปไหนคม เลือกอิสระ */}
                    {slotImages[slot.id] && renderFadeEdges(slot)}
                    {/* Small image warning */}
                    {slotImages[slot.id] && (() => {
                      const iw = slotImages[slot.id].naturalWidth || 0;
                      const ih = slotImages[slot.id].naturalHeight || 0;
                      const maxDim = Math.max(iw, ih);
                      if (!(maxDim > 0 && maxDim < 600)) return null;
                      const very = maxDim < 300;
                      // ★ 14 พ.ย. 69: เดิมแนะนำให้กด AI เพิ่มความชัด — เปลี่ยนเป็นคำแนะนำที่ไม่ทำให้หน้าคนเพี้ยน
                      return (
                        <div style={{ marginTop:4, padding:'4px 10px', borderRadius:6, background: very ? 'rgba(239,68,68,0.1)' : 'rgba(148,163,184,0.08)', border: `1px solid ${very ? 'rgba(239,68,68,0.2)' : 'rgba(148,163,184,0.2)'}`, fontSize:11, color: very ? '#f87171' : '#94a3b8', fontWeight:600, lineHeight:1.6 }}>
                          ⚠️ ภาพ{very ? 'เล็กมาก' : 'เล็ก'} ({iw}×{ih}) — {very ? 'ขยายเต็มช่องจะแตก ควรหาภาพใหญ่กว่านี้ หรือใช้ในช่องเล็ก/วงกลม' : 'ใช้ช่องเล็กจะคมกว่า · กด 🎨 ปรับภาพ → 🔎 คมชัด ช่วยได้ระดับหนึ่ง'}
                        </div>
                      );
                    })()}
                    {/* Scale controls for draggable */}
                    {slot.draggable && slotImages[slot.id] && (
                      <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:8, padding:'6px 10px', background:'rgba(148,163,184,0.04)', borderRadius:8, border:'1px solid rgba(148,163,184,0.12)' }}>
                        <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600, whiteSpace:'nowrap' }}>📐 ขนาด</span>
                        <button onClick={() => adjustScale(slot.id, -0.1)} style={s.scaleBtn}>−</button>
                        <div style={{ flex:1, textAlign:'center', fontSize:12, fontWeight:700, color:'var(--text-primary)', minWidth:40 }}>
                          {Math.round((slotScales[slot.id]||1)*100)}%
                        </div>
                        <button onClick={() => adjustScale(slot.id, 0.1)} style={s.scaleBtn}>+</button>
                        <button onClick={() => setSlotScales(prev => ({...prev,[slot.id]:1}))} style={{ ...s.scaleBtn, fontSize:11, width:36 }} title="รีเซ็ต">↺</button>
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
                            <span style={{ fontSize:11, color:'#60a5fa', fontWeight:600 }}>🔍</span>
                            <button onClick={() => setSlotCrops(prev => {
                              const old = prev[slot.id] || { zoom: 1, panX: 0, panY: 0 };
                              return { ...prev, [slot.id]: { ...old, zoom: Math.max(1, Math.round((old.zoom - 0.2) * 10) / 10) } };
                            })} style={s.scaleBtn}>−</button>
                            <div style={{ flex:1, textAlign:'center', fontSize:12, fontWeight:700, color: (crop.zoom||1) > 1 ? '#60a5fa' : 'var(--text-muted)' }}>
                              {(crop.zoom||1).toFixed(1)}x
                            </div>
                            <button onClick={() => setSlotCrops(prev => {
                              const old = prev[slot.id] || { zoom: 1, panX: 0, panY: 0 };
                              return { ...prev, [slot.id]: { ...old, zoom: Math.min(5, Math.round((old.zoom + 0.2) * 10) / 10) } };
                            })} style={s.scaleBtn}>+</button>
                            {!isDefault && (
                              <button onClick={() => setSlotCrops(prev => ({...prev, [slot.id]: { zoom: 1, panX: 0, panY: 0 }}))} style={{ ...s.scaleBtn, fontSize:11, width:28 }} title="รีเซ็ต">↺</button>
                            )}
                          </div>
                          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4, textAlign:'center' }}>
                            🖱️ ลากบนปก = เลื่อนภาพ • Scroll = ซูม
                          </div>
                        </div>
                      );
                    })()}
                    {/* ── Position Offset Controls ── */}
                    {slotImages[slot.id] && (() => {
                      const off = slotOffsets[slot.id] || { dx: 0, dy: 0 };
                      const hasOff = !!(off.dx || off.dy); // ★ 14 พ.ย. 69: เดิมได้ค่า 0 แล้ว React พิมพ์เลข "0" ลอยอยู่ท้ายแถวปุ่ม
                      const moveSlot = (axis, delta) => {
                        setSlotOffsets(prev => {
                          const old = prev[slot.id] || { dx: 0, dy: 0 };
                          return { ...prev, [slot.id]: { ...old, [axis]: (old[axis] || 0) + delta } };
                        });
                      };
                      return (
                        <div style={{ marginTop:4, padding:'4px 10px', background:'rgba(148,163,184,0.04)', borderRadius:8, border:'1px solid rgba(148,163,184,0.12)', display:'flex', gap:4, alignItems:'center' }}>
                          <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600, width:32 }}>📐</span>
                          <button onClick={() => moveSlot('dx', -30)} style={s.scaleBtn} title="เลื่อนซ้าย">◀</button>
                          <button onClick={() => moveSlot('dy', -30)} style={s.scaleBtn} title="เลื่อนขึ้น">▲</button>
                          <button onClick={() => moveSlot('dy', 30)} style={s.scaleBtn} title="เลื่อนลง">▼</button>
                          <button onClick={() => moveSlot('dx', 30)} style={s.scaleBtn} title="เลื่อนขวา">▶</button>
                          {hasOff && (
                            <>
                              <button onClick={() => setSlotOffsets(prev => ({...prev, [slot.id]: {dx:0,dy:0}}))} style={{...s.scaleBtn, fontSize:11, width:28}} title="รีเซ็ต">↺</button>
                              <span style={{ fontSize:10, color:'var(--text-muted)', marginLeft:2 }}>
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
                      <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:6, padding:'6px 10px', background:'rgba(96,165,250,0.04)', borderRadius:8, border:'1px solid rgba(96,165,250,0.12)', flexWrap:'wrap' }}>
                        <span style={{ fontSize:11, color:'#60a5fa', fontWeight:600, whiteSpace:'nowrap' }}>🔤 ขนาด</span>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], fontSize: Math.max(20, curSize - 4)}}))} style={s.scaleBtn}>−</button>
                        <span style={{ fontSize:12, fontWeight:700, color:'var(--text-primary)', minWidth:30, textAlign:'center' }}>{curSize}</span>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], fontSize: Math.min(80, curSize + 4)}}))} style={s.scaleBtn}>+</button>
                        <span style={{ width:1, height:16, background:'var(--border)', margin:'0 4px' }} />
                        <span style={{ fontSize:11, color:'#60a5fa', fontWeight:600, whiteSpace:'nowrap' }}>🎨 สี</span>
                        <input type="color" value={curColor}
                          onChange={e => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], color: e.target.value}}))}
                          style={{ width:24, height:24, border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', padding:0, background:'none' }} />
                      </div>
                      {/* Position controls */}
                      <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:4, padding:'6px 10px', background:'rgba(96,165,250,0.04)', borderRadius:8, border:'1px solid rgba(96,165,250,0.12)' }}>
                        <span style={{ fontSize:11, color:'#60a5fa', fontWeight:600, whiteSpace:'nowrap' }}>📍 ตำแหน่ง</span>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], dy: (ov.dy||0) - 30}}))} style={s.scaleBtn}>▲</button>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], dy: (ov.dy||0) + 30}}))} style={s.scaleBtn}>▼</button>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], dx: (ov.dx||0) - 30}}))} style={s.scaleBtn}>◀</button>
                        <button onClick={() => setTextOverrides(p => ({...p,[ts.id]:{...p[ts.id], dx: (ov.dx||0) + 30}}))} style={s.scaleBtn}>▶</button>
                        {!!(ov.dx || ov.dy) && <span style={{ fontSize:10, color:'var(--text-muted)' }}>x{ov.dx>0?'+':''}{ov.dx||0} y{ov.dy>0?'+':''}{ov.dy||0}</span>}
                        {(ov.fontSize || ov.color || ov.dx || ov.dy) && (
                          <button onClick={() => setTextOverrides(p => { const n={...p}; delete n[ts.id]; return n; })}
                            style={{ fontSize:11, padding:'2px 8px', borderRadius:4, border:'1px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer', fontFamily:'inherit', marginLeft:'auto' }}>↺ รีเซ็ต</button>
                        )}
                      </div>
                      {/* Color picker for editable bg */}
                      {(ts.bg || ts.bgEditable) && (
                        <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:4, padding:'6px 10px', background:'rgba(255,215,0,0.04)', borderRadius:8, border:'1px solid rgba(255,215,0,0.12)' }}>
                          <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600, whiteSpace:'nowrap' }}>🎨 สีแถบ</span>
                          <input type="color" value={textBgColors[ts.id] || ts.bg || '#1a1a2e'}
                            onChange={e => setTextBgColors(p => ({...p,[ts.id]:e.target.value}))}
                            style={{ width:24, height:24, border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', padding:0, background:'none' }} />
                          <span style={{ fontSize:11, color:'var(--text-muted)', flex:1 }}>{textBgColors[ts.id] || ts.bg || 'default'}</span>
                          {textBgColors[ts.id] && (
                            <button onClick={() => setTextBgColors(p => { const n={...p}; delete n[ts.id]; return n; })}
                              style={{ fontSize:11, padding:'2px 8px', borderRadius:4, border:'1px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer', fontFamily:'inherit' }}>↺</button>
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
              <div style={{ padding:'10px 14px', borderRadius:10, marginBottom:12, background:'rgba(148,163,184,0.06)', border:'1px solid rgba(148,163,184,0.2)', fontSize:12, color:'#94a3b8', lineHeight:1.7 }}>
                🔀 เลือกช่องก่อน แล้ว<strong>ลากปุ่ม ✥</strong> = ย้ายทั้งช่อง/วง &nbsp;|&nbsp; ลาก<strong>กลางภาพ</strong> = เลื่อนรูปในช่อง &nbsp;|&nbsp; ลาก<strong>ขอบ/มุม</strong> = ปรับขนาด
                {(hasOffsets || hasScaleChanges) && (
                  <button onClick={resetAll} style={{ display:'block', marginTop:6, padding:'4px 12px', borderRadius:6, border:'1px solid rgba(148,163,184,0.3)', background:'rgba(148,163,184,0.1)', color:'#94a3b8', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>🔄 รีเซ็ตตำแหน่ง+ขนาดทั้งหมด</button>
                )}
              </div>
            )}

            {/* ── Download ── */}
            <button onClick={handleDownload} disabled={!allSlotsFilled} style={{
              width:'100%', padding:'16px', borderRadius:12, border:'none',
              background: allSlotsFilled ? '#2563eb' : 'var(--bg-elevated)',
              color: allSlotsFilled ? '#fff' : 'var(--text-muted)',
              fontWeight:900, fontSize:15, cursor: allSlotsFilled ? 'pointer':'not-allowed',
              fontFamily:'inherit', transition:'all .2s',
              boxShadow: allSlotsFilled ? '0 6px 25px rgba(96,165,250,0.25)':'none',
            }}>
              {downloaded ? '✅ ดาวน์โหลดแล้ว!' : `📥 ดาวน์โหลดปก (${W}×${H})`}
            </button>

            <div style={{ marginTop:12, padding:'12px 14px', background:'rgba(96,165,250,0.04)', borderRadius:10, fontSize:12, color:'var(--text-muted)', lineHeight:1.8 }}>
              💡 <strong style={{ color:'var(--text-secondary)' }}>วิธีใช้:</strong><br/>
              1. เลือกแทมเพลต (แบบ 1-{templates.length})<br/>
              2. อัปโหลดรูปแต่ละช่อง<br/>
              3. เลือกช่อง → ลากปุ่ม ✥ = ย้ายทั้งวง · ลากกลาง = เลื่อนรูปในช่อง · ลากมุม = ปรับขนาด<br/>
              4. กด ✨ ออโต้ทุกช่อง / 🎨 ปรับภาพ ให้แสง-สี-ความคมพอดี<br/>
              5. กดดาวน์โหลด JPEG คุณภาพสูง
            </div>
          </div>

          {/* ═══ RIGHT: Canvas ═══ */}
          <div style={{ ...s.card, position: isMobile ? 'static' : 'sticky', top: 70, alignSelf: 'start', order: isMobile ? 1 : 0, minWidth: 0 }}>
            <div style={s.head}>
              ตัวอย่างปก
              <span style={{ fontSize:11, fontWeight:400, color:'var(--text-muted)', marginLeft:'auto' }}>{W}×{H}px • {template?.name || '—'}</span>
            </div>
            {/* ★ 14 พ.ย. 69: จอกว้าง (≥1280) = ปกพอดีความสูงจอ + เครื่องมืออยู่ข้างปก เห็นพร้อมกันไม่ต้องเลื่อนลงไปหา
                จอแคบ/มือถือ = เรียงลงมาเหมือนเดิม (ปก → ชิปช่อง → เครื่องมือ) */}
            <div style={{ ...s.body, ...(isWide
              ? { display:'grid', gridTemplateColumns:'minmax(0,1fr) 400px', gap:14, alignItems:'start' }
              : { display:'flex', flexDirection:'column', gap:12 }) }}>
              <div style={{
                ...(isWide ? { width:'min(100%, calc((100vh - 205px) * 0.8))', justifySelf:'center' } : {}),
                borderRadius:12, overflow:'hidden',
                border: dropActive ? '2px dashed #facc15' : allSlotsFilled ? '2px solid #60a5fa':'2px dashed rgba(255,255,255,0.08)',
                background:'#111119',
                cursor: dragState ? (dragState.mode==='resize' ? 'nwse-resize':'grabbing') : hoverCursor,
              }}>
                <canvas ref={canvasRef} width={W} height={H}
                  style={{ width:'100%', height:'auto', display:'block', touchAction:'none' }}
                  onMouseDown={e => { if (e.button === 0) handleDown(e.clientX, e.clientY); }}
                  onMouseMove={e => handleMove(e.clientX, e.clientY)}
                  onDragOver={e => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dropActive) setDropActive(true); } }}
                  onDragLeave={() => setDropActive(false)}
                  onDrop={e => {
                    // ★ 14 พ.ย. 69: ลากไฟล์รูปจากเครื่องมาปล่อยบนช่อง = ใส่รูปช่องนั้นทันที (หลายไฟล์ = เติมช่องว่างต่อ)
                    const files = e.dataTransfer?.files;
                    setDropActive(false);
                    if (!files || !files.length) return;
                    e.preventDefault();
                    const { mx, my } = getCoords(e.clientX, e.clientY);
                    handleFiles(files, slotAtPoint(mx, my)?.id);
                  }}
                  onTouchStart={e => {
                    // ★ 4 ก.ค.: จีบ 2 นิ้ว = ซูมภาพในช่อง (มือถือไม่มีสกอลล์เมาส์)
                    if (e.touches.length === 2) {
                      const [a, b] = [e.touches[0], e.touches[1]];
                      const { mx, my } = getCoords((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
                      const slot = hitTestAll(mx, my) || (selectedSlotId ? template?.slots.find(sl => sl.id === selectedSlotId && slotImages[sl.id]) : null);
                      if (slot) {
                        pinchRef.current = { slotId: slot.id, startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), startZoom: slotCrops[slot.id]?.zoom || 1 };
                        setDrag(null); // ยกเลิกลากนิ้วเดียวที่เริ่มไว้ก่อนนิ้วที่สองแตะ
                        setSelectedSlotId(slot.id);
                      }
                      return;
                    }
                    const t = e.touches[0]; handleDown(t.clientX, t.clientY);
                  }}
                  onTouchMove={e => {
                    e.preventDefault();
                    if (pinchRef.current && e.touches.length === 2) {
                      const [a, b] = [e.touches[0], e.touches[1]];
                      const ratio = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / Math.max(1, pinchRef.current.startDist);
                      const z = Math.max(1, Math.min(5, +(pinchRef.current.startZoom * ratio).toFixed(2)));
                      const sid = pinchRef.current.slotId;
                      setSlotCrops(prev => ({ ...prev, [sid]: { ...(prev[sid] || { panX: 0, panY: 0 }), zoom: z } }));
                      return;
                    }
                    const t = e.touches[0]; handleMove(t.clientX, t.clientY);
                  }}
                  onTouchEnd={e => { if (!e.touches || e.touches.length < 2) pinchRef.current = null; handleUp(); }}
                />
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:12, minWidth:0, ...(isWide ? { maxHeight:'calc(100vh - 150px)', overflowY:'auto', paddingRight:4 } : {}) }}>
              {/* ★ 4 ก.ค. — ชิปเลือกช่อง + แถบสถานะ + แผงเครื่องมือรวม (มือถือครบจบใต้ปก · PC ก็ใช้ได้) */}
              {template && (
                <div>
                  {/* ★ 6 ก.ค. — 🧺 ถาดภาพจากคลังค้นรูป: แตะรูป → แตะชิปช่อง = วางทันที */}
                  {tray.length > 0 && (
                    <div style={{ marginBottom: 8, padding: 9, borderRadius: 11, border: '1px solid rgba(250,204,21,0.35)', background: 'rgba(250,204,21,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#facc15' }}>🧺 ภาพจากคลังค้นรูป ({tray.length})</span>
                        <span style={{ fontSize: 11, color: armedTray != null ? '#facc15' : 'var(--text-muted)', fontWeight: armedTray != null ? 700 : 400 }}>
                          {armedTray != null ? '👉 แตะชิปช่องด้านล่าง เพื่อวางรูปนี้ลงช่อง' : 'แตะรูป แล้วแตะช่องที่จะวาง · วางทับช่องเดิม = เปลี่ยนรูป'}
                        </span>
                        <button onClick={() => { setTray([]); setArmedTray(null); try { localStorage.removeItem('acs_picked_images'); } catch { /* เงียบ */ } }}
                          style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 8, fontSize: 11, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                          ✕ ปิดถาด
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                        {tray.map((t, i) => (
                          <img key={i} src={t.thumb || t.url} alt="" loading="lazy"
                            onClick={() => setArmedTray(armedTray === i ? null : i)}
                            style={{ width: 62, height: 62, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                              border: armedTray === i ? '3px solid #facc15' : '1px solid var(--border)', opacity: armedTray === i ? 1 : 0.9 }} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {template.slots.map(sl => {
                      const has = !!slotImages[sl.id];
                      const sel = selectedSlotId === sl.id;
                      const armed = armedTray != null;
                      const shortLabel = String(sl.label).replace(/\(.*?\)/g, '').trim().slice(0, 16);
                      return (
                        <button key={sl.id} onClick={() => { if (armed) assignTrayToSlot(sl.id); else setSelectedSlotId(sel ? null : sl.id); }} style={{
                          padding: '8px 11px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                          border: armed ? '2px dashed #facc15' : sel ? '2px solid #60a5fa' : has ? '1px solid rgba(96,165,250,0.4)' : '1px dashed var(--border)',
                          background: armed ? 'rgba(250,204,21,0.08)' : sel ? 'rgba(96,165,250,0.15)' : has ? 'rgba(96,165,250,0.08)' : 'var(--bg-primary)',
                          color: armed ? '#facc15' : sel ? '#60a5fa' : has ? '#60a5fa' : 'var(--text-muted)',
                        }}>
                          {armed ? '📥 ' : ''}{shortLabel} {has ? '✓' : '＋'}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 7, lineHeight: 1.6 }}>
                    {(() => {
                      const sl = template.slots.find(x => x.id === selectedSlotId);
                      if (!sl) return '👆 แตะช่องบนปก/กดชิป เพื่อเลือกช่อง · แล้วลากปุ่ม ✥=ย้ายทั้งวง · ลาก 1 นิ้วกลางภาพ=เลื่อนรูปในช่อง · จีบ 2 นิ้ว/สกอลล์=ซูม';
                      const crop = slotCrops[sl.id] || {};
                      const modeTxt = dragState ? (dragState.mode === 'crop' ? ' · 🖐️ กำลังเลื่อนภาพ' : dragState.mode === 'move' ? ' · ✋ กำลังย้ายช่อง' : dragState.mode === 'resize' ? ' · ↔️ กำลังปรับขนาด' : '') : '';
                      return <span style={{ color: '#60a5fa', fontWeight: 700 }}>✏️ กำลังแต่ง: {sl.label} · ซูม {(crop.zoom || 1).toFixed(1)}x{modeTxt}</span>;
                    })()}
                  </div>
                  {(() => {
                    const sl = template.slots.find(x => x.id === selectedSlotId);
                    if (!sl) return null;
                    const img = slotImages[sl.id];
                    const crop = slotCrops[sl.id] || { zoom: 1, panX: 0, panY: 0 };
                    const bump = (axis, d) => setSlotCrops(prev => { const old = prev[sl.id] || { zoom: 1, panX: 0, panY: 0 }; return { ...prev, [sl.id]: { ...old, [axis]: (old[axis] || 0) + d } }; });
                    // ★ 19 ก.ค.: ขยับตำแหน่ง "ทั้งช่อง/วง" (คนละอันกับเลื่อนรูปในช่อง) — ปุ่มกดชัด ไม่ต้องเล็งลากขอบวง
                    const nudgeSlot = (axis, d) => setSlotOffsets(prev => { const old = prev[sl.id] || { dx: 0, dy: 0 }; return { ...prev, [sl.id]: { ...old, [axis]: (old[axis] || 0) + d } }; });
                    const zoomBy = (d) => setSlotCrops(prev => { const old = prev[sl.id] || { zoom: 1, panX: 0, panY: 0 }; return { ...prev, [sl.id]: { ...old, zoom: Math.max(1, Math.min(5, +(old.zoom + d).toFixed(1))) } }; });
                    const bigBtn = { ...s.scaleBtn, width: 40, height: 40, fontSize: 18, borderRadius: 9 };
                    return (
                      <div ref={toolsRef} style={{ marginTop: 9, padding: 11, borderRadius: 11, background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.22)', scrollMarginTop: 80 }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          {/* ★ E3b: มีพูล = เปิด modal เลือกรูป · ไม่มีพูล = file input เดิม */}
                          <label
                            onClick={(e) => { if (poolItems.length) { e.preventDefault(); setPickerSlotId(sl.id); } }}
                            style={{ padding: '10px 13px', borderRadius: 9, border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            {poolItems.length ? '🗂️ ' : '📷 '}{img ? 'เปลี่ยนรูป' : 'เลือกรูป'}
                            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { handleFile(sl.id, e.target.files?.[0]); e.target.value = ''; }} />
                          </label>
                          {img && <>
                            {/* ★ 14 พ.ย. 69: แทนปุ่ม "✨ คมชัด" (AI) — ออโต้แบบสูตรพิกเซล เห็นผลทันที ไม่ส่งภาพออกนอกเครื่อง */}
                            {(() => {
                              const on = adjustKey(slotAdjust[sl.id]) === adjustKey(ADJUST_PRESETS[0].adj);
                              return (
                                <button onClick={() => setAdjustFor(sl.id, on ? null : { ...ADJUST_PRESETS[0].adj })} title={ADJUST_PRESETS[0].hint}
                                  style={{ ...bigBtn, width: 'auto', padding: '0 13px', fontSize: 12, color: '#22c55e', border: `1px solid ${on ? '#22c55e' : 'rgba(34,197,94,0.3)'}`, background: on ? 'rgba(34,197,94,0.14)' : bigBtn.background }}>
                                  ✨ ปรับอัตโนมัติ{on ? ' ✓' : ''}
                                </button>
                              );
                            })()}
                            <button onClick={() => removeImage(sl.id)} style={{ ...bigBtn, width: 'auto', padding: '0 13px', fontSize: 12, color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>🗑 ลบ</button>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{img.naturalWidth}×{img.naturalHeight}</span>
                          </>}
                        </div>
                        {img && (
                          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontSize: 12, color: '#60a5fa', fontWeight: 700 }}>🔍 ซูม</span>
                              <button onClick={() => zoomBy(-0.2)} style={bigBtn}>−</button>
                              <span style={{ fontSize: 13, fontWeight: 800, minWidth: 38, textAlign: 'center', color: 'var(--text-primary)' }}>{(crop.zoom || 1).toFixed(1)}x</span>
                              <button onClick={() => zoomBy(0.2)} style={bigBtn}>＋</button>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontSize: 12, color: '#60a5fa', fontWeight: 700 }}>🖐️ เลื่อนรูปในช่อง</span>
                              <button onClick={() => bump('panX', -40)} style={bigBtn}>◀</button>
                              <button onClick={() => bump('panY', -40)} style={bigBtn}>▲</button>
                              <button onClick={() => bump('panY', 40)} style={bigBtn}>▼</button>
                              <button onClick={() => bump('panX', 40)} style={bigBtn}>▶</button>
                            </div>
                            {sl.draggable && (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700 }}>✥ ย้ายทั้งช่อง</span>
                                <button onClick={() => nudgeSlot('dx', -30)} style={bigBtn}>◀</button>
                                <button onClick={() => nudgeSlot('dy', -30)} style={bigBtn}>▲</button>
                                <button onClick={() => nudgeSlot('dy', 30)} style={bigBtn}>▼</button>
                                <button onClick={() => nudgeSlot('dx', 30)} style={bigBtn}>▶</button>
                              </div>
                            )}
                            {sl.draggable && (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>📐 ขนาดช่อง</span>
                                <button onClick={() => adjustScale(sl.id, -0.1)} style={bigBtn}>−</button>
                                <span style={{ fontSize: 13, fontWeight: 800, minWidth: 44, textAlign: 'center', color: 'var(--text-primary)' }}>{Math.round((slotScales[sl.id] || 1) * 100)}%</span>
                                <button onClick={() => adjustScale(sl.id, 0.1)} style={bigBtn}>＋</button>
                              </div>
                            )}
                            <button onClick={() => { setSlotCrops(p => ({ ...p, [sl.id]: { zoom: 1, panX: 0, panY: 0 } })); setSlotOffsets(p => ({ ...p, [sl.id]: { dx: 0, dy: 0 } })); setSlotScales(p => ({ ...p, [sl.id]: 1 })); }}
                              style={{ ...bigBtn, width: 'auto', padding: '0 13px', fontSize: 12 }}>↺ รีเซ็ตช่องนี้</button>
                          </div>
                        )}
                        {/* ★ 14 พ.ย. 69: แผงปรับแสง · สี · ความคม ของช่องนี้ */}
                        {img && (
                          <AdjustPanel
                            adj={slotAdjust[sl.id]}
                            onChange={(next) => setAdjustFor(sl.id, next)}
                            canApplyAll={filledCount > 1}
                            onApplyAll={() => applyAdjustToAll(slotAdjust[sl.id], 'ใช้ค่าปรับภาพกับ')}
                            onCompare={setCompareOriginal}
                            comparing={compareOriginal}
                            autoAvailable={getAutoLevelsForImage(img) != null}
                          />
                        )}
                        {/* ★ 4 ก.ค. รอบ 2 — ลูกเล่นรายช่อง: เฟด / สีขอบ / ขาวดำไว้อาลัย */}
                        {img && (
                          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                            {/* ★ 6 ก.ค. รอบ 2 (ผู้ใช้สั่ง): เฟดรายขอบอิสระ — ทุกช่องทุกแทมเพลต (ตัวเดียวกับรายการช่องซ้าย) */}
                            {renderFadeEdges(sl)}
                            {sl.border && (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>🎨 สีขอบ</span>
                                <input type="color" value={slotBorderColors[sl.id] || sl.border || '#ffffff'}
                                  onChange={e => setSlotBorderColors(p => ({ ...p, [sl.id]: e.target.value }))}
                                  style={{ width: 34, height: 34, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', padding: 0, background: 'none' }} />
                                {slotBorderColors[sl.id] && (
                                  <button onClick={() => setSlotBorderColors(p => { const n = { ...p }; delete n[sl.id]; return n; })} style={{ ...bigBtn, width: 34, height: 34, fontSize: 12 }}>↺</button>
                                )}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 700 }}>🕯️ ขาวดำช่องนี้</span>
                              <input type="range" min="0" max="100" step="10" value={Math.round((slotGray[sl.id] || 0) * 100)}
                                onChange={e => setSlotGray(p => ({ ...p, [sl.id]: Number(e.target.value) / 100 }))}
                                style={{ width: 110 }} />
                              <span style={{ fontSize: 12, fontWeight: 800, minWidth: 34, color: (slotGray[sl.id] || 0) > 0 ? '#cbd5e1' : 'var(--text-muted)' }}>{Math.round((slotGray[sl.id] || 0) * 100)}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ★ 4 ก.ค. รอบ 2 — 🎛️ ลูกเล่นทั้งใบ: เฟดรวม · โทนไว้อาลัย · วง/กรอบแดงเน้นจุดข่าว */}
                  <div style={{ marginTop: 9, padding: 11, borderRadius: 11, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={() => setFadeAllOff(v => !v)}
                        style={{ padding: '9px 13px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                          border: `1px solid ${fadeAllOff ? 'rgba(239,68,68,0.4)' : 'rgba(96,165,250,0.35)'}`,
                          background: fadeAllOff ? 'rgba(239,68,68,0.1)' : 'rgba(96,165,250,0.06)',
                          color: fadeAllOff ? '#f87171' : '#60a5fa' }}>
                        🌫️ เฟดขอบภาพทั้งใบ: {fadeAllOff ? 'ปิดหมด (ขอบคม)' : 'เปิด'}
                      </button>
                      {/* ★ 6 ก.ค. ระดับเฟดทั้งใบ — ใช้กับทุกช่องที่ไม่ได้ตั้งสไลเดอร์ของตัวเอง */}
                      {!fadeAllOff && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>ระดับเฟด</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>น้อย</span>
                          <input type="range" min="10" max="150" step="10" value={fadeAllLevel}
                            onChange={e => setFadeAllLevel(Number(e.target.value))} style={{ width: 110 }} />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>มาก</span>
                          <span style={{ fontSize: 12, fontWeight: 800, minWidth: 38, color: fadeAllLevel !== 100 ? '#60a5fa' : 'var(--text-muted)' }}>{fadeAllLevel}%</span>
                          {fadeAllLevel !== 100 && (
                            <button onClick={() => setFadeAllLevel(100)} title="กลับค่าแทมเพลต (100%)" style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer' }}>↺</button>
                          )}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 700 }}>🕯️ โทนไว้อาลัยทั้งใบ</span>
                        <input type="range" min="0" max="100" step="10" value={Math.round(grayAll * 100)}
                          onChange={e => setGrayAll(Number(e.target.value) / 100)} style={{ width: 120 }} />
                        <span style={{ fontSize: 12, fontWeight: 800, minWidth: 34, color: grayAll > 0 ? '#cbd5e1' : 'var(--text-muted)' }}>{Math.round(grayAll * 100)}%</span>
                      </div>
                    </div>
                    {/* ★ 14 พ.ย. 69: ปรับภาพทั้งใบในคลิกเดียว (ออโต้วัดแสงแยกรายภาพ) */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                      <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>🎨 ปรับภาพทั้งใบ</span>
                      <button onClick={() => applyAdjustToAll(ADJUST_PRESETS[0].adj, 'ปรับอัตโนมัติ')} disabled={!filledCount}
                        style={{ padding: '9px 13px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: filledCount ? 'pointer' : 'not-allowed', opacity: filledCount ? 1 : 0.45, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)', color: '#22c55e' }}>
                        ✨ ออโต้ทุกช่อง
                      </button>
                      {adjustedCount > 0 && (
                        <>
                          <button onClick={() => setSlotAdjust({})}
                            style={{ padding: '9px 13px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                            ↺ ล้างการปรับภาพทุกช่อง
                          </button>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ปรับอยู่ {adjustedCount}/{filledCount} ช่อง</span>
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                      <span style={{ fontSize: 12, color: '#f87171', fontWeight: 700 }}>🔴 เน้นจุดข่าว</span>
                      <button onClick={() => addMarker('circle')} style={{ padding: '9px 13px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.07)', color: '#f87171' }}>⭕ เพิ่มวงแดง</button>
                      <button onClick={() => addMarker('rect')} style={{ padding: '9px 13px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.07)', color: '#f87171' }}>▭ เพิ่มกรอบแดง</button>
                      {(() => {
                        const mk = markers.find(m => m.id === selectedMarkerId);
                        if (!mk) return markers.length > 0
                          ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>แตะวง/กรอบบนปกเพื่อเลือก · ลากใน=ย้าย ขอบ=ย่อขยาย</span>
                          : null;
                        return (
                          <>
                            <input type="color" value={mk.color} onChange={e => setMarkers(prev => prev.map(m => m.id === mk.id ? { ...m, color: e.target.value } : m))}
                              style={{ width: 34, height: 34, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', padding: 0, background: 'none' }} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>เส้น</span>
                            <button onClick={() => setMarkers(prev => prev.map(m => m.id === mk.id ? { ...m, width: Math.max(3, (m.width || 10) - 3) } : m))} style={{ ...s.scaleBtn, width: 34, height: 34 }}>−</button>
                            <span style={{ fontSize: 12, fontWeight: 800, minWidth: 22, textAlign: 'center', color: 'var(--text-primary)' }}>{mk.width || 10}</span>
                            <button onClick={() => setMarkers(prev => prev.map(m => m.id === mk.id ? { ...m, width: Math.min(30, (m.width || 10) + 3) } : m))} style={{ ...s.scaleBtn, width: 34, height: 34 }}>＋</button>
                            <button onClick={() => { setMarkers(prev => prev.filter(m => m.id !== mk.id)); setSelectedMarkerId(null); }}
                              style={{ padding: '8px 12px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>🗑 ลบวงนี้</button>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Quick download + status (จอกว้าง: ย้ายขึ้นบนสุดของคอลัมน์เครื่องมือ เห็นตลอด) */}
              <div style={{ display:'flex', gap:8, alignItems:'center', order: isWide ? -1 : 0 }}>
                <button onClick={handleDownload} disabled={!Object.keys(slotImages).length}
                  style={{
                    flex:1, padding:'10px 0', borderRadius:10, border:'none',
                    background: allSlotsFilled ? '#2563eb' : 'rgba(96,165,250,0.12)',
                    color: allSlotsFilled ? '#fff' : '#60a5fa',
                    fontSize:13, fontWeight:800, cursor:'pointer', fontFamily:'inherit',
                    opacity: Object.keys(slotImages).length ? 1 : 0.4,
                    transition:'all .2s',
                  }}>
                  📥 {downloaded ? 'ดาวน์โหลดอีกครั้ง' : 'Download JPEG'}
                </button>
                <span style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                  {template ? `${Object.keys(slotImages).filter(k => template.slots.some(sl => sl.id===k)).length}/${template.slots.length} รูป` : ''}
                </span>
              </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ★ 14 พ.ย. 69: แถบแจ้งเตือนสั้นๆ (แทน alert ที่บล็อกจอ) */}
      {notice && (
        <div role="status" aria-live="polite" onClick={() => setNotice(null)}
          style={{ position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', zIndex: 9500, maxWidth: 'min(92vw, 560px)',
            padding: '11px 16px', borderRadius: 12, fontSize: 13, fontWeight: 700, lineHeight: 1.5, cursor: 'pointer',
            color: '#fff', background: notice.kind === 'error' ? 'rgba(185,28,28,0.96)' : 'rgba(30,41,59,0.97)',
            border: `1px solid ${notice.kind === 'error' ? 'rgba(248,113,113,0.6)' : 'rgba(96,165,250,0.5)'}`,
            boxShadow: '0 10px 36px rgba(0,0,0,0.45)' }}>
          {notice.kind === 'error' ? '⚠️ ' : '✅ '}{notice.msg}
        </div>
      )}

      {/* ★ E3b: MODAL เลือกรูปจากคลัง (พูลเดียวกับแถบล่างโหมด recipe) — overlay เต็มจอ, คลิกรูป=วางลงช่องทันที */}
      {pickerSlotId != null && (() => {
        const pickSlot = template?.slots.find(sl => sl.id === pickerSlotId);
        const isRehost = (u) => /supabase\.co\/storage/.test(u || '');
        const hasExternal = poolItems.some(p => !isRehost(p.url));
        const closePicker = () => setPickerSlotId(null);
        return (
          <div
            onClick={closePicker}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 720, maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>
              {/* หัว modal */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                  🗂️ เลือกรูปลงช่อง{pickSlot ? `: ${pickSlot.label}` : ''}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({poolItems.length} ใบ)</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  {/* อัปโหลดจากเครื่องแทน = เส้น file input เดิม (กระตุ้น input ที่มี ref ของช่องนี้) */}
                  <button
                    onClick={() => { const sid = pickerSlotId; closePicker(); if (sid != null) fileRefs.current[sid]?.click(); }}
                    style={{ padding: '8px 12px', borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    📤 อัปโหลดจากเครื่องแทน
                  </button>
                  <button
                    onClick={closePicker}
                    aria-label="ปิด"
                    style={{ width: 42, height: 42, borderRadius: 9, fontSize: 16, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>✕</button>
                </div>
              </div>
              {/* คำเตือนรูปนอกที่ไม่ rehost (เซฟ canvas อาจไม่ได้) */}
              {hasExternal && (
                <div style={{ padding: '8px 14px', fontSize: 11, color: '#f4b740', background: 'rgba(244,183,64,0.08)', borderBottom: '1px solid var(--border)' }}>
                  ⚠️ ใบที่ไม่มีจุดเขียว = รูปเว็บนอก (ยังไม่ rehost) อาจบันทึกปกลง canvas ไม่ได้ — แนะนำเลือกใบที่มีจุดเขียว
                </div>
              )}
              {/* กริดรูป — สกอลล์ในนี้ ตัวหน้าไม่เลื่อน (body ถูกล็อกตอน modal เปิด) */}
              <div style={{ padding: 12, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
                {poolItems.map((p, i) => (
                  <button
                    key={p.id || i}
                    onClick={async () => { const sid = pickerSlotId; closePicker(); await assignPoolUrlToSlot(p.url, sid); }}
                    title={`${p.person || ''}${p.note ? ' · ' + p.note : ''}${isRehost(p.url) ? ' · ✅ rehost แล้ว' : ' · ⚠️ เว็บนอก (บันทึกไม่ได้)'}`}
                    style={{ position: 'relative', padding: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: '#111', aspectRatio: '4 / 5', minHeight: 84 }}>
                    <img src={p.thumb || p.url} alt={p.person || 'ภาพ'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {isRehost(p.url) && (
                      <span style={{ position: 'absolute', top: 3, right: 3, width: 11, height: 11, borderRadius: '50%', background: '#22c55e', border: '1px solid #fff' }} />
                    )}
                  </button>
                ))}
                {poolItems.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                    ยังไม่มีรูปในคลัง — กด “📤 อัปโหลดจากเครื่องแทน” หรือปิดแล้วดึงคลังภาพจากเคส
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
