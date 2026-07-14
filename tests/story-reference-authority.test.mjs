// Deterministic hostile tests for the Story/Reference Authority contract
// (Phase A, Round 6 hardened). Run WITHOUT node_modules:
//   node --test tests/story-reference-authority.test.mjs
// Every assertion is deterministic (no time, no randomness, no IO).
//
// Round 6 posture on top of everything below:
//   - Map-copying helpers (captureProvenance, sortMapKeys) now target a
//     null-prototype object, so an own enumerable key literally named
//     "__proto__" survives the copy as a real property instead of
//     vanishing (or hijacking the copy's prototype) through the inherited
//     Object.prototype.__proto__ setter — the exact-schema surplus check
//     can then actually see and reject it.
//   - The builder's top-level input reads (story/reference/manualRefLock)
//     are now own-property-only (hasOwn-gated), so a polluted
//     Object.prototype cannot silently supply authority the caller never
//     actually provided as an own field.
//
// Round 5 posture on top of Round 2/3/4's fail-closed exact schema, deep
// structural validation, and provenance truth:
//   - The contract/external hash is now SHA-256 (64 lowercase hex chars),
//     not the old 32-bit FNV1a checksum — expectedHash format checks and
//     all dummy/placeholder hash literals below reflect this.
//   - Every object/array boundary rejects Proxy outright, before any
//     reflection is performed (a getter/trap invocation count of 0 is the
//     proof this module never gives a hostile getter/trap the chance to
//     run, closing the TOCTOU window).
//   - Arrays are captured descriptor-first: holes, extra/symbol-keyed own
//     properties, index accessors, and overridden instance methods
//     (slice/etc — never called in the first place) are all handled.
//   - The public canonicalizeContract/hashContract/validateContract build
//     exactly one snapshot of the caller's contract and never re-read the
//     original object.
//   - A successful contract's `rejections` must be the captured intrinsic
//     empty array — a Proxy, a surplus own property, etc. on that array is
//     rejected the same way as a non-empty one.
//   - The neutral id namespace has an explicit capacity (24 slots); an
//     oversize reference is rejected deterministically before remapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTRACT_VERSION,
  PROVENANCE_VALUES,
  REJECTION_REASONS,
  LAYOUT_TOPOLOGY_VALUES,
  SHOT_ARCHETYPE_VALUES,
  SLOT_SHAPE_VALUES,
  buildStoryReferenceAuthorityContract,
  canonicalizeContract,
  hashContract,
  validateContract,
} from '../src/lib/storyReferenceAuthority.js';

const DUMMY_HASH = 'a'.repeat(64); // syntactically valid (64 lowercase hex), value irrelevant for format-only checks

// A minimal valid story: the AUTHOR of identity/semantic truth. Satisfies
// the exact 8-key schema.
const story = (over = {}) => ({
  identities: ['Somsak Artist'],
  requiredCast: ['Somsak Artist'],
  optionalCast: [],
  editorialHero: 'Somsak Artist',
  eventContext: 'National Art Award ceremony',
  facts: ['Somsak won the national art award'],
  storySemantics: 'an artist winning an award',
  eligibleAssetProvenance: ['award-ceremony-2026'],
  ...over,
});

// A minimal valid, CLEAN reference (layout-only, no leaks). Satisfies the
// exact 8-key schema; all enum values are members of the finite sets, and
// raw ids ('hero'/'circle') satisfy the RAW build-time grammar — the
// builder remaps them into the closed neutral namespace before returning.
const reference = (over = {}) => ({
  layoutTopology: 'tri-split',
  slotGeometry: [
    { id: 'hero', xPct: 0, yPct: 0, wPct: 60, hPct: 100, shape: 'rect' },
    { id: 'circle', xPct: 60, yPct: 0, wPct: 40, hPct: 50, shape: 'circle' },
  ],
  prominence: [{ slotId: 'hero', weight: 0.8 }, { slotId: 'circle', weight: 0.2 }],
  shotArchetype: 'tight_portrait_left_wide_right',
  layerIntent: [{ slotId: 'hero', zIndex: 0 }, { slotId: 'circle', zIndex: 1 }],
  ringBorderFeatherSeam: { ring: true, border: false, feather: true, seam: false },
  negativeSpace: { top: 5, bottom: 5, left: 0, right: 10 },
  hierarchyTargets: ['hero', 'circle'],
  ...over,
});

// Shared fixtures for the reordered-input determinism tests.
const REORDER_STORY_A = {
  identities: ['Somsak Artist', 'Nina Curator'],
  requiredCast: ['Somsak Artist'],
  optionalCast: ['Nina Curator'],
  editorialHero: 'Somsak Artist',
  eventContext: 'National Art Award ceremony',
  facts: ['won the award', 'ceremony was in Bangkok'],
  storySemantics: 'an artist winning an award',
  eligibleAssetProvenance: ['award-ceremony-2026', 'artist-portrait-2025'],
};
const REORDER_STORY_B = {
  eligibleAssetProvenance: ['artist-portrait-2025', 'award-ceremony-2026'],
  storySemantics: 'an artist winning an award',
  facts: ['ceremony was in Bangkok', 'won the award'],
  eventContext: 'National Art Award ceremony',
  editorialHero: 'Somsak Artist',
  optionalCast: ['Nina Curator'],
  requiredCast: ['Somsak Artist'],
  identities: ['Nina Curator', 'Somsak Artist'],
};
const REORDER_REFERENCE_A = reference();
const REORDER_REFERENCE_B = {
  hierarchyTargets: ['circle', 'hero'],
  negativeSpace: { right: 10, left: 0, bottom: 5, top: 5 },
  ringBorderFeatherSeam: { seam: false, feather: true, border: false, ring: true },
  layerIntent: [{ zIndex: 1, slotId: 'circle' }, { zIndex: 0, slotId: 'hero' }],
  shotArchetype: 'tight_portrait_left_wide_right',
  prominence: [{ weight: 0.2, slotId: 'circle' }, { weight: 0.8, slotId: 'hero' }],
  slotGeometry: [
    { shape: 'circle', id: 'circle', xPct: 60, yPct: 0, wPct: 40, hPct: 50 },
    { shape: 'rect', id: 'hero', xPct: 0, yPct: 0, wPct: 60, hPct: 100 },
  ],
  layoutTopology: 'tri-split',
};

// =========================================================================
// Basics
// =========================================================================
test('version + provenance enum constants', () => {
  assert.equal(CONTRACT_VERSION, 1);
  assert.deepEqual([...PROVENANCE_VALUES], ['story', 'reference', 'derived']);
});

test('layout enums are finite, frozen, closed sets; the derived sentinel is reserved (not a valid input value)', () => {
  assert.ok(Object.isFrozen(LAYOUT_TOPOLOGY_VALUES));
  assert.ok(Object.isFrozen(SHOT_ARCHETYPE_VALUES));
  assert.ok(Object.isFrozen(SLOT_SHAPE_VALUES));
  assert.ok(LAYOUT_TOPOLOGY_VALUES.includes('tri-split'));
  assert.ok(SHOT_ARCHETYPE_VALUES.includes('tight_portrait_left_wide_right'));
  assert.ok(SLOT_SHAPE_VALUES.includes('rect'));
  assert.ok(!SHOT_ARCHETYPE_VALUES.includes('archetype_unspecified'));
});

test('happy path builds an ok:true contract, v1, no rejections, deep-frozen, and passes the public canonicalize/hash/validate gates', () => {
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  assert.equal(result.ok, true);
  const { contract } = result;
  assert.equal(contract.v, 1);
  assert.equal(contract.manualRefLock, false);
  assert.deepEqual(contract.rejections, []);
  assert.ok(Object.isFrozen(contract));
  assert.ok(Object.isFrozen(contract.identity));
  assert.ok(Object.isFrozen(contract.layout));
  assert.ok(Object.isFrozen(contract.layout.slotGeometry));
  assert.throws(() => { contract.v = 99; }, TypeError);
  assert.throws(() => { contract.layout.slotGeometry.push({}); }, TypeError);

  // The builder's own output is not so strict it rejects itself.
  assert.notEqual(canonicalizeContract(contract), null);
  assert.equal(hashContract(contract), contract.hash);
  assert.deepEqual(validateContract(contract, contract.hash), { ok: true, reason: null, details: {} });
});

// =========================================================================
// GROUP 1 — SHA-256: real cryptographic hash, format, and tamper
// sensitivity regressions.
// =========================================================================
test('the contract hash is a real SHA-256 digest — 64 lowercase hex characters, not the old 32-bit FNV1a checksum', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  assert.equal(typeof contract.hash, 'string');
  assert.equal(contract.hash.length, 64);
  assert.ok(/^[0-9a-f]{64}$/.test(contract.hash));

  // A tiny reimplementation of the OLD 32-bit FNV1a checksum this module
  // used through Round 4, kept here only to document what changed: an
  // 8-hex-character (32-bit) output space is small enough that a
  // determined attacker can plausibly search for a colliding malformed
  // payload (a birthday-style collision needs only ~2^16 attempts). The
  // new SHA-256 output is 256 bits — no practical collision search exists.
  function oldFnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  assert.equal(oldFnv1a32('anything').length, 8);
  assert.notEqual(contract.hash.length, oldFnv1a32('anything').length);
});

test('SHA-256 tamper sensitivity: distinct content changes always produce distinct hashes (non-colliding tamper regression)', () => {
  const base = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const variants = [
    story({ editorialHero: 'Different Person' }),
    story({ eventContext: 'National Art Award ceremon' }), // one character shorter
    story({ facts: ['Somsak won the national art award', 'x'] }),
    story({ storySemantics: 'AN artist winning an award' }), // single-char case change
  ];
  const hashes = new Set([base.contract.hash]);
  for (const v of variants) {
    const r = buildStoryReferenceAuthorityContract({ story: v, reference: reference() });
    assert.equal(r.ok, true);
    assert.equal(hashes.has(r.contract.hash), false, 'tampered content must never collide with a prior hash');
    hashes.add(r.contract.hash);
  }
  assert.equal(hashes.size, 1 + variants.length);
});

test('expectedHash format is now exactly 64 lowercase hex characters, independent of the embedded hash', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  assert.equal(validateContract(contract, 'a'.repeat(63)).reason, 'EXPECTED_HASH_INVALID'); // too short
  assert.equal(validateContract(contract, 'a'.repeat(65)).reason, 'EXPECTED_HASH_INVALID'); // too long
  assert.equal(validateContract(contract, 'A'.repeat(64)).reason, 'EXPECTED_HASH_INVALID'); // wrong case
  assert.equal(validateContract(contract, 'not-a-hash'.padEnd(64, '0')).reason, 'EXPECTED_HASH_INVALID'); // non-hex chars
  assert.equal(validateContract(contract, contract.hash).ok, true);
});

// =========================================================================
// GROUP 2 — Proxy rejection at every boundary, without ever invoking a
// trap or getter (the concrete proof the TOCTOU window is closed).
// =========================================================================
test('validateContract/canonicalizeContract reject a Proxy at the top level, without invoking any trap', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  let trapCalls = 0;
  const proxied = new Proxy({ ...contract, identity: { ...contract.identity }, layout: { ...contract.layout }, provenance: { ...contract.provenance } }, {
    get(target, prop, receiver) { trapCalls++; return Reflect.get(target, prop, receiver); },
    getOwnPropertyDescriptor(target, prop) { trapCalls++; return Reflect.getOwnPropertyDescriptor(target, prop); },
    ownKeys(target) { trapCalls++; return Reflect.ownKeys(target); },
    getPrototypeOf(target) { trapCalls++; return Reflect.getPrototypeOf(target); },
  });
  assert.equal(canonicalizeContract(proxied), null);
  assert.equal(hashContract(proxied), null);
  const result = validateContract(proxied, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(trapCalls, 0, 'no Proxy trap should ever be invoked — the Proxy check must come before any reflection');
});

test('validateContract/canonicalizeContract reject a Proxy at a nested boundary (identity), without invoking any trap', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  let trapCalls = 0;
  const proxiedIdentity = new Proxy({ ...contract.identity }, {
    get(target, prop, receiver) { trapCalls++; return Reflect.get(target, prop, receiver); },
    getOwnPropertyDescriptor(target, prop) { trapCalls++; return Reflect.getOwnPropertyDescriptor(target, prop); },
  });
  const forged = { ...contract, identity: proxiedIdentity };
  assert.equal(canonicalizeContract(forged), null);
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(trapCalls, 0);
});

test('validateContract/canonicalizeContract reject a Proxy wrapping a slot-geometry array, without invoking any trap', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  let trapCalls = 0;
  const proxiedArray = new Proxy([...contract.layout.slotGeometry], {
    get(target, prop, receiver) { trapCalls++; return Reflect.get(target, prop, receiver); },
    getOwnPropertyDescriptor(target, prop) { trapCalls++; return Reflect.getOwnPropertyDescriptor(target, prop); },
  });
  const forged = { ...contract, layout: { ...contract.layout, slotGeometry: proxiedArray } };
  assert.equal(canonicalizeContract(forged), null);
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(trapCalls, 0);
});

test('a stateful Proxy (would return a different value on each access) is rejected outright — it never gets the chance to exhibit that statefulness', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  let n = 0;
  const stateful = new Proxy({ ...contract.layout }, {
    get(target, prop, receiver) {
      if (prop === 'layoutTopology') { n++; return n % 2 === 0 ? 'tri-split' : 'single'; }
      return Reflect.get(target, prop, receiver);
    },
  });
  const forged = { ...contract, layout: stateful };
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(n, 0, 'the stateful getter must never be invoked, so it never gets a chance to return inconsistent values');
});

// =========================================================================
// GROUP 3 — descriptor-first array capture: index accessors, overridden
// instance methods, holes, and surplus own properties are all handled
// without ever invoking a getter or calling a caller-overridable method.
// =========================================================================
test('array index accessor (getter) on an otherwise-real array is rejected without invoking the getter', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  let getterCalls = 0;
  const arr = [...contract.identity.identities];
  Object.defineProperty(arr, '0', { get() { getterCalls++; return 'Somsak Artist'; }, enumerable: true, configurable: true });
  const forged = { ...contract, identity: { ...contract.identity, identities: arr } };
  assert.equal(canonicalizeContract(forged), null);
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(getterCalls, 0, 'an index accessor must be detected via descriptor inspection alone, never invoked');
});

test('an own overridden slice/array method on a real array is itself treated as a surplus own property and rejected — array capture never calls it to find out', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  let sliceCalled = false;
  const arr = [...contract.identity.identities];
  // Shadowing `.slice` adds an OWN property to the array (distinct from
  // the inherited Array.prototype.slice) — captureArray's exact own-name
  // count therefore (correctly) rejects the whole array as malformed,
  // rather than silently using the real elements while ignoring the
  // override. Either way, the override is never actually CALLED.
  arr.slice = () => { sliceCalled = true; return ['FORGED VALUE']; };
  const result = buildStoryReferenceAuthorityContract({ story: story({ identities: arr }), reference: reference() });
  assert.equal(result.ok, false);
  assert.equal(sliceCalled, false, 'the overridden slice must never be invoked, even to determine rejection');
  assert.ok(result.details.rejections.some((r) => r.field === 'story.identities' && r.reason === REJECTION_REASONS.STORY_TYPE_INVALID));
});

test('array capture rejects sparse arrays (holes) and arrays with a surplus non-numeric own property', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });

  const holey = new Array(2);
  holey[0] = 'Somsak Artist'; // index 1 is left as a hole
  const forgedHoley = { ...contract, identity: { ...contract.identity, identities: holey } };
  assert.equal(canonicalizeContract(forgedHoley), null);

  const surplusProp = [...contract.identity.identities];
  surplusProp.extra = 'sneaky';
  const forgedSurplus = { ...contract, identity: { ...contract.identity, identities: surplusProp } };
  assert.equal(canonicalizeContract(forgedSurplus), null);

  const symbolKeyed = [...contract.identity.identities];
  symbolKeyed[Symbol('hidden')] = 'sneaky';
  const forgedSymbol = { ...contract, identity: { ...contract.identity, identities: symbolKeyed } };
  assert.equal(canonicalizeContract(forgedSymbol), null);
});

// =========================================================================
// GROUP 4 — rejections exact-empty via descriptor-first array capture: a
// Proxy or a surplus own property on the rejections array is rejected the
// same way a non-empty array would be.
// =========================================================================
test('rejections exact-empty check uses descriptor-first array capture too — a Proxy or a surplus own property is rejected the same as a non-empty array, hostile content never echoed', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });

  const proxyRejections = new Proxy([], {});
  assert.equal(canonicalizeContract({ ...contract, rejections: proxyRejections }), null);

  const surplusRejections = [];
  surplusRejections.extra = 'sneaky';
  assert.equal(canonicalizeContract({ ...contract, rejections: surplusRejections }), null);

  const forged = { ...contract, rejections: [{ field: 'x', source: 'reference', reason: 'HOSTILE NARRATIVE TEXT HERE' }] };
  assert.equal(canonicalizeContract(forged), null);
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(result.details.rejections.some((r) => r.reason === REJECTION_REASONS.REJECTIONS_NOT_EMPTY));
  assert.equal(JSON.stringify(result).includes('HOSTILE NARRATIVE TEXT HERE'), false);
});

// =========================================================================
// GROUP 4B (Round 6) — provenance exact-schema __proto__ surplus bypass,
// and polluted-prototype authority injection in the builder.
// =========================================================================
test('provenance exact-schema: an own enumerable __proto__ property cannot silently vanish through the Object.prototype setter during capture — it is detected as surplus and rejected, and the same original trusted hash cannot rescue it', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const forgedProvenance = { ...contract.provenance };
  Object.defineProperty(forgedProvenance, '__proto__', { value: 'reference', enumerable: true, configurable: true, writable: true });

  // Sanity: this really did create an OWN enumerable data property named
  // "__proto__" via defineProperty (which bypasses the special accessor
  // entirely) — the object's ACTUAL prototype is unaffected.
  assert.equal(Object.getPrototypeOf(forgedProvenance), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(forgedProvenance, '__proto__'), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(forgedProvenance, '__proto__'), { value: 'reference', writable: true, enumerable: true, configurable: true });

  const forged = { ...contract, provenance: forgedProvenance };
  assert.equal(canonicalizeContract(forged), null);
  assert.equal(hashContract(forged), null);

  // Paired with the ORIGINAL, otherwise-valid trusted hash — structural/
  // provenance exactness must fire before hash comparison is even reached.
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(result.details.rejections.some((r) => r.field === 'provenance.<surplus>' && r.reason === REJECTION_REASONS.PROVENANCE_SURPLUS));
  assert.equal(JSON.stringify(result).includes('__proto__'), false);
});

test('polluted Object.prototype cannot supply story/reference/manualRefLock authority when the caller does not own those fields — Object.prototype is restored in finally, no leakage into later calls', () => {
  const pollutedStory = story({ editorialHero: 'Polluted Person' });
  const pollutedReference = reference();

  try {
    // eslint-disable-next-line no-extend-native
    Object.prototype.story = pollutedStory;
    Object.prototype.reference = pollutedReference;
    Object.prototype.manualRefLock = true;

    // `story` is required. An object with NO own `story` must fail exactly
    // as a genuinely empty {} would — the inherited pollution must never
    // count as "provided".
    const bareInput = {};
    assert.equal(Object.prototype.hasOwnProperty.call(bareInput, 'story'), false);
    const result1 = buildStoryReferenceAuthorityContract(bareInput);
    assert.equal(result1.ok, false);
    assert.equal(result1.reason, 'STORY_NOT_OBJECT');

    // With an OWN story (satisfying the requirement) but no own
    // reference/manualRefLock, the inherited reference/manualRefLock must
    // be ignored entirely — build as if reference were omitted (all-derived
    // layout) and manualRefLock were false.
    const withOwnStoryOnly = { story: story() };
    assert.equal(Object.prototype.hasOwnProperty.call(withOwnStoryOnly, 'reference'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(withOwnStoryOnly, 'manualRefLock'), false);
    const result2 = buildStoryReferenceAuthorityContract(withOwnStoryOnly);
    assert.equal(result2.ok, true);
    assert.equal(result2.contract.manualRefLock, false);
    for (const k of Object.keys(result2.contract.layout)) {
      assert.equal(result2.contract.provenance[`layout.${k}`], 'derived', `layout.${k} must be derived — the polluted reference must never be used`);
    }
    // The polluted reference's remapped slot ids must never appear — proof
    // its content never entered the build at all.
    assert.equal(JSON.stringify(result2.contract).includes('slot_'), false);
  } finally {
    delete Object.prototype.story;
    delete Object.prototype.reference;
    delete Object.prototype.manualRefLock;
  }

  // Cleanup verified, and a subsequent normal call is fully unaffected —
  // no leakage survives this test.
  assert.equal(Object.prototype.hasOwnProperty('story'), false);
  assert.equal(Object.prototype.hasOwnProperty('reference'), false);
  assert.equal(Object.prototype.hasOwnProperty('manualRefLock'), false);
  const sanity = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  assert.equal(sanity.ok, true);
  assert.deepEqual(validateContract(sanity.contract, sanity.contract.hash), { ok: true, reason: null, details: {} });
});

// =========================================================================
// GROUP 5 — neutral ID capacity: an explicit, documented limit well under
// the 3-digit namespace capacity; oversize input rejected deterministically
// before remapping; builder output always validates under its own public
// validator.
// =========================================================================
test('neutral ID capacity: exactly the documented limit (24 slots) succeeds and validates under the public validator', () => {
  const MAX = 24;
  const makeSlots = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, xPct: 0, yPct: 0, wPct: 1, hPct: 1, shape: 'rect' }));

  const atBoundary = buildStoryReferenceAuthorityContract({
    story: story(),
    reference: reference({ slotGeometry: makeSlots(MAX), prominence: [], layerIntent: [], hierarchyTargets: [] }),
  });
  assert.equal(atBoundary.ok, true);
  assert.equal(atBoundary.contract.layout.slotGeometry.length, MAX);
  for (const s of atBoundary.contract.layout.slotGeometry) {
    assert.equal(/^slot_[0-9]{3}$/.test(s.id), true);
  }
  assert.notEqual(canonicalizeContract(atBoundary.contract), null);
  assert.equal(hashContract(atBoundary.contract), atBoundary.contract.hash);
  assert.deepEqual(validateContract(atBoundary.contract, atBoundary.contract.hash), { ok: true, reason: null, details: {} });
});

test('neutral ID capacity: one slot over the limit is rejected deterministically BEFORE remapping — no partial contract', () => {
  const MAX = 24;
  const makeSlots = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, xPct: 0, yPct: 0, wPct: 1, hPct: 1, shape: 'rect' }));

  const overBoundary = buildStoryReferenceAuthorityContract({
    story: story(),
    reference: reference({ slotGeometry: makeSlots(MAX + 1), prominence: [], layerIntent: [], hierarchyTargets: [] }),
  });
  assert.equal(overBoundary.ok, false);
  assert.equal(overBoundary.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(overBoundary.contract, undefined);
  assert.ok(overBoundary.details.rejections.some((r) => r.field === 'reference.slotGeometry' && r.reason === REJECTION_REASONS.REFERENCE_CAPACITY_EXCEEDED));
});

test('neutral ID capacity: a 1001-slot input is rejected deterministically regardless of input order (reorder-stable), no partial contract, well below any id-namespace overflow', () => {
  const makeSlots = (n, reversed) => {
    const arr = Array.from({ length: n }, (_, i) => ({ id: `slot${i}`, xPct: 0, yPct: 0, wPct: 1, hPct: 1, shape: 'rect' }));
    return reversed ? arr.slice().reverse() : arr;
  };
  const forward = buildStoryReferenceAuthorityContract({
    story: story(),
    reference: reference({ slotGeometry: makeSlots(1001, false), prominence: [], layerIntent: [], hierarchyTargets: [] }),
  });
  const reversed = buildStoryReferenceAuthorityContract({
    story: story(),
    reference: reference({ slotGeometry: makeSlots(1001, true), prominence: [], layerIntent: [], hierarchyTargets: [] }),
  });
  assert.equal(forward.ok, false);
  assert.equal(reversed.ok, false);
  assert.equal(forward.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(reversed.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(forward.contract, undefined);
  assert.equal(reversed.contract, undefined);
  assert.ok(forward.details.rejections.some((r) => r.reason === REJECTION_REASONS.REFERENCE_CAPACITY_EXCEEDED));
  assert.ok(reversed.details.rejections.some((r) => r.reason === REJECTION_REASONS.REFERENCE_CAPACITY_EXCEEDED));
});

test('neutral ID capacity: hierarchyTargets is independently capped too', () => {
  const MAX = 24;
  const slots = Array.from({ length: MAX + 1 }, (_, i) => ({ id: `s${i}`, xPct: 0, yPct: 0, wPct: 1, hPct: 1, shape: 'rect' }));
  const result = buildStoryReferenceAuthorityContract({
    story: story(),
    reference: reference({ slotGeometry: slots, prominence: [], layerIntent: [], hierarchyTargets: slots.map((s) => s.id) }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.hierarchyTargets' && r.reason === REJECTION_REASONS.REFERENCE_CAPACITY_EXCEEDED));
});

test('neutral ID capacity: the validator also enforces the same capacity on a hand-forged candidate', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const oversizedSlots = Array.from({ length: 30 }, (_, i) => ({ id: `slot_${String(i).padStart(3, '0')}`, xPct: 0, yPct: 0, wPct: 1, hPct: 1, shape: 'rect', zIndex: null }));
  const forged = { ...contract, layout: { ...contract.layout, slotGeometry: oversizedSlots } };
  assert.equal(canonicalizeContract(forged), null);
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.reason === REJECTION_REASONS.REFERENCE_CAPACITY_EXCEEDED));
});

// =========================================================================
// GROUP 6 — semantic strings / manual-lock rejected by finite enums and
// neutral ID grammar. Leakage now fails the whole build closed instead of
// being stripped-and-merged.
// =========================================================================
test('layoutTopology/shotArchetype/slot shape reject narrative strings — finite enum only', () => {
  const badTopology = reference({ layoutTopology: 'พระเดินในโรงพยาบาล' });
  const r1 = buildStoryReferenceAuthorityContract({ story: story(), reference: badTopology });
  assert.equal(r1.ok, false);
  assert.ok(r1.details.rejections.some((r) => r.field === 'reference.layoutTopology' && r.reason === REJECTION_REASONS.REFERENCE_ENUM_INVALID));
  assert.equal(/พระ/.test(JSON.stringify(r1)), false);

  const badArchetype = reference({ shotArchetype: 'a monk visiting a hospital' });
  const r2 = buildStoryReferenceAuthorityContract({ story: story(), reference: badArchetype });
  assert.equal(r2.ok, false);
  assert.ok(r2.details.rejections.some((r) => r.field === 'reference.shotArchetype' && r.reason === REJECTION_REASONS.REFERENCE_ENUM_INVALID));
  assert.equal(/monk/i.test(JSON.stringify(r2)), false);

  const badShape = reference({
    slotGeometry: [{ id: 'hero', xPct: 0, yPct: 0, wPct: 60, hPct: 100, shape: 'a monk silhouette' }],
    hierarchyTargets: [],
  });
  const r3 = buildStoryReferenceAuthorityContract({ story: story(), reference: badShape });
  assert.equal(r3.ok, false);
  assert.ok(r3.details.rejections.some((r) => r.field === 'reference.slotGeometry[0].shape' && r.reason === REJECTION_REASONS.REFERENCE_ENUM_INVALID));
});

test('slot ids / slotId references / hierarchy targets reject narrative strings (raw build-time grammar), and a trailing line terminator or control character is rejected, not silently trimmed', () => {
  const badId = reference({
    slotGeometry: [{ id: 'พระสงฆ์', xPct: 0, yPct: 0, wPct: 60, hPct: 100, shape: 'rect' }],
    hierarchyTargets: [],
  });
  const r1 = buildStoryReferenceAuthorityContract({ story: story(), reference: badId });
  assert.equal(r1.ok, false);
  assert.ok(r1.details.rejections.some((r) => r.field === 'reference.slotGeometry[0].id' && r.reason === REJECTION_REASONS.REFERENCE_ID_INVALID));

  const badSlotId = reference({ prominence: [{ slotId: 'a monk', weight: 0.5 }] });
  const r2 = buildStoryReferenceAuthorityContract({ story: story(), reference: badSlotId });
  assert.equal(r2.ok, false);
  assert.ok(r2.details.rejections.some((r) => r.field === 'reference.prominence[0].slotId' && r.reason === REJECTION_REASONS.REFERENCE_ID_INVALID));

  const badHierarchy = reference({ hierarchyTargets: ['a monk in hospital'] });
  const r3 = buildStoryReferenceAuthorityContract({ story: story(), reference: badHierarchy });
  assert.equal(r3.ok, false);
  assert.ok(r3.details.rejections.some((r) => r.field === 'reference.hierarchyTargets[0]' && r.reason === REJECTION_REASONS.REFERENCE_ID_INVALID));

  const withNewline = reference({ slotGeometry: [{ id: 'hero\n', xPct: 0, yPct: 0, wPct: 60, hPct: 100, shape: 'rect' }], hierarchyTargets: [] });
  const r4 = buildStoryReferenceAuthorityContract({ story: story(), reference: withNewline });
  assert.equal(r4.ok, false);
  assert.ok(r4.details.rejections.some((r) => r.field === 'reference.slotGeometry[0].id' && r.reason === REJECTION_REASONS.REFERENCE_ID_INVALID));

  const withNull = reference({ slotGeometry: [{ id: 'hero\x00', xPct: 0, yPct: 0, wPct: 60, hPct: 100, shape: 'rect' }], hierarchyTargets: [] });
  const r5 = buildStoryReferenceAuthorityContract({ story: story(), reference: withNull });
  assert.equal(r5.ok, false);
  assert.ok(r5.details.rejections.some((r) => r.field === 'reference.slotGeometry[0].id' && r.reason === REJECTION_REASONS.REFERENCE_ID_INVALID));
});

test('manualRefLock:true does not unlock identity/hero/cast authority for reference — hostile attempt fails closed either way, without echoing the hostile key names or values', () => {
  const heroStory = story({
    identities: ['Somsak Artist', 'Nina Curator'],
    requiredCast: ['Somsak Artist'],
    optionalCast: ['Nina Curator'],
    editorialHero: 'Somsak Artist',
  });
  const hostileReference = reference({
    editorialHero: 'Someone Else',
    requiredCast: ['Someone Else'],
  });

  const locked = buildStoryReferenceAuthorityContract({ story: heroStory, reference: hostileReference, manualRefLock: true });
  const unlocked = buildStoryReferenceAuthorityContract({ story: heroStory, reference: hostileReference, manualRefLock: false });

  assert.equal(locked.ok, false);
  assert.equal(unlocked.ok, false);
  assert.equal(locked.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(unlocked.reason, 'SCHEMA_VALIDATION_FAILED');

  for (const result of [locked, unlocked]) {
    const surplus = result.details.rejections.filter((r) => r.field === 'reference.<surplus>');
    assert.equal(surplus.length, 2);
    assert.ok(surplus.every((r) => r.reason === REJECTION_REASONS.REFERENCE_IDENTITY_LEAK));
    assert.equal(JSON.stringify(result).includes('Someone Else'), false);
  }
});

// =========================================================================
// GROUP 7 — exact raw required/nested schemas: missing/unknown/surplus/
// wrong types cannot be stripped into validity.
// =========================================================================
test('story: exact schema — missing required key hard-fails the whole build', () => {
  const bad = story();
  delete bad.facts;
  const result = buildStoryReferenceAuthorityContract({ story: bad, reference: reference() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(result.details.rejections.some((r) => r.field === 'story.facts' && r.reason === REJECTION_REASONS.STORY_MISSING_FIELD));
});

test('story: exact schema — surplus/unknown key hard-fails the whole build without echoing the key name', () => {
  const bad = { ...story(), extraField: 'nope' };
  const result = buildStoryReferenceAuthorityContract({ story: bad, reference: reference() });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'story.<surplus>' && r.reason === REJECTION_REASONS.STORY_UNKNOWN_FIELD));
  assert.equal(JSON.stringify(result).includes('extraField'), false);
});

test('story: exact schema — wrong raw type hard-fails the whole build', () => {
  const bad = { ...story(), identities: 'Somsak Artist' };
  const result = buildStoryReferenceAuthorityContract({ story: bad, reference: reference() });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'story.identities' && r.reason === REJECTION_REASONS.STORY_TYPE_INVALID));
});

test('reference: exact schema — missing required key hard-fails the whole build', () => {
  const bad = reference();
  delete bad.negativeSpace;
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.negativeSpace' && r.reason === REJECTION_REASONS.REFERENCE_MISSING_FIELD));
});

test('reference: exact schema — an empty object is present-but-incomplete, not treated as omission', () => {
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: {} });
  assert.equal(result.ok, false);
  assert.equal(result.details.rejections.length, 8);
  assert.ok(result.details.rejections.every((r) => r.reason === REJECTION_REASONS.REFERENCE_MISSING_FIELD));
});

test('reference: exact schema — wrong raw type on a required field hard-fails the whole build', () => {
  const bad = reference({ slotGeometry: 'not-an-array' });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.slotGeometry' && r.reason === REJECTION_REASONS.REFERENCE_TYPE_INVALID));
});

test('reference: exact schema — generic surplus key with no leak pattern still hard-fails, tagged UNKNOWN_FIELD_LEAK, key name never echoed', () => {
  const bad = { ...reference(), zzzNotARealField: 'whatever-value' };
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.<surplus>' && r.reason === REJECTION_REASONS.REFERENCE_UNKNOWN_FIELD_LEAK));
  assert.equal(JSON.stringify(result).includes('zzzNotARealField'), false);
  assert.equal(JSON.stringify(result).includes('whatever-value'), false);
});

test('ringBorderFeatherSeam: exact 4 boolean keys — missing key or wrong type hard-fails', () => {
  const missing = reference({ ringBorderFeatherSeam: { ring: true, border: false, feather: true } });
  const r1 = buildStoryReferenceAuthorityContract({ story: story(), reference: missing });
  assert.equal(r1.ok, false);
  assert.ok(r1.details.rejections.some((r) => r.field === 'reference.ringBorderFeatherSeam.seam' && r.reason === REJECTION_REASONS.REFERENCE_MISSING_FIELD));

  const wrongType = reference({ ringBorderFeatherSeam: { ring: 'yes', border: false, feather: true, seam: false } });
  const r2 = buildStoryReferenceAuthorityContract({ story: story(), reference: wrongType });
  assert.equal(r2.ok, false);
  assert.ok(r2.details.rejections.some((r) => r.field === 'reference.ringBorderFeatherSeam.ring' && r.reason === REJECTION_REASONS.REFERENCE_TYPE_INVALID));
});

// =========================================================================
// GROUP 8 — provenance map exactness, provenance TRUTH, and
// reference-vs-derived shot-archetype provenance.
// =========================================================================
test('every field in a built contract has a valid provenance tag from the 3-value enum', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });

  for (const k of Object.keys(contract.identity)) {
    const tag = contract.provenance[`identity.${k}`];
    assert.ok(PROVENANCE_VALUES.includes(tag), `identity.${k} missing/invalid provenance tag: ${tag}`);
    assert.equal(tag, 'story');
  }
  for (const k of Object.keys(contract.layout)) {
    const tag = contract.provenance[`layout.${k}`];
    assert.ok(PROVENANCE_VALUES.includes(tag), `layout.${k} missing/invalid provenance tag: ${tag}`);
    assert.equal(tag, 'reference');
  }
  assert.equal(contract.provenance.manualRefLock, 'derived');

  const tags = new Set(Object.values(contract.provenance));
  assert.deepEqual([...tags].sort(), ['derived', 'reference', 'story']);
});

test('provenance TRUTH — no-reference regression: every layout field is "derived" when no reference was supplied at all (enforced by builder AND validator)', () => {
  const result = buildStoryReferenceAuthorityContract({ story: story() });
  assert.equal(result.ok, true);
  const { contract } = result;
  for (const k of Object.keys(contract.layout)) {
    assert.equal(contract.provenance[`layout.${k}`], 'derived', `layout.${k} should be derived when no reference was supplied`);
  }
  assert.equal(contract.provenance.manualRefLock, 'derived');
  for (const k of Object.keys(contract.identity)) {
    assert.equal(contract.provenance[`identity.${k}`], 'story');
  }
  assert.deepEqual(validateContract(contract, contract.hash), { ok: true, reason: null, details: {} });
  assert.notEqual(canonicalizeContract(contract), null);
});

test('provenance TRUTH — mixed accepted-reference/fallback: only fields an accepted reference actually populated are "reference", the rest are "derived"', () => {
  const partial = reference({
    prominence: [],
    layerIntent: [],
    ringBorderFeatherSeam: null,
    negativeSpace: null,
    hierarchyTargets: [],
    shotArchetype: null,
  });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: partial });
  assert.equal(result.ok, true);
  const { contract } = result;
  assert.equal(contract.provenance['layout.layoutTopology'], 'reference');
  assert.equal(contract.provenance['layout.slotGeometry'], 'reference');
  assert.equal(contract.provenance['layout.prominence'], 'derived');
  assert.equal(contract.provenance['layout.layerIntent'], 'derived');
  assert.equal(contract.provenance['layout.ringBorderFeatherSeam'], 'derived');
  assert.equal(contract.provenance['layout.negativeSpace'], 'derived');
  assert.equal(contract.provenance['layout.hierarchyTargets'], 'derived');
  assert.equal(contract.provenance['layout.shotArchetype'], 'derived');
  assert.equal(contract.provenance['layout.shotArchetypeResolved'], 'derived');
  assert.deepEqual(validateContract(contract, contract.hash), { ok: true, reason: null, details: {} });
});

test('shot archetype provenance is "reference" only when a valid reference value supplied it, otherwise "derived"', () => {
  const supplied = buildStoryReferenceAuthorityContract({ story: story(), reference: reference({ shotArchetype: 'wide_group' }) });
  assert.equal(supplied.ok, true);
  assert.equal(supplied.contract.layout.shotArchetypeResolved, 'wide_group');
  assert.equal(supplied.contract.provenance['layout.shotArchetypeResolved'], 'reference');

  const unsuppliedButComplete = buildStoryReferenceAuthorityContract({ story: story(), reference: reference({ shotArchetype: null }) });
  assert.equal(unsuppliedButComplete.ok, true);
  assert.equal(unsuppliedButComplete.contract.layout.shotArchetypeResolved, 'archetype_unspecified');
  assert.equal(unsuppliedButComplete.contract.provenance['layout.shotArchetypeResolved'], 'derived');

  const forged = buildStoryReferenceAuthorityContract({ story: story(), reference: reference({ shotArchetype: 'archetype_unspecified' }) });
  assert.equal(forged.ok, false);
  assert.ok(forged.details.rejections.some((r) => r.field === 'reference.shotArchetype' && r.reason === REJECTION_REASONS.REFERENCE_ENUM_INVALID));
});

test('validateContract/canonicalizeContract reject surplus provenance entries that do not correspond to any real identity/layout field, without echoing the injected key', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const forged = { ...contract, provenance: { ...contract.provenance, 'identity.notARealField': 'story' } };
  assert.equal(canonicalizeContract(forged), null);
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(result.details.rejections.some((r) => r.field === 'provenance.<surplus>' && r.reason === REJECTION_REASONS.PROVENANCE_SURPLUS));
  assert.equal(JSON.stringify(result).includes('notARealField'), false);
});

test('validateContract/canonicalizeContract reject a provenance tag outside the 3-value enum, without echoing the forged tag value', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const forged = { ...contract, provenance: { ...contract.provenance, 'identity.editorialHero': 'a monk visiting a hospital narrative tag' } };
  assert.equal(canonicalizeContract(forged), null);
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'provenance.identity.editorialHero' && r.reason === REJECTION_REASONS.PROVENANCE_TAG_INVALID));
  assert.equal(/monk/i.test(JSON.stringify(result)), false);
});

test('validateContract/canonicalizeContract enforce provenance TRUTH exactly — claiming "reference" for an empty/derived field is rejected (PROVENANCE_TRUTH_VIOLATION), and a matching hash cannot rescue it', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story() });
  const forged = { ...contract, provenance: { ...contract.provenance, 'layout.slotGeometry': 'reference' } };
  assert.equal(canonicalizeContract(forged), null);
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'provenance.layout.slotGeometry' && r.reason === REJECTION_REASONS.PROVENANCE_TRUTH_VIOLATION));
});

test('validateContract/canonicalizeContract enforce the shotArchetypeResolved/shotArchetype relationship exactly, both in the accepted-reference and the derived-sentinel/no-reference cases', () => {
  const supplied = buildStoryReferenceAuthorityContract({ story: story(), reference: reference({ shotArchetype: 'wide_group' }) });
  const forgedResolved = { ...supplied.contract, layout: { ...supplied.contract.layout, shotArchetypeResolved: 'closeup_single' } };
  assert.equal(canonicalizeContract(forgedResolved), null);
  const r1 = validateContract(forgedResolved, supplied.contract.hash);
  assert.equal(r1.ok, false);
  assert.ok(r1.details.rejections.some((r) => r.field === 'layout.shotArchetypeResolved' && r.reason === REJECTION_REASONS.REFERENCE_ENUM_INVALID));

  const noRef = buildStoryReferenceAuthorityContract({ story: story() });
  const forgedDerived = { ...noRef.contract, layout: { ...noRef.contract.layout, shotArchetypeResolved: 'wide_group' } };
  assert.equal(canonicalizeContract(forgedDerived), null);
  const r2 = validateContract(forgedDerived, noRef.contract.hash);
  assert.equal(r2.ok, false);
});

test('validateContract deep-validates candidate.identity structure too — a surplus identity field is caught, without echoing it, and a matching hash does not rescue it', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const forged = { ...contract, identity: { ...contract.identity, hostileInjected: 'sneaky value' } };
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(result.details.rejections.some((r) => r.field === 'story.<surplus>'));
  assert.equal(JSON.stringify(result).includes('hostileInjected'), false);
  assert.equal(JSON.stringify(result).includes('sneaky value'), false);
});

test('a reference-origin provenance tag claiming an identity slot fails closed (PROVENANCE_TRUTH_VIOLATION) even with a matching hash', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const forged = { ...contract, provenance: { ...contract.provenance, 'identity.editorialHero': 'reference' } };
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'provenance.identity.editorialHero' && r.reason === REJECTION_REASONS.PROVENANCE_TRUTH_VIOLATION));
});

// =========================================================================
// GROUP 9 — missing/invalid external expectedHash; self-rehash cannot
// substitute for a saved trusted hash.
// =========================================================================
test('validateContract requires a separately supplied expectedHash — missing or malformed format fails closed', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  assert.equal(validateContract(contract).ok, false);
  assert.equal(validateContract(contract).reason, 'EXPECTED_HASH_MISSING');
  assert.equal(validateContract(contract, undefined).reason, 'EXPECTED_HASH_MISSING');
  assert.equal(validateContract(contract, 'not-a-hash').reason, 'EXPECTED_HASH_INVALID');
  assert.equal(validateContract(contract, 'A'.repeat(64)).reason, 'EXPECTED_HASH_INVALID'); // wrong case
  assert.equal(validateContract(contract, 12345678).reason, 'EXPECTED_HASH_INVALID');
  assert.equal(validateContract(contract, contract.hash).ok, true);
});

test('self-rehash cannot substitute a trusted external hash: a tampered candidate with a freshly self-computed hash fails against the original trusted hash', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const trustedHash = contract.hash;

  const tampered = structuredClone(contract);
  tampered.identity.editorialHero = 'Someone Else';
  tampered.hash = hashContract(tampered);
  assert.notEqual(tampered.hash, null);
  assert.equal(hashContract(tampered), tampered.hash);

  const result = validateContract(tampered, trustedHash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'HASH_MISMATCH');
  assert.equal(result.details.check, 'embedded_vs_expected');
});

test('tampered content with an unchanged embedded hash is caught by the recompute-vs-expected check', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const trustedHash = contract.hash;

  const tampered = structuredClone(contract);
  tampered.identity.editorialHero = 'Someone Else';

  const result = validateContract(tampered, trustedHash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'HASH_MISMATCH');
  assert.equal(result.details.check, 'recompute_vs_expected');
});

test('a genuinely untampered candidate validates against its build-time trusted hash', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  assert.deepEqual(validateContract(contract, contract.hash), { ok: true, reason: null, details: {} });
});

test('mutated hash with no expectedHash-matching attempt fails closed (not thrown)', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const cloned = structuredClone(contract);
  cloned.hash = cloned.hash === 'b'.repeat(64) ? 'c'.repeat(64) : 'b'.repeat(64);
  const result = validateContract(cloned, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'HASH_MISMATCH');
});

// =========================================================================
// GROUP 10 — deep structural validation is independent of hash matching.
// =========================================================================
test('validateContract deep-validates the FULL candidate structure, not just its hash — a narrative string where a finite enum is required is caught, hash untouched', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const forged = { ...contract, layout: { ...contract.layout, shotArchetype: 'a monk visiting a hospital' } };
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(result.details.rejections.some((r) => r.field === 'layout.shotArchetype' && r.reason === REJECTION_REASONS.REFERENCE_ENUM_INVALID));
  assert.equal(/monk/i.test(JSON.stringify(result)), false);
});

test('validateContract rejects a candidate whose slotGeometry contains an out-of-range entry, independent of hash matching', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const forgedSlot = { ...contract.layout.slotGeometry[0], xPct: 500 };
  const forged = { ...contract, layout: { ...contract.layout, slotGeometry: [forgedSlot, contract.layout.slotGeometry[1]] } };
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(result.details.rejections.some((r) => r.field === 'layout.slotGeometry[0].xPct' && r.reason === REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID));
});

test('validateContract also rejects duplicate prominence.slotId in a structurally-forged candidate', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const forged = { ...contract, layout: { ...contract.layout, prominence: [...contract.layout.prominence, { ...contract.layout.prominence[0] }] } };
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(result.details.rejections.some((r) => r.reason === REJECTION_REASONS.REFERENCE_DUPLICATE_ID));
});

// =========================================================================
// GROUP 11 — duplicate and dangling slot/hierarchy/prominence/layerIntent
// IDs, including non-adjacent (reorder-stable) duplicates.
// =========================================================================
test('duplicate slot ids are rejected', () => {
  const bad = reference({
    slotGeometry: [
      { id: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 100, shape: 'rect' },
      { id: 'hero', xPct: 50, yPct: 0, wPct: 50, hPct: 100, shape: 'rect' },
    ],
    hierarchyTargets: ['hero'],
  });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.slotGeometry[1]' && r.reason === REJECTION_REASONS.REFERENCE_DUPLICATE_ID));
});

test('duplicate prominence.slotId and layerIntent.slotId are rejected, including non-adjacent (reorder-stable) duplicates', () => {
  const bad = reference({
    prominence: [
      { slotId: 'hero', weight: 0.5 },
      { slotId: 'circle', weight: 0.3 },
      { slotId: 'hero', weight: 0.2 },
    ],
    layerIntent: [
      { slotId: 'circle', zIndex: 0 },
      { slotId: 'hero', zIndex: 1 },
      { slotId: 'circle', zIndex: 2 },
    ],
  });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  const reasons = result.details.rejections;
  assert.ok(reasons.some((r) => r.field === 'reference.prominence[2]' && r.reason === REJECTION_REASONS.REFERENCE_DUPLICATE_ID));
  assert.ok(reasons.some((r) => r.field === 'reference.layerIntent[2]' && r.reason === REJECTION_REASONS.REFERENCE_DUPLICATE_ID));
});

test('dangling prominence/layerIntent slotId references are rejected', () => {
  const bad = reference({
    prominence: [{ slotId: 'ghost', weight: 0.5 }],
    layerIntent: [{ slotId: 'ghost2', zIndex: 0 }],
  });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  const reasons = result.details.rejections;
  assert.ok(reasons.some((r) => r.field === 'reference.prominence[0]' && r.reason === REJECTION_REASONS.REFERENCE_DANGLING_REFERENCE));
  assert.ok(reasons.some((r) => r.field === 'reference.layerIntent[0]' && r.reason === REJECTION_REASONS.REFERENCE_DANGLING_REFERENCE));
});

test('duplicate and dangling hierarchyTargets are rejected', () => {
  const bad = reference({ hierarchyTargets: ['hero', 'hero', 'ghost'] });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  const reasons = result.details.rejections;
  assert.ok(reasons.some((r) => r.field === 'reference.hierarchyTargets[1]' && r.reason === REJECTION_REASONS.REFERENCE_DUPLICATE_ID));
  assert.ok(reasons.some((r) => r.field === 'reference.hierarchyTargets[2]' && r.reason === REJECTION_REASONS.REFERENCE_DANGLING_REFERENCE));
});

// =========================================================================
// GROUP 12 — geometry, bounds, safe-integer, weight, negative-space
// boundaries.
// =========================================================================
test('geometry: xPct below 0, or wPct out of the (0,100] range, are rejected', () => {
  const negX = reference({ slotGeometry: [{ id: 'hero', xPct: -1, yPct: 0, wPct: 50, hPct: 50, shape: 'rect' }], hierarchyTargets: [] });
  assert.equal(buildStoryReferenceAuthorityContract({ story: story(), reference: negX }).ok, false);

  const zeroW = reference({ slotGeometry: [{ id: 'hero', xPct: 0, yPct: 0, wPct: 0, hPct: 50, shape: 'rect' }], hierarchyTargets: [] });
  assert.equal(buildStoryReferenceAuthorityContract({ story: story(), reference: zeroW }).ok, false);

  const overW = reference({ slotGeometry: [{ id: 'hero', xPct: 0, yPct: 0, wPct: 101, hPct: 50, shape: 'rect' }], hierarchyTargets: [] });
  assert.equal(buildStoryReferenceAuthorityContract({ story: story(), reference: overW }).ok, false);
});

test('geometry: bounds must fit the canvas (xPct+wPct <= 100, yPct+hPct <= 100)', () => {
  const bad = reference({ slotGeometry: [{ id: 'hero', xPct: 60, yPct: 0, wPct: 50, hPct: 50, shape: 'rect' }], hierarchyTargets: [] });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.slotGeometry[0]' && r.reason === REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID));
});

test('geometry: zIndex must be a safe integer', () => {
  const bad = reference({ slotGeometry: [{ id: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 50, shape: 'rect', zIndex: 1.5 }], hierarchyTargets: [] });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.slotGeometry[0].zIndex' && r.reason === REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID));
});

test('geometry: an explicit null shape/zIndex on a slot is valid (means "not asserted")', () => {
  const ok = reference({
    slotGeometry: [{ id: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 50, shape: null, zIndex: null }],
    prominence: [],
    layerIntent: [],
    hierarchyTargets: [],
  });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: ok });
  assert.equal(result.ok, true);
  assert.equal(result.contract.layout.slotGeometry[0].shape, null);
  assert.equal(result.contract.layout.slotGeometry[0].zIndex, null);
});

test('prominence weight must be within [0, 1]', () => {
  const bad = reference({ prominence: [{ slotId: 'hero', weight: 1.5 }] });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: bad });
  assert.equal(result.ok, false);
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.prominence[0].weight' && r.reason === REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID));
});

test('negativeSpace values and combined bounds are enforced', () => {
  const outOfRange = reference({ negativeSpace: { top: 101, bottom: 0, left: 0, right: 0 } });
  const r1 = buildStoryReferenceAuthorityContract({ story: story(), reference: outOfRange });
  assert.equal(r1.ok, false);
  assert.ok(r1.details.rejections.some((r) => r.field === 'reference.negativeSpace.top' && r.reason === REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID));

  const overlapping = reference({ negativeSpace: { top: 60, bottom: 60, left: 0, right: 0 } });
  const r2 = buildStoryReferenceAuthorityContract({ story: story(), reference: overlapping });
  assert.equal(r2.ok, false);
  assert.ok(r2.details.rejections.some((r) => r.field === 'reference.negativeSpace' && r.reason === REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID));
});

// =========================================================================
// GROUP 13 — neutral ID namespace: semantic/identity words never survive
// into an emitted id; cross-references remap consistently; a candidate
// presenting a non-neutral id is rejected outright.
// =========================================================================
test('neutral ID namespace: semantic slot ids are remapped to a closed neutral namespace at build time; cross-references remain internally consistent after remap', () => {
  const semantic = reference({
    slotGeometry: [
      { id: 'somsak_artist', xPct: 0, yPct: 0, wPct: 60, hPct: 100, shape: 'rect' },
      { id: 'monk_in_hospital', xPct: 60, yPct: 0, wPct: 40, hPct: 50, shape: 'circle' },
    ],
    prominence: [{ slotId: 'somsak_artist', weight: 0.8 }, { slotId: 'monk_in_hospital', weight: 0.2 }],
    layerIntent: [{ slotId: 'somsak_artist', zIndex: 0 }, { slotId: 'monk_in_hospital', zIndex: 1 }],
    hierarchyTargets: ['somsak_artist', 'monk_in_hospital'],
  });
  const result = buildStoryReferenceAuthorityContract({ story: story(), reference: semantic });
  assert.equal(result.ok, true);
  const { contract } = result;

  const serialized = JSON.stringify(contract);
  for (const needle of ['somsak_artist', 'monk_in_hospital']) {
    assert.equal(serialized.toLowerCase().includes(needle), false, `emitted contract must not contain "${needle}"`);
  }

  for (const s of contract.layout.slotGeometry) {
    assert.equal(/^slot_[0-9]{3}$/.test(s.id), true, `slot id "${s.id}" must be in the closed neutral namespace`);
  }

  const somsakSlot = contract.layout.slotGeometry.find((s) => s.xPct === 0);
  const monkSlot = contract.layout.slotGeometry.find((s) => s.xPct === 60);
  const somsakProminence = contract.layout.prominence.find((p) => p.weight === 0.8);
  const monkProminence = contract.layout.prominence.find((p) => p.weight === 0.2);
  const somsakLayer = contract.layout.layerIntent.find((l) => l.zIndex === 0);
  const monkLayer = contract.layout.layerIntent.find((l) => l.zIndex === 1);

  assert.equal(somsakProminence.slotId, somsakSlot.id);
  assert.equal(monkProminence.slotId, monkSlot.id);
  assert.equal(somsakLayer.slotId, somsakSlot.id);
  assert.equal(monkLayer.slotId, monkSlot.id);
  assert.ok(contract.layout.hierarchyTargets.includes(somsakSlot.id));
  assert.ok(contract.layout.hierarchyTargets.includes(monkSlot.id));

  assert.deepEqual(validateContract(contract, contract.hash), { ok: true, reason: null, details: {} });
  assert.notEqual(canonicalizeContract(contract), null);
});

test('neutral ID namespace: canonicalizeContract/validateContract reject a candidate whose layout ids are not in the closed neutral namespace, even if otherwise well-formed, without echoing the semantic id', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const forgedSlot = { ...contract.layout.slotGeometry[0], id: 'somsak_artist' };
  const forged = { ...contract, layout: { ...contract.layout, slotGeometry: [forgedSlot, contract.layout.slotGeometry[1]] } };
  assert.equal(canonicalizeContract(forged), null);
  assert.equal(hashContract(forged), null);
  const result = validateContract(forged, contract.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(result.details.rejections.some((r) => r.field === 'layout.slotGeometry[0].id' && r.reason === REJECTION_REASONS.REFERENCE_ID_INVALID));
  assert.equal(JSON.stringify(result).includes('somsak_artist'), false);
});

test('neutral ID namespace: reorder byte equality — differently-ordered but logically-equivalent semantic raw ids remap to the SAME neutral ids and byte-identical contracts', () => {
  const semanticA = reference({
    slotGeometry: [
      { id: 'the_award_winner', xPct: 0, yPct: 0, wPct: 60, hPct: 100, shape: 'rect' },
      { id: 'the_venue_crowd', xPct: 60, yPct: 0, wPct: 40, hPct: 50, shape: 'circle' },
    ],
    prominence: [{ slotId: 'the_award_winner', weight: 0.8 }, { slotId: 'the_venue_crowd', weight: 0.2 }],
    layerIntent: [{ slotId: 'the_award_winner', zIndex: 0 }, { slotId: 'the_venue_crowd', zIndex: 1 }],
    hierarchyTargets: ['the_award_winner', 'the_venue_crowd'],
  });
  const semanticB = reference({
    slotGeometry: [
      { id: 'the_venue_crowd', xPct: 60, yPct: 0, wPct: 40, hPct: 50, shape: 'circle' },
      { id: 'the_award_winner', xPct: 0, yPct: 0, wPct: 60, hPct: 100, shape: 'rect' },
    ],
    prominence: [{ slotId: 'the_venue_crowd', weight: 0.2 }, { slotId: 'the_award_winner', weight: 0.8 }],
    layerIntent: [{ slotId: 'the_venue_crowd', zIndex: 1 }, { slotId: 'the_award_winner', zIndex: 0 }],
    hierarchyTargets: ['the_venue_crowd', 'the_award_winner'],
  });

  const resultA = buildStoryReferenceAuthorityContract({ story: story(), reference: semanticA });
  const resultB = buildStoryReferenceAuthorityContract({ story: story(), reference: semanticB });
  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  assert.equal(JSON.stringify(resultA.contract), JSON.stringify(resultB.contract));
  assert.equal(resultA.contract.hash, resultB.contract.hash);
});

// =========================================================================
// GROUP 14 — public canonicalizeContract/hashContract exact gate: hostile
// direct calls for missing/surplus/wrong nested fields, false provenance,
// invalid enums, non-empty rejections.
// =========================================================================
test('public canonicalizeContract/hashContract deep-validate the full contract before any coercion — malformed direct callers fail closed (return null)', () => {
  assert.equal(canonicalizeContract(null), null);
  assert.equal(canonicalizeContract('nope'), null);
  assert.equal(canonicalizeContract(42), null);
  assert.equal(canonicalizeContract([]), null);
  assert.equal(hashContract(null), null);

  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });

  const missingField = { ...contract };
  delete missingField.provenance;
  assert.equal(canonicalizeContract(missingField), null);
  assert.equal(hashContract(missingField), null);

  const surplusField = { ...contract, extra: 'nope' };
  assert.equal(canonicalizeContract(surplusField), null);

  const wrongType = { ...contract, layout: { ...contract.layout, slotGeometry: 'not-an-array' } };
  assert.equal(canonicalizeContract(wrongType), null);

  const falseProvenance = { ...contract, layout: { ...contract.layout, prominence: [] } };
  assert.equal(canonicalizeContract(falseProvenance), null);

  const badEnum = { ...contract, layout: { ...contract.layout, layoutTopology: 'a monk visiting a hospital' } };
  assert.equal(canonicalizeContract(badEnum), null);

  assert.notEqual(canonicalizeContract(contract), null);
  assert.equal(hashContract(contract), contract.hash);
});

test('public canonicalizeContract/hashContract reject exotic objects and non-enumerable properties without invoking getters', () => {
  const { contract } = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });

  const exoticIdentity = { ...contract, identity: new Date() };
  assert.equal(canonicalizeContract(exoticIdentity), null);

  let getterInvoked = false;
  const accessorLayoutBase = { ...contract.layout };
  delete accessorLayoutBase.layoutTopology;
  Object.defineProperty(accessorLayoutBase, 'layoutTopology', {
    enumerable: true,
    configurable: true,
    get() { getterInvoked = true; return 'tri-split'; },
  });
  const accessorContract = { ...contract, layout: accessorLayoutBase };
  assert.equal(canonicalizeContract(accessorContract), null);
  assert.equal(getterInvoked, false, 'the rejection must be detected via descriptor inspection alone, without invoking the getter');

  const nonEnumerableLayoutBase = { ...contract.layout };
  delete nonEnumerableLayoutBase.layoutTopology;
  Object.defineProperty(nonEnumerableLayoutBase, 'layoutTopology', { value: 'tri-split', enumerable: false, configurable: true, writable: true });
  const nonEnumerableContract = { ...contract, layout: nonEnumerableLayoutBase };
  assert.equal(canonicalizeContract(nonEnumerableContract), null);
});

// =========================================================================
// GROUP 15 — mixed code-unit ordering and input-order determinism,
// including byte-identity of the builder's own return value.
// =========================================================================
test('canonicalization uses an explicit code-unit comparator, not localeCompare (divergent ordering proof)', () => {
  const mixed = ['z-artist', 'á-artist'];
  const codeUnitOrder = mixed.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const localeOrder = mixed.slice().sort((a, b) => a.localeCompare(b));
  assert.notDeepEqual(codeUnitOrder, localeOrder);

  const result = buildStoryReferenceAuthorityContract({ story: story({ identities: mixed.slice() }), reference: reference() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.contract.identity.identities, codeUnitOrder);
  assert.deepEqual(canonicalizeContract(result.contract).identity.identities, codeUnitOrder);
});

test('identical logical contracts from differently-ordered input hash identically and both validate against the shared hash', () => {
  const resultA = buildStoryReferenceAuthorityContract({ manualRefLock: false, story: REORDER_STORY_A, reference: REORDER_REFERENCE_A });
  const resultB = buildStoryReferenceAuthorityContract({ reference: REORDER_REFERENCE_B, story: REORDER_STORY_B, manualRefLock: false });

  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  assert.equal(resultA.contract.hash, resultB.contract.hash);
  assert.equal(hashContract(resultA.contract), hashContract(resultB.contract));
  assert.deepEqual(validateContract(resultA.contract, resultA.contract.hash), { ok: true, reason: null, details: {} });
  assert.deepEqual(validateContract(resultB.contract, resultA.contract.hash), { ok: true, reason: null, details: {} });

  assert.deepEqual(canonicalizeContract(resultA.contract), canonicalizeContract(resultB.contract));
});

test('the builder return itself (not only the canonicalized/hashed payload) is byte-identical for logically-equivalent reordered input', () => {
  const resultA = buildStoryReferenceAuthorityContract({ manualRefLock: false, story: REORDER_STORY_A, reference: REORDER_REFERENCE_A });
  const resultB = buildStoryReferenceAuthorityContract({ reference: REORDER_REFERENCE_B, story: REORDER_STORY_B, manualRefLock: false });
  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  assert.equal(JSON.stringify(resultA.contract), JSON.stringify(resultB.contract));
});

test('hash changes when logically-meaningful content changes', () => {
  const a = buildStoryReferenceAuthorityContract({ story: story(), reference: reference() });
  const b = buildStoryReferenceAuthorityContract({ story: story({ editorialHero: 'Different Person' }), reference: reference() });
  assert.notEqual(a.contract.hash, b.contract.hash);
});

// =========================================================================
// GROUP 16 — hostile raw key/value never appears in serialized contract or
// audit/rejection.
// =========================================================================
test('hostile raw key/value never appears in serialized result — build fails closed, audit trail uses fixed placeholders for surplus key names too', () => {
  const poisonedReference = {
    layoutTopology: 'tri-split',
    slotGeometry: [
      { id: 'hero', xPct: 0, yPct: 0, wPct: 60, hPct: 100, shape: 'rect', subject: 'a monk', personName: 'พระสงฆ์' },
    ],
    prominence: [],
    shotArchetype: 'wide_environmental',
    layerIntent: [],
    ringBorderFeatherSeam: null,
    negativeSpace: null,
    hierarchyTargets: ['hero'],
    location: 'hospital',
    eventName: 'hospital visit',
    ocrText: 'วัดพระธาตุ',
    caption: 'พระเดินในโรงพยาบาล',
    relationshipTo: 'family',
  };
  const artistStory = story({
    identities: ['Somsak Artist'],
    editorialHero: 'Somsak Artist',
    eventContext: 'National Art Award ceremony',
    storySemantics: 'an artist winning an award',
  });

  const result = buildStoryReferenceAuthorityContract({ story: artistStory, reference: poisonedReference });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(result.contract, undefined);

  const serialized = JSON.stringify(result);
  const attackerStrings = [
    'monk', 'hospital', 'พระ', 'วัด',
    'subject', 'personName', 'location', 'eventName', 'ocrText', 'caption', 'relationshipTo',
  ];
  for (const needle of attackerStrings) {
    assert.equal(serialized.toLowerCase().includes(needle.toLowerCase()), false, `serialized result must not contain "${needle}"`);
  }

  const reasons = result.details.rejections.map((r) => r.reason);
  assert.ok(reasons.includes(REJECTION_REASONS.REFERENCE_IDENTITY_LEAK), `expected identity leak, got: ${JSON.stringify(result.details.rejections)}`);
  assert.ok(reasons.includes(REJECTION_REASONS.REFERENCE_OCR_LEAK));
  assert.ok(reasons.includes(REJECTION_REASONS.REFERENCE_EVENT_CONTEXT_LEAK));
  assert.ok(result.details.rejections.every((r) => r.source === 'reference'));
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.<surplus>'));
  assert.ok(result.details.rejections.some((r) => r.field === 'reference.slotGeometry[0].<surplus>'));
  assert.ok(result.details.rejections.every((r) => !r.field.includes('subject') && !r.field.includes('personName') && !r.field.includes('location')));
});

// =========================================================================
// GROUP 17 — pure, deterministic, byte-identical contract/hash.
// =========================================================================
test('pure deterministic: repeated builds from equal-but-distinct input objects are byte-identical', () => {
  const mkInput = () => ({ story: story(), reference: reference(), manualRefLock: true });
  const r1 = buildStoryReferenceAuthorityContract(mkInput());
  assert.equal(r1.ok, true);
  for (let i = 0; i < 5; i++) {
    const r = buildStoryReferenceAuthorityContract(mkInput());
    assert.equal(r.ok, true);
    assert.equal(JSON.stringify(r.contract), JSON.stringify(r1.contract));
    assert.equal(r.contract.hash, r1.contract.hash);
  }
});

// =========================================================================
// GROUP 18 — malformed shapes fail closed without throwing.
// =========================================================================
test('malformed shapes fail closed without throwing (builder and validator)', () => {
  assert.doesNotThrow(() => validateContract(null, DUMMY_HASH));
  assert.doesNotThrow(() => validateContract('nope', DUMMY_HASH));
  assert.doesNotThrow(() => validateContract(42, DUMMY_HASH));
  assert.doesNotThrow(() => validateContract([], DUMMY_HASH));
  assert.equal(validateContract(null, DUMMY_HASH).ok, false);
  assert.equal(validateContract('nope', DUMMY_HASH).ok, false);
  assert.equal(validateContract({}, DUMMY_HASH).ok, false);

  class Weird { constructor() { this.v = 1; } }
  assert.equal(validateContract(new Weird(), DUMMY_HASH).ok, false);

  assert.doesNotThrow(() => buildStoryReferenceAuthorityContract(null));
  assert.doesNotThrow(() => buildStoryReferenceAuthorityContract('nope'));
  assert.equal(buildStoryReferenceAuthorityContract(null).ok, false);
  assert.equal(buildStoryReferenceAuthorityContract(null).reason, 'INPUT_NOT_OBJECT');
  assert.equal(buildStoryReferenceAuthorityContract({ story: 'nope' }).ok, false);
  assert.equal(buildStoryReferenceAuthorityContract({ story: story(), extra: 1 }).ok, false);
  assert.equal(buildStoryReferenceAuthorityContract({ story: story(), manualRefLock: 'true' }).ok, false);
  assert.equal(buildStoryReferenceAuthorityContract({ story: { identities: 'not-an-array' } }).ok, false);
});
