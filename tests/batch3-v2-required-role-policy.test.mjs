// ============================================================
// Batch 3C — V2 required-role / identity / recovery regressions
//
// Observation-only S6 seam: real image-store authority, story authority,
// and cast manifest run unchanged.  The fixture deliberately has no identity
// or crop verifier, so every runtime case must stop at the first typed HOLD.
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const AI_BOMB = MOD('export async function callBrain(){ throw new Error("AI_FORBIDDEN_IN_BATCH3_ROLE_POLICY"); }');
register(MOD(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_BOMB)}, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
      return nextResolve(mapped, context);
    }
    return nextResolve(specifier, context);
  }
`));

const { s6_slots } = await import('../src/lib/megaAdapters.js');
const realCastApi = await import('../src/lib/castManifest.js');
const realStoryApi = await import('../src/lib/storyReferenceAuthority.js');
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
    console.log(`ok ${passed + failed} - ${name}`);
  } catch (error) {
    failed++;
    console.log(`not ok ${passed + failed} - ${name}\n  ${String(error?.stack || error).split('\n').slice(0, 5).join('\n  ')}`);
  }
};

const refs = JSON.parse(readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
const ref = refs.find((record) => record.id === 'REF-mrbqalpo-h1r1');
if (!ref?.dna) throw new Error('Batch 3C fixture requires tracked reference DNA');

const CASE_ID = 'B3C-REQUIRED-ROLE-CASE';
const HERO = 'Hero Current News';
const REACTION = 'Reaction Current News';
const HERO_ID = 'H1';
const REACTION_ID = 'R1';
const COMPASS_PEOPLE = Object.freeze([
  Object.freeze({ name: HERO, role: 'hero' }),
  Object.freeze({ name: REACTION, role: 'reaction' }),
]);

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const readiness = (candidate) => ({
  searched: candidate.searched,
  triaged: candidate.triaged,
  clean: candidate.clean,
  highResolution: candidate.highResolution,
  cropSafe: candidate.cropSafe,
  identityVerified: candidate.identityVerified,
});

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

function candidateFacts() {
  return buildCandidateFactsV1({
    verdicts: { relevant: true, clean: true, newsScene: true },
    resolution: { decodedBuffer: true, provenance: 'full', width: 1000, height: 1400 },
    faceBox: { x: 0.30, y: 0.12, w: 0.40, h: 0.48 },
  });
}

function snapshotRows() {
  return [
    [HERO_ID, HERO],
    [REACTION_ID, REACTION],
  ].map(([id, person]) => ({
    id,
    caseId: CASE_ID,
    platform: 'google',
    imageUrl: `https://cdn.test/query-generic-person-${id}.jpg?filename=${id}-cast-face.jpg`,
    thumbnailUrl: '',
    source: 'generic person/cast-label source',
    sourceLink: `https://source.test/query/${id}`,
    width: 1000,
    height: 1400,
    realWidth: 1000,
    realHeight: 1400,
    triage: {
      relevant: true,
      clean: true,
      newsScene: true,
      person,
      persons: [person],
      castLabel: person,
      modelLabel: `single generic face for ${person}`,
      query: `generic person ${person}`,
      faceCount: 1,
      faceBox: { x1: 0.30, y1: 0.12, x2: 0.70, y2: 0.60 },
      identityConfidence: 0.999,
      faceShare: 0.80,
      headroom: 0.10,
      visibleBodyRegion: 'half_body',
      occlusion: 0,
      edgeCut: 0,
      cleanliness: 1,
      quality: 10,
      semanticScore: 999,
      qualityScore: 999,
      slotFitScore: 999,
      sceneKey: `hero-grade-${id}`,
      candidateFacts: candidateFacts(),
    },
  }));
}

function shadow(candidateIds) {
  return {
    version: 2,
    totalCandidates: candidateIds.length,
    emittedCandidates: candidateIds.length,
    truncatedCandidates: 0,
    capped: false,
    candidates: candidateIds.map((candidateId, index) => ({ candidateId, provider: 'google', queryIndex: 0, providerRank: index + 1 })),
  };
}

function makeJob({ compassPeople, searchIds = [], gapIds = [] }) {
  const images = { caseId: CASE_ID };
  if (searchIds.length) images.searchStats = [{ platform: 'google', found: searchIds.length, added: searchIds.length, searchShadowV2: shadow(searchIds) }];
  if (gapIds.length) images.gapSearchShadowV2 = shadow(gapIds);
  return {
    id: 'B3C-REQUIRED-ROLE-JOB',
    dossier: {
      images,
      compass: {
        angle: 'Batch 3C role-policy fixture',
        primaryEmotion: 'warm',
        secondaryEmotions: [],
        mainCharacters: compassPeople,
        visualDreamShots: [],
        doNotUse: [],
      },
      desk: { title: 'Batch 3C role-policy fixture' },
      refMatch: { dna: ref.dna, styleName: 'fixture', typeMatched: true, imagePath: '/ref.jpg', refId: ref.id },
      artBrief: { storyNote: 'fixture', orders: [] },
    },
  };
}

async function authorityResponse(rows) {
  const snapshot = {
    scope: 'case_image_store_snapshot_v1',
    caseId: CASE_ID,
    complete: true,
    truncated: false,
    count: rows.length,
    rows,
  };
  const response = await buildImagesRouteResponse(CASE_ID, '1', {
    readImagesSnapshot: async (requestedCaseId) => {
      if (requestedCaseId !== CASE_ID) throw new Error('unexpected case id');
      return snapshot;
    },
  });
  if (response.status !== 200 || response.body?.success !== true) throw new Error('real image authority fixture failed');
  return response;
}

async function runV2({ compassPeople = COMPASS_PEOPLE, searchIds = [HERO_ID, REACTION_ID], gapIds = [] } = {}) {
  const response = await authorityResponse(snapshotRows());
  const storyInputs = [];
  const castInputs = [];
  const manifests = [];
  let authorityReads = 0;
  let brainCalls = 0;
  const storyApi = {
    ...realStoryApi,
    buildStoryReferenceAuthorityContract(input) {
      storyInputs.push(cloneJson(input));
      return realStoryApi.buildStoryReferenceAuthorityContract(input);
    },
  };
  const castApi = {
    ...realCastApi,
    buildCastManifest(input) {
      castInputs.push(cloneJson(input));
      const manifest = realCastApi.buildCastManifest(input);
      manifests.push(manifest);
      return manifest;
    },
  };
  const s6 = await withV2Env(() => s6_slots(makeJob({ compassPeople, searchIds, gapIds }), {
    origin: 'http://batch3c.test',
    _deps: {
      storyApi,
      castApi,
      readImagesAuthority: async (requestedCaseId) => {
        authorityReads++;
        if (requestedCaseId !== CASE_ID) throw new Error('S6 requested an unexpected authority case');
        return response;
      },
      slotDirectorBrain: async () => {
        brainCalls++;
        throw new Error('V2 must hold before slotDirectorBrain in this no-verifier fixture');
      },
    },
  }));
  return { s6, storyInputs, castInputs, manifests, authorityReads, brainCalls };
}

function assertV2Hold(run, hold) {
  equal(run.s6.status, 'waiting', `S6 must fail closed (got ${run.s6.status} ${run.s6.summary || ''})`);
  deepEqual(run.s6.dossierPatch?.pickImages?.refHeroV2, { v: 1, ok: false, hold });
  equal(run.brainCalls, 0, 'typed V2 hold must precede slot selection');
}

function person(manifest, name) {
  const found = manifest.people.find((entry) => entry.canonicalName === name);
  ok(found, `manifest must contain ${name}`);
  return found;
}

function captured(run, id) {
  const found = run.castInputs[0]?.candidates.find((candidate) => candidate.candidateId === id);
  ok(found, `cast seam must receive ${id}`);
  return found;
}

async function assertWholeSetRoleRejection(label, compassPeople, getterCounts = []) {
  let run = null;
  let thrown = null;
  try {
    run = await runV2({ compassPeople });
  } catch (error) {
    thrown = error;
  }
  equal(thrown, null, `${label}: malformed compass data must fail closed, not escape S6`);
  for (const [getterLabel, count] of getterCounts) equal(count(), 0, `${label}: ${getterLabel} must never execute`);
  assertV2Hold(run, 'REF_HERO_V2_NO_CURRENT_NEWS_PEOPLE');
  equal(run.storyInputs.length, 0, `${label}: whole-set rejection must precede story authority`);
  equal(run.castInputs.length, 0, `${label}: whole-set rejection must precede cast authority`);
}

await test('V2 story and cast calls keep genuine hero/reaction roles while requiring only the hero', async () => {
  const run = await runV2();
  assertV2Hold(run, 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS');
  equal(run.authorityReads, 1, 'S6 reads the in-process authority exactly once');
  equal(run.storyInputs.length, 1, 'story authority is built once before the cast hold');
  deepEqual(run.storyInputs[0], {
    story: {
      identities: [HERO, REACTION],
      requiredCast: [HERO],
      optionalCast: [REACTION],
      editorialHero: HERO,
      eventContext: null,
      facts: [],
      storySemantics: null,
      eligibleAssetProvenance: [],
    },
  });
  equal(run.castInputs.length, 1, 'the real cast builder is observed exactly once');
  deepEqual(Object.keys(run.castInputs[0]).sort(), ['candidates', 'compass']);
  deepEqual(run.castInputs[0].compass, {
    mainCharacters: [{ name: HERO, role: 'hero' }, { name: REACTION, role: 'reaction' }],
    requiredCast: [HERO],
  }, 'V2 preserves both genuine compass roles but fabricates neither article nor analyze evidence');
  const manifest = run.manifests[0];
  equal(person(manifest, HERO).mustRepresent, true);
  equal(person(manifest, REACTION).mustRepresent, false);
  deepEqual(manifest.hold?.canonicalNames, [HERO], 'the mandatory hero alone owns the cast-asset HOLD');
});

await test('real cast-manifest authority makes a reaction mandatory only through explicit or corroborated evidence', () => {
  const lone = realCastApi.buildCastManifest({
    compass: { mainCharacters: [{ name: HERO, role: 'hero' }, { name: REACTION, role: 'reaction' }], requiredCast: [HERO] },
  });
  equal(person(lone, HERO).mustRepresent, true);
  equal(person(lone, REACTION).mustRepresent, false, 'a lone single-source reaction stays optional');
  deepEqual(lone.hold, {
    holdType: 'INSUFFICIENT_CAST_ASSETS',
    personIds: [realCastApi.computePersonId(HERO)],
    canonicalNames: [HERO],
  }, 'a reaction with no candidate cannot itself create the cast-asset hold');

  const explicit = realCastApi.buildCastManifest({
    compass: { mainCharacters: [{ name: REACTION, role: 'reaction' }], requiredCast: [REACTION] },
  });
  equal(person(explicit, REACTION).mustRepresent, true, 'a genuine explicit requiredCast row is authority');

  const corroborated = realCastApi.buildCastManifest({
    compass: { mainCharacters: [{ name: REACTION, role: 'reaction' }] },
    analyze: { characters: [{ name: REACTION, role: 'reaction' }] },
  });
  const corroboratedReaction = person(corroborated, REACTION);
  equal(corroboratedReaction.mustRepresent, true, 'real compass+analyze corroboration is authority');
  deepEqual(corroboratedReaction.sourceEvidence.map((entry) => entry.source), ['analyze', 'compass']);
});

await test('generic labels, model cues, hero-grade fields, and S5 gap-search remain non-identity evidence', async () => {
  const run = await runV2({ searchIds: [], gapIds: [HERO_ID, REACTION_ID] });
  assertV2Hold(run, 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS');
  const heroCandidate = captured(run, HERO_ID);
  deepEqual(readiness(heroCandidate), {
    searched: true,
    triaged: true,
    clean: true,
    highResolution: true,
    cropSafe: false,
    identityVerified: false,
  }, 'gap-search may establish only searched lineage; it cannot recover crop or identity authority');
  equal(heroCandidate.name, HERO, 'person labels remain cast grouping input only');
  equal(captured(run, REACTION_ID).identityVerified, false, 'a second generic/model label is not a verifier either');
});

await test('missing, malformed, and exotic role values fail closed before story or cast authority', async () => {
  const cases = [
    ['missing role', { name: HERO }],
    ['numeric role', { name: HERO, role: 1 }],
    ['boxed-string role', { name: HERO, role: new String('hero') }],
  ];
  for (const [label, roleInput] of cases) {
    const run = await runV2({ compassPeople: [roleInput] });
    assertV2Hold(run, 'REF_HERO_V2_NO_EDITORIAL_HERO');
    equal(run.storyInputs.length, 0, `${label}: no story authority may be built`);
    equal(run.castInputs.length, 0, `${label}: no cast authority may be built`);
  }
});

await test('role and bounded compass surfaces are descriptor-rejected as whole-set failures without execution', async () => {
  let getterCalls = 0;
  const accessorRole = { name: HERO };
  Object.defineProperty(accessorRole, 'role', {
    enumerable: true,
    get() {
      getterCalls++;
      return 'hero';
    },
  });
  await assertWholeSetRoleRejection('role accessor', [accessorRole], [['role accessor', () => getterCalls]]);

  let unrelatedGetterCalls = 0;
  const unrelatedAccessorSecond = { name: REACTION, role: 'reaction' };
  Object.defineProperty(unrelatedAccessorSecond, 'unrelated', {
    enumerable: true,
    get() {
      unrelatedGetterCalls++;
      return 'must-not-read';
    },
  });
  await assertWholeSetRoleRejection(
    'unrelated accessor after valid hero',
    [{ name: HERO, role: 'hero' }, unrelatedAccessorSecond],
    [['unrelated accessor', () => unrelatedGetterCalls]],
  );

  const symbolKeyedSecond = { name: REACTION, role: 'reaction' };
  symbolKeyedSecond[Symbol('untrusted')] = true;
  await assertWholeSetRoleRejection('symbol-keyed second entry', [{ name: HERO, role: 'hero' }, symbolKeyedSecond]);

  const overCapSecond = { name: REACTION, role: 'reaction' };
  for (let i = 0; i < 15; i++) overCapSecond[`extra${i}`] = i; // 17 own keys > cap 16
  await assertWholeSetRoleRejection('over-cap second entry', [{ name: HERO, role: 'hero' }, overCapSecond]);

  let indexGetterCalls = 0;
  const indexAccessorPeople = [];
  Object.defineProperty(indexAccessorPeople, '0', {
    enumerable: true,
    configurable: true,
    get() {
      indexGetterCalls++;
      return { name: HERO, role: 'hero' };
    },
  });
  await assertWholeSetRoleRejection('mainCharacters index accessor', indexAccessorPeople, [['array index accessor', () => indexGetterCalls]]);
});

console.log(`\n# batch3-v2-required-role-policy: ${passed} passed, ${failed} failed, ${assertions} assertions`);
if (failed) process.exitCode = 1;
