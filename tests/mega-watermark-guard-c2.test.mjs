// ============================================================
// 💧 MEGA_WATERMARK_GUARD — C2 (29 ก.ค. 69, แบตช์ C "ด่านลายน้ำ") — avoidWatermarkEdgePx + renderRectTile/
//   renderCircleTile wiring (coverExecutorService.js)
// ------------------------------------------------------------
// Part A: avoidWatermarkEdgePx (PURE unit) — ค่าคาลิเบรตจากสคริปต์สำรวจจริง (ไม่ได้เดา):
//   (1) แตะขอบ + มีที่ว่างพอเลื่อน → เลื่อนอย่างเดียว (ขนาดเดิม)
//   (2) ไม่แตะขอบอยู่แล้ว → ไม่แตะ
//   (3) แตะขอบ + เลื่อนไม่พอ → หด (คง aspect) + เลื่อน
//   (4) หดแล้วเล็กเกิน 60px → ยอมแพ้ kept:true region เดิม
//   (5) เพดาน 12% แม้ strengthPct ที่ส่งมาเกิน
//   (6) ทำงานทั้ง 4 ด้าน (top/bottom/left/right)
// Part B: renderRectTile/renderCircleTile ผ่าน executeCover จริง — เห็น branch +wmedge + trace.watermarkKept +
//   ปิด flag = byte-parity + ไม่ชนกับ dodgeWatermarkPx เดิม (คนละกลไก รันต่อกันได้ปลอดภัย)
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';
import sharp from 'sharp';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const FACE_DETECTOR_STUB = _mod('export async function batchDetectFaces(){ return new Map(); }');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/services/faceDetector') return { url: ${JSON.stringify(FACE_DETECTOR_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { avoidWatermarkEdgePx, executeCover } = await import('../src/lib/services/coverExecutorService.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };
const setEnv = (key, v) => { if (v === null) delete process.env[key]; else process.env[key] = v; };

// ═══════════════════════════ Part A: avoidWatermarkEdgePx (PURE) ═══════════════════════════

await test('A-1: แตะขอบบน + มีที่ว่างพอเลื่อนครบ 12% → เลื่อนอย่างเดียว (ขนาดเดิมเป๊ะ)', () => {
  const r = avoidWatermarkEdgePx({ left: 0, top: 0, width: 400, height: 500 }, { side: 'top', strengthPct: 12 }, 2000, 1500);
  assert.equal(r.moved, true); assert.equal(r.kept, false);
  assert.deepEqual(r.region, { left: 0, top: 60, width: 400, height: 500 }, 'เลื่อน top ลง 12%*500=60 พอดี ขนาดเดิม');
});

await test('A-2: region ไม่ได้แตะขอบด้านนั้นอยู่แล้ว → ไม่แตะเลย (ปลอดภัยอยู่แล้ว)', () => {
  const region0 = { left: 0, top: 50, width: 400, height: 500 };
  const r = avoidWatermarkEdgePx(region0, { side: 'top', strengthPct: 12 }, 2000, 1500);
  assert.equal(r.moved, false); assert.equal(r.kept, false);
  assert.deepEqual(r.region, region0);
});

await test('A-3: แตะขอบบน + เลื่อนไม่พอ (ภาพต้นทางสูงใกล้เคียง region) → หด (คง aspect) + เลื่อนลง', () => {
  const r = avoidWatermarkEdgePx({ left: 800, top: 0, width: 400, height: 1450 }, { side: 'top', strengthPct: 12 }, 2000, 1500);
  assert.equal(r.moved, true); assert.equal(r.kept, false);
  assert.deepEqual(r.region, { left: 824, top: 174, width: 352, height: 1276 });
  assert.ok(Math.abs(r.region.width / r.region.height - 400 / 1450) < 0.001, 'aspect ต้องคงเดิม');
});

await test('A-4: หดแล้วเล็กเกิน 60px (ด้านใดด้านหนึ่ง) → ยอมแพ้ kept:true region เดิมเป๊ะ', () => {
  const region0 = { left: 800, top: 0, width: 50, height: 1000 };
  const r = avoidWatermarkEdgePx(region0, { side: 'top', strengthPct: 12 }, 2000, 1000);
  assert.equal(r.kept, true); assert.equal(r.moved, false);
  assert.deepEqual(r.region, region0, 'ยอมแพ้ต้องคง region เดิมเป๊ะ ไม่ใช่ครอปเล็กจนพัง');
});

await test('A-5: เพดานตายตัว 12% แม้ strengthPct ที่ส่งมาเกิน (100) → ผลเหมือน strengthPct=12 เป๊ะ', () => {
  const r100 = avoidWatermarkEdgePx({ left: 0, top: 0, width: 400, height: 500 }, { side: 'top', strengthPct: 100 }, 2000, 1500);
  const r12 = avoidWatermarkEdgePx({ left: 0, top: 0, width: 400, height: 500 }, { side: 'top', strengthPct: 12 }, 2000, 1500);
  assert.deepEqual(r100.region, r12.region, 'strengthPct เกิน 12 ต้องถูกหนีบเหลือ 12 เสมอ');
});

await test('A-6: ทำงานครบทั้ง 4 ด้าน (bottom/left/right) — เลื่อนอย่างเดียวเมื่อมีที่ว่างพอ', () => {
  const bottom = avoidWatermarkEdgePx({ left: 0, top: 1000, width: 400, height: 500 }, { side: 'bottom', strengthPct: 12 }, 2000, 1500);
  assert.deepEqual(bottom.region, { left: 0, top: 940, width: 400, height: 500 });
  const left = avoidWatermarkEdgePx({ left: 0, top: 0, width: 400, height: 500 }, { side: 'left', strengthPct: 12 }, 2000, 1500);
  assert.deepEqual(left.region, { left: 48, top: 0, width: 400, height: 500 });
  const right = avoidWatermarkEdgePx({ left: 1600, top: 0, width: 400, height: 500 }, { side: 'right', strengthPct: 12 }, 2000, 1500);
  assert.deepEqual(right.region, { left: 1552, top: 0, width: 400, height: 500 });
});

await test('A-7: ไม่มี marker / strengthPct<=0 / side ไม่ถูกต้อง / input พัง → คืน region เดิมเสมอ ไม่ throw', () => {
  const region0 = { left: 10, top: 10, width: 200, height: 200 };
  assert.deepEqual(avoidWatermarkEdgePx(region0, null, 1000, 1000).region, region0);
  assert.deepEqual(avoidWatermarkEdgePx(region0, { side: 'top', strengthPct: 0 }, 1000, 1000).region, region0);
  assert.deepEqual(avoidWatermarkEdgePx(region0, { side: 'diagonal', strengthPct: 12 }, 1000, 1000).region, region0);
  assert.deepEqual(avoidWatermarkEdgePx(null, { side: 'top', strengthPct: 12 }, 1000, 1000).region, null);
});

// ═══════════════════════════ Part B: renderRectTile/renderCircleTile ผ่าน executeCover จริง ═══════════════════════════
const SLOT_BASE = { id: 'reaction_1', x: 0, y: 0, w: 400, h: 500, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const CIRCLE_SLOT_BASE = { id: 'circle', x: 0, y: 0, w: 400, h: 400, zIndex: 4, border: null, borderWidth: 0, shape: 'circle' };
const mkTemplate = (slot) => ({ id: 'geo', canvasW: 1080, canvasH: 1350, feather: 0, slots: [slot] });

async function runExec({ slotBase, metaW, metaH, watermarkEdge, crop = null }) {
  const slot = watermarkEdge ? { ...slotBase, _watermarkEdge: watermarkEdge } : { ...slotBase };
  const traceSink = [];
  const buf = await sharp({ create: { width: metaW, height: metaH, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).jpeg({ quality: 85 }).toBuffer();
  await executeCover({
    assignments: [{ slotId: slot.id, imageIndex: 0, crop }],
    imageBuffers: [{ buffer: buf }],
    templateSpec: mkTemplate(slot), faceBoxes: [null], traceSink,
  });
  return traceSink.find((t) => t.slot === slot.id) || null;
}

await test('B-1: renderRectTile — slot._watermarkEdge (top) + ไม่มีหน้า (blind-center) → branch มี +wmedge, region.top เลื่อนต่างจากไม่มี marker', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null); // default ON
  const withWm = await runExec({ slotBase: SLOT_BASE, metaW: 2000, metaH: 1500, watermarkEdge: { side: 'top', strengthPct: 12 } });
  const noWm = await runExec({ slotBase: SLOT_BASE, metaW: 2000, metaH: 1500, watermarkEdge: null });
  assert.ok(withWm.branch.includes('+wmedge'), `ต้องเห็น branch +wmedge (ได้ "${withWm.branch}")`);
  assert.ok(!noWm.branch.includes('+wmedge'), 'ไม่มี marker ต้องไม่มี branch นี้เลย');
  assert.notEqual(withWm.region.top, noWm.region.top, 'region.top ต้องเปลี่ยนจริงเมื่อมี marker');
  assert.ok(!withWm.watermarkKept, 'เลื่อนสำเร็จ (ภาพกว้างพอ) = ไม่ติดธง watermarkKept');
});

await test('B-2: renderRectTile — final-cropper (crop._final) + slot._watermarkEdge → ยังหลบได้ (ครอบคลุมกิ่งนี้ด้วย เหมือน circle-avoid catch-all)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  // ★ คาลิเบรตจริง: fitCropInsideAspect ของ final-cropper เอนขึ้นบน (bias 20%) ทำให้ region.top=0 (แตะขอบบน)
  //   เสมอสำหรับครอปนี้ — ใช้ side='top' (ไม่ใช่ 'left' ที่ region.left ไม่แตะขอบหลัง fit aspect จริง)
  const finalCrop = { x: 0, y: 0, w: 0.3, h: 0.3, _final: true };
  const withWm = await runExec({ slotBase: SLOT_BASE, metaW: 2000, metaH: 1500, watermarkEdge: { side: 'top', strengthPct: 12 }, crop: finalCrop });
  const noWm = await runExec({ slotBase: SLOT_BASE, metaW: 2000, metaH: 1500, watermarkEdge: null, crop: finalCrop });
  assert.ok(withWm.branch.includes('final-cropper'), `ต้องยังอยู่กิ่ง final-cropper (ได้ "${withWm.branch}")`);
  assert.ok(withWm.branch.includes('+wmedge'), `ต้องเห็น +wmedge ต่อท้าย final-cropper (ได้ "${withWm.branch}")`);
  assert.notEqual(withWm.region.top, noWm.region.top, 'region.top ต้องเปลี่ยนจริงแม้เป็นครอป _final');
});

await test('B-3: renderRectTile — หดเมื่อเลื่อนไม่พอ → ติดธง watermarkKept เมื่อหดแล้วเล็กเกินไป (ภาพต้นทางแคบมาก)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const narrowSlot = { ...SLOT_BASE, w: 50, h: 1000 }; // ช่องแคบมาก (ratio 0.05) — หดแล้วแคบเกิน 60px
  const withWm = await runExec({ slotBase: narrowSlot, metaW: 2000, metaH: 1000, watermarkEdge: { side: 'top', strengthPct: 12 } });
  assert.ok(withWm.watermarkKept, 'หดแล้วเล็กเกินไป → ต้องติดธง watermarkKept');
});

await test('B-4 parity: MEGA_WATERMARK_GUARD=0 → ไม่มี branch +wmedge เลย แม้มี marker (byte-parity กับไม่มี marker)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', '0');
  const withWm = await runExec({ slotBase: SLOT_BASE, metaW: 2000, metaH: 1500, watermarkEdge: { side: 'top', strengthPct: 12 } });
  const noWm = await runExec({ slotBase: SLOT_BASE, metaW: 2000, metaH: 1500, watermarkEdge: null });
  assert.ok(!withWm.branch.includes('+wmedge'), `ปิด flag ต้องไม่มี branch +wmedge เลย (ได้ "${withWm.branch}")`);
  assert.deepEqual(withWm.region, noWm.region, 'ปิด flag ต้อง byte-parity กับไม่มี marker เลย');
  setEnv('MEGA_WATERMARK_GUARD', null);
});

await test('B-5: renderCircleTile — วงกลมมี slot._watermarkEdge เองก็หลบได้เหมือนกัน (คนละ code path จาก renderRectTile)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  // renderCircleTile กิ่ง noface (ไม่มีหน้า) ต้องพก crop จริง (ไม่ใช่ null — สาขาเดิมไม่กัน crop null เอง เหมือน renderRectTile)
  // ★ คาลิเบรตจริง: noface-square เอนขึ้นบน (bias 25% ของส่วนต่าง) — crop เต็มพอดี (w=h=1) ทำให้ top=0 (แตะขอบบน)
  //   ส่วน left=250 (ไม่แตะ) เพราะ side=min(pw,ph) แล้ว px เลื่อนมากึ่งกลางแนวนอน — ใช้ side='top' ให้ตรงกับที่แตะจริง
  const circleCrop = { x: 0, y: 0, w: 1, h: 1 };
  const withWm = await runExec({ slotBase: CIRCLE_SLOT_BASE, metaW: 2000, metaH: 1500, watermarkEdge: { side: 'top', strengthPct: 12 }, crop: circleCrop });
  const noWm = await runExec({ slotBase: CIRCLE_SLOT_BASE, metaW: 2000, metaH: 1500, watermarkEdge: null, crop: circleCrop });
  assert.ok(withWm.branch.includes('+wmedge'), `ต้องเห็น branch +wmedge ในวงกลมด้วย (ได้ "${withWm.branch}")`);
  assert.notEqual(withWm.region.top, noWm.region.top);
});

await test('B-6: ไม่ชนกับ dodgeWatermarkPx เดิม — เมื่อ faceBox มี fb.watermarkRegion (กลไกเดิม) ด้วยพร้อมกัน ทั้งสองกลไกทำงานได้โดยไม่พังกัน (รันต่อกัน ไม่เลื่อนซ้ำสอง เพราะคนละเงื่อนไข overlap)', async () => {
  setEnv('MEGA_WATERMARK_GUARD', null);
  const slot = { ...SLOT_BASE, _watermarkEdge: { side: 'top', strengthPct: 12 } };
  const traceSink = [];
  const buf = await sharp({ create: { width: 2000, height: 1500, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).jpeg({ quality: 85 }).toBuffer();
  // fb.watermarkRegion ทับโซนล่างของ region (กลไก dodgeWatermarkPx เดิม, คนละ field จาก _watermarkEdge)
  const fb = { x1: 0, y1: 0, x2: 0, y2: 0, watermarkRegion: { x1: 0.1, y1: 0.85, x2: 0.3, y2: 0.98 } };
  await executeCover({
    assignments: [{ slotId: slot.id, imageIndex: 0, crop: null }],
    imageBuffers: [{ buffer: buf }], templateSpec: mkTemplate(slot), faceBoxes: [fb], traceSink,
  });
  const tt = traceSink.find((t) => t.slot === slot.id);
  assert.ok(tt, 'ต้องมี trace');
  assert.ok(tt.branch.includes('+wmedge'), 'กลไกใหม่ (C2, _watermarkEdge) ต้องยังทำงาน');
  // ไม่ throw / ไม่พัง = ผ่าน (dodgeWatermarkPx เดิมทำงานหลัง _cropTrace แยกกันคนละจุด ไม่ปรากฏใน branch แต่ไม่ชนกัน)
});

console.log(`\n# mega-watermark-guard-c2: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
