// Hostile tests for the Semantic Global Assignment module (foundation + solver).
// Run WITHOUT node_modules:  node --test tests/semantic-global-assignment.test.mjs
// Every assertion is deterministic (no time, no randomness, no IO). Expected fixture
// outcomes below were verified directly against the module before being written here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  validateSemanticGlobalAssignmentInput,
  buildSemanticGlobalAssignment,
} from '../src/lib/semanticGlobalAssignment.js';

// =========================================================================
// Fixture builders
// =========================================================================

function slot({ slotId, order, role = 'role', shape = 'shape', personId = null }) {
  return { slotId, order, role, shape, personId };
}

function candidate({
  candidateId, sourceAssetId, personId = null, eligibleSlotIds,
  semanticScore = 0, qualityScore = 0, slotFitScore = 0, sceneKey,
}) {
  return {
    candidateId,
    sourceAssetId,
    personId,
    eligibleSlotIds,
    semanticScore,
    qualityScore,
    slotFitScore,
    sceneKey: sceneKey === undefined ? `${candidateId}-scene` : sceneKey,
  };
}

function requiredCastEntry({ personId, required = true, priority = 0 }) {
  return { personId, required, priority };
}

function heroAuthority({ heroSlotId = null, heroPersonId = null, approvedCandidateIds = [] } = {}) {
  return { heroSlotId, heroPersonId, approvedCandidateIds };
}

function limits({ maxPersonRepeats = 3, maxSceneRepeats = 3 } = {}) {
  return { maxPersonRepeats, maxSceneRepeats };
}

function input({ slots, candidates, requiredCast = [], hero = heroAuthority(), lim = limits() }) {
  return { slots, candidates, requiredCast, heroAuthority: hero, limits: lim };
}

// A minimal, always-valid baseline: one flexible slot, one flexible candidate.
function minimalValidInput() {
  return input({
    slots: [slot({ slotId: 'only', order: 0 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', eligibleSlotIds: ['only'], sceneKey: 'k1' })],
  });
}

// Reimplements the module's private canonical-JSON algorithm independently (not by
// importing it — it isn't exported), so the assignmentHash-binding tests in section 9
// are a genuine cross-check, not a tautology against the module's own code.
function independentCanonicalStringify(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') return String(value);
  if (type === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(independentCanonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${independentCanonicalStringify(value[k])}`).join(',')}}`;
}

function independentSha256(value) {
  return createHash('sha256').update(independentCanonicalStringify(value), 'utf8').digest('hex');
}

// Every reason code the structural validator (validateSemanticGlobalAssignmentInput)
// can produce — used by the section-10 agreement check to distinguish a validation-stage
// hold from a solver-stage hold. Kept as a literal list here (not imported) because the
// module intentionally exports no reason-code table.
const VALIDATION_STAGE_REASONS = new Set([
  'MISSING_FIELD', 'SURPLUS_FIELD', 'ACCESSOR_PROPERTY', 'NON_ENUMERABLE_PROPERTY',
  'SYMBOL_KEY_PRESENT', 'EXOTIC_OBJECT', 'EXOTIC_ARRAY', 'CYCLE_DETECTED', 'INVALID_TYPE',
  'NON_INTEGER', 'OUT_OF_RANGE', 'EMPTY_COLLECTION', 'LIMIT_OVERFLOW', 'DUPLICATE_ID',
  'UNKNOWN_REFERENCE', 'CONFLICT', 'INTERNAL_VALIDATION_ERROR',
]);

// Asserts validateSemanticGlobalAssignmentInput and buildSemanticGlobalAssignment agree
// on a given raw input (section 10) and returns the two results for further inspection.
function assertAgreement(rawInput) {
  const validation = validateSemanticGlobalAssignmentInput(rawInput);
  const built = buildSemanticGlobalAssignment(rawInput);
  if (validation.ok) {
    assert.ok(
      !VALIDATION_STAGE_REASONS.has(built.reason),
      `expected a solver-stage outcome, got validation-stage reason ${built.reason}`,
    );
  } else {
    assert.equal(built.decision, 'hold');
    assert.equal(built.reason, validation.reason);
    assert.deepEqual(built.assignments, []);
  }
  return { validation, built };
}

// =========================================================================
// 1. Greedy-repeat trap: required coverage must beat raw score
// =========================================================================

test('covers every required person before repeating one, even when the repeat scores higher', () => {
  const scenario = input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [
      candidate({ candidateId: 'lisa-1', sourceAssetId: 'a-lisa-1', personId: 'lisa', eligibleSlotIds: ['main', 'secondary'], semanticScore: 100, qualityScore: 100, slotFitScore: 100, sceneKey: 'scene-a' }),
      candidate({ candidateId: 'lisa-2', sourceAssetId: 'a-lisa-2', personId: 'lisa', eligibleSlotIds: ['main', 'secondary'], semanticScore: 90, qualityScore: 90, slotFitScore: 90, sceneKey: 'scene-b' }),
      candidate({ candidateId: 'nene-1', sourceAssetId: 'a-nene-1', personId: 'nene', eligibleSlotIds: ['main', 'secondary'], semanticScore: 10, qualityScore: 10, slotFitScore: 10, sceneKey: 'scene-c' }),
    ],
    requiredCast: [requiredCastEntry({ personId: 'lisa' }), requiredCastEntry({ personId: 'nene' })],
  });

  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  assert.deepEqual(result.assignments.map((a) => a.personId).sort(), ['lisa', 'nene']);
  assert.equal(result.diagnostics.repeats.person, 0);
  assert.deepEqual(result.diagnostics.covered.slice().sort(), ['lisa', 'nene']);
  // the tempting higher-raw-sum "always take the two best-scoring candidates" answer
  // (lisa-1 + lisa-2, sum 190) must lose to the coverage-complete one (sum 110).
  const usedCandidateIds = result.assignments.map((a) => a.candidateId).sort();
  assert.deepEqual(usedCandidateIds, ['lisa-1', 'nene-1']);
});

// =========================================================================
// 2. Permutation invariance
// =========================================================================

test('array-order permutations of slots/candidates/requiredCast/approvedCandidateIds and root key order produce byte-identical output and hash', () => {
  const baseSlots = [slot({ slotId: 'a', order: 0 }), slot({ slotId: 'b', order: 1 }), slot({ slotId: 'c', order: 2 })];
  const baseCandidates = [
    candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'p1', eligibleSlotIds: ['a'], semanticScore: 9, qualityScore: 9, slotFitScore: 9, sceneKey: 'k1' }),
    candidate({ candidateId: 'c1b', sourceAssetId: 's1b', personId: 'p1', eligibleSlotIds: ['a'], semanticScore: 5, qualityScore: 5, slotFitScore: 5, sceneKey: 'k1b' }),
    candidate({ candidateId: 'c2', sourceAssetId: 's2', personId: 'p2', eligibleSlotIds: ['b', 'c'], semanticScore: 7, qualityScore: 7, slotFitScore: 7, sceneKey: 'k2' }),
    candidate({ candidateId: 'c3', sourceAssetId: 's3', personId: null, eligibleSlotIds: ['b', 'c'], semanticScore: 1, qualityScore: 1, slotFitScore: 1, sceneKey: 'k3' }),
  ];
  const baseRequired = [requiredCastEntry({ personId: 'p1' }), requiredCastEntry({ personId: 'p2' })];
  const hero = heroAuthority({ heroSlotId: 'a', heroPersonId: 'p1', approvedCandidateIds: ['c1', 'c1b'] });
  const lim = limits();

  const original = { slots: baseSlots, candidates: baseCandidates, requiredCast: baseRequired, heroAuthority: hero, limits: lim };
  const shuffled = {
    limits: lim,
    heroAuthority: { approvedCandidateIds: [...hero.approvedCandidateIds].reverse(), heroPersonId: hero.heroPersonId, heroSlotId: hero.heroSlotId },
    requiredCast: [...baseRequired].reverse(),
    candidates: [...baseCandidates].reverse(),
    slots: [...baseSlots].reverse(),
  };

  const r1 = buildSemanticGlobalAssignment(original);
  const r2 = buildSemanticGlobalAssignment(shuffled);
  assert.deepEqual(r1, r2);
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
  assert.equal(r1.assignmentHash, r2.assignmentHash);
  assert.equal(r1.decision, 'assigned');
  // the objectively better approved hero candidate must win regardless of enumeration order
  assert.equal(r1.assignments.find((a) => a.slotId === 'a').candidateId, 'c1');
});

// =========================================================================
// 3. Hero edge cases
// =========================================================================

test('hero approval naming a candidate of the wrong person is rejected at validation', () => {
  const scenario = input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'lisa', eligibleSlotIds: ['main', 'secondary'], sceneKey: 'k1' })],
    hero: heroAuthority({ heroSlotId: 'main', heroPersonId: 'nene', approvedCandidateIds: ['c1'] }),
  });
  const { validation, built } = assertAgreement(scenario);
  assert.equal(validation.reason, 'CONFLICT');
  assert.equal(built.reason, 'CONFLICT');
  assert.deepEqual(built.assignments, []);
});

test('a non-approved, higher-scoring candidate is never used for the hero slot', () => {
  const scenario = input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [
      candidate({ candidateId: 'approved-1', sourceAssetId: 'sa1', personId: 'lisa', eligibleSlotIds: ['main'], semanticScore: 1, qualityScore: 1, slotFitScore: 1, sceneKey: 'k1' }),
      candidate({ candidateId: 'not-approved', sourceAssetId: 'sa2', personId: 'lisa', eligibleSlotIds: ['main'], semanticScore: 999, qualityScore: 999, slotFitScore: 999, sceneKey: 'k2' }),
      candidate({ candidateId: 'filler', sourceAssetId: 'sa3', personId: null, eligibleSlotIds: ['secondary'], semanticScore: 1, qualityScore: 1, slotFitScore: 1, sceneKey: 'k3' }),
    ],
    hero: heroAuthority({ heroSlotId: 'main', heroPersonId: 'lisa', approvedCandidateIds: ['approved-1'] }),
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  assert.equal(result.assignments.find((a) => a.slotId === 'main').candidateId, 'approved-1');
});

test('an approved hero candidate ineligible for the hero slot is rejected at validation', () => {
  const scenario = input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'lisa', eligibleSlotIds: ['secondary'], sceneKey: 'k1' })],
    hero: heroAuthority({ heroSlotId: 'main', heroPersonId: 'lisa', approvedCandidateIds: ['c1'] }),
  });
  const { validation, built } = assertAgreement(scenario);
  assert.equal(validation.reason, 'CONFLICT');
  assert.equal(built.reason, 'CONFLICT');
});

test('a hero slot referencing an unknown slotId is rejected at validation', () => {
  const scenario = input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'lisa', eligibleSlotIds: ['main'], sceneKey: 'k1' })],
    hero: heroAuthority({ heroSlotId: 'does-not-exist', heroPersonId: 'lisa', approvedCandidateIds: ['c1'] }),
  });
  const { validation, built } = assertAgreement(scenario);
  assert.equal(validation.reason, 'UNKNOWN_REFERENCE');
  assert.equal(built.reason, 'UNKNOWN_REFERENCE');
});

test('a hero with only one of heroSlotId/heroPersonId set is rejected as ambiguous', () => {
  const scenario = input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'lisa', eligibleSlotIds: ['main'], sceneKey: 'k1' })],
    hero: heroAuthority({ heroSlotId: 'main', heroPersonId: null, approvedCandidateIds: [] }),
  });
  const { validation, built } = assertAgreement(scenario);
  assert.equal(validation.reason, 'CONFLICT');
  assert.equal(built.reason, 'CONFLICT');
});

// =========================================================================
// 4. Required-cast infeasibility and repeat-only-after-coverage
// =========================================================================

test('a required person with no feasible candidate anywhere holds fail-closed with no partial assignment', () => {
  const scenario = input({
    slots: [slot({ slotId: 'only', order: 0 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'someone-else', eligibleSlotIds: ['only'], sceneKey: 'k1' })],
    requiredCast: [requiredCastEntry({ personId: 'ghost' })],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'REQUIRED_CAST_INFEASIBLE');
  assert.deepEqual(result.assignments, []);
});

test('a repeat is only accepted after every required person is already covered', () => {
  // 3 slots but only 2 distinct people, each with their own (never-reused) candidate/source —
  // Lisa has a second, genuinely distinct candidate/source available, so a "repeat" here means
  // a second real Lisa photo, not reusing the same candidateId/sourceAssetId.
  const scenario = input({
    slots: [slot({ slotId: 's0', order: 0 }), slot({ slotId: 's1', order: 1 }), slot({ slotId: 's2', order: 2 })],
    candidates: [
      candidate({ candidateId: 'lisa-1', sourceAssetId: 'a1', personId: 'lisa', eligibleSlotIds: ['s0', 's1', 's2'], sceneKey: 'k1' }),
      candidate({ candidateId: 'lisa-2', sourceAssetId: 'a2', personId: 'lisa', eligibleSlotIds: ['s0', 's1', 's2'], sceneKey: 'k2' }),
      candidate({ candidateId: 'nene-1', sourceAssetId: 'a3', personId: 'nene', eligibleSlotIds: ['s0', 's1', 's2'], sceneKey: 'k3' }),
    ],
    requiredCast: [requiredCastEntry({ personId: 'lisa' }), requiredCastEntry({ personId: 'nene' })],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  assert.deepEqual(result.diagnostics.covered.slice().sort(), ['lisa', 'nene']);
  assert.equal(result.diagnostics.repeats.person, 1);
  const personIds = result.assignments.map((a) => a.personId);
  assert.ok(personIds.includes('lisa') && personIds.includes('nene'));
});

// =========================================================================
// 5. No candidateId/sourceAssetId reuse; exact slot person/eligibility
// =========================================================================

test('sourceAssetId is never reused across two slots even via two different candidateIds', () => {
  const scenario = input({
    slots: [slot({ slotId: 'x', order: 0 }), slot({ slotId: 'y', order: 1 })],
    candidates: [
      candidate({ candidateId: 'a', sourceAssetId: 'SHARED', eligibleSlotIds: ['x'], sceneKey: 'k1' }),
      candidate({ candidateId: 'b', sourceAssetId: 'SHARED', eligibleSlotIds: ['y'], sceneKey: 'k2' }),
    ],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'ASSIGNMENT_INFEASIBLE');
  assert.deepEqual(result.assignments, []);
});

test('candidateId is never reused across two slots', () => {
  const scenario = input({
    slots: [slot({ slotId: 'x', order: 0 }), slot({ slotId: 'y', order: 1 })],
    candidates: [candidate({ candidateId: 'only-one', sourceAssetId: 's1', eligibleSlotIds: ['x', 'y'], sceneKey: 'k1' })],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'ASSIGNMENT_INFEASIBLE');
});

test('a slot with a specific person requirement never receives a mismatched-person candidate', () => {
  const scenario = input({
    slots: [slot({ slotId: 'needs-lisa', order: 0, personId: 'lisa' })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'nene', eligibleSlotIds: ['needs-lisa'], sceneKey: 'k1' })],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'SLOT_UNFILLABLE');
  // path is the canonical array index, never the caller-supplied slotId (see section 11 below)
  assert.equal(result.path, 'slots[0]');
});

// =========================================================================
// 6. Objective order tested independently + adversarial ids
// =========================================================================

test('person repeats strictly dominate raw score', () => {
  const scenario = input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [
      candidate({ candidateId: 'lisa-hi-1', sourceAssetId: 'a1', personId: 'lisa', eligibleSlotIds: ['main', 'secondary'], semanticScore: 100, qualityScore: 100, slotFitScore: 100, sceneKey: 's1' }),
      candidate({ candidateId: 'lisa-hi-2', sourceAssetId: 'a2', personId: 'lisa', eligibleSlotIds: ['main', 'secondary'], semanticScore: 100, qualityScore: 100, slotFitScore: 100, sceneKey: 's2' }),
      candidate({ candidateId: 'other-lo', sourceAssetId: 'a3', personId: 'other', eligibleSlotIds: ['main', 'secondary'], semanticScore: 1, qualityScore: 1, slotFitScore: 1, sceneKey: 's3' }),
    ],
    requiredCast: [requiredCastEntry({ personId: 'lisa' })],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  assert.equal(result.diagnostics.repeats.person, 0);
  assert.deepEqual(result.assignments.map((a) => a.candidateId).sort(), ['lisa-hi-1', 'other-lo']);
});

test('scene repeats are the second-tier objective, after person repeats but before score', () => {
  const scenario = input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [
      candidate({ candidateId: 'p1-hi', sourceAssetId: 'b1', personId: 'p1', eligibleSlotIds: ['main', 'secondary'], semanticScore: 100, qualityScore: 100, slotFitScore: 100, sceneKey: 'SAME' }),
      candidate({ candidateId: 'p2-hi', sourceAssetId: 'b2', personId: 'p2', eligibleSlotIds: ['main', 'secondary'], semanticScore: 100, qualityScore: 100, slotFitScore: 100, sceneKey: 'SAME' }),
      candidate({ candidateId: 'p1-lo', sourceAssetId: 'b3', personId: 'p1', eligibleSlotIds: ['main', 'secondary'], semanticScore: 1, qualityScore: 1, slotFitScore: 1, sceneKey: 'diff1' }),
      candidate({ candidateId: 'p2-lo', sourceAssetId: 'b4', personId: 'p2', eligibleSlotIds: ['main', 'secondary'], semanticScore: 1, qualityScore: 1, slotFitScore: 1, sceneKey: 'diff2' }),
    ],
    requiredCast: [requiredCastEntry({ personId: 'p1' }), requiredCastEntry({ personId: 'p2' })],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  assert.equal(result.diagnostics.repeats.person, 0);
  assert.equal(result.diagnostics.repeats.scene, 0);
  // the higher-raw-sum "both SAME-scene high scorers" answer must lose to a zero-scene-repeat one
  const used = result.assignments.map((a) => a.candidateId).sort();
  assert.notDeepEqual(used, ['p1-hi', 'p2-hi'].sort());
});

test('semanticScore outranks qualityScore outranks slotFitScore when repeats tie', () => {
  const scenario = input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [
      candidate({ candidateId: 'hi-sem', sourceAssetId: 'c1', eligibleSlotIds: ['main'], semanticScore: 10, qualityScore: 1, slotFitScore: 1, sceneKey: 'x1' }),
      candidate({ candidateId: 'hi-qual', sourceAssetId: 'c2', eligibleSlotIds: ['main'], semanticScore: 5, qualityScore: 999, slotFitScore: 999, sceneKey: 'x2' }),
      candidate({ candidateId: 'filler', sourceAssetId: 'c3', eligibleSlotIds: ['secondary'], semanticScore: 1, qualityScore: 1, slotFitScore: 1, sceneKey: 'x3' }),
    ],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  assert.equal(result.assignments.find((a) => a.slotId === 'main').candidateId, 'hi-sem');
});

test('the final tie-break compares ids by UTF-16 code unit, never locale order or delimiter join', () => {
  const scenario = input({
    slots: [slot({ slotId: 'only', order: 0 })],
    candidates: [
      candidate({ candidateId: 'B-cand', sourceAssetId: 'd1', eligibleSlotIds: ['only'], semanticScore: 5, qualityScore: 5, slotFitScore: 5, sceneKey: 'y1' }),
      candidate({ candidateId: 'a-cand', sourceAssetId: 'd2', eligibleSlotIds: ['only'], semanticScore: 5, qualityScore: 5, slotFitScore: 5, sceneKey: 'y2' }),
    ],
  });
  // sanity check on the adversarial pair itself: locale order disagrees with code-unit order
  assert.deepEqual(['B-cand', 'a-cand'].sort((x, y) => x.localeCompare(y)), ['a-cand', 'B-cand']);
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  assert.equal(result.assignments[0].candidateId, 'B-cand');
  // determinism: running it again gives the identical pick and hash
  const again = buildSemanticGlobalAssignment(scenario);
  assert.equal(again.assignments[0].candidateId, 'B-cand');
  assert.equal(again.assignmentHash, result.assignmentHash);
});

test('delimiter- and Unicode-adversarial ids do not corrupt ordering, uniqueness, or hashing', () => {
  const trickyIds = ['a|b', 'a,b', 'a"b', 'a\\b', 'a{b}c', 'café', 'café', '😀lead', 'z'];
  const cands = trickyIds.map((id, i) => candidate({
    candidateId: id, sourceAssetId: `src-${i}`, eligibleSlotIds: ['only'], semanticScore: i, qualityScore: i, slotFitScore: i, sceneKey: `scene-${i}`,
  }));
  const scenario = input({ slots: [slot({ slotId: 'only', order: 0 })], candidates: cands });
  const validation = validateSemanticGlobalAssignmentInput(scenario);
  assert.equal(validation.ok, true);
  // all distinct candidateIds must validate as unique, none collapse under any join
  assert.equal(validation.canonicalInput.candidates.length, trickyIds.length);
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  // highest semanticScore (i = trickyIds.length - 1, id 'z') must win — proves scoring/selection
  // isn't disturbed by adversarial characters elsewhere in the candidate pool
  assert.equal(result.assignments[0].candidateId, 'z');
  assert.equal(result.assignmentHash, independentSha256({
    decision: result.decision, reason: result.reason, path: result.path, message: result.message,
    assignments: result.assignments, diagnostics: result.diagnostics, version: result.version,
  }));
});

// =========================================================================
// 7. Exact schema / duplicates / conflicts / exotic-object rejection
// =========================================================================

test('a missing root field is rejected as MISSING_FIELD', () => {
  const scenario = minimalValidInput();
  delete scenario.limits;
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'MISSING_FIELD');
});

test('a surplus root field is rejected as SURPLUS_FIELD', () => {
  const scenario = minimalValidInput();
  scenario.extra = 'not allowed';
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'SURPLUS_FIELD');
});

test('duplicate slotId is rejected as DUPLICATE_ID', () => {
  const scenario = input({
    slots: [slot({ slotId: 'dup', order: 0 }), slot({ slotId: 'dup', order: 1 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', eligibleSlotIds: ['dup'], sceneKey: 'k1' })],
  });
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'DUPLICATE_ID');
});

test('duplicate slot order is rejected as CONFLICT', () => {
  const scenario = input({
    slots: [slot({ slotId: 'a', order: 0 }), slot({ slotId: 'b', order: 0 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', eligibleSlotIds: ['a', 'b'], sceneKey: 'k1' })],
  });
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'CONFLICT');
});

test('duplicate candidateId is rejected as DUPLICATE_ID', () => {
  const scenario = input({
    slots: [slot({ slotId: 'only', order: 0 })],
    candidates: [
      candidate({ candidateId: 'dup', sourceAssetId: 's1', eligibleSlotIds: ['only'], sceneKey: 'k1' }),
      candidate({ candidateId: 'dup', sourceAssetId: 's2', eligibleSlotIds: ['only'], sceneKey: 'k2' }),
    ],
  });
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'DUPLICATE_ID');
});

test('duplicate requiredCast personId is rejected as CONFLICT', () => {
  const scenario = input({
    slots: [slot({ slotId: 'only', order: 0 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'lisa', eligibleSlotIds: ['only'], sceneKey: 'k1' })],
    requiredCast: [requiredCastEntry({ personId: 'lisa' }), requiredCastEntry({ personId: 'lisa', priority: 1 })],
  });
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'CONFLICT');
});

test('a non-integer score is rejected as NON_INTEGER', () => {
  const scenario = minimalValidInput();
  scenario.candidates[0].semanticScore = 1.5;
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'NON_INTEGER');
});

test('NaN and Infinity slot order are both rejected as NON_INTEGER', () => {
  for (const badOrder of [NaN, Infinity, -Infinity]) {
    const scenario = minimalValidInput();
    scenario.slots[0].order = badOrder;
    const { validation } = assertAgreement(scenario);
    assert.equal(validation.reason, 'NON_INTEGER', `order=${badOrder}`);
  }
});

test('a negative score is rejected as OUT_OF_RANGE', () => {
  const scenario = minimalValidInput();
  scenario.candidates[0].qualityScore = -1;
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'OUT_OF_RANGE');
});

test('a zero maxPersonRepeats limit is rejected as OUT_OF_RANGE (minimum is 1)', () => {
  const scenario = minimalValidInput();
  scenario.limits.maxPersonRepeats = 0;
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'OUT_OF_RANGE');
});

test('an empty slots array is rejected as EMPTY_COLLECTION', () => {
  const scenario = minimalValidInput();
  scenario.slots = [];
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'EMPTY_COLLECTION');
});

test('an eligibleSlotIds array referencing an unknown slotId is rejected as UNKNOWN_REFERENCE', () => {
  const scenario = minimalValidInput();
  scenario.candidates[0].eligibleSlotIds = ['does-not-exist'];
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'UNKNOWN_REFERENCE');
});

test('a Proxy at the root is rejected as EXOTIC_OBJECT with zero trap invocations', () => {
  let trapCalls = 0;
  const real = minimalValidInput();
  const proxied = new Proxy(real, {
    getOwnPropertyDescriptor(target, key) { trapCalls += 1; return Object.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { trapCalls += 1; return Object.getPrototypeOf(target); },
    ownKeys(target) { trapCalls += 1; return Reflect.ownKeys(target); },
    get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
  });
  const validation = validateSemanticGlobalAssignmentInput(proxied);
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, 'EXOTIC_OBJECT');
  assert.equal(trapCalls, 0, 'no Proxy trap should ever fire before rejection');
});

test('a Proxy nested inside the candidates array is rejected as EXOTIC_OBJECT with zero trap invocations on it', () => {
  let trapCalls = 0;
  const scenario = minimalValidInput();
  const realCandidate = scenario.candidates[0];
  scenario.candidates[0] = new Proxy(realCandidate, {
    getOwnPropertyDescriptor(target, key) { trapCalls += 1; return Object.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { trapCalls += 1; return Object.getPrototypeOf(target); },
    ownKeys(target) { trapCalls += 1; return Reflect.ownKeys(target); },
  });
  const validation = validateSemanticGlobalAssignmentInput(scenario);
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, 'EXOTIC_OBJECT');
  assert.equal(trapCalls, 0);
});

test('a Proxy wrapping the candidates array itself is rejected as EXOTIC_ARRAY with zero trap invocations', () => {
  let trapCalls = 0;
  const scenario = minimalValidInput();
  scenario.candidates = new Proxy(scenario.candidates, {
    getOwnPropertyDescriptor(target, key) { trapCalls += 1; return Object.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { trapCalls += 1; return Object.getPrototypeOf(target); },
    ownKeys(target) { trapCalls += 1; return Reflect.ownKeys(target); },
  });
  const validation = validateSemanticGlobalAssignmentInput(scenario);
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, 'EXOTIC_ARRAY');
  assert.equal(trapCalls, 0);
});

test('a class instance standing in for a plain slot record is rejected as EXOTIC_OBJECT', () => {
  class FakeSlot {
    constructor() {
      this.slotId = 'only';
      this.order = 0;
      this.role = 'role';
      this.shape = 'shape';
      this.personId = null;
    }
  }
  const scenario = minimalValidInput();
  scenario.slots[0] = new FakeSlot();
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'EXOTIC_OBJECT');
});

test('a symbol-keyed surplus property is rejected as SYMBOL_KEY_PRESENT', () => {
  const scenario = minimalValidInput();
  scenario.candidates[0][Symbol('extra')] = 'hidden';
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'SYMBOL_KEY_PRESENT');
});

test('a non-enumerable property standing in for a required field is rejected as NON_ENUMERABLE_PROPERTY', () => {
  const scenario = minimalValidInput();
  const slotObj = { order: 0, role: 'role', shape: 'shape', personId: null };
  Object.defineProperty(slotObj, 'slotId', { value: 'only', enumerable: false, configurable: true });
  scenario.slots[0] = slotObj;
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'NON_ENUMERABLE_PROPERTY');
});

test('an accessor property standing in for a required field is rejected as ACCESSOR_PROPERTY, and the getter is never invoked', () => {
  let getterCalls = 0;
  const scenario = minimalValidInput();
  const candidateObj = {
    sourceAssetId: 's1', personId: null, eligibleSlotIds: ['only'],
    semanticScore: 0, qualityScore: 0, slotFitScore: 0, sceneKey: 'k1',
  };
  Object.defineProperty(candidateObj, 'candidateId', {
    enumerable: true, configurable: true, get() { getterCalls += 1; return 'c1'; },
  });
  scenario.candidates[0] = candidateObj;
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'ACCESSOR_PROPERTY');
  assert.equal(getterCalls, 0, 'the accessor must never actually be invoked');
});

test('a sparse array with holes is rejected as EXOTIC_ARRAY', () => {
  const scenario = minimalValidInput();
  const sparse = [];
  sparse[0] = scenario.candidates[0];
  sparse[2] = candidate({ candidateId: 'c2', sourceAssetId: 's2', eligibleSlotIds: ['only'], sceneKey: 'k2' });
  scenario.candidates = sparse;
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'EXOTIC_ARRAY');
});

test('an array with an index-accessor element is rejected as EXOTIC_ARRAY, and the getter is never invoked', () => {
  let getterCalls = 0;
  const scenario = minimalValidInput();
  const arr = [scenario.slots[0], slot({ slotId: 'second', order: 1 })];
  Object.defineProperty(arr, '1', {
    enumerable: true, configurable: true, get() { getterCalls += 1; return slot({ slotId: 'second', order: 1 }); },
  });
  scenario.slots = arr;
  const { validation } = assertAgreement(scenario);
  assert.equal(validation.reason, 'EXOTIC_ARRAY');
  assert.equal(getterCalls, 0);
});

test('a shared object reference reused elsewhere in the input graph is rejected as CYCLE_DETECTED', () => {
  // the SAME array object reused as two different root fields — this module tracks every
  // container it descends into in a global "seen" set (not just an ancestor stack), so any
  // repeated reference anywhere in the graph is rejected, not only a true self-reference.
  const scenario = minimalValidInput();
  scenario.requiredCast = scenario.slots;
  const result = validateSemanticGlobalAssignmentInput(scenario);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CYCLE_DETECTED');
});

// =========================================================================
// 8. Search bounding: deterministic HOLD, never a partial or non-optimal result
// =========================================================================

test('exceeding the search-state cap holds deterministically with no partial assignment, on every run', () => {
  const slots = [];
  for (let i = 0; i < 6; i += 1) slots.push(slot({ slotId: `s${i}`, order: i }));
  const candidates = [];
  for (let i = 0; i < 64; i += 1) {
    candidates.push(candidate({
      candidateId: `c${i}`, sourceAssetId: `a${i}`, eligibleSlotIds: slots.map((s) => s.slotId),
      semanticScore: i, qualityScore: i, slotFitScore: i, sceneKey: `k${i}`,
    }));
  }
  const scenario = input({ slots, candidates, lim: limits({ maxPersonRepeats: 1000, maxSceneRepeats: 1000 }) });

  const r1 = buildSemanticGlobalAssignment(scenario);
  const r2 = buildSemanticGlobalAssignment(scenario);
  assert.equal(r1.decision, 'hold');
  assert.equal(r1.reason, 'SEARCH_LIMIT_EXCEEDED');
  assert.deepEqual(r1.assignments, []);
  assert.deepEqual(r2.assignments, []);
  assert.equal(r1.reason, r2.reason);
  assert.equal(r1.assignmentHash, r2.assignmentHash);
});

test('an input larger than the solver scope bounds holds as SEARCH_SCOPE_TOO_LARGE before any search runs', () => {
  const slots = [];
  for (let i = 0; i < 9; i += 1) slots.push(slot({ slotId: `s${i}`, order: i })); // > SOLVER_MAX_SLOTS (8)
  const scenario = input({
    slots,
    candidates: [candidate({ candidateId: 'c0', sourceAssetId: 'a0', eligibleSlotIds: slots.map((s) => s.slotId), sceneKey: 'k0' })],
  });
  // structurally valid (within the validator's own MAX_SLOTS=64), so this must reach the solver
  const validation = validateSemanticGlobalAssignmentInput(scenario);
  assert.equal(validation.ok, true);
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'SEARCH_SCOPE_TOO_LARGE');
  assert.deepEqual(result.assignments, []);
});

// =========================================================================
// 9. No input mutation; deep-frozen output; two-run equality; hash binding
// =========================================================================

test('the input object is never mutated by either function', () => {
  const scenario = minimalValidInput();
  const before = JSON.stringify(scenario);
  validateSemanticGlobalAssignmentInput(scenario);
  buildSemanticGlobalAssignment(scenario);
  assert.equal(JSON.stringify(scenario), before);
});

test('the output is deep-frozen at every level, for both assigned and hold outcomes', () => {
  const assigned = buildSemanticGlobalAssignment(minimalValidInput());
  assert.equal(Object.isFrozen(assigned), true);
  assert.equal(Object.isFrozen(assigned.assignments), true);
  assert.equal(Object.isFrozen(assigned.diagnostics), true);
  assert.equal(Object.isFrozen(assigned.diagnostics.repeats), true);
  if (assigned.assignments.length > 0) assert.equal(Object.isFrozen(assigned.assignments[0]), true);
  assert.throws(() => { assigned.decision = 'tampered'; }, TypeError);
  assert.throws(() => { assigned.assignments.push({}); }, TypeError);

  const badInput = minimalValidInput();
  delete badInput.limits;
  const held = buildSemanticGlobalAssignment(badInput);
  assert.equal(Object.isFrozen(held), true);
  assert.equal(Object.isFrozen(held.assignments), true);
  assert.equal(held.assignments.length, 0);
});

test('two independent runs on structurally-equivalent (but distinct-object) input produce deep-equal, hash-equal output', () => {
  const scenario = () => input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [
      candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'lisa', eligibleSlotIds: ['main', 'secondary'], semanticScore: 5, qualityScore: 5, slotFitScore: 5, sceneKey: 'k1' }),
      candidate({ candidateId: 'c2', sourceAssetId: 's2', personId: 'nene', eligibleSlotIds: ['main', 'secondary'], semanticScore: 3, qualityScore: 3, slotFitScore: 3, sceneKey: 'k2' }),
    ],
    requiredCast: [requiredCastEntry({ personId: 'lisa' }), requiredCastEntry({ personId: 'nene' })],
  });
  const r1 = buildSemanticGlobalAssignment(scenario());
  const r2 = buildSemanticGlobalAssignment(scenario());
  assert.notEqual(r1, r2); // distinct object instances
  assert.deepEqual(r1, r2);
  assert.equal(r1.assignmentHash, r2.assignmentHash);
});

test('assignmentHash is exactly the SHA-256 of the canonical JSON of every other output field', () => {
  const cases = [minimalValidInput(), (() => { const bad = minimalValidInput(); delete bad.limits; return bad; })()];
  for (const scenario of cases) {
    const result = buildSemanticGlobalAssignment(scenario);
    const { assignmentHash, ...rest } = result;
    assert.equal(assignmentHash, independentSha256(rest));
    // changing any single field must change the hash: verified by comparing an assigned
    // and a differently-reasoned hold from elsewhere in this file (cross-referenced below)
  }
});

test('assignmentHash changes when decision/reason/assignments/diagnostics differ, proving the hash actually binds them', () => {
  const assigned = buildSemanticGlobalAssignment(minimalValidInput());
  const missingLimits = minimalValidInput();
  delete missingLimits.limits;
  const heldA = buildSemanticGlobalAssignment(missingLimits);
  const missingSlots = minimalValidInput();
  missingSlots.slots = [];
  const heldB = buildSemanticGlobalAssignment(missingSlots);

  assert.notEqual(assigned.assignmentHash, heldA.assignmentHash);
  assert.notEqual(heldA.assignmentHash, heldB.assignmentHash);
  assert.notEqual(assigned.reason, heldA.reason);
  assert.notEqual(heldA.reason, heldB.reason);
});

// =========================================================================
// 10. validateSemanticGlobalAssignmentInput and buildSemanticGlobalAssignment agree
// =========================================================================

test('validateSemanticGlobalAssignmentInput and buildSemanticGlobalAssignment agree across a battery of valid and hostile fixtures', () => {
  const fixtures = [];

  fixtures.push(minimalValidInput());

  const missingField = minimalValidInput();
  delete missingField.heroAuthority;
  fixtures.push(missingField);

  const surplusField = minimalValidInput();
  surplusField.notAllowed = true;
  fixtures.push(surplusField);

  const dupSlot = input({
    slots: [slot({ slotId: 'dup', order: 0 }), slot({ slotId: 'dup', order: 1 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', eligibleSlotIds: ['dup'], sceneKey: 'k1' })],
  });
  fixtures.push(dupSlot);

  const heroMismatch = input({
    slots: [slot({ slotId: 'main', order: 0 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'lisa', eligibleSlotIds: ['main'], sceneKey: 'k1' })],
    hero: heroAuthority({ heroSlotId: 'main', heroPersonId: 'nene', approvedCandidateIds: ['c1'] }),
  });
  fixtures.push(heroMismatch);

  const slotUnfillable = input({
    slots: [slot({ slotId: 'needs-lisa', order: 0, personId: 'lisa' })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'nene', eligibleSlotIds: ['needs-lisa'], sceneKey: 'k1' })],
  });
  fixtures.push(slotUnfillable);

  const requiredInfeasible = input({
    slots: [slot({ slotId: 'only', order: 0 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', eligibleSlotIds: ['only'], sceneKey: 'k1' })],
    requiredCast: [requiredCastEntry({ personId: 'ghost' })],
  });
  fixtures.push(requiredInfeasible);

  const scopeTooLarge = (() => {
    const slots = [];
    for (let i = 0; i < 9; i += 1) slots.push(slot({ slotId: `s${i}`, order: i }));
    return input({
      slots,
      candidates: [candidate({ candidateId: 'c0', sourceAssetId: 'a0', eligibleSlotIds: slots.map((s) => s.slotId), sceneKey: 'k0' })],
    });
  })();
  fixtures.push(scopeTooLarge);

  const withProxy = (() => {
    const real = minimalValidInput();
    return new Proxy(real, {});
  })();
  fixtures.push(withProxy);

  for (const fixture of fixtures) {
    assertAgreement(fixture);
  }
});

// =========================================================================
// 11. Review D: hero fixed-person bypass (P1), no attacker echo (P2),
//     requiredCast.priority contract clarity
// =========================================================================

test('P1: an active hero cannot override the hero slot\'s own person requirement, even with an approved, eligible candidate for a different person', () => {
  const scenario = input({
    slots: [slot({ slotId: 'hero-slot', order: 0, personId: 'nene' }), slot({ slotId: 'other', order: 1 })],
    candidates: [
      candidate({ candidateId: 'lisa-1', sourceAssetId: 'a1', personId: 'lisa', eligibleSlotIds: ['hero-slot'], sceneKey: 'k1' }),
      candidate({ candidateId: 'filler', sourceAssetId: 'a2', eligibleSlotIds: ['other'], sceneKey: 'k2' }),
    ],
    hero: heroAuthority({ heroSlotId: 'hero-slot', heroPersonId: 'lisa', approvedCandidateIds: ['lisa-1'] }),
  });
  const { validation, built } = assertAgreement(scenario);
  assert.equal(validation.reason, 'CONFLICT');
  assert.equal(validation.path, 'heroAuthority.heroPersonId');
  assert.equal(built.reason, 'CONFLICT');
  assert.deepEqual(built.assignments, []);
});

test('P1: an active hero whose person matches the hero slot\'s own requirement succeeds', () => {
  const scenario = input({
    slots: [slot({ slotId: 'hero-slot', order: 0, personId: 'lisa' }), slot({ slotId: 'other', order: 1 })],
    candidates: [
      candidate({ candidateId: 'lisa-1', sourceAssetId: 'a1', personId: 'lisa', eligibleSlotIds: ['hero-slot'], sceneKey: 'k1' }),
      candidate({ candidateId: 'filler', sourceAssetId: 'a2', eligibleSlotIds: ['other'], sceneKey: 'k2' }),
    ],
    hero: heroAuthority({ heroSlotId: 'hero-slot', heroPersonId: 'lisa', approvedCandidateIds: ['lisa-1'] }),
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  assert.equal(result.assignments.find((a) => a.slotId === 'hero-slot').candidateId, 'lisa-1');
});

test('P1: a hero slot with no person requirement of its own still accepts any approved heroPersonId', () => {
  const scenario = input({
    slots: [slot({ slotId: 'hero-slot', order: 0, personId: null }), slot({ slotId: 'other', order: 1 })],
    candidates: [
      candidate({ candidateId: 'lisa-1', sourceAssetId: 'a1', personId: 'lisa', eligibleSlotIds: ['hero-slot'], sceneKey: 'k1' }),
      candidate({ candidateId: 'filler', sourceAssetId: 'a2', eligibleSlotIds: ['other'], sceneKey: 'k2' }),
    ],
    hero: heroAuthority({ heroSlotId: 'hero-slot', heroPersonId: 'lisa', approvedCandidateIds: ['lisa-1'] }),
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'assigned');
  assert.equal(result.assignments.find((a) => a.slotId === 'hero-slot').candidateId, 'lisa-1');
});

test('P2: a sentinel slotId never appears in the output when a slot is unfillable', () => {
  const sentinel = 'SENTINEL-slotid-9f8a7b6c';
  const scenario = input({
    slots: [slot({ slotId: sentinel, order: 0, personId: 'lisa' })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'nene', eligibleSlotIds: [sentinel], sceneKey: 'k1' })],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'SLOT_UNFILLABLE');
  assert.match(result.path, /^slots\[\d+\]$/);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test('P2: a sentinel personId never appears in path/message (the free-form breadcrumb fields) when a required person is infeasible — only in the documented diagnostics.missing list', () => {
  const sentinel = 'SENTINEL-personid-2b1c0d';
  const scenario = input({
    slots: [slot({ slotId: 'only', order: 0 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'someone-else', eligibleSlotIds: ['only'], sceneKey: 'k1' })],
    requiredCast: [requiredCastEntry({ personId: sentinel })],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'REQUIRED_CAST_INFEASIBLE');
  // path/message are the free-form breadcrumb fields P2 locks down to fixed literals and
  // canonical numeric indexes — these must never carry the sentinel.
  assert.match(result.path, /^requiredCast\[\d+\]$/);
  assert.equal(result.path.includes(sentinel), false);
  assert.equal(result.message, null);
  // diagnostics.missing is a different, documented contract (section 1/4 above): it exists
  // specifically to name which required personId is uncovered, using only the caller's own
  // requiredCast identities — that is its job, not an echo bug, so the sentinel legitimately
  // appears there.
  assert.deepEqual(result.diagnostics.missing, [sentinel]);
});

test('P2: a forced internal validation exception never echoes the raw error message', () => {
  const sentinel = 'SENTINEL-internal-error-7d3e1a';
  const scenario = minimalValidInput();
  const originalGetPrototypeOf = Object.getPrototypeOf;
  Object.getPrototypeOf = function patchedGetPrototypeOf(obj) {
    if (obj === scenario) throw new Error(sentinel);
    return originalGetPrototypeOf(obj);
  };
  try {
    const result = validateSemanticGlobalAssignmentInput(scenario);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'INTERNAL_VALIDATION_ERROR');
    assert.equal(JSON.stringify(result).includes(sentinel), false);
  } finally {
    Object.getPrototypeOf = originalGetPrototypeOf;
  }
});

test('P2: SEARCH_LIMIT_EXCEEDED carries a fixed constant message, never a live search-state count', () => {
  const slots = [];
  for (let i = 0; i < 6; i += 1) slots.push(slot({ slotId: `s${i}`, order: i }));
  const candidates = [];
  for (let i = 0; i < 64; i += 1) {
    candidates.push(candidate({ candidateId: `c${i}`, sourceAssetId: `a${i}`, eligibleSlotIds: slots.map((s) => s.slotId), semanticScore: i, sceneKey: `k${i}` }));
  }
  const scenario = input({ slots, candidates, lim: limits({ maxPersonRepeats: 1000, maxSceneRepeats: 1000 }) });
  const r1 = buildSemanticGlobalAssignment(scenario);
  const r2 = buildSemanticGlobalAssignment(scenario);
  assert.equal(r1.reason, 'SEARCH_LIMIT_EXCEEDED');
  assert.equal(r1.message, r2.message);
  assert.ok(!/\d/.test(r1.message), 'message must not carry a dynamic count');
});

test('requiredCast.priority is non-authoritative: changing it cannot alter the chosen assignment or its hash', () => {
  const buildScenario = (priorities) => input({
    slots: [slot({ slotId: 'main', order: 0 }), slot({ slotId: 'secondary', order: 1 })],
    candidates: [
      candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'lisa', eligibleSlotIds: ['main', 'secondary'], semanticScore: 5, qualityScore: 5, slotFitScore: 5, sceneKey: 'k1' }),
      candidate({ candidateId: 'c2', sourceAssetId: 's2', personId: 'nene', eligibleSlotIds: ['main', 'secondary'], semanticScore: 3, qualityScore: 3, slotFitScore: 3, sceneKey: 'k2' }),
    ],
    requiredCast: [
      requiredCastEntry({ personId: 'lisa', priority: priorities[0] }),
      requiredCastEntry({ personId: 'nene', priority: priorities[1] }),
    ],
  });
  const low = buildSemanticGlobalAssignment(buildScenario([0, 1]));
  const high = buildSemanticGlobalAssignment(buildScenario([999, 1000000]));
  const swapped = buildSemanticGlobalAssignment(buildScenario([1, 0]));
  assert.deepEqual(low, high);
  assert.deepEqual(low, swapped);
  assert.equal(low.assignmentHash, high.assignmentHash);
  assert.equal(low.assignmentHash, swapped.assignmentHash);
});

// =========================================================================
// 12. Review E: requiredCast diagnostic path misaddress, revoked-Proxy
//     classification stability
// =========================================================================

test('E1: an infeasible required entry sorting after an optional entry still points at its own canonical requiredCast index, never the optional one', () => {
  // canonical requiredCast is sorted by personId across ALL entries (required or not):
  // 'aaa-optional' (required:false) sorts to index 0, 'zzz-required-infeasible' to index 1.
  const scenario = input({
    slots: [slot({ slotId: 'only', order: 0 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'someone-else', eligibleSlotIds: ['only'], sceneKey: 'k1' })],
    requiredCast: [
      requiredCastEntry({ personId: 'aaa-optional', required: false }),
      requiredCastEntry({ personId: 'zzz-required-infeasible', required: true }),
    ],
  });
  const validation = validateSemanticGlobalAssignmentInput(scenario);
  assert.equal(validation.ok, true);
  assert.equal(validation.canonicalInput.requiredCast[0].personId, 'aaa-optional');
  assert.equal(validation.canonicalInput.requiredCast[1].personId, 'zzz-required-infeasible');

  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'REQUIRED_CAST_INFEASIBLE');
  assert.equal(result.path, 'requiredCast[1]');
  assert.notEqual(result.path, 'requiredCast[0]');
});

test('E1: with the optional/required order reversed in canonical form, the infeasible entry still points at its own index', () => {
  // same scenario, but the optional entry's personId now sorts AFTER the required one, so the
  // infeasible required entry is canonical index 0 — confirms the fix follows the entry, not
  // a fixed position.
  const scenario = input({
    slots: [slot({ slotId: 'only', order: 0 })],
    candidates: [candidate({ candidateId: 'c1', sourceAssetId: 's1', personId: 'someone-else', eligibleSlotIds: ['only'], sceneKey: 'k1' })],
    requiredCast: [
      requiredCastEntry({ personId: 'aaa-required-infeasible', required: true }),
      requiredCastEntry({ personId: 'zzz-optional', required: false }),
    ],
  });
  const result = buildSemanticGlobalAssignment(scenario);
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'REQUIRED_CAST_INFEASIBLE');
  assert.equal(result.path, 'requiredCast[0]');
});

test('E2: a revoked Proxy at the root is a stable EXOTIC_OBJECT, never INTERNAL_VALIDATION_ERROR, with zero handler side effects', () => {
  let trapCalls = 0;
  const { proxy, revoke } = Proxy.revocable(minimalValidInput(), {
    get() { trapCalls += 1; return undefined; },
    getOwnPropertyDescriptor() { trapCalls += 1; return undefined; },
    getPrototypeOf() { trapCalls += 1; return null; },
    ownKeys() { trapCalls += 1; return []; },
  });
  revoke();
  const validation = validateSemanticGlobalAssignmentInput(proxy);
  const built = buildSemanticGlobalAssignment(proxy);
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, 'EXOTIC_OBJECT');
  assert.notEqual(validation.reason, 'INTERNAL_VALIDATION_ERROR');
  assert.equal(built.reason, 'EXOTIC_OBJECT');
  assert.equal(trapCalls, 0, 'a revoked proxy has no live handler to invoke, and none should be attempted');
});

test('E2: a revoked Proxy nested as a slots/candidates array is a stable EXOTIC_ARRAY, never INTERNAL_VALIDATION_ERROR', () => {
  const { proxy: revokedSlots, revoke: revokeSlots } = Proxy.revocable(
    [slot({ slotId: 'only', order: 0 })],
    {},
  );
  revokeSlots();
  const scenarioA = minimalValidInput();
  scenarioA.slots = revokedSlots;
  const resultA = validateSemanticGlobalAssignmentInput(scenarioA);
  assert.equal(resultA.ok, false);
  assert.equal(resultA.reason, 'EXOTIC_ARRAY');

  const { proxy: revokedCandidates, revoke: revokeCandidates } = Proxy.revocable(
    [candidate({ candidateId: 'c1', sourceAssetId: 's1', eligibleSlotIds: ['only'], sceneKey: 'k1' })],
    {},
  );
  revokeCandidates();
  const scenarioB = minimalValidInput();
  scenarioB.candidates = revokedCandidates;
  const resultB = validateSemanticGlobalAssignmentInput(scenarioB);
  assert.equal(resultB.ok, false);
  assert.equal(resultB.reason, 'EXOTIC_ARRAY');
});

test('E2: a live (non-revoked) Proxy is still rejected with zero trap invocations after the reorder', () => {
  let trapCalls = 0;
  const real = minimalValidInput();
  const proxied = new Proxy(real, {
    getOwnPropertyDescriptor(target, key) { trapCalls += 1; return Object.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { trapCalls += 1; return Object.getPrototypeOf(target); },
    ownKeys(target) { trapCalls += 1; return Reflect.ownKeys(target); },
    get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
  });
  const validation = validateSemanticGlobalAssignmentInput(proxied);
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, 'EXOTIC_OBJECT');
  assert.equal(trapCalls, 0);
});
