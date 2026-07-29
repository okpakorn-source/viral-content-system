// ============================================================
// 🧪 ข้อสุดท้าย (27 ก.ค. 69) — align ด่าน HERO_CROP_GUARD ปลายน้ำ (เพดานแข็ง 1.2×) ให้ใช้เพดานเดียวกับ
// _heroUpscaleMaxEffExec (env MEGA_HERO_UPSCALE_MAX, default 1.35 + clamp เดิม) เพื่อให้ MEGA_FACE_FIRST_CROP
// (ข้อ 1) ซูมได้จริงถึงเป้า 45-55% — ยกเว้นสาย strict (MEGA_STRICT_RENDER=1) ต้องคงสัญญา 1.2 เดิมเป๊ะ
//
// จุดที่แก้: src/lib/services/coverExecutorService.js
//   - _heroUpscaleMaxEffExec(): เพิ่ม MEGA_TIER2_OFF=1 → กลับ 1.2 ตรงๆ (mirror megaAdapters.js _tier2OffHero)
//   - renderRectTile(..., strict=false) พารามิเตอร์ใหม่: HERO_CROP_GUARD 3/3 ใช้ cap = strict ? HERO_STRETCH_MAX(1.2) : eff
//   - executeCover({..., strict=false}): thread ผ่านไปยัง renderRectTile
//   - megaComposerService.js: composeCoreStrict ส่ง strict:true (สายเดียวที่เป็น "สาย strict" จริง) · จุดเรียกอื่น
//     ทั้งหมด (legacy composeCore / eye-fix retry / recrop candidate) ส่ง false หรืออิงจาก core._strictSourceLock/strictCtx
//
// เทคนิค: sharp stub (chainable) แพตเทิร์นเดียวกับ tests/hero-crop-guard.test.mjs
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

const { executeCover, _heroUpscaleMaxEffExec } = await import('../src/lib/services/coverExecutorService.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

const HERO_SLOT = { id: 'main', x: 0, y: 0, w: 594, h: 1350, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const mkTemplate = (slotOverrides = {}) => ({ id: 'geo', canvasW: 1080, canvasH: 1350, feather: 0, slots: [{ ...HERO_SLOT, ...slotOverrides }] });
const runExec = async ({ metaW, metaH, fb, slotOverrides, strict = false }) => {
  globalThis.__SHARP_META = { width: metaW, height: metaH };
  const traceSink = [];
  await executeCover({
    assignments: [{ slotId: 'main', imageIndex: 0, crop: null }],
    imageBuffers: [{ buffer: Buffer.alloc(9001, 3) }],
    templateSpec: mkTemplate(slotOverrides), faceBoxes: [fb], traceSink, strict,
  });
  globalThis.__SHARP_META = undefined;
  return traceSink.find((t) => t.slot === 'main') || null;
};
const groupFaces = (largest, second) => ({ x1: largest.x1, y1: largest.y1, x2: largest.x2, y2: largest.y2, count: 2, allFaces: [largest, second] });
// ★ B13 fix (เฟส B-2 ข้อ 6, 29 ก.ค. 69, MEGA_STRETCH_NEIGHBOR_FIX): เดิมฟิกซ์เจอร์นี้ใช้ "คู่หน้าซ้อนกันต้องหด+ยืด"
//   เดียวกับ tests/hero-crop-guard.test.mjs test #2 ตรงๆ (เพื่อเทียบเพดานตรงๆ) — แต่หลัง B13 fix จุดประสงค์นั้นใช้
//   ไม่ได้แล้ว: เมื่อ resolveHeroNeighborOverlap หด region เพราะเพื่อนบ้านจริง ความกว้างหลังหดจะ "เท่ากับ" โซนปลอดภัย
//   ที่ expandHeroRegionForStretchCap (ตอนนี้รู้จักโซนเดียวกัน) ยอมให้ขยายกลับได้สูงสุดพอดี — ทำให้ upscale หลังหด
//   ชนเพดานโซนปลอดภัยเสมอ ไม่ว่า cap (1.2/1.35/1.6) จะตั้งเป็นอะไร (พิสูจน์เพดานแยกกันไม่ได้อีกต่อไปด้วยฟิกซ์เจอร์เดิม
//   — เป็นผลลัพธ์ที่ถูกต้องของ B13 ไม่ใช่บั๊กใหม่) → เปลี่ยนฟิกซ์เจอร์เป็น "หน้าที่สองอยู่ไกลมุมภาพ ไม่ทับ/ไม่หดเลย"
//   (branch เหลือแค่ 'group-hero-largest+stretchcap' ไม่มี '+shrink') ให้ B13's rMin/rMax กว้างพอจนไม่จำกัดอะไร
//   → เพดานยืด (eff/strict/TIER2_OFF) กลับมาเป็นตัวกำหนดผลลัพธ์เพียงอย่างเดียวเหมือนเจตนาเดิมของชุดเทสนี้ (ยืนยันตัวเลข
//   ด้วยสคริปต์สำรวจจริงก่อนแก้ ไม่ใช่เดา)
const LARGEST = { x1: 0.42, y1: 0.30, x2: 0.58, y2: 0.42 };
const SECOND = { x1: 0.02, y1: 0.05, x2: 0.10, y2: 0.13 }; // มุมภาพ ไกลจาก largest มาก — ไม่ทับ ไม่กระตุ้น shrink เลย
const FB = groupFaces(LARGEST, SECOND);
const IMG = { metaW: 1200, metaH: 2727 };

// ═══════════════════ (1) _heroUpscaleMaxEffExec — MEGA_TIER2_OFF precedence (pure unit) ═══════════════════

await test('_heroUpscaleMaxEffExec: MEGA_TIER2_OFF=1 → กลับ 1.2 ตรงๆ แม้ MEGA_HERO_UPSCALE_MAX ตั้งเป็นอย่างอื่น (สวิตช์แม่ชนะเสมอ)', () => {
  process.env.MEGA_TIER2_OFF = '1';
  process.env.MEGA_HERO_UPSCALE_MAX = '1.5';
  assert.equal(_heroUpscaleMaxEffExec(), 1.2);
  delete process.env.MEGA_TIER2_OFF;
  delete process.env.MEGA_HERO_UPSCALE_MAX;
});

await test('_heroUpscaleMaxEffExec: ไม่ตั้ง MEGA_TIER2_OFF → ยัง default 1.35 เหมือนเดิม (ไม่กระทบพฤติกรรมเดิมของพารามิเตอร์นี้)', () => {
  delete process.env.MEGA_TIER2_OFF;
  delete process.env.MEGA_HERO_UPSCALE_MAX;
  assert.equal(_heroUpscaleMaxEffExec(), 1.35);
});

// ═══════════════════ (2) executeCover: ปกติ (ไม่ strict) ซูมได้ถึง eff cap จริง (ไม่ถูกดึงกลับ 1.2 เงียบๆ) ═══════════════════

await test('executeCover (ไม่ strict, default env): หน้าซ้อนกันต้องยืดเกิน 1.2 → ด่านปลายน้ำยอมให้ถึงเพดาน eff (1.35) จริง ไม่ใช่ถูกดึงกลับ 1.2 เหมือนเดิม', async () => {
  const t = await runExec({ ...IMG, fb: FB, strict: false });
  assert.ok(t, 'hero trace produced');
  assert.ok(t.branch.includes('stretchcap'), `branch ต้องผ่านด่าน stretchcap (ได้ "${t.branch}")`);
  assert.ok(t.upscaleRaw > 1.2 + 1e-6, `เพดานใหม่ต้องยอมให้เกิน 1.2 ได้ (ได้ ${t.upscaleRaw}) — พิสูจน์ว่าด่านปลายน้ำไม่ได้ดึงกลับ 1.2 อีกต่อไปในสายไม่ strict`);
  assert.ok(t.upscaleRaw <= 1.35 + 1e-6, `แต่ต้องไม่เกินเพดาน eff 1.35 (ได้ ${t.upscaleRaw})`);
});

await test('executeCover (ไม่ strict, MEGA_HERO_UPSCALE_MAX="1.2" ตั้งเอง): กลับพฤติกรรมเดิมเป๊ะ (byte-parity กับก่อนแก้ข้อสุดท้ายนี้)', async () => {
  process.env.MEGA_HERO_UPSCALE_MAX = '1.2';
  const t = await runExec({ ...IMG, fb: FB, strict: false });
  delete process.env.MEGA_HERO_UPSCALE_MAX;
  assert.ok(t.upscaleRaw <= 1.2 + 1e-6, `ตั้ง env กลับ 1.2 เอง ต้องได้ผลเหมือนเดิมเป๊ะ (ได้ ${t.upscaleRaw})`);
});

// ═══════════════════ (3) executeCover: strict=true ต้องคง 1.2 เดิมเป๊ะ แม้ default/env จะยอมมากกว่า ═══════════════════

await test('executeCover (strict=true, default env ไม่ตั้งอะไร): ด่านปลายน้ำยังคง hard-cap ที่ 1.2 เป๊ะ ไม่ใช่ eff 1.35 — สัญญา strict ต้องไม่เปลี่ยน', async () => {
  const t = await runExec({ ...IMG, fb: FB, strict: true });
  assert.ok(t, 'hero trace produced');
  assert.ok(t.upscaleRaw <= 1.2 + 1e-6, `strict ต้องถูกดึงกลับ 1.2 เสมอ (ได้ ${t.upscaleRaw})`);
});

await test('executeCover (strict=true + MEGA_HERO_UPSCALE_MAX="1.6" ตั้งไว้): strict ต้องชนะ env เสมอ ยัง 1.2 เป๊ะ ไม่ใช่ 1.6', async () => {
  process.env.MEGA_HERO_UPSCALE_MAX = '1.6';
  const t = await runExec({ ...IMG, fb: FB, strict: true });
  delete process.env.MEGA_HERO_UPSCALE_MAX;
  assert.ok(t.upscaleRaw <= 1.2 + 1e-6, `strict ชนะ env เสมอ (ได้ ${t.upscaleRaw})`);
});

// ★ ตรวจซ้ำ (28 ก.ค. 69 — "strict region drift"): จุด MEGA_FACE_FIRST_CROP (renderRectTile ~บรรทัด 1094) เดิมยัด
//   _heroUpscaleMaxEffExec() ตรงๆ ไม่เช็ก strict เลย ⇒ สาย strict เคยได้ region ต่างกันตาม env MEGA_HERO_UPSCALE_MAX
//   (พิสูจน์ด้วยฟิกซ์เจอร์หน้าเดี่ยว 3000×2000 — คนละภาพ/คนละ branch จากเทสชุดบนที่ใช้ฟิกซ์เจอร์ 2 หน้าซ้อนกัน 1200×2727)
//   แก้แล้ว: ceilingDivisor ในจุดนั้นก็ strict ? HERO_STRETCH_MAX : eff เหมือนจุด HERO_CROP_GUARD 3/3 ทุกประการ —
//   เทสนี้ยืนยัน "region เท่ากันเป๊ะทุก field" ไม่ใช่แค่ upscale ≤1.2 (เพราะ drift แบบเดิมโผล่ที่ตำแหน่ง/ขนาด region
//   ไม่ใช่แค่ตัวเลข upscale ปลายทาง)
const SINGLE_FB_3000x2000 = { x1: 0.47, y1: 0.31, x2: 0.53, y2: 0.39, count: 1 };
await test('strict region drift (แก้แล้ว): fixture หน้าเดี่ยว 3000×2000, strict=true + MEGA_HERO_UPSCALE_MAX ∈ {ไม่ตั้ง, "1.2", "1.6"} → region ต้องเท่ากันเป๊ะทุก field ทุกค่า env (ไม่ใช่แค่ upscale ≤1.2)', async () => {
  delete process.env.MEGA_HERO_UPSCALE_MAX;
  const rUnset = await runExec({ metaW: 3000, metaH: 2000, fb: SINGLE_FB_3000x2000, strict: true });
  process.env.MEGA_HERO_UPSCALE_MAX = '1.2';
  const r12 = await runExec({ metaW: 3000, metaH: 2000, fb: SINGLE_FB_3000x2000, strict: true });
  process.env.MEGA_HERO_UPSCALE_MAX = '1.6';
  const r16 = await runExec({ metaW: 3000, metaH: 2000, fb: SINGLE_FB_3000x2000, strict: true });
  delete process.env.MEGA_HERO_UPSCALE_MAX;
  assert.ok(rUnset && r12 && r16, 'ทั้ง 3 รอบต้องได้ trace จริง');
  assert.deepEqual(r12.region, rUnset.region, `region (env="1.2") ต้องเท่ากับ region (env ไม่ตั้ง) เป๊ะทุก field (ได้ ${JSON.stringify(r12.region)} vs ${JSON.stringify(rUnset.region)})`);
  assert.deepEqual(r16.region, rUnset.region, `region (env="1.6") ต้องเท่ากับ region (env ไม่ตั้ง) เป๊ะทุก field — strict ต้องไม่ขึ้นกับ env เด็ดขาด (ได้ ${JSON.stringify(r16.region)} vs ${JSON.stringify(rUnset.region)})`);
  assert.equal(r12.upscaleRaw, rUnset.upscaleRaw);
  assert.equal(r16.upscaleRaw, rUnset.upscaleRaw);
  assert.ok(rUnset.upscaleRaw <= 1.2 + 1e-6, `upscale ยังคง ≤1.2 (ได้ ${rUnset.upscaleRaw})`);
});

await test('control: strict=true vs strict=false บน fixture เดียวกัน — region/upscale ต้องต่างกันจริง (ไม่ใช่ no-op ทั้งคู่เท่ากันโดยบังเอิญ)', async () => {
  const strictT = await runExec({ ...IMG, fb: FB, strict: true });
  const nonStrictT = await runExec({ ...IMG, fb: FB, strict: false });
  assert.ok(nonStrictT.upscaleRaw > strictT.upscaleRaw + 1e-6, `non-strict ต้องยืดได้มากกว่า strict จริง (strict=${strictT.upscaleRaw} non-strict=${nonStrictT.upscaleRaw})`);
});

// ═══════════════════ (4) MEGA_TIER2_OFF=1 → ด่านปลายน้ำกลับ 1.2 ทั้งหมด แม้ไม่ strict ═══════════════════

await test('executeCover (ไม่ strict, MEGA_TIER2_OFF=1): เพดาน eff กลับ 1.2 ตรงๆ ทันที — เหมือนปิดทั้งชุด TIER2', async () => {
  process.env.MEGA_TIER2_OFF = '1';
  const t = await runExec({ ...IMG, fb: FB, strict: false });
  delete process.env.MEGA_TIER2_OFF;
  assert.ok(t.upscaleRaw <= 1.2 + 1e-6, `MEGA_TIER2_OFF=1 ต้องกลับ 1.2 แม้ไม่ strict (ได้ ${t.upscaleRaw})`);
});

await test('executeCover (ไม่ strict, MEGA_TIER2_OFF=1 + MEGA_HERO_UPSCALE_MAX="1.6" ตั้งสวนทางไว้): TIER2_OFF ต้องชนะเสมอ ยัง 1.2', async () => {
  process.env.MEGA_TIER2_OFF = '1';
  process.env.MEGA_HERO_UPSCALE_MAX = '1.6';
  const t = await runExec({ ...IMG, fb: FB, strict: false });
  delete process.env.MEGA_TIER2_OFF;
  delete process.env.MEGA_HERO_UPSCALE_MAX;
  assert.ok(t.upscaleRaw <= 1.2 + 1e-6, `สวิตช์แม่ต้องชนะ env อื่นเสมอ (ได้ ${t.upscaleRaw})`);
});

console.log(`\n# hero-crop-alignment: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
