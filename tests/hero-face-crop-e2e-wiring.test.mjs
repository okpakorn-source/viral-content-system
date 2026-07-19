// ============================================================
// 🧪 _heroFaceCrop END-TO-END WIRING (19-20 ก.ค. 69) — closes the gap an adversarial reviewer found in the
// "hero must be a single person via crop" feature (นโยบาย C): S6 (s6_slots) can SYNTHESIZE a single-face crop
// from a couple/group photo when the pool has no solo shot of the hero — but that crop used to die in transit:
//
//   S6 writes slot._heroFaceCrop (megaAdapters.js s6_slots, ~line 4068/4182)
//     → S7 (s7_cover) rebuilds slotPlan from dossier.pickImages.slots — THIS is where the field used to be
//       dropped (the slotPlan row builder never copied it across)
//     → megaComposerService builds spec.slots fresh from dnaToTemplateSpec/family templates (no such field)
//     → coverExecutorService.renderRectTile reads slot._heroFaceCrop (its "hero-face-crop-explicit" branch) —
//       with nothing ever attached to spec.slots, that branch was UNREACHABLE and every couple/group photo fell
//       back to the plain "group-hero-largest" crop, i.e. the guard was a no-op on the REAL pipeline (only
//       covered by tests/hero-crop-guard.test.mjs's synthetic direct executeCover() calls with a hand-built
//       templateSpec that pre-attached the field — never proven to arrive there from S6 for real).
//
// This test runs the GENUINE producers end-to-end — real s6_slots → real s7_cover → real composeAndVerify
// (which runs the REAL, unstubbed coverExecutorService.executeCover) — with only `sharp`/the AI-perception
// boundaries (faceDetector, openai, coverDirectorService) stubbed, exactly like tests/hero-crop-guard.test.mjs
// and tests/ac0107-runtime-hero-crop.test.mjs already do for adjacent seams. It proves:
//   1) the wire carries _heroFaceCrop all the way from S6's dossierPatch into the ACTUAL wire payload S7 sends
//      to /api/queue/add (byte-identical value, not just "some crop")
//   2) the composer attaches it to the real templateSpec.slots['main'] object BEFORE calling executeCover
//   3) the RENDERED hero region is the one fitCropToSlotAspect(_heroFaceCrop, ...) would produce — i.e. the
//      branch actually taken is 'hero-face-crop-explicit', not 'group-hero-largest'
//   4) flipping either kill-switch (MEGA_HERO_SINGLE at the producer, MEGA_HERO_CROP_GUARD at the renderer)
//      independently reproduces the pre-fix behavior end-to-end (group-hero-largest, no crash) — additive/
//      opt-out safety is preserved exactly as AGENTS.md requires.
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;

// ── sharp stub: generic chainable, no real pixels — identical shape to tests/hero-crop-guard.test.mjs's harness.
//   Safe for BOTH composeCore's preprocessing (trimVividBorder/aHash/collage — all degrade to harmless no-ops
//   against this constant buffer, proven by that same file already exercising it against the real executor)
//   AND coverExecutorService's real render calls (extract/resize/png/linear/modulate/sharpen/composite/blur). ──
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

// ── faceDetector stub: batchDetectFaces drives the REAL executor's branch selection (2 faces on the hero image,
//   id 'mc_0', so usableGroupFaces() is true and the hero-face-crop-explicit vs group-hero-largest fork is live);
//   filler images (mc_1..mc_4) get no entry ⇒ no face ⇒ trivial fallback crops, irrelevant to this test.
//   detectFaces (singular) backs composeCore's post-render "hero verify" pixel re-check — a big centered face so
//   that gate passes on the first attempt and never swaps the hero image out from under the crop we're proving. ──
const FD_STUB = MOD(`
export async function batchDetectFaces(items){
  const m = new Map();
  for (const it of items) {
    if (it.id === 'mc_0') {
      m.set(it.id, { imageWidth: 1600, imageHeight: 2000, hasFaces: true, faces: [
        { x: 160, y: 400, width: 384, height: 600 },
        { x: 880, y: 400, width: 320, height: 600 },
      ] });
    }
  }
  return m;
}
export async function detectFaces(){
  return { imageWidth: 660, imageHeight: 1350, hasFaces: true, faces: [{ x: 130, y: 260, width: 400, height: 550 }] };
}`);
const OPENAI_BOMB = MOD(`export async function callAI(){ throw new Error('LLM_FORBIDDEN — this test must not touch the AI eye (no refImagePath is passed)'); }`);
const DIRECTOR_BOMB = MOD(`export async function finalCrop(){ throw new Error('FINALCROP_FORBIDDEN — eye/finalCrop path must not run in this test'); }`);
const NEXT_STUB = MOD(`export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(SHARP_STUB)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(NEXT_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/services/faceDetector') return { url: ${JSON.stringify(FD_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(OPENAI_BOMB)}, shortCircuit: true };
  if (specifier === '@/lib/services/coverDirectorService') return { url: ${JSON.stringify(DIRECTOR_BOMB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { s6_slots, s7_cover } = await import('../src/lib/megaAdapters.js');
const { composeAndVerify } = await import('../src/lib/services/megaComposerService.js');

// ── legacy-path env hygiene (mirrors tests/mega-hero-single-face.test.mjs) — keep every shadow/strict lane off
//   so this test genuinely exercises the plain legacy producer→composer wire, not semantic/solver/strict V2. ──
for (const k of [
  'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_REF_SHOT_AUTHORITY', 'MEGA_SLOT_SOLVER_LIVE',
  'MEGA_REF_HERO_V2', 'MEGA_ROLE_READINESS', 'MEGA_FINAL_DECISION_EVIDENCE_V2', 'MEGA_CROSS_CASE_BORROW',
  'MEGA_STRICT_RENDER', 'MEGA_STRICT_PRODUCER',
]) delete process.env[k];
// ★ 20 ก.ค.: pin MEGA_HERO_SOLO_ONLY=0 — ฟีเจอร์ SOLO_ONLY (default ON) "ห้ามครอปภาพคู่→หน้าเดี่ยว" มาแทนที่ synth-crop
//   ของ MEGA_HERO_SINGLE โดยเจตนา (borrow-or-HOLD) เทสนี้พิสูจน์การต่อสาย _heroFaceCrop ของ synth-crop เดิม จึงต้องปักสวิตช์ปิด
process.env.MEGA_HERO_SOLO_ONLY = '0';

const withEnv = async (name, v, fn) => {
  const prev = process.env[name];
  if (v == null) delete process.env[name]; else process.env[name] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; }
};

const HERO_NAME = 'มะปราง';
const OTHER_NAME = 'ต้นกล้า'; // second person in the couple photo — never picked as hero
const FILLERS = ['ฝ้าย', 'พลอย', 'เกด', 'หมิว'];
// >5000 bytes so composeCore's loader keeps it (content is irrelevant — sharp is stubbed); each image gets a
// UNIQUE payload (id-prefixed) — s7_cover dedupes slotPlan candidates by URL, so identical data: URIs across
// fixtures would collapse to a single row and silently starve the other slots (caught by this test itself).
const dataUrl = (tag) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from(String(tag)), Buffer.alloc(6000, 1)]).toString('base64')}`;

const couple = () => ({
  id: 'COUPLE-1',
  imageUrl: dataUrl('COUPLE-1'),
  realWidth: 2400, realHeight: 1500,
  triage: {
    relevant: true, clean: true, faceCount: 2, person: HERO_NAME, persons: [HERO_NAME, OTHER_NAME],
    category: 'group', emotion: 'happy', note: '', newsScene: true, quality: 8,
    faceBox: { x: 0.1, y: 0.15, w: 0.25, h: 0.35 },
    peopleBox: { x: 0.05, y: 0.1, w: 0.6, h: 0.6 },
  },
});
const filler = (id, person) => ({
  id, imageUrl: dataUrl(id), realWidth: 1200, realHeight: 1500,
  triage: { relevant: true, clean: true, faceCount: 1, person, persons: [person], category: 'context', emotion: 'neutral', note: '', newsScene: true, quality: 6 },
});
const pool = () => [couple(), filler('FILL-1', FILLERS[0]), filler('FILL-2', FILLERS[1]), filler('FILL-3', FILLERS[2]), filler('FILL-4', FILLERS[3])];

function mkJob() {
  return {
    dossier: {
      images: { caseId: 'CASE-HEROCROP-E2E' },
      compass: {
        angle: 'มุมทดสอบต่อสาย _heroFaceCrop', primaryEmotion: 'warm', secondaryEmotions: [],
        mainCharacters: [{ name: HERO_NAME, role: 'hero' }, { name: OTHER_NAME, role: 'someone_else' }],
        visualDreamShots: [], doNotUse: [],
      },
      desk: { title: 'ข่าวทดสอบต่อสาย heroFaceCrop' },
      // typeMatched:false ⇒ no real ref DNA bound ⇒ _cropGuard stays off at S6 (matches
      // tests/mega-hero-single-face.test.mjs's proven-good fixture for the crop-synthesis test).
      refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
      artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
    },
  };
}

// brain gives explicit picks for ALL 5 legacy slots — bypasses the quality/category fallback cascade entirely so
// slot assignment is deterministic; the hero-must-be-solo policy (crop synthesis) still runs unconditionally on
// whatever image lands in the 'hero' slot, brain-picked or not (see megaAdapters.js ~line 4056).
const brainDeps = (poolArr) => ({
  slotDirectorBrain: async () => ({
    slots: {
      hero: { id: 'COUPLE-1', reason: 'brain: hero (stub)' },
      reaction: { id: 'FILL-1', reason: 'brain: reaction (stub)' },
      action: { id: 'FILL-2', reason: 'brain: action (stub)' },
      context: { id: 'FILL-3', reason: 'brain: context (stub)' },
      circle: { id: 'FILL-4', reason: 'brain: circle (stub)' },
    },
    note: 'stub-brain-full-plan',
  }),
  fetchJson: async (url) => (String(url).includes('/api/images/') ? { success: true, images: poolArr } : (() => { throw new Error('unexpected s6 fetch: ' + url); })()),
});

// pure mirror of coverExecutorService.js's (non-exported) fitCropToSlotAspect — used only to compute the
// INDEPENDENTLY-EXPECTED render region from the real _heroFaceCrop value captured off the wire, so the
// assertion proves the real executor used that exact box (not a coincidental branch-name match).
function fitCropToSlotAspectMirror(crop, imgW, imgH, slotAspect) {
  let px = crop.x * imgW, py = crop.y * imgH, pw = crop.w * imgW, ph = crop.h * imgH;
  const cropAspect = pw / ph;
  if (cropAspect > slotAspect) { const targetH = pw / slotAspect; py -= (targetH - ph) / 2; ph = targetH; }
  else if (cropAspect < slotAspect) { const targetW = ph * slotAspect; px -= (targetW - pw) / 2; pw = targetW; }
  if (pw > imgW) { pw = imgW; ph = pw / slotAspect; }
  if (ph > imgH) { ph = imgH; pw = ph * slotAspect; }
  px = Math.min(Math.max(px, 0), imgW - pw);
  py = Math.min(Math.max(py, 0), imgH - ph);
  return { left: Math.round(px), top: Math.round(py), width: Math.max(8, Math.round(pw)), height: Math.max(8, Math.round(ph)) };
}
const IMG_W = 1600, IMG_H = 2000; // fixed globalThis.__SHARP_META for every image in this test
const MAIN_ASPECT = 660 / 1350; // vt_ref_tri's 'main' slot (the template composeCore falls back to with 5 loaded images, no refDNA)

// runs the full real pipeline: s6_slots → s7_cover (capturing the exact /api/queue/add wire payload) → composeAndVerify
async function runPipeline() {
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: brainDeps(pool()) });
  assert.equal(s6.status, 'done', `s6_slots must complete (got ${s6.status}: ${s6.summary})`);
  const heroSlotEntry = s6.dossierPatch.pickImages.slots.hero;

  const job2 = mkJob();
  job2.dossier.pickImages = s6.dossierPatch.pickImages;
  let captured = null;
  const s7fetch = async (url, opts) => {
    if (String(url).includes('/api/queue/add')) { captured = JSON.parse(opts.body); return { success: true, jobId: 'JOB-E2E-1' }; }
    throw new Error('unexpected s7 fetch: ' + url);
  };
  // in-process transport seam (LANE-C) — bypasses the win32/cloud-origin guard deterministically regardless of host OS
  const s7 = await s7_cover(job2, { _deps: { fetchJson: s7fetch, queueTransport: 'cover_ref_test_in_process' } });
  assert.equal(s7.status, 'done', `s7_cover must complete (got ${s7.status}: ${s7.summary})`);
  assert.ok(captured, 's7_cover must have posted a payload to /api/queue/add');
  assert.ok(Array.isArray(captured.slotPlan) && captured.slotPlan.length >= 3, 'captured payload must carry a real slotPlan');

  globalThis.__SHARP_META = { width: IMG_W, height: IMG_H };
  let compose;
  try {
    compose = await composeAndVerify({ newsTitle: 'ข่าวทดสอบ', slotPlan: captured.slotPlan, refDNA: null, stableOrder: true });
  } finally {
    globalThis.__SHARP_META = undefined;
  }
  assert.equal(compose.success, true, `composeAndVerify must succeed (got error: ${compose.error} / ${compose.errorType})`);
  const heroTrace = compose.crops.find((c) => c.slot === 'main')?.trace || null;
  assert.ok(heroTrace, 'crops[] must include a trace for the main (hero) slot');

  return { s6, heroSlotEntry, s7, captured, compose, heroTrace };
}

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 10).join('\n  ')}`); } };

// ============================================================
// ON path (both switches default ON): the full wire is proven end-to-end.
// ============================================================
let ON_STATE = null; // shared with the OFF comparisons below to prove they genuinely differ, not just "pass separately"

await test('S6 synthesizes _heroFaceCrop from the couple photo (no solo shot in the pool, identity mapped)', async () => {
  const { heroSlotEntry } = await runPipeline();
  assert.equal(heroSlotEntry.id, 'COUPLE-1', 'hero stays the same photo (cropped, not swapped)');
  assert.equal(heroSlotEntry.faces, 2);
  assert.ok(heroSlotEntry._heroFaceCrop, 'S6 must attach _heroFaceCrop');
  const c = heroSlotEntry._heroFaceCrop;
  assert.ok(c.w > 0 && c.h > 0 && c.w < 1 && c.h < 1, 'crop must be a real, normalized sub-box');
});

await test('BUG FIX (megaAdapters s7_cover): the wire payload to /api/queue/add carries _heroFaceCrop on the hero row, byte-identical to what S6 produced', async () => {
  const { heroSlotEntry, captured } = await runPipeline();
  const heroRow = captured.slotPlan.find((r) => r.isHero === true);
  assert.ok(heroRow, 'slotPlan must have a row flagged isHero');
  assert.ok(heroRow._heroFaceCrop, 'REGRESSION: slotPlan hero row lost _heroFaceCrop in transit through s7_cover (the exact bug this task fixes)');
  assert.deepEqual(heroRow._heroFaceCrop, heroSlotEntry._heroFaceCrop, 'value must survive the S6→S7 hop unchanged');
});

await test('BUG FIX (megaComposerService + coverExecutorService): the REAL renderer takes branch hero-face-crop-explicit, and the rendered region is exactly fitCropToSlotAspect(_heroFaceCrop) — NOT group-hero-largest', async () => {
  const state = await runPipeline();
  ON_STATE = state;
  const { heroTrace, captured } = state;
  const heroRow = captured.slotPlan.find((r) => r.isHero === true);
  assert.equal(heroTrace.branch, 'hero-face-crop-explicit', `must bypass group-hero-largest even though the hero image has 2 faces (got branch=${heroTrace.branch})`);
  const expected = fitCropToSlotAspectMirror(heroRow._heroFaceCrop, IMG_W, IMG_H, MAIN_ASPECT);
  assert.deepEqual(heroTrace.region, expected, 'rendered region must be derived from the real S6 crop, not the detector\'s 2-face geometry');
  assert.ok(heroTrace.upscaleRaw <= 1.2 + 1e-9, 'a correctly-sized synthesized crop must not need the stretch-cap safety net');
});

// ============================================================
// OFF paths — each kill-switch flipped independently must reproduce the pre-fix/legacy behavior end-to-end,
// with no crash, per AGENTS.md's "OFF ตัวใดตัวหนึ่ง=ต้องไม่พัง" requirement.
// ============================================================
await test('MEGA_HERO_SINGLE=0: S6 never synthesizes a crop at all — hero stays the couple photo unmodified, renderer falls back to group-hero-largest', async () => {
  await withEnv('MEGA_HERO_SINGLE', '0', async () => {
    const { heroSlotEntry, captured, heroTrace } = await runPipeline();
    assert.ok(!heroSlotEntry._heroFaceCrop, 'OFF: S6 must not attach _heroFaceCrop');
    const heroRow = captured.slotPlan.find((r) => r.isHero === true);
    assert.ok(!heroRow._heroFaceCrop, 'OFF: slotPlan hero row must not carry the field either (nothing to carry)');
    assert.ok(heroTrace.branch.startsWith('group-hero-largest'), `OFF: must fall back to the historical branch (got ${heroTrace.branch})`);
  });
});

await test('MEGA_HERO_CROP_GUARD=0: S6 still synthesizes the crop and it still reaches spec.slots.main, but the renderer ignores it (byte-parity with the pre-guard renderer) — proves the two OFF paths are independent switches', async () => {
  await withEnv('MEGA_HERO_CROP_GUARD', '0', async () => {
    const { heroSlotEntry, heroTrace } = await runPipeline();
    assert.ok(heroSlotEntry._heroFaceCrop, 'S6-level switch is untouched — crop is still synthesized');
    assert.ok(heroTrace.branch.startsWith('group-hero-largest'), `renderer must ignore the wired crop when its own switch is off (got ${heroTrace.branch})`);
    assert.notEqual(heroTrace.branch, 'hero-face-crop-explicit');
  });
});

await test('control: the ON region and both OFF regions are materially different pixel boxes (the wiring changes REAL, observable output — not a no-op)', async () => {
  assert.ok(ON_STATE, 'ON scenario must have run first to capture a baseline');
  const onRegion = ON_STATE.heroTrace.region;
  await withEnv('MEGA_HERO_SINGLE', '0', async () => {
    const { heroTrace } = await runPipeline();
    assert.notDeepEqual(heroTrace.region, onRegion, 'MEGA_HERO_SINGLE=0 region must differ from the ON region');
  });
  await withEnv('MEGA_HERO_CROP_GUARD', '0', async () => {
    const { heroTrace } = await runPipeline();
    assert.notDeepEqual(heroTrace.region, onRegion, 'MEGA_HERO_CROP_GUARD=0 region must differ from the ON region');
  });
});

console.log(`\n# hero-face-crop-e2e-wiring: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
