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
  refineRegionForFaces,
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

// ============================================================
// 🧪 C1b (17 ก.ค.) — refineRegionForFaces: ครอปช่องรองคลุมหลายหน้า (union) + biasRegionFromCircleZone หลายหน้า
//   เคส: (ก) สองหน้าคนละฝั่งถูกตัด→คลุมครบ (ข) dominant เกิน band→ขยายเข้า (ค) union กว้างเกิน aspect→ok:false
//         (ง) โซนวงทับหน้าใบหนึ่ง→เลื่อนพ้นทั้งสอง (จ) 1 หน้า=ผลเท่า refineRegionForFace เดิมเป๊ะ
//         (ฉ) 4+ หน้า executor ข้าม (pure fn ยังปฏิเสธ union ใหญ่=ok:false ไม่ฝืนตัดคน)
// ============================================================

// ── (ก) สองหน้าคนละฝั่ง region เดิมตัดทั้งคู่ → region ใหม่คลุมครบทั้งสอง ──
test('C1b-ก สองหน้าคนละฝั่งช่องกว้าง: region เดิมตัดทั้งคู่ → refine คลุม union ครบ (aspect ตรงช่อง)', () => {
  const slotAspect = 2; // ช่องกว้าง
  const faceA = { x1: 0.15, y1: 0.40, x2: 0.25, y2: 0.55 };
  const faceB = { x1: 0.75, y1: 0.40, x2: 0.85, y2: 0.55 };
  const region0 = { left: 400, top: 450, width: 200, height: 100 }; // เล็กกลาง ตัดทั้งสอง
  const r = refineRegionForFaces({ region: region0, faces: [faceA, faceB], imgW: IMG_W, imgH: IMG_H, slotAspect, band: [18, 33] });
  assert.strictEqual(r.ok, true, 'ต้องคลุมได้ (ok)');
  assert.ok(r.changed, 'ต้องปรับ region');
  assert.ok(Math.abs(r.region.width / r.region.height - slotAspect) < 0.01, 'aspect ต้องเท่าช่อง');
  // ทั้งสองหน้า raw ต้องอยู่ในกรอบครบ (ไม่ถูกตัด)
  for (const f of [faceA, faceB]) {
    const fL = f.x1 * IMG_W, fR = f.x2 * IMG_W, fT = f.y1 * IMG_H, fB = f.y2 * IMG_H;
    assert.ok(fL >= r.region.left - 1 && fR <= r.region.left + r.region.width + 1, 'หน้าไม่ถูกตัดแนวนอน');
    assert.ok(fT >= r.region.top - 1 && fB <= r.region.top + r.region.height + 1, 'หน้าไม่ถูกตัดแนวตั้ง');
  }
});

// ── (ข) dominant faceShare เกิน band → ขยาย region จน dominant เข้า band ──
test('C1b-ข หน้าเด่นใหญ่เกิน band + หน้าเล็กข้างๆ: ขยาย region จน dominant faceShare กลับเข้า band', () => {
  const slotAspect = 3 / 4;
  const faceA = { x1: 0.35, y1: 0.30, x2: 0.55, y2: 0.60 }; // dominant สูง 30% ของภาพ
  const faceB = { x1: 0.58, y1: 0.42, x2: 0.66, y2: 0.54 }; // เล็กกว่า อยู่ข้างๆ
  const region0 = { left: 340, top: 290, width: 270, height: 360 }; // dominant faceShare = 300/360 = 83% > 60
  const r = refineRegionForFaces({ region: region0, faces: [faceA, faceB], imgW: IMG_W, imgH: IMG_H, slotAspect, band: [18, 60] });
  assert.strictEqual(r.ok, true, 'ต้องขยายได้ (ok)');
  assert.ok(r.changed, 'ต้องปรับ');
  assert.ok(r.region.height > region0.height, 'region ต้องสูงขึ้น (ขยายออก)');
  assert.ok(r.faceSharePct <= 60 + 0.6, `dominant faceShare ${r.faceSharePct} ต้อง ≤ band max`);
  assert.ok(r.faceSharePct >= 18 - 0.6, `dominant faceShare ${r.faceSharePct} ต้อง ≥ band min`);
  // ทั้งสองหน้าอยู่ในกรอบครบ
  for (const f of [faceA, faceB]) {
    const fT = f.y1 * IMG_H, fB = f.y2 * IMG_H;
    assert.ok(fT >= r.region.top - 1 && fB <= r.region.top + r.region.height + 1, 'หน้าอยู่ในกรอบแนวตั้ง');
  }
});

// ── (ค) union กว้างเกินกว่า aspect ช่องจะรับได้ → ok:false (คงเดิม/ลองสำรอง ห้ามฝืนตัดคน) ──
test('C1b-ค สองหน้าห่างกันมากในช่องแนวตั้ง: union กว้างเกิน aspect → ok:false region เดิมไม่เปลี่ยน', () => {
  const slotAspect = 3 / 4; // ช่องแนวตั้ง (แคบ)
  const faceA = { x1: 0.10, y1: 0.40, x2: 0.20, y2: 0.50 };
  const faceB = { x1: 0.80, y1: 0.40, x2: 0.90, y2: 0.50 }; // ห่างสุดขอบซ้าย-ขวา
  const region0 = { left: 300, top: 400, width: 225, height: 300 };
  const r = refineRegionForFaces({ region: region0, faces: [faceA, faceB], imgW: IMG_W, imgH: IMG_H, slotAspect, band: [18, 33] });
  assert.strictEqual(r.ok, false, 'union กว้างเกิน → ทำไม่ได้');
  assert.strictEqual(r.changed, false, 'region ต้องไม่เปลี่ยน');
  assert.deepStrictEqual(r.region, region0, 'region เดิมเป๊ะ');
});

// ── (ง) โซนวงทับหน้าใบหนึ่ง → biasRegionFromCircleZone เลื่อนพ้นทั้งสองหน้า ──
test('C1b-ง โซนวงทับหน้าใบหนึ่ง (faces[]): เลื่อน region ให้ทุกหน้าออกนอกวง + ทุกหน้าอยู่ในกรอบ', () => {
  const slot = { x: 100, y: 100, w: 400, h: 500 };
  const circle = { cx: 460, cy: 160, d: 180 };
  const zone = computePanelCircleZone({ circle, slot, marginPx: 10 });
  assert.ok(zone && zone.x0 > 0.6, 'โซนอยู่ขวาบนของช่อง');
  const region = { left: 300, top: 200, width: 400, height: 500 };
  const faceA = { x1: 610 / IMG_W, y1: 245 / IMG_H, x2: 670 / IMG_W, y2: 305 / IMG_H }; // frac ขวาบน ตรงโซน
  const faceB = { x1: 400 / IMG_W, y1: 400 / IMG_H, x2: 440 / IMG_W, y2: 460 / IMG_H }; // frac ซ้ายกลาง ปลอดโซน
  const b = biasRegionFromCircleZone({ region, faces: [faceA, faceB], zone, imgW: IMG_W, imgH: IMG_H });
  assert.strictEqual(b.avoided, true, 'ต้องหลบได้');
  assert.strictEqual(b.moved, true, 'ต้องมีการเลื่อน');
  const W = b.region.width, H = b.region.height;
  for (const f of [faceA, faceB]) {
    const fx0 = (f.x1 * IMG_W - b.region.left) / W, fx1 = (f.x2 * IMG_W - b.region.left) / W;
    const fy0 = (f.y1 * IMG_H - b.region.top) / H, fy1 = (f.y2 * IMG_H - b.region.top) / H;
    const overlap = !(fx1 <= zone.x0 || fx0 >= zone.x1 || fy1 <= zone.y0 || fy0 >= zone.y1);
    assert.strictEqual(overlap, false, 'หน้าต้องออกนอกโซนวง');
    // ยังอยู่ในกรอบครบ
    assert.ok(f.x1 * IMG_W >= b.region.left - 1 && f.x2 * IMG_W <= b.region.left + W + 1, 'หน้าอยู่ในกรอบแนวนอน');
    assert.ok(f.y1 * IMG_H >= b.region.top - 1 && f.y2 * IMG_H <= b.region.top + H + 1, 'หน้าอยู่ในกรอบแนวตั้ง');
  }
});

// ── (จ) 1 หน้า → ผลเท่า refineRegionForFace เดิมเป๊ะ (delegate, ห้าม regress) ──
test('C1b-จ 1 หน้า: refineRegionForFaces([face]) = refineRegionForFace(face) ทุกค่า (region/changed/faceShare)', () => {
  const slotAspect = 3 / 4;
  const faceBox = { x1: 0.44, y1: 0.44, x2: 0.56, y2: 0.56 };
  const region0 = { left: 0, top: 0, width: 750, height: 1000 };
  const band = [38, 68];
  const single = refineRegionForFace({ region: region0, faceBox, imgW: IMG_W, imgH: IMG_H, slotAspect, band });
  const many = refineRegionForFaces({ region: region0, faces: [faceBox], imgW: IMG_W, imgH: IMG_H, slotAspect, band });
  assert.deepStrictEqual(many.region, single.region, 'region ต้องเท่ากันเป๊ะ');
  assert.strictEqual(many.changed, single.changed, 'changed ต้องเท่ากัน');
  assert.strictEqual(many.faceSharePct, single.faceSharePct, 'faceSharePct ต้องเท่ากัน');
  assert.strictEqual(many.covered, single.covered, 'covered ต้องเท่ากัน');
  assert.strictEqual(many.ok, true, '1 หน้าปกติ = ok');
});

// ── (ฉ) 4+ หน้า: executor ข้าม (guard _nFaces ≤ 3); pure fn ยังปฏิเสธ union ใหญ่ = ok:false ไม่ฝืนตัดคน ──
test('C1b-ฉ 4 หน้าแผ่กว้าง: pure fn ปฏิเสธ (ok:false ไม่เปลี่ยน region) — executor ยังกันด้วย count ≤ 3 ต่างหาก', () => {
  const slotAspect = 3 / 4;
  const faces = [
    { x1: 0.06, y1: 0.40, x2: 0.16, y2: 0.52 },
    { x1: 0.30, y1: 0.40, x2: 0.40, y2: 0.52 },
    { x1: 0.60, y1: 0.40, x2: 0.70, y2: 0.52 },
    { x1: 0.84, y1: 0.40, x2: 0.94, y2: 0.52 }, // union กว้างเกือบเต็มภาพ
  ];
  const region0 = { left: 200, top: 400, width: 225, height: 300 };
  const r = refineRegionForFaces({ region: region0, faces, imgW: IMG_W, imgH: IMG_H, slotAspect, band: [18, 33] });
  assert.strictEqual(r.ok, false, 'union กว้างเกิน → ปฏิเสธ');
  assert.deepStrictEqual(r.region, region0, 'region เดิมไม่เปลี่ยน (ไม่ฝืนตัดคน)');
});
