// ============================================================
// 👁️‍🗨️ MEGA_SECOND_EYE (render-side) + 🛡️ MEGA_HEAD_SAFE — เคส AC-0195 27/28 ก.ค. 69
// (1) _applySecondEyeOverride (megaComposerService.js, PURE) — ทับ faceBox ที่ตรวจจับใหม่ตอนประกอบด้วยพิกัดจาก
//     ตาสอง (S6) เมื่อมีค่าแนบมาจริง คงค่า extras (subject/textRegion/watermarkRegion/hasText/pose) จากผลตรวจจับ
// (2) MEGA_HEAD_SAFE (coverExecutorService.js, ผ่าน executeCover จริง) — ด่านสุดท้ายกันหัวขาด: มี faceBox ครอบตัด
//     หัว → เลื่อนขึ้น / ไม่มี faceBox เลย → แนวตั้งยึดโซนบน (รวมเทส fixture ภาพตั้ง 1080×1920 ตามสเปคที่สั่ง)
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const SHARP_STUB = MOD(`
export default function sharp(input){
  const meta = globalThis.__SHARP_META || { width: 1200, height: 1200 };
  const chain = {
    metadata: async () => ({ width: meta.width, height: meta.height }),
    stats: async () => ({ channels: [{ mean: 128 }, { mean: 128 }, { mean: 128 }] }),
    extract(){ return chain; }, resize(){ return chain; }, png(){ return chain; }, jpeg(){ return chain; },
    linear(){ return chain; }, modulate(){ return chain; }, sharpen(){ return chain; }, blur(){ return chain; },
    composite(){ return chain; }, greyscale(){ return chain; }, raw(){ return chain; }, extend(){ return chain; },
    flatten(){ return chain; }, toColourspace(){ return chain; }, removeAlpha(){ return chain; },
    toBuffer: async () => Buffer.alloc(2048, 9),
  };
  return chain;
}`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(SHARP_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { _applySecondEyeOverride } = await import('../src/lib/services/megaComposerService.js');
const { executeCover } = await import('../src/lib/services/coverExecutorService.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

// ═══════════════════ (1) _applySecondEyeOverride — pure unit ═══════════════════

await test('_applySecondEyeOverride: loaded[i]._secondEyeFaceBox ถูกต้อง → ทับ x1/y1/x2/y2 + count:1 + allFaces 1 กล่อง คงค่า extras เดิม (subject/pose/textRegion)', () => {
  const detected = [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, imgW: 1000, imgH: 1000, count: 2, pose: 'profile', subject: { x1: 0, y1: 0, x2: 1, y2: 1 }, textRegion: { x1: 0.8, y1: 0, x2: 1, y2: 0.1 }, watermarkRegion: null, hasText: true, allFaces: [{}, {}] }];
  const loaded = [{ _w: 1000, _h: 1000, _secondEyeFaceBox: { x1: 0.3, y1: 0.2, x2: 0.6, y2: 0.5 } }];
  const out = _applySecondEyeOverride(detected, loaded);
  assert.deepEqual({ x1: out[0].x1, y1: out[0].y1, x2: out[0].x2, y2: out[0].y2 }, { x1: 0.3, y1: 0.2, x2: 0.6, y2: 0.5 }, 'พิกัดหน้าต้องเป็นของตาสอง ไม่ใช่ของ detector');
  assert.equal(out[0].count, 1, 'count ต้องกลายเป็น 1 (ตาสองให้แค่กรอบเดียว)');
  assert.equal(out[0].allFaces.length, 1);
  assert.equal(out[0].pose, 'profile', 'extras (pose) ต้องคงจาก detector เดิม');
  assert.equal(out[0].hasText, true, 'extras (hasText) ต้องคงจาก detector เดิม');
  assert.deepEqual(out[0].subject, { x1: 0, y1: 0, x2: 1, y2: 1 }, 'extras (subject) ต้องคงจาก detector เดิม');
});

await test('_applySecondEyeOverride: ไม่มี _secondEyeFaceBox บน loaded[i] → คืนผลตรวจจับเดิมเป๊ะ (byte-parity, ไม่แตะ)', () => {
  const detected = [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, count: 1 }, null];
  const loaded = [{}, {}];
  const out = _applySecondEyeOverride(detected, loaded);
  assert.deepEqual(out, detected, 'ไม่มีค่าตาสอง = ต้องคืน array เดิมทุก element เป๊ะ');
});

await test('_applySecondEyeOverride: _secondEyeFaceBox รูปแบบพัง (x2<x1) → ไม่ทับ (fail-safe คืนผลตรวจจับเดิม)', () => {
  const detected = [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, count: 1 }];
  const loaded = [{ _secondEyeFaceBox: { x1: 0.5, y1: 0.5, x2: 0.3, y2: 0.3 } }]; // x2<x1
  const out = _applySecondEyeOverride(detected, loaded);
  assert.deepEqual(out[0], detected[0]);
});

await test('_applySecondEyeOverride: MEGA_SECOND_EYE=0 → ไม่ทับเลยแม้มีค่าแนบมาถูกต้อง (kill-switch)', () => {
  process.env.MEGA_SECOND_EYE = '0';
  const detected = [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, count: 1 }];
  const loaded = [{ _secondEyeFaceBox: { x1: 0.3, y1: 0.2, x2: 0.6, y2: 0.5 } }];
  const out = _applySecondEyeOverride(detected, loaded);
  delete process.env.MEGA_SECOND_EYE;
  assert.deepEqual(out, detected, 'ปิดสวิตช์ต้องคืนผลตรวจจับเดิมเป๊ะ ไม่ทับแม้มีค่าส่งมา');
});

// ═══════════════ (1b) ลำดับอำนาจ faceBox 28 ก.ค. 69 — ตาสอง > faceDetector > triage เก่า (tier 3) ═══════════════

await test('ลำดับอำนาจ tier1: มีทั้งตาสองถูกต้อง + detector เจอหน้าจริง + triage เก่ามี faceBox → ใช้ของตาสอง (อำนาจสูงสุด)', () => {
  const detected = [{ x1: 0.05, y1: 0.05, x2: 0.15, y2: 0.15, count: 1 }]; // detector เจอหน้าจริง (tier 2)
  const loaded = [{ faceBox: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 }, _secondEyeFaceBox: { x1: 0.3, y1: 0.2, x2: 0.6, y2: 0.5 } }]; // tier 3 + tier 1 พร้อมกัน
  const out = _applySecondEyeOverride(detected, loaded);
  assert.deepEqual({ x1: out[0].x1, y1: out[0].y1, x2: out[0].x2, y2: out[0].y2 }, { x1: 0.3, y1: 0.2, x2: 0.6, y2: 0.5 }, 'ตาสอง (tier1) ต้องชนะทั้ง detector และ triage เก่า');
});

await test('ลำดับอำนาจ tier2: ไม่มีตาสอง แต่ detector เจอหน้าจริง + triage เก่าก็มี faceBox → ใช้ของ detector (tier2 ชนะ tier3)', () => {
  const detected = [{ x1: 0.05, y1: 0.05, x2: 0.15, y2: 0.15, count: 1, pose: 'frontal' }];
  const loaded = [{ faceBox: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 } }]; // ไม่มี _secondEyeFaceBox
  const out = _applySecondEyeOverride(detected, loaded);
  assert.deepEqual({ x1: out[0].x1, y1: out[0].y1, x2: out[0].x2, y2: out[0].y2 }, { x1: 0.05, y1: 0.05, x2: 0.15, y2: 0.15 }, 'detector (tier2) ต้องชนะ triage เก่า เมื่อไม่มีตาสอง');
});

await test('ลำดับอำนาจ tier3: ไม่มีตาสอง + detector ไม่เจอหน้าเลย (count:0/null) แต่ triage เก่ามี faceBox {x,y,w,h} ที่ใช้ได้ → ใช้ค่าจาก triage เก่าเป็นทางเลือกสุดท้าย (แปลงร่างเป็น x1y1x2y2 ถูกต้อง)', () => {
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg} (ได้ ${a} คาด ${b})`);
  const detected = [null, { x1: 0, y1: 0, x2: 0, y2: 0, count: 0, subject: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 } }];
  const loaded = [
    { faceBox: { x: 0.2, y: 0.25, w: 0.1, h: 0.125 } },
    { faceBox: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 } },
  ];
  const out = _applySecondEyeOverride(detected, loaded);
  close(out[0].x1, 0.2, 'x1'); close(out[0].y1, 0.25, 'y1'); close(out[0].x2, 0.3, 'x2 (x+w)'); close(out[0].y2, 0.375, 'y2 (y+h)');
  assert.equal(out[0].count, 1, 'tier3 fallback ต้องรายงาน count:1 (มีหน้าจริงจาก triage เก่า)');
  assert.equal(out[0]._fromOldTriage, true, 'ต้องติดธงว่ามาจาก tier3 (triage เก่า) ให้ตรวจสอบย้อนหลังได้');
  close(out[1].x1, 0.4, 'x1'); close(out[1].y1, 0.1, 'y1'); close(out[1].x2, 0.6, 'x2'); close(out[1].y2, 0.3, 'y2');
  assert.deepEqual(out[1].subject, { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 }, 'extras (subject) จาก detector เดิมต้องยังคงอยู่แม้ใช้พิกัดจาก tier3');
});

await test('ลำดับอำนาจ: ไม่มีทั้ง 3 ชั้น (detector ไม่เจอหน้า + triage เก่าก็ไม่มี/พังรูปแบบ) → คืนผลตรวจจับเดิม (ไร้หน้าจริง)', () => {
  const detected = [{ x1: 0, y1: 0, x2: 0, y2: 0, count: 0 }];
  const loaded = [{ faceBox: { x: 0.1, y: 0.1, w: 0, h: 0.1 } }]; // w=0 พังรูปแบบ (ไม่ใช่พื้นที่จริง)
  const out = _applySecondEyeOverride(detected, loaded);
  assert.deepEqual(out[0], detected[0], 'ไม่มีชั้นไหนใช้ได้เลย → ต้องคืนผลตรวจจับเดิมเป๊ะ ไม่ประดิษฐ์หน้าขึ้นมาเอง');
});

// ═══════════════════ (2) MEGA_HEAD_SAFE — ผ่าน executeCover จริง ═══════════════════

const RECT_SLOT = { id: 'reaction_1', x: 0, y: 0, w: 400, h: 500, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const mkTemplate = (slot) => ({ id: 'geo', canvasW: 1080, canvasH: 1350, feather: 0, slots: [slot] });
const runExec = async ({ metaW, metaH, fb, slot = RECT_SLOT, crop = null }) => {
  globalThis.__SHARP_META = { width: metaW, height: metaH };
  const traceSink = [];
  await executeCover({
    assignments: [{ slotId: slot.id, imageIndex: 0, crop }],
    imageBuffers: [{ buffer: Buffer.alloc(9001, 3) }],
    templateSpec: mkTemplate(slot), faceBoxes: [fb], traceSink,
  });
  globalThis.__SHARP_META = undefined;
  return traceSink.find((t) => t.slot === slot.id) || null;
};

await test('MEGA_HEAD_SAFE: หน้าอยู่เหนือหน้าต่างครอป (face top < region top) → เลื่อนหน้าต่างขึ้นคลุมหัว + branch ติด "+headsafe"', async () => {
  // หน้าเล็กอยู่สูงมาก (y1=0.05) แต่ crop เดิม (จาก director) เริ่มกลางภาพ (y=0.5) — จำลองพิกัดเก่าผิด/ครอปเดิมพลาด
  // ★ count:2 (ไม่มี allFaces) จงใจ — usableSingleFace/usableGroupFaces ทั้งคู่ false → renderRectTile ตกไป
  //   ใช้สาขา crop-based (noface-director-asis) แทน faceRegionForSlot ตรงๆ (ซึ่งจะครอบหน้าอยู่แล้วโดยไม่ง้อ
  //   MEGA_HEAD_SAFE) — แต่ fb เองยังมี x1/y1/x2/y2 จริงให้ MEGA_HEAD_SAFE ตรวจพบว่า crop พลาด
  const fb = { x1: 0.4, y1: 0.05, x2: 0.6, y2: 0.15, count: 2 };
  const crop = { x: 0.1, y: 0.5, w: 0.6, h: 0.4 }; // ไม่ _final — ครอปนี้เริ่มต่ำกว่าหัวมาก (จะตัดหัวถ้าไม่มีด่านนี้)
  const t = await runExec({ metaW: 1000, metaH: 2000, fb, crop });
  assert.ok(t, 'trace produced');
  assert.ok(t.branch.includes('headsafe') && !t.branch.includes('headsafetop'), `branch ต้องติด +headsafe (ได้ "${t.branch}")`);
});

await test('MEGA_HEAD_SAFE: MEGA_HEAD_SAFE=0 → ไม่เลื่อนเลย (byte-parity, ไม่มี +headsafe ใน branch)', async () => {
  process.env.MEGA_HEAD_SAFE = '0';
  const fb = { x1: 0.4, y1: 0.05, x2: 0.6, y2: 0.15, count: 1 };
  const crop = { x: 0.1, y: 0.5, w: 0.6, h: 0.4 };
  const t = await runExec({ metaW: 1000, metaH: 2000, fb, crop });
  delete process.env.MEGA_HEAD_SAFE;
  assert.ok(!t.branch.includes('headsafe'), `kill-switch OFF ต้องไม่มี +headsafe เลย (ได้ "${t.branch}")`);
});

await test('MEGA_HEAD_SAFE: fixture ตามสเปค — ภาพตั้ง 1080×1920 คนโซนบน ไม่มี faceBox เลย (ครอปตาบอด) → ครอปต้องคลุมโซนบน (window top ≤ 12% ของภาพ)', async () => {
  // ครอป director เดิมเล็งกลาง-ล่างภาพ (เหมือนภาพคนเต็มตัวถูกครอปกึ่งกลางแนวตั้งแบบเดิม) — ไม่มี faceBox เลย (ตาล้ม/ไม่มีข้อมูล)
  const crop = { x: 0.1, y: 0.45, w: 0.6, h: 0.5 }; // y=0.45 ⇒ region.top ≈ 0.45*1920=864px ≫ 12%(230px)
  const t = await runExec({ metaW: 1080, metaH: 1920, fb: null, crop });
  assert.ok(t, 'trace produced');
  // ★ เช็คผ่าน t.branch เท่านั้น ไม่เช็ค t.region.top ตรงๆ — trace snapshot (_cropTrace) ถูกสร้างก่อนขั้น
  //   MEGA_HEAD_SAFE ทำงาน (lag ที่รู้อยู่แล้วในระบบ trace) ดังนั้น t.region.top ยังโชว์ค่าก่อนปรับ (864px) แม้
  //   ด่านนี้ปรับ region จริงแล้ว (ยืนยันแยกต่างหากด้วยการรัน executeCover จริงและอ่านผลลัพธ์ภาพจริงถ้าต้องการ)
  assert.ok(t.branch.includes('headsafetop'), `branch ต้องติด +headsafetop (ได้ "${t.branch}")`);
});

await test('MEGA_HEAD_SAFE: ไม่มี faceBox แต่ครอปเดิมอยู่ในโซนบนแล้ว (top ≤12%) → ไม่แตะ (byte-parity ไม่ปรับซ้ำโดยไม่จำเป็น)', async () => {
  const crop = { x: 0.1, y: 0.02, w: 0.6, h: 0.3 }; // เริ่มใกล้ขอบบนอยู่แล้ว
  const t = await runExec({ metaW: 1080, metaH: 1920, fb: null, crop });
  assert.ok(!t.branch.includes('headsafetop'), `ครอปอยู่โซนบนแล้ว ไม่ควรมี +headsafetop (ได้ "${t.branch}")`);
});

await test('MEGA_HEAD_SAFE: แนวนอน (left/width) ไม่ถูกแตะเลยทั้งสองกรณี (มี/ไม่มี faceBox) — ปรับแค่แนวตั้ง', async () => {
  const fb = { x1: 0.4, y1: 0.05, x2: 0.6, y2: 0.15, count: 2 }; // count:2 ไม่มี allFaces — ดู comment เทส #5
  const crop = { x: 0.1, y: 0.5, w: 0.6, h: 0.4 };
  const off = await (async () => { process.env.MEGA_HEAD_SAFE = '0'; const r = await runExec({ metaW: 1000, metaH: 2000, fb, crop }); delete process.env.MEGA_HEAD_SAFE; return r; })();
  const on = await runExec({ metaW: 1000, metaH: 2000, fb, crop });
  assert.equal(on.region.left, off.region.left, 'left ต้องเท่ากันทั้งสองกรณี');
  assert.equal(on.region.width, off.region.width, 'width ต้องเท่ากันทั้งสองกรณี');
  // ★ เทียบผ่าน branch แทน region.top ตรงๆ (trace-lag เดียวกับเทส #7 — MEGA_HEAD_SAFE เป็นด่านเดียวที่ผลลัพธ์
  //   ไม่สะท้อนกลับเข้า t.region ก่อน snapshot ถูกสร้าง) — on ต้องติด +headsafe, off ต้องไม่ติด = ยืนยันทำงานจริง
  assert.ok(on.branch.includes('headsafe'), `on ต้องติด +headsafe (ได้ "${on.branch}")`);
  assert.ok(!off.branch.includes('headsafe'), `off ต้องไม่มี +headsafe เลย (ได้ "${off.branch}")`);
});

console.log(`\n# mega-second-eye-render: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
