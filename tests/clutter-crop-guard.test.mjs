// ============================================================
// 🧪 MEGA_CLUTTER_GUARD (มือ D, 19 ก.ค.) — render-layer "ช่องย่อยต้องสะอาด ไม่ลายตา"
// ------------------------------------------------------------
// Runs the REAL exported executeCover (only `sharp` is stubbed — pixels only; every geometry / branch-selection /
// guard runs for real). Proves the 4 renderer-visible behaviours of the clutter guard + the kill-switch:
//   kill-switch: env MEGA_CLUTTER_GUARD — **default ON** (!== '0'); '0' = OFF (same polarity as the hero guards).
//   (a) OFF ⇒ byte-parity: the busy/eyeCategory signals are IGNORED (same branch, same region, no cleanNeedsBackup)
//   (b) ON + busy>=2 / eyeCategory==='group' ⇒ crowd-trigger: a close pair that used to go group-all is cropped
//       to the single largest face (branch spread-cut-largest) instead
//   (c) ON + the final crop is still cluttered (>=3 real face centres in the region) ⇒ cleanNeedsBackup flag raised
//       for the composer to swap in a cleaner backup (also proven via the eyeClean===false / busy>=2 triggers)
//   (d) ON + circle with busy>=2 (or a no-face square) ⇒ cleanNeedsBackup on the circle tile
//   (+) ON + a cluttered story/context slot ⇒ dropped from "keep everyone wide" to a single dominant-face crop
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
// sharp stub: chainable, no real pixels — identical harness to tests/hero-crop-guard.test.mjs.
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

// slot presets ---------------------------------------------------------------
// secondary/reaction: area 552*445 = 245,640 < 520*800 → _promKind='secondary' (non-hero, non-story)
const SEC_SLOT = { id: 'top_right', x: 616, y: 0, w: 552, h: 445, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
// story/context: id matches /^context/ → _promKind='context', isStorySlot=true
const CTX_SLOT = { id: 'context_1', x: 0, y: 0, w: 600, h: 800, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const CIRCLE_SLOT = { id: 'circle', shape: 'circle', x: 40, y: 900, w: 360, h: 360, zIndex: 3, border: '#FFFFFF', borderWidth: 8 };

const mkFb = (faces, extra = {}) => ({
  x1: faces[0].x1, y1: faces[0].y1, x2: faces[0].x2, y2: faces[0].y2, // largest = faces[0]
  imgW: 1, imgH: 1, count: faces.length, allFaces: faces.map((f) => ({ ...f })), ...extra,
});

const run = async ({ metaW = 1600, metaH = 2000, slot, fb, crop = null }) => {
  globalThis.__SHARP_META = { width: metaW, height: metaH };
  const traceSink = [];
  await executeCover({
    assignments: [{ slotId: slot.id, imageIndex: 0, crop }],
    imageBuffers: [{ buffer: Buffer.alloc(9001, 3) }],
    templateSpec: { id: 't', canvasW: 1080, canvasH: 1350, feather: 0, slots: [slot] },
    faceBoxes: [fb], traceSink,
  });
  globalThis.__SHARP_META = undefined;
  return traceSink.find((t) => t.slot === slot.id) || null;
};
const withGuard = async (val, fn) => {
  const prev = process.env.MEGA_CLUTTER_GUARD;
  if (val === undefined) delete process.env.MEGA_CLUTTER_GUARD; else process.env.MEGA_CLUTTER_GUARD = val;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.MEGA_CLUTTER_GUARD; else process.env.MEGA_CLUTTER_GUARD = prev;
  }
};

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

// a close pair (spread = 0.60-0.30 = 0.30 < 0.55) ⇒ OFF path = group-all, clutter path = spread-cut-largest
const closePair = () => [
  { x1: 0.30, y1: 0.30, x2: 0.46, y2: 0.58 }, // largest
  { x1: 0.48, y1: 0.32, x2: 0.60, y2: 0.56 },
];

// ── (a) OFF byte-parity: busy=2 is ignored when the guard is off ──
await test('(a) OFF ⇒ busy>=2 is IGNORED — same branch + same region as a neutral fb, and no cleanNeedsBackup (byte-parity)', async () => {
  const base = await withGuard(undefined, () => run({ slot: SEC_SLOT, fb: mkFb(closePair()) }));
  const busy = await withGuard('0', () => run({ slot: SEC_SLOT, fb: mkFb(closePair(), { busy: 2, eyeCategory: 'group', eyeClean: false }) }));
  assert.ok(base && busy, 'both traces produced');
  assert.ok(base.branch.startsWith('group-all'), `neutral OFF stays on the close-pair group path (got ${base.branch})`);
  assert.strictEqual(busy.branch, base.branch, 'branch identical whether or not the clutter signals are present (guard off)');
  assert.deepEqual(busy.region, base.region, 'region identical (busy/eyeCategory/eyeClean have zero effect when off)');
  assert.strictEqual(busy.cleanNeedsBackup, undefined, 'no cleanNeedsBackup flag when the guard is off');
  assert.strictEqual(base.cleanNeedsBackup, undefined, 'no cleanNeedsBackup flag on the neutral baseline either');
});

// ── (b) ON crowd-trigger: busy>=2 and eyeCategory==='group' each flip a close pair to single-largest ──
await test('(b) ON + busy>=2 ⇒ crowd-trigger crops the single largest face (spread-cut-largest) instead of keeping the close pair (group-all)', async () => {
  const off = await withGuard('0', () => run({ slot: SEC_SLOT, fb: mkFb(closePair(), { busy: 2 }) }));
  const on = await withGuard('1', () => run({ slot: SEC_SLOT, fb: mkFb(closePair(), { busy: 2 }) }));
  assert.ok(off.branch.startsWith('group-all'), `OFF keeps the whole close pair (got ${off.branch})`);
  assert.ok(on.branch.startsWith('spread-cut-largest'), `ON drops to the single-largest crop (got ${on.branch})`);
  assert.notDeepEqual(on.region, off.region, 'the ON region genuinely differs — not a no-op');
});
await test('(b2) ON + eyeCategory==="group" (no busy field at all) ⇒ same crowd-trigger to single-largest', async () => {
  const on = await withGuard('1', () => run({ slot: SEC_SLOT, fb: mkFb(closePair(), { eyeCategory: 'group' }) }));
  assert.ok(on.branch.startsWith('spread-cut-largest'), `eyeCategory=group alone triggers the single-largest crop (got ${on.branch})`);
});

// ── (c) ON cleanNeedsBackup: >=3 faces still in the final region ──
// 3 clustered faces (allFaces.length=3 <4, no busy/group ⇒ _isClutter is FALSE) on a story slot ⇒ storyGroupRegion
// keeps all three ⇒ the re-measure at the end counts 3 ⇒ flag raised. This isolates the ">=3 faces" trigger.
const trio = () => [
  { x1: 0.34, y1: 0.40, x2: 0.46, y2: 0.56 },
  { x1: 0.48, y1: 0.40, x2: 0.60, y2: 0.56 },
  { x1: 0.41, y1: 0.57, x2: 0.53, y2: 0.72 },
];
await test('(c) ON + crop still holds >=3 real face centres ⇒ cleanNeedsBackup=true (composer will swap a cleaner backup)', async () => {
  const on = await withGuard('1', () => run({ slot: CTX_SLOT, fb: mkFb(trio()) }));
  const off = await withGuard('0', () => run({ slot: CTX_SLOT, fb: mkFb(trio()) }));
  assert.strictEqual(on.cleanNeedsBackup, true, `>=3 faces in the final region raises the flag (branch ${on.branch})`);
  assert.strictEqual(off.cleanNeedsBackup, undefined, 'OFF never raises the flag for the same image (byte-parity)');
});
await test('(c2) ON + eyeClean===false (Gemini says the image is not clean) ⇒ cleanNeedsBackup=true even with a single tidy face', async () => {
  const oneFace = mkFb([{ x1: 0.42, y1: 0.30, x2: 0.56, y2: 0.55 }], { count: 1, eyeClean: false });
  const on = await withGuard('1', () => run({ slot: SEC_SLOT, fb: oneFace }));
  const off = await withGuard('0', () => run({ slot: SEC_SLOT, fb: mkFb([{ x1: 0.42, y1: 0.30, x2: 0.56, y2: 0.55 }], { count: 1, eyeClean: false }) }));
  assert.strictEqual(on.cleanNeedsBackup, true, 'eyeClean===false raises the flag');
  assert.strictEqual(off.cleanNeedsBackup, undefined, 'OFF ignores eyeClean');
});

// ── (d) ON circle: busy>=2 and no-face-square each flag the circle tile ──
await test('(d) ON + circle with busy>=2 ⇒ cleanNeedsBackup on the circle tile (OFF ⇒ no flag)', async () => {
  const on = await withGuard('1', () => run({ slot: CIRCLE_SLOT, fb: mkFb([{ x1: 0.40, y1: 0.28, x2: 0.58, y2: 0.56 }], { count: 1, busy: 2 }) }));
  const off = await withGuard('0', () => run({ slot: CIRCLE_SLOT, fb: mkFb([{ x1: 0.40, y1: 0.28, x2: 0.58, y2: 0.56 }], { count: 1, busy: 2 }) }));
  assert.strictEqual(on.cleanNeedsBackup, true, 'circle busy>=2 raises the flag');
  assert.strictEqual(off.cleanNeedsBackup, undefined, 'OFF circle raises nothing');
});
await test('(d2) ON + circle no-face-square (documents / no detected face) ⇒ cleanNeedsBackup on the circle tile', async () => {
  const on = await withGuard('1', () => run({ slot: CIRCLE_SLOT, fb: null, crop: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 } }));
  const off = await withGuard('0', () => run({ slot: CIRCLE_SLOT, fb: null, crop: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 } }));
  assert.strictEqual(on.branch, 'noface-square', `circle with no face lands on noface-square (got ${on.branch})`);
  assert.strictEqual(on.cleanNeedsBackup, true, 'no-face-square circle raises the flag');
  assert.strictEqual(off.cleanNeedsBackup, undefined, 'OFF raises nothing');
});

// ── (+) story/context clutter → single dominant crop instead of keeping everyone wide ──
await test('(+) ON + cluttered story slot (4 real faces ⇒ _isClutter) ⇒ branch drops from story-group to story-clutter-largest', async () => {
  const quad = () => [
    { x1: 0.10, y1: 0.35, x2: 0.24, y2: 0.58 }, // largest
    { x1: 0.30, y1: 0.37, x2: 0.42, y2: 0.57 },
    { x1: 0.55, y1: 0.36, x2: 0.67, y2: 0.56 },
    { x1: 0.78, y1: 0.38, x2: 0.90, y2: 0.58 },
  ];
  const off = await withGuard('0', () => run({ slot: CTX_SLOT, fb: mkFb(quad()) }));
  const on = await withGuard('1', () => run({ slot: CTX_SLOT, fb: mkFb(quad()) }));
  assert.ok(off.branch.startsWith('story-group'), `OFF keeps everyone wide (got ${off.branch})`);
  assert.ok(on.branch.startsWith('story-clutter-largest'), `ON crops to the single dominant face (got ${on.branch})`);
});

console.log(`\n# clutter-crop-guard: ${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
