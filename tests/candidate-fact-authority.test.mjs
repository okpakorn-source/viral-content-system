// Focused tests — src/lib/candidateFactAuthority.js (buildCandidateFactsV1 + buildCandidateAuthoritySnapshotV1)
import assert from 'node:assert/strict';
import {
  buildCandidateFactsV1,
  buildCandidateAuthoritySnapshotV1,
  FACTS_SCOPE,
  FACTS_PRODUCER,
  FACTS_VERSION,
  SNAPSHOT_INPUT_SCOPE,
  VETTED_SCOPE,
  VETTED_POPULATION,
  SNAPSHOT_OUTPUT_SCOPE,
  SNAPSHOT_PRODUCER,
} from '../src/lib/candidateFactAuthority.js';

let n = 0, failed = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log(`ok ${n} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${n} - ${name}`); console.error(String((e && e.stack) || e)); }
}

// ---------- helpers ----------
const HEX = '0123456789abcdef';
const clone = (o) => JSON.parse(JSON.stringify(o));
function proof(caseId, rows, over = {}) {
  return { scope: SNAPSHOT_INPUT_SCOPE, caseId, complete: true, truncated: false, count: rows.length, rows, ...over };
}
// realistic stored row: triage carries JSON-cloned candidateFacts + literal verdict fields
function rowRel(id, caseId, rel) {
  const f = clone(buildCandidateFactsV1({ verdicts: { relevant: rel, clean: true, newsScene: true } }));
  return { id, caseId, triage: { relevant: rel, clean: true, newsScene: true, candidateFacts: f } };
}
function rowUnknownRel(id, caseId) {
  const f = clone(buildCandidateFactsV1({ verdicts: { clean: true, newsScene: true } })); // no literal relevant
  return { id, caseId, triage: { relevant: true, clean: true, newsScene: true, candidateFacts: f } };
}

// ==================== A) buildCandidateFactsV1 ====================
await test('A: facts carry scope/version/producer, no forbidden fields', () => {
  const f = buildCandidateFactsV1({ verdicts: { relevant: true }, identity: 'x', highRes: true, eligibility: 'ok', subjectBox: {}, pHashCluster: 'c', peopleBox: { x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(f.scope, FACTS_SCOPE);
  assert.equal(f.version, FACTS_VERSION);
  assert.equal(f.producer, FACTS_PRODUCER);
  for (const k of ['identity', 'highRes', 'eligibility', 'subjectBox', 'pHashCluster', 'peopleBox']) assert.ok(!(k in f), k);
  assert.deepEqual(Object.keys(f).sort(), ['faceBox', 'hash', 'producer', 'resolution', 'scope', 'verdicts', 'version']);
});

await test('A: verdicts include only literal booleans (no default-positive)', () => {
  const f = buildCandidateFactsV1({ verdicts: { relevant: undefined, clean: true, newsScene: 'yes' } });
  assert.deepEqual(f.verdicts, { clean: true });
});

await test('A: resolution full requires decodedBuffer + positive int dims, retains structured axes', () => {
  const f = buildCandidateFactsV1({ resolution: { decodedBuffer: true, provenance: 'full', width: 1024, height: 768 } });
  assert.deepEqual(f.resolution, { level: 'full', width: 1024, height: 768 });
});
await test('A: resolution unknown when decodedBuffer missing (reused metadata not proof)', () => {
  const f = buildCandidateFactsV1({ resolution: { provenance: 'full', width: 1024, height: 768 } });
  assert.deepEqual(f.resolution, { level: 'unknown', width: null, height: null });
});
await test('A: resolution unknown when width not positive integer', () => {
  const f = buildCandidateFactsV1({ resolution: { decodedBuffer: true, provenance: 'thumb', width: 0, height: 100 } });
  assert.deepEqual(f.resolution, { level: 'unknown', width: null, height: null });
});

await test('A: faceBox null=explicit-absent, missing=unknown, valid=x1y1x2y2, oob/invalid=unknown', () => {
  assert.equal(buildCandidateFactsV1({ faceBox: null }).faceBox, null);
  assert.equal(buildCandidateFactsV1({}).faceBox, 'unknown');
  assert.deepEqual(buildCandidateFactsV1({ faceBox: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }).faceBox, { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 });
  assert.equal(buildCandidateFactsV1({ faceBox: { x: 0.9, y: 0, w: 0.5, h: 0.1 } }).faceBox, 'unknown');
  assert.equal(buildCandidateFactsV1({ faceBox: { x: 'a', y: 0, w: 1, h: 1 } }).faceBox, 'unknown');
  assert.equal(buildCandidateFactsV1({ faceBox: undefined }).faceBox, 'unknown');
});

await test('A: hash 16 lower hex only; uppercase/len/algo => unknown; bad measuredFrom normalized', () => {
  assert.deepEqual(buildCandidateFactsV1({ hash: { value: HEX, algo: 'dhash_9x8_v1', measuredFrom: 'full' } }).hash, { value: HEX, algo: 'dhash_9x8_v1', measuredFrom: 'full' });
  assert.equal(buildCandidateFactsV1({ hash: { value: '0123456789ABCDEF', algo: 'dhash_9x8_v1', measuredFrom: 'full' } }).hash, 'unknown');
  assert.equal(buildCandidateFactsV1({ hash: { value: 'abc', algo: 'dhash_9x8_v1', measuredFrom: 'full' } }).hash, 'unknown');
  assert.equal(buildCandidateFactsV1({ hash: { value: HEX, algo: 'phash', measuredFrom: 'full' } }).hash, 'unknown');
  assert.deepEqual(buildCandidateFactsV1({ hash: { value: HEX, algo: 'dhash_9x8_v1', measuredFrom: 'weird' } }).hash, { value: HEX, algo: 'dhash_9x8_v1', measuredFrom: 'unknown' });
});

await test('A: resolution dimensions bounded — oversize width/height => unknown', () => {
  assert.deepEqual(buildCandidateFactsV1({ resolution: { decodedBuffer: true, provenance: 'full', width: 100001, height: 500 } }).resolution, { level: 'unknown', width: null, height: null });
  assert.deepEqual(buildCandidateFactsV1({ resolution: { decodedBuffer: true, provenance: 'full', width: 500, height: 999999 } }).resolution, { level: 'unknown', width: null, height: null });
  assert.deepEqual(buildCandidateFactsV1({ resolution: { decodedBuffer: true, provenance: 'thumb', width: 100000, height: 100000 } }).resolution, { level: 'thumb', width: 100000, height: 100000 });
});

await test('A: face box must have positive area — zero/negative area => unknown', () => {
  assert.equal(buildCandidateFactsV1({ faceBox: { x: 0.5, y: 0.5, w: 0, h: 0.2 } }).faceBox, 'unknown'); // w=0
  assert.equal(buildCandidateFactsV1({ faceBox: { x: 0.5, y: 0.5, w: 0.2, h: 0 } }).faceBox, 'unknown'); // h=0
  assert.equal(buildCandidateFactsV1({ faceBox: { x: 0.5, y: 0.5, w: -0.1, h: 0.1 } }).faceBox, 'unknown'); // negative
});

await test('A: hostile getters are NEVER invoked (zero invocations, no throw)', () => {
  let calls = 0;
  const d = {};
  for (const k of ['verdicts', 'resolution', 'faceBox', 'hash']) {
    Object.defineProperty(d, k, { enumerable: true, configurable: true, get() { calls++; throw new Error('getter invoked'); } });
  }
  const f = buildCandidateFactsV1(d);
  assert.equal(calls, 0);
  assert.deepEqual(f.verdicts, {});
  assert.deepEqual(f.resolution, { level: 'unknown', width: null, height: null });
  assert.equal(f.faceBox, 'unknown');
  assert.equal(f.hash, 'unknown');
});

await test('A: proxy trap throwing reflection does not throw (fail-closed)', () => {
  const p = new Proxy({}, {
    getOwnPropertyDescriptor() { throw new Error('trap'); },
    ownKeys() { throw new Error('trap'); },
    getPrototypeOf() { throw new Error('trap'); },
  });
  let f;
  assert.doesNotThrow(() => { f = buildCandidateFactsV1(p); });
  assert.equal(f.faceBox, 'unknown');
  assert.equal(f.hash, 'unknown');
  assert.deepEqual(f.verdicts, {});
});

await test('A: revoked proxy does not throw', () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  let f;
  assert.doesNotThrow(() => { f = buildCandidateFactsV1(proxy); });
  assert.equal(f.scope, FACTS_SCOPE);
  assert.deepEqual(f.verdicts, {});
});

await test('A: output deep-frozen and deterministic', () => {
  const d = { verdicts: { relevant: true, clean: false }, faceBox: { x: 0, y: 0, w: 0.5, h: 0.5 }, hash: { value: HEX, algo: 'dhash_9x8_v1', measuredFrom: 'thumb' }, resolution: { decodedBuffer: true, provenance: 'full', width: 800, height: 600 } };
  const f = buildCandidateFactsV1(d);
  assert.ok(Object.isFrozen(f) && Object.isFrozen(f.verdicts) && Object.isFrozen(f.resolution) && Object.isFrozen(f.faceBox) && Object.isFrozen(f.hash));
  assert.deepEqual(buildCandidateFactsV1(d), buildCandidateFactsV1(d));
});

// ==================== B) buildCandidateAuthoritySnapshotV1 ====================
await test('B: success shape — versioned store + vetted proofs + imageId candidates', () => {
  const rows = [rowRel('c1-1', 'C1', true), rowRel('c1-2', 'C1', false), rowRel('c1-3', 'C1', true)];
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', rows));
  assert.equal(out.universeComplete, true);
  assert.equal(out.scope, SNAPSHOT_OUTPUT_SCOPE);
  assert.equal(out.version, 1);
  assert.equal(out.producer, SNAPSHOT_PRODUCER);
  assert.deepEqual(out.storeProof, { scope: SNAPSHOT_INPUT_SCOPE, complete: true, truncated: false, expectedCount: 3, observedCount: 3 });
  assert.deepEqual(out.vettedProof, { scope: VETTED_SCOPE, complete: true, truncated: false, expectedCount: 2, observedCount: 2, population: VETTED_POPULATION, candidateFactsVersion: 1 });
  assert.deepEqual(out.candidates.map((c) => c.imageId), ['c1-1', 'c1-3']);
  assert.ok(out.candidates.every((c) => c.facts.scope === FACTS_SCOPE && c.facts.verdicts.relevant === true));
});

await test('B: vetted scope is EXACTLY case_image_store_full_vetted_v1 (never F full_vetted_v1)', () => {
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [rowRel('c1-1', 'C1', true)]));
  assert.equal(out.vettedProof.scope, 'case_image_store_full_vetted_v1');
  assert.notEqual(out.vettedProof.scope, 'full_vetted_v1');
});

await test('B: empty complete snapshot → complete universe, zero candidates', () => {
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [], { count: 0 }));
  assert.equal(out.universeComplete, true);
  assert.equal(out.candidates.length, 0);
  assert.equal(out.vettedProof.expectedCount, 0);
});

await test('B: relevant false excluded but universe stays complete', () => {
  const rows = [rowRel('a', 'C1', false), rowRel('c', 'C1', true), rowRel('d', 'C1', false)];
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', rows));
  assert.equal(out.universeComplete, true);
  assert.deepEqual(out.candidates.map((c) => c.imageId), ['c']);
  assert.equal(out.vettedProof.expectedCount, 1);
});

await test('B: DUAL relevant — missing candidateFacts.verdicts.relevant fails whole proof', () => {
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [rowUnknownRel('b', 'C1')], { count: 1 }));
  assert.equal(out.universeComplete, false);
  assert.equal(out.candidates, null);
  assert.ok(out.reasons.includes('BAD_RELEVANT'));
});
await test('B: DUAL relevant — missing triage.relevant fails whole proof', () => {
  const r = rowRel('x', 'C1', true); delete r.triage.relevant;
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [r], { count: 1 }));
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('BAD_RELEVANT'));
});
await test('B: DUAL relevant — non-boolean triage.relevant fails whole proof', () => {
  const r = rowRel('x', 'C1', true); r.triage.relevant = 'true';
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [r], { count: 1 }));
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('BAD_RELEVANT'));
});

await test('B: candidate retains STRUCTURED resolution dims', () => {
  const f = clone(buildCandidateFactsV1({ verdicts: { relevant: true }, resolution: { decodedBuffer: true, provenance: 'full', width: 900, height: 700 } }));
  const rows = [{ id: 'c1-1', caseId: 'C1', triage: { relevant: true, clean: true, newsScene: true, candidateFacts: f } }];
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', rows));
  assert.equal(out.universeComplete, true);
  assert.deepEqual(out.candidates[0].facts.resolution, { level: 'full', width: 900, height: 700 });
});

await test('B: LEGACY-ROW refusal — no candidateFacts => fail-closed, NO reconstruction', () => {
  const rows = [{ id: 'c1-1', caseId: 'C1', triage: { relevant: true, clean: true, newsScene: true } }];
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', rows));
  assert.equal(out.universeComplete, false);
  assert.equal(out.candidates, null);
  assert.equal(out.vettedProof, null);
  assert.equal(out.storeProof, null);
  assert.ok(out.reasons.includes('LEGACY_ROW'));
});

await test('B: wrong facts producer => BAD_FACTS', () => {
  const f = clone(buildCandidateFactsV1({ verdicts: { relevant: true, clean: true, newsScene: true } })); f.producer = 'SOMETHING_ELSE';
  const rows = [{ id: 'c1-1', caseId: 'C1', triage: { relevant: true, clean: true, newsScene: true, candidateFacts: f } }];
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', rows));
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('BAD_FACTS'));
});
await test('B: wrong facts version => BAD_FACTS', () => {
  const f = clone(buildCandidateFactsV1({ verdicts: { relevant: true, clean: true, newsScene: true } })); f.version = 2;
  const rows = [{ id: 'c1-1', caseId: 'C1', triage: { relevant: true, clean: true, newsScene: true, candidateFacts: f } }];
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', rows));
  assert.ok(out.reasons.includes('BAD_FACTS'));
});

await test('B: verdict disagreement (facts true vs triage false) => VERDICT_DISAGREE', () => {
  const f = clone(buildCandidateFactsV1({ verdicts: { relevant: true, clean: true, newsScene: true } }));
  const rows = [{ id: 'c1-1', caseId: 'C1', triage: { relevant: false, clean: true, newsScene: true, candidateFacts: f } }];
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', rows));
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('VERDICT_DISAGREE'));
});

await test('B: row caseId mismatch => CASE_MISMATCH', () => {
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [rowRel('c1-1', 'WRONG', true)]));
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('CASE_MISMATCH'));
});
await test('B: proof without string caseId => BAD_CASE_ID', () => {
  const out = buildCandidateAuthoritySnapshotV1({ scope: SNAPSHOT_INPUT_SCOPE, caseId: null, complete: true, truncated: false, count: 0, rows: [] });
  assert.ok(out.reasons.includes('BAD_CASE_ID'));
});

await test('B: duplicate id / count mismatch / truncated / not-complete / bad scope / oversize / untriaged / bad id', () => {
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', [rowRel('dup', 'C1', true), rowRel('dup', 'C1', true)], { count: 2 })).reasons.includes('DUP_ID'));
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', [rowRel('c1-1', 'C1', true)], { count: 0 })).reasons.includes('COUNT_MISMATCH'));
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', [rowRel('c1-1', 'C1', true)], { truncated: true })).reasons.includes('TRUNCATED'));
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', [rowRel('c1-1', 'C1', true)], { complete: false })).reasons.includes('NOT_COMPLETE'));
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', [rowRel('c1-1', 'C1', true)], { scope: 'other' })).reasons.includes('BAD_SCOPE'));
  const many = []; for (let i = 0; i < 2001; i++) many.push(rowRel('c1-' + i, 'C1', false));
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', many)).reasons.includes('OVERSIZE'));
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', [{ id: 'x', caseId: 'C1', triage: null }], { count: 1 })).reasons.includes('UNTRIAGED_ROW'));
  const badId = rowRel('x', 'C1', true); badId.id = 123;
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', [badId], { count: 1 })).reasons.includes('BAD_ID'));
});

await test('B: accessor on proof / row / facts => fail-closed, getters never fire', () => {
  // proof: key 'evil' อยู่นอก allowlist → UNEXPECTED_KEY (ตัดก่อนแตะ descriptor — getter ไม่ถูกเรียก)
  let fired = 0;
  const p = proof('C1', [rowRel('c1-1', 'C1', true)]);
  Object.defineProperty(p, 'evil', { enumerable: true, configurable: true, get() { fired++; throw new Error('x'); } });
  assert.ok(buildCandidateAuthoritySnapshotV1(p).reasons.includes('UNEXPECTED_KEY'));
  assert.equal(fired, 0, 'proof getter never invoked');

  // accessor บน key ที่ "อยู่ใน allowlist" → ต้องจับด้วย descriptor scan = GETTER
  const p2 = proof('C1', [rowRel('c1-1', 'C1', true)]);
  delete p2.count;
  Object.defineProperty(p2, 'count', { enumerable: true, configurable: true, get() { fired++; return 1; } });
  assert.ok(buildCandidateAuthoritySnapshotV1(p2).reasons.includes('GETTER'));
  assert.equal(fired, 0, 'allowlisted-key getter never invoked');

  // row: ไม่มี allowlist → accessor จับที่ descriptor scan = GETTER
  const r = rowRel('c1-1', 'C1', true);
  Object.defineProperty(r, 'evil', { enumerable: true, configurable: true, get() { fired++; return 1; } });
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', [r], { count: 1 })).reasons.includes('GETTER'));
  assert.equal(fired, 0, 'row getter never invoked');

  // facts: key แปลก/accessor → BAD_FACTS
  const f = clone(buildCandidateFactsV1({ verdicts: { relevant: true, clean: true, newsScene: true } }));
  Object.defineProperty(f, 'evil', { enumerable: true, configurable: true, get() { fired++; throw new Error('x'); } });
  const rows = [{ id: 'c1-1', caseId: 'C1', triage: { relevant: true, clean: true, newsScene: true, candidateFacts: f } }];
  assert.ok(buildCandidateAuthoritySnapshotV1(proof('C1', rows, { count: 1 })).reasons.includes('BAD_FACTS'));
  assert.equal(fired, 0, 'facts getter never invoked');
});

// ---------- P1-2 hostile huge-key regressions (per surface) ----------
function flood(base, count) {
  const o = { ...base };
  for (let i = 0; i < count; i++) o['zz_flood_' + i] = i;
  return o;
}

await test('B/P1-2: key-flooded PROOF (10k keys) fails closed with KEY_FLOOD before descriptor scan', () => {
  const p = flood(proof('C1', [rowRel('c1-1', 'C1', true)]), 10000);
  const out = buildCandidateAuthoritySnapshotV1(p);
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('KEY_FLOOD'));
});

await test('B/P1-2: key-flooded ROW (10k keys) fails closed with KEY_FLOOD', () => {
  const r = flood(rowRel('c1-1', 'C1', true), 10000);
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [r], { count: 1 }));
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('KEY_FLOOD'));
});

await test('B/P1-2: key-flooded TRIAGE (10k keys) fails closed with KEY_FLOOD', () => {
  const r = rowRel('c1-1', 'C1', true);
  r.triage = flood(r.triage, 10000);
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [r], { count: 1 }));
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('KEY_FLOOD'));
});

await test('B/P1-2: key-flooded / unknown-key FACTS fails closed with BAD_FACTS', () => {
  const mk = (factsMut) => {
    const f = factsMut(clone(buildCandidateFactsV1({ verdicts: { relevant: true, clean: true, newsScene: true } })));
    return proof('C1', [{ id: 'c1-1', caseId: 'C1', triage: { relevant: true, clean: true, newsScene: true, candidateFacts: f } }], { count: 1 });
  };
  assert.ok(buildCandidateAuthoritySnapshotV1(mk((f) => flood(f, 10000))).reasons.includes('BAD_FACTS'));
  assert.ok(buildCandidateAuthoritySnapshotV1(mk((f) => ({ ...f, extraField: 1 }))).reasons.includes('BAD_FACTS'));
});

await test('B/P1-2: key-flooded facts SUB-OBJECTS (verdicts/resolution/faceBox/hash) => BAD_FACTS', () => {
  const mkSub = (key, val) => {
    const f = clone(buildCandidateFactsV1({
      verdicts: { relevant: true, clean: true, newsScene: true },
      faceBox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      hash: { value: HEX, algo: 'dhash_9x8_v1', measuredFrom: 'full' },
      resolution: { decodedBuffer: true, provenance: 'full', width: 800, height: 600 },
    }));
    f[key] = val(f[key]);
    return proof('C1', [{ id: 'c1-1', caseId: 'C1', triage: { relevant: true, clean: true, newsScene: true, candidateFacts: f } }], { count: 1 });
  };
  for (const key of ['verdicts', 'resolution', 'faceBox', 'hash']) {
    const out = buildCandidateAuthoritySnapshotV1(mkSub(key, (v) => flood(v, 10000)));
    assert.ok(out.reasons.includes('BAD_FACTS'), key + ' flood');
    const out2 = buildCandidateAuthoritySnapshotV1(mkSub(key, (v) => ({ ...v, zzUnknown: 1 })));
    assert.ok(out2.reasons.includes('BAD_FACTS'), key + ' unknown key');
  }
});

await test('B/P1-2: symbol key on row => UNEXPECTED_KEY fail-closed', () => {
  const r = rowRel('c1-1', 'C1', true);
  r[Symbol('evil')] = 1;
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [r], { count: 1 }));
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('UNEXPECTED_KEY'));
});

await test('B: proxy-trap proof / revoked-proxy row NEVER throw (fail-closed)', () => {
  const p = new Proxy({}, { getPrototypeOf() { throw new Error('x'); }, ownKeys() { throw new Error('x'); }, getOwnPropertyDescriptor() { throw new Error('x'); } });
  let a; assert.doesNotThrow(() => { a = buildCandidateAuthoritySnapshotV1(p); });
  assert.equal(a.universeComplete, false);

  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  let b; assert.doesNotThrow(() => { b = buildCandidateAuthoritySnapshotV1(proof('C1', [proxy], { count: 1 })); });
  assert.equal(b.universeComplete, false);
});

await test('B: revoked-proxy rows container (Array.isArray/length paths) NEVER throws', () => {
  const { proxy, revoke } = Proxy.revocable([], {}); revoke();
  const hostile = { scope: SNAPSHOT_INPUT_SCOPE, caseId: 'C1', complete: true, truncated: false, count: 0, rows: proxy };
  let out; assert.doesNotThrow(() => { out = buildCandidateAuthoritySnapshotV1(hostile); });
  assert.equal(out.universeComplete, false);
});

await test('B: rows proxy with throwing length/descriptor traps NEVER throws (fail-closed)', () => {
  const rowsProxy = new Proxy([], {
    get(t, k) { if (k === 'length') throw new Error('len'); return t[k]; },
    getOwnPropertyDescriptor(t, k) { if (k === 'length') throw new Error('len-desc'); return Object.getOwnPropertyDescriptor(t, k); },
  });
  const hostile = { scope: SNAPSHOT_INPUT_SCOPE, caseId: 'C1', complete: true, truncated: false, count: 0, rows: rowsProxy };
  let out; assert.doesNotThrow(() => { out = buildCandidateAuthoritySnapshotV1(hostile); });
  assert.equal(out.universeComplete, false);
  assert.ok(out.reasons.includes('ROWS_UNREADABLE'));
});

await test('B: success output deep-frozen; accepts JSON-cloned (unfrozen) stored facts', () => {
  const out = buildCandidateAuthoritySnapshotV1(proof('C1', [rowRel('c1-1', 'C1', true)]));
  assert.ok(Object.isFrozen(out) && Object.isFrozen(out.candidates) && Object.isFrozen(out.candidates[0]) && Object.isFrozen(out.vettedProof) && Object.isFrozen(out.storeProof));
});

console.log(`\n# candidate-fact-authority: ${n} tests, ${failed} failed`);
if (failed) process.exit(1);
