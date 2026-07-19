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

// ★ HERO_CROP_GUARD (19 ก.ค.): these two tests used to prove the RENDERER itself produces an upscale >1.2 in
//   exactly the AC-0107-class scenario (small face in a large image / a stored-vs-decoded size mismatch) — i.e. the
//   strict-V2 gate's runtime-bound proof was the ONLY thing catching it, and non-strict (ref/grade-C) paths shipped it
//   uncaught. HERO_CROP_GUARD closes that gap AT THE RENDERER: when upscale > HERO_STRETCH_MAX(1.2) it now expands the
//   hero region toward the image edges (face-anchored, superset of the old region ⇒ the face can't fall out) and pulls
//   upscale back down to ≤1.2 whenever the image affords the room — which both scenarios below do (3000x3000 is huge;
//   the "trimmed" 900x1125 decode is tight but its whole-image cover-fit is exactly 1.2, so full-image extraction just
//   reaches the cap). So under the default (guard ON) these are now SAFE. The kill-switch (MEGA_HERO_CROP_GUARD=0)
//   must still reproduce the historical bug byte-for-byte — asserted below so the regression coverage isn't lost, only
//   relocated to the OFF path (proving it's this guard, and nothing else, that fixed the ON path).
await test('1) REAL small face in a large image: HERO_CROP_GUARD (default ON) expands the region toward the image edges and caps the real upscale at ≤1.2 (the image affords room); MEGA_HERO_CROP_GUARD=0 reproduces the historical AC-0107 bug byte-for-byte (upscaleRaw >1.2 while whole-image cover-fit ≤1.2)', async () => {
  const fb = singleFace(0.45, 0.45, 0.55, 0.55);
  const t = await runExec({ metaW: 3000, metaH: 3000, fb });
  assert.ok(t, 'hero trace produced');
  assert.strictEqual(typeof t.upscaleRaw, 'number', 'upscaleRaw is a number');
  assert.ok(coverFit(3000, 3000) <= 1.2, `whole-image cover-fit ≤1.2 (${coverFit(3000, 3000).toFixed(3)}) — coarse gate would have passed it`);
  assert.ok(t.upscaleRaw <= 1.2 + 1e-6, `HERO_CROP_GUARD (default ON) caps the real face-aware upscale at ≤1.2 when the image affords room to expand (got ${t.upscaleRaw})`);

  process.env.MEGA_HERO_CROP_GUARD = '0';
  const tOff = await runExec({ metaW: 3000, metaH: 3000, fb });
  delete process.env.MEGA_HERO_CROP_GUARD;
  assert.ok(tOff.upscaleRaw > 1.2, `kill-switch OFF reproduces the historical AC-0107 bug byte-for-byte (got ${tOff.upscaleRaw}) — proves the guard (not some unrelated change) is what fixed the ON path above`);
});

await test('2) DECODED-dimension sensitivity: HERO_CROP_GUARD keeps the SAME face safe (≤1.2) at both a large and a trimmed/smaller decoded size by expanding toward the image edges when room allows; MEGA_HERO_CROP_GUARD=0 reproduces the historical dimension-sensitive crossing byte-for-byte (safe large ⇒ unsafe trimmed — executor keys on decoded dims, not stored)', async () => {
  const fb = singleFace(0.40, 0.38, 0.60, 0.62); // moderate centred face
  const big = await runExec({ metaW: 2600, metaH: 3250, fb });
  const trimmed = await runExec({ metaW: 900, metaH: 1125, fb });
  assert.ok(big.upscaleRaw > 0 && trimmed.upscaleRaw > 0, 'both measured');
  assert.ok(big.upscaleRaw <= 1.2 + 1e-6, `large decoded dim stays safe (${big.upscaleRaw})`);
  assert.ok(trimmed.upscaleRaw <= 1.2 + 1e-6, `HERO_CROP_GUARD expands the trimmed decode toward the image edges (up to the whole image, whose cover-fit is exactly 1.2 here) and reaches the ≤1.2 cap (got ${trimmed.upscaleRaw})`);

  process.env.MEGA_HERO_CROP_GUARD = '0';
  const trimmedOff = await runExec({ metaW: 900, metaH: 1125, fb });
  delete process.env.MEGA_HERO_CROP_GUARD;
  assert.ok(trimmedOff.upscaleRaw > 1.2, `kill-switch OFF reproduces the historical stored-vs-decoded mismatch byte-for-byte (got ${trimmedOff.upscaleRaw}) — proves the underlying AC-0107 sensitivity is unchanged, only pre-emptively fixed when the guard is ON`);
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
