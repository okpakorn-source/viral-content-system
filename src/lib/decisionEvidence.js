// Decision Evidence core (v1) — privacy-safe telemetry primitive.
// ------------------------------------------------------------------
// A compact, SAFE-TO-PERSIST/SHIP carrier that records "why this slot chose
// this candidate" during MEGA cover composition. It is a standalone LANE-A
// primitive: NOT wired into any pipeline, queue, spec, or route. It exists so
// that a future consumer can attach an audit-grade, privacy-hardened reason
// trail to a job WITHOUT ever leaking a URL, a search query, a person's name,
// a file path, or any base64/data-URI blob.
//
// PURITY CONTRACT (this file must stay loadable by bare `node` with NO
// node_modules and NO build step):
//   • no imports (Node built-in globals only — TextEncoder is a global)
//   • no network, no filesystem, no process/env reads
//   • no randomness, no Date.now()/new Date()
//   • ESM module (`export` / `export function`). The repo package.json has no
//     "type":"module", but Node's automatic module-syntax detection (default
//     since v22.7, stable in v20.19/v22.12+; runtime here is v24) loads a bare
//     `.js` that uses `export` (and no CJS markers) AS an ES module — verified
//     both via `import` from the .mjs test and via direct `node file.js`.
//
// PRIVACY-BY-CONSTRUCTION:
//   A carrier may contain ONLY numbers, booleans, and a tiny fixed allowlist of
//   short lowercase enum tokens (slot roles + decision reasons). The sanitizer
//   REJECTS THE WHOLE CARRIER (returns null) the instant it sees any string that
//   is not one of those allowlisted tokens — which by construction rejects
//   anything URL-like / query-like / person-text-like / base64 / data-URI-like.
//
// FAIL-CLOSED INGESTION (both the sanitizer AND the builder ingest untrusted
// caller data — the builder is a public export, so it is hardened identically):
//   • read own DATA properties via Object.getOwnPropertyDescriptor ONLY
//   • never ordinary member access, never the `in` operator on the input,
//     never the array iterator, never invoke a getter (accessor => reject)
//   • accept only Object.prototype or null prototypes (exotic proto => reject)
//   • Object.getPrototypeOf wrapped in try (throwing trap => reject)
//   • reject oversize (rows > cap / input length > hard cap) BEFORE iterating
//   • duplicate / conflicting primary key (slotIndex) => reject (NO silent
//     first-win, NO silent drop of a later duplicate)
//   • ANY anomaly => return null
//
// IMMUTABILITY:
//   Every carrier returned by the sanitizer/builder is DEEP-FROZEN — the carrier
//   object, its `rows` array, AND every row object — so a downstream consumer
//   can neither mutate a returned carrier nor smuggle a mutation back in.

// ---------------------------------------------------------------------------
// Version + bounded limits
// ---------------------------------------------------------------------------
const DECISION_EVIDENCE_VERSION = 1;

// Bounded candidate-order / scoring-schema version: documents the ordering &
// scoring scheme under which every row's `candidateIndex`/`score` was computed,
// so a stale reader can refuse to (mis)interpret indices from a newer scheme.
const SCORING_SCHEMA_VERSION = 1;
const SCORING_SCHEMA_MAX = 255;       // bounded: small non-negative version int

const MAX_ROWS = 24;                  // hard cap on emitted rows
const MAX_BYTES = 8 * 1024;           // 8 KiB hard ceiling, measured as UTF-8 bytes
const SLOT_INDEX_MAX = 4096;          // slotIndex must be a small non-negative int
const CANDIDATE_COUNT_MAX = 1000000;  // sane upper bound for candidateCount
const BUILD_INPUT_HARD_MAX = 4096;    // reject absurd input arrays outright (bounded work)
const TOTAL_ROWS_MAX = 4096;          // upper bound on totalRows (== input hard cap)
const BUILD_MIN_BYTES = 1;            // floor for the (test-only) byte-budget seam

// ---------------------------------------------------------------------------
// Allowlisted enum tokens (the ONLY strings a carrier may ever contain)
// ---------------------------------------------------------------------------
const SLOT_ROLES = Object.freeze(['hero', 'circle', 'support', 'template']);
const DECISION_REASONS = Object.freeze([
  'best_score',      // won on score among >= 2 candidates
  'only_candidate',  // exactly 1 candidate existed
  'fallback',        // chosen as a fallback / default (not a scored win)
  'tie_break',       // tied on score, resolved by a deterministic tie-break
]);

const _SLOT_SET = new Set(SLOT_ROLES);
const _REASON_SET = new Set(DECISION_REASONS);
const _ALLOWED_TOKENS = new Set([...SLOT_ROLES, ...DECISION_REASONS]);

// Canonical key sets — strict allowlist (unknown key => reject whole carrier).
const TOP_KEYS = Object.freeze([
  'version', 'scoringSchema', 'totalRows', 'emittedRows', 'droppedRows',
  'capped', 'truncated', 'rows',
]);
const REQUIRED_ROW_KEYS = Object.freeze([
  'slotIndex', 'slot', 'reason', 'candidateCount', 'candidateIndex',
]);
const OPTIONAL_ROW_KEYS = Object.freeze(['score', 'margin', 'tie']);
const ROW_KEYS_SET = new Set([...REQUIRED_ROW_KEYS, ...OPTIONAL_ROW_KEYS]);
const TOP_KEYS_SET = new Set(TOP_KEYS);

// ---------------------------------------------------------------------------
// Byte measurement (UTF-8, not UTF-16 code units) — pure, uses global TextEncoder
// ---------------------------------------------------------------------------
const _ENC = new TextEncoder();
const _bytes = (s) => _ENC.encode(s).length;

// ---------------------------------------------------------------------------
// String privacy gate — the ONE gate that keeps the carrier safe to ship.
// A string value is acceptable ONLY if it is a short lowercase snake token AND
// a member of the allowlist. Everything else (URLs, queries, base64, data-URIs,
// person text, file paths, Thai/uppercase/whitespace) fails the token shape and
// is rejected. The named detectors below are defense-in-depth + self-doc.
// ---------------------------------------------------------------------------
const _SAFE_TOKEN = /^[a-z][a-z0-9_]{0,31}$/;

function _isUrlLike(s) {
  return (
    /:\/\//.test(s) ||                    // scheme://
    /^\/\//.test(s) ||                    // protocol-relative //host
    /^[a-z][a-z0-9+.-]*:/i.test(s) ||     // any-scheme: (mailto:, data:, file:, ...)
    /\bwww\./i.test(s) ||                 // www.
    /\.[a-z]{2,}(\/|\?|#|$)/i.test(s)     // host.tld / host.tld/... / host.tld?...
  );
}
function _isDataUriOrBase64Like(s) {
  return (
    /^data:/i.test(s) ||                  // data: URI
    /;base64,/i.test(s) ||                // ;base64, marker
    /^[A-Za-z0-9+/]{16,}={0,2}$/.test(s)  // long base64 run
  );
}
function _isQueryLike(s) {
  return /[?&][^=&]*=/.test(s) || /[=&?#]/.test(s); // key=value / query separators
}
function _isPersonOrFreeTextLike(s) {
  return /\s/.test(s) || /[A-Z]/.test(s) || /[^\x00-\x7F]/.test(s); // spaces, caps, non-ASCII (Thai names etc.)
}
// Aggregate: true == this string is NOT safe to carry.
function _isUnsafeString(s) {
  if (typeof s !== 'string') return true;
  if (!_SAFE_TOKEN.test(s)) return true; // catches every unsafe class above by shape
  return (
    _isUrlLike(s) ||
    _isDataUriOrBase64Like(s) ||
    _isQueryLike(s) ||
    _isPersonOrFreeTextLike(s)
  );
}
// A string field is publishable ONLY if it is safe-shaped AND in the allowlist.
function _isPublishableToken(s) {
  return typeof s === 'string' && !_isUnsafeString(s) && _ALLOWED_TOKENS.has(s);
}

// ---------------------------------------------------------------------------
// Prototype probe — wraps Object.getPrototypeOf so a throwing getPrototypeOf
// trap becomes a rejection, not an exception. Returns a unique sentinel on throw.
// ---------------------------------------------------------------------------
const _PROTO_THREW = Symbol('protoThrew');
function _protoOf(o) {
  try {
    return Object.getPrototypeOf(o);
  } catch {
    return _PROTO_THREW;
  }
}
function _isPlainProto(o) {
  const p = _protoOf(o);
  return p === Object.prototype || p === null;
}

const _isSafeInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const _normZero = (n) => (n === 0 ? 0 : n); // collapse -0 => 0 for stable JSON

// ---------------------------------------------------------------------------
// Descriptor-only snapshot of a plain object's OWN data properties.
// Returns { map } on success, or null on ANY anomaly:
//   • non-plain / exotic prototype
//   • symbol own key
//   • own key outside `allowedKeys`
//   • accessor descriptor (getter/setter) — getter is NEVER invoked
// The returned Map's values come exclusively from descriptor.value (no [[Get]]).
// ---------------------------------------------------------------------------
function _snapshotOwnData(obj, allowedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (!_isPlainProto(obj)) return null; // exotic proto / throwing getPrototypeOf => reject
  const map = new Map();
  let keys;
  try {
    keys = Reflect.ownKeys(obj); // may trip an ownKeys proxy trap => caught below
  } catch {
    return null;
  }
  for (const k of keys) {
    if (typeof k === 'symbol') return null;   // no symbol keys allowed
    if (!allowedKeys.has(k)) return null;      // unknown key => reject whole object
    let d;
    try {
      d = Object.getOwnPropertyDescriptor(obj, k);
    } catch {
      return null; // getOwnPropertyDescriptor trap threw => reject
    }
    if (!d || !('value' in d)) return null;    // accessor / weird descriptor => reject (getter not invoked)
    map.set(k, d.value);                        // descriptor-only value snapshot
  }
  return map;
}

// ---------------------------------------------------------------------------
// Reason-specific truthfulness invariants. Each decision reason carries its own
// required/forbidden field contract; a row that violates its reason's contract
// is a lie about the decision and is rejected (=> reject whole carrier).
//   only_candidate : exactly 1 candidate, index 0; no tie; no margin.
//   best_score     : >= 2 candidates; a `score` MUST be present (it won ON
//                    score); NOT a tie; a present `margin` must be strictly > 0.
//   tie_break      : >= 2 candidates; `tie === true` REQUIRED; `margin` REQUIRED
//                    and exactly 0 (tied top candidates => zero score gap).
//   fallback       : a default pick, not a scored win => no tie:true, no margin.
// ---------------------------------------------------------------------------
function _checkReasonInvariants(reason, f) {
  const { candidateCount, candidateIndex, hasScore, hasMargin, marginVal, hasTie, tieVal } = f;
  switch (reason) {
    case 'only_candidate':
      if (candidateCount !== 1) return false;
      if (candidateIndex !== 0) return false;
      if (hasTie && tieVal === true) return false; // a lone candidate cannot tie
      if (hasMargin) return false;                  // no runner-up => margin is a lie
      return true;
    case 'best_score':
      if (candidateCount < 2) return false;
      if (!hasScore) return false;                  // won ON score => score must exist
      if (hasTie && tieVal === true) return false;  // a true tie would be tie_break
      if (hasMargin && !(marginVal > 0)) return false; // if present, must be a real gap
      return true;
    case 'tie_break':
      if (candidateCount < 2) return false;
      if (!hasTie || tieVal !== true) return false; // tie:true REQUIRED
      if (!hasMargin || marginVal !== 0) return false; // margin REQUIRED and == 0
      return true;
    case 'fallback':
      if (hasTie && tieVal === true) return false;  // fallback is not a tie resolution
      if (hasMargin) return false;                  // fallback is not a margin-based win
      return true;
    default:
      return false; // unknown reason (should already be filtered) => reject
  }
}

// ---------------------------------------------------------------------------
// Validate a single already-snapshotted row (Map of own data values).
// Returns a canonical plain row object (stable key order) or null.
// ---------------------------------------------------------------------------
function _validateRowSnapshot(em) {
  // Required keys present?
  for (const req of REQUIRED_ROW_KEYS) {
    if (!em.has(req)) return null;
  }
  // Privacy scan: EVERY string value in the row must be an allowlisted token.
  for (const v of em.values()) {
    if (typeof v === 'string' && !_isPublishableToken(v)) return null;
  }

  const slotIndex = em.get('slotIndex');
  const slot = em.get('slot');
  const reason = em.get('reason');
  const candidateCount = em.get('candidateCount');
  const candidateIndex = em.get('candidateIndex');

  if (!_isSafeInt(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_INDEX_MAX) return null;
  if (typeof slot !== 'string' || !_SLOT_SET.has(slot)) return null;
  if (typeof reason !== 'string' || !_REASON_SET.has(reason)) return null;
  if (!_isSafeInt(candidateCount) || candidateCount < 1 || candidateCount > CANDIDATE_COUNT_MAX) return null;
  if (!_isSafeInt(candidateIndex) || candidateIndex < 0 || candidateIndex >= candidateCount) return null;

  const canon = { slotIndex, slot, reason, candidateCount, candidateIndex };

  const hasScore = em.has('score');
  let scoreVal;
  if (hasScore) {
    scoreVal = em.get('score');
    if (typeof scoreVal !== 'number' || !Number.isFinite(scoreVal)) return null;
    scoreVal = _normZero(scoreVal);
    canon.score = scoreVal;
  }
  const hasMargin = em.has('margin');
  let marginVal;
  if (hasMargin) {
    marginVal = em.get('margin');
    if (typeof marginVal !== 'number' || !Number.isFinite(marginVal) || marginVal < 0) return null;
    marginVal = _normZero(marginVal);
    canon.margin = marginVal;
  }
  const hasTie = em.has('tie');
  let tieVal;
  if (hasTie) {
    tieVal = em.get('tie');
    if (typeof tieVal !== 'boolean') return null;
    canon.tie = tieVal;
  }

  // Reason-specific truthfulness (positive + negative enforced by the contract).
  if (!_checkReasonInvariants(reason, {
    candidateCount, candidateIndex, hasScore, hasMargin, marginVal, hasTie, tieVal,
  })) return null;

  return canon;
}

// ---------------------------------------------------------------------------
// Deep-freeze a canonical carrier: every row object, the rows array, and the
// carrier itself. Rows contain only primitives, so freezing each row object is
// a full deep freeze. Returns the (now frozen) carrier.
// ---------------------------------------------------------------------------
function _deepFreezeCarrier(carrier) {
  for (const r of carrier.rows) Object.freeze(r);
  Object.freeze(carrier.rows);
  return Object.freeze(carrier);
}

// ---------------------------------------------------------------------------
// _sanitizeDecisionEvidenceV1(raw)
//   Fail-closed, descriptor-only sanitizer for an UNTRUSTED carrier.
//   Returns a fresh, DEEP-FROZEN canonical carrier (safe to persist/ship) or null.
// ---------------------------------------------------------------------------
function _sanitizeDecisionEvidenceV1(raw) {
  try {
    const top = _snapshotOwnData(raw, TOP_KEYS_SET);
    if (top === null) return null;

    // Every required top-level key present?
    for (const req of TOP_KEYS) {
      if (!top.has(req)) return null;
    }
    // No stray top-level strings (privacy defense — there should be none).
    for (const v of top.values()) {
      if (typeof v === 'string' && !_isPublishableToken(v)) return null;
    }

    if (top.get('version') !== DECISION_EVIDENCE_VERSION) return null;

    // Bounded candidate-order / scoring-schema version.
    const scoringSchema = top.get('scoringSchema');
    if (!_isSafeInt(scoringSchema) || scoringSchema < 1 || scoringSchema > SCORING_SCHEMA_MAX) return null;

    const totalRows = top.get('totalRows');
    const emittedRows = top.get('emittedRows');
    const droppedRows = top.get('droppedRows');
    const capped = top.get('capped');
    const truncated = top.get('truncated');
    // Every counter bounded (fail-closed on absurd / inconsistent totals).
    if (!_isSafeInt(totalRows) || totalRows < 1 || totalRows > TOTAL_ROWS_MAX) return null;
    if (!_isSafeInt(emittedRows) || emittedRows < 1 || emittedRows > MAX_ROWS) return null;
    if (!_isSafeInt(droppedRows) || droppedRows < 0 || droppedRows > TOTAL_ROWS_MAX) return null;
    if (typeof capped !== 'boolean' || typeof truncated !== 'boolean') return null;

    // ---- rows array: descriptor-only, reject oversize BEFORE iterating ----
    const rowsRaw = top.get('rows');
    if (!Array.isArray(rowsRaw)) return null;
    if (_protoOf(rowsRaw) !== Array.prototype) return null; // exotic array subclass => reject
    let lenD;
    try {
      lenD = Object.getOwnPropertyDescriptor(rowsRaw, 'length');
    } catch {
      return null;
    }
    if (!lenD || !('value' in lenD) || !_isSafeInt(lenD.value) || lenD.value < 0) return null;
    const len = lenD.value;
    if (len > MAX_ROWS) return null; // bounded work: reject oversize BEFORE touching any row
    if (len < 1) return null;        // empty carrier is meaningless

    const out = [];
    let prevIndex = -1; // enforce strictly ascending, unique slotIndex (sorted + unique)
    for (let i = 0; i < len; i++) {
      let ed;
      try {
        ed = Object.getOwnPropertyDescriptor(rowsRaw, i);
      } catch {
        return null;
      }
      if (!ed) return null;                       // hole => reject
      if (!('value' in ed)) return null;          // accessor index => reject (getter not invoked)
      const el = ed.value;
      const em = _snapshotOwnData(el, ROW_KEYS_SET);
      if (em === null) return null;
      const canon = _validateRowSnapshot(em);
      if (canon === null) return null;
      // Duplicate / non-ascending primary key => reject (NO silent first-win / drop).
      if (canon.slotIndex <= prevIndex) return null;
      prevIndex = canon.slotIndex;
      out.push(canon);
    }

    // ---- structural invariants (all locally verifiable & truthful) ----
    if (emittedRows !== out.length) return null;
    if (totalRows !== emittedRows + droppedRows) return null; // droppedRows == totalRows - emittedRows
    const capRoom = Math.min(totalRows, MAX_ROWS);
    if (capped !== (totalRows > MAX_ROWS)) return null;       // capped <=> input exceeded the row cap
    if (truncated !== (emittedRows < capRoom)) return null;   // truncated <=> emitted below the row-cap ceiling (byte trim)

    const carrier = {
      version: DECISION_EVIDENCE_VERSION,
      scoringSchema,
      totalRows,
      emittedRows,
      droppedRows,
      capped,
      truncated,
      rows: out,
    };
    if (_bytes(JSON.stringify(carrier)) > MAX_BYTES) return null; // hard 8 KiB ceiling
    return _deepFreezeCarrier(carrier);                          // immutable result
  } catch {
    return null; // any trap/anomaly => fail closed
  }
}

// ---------------------------------------------------------------------------
// Descriptor-only read of ONE own data property. Returns:
//   { present:false }                      when the key is not an own property
//   { present:true, accessor:true }        when it is an accessor (getter NOT invoked)
//   { present:true, accessor:false, value } when it is an own data property
//   null                                   when the descriptor read itself threw
// ---------------------------------------------------------------------------
function _readOwnData(obj, key) {
  let d;
  try {
    d = Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    return null;
  }
  if (!d) return { present: false };
  if (!('value' in d)) return { present: true, accessor: true };
  return { present: true, accessor: false, value: d.value };
}

// ---------------------------------------------------------------------------
// _buildDecisionEvidenceV1(rowsIn, limits?)
//   Build a canonical, privacy-safe carrier from producer-side decision rows.
//   THIS IS A PUBLIC EXPORT that ingests UNTRUSTED input, so it is hardened
//   exactly like the sanitizer: descriptor-only reads, getter never invoked,
//   exotic proto / accessor / hole => reject, duplicate slotIndex => reject.
//
//   Pipeline:
//     • snapshot input array `length` via descriptor; reject oversize (> hard
//       cap) BEFORE iterating; snapshot each index via descriptor; snapshot each
//       row's own data via descriptor.
//     • reject the WHOLE carrier on any invalid row or duplicate slotIndex
//       (fail-closed: no silent first-win, no silent drop).
//     • sort ascending by slotIndex (deterministic; drops nothing).
//     • row cap (tail-trim to MAX_ROWS)          => `capped`
//     • byte-budget tail-trim to <= budget        => `truncated`
//     • final self-sanitize with the HARD constants as the single source of truth
//   `limits` is an OPTIONAL test seam read via descriptor ONLY: it may only
//   TIGHTEN maxBytes (clamped to [BUILD_MIN_BYTES, MAX_BYTES]); it can NEVER
//   loosen a guarantee. An accessor `maxBytes`, a non-number `maxBytes`, or an
//   exotic-proto `limits` => reject. Production callers pass a single argument.
//   Returns a DEEP-FROZEN sanitized carrier or null.
// ---------------------------------------------------------------------------
function _buildDecisionEvidenceV1(rowsIn, limits) {
  try {
    // rowsIn must be a genuine array carrying Array.prototype.
    if (!Array.isArray(rowsIn)) return null;
    if (_protoOf(rowsIn) !== Array.prototype) return null; // exotic array subclass / throwing trap => reject

    // length via descriptor ONLY (no member access / no getter / no iterator).
    const lenR = _readOwnData(rowsIn, 'length');
    if (lenR === null || !lenR.present || lenR.accessor) return null;
    if (!_isSafeInt(lenR.value) || lenR.value < 0) return null;
    const len = lenR.value;
    if (len > BUILD_INPUT_HARD_MAX) return null; // reject oversize BEFORE iterating any index

    // limits via descriptor ONLY.
    let maxBytes = MAX_BYTES;
    if (limits !== undefined && limits !== null) {
      if (typeof limits !== 'object' || Array.isArray(limits)) return null;
      if (!_isPlainProto(limits)) return null; // exotic proto / throwing trap => reject
      const mbR = _readOwnData(limits, 'maxBytes');
      if (mbR === null) return null;
      if (mbR.present) {
        if (mbR.accessor) return null;         // accessor maxBytes => reject (getter not invoked)
        const mb = mbR.value;
        if (typeof mb !== 'number' || !Number.isFinite(mb)) return null;
        maxBytes = Math.max(BUILD_MIN_BYTES, Math.min(MAX_BYTES, Math.floor(mb)));
      }
    }

    // 1) descriptor-only snapshot + strict validate + fail-closed dedup.
    const bySlotIndex = new Map();
    for (let i = 0; i < len; i++) {
      const idxR = _readOwnData(rowsIn, i);
      if (idxR === null) return null;
      if (!idxR.present) return null;   // hole => reject
      if (idxR.accessor) return null;   // accessor index => reject (getter not invoked)
      const em = _snapshotOwnData(idxR.value, ROW_KEYS_SET);
      if (em === null) return null;     // exotic proto / accessor field / unknown key / symbol => reject
      const r = _validateRowSnapshot(em);
      if (r === null) return null;      // invalid / reason-invariant violation => reject
      if (bySlotIndex.has(r.slotIndex)) return null; // duplicate slotIndex => reject (no silent first-win)
      bySlotIndex.set(r.slotIndex, r);
    }
    if (bySlotIndex.size === 0) return null;

    // 2) sort ascending by slotIndex (deterministic; unique guaranteed above).
    const all = [...bySlotIndex.values()].sort((a, b) => a.slotIndex - b.slotIndex);
    const totalRows = all.length;

    // 3) row cap (tail-trim).
    const capped = totalRows > MAX_ROWS;
    let kept = capped ? all.slice(0, MAX_ROWS) : all;

    // helper: assemble a carrier for the current `kept` set (flags derived truthfully).
    const capRoom = Math.min(totalRows, MAX_ROWS);
    const assemble = (rows) => ({
      version: DECISION_EVIDENCE_VERSION,
      scoringSchema: SCORING_SCHEMA_VERSION,
      totalRows,
      emittedRows: rows.length,
      droppedRows: totalRows - rows.length,
      capped,
      truncated: rows.length < capRoom,
      rows,
    });

    // 4) byte-budget tail-trim: drop from the tail until within budget.
    while (kept.length > 0 && _bytes(JSON.stringify(assemble(kept))) > maxBytes) {
      kept = kept.slice(0, kept.length - 1);
    }
    if (kept.length === 0) return null; // cannot fit even one row within the budget

    // 5) final gate: sanitize with the HARD constants (single source of truth).
    //    The sanitizer also DEEP-FREEZES the result.
    return _sanitizeDecisionEvidenceV1(assemble(kept));
  } catch {
    return null;
  }
}

export {
  DECISION_EVIDENCE_VERSION,
  SCORING_SCHEMA_VERSION,
  SCORING_SCHEMA_MAX,
  MAX_ROWS,
  MAX_BYTES,
  SLOT_INDEX_MAX,
  CANDIDATE_COUNT_MAX,
  BUILD_INPUT_HARD_MAX,
  TOTAL_ROWS_MAX,
  SLOT_ROLES,
  DECISION_REASONS,
  _buildDecisionEvidenceV1,
  _sanitizeDecisionEvidenceV1,
  // exported for focused white-box tests / potential reuse:
  _isUnsafeString,
  _isPublishableToken,
};

// ===========================================================================
// v2 — POST-SELECTION FINAL-ARBITRATION evidence (explicit, versioned)
// ---------------------------------------------------------------------------
// v1 (above) is PRESERVED byte-for-byte; nothing in the v1 code path is
// altered. v2 lives entirely below, reusing ONLY the shared pure primitives
// (_snapshotOwnData / _readOwnData / _isSafeInt / _normZero / _protoOf /
//  _isPlainProto / _bytes / _deepFreezeCarrier / _isUnsafeString) and the
// shared HARD bounds. It adds its OWN version, reason allowlist, publishable-
// token gate, reason invariants, sanitizer and builder.
//
// WHY v2 EXISTS (integration re-audit):
//   The FINAL S6 slot pick is the LLM's choice AFTER the duplicate / identity /
//   scene / hero-size / solo-face gates, the fallback path, and the story
//   rescue — it is NOT the solverShadow/top3 pick. So a truthful "why" for a
//   final slot must come from an EXPLICIT final-arbitration trace, never be
//   inferred from solver top3 or pool length. v2 therefore adds reasons that
//   tell the truth about that final arbitration:
//     • llm_pick        — the LLM chose it; carries NO score/margin/tie.
//     • policy_override — a post-LLM gate (solo-face / hero-size swap) set the
//                         final primary; NO fabricated numeric.
//     • story_rescue    — the post-loop story-fit rescue set the final primary;
//                         NO fabricated numeric.
//     • fallback        — heuristic default pick (LLM gave nothing usable); no
//                         scored win (carried over from v1 semantics).
//   The solver-style reasons (best_score / tie_break / only_candidate) survive
//   from v1 and are LEGAL ONLY when the row carries EXACT full provenance
//   (real candidateCount + chosenIndex, and score/margin/tie as required) —
//   they must NEVER be derived from top3.length or rounded-score equality.
// v2 keeps every v1 guarantee: deep-frozen, <= MAX_ROWS rows, <= 8 KiB,
// descriptor-only ingestion, enum-tokens+numbers only, fail-closed.
// ===========================================================================
const DECISION_EVIDENCE_VERSION_V2 = 2;

// v2 reason allowlist: v1's four solver/fallback reasons PLUS the three truthful
// final-arbitration reasons. (Order groups the no-numeric finals first.)
const DECISION_REASONS_V2 = Object.freeze([
  'llm_pick',         // the LLM chose it — NO score/margin/tie
  'policy_override',  // a post-LLM gate (solo-face / hero-size) set the primary — NO numeric
  'story_rescue',     // the post-loop story-fit rescue set the primary — NO numeric
  'best_score',       // won on score among >= 2 candidates (EXACT provenance required)
  'only_candidate',   // exactly 1 candidate existed
  'fallback',         // heuristic default (not a scored win)
  'tie_break',        // tied on score, resolved deterministically (EXACT provenance required)
]);
// reasons that MUST carry no fabricated numeric (score/margin/tie forbidden).
const _NO_NUMERIC_REASONS_V2 = Object.freeze(['llm_pick', 'policy_override', 'story_rescue']);

const _REASON_SET_V2 = new Set(DECISION_REASONS_V2);
const _NO_NUMERIC_SET_V2 = new Set(_NO_NUMERIC_REASONS_V2);
// v2 publishable-token allowlist (kept independent of v1's _ALLOWED_TOKENS so
// v1's gate is untouched): slot roles + v2 reasons.
const _ALLOWED_TOKENS_V2 = new Set([...SLOT_ROLES, ...DECISION_REASONS_V2]);

// A v2 string field is publishable ONLY if it is safe-shaped (reuse the shared
// shape gate) AND a member of the v2 allowlist.
function _isPublishableTokenV2(s) {
  return typeof s === 'string' && !_isUnsafeString(s) && _ALLOWED_TOKENS_V2.has(s);
}

// ---------------------------------------------------------------------------
// v2 reason-specific truthfulness invariants. Same key set/limits as v1; the
// three new reasons forbid ALL of score/margin/tie (no fabricated numeric); the
// four carried-over reasons keep their v1 contracts verbatim.
// ---------------------------------------------------------------------------
function _checkReasonInvariantsV2(reason, f) {
  const { candidateCount, candidateIndex, hasScore, hasMargin, marginVal, hasTie, tieVal } = f;
  switch (reason) {
    // --- truthful final reasons: NO fabricated numeric of any kind ---
    case 'llm_pick':
    case 'policy_override':
    case 'story_rescue':
      if (hasScore) return false;   // NO fake score
      if (hasMargin) return false;  // NO fake margin
      if (hasTie) return false;     // NO fake tie
      return true;
    // --- reasons carried over from v1 (identical contracts) ---
    case 'only_candidate':
      if (candidateCount !== 1) return false;
      if (candidateIndex !== 0) return false;
      if (hasTie && tieVal === true) return false; // a lone candidate cannot tie
      if (hasMargin) return false;                  // no runner-up => margin is a lie
      return true;
    case 'best_score':
      // FULL provenance REQUIRED (matches the producer): a real score, a margin
      // present & strictly > 0, AND tie present & explicitly false. A best_score
      // is NEVER inferred — every provenance field must be present in the row.
      if (candidateCount < 2) return false;
      if (!hasScore) return false;                     // won ON score => score must exist
      if (!hasMargin || !(marginVal > 0)) return false; // margin REQUIRED and a real gap (> 0)
      if (!hasTie || tieVal !== false) return false;    // tie REQUIRED and explicitly false
      return true;
    case 'tie_break':
      // FULL provenance REQUIRED (matches the producer): a real score, margin
      // present & == 0, AND tie present & true. All three must be present.
      if (candidateCount < 2) return false;
      if (!hasScore) return false;                      // score REQUIRED (full provenance)
      if (!hasMargin || marginVal !== 0) return false;  // margin REQUIRED and == 0
      if (!hasTie || tieVal !== true) return false;     // tie REQUIRED and true
      return true;
    case 'fallback':
      // heuristic default — NOT a scored win: score/margin/tie ALL forbidden.
      if (hasScore) return false;                   // no fabricated score
      if (hasMargin) return false;                  // no fabricated margin
      if (hasTie) return false;                     // no fabricated tie
      return true;
    default:
      return false; // unknown reason => reject
  }
}

// ---------------------------------------------------------------------------
// Validate a single already-snapshotted v2 row (Map of own data values).
// Mirrors _validateRowSnapshot but with the v2 reason set / v2 token gate /
// v2 invariants. Returns a canonical plain row object or null.
// ---------------------------------------------------------------------------
function _validateRowSnapshotV2(em) {
  for (const req of REQUIRED_ROW_KEYS) {
    if (!em.has(req)) return null;
  }
  // Privacy scan: EVERY string value must be a v2-allowlisted token.
  for (const v of em.values()) {
    if (typeof v === 'string' && !_isPublishableTokenV2(v)) return null;
  }

  const slotIndex = em.get('slotIndex');
  const slot = em.get('slot');
  const reason = em.get('reason');
  const candidateCount = em.get('candidateCount');
  const candidateIndex = em.get('candidateIndex');

  if (!_isSafeInt(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_INDEX_MAX) return null;
  if (typeof slot !== 'string' || !_SLOT_SET.has(slot)) return null;
  if (typeof reason !== 'string' || !_REASON_SET_V2.has(reason)) return null;
  if (!_isSafeInt(candidateCount) || candidateCount < 1 || candidateCount > CANDIDATE_COUNT_MAX) return null;
  if (!_isSafeInt(candidateIndex) || candidateIndex < 0 || candidateIndex >= candidateCount) return null;

  const canon = { slotIndex, slot, reason, candidateCount, candidateIndex };

  const hasScore = em.has('score');
  let scoreVal;
  if (hasScore) {
    scoreVal = em.get('score');
    if (typeof scoreVal !== 'number' || !Number.isFinite(scoreVal)) return null;
    scoreVal = _normZero(scoreVal);
    canon.score = scoreVal;
  }
  const hasMargin = em.has('margin');
  let marginVal;
  if (hasMargin) {
    marginVal = em.get('margin');
    if (typeof marginVal !== 'number' || !Number.isFinite(marginVal) || marginVal < 0) return null;
    marginVal = _normZero(marginVal);
    canon.margin = marginVal;
  }
  const hasTie = em.has('tie');
  let tieVal;
  if (hasTie) {
    tieVal = em.get('tie');
    if (typeof tieVal !== 'boolean') return null;
    canon.tie = tieVal;
  }

  if (!_checkReasonInvariantsV2(reason, {
    candidateCount, candidateIndex, hasScore, hasMargin, marginVal, hasTie, tieVal,
  })) return null;

  return canon;
}

// ---------------------------------------------------------------------------
// _sanitizeDecisionEvidenceV2(raw) — fail-closed, descriptor-only sanitizer for
// an UNTRUSTED v2 carrier. Byte-for-byte the same structural discipline as v1
// (same top keys/counters/bounds/immutability), differing ONLY in version==2
// and the v2 row/token validation. Returns a deep-frozen carrier or null.
// ---------------------------------------------------------------------------
function _sanitizeDecisionEvidenceV2(raw) {
  try {
    const top = _snapshotOwnData(raw, TOP_KEYS_SET);
    if (top === null) return null;

    for (const req of TOP_KEYS) {
      if (!top.has(req)) return null;
    }
    for (const v of top.values()) {
      if (typeof v === 'string' && !_isPublishableTokenV2(v)) return null;
    }

    if (top.get('version') !== DECISION_EVIDENCE_VERSION_V2) return null;

    const scoringSchema = top.get('scoringSchema');
    if (!_isSafeInt(scoringSchema) || scoringSchema < 1 || scoringSchema > SCORING_SCHEMA_MAX) return null;

    const totalRows = top.get('totalRows');
    const emittedRows = top.get('emittedRows');
    const droppedRows = top.get('droppedRows');
    const capped = top.get('capped');
    const truncated = top.get('truncated');
    if (!_isSafeInt(totalRows) || totalRows < 1 || totalRows > TOTAL_ROWS_MAX) return null;
    if (!_isSafeInt(emittedRows) || emittedRows < 1 || emittedRows > MAX_ROWS) return null;
    if (!_isSafeInt(droppedRows) || droppedRows < 0 || droppedRows > TOTAL_ROWS_MAX) return null;
    if (typeof capped !== 'boolean' || typeof truncated !== 'boolean') return null;

    const rowsRaw = top.get('rows');
    if (!Array.isArray(rowsRaw)) return null;
    if (_protoOf(rowsRaw) !== Array.prototype) return null;
    let lenD;
    try {
      lenD = Object.getOwnPropertyDescriptor(rowsRaw, 'length');
    } catch {
      return null;
    }
    if (!lenD || !('value' in lenD) || !_isSafeInt(lenD.value) || lenD.value < 0) return null;
    const len = lenD.value;
    if (len > MAX_ROWS) return null;
    if (len < 1) return null;

    const out = [];
    let prevIndex = -1;
    for (let i = 0; i < len; i++) {
      let ed;
      try {
        ed = Object.getOwnPropertyDescriptor(rowsRaw, i);
      } catch {
        return null;
      }
      if (!ed) return null;
      if (!('value' in ed)) return null;
      const el = ed.value;
      const em = _snapshotOwnData(el, ROW_KEYS_SET);
      if (em === null) return null;
      const canon = _validateRowSnapshotV2(em);
      if (canon === null) return null;
      if (canon.slotIndex <= prevIndex) return null;
      prevIndex = canon.slotIndex;
      out.push(canon);
    }

    if (emittedRows !== out.length) return null;
    if (totalRows !== emittedRows + droppedRows) return null;
    const capRoom = Math.min(totalRows, MAX_ROWS);
    if (capped !== (totalRows > MAX_ROWS)) return null;
    if (truncated !== (emittedRows < capRoom)) return null;

    const carrier = {
      version: DECISION_EVIDENCE_VERSION_V2,
      scoringSchema,
      totalRows,
      emittedRows,
      droppedRows,
      capped,
      truncated,
      rows: out,
    };
    if (_bytes(JSON.stringify(carrier)) > MAX_BYTES) return null;
    return _deepFreezeCarrier(carrier);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// _buildDecisionEvidenceV2(rowsIn, limits?) — build a canonical, privacy-safe v2
// carrier from producer-side final-arbitration rows. Hardened exactly like the
// v1 builder (descriptor-only, getter never invoked, exotic proto/accessor/hole
// => reject, duplicate slotIndex => reject), differing ONLY in v2 row/token
// validation and version==2. Returns a deep-frozen carrier or null.
// ---------------------------------------------------------------------------
function _buildDecisionEvidenceV2(rowsIn, limits) {
  try {
    if (!Array.isArray(rowsIn)) return null;
    if (_protoOf(rowsIn) !== Array.prototype) return null;

    const lenR = _readOwnData(rowsIn, 'length');
    if (lenR === null || !lenR.present || lenR.accessor) return null;
    if (!_isSafeInt(lenR.value) || lenR.value < 0) return null;
    const len = lenR.value;
    if (len > BUILD_INPUT_HARD_MAX) return null;

    let maxBytes = MAX_BYTES;
    if (limits !== undefined && limits !== null) {
      if (typeof limits !== 'object' || Array.isArray(limits)) return null;
      if (!_isPlainProto(limits)) return null;
      const mbR = _readOwnData(limits, 'maxBytes');
      if (mbR === null) return null;
      if (mbR.present) {
        if (mbR.accessor) return null;
        const mb = mbR.value;
        if (typeof mb !== 'number' || !Number.isFinite(mb)) return null;
        maxBytes = Math.max(BUILD_MIN_BYTES, Math.min(MAX_BYTES, Math.floor(mb)));
      }
    }

    const bySlotIndex = new Map();
    for (let i = 0; i < len; i++) {
      const idxR = _readOwnData(rowsIn, i);
      if (idxR === null) return null;
      if (!idxR.present) return null;
      if (idxR.accessor) return null;
      const em = _snapshotOwnData(idxR.value, ROW_KEYS_SET);
      if (em === null) return null;
      const r = _validateRowSnapshotV2(em);
      if (r === null) return null;
      if (bySlotIndex.has(r.slotIndex)) return null;
      bySlotIndex.set(r.slotIndex, r);
    }
    if (bySlotIndex.size === 0) return null;

    const all = [...bySlotIndex.values()].sort((a, b) => a.slotIndex - b.slotIndex);
    const totalRows = all.length;

    const capped = totalRows > MAX_ROWS;
    let kept = capped ? all.slice(0, MAX_ROWS) : all;

    const capRoom = Math.min(totalRows, MAX_ROWS);
    const assemble = (rows) => ({
      version: DECISION_EVIDENCE_VERSION_V2,
      scoringSchema: SCORING_SCHEMA_VERSION,
      totalRows,
      emittedRows: rows.length,
      droppedRows: totalRows - rows.length,
      capped,
      truncated: rows.length < capRoom,
      rows,
    });

    while (kept.length > 0 && _bytes(JSON.stringify(assemble(kept))) > maxBytes) {
      kept = kept.slice(0, kept.length - 1);
    }
    if (kept.length === 0) return null;

    return _sanitizeDecisionEvidenceV2(assemble(kept));
  } catch {
    return null;
  }
}

export {
  DECISION_EVIDENCE_VERSION_V2,
  DECISION_REASONS_V2,
  _buildDecisionEvidenceV2,
  _sanitizeDecisionEvidenceV2,
  _isPublishableTokenV2,
  _checkReasonInvariantsV2,
};
