// ============================================================
// phase4-b6-unquarantine.test.mjs — B6 crown: consumer wiring of validated authority
// ------------------------------------------------------------
// B1-B5 built dormant shadow authority lanes (metricsById / cropReadiness / identityById /
// heroVisionById) but the S6 quarantine (_rhCastCandidate / _rhHeroCandidate) hardcoded
// cropSafe:false / identityVerified:false / hero metrics absent, so the whole ref-hero-v2
// flow could never leave its typed HOLDs. B6 SWITCHES THE READING: the two quarantine
// functions now elevate ONLY from the validated per-candidate authority carriers the caller
// resolves (never from raw record.triage). This suite drives the full stack through the REAL
// s6_slots + REAL castManifest / heroShotContract, injecting the authority producers via DI.
//
// Supreme invariant proven here:
//   • readiness/metric elevates ONLY from validated authority — absent lane = false/undefined/null
//     = the exact legacy HOLD; raw RAW_EXTREME triage can never elevate anything.
//   • With ALL authority present the flow clears cast + hero and reaches the FIRST remaining
//     frontier — REF_HERO_V2_GLOBAL_METRICS_UNAVAILABLE — because _rhGlobalCandidate stays
//     quarantined by design (semantic/quality/slotFit/sceneKey have no producer). Reaching that
//     exact code, with the cast seam observing eligible tuples and the hero evaluator ACCEPTING,
//     proves every upstream authority (crop + identity + hero-vision + metrics) is now consumed.
// Offline: real castManifest/heroShotContract/candidateFactAuthority; AI client is a bomb.
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const AI_BOMB = MOD('export async function callBrain(){ throw new Error("AI_FORBIDDEN_IN_B6"); }');
const NEXT_STUB = MOD('export const NextResponse = { json: (b, i) => ({ _body: b, status: i?.status || 200, json: async () => b }) };');

register(MOD([
  'export async function resolve(specifier, context, nextResolve) {',
  '  if (specifier === "@/lib/aiClient") return { url: ' + JSON.stringify(AI_BOMB) + ', shortCircuit: true };',
  '  if (specifier === "next/server") return { url: ' + JSON.stringify(NEXT_STUB) + ', shortCircuit: true };',
  '  if (specifier.startsWith("@/")) {',
  '    const mapped = new URL(specifier.slice(2) + (specifier.endsWith(".js") || specifier.endsWith(".mjs") ? "" : ".js"), ' + JSON.stringify(SRC_ROOT) + ').href;',
  '    return nextResolve(mapped, context);',
  '  }',
  '  return nextResolve(specifier, context);',
  '}',
].join('\n')));

const { s6_slots } = await import('../src/lib/megaAdapters.js');
const realCastApi = await import('../src/lib/castManifest.js');
const realHeroApi = await import('../src/lib/heroShotContract.js');
const { buildCandidateFactsV1 } = await import('../src/lib/candidateFactAuthority.js');
const { buildImagesRouteResponse } = await import('../src/lib/imageStore.js');

let passed = 0;
let failed = 0;
let assertions = 0;
const equal = (...a) => { assertions++; return assert.equal(...a); };
const deepEqual = (...a) => { assertions++; return assert.deepEqual(...a); };
const ok = (...a) => { assertions++; return assert.ok(...a); };
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('ok ' + (passed + failed) + ' - ' + name); }
  catch (e) { failed++; console.log('not ok ' + (passed + failed) + ' - ' + name + '\n  ' + String(e?.stack || e).split('\n').slice(0, 6).join('\n  ')); }
};

const refs = JSON.parse(readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
const ref = refs.find((r) => r.id === 'REF-mrbqalpo-h1r1');
if (!ref?.dna) throw new Error('B6 fixture requires the tracked reference DNA');

const CASE_ID = 'B6-UNQUARANTINE-CASE';
const HERO_ID = 'H1';
const HERO = 'Crown Hero';
const cloneJson = (v) => JSON.parse(JSON.stringify(v));
const HERO_PERSON_ID = realCastApi.computePersonId(realCastApi.normalizeCastName(HERO));

// Medium-shot default bands (heroShotContract, no reference): faceShare 0.08-0.20, headroom
// 0.08-0.25, target region half_body (±1). Face box chosen inside every band AND large enough
// (against the tall 540x1350 ref hero slot at full 1200x3000) to clear the AC-0107 hero crop
// prefilter (heroCropUpscale ≈ 0.94 ≤ 1.2). faceShare is normalized face HEIGHT (y2-y1=0.18).
const HERO_IMG_W = 1200;
const HERO_IMG_H = 3000;
const HERO_FACT_FACE = Object.freeze({ x: 0.35, y: 0.14, w: 0.30, h: 0.18 }); // → headroom .14, faceShare .18

// Deliberately attractive legacy values — raw triage must never elevate anything.
const RAW_EXTREME = Object.freeze({
  identityConfidence: 1, faceShare: 1, headroom: 0, visibleBodyRegion: 'full_body',
  occlusion: 0, edgeCut: 0, cleanliness: 1, faceCount: 1,
  semanticScore: 999999999, qualityScore: 999999999, slotFitScore: 999999999, sceneKey: 'raw-perfect',
});

function withEnv(patch, fn) {
  const base = {
    MEGA_REF_HERO_V2: '1', MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1',
    MEGA_STRICT_RENDER: '1', MEGA_HERO_GRADE_HARD: '0',
    MEGA_ROLE_READINESS: undefined, MEGA_FINAL_DECISION_EVIDENCE_V2: undefined,
  };
  const full = { ...base, ...patch };
  const prev = Object.fromEntries(Object.keys(full).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(full)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return (async () => { try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  } })();
}

function heroFacts() {
  return buildCandidateFactsV1({
    verdicts: { relevant: true, clean: true, newsScene: true },
    hash: { value: '0123456789abcdef', algo: 'dhash_9x8_v1', measuredFrom: 'full' },
    resolution: { decodedBuffer: true, provenance: 'full', width: HERO_IMG_W, height: HERO_IMG_H },
    faceBox: HERO_FACT_FACE,
  });
}

function makeRow() {
  return {
    id: HERO_ID, caseId: CASE_ID, platform: 'google',
    imageUrl: 'https://cdn.test/b6-' + HERO_ID + '.jpg', thumbnailUrl: '',
    source: 'bounded offline fixture', sourceLink: 'https://source.test/' + HERO_ID,
    width: 9000, height: 12000, realWidth: 9000, realHeight: 12000,
    triage: { relevant: true, clean: true, newsScene: true, person: HERO, persons: [HERO], faceCount: 1, ...RAW_EXTREME, candidateFacts: heroFacts() },
  };
}

function searchShadow() {
  return { version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false,
    candidates: [{ candidateId: HERO_ID, provider: 'google', queryIndex: 0, providerRank: 1 }] };
}

function makeJob() {
  return { id: 'B6-JOB', dossier: {
    images: { caseId: CASE_ID, searchStats: [{ platform: 'google', found: 1, added: 1, searchShadowV2: searchShadow() }] },
    compass: { angle: 'B6 crown fixture', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: [{ name: HERO, role: 'hero' }], visualDreamShots: [], doNotUse: [] },
    desk: { title: 'B6 crown fixture' },
    refMatch: { dna: ref.dna, styleName: 'fixture', typeMatched: true, imagePath: '/ref.jpg', refId: ref.id },
    artBrief: { storyNote: 'fixture', orders: [] },
  } };
}

async function baseResponse() {
  const rows = [makeRow()];
  const snapshot = { scope: 'case_image_store_snapshot_v1', caseId: CASE_ID, complete: true, truncated: false, count: rows.length, rows };
  const response = await buildImagesRouteResponse(CASE_ID, '1', { readImagesSnapshot: async () => snapshot });
  equal(response.status, 200);
  equal(response.body.success, true);
  return cloneJson(response);
}

// ---- authority producer DI doubles (each independently switchable to model an absent lane) ----
function metricAuthorityDouble({ faceCount = 1, edgeCut = 0.03, cropSafe = true } = {}) {
  return { validateCandidateMetricsSnapshotV1: () => ({
    ok: true, caseId: CASE_ID,
    metricsById: new Map([[HERO_ID, { measurements: { faceCount, edgeCut, ...(cropSafe ? { cropSafeBySlot: { main: true } } : {}) } }]]),
  }) };
}
function identityDouble({ verified = true, confidence = 0.95 } = {}) {
  return {
    identityReferenceResolver: ({ sourceAssetId }) => ({ candidate: { id: sourceAssetId }, claimedPerson: { personId: HERO_PERSON_ID }, referenceEvidence: { personId: HERO_PERSON_ID, provenance: 'story_verified_reference', referenceHash: 'rh' } }),
    identityVerifierApi: { _resetIdentityRound() {}, measureCandidateIdentity: async () => ({ identityConfidence: confidence, identityVerified: verified }) },
  };
}
function heroVisionDouble({ occlusion = 0.05, cleanliness = 0.92, visibleBodyRegion = 'half_body' } = {}) {
  return {
    heroImageResolver: ({ sourceAssetId }) => ({ candidate: { id: sourceAssetId } }),
    heroVisionApi: { _resetHeroVisionRound() {}, measureHeroVision: async () => ({ occlusion, cleanliness, visibleBodyRegion }) },
  };
}

// Assemble a deps bundle + response. Any lane can be dropped to model an absent authority.
async function makeRun({ metrics = {}, identity = {}, heroVision = {}, withMetrics = true, withIdentity = true, withHeroVision = true, env = {}, extraDeps = {} } = {}) {
  const response = await baseResponse();
  if (withMetrics) response.body.candidateMetrics = { present: true }; // truthy carrier → bridge validates via injected api
  const castInputs = [];
  const heroEvals = [];
  const castApi = { ...realCastApi,
    buildCastManifest(input) { castInputs.push(cloneJson(input)); return realCastApi.buildCastManifest(input); } };
  const heroApi = { ...realHeroApi,
    evaluateHeroShotCandidate(...args) { const v = realHeroApi.evaluateHeroShotCandidate(...args); heroEvals.push(v); return v; } };
  const _deps = {
    readImagesAuthority: async () => response,
    castApi, heroApi,
    ...(withMetrics ? { metricAuthorityApi: metricAuthorityDouble(metrics) } : {}),
    ...(withIdentity ? identityDouble(identity) : {}),
    ...(withHeroVision ? heroVisionDouble(heroVision) : {}),
    ...extraDeps,
  };
  const s6 = await withEnv(env, () => s6_slots(makeJob(), { origin: 'http://b6.test', _deps }));
  return { s6, castInputs, heroEvals };
}

const hold = (run) => run.s6.dossierPatch?.pickImages?.refHeroV2?.hold;
const castRow = (run) => run.castInputs[0]?.candidates?.find((c) => c.candidateId === HERO_ID);

// ============================================================
// 1) CROWN — full authority clears cast + hero; reaches the global frontier
// ============================================================
await test('all validated authority present → cast eligible + hero ACCEPTED → deepest reachable hold GLOBAL_METRICS_UNAVAILABLE', async () => {
  const run = await makeRun();
  equal(run.s6.status, 'waiting', 'still a typed HOLD (global frontier), not a crash');
  equal(hold(run), 'REF_HERO_V2_GLOBAL_METRICS_UNAVAILABLE', 'cast + hero fully cleared; only the still-quarantined global producer holds');
  // cast seam observed the candidate elevated on validated authority
  const c = castRow(run);
  ok(c, 'cast seam observed the hero candidate');
  deepEqual({ searched: c.searched, triaged: c.triaged, clean: c.clean, highResolution: c.highResolution, cropSafe: c.cropSafe, identityVerified: c.identityVerified }, {
    searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
  }, 'every readiness bit elevated from validated authority (crop via metrics, identity via verifier)');
  // hero evaluator was reached AND accepted (proves hero-vision + metrics + identity all consumed)
  ok(run.heroEvals.length >= 1, 'hero evaluator ran');
  ok(run.heroEvals.some((v) => v.accepted === true), 'a hero candidate was ACCEPTED from validated hero metrics');
});

// ============================================================
// 2) PARTIAL — a single missing lane drops to the exact legacy HOLD
// ============================================================
await test('missing identity lane → cast identityVerified false → INSUFFICIENT_CAST_ASSETS', async () => {
  const run = await makeRun({ withIdentity: false });
  equal(hold(run), 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS');
  equal(castRow(run).identityVerified, false, 'no identity authority ⇒ unverified');
  equal(castRow(run).cropSafe, true, 'crop authority still elevated independently');
});

await test('missing crop authority (no cropSafeBySlot) → cast ineligible → INSUFFICIENT_CAST_ASSETS', async () => {
  const run = await makeRun({ metrics: { cropSafe: false } });
  equal(hold(run), 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS');
  equal(castRow(run).cropSafe, false, 'no SAFE slot in metrics ⇒ not crop-safe');
  equal(castRow(run).identityVerified, true, 'identity authority still elevated independently');
});

await test('cast clears but hero-vision lane missing → HERO_METRICS_UNAVAILABLE', async () => {
  const run = await makeRun({ withHeroVision: false });
  equal(hold(run), 'REF_HERO_V2_HERO_METRICS_UNAVAILABLE', 'cast eligible, but occlusion/cleanliness/visibleBodyRegion absent ⇒ no complete hero metric object');
  equal(castRow(run).cropSafe, true);
  equal(castRow(run).identityVerified, true);
});

await test('cast clears but metrics lane missing → no faceCount/edgeCut AND no crop → INSUFFICIENT_CAST_ASSETS', async () => {
  // metrics carrier drives BOTH cast cropSafe and hero faceCount/edgeCut; dropping it fails cast first.
  const run = await makeRun({ withMetrics: false });
  equal(hold(run), 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS');
  equal(castRow(run).cropSafe, false, 'no metrics carrier ⇒ no crop authority');
});

// ============================================================
// 3) RAW never elevates + flag-off legacy parity + determinism
// ============================================================
await test('RAW_EXTREME triage with EVERY authority lane absent → HOLD identical to quarantine (nothing elevates)', async () => {
  const run = await makeRun({ withMetrics: false, withIdentity: false, withHeroVision: false });
  equal(hold(run), 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS', 'the attractive raw triage cannot admit a single readiness bit');
  const c = castRow(run);
  deepEqual({ cropSafe: c.cropSafe, identityVerified: c.identityVerified }, { cropSafe: false, identityVerified: false }, 'raw record.triage elevates nothing');
});

await test('flag OFF → V2 authority block skipped entirely (unquarantine wiring is dormant; no refHeroV2 key)', async () => {
  // The unquarantined consumers live ONLY inside the flag-gated V2 block. With the flag off the
  // block is skipped and legacy slot selection runs — that legacy path needs a real model/network
  // we do not provide here, so it may throw. That is irrelevant: the point is the V2 cast/hero
  // authority is NEVER consulted when the flag is off (byte-identical legacy behaviour).
  const response = await baseResponse();
  let castCalls = 0;
  let heroEvalCalls = 0;
  const castApi = { ...realCastApi, buildCastManifest(i) { castCalls++; return realCastApi.buildCastManifest(i); } };
  const heroApi = { ...realHeroApi, evaluateHeroShotCandidate(...a) { heroEvalCalls++; return realHeroApi.evaluateHeroShotCandidate(...a); } };
  let s6 = null;
  try {
    s6 = await withEnv(
      { MEGA_REF_HERO_V2: undefined, MEGA_SEMANTIC_SELECTION: undefined, MEGA_SELECTION_SPEC: undefined, MEGA_STRICT_RENDER: undefined },
      () => s6_slots(makeJob(), { origin: 'http://b6.test', _deps: { readImagesAuthority: async () => response, castApi, heroApi, slotDirectorBrain: async () => ({ slots: {}, note: 'flag-off-stub' }) } }),
    );
  } catch { /* legacy path may fail for unrelated (network) reasons — not our concern */ }
  equal(castCalls, 0, 'flag OFF ⇒ the V2 cast authority is never built');
  equal(heroEvalCalls, 0, 'flag OFF ⇒ the V2 hero evaluator is never consulted');
  if (s6) equal(s6.dossierPatch?.pickImages?.refHeroV2, undefined, 'no ref-hero-v2 key when the flag is off');
});

await test('determinism: identical inputs twice → byte-identical refHeroV2 hold marker', async () => {
  const a = await makeRun();
  const b = await makeRun();
  deepEqual(a.s6.dossierPatch?.pickImages?.refHeroV2, b.s6.dossierPatch?.pickImages?.refHeroV2, 'the typed hold is deterministic');
  deepEqual(castRow(a), castRow(b), 'the elevated cast readiness is deterministic');
});

console.log('\n# phase4-b6-unquarantine: ' + passed + ' passed, ' + failed + ' failed, ' + assertions + ' assertions');
if (failed) process.exitCode = 1;
