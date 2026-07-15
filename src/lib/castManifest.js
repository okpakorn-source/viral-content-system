// Cast Manifest — deterministic reconciliation CONTRACT for "who is in this news story."
// Pure by design: no filesystem/network IO, no Date.now()/new Date(), no Math.random(), no
// process.env, no other ambient globals. ROUND-6 policy update (deliberate, at explicit
// instruction): deterministic Node built-in imports ARE allowed when they add no
// nondeterminism of their own — `node:crypto` (pure synchronous hashing, no IO/state) and
// `node:util` (pure reflection helpers, e.g. types.isProxy) are used below for exactly this
// reason. IO, environment, wall-clock time, and randomness remain forbidden without exception.
//
// PURPOSE (pure foundation invoked ONLY by the default-OFF flag-gated ref-hero-v2 orchestrator):
// Two upstream extraction stages independently guess "who is in this story": compassBrain
// (compass.mainCharacters) and the /api/auto-cover "Analyze" stage (its own person
// extraction). They can disagree because neither reads the other's output. Downstream,
// templateV1PersonAuthority picks ONE deterministic hero and treats everyone else as
// competing candidates for a single reaction slot — a 3-person story can legally repeat
// person A, include person B, and silently omit person C.
//
// This module reconciles those (plus an optional explicit editorial `article` cast list)
// into one canonical, deterministic "cast manifest": who must appear, on what evidence,
// and whether there is a usable photo of each. It does NOT decide who goes in which slot —
// that is a later, separately-authorized phase. It also does NOT compute an assignment;
// the coverage/omission evaluators below only *grade* an assignment a caller proposes.
//
// DETERMINISM CONTRACT: reordering equivalent inputs (shuffled sourceEvidence, reordered
// people/candidates) must produce an identical canonical manifest and an identical hash.
// To guarantee this the builder itself sorts every array by a stable key before returning
// (not just at hash time) — see buildCastManifest() below. String sorting throughout uses
// plain `<`/`>` on JS strings (UTF-16 code-unit order), never localeCompare(), because
// localeCompare() is ICU/locale-dependent and would break cross-machine determinism.
//
// SECURITY/AUDIT HARDENING (this revision):
//  - mustRepresent recognizes explicit 'hero'-ranked role evidence or an explicit requiredCast
//    entry from ANY source, OR cross-source corroboration (a non-'context' mention from BOTH
//    'compass' AND 'analyze', role-less mentions included) — see the precise definition above
//    buildCastManifest()'s mustRepresent computation. A single source's lone explicit
//    'reaction' role, uncorroborated, is deliberately NOT sufficient by itself.
//  - buildCastManifest() has no `reference` parameter at all, by design: it is never
//    destructured, so a caller passing a `reference` field has that field silently and
//    completely ignored (proven by a determinism test — with/without an extra `reference`
//    key on the input object produces byte-identical output, including the hash).
//  - The returned manifest is deep-frozen. Mutation attempts throw (ESM is always strict
//    mode) rather than silently succeeding.
//  - Every evaluator (evaluateCastAssetHolds / evaluatePersonOmissions /
//    evaluateRepeatedIdentityCoverage) re-validates the manifest's structural shape and its
//    own recorded `hash` (plus a MANDATORY caller-supplied `opts.expectedHash` — a missing,
//    empty, or wrong-typed expectedHash is itself a rejection, never an optional/skippable
//    check) BEFORE computing anything, and recomputes every eligibility fact fresh from the
//    underlying six-field readiness data on each call — it never trusts a cached
//    `hasEligibleCandidate` / `eligible` shortcut boolean, because those booleans are captured
//    verbatim into the hash rather than re-derived by the hasher, so a self-consistent-but-
//    forged hash alone would not catch a forged shortcut (nor would it catch tamper re-signed
//    against its OWN recomputed hash instead of the caller's real trusted hash). On failure
//    these evaluators THROW a typed CastManifestError rather than returning a "no issue
//    found" value — a null/empty return here would be indistinguishable from a legitimate
//    all-clear, which would defeat the fail-closed goal. (Contrast with the sibling
//    `heroShotContract.js`, which can safely return tamper as data because every one of its
//    outcomes already carries an explicit `reason`/`accepted` field; two of these three
//    evaluators' normal-path shapes do not.)
//  - Alias conflicts (two people's alias rows both explicitly claiming the same normalized
//    alias with different canonical targets) are rejected with a typed, order-independent
//    CastManifestError rather than silently resolved "last row wins."
//  - Auto-generated candidateIds are derived from the candidate's own content, never from its
//    array index — stable under reordering (see the ROUND-3 note below for the current, fuller
//    definition of "content" and for what happens on a collision/duplicate).
//  - Any string field (name/role/alias/canonicalName/candidateId) containing a literal NUL
//    byte is rejected with a typed CastManifestError, never silently stripped.
//  - Raw structural validation (validateCastManifestStructure) is exact-shape: exact top-level
//    and nested key sets (no unknown/surplus/missing keys) and strict boolean typing on every
//    readiness field, checked BEFORE canonicalizeCastManifest/hashCastManifest ever run on the
//    manifest via assertCastManifestIntegrity — so malformed input (e.g. a coercible
//    `"true"`/`1` in place of a real boolean) can never be silently "cleaned up" into a
//    passing hash.
//  - ROUND-3 CORRECTIVE HARDENING (this revision): the exact-shape check above now goes all the
//    way down every nested object/array, not just top/person/candidate — sourceEvidence element
//    keys/types + `source` enum, alias elements as non-empty strings, acceptableSlotRoles as a
//    finite non-empty role enum, editorialRole against the same enum (or null), priority as a
//    positive integer, eligibleCandidateCount as an in-range integer, hasEligibleCandidate as a
//    real boolean, hold.holdType against HOLD_TYPES with personIds/canonicalNames as string
//    arrays, and unmatchedCandidates' candidateId/sourceAssetId/name typed exactly. Every
//    candidate now also carries a MANDATORY nonempty `sourceAssetId` (a stable identifier for
//    the underlying photo asset) — name+readiness alone could not distinguish two distinct
//    photos of the same person that happened to clear the same six gates, which used to collide
//    onto one auto-derived candidateId. Duplicate sourceAssetId, duplicate explicit candidateId,
//    and any derived-vs-derived or derived-vs-explicit candidateId collision are all rejected
//    fail-closed with a typed CastManifestError rather than silently accepted or resolved by
//    array order. The old delimiter-concatenated sort key (`${id}|${bit}|...` compared as a
//    plain string) has been replaced by a real field-by-field tuple comparator plus an
//    unambiguous length-prefixed serialization for hashing, because the delimiter-joined form
//    could invert the intended ordering whenever an id's own characters straddled the `|` byte.
//  - ROUND-4 CORRECTIVE HARDENING: sourceEvidence's own sort key had the identical delimiter
//    ambiguity (space-joined `${source} ${raw} ${role}`), now fixed the same way. The PUBLIC
//    canonicalizeCastManifest/hashCastManifest now validate the exact schema BEFORE any
//    coercion — a malformed direct call is rejected fail-closed rather than silently
//    canonicalized through `??`/`!!`/default-array coercions; buildCastManifest itself uses a
//    private trusted-payload path for its own pre-hash draft, which the public functions cannot
//    be used to bypass. Every field semantically required to be non-blank (candidateId,
//    sourceAssetId, personId, canonicalName, aliases, sourceEvidence.raw/role, hold.personIds/
//    canonicalNames, hash) now rejects whitespace-only strings, not just empty ones, with the
//    builder and the foreign-manifest validator sharing one definition of "non-blank."
//  - ROUND-5 CORRECTIVE HARDENING: personId used to be a bare 32-bit FNV1a hash — verified
//    during this review to have real, brute-force-findable collisions (two distinct names
//    hashed identically in under 5 seconds). personId is now a 128-bit digest (four
//    independently-seeded FNV1a32 passes concatenated — NOT cryptographic-grade SHA-256,
//    because this module's own "no imports" design invariant rules out `node:crypto` and a
//    hand-rolled SHA-256 would carry real correctness risk; see the note above
//    computePersonId's digest helper for the full tradeoff). The digest width alone is only
//    probabilistic, though — the actual fix is deterministic: buildCastManifest rejects a
//    personId collision between two distinct canonical keys at build time, and
//    validateCastManifestStructure recomputes and verifies personId === computePersonId
//    (canonicalName) for every person, so a foreign/forged manifest cannot assign a false
//    personId to a name (nor can two people share one, correctly-derived or not) and still
//    pass. People sorting now uses a total (personId, canonicalName) tuple comparator, matching
//    the same total-order discipline already used for candidates/sourceEvidence. Separately,
//    the exact-shape key check (hasExactKeys) has been replaced module-wide by
//    isExactPlainRecord: a descriptor-first check (Object.getOwnPropertyNames /
//    Object.getOwnPropertyDescriptor, never reading a value through a possible getter) that
//    also rejects arrays, non-plain prototypes (class/Date/Map/Set instances), symbol-keyed
//    surplus properties, non-enumerable surplus properties, and accessor (getter/setter)
//    properties standing in for a required field — none of which the old key-name-only check
//    could see.
//  - ROUND-6 CORRECTIVE HARDENING: personId and the manifest hash now use real, full SHA-256
//    (node:crypto), not a hand-rolled digest — see the note above computePersonId's helper for
//    why round 5's widened-FNV compromise has been superseded now that Node built-in imports are
//    deliberately allowed. Proxy values are rejected at every object AND array boundary (via
//    node:util's types.isProxy) before any reflection is attempted, since a Proxy's trap
//    handlers could otherwise lie to Object.getOwnPropertyDescriptor/getPrototypeOf the same way
//    they could lie to a direct property read. Arrays are now validated the same descriptor-first
//    way objects are (isExactPlainArray): dense canonical numeric indices plus `length` only, no
//    holes, no surplus/symbol/index-accessor properties. assertCastManifestIntegrity now returns
//    a deep-frozen, freshly-canonicalized snapshot of the manifest instead of nothing; every
//    evaluator uses ONLY that returned snapshot for the rest of its logic and never reads the
//    caller's original manifest object again after the integrity check — so even if the caller
//    still holds a reference to the object they passed in and mutates it afterward, or a
//    would-be-hostile getter that got through would have returned a different value later, the
//    evaluator's result is already fixed against the one-time verified copy.
//  - ROUND-7 CORRECTIVE HARDENING: assertCastManifestIntegrity used to call the public
//    hashCastManifest for its hash comparison (a second, independent validate+canonicalize pass)
//    and separately canonicalize a third time for its returned snapshot; it now captures the raw
//    manifest into one canonical payload and derives both the recomputed hash and the returned
//    snapshot from that single capture.
//  - ROUND-8 CORRECTIVE HARDENING: assertCastManifestIntegrity now performs a TRUE single-pass
//    capture — captureVerifiedManifest merges shape-checking and value-extraction into one walk
//    (reusing the same shared isExactPlainRecord/isExactPlainArray/isNonBlankString/
//    isStrictBoolean primitives everywhere else in this file already relies on), rather than
//    round 7's still-two-traversal "one validateCastManifestStructure(raw) call plus one
//    canonicalizeTrustedPayload(raw) call." Every field is read from the caller's manifest at
//    most once, at the exact point it is both checked and captured. Separately, the `assignment`
//    parameter graded by evaluatePersonOmissions/evaluateRepeatedIdentityCoverage now gets an
//    equivalent one-time, Proxy-rejecting, exact-shape capture at the evaluator boundary
//    (captureVerifiedAssignment) — a Proxy or an accessor property anywhere in the assignment
//    array/rows is rejected before any reflection/read, and a row's shape must match the exact
//    {slotId, personId} keys/types, so no attacker-controlled value from a malformed assignment
//    can ever reach repeatedPersonIds/uncoveredRequiredPersonIds or a thrown error's detail.
//    Finally, every trusted string field validated by the foreign-manifest path (canonicalName,
//    aliases, sourceEvidence.raw/role, candidateId, sourceAssetId, hold.personIds/canonicalNames,
//    hash) now rejects an embedded NUL byte or any other C0/DEL control character — the shared
//    isNonBlankString helper previously only checked trim-length, and a NUL byte is not
//    whitespace, so `"Li\0sa".trim().length > 0` was true and such a string passed untouched.
//  - ROUND-9 CORRECTIVE HARDENING: (1) the exact-record/array gates now have value-RETURNING
//    forms (captureExactPlainRecord/captureExactPlainArray) that hand back the captured descriptor
//    values, and captureVerifiedManifest consumes ONLY those — after its single
//    captureExactPlainRecord(manifest, ...) it never reads a property off the raw `manifest` graph
//    again (no `manifest.people`/`.hold`/`.hash` reread, no raw for-of/slice/every), so every field
//    is read exactly once, straight from its descriptor. (2) The `assignment` capture is now truly
//    fail-closed: a genuinely absent assignment (`undefined`, the evaluators' default) stays a
//    gradeable "nothing proposed" state, but null / a primitive / a non-exact (holey/surplus/
//    symbol/index-accessor) array, and primitive/null/non-plain rows, all THROW a typed generic
//    failure rather than silently becoming [] or being skipped; and every non-null personId must
//    belong to the already-verified manifest, so a well-shaped but UNKNOWN id is rejected before it
//    can reach repeatedPersonIds/uncoveredRequiredPersonIds — the thrown error carries a fixed code
//    and never echoes the attacker id. (3) ONE control policy end-to-end: the builder's own
//    assertNoNulByte now rejects the whole C0/DEL range (not just NUL), matching the foreign
//    validator exactly, and unmatchedCandidates[].name is control-checked in BOTH the direct
//    validateCastManifestStructure path and the single-capture path.

import { createHash } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

// =========================================================================
// Allowlists / constants
// =========================================================================

export const CAST_MANIFEST_VERSION = 1;

// The three independent upstream extraction sources this module reconciles.
export const SOURCES = Object.freeze(['article', 'compass', 'analyze']);

// Recognized editorial roles. `null` (unrecognized/unspecified) is a valid 4th state but is
// deliberately not part of this allowlist since it's the "no strong evidence" default.
export const EDITORIAL_ROLES = Object.freeze(['hero', 'reaction', 'context']);

// Typed reasons an *optional* (mustRepresent:false) person can be legitimately left out of
// a proposed assignment. Never a bare boolean/blank — every omission must carry one of these.
// Reserved for mustRepresent:false people ONLY — see evaluatePersonOmissions().
export const OMISSION_REASONS = Object.freeze(['low_priority', 'no_eligible_asset', 'slot_capacity_exhausted']);

// Manifest-level fail-closed HOLD types.
export const HOLD_TYPES = Object.freeze(['INSUFFICIENT_CAST_ASSETS']);

// Coverage-evaluator violation flags. Both can be present simultaneously — repetition is a
// SEPARATE, additional violation on top of missing coverage, never a prerequisite for it.
export const COVERAGE_FLAGS = Object.freeze([
  'REQUIRED_PERSON_UNCOVERED',
  'REPEATED_IDENTITY_BEFORE_FULL_COVERAGE',
]);

// Typed errorType values thrown by CastManifestError.
export const CAST_MANIFEST_ERROR_TYPES = Object.freeze([
  'NUL_BYTE_REJECTED',
  'ALIAS_CONFLICT',
  'INVALID_MANIFEST_STRUCTURE',
  'MANIFEST_HASH_MISMATCH',
  'CANDIDATE_ASSET_ID_MISSING',
  'DUPLICATE_SOURCE_ASSET_ID',
  'DUPLICATE_CANDIDATE_ID',
  'CANDIDATE_ID_COLLISION',
  'PERSON_ID_COLLISION',
]);

// The six boolean readiness fields accepted per candidate (already-computed evidence about
// a candidate photo — this module never inspects real images, it only combines booleans).
export const CANDIDATE_READINESS_FIELDS = Object.freeze([
  'searched', 'triaged', 'clean', 'highResolution', 'cropSafe', 'identityVerified',
]);

// Role synonyms accepted liberally from upstream sources, normalized to EDITORIAL_ROLES.
// 'named-subject' is explicitly called out by the fix spec as an editorial-hero-strength
// signal (alongside 'hero'/'main') that alone is enough to set mustRepresent:true.
const ROLE_SYNONYMS = {
  hero: ['hero', 'main', 'protagonist', 'subject', 'named-subject', 'lead'],
  reaction: ['reaction', 'support', 'secondary', 'co-star', 'costar'],
  context: ['context', 'background', 'mention', 'minor'],
};
const ROLE_RANK = { hero: 3, reaction: 2, context: 1 };

// =========================================================================
// Typed error
// =========================================================================

// All synchronous fail-closed rejections thrown by this module use this one typed error
// class, discriminated by `errorType` (see CAST_MANIFEST_ERROR_TYPES above).
export class CastManifestError extends Error {
  constructor(errorType, detail = null) {
    super(`castManifest: ${errorType}${detail ? ` (${detail})` : ''}`);
    this.name = 'CastManifestError';
    this.errorType = errorType;
    this.detail = detail;
  }
}

// =========================================================================
// Local deterministic helpers (module-private; do not import elsewhere)
// =========================================================================

// Same FNV-1a 32-bit pattern used by src/lib/refSlotContract.js — re-implemented locally
// per instructions (that file does not export it). Still used as-is for candidateId (round 3/4
// already close that identifier's collision risk a different way — mandatory sourceAssetId plus
// explicit build-time duplicate/collision rejection, see buildCastManifest below — so widening
// its hash width was not part of this round's ask).
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

// Round-6 corrective fix (supersedes round 5's widened-FNV compromise, at explicit instruction):
// a bare 32-bit FNV1a hash is NOT collision-resistant — verified empirically during round 5's
// review, a brute-force search over already-normalized-form strings found a genuine collision
// (two distinct names, "af l y" and "agnga", both hashing to 21081a8d) in under 5 seconds. Round
// 5 widened this to a 128-bit multi-seed FNV construction rather than import `node:crypto`,
// because the module's header at the time stated "no imports" as a design invariant. That policy
// has now been deliberately changed (see the header note above): deterministic, side-effect-free
// Node built-in imports are allowed, so personId now uses real, full (untruncated) SHA-256 via
// node:crypto — a genuinely cryptographically collision-resistant digest, not a hand-rolled
// approximation of one.
function sha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

// Ordinal (code-unit) string compare — deterministic across locales/machines. Used for every
// sort in this module instead of localeCompare()/default Array#sort coercion ambiguity.
function cmpStr(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
function sortByStr(arr, keyFn) {
  return arr.slice().sort((a, b) => cmpStr(keyFn(a), keyFn(b)));
}

// Round-3 corrective redesign of the old delimiter-concatenated `candidateSortKey`: that key
// joined `${candidateId}|${bit}|...` and sorted with plain code-unit string comparison. This
// could INVERT the intended candidateId-primary ordering whenever a candidateId's own
// characters straddled the '|' delimiter byte — e.g. candidateId "ab" sorted BEFORE candidateId
// "a", because ASCII 'b' (0x62) is less than '|' (0x7C), even though "a" < "ab" as a plain
// string/tuple comparison. Replaced with a real field-by-field tuple comparator that
// short-circuits on the first differing field, so no field's content can ever bleed into an
// adjacent field's comparison. Round-4: generalized to also compare a `null` field (used by
// sourceEvidence's `role`, which is legitimately nullable) as strictly distinct from — and
// always sorting before — any string, rather than falling through to `String(null)` === "null"
// which could otherwise collide with an actual role string that happened to read "null".
function compareTupleField(x, y) {
  if (x === null && y === null) return 0;
  if (x === null) return -1;
  if (y === null) return 1;
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return cmpStr(x, y);
}
function compareTuples(a, b) {
  for (let i = 0; i < a.length; i++) {
    const c = compareTupleField(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}
function sortByTuple(arr, tupleFn) {
  return arr.slice().sort((a, b) => compareTuples(tupleFn(a), tupleFn(b)));
}
// Readiness bits shared by every candidate tuple, in a fixed field order.
function readinessBits(r) {
  return [
    r.searched ? 1 : 0, r.triaged ? 1 : 0, r.clean ? 1 : 0,
    r.highResolution ? 1 : 0, r.cropSafe ? 1 : 0, r.identityVerified ? 1 : 0,
  ];
}
// Candidate tuple key for sorting a PERSON's own `candidates` array. sourceAssetId (round-3:
// now mandatory and manifest-wide unique — see buildCastManifest's duplicate/collision checks)
// is each row's true stable identity, so it alone already fully and deterministically orders
// the array; candidateId + readiness bits are included too as harmless additional tie-break
// fields for defense in depth.
function candidateTupleKey(c) {
  return [c.sourceAssetId, c.candidateId, ...readinessBits(c)];
}
// Unmatched-candidate tuple key: unlike a person's own candidates array, `name` has no implicit
// grouping here, so it is included explicitly as the primary sort field — the round-3 fix for
// the old key silently dropping `name` entirely (two different unmatched people could only be
// told apart by accidental array order before this).
function unmatchedCandidateTupleKey(c) {
  return [c.name || '', c.sourceAssetId, c.candidateId, ...readinessBits(c)];
}
// Round-4 corrective fix: sourceEvidence used to sort on a SPACE-concatenated string key
// (`${source} ${raw} ${role||''}`), which collides whenever a value in one field contains the
// separator character — e.g. {raw:'A', role:'B C'} and {raw:'A B', role:'C'} both produced the
// identical key "compass A B C", even though they are genuinely different entries. A real
// per-field tuple comparator has no such ambiguity: it never concatenates raw and role into one
// string, so no field's content can bleed across the (raw, role) boundary. `role` is kept as a
// literal `null` (not coerced to '') so compareTupleField's dedicated null-handling applies.
function sourceEvidenceTupleKey(e) {
  return [e.source, e.raw, e.role === undefined ? null : e.role];
}
// Round-5 corrective fix: people used to sort on personId alone (sortByStr, single string key).
// personId is now build-time-guaranteed unique (see buildCastManifest's collision check below),
// so this never actually ties in practice — but a real total field-by-field tuple, including
// canonicalName as a second field, is added anyway so input order structurally cannot leak
// through an equal-key tie under sortByStr's stable-sort fallback, matching the same total-order
// discipline already applied to candidates/sourceEvidence.
function personTupleKey(p) {
  return [p.personId, p.canonicalName];
}

// Unambiguous canonical tuple serialization for hashing/derivation: each field is
// length-prefixed (netstring-style: `${length}:${value}`), so no field's content — including a
// value that itself contains ':' or any other separator-like byte — can ever be mistaken for a
// field boundary. Used by deriveCandidateId below (which had the same class of ambiguity as the
// old plain `|`-delimited candidateSortKey until this fix).
function serializeCanonicalTuple(fields) {
  return fields.map((v) => { const s = String(v); return `${s.length}:${s}`; }).join('');
}

// Reject any string field containing a NUL byte or any other C0/DEL control character,
// fail-closed (never silently stripped — stripping could let two visually-different
// control-bearing strings normalize to the same thing, or otherwise smuggle content past
// matching logic).
//
// Round-9 corrective fix (ONE control policy end-to-end): this used to reject only a literal NUL
// (`\0`), while the foreign-manifest path (isNonBlankString → hasControlChar) rejected the whole
// C0 range plus DEL. That divergence meant the builder would ACCEPT e.g. a U+0001 in a name that
// the foreign validator would REJECT. It now uses the exact same hasControlChar predicate, so the
// builder and the foreign validator enforce one identical control-character policy. The errorType
// stays `NUL_BYTE_REJECTED` (its established, exported value) — it is the single typed signal for
// "a trusted string carried a forbidden control character," NUL or otherwise.
function assertNoNulByte(value, fieldLabel) {
  if (typeof value === 'string' && hasControlChar(value)) {
    throw new CastManifestError('NUL_BYTE_REJECTED', fieldLabel);
  }
}

// Normalized-string identity: trim + collapse internal whitespace + lowercase. No fuzzy/ML
// matching anywhere in this module — two names are "the same person" only if their
// normalized forms are byte-identical, or an explicit caller-supplied alias connects them.
export function normalizeCastName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function computePersonId(name) {
  const n = normalizeCastName(name);
  return n ? `person_${sha256Hex(n)}` : null;
}

function normalizeRoleToken(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  for (const canon of EDITORIAL_ROLES) {
    if (ROLE_SYNONYMS[canon].includes(t)) return canon;
  }
  return null;
}

function acceptableSlotRolesFor(editorialRole) {
  if (editorialRole === 'hero') return ['hero', 'reaction'];
  if (editorialRole === 'reaction') return ['reaction'];
  if (editorialRole === 'context') return ['context'];
  return ['reaction', 'context']; // unspecified named person: default capable set, never 'hero'
}

// eligible = AND-combination of all six readiness booleans. Documented explicitly per the
// spec: a candidate photo is usable only when every stage of the readiness pipeline has
// cleared it. Any single false (or missing/falsy) field makes the candidate ineligible.
// Reads ONLY the six raw readiness keys — it deliberately never looks at a candidate's own
// `eligible` field, so it cannot be fooled by a stale/forged shortcut boolean sitting next
// to the real data (see recomputeHasEligibleCandidate() below, which builds on this).
export function computeCandidateEligibility(readiness) {
  const r = readiness && typeof readiness === 'object' ? readiness : {};
  return CANDIDATE_READINESS_FIELDS.every((k) => r[k] === true);
}

// Fix #3: never trust a person's cached `hasEligibleCandidate` (or a candidate's cached
// `eligible`) boolean. Recompute from the underlying candidates' raw readiness fields fresh,
// every time. Used by every evaluator below instead of reading `person.hasEligibleCandidate`.
function recomputeHasEligibleCandidate(person) {
  const candidates = Array.isArray(person?.candidates) ? person.candidates : [];
  return candidates.some((c) => computeCandidateEligibility(c));
}

function buildAliasIndex(aliases) {
  const index = new Map(); // normalized alias -> normalized canonical key
  const display = new Map(); // normalized canonical key -> Set(raw canonicalName strings)
  if (!Array.isArray(aliases)) return { index, display };
  // aliasNorm -> Set(canonNorm) claimed for it, tracked independent of processing order, so
  // conflict detection below is content-derived rather than "last row wins" (fix #5).
  const claims = new Map();
  for (const a of aliases) {
    if (!a || typeof a !== 'object') continue;
    assertNoNulByte(a.alias, 'aliases[].alias');
    assertNoNulByte(a.canonicalName, 'aliases[].canonicalName');
    const aliasNorm = normalizeCastName(a.alias);
    const canonRaw = typeof a.canonicalName === 'string' ? a.canonicalName.trim() : '';
    const canonNorm = normalizeCastName(canonRaw);
    if (!aliasNorm || !canonNorm) continue;
    if (!claims.has(aliasNorm)) claims.set(aliasNorm, new Set());
    claims.get(aliasNorm).add(canonNorm);
    index.set(aliasNorm, canonNorm);
    if (!display.has(canonNorm)) display.set(canonNorm, new Set());
    display.get(canonNorm).add(canonRaw);
  }
  // Fix #5: two distinct people's alias rows genuinely claiming the same normalized alias
  // (different canonical targets) is ambiguous. Fail closed deterministically rather than
  // silently let whichever row happened to be processed last win (which would be
  // input-order-dependent and break the determinism contract). Detection itself is
  // content-derived (which aliasNorm keys map to >1 distinct canonNorm) so it produces the
  // identical rejection regardless of array order.
  const conflicted = sortByStr([...claims.entries()].filter(([, set]) => set.size > 1).map(([k]) => k), (s) => s);
  if (conflicted.length) {
    throw new CastManifestError('ALIAS_CONFLICT', conflicted.join(','));
  }
  return { index, display };
}

function canonicalKeyFor(raw, aliasIndex) {
  const n = normalizeCastName(raw);
  if (!n) return '';
  return aliasIndex.get(n) || n;
}

// Liberal extraction of `{name, role}` pairs from a list that may hold plain strings or
// objects with any of several field-name spellings (upstream stages are not standardized).
function extractNamesFromList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (typeof item === 'string') {
      assertNoNulByte(item, 'name');
      if (item.trim()) out.push({ name: item.trim(), role: null });
      continue;
    }
    if (item && typeof item === 'object') {
      const name = item.name ?? item.personName ?? item.label ?? item.character ?? item.characterName ?? null;
      const role = item.role ?? item.editorialRole ?? item.type ?? null;
      assertNoNulByte(name, 'name');
      assertNoNulByte(role, 'role');
      if (typeof name === 'string' && name.trim()) {
        out.push({ name: name.trim(), role: typeof role === 'string' && role.trim() ? role.trim() : null });
      }
    }
  }
  return out;
}

// Derive a stable auto-generated candidateId from the candidate's own canonical identity tuple
// (round-3 corrective redesign) — sourceAssetId + normalized name + all six readiness bits,
// unambiguously serialized (see serializeCanonicalTuple) — never from array position (which
// would collide/shuffle under reordering) and never from name+readiness alone (fix #6's
// original scope), because that collided whenever two DISTINCT photo assets for the same
// person happened to clear the same six readiness gates: the round-3 review found this
// empirically (two same-person candidates with identical readiness content derived the
// identical candidateId and silently coexisted under it). sourceAssetId is mandatory precisely
// so two distinct assets can never be indistinguishable here.
function deriveCandidateId(row) {
  const tuple = [row.sourceAssetId, row.normalizedName || '', ...readinessBits(row.readiness)];
  return `cand_${fnv1a32(serializeCanonicalTuple(tuple))}`;
}

// =========================================================================
// RECONCILER / BUILDER
// =========================================================================

/**
 * Reconcile explicit evidence from up to three named sources into a canonical, deterministic
 * cast manifest.
 *
 * @param {object} input
 * @param {object|null} input.article  Explicit editorial evidence, liberal shape:
 *   { requiredCast?: string[], cast?: Array<string|{name,role}> }
 * @param {object|null} input.compass  compassBrain output, liberal shape:
 *   { mainCharacters?: Array<{name,role}>, requiredCast?: string[] }
 * @param {object|null} input.analyze  /api/auto-cover Analyze output, liberal shape:
 *   { characters?: Array<string|{name,role}>, mainCharacter?: string|{name}, requiredCast?: string[] }
 * @param {Array<{alias:string, canonicalName:string}>} input.aliases  Explicit caller-supplied
 *   alias pairs (normalized-string equality only — no fuzzy/ML matching). Without an alias
 *   entry connecting two spellings, they are kept as two separate person records (fail-closed).
 * @param {Array<object>} input.candidates  Per-candidate-photo readiness evidence:
 *   { name, candidateId?, sourceAssetId, searched, triaged, clean, highResolution, cropSafe, identityVerified }
 *   `sourceAssetId` is MANDATORY (round-3 corrective fix): a nonempty, caller-supplied stable
 *   identifier for the underlying photo asset. name+readiness alone can never stand in for
 *   asset identity — two distinct photos of the same person that happen to clear the same six
 *   readiness gates would otherwise be indistinguishable. A missing/empty sourceAssetId, a
 *   duplicate sourceAssetId, a duplicate explicit candidateId, or any two rows whose final
 *   candidateId collides is rejected fail-closed with a typed CastManifestError — see the
 *   "Candidate identity resolution" block above the candidate-processing code below.
 *   `name` is resolved through the same normalization+alias mechanism as identity evidence.
 *   A candidate whose name does not resolve to any reconciled person is reported in
 *   `unmatchedCandidates` rather than silently dropped.
 *
 * There is deliberately NO `reference` parameter: a reference photo/description never gets a
 * vote on who "must" be in the story. If a caller passes a `reference` key anyway it is
 * simply not destructured and has zero effect on the output (see the determinism test that
 * proves an extra `reference` key produces a byte-identical manifest, including the hash).
 *
 * MUST-REPRESENT RULE (explicit/corroborated story-owned evidence only — fail-closed
 * default of false otherwise):
 *   mustRepresent := true  IF ANY OF
 *     (a) an explicit `requiredCast` entry names this person, from ANY of article/compass/
 *         analyze (an editorial staff pick, the strongest signal), OR
 *     (b) at least one source attaches an EXPLICIT editorial role token to this person that
 *         normalizes to 'hero' (see ROLE_SYNONYMS — covers analyze.mainCharacter's synthetic
 *         'hero' entry too). Source-agnostic: a compass.mainCharacters entry with role:'hero',
 *         an article.cast entry with an explicit hero-synonym role, or an analyze.characters
 *         entry with an explicit hero-synonym role all qualify equally. (Because 'hero' is
 *         the top-ranked role, editorialRole === 'hero' is an equivalent, cheaper way to
 *         express this same condition.) OR
 *     (c) CROSS-SOURCE CORROBORATION: this person has at least one non-'context',
 *         non-requiredCast entry from 'compass' AND at least one non-'context',
 *         non-requiredCast entry from 'analyze' — i.e. two independently-guessing sources
 *         both name this person, without either mention being explicitly labeled 'context'/a
 *         context synonym. Role-less mentions count toward this (normalizeRoleToken(null) is
 *         null, which is !== 'context'), so two sources both plainly naming someone — with no
 *         role token at all — is real corroborating evidence even though neither mention
 *         alone would qualify under (b).
 *   mustRepresent stays false for:
 *     - a name that appears in only ONE source with no role signal at all (e.g. a plain
 *       string in analyze.characters alone) — a role-less mention could be a passing
 *       background reference, so it is NOT treated as "explicit" by itself, and with only one
 *       source there is no corroboration either.
 *     - a name whose ONLY role evidence, from a single source, normalizes to a non-'hero',
 *       non-'context' role (e.g. a lone 'reaction') with no cross-source corroboration under
 *       (c) — this is a deliberate behavior change from an earlier revision, which treated
 *       ANY explicit non-'context' role from a single source as sufficient.
 *     - a name whose only role evidence normalizes to 'context', even if that 'context' label
 *       comes from both compass AND analyze (rule (c) explicitly excludes 'context'-labeled
 *       entries from counting as corroboration).
 *   `reference`-sourced input can never contribute to this signal because the function does
 *   not accept a `reference` field at all (see above).
 *
 * @returns {object} deep-frozen canonical manifest object (see canonicalizeCastManifest for
 *   the exact field set used for hashing/equality). Mutation attempts throw (strict ESM).
 * @throws {CastManifestError} on a NUL byte in any name/role/alias/candidateId field, or on
 *   a genuinely conflicting alias claim (see buildAliasIndex above).
 */
export function buildCastManifest({ article = null, compass = null, analyze = null, aliases = [], candidates = [] } = {}) {
  const rawEntries = [];

  const addEntries = (source, list, { requiredExplicit = false, forceRole = null } = {}) => {
    for (const { name, role } of extractNamesFromList(list)) {
      rawEntries.push({
        source,
        raw: name,
        role: forceRole || role || (requiredExplicit ? 'required-cast' : null),
        requiredExplicit,
      });
    }
  };

  if (article && typeof article === 'object') {
    addEntries('article', article.requiredCast, { requiredExplicit: true });
    addEntries('article', article.cast, {});
  }
  if (compass && typeof compass === 'object') {
    addEntries('compass', compass.mainCharacters, {});
    addEntries('compass', compass.requiredCast, { requiredExplicit: true });
  }
  if (analyze && typeof analyze === 'object') {
    addEntries('analyze', analyze.characters, {});
    addEntries('analyze', analyze.requiredCast, { requiredExplicit: true });
    const mc = analyze.mainCharacter;
    if (typeof mc === 'string' && mc.trim()) {
      assertNoNulByte(mc, 'analyze.mainCharacter');
      rawEntries.push({ source: 'analyze', raw: mc.trim(), role: 'hero', requiredExplicit: false });
    } else if (mc && typeof mc === 'object') {
      assertNoNulByte(mc.name, 'analyze.mainCharacter.name');
      const n = typeof mc.name === 'string' ? mc.name.trim() : '';
      if (n) rawEntries.push({ source: 'analyze', raw: n, role: 'hero', requiredExplicit: false });
    }
  }

  const { index: aliasIndex, display: displayIndex } = buildAliasIndex(aliases);

  // Group by canonical key (normalized name, or its explicit alias target). No fuzzy
  // matching: two spellings merge ONLY on exact normalized equality or an explicit alias.
  const groups = new Map();
  for (const e of rawEntries) {
    const key = canonicalKeyFor(e.raw, aliasIndex);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const people = [];
  for (const [key, entries] of groups) {
    const rawNames = [...new Set(entries.map((e) => e.raw))];
    // canonicalName: explicit alias-provided display name wins (lexicographically smallest
    // candidate if multiple alias rows disagree on casing); otherwise the lexicographically
    // smallest raw variant actually seen. Both rules are content-derived, never
    // insertion-order-derived, so this is stable under input reordering.
    const aliasDisplaySet = displayIndex.get(key);
    const canonicalName = aliasDisplaySet && aliasDisplaySet.size
      ? sortByStr([...aliasDisplaySet], (s) => s)[0]
      : sortByStr(rawNames, (s) => s)[0];
    const aliasesOut = sortByStr(rawNames.filter((n) => n !== canonicalName), (s) => s);
    const sourceEvidence = sortByTuple(
      entries.map((e) => ({ source: e.source, raw: e.raw, role: e.role || null })),
      sourceEvidenceTupleKey,
    );

    let editorialRole = null;
    let bestRank = -1;
    for (const e of entries) {
      const r = normalizeRoleToken(e.role);
      const rank = r ? ROLE_RANK[r] : -1;
      if (r && rank > bestRank) { bestRank = rank; editorialRole = r; }
    }

    // CRITICAL (fail-closed default): mustRepresent is true ONLY on explicit/corroborated
    // evidence — see the "MUST-REPRESENT RULE" doc block above buildCastManifest() for the
    // precise definition. Three independent qualifying conditions, any one sufficient:
    //   (a) an explicit requiredCast entry from ANY source;
    //   (b) an explicit 'hero'-ranked role from ANY source — editorialRole === 'hero', since
    //       'hero' always wins ROLE_RANK against every other token present for this person;
    //   (c) cross-source corroboration: at least one non-'context', non-requiredCast entry
    //       from 'compass' AND at least one non-'context', non-requiredCast entry from
    //       'analyze' (role-less entries count toward this — normalizeRoleToken(null) is
    //       null, which is !== 'context'). Reads the existing per-entry {source, raw, role,
    //       requiredExplicit} shape already collected in `entries` — no restructuring of the
    //       entry-collection pipeline.
    // A single source's role-less mention, or a single source's lone explicit 'reaction' role
    // with no corroboration, does NOT qualify. Every other named/background person defaults
    // to mustRepresent:false.
    const hasRequiredExplicit = entries.some((e) => e.requiredExplicit);
    const hasCompassCorroboration = entries.some(
      (e) => e.source === 'compass' && e.requiredExplicit === false && normalizeRoleToken(e.role) !== 'context',
    );
    const hasAnalyzeCorroboration = entries.some(
      (e) => e.source === 'analyze' && e.requiredExplicit === false && normalizeRoleToken(e.role) !== 'context',
    );
    const mustRepresent = hasRequiredExplicit
      || editorialRole === 'hero'
      || (hasCompassCorroboration && hasAnalyzeCorroboration);

    people.push({
      personId: computePersonId(key),
      canonicalKey: key,
      canonicalName,
      aliases: aliasesOut,
      sourceEvidence,
      editorialRole,
      mustRepresent,
      acceptableSlotRoles: acceptableSlotRolesFor(editorialRole),
      candidates: [],
      eligibleCandidateCount: 0,
      hasEligibleCandidate: false,
      priority: 0,
    });
  }

  // Round-5 corrective fix (still load-bearing after round 6's hash upgrade): `groups` is a Map
  // keyed by canonicalKey, so each distinct canonicalKey produces exactly one `people` entry by
  // construction — the ONLY way two entries could ever share a personId is a genuine SHA-256
  // collision between two DIFFERENT canonical keys (see sha256Hex above computePersonId).
  // Detected here, deterministically, before any sorting/canonicalization/coverage ever sees the
  // manifest, rather than left to silently produce a manifest where two distinct people are
  // indistinguishable to every downstream consumer keying off personId.
  const personIdToKey = new Map();
  for (const p of people) {
    const existingKey = personIdToKey.get(p.personId);
    if (existingKey !== undefined && existingKey !== p.canonicalKey) {
      throw new CastManifestError('PERSON_ID_COLLISION', `${p.personId}: "${existingKey}" vs "${p.canonicalKey}"`);
    }
    personIdToKey.set(p.personId, p.canonicalKey);
  }

  // =========================================================================
  // Candidate identity resolution (round-3 corrective redesign).
  //
  // sourceAssetId is now MANDATORY on every candidate: a nonempty, caller-supplied stable
  // identifier for the underlying photo asset. name+readiness alone can never serve as asset
  // identity — two genuinely different photos of the same person that happen to clear the same
  // six readiness gates would otherwise be indistinguishable (the exact collision the round-3
  // review found empirically: two same-person candidates with identical readiness content
  // derived the identical candidateId and silently coexisted under it).
  //
  // Three independent fail-closed checks run, in this order, over the FULL candidate set
  // (matched + unmatched together — candidateId is meant to be globally unique across the whole
  // manifest, not just within one person):
  //   1. Duplicate sourceAssetId anywhere is always rejected — it is each row's true stable
  //      identity, so a repeat is never legitimate within one manifest-build call.
  //   2. Duplicate EXPLICIT candidateId anywhere is always rejected — an explicit candidateId is
  //      a caller-asserted-unique key; a repeat contradicts that claim outright, even if by
  //      coincidence the rest of the row's content happens to match.
  //   3. Any two DIFFERENT rows (by sourceAssetId, guaranteed unique after check 1) landing on
  //      the SAME final candidateId — two auto-derived ids colliding, or an explicit id
  //      colliding with a different row's derived id — is rejected as a typed collision, rather
  //      than silently accepted or resolved by array order.
  // =========================================================================
  const candidateRows = [];
  if (Array.isArray(candidates)) {
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      assertNoNulByte(c.name, 'candidates[].name');
      assertNoNulByte(c.candidateId, 'candidates[].candidateId');
      assertNoNulByte(c.sourceAssetId, 'candidates[].sourceAssetId');
      // Round-4: shares isNonBlankString with validateCastManifestStructure below, so the
      // builder and the foreign-manifest validator enforce the identical "non-blank after
      // trim" policy for these identifier fields, not two independently-drifting checks.
      if (!isNonBlankString(c.sourceAssetId)) {
        throw new CastManifestError('CANDIDATE_ASSET_ID_MISSING', typeof c.name === 'string' ? c.name : undefined);
      }
      const sourceAssetId = c.sourceAssetId.trim();
      const readiness = {
        searched: c.searched === true,
        triaged: c.triaged === true,
        clean: c.clean === true,
        highResolution: c.highResolution === true,
        cropSafe: c.cropSafe === true,
        identityVerified: c.identityVerified === true,
      };
      const explicitCandidateId = isNonBlankString(c.candidateId) ? c.candidateId.trim() : null;
      const rawName = typeof c.name === 'string' ? c.name : null;
      candidateRows.push({
        sourceAssetId,
        explicitCandidateId,
        normalizedName: normalizeCastName(rawName),
        rawName,
        key: rawName ? canonicalKeyFor(rawName, aliasIndex) : '',
        readiness,
        eligible: computeCandidateEligibility(readiness),
      });
    }
  }

  // Check 1: duplicate sourceAssetId.
  const assetIdCounts = new Map();
  for (const row of candidateRows) assetIdCounts.set(row.sourceAssetId, (assetIdCounts.get(row.sourceAssetId) || 0) + 1);
  const dupeAssetIds = sortByStr(
    [...assetIdCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id),
    (s) => s,
  );
  if (dupeAssetIds.length) {
    throw new CastManifestError('DUPLICATE_SOURCE_ASSET_ID', dupeAssetIds.join(','));
  }

  // Check 2: duplicate explicit candidateId.
  const explicitIdCounts = new Map();
  for (const row of candidateRows) {
    if (!row.explicitCandidateId) continue;
    explicitIdCounts.set(row.explicitCandidateId, (explicitIdCounts.get(row.explicitCandidateId) || 0) + 1);
  }
  const dupeExplicitIds = sortByStr(
    [...explicitIdCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id),
    (s) => s,
  );
  if (dupeExplicitIds.length) {
    throw new CastManifestError('DUPLICATE_CANDIDATE_ID', dupeExplicitIds.join(','));
  }

  // Resolve final candidateId per row: explicit wins; otherwise content-derived from the
  // unambiguous canonical tuple (sourceAssetId + normalized name + all six readiness bits).
  for (const row of candidateRows) {
    row.candidateId = row.explicitCandidateId || deriveCandidateId(row);
  }

  // Check 3: any two rows (necessarily distinct sourceAssetId, per check 1) landing on the same
  // final candidateId.
  const idToAssetIds = new Map();
  for (const row of candidateRows) {
    if (!idToAssetIds.has(row.candidateId)) idToAssetIds.set(row.candidateId, []);
    idToAssetIds.get(row.candidateId).push(row.sourceAssetId);
  }
  const collidedIds = sortByStr(
    [...idToAssetIds.entries()].filter(([, assetIds]) => assetIds.length > 1).map(([id]) => id),
    (s) => s,
  );
  if (collidedIds.length) {
    throw new CastManifestError('CANDIDATE_ID_COLLISION', collidedIds.join(','));
  }

  // Attach per-candidate-photo readiness evidence to people / unmatchedCandidates.
  const peopleByKey = new Map(people.map((p) => [p.canonicalKey, p]));
  const unmatchedCandidates = [];
  for (const row of candidateRows) {
    const person = row.key ? peopleByKey.get(row.key) : null;
    const entry = { candidateId: row.candidateId, sourceAssetId: row.sourceAssetId, ...row.readiness, eligible: row.eligible };
    if (person) {
      person.candidates.push(entry);
    } else {
      unmatchedCandidates.push({ ...entry, name: row.rawName });
    }
  }
  for (const p of people) {
    p.eligibleCandidateCount = p.candidates.filter((c) => c.eligible).length;
    p.hasEligibleCandidate = p.eligibleCandidateCount > 0;
  }

  // Deterministic priority ranking (content-derived, not insertion-order-derived):
  // mustRepresent first, then editorial-role strength, then canonicalName as a stable
  // final tie-break. priority is a 1-based rank (1 = highest priority).
  const roleWeight = (r) => (r ? (ROLE_RANK[r] || 0) : 0);
  const ranked = people.slice().sort((a, b) => {
    const am = a.mustRepresent ? 1 : 0;
    const bm = b.mustRepresent ? 1 : 0;
    if (am !== bm) return bm - am;
    const aw = roleWeight(a.editorialRole);
    const bw = roleWeight(b.editorialRole);
    if (aw !== bw) return bw - aw;
    return cmpStr(a.canonicalName, b.canonicalName);
  });
  ranked.forEach((p, i) => { p.priority = i + 1; });

  // Final canonical people array: sorted by a total (personId, canonicalName) tuple so the
  // manifest itself (not just its hash) is identical regardless of input ordering, and — round-5
  // — input order structurally cannot leak through an equal-key tie (personId is already
  // build-time-unique per the collision check above; canonicalName is included as a genuine
  // second field anyway, matching the total-order discipline used for candidates/sourceEvidence).
  const finalPeople = sortByTuple(
    people.map((p) => ({
      personId: p.personId,
      canonicalName: p.canonicalName,
      aliases: p.aliases,
      sourceEvidence: p.sourceEvidence,
      editorialRole: p.editorialRole,
      priority: p.priority,
      mustRepresent: p.mustRepresent,
      acceptableSlotRoles: p.acceptableSlotRoles,
      candidates: sortByTuple(p.candidates, candidateTupleKey),
      eligibleCandidateCount: p.eligibleCandidateCount,
      hasEligibleCandidate: p.hasEligibleCandidate,
    })),
    personTupleKey,
  );

  // FAIL-CLOSED: any mustRepresent:true person with zero eligible candidates blocks the
  // whole manifest with a typed, named HOLD. Recomputed independently by
  // evaluateCastAssetHolds() too, so callers never have to trust this cached copy. (This
  // build-time computation itself is safe to read directly — unlike an evaluator receiving a
  // foreign manifest object, nothing here could have tampered with `p.candidates` between
  // its computation two lines above and this filter.)
  const insufficient = finalPeople.filter((p) => p.mustRepresent && !p.hasEligibleCandidate);
  const hold = insufficient.length
    ? {
      holdType: 'INSUFFICIENT_CAST_ASSETS',
      personIds: sortByStr(insufficient.map((p) => p.personId), (s) => s),
      canonicalNames: sortByStr(insufficient.map((p) => p.canonicalName), (s) => s),
    }
    : null;

  const manifest = {
    version: CAST_MANIFEST_VERSION,
    people: finalPeople,
    unmatchedCandidates: sortByTuple(unmatchedCandidates, unmatchedCandidateTupleKey),
    hold,
  };
  // Uses the PRIVATE trusted-payload hasher, not the public hashCastManifest: at this point
  // `manifest` has no `hash` key yet (it's about to be assigned one), so it would not pass the
  // public function's own schema gate (round-4 corrective fix) — that gate exists precisely to
  // stop foreign/malformed callers, not this module's own trusted, freshly-built draft.
  manifest.hash = hashTrustedPayload(manifest);
  // Fix #4: deep-freeze the returned manifest so a caller cannot mutate a person's readiness
  // flags or mustRepresent after the fact and have that silently accepted later. Combined
  // with the hash re-check every evaluator performs (fix #3), even a hypothetical bypass of
  // the freeze (e.g. a caller round-tripping through JSON.parse/stringify to get a mutable
  // plain-object copy) is caught: the copy's re-signed hash would have to match its
  // (tampered) content, which — as proven by a dedicated test — does not protect a forged
  // `hasEligibleCandidate`/`eligible` shortcut, which is exactly why evaluators recompute
  // eligibility from raw fields rather than relying on hash validity alone.
  return deepFreeze(manifest);
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

// =========================================================================
// CANONICALIZER / HASHER
// =========================================================================

// PRIVATE. Canonicalizes a TRUSTED payload — used only by buildCastManifest, on its own
// freshly-constructed, code-controlled draft manifest, BEFORE that draft has an embedded
// `hash` field yet. This is a genuine chicken-and-egg: the public gate below requires `hash`
// to already be present and valid, but the builder needs to canonicalize/hash its draft in
// order to PRODUCE that very `hash` field. Never exported — a caller supplying arbitrary or
// foreign data must go through the public, schema-gated canonicalizeCastManifest/
// hashCastManifest below instead, which cannot be bypassed this way (round-4 corrective fix).
function canonicalizeTrustedPayload(manifest) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const people = Array.isArray(m.people) ? m.people : [];
  const canonPeople = sortByTuple(
    people.map((p) => {
      const sourceEvidence = Array.isArray(p?.sourceEvidence) ? p.sourceEvidence : [];
      const candidates = Array.isArray(p?.candidates) ? p.candidates : [];
      return {
        personId: p?.personId ?? null,
        canonicalName: p?.canonicalName ?? null,
        aliases: sortByStr(Array.isArray(p?.aliases) ? p.aliases : [], (s) => s),
        sourceEvidence: sortByTuple(
          sourceEvidence.map((e) => ({ source: e?.source ?? null, raw: e?.raw ?? null, role: e?.role ?? null })),
          sourceEvidenceTupleKey,
        ),
        editorialRole: p?.editorialRole ?? null,
        priority: p?.priority ?? null,
        mustRepresent: !!p?.mustRepresent,
        acceptableSlotRoles: sortByStr(Array.isArray(p?.acceptableSlotRoles) ? p.acceptableSlotRoles : [], (s) => s),
        candidates: sortByTuple(
          candidates.map((c) => ({
            candidateId: c?.candidateId ?? null,
            sourceAssetId: c?.sourceAssetId ?? null,
            searched: !!c?.searched,
            triaged: !!c?.triaged,
            clean: !!c?.clean,
            highResolution: !!c?.highResolution,
            cropSafe: !!c?.cropSafe,
            identityVerified: !!c?.identityVerified,
            eligible: !!c?.eligible,
          })),
          candidateTupleKey,
        ),
        eligibleCandidateCount: p?.eligibleCandidateCount ?? 0,
        hasEligibleCandidate: !!p?.hasEligibleCandidate,
      };
    }),
    personTupleKey,
  );
  const unmatched = Array.isArray(m.unmatchedCandidates) ? m.unmatchedCandidates : [];
  const canonUnmatched = sortByTuple(
    unmatched.map((c) => ({
      candidateId: c?.candidateId ?? null,
      sourceAssetId: c?.sourceAssetId ?? null,
      name: c?.name ?? null,
      searched: !!c?.searched,
      triaged: !!c?.triaged,
      clean: !!c?.clean,
      highResolution: !!c?.highResolution,
      cropSafe: !!c?.cropSafe,
      identityVerified: !!c?.identityVerified,
      eligible: !!c?.eligible,
    })),
    unmatchedCandidateTupleKey,
  );
  const hold = m.hold && typeof m.hold === 'object'
    ? {
      holdType: m.hold.holdType ?? null,
      personIds: sortByStr(Array.isArray(m.hold.personIds) ? m.hold.personIds : [], (s) => s),
      canonicalNames: sortByStr(Array.isArray(m.hold.canonicalNames) ? m.hold.canonicalNames : [], (s) => s),
    }
    : null;
  return { version: m.version ?? null, people: canonPeople, unmatchedCandidates: canonUnmatched, hold };
}

function hashTrustedPayload(manifest) {
  // Round-6: full SHA-256 (node:crypto) over the canonical JSON form, not the old 32-bit FNV1a
  // — see the note above computePersonId's sha256Hex helper for the full rationale.
  return sha256Hex(JSON.stringify(canonicalizeTrustedPayload(manifest)));
}

/**
 * Canonical, hash-input form of a manifest: fixed field order, every array sorted by a
 * stable key (order never carries meaning). Ignores manifest.hash itself (no circularity).
 * Useful standalone for deep-equality assertions in tests.
 *
 * PUBLIC GATE (round-4 corrective fix): validates the manifest against the exact public
 * full-manifest schema (the same validateCastManifestStructure every evaluator uses) BEFORE
 * any `!!`/`??`/`String()`/default-array coercion runs. A malformed or foreign manifest is
 * rejected fail-closed with a typed CastManifestError rather than silently canonicalized
 * through those coercions. (buildCastManifest itself cannot go through this gate — at the
 * moment it needs to compute the embedded `hash`, the draft manifest does not have one yet;
 * see the private canonicalizeTrustedPayload/hashTrustedPayload above, which this function
 * delegates to only AFTER the gate has passed.)
 *
 * @throws {CastManifestError} errorType INVALID_MANIFEST_STRUCTURE if `manifest` does not
 *   match the exact public schema.
 */
export function canonicalizeCastManifest(manifest) {
  const structureError = validateCastManifestStructure(manifest);
  if (structureError) {
    throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', structureError);
  }
  return canonicalizeTrustedPayload(manifest);
}

/**
 * @throws {CastManifestError} errorType INVALID_MANIFEST_STRUCTURE if `manifest` does not
 *   match the exact public schema — see canonicalizeCastManifest above.
 */
export function hashCastManifest(manifest) {
  const structureError = validateCastManifestStructure(manifest);
  if (structureError) {
    throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', structureError);
  }
  return hashTrustedPayload(manifest);
}

// =========================================================================
// STRUCTURAL VALIDATION + INTEGRITY GATE
// (fix #3 — checked by every evaluator BEFORE any HOLD/coverage judgment is made)
// =========================================================================

// Exact top-level and nested key sets a well-formed manifest must have — no unknown/surplus
// key, no missing required key, at every level. Kept in sync with the object shapes
// buildCastManifest()/canonicalizeCastManifest() actually produce (see those functions).
const REQUIRED_TOP_LEVEL_KEYS = ['version', 'people', 'unmatchedCandidates', 'hold', 'hash'];
const REQUIRED_PERSON_KEYS = [
  'personId', 'canonicalName', 'aliases', 'sourceEvidence', 'editorialRole',
  'priority', 'mustRepresent', 'acceptableSlotRoles', 'candidates',
  'eligibleCandidateCount', 'hasEligibleCandidate',
];
const REQUIRED_CANDIDATE_KEYS = [
  'candidateId', 'sourceAssetId', 'searched', 'triaged', 'clean', 'highResolution', 'cropSafe', 'identityVerified', 'eligible',
];
const REQUIRED_UNMATCHED_CANDIDATE_KEYS = [
  'candidateId', 'sourceAssetId', 'name', 'searched', 'triaged', 'clean', 'highResolution', 'cropSafe', 'identityVerified', 'eligible',
];
const REQUIRED_HOLD_KEYS = ['holdType', 'personIds', 'canonicalNames'];
const REQUIRED_SOURCE_EVIDENCE_KEYS = ['source', 'raw', 'role'];

// Round-5 corrective fix: exact-shape "ordinary record" gate — REPLACES the old hasExactKeys,
// which only checked Object.keys() name membership. That sieve is blind to several ways a
// non-ordinary object can present the "right" key names while not actually being a plain data
// record: an array (whose keys are numeric strings — usually already fails the name-set check
// for this module's schemas, but not guaranteed in general), a class/Date/Map/Set/other
// exotic-prototype instance with the right own enumerable keys copied on, a symbol-keyed surplus
// property (invisible to Object.keys), a non-enumerable surplus property (also invisible to
// Object.keys, but a real own property), and — most subtly — a getter/setter accessor property
// standing in for a required field, which if ever READ during validation could execute arbitrary
// caller code with no guarantee the value read is the same on a later read (a TOCTOU trap).
//
// This never reads `obj[key]` and therefore never invokes a getter: Object.getOwnPropertyNames
// enumerates own string keys regardless of enumerability, and Object.getOwnPropertyDescriptor
// exposes a getter/setter as FUNCTION REFERENCES under `.get`/`.set` on the descriptor object —
// it does not call them. A key only passes if its descriptor is `enumerable` and has an own
// `'value'` (i.e. is a plain data property, never an accessor).
//
// Round-6 corrective fix: rejects a Proxy FIRST, before any reflection at all. A Proxy's trap
// handlers intercept getPrototypeOf/ownKeys/getOwnPropertyDescriptor too — a hostile Proxy could
// make all of the checks below look clean while still lying about the real underlying object (or
// returning a different answer on a later call). types.isProxy is itself trap-proof: it inspects
// the value's internal [[ProxyHandler]] slot directly, which a Proxy cannot intercept or spoof.
// Round-8/9: this is the descriptor-first, Proxy-rejecting, accessor-never-invoked exact-record
// gate, but it now RETURNS THE CAPTURED VALUES (round 9) rather than merely a boolean. Each field
// that passes is read exactly once — from its own-property DESCRIPTOR's `value` slot, never via
// `obj[key]` (so a getter is never invoked) — and that captured value is placed into the returned
// `values` map. Callers that go on to use the data (captureVerifiedManifest) consume ONLY this
// returned map and never touch the raw object again, so there is no second read of any field
// between "checked" and "used". Returns `null` on any shape violation.
function captureExactPlainRecord(obj, requiredKeys) {
  if (obj === null || typeof obj !== 'object') return null;
  if (nodeUtilTypes.isProxy(obj)) return null;
  if (Array.isArray(obj)) return null;
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(obj).length > 0) return null;
  const actual = Object.getOwnPropertyNames(obj); // own string keys, enumerable or not
  if (actual.length !== requiredKeys.length) return null;
  const required = new Set(requiredKeys);
  const values = {};
  for (const k of actual) {
    if (!required.has(k)) return null;
    const d = Object.getOwnPropertyDescriptor(obj, k);
    if (!d.enumerable || !('value' in d)) return null;
    values[k] = d.value; // single read, straight from the descriptor
  }
  return values;
}

// Boolean-returning wrapper retained for the direct-call foreign-manifest validator
// (validateCastManifestStructure) and other predicates. The single-capture integrity path uses
// captureExactPlainRecord directly so it can consume the returned values.
function isExactPlainRecord(obj, requiredKeys) {
  return captureExactPlainRecord(obj, requiredKeys) !== null;
}

// Round-6 corrective fix: arrays got the SAME "is it really an ordinary value" scrutiny objects
// did in round 5 — the old checks only ever did `Array.isArray(x)`, which says nothing about
// holes, surplus own properties (numeric-out-of-range, symbol, or otherwise), or an
// accessor/non-enumerable property masquerading as an index. Like isExactPlainRecord, this
// rejects a Proxy first (before any reflection) and never reads an element through `arr[i]` —
// it only inspects descriptors, so an accessor at an index is rejected without ever being
// invoked. A value only passes if it is a real Array-prototype array whose own string keys are
// EXACTLY the dense canonical index set `'0'..'length-1'` plus `'length'` itself, every index is
// a plain enumerable data property, and `length` itself is the standard non-enumerable data
// property every genuine array carries.
// Round-9: descriptor-first array gate that RETURNS THE CAPTURED ELEMENTS (a fresh, module-owned
// array of the index descriptors' `value` slots), or `null` on any violation. `length` is read
// from its own DESCRIPTOR's value (not `arr.length`), and every element is read from its index
// descriptor's `value` (never `arr[i]`), so an index accessor is rejected without being invoked
// and no element is ever read twice. The returned array is a new plain array the caller owns.
function captureExactPlainArray(arr) {
  if (arr === null || typeof arr !== 'object') return null;
  if (nodeUtilTypes.isProxy(arr)) return null;
  if (!Array.isArray(arr)) return null;
  if (Object.getPrototypeOf(arr) !== Array.prototype) return null;
  if (Object.getOwnPropertySymbols(arr).length > 0) return null;
  const lengthDesc = Object.getOwnPropertyDescriptor(arr, 'length');
  if (!lengthDesc || lengthDesc.enumerable || !('value' in lengthDesc)) return null;
  const n = lengthDesc.value; // read length from its descriptor, not via arr.length
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
  const names = Object.getOwnPropertyNames(arr); // e.g. ['0','1','length'] for a 2-element array
  if (names.length !== n + 1) return null; // no holes, no surplus/out-of-range keys
  const nameSet = new Set(names);
  const items = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = String(i);
    if (!nameSet.has(k)) return null;
    const d = Object.getOwnPropertyDescriptor(arr, k);
    if (!d.enumerable || !('value' in d)) return null;
    items[i] = d.value; // single read, straight from the descriptor
  }
  return items;
}

// Boolean-returning wrapper retained for validateCastManifestStructure / isStringArray.
function isExactPlainArray(arr) {
  return captureExactPlainArray(arr) !== null;
}

// Strict boolean check for a candidate/unmatchedCandidate readiness-style field: must be
// typeof === 'boolean' exactly. Rejects (fail-closed) a coercible-but-not-real boolean like
// the string "true", the number 1, or null — fix #3d. This is what stops malformed input from
// being silently "cleaned up" by canonicalizeCastManifest's `!!c?.field` coercion into a
// passing hash: this check runs in validateCastManifestStructure(), which
// assertCastManifestIntegrity() always calls BEFORE canonicalizeCastManifest/hashCastManifest
// ever touch the manifest.
function isStrictBoolean(v) {
  return typeof v === 'boolean';
}

// Round-4 corrective fix: a string is only genuinely "non-empty" here if it has real content
// after trimming — `"   "` has length > 0 but is semantically blank. Used for every field that
// is semantically required to be a real, non-blank identifier or name (candidateId,
// sourceAssetId, personId, canonicalName, aliases, sourceEvidence.raw/role, hold.personIds/
// canonicalNames, hash). Shared by BOTH the builder (which already trimmed these on the way in)
// and this foreign-manifest validator, so the two enforce the identical policy.
//
// Round-8 corrective fix: also rejects a literal NUL byte (U+0000) or any other C0 control
// character (U+0001–U+001F, U+007F). The builder already rejects NUL via the separate
// assertNoNulByte() calls made on its own raw inputs, but the FOREIGN-manifest path
// (validateCastManifestStructure, and therefore the public canonicalizeCastManifest/
// hashCastManifest/assertCastManifestIntegrity and every evaluator) had no equivalent check —
// `"Li\0sa".trim().length > 0` is true (NUL is not whitespace), so a NUL- or control-character-
// bearing string previously passed this check untouched and would have been hashed/evaluated as
// if it were clean. Every field that funnels through this one shared helper is covered by a
// single fix: canonicalName, personId, aliases, sourceEvidence.raw/role, candidateId,
// sourceAssetId (both person-scoped and unmatched), hold.personIds/canonicalNames, and hash.
const CONTROL_CHAR_MAX_CODE = 31; // C0 control range 0x00-0x1F
const DEL_CHAR_CODE = 127; // 0x7F
function hasControlChar(v) {
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i);
    if (code <= CONTROL_CHAR_MAX_CODE || code === DEL_CHAR_CODE) return true;
  }
  return false;
}
function isNonBlankString(v) {
  return typeof v === 'string' && v.trim().length > 0 && !hasControlChar(v);
}

// Exact-shape helper: an array all of whose elements are non-blank strings — used for aliases /
// hold.personIds / hold.canonicalNames, none of which were previously checked past "is it an
// Array" (round 3) or past "non-empty by length" (round 4 — whitespace-only elements now
// rejected too, via isNonBlankString). Round 6: the array-ness check itself is now
// isExactPlainArray, not bare Array.isArray, so a Proxy/holey/accessor-laden array is rejected
// here too, not just a non-array value.
function isStringArray(arr) {
  return captureStringArray(arr) !== null;
}

// Round-9: capturing counterpart of isStringArray — returns the captured element array (all
// verified non-blank, control-free strings) or null. Consumes captureExactPlainArray's captured
// items, so elements are read once from descriptors; the single-capture integrity path uses this
// to obtain hold.personIds/canonicalNames and person.aliases without a second raw traversal.
function captureStringArray(arr) {
  const items = captureExactPlainArray(arr);
  if (items === null) return null;
  for (const v of items) {
    if (!isNonBlankString(v)) return null;
  }
  return items;
}

/**
 * Structural schema check only (no hash involved). Returns a short typed reason string, or
 * null if the manifest looks well-formed enough to evaluate. Exact-shape (fix #3): rejects any
 * unknown/surplus/missing key at the top level or in any nested person/candidate/
 * unmatchedCandidate/hold object, and requires every readiness field to be a real boolean
 * (never a coercible truthy/falsy stand-in).
 */
export function validateCastManifestStructure(manifest) {
  if (!manifest || typeof manifest !== 'object') return 'NOT_AN_OBJECT';
  if (!isExactPlainRecord(manifest, REQUIRED_TOP_LEVEL_KEYS)) return 'TOP_LEVEL_KEYS_INVALID';
  if (manifest.version !== CAST_MANIFEST_VERSION) return 'VERSION_INVALID';
  if (!isExactPlainArray(manifest.people)) return 'PEOPLE_NOT_ARRAY';
  if (!isExactPlainArray(manifest.unmatchedCandidates)) return 'UNMATCHED_CANDIDATES_NOT_ARRAY';
  if (manifest.hold !== null && typeof manifest.hold !== 'object') return 'HOLD_NOT_OBJECT_OR_NULL';
  if (manifest.hold !== null) {
    if (!isExactPlainRecord(manifest.hold, REQUIRED_HOLD_KEYS)) return 'HOLD_KEYS_INVALID';
    if (typeof manifest.hold.holdType !== 'string' || !HOLD_TYPES.includes(manifest.hold.holdType)) return 'HOLD_TYPE_INVALID';
    if (!isStringArray(manifest.hold.personIds)) return 'HOLD_PERSON_IDS_INVALID';
    if (!isStringArray(manifest.hold.canonicalNames)) return 'HOLD_CANONICAL_NAMES_INVALID';
  }
  if (!isNonBlankString(manifest.hash)) return 'HASH_MISSING';
  // Round-5 corrective fix: a deterministic personId->seen map, checked BEFORE any
  // sorting/canonicalization/coverage ever runs, so a forged foreign manifest cannot assign the
  // same personId to two different people and have that pass through to the evaluators.
  const seenPersonIds = new Set();
  for (const p of manifest.people) {
    if (!p || typeof p !== 'object') return 'PERSON_NOT_OBJECT';
    if (!isExactPlainRecord(p, REQUIRED_PERSON_KEYS)) return 'PERSON_KEYS_INVALID';
    if (!isNonBlankString(p.personId)) return 'PERSON_ID_INVALID';
    if (!isNonBlankString(p.canonicalName)) return 'CANONICAL_NAME_INVALID';
    // Round-5: recompute-and-verify, not just self-consistency. personId must equal the true
    // deterministic derivation from THIS person's own canonicalName — a forged manifest cannot
    // just assign an arbitrary (even internally-plausible-looking) personId to an arbitrary
    // name, and two different people can never both pass this check under the same personId
    // unless their names truly do collide under real SHA-256 (round 6 — cryptographically
    // infeasible; see the sha256Hex documentation above computePersonId).
    if (p.personId !== computePersonId(p.canonicalName)) return 'PERSON_ID_NAME_MISMATCH';
    if (seenPersonIds.has(p.personId)) return 'PERSON_ID_DUPLICATE';
    seenPersonIds.add(p.personId);
    if (typeof p.mustRepresent !== 'boolean') return 'MUST_REPRESENT_NOT_BOOLEAN';
    if (p.editorialRole !== null && !EDITORIAL_ROLES.includes(p.editorialRole)) return 'EDITORIAL_ROLE_INVALID';
    if (!Number.isInteger(p.priority) || p.priority < 1) return 'PRIORITY_INVALID';
    if (typeof p.hasEligibleCandidate !== 'boolean') return 'HAS_ELIGIBLE_CANDIDATE_NOT_BOOLEAN';
    if (!isExactPlainArray(p.candidates)) return 'PERSON_CANDIDATES_NOT_ARRAY';
    if (!Number.isInteger(p.eligibleCandidateCount) || p.eligibleCandidateCount < 0 || p.eligibleCandidateCount > p.candidates.length) {
      return 'ELIGIBLE_CANDIDATE_COUNT_INVALID';
    }
    if (!isExactPlainArray(p.sourceEvidence)) return 'SOURCE_EVIDENCE_NOT_ARRAY';
    for (const e of p.sourceEvidence) {
      if (!e || typeof e !== 'object') return 'SOURCE_EVIDENCE_ELEMENT_NOT_OBJECT';
      if (!isExactPlainRecord(e, REQUIRED_SOURCE_EVIDENCE_KEYS)) return 'SOURCE_EVIDENCE_KEYS_INVALID';
      if (typeof e.source !== 'string' || !SOURCES.includes(e.source)) return 'SOURCE_EVIDENCE_SOURCE_INVALID';
      if (!isNonBlankString(e.raw)) return 'SOURCE_EVIDENCE_RAW_INVALID';
      if (e.role !== null && !isNonBlankString(e.role)) return 'SOURCE_EVIDENCE_ROLE_INVALID';
    }
    if (!isStringArray(p.aliases)) return 'ALIASES_INVALID';
    if (!isExactPlainArray(p.acceptableSlotRoles) || p.acceptableSlotRoles.length === 0
      || !p.acceptableSlotRoles.every((r) => EDITORIAL_ROLES.includes(r))) {
      return 'ACCEPTABLE_SLOT_ROLES_INVALID';
    }
    for (const c of p.candidates) {
      if (!c || typeof c !== 'object') return 'CANDIDATE_NOT_OBJECT';
      if (!isExactPlainRecord(c, REQUIRED_CANDIDATE_KEYS)) return 'CANDIDATE_KEYS_INVALID';
      if (!isNonBlankString(c.candidateId)) return 'CANDIDATE_ID_INVALID';
      if (!isNonBlankString(c.sourceAssetId)) return 'CANDIDATE_SOURCE_ASSET_ID_INVALID';
      for (const field of CANDIDATE_READINESS_FIELDS) {
        if (!isStrictBoolean(c[field])) return 'CANDIDATE_READINESS_NOT_BOOLEAN';
      }
      if (!isStrictBoolean(c.eligible)) return 'CANDIDATE_ELIGIBLE_NOT_BOOLEAN';
    }
  }
  for (const u of manifest.unmatchedCandidates) {
    if (!u || typeof u !== 'object') return 'UNMATCHED_CANDIDATE_NOT_OBJECT';
    if (!isExactPlainRecord(u, REQUIRED_UNMATCHED_CANDIDATE_KEYS)) return 'UNMATCHED_CANDIDATE_KEYS_INVALID';
    if (!isNonBlankString(u.candidateId)) return 'UNMATCHED_CANDIDATE_ID_INVALID';
    if (!isNonBlankString(u.sourceAssetId)) return 'UNMATCHED_CANDIDATE_SOURCE_ASSET_ID_INVALID';
    // Round-9: close unmatchedCandidates[].name in the direct-call foreign path too — a control
    // character here is rejected the same way it is in the single-capture path and the builder.
    if (u.name !== null && (typeof u.name !== 'string' || hasControlChar(u.name))) return 'UNMATCHED_CANDIDATE_NAME_INVALID';
    for (const field of CANDIDATE_READINESS_FIELDS) {
      if (!isStrictBoolean(u[field])) return 'UNMATCHED_CANDIDATE_READINESS_NOT_BOOLEAN';
    }
    if (!isStrictBoolean(u.eligible)) return 'UNMATCHED_CANDIDATE_ELIGIBLE_NOT_BOOLEAN';
  }
  return null;
}

// ROUND-8 corrective fix (true one-capture integrity): rounds 6-7 still called two SEPARATE
// top-level orchestration passes over the raw manifest — validateCastManifestStructure (shape
// check only, builds no value) and canonicalizeTrustedPayload (value capture, assumes trusted
// input). Even though round 7 made both derive the SAME recomputedHash/returned-snapshot (so
// the specific "hash vs. snapshot divergence" bug was already closed), there were still two
// independent walks of `manifest`. This function merges shape-checking and value-capture into
// ONE walk: at every level it calls the SAME shared, already-proven-safe primitives this module
// uses everywhere else (isExactPlainRecord / isExactPlainArray / isNonBlankString /
// isStrictBoolean — never duplicated, only reused), and the instant a field passes its check,
// its value is copied into the capture being built, in that same step. A field is read from
// `manifest` AT MOST ONCE, at the exact point it is both checked and captured.
// Returns `{ error }` on the first failure (no partial capture is used), or
// `{ snapshot, recomputedHash, storedHash }` on success — never exported; assertCastManifestIntegrity
// is its only caller.
function captureVerifiedManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object') return { error: 'NOT_AN_OBJECT' };
  // THE ONLY descriptor walk of the raw `manifest` object itself. `top` is a fresh module-owned
  // values map (round-9 capture helpers return the descriptor `value` of each field, never
  // reached through `manifest[key]`). Everything below reads from `top` and from the results of
  // capturing top.* sub-graphs — the identifier `manifest` never appears again with a property
  // access, so no field is ever read from the raw graph twice (the source-guard test enforces
  // exactly this).
  const top = captureExactPlainRecord(manifest, REQUIRED_TOP_LEVEL_KEYS);
  if (top === null) return { error: 'TOP_LEVEL_KEYS_INVALID' };
  if (top.version !== CAST_MANIFEST_VERSION) return { error: 'VERSION_INVALID' };
  const peopleItems = captureExactPlainArray(top.people);
  if (peopleItems === null) return { error: 'PEOPLE_NOT_ARRAY' };
  const unmatchedItems = captureExactPlainArray(top.unmatchedCandidates);
  if (unmatchedItems === null) return { error: 'UNMATCHED_CANDIDATES_NOT_ARRAY' };
  if (top.hold !== null && typeof top.hold !== 'object') return { error: 'HOLD_NOT_OBJECT_OR_NULL' };

  let holdCapture = null;
  if (top.hold !== null) {
    const hold = captureExactPlainRecord(top.hold, REQUIRED_HOLD_KEYS);
    if (hold === null) return { error: 'HOLD_KEYS_INVALID' };
    if (typeof hold.holdType !== 'string' || !HOLD_TYPES.includes(hold.holdType)) return { error: 'HOLD_TYPE_INVALID' };
    const holdPersonIds = captureStringArray(hold.personIds);
    if (holdPersonIds === null) return { error: 'HOLD_PERSON_IDS_INVALID' };
    const holdCanonicalNames = captureStringArray(hold.canonicalNames);
    if (holdCanonicalNames === null) return { error: 'HOLD_CANONICAL_NAMES_INVALID' };
    holdCapture = {
      holdType: hold.holdType,
      personIds: sortByStr(holdPersonIds, (s) => s),
      canonicalNames: sortByStr(holdCanonicalNames, (s) => s),
    };
  }

  if (!isNonBlankString(top.hash)) return { error: 'HASH_MISSING' };
  const storedHash = top.hash;
  const version = top.version;

  const peopleCapture = [];
  const seenPersonIds = new Set();
  for (const rawP of peopleItems) {
    if (rawP === null || typeof rawP !== 'object') return { error: 'PERSON_NOT_OBJECT' };
    const p = captureExactPlainRecord(rawP, REQUIRED_PERSON_KEYS);
    if (p === null) return { error: 'PERSON_KEYS_INVALID' };
    if (!isNonBlankString(p.personId)) return { error: 'PERSON_ID_INVALID' };
    if (!isNonBlankString(p.canonicalName)) return { error: 'CANONICAL_NAME_INVALID' };
    if (p.personId !== computePersonId(p.canonicalName)) return { error: 'PERSON_ID_NAME_MISMATCH' };
    if (seenPersonIds.has(p.personId)) return { error: 'PERSON_ID_DUPLICATE' };
    seenPersonIds.add(p.personId);
    if (typeof p.mustRepresent !== 'boolean') return { error: 'MUST_REPRESENT_NOT_BOOLEAN' };
    if (p.editorialRole !== null && !EDITORIAL_ROLES.includes(p.editorialRole)) return { error: 'EDITORIAL_ROLE_INVALID' };
    if (!Number.isInteger(p.priority) || p.priority < 1) return { error: 'PRIORITY_INVALID' };
    if (typeof p.hasEligibleCandidate !== 'boolean') return { error: 'HAS_ELIGIBLE_CANDIDATE_NOT_BOOLEAN' };
    const candidateItems = captureExactPlainArray(p.candidates);
    if (candidateItems === null) return { error: 'PERSON_CANDIDATES_NOT_ARRAY' };
    if (!Number.isInteger(p.eligibleCandidateCount) || p.eligibleCandidateCount < 0 || p.eligibleCandidateCount > candidateItems.length) {
      return { error: 'ELIGIBLE_CANDIDATE_COUNT_INVALID' };
    }
    const sourceEvidenceItems = captureExactPlainArray(p.sourceEvidence);
    if (sourceEvidenceItems === null) return { error: 'SOURCE_EVIDENCE_NOT_ARRAY' };

    const sourceEvidenceCapture = [];
    for (const rawE of sourceEvidenceItems) {
      if (rawE === null || typeof rawE !== 'object') return { error: 'SOURCE_EVIDENCE_ELEMENT_NOT_OBJECT' };
      const e = captureExactPlainRecord(rawE, REQUIRED_SOURCE_EVIDENCE_KEYS);
      if (e === null) return { error: 'SOURCE_EVIDENCE_KEYS_INVALID' };
      if (typeof e.source !== 'string' || !SOURCES.includes(e.source)) return { error: 'SOURCE_EVIDENCE_SOURCE_INVALID' };
      if (!isNonBlankString(e.raw)) return { error: 'SOURCE_EVIDENCE_RAW_INVALID' };
      if (e.role !== null && !isNonBlankString(e.role)) return { error: 'SOURCE_EVIDENCE_ROLE_INVALID' };
      sourceEvidenceCapture.push({ source: e.source, raw: e.raw, role: e.role });
    }

    const aliasesItems = captureStringArray(p.aliases);
    if (aliasesItems === null) return { error: 'ALIASES_INVALID' };
    const aliasesCapture = sortByStr(aliasesItems, (s) => s);

    const acceptableSlotRolesItems = captureExactPlainArray(p.acceptableSlotRoles);
    if (acceptableSlotRolesItems === null || acceptableSlotRolesItems.length === 0
      || !acceptableSlotRolesItems.every((r) => EDITORIAL_ROLES.includes(r))) {
      return { error: 'ACCEPTABLE_SLOT_ROLES_INVALID' };
    }
    const acceptableSlotRolesCapture = sortByStr(acceptableSlotRolesItems, (s) => s);

    const candidatesCapture = [];
    for (const rawC of candidateItems) {
      if (rawC === null || typeof rawC !== 'object') return { error: 'CANDIDATE_NOT_OBJECT' };
      const c = captureExactPlainRecord(rawC, REQUIRED_CANDIDATE_KEYS);
      if (c === null) return { error: 'CANDIDATE_KEYS_INVALID' };
      if (!isNonBlankString(c.candidateId)) return { error: 'CANDIDATE_ID_INVALID' };
      if (!isNonBlankString(c.sourceAssetId)) return { error: 'CANDIDATE_SOURCE_ASSET_ID_INVALID' };
      for (const field of CANDIDATE_READINESS_FIELDS) {
        if (!isStrictBoolean(c[field])) return { error: 'CANDIDATE_READINESS_NOT_BOOLEAN' };
      }
      if (!isStrictBoolean(c.eligible)) return { error: 'CANDIDATE_ELIGIBLE_NOT_BOOLEAN' };
      candidatesCapture.push({
        candidateId: c.candidateId, sourceAssetId: c.sourceAssetId,
        searched: c.searched, triaged: c.triaged, clean: c.clean,
        highResolution: c.highResolution, cropSafe: c.cropSafe, identityVerified: c.identityVerified,
        eligible: c.eligible,
      });
    }

    peopleCapture.push({
      personId: p.personId,
      canonicalName: p.canonicalName,
      aliases: aliasesCapture,
      sourceEvidence: sortByTuple(sourceEvidenceCapture, sourceEvidenceTupleKey),
      editorialRole: p.editorialRole,
      priority: p.priority,
      mustRepresent: p.mustRepresent,
      acceptableSlotRoles: acceptableSlotRolesCapture,
      candidates: sortByTuple(candidatesCapture, candidateTupleKey),
      eligibleCandidateCount: p.eligibleCandidateCount,
      hasEligibleCandidate: p.hasEligibleCandidate,
    });
  }

  const unmatchedCapture = [];
  for (const rawU of unmatchedItems) {
    if (rawU === null || typeof rawU !== 'object') return { error: 'UNMATCHED_CANDIDATE_NOT_OBJECT' };
    const u = captureExactPlainRecord(rawU, REQUIRED_UNMATCHED_CANDIDATE_KEYS);
    if (u === null) return { error: 'UNMATCHED_CANDIDATE_KEYS_INVALID' };
    if (!isNonBlankString(u.candidateId)) return { error: 'UNMATCHED_CANDIDATE_ID_INVALID' };
    if (!isNonBlankString(u.sourceAssetId)) return { error: 'UNMATCHED_CANDIDATE_SOURCE_ASSET_ID_INVALID' };
    // Round-9: `name` may legitimately be null or an empty string (it is a raw display name kept
    // only for reporting, never a required identifier), but it must never carry a C0/DEL control
    // character — the same one-policy rejection the builder now applies to it (via assertNoNulByte,
    // broadened to control chars in round 9). This closes unmatchedCandidates[].name in the
    // foreign path too, not just the builder.
    if (u.name !== null && (typeof u.name !== 'string' || hasControlChar(u.name))) return { error: 'UNMATCHED_CANDIDATE_NAME_INVALID' };
    for (const field of CANDIDATE_READINESS_FIELDS) {
      if (!isStrictBoolean(u[field])) return { error: 'UNMATCHED_CANDIDATE_READINESS_NOT_BOOLEAN' };
    }
    if (!isStrictBoolean(u.eligible)) return { error: 'UNMATCHED_CANDIDATE_ELIGIBLE_NOT_BOOLEAN' };
    unmatchedCapture.push({
      candidateId: u.candidateId, sourceAssetId: u.sourceAssetId, name: u.name,
      searched: u.searched, triaged: u.triaged, clean: u.clean,
      highResolution: u.highResolution, cropSafe: u.cropSafe, identityVerified: u.identityVerified,
      eligible: u.eligible,
    });
  }

  // Deterministic total-order sort of the CAPTURED copies (never a re-read of the raw graph),
  // matching canonicalizeTrustedPayload's own ordering exactly (round-3/4/5/6 tuple-comparator
  // discipline) so the resulting canonical form — and therefore the hash — is identical to what
  // the public canonicalizeCastManifest/hashCastManifest would compute for the same content.
  const snapshotBody = {
    version,
    people: sortByTuple(peopleCapture, personTupleKey),
    unmatchedCandidates: sortByTuple(unmatchedCapture, unmatchedCandidateTupleKey),
    hold: holdCapture,
  };
  const recomputedHash = sha256Hex(JSON.stringify(snapshotBody));
  return { snapshot: snapshotBody, recomputedHash, storedHash };
}

/**
 * Structural validation + self/expected hash re-check, in that order. Throws
 * CastManifestError (fail-closed) rather than returning an error value, because every one of
 * this module's evaluators has a normal-path shape (null, [], or a flags object) that could be
 * mistaken for "no issue found" if tamper were instead reported as ordinary data — see the
 * module-header note above for the full rationale.
 *
 * `expectedHash` is MANDATORY, not optional (corrective fix): self-consistency
 * (manifest.hash === recomputedHash) alone only proves a manifest is internally uncorrupted —
 * it does NOT prove it is the SAME manifest the caller actually trusts. A hand-forged or
 * tampered manifest can always recompute a self-consistent hash for its own (tampered)
 * content and re-sign `manifest.hash` with it. A missing/empty/wrong-typed expectedHash is
 * therefore itself a rejection, never a silently-skipped check.
 *
 * ROUND-8 corrective fix (TRUE one-capture integrity): this now calls ONLY
 * captureVerifiedManifest(manifest) — a single merged validate-and-capture pass (see its own
 * doc comment above). There is no separate validateCastManifestStructure(raw) +
 * canonicalizeTrustedPayload(raw) sequence, and no call to the public hashCastManifest at all.
 * `manifest` is read at most once, field by field, exactly where each field is both checked and
 * captured; the recomputed hash, the manifest.hash/expectedHash comparisons, and the returned
 * snapshot are all derived from that one capture. No code path reads or traverses `manifest`
 * again after captureVerifiedManifest returns.
 *
 * @param {object} manifest
 * @param {string} expectedHash - REQUIRED: the manifest's recomputed hash must match this
 *   caller-supplied, externally-trusted value.
 * @returns {object} a deep-frozen verified snapshot (with `.hash` set to the one recomputed,
 *   verified hash) — use this, not the original `manifest`.
 */
export function assertCastManifestIntegrity(manifest, expectedHash) {
  const captured = captureVerifiedManifest(manifest);
  if (captured.error) throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', captured.error);

  const { snapshot, recomputedHash, storedHash } = captured;
  if (storedHash !== recomputedHash) {
    throw new CastManifestError('MANIFEST_HASH_MISMATCH', `stored=${storedHash} recomputed=${recomputedHash}`);
  }
  if (typeof expectedHash !== 'string' || !expectedHash) {
    throw new CastManifestError('MANIFEST_HASH_MISMATCH', 'expected_hash_required');
  }
  if (expectedHash !== recomputedHash) {
    throw new CastManifestError('MANIFEST_HASH_MISMATCH', `expected=${expectedHash} recomputed=${recomputedHash}`);
  }
  // The returned snapshot IS the exact capture used to compute recomputedHash above (not a
  // fresh, separately recomputed one), with that verified hash attached.
  return deepFreeze({ ...snapshot, hash: recomputedHash });
}

// =========================================================================
// FAIL-CLOSED HOLD evaluator (pure recompute — never trusts a cached manifest.hold)
// =========================================================================

/**
 * @param {object} manifest
 * @param {object} opts
 * @param {string} opts.expectedHash - REQUIRED (never optional — see assertCastManifestIntegrity).
 * @throws {CastManifestError} if the manifest is structurally invalid, hash-mismatched, or
 *   opts.expectedHash is missing/empty/wrong-typed.
 */
export function evaluateCastAssetHolds(manifest, opts = {}) {
  // Round 6: use ONLY the verified snapshot from here on — never `manifest` again. The snapshot
  // is a fresh, deep-frozen object graph, so nothing the caller does to their own `manifest`
  // reference after this line (mutate it, or a would-be getter returning something different on
  // a later read) can change what gets evaluated below.
  const verified = assertCastManifestIntegrity(manifest, opts?.expectedHash);
  const people = verified.people;
  const insufficient = people.filter((p) => p?.mustRepresent && !recomputeHasEligibleCandidate(p));
  if (!insufficient.length) return null;
  return {
    holdType: 'INSUFFICIENT_CAST_ASSETS',
    personIds: sortByStr(insufficient.map((p) => p.personId), (s) => s),
    canonicalNames: sortByStr(insufficient.map((p) => p.canonicalName), (s) => s),
  };
}

// Round-8 corrective fix (assignments exact capture): `assignment` — the caller's proposed slot
// assignment being graded — gets the same descriptor-first, Proxy-rejecting treatment as the
// manifest itself, applied once at this evaluator boundary. Unlike the manifest, `assignment`
// being absent, not an array, or containing a row with no personId proposed is a legitimate,
// gradeable state (an evaluator must still be able to say "this proposal covers nobody" rather
// than refuse to grade it at all), so those cases default leniently to an empty/skipped result.
// What DOES throw fail-closed is genuinely hostile or malformed content: a Proxy anywhere in the
// array or in a row (rejected via types.isProxy before any reflection, exactly like the manifest
// boundary), or a row that — once it IS a real, non-Proxy, plain object — does not match the
// EXACT allowed {slotId, personId} keys/types (no holes/extras/symbols/non-enumerables/index
// accessors on the array itself via isExactPlainArray; no surplus/symbol/non-enumerable/accessor
// keys on a row via isExactPlainRecord). personId, once present, must be the same finite,
// non-blank, non-NUL canonical string shape as every other identity in this module (isNonBlankString,
// which — round 8 — already rejects NUL/control characters), never an arbitrary type or value that
// could otherwise flow straight into repeatedPersonIds/uncoveredRequiredPersonIds/thrown-error
// detail strings as attacker-controlled content. Every row is read from `assignment` AT MOST
// ONCE, at the exact point it is both checked and captured; both evaluators below read only the
// returned `rows` array afterward, never the caller's original `assignment` argument again.
const ASSIGNMENT_ROW_KEYS = ['slotId', 'personId'];
// Round-9 corrective fix (assignment FAIL-CLOSED exact capture): the round-8 version returned []
// for a non-array assignment and skipped non-object rows, which silently swallowed malformed
// input. This version distinguishes only ONE benign case — a genuinely ABSENT assignment
// (`undefined`, which is also what the evaluators' `= []` default maps an omitted argument to) —
// from every MALFORMED case, which now throws a typed generic failure and never becomes [] or a
// skipped row:
//   - a Proxy anywhere (array or row) is rejected before any reflection (types.isProxy);
//   - a non-`undefined` value that is not an EXACT plain array (null, a primitive, a string, or a
//     holey/surplus/symbol/index-accessor array) throws;
//   - a row that is a primitive/null/non-plain object, or has a surplus/symbol/non-enumerable key
//     or an accessor property, throws (captureExactPlainRecord returns null without invoking any
//     getter);
//   - `slotId` must be a non-blank, control-free string;
//   - `personId`, when not explicitly null, must be a non-blank control-free string AND must
//     belong to the ALREADY-VERIFIED manifest (validPersonIds). A well-shaped but UNKNOWN id is
//     rejected here, so it can never reach repeatedPersonIds / uncoveredRequiredPersonIds / any
//     output; the thrown error carries a FIXED code, never the attacker-supplied id (no echo).
// Row values are read once, from descriptors, via the capturing helpers — the evaluators then
// consume only the returned `rows`, never the caller's original `assignment` again.
function captureVerifiedAssignment(assignment, validPersonIds) {
  if (assignment === undefined) return []; // absent -> nothing proposed (a legitimate gradeable state)
  if (nodeUtilTypes.isProxy(assignment)) {
    throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', 'ASSIGNMENT_PROXY_REJECTED');
  }
  const items = captureExactPlainArray(assignment);
  if (items === null) {
    throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', 'ASSIGNMENT_NOT_EXACT_ARRAY');
  }

  const captured = [];
  for (const rawRow of items) {
    if (nodeUtilTypes.isProxy(rawRow)) {
      throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', 'ASSIGNMENT_ROW_PROXY_REJECTED');
    }
    const row = captureExactPlainRecord(rawRow, ASSIGNMENT_ROW_KEYS);
    if (row === null) {
      throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', 'ASSIGNMENT_ROW_SHAPE_INVALID');
    }
    if (!isNonBlankString(row.slotId)) {
      throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', 'ASSIGNMENT_ROW_SLOT_ID_INVALID');
    }
    if (row.personId !== null) {
      if (!isNonBlankString(row.personId)) {
        throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', 'ASSIGNMENT_ROW_PERSON_ID_INVALID');
      }
      if (!validPersonIds.has(row.personId)) {
        // Fixed code only — never echo the unknown, attacker-controlled id into the error.
        throw new CastManifestError('INVALID_MANIFEST_STRUCTURE', 'ASSIGNMENT_ROW_PERSON_ID_UNKNOWN');
      }
    }
    captured.push({ slotId: row.slotId, personId: row.personId });
  }
  return captured;
}

// =========================================================================
// OMISSION evaluator
// =========================================================================

/**
 * Given a manifest and a proposed assignment ([{slotId, personId}, ...]), return a typed
 * omission reason for every OPTIONAL (mustRepresent:false) person the assignment does not
 * cover.
 *
 * Reason selection (deterministic, content-derived):
 *   - no_eligible_asset        person has zero eligible candidates (nothing to place)
 *   - slot_capacity_exhausted  person is eligible but every declared slot is already used
 *                              (opts.totalSlotCount given and assignment.length >= it)
 *   - low_priority              person is eligible, slots remain, but was not chosen
 *
 * Fix #8: a mustRepresent:true person is NEVER emitted here, covered or not — that would be
 * describing a required person through the "optional omission" path, which is reserved for
 * mustRepresent:false people only. An uncovered mustRepresent:true person always routes to a
 * blocking HOLD instead: evaluateCastAssetHolds() if they are infeasible (no eligible
 * candidate at all), or evaluateRepeatedIdentityCoverage()'s REQUIRED_PERSON_UNCOVERED flag
 * if they are feasible but simply missing from this particular proposed assignment.
 *
 * Pure evaluator: it grades an assignment, it does not compute one.
 *
 * @param {object} opts
 * @param {string} opts.expectedHash - REQUIRED (never optional — see assertCastManifestIntegrity).
 * @throws {CastManifestError} if the manifest is structurally invalid, hash-mismatched, or
 *   opts.expectedHash is missing/empty/wrong-typed.
 */
export function evaluatePersonOmissions(manifest, assignment = [], opts = {}) {
  // Round 6: use ONLY the verified snapshot from here on — never `manifest` again.
  const verified = assertCastManifestIntegrity(manifest, opts?.expectedHash);
  const people = verified.people;
  // Round 8/9: the assignment array/rows are captured exactly once here too — everything below
  // reads from `rows` (the capture), never from the caller's original `assignment` argument. Every
  // proposed personId must belong to this already-verified manifest (round 9), so an unknown id
  // can never reach the output/flags.
  const validPersonIds = new Set(people.map((p) => p.personId));
  const rows = captureVerifiedAssignment(assignment, validPersonIds);
  const covered = new Set(rows.map((r) => r.personId).filter((id) => id != null));
  const totalSlotCount = typeof opts.totalSlotCount === 'number' ? opts.totalSlotCount : null;

  const out = [];
  for (const p of people) {
    if (!p || covered.has(p.personId)) continue;
    if (p.mustRepresent) continue; // fix #8 — never route a required person through here
    let reason;
    if (!recomputeHasEligibleCandidate(p)) {
      reason = 'no_eligible_asset';
    } else if (totalSlotCount != null && rows.length >= totalSlotCount) {
      reason = 'slot_capacity_exhausted';
    } else {
      reason = 'low_priority';
    }
    out.push({ personId: p.personId, canonicalName: p.canonicalName, mustRepresent: false, reason });
  }
  return sortByStr(out, (r) => r.personId);
}

// =========================================================================
// COVERAGE evaluator
// =========================================================================

/**
 * Grades a proposed assignment for two INDEPENDENT violation types (either, both, or neither
 * may be present):
 *
 *   - REQUIRED_PERSON_UNCOVERED: at least one feasible mustRepresent person (mustRepresent:
 *     true AND has ≥1 eligible candidate, recomputed fresh — fix #3) is left uncovered by the
 *     assignment. This is blocking ON ITS OWN (fix #2) — it does NOT require any repetition
 *     to also be present in the assignment.
 *   - REPEATED_IDENTITY_BEFORE_FULL_COVERAGE: a SEPARATE, ADDITIONAL violation that only
 *     applies when identity repetition co-occurs with at least one uncovered feasible
 *     required person. Repetition alone, with full required-coverage otherwise achieved, is
 *     never a violation.
 *
 * Pure evaluator only — it does not compute a corrected assignment.
 *
 * @param {object} manifest
 * @param {Array<{slotId, personId}>} [assignment]
 * @param {object} opts
 * @param {string} opts.expectedHash - REQUIRED (never optional — see assertCastManifestIntegrity).
 * @returns {{flags: string[], repeatedPersonIds: string[], uncoveredRequiredPersonIds: string[]}}
 * @throws {CastManifestError} if the manifest is structurally invalid, hash-mismatched, or
 *   opts.expectedHash is missing/empty/wrong-typed.
 */
export function evaluateRepeatedIdentityCoverage(manifest, assignment = [], opts = {}) {
  // Round 6: use ONLY the verified snapshot from here on — never `manifest` again.
  const verified = assertCastManifestIntegrity(manifest, opts?.expectedHash);
  const people = verified.people;
  // Round 8/9: the assignment array/rows are captured exactly once here too — everything below
  // reads from `rows` (the capture), never from the caller's original `assignment` argument. Every
  // proposed personId must belong to this already-verified manifest (round 9), so a well-shaped but
  // UNKNOWN id can never reach repeatedPersonIds / uncoveredRequiredPersonIds.
  const validPersonIds = new Set(people.map((p) => p.personId));
  const rows = captureVerifiedAssignment(assignment, validPersonIds);

  const counts = new Map();
  for (const r of rows) {
    if (!r || r.personId == null) continue;
    counts.set(r.personId, (counts.get(r.personId) || 0) + 1);
  }
  const repeatedPersonIds = sortByStr([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id), (s) => s);

  const covered = new Set(rows.map((r) => r?.personId).filter((id) => id != null));
  const uncoveredRequiredPersonIds = sortByStr(
    people
      .filter((p) => p?.mustRepresent && recomputeHasEligibleCandidate(p) && !covered.has(p.personId))
      .map((p) => p.personId),
    (s) => s,
  );

  // Fix #2: missing coverage is blocking independently of repetition. Repetition
  // co-occurring with missing coverage is a separate, additional flag — never a prerequisite.
  const flags = [];
  if (uncoveredRequiredPersonIds.length > 0) flags.push('REQUIRED_PERSON_UNCOVERED');
  if (repeatedPersonIds.length > 0 && uncoveredRequiredPersonIds.length > 0) {
    flags.push('REPEATED_IDENTITY_BEFORE_FULL_COVERAGE');
  }

  return {
    flags: sortByStr(flags, (s) => s),
    repeatedPersonIds,
    uncoveredRequiredPersonIds,
  };
}
