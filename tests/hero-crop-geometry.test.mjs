// ============================================================
// 🧪 heroCropGeometry.js — pure shared hero-crop upscale helper (offline, no IO)
// Boundary + edge + soundness coverage for the AC-0107 hero-crop estimator. Only the CONSTANTS are shared with the
// renderer (coverExecutorService imports them); the region math is a replicated conservative estimator used by the
// pre-carrier selection FILTER (megaAdapters) — the renderer does NOT call it, and it is never the authoritative proof
// (that is the runtime-bound check in composeAndVerify). Proves: 1.20 passes, >1.20 fails, the AC-0107
// 2.69-class fixture fails, and a horizontal-EDGE case the whole-image cover-fit (old coarse gate) MISSES is caught.
// ============================================================
import assert from 'node:assert/strict';
import { heroCropUpscale, isHeroCropSafe, heroCropRegion, HERO_STRETCH_MAX, HERO_CROP } from '../src/lib/heroCropGeometry.js';

let n = 0, failed = 0;
const test = (name, fn) => { n++; try { fn(); console.log(`ok ${n} - ${name}`); } catch (e) { failed++; console.log(`not ok ${n} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 3).join('\n  ')}`); } };

const SLOT = { slotW: 594, slotH: 1350 }; // representative realized hero slot (0.44 aspect)
const up = (faceBox, imgW, imgH) => heroCropUpscale({ faceBox, imgW, imgH, ...SLOT });
// whole-image cover-fit = the OLD coarse gate (max(slotW/imgW, slotH/imgH)) — what the coarse gate & the pre-fix estimate keyed on
const coverFit = (imgW, imgH) => Math.max(SLOT.slotW / imgW, SLOT.slotH / imgH);

test('constants match the renderer (HERO_CROP faceFrac/maxFaceHFrac/minFaceHFrac + 1.2 limit)', () => {
  assert.deepEqual({ f: HERO_CROP.faceFrac, mx: HERO_CROP.maxFaceHFrac, mn: HERO_CROP.minFaceHFrac }, { f: 0.88, mx: 0.74, mn: 0.60 });
  assert.strictEqual(HERO_STRETCH_MAX, 1.2);
});

test('HERO-OK (centred, big face, 1300×1200) ⇒ upscale ≈1.125 ≤ 1.2 ⇒ SAFE (must not over-reject the common case)', () => {
  const u = up({ x1: 0.35, y1: 0.20, x2: 0.65, y2: 0.55 }, 1300, 1200);
  assert.ok(u > 1.1 && u <= 1.2 + 1e-9, `expected ~1.125, got ${u}`);
  assert.strictEqual(isHeroCropSafe({ faceBox: { x1: 0.35, y1: 0.20, x2: 0.65, y2: 0.55 }, imgW: 1300, imgH: 1200, ...SLOT }), true);
});

test('AC-0107 SMALLFACE (big image, small centred face 0.18×0.18) ⇒ upscale >2× ⇒ UNSAFE, while whole-image cover-fit ≤1.2 (the exact coarse-gate blind spot)', () => {
  const fb = { x1: 0.41, y1: 0.41, x2: 0.59, y2: 0.59 };
  const u = up(fb, 1300, 1200);
  assert.ok(u > 2.0, `face-aware upscale >2 (got ${u})`);
  assert.ok(!isHeroCropSafe({ faceBox: fb, imgW: 1300, imgH: 1200, ...SLOT }), 'UNSAFE');
  assert.ok(coverFit(1300, 1200) <= 1.2 + 1e-9, `coarse cover-fit passes it (${coverFit(1300, 1200)}) — the blind spot`);
});

test('boundary: a face tuned to exactly 1.20× ⇒ SAFE; a marginally smaller face ⇒ >1.20 ⇒ UNSAFE', () => {
  // maxH clamp binds ⇒ upscale = slotH*minFaceHFrac / headHpx, headHpx=(fh*1.74)*imgH. Solve fh for upscale=1.20 @ imgH=1200:
  //   1.20 = 1350*0.60 / ((fh*1.74)*1200) ⇒ fh = 810 / (1.20*1.74*1200) = 0.32327...
  const IMGH = 1200;
  const fhFor = (target) => (SLOT.slotH * HERO_CROP.minFaceHFrac) / (target * 1.74 * IMGH); // face height for a given upscale
  const mk = (fh) => ({ x1: 0.30, y1: 0.34, x2: 0.70, y2: 0.34 + fh }); // wide face (0.40) so base > maxH ⇒ maxH binds; centred
  const atLimit = mk(fhFor(1.20));
  const uLimit = up(atLimit, 1300, IMGH);
  assert.ok(uLimit <= 1.2 + 1e-6, `at-limit face ⇒ ≤1.20 (got ${uLimit})`);
  assert.ok(isHeroCropSafe({ faceBox: atLimit, imgW: 1300, imgH: IMGH, ...SLOT }), 'at-limit ⇒ SAFE');
  const smaller = mk(fhFor(1.20) * 0.92); // ~8% smaller face ⇒ ~1.30× ⇒ over the limit
  const uOver = up(smaller, 1300, IMGH);
  assert.ok(uOver > 1.2 + 1e-6, `smaller face ⇒ >1.20 (got ${uOver})`);
  assert.ok(!isHeroCropSafe({ faceBox: smaller, imgW: 1300, imgH: IMGH, ...SLOT }), 'over-limit ⇒ UNSAFE');
});

test('horizontal position SOUNDNESS: the renderer off-centre zoom is modeled — moving a face toward the edge NEVER lowers the estimated upscale (never makes it look safer than centred); an off-centre small face the coarse gate MISSES is still UNSAFE', () => {
  // big image ⇒ whole-image cover-fit tiny (coarse gate would accept anything); small face off to the RIGHT side.
  const IMGW = 2400, IMGH = 1500;
  const centred = { x1: 0.42, y1: 0.42, x2: 0.58, y2: 0.58 }; // small centred face
  const offside = { x1: 0.74, y1: 0.42, x2: 0.90, y2: 0.58 }; // SAME size, pushed to the right side
  const uCentred = up(centred, IMGW, IMGH);
  const uOff = up(offside, IMGW, IMGH);
  assert.ok(coverFit(IMGW, IMGH) <= 1.2 + 1e-9, `coarse cover-fit passes (${coverFit(IMGW, IMGH).toFixed(3)}) — coarse gate is blind to face size AND position`);
  assert.ok(uOff >= uCentred - 1e-9, `off-centre is never estimated SAFER than centred (${uOff.toFixed(3)} >= ${uCentred.toFixed(3)}) — the renderer's off-centre zoom is modeled`);
  assert.ok(uOff > 1.2 && !isHeroCropSafe({ faceBox: offside, imgW: IMGW, imgH: IMGH, ...SLOT }), `off-centre small face ⇒ UNSAFE (${uOff.toFixed(3)}), a case the whole-image cover-fit misses`);
});

test('fail-closed: missing/invalid faceBox or non-positive dims ⇒ null (never a "safe" verdict)', () => {
  assert.strictEqual(heroCropUpscale({ faceBox: null, imgW: 1300, imgH: 1200, ...SLOT }), null);
  assert.strictEqual(heroCropUpscale({ faceBox: { x1: 0.5, y1: 0.5, x2: 0.4, y2: 0.6 }, imgW: 1300, imgH: 1200, ...SLOT }), null); // x2<x1
  assert.strictEqual(heroCropUpscale({ faceBox: { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 }, imgW: 0, imgH: 1200, ...SLOT }), null);
  assert.strictEqual(heroCropRegion({ faceBox: { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 }, imgW: 1300, imgH: 1200, slotW: 594, slotH: 0 }), null);
  assert.strictEqual(isHeroCropSafe({ faceBox: null, imgW: 1300, imgH: 1200, ...SLOT }), false, 'unknown ⇒ not safe');
});

test('shrink-transform fail-closed: a GEOMETRY-safe candidate flagged hasShrinkTransformRisk (watermark dodge / Final-Cropper may shrink the crop) ⇒ null / NOT safe — the geometry bound alone would be a false-pass after the renderer SHRINKS', () => {
  const fb = { x1: 0.35, y1: 0.20, x2: 0.65, y2: 0.55 }; // HERO-OK geometry (~1.125 without any dodge)
  assert.ok(up(fb, 1300, 1200) <= 1.2 + 1e-9, 'geometry alone is safe (would false-pass if we ignored the dodge)');
  assert.strictEqual(heroCropUpscale({ faceBox: fb, imgW: 1300, imgH: 1200, ...SLOT, hasShrinkTransformRisk: true }), null, 'shrink-risk ⇒ null (cannot bound)');
  assert.strictEqual(isHeroCropSafe({ faceBox: fb, imgW: 1300, imgH: 1200, ...SLOT, hasShrinkTransformRisk: true }), false, 'shrink-risk ⇒ NOT safe (fail-closed)');
});

console.log(`\n# hero-crop-geometry: ${n - failed}/${n} passed`);
console.log(`1..${n}`);
if (failed) process.exitCode = 1;
