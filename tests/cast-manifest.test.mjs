// Deterministic tests for the Cast Manifest reconciliation contract.
// Run WITHOUT node_modules:  node --test tests/cast-manifest.test.mjs
// Every assertion is deterministic (no time, no randomness, no IO) — matches the
// tests/decision-evidence.test.mjs convention: plain node:test + node:assert/strict,
// importing the ESM `.js` module under test with named imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CAST_MANIFEST_VERSION,
  OMISSION_REASONS,
  CastManifestError,
  buildCastManifest,
  canonicalizeCastManifest,
  hashCastManifest,
  evaluateCastAssetHolds,
  evaluatePersonOmissions,
  evaluateRepeatedIdentityCoverage,
  computePersonId,
  assertCastManifestIntegrity,
  validateCastManifestStructure,
} from '../src/lib/castManifest.js';

// A fully-eligible candidate readiness row (all six gates true). sourceAssetId is now mandatory
// (round-3 corrective fix) — default it deterministically from candidateId so every existing
// call site keeps a stable, unique asset identity without having to be touched individually;
// pass `over.sourceAssetId` to override when a test needs to control it explicitly.
const readyCandidate = (name, candidateId, over = {}) => ({
  name,
  candidateId,
  sourceAssetId: `asset-${candidateId}`,
  searched: true,
  triaged: true,
  clean: true,
  highResolution: true,
  cropSafe: true,
  identityVerified: true,
  ...over,
});

// =========================================================================
// 1. Golden case — explicit required-cast evidence for three people, spread
//    across all three sources, must all resolve to mustRepresent:true.
// =========================================================================
test('golden case: explicit required-cast evidence from article/compass/analyze => all mustRepresent:true', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    compass: { requiredCast: ['Minnie'], mainCharacters: [{ name: 'Minnie', role: 'reaction' }] },
    analyze: { requiredCast: ['Nene'] },
  });
  assert.equal(manifest.version, CAST_MANIFEST_VERSION);
  assert.equal(manifest.people.length, 3);
  const byName = Object.fromEntries(manifest.people.map((p) => [p.canonicalName, p]));
  assert.ok(byName.Lisa);
  assert.ok(byName.Minnie);
  assert.ok(byName.Nene);
  assert.equal(byName.Lisa.mustRepresent, true);
  assert.equal(byName.Minnie.mustRepresent, true);
  assert.equal(byName.Nene.mustRepresent, true);
  // no eligible candidates were supplied at all => manifest-level HOLD for all three
  assert.equal(manifest.hold.holdType, 'INSUFFICIENT_CAST_ASSETS');
  assert.equal(manifest.hold.canonicalNames.length, 3);
});

// =========================================================================
// 2. Conflicting role/alias from compass vs analyze for the same person.
// =========================================================================
test('alias evidence merges compass+analyze into one record with full sourceEvidence trail', () => {
  const manifest = buildCastManifest({
    compass: { mainCharacters: [{ name: 'Lalisa', role: 'reaction' }] },
    analyze: { mainCharacter: { name: 'Lisa' } }, // implicit 'hero' role
    aliases: [{ alias: 'Lalisa', canonicalName: 'Lisa' }],
  });
  assert.equal(manifest.people.length, 1);
  const lisa = manifest.people[0];
  assert.equal(lisa.canonicalName, 'Lisa');
  // conflicting roles reconciled to the higher-ranked one (hero > reaction)
  assert.equal(lisa.editorialRole, 'hero');
  assert.equal(lisa.mustRepresent, true); // hero evidence alone is sufficient
  assert.equal(lisa.sourceEvidence.length, 2);
  const sources = lisa.sourceEvidence.map((e) => e.source).sort();
  assert.deepEqual(sources, ['analyze', 'compass']);
  const compassRow = lisa.sourceEvidence.find((e) => e.source === 'compass');
  const analyzeRow = lisa.sourceEvidence.find((e) => e.source === 'analyze');
  assert.equal(compassRow.raw, 'Lalisa');
  assert.equal(compassRow.role, 'reaction');
  assert.equal(analyzeRow.raw, 'Lisa');
  assert.equal(analyzeRow.role, 'hero');
});

test('without alias evidence, genuinely ambiguous spellings stay separate (fail-closed, no guessing)', () => {
  const manifest = buildCastManifest({
    compass: { mainCharacters: [{ name: 'Lalisa', role: 'reaction' }] },
    analyze: { mainCharacter: { name: 'Lisa' } },
    // no aliases supplied
  });
  assert.equal(manifest.people.length, 2);
  const names = manifest.people.map((p) => p.canonicalName).sort();
  assert.deepEqual(names, ['Lalisa', 'Lisa']);
});

// =========================================================================
// 3. Optional fourth person uncovered by proposed assignment => typed reason.
// =========================================================================
test('optional uncovered person gets a typed omission reason, never blank/boolean', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    compass: { mainCharacters: [{ name: 'Somchai', role: 'context' }] }, // optional, not required
    candidates: [
      readyCandidate('Lisa', 'c-lisa-1'),
      readyCandidate('Somchai', 'c-som-1'),
    ],
  });
  const somchai = manifest.people.find((p) => p.canonicalName === 'Somchai');
  assert.equal(somchai.mustRepresent, false);
  assert.equal(somchai.hasEligibleCandidate, true);

  // Case A: slots remain (no capacity ceiling given) => low_priority
  const lisa = manifest.people.find((p) => p.canonicalName === 'Lisa');
  const omissionsA = evaluatePersonOmissions(
    manifest,
    [{ slotId: 'hero', personId: lisa.personId }],
    { expectedHash: manifest.hash },
  );
  assert.equal(omissionsA.length, 1);
  assert.equal(omissionsA[0].personId, somchai.personId);
  assert.equal(omissionsA[0].reason, 'low_priority');
  assert.ok(OMISSION_REASONS.includes(omissionsA[0].reason));
  assert.equal(typeof omissionsA[0].reason, 'string'); // typed string, not a bare boolean

  // Case B: capacity is exhausted => slot_capacity_exhausted
  const omissionsB = evaluatePersonOmissions(
    manifest,
    [{ slotId: 'hero', personId: lisa.personId }],
    { totalSlotCount: 1, expectedHash: manifest.hash },
  );
  assert.equal(omissionsB[0].reason, 'slot_capacity_exhausted');

  // Case C: person has no eligible candidate at all => no_eligible_asset
  const manifestNoAsset = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    compass: { mainCharacters: [{ name: 'Somchai', role: 'context' }] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')], // Somchai gets none
  });
  const lisa2 = manifestNoAsset.people.find((p) => p.canonicalName === 'Lisa');
  const somchai2 = manifestNoAsset.people.find((p) => p.canonicalName === 'Somchai');
  assert.equal(somchai2.hasEligibleCandidate, false);
  const omissionsC = evaluatePersonOmissions(
    manifestNoAsset,
    [{ slotId: 'hero', personId: lisa2.personId }],
    { expectedHash: manifestNoAsset.hash },
  );
  assert.equal(omissionsC[0].personId, somchai2.personId);
  assert.equal(omissionsC[0].reason, 'no_eligible_asset');
});

// =========================================================================
// 4. mustRepresent:true with zero eligible candidates => manifest-level HOLD.
// =========================================================================
test('Nene mustRepresent:true with zero eligible candidates => INSUFFICIENT_CAST_ASSETS HOLD naming Nene', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa', 'Minnie', 'Nene'] },
    candidates: [
      readyCandidate('Lisa', 'c-lisa-1'),
      readyCandidate('Minnie', 'c-minnie-1'),
      // Nene: zero candidates supplied at all
    ],
  });
  const nene = manifest.people.find((p) => p.canonicalName === 'Nene');
  assert.equal(nene.mustRepresent, true);
  assert.equal(nene.hasEligibleCandidate, false);
  assert.equal(nene.eligibleCandidateCount, 0);

  assert.ok(manifest.hold);
  assert.equal(manifest.hold.holdType, 'INSUFFICIENT_CAST_ASSETS');
  assert.deepEqual(manifest.hold.canonicalNames, ['Nene']);
  assert.deepEqual(manifest.hold.personIds, [nene.personId]);

  // pure recompute agrees (does not trust the cached manifest.hold field)
  const recomputed = evaluateCastAssetHolds(manifest, { expectedHash: manifest.hash });
  assert.deepEqual(recomputed, manifest.hold);

  // also covers "zero eligible candidates" via candidates that exist but fail readiness gates
  const manifest2 = buildCastManifest({
    article: { requiredCast: ['Nene'] },
    candidates: [readyCandidate('Nene', 'c-nene-1', { cropSafe: false })],
  });
  const nene2 = manifest2.people.find((p) => p.canonicalName === 'Nene');
  assert.equal(nene2.eligibleCandidateCount, 0);
  assert.equal(
    evaluateCastAssetHolds(manifest2, { expectedHash: manifest2.hash }).canonicalNames.includes('Nene'),
    true,
  );
});

// =========================================================================
// 5. Coverage evaluator — missing coverage is blocking on its own; repetition
//    is a separate, additional flag (fix #2).
// =========================================================================
test('coverage evaluator: missing coverage is blocking on its own; repetition is a separate additional flag', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa', 'Minnie', 'Nene'] },
    candidates: [
      readyCandidate('Lisa', 'c-lisa-1'),
      readyCandidate('Minnie', 'c-minnie-1'),
      readyCandidate('Nene', 'c-nene-1'),
    ],
  });
  const lisa = manifest.people.find((p) => p.canonicalName === 'Lisa');
  const minnie = manifest.people.find((p) => p.canonicalName === 'Minnie');
  const nene = manifest.people.find((p) => p.canonicalName === 'Nene');

  // Lisa repeated into a 2nd slot while Minnie AND Nene (mustRepresent + eligible) are
  // uncovered => both REQUIRED_PERSON_UNCOVERED and the repetition-specific flag fire.
  const badAssignment = [
    { slotId: 'hero', personId: lisa.personId },
    { slotId: 'reaction', personId: lisa.personId },
  ];
  const badResult = evaluateRepeatedIdentityCoverage(manifest, badAssignment, { expectedHash: manifest.hash });
  assert.deepEqual(badResult.repeatedPersonIds, [lisa.personId]);
  assert.ok(badResult.uncoveredRequiredPersonIds.includes(nene.personId));
  assert.ok(badResult.uncoveredRequiredPersonIds.includes(minnie.personId));
  assert.ok(badResult.flags.includes('REQUIRED_PERSON_UNCOVERED'));
  assert.ok(badResult.flags.includes('REPEATED_IDENTITY_BEFORE_FULL_COVERAGE'));

  // Corrected assignment: all three covered exactly once => no violation at all.
  const goodAssignment = [
    { slotId: 'hero', personId: lisa.personId },
    { slotId: 'reaction', personId: minnie.personId },
    { slotId: 'context', personId: nene.personId },
  ];
  const goodResult = evaluateRepeatedIdentityCoverage(manifest, goodAssignment, { expectedHash: manifest.hash });
  assert.deepEqual(goodResult.flags, []);
  assert.deepEqual(goodResult.repeatedPersonIds, []);
  assert.deepEqual(goodResult.uncoveredRequiredPersonIds, []);

  // Repetition alone, with full coverage otherwise achieved, is NOT a violation (only
  // "repeated while a feasible required person remains uncovered" is flagged).
  const repeatedButFullyCovered = [
    { slotId: 'hero', personId: lisa.personId },
    { slotId: 'reaction', personId: minnie.personId },
    { slotId: 'context', personId: nene.personId },
    { slotId: 'extra', personId: lisa.personId },
  ];
  const okResult = evaluateRepeatedIdentityCoverage(manifest, repeatedButFullyCovered, { expectedHash: manifest.hash });
  assert.deepEqual(okResult.flags, []);

  // Fix #2 — the core bug: omitting ONE feasible required person, with ZERO repetition
  // anywhere in the assignment, must still be a blocking violation on its own.
  const missingOnlyAssignment = [
    { slotId: 'hero', personId: lisa.personId },
    { slotId: 'reaction', personId: minnie.personId },
    // Nene omitted; nobody repeated anywhere.
  ];
  const missingOnlyResult = evaluateRepeatedIdentityCoverage(
    manifest,
    missingOnlyAssignment,
    { expectedHash: manifest.hash },
  );
  assert.deepEqual(missingOnlyResult.repeatedPersonIds, []);
  assert.deepEqual(missingOnlyResult.uncoveredRequiredPersonIds, [nene.personId]);
  assert.ok(missingOnlyResult.flags.includes('REQUIRED_PERSON_UNCOVERED'));
  assert.ok(!missingOnlyResult.flags.includes('REPEATED_IDENTITY_BEFORE_FULL_COVERAGE'));
});

// =========================================================================
// 6. Determinism — reordering equivalent inputs => identical canonical manifest + hash.
// =========================================================================
test('determinism: reordered sources/aliases/candidates produce identical manifest and hash', () => {
  const buildA = () => buildCastManifest({
    article: { requiredCast: ['Lisa', 'Minnie', 'Nene'] },
    compass: {
      mainCharacters: [
        { name: 'Minnie', role: 'reaction' },
        { name: 'Lalisa', role: 'hero' },
      ],
    },
    analyze: { characters: ['Nene', 'Somchai'] },
    aliases: [
      { alias: 'Lalisa', canonicalName: 'Lisa' },
      { alias: 'Somchai', canonicalName: 'Somchai' },
    ],
    candidates: [
      readyCandidate('Lisa', 'c-lisa-1'),
      readyCandidate('Minnie', 'c-minnie-1'),
      readyCandidate('Nene', 'c-nene-1'),
      readyCandidate('Somchai', 'c-som-1'),
    ],
  });

  // Same logical input, everything reordered: requiredCast order, mainCharacters order,
  // characters order, aliases order, candidates order.
  const buildB = () => buildCastManifest({
    article: { requiredCast: ['Nene', 'Lisa', 'Minnie'] },
    compass: {
      mainCharacters: [
        { name: 'Lalisa', role: 'hero' },
        { name: 'Minnie', role: 'reaction' },
      ],
    },
    analyze: { characters: ['Somchai', 'Nene'] },
    aliases: [
      { alias: 'Somchai', canonicalName: 'Somchai' },
      { alias: 'Lalisa', canonicalName: 'Lisa' },
    ],
    candidates: [
      readyCandidate('Somchai', 'c-som-1'),
      readyCandidate('Nene', 'c-nene-1'),
      readyCandidate('Minnie', 'c-minnie-1'),
      readyCandidate('Lisa', 'c-lisa-1'),
    ],
  });

  const manifestA = buildA();
  const manifestB = buildB();

  assert.deepEqual(canonicalizeCastManifest(manifestA), canonicalizeCastManifest(manifestB));
  assert.equal(manifestA.hash, manifestB.hash);
  assert.equal(hashCastManifest(manifestA), hashCastManifest(manifestB));

  // Running the same build twice (no reordering at all) is trivially stable too.
  const manifestA2 = buildA();
  assert.equal(manifestA.hash, manifestA2.hash);
  assert.deepEqual(canonicalizeCastManifest(manifestA), canonicalizeCastManifest(manifestA2));
});

// =========================================================================
// Sanity: computePersonId is a pure deterministic function of the normalized name.
// =========================================================================
test('computePersonId is deterministic and case/whitespace-insensitive', () => {
  assert.equal(computePersonId('Lisa'), computePersonId('  lisa  '));
  assert.equal(computePersonId('Lisa'), computePersonId('LISA'));
  assert.notEqual(computePersonId('Lisa'), computePersonId('Minnie'));
  assert.equal(computePersonId(''), null);
});

// =========================================================================
// Fix #1 — real explicit-story-evidence rule for mustRepresent, source-agnostic, not
// conditioned on a synthetic requiredCast array.
// =========================================================================
test('compass.mainCharacters explicit non-context roles establish mustRepresent:true with NO requiredCast array at all', () => {
  const manifest = buildCastManifest({
    compass: {
      mainCharacters: [
        { name: 'Lisa', role: 'hero' },
        { name: 'Minnie', role: 'reaction' },
        { name: 'Nene', role: 'reaction' },
      ],
    },
    // Minnie/Nene's compass-sourced 'reaction' role is a SINGLE source and, after fix #1's
    // redesign, is no longer sufficient alone — it needs cross-source corroboration (rule c).
    // Lisa needs no corroboration at all: an explicit 'hero' role alone is always sufficient
    // (rule b), because 'hero' always outranks every other token for that person.
    analyze: {
      characters: ['Minnie', 'Nene'],
    },
    // Deliberately no requiredCast anywhere.
  });
  assert.equal(manifest.people.length, 3);
  for (const name of ['Lisa', 'Minnie', 'Nene']) {
    const p = manifest.people.find((x) => x.canonicalName === name);
    assert.ok(p, `${name} missing from manifest`);
    assert.equal(p.mustRepresent, true, `${name} should resolve mustRepresent:true`);
  }
});

test('a lone single-source explicit "reaction" role, uncorroborated, does NOT establish mustRepresent:true (fix #1 behavior change)', () => {
  const manifest = buildCastManifest({
    compass: { mainCharacters: [{ name: 'Minnie', role: 'reaction' }] },
    // No analyze corroboration, no requiredCast, no 'hero' role anywhere.
  });
  const minnie = manifest.people.find((p) => p.canonicalName === 'Minnie');
  assert.ok(minnie);
  assert.equal(minnie.editorialRole, 'reaction');
  assert.equal(minnie.mustRepresent, false);
});

test('cross-source corroboration establishes mustRepresent:true from role-less mentions alone, with zero requiredCast anywhere (fix #1 rule c)', () => {
  const manifest = buildCastManifest({
    compass: { mainCharacters: ['Lisa', { name: 'Minnie' }, 'Nene'] },
    analyze: { characters: [{ name: 'Lisa' }, 'Minnie', { name: 'Nene' }] },
    // Zero requiredCast anywhere, zero role tokens anywhere — pure cross-source name
    // corroboration is the only signal.
  });
  assert.equal(manifest.people.length, 3);
  for (const name of ['Lisa', 'Minnie', 'Nene']) {
    const p = manifest.people.find((x) => x.canonicalName === name);
    assert.ok(p, `${name} missing from manifest`);
    assert.equal(p.editorialRole, null, `${name} has no role token anywhere, should stay null`);
    assert.equal(p.mustRepresent, true, `${name} should resolve mustRepresent:true purely via cross-source corroboration`);
  }

  // Companion: a name appearing in compass.mainCharacters ONLY (no analyze corroboration at
  // all) stays optional — one source's role-less mention is never enough by itself.
  const compassOnly = buildCastManifest({
    compass: { mainCharacters: ['Somchai'] },
  });
  const somchai = compassOnly.people.find((p) => p.canonicalName === 'Somchai');
  assert.ok(somchai);
  assert.equal(somchai.mustRepresent, false);
});

test('a role-less mention in a single weak source does NOT establish mustRepresent:true', () => {
  const manifest = buildCastManifest({
    analyze: { characters: ['Somchai'] }, // plain string, no role, single weak/ambiguous source
  });
  const somchai = manifest.people.find((p) => p.canonicalName === 'Somchai');
  assert.ok(somchai);
  assert.equal(somchai.mustRepresent, false);
});

test('an explicit "context" role never establishes mustRepresent:true, even from multiple sources', () => {
  const manifest = buildCastManifest({
    compass: { mainCharacters: [{ name: 'Somchai', role: 'context' }] },
    analyze: { characters: [{ name: 'Somchai', role: 'background' }] }, // synonym of 'context'
  });
  const somchai = manifest.people.find((p) => p.canonicalName === 'Somchai');
  assert.equal(somchai.mustRepresent, false);
});

test('buildCastManifest has no `reference` parameter — a `reference` field on the input is silently ignored, zero effect on output or hash', () => {
  const withoutRef = buildCastManifest({ compass: { mainCharacters: [{ name: 'Nene', role: 'context' }] } });
  const withRef = buildCastManifest({
    compass: { mainCharacters: [{ name: 'Nene', role: 'context' }] },
    reference: { mainCharacters: [{ name: 'Nene', role: 'hero', mustRepresent: true }] }, // not a real param
  });
  assert.equal(withoutRef.hash, withRef.hash);
  assert.deepEqual(canonicalizeCastManifest(withoutRef), canonicalizeCastManifest(withRef));
  const nene = withRef.people.find((p) => p.canonicalName === 'Nene');
  assert.equal(nene.mustRepresent, false);
});

// =========================================================================
// Fix #2 (also see test #5 above) — a mustRepresent:true uncovered person is never routed
// through the optional-omission path (fix #8), it always routes to a blocking flag instead.
// =========================================================================
test('a mustRepresent:true uncovered person is never routed through the optional-omission path (fix #8)', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa', 'Minnie'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Minnie', 'c-minnie-1')],
  });
  const lisa = manifest.people.find((p) => p.canonicalName === 'Lisa');
  const minnie = manifest.people.find((p) => p.canonicalName === 'Minnie');

  const omissions = evaluatePersonOmissions(
    manifest,
    [{ slotId: 'hero', personId: lisa.personId }],
    { expectedHash: manifest.hash },
  );
  assert.equal(omissions.length, 0); // Minnie must NOT appear here with a typed optional reason
  assert.equal(omissions.some((o) => o.personId === minnie.personId), false);

  const coverage = evaluateRepeatedIdentityCoverage(
    manifest,
    [{ slotId: 'hero', personId: lisa.personId }],
    { expectedHash: manifest.hash },
  );
  assert.ok(coverage.flags.includes('REQUIRED_PERSON_UNCOVERED'));
  assert.deepEqual(coverage.uncoveredRequiredPersonIds, [minnie.personId]);
});

// =========================================================================
// Fix #3 — evaluators recompute eligibility fresh from raw readiness fields; never trust a
// cached hasEligibleCandidate/eligible shortcut boolean, even if it is internally
// hash-consistent (i.e. even hash validity alone does not protect against this).
// =========================================================================
test('a cached "shortcut eligible" boolean set to true (with real readiness fields all false) is never trusted', () => {
  const base = buildCastManifest({
    article: { requiredCast: ['Nene'] },
    candidates: [{
      name: 'Nene', candidateId: 'c-nene-1', sourceAssetId: 'asset-nene-1',
      searched: false, triaged: false, clean: false, highResolution: false, cropSafe: false, identityVerified: false,
    }],
  });
  // `base` is frozen (fix #4); build a mutable plain-object copy the way a caller could (e.g.
  // round-tripping through storage/JSON), tamper the cached shortcut booleans, then re-sign
  // the hash the way a hostile-but-not-omniscient caller would — proving hash validity alone
  // (fix #3's other half) does not, by itself, catch this specific tamper.
  const tampered = JSON.parse(JSON.stringify(base));
  tampered.people[0].hasEligibleCandidate = true;
  tampered.people[0].eligibleCandidateCount = 1;
  tampered.people[0].candidates[0].eligible = true;
  tampered.hash = hashCastManifest(tampered); // re-signed after tampering -> passes hash check

  // expectedHash is mandatory now, so pass the tampered clone's OWN re-signed hash — this
  // proves the hash-validity check alone (structural + self/expected hash) is satisfied, and
  // it is still the deeper recompute-from-raw-fields logic that catches the tamper.
  const hold = evaluateCastAssetHolds(tampered, { expectedHash: tampered.hash });
  assert.ok(hold, 'must still HOLD: the real readiness fields are all false');
  assert.deepEqual(hold.canonicalNames, ['Nene']);

  const coverage = evaluateRepeatedIdentityCoverage(
    tampered,
    [{ slotId: 'hero', personId: tampered.people[0].personId }],
    { expectedHash: tampered.hash },
  );
  // Nene is not actually eligible, so she must NOT be treated as a "feasible" required
  // person for coverage purposes even though she also isn't in the assignment.
  assert.deepEqual(coverage.uncoveredRequiredPersonIds, []);
  assert.deepEqual(coverage.flags, []);
});

test('structural schema and hash validation happen BEFORE any HOLD/coverage judgment', () => {
  // Structurally invalid manifests.
  assert.throws(() => evaluateCastAssetHolds(null), CastManifestError);
  assert.throws(() => evaluateCastAssetHolds({ people: 'not-an-array' }), CastManifestError);
  assert.throws(() => evaluatePersonOmissions({ version: 1, people: [], unmatchedCandidates: [], hold: null }), CastManifestError); // missing hash

  // Self hash-mismatched manifest (content doesn't match its own recorded hash).
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const forged = JSON.parse(JSON.stringify(manifest));
  forged.hash = 'deadbeef'; // does not match the recomputed hash of this (untouched) content
  assert.throws(() => evaluateCastAssetHolds(forged), CastManifestError);
  assert.throws(() => evaluatePersonOmissions(forged, []), CastManifestError);
  assert.throws(() => evaluateRepeatedIdentityCoverage(forged, []), CastManifestError);

  // Caller-supplied expectedHash mismatch is rejected too, even when the manifest's own
  // self-hash is valid.
  assert.doesNotThrow(() => evaluateCastAssetHolds(manifest, { expectedHash: manifest.hash }));
  assert.throws(() => evaluateCastAssetHolds(manifest, { expectedHash: 'not-the-real-hash' }), CastManifestError);
});

// =========================================================================
// Corrective fix — expectedHash is now MANDATORY on every evaluator call, never optional.
// Self-consistency (manifest.hash === recomputedHash) alone is never sufficient: it only
// proves a manifest is internally uncorrupted, not that it is the SAME manifest the caller
// actually trusts. An attacker who can tamper content can always re-sign a self-consistent
// hash for the tampered copy.
// =========================================================================
test('absent/invalid expectedHash is rejected on an otherwise-perfectly-valid manifest', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  assert.throws(() => evaluateCastAssetHolds(manifest), CastManifestError); // no opts at all
  assert.throws(() => evaluateCastAssetHolds(manifest, {}), CastManifestError); // opts present, no expectedHash
  assert.throws(() => evaluateCastAssetHolds(manifest, { expectedHash: null }), CastManifestError);
  assert.throws(() => evaluateCastAssetHolds(manifest, { expectedHash: 123 }), CastManifestError); // wrong type
  assert.throws(() => evaluateCastAssetHolds(manifest, { expectedHash: '' }), CastManifestError); // empty string
  assert.throws(() => evaluatePersonOmissions(manifest, []), CastManifestError);
  assert.throws(() => evaluatePersonOmissions(manifest, [], {}), CastManifestError);
  assert.throws(() => evaluateRepeatedIdentityCoverage(manifest, []), CastManifestError);
  assert.throws(() => evaluateRepeatedIdentityCoverage(manifest, [], { expectedHash: undefined }), CastManifestError);
  assert.throws(() => assertCastManifestIntegrity(manifest), CastManifestError);
  assert.throws(() => assertCastManifestIntegrity(manifest, ''), CastManifestError);
  // Sanity: a real, correct expectedHash is accepted.
  assert.doesNotThrow(() => evaluateCastAssetHolds(manifest, { expectedHash: manifest.hash }));
  assert.doesNotThrow(() => assertCastManifestIntegrity(manifest, manifest.hash));
});

test('self-rehash-forgery: tampering then recomputing a self-consistent hash is still rejected against the real trusted hash', () => {
  const realManifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    compass: { mainCharacters: [{ name: 'Minnie', role: 'context' }] }, // optional
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Minnie', 'c-minnie-1')],
  });
  const realTrustedHash = realManifest.hash;

  const tamperedClone = JSON.parse(JSON.stringify(realManifest));
  const minnie = tamperedClone.people.find((p) => p.canonicalName === 'Minnie');
  assert.equal(minnie.mustRepresent, false); // sanity: really was false before tamper
  minnie.mustRepresent = true; // flip false -> true
  // Re-sign the tampered clone's OWN self-consistent hash — an attacker who can call
  // hashCastManifest() can always do this much.
  tamperedClone.hash = hashCastManifest(tamperedClone);

  // The clone is internally self-consistent (its stored hash matches its own recomputed
  // hash), so evaluating it against ITS OWN re-signed hash succeeds...
  assert.doesNotThrow(() => evaluateCastAssetHolds(tamperedClone, { expectedHash: tamperedClone.hash }));
  // ...but evaluating it against the ORIGINAL manifest's real trusted hash must be rejected,
  // proving self-consistency alone never substitutes for the caller's externally-trusted hash.
  assert.throws(() => evaluateCastAssetHolds(tamperedClone, { expectedHash: realTrustedHash }), CastManifestError);
  assert.throws(() => evaluatePersonOmissions(tamperedClone, [], { expectedHash: realTrustedHash }), CastManifestError);
  assert.throws(
    () => evaluateRepeatedIdentityCoverage(tamperedClone, [], { expectedHash: realTrustedHash }),
    CastManifestError,
  );
});

// =========================================================================
// Corrective fix — raw structural validation is exact-shape: wrong version, unknown/surplus
// keys at any nested level, and non-boolean/missing readiness fields are all rejected BEFORE
// canonicalizeCastManifest/hashCastManifest ever run on the manifest (fix #3).
// =========================================================================
test('raw structural validation rejects wrong version, surplus/unknown keys, and non-boolean/missing readiness fields', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  assert.equal(validateCastManifestStructure(real), null); // sanity: the real manifest is valid

  // (i) wrong version — still numeric, but not exactly CAST_MANIFEST_VERSION.
  const wrongVersion = JSON.parse(JSON.stringify(real));
  wrongVersion.version = 2;
  assert.notEqual(validateCastManifestStructure(wrongVersion), null);
  assert.throws(() => assertCastManifestIntegrity(wrongVersion, real.hash), CastManifestError);

  // (ii) unknown top-level key.
  const rogueTopLevel = JSON.parse(JSON.stringify(real));
  rogueTopLevel.rogueField = 'x';
  assert.notEqual(validateCastManifestStructure(rogueTopLevel), null);
  assert.throws(() => assertCastManifestIntegrity(rogueTopLevel, real.hash), CastManifestError);

  // (iii) surplus/unknown key on a person object.
  const roguePerson = JSON.parse(JSON.stringify(real));
  roguePerson.people[0].rogueField = 'x';
  assert.notEqual(validateCastManifestStructure(roguePerson), null);
  assert.throws(() => assertCastManifestIntegrity(roguePerson, real.hash), CastManifestError);

  // (iv) a candidate readiness field present but not a real boolean (string, not boolean).
  const stringBoolean = JSON.parse(JSON.stringify(real));
  stringBoolean.people[0].candidates[0].searched = 'true';
  assert.notEqual(validateCastManifestStructure(stringBoolean), null);
  assert.throws(() => assertCastManifestIntegrity(stringBoolean, real.hash), CastManifestError);

  // (v) a candidate missing one of the six readiness keys entirely.
  const missingKey = JSON.parse(JSON.stringify(real));
  delete missingKey.people[0].candidates[0].searched;
  assert.notEqual(validateCastManifestStructure(missingKey), null);
  assert.throws(() => assertCastManifestIntegrity(missingKey, real.hash), CastManifestError);

  // Sanity: the real, untouched manifest still passes the full integrity gate.
  assert.doesNotThrow(() => assertCastManifestIntegrity(real, real.hash));
});

// =========================================================================
// Fix #4 — deep-frozen manifest: mutation attempts throw and never affect evaluator output.
// =========================================================================
test('returned manifest is deep-frozen: mutation attempts throw and have zero effect on evaluator output', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.people));
  assert.ok(Object.isFrozen(manifest.people[0]));
  assert.ok(Object.isFrozen(manifest.people[0].candidates));
  assert.ok(Object.isFrozen(manifest.people[0].candidates[0]));

  assert.throws(() => { manifest.people[0].mustRepresent = false; }, TypeError);
  assert.throws(() => { manifest.people[0].candidates[0].searched = false; }, TypeError);
  assert.throws(() => { manifest.people.push({ personId: 'fake' }); }, TypeError);

  // Because the writes above threw (never applied), evaluator output is unaffected.
  const hold = evaluateCastAssetHolds(manifest, { expectedHash: manifest.hash });
  assert.equal(hold, null); // Lisa still has her one eligible candidate
});

// =========================================================================
// Fix #5 — conflicting alias claims fail closed deterministically, independent of input order.
// =========================================================================
test('two people genuinely claiming the same alias fail closed, identically regardless of array order', () => {
  const buildWithAliasOrder = (aliasOrder) => buildCastManifest({
    compass: { mainCharacters: [{ name: 'Nene', role: 'hero' }, { name: 'Minnie', role: 'hero' }] },
    aliases: aliasOrder,
  });
  const orderA = [{ alias: 'N', canonicalName: 'Nene' }, { alias: 'N', canonicalName: 'Minnie' }];
  const orderB = [{ alias: 'N', canonicalName: 'Minnie' }, { alias: 'N', canonicalName: 'Nene' }];
  assert.throws(() => buildWithAliasOrder(orderA), CastManifestError);
  assert.throws(() => buildWithAliasOrder(orderB), CastManifestError);
  try {
    buildWithAliasOrder(orderA);
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.errorType, 'ALIAS_CONFLICT');
  }
  // Non-conflicting duplicate rows (same alias, same target, repeated) must NOT throw.
  assert.doesNotThrow(() => buildCastManifest({
    compass: { mainCharacters: [{ name: 'Nene', role: 'hero' }] },
    aliases: [{ alias: 'N', canonicalName: 'Nene' }, { alias: 'N', canonicalName: 'Nene' }],
  }));
});

// =========================================================================
// Fix #6 — auto-generated candidateId is derived from stable content, not array index.
// =========================================================================
test('an auto-generated candidateId is content-derived and stable across different array positions', () => {
  const rawCandidate = {
    name: 'Lisa', sourceAssetId: 'asset-lisa-raw',
    searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
  };
  const manifestFirst = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [{ ...rawCandidate }, readyCandidate('Minnie', 'c-minnie-1')],
  });
  const manifestSecond = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Minnie', 'c-minnie-1'), { ...rawCandidate }, readyCandidate('Nene', 'c-nene-1')],
  });
  const idFirst = manifestFirst.people.find((p) => p.canonicalName === 'Lisa').candidates[0].candidateId;
  const lisaSecond = manifestSecond.people.find((p) => p.canonicalName === 'Lisa');
  const idSecond = lisaSecond.candidates[0].candidateId;
  assert.equal(idFirst, idSecond);
  assert.notEqual(idFirst, 'cand_0');
  assert.notEqual(idFirst, 'cand_1');
  assert.match(idFirst, /^cand_[0-9a-f]{8}$/);
});

// =========================================================================
// Round-3 corrective fix (P2.1) — REPLACES the old "sort deterministically" behavior. Two
// candidates sharing the SAME explicit candidateId but different content (i.e. two genuinely
// different photo assets) must now be REJECTED fail-closed, identically regardless of input
// array order — never silently accepted as two entries coexisting under one id.
// =========================================================================
test('two candidates sharing the same explicit candidateId but different content (distinct assets) are rejected fail-closed, identically regardless of input order', () => {
  const candA = {
    name: 'Lisa', candidateId: 'dup-1', sourceAssetId: 'asset-lisa-photo-A',
    searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
  };
  const candB = {
    name: 'Lisa', candidateId: 'dup-1', sourceAssetId: 'asset-lisa-photo-B',
    searched: true, triaged: false, clean: false, highResolution: false, cropSafe: false, identityVerified: false,
  };

  const buildAB = () => buildCastManifest({ article: { requiredCast: ['Lisa'] }, candidates: [candA, candB] });
  const buildBA = () => buildCastManifest({ article: { requiredCast: ['Lisa'] }, candidates: [candB, candA] });

  assert.throws(buildAB, CastManifestError);
  assert.throws(buildBA, CastManifestError);
  try {
    buildAB();
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.errorType, 'DUPLICATE_CANDIDATE_ID');
  }
  try {
    buildBA();
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.errorType, 'DUPLICATE_CANDIDATE_ID');
  }
});

// =========================================================================
// Round-3 corrective additions (P1 + P2) — hostile tests for the newly-hardened schema
// validation and candidate-identity collision/order-dependence fixes.
// =========================================================================

test('a candidate missing sourceAssetId (or with an empty/whitespace-only one) is rejected fail-closed — no name/readiness-only asset identity allowed', () => {
  assert.throws(() => buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [{
      name: 'Lisa', candidateId: 'c-1',
      searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
    }],
  }), CastManifestError);
  assert.throws(() => buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [{
      name: 'Lisa', candidateId: 'c-1', sourceAssetId: '   ',
      searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
    }],
  }), CastManifestError);
  try {
    buildCastManifest({
      article: { requiredCast: ['Lisa'] },
      candidates: [{
        name: 'Lisa', candidateId: 'c-1',
        searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
      }],
    });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.errorType, 'CANDIDATE_ASSET_ID_MISSING');
  }
});

test('duplicate sourceAssetId with conflicting content is rejected fail-closed', () => {
  const build = () => buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [
      {
        name: 'Lisa', sourceAssetId: 'asset-shared', candidateId: 'id-a',
        searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
      },
      {
        name: 'Lisa', sourceAssetId: 'asset-shared', candidateId: 'id-b',
        searched: false, triaged: false, clean: false, highResolution: false, cropSafe: false, identityVerified: false,
      },
    ],
  });
  assert.throws(build, CastManifestError);
  try {
    build();
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.errorType, 'DUPLICATE_SOURCE_ASSET_ID');
  }
});

test('same person, two distinct assets with identical name+readiness content get DIFFERENT candidateIds once sourceAssetId is included (fixes the round-3 same-person-distinct-asset collision)', () => {
  const build = (order) => buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: order.map((sourceAssetId) => ({
      name: 'Lisa', sourceAssetId,
      searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
    })),
  });
  const manifest = build(['asset-lisa-shot-1', 'asset-lisa-shot-2']);
  const cands = manifest.people[0].candidates;
  assert.equal(cands.length, 2);
  assert.notEqual(cands[0].candidateId, cands[1].candidateId);
  assert.deepEqual(cands.map((c) => c.sourceAssetId).slice().sort(), ['asset-lisa-shot-1', 'asset-lisa-shot-2']);

  // Deterministic regardless of input order.
  const reordered = build(['asset-lisa-shot-2', 'asset-lisa-shot-1']);
  assert.deepEqual(canonicalizeCastManifest(manifest), canonicalizeCastManifest(reordered));
  assert.equal(manifest.hash, reordered.hash);
});

test('an explicit candidateId that collides with a DIFFERENT row\'s auto-derived candidateId is rejected as a typed collision, not silently accepted', () => {
  // Discover what this row's auto-derived candidateId actually is.
  const probe = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [{
      name: 'Lisa', sourceAssetId: 'asset-lisa-collision-probe',
      searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
    }],
  });
  const derivedId = probe.people[0].candidates[0].candidateId;
  assert.match(derivedId, /^cand_[0-9a-f]{8}$/);

  // A second row with a DIFFERENT sourceAssetId but an EXPLICIT candidateId forced to collide
  // with the first row's auto-derived id. Must be rejected — never silently accepted as two
  // "different" rows sharing one id, and never resolved by array order.
  const build = () => buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [
      {
        name: 'Lisa', sourceAssetId: 'asset-lisa-collision-probe',
        searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
      },
      {
        name: 'Lisa', candidateId: derivedId, sourceAssetId: 'asset-lisa-DIFFERENT-photo',
        searched: false, triaged: false, clean: false, highResolution: false, cropSafe: false, identityVerified: false,
      },
    ],
  });
  assert.throws(build, CastManifestError);
  try {
    build();
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.errorType, 'CANDIDATE_ID_COLLISION');
  }
});

// =========================================================================
// Round-4 corrective fix — REPLACES the round-3 delimiter test, which put one candidate under
// each of two SEPARATE people (a 1-element `candidates` array each), so the tuple sort/
// comparator was never actually exercised against a second element (sorting a 1-element array
// is a no-op and "proves nothing"). This version puts THREE candidates in the SAME person's
// `candidates` array, with delimiter-like bytes in both sourceAssetId and candidateId, and
// checks the real resulting order plus determinism under full input reordering.
// =========================================================================
test('delimiter-like characters inside sourceAssetId/candidateId never invert ordering or cause a spurious collision — real same-array test', () => {
  const candAB = {
    name: 'Lisa', candidateId: 'ab', sourceAssetId: 'z-asset|weird:1',
    searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
  };
  const candA = {
    name: 'Lisa', candidateId: 'a', sourceAssetId: 'a-asset|weird:2',
    searched: false, triaged: false, clean: false, highResolution: false, cropSafe: false, identityVerified: false,
  };
  const candMid = {
    name: 'Lisa', candidateId: 'zzz', sourceAssetId: 'm-asset:mid',
    searched: true, triaged: false, clean: false, highResolution: false, cropSafe: false, identityVerified: false,
  };
  const build = (order) => buildCastManifest({ article: { requiredCast: ['Lisa'] }, candidates: order });

  const manifest = build([candAB, candA, candMid]);
  assert.equal(validateCastManifestStructure(manifest), null);
  const cands = manifest.people[0].candidates;
  assert.equal(cands.length, 3);
  // Ordered by sourceAssetId, the primary tuple field, as a whole opaque string per element —
  // 'a-asset...' < 'm-asset...' < 'z-asset...' — never by any concatenated/delimited reading.
  assert.deepEqual(cands.map((c) => c.sourceAssetId), ['a-asset|weird:2', 'm-asset:mid', 'z-asset|weird:1']);
  assert.deepEqual(cands.map((c) => c.candidateId), ['a', 'zzz', 'ab']);

  // Fully reordered input -> byte-identical canonical manifest and hash.
  const reordered = build([candMid, candAB, candA]);
  assert.deepEqual(canonicalizeCastManifest(manifest), canonicalizeCastManifest(reordered));
  assert.equal(manifest.hash, reordered.hash);
  assert.deepEqual(manifest.people[0].candidates, reordered.people[0].candidates);
});

// =========================================================================
// Round-4 corrective fix (P2 item 1) — sourceEvidence used to sort on a space-concatenated
// string key (`${source} ${raw} ${role||''}`), which collided whenever a value in one field
// contained the separator: {raw:'A', role:'B C'} and {raw:'A B', role:'C'} both produced the
// identical key "compass A B C". A real per-field tuple comparator never concatenates raw and
// role, so no field's content can bleed across that boundary.
// =========================================================================
test('sourceEvidence tuple ordering distinguishes (raw, role) pairs that collided under the old space-concatenated sort key, and stays deterministic under reordering', () => {
  const buildWithOrder = (mainCharacters) => buildCastManifest({
    compass: { mainCharacters },
    aliases: [
      { alias: 'A', canonicalName: 'Target Person' },
      { alias: 'A B', canonicalName: 'Target Person' },
    ],
  });
  // Old key `${source} ${raw} ${role||''}` collided: both produced "compass A B C".
  const entryOne = { name: 'A', role: 'B C' };
  const entryTwo = { name: 'A B', role: 'C' };

  const manifestOrder1 = buildWithOrder([entryOne, entryTwo]);
  const manifestOrder2 = buildWithOrder([entryTwo, entryOne]);

  assert.equal(manifestOrder1.people.length, 1);
  const evidence1 = manifestOrder1.people[0].sourceEvidence;
  const evidence2 = manifestOrder2.people[0].sourceEvidence;
  assert.equal(evidence1.length, 2);
  // Genuinely different (raw, role) pairs -- must remain distinguishable, not collapsed.
  assert.notDeepEqual(evidence1[0], evidence1[1]);
  assert.deepEqual(evidence1.map((e) => [e.raw, e.role]), [['A', 'B C'], ['A B', 'C']]);
  // Deterministic: identical relative order and identical manifest/hash regardless of input order.
  assert.deepEqual(evidence1, evidence2);
  assert.deepEqual(canonicalizeCastManifest(manifestOrder1), canonicalizeCastManifest(manifestOrder2));
  assert.equal(manifestOrder1.hash, manifestOrder2.hash);
});

// =========================================================================
// Round-4 corrective fix (P2 item 2) — the PUBLIC canonicalizeCastManifest/hashCastManifest
// must validate the exact public schema BEFORE any coercion, so a malformed/foreign manifest
// is rejected fail-closed rather than silently canonicalized through `??`/`!!`/default-array
// coercions. The evaluators' independent mandatory expectedHash requirement is unaffected.
// =========================================================================
test('public canonicalizeCastManifest/hashCastManifest reject malformed direct input fail-closed, before any coercion', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  assert.doesNotThrow(() => canonicalizeCastManifest(real));
  assert.doesNotThrow(() => hashCastManifest(real));

  assert.throws(() => canonicalizeCastManifest(null), CastManifestError);
  assert.throws(() => hashCastManifest(null), CastManifestError);
  assert.throws(() => canonicalizeCastManifest({}), CastManifestError);
  assert.throws(() => hashCastManifest({ version: 1 }), CastManifestError);

  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(real)); fn(c); return c; };
  // Missing hash entirely -- the exact chicken-and-egg case the private trusted path exists
  // for internally; a DIRECT public caller must never get that bypass.
  assert.throws(() => canonicalizeCastManifest(mutate((c) => { delete c.hash; })), CastManifestError);
  assert.throws(() => hashCastManifest(mutate((c) => { delete c.hash; })), CastManifestError);
  // Wrong version.
  assert.throws(() => canonicalizeCastManifest(mutate((c) => { c.version = 2; })), CastManifestError);
  // Surplus top-level key.
  assert.throws(() => canonicalizeCastManifest(mutate((c) => { c.rogue = 'x'; })), CastManifestError);
  // Boolean coercion (string "true" instead of a real boolean).
  assert.throws(() => canonicalizeCastManifest(mutate((c) => { c.people[0].candidates[0].searched = 'true'; })), CastManifestError);
  // Malformed sourceEvidence (invalid source enum).
  assert.throws(() => canonicalizeCastManifest(mutate((c) => {
    c.people[0].sourceEvidence = [{ source: 'not-a-real-source', raw: 'Lisa', role: null }];
  })), CastManifestError);
  // Malformed hold.
  assert.throws(() => canonicalizeCastManifest(mutate((c) => {
    c.hold = { holdType: 'NOT_REAL', personIds: [], canonicalNames: [] };
  })), CastManifestError);

  // Malformed unmatchedCandidates.
  const realWithUnmatched = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Untracked Person', 'c-untracked-1')],
  });
  const mutateUnmatched = (fn) => { const c = JSON.parse(JSON.stringify(realWithUnmatched)); fn(c); return c; };
  assert.throws(() => canonicalizeCastManifest(mutateUnmatched((c) => { c.unmatchedCandidates[0].candidateId = 999; })), CastManifestError);

  // Evaluators still require expectedHash independently -- unaffected by this public gate.
  assert.throws(() => evaluateCastAssetHolds(real), CastManifestError);
  assert.doesNotThrow(() => evaluateCastAssetHolds(real, { expectedHash: real.hash }));
});

// =========================================================================
// Round-4 corrective fix (P2 item 3) — every field semantically required to be a non-blank
// identifier (candidateId, sourceAssetId, personId, canonicalName, aliases, sourceEvidence.raw/
// role, hold.personIds/canonicalNames, hash) must reject a whitespace-only string, not just an
// empty one, in BOTH the builder and the foreign-manifest validator.
// =========================================================================
test('whitespace-only identifiers are rejected as fail-closed by the foreign-manifest validator, matching the builder\'s own trim-and-reject policy', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    compass: { mainCharacters: [{ name: 'Minnie', role: 'context' }] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Minnie', 'c-minnie-1')],
  });
  assert.equal(validateCastManifestStructure(real), null);
  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(real)); fn(c); return c; };

  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].personId = '   '; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].canonicalName = '\t\t'; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].aliases = ['   ']; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].sourceEvidence[0].raw = '  '; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].sourceEvidence[0].role = '  '; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].candidates[0].candidateId = '   '; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].candidates[0].sourceAssetId = '\n'; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.hash = '   '; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => {
    c.hold = { holdType: 'INSUFFICIENT_CAST_ASSETS', personIds: ['   '], canonicalNames: [] };
  })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => {
    c.hold = { holdType: 'INSUFFICIENT_CAST_ASSETS', personIds: [], canonicalNames: ['  '] };
  })), null);

  const realWithUnmatched = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Untracked Person', 'c-untracked-1')],
  });
  const mutateUnmatched = (fn) => { const c = JSON.parse(JSON.stringify(realWithUnmatched)); fn(c); return c; };
  assert.notEqual(validateCastManifestStructure(mutateUnmatched((c) => { c.unmatchedCandidates[0].candidateId = '   '; })), null);
  assert.notEqual(validateCastManifestStructure(mutateUnmatched((c) => { c.unmatchedCandidates[0].sourceAssetId = '\t'; })), null);

  // Sanity: untouched manifests still pass.
  assert.equal(validateCastManifestStructure(real), null);
  assert.equal(validateCastManifestStructure(realWithUnmatched), null);
});

test('builder treats a whitespace-only explicit candidateId the same as omitted (falls back to auto-derivation), and a whitespace-only sourceAssetId the same as missing (rejected)', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [{
      name: 'Lisa', candidateId: '   ', sourceAssetId: 'asset-lisa-1',
      searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
    }],
  });
  assert.match(manifest.people[0].candidates[0].candidateId, /^cand_[0-9a-f]{8}$/);

  // Whitespace-only via plain SPACES (not a tab): trims to empty -> "missing". A tab would now be
  // rejected earlier as a control character under the round-9 unified policy, which is a separate
  // concern; this test targets the whitespace-only "missing asset id" path specifically.
  const build = () => buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [{
      name: 'Lisa', candidateId: 'c-1', sourceAssetId: '   ',
      searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
    }],
  });
  assert.throws(build, CastManifestError);
  try {
    build();
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.errorType, 'CANDIDATE_ASSET_ID_MISSING');
  }
});

test('two unmatched candidates with identical readiness content but different names remain distinct and are ordered by name, not array position', () => {
  const build = (order) => buildCastManifest({ candidates: order });
  const somchai = {
    name: 'Somchai', sourceAssetId: 'asset-somchai-1', candidateId: 'c-som-1',
    searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
  };
  const anong = {
    name: 'Anong', sourceAssetId: 'asset-anong-1', candidateId: 'c-anong-1',
    searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
  };

  const manifest = build([somchai, anong]);
  assert.equal(manifest.unmatchedCandidates.length, 2);
  assert.deepEqual(manifest.unmatchedCandidates.map((c) => c.name), ['Anong', 'Somchai']);

  const reordered = build([anong, somchai]);
  assert.deepEqual(canonicalizeCastManifest(manifest), canonicalizeCastManifest(reordered));
  assert.equal(manifest.hash, reordered.hash);
});

test('raw structural validation rejects malformed nested fields: sourceEvidence, aliases, acceptableSlotRoles, editorialRole, priority, hasEligibleCandidate, eligibleCandidateCount, hold, and unmatchedCandidates', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    compass: { mainCharacters: [{ name: 'Minnie', role: 'context' }] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Minnie', 'c-minnie-1')],
  });
  assert.equal(validateCastManifestStructure(real), null);
  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(real)); fn(c); return c; };

  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].editorialRole = 'bogus-role'; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].priority = 'first'; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].priority = 0; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].acceptableSlotRoles = 'hero'; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].acceptableSlotRoles = ['bogus-role']; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].hasEligibleCandidate = 'yes'; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].eligibleCandidateCount = 'one'; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].eligibleCandidateCount = 999; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => { c.people[0].aliases = [42]; })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => {
    c.people[0].sourceEvidence = [{ source: 'not-a-real-source', raw: 'Lisa', role: null }];
  })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => {
    c.people[0].sourceEvidence = [{ source: 'article', raw: 'Lisa', role: null, extra: 'sneaky' }];
  })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => {
    c.people[0].sourceEvidence = [{ source: 'article', raw: 123, role: null }];
  })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => {
    c.hold = { holdType: 'NOT_A_REAL_HOLD_TYPE', personIds: [], canonicalNames: [] };
  })), null);
  assert.notEqual(validateCastManifestStructure(mutate((c) => {
    c.hold = { holdType: 'INSUFFICIENT_CAST_ASSETS', personIds: 'not-an-array', canonicalNames: [] };
  })), null);

  const realWithUnmatched = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [
      readyCandidate('Lisa', 'c-lisa-1'),
      readyCandidate('Untracked Person', 'c-untracked-1'),
    ],
  });
  assert.equal(realWithUnmatched.unmatchedCandidates.length, 1);
  const mutateUnmatched = (fn) => { const c = JSON.parse(JSON.stringify(realWithUnmatched)); fn(c); return c; };
  assert.notEqual(validateCastManifestStructure(mutateUnmatched((c) => { c.unmatchedCandidates[0].candidateId = 999; })), null);
  assert.notEqual(validateCastManifestStructure(mutateUnmatched((c) => { c.unmatchedCandidates[0].name = { nested: true }; })), null);
  assert.notEqual(validateCastManifestStructure(mutateUnmatched((c) => { c.unmatchedCandidates[0].sourceAssetId = ''; })), null);

  // Sanity: the real, untouched manifests still pass.
  assert.equal(validateCastManifestStructure(real), null);
  assert.equal(validateCastManifestStructure(realWithUnmatched), null);
});

// =========================================================================
// Fix #7 — a literal NUL byte in any name/alias/candidateId field is a typed rejection.
// =========================================================================
test('a literal NUL byte anywhere in name/alias/candidateId input is rejected as a typed validation failure', () => {
  assert.throws(() => buildCastManifest({ article: { requiredCast: ['Li\x00sa'] } }), CastManifestError);
  assert.throws(() => buildCastManifest({
    compass: { mainCharacters: [{ name: 'Nene', role: 'hero' }] },
    aliases: [{ alias: 'Ne\x00ne', canonicalName: 'Nene' }],
  }), CastManifestError);
  assert.throws(() => buildCastManifest({
    article: { requiredCast: ['Nene'] },
    candidates: [readyCandidate('Ne\x00ne', 'c-1')],
  }), CastManifestError);
  assert.throws(() => buildCastManifest({
    article: { requiredCast: ['Nene'] },
    candidates: [readyCandidate('Nene', 'c-\x001')],
  }), CastManifestError);
  try {
    buildCastManifest({ article: { requiredCast: ['Li\x00sa'] } });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.errorType, 'NUL_BYTE_REJECTED');
  }
});

// Regression lock: the NUL-byte check must test for an actual NUL byte (U+0000), never an
// ordinary SPACE (U+0020) — a real multi-word name containing a plain space must be accepted,
// not mistaken for containing a NUL byte. This would have failed under the old buggy check.
test('a normal multi-word name containing a plain space is correctly accepted, not mistaken for a NUL byte', () => {
  assert.doesNotThrow(() => buildCastManifest({ article: { requiredCast: ['Lisa Manoban'] } }));
  const manifest = buildCastManifest({ article: { requiredCast: ['Lisa Manoban'] } });
  const p = manifest.people.find((x) => x.canonicalName === 'Lisa Manoban');
  assert.ok(p, 'Lisa Manoban should be present in the manifest');
  assert.equal(p.mustRepresent, true); // via requiredCast, unaffected by the space in the name
});

// =========================================================================
// Round-5/6 corrective fix (P1) — personId collision / coverage bypass.
//
// A brute-force search (done as part of round 5's review, not asserted here since it took
// several seconds) found a REAL 32-bit FNV1a collision between two already-normalized-form
// strings: normalizeCastName("Af L Y") === "af l y" and normalizeCastName("Agnga") === "agnga"
// both hashed to 21081a8d under the original single-pass 32-bit fnv1a32. Round 5 closed this
// with a widened 128-bit multi-seed FNV construction; round 6 supersedes that with real, full
// SHA-256 (node:crypto), now that the module's "no imports" policy has been deliberately
// changed to allow deterministic Node built-ins. Two deterministic, non-probabilistic guards
// remain layered on top regardless of digest algorithm: build-time collision detection in
// buildCastManifest, and validator-side recompute-and-verify (personId must equal
// computePersonId(canonicalName)) in validateCastManifestStructure.
// =========================================================================
test('the exact name pair that collided under the original 32-bit FNV1a32 now derives DISTINCT personIds under the round-6 real SHA-256 digest, deterministically regardless of build order', () => {
  const idA = computePersonId('Af L Y');
  const idB = computePersonId('Agnga');
  assert.notEqual(idA, idB, 'the two names that collided under the old 32-bit hash must no longer collide');
  assert.match(idA, /^person_[0-9a-f]{64}$/, 'personId must carry a full, untruncated SHA-256 hex digest (64 chars)');
  assert.match(idB, /^person_[0-9a-f]{64}$/);

  const buildOrder1 = () => buildCastManifest({ article: { requiredCast: ['Af L Y', 'Agnga'] } });
  const buildOrder2 = () => buildCastManifest({ article: { requiredCast: ['Agnga', 'Af L Y'] } });
  assert.doesNotThrow(buildOrder1);
  assert.doesNotThrow(buildOrder2);
  const m1 = buildOrder1();
  const m2 = buildOrder2();
  assert.equal(m1.people.length, 2);
  assert.notEqual(m1.people[0].personId, m1.people[1].personId);
  assert.deepEqual(canonicalizeCastManifest(m1), canonicalizeCastManifest(m2));
  assert.equal(m1.hash, m2.hash);
});

test('the manifest-level hash is a full, untruncated SHA-256 hex digest, and tamper against a real expectedHash remains fail-closed', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  assert.match(manifest.hash, /^[0-9a-f]{64}$/, 'manifest.hash must be a full 64-hex-char SHA-256 digest, never truncated');
  assert.equal(hashCastManifest(manifest), manifest.hash);

  // The documented old-FNV collision pair also produces distinct manifest-level hashes now that
  // personId (embedded in the canonical form that gets hashed) differs between them.
  const mA = buildCastManifest({ article: { requiredCast: ['Af L Y'] } });
  const mB = buildCastManifest({ article: { requiredCast: ['Agnga'] } });
  assert.notEqual(mA.hash, mB.hash);

  // Tamper: flip one bit's worth of content, re-sign a self-consistent hash the way an attacker
  // who can call hashCastManifest() could -- still rejected against the real trusted hash.
  const tampered = JSON.parse(JSON.stringify(manifest));
  tampered.people[0].mustRepresent = false;
  tampered.hash = hashCastManifest(tampered);
  assert.notEqual(tampered.hash, manifest.hash);
  assert.throws(() => assertCastManifestIntegrity(tampered, manifest.hash), CastManifestError);
  assert.doesNotThrow(() => assertCastManifestIntegrity(tampered, tampered.hash));
});

test('a forged foreign manifest assigning the SAME personId to two DIFFERENT canonicalNames is rejected deterministically, in both array orders', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa', 'Minnie'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Minnie', 'c-minnie-1')],
  });
  assert.equal(validateCastManifestStructure(real), null);

  const forge = (reversed) => {
    const clone = JSON.parse(JSON.stringify(real));
    const idxLisa = clone.people.findIndex((p) => p.canonicalName === 'Lisa');
    const idxMinnie = clone.people.findIndex((p) => p.canonicalName === 'Minnie');
    // Force Minnie's personId to collide with Lisa's REAL personId -- a direct forgery (the
    // realistic threat model), not a found hash collision, which is now infeasible at 128 bits.
    clone.people[idxMinnie].personId = clone.people[idxLisa].personId;
    if (reversed) clone.people.reverse();
    return clone;
  };

  const forgedA = forge(false);
  const forgedB = forge(true);
  assert.notEqual(validateCastManifestStructure(forgedA), null);
  assert.notEqual(validateCastManifestStructure(forgedB), null);
  assert.throws(() => assertCastManifestIntegrity(forgedA, real.hash), CastManifestError);
  assert.throws(() => assertCastManifestIntegrity(forgedB, real.hash), CastManifestError);
  assert.throws(() => canonicalizeCastManifest(forgedA), CastManifestError);
  assert.throws(() => evaluateCastAssetHolds(forgedA, { expectedHash: real.hash }), CastManifestError);

  // Same typed rejection regardless of order -- no false coverage, no silent accept.
  let errA, errB;
  try { assertCastManifestIntegrity(forgedA, real.hash); } catch (e) { errA = e.errorType; }
  try { assertCastManifestIntegrity(forgedB, real.hash); } catch (e) { errB = e.errorType; }
  assert.equal(errA, 'INVALID_MANIFEST_STRUCTURE');
  assert.equal(errA, errB);
});

test('two person entries sharing the SAME (correctly-derived) personId for the SAME canonicalName are rejected as a duplicate, not silently treated as two distinct people', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const clone = JSON.parse(JSON.stringify(real));
  clone.people.push(JSON.parse(JSON.stringify(clone.people[0]))); // exact duplicate person record
  assert.notEqual(validateCastManifestStructure(clone), null);
  assert.throws(() => assertCastManifestIntegrity(clone, real.hash), CastManifestError);
});

test('a manifest built with build-time-unique personIds still passes coverage evaluation correctly, and one assignment row can never be misread as covering two distinct people', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa', 'Minnie'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Minnie', 'c-minnie-1')],
  });
  const lisa = manifest.people.find((p) => p.canonicalName === 'Lisa');
  const minnie = manifest.people.find((p) => p.canonicalName === 'Minnie');
  assert.notEqual(lisa.personId, minnie.personId);

  // Covering ONLY Lisa's personId must never be read as covering Minnie too.
  const coverage = evaluateRepeatedIdentityCoverage(
    manifest,
    [{ slotId: 'hero', personId: lisa.personId }],
    { expectedHash: manifest.hash },
  );
  assert.deepEqual(coverage.uncoveredRequiredPersonIds, [minnie.personId]);
  assert.ok(coverage.flags.includes('REQUIRED_PERSON_UNCOVERED'));
});

// =========================================================================
// Round-5 corrective fix (P2) — exact plain object gate. Replaces the old hasExactKeys, which
// only checked Object.keys() name membership, with isExactPlainRecord: rejects arrays,
// non-plain prototypes (class/Date/Map/Set instances), symbol-keyed surplus properties,
// non-enumerable surplus properties, and getter/setter accessor properties -- all WITHOUT ever
// invoking a getter (Object.getOwnPropertyDescriptor exposes a getter as a function reference,
// never calls it).
// =========================================================================
test('the exact plain object gate rejects arrays, non-plain prototypes, symbol keys, non-enumerable surplus keys, and accessor properties at top-level and every nested boundary, without ever invoking a getter', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  assert.equal(validateCastManifestStructure(real), null);

  // Top-level: arrays and built-in exotic-prototype instances can never satisfy the top-level shape.
  assert.notEqual(validateCastManifestStructure([1, 2, 3]), null);
  assert.notEqual(validateCastManifestStructure(new Map()), null);
  assert.notEqual(validateCastManifestStructure(new Date()), null);

  // Top-level: a class instance with the "right" own enumerable keys copied on still has a
  // non-Object.prototype prototype chain.
  class FakeManifest { constructor(src) { Object.assign(this, src); } }
  assert.notEqual(validateCastManifestStructure(new FakeManifest(real)), null);

  const clone = () => JSON.parse(JSON.stringify(real));

  // Nested person: an array standing in for the person object.
  const arrayPerson = clone();
  arrayPerson.people[0] = Object.values(real.people[0]);
  assert.notEqual(validateCastManifestStructure(arrayPerson), null);

  // Nested person/candidate/sourceEvidence: a Date/Map instance with the right own enumerable
  // keys copied on, standing in for a plain object at that boundary.
  const datePerson = clone();
  datePerson.people[0] = Object.assign(new Date(), real.people[0]);
  assert.notEqual(validateCastManifestStructure(datePerson), null);

  const mapCandidate = clone();
  mapCandidate.people[0].candidates[0] = Object.assign(new Map(), real.people[0].candidates[0]);
  assert.notEqual(validateCastManifestStructure(mapCandidate), null);

  const dateSourceEvidence = clone();
  dateSourceEvidence.people[0].sourceEvidence[0] = Object.assign(new Date(), real.people[0].sourceEvidence[0]);
  assert.notEqual(validateCastManifestStructure(dateSourceEvidence), null);

  // Symbol surplus key: invisible to Object.keys, a real own property nonetheless.
  const symbolSurplus = clone();
  symbolSurplus.people[0][Symbol('rogue')] = 'x';
  assert.notEqual(validateCastManifestStructure(symbolSurplus), null);

  // Non-enumerable surplus key: hidden from Object.keys/JSON.stringify but a real own property.
  const nonEnumSurplus = clone();
  Object.defineProperty(nonEnumSurplus.people[0], 'rogueHidden', { value: 'x', enumerable: false, configurable: true });
  assert.notEqual(validateCastManifestStructure(nonEnumSurplus), null);

  // Accessor property standing in for a required field -- rejected WITHOUT ever invoking the
  // getter (the getter below flips a flag if called; the assertion after proves it never fires).
  const accessorPerson = clone();
  let getterInvoked = false;
  Object.defineProperty(accessorPerson.people[0], 'personId', {
    get() { getterInvoked = true; return accessorPerson.people[0].canonicalName; },
    enumerable: true,
    configurable: true,
  });
  assert.notEqual(validateCastManifestStructure(accessorPerson), null);
  assert.equal(getterInvoked, false, 'the validator must never invoke a getter to check shape');

  // Sanity: the real, untouched manifest is still accepted throughout.
  assert.equal(validateCastManifestStructure(real), null);
});

test('the exact plain object gate also rejects exotic/accessor/symbol-keyed forms at the hold and unmatchedCandidate boundaries', () => {
  const realWithHold = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    // no candidates supplied at all -> Lisa is mustRepresent:true with zero eligible candidates
    // -> manifest-level HOLD is populated, giving a non-null hold object to attack.
  });
  assert.ok(realWithHold.hold);
  assert.equal(validateCastManifestStructure(realWithHold), null);

  const cloneHold = () => JSON.parse(JSON.stringify(realWithHold));
  const dateHold = cloneHold();
  dateHold.hold = Object.assign(new Date(), realWithHold.hold);
  assert.notEqual(validateCastManifestStructure(dateHold), null);

  const symbolHold = cloneHold();
  symbolHold.hold[Symbol('rogue')] = 'x';
  assert.notEqual(validateCastManifestStructure(symbolHold), null);

  const realWithUnmatched = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Untracked Person', 'c-untracked-1')],
  });
  assert.equal(realWithUnmatched.unmatchedCandidates.length, 1);
  const cloneUnmatched = () => JSON.parse(JSON.stringify(realWithUnmatched));

  const mapUnmatched = cloneUnmatched();
  mapUnmatched.unmatchedCandidates[0] = Object.assign(new Map(), realWithUnmatched.unmatchedCandidates[0]);
  assert.notEqual(validateCastManifestStructure(mapUnmatched), null);

  const accessorUnmatched = cloneUnmatched();
  let getterInvoked = false;
  Object.defineProperty(accessorUnmatched.unmatchedCandidates[0], 'sourceAssetId', {
    get() { getterInvoked = true; return 'forged-asset-id'; },
    enumerable: true,
    configurable: true,
  });
  assert.notEqual(validateCastManifestStructure(accessorUnmatched), null);
  assert.equal(getterInvoked, false);

  // Sanity: untouched manifests still pass.
  assert.equal(validateCastManifestStructure(realWithHold), null);
  assert.equal(validateCastManifestStructure(realWithUnmatched), null);
});

// =========================================================================
// Round-6 corrective fix (P2) — Proxy rejection, array-descriptor gate, and TOCTOU-immune
// snapshot. Every trap-spy Proxy below records whether ANY trap fired, proving types.isProxy
// rejects the value before any reflection is even attempted (not merely that a trap's return
// value gets ignored).
// =========================================================================

// A Proxy whose every trap is wired through Reflect (so it behaves identically to `target` if
// any trap DOES fire) but also flips `state.anyTrapCalled`, so a test can assert a trap never
// fired at all -- not just that its result was discarded.
function makeSpyProxy(target) {
  const state = { anyTrapCalled: false };
  const trapNames = [
    'get', 'set', 'has', 'deleteProperty', 'ownKeys', 'getOwnPropertyDescriptor',
    'defineProperty', 'getPrototypeOf', 'setPrototypeOf', 'isExtensible', 'preventExtensions',
  ];
  const handler = {};
  for (const name of trapNames) {
    handler[name] = (...args) => {
      state.anyTrapCalled = true;
      return Reflect[name](...args);
    };
  }
  return { proxy: new Proxy(target, handler), state };
}

test('a Proxy at the top-level manifest boundary is rejected without ever invoking any trap', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const { proxy, state } = makeSpyProxy(real);
  assert.notEqual(validateCastManifestStructure(proxy), null);
  assert.equal(state.anyTrapCalled, false, 'no Proxy trap should ever fire -- types.isProxy must reject it first');
  assert.throws(() => assertCastManifestIntegrity(proxy, real.hash), CastManifestError);
  assert.throws(() => canonicalizeCastManifest(proxy), CastManifestError);
  assert.throws(() => hashCastManifest(proxy), CastManifestError);
  assert.throws(() => evaluateCastAssetHolds(proxy, { expectedHash: real.hash }), CastManifestError);
  assert.equal(state.anyTrapCalled, false);
});

test('a Proxy standing in for a nested person record, or for the people/candidates array itself, is rejected without ever invoking any trap', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });

  // Nested record boundary: person object replaced by a Proxy wrapping an otherwise-identical
  // plain clone (constructing via JSON round-trip since `real` is deep-frozen).
  const personClone = JSON.parse(JSON.stringify(real.people[0]));
  const personSpy = makeSpyProxy(personClone);
  const proxiedPerson = { ...JSON.parse(JSON.stringify(real)), people: [personSpy.proxy] };
  assert.notEqual(validateCastManifestStructure(proxiedPerson), null);
  assert.equal(personSpy.state.anyTrapCalled, false);

  // Array boundary: the `people` array itself replaced by a Proxy wrapping a genuine array.
  const peopleClone = JSON.parse(JSON.stringify(real.people));
  const arraySpy = makeSpyProxy(peopleClone);
  const proxiedPeopleArray = { ...JSON.parse(JSON.stringify(real)), people: arraySpy.proxy };
  assert.notEqual(validateCastManifestStructure(proxiedPeopleArray), null);
  assert.equal(arraySpy.state.anyTrapCalled, false);

  // Array boundary, nested: a person's own `candidates` array replaced by a Proxy.
  const nestedClone = JSON.parse(JSON.stringify(real));
  const candidatesSpy = makeSpyProxy(nestedClone.people[0].candidates);
  nestedClone.people[0].candidates = candidatesSpy.proxy;
  assert.notEqual(validateCastManifestStructure(nestedClone), null);
  assert.equal(candidatesSpy.state.anyTrapCalled, false);
});

test('array-shape gate rejects holes, an accessor at an index, and a surplus own property, without ever invoking an index getter', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const baseClone = () => JSON.parse(JSON.stringify(real));

  // A hole: `people` has length 2 but index 1 is genuinely absent (not just undefined).
  const holey = baseClone();
  const arr = [];
  arr[0] = holey.people[0];
  arr[2] = JSON.parse(JSON.stringify(holey.people[0]));
  arr.length = 3; // index 1 is a real hole
  holey.people = arr;
  assert.notEqual(validateCastManifestStructure(holey), null);

  // An accessor standing in for an array index -- rejected WITHOUT ever invoking the getter.
  const accessorIndex = baseClone();
  let getterInvoked = false;
  Object.defineProperty(accessorIndex.people, '0', {
    get() { getterInvoked = true; return accessorIndex.people[0]; },
    enumerable: true,
    configurable: true,
  });
  assert.notEqual(validateCastManifestStructure(accessorIndex), null);
  assert.equal(getterInvoked, false, 'an accessor array index must never be invoked to check array shape');

  // A surplus own property on the array (out-of-range index masquerading as extra data).
  const surplusIndex = baseClone();
  surplusIndex.people[5] = { rogue: true };
  assert.notEqual(validateCastManifestStructure(surplusIndex), null);

  // Sanity: the real, untouched manifest is still accepted.
  assert.equal(validateCastManifestStructure(real), null);
});

test('the verified snapshot returned by assertCastManifestIntegrity shares no references with the caller\'s original object and is itself deep-frozen -- mutating the caller\'s object after verification cannot retroactively alter the snapshot', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const foreign = JSON.parse(JSON.stringify(real)); // a non-frozen, caller-owned clone
  const verified = assertCastManifestIntegrity(foreign, foreign.hash);

  assert.ok(Object.isFrozen(verified));
  assert.ok(Object.isFrozen(verified.people));
  assert.ok(Object.isFrozen(verified.people[0]));
  assert.ok(Object.isFrozen(verified.people[0].candidates));
  assert.ok(Object.isFrozen(verified.people[0].candidates[0]));

  const lisaBefore = JSON.parse(JSON.stringify(verified.people.find((p) => p.canonicalName === 'Lisa')));

  // Mutate the caller's OWN object deeply, after verification has already returned.
  foreign.people[0].mustRepresent = false;
  foreign.people[0].candidates[0].searched = false;
  foreign.people[0].candidates.push({
    candidateId: 'injected', sourceAssetId: 'injected-asset',
    searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true,
    eligible: true,
  });

  const lisaAfter = verified.people.find((p) => p.canonicalName === 'Lisa');
  assert.deepEqual(
    JSON.parse(JSON.stringify(lisaAfter)),
    lisaBefore,
    'the snapshot must be completely unaffected by mutation of the caller\'s original object after verification',
  );
  assert.equal(lisaAfter.candidates.length, 1, 'the snapshot must not see a candidate pushed onto the caller\'s array after verification');

  // Prove the snapshot immunity above isn't just because nothing ever re-validates: a genuinely
  // DIFFERENT manifest (Lisa's only candidate turned ineligible, with no replacement) is
  // evaluated correctly when properly re-verified from scratch.
  const genuinelyChanged = JSON.parse(JSON.stringify(real));
  genuinelyChanged.people[0].candidates[0].searched = false;
  genuinelyChanged.people[0].eligibleCandidateCount = 0;
  genuinelyChanged.people[0].hasEligibleCandidate = false;
  genuinelyChanged.hash = hashCastManifest(genuinelyChanged);
  const holdAfterGenuineChange = evaluateCastAssetHolds(genuinelyChanged, { expectedHash: genuinelyChanged.hash });
  assert.ok(holdAfterGenuineChange, 'a genuinely re-verified manifest where Lisa really has zero eligible candidates is correctly seen as a HOLD');
});

// =========================================================================
// Round-7 corrective fix — single-capture assertCastManifestIntegrity. Round 6's version called
// the PUBLIC hashCastManifest(manifest) for the hash comparison (re-running
// validateCastManifestStructure a second time and canonicalizeTrustedPayload once), then
// separately called canonicalizeTrustedPayload(manifest) a THIRD time to build the returned
// snapshot -- two independent canonicalizations of the same raw object, with no proof the hash
// that got compared and the snapshot that got returned were derived from the same read. Round 7
// captures `manifest` into a canonical payload exactly once; the hash, the manifest.hash/
// expectedHash comparisons, and the returned snapshot all derive from that one capture.
// =========================================================================
test('the verified snapshot is self-consistent: re-hashing/re-validating it independently via the PUBLIC API confirms the returned hash corresponds byte-for-byte to the returned snapshot content', () => {
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa', 'Minnie'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Minnie', 'c-minnie-1')],
  });
  const foreign = JSON.parse(JSON.stringify(real));
  const verified = assertCastManifestIntegrity(foreign, foreign.hash);

  assert.equal(typeof verified.hash, 'string');
  assert.match(verified.hash, /^[0-9a-f]{64}$/);
  assert.equal(verified.hash, foreign.hash, 'the verified snapshot\'s hash must equal the original manifest\'s recorded hash');

  // Independent, PUBLIC-API re-verification of the returned snapshot itself: re-validating and
  // re-hashing it from scratch reproduces the exact same shape and hash, proving the hash
  // returned genuinely corresponds to the exact content of the snapshot returned -- not to some
  // other, separately-captured copy.
  assert.equal(validateCastManifestStructure(verified), null);
  assert.equal(hashCastManifest(verified), verified.hash);
  assert.deepEqual(canonicalizeCastManifest(verified), canonicalizeCastManifest(real));

  // Sanity: still fully frozen and reference-independent from the caller's object (round-6
  // property, preserved).
  assert.ok(Object.isFrozen(verified));
  assert.ok(Object.isFrozen(verified.people));
});

function extractFunctionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start !== -1, `${signature} must be found in the source`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.ok(end !== -1, `closing brace for ${signature} must be found`);
  return source.slice(braceStart, end + 1);
}

// =========================================================================
// Round-8 corrective fix (true one-capture integrity) — REPLACES the round-7 source-level guard,
// which codified "one validateCastManifestStructure(raw) call + one canonicalizeTrustedPayload
// (raw) call" as the accepted shape. That is exactly a two-traversal implementation and must now
// FAIL this test: assertCastManifestIntegrity must call NEITHER of those two functions, nor the
// public hashCastManifest, at all -- only the single merged captureVerifiedManifest, exactly once.
// =========================================================================
test('source-level regression guard: assertCastManifestIntegrity performs a TRUE single capture -- it calls captureVerifiedManifest exactly once and calls NEITHER validateCastManifestStructure NOR canonicalizeTrustedPayload NOR the public hashCastManifest at all (a two-traversal "one validator plus one canonicalizer" implementation must fail this test)', () => {
  const sourcePath = fileURLToPath(new URL('../src/lib/castManifest.js', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const body = extractFunctionBody(source, 'export function assertCastManifestIntegrity');

  assert.equal(
    /\bhashCastManifest\s*\(/.test(body),
    false,
    'assertCastManifestIntegrity must not call the public hashCastManifest',
  );
  assert.equal(
    /\bvalidateCastManifestStructure\s*\(/.test(body),
    false,
    'assertCastManifestIntegrity must not call validateCastManifestStructure directly -- that would be a separate validation pass over the raw manifest, distinct from the single capture',
  );
  assert.equal(
    /\bcanonicalizeTrustedPayload\s*\(/.test(body),
    false,
    'assertCastManifestIntegrity must not call canonicalizeTrustedPayload directly -- that would be a separate canonicalization pass over the raw manifest, distinct from the single capture',
  );

  const captureCalls = body.match(/\bcaptureVerifiedManifest\s*\(/g) || [];
  assert.equal(captureCalls.length, 1, 'must call captureVerifiedManifest exactly once (the single merged validate-and-capture pass)');

  // The merged captureVerifiedManifest itself must not delegate back to the two-pass functions
  // either -- that would just move the two-traversal problem one level down.
  const captureBody = extractFunctionBody(source, 'function captureVerifiedManifest');
  assert.equal(/\bvalidateCastManifestStructure\s*\(/.test(captureBody), false, 'captureVerifiedManifest must not call validateCastManifestStructure');
  assert.equal(/\bcanonicalizeTrustedPayload\s*\(/.test(captureBody), false, 'captureVerifiedManifest must not call canonicalizeTrustedPayload');
  assert.equal(/\bhashCastManifest\s*\(/.test(captureBody), false, 'captureVerifiedManifest must not call the public hashCastManifest');

  // Round-9: captureVerifiedManifest must obtain every value through the descriptor-CAPTURING
  // helpers (which return the captured descriptor value) and must NOT re-read the raw manifest
  // after the single top-level capture. The previous (round-8) implementation re-read
  // `manifest.people`, `manifest.hold`, `manifest.hash`, `manifest.version` and
  // `manifest.unmatchedCandidates` throughout its body -- this guard fails that reread shape.
  assert.ok(/\bcaptureExactPlainRecord\s*\(/.test(captureBody), 'captureVerifiedManifest must use captureExactPlainRecord (value-returning descriptor gate)');
  assert.ok(/\bcaptureExactPlainArray\s*\(/.test(captureBody), 'captureVerifiedManifest must use captureExactPlainArray (value-returning descriptor gate)');
  assert.equal(
    /\bmanifest\s*\./.test(captureBody),
    false,
    'captureVerifiedManifest must never re-read a property off the raw `manifest` graph -- the single descriptor capture is captureExactPlainRecord(manifest, ...) with no dot access; a `manifest.<field>` reread (the round-8 implementation) must fail this test',
  );
});

// =========================================================================
// Round-8 corrective fix — foreign-manifest NUL/control-character rejection. The builder already
// rejects a literal NUL byte on its own raw inputs via assertNoNulByte(), but that check never
// ran on the FOREIGN-manifest path: validateCastManifestStructure's isNonBlankString only checked
// trim-length, and a NUL byte is not whitespace, so `"Li\0sa".trim().length > 0` was true. Every
// public entry point that funnels through validateCastManifestStructure (canonicalizeCastManifest,
// hashCastManifest, assertCastManifestIntegrity, and therefore every evaluator) inherited the gap.
// Control characters are built via String.fromCharCode(...) here rather than typed as literal
// escapes, deliberately, so this test file itself never carries a raw control byte.
// =========================================================================
test('every trusted string field rejects an embedded NUL byte via the PUBLIC foreign-manifest API (canonicalize/hash/integrity/evaluator), not just the builder', () => {
  const NUL = String.fromCharCode(0);
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  assert.equal(validateCastManifestStructure(real), null);
  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(real)); fn(c); return c; };

  const cases = {
    // canonicalName: recompute personId from the control-bearing name so that personId ===
    // computePersonId(canonicalName) HOLDS -- the ONLY remaining violation is the control
    // character in canonicalName, so this fixture unambiguously proves the canonicalName control
    // gate (not an incidental PERSON_ID_NAME_MISMATCH).
    canonicalName: mutate((c) => {
      c.people[0].canonicalName = 'Li' + NUL + 'sa';
      c.people[0].personId = computePersonId('Li' + NUL + 'sa');
    }),
    aliases: mutate((c) => { c.people[0].aliases = ['Li' + NUL + 'sa']; }),
    sourceEvidenceRaw: mutate((c) => { c.people[0].sourceEvidence[0].raw = 'Li' + NUL + 'sa'; }),
    sourceEvidenceRole: mutate((c) => {
      c.people[0].sourceEvidence[0] = { ...c.people[0].sourceEvidence[0], role: 'req' + NUL + 'uired-cast' };
    }),
    candidateId: mutate((c) => { c.people[0].candidates[0].candidateId = 'c' + NUL + '1'; }),
    sourceAssetId: mutate((c) => { c.people[0].candidates[0].sourceAssetId = 'asset' + NUL + '1'; }),
    hash: mutate((c) => { c.hash = c.hash.slice(0, 10) + NUL + c.hash.slice(11); }),
  };

  for (const [label, forged] of Object.entries(cases)) {
    assert.notEqual(validateCastManifestStructure(forged), null, `${label}: raw NUL must be rejected by validateCastManifestStructure`);
    assert.throws(() => canonicalizeCastManifest(forged), CastManifestError, `${label}: canonicalizeCastManifest must reject`);
    assert.throws(() => hashCastManifest(forged), CastManifestError, `${label}: hashCastManifest must reject`);
    assert.throws(() => assertCastManifestIntegrity(forged, real.hash), CastManifestError, `${label}: assertCastManifestIntegrity must reject`);
    assert.throws(() => evaluateCastAssetHolds(forged, { expectedHash: real.hash }), CastManifestError, `${label}: evaluateCastAssetHolds must reject`);
    assert.throws(() => evaluatePersonOmissions(forged, [], { expectedHash: real.hash }), CastManifestError, `${label}: evaluatePersonOmissions must reject`);
    assert.throws(() => evaluateRepeatedIdentityCoverage(forged, [], { expectedHash: real.hash }), CastManifestError, `${label}: evaluateRepeatedIdentityCoverage must reject`);
  }

  // hold.personIds / hold.canonicalNames: need a manifest with a populated hold.
  const withHold = buildCastManifest({ article: { requiredCast: ['Lisa'] } }); // no candidates -> HOLD
  assert.ok(withHold.hold);
  const holdPersonIds = JSON.parse(JSON.stringify(withHold));
  holdPersonIds.hold.personIds = [holdPersonIds.hold.personIds[0].slice(0, 5) + NUL + holdPersonIds.hold.personIds[0].slice(6)];
  assert.notEqual(validateCastManifestStructure(holdPersonIds), null, 'hold.personIds: raw NUL must be rejected');
  assert.throws(() => canonicalizeCastManifest(holdPersonIds), CastManifestError);

  const holdCanonicalNames = JSON.parse(JSON.stringify(withHold));
  holdCanonicalNames.hold.canonicalNames = ['Li' + NUL + 'sa'];
  assert.notEqual(validateCastManifestStructure(holdCanonicalNames), null, 'hold.canonicalNames: raw NUL must be rejected');
  assert.throws(() => hashCastManifest(holdCanonicalNames), CastManifestError);

  // Other C0 control characters (not just NUL) and DEL are rejected the same way. personId is
  // recomputed in each so the canonicalName control gate is what is actually being proven.
  const SOH = String.fromCharCode(1); // a control char that is NOT whitespace
  const DEL = String.fromCharCode(127);
  const controlCase = mutate((c) => {
    c.people[0].canonicalName = 'Li' + SOH + 'sa';
    c.people[0].personId = computePersonId('Li' + SOH + 'sa');
  });
  assert.notEqual(validateCastManifestStructure(controlCase), null, 'a non-NUL C0 control character must also be rejected');
  const delCase = mutate((c) => {
    c.people[0].canonicalName = 'Li' + DEL + 'sa';
    c.people[0].personId = computePersonId('Li' + DEL + 'sa');
  });
  assert.notEqual(validateCastManifestStructure(delCase), null, 'DEL (0x7F) must also be rejected');

  // Sanity: an ordinary internal SPACE (U+0020, not a control character) is NOT rejected -- this
  // fix must not regress the "a plain space is not a control byte" guarantee. (A TAB is a control
  // character (0x09) and IS rejected under the round-9 unified policy -- the earlier claim that an
  // internal tab is accepted was false and has been removed.)
  assert.equal(validateCastManifestStructure(real), null);
  const spaced = mutate((c) => { c.people[0].canonicalName = 'Lisa Manoban'; c.people[0].personId = computePersonId('Lisa Manoban'); });
  assert.equal(validateCastManifestStructure(spaced), null, 'a normal space-containing name must still be accepted');
});

test('round-9 ONE control policy: the builder rejects a non-NUL C0/DEL control character in a name exactly as the foreign validator does (no builder-vs-foreign divergence)', () => {
  const SOH = String.fromCharCode(1);
  const DEL = String.fromCharCode(127);
  // Builder used to reject ONLY NUL; a SOH/DEL in a name sailed through while the foreign path
  // rejected it. Now the builder rejects them too, via the shared control-char predicate.
  for (const ctrl of [SOH, DEL, String.fromCharCode(31)]) {
    let caught = null;
    try {
      buildCastManifest({ article: { requiredCast: ['Li' + ctrl + 'sa'] } });
      assert.fail('builder must reject a control character in a name');
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof CastManifestError);
    assert.equal(caught.errorType, 'NUL_BYTE_REJECTED', 'builder uses the single typed control-rejection signal');
  }
  // A plain space is still fine in the builder.
  assert.doesNotThrow(() => buildCastManifest({ article: { requiredCast: ['Lisa Manoban'] } }));
});

test('round-9: a control character in unmatchedCandidates[].name is rejected by BOTH validation paths (direct validateCastManifestStructure and the single-capture assertCastManifestIntegrity), and by the builder', () => {
  const NUL = String.fromCharCode(0);
  const SOH = String.fromCharCode(1);
  // Build a manifest with a genuine unmatched candidate (a candidate whose name matches no person).
  const real = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Untracked Person', 'c-untracked-1')],
  });
  assert.equal(real.unmatchedCandidates.length, 1);
  assert.equal(validateCastManifestStructure(real), null);

  for (const ctrl of [NUL, SOH]) {
    const forged = JSON.parse(JSON.stringify(real));
    forged.unmatchedCandidates[0].name = 'Un' + ctrl + 'tracked';
    // Direct foreign path.
    assert.notEqual(validateCastManifestStructure(forged), null, 'validateCastManifestStructure must reject a control char in unmatched name');
    // Public canonicalize/hash paths.
    assert.throws(() => canonicalizeCastManifest(forged), CastManifestError);
    assert.throws(() => hashCastManifest(forged), CastManifestError);
    // Single-capture integrity path + an evaluator.
    assert.throws(() => assertCastManifestIntegrity(forged, real.hash), CastManifestError);
    assert.throws(() => evaluateCastAssetHolds(forged, { expectedHash: real.hash }), CastManifestError);
  }

  // Builder: a control char in a candidate name (which becomes the unmatched name) is rejected at
  // build time too -- the one policy holds end-to-end.
  assert.throws(() => buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Un' + SOH + 'tracked', 'c-x-1')],
  }), CastManifestError);

  // A null unmatched name and an ordinary (control-free) unmatched name both remain valid.
  const withNullName = JSON.parse(JSON.stringify(real));
  withNullName.unmatchedCandidates[0].name = null;
  assert.equal(validateCastManifestStructure(withNullName), null, 'a null unmatched name is still valid');
});

// =========================================================================
// Round-8 corrective fix (assignments exact capture) — the `assignment` parameter of
// evaluatePersonOmissions/evaluateRepeatedIdentityCoverage now gets the same descriptor-first,
// Proxy-rejecting, exact-capture treatment as the manifest, applied once at the evaluator
// boundary. Absent/non-array assignment, or a row explicitly proposing no one (personId: null),
// remain legitimate gradeable states; a Proxy, an accessor, a surplus key, or a wrong-typed
// personId are all rejected fail-closed.
// =========================================================================
test('assignment: a Proxy wrapping the assignment array itself is rejected before any reflection, without ever invoking a trap', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const lisa = manifest.people[0];
  const realAssignment = [{ slotId: 'hero', personId: lisa.personId }];
  const spy1 = makeSpyProxy(realAssignment);
  assert.throws(() => evaluatePersonOmissions(manifest, spy1.proxy, { expectedHash: manifest.hash }), CastManifestError);
  assert.equal(spy1.state.anyTrapCalled, false, 'no trap should fire on the assignment array Proxy');

  const spy2 = makeSpyProxy(realAssignment);
  assert.throws(() => evaluateRepeatedIdentityCoverage(manifest, spy2.proxy, { expectedHash: manifest.hash }), CastManifestError);
  assert.equal(spy2.state.anyTrapCalled, false, 'no trap should fire on the assignment array Proxy');
});

test('assignment: a Proxy wrapping a single assignment row is rejected before any reflection, without ever invoking a trap', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const lisa = manifest.people[0];
  const spy = makeSpyProxy({ slotId: 'hero', personId: lisa.personId });
  assert.throws(() => evaluatePersonOmissions(manifest, [spy.proxy], { expectedHash: manifest.hash }), CastManifestError);
  assert.equal(spy.state.anyTrapCalled, false, 'no trap should fire on the assignment row Proxy');
});

test('assignment: a stateful accessor standing in for personId is rejected without ever invoking the getter -- the attacker-controlled value it would have returned never echoes into any output or thrown error', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const ATTACKER_VALUE = 'attacker-controlled-value-must-never-appear-in-output';
  const row = { slotId: 'hero' };
  let getterInvoked = false;
  Object.defineProperty(row, 'personId', {
    get() { getterInvoked = true; return ATTACKER_VALUE; },
    enumerable: true,
    configurable: true,
  });

  let caught = null;
  try {
    evaluatePersonOmissions(manifest, [row], { expectedHash: manifest.hash });
    assert.fail('expected throw');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CastManifestError);
  assert.equal(getterInvoked, false, 'the accessor must never be invoked to check assignment row shape');
  assert.equal(String(caught.message).includes(ATTACKER_VALUE), false, 'the never-read attacker value cannot appear in the error message');
  assert.equal(String(caught.detail || '').includes(ATTACKER_VALUE), false, 'the never-read attacker value cannot appear in the error detail');
});

test('assignment: a row with a surplus key, or with personId/slotId of the wrong type, is rejected fail-closed', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const lisa = manifest.people[0];

  assert.throws(() => evaluatePersonOmissions(
    manifest, [{ slotId: 'hero', personId: lisa.personId, rogue: 'extra' }], { expectedHash: manifest.hash },
  ), CastManifestError, 'surplus key must be rejected');

  assert.throws(() => evaluatePersonOmissions(
    manifest, [{ slotId: 'hero', personId: 12345 }], { expectedHash: manifest.hash },
  ), CastManifestError, 'numeric personId must be rejected');

  assert.throws(() => evaluatePersonOmissions(
    manifest, [{ slotId: 'hero', personId: { nested: true } }], { expectedHash: manifest.hash },
  ), CastManifestError, 'object personId must be rejected');

  assert.throws(() => evaluatePersonOmissions(
    manifest, [{ slotId: 123, personId: lisa.personId }], { expectedHash: manifest.hash },
  ), CastManifestError, 'numeric slotId must be rejected');

  assert.throws(() => evaluatePersonOmissions(
    manifest, [{ slotId: '   ', personId: lisa.personId }], { expectedHash: manifest.hash },
  ), CastManifestError, 'whitespace-only slotId must be rejected');

  // Sanity: a real, well-formed row is still accepted (does not throw).
  assert.doesNotThrow(() => evaluatePersonOmissions(
    manifest, [{ slotId: 'hero', personId: lisa.personId }], { expectedHash: manifest.hash },
  ));
});

test('assignment: a single hostile row anywhere in an otherwise-valid array causes the WHOLE evaluation to reject fail-closed -- no partial/mixed result', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa', 'Minnie'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1'), readyCandidate('Minnie', 'c-minnie-1')],
  });
  const lisa = manifest.people.find((p) => p.canonicalName === 'Lisa');
  const minnie = manifest.people.find((p) => p.canonicalName === 'Minnie');
  const mixed = [
    { slotId: 'hero', personId: lisa.personId }, // valid
    { slotId: 'reaction', personId: minnie.personId, rogue: 'x' }, // hostile: surplus key
  ];
  assert.throws(() => evaluatePersonOmissions(manifest, mixed, { expectedHash: manifest.hash }), CastManifestError);
  assert.throws(() => evaluateRepeatedIdentityCoverage(manifest, mixed, { expectedHash: manifest.hash }), CastManifestError);
});

test('assignment (round 9): ONLY a truly ABSENT assignment (undefined / omitted) or a well-formed empty array is a gradeable "nothing proposed" state; null, a string, a number, and every other non-array are MALFORMED and throw fail-closed -- never silently become []', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });

  // A well-shaped row explicitly proposing no one for its slot (personId: null) is accepted.
  const omissionsNull = evaluatePersonOmissions(manifest, [{ slotId: 'hero', personId: null }], { expectedHash: manifest.hash });
  assert.ok(Array.isArray(omissionsNull), 'an explicit null personId in a well-shaped row must not throw');

  // A row missing the personId key entirely is a shape violation.
  assert.throws(() => evaluatePersonOmissions(
    manifest, [{ slotId: 'hero' }], { expectedHash: manifest.hash },
  ), CastManifestError, 'a row missing the personId key entirely must be rejected as a shape violation');

  // Absent (undefined / omitted) and a genuinely empty array are the only benign "nothing
  // proposed" states.
  assert.doesNotThrow(() => evaluatePersonOmissions(manifest, undefined, { expectedHash: manifest.hash }));
  assert.doesNotThrow(() => evaluatePersonOmissions(manifest, [], { expectedHash: manifest.hash }));
  assert.doesNotThrow(() => evaluateRepeatedIdentityCoverage(manifest, undefined, { expectedHash: manifest.hash }));

  // Round-9 change: null / string / number / other non-array assignments are MALFORMED -> throw,
  // never quietly treated as [] (the round-8 leniency this test replaces).
  for (const malformed of [null, 'not-an-array', 42, true, {}]) {
    assert.throws(
      () => evaluatePersonOmissions(manifest, malformed, { expectedHash: manifest.hash }),
      CastManifestError,
      `evaluatePersonOmissions must reject a malformed (non-array) assignment: ${String(malformed)}`,
    );
    assert.throws(
      () => evaluateRepeatedIdentityCoverage(manifest, malformed, { expectedHash: manifest.hash }),
      CastManifestError,
      `evaluateRepeatedIdentityCoverage must reject a malformed (non-array) assignment: ${String(malformed)}`,
    );
  }
});

test('assignment (round 9): a malformed ARRAY -- Proxy / hole / surplus own key / symbol key / index accessor -- throws fail-closed and is never silently coerced to []', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const lisa = manifest.people[0];
  const goodRow = () => ({ slotId: 'hero', personId: lisa.personId });

  // Hole.
  const holey = [];
  holey[0] = goodRow();
  holey[2] = goodRow();
  holey.length = 3;
  assert.throws(() => evaluatePersonOmissions(manifest, holey, { expectedHash: manifest.hash }), CastManifestError);

  // Surplus own (out-of-range) index property.
  const surplus = [goodRow()];
  surplus[5] = goodRow();
  assert.throws(() => evaluateRepeatedIdentityCoverage(manifest, surplus, { expectedHash: manifest.hash }), CastManifestError);

  // Symbol key on the array.
  const symbolArr = [goodRow()];
  symbolArr[Symbol('rogue')] = 'x';
  assert.throws(() => evaluatePersonOmissions(manifest, symbolArr, { expectedHash: manifest.hash }), CastManifestError);

  // Index accessor (getter) -- rejected without ever being invoked.
  const accessorArr = [goodRow()];
  let idxGetterInvoked = false;
  Object.defineProperty(accessorArr, '0', { get() { idxGetterInvoked = true; return goodRow(); }, enumerable: true, configurable: true });
  assert.throws(() => evaluatePersonOmissions(manifest, accessorArr, { expectedHash: manifest.hash }), CastManifestError);
  assert.equal(idxGetterInvoked, false, 'an index accessor on the assignment array must never be invoked');
});

test('assignment (round 9): primitive / null / non-plain rows THROW (never skipped), and a well-shaped but UNKNOWN personId is rejected -- it never reaches repeatedPersonIds, output, error message or detail (no echo)', () => {
  const manifest = buildCastManifest({
    article: { requiredCast: ['Lisa'] },
    candidates: [readyCandidate('Lisa', 'c-lisa-1')],
  });
  const lisa = manifest.people[0];

  // Primitive / null / non-plain rows are no longer skipped -- they throw.
  for (const badRow of [null, 42, 'str', true]) {
    assert.throws(() => evaluatePersonOmissions(manifest, [badRow], { expectedHash: manifest.hash }), CastManifestError,
      `a ${String(badRow)} row must throw, not be skipped`);
  }
  // A non-plain-object row (array as row, class instance as row).
  assert.throws(() => evaluatePersonOmissions(manifest, [[1, 2]], { expectedHash: manifest.hash }), CastManifestError);
  assert.throws(() => evaluatePersonOmissions(manifest, [Object.assign(new Date(), { slotId: 'hero', personId: lisa.personId })], { expectedHash: manifest.hash }), CastManifestError);

  // A well-shaped but UNKNOWN personId (not in the verified manifest), repeated, must be rejected
  // and must NEVER surface anywhere -- not in repeatedPersonIds, not in the thrown error.
  const UNKNOWN = 'person_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const unknownRepeated = [
    { slotId: 'a', personId: UNKNOWN },
    { slotId: 'b', personId: UNKNOWN },
  ];
  let caught = null;
  try {
    evaluateRepeatedIdentityCoverage(manifest, unknownRepeated, { expectedHash: manifest.hash });
    assert.fail('expected throw on unknown personId');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CastManifestError);
  assert.equal(String(caught.message).includes(UNKNOWN), false, 'the unknown attacker id must not appear in the error message');
  assert.equal(String(caught.detail || '').includes(UNKNOWN), false, 'the unknown attacker id must not appear in the error detail');

  // Sanity: a KNOWN id repeated is still gradeable and correctly flagged (membership never breaks
  // legitimate repetition detection).
  const knownRepeated = [
    { slotId: 'a', personId: lisa.personId },
    { slotId: 'b', personId: lisa.personId },
  ];
  const cov = evaluateRepeatedIdentityCoverage(manifest, knownRepeated, { expectedHash: manifest.hash });
  assert.deepEqual(cov.repeatedPersonIds, [lisa.personId]);
});
