// ============================================================
// candidateCropReadiness.js — INDEPENDENT_READINESS_V1 producer
// ============================================================
//
// PURE, DETERMINISTIC, FAIL-CLOSED. This module sits UPSTREAM of
// searchQualityMeasurement.js (the E-PASS measurement builder). It turns RAW,
// per-candidate geometry facts (trusted full dimensions + provenance, validated
// normalized subject/face boxes, per-slot identity eligibility, distinctness
// tokens) into an EPHEMERAL, PRIVATE per-candidate×slot crop-readiness telemetry
// whose shape plugs DIRECTLY into `buildSearchQualityDescriptor(input)`.
//
// HONESTY BOUNDARY — this is NOT the renderer:
//   • `RENDERER_PARITY = false`. Every crop verdict here is an INDEPENDENT
//     readiness ESTIMATE, computed from the WHOLE-image cover-fit against the
//     slot's real geometry — the same scale the composer's own pre-render check uses
//     (megaComposerService.js `_slotUpEst`, lines 1246-1251:
//        up = (iw/ih) >= (sl.w/sl.h) ? sl.h/ih : sl.w/iw  === max(sl.w/iw, sl.h/ih))
//     with the surviving crop window CENTERED in the source (the whole-image render
//     path is sharp `fit:'cover', position:'centre'` — coverComposer.js /
//     imageComposer.js). The subject box is judged at its ACTUAL mapped position
//     inside that window — NO best-case centering / sliding anywhere. It never
//     re-runs the executor's per-region pixel math (that needs IO) and never claims
//     to. A SAFE verdict means "independently looks placeable", not "the renderer
//     guarantees it".
//   • It NEVER fabricates a safe/unsafe verdict. Any missing / ambiguous /
//     untrusted fact ⇒ the cell is UNEVALUATED (fail-closed toward "not measured").
//     An UNEVALUATED cell is emitted to E as a slotCrops row WITHOUT a boolean
//     `cropSafe`, which drives E's `readSlotCrops` to `incomplete` → the consumer
//     reads CROP_NOT_EVALUATED. It can never silently become a safe verdict.
//   • It emits a feed ONLY when the candidate UNIVERSE is PROVEN complete (exact proof
//     schema, see below) — `measurementReady:true`. Any UNPROVEN / truncated / count-
//     mismatched universe ⇒ `feed:null` + `measurementReady:false` — no unproven or
//     truncated universe EVER reaches E. A PROVEN-COMPLETE EMPTY pool is different:
//     it MAY produce a feed, but every demanded-yet-empty role is OMITTED from that
//     feed, so E reports incomplete (ROLE_TELEMETRY_MISSING) — never a vacuous COMPLETE.
//
// GROUNDING (no invented shapes / thresholds — all mirror the real pipeline):
//   • Canvas is the fixed 1080×1350 cover (refTemplate.js: W=1080, H=1350). Every
//     slot box is integer x/y/w/h fully inside it.
//   • Slot shape enum is EXACTLY 'rect' | 'circle' (refSlotContract.js): the
//     collapsed hero ('main') and support slots are RECT, only the circle slot is
//     CIRCLE. Collapsed POOL_ROLE → canonical shape: hero/support→rect, circle→circle.
//   • GEOMETRY IDENTITY is DERIVED here byte-identically to the seeded
//     deriveGeometryId (searchQualityMeasurement.js) — never trusted from a caller
//     token. A slot MAY claim a `geometryId`; the claim is only VERIFIED against the
//     derived value (a stale/tampered claim → geometry invalid, fail-closed).
//   • Upscale threshold: hero/main crop > 1.2× fails, other slots > 1.6× fail
//     (imageQualityConfig.js HERO_STRETCH_MAX=1.2 / OTHER_STRETCH_MAX=1.6).
//   • Hero real short side floor 700px (imageQualityConfig.js HERO_MIN_SHORT_SIDE).
//   • `measuredFrom` provenance ∈ 'full' | 'thumb' | null (libraryTriage.js). Only
//     'full' is trusted for real resolution; 'thumb'/null ⇒ dimensions UNTRUSTED
//     ⇒ the cell is UNEVALUATED (grounded: triage caps quality from thumb size).
//   • Normalized boxes are {x1,y1,x2,y2} in [0,1] (normalizeFaceBox). subjectBox is
//     preferred; faceBox is a fallback ONLY when subjectBox is ABSENT (a present-but-
//     invalid subjectBox is NOT replaced by faceBox — it just yields no box → UNEVALUATED).
//   • POSITIONAL CROP HONESTY (P1): a box always keeps its FULL position (x1,y1,x2,y2 +
//     extents). The REAL crop window is derived from the source dims + slot aspect
//     (cover-fit, centre gravity) and the box is MAPPED into crop-normalized coords at
//     its ACTUAL position. RECT: the mapped box must lie fully inside the window (a box
//     partially outside ⇒ not contained). CIRCLE slots must be SQUARE (w===h); all 4
//     mapped corners must lie inside the inscribed circle (center (0.5,0.5), radius 0.5).
//     A NON-square circle is UNEVALUATED (its mask cannot be honestly computed). A
//     missing/invalid position ⇒ UNEVALUATED. NO best-case centering anywhere.
//   • Near-duplicate class comes ONLY from a TRUSTED pre-clustered bucket
//     (`pHashCluster:{ bucketId, provenance:'precluster_v1', version:1 }`). A raw pHash64
//     is NEVER used as a bucket (no invented distance threshold) ⇒ uniqueness UNMEASURED.
//
// PRIVACY (EPHEMERAL / PRIVATE result):
//   • The result is DETACHED (built only from primitive descriptor reads — never
//     stores an input reference) and DEEP-FROZEN.
//   • Candidate PII (identity cluster token, pre-cluster bucketId) is TOKENIZED to
//     opaque ordinals (`id:N` / `ph:N`, first-appearance order) — the RAW values
//     never appear in the output; only their equality relationships survive (so E's
//     distinctness matching still works). No urls / names / paths / base64 / ids /
//     raw pHash are ever read or echoed (extra input fields are ignored by
//     descriptor-only reads). Raw candidate ids / slotIds NEVER leak into any DURABLE
//     field — the durable `summary` is counts-only; slotIds live only in the ephemeral feed.
//   • The DURABLE `summary` carries COUNTS ONLY — no slotId / geometryId / identity
//     / pHash / matrix. The raw per-candidate×slot matrix lives ONLY inside the
//     EPHEMERAL `feed` (E's input), never in a durable field.
//   • slotId / geometryId are TEMPLATE STRUCTURE (not PII) and appear only inside
//     the ephemeral feed because E requires them; they are used solely as opaque
//     equality keys and never decoded.
//
// HARD BOUNDS (checked BEFORE any allocation / per-element loop): slots ≤ 10,
// candidates ≤ 2000 per role, crop cells (candidates × role slots) ≤ 4000, match
// edges (candidates × total slots, an upper bound on distinct-group edges) ≤ 20000.
// An over-product input is REJECTED fail-closed, never allocated.
//
// CONTRACT: no imports, no IO, no network, no Date/Math.random, no environment.
// Same request → byte-identical result forever. Untrusted input is read ONLY
// through own-property descriptors (never `obj.foo`, never `in`, never a getter);
// accessor fields / exotic prototypes / throwing traps ⇒ STRUCTURAL fail-closed.
// ============================================================

export const version = 1;
const VERSION = version;

// Producer identity + honesty markers (exported so an integrator/test can assert them).
export const PRODUCER = 'INDEPENDENT_READINESS_V1';
export const RENDERER_PARITY = false;

// The three cover roles E's descriptor is expressed in (mirrors searchQualityMeasurement).
export const POOL_ROLES = Object.freeze(['hero', 'circle', 'support']);

// Fixed cover canvas (refTemplate.js). Slot boxes must lie FULLY inside it.
const CANVAS_W = 1080;
const CANVAS_H = 1350;

// Canonical shape bound to each collapsed POOL_ROLE (refSlotContract.js shape enum).
const SHAPE_FOR_ROLE = Object.freeze({ hero: 'rect', circle: 'circle', support: 'rect' });

// ---- grounded numeric thresholds (imageQualityConfig.js — values must match) ----
const HERO_STRETCH_MAX = 1.2;    // hero/main crop upscale > 1.2× fails
const OTHER_STRETCH_MAX = 1.6;   // other slots crop upscale > 1.6× fails
const HERO_MIN_SHORT_SIDE = 700; // hero real short side floor (px)
// Float tolerance for the (integer-derived) ratio comparisons.
const EPS = 1e-9;

// A list longer than this is treated as hostile/absurd, not clamped (mirrors E).
const MAX_COUNT = 100000;
// Opaque tokens beyond this length are refused (defensive; tokens are tokenized away).
const MAX_TOKEN_LEN = 4096;

// ---- (P0-1 / P1-5) candidate-universe PROOF (exact schema — no laxity) ----
// The ONLY scope that proves a FULLY-vetted, non-truncated candidate universe. Any
// other value (e.g. an 's6_sorted' partial, an 'empty' incomplete) fails the proof.
export const UNIVERSE_SCOPE = 'full_vetted_v1';

// ---- (P1-4) trusted pre-clustered near-duplicate bucket (NOT a raw pHash) ----
// The near-dup class token is accepted ONLY from a pre-clustered descriptor carrying
// EXPLICIT provenance + version. A raw pHash64 (or a missing/mis-versioned cluster) is
// NEVER turned into a near-dup bucket — the module refuses to invent a distance
// threshold, so uniqueness for that candidate stays UNMEASURED.
export const PRECLUSTER = Object.freeze({ PROVENANCE: 'precluster_v1', VERSION: 1 });

// ---------- HARD BOUNDS (checked BEFORE any allocation / loop) ----------
const MAX_REALIZED_SLOTS = 10;         // total demanded slots across all roles
const MAX_CANDIDATES_PER_ROLE = 2000;  // length of a single role's candidate list
const MAX_CROP_CELLS = 4000;           // candidates × slots (per role) = crop cells
const MAX_MATCH_EDGES = 20000;         // candidates(all roles) × total slots (edge upper bound)

export const LIMITS = Object.freeze({
  MAX_REALIZED_SLOTS,
  MAX_CANDIDATES_PER_ROLE,
  MAX_CROP_CELLS,
  MAX_MATCH_EDGES,
  MAX_TOKEN_LEN,
});

// Per-cell verdict enum (a cell = one candidate × one demanded slot).
export const CELL_VERDICT = Object.freeze({
  SAFE: 'SAFE',
  UNSAFE: 'UNSAFE',
  UNEVALUATED: 'UNEVALUATED',
});

// The ONLY reasons a request is rejected fail-closed (ok:false, feed:null,
// measurementReady:false — E is NEVER called for any of these).
export const REASON = Object.freeze({
  STRUCTURAL: 'STRUCTURAL',                               // hostile / exotic / accessor / trap / non-object
  BOUNDS_EXCEEDED: 'BOUNDS_EXCEEDED',                     // over a HARD BOUND cap
  TEMPLATE_NOT_MEASURED: 'TEMPLATE_NOT_MEASURED',         // slots absent / empty
  TEMPLATE_GEOMETRY_INVALID: 'TEMPLATE_GEOMETRY_INVALID', // malformed / role-only / out-of-canvas / stale claim / dup slotId
  UNIVERSE_NOT_PROVEN: 'UNIVERSE_NOT_PROVEN',            // (P0-1) proof missing/wrong-typed/truncated/capped/count-mismatch
});

// ---------- pure structural helpers (descriptor-only, never throw) ----------

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  return Object.freeze(obj);
}

// Genuine plain object (prototype Object.prototype or null). Arrays / class
// instances / exotic prototypes / throwing traps → false.
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
//   { ok:true, value }          present data property
//   { ok:false, blocked:false } absent (benign / not measured)
//   { ok:false, blocked:true }  accessor OR descriptor read threw (trap): hostility
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

// A genuine array whose prototype is EXACTLY Array.prototype.
function probeArray(v) {
  try {
    if (!Array.isArray(v)) return { ok: false };
    if (Object.getPrototypeOf(v) !== Array.prototype) return { ok: false };
    return { ok: true };
  } catch {
    return { blocked: true };
  }
}

// Read a genuine own array by descriptor.
//   { blocked } | { invalid } | { absent } | { arr, len }
//
// (P0-2) NO UNBOUNDED ENUMERATION BEFORE CAP. We NEVER call Reflect.ownKeys /
// Object.keys / for-in on the (untrusted, possibly Proxy / unbounded) array — a
// hostile Proxy's `ownKeys` trap must never be invoked. We read the own `length`
// descriptor FIRST and reject `length > MAX_COUNT` fail-closed; the CALLER then
// applies the tighter hard cap (slots ≤ 10 / candidates ≤ 2000) BEFORE its per-element
// loop, and reads ONLY the dense numeric indices 0..length-1 via
// Object.getOwnPropertyDescriptor. Extra / symbol / hidden keys are IGNORED without
// ever being enumerated (a hole at a dense index is caught when that index is read).
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
  return { arr: o.value, len };
}

// An opaque token is valid only as a bounded primitive.
function validToken(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length > 0 && v.length <= MAX_TOKEN_LEN;
  return false;
}

// (P2-1) A slotId is a CANONICAL, BOUNDED, NON-EMPTY STRING — type-exact. It is used
// as a property key (eligibility lookup) and an equality key (crop-row ↔ slot binding);
// a NUMBER would silently coerce so the numeric `1` and the string `'1'` would collide.
// Forbidding non-strings keeps the identity type-exact end-to-end. (deriveGeometryId
// itself still length-prefixes String(slotId) so its parity contract is unchanged.)
function validSlotId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_TOKEN_LEN;
}

// Read a bounded positive integer own field. { blocked } | { ok:false } | { ok:true, n }
function readPosInt(obj, key) {
  const f = safeOwnValue(obj, key);
  if (f.blocked) return { blocked: true };
  if (!f.ok || typeof f.value !== 'number' || !Number.isInteger(f.value)) return { ok: false };
  if (f.value < 1 || f.value > MAX_COUNT) return { ok: false };
  return { ok: true, n: f.value };
}

// Read a boolean own field. { blocked } | { ok:false } | { ok:true, v }
function readBool(obj, key) {
  const f = safeOwnValue(obj, key);
  if (f.blocked) return { blocked: true };
  if (!f.ok || typeof f.value !== 'boolean') return { ok: false };
  return { ok: true, v: f.value };
}

// ---------- canonical geometry identity (byte-identical to the seeded module) ----------
// DERIVED here; never trusted from a caller token. Used solely as an opaque equality
// key and, inside the ephemeral feed, echoed only so E can re-derive + verify it.
export function deriveGeometryId(slotId, role, shape, x, y, w, h) {
  const sid = String(slotId);
  return `gid1|${sid.length}|${sid}|${role}|${shape}|${x}|${y}|${w}|${h}`;
}

// ---------- validated normalized box ----------
// Read a normalized {x1,y1,x2,y2} box with 0 <= x1 < x2 <= 1, 0 <= y1 < y2 <= 1.
//   { blocked:true }               accessor / trap on the field or a coordinate → structural
//   { absent:true }                the field is ABSENT (own-property missing)
//   { ok:false }                   the field is PRESENT but not a valid box (null / non-object /
//                                  missing / non-finite / out-of-range coord): "present-but-invalid"
//   { ok:true, x1,y1,x2,y2, w, h } valid box — the FULL POSITION is retained (P1 positional
//                                  honesty: a box is NEVER reduced to width/height only; the
//                                  crop verdict is judged at the subject's ACTUAL position).
//                                  A missing/invalid coordinate ⇒ { ok:false } ⇒ the cell is
//                                  UNEVALUATED — position is never guessed or defaulted.
//
// (P1-3) ABSENT and PRESENT-BUT-INVALID are DISTINCT: a present-but-invalid subjectBox
// must NOT fall back to faceBox (fallback is allowed only when subjectBox is ABSENT), and
// an invalid box is a per-cell UNEVALUATED — NEVER a whole-structural reject. Only a real
// accessor / trap (hostility) is structural.
function readNormBox(obj, key) {
  const f = safeOwnValue(obj, key);
  if (f.blocked) return { blocked: true };
  if (!f.ok) return { absent: true };                 // field absent → caller MAY fall back
  if (!isSafePlainObject(f.value)) return { ok: false }; // present-but-invalid (null / array / exotic)
  const box = f.value;
  const vals = {};
  for (const k of ['x1', 'y1', 'x2', 'y2']) {
    const c = safeOwnValue(box, k);
    if (c.blocked) return { blocked: true };           // accessor on a coordinate → hostility
    if (!c.ok || typeof c.value !== 'number' || !Number.isFinite(c.value)) return { ok: false };
    vals[k] = c.value;
  }
  const { x1, y1, x2, y2 } = vals;
  if (!(x1 >= 0 && y1 >= 0 && x2 <= 1 && y2 <= 1 && x2 > x1 && y2 > y1)) return { ok: false };
  return { ok: true, x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

// ---------- template authority (real geometry, derived identity) ----------
// Returns exactly one of:
//   { blocked:true }                                  structural hostility
//   { reason }                                        TEMPLATE_NOT_MEASURED / _GEOMETRY_INVALID / BOUNDS_EXCEEDED
//   { slotsByRole, orderedSlots, totalSlots, demand } valid realized template
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

function readTemplate(input) {
  const sa = readOwnArray(input, 'slots');
  if (sa.blocked) return { blocked: true };
  if (sa.absent) return { reason: REASON.TEMPLATE_NOT_MEASURED };
  if (sa.invalid || sa.len < 1) return { reason: REASON.TEMPLATE_GEOMETRY_INVALID };
  // HARD BOUND before the per-slot loop.
  if (sa.len > MAX_REALIZED_SLOTS) return { reason: REASON.BOUNDS_EXCEEDED };

  const slotsByRole = { hero: [], circle: [], support: [] };
  const orderedSlots = [];
  const seenSlotIds = new Set();

  for (let i = 0; i < sa.len; i++) {
    const e = safeOwnValue(sa.arr, String(i));
    if (e.blocked) return { blocked: true };
    if (!e.ok) return { reason: REASON.TEMPLATE_GEOMETRY_INVALID }; // hole
    if (!isSafePlainObject(e.value)) return { blocked: true };
    const slot = e.value;

    const rf = safeOwnValue(slot, 'role');
    if (rf.blocked) return { blocked: true };
    if (!rf.ok || typeof rf.value !== 'string' || !POOL_ROLES.includes(rf.value)) {
      return { reason: REASON.TEMPLATE_GEOMETRY_INVALID };
    }
    const role = rf.value;

    const sidf = safeOwnValue(slot, 'slotId');
    if (sidf.blocked) return { blocked: true };
    // (P2-1) slotId must be a canonical bounded NON-EMPTY STRING (type-exact) — a numeric
    // slotId is rejected so `1` can never collide with `'1'` in a downstream key lookup.
    if (!sidf.ok || !validSlotId(sidf.value)) return { reason: REASON.TEMPLATE_GEOMETRY_INVALID };
    const slotId = sidf.value;
    if (seenSlotIds.has(slotId)) return { reason: REASON.TEMPLATE_GEOMETRY_INVALID };
    seenSlotIds.add(slotId);

    const shf = safeOwnValue(slot, 'shape');
    if (shf.blocked) return { blocked: true };
    if (!shf.ok || shf.value !== SHAPE_FOR_ROLE[role]) return { reason: REASON.TEMPLATE_GEOMETRY_INVALID };
    const shape = shf.value;

    const box = readSlotBox(slot);
    if (box.blocked) return { blocked: true };
    if (!box.ok) return { reason: REASON.TEMPLATE_GEOMETRY_INVALID };

    // DERIVED authority identity. A CLAIMED geometryId is only VERIFIED, never trusted.
    const canonId = deriveGeometryId(slotId, role, shape, box.x, box.y, box.w, box.h);
    const gidf = safeOwnValue(slot, 'geometryId');
    if (gidf.blocked) return { blocked: true };
    if (gidf.ok && gidf.value !== canonId) return { reason: REASON.TEMPLATE_GEOMETRY_INVALID }; // stale/tampered claim

    const rec = { slotId, role, shape, x: box.x, y: box.y, w: box.w, h: box.h, geometryId: canonId };
    slotsByRole[role].push(rec);
    orderedSlots.push(rec);
  }

  const demand = {};
  for (const role of POOL_ROLES) demand[role] = slotsByRole[role].length;
  if (!POOL_ROLES.some((role) => demand[role] >= 1)) {
    return { reason: REASON.TEMPLATE_GEOMETRY_INVALID }; // a realized template demands >= 1 slot
  }
  return { slotsByRole, orderedSlots, totalSlots: orderedSlots.length, demand };
}

// ---------- opaque tokenizer (privacy) ----------
// Maps each distinct RAW identity/pHash to a deterministic opaque ordinal by
// first-appearance order. Equality relationships are preserved; the raw value never
// escapes. Prefix keeps the two token spaces disjoint.
function makeTokenizer(prefix) {
  const map = new Map();
  let next = 0;
  return (raw) => {
    if (!validToken(raw)) return undefined; // absent / invalid → omit (E flags coverage)
    const key = (typeof raw === 'number') ? `n:${raw}` : `s:${raw}`;
    let tok = map.get(key);
    if (tok === undefined) { tok = `${prefix}:${next++}`; map.set(key, tok); }
    return tok;
  };
}

// ---------- per-cell independent readiness verdict ----------
// facts = { dimsTrusted, fullW, fullH, shortSide, box:{x1,y1,x2,y2,w,h}|null }
// eligible = { known:bool, value:bool } for THIS slot.
// UNEVALUATED dominates: any missing/untrusted fact ⇒ UNEVALUATED (never fabricate).
function evaluateCell(role, slot, facts, eligible) {
  if (!eligible.known) return CELL_VERDICT.UNEVALUATED;   // identity eligibility not measured
  if (!facts.dimsTrusted) return CELL_VERDICT.UNEVALUATED; // full dims untrusted (thumb/null/missing)
  if (!facts.box) return CELL_VERDICT.UNEVALUATED;         // no subject/face box, or a box with a
                                                           // missing/invalid position — position is
                                                           // NEVER guessed (no best-case centering)

  // (P1-2) A CIRCLE slot must be SQUARE (w===h) to compute its circular mask. A
  // NON-SQUARE circle is a mask we cannot honestly evaluate → UNEVALUATED (fail-closed
  // toward "not measured"; never a fabricated verdict).
  if (slot.shape === 'circle' && slot.w !== slot.h) return CELL_VERDICT.UNEVALUATED;

  // All required facts present → decide SAFE / UNSAFE.
  if (eligible.value === false) return CELL_VERDICT.UNSAFE; // wrong identity for this slot

  // Whole-image cover-fit upscale (grounded: megaComposerService.js _slotUpEst,
  // lines 1246-1251: ia>=sa ? sl.h/ih : sl.w/iw === max(sl.w/iw, sl.h/ih)).
  const up = Math.max(slot.w / facts.fullW, slot.h / facts.fullH);
  const stretchMax = (role === 'hero') ? HERO_STRETCH_MAX : OTHER_STRETCH_MAX;
  if (up > stretchMax + EPS) return CELL_VERDICT.UNSAFE;   // upscale beyond threshold (low-res)

  // Hero absolute short-side floor (grounded: HERO_MIN_SHORT_SIDE).
  if (role === 'hero' && facts.shortSide < HERO_MIN_SHORT_SIDE) return CELL_VERDICT.UNSAFE;

  // POSITIONAL CROP HONESTY (P1) — the REAL implied crop window, never a best-case slide.
  // Cover-fit scale = max(slot.w/fullW, slot.h/fullH) (the _slotUpEst scale above); the
  // region of the source that survives is the slot-aspect window, CENTERED in the source —
  // the whole-image render path is sharp `fit:'cover', position:'centre'`
  // (coverComposer.js:622/838, imageComposer.js:142/150/182). In source-normalized units
  // the window is cropW × cropH at offset ((1-cropW)/2, (1-cropH)/2); one axis is fully
  // visible (=1), the other is cropped to the aspect ratio.
  const slotAspect = slot.w / slot.h;
  const srcAspect = facts.fullW / facts.fullH;
  let cropW;
  let cropH;
  if (slotAspect >= srcAspect) { cropW = 1; cropH = srcAspect / slotAspect; }
  else { cropH = 1; cropW = slotAspect / srcAspect; }
  const cropX0 = (1 - cropW) / 2;
  const cropY0 = (1 - cropH) / 2;

  // MAP the subject box from source-normalized coords into CROP-normalized coords at its
  // ACTUAL position. The window does NOT slide toward the subject.
  const mx1 = (facts.box.x1 - cropX0) / cropW;
  const my1 = (facts.box.y1 - cropY0) / cropH;
  const mx2 = (facts.box.x2 - cropX0) / cropW;
  const my2 = (facts.box.y2 - cropY0) / cropH;

  if (slot.shape === 'circle') {
    // (P1-2/P1) CIRCLE MASK containment at the subject's ACTUAL mapped position. The
    // square slot renders only the INSCRIBED circle (center (0.5,0.5), radius 0.5).
    // CONSERVATIVE test: ALL 4 transformed corners of the mapped box must lie inside the
    // circle — for an axis-aligned box against a convex mask, 4 corners inside bound the
    // whole box. Any corner outside — including a box partially/fully outside the crop
    // window (every point outside [0,1]² is at distance > 0.5 from the center, hence
    // outside the inscribed circle) — ⇒ UNSAFE. A centered small subject passes; an
    // off-center / corner-hugging subject fails regardless of its extents.
    // Independent estimate (RENDERER_PARITY=false) — never claims renderer parity.
    const R2 = 0.25; // radius² of the inscribed circle
    const corners = [[mx1, my1], [mx2, my1], [mx1, my2], [mx2, my2]];
    for (const [cx, cy] of corners) {
      const dx = cx - 0.5;
      const dy = cy - 0.5;
      if (dx * dx + dy * dy > R2 + EPS) return CELL_VERDICT.UNSAFE;
    }
  } else {
    // RECT containment at the subject's ACTUAL mapped position: the mapped box must lie
    // FULLY inside the crop window [0,1]². A box partially outside the window is NOT
    // contained (the renderer would cut it) — extents alone never imply containment.
    if (mx1 < -EPS || my1 < -EPS || mx2 > 1 + EPS || my2 > 1 + EPS) return CELL_VERDICT.UNSAFE;
  }

  return CELL_VERDICT.SAFE;
}

// (P1-4) Read the TRUSTED pre-clustered near-duplicate bucket. The near-dup class is
// accepted ONLY from a `pHashCluster` descriptor carrying EXACT provenance + version:
//   pHashCluster: { bucketId:<token>, provenance:'precluster_v1', version:1 }
// A raw pHash64, a missing cluster, or a mis-provenanced / mis-versioned / malformed
// cluster ⇒ NO near-dup token (uniqueness stays UNMEASURED for that candidate) — the
// module NEVER invents a distance threshold from a raw hash.
//   { blocked:true } | { token:string|undefined }
function readPHashClusterToken(cand, phTok) {
  const f = safeOwnValue(cand, 'pHashCluster');
  if (f.blocked) return { blocked: true };
  if (!f.ok || !isSafePlainObject(f.value)) return { token: undefined }; // absent / invalid → UNMEASURED
  const cluster = f.value;

  const prov = safeOwnValue(cluster, 'provenance');
  if (prov.blocked) return { blocked: true };
  const ver = safeOwnValue(cluster, 'version');
  if (ver.blocked) return { blocked: true };
  const bid = safeOwnValue(cluster, 'bucketId');
  if (bid.blocked) return { blocked: true };

  if (!prov.ok || prov.value !== PRECLUSTER.PROVENANCE) return { token: undefined };
  if (!ver.ok || ver.value !== PRECLUSTER.VERSION) return { token: undefined };
  if (!bid.ok || !validToken(bid.value)) return { token: undefined };
  return { token: phTok(bid.value) };
}

// Read a candidate's shared geometry facts + distinctness tokens + highRes.
//   { blocked:true } | { facts, elig, highRes, identityTok, pHashTok }
// `elig` is the candidate's per-slot eligibility container (safe object or null).
function readCandidate(cand, idTok, phTok) {
  if (!isSafePlainObject(cand)) return { blocked: true };

  // Trusted integer full dimensions + measuredFrom provenance.
  const mf = safeOwnValue(cand, 'measuredFrom');
  if (mf.blocked) return { blocked: true };
  const wR = readPosInt(cand, 'fullWidth');
  if (wR.blocked) return { blocked: true };
  const hR = readPosInt(cand, 'fullHeight');
  if (hR.blocked) return { blocked: true };
  const dimsTrusted = (mf.ok && mf.value === 'full') && wR.ok && hR.ok;
  const fullW = wR.ok ? wR.n : 0;
  const fullH = hR.ok ? hR.n : 0;
  const shortSide = dimsTrusted ? Math.min(fullW, fullH) : 0;

  // Validated normalized subject/face box. (P1-3) subject is PREFERRED; faceBox is a
  // fallback ONLY when subjectBox is ABSENT. A PRESENT-but-invalid subjectBox does NOT
  // fall back (it yields no box → the cell is UNEVALUATED, never a structural reject).
  // (P1) The FULL position is retained — extents alone can never drive a crop verdict.
  const subj = readNormBox(cand, 'subjectBox');
  if (subj.blocked) return { blocked: true };
  let box = null;
  if (subj.ok) {
    box = { x1: subj.x1, y1: subj.y1, x2: subj.x2, y2: subj.y2, w: subj.w, h: subj.h };
  } else if (subj.absent) {
    const face = readNormBox(cand, 'faceBox');
    if (face.blocked) return { blocked: true };
    if (face.ok) box = { x1: face.x1, y1: face.y1, x2: face.x2, y2: face.y2, w: face.w, h: face.h };
    // faceBox absent / present-but-invalid → box stays null → UNEVALUATED
  }
  // subjectBox present-but-invalid (!ok && !absent) → box stays null, NO faceBox fallback.

  // Per-slot identity eligibility container. (P1-3) A present-but-invalid eligibility
  // (null / array / non-object) is treated as UNKNOWN (elig=null → UNEVALUATED), NOT a
  // structural reject. Only a real accessor / trap is structural.
  const ef = safeOwnValue(cand, 'eligibility');
  if (ef.blocked) return { blocked: true };
  const elig = (ef.ok && isSafePlainObject(ef.value)) ? ef.value : null;

  // highRes resolution gate (passed through as a supplied trusted boolean).
  const hr = readBool(cand, 'highRes');
  if (hr.blocked) return { blocked: true };

  // Distinctness tokens (tokenized to opaque ordinals; raw never echoed). identity is a
  // person-cluster token; the near-dup token comes ONLY from a trusted pre-cluster
  // (P1-4) — the raw `pHash` field is NEVER read for near-dup purposes.
  const idf = safeOwnValue(cand, 'identity');
  if (idf.blocked) return { blocked: true };
  const phc = readPHashClusterToken(cand, phTok);
  if (phc.blocked) return { blocked: true };

  return {
    facts: { dimsTrusted, fullW, fullH, shortSide, box },
    elig,
    highRes: hr.ok ? hr.v : undefined,
    identityTok: idf.ok ? idTok(idf.value) : undefined,
    pHashTok: phc.token,
  };
}

// Read a candidate's eligibility verdict for a specific slot.
function readEligibility(elig, slotId) {
  if (elig === null) return { known: false };
  const f = safeOwnValue(elig, slotId);
  if (f.blocked) return { blocked: true };
  if (!f.ok || typeof f.value !== 'boolean') return { known: false };
  return { known: true, value: f.value };
}

// ---------- summary scaffolding (durable-safe: counts only) ----------
function emptyPerRole() {
  const pr = {};
  for (const role of POOL_ROLES) {
    pr[role] = { demand: 0, candidates: 0, safe: 0, unsafe: 0, unevaluated: 0 };
  }
  return pr;
}

function rejected(reason) {
  return deepFreeze({
    version: VERSION,
    producer: PRODUCER,
    ephemeral: true,
    rendererParity: RENDERER_PARITY,
    ok: false,
    reason,
    // (P0-1) A rejected request is NOT measurement-ready: feed is null, so the E-pass
    // consumer buildSearchQualityDescriptor is NEVER called on it.
    measurementReady: false,
    universeComplete: false,
    summary: {
      slots: 0,
      candidates: 0,
      cropCells: 0,
      cells: { safe: 0, unsafe: 0, unevaluated: 0 },
      perRole: emptyPerRole(),
    },
    feed: null,
  });
}

// ---------- (P0-1 / P1-1 / P1-5) candidate-universe PROOF ----------
// The proof must satisfy an EXACT schema before ANY telemetry is emitted:
//   { scope:'full_vetted_v1', complete:true, truncated:false,
//     expectedCount:N, observedCount:N }   with expectedCount === observedCount.
// `truncated` must be the LITERAL boolean false (P1-1) — a falsy-but-non-false value
// (0 / '' / null / undefined / absent) FAILS. The count binding to the OBSERVED pool
// (observedCount === Σ demanded-role candidate lengths) is verified by the caller AFTER
// the hard bounds pass. Missing / wrong-typed / mis-scoped / truncated / count-mismatch
// ⇒ the request is rejected UNIVERSE_NOT_PROVEN (feed null, measurementReady false) —
// no UNPROVEN or TRUNCATED universe ever reaches E. A PROVEN-COMPLETE EMPTY pool
// (expectedCount === observedCount === 0) is NOT a rejection: it MAY produce a feed,
// but its demanded-yet-empty roles are OMITTED from that feed, so E reports incomplete
// (ROLE_TELEMETRY_MISSING) — never a vacuous COMPLETE.
//   { blocked:true } | { invalid:true } | { expectedCount, observedCount }
function readUniverseProof(request) {
  const uf = safeOwnValue(request, 'universe');
  if (uf.blocked) return { blocked: true };
  if (!uf.ok || !isSafePlainObject(uf.value)) return { invalid: true }; // absent / non-object
  const u = uf.value;

  const scopeF = safeOwnValue(u, 'scope');
  if (scopeF.blocked) return { blocked: true };
  const completeF = safeOwnValue(u, 'complete');
  if (completeF.blocked) return { blocked: true };
  const truncF = safeOwnValue(u, 'truncated');
  if (truncF.blocked) return { blocked: true };
  const expF = safeOwnValue(u, 'expectedCount');
  if (expF.blocked) return { blocked: true };
  const obsF = safeOwnValue(u, 'observedCount');
  if (obsF.blocked) return { blocked: true };

  if (!scopeF.ok || scopeF.value !== UNIVERSE_SCOPE) return { invalid: true };
  if (!completeF.ok || completeF.value !== true) return { invalid: true };   // literal true
  if (!truncF.ok || truncF.value !== false) return { invalid: true };        // (P1-1) LITERAL false
  const exp = expF.ok ? expF.value : null;
  const obs = obsF.ok ? obsF.value : null;
  if (typeof exp !== 'number' || !Number.isInteger(exp) || exp < 0 || exp > MAX_COUNT) return { invalid: true };
  if (typeof obs !== 'number' || !Number.isInteger(obs) || obs < 0 || obs > MAX_COUNT) return { invalid: true };
  if (exp !== obs) return { invalid: true };
  return { expectedCount: exp, observedCount: obs };
}

// ---------- main producer ----------
// Build the EPHEMERAL, PRIVATE per-candidate×slot crop-readiness telemetry. Never
// throws (top-level backstop → STRUCTURAL). Returns a DETACHED, DEEP-FROZEN result.
export function buildCandidateCropReadiness(request) {
  try {
    if (!isSafePlainObject(request)) return rejected(REASON.STRUCTURAL);

    // ---- authoritative 1080×1350 slots (real geometry + derived identity) ----
    const tpl = readTemplate(request);
    if (tpl.blocked) return rejected(REASON.STRUCTURAL);
    if (tpl.reason) return rejected(tpl.reason);

    // ---- roles container ----
    const rolesF = safeOwnValue(request, 'roles');
    if (rolesF.blocked) return rejected(REASON.STRUCTURAL);
    let rolesContainer = null;
    if (rolesF.ok) {
      if (!isSafePlainObject(rolesF.value)) return rejected(REASON.STRUCTURAL);
      rolesContainer = rolesF.value;
    }

    const demandedRoles = POOL_ROLES.filter((role) => tpl.demand[role] >= 1);

    // ---- HARD BOUND (global match-edge upper bound), checked BEFORE per-candidate loops.
    // Read only array lengths (cheap; no per-element allocation) to bound total work.
    let totalCandidates = 0;
    const roleLens = {};
    for (const role of demandedRoles) {
      if (rolesContainer === null) { roleLens[role] = { absent: true }; continue; }
      const rf = safeOwnValue(rolesContainer, role);
      if (rf.blocked) return rejected(REASON.STRUCTURAL);
      if (!rf.ok) { roleLens[role] = { absent: true }; continue; }
      if (!isSafePlainObject(rf.value)) return rejected(REASON.STRUCTURAL);
      const cand = readOwnArray(rf.value, 'candidates');
      if (cand.blocked) return rejected(REASON.STRUCTURAL);
      if (cand.absent || cand.invalid) { roleLens[role] = { absent: true }; continue; }
      if (cand.len > MAX_CANDIDATES_PER_ROLE) return rejected(REASON.BOUNDS_EXCEEDED);
      if (cand.len * tpl.demand[role] > MAX_CROP_CELLS) return rejected(REASON.BOUNDS_EXCEEDED);
      roleLens[role] = { container: rf.value, arr: cand.arr, len: cand.len };
      totalCandidates += cand.len;
    }
    if (totalCandidates * tpl.totalSlots > MAX_MATCH_EDGES) return rejected(REASON.BOUNDS_EXCEEDED);

    // ---- (P0-1 / P1-1 / P1-5) UNIVERSE PROOF — bind scope + counts to the OBSERVED pool.
    // Checked AFTER the hard bounds (an over-bound request is refused regardless of proof)
    // and BEFORE any cell is evaluated. `observedCount` MUST equal the TOTAL observed
    // candidates across the demanded roles (Σ demanded-role candidate lengths). Any failure
    // ⇒ feed null + measurementReady false, so E is NEVER called on an unproven universe.
    const proof = readUniverseProof(request);
    if (proof.blocked) return rejected(REASON.STRUCTURAL);
    if (proof.invalid) return rejected(REASON.UNIVERSE_NOT_PROVEN);
    if (proof.observedCount !== totalCandidates) return rejected(REASON.UNIVERSE_NOT_PROVEN);

    // ---- tokenizers (shared ACROSS roles so cross-role duplicate identity is detectable) ----
    const idTok = makeTokenizer('id');
    const phTok = makeTokenizer('ph');

    // ---- per-role candidate evaluation ----
    const summary = {
      slots: tpl.totalSlots,
      candidates: 0,
      cropCells: 0,
      cells: { safe: 0, unsafe: 0, unevaluated: 0 },
      perRole: emptyPerRole(),
    };
    const feedRoles = {};

    for (const role of demandedRoles) {
      summary.perRole[role].demand = tpl.demand[role];
      const info = roleLens[role];
      if (info.absent || info.len === 0) {
        // (P0-1) No candidate pool — or an EMPTY one — for a demanded role → OMIT it from
        // the feed so E reads ROLE_TELEMETRY_MISSING. An empty demanded pool must NEVER be
        // emitted as an empty candidate list (which E would read as a vacuously COMPLETE
        // role). There is no path where an empty demanded pool lets E report COMPLETE.
        continue;
      }
      const demandSlots = tpl.slotsByRole[role];
      const outCands = [];

      for (let i = 0; i < info.len; i++) {
        const cf = safeOwnValue(info.arr, String(i));
        if (cf.blocked) return rejected(REASON.STRUCTURAL);
        if (!cf.ok) return rejected(REASON.STRUCTURAL); // hole
        const rc = readCandidate(cf.value, idTok, phTok);
        if (rc.blocked) return rejected(REASON.STRUCTURAL);

        summary.candidates += 1;
        summary.perRole[role].candidates += 1;

        const slotCrops = [];
        for (const slot of demandSlots) {
          summary.cropCells += 1;
          // The universe is PROVEN complete (checked above), so every cell is a real
          // per-candidate×slot readiness verdict. eligibility/box gaps fail closed to
          // UNEVALUATED inside evaluateCell — never a fabricated SAFE.
          const elig = readEligibility(rc.elig, slot.slotId);
          if (elig.blocked) return rejected(REASON.STRUCTURAL);
          const verdict = evaluateCell(role, slot, rc.facts, elig);

          if (verdict === CELL_VERDICT.SAFE) {
            summary.cells.safe += 1; summary.perRole[role].safe += 1;
            slotCrops.push({ slotId: slot.slotId, geometryId: slot.geometryId, cropSafe: true });
          } else if (verdict === CELL_VERDICT.UNSAFE) {
            summary.cells.unsafe += 1; summary.perRole[role].unsafe += 1;
            slotCrops.push({ slotId: slot.slotId, geometryId: slot.geometryId, cropSafe: false });
          } else {
            summary.cells.unevaluated += 1; summary.perRole[role].unevaluated += 1;
            // UNEVALUATED → row WITHOUT a boolean cropSafe → E.readSlotCrops → incomplete.
            slotCrops.push({ slotId: slot.slotId, geometryId: slot.geometryId });
          }
        }

        // Assemble the E-candidate. highRes / identity / pHash omitted when absent so
        // E fails closed (cropComplete / coverage) rather than assuming a value.
        const outCand = { slotCrops };
        if (rc.highRes !== undefined) outCand.highRes = rc.highRes;
        if (rc.identityTok !== undefined) outCand.identity = rc.identityTok;
        if (rc.pHashTok !== undefined) outCand.pHash = rc.pHashTok;
        outCands.push(outCand);
      }

      feedRoles[role] = { candidates: outCands };
    }

    // ---- ephemeral feed (plugs into buildSearchQualityDescriptor's input) ----
    const feedSlots = tpl.orderedSlots.map((s) => ({
      slotId: s.slotId, role: s.role, shape: s.shape,
      x: s.x, y: s.y, w: s.w, h: s.h, geometryId: s.geometryId,
    }));
    const feed = {
      templateAuthority: { matched: true, slots: feedSlots },
      roles: feedRoles,
    };

    return deepFreeze({
      version: VERSION,
      producer: PRODUCER,
      ephemeral: true,       // consume immediately then discard — do NOT persist the feed
      rendererParity: RENDERER_PARITY,
      ok: true,
      reason: null,
      // (P0-1) The universe is PROVEN complete + count-bound, so the feed is safe to hand
      // to E. measurementReady mirrors that: true ONLY when feed is non-null.
      measurementReady: true,
      universeComplete: true,
      summary,               // durable-safe: counts only (no tokens / no matrix)
      feed,                  // EPHEMERAL / PRIVATE: opaque tokens only
    });
  } catch {
    // Absolute backstop: no untrusted-input path may throw out of the producer.
    return rejected(REASON.STRUCTURAL);
  }
}

export default Object.freeze({
  version,
  PRODUCER,
  RENDERER_PARITY,
  POOL_ROLES,
  LIMITS,
  CELL_VERDICT,
  REASON,
  UNIVERSE_SCOPE,
  PRECLUSTER,
  deriveGeometryId,
  buildCandidateCropReadiness,
});
