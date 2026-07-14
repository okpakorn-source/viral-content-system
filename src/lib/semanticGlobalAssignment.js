// Semantic global assignment — foundation pass.
// Pure by design: no filesystem/network/env/time/random reads, no input mutation.
// The only import is a deterministic digest utility (crypto.createHash), never used
// for entropy generation.
//
// This pass ships reusable, private plumbing for the upcoming solver:
//   - descriptor-first strict validation of plain objects/arrays (no accessor
//     invocation, no symbol/non-enumerable/exotic/cycle admission);
//   - exact schema validation + canonical normalization for slots, candidates,
//     requiredCast, heroAuthority and limits;
//   - explicit code-unit comparators (never delimiter-joined, never localeCompare);
//   - a canonical JSON stringifier + SHA-256 helper for future assignmentHash use;
//   - deepFreeze and a stable typed HOLD-output helper.
//
// Only validateSemanticGlobalAssignmentInput and buildSemanticGlobalAssignment
// are exported. Everything else is private.
//
// Test-pass-C corrective fix: enterStrictObject/enterStrictArray reject a Proxy
// FIRST, before any other reflection (getPrototypeOf/ownKeys/getOwnPropertyDescriptor
// all invoke a Proxy's trap handlers, i.e. arbitrary caller code, with no guarantee two
// calls agree) — proven necessary by a test showing a transparent Proxy wrapping the
// root input was previously accepted outright (ok:true) after 13 trap invocations.
// node:util's types.isProxy is itself trap-proof: it inspects the value's internal
// [[ProxyHandler]] slot directly, which a Proxy cannot intercept or spoof.

import { createHash } from 'crypto';
import { types as nodeUtilTypes } from 'node:util';

const MAX_SLOTS = 64;
const MAX_CANDIDATES = 4096;
const MAX_REQUIRED_CAST = 64;
const MAX_APPROVED_CANDIDATES = 256;
const MAX_ELIGIBLE_SLOTS_PER_CANDIDATE = MAX_SLOTS;
const MAX_STRING_LENGTH = 256;
const MAX_SCORE = 1000000;
const MAX_PRIORITY = 1000000;
const MAX_ORDER = 1000000;
const MAX_LIMIT_VALUE = 1000000;

// Solver-level bounds: stricter than the structural validator's MAX_SLOTS/
// MAX_CANDIDATES, sized so the bounded DFS below stays tractable. Inputs
// within these solver bounds but still large enough to exhaust
// MAX_SEARCH_STATES fail closed via SEARCH_LIMIT_EXCEEDED rather than
// returning a possibly non-optimal assignment.
const SOLVER_MAX_SLOTS = 8;
const SOLVER_MAX_CANDIDATES = 64;
const MAX_SEARCH_STATES = 250000;
const SOLVER_VERSION = 'semantic-global-assignment/1';
const ASSIGNED_REASON = 'ASSIGNED';

// Review-D corrective fix (no attacker echo): every hold's `path`/`message` must be built
// only from fixed literals and canonical numeric indexes (a position in an already-sorted
// array), never from a caller-supplied slotId/personId/candidateId/sourceAssetId string or
// a caught exception's own .message — any of those could embed arbitrary caller-controlled
// content into output the caller then reads back. This single constant stands in for every
// case that previously carried dynamic detail (a raw error message, a live search-state
// count): the reason enum already identifies what happened; no further detail is owed.
const REDACTED_INTERNAL_MESSAGE = 'internal detail withheld';

const HOLD_REASON = Object.freeze({
  INVALID_ROOT_SHAPE: 'INVALID_ROOT_SHAPE',
  MISSING_FIELD: 'MISSING_FIELD',
  SURPLUS_FIELD: 'SURPLUS_FIELD',
  ACCESSOR_PROPERTY: 'ACCESSOR_PROPERTY',
  NON_ENUMERABLE_PROPERTY: 'NON_ENUMERABLE_PROPERTY',
  SYMBOL_KEY_PRESENT: 'SYMBOL_KEY_PRESENT',
  EXOTIC_OBJECT: 'EXOTIC_OBJECT',
  EXOTIC_ARRAY: 'EXOTIC_ARRAY',
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  INVALID_TYPE: 'INVALID_TYPE',
  NON_INTEGER: 'NON_INTEGER',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  EMPTY_COLLECTION: 'EMPTY_COLLECTION',
  LIMIT_OVERFLOW: 'LIMIT_OVERFLOW',
  DUPLICATE_ID: 'DUPLICATE_ID',
  UNKNOWN_REFERENCE: 'UNKNOWN_REFERENCE',
  CONFLICT: 'CONFLICT',
  INTERNAL_VALIDATION_ERROR: 'INTERNAL_VALIDATION_ERROR',
  SLOT_UNFILLABLE: 'SLOT_UNFILLABLE',
  REQUIRED_CAST_INFEASIBLE: 'REQUIRED_CAST_INFEASIBLE',
  SEARCH_SCOPE_TOO_LARGE: 'SEARCH_SCOPE_TOO_LARGE',
  SEARCH_LIMIT_EXCEEDED: 'SEARCH_LIMIT_EXCEEDED',
  ASSIGNMENT_INFEASIBLE: 'ASSIGNMENT_INFEASIBLE',
});

const SLOT_KEYS = Object.freeze(['slotId', 'order', 'role', 'shape', 'personId']);
const CANDIDATE_KEYS = Object.freeze([
  'candidateId',
  'sourceAssetId',
  'personId',
  'eligibleSlotIds',
  'semanticScore',
  'qualityScore',
  'slotFitScore',
  'sceneKey',
]);
// requiredCast.priority is validated (bounded integer) and folded into canonicalInput like
// every other field, but it is non-authoritative, inert metadata in this solver: this is an
// all-required solver, not a partial/best-effort one — every entry with required:true must
// be covered by the final assignment or the whole call HOLDs (ASSIGNMENT_INFEASIBLE /
// REQUIRED_CAST_INFEASIBLE), with no priority-ordered tiering, no "cover the higher-priority
// ones first and let a lower one slide," and no effect on which feasible assignment is
// chosen among those that do cover everyone. Do not read `.priority` anywhere in
// runBoundedSearch/exploreFrom — that would invent partial-priority semantics this contract
// does not define. Review-E correction: priority is emphatically NOT bound into
// assignmentHash — assignmentHash (see finalizeOutput) hashes only the OUTPUT decision state
// (decision/reason/path/message/assignments/diagnostics/version), never canonicalInput or any
// raw input field, so priority cannot appear in it directly OR indirectly.
const REQUIRED_CAST_KEYS = Object.freeze(['personId', 'required', 'priority']);
const HERO_AUTHORITY_KEYS = Object.freeze(['heroSlotId', 'heroPersonId', 'approvedCandidateIds']);
const LIMITS_KEYS = Object.freeze(['maxPersonRepeats', 'maxSceneRepeats']);
const ROOT_KEYS = Object.freeze(['slots', 'candidates', 'requiredCast', 'heroAuthority', 'limits']);

// ---- code-unit comparators (explicit, field-by-field; never delimiter-joined) ----

function compareCodeUnitStrings(a, b) {
  const len = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < len; i += 1) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

function compareIntegers(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareTuples(a, b, comparators) {
  for (let i = 0; i < comparators.length; i += 1) {
    const result = comparators[i](a[i], b[i]);
    if (result !== 0) return result;
  }
  return 0;
}

function compareNullableCodeUnitStrings(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareCodeUnitStrings(a, b);
}

// ---- deep freeze (never mutates caller-supplied input; only applied to
// freshly constructed canonical copies) ----

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) deepFreeze(value[i]);
  } else {
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i += 1) deepFreeze(value[keys[i]]);
  }
  return Object.freeze(value);
}

// ---- canonical JSON + SHA-256 (deterministic; keys sorted by code unit) ----

function canonicalStringify(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error('canonicalStringify: non-integer number');
    }
    return String(value);
  }
  if (type === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (type === 'object') {
    const keys = Object.keys(value).sort(compareCodeUnitStrings);
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  throw new Error('canonicalStringify: unsupported value');
}

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---- stable typed HOLD / success output helpers ----

function holdResult(reason, path, message) {
  return deepFreeze({
    ok: false,
    decision: 'hold',
    reason,
    path: path === undefined ? null : path,
    message: message === undefined ? null : message,
    assignments: [],
  });
}

function validationSuccess(canonicalInput) {
  return Object.freeze({ ok: true, canonicalInput });
}

// ---- descriptor-first strict shape gates (never invoke accessors) ----

function readDataValue(container, key) {
  return Object.getOwnPropertyDescriptor(container, key).value;
}

function collectStrictDataKeys(value) {
  const names = Object.getOwnPropertyNames(value);
  const keys = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor.enumerable) {
      return { ok: false, reason: HOLD_REASON.NON_ENUMERABLE_PROPERTY };
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return { ok: false, reason: HOLD_REASON.ACCESSOR_PROPERTY };
    }
    keys.push(name);
  }
  return { ok: true, keys };
}

function enterStrictObject(value, seen) {
  // Review-E corrective fix: isProxy must run before Array.isArray/any other reflection, not
  // after. A REVOKED Proxy still reports typeof 'object' and is not null, so the old ordering
  // reached `Array.isArray(value)` first — which THROWS ("Cannot perform 'IsArray' on a proxy
  // that has been revoked") for a revoked proxy, escaping to the outer catch as
  // INTERNAL_VALIDATION_ERROR instead of a stable EXOTIC_OBJECT. types.isProxy itself is safe
  // to call on absolutely any value (null, primitives, live or revoked proxies) without
  // throwing or invoking a handler, so it is the first thing checked, unconditionally.
  if (nodeUtilTypes.isProxy(value)) {
    return { ok: false, reason: HOLD_REASON.EXOTIC_OBJECT };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: HOLD_REASON.INVALID_TYPE };
  }
  if (seen.has(value)) {
    return { ok: false, reason: HOLD_REASON.CYCLE_DETECTED };
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return { ok: false, reason: HOLD_REASON.EXOTIC_OBJECT };
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return { ok: false, reason: HOLD_REASON.SYMBOL_KEY_PRESENT };
  }
  const keysResult = collectStrictDataKeys(value);
  if (!keysResult.ok) return keysResult;
  return { ok: true, keys: keysResult.keys };
}

function enterStrictArray(value, seen) {
  // Review-E corrective fix: same reordering as enterStrictObject above — a revoked Proxy
  // makes `Array.isArray(value)` itself throw, so isProxy must run first, unconditionally.
  if (nodeUtilTypes.isProxy(value)) {
    return { ok: false, reason: HOLD_REASON.EXOTIC_ARRAY };
  }
  if (!Array.isArray(value)) {
    return { ok: false, reason: HOLD_REASON.INVALID_TYPE };
  }
  if (seen.has(value)) {
    return { ok: false, reason: HOLD_REASON.CYCLE_DETECTED };
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return { ok: false, reason: HOLD_REASON.EXOTIC_ARRAY };
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return { ok: false, reason: HOLD_REASON.SYMBOL_KEY_PRESENT };
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1) {
    return { ok: false, reason: HOLD_REASON.EXOTIC_ARRAY };
  }
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return { ok: false, reason: HOLD_REASON.EXOTIC_ARRAY };
    }
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || lengthDescriptor.enumerable) {
    return { ok: false, reason: HOLD_REASON.EXOTIC_ARRAY };
  }
  return { ok: true };
}

function matchExactKeySet(keys, expectedKeys) {
  if (keys.length !== expectedKeys.length) {
    return keys.length < expectedKeys.length ? HOLD_REASON.MISSING_FIELD : HOLD_REASON.SURPLUS_FIELD;
  }
  const expectedSet = new Set(expectedKeys);
  const seenKeys = new Set();
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!expectedSet.has(key)) return HOLD_REASON.SURPLUS_FIELD;
    if (seenKeys.has(key)) return HOLD_REASON.SURPLUS_FIELD;
    seenKeys.add(key);
  }
  if (seenKeys.size !== expectedSet.size) return HOLD_REASON.MISSING_FIELD;
  return null;
}

function isNonEmptyBoundedString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING_LENGTH;
}

function isBoundedInteger(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

// ---- per-record validation + canonical normalization ----

function validateSlots(rawSlots, seen) {
  const arrayGate = enterStrictArray(rawSlots, seen);
  if (!arrayGate.ok) return { ok: false, reason: arrayGate.reason, path: 'slots' };
  if (rawSlots.length < 1 || rawSlots.length > MAX_SLOTS) {
    return {
      ok: false,
      reason: rawSlots.length < 1 ? HOLD_REASON.EMPTY_COLLECTION : HOLD_REASON.LIMIT_OVERFLOW,
      path: 'slots',
    };
  }
  seen.add(rawSlots);

  const slotIds = new Set();
  const orders = new Set();
  const canonical = [];

  for (let i = 0; i < rawSlots.length; i += 1) {
    const path = `slots[${i}]`;
    const raw = readDataValue(rawSlots, String(i));
    const objectGate = enterStrictObject(raw, seen);
    if (!objectGate.ok) return { ok: false, reason: objectGate.reason, path };
    const keyReason = matchExactKeySet(objectGate.keys, SLOT_KEYS);
    if (keyReason) return { ok: false, reason: keyReason, path };
    seen.add(raw);

    const slotId = readDataValue(raw, 'slotId');
    const order = readDataValue(raw, 'order');
    const role = readDataValue(raw, 'role');
    const shape = readDataValue(raw, 'shape');
    const personId = readDataValue(raw, 'personId');

    if (!isNonEmptyBoundedString(slotId)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.slotId` };
    }
    if (!isBoundedInteger(order, 0, MAX_ORDER)) {
      return {
        ok: false,
        reason: Number.isInteger(order) ? HOLD_REASON.OUT_OF_RANGE : HOLD_REASON.NON_INTEGER,
        path: `${path}.order`,
      };
    }
    if (!isNonEmptyBoundedString(role)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.role` };
    }
    if (!isNonEmptyBoundedString(shape)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.shape` };
    }
    if (personId !== null && !isNonEmptyBoundedString(personId)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.personId` };
    }
    if (slotIds.has(slotId)) {
      return { ok: false, reason: HOLD_REASON.DUPLICATE_ID, path: `${path}.slotId` };
    }
    if (orders.has(order)) {
      return { ok: false, reason: HOLD_REASON.CONFLICT, path: `${path}.order` };
    }
    slotIds.add(slotId);
    orders.add(order);

    canonical.push({ slotId, order, role, shape, personId });
  }

  canonical.sort((a, b) => compareIntegers(a.order, b.order));
  return { ok: true, value: canonical, slotIds };
}

function validateCandidates(rawCandidates, slotIds, seen) {
  const arrayGate = enterStrictArray(rawCandidates, seen);
  if (!arrayGate.ok) return { ok: false, reason: arrayGate.reason, path: 'candidates' };
  if (rawCandidates.length < 1 || rawCandidates.length > MAX_CANDIDATES) {
    return {
      ok: false,
      reason: rawCandidates.length < 1 ? HOLD_REASON.EMPTY_COLLECTION : HOLD_REASON.LIMIT_OVERFLOW,
      path: 'candidates',
    };
  }
  seen.add(rawCandidates);

  const candidateIds = new Set();
  const canonical = [];
  const infoById = new Map();

  for (let i = 0; i < rawCandidates.length; i += 1) {
    const path = `candidates[${i}]`;
    const raw = readDataValue(rawCandidates, String(i));
    const objectGate = enterStrictObject(raw, seen);
    if (!objectGate.ok) return { ok: false, reason: objectGate.reason, path };
    const keyReason = matchExactKeySet(objectGate.keys, CANDIDATE_KEYS);
    if (keyReason) return { ok: false, reason: keyReason, path };
    seen.add(raw);

    const candidateId = readDataValue(raw, 'candidateId');
    const sourceAssetId = readDataValue(raw, 'sourceAssetId');
    const personId = readDataValue(raw, 'personId');
    const rawEligible = readDataValue(raw, 'eligibleSlotIds');
    const semanticScore = readDataValue(raw, 'semanticScore');
    const qualityScore = readDataValue(raw, 'qualityScore');
    const slotFitScore = readDataValue(raw, 'slotFitScore');
    const sceneKey = readDataValue(raw, 'sceneKey');

    if (!isNonEmptyBoundedString(candidateId)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.candidateId` };
    }
    if (!isNonEmptyBoundedString(sourceAssetId)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.sourceAssetId` };
    }
    if (personId !== null && !isNonEmptyBoundedString(personId)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.personId` };
    }
    if (!isNonEmptyBoundedString(sceneKey)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.sceneKey` };
    }

    const scoreFields = [
      ['semanticScore', semanticScore],
      ['qualityScore', qualityScore],
      ['slotFitScore', slotFitScore],
    ];
    for (let s = 0; s < scoreFields.length; s += 1) {
      const fieldName = scoreFields[s][0];
      const fieldValue = scoreFields[s][1];
      if (!isBoundedInteger(fieldValue, 0, MAX_SCORE)) {
        return {
          ok: false,
          reason: Number.isInteger(fieldValue) ? HOLD_REASON.OUT_OF_RANGE : HOLD_REASON.NON_INTEGER,
          path: `${path}.${fieldName}`,
        };
      }
    }

    const eligibleGate = enterStrictArray(rawEligible, seen);
    if (!eligibleGate.ok) {
      return { ok: false, reason: eligibleGate.reason, path: `${path}.eligibleSlotIds` };
    }
    if (rawEligible.length > MAX_ELIGIBLE_SLOTS_PER_CANDIDATE) {
      return { ok: false, reason: HOLD_REASON.LIMIT_OVERFLOW, path: `${path}.eligibleSlotIds` };
    }
    seen.add(rawEligible);

    const eligibleSeen = new Set();
    const eligibleSlotIds = [];
    for (let j = 0; j < rawEligible.length; j += 1) {
      const elementPath = `${path}.eligibleSlotIds[${j}]`;
      const slotRef = readDataValue(rawEligible, String(j));
      if (!isNonEmptyBoundedString(slotRef)) {
        return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: elementPath };
      }
      if (!slotIds.has(slotRef)) {
        return { ok: false, reason: HOLD_REASON.UNKNOWN_REFERENCE, path: elementPath };
      }
      if (eligibleSeen.has(slotRef)) {
        return { ok: false, reason: HOLD_REASON.DUPLICATE_ID, path: elementPath };
      }
      eligibleSeen.add(slotRef);
      eligibleSlotIds.push(slotRef);
    }
    eligibleSlotIds.sort(compareCodeUnitStrings);

    if (candidateIds.has(candidateId)) {
      return { ok: false, reason: HOLD_REASON.DUPLICATE_ID, path: `${path}.candidateId` };
    }
    candidateIds.add(candidateId);

    canonical.push({
      candidateId,
      sourceAssetId,
      personId,
      eligibleSlotIds,
      semanticScore,
      qualityScore,
      slotFitScore,
      sceneKey,
    });
    infoById.set(candidateId, { personId, eligibleSlotIdSet: eligibleSeen });
  }

  canonical.sort((a, b) => compareCodeUnitStrings(a.candidateId, b.candidateId));
  return { ok: true, value: canonical, candidateIds, infoById };
}

function validateRequiredCast(rawRequiredCast, seen) {
  const arrayGate = enterStrictArray(rawRequiredCast, seen);
  if (!arrayGate.ok) return { ok: false, reason: arrayGate.reason, path: 'requiredCast' };
  if (rawRequiredCast.length > MAX_REQUIRED_CAST) {
    return { ok: false, reason: HOLD_REASON.LIMIT_OVERFLOW, path: 'requiredCast' };
  }
  seen.add(rawRequiredCast);

  const personIds = new Set();
  const canonical = [];

  for (let i = 0; i < rawRequiredCast.length; i += 1) {
    const path = `requiredCast[${i}]`;
    const raw = readDataValue(rawRequiredCast, String(i));
    const objectGate = enterStrictObject(raw, seen);
    if (!objectGate.ok) return { ok: false, reason: objectGate.reason, path };
    const keyReason = matchExactKeySet(objectGate.keys, REQUIRED_CAST_KEYS);
    if (keyReason) return { ok: false, reason: keyReason, path };
    seen.add(raw);

    const personId = readDataValue(raw, 'personId');
    const required = readDataValue(raw, 'required');
    const priority = readDataValue(raw, 'priority');

    if (!isNonEmptyBoundedString(personId)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.personId` };
    }
    if (typeof required !== 'boolean') {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: `${path}.required` };
    }
    if (!isBoundedInteger(priority, 0, MAX_PRIORITY)) {
      return {
        ok: false,
        reason: Number.isInteger(priority) ? HOLD_REASON.OUT_OF_RANGE : HOLD_REASON.NON_INTEGER,
        path: `${path}.priority`,
      };
    }
    if (personIds.has(personId)) {
      return { ok: false, reason: HOLD_REASON.CONFLICT, path: `${path}.personId` };
    }
    personIds.add(personId);

    canonical.push({ personId, required, priority });
  }

  canonical.sort((a, b) => compareCodeUnitStrings(a.personId, b.personId));
  return { ok: true, value: canonical };
}

// Review-D corrective fix (P1 — hero fixed-person bypass): a hero slot is still a slot, and
// a slot's own `personId` demand (if any) is a hard requirement independent of hero
// authority. Previously this function only cross-checked the APPROVED CANDIDATE's personId
// against heroPersonId (and the candidate's eligibility for heroSlotId) — it never checked
// heroPersonId against slots[heroSlotId].personId itself, so a slot demanding one person
// (e.g. 'nene') could be hero-bound to a completely different, approved-and-eligible
// candidate for a different person (e.g. 'lisa'), silently overriding the slot's own
// requirement. `slotPersonById` is built by the caller directly from the same canonical
// slot records validateSlots already produced (the same captured data the solver's hero
// prebind step later reads via canonicalInput.slots), so both validation and solving agree
// on one source of truth for what each slot actually demands.
function validateHeroAuthority(rawHero, slotIds, slotPersonById, candidateIds, candidateInfoById, seen) {
  const objectGate = enterStrictObject(rawHero, seen);
  if (!objectGate.ok) return { ok: false, reason: objectGate.reason, path: 'heroAuthority' };
  const keyReason = matchExactKeySet(objectGate.keys, HERO_AUTHORITY_KEYS);
  if (keyReason) return { ok: false, reason: keyReason, path: 'heroAuthority' };
  seen.add(rawHero);

  const heroSlotId = readDataValue(rawHero, 'heroSlotId');
  const heroPersonId = readDataValue(rawHero, 'heroPersonId');
  const rawApproved = readDataValue(rawHero, 'approvedCandidateIds');

  if (heroSlotId !== null && !isNonEmptyBoundedString(heroSlotId)) {
    return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: 'heroAuthority.heroSlotId' };
  }
  if (heroPersonId !== null && !isNonEmptyBoundedString(heroPersonId)) {
    return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path: 'heroAuthority.heroPersonId' };
  }
  if ((heroSlotId === null) !== (heroPersonId === null)) {
    return { ok: false, reason: HOLD_REASON.CONFLICT, path: 'heroAuthority' };
  }

  const arrayGate = enterStrictArray(rawApproved, seen);
  if (!arrayGate.ok) {
    return { ok: false, reason: arrayGate.reason, path: 'heroAuthority.approvedCandidateIds' };
  }
  if (rawApproved.length > MAX_APPROVED_CANDIDATES) {
    return { ok: false, reason: HOLD_REASON.LIMIT_OVERFLOW, path: 'heroAuthority.approvedCandidateIds' };
  }
  seen.add(rawApproved);

  const active = heroSlotId !== null;

  if (!active && rawApproved.length !== 0) {
    return { ok: false, reason: HOLD_REASON.CONFLICT, path: 'heroAuthority.approvedCandidateIds' };
  }
  if (active && rawApproved.length < 1) {
    return { ok: false, reason: HOLD_REASON.CONFLICT, path: 'heroAuthority.approvedCandidateIds' };
  }
  if (active && !slotIds.has(heroSlotId)) {
    return { ok: false, reason: HOLD_REASON.UNKNOWN_REFERENCE, path: 'heroAuthority.heroSlotId' };
  }
  if (active) {
    const requiredSlotPersonId = slotPersonById.get(heroSlotId);
    if (requiredSlotPersonId !== null && requiredSlotPersonId !== heroPersonId) {
      return { ok: false, reason: HOLD_REASON.CONFLICT, path: 'heroAuthority.heroPersonId' };
    }
  }

  const approvedSeen = new Set();
  const approved = [];
  for (let i = 0; i < rawApproved.length; i += 1) {
    const path = `heroAuthority.approvedCandidateIds[${i}]`;
    const candidateId = readDataValue(rawApproved, String(i));
    if (!isNonEmptyBoundedString(candidateId)) {
      return { ok: false, reason: HOLD_REASON.INVALID_TYPE, path };
    }
    if (!candidateIds.has(candidateId)) {
      return { ok: false, reason: HOLD_REASON.UNKNOWN_REFERENCE, path };
    }
    if (approvedSeen.has(candidateId)) {
      return { ok: false, reason: HOLD_REASON.DUPLICATE_ID, path };
    }
    approvedSeen.add(candidateId);

    const info = candidateInfoById.get(candidateId);
    if (info.personId !== heroPersonId) {
      return { ok: false, reason: HOLD_REASON.CONFLICT, path };
    }
    if (!info.eligibleSlotIdSet.has(heroSlotId)) {
      return { ok: false, reason: HOLD_REASON.CONFLICT, path };
    }

    approved.push(candidateId);
  }
  approved.sort(compareCodeUnitStrings);

  return { ok: true, value: { heroSlotId, heroPersonId, approvedCandidateIds: approved } };
}

function validateLimits(rawLimits, seen) {
  const objectGate = enterStrictObject(rawLimits, seen);
  if (!objectGate.ok) return { ok: false, reason: objectGate.reason, path: 'limits' };
  const keyReason = matchExactKeySet(objectGate.keys, LIMITS_KEYS);
  if (keyReason) return { ok: false, reason: keyReason, path: 'limits' };
  seen.add(rawLimits);

  const maxPersonRepeats = readDataValue(rawLimits, 'maxPersonRepeats');
  const maxSceneRepeats = readDataValue(rawLimits, 'maxSceneRepeats');

  if (!isBoundedInteger(maxPersonRepeats, 1, MAX_LIMIT_VALUE)) {
    return {
      ok: false,
      reason: Number.isInteger(maxPersonRepeats) ? HOLD_REASON.OUT_OF_RANGE : HOLD_REASON.NON_INTEGER,
      path: 'limits.maxPersonRepeats',
    };
  }
  if (!isBoundedInteger(maxSceneRepeats, 1, MAX_LIMIT_VALUE)) {
    return {
      ok: false,
      reason: Number.isInteger(maxSceneRepeats) ? HOLD_REASON.OUT_OF_RANGE : HOLD_REASON.NON_INTEGER,
      path: 'limits.maxSceneRepeats',
    };
  }

  return { ok: true, value: { maxPersonRepeats, maxSceneRepeats } };
}

/**
 * Validate and canonicalize raw input for the semantic global assignment solver.
 *
 * Performs descriptor-first structural validation (rejecting missing/surplus
 * fields, symbol keys, non-enumerable properties, accessors, exotic objects,
 * arrays, and cycles) followed by exact-schema field validation and
 * cross-reference checks (duplicate ids, unknown slot/candidate references,
 * hero-authority conflicts). Never mutates `input` and never throws.
 *
 * @param {*} input candidate root payload; expected shape:
 *   { slots, candidates, requiredCast, heroAuthority, limits }
 * @returns {{ ok: true, canonicalInput: object } |
 *   { ok: false, decision: 'hold', reason: string, path: string|null,
 *     message: string|null, assignments: [] }}
 *   On success, `canonicalInput` is a deep-frozen, deterministically ordered
 *   normalization of the input (slots sorted by order, candidates/requiredCast/
 *   approvedCandidateIds sorted by code-unit id order). On failure, a stable
 *   fixed-code HOLD diagnostic with `assignments: []`.
 */
export function validateSemanticGlobalAssignmentInput(input) {
  try {
    const seen = new WeakSet();

    const rootGate = enterStrictObject(input, seen);
    if (!rootGate.ok) return holdResult(rootGate.reason, 'input');
    const rootKeyReason = matchExactKeySet(rootGate.keys, ROOT_KEYS);
    if (rootKeyReason) return holdResult(rootKeyReason, 'input');
    seen.add(input);

    const rawSlots = readDataValue(input, 'slots');
    const rawCandidates = readDataValue(input, 'candidates');
    const rawRequiredCast = readDataValue(input, 'requiredCast');
    const rawHeroAuthority = readDataValue(input, 'heroAuthority');
    const rawLimits = readDataValue(input, 'limits');

    const slotsResult = validateSlots(rawSlots, seen);
    if (!slotsResult.ok) return holdResult(slotsResult.reason, slotsResult.path);

    const candidatesResult = validateCandidates(rawCandidates, slotsResult.slotIds, seen);
    if (!candidatesResult.ok) return holdResult(candidatesResult.reason, candidatesResult.path);

    const requiredCastResult = validateRequiredCast(rawRequiredCast, seen);
    if (!requiredCastResult.ok) return holdResult(requiredCastResult.reason, requiredCastResult.path);

    const slotPersonById = new Map(slotsResult.value.map((s) => [s.slotId, s.personId]));
    const heroAuthorityResult = validateHeroAuthority(
      rawHeroAuthority,
      slotsResult.slotIds,
      slotPersonById,
      candidatesResult.candidateIds,
      candidatesResult.infoById,
      seen,
    );
    if (!heroAuthorityResult.ok) return holdResult(heroAuthorityResult.reason, heroAuthorityResult.path);

    const limitsResult = validateLimits(rawLimits, seen);
    if (!limitsResult.ok) return holdResult(limitsResult.reason, limitsResult.path);

    const canonicalInput = deepFreeze({
      slots: slotsResult.value,
      candidates: candidatesResult.value,
      requiredCast: requiredCastResult.value,
      heroAuthority: heroAuthorityResult.value,
      limits: limitsResult.value,
    });

    return validationSuccess(canonicalInput);
  } catch {
    // The caught exception's own .message is never surfaced — it could echo caller-controlled
    // content depending on what threw (Review-D P2: no attacker echo). The reason enum is the
    // entire contract; there is no further detail owed to the caller.
    return holdResult(HOLD_REASON.INTERNAL_VALIDATION_ERROR, null, REDACTED_INTERNAL_MESSAGE);
  }
}

// ---- solver: bounded deterministic search over the canonical input ----

function collectEligibleCandidatesPerSlot(canonicalInput) {
  const bySlot = new Map();
  for (let i = 0; i < canonicalInput.slots.length; i += 1) {
    const slot = canonicalInput.slots[i];
    const eligible = canonicalInput.candidates.filter((candidate) => {
      if (!candidate.eligibleSlotIds.includes(slot.slotId)) return false;
      if (slot.personId !== null && candidate.personId !== slot.personId) return false;
      return true;
    });
    bySlot.set(slot.slotId, eligible);
  }
  return bySlot;
}

function compareCompleteAssignments(a, b) {
  let cmp = compareIntegers(a.personRepeats, b.personRepeats);
  if (cmp !== 0) return cmp;
  cmp = compareIntegers(a.sceneRepeats, b.sceneRepeats);
  if (cmp !== 0) return cmp;
  cmp = compareIntegers(b.semanticSum, a.semanticSum);
  if (cmp !== 0) return cmp;
  cmp = compareIntegers(b.qualitySum, a.qualitySum);
  if (cmp !== 0) return cmp;
  cmp = compareIntegers(b.slotFitSum, a.slotFitSum);
  if (cmp !== 0) return cmp;

  const fieldsA = [];
  const fieldsB = [];
  for (let i = 0; i < a.assignments.length; i += 1) {
    fieldsA.push(
      a.assignments[i].slotId,
      a.assignments[i].candidateId,
      a.assignments[i].sourceAssetId,
      a.assignments[i].personId,
    );
    fieldsB.push(
      b.assignments[i].slotId,
      b.assignments[i].candidateId,
      b.assignments[i].sourceAssetId,
      b.assignments[i].personId,
    );
  }
  const comparators = fieldsA.map(() => compareNullableCodeUnitStrings);
  return compareTuples(fieldsA, fieldsB, comparators);
}

// Enumerates every feasible complete assignment within the MAX_SEARCH_STATES
// budget (hero bound first when active, then a candidateId/sourceAssetId-
// reuse-free DFS over the remaining canonical slots), tracking the single
// best result under compareCompleteAssignments. Never mutates canonicalInput;
// all bookkeeping (chosen/used*/counts) is local per-call recursion state.
function runBoundedSearch(canonicalInput, hero, requiredPersons) {
  const requiredPersonSet = new Set(requiredPersons);
  const bySlot = collectEligibleCandidatesPerSlot(canonicalInput);

  for (let i = 0; i < canonicalInput.slots.length; i += 1) {
    const slot = canonicalInput.slots[i];
    if (hero.active && slot.slotId === hero.heroSlotId) continue;
    if (bySlot.get(slot.slotId).length === 0) {
      // path uses the canonical array index i, never the caller-supplied slot.slotId string
      // (Review-D P2: no attacker echo).
      return { holdReason: HOLD_REASON.SLOT_UNFILLABLE, path: `slots[${i}]`, message: null };
    }
  }

  for (let i = 0; i < requiredPersons.length; i += 1) {
    const personId = requiredPersons[i];
    let feasible = false;
    for (let j = 0; j < canonicalInput.candidates.length && !feasible; j += 1) {
      const candidate = canonicalInput.candidates[j];
      if (candidate.personId !== personId) continue;
      for (let k = 0; k < canonicalInput.slots.length; k += 1) {
        const slot = canonicalInput.slots[k];
        if (slot.personId !== null && slot.personId !== personId) continue;
        if (candidate.eligibleSlotIds.includes(slot.slotId)) {
          feasible = true;
          break;
        }
      }
    }
    if (!feasible) {
      // Review-E corrective fix: `i` indexes requiredPersons — the required:true-only,
      // re-sorted-by-personId subset — NOT canonicalInput.requiredCast, which is sorted by
      // personId across every entry, required or not. Using `i` directly could misaddress an
      // earlier, unrelated (and possibly optional) canonical entry whenever an optional
      // entry's personId sorts before the infeasible required one. Look up this personId's
      // TRUE position in the canonical array instead (duplicate personIds are already
      // rejected at validation, so this is unambiguous) — still a canonical numeric index,
      // never the caller-supplied personId string itself (Review-D P2: no attacker echo).
      const canonicalIndex = canonicalInput.requiredCast.findIndex((entry) => entry.personId === personId);
      return { holdReason: HOLD_REASON.REQUIRED_CAST_INFEASIBLE, path: `requiredCast[${canonicalIndex}]`, message: null };
    }
  }

  const candidateById = new Map();
  for (let i = 0; i < canonicalInput.candidates.length; i += 1) {
    candidateById.set(canonicalInput.candidates[i].candidateId, canonicalInput.candidates[i]);
  }

  const decidingSlots = canonicalInput.slots.filter(
    (slot) => !(hero.active && slot.slotId === hero.heroSlotId),
  );

  const searchState = { visited: 0, limitExceeded: false };
  let best = null;

  function considerComplete(chosen, personCounts, sceneCounts) {
    const assignments = canonicalInput.slots.map((slot) => {
      const candidate = chosen.get(slot.slotId);
      return {
        slotId: slot.slotId,
        candidateId: candidate.candidateId,
        sourceAssetId: candidate.sourceAssetId,
        personId: candidate.personId,
      };
    });

    let personRepeats = 0;
    personCounts.forEach((count) => {
      if (count > 1) personRepeats += count - 1;
    });
    let sceneRepeats = 0;
    sceneCounts.forEach((count) => {
      if (count > 1) sceneRepeats += count - 1;
    });

    let semanticSum = 0;
    let qualitySum = 0;
    let slotFitSum = 0;
    for (let i = 0; i < canonicalInput.slots.length; i += 1) {
      const candidate = chosen.get(canonicalInput.slots[i].slotId);
      semanticSum += candidate.semanticScore;
      qualitySum += candidate.qualityScore;
      slotFitSum += candidate.slotFitScore;
    }

    const candidateResult = { assignments, personRepeats, sceneRepeats, semanticSum, qualitySum, slotFitSum };
    if (best === null || compareCompleteAssignments(candidateResult, best) < 0) {
      best = candidateResult;
    }
  }

  function remainingFeasibleForRequired(index, usedCandidateIds, covered) {
    for (let r = 0; r < requiredPersons.length; r += 1) {
      const personId = requiredPersons[r];
      if (covered.has(personId)) continue;
      let feasible = false;
      for (let k = index; k < decidingSlots.length && !feasible; k += 1) {
        const slot = decidingSlots[k];
        if (slot.personId !== null && slot.personId !== personId) continue;
        const options = bySlot.get(slot.slotId);
        for (let i = 0; i < options.length; i += 1) {
          const candidate = options[i];
          if (candidate.personId !== personId) continue;
          if (usedCandidateIds.has(candidate.candidateId)) continue;
          feasible = true;
          break;
        }
      }
      if (!feasible) return false;
    }
    return true;
  }

  function exploreFrom(index, chosen, usedCandidateIds, usedSourceAssetIds, personCounts, sceneCounts, covered) {
    if (searchState.limitExceeded) return;
    searchState.visited += 1;
    if (searchState.visited > MAX_SEARCH_STATES) {
      searchState.limitExceeded = true;
      return;
    }

    if (index === decidingSlots.length) {
      for (let r = 0; r < requiredPersons.length; r += 1) {
        if (!covered.has(requiredPersons[r])) return;
      }
      considerComplete(chosen, personCounts, sceneCounts);
      return;
    }

    if (!remainingFeasibleForRequired(index, usedCandidateIds, covered)) return;

    const slot = decidingSlots[index];
    const options = bySlot.get(slot.slotId);

    for (let i = 0; i < options.length; i += 1) {
      if (searchState.limitExceeded) return;
      const candidate = options[i];
      if (usedCandidateIds.has(candidate.candidateId)) continue;
      if (usedSourceAssetIds.has(candidate.sourceAssetId)) continue;

      const prevPersonCount = candidate.personId === null ? 0 : (personCounts.get(candidate.personId) || 0);
      if (candidate.personId !== null && prevPersonCount > canonicalInput.limits.maxPersonRepeats) continue;
      const prevSceneCount = sceneCounts.get(candidate.sceneKey) || 0;
      if (prevSceneCount > canonicalInput.limits.maxSceneRepeats) continue;

      chosen.set(slot.slotId, candidate);
      usedCandidateIds.add(candidate.candidateId);
      usedSourceAssetIds.add(candidate.sourceAssetId);
      if (candidate.personId !== null) personCounts.set(candidate.personId, prevPersonCount + 1);
      sceneCounts.set(candidate.sceneKey, prevSceneCount + 1);
      let addedCovered = false;
      if (candidate.personId !== null && requiredPersonSet.has(candidate.personId) && !covered.has(candidate.personId)) {
        covered.add(candidate.personId);
        addedCovered = true;
      }

      exploreFrom(index + 1, chosen, usedCandidateIds, usedSourceAssetIds, personCounts, sceneCounts, covered);

      chosen.delete(slot.slotId);
      usedCandidateIds.delete(candidate.candidateId);
      usedSourceAssetIds.delete(candidate.sourceAssetId);
      if (candidate.personId !== null) {
        if (prevPersonCount === 0) personCounts.delete(candidate.personId);
        else personCounts.set(candidate.personId, prevPersonCount);
      }
      if (prevSceneCount === 0) sceneCounts.delete(candidate.sceneKey);
      else sceneCounts.set(candidate.sceneKey, prevSceneCount);
      if (addedCovered) covered.delete(candidate.personId);

      if (searchState.limitExceeded) return;
    }
  }

  if (hero.active) {
    for (let i = 0; i < hero.approvedCandidateIds.length; i += 1) {
      if (searchState.limitExceeded) break;
      searchState.visited += 1;
      if (searchState.visited > MAX_SEARCH_STATES) {
        searchState.limitExceeded = true;
        break;
      }
      const candidate = candidateById.get(hero.approvedCandidateIds[i]);

      const chosen = new Map();
      chosen.set(hero.heroSlotId, candidate);
      const usedCandidateIds = new Set([candidate.candidateId]);
      const usedSourceAssetIds = new Set([candidate.sourceAssetId]);
      const personCounts = new Map();
      if (candidate.personId !== null) personCounts.set(candidate.personId, 1);
      const sceneCounts = new Map([[candidate.sceneKey, 1]]);
      const covered = new Set();
      if (candidate.personId !== null && requiredPersonSet.has(candidate.personId)) {
        covered.add(candidate.personId);
      }

      exploreFrom(0, chosen, usedCandidateIds, usedSourceAssetIds, personCounts, sceneCounts, covered);
    }
  } else {
    exploreFrom(0, new Map(), new Set(), new Set(), new Map(), new Map(), new Set());
  }

  if (searchState.limitExceeded) {
    // message is the fixed constant, never the live visited-state count (Review-D P2: no
    // attacker-influenced dynamic detail in output — the reason enum already says why).
    return {
      holdReason: HOLD_REASON.SEARCH_LIMIT_EXCEEDED,
      path: null,
      message: REDACTED_INTERNAL_MESSAGE,
    };
  }
  if (best === null) {
    return { holdReason: HOLD_REASON.ASSIGNMENT_INFEASIBLE, path: null, message: null };
  }
  return { best };
}

function finalizeOutput(fields) {
  const base = {
    decision: fields.decision,
    reason: fields.reason,
    path: fields.path === undefined ? null : fields.path,
    message: fields.message === undefined ? null : fields.message,
    assignments: fields.assignments,
    diagnostics: fields.diagnostics,
    version: SOLVER_VERSION,
  };
  const assignmentHash = sha256Hex(canonicalStringify(base));
  return deepFreeze({ ...base, assignmentHash });
}

/**
 * Compute the deterministic global slot/candidate assignment.
 *
 * Validates and canonicalizes `input` (see validateSemanticGlobalAssignmentInput),
 * then either binds the hero slot to one of its approved candidates (when a
 * hero constraint is active) or proceeds directly to a bounded DFS over the
 * remaining canonical slots. No candidateId or sourceAssetId is ever reused
 * across the assignment. Among all complete assignments that cover every
 * `required: true` requiredCast entry, the result lexicographically minimizes
 * total person repeats, then scene repeats, maximizes summed semanticScore,
 * qualityScore, slotFitScore (in that order), and finally breaks remaining
 * ties by the smallest canonical assignment tuple (code-unit field-by-field).
 * The search is a rigorously capped (MAX_SEARCH_STATES), not polynomial,
 * DFS: exceeding the cap fails closed to a HOLD rather than returning a
 * possibly non-optimal assignment. Never mutates `input`, never throws.
 * Identical input (up to key/element ordering already normalized away by the
 * validator) produces a byte-identical output, including assignmentHash.
 *
 * @param {*} input see validateSemanticGlobalAssignmentInput
 * @returns {{
 *   decision: 'assigned' | 'hold',
 *   reason: string,
 *   path: string|null,
 *   message: string|null,
 *   assignments: Array<{slotId: string, candidateId: string, sourceAssetId: string, personId: string|null}>,
 *   diagnostics: { covered: string[], missing: string[], repeats: { person: number, scene: number } },
 *   version: string,
 *   assignmentHash: string,
 * }} deep-frozen; `assignments` is exactly `[]` whenever `decision === 'hold'`.
 *   `assignmentHash` is the SHA-256 of the canonical JSON of every other field.
 */
export function buildSemanticGlobalAssignment(input) {
  const validation = validateSemanticGlobalAssignmentInput(input);
  if (!validation.ok) {
    return finalizeOutput({
      decision: 'hold',
      reason: validation.reason,
      path: validation.path,
      message: validation.message,
      assignments: [],
      diagnostics: { covered: [], missing: [], repeats: { person: 0, scene: 0 } },
    });
  }

  const canonicalInput = validation.canonicalInput;
  // Every required:true entry is treated identically regardless of .priority — see the
  // REQUIRED_CAST_KEYS comment above: priority is canonical-input metadata only (not bound
  // into assignmentHash, which hashes output, not input), never consulted for coverage or
  // selection here.
  const requiredPersons = canonicalInput.requiredCast
    .filter((entry) => entry.required)
    .map((entry) => entry.personId)
    .sort(compareCodeUnitStrings);

  if (canonicalInput.slots.length > SOLVER_MAX_SLOTS || canonicalInput.candidates.length > SOLVER_MAX_CANDIDATES) {
    return finalizeOutput({
      decision: 'hold',
      reason: HOLD_REASON.SEARCH_SCOPE_TOO_LARGE,
      path: null,
      message: null,
      assignments: [],
      diagnostics: { covered: [], missing: requiredPersons, repeats: { person: 0, scene: 0 } },
    });
  }

  const hero = {
    active: canonicalInput.heroAuthority.heroSlotId !== null,
    heroSlotId: canonicalInput.heroAuthority.heroSlotId,
    heroPersonId: canonicalInput.heroAuthority.heroPersonId,
    approvedCandidateIds: canonicalInput.heroAuthority.approvedCandidateIds,
  };

  const outcome = runBoundedSearch(canonicalInput, hero, requiredPersons);

  if (outcome.holdReason) {
    return finalizeOutput({
      decision: 'hold',
      reason: outcome.holdReason,
      path: outcome.path,
      message: outcome.message,
      assignments: [],
      diagnostics: { covered: [], missing: requiredPersons, repeats: { person: 0, scene: 0 } },
    });
  }

  return finalizeOutput({
    decision: 'assigned',
    reason: ASSIGNED_REASON,
    path: null,
    message: null,
    assignments: outcome.best.assignments,
    diagnostics: {
      covered: requiredPersons,
      missing: [],
      repeats: { person: outcome.best.personRepeats, scene: outcome.best.sceneRepeats },
    },
  });
}
