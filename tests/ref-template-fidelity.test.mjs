// ============================================================
// ref-template-fidelity.test.mjs — เครื่องวัด template↔ภาพจริง เชิงพิกเซล (deterministic, ไม่มี AI)
// ------------------------------------------------------------
// สังเคราะห์ภาพคอลลาจด้วย sharp (สี่เหลี่ยมสีตัดกันที่พิกัดรู้แน่) แล้วตรวจว่า measureTemplateFidelity:
//   1) template ตรงเป๊ะ            → offsetPx ≈ 0, score สูง
//   2) template เลื่อน 30px         → จับ offsetPx ได้ ~30
//   3) ภาพตะเข็บเบลอ (feather)      → ยัง tolerate (score ยังสูง, offset ยังเล็ก)
//   4) ภาพสีเดียว (ไม่มีตะเข็บ)      → รายงาน low-confidence + score = null (ไม่มั่ว)
//   + วงกลม: ขอบวงตรง → offset เล็ก
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { measureTemplateFidelity } from '../src/lib/refTemplateFidelity.js';

const W = 1080, H = 1350;

// สร้างภาพจากบล็อกสี่เหลี่ยมสีทึบ (RGB) → jpg buffer (คุณภาพสูง กันตะเข็บเพี้ยนจาก compression)
async function makeCollage(blocks, { blurSigma = 0, base = [20, 20, 20] } = {}) {
  const composites = blocks.map((b) => ({
    input: { create: { width: b.w, height: b.h, channels: 3, background: { r: b.c[0], g: b.c[1], b: b.c[2] } } },
    left: b.x, top: b.y,
  }));
  let img = sharp({ create: { width: W, height: H, channels: 3, background: { r: base[0], g: base[1], b: base[2] } } })
    .composite(composites);
  if (blurSigma > 0) img = sharp(await img.png().toBuffer()).blur(blurSigma);
  return img.jpeg({ quality: 95 }).toBuffer();
}

// วาดวงกลมสีทึบบนพื้นตัดกัน (mask วงกลมด้วย SVG) → jpg buffer
async function makeCircleImage({ cx, cy, r, inner = [240, 30, 30], outer = [30, 30, 200] }) {
  const bg = sharp({ create: { width: W, height: H, channels: 3, background: { r: outer[0], g: outer[1], b: outer[2] } } });
  const circleSvg = Buffer.from(
    `<svg width="${W}" height="${H}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="rgb(${inner[0]},${inner[1]},${inner[2]})"/></svg>`
  );
  return bg.composite([{ input: circleSvg, left: 0, top: 0 }]).jpeg({ quality: 95 }).toBuffer();
}

test('1) template ตรงเป๊ะ → offset≈0, score สูง', async () => {
  // ตะเข็บแนวตั้งจริงที่ x=540 (ซ้ายแดง | ขวาน้ำเงิน) และตะเข็บแนวนอนจริงที่ y=675 บนครึ่งขวา
  const img = await makeCollage([
    { x: 0, y: 0, w: 540, h: H, c: [220, 30, 30] },      // ซ้ายเต็มสูง (แดง)
    { x: 540, y: 0, w: 540, h: 675, c: [30, 30, 220] },  // ขวาบน (น้ำเงิน)
    { x: 540, y: 675, w: 540, h: 675, c: [30, 200, 30] }, // ขวาล่าง (เขียว)
  ]);
  const spec = {
    canvasW: W, canvasH: H, feather: 0,
    slots: [
      { id: 'main', x: 0, y: 0, w: 540, h: H },
      { id: 'a', x: 540, y: 0, w: 540, h: 675 },
      { id: 'b', x: 540, y: 675, w: 540, h: 675 },
    ],
  };
  const r = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  assert.equal(r.confidence, 'ok');
  assert.ok(r.confidentBoundaries >= 2, `ควรจับตะเข็บได้ ≥2 (ได้ ${r.confidentBoundaries})`);
  assert.ok(r.worstOffsetPx <= 4, `worst offset ควร ≈0 (ได้ ${r.worstOffsetPx})`);
  assert.ok(r.score >= 90, `score ควรสูง (ได้ ${r.score})`);
});

test('2) template เลื่อน 30px → จับ offset ได้ ~30', async () => {
  // ตะเข็บจริงที่ x=540 แต่ template บอก x=570 → ต้องเจอ offset ≈ 30
  const img = await makeCollage([
    { x: 0, y: 0, w: 540, h: H, c: [220, 30, 30] },
    { x: 540, y: 0, w: 540, h: H, c: [30, 30, 220] },
  ]);
  const spec = {
    canvasW: W, canvasH: H, feather: 0,
    slots: [
      { id: 'main', x: 0, y: 0, w: 570, h: H },   // ขอบขวา main = 570 (ผิดจากจริง 30)
      { id: 'a', x: 570, y: 0, w: 510, h: H },     // ขอบซ้าย a = 570
    ],
  };
  const r = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  assert.equal(r.confidence, 'ok');
  // ตะเข็บ 570 (จาก main.right และ a.left) ถูก merge เป็นเส้นเดียว → เจอที่จริง 540 → offset ~30
  const seam = r.boundaries.find((b) => b.type === 'v' && !b.lowConfidence);
  assert.ok(seam, 'ต้องมีตะเข็บแนวตั้งที่มั่นใจ');
  assert.ok(Math.abs(seam.offsetPx - 30) <= 5, `offset ควร ~30 (ได้ ${seam.offsetPx})`);
});

test('3) ตะเข็บเบลอ feather → ยัง tolerate (offset เล็ก, score ยังสูง)', async () => {
  // ตะเข็บจริงที่ x=540 เบลอด้วย gaussian sigma 8 (≈feather 15) — template ตรง, feather=15
  const img = await makeCollage([
    { x: 0, y: 0, w: 540, h: H, c: [220, 30, 30] },
    { x: 540, y: 0, w: 540, h: H, c: [30, 30, 220] },
  ], { blurSigma: 8 });
  const spec = {
    canvasW: W, canvasH: H, feather: 15,
    slots: [
      { id: 'main', x: 0, y: 0, w: 540, h: H },
      { id: 'a', x: 540, y: 0, w: 540, h: H },
    ],
  };
  const r = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  assert.equal(r.confidence, 'ok', 'ตะเข็บเบลอยังต้องตรวจเจอ (ไม่หลุดเป็น low)');
  const seam = r.boundaries.find((b) => b.type === 'v' && !b.lowConfidence);
  assert.ok(seam, 'ต้องเจอตะเข็บ');
  assert.ok(seam.offsetPx <= 12, `feather: จุดกึ่งกลางยังใกล้ 540 (ได้ ${seam.offsetPx})`);
  assert.ok(r.score >= 85, `feather tolerate → score ยังสูง (ได้ ${r.score})`);
});

test('4) ภาพสีเดียว (ไม่มีตะเข็บ) → low-confidence + score=null (ไม่มั่ว)', async () => {
  const img = await makeCollage([], { base: [128, 128, 128] }); // เทาล้วนทั้งผืน
  const spec = {
    canvasW: W, canvasH: H, feather: 0,
    slots: [
      { id: 'main', x: 0, y: 0, w: 540, h: H },
      { id: 'a', x: 540, y: 0, w: 540, h: 675 },
      { id: 'b', x: 540, y: 675, w: 540, h: 675 },
    ],
  };
  const r = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  assert.equal(r.score, null, 'สีเดียว → ไม่มีคะแนน (null) ไม่ใช่มั่ว');
  assert.equal(r.confidence, 'low');
  assert.equal(r.confidentBoundaries, 0);
  assert.ok(r.lowConfidenceBoundaries >= 1, 'ต้องมีเส้น low-confidence รายงานไว้');
});

test('5) วงกลม: ขอบวงตรง → offset เล็ก, มี 8 ทิศ', async () => {
  const cx = 300, cy = 950, rad = 200;
  const img = await makeCircleImage({ cx, cy, r: rad });
  const spec = {
    canvasW: W, canvasH: H, feather: 0,
    slots: [
      { id: 'main', x: 0, y: 0, w: 1080, h: 700 },       // ให้มี rect เป็น context
      { id: 'x', x: 0, y: 700, w: 1080, h: 650 },
      { id: 'circle', shape: 'circle', x: cx - rad, y: cy - rad, w: 2 * rad, h: 2 * rad },
    ],
  };
  const r = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  const circ = r.boundaries.find((b) => b.type === 'circle');
  assert.ok(circ, 'ต้องมี boundary ชนิด circle');
  assert.equal(circ.directions.length, 8, 'ตรวจ 8 ทิศ');
  assert.ok(!circ.lowConfidence, 'ขอบวงชัด → มั่นใจ');
  assert.ok(circ.offsetPx <= 8, `รัศมีตรง → offset เล็ก (ได้ ${circ.offsetPx})`);
});

// สร้างภาพนอยส์ต่อพิกเซล deterministic (LCG) → jpg buffer (ไม่มีตะเข็บจริง แต่พื้นผิวจัด)
async function makeNoiseImage(seed = 12345) {
  const buf = Buffer.alloc(W * H * 3);
  let s = seed >>> 0;
  for (let i = 0; i < buf.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; buf[i] = (s >>> 24) & 0xff; }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

test('7) นอยส์/พื้นผิว (ไม่มีตะเข็บ) → low-confidence แม้พีคสัมบูรณ์เกิน MIN_CONFIDENCE (กัน false-positive R1)', async () => {
  // ผู้ตรวจ R1: นอยส์ล้วนให้พีคสัมบูรณ์ ~0.15 (เกิน noise floor 0.082–0.089) แต่โปรไฟล์ "แบน"
  //   → prominence ต่ำ ต้องถูกปฏิเสธ ไม่ใช่ผ่านเป็นตะเข็บมั่นใจ score 100 + offset≈0 (centroid-centering artifact)
  const img = await makeNoiseImage();
  const spec = {
    canvasW: W, canvasH: H, feather: 0,
    slots: [{ id: 'main', x: 0, y: 0, w: 540, h: H }, { id: 'a', x: 540, y: 0, w: 540, h: H }],
  };
  const r = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  const seam = r.boundaries.find((b) => b.type === 'v');
  assert.ok(seam, 'ต้องมีเส้นแนวตั้งในผล');
  assert.ok(seam.confidence >= 0.09, `พีคสัมบูรณ์นอยส์ต้องเกิน noise floor เพื่อพิสูจน์ว่าเกต absolute เอาไม่อยู่ (ได้ ${seam.confidence})`);
  assert.ok(seam.prominence < 0.45, `โปรไฟล์นอยส์แบน → prominence ต่ำ (ได้ ${seam.prominence})`);
  assert.equal(seam.lowConfidence, true, 'นอยส์ต้องถูก mark low-confidence (เกต prominence)');
  assert.equal(r.confidence, 'low', 'ทั้งภาพนอยส์ → low');
  assert.equal(r.score, null, 'นอยส์ → ไม่ให้คะแนน (ไม่มั่ว score 100)');
  assert.equal(r.confidentBoundaries, 0, 'ไม่มีเส้นมั่นใจจากนอยส์');
});

test('8) feather cap: offset จริงใน tolerance → score ไม่แตะ 100 + surface rawScore/offset ดิบ (R1)', async () => {
  // ตะเข็บจริง x=540 แต่ template บอก x=548 (offset 8px จริง), feather=20 → featherTol=10 → หักผ่อนจน effOffset=0
  //   ระบบเก่าให้ score 100 (อ่านว่าเป๊ะพิกเซล) ทั้งที่คลาด 8px → ต้อง cap ≤99 + rawScore สะท้อน offset ดิบ
  const img = await makeCollage([
    { x: 0, y: 0, w: 540, h: H, c: [220, 30, 30] },
    { x: 540, y: 0, w: 540, h: H, c: [30, 30, 220] },
  ], { blurSigma: 6 });
  const spec = {
    canvasW: W, canvasH: H, feather: 20,
    slots: [{ id: 'main', x: 0, y: 0, w: 548, h: H }, { id: 'a', x: 548, y: 0, w: 532, h: H }],
  };
  const r = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  assert.equal(r.confidence, 'ok', 'ตะเข็บ feather ยังตรวจเจอ');
  assert.ok(typeof r.rawScore === 'number', 'ต้อง surface rawScore');
  assert.equal(r.featherPx, 20, 'ต้อง surface featherPx ที่ใช้หักผ่อน');
  assert.ok(r.score <= 99, `100 ต้องสงวนให้เป๊ะพิกเซลจริง → cap (ได้ ${r.score})`);
  assert.ok(r.rawScore < r.score, `rawScore (ไม่หัก feather) ต้องต่ำกว่า score ที่หักผ่อน (raw ${r.rawScore} vs ${r.score})`);
  assert.ok(r.worstOffsetPx >= 5, `offset ดิบต้องสะท้อนความคลาดจริง ~8px (ได้ ${r.worstOffsetPx})`);
});

test('9) score=100 ต้องหมายถึงเป๊ะพิกเซลจริง (rawScore=100)', async () => {
  // ตะเข็บคม template ตรงเป๊ะ feather=0 → ถ้า score=100 ต้อง rawScore=100 ด้วย (ไม่มีการหักผ่อนบังหน้า)
  const img = await makeCollage([
    { x: 0, y: 0, w: 540, h: H, c: [220, 30, 30] },
    { x: 540, y: 0, w: 540, h: H, c: [30, 30, 220] },
  ]);
  const spec = { canvasW: W, canvasH: H, feather: 0, slots: [{ id: 'main', x: 0, y: 0, w: 540, h: H }, { id: 'a', x: 540, y: 0, w: 540, h: H }] };
  const r = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  if (r.score === 100) assert.equal(r.rawScore, 100, 'score 100 ต้องมาจาก offset ดิบ 0 เท่านั้น');
});

test('6) deterministic: รันซ้ำได้ผลเท่าเดิม', async () => {
  const img = await makeCollage([
    { x: 0, y: 0, w: 540, h: H, c: [220, 30, 30] },
    { x: 540, y: 0, w: 540, h: H, c: [30, 30, 220] },
  ]);
  const spec = { canvasW: W, canvasH: H, feather: 0, slots: [{ id: 'main', x: 0, y: 0, w: 540, h: H }, { id: 'a', x: 540, y: 0, w: 540, h: H }] };
  const r1 = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  const r2 = await measureTemplateFidelity({ imageBuffer: img, templateSpec: spec });
  assert.deepEqual(r1, r2, 'ผลต้องเท่ากันเป๊ะทุกครั้ง');
});
