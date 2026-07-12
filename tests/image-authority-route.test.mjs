// Focused tests — src/lib/imageStore.js buildImagesRouteResponse (route glue: activation matrix,
// single-read binding, legacy parity, fallback-only legacy read). All reads via DI (no globals).
import assert from 'node:assert/strict';

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const { buildImagesRouteResponse } = await import('../src/lib/imageStore.js');

let n = 0, failed = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log(`ok ${n} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${n} - ${name}`); console.error(String((e && e.stack) || e)); }
}

const legacyImages = [{ id: 'A-1', platform: 'web', imageUrl: 'u1' }, { id: 'A-2', platform: 'youtube', imageUrl: 'u2' }];
function legacyReader() { const o = { n: 0, fn: async () => { o.n++; return legacyImages; } }; return o; }
function snapReader(result) { const o = { n: 0, fn: async () => { o.n++; if (typeof result === 'function') return result(); return result; } }; return o; }

await test('route: ONLY exact "1" activates authority; every other query => legacy path, zero snapshot reads', async () => {
  for (const q of ['1 ', ' 1', 'true', '0', '', 'yes', '01', 11, null, undefined]) {
    const legacy = legacyReader();
    const snap = snapReader({ complete: true });
    const res = await buildImagesRouteResponse('A', q, { readImages: legacy.fn, readImagesSnapshot: snap.fn, authority: { buildCandidateAuthoritySnapshotV1: () => ({}) } });
    assert.equal(res.status, 200);
    assert.ok(!('candidateAuthority' in res.body), 'no authority for ' + String(q));
    assert.equal(snap.n, 0, 'zero snapshot reads for ' + String(q));
    assert.equal(legacy.n, 1, 'one legacy read for ' + String(q));
  }
});

await test('route: default legacy payload is byte-equal + zero snapshot reads', async () => {
  const legacy = legacyReader();
  const snap = snapReader({ complete: true });
  const res = await buildImagesRouteResponse('A', null, { readImages: legacy.fn, readImagesSnapshot: snap.fn });
  const expected = { success: true, caseId: 'A', total: 2, byPlatform: { web: 1, youtube: 1 }, images: legacyImages };
  assert.deepEqual(res.body, expected);
  assert.equal(JSON.stringify(res.body), JSON.stringify(expected));
  assert.equal(snap.n, 0);
});

await test('route: opt-in SUCCESS derives payload+authority from the SINGLE snapshot read (ZERO legacy reads)', async () => {
  const snapRows = [
    { id: 'A-1', caseId: 'A', platform: 'web', imageUrl: 'u1' },
    { id: 'A-2', caseId: 'A', platform: 'ig', imageUrl: 'u2' },
    { id: 'A-3', caseId: 'A', platform: 'web', imageUrl: 'u3' },
  ];
  const snapObj = { scope: 'case_image_store_snapshot_v1', caseId: 'A', complete: true, truncated: false, count: 3, rows: snapRows };
  const legacy = legacyReader();
  const snap = snapReader(snapObj);
  const authority = { n: 0, arg: null, buildCandidateAuthoritySnapshotV1(a) { this.n++; this.arg = a; return { universeComplete: true, scope: 'candidate_authority_snapshot_v1', candidates: [], vettedProof: {}, storeProof: {} }; } };
  const res = await buildImagesRouteResponse('A', '1', { readImages: legacy.fn, readImagesSnapshot: snap.fn, authority });
  assert.equal(legacy.n, 0, 'ZERO legacy reads on opt-in success');
  assert.equal(snap.n, 1, 'exactly one snapshot read');
  assert.equal(authority.n, 1);
  assert.strictEqual(authority.arg, snapObj, 'authority built from same snapshot object');
  assert.equal(res.body.total, 3);
  assert.deepEqual(res.body.images, snapRows);
  assert.deepEqual(res.body.byPlatform, { web: 2, ig: 1 });
  assert.equal(res.body.candidateAuthority.available, true);
  assert.equal(res.body.candidateAuthority.scope, 'candidate_authority_snapshot_v1');
});

await test('route: opt-in SUCCESS end-to-end with REAL authority module (dynamic import)', async () => {
  const { buildCandidateFactsV1 } = await import('../src/lib/candidateFactAuthority.js');
  const f = JSON.parse(JSON.stringify(buildCandidateFactsV1({ verdicts: { relevant: true, clean: true, newsScene: true } })));
  const snapRows = [{ id: 'A-1', caseId: 'A', platform: 'web', imageUrl: 'u1', triage: { relevant: true, clean: true, newsScene: true, candidateFacts: f } }];
  const snapObj = { scope: 'case_image_store_snapshot_v1', caseId: 'A', complete: true, truncated: false, count: 1, rows: snapRows };
  const legacy = legacyReader();
  const snap = snapReader(snapObj);
  const res = await buildImagesRouteResponse('A', '1', { readImages: legacy.fn, readImagesSnapshot: snap.fn });
  assert.equal(legacy.n, 0);
  assert.equal(res.body.candidateAuthority.available, true);
  assert.equal(res.body.candidateAuthority.universeComplete, true);
  assert.equal(res.body.candidateAuthority.candidates.length, 1);
  assert.equal(res.body.candidateAuthority.candidates[0].imageId, 'A-1');
  assert.equal(res.body.total, 1);
});

await test('route: snapshot INCOMPLETE => fallback legacy read + incomplete marker (no proof, never fabricated complete)', async () => {
  const legacy = legacyReader();
  const snap = snapReader({ scope: 'case_image_store_snapshot_v1', caseId: 'A', complete: false, reason: 'FS_UNPROVEN', rows: [], count: 0 });
  const authority = { n: 0, buildCandidateAuthoritySnapshotV1() { this.n++; return {}; } };
  const res = await buildImagesRouteResponse('A', '1', { readImages: legacy.fn, readImagesSnapshot: snap.fn, authority });
  assert.equal(snap.n, 1);
  assert.equal(legacy.n, 1, 'fallback legacy read happens only on snapshot failure');
  assert.equal(authority.n, 0, 'no authority build on incomplete snapshot');
  assert.equal(res.body.candidateAuthority.available, false);
  assert.equal(res.body.candidateAuthority.incomplete, true);
  assert.equal(res.body.candidateAuthority.reason, 'FS_UNPROVEN');
  assert.equal(res.body.total, 2);
});

await test('route: snapshot THROW => fallback legacy read + SNAPSHOT_READ_FAILED', async () => {
  const legacy = legacyReader();
  const snap = { n: 0, fn: async () => { snap.n++; throw new Error('rpc down'); } };
  const res = await buildImagesRouteResponse('A', '1', { readImages: legacy.fn, readImagesSnapshot: snap.fn });
  assert.equal(snap.n, 1);
  assert.equal(legacy.n, 1);
  assert.equal(res.body.candidateAuthority.available, false);
  assert.equal(res.body.candidateAuthority.incomplete, true);
  assert.equal(res.body.candidateAuthority.reason, 'SNAPSHOT_READ_FAILED');
});

console.log(`\n# image-authority-route: ${n} tests, ${failed} failed`);
if (failed) process.exit(1);
