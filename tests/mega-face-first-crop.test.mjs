// ============================================================
// 🧪 MEGA_FACE_FIRST_CROP (เคส AC-0197 27 ก.ค. 69 + ข้อ 4 ตรวจปกจริงรอบ 2) — src/lib/services/coverExecutorService.js
//
// เดิม MEGA_HERO_FACE_ZOOM (hero เท่านั้น) → ขยายเป็น "หน้ามาก่อนเสมอ" ทุกช่องที่มีคน ตามสูตรวัดจากปกยอดแสนไลค์:
//   hero เป้า 45-55% · ช่องย่อยมีคน (secondary) เป้า 30-45% · วงกลม เป้า 55-65% · แนวตา (eye-line) ~1/3 บนของช่อง
// ครอบคลุม: (1) unit _tightenForProminence override cfg รายชนิดช่อง (ceiling-bound + eye-line เรขาคณิตแม่นยำ)
//   (2) _heroUpscaleMaxEffExec parse/clamp/default (3) executeCover integration: หน้าเล็ก→ซูมขึ้นไม่เกินเพดาน /
//   หน้าใหญ่อยู่แล้ว→byte-parity / ไม่มี faceBox→byte-parity / kill-switch ปิด→เดิมทุก byte ทั้ง hero/secondary/circle
//
// เทคนิค: sharp stub (chainable, ไม่มีพิกเซลจริง) — แพตเทิร์นเดียวกับ tests/hero-crop-guard.test.mjs (พิสูจน์แล้วว่า
// สอดคล้องกับที่งานนี้เคยส่งมอบรอบก่อน) ให้เรขาคณิต/แขนงจริงทำงานครบ ทดสอบ branch/region/upscale ตรงๆ
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

const { executeCover, _tightenForProminence, _heroUpscaleMaxEffExec } = await import('../src/lib/services/coverExecutorService.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

const HERO_SLOT = { id: 'main', x: 0, y: 0, w: 594, h: 1350, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const SECONDARY_SLOT = { id: 'reaction_1', x: 0, y: 0, w: 400, h: 500, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const CIRCLE_SLOT = { id: 'circle', x: 0, y: 0, w: 300, h: 300, zIndex: 0, border: null, borderWidth: 0, shape: 'circle' };
const mkTemplate = (slot) => ({ id: 'geo', canvasW: 1080, canvasH: 1350, feather: 0, slots: [slot] });
const runExec = async ({ metaW, metaH, fb, slot, crop = null }) => {
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

// ═══════════════════ (1) _heroUpscaleMaxEffExec — parse/clamp/default (pure) ═══════════════════
await test('_heroUpscaleMaxEffExec: ไม่ตั้ง env → default 1.35', () => {
  delete process.env.MEGA_HERO_UPSCALE_MAX;
  assert.equal(_heroUpscaleMaxEffExec(), 1.35);
});
await test('_heroUpscaleMaxEffExec: ตั้งค่าปกติ (1.2) → ใช้ค่านั้นตรงๆ', () => {
  process.env.MEGA_HERO_UPSCALE_MAX = '1.2';
  assert.equal(_heroUpscaleMaxEffExec(), 1.2);
  delete process.env.MEGA_HERO_UPSCALE_MAX;
});
await test('_heroUpscaleMaxEffExec: เกินเพดานปลอดภัย (2.0) → clamp ที่ 1.6', () => {
  process.env.MEGA_HERO_UPSCALE_MAX = '2.0';
  assert.equal(_heroUpscaleMaxEffExec(), 1.6);
  delete process.env.MEGA_HERO_UPSCALE_MAX;
});
await test('_heroUpscaleMaxEffExec: ต่ำกว่าเพดานปลอดภัย (0.5) → clamp ที่ 1.0', () => {
  process.env.MEGA_HERO_UPSCALE_MAX = '0.5';
  assert.equal(_heroUpscaleMaxEffExec(), 1.0);
  delete process.env.MEGA_HERO_UPSCALE_MAX;
});
await test('_heroUpscaleMaxEffExec: ค่าพังรูปแบบ (ข้อความ) → default 1.35', () => {
  process.env.MEGA_HERO_UPSCALE_MAX = 'abc';
  assert.equal(_heroUpscaleMaxEffExec(), 1.35);
  delete process.env.MEGA_HERO_UPSCALE_MAX;
});

// ═══════════════════ (2) _tightenForProminence — unit hand-derived (hero override cfg) ═══════════════════
// slot 600x1200 (aspect 0.5, kind=hero) · region 400,300,1000x1300 · img 2000x2000 (ตัวเลขชุดเดียวกับ
// tests/hero-crop-guard.test.mjs test #4 — คงรูปแบบเดิมทุกจุด ต่างแค่ overrideCfg ที่ยัดเข้าไป)
const HERO_UNIT_SLOT = { id: 'main', w: 600, h: 1200 };
const HERO_UNIT_REGION = { left: 400, top: 300, width: 1000, height: 1300 };

await test('_tightenForProminence (hero override, faceH เล็ก 10% ของภาพ): ซูมเข้าจนชนเพดาน MEGA_HERO_UPSCALE_MAX(eff 1.35) — หน้ายังไม่ถึงเป้า 50% แต่ไม่ซูมเกินเพดานเด็ดขาด', () => {
  const fb = { x1: 0.46, y1: 0.40, x2: 0.54, y2: 0.50, count: 1 }; // fh=0.10 ⇒ faceHpx=200 @ imgH 2000
  const cfg = { target: 0.50, cap: 0.55, trigMul: 0.85, eyeLineFrac: 0.33, ceilingDivisor: 1.35 };
  const r = _tightenForProminence(HERO_UNIT_REGION, fb, HERO_UNIT_SLOT, 2000, 2000, cfg);
  assert.ok(r && r.meta.tightened, 'engages (curShare 0.1538 < trig 0.425)');
  const upscale = HERO_UNIT_SLOT.h / r.region.height;
  assert.ok(upscale <= 1.35 + 1e-6, `upscale ≤ 1.35 เพดาน eff (ได้ ${upscale.toFixed(4)})`);
  assert.ok(upscale >= 1.35 - 0.01, `ควรใช้เพดานเต็มที่ (เพราะเป้า 50% ต้องการ region เตี้ยกว่าที่เพดานยอม) — ได้ ${upscale.toFixed(4)}`);
  const resultShare = (0.10 * 2000) / r.region.height;
  assert.ok(resultShare < 0.50, `ยังไม่ถึงเป้า 50% เพราะติดเพดานก่อน (ได้ ${resultShare.toFixed(3)}) — "ซูมเท่าที่เพดานยอม" ตามสเปค`);
});

await test('_tightenForProminence (hero override): eye-line ลงจริงที่ ~1/3 บนของช่องที่ได้ (แทนสูตร headroom 10% เดิม)', () => {
  const fb = { x1: 0.46, y1: 0.40, x2: 0.54, y2: 0.50, count: 1 };
  const cfg = { target: 0.50, cap: 0.55, trigMul: 0.85, eyeLineFrac: 0.33, ceilingDivisor: 1.35 };
  const r = _tightenForProminence(HERO_UNIT_REGION, fb, HERO_UNIT_SLOT, 2000, 2000, cfg);
  assert.ok(r && r.meta.tightened);
  const eyeYpx = (fb.y1 + (fb.y2 - fb.y1) * 0.40) * 2000; // สูตรเดียวกับที่โค้ดใช้ประมาณแนวตา
  const eyeFrac = (eyeYpx - r.region.top) / r.region.height;
  assert.ok(Math.abs(eyeFrac - 0.33) < 0.02, `แนวตาต้องอยู่ราว 33% ของช่อง (ได้ ${eyeFrac.toFixed(3)})`);
});

await test('_tightenForProminence (hero override): หน้าใหญ่พอแล้ว (curShare ≥ trig 0.425) → คืน null (byte-parity, ไม่ซูมซ้ำ)', () => {
  const fb = { x1: 0.46, y1: 0.40, x2: 0.54, y2: 0.50, count: 1 }; // faceHpx=200 @ imgH 2000
  const region = { left: 400, top: 300, width: 350, height: 455 }; // curShare = 200/455 ≈ 0.44 ≥ 0.425
  const cfg = { target: 0.50, cap: 0.55, trigMul: 0.85, eyeLineFrac: 0.33, ceilingDivisor: 1.35 };
  const r = _tightenForProminence(region, fb, HERO_UNIT_SLOT, 2000, 2000, cfg);
  assert.equal(r, null, 'เด่นพอแล้ว — ไม่ยุ่ง (กัน regression ครอปที่ดีอยู่แล้ว)');
});

await test('_tightenForProminence: faceBox ไม่มี/invalid → คืน null ทันที (ไม่เปลี่ยน region)', () => {
  const cfg = { target: 0.50, cap: 0.55, trigMul: 0.85, eyeLineFrac: 0.33, ceilingDivisor: 1.35 };
  assert.equal(_tightenForProminence(HERO_UNIT_REGION, null, HERO_UNIT_SLOT, 2000, 2000, cfg), null);
  assert.equal(_tightenForProminence(HERO_UNIT_REGION, { x1: 0.5, x2: 0.5, y1: 0.4, y2: 0.5 }, HERO_UNIT_SLOT, 2000, 2000, cfg), null, 'x2==x1 (กว้าง 0) = invalid');
  assert.equal(_tightenForProminence(HERO_UNIT_REGION, undefined, HERO_UNIT_SLOT, 2000, 2000, cfg), null);
});

// secondary kind (slot เล็ก ไม่ใช่ hero) — เป้า 30-45%, ไม่ยัด ceilingDivisor (fallback FACE_PROM_CEILING=1.6 เดิม)
const SEC_UNIT_SLOT = { id: 'reaction_1', w: 400, h: 500 };
await test('_tightenForProminence (secondary override, ไม่ยัด ceilingDivisor): เพดานยืด fallback เป็น FACE_PROM_CEILING(1.6) เดิม ไม่ใช่ 1.35/1.2 ของ hero', () => {
  const fb = { x1: 0.47, y1: 0.42, x2: 0.53, y2: 0.48, count: 1 }; // fh=0.06 เล็กมาก ⇒ ชนเพดานแน่นอน
  const region = { left: 50, top: 50, width: 400, height: 800 };
  const cfg = { target: 0.375, cap: 0.45, trigMul: 0.85, eyeLineFrac: 0.33 }; // ไม่มี ceilingDivisor
  const r = _tightenForProminence(region, fb, SEC_UNIT_SLOT, 1000, 1000, cfg);
  assert.ok(r && r.meta.tightened);
  const upscale = SEC_UNIT_SLOT.h / r.region.height;
  assert.ok(upscale <= 1.6 + 1e-6, `เพดาน secondary ต้องเป็น 1.6 (ได้ ${upscale.toFixed(3)})`);
  assert.ok(upscale > 1.35 + 1e-6, `ต้องพิสูจน์ว่าไม่ได้ถูกจำกัดที่ 1.35 ของ hero โดยไม่ตั้งใจ (ได้ ${upscale.toFixed(3)})`);
});

// ═══════════════════ (3) executeCover integration — real branch/region proof end-to-end ═══════════════════
// หมายเหตุสำคัญ (เหมือนบทเรียนใน tests/hero-crop-guard.test.mjs test #4): สาย hero เต็ม pipeline มี
// HERO_CROP_GUARD 3/3 (expandHeroRegionForStretchCap) รันทีหลัง _facezoom เสมอ — ถ้าซูมของเราทำให้ upscale
// เกิน 1.2 มันจะดึงกลับ (branch ต่อท้าย '+stretchcap' แทน '+facezoom' หายไป) เป็นพฤติกรรม "ขีดจำกัดเดิมคุมเสมอ"
// ที่ตั้งใจไว้แต่แรก (ไม่แตะ guard เดิม) — fixture ด้านล่างเลือกภาพใหญ่พอให้ผลลัพธ์สุดท้ายยัง ≤1.2 (ไม่ชน stretchcap)
// เพื่อพิสูจน์ branch '+facezoom' ตรงๆ (ยืนยันด้วย node สดจาก probe สคริปต์ก่อนเขียนเทส ไม่ใช่เดา)

const smallHeroFb = { x1: 0.47, y1: 0.31, x2: 0.53, y2: 0.39, count: 1 }; // fh=0.08, ที่ img ใหญ่พอ upscale จะ <1.2 (ไม่ชน stretchcap)

await test('executeCover (hero): หน้าเล็ก (fh=0.08 บนภาพ 8000×8000 — เหลือพื้นที่พอไม่ชนเพดาน 1.2 เดิม) → branch ได้ต่อท้าย "+facezoom" จริง, region แน่นกว่า kill-switch OFF', async () => {
  const on = await runExec({ metaW: 8000, metaH: 8000, fb: smallHeroFb, slot: HERO_SLOT });
  process.env.MEGA_FACE_FIRST_CROP = '0';
  const off = await runExec({ metaW: 8000, metaH: 8000, fb: smallHeroFb, slot: HERO_SLOT });
  delete process.env.MEGA_FACE_FIRST_CROP;
  assert.ok(on.branch.includes('+facezoom'), `branch ต้องมี +facezoom (ได้ "${on.branch}")`);
  assert.ok(!off.branch.includes('+facezoom'), `kill-switch OFF ต้องไม่มี +facezoom เลย (ได้ "${off.branch}")`);
  assert.ok(on.region.height < off.region.height, `ซูมเข้าจริง — region เตี้ยกว่า OFF (ON=${on.region.height} OFF=${off.region.height})`);
  assert.ok(on.upscaleRaw <= 1.35 + 1e-6, `ยังอยู่ในเพดาน eff 1.35 (ได้ ${on.upscaleRaw})`);
});

await test('executeCover (hero): หน้าใหญ่อยู่แล้ว (fh=0.50) → ไม่มี +facezoom ทั้ง ON/OFF, region เหมือนกันทุกจุด (byte-parity ระดับเรขาคณิต)', async () => {
  const fbBig = { x1: 0.30, y1: 0.10, x2: 0.70, y2: 0.60, count: 1 };
  const on = await runExec({ metaW: 1600, metaH: 2000, fb: fbBig, slot: HERO_SLOT });
  process.env.MEGA_FACE_FIRST_CROP = '0';
  const off = await runExec({ metaW: 1600, metaH: 2000, fb: fbBig, slot: HERO_SLOT });
  delete process.env.MEGA_FACE_FIRST_CROP;
  assert.ok(!on.branch.includes('+facezoom') && !off.branch.includes('+facezoom'), 'หน้าใหญ่พอแล้ว ไม่ต้องซูมเพิ่มทั้งคู่');
  assert.deepEqual(on.region, off.region, 'region ต้องเหมือนกันเป๊ะทุก field (byte-parity)');
});

await test('executeCover (hero): ไม่มี faceBox เลย (fb=null, ใช้ crop ของ director แทน) → branch/region เหมือนกันทุก byte ทั้ง ON/OFF ของ MEGA_FACE_FIRST_CROP', async () => {
  const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.7 };
  const on = await runExec({ metaW: 1600, metaH: 2000, fb: null, slot: HERO_SLOT, crop });
  process.env.MEGA_FACE_FIRST_CROP = '0';
  const off = await runExec({ metaW: 1600, metaH: 2000, fb: null, slot: HERO_SLOT, crop });
  delete process.env.MEGA_FACE_FIRST_CROP;
  assert.equal(on.branch, off.branch);
  assert.deepEqual(on.region, off.region, 'ไม่มี faceBox — ไม่มีอะไรให้ facezoom ทำงาน ต้องเหมือนเดิมเป๊ะ');
});

await test('executeCover (secondary/circle): kill-switch MEGA_FACE_FIRST_CROP=0 → circle ไม่ได้เป้าใหม่ (share ต่ำแบบเดิม ~35-40% ไม่ใช่ ~55-65%)', async () => {
  const fbCircle = { x1: 0.44, y1: 0.30, x2: 0.56, y2: 0.42, count: 1 }; // fh=0.12
  const on = await runExec({ metaW: 2000, metaH: 2000, fb: fbCircle, slot: CIRCLE_SLOT });
  process.env.MEGA_FACE_FIRST_CROP = '0';
  const off = await runExec({ metaW: 2000, metaH: 2000, fb: fbCircle, slot: CIRCLE_SLOT });
  delete process.env.MEGA_FACE_FIRST_CROP;
  const shareOn = (0.12 * 2000) / on.region.height;
  const shareOff = (0.12 * 2000) / off.region.height;
  assert.ok(shareOn >= 0.50, `เปิดสวิตช์: หน้าเต็มวงตามสูตรใหม่ ~55-65% (ได้ ${(shareOn * 100).toFixed(1)}%)`);
  assert.ok(shareOff < shareOn, `ปิดสวิตช์ต้องได้ share ต่ำกว่าเดิม (สูตรเก่า ~45% target) — ON=${(shareOn * 100).toFixed(1)}% OFF=${(shareOff * 100).toFixed(1)}%`);
  assert.notDeepEqual(on.region, off.region, 'region ต้องต่างกันจริง (ไม่ใช่ no-op)');
});

// ═══════════════════ (4) MEGA_SUBSLOT_CENTER — กึ่งกลางกลุ่มหน้าจริง (แกนนอน) แทนเลื่อนน้อยสุด ═══════════════════

await test('executeCover (secondary, กลุ่ม 2 หน้าเอียงขวา): MEGA_SUBSLOT_CENTER ON → กึ่งกลางกลุ่มหน้าแนวนอนพอดีเป๊ะ (แทนเลื่อนน้อยสุดแบบเดิมที่เบี้ยวออกจากศูนย์กลาง)', async () => {
  const groupFb = {
    x1: 0.60, y1: 0.40, x2: 0.66, y2: 0.50, count: 2,
    allFaces: [{ x1: 0.60, y1: 0.40, x2: 0.66, y2: 0.50 }, { x1: 0.68, y1: 0.41, x2: 0.74, y2: 0.49 }],
  };
  const imgW = 2000;
  const on = await runExec({ metaW: imgW, metaH: 2500, fb: groupFb, slot: SECONDARY_SLOT });
  process.env.MEGA_SUBSLOT_CENTER = '0';
  const off = await runExec({ metaW: imgW, metaH: 2500, fb: groupFb, slot: SECONDARY_SLOT });
  delete process.env.MEGA_SUBSLOT_CENTER;
  assert.equal(on.region.width, off.region.width, 'centerMode เปลี่ยนแค่ตำแหน่ง ไม่เปลี่ยนขนาด (width เท่ากัน)');
  assert.equal(on.region.height, off.region.height, 'centerMode เปลี่ยนแค่ตำแหน่ง ไม่เปลี่ยนขนาด (height เท่ากัน)');
  const groupCx = ((groupFb.allFaces[0].x1 + groupFb.allFaces[1].x2) / 2) * imgW; // จุดกึ่งกลางกลุ่มหน้าจริง (px ต้นทาง)
  const onRegionCx = on.region.left + on.region.width / 2;
  const offRegionCx = off.region.left + off.region.width / 2;
  assert.ok(Math.abs(onRegionCx - groupCx) < 1, `ON: ศูนย์กลาง region ต้องตรงศูนย์กลางกลุ่มหน้าพอดี (ห่าง ${Math.abs(onRegionCx - groupCx).toFixed(1)}px)`);
  assert.ok(Math.abs(offRegionCx - groupCx) > 5, `OFF (เดิม): ต้องเบี้ยวออกจากศูนย์กลางจริงอย่างมีนัย (ห่าง ${Math.abs(offRegionCx - groupCx).toFixed(1)}px) — พิสูจน์ ON แก้อะไรจริง ไม่ใช่ no-op`);
});

// ═══════════════════ (5) แกน (ก) 2-3 หน้ากลุ่มในช่องย่อย — band แคบลง [30,45] แทน band บทบาทเดิม ═══════════════════

await test('executeCover (secondary, กลุ่ม 2 หน้า): MEGA_FACE_FIRST_CROP ON → ใช้ band [30,45] แคบกว่า band บทบาทเดิม (_panelBandForSlot reaction=[38,68]) ได้ region ต่างจากปิดสวิตช์จริง', async () => {
  const groupFb = {
    x1: 0.60, y1: 0.40, x2: 0.66, y2: 0.50, count: 2,
    allFaces: [{ x1: 0.60, y1: 0.40, x2: 0.66, y2: 0.50 }, { x1: 0.68, y1: 0.41, x2: 0.74, y2: 0.49 }],
  };
  const on = await runExec({ metaW: 2000, metaH: 2500, fb: groupFb, slot: SECONDARY_SLOT });
  process.env.MEGA_FACE_FIRST_CROP = '0';
  const off = await runExec({ metaW: 2000, metaH: 2500, fb: groupFb, slot: SECONDARY_SLOT });
  delete process.env.MEGA_FACE_FIRST_CROP;
  assert.notDeepEqual(on.region, off.region, 'band [30,45] ใหม่ต้องให้ region ต่างจาก band บทบาทเดิม [38,68] จริง (ไม่ใช่ no-op)');
});

// ═══════════════════ (6) ข้อ 3 — ไม่มี faceBox เลย (blind, ไม่มี crop จาก director ด้วย) → default กึ่งกลางภาพ ═══════════════════

await test('executeCover (secondary, blind สุดทาง — ไม่มี crop ไม่มี faceBox เลย เช่นตาล้มบนคลาวด์): MEGA_SUBSLOT_CENTER ON → branch noface-blind-center, region = กึ่งกลางภาพเต็ม (ไม่ใช่มุมใดมุมหนึ่ง)', async () => {
  const t = await runExec({ metaW: 1600, metaH: 2000, fb: null, slot: SECONDARY_SLOT, crop: null });
  assert.equal(t.branch, 'noface-blind-center');
  assert.deepEqual(t.region, { left: 0, top: 0, width: 1600, height: 2000 }, 'ครอปเต็มภาพ (fitCropToSlotAspect ของกรอบเต็ม 0,0,1,1 = กึ่งกลางภาพเสมอ เพราะ input สมมาตรรอบศูนย์กลางภาพอยู่แล้ว)');
});

console.log(`\n# mega-face-first-crop: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
