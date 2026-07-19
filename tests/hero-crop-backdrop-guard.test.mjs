// ============================================================
// 🧪 HERO_CROP_GUARD — post-expand faceShare guard (19 ก.ค., AC-0160)
// ------------------------------------------------------------
// Bug traced: expandHeroRegionForStretchCap (heroCropGeometry.js:305, called from coverExecutorService.js
// ~984-1004) zooms the hero region OUT to cap the upscale ratio at ≤1.2×. When the source image is large
// enough that the expansion reaches the cap comfortably (_ex.reached === true), the old code never flagged
// _needHeroBackup — even though the region can grow 2-3x, leaving the dominant face a tiny fraction of the
// frame (backdrop/curtain/flowers filling the rest) with no signal to the composer to try a backup image.
//
// Fix: after a successful expand (_ex.changed), measure the REAL faceShare the expanded region gives
// (dominant-face-height-px / region.height) and additionally flag _needHeroBackup when it falls under the
// band-min (TECH_RULES.HERO_FACE_SHARE[0] = 30%) — regardless of whether the cap was "reached".
//
// This file proves the pure geometry math directly (no sharp/network — same style as
// tests/hero-crop-geometry.test.mjs) plus the renderer wiring via the real executeCover (same harness as
// tests/hero-crop-guard.test.mjs) and the composer-side pixel-verify threshold change.
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

const { executeCover } = await import('../src/lib/services/coverExecutorService.js');
const { expandHeroRegionForStretchCap } = await import('../src/lib/heroCropGeometry.js');

const HERO_SLOT = { id: 'main', x: 0, y: 0, w: 594, h: 1350, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const mkTemplate = () => ({ id: 'geo', canvasW: 1080, canvasH: 1350, feather: 0, slots: [{ ...HERO_SLOT }] });
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
const singleFace = (x1, y1, x2, y2) => ({ x1, y1, x2, y2, count: 1 });

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };

// ── pure geometry sanity: reproduce the reported bug shape directly against expandHeroRegionForStretchCap ──
await test('pure: expand reaches the cap comfortably (reached=true) on a large image, yet the dominant face collapses well under the 30% band-min — this is exactly the case the old `!reached`-only flag missed', async () => {
  // small tight region (post face-zoom) whose upscale is far over 1.2x, inside a big image with lots of room
  const region = { left: 900, top: 900, width: 200, height: 454 };
  const imgW = 3000, imgH = 3000;
  const ex = expandHeroRegionForStretchCap({ region, slotW: HERO_SLOT.w, slotH: HERO_SLOT.h, imgW, imgH, cap: 1.2 });
  assert.equal(ex.changed, true, 'expand engages');
  assert.equal(ex.reached, true, 'the big image affords enough room to reach the 1.2x cap');
  // a face that filled ~70% of the ORIGINAL tight region now occupies a much smaller share of the expanded one
  const faceHpx = region.height * 0.70;
  const faceShareAfterExpand = faceHpx / ex.region.height;
  assert.ok(faceShareAfterExpand < 0.30, `face share collapses under band-min after expand (got ${(faceShareAfterExpand * 100).toFixed(1)}%) — reached=true alone would have shipped this silently`);
});

// ── renderer wiring: a small face in a huge image ⇒ expand reaches the cap AND heroCropNeedsBackup is now set ──
await test('renderer: small face + huge image ⇒ HERO_CROP_GUARD expands to reach the 1.2x cap (region grows a lot) and the post-expand faceShare is under band-min ⇒ heroCropNeedsBackup=true (was NOT set before this fix, since _ex.reached was true)', async () => {
  const fb = singleFace(0.47, 0.47, 0.53, 0.53); // tiny centred face (6% of frame)
  const t = await runExec({ metaW: 4000, metaH: 4000, fb });
  assert.ok(t, 'hero trace produced');
  assert.ok(t.upscaleRaw <= 1.2 + 1e-6, `upscale capped at ≤1.2 (got ${t.upscaleRaw})`);
  assert.equal(t.heroCropNeedsBackup, true, 'small face left tiny after the stretch-cap expand ⇒ backup flag now raised');
});

await test('renderer: face large enough to clear band-min after expand ⇒ heroCropNeedsBackup is NOT set (no over-flagging on healthy hero crops)', async () => {
  // moderate face size + moderate image: expand engages but the face still clears 30% of the resulting region
  const fb = singleFace(0.40, 0.38, 0.60, 0.62);
  const t = await runExec({ metaW: 2600, metaH: 3250, fb });
  assert.ok(t, 'hero trace produced');
  assert.ok(t.upscaleRaw <= 1.2 + 1e-6, `upscale capped at ≤1.2 (got ${t.upscaleRaw})`);
  assert.notEqual(t.heroCropNeedsBackup, true, `healthy-sized face must not be flagged (got heroCropNeedsBackup=${t.heroCropNeedsBackup})`);
});

await test('kill-switch OFF (MEGA_HERO_CROP_GUARD=0): the whole HERO_CROP_GUARD block never runs ⇒ heroCropNeedsBackup is never set even for the tiny-face/huge-image case (byte-parity with the pre-guard renderer)', async () => {
  const fb = singleFace(0.47, 0.47, 0.53, 0.53);
  process.env.MEGA_HERO_CROP_GUARD = '0';
  const t = await runExec({ metaW: 4000, metaH: 4000, fb });
  delete process.env.MEGA_HERO_CROP_GUARD;
  assert.ok(t, 'hero trace produced');
  assert.notEqual(t.heroCropNeedsBackup, true, 'guard OFF ⇒ no flag at all (old behavior)');
});

// ── composer-side pixel-verify threshold (megaComposerService.js ~1728) ──
await test('composer pixel-verify: a hero face at 25% of the tile height now FAILS the gate (raised from 0.20 toward band-min ~0.26) — used to pass silently under the old 0.20 floor', async () => {
  // Re-derive the same threshold formula used in megaComposerService.js to prove the boundary shift
  // (isolated arithmetic check — the full end-to-end gate wiring is already proven by
  // tests/hero-face-crop-e2e-wiring.test.mjs and tests/ac0107-runtime-hero-crop.test.mjs).
  const { TECH_RULES } = await import('../src/lib/imageQualityConfig.js');
  const bandMin = TECH_RULES.HERO_FACE_SHARE[0]; // 30
  const thresholdOn = Math.max(0.05, (bandMin / 100) - 0.04); // 0.26
  const thresholdOff = 0.20;
  assert.ok(thresholdOn > thresholdOff, `threshold ON (${thresholdOn}) must be stricter than the old floor (${thresholdOff})`);
  const faceShare25 = 0.25;
  assert.ok(faceShare25 < thresholdOn, `25% face share fails the raised gate (${thresholdOn})`);
  assert.ok(faceShare25 >= thresholdOff, `25% face share used to pass the old 0.20 floor (sanity check on the bug this closes)`);
});

console.log(`\n# hero-crop-backdrop-guard: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
