// ============================================================
// Batch 4C — V2 metric quarantine / crop-boundary regressions
//
// The real S6 authority bridge, detached-facts validator, hero crop prefilter,
// and route waiting short-circuit run unchanged.  The only bounded double is
// cast identity authority for H1: it can carry one already-paired hero tuple
// past the unavailable identity/crop verifier boundary, but supplies no hero
// or Global metric evidence.  That lets this suite observe the real fixed
// HERO_METRICS_UNAVAILABLE hold without inventing evidence.
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { performance } from 'node:perf_hooks';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const AI_BOMB = MOD('export async function callBrain(){ throw new Error("AI_FORBIDDEN_IN_BATCH4_METRIC_QUARANTINE"); }');
const NEXT_SERVER_STUB = MOD('export const NextResponse = { json: (body, init) => ({ _body: body, status: init?.status || 200, json: async () => body }) };');

register(MOD([
  'export async function resolve(specifier, context, nextResolve) {',
  '  if (specifier === "@/lib/aiClient") return { url: ' + JSON.stringify(AI_BOMB) + ', shortCircuit: true };',
  '  if (specifier === "next/server") return { url: ' + JSON.stringify(NEXT_SERVER_STUB) + ', shortCircuit: true };',
  '  if (specifier.startsWith("@/")) {',
  '    const mapped = new URL(specifier.slice(2) + (specifier.endsWith(".js") || specifier.endsWith(".mjs") ? "" : ".js"), ' + JSON.stringify(SRC_ROOT) + ').href;',
  '    return nextResolve(mapped, context);',
  '  }',
  '  return nextResolve(specifier, context);',
  '}',
].join('\n')));

const { s6_slots } = await import('../src/lib/megaAdapters.js');
const { runCoverRefTest } = await import('../src/app/api/cover-ref-test/route.js');
const realHeroApi = await import('../src/lib/heroShotContract.js');
const realTemplateApi = await import('../src/lib/refTemplate.js');
const { buildCandidateFactsV1 } = await import('../src/lib/candidateFactAuthority.js');
const { buildImagesRouteResponse } = await import('../src/lib/imageStore.js');

let passed = 0;
let failed = 0;
let assertions = 0;
const equal = (...args) => { assertions++; return assert.equal(...args); };
const deepEqual = (...args) => { assertions++; return assert.deepEqual(...args); };
const ok = (...args) => { assertions++; return assert.ok(...args); };
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('ok ' + (passed + failed) + ' - ' + name);
  } catch (error) {
    failed++;
    console.log('not ok ' + (passed + failed) + ' - ' + name + '\n  ' + String(error?.stack || error).split('\n').slice(0, 5).join('\n  '));
  }
};

const refs = JSON.parse(readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
const ref = refs.find((record) => record.id === 'REF-mrbqalpo-h1r1');
if (!ref?.dna) throw new Error('Batch 4C fixture requires tracked reference DNA');

const CASE_ID = 'B4C-METRIC-QUARANTINE-CASE';
const HERO_ID = 'H1';
const HERO = 'Metric Quarantine Hero';
const OTHER_ID = 'O1';
const SAFE_FACT_FACE = Object.freeze({ x: 0.10, y: 0.04, w: 0.80, h: 0.92 });
const SAFE_RAW_FACE = Object.freeze({ x1: 0.10, y1: 0.04, x2: 0.90, y2: 0.96 });
const HASH = '0123456789abcdef';
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

// Deliberately attractive legacy values.  They live only in raw record.triage
// and must remain unusable as V2 identity, hero, or Global evidence.
const RAW_EXTREME = Object.freeze({
  identityConfidence: 1,
  faceShare: 1,
  headroom: 0,
  visibleBodyRegion: 'full_body',
  occlusion: 0,
  edgeCut: 0,
  cleanliness: 1,
  semanticScore: 999999999,
  qualityScore: 999999999,
  slotFitScore: 999999999,
  sceneKey: 'raw-perfect-score-scene',
});

async function withV2Env(fn) {
  const patch = {
    MEGA_REF_HERO_V2: '1',
    MEGA_STRICT_RENDER: '1',
    MEGA_SEMANTIC_SELECTION: '1',
    MEGA_SELECTION_SPEC: '1',
    MEGA_HERO_GRADE_HARD: '0',
    MEGA_ROLE_READINESS: undefined,
    MEGA_FINAL_DECISION_EVIDENCE_V2: undefined,
  };
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function factsFor(overrides = {}) {
  const verdicts = { relevant: true, clean: true, newsScene: true };
  if (hasOwn(overrides, 'clean')) verdicts.clean = overrides.clean;
  const resolution = hasOwn(overrides, 'resolution')
    ? overrides.resolution
    : { provenance: 'full', width: 4000, height: 5000 };
  const descriptor = {
    verdicts,
    hash: { value: HASH, algo: 'dhash_9x8_v1', measuredFrom: 'full' },
  };
  if (resolution !== 'unknown') {
    descriptor.resolution = {
      decodedBuffer: true,
      provenance: resolution?.provenance ?? 'full',
      width: resolution?.width ?? 4000,
      height: resolution?.height ?? 5000,
    };
  }
  if (hasOwn(overrides, 'faceBox')) descriptor.faceBox = overrides.faceBox;
  else descriptor.faceBox = SAFE_FACT_FACE;
  return buildCandidateFactsV1(descriptor);
}

function makeRow(id, person, facts = factsFor(), rawOverrides = {}) {
  return {
    id,
    caseId: CASE_ID,
    platform: 'google',
    imageUrl: 'https://cdn.test/metric-quarantine-' + id + '.jpg',
    thumbnailUrl: '',
    source: 'bounded offline fixture source',
    sourceLink: 'https://source.test/' + id,
    // These raw dimensions and raw face box must never substitute for facts.
    width: 9000,
    height: 12000,
    realWidth: 9000,
    realHeight: 12000,
    triage: {
      relevant: true,
      clean: true,
      newsScene: true,
      person,
      persons: [person],
      faceCount: 1,
      faceBox: SAFE_RAW_FACE,
      ...RAW_EXTREME,
      candidateFacts: facts,
      ...rawOverrides,
    },
  };
}

function rowsFor({ ids = [HERO_ID], factsById = {}, rawOverridesById = {} } = {}) {
  return ids.map((id) => makeRow(
    id,
    id === HERO_ID ? HERO : 'Optional ' + id,
    factsById[id] || factsFor(),
    rawOverridesById[id] || {},
  ));
}

function searchShadow(candidateIds) {
  return {
    version: 2,
    totalCandidates: candidateIds.length,
    emittedCandidates: candidateIds.length,
    truncatedCandidates: 0,
    capped: false,
    candidates: candidateIds.map((candidateId, index) => ({
      candidateId,
      provider: 'google',
      queryIndex: 0,
      providerRank: index + 1,
    })),
  };
}

function makeCompass() {
  return {
    angle: 'Batch 4C metric quarantine fixture',
    primaryEmotion: 'warm',
    secondaryEmotions: [],
    mainCharacters: [{ name: HERO, role: 'hero' }],
    visualDreamShots: [],
    doNotUse: [],
  };
}

function makeRefMatch() {
  return {
    dna: ref.dna,
    styleName: 'fixture',
    typeMatched: true,
    imagePath: '/ref.jpg',
    refId: ref.id,
  };
}

function makeJob(candidateIds = [HERO_ID]) {
  return {
    id: 'B4C-METRIC-QUARANTINE-JOB',
    dossier: {
      images: {
        caseId: CASE_ID,
        searchStats: [{
          platform: 'google',
          found: candidateIds.length,
          added: candidateIds.length,
          searchShadowV2: searchShadow(candidateIds),
        }],
      },
      compass: makeCompass(),
      desk: { title: 'Batch 4C metric quarantine fixture' },
      refMatch: makeRefMatch(),
      artBrief: { storyNote: 'fixture', orders: [] },
    },
  };
}

async function realAuthorityResponse(rows) {
  const snapshot = {
    scope: 'case_image_store_snapshot_v1',
    caseId: CASE_ID,
    complete: true,
    truncated: false,
    count: rows.length,
    rows,
  };
  let reads = 0;
  const response = await buildImagesRouteResponse(CASE_ID, '1', {
    readImagesSnapshot: async (requestedCaseId) => {
      reads++;
      equal(requestedCaseId, CASE_ID, 'authority source receives the exact case id');
      return snapshot;
    },
  });
  equal(reads, 1, 'real image-store authority reads one snapshot');
  equal(response.status, 200);
  equal(response.body.success, true);
  return cloneJson(response);
}

// This is intentionally a narrow identity/cast authority double.  It observes
// the real bridge input, only pairs H1 if its non-identity readiness is real,
// and supplies no hero/global metric fields.  V2's own crop prefilter remains
// the only crop decision exercised after this seam.
function makeBoundedCastIdentityDouble() {
  const state = {
    buildCalls: 0,
    integrityCalls: 0,
    holdCalls: 0,
    eligibilityCalls: 0,
    inputs: [],
    authorized: false,
    manifest: null,
  };
  const normalizedHero = HERO.trim().toLowerCase();
  const personId = 'bounded-cast-person:' + normalizedHero;
  const hash = 'bounded-cast-identity-authority-v1';
  const api = {
    buildCastManifest(input) {
      state.buildCalls++;
      state.inputs.push(cloneJson(input));
      const h1 = input?.candidates?.find((candidate) => candidate?.candidateId === HERO_ID);
      state.authorized = !!(h1
        && h1.searched === true
        && h1.triaged === true
        && h1.clean === true
        && h1.highResolution === true);
      state.manifest = { hash, bounded: 'cast_identity_only' };
      return state.manifest;
    },
    assertCastManifestIntegrity(manifest, expectedHash) {
      state.integrityCalls++;
      if (manifest !== state.manifest || expectedHash !== hash) throw new Error('unexpected cast manifest');
      return {
        people: [{
          personId,
          acceptableSlotRoles: ['hero', 'reaction', 'context'],
          mustRepresent: true,
          priority: 1,
          candidates: state.authorized
            ? [{ candidateId: HERO_ID, sourceAssetId: HERO_ID, boundedCastIdentityAuthority: true }]
            : [],
        }],
      };
    },
    evaluateCastAssetHolds(manifest, { expectedHash } = {}) {
      state.holdCalls++;
      if (manifest !== state.manifest || expectedHash !== hash) throw new Error('unexpected cast hold evaluation');
      return null;
    },
    computeCandidateEligibility(candidate) {
      state.eligibilityCalls++;
      return candidate?.boundedCastIdentityAuthority === true
        && candidate.candidateId === HERO_ID
        && candidate.sourceAssetId === HERO_ID;
    },
    normalizeCastName(value) {
      return typeof value === 'string' ? value.trim().toLowerCase() : '';
    },
    computePersonId(value) {
      return 'bounded-cast-person:' + value;
    },
  };
  return { api, state, personId };
}

function makeHeroProbe() {
  const state = { contractBuilds: 0, evaluations: 0 };
  return {
    state,
    api: {
      ...realHeroApi,
      buildHeroShotContract(input) {
        state.contractBuilds++;
        return realHeroApi.buildHeroShotContract(input);
      },
      evaluateHeroShotCandidate(...args) {
        state.evaluations++;
        return realHeroApi.evaluateHeroShotCandidate(...args);
      },
    },
  };
}

function makeS6Probe(response, { afterCarrierValidated } = {}) {
  const cast = makeBoundedCastIdentityDouble();
  const hero = makeHeroProbe();
  const global = { calls: 0 };
  const state = {
    authorityReads: 0,
    templateCalls: 0,
    slotDirectorCalls: 0,
  };
  return {
    cast,
    hero,
    global,
    state,
    deps: {
      readImagesAuthority: async (requestedCaseId) => {
        state.authorityReads++;
        equal(requestedCaseId, CASE_ID, 'S6 requests the exact authority case');
        return response;
      },
      castApi: cast.api,
      heroApi: hero.api,
      globalApi: {
        buildSemanticGlobalAssignment() {
          global.calls++;
          throw new Error('GLOBAL_MUST_NOT_RUN_BEFORE_HERO_METRICS_EXIST');
        },
      },
      dnaToTemplateSpec(dna) {
        state.templateCalls++;
        afterCarrierValidated?.(response);
        return realTemplateApi.dnaToTemplateSpec(dna);
      },
      slotDirectorBrain: async () => {
        state.slotDirectorCalls++;
        throw new Error('SLOT_DIRECTOR_MUST_NOT_RUN_ON_V2_HOLD');
      },
    },
  };
}

async function runS6({ rows, mutateResponse, afterCarrierValidated } = {}) {
  const effectiveRows = rows || rowsFor();
  const response = await realAuthorityResponse(effectiveRows);
  mutateResponse?.(response);
  const probe = makeS6Probe(response, { afterCarrierValidated });
  const s6 = await withV2Env(() => s6_slots(makeJob(effectiveRows.map((row) => row.id)), {
    origin: 'http://batch4c.test',
    _deps: probe.deps,
  }));
  return { s6, response, probe };
}

function refHeroHold(run) {
  return run.s6.dossierPatch?.pickImages?.refHeroV2;
}

function assertHeroMetricsUnavailable(run) {
  equal(run.s6.status, 'waiting', 'S6 must fail closed');
  deepEqual(refHeroHold(run), {
    v: 1,
    ok: false,
    hold: 'REF_HERO_V2_HERO_METRICS_UNAVAILABLE',
  });
  equal(run.probe.global.calls, 0, 'Global must not run before hero metrics exist');
  equal(run.probe.state.slotDirectorCalls, 0, 'slot selection must not run on typed V2 hold');
}

function capturedCandidate(run, id = HERO_ID) {
  const candidate = run.probe.cast.state.inputs[0]?.candidates?.find((entry) => entry.candidateId === id);
  ok(candidate, 'cast seam must observe candidate ' + id);
  return candidate;
}

function readiness(candidate) {
  return {
    searched: candidate.searched,
    triaged: candidate.triaged,
    clean: candidate.clean,
    highResolution: candidate.highResolution,
    cropSafe: candidate.cropSafe,
    identityVerified: candidate.identityVerified,
  };
}

await test('pass-looking raw triage metrics cannot admit V2; detached full facts reach only crop prefilter then exact hero-metrics hold', async () => {
  const run = await runS6();
  assertHeroMetricsUnavailable(run);
  equal(run.probe.state.authorityReads, 1, 'the existing in-process authority seam is read once');
  equal(run.probe.cast.state.buildCalls, 1, 'the bounded cast identity seam observes real bridge output once');
  deepEqual(readiness(capturedCandidate(run)), {
    searched: true,
    triaged: true,
    clean: true,
    highResolution: true,
    cropSafe: false,
    identityVerified: false,
  }, 'raw identity/crop/readiness flags never elevate bridge readiness');
  equal(run.probe.hero.state.contractBuilds, 1, 'full facts + face box + literal clean=true pass only the independent crop prefilter');
  equal(run.probe.hero.state.evaluations, 0, 'missing hero metrics prevent candidate evaluation');
});

await test('caller facts are detached before a post-validation TOCTOU mutation of facts, faceBox, and hash', async () => {
  let mutationCalls = 0;
  const run = await runS6({
    afterCarrierValidated(response) {
      mutationCalls++;
      const callerFacts = response.body.candidateAuthority.candidates.find((candidate) => candidate.imageId === HERO_ID)?.facts;
      ok(callerFacts, 'mutation barrier receives caller-owned carrier facts');
      // This barrier is reached only after S6 synchronously validates/detaches
      // the carrier and before its later hero crop prefilter.
      callerFacts.scope = 'tampered_after_validation';
      callerFacts.verdicts.clean = false;
      callerFacts.resolution.width = 1;
      callerFacts.resolution.height = 1;
      callerFacts.faceBox.x1 = 0.4999;
      callerFacts.faceBox.x2 = 0.5001;
      callerFacts.hash.value = 'ffffffffffffffff';
    },
  });
  equal(mutationCalls, 1, 'the deliberate post-validation mutation runs exactly once');
  equal(run.probe.state.templateCalls, 1, 'the mutation barrier sits after authority validation');
  equal(run.response.body.candidateAuthority.candidates[0].facts.scope, 'tampered_after_validation');
  assertHeroMetricsUnavailable(run);
  equal(run.probe.hero.state.contractBuilds, 1, 'mutated caller geometry/dimensions cannot change detached crop behavior');
  equal(run.probe.hero.state.evaluations, 0);
});

await test('missing, malformed, accessor, symbol, revoked-proxy, and exotic facts fail closed without getters', async () => {
  let accessorGets = 0;
  let proxyGets = 0;
  const cases = [
    {
      name: 'missing facts',
      mutate(response) {
        delete response.body.candidateAuthority.candidates[0].facts;
      },
    },
    {
      name: 'malformed hash',
      mutate(response) {
        response.body.candidateAuthority.candidates[0].facts.hash = {
          value: 'NOT_A_LOWER_HEX_HASH',
          algo: 'dhash_9x8_v1',
          measuredFrom: 'full',
        };
      },
    },
    {
      name: 'faceBox accessor',
      mutate(response) {
        const facts = response.body.candidateAuthority.candidates[0].facts;
        delete facts.faceBox;
        Object.defineProperty(facts, 'faceBox', {
          enumerable: true,
          configurable: true,
          get() {
            accessorGets++;
            throw new Error('facts accessor must not execute');
          },
        });
      },
      check() {
        equal(accessorGets, 0, 'facts accessor is descriptor-rejected without execution');
      },
    },
    {
      name: 'symbol-keyed facts',
      mutate(response) {
        response.body.candidateAuthority.candidates[0].facts[Symbol('untrusted')] = true;
      },
    },
    {
      name: 'revoked proxy facts',
      mutate(response) {
        const facts = response.body.candidateAuthority.candidates[0].facts;
        const holder = Proxy.revocable(facts, {
          get() {
            proxyGets++;
            throw new Error('proxy get trap must not execute');
          },
        });
        holder.revoke();
        response.body.candidateAuthority.candidates[0].facts = holder.proxy;
      },
      check() {
        equal(proxyGets, 0, 'revoked proxy executes no user get trap');
      },
    },
    {
      name: 'exotic facts instance',
      mutate(response) {
        class ExoticFacts {}
        const facts = response.body.candidateAuthority.candidates[0].facts;
        response.body.candidateAuthority.candidates[0].facts = Object.assign(new ExoticFacts(), facts);
      },
    },
  ];

  for (const item of cases) {
    const run = await runS6({ mutateResponse: item.mutate });
    equal(run.s6.status, 'waiting', item.name + ': S6 must fail closed');
    deepEqual(refHeroHold(run), {
      v: 1,
      ok: false,
      hold: 'REF_HERO_V2_NO_ELIGIBLE_CAST',
    }, item.name + ': invalid carrier facts cannot authorize a cast tuple');
    deepEqual(readiness(capturedCandidate(run)), {
      searched: false,
      triaged: false,
      clean: false,
      highResolution: false,
      cropSafe: false,
      identityVerified: false,
    }, item.name + ': no malformed facts may elevate readiness');
    equal(run.probe.hero.state.contractBuilds, 0, item.name + ': no crop prefilter after invalid evidence');
    equal(run.probe.global.calls, 0, item.name + ': Global is unreachable');
    equal(run.probe.state.slotDirectorCalls, 0, item.name + ': no downstream slot selection');
    item.check?.();
  }
});

await test('unknown/thumb/low facts dimensions and missing/unsafe fact geometry never become crop-safe or borrow raw record geometry', async () => {
  const cases = [
    {
      name: 'unknown facts dimensions',
      facts: factsFor({ resolution: 'unknown' }),
      hold: 'REF_HERO_V2_NO_ELIGIBLE_CAST',
    },
    {
      name: 'thumbnail facts dimensions',
      facts: factsFor({ resolution: { provenance: 'thumb', width: 4000, height: 5000 } }),
      hold: 'REF_HERO_V2_NO_ELIGIBLE_CAST',
    },
    {
      name: 'low full facts dimensions despite huge raw dimensions',
      facts: factsFor({ resolution: { provenance: 'full', width: 10, height: 10 } }),
      hold: 'REF_HERO_V2_NO_ELIGIBLE_CAST',
    },
    {
      name: 'missing facts geometry despite safe raw faceBox',
      facts: factsFor({ faceBox: undefined }),
      hold: 'REF_HERO_V2_HERO_METRICS_UNAVAILABLE',
    },
    {
      name: 'unsafe tiny facts geometry despite safe raw faceBox',
      facts: factsFor({ faceBox: { x: 0.499, y: 0.499, w: 0.002, h: 0.002 } }),
      hold: 'REF_HERO_V2_HERO_METRICS_UNAVAILABLE',
    },
  ];

  for (const item of cases) {
    const run = await runS6({
      rows: rowsFor({ factsById: { [HERO_ID]: item.facts } }),
    });
    equal(run.s6.status, 'waiting', item.name + ': S6 must hold');
    deepEqual(refHeroHold(run), { v: 1, ok: false, hold: item.hold }, item.name + ': fixed typed hold');
    equal(run.probe.hero.state.contractBuilds, 0, item.name + ': does not pass the independent crop prefilter');
    equal(run.probe.global.calls, 0, item.name + ': no Global path');
    equal(run.probe.state.slotDirectorCalls, 0, item.name + ': no downstream selection');
  }
});

await test('raw Global scores and sceneKey are statically quarantined, while the real flow reaches no Global call first', async () => {
  const source = readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  const globalStart = source.indexOf('function _rhGlobalCandidate');
  const globalEnd = source.indexOf('function _rhAssignmentHashOf', globalStart);
  const heroStart = source.indexOf('function _rhHeroCandidate');
  const heroEnd = source.indexOf('function _rhGlobalCandidate', heroStart);
  const globalSource = source.slice(globalStart, globalEnd);
  const heroSource = source.slice(heroStart, heroEnd);
  ok(globalStart >= 0 && globalEnd > globalStart, 'static audit finds the Global candidate producer');
  ok(heroStart >= 0 && heroEnd > heroStart, 'static audit finds the hero candidate producer');
  for (const field of ['semanticScore', 'qualityScore', 'slotFitScore', 'sceneKey']) {
    ok(globalSource.includes('const ' + field + ' = null;'), field + ' has no admissible V2 producer');
  }
  for (const field of [
    'identityConfidence',
    'faceCount',
    'visibleBodyRegion',
    'occlusion',
    'edgeCut',
    'cleanliness',
  ]) {
    ok(heroSource.includes('const ' + field + ' = '), field + ' is explicitly unavailable without a producer');
  }

  const run = await runS6();
  assertHeroMetricsUnavailable(run);
  equal(run.probe.hero.state.contractBuilds, 1, 'the crop prefilter was reachable');
  equal(run.probe.global.calls, 0, 'hero metrics correctly prevent any fabricated Global admission');
});

await test('reordered records and repeated execution stay deterministic; a bounded 64-record case remains fast', async () => {
  const orderA = [HERO_ID, OTHER_ID];
  const orderB = [OTHER_ID, HERO_ID];
  const first = await runS6({ rows: rowsFor({ ids: orderA }) });
  const second = await runS6({ rows: rowsFor({ ids: orderB }) });
  const third = await runS6({ rows: rowsFor({ ids: orderA }) });
  assertHeroMetricsUnavailable(first);
  assertHeroMetricsUnavailable(second);
  assertHeroMetricsUnavailable(third);
  deepEqual(refHeroHold(first), refHeroHold(second), 'row order cannot alter the typed hold');
  deepEqual(refHeroHold(first), refHeroHold(third), 'repeated input cannot alter the typed hold');
  deepEqual(readiness(capturedCandidate(first)), readiness(capturedCandidate(second)), 'row order cannot alter bridge readiness');

  const boundedIds = [HERO_ID, ...Array.from({ length: 63 }, (_, index) => 'P' + String(index).padStart(2, '0'))];
  const t0 = performance.now();
  const bounded = await runS6({ rows: rowsFor({ ids: boundedIds }) });
  const elapsedMs = performance.now() - t0;
  assertHeroMetricsUnavailable(bounded);
  equal(bounded.probe.cast.state.inputs[0].candidates.length, 64, 'bounded case observes every candidate exactly once');
  ok(elapsedMs < 5000, '64-record fail-closed case must stay bounded (got ' + elapsedMs.toFixed(1) + 'ms)');
});

await test('the real route short-circuits the exact S6 hold before S7, queue, compose, QC, or Global', async () => {
  const response = await realAuthorityResponse(rowsFor());
  const probe = makeS6Probe(response);
  const calls = { s7: 0, compose: 0, qc: 0, archive: 0 };
  const env = {
    MEGA_REF_HERO_V2: '1',
    MEGA_STRICT_RENDER: '1',
    MEGA_SEMANTIC_SELECTION: '1',
    MEGA_SELECTION_SPEC: '1',
    MEGA_HERO_GRADE_HARD: '0',
  };
  const done = () => ({ status: 'done', nextAction: 'done' });
  const result = await withV2Env(() => runCoverRefTest({
    newsTitle: 'Batch 4C route fixture',
    content: 'x'.repeat(240),
    origin: 'http://batch4c-route.test',
  }, {
    env,
    compassBrain: async () => makeCompass(),
    s5_case: async () => ({
      status: 'done',
      dossierPatch: {
        images: {
          caseId: CASE_ID,
          searchStats: [{
            platform: 'google',
            found: 1,
            added: 1,
            searchShadowV2: searchShadow([HERO_ID]),
          }],
        },
        refMatch: makeRefMatch(),
        artBrief: { storyNote: 'fixture', orders: [] },
      },
    }),
    s5_keywords: async () => done(),
    s5_search: async () => done(),
    s5_triage: async () => done(),
    s5_clipframe: async () => done(),
    s6_slots: async (job, { origin }) => s6_slots(job, { origin, _deps: probe.deps }),
    s7_cover: async () => {
      calls.s7++;
      throw new Error('S7_MUST_NOT_RUN_AFTER_S6_HOLD');
    },
    composeAndVerify: async () => {
      calls.compose++;
      throw new Error('COMPOSE_MUST_NOT_RUN_AFTER_S6_HOLD');
    },
    evaluateCoverQc: () => {
      calls.qc++;
      throw new Error('QC_MUST_NOT_RUN_AFTER_S6_HOLD');
    },
    loadArchive: async () => {
      calls.archive++;
      throw new Error('ARCHIVE_MUST_NOT_RUN_AFTER_S6_HOLD');
    },
    readImageCase: async () => {
      throw new Error('IMAGE_CASE_MUST_NOT_RUN_AFTER_S6_HOLD');
    },
    persistCoverImage: async () => {
      throw new Error('PERSIST_MUST_NOT_RUN_AFTER_S6_HOLD');
    },
    clipframeWaitMs: 0,
  }));
  equal(result.status, 422);
  equal(result.body.errorType, 'STRICT_HOLD');
  equal(result.body.holdReason, 'REF_HERO_V2_HERO_METRICS_UNAVAILABLE');
  equal(result.body.refHeroV2Hold, 'REF_HERO_V2_HERO_METRICS_UNAVAILABLE');
  deepEqual(calls, { s7: 0, compose: 0, qc: 0, archive: 0 });
  equal(probe.global.calls, 0, 'Global remains unreachable before the route short-circuit');
  equal(probe.state.slotDirectorCalls, 0, 'slot director remains unreachable before the route short-circuit');
});

console.log('\n# batch4-v2-metric-quarantine: ' + passed + ' passed, ' + failed + ' failed, ' + assertions + ' assertions');
if (failed) process.exitCode = 1;
