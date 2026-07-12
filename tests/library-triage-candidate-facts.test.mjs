// Focused tests — src/lib/libraryTriage.js buildTriage candidateFacts (additive, persisted, conservative)
import assert from 'node:assert/strict';
import { buildTriage } from '../src/lib/libraryTriage.js';
import { buildCandidateAuthoritySnapshotV1 } from '../src/lib/candidateFactAuthority.js';

let n = 0, failed = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log(`ok ${n} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${n} - ${name}`); console.error(String((e && e.stack) || e)); }
}

const HEX = '0123456789abcdef';

await test('triage: candidateFacts is PERSISTED in the returned triage (versioned + producer stamped)', () => {
  const it = { relevant: true, clean: true, newsScene: true, category: 'face-neutral', quality: 7 };
  const src = { im: { id: 'C1-1' }, brightness: 120, detail: 55, realWidth: 800, realHeight: 600, measuredFrom: 'full', sharpness: 100, pHash64: HEX };
  const t = buildTriage(it, src);
  assert.ok(t.candidateFacts, 'candidateFacts present');
  assert.equal(t.candidateFacts.scope, 'candidate_facts_v1');
  assert.equal(t.candidateFacts.version, 1);
  assert.equal(t.candidateFacts.producer, 'LIBRARY_TRIAGE_CANDIDATE_FACTS_V1');
});

await test('triage: legacy parity — stripping candidateFacts leaves the exact legacy triage', () => {
  const it = { relevant: true, clean: true, newsScene: true, category: 'face-neutral', quality: 7 };
  const src = { im: { id: 'C1-1' }, brightness: 120, detail: 55, realWidth: 800, realHeight: 600, measuredFrom: 'full', sharpness: 100, pHash64: HEX };
  const t = buildTriage(it, src);
  const { candidateFacts, ...rest } = t;
  const expectedLegacy = {
    relevant: true, newsScene: true, clean: true, category: 'face-neutral', person: null, persons: [], emotion: null,
    quality: 7, faceCount: 0, faceBox: null, peopleBox: null, brightness: 120, detail: 55, note: '',
    realShortSide: 600, sharpness: 100, measuredFrom: 'full', pHash64: HEX,
  };
  assert.deepEqual(rest, expectedLegacy);
});

await test('triage: verdict relevant is KNOWN only from literal it.relevant (no default-positive)', () => {
  // literal true → known true
  const t1 = buildTriage({ relevant: true, clean: true, newsScene: true }, { im: {}, pHash64: HEX });
  assert.equal(t1.candidateFacts.verdicts.relevant, true);
  // it.relevant undefined → verdict relevant ABSENT (unknown), but legacy triage.relevant stays derived-true
  const t2 = buildTriage({ clean: true, newsScene: true }, { im: {}, pHash64: HEX });
  assert.ok(!('relevant' in t2.candidateFacts.verdicts), 'no literal relevant verdict');
  assert.equal(t2.candidateFacts.verdicts.clean, true);
  assert.equal(t2.candidateFacts.verdicts.newsScene, true);
  assert.equal(t2.relevant, true, 'legacy derived relevant unchanged');
  // literal false → known false
  const t3 = buildTriage({ relevant: false }, { im: {}, pHash64: HEX });
  assert.equal(t3.candidateFacts.verdicts.relevant, false);
});

await test('triage: resolution is UNKNOWN (reused metadata + inferred measuredFrom are not proof)', () => {
  const it = { relevant: true };
  const src = { im: { id: 'x', rehostQuality: 'full' }, realWidth: 1200, realHeight: 900, measuredFrom: 'full', pHash64: HEX };
  const t = buildTriage(it, src);
  assert.deepEqual(t.candidateFacts.resolution, { level: 'unknown', width: null, height: null });
});

await test('triage: hash carries decoded-buffer pHash value with measuredFrom UNKNOWN; no pHash => hash unknown', () => {
  const t1 = buildTriage({ relevant: true }, { im: {}, measuredFrom: 'full', pHash64: HEX });
  assert.deepEqual(t1.candidateFacts.hash, { value: HEX, algo: 'dhash_9x8_v1', measuredFrom: 'unknown' });
  const t2 = buildTriage({ relevant: true }, { im: {} });
  assert.equal(t2.candidateFacts.hash, 'unknown');
});

await test('triage: faceBox normalized converts; null=explicit-absent; missing=unknown', () => {
  const t1 = buildTriage({ relevant: true, faceBox: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }, { im: {} });
  assert.deepEqual(t1.candidateFacts.faceBox, { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 });
  const t2 = buildTriage({ relevant: true, faceBox: null }, { im: {} });
  assert.equal(t2.candidateFacts.faceBox, null);
  const t3 = buildTriage({ relevant: true }, { im: {} });
  assert.equal(t3.candidateFacts.faceBox, 'unknown');
});

await test('triage: produced candidateFacts is ACCEPTED by the authority validator (E→B round-trip)', () => {
  const it = { relevant: true, clean: true, newsScene: true };
  const src = { im: { id: 'C1-1' }, pHash64: HEX };
  const t = buildTriage(it, src);
  const row = { id: 'C1-1', caseId: 'C1', triage: JSON.parse(JSON.stringify(t)) };
  const proof = { scope: 'case_image_store_snapshot_v1', caseId: 'C1', complete: true, truncated: false, count: 1, rows: [row] };
  const out = buildCandidateAuthoritySnapshotV1(proof);
  assert.equal(out.universeComplete, true);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].imageId, 'C1-1');
  assert.equal(out.candidates[0].facts.verdicts.relevant, true);
});

console.log(`\n# library-triage-candidate-facts: ${n} tests, ${failed} failed`);
if (failed) process.exit(1);
