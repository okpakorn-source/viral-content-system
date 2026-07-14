// Story / Reference authority contract — a pure, standalone foundation invoked ONLY by the
// default-OFF flag-gated ref-hero-v2 orchestrator (megaAdapters WAVE1A producer). No IO, no time, no random, no env reads — the only
// imports are deterministic Node built-ins (node:crypto for a real
// cryptographic hash, node:util for Proxy detection). Every exported
// function is still a pure function of its arguments.
//
// Problem this module encodes: today a "reference" image (used only for
// layout/geometry) can leak identity/semantic information (who is in the
// photo, where, event context, OCR text, captions, ...) into a composed
// cover, silently overriding what the actual news STORY says. This module
// is the fail-closed contract layer that keeps the two authorities apart:
//
//   STORY authority (trusted, only source of):
//     identities, aliases/cast, editorial hero, event/context/facts, story
//     semantics, eligible asset provenance.
//
//   REFERENCE authority (untrusted for meaning, only source of):
//     layout topology, slot geometry/shape, prominence, shot/framing
//     archetype, layer/overlap intent, ring/border/feather/seam treatment,
//     negative space, hierarchy targets.
//
// A "manual ref lock" (`manualRefLock: true`) means the user pinned a
// specific reference image. That STILL only grants LAYOUT authority — it
// never grants identity/semantic authority.
//
// Round 2 hardening: any structural defect in the raw input fails the WHOLE
// build closed with a typed rejection list — nothing malformed is ever
// stripped-and-merged into a still-successful contract.
//
// Round 3 hardening: validateContract deep-re-validates the FULL candidate
// content before any hash check; provenance reflects actual supply; the
// builder's own return value is byte-identical for reordered input; a
// rejection's `field` never embeds an attacker-chosen key name.
//
// Round 4 hardening: the PUBLIC canonicalizeContract/hashContract deep-
// validate the complete raw schema before any coercion/hash; object
// boundaries are descriptor-first (reject symbol/non-enumerable/accessor
// properties without invoking a getter); provenance TRUTH is enforced
// exactly (not just enum membership); a successful contract's `rejections`
// must be exactly []; structural reference ids are remapped into a closed
// neutral namespace (slot_NNN) so no semantic word can survive into an
// emitted id.
//
// Round 5 hardening:
//   - The contract/external hash is now a REAL cryptographic hash (SHA-256
//     via node:crypto), not the 32-bit FNV1a checksum used through Round 4
//     (whose small output space made a determined attacker's collision
//     search plausible). expectedHash is now exactly 64 lowercase hex
//     characters.
//   - Every object AND array boundary is checked for Proxy (via
//     node:util's types.isProxy) before any reflection is performed on it —
//     merely calling Object.getOwnPropertyDescriptor/getOwnPropertyNames on
//     a Proxy already invokes its traps, so the Proxy check must come
//     first, not after.
//   - Arrays are captured via a descriptor-first, single-pass reader
//     (captureArray) that reads each index's descriptor directly rather
//     than calling any array instance method (map/slice/forEach/spread/
//     Array.from) — all of which are callable-overridable on a real Array
//     instance. This also closes a TOCTOU (time-of-check-to-time-of-use)
//     gap: the PUBLIC canonicalizeContract/hashContract/validateContract
//     now build exactly ONE deep, fully-owned, plain immutable snapshot of
//     the caller's full contract during structural validation, and every
//     later step (provenance-truth check, canonicalization, hashing)
//     operates ONLY on that snapshot — the original caller-supplied object
//     is never read again, so a value that "looks fine" once and returns
//     something different on a second access can never affect the outcome.
//   - A successful contract's `rejections` must be the captured intrinsic
//     dense array with length 0 and no other own keys — captured the same
//     descriptor-first way, so an own slice/property/Proxy/accessor on that
//     array is rejected before canonicalization/hashing.
//   - The neutral id namespace (slot_NNN, 3 digits) has a finite capacity;
//     the builder now enforces an explicit MAX_STRUCTURAL_SLOTS limit well
//     under that capacity and rejects oversize input deterministically
//     BEFORE remapping, so the builder can never emit a slot/hierarchy id
//     its own public validator would then reject.
//
// Every field accepted into the final merged contract carries a provenance
// tag: 'story' | 'reference' | 'derived'.

import { createHash } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

function sha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

const HASH_FORMAT_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const CONTRACT_VERSION = 1;

export const PROVENANCE_VALUES = Object.freeze(['story', 'reference', 'derived']);

export const REJECTION_REASONS = Object.freeze({
  REFERENCE_IDENTITY_LEAK: 'REFERENCE_IDENTITY_LEAK',
  REFERENCE_OCR_LEAK: 'REFERENCE_OCR_LEAK',
  REFERENCE_EVENT_CONTEXT_LEAK: 'REFERENCE_EVENT_CONTEXT_LEAK',
  REFERENCE_UNKNOWN_FIELD_LEAK: 'REFERENCE_UNKNOWN_FIELD_LEAK',
  REFERENCE_GEOMETRY_INVALID: 'REFERENCE_GEOMETRY_INVALID',
  REFERENCE_MISSING_FIELD: 'REFERENCE_MISSING_FIELD',
  REFERENCE_TYPE_INVALID: 'REFERENCE_TYPE_INVALID',
  REFERENCE_ENUM_INVALID: 'REFERENCE_ENUM_INVALID',
  REFERENCE_ID_INVALID: 'REFERENCE_ID_INVALID',
  REFERENCE_DUPLICATE_ID: 'REFERENCE_DUPLICATE_ID',
  REFERENCE_DANGLING_REFERENCE: 'REFERENCE_DANGLING_REFERENCE',
  REFERENCE_CAPACITY_EXCEEDED: 'REFERENCE_CAPACITY_EXCEEDED',
  STORY_UNKNOWN_FIELD: 'STORY_UNKNOWN_FIELD',
  STORY_MISSING_FIELD: 'STORY_MISSING_FIELD',
  STORY_TYPE_INVALID: 'STORY_TYPE_INVALID',
  CONTRACT_MISSING_FIELD: 'CONTRACT_MISSING_FIELD',
  CONTRACT_UNKNOWN_FIELD: 'CONTRACT_UNKNOWN_FIELD',
  CONTRACT_TYPE_INVALID: 'CONTRACT_TYPE_INVALID',
  PROVENANCE_MISSING: 'PROVENANCE_MISSING',
  PROVENANCE_SURPLUS: 'PROVENANCE_SURPLUS',
  PROVENANCE_TAG_INVALID: 'PROVENANCE_TAG_INVALID',
  PROVENANCE_TRUTH_VIOLATION: 'PROVENANCE_TRUTH_VIOLATION',
  REJECTIONS_NOT_EMPTY: 'REJECTIONS_NOT_EMPTY',
});

const STORY_ALLOWED_KEYS = Object.freeze([
  'identities', 'requiredCast', 'optionalCast', 'editorialHero',
  'eventContext', 'facts', 'storySemantics', 'eligibleAssetProvenance',
]);

const REFERENCE_ALLOWED_KEYS = Object.freeze([
  'layoutTopology', 'slotGeometry', 'prominence', 'shotArchetype',
  'layerIntent', 'ringBorderFeatherSeam', 'negativeSpace', 'hierarchyTargets',
]);

// The exact key set of a BUILT layout object (the reference schema plus the
// one always-present derived field). Used by the validator/canonicalizer to
// deep-check an already-built candidate.
const LAYOUT_BUILT_KEYS = Object.freeze(REFERENCE_ALLOWED_KEYS.concat(['shotArchetypeResolved']));

// The exact top-level key set of a complete, already-built contract.
const CONTRACT_TOP_KEYS = Object.freeze(['v', 'manualRefLock', 'identity', 'layout', 'provenance', 'rejections', 'hash']);

const SLOT_REQUIRED_KEYS = Object.freeze(['id', 'xPct', 'yPct', 'wPct', 'hPct']);
const SLOT_OPTIONAL_KEYS = Object.freeze(['shape', 'zIndex']);
const PROMINENCE_REQUIRED_KEYS = Object.freeze(['slotId', 'weight']);
const LAYER_REQUIRED_KEYS = Object.freeze(['slotId', 'zIndex']);
const RBFS_REQUIRED_KEYS = Object.freeze(['ring', 'border', 'feather', 'seam']);
const NEGATIVE_SPACE_REQUIRED_KEYS = Object.freeze(['top', 'bottom', 'left', 'right']);

// Finite, audited enums — reference-origin fields that select from a closed
// set instead of carrying narrative text.
export const LAYOUT_TOPOLOGY_VALUES = Object.freeze([
  'single', 'tri-split', 'grid-2x2', 'circle-inset', 'wide-strip', 'quad-split',
]);

export const SHOT_ARCHETYPE_VALUES = Object.freeze([
  'tight_portrait_left_wide_right',
  'tight_portrait_center',
  'wide_environmental',
  'wide_group',
  'closeup_single',
]);

// Reserved sentinel for "no shot archetype was supplied" — never a valid
// raw input value (accepting it as input would let a hostile reference
// impersonate the derived/unspecified state).
const SHOT_ARCHETYPE_DERIVED_DEFAULT = 'archetype_unspecified';

export const SLOT_SHAPE_VALUES = Object.freeze(['rect', 'circle', 'rounded']);

// RAW input id grammar: what a caller may use when CONSTRUCTING reference
// input (mnemonic names like "hero"/"circle" are fine here). Bounded ascii
// lowercase snake_case; blocks narrative/identity strings, non-ascii text,
// and control characters/line terminators structurally (full-string `test`,
// no trimming applied anywhere an id is accepted).
const ID_GRAMMAR_RE = /^[a-z][a-z0-9_]{0,31}$/;

// EMITTED id namespace: what every id in a BUILT contract must actually be.
// Fixed structural prefix + canonical zero-padded numeric component only —
// no word content of any kind can survive into this channel.
const NEUTRAL_SLOT_ID_PREFIX = 'slot_';
const NEUTRAL_SLOT_ID_RE = /^slot_[0-9]{3}$/;

function neutralSlotId(index) {
  return `${NEUTRAL_SLOT_ID_PREFIX}${String(index).padStart(3, '0')}`;
}

// The neutral namespace's 3-digit numeric component can express up to 1000
// distinct ids (slot_000..slot_999). MAX_STRUCTURAL_SLOTS is set far below
// that capacity — covers realistically use a handful of slots (a hero shot
// plus a few insets), so this leaves generous headroom while keeping the
// bound small, documented, and easy to reason about. Enforced BEFORE
// remapping/generation so an oversize input is rejected deterministically
// rather than ever risking a builder output the namespace can't express (or
// that the public validator would then refuse).
const MAX_STRUCTURAL_SLOTS = 24;

const PCT_MIN = 0;
const PCT_MAX = 100;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------
function isProxy(v) {
  return nodeUtilTypes.isProxy(v);
}

// Descriptor-first ordinary-record check: rejects Proxies (checked FIRST —
// merely calling any reflection API below on a Proxy already invokes its
// traps), arrays, exotic objects (wrong prototype), symbol-keyed
// properties, non-enumerable properties, and accessor (getter/setter)
// properties — all via property-descriptor introspection, which never
// invokes a getter. A hostile getter that returns a valid value on first
// read and something else later cannot pass validation and then smuggle a
// different value in downstream.
function isPlainObject(v) {
  if (isProxy(v)) return false;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  if (Object.getOwnPropertySymbols(v).length > 0) return false;
  const names = Object.getOwnPropertyNames(v);
  for (const name of names) {
    const desc = Object.getOwnPropertyDescriptor(v, name);
    if (!desc.enumerable || !('value' in desc)) return false;
  }
  return true;
}

// Descriptor-first dense-array capture: returns a FRESH, fully-owned plain
// array containing exactly the intrinsic elements of `v`, or null if `v` is
// not a genuine, well-formed native array. Rejects Proxies outright (before
// any reflection), never calls a caller-overridable instance method
// (map/slice/forEach/spread/Array.from all use overridable behavior), never
// invokes a getter. Rejects holes, extra/symbol-keyed own properties, an
// accessor or non-enumerable `length`, and any element whose own descriptor
// is not a plain enumerable data property.
function captureArray(v) {
  if (isProxy(v)) return null;
  if (v === null || typeof v !== 'object' || !Array.isArray(v)) return null;
  if (Object.getPrototypeOf(v) !== Array.prototype) return null;
  if (Object.getOwnPropertySymbols(v).length > 0) return null;

  const lengthDesc = Object.getOwnPropertyDescriptor(v, 'length');
  if (!lengthDesc || lengthDesc.enumerable !== false || !('value' in lengthDesc)) return null;
  const length = lengthDesc.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return null;

  const names = Object.getOwnPropertyNames(v);
  if (names.length !== length + 1) return null;

  const out = [];
  for (let i = 0; i < length; i++) {
    const desc = Object.getOwnPropertyDescriptor(v, String(i));
    if (!desc || desc.enumerable !== true || !('value' in desc)) return null;
    out.push(desc.value);
  }
  return out;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// Classify why a reference-origin key is being rejected. Order matters:
// identity-ish patterns are checked before the broader event/context bucket
// so e.g. "personLocation" reads as an identity leak. Only ever used to
// choose a FIXED reason code — the key itself is never echoed by the caller.
function classifyLeakReason(key) {
  const k = String(key).toLowerCase();
  if (/ocr|caption|callout|overlaytext|subtitle/.test(k)) return REJECTION_REASONS.REFERENCE_OCR_LEAK;
  if (/identity|name|subject|person|cast|hero|who/.test(k)) return REJECTION_REASONS.REFERENCE_IDENTITY_LEAK;
  if (/event|location|place|venue|relationship|context|narrative|story|flow|semantic|plot/.test(k)) return REJECTION_REASONS.REFERENCE_EVENT_CONTEXT_LEAK;
  return REJECTION_REASONS.REFERENCE_UNKNOWN_FIELD_LEAK;
}

// Explicit UTF-16 code-unit comparator — never localeCompare, which is
// locale-dependent and not guaranteed stable across environments.
function codeUnitCompare(a, b) {
  const as = String(a);
  const bs = String(b);
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Exact-schema key check — pushes a typed rejection for every required key
// that is missing and every present key outside the allowed set. A missing
// key's path names the (fixed, known) key itself. A surplus/unknown key's
// path is a FIXED placeholder — the literal attacker-chosen key text is
// never embedded into the field path. Never throws, never coerces:
// presence/absence only. Value-level checks happen separately per field.
// Callers must already have confirmed `obj` via isPlainObject before
// calling this (so Object.keys(obj) here is safe: no Proxy, no accessors).
// ---------------------------------------------------------------------------
function checkExactSchema(obj, requiredKeys, optionalKeys, pathPrefix, source, rejections, missingReason) {
  for (const key of requiredKeys) {
    if (!hasOwn(obj, key)) {
      rejections.push({ field: `${pathPrefix}.${key}`, source, reason: missingReason });
    }
  }
  const allowed = requiredKeys.concat(optionalKeys);
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const reason = source === 'story' ? REJECTION_REASONS.STORY_UNKNOWN_FIELD : classifyLeakReason(key);
      rejections.push({ field: `${pathPrefix}.<surplus>`, source, reason });
    }
  }
}

// ---------------------------------------------------------------------------
// Field-level extractors — each pushes a typed rejection on failure and
// returns null/a captured value; callers gate success on
// `rejections.length === 0` rather than on individual return values, so a
// single pass surfaces every defect instead of stopping at the first one.
// Field paths passed in here are always FIXED schema names supplied by the
// caller — never attacker text. Array-typed fields go through
// captureArray() so the returned value is a fresh, fully-owned copy — never
// a live reference back into caller-controlled data.
// ---------------------------------------------------------------------------
function extractStringArray(raw, field, source, rejections) {
  const reason = source === 'story' ? REJECTION_REASONS.STORY_TYPE_INVALID : REJECTION_REASONS.REFERENCE_TYPE_INVALID;
  const captured = captureArray(raw);
  if (captured === null) {
    rejections.push({ field, source, reason });
    return [];
  }
  const out = [];
  for (let i = 0; i < captured.length; i++) {
    if (!isNonEmptyString(captured[i])) {
      rejections.push({ field: `${field}[${i}]`, source, reason });
      continue;
    }
    out.push(captured[i].trim());
  }
  return out;
}

function extractNullableString(raw, field, source, rejections) {
  if (raw === null) return null;
  const reason = source === 'story' ? REJECTION_REASONS.STORY_TYPE_INVALID : REJECTION_REASONS.REFERENCE_TYPE_INVALID;
  if (!isNonEmptyString(raw)) {
    rejections.push({ field, source, reason });
    return null;
  }
  return raw.trim();
}

// `idGrammar` is ID_GRAMMAR_RE for raw build-time input, NEUTRAL_SLOT_ID_RE
// for an already-built candidate. Full-string `test`, never trimmed — a
// value with a trailing control character or line terminator is rejected
// outright rather than silently normalized.
function extractId(raw, field, rejections, idGrammar) {
  if (typeof raw !== 'string' || !idGrammar.test(raw)) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_ID_INVALID });
    return null;
  }
  return raw;
}

function extractEnum(raw, field, rejections, allowedValues) {
  if (typeof raw !== 'string' || !allowedValues.includes(raw)) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_ENUM_INVALID });
    return null;
  }
  return raw;
}

function extractBoundedNumber(raw, field, rejections, min, max, inclusiveMin) {
  if (!isFiniteNumber(raw)) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID });
    return null;
  }
  const lowOk = inclusiveMin ? raw >= min : raw > min;
  if (!lowOk || raw > max) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID });
    return null;
  }
  return raw;
}

function extractSafeInteger(raw, field, rejections) {
  if (!Number.isSafeInteger(raw)) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID });
    return null;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// STORY-shaped sanitizer — exact schema: all 8 keys required, no surplus,
// each value must match its raw type. Reused verbatim by the contract
// structure gate to deep-check-and-CAPTURE a candidate's `identity` (which
// has the identical exact shape as a raw, fully-supplied story input).
// Story/identity is the trusted authority, so any defect here is recorded
// via `rejections` and fails the whole build/validate closed rather than
// being coerced into validity. Callers must have already confirmed `story`
// via isPlainObject.
// ---------------------------------------------------------------------------
function sanitizeStoryStrict(story, rejections) {
  checkExactSchema(story, STORY_ALLOWED_KEYS, [], 'story', 'story', rejections, REJECTION_REASONS.STORY_MISSING_FIELD);

  const get = (key, fn, fallback) => (hasOwn(story, key) ? fn(story[key], `story.${key}`, 'story', rejections) : fallback);

  return {
    identities: get('identities', extractStringArray, []),
    requiredCast: get('requiredCast', extractStringArray, []),
    optionalCast: get('optionalCast', extractStringArray, []),
    editorialHero: get('editorialHero', extractNullableString, null),
    eventContext: get('eventContext', extractNullableString, null),
    facts: get('facts', extractStringArray, []),
    storySemantics: get('storySemantics', extractNullableString, null),
    eligibleAssetProvenance: get('eligibleAssetProvenance', extractStringArray, []),
  };
}

// ---------------------------------------------------------------------------
// REFERENCE/LAYOUT nested extractors — parameterized by `pathPrefix`
// ('reference' at build time on raw input, 'layout' at validate/canonicalize
// time on an already-built candidate), `requireOptional` (raw input may
// OMIT shape/zIndex entirely; a built candidate must always carry both
// keys, with an explicit null standing in for "not asserted"), and
// `idGrammar` (raw vs neutral-namespace id checking). Callers must have
// already confirmed each entry via isPlainObject before reading its fields.
// ---------------------------------------------------------------------------
function extractSlotEntry(raw, idx, rejections, pathPrefix, requireOptional, idGrammar) {
  const field = `${pathPrefix}.slotGeometry[${idx}]`;
  if (!isPlainObject(raw)) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID });
    return null;
  }
  const required = requireOptional ? SLOT_REQUIRED_KEYS.concat(SLOT_OPTIONAL_KEYS) : SLOT_REQUIRED_KEYS;
  const optional = requireOptional ? [] : SLOT_OPTIONAL_KEYS;
  checkExactSchema(raw, required, optional, field, 'reference', rejections, REJECTION_REASONS.REFERENCE_MISSING_FIELD);

  const id = hasOwn(raw, 'id') ? extractId(raw.id, `${field}.id`, rejections, idGrammar) : null;
  const xPct = hasOwn(raw, 'xPct') ? extractBoundedNumber(raw.xPct, `${field}.xPct`, rejections, PCT_MIN, PCT_MAX, true) : null;
  const yPct = hasOwn(raw, 'yPct') ? extractBoundedNumber(raw.yPct, `${field}.yPct`, rejections, PCT_MIN, PCT_MAX, true) : null;
  const wPct = hasOwn(raw, 'wPct') ? extractBoundedNumber(raw.wPct, `${field}.wPct`, rejections, PCT_MIN, PCT_MAX, false) : null;
  const hPct = hasOwn(raw, 'hPct') ? extractBoundedNumber(raw.hPct, `${field}.hPct`, rejections, PCT_MIN, PCT_MAX, false) : null;

  let shape = null;
  if (hasOwn(raw, 'shape')) {
    shape = raw.shape === null ? null : extractEnum(raw.shape, `${field}.shape`, rejections, SLOT_SHAPE_VALUES);
  }
  let zIndex = null;
  if (hasOwn(raw, 'zIndex')) {
    zIndex = raw.zIndex === null ? null : extractSafeInteger(raw.zIndex, `${field}.zIndex`, rejections);
  }

  if (id === null || xPct === null || yPct === null || wPct === null || hPct === null) return null;
  if (xPct + wPct > PCT_MAX || yPct + hPct > PCT_MAX) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID });
    return null;
  }
  return { id, xPct, yPct, wPct, hPct, shape, zIndex };
}

function extractProminenceEntry(raw, idx, rejections, pathPrefix, idGrammar) {
  const field = `${pathPrefix}.prominence[${idx}]`;
  if (!isPlainObject(raw)) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID });
    return null;
  }
  checkExactSchema(raw, PROMINENCE_REQUIRED_KEYS, [], field, 'reference', rejections, REJECTION_REASONS.REFERENCE_MISSING_FIELD);
  const slotId = hasOwn(raw, 'slotId') ? extractId(raw.slotId, `${field}.slotId`, rejections, idGrammar) : null;
  const weight = hasOwn(raw, 'weight') ? extractBoundedNumber(raw.weight, `${field}.weight`, rejections, 0, 1, true) : null;
  if (slotId === null || weight === null) return null;
  return { slotId, weight };
}

function extractLayerEntry(raw, idx, rejections, pathPrefix, idGrammar) {
  const field = `${pathPrefix}.layerIntent[${idx}]`;
  if (!isPlainObject(raw)) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID });
    return null;
  }
  checkExactSchema(raw, LAYER_REQUIRED_KEYS, [], field, 'reference', rejections, REJECTION_REASONS.REFERENCE_MISSING_FIELD);
  const slotId = hasOwn(raw, 'slotId') ? extractId(raw.slotId, `${field}.slotId`, rejections, idGrammar) : null;
  const zIndex = hasOwn(raw, 'zIndex') ? extractSafeInteger(raw.zIndex, `${field}.zIndex`, rejections) : null;
  if (slotId === null || zIndex === null) return null;
  return { slotId, zIndex };
}

function extractRbfsMap(raw, rejections, pathPrefix) {
  const field = `${pathPrefix}.ringBorderFeatherSeam`;
  if (raw === null) return null;
  if (!isPlainObject(raw)) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    return null;
  }
  checkExactSchema(raw, RBFS_REQUIRED_KEYS, [], field, 'reference', rejections, REJECTION_REASONS.REFERENCE_MISSING_FIELD);
  const out = {};
  let bad = false;
  for (const k of RBFS_REQUIRED_KEYS) {
    if (!hasOwn(raw, k)) { bad = true; continue; }
    if (typeof raw[k] !== 'boolean') {
      rejections.push({ field: `${field}.${k}`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
      bad = true;
      continue;
    }
    out[k] = raw[k];
  }
  return bad ? null : out;
}

function extractNegativeSpace(raw, rejections, pathPrefix) {
  const field = `${pathPrefix}.negativeSpace`;
  if (raw === null) return null;
  if (!isPlainObject(raw)) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    return null;
  }
  checkExactSchema(raw, NEGATIVE_SPACE_REQUIRED_KEYS, [], field, 'reference', rejections, REJECTION_REASONS.REFERENCE_MISSING_FIELD);
  const vals = {};
  let bad = false;
  for (const k of NEGATIVE_SPACE_REQUIRED_KEYS) {
    if (!hasOwn(raw, k)) { bad = true; continue; }
    const v = extractBoundedNumber(raw[k], `${field}.${k}`, rejections, 0, 100, true);
    if (v === null) { bad = true; continue; }
    vals[k] = v;
  }
  if (bad) return null;
  if (vals.top + vals.bottom > 100 || vals.left + vals.right > 100) {
    rejections.push({ field, source: 'reference', reason: REJECTION_REASONS.REFERENCE_GEOMETRY_INVALID });
    return null;
  }
  return vals;
}

// Cross-reference integrity, shared by build-time sanitization and
// validate/canonicalize-time deep re-check: duplicate slot ids, duplicate
// prominence/layerIntent slotId entries, duplicate hierarchyTargets, and
// dangling slotId/hierarchy references against the surviving slot-id set.
// Operates on already-captured (trusted) arrays.
function checkCrossReferences(slotGeometry, prominence, layerIntent, hierarchyTargets, pathPrefix, rejections) {
  const seenSlotIds = new Set();
  for (let i = 0; i < slotGeometry.length; i++) {
    const id = slotGeometry[i].id;
    if (seenSlotIds.has(id)) {
      rejections.push({ field: `${pathPrefix}.slotGeometry[${i}]`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_DUPLICATE_ID });
    } else {
      seenSlotIds.add(id);
    }
  }

  const seenProminenceIds = new Set();
  for (let i = 0; i < prominence.length; i++) {
    const id = prominence[i].slotId;
    if (seenProminenceIds.has(id)) {
      rejections.push({ field: `${pathPrefix}.prominence[${i}]`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_DUPLICATE_ID });
    } else {
      seenProminenceIds.add(id);
    }
    if (!seenSlotIds.has(id)) {
      rejections.push({ field: `${pathPrefix}.prominence[${i}]`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_DANGLING_REFERENCE });
    }
  }

  const seenLayerIds = new Set();
  for (let i = 0; i < layerIntent.length; i++) {
    const id = layerIntent[i].slotId;
    if (seenLayerIds.has(id)) {
      rejections.push({ field: `${pathPrefix}.layerIntent[${i}]`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_DUPLICATE_ID });
    } else {
      seenLayerIds.add(id);
    }
    if (!seenSlotIds.has(id)) {
      rejections.push({ field: `${pathPrefix}.layerIntent[${i}]`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_DANGLING_REFERENCE });
    }
  }

  const seenHierarchy = new Set();
  for (let i = 0; i < hierarchyTargets.length; i++) {
    const id = hierarchyTargets[i];
    if (seenHierarchy.has(id)) {
      rejections.push({ field: `${pathPrefix}.hierarchyTargets[${i}]`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_DUPLICATE_ID });
      continue;
    }
    seenHierarchy.add(id);
    if (!seenSlotIds.has(id)) {
      rejections.push({ field: `${pathPrefix}.hierarchyTargets[${i}]`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_DANGLING_REFERENCE });
    }
  }
}

// Structural capacity guard, shared by build-time sanitization and
// validate/canonicalize-time deep re-check. Checked AFTER cross-reference
// validation (so it reports against the confirmed-valid, deduplicated slot
// set) but BEFORE the builder ever attempts neutral-id remapping/
// generation — an oversize input fails the whole build/validate closed
// rather than risking an id the 3-digit neutral namespace can't express.
function checkStructuralCapacity(slotGeometry, hierarchyTargets, pathPrefix, rejections) {
  if (slotGeometry.length > MAX_STRUCTURAL_SLOTS) {
    rejections.push({ field: `${pathPrefix}.slotGeometry`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_CAPACITY_EXCEEDED });
  }
  if (hierarchyTargets.length > MAX_STRUCTURAL_SLOTS) {
    rejections.push({ field: `${pathPrefix}.hierarchyTargets`, source: 'reference', reason: REJECTION_REASONS.REFERENCE_CAPACITY_EXCEEDED });
  }
}

// ---------------------------------------------------------------------------
// REFERENCE sanitization (build time, raw input) — layout-only exact
// schema, RAW id grammar (mnemonic caller-chosen ids allowed; remapped to
// the neutral namespace afterward — see remapToNeutralIds). Every top-level
// key is required (a caller either omits `reference` entirely, or supplies
// the complete envelope). Callers must have already confirmed `reference`
// via isPlainObject.
// ---------------------------------------------------------------------------
function sanitizeReferenceStrict(reference, rejections) {
  checkExactSchema(reference, REFERENCE_ALLOWED_KEYS, [], 'reference', 'reference', rejections, REJECTION_REASONS.REFERENCE_MISSING_FIELD);

  let layoutTopology = null;
  if (hasOwn(reference, 'layoutTopology') && reference.layoutTopology !== null) {
    layoutTopology = extractEnum(reference.layoutTopology, 'reference.layoutTopology', rejections, LAYOUT_TOPOLOGY_VALUES);
  }

  let shotArchetype = null;
  let shotArchetypeSupplied = false;
  if (hasOwn(reference, 'shotArchetype') && reference.shotArchetype !== null) {
    shotArchetype = extractEnum(reference.shotArchetype, 'reference.shotArchetype', rejections, SHOT_ARCHETYPE_VALUES);
    shotArchetypeSupplied = shotArchetype !== null;
  }

  const slotGeometry = [];
  if (hasOwn(reference, 'slotGeometry')) {
    const captured = captureArray(reference.slotGeometry);
    if (captured === null) {
      rejections.push({ field: 'reference.slotGeometry', source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    } else {
      for (let i = 0; i < captured.length; i++) {
        const entry = extractSlotEntry(captured[i], i, rejections, 'reference', false, ID_GRAMMAR_RE);
        if (entry !== null) slotGeometry.push(entry);
      }
    }
  }

  const prominence = [];
  if (hasOwn(reference, 'prominence')) {
    const captured = captureArray(reference.prominence);
    if (captured === null) {
      rejections.push({ field: 'reference.prominence', source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    } else {
      for (let i = 0; i < captured.length; i++) {
        const entry = extractProminenceEntry(captured[i], i, rejections, 'reference', ID_GRAMMAR_RE);
        if (entry !== null) prominence.push(entry);
      }
    }
  }

  const layerIntent = [];
  if (hasOwn(reference, 'layerIntent')) {
    const captured = captureArray(reference.layerIntent);
    if (captured === null) {
      rejections.push({ field: 'reference.layerIntent', source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    } else {
      for (let i = 0; i < captured.length; i++) {
        const entry = extractLayerEntry(captured[i], i, rejections, 'reference', ID_GRAMMAR_RE);
        if (entry !== null) layerIntent.push(entry);
      }
    }
  }

  const hierarchyTargets = [];
  if (hasOwn(reference, 'hierarchyTargets')) {
    const captured = captureArray(reference.hierarchyTargets);
    if (captured === null) {
      rejections.push({ field: 'reference.hierarchyTargets', source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    } else {
      for (let i = 0; i < captured.length; i++) {
        const id = extractId(captured[i], `reference.hierarchyTargets[${i}]`, rejections, ID_GRAMMAR_RE);
        if (id !== null) hierarchyTargets.push(id);
      }
    }
  }

  const ringBorderFeatherSeam = hasOwn(reference, 'ringBorderFeatherSeam') ? extractRbfsMap(reference.ringBorderFeatherSeam, rejections, 'reference') : null;
  const negativeSpace = hasOwn(reference, 'negativeSpace') ? extractNegativeSpace(reference.negativeSpace, rejections, 'reference') : null;

  checkCrossReferences(slotGeometry, prominence, layerIntent, hierarchyTargets, 'reference', rejections);
  checkStructuralCapacity(slotGeometry, hierarchyTargets, 'reference', rejections);

  return {
    layout: {
      layoutTopology,
      slotGeometry,
      prominence,
      shotArchetype,
      layerIntent,
      ringBorderFeatherSeam,
      negativeSpace,
      hierarchyTargets,
    },
    shotArchetypeSupplied,
  };
}

const EMPTY_LAYOUT = Object.freeze({
  layoutTopology: null,
  slotGeometry: [],
  prominence: [],
  shotArchetype: null,
  layerIntent: [],
  ringBorderFeatherSeam: null,
  negativeSpace: null,
  hierarchyTargets: [],
});

// Deterministically remap every accepted RAW slot id into the closed
// neutral namespace (slot_000, slot_001, ...), assigned by a canonical
// code-unit sort of the ORIGINAL raw ids — so two logically-equivalent
// inputs whose slots/cross-references arrive in different orders still
// remap to identical neutral ids (required for the byte-identical builder
// output guarantee). All cross-references (prominence/layerIntent/
// hierarchyTargets) are rewritten through the same id map. Only called
// after checkCrossReferences/checkStructuralCapacity have already confirmed
// every raw id is unique, every cross-reference resolves, and the slot
// count is within the neutral namespace's capacity — so every generated id
// is guaranteed to fit the 3-digit format and the map is total over what
// it's asked to look up. Operates on already-captured (trusted) data, so
// normal array methods are safe here.
function remapToNeutralIds(layoutBase) {
  const uniqueRawIds = [...new Set(layoutBase.slotGeometry.map((s) => s.id))].sort(codeUnitCompare);
  const idMap = new Map(uniqueRawIds.map((rawId, idx) => [rawId, neutralSlotId(idx)]));

  return {
    ...layoutBase,
    slotGeometry: layoutBase.slotGeometry.map((s) => ({ ...s, id: idMap.get(s.id) })),
    prominence: layoutBase.prominence.map((p) => ({ ...p, slotId: idMap.get(p.slotId) })),
    layerIntent: layoutBase.layerIntent.map((l) => ({ ...l, slotId: idMap.get(l.slotId) })),
    hierarchyTargets: layoutBase.hierarchyTargets.map((id) => idMap.get(id)),
  };
}

// ---------------------------------------------------------------------------
// Provenance — every field accepted into the contract gets exactly one tag
// from PROVENANCE_VALUES. identity.* is always 'story'. layout.* is
// 'reference' ONLY when an accepted reference value actually populated that
// specific field (non-null scalar/map, non-empty array); an empty/default/
// fallback value — including when no reference was supplied at all — is
// 'derived'. shotArchetypeResolved follows the same rule via
// shotArchetypeSupplied (it has no raw value of its own to inspect).
// ---------------------------------------------------------------------------
function isLayoutFieldSupplied(key, value) {
  switch (key) {
    case 'slotGeometry':
    case 'prominence':
    case 'layerIntent':
    case 'hierarchyTargets':
      return Array.isArray(value) && value.length > 0;
    case 'ringBorderFeatherSeam':
    case 'negativeSpace':
    case 'layoutTopology':
    case 'shotArchetype':
      return value !== null;
    default:
      return false;
  }
}

function buildProvenanceMap(identity, layout, shotArchetypeSupplied) {
  const map = {};
  for (const k of Object.keys(identity)) map[`identity.${k}`] = 'story';
  for (const k of Object.keys(layout)) {
    if (k === 'shotArchetypeResolved') {
      map[`layout.${k}`] = shotArchetypeSupplied ? 'reference' : 'derived';
    } else {
      map[`layout.${k}`] = isLayoutFieldSupplied(k, layout[k]) ? 'reference' : 'derived';
    }
  }
  map.manualRefLock = 'derived';
  return map;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value)) deepFreeze(value[k]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// PRIVATE trusted-payload canonicalizer/hasher — used only internally on
// data this module has ALREADY fully captured into its own fresh, plain
// structures: the builder's own freshly-constructed `core`, or the deep-
// captured snapshot produced by validateContractStructure. Deliberately
// uses ordinary array methods (slice/sort/map) — safe here because the
// input is, by construction, never a live reference into caller-controlled
// data (no Proxy, no overridden methods, no accessors could have survived
// capture). Not exported — the public canonicalizeContract/hashContract
// below are the only externally-callable entry points, and they gate
// through the full structure-and-capture validator first.
//
// Set-like arrays/maps are sorted by the explicit code-unit comparator
// (never localeCompare) so two logically-identical contracts built from
// differently-ordered input always canonicalize/hash identically.
// ---------------------------------------------------------------------------
function sortStrings(arr) {
  return Array.isArray(arr) ? arr.slice().sort(codeUnitCompare) : [];
}

function sortMapKeys(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  // Object.create(null): a normal `{}` here would let a key literally
  // named "__proto__" vanish (or worse, repoint this object's own
  // prototype) via the inherited Object.prototype.__proto__ setter when
  // copied in via `out[k] = ...` — a null-prototype target has no such
  // setter, so an own "__proto__" key copies through as an ordinary data
  // property like any other key.
  const out = Object.create(null);
  for (const k of Object.keys(obj).sort(codeUnitCompare)) out[k] = obj[k];
  return out;
}

function sortByKey(arr, key) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice()
    .sort((a, b) => codeUnitCompare(a?.[key], b?.[key]))
    .map((item) => sortMapKeys(item));
}

function sortRejections(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice()
    .map((r) => ({ field: r?.field ?? null, source: r?.source ?? null, reason: r?.reason ?? null }))
    .sort((a, b) => codeUnitCompare(`${a.field}|${a.source}|${a.reason}`, `${b.field}|${b.source}|${b.reason}`));
}

function canonicalizeTrusted(contract) {
  if (!isPlainObject(contract)) return null;
  const identity = isPlainObject(contract.identity) ? contract.identity : {};
  const layout = isPlainObject(contract.layout) ? contract.layout : {};
  const provenance = isPlainObject(contract.provenance) ? contract.provenance : {};
  return {
    v: contract.v,
    manualRefLock: contract.manualRefLock === true,
    identity: {
      identities: sortStrings(identity.identities),
      requiredCast: sortStrings(identity.requiredCast),
      optionalCast: sortStrings(identity.optionalCast),
      editorialHero: identity.editorialHero ?? null,
      eventContext: identity.eventContext ?? null,
      facts: sortStrings(identity.facts),
      storySemantics: identity.storySemantics ?? null,
      eligibleAssetProvenance: sortStrings(identity.eligibleAssetProvenance),
    },
    layout: {
      layoutTopology: layout.layoutTopology ?? null,
      slotGeometry: sortByKey(layout.slotGeometry, 'id'),
      prominence: sortByKey(layout.prominence, 'slotId'),
      shotArchetype: layout.shotArchetype ?? null,
      layerIntent: sortByKey(layout.layerIntent, 'slotId'),
      ringBorderFeatherSeam: sortMapKeys(layout.ringBorderFeatherSeam),
      negativeSpace: sortMapKeys(layout.negativeSpace),
      hierarchyTargets: sortStrings(layout.hierarchyTargets),
      shotArchetypeResolved: layout.shotArchetypeResolved ?? null,
    },
    provenance: sortMapKeys(provenance),
    rejections: sortRejections(contract.rejections),
  };
}

function hashTrusted(contract) {
  const canon = canonicalizeTrusted(contract);
  if (canon === null) return null;
  return sha256Hex(JSON.stringify(canon));
}

// ---------------------------------------------------------------------------
// Builder — reconciles story + reference input into a provenance-tagged,
// deep-frozen contract. Never throws for a data-shape problem; returns
// { ok:false, reason, details } instead. Raw schema validation runs to
// completion first and BEFORE any canonicalization — every defect found is
// collected into `details.rejections`, and if any exist the whole build
// fails closed. Accepted structural reference ids are then deterministically
// remapped into the closed neutral namespace, and all set-like arrays/maps
// are sorted (same comparator as canonicalizeTrusted) before the contract is
// constructed, so the returned contract itself — not only its hash — is
// byte-identical for logically-equivalent, differently-ordered input.
//
// Shape:
//   buildStoryReferenceAuthorityContract({ story, reference, manualRefLock })
//     -> { ok:true, contract } | { ok:false, reason, details }
// ---------------------------------------------------------------------------
function buildInternal(input) {
  if (!isPlainObject(input)) return { ok: false, reason: 'INPUT_NOT_OBJECT', details: {} };

  const allowedTop = ['story', 'reference', 'manualRefLock'];
  for (const k of Object.keys(input)) {
    if (!allowedTop.includes(k)) return { ok: false, reason: 'UNKNOWN_TOP_LEVEL_FIELD', details: {} };
  }

  // Descriptor-first, own-property-only reads: `input.xxx` alone would also
  // resolve an INHERITED property from a polluted Object.prototype even
  // when `input` itself has no own field of that name, silently handing a
  // caller authority (a story/reference/manualRefLock) they never actually
  // supplied. hasOwn gates every read here so only input's OWN fields can
  // ever count — this mirrors the same discipline sanitizeStoryStrict/
  // sanitizeReferenceStrict/validateContractStructure already use for every
  // nested field.
  const rawManualRefLock = hasOwn(input, 'manualRefLock') ? input.manualRefLock : undefined;
  if (rawManualRefLock !== undefined && typeof rawManualRefLock !== 'boolean') {
    return { ok: false, reason: 'MANUAL_REF_LOCK_INVALID_TYPE', details: {} };
  }
  // manualRefLock only ever grants LAYOUT authority — it never changes which
  // authority owns identity fields (identity is always 'story', see
  // buildProvenanceMap). We still thread the flag through for downstream
  // consumers/telemetry, tagged 'derived'.
  const manualRefLock = rawManualRefLock === true;

  const rawStory = hasOwn(input, 'story') ? input.story : undefined;
  if (!isPlainObject(rawStory)) return { ok: false, reason: 'STORY_NOT_OBJECT', details: {} };
  const rawReference = hasOwn(input, 'reference') ? input.reference : undefined;
  if (rawReference !== undefined && rawReference !== null && !isPlainObject(rawReference)) {
    return { ok: false, reason: 'REFERENCE_NOT_OBJECT', details: {} };
  }
  // `reference` may be omitted entirely (no layout authority supplied at
  // all). If present it must be the complete exact-schema envelope — an
  // empty object `{}` is a present-but-incomplete envelope and fails
  // closed, it is not treated the same as omission.
  const referenceProvided = isPlainObject(rawReference);

  const rejections = [];
  const identity = sanitizeStoryStrict(rawStory, rejections);
  const { layout: layoutBase, shotArchetypeSupplied } = referenceProvided
    ? sanitizeReferenceStrict(rawReference, rejections)
    : { layout: EMPTY_LAYOUT, shotArchetypeSupplied: false };

  if (rejections.length > 0) {
    return { ok: false, reason: 'SCHEMA_VALIDATION_FAILED', details: { rejections } };
  }

  const layoutRemapped = remapToNeutralIds(layoutBase);

  // Canonically sort every set-like array/map now, at build time, so the
  // RETURNED contract itself is order-independent — not only its hash.
  const identityFinal = {
    identities: sortStrings(identity.identities),
    requiredCast: sortStrings(identity.requiredCast),
    optionalCast: sortStrings(identity.optionalCast),
    editorialHero: identity.editorialHero,
    eventContext: identity.eventContext,
    facts: sortStrings(identity.facts),
    storySemantics: identity.storySemantics,
    eligibleAssetProvenance: sortStrings(identity.eligibleAssetProvenance),
  };

  const layoutBaseFinal = {
    layoutTopology: layoutRemapped.layoutTopology,
    slotGeometry: sortByKey(layoutRemapped.slotGeometry, 'id'),
    prominence: sortByKey(layoutRemapped.prominence, 'slotId'),
    shotArchetype: layoutRemapped.shotArchetype,
    layerIntent: sortByKey(layoutRemapped.layerIntent, 'slotId'),
    ringBorderFeatherSeam: sortMapKeys(layoutRemapped.ringBorderFeatherSeam),
    negativeSpace: sortMapKeys(layoutRemapped.negativeSpace),
    hierarchyTargets: sortStrings(layoutRemapped.hierarchyTargets),
  };

  // The one deliberately-derived field: a shot archetype is always present
  // downstream even if the reference didn't specify one. Still layout-only.
  const layout = {
    ...layoutBaseFinal,
    shotArchetypeResolved: shotArchetypeSupplied ? layoutBaseFinal.shotArchetype : SHOT_ARCHETYPE_DERIVED_DEFAULT,
  };

  const provenance = buildProvenanceMap(identityFinal, layout, shotArchetypeSupplied);

  const core = {
    v: CONTRACT_VERSION,
    manualRefLock,
    identity: identityFinal,
    layout,
    provenance,
    rejections: [],
  };
  const hash = hashTrusted(core);
  const contract = deepFreeze({ ...core, hash });
  return { ok: true, contract };
}

export function buildStoryReferenceAuthorityContract(input) {
  try {
    return buildInternal(input);
  } catch (_err) {
    return { ok: false, reason: 'INTERNAL_ERROR', details: {} };
  }
}

// ---------------------------------------------------------------------------
// Deep structural re-validation AND CAPTURE of an already-BUILT
// candidate.layout — used by the contract structure gate as defense-in-
// depth beyond the hash-binding check, and to build the trusted snapshot
// (candidate.identity is validated/captured by reusing sanitizeStoryStrict
// directly: identity and a raw, fully-supplied story input share the
// identical exact shape). Every key a built layout emits is REQUIRED
// present; nullable fields must be explicit null, never omitted — this
// mirrors exactly what the builder itself always produces. Ids are checked
// against the NEUTRAL namespace, not the raw grammar: a candidate, by
// definition, represents already-built output, so a non-neutral id here
// means either a hand-forged candidate or a builder bug — either way it is
// rejected, never remapped (remapping only ever happens once, at build
// time). Returns the captured layout object (built entirely from
// captureArray/isPlainObject-gated reads — never a live reference into the
// caller's object), or null if anything was rejected.
// ---------------------------------------------------------------------------
function validateBuiltLayout(layout, rejections) {
  if (!isPlainObject(layout)) {
    rejections.push({ field: 'layout', source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    return null;
  }
  const before = rejections.length;
  checkExactSchema(layout, LAYOUT_BUILT_KEYS, [], 'layout', 'reference', rejections, REJECTION_REASONS.REFERENCE_MISSING_FIELD);

  let layoutTopology = null;
  if (hasOwn(layout, 'layoutTopology') && layout.layoutTopology !== null) {
    layoutTopology = extractEnum(layout.layoutTopology, 'layout.layoutTopology', rejections, LAYOUT_TOPOLOGY_VALUES);
  }
  let shotArchetype = null;
  if (hasOwn(layout, 'shotArchetype') && layout.shotArchetype !== null) {
    shotArchetype = extractEnum(layout.shotArchetype, 'layout.shotArchetype', rejections, SHOT_ARCHETYPE_VALUES);
  }
  let shotArchetypeResolved = null;
  if (hasOwn(layout, 'shotArchetypeResolved')) {
    const val = layout.shotArchetypeResolved;
    const validValue = typeof val === 'string' && (val === SHOT_ARCHETYPE_DERIVED_DEFAULT || SHOT_ARCHETYPE_VALUES.includes(val));
    if (!validValue) {
      rejections.push({ field: 'layout.shotArchetypeResolved', source: 'reference', reason: REJECTION_REASONS.REFERENCE_ENUM_INVALID });
    } else {
      shotArchetypeResolved = val;
    }
  }

  const slotGeometry = [];
  if (hasOwn(layout, 'slotGeometry')) {
    const captured = captureArray(layout.slotGeometry);
    if (captured === null) {
      rejections.push({ field: 'layout.slotGeometry', source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    } else {
      for (let i = 0; i < captured.length; i++) {
        const entry = extractSlotEntry(captured[i], i, rejections, 'layout', true, NEUTRAL_SLOT_ID_RE);
        if (entry !== null) slotGeometry.push(entry);
      }
    }
  }

  const prominence = [];
  if (hasOwn(layout, 'prominence')) {
    const captured = captureArray(layout.prominence);
    if (captured === null) {
      rejections.push({ field: 'layout.prominence', source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    } else {
      for (let i = 0; i < captured.length; i++) {
        const entry = extractProminenceEntry(captured[i], i, rejections, 'layout', NEUTRAL_SLOT_ID_RE);
        if (entry !== null) prominence.push(entry);
      }
    }
  }

  const layerIntent = [];
  if (hasOwn(layout, 'layerIntent')) {
    const captured = captureArray(layout.layerIntent);
    if (captured === null) {
      rejections.push({ field: 'layout.layerIntent', source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    } else {
      for (let i = 0; i < captured.length; i++) {
        const entry = extractLayerEntry(captured[i], i, rejections, 'layout', NEUTRAL_SLOT_ID_RE);
        if (entry !== null) layerIntent.push(entry);
      }
    }
  }

  const hierarchyTargets = [];
  if (hasOwn(layout, 'hierarchyTargets')) {
    const captured = captureArray(layout.hierarchyTargets);
    if (captured === null) {
      rejections.push({ field: 'layout.hierarchyTargets', source: 'reference', reason: REJECTION_REASONS.REFERENCE_TYPE_INVALID });
    } else {
      for (let i = 0; i < captured.length; i++) {
        const id = extractId(captured[i], `layout.hierarchyTargets[${i}]`, rejections, NEUTRAL_SLOT_ID_RE);
        if (id !== null) hierarchyTargets.push(id);
      }
    }
  }

  const ringBorderFeatherSeam = hasOwn(layout, 'ringBorderFeatherSeam') ? extractRbfsMap(layout.ringBorderFeatherSeam, rejections, 'layout') : null;
  const negativeSpace = hasOwn(layout, 'negativeSpace') ? extractNegativeSpace(layout.negativeSpace, rejections, 'layout') : null;

  checkCrossReferences(slotGeometry, prominence, layerIntent, hierarchyTargets, 'layout', rejections);
  checkStructuralCapacity(slotGeometry, hierarchyTargets, 'layout', rejections);

  if (rejections.length !== before) return null;
  return { layoutTopology, slotGeometry, prominence, shotArchetype, layerIntent, ringBorderFeatherSeam, negativeSpace, hierarchyTargets, shotArchetypeResolved };
}

// ---------------------------------------------------------------------------
// Provenance TRUTH check for an already-built (and by this point
// structurally-verified, CAPTURED) identity/layout/provenance triple: every
// provenance entry must be EXACTLY the deterministically-expected tag, not
// merely "a valid enum value" or "not a cross-authority violation". Also
// enforces the shotArchetypeResolved/shotArchetype relationship exactly,
// including the derived-sentinel/no-reference case. Surplus provenance keys
// (which could be attacker-chosen text) are reported via a fixed
// placeholder, never echoed. `provenance` here is a captured plain
// string->string map (see captureProvenance).
// ---------------------------------------------------------------------------
function validateProvenanceTruth(identity, layout, provenance, rejections) {
  const expected = {};
  for (const k of Object.keys(identity)) expected[`identity.${k}`] = 'story';
  const shotArchetypeSupplied = layout.shotArchetype !== null;
  for (const k of Object.keys(layout)) {
    if (k === 'shotArchetypeResolved') {
      expected[`layout.${k}`] = shotArchetypeSupplied ? 'reference' : 'derived';
    } else {
      expected[`layout.${k}`] = isLayoutFieldSupplied(k, layout[k]) ? 'reference' : 'derived';
    }
  }
  expected.manualRefLock = 'derived';

  for (const k of Object.keys(provenance)) {
    if (!hasOwn(expected, k)) {
      rejections.push({ field: 'provenance.<surplus>', source: 'contract', reason: REJECTION_REASONS.PROVENANCE_SURPLUS });
    }
  }
  for (const k of Object.keys(expected)) {
    if (!hasOwn(provenance, k)) {
      rejections.push({ field: `provenance.${k}`, source: 'contract', reason: REJECTION_REASONS.PROVENANCE_MISSING });
      continue;
    }
    const tag = provenance[k];
    if (!PROVENANCE_VALUES.includes(tag)) {
      rejections.push({ field: `provenance.${k}`, source: 'contract', reason: REJECTION_REASONS.PROVENANCE_TAG_INVALID });
      continue;
    }
    if (tag !== expected[k]) {
      rejections.push({ field: `provenance.${k}`, source: 'contract', reason: REJECTION_REASONS.PROVENANCE_TRUTH_VIOLATION });
    }
  }

  const expectedResolved = shotArchetypeSupplied ? layout.shotArchetype : SHOT_ARCHETYPE_DERIVED_DEFAULT;
  if (layout.shotArchetypeResolved !== expectedResolved) {
    rejections.push({ field: 'layout.shotArchetypeResolved', source: 'reference', reason: REJECTION_REASONS.REFERENCE_ENUM_INVALID });
  }
}

// Descriptor-first capture of a plain string->string provenance map.
// Callers must have already confirmed `provenance` via isPlainObject.
// Object.create(null) — see sortMapKeys for why a normal `{}` target is
// unsafe here: provenance keys are attacker-influenced (dynamic, arbitrary
// strings), so an own "__proto__" key must survive the copy as a real
// property, not vanish through the inherited setter, so the exact-schema
// surplus check downstream can actually see and reject it.
function captureProvenance(provenance) {
  const out = Object.create(null);
  for (const k of Object.keys(provenance)) out[k] = provenance[k];
  return out;
}

// ---------------------------------------------------------------------------
// Full contract structure gate — shared by the PUBLIC canonicalizeContract
// and validateContract. Deep-validates the complete raw candidate BEFORE
// any coercion/default/strip/hash: exact top-level keys, exact identity/
// layout content (enums, neutral ids, geometry, duplicates, dangling refs,
// structural capacity — the SAME rules the builder enforces), exact+
// truthful provenance, and rejections-must-be-exactly-[]. Rejects Proxies
// and never invokes a getter at any boundary (isPlainObject/captureArray
// are both descriptor-first). Collects every defect into `rejections`
// rather than stopping at the first one.
//
// Reads the caller's `contract` EXACTLY ONCE: every value that survives
// validation is captured into a fresh, fully-owned plain snapshot as part
// of the SAME pass, and that snapshot — not `contract` — is returned to the
// caller. This closes the TOCTOU (time-of-check-to-time-of-use) window: a
// value that looked valid during validation cannot later resolve to
// something different during canonicalization/hashing, because
// canonicalization/hashing never touch `contract` again.
//
// Returns the captured snapshot on success, or null if any rejection was
// recorded.
// ---------------------------------------------------------------------------
function validateContractStructure(contract, rejections) {
  if (!isPlainObject(contract)) {
    rejections.push({ field: '$', source: 'contract', reason: REJECTION_REASONS.CONTRACT_TYPE_INVALID });
    return null;
  }

  for (const k of CONTRACT_TOP_KEYS) {
    if (!hasOwn(contract, k)) {
      rejections.push({ field: `$.${k}`, source: 'contract', reason: REJECTION_REASONS.CONTRACT_MISSING_FIELD });
    }
  }
  for (const k of Object.keys(contract)) {
    if (!CONTRACT_TOP_KEYS.includes(k)) {
      rejections.push({ field: '$.<surplus>', source: 'contract', reason: REJECTION_REASONS.CONTRACT_UNKNOWN_FIELD });
    }
  }

  const v = hasOwn(contract, 'v') ? contract.v : undefined;
  if (hasOwn(contract, 'v') && v !== CONTRACT_VERSION) {
    rejections.push({ field: '$.v', source: 'contract', reason: REJECTION_REASONS.CONTRACT_TYPE_INVALID });
  }
  const manualRefLock = hasOwn(contract, 'manualRefLock') ? contract.manualRefLock : undefined;
  if (hasOwn(contract, 'manualRefLock') && typeof manualRefLock !== 'boolean') {
    rejections.push({ field: '$.manualRefLock', source: 'contract', reason: REJECTION_REASONS.CONTRACT_TYPE_INVALID });
  }
  const hash = hasOwn(contract, 'hash') ? contract.hash : undefined;
  if (hasOwn(contract, 'hash') && (typeof hash !== 'string' || !HASH_FORMAT_RE.test(hash))) {
    rejections.push({ field: '$.hash', source: 'contract', reason: REJECTION_REASONS.CONTRACT_TYPE_INVALID });
  }

  let capturedRejectionsArray = null;
  if (hasOwn(contract, 'rejections')) {
    const captured = captureArray(contract.rejections);
    if (captured === null || captured.length !== 0) {
      rejections.push({ field: '$.rejections', source: 'contract', reason: REJECTION_REASONS.REJECTIONS_NOT_EMPTY });
    } else {
      capturedRejectionsArray = captured; // always []
    }
  }

  let capturedIdentity = null;
  if (hasOwn(contract, 'identity')) {
    if (!isPlainObject(contract.identity)) {
      rejections.push({ field: '$.identity', source: 'contract', reason: REJECTION_REASONS.CONTRACT_TYPE_INVALID });
    } else {
      const before = rejections.length;
      const captured = sanitizeStoryStrict(contract.identity, rejections);
      if (rejections.length === before) capturedIdentity = captured;
    }
  }

  let capturedLayout = null;
  if (hasOwn(contract, 'layout')) {
    if (!isPlainObject(contract.layout)) {
      rejections.push({ field: '$.layout', source: 'contract', reason: REJECTION_REASONS.CONTRACT_TYPE_INVALID });
    } else {
      capturedLayout = validateBuiltLayout(contract.layout, rejections);
    }
  }

  let capturedProvenance = null;
  if (hasOwn(contract, 'provenance')) {
    if (!isPlainObject(contract.provenance)) {
      rejections.push({ field: '$.provenance', source: 'contract', reason: REJECTION_REASONS.CONTRACT_TYPE_INVALID });
    } else {
      capturedProvenance = captureProvenance(contract.provenance);
      if (capturedIdentity !== null && capturedLayout !== null) {
        validateProvenanceTruth(capturedIdentity, capturedLayout, capturedProvenance, rejections);
      }
    }
  }

  if (rejections.length > 0) return null;
  return {
    v,
    manualRefLock,
    identity: capturedIdentity,
    layout: capturedLayout,
    provenance: capturedProvenance,
    rejections: capturedRejectionsArray,
    hash,
  };
}

// ---------------------------------------------------------------------------
// PUBLIC canonicalizeContract/hashContract — deep-validate the complete raw
// full-contract schema (via validateContractStructure) BEFORE any
// coercion/default/copy/strip/hash. A malformed direct caller — missing/
// surplus/wrong-type fields, false provenance, an invalid enum, a
// non-neutral id, oversize slot/hierarchy input, a non-empty rejections
// array, a Proxy/exotic/symbol-keyed/accessor object or array at any nested
// boundary — fails closed (returns null). Canonicalization/hashing operate
// ONLY on the ONE captured snapshot validateContractStructure returns —
// `rawFullContract` itself is never read again. A genuinely well-formed
// contract (in particular, the builder's own output) passes cleanly and
// canonicalizes/hashes identically to the private trusted path, since both
// ultimately share canonicalizeTrusted's sort/serialize logic.
// ---------------------------------------------------------------------------
export function canonicalizeContract(rawFullContract) {
  const rejections = [];
  const snapshot = validateContractStructure(rawFullContract, rejections);
  if (rejections.length > 0 || snapshot === null) return null;
  return canonicalizeTrusted(snapshot);
}

export function hashContract(rawFullContract) {
  const canon = canonicalizeContract(rawFullContract);
  if (canon === null) return null;
  return sha256Hex(JSON.stringify(canon));
}

// ---------------------------------------------------------------------------
// Validator — fail-closed. Never throws for a data-shape problem: malformed
// shape, unknown/unexpected top-level field, deep-structural content
// defects (enum/neutral-id/geometry/duplicate/dangling/capacity — the SAME
// rules the builder enforces), false or surplus provenance, a non-empty
// rejections array, a Proxy/exotic/accessor object at any boundary, or a
// tamper check all resolve to { ok:false, reason, details }.
//
// `expectedHash` MUST be separately supplied by the caller from a trusted
// external source (e.g. an audit ledger written at build time via
// hashContract()) — a real SHA-256 hex digest (64 lowercase hex chars).
// Validation requires BOTH the embedded `candidate.hash` and a strict
// recompute over the candidate to equal that external value — a
// self-consistent candidate (embedded hash matches its own content) is NOT
// sufficient on its own. Structural validation (including provenance truth)
// runs regardless of, and before, any hash comparison, so a matching hash
// can never rescue false provenance or an otherwise-impossible state — and
// because `candidate` is captured into ONE trusted snapshot during that
// structural pass, the later hash recompute reads that snapshot, never
// `candidate` again, closing the TOCTOU window entirely.
// ---------------------------------------------------------------------------
function validateInternal(candidate, expectedHash) {
  if (expectedHash === undefined) return { ok: false, reason: 'EXPECTED_HASH_MISSING', details: {} };
  if (typeof expectedHash !== 'string' || !HASH_FORMAT_RE.test(expectedHash)) {
    return { ok: false, reason: 'EXPECTED_HASH_INVALID', details: {} };
  }

  const rejections = [];
  const snapshot = validateContractStructure(candidate, rejections);
  if (rejections.length > 0 || snapshot === null) {
    return { ok: false, reason: 'SCHEMA_VALIDATION_FAILED', details: { rejections } };
  }

  if (snapshot.hash !== expectedHash) {
    return { ok: false, reason: 'HASH_MISMATCH', details: { check: 'embedded_vs_expected' } };
  }
  const { hash: _storedHash, ...rest } = snapshot;
  const recomputed = hashTrusted(rest);
  if (recomputed !== expectedHash) {
    return { ok: false, reason: 'HASH_MISMATCH', details: { check: 'recompute_vs_expected' } };
  }

  return { ok: true, reason: null, details: {} };
}

export function validateContract(candidate, expectedHash) {
  try {
    return validateInternal(candidate, expectedHash);
  } catch (_err) {
    return { ok: false, reason: 'INTERNAL_ERROR', details: {} };
  }
}
