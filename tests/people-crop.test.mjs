// ============================================================
// 🧪 MEGA_PEOPLE_CROP (20 ก.ค.) — "คนมาก่อน — ห้ามพื้นหลังกินเฟรม"
// ------------------------------------------------------------
// Runs the REAL exported executeCover (only `sharp` is stubbed — pixels only; every geometry / branch-selection
// runs for real). Proves the renderer behaviours of the people-crop guard + the kill-switch:
//   kill-switch: env MEGA_PEOPLE_CROP — **default OFF** (=== '1' to enable) · OFF ⇒ byte-parity 100%.
//   (a) OFF ⇒ no face + peopleBox present ⇒ the peopleBox is IGNORED (same blind centre crop as with no peopleBox,
//       and identical whether the env is unset or '0'); no peopleNeedsBackup flag.
//   (b) ON  ⇒ no face + peopleBox present ⇒ branch flips to 'people-box' anchored on the person (region ≠ centre).
//   (c) ON  ⇒ no face + NO peopleBox (blind centre crop, no person to anchor) ⇒ peopleNeedsBackup=true.
//   (d) ON  ⇒ peopleBox is tiny (<15% of the final region — person lost in the background) ⇒ peopleNeedsBackup=true.
//   (+) ON  ⇒ circle tile with no face + peopleBox ⇒ 'people-box' branch on the circle too.
// MEGA_CLUTTER_GUARD is forced '0' so its cleanNeedsBackup path can never interfere with these assertions.
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

process.env.MEGA_CLUTTER_GUARD = '0'; // isolate: clutter guard OFF for the whole file

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
// sharp stub: chainable, no real pixels — identical harness to tests/clutter-crop-guard.test.mjs.
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
const CIRCLE_SLOT = { id: 'circle', shape: 'circle', x: 40, y: 900, w: 360, h: 360, zIndex: 3, border: '#FFFFFF', borderWidth: 8 };
const CENTER = { x: 0.02, y: 0, w: 0.96, h: 0.94 }; // the composer's blind centre crop (h>0.5 → noface-top55)

// a "no real face" faceBox (usableSingleFace / usableGroupFaces both false) — optional subject/peopleBox via extra
const noFaceFb = (extra = {}) => ({ x1: 0, y1: 0, x2: 0, y2: 0, count: 0, imgW: 1, imgH: 1, ...extra });

const run = async ({ metaW = 1600, metaH = 2000, slot, fb, crop = CENTER }) => {
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
const withPeople = async (val, fn) => {
  const prev = process.env.MEGA_PEOPLE_CROP;
  if (val === undefined) delete process.env.MEGA_PEOPLE_CROP; else process.env.MEGA_PEOPLE_CROP = val;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.MEGA_PEOPLE_CROP; else process.env.MEGA_PEOPLE_CROP = prev;
  }
};

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

// a person occupying the mid-frame (compatible with the wide SEC_SLOT aspect → fully coverable)
const midPeople = () => ({ x: 0.25, y: 0.30, w: 0.50, h: 0.40 });

// ── (a) OFF byte-parity: peopleBox is ignored when the guard is off ──
await test('(a) OFF ⇒ no face + peopleBox is IGNORED — same blind centre crop as no-peopleBox, same for unset vs "0", no peopleNeedsBackup', async () => {
  const offWithPB = await withPeople('0', () => run({ slot: SEC_SLOT, fb: noFaceFb({ peopleBox: midPeople() }) }));
  const offNoPB   = await withPeople('0', () => run({ slot: SEC_SLOT, fb: noFaceFb() }));
  const defWithPB = await withPeople(undefined, () => run({ slot: SEC_SLOT, fb: noFaceFb({ peopleBox: midPeople() }) }));
  assert.ok(offWithPB && offNoPB && defWithPB, 'all three traces produced');
  assert.ok(offWithPB.branch.startsWith('noface'), `OFF stays on the blind centre crop (got ${offWithPB.branch})`);
  assert.deepEqual(offWithPB.region, offNoPB.region, 'peopleBox has zero effect on the region when the guard is off');
  assert.deepEqual(offWithPB.region, defWithPB.region, 'unset env behaves identically to "0" (default OFF)');
  assert.strictEqual(offWithPB.peopleNeedsBackup, undefined, 'no peopleNeedsBackup flag when the guard is off');
});

// ── (b) ON: no face + peopleBox ⇒ people-box branch, region genuinely anchored on the person ──
await test('(b) ON ⇒ no face + peopleBox ⇒ branch flips to "people-box" and the region differs from the blind centre crop', async () => {
  const on  = await withPeople('1', () => run({ slot: SEC_SLOT, fb: noFaceFb({ peopleBox: midPeople() }) }));
  const off = await withPeople('0', () => run({ slot: SEC_SLOT, fb: noFaceFb({ peopleBox: midPeople() }) }));
  assert.strictEqual(on.branch, 'people-box', `ON anchors on the person (got ${on.branch})`);
  assert.ok(off.branch.startsWith('noface'), `OFF still on the blind centre crop (got ${off.branch})`);
  assert.notDeepEqual(on.region, off.region, 'the ON region genuinely differs — not a no-op');
  assert.strictEqual(on.peopleNeedsBackup, undefined, 'a well-covered person raises no backup flag');
});

// ── (c) ON: no face + NO peopleBox (blind, nothing to anchor) ⇒ request a backup image ──
await test('(c) ON ⇒ no face + NO peopleBox (blind centre crop) ⇒ peopleNeedsBackup=true (OFF ⇒ no flag)', async () => {
  const on  = await withPeople('1', () => run({ slot: SEC_SLOT, fb: noFaceFb() }));
  const off = await withPeople('0', () => run({ slot: SEC_SLOT, fb: noFaceFb() }));
  assert.ok(on.branch.startsWith('noface'), `blind crop branch (got ${on.branch})`);
  assert.strictEqual(on.peopleNeedsBackup, true, 'blind crop with no person to anchor requests a backup image');
  assert.strictEqual(off.peopleNeedsBackup, undefined, 'OFF never raises the flag (byte-parity)');
});

// ── (d) ON: peopleBox tiny in the final region (person drowned by background) ⇒ request a backup image ──
// A huge subject box drives the subject-box branch (region ≈ full frame); the tiny peopleBox inside it (<15%) is the
// "person lost in the background" case that must swap for a cleaner image.
await test('(d) ON ⇒ peopleBox occupies <15% of the final region ⇒ peopleNeedsBackup=true (OFF ⇒ no flag)', async () => {
  const bigSubject = { subject: { x1: 0.05, y1: 0.05, x2: 0.95, y2: 0.95 }, peopleBox: { x: 0.45, y: 0.45, w: 0.06, h: 0.08 } };
  const on  = await withPeople('1', () => run({ slot: SEC_SLOT, fb: noFaceFb(bigSubject) }));
  const off = await withPeople('0', () => run({ slot: SEC_SLOT, fb: noFaceFb(bigSubject) }));
  assert.strictEqual(on.branch, 'subject-box', `subject drives the branch (got ${on.branch})`);
  assert.strictEqual(on.peopleNeedsBackup, true, 'a person <15% of the frame requests a cleaner backup');
  assert.strictEqual(off.peopleNeedsBackup, undefined, 'OFF ignores the tiny-person measurement (byte-parity)');
});

// ── (+) ON: circle tile with no face + peopleBox ⇒ people-box branch on the circle too ──
await test('(+) ON ⇒ circle with no face + peopleBox ⇒ branch "people-box" (OFF ⇒ noface-square)', async () => {
  const on  = await withPeople('1', () => run({ slot: CIRCLE_SLOT, fb: noFaceFb({ peopleBox: midPeople() }), crop: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 } }));
  const off = await withPeople('0', () => run({ slot: CIRCLE_SLOT, fb: noFaceFb({ peopleBox: midPeople() }), crop: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 } }));
  assert.strictEqual(on.branch, 'people-box', `ON circle anchors on the person (got ${on.branch})`);
  assert.strictEqual(off.branch, 'noface-square', `OFF circle stays on the blind square crop (got ${off.branch})`);
});

console.log(`\n# people-crop: ${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
