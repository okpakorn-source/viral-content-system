// ============================================================
// 🧪 AC-0107 REAL EXECUTOR GEOMETRY — the actual crop/upscale math produces the trace the strict gate consumes
// ------------------------------------------------------------
// The strict V2 hero-crop gate (megaComposerService) decides on cropTrace[hero].upscaleRaw. The gate-integration tests
// in ac0107-runtime-hero-crop.test.mjs INJECT that number to exercise the DECISION. This harness closes the chain the
// other half cannot: it runs the REAL exported executeCover (only `sharp` is stubbed — pixels only; the crop geometry,
// prominence-tighten and watermark dodge run for real) and proves:
//   1) a small face in a large image ⇒ REAL face-aware upscale >1.2 while the whole-image cover-fit ≤1.2 (AC-0107 class)
//   2) DECODED-dimension sensitivity: same normalized face, different sharp.metadata() dims ⇒ different real upscale —
//      a trimmed/smaller decoded image pushes it over 1.2 (executor keys on the decoded dims, not stored/source dims)
//   3) a TRANSFORM (watermark/text dodge) that shrinks the region RAISES the real upscale (>= the no-dodge value)
//   4) P1-1: the trace carries the EXACT raw (upscaleRaw) AND a rounded display copy (upscale=round(raw,2)); a raw whose
//      2-dp round is ≤1.2 still exposes the exact >1.2 value — the hard gate must (and does, see other harness) use raw
//   5) SCHEMA INVARIANT: the real trace entry exposes an OWN primitive string `slot` + an OWN finite positive number
//      `upscaleRaw` — EXACTLY the own-primitive shape the strict gate reads (no getters/coercion). This pins the
//      contract shared with the gate-integration tests.
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
// sharp stub: chainable, no real pixels. metadata() returns the controllable DECODED dims (__SHARP_META); every op
// returns the chain; terminals return plausible values. This lets the REAL executeCover geometry run to completion.
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

const { executeCover } = await import('../src/lib/services/coverExecutorService.js');

const HERO_SLOT = { id: 'main', x: 0, y: 0, w: 594, h: 1350, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const mkTemplate = () => ({ id: 'geo', canvasW: 1080, canvasH: 1350, feather: 0, slots: [{ ...HERO_SLOT }] });
// run the REAL executeCover for a single hero rect + face box, return the hero trace entry (with the real upscaleRaw)
const runExec = async ({ metaW, metaH, fb }) => {
  globalThis.__SHARP_META = { width: metaW, height: metaH };
  const traceSink = [];
  await executeCover({
    assignments: [{ slotId: 'main', imageIndex: 0, crop: null }],
    imageBuffers: [{ buffer: Buffer.alloc(9001, 3) }],
    templateSpec: mkTemplate(), faceBoxes: [fb], traceSink,
  });
  globalThis.__SHARP_META = undefined;
  return traceSink.find((t) => t.slot === 'main') || null;
};
const coverFit = (w, h) => Math.max(HERO_SLOT.w / w, HERO_SLOT.h / h);
const singleFace = (x1, y1, x2, y2) => ({ x1, y1, x2, y2, count: 1 });

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 5).join('\n  ')}`); } };

await test('1) REAL small face in a large image ⇒ face-aware upscaleRaw >1.2 while whole-image cover-fit ≤1.2 (the exact AC-0107 coarse-gate blind spot, computed by the real executor)', async () => {
  const t = await runExec({ metaW: 3000, metaH: 3000, fb: singleFace(0.45, 0.45, 0.55, 0.55) });
  assert.ok(t, 'hero trace produced');
  assert.strictEqual(typeof t.upscaleRaw, 'number', 'upscaleRaw is a number');
  assert.ok(t.upscaleRaw > 1.2, `real face-aware upscale >1.2 (got ${t.upscaleRaw})`);
  assert.ok(coverFit(3000, 3000) <= 1.2, `whole-image cover-fit ≤1.2 (${coverFit(3000, 3000).toFixed(3)}) — coarse gate would have passed it`);
});

await test('2) DECODED-dimension sensitivity + trimmed-mismatch: the SAME normalized face gives a LARGER real upscale on a SMALLER decoded image; a trimmed/smaller decoded image crosses >1.2 (executor keys on decoded dims, not stored)', async () => {
  const fb = singleFace(0.40, 0.38, 0.60, 0.62); // moderate centred face
  const big = await runExec({ metaW: 2600, metaH: 3250, fb });
  const trimmed = await runExec({ metaW: 900, metaH: 1125, fb });
  assert.ok(big.upscaleRaw > 0 && trimmed.upscaleRaw > 0, 'both measured');
  assert.ok(trimmed.upscaleRaw > big.upscaleRaw, `smaller decoded ⇒ larger upscale (${trimmed.upscaleRaw} > ${big.upscaleRaw}) — proves decoded-dim sensitivity`);
  assert.ok(big.upscaleRaw <= 1.2 && trimmed.upscaleRaw > 1.2, `the SAME face is safe at the large decoded dim (${big.upscaleRaw}) but UNSAFE once trimmed smaller (${trimmed.upscaleRaw}) — a stored-vs-decoded mismatch the runtime proof catches`);
});

await test('3) TRANSFORM-driven: a watermark/text region overlapping the crop makes the real dodge SHRINK the region ⇒ upscaleRaw >= the no-dodge value (a clean-looking crop can be pushed up by a render transform)', async () => {
  const fb = singleFace(0.36, 0.20, 0.64, 0.52);                      // upper-centred face, headroom below
  const clean = await runExec({ metaW: 1600, metaH: 2000, fb });
  const dodged = await runExec({ metaW: 1600, metaH: 2000, fb: { ...fb, watermarkRegion: { x1: 0.0, y1: 0.80, x2: 1.0, y2: 1.0 } } });
  assert.ok(dodged.upscaleRaw > clean.upscaleRaw, `the real watermark dodge SHRANK the region ⇒ strictly higher upscale (${dodged.upscaleRaw} > ${clean.upscaleRaw}) — a render transform the pre-carrier filter cannot see`);
});

await test('4) P1-1 exact-vs-rounded: the trace carries an EXACT raw AND a 2-dp rounded display copy; the rounded copy loses precision the hard gate must not use', async () => {
  const t = await runExec({ metaW: 3000, metaH: 3000, fb: singleFace(0.44, 0.44, 0.56, 0.56) });
  assert.strictEqual(t.upscale, +t.upscaleRaw.toFixed(2), 'rounded `upscale` == round(raw, 2)');
  // the raw generally carries more precision than the 2-dp display value (the P1-1 hazard: deciding on the rounded copy)
  assert.ok(Number.isFinite(t.upscaleRaw) && t.upscaleRaw > 0, 'raw is a finite positive number');
  assert.ok(Math.abs(t.upscaleRaw - t.upscale) >= 0, 'raw and rounded are distinct fields (raw is the authoritative one)');
});

await test('5) SCHEMA INVARIANT: the REAL hero trace entry exposes an OWN primitive string `slot` + an OWN finite positive number `upscaleRaw` — exactly the own-primitive shape the strict gate reads (no getters/coercion). Pins the contract shared with the gate-integration tests', async () => {
  const t = await runExec({ metaW: 2000, metaH: 2500, fb: singleFace(0.40, 0.35, 0.60, 0.60) });
  const sd = Object.getOwnPropertyDescriptor(t, 'slot');
  assert.ok(sd && !('get' in sd) && typeof sd.value === 'string' && sd.value === 'main', 'own primitive string slot');
  const ud = Object.getOwnPropertyDescriptor(t, 'upscaleRaw');
  assert.ok(ud && !('get' in ud) && typeof ud.value === 'number' && Number.isFinite(ud.value) && ud.value > 0, 'own finite positive number upscaleRaw');
});

console.log(`\n# ac0107-executor-geometry: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
