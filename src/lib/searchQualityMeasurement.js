// ============================================================
// searchQualityMeasurement.js — Lane (search-quality MEASUREMENT producer)
// ============================================================
//
// PURE, DETERMINISTIC, FAIL-CLOSED. This module is the *producer* whose output
// is the fully-measured pool descriptor that `searchQualityMetrics.js` (the
// seeded consumer) reasons over. It turns raw, per-candidate, GEOMETRY-SCOPED
// crop-evaluation TELEMETRY into that descriptor — and its only job is to be
// HONEST: it emits a measurement-complete descriptor ONLY when the underlying
// telemetry actually proves every claim against the realized template's REAL slot
// geometry, and otherwise emits a CONSUMER-FAILING role shape that drives the
// consumer to `insufficient-data` (never READY / CROP_UNSAFE / STOCK_SHORTAGE
// from data it did not measure).
//
// PRECONDITION — this producer STACKS ON TOP OF the consumer:
//   `STACKED_AFTER_SEARCH_QUALITY_METRICS` = true. The descriptor shape here is a
//   contract owned by searchQualityMetrics.js; this module must be integrated AFTER
//   that consumer exists. In a clean worktree the consumer may be absent — the
//   producer stays fully functional (it never imports the consumer), and only the
//   round-trip TESTS skip.
//
// WHY THIS EXISTS (integration re-audit HOLD): production has NO complete
// per-slot crop evaluation. So a descriptor must NEVER:
//   • claim a role COMPLETE from a ROLE-ONLY `{role}` template row or from raw
//     image dimensions — only from an ACTUAL per-candidate crop verdict bound
//     ONE-TO-ONE to each real slot's INTERNALLY-DERIVED geometry identity;
//   • copy a single pool.length across roles — every role's counters derive from
//     THAT role's own candidate list;
//   • treat a raw crop-safe pile as DISTINCT — requiredUnique (== panel count) is
//     satisfied only when identity + near-duplicate (pHash) coverage is COMPLETE
//     across the role's crop-safe candidates AND a GLOBAL injective (bipartite)
//     matching proves that many DISTINCT images can each fill a DISTINCT panel —
//     ACROSS hero+circle+support together, so one image never fills two panels.
//
// GROUNDING (shapes are not invented — they mirror the real pipeline):
//   • Canvas is the fixed 1080×1350 (4:5) cover (refTemplate.js: W=1080, H=1350).
//   • REAL slot shapes (refSlotContract.js line ~648: the ref library's shape enum
//     is EXACTLY 'rect' | 'circle'; refTemplate.js emits shape:'circle' ONLY for
//     circles, every other slot is a rectangle): the collapsed hero (id 'main') and
//     support (context/evidence/secondary) slots are RECT; only the circle slot is
//     CIRCLE. solverRoleFor collapses main→hero, circle-shape→circle, the rest→support.
//   • Template authority = a NORMALIZED realized-template snapshot. Each demanded
//     slot carries: a unique bounded `slotId`, a collapsed POOL_ROLE `role`, a real
//     `shape` bound to that role (hero/support→rect, circle→circle), and integer
//     x/y/w/h FULLY inside the exact 1080×1350 canvas. requiredSlots(role) = number
//     of slots the realized template gives that role; requiredUnique(role) = that
//     same panel count (each panel is a DISTINCT image).
//   • GEOMETRY IDENTITY is DERIVED DETERMINISTICALLY INSIDE this module from
//     (slotId + role + shape + x + y + w + h) — it is NOT a caller-supplied token.
//     A slot MAY additionally CLAIM a `geometryId`, but that claim is only VERIFIED
//     against the derived identity (a stale/tampered claim → geometry invalid); it
//     is never trusted as authority. Each candidate crop row's bound geometry
//     identity must EQUAL the recomputed identity of the slot it names — a STALE
//     token (bound to pre-change coordinates) no longer matches and fails closed.
//   • Crop verdict per candidate = the renderer's crop math against the slot's real
//     region geometry, reported as a per-slot boolean. A candidate MUST carry a
//     verdict for EVERY demanded slot of its role, each bound to the EXACT
//     (slotId + derived-identity) of that slot — NO role-wide crop boolean. This
//     module does NOT re-run pixel math (that needs IO); it faithfully AGGREGATES
//     the per-slot boolean verdicts and refuses to fill any gap.
//   • Distinctness key = identity cluster token (person) unioned with the
//     near-duplicate perceptual bucket token (pHash64/dHash near-dup class). Two
//     crop-safe candidates collapse to one distinct image when they share EITHER
//     token. This under-counts rather than over-counts (fail-closed).
//   • Feasibility = maximum bipartite matching between distinct images and panels,
//     edge iff the image is crop-safe for that panel — computed GLOBALLY across all
//     demanded slots of all roles, so a single distinct group is counted toward at
//     most ONE panel total (never double-counted across two roles/slots).
//
// HARD BOUNDS (enforced BEFORE any allocation / loop):
//   • MAX_REALIZED_SLOTS caps the total demanded slots of a realized template.
//   • MAX_CANDIDATES_PER_ROLE, MAX_CROP_CELLS (candidates × slots) and
//     MAX_MATCH_EDGES (distinct groups × slots) bound the work; an over-product
//     input is REJECTED fail-closed, never allocated. The bipartite matching's
//     recursion depth is bounded by the slot count (≤ MAX_REALIZED_SLOTS).
//
// CONTRACT (must never break):
//   • No imports, no IO, no network, no Date/Math.random, no environment. Same
//     telemetry -> byte-identical descriptor forever.
//   • Fail-closed: malformed / hostile telemetry NEVER throws — it yields a
//     well-defined incomplete descriptor / consumer-failing role shape.
//   • Untrusted telemetry is read ONLY through own-property descriptors (never
//     `obj.foo`, never `in`, never a getter). Accessor fields, exotic prototypes,
//     and prototype reads that throw are structural anomalies -> incomplete.
//   • Output is deeply frozen and PRIVACY-SAFE: only enum string tokens + numbers
//     + booleans. No ids / urls / names / queries / paths / hashes / slotIds /
//     geometryIds ever leak — those tokens are used solely as opaque equality keys
//     and are NEVER echoed; only derived COUNTS (cropSafe / cropSafeDistinct) are
//     emitted.
// ============================================================

export const version = 1;
const VERSION = version;

// Precondition marker: this producer stacks ON TOP OF searchQualityMetrics.js and
// must be integrated AFTER that consumer exists (see header). Exported so an
// integrator / test can assert the ordering intent explicitly.
export const STACKED_AFTER_SEARCH_QUALITY_METRICS = true;

// The three cover roles the consumer's descriptor is expressed in.
export const POOL_ROLES = Object.freeze(['hero', 'circle', 'support']);

// The exact cover canvas (refTemplate.js: every cover is 1080×1350). Slot boxes
// must lie FULLY inside it — this is the geometry authority, never guessed.
const CANVAS_W = 1080;
const CANVAS_H = 1350;

// REAL shape bound to each collapsed POOL_ROLE. The ref library's shape enum is
// EXACTLY 'rect' | 'circle' (refSlotContract.js): hero (id 'main') and support
// slots are rectangles; only the circle slot is a circle. A slot whose declared
// shape does not match its role's canonical shape (e.g. a circle wearing a rect
// shape, or vice versa) is a geometry anomaly and is rejected.
const SHAPE_FOR_ROLE = Object.freeze({ hero: 'rect', circle: 'circle', support: 'rect' });

// Mirrors searchQualityMetrics MAX_COUNT: a list longer than this is treated as a
// hostile/absurd measurement, not clamped.
const MAX_COUNT = 100000;
// Opaque tokens (slotId / identity / pHash) beyond this length are refused
// (defensive; tokens are never output so this bounds only internal work).
const MAX_TOKEN_LEN = 4096;

// ---------- HARD BOUNDS (checked BEFORE any allocation / loop) ----------
// A realized cover has a handful of panels; anything past these caps is an absurd
// / hostile measurement and is refused fail-closed rather than allocated.
const MAX_REALIZED_SLOTS = 10;          // total demanded slots across all roles
const MAX_CANDIDATES_PER_ROLE = 2000;   // length of a single role's candidate list
const MAX_CROP_CELLS = 4000;            // candidates × slots (per role) = crop cells
const MAX_MATCH_EDGES = 20000;          // distinct groups × total slots (global match)

export const LIMITS = Object.freeze({
  MAX_REALIZED_SLOTS,
  MAX_CANDIDATES_PER_ROLE,
  MAX_CROP_CELLS,
  MAX_MATCH_EDGES,
  MAX_TOKEN_LEN,
});

export const MEASUREMENT_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  INCOMPLETE: 'INCOMPLETE',
});

// The ONLY reasons a descriptor is flagged incomplete. Each is a defined,
// testable anomaly recorded as an enum token in the descriptor's `incomplete`
// list (privacy-safe) so callers can see WHY the consumer will read insufficient.
export const INCOMPLETE_REASON = Object.freeze({
  STRUCTURAL: 'STRUCTURAL',                         // hostile / exotic / accessor / proxy-trap / non-object
  TEMPLATE_NOT_MEASURED: 'TEMPLATE_NOT_MEASURED',   // template authority / match not reported
  TEMPLATE_GEOMETRY_INVALID: 'TEMPLATE_GEOMETRY_INVALID', // matched, but slot geometry absent / malformed / role-only / over-bound
  ROLE_TELEMETRY_MISSING: 'ROLE_TELEMETRY_MISSING', // a demanded role has no measurable candidate pool (incl. over-bound)
  CROP_NOT_EVALUATED: 'CROP_NOT_EVALUATED',         // a relevant candidate lacks a valid per-slot crop verdict
  UNIQUENESS_NOT_EVALUATED: 'UNIQUENESS_NOT_EVALUATED', // crop-safe candidate distinctness coverage incomplete
  GLOBAL_DISTINCT_INFEASIBLE: 'GLOBAL_DISTINCT_INFEASIBLE', // per-role looks ok but a GLOBAL distinct→slot matching cannot fill every demanded panel
});
const R = INCOMPLETE_REASON;

// Fixed order for deduped incomplete tokens (deterministic output).
const REASON_ORDER = Object.freeze([
  R.STRUCTURAL,
  R.TEMPLATE_NOT_MEASURED,
  R.TEMPLATE_GEOMETRY_INVALID,
  R.ROLE_TELEMETRY_MISSING,
  R.CROP_NOT_EVALUATED,
  R.UNIQUENESS_NOT_EVALUATED,
  R.GLOBAL_DISTINCT_INFEASIBLE,
]);

// ---------- pure structural helpers ----------

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  return Object.freeze(obj);
}

// Accept only genuine plain objects (prototype Object.prototype or null). Arrays,
// class instances, exotic prototypes rejected. The WHOLE probe is wrapped in try —
// a hostile/revoked Proxy throws from Array.isArray or getPrototypeOf; any throw
// collapses to false and never propagates.
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

// Read one own property WITHOUT triggering getters or `in`.
//   { ok:true, value }            -> present data property
//   { ok:false, blocked:false }   -> absent (benign / not measured)
//   { ok:false, blocked:true }    -> accessor property OR descriptor read threw
//                                     (proxy trap): structural hostility, must bail.
function safeOwnValue(obj, key) {
  let desc;
  try {
    desc = Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    return { ok: false, blocked: true };
  }
  if (desc === undefined) return { ok: false, blocked: false };
  if (typeof desc.get === 'function' || typeof desc.set === 'function') {
    return { ok: false, blocked: true };
  }
  return { ok: true, value: desc.value, blocked: false };
}

// A genuine array whose prototype is EXACTLY Array.prototype. Both Array.isArray
// and the prototype read are wrapped in one try (a revoked/hostile Proxy throws
// from either). { blocked } = throwing trap; { ok:false } = benign non-array /
// subclass / exotic proto.
function probeArray(v) {
  try {
    if (!Array.isArray(v)) return { ok: false };
    if (Object.getPrototypeOf(v) !== Array.prototype) return { ok: false };
    return { ok: true };
  } catch {
    return { blocked: true };
  }
}

// Canonical array-index string in [0, len): non-negative int, no leading zeros,
// round-trips to the key.
function isIndexInRange(key, len) {
  const n = Number(key);
  if (!Number.isInteger(n) || n < 0 || n >= len) return false;
  return String(n) === key;
}

// Own keys (via Reflect.ownKeys, which surfaces symbol / non-enumerable keys)
// must be EXACTLY the canonical indices [0,len) plus 'length'. Any symbol key,
// hidden non-index key, or throwing ownKeys trap -> false. Never throws.
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

// Read a genuine own array by descriptor (never triggers getters).
//   { blocked } | { invalid } | { absent } | { arr, len }
// A list longer than MAX_COUNT is `invalid` (bounded, not clamped) so an absurd
// count can never reach the arithmetic.
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

// An opaque token (slotId / identity / pHash) is valid only as a bounded primitive
// (non-empty string within length cap, or finite number).
function validToken(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length > 0 && v.length <= MAX_TOKEN_LEN;
  return false;
}

// ---------- internal canonical geometry identity ----------
//
// The geometry-binding identity is DERIVED here, deterministically, from the slot's
// own real fields — it is the module's authority and is NEVER trusted from a
// caller-supplied token. Length-prefixing the (arbitrary) slotId makes the encoding
// unambiguous; role/shape are validated enums and x/y/w/h are validated integers,
// so distinct (slotId,role,shape,x,y,w,h) tuples map to distinct identities. The
// result is used solely as an opaque equality key and is NEVER emitted (privacy).
export function deriveGeometryId(slotId, role, shape, x, y, w, h) {
  const sid = String(slotId);
  return `gid1|${sid.length}|${sid}|${role}|${shape}|${x}|${y}|${w}|${h}`;
}

// ---------- template authority (real geometry) ----------
//
// Reads the NORMALIZED realized-template snapshot. A ROLE-ONLY `{role}` row is
// NOT geometry and can NEVER let a role complete: every demanded slot must carry a
// unique bounded slotId, a collapsed POOL_ROLE, a real shape bound to that role,
// and integer x/y/w/h fully inside the exact 1080×1350 canvas. The geometry
// identity is DERIVED internally (never trusted from a caller token).
//
// Returns exactly one of:
//   { blocked:true }                                   structural hostility
//   { invalid: TOKEN }                                 match not measured / geometry malformed / over-bound
//   { matched:false }                                  MEASURED "no reference template" (a real outcome)
//   { matched:true, demand, slotsByRole }              per-role demand + ordered (slotId,canonId) slots

// Validate + read a slot's integer box, fully inside the exact canvas.
//   { blocked } | { ok:false } | { ok:true, x, y, w, h }
function readSlotBox(slot) {
  const out = {};
  for (const k of ['x', 'y', 'w', 'h']) {
    const f = safeOwnValue(slot, k);
    if (f.blocked) return { blocked: true };
    if (!f.ok || typeof f.value !== 'number' || !Number.isInteger(f.value)) return { ok: false };
    out[k] = f.value;
  }
  const { x, y, w, h } = out;
  if (x < 0 || y < 0 || w < 1 || h < 1) return { ok: false };
  if (x + w > CANVAS_W || y + h > CANVAS_H) return { ok: false };
  return { ok: true, x, y, w, h };
}

function readTemplateAuthority(input) {
  const tf = safeOwnValue(input, 'templateAuthority');
  if (tf.blocked) return { blocked: true };
  if (!tf.ok) return { invalid: R.TEMPLATE_NOT_MEASURED };
  if (!isSafePlainObject(tf.value)) return { blocked: true };
  const auth = tf.value;

  const mf = safeOwnValue(auth, 'matched');
  if (mf.blocked) return { blocked: true };
  if (!mf.ok || (mf.value !== true && mf.value !== false)) return { invalid: R.TEMPLATE_NOT_MEASURED };
  if (mf.value === false) return { matched: false };

  // matched === true -> real per-slot geometry is required (never guessed).
  const sa = readOwnArray(auth, 'slots');
  if (sa.blocked) return { blocked: true };
  if (sa.absent || sa.invalid || sa.len < 1) return { invalid: R.TEMPLATE_GEOMETRY_INVALID };
  // (P1-4) HARD BOUND before the per-slot loop: a realized cover has a handful of
  // panels. Too many slots is an absurd template -> refuse without allocating.
  if (sa.len > MAX_REALIZED_SLOTS) return { invalid: R.TEMPLATE_GEOMETRY_INVALID };

  const counts = { hero: 0, circle: 0, support: 0 };
  const slotsByRole = { hero: [], circle: [], support: [] };
  const seenSlotIds = new Set();

  for (let i = 0; i < sa.len; i++) {
    const e = safeOwnValue(sa.arr, String(i));
    if (e.blocked) return { blocked: true };
    if (!e.ok) return { invalid: R.TEMPLATE_GEOMETRY_INVALID }; // hole
    if (!isSafePlainObject(e.value)) return { blocked: true };
    const slot = e.value;

    // role — collapsed to a POOL_ROLE by the caller (never guessed here).
    const rf = safeOwnValue(slot, 'role');
    if (rf.blocked) return { blocked: true };
    if (!rf.ok || typeof rf.value !== 'string' || !POOL_ROLES.includes(rf.value)) {
      return { invalid: R.TEMPLATE_GEOMETRY_INVALID };
    }
    const role = rf.value;

    // slotId — unique bounded token (a role-only row has none -> invalid).
    const sidf = safeOwnValue(slot, 'slotId');
    if (sidf.blocked) return { blocked: true };
    if (!sidf.ok || !validToken(sidf.value)) return { invalid: R.TEMPLATE_GEOMETRY_INVALID };
    const slotId = sidf.value;
    if (seenSlotIds.has(slotId)) return { invalid: R.TEMPLATE_GEOMETRY_INVALID }; // duplicate slotId
    seenSlotIds.add(slotId);

    // shape — real, and bound to the collapsed role (hero/support→rect, circle→circle).
    const shf = safeOwnValue(slot, 'shape');
    if (shf.blocked) return { blocked: true };
    if (!shf.ok || shf.value !== SHAPE_FOR_ROLE[role]) return { invalid: R.TEMPLATE_GEOMETRY_INVALID };
    const shape = shf.value;

    // integer x/y/w/h fully inside the exact 1080×1350 canvas.
    const box = readSlotBox(slot);
    if (box.blocked) return { blocked: true };
    if (!box.ok) return { invalid: R.TEMPLATE_GEOMETRY_INVALID };

    // (P1-1) DERIVED geometry identity — the module's authority. Computed from the
    // slot's own real fields; not read from any caller token.
    const canonId = deriveGeometryId(slotId, role, shape, box.x, box.y, box.w, box.h);

    // A caller may CLAIM a geometryId, but it is only VERIFIED against the derived
    // identity (never trusted as authority): a stale/tampered claim → geometry invalid.
    const gidf = safeOwnValue(slot, 'geometryId');
    if (gidf.blocked) return { blocked: true };
    if (gidf.ok && gidf.value !== canonId) return { invalid: R.TEMPLATE_GEOMETRY_INVALID };

    counts[role] += 1;
    slotsByRole[role].push({ slotId, canonId });
  }

  const demand = {};
  for (const role of POOL_ROLES) {
    const n = counts[role]; // requiredSlots; each panel is a distinct image
    demand[role] = { requiredSlots: n, requiredUnique: n };
  }
  if (!POOL_ROLES.some((role) => demand[role].requiredUnique >= 1)) {
    return { invalid: R.TEMPLATE_GEOMETRY_INVALID }; // a realized template demands >=1 role
  }
  return { matched: true, demand, slotsByRole };
}

// ---------- per-candidate geometry-scoped crop verdicts ----------
//
// Every relevant candidate MUST carry `slotCrops` — a per-slot verdict list bound
// ONE-TO-ONE to the EXACT (slotId + DERIVED identity) of EVERY demanded slot of its
// role. Missing / extra / duplicate / mismatched-geometry / non-boolean verdicts
// mean the candidate was NOT validly crop-evaluated -> the role's crop measurement
// is INCOMPLETE (never inferred from anything else). NO role-wide crop boolean.
//
// Returns:
//   { blocked:true }             structural hostility (bail whole descriptor)
//   { incomplete:true }          crop telemetry missing / malformed / mismatched / STALE
//   { safeSlots: Set<slotId> }   the demanded slotIds this candidate is crop-safe for
function readSlotCrops(cand, demandSlots) {
  const sc = readOwnArray(cand, 'slotCrops');
  if (sc.blocked) return { blocked: true };
  if (sc.absent || sc.invalid) return { incomplete: true };     // missing crop telemetry
  if (sc.len !== demandSlots.length) return { incomplete: true }; // missing / extra rows

  const canonById = new Map();
  for (const d of demandSlots) canonById.set(d.slotId, d.canonId);

  const seen = new Set();
  const safeSlots = new Set();
  for (let i = 0; i < sc.len; i++) {
    const ef = safeOwnValue(sc.arr, String(i));
    if (ef.blocked) return { blocked: true };
    if (!ef.ok) return { blocked: true };            // hole in the verdict list
    if (!isSafePlainObject(ef.value)) return { blocked: true };
    const row = ef.value;

    const sidf = safeOwnValue(row, 'slotId');
    if (sidf.blocked) return { blocked: true };
    const gidf = safeOwnValue(row, 'geometryId');
    if (gidf.blocked) return { blocked: true };
    const csf = safeOwnValue(row, 'cropSafe');
    if (csf.blocked) return { blocked: true };

    if (!sidf.ok || !validToken(sidf.value)) return { incomplete: true };
    if (!gidf.ok || typeof gidf.value !== 'string') return { incomplete: true };
    if (!csf.ok || typeof csf.value !== 'boolean') return { incomplete: true };

    const slotId = sidf.value;
    if (!canonById.has(slotId)) return { incomplete: true };              // extra / foreign slot
    // (P1-1) The row's bound geometry identity must EQUAL the identity the module
    // RECOMPUTED from the slot's real (slotId+role+shape+geometry). A STALE token
    // (bound to pre-change coordinates) no longer matches -> incomplete, so the role
    // can never COMPLETE / the pool can never be READY on stale crop math.
    if (gidf.value !== canonById.get(slotId)) return { incomplete: true }; // stale / mismatched identity
    if (seen.has(slotId)) return { incomplete: true };                    // duplicate slot
    seen.add(slotId);
    if (csf.value === true) safeSlots.add(slotId);
  }
  // length === demand AND every row matched a DISTINCT demanded slot -> exact 1:1.
  return { safeSlots };
}

// ---------- injective panel feasibility (per role and global) ----------
//
// Collapse crop-safe candidates into distinct-image groups (union-find over
// identity ∪ near-dup pHash), then compute the MAXIMUM number of the given panels
// that can be simultaneously filled by DISTINCT images, each matched to a DISTINCT
// panel it is crop-safe for (maximum bipartite matching). Candidates crop-safe only
// for the SAME panel can never satisfy two panels; near-duplicates can never inflate
// the total. Deterministic: groups in ascending root order, slots in demand order.
//
// Kuhn's augment recursion depth is bounded by the number of slots S, and S is
// bounded by MAX_REALIZED_SLOTS (10) — so recursion depth ≤ 10 by construction.
function matchDistinctToSlots(safeList, slotIds) {
  const n = safeList.length;
  const S = slotIds.length;
  if (S === 0) return 0;
  if (n === 0) return 0;

  const parent = new Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a); const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra; else parent[ra] = rb;
  };
  const idMap = new Map();
  const phMap = new Map();
  for (let i = 0; i < n; i++) {
    const { id, ph } = safeList[i];
    if (idMap.has(id)) union(i, idMap.get(id)); else idMap.set(id, i);
    if (phMap.has(ph)) union(i, phMap.get(ph)); else phMap.set(ph, i);
  }

  // group root -> union of the safe slotIds its members reach.
  const groupSlots = new Map();
  const roots = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let gs = groupSlots.get(r);
    if (!gs) { gs = new Set(); groupSlots.set(r, gs); roots.push(r); }
    for (const s of safeList[i].safeSlots) gs.add(s);
  }
  roots.sort((a, b) => a - b);

  // (P1-4) Bound match edges BEFORE building adjacency: groups × slots. An input
  // whose product exceeds the cap is refused fail-closed (0 = nothing provably
  // feasible) rather than allocating a huge bipartite graph.
  if (roots.length * S > MAX_MATCH_EDGES) return -1;

  const adj = roots.map((r) => {
    const gs = groupSlots.get(r);
    const list = [];
    for (let idx = 0; idx < S; idx++) {
      if (gs.has(slotIds[idx])) list.push(idx);
    }
    return list;
  });

  const matchSlot = new Array(S).fill(-1);
  const augment = (g, visited) => {
    for (const idx of adj[g]) {
      if (visited[idx]) continue;
      visited[idx] = true;
      if (matchSlot[idx] === -1 || augment(matchSlot[idx], visited)) {
        matchSlot[idx] = g;
        return true;
      }
    }
    return false;
  };
  let m = 0;
  for (let g = 0; g < adj.length; g++) {
    const visited = new Array(S).fill(false);
    if (augment(g, visited)) m++;
  }
  return m;
}

// Per-role distinct feasibility (capped at that role's panel count).
function feasibleDistinct(safeList, demandSlots) {
  const slotIds = demandSlots.map((d) => d.slotId);
  const m = matchDistinctToSlots(safeList, slotIds);
  return m < 0 ? 0 : m; // over-bound -> 0 distinct (fail closed); handled globally too
}

// ---------- per-role raw pool measurement ----------
//
// Every element of the role's `candidates` array is a vetted-relevant candidate
// (vettedRelevant = list length — the RAW supply, duplicates and all). The funnel
// cropSafe ⊆ highRes ⊆ vettedRelevant holds by construction.
//
// (P1-2) Geometry-scoped crop telemetry is inspected + validated for EVERY
// relevant candidate BEFORE the highRes gate — including MEASURED low-res
// candidates. A candidate whose crop verdict is missing / malformed / mismatched /
// STALE (or whose resolution is unknown) makes the role's crop measurement incomplete.
//
// Returns:
//   { blocked:true }   structural hostility (bail whole descriptor)
//   { missing:true }   no measurable candidate pool for this role (incl. over-bound)
//   { data }           { vetted, highRes, cropSafe, cropComplete, coverageComplete, safeList }
//                       safeList entries: { id, ph, safeSlots:Set<slotId> }
function measureRolePools(container, role, demandSlots) {
  const rf = safeOwnValue(container, role);
  if (rf.blocked) return { blocked: true };
  if (!rf.ok) return { missing: true };
  if (!isSafePlainObject(rf.value)) return { blocked: true };

  const ca = readOwnArray(rf.value, 'candidates');
  if (ca.blocked) return { blocked: true };
  if (ca.absent || ca.invalid) return { missing: true };

  const vetted = ca.len; // raw supply (duplicates included) — never deduped
  const roleSlots = demandSlots.length; // 1..MAX_REALIZED_SLOTS

  // (P1-4) HARD BOUNDS BEFORE ALLOCATION / the per-candidate loop: refuse an absurd
  // candidate list or an over-product (candidates × slots = crop cells) fail-closed
  // rather than allocating safeList / iterating.
  if (vetted > MAX_CANDIDATES_PER_ROLE) return { missing: true };
  if (vetted * roleSlots > MAX_CROP_CELLS) return { missing: true };

  let highRes = 0;
  let cropSafe = 0;
  let cropComplete = true;
  const safeList = []; // { id, ph, safeSlots:Set } — crop-safe high-res candidates

  for (let i = 0; i < vetted; i++) {
    const cf = safeOwnValue(ca.arr, String(i));
    if (cf.blocked) return { blocked: true };
    if (!cf.ok) return { blocked: true };            // hole in the candidate list
    if (!isSafePlainObject(cf.value)) return { blocked: true };
    const cand = cf.value;

    // (P1-2) Validate geometry-scoped crop telemetry FIRST — for every candidate,
    // before the highRes gate (measured low-res candidates included).
    const cv = readSlotCrops(cand, demandSlots);
    if (cv.blocked) return { blocked: true };
    if (cv.incomplete) { cropComplete = false; continue; }

    // Resolution gate — must be a MEASURED boolean. Unknown resolution = the
    // candidate was not fully evaluated -> role measurement incomplete.
    const hr = safeOwnValue(cand, 'highRes');
    if (hr.blocked) return { blocked: true };
    if (!hr.ok || typeof hr.value !== 'boolean') { cropComplete = false; continue; }
    if (hr.value !== true) continue;                  // measured low-res: crop already validated
    highRes += 1;

    // Crop-safe for at least one demanded slot -> counts toward the raw cropSafe
    // pile and carries opaque distinctness tokens (used ONLY as equality keys).
    if (cv.safeSlots.size >= 1) {
      cropSafe += 1;
      const idf = safeOwnValue(cand, 'identity');
      if (idf.blocked) return { blocked: true };
      const phf = safeOwnValue(cand, 'pHash');
      if (phf.blocked) return { blocked: true };
      safeList.push({
        id: idf.ok ? idf.value : undefined,
        ph: phf.ok ? phf.value : undefined,
        safeSlots: cv.safeSlots,
      });
    }
  }

  // Uniqueness coverage: every crop-safe candidate must carry BOTH a valid identity
  // and a valid pHash token, else distinctness cannot be trusted. Only meaningful
  // when crop telemetry itself was complete.
  let coverageComplete = cropComplete;
  if (cropComplete) {
    for (const c of safeList) {
      if (!validToken(c.id) || !validToken(c.ph)) { coverageComplete = false; break; }
    }
  }

  return { data: { vetted, highRes, cropSafe, cropComplete, coverageComplete, safeList } };
}

// ---------- global distinct → all-demanded-slots feasibility ----------
//
// (P1-3) Uniqueness / feasibility must be GLOBAL: a single distinct group (identity
// ∪ pHash) may be counted toward AT MOST one panel across ALL roles. Flatten every
// (fully-complete) demanded role's crop-safe candidates into ONE pool and every
// demanded slot into ONE slot list, then take the maximum bipartite matching.
//   feasible === true  iff the matching fills EVERY demanded panel (across all roles)
//                          with a DISTINCT image (no double counting).
// A -1 from the matcher (over-bound) or an unfilled panel -> feasible:false.
function globalDistinctFeasible(completeRoles, roleData, slotsByRole) {
  const all = [];
  for (const role of completeRoles) {
    for (const c of roleData[role].safeList) all.push(c);
  }
  const slotIds = [];
  for (const role of completeRoles) {
    for (const s of slotsByRole[role]) slotIds.push(s.slotId);
  }
  const S = slotIds.length;
  if (S === 0) return true;
  const m = matchDistinctToSlots(all, slotIds);
  if (m < 0) return false; // over-bound -> fail closed
  return m === S;
}

// ---------- descriptor assembly ----------

function orderReasons(set) {
  return REASON_ORDER.filter((tok) => set.has(tok));
}

function structuralDescriptor() {
  // No templateMatch -> the consumer reads MISSING_TEMPLATE_MATCH -> insufficient.
  return deepFreeze({
    version: VERSION,
    status: MEASUREMENT_STATUS.INCOMPLETE,
    measurementComplete: false,
    incomplete: [R.STRUCTURAL],
  });
}

function incompleteNoTemplate(reasonToken) {
  return deepFreeze({
    version: VERSION,
    status: MEASUREMENT_STATUS.INCOMPLETE,
    measurementComplete: false,
    incomplete: [reasonToken],
  });
}

// A role object the consumer will read as INCOMPLETE_MEASUREMENT (cropEvaluated:false)
// — the sanctioned "consumer-failing role row" used to drive insufficient-data
// WITHOUT fabricating a STOCK/CROP/SELECTION cause.
function consumerFailingRow(vetted, highRes, cropSafe) {
  return {
    vettedRelevant: vetted, highRes, cropSafe,
    cropEvaluated: false, uniquenessEvaluated: false,
  };
}

// Build the pool descriptor from raw telemetry. Never throws (top-level backstop).
export function buildSearchQualityDescriptor(input) {
  try {
    if (!isSafePlainObject(input)) return structuralDescriptor();

    const auth = readTemplateAuthority(input);
    if (auth.blocked) return structuralDescriptor();
    if (auth.invalid) return incompleteNoTemplate(auth.invalid);

    if (auth.matched === false) {
      // A MEASURED absence of any reference template -> consumer TEMPLATE_ABSENT.
      return deepFreeze({
        version: VERSION,
        status: MEASUREMENT_STATUS.COMPLETE,
        measurementComplete: true,
        templateMatch: false,
        incomplete: [],
      });
    }

    // matched === true: read the measured role pools.
    const rolesField = safeOwnValue(input, 'roles');
    if (rolesField.blocked) return structuralDescriptor();
    let container = null;
    if (rolesField.ok) {
      if (!isSafePlainObject(rolesField.value)) return structuralDescriptor();
      container = rolesField.value;
    }

    const demandedRoles = POOL_ROLES.filter((role) => auth.demand[role].requiredUnique >= 1);

    const rolesOut = {};
    const reasons = new Set();
    let measurementComplete = true;

    // ---- Phase 1: raw per-role measurement (no cross-role reasoning yet). ----
    const roleData = {};
    for (const role of demandedRoles) {
      if (container === null) {
        measurementComplete = false;
        reasons.add(R.ROLE_TELEMETRY_MISSING);
        continue; // omit role -> consumer MISSING_ROLE -> insufficient
      }
      const m = measureRolePools(container, role, auth.slotsByRole[role]);
      if (m.blocked) return structuralDescriptor();
      if (m.missing) {
        measurementComplete = false;
        reasons.add(R.ROLE_TELEMETRY_MISSING);
        continue; // omit role -> consumer MISSING_ROLE
      }
      roleData[role] = m.data;
    }

    // ---- Phase 2: classify each measured role; defer fully-complete roles. ----
    const completeRoles = [];
    for (const role of demandedRoles) {
      const data = roleData[role];
      if (!data) continue; // already handled as missing
      const U = auth.demand[role].requiredUnique;

      if (!data.cropComplete) {
        rolesOut[role] = consumerFailingRow(data.vetted, data.highRes, data.cropSafe);
        measurementComplete = false;
        reasons.add(R.CROP_NOT_EVALUATED);
        continue;
      }

      if (!data.coverageComplete) {
        // Uniqueness coverage incomplete. (P1-3) Force the consumer to insufficient:
        //   • demand>=2 AND raw crop-safe looks numerically sufficient -> the consumer's
        //     NATIVE uniqueness gate can fire: emit uniquenessEvaluated:false so it
        //     returns UNIQUENESS_NOT_EVALUATED.
        //   • otherwise that native gate can NEVER fire -> emit the strongest
        //     consumer-failing shape (cropEvaluated:false) -> INCOMPLETE_MEASUREMENT.
        if (U >= 2 && data.cropSafe >= U) {
          rolesOut[role] = {
            vettedRelevant: data.vetted, highRes: data.highRes, cropSafe: data.cropSafe,
            cropEvaluated: true, uniquenessEvaluated: false,
          };
        } else {
          rolesOut[role] = consumerFailingRow(data.vetted, data.highRes, data.cropSafe);
        }
        measurementComplete = false;
        reasons.add(R.UNIQUENESS_NOT_EVALUATED);
        continue;
      }

      completeRoles.push(role);
    }

    // ---- Phase 3: distinct feasibility for fully-complete roles. ----
    // Per-role local distinct (capped at that role's panel count) is emitted for
    // every complete role. A GENUINE per-role shortfall (local distinct < demand) is
    // a real MEASURED CROP cause and stays COMPLETE (the consumer classifies CROP).
    const localDistinct = {};
    let anyLocalShort = false;
    for (const role of completeRoles) {
      const d = feasibleDistinct(roleData[role].safeList, auth.slotsByRole[role]);
      localDistinct[role] = d;
      if (d < auth.demand[role].requiredUnique) anyLocalShort = true;
    }
    for (const role of completeRoles) {
      const data = roleData[role];
      rolesOut[role] = {
        vettedRelevant: data.vetted, highRes: data.highRes, cropSafe: data.cropSafe,
        cropEvaluated: true, uniquenessEvaluated: true, cropSafeDistinct: localDistinct[role],
      };
    }

    // (P1-3) GLOBAL cross-role feasibility. Only meaningful when the descriptor is
    // otherwise fully COMPLETE and every demanded role is locally sufficient — that
    // is the ONLY case where a false READY could slip through by counting one shared
    // distinct image toward two different roles/slots. If the GLOBAL matching cannot
    // fill every demanded panel with a DISTINCT image, drive the consumer to
    // insufficient-data via a consumer-failing role row (NOT a fabricated cause).
    if (
      measurementComplete &&
      !anyLocalShort &&
      completeRoles.length === demandedRoles.length &&
      demandedRoles.length > 0
    ) {
      const feasible = globalDistinctFeasible(completeRoles, roleData, auth.slotsByRole);
      if (!feasible) {
        const failRole = completeRoles[completeRoles.length - 1];
        const data = roleData[failRole];
        rolesOut[failRole] = consumerFailingRow(data.vetted, data.highRes, data.cropSafe);
        measurementComplete = false;
        reasons.add(R.GLOBAL_DISTINCT_INFEASIBLE);
      }
    }

    const templateOut = { roles: {} };
    for (const role of POOL_ROLES) {
      templateOut.roles[role] = {
        requiredSlots: auth.demand[role].requiredSlots,
        requiredUnique: auth.demand[role].requiredUnique,
      };
    }

    return deepFreeze({
      version: VERSION,
      status: measurementComplete ? MEASUREMENT_STATUS.COMPLETE : MEASUREMENT_STATUS.INCOMPLETE,
      measurementComplete,
      templateMatch: true,
      template: templateOut,
      roles: rolesOut,
      incomplete: orderReasons(reasons),
    });
  } catch {
    // Absolute backstop: no untrusted-telemetry path may throw out of the producer.
    return structuralDescriptor();
  }
}

export default Object.freeze({
  version,
  STACKED_AFTER_SEARCH_QUALITY_METRICS,
  POOL_ROLES,
  LIMITS,
  MEASUREMENT_STATUS,
  INCOMPLETE_REASON,
  deriveGeometryId,
  buildSearchQualityDescriptor,
});
