// ============================================================
// searchQualityMetrics.js — Lane C (search-quality diagnostic primitive)
// ============================================================
//
// PURE, DETERMINISTIC, FAIL-CLOSED. Not integrated anywhere — this is a
// standalone diagnostic building block that reasons over a *fully-measured,
// bounded pool descriptor* and answers three questions:
//
//   1. Per-role pool sufficiency         -> boolean + 0..1 score vs the
//        REALIZED TEMPLATE'S demand (requiredSlots / requiredUnique).
//   2. Overall readiness metric          -> 0..1 (template-gated).
//   3. Dominant failure classification   -> the SINGLE root cause among
//        TEMPLATE_ABSENT / STOCK_SHORTAGE / CROP_UNSAFE / SELECTION_MISS,
//        with the evidence counts that justify it.
//
// AUDIT REMEDIATION — this module MUST NOT guess a cause from absence:
//   • It never infers a shortage from *missing measurement*. Only an EXPLICIT
//     measured zero (a counter that is present and equals 0) can prove
//     STOCK_SHORTAGE. A counter that was never reported is "not measured" and
//     yields 'insufficient-data', NOT a shortage.
//   • SELECTION_MISS is returned ONLY when the input carries explicit own-data
//     proving selection was attempted AND failed (selectionAttempted===true &&
//     selectionFailed===true, or selectionOutcome==='MISS'). A sufficient pool
//     is NEVER classified as SELECTION_MISS by elimination. A proven miss may be
//     SCOPED to specific roles via own-data `failedRoles`/`failedSlots`; without
//     that scope it is an UNSCOPED GLOBAL miss whose offendingRoles is EMPTY — it
//     must never falsely blame every demanded role for an unattributed miss.
//   • Sufficiency is judged against the realized template's per-role demand:
//     a single crop-safe support candidate does NOT satisfy a multi-panel
//     template that needs several DISTINCT supports. Thresholds derive from
//     demand, not fixed constants.
//   • The counting funnel cropSafe ⊆ highRes ⊆ vettedRelevant is enforced, and
//     each demanded role must carry a measurement-complete flag (cropEvaluated).
//     A funnel violation or incomplete measurement is a *defined anomaly* that
//     yields 'insufficient-data' — never a silent coercion into a cause.
//   • Selection-evidence integrity is validated IMMEDIATELY after the
//     templateMatch boolean and BEFORE the templateMatch:false short-circuit, so
//     malformed/contradictory PRESENT selection evidence fails closed to
//     INVALID_SELECTION_EVIDENCE consistently across ALL THREE public APIs — even
//     when templateMatch:false. {templateMatch:false} with ABSENT or VALID
//     selection evidence still yields TEMPLATE_ABSENT.
//   • The raw counters vettedRelevant/highRes INTENTIONALLY may include duplicate
//     (near-identical) candidates — they measure raw supply, not distinctness.
//     Only cropSafeDistinct gated by uniquenessEvaluated governs the DISTINCT
//     demand (requiredUnique>=2). A raw pile can never satisfy a distinct demand.
//
// CONTRACT (must never break — replay/tests depend on it):
//   • No imports, no IO, no network, no Date/Math.random, no environment.
//     Given the same descriptor it returns byte-identical results forever.
//   • Every entry point is fail-closed: malformed or hostile input NEVER
//     throws — it returns a well-defined 'insufficient-data' result carrying a
//     `reason` enum token.
//   • Untrusted objects are read only through own-property descriptors
//     (never `obj.foo`, never `in`, never a getter). Accessor fields,
//     exotic prototypes, and prototype reads that throw are all treated as
//     structural anomalies -> 'insufficient-data'.
//   • Outputs carry only enum string tokens (role/cause/stage/reason) + numbers
//     — no free text that could leak or drift. Nested containers are deeply
//     frozen.
// ============================================================

export const version = 1;
const VERSION = version;

// The three cover roles a pool descriptor is expected to describe.
export const POOL_ROLES = Object.freeze(['hero', 'circle', 'support']);

// The four (and only) failure causes the classifier can return.
export const FAILURE_CAUSES = Object.freeze({
  TEMPLATE_ABSENT: 'TEMPLATE_ABSENT', // no reference template match exists
  STOCK_SHORTAGE: 'STOCK_SHORTAGE',   // MEASURED too few usable source images
  CROP_UNSAFE: 'CROP_UNSAFE',         // raw stock exists, too few survive crop-safety
  SELECTION_MISS: 'SELECTION_MISS',   // pool sufficient AND own-data proves selection failed
});
const CAUSE = FAILURE_CAUSES;

// Deterministic precedence for the single dominant cause (most upstream first).
// A template is required before anything can be placed; without raw stock you
// have nothing to crop; without crop-safe images you cannot fill a slot; only
// once the pool is fully sufficient AND selection is *proven* to have failed
// does the failure implicate selection.
export const FAILURE_CAUSE_PRECEDENCE = Object.freeze([
  CAUSE.TEMPLATE_ABSENT,
  CAUSE.STOCK_SHORTAGE,
  CAUSE.CROP_UNSAFE,
  CAUSE.SELECTION_MISS,
]);

export const READINESS_STATUS = Object.freeze({
  READY: 'ready',
  FAILURE: 'failure',
  INSUFFICIENT_DATA: 'insufficient-data',
});

// Per-role funnel stage token (which gate a role currently sits behind).
export const ROLE_STAGE = Object.freeze({
  STOCK: 'STOCK',     // not enough vetted-relevant / high-res raw material
  CROP: 'CROP',       // enough raw material, too few crop-safe
  VIABLE: 'VIABLE',   // enough crop-safe usable images exist for the demand
});

// Explicit own-data selection outcome enum (input side). Only MISS proves a
// selection failure; SUCCESS / SKIPPED are non-failures; anything absent or
// malformed is treated as UNKNOWN and never fabricates a SELECTION_MISS.
export const SELECTION_OUTCOME = Object.freeze({
  MISS: 'MISS',
  SUCCESS: 'SUCCESS',
  SKIPPED: 'SKIPPED',
});

// Internal, richer selection classification (never exported). Contradictory /
// wrong-typed / out-of-enum selection evidence never reaches these states: it is
// rejected in sanitize as INVALID_SELECTION_EVIDENCE (insufficient-data).
const SEL = Object.freeze({
  MISS: 'MISS',
  SUCCESS: 'SUCCESS',
  SKIPPED: 'SKIPPED',
  UNKNOWN: 'UNKNOWN',   // no / incomplete own-data
});

// Why a result collapsed to 'insufficient-data'. These are the ONLY ways the
// module admits "I cannot decide" — each is a defined, testable anomaly.
export const INSUFFICIENT_REASON = Object.freeze({
  STRUCTURAL: 'STRUCTURAL',                       // hostile/exotic/accessor/proxy-trap/non-object
  MISSING_TEMPLATE_MATCH: 'MISSING_TEMPLATE_MATCH', // templateMatch not reported
  MISSING_TEMPLATE_DEMAND: 'MISSING_TEMPLATE_DEMAND', // realized template demand not reported
  INVALID_TEMPLATE_DEMAND: 'INVALID_TEMPLATE_DEMAND', // demand present but out of range
  ZERO_TEMPLATE_DEMAND: 'ZERO_TEMPLATE_DEMAND',   // every role has zero demand (no role to satisfy)
  MISSING_ROLES: 'MISSING_ROLES',                 // roles container not reported
  MISSING_ROLE: 'MISSING_ROLE',                   // a demanded role's pool not reported
  MISSING_COUNTER: 'MISSING_COUNTER',             // a required count field not measured
  INVALID_COUNTER: 'INVALID_COUNTER',             // a count present but not a bounded integer
  INCOMPLETE_MEASUREMENT: 'INCOMPLETE_MEASUREMENT', // cropEvaluated flag absent / not true
  UNIQUENESS_NOT_EVALUATED: 'UNIQUENESS_NOT_EVALUATED', // >=2 distinct demanded, raw looks enough, no distinct measurement
  FUNNEL_VIOLATION: 'FUNNEL_VIOLATION',           // cropSafeDistinct>cropSafe / cropSafe>highRes / highRes>vettedRelevant
  INVALID_SELECTION_EVIDENCE: 'INVALID_SELECTION_EVIDENCE', // present selection fields conflict / wrong type / out-of-enum
  SELECTION_MISS_UNPROVEN: 'SELECTION_MISS_UNPROVEN', // pool sufficient but no proven cause
});
const REASON = INSUFFICIENT_REASON;

// Overall-readiness role importance (sums to 1 across the three fixed roles).
export const ROLE_WEIGHTS = Object.freeze({ hero: 0.5, circle: 0.3, support: 0.2 });

// Per-role score blend of the three clamped stage ratios (sums to 1). Weighted
// toward the usable/crop end because that is what actually renders on the cover.
export const DIM_WEIGHTS = Object.freeze({ vetted: 0.25, highRes: 0.3, cropSafe: 0.45 });

// Bound counts so a hostile huge number cannot poison the arithmetic. A value
// outside [0, MAX_COUNT] is treated as an INVALID measurement (not clamped).
const MAX_COUNT = 100000;

const COUNT_FIELDS = Object.freeze(['vettedRelevant', 'highRes', 'cropSafe']);

// ---------- pure numeric helpers ----------
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function round4(v) { return Math.round(v * 10000) / 10000; }

// Accept ONLY a finite integer in [0, MAX_COUNT]; anything else -> null.
// Crucially this NEVER coerces (NaN/negative/string/float/huge all fail),
// so a non-measurement can never masquerade as a measured value.
function asExactInt(v) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_COUNT) return null;
  return v;
}

function deepFreeze(obj) {
  // Freeze plain objects/arrays recursively. Primitives pass through. Used on
  // every nested container we hand back so outputs are tamper-proof.
  if (obj === null || typeof obj !== 'object') return obj;
  for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  return Object.freeze(obj);
}

// ---------- descriptor-safe untrusted reads ----------

// Accept only genuine plain objects: prototype is Object.prototype or null.
// Arrays, class instances, and exotic prototypes are rejected. The ENTIRE probe
// is wrapped in try — including Array.isArray and the prototype read — because a
// hostile or REVOKED Proxy throws a TypeError from *any* of these operations
// (Array.isArray and getPrototypeOf both throw on a revoked proxy). Any throw is
// a structural anomaly and safely collapses to `false` (never propagates).
function isSafePlainObject(v) {
  try {
    if (v === null || typeof v !== 'object') return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === null || proto === Object.prototype;
  } catch {
    return false;
  }
}

// Read one own property WITHOUT triggering getters or the `in` operator.
// Returns { ok, value, blocked }:
//   blocked=true  -> structural hostility (accessor property, or the descriptor
//                    read itself threw, e.g. a Proxy trap). Caller must bail.
//   ok=false,blocked=false -> property simply absent (benign / not measured).
function safeOwnValue(obj, key) {
  let desc;
  try {
    desc = Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    return { ok: false, blocked: true };
  }
  if (desc === undefined) return { ok: false, blocked: false };
  // An accessor descriptor would execute code if read normally — refuse it.
  if (typeof desc.get === 'function' || typeof desc.set === 'function') {
    return { ok: false, blocked: true };
  }
  return { ok: true, value: desc.value, blocked: false };
}

// ---------- optional MISS-scoping evidence (own-data only) ----------
//
// A proven SELECTION_MISS may optionally be SCOPED to the specific role(s) whose
// slot(s) selection failed to fill, via own-data `failedRoles` (an array of role
// tokens) and/or `failedSlots` (a plain object mapping a role token to a
// non-empty array of failed slot indices). Both are read descriptor-only and
// validated STRUCTURALLY here (genuine array / plain object, known POOL_ROLES
// tokens, bounded-integer slot indices). The demand-subset check — a scoped role
// must be a role the realized template actually DEMANDS — needs the template
// demand and so is applied later, in sanitize. Absent scoping yields null: the
// miss is then an UNSCOPED GLOBAL miss (offendingRoles empty; never blames all).

// ---------- safe array probe (every untrusted array goes through this) ----------
//
// A genuine array whose prototype is EXACTLY Array.prototype. BOTH Array.isArray
// AND the prototype read are wrapped in ONE try — a hostile/revoked Proxy throws
// from either, and an Array subclass / exotic proto must be refused even though
// Array.isArray reports true. { blocked } signals a throwing trap (structural
// hostility); { ok:false } is a benign "not a proper Array.prototype array".
// Never propagates a throw.
function probeArray(v) {
  try {
    if (!Array.isArray(v)) return { ok: false };
    if (Object.getPrototypeOf(v) !== Array.prototype) return { ok: false };
    return { ok: true };
  } catch {
    return { blocked: true };
  }
}

// A canonical array-index string in [0, len): a non-negative integer with no
// leading zeros whose round-trip equals the key.
function isIndexInRange(key, len) {
  const n = Number(key);
  if (!Number.isInteger(n) || n < 0 || n >= len) return false;
  return String(n) === key;
}

// Enumerate an array's OWN keys via Reflect.ownKeys — which surfaces SYMBOL and
// NON-ENUMERABLE keys that Object.keys hides — and require they be EXACTLY the
// canonical indices [0,len) plus 'length'. Any symbol key, any hidden/non-index
// string key, or a throwing ownKeys trap is an anomaly -> false. Never throws.
function arrayKeysClean(arr, len) {
  let keys;
  try { keys = Reflect.ownKeys(arr); } catch { return false; }
  for (const k of keys) {
    if (typeof k === 'symbol') return false;
    if (k === 'length') continue;
    if (!isIndexInRange(k, len)) return false;
  }
  return true;
}

// Read a genuine own array by descriptor (never triggers getters). A hostile /
// revoked proxy throws from the array probe or the descriptor read -> blocked.
// An Array subclass / exotic-proto / non-array -> invalid. A symbol or hidden
// non-index own key -> invalid.
//   { blocked } | { invalid } | { absent } | { arr, len }
function readOwnArray(obj, key) {
  const o = safeOwnValue(obj, key);
  if (o.blocked) return { blocked: true };
  if (!o.ok) return { absent: true };
  const p = probeArray(o.value);
  if (p.blocked) return { blocked: true };
  if (!p.ok) return { invalid: true };
  const lenD = safeOwnValue(o.value, 'length');
  if (lenD.blocked) return { blocked: true };
  const len = lenD.ok ? lenD.value : null;
  if (typeof len !== 'number' || !Number.isInteger(len) || len < 0 || len > MAX_COUNT) {
    return { invalid: true };
  }
  if (!arrayKeysClean(o.value, len)) return { invalid: true };
  return { arr: o.value, len };
}

// failedRoles -> deduped, canonically-ordered set of role tokens.
//   { blocked } | { invalid } | { roles: null (absent) | [tokens...] }
function readFailedRoles(input) {
  const a = readOwnArray(input, 'failedRoles');
  if (a.blocked) return { blocked: true };
  if (a.invalid) return { invalid: true };
  if (a.absent) return { roles: null };
  if (a.len === 0) return { invalid: true }; // present but scopes nothing -> contradictory
  const seen = new Set();
  for (let i = 0; i < a.len; i++) {
    const e = safeOwnValue(a.arr, String(i));
    if (e.blocked) return { blocked: true };
    if (!e.ok) return { invalid: true };                               // hole in the array
    if (typeof e.value !== 'string' || !POOL_ROLES.includes(e.value)) return { invalid: true };
    seen.add(e.value);
  }
  return { roles: POOL_ROLES.filter((r) => seen.has(r)) };
}

// A genuine own array of bounded-integer slot indices, PRESERVED IN ORDER. This
// is STRUCTURAL validation only — the role-relative range / duplicate / cap checks
// need the realized template demand and run later in sanitize. Same hostile-array
// rejection as readOwnArray (exact Array.prototype, no symbol / hidden keys).
//   { blocked } | { invalid } | { indices: [ints...] }
function readSlotArray(value) {
  const p = probeArray(value);
  if (p.blocked) return { blocked: true };
  if (!p.ok) return { invalid: true };
  const lenD = safeOwnValue(value, 'length');
  if (lenD.blocked) return { blocked: true };
  const len = lenD.ok ? lenD.value : null;
  if (typeof len !== 'number' || !Number.isInteger(len) || len < 1 || len > MAX_COUNT) {
    return { invalid: true }; // must name at least one bounded slot index
  }
  if (!arrayKeysClean(value, len)) return { invalid: true };
  const indices = [];
  for (let i = 0; i < len; i++) {
    const e = safeOwnValue(value, String(i));
    if (e.blocked) return { blocked: true };
    if (!e.ok) return { invalid: true }; // hole in the array
    const n = asExactInt(e.value);
    if (n === null) return { invalid: true };
    indices.push(n);
  }
  return { indices };
}

// failedSlots -> a plain object whose OWN keys are role tokens, each mapping to a
// non-empty array of bounded-integer slot indices. OWN keys are enumerated via
// Reflect.ownKeys so a SYMBOL key or a HIDDEN (non-enumerable) non-role key is
// rejected too. The per-role index lists are PRESERVED as a CANONICAL slot map
// (role -> [indices]) — NOT reduced to bare role names; role-relative
// range/duplicate/cap validation runs in sanitize once the demand is known.
//   { blocked } | { invalid } | { slotMap: null (absent) | { role: [ints...] } }
function readFailedSlots(input) {
  const o = safeOwnValue(input, 'failedSlots');
  if (o.blocked) return { blocked: true };
  if (!o.ok) return { slotMap: null };
  if (!isSafePlainObject(o.value)) return { invalid: true };
  const obj = o.value;
  let ownKeys;
  try { ownKeys = Reflect.ownKeys(obj); } catch { return { blocked: true }; }
  for (const k of ownKeys) {
    if (typeof k === 'symbol') return { invalid: true };   // no symbol keys
    if (!POOL_ROLES.includes(k)) return { invalid: true }; // stray non-role key (incl. non-enumerable)
  }
  const slotMap = {};
  let count = 0;
  for (const role of POOL_ROLES) {
    const sf = safeOwnValue(obj, role);
    if (sf.blocked) return { blocked: true };
    if (!sf.ok) continue;
    const a = readSlotArray(sf.value);
    if (a.blocked) return { blocked: true };
    if (a.invalid) return { invalid: true };
    slotMap[role] = a.indices; // canonical per-role slot index list (order preserved)
    count++;
  }
  if (count === 0) return { invalid: true }; // present but scopes nothing
  return { slotMap };
}

// Union of the two optional scope sources -> canonically-ordered array, or null
// when neither was provided.
function mergeScopedRoles(a, b) {
  if (a === null && b === null) return null;
  const set = new Set([...(a || []), ...(b || [])]);
  return POOL_ROLES.filter((r) => set.has(r));
}

// ---------- selection outcome (own-data only) ----------
//
// Returns one of:
//   { blocked: true }  -> structural hostility (accessor / proxy trap threw).
//   { invalid: true }  -> selection evidence is PRESENT but internally invalid:
//                         a non-boolean flag, an out-of-enum outcome, a
//                         conflicting combination (e.g. attempted:false together
//                         with failed:true, or an outcome that disagrees with the
//                         booleans), malformed failedRoles/failedSlots, or scope
//                         evidence supplied WITHOUT a proven miss. Every PRESENT
//                         field is validated.
//   { state, scope }   -> a SEL token (MISS/SUCCESS/SKIPPED/UNKNOWN) plus the
//                         structurally-validated scoped-role set (array | null).
//                         scope is non-null ONLY when state === MISS.
//
// SELECTION_MISS is proven ONLY by an explicit MISS outcome or by the full
// boolean pair attempted===true && failed===true. Missing / partial evidence is
// UNKNOWN and can never fabricate a miss; contradictory evidence is INVALID and
// fails closed to insufficient-data upstream.
function readSelection(input) {
  const oOutcome = safeOwnValue(input, 'selectionOutcome');
  if (oOutcome.blocked) return { blocked: true };
  const oAtt = safeOwnValue(input, 'selectionAttempted');
  if (oAtt.blocked) return { blocked: true };
  const oFail = safeOwnValue(input, 'selectionFailed');
  if (oFail.blocked) return { blocked: true };

  // Optional MISS-scoping evidence — validated structurally here; scope may only
  // accompany a proven MISS (checked below) and only name demanded roles (later).
  const froles = readFailedRoles(input);
  if (froles.blocked) return { blocked: true };
  if (froles.invalid) return { invalid: true };
  const fslots = readFailedSlots(input);
  if (fslots.blocked) return { blocked: true };
  if (fslots.invalid) return { invalid: true };
  const slotMap = fslots.slotMap; // { role: [ints] } | null (STRUCTURALLY valid)
  const slotRoles = slotMap === null
    ? null
    : POOL_ROLES.filter((r) => Object.prototype.hasOwnProperty.call(slotMap, r));
  const scope = mergeScopedRoles(froles.roles, slotRoles); // array | null

  const hasOutcome = oOutcome.ok;
  const hasAtt = oAtt.ok;
  const hasFail = oFail.ok;

  // No selection evidence of ANY kind -> UNKNOWN (never fabricates a miss).
  // scope === null implies slotMap === null (a non-empty slotMap yields scope).
  if (!hasOutcome && !hasAtt && !hasFail && scope === null) return { state: SEL.UNKNOWN, scope: null, slotMap: null };

  // Type-validate every PRESENT field.
  if (hasAtt && typeof oAtt.value !== 'boolean') return { invalid: true };
  if (hasFail && typeof oFail.value !== 'boolean') return { invalid: true };
  let outcomeState = null;
  if (hasOutcome) {
    const v = oOutcome.value;
    if (v === SELECTION_OUTCOME.MISS) outcomeState = SEL.MISS;
    else if (v === SELECTION_OUTCOME.SUCCESS) outcomeState = SEL.SUCCESS;
    else if (v === SELECTION_OUTCOME.SKIPPED) outcomeState = SEL.SKIPPED;
    else return { invalid: true }; // present but not a known enum token
  }

  const att = hasAtt ? oAtt.value : null;
  const fail = hasFail ? oFail.value : null;

  // Combination validation: "not attempted" cannot have "failed".
  if (att === false && fail === true) return { invalid: true };

  let state;
  if (outcomeState !== null) {
    // Cross-field consistency: any present boolean must agree with the outcome.
    let expAtt; let expFail;
    if (outcomeState === SEL.MISS) { expAtt = true; expFail = true; }
    else if (outcomeState === SEL.SUCCESS) { expAtt = true; expFail = false; }
    else { expAtt = false; expFail = false; } // SKIPPED
    if (hasAtt && att !== expAtt) return { invalid: true };
    if (hasFail && fail !== expFail) return { invalid: true };
    state = outcomeState;
  } else if (att === true) {
    // No outcome token: derive purely from the boolean pair.
    if (fail === true) state = SEL.MISS;
    else if (fail === false) state = SEL.SUCCESS;
    else state = SEL.UNKNOWN; // attempted, but outcome not stated
  } else if (att === false) {
    state = SEL.SKIPPED; // (att:false + fail:true already rejected)
  } else {
    // No `selectionAttempted` flag -> cannot assert an attempt was made. A lone
    // failed flag is incomplete (not contradictory) -> UNKNOWN, never a miss.
    state = SEL.UNKNOWN;
  }

  // Scope is only coherent alongside a PROVEN miss: naming failed roles/slots
  // while selection did not (provably) miss is contradictory -> fail closed.
  if (scope !== null && state !== SEL.MISS) return { invalid: true };

  return { state, scope, slotMap };
}

// ---------- realized template demand ----------
//
// The realized template dictates, per role, how many panels (requiredSlots) and
// how many DISTINCT usable images (requiredUnique) are needed. Valid demand is
// either (0,0) — role unused — or (slots>=1, 1<=unique<=slots). Anything else is
// a defined anomaly. Every role's demand must be stated explicitly (no guessing).
function readTemplateDemand(input) {
  const tf = safeOwnValue(input, 'template');
  if (tf.blocked) return { reason: REASON.STRUCTURAL };
  if (!tf.ok) return { reason: REASON.MISSING_TEMPLATE_DEMAND };
  if (!isSafePlainObject(tf.value)) return { reason: REASON.STRUCTURAL };

  const rolesField = safeOwnValue(tf.value, 'roles');
  if (rolesField.blocked) return { reason: REASON.STRUCTURAL };
  if (!rolesField.ok) return { reason: REASON.MISSING_TEMPLATE_DEMAND };
  if (!isSafePlainObject(rolesField.value)) return { reason: REASON.STRUCTURAL };

  const demand = {};
  for (const role of POOL_ROLES) {
    const rf = safeOwnValue(rolesField.value, role);
    if (rf.blocked) return { reason: REASON.STRUCTURAL };
    if (!rf.ok) return { reason: REASON.MISSING_TEMPLATE_DEMAND };
    if (!isSafePlainObject(rf.value)) return { reason: REASON.STRUCTURAL };

    const sf = safeOwnValue(rf.value, 'requiredSlots');
    if (sf.blocked) return { reason: REASON.STRUCTURAL };
    const uf = safeOwnValue(rf.value, 'requiredUnique');
    if (uf.blocked) return { reason: REASON.STRUCTURAL };
    if (!sf.ok || !uf.ok) return { reason: REASON.INVALID_TEMPLATE_DEMAND };

    const slots = asExactInt(sf.value);
    const uniq = asExactInt(uf.value);
    if (slots === null || uniq === null) return { reason: REASON.INVALID_TEMPLATE_DEMAND };
    if (uniq > slots) return { reason: REASON.INVALID_TEMPLATE_DEMAND };
    if (slots > 0 && uniq < 1) return { reason: REASON.INVALID_TEMPLATE_DEMAND };
    if (slots === 0 && uniq !== 0) return { reason: REASON.INVALID_TEMPLATE_DEMAND };

    demand[role] = { requiredSlots: slots, requiredUnique: uniq };
  }
  // A realized template must demand at least one role. Zero total demand across
  // every role is invalid input (there is nothing to satisfy) -> insufficient.
  if (!POOL_ROLES.some((role) => demand[role].requiredUnique >= 1)) {
    return { reason: REASON.ZERO_TEMPLATE_DEMAND };
  }
  return { demand };
}

// ---------- measured role pools ----------
//
// A role that the template DEMANDS (requiredUnique>=1) must be fully measured:
// all three counters present as bounded integers, an explicit cropEvaluated
// completeness flag, and a funnel that actually holds. A role the template does
// not use (requiredUnique===0) needs no measurement — it is trivially satisfied.
function readRoles(input, demand) {
  const rf = safeOwnValue(input, 'roles');
  if (rf.blocked) return { reason: REASON.STRUCTURAL };
  if (!rf.ok) return { reason: REASON.MISSING_ROLES };
  if (!isSafePlainObject(rf.value)) return { reason: REASON.STRUCTURAL };
  const container = rf.value;

  const roles = {};
  for (const role of POOL_ROLES) {
    const need = demand[role].requiredUnique;
    const rObj = safeOwnValue(container, role);
    if (rObj.blocked) return { reason: REASON.STRUCTURAL };

    if (need === 0) {
      // Role not used by the realized template — no measurement required.
      roles[role] = {
        vettedRelevant: 0, highRes: 0, cropSafe: 0,
        cropEvaluated: true, uniquenessEvaluated: true, cropSafeDistinct: 0, measured: false,
      };
      continue;
    }

    if (!rObj.ok) return { reason: REASON.MISSING_ROLE };
    if (!isSafePlainObject(rObj.value)) return { reason: REASON.STRUCTURAL };
    const roleObj = rObj.value;

    const counts = { vettedRelevant: 0, highRes: 0, cropSafe: 0 };
    for (const field of COUNT_FIELDS) {
      const cf = safeOwnValue(roleObj, field);
      if (cf.blocked) return { reason: REASON.STRUCTURAL };
      if (!cf.ok) return { reason: REASON.MISSING_COUNTER }; // never measured
      const n = asExactInt(cf.value);
      if (n === null) return { reason: REASON.INVALID_COUNTER }; // present but not a clean count
      counts[field] = n;
    }

    const ce = safeOwnValue(roleObj, 'cropEvaluated');
    if (ce.blocked) return { reason: REASON.STRUCTURAL };
    if (!ce.ok || ce.value !== true) return { reason: REASON.INCOMPLETE_MEASUREMENT };

    // Enforce cropSafe ⊆ highRes ⊆ vettedRelevant. A violation is an anomaly,
    // never silently coerced.
    if (counts.cropSafe > counts.highRes || counts.highRes > counts.vettedRelevant) {
      return { reason: REASON.FUNNEL_VIOLATION };
    }

    // ---- uniqueness-completeness contract ----
    // requiredUnique counts DISTINCT usable images. A raw cropSafe total may hold
    // near-duplicates, so a raw count can NEVER prove requiredUnique. We read an
    // OPTIONAL measured distinct count (cropSafeDistinct) gated by an explicit
    // uniquenessEvaluated flag. Distinct can never exceed the raw crop-safe pile.
    const uq = safeOwnValue(roleObj, 'uniquenessEvaluated');
    if (uq.blocked) return { reason: REASON.STRUCTURAL };
    const cd = safeOwnValue(roleObj, 'cropSafeDistinct');
    if (cd.blocked) return { reason: REASON.STRUCTURAL };

    let uniquenessEvaluated = false;
    let cropSafeDistinct = null;
    if (uq.ok) {
      if (uq.value !== true && uq.value !== false) return { reason: REASON.INCOMPLETE_MEASUREMENT };
      if (uq.value === true) {
        if (!cd.ok) return { reason: REASON.MISSING_COUNTER };       // flag set, count absent
        const nd = asExactInt(cd.value);
        if (nd === null) return { reason: REASON.INVALID_COUNTER };  // count not a clean int
        if (nd > counts.cropSafe) return { reason: REASON.FUNNEL_VIOLATION }; // distinct <= raw
        uniquenessEvaluated = true;
        cropSafeDistinct = nd;
      } else if (cd.ok) {
        // Distinct count reported but uniqueness explicitly NOT evaluated -> contradictory.
        return { reason: REASON.INCOMPLETE_MEASUREMENT };
      }
    } else if (cd.ok) {
      // Distinct count reported with no evaluation flag at all -> contradictory.
      return { reason: REASON.INCOMPLETE_MEASUREMENT };
    }

    // Mandatory gate: when the template needs >=2 DISTINCT images AND the raw
    // crop-safe pile is numerically large enough to LOOK sufficient, distinctness
    // MUST have been measured. Absent that, we cannot rule out all-duplicate piles
    // -> fail closed (a raw count must never satisfy requiredUnique>=2).
    if (need >= 2 && counts.cropSafe >= need && !uniquenessEvaluated) {
      return { reason: REASON.UNIQUENESS_NOT_EVALUATED };
    }

    counts.cropEvaluated = true;
    counts.uniquenessEvaluated = uniquenessEvaluated;
    counts.cropSafeDistinct = cropSafeDistinct; // null when uniqueness not evaluated
    counts.measured = true;
    roles[role] = counts;
  }
  return { roles };
}

// Turn arbitrary untrusted input into a clean, fully-measured descriptor, or a
// defined { ok:false, reason } insufficiency.
//
// ORDERING (audit remediation): selection-evidence integrity is validated
// IMMEDIATELY after the templateMatch boolean and BEFORE the templateMatch:false
// short-circuit. Malformed/contradictory PRESENT selection evidence therefore
// fails closed to INVALID_SELECTION_EVIDENCE uniformly across all three public
// APIs — even when templateMatch:false. templateMatch===false with ABSENT or
// VALID selection evidence still short-circuits to a template-absent verdict (an
// EXPLICIT measured outcome) without demanding pool telemetry.
function sanitizeDescriptor(input) {
  if (!isSafePlainObject(input)) return { ok: false, reason: REASON.STRUCTURAL };

  const tm = safeOwnValue(input, 'templateMatch');
  if (tm.blocked) return { ok: false, reason: REASON.STRUCTURAL };
  if (!tm.ok) return { ok: false, reason: REASON.MISSING_TEMPLATE_MATCH }; // not measured
  if (tm.value !== true && tm.value !== false) return { ok: false, reason: REASON.STRUCTURAL };

  // Validate PRESENT selection evidence up front — before the false short-circuit.
  const sel = readSelection(input);
  if (sel.blocked) return { ok: false, reason: REASON.STRUCTURAL };
  if (sel.invalid) return { ok: false, reason: REASON.INVALID_SELECTION_EVIDENCE };

  if (tm.value === false) {
    return { ok: true, clean: { templateMatch: false } };
  }

  const dem = readTemplateDemand(input);
  if (dem.reason) return { ok: false, reason: dem.reason };

  const rls = readRoles(input, dem.demand);
  if (rls.reason) return { ok: false, reason: rls.reason };

  // Semantic scope check (needs demand): a scoped miss may name ONLY roles the
  // realized template actually demands. Naming an unused/undemanded role is
  // invalid selection evidence -> fail closed.
  if (sel.scope !== null) {
    const demandedSet = new Set(demandedRolesOf(dem.demand));
    for (const role of sel.scope) {
      if (!demandedSet.has(role)) return { ok: false, reason: REASON.INVALID_SELECTION_EVIDENCE };
    }
  }

  // Role-relative slot validation (needs the realized demand): each slot index
  // must satisfy 0 <= i < requiredSlots(role); duplicate indices within a role are
  // rejected (explicit set policy — NO silent dedup); the per-role list is capped
  // by that role's slot demand. The validated slot scope is preserved for the
  // deeply-frozen evidence.
  let selectionSlots = null;
  if (sel.slotMap !== null) {
    selectionSlots = {};
    for (const role of POOL_ROLES) {
      if (!Object.prototype.hasOwnProperty.call(sel.slotMap, role)) continue;
      const required = dem.demand[role].requiredSlots; // role is demanded (scope ⊆ demanded)
      const indices = sel.slotMap[role];
      const seenIdx = new Set();
      for (const idx of indices) {
        if (idx < 0 || idx >= required) return { ok: false, reason: REASON.INVALID_SELECTION_EVIDENCE }; // out of range
        if (seenIdx.has(idx)) return { ok: false, reason: REASON.INVALID_SELECTION_EVIDENCE };            // duplicate
        seenIdx.add(idx);
      }
      if (indices.length > required) return { ok: false, reason: REASON.INVALID_SELECTION_EVIDENCE };      // cap by demand
      selectionSlots[role] = [...indices];
    }
  }

  return {
    ok: true,
    clean: {
      templateMatch: true,
      demand: dem.demand,
      roles: rls.roles,
      selection: sel.state,
      selectionScope: sel.scope,   // array (⊆ demanded) | null (unscoped global)
      selectionSlots,              // { role: [validated indices] } | null
    },
  };
}

// ---------- core computations (operate on sanitized data only) ----------

function computeRoleDetail(role, counts, demand) {
  const U = demand.requiredUnique;
  const vetted = counts.vettedRelevant;
  const hi = counts.highRes;
  const crop = counts.cropSafe;
  const uniquenessEvaluated = counts.uniquenessEvaluated === true;
  const measuredDistinct = counts.cropSafeDistinct; // int when evaluated, else null

  // The usable count judged against requiredUnique is the MEASURED distinct count
  // when uniqueness was evaluated, otherwise the raw crop-safe total. readRoles
  // has already guaranteed that a raw total can only be used here when U<=1 (a
  // nonempty pile trivially yields >=1 distinct) or when the raw total is itself
  // < U — so a raw pile can never masquerade as >=U distinct for U>=2.
  const effectiveDistinct = uniquenessEvaluated ? measuredDistinct : crop;

  let stockOk;
  let cropOk;
  let stage;
  let score;
  if (U === 0) {
    // Role not demanded by the realized template -> trivially satisfied.
    stockOk = true;
    cropOk = true;
    stage = ROLE_STAGE.VIABLE;
    score = 1;
  } else {
    // Thresholds are DERIVED FROM DEMAND: to place U distinct usable images you
    // need >=U crop-safe DISTINCT (hence >=U high-res and >=U vetted by the funnel).
    stockOk = vetted >= U && hi >= U;
    cropOk = effectiveDistinct >= U;
    stage = !stockOk ? ROLE_STAGE.STOCK : (!cropOk ? ROLE_STAGE.CROP : ROLE_STAGE.VIABLE);
    score = round4(
      DIM_WEIGHTS.vetted * clamp01(vetted / U) +
      DIM_WEIGHTS.highRes * clamp01(hi / U) +
      DIM_WEIGHTS.cropSafe * clamp01(effectiveDistinct / U),
    );
  }

  const sufficient = stockOk && cropOk;
  return Object.freeze({
    role,
    sufficient,
    score,
    stage,
    vettedRelevant: vetted,
    highRes: hi,
    cropSafe: crop,
    cropSafeDistinct: uniquenessEvaluated ? measuredDistinct : null,
    uniquenessEvaluated,
    requiredSlots: demand.requiredSlots,
    requiredUnique: U,
    minVetted: U,
    minHighRes: U,
    minCropSafe: U,
  });
}

function computeReadiness(clean) {
  const roles = {};
  let allSufficient = true;
  // Weighted readiness is computed over DEMANDED roles only: a role the template
  // does not use contributes no demand and must not inflate (or deflate) the
  // score. Weights are renormalized across the demanded roles so they sum to 1.
  let weightSum = 0;
  let weightedScore = 0;
  for (const role of POOL_ROLES) {
    const demand = clean.demand[role];
    const detail = computeRoleDetail(role, clean.roles[role], demand);
    roles[role] = detail;
    if (!detail.sufficient) allSufficient = false;
    if (demand.requiredUnique >= 1) {
      weightSum += ROLE_WEIGHTS[role];
      weightedScore += ROLE_WEIGHTS[role] * detail.score;
    }
  }
  // weightSum > 0 is guaranteed: zero total demand is rejected in sanitize
  // (ZERO_TEMPLATE_DEMAND) before we ever score a pool.
  const poolScore = round4(weightedScore / weightSum);
  // templateMatch is guaranteed true on this path (the false case short-circuits
  // to TEMPLATE_ABSENT before we ever score a pool), so readiness == poolScore.
  return {
    roles: Object.freeze(roles), // container + each detail frozen == deep-frozen
    poolScore,
    readinessScore: poolScore,
    ready: allSufficient,
    allSufficient,
  };
}

// The roles a realized template actually demands (requiredUnique >= 1). Only
// these can ever be named as offending — an unused role has nothing to answer for.
function demandedRolesOf(demand) {
  return POOL_ROLES.filter((role) => demand[role].requiredUnique >= 1);
}

function buildRoleEvidence(roles) {
  const out = {};
  for (const role of POOL_ROLES) {
    const d = roles[role];
    out[role] = Object.freeze({
      stage: d.stage,
      sufficient: d.sufficient,
      vettedRelevant: d.vettedRelevant,
      highRes: d.highRes,
      cropSafe: d.cropSafe,
      cropSafeDistinct: d.cropSafeDistinct,
      uniquenessEvaluated: d.uniquenessEvaluated,
      requiredSlots: d.requiredSlots,
      requiredUnique: d.requiredUnique,
      minVetted: d.minVetted,
      minHighRes: d.minHighRes,
      minCropSafe: d.minCropSafe,
    });
  }
  return Object.freeze(out);
}

// Every cause evidence object shares ONE canonical fixed field set and key order —
// { cause, templatePresent, offendingRoles, missScope, failedSlots, roles } — so
// the shape is structurally identical regardless of cause. missScope/failedSlots
// carry the SELECTION_MISS scope (else null); non-selection causes still carry
// both fields as null.
function makeCause(cause, offendingRolesArr, roleEvidence, missScope = null, failedSlots = null) {
  const offending = Object.freeze([...offendingRolesArr]);
  return {
    cause,
    offendingRoles: offending,
    evidence: deepFreeze({
      cause,
      templatePresent: true,
      offendingRoles: offending,
      missScope,   // 'SCOPED' | 'GLOBAL' for SELECTION_MISS, else null
      failedSlots, // { role: [validated indices] } for a SCOPED miss, else null
      roles: roleEvidence,
    }),
  };
}

// Build a proven SELECTION_MISS cause. When own-data scoped the miss to specific
// (demanded) roles, offendingRoles is exactly that scope and missScope='SCOPED'.
// An UNSCOPED miss has EMPTY offendingRoles and missScope='GLOBAL' — it never
// falsely blames every demanded role for an unattributed selection failure.
function buildSelectionMiss(clean, roleEvidence) {
  const scope = clean.selectionScope; // array (⊆ demanded, non-empty) | null
  if (scope !== null && scope.length > 0) {
    // clean.selectionSlots is the validated per-role slot map, or null when the
    // scope came only from failedRoles (still SCOPED, no slot-level detail).
    return makeCause(CAUSE.SELECTION_MISS, scope, roleEvidence, 'SCOPED', clean.selectionSlots);
  }
  return makeCause(CAUSE.SELECTION_MISS, [], roleEvidence, 'GLOBAL', null);
}

// Classify a template-present pool. Returns either { cause, offendingRoles,
// evidence } or { insufficient:true, reason } when no cause can be PROVEN.
function classifyPresent(clean, readiness) {
  const roleEvidence = buildRoleEvidence(readiness.roles);
  // Offending roles are drawn ONLY from the roles the template demands; an unused
  // role is trivially satisfied (stage VIABLE) and can never be blamed.
  const demanded = demandedRolesOf(clean.demand);

  // 1) Any DEMANDED role with an EXPLICIT shortfall of raw/usable stock (measured).
  const stockRoles = demanded.filter((r) => readiness.roles[r].stage === ROLE_STAGE.STOCK);
  if (stockRoles.length > 0) return makeCause(CAUSE.STOCK_SHORTAGE, stockRoles, roleEvidence);

  // 2) Enough stock everywhere, but some DEMANDED role fails crop-safety (measured).
  const cropRoles = demanded.filter((r) => readiness.roles[r].stage === ROLE_STAGE.CROP);
  if (cropRoles.length > 0) return makeCause(CAUSE.CROP_UNSAFE, cropRoles, roleEvidence);

  // 3) Pool fully sufficient. The failure implicates selection ONLY if own-data
  //    proves it. No residual / by-elimination SELECTION_MISS. A proven miss is
  //    scoped to its failed roles when own-data says so, else unscoped-global.
  if (clean.selection === SEL.MISS) {
    return buildSelectionMiss(clean, roleEvidence);
  }
  return { insufficient: true, reason: REASON.SELECTION_MISS_UNPROVEN, roleEvidence };
}

// ---------- fail-closed result shapes ----------

function insufficientReadiness(reason) {
  return Object.freeze({
    version: VERSION,
    status: READINESS_STATUS.INSUFFICIENT_DATA,
    ready: false,
    readinessScore: 0,
    poolScore: 0,
    templatePresent: false,
    roles: null,
    reason,
  });
}

function insufficientAssessment(reason) {
  return Object.freeze({
    version: VERSION,
    status: READINESS_STATUS.INSUFFICIENT_DATA,
    ready: false,
    readinessScore: 0,
    poolScore: 0,
    templatePresent: false,
    roles: null,
    dominantCause: null,
    evidence: null,
    reason,
  });
}

function insufficientClassification(reason) {
  return Object.freeze({
    version: VERSION,
    status: READINESS_STATUS.INSUFFICIENT_DATA,
    cause: null,
    evidence: null,
    reason,
  });
}

function templateAbsentEvidence() {
  // Same canonical fixed shape/key order as makeCause (P2): non-selection cause,
  // so missScope and failedSlots are null; no pool telemetry, so roles is null.
  return deepFreeze({
    cause: CAUSE.TEMPLATE_ABSENT,
    templatePresent: false,
    offendingRoles: [],
    missScope: null,
    failedSlots: null,
    roles: null,
  });
}

// ---------- public API ----------

// Per-role + overall pool sufficiency / readiness. Readiness is about whether the
// material exists, so selection is never used to derive a verdict here — but the
// shared sanitize still validates any PRESENT selection fields for integrity, so
// contradictory selection evidence fails closed to insufficient-data. Fail-closed.
export function evaluatePoolReadiness(input) {
  try {
    const s = sanitizeDescriptor(input);
    if (!s.ok) return insufficientReadiness(s.reason);
    if (s.clean.templateMatch === false) {
      return Object.freeze({
        version: VERSION,
        status: READINESS_STATUS.FAILURE,
        ready: false,
        readinessScore: 0,
        poolScore: 0,
        templatePresent: false,
        roles: null,
        reason: null,
      });
    }
    const r = computeReadiness(s.clean);
    return Object.freeze({
      version: VERSION,
      status: r.ready ? READINESS_STATUS.READY : READINESS_STATUS.FAILURE,
      ready: r.ready,
      readinessScore: r.readinessScore,
      poolScore: r.poolScore,
      templatePresent: true,
      roles: r.roles, // deep-frozen
      reason: null,
    });
  } catch {
    // Absolute backstop: no untrusted-input path (incl. a revoked/throwing Proxy)
    // may ever throw out of a public entry point. Fail closed to insufficient-data.
    return insufficientReadiness(REASON.STRUCTURAL);
  }
}

// Given a cover build that FAILED, return the single dominant cause. A fully
// sufficient pool is classified as SELECTION_MISS ONLY when own-data proves
// selection was attempted and failed; otherwise the cause cannot be attributed
// and the result is 'insufficient-data' (SELECTION_MISS_UNPROVEN). Fail-closed.
export function classifyPoolFailure(input) {
  try {
    const s = sanitizeDescriptor(input);
    if (!s.ok) return insufficientClassification(s.reason);

    if (s.clean.templateMatch === false) {
      return Object.freeze({
        version: VERSION,
        status: 'classified',
        cause: CAUSE.TEMPLATE_ABSENT,
        evidence: templateAbsentEvidence(),
        reason: null,
      });
    }

    const readiness = computeReadiness(s.clean);
    const c = classifyPresent(s.clean, readiness);
    if (c.insufficient) return insufficientClassification(c.reason);
    return Object.freeze({
      version: VERSION,
      status: 'classified',
      cause: c.cause,
      evidence: c.evidence,
      reason: null,
    });
  } catch {
    return insufficientClassification(REASON.STRUCTURAL);
  }
}

// Combined view: readiness + (when the build failed) the dominant cause. A pool
// can be materially `ready:true` yet report status FAILURE with dominantCause
// SELECTION_MISS when own-data proves selection failed. A ready pool with no
// proven selection failure reports status READY / dominantCause null. Fail-closed.
export function assessSearchQuality(input) {
  try {
    const s = sanitizeDescriptor(input);
    if (!s.ok) return insufficientAssessment(s.reason);

    if (s.clean.templateMatch === false) {
      return Object.freeze({
        version: VERSION,
        status: READINESS_STATUS.FAILURE,
        ready: false,
        readinessScore: 0,
        poolScore: 0,
        templatePresent: false,
        roles: null,
        dominantCause: CAUSE.TEMPLATE_ABSENT,
        evidence: templateAbsentEvidence(),
        reason: null,
      });
    }

    const readiness = computeReadiness(s.clean);

    if (!readiness.ready) {
      // Some role is STOCK or CROP -> classifyPresent returns a measured cause
      // (never the selection branch, since not all roles are VIABLE).
      const c = classifyPresent(s.clean, readiness);
      return Object.freeze({
        version: VERSION,
        status: READINESS_STATUS.FAILURE,
        ready: false,
        readinessScore: readiness.readinessScore,
        poolScore: readiness.poolScore,
        templatePresent: true,
        roles: readiness.roles,
        dominantCause: c.cause,
        evidence: c.evidence,
        reason: null,
      });
    }

    // Pool is materially ready. Surface SELECTION_MISS only if own-data proves it
    // (scoped to failed roles when supplied, else unscoped-global).
    if (s.clean.selection === SEL.MISS) {
      const c = buildSelectionMiss(s.clean, buildRoleEvidence(readiness.roles));
      return Object.freeze({
        version: VERSION,
        status: READINESS_STATUS.FAILURE,
        ready: true,
        readinessScore: readiness.readinessScore,
        poolScore: readiness.poolScore,
        templatePresent: true,
        roles: readiness.roles,
        dominantCause: CAUSE.SELECTION_MISS,
        evidence: c.evidence,
        reason: null,
      });
    }

    return Object.freeze({
      version: VERSION,
      status: READINESS_STATUS.READY,
      ready: true,
      readinessScore: readiness.readinessScore,
      poolScore: readiness.poolScore,
      templatePresent: true,
      roles: readiness.roles,
      dominantCause: null,
      evidence: null,
      reason: null,
    });
  } catch {
    return insufficientAssessment(REASON.STRUCTURAL);
  }
}

export default Object.freeze({
  version,
  POOL_ROLES,
  FAILURE_CAUSES,
  FAILURE_CAUSE_PRECEDENCE,
  READINESS_STATUS,
  ROLE_STAGE,
  SELECTION_OUTCOME,
  INSUFFICIENT_REASON,
  ROLE_WEIGHTS,
  DIM_WEIGHTS,
  evaluatePoolReadiness,
  classifyPoolFailure,
  assessSearchQuality,
});
