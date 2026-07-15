// ============================================================
// Batch 2B — S5→V2 evidence bridge: authority-only readiness regression
//
// This is deliberately an observation test.  It builds the same response shape
// production reads with the real image-store authority path, wraps only the
// real cast API to capture its input, and delegates every real cast operation.
// No crop or identity authority is fabricated: the real cast evaluator must
// therefore HOLD after the four evidenced fields have been observed.
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const AI_BOMB = MOD('export async function callBrain(){ throw new Error("AI_FORBIDDEN_IN_EVIDENCE_BRIDGE_TEST"); }');

// This suite drives S6 through dependency injection.  The alias hook is only
// for module resolution; the AI client is a bomb so the test cannot pay for a
// model call by accident.
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_BOMB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register(MOD(hook));

const { s6_slots } = await import('../src/lib/megaAdapters.js');
const realCastApi = await import('../src/lib/castManifest.js');
const { buildCandidateFactsV1 } = await import('../src/lib/candidateFactAuthority.js');
const { buildImagesRouteResponse } = await import('../src/lib/imageStore.js');

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`ok ${passed + failed} - ${name}`);
  } catch (error) {
    failed++;
    console.log(`not ok ${passed + failed} - ${name}\n  ${String(error?.stack || error).split('\n').slice(0, 5).join('\n  ')}`);
  }
};

const refs = JSON.parse(readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
const ref = refs.find((record) => record.id === 'REF-mrbqalpo-h1r1');
assert.ok(ref?.dna, 'fixture requires the tracked reference DNA');

const CASE_ID = 'B2B-EVIDENCE-CASE';
const PEOPLE = [
  ['L1', 'Lisa', 'hero'],
  ['N1', 'Nene', 'reaction'],
  ['C1', 'Ctx1', 'context'],
  ['C2', 'Ctx2', 'context'],
  ['C3', 'Ctx3', 'context'],
];
const PICKS = {
  hero: { id: 'L1', reason: 'fixture', backups: [] },
  context: { id: 'C1', reason: 'fixture', backups: [] },
  action: { id: 'C2', reason: 'fixture', backups: [] },
  moment: { id: 'C3', reason: 'fixture', backups: [] },
  reaction: { id: 'N1', reason: 'fixture', backups: [] },
};
const SAFE_RAW_FACE = { x1: 0.30, y1: 0.12, x2: 0.70, y2: 0.60 };
const FACT_FACE = { x: 0.30, y: 0.12, w: 0.40, h: 0.48 };
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

async function withV2Env(fn) {
  const patch = {
    MEGA_REF_HERO_V2: '1',
    MEGA_SEMANTIC_SELECTION: '1',
    MEGA_SELECTION_SPEC: '1',
    MEGA_HERO_GRADE_HARD: '0',
    MEGA_ROLE_READINESS: undefined,
    MEGA_FINAL_DECISION_EVIDENCE_V2: undefined,
    MEGA_STRICT_RENDER: undefined,
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

function factsFor(over = {}) {
  const verdicts = { relevant: true, newsScene: true };
  // Absent override means this fixture has explicit clean=true evidence.  An
  // own `clean: undefined` is the separate unknown-evidence regression.
  if (!hasOwn(over, 'clean')) verdicts.clean = true;
  else if (over.clean !== undefined) verdicts.clean = over.clean;
  const descriptor = {
    verdicts,
    resolution: over.resolution === 'unknown'
      ? {}
      : { decodedBuffer: true, provenance: 'full', width: over.resolution?.width ?? 900, height: over.resolution?.height ?? 1200 },
  };
  if (hasOwn(over, 'faceBox')) descriptor.faceBox = over.faceBox;
  else descriptor.faceBox = FACT_FACE;
  return buildCandidateFactsV1(descriptor);
}

function snapshotRows(caseId, overrides = {}) {
  return PEOPLE.map(([id, person, role]) => {
    const over = overrides[id] || {};
    // `clean:false` has to agree with the stored triage verdict.  For absent
    // facts.clean, raw clean stays true deliberately: raw legacy data cannot
    // invent a known clean verdict in the bridge.
    const rawClean = hasOwn(over, 'rawClean') ? over.rawClean : (over.clean === false ? false : true);
    const triage = {
      relevant: true,
      clean: rawClean,
      newsScene: true,
      person,
      persons: [person],
      faceCount: 1,
      category: 'face-emotional',
      emotion: 'warm',
      quality: 8,
      note: `generic person face cast label query filename URL: ${person} ${id}`,
      faceBox: hasOwn(over, 'rawFaceBox') ? over.rawFaceBox : SAFE_RAW_FACE,
      identityConfidence: 0.9,
      faceShare: 0.15,
      headroom: 0.15,
      visibleBodyRegion: 'half_body',
      occlusion: 0.05,
      edgeCut: 0.02,
      cleanliness: 0.9,
      semanticScore: 700,
      qualityScore: 700,
      slotFitScore: 700,
      sceneKey: `scene-${role}-${id}`,
      // Deliberately untrusted legacy fields: evidence must not read them.
      searched: true,
      triaged: true,
      highResolution: true,
      cropSafe: true,
      identityVerified: true,
      candidateFacts: factsFor(over),
    };
    return {
      id,
      caseId,
      platform: 'google',
      imageUrl: `https://cdn.test/face-cast-query-${person}-${id}.jpg?candidate=${id}`,
      thumbnailUrl: '',
      source: 'Generic face/cast label source',
      sourceLink: `https://source.test/query/${person}/${id}`,
      width: 900,
      height: 1200,
      realWidth: 900,
      realHeight: 1200,
      triage,
    };
  });
}

function searchShadow(candidateIds) {
  return {
    version: 2,
    totalCandidates: candidateIds.length,
    emittedCandidates: candidateIds.length,
    truncatedCandidates: 0,
    capped: false,
    candidates: candidateIds.map((candidateId, index) => ({ candidateId, provider: 'google', queryIndex: 0, providerRank: index + 1 })),
  };
}

function makeJob(caseId, candidateIds) {
  return {
    id: 'B2B-EVIDENCE-JOB',
    dossier: {
      images: {
        caseId,
        searchStats: [{ platform: 'google', found: candidateIds.length, added: candidateIds.length, searchShadowV2: searchShadow(candidateIds) }],
      },
      compass: {
        angle: 'evidence bridge fixture',
        primaryEmotion: 'warm',
        secondaryEmotions: [],
        mainCharacters: PEOPLE.map(([, name, role]) => ({ name, role })),
        visualDreamShots: [],
        doNotUse: [],
      },
      desk: { title: 'Batch 2B evidence bridge fixture' },
      refMatch: { dna: ref.dna, styleName: 'fixture', typeMatched: true, imagePath: '/ref.jpg', refId: ref.id },
      artBrief: { storyNote: 'fixture', orders: [] },
    },
  };
}

async function buildRealAuthorityResponse(caseId, overrides = {}) {
  const rows = snapshotRows(caseId, overrides);
  const snapshot = {
    scope: 'case_image_store_snapshot_v1',
    caseId,
    complete: true,
    truncated: false,
    count: rows.length,
    rows,
  };
  let snapshotReads = 0;
  const response = await buildImagesRouteResponse(caseId, '1', {
    readImagesSnapshot: async (requestedCaseId) => {
      snapshotReads++;
      assert.equal(requestedCaseId, caseId, 'real image-store reader receives the exact requested caseId');
      return snapshot;
    },
  });
  assert.equal(snapshotReads, 1, 'real authority path makes exactly one snapshot read');
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  return { response, snapshot, snapshotReads };
}

async function runBridge({ caseId = CASE_ID, overrides = {}, responseMutator, searchIds } = {}) {
  const built = await buildRealAuthorityResponse(caseId, overrides);
  const response = responseMutator ? responseMutator(cloneJson(built.response)) : built.response;
  const authorityReads = [];
  let captured = [];
  let castBuildCalls = 0;
  let brainCalls = 0;
  const castApi = {
    ...realCastApi,
    buildCastManifest(input) {
      castBuildCalls++;
      captured = input.candidates.map((candidate) => ({ ...candidate }));
      return realCastApi.buildCastManifest(input);
    },
  };
  const ids = searchIds || built.snapshot.rows.map((row) => row.id);
  const s6 = await withV2Env(() => s6_slots(makeJob(caseId, ids), {
    origin: 'http://bridge.test',
    _deps: {
      readImagesAuthority: async (requestedCaseId) => {
        authorityReads.push(requestedCaseId);
        return response;
      },
      castApi,
      slotDirectorBrain: async () => {
        brainCalls++;
        throw new Error('S6 must hold before slotDirectorBrain when no all-six authority exists');
      },
    },
  }));
  return { ...built, response, s6, authorityReads, captured, castBuildCalls, brainCalls };
}

const readiness = (candidate) => ({
  searched: candidate.searched,
  triaged: candidate.triaged,
  clean: candidate.clean,
  highResolution: candidate.highResolution,
  cropSafe: candidate.cropSafe,
  identityVerified: candidate.identityVerified,
});
const candidate = (run, id = 'L1') => {
  const found = run.captured.find((row) => row.candidateId === id);
  assert.ok(found, `captured cast input includes ${id}`);
  return found;
};
function assertTypedCastHold(run) {
  assert.equal(run.s6.status, 'waiting', `S6 must fail closed (got ${run.s6.status} ${run.s6.summary || ''})`);
  assert.deepEqual(run.s6.dossierPatch?.pickImages?.refHeroV2, { v: 1, ok: false, hold: 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS' });
  assert.equal(run.brainCalls, 0, 'the typed V2 hold occurs before slot selection');
}
function assertNoEvidenceReady(run) {
  assert.ok(run.captured.length > 0, 'safe rows still reach the observing cast seam');
  for (const row of run.captured) {
    assert.deepEqual(readiness(row), {
      searched: false,
      triaged: false,
      clean: false,
      highResolution: false,
      cropSafe: false,
      identityVerified: false,
    }, `no invalid/missing authority may elevate ${row.candidateId}`);
  }
}

await test('real same-snapshot authority carries only searched/triaged/clean/highResolution into the real cast adapter', async () => {
  const run = await runBridge();
  assert.equal(run.snapshotReads, 1);
  assert.strictEqual(run.response.body.images, run.snapshot.rows, 'image-store response reuses its one snapshot rows array');
  assert.equal(run.response.body.candidateAuthority.available, true, 'real image-store authority is available');
  assert.deepEqual(run.authorityReads, [CASE_ID], 'S6 asks the injected authority reader for the job case exactly once');
  assert.equal(run.castBuildCalls, 1, 'the wrapped real cast builder observes the bridge input once');
  assertTypedCastHold(run);

  const l1 = candidate(run);
  assert.equal(run.captured.length, PEOPLE.length, 'every same-snapshot row reaches the observing cast seam');
  assert.deepEqual(
    { candidateId: l1.candidateId, sourceAssetId: l1.sourceAssetId },
    { candidateId: 'L1', sourceAssetId: 'L1' },
    'candidate/source asset identity remains bound to the exact snapshot row',
  );
  assert.deepEqual(readiness(l1), {
    searched: true,
    triaged: true,
    clean: true,
    highResolution: true,
    cropSafe: false,
    identityVerified: false,
  });
  assert.equal(l1.name, 'Lisa', 'person label is preserved only as cast grouping input');
  assert.equal(l1.identityVerified, false, 'person/face/cast/query/filename/URL cues never become identity authority');

  const facts = run.response.body.candidateAuthority.candidates.find((row) => row.imageId === 'L1')?.facts;
  assert.deepEqual(
    { scope: facts?.scope, version: facts?.version, producer: facts?.producer },
    { scope: 'candidate_facts_v1', version: 1, producer: 'LIBRARY_TRIAGE_CANDIDATE_FACTS_V1' },
    'captured readiness originates from the real versioned candidate-facts provenance',
  );
});

await test('unknown/negative facts never promote readiness; geometry and generic cues never create crop or identity authority', async () => {
  const cases = [
    {
      name: 'valid search shadow excludes L1',
      overrides: {},
      searchIds: PEOPLE.filter(([id]) => id !== 'L1').map(([id]) => id),
      expect: { searched: false, triaged: true, clean: true, highResolution: true, cropSafe: false, identityVerified: false },
    },
    {
      name: 'low full dimensions',
      overrides: { L1: { resolution: { width: 699, height: 1600 } } },
      expect: { searched: true, triaged: true, clean: true, highResolution: false, cropSafe: false, identityVerified: false },
    },
    {
      name: 'unknown dimensions despite high raw record dimensions',
      overrides: { L1: { resolution: 'unknown' } },
      expect: { searched: true, triaged: true, clean: true, highResolution: false, cropSafe: false, identityVerified: false },
    },
    {
      name: 'explicit clean false',
      overrides: { L1: { clean: false } },
      expect: { searched: true, triaged: true, clean: false, highResolution: true, cropSafe: false, identityVerified: false },
    },
    {
      name: 'unknown clean despite raw legacy clean true',
      overrides: { L1: { clean: undefined } },
      expect: { searched: true, triaged: true, clean: false, highResolution: true, cropSafe: false, identityVerified: false },
    },
    {
      name: 'missing fact geometry',
      overrides: { L1: { faceBox: undefined } },
      expect: { searched: true, triaged: true, clean: true, highResolution: true, cropSafe: false, identityVerified: false },
    },
    {
      name: 'unsafe tiny fact geometry',
      overrides: { L1: { faceBox: { x: 0.49, y: 0.49, w: 0.02, h: 0.02 }, rawFaceBox: { x1: 0.49, y1: 0.49, x2: 0.51, y2: 0.51 } } },
      expect: { searched: true, triaged: true, clean: true, highResolution: true, cropSafe: false, identityVerified: false },
    },
  ];
  for (const item of cases) {
    const run = await runBridge({ overrides: item.overrides, searchIds: item.searchIds });
    assertTypedCastHold(run);
    assert.deepEqual(readiness(candidate(run)), item.expect, item.name);
  }
});

await test('wrong case/count/membership/facts/accessors/exotics fail closed without executing getters', async () => {
  let carrierGetterCalls = 0;
  let rowGetterCalls = 0;
  const cases = [
    {
      name: 'wrong response case',
      mutate: (response) => ({ ...response, body: { ...response.body, caseId: 'WRONG-CASE' } }),
      early: true,
    },
    {
      name: 'wrong returned row case',
      mutate: (response) => { response.body.images[0].caseId = 'WRONG-ROW-CASE'; return response; },
    },
    {
      name: 'wrong authority count',
      mutate: (response) => { response.body.candidateAuthority.storeProof.expectedCount++; return response; },
    },
    {
      name: 'authority candidate outside same snapshot id membership',
      mutate: (response) => { response.body.candidateAuthority.candidates[0].imageId = 'NOT-IN-ROWS'; return response; },
    },
    {
      name: 'partial facts object',
      mutate: (response) => { delete response.body.candidateAuthority.candidates[0].facts.hash; return response; },
    },
    {
      name: 'missing authority',
      mutate: (response) => { delete response.body.candidateAuthority; return response; },
    },
    {
      name: 'candidate-authority accessor',
      mutate: (response) => {
        const authority = response.body.candidateAuthority;
        delete authority.storeProof;
        Object.defineProperty(authority, 'storeProof', { enumerable: true, configurable: true, get() { carrierGetterCalls++; throw new Error('getter must not execute'); } });
        return response;
      },
      check: () => assert.equal(carrierGetterCalls, 0, 'carrier accessor was descriptor-rejected without execution'),
    },
    {
      name: 'exotic candidate-authority object',
      mutate: (response) => { response.body.candidateAuthority = new (class ExoticAuthority {})(); return response; },
    },
    {
      name: 'row triage accessor',
      mutate: (response) => {
        const row = response.body.images[0];
        const value = row.triage;
        delete row.triage;
        Object.defineProperty(row, 'triage', { enumerable: true, configurable: true, get() { rowGetterCalls++; return value; } });
        return response;
      },
      early: true,
      check: () => assert.equal(rowGetterCalls, 0, 'row accessor was descriptor-rejected without execution'),
    },
  ];

  for (const item of cases) {
    const run = await runBridge({ responseMutator: item.mutate });
    if (item.early) {
      assert.equal(run.s6.status, 'failed', `${item.name} fails before any unsafe row reaches S6`);
      assert.equal(run.captured.length, 0, `${item.name} never reaches the cast adapter`);
      assert.equal(run.brainCalls, 0);
    } else {
      assertTypedCastHold(run);
      assertNoEvidenceReady(run);
    }
    item.check?.();
  }
});

console.log(`\n# batch2-v2-evidence-bridge: ${passed} tests, ${failed} failed`);
if (failed) process.exit(1);
