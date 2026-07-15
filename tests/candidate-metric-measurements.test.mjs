// ============================================================
// Candidate Metric Measurements (Batch B2 SHADOW) — focused tests
//   Part 1: PURE producer src/lib/candidateMetricMeasurements.js (formulas + fail-closed)
//   Part 2: end-to-end mint via buildImagesRouteResponse (candidateMetrics on body, shadow)
//   Part 3: minted carrier is B1-bridge-consumable (validateCandidateMetricsSnapshotV1 +
//           same-snapshot binding vs candidateAuthority universe) · flag OFF ⇒ nothing changes
// ============================================================
import assert from 'node:assert/strict';

// FS path เทสต้องแน่นอน — ปิด Supabase env (ไม่มี client = fsRead / route ใช้ DI อยู่แล้ว)
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const {
  measureCandidateMetrics, computeEdgeCut, EDGE_SAFE_MARGIN, EDGE_CUT_POLICY_MAX,
} = await import('../src/lib/candidateMetricMeasurements.js');
const {
  validateCandidateMetricsSnapshotV1, SNAPSHOT_SCOPE,
} = await import('../src/lib/candidateMetricAuthority.js');
const { buildCandidateFactsV1 } = await import('../src/lib/candidateFactAuthority.js');
const { buildImagesRouteResponse } = await import('../src/lib/imageStore.js');

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}`); console.error(String((e && e.stack) || e)); }
};
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const clone = (o) => JSON.parse(JSON.stringify(o));

// facts helper — validated candidate_facts_v1 via the real authority producer
const mkFacts = (faceBoxInput) => buildCandidateFactsV1({
  verdicts: { relevant: true, clean: true, newsScene: true },
  resolution: { decodedBuffer: true, provenance: 'full', width: 1000, height: 1400 },
  faceBox: faceBoxInput, // {x,y,w,h} | null
});

// ============================================================
// PART 1 — PURE producer formulas
// ============================================================
await test('P1: centered faceBox ⇒ faceShare/headroom exact, edgeCut ~0, no faceCount without cache', () => {
  // {x:0.35,y:0.30,w:0.30,h:0.40} ⇒ x1 .35 y1 .30 x2 .65 y2 .70 · margins all ≥0.30 ⇒ edgeCut 0
  const m = measureCandidateMetrics({ facts: mkFacts({ x: 0.35, y: 0.30, w: 0.30, h: 0.40 }) });
  assert.ok(close(m.faceShare, 0.40), 'faceShare = y2-y1 = 0.40');
  assert.ok(close(m.headroom, 0.30), 'headroom = y1 = 0.30');
  assert.equal(m.edgeCut, 0, 'centered ⇒ edgeCut ~0');
  assert.ok(!('faceCount' in m), 'no cache ⇒ no faceCount');
});

await test('P2: faceBox touching bottom edge ⇒ edgeCut high (> policy max 0.10)', () => {
  // {x:0.30,y:0.55,w:0.40,h:0.45} ⇒ x2 .70 y2 1.00 · bottom margin 1-1.0 = 0 ⇒ edgeCut 1
  const m = measureCandidateMetrics({ facts: mkFacts({ x: 0.30, y: 0.55, w: 0.40, h: 0.45 }) });
  assert.equal(m.edgeCut, 1, 'edge-touching ⇒ edgeCut 1');
  assert.ok(m.edgeCut > EDGE_CUT_POLICY_MAX, 'above policy max');
  assert.ok(close(m.faceShare, 0.45));
  assert.ok(close(m.headroom, 0.55));
});

await test('P3: full-frame faceBox ⇒ all margins ~0 ⇒ edgeCut ~1', () => {
  // {x:0,y:0,w:1,h:1} ⇒ x1 0 y1 0 x2 1 y2 1 · every margin 0 ⇒ edgeCut 1
  const m = measureCandidateMetrics({ facts: mkFacts({ x: 0, y: 0, w: 1, h: 1 }) });
  assert.equal(m.edgeCut, 1);
  assert.ok(close(m.faceShare, 1), 'faceShare = full height');
  assert.equal(m.headroom, 0);
});

await test('P4: faceBox null (confirmed no face) ⇒ no faceShare/headroom/edgeCut', () => {
  const m = measureCandidateMetrics({ facts: mkFacts(null) });
  assert.deepEqual(Object.keys(m), [], 'nothing measurable from a null faceBox + no cache');
});

await test('P5: faceBox "unknown" (missing/broken) ⇒ no faceShare/headroom/edgeCut', () => {
  // craft facts whose faceBox validator collapses to the string 'unknown' (missing faceBox prop)
  const facts = clone(mkFacts({ x: 0.35, y: 0.30, w: 0.30, h: 0.40 }));
  facts.faceBox = 'unknown';
  const m = measureCandidateMetrics({ facts });
  assert.ok(!('faceShare' in m) && !('headroom' in m) && !('edgeCut' in m), "'unknown' ⇒ absent");
});

await test('P6: faceCount from faceCacheEntry.faces.length only (array); count-number is NOT accepted', () => {
  const facts = mkFacts(null);
  assert.equal(measureCandidateMetrics({ facts, faceCacheEntry: { faces: [{}, {}, {}] } }).faceCount, 3);
  assert.equal(measureCandidateMetrics({ facts, faceCacheEntry: { faces: [] } }).faceCount, 0, 'zero-face detection is a real measurement');
  // cache-file entry stores faces as a COUNT NUMBER at top level — must NOT be read as length
  assert.ok(!('faceCount' in measureCandidateMetrics({ facts, faceCacheEntry: { faces: 5 } })), 'number faces ⇒ absent');
  assert.ok(!('faceCount' in measureCandidateMetrics({ facts })), 'no cache ⇒ absent');
  assert.ok(!('faceCount' in measureCandidateMetrics({ facts, faceCacheEntry: null })), 'null cache ⇒ absent');
});

await test('P7: triage.faceCount is never a source — producer ignores non-facts/non-cache fields', () => {
  // a bogus faceCount sitting on facts must be ignored (only facts.faceBox is read)
  const m = measureCandidateMetrics({ facts: { faceBox: null, faceCount: 9 } });
  assert.ok(!('faceCount' in m), 'facts.faceCount is not a measurement source');
});

await test('P8: exotic / null / non-object input never throws ⇒ {}', () => {
  for (const bad of [null, undefined, 42, 'str', [], new Proxy({}, { get() { throw new Error('trap'); } })]) {
    assert.deepEqual(measureCandidateMetrics(bad), {});
  }
  // facts a hostile proxy — box read guarded
  assert.deepEqual(measureCandidateMetrics({ facts: new Proxy({}, { get() { throw new Error('trap'); } }), faceCacheEntry: { faces: [{}] } }).faceCount, 1);
});

await test('P9: computeEdgeCut + constants (boundary: minMargin 0.045 ⇒ edgeCut == policy max)', () => {
  assert.equal(EDGE_SAFE_MARGIN, 0.05);
  assert.equal(EDGE_CUT_POLICY_MAX, 0.10);
  // a box whose closest margin is exactly 0.045 ⇒ edgeCut = 1 - 0.045/0.05 = 0.10
  const box = { x1: 0.045, y1: 0.5, x2: 0.6, y2: 0.9 }; // left margin 0.045 is the min
  assert.ok(close(computeEdgeCut(box), EDGE_CUT_POLICY_MAX), 'crossover point == policy max');
  // out-of-safe-margin box stays clamped in [0,1]
  const cut = computeEdgeCut({ x1: 0, y1: 0, x2: 1, y2: 1 });
  assert.ok(cut >= 0 && cut <= 1);
});

// ============================================================
// PART 2 + 3 — mint end-to-end via buildImagesRouteResponse (shadow) + bridge-consumability
// ============================================================
const CASE = 'CASE-B2';
const mkRow = (id, faceBoxInput) => ({
  id, caseId: CASE, platform: 'web', imageUrl: 'u-' + id,
  triage: { relevant: true, clean: true, newsScene: true, candidateFacts: clone(mkFacts(faceBoxInput)) },
});
const SNAP_ROWS = [
  mkRow('centered', { x: 0.35, y: 0.30, w: 0.30, h: 0.40 }),
  mkRow('edge', { x: 0.30, y: 0.55, w: 0.40, h: 0.45 }),
  mkRow('noface', null),
];
const mkSnap = (rows) => ({ scope: 'case_image_store_snapshot_v1', caseId: CASE, complete: true, truncated: false, count: rows.length, rows });
// faceCacheLookup double: only 'centered' has a cached detection (2 faces) — others absent
const FACE_LOOKUP = (imageId) => (imageId === 'centered' ? { faces: [{}, {}] } : undefined);

const mintResponse = async (extraDeps = {}) => buildImagesRouteResponse(CASE, '1', {
  readImagesSnapshot: async (cid) => { if (cid !== CASE) throw new Error('unexpected case'); return mkSnap(SNAP_ROWS); },
  faceCacheLookup: FACE_LOOKUP,
  ...extraDeps,
});

await test('M1: opt-in mint attaches body.candidateMetrics parallel to candidateAuthority (real authority)', async () => {
  const res = await mintResponse();
  assert.equal(res.status, 200);
  assert.equal(res.body.candidateAuthority.available, true, 'authority universe complete');
  const cm = res.body.candidateMetrics;
  assert.ok(cm, 'candidateMetrics minted');
  assert.equal(cm.scope, SNAPSHOT_SCOPE);
  assert.deepEqual(cm.imageIds, ['centered', 'edge', 'noface'], 'imageIds parallel candidate universe order');
  assert.equal(cm.metrics.length, 3);
});

await test('M2: minted measurements carry the exact producer values per image', async () => {
  const res = await mintResponse();
  const v = validateCandidateMetricsSnapshotV1(res.body.candidateMetrics);
  assert.equal(v.ok, true, 'minted carrier validates (B1-bridge-consumable)');
  assert.ok(v.metricsById instanceof Map && v.metricsById.size === 3);

  const centered = v.metricsById.get('centered').measurements;
  assert.ok(close(centered.faceShare, 0.40) && close(centered.headroom, 0.30) && centered.edgeCut === 0);
  assert.equal(centered.faceCount, 2, 'faceCount from injected cache (2 faces)');

  const edge = v.metricsById.get('edge').measurements;
  assert.equal(edge.edgeCut, 1, 'edge-touching image ⇒ edgeCut 1');
  assert.ok(!('faceCount' in edge), 'no cache entry ⇒ faceCount absent');

  const noface = v.metricsById.get('noface').measurements;
  assert.deepEqual(noface, {}, 'null faceBox + no cache ⇒ empty measurements (absent ≠ default)');
});

await test('M3: bridge same-snapshot binding — every metric id ∈ candidateAuthority universe + caseId matches', async () => {
  const res = await mintResponse();
  const auth = res.body.candidateAuthority; // real authority universe
  const authIds = new Set(auth.candidates.map((c) => c.imageId));
  const v = validateCandidateMetricsSnapshotV1(res.body.candidateMetrics);
  assert.equal(v.caseId, CASE, 'metrics snapshot bound to requested case (bridge checks caseId === requested)');
  for (const id of v.metricsById.keys()) {
    assert.ok(authIds.has(id), `metric id ${id} is inside the validated candidate universe`);
  }
});

await test('M4: mint is best-effort — producer module throwing ⇒ route byte-identical, no candidateMetrics', async () => {
  const boom = { measureCandidateMetrics: () => { throw new Error('producer boom'); } };
  const res = await mintResponse({ metricMeasurements: boom });
  assert.ok(!('candidateMetrics' in res.body), 'mint failure never adds the key');
  assert.equal(res.body.candidateAuthority.available, true, 'candidateAuthority unaffected');
  // and the rest of the body equals a run where mint yields nothing (parity)
  const bareBody = { success: true, caseId: CASE, total: 3, byPlatform: res.body.byPlatform, images: res.body.images, candidateAuthority: res.body.candidateAuthority };
  assert.equal(JSON.stringify(res.body), JSON.stringify(bareBody), 'body byte-identical to no-mint');
});

await test('M5: flag OFF (query ≠ "1") ⇒ legacy path, NO candidateMetrics, NO candidateAuthority', async () => {
  for (const q of [null, '0', '', 'true', ' 1']) {
    const res = await buildImagesRouteResponse(CASE, q, {
      readImages: async () => SNAP_ROWS,
      readImagesSnapshot: async () => { throw new Error('snapshot must not be read on legacy path'); },
      faceCacheLookup: FACE_LOOKUP,
    });
    assert.ok(!('candidateMetrics' in res.body), 'OFF: no candidateMetrics for ' + String(q));
    assert.ok(!('candidateAuthority' in res.body), 'OFF: no candidateAuthority for ' + String(q));
  }
});

await test('M6: incomplete snapshot ⇒ fallback legacy, no candidateMetrics (fail-closed)', async () => {
  const res = await buildImagesRouteResponse(CASE, '1', {
    readImages: async () => SNAP_ROWS,
    readImagesSnapshot: async () => ({ scope: 'case_image_store_snapshot_v1', caseId: CASE, complete: false, reason: 'FS_UNPROVEN', rows: [], count: 0 }),
    faceCacheLookup: FACE_LOOKUP,
  });
  assert.equal(res.body.candidateAuthority.available, false);
  assert.ok(!('candidateMetrics' in res.body), 'incomplete snapshot ⇒ never mint metrics');
});

await test('M7: empty candidate universe ⇒ no candidateMetrics (nothing to measure)', async () => {
  // rows all relevant:false ⇒ authority universe complete but zero candidates
  const rows = [mkRow('r1', null), mkRow('r2', null)].map((r) => {
    const rr = clone(r);
    rr.triage.relevant = false;
    rr.triage.candidateFacts.verdicts.relevant = false;
    return rr;
  });
  const res = await buildImagesRouteResponse(CASE, '1', {
    readImagesSnapshot: async () => mkSnap(rows), faceCacheLookup: FACE_LOOKUP,
  });
  assert.equal(res.body.candidateAuthority.available, true, 'universe still complete');
  assert.equal(res.body.candidateAuthority.candidates.length, 0);
  assert.ok(!('candidateMetrics' in res.body), 'zero candidates ⇒ no metrics carrier');
});

console.log(`1..${passed + failed}`);
if (failed) { console.error(`FAILED ${failed}/${passed + failed}`); process.exit(1); }
