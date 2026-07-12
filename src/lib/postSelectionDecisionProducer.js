// Post-Selection Decision Producer — turns an EXPLICIT final-arbitration trace
// into the privacy-safe Decision Evidence **v2** carrier.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (integration re-audit — HOLD lane):
//   The FINAL S6 slot pick (src/lib/megaAdapters.js → s6_slots) is the LLM's
//   choice AFTER the duplicate / identity / scene / hero-size / solo-face gates,
//   the heuristic fallback path, and the post-loop story-fit rescue. It is NOT
//   the solverShadow/top3 pick (slotSolver.js runs in SHADOW only). Therefore a
//   truthful "why" for each final slot MUST come from an explicit trace of that
//   final arbitration — it may NEVER be inferred from solver top3 or pool length.
//
//   This module is that gate. It consumes an untrusted arbitration trace,
//   verifies EVERY final slot has a COMPLETE stage record, maps each stage to a
//   TRUTHFUL v2 reason, and emits the deep-frozen v2 carrier. If any slot's
//   trace is missing/incomplete — or the carrier cannot fully represent every
//   slot — it fails closed: `{ decisionComplete:false, evidence:null }`. It
//   never returns a partial or guessed carrier.
//
// STAGE -> REASON (1:1 for the "no-numeric" finals; solver derives its reason
// from EXACT provenance only):
//   'llm'            -> llm_pick        (no score/margin/tie)
//   'policy_override'-> policy_override (no score/margin/tie)  [hero-size/solo-face swap]
//   'story_rescue'   -> story_rescue    (no score/margin/tie)
//   'fallback'       -> fallback        (heuristic default; no numeric)
//   'solver'         -> only_candidate | tie_break | best_score
//                       ONLY with real candidateCount + chosenIndex and the
//                       reason's required numerics; a tie is used ONLY when the
//                       trace EXPLICITLY carries tie===true & margin===0 — never
//                       derived from rounded-score equality, never from top3.
//
// PURITY CONTRACT (loadable by bare `node`, offline):
//   • the ONLY import is the sibling PURE core `./decisionEvidence.js` (itself
//     import-free) — for the audited v2 carrier builder + shared bounds. No
//     node_modules, no IO, no Date/random/env, no dynamic import.
//   • the untrusted-trace ingestion is done here with DESCRIPTOR-ONLY reads
//     (no ordinary member access, no `in`, no getter invoked, getPrototypeOf
//     wrapped, exotic proto rejected) so the guard is self-contained & auditable.
//   • deterministic: same trace -> byte-identical result.

import {
  _buildDecisionEvidenceV2,
  DECISION_EVIDENCE_VERSION_V2,
  SLOT_ROLES,
  SLOT_INDEX_MAX,
  CANDIDATE_COUNT_MAX,
  MAX_ROWS,
} from './decisionEvidence.js';

// ---------------------------------------------------------------------------
// Trace vocabulary
// ---------------------------------------------------------------------------
// Final-arbitration STAGE tokens — the stage that set each slot's final primary.
const TRACE_STAGES = Object.freeze(['llm', 'policy_override', 'story_rescue', 'fallback', 'solver']);
const _STAGE_SET = new Set(TRACE_STAGES);
const _SLOT_SET = new Set(SLOT_ROLES);

// Strict own-key allowlists (unknown key => reject the whole trace/slot).
const TRACE_TOP_KEYS = Object.freeze(['version', 'slotCount', 'slots']);
const TRACE_TOP_KEYS_SET = new Set(TRACE_TOP_KEYS);
const SLOT_TRACE_REQUIRED = Object.freeze(['slotIndex', 'slot', 'stage', 'candidateCount', 'chosenIndex']);
const SLOT_TRACE_OPTIONAL = Object.freeze(['score', 'margin', 'tie']);
const SLOT_TRACE_KEYS_SET = new Set([...SLOT_TRACE_REQUIRED, ...SLOT_TRACE_OPTIONAL]);

// The single fail-closed sentinel (frozen). evidence is always null when the
// decision is not complete — a consumer that sees decisionComplete===false must
// treat evidence as absent.
const _INCOMPLETE = Object.freeze({ decisionComplete: false, evidence: null });

// ---------------------------------------------------------------------------
// Pure primitives — descriptor-only, fail-closed (mirrors decisionEvidence.js
// discipline; kept local so this guard is independently auditable & testable).
// ---------------------------------------------------------------------------
const _isSafeInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const _normZero = (n) => (n === 0 ? 0 : n); // collapse -0 => 0

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

// Read ONE own data property by descriptor:
//   { present:false }                        — not an own property
//   { present:true, accessor:true }          — accessor (getter NOT invoked)
//   { present:true, accessor:false, value }  — own data property
//   null                                     — the descriptor read itself threw
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

// Descriptor-only snapshot of a plain object's OWN data properties into a Map.
// Returns null on ANY anomaly: non-plain/exotic proto, symbol key, key outside
// allowedKeys, accessor descriptor (getter NEVER invoked), or a throwing trap.
function _snapshotOwnData(obj, allowedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (!_isPlainProto(obj)) return null;
  const map = new Map();
  let keys;
  try {
    keys = Reflect.ownKeys(obj);
  } catch {
    return null;
  }
  for (const k of keys) {
    if (typeof k === 'symbol') return null;
    if (!allowedKeys.has(k)) return null;
    let d;
    try {
      d = Object.getOwnPropertyDescriptor(obj, k);
    } catch {
      return null;
    }
    if (!d || !('value' in d)) return null; // accessor / weird descriptor => reject
    map.set(k, d.value);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Map ONE already-snapshotted slot trace (Map of own data values) to a canonical
// v2 evidence row, or null if the slot's trace is invalid/incomplete/untruthful.
// The reason is derived ONLY from the explicit stage + explicit provenance —
// never from top3, pool length, or rounded-score equality.
// ---------------------------------------------------------------------------
function _mapSlotTrace(em) {
  const slotIndex = em.get('slotIndex');
  const slot = em.get('slot');
  const stage = em.get('stage');
  const candidateCount = em.get('candidateCount');
  const chosenIndex = em.get('chosenIndex');

  // base structural validation (fail-closed on every field)
  if (!_isSafeInt(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_INDEX_MAX) return null;
  if (typeof slot !== 'string' || !_SLOT_SET.has(slot)) return null;
  if (typeof stage !== 'string' || !_STAGE_SET.has(stage)) return null;
  // candidateCount is the REAL number of candidates considered — NEVER top3.length.
  if (!_isSafeInt(candidateCount) || candidateCount < 1 || candidateCount > CANDIDATE_COUNT_MAX) return null;
  // chosenIndex is the REAL final index — may sit anywhere in [0, count), incl. outside a top3.
  if (!_isSafeInt(chosenIndex) || chosenIndex < 0 || chosenIndex >= candidateCount) return null;

  const hasScore = em.has('score');
  const hasMargin = em.has('margin');
  const hasTie = em.has('tie');
  const scoreVal = hasScore ? em.get('score') : undefined;
  const marginVal = hasMargin ? em.get('margin') : undefined;
  const tieVal = hasTie ? em.get('tie') : undefined;

  // numeric TYPE validation up front (present => must be well-typed)
  if (hasScore && (typeof scoreVal !== 'number' || !Number.isFinite(scoreVal))) return null;
  if (hasMargin && (typeof marginVal !== 'number' || !Number.isFinite(marginVal) || marginVal < 0)) return null;
  if (hasTie && typeof tieVal !== 'boolean') return null;

  const base = { slotIndex, slot, candidateCount, candidateIndex: chosenIndex };

  switch (stage) {
    // --- truthful final reasons that carry NO fabricated numeric ---
    case 'llm':
    case 'policy_override':
    case 'story_rescue': {
      // A numeric on a non-solver stage would be a fabricated scored win => reject.
      if (hasScore || hasMargin || hasTie) return null;
      const reason = stage === 'llm' ? 'llm_pick' : stage;
      return { ...base, reason };
    }
    // --- heuristic default: NOT a scored win, carries no numeric ---
    case 'fallback': {
      if (hasScore || hasMargin || hasTie) return null;
      return { ...base, reason: 'fallback' };
    }
    // --- the ONLY stage that may carry numerics; EXPLICIT + FULL provenance required ---
    case 'solver': {
      if (candidateCount === 1) {
        // only_candidate: lone candidate at index 0, no runner-up, no tie.
        if (chosenIndex !== 0) return null;
        if (hasMargin || hasTie) return null;
        const row = { ...base, reason: 'only_candidate' };
        if (hasScore) row.score = _normZero(scoreVal); // its own score is allowed
        return row;
      }
      // candidateCount >= 2 — solver provenance MUST be EXPLICIT + FULL.
      // score, margin, AND tie must ALL be present; `tie` alone decides the reason.
      // A reason is NEVER inferred from rounded-score equality, pool length, top3,
      // or solverShadow — any missing provenance field fails closed (=> null).
      if (!hasScore) return null;   // real score REQUIRED (both best_score & tie_break)
      if (!hasMargin) return null;  // margin REQUIRED (both)
      if (!hasTie) return null;     // tie REQUIRED (both)
      if (tieVal === true) {
        // tie_break: EXPLICIT tie (tie===true) with a zero gap (margin===0) AND a real score.
        if (marginVal !== 0) return null;
        return { ...base, reason: 'tie_break', score: _normZero(scoreVal), margin: 0, tie: true };
      }
      // tie === false => best_score: a real score AND a real, strictly-positive margin gap.
      if (tieVal !== false) return null;  // paranoia: tie must be a real boolean
      if (!(marginVal > 0)) return null;  // margin must be a real gap (> 0)
      return { ...base, reason: 'best_score', score: _normZero(scoreVal), margin: _normZero(marginVal), tie: false };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// produceFinalDecisionEvidence(trace, limits?)
//   Consume an UNTRUSTED final-arbitration trace and emit the v2 carrier.
//   Returns a FROZEN result:
//     { decisionComplete:true,  evidence:<deep-frozen v2 carrier> }
//         — iff EVERY declared final slot has a complete, truthful trace AND the
//           carrier represents every slot with nothing dropped/capped/truncated.
//     { decisionComplete:false, evidence:null }   (the shared _INCOMPLETE)
//         — on ANY missing/incomplete slot, malformed/hostile input, or a carrier
//           that could not fully represent every slot. NEVER a partial carrier.
//
//   Trace shape (descriptor-only reads; own keys strictly allowlisted):
//     { version:2, slotCount:<int 1..MAX_ROWS>, slots:[ slotTrace, ... ] }
//     slotTrace = { slotIndex, slot, stage, candidateCount, chosenIndex,
//                   score?, margin?, tie? }
//   `limits` is an OPTIONAL byte-budget seam forwarded to the audited v2 builder;
//   if a squeeze would drop any slot, the completeness post-check fails closed.
// ---------------------------------------------------------------------------
export function produceFinalDecisionEvidence(trace, limits) {
  try {
    const top = _snapshotOwnData(trace, TRACE_TOP_KEYS_SET);
    if (top === null) return _INCOMPLETE;
    for (const req of TRACE_TOP_KEYS) {
      if (!top.has(req)) return _INCOMPLETE;
    }
    // Trace version is tied to the carrier version it produces.
    if (top.get('version') !== DECISION_EVIDENCE_VERSION_V2) return _INCOMPLETE;

    // Declared cardinality of final slots (bounds it to what a carrier can hold).
    const slotCount = top.get('slotCount');
    if (!_isSafeInt(slotCount) || slotCount < 1 || slotCount > MAX_ROWS) return _INCOMPLETE;

    // slots must be a genuine array carrying Array.prototype.
    const slotsRaw = top.get('slots');
    if (!Array.isArray(slotsRaw)) return _INCOMPLETE;
    if (_protoOf(slotsRaw) !== Array.prototype) return _INCOMPLETE;
    const lenR = _readOwnData(slotsRaw, 'length');
    if (lenR === null || !lenR.present || lenR.accessor) return _INCOMPLETE;
    if (!_isSafeInt(lenR.value) || lenR.value < 0) return _INCOMPLETE;
    const len = lenR.value;
    // COMPLETENESS (cardinality): the actual entries must match the declared count.
    // Fewer/more entries than declared => a slot is missing/extra => incomplete.
    if (len !== slotCount) return _INCOMPLETE;

    const rows = [];
    const seen = new Set();
    for (let i = 0; i < len; i++) {
      const idxR = _readOwnData(slotsRaw, i);
      if (idxR === null) return _INCOMPLETE;
      if (!idxR.present) return _INCOMPLETE;   // hole => a missing slot => incomplete
      if (idxR.accessor) return _INCOMPLETE;   // accessor index => reject (getter not invoked)
      const em = _snapshotOwnData(idxR.value, SLOT_TRACE_KEYS_SET);
      if (em === null) return _INCOMPLETE;
      // Every required stage field present? (a missing `stage` => incomplete)
      for (const req of SLOT_TRACE_REQUIRED) {
        if (!em.has(req)) return _INCOMPLETE;
      }
      const row = _mapSlotTrace(em);
      if (row === null) return _INCOMPLETE;
      if (seen.has(row.slotIndex)) return _INCOMPLETE; // duplicate final slot => incomplete
      seen.add(row.slotIndex);
      rows.push(row);
    }
    if (rows.length !== slotCount) return _INCOMPLETE; // paranoia (kept in lock-step)

    // COMPLETENESS (dense index set): the observed final slotIndex set MUST equal
    // the DENSE range 0..slotCount-1 — not merely a unique set of the right size.
    // Cardinality is already == slotCount with all indices unique & >= 0, so a
    // missing 0..slotCount-1 index implies some index is >= slotCount (oversize)
    // or a hole exists => NOT a complete final decision => fail closed.
    for (let i = 0; i < slotCount; i++) {
      if (!seen.has(i)) return _INCOMPLETE;
    }

    // Build the audited, deep-frozen v2 carrier.
    const evidence = _buildDecisionEvidenceV2(rows, limits);
    if (evidence === null) return _INCOMPLETE; // carrier failed to build => fail-closed

    // COMPLETENESS (representation): the carrier MUST hold every slot, nothing
    // dropped/capped/truncated — otherwise it would be a partial carrier.
    if (evidence.totalRows !== slotCount) return _INCOMPLETE;
    if (evidence.emittedRows !== slotCount) return _INCOMPLETE;
    if (evidence.droppedRows !== 0) return _INCOMPLETE;
    if (evidence.capped || evidence.truncated) return _INCOMPLETE;

    return Object.freeze({ decisionComplete: true, evidence });
  } catch {
    return _INCOMPLETE; // any trap/anomaly => fail closed
  }
}

export {
  TRACE_STAGES,
  TRACE_TOP_KEYS,
  SLOT_TRACE_REQUIRED,
  SLOT_TRACE_OPTIONAL,
};
