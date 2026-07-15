// ============================================================
// candidate-crop-readiness-bridge.test.mjs — B3 SHADOW bridge (megaAdapters)
// ------------------------------------------------------------
// Verifies `_buildCropReadinessEvidenceV1` — the megaAdapters evidence bridge that
// assembles a candidateCropReadiness request from VALIDATED evidence only (realized
// template geometry + vetted factsById universe + a genuine 'full_vetted_v1' proof) and
// calls the PURE INDEPENDENT_READINESS_V1 producer. Coverage:
//   • measured-real: full res + faceBox + slot-role match → REAL per-slot cropSafe
//     true/false driven purely by geometry (upscale / positional containment)
//   • structural eligibility is NON-CIRCULAR: a candidate carrying ONLY facts (no
//     identity / no cast eligibility) still yields a real geometric verdict (proof that
//     eligibility = structural pool-role enrollment, never identity/cropSafe)
//   • UNEVALUATED: thumb / unknown-level dims (untrusted) or missing faceBox → cells
//     WITHOUT a boolean cropSafe (never fabricated)
//   • broken → null SILENTLY (no throw, no HOLD): absent authority, empty universe, null
//     refDNA, null/invalid realized template, non-integer geometry, throwing spec,
//     missing producer api
//   • detached / deep-frozen result; proof is genuine (measurementReady only with a
//     proven-complete universe)
//   • flag-OFF & quarantine byte-parity (source guard): the bridge call is gated by
//     MEGA_REF_HERO_V2 and the _rhCastCandidate quarantine still hardcodes cropSafe:false
// Offline: real candidateCropReadiness (pure, no imports); refTemplate injected via deps.
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

// ---------- loader stubs (mirror candidate-metric-authority harness) — before importing megaAdapters ----------
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const AI_STUB = _mod('export function callBrain(){ throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
const STUB_IMAGESEARCH = _mod(`
export const PLATFORMS = ['google','google_news','facebook','tiktok','youtube'];
export function buildQueries(){ return ['q1','q2']; }
export async function searchImages(){ return { images: [] }; }
export async function instagramProfile(){ return { images: [] }; }
export async function facebookProfile(){ return { images: [] }; }
`);
const STUB_TRIAGE = _mod('export async function vetImages(a){ return a; }');
const STUB_STORE = _mod(`
export async function addImages(){ return { success: true }; }
export async function readImages(){ return []; }
export async function buildImagesRouteResponse(){ return {}; }
`);
const STUB_CASE = _mod('export async function getCase(){ return {}; }');
const STUB_JUNK = _mod(`
export function isCatalogSource(){ return false; }
export function isOwnPageSource(){ return false; }
export function isMismatchedFbMedia(){ return false; }
`);
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, status: (init && init.status) || 200, json: async () => obj }) };');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/imageSearch') return { url: ${JSON.stringify(STUB_IMAGESEARCH)}, shortCircuit: true };
  if (specifier === '@/lib/libraryTriage') return { url: ${JSON.stringify(STUB_TRIAGE)}, shortCircuit: true };
  if (specifier === '@/lib/imageStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/caseStore') return { url: ${JSON.stringify(STUB_CASE)}, shortCircuit: true };
  if (specifier === '@/lib/junkSources') return { url: ${JSON.stringify(STUB_JUNK)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { _buildCropReadinessEvidenceV1 } = await import('../src/lib/megaAdapters.js');
const CR = await import('../src/lib/candidateCropReadiness.js'); // real, pure producer (no imports)

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}`); console.error(String((e && e.stack) || e)); }
};

// ---------- fixtures ----------
// candidate_facts_v1 shape exactly as _rhReadFactsDetached produces (detached facts).
const facts = (level, w, h, faceBox) => ({
  scope: 'candidate_facts_v1', version: 1, producer: 'LIBRARY_TRIAGE_CANDIDATE_FACTS_V1',
  verdicts: { relevant: true },
  resolution: level === 'unknown' ? { level: 'unknown', width: null, height: null } : { level, width: w, height: h },
  faceBox, // {x1,y1,x2,y2} | null | 'unknown'
  hash: 'unknown',
});
// realized template (1080×1350): main=hero rect, support_1=support rect, circle=circle.
const SLOTS = [
  { id: 'main', x: 40, y: 100, w: 600, h: 1000 },
  { id: 'support_1', x: 700, y: 100, w: 300, h: 400 },
  { id: 'circle', shape: 'circle', x: 700, y: 600, w: 300, h: 300 },
];
const rt = (slots) => ({ dnaToTemplateSpec: () => ({ id: 'ref_dna', canvasW: 1080, canvasH: 1350, slots }) });
const depsWith = (slots) => ({ cropReadinessApi: CR, refTemplateApi: rt(slots) });
const REF = { template: { slots: [] } }; // any truthy refDNA (stub ignores it)
const mapOf = (entries) => new Map(entries);

// ============================================================
// 1) MEASURED-REAL — geometry-driven per-slot cropSafe true AND false
// ============================================================
await test('1a: full res + centered face → SAFE hero; low res → UNSAFE hero (geometry only)', async () => {
  const fb = { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 };
  const factsById = mapOf([
    ['A', facts('full', 1000, 1000, fb)],       // hero SAFE (up=1.0, shortSide 1000)
    ['B', facts('full', 400, 400, { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 })], // hero UNSAFE (up=2.5>1.2)
  ]);
  const r = await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps: depsWith(SLOTS) });
  assert.ok(r && r.ok === true, 'ok result');
  assert.equal(r.measurementReady, true);
  assert.equal(r.universeComplete, true);
  assert.equal(r.producer, 'INDEPENDENT_READINESS_V1');
  assert.ok(r.summary.cells.safe >= 1, 'at least one SAFE cell');
  assert.ok(r.summary.cells.unsafe >= 1, 'at least one UNSAFE cell');
  // hero role feed preserves candidate order A,B
  const hero = r.feed.roles.hero.candidates;
  assert.equal(hero[0].slotCrops[0].cropSafe, true, 'A hero SAFE');
  assert.equal(hero[1].slotCrops[0].cropSafe, false, 'B hero UNSAFE (upscale)');
  // observed universe = demandedRoles(3) × universe(2) = 6 crop cells (1 slot per role)
  assert.equal(r.summary.cropCells, 6);
});

await test('1b: structural eligibility is NON-CIRCULAR — facts-only candidate (no identity) still gets a real verdict', async () => {
  // candidate carries ONLY facts — no identity / no cast eligibility / no cropSafe input.
  const factsById = mapOf([['A', facts('full', 1000, 1000, { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 })]]);
  const r = await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps: depsWith(SLOTS) });
  assert.ok(r && r.ok === true);
  // a boolean cropSafe means eligibility was KNOWN+true (structural enrollment) and geometry decided it —
  // if eligibility had been derived from (absent) identity, this would be UNEVALUATED instead.
  assert.equal(r.feed.roles.hero.candidates[0].slotCrops[0].cropSafe, true);
  assert.equal(r.summary.cells.unevaluated, 0, 'no identity-driven UNEVALUATED');
  assert.equal(r.summary.cells.unsafe, 0, 'no identity-driven UNSAFE — all geometry passed');
});

await test('1c: result is detached + deep-frozen', async () => {
  const factsById = mapOf([['A', facts('full', 1000, 1000, { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 })]]);
  const r = await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps: depsWith(SLOTS) });
  assert.ok(Object.isFrozen(r), 'result frozen');
  assert.ok(Object.isFrozen(r.feed), 'feed frozen');
  assert.ok(Object.isFrozen(r.summary), 'summary frozen');
});

// ============================================================
// 2) UNEVALUATED — untrusted dims / missing box → no boolean cropSafe (never fabricated)
// ============================================================
await test('2a: thumb-level dims are UNTRUSTED → UNEVALUATED (row without cropSafe)', async () => {
  const factsById = mapOf([['T', facts('thumb', 2000, 2000, { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 })]]);
  const r = await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps: depsWith(SLOTS) });
  assert.ok(r && r.ok === true, 'universe still proven → ok');
  assert.equal(r.summary.cells.safe, 0);
  assert.equal(r.summary.cells.unsafe, 0);
  assert.equal(r.summary.cells.unevaluated, 3, 'all 3 cells UNEVALUATED');
  const row = r.feed.roles.hero.candidates[0].slotCrops[0];
  assert.ok(!('cropSafe' in row), 'no boolean cropSafe on an UNEVALUATED row');
});

await test('2b: unknown-level dims → UNEVALUATED', async () => {
  const factsById = mapOf([['U', facts('unknown', null, null, { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 })]]);
  const r = await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps: depsWith(SLOTS) });
  assert.ok(r && r.ok === true);
  assert.equal(r.summary.cells.unevaluated, 3);
});

await test('2c: missing/confirmed-absent faceBox (no subjectBox) → UNEVALUATED', async () => {
  const factsById = mapOf([
    ['N1', facts('full', 1000, 1000, 'unknown')], // box unknown
    ['N2', facts('full', 1000, 1000, null)],        // confirmed no face
  ]);
  const r = await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps: depsWith(SLOTS) });
  assert.ok(r && r.ok === true);
  assert.equal(r.summary.cells.safe, 0);
  assert.equal(r.summary.cells.unsafe, 0);
  assert.equal(r.summary.cells.unevaluated, 6, 'both candidates × 3 roles UNEVALUATED');
});

// ============================================================
// 3) BROKEN → null SILENTLY (no throw, no HOLD)
// ============================================================
await test('3a: absent authority (factsById null) → null', async () => {
  assert.equal(await _buildCropReadinessEvidenceV1({ factsById: null, refDNA: REF, deps: depsWith(SLOTS) }), null);
});
await test('3b: empty universe (factsById size 0) → null', async () => {
  assert.equal(await _buildCropReadinessEvidenceV1({ factsById: new Map(), refDNA: REF, deps: depsWith(SLOTS) }), null);
});
await test('3c: null refDNA → null', async () => {
  const factsById = mapOf([['A', facts('full', 1000, 1000, { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 })]]);
  assert.equal(await _buildCropReadinessEvidenceV1({ factsById, refDNA: null, deps: depsWith(SLOTS) }), null);
});
await test('3d: realized template null → null', async () => {
  const factsById = mapOf([['A', facts('full', 1000, 1000, { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 })]]);
  const deps = { cropReadinessApi: CR, refTemplateApi: { dnaToTemplateSpec: () => null } };
  assert.equal(await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps }), null);
});
await test('3e: wrong canvas size → null', async () => {
  const factsById = mapOf([['A', facts('full', 1000, 1000, { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 })]]);
  const deps = { cropReadinessApi: CR, refTemplateApi: { dnaToTemplateSpec: () => ({ canvasW: 900, canvasH: 1200, slots: SLOTS }) } };
  assert.equal(await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps }), null);
});
await test('3f: non-integer slot geometry → null', async () => {
  const factsById = mapOf([['A', facts('full', 1000, 1000, { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 })]]);
  const bad = SLOTS.map((s, i) => (i === 0 ? { ...s, x: 40.5 } : s));
  assert.equal(await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps: depsWith(bad) }), null);
});
await test('3g: dnaToTemplateSpec throws → null (no propagation)', async () => {
  const factsById = mapOf([['A', facts('full', 1000, 1000, { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 })]]);
  const deps = { cropReadinessApi: CR, refTemplateApi: { dnaToTemplateSpec: () => { throw new Error('boom'); } } };
  assert.equal(await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps }), null);
});
await test('3h: producer api missing → null', async () => {
  const factsById = mapOf([['A', facts('full', 1000, 1000, { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 })]]);
  const deps = { cropReadinessApi: {}, refTemplateApi: rt(SLOTS) };
  assert.equal(await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps }), null);
});
await test('3i: duplicate slot id → null', async () => {
  const factsById = mapOf([['A', facts('full', 1000, 1000, { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 })]]);
  const dup = [SLOTS[0], { ...SLOTS[1], id: 'main' }, SLOTS[2]];
  assert.equal(await _buildCropReadinessEvidenceV1({ factsById, refDNA: REF, deps: depsWith(dup) }), null);
});

// ============================================================
// 4) FLAG-OFF & QUARANTINE byte-parity (source guard)
// ============================================================
await test('4a: bridge call is gated by MEGA_REF_HERO_V2 & quarantine still hardcodes cropSafe:false', () => {
  const src = fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  // exactly one CALL site (distinct from the exported definition)
  const calls = src.match(/await _buildCropReadinessEvidenceV1\(/g) || [];
  assert.equal(calls.length, 1, 'exactly one bridge call site');
  // the call site sits AFTER the last `if (_refHeroV2On)` gate → flag OFF skips it entirely
  const lastGate = src.lastIndexOf('if (_refHeroV2On)');
  const callAt = src.indexOf('await _buildCropReadinessEvidenceV1(');
  assert.ok(lastGate !== -1 && callAt > lastGate, 'call is inside the flag-gated bridge block');
  // authorityEvidence carries the new detached key
  assert.ok(/cropReadiness: _rhCropReadiness/.test(src), 'authorityEvidence.cropReadiness wired');
  // quarantine unchanged: _rhCastCandidate still returns cropSafe:false (byte-parity behavior)
  const castStart = src.indexOf('function _rhCastCandidate(');
  const castEnd = src.indexOf('function _rhHeroCandidate(');
  assert.ok(castStart !== -1 && castEnd > castStart);
  assert.ok(/cropSafe: false/.test(src.slice(castStart, castEnd)), '_rhCastCandidate keeps cropSafe:false');
});

console.log(`\n# ${passed}/${passed + failed} passed`);
if (failed) { process.exitCode = 1; throw new Error(`${failed} test(s) failed`); }
