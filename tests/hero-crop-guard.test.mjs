// ============================================================
// 🧪 HERO_CROP_GUARD (19 ก.ค.) — render-layer safety net for the "hero shows two people / stretches past 1.2× /
// clips the subject" bug traced to coverExecutorService's group-hero-largest branch + the hero prominence-tighten
// ceiling + the un-capped upscale measurement. Runs the REAL exported executeCover (only `sharp` is stubbed — pixels
// only; every geometry/branch-selection/guard runs for real) plus a direct unit test of the exported
// `_tightenForProminence` (point 4 — its effect can be masked by point 3's stretch-cap when going through the full
// pipeline with a large image, so it is proven in isolation here, as the task note suggests for hard-to-isolate
// pure calculations).
//
// Covers the guard's 3 renderer-visible fixes + the kill-switch (MEGA_HERO_CROP_GUARD, default ON, '0' = byte-parity):
//   1) slot._heroFaceCrop present ⇒ used directly, bypassing group-hero-largest entirely
//   2) group-hero-largest shift-only "can't escape a close neighbor" ⇒ shrink+guard (resolveHeroNeighborOverlap)
//   3) hero upscale > 1.2 ⇒ expand region toward the image edges (expandHeroRegionForStretchCap) — already covered
//      end-to-end by tests/ac0107-executor-geometry.test.mjs; not re-proven here
//   4) _tightenForProminence hero ceiling: HERO_STRETCH_MAX(1.2) instead of FACE_PROM_CEILING(1.6)
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
// sharp stub: chainable, no real pixels — identical to tests/ac0107-executor-geometry.test.mjs's harness.
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

const { executeCover, _tightenForProminence } = await import('../src/lib/services/coverExecutorService.js');

const HERO_SLOT = { id: 'main', x: 0, y: 0, w: 594, h: 1350, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const mkTemplate = (slotOverrides = {}) => ({ id: 'geo', canvasW: 1080, canvasH: 1350, feather: 0, slots: [{ ...HERO_SLOT, ...slotOverrides }] });
const runExec = async ({ metaW, metaH, fb, slotOverrides }) => {
  globalThis.__SHARP_META = { width: metaW, height: metaH };
  const traceSink = [];
  await executeCover({
    assignments: [{ slotId: 'main', imageIndex: 0, crop: null }],
    imageBuffers: [{ buffer: Buffer.alloc(9001, 3) }],
    templateSpec: mkTemplate(slotOverrides), faceBoxes: [fb], traceSink,
  });
  globalThis.__SHARP_META = undefined;
  return traceSink.find((t) => t.slot === 'main') || null;
};
const groupFaces = (largest, second) => ({ x1: largest.x1, y1: largest.y1, x2: largest.x2, y2: largest.y2, count: 2, allFaces: [largest, second] });

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

await test('1) slot._heroFaceCrop present ⇒ used directly (branch=hero-face-crop-explicit), bypassing group-hero-largest even though the image has 2 faces', async () => {
  const largest = { x1: 0.30, y1: 0.25, x2: 0.50, y2: 0.55 };
  const second = { x1: 0.55, y1: 0.30, x2: 0.68, y2: 0.55 };
  const t = await runExec({ metaW: 1600, metaH: 2000, fb: groupFaces(largest, second), slotOverrides: { _heroFaceCrop: { x: 0.20, y: 0.10, w: 0.35, h: 0.70 } } });
  assert.ok(t, 'hero trace produced');
  assert.strictEqual(t.branch, 'hero-face-crop-explicit', `branch is the explicit-crop path (got ${t.branch})`);
});

await test('1b) kill-switch OFF (MEGA_HERO_CROP_GUARD=0) ⇒ slot._heroFaceCrop is IGNORED — falls back to group-hero-largest (byte-parity with the pre-guard renderer)', async () => {
  const largest = { x1: 0.30, y1: 0.25, x2: 0.50, y2: 0.55 };
  const second = { x1: 0.55, y1: 0.30, x2: 0.68, y2: 0.55 };
  process.env.MEGA_HERO_CROP_GUARD = '0';
  const t = await runExec({ metaW: 1600, metaH: 2000, fb: groupFaces(largest, second), slotOverrides: { _heroFaceCrop: { x: 0.20, y: 0.10, w: 0.35, h: 0.70 } } });
  delete process.env.MEGA_HERO_CROP_GUARD;
  assert.ok(t.branch.startsWith('group-hero-largest'), `branch falls back to the old path (got ${t.branch})`);
});

await test('2) two faces standing close together (the reported bug shape — largest near the left edge, a second face close enough that the shift-only clamp cannot escape it): guard ON resolves it — shrinks past the neighbor AND caps the stretch, ending with a clean, non-overlapping, ≤1.2× region', async () => {
  const largest = { x1: 0.08, y1: 0.25, x2: 0.22, y2: 0.50 };
  const second = { x1: 0.30, y1: 0.27, x2: 0.42, y2: 0.48 };
  const t = await runExec({ metaW: 1200, metaH: 2727, fb: groupFaces(largest, second) });
  assert.ok(t, 'hero trace produced');
  assert.strictEqual(t.branch, 'group-hero-largest+shrink+stretchcap', `both guard steps engaged (got ${t.branch})`);
  assert.deepEqual(t.region, { left: 0, top: 265, width: 360, height: 818 });
  const imgW = 1200;
  const fL = second.x1 * imgW, fR = second.x2 * imgW;
  assert.ok(!(fR > t.region.left && fL < t.region.left + t.region.width), 'the second face is fully outside the final region');
  assert.ok(t.upscaleRaw <= 1.2 + 1e-6, `stretch stays within the hard cap (got ${t.upscaleRaw})`);
});

await test('2b) kill-switch OFF ⇒ the SAME close pair reproduces the historical shift-only bug byte-for-byte: the second face is STILL inside the final region (a materially different, wider/taller, overlapping region) — proves guard ON above genuinely fixed something real, not a no-op', async () => {
  const largest = { x1: 0.08, y1: 0.25, x2: 0.22, y2: 0.50 };
  const second = { x1: 0.30, y1: 0.27, x2: 0.42, y2: 0.48 };
  process.env.MEGA_HERO_CROP_GUARD = '0';
  const t = await runExec({ metaW: 1200, metaH: 2727, fb: groupFaces(largest, second) });
  delete process.env.MEGA_HERO_CROP_GUARD;
  assert.strictEqual(t.branch, 'group-hero-largest', 'branch never gets the +shrink/+stretchcap suffixes when the guard is off');
  assert.deepEqual(t.region, { left: 0, top: 265, width: 637, height: 1447 });
  const imgW = 1200;
  const fL = second.x1 * imgW, fR = second.x2 * imgW;
  assert.ok(fR > t.region.left && fL < t.region.left + t.region.width, `reproduces the historical bug: the second face is STILL inside the final region (region=${JSON.stringify(t.region)}, secondFace px=[${fL},${fR}])`);
});

await test('2c) a genuinely unresolvable overlap (the neighbor is too close for the safe-zone to hold even the largest face\'s own head box): guard ON gives up rather than cutting the head, and flags heroCropNeedsBackup instead of silently shipping the overlap', async () => {
  const largest = { x1: 0.30, y1: 0.25, x2: 0.55, y2: 0.58 };
  const second = { x1: 0.48, y1: 0.27, x2: 0.68, y2: 0.55 };
  const t = await runExec({ metaW: 1600, metaH: 3273, fb: groupFaces(largest, second) });
  assert.strictEqual(t.branch, 'group-hero-largest', 'shrink could not engage (would have clipped the largest face\'s own head) — branch stays plain');
  assert.strictEqual(t.heroCropNeedsBackup, true, 'flags the composer instead of silently shipping the still-overlapping crop');

  process.env.MEGA_HERO_CROP_GUARD = '0';
  const off = await runExec({ metaW: 1600, metaH: 3273, fb: groupFaces(largest, second) });
  delete process.env.MEGA_HERO_CROP_GUARD;
  assert.strictEqual(off.heroCropNeedsBackup, undefined, 'kill-switch OFF never raises the flag — the same defect ships with no signal at all (the historical behavior)');
  assert.deepEqual(off.region, t.region, 'the region itself is identical either way here (nothing COULD be resolved) — the flag is the only difference the guard makes in this case');
});

// ── point 4: _tightenForProminence hero ceiling (HERO_STRETCH_MAX vs FACE_PROM_CEILING) — direct unit test ──
// Full-pipeline testing of this one-line change is unreliable: point 3 (stretch-cap after upscale measurement) can
// mask the difference by re-expanding whatever region tighten produced. Testing the exported pure function directly
// isolates exactly this ceiling decision, hand-derived below (see tests/hero-crop-geometry.test.mjs for the sibling
// pure-geometry helpers).
await test('4) _tightenForProminence: kind=hero floors the tightened region at slot.h/HERO_STRETCH_MAX(1.2) under the guard, vs slot.h/FACE_PROM_CEILING(1.6) with the kill-switch off — a real, hand-derived numeric difference (1000px vs 750px)', async () => {
  const slot = { id: 'main', w: 600, h: 1200 }; // aspect 0.5, hero kind (id==='main')
  const fb = { x1: 0.48, y1: 0.48, x2: 0.52, y2: 0.50, count: 1 }; // tiny centred face ⇒ curShare well under trigger
  const region = { left: 400, top: 300, width: 1000, height: 1300 };
  const imgW = 2000, imgH = 2000;

  const onResult = _tightenForProminence(region, fb, slot, imgW, imgH);
  assert.ok(onResult && onResult.meta.tightened, 'guard ON: tightening engages');
  assert.strictEqual(onResult.region.height, 1000, `guard ON floors at slot.h/1.2=1000 (got ${onResult.region.height})`);

  process.env.MEGA_HERO_CROP_GUARD = '0';
  const offResult = _tightenForProminence(region, fb, slot, imgW, imgH);
  delete process.env.MEGA_HERO_CROP_GUARD;
  assert.ok(offResult && offResult.meta.tightened, 'guard OFF: tightening still engages (this call path itself is not disabled by the switch)');
  assert.strictEqual(offResult.region.height, 750, `guard OFF floors at the old slot.h/1.6=750 (got ${offResult.region.height}) — byte-parity with the pre-guard renderer`);
});

await test('4b) _tightenForProminence: non-hero kinds (secondary/context/circle) are unaffected by the switch — the 1.6 ceiling is untouched either way', async () => {
  const slot = { id: 'reaction_1', w: 400, h: 500 }; // small ⇒ secondary kind
  const fb = { x1: 0.46, y1: 0.46, x2: 0.54, y2: 0.50, count: 1 };
  const region = { left: 100, top: 100, width: 350, height: 480 };
  const imgW = 1000, imgH = 1000;
  const onResult = _tightenForProminence(region, fb, slot, imgW, imgH);
  process.env.MEGA_HERO_CROP_GUARD = '0';
  const offResult = _tightenForProminence(region, fb, slot, imgW, imgH);
  delete process.env.MEGA_HERO_CROP_GUARD;
  assert.deepEqual(onResult, offResult, 'identical result regardless of the hero-only switch (secondary kind never reads it)');
});

console.log(`\n# hero-crop-guard: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
