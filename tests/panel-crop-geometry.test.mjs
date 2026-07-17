// ============================================================
// 🧪 panel-crop-geometry — เทสเรขาคณิตครอปช่องรอง (PURE, ไม่มีรูปจริง/sharp)
// ------------------------------------------------------------
// แบตช์ C: ยืนยัน refineRegionForFace (C1) + computePanelCircleZone/biasRegionFromCircleZone (C2)
//   6 เคสตามคำสั่ง: (1) หน้ากลาง→คลุมพอดี band (2) หน้าชิดขอบ→เลื่อนไม่ตัด (3) faceShare เกิน→ขยาย
//   (4) โซนวงทับ→หน้า bias ออกนอกวง (5) เลื่อนไม่ได้→สัญญาณสำรอง (6) ไร้หน้า/ปิดสวิตช์ = เดิม
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  refineRegionForFace,
  computePanelCircleZone,
  biasRegionFromCircleZone,
  faceSharePctOf,
  headBoxPx,
} from '../src/lib/panelCropGeometry.js';

const IMG_W = 1000, IMG_H = 1000;

// ── (1) หน้าอยู่กลาง → region คลุมพอดี band ──
test('C1-1 หน้ากลางภาพ: refine ได้ region ที่ faceShare อยู่ใน band + คลุมหัวครบ + aspect ตรงช่อง', () => {
  const slotAspect = 3 / 4; // ช่องแนวตั้ง
  // หน้าเล็กกลางภาพ (สูง 12% ของภาพ) — region เดิมเต็มภาพ → faceShare = 12% ต่ำกว่า band [38,68]
  const faceBox = { x1: 0.44, y1: 0.44, x2: 0.56, y2: 0.56 };
  const region0 = { left: 0, top: 0, width: 750, height: 1000 };
  const band = [38, 68];
  const r = refineRegionForFace({ region: region0, faceBox, imgW: IMG_W, imgH: IMG_H, slotAspect, band });
  assert.ok(r.changed, 'ต้องปรับ (faceShare เดิม 12% ต่ำกว่า band)');
  assert.ok(r.faceSharePct >= band[0] && r.faceSharePct <= band[1], `faceShare ${r.faceSharePct} ต้องอยู่ใน band`);
  assert.strictEqual(r.covered, true, 'หัวต้องอยู่ในกรอบครบ');
  // aspect ต้องตรงช่อง (±1px จากปัดเศษ)
  assert.ok(Math.abs(r.region.width / r.region.height - slotAspect) < 0.01, 'aspect ต้องเท่าช่อง');
  // หัวต้องอยู่ในกรอบจริง
  const head = headBoxPx(faceBox, IMG_W, IMG_H);
  assert.ok(head.minX >= r.region.left && head.maxX <= r.region.left + r.region.width, 'หัวไม่ตัดแนวนอน');
  assert.ok(head.minY >= r.region.top && head.maxY <= r.region.top + r.region.height, 'หัวไม่ตัดแนวตั้ง');
});

// ── (2) หน้าชิดขอบภาพ → region เลื่อนตาม ไม่ตัดหน้า ──
test('C1-2 หน้าชิดขอบซ้ายบน: region เลื่อนให้คลุมหัว ไม่หลุดภาพ ไม่ตัดหน้า', () => {
  const slotAspect = 1; // ช่องจตุรัส
  // หน้าอยู่มุมซ้ายบน
  const faceBox = { x1: 0.03, y1: 0.03, x2: 0.20, y2: 0.20 };
  const region0 = { left: 400, top: 400, width: 300, height: 300 }; // director วางผิดมุม (ขวาล่าง)
  const band = [38, 68];
  const r = refineRegionForFace({ region: region0, faceBox, imgW: IMG_W, imgH: IMG_H, slotAspect, band });
  assert.ok(r.changed, 'ต้องเลื่อน');
  assert.ok(r.region.left >= 0 && r.region.top >= 0, 'ไม่หลุดขอบภาพ (ซ้าย/บน)');
  assert.ok(r.region.left + r.region.width <= IMG_W && r.region.top + r.region.height <= IMG_H, 'ไม่หลุดขอบภาพ (ขวา/ล่าง)');
  const head = headBoxPx(faceBox, IMG_W, IMG_H);
  // หัวอาจชิดขอบภาพจน margin ไม่ครบ แต่ "หน้า" (raw) ต้องไม่ถูกตัด
  const fL = faceBox.x1 * IMG_W, fR = faceBox.x2 * IMG_W, fT = faceBox.y1 * IMG_H, fB = faceBox.y2 * IMG_H;
  assert.ok(fL >= r.region.left - 1 && fR <= r.region.left + r.region.width + 1, 'หน้าไม่ถูกตัดแนวนอน');
  assert.ok(fT >= r.region.top - 1 && fB <= r.region.top + r.region.height + 1, 'หน้าไม่ถูกตัดแนวตั้ง');
  void head;
});

// ── (3) faceShare เกิน (โอเวอร์โฟลว์) → ขยาย region จน band ──
test('C1-3 faceShare เกินช่อง (>100%): ขยาย region จน faceShare กลับเข้า band ≤ band max', () => {
  const slotAspect = 3 / 4;
  // หน้า สูง 25% ของภาพ แต่ region ถูกซูมเล็กจนหน้าล้น: region สูง 150 → faceShare = 250/150 = 166%
  const faceBox = { x1: 0.40, y1: 0.375, x2: 0.60, y2: 0.625 };
  const region0 = { left: 420, top: 420, width: 112, height: 150 };
  const bandMax = 33; // evidence (band [18,33] — ภาพสูงพอถึง 33% ได้)
  const r = refineRegionForFace({ region: region0, faceBox, imgW: IMG_W, imgH: IMG_H, slotAspect, band: [18, bandMax] });
  assert.ok(r.changed, 'ต้องขยาย');
  assert.ok(r.region.height > region0.height, 'region ต้องสูงขึ้น (ขยายออก)');
  assert.ok(r.faceSharePct <= bandMax + 0.5, `faceShare ${r.faceSharePct} ต้อง ≤ band max ${bandMax}`);
  assert.ok(r.faceSharePct < 100, 'ต้องไม่โอเวอร์โฟลว์อีกแล้ว');
});

// ── (4) โซนวงทับ → หน้า bias ออกนอกวง ──
test('C2-4 โซนวงทับมุมขวาบนของช่อง: bias region ให้หน้าออกนอกวง', () => {
  // ช่อง 400x500 ที่ canvas (x100,y100) · วงรัศมี 90 ศูนย์กลางมุมขวาบนช่อง
  const slot = { x: 100, y: 100, w: 400, h: 500 };
  const circle = { cx: 460, cy: 160, d: 180 };
  const zone = computePanelCircleZone({ circle, slot, marginPx: 10 });
  assert.ok(zone, 'ต้องมีโซนวงทับช่อง');
  assert.ok(zone.x1 > 0.7 && zone.y0 < 0.3, 'โซนอยู่มุมขวาบน (frac)');

  // region ครอปในภาพ: หน้าอยู่ frac ขวาบน ตรงโซนวงพอดี → ต้องถูกเลื่อน
  // region 400x500 ในภาพ 1000x1000, หน้าอยู่ frac (0.85, 0.15) ของ region
  const region = { left: 300, top: 200, width: 400, height: 500 };
  // faceCx frac 0.85 → px = 300 + 0.85*400 = 640 ; faceCy frac 0.15 → 200 + 0.15*500 = 275
  const faceBox = { x1: 610 / IMG_W, y1: 245 / IMG_H, x2: 670 / IMG_W, y2: 305 / IMG_H };
  const b = biasRegionFromCircleZone({ region, faceBox, zone, imgW: IMG_W, imgH: IMG_H });
  assert.strictEqual(b.avoided, true, 'ต้องหลบได้');
  assert.strictEqual(b.moved, true, 'ต้องมีการเลื่อน');
  // ยืนยันหน้าออกนอกโซนหลังเลื่อน
  const W = b.region.width, H = b.region.height;
  const fx0 = (faceBox.x1 * IMG_W - b.region.left) / W, fx1 = (faceBox.x2 * IMG_W - b.region.left) / W;
  const fy0 = (faceBox.y1 * IMG_H - b.region.top) / H, fy1 = (faceBox.y2 * IMG_H - b.region.top) / H;
  const stillOverlap = !(fx1 <= zone.x0 || fx0 >= zone.x1 || fy1 <= zone.y0 || fy0 >= zone.y1);
  assert.strictEqual(stillOverlap, false, 'หน้าต้องออกนอกโซนวงแล้ว');
});

// ── (5) เลื่อนไม่ได้ → สัญญาณให้ลองสำรอง ──
test('C2-5 โซนวงกินเกือบทั้งช่อง + หน้าใหญ่: เลื่อนยังไงก็ไม่พ้น → avoided=false (ลองสำรอง)', () => {
  const slot = { x: 0, y: 0, w: 400, h: 400 };
  const circle = { cx: 200, cy: 200, d: 600 }; // วงใหญ่คลุมทั้งช่อง
  const zone = computePanelCircleZone({ circle, slot });
  assert.ok(zone && zone.x0 <= 0.01 && zone.y0 <= 0.01 && zone.x1 >= 0.99 && zone.y1 >= 0.99, 'โซนคลุมทั้งช่อง');
  const region = { left: 300, top: 300, width: 400, height: 400 };
  const faceBox = { x1: 0.40, y1: 0.40, x2: 0.60, y2: 0.60 }; // หน้ากลาง region
  const b = biasRegionFromCircleZone({ region, faceBox, zone, imgW: IMG_W, imgH: IMG_H });
  assert.strictEqual(b.avoided, false, 'เลื่อนไม่พ้น → สัญญาณลองสำรอง');
  assert.strictEqual(b.moved, false, 'ไม่ควรเลื่อน (ไม่มีตำแหน่งที่ใช้ได้)');
  assert.deepStrictEqual(b.region, region, 'region เดิมไม่เปลี่ยน');
});

// ── (6) ไร้หน้า / สวิตช์ปิด = เดิม ──
test('C1/C2-6 ไร้หน้า → คืน region เดิมทุกค่า (byte-parity) + faceShare in-band ไม่แตะ', () => {
  const slotAspect = 3 / 4;
  const region0 = { left: 10, top: 20, width: 300, height: 400 };
  // ไร้หน้า: faceBox ว่าง
  const noFace = { x1: 0, y1: 0, x2: 0, y2: 0 };
  const r1 = refineRegionForFace({ region: region0, faceBox: noFace, imgW: IMG_W, imgH: IMG_H, slotAspect });
  assert.strictEqual(r1.changed, false, 'ไร้หน้า = ไม่แตะ');
  assert.deepStrictEqual(r1.region, region0, 'region เดิมเป๊ะ');

  // หน้า faceShare อยู่ใน band อยู่แล้ว + คลุมครบ → byte-parity
  const faceBox = { x1: 0.42, y1: 0.30, x2: 0.58, y2: 0.50 }; // สูง 20% → region สูง 400 → faceShare 50% ∈ [38,68]
  // region วางให้คลุมกล่องหัว+margin ครบ (head y 216..564, head x 388..612) → byte-parity
  const region1 = { left: 350, top: 190, width: 300, height: 400 };
  const r2 = refineRegionForFace({ region: region1, faceBox, imgW: IMG_W, imgH: IMG_H, slotAspect, band: [38, 68] });
  assert.strictEqual(r2.changed, false, 'faceShare ใน band + คลุมครบ → ไม่แตะ');
  assert.deepStrictEqual(r2.region, region1, 'region เดิมเป๊ะ');

  // biasRegionFromCircleZone: zone=null → ไม่แตะ
  const b = biasRegionFromCircleZone({ region: region1, faceBox, zone: null, imgW: IMG_W, imgH: IMG_H });
  assert.strictEqual(b.moved, false);
  assert.deepStrictEqual(b.region, region1);
});

// ── โบนัส: faceSharePctOf ตรงสูตร measureTechRules ──
test('faceSharePctOf: สูตร สูงหน้า/region.height×100 ตรง measureTechRules', () => {
  const faceBox = { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.5 }; // สูง 0.2 → 200px ในภาพ 1000
  assert.strictEqual(faceSharePctOf(faceBox, 1000, 400), 50);
  assert.strictEqual(faceSharePctOf(faceBox, 1000, 200), 100);
  assert.strictEqual(faceSharePctOf(faceBox, 1000, 0), null);
});

// ── โบนัส: computePanelCircleZone คืน null เมื่อวงไม่ทับช่อง ──
test('computePanelCircleZone: วงไกลช่อง → null', () => {
  const slot = { x: 0, y: 0, w: 200, h: 200 };
  const circle = { cx: 900, cy: 900, d: 100 };
  assert.strictEqual(computePanelCircleZone({ circle, slot }), null);
});
