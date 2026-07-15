// Deterministic tests for src/lib/searchQualityMetrics.js
// Run WITHOUT node_modules: node --test tests/search-quality-metrics.test.mjs
//                       or: node tests/search-quality-metrics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
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
} from '../src/lib/searchQualityMetrics.js';

// ---------- fixtures ----------
// A single-panel-per-role realized template (every role needs 1 distinct image).
const DEMAND_1_1_1 = {
  roles: {
    hero: { requiredSlots: 1, requiredUnique: 1 },
    circle: { requiredSlots: 1, requiredUnique: 1 },
    support: { requiredSlots: 1, requiredUnique: 1 },
  },
};

// Fully measured, funnel-valid, all roles at/above demand, template present.
const HEALTHY = {
  templateMatch: true,
  template: DEMAND_1_1_1,
  roles: {
    hero: { vettedRelevant: 5, highRes: 3, cropSafe: 2, cropEvaluated: true },
    circle: { vettedRelevant: 3, highRes: 2, cropSafe: 1, cropEvaluated: true },
    support: { vettedRelevant: 2, highRes: 1, cropSafe: 1, cropEvaluated: true }, // exactly at demand
  },
};

// helper: clone HEALTHY with a patched single role
function withRole(role, patch) {
  return {
    ...HEALTHY,
    roles: { ...HEALTHY.roles, [role]: { ...HEALTHY.roles[role], ...patch } },
  };
}

// ---------- module surface ----------

test('module surface: version, roles, causes, precedence, enums are stable', () => {
  assert.equal(version, 1);
  assert.deepEqual([...POOL_ROLES], ['hero', 'circle', 'support']);
  assert.deepEqual(Object.values(FAILURE_CAUSES).sort(), [
    'CROP_UNSAFE', 'SELECTION_MISS', 'STOCK_SHORTAGE', 'TEMPLATE_ABSENT',
  ]);
  assert.deepEqual([...FAILURE_CAUSE_PRECEDENCE], [
    'TEMPLATE_ABSENT', 'STOCK_SHORTAGE', 'CROP_UNSAFE', 'SELECTION_MISS',
  ]);
  assert.deepEqual(Object.values(SELECTION_OUTCOME).sort(), ['MISS', 'SKIPPED', 'SUCCESS']);
  assert.equal(INSUFFICIENT_REASON.SELECTION_MISS_UNPROVEN, 'SELECTION_MISS_UNPROVEN');
  assert.equal(INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, 'INVALID_SELECTION_EVIDENCE');
  assert.equal(INSUFFICIENT_REASON.ZERO_TEMPLATE_DEMAND, 'ZERO_TEMPLATE_DEMAND');
  assert.equal(INSUFFICIENT_REASON.UNIQUENESS_NOT_EVALUATED, 'UNIQUENESS_NOT_EVALUATED');
});

test('healthy pool => ready & sufficient with full scores', () => {
  const r = evaluatePoolReadiness(HEALTHY);
  assert.equal(r.status, READINESS_STATUS.READY);
  assert.equal(r.ready, true);
  assert.equal(r.version, 1);
  assert.equal(r.templatePresent, true);
  assert.equal(r.poolScore, 1);
  assert.equal(r.readinessScore, 1);
  assert.equal(r.reason, null);
  for (const role of POOL_ROLES) {
    assert.equal(r.roles[role].sufficient, true, `${role} sufficient`);
    assert.equal(r.roles[role].score, 1, `${role} score`);
    assert.equal(r.roles[role].stage, ROLE_STAGE.VIABLE, `${role} stage`);
    assert.equal(r.roles[role].requiredUnique, 1, `${role} demand`);
  }
});

test('healthy pool via assessSearchQuality => ready, no dominant cause', () => {
  const a = assessSearchQuality(HEALTHY);
  assert.equal(a.ready, true);
  assert.equal(a.status, READINESS_STATUS.READY);
  assert.equal(a.dominantCause, null);
  assert.equal(a.evidence, null);
});

// ---------- FIX 1: SELECTION_MISS requires explicit own-data outcome ----------

test('SELECTION_MISS: proven only by attempted+failed own-data', () => {
  const desc = { ...HEALTHY, selectionAttempted: true, selectionFailed: true };
  const c = classifyPoolFailure(desc);
  assert.equal(c.status, 'classified');
  assert.equal(c.cause, FAILURE_CAUSES.SELECTION_MISS);
  assert.equal(c.evidence.templatePresent, true);
  for (const role of POOL_ROLES) {
    assert.equal(c.evidence.roles[role].stage, ROLE_STAGE.VIABLE);
  }
  // via selectionOutcome enum too
  const c2 = classifyPoolFailure({ ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS });
  assert.equal(c2.cause, FAILURE_CAUSES.SELECTION_MISS);
});

test('SELECTION success => NOT a selection miss (no by-elimination)', () => {
  const c = classifyPoolFailure({ ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.SUCCESS });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.cause, null);
  assert.equal(c.reason, INSUFFICIENT_REASON.SELECTION_MISS_UNPROVEN);

  // attempted+failed=false is also a success -> not a miss
  const c2 = classifyPoolFailure({ ...HEALTHY, selectionAttempted: true, selectionFailed: false });
  assert.equal(c2.cause, null);
  assert.equal(c2.reason, INSUFFICIENT_REASON.SELECTION_MISS_UNPROVEN);
});

test('SELECTION info missing => NOT a selection miss; unattributable => insufficient', () => {
  const c = classifyPoolFailure(HEALTHY); // no selection fields at all
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.cause, null);
  assert.equal(c.reason, INSUFFICIENT_REASON.SELECTION_MISS_UNPROVEN);
});

test('SELECTION partial own-data (failed without attempted) => unknown, not a miss', () => {
  const c = classifyPoolFailure({ ...HEALTHY, selectionFailed: true }); // attempted not asserted
  assert.equal(c.cause, null);
  assert.equal(c.reason, INSUFFICIENT_REASON.SELECTION_MISS_UNPROVEN);
});

test('SELECTION skipped (attempted=false) => not a miss', () => {
  const c = classifyPoolFailure({ ...HEALTHY, selectionAttempted: false });
  assert.equal(c.cause, null);
  assert.equal(c.reason, INSUFFICIENT_REASON.SELECTION_MISS_UNPROVEN);
});

test('assessSearchQuality surfaces SELECTION_MISS on a ready pool ONLY with proof', () => {
  // ready pool + proven miss -> ready:true but status FAILURE with the cause
  const a = assessSearchQuality({ ...HEALTHY, selectionAttempted: true, selectionFailed: true });
  assert.equal(a.ready, true, 'pool material was ready');
  assert.equal(a.status, READINESS_STATUS.FAILURE);
  assert.equal(a.dominantCause, FAILURE_CAUSES.SELECTION_MISS);
  assert.equal(a.evidence.cause, FAILURE_CAUSES.SELECTION_MISS);

  // ready pool + unknown selection -> plain READY, no cause fabricated
  const a2 = assessSearchQuality(HEALTHY);
  assert.equal(a2.ready, true);
  assert.equal(a2.status, READINESS_STATUS.READY);
  assert.equal(a2.dominantCause, null);
});

// ---------- FIX 2: missing telemetry => insufficient-data (not shortage) ----------

test('EXPLICIT measured zero proves STOCK_SHORTAGE', () => {
  const desc = withRole('hero', { vettedRelevant: 0, highRes: 0, cropSafe: 0 });
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.STOCK_SHORTAGE);
  assert.deepEqual([...c.evidence.offendingRoles], ['hero']);
  assert.equal(c.evidence.roles.hero.stage, ROLE_STAGE.STOCK);
});

test('MISSING counter (not measured) => insufficient-data, NOT a shortage', () => {
  const hero = { highRes: 2, cropSafe: 1, cropEvaluated: true }; // vettedRelevant absent
  const c = classifyPoolFailure({ templateMatch: true, template: DEMAND_1_1_1, roles: { ...HEALTHY.roles, hero } });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.cause, null);
  assert.equal(c.reason, INSUFFICIENT_REASON.MISSING_COUNTER);
});

test('MISSING templateMatch => insufficient (not TEMPLATE_ABSENT guess)', () => {
  const c = classifyPoolFailure({ template: DEMAND_1_1_1, roles: HEALTHY.roles });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.MISSING_TEMPLATE_MATCH);
});

test('MISSING template demand => insufficient (cannot judge sufficiency)', () => {
  const c = classifyPoolFailure({ templateMatch: true, roles: HEALTHY.roles });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.MISSING_TEMPLATE_DEMAND);
});

test('MISSING roles container => insufficient (not all-STOCK guess)', () => {
  const c = classifyPoolFailure({ templateMatch: true, template: DEMAND_1_1_1 });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.MISSING_ROLES);
});

test('MISSING a demanded role pool => insufficient (MISSING_ROLE)', () => {
  const roles = { hero: HEALTHY.roles.hero, support: HEALTHY.roles.support }; // circle absent, demanded
  const c = classifyPoolFailure({ templateMatch: true, template: DEMAND_1_1_1, roles });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.MISSING_ROLE);
});

test('measured zero across ALL roles => STOCK_SHORTAGE for all (legit, not insufficient)', () => {
  const zero = { vettedRelevant: 0, highRes: 0, cropSafe: 0, cropEvaluated: true };
  const c = classifyPoolFailure({
    templateMatch: true, template: DEMAND_1_1_1,
    roles: { hero: zero, circle: zero, support: zero },
  });
  assert.equal(c.cause, FAILURE_CAUSES.STOCK_SHORTAGE);
  assert.deepEqual([...c.evidence.offendingRoles], ['hero', 'circle', 'support']);
});

test('INVALID counter values (NaN/negative/float/string/huge) => insufficient, no coercion', () => {
  for (const bad of [NaN, Infinity, -1, 2.5, '3', 1e9, null, true]) {
    const desc = withRole('hero', { vettedRelevant: bad, highRes: 1, cropSafe: 1 });
    const c = classifyPoolFailure(desc);
    assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA, `${String(bad)} rejected`);
    // NaN/etc must never become a "measured 0" -> never STOCK_SHORTAGE by coercion
    assert.equal(c.cause, null);
  }
});

// ---------- FIX 3: funnel + completeness ----------

test('FUNNEL violation highRes>vetted => insufficient (defined anomaly)', () => {
  const desc = withRole('hero', { vettedRelevant: 2, highRes: 3, cropSafe: 1 });
  const c = classifyPoolFailure(desc);
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.FUNNEL_VIOLATION);
});

test('FUNNEL violation cropSafe>highRes => insufficient', () => {
  const desc = withRole('hero', { vettedRelevant: 5, highRes: 1, cropSafe: 3 });
  const r = evaluatePoolReadiness(desc);
  assert.equal(r.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(r.reason, INSUFFICIENT_REASON.FUNNEL_VIOLATION);
});

test('INCOMPLETE measurement: cropEvaluated missing or false => insufficient', () => {
  const base = { templateMatch: true, template: DEMAND_1_1_1, roles: { ...HEALTHY.roles } };
  // no cropEvaluated flag at all (fresh object, not spread over the healthy one)
  const c1 = classifyPoolFailure({
    ...base, roles: { ...base.roles, hero: { vettedRelevant: 3, highRes: 2, cropSafe: 1 } },
  });
  assert.equal(c1.reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
  // flag explicitly false
  const c2 = classifyPoolFailure({
    ...base, roles: { ...base.roles, hero: { vettedRelevant: 3, highRes: 2, cropSafe: 1, cropEvaluated: false } },
  });
  assert.equal(c2.reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
});

test('funnel equality (0<=0<=0 and n<=n<=n) is allowed', () => {
  const r = evaluatePoolReadiness(HEALTHY);
  assert.equal(r.status, READINESS_STATUS.READY); // support is 1<=1<=2, exact edges ok
});

// ---------- FIX 4: realized template demand (distinct supports) ----------

test('multi-panel template: 1 crop-safe support does NOT satisfy 3 distinct', () => {
  // support demands 3 distinct; plenty of raw but only 1 crop-safe -> CROP_UNSAFE
  const demand = {
    roles: {
      hero: { requiredSlots: 1, requiredUnique: 1 },
      circle: { requiredSlots: 1, requiredUnique: 1 },
      support: { requiredSlots: 3, requiredUnique: 3 },
    },
  };
  const cropShort = {
    templateMatch: true, template: demand,
    roles: {
      hero: HEALTHY.roles.hero,
      circle: HEALTHY.roles.circle,
      support: { vettedRelevant: 5, highRes: 5, cropSafe: 1, cropEvaluated: true }, // raw ok, crop 1<3
    },
  };
  const c = classifyPoolFailure(cropShort);
  assert.equal(c.cause, FAILURE_CAUSES.CROP_UNSAFE);
  assert.deepEqual([...c.evidence.offendingRoles], ['support']);
  assert.equal(c.evidence.roles.support.requiredUnique, 3);
  assert.equal(c.evidence.roles.support.sufficient, false);

  // only 1 of everything -> STOCK stage (raw itself short of 3)
  const stockShort = {
    templateMatch: true, template: demand,
    roles: {
      hero: HEALTHY.roles.hero,
      circle: HEALTHY.roles.circle,
      support: { vettedRelevant: 1, highRes: 1, cropSafe: 1, cropEvaluated: true },
    },
  };
  const c2 = classifyPoolFailure(stockShort);
  assert.equal(c2.cause, FAILURE_CAUSES.STOCK_SHORTAGE);
  assert.deepEqual([...c2.evidence.offendingRoles], ['support']);
});

test('multi-panel template satisfied when N distinct crop-safe supports exist', () => {
  const demand = {
    roles: {
      hero: { requiredSlots: 1, requiredUnique: 1 },
      circle: { requiredSlots: 1, requiredUnique: 1 },
      support: { requiredSlots: 3, requiredUnique: 3 },
    },
  };
  const ok = {
    templateMatch: true, template: demand,
    roles: {
      hero: HEALTHY.roles.hero,
      circle: HEALTHY.roles.circle,
      // raw 3 AND a MEASURED distinct count of 3 -> genuinely 3 distinct usable
      support: { vettedRelevant: 6, highRes: 4, cropSafe: 3, cropEvaluated: true, cropSafeDistinct: 3, uniquenessEvaluated: true }, // 3 distinct >=3
    },
  };
  const r = evaluatePoolReadiness(ok);
  assert.equal(r.ready, true);
  assert.equal(r.roles.support.stage, ROLE_STAGE.VIABLE);
  assert.equal(r.roles.support.requiredUnique, 3);
  assert.equal(r.roles.support.cropSafeDistinct, 3);
  assert.equal(r.roles.support.uniquenessEvaluated, true);
});

test('unused role (requiredUnique 0) needs no measurement and is auto-sufficient', () => {
  const demand = {
    roles: {
      hero: { requiredSlots: 1, requiredUnique: 1 },
      circle: { requiredSlots: 0, requiredUnique: 0 }, // template does not use circle
      support: { requiredSlots: 1, requiredUnique: 1 },
    },
  };
  // circle omitted entirely -> still ready
  const r = evaluatePoolReadiness({
    templateMatch: true, template: demand,
    roles: { hero: HEALTHY.roles.hero, support: HEALTHY.roles.support },
  });
  assert.equal(r.ready, true);
  assert.equal(r.roles.circle.sufficient, true);
  assert.equal(r.roles.circle.score, 1);
  assert.equal(r.roles.circle.requiredUnique, 0);
});

test('INVALID template demand (unique>slots, negatives, floats) => insufficient', () => {
  const bads = [
    { hero: { requiredSlots: 1, requiredUnique: 2 } }, // unique>slots
    { hero: { requiredSlots: 2, requiredUnique: 0 } }, // slots>0 but unique 0
    { hero: { requiredSlots: -1, requiredUnique: 0 } },
    { hero: { requiredSlots: 1.5, requiredUnique: 1 } },
    { hero: { requiredSlots: 0, requiredUnique: 1 } }, // 0 slots but needs 1
  ];
  for (const heroDemand of bads) {
    const demand = { roles: { ...DEMAND_1_1_1.roles, ...heroDemand } };
    const c = classifyPoolFailure({ templateMatch: true, template: demand, roles: HEALTHY.roles });
    assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA, JSON.stringify(heroDemand));
    assert.equal(c.reason, INSUFFICIENT_REASON.INVALID_TEMPLATE_DEMAND);
  }
});

test('demand-derived thresholds: hero requiredUnique=2 partial score is deterministic', () => {
  const demand = {
    roles: {
      hero: { requiredSlots: 2, requiredUnique: 2 },
      circle: { requiredSlots: 1, requiredUnique: 1 },
      support: { requiredSlots: 1, requiredUnique: 1 },
    },
  };
  // hero counts (2,2,1) vs U=2: ratios 1,1,0.5 -> 0.25+0.30+0.225 = 0.775; crop 1<2 -> CROP
  const r = evaluatePoolReadiness({
    templateMatch: true, template: demand,
    roles: {
      hero: { vettedRelevant: 2, highRes: 2, cropSafe: 1, cropEvaluated: true },
      circle: HEALTHY.roles.circle,
      support: HEALTHY.roles.support,
    },
  });
  assert.equal(r.roles.hero.score, 0.775);
  assert.equal(r.roles.hero.stage, ROLE_STAGE.CROP);
  assert.equal(r.roles.hero.sufficient, false);
  // poolScore = 0.5*0.775 + 0.3*1 + 0.2*1 = 0.8875
  assert.equal(r.poolScore, 0.8875);
  assert.equal(r.ready, false);
});

// ---------- classification precedence & boundaries ----------

test('STOCK_SHORTAGE: enough vetted but too few high-res reads as stock shortfall', () => {
  const desc = withRole('hero', { vettedRelevant: 5, highRes: 0, cropSafe: 0 }); // hi 0 < 1
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.STOCK_SHORTAGE);
  assert.equal(c.evidence.roles.hero.stage, ROLE_STAGE.STOCK);
});

test('CROP_UNSAFE: enough vetted & high-res but none crop-safe', () => {
  const desc = withRole('hero', { vettedRelevant: 5, highRes: 3, cropSafe: 0 });
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.CROP_UNSAFE);
  assert.deepEqual([...c.evidence.offendingRoles], ['hero']);
  assert.equal(c.evidence.roles.hero.stage, ROLE_STAGE.CROP);
});

test('boundary: cropSafe exactly at demand is VIABLE, one below is CROP', () => {
  const at = evaluatePoolReadiness(withRole('hero', { vettedRelevant: 3, highRes: 2, cropSafe: 1 }));
  assert.equal(at.roles.hero.stage, ROLE_STAGE.VIABLE);
  assert.equal(at.roles.hero.sufficient, true);
  const below = evaluatePoolReadiness(withRole('hero', { vettedRelevant: 3, highRes: 2, cropSafe: 0 }));
  assert.equal(below.roles.hero.stage, ROLE_STAGE.CROP);
});

test('precedence: STOCK_SHORTAGE dominates a concurrent CROP_UNSAFE', () => {
  const desc = {
    templateMatch: true, template: DEMAND_1_1_1,
    roles: {
      hero: { vettedRelevant: 0, highRes: 0, cropSafe: 0, cropEvaluated: true },   // STOCK
      circle: { vettedRelevant: 3, highRes: 2, cropSafe: 0, cropEvaluated: true }, // CROP
      support: HEALTHY.roles.support,
    },
  };
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.STOCK_SHORTAGE);
});

test('precedence: a real shortage dominates an explicit selection miss', () => {
  const desc = {
    ...withRole('hero', { vettedRelevant: 0, highRes: 0, cropSafe: 0 }),
    selectionAttempted: true, selectionFailed: true,
  };
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.STOCK_SHORTAGE); // upstream wins, selection ignored
});

// ---------- TEMPLATE_ABSENT (explicit false) ----------

test('TEMPLATE_ABSENT: explicit templateMatch=false, no pool telemetry needed', () => {
  const desc = { templateMatch: false };
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.TEMPLATE_ABSENT);
  assert.equal(c.evidence.templatePresent, false);
  assert.equal(c.evidence.roles, null);

  const a = assessSearchQuality(desc);
  assert.equal(a.ready, false);
  assert.equal(a.dominantCause, FAILURE_CAUSES.TEMPLATE_ABSENT);
  assert.equal(a.readinessScore, 0);
  assert.equal(a.poolScore, 0);
  assert.equal(a.templatePresent, false);

  const r = evaluatePoolReadiness(desc);
  assert.equal(r.status, READINESS_STATUS.FAILURE);
  assert.equal(r.ready, false);
  assert.equal(r.roles, null);
});

// ---------- determinism ----------

test('determinism: same input twice => byte-identical serialized output', () => {
  const mk = () => ({
    templateMatch: true, template: DEMAND_1_1_1,
    roles: {
      hero: { vettedRelevant: 3, highRes: 1, cropSafe: 0, cropEvaluated: true },
      circle: HEALTHY.roles.circle,
      support: HEALTHY.roles.support,
    },
  });
  const r1 = evaluatePoolReadiness(mk());
  const r2 = evaluatePoolReadiness(mk());
  assert.deepEqual(JSON.parse(JSON.stringify(r1)), JSON.parse(JSON.stringify(r2)));
  // hero (3,1,0) U=1: ratios 1,1,0 -> 0.25+0.30+0 = 0.55 ; pool 0.5*0.55+0.3+0.2 = 0.775
  assert.equal(r1.roles.hero.score, 0.55);
  assert.equal(r1.poolScore, 0.775);
  assert.equal(r1.ready, false);
});

// ---------- deep-freeze (FIX 5) ----------

test('outputs are deeply frozen: result, roles container, nested details, evidence', () => {
  const a = assessSearchQuality(withRole('hero', { vettedRelevant: 0, highRes: 0, cropSafe: 0 }));
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(a.roles), true);
  assert.equal(Object.isFrozen(a.roles.hero), true);
  assert.equal(Object.isFrozen(a.evidence), true);
  assert.equal(Object.isFrozen(a.evidence.roles), true);
  assert.equal(Object.isFrozen(a.evidence.roles.hero), true);
  assert.equal(Object.isFrozen(a.evidence.offendingRoles), true);
  // mutation attempts are silently ignored (frozen) — value unchanged
  assert.throws(() => { 'use strict'; a.roles.hero.cropSafe = 999; });
  assert.equal(a.roles.hero.cropSafe, 0);
  assert.throws(() => { 'use strict'; a.evidence.offendingRoles.push('x'); });
});

// ---------- malformed / hostile input (must never throw) ----------

test('malformed primitives/null/array => insufficient-data, never throws', () => {
  for (const bad of [null, undefined, 42, 'x', true, [], [1, 2, 3], () => {}]) {
    let a; let c; let r;
    assert.doesNotThrow(() => { a = assessSearchQuality(bad); });
    assert.doesNotThrow(() => { c = classifyPoolFailure(bad); });
    assert.doesNotThrow(() => { r = evaluatePoolReadiness(bad); });
    assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
    assert.equal(a.dominantCause, null);
    assert.equal(a.reason, INSUFFICIENT_REASON.STRUCTURAL);
    assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
    assert.equal(c.cause, null);
    assert.equal(r.status, READINESS_STATUS.INSUFFICIENT_DATA);
    assert.equal(r.ready, false);
  }
});

test('exotic prototype => insufficient-data (STRUCTURAL)', () => {
  const exotic = Object.create({ injected: true });
  exotic.templateMatch = true;
  const a = assessSearchQuality(exotic);
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.STRUCTURAL);
});

test('accessor on templateMatch is refused WITHOUT invoking the getter', () => {
  let hit = false;
  const hostile = {};
  Object.defineProperty(hostile, 'templateMatch', {
    enumerable: true, configurable: true, get() { hit = true; return true; },
  });
  let a;
  assert.doesNotThrow(() => { a = assessSearchQuality(hostile); });
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.STRUCTURAL);
  assert.equal(hit, false, 'getter must never be invoked');
});

test('accessor on a role container field => insufficient, getter not invoked', () => {
  let getterInvoked = false;
  const roles = {};
  Object.defineProperty(roles, 'hero', {
    enumerable: true, configurable: true,
    get() { getterInvoked = true; return { vettedRelevant: 9, highRes: 9, cropSafe: 9, cropEvaluated: true }; },
  });
  let a;
  assert.doesNotThrow(() => { a = assessSearchQuality({ templateMatch: true, template: DEMAND_1_1_1, roles }); });
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(getterInvoked, false);
});

test('accessor on a count field => insufficient, getter not invoked', () => {
  let hit = false;
  const hero = { highRes: 2, cropSafe: 1, cropEvaluated: true };
  Object.defineProperty(hero, 'vettedRelevant', {
    enumerable: true, configurable: true, get() { hit = true; return 5; },
  });
  const c = classifyPoolFailure({ templateMatch: true, template: DEMAND_1_1_1, roles: { ...HEALTHY.roles, hero } });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(hit, false);
});

test('accessor on selectionFailed => insufficient, getter not invoked', () => {
  let hit = false;
  const hostile = { ...HEALTHY };
  Object.defineProperty(hostile, 'selectionFailed', {
    enumerable: true, configurable: true, get() { hit = true; return true; },
  });
  const c = classifyPoolFailure(hostile);
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.STRUCTURAL);
  assert.equal(hit, false);
});

test('accessor on template demand field => insufficient, getter not invoked', () => {
  let hit = false;
  const heroDemand = {};
  Object.defineProperty(heroDemand, 'requiredUnique', {
    enumerable: true, configurable: true, get() { hit = true; return 1; },
  });
  const template = { roles: { ...DEMAND_1_1_1.roles, hero: heroDemand } };
  const c = classifyPoolFailure({ templateMatch: true, template, roles: HEALTHY.roles });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.STRUCTURAL);
  assert.equal(hit, false);
});

test('Proxy whose getPrototypeOf trap throws => insufficient-data, never throws', () => {
  const hostile = new Proxy({ templateMatch: true }, { getPrototypeOf() { throw new Error('boom'); } });
  let a; let c;
  assert.doesNotThrow(() => { a = assessSearchQuality(hostile); });
  assert.doesNotThrow(() => { c = classifyPoolFailure(hostile); });
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
});

test('Proxy whose getOwnPropertyDescriptor trap throws => insufficient-data', () => {
  const hostile = new Proxy({ templateMatch: true }, { getOwnPropertyDescriptor() { throw new Error('boom'); } });
  let a;
  assert.doesNotThrow(() => { a = assessSearchQuality(hostile); });
  assert.equal(a.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(a.reason, INSUFFICIENT_REASON.STRUCTURAL);
});

// ---------- constants integrity ----------

test('weights are frozen and sum to 1', () => {
  assert.throws(() => { 'use strict'; ROLE_WEIGHTS.hero = 0; });
  const roleSum = POOL_ROLES.reduce((s, r) => s + ROLE_WEIGHTS[r], 0);
  assert.equal(Math.round(roleSum * 1000) / 1000, 1);
  const dimSum = DIM_WEIGHTS.vetted + DIM_WEIGHTS.highRes + DIM_WEIGHTS.cropSafe;
  assert.equal(Math.round(dimSum * 1000) / 1000, 1);
});

// ============================================================
// NEGATIVE COVERAGE — audit remediation (FIX 1-4 fail-closed proofs)
// ============================================================

// ---------- FIX 1: revoked-proxy fail-closed on EVERY public API ----------

test('revoked proxy => insufficient-data on every public API, never throws', () => {
  const seed = () => ({ templateMatch: true, template: DEMAND_1_1_1, roles: HEALTHY.roles });
  for (const fn of [evaluatePoolReadiness, classifyPoolFailure, assessSearchQuality]) {
    const { proxy, revoke } = Proxy.revocable(seed(), {});
    revoke(); // every trap (Array.isArray, getPrototypeOf, getOwnPropertyDescriptor...) now throws
    let out;
    assert.doesNotThrow(() => { out = fn(proxy); }, `${fn.name} must not throw on a revoked proxy`);
    assert.equal(out.status, READINESS_STATUS.INSUFFICIENT_DATA, `${fn.name} status`);
    assert.equal(out.reason, INSUFFICIENT_REASON.STRUCTURAL, `${fn.name} reason`);
  }
});

test('revoked proxy as a nested role container => insufficient, never throws', () => {
  const { proxy, revoke } = Proxy.revocable({ hero: {} }, {});
  revoke();
  let c;
  assert.doesNotThrow(() => {
    c = classifyPoolFailure({ templateMatch: true, template: DEMAND_1_1_1, roles: proxy });
  });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.STRUCTURAL);
});

// ---------- FIX 2: validate ALL present selection fields ----------

test('invalid / conflicting selection evidence => INVALID_SELECTION_EVIDENCE on every API', () => {
  const cases = [
    { selectionAttempted: false, selectionFailed: true },                      // not attempted cannot have failed
    { selectionOutcome: 'WEIRD' },                                             // out-of-enum outcome
    { selectionAttempted: 'yes' },                                             // non-boolean flag
    { selectionFailed: 1 },                                                    // non-boolean flag
    { selectionOutcome: SELECTION_OUTCOME.SUCCESS, selectionFailed: true },    // outcome vs boolean conflict
    { selectionOutcome: SELECTION_OUTCOME.MISS, selectionAttempted: false },   // outcome vs boolean conflict
    { selectionOutcome: SELECTION_OUTCOME.SKIPPED, selectionAttempted: true }, // skipped but attempted true
  ];
  for (const sel of cases) {
    const desc = { ...HEALTHY, ...sel };
    for (const fn of [classifyPoolFailure, assessSearchQuality, evaluatePoolReadiness]) {
      const out = fn(desc);
      assert.equal(out.status, READINESS_STATUS.INSUFFICIENT_DATA, `${fn.name} ${JSON.stringify(sel)}`);
      assert.equal(out.reason, INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `${fn.name} ${JSON.stringify(sel)}`);
    }
    // no cause is ever fabricated from invalid selection evidence
    assert.equal(classifyPoolFailure(desc).cause, null, `no cause ${JSON.stringify(sel)}`);
    assert.equal(assessSearchQuality(desc).dominantCause, null, `no dominantCause ${JSON.stringify(sel)}`);
  }
});

test('explicit attempted:false + failed:true is rejected (never treated as skipped)', () => {
  const c = classifyPoolFailure({ ...HEALTHY, selectionAttempted: false, selectionFailed: true });
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE);
  assert.equal(c.cause, null);
});

// ---------- FIX 3: weighted sum over demanded roles; zero demand invalid ----------

test('zero total demand (every role unused) => insufficient on every API', () => {
  const zeroDemand = {
    roles: {
      hero: { requiredSlots: 0, requiredUnique: 0 },
      circle: { requiredSlots: 0, requiredUnique: 0 },
      support: { requiredSlots: 0, requiredUnique: 0 },
    },
  };
  const desc = { templateMatch: true, template: zeroDemand, roles: {} };
  for (const fn of [evaluatePoolReadiness, classifyPoolFailure, assessSearchQuality]) {
    const out = fn(desc);
    assert.equal(out.status, READINESS_STATUS.INSUFFICIENT_DATA, fn.name);
    assert.equal(out.reason, INSUFFICIENT_REASON.ZERO_TEMPLATE_DEMAND, fn.name);
  }
});

test('unused role excluded from weighted sum; weights renormalized over demanded roles', () => {
  const demand = {
    roles: {
      hero: { requiredSlots: 1, requiredUnique: 1 },
      circle: { requiredSlots: 0, requiredUnique: 0 }, // unused -> excluded, weight renormalized away
      support: { requiredSlots: 1, requiredUnique: 1 },
    },
  };
  const r = evaluatePoolReadiness({
    templateMatch: true, template: demand,
    roles: {
      hero: { vettedRelevant: 3, highRes: 1, cropSafe: 0, cropEvaluated: true }, // score 0.55, not crop-viable
      support: HEALTHY.roles.support, // score 1
    },
  });
  assert.equal(r.roles.hero.score, 0.55);
  assert.equal(r.roles.support.score, 1);
  assert.equal(r.roles.circle.requiredUnique, 0);
  // Renormalized over demanded {hero:0.5, support:0.2}=0.7:
  // (0.5*0.55 + 0.2*1)/0.7 = 0.475/0.7 = 0.6786.
  // (The buggy all-roles sum with circle@0.3*1 would have read 0.775.)
  assert.equal(r.poolScore, 0.6786);
  assert.equal(r.readinessScore, 0.6786);
  assert.equal(r.ready, false);
});

// ---------- FIX 4: uniqueness completeness + offending scoped to demanded ----------

test('raw duplicate count can NEVER satisfy requiredUnique>=2 without a distinct measurement', () => {
  const demand = {
    roles: {
      hero: { requiredSlots: 1, requiredUnique: 1 },
      circle: { requiredSlots: 1, requiredUnique: 1 },
      support: { requiredSlots: 3, requiredUnique: 3 },
    },
  };
  // raw crop-safe LOOKS enough (5>=3) but distinctness was never measured -> fail closed
  const rawLooksEnough = {
    templateMatch: true, template: demand,
    roles: {
      hero: HEALTHY.roles.hero,
      circle: HEALTHY.roles.circle,
      support: { vettedRelevant: 8, highRes: 6, cropSafe: 5, cropEvaluated: true }, // no uniqueness contract
    },
  };
  const c = classifyPoolFailure(rawLooksEnough);
  assert.equal(c.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c.reason, INSUFFICIENT_REASON.UNIQUENESS_NOT_EVALUATED);
  // readiness API fails closed identically
  assert.equal(evaluatePoolReadiness(rawLooksEnough).reason, INSUFFICIENT_REASON.UNIQUENESS_NOT_EVALUATED);

  // measured distinct BELOW demand (5 raw but only 1 distinct) -> CROP_UNSAFE, not satisfied
  const measuredDupes = {
    templateMatch: true, template: demand,
    roles: {
      hero: HEALTHY.roles.hero,
      circle: HEALTHY.roles.circle,
      support: { vettedRelevant: 8, highRes: 6, cropSafe: 5, cropEvaluated: true, cropSafeDistinct: 1, uniquenessEvaluated: true },
    },
  };
  const c2 = classifyPoolFailure(measuredDupes);
  assert.equal(c2.cause, FAILURE_CAUSES.CROP_UNSAFE);
  assert.deepEqual([...c2.evidence.offendingRoles], ['support']);
  assert.equal(c2.evidence.roles.support.cropSafeDistinct, 1);
  assert.equal(c2.evidence.roles.support.uniquenessEvaluated, true);
  assert.equal(c2.evidence.roles.support.sufficient, false);

  // distinct count may not exceed the raw crop-safe pile -> funnel violation
  const distinctTooHigh = {
    templateMatch: true, template: demand,
    roles: {
      hero: HEALTHY.roles.hero,
      circle: HEALTHY.roles.circle,
      support: { vettedRelevant: 8, highRes: 6, cropSafe: 5, cropEvaluated: true, cropSafeDistinct: 6, uniquenessEvaluated: true },
    },
  };
  const c3 = classifyPoolFailure(distinctTooHigh);
  assert.equal(c3.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(c3.reason, INSUFFICIENT_REASON.FUNNEL_VIOLATION);
});

test('distinct count present without uniquenessEvaluated flag => contradictory => insufficient', () => {
  // stray distinct count, no eval flag
  const stray = classifyPoolFailure(withRole('hero', { vettedRelevant: 5, highRes: 3, cropSafe: 2, cropSafeDistinct: 2 }));
  assert.equal(stray.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(stray.reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
  // eval flag explicitly false but a distinct count is present
  const conflict = classifyPoolFailure(withRole('hero', { vettedRelevant: 5, highRes: 3, cropSafe: 2, cropSafeDistinct: 2, uniquenessEvaluated: false }));
  assert.equal(conflict.reason, INSUFFICIENT_REASON.INCOMPLETE_MEASUREMENT);
});

test('offendingRoles list ONLY demanded roles (an unused role is never blamed)', () => {
  const demand = {
    roles: {
      hero: { requiredSlots: 1, requiredUnique: 1 },
      circle: { requiredSlots: 0, requiredUnique: 0 }, // unused
      support: { requiredSlots: 1, requiredUnique: 1 },
    },
  };
  // ready pool + proven, SCOPED SELECTION_MISS -> offending [hero, support], never circle
  const ready = {
    templateMatch: true, template: demand,
    roles: { hero: HEALTHY.roles.hero, support: HEALTHY.roles.support },
    selectionOutcome: SELECTION_OUTCOME.MISS,
    failedRoles: ['hero', 'support'],
  };
  const c = classifyPoolFailure(ready);
  assert.equal(c.cause, FAILURE_CAUSES.SELECTION_MISS);
  assert.deepEqual([...c.evidence.offendingRoles], ['hero', 'support']);
  assert.equal(c.evidence.missScope, 'SCOPED');
  assert.ok(![...c.evidence.offendingRoles].includes('circle'));
  const a = assessSearchQuality(ready);
  assert.equal(a.dominantCause, FAILURE_CAUSES.SELECTION_MISS);
  assert.deepEqual([...a.evidence.offendingRoles], ['hero', 'support']);
  assert.equal(a.evidence.missScope, 'SCOPED');

  // STOCK shortage on hero while circle unused -> offending [hero] only
  const stock = {
    templateMatch: true, template: demand,
    roles: {
      hero: { vettedRelevant: 0, highRes: 0, cropSafe: 0, cropEvaluated: true },
      support: HEALTHY.roles.support,
    },
  };
  const c2 = classifyPoolFailure(stock);
  assert.equal(c2.cause, FAILURE_CAUSES.STOCK_SHORTAGE);
  assert.deepEqual([...c2.evidence.offendingRoles], ['hero']);
});

test('requiredUnique===1 is satisfied by raw crop-safe without a uniqueness contract', () => {
  // a nonempty crop-safe pile trivially yields >=1 distinct; no uniqueness data needed
  const r = evaluatePoolReadiness(HEALTHY);
  assert.equal(r.ready, true);
  for (const role of POOL_ROLES) {
    assert.equal(r.roles[role].uniquenessEvaluated, false, `${role} uniqueness not evaluated`);
    assert.equal(r.roles[role].cropSafeDistinct, null, `${role} distinct null`);
    assert.equal(r.roles[role].sufficient, true, `${role} sufficient on raw`);
  }
});

// ============================================================
// P1 — selection integrity validated BEFORE the templateMatch:false short-circuit
// ============================================================

const ALL_APIS = [evaluatePoolReadiness, classifyPoolFailure, assessSearchQuality];

// Assert an insufficient-data result on whichever public API shape came back.
function assertInsufficient(out, reason, label) {
  assert.equal(out.status, READINESS_STATUS.INSUFFICIENT_DATA, `${label} status`);
  assert.equal(out.reason, reason, `${label} reason`);
  // no cause / dominantCause is ever fabricated on an insufficient result
  if ('cause' in out) assert.equal(out.cause, null, `${label} cause`);
  if ('dominantCause' in out) assert.equal(out.dominantCause, null, `${label} dominantCause`);
}

test('P1: templateMatch:false with CONTRADICTORY selection (attempted:false+failed:true) => INVALID_SELECTION_EVIDENCE on all three APIs', () => {
  const desc = { templateMatch: false, selectionAttempted: false, selectionFailed: true };
  for (const fn of ALL_APIS) {
    assertInsufficient(fn(desc), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `${fn.name}`);
  }
});

test('P1: templateMatch:false with out-of-enum selectionOutcome (BOGUS) => INVALID_SELECTION_EVIDENCE on all three APIs', () => {
  const desc = { templateMatch: false, selectionOutcome: 'BOGUS' };
  for (const fn of ALL_APIS) {
    assertInsufficient(fn(desc), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `${fn.name}`);
  }
});

test('P1: {templateMatch:false} ALONE still yields TEMPLATE_ABSENT (unchanged)', () => {
  const desc = { templateMatch: false };
  const c = classifyPoolFailure(desc);
  assert.equal(c.status, 'classified');
  assert.equal(c.cause, FAILURE_CAUSES.TEMPLATE_ABSENT);
  const a = assessSearchQuality(desc);
  assert.equal(a.status, READINESS_STATUS.FAILURE);
  assert.equal(a.dominantCause, FAILURE_CAUSES.TEMPLATE_ABSENT);
  const r = evaluatePoolReadiness(desc);
  assert.equal(r.status, READINESS_STATUS.FAILURE);
  assert.equal(r.templatePresent, false);
});

test('P1: {templateMatch:false} with VALID selection evidence still yields TEMPLATE_ABSENT', () => {
  // valid non-miss outcome, and a valid proven miss: neither is contradictory
  for (const sel of [
    { selectionOutcome: SELECTION_OUTCOME.SUCCESS },
    { selectionOutcome: SELECTION_OUTCOME.SKIPPED },
    { selectionAttempted: true, selectionFailed: false },
    { selectionOutcome: SELECTION_OUTCOME.MISS }, // a valid miss is still template-absent here
  ]) {
    const desc = { templateMatch: false, ...sel };
    assert.equal(classifyPoolFailure(desc).cause, FAILURE_CAUSES.TEMPLATE_ABSENT, JSON.stringify(sel));
    assert.equal(assessSearchQuality(desc).dominantCause, FAILURE_CAUSES.TEMPLATE_ABSENT, JSON.stringify(sel));
    assert.equal(evaluatePoolReadiness(desc).status, READINESS_STATUS.FAILURE, JSON.stringify(sel));
  }
});

// ============================================================
// P2 — SELECTION_MISS scoping (scoped vs unscoped-global)
// ============================================================

test('P2: UNSCOPED global miss => offendingRoles EMPTY, missScope GLOBAL (never blames all demanded roles)', () => {
  const desc = { ...HEALTHY, selectionAttempted: true, selectionFailed: true }; // no failedRoles/failedSlots
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.SELECTION_MISS);
  assert.deepEqual([...c.evidence.offendingRoles], []);
  assert.equal(c.evidence.missScope, 'GLOBAL');
  // every demanded role is still fully described (VIABLE) in the evidence
  for (const role of POOL_ROLES) assert.equal(c.evidence.roles[role].stage, ROLE_STAGE.VIABLE);

  const a = assessSearchQuality(desc);
  assert.equal(a.ready, true);
  assert.equal(a.status, READINESS_STATUS.FAILURE);
  assert.equal(a.dominantCause, FAILURE_CAUSES.SELECTION_MISS);
  assert.deepEqual([...a.evidence.offendingRoles], []);
  assert.equal(a.evidence.missScope, 'GLOBAL');
});

test('P2: SCOPED miss via failedRoles => offendingRoles is exactly the named role(s), missScope SCOPED', () => {
  const desc = { ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS, failedRoles: ['circle'] };
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.SELECTION_MISS);
  assert.deepEqual([...c.evidence.offendingRoles], ['circle']);
  assert.equal(c.evidence.missScope, 'SCOPED');
  const a = assessSearchQuality(desc);
  assert.deepEqual([...a.evidence.offendingRoles], ['circle']);
  assert.equal(a.evidence.missScope, 'SCOPED');
});

test('P2: SCOPED miss via failedSlots (role-keyed slot indices) scopes the miss', () => {
  // support demand is requiredSlots:1 (DEMAND_1_1_1), so slot index 0 is the only
  // in-range index; the validated slot map is preserved in the evidence.
  const desc = { ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS, failedSlots: { support: [0] } };
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.SELECTION_MISS);
  assert.deepEqual([...c.evidence.offendingRoles], ['support']);
  assert.equal(c.evidence.missScope, 'SCOPED');
  assert.deepEqual(c.evidence.failedSlots, { support: [0] });
});

test('P2: failedRoles + failedSlots UNION, canonically ordered', () => {
  const desc = {
    ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS,
    failedRoles: ['support'], failedSlots: { hero: [0] },
  };
  const c = classifyPoolFailure(desc);
  assert.deepEqual([...c.evidence.offendingRoles], ['hero', 'support']); // POOL_ROLES order
  assert.equal(c.evidence.missScope, 'SCOPED');
});

test('P2: scope naming an UNDEMANDED role => INVALID_SELECTION_EVIDENCE on all three APIs', () => {
  const demand = {
    roles: {
      hero: { requiredSlots: 1, requiredUnique: 1 },
      circle: { requiredSlots: 0, requiredUnique: 0 }, // unused
      support: { requiredSlots: 1, requiredUnique: 1 },
    },
  };
  const desc = {
    templateMatch: true, template: demand,
    roles: { hero: HEALTHY.roles.hero, support: HEALTHY.roles.support },
    selectionOutcome: SELECTION_OUTCOME.MISS, failedRoles: ['circle'], // circle is not demanded
  };
  for (const fn of ALL_APIS) {
    assertInsufficient(fn(desc), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `${fn.name}`);
  }
});

test('P2: malformed failedRoles => INVALID_SELECTION_EVIDENCE (non-array/empty/bad token/hole)', () => {
  const bads = [
    'hero',            // not an array
    [],                // present but scopes nothing
    ['bogus'],         // unknown role token
    [123],             // non-string element
    ['hero', null],    // null element
  ];
  for (const failedRoles of bads) {
    const desc = { ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS, failedRoles };
    for (const fn of ALL_APIS) {
      assertInsufficient(fn(desc), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `${fn.name} ${JSON.stringify(failedRoles)}`);
    }
  }
});

test('P2: malformed failedSlots => INVALID_SELECTION_EVIDENCE (stray key/empty/bad index)', () => {
  const bads = [
    { bogus: [0] },        // stray non-role key
    { support: [] },       // empty slot list
    { support: [1.5] },    // non-integer slot index
    { support: 3 },        // value not an array
    {},                    // scopes nothing
  ];
  for (const failedSlots of bads) {
    const desc = { ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS, failedSlots };
    assertInsufficient(classifyPoolFailure(desc), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, JSON.stringify(failedSlots));
  }
});

test('P2: scope evidence WITHOUT a proven miss is contradictory => INVALID_SELECTION_EVIDENCE', () => {
  for (const sel of [
    { failedRoles: ['hero'] },                                         // scope, no outcome at all
    { selectionOutcome: SELECTION_OUTCOME.SUCCESS, failedRoles: ['hero'] }, // scope on a success
    { selectionOutcome: SELECTION_OUTCOME.SKIPPED, failedSlots: { hero: [0] } }, // scope on a skip
  ]) {
    const desc = { ...HEALTHY, ...sel };
    for (const fn of ALL_APIS) {
      assertInsufficient(fn(desc), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `${fn.name} ${JSON.stringify(sel)}`);
    }
  }
});

test('P2: non-selection causes carry missScope null (STOCK/CROP)', () => {
  const stock = classifyPoolFailure(withRole('hero', { vettedRelevant: 0, highRes: 0, cropSafe: 0 }));
  assert.equal(stock.cause, FAILURE_CAUSES.STOCK_SHORTAGE);
  assert.equal(stock.evidence.missScope, null);
  const crop = classifyPoolFailure(withRole('hero', { vettedRelevant: 5, highRes: 3, cropSafe: 0 }));
  assert.equal(crop.cause, FAILURE_CAUSES.CROP_UNSAFE);
  assert.equal(crop.evidence.missScope, null);
});

test('P2: a real shortage still dominates a SCOPED selection miss (precedence unchanged)', () => {
  const desc = {
    ...withRole('hero', { vettedRelevant: 0, highRes: 0, cropSafe: 0 }),
    selectionOutcome: SELECTION_OUTCOME.MISS, failedRoles: ['support'],
  };
  const c = classifyPoolFailure(desc);
  assert.equal(c.cause, FAILURE_CAUSES.STOCK_SHORTAGE); // upstream measured cause wins
  assert.deepEqual([...c.evidence.offendingRoles], ['hero']);
});

// ---------- P2: raw counters may contain duplicates; distinct governs demand ----------

test('P2: raw vetted/highRes MAY contain duplicates — only cropSafeDistinct governs requiredUnique', () => {
  const demand = {
    roles: {
      hero: { requiredSlots: 1, requiredUnique: 1 },
      circle: { requiredSlots: 1, requiredUnique: 1 },
      support: { requiredSlots: 3, requiredUnique: 3 },
    },
  };
  // support: huge raw supply that MAY be mostly near-duplicates (vetted 50, highRes 40),
  // but a MEASURED distinct count of exactly 3 satisfies requiredUnique=3.
  const ok = {
    templateMatch: true, template: demand,
    roles: {
      hero: HEALTHY.roles.hero,
      circle: HEALTHY.roles.circle,
      support: { vettedRelevant: 50, highRes: 40, cropSafe: 8, cropEvaluated: true, cropSafeDistinct: 3, uniquenessEvaluated: true },
    },
  };
  const r = evaluatePoolReadiness(ok);
  assert.equal(r.ready, true);
  assert.equal(r.roles.support.requiredUnique, 3);
  assert.equal(r.roles.support.cropSafeDistinct, 3);
  assert.equal(r.roles.support.sufficient, true);

  // Same enormous raw supply but distinctness NEVER measured => cannot rule out an
  // all-duplicate pile => fail closed (raw supply is not distinctness).
  const rawOnly = {
    templateMatch: true, template: demand,
    roles: {
      hero: HEALTHY.roles.hero,
      circle: HEALTHY.roles.circle,
      support: { vettedRelevant: 50, highRes: 40, cropSafe: 8, cropEvaluated: true },
    },
  };
  assert.equal(evaluatePoolReadiness(rawOnly).reason, INSUFFICIENT_REASON.UNIQUENESS_NOT_EVALUATED);
});

// ============================================================
// P1-1 — canonical per-role failedSlots map validated against the realized demand
// ============================================================

test('P1-1: failedSlots role-local indices validated against requiredSlots (support demand=1)', () => {
  // HEALTHY uses DEMAND_1_1_1 -> support requiredSlots === 1; only index 0 is valid.
  const mk = (slots) => ({ ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS, failedSlots: { support: slots } });

  // out of range (99999 >= requiredSlots 1) — bounded int, but not a real slot
  assertInsufficient(classifyPoolFailure(mk([99999])), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, 'out-of-range');
  // duplicate index within a role (explicit set policy — NO silent dedup)
  assertInsufficient(classifyPoolFailure(mk([0, 0])), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, 'duplicate');
  // exceeds demand (2 indices but only 1 slot)
  assertInsufficient(classifyPoolFailure(mk([0, 1])), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, 'exceeds-demand');

  // valid single in-range index -> SCOPED miss carrying the validated slot map
  const ok = classifyPoolFailure(mk([0]));
  assert.equal(ok.cause, FAILURE_CAUSES.SELECTION_MISS);
  assert.deepEqual([...ok.evidence.offendingRoles], ['support']);
  assert.equal(ok.evidence.missScope, 'SCOPED');
  assert.deepEqual(ok.evidence.failedSlots, { support: [0] });
  assert.equal(Object.isFrozen(ok.evidence.failedSlots), true);
  assert.equal(Object.isFrozen(ok.evidence.failedSlots.support), true);

  // all three public APIs agree on the rejection
  for (const fn of ALL_APIS) {
    assertInsufficient(fn(mk([0, 1])), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `${fn.name}`);
    assertInsufficient(fn(mk([0, 0])), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `${fn.name}`);
    assertInsufficient(fn(mk([99999])), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `${fn.name}`);
  }
});

test('P1-1: multi-slot support demand accepts distinct in-range indices; caps by demand', () => {
  const demand = {
    roles: {
      hero: { requiredSlots: 1, requiredUnique: 1 },
      circle: { requiredSlots: 1, requiredUnique: 1 },
      support: { requiredSlots: 2, requiredUnique: 1 }, // two panels, one distinct image
    },
  };
  const base = {
    templateMatch: true, template: demand,
    roles: { hero: HEALTHY.roles.hero, circle: HEALTHY.roles.circle, support: HEALTHY.roles.support },
    selectionOutcome: SELECTION_OUTCOME.MISS,
  };
  // both in-range distinct indices accepted, order preserved
  const c = classifyPoolFailure({ ...base, failedSlots: { support: [0, 1] } });
  assert.equal(c.cause, FAILURE_CAUSES.SELECTION_MISS);
  assert.deepEqual([...c.evidence.offendingRoles], ['support']);
  assert.equal(c.evidence.missScope, 'SCOPED');
  assert.deepEqual(c.evidence.failedSlots, { support: [0, 1] });

  // exceeding the 2-slot demand (3 indices) is rejected (cap by demand)
  assertInsufficient(
    classifyPoolFailure({ ...base, failedSlots: { support: [0, 1, 2] } }),
    INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, 'over-demand',
  );
});

// ============================================================
// P1-2 — safe-array probe: exact Array.prototype + Reflect.ownKeys key screening
// ============================================================

test('P1-2: hostile failedRoles arrays rejected fail-closed (subclass/proxy-throw/hidden-key/symbol)', () => {
  const base = { ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS };

  // (a) Array subclass instance — Array.isArray true but prototype !== Array.prototype
  class WeirdArray extends Array {}
  const sub = new WeirdArray();
  sub.push('support');
  for (const fn of ALL_APIS) {
    assertInsufficient(fn({ ...base, failedRoles: sub }), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `subclass ${fn.name}`);
  }

  // (b) Proxy whose getPrototypeOf trap throws — structural hostility, never throws out
  const proxied = new Proxy(['support'], { getPrototypeOf() { throw new Error('boom'); } });
  for (const fn of ALL_APIS) {
    let out;
    assert.doesNotThrow(() => { out = fn({ ...base, failedRoles: proxied }); }, `proxy ${fn.name}`);
    assert.equal(out.status, READINESS_STATUS.INSUFFICIENT_DATA, `proxy ${fn.name} status`);
    assert.equal(out.reason, INSUFFICIENT_REASON.STRUCTURAL, `proxy ${fn.name} reason`);
  }

  // (c) hidden (non-enumerable) bogus own key — Object.keys would miss it, Reflect.ownKeys catches it
  const hidden = ['support'];
  Object.defineProperty(hidden, 'evil', { value: 1, enumerable: false });
  for (const fn of ALL_APIS) {
    assertInsufficient(fn({ ...base, failedRoles: hidden }), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `hidden ${fn.name}`);
  }

  // (d) symbol own key on the array
  const symmed = ['support'];
  symmed[Symbol('x')] = 'boom';
  for (const fn of ALL_APIS) {
    assertInsufficient(fn({ ...base, failedRoles: symmed }), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, `symbol ${fn.name}`);
  }
});

test('P1-2: hostile failedSlots object keys and per-role arrays rejected fail-closed', () => {
  const base = { ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS };

  // symbol key on the failedSlots object itself
  const symObj = {};
  symObj[Symbol('x')] = [0];
  assertInsufficient(classifyPoolFailure({ ...base, failedSlots: symObj }), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, 'sym-obj-key');

  // hidden (non-enumerable) bogus key on the failedSlots object
  const hiddenObj = {};
  Object.defineProperty(hiddenObj, 'support', { value: [0], enumerable: true });
  Object.defineProperty(hiddenObj, 'evil', { value: 1, enumerable: false });
  assertInsufficient(classifyPoolFailure({ ...base, failedSlots: hiddenObj }), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, 'hidden-obj-key');

  // per-role slot array is an Array subclass instance
  class WeirdArray extends Array {}
  const subSlots = new WeirdArray();
  subSlots.push(0);
  assertInsufficient(classifyPoolFailure({ ...base, failedSlots: { support: subSlots } }), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, 'sub-slot-array');

  // per-role slot array whose getPrototypeOf trap throws -> structural
  const proxiedSlot = new Proxy([0], { getPrototypeOf() { throw new Error('boom'); } });
  const outProxy = classifyPoolFailure({ ...base, failedSlots: { support: proxiedSlot } });
  assert.equal(outProxy.status, READINESS_STATUS.INSUFFICIENT_DATA);
  assert.equal(outProxy.reason, INSUFFICIENT_REASON.STRUCTURAL);

  // per-role slot array carrying a symbol key
  const slotArr = [0];
  slotArr[Symbol('y')] = 'boom';
  assertInsufficient(classifyPoolFailure({ ...base, failedSlots: { support: slotArr } }), INSUFFICIENT_REASON.INVALID_SELECTION_EVIDENCE, 'sym-slot-key');
});

// ============================================================
// P2 — every cause evidence shares one canonical fixed field set + key order
// ============================================================

test('P2: all cause evidence shapes share identical fixed key ordering', () => {
  const templateAbsent = classifyPoolFailure({ templateMatch: false }).evidence;
  const stock = classifyPoolFailure(withRole('hero', { vettedRelevant: 0, highRes: 0, cropSafe: 0 })).evidence;
  const crop = classifyPoolFailure(withRole('hero', { vettedRelevant: 5, highRes: 3, cropSafe: 0 })).evidence;
  const missGlobal = classifyPoolFailure({ ...HEALTHY, selectionAttempted: true, selectionFailed: true }).evidence;
  const missScoped = classifyPoolFailure({ ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS, failedSlots: { support: [0] } }).evidence;

  const expected = ['cause', 'templatePresent', 'offendingRoles', 'missScope', 'failedSlots', 'roles'];
  for (const [label, ev] of [
    ['TEMPLATE_ABSENT', templateAbsent],
    ['STOCK_SHORTAGE', stock],
    ['CROP_UNSAFE', crop],
    ['SELECTION_MISS/global', missGlobal],
    ['SELECTION_MISS/scoped', missScoped],
  ]) {
    assert.deepEqual(Object.keys(ev), expected, label);
  }

  // fixed-shape fields still carry cause-appropriate values
  assert.equal(templateAbsent.missScope, null);
  assert.equal(templateAbsent.failedSlots, null);
  assert.equal(templateAbsent.roles, null);
  assert.equal(stock.missScope, null);
  assert.equal(stock.failedSlots, null);
  assert.equal(crop.missScope, null);
  assert.equal(crop.failedSlots, null);
  assert.equal(missGlobal.missScope, 'GLOBAL');
  assert.equal(missGlobal.failedSlots, null);
  assert.equal(missScoped.missScope, 'SCOPED');
  assert.deepEqual(missScoped.failedSlots, { support: [0] });

  // assessSearchQuality evidence carries the same canonical key order
  const aMiss = assessSearchQuality({ ...HEALTHY, selectionOutcome: SELECTION_OUTCOME.MISS, failedRoles: ['hero'] }).evidence;
  assert.deepEqual(Object.keys(aMiss), expected, 'assessSearchQuality');
  const aAbsent = assessSearchQuality({ templateMatch: false }).evidence;
  assert.deepEqual(Object.keys(aAbsent), expected, 'assessSearchQuality/absent');
});
