// Hero-shot contract — pure, standalone, hash-bindable CONTRACT foundation.
// Separates hero-candidate acceptance into two INDEPENDENT authorities:
//   STORY     owns identity (who the hero must be, solo-vs-group, confidence floor)
//   REFERENCE owns shot/framing geometry (shot class, face-share/headroom bands,
//             visible-body-region, orientation/aspect)
//   DERIVED   fills any gap left by story/reference with a deterministic default,
//             tagged so callers can see a value was NOT explicitly authored.
// This mirrors the 3-value provenance idea ('story'|'reference'|'derived') used by
// the sibling storyReferenceAuthority module in this batch — re-implemented locally,
// no import (this file stays import-free by design).
//
// BINDING: every contract is pinned to exactly one story-owned sourceAssetId (which
// candidate IMAGE this contract governs) and exactly one heroSlotId (which composition
// SLOT this hero occupies). Both are first-class, hash-bound fields — a contract can
// never be silently reinterpreted for a different asset or slot after the fact.
//
// SAFETY-THRESHOLD LOCK: occlusionMax, edgeCutMax, minResolution and minCleanliness are
// FIXED SYSTEM POLICY. The `reference` input is geometry-only and can never set, loosen,
// or override any of these — the only way they vary is by changing the fixed constants
// below in a code review, never through caller input.
//
// Pure by design: no imports, no IO, no Date.now()/new Date(), no Math.random(),
// no process.env, no other globals. This pure foundation is invoked ONLY by the
// default-OFF flag-gated ref-hero-v2 orchestrator (megaAdapters WAVE1A producer).

export const HERO_SHOT_CONTRACT_VERSION = 1;

export const SHOT_CLASSES = Object.freeze(['closeup', 'bust', 'medium', 'full']);

// Ascending order of how much of the body is visible in frame.
export const VISIBLE_BODY_REGIONS = Object.freeze([
  'face_only', 'head_shoulders', 'bust', 'half_body', 'three_quarter', 'full_body',
]);

export const PROVENANCE_SOURCES = Object.freeze(['story', 'reference', 'derived']);

// Sentinel for "this axis was never actually evaluated" — used for identityValid /
// fidelityValid whenever a structural/tamper/binding gate short-circuits evaluation
// BEFORE real identity/fidelity checks run. Deliberately distinct from `false`
// ("we checked and it failed"). Exported so callers/tests don't have to hard-code
// `null` and can instead assert intent explicitly.
export const AXIS_NOT_EVALUATED = null;

// Fail-closed typed HOLD reasons — returned as data, never thrown.
export const HERO_HOLD_REASONS = Object.freeze([
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
const HOLD_REASON_SET = new Set(HERO_HOLD_REASONS);

// ---------------------------------------------------------------------------
// Deterministic defaults (DERIVED tier) — used only when story/reference omit
// the corresponding field. Every default is a fixed constant: no time/random.
// ---------------------------------------------------------------------------

const SHOT_CLASS_TARGET_REGION = Object.freeze({
  closeup: 'face_only',
  bust: 'bust',
  medium: 'half_body',
  full: 'full_body',
});

// How many VISIBLE_BODY_REGIONS index-steps a crop can plausibly bridge.
// Anything beyond this is not a crop problem — it is the wrong asset.
const REGION_CROP_TOLERANCE = 1;

const DEFAULT_BAND_BY_SHOT_CLASS = Object.freeze({
  closeup: { faceShare: { min: 0.35, max: 0.75 }, headroom: { min: 0.02, max: 0.12 } },
  bust: { faceShare: { min: 0.18, max: 0.40 }, headroom: { min: 0.05, max: 0.18 } },
  medium: { faceShare: { min: 0.08, max: 0.20 }, headroom: { min: 0.08, max: 0.25 } },
  full: { faceShare: { min: 0.02, max: 0.10 }, headroom: { min: 0.10, max: 0.35 } },
});

const DEFAULT_IDENTITY_CONFIDENCE_MIN = 0.75;
const DEFAULT_ALLOW_GROUP = false;
const DEFAULT_SHOT_CLASS = 'medium';
const ASPECT_RATIO_TOLERANCE = 0.15; // relative tolerance when a reference aspect target is set

// FIXED SYSTEM POLICY — safety/quality floors. Never settable by `reference` (or by
// `story`). See module header. These are the ONLY source for these four fields; the
// builder does not read them from any caller input, by construction.
const POLICY_OCCLUSION_MAX = 0.15;
const POLICY_EDGE_CUT_MAX = 0.10;
const POLICY_MIN_RESOLUTION = Object.freeze({ width: 480, height: 480 });
const POLICY_MIN_CLEANLINESS = 0.5;

// ---------------------------------------------------------------------------
// Local helpers — deliberately re-implemented (not imported) per repo pattern.
// ---------------------------------------------------------------------------

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

function isPlainObject(v) {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function nonBlankString(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function unitInterval(v) {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

function validBand(band) {
  return isPlainObject(band) && unitInterval(band.min) && unitInterval(band.max) && band.min <= band.max;
}

function validProvenance(v) {
  return PROVENANCE_SOURCES.includes(v);
}

function regionIndex(region) {
  const i = VISIBLE_BODY_REGIONS.indexOf(region);
  return i === -1 ? null : i;
}

function hasOnlyAllowedKeys(obj, allowedKeys) {
  return Object.keys(obj).every((k) => allowedKeys.includes(k));
}

// Stricter than hasOnlyAllowedKeys: requires BOTH "no extra key" AND "every key in
// requiredKeys is actually present" — i.e. the object's key-set must equal
// requiredKeys exactly, not merely be a subset of it. Used for nested raw builder
// input (band objects) and for the public canonicalizer's top-level shape gate,
// where a MISSING mandatory key (e.g. a deleted contractHash) must fail closed just
// as loudly as a smuggled extra key.
function hasExactKeys(obj, requiredKeys) {
  const keys = Object.keys(obj);
  if (keys.length !== requiredKeys.length) return false;
  return requiredKeys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// Strict key allowlists for builder input. Any key outside these lists fails
// the WHOLE build (fail-closed, null) — no silent stripping/ignoring.
// ---------------------------------------------------------------------------
const TOP_LEVEL_INPUT_KEYS = Object.freeze(['story', 'reference', 'sourceAssetId', 'heroSlotId']);
const STORY_INPUT_KEYS = Object.freeze(['personId', 'allowGroup', 'identityConfidenceMin']);
// NOTE: occlusionMax / edgeCutMax / minResolution / minCleanliness are deliberately
// NOT in this allowlist. They are fixed system policy (see POLICY_* above) and can
// never be supplied by `reference` — see module header + fix (2).
const REFERENCE_INPUT_KEYS = Object.freeze([
  'shotClass', 'targetVisibleBodyRegion', 'faceShareBand', 'headroomBand',
  'orientationTarget', 'aspectRatioTarget',
]);

// ---------------------------------------------------------------------------
// Builder — assembles a hero-shot contract from separated story/reference
// authority, filling gaps with deterministic derived defaults.
// Returns null on structurally invalid input (fail-closed: no partial contract).
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {string} input.sourceAssetId - story-owned id of exactly which candidate
 *   image was decided as hero. Mandatory, hash-bound. Prevents silent asset-swap.
 * @param {string} input.heroSlotId - id of exactly which composition slot this hero
 *   occupies. Mandatory, hash-bound. Prevents silent slot-swap.
 * @param {object} input.story - { personId, allowGroup?, identityConfidenceMin? }
 * @param {object} [input.reference] - { shotClass?, targetVisibleBodyRegion?,
 *   faceShareBand?, headroomBand?, orientationTarget?, aspectRatioTarget? }
 *   Geometry-only. Threshold/safety keys (occlusionMax, edgeCutMax, minResolution,
 *   minCleanliness) are NOT accepted here — see module header.
 * @returns {object|null} frozen canonical contract, or null if input is invalid
 */
export function buildHeroShotContract(input = {}) {
  if (!isPlainObject(input)) return null;
  if (!hasOnlyAllowedKeys(input, TOP_LEVEL_INPUT_KEYS)) return null;

  const sourceAssetId = nonBlankString(input.sourceAssetId);
  if (!sourceAssetId) return null;
  const heroSlotId = nonBlankString(input.heroSlotId);
  if (!heroSlotId) return null;

  const story = isPlainObject(input.story) ? input.story : null;
  if (!story) return null;
  if (!hasOnlyAllowedKeys(story, STORY_INPUT_KEYS)) return null;
  const personId = nonBlankString(story.personId);
  if (!personId) return null;

  let allowGroup;
  let allowGroupProvenance;
  if (story.allowGroup === undefined) {
    allowGroup = DEFAULT_ALLOW_GROUP;
    allowGroupProvenance = 'derived';
  } else if (typeof story.allowGroup === 'boolean') {
    allowGroup = story.allowGroup;
    allowGroupProvenance = 'story';
  } else {
    return null; // present but wrong type — invalid contract, fail closed
  }

  let identityConfidenceMin;
  let identityConfidenceMinProvenance;
  if (story.identityConfidenceMin === undefined) {
    identityConfidenceMin = DEFAULT_IDENTITY_CONFIDENCE_MIN;
    identityConfidenceMinProvenance = 'derived';
  } else if (unitInterval(story.identityConfidenceMin)) {
    identityConfidenceMin = story.identityConfidenceMin;
    identityConfidenceMinProvenance = 'story';
  } else {
    return null;
  }

  const reference = input.reference === undefined || input.reference === null
    ? null
    : (isPlainObject(input.reference) ? input.reference : undefined);
  if (reference === undefined) return null; // reference present but not a plain object
  if (reference && !hasOnlyAllowedKeys(reference, REFERENCE_INPUT_KEYS)) return null; // rejects threshold-key smuggling too

  let shotClass;
  let shotClassProvenance;
  if (reference && reference.shotClass !== undefined) {
    if (!SHOT_CLASSES.includes(reference.shotClass)) return null;
    shotClass = reference.shotClass;
    shotClassProvenance = 'reference';
  } else {
    shotClass = DEFAULT_SHOT_CLASS;
    shotClassProvenance = 'derived';
  }

  let targetVisibleBodyRegion;
  let targetVisibleBodyRegionProvenance;
  if (reference && reference.targetVisibleBodyRegion !== undefined) {
    if (!VISIBLE_BODY_REGIONS.includes(reference.targetVisibleBodyRegion)) return null;
    targetVisibleBodyRegion = reference.targetVisibleBodyRegion;
    targetVisibleBodyRegionProvenance = 'reference';
  } else {
    targetVisibleBodyRegion = SHOT_CLASS_TARGET_REGION[shotClass];
    targetVisibleBodyRegionProvenance = 'derived';
  }

  const defaultBand = DEFAULT_BAND_BY_SHOT_CLASS[shotClass];

  let faceShareBand;
  let faceShareBandProvenance;
  if (reference && reference.faceShareBand !== undefined) {
    // Exact-key gate BEFORE range validation/copy: a raw band object carrying an
    // extra key (smuggled flag) or missing min/max must abort the WHOLE build, not
    // just silently drop the extra key when the builder copies out {min,max}.
    if (!isPlainObject(reference.faceShareBand) || !hasExactKeys(reference.faceShareBand, BAND_KEYS)) return null;
    if (!validBand(reference.faceShareBand)) return null;
    faceShareBand = { min: reference.faceShareBand.min, max: reference.faceShareBand.max };
    faceShareBandProvenance = 'reference';
  } else {
    faceShareBand = { ...defaultBand.faceShare };
    faceShareBandProvenance = 'derived';
  }

  let headroomBand;
  let headroomBandProvenance;
  if (reference && reference.headroomBand !== undefined) {
    if (!isPlainObject(reference.headroomBand) || !hasExactKeys(reference.headroomBand, BAND_KEYS)) return null;
    if (!validBand(reference.headroomBand)) return null;
    headroomBand = { min: reference.headroomBand.min, max: reference.headroomBand.max };
    headroomBandProvenance = 'reference';
  } else {
    headroomBand = { ...defaultBand.headroom };
    headroomBandProvenance = 'derived';
  }

  // Safety/quality thresholds: FIXED POLICY ONLY. No caller input path exists for
  // these at all (reference is not even allowed to carry these keys — see
  // REFERENCE_INPUT_KEYS above). Always 'derived'.
  const occlusionMax = POLICY_OCCLUSION_MAX;
  const occlusionMaxProvenance = 'derived';
  const edgeCutMax = POLICY_EDGE_CUT_MAX;
  const edgeCutMaxProvenance = 'derived';
  const minResolution = { ...POLICY_MIN_RESOLUTION };
  const minResolutionProvenance = 'derived';
  const minCleanliness = POLICY_MIN_CLEANLINESS;
  const minCleanlinessProvenance = 'derived';

  let orientationTarget;
  let orientationTargetProvenance;
  if (reference && reference.orientationTarget !== undefined) {
    const o = reference.orientationTarget;
    if (o !== 'portrait' && o !== 'landscape' && o !== 'square') return null;
    orientationTarget = o;
    orientationTargetProvenance = 'reference';
  } else {
    orientationTarget = null; // unconstrained
    orientationTargetProvenance = 'derived';
  }

  let aspectRatioTarget;
  let aspectRatioTargetProvenance;
  if (reference && reference.aspectRatioTarget !== undefined) {
    if (!isFiniteNumber(reference.aspectRatioTarget) || reference.aspectRatioTarget <= 0) return null;
    aspectRatioTarget = reference.aspectRatioTarget;
    aspectRatioTargetProvenance = 'reference';
  } else {
    aspectRatioTarget = null; // unconstrained
    aspectRatioTargetProvenance = 'derived';
  }

  const contract = {
    v: HERO_SHOT_CONTRACT_VERSION,
    binding: {
      sourceAssetId,
      sourceAssetIdProvenance: 'story',
      heroSlotId,
      heroSlotIdProvenance: 'story',
    },
    story: {
      personId,
      personIdProvenance: 'story',
      allowGroup,
      allowGroupProvenance,
      identityConfidenceMin,
      identityConfidenceMinProvenance,
    },
    shot: {
      shotClass,
      shotClassProvenance,
      targetVisibleBodyRegion,
      targetVisibleBodyRegionProvenance,
      faceShareBand,
      faceShareBandProvenance,
      headroomBand,
      headroomBandProvenance,
      occlusionMax,
      occlusionMaxProvenance,
      edgeCutMax,
      edgeCutMaxProvenance,
      minResolution,
      minResolutionProvenance,
      minCleanliness,
      minCleanlinessProvenance,
      orientationTarget,
      orientationTargetProvenance,
      aspectRatioTarget,
      aspectRatioTargetProvenance,
    },
  };
  contract.contractHash = hashHeroShotContract(contract);
  return deepFreeze(contract);
}

// ---------------------------------------------------------------------------
// Canonicalizer + hasher — explicit fixed field order, STRICT shape/enum/range
// validation, no unknown keys accepted silently. Provenance tags are part of
// the canonical form (and therefore the hash): changing a tag without changing
// the underlying value still changes the hash. Reordering equivalent input
// fields at build time never changes the hash, because the builder always
// emits fields in this same fixed order.
// ---------------------------------------------------------------------------

const CONTRACT_TOP_KEYS = Object.freeze(['v', 'binding', 'story', 'shot', 'contractHash']);
const BINDING_KEYS = Object.freeze([
  'sourceAssetId', 'sourceAssetIdProvenance', 'heroSlotId', 'heroSlotIdProvenance',
]);
const STORY_CONTRACT_KEYS = Object.freeze([
  'personId', 'personIdProvenance', 'allowGroup', 'allowGroupProvenance',
  'identityConfidenceMin', 'identityConfidenceMinProvenance',
]);
const SHOT_CONTRACT_KEYS = Object.freeze([
  'shotClass', 'shotClassProvenance', 'targetVisibleBodyRegion', 'targetVisibleBodyRegionProvenance',
  'faceShareBand', 'faceShareBandProvenance', 'headroomBand', 'headroomBandProvenance',
  'occlusionMax', 'occlusionMaxProvenance', 'edgeCutMax', 'edgeCutMaxProvenance',
  'minResolution', 'minResolutionProvenance', 'minCleanliness', 'minCleanlinessProvenance',
  'orientationTarget', 'orientationTargetProvenance', 'aspectRatioTarget', 'aspectRatioTargetProvenance',
]);

// Exact key-sets for nested band/resolution objects — an extra key (e.g. a smuggled
// flag riding along with min/max) must fail the WHOLE canonicalization, same
// fail-closed pattern as every other check in canonicalizeHeroShotContract.
const BAND_KEYS = Object.freeze(['min', 'max']);
const MIN_RESOLUTION_KEYS = Object.freeze(['width', 'height']);

// Per-field provenance allowlists. Unlike the generic `validProvenance` (any of the
// 3 enum values, applied identically everywhere), each provenance-tagged field has
// its own strict set of sources it may legitimately carry:
//   - story-owned identity fields: always exactly 'story'
//   - story-or-system fields: 'story' or 'derived' (never 'reference' — reference
//     input never contributes to story facts)
//   - reference-controllable framing fields: 'reference' or 'derived' (never
//     'story' — these are not story-owned facts)
//   - fixed-policy fields: always exactly 'derived' (no caller input path exists)
const FIELD_PROVENANCE_ALLOWLIST = Object.freeze({
  sourceAssetIdProvenance: Object.freeze(['story']),
  heroSlotIdProvenance: Object.freeze(['story']),
  personIdProvenance: Object.freeze(['story']),
  allowGroupProvenance: Object.freeze(['story', 'derived']),
  identityConfidenceMinProvenance: Object.freeze(['story', 'derived']),
  shotClassProvenance: Object.freeze(['reference', 'derived']),
  targetVisibleBodyRegionProvenance: Object.freeze(['reference', 'derived']),
  faceShareBandProvenance: Object.freeze(['reference', 'derived']),
  headroomBandProvenance: Object.freeze(['reference', 'derived']),
  orientationTargetProvenance: Object.freeze(['reference', 'derived']),
  aspectRatioTargetProvenance: Object.freeze(['reference', 'derived']),
  occlusionMaxProvenance: Object.freeze(['derived']),
  edgeCutMaxProvenance: Object.freeze(['derived']),
  minResolutionProvenance: Object.freeze(['derived']),
  minCleanlinessProvenance: Object.freeze(['derived']),
});

function validFieldProvenance(fieldKey, value) {
  const allowed = FIELD_PROVENANCE_ALLOWLIST[fieldKey];
  return Array.isArray(allowed) && allowed.includes(value);
}

// INTERNAL, not-exported payload canonicalizer. Deliberately contractHash-agnostic:
// it neither requires nor inspects `contractHash` (the top-level key check below
// still tolerates it being present-or-absent via CONTRACT_TOP_KEYS, unchanged from
// before) because this is the function `hashHeroShotContract` calls directly — both
// on the builder's in-progress object (which does not have a contractHash field
// yet) and on a fully-built contract (which does). Presence/absence of contractHash
// must never change what gets hashed. The exported `canonicalizeHeroShotContract`
// below adds the mandatory-contractHash gate on top of this.
function canonicalizeContractPayload(contract) {
  if (!isPlainObject(contract)) return null;
  if (!hasOnlyAllowedKeys(contract, CONTRACT_TOP_KEYS)) return null;
  if (contract.v !== HERO_SHOT_CONTRACT_VERSION) return null;

  const binding = contract.binding;
  const story = contract.story;
  const shot = contract.shot;
  if (!isPlainObject(binding) || !hasOnlyAllowedKeys(binding, BINDING_KEYS)) return null;
  if (!isPlainObject(story) || !hasOnlyAllowedKeys(story, STORY_CONTRACT_KEYS)) return null;
  if (!isPlainObject(shot) || !hasOnlyAllowedKeys(shot, SHOT_CONTRACT_KEYS)) return null;

  if (!nonBlankString(binding.sourceAssetId)) return null;
  if (!validFieldProvenance('sourceAssetIdProvenance', binding.sourceAssetIdProvenance)) return null;
  if (!nonBlankString(binding.heroSlotId)) return null;
  if (!validFieldProvenance('heroSlotIdProvenance', binding.heroSlotIdProvenance)) return null;

  if (!nonBlankString(story.personId)) return null;
  if (!validFieldProvenance('personIdProvenance', story.personIdProvenance)) return null;
  if (typeof story.allowGroup !== 'boolean') return null;
  if (!validFieldProvenance('allowGroupProvenance', story.allowGroupProvenance)) return null;
  // A field TAGGED 'derived' must actually HOLD the exact value the real deterministic
  // derivation would produce — the provenance tag alone is not sufficient proof.
  // 'story'-tagged values remain free-choice (story authority may choose any valid value).
  if (story.allowGroupProvenance === 'derived' && story.allowGroup !== DEFAULT_ALLOW_GROUP) return null;
  if (!unitInterval(story.identityConfidenceMin)) return null;
  if (!validFieldProvenance('identityConfidenceMinProvenance', story.identityConfidenceMinProvenance)) return null;
  if (story.identityConfidenceMinProvenance === 'derived'
    && story.identityConfidenceMin !== DEFAULT_IDENTITY_CONFIDENCE_MIN) return null;

  if (!SHOT_CLASSES.includes(shot.shotClass)) return null;
  if (!validFieldProvenance('shotClassProvenance', shot.shotClassProvenance)) return null;
  if (shot.shotClassProvenance === 'derived' && shot.shotClass !== DEFAULT_SHOT_CLASS) return null;
  if (!VISIBLE_BODY_REGIONS.includes(shot.targetVisibleBodyRegion)) return null;
  if (!validFieldProvenance('targetVisibleBodyRegionProvenance', shot.targetVisibleBodyRegionProvenance)) return null;
  // Uses THIS CONTRACT'S OWN already-validated shotClass, not the global default —
  // shot.shotClass is guaranteed a legitimate SHOT_CLASSES member by this point.
  if (shot.targetVisibleBodyRegionProvenance === 'derived'
    && shot.targetVisibleBodyRegion !== SHOT_CLASS_TARGET_REGION[shot.shotClass]) return null;
  if (!validBand(shot.faceShareBand) || !hasOnlyAllowedKeys(shot.faceShareBand, BAND_KEYS)) return null;
  if (!validFieldProvenance('faceShareBandProvenance', shot.faceShareBandProvenance)) return null;
  if (shot.faceShareBandProvenance === 'derived') {
    const d = DEFAULT_BAND_BY_SHOT_CLASS[shot.shotClass].faceShare;
    if (shot.faceShareBand.min !== d.min || shot.faceShareBand.max !== d.max) return null;
  }
  if (!validBand(shot.headroomBand) || !hasOnlyAllowedKeys(shot.headroomBand, BAND_KEYS)) return null;
  if (!validFieldProvenance('headroomBandProvenance', shot.headroomBandProvenance)) return null;
  if (shot.headroomBandProvenance === 'derived') {
    const d = DEFAULT_BAND_BY_SHOT_CLASS[shot.shotClass].headroom;
    if (shot.headroomBand.min !== d.min || shot.headroomBand.max !== d.max) return null;
  }
  // Policy fields: EXACT equality to the fixed constants, not a range check. This is
  // defense-in-depth beyond hash-comparison — a hand-forged-but-internally-consistent
  // contract must never canonicalize at all if its policy fields deviate from the
  // fixed constants, independent of whatever hash-comparison layer sits on top.
  if (shot.occlusionMax !== POLICY_OCCLUSION_MAX) return null;
  if (!validFieldProvenance('occlusionMaxProvenance', shot.occlusionMaxProvenance)) return null;
  if (shot.edgeCutMax !== POLICY_EDGE_CUT_MAX) return null;
  if (!validFieldProvenance('edgeCutMaxProvenance', shot.edgeCutMaxProvenance)) return null;
  if (!isPlainObject(shot.minResolution) || !hasOnlyAllowedKeys(shot.minResolution, MIN_RESOLUTION_KEYS)
    || shot.minResolution.width !== POLICY_MIN_RESOLUTION.width
    || shot.minResolution.height !== POLICY_MIN_RESOLUTION.height) return null;
  if (!validFieldProvenance('minResolutionProvenance', shot.minResolutionProvenance)) return null;
  if (shot.minCleanliness !== POLICY_MIN_CLEANLINESS) return null;
  if (!validFieldProvenance('minCleanlinessProvenance', shot.minCleanlinessProvenance)) return null;
  if (shot.orientationTarget !== null && shot.orientationTarget !== 'portrait'
    && shot.orientationTarget !== 'landscape' && shot.orientationTarget !== 'square') return null;
  if (!validFieldProvenance('orientationTargetProvenance', shot.orientationTargetProvenance)) return null;
  // 'derived' has no other-system derivation for this field — the builder always
  // derives null when reference doesn't supply a value. 'reference' must carry an
  // actual non-null reference-supplied value (the builder only tags 'reference' when
  // a real value was supplied).
  if (shot.orientationTargetProvenance === 'derived' && shot.orientationTarget !== null) return null;
  if (shot.orientationTargetProvenance === 'reference' && shot.orientationTarget === null) return null;
  if (shot.aspectRatioTarget !== null
    && !(isFiniteNumber(shot.aspectRatioTarget) && shot.aspectRatioTarget > 0)) return null;
  if (!validFieldProvenance('aspectRatioTargetProvenance', shot.aspectRatioTargetProvenance)) return null;
  if (shot.aspectRatioTargetProvenance === 'derived' && shot.aspectRatioTarget !== null) return null;
  if (shot.aspectRatioTargetProvenance === 'reference' && shot.aspectRatioTarget === null) return null;

  return {
    v: contract.v,
    binding: {
      sourceAssetId: binding.sourceAssetId,
      sourceAssetIdProvenance: binding.sourceAssetIdProvenance,
      heroSlotId: binding.heroSlotId,
      heroSlotIdProvenance: binding.heroSlotIdProvenance,
    },
    story: {
      personId: story.personId,
      personIdProvenance: story.personIdProvenance,
      allowGroup: story.allowGroup,
      allowGroupProvenance: story.allowGroupProvenance,
      identityConfidenceMin: story.identityConfidenceMin,
      identityConfidenceMinProvenance: story.identityConfidenceMinProvenance,
    },
    shot: {
      shotClass: shot.shotClass,
      shotClassProvenance: shot.shotClassProvenance,
      targetVisibleBodyRegion: shot.targetVisibleBodyRegion,
      targetVisibleBodyRegionProvenance: shot.targetVisibleBodyRegionProvenance,
      faceShareBand: { min: shot.faceShareBand.min, max: shot.faceShareBand.max },
      faceShareBandProvenance: shot.faceShareBandProvenance,
      headroomBand: { min: shot.headroomBand.min, max: shot.headroomBand.max },
      headroomBandProvenance: shot.headroomBandProvenance,
      occlusionMax: shot.occlusionMax,
      occlusionMaxProvenance: shot.occlusionMaxProvenance,
      edgeCutMax: shot.edgeCutMax,
      edgeCutMaxProvenance: shot.edgeCutMaxProvenance,
      minResolution: { width: shot.minResolution.width, height: shot.minResolution.height },
      minResolutionProvenance: shot.minResolutionProvenance,
      minCleanliness: shot.minCleanliness,
      minCleanlinessProvenance: shot.minCleanlinessProvenance,
      orientationTarget: shot.orientationTarget ?? null,
      orientationTargetProvenance: shot.orientationTargetProvenance,
      aspectRatioTarget: shot.aspectRatioTarget ?? null,
      aspectRatioTargetProvenance: shot.aspectRatioTargetProvenance,
    },
  };
}

// PUBLIC, exported strict gate. Thin wrapper over canonicalizeContractPayload that
// ADDITIONALLY requires the full top-level shape — including a present, non-blank
// `contractHash` string — before delegating. `hasOnlyAllowedKeys` (used internally)
// only checks that every key PRESENT is allowed; it does NOT check that every
// allowed key is actually present, so a contract missing `contractHash` entirely
// would otherwise slip through. This function is the module's stated "single strict
// gate" — any caller of it directly (not just the evaluator) must not be misled into
// accepting a hashless contract. Does NOT compare contractHash to the recomputed
// hash (that would be circular); value-mismatch checking is the evaluator's separate
// responsibility.
export function canonicalizeHeroShotContract(contract) {
  if (!isPlainObject(contract)) return null;
  if (!hasExactKeys(contract, CONTRACT_TOP_KEYS)) return null;
  if (!nonBlankString(contract.contractHash)) return null;
  return canonicalizeContractPayload(contract);
}

export function hashHeroShotContract(contract) {
  const canon = canonicalizeContractPayload(contract);
  if (!canon) return null;
  return fnv1a32(JSON.stringify(canon));
}

// ---------------------------------------------------------------------------
// Evaluator — identity and fidelity are checked as two INDEPENDENT axes.
// Never throws: every failure mode returns a typed reason from HERO_HOLD_REASONS.
//
// Required candidate fields (fail-closed with HERO_MISSING_REQUIRED_CANDIDATE_FIELD
// when absent — never silently defaulted to a value that could pass):
//   personId, identityConfidence, isGroupShot, faceShare, headroom,
//   visibleBodyRegion, occlusion, edgeCut, resolution, cleanliness,
//   boundContractHash, sourceAssetId, heroSlotId.
// `orientation` and `aspectRatio` are deliberately NOT in this list: they are only
// meaningful when the contract's orientationTarget/aspectRatioTarget is non-null
// (the shot doesn't constrain them otherwise), and an absent value in that case
// already fails closed via the existing crop-capability check (mismatch against a
// real target, not a silent pass) rather than needing a separate missing-field path.
// ---------------------------------------------------------------------------

const REQUIRED_CANDIDATE_FIELDS = Object.freeze([
  'personId', 'identityConfidence', 'isGroupShot', 'faceShare', 'headroom',
  'visibleBodyRegion', 'occlusion', 'edgeCut', 'resolution', 'cleanliness',
  'boundContractHash', 'sourceAssetId', 'heroSlotId',
]);

function firstMissingCandidateField(c) {
  for (const field of REQUIRED_CANDIDATE_FIELDS) {
    if (c[field] === undefined) return field;
  }
  if (typeof c.isGroupShot !== 'boolean') return 'isGroupShot';
  return null;
}

function holdVerdict(reason, contractHash, extra = {}) {
  return {
    accepted: false,
    identityValid: AXIS_NOT_EVALUATED,
    fidelityValid: AXIS_NOT_EVALUATED,
    reason,
    contractHash: contractHash ?? null,
    provenance: null,
    ...extra,
  };
}

/**
 * @param {object} contract - output of buildHeroShotContract (or an equivalently shaped object)
 * @param {object} candidate - measured facts about a candidate image. See
 *   REQUIRED_CANDIDATE_FIELDS for the mandatory field list; all are fail-closed when
 *   missing. Shape:
 *   { personId, identityConfidence, isGroupShot, faceShare, headroom, visibleBodyRegion,
 *     occlusion, edgeCut, orientation?, aspectRatio?, resolution:{width,height}, cleanliness,
 *     boundContractHash, sourceAssetId, heroSlotId }
 * @param {object} opts
 * @param {string} opts.expectedContractHash - MANDATORY hash the caller trusts this
 *   contract to be (from a trusted build). Self-consistency of the contract's own
 *   embedded hash is NOT sufficient on its own — a hand-forged contract can always
 *   recompute a self-consistent hash. Missing/mismatched => HERO_CONTRACT_TAMPERED.
 * @returns {{accepted:boolean, identityValid:(boolean|null), fidelityValid:(boolean|null),
 *   reason:string|null, contractHash:string|null, provenance:object|null}}
 */
export function evaluateHeroShotCandidate(contract, candidate, opts = {}) {
  const options = isPlainObject(opts) ? opts : {};

  // ---- structural gate: contract must canonicalize cleanly ----
  const canon = canonicalizeHeroShotContract(contract);
  if (!canon) return holdVerdict('HERO_CONTRACT_TAMPERED', null, { detail: 'invalid_contract' });
  const actualHash = fnv1a32(JSON.stringify(canon));

  // ---- expectedContractHash is MANDATORY: self-consistency alone is not enough.
  // A hand-forged contract can always recompute a self-consistent embedded hash;
  // only a hash supplied by the caller from a trusted build proves this is really
  // the contract that was legitimately built. ----
  const expected = options.expectedContractHash;
  if (typeof expected !== 'string' || expected.length === 0) {
    return holdVerdict('HERO_CONTRACT_TAMPERED', actualHash, { detail: 'expected_hash_required' });
  }
  if (expected !== actualHash) {
    return holdVerdict('HERO_CONTRACT_TAMPERED', actualHash, { detail: 'expected_hash_mismatch' });
  }
  // Defense-in-depth: verify the contract's own embedded contractHash actually
  // equals what canonicalization+hashing recomputes. Presence/type of
  // contract.contractHash is already guaranteed by canonicalizeHeroShotContract's
  // own mandatory top-level exact-shape gate above (canon would be null otherwise,
  // and we would have already returned) — only a VALUE mismatch (attacker edited
  // the payload but left a stale/wrong contractHash string) can still occur here.
  if (contract.contractHash !== actualHash) {
    return holdVerdict('HERO_CONTRACT_TAMPERED', actualHash, { detail: 'contract_self_hash_mismatch' });
  }

  // ---- candidate structural gate: every required field must be present ----
  const c = isPlainObject(candidate) ? candidate : {};
  const missingField = firstMissingCandidateField(c);
  if (missingField) {
    return holdVerdict('HERO_MISSING_REQUIRED_CANDIDATE_FIELD', actualHash, { detail: { field: missingField } });
  }

  // ---- candidate binding gate: boundContractHash + sourceAssetId + heroSlotId must
  // all match the contract's own binding. A candidate correctly bound-hashed to THIS
  // contract but referencing a different asset/slot id is an asset-swap / slot-swap
  // attack and must be rejected, not silently accepted. ----
  if (c.boundContractHash !== actualHash) {
    return holdVerdict('HERO_CONTRACT_TAMPERED', actualHash, { detail: 'candidate_bound_hash_mismatch' });
  }
  if (c.sourceAssetId !== canon.binding.sourceAssetId) {
    return holdVerdict('HERO_ASSET_BINDING_MISMATCH', actualHash, {
      detail: { expected: canon.binding.sourceAssetId, actual: c.sourceAssetId },
    });
  }
  if (c.heroSlotId !== canon.binding.heroSlotId) {
    return holdVerdict('HERO_SLOT_BINDING_MISMATCH', actualHash, {
      detail: { expected: canon.binding.heroSlotId, actual: c.heroSlotId },
    });
  }

  const story = canon.story;
  const shot = canon.shot;
  const provenance = {
    identitySource: story.personIdProvenance,
    identityConfidenceSource: story.identityConfidenceMinProvenance,
    allowGroupSource: story.allowGroupProvenance,
    shotClassSource: shot.shotClassProvenance,
    targetVisibleBodyRegionSource: shot.targetVisibleBodyRegionProvenance,
    faceShareBandSource: shot.faceShareBandProvenance,
    headroomBandSource: shot.headroomBandProvenance,
  };

  // ---- identity axis (independent of fidelity) — genuine boolean from here on ----
  const personMatches = nonBlankString(c.personId) === story.personId;
  const confidenceOk = isFiniteNumber(c.identityConfidence) && c.identityConfidence >= story.identityConfidenceMin;
  const groupOk = story.allowGroup === true || c.isGroupShot !== true;
  const identityValid = !!(personMatches && confidenceOk && groupOk);

  // ---- fidelity axis (independent of identity) — checked in a fixed priority order ----
  let fidelityValid = true;
  let fidelityReason = null;

  // 1. crop-capability: is the candidate's actual framing even in the same neighborhood
  //    as the shot target? A full-body candidate against a closeup target is not a crop
  //    problem — it is the wrong asset. Orientation/aspect mismatches count here too,
  //    since no crop of this asset can fix the wrong orientation/aspect either.
  const candRegionIdx = regionIndex(c.visibleBodyRegion);
  const targetRegionIdx = regionIndex(shot.targetVisibleBodyRegion);
  const regionCropCapable = candRegionIdx !== null && targetRegionIdx !== null
    && Math.abs(candRegionIdx - targetRegionIdx) <= REGION_CROP_TOLERANCE;
  const orientationCompatible = shot.orientationTarget == null || c.orientation === shot.orientationTarget;
  const aspectCompatible = shot.aspectRatioTarget == null
    || (isFiniteNumber(c.aspectRatio) && c.aspectRatio > 0
      && Math.abs(c.aspectRatio - shot.aspectRatioTarget) / shot.aspectRatioTarget <= ASPECT_RATIO_TOLERANCE);
  if (!regionCropCapable || !orientationCompatible || !aspectCompatible) {
    fidelityValid = false;
    fidelityReason = 'HERO_NO_CROP_CAPABLE_ASSET';
  }

  // 2. face-share band
  if (fidelityValid) {
    const fs = c.faceShare;
    if (!isFiniteNumber(fs) || fs < shot.faceShareBand.min || fs > shot.faceShareBand.max) {
      fidelityValid = false;
      fidelityReason = 'HERO_FACE_SHARE_OUT_OF_BAND';
    }
  }

  // 3. headroom band
  if (fidelityValid) {
    const hr = c.headroom;
    if (!isFiniteNumber(hr) || hr < shot.headroomBand.min || hr > shot.headroomBand.max) {
      fidelityValid = false;
      fidelityReason = 'HERO_HEADROOM_OUT_OF_BAND';
    }
  }

  // 4. resolution floor
  if (fidelityValid) {
    const res = c.resolution;
    const okRes = isPlainObject(res) && isFiniteNumber(res.width) && isFiniteNumber(res.height)
      && res.width >= shot.minResolution.width && res.height >= shot.minResolution.height;
    if (!okRes) {
      fidelityValid = false;
      fidelityReason = 'HERO_RESOLUTION_TOO_LOW';
    }
  }

  // 5. cleanliness / occlusion / edge-cut — kept as one combined check (same as before);
  //    occlusion-only and edge-cut-only failures still surface distinct reasons at
  //    steps 2-4 first when applicable, but when ONLY this group fails, the reason is
  //    the specific one below rather than a generic catch-all.
  if (fidelityValid) {
    const cleanOk = isFiniteNumber(c.cleanliness) && c.cleanliness >= shot.minCleanliness;
    const occlusionOk = isFiniteNumber(c.occlusion) && c.occlusion <= shot.occlusionMax;
    const edgeCutOk = isFiniteNumber(c.edgeCut) && c.edgeCut <= shot.edgeCutMax;
    if (!occlusionOk) {
      fidelityValid = false;
      fidelityReason = 'HERO_OCCLUSION_TOO_HIGH';
    } else if (!edgeCutOk) {
      fidelityValid = false;
      fidelityReason = 'HERO_EDGE_CUT_TOO_HIGH';
    } else if (!cleanOk) {
      fidelityValid = false;
      fidelityReason = 'HERO_NOT_CLEAN';
    }
  }

  const accepted = identityValid && fidelityValid;
  let reason = null;
  if (!accepted) {
    reason = !identityValid ? 'HERO_IDENTITY_MISMATCH' : fidelityReason;
  }

  return { accepted, identityValid, fidelityValid, reason, contractHash: actualHash, provenance };
}

// Membership helper — kept exported so a caller can validate a stored reason
// code without importing the frozen array and doing its own .includes().
export function isHeroHoldReason(value) {
  return HOLD_REASON_SET.has(value);
}
