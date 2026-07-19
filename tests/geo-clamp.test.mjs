// ============================================================
// 🧪 GEO-CLAMP (19 ก.ค. 69) — กัน template ปกเพี้ยนจาก DNA ref วัดพลาด
// ------------------------------------------------------------
// บั๊กจริงที่แก้ (ref REF-mrraukej-6ky5 grade C, qcFlags): circle_border_out:22 (ขอบวงกลม
//   หนา 22px เกิน TECH_RULES.CIRCLE_BORDER_MAX=16) + วงกลม/ช่องวางล้นเฟรม canvas 1080×1350.
// เทสนี้พิสูจน์ 2 อย่างคู่กันเสมอ (ใช้ MEGA_GEO_CLAMP='0' เป็น "control"):
//   1) ปิด clamp (env='0') → fixture ต้อง reproduce ปัญหาจริง (พิสูจน์ว่า fixture ไม่ได้ "สะอาดอยู่แล้วโดยบังเอิญ")
//   2) เปิด clamp (ปกติ/unset) → ปัญหาต้องหายไป
// ⚠️ SYNTHETIC FIXTURE ล้วน ไม่มี fs/network/LLM · refTemplate.js import แค่ imageQualityConfig.js
//   (pure, ไม่มี side-effect) → import ตรงได้ ไม่ต้อง loader hook.
// ============================================================
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dnaToTemplateSpec } from '../src/lib/refTemplate.js';
import { TECH_RULES } from '../src/lib/imageQualityConfig.js';

// รันฟังก์ชันด้วยค่า env ชั่วคราว แล้วคืนค่า env เดิมเสมอ (กันเทสอื่นเพี้ยนจาก side effect)
function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// ── fixture (ก)/(ข)/(จ): hero + reaction (เต็มกรอบ ไม่มีขอบเกี่ยวข้อง) + circle (ปรับ border ได้) ──
// ★ 19 ก.ค. (w=h fix): DNA เก็บ wPct/hPct เป็น % ของ "กว้าง/สูง canvas" คนละฐาน (1080 vs 1350)
//   → circle wPct=hPct=20 = 216กว้าง×270สูง = "วงรี" ในพิกเซลทุกวง! geo-clamp บังคับ w=h (diameter=min)
//   จึงต้องแยก fixture: default = วงรี (สำหรับเทสที่ยังไงก็ถูก square) · cwPct/chPct override ให้วงกลมจริง (square px)
function makeCircleBorderDNA({ border = true, borderWidthPct = 1.5, cwPct = 20, chPct = 20 } = {}) {
  return {
    layoutType: 'triptych',
    template: {
      seamStyle: 'feather',
      featherPx: 10,
      slots: [
        { role: 'hero', xPct: 0, yPct: 0, wPct: 60, hPct: 100, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'reaction', xPct: 60, yPct: 0, wPct: 40, hPct: 100, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'face', shape: 'circle', xPct: 66, yPct: 40, wPct: cwPct, hPct: chPct, zIndex: 4, border, borderColor: '#FFFFFF', borderWidthPct: borderWidthPct },
      ],
    },
  };
}

// ── fixture (ค)/(ง): circle yPct=95, hPct=20 — floor ความสูงขั้นต่ำ 8% (ในโค้ดเดิม
//   `h = Math.max(8, Math.min(h, 100-y))`) ชน ceiling ที่เหลือจริง (100-95=5%) → h ถูกบังคับ
//   เป็น 8% แทนที่จะเป็น 5% → y+h>100% (ล้นขอบล่าง)
//   ★ สำรวจแล้ว (รันจริงยืนยัน): ช่องสี่เหลี่ยม (rect) ผ่านระบบ grid-cluster+hole-fill (ปิดผืน ①-③)
//   ที่ clamp พิกัดเข้า [0,100] อยู่แล้วทุกเส้น (คลัสเตอร์ค่า ≥94 → 100 เสมอไม่ว่า input ดิบจะเกินแค่ไหน)
//   → x+w>canvasW ผ่าน DNA จริงไม่มีทางเกิดกับ rect ได้ (โครงเดิมกันไว้แน่นแล้ว) และวงกลม "ล้นขวา/ซ้าย"
//   เดี่ยวๆ ก็กันไว้แล้วเช่นกันโดยด่าน diameter-reclamp (บรรทัด ~180: `if (isC && (w>50||w<15))`
//   ใช้ w กำหนด d แล้ว re-clamp ทั้ง x,y ด้วย d เดียวกัน) — ด่านนี้เช็คเฉพาะ `w` จุดเดียว ไม่เช็ค `h`
//   จึงเป็นรูรั่วจริงหนึ่งเดียวที่ปล่อยให้ y+h ล้นขอบล่างหลุดออกมาได้ (ตรงกับอาการจริงที่พบ)
//   → (ค) ทดสอบ containment ทั่วไปแบบไม่มีขอบ (border=false) (ง) ทดสอบ containment รวม border
function makeOverflowCircleDNA({ border = true } = {}) {
  return {
    layoutType: 'triptych',
    template: {
      seamStyle: 'feather',
      featherPx: 8,
      slots: [
        { role: 'hero', xPct: 0, yPct: 0, wPct: 60, hPct: 100, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'reaction', xPct: 60, yPct: 0, wPct: 40, hPct: 100, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'face', shape: 'circle', xPct: 20, yPct: 95, wPct: 20, hPct: 20, zIndex: 4, border, borderColor: '#FFFFFF', borderWidthPct: 1.5 },
      ],
    },
  };
}

test('(ก) วงกลม borderWidth เกิน CIRCLE_BORDER_MAX (22) → clamp เหลือ = max', () => {
  const dna = makeCircleBorderDNA({ border: true, borderWidthPct: 2 }); // round(2/100*1080)=22
  const raw = withEnv('MEGA_GEO_CLAMP', '0', () => dnaToTemplateSpec(dna));
  const clamped = withEnv('MEGA_GEO_CLAMP', undefined, () => dnaToTemplateSpec(dna));
  const rawCircle = raw.slots.find((s) => s.shape === 'circle');
  const clampedCircle = clamped.slots.find((s) => s.shape === 'circle');
  assert.equal(rawCircle.borderWidth, 22, 'fixture ต้อง reproduce borderWidth=22 ตอนปิด clamp (control)');
  assert.equal(clampedCircle.borderWidth, TECH_RULES.CIRCLE_BORDER_MAX, 'เปิด clamp ต้องเหลือ = CIRCLE_BORDER_MAX');
});

test('(ข) วงกลม border=0/ไม่มี → clamp ตั้งค่ากลางปลอดภัย = 8', () => {
  const dna = makeCircleBorderDNA({ border: false }); // border falsy → borderWidth ดิบ = 0
  const raw = withEnv('MEGA_GEO_CLAMP', '0', () => dnaToTemplateSpec(dna));
  const clamped = withEnv('MEGA_GEO_CLAMP', undefined, () => dnaToTemplateSpec(dna));
  const rawCircle = raw.slots.find((s) => s.shape === 'circle');
  const clampedCircle = clamped.slots.find((s) => s.shape === 'circle');
  assert.equal(rawCircle.borderWidth, 0, 'fixture ต้อง reproduce borderWidth=0 ตอนปิด clamp (control)');
  assert.equal(clampedCircle.borderWidth, 8, 'เปิด clamp ต้องตั้งค่ากลางปลอดภัย = 8');
});

test('(ค) ช่องล้นขอบล่าง (y+h>canvasH, ไม่มี border) → geo-clamp ดันเข้าเฟรม (containment ทั่วไป)', () => {
  const dna = makeOverflowCircleDNA({ border: false });
  const raw = withEnv('MEGA_GEO_CLAMP', '0', () => dnaToTemplateSpec(dna));
  const clamped = withEnv('MEGA_GEO_CLAMP', undefined, () => dnaToTemplateSpec(dna));
  assert.ok(raw && clamped, 'ต้องได้ spec ทั้งคู่ (โครง DNA ต้องยังใช้ได้)');

  const rawCircle = raw.slots.find((s) => s.shape === 'circle');
  assert.ok(rawCircle, 'ต้องเจอ circle slot');
  assert.ok(rawCircle.y + rawCircle.h > raw.canvasH,
    `fixture ต้อง reproduce ช่องล้นเฟรมจริงตอนปิด clamp (ได้ y+h=${rawCircle.y + rawCircle.h}, canvasH=${raw.canvasH})`);

  for (const s of clamped.slots) {
    assert.ok(s.x >= 0 && s.y >= 0, `ช่อง ${s.id} ต้องไม่ติดลบ (x=${s.x} y=${s.y})`);
    assert.ok(s.x + s.w <= clamped.canvasW, `ช่อง ${s.id} ต้องไม่ล้นขวา (x=${s.x} w=${s.w} canvasW=${clamped.canvasW})`);
    assert.ok(s.y + s.h <= clamped.canvasH, `ช่อง ${s.id} ต้องไม่ล้นล่าง (y=${s.y} h=${s.h} canvasH=${clamped.canvasH})`);
  }
});

test('(ง) วงกลม center+radius+border ล้นขอบล่าง → geo-clamp เลื่อนเข้าเฟรม (containment รวม border)', () => {
  const dna = makeOverflowCircleDNA({ border: true });
  const raw = withEnv('MEGA_GEO_CLAMP', '0', () => dnaToTemplateSpec(dna));
  const clamped = withEnv('MEGA_GEO_CLAMP', undefined, () => dnaToTemplateSpec(dna));
  const rawCircle = raw.slots.find((s) => s.shape === 'circle');
  const clampedCircle = clamped.slots.find((s) => s.shape === 'circle');
  assert.ok(rawCircle && clampedCircle, 'ต้องเจอ circle slot ทั้งคู่');

  const rawBw = rawCircle.borderWidth || 0;
  const rawBottom = rawCircle.y + rawCircle.h + rawBw;
  assert.ok(rawBottom > raw.canvasH, `fixture ต้อง reproduce วงล้นขอบล่างตอนปิด clamp (ได้ bottom=${rawBottom}, canvasH=${raw.canvasH})`);

  const bw = clampedCircle.borderWidth || 0;
  assert.ok(clampedCircle.x - bw >= 0, 'ขอบซ้ายวง (รวม border) ต้องไม่ติดลบ');
  assert.ok(clampedCircle.y - bw >= 0, 'ขอบบนวง (รวม border) ต้องไม่ติดลบ');
  assert.ok(clampedCircle.x + clampedCircle.w + bw <= clamped.canvasW, 'ขอบขวาวง (รวม border) ต้องไม่ล้น');
  assert.ok(clampedCircle.y + clampedCircle.h + bw <= clamped.canvasH, 'ขอบล่างวง (รวม border) ต้องไม่ล้น');
});

test('(จ) geometry สะอาดอยู่แล้ว → clamp เป็น no-op (ผลเหมือนกันทุก field ไม่ว่าจะเปิดหรือปิด clamp)', () => {
  // ★ วงกลม "กลมจริงในพิกเซล": cwPct 20 = 216px กว้าง, chPct 16 = 16%×1350 = 216px สูง → 216×216 (square)
  //   + border 1% = 11px (ในช่วง [4,16]) + อยู่ในเฟรม → clean แท้ → clamp ต้องไม่แตะ (no-op)
  const dna = makeCircleBorderDNA({ border: true, borderWidthPct: 1.0, cwPct: 20, chPct: 16 });
  const raw = withEnv('MEGA_GEO_CLAMP', '0', () => dnaToTemplateSpec(dna));
  const clamped = withEnv('MEGA_GEO_CLAMP', undefined, () => dnaToTemplateSpec(dna));
  assert.deepEqual(clamped.slots, raw.slots, 'ทุก slot (x/y/w/h/borderWidth/...) ต้องเหมือนกันเป๊ะเมื่อ geometry สะอาดอยู่แล้ว');
});

test('(ช) วงกลมออกมาเป็นวงรีในพิกเซล (wPct=hPct แต่ canvas 1080≠1350) → clamp บังคับ w=h (diameter=min)', () => {
  const dna = makeCircleBorderDNA({ border: true, borderWidthPct: 1.0 }); // default 20×20% → 216กว้าง×270สูง = วงรี
  const raw = withEnv('MEGA_GEO_CLAMP', '0', () => dnaToTemplateSpec(dna)).slots.find((s) => s.shape === 'circle');
  assert.notEqual(raw.w, raw.h, 'control: ปิด clamp = วงรี (w≠h) พิสูจน์ fixture reproduce ปัญหาจริง');
  const c = withEnv('MEGA_GEO_CLAMP', undefined, () => dnaToTemplateSpec(dna)).slots.find((s) => s.shape === 'circle');
  assert.equal(c.w, c.h, 'เปิด clamp = วงกลมจริง w===h');
  assert.equal(c.w, Math.min(raw.w, raw.h), 'diameter = ด้านสั้นกว่า (min) — วงฟิตในผืนแน่นอน');
});

test('(ฉ) MEGA_GEO_CLAMP=0 → ปิด clamp ทั้งหมด (byte-parity ค่าดิบ ไม่ถูกแก้เลย)', () => {
  const dna = makeCircleBorderDNA({ border: true, borderWidthPct: 2 }); // จะเกิน max ถ้าเปิด clamp
  const off1 = withEnv('MEGA_GEO_CLAMP', '0', () => dnaToTemplateSpec(dna));
  const off2 = withEnv('MEGA_GEO_CLAMP', '0', () => dnaToTemplateSpec(dna));
  const offCircle1 = off1.slots.find((s) => s.shape === 'circle');
  const offCircle2 = off2.slots.find((s) => s.shape === 'circle');
  assert.equal(offCircle1.borderWidth, 22, 'ปิด clamp ต้องคงค่าดิบ 22 ไม่ถูกแก้');
  assert.deepEqual(offCircle1, offCircle2, 'ปิด clamp ต้อง deterministic เหมือนเดิมทุกครั้ง');
});
