// ============================================================
// search-quality-measurement.test.mjs
// Tests for the PURE producer searchQualityMeasurement.js and its round-trip
// through the seeded consumer searchQualityMetrics.js. Deterministic, offline,
// node:test + node:assert/strict, bare `node`.
//
// The producer measures GEOMETRY-SCOPED crop telemetry against a NORMALIZED
// realized-template snapshot carrying REAL production shapes (hero/support = rect,
// circle = circle), integer x/y/w/h inside the exact 1080×1350 canvas, and an
// INTERNALLY-DERIVED geometry identity (deriveGeometryId). Each candidate carries a
// per-slot crop verdict bound ONE-TO-ONE to those slots. The builders below
// synthesize that grounded shape.
//
// CLEAN-SCOPE / PRECONDITION: this producer STACKS ON TOP OF the consumer
// (STACKED_AFTER_SEARCH_QUALITY_METRICS). When the consumer is present (dev/final)
// the FULL suite runs with 0 skips. In a CLEAN worktree the consumer file is absent
// — it is loaded via a guarded dynamic import, and ONLY the round-trip cases OPENLY
// skip (node:test skip with a clear reason); the pure-producer cases still run.
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSearchQualityDescriptor,
  deriveGeometryId,
  INCOMPLETE_REASON,
  MEASUREMENT_STATUS,
  POOL_ROLES,
  LIMITS,
  STACKED_AFTER_SEARCH_QUALITY_METRICS,
  version as measurementVersion,
} from '../src/lib/searchQualityMeasurement.js';

// ---------- guarded consumer load (round-trip dependency) ----------
// A STATIC import would fail the whole file when the consumer is absent. Instead we
// dynamically import it once; if absent, only round-trip cases skip (never silently).
let consumerMod = null;
let consumerErr = null;
try {
  consumerMod = await import('../src/lib/searchQualityMetrics.js');
} catch (e) {
  consumerErr = e;
}
const CONSUMER_PRESENT = consumerMod !== null;
const skipRT = CONSUMER_PRESENT
  ? false
  : `round-trip skipped: searchQualityMetrics consumer absent in this worktree (${(consumerErr && consumerErr.code) || 'ERR_MODULE_NOT_FOUND'})`;

// ---------- geometry builders (grounded, REAL shapes) ----------

const CANVAS_W = 1080;
const CANVAS_H = 1350;
// REAL production shape enum: hero/support are rectangles, circle is a circle.
const SHAPE_FOR_ROLE = { hero: 'rect', circle: 'circle', support: 'rect' };

function slotIdFor(role, idx) { return `${role}#${idx}`; }

// A valid integer box fully inside the exact 1080×1350 canvas, per role/index.
function boxFor(role, idx) {
  if (role === 'hero') return { x: 0, y: 0, w: 1080, h: 700 };
  if (role === 'circle') return { x: 100, y: 720, w: 200, h: 200 };
  const col = idx % 3;
  const row = Math.floor(idx / 3);
  return { x: col * 300, y: 950 + row * 90, w: 280, h: 80 };
}

// Build the normalized realized-template snapshot + a per-role (slotId,geometryId)
// index the candidate builder uses to bind verdicts. geometryId is the identity the
// producer DERIVES internally — we mirror it via the exported deriveGeometryId so a
// correct crop row binds to the real geometry and a STALE one can be constructed.
function buildTemplateSlots(spec) {
  const slots = [];
  const byRole = { hero: [], circle: [], support: [] };
  for (const role of POOL_ROLES) {
    const n = spec[role] || 0;
    for (let i = 0; i < n; i++) {
      const slotId = slotIdFor(role, i);
      const shape = SHAPE_FOR_ROLE[role];
      const b = boxFor(role, i);
      const geometryId = deriveGeometryId(slotId, role, shape, b.x, b.y, b.w, b.h);
      slots.push({ slotId, role, shape, x: b.x, y: b.y, w: b.w, h: b.h, geometryId });
      byRole[role].push({ slotId, geometryId });
    }
  }
  return { slots, byRole };
}

// Resolve a candidate spec's per-slot crop-safety.
//   spec.safeSlots : array of slot indices that are crop-safe (others false)
//   spec.cropSafe  : boolean applied to every slot (legacy)
//   default        : crop-safe for every demanded slot
function cropSafeForIdx(spec, idx) {
  if (Array.isArray(spec.safeSlots)) return spec.safeSlots.includes(idx);
  if (typeof spec.cropSafe === 'boolean') return spec.cropSafe;
  return true;
}

// Turn a candidate SPEC into a grounded candidate object with geometry-scoped
// slotCrops covering exactly its role's demanded slots.
//   spec.highRes === 'omit'  -> omit the highRes field entirely
//   spec.rawCrops === null   -> omit slotCrops entirely (missing crop telemetry)
//   spec.rawCrops (array/obj)-> use verbatim (malformed / hostile overrides)
function buildCand(role, byRole, spec = {}) {
  const demandSlots = byRole[role] || [];
  const o = {};
  if (spec.highRes !== 'omit') o.highRes = (spec.highRes === undefined ? true : spec.highRes);
  if (spec.identity !== undefined) o.identity = spec.identity;
  if (spec.pHash !== undefined) o.pHash = spec.pHash;
  if ('rawCrops' in spec) {
    if (spec.rawCrops !== null) o.slotCrops = spec.rawCrops;
  } else {
    o.slotCrops = demandSlots.map((s, idx) => ({
      slotId: s.slotId,
      geometryId: s.geometryId,
      cropSafe: cropSafeForIdx(spec, idx),
    }));
  }
  return o;
}

// small inline helper mirroring buildCand for hand-assembled telemetry.
function buildCandInline(role, byRole, spec) {
  const demandSlots = byRole[role] || [];
  const o = { highRes: true };
  if (spec.identity !== undefined) o.identity = spec.identity;
  if (spec.pHash !== undefined) o.pHash = spec.pHash;
  o.slotCrops = demandSlots.map((s) => ({ slotId: s.slotId, geometryId: s.geometryId, cropSafe: true }));
  return o;
}

// A "good" candidate SPEC: high-res, crop-safe for all its role's slots, fully
// tokenized (identity + pHash).
function good(id, ph) { return { identity: id, pHash: ph }; }

// Assemble full telemetry from a slot spec + per-role candidate SPEC lists.
function telemetry({ matched = true, slotSpec = { hero: 1, circle: 1, support: 0 }, roles = {} } = {}) {
  const t = { templateAuthority: { matched } };
  let byRole = { hero: [], circle: [], support: [] };
  if (matched) {
    const built = buildTemplateSlots(slotSpec);
    t.templateAuthority.slots = built.slots;
    byRole = built.byRole;
  }
  const rolesOut = {};
  for (const role of Object.keys(roles)) {
    rolesOut[role] = { candidates: roles[role].map((spec) => buildCand(role, byRole, spec)) };
  }
  t.roles = rolesOut;
  return t;
}

// Recursively collect every string VALUE in an output object.
function stringValues(obj, acc = []) {
  if (typeof obj === 'string') { acc.push(obj); return acc; }
  if (obj === null || typeof obj !== 'object') return acc;
  for (const k of Object.keys(obj)) stringValues(obj[k], acc);
  return acc;
}

function assertDeeplyFrozen(obj, path = 'root') {
  if (obj === null || typeof obj !== 'object') return;
  assert.ok(Object.isFrozen(obj), `${path} must be frozen`);
  for (const k of Object.keys(obj)) assertDeeplyFrozen(obj[k], `${path}.${k}`);
}

// ============================================================
// SECTION A — PURE PRODUCER (no consumer; always runs)
// ============================================================

test('precondition marker + stable version', () => {
  assert.equal(STACKED_AFTER_SEARCH_QUALITY_METRICS, true);
  assert.equal(measurementVersion, 1);
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: false } });
  assert.equal(d.version, 1);
});

// ---- (1) REAL PRODUCTION SHAPES ----

test('(P1-shapes) REAL authority fixture: hero=rect, circle=circle, support=rect is accepted', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 1, support: 2 });
  assert.equal(built.slots.find((s) => s.role === 'hero').shape, 'rect');
  assert.equal(built.slots.find((s) => s.role === 'circle').shape, 'circle');
  assert.ok(built.slots.filter((s) => s.role === 'support').every((s) => s.shape === 'rect'));

  const t = telemetry({
    slotSpec: { hero: 1, circle: 1, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      circle: [good('c1', 'ph_c1')],
      support: [good('s1', 'ph_1'), good('s2', 'ph_2')],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.templateMatch, true);
  assert.equal(d.measurementComplete, true);
  assert.deepEqual(d.template.roles.hero, { requiredSlots: 1, requiredUnique: 1 });
  assert.deepEqual(d.template.roles.support, { requiredSlots: 2, requiredUnique: 2 });
});

test('(P1-shapes) hero wearing a circle shape -> geometry invalid (rect ↔ circle not interchangeable)', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 1, support: 0 });
  built.slots.find((s) => s.role === 'hero').shape = 'circle'; // hero must be rect
  const d1 = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: built.slots }, roles: {} });
  assert.deepEqual(d1.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);

  const built2 = buildTemplateSlots({ hero: 1, circle: 1, support: 0 });
  built2.slots.find((s) => s.role === 'circle').shape = 'rect'; // circle must be circle
  const d2 = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: built2.slots }, roles: {} });
  assert.deepEqual(d2.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);

  const built3 = buildTemplateSlots({ hero: 0, circle: 0, support: 1 });
  built3.slots[0].shape = 'circle'; // a support must be rect
  const d3 = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: built3.slots }, roles: {} });
  assert.deepEqual(d3.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);
});

// ---- template demand / per-role counters ----

test('requiredSlots/requiredUnique come from template geometry, per role', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 1, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      circle: [good('c1', 'ph_c1')],
      support: [good('s1', 'ph_s1'), good('s2', 'ph_s2')],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.deepEqual(d.template.roles.circle, { requiredSlots: 1, requiredUnique: 1 });
  assert.deepEqual(d.template.roles.support, { requiredSlots: 2, requiredUnique: 2 });
  assert.equal(d.measurementComplete, true);
});

test('per-role counters are computed from each role own list (never a shared pool.length)', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 1, support: 1 },
    roles: {
      hero: [good('h1', 'ph_h1'), good('h2', 'ph_h2'), good('h3', 'ph_h3')], // 3
      circle: [good('c1', 'ph_c1')],                                          // 1
      support: [good('s1', 'ph_s1')],                                         // 1
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.vettedRelevant, 3);
  assert.equal(d.roles.circle.vettedRelevant, 1);
  assert.equal(d.roles.support.vettedRelevant, 1);
  assert.equal(d.roles.hero.cropSafe, 3);
  assert.equal(d.roles.hero.cropSafeDistinct, 1); // capped at hero's single panel
});

// ---- distinctness ----

test('multi-support unique demand: 3 required, only 2 distinct crop-safe -> measured shortfall (COMPLETE)', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 3 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [good('sA', 'ph_A'), good('s_dup', 'ph_B'), good('s_dup', 'ph_C')],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.template.roles.support.requiredUnique, 3);
  assert.equal(d.roles.support.cropSafe, 3);
  assert.equal(d.roles.support.uniquenessEvaluated, true);
  assert.equal(d.roles.support.cropSafeDistinct, 2); // duplicate identity collapsed
  assert.equal(d.measurementComplete, true);         // real shortfall, fully measured
});

test('duplicate identities are not counted as distinct', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [good('same', 'ph_1'), good('same', 'ph_2')],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.cropSafe, 2);
  assert.equal(d.roles.support.cropSafeDistinct, 1);
});

test('near-duplicate perceptual bucket collapses distinct even across differing identity tokens', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [good('idA', 'DUP'), good('idB', 'DUP')],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.cropSafeDistinct, 1);
});

test('same-panel collision: 2 distinct images crop-safe ONLY for support slot 0 fill at most 1 panel', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [
        { identity: 'sX', pHash: 'ph_X', safeSlots: [0] },
        { identity: 'sY', pHash: 'ph_Y', safeSlots: [0] },
      ],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.cropSafe, 2);
  assert.equal(d.roles.support.uniquenessEvaluated, true);
  assert.equal(d.roles.support.cropSafeDistinct, 1);
  assert.equal(d.measurementComplete, true);
});

test('distinct images each crop-safe for a DIFFERENT panel do satisfy both panels', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [
        { identity: 'sX', pHash: 'ph_X', safeSlots: [0] },
        { identity: 'sY', pHash: 'ph_Y', safeSlots: [1] },
      ],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.cropSafeDistinct, 2);
});

// ---- (3) GLOBAL distinct → all-demanded-slots matching (no per-role double count) ----

test('(P1-global) one identity crop-safe for a hero AND a circle slot cannot fill BOTH -> incomplete', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 1, support: 0 });
  const heroCand = {
    highRes: true, identity: 'SAME', pHash: 'PH_SAME',
    slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId, cropSafe: true }],
  };
  const circCand = {
    highRes: true, identity: 'SAME', pHash: 'PH_SAME',
    slotCrops: [{ slotId: built.byRole.circle[0].slotId, geometryId: built.byRole.circle[0].geometryId, cropSafe: true }],
  };
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: { hero: { candidates: [heroCand] }, circle: { candidates: [circCand] } },
  };
  const d = buildSearchQualityDescriptor(t);
  // Each pile LOOKS locally fine (raw cropSafe 1 each) — the failure is GLOBAL.
  assert.equal(d.roles.hero.cropSafe, 1);
  assert.equal(d.measurementComplete, false);
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.GLOBAL_DISTINCT_INFEASIBLE));
  // No fabricated STOCK/CROP: it is driven via a consumer-failing role row.
  assert.ok(!d.incomplete.includes(INCOMPLETE_REASON.CROP_NOT_EVALUATED));
});

test('(P1-global) one identity crop-safe for a hero AND a support slot cannot fill BOTH -> incomplete', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 1 });
  const heroCand = {
    highRes: true, identity: 'SAME', pHash: 'PH_SAME',
    slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId, cropSafe: true }],
  };
  const supCand = {
    highRes: true, identity: 'SAME', pHash: 'PH_SAME',
    slotCrops: [{ slotId: built.byRole.support[0].slotId, geometryId: built.byRole.support[0].geometryId, cropSafe: true }],
  };
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: { hero: { candidates: [heroCand] }, support: { candidates: [supCand] } },
  };
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.measurementComplete, false);
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.GLOBAL_DISTINCT_INFEASIBLE));
});

test('(P1-global) DISTINCT identities across hero+circle DO fill both -> complete (no false reject)', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 1, support: 0 });
  const heroCand = {
    highRes: true, identity: 'HERO', pHash: 'PH_HERO',
    slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId, cropSafe: true }],
  };
  const circCand = {
    highRes: true, identity: 'CIRC', pHash: 'PH_CIRC',
    slotCrops: [{ slotId: built.byRole.circle[0].slotId, geometryId: built.byRole.circle[0].geometryId, cropSafe: true }],
  };
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: { hero: { candidates: [heroCand] }, circle: { candidates: [circCand] } },
  };
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.measurementComplete, true);
  assert.ok(!d.incomplete.includes(INCOMPLETE_REASON.GLOBAL_DISTINCT_INFEASIBLE));
  assert.equal(d.roles.hero.cropSafeDistinct, 1);
  assert.equal(d.roles.circle.cropSafeDistinct, 1);
});

// ---- uniqueness coverage ----

test('partial pHash coverage (demand>=2, raw looks enough) -> UNIQUENESS_NOT_EVALUATED', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [good('s1', 'ph_1'), good('s2', 'ph_2'), { identity: 's3' /* no pHash */ }],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.cropSafe, 3);
  assert.equal(d.roles.support.cropEvaluated, true);
  assert.equal(d.roles.support.uniquenessEvaluated, false);
  assert.ok(!('cropSafeDistinct' in d.roles.support));
  assert.equal(d.measurementComplete, false);
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.UNIQUENESS_NOT_EVALUATED));
});

test('missing identity coverage also blocks uniqueness (both tokens required)', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [good('s1', 'ph_1'), { pHash: 'ph_2' /* no identity */ }, good('s3', 'ph_3')],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.uniquenessEvaluated, false);
});

test('U=1 crop-safe candidate missing pHash -> cropEvaluated:false (UNIQUENESS_NOT_EVALUATED)', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 0 },
    roles: { hero: [{ identity: 'h1' /* no pHash */ }] },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.cropEvaluated, false);
  assert.ok(!('cropSafeDistinct' in d.roles.hero));
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.UNIQUENESS_NOT_EVALUATED));
});

test('U=1 crop-safe candidate missing identity -> cropEvaluated:false', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 0 },
    roles: { hero: [{ pHash: 'ph_h1' /* no identity */ }] },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.cropEvaluated, false);
});

test('U>=2 raw-cropSafe-below-demand + partial coverage -> cropEvaluated:false', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 3 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [good('s1', 'ph_1'), { identity: 's2' /* no pHash */ }],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.cropSafe, 2);
  assert.equal(d.roles.support.cropEvaluated, false);
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.UNIQUENESS_NOT_EVALUATED));
});

// ---- crop verdicts ----

test('a high-res candidate with no slotCrops -> cropEvaluated:false (CROP_NOT_EVALUATED)', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 1, support: 0 },
    roles: {
      hero: [{ highRes: true, identity: 'h', pHash: 'p', rawCrops: null }],
      circle: [good('c1', 'ph_c1')],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.cropEvaluated, false);
  assert.equal(d.measurementComplete, false);
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.CROP_NOT_EVALUATED));
});

test('crop verdict is NEVER inferred from resolution alone (highRes true but no verdict)', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 0 },
    roles: { hero: [{ highRes: true, identity: 'h', pHash: 'p', rawCrops: null }] },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.highRes, 0);
  assert.equal(d.roles.hero.cropEvaluated, false);
});

test('unknown resolution on a relevant candidate -> role measurement incomplete', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 0 },
    roles: { hero: [good('h1', 'ph_1'), { highRes: 'omit', identity: 'h2', pHash: 'ph_2' }] },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.cropEvaluated, false);
});

// ---- (1)/(2) geometry-binding: role-only rows, canvas, dup slotId, derived identity ----

test('role-only {role} template rows carry NO geometry -> geometry invalid', () => {
  const d = buildSearchQualityDescriptor({
    templateAuthority: { matched: true, slots: [{ role: 'hero' }, { role: 'circle' }] },
    roles: {},
  });
  assert.ok(!('templateMatch' in d));
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);
});

test('slot geometry outside the exact 1080x1350 canvas -> geometry invalid', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  built.slots[0].w = CANVAS_W + 1;
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: built.slots }, roles: {} });
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);
});

test('duplicate slotId across template slots -> geometry invalid', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 2 });
  built.slots[2].slotId = built.slots[1].slotId;
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: built.slots }, roles: {} });
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);
});

test('(P1-identity) a declared slot geometryId that ≠ the DERIVED identity -> geometry invalid (claim, not authority)', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  built.slots[0].geometryId = 'gid1|BOGUS-CLAIM'; // caller-supplied token is only VERIFIED
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: built.slots }, roles: {} });
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);
});

test('(P1-identity) crop verdict with a TAMPERED geometryId (≠ derived identity) -> role incomplete', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: {
      hero: {
        candidates: [{
          highRes: true, identity: 'h1', pHash: 'ph_1',
          slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: 'gid1|TAMPERED', cropSafe: true }],
        }],
      },
    },
  };
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.cropEvaluated, false);
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.CROP_NOT_EVALUATED));
});

test('(P1-identity) STALE crop token: slot coords changed after crop-eval -> role incomplete, never completes', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  const staleGeoId = built.byRole.hero[0].geometryId; // bound to the ORIGINAL geometry
  const slot = built.slots[0];
  delete slot.geometryId;   // keep the template itself valid (no stale declared claim)
  slot.y = slot.y + 10;     // the realized geometry MOVED -> recomputed identity differs
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: {
      hero: {
        candidates: [{
          highRes: true, identity: 'h1', pHash: 'ph_1',
          slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: staleGeoId, cropSafe: true }],
        }],
      },
    },
  };
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.cropEvaluated, false);
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.CROP_NOT_EVALUATED));
});

test('cross-slot verdict: support candidate referencing a foreign slotId -> role incomplete', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 2 });
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: {
      hero: { candidates: [buildCandInline('hero', built.byRole, good('h1', 'ph_h1'))] },
      support: {
        candidates: [{
          highRes: true, identity: 's1', pHash: 'ph_1',
          slotCrops: [
            { slotId: built.byRole.support[0].slotId, geometryId: built.byRole.support[0].geometryId, cropSafe: true },
            { slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId, cropSafe: true },
          ],
        }],
      },
    },
  };
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.cropEvaluated, false);
});

test('duplicate slot verdict (same demanded slot twice, missing the other) -> role incomplete', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 2 });
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: {
      hero: { candidates: [buildCandInline('hero', built.byRole, good('h1', 'ph_h1'))] },
      support: {
        candidates: [{
          highRes: true, identity: 's1', pHash: 'ph_1',
          slotCrops: [
            { slotId: built.byRole.support[0].slotId, geometryId: built.byRole.support[0].geometryId, cropSafe: true },
            { slotId: built.byRole.support[0].slotId, geometryId: built.byRole.support[0].geometryId, cropSafe: true },
          ],
        }],
      },
    },
  };
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.cropEvaluated, false);
});

test('measured LOW-RES candidate MISSING crop telemetry -> role incomplete (before highRes gate)', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 0 },
    roles: { hero: [good('h1', 'ph_1'), { highRes: false, rawCrops: null }] },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.cropEvaluated, false);
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.CROP_NOT_EVALUATED));
});

test('hostile accessor (getter) on a candidate crop verdict -> structural, getter never invoked', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  let touched = false;
  const row = { slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId };
  Object.defineProperty(row, 'cropSafe', { enumerable: true, get() { touched = true; return true; } });
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: { hero: { candidates: [{ highRes: true, identity: 'h1', pHash: 'ph_1', slotCrops: [row] }] } },
  };
  const d = buildSearchQualityDescriptor(t);
  assert.equal(touched, false, 'crop-verdict getter must never be triggered');
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.STRUCTURAL]);
});

// ---- missing telemetry / measured outcomes ----

test('template not measured -> TEMPLATE_NOT_MEASURED', () => {
  const d = buildSearchQualityDescriptor({ roles: {} });
  assert.equal(d.measurementComplete, false);
  assert.ok(!('templateMatch' in d));
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.TEMPLATE_NOT_MEASURED]);
});

test('matched:true but geometry missing -> TEMPLATE_GEOMETRY_INVALID', () => {
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: true }, roles: {} });
  assert.ok(!('templateMatch' in d));
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);
});

test('demanded role with no candidate pool -> omitted (ROLE_TELEMETRY_MISSING)', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 1, support: 0 },
    roles: { hero: [good('h1', 'ph_1')] },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.ok(!('circle' in d.roles));
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.ROLE_TELEMETRY_MISSING));
});

test('MEASURED no-template-match -> COMPLETE descriptor, templateMatch:false', () => {
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: false }, roles: {} });
  assert.equal(d.templateMatch, false);
  assert.equal(d.measurementComplete, true);
});

test('measured stock shortage (all low-res, crop telemetry present) -> highRes 0, cropEvaluated true', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 0 },
    roles: { hero: [{ highRes: false, identity: 'h1', pHash: 'ph_1' }, { highRes: false, identity: 'h2', pHash: 'ph_2' }] },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.vettedRelevant, 2);
  assert.equal(d.roles.hero.highRes, 0);
  assert.equal(d.roles.hero.cropSafe, 0);
  assert.equal(d.roles.hero.cropEvaluated, true);
  assert.equal(d.measurementComplete, true);
});

test('measured crop-unsafe (high-res exist, none survive crop) -> highRes 2, cropSafe 0', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 0 },
    roles: {
      hero: [{ highRes: true, identity: 'h1', pHash: 'ph_1', cropSafe: false },
        { highRes: true, identity: 'h2', pHash: 'ph_2', cropSafe: false }],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.hero.highRes, 2);
  assert.equal(d.roles.hero.cropSafe, 0);
  assert.equal(d.roles.hero.cropEvaluated, true);
});

// ---- hostile / exotic ----

test('non-object telemetry -> structural incomplete', () => {
  for (const bad of [null, undefined, 42, 'x', true, Symbol('s')]) {
    const d = buildSearchQualityDescriptor(bad);
    assert.equal(d.measurementComplete, false);
    assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.STRUCTURAL]);
  }
});

test('array telemetry (exotic top-level) -> structural incomplete', () => {
  const d = buildSearchQualityDescriptor([1, 2, 3]);
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.STRUCTURAL]);
});

test('accessor (getter) property on telemetry -> structural, getter never invoked', () => {
  let touched = false;
  const t = {};
  Object.defineProperty(t, 'templateAuthority', { enumerable: true, get() { touched = true; return { matched: true }; } });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(touched, false);
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.STRUCTURAL]);
});

test('revoked Proxy as telemetry -> structural incomplete (no throw)', () => {
  const { proxy, revoke } = Proxy.revocable({ templateAuthority: { matched: true, slots: [] } }, {});
  revoke();
  const d = buildSearchQualityDescriptor(proxy);
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.STRUCTURAL]);
});

test('throwing-trap Proxy nested as templateAuthority -> structural incomplete', () => {
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('trap'); } });
  const d = buildSearchQualityDescriptor({ templateAuthority: hostile });
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.STRUCTURAL]);
});

test('exotic-proto object as a candidate -> structural incomplete', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  const weird = Object.create({ evil: 1 });
  weird.highRes = true;
  weird.slotCrops = [{ slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId, cropSafe: true }];
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: built.slots }, roles: { hero: { candidates: [weird] } } });
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.STRUCTURAL]);
});

test('Array subclass for slots -> geometry invalid (not silently accepted)', () => {
  class Sneaky extends Array {}
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  const s = Sneaky.from(built.slots);
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: s }, roles: {} });
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);
});

test('unknown slot role token (not collapsed to a POOL_ROLE) -> geometry invalid', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 1 });
  built.slots[1].role = 'evidence';
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: built.slots }, roles: {} });
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);
});

// ---- (4) HARD BOUNDS ----

test('(P1-bounds) over-long candidate list is refused (role omitted, no huge number)', () => {
  const MAX_C = 100000; // readOwnArray hard length ceiling
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  const oneCand = buildCandInline('hero', built.byRole, good('x', 'y'));
  const huge = new Array(MAX_C + 1).fill(oneCand);
  const t = { templateAuthority: { matched: true, slots: built.slots }, roles: { hero: { candidates: huge } } };
  const d = buildSearchQualityDescriptor(t);
  assert.ok(!('hero' in d.roles));
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.ROLE_TELEMETRY_MISSING));
  assert.ok(!JSON.stringify(d).includes(String(MAX_C + 1)));
});

test('(P1-bounds) over-PRODUCT input (candidates × slots) is refused BEFORE allocation — role omitted', () => {
  const S = LIMITS.MAX_REALIZED_SLOTS; // 10 support slots
  const built = buildTemplateSlots({ hero: 0, circle: 0, support: S });
  // candidates below the per-role COUNT cap but candidates×slots over the crop-cell cap.
  const count = Math.floor(LIMITS.MAX_CROP_CELLS / S) + 50;
  assert.ok(count < LIMITS.MAX_CANDIDATES_PER_ROLE, 'must exercise the PRODUCT bound, not the count cap');
  assert.ok(count * S > LIMITS.MAX_CROP_CELLS, 'product must exceed the crop-cell cap');
  const cands = new Array(count).fill(0).map(() => buildCand('support', built.byRole, good('x', 'y')));
  const t = { templateAuthority: { matched: true, slots: built.slots }, roles: { support: { candidates: cands } } };
  const d = buildSearchQualityDescriptor(t);
  assert.ok(!('support' in d.roles), 'over-product role must not be measured');
  assert.ok(d.incomplete.includes(INCOMPLETE_REASON.ROLE_TELEMETRY_MISSING));
});

test('(P1-bounds) more than MAX_REALIZED_SLOTS demanded slots -> geometry invalid (before per-slot loop)', () => {
  const built = buildTemplateSlots({ hero: 1, circle: 1, support: 9 }); // 11 > 10
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: true, slots: built.slots }, roles: {} });
  assert.deepEqual(d.incomplete, [INCOMPLETE_REASON.TEMPLATE_GEOMETRY_INVALID]);
});

// ---- determinism / freezing / privacy ----

test('deterministic: identical telemetry -> byte-identical descriptor', () => {
  const build = () => telemetry({
    slotSpec: { hero: 1, circle: 1, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      circle: [good('c1', 'ph_c1')],
      support: [good('s1', 'ph_1'), good('s2', 'ph_2')],
    },
  });
  const a = buildSearchQualityDescriptor(build());
  const b = buildSearchQualityDescriptor(build());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('output is deeply frozen', () => {
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: { hero: [good('h1', 'ph_h1')], support: [good('s1', 'ph_1'), good('s2', 'ph_2')] },
  });
  const d = buildSearchQualityDescriptor(t);
  assertDeeplyFrozen(d);
  assert.throws(() => { d.roles.hero.cropSafe = 999; }, TypeError);
});

test('privacy: only enum tokens + numbers/booleans — no identity/pHash/slotId/geometryId leak', () => {
  const SECRET_ID = 'PERSON_SECRET_XYZ';
  const SECRET_PH = 'PHASH_SECRET_9f8e';
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: {
      hero: [good(SECRET_ID, SECRET_PH)],
      support: [good(SECRET_ID + '_a', SECRET_PH + '_a'), good(SECRET_ID + '_b', SECRET_PH + '_b')],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  const serialized = JSON.stringify(d);
  assert.ok(!serialized.includes(SECRET_ID), 'identity token must not leak');
  assert.ok(!serialized.includes(SECRET_PH), 'pHash token must not leak');
  assert.ok(!serialized.includes('gid1'), 'derived geometryId must not leak');
  assert.ok(!serialized.includes('#'), 'slotId token must not leak');

  const allowed = new Set([
    ...Object.values(MEASUREMENT_STATUS),
    ...Object.values(INCOMPLETE_REASON),
    'hero', 'circle', 'support',
  ]);
  for (const s of stringValues(d)) {
    assert.ok(allowed.has(s), `unexpected string value in output: ${JSON.stringify(s)}`);
  }
});

// ============================================================
// SECTION B — ROUND-TRIP through the seeded consumer.
// Skipped OPENLY (never silently) when the consumer is absent (clean worktree).
// ============================================================

test('RT: complete + sufficient multi-role pool reads READY', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const t = telemetry({
    slotSpec: { hero: 1, circle: 1, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      circle: [good('c1', 'ph_c1')],
      support: [good('s1', 'ph_s1'), good('s2', 'ph_s2')],
    },
  });
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.READY);
  assert.equal(a.ready, true);
  assert.equal(a.dominantCause, null);
});

test('RT: multi-support distinct shortfall -> CROP_UNSAFE (measured, not insufficient)', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, FAILURE_CAUSES } = consumerMod;
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 3 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [good('sA', 'ph_A'), good('s_dup', 'ph_B'), good('s_dup', 'ph_C')],
    },
  });
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.FAILURE);
  assert.equal(a.dominantCause, FAILURE_CAUSES.CROP_UNSAFE);
});

test('RT: same-panel collision -> CROP_UNSAFE', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, FAILURE_CAUSES } = consumerMod;
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [{ identity: 'sX', pHash: 'ph_X', safeSlots: [0] }, { identity: 'sY', pHash: 'ph_Y', safeSlots: [0] }],
    },
  });
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.FAILURE);
  assert.equal(a.dominantCause, FAILURE_CAUSES.CROP_UNSAFE);
});

test('RT: distinct images for different panels -> READY', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: {
      hero: [good('h1', 'ph_h1')],
      support: [{ identity: 'sX', pHash: 'ph_X', safeSlots: [0] }, { identity: 'sY', pHash: 'ph_Y', safeSlots: [1] }],
    },
  });
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(t)).status, READINESS_STATUS.READY);
});

test('RT (P1-global): hero+circle share one identity -> INSUFFICIENT (INCOMPLETE_MEASUREMENT), never READY', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, INSUFFICIENT_REASON } = consumerMod;
  const built = buildTemplateSlots({ hero: 1, circle: 1, support: 0 });
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: {
      hero: { candidates: [{ highRes: true, identity: 'SAME', pHash: 'PH_SAME', slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId, cropSafe: true }] }] },
      circle: { candidates: [{ highRes: true, identity: 'SAME', pHash: 'PH_SAME', slotCrops: [{ slotId: built.byRole.circle[0].slotId, geometryId: built.byRole.circle[0].geometryId, cropSafe: true }] }] },
    },
  };
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
  assert.equal(a.dominantCause, null); // never a fabricated STOCK/CROP/SELECTION cause
});

test('RT (P1-global): hero+support share one identity -> INSUFFICIENT', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 1 });
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: {
      hero: { candidates: [{ highRes: true, identity: 'SAME', pHash: 'PH_SAME', slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId, cropSafe: true }] }] },
      support: { candidates: [{ highRes: true, identity: 'SAME', pHash: 'PH_SAME', slotCrops: [{ slotId: built.byRole.support[0].slotId, geometryId: built.byRole.support[0].geometryId, cropSafe: true }] }] },
    },
  };
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(t)).status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('RT (P1-global): distinct identities across hero+circle -> READY (no false reject)', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const built = buildTemplateSlots({ hero: 1, circle: 1, support: 0 });
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: {
      hero: { candidates: [{ highRes: true, identity: 'HERO', pHash: 'PH_HERO', slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId, cropSafe: true }] }] },
      circle: { candidates: [{ highRes: true, identity: 'CIRC', pHash: 'PH_CIRC', slotCrops: [{ slotId: built.byRole.circle[0].slotId, geometryId: built.byRole.circle[0].geometryId, cropSafe: true }] }] },
    },
  };
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(t)).status, READINESS_STATUS.READY);
});

test('RT: partial pHash coverage -> INSUFFICIENT (UNIQUENESS_NOT_EVALUATED)', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, INSUFFICIENT_REASON } = consumerMod;
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 2 },
    roles: { hero: [good('h1', 'ph_h1')], support: [good('s1', 'ph_1'), good('s2', 'ph_2'), { identity: 's3' }] },
  });
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.UNIQUENESS_NOT_EVALUATED);
});

test('RT: U=1 crop-safe candidate missing pHash -> INSUFFICIENT (INCOMPLETE_MEASUREMENT)', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, INSUFFICIENT_REASON } = consumerMod;
  const t = telemetry({ slotSpec: { hero: 1, circle: 0, support: 0 }, roles: { hero: [{ identity: 'h1' }] } });
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
});

test('RT: U>=2 raw-below-demand partial coverage -> INSUFFICIENT, dominantCause never fabricated', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, INSUFFICIENT_REASON } = consumerMod;
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 3 },
    roles: { hero: [good('h1', 'ph_h1')], support: [good('s1', 'ph_1'), { identity: 's2' }] },
  });
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
  assert.equal(a.dominantCause, null);
});

test('RT: no slotCrops -> INSUFFICIENT (INCOMPLETE_MEASUREMENT), no fabricated cause', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, INSUFFICIENT_REASON } = consumerMod;
  const t = telemetry({
    slotSpec: { hero: 1, circle: 1, support: 0 },
    roles: { hero: [{ highRes: true, identity: 'h', pHash: 'p', rawCrops: null }], circle: [good('c1', 'ph_c1')] },
  });
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
  assert.equal(a.dominantCause, null);
});

test('RT: highRes true but no verdict -> classify INCOMPLETE_MEASUREMENT', { skip: skipRT }, () => {
  const { classifyPoolFailure, INSUFFICIENT_REASON } = consumerMod;
  const t = telemetry({ slotSpec: { hero: 1, circle: 0, support: 0 }, roles: { hero: [{ highRes: true, identity: 'h', pHash: 'p', rawCrops: null }] } });
  assert.equal(classifyPoolFailure(buildSearchQualityDescriptor(t)).reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
});

test('RT: unknown resolution -> evaluatePoolReadiness INSUFFICIENT', { skip: skipRT }, () => {
  const { evaluatePoolReadiness, READINESS_STATUS } = consumerMod;
  const t = telemetry({ slotSpec: { hero: 1, circle: 0, support: 0 }, roles: { hero: [good('h1', 'ph_1'), { highRes: 'omit', identity: 'h2', pHash: 'ph_2' }] } });
  assert.equal(evaluatePoolReadiness(buildSearchQualityDescriptor(t)).status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('RT (P1-identity): tampered geometryId -> INSUFFICIENT (INCOMPLETE_MEASUREMENT)', { skip: skipRT }, () => {
  const { assessSearchQuality, INSUFFICIENT_REASON } = consumerMod;
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: { hero: { candidates: [{ highRes: true, identity: 'h1', pHash: 'ph_1', slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: 'gid1|TAMPERED', cropSafe: true }] }] } },
  };
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(t)).reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
});

test('RT (P1-identity): STALE token -> INSUFFICIENT, never READY', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  const staleGeoId = built.byRole.hero[0].geometryId;
  delete built.slots[0].geometryId;
  built.slots[0].y += 10;
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: { hero: { candidates: [{ highRes: true, identity: 'h1', pHash: 'ph_1', slotCrops: [{ slotId: built.byRole.hero[0].slotId, geometryId: staleGeoId, cropSafe: true }] }] } },
  };
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(t)).status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('RT: cross-slot foreign slotId -> INSUFFICIENT', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 2 });
  const t = {
    templateAuthority: { matched: true, slots: built.slots },
    roles: {
      hero: { candidates: [buildCandInline('hero', built.byRole, good('h1', 'ph_h1'))] },
      support: { candidates: [{ highRes: true, identity: 's1', pHash: 'ph_1', slotCrops: [
        { slotId: built.byRole.support[0].slotId, geometryId: built.byRole.support[0].geometryId, cropSafe: true },
        { slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId, cropSafe: true },
      ] }] },
    },
  };
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(t)).status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('RT: low-res missing crop telemetry -> INSUFFICIENT (never STOCK_SHORTAGE)', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, INSUFFICIENT_REASON, FAILURE_CAUSES } = consumerMod;
  const t = telemetry({ slotSpec: { hero: 1, circle: 0, support: 0 }, roles: { hero: [good('h1', 'ph_1'), { highRes: false, rawCrops: null }] } });
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
  assert.notEqual(a.dominantCause, FAILURE_CAUSES.STOCK_SHORTAGE);
});

test('RT: hostile accessor crop verdict -> INSUFFICIENT', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  const row = { slotId: built.byRole.hero[0].slotId, geometryId: built.byRole.hero[0].geometryId };
  Object.defineProperty(row, 'cropSafe', { enumerable: true, get() { return true; } });
  const t = { templateAuthority: { matched: true, slots: built.slots }, roles: { hero: { candidates: [{ highRes: true, identity: 'h1', pHash: 'ph_1', slotCrops: [row] }] } } };
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(t)).status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('RT: template not measured -> MISSING_TEMPLATE_MATCH', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, INSUFFICIENT_REASON } = consumerMod;
  const a = assessSearchQuality(buildSearchQualityDescriptor({ roles: {} }));
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.MISSING_TEMPLATE_MATCH);
});

test('RT: matched geometry missing -> INSUFFICIENT', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor({ templateAuthority: { matched: true }, roles: {} })).status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('RT: demanded role with no pool -> MISSING_ROLE', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS, INSUFFICIENT_REASON } = consumerMod;
  const t = telemetry({ slotSpec: { hero: 1, circle: 1, support: 0 }, roles: { hero: [good('h1', 'ph_1')] } });
  const a = assessSearchQuality(buildSearchQualityDescriptor(t));
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.MISSING_ROLE);
});

test('RT: MEASURED no-template-match -> TEMPLATE_ABSENT (real failure)', { skip: skipRT }, () => {
  const { classifyPoolFailure, assessSearchQuality, READINESS_STATUS, FAILURE_CAUSES } = consumerMod;
  const d = buildSearchQualityDescriptor({ templateAuthority: { matched: false }, roles: {} });
  assert.equal(classifyPoolFailure(d).cause, FAILURE_CAUSES.TEMPLATE_ABSENT);
  const a = assessSearchQuality(d);
  assert.equal(a.status, READINESS_STATUS.FAILURE);
  assert.equal(a.dominantCause, FAILURE_CAUSES.TEMPLATE_ABSENT);
});

test('RT: measured stock shortage -> STOCK_SHORTAGE', { skip: skipRT }, () => {
  const { classifyPoolFailure, FAILURE_CAUSES } = consumerMod;
  const t = telemetry({ slotSpec: { hero: 1, circle: 0, support: 0 }, roles: { hero: [{ highRes: false, identity: 'h1', pHash: 'ph_1' }, { highRes: false, identity: 'h2', pHash: 'ph_2' }] } });
  assert.equal(classifyPoolFailure(buildSearchQualityDescriptor(t)).cause, FAILURE_CAUSES.STOCK_SHORTAGE);
});

test('RT: measured crop-unsafe -> CROP_UNSAFE', { skip: skipRT }, () => {
  const { classifyPoolFailure, FAILURE_CAUSES } = consumerMod;
  const t = telemetry({
    slotSpec: { hero: 1, circle: 0, support: 0 },
    roles: { hero: [{ highRes: true, identity: 'h1', pHash: 'ph_1', cropSafe: false }, { highRes: true, identity: 'h2', pHash: 'ph_2', cropSafe: false }] },
  });
  assert.equal(classifyPoolFailure(buildSearchQualityDescriptor(t)).cause, FAILURE_CAUSES.CROP_UNSAFE);
});

test('RT: non-object telemetry -> INSUFFICIENT', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(null)).status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('RT (P1-bounds): over-bound candidate list -> INSUFFICIENT', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const built = buildTemplateSlots({ hero: 1, circle: 0, support: 0 });
  const one = buildCandInline('hero', built.byRole, good('x', 'y'));
  const huge = new Array(100001).fill(one);
  const t = { templateAuthority: { matched: true, slots: built.slots }, roles: { hero: { candidates: huge } } };
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(t)).status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('RT (P1-bounds): over-product input -> INSUFFICIENT (no blow-up)', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const S = LIMITS.MAX_REALIZED_SLOTS;
  const built = buildTemplateSlots({ hero: 0, circle: 0, support: S });
  const count = Math.floor(LIMITS.MAX_CROP_CELLS / S) + 50;
  const cands = new Array(count).fill(0).map(() => buildCand('support', built.byRole, good('x', 'y')));
  const t = { templateAuthority: { matched: true, slots: built.slots }, roles: { support: { candidates: cands } } };
  assert.equal(assessSearchQuality(buildSearchQualityDescriptor(t)).status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('RT E2E: complete descriptor with distinct multi-support pool reads READY', { skip: skipRT }, () => {
  const { assessSearchQuality, READINESS_STATUS } = consumerMod;
  const t = telemetry({
    slotSpec: { hero: 1, circle: 1, support: 3 },
    roles: {
      hero: [good('h1', 'ph_h1'), good('h2', 'ph_h2')],
      circle: [good('c1', 'ph_c1')],
      support: [good('s1', 'ph_1'), good('s2', 'ph_2'), good('s3', 'ph_3'), good('s4', 'ph_4')],
    },
  });
  const d = buildSearchQualityDescriptor(t);
  assert.equal(d.roles.support.cropSafeDistinct, 3);
  const a = assessSearchQuality(d);
  assert.equal(a.status, READINESS_STATUS.READY);
  assert.equal(a.ready, true);
});
