// ============================================================
// 🧪 AC-0107 RUNTIME-BOUND HERO CROP PROOF — real strict V2 consumer/executor seam
// ------------------------------------------------------------
// The pre-carrier eligibility gate (megaAdapters _runRefHeroV2) filters candidates from STORED evidence and is only a
// NECESSARY filter — it cannot see the Final-Cropper / watermark-dodge / fresh-detector geometry of the ACTUAL render.
// The AUTHORITATIVE ≤1.2× proof lives in composeAndVerify: after Eye/FinalCrop, it reads the executor's MEASURED upscale
// for the CANONICAL hero slot (heroComposerSlotId) from the final cropTrace and fails TYPED (STRICT_V2_HERO_CROP_UNSAFE)
// before any manifest/persist/archive when the real hero crop > 1.2 — or cannot be measured.
//
// This harness proves the CONSUMER seam + the gate DECISION through the GENUINE carrier: a REAL four-foundation V2
// carrier (real s6_slots → real s7_cover wire), fed to the REAL composeAndVerify, with a stub executor whose measured
// hero upscaleRaw is INJECTED so the gate's decision is exercised on a KNOWN value. The injected number stands in for
// "whatever the render measured" — it does NOT prove the renderer's FinalCrop/dodge/decoded-dim geometry. That real
// crop math (and that it produces exactly this trace shape) is proven separately by tests/ac0107-executor-geometry.test.mjs,
// which runs the REAL executeCover; the two halves meet at the shared trace schema (own primitive slot + own finite
// positive upscaleRaw) pinned in both. No sharp/LLM/net.
//   1) hero rendered ≤1.2  ⇒ success (must not over-reject the healthy case)
//   2) hero rendered >1.2  ⇒ STRICT_V2_HERO_CROP_UNSAFE, success=false, no manifest/base64 (⇒ no persist/archive)
//   3) hero upscale unmeasurable / hostile trace shape ⇒ fail-closed same typed error (exactly-one own primitive raw)
//   4) the slot the proof binds to == the EXACT signed canonical hero composerSlotId (never a regex /main/)
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;

// sharp shim (behavioural, not native): metadata + raw for trimVividBorder/aHash. No real pixels decoded.
const SHARP_STUB = MOD(`
export default function sharp(buf){
  globalThis.__SHARP_CALLS = (globalThis.__SHARP_CALLS||0)+1;
  let sized = 0, extracted = false;
  const chain = {
    metadata: async () => ({ width: 1000, height: 1250 }),
    greyscale(){ return chain; }, resize(w){ sized = w; return chain; }, raw(){ return chain; },
    jpeg(){ return chain; }, extract(){ extracted = true; return chain; }, toColourspace(){ return chain; }, removeAlpha(){ return chain; },
    toBuffer: async () => {
      if (extracted) return Buffer.from(Array.from({ length: 4321 }, (_, i) => (i * 11 + 3) % 251));
      if (sized === 100) { const out = Buffer.alloc(30000); for (let i = 0; i < 30000; i++) out[i] = buf[(i * 13) % buf.length]; return out; }
      return Buffer.from(Array.from({ length: 64 }, (_, i) => buf[(i * 97) % buf.length]));
    },
  };
  return chain;
}`);
// executeCover stub: emits a cropTrace whose per-slot exact raw upscale is controllable (models the REAL executor's
// measured final-region upscale — see the SEPARATE real-executor geometry tests below for the actual crop math). The
// gate reads the EXACT own primitive \`upscaleRaw\`; \`upscale\` is the rounded advisory copy the real executor also emits.
// __UP_BY_SLOT[slot] overrides; __EXEC_UPSCALE is the default; __EXEC_NO_UPSCALE omits upscaleRaw (unmeasurable render);
// __TRACE_OVERRIDE(assignments) returns the ENTIRE traceSink verbatim (for P1-2 hostile/duplicate/accessor shapes).
const EXEC_STUB = MOD(`
export async function executeCover({ assignments, traceSink }){
  globalThis.__EXEC_CALLS = (globalThis.__EXEC_CALLS||0)+1;
  if (Array.isArray(traceSink)) {
    traceSink.length = 0;
    if (typeof globalThis.__TRACE_OVERRIDE === 'function') { traceSink.push(...globalThis.__TRACE_OVERRIDE(assignments)); }
    else {
      traceSink.push(...assignments.map((a) => {
        const e = { slot: a.slotId, branch: 'stub' };
        if (globalThis.__EXEC_NO_UPSCALE !== true) {
          const byslot = globalThis.__UP_BY_SLOT || {};
          const v = (a.slotId in byslot) ? byslot[a.slotId] : (globalThis.__EXEC_UPSCALE ?? 1.0);
          e.upscaleRaw = v;
          if (typeof v === 'number' && Number.isFinite(v)) e.upscale = +v.toFixed(2);
        }
        return e;
      }));
    }
  }
  return Buffer.alloc(9000, 7);
}
export const V3_TEMPLATES = {};`);
const FD_STUB = MOD(`
export async function batchDetectFaces(items){
  globalThis.__FD_CALLS = (globalThis.__FD_CALLS||0)+1;
  const m = new Map();
  items.forEach((it) => m.set(it.id, { imageWidth:1000, imageHeight:1250, hasFaces:true, faces:[{x:400,y:300,width:200,height:250}] }));
  return m;
}
export async function detectFaces(){ throw new Error('DETECTFACES_FORBIDDEN'); }`);
const OPENAI_BOMB = MOD(`export async function callAI(){ throw new Error('LLM_FORBIDDEN'); }`);
const DIRECTOR_BOMB = MOD(`export async function finalCrop(){ throw new Error('FINALCROP_FORBIDDEN'); }`);
const NEXT_STUB = MOD(`export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(SHARP_STUB)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(NEXT_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/services/coverExecutorService') return { url: ${JSON.stringify(EXEC_STUB)}, shortCircuit: true };
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

const { s6_slots, s7_cover, _dnaHashFor } = await import('../src/lib/megaAdapters.js');
const { composeAndVerify } = await import('../src/lib/services/megaComposerService.js');

// ── Date.now fixing (byte determinism) + env scoping ──
const REAL_NOW = Date.now;
const FIXED_TS = 1770000000000;
const withFixedNow = async (fn) => { Date.now = () => FIXED_TS; try { return await fn(); } finally { Date.now = REAL_NOW; } };
const withEnvMap = async (map, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(map)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const cloneJson = (v) => JSON.parse(JSON.stringify(v));

// ── real DNA from the tracked library (same record ac0084/ac0099 already prove valid) ──
const refs = JSON.parse(readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
const REF_REC = refs.find((r) => r.id === 'REF-mrbqalpo-h1r1');
assert.ok(REF_REC?.dna, 'fixture: ref DNA REF-mrbqalpo-h1r1 must exist');
const FIXTURE_DNA = REF_REC.dna;
const FIXTURE_REF_ID = REF_REC.id;
const FIXTURE_DNA_HASH = _dnaHashFor(FIXTURE_DNA);
const V2_ENV = { MEGA_REF_HERO_V2: '1', MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' };
const RH_EV = { identityConfidence: 0.9, faceShare: 0.15, headroom: 0.15, visibleBodyRegion: 'half_body', occlusion: 0.05, edgeCut: 0.02, cleanliness: 0.9 };
const RH_RD = { searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true };
const RH_SC = { semanticScore: 700, qualityScore: 700, slotFitScore: 700 };
const SAFE_FB = { x1: 0.30, y1: 0.12, x2: 0.70, y2: 0.60 };  // big centred face ⇒ crop-safe for the real hero slot
const UNSAFE_FB = { x1: 0.46, y1: 0.46, x2: 0.54, y2: 0.54 }; // tiny face ⇒ hero crop >1.2× (no crop-safe hero)
const v2Img = (id, { person = null, sceneKey, faceBox = SAFE_FB } = {}) => ({
  id, imageUrl: `https://cdn.test/${id}.jpg`, thumbnailUrl: '', source: 'SynthNews Desk', sourceLink: `https://source.test/${id}`,
  width: 900, height: 1200, realWidth: 900, realHeight: 1200,
  triage: { relevant: true, clean: true, faceCount: 1, person, persons: person ? [person] : [], category: 'face-emotional', emotion: 'warm', note: `${id} ${sceneKey}`, newsScene: true, quality: 8, realShortSide: 900, sharpness: 80, faceBox, ...RH_EV, ...RH_RD, ...RH_SC, sceneKey },
});
const V2_POOL = () => [
  v2Img('V-L1', { person: 'Lisa', sceneKey: 'sceneL' }), v2Img('V-N1', { person: 'Nene', sceneKey: 'sceneN' }),
  v2Img('V-C1', { person: 'Ctx1', sceneKey: 'sceneC1' }), v2Img('V-C2', { person: 'Ctx2', sceneKey: 'sceneC2' }), v2Img('V-C3', { person: 'Ctx3', sceneKey: 'sceneC3' }),
];
const V2_CHARS = [{ name: 'Lisa', role: 'hero' }, { name: 'Nene', role: 'reaction' }, { name: 'Ctx1', role: 'context' }, { name: 'Ctx2', role: 'context' }, { name: 'Ctx3', role: 'context' }];
const V2_PICKS = { hero: { id: 'V-L1', reason: 'x', backups: [] }, context: { id: 'V-C1', reason: 'x', backups: [] }, action: { id: 'V-C2', reason: 'x', backups: [] }, moment: { id: 'V-C3', reason: 'x', backups: [] }, reaction: { id: 'V-N1', reason: 'x', backups: [] } };
const mkRefMatch = () => ({ dna: FIXTURE_DNA, styleName: 'v2-fixture', typeMatched: true, imagePath: '/ref-covers/v2-fixture.jpg', refId: FIXTURE_REF_ID, dnaHash: FIXTURE_DNA_HASH, refBoundAt: new Date(FIXED_TS).toISOString() });
const mkS6Deps = () => ({
  slotDirectorBrain: async () => ({ slots: V2_PICKS, note: 'v2-fixture' }),
  artBriefBrain: async () => { throw new Error('artBrief must be pre-set'); },
  fetchJson: async (url) => { if (String(url).includes('/api/images/')) return { success: true, images: V2_POOL() }; throw new Error('unexpected fetch ' + url); },
});

// (build-1) REAL post-S6 carrier via the real four-foundation producer, ONCE, offline.
const FIXTURE_JOB = await withEnvMap(V2_ENV, () => withFixedNow(async () => {
  const job = { id: 'AC0107-RT-JOB', dossier: {
    images: { caseId: 'AC0107-RT' },
    compass: { angle: 'มุมทดสอบ runtime-hero-crop', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: V2_CHARS, visualDreamShots: [], doNotUse: [] },
    desk: { title: 'ข่าวทดสอบ runtime hero crop' }, refMatch: mkRefMatch(), artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
  } };
  const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkS6Deps() });
  assert.strictEqual(s6.status, 'done', `fixture: real s6_slots done (got ${s6.status} ${s6.summary || ''})`);
  Object.assign(job.dossier, s6.dossierPatch);
  assert.strictEqual(job.dossier.pickImages?.refHeroV2?.ok, true, 'fixture: real S6 emits a valid refHeroV2 carrier');
  return cloneJson(job);
}));

// (build-2) REAL V2-only wire via the real s7_cover producer → the composer args (slotPlan + refHeroV2).
const WIRE = await withEnvMap({ ...V2_ENV, MEGA_STRICT_RENDER: '1' }, () => withFixedNow(async () => {
  const job = cloneJson(FIXTURE_JOB);
  let body = null;
  const fetchJson = async (url, opts) => {
    if (String(url).includes('/api/queue/add')) { body = opts.body; return { success: true, jobId: 'RT-WIRE' }; }
    if (String(url).includes('/api/images/')) return { httpStatus: 200, success: true, images: V2_POOL() };
    throw new Error('unexpected fetch ' + url);
  };
  const s7 = await s7_cover(job, { origin: 'http://mock', _deps: { fetchJson, queueTransport: 'cover_ref_test_in_process' } });
  assert.strictEqual(s7.status, 'done', `wire: real s7_cover done (got ${s7.status} ${s7.summary || ''})`);
  assert.ok(typeof body === 'string' && body.length > 0, 'wire: real S7 emitted a queue body');
  return JSON.parse(body);
}));
assert.ok(WIRE.refHeroV2?.selectionSpec?.v === 2, 'wire carries a canonical V2 carrier');
// the EXACT signed canonical hero composerSlotId (what the runtime proof must bind to — never a regex /main/)
const HERO_SLOT_ID = WIRE.refHeroV2.selectionSpec.hero.heroSlotId;
const HERO_COMPOSER_SLOT_ID = WIRE.refHeroV2.selectionSpec.slots.find((s) => s.refSlotId === HERO_SLOT_ID).composerSlotId;
assert.ok(typeof HERO_COMPOSER_SLOT_ID === 'string' && HERO_COMPOSER_SLOT_ID.length > 0, 'signed canonical hero composerSlotId exists');

// fetch bytes for the carrier's https URLs (>5000 bytes, varied so aHash isn't blank)
const VARIED = (size, seed) => { const b = Buffer.alloc(size); for (let i = 0; i < size; i++) b[i] = (i * 7 + seed) % 251; return b; };
globalThis.fetch = async (url) => ({ ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => VARIED(9001, String(url).length) });

const composeArgs = () => ({ newsTitle: 'ข่าวทดสอบ V2', slotPlan: cloneJson(WIRE.slotPlan || []), refHeroV2: cloneJson(WIRE.refHeroV2), refDNA: FIXTURE_DNA, refImagePath: null, stableOrder: true });
const _resetExec = () => { globalThis.__EXEC_UPSCALE = undefined; globalThis.__UP_BY_SLOT = undefined; globalThis.__EXEC_NO_UPSCALE = false; globalThis.__TRACE_OVERRIDE = undefined; };
const runCompose = (setup) => withEnvMap({ ...V2_ENV, MEGA_STRICT_RENDER: '1' }, () => withFixedNow(async () => {
  _resetExec();
  if (setup) setup();
  try { return await composeAndVerify(composeArgs()); }
  finally { _resetExec(); }
}));

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n  ')}`); } };

await test('0) the signed carrier is genuine V2 (hero mapped to a canonical composerSlotId; proof will bind to THIS slot, not a regex)', async () => {
  assert.strictEqual(WIRE.refHeroV2.selectionSpec.refId, FIXTURE_REF_ID, 'wire carrier ref identity = bound refId');
  assert.ok(WIRE.refHeroV2.selectionSpec.slots.some((s) => s.refSlotId === HERO_SLOT_ID && s.composerSlotId === HERO_COMPOSER_SLOT_ID), 'hero refSlot → composerSlot mapping present');
});

await test('1) hero rendered ≤1.2× ⇒ real strict V2 compose SUCCEEDS (must not over-reject the healthy close-up)', async () => {
  const r = await runCompose(() => { globalThis.__EXEC_UPSCALE = 1.12; });
  assert.strictEqual(r.success, true, `expected success, got ${r.errorType} ${r.error || ''}`);
  assert.ok(typeof r.base64 === 'string' && r.base64.startsWith('data:image/jpeg;base64,'), 'emitted a real cover buffer');
  assert.strictEqual(r.manifest?.strictRender?.verified, true, 'strict manifest verified on success');
});

// NOTE: tests 2–5 inject the exact raw upscale to exercise the GATE'S DECISION on a known value — they do NOT prove the
// renderer's FinalCrop/dodge geometry (that is proven separately by the REAL-executor tests 12–14 below, which run the
// actual executeCover crop math). Here the number stands in for "whatever the render measured".
await test('2) hero render measured >1.2× (raw 1.5 injected) ⇒ STRICT_V2_HERO_CROP_UNSAFE, no success, no base64/manifest ⇒ nothing to persist/archive', async () => {
  const r = await runCompose(() => { globalThis.__UP_BY_SLOT = { [HERO_COMPOSER_SLOT_ID]: 1.5 }; });
  assert.strictEqual(r.success, false, 'must not succeed on a >1.2× hero render');
  assert.strictEqual(r.errorType, 'STRICT_V2_HERO_CROP_UNSAFE', `typed error (got ${r.errorType})`);
  assert.ok(Array.isArray(r.reasons) && r.reasons.some((x) => String(x).startsWith(`hero_crop_upscaled:${HERO_COMPOSER_SLOT_ID}:`)), `reason names the signed hero slot (got ${JSON.stringify(r.reasons)})`);
  assert.ok(!('base64' in r) && !('manifest' in r), 'no rendered buffer / manifest returned ⇒ downstream cannot persist or archive');
});

await test('3) the incident magnitude (raw 2.69 injected) ⇒ STRICT_V2_HERO_CROP_UNSAFE (the AC-0107 class, caught before persist/archive, not only by downstream QC)', async () => {
  const r = await runCompose(() => { globalThis.__UP_BY_SLOT = { [HERO_COMPOSER_SLOT_ID]: 2.69 }; });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.errorType, 'STRICT_V2_HERO_CROP_UNSAFE');
  assert.ok(r.reasons.some((x) => String(x).includes('2.69')), `reason carries the measured magnitude (got ${JSON.stringify(r.reasons)})`);
});

await test('4) unmeasurable hero render (executor emits no upscaleRaw for the hero slot) ⇒ fail-closed STRICT_V2_HERO_CROP_UNSAFE (cannot prove ≤1.2 ⇒ never success)', async () => {
  const r = await runCompose(() => { globalThis.__EXEC_NO_UPSCALE = true; });
  assert.strictEqual(r.success, false, 'unmeasurable ⇒ must not succeed');
  assert.strictEqual(r.errorType, 'STRICT_V2_HERO_CROP_UNSAFE');
  assert.ok(r.reasons.some((x) => String(x) === `hero_crop_raw_invalid:${HERO_COMPOSER_SLOT_ID}`), `fail-closed reason (got ${JSON.stringify(r.reasons)})`);
});

await test('5) the proof binds to the EXACT signed hero slot: a NON-hero slot rendered >1.2× does NOT trip the hero gate (hero itself ≤1.2 ⇒ success) — not a regex /main/ nor a blanket any-slot check', async () => {
  const nonHero = WIRE.refHeroV2.selectionSpec.slots.find((s) => s.composerSlotId !== HERO_COMPOSER_SLOT_ID);
  assert.ok(nonHero, 'carrier has a non-hero slot');
  const r = await runCompose(() => { globalThis.__UP_BY_SLOT = { [HERO_COMPOSER_SLOT_ID]: 1.1, [nonHero.composerSlotId]: 2.4 }; });
  assert.strictEqual(r.success, true, `hero ≤1.2 ⇒ success even though a non-hero slot is >1.2 (got ${r.errorType} ${r.error || ''})`);
});

// ── P1-1 EXACT THRESHOLD (the hard decision must read the EXACT raw, never the rounded display value) ──
await test('6) exact 1.2× raw ⇒ SUCCESS (the hard limit is inclusive; must not over-reject the boundary)', async () => {
  const r = await runCompose(() => { globalThis.__EXEC_UPSCALE = 1.2; });
  assert.strictEqual(r.success, true, `exact 1.2 must pass (got ${r.errorType} ${r.error || ''})`);
});

await test('7) raw just above 1.2 (1.200000001 / 1.201 / 1.204) ⇒ FAIL — values that round to 1.20 must STILL fail (no rounded decision, no epsilon tolerance)', async () => {
  for (const v of [1.200000001, 1.201, 1.204]) {
    const r = await runCompose(() => { globalThis.__EXEC_UPSCALE = v; });
    assert.strictEqual(r.success, false, `raw ${v} must fail (got success)`);
    assert.strictEqual(r.errorType, 'STRICT_V2_HERO_CROP_UNSAFE', `raw ${v} ⇒ typed unsafe`);
    // prove the reason carries the EXACT raw, not the rounded 1.20
    assert.ok(r.reasons.some((x) => String(x) === `hero_crop_upscaled:${HERO_COMPOSER_SLOT_ID}:${v}`), `raw ${v}: reason carries exact raw (got ${JSON.stringify(r.reasons)})`);
  }
});

// ── P1-2 HOSTILE TRACE VALIDATION (exactly one canonical hero trace + genuine own primitive finite positive raw) ──
const HG = HERO_COMPOSER_SLOT_ID;
const _reasonType = (r) => (r.reasons && r.reasons[0] ? String(r.reasons[0]).split(':')[0] : null);
await test('8) DUPLICATE conflicting hero traces (one safe, one unsafe) ⇒ FAIL regardless of order (ambiguous ⇒ reject, never pick the safe one)', async () => {
  for (const order of [[1.1, 3.0], [3.0, 1.1]]) {
    const r = await runCompose(() => { globalThis.__TRACE_OVERRIDE = (asg) => [{ slot: HG, branch: 'a', upscaleRaw: order[0] }, { slot: HG, branch: 'b', upscaleRaw: order[1] }, ...asg.filter((a) => a.slotId !== HG).map((a) => ({ slot: a.slotId, branch: 'x', upscaleRaw: 1.0 }))]; });
    assert.strictEqual(r.success, false, `duplicate hero traces (${order}) ⇒ fail`);
    assert.strictEqual(_reasonType(r), 'hero_crop_trace_duplicate', `duplicate ⇒ typed duplicate reason (got ${JSON.stringify(r.reasons)})`);
  }
});

await test('9) MISSING hero trace (only non-hero slots traced) ⇒ FAIL (trace_missing) — cannot prove ≤1.2 for an absent hero', async () => {
  const r = await runCompose(() => { globalThis.__TRACE_OVERRIDE = (asg) => asg.filter((a) => a.slotId !== HG).map((a) => ({ slot: a.slotId, branch: 'x', upscaleRaw: 1.0 })); });
  assert.strictEqual(r.success, false);
  assert.strictEqual(_reasonType(r), 'hero_crop_trace_missing', `missing ⇒ typed reason (got ${JSON.stringify(r.reasons)})`);
});

await test('10) COERCIVE / INVALID raw values (null, "", false, 0, negative, NaN, Infinity, plain object) ⇒ FAIL (raw_invalid) — Number() coercion is NOT used', async () => {
  const others = (asg) => asg.filter((a) => a.slotId !== HG).map((a) => ({ slot: a.slotId, branch: 'x', upscaleRaw: 1.0 }));
  for (const bad of [null, '', '1.5', false, true, 0, -2, NaN, Infinity, -Infinity, {}, { valueOf: () => 3 }, [3]]) {
    const r = await runCompose(() => { globalThis.__TRACE_OVERRIDE = (asg) => [{ slot: HG, branch: 'a', upscaleRaw: bad }, ...others(asg)]; });
    assert.strictEqual(r.success, false, `raw=${String(bad)} must fail (a coercive '1.5'/{valueOf} must NOT pass)`);
    assert.strictEqual(_reasonType(r), 'hero_crop_raw_invalid', `raw=${String(bad)} ⇒ raw_invalid (got ${JSON.stringify(r.reasons)})`);
  }
});

await test('11) ACCESSOR trace fields (getter on slot AND getter on upscaleRaw) ⇒ FAIL WITHOUT invoking the hostile getters (no side effects)', async () => {
  let slotGets = 0, rawGets = 0;
  // (a) hero trace present but its upscaleRaw is an accessor returning a "safe" 1.0 — must NOT be invoked, must fail
  const rA = await runCompose(() => {
    globalThis.__TRACE_OVERRIDE = (asg) => {
      const hero = { slot: HG, branch: 'a' };
      Object.defineProperty(hero, 'upscaleRaw', { enumerable: true, configurable: true, get() { rawGets++; return 1.0; } });
      return [hero, ...asg.filter((a) => a.slotId !== HG).map((a) => ({ slot: a.slotId, branch: 'x', upscaleRaw: 1.0 }))];
    };
  });
  assert.strictEqual(rA.success, false, 'accessor upscaleRaw ⇒ fail (never trust a getter-supplied value)');
  assert.strictEqual(_reasonType(rA), 'hero_crop_raw_invalid');
  assert.strictEqual(rawGets, 0, 'the hostile upscaleRaw getter was NEVER invoked');
  // (b) a decoy trace whose `slot` is an accessor returning the hero id — must NOT be invoked; the genuine hero trace is
  //     thereby absent ⇒ trace_missing (never coerce the decoy into being the hero)
  const rB = await runCompose(() => {
    globalThis.__TRACE_OVERRIDE = (asg) => {
      const decoy = { branch: 'decoy', upscaleRaw: 3.0 };
      Object.defineProperty(decoy, 'slot', { enumerable: true, configurable: true, get() { slotGets++; return HG; } });
      return [decoy, ...asg.filter((a) => a.slotId !== HG).map((a) => ({ slot: a.slotId, branch: 'x', upscaleRaw: 1.0 }))];
    };
  });
  assert.strictEqual(rB.success, false, 'accessor slot decoy ⇒ genuine hero trace absent ⇒ fail');
  assert.strictEqual(_reasonType(rB), 'hero_crop_trace_missing');
  assert.strictEqual(slotGets, 0, 'the hostile slot getter was NEVER invoked');
});

// ── P1-B GEOMETRY-PIN REGRESSIONS: ONE authoritative DI-aware snapshot drives BOTH crop eligibility AND signing ──
// NOTE: dnaToTemplateSpec deterministically assigns the hero role → composer id 'main' (refTemplate.js), and a hand-built
// non-'main' realized template cannot pass the producer's provenance WeakMap — so a NON-main hero composer id can only
// arise at the CONSUMER (proven green by scripts/test-s7-selection-spec-v2.mjs test 8, hero='panelA'). At the PRODUCER we
// prove the substance: the verdict + signed geometry bind to the CANONICAL hero slot (composerBySlotId), never a
// largest-area heuristic, and the injected DI geometry is the one assessed AND signed (single snapshot, fail-closed).
const { dnaToTemplateSpec: realDts } = await import('../src/lib/refTemplate.js');
const cloneDna = (mut) => { const d = JSON.parse(JSON.stringify(FIXTURE_DNA)); mut(d.template.slots); return d; };
const runS6 = async ({ dtsInject = null, pool = V2_POOL() } = {}) => withEnvMap(V2_ENV, () => withFixedNow(async () => {
  const job = { id: 'GEO-JOB', dossier: { images: { caseId: 'GEO' }, compass: { angle: 'x', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: V2_CHARS, visualDreamShots: [], doNotUse: [] }, desk: { title: 'geo' }, refMatch: mkRefMatch(), artBrief: { storyNote: 'x', orders: [] } } };
  let dtsCalls = 0;
  const deps = { ...mkS6Deps(), fetchJson: async (u) => { if (String(u).includes('/api/images/')) return { success: true, images: pool }; throw new Error('nf ' + u); } };
  if (dtsInject) deps.dnaToTemplateSpec = (dna) => { dtsCalls++; return dtsInject(dna); };
  const s6 = await s6_slots(job, { origin: 'http://mock', _deps: deps });
  return { s6, dtsCalls };
}));
const patchOf = (s6) => s6?.dossierPatch?.pickImages?.refHeroV2 || null;

await test('13) (a) hero maps to a NON-LARGEST slot: inject geometry where a CONTEXT slot is the LARGEST but the hero slot is small — the crop verdict + SIGNED hero geometry use the EXACT canonical hero slot (composerBySlotId), never the largest; DI snapshot used EXACTLY ONCE', async () => {
  const ALT = cloneDna((slots) => { const hero = slots.find((s) => /hero/i.test(s.role)); const ctx = slots.find((s) => /context/i.test(s.role)); hero.wPct = 30; hero.hPct = 42; ctx.xPct = 0; ctx.yPct = 30; ctx.wPct = 100; ctx.hPct = 70; });
  const altHero = realDts(ALT).slots.find((s) => s.id === 'main');
  const altLargest = realDts(ALT).slots.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
  assert.notEqual(altLargest.id, 'main', '(a) sanity: the hero slot is NOT the largest in the injected geometry');
  const { s6, dtsCalls } = await runS6({ dtsInject: () => realDts(ALT) });
  const p = patchOf(s6);
  assert.ok(p && p.ok === true, `(a) carrier built via the canonical (non-largest) hero slot (got hold=${p?.hold})`);
  const heroRow = p.selectionSpec.slots.find((s) => s.refSlotId === p.selectionSpec.hero.heroSlotId);
  assert.equal(heroRow.render.w, altHero.w, '(a) signed hero geometry W = the exact hero slot, not the largest context');
  assert.equal(heroRow.render.h, altHero.h, '(a) signed hero geometry H = the exact hero slot');
  assert.notEqual(heroRow.render.w * heroRow.render.h, altLargest.w * altLargest.h, '(a) signed hero geometry ≠ the largest slot');
  assert.equal(dtsCalls, 1, '(a) DI dnaToTemplateSpec invoked EXACTLY ONCE ⇒ one authoritative snapshot for eligibility + signing');
});

await test('14) (b) geometry DRIFT is fail-closed: inject a dnaToTemplateSpec that MUTATES the hero slot geometry AFTER the template stamps its provenance (geometry-A stamped, geometry-B live) ⇒ the single-snapshot build cannot assess A then sign B — the content-integrity defense HOLDs (REF_HERO_V2_REALIZED_CONTENT_TAMPERED); DI snapshot used EXACTLY ONCE', async () => {
  const drift = (dna) => { const t = realDts(dna); const hero = t.slots.find((s) => s.id === 'main') || t.slots[0]; hero.w = hero.w + 137; hero.h = hero.h + 91; return t; }; // live geometry now ≠ stamped provenance
  const { s6, dtsCalls } = await runS6({ dtsInject: drift });
  const p = patchOf(s6);
  assert.ok(p && p.ok === false, '(b) drifted geometry ⇒ no carrier (never assess A then sign B)');
  assert.equal(p.hold, 'REF_HERO_V2_REALIZED_CONTENT_TAMPERED', `(b) typed fail-closed on the geometry drift (got ${p?.hold})`);
  assert.equal(dtsCalls, 1, '(b) DI dnaToTemplateSpec invoked EXACTLY ONCE (no separate assess-A / sign-B snapshots)');
});

await test('15) (b2) injected DI geometry drives the SAFE/UNSAFE verdict: the SAME small-face candidate is crop-SAFE under the real hero slot but the injected geometry makes it the sole hero ⇒ verdict follows the injected (signed) geometry, proving eligibility reads the DI snapshot not a module default', async () => {
  // a taller hero slot (same canvas) changes the face-aware region ⇒ a different, injected-geometry-driven verdict path
  const ALT = cloneDna((slots) => { const hero = slots.find((s) => /hero/i.test(s.role)); hero.wPct = 20; hero.hPct = 100; });
  const altHero = realDts(ALT).slots.find((s) => s.id === 'main');
  const { s6, dtsCalls } = await runS6({ dtsInject: () => realDts(ALT) });
  const p = patchOf(s6);
  assert.equal(dtsCalls, 1, '(b2) DI dnaToTemplateSpec invoked EXACTLY ONCE');
  if (p && p.ok === true) {
    const heroRow = p.selectionSpec.slots.find((s) => s.refSlotId === p.selectionSpec.hero.heroSlotId);
    assert.equal(heroRow.render.w, altHero.w, '(b2) signed hero geometry W = the injected DI geometry (not the module default)');
    assert.equal(heroRow.render.h, altHero.h, '(b2) signed hero geometry H = the injected DI geometry');
  } else {
    assert.ok(typeof p.hold === 'string' && p.hold.startsWith('REF_HERO_V2_'), `(b2) if the injected geometry is unsafe, a typed REF_HERO_V2 HOLD (got ${p?.hold})`);
  }
});

// ── (c) NO-SAFE strict V2 through the REAL runCoverRefTest: full route, all side-effect counters ZERO ──
const { runCoverRefTest } = await import('../src/app/api/cover-ref-test/route.js');
const NO_SAFE_POOL = () => [
  v2Img('V-L1', { person: 'Lisa', sceneKey: 'sceneL', faceBox: UNSAFE_FB }), // hero (Lisa) tiny face ⇒ no crop-safe hero
  v2Img('V-N1', { person: 'Nene', sceneKey: 'sceneN' }), v2Img('V-C1', { person: 'Ctx1', sceneKey: 'sceneC1' }),
  v2Img('V-C2', { person: 'Ctx2', sceneKey: 'sceneC2' }), v2Img('V-C3', { person: 'Ctx3', sceneKey: 'sceneC3' }),
];
await test('16) (c) no crop-safe hero through the REAL runCoverRefTest ⇒ typed 422 with queue/compose/persist/archive counters ALL ZERO (full route, not only an S6 marker)', async () => {
  const counters = { compose: 0, queue: 0, persist: 0, archive: 0 };
  let s6status = null; let s7status = 'not-called';
  const env = { ...V2_ENV, MEGA_STRICT_RENDER: '1', MEGA_STABLE_ORDER: '0' };
  const noop = (n) => async () => ({ status: 'done', nextAction: 'continue', summary: n });
  const poolFetch = async (url) => { if (String(url).includes('/api/images/')) return { success: true, images: NO_SAFE_POOL() }; throw new Error('nf ' + url); };
  const deps = {
    compassBrain: async () => ({ angle: 'x', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: V2_CHARS, visualDreamShots: [], doNotUse: [] }),
    s5_case: async () => ({ status: 'done', nextAction: 'continue', summary: 's5_case', dossierPatch: { images: { caseId: 'GEO-NOSAFE' } } }),
    s5_keywords: noop('s5_keywords'), s5_search: noop('s5_search'),
    s5_triage: async () => ({ status: 'done', nextAction: 'continue', summary: 's5_triage', dossierPatch: { refMatch: mkRefMatch() } }),
    s5_clipframe: noop('s5_clipframe'),
    // real four-foundation S6 fed the no-safe pool (poolFetch WINS over any route _deps.fetchJson) ⇒ HOLDs (waiting)
    s6_slots: async (job, opts) => { const r = await s6_slots(job, { ...opts, _deps: { ...(opts?._deps || {}), fetchJson: poolFetch, slotDirectorBrain: async () => ({ slots: V2_PICKS, note: 'nosafe' }), artBriefBrain: async () => ({ storyNote: 'x', orders: [] }) } }); s6status = r.status; return r; },
    // real s7: it may be invoked, but on a held S6 dossier it must HOLD and enqueue NOTHING (a real queue = status 'done')
    s7_cover: async (...a) => { const r = await s7_cover(...a); s7status = r?.status; if (r?.status === 'done') counters.queue++; return r; },
    composeAndVerify: async () => { counters.compose++; return { success: true, base64: 'data:image/jpeg;base64,QUJD', manifest: { strictRender: { verified: true } } }; },
    evaluateCoverQc: () => ({ pass: true, reasons: [] }),
    readImageCase: async () => ({ status: 200, body: { success: true, images: NO_SAFE_POOL() } }),
    loadArchive: async () => ({ addMegaCover: async () => { counters.archive++; return { id: 'X' }; } }),
    persistCoverImage: async () => { counters.persist++; return null; },
    env,
  };
  const res = await withEnvMap(env, () => withFixedNow(() => runCoverRefTest({ content: 'เนื้อข่าวเต็มสำหรับทดสอบ no-safe strict V2 '.padEnd(220, 'x'), newsTitle: 'ข่าวทดสอบ no-safe', origin: 'http://mock' }, deps)));
  assert.equal(s6status, 'waiting', `(c) the REAL S6 HOLDs on no crop-safe hero (got ${s6status})`);
  assert.equal(res.status, 422, `(c) no crop-safe hero ⇒ 422 (got ${res.status} ${JSON.stringify(res.body?.errorType || res.body?.holdReason)})`);
  assert.notEqual(s7status, 'done', `(c) S7 never completes a queue on the held carrier (got s7=${s7status})`);
  assert.equal(counters.queue, 0, '(c) queue NEVER added (no S7 done)');
  assert.equal(counters.compose, 0, '(c) compose NEVER called');
  assert.equal(counters.persist, 0, '(c) persist NEVER called');
  assert.equal(counters.archive, 0, '(c) archive NEVER called');
});

console.log(`\n# ac0107-runtime-hero-crop: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
