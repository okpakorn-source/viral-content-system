// ============================================================
// 🧪 heroCropGeometry.js — pure shared hero-crop upscale helper (offline, no IO)
// Boundary + edge + soundness coverage for the AC-0107 hero-crop estimator. Only the CONSTANTS are shared with the
// renderer (coverExecutorService imports them); the region math is a replicated conservative estimator used by the
// pre-carrier selection FILTER (megaAdapters) — the renderer does NOT call it, and it is never the authoritative proof
// (that is the runtime-bound check in composeAndVerify). Proves: 1.20 passes, >1.20 fails, the AC-0107
// 2.69-class fixture fails, and a horizontal-EDGE case the whole-image cover-fit (old coarse gate) MISSES is caught.
// ============================================================
import assert from 'node:assert/strict';
import {
  heroCropUpscale, isHeroCropSafe, heroCropRegion, HERO_STRETCH_MAX, HERO_CROP,
  resolveHeroNeighborOverlap, expandHeroRegionForStretchCap,
} from '../src/lib/heroCropGeometry.js';

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

// ============================================================
// ★ HERO_CROP_GUARD (19 ก.ค.) — resolveHeroNeighborOverlap + expandHeroRegionForStretchCap (PURE, hand-computed)
// ------------------------------------------------------------
// These are the two geometry helpers the renderer (coverExecutorService) calls to fix the "hero crop shows two
// people / stretches past 1.2× / clips the subject" render-layer bug. Both are pure (no IO/env/Date/random) so every
// expected number below is hand-derived from the function's own documented formula, not observed-then-pinned.
// ============================================================

test('resolveHeroNeighborOverlap: no overlap after the shift ⇒ region returned untouched (changed:false, needsBackup:false)', () => {
  const region = { left: 100, top: 0, width: 200, height: 400 };
  const largestFace = { x1: 0.30, y1: 0.20, x2: 0.45, y2: 0.55 };
  const otherFaces = [{ x1: 0.50, y1: 0.20, x2: 0.60, y2: 0.55 }]; // fL=500,fR=600 — clear of region [100,300] on a 1000px image
  const res = resolveHeroNeighborOverlap({ region, largestFace, otherFaces, slotW: 300, slotH: 700, imgW: 1000, imgH: 1000, rMin: 0, rMax: 1000 });
  assert.strictEqual(res.changed, false);
  assert.strictEqual(res.needsBackup, false);
  assert.deepEqual(res.region, region);
});

test('resolveHeroNeighborOverlap: still overlaps after the shift, but the safe-zone is wide enough to hold the region as-is ⇒ REPOSITIONS to clear the neighbor (changed:true, needsBackup:false) — this is exactly the shift-cancels-out bug the guard fixes', () => {
  // largest face centred at x=450px on a 1000px image; a clean, well-separated neighbor sits at [650,750]px (rMax=650)
  const largestFace = { x1: 0.40, y1: 0.30, x2: 0.50, y2: 0.55 }; // headL=380,headR=520 (±0.20*fw=±0.02)
  const otherFaces = [{ x1: 0.65, y1: 0.30, x2: 0.75, y2: 0.55 }];
  // region misplaced too far right (left=550..850) so it still overlaps the neighbor [650,750] even after the caller's shift
  const region = { left: 550, top: 100, width: 300, height: 500 };
  const res = resolveHeroNeighborOverlap({ region, largestFace, otherFaces, slotW: 300, slotH: 500, imgW: 1000, imgH: 1000, rMin: 0, rMax: 650 });
  assert.strictEqual(res.changed, true, 'must reposition (region as originally shifted still overlapped the neighbor)');
  assert.strictEqual(res.needsBackup, false, 'head fits AND the neighbor is now clear — no backup needed');
  assert.deepEqual(res.region, { left: 300, top: 100, width: 300, height: 500 }, 'centred on the largest face (lcx=450, width unchanged=300, top/height unchanged=100/500) and clamped inside the safe zone [0,650]');
  // verify the invariant directly: the neighbor box no longer intersects the returned region
  const [fL, fR] = [0.65 * 1000, 0.75 * 1000];
  assert.ok(!(fR > res.region.left && fL < res.region.left + res.region.width), 'neighbor fully clear of the final region');
});

test('resolveHeroNeighborOverlap: safe-zone narrower than the region but wide enough for the head ⇒ NARROWS the width to fit (changed:true, needsBackup:false)', () => {
  const largestFace = { x1: 0.40, y1: 0.30, x2: 0.50, y2: 0.55 }; // fw=0.10, headW=140px on a 1000px image (headL=380,headR=520)
  const otherFaces = [{ x1: 0.55, y1: 0.30, x2: 0.65, y2: 0.55 }]; // rMax = 0.55*1000 = 550
  const region = { left: 100, top: 50, width: 700, height: 700 }; // loose region (700px wide) overlapping the neighbor at [550,650]
  const res = resolveHeroNeighborOverlap({ region, largestFace, otherFaces, slotW: 550, slotH: 700, imgW: 1000, imgH: 1000, rMin: 0, rMax: 550 });
  assert.strictEqual(res.changed, true);
  assert.strictEqual(res.needsBackup, false);
  // hand-derived: nW=min(700,max(safeW=550,headW=140))=550; nl=round(450-275)=175 clamped to [0, 550-550=0] ⇒ 0; top unchanged (cut from bottom)
  assert.deepEqual(res.region, { left: 0, top: 50, width: 550, height: 700 });
  const headL = 380, headR = 520;
  assert.ok(headL >= res.region.left && headR <= res.region.left + res.region.width, 'largest-face head box still fully framed after narrowing');
});

test('resolveHeroNeighborOverlap: safe-zone narrower than the head itself ⇒ CANNOT resolve without cutting the head ⇒ gives up (region unchanged) and flags needsBackup:true', () => {
  const largestFace = { x1: 0.40, y1: 0.30, x2: 0.50, y2: 0.55 }; // headW=140px
  // a (deliberately extreme, synthetic) "other face" bbox whose LEFT edge sits at 50px ⇒ rMax=50 < headW(140) — no shift/shrink can fit the head
  const otherFaces = [{ x1: 0.05, y1: 0.30, x2: 0.90, y2: 0.55 }];
  const region = { left: 200, top: 50, width: 300, height: 500 }; // overlaps the (very wide) otherFace regardless of position
  const res = resolveHeroNeighborOverlap({ region, largestFace, otherFaces, slotW: 300, slotH: 500, imgW: 1000, imgH: 1000, rMin: 0, rMax: 50 });
  assert.strictEqual(res.changed, false, 'gives up rather than cutting the largest-face head box');
  assert.strictEqual(res.needsBackup, true, 'flags the composer to try a backup image / HOLD instead of shipping a still-overlapping or head-clipped hero');
  assert.deepEqual(res.region, region, 'region is the untouched input — never a half-broken shrink');
});

test('resolveHeroNeighborOverlap: fail-safe on malformed/missing inputs ⇒ never throws, always changed:false/needsBackup:false', () => {
  const region = { left: 0, top: 0, width: 100, height: 100 };
  assert.deepEqual(resolveHeroNeighborOverlap({}), { region: undefined, changed: false, needsBackup: false });
  assert.deepEqual(resolveHeroNeighborOverlap({ region, largestFace: null, otherFaces: [], slotW: 100, slotH: 100, imgW: 100, imgH: 100 }), { region, changed: false, needsBackup: false });
  assert.deepEqual(resolveHeroNeighborOverlap({ region, largestFace: { x1: 0, y1: 0, x2: 1, y2: 1 }, otherFaces: 'not-an-array', slotW: 100, slotH: 100, imgW: 100, imgH: 100 }), { region, changed: false, needsBackup: false });
});

test('expandHeroRegionForStretchCap: plenty of image margin ⇒ expands (face-anchored, superset of the old region) until upscale reaches the cap exactly', () => {
  const region = { left: 800, top: 600, width: 400, height: 800 }; // upscale pre-expand = max(600/400,1200/800) = 1.5
  const res = expandHeroRegionForStretchCap({ region, slotW: 600, slotH: 1200, imgW: 2000, imgH: 2000, cap: 1.2 });
  assert.strictEqual(res.changed, true);
  assert.deepEqual(res.region, { left: 750, top: 500, width: 500, height: 1000 });
  assert.ok(res.reached, `cap reached (upscale=${res.upscale})`);
  assert.ok(Math.abs(res.upscale - 1.2) < 1e-9, `upscale lands exactly on the cap (got ${res.upscale})`);
  // superset invariant: the old region must be fully inside the expanded one (nothing that was framed can fall out)
  assert.ok(res.region.left <= region.left && res.region.top <= region.top
    && res.region.left + res.region.width >= region.left + region.width
    && res.region.top + res.region.height >= region.top + region.height, 'old region ⊆ new region');
});

test('expandHeroRegionForStretchCap: image too small to reach the cap even at full extent ⇒ expands to the image bounds (still a superset) but reports reached:false — caller must flag needsBackup, never ship the stretch silently', () => {
  const region = { left: 100, top: 100, width: 400, height: 600 };
  const res = expandHeroRegionForStretchCap({ region, slotW: 600, slotH: 1200, imgW: 700, imgH: 900, cap: 1.2 });
  assert.strictEqual(res.changed, true, 'still expands as far as the image allows');
  assert.deepEqual(res.region, { left: 75, top: 0, width: 450, height: 900 }, 'maxed out: full image height used, width/left centred within the remaining margin');
  assert.strictEqual(res.reached, false, `cap NOT reachable — whole-image upscale is ${Math.max(600 / 700, 1200 / 900).toFixed(3)} > 1.2`);
  assert.ok(res.upscale > 1.2, `reported upscale still reflects the true (unresolvable) stretch (${res.upscale})`);
});

test('expandHeroRegionForStretchCap: region already within cap ⇒ no-op (changed:false)', () => {
  const region = { left: 10, top: 10, width: 600, height: 1200 }; // upscale already 1.0
  const res = expandHeroRegionForStretchCap({ region, slotW: 600, slotH: 1200, imgW: 2000, imgH: 2000, cap: 1.2 });
  assert.strictEqual(res.changed, false);
  assert.deepEqual(res.region, region);
});

test('expandHeroRegionForStretchCap: fail-safe on malformed/missing inputs ⇒ never throws, always changed:false/reached:false', () => {
  const region = { left: 0, top: 0, width: 100, height: 100 };
  assert.deepEqual(expandHeroRegionForStretchCap({}), { region: undefined, changed: false, reached: false });
  assert.deepEqual(expandHeroRegionForStretchCap({ region, slotW: 0, slotH: 100, imgW: 100, imgH: 100, cap: 1.2 }), { region, changed: false, reached: false });
  assert.deepEqual(expandHeroRegionForStretchCap({ region, slotW: 100, slotH: 100, imgW: 100, imgH: 100, cap: 0 }), { region, changed: false, reached: false });
});

console.log(`\n# hero-crop-geometry: ${n - failed}/${n} passed`);
console.log(`1..${n}`);
if (failed) process.exitCode = 1;
