// ============================================================
// Candidate Metric Authority (Batch B1 SHADOW) — focused tests
//   Part 1: PURE module src/lib/candidateMetricAuthority.js
//           (builder / validator / snapshot — literal + descriptor-safe + detach)
//   Part 2: megaAdapters S6 evidence bridge เดินท่อ metricsById แบบ SHADOW —
//           behavior V2 เดิมไม่เปลี่ยน (flag ON ยัง HOLD เดิม · flag OFF ไม่มี key ใหม่)
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

// ---------- loader stubs (mirror mega-semantic-selection harness) — MUST run before importing megaAdapters ----------
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
`);
const STUB_CASE = _mod('export async function getCase(){ return {}; }');
const STUB_JUNK = _mod(`
export function isCatalogSource(){ return false; }
export function isOwnPageSource(){ return false; }
export function isMismatchedFbMedia(){ return false; }
`);
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };');
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

process.env.MEGA_HERO_GRADE_HARD = '0';
delete process.env.MEGA_SEARCH_PROVENANCE;
delete process.env.MEGA_SEARCH_SHADOW_V2;

const M = await import('../src/lib/candidateMetricAuthority.js');
const {
  buildCandidateMetricsV1,
  validateCandidateMetricsV1,
  buildCandidateMetricsSnapshotV1,
  validateCandidateMetricsSnapshotV1,
  METRICS_SCOPE,
  METRICS_VERSION,
  METRICS_PRODUCER,
  SNAPSHOT_SCOPE,
  SNAPSHOT_PRODUCER,
  SNAPSHOT_VERSION,
  VISIBLE_BODY_REGIONS,
} = M;
const { s6_slots } = await import('../src/lib/megaAdapters.js');
const { buildImagesRouteResponse } = await import('../src/lib/imageStore.js');

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}`); console.error(String((e && e.stack) || e)); }
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const HEX16 = /^[0-9a-f]{16}$/;

// ============================================================
// PART 1 — PURE builder
// ============================================================
const FULL_MEAS = {
  identityConfidence: 0.91, faceCount: 2, occlusion: 0.05, edgeCut: 0.02,
  cleanliness: 0.88, visibleBodyRegion: 'half_body', faceShare: 0.31, headroom: 0.12,
  cropSafeBySlot: { hero: true, reaction: false },
};

await test('A1: builder carries scope/version/producer + all measured fields + 16-hex hash', () => {
  const c = buildCandidateMetricsV1({ sourceAssetId: 'IMG-1', caseId: 'CASE-A', measurements: FULL_MEAS });
  assert.equal(c.scope, METRICS_SCOPE);
  assert.equal(c.version, METRICS_VERSION);
  assert.equal(c.producer, METRICS_PRODUCER);
  assert.equal(c.sourceAssetId, 'IMG-1');
  assert.equal(c.caseId, 'CASE-A');
  assert.deepEqual(c.measurements, FULL_MEAS);
  assert.ok(HEX16.test(c.hash), 'hash 16 hex lower');
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.measurements) && Object.isFrozen(c.measurements.cropSafeBySlot));
});

await test('A2: absent field ≠ default — only measured fields appear', () => {
  const c = buildCandidateMetricsV1({ sourceAssetId: 'IMG-2', caseId: 'CASE-A', measurements: { occlusion: 0.1, faceCount: 1 } });
  assert.deepEqual(Object.keys(c.measurements).sort(), ['faceCount', 'occlusion']);
  assert.ok(!('cleanliness' in c.measurements), 'no default cleanliness');
  assert.ok(!('visibleBodyRegion' in c.measurements));
  assert.ok(!('cropSafeBySlot' in c.measurements));
});

await test('A3: wrong-type / out-of-range values are dropped (not clamped)', () => {
  const c = buildCandidateMetricsV1({ measurements: {
    identityConfidence: 2,          // >1
    occlusion: -0.1,                // <0
    edgeCut: 'x',                   // string
    faceShare: Infinity,            // non-finite
    faceCount: -1,                  // negative
    cleanliness: 0.5,               // valid
    visibleBodyRegion: 'bogus',     // not in enum
    headroom: 0,                    // valid boundary
  } });
  assert.deepEqual(Object.keys(c.measurements).sort(), ['cleanliness', 'headroom']);
  assert.equal(c.measurements.headroom, 0);
  assert.equal(c.sourceAssetId, null, 'missing sourceAssetId ⇒ null (binding, not measurement)');
});

await test('A4: getter-trap on measurements never fires (descriptor-only) ⇒ field absent, no throw', () => {
  let fired = false;
  const meas = {};
  Object.defineProperty(meas, 'occlusion', { enumerable: true, configurable: true, get() { fired = true; return 0.1; } });
  meas.cleanliness = 0.7;
  const c = buildCandidateMetricsV1({ measurements: meas });
  assert.equal(fired, false, 'accessor never invoked');
  assert.ok(!('occlusion' in c.measurements), 'accessor field dropped');
  assert.equal(c.measurements.cleanliness, 0.7);
});

await test('A5: cropSafeBySlot keeps only literal-boolean slots; all-invalid ⇒ absent', () => {
  const c = buildCandidateMetricsV1({ measurements: { cropSafeBySlot: { a: true, b: false, c: 'yes', d: 1 } } });
  assert.deepEqual(c.measurements.cropSafeBySlot, { a: true, b: false });
  const c2 = buildCandidateMetricsV1({ measurements: { cropSafeBySlot: { a: 'yes', b: 0 } } });
  assert.ok(!('cropSafeBySlot' in c2.measurements), 'no valid slot ⇒ field absent');
});

await test('A6: exotic / null / non-object input never throws', () => {
  for (const bad of [null, undefined, 42, 'str', [], new Proxy({}, { get() { throw new Error('trap'); } })]) {
    const c = buildCandidateMetricsV1(bad);
    assert.equal(c.scope, METRICS_SCOPE);
    assert.deepEqual(c.measurements, {});
  }
});

await test('A7: VISIBLE_BODY_REGIONS enum accepted end-to-end', () => {
  for (const r of VISIBLE_BODY_REGIONS) {
    const c = buildCandidateMetricsV1({ measurements: { visibleBodyRegion: r } });
    assert.equal(c.measurements.visibleBodyRegion, r);
  }
});

// ============================================================
// PART 1 — PURE validator
// ============================================================
await test('B1: round-trip stored carrier validates (detached frozen copy)', () => {
  const built = buildCandidateMetricsV1({ sourceAssetId: 'IMG-1', caseId: 'CASE-A', measurements: FULL_MEAS });
  const stored = clone(built);
  const v = validateCandidateMetricsV1(stored);
  assert.ok(v, 'valid');
  assert.deepEqual(v.measurements, FULL_MEAS);
  assert.equal(v.hash, built.hash);
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.measurements));
});

await test('B2: tampered hash ⇒ null', () => {
  const stored = clone(buildCandidateMetricsV1({ sourceAssetId: 'IMG-1', caseId: 'CASE-A', measurements: FULL_MEAS }));
  stored.hash = '0000000000000000';
  assert.equal(validateCandidateMetricsV1(stored), null);
});

await test('B3: tampered measurement value (hash no longer matches) ⇒ null', () => {
  const stored = clone(buildCandidateMetricsV1({ sourceAssetId: 'IMG-1', caseId: 'CASE-A', measurements: FULL_MEAS }));
  stored.measurements.occlusion = 0.99; // hash was computed for 0.05
  assert.equal(validateCandidateMetricsV1(stored), null);
});

await test('B4: unexpected extra top-level / measurement key ⇒ null', () => {
  const s1 = clone(buildCandidateMetricsV1({ sourceAssetId: 'A', caseId: 'C', measurements: { occlusion: 0.1 } }));
  s1.rogue = 1;
  assert.equal(validateCandidateMetricsV1(s1), null);
  const s2 = clone(buildCandidateMetricsV1({ sourceAssetId: 'A', caseId: 'C', measurements: { occlusion: 0.1 } }));
  s2.measurements.rogue = 1;
  assert.equal(validateCandidateMetricsV1(s2), null);
});

await test('B5: accessor on stored carrier ⇒ null (no getter call, no throw)', () => {
  const stored = clone(buildCandidateMetricsV1({ sourceAssetId: 'A', caseId: 'C', measurements: { occlusion: 0.1 } }));
  let fired = false;
  Object.defineProperty(stored.measurements, 'cleanliness', { enumerable: true, configurable: true, get() { fired = true; return 0.5; } });
  assert.equal(validateCandidateMetricsV1(stored), null);
  assert.equal(fired, false);
});

await test('B6: wrong scope/version/producer ⇒ null', () => {
  for (const patch of [{ scope: 'x' }, { version: 2 }, { producer: 'X' }]) {
    const stored = clone(buildCandidateMetricsV1({ sourceAssetId: 'A', caseId: 'C', measurements: { occlusion: 0.1 } }));
    Object.assign(stored, patch);
    assert.equal(validateCandidateMetricsV1(stored), null, JSON.stringify(patch));
  }
});

await test('B7: TOCTOU — validated copy is detached; mutating source after validate cannot change it', () => {
  const stored = clone(buildCandidateMetricsV1({ sourceAssetId: 'A', caseId: 'C', measurements: FULL_MEAS }));
  const v = validateCandidateMetricsV1(stored);
  assert.equal(v.measurements.occlusion, 0.05);
  stored.measurements.occlusion = 0.99;              // mutate original after validation
  stored.measurements.cropSafeBySlot.hero = false;
  assert.equal(v.measurements.occlusion, 0.05, 'copy unaffected');
  assert.equal(v.measurements.cropSafeBySlot.hero, true, 'nested copy unaffected');
});

// ============================================================
// PART 1 — snapshot build + validate
// ============================================================
const mkMetric = (id, caseId, meas) => buildCandidateMetricsV1({ sourceAssetId: id, caseId, measurements: meas });

await test('C1: snapshot binds caseId + imageIds; validate returns metricsById Map', () => {
  const caseId = 'CASE-S';
  const imageIds = ['I1', 'I2', 'I3'];
  const metricsById = { I1: clone(mkMetric('I1', caseId, { occlusion: 0.1 })), I2: clone(mkMetric('I2', caseId, { faceShare: 0.3 })) };
  const snap = buildCandidateMetricsSnapshotV1({ caseId, imageIds, metricsById });
  assert.equal(snap.scope, SNAPSHOT_SCOPE);
  assert.equal(snap.producer, SNAPSHOT_PRODUCER);
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.deepEqual(snap.imageIds, imageIds);
  assert.equal(snap.metrics.length, 2);

  const v = validateCandidateMetricsSnapshotV1(clone(snap));
  assert.equal(v.ok, true);
  assert.equal(v.caseId, caseId);
  assert.ok(v.metricsById instanceof Map);
  assert.equal(v.metricsById.size, 2);
  assert.equal(v.metricsById.get('I1').measurements.occlusion, 0.1);
  assert.ok(Object.isFrozen(v.metricsById.get('I1')));
});

await test('C2: snapshot build fails when a metric id ∉ imageIds', () => {
  const caseId = 'CASE-S';
  const snap = buildCandidateMetricsSnapshotV1({ caseId, imageIds: ['I1'], metricsById: { IX: clone(mkMetric('IX', caseId, { occlusion: 0.1 })) } });
  assert.equal(snap.ok, false);
  assert.ok(snap.reasons.includes('METRIC_ID_NOT_IN_UNIVERSE'));
});

await test('C3: snapshot build fails when metric sourceAssetId ≠ imageId (binding)', () => {
  const caseId = 'CASE-S';
  const wrong = clone(mkMetric('OTHER', caseId, { occlusion: 0.1 }));
  const snap = buildCandidateMetricsSnapshotV1({ caseId, imageIds: ['I1'], metricsById: { I1: wrong } });
  assert.equal(snap.ok, false);
  assert.ok(snap.reasons.includes('METRIC_ASSET_MISMATCH'));
});

await test('C4: snapshot build fails on blank caseId / duplicate imageIds', () => {
  assert.equal(buildCandidateMetricsSnapshotV1({ caseId: '', imageIds: ['I1'] }).ok, false);
  assert.equal(buildCandidateMetricsSnapshotV1({ caseId: 'C', imageIds: ['I1', 'I1'] }).ok, false);
});

await test('C5: validate fails on wrong caseId binding of a metric entry', () => {
  const caseId = 'CASE-S';
  const snap = clone(buildCandidateMetricsSnapshotV1({ caseId, imageIds: ['I1'], metricsById: { I1: clone(mkMetric('I1', caseId, { occlusion: 0.1 })) } }));
  // tamper the snapshot caseId so entry.metrics.caseId no longer matches — validate must reject
  snap.caseId = 'CASE-DIFFERENT';
  const v = validateCandidateMetricsSnapshotV1(snap);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.includes('METRIC_CASE_MISMATCH'));
});

await test('C6: validate fails on entry imageId ∉ imageIds (same-snapshot binding)', () => {
  const caseId = 'CASE-S';
  const snap = clone(buildCandidateMetricsSnapshotV1({ caseId, imageIds: ['I1', 'I2'], metricsById: { I1: clone(mkMetric('I1', caseId, { occlusion: 0.1 })) } }));
  snap.imageIds = ['I2']; // remove I1 from the universe; the entry now dangles
  const v = validateCandidateMetricsSnapshotV1(snap);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.includes('BAD_ENTRY_ID'));
});

await test('C7: validate fails-closed on wrong scope / exotic / accessor snapshot (no throw)', () => {
  assert.equal(validateCandidateMetricsSnapshotV1({ scope: 'x' }).ok, false);
  assert.equal(validateCandidateMetricsSnapshotV1(null).ok, false);
  assert.equal(validateCandidateMetricsSnapshotV1(new Proxy({}, { ownKeys() { throw new Error('trap'); } })).ok, false);
  const snap = clone(buildCandidateMetricsSnapshotV1({ caseId: 'C', imageIds: ['I1'], metricsById: { I1: clone(mkMetric('I1', 'C', { occlusion: 0.1 })) } }));
  let fired = false;
  Object.defineProperty(snap, 'metrics', { enumerable: true, configurable: true, get() { fired = true; return []; } });
  assert.equal(validateCandidateMetricsSnapshotV1(snap).ok, false);
  assert.equal(fired, false, 'accessor never invoked');
});

// ============================================================
// PART 2 — megaAdapters S6 evidence bridge SHADOW wiring
//   (RH fixtures mirrored from mega-semantic-selection WAVE1A harness)
// ============================================================
const loadRefDna = (id) => { const refs = JSON.parse(fs.readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8')); const rec = refs.find((r) => r.id === id); assert.ok(rec?.dna, `ref ${id} must exist`); return rec.dna; };
const DNA_ALPO = loadRefDna('REF-mrbqalpo-h1r1');
const RH_ENV = ['MEGA_REF_HERO_V2', 'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC'];
const withRhEnv = async (vals, fn) => {
  const prev = RH_ENV.map((k) => process.env[k]);
  for (const k of RH_ENV) { if (vals[k] === undefined) delete process.env[k]; else process.env[k] = vals[k]; }
  try { return await fn(); } finally { RH_ENV.forEach((k, i) => { if (prev[i] === undefined) delete process.env[k]; else process.env[k] = prev[i]; }); }
};
const RH_ON = { MEGA_REF_HERO_V2: '1', MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' };
const RH_OFF = { MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' };
const RH_EV = { identityConfidence: 0.9, faceShare: 0.15, headroom: 0.15, visibleBodyRegion: 'half_body', occlusion: 0.05, edgeCut: 0.02, cleanliness: 0.9 };
const RH_RD = { searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true };
const RH_SC = { semanticScore: 700, qualityScore: 700, slotFitScore: 700 };
const rhImg = (id, { person = null, sceneKey } = {}) => ({
  id, imageUrl: `https://cdn.test/${id}.jpg`, thumbnailUrl: '', width: 900, height: 1200, realWidth: 900, realHeight: 1200,
  triage: { relevant: true, clean: true, faceCount: 1, person, persons: person ? [person] : [], category: 'face-emotional', emotion: 'warm', note: `${id} ${sceneKey}`, newsScene: true, quality: 8, faceBox: { x1: 0.30, y1: 0.12, x2: 0.70, y2: 0.60 }, ...RH_EV, ...RH_RD, ...RH_SC, sceneKey },
});
const RH_POOL = () => [
  rhImg('L1', { person: 'Lisa', sceneKey: 'sceneL' }),
  rhImg('N1', { person: 'Nene', sceneKey: 'sceneN' }),
  rhImg('C1', { person: 'Ctx1', sceneKey: 'sceneC1' }),
  rhImg('C2', { person: 'Ctx2', sceneKey: 'sceneC2' }),
  rhImg('C3', { person: 'Ctx3', sceneKey: 'sceneC3' }),
];
const RH_CHARS = () => [{ name: 'Lisa', role: 'hero' }, { name: 'Nene', role: 'reaction' }, { name: 'Ctx1', role: 'context' }, { name: 'Ctx2', role: 'context' }, { name: 'Ctx3', role: 'context' }];
const RH_PICKS = { hero: { id: 'L1', reason: 'x', backups: [] }, context: { id: 'C1', reason: 'x', backups: [] }, action: { id: 'C2', reason: 'x', backups: [] }, moment: { id: 'C3', reason: 'x', backups: [] }, reaction: { id: 'N1', reason: 'x', backups: [] } };
const rhJob = () => ({ dossier: {
  images: { caseId: 'RH-TEST' },
  compass: { angle: 'a', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: RH_CHARS(), visualDreamShots: [], doNotUse: [] },
  desk: { title: 'ข่าวทดสอบ RH' },
  refMatch: { dna: DNA_ALPO, styleName: 'ref', typeMatched: true, imagePath: '/x.jpg', refId: 'REF-mrbqalpo-h1r1' },
  artBrief: { storyNote: 's', orders: [] },
} });
const rhDeps = ({ pool, extraDeps = {}, captures }) => ({
  slotDirectorBrain: async (args) => { captures.brainArgs.push(args); return { slots: RH_PICKS, note: 'mock' }; },
  fetchJson: async (url) => { if (String(url).includes('/api/images/')) return { success: true, images: pool }; throw new Error('unexpected fetch: ' + url); },
  ...extraDeps,
});
const rhPatch = (s6) => s6.dossierPatch?.pickImages?.refHeroV2;

const { buildCandidateFactsV1 } = await import('../src/lib/candidateFactAuthority.js');
const RH_CASE = 'RH-TEST';
const RH_IDS = ['L1', 'N1', 'C1', 'C2', 'C3'];
const rhFacts = () => buildCandidateFactsV1({
  verdicts: { relevant: true, clean: true, newsScene: true },
  resolution: { decodedBuffer: true, provenance: 'full', width: 1000, height: 1400 },
  faceBox: { x: 0.30, y: 0.12, w: 0.40, h: 0.48 },
});
const rhHoldRows = () => RH_CHARS().map(({ name }, i) => ({
  id: RH_IDS[i], caseId: RH_CASE, platform: 'google',
  imageUrl: `https://cdn.test/${RH_IDS[i]}.jpg`, thumbnailUrl: '',
  source: 'RH hold fixture source', sourceLink: `https://source.test/${i}`,
  width: 1000, height: 1400, realWidth: 1000, realHeight: 1400,
  triage: { relevant: true, clean: true, newsScene: true, person: name, persons: [name], faceCount: 1, faceBox: { x1: 0.30, y1: 0.12, x2: 0.70, y2: 0.60 }, candidateFacts: rhFacts() },
}));
const rhAuthResponse = async (rows) => {
  const snapshot = { scope: 'case_image_store_snapshot_v1', caseId: RH_CASE, complete: true, truncated: false, count: rows.length, rows };
  const response = await buildImagesRouteResponse(RH_CASE, '1', { readImagesSnapshot: async (cid) => { if (cid !== RH_CASE) throw new Error('unexpected case'); return snapshot; } });
  if (response.status !== 200 || response.body?.success !== true) throw new Error('RH authority fixture failed');
  return response;
};
// craft a valid candidateMetrics snapshot carrier bound to RH_CASE / RH_IDS
const rhMetricsCarrier = () => buildCandidateMetricsSnapshotV1({
  caseId: RH_CASE,
  imageIds: RH_IDS,
  metricsById: Object.fromEntries(RH_IDS.map((id) => [id, buildCandidateMetricsV1({
    sourceAssetId: id, caseId: RH_CASE,
    measurements: { identityConfidence: 0.9, faceCount: 1, occlusion: 0.05, edgeCut: 0.02, cleanliness: 0.9, visibleBodyRegion: 'half_body', faceShare: 0.3, headroom: 0.12, cropSafeBySlot: { hero: true } },
  })])),
});
// ON path with an in-body candidateMetrics carrier + metric-authority spy on _deps
const rhOnHold = async ({ withMetrics = true, metricSpy } = {}) => {
  const rows = rhHoldRows();
  const response = await rhAuthResponse(rows);
  // ★ B2: the route now auto-mints body.candidateMetrics from validated facts. Overwrite it with the
  //   hand-crafted carrier for the ON path; strip it entirely to construct the true "absent carrier" case.
  if (withMetrics) response.body.candidateMetrics = rhMetricsCarrier();
  else delete response.body.candidateMetrics;
  const captures = { brainArgs: [] };
  const extra = {};
  if (metricSpy) extra.metricAuthorityApi = metricSpy;
  const s6 = await withRhEnv(RH_ON, () => s6_slots(rhJob(), { origin: 'http://mock', _deps: {
    readImagesAuthority: async (cid) => { if (cid !== RH_CASE) throw new Error('unexpected authority case'); return response; },
    slotDirectorBrain: async (a) => { captures.brainArgs.push(a); throw new Error('brain must not run on a typed V2 HOLD'); },
    ...extra,
  } }));
  return { s6, captures };
};

// ── (D1) flag OFF ⇒ no refHeroV2 key, no metrics key, byte-identical run-to-run ──
await test('D1: flag OFF ⇒ pipeline completes · no refHeroV2/metrics key · byte-identical', async () => {
  const captures1 = { brainArgs: [] };
  const off = await withRhEnv(RH_OFF, () => s6_slots(rhJob(), { origin: 'http://mock', _deps: rhDeps({ pool: RH_POOL(), captures: captures1 }) }));
  assert.equal(off.status, 'done', 'OFF: semantic-only pipeline completes');
  assert.ok(!('refHeroV2' in off.dossierPatch.pickImages), 'OFF: no refHeroV2 key');
  assert.ok(!JSON.stringify(off).includes('metricsById'), 'OFF: output never exposes metricsById');
  const captures2 = { brainArgs: [] };
  const off2 = await withRhEnv(RH_OFF, () => s6_slots(rhJob(), { origin: 'http://mock', _deps: rhDeps({ pool: RH_POOL(), captures: captures2 }) }));
  assert.equal(JSON.stringify(off2), JSON.stringify(off), 'OFF: byte-identical (metrics wiring adds nothing)');
});

// ── (D2) flag ON + valid candidateMetrics carrier ⇒ SAME typed HOLD; metricsById never surfaces ──
await test('D2: flag ON + metrics carrier ⇒ same REF_HERO_V2_INSUFFICIENT_CAST_ASSETS HOLD (behavior unchanged)', async () => {
  const { s6, captures } = await rhOnHold({ withMetrics: true });
  assert.equal(s6.status, 'waiting', 'ON: producer still fail-closes (metrics not consumed in B1 shadow)');
  assert.deepEqual(rhPatch(s6), { v: 1, ok: false, hold: 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS' });
  assert.equal(captures.brainArgs.length, 0, 'brain not called');
  assert.ok(!JSON.stringify(s6).includes('metricsById'), 'metricsById never leaks into output');
});

// ── (D3) HOLD identical with vs without the metrics carrier ⇒ metrics changes nothing ──
await test('D3: HOLD byte-identical with vs without candidateMetrics carrier', async () => {
  const withM = rhPatch((await rhOnHold({ withMetrics: true })).s6);
  const without = rhPatch((await rhOnHold({ withMetrics: false })).s6);
  assert.deepEqual(withM, without, 'metrics carrier cannot alter the typed hold');
});

// ── (D4) the bridge DOES wire the metric authority: spy is invoked with the carrier (shadow runs) ──
await test('D4: evidence bridge calls validateCandidateMetricsSnapshotV1 with the body carrier (shadow active)', async () => {
  const calls = [];
  const spy = {
    validateCandidateMetricsSnapshotV1: (snap) => { calls.push(snap); return validateCandidateMetricsSnapshotV1(snap); },
  };
  const { s6 } = await rhOnHold({ withMetrics: true, metricSpy: spy });
  assert.equal(calls.length, 1, 'bridge invoked the metric authority exactly once');
  assert.equal(calls[0].scope, SNAPSHOT_SCOPE, 'bridge passed the raw candidateMetrics carrier');
  assert.equal(s6.status, 'waiting', 'behavior still HOLD');
});

// ── (D5) no carrier on body ⇒ metric authority NOT invoked (nothing to validate) ──
await test('D5: no candidateMetrics on body ⇒ metric authority not invoked', async () => {
  const calls = [];
  const spy = { validateCandidateMetricsSnapshotV1: (snap) => { calls.push(snap); return validateCandidateMetricsSnapshotV1(snap); } };
  await rhOnHold({ withMetrics: false, metricSpy: spy });
  assert.equal(calls.length, 0, 'absent carrier ⇒ no validation call (fail-closed, no behavior change)');
});

console.log(`1..${passed + failed}`);
if (failed) { console.error(`FAILED ${failed}/${passed + failed}`); process.exit(1); }
