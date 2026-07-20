// ============================================================
// 🧪 MEGA_FACE_FORWARD (20 ก.ค.) — "คนต้องเด่น หน้าใหญ่" ในช่อง context/story (ถอดจากปกตัวอย่างมืออาชีพ)
// ------------------------------------------------------------
// รัน executeCover จริง (stub เฉพาะ sharp). พิสูจน์: ช่อง context ที่ภาพหน้าเล็ก →
//   OFF (STORY_CROP minFaceHFrac 0.16) = หน้าจิ๋ว region หลวม (พื้นหลังกินเฟรม)
//   ON  (STORY_CROP_FORWARD minFaceHFrac 0.30) = หน้าใหญ่ขึ้น region แคบลง (คนเด่น)
//   ยึด faceBox (เชื่อได้) ไม่พึ่ง peopleBox → กัน COMPOSE_FACE_PROMINENCE (peopleBox) รบกวน = ปิดที่ '0'
//   kill-switch MEGA_FACE_FORWARD='1' (default OFF = STORY_CROP เดิมเป๊ะ)
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

process.env.MEGA_CLUTTER_GUARD = '0';        // isolate
process.env.COMPOSE_FACE_PROMINENCE = '0';   // isolate: ปิด peopleBox-zoom ให้เหลือแค่ STORY_CROP vs FORWARD

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const SHARP_STUB = MOD(`
export default function sharp(input){
  const meta = globalThis.__SHARP_META || { width: 1600, height: 2000 };
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

const { executeCover } = await import('../src/lib/services/coverExecutorService.js');

// context/story slot: id ขึ้นต้น context → isStorySlot=true → _promKind='context' → ใช้ STORY_CROP
const CTX_SLOT = { id: 'context_1', x: 0, y: 0, w: 600, h: 800, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
// faceBox หน้า "เล็ก" (สูง ~0.10 ของภาพ) — STORY(min0.16) vs FORWARD(min0.30) จะต่างกันชัด
const smallFaceFb = () => ({ x1: 0.42, y1: 0.30, x2: 0.54, y2: 0.40, count: 1, imgW: 1, imgH: 1, allFaces: [{ x1: 0.42, y1: 0.30, x2: 0.54, y2: 0.40 }] });

const run = async ({ slot, fb }) => {
  globalThis.__SHARP_META = { width: 1600, height: 2000 };
  const traceSink = [];
  await executeCover({
    assignments: [{ slotId: slot.id, imageIndex: 0, crop: null }],
    imageBuffers: [{ buffer: Buffer.alloc(9001, 3) }],
    templateSpec: { id: 't', canvasW: 1080, canvasH: 1350, feather: 0, slots: [slot] },
    faceBoxes: [fb], traceSink,
  });
  globalThis.__SHARP_META = undefined;
  return traceSink.find((t) => t.slot === slot.id) || null;
};
const withFwd = async (val, fn) => {
  const prev = process.env.MEGA_FACE_FORWARD;
  if (val === undefined) delete process.env.MEGA_FACE_FORWARD; else process.env.MEGA_FACE_FORWARD = val;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.MEGA_FACE_FORWARD; else process.env.MEGA_FACE_FORWARD = prev; }
};

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

const faceShare = (t) => t && t.region ? ((0.10 * 2000) / t.region.height) : null; // faceH(px)/regionH(px) โดยประมาณ

await test('(a) OFF ("0")/unset = STORY_CROP เดิม (byte-parity): region เหมือนกันทั้ง unset และ "0"', async () => {
  const off  = await withFwd('0', () => run({ slot: CTX_SLOT, fb: smallFaceFb() }));
  const def  = await withFwd(undefined, () => run({ slot: CTX_SLOT, fb: smallFaceFb() }));
  assert.ok(off && def && off.region, 'traces produced');
  assert.deepEqual(off.region, def.region, 'unset = "0" (default OFF) byte-parity');
});

await test('(b) ON ("1") ⇒ ช่อง context หน้าใหญ่ขึ้น (region แคบลง = หน้ากิน %เฟรมมากกว่า OFF)', async () => {
  const off = await withFwd('0', () => run({ slot: CTX_SLOT, fb: smallFaceFb() }));
  const on  = await withFwd('1', () => run({ slot: CTX_SLOT, fb: smallFaceFb() }));
  console.log(`   DEBUG OFF: branch=${off?.branch} region=${JSON.stringify(off?.region)}`);
  console.log(`   DEBUG ON : branch=${on?.branch} region=${JSON.stringify(on?.region)}`);
  assert.ok(on.region && off.region, 'regions produced');
  assert.ok(on.region.height < off.region.height, `ON region เตี้ยกว่า (ซูมเข้า) — ON h=${on.region.height} < OFF h=${off.region.height}`);
  const sOn = faceShare(on), sOff = faceShare(off);
  console.log(`   หน้ากิน: OFF ${(sOff*100).toFixed(0)}% → ON ${(sOn*100).toFixed(0)}% ของช่อง (ใหญ่ขึ้น ${((sOn/sOff-1)*100).toFixed(0)}%)`);
  assert.ok(sOn > sOff, 'ON หน้าใหญ่กว่า OFF');
});

await test('(c) ON ไม่แตะช่อง reaction/secondary (MOMENT_CROP เดิม)', async () => {
  const SEC = { id: 'top_right', x: 616, y: 0, w: 552, h: 445, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
  const off = await withFwd('0', () => run({ slot: SEC, fb: smallFaceFb() }));
  const on  = await withFwd('1', () => run({ slot: SEC, fb: smallFaceFb() }));
  assert.deepEqual(on.region, off.region, 'secondary (MOMENT_CROP) ไม่ถูกแตะเมื่อ FACE_FORWARD on');
});

console.log(`\n# face-forward: ${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
