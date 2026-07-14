// Deterministic tests for the Hero Shot Contract pure module.
// Run WITHOUT node_modules:  node --test tests/hero-shot-contract.test.mjs
// Every assertion is deterministic (no time, no randomness, no IO).
//
// The module under test is a bare `.js` that uses ESM `export` syntax; Node's
// automatic module-syntax detection loads it as an ES module, so this .mjs
// imports it with named ESM imports (same convention as decision-evidence.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HERO_SHOT_CONTRACT_VERSION,
  SHOT_CLASSES,
  VISIBLE_BODY_REGIONS,
  PROVENANCE_SOURCES,
  HERO_HOLD_REASONS,
  AXIS_NOT_EVALUATED,
  buildHeroShotContract,
  canonicalizeHeroShotContract,
  hashHeroShotContract,
  evaluateHeroShotCandidate,
  isHeroHoldReason,
} from '../src/lib/heroShotContract.js';

// A closeup contract: story identity = "lisa" + reference shot target = closeup,
// bound to a fixed asset/slot pair. Used as the shared baseline for most scenarios.
function closeupContract(overrides = {}) {
  return buildHeroShotContract({
    sourceAssetId: overrides.sourceAssetId || 'asset-1',
    heroSlotId: overrides.heroSlotId || 'slot-hero',
    story: { personId: 'lisa', identityConfidenceMin: 0.8, ...(overrides.story || {}) },
    reference: { shotClass: 'closeup', ...(overrides.reference || {}) },
  });
}

// A candidate that satisfies every closeup fidelity band AND every binding
// requirement for a given (already-built) contract, by construction.
function goodCandidateFor(contract, overrides = {}) {
  return {
    personId: 'lisa',
    identityConfidence: 0.95,
    isGroupShot: false,
    faceShare: 0.5,
    headroom: 0.06,
    visibleBodyRegion: 'face_only',
    occlusion: 0.02,
    edgeCut: 0.01,
    orientation: 'portrait',
    aspectRatio: 0.8,
    resolution: { width: 1200, height: 1500 },
    cleanliness: 0.9,
    sourceAssetId: contract.binding.sourceAssetId,
    heroSlotId: contract.binding.heroSlotId,
    boundContractHash: contract.contractHash,
    ...overrides,
  };
}

// Evaluates with expectedContractHash defaulted to the contract's own embedded
// hash (the common "trusted build" case); pass optsOverrides to change that.
function evaluate(contract, candidate, optsOverrides = {}) {
  return evaluateHeroShotCandidate(contract, candidate, {
    expectedContractHash: contract && contract.contractHash,
    ...optsOverrides,
  });
}

// Like closeupContract, but deliberately does NOT set story.identityConfidenceMin,
// so identityConfidenceMinProvenance/allowGroupProvenance/targetVisibleBodyRegion/
// faceShareBand/headroomBand/orientationTarget/aspectRatioTarget are all left to
// derive from the deterministic defaults (only shotClass is reference-tagged).
// Used by the P1-2 "derived value must equal the real derivation" tests below.
function derivedFieldsContract(overrides = {}) {
  return buildHeroShotContract({
    sourceAssetId: overrides.sourceAssetId || 'asset-1',
    heroSlotId: overrides.heroSlotId || 'slot-hero',
    story: { personId: 'lisa', ...(overrides.story || {}) },
    reference: { shotClass: 'closeup', ...(overrides.reference || {}) },
  });
}

// =========================================================================
// Constants
// =========================================================================
test('version + allowlist constants', () => {
  assert.equal(HERO_SHOT_CONTRACT_VERSION, 1);
  assert.equal(AXIS_NOT_EVALUATED, null);
  assert.deepEqual([...SHOT_CLASSES], ['closeup', 'bust', 'medium', 'full']);
  assert.deepEqual([...PROVENANCE_SOURCES], ['story', 'reference', 'derived']);
  assert.deepEqual([...VISIBLE_BODY_REGIONS], [
    'face_only', 'head_shoulders', 'bust', 'half_body', 'three_quarter', 'full_body',
  ]);
  assert.deepEqual([...HERO_HOLD_REASONS], [
    'HERO_IDENTITY_MISMATCH',
    'HERO_NO_CROP_CAPABLE_ASSET',
    'HERO_FACE_SHARE_OUT_OF_BAND',
    'HERO_HEADROOM_OUT_OF_BAND',
    'HERO_RESOLUTION_TOO_LOW',
    'HERO_OCCLUSION_TOO_HIGH',
    'HERO_EDGE_CUT_TOO_HIGH',
    'HERO_NOT_CLEAN',
    'HERO_CONTRACT_TAMPERED',
    'HERO_MISSING_REQUIRED_CANDIDATE_FIELD',
    'HERO_ASSET_BINDING_MISMATCH',
    'HERO_SLOT_BINDING_MISMATCH',
  ]);
  assert.equal(isHeroHoldReason('HERO_NOT_CLEAN'), true);
  assert.equal(isHeroHoldReason('HERO_ASSET_BINDING_MISMATCH'), true);
  assert.equal(isHeroHoldReason('NOT_A_REAL_REASON'), false);
});

// =========================================================================
// Scenario 1 — full accept: identity from story, shot target from reference
// =========================================================================
test('scenario 1: matching identity + matching closeup framing => fully accepted', () => {
  const contract = closeupContract();
  assert.notEqual(contract, null);

  // provenance: identity fields are story-owned; shot target is reference-owned;
  // binding fields are story-owned.
  assert.equal(contract.binding.sourceAssetId, 'asset-1');
  assert.equal(contract.binding.sourceAssetIdProvenance, 'story');
  assert.equal(contract.binding.heroSlotId, 'slot-hero');
  assert.equal(contract.binding.heroSlotIdProvenance, 'story');
  assert.equal(contract.story.personIdProvenance, 'story');
  assert.equal(contract.story.identityConfidenceMinProvenance, 'story');
  assert.equal(contract.shot.shotClassProvenance, 'reference');
  assert.equal(contract.shot.shotClass, 'closeup');
  assert.equal(contract.shot.targetVisibleBodyRegion, 'face_only');

  const verdict = evaluate(contract, goodCandidateFor(contract));
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.identityValid, true);
  assert.equal(verdict.fidelityValid, true);
  assert.equal(verdict.reason, null);
  assert.equal(verdict.provenance.identitySource, 'story');
  assert.equal(verdict.provenance.shotClassSource, 'reference');
  assert.equal(verdict.contractHash, hashHeroShotContract(contract));
});

// =========================================================================
// Scenario 2 — identity passes, fidelity fails (specific typed reasons)
// =========================================================================
test('scenario 2: correct person but face-share out of band => fidelityValid false, typed reason', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { faceShare: 0.10 }); // below closeup band [0.35, 0.75]
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, true);
  assert.equal(verdict.fidelityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_FACE_SHARE_OUT_OF_BAND');
});

test('scenario 2: correct person but headroom out of band => HERO_HEADROOM_OUT_OF_BAND', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { headroom: 0.5 }); // way above closeup band [0.02, 0.12]
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, true);
  assert.equal(verdict.fidelityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_HEADROOM_OUT_OF_BAND');
});

test('scenario 2: correct person but resolution too low => HERO_RESOLUTION_TOO_LOW', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { resolution: { width: 100, height: 100 } });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, true);
  assert.equal(verdict.fidelityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_RESOLUTION_TOO_LOW');
});

test('scenario 2: occlusion-only failure => specific HERO_OCCLUSION_TOO_HIGH, not conflated with edge-cut/cleanliness', () => {
  const contract = closeupContract();
  // Everything else passes; only occlusion exceeds the policy max (0.15).
  const candidate = goodCandidateFor(contract, { occlusion: 0.9, edgeCut: 0.01, cleanliness: 0.9 });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, true);
  assert.equal(verdict.fidelityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_OCCLUSION_TOO_HIGH');
});

test('scenario 2: edge-cut-only failure => specific HERO_EDGE_CUT_TOO_HIGH, not conflated with occlusion/cleanliness', () => {
  const contract = closeupContract();
  // Everything else passes; only edge-cut exceeds the policy max (0.10).
  const candidate = goodCandidateFor(contract, { edgeCut: 0.9, occlusion: 0.01, cleanliness: 0.9 });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, true);
  assert.equal(verdict.fidelityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_EDGE_CUT_TOO_HIGH');
});

test('scenario 2: cleanliness-only failure (occlusion/edge-cut both fine) => HERO_NOT_CLEAN', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { cleanliness: 0.1, occlusion: 0.01, edgeCut: 0.01 });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, true);
  assert.equal(verdict.fidelityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_NOT_CLEAN');
});

// =========================================================================
// Scenario 3 — wrong person / below confidence
// =========================================================================
test('scenario 3: candidate identity-matched to a different personId => HERO_IDENTITY_MISMATCH', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { personId: 'not-lisa' });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_IDENTITY_MISMATCH');
});

test('scenario 3: right person but below confidence threshold => HERO_IDENTITY_MISMATCH', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { identityConfidence: 0.5 }); // threshold is 0.8
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_IDENTITY_MISMATCH');
});

test('scenario 3: group shot when solo is required => HERO_IDENTITY_MISMATCH', () => {
  const contract = closeupContract({ story: { allowGroup: false } });
  const candidate = goodCandidateFor(contract, { isGroupShot: true });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_IDENTITY_MISMATCH');
});

test('scenario 3: even when identity fails, fidelity is still computed independently (real boolean, not not-evaluated)', () => {
  const contract = closeupContract();
  // Wrong person, but otherwise geometrically perfect for the closeup band, and
  // structurally/binding-wise a fully valid candidate — so this is NOT an early
  // gate, and fidelity must be a genuine computed boolean.
  const candidate = goodCandidateFor(contract, { personId: 'someone-else' });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, false);
  assert.equal(verdict.fidelityValid, true); // independent axis, unaffected by identity failure
  assert.notEqual(verdict.fidelityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.reason, 'HERO_IDENTITY_MISMATCH'); // identity reason still takes priority
});

// =========================================================================
// Scenario 4 — closeup target must NOT silently accept full-body framing
// =========================================================================
test('scenario 4: full-body candidate against a closeup target fails fidelity explicitly (no fallback accept)', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, {
    visibleBodyRegion: 'full_body',
    // Even if a caller mistakenly reports a face-share number, region incompatibility
    // must win — this is not a crop problem, it is the wrong asset entirely.
    faceShare: 0.5,
    headroom: 0.06,
  });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.identityValid, true); // identity is fine — this is purely a fidelity failure
  assert.equal(verdict.fidelityValid, false);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_NO_CROP_CAPABLE_ASSET');
});

test('scenario 4: three-quarter candidate is also too far from closeup (no silent accept)', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { visibleBodyRegion: 'three_quarter' });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.fidelityValid, false);
  assert.equal(verdict.reason, 'HERO_NO_CROP_CAPABLE_ASSET');
});

test('scenario 4: adjacent region (head_shoulders) IS close enough to closeup (crop-capable)', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { visibleBodyRegion: 'head_shoulders' });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.fidelityValid, true);
  assert.equal(verdict.accepted, true);
});

// =========================================================================
// Scenario 5 — determinism + tamper detection
// =========================================================================
test('scenario 5: identical logical contract built from reordered-but-equivalent fields hashes the same', () => {
  const a = buildHeroShotContract({
    sourceAssetId: 'asset-1',
    heroSlotId: 'slot-hero',
    story: { personId: 'lisa', allowGroup: false, identityConfidenceMin: 0.8 },
    reference: {
      shotClass: 'closeup',
      faceShareBand: { min: 0.35, max: 0.75 },
      headroomBand: { min: 0.02, max: 0.12 },
    },
  });
  // Same logical values, fields constructed/assigned in a different order.
  const referenceB = {};
  referenceB.headroomBand = { max: 0.12, min: 0.02 };
  referenceB.faceShareBand = { max: 0.75, min: 0.35 };
  referenceB.shotClass = 'closeup';
  const storyB = {};
  storyB.identityConfidenceMin = 0.8;
  storyB.allowGroup = false;
  storyB.personId = 'lisa';
  const b = buildHeroShotContract({
    heroSlotId: 'slot-hero',
    sourceAssetId: 'asset-1',
    reference: referenceB,
    story: storyB,
  });

  assert.notEqual(a, null);
  assert.notEqual(b, null);
  const hashA = hashHeroShotContract(a);
  const hashB = hashHeroShotContract(b);
  assert.equal(typeof hashA, 'string');
  assert.equal(hashA, hashB);
  // Re-hashing the same contract again is still identical (pure determinism, no hidden state).
  assert.equal(hashHeroShotContract(a), hashA);
  assert.equal(a.contractHash, hashA);
});

test('scenario 5: mutating a contract field after hashing is caught fail-closed as HERO_CONTRACT_TAMPERED, with axes not-evaluated', () => {
  const contract = closeupContract();
  const originalHash = hashHeroShotContract(contract);
  const candidate = goodCandidateFor(contract);

  // Sanity: unmutated contract validates normally against its own trusted hash.
  const sane = evaluate(contract, candidate, { expectedContractHash: originalHash });
  assert.equal(sane.accepted, true);

  // Mutate a fidelity-governing field on a deep clone (frozen contract cannot be mutated in place).
  const tampered = structuredClone(contract);
  tampered.shot.faceShareBand.max = 0.99; // silently widen the acceptance band

  const verdict = evaluateHeroShotCandidate(tampered, candidate, { expectedContractHash: originalHash });
  assert.equal(verdict.accepted, false);
  // This is the P1 fix: a structural/tamper HOLD must report axes as "not evaluated",
  // never `false` (which would misleadingly imply "we checked and it failed").
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
});

test('scenario 5: a candidate carrying a stale boundContractHash is rejected as tampered, axes not-evaluated', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { boundContractHash: 'deadbeef' });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('scenario 5: omitting expectedContractHash entirely is rejected — self-consistency alone is not enough', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract);
  // No opts at all — this used to be allowed (optional expectedContractHash);
  // now it must fail closed regardless of how internally consistent the
  // contract/candidate look.
  const verdict = evaluateHeroShotCandidate(contract, candidate);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.detail, 'expected_hash_required');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

// =========================================================================
// Fix (1): exact sourceAssetId + heroSlotId binding — asset-swap / slot-swap
// =========================================================================
test('binding: candidate referencing a different sourceAssetId than the contract is bound to is rejected (asset-swap)', () => {
  const contract = closeupContract({ sourceAssetId: 'asset-real' });
  const candidate = goodCandidateFor(contract, { sourceAssetId: 'asset-attacker-swapped-in' });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_ASSET_BINDING_MISMATCH');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('binding: candidate referencing a different heroSlotId than the contract is bound to is rejected (slot-swap)', () => {
  const contract = closeupContract({ heroSlotId: 'slot-hero-real' });
  const candidate = goodCandidateFor(contract, { heroSlotId: 'slot-attacker-swapped-in' });
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_SLOT_BINDING_MISMATCH');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('binding: a candidate missing boundContractHash entirely is rejected, not silently treated as unbound/pass-through', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract);
  delete candidate.boundContractHash;
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_MISSING_REQUIRED_CANDIDATE_FIELD');
  assert.deepEqual(verdict.detail, { field: 'boundContractHash' });
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('builder requires sourceAssetId and heroSlotId as mandatory first-class fields', () => {
  assert.equal(buildHeroShotContract({
    heroSlotId: 'slot-hero',
    story: { personId: 'lisa' },
  }), null); // missing sourceAssetId
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'asset-1',
    story: { personId: 'lisa' },
  }), null); // missing heroSlotId
  assert.equal(buildHeroShotContract({
    sourceAssetId: '   ',
    heroSlotId: 'slot-hero',
    story: { personId: 'lisa' },
  }), null); // blank sourceAssetId
  const ok = buildHeroShotContract({ sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa' } });
  assert.notEqual(ok, null);
});

// =========================================================================
// Fix (2): reference can never set/weaken safety thresholds
// =========================================================================
test('reference attempting to set/weaken occlusionMax is rejected (whole build fails closed)', () => {
  const rejected = buildHeroShotContract({
    sourceAssetId: 'asset-1',
    heroSlotId: 'slot-hero',
    story: { personId: 'lisa' },
    reference: { shotClass: 'closeup', occlusionMax: 0.99 }, // attempted loosen
  });
  assert.equal(rejected, null);
});

test('reference attempting to set/weaken minResolution is rejected (whole build fails closed)', () => {
  const rejected = buildHeroShotContract({
    sourceAssetId: 'asset-1',
    heroSlotId: 'slot-hero',
    story: { personId: 'lisa' },
    reference: { shotClass: 'closeup', minResolution: { width: 1, height: 1 } }, // attempted loosen
  });
  assert.equal(rejected, null);
});

test('reference attempting to set edgeCutMax / minCleanliness is rejected (whole build fails closed)', () => {
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'asset-1', heroSlotId: 'slot-hero', story: { personId: 'lisa' },
    reference: { edgeCutMax: 0.99 },
  }), null);
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'asset-1', heroSlotId: 'slot-hero', story: { personId: 'lisa' },
    reference: { minCleanliness: 0.0 },
  }), null);
});

test('effective contract always enforces the fixed system policy thresholds regardless of reference', () => {
  const contract = closeupContract();
  assert.equal(contract.shot.occlusionMax, 0.15);
  assert.equal(contract.shot.occlusionMaxProvenance, 'derived');
  assert.equal(contract.shot.edgeCutMax, 0.10);
  assert.equal(contract.shot.edgeCutMaxProvenance, 'derived');
  assert.deepEqual({ ...contract.shot.minResolution }, { width: 480, height: 480 });
  assert.equal(contract.shot.minResolutionProvenance, 'derived');
  assert.equal(contract.shot.minCleanliness, 0.5);
  assert.equal(contract.shot.minCleanlinessProvenance, 'derived');
});

// =========================================================================
// Fix (3): strict shape/enum/range/key enforcement; provenance is hash-bound
// =========================================================================
test('builder rejects unknown top-level / story / reference keys (no silent stripping)', () => {
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa' }, extraTopLevel: true,
  }), null);
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa', unknownStoryField: 1 },
  }), null);
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa' },
    reference: { shotClass: 'closeup', unknownRefField: 1 },
  }), null);
});

test('canonicalizeHeroShotContract rejects a wrong version and unknown top-level/nested keys', () => {
  const contract = closeupContract();
  const wrongVersion = { ...structuredClone(contract), v: 999 };
  assert.equal(canonicalizeHeroShotContract(wrongVersion), null);

  const extraTopKey = { ...structuredClone(contract), rogueField: 'x' };
  assert.equal(canonicalizeHeroShotContract(extraTopKey), null);

  const extraNestedKey = structuredClone(contract);
  extraNestedKey.shot.rogueNested = 'x';
  assert.equal(canonicalizeHeroShotContract(extraNestedKey), null);
});

test('provenance tamper: mutating only a provenance tag (value unchanged) changes the hash / fails validation', () => {
  const contract = closeupContract(); // shotClass is reference-provenance by construction
  const originalHash = hashHeroShotContract(contract);
  assert.equal(contract.shot.shotClassProvenance, 'reference');

  const tampered = structuredClone(contract);
  tampered.shot.shotClassProvenance = 'derived'; // value ('closeup') left untouched
  const tamperedHash = hashHeroShotContract(tampered);

  assert.notEqual(tamperedHash, originalHash);

  const candidate = goodCandidateFor(contract);
  const verdict = evaluateHeroShotCandidate(tampered, candidate, { expectedContractHash: originalHash });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

// =========================================================================
// Fix (4): embedded self-hash AND external expected hash both mandatory —
// a hand-forged, self-consistent contract must not pass just because its own
// hash matches its own content.
// =========================================================================
test('self-rehash forgery: a hand-built contract with a self-consistent embedded hash is rejected against a real different contract\'s trusted hash', () => {
  const realContractB = closeupContract({ sourceAssetId: 'asset-B', heroSlotId: 'slot-B' });
  assert.notEqual(realContractB, null);

  // Hand-forge a contract object directly (NOT via buildHeroShotContract) with
  // attacker-favorable values (e.g. a wide-open faceShareBand), then compute a
  // self-consistent hash for it exactly like the real builder would.
  const forgedCore = {
    v: HERO_SHOT_CONTRACT_VERSION,
    binding: {
      sourceAssetId: 'asset-B', sourceAssetIdProvenance: 'story',
      heroSlotId: 'slot-B', heroSlotIdProvenance: 'story',
    },
    story: {
      personId: 'lisa', personIdProvenance: 'story',
      allowGroup: false, allowGroupProvenance: 'derived',
      identityConfidenceMin: 0.01, identityConfidenceMinProvenance: 'story', // forged: near-zero floor
    },
    shot: {
      shotClass: 'closeup', shotClassProvenance: 'reference',
      targetVisibleBodyRegion: 'face_only', targetVisibleBodyRegionProvenance: 'derived',
      faceShareBand: { min: 0, max: 1 }, faceShareBandProvenance: 'reference', // forged: wide open
      headroomBand: { min: 0, max: 1 }, headroomBandProvenance: 'reference', // forged: wide open
      occlusionMax: 0.15, occlusionMaxProvenance: 'derived',
      edgeCutMax: 0.10, edgeCutMaxProvenance: 'derived',
      minResolution: { width: 480, height: 480 }, minResolutionProvenance: 'derived',
      minCleanliness: 0.5, minCleanlinessProvenance: 'derived',
      orientationTarget: null, orientationTargetProvenance: 'derived',
      aspectRatioTarget: null, aspectRatioTargetProvenance: 'derived',
    },
  };
  const forgedHash = hashHeroShotContract(forgedCore); // self-consistent, deterministically recomputed
  const forgedContract = { ...forgedCore, contractHash: forgedHash };

  // Self-consistency alone checks out...
  assert.equal(hashHeroShotContract(forgedContract), forgedContract.contractHash);

  // ...but evaluating it against a REAL, separately-built contract's trusted hash
  // must reject it, because the forged content differs from what was legitimately built.
  const candidate = goodCandidateFor(realContractB, { faceShare: 0.999, headroom: 0.999 }); // would only pass under forged bands
  const verdict = evaluateHeroShotCandidate(forgedContract, candidate, {
    expectedContractHash: realContractB.contractHash,
  });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.detail, 'expected_hash_mismatch');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

// =========================================================================
// Corrective Fix 1: embedded contractHash is MANDATORY, not "checked if present"
// =========================================================================
test('missing-embedded-hash: a hand-built contract with contractHash deleted is rejected as tampered (mandatory field, not skip-if-absent)', () => {
  const contract = closeupContract();
  const realHash = contract.contractHash;
  // Candidate is bound to the REAL contract's hash (the hash the mutated object
  // would still recompute to, since deleting contractHash doesn't change any
  // canonical field) — not to the mutated object itself.
  const candidate = goodCandidateFor(contract);
  assert.equal(candidate.boundContractHash, realHash);

  const tampered = structuredClone(contract);
  delete tampered.contractHash;
  assert.equal(tampered.contractHash, undefined);

  const verdict = evaluateHeroShotCandidate(tampered, candidate, { expectedContractHash: realHash });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  // P2 fix: canonicalizeHeroShotContract's own mandatory top-level exact-shape gate
  // (present, non-blank contractHash among exactly {v,binding,story,shot,contractHash})
  // now catches this EARLIER than the evaluator's old dedicated embedded-hash check —
  // canon comes back null at the very first structural gate, so this is
  // 'invalid_contract', not the old 'embedded_hash_missing'.
  assert.equal(verdict.detail, 'invalid_contract');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

// =========================================================================
// Corrective Fix 2: nested band/resolution objects reject extra keys
// =========================================================================
test('canonicalizeHeroShotContract rejects faceShareBand carrying an extra key', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.shot.faceShareBand.evil = true;
  assert.equal(canonicalizeHeroShotContract(tampered), null);

  const candidate = goodCandidateFor(contract);
  const verdict = evaluateHeroShotCandidate(tampered, candidate, { expectedContractHash: contract.contractHash });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('canonicalizeHeroShotContract rejects headroomBand carrying an extra key', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.shot.headroomBand.evil = true;
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

test('canonicalizeHeroShotContract rejects minResolution carrying an extra key', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.shot.minResolution.evil = true;
  assert.equal(canonicalizeHeroShotContract(tampered), null);

  const candidate = goodCandidateFor(contract);
  const verdict = evaluateHeroShotCandidate(tampered, candidate, { expectedContractHash: contract.contractHash });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

// =========================================================================
// Corrective Fix 3: per-field provenance allowlists (not a generic 3-value enum
// check applied identically to every field)
// =========================================================================
test('provenance allowlist: binding.sourceAssetIdProvenance = "derived" is rejected even though it is a technically-valid enum value', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.binding.sourceAssetIdProvenance = 'derived'; // valid under old generic check, invalid under strict per-field allowlist (story-only)
  assert.equal(canonicalizeHeroShotContract(tampered), null);

  const candidate = goodCandidateFor(contract);
  const verdict = evaluateHeroShotCandidate(tampered, candidate, { expectedContractHash: contract.contractHash });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('provenance allowlist: shot.occlusionMaxProvenance = "story" is rejected (fixed-policy field must always be "derived")', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.shot.occlusionMaxProvenance = 'story';
  assert.equal(canonicalizeHeroShotContract(tampered), null);

  const candidate = goodCandidateFor(contract);
  const verdict = evaluateHeroShotCandidate(tampered, candidate, { expectedContractHash: contract.contractHash });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('provenance allowlist: story.allowGroupProvenance = "reference" is rejected (reference input never contributes to story facts)', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.story.allowGroupProvenance = 'reference';
  assert.equal(canonicalizeHeroShotContract(tampered), null);

  const candidate = goodCandidateFor(contract);
  const verdict = evaluateHeroShotCandidate(tampered, candidate, { expectedContractHash: contract.contractHash });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

// =========================================================================
// Corrective Fix 4: policy fields are EXACT-value-checked, not range-checked
// =========================================================================
test('canonicalizeHeroShotContract rejects occlusionMax deviating from the fixed policy constant, even though it still passes a unit-interval range check (defense-in-depth at the canonicalizer level, not only via hash mismatch)', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.shot.occlusionMax = 0.5; // still within [0,1], but not the fixed 0.15
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

// =========================================================================
// Fix (5): candidate fields mandatory, including explicit isGroupShot
// =========================================================================
test('candidate missing isGroupShot is rejected fail-closed, NOT silently defaulted to solo', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract);
  delete candidate.isGroupShot;
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_MISSING_REQUIRED_CANDIDATE_FIELD');
  assert.deepEqual(verdict.detail, { field: 'isGroupShot' });
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('candidate with non-boolean isGroupShot is also rejected fail-closed (wrong type, not just missing)', () => {
  const contract = closeupContract();
  const candidate = goodCandidateFor(contract, { isGroupShot: 'false' }); // string, not boolean
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_MISSING_REQUIRED_CANDIDATE_FIELD');
  assert.deepEqual(verdict.detail, { field: 'isGroupShot' });
});

test('candidate missing any other mandatory field (e.g. resolution, cleanliness) is rejected fail-closed', () => {
  const contract = closeupContract();

  const noResolution = goodCandidateFor(contract);
  delete noResolution.resolution;
  const v1 = evaluate(contract, noResolution);
  assert.equal(v1.reason, 'HERO_MISSING_REQUIRED_CANDIDATE_FIELD');
  assert.deepEqual(v1.detail, { field: 'resolution' });
  assert.equal(v1.identityValid, AXIS_NOT_EVALUATED);

  const noCleanliness = goodCandidateFor(contract);
  delete noCleanliness.cleanliness;
  const v2 = evaluate(contract, noCleanliness);
  assert.equal(v2.reason, 'HERO_MISSING_REQUIRED_CANDIDATE_FIELD');
  assert.deepEqual(v2.detail, { field: 'cleanliness' });
});

// =========================================================================
// Builder validation — fail-closed on structurally invalid input
// =========================================================================
test('builder returns null on invalid or missing story identity', () => {
  assert.equal(buildHeroShotContract(), null);
  assert.equal(buildHeroShotContract({}), null);
  assert.equal(buildHeroShotContract({ sourceAssetId: 'a', heroSlotId: 's', story: {} }), null);
  assert.equal(buildHeroShotContract({ sourceAssetId: 'a', heroSlotId: 's', story: { personId: '   ' } }), null);
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa', allowGroup: 'yes' },
  }), null);
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa', identityConfidenceMin: 1.5 },
  }), null);
});

test('builder returns null on invalid reference shape', () => {
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa' }, reference: 'nope',
  }), null);
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa' }, reference: { shotClass: 'wide' },
  }), null);
  assert.equal(buildHeroShotContract({
    sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa' },
    reference: { faceShareBand: { min: 0.8, max: 0.2 } }, // min > max
  }), null);
});

test('builder fills gaps with derived defaults and tags provenance accordingly', () => {
  const contract = buildHeroShotContract({
    sourceAssetId: 'a', heroSlotId: 's', story: { personId: 'lisa' },
  });
  assert.notEqual(contract, null);
  assert.equal(contract.story.allowGroupProvenance, 'derived');
  assert.equal(contract.story.identityConfidenceMinProvenance, 'derived');
  assert.equal(contract.shot.shotClassProvenance, 'derived');
  assert.equal(contract.shot.faceShareBandProvenance, 'derived');
  assert.equal(contract.shot.headroomBandProvenance, 'derived');
  assert.equal(contract.shot.occlusionMaxProvenance, 'derived');
  assert.equal(contract.shot.edgeCutMaxProvenance, 'derived');
  assert.equal(contract.shot.minResolutionProvenance, 'derived');
  assert.equal(contract.shot.minCleanlinessProvenance, 'derived');
  assert.equal(contract.shot.orientationTargetProvenance, 'derived');
  assert.equal(contract.shot.aspectRatioTargetProvenance, 'derived');
});

// =========================================================================
// Immutability — the builder returns a deep-frozen contract
// =========================================================================
test('builder returns a deep-frozen contract; mutation attempts throw', () => {
  const contract = closeupContract();
  assert.ok(Object.isFrozen(contract));
  assert.ok(Object.isFrozen(contract.binding));
  assert.ok(Object.isFrozen(contract.story));
  assert.ok(Object.isFrozen(contract.shot));
  assert.ok(Object.isFrozen(contract.shot.faceShareBand));
  assert.throws(() => { contract.story.personId = 'mallory'; }, TypeError);
  assert.throws(() => { contract.binding.sourceAssetId = 'mallory-asset'; }, TypeError);
  assert.throws(() => { contract.shot.faceShareBand.max = 1; }, TypeError);
  assert.throws(() => { contract.newField = 1; }, TypeError);
});

// =========================================================================
// Canonicalizer / hasher — direct null-safety checks
// =========================================================================
test('canonicalizeHeroShotContract / hashHeroShotContract reject malformed shapes', () => {
  assert.equal(canonicalizeHeroShotContract(null), null);
  assert.equal(canonicalizeHeroShotContract('nope'), null);
  assert.equal(canonicalizeHeroShotContract({}), null);
  assert.equal(canonicalizeHeroShotContract({ story: {}, shot: {} }), null);
  assert.equal(hashHeroShotContract(null), null);
  assert.equal(hashHeroShotContract({}), null);
});

// =========================================================================
// Evaluator — malformed contract/candidate never throws, always fail-closed,
// and early gates report "not evaluated" (never false) for identity/fidelity.
// =========================================================================
test('evaluator never throws on garbage input and fails closed with not-evaluated axes', () => {
  assert.doesNotThrow(() => {
    const v1 = evaluateHeroShotCandidate(null, null);
    assert.equal(v1.accepted, false);
    assert.equal(v1.reason, 'HERO_CONTRACT_TAMPERED');
    assert.equal(v1.identityValid, AXIS_NOT_EVALUATED);
    assert.equal(v1.fidelityValid, AXIS_NOT_EVALUATED);

    const contract = closeupContract();

    // Valid trusted hash supplied, but candidate is null => missing required fields.
    const v2 = evaluateHeroShotCandidate(contract, null, { expectedContractHash: contract.contractHash });
    assert.equal(v2.accepted, false);
    assert.equal(v2.reason, 'HERO_MISSING_REQUIRED_CANDIDATE_FIELD');
    assert.equal(v2.identityValid, AXIS_NOT_EVALUATED);
    assert.equal(v2.fidelityValid, AXIS_NOT_EVALUATED);

    // Valid trusted hash supplied, candidate missing everything but personId.
    const v3 = evaluateHeroShotCandidate(contract, { personId: 'lisa' }, { expectedContractHash: contract.contractHash });
    assert.equal(v3.accepted, false);
    assert.equal(v3.reason, 'HERO_MISSING_REQUIRED_CANDIDATE_FIELD');
    assert.equal(v3.identityValid, AXIS_NOT_EVALUATED);
    assert.equal(v3.fidelityValid, AXIS_NOT_EVALUATED);
  });
});

// =========================================================================
// Round 3 — P1-1: raw builder-input band objects reject extra/missing keys
// BEFORE the builder copies out {min,max} (fail the WHOLE build, not just
// silently drop the extra key).
// =========================================================================
test('builder: reference.faceShareBand carrying an extra key fails the whole build (not silently dropped)', () => {
  const rejected = buildHeroShotContract({
    sourceAssetId: 'asset-1', heroSlotId: 'slot-hero',
    story: { personId: 'lisa' },
    reference: { shotClass: 'closeup', faceShareBand: { min: 0.35, max: 0.75, evil: true } },
  });
  assert.equal(rejected, null);
});

test('builder: reference.headroomBand carrying an extra key fails the whole build', () => {
  const rejected = buildHeroShotContract({
    sourceAssetId: 'asset-1', heroSlotId: 'slot-hero',
    story: { personId: 'lisa' },
    reference: { shotClass: 'closeup', headroomBand: { min: 0.02, max: 0.12, evil: true } },
  });
  assert.equal(rejected, null);
});

test('builder: reference.faceShareBand missing max entirely fails the whole build', () => {
  const rejected = buildHeroShotContract({
    sourceAssetId: 'asset-1', heroSlotId: 'slot-hero',
    story: { personId: 'lisa' },
    reference: { shotClass: 'closeup', faceShareBand: { min: 0.35 } },
  });
  assert.equal(rejected, null);
});

test('builder: reference.headroomBand missing min entirely fails the whole build', () => {
  const rejected = buildHeroShotContract({
    sourceAssetId: 'asset-1', heroSlotId: 'slot-hero',
    story: { personId: 'lisa' },
    reference: { shotClass: 'closeup', headroomBand: { max: 0.12 } },
  });
  assert.equal(rejected, null);
});

// =========================================================================
// Round 3 — P1-2: a field TAGGED 'derived' must actually HOLD the value the
// real deterministic derivation would produce — provenance tag alone is not
// sufficient proof. 'story'/'reference'-tagged fields remain free-choice.
// =========================================================================
test('P1-2: shotClass provenance flipped from reference to derived, value left as closeup (!= DEFAULT_SHOT_CLASS) => rejected', () => {
  const contract = closeupContract();
  assert.equal(contract.shot.shotClassProvenance, 'reference');
  assert.equal(contract.shot.shotClass, 'closeup');

  const tampered = structuredClone(contract);
  tampered.shot.shotClassProvenance = 'derived'; // value ('closeup') left untouched
  assert.equal(canonicalizeHeroShotContract(tampered), null);

  const candidate = goodCandidateFor(contract);
  const verdict = evaluateHeroShotCandidate(tampered, candidate, { expectedContractHash: contract.contractHash });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('P1-2: targetVisibleBodyRegion mutated inconsistent with this contract\'s own shotClass while still tagged derived => rejected', () => {
  const contract = derivedFieldsContract(); // shotClass 'closeup' => derived target 'face_only'
  assert.notEqual(contract, null);
  assert.equal(contract.shot.targetVisibleBodyRegionProvenance, 'derived');
  assert.equal(contract.shot.targetVisibleBodyRegion, 'face_only');

  const tampered = structuredClone(contract);
  tampered.shot.targetVisibleBodyRegion = 'full_body'; // inconsistent with shotClass 'closeup'
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

test('P1-2: faceShareBand widened while still tagged derived => rejected', () => {
  const contract = derivedFieldsContract();
  assert.equal(contract.shot.faceShareBandProvenance, 'derived');

  const tampered = structuredClone(contract);
  tampered.shot.faceShareBand.max = 0.99; // silently widen the acceptance band
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

test('P1-2: headroomBand widened while still tagged derived => rejected', () => {
  const contract = derivedFieldsContract();
  assert.equal(contract.shot.headroomBandProvenance, 'derived');

  const tampered = structuredClone(contract);
  tampered.shot.headroomBand.max = 0.99;
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

test('P1-2: identityConfidenceMin mutated away from 0.75 while still tagged derived => rejected', () => {
  const contract = derivedFieldsContract();
  assert.equal(contract.story.identityConfidenceMinProvenance, 'derived');
  assert.equal(contract.story.identityConfidenceMin, 0.75);

  const tampered = structuredClone(contract);
  tampered.story.identityConfidenceMin = 0.01; // attacker: near-zero floor, still tagged derived
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

test('P1-2: allowGroup mutated to true while still tagged derived => rejected', () => {
  const contract = derivedFieldsContract();
  assert.equal(contract.story.allowGroupProvenance, 'derived');
  assert.equal(contract.story.allowGroup, false);

  const tampered = structuredClone(contract);
  tampered.story.allowGroup = true;
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

test('P1-2: orientationTarget mutated to a non-null value while still tagged derived => rejected', () => {
  const contract = derivedFieldsContract();
  assert.equal(contract.shot.orientationTargetProvenance, 'derived');
  assert.equal(contract.shot.orientationTarget, null);

  const tampered = structuredClone(contract);
  tampered.shot.orientationTarget = 'portrait';
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

test('P1-2: aspectRatioTarget mutated to a non-null number while still tagged derived => rejected', () => {
  const contract = derivedFieldsContract();
  assert.equal(contract.shot.aspectRatioTargetProvenance, 'derived');
  assert.equal(contract.shot.aspectRatioTarget, null);

  const tampered = structuredClone(contract);
  tampered.shot.aspectRatioTarget = 1.5;
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

test('P1-2 sanity: reference/story-tagged fields differing from the derived default remain free-choice, NOT rejected', () => {
  // shotClass 'closeup' via reference differs from DEFAULT_SHOT_CLASS 'medium' —
  // still valid, since it is 'reference'-tagged, not 'derived'-tagged.
  const closeup = closeupContract();
  assert.equal(closeup.shot.shotClassProvenance, 'reference');
  assert.notEqual(canonicalizeHeroShotContract(closeup), null);

  // identityConfidenceMin 0.9 via story differs from DEFAULT_IDENTITY_CONFIDENCE_MIN
  // 0.75 — still valid, since it is 'story'-tagged.
  const custom = buildHeroShotContract({
    sourceAssetId: 'asset-1', heroSlotId: 'slot-hero',
    story: { personId: 'lisa', identityConfidenceMin: 0.9 },
    reference: { shotClass: 'bust' },
  });
  assert.notEqual(custom, null);
  assert.equal(custom.story.identityConfidenceMinProvenance, 'story');
  assert.equal(custom.story.identityConfidenceMin, 0.9);
  assert.equal(custom.shot.shotClassProvenance, 'reference');
  assert.equal(custom.shot.shotClass, 'bust');
  const canon = canonicalizeHeroShotContract(custom);
  assert.notEqual(canon, null);
  assert.equal(canon.story.identityConfidenceMin, 0.9);
  assert.equal(canon.shot.shotClass, 'bust');
});

// =========================================================================
// Round 3 — P2: the PUBLIC canonicalizeHeroShotContract must require the
// embedded contractHash as part of the EXACT top-level shape (both "no extra
// key" AND "every required key present"), not merely tolerate its absence.
// =========================================================================
test('P2: canonicalizeHeroShotContract directly rejects a full contract with contractHash deleted', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  delete tampered.contractHash;
  assert.equal(tampered.contractHash, undefined);
  assert.equal(canonicalizeHeroShotContract(tampered), null);
});

test('P2: hashHeroShotContract still works on a contractHash-less in-progress object (does not accidentally require contractHash on the internal payload path)', () => {
  const contract = closeupContract();
  const inProgress = {
    v: contract.v,
    binding: structuredClone(contract.binding),
    story: structuredClone(contract.story),
    shot: structuredClone(contract.shot),
    // no contractHash key at all — simulates the builder's in-progress object
    // before it assigns contract.contractHash = hashHeroShotContract(contract).
  };
  assert.equal('contractHash' in inProgress, false);
  const hash = hashHeroShotContract(inProgress);
  assert.equal(typeof hash, 'string');
  assert.notEqual(hash, null);
  assert.equal(hash, contract.contractHash); // same logical content => same hash
});

test('P2: buildHeroShotContract still produces a valid, non-null, deep-frozen contract end-to-end (builder not broken by the canonicalizer split)', () => {
  const contract = closeupContract();
  assert.notEqual(contract, null);
  assert.equal(typeof contract.contractHash, 'string');
  assert.ok(contract.contractHash.length > 0);
  assert.ok(Object.isFrozen(contract));
  const canon = canonicalizeHeroShotContract(contract);
  assert.notEqual(canon, null);
  const candidate = goodCandidateFor(contract);
  const verdict = evaluate(contract, candidate);
  assert.equal(verdict.accepted, true);
});

// =========================================================================
// Round 3 — ADDITIONAL: end-to-end weaken -> self-rehash -> forged-external-
// hash regressions for ALL FOUR fixed policy fields (prior round only covered
// occlusionMax at the canonicalizer level). For each: weaken the field, try to
// recompute a self-consistent contractHash for the tampered clone, and confirm
// the policy-exactness invariant (baked into the SHARED canonicalization logic
// that both the public gate and hashHeroShotContract run) catches it — either
// at self-rehash time itself (hashHeroShotContract returns null, the strongest
// proof) or at evaluation time with axes not-evaluated.
// =========================================================================
test('policy end-to-end: weakened occlusionMax cannot be self-rehashed, and is rejected everywhere', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.shot.occlusionMax = 0.99; // weakened from fixed policy 0.15

  // The attacker cannot even produce a self-consistent hash for the weakened
  // contract: the shared policy-exactness check runs inside hashHeroShotContract too.
  assert.equal(hashHeroShotContract(tampered), null);

  // Direct canonicalizer check, using a borrowed (real) contractHash to prove the
  // rejection is the policy-exactness check itself, not merely a missing/blank hash.
  assert.equal(canonicalizeHeroShotContract({ ...tampered, contractHash: contract.contractHash }), null);

  // End-to-end: even against the contract's own real, trusted expectedContractHash,
  // the tampered object never canonicalizes, so evaluation holds fail-closed.
  const candidate = goodCandidateFor(contract, { occlusion: 0.9 }); // only "passes" under the weakened policy
  const verdict = evaluateHeroShotCandidate(
    { ...tampered, contractHash: contract.contractHash },
    candidate,
    { expectedContractHash: contract.contractHash },
  );
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('policy end-to-end: weakened edgeCutMax cannot be self-rehashed, and is rejected everywhere', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.shot.edgeCutMax = 0.99; // weakened from fixed policy 0.10

  assert.equal(hashHeroShotContract(tampered), null);
  assert.equal(canonicalizeHeroShotContract({ ...tampered, contractHash: contract.contractHash }), null);

  const candidate = goodCandidateFor(contract, { edgeCut: 0.9 });
  const verdict = evaluateHeroShotCandidate(
    { ...tampered, contractHash: contract.contractHash },
    candidate,
    { expectedContractHash: contract.contractHash },
  );
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('policy end-to-end: weakened minResolution cannot be self-rehashed, and is rejected everywhere', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.shot.minResolution = { width: 1, height: 1 }; // weakened from fixed policy 480x480

  assert.equal(hashHeroShotContract(tampered), null);
  assert.equal(canonicalizeHeroShotContract({ ...tampered, contractHash: contract.contractHash }), null);

  const candidate = goodCandidateFor(contract, { resolution: { width: 10, height: 10 } });
  const verdict = evaluateHeroShotCandidate(
    { ...tampered, contractHash: contract.contractHash },
    candidate,
    { expectedContractHash: contract.contractHash },
  );
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});

test('policy end-to-end: weakened minCleanliness cannot be self-rehashed, and is rejected everywhere', () => {
  const contract = closeupContract();
  const tampered = structuredClone(contract);
  tampered.shot.minCleanliness = 0.0; // weakened from fixed policy 0.5

  assert.equal(hashHeroShotContract(tampered), null);
  assert.equal(canonicalizeHeroShotContract({ ...tampered, contractHash: contract.contractHash }), null);

  const candidate = goodCandidateFor(contract, { cleanliness: 0.01 });
  const verdict = evaluateHeroShotCandidate(
    { ...tampered, contractHash: contract.contractHash },
    candidate,
    { expectedContractHash: contract.contractHash },
  );
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, 'HERO_CONTRACT_TAMPERED');
  assert.equal(verdict.identityValid, AXIS_NOT_EVALUATED);
  assert.equal(verdict.fidelityValid, AXIS_NOT_EVALUATED);
});
