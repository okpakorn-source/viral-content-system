// Deterministic tests for the Decision Evidence v1 core.
// Run WITHOUT node_modules:  node --test tests/decision-evidence.test.mjs
// Every assertion is deterministic (no time, no randomness, no IO).
//
// The module under test is a bare `.js` that uses ESM `export` syntax; Node's
// automatic module-syntax detection (runtime here is v24) loads it as an ES
// module, so this .mjs imports it with named ESM imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DECISION_EVIDENCE_VERSION,
  SCORING_SCHEMA_VERSION,
  SCORING_SCHEMA_MAX,
  MAX_ROWS,
  MAX_BYTES,
  SLOT_INDEX_MAX,
  BUILD_INPUT_HARD_MAX,
  TOTAL_ROWS_MAX,
  SLOT_ROLES,
  DECISION_REASONS,
  _buildDecisionEvidenceV1,
  _sanitizeDecisionEvidenceV1,
  _isUnsafeString,
  DECISION_EVIDENCE_VERSION_V2,
  DECISION_REASONS_V2,
  _buildDecisionEvidenceV2,
  _sanitizeDecisionEvidenceV2,
} from '../src/lib/decisionEvidence.js';

const enc = new TextEncoder();
const byteLen = (o) => enc.encode(JSON.stringify(o)).length;

// A minimal valid producer row. Default reason is best_score, which REQUIRES a
// score to be present (it "won on score"), so the default row carries one.
const row = (i, over = {}) => ({
  slotIndex: i,
  slot: 'support',
  reason: 'best_score',
  candidateCount: 3,
  candidateIndex: 1,
  score: 7,
  ...over,
});

// =========================================================================
// Constants / allowlists
// =========================================================================
test('version constant is 1', () => {
  assert.equal(DECISION_EVIDENCE_VERSION, 1);
});

test('scoring-schema version constant is 1 and bounded', () => {
  assert.equal(SCORING_SCHEMA_VERSION, 1);
  assert.ok(SCORING_SCHEMA_MAX >= SCORING_SCHEMA_VERSION);
});

test('allowlists are exactly the documented tokens', () => {
  assert.deepEqual([...SLOT_ROLES], ['hero', 'circle', 'support', 'template']);
  assert.deepEqual([...DECISION_REASONS], ['best_score', 'only_candidate', 'fallback', 'tie_break']);
});

// =========================================================================
// Happy path + round trip
// =========================================================================
test('valid carrier builds and round-trips through the sanitizer unchanged', () => {
  const built = _buildDecisionEvidenceV1([
    { slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 5, candidateIndex: 0, score: 8.5, margin: 1.25 },
    { slotIndex: 1, slot: 'circle', reason: 'only_candidate', candidateCount: 1, candidateIndex: 0 },
    { slotIndex: 2, slot: 'support', reason: 'tie_break', candidateCount: 4, candidateIndex: 2, tie: true, margin: 0 },
    { slotIndex: 3, slot: 'template', reason: 'fallback', candidateCount: 2, candidateIndex: 1 },
  ]);
  assert.notEqual(built, null);
  assert.equal(built.version, 1);
  assert.equal(built.scoringSchema, SCORING_SCHEMA_VERSION);
  assert.equal(built.totalRows, 4);
  assert.equal(built.emittedRows, 4);
  assert.equal(built.droppedRows, 0);
  assert.equal(built.capped, false);
  assert.equal(built.truncated, false);
  assert.equal(built.rows.length, 4);
  // idempotent: sanitizing the built carrier yields a deep-equal carrier
  const again = _sanitizeDecisionEvidenceV1(built);
  assert.deepEqual(again, built);
  // canonical key order + only allowlisted string tokens present
  assert.deepEqual(Object.keys(built.rows[0]), ['slotIndex', 'slot', 'reason', 'candidateCount', 'candidateIndex', 'score', 'margin']);
  assert.deepEqual(Object.keys(built), ['version', 'scoringSchema', 'totalRows', 'emittedRows', 'droppedRows', 'capped', 'truncated', 'rows']);
  assert.ok(byteLen(built) <= MAX_BYTES);
});

// =========================================================================
// IMMUTABILITY — deep-frozen carrier (carrier + rows array + each row)
// =========================================================================
test('builder returns a DEEP-FROZEN carrier (carrier + rows array + each row)', () => {
  const built = _buildDecisionEvidenceV1([row(0), row(1)]);
  assert.notEqual(built, null);
  assert.ok(Object.isFrozen(built));
  assert.ok(Object.isFrozen(built.rows));
  assert.ok(Object.isFrozen(built.rows[0]));
  assert.ok(Object.isFrozen(built.rows[1]));
});

test('sanitizer also returns a DEEP-FROZEN carrier', () => {
  const again = _sanitizeDecisionEvidenceV1(_buildDecisionEvidenceV1([row(0)]));
  assert.notEqual(again, null);
  assert.ok(Object.isFrozen(again));
  assert.ok(Object.isFrozen(again.rows));
  assert.ok(Object.isFrozen(again.rows[0]));
});

test('a consumer cannot mutate a returned carrier (strict-mode mutation throws)', () => {
  const built = _buildDecisionEvidenceV1([row(0)]);
  assert.throws(() => { built.totalRows = 999; }, TypeError);
  assert.throws(() => { built.brandNew = 1; }, TypeError);
  assert.throws(() => { built.rows.push(row(1)); }, TypeError);
  assert.throws(() => { built.rows[0] = row(9); }, TypeError);
  assert.throws(() => { built.rows[0].slot = 'circle'; }, TypeError);
  assert.throws(() => { delete built.rows[0].slot; }, TypeError);
  // observable state unchanged
  assert.equal(built.totalRows, 1);
  assert.equal(built.rows.length, 1);
  assert.equal(built.rows[0].slot, 'support');
});

// =========================================================================
// Privacy gate — every string must be an allowlisted token
// =========================================================================
test('URL-like string field => null', () => {
  const poisoned = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  poisoned.rows[0].slot = 'https://evil.example/x.jpg';
  assert.equal(_sanitizeDecisionEvidenceV1(poisoned), null);
  assert.equal(_isUnsafeString('https://evil.example/x.jpg'), true);
});

test('query-like string field => null', () => {
  const c = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  c.rows[0].reason = 'q=cat&safe=0';
  assert.equal(_sanitizeDecisionEvidenceV1(c), null);
  assert.equal(_isUnsafeString('q=cat&safe=0'), true);
});

test('base64 / data-URI-like string field => null', () => {
  const c1 = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  c1.rows[0].slot = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldY';
  assert.equal(_sanitizeDecisionEvidenceV1(c1), null);
  assert.equal(_isUnsafeString('QUJDREVGR0hJSktMTU5PUFFSU1RVVldY'), true);

  const c2 = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  c2.rows[0].reason = 'data:image/png;base64,iVBORw0KGgo';
  assert.equal(_sanitizeDecisionEvidenceV1(c2), null);
  assert.equal(_isUnsafeString('data:image/png;base64,iVBORw0KGgo'), true);
});

test('person-text-like string field (spaces / Thai / caps) => null', () => {
  const c1 = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  c1.rows[0].slot = 'John Doe';
  assert.equal(_sanitizeDecisionEvidenceV1(c1), null);
  assert.equal(_isUnsafeString('John Doe'), true);
  assert.equal(_isUnsafeString('ทราย'), true); // Thai name => unsafe
  assert.equal(_isUnsafeString('Hero'), true);  // capitalized => unsafe
});

test('unknown row key holding any string => null (strict key allowlist)', () => {
  const c = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  c.rows[0].note = 'hero'; // even an allowlisted token in an unknown key is rejected
  assert.equal(_sanitizeDecisionEvidenceV1(c), null);
});

test('unknown top-level key => null', () => {
  const c = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  c.extra = 1;
  assert.equal(_sanitizeDecisionEvidenceV1(c), null);
});

test('wrong-field allowlist token (reason token in slot) => null', () => {
  const c = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  c.rows[0].slot = 'best_score'; // a real allowlist token, but not a slot role
  assert.equal(_sanitizeDecisionEvidenceV1(c), null);
});

// =========================================================================
// BOUNDS — row cap, byte budget, totalRows ceiling
// =========================================================================
test('row cap: > MAX_ROWS valid rows => capped, truthfully tail-trimmed', () => {
  const rows = [];
  for (let i = 0; i < MAX_ROWS + 6; i++) rows.push(row(i));
  const built = _buildDecisionEvidenceV1(rows);
  assert.notEqual(built, null);
  assert.equal(built.totalRows, MAX_ROWS + 6);
  assert.equal(built.emittedRows, MAX_ROWS);
  assert.equal(built.droppedRows, 6);
  assert.equal(built.capped, true);
  assert.equal(built.truncated, false);
  assert.equal(built.rows[0].slotIndex, 0);
  assert.equal(built.rows[built.rows.length - 1].slotIndex, MAX_ROWS - 1);
  assert.deepEqual(_sanitizeDecisionEvidenceV1(built), built);
});

test('sanitizer rejects rows.length > MAX_ROWS BEFORE iterating rows (oversize)', () => {
  // A lying carrier: emittedRows within cap, but rows array holds MAX_ROWS+1
  // entries whose last is a throwing getter. The length check must fire first.
  let bombReads = 0;
  const rows = [];
  for (let i = 0; i < MAX_ROWS; i++) rows.push({ slotIndex: i, slot: 'support', reason: 'fallback', candidateCount: 1, candidateIndex: 0 });
  const bomb = {};
  Object.defineProperty(bomb, 'slotIndex', { enumerable: true, configurable: true, get() { bombReads++; throw new Error('boom'); } });
  rows.push(bomb); // rows.length === MAX_ROWS + 1
  const carrier = { version: 1, scoringSchema: 1, totalRows: MAX_ROWS + 1, emittedRows: MAX_ROWS, droppedRows: 1, capped: true, truncated: false, rows };
  assert.equal(_sanitizeDecisionEvidenceV1(carrier), null);
  assert.equal(bombReads, 0); // oversize rejected before any row was inspected
});

test('sanitizer bounds totalRows (> TOTAL_ROWS_MAX => null)', () => {
  const rows = [{ slotIndex: 0, slot: 'support', reason: 'fallback', candidateCount: 1, candidateIndex: 0 }];
  const carrier = { version: 1, scoringSchema: 1, totalRows: TOTAL_ROWS_MAX + 1, emittedRows: 1, droppedRows: TOTAL_ROWS_MAX, capped: true, truncated: true, rows };
  assert.equal(_sanitizeDecisionEvidenceV1(carrier), null);
});

test('byte-budget tail-trim => truncated true, consistent & within budget', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(row(i));
  const built = _buildDecisionEvidenceV1(rows, { maxBytes: 400 });
  assert.notEqual(built, null);
  assert.equal(built.totalRows, 10);
  assert.equal(built.capped, false);          // 10 <= MAX_ROWS
  assert.equal(built.truncated, true);        // byte budget forced a tail-trim
  assert.ok(built.emittedRows >= 1 && built.emittedRows < 10);
  assert.equal(built.droppedRows, 10 - built.emittedRows);
  assert.ok(byteLen(built) <= 400);           // actually within the squeezed budget
  assert.deepEqual(_sanitizeDecisionEvidenceV1(built), built);
});

test('byte seam cannot LOOSEN the 8 KiB ceiling (clamped)', () => {
  const built = _buildDecisionEvidenceV1([row(0)], { maxBytes: 10 * 1024 * 1024 });
  assert.notEqual(built, null);
  assert.ok(byteLen(built) <= MAX_BYTES);
});

test('impossibly tiny byte budget => null (cannot fit even one row)', () => {
  assert.equal(_buildDecisionEvidenceV1([row(0)], { maxBytes: 8 }), null);
});

// =========================================================================
// IMPOSSIBLE / INCONSISTENT TOTALS — must be truthful, else reject
// =========================================================================
test('inconsistent totals rejected (capped/truncated/dropped must be truthful)', () => {
  const mkRows = (n) => Array.from({ length: n }, (_, i) => ({ slotIndex: i, slot: 'support', reason: 'fallback', candidateCount: 1, candidateIndex: 0 }));
  const good = { version: 1, scoringSchema: 1, totalRows: 6, emittedRows: 4, droppedRows: 2, capped: false, truncated: true, rows: mkRows(4) };
  assert.notEqual(_sanitizeDecisionEvidenceV1(good), null);
  assert.equal(_sanitizeDecisionEvidenceV1({ ...good, truncated: false }), null); // claims no truncation but emitted < total
  assert.equal(_sanitizeDecisionEvidenceV1({ ...good, droppedRows: 5 }), null);   // dropped != total - emitted
  assert.equal(_sanitizeDecisionEvidenceV1({ ...good, capped: true }), null);     // total(6) !> cap => capped must be false
});

test('emittedRows must equal rows.length', () => {
  const rows = [{ slotIndex: 0, slot: 'support', reason: 'fallback', candidateCount: 1, candidateIndex: 0 }];
  const lying = { version: 1, scoringSchema: 1, totalRows: 2, emittedRows: 2, droppedRows: 0, capped: false, truncated: false, rows };
  assert.equal(_sanitizeDecisionEvidenceV1(lying), null); // emittedRows 2 but rows.length 1
});

// =========================================================================
// scoring-schema version field
// =========================================================================
test('missing scoringSchema top key => null', () => {
  const c = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  delete c.scoringSchema;
  assert.equal(_sanitizeDecisionEvidenceV1(c), null);
});

test('wrong version => null; out-of-bounds / wrong-typed scoringSchema => null', () => {
  const c = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  assert.equal(_sanitizeDecisionEvidenceV1({ ...c, version: 2 }), null);
  assert.equal(_sanitizeDecisionEvidenceV1({ ...c, scoringSchema: 0 }), null);   // below min
  assert.equal(_sanitizeDecisionEvidenceV1({ ...c, scoringSchema: SCORING_SCHEMA_MAX + 1 }), null); // above max
  assert.equal(_sanitizeDecisionEvidenceV1({ ...c, scoringSchema: '1' }), null); // wrong type
  assert.equal(_sanitizeDecisionEvidenceV1({ ...c, scoringSchema: 1.5 }), null); // non-integer
});

// =========================================================================
// HOSTILE INPUT — descriptor-only ingestion, getter/[[Get]] invoked 0 times
// =========================================================================
test('sanitizer: hostile accessor field in a row => null, getter invoked 0 times', () => {
  let getterCalls = 0;
  const evil = { slotIndex: 0, reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 5 };
  Object.defineProperty(evil, 'slot', { enumerable: true, configurable: true, get() { getterCalls++; return 'hero'; } });
  const carrier = { version: 1, scoringSchema: 1, totalRows: 1, emittedRows: 1, droppedRows: 0, capped: false, truncated: false, rows: [evil] };
  assert.equal(_sanitizeDecisionEvidenceV1(carrier), null);
  assert.equal(getterCalls, 0);
});

test('sanitizer: Proxy with throwing getPrototypeOf trap => null', () => {
  const inner = { version: 1, scoringSchema: 1, totalRows: 1, emittedRows: 1, droppedRows: 0, capped: false, truncated: false, rows: [] };
  const p = new Proxy(inner, { getPrototypeOf() { throw new Error('nope'); } });
  assert.equal(_sanitizeDecisionEvidenceV1(p), null);
});

test('sanitizer: top-level Proxy read via descriptors only — [[Get]] invoked 0 times', () => {
  let gets = 0;
  const inner = {
    version: 1, scoringSchema: 1, totalRows: 1, emittedRows: 1, droppedRows: 0, capped: false, truncated: false,
    rows: [{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 5 }],
  };
  const p = new Proxy(inner, { get(t, k, r) { gets++; return Reflect.get(t, k, r); } });
  _sanitizeDecisionEvidenceV1(p); // result value irrelevant here
  assert.equal(gets, 0);
});

test('sanitizer: exotic prototype (class instance) => null', () => {
  class Weird { constructor() { this.version = 1; this.scoringSchema = 1; this.totalRows = 1; this.emittedRows = 1; this.droppedRows = 0; this.capped = false; this.truncated = false; this.rows = []; } }
  assert.equal(_sanitizeDecisionEvidenceV1(new Weird()), null);
});

test('sanitizer: Object.create inherited row field is NOT honored (proto rejected)', () => {
  const proto = { candidateCount: 2 };
  const inheritedRow = Object.create(proto); // candidateCount lives on the prototype, not own
  inheritedRow.slotIndex = 0;
  inheritedRow.slot = 'hero';
  inheritedRow.reason = 'best_score';
  inheritedRow.candidateIndex = 0;
  inheritedRow.score = 5;
  const carrier = { version: 1, scoringSchema: 1, totalRows: 1, emittedRows: 1, droppedRows: 0, capped: false, truncated: false, rows: [inheritedRow] };
  assert.equal(_sanitizeDecisionEvidenceV1(carrier), null);
});

test('sanitizer: symbol own key on a row => null', () => {
  const c = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  c.rows[0][Symbol('x')] = 1; // structuredClone drops symbols, so add AFTER cloning
  assert.equal(_sanitizeDecisionEvidenceV1(c), null);
});

// ---- the EXPORTED BUILDER is hardened identically (descriptor-only) ----
test('builder: accessor row field => null, getter invoked 0 times', () => {
  let calls = 0;
  const r = { slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 5 };
  Object.defineProperty(r, 'margin', { enumerable: true, configurable: true, get() { calls++; throw new Error('boom'); } });
  assert.equal(_buildDecisionEvidenceV1([r]), null);
  assert.equal(calls, 0);
});

test('builder: accessor array index => null, getter invoked 0 times', () => {
  let calls = 0;
  const arr = [];
  Object.defineProperty(arr, 0, { enumerable: true, configurable: true, get() { calls++; throw new Error('boom'); } });
  assert.equal(arr.length, 1);
  assert.equal(_buildDecisionEvidenceV1(arr), null);
  assert.equal(calls, 0);
});

test('builder: accessor limits.maxBytes => null, getter invoked 0 times', () => {
  let calls = 0;
  const limits = {};
  Object.defineProperty(limits, 'maxBytes', { enumerable: true, configurable: true, get() { calls++; return 320; } });
  assert.equal(_buildDecisionEvidenceV1([row(0)], limits), null);
  assert.equal(calls, 0);
});

test('builder reads a Proxy array via descriptors — [[Get]] invoked 0 times', () => {
  let gets = 0;
  const target = [{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 5 }];
  const p = new Proxy(target, { get(t, k, r) { gets++; return Reflect.get(t, k, r); } });
  const built = _buildDecisionEvidenceV1(p);
  assert.notEqual(built, null);      // descriptor reads still succeed
  assert.equal(built.rows[0].slot, 'hero');
  assert.equal(gets, 0);             // ordinary member access never used on the input
});

test('builder rejects oversize input length BEFORE touching any index', () => {
  let idxTouches = 0;
  const target = new Array(BUILD_INPUT_HARD_MAX + 1); // sparse, length 4097
  const p = new Proxy(target, {
    getOwnPropertyDescriptor(t, k) {
      if (typeof k === 'string' && /^[0-9]+$/.test(k)) idxTouches++;
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
  });
  assert.equal(_buildDecisionEvidenceV1(p), null);
  assert.equal(idxTouches, 0); // rejected on the length check; no index descriptor read
});

test('builder rejects an exotic array subclass', () => {
  class MyArr extends Array {}
  const a = new MyArr();
  a.push({ slotIndex: 0, slot: 'hero', reason: 'fallback', candidateCount: 1, candidateIndex: 0 });
  assert.equal(_buildDecisionEvidenceV1(a), null); // proto !== Array.prototype
});

test('builder rejects a sparse input array (hole => reject)', () => {
  const a = [];
  a[0] = { slotIndex: 0, slot: 'hero', reason: 'fallback', candidateCount: 1, candidateIndex: 0 };
  a[2] = { slotIndex: 2, slot: 'circle', reason: 'fallback', candidateCount: 1, candidateIndex: 0 }; // index 1 is a hole
  assert.equal(_buildDecisionEvidenceV1(a), null);
});

test('builder rejects a row with an exotic prototype', () => {
  const proto = { candidateCount: 2 };
  const r = Object.create(proto);
  r.slotIndex = 0; r.slot = 'hero'; r.reason = 'fallback'; r.candidateIndex = 0;
  assert.equal(_buildDecisionEvidenceV1([r]), null);
});

test('builder rejects an exotic-proto limits object', () => {
  class L { constructor() { this.maxBytes = 320; } }
  assert.equal(_buildDecisionEvidenceV1([row(0)], new L()), null);
});

test('builder rejects a non-number maxBytes data value; empty limits uses default', () => {
  assert.equal(_buildDecisionEvidenceV1([row(0)], { maxBytes: '320' }), null);
  assert.notEqual(_buildDecisionEvidenceV1([row(0)], {}), null); // no maxBytes => default budget
});

// =========================================================================
// DUPLICATE / CONFLICTING primary keys — fail-closed, no silent first-win
// =========================================================================
test('builder rejects a duplicate slotIndex (fail-closed, no silent first-win)', () => {
  assert.equal(_buildDecisionEvidenceV1([
    { slotIndex: 2, slot: 'support', reason: 'fallback', candidateCount: 1, candidateIndex: 0 },
    { slotIndex: 0, slot: 'hero', reason: 'fallback', candidateCount: 1, candidateIndex: 0 },
    { slotIndex: 2, slot: 'circle', reason: 'fallback', candidateCount: 1, candidateIndex: 0 }, // duplicate slotIndex 2
  ]), null);
});

test('builder sorts unique rows ascending by slotIndex (drops nothing)', () => {
  const built = _buildDecisionEvidenceV1([
    { slotIndex: 2, slot: 'support', reason: 'fallback', candidateCount: 1, candidateIndex: 0 },
    { slotIndex: 0, slot: 'hero', reason: 'fallback', candidateCount: 1, candidateIndex: 0 },
    { slotIndex: 1, slot: 'circle', reason: 'fallback', candidateCount: 1, candidateIndex: 0 },
  ]);
  assert.notEqual(built, null);
  assert.equal(built.totalRows, 3);
  assert.deepEqual(built.rows.map((r) => r.slotIndex), [0, 1, 2]);
});

test('sanitizer: duplicate slotIndex in a raw carrier => null', () => {
  const dup = {
    version: 1, scoringSchema: 1, totalRows: 2, emittedRows: 2, droppedRows: 0, capped: false, truncated: false,
    rows: [
      { slotIndex: 0, slot: 'hero', reason: 'fallback', candidateCount: 1, candidateIndex: 0 },
      { slotIndex: 0, slot: 'circle', reason: 'fallback', candidateCount: 1, candidateIndex: 0 },
    ],
  };
  assert.equal(_sanitizeDecisionEvidenceV1(dup), null);
});

test('sanitizer: out-of-order slotIndex in a raw carrier => null', () => {
  const unsorted = {
    version: 1, scoringSchema: 1, totalRows: 2, emittedRows: 2, droppedRows: 0, capped: false, truncated: false,
    rows: [
      { slotIndex: 5, slot: 'hero', reason: 'fallback', candidateCount: 1, candidateIndex: 0 },
      { slotIndex: 2, slot: 'circle', reason: 'fallback', candidateCount: 1, candidateIndex: 0 },
    ],
  };
  assert.equal(_sanitizeDecisionEvidenceV1(unsorted), null);
});

// =========================================================================
// REASON-SPECIFIC INVARIANTS — positive + negative for every reason
// =========================================================================
test('reason invariant — only_candidate (positive + negatives)', () => {
  assert.notEqual(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'only_candidate', candidateCount: 1, candidateIndex: 0 }]), null);
  assert.notEqual(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'only_candidate', candidateCount: 1, candidateIndex: 0, score: 9 }]), null); // its own score allowed
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'only_candidate', candidateCount: 3, candidateIndex: 0 }]), null); // candidateCount must be 1
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'only_candidate', candidateCount: 1, candidateIndex: 0, margin: 0 }]), null); // no margin (no runner-up)
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'only_candidate', candidateCount: 1, candidateIndex: 0, tie: true }]), null); // a lone candidate cannot tie
});

test('reason invariant — best_score (positive + negatives)', () => {
  assert.notEqual(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 8 }]), null);
  assert.notEqual(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 8, margin: 1.5 }]), null);
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 1, candidateIndex: 0, score: 8 }]), null); // needs >= 2 candidates
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0 }]), null); // must carry a score
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 8, tie: true }]), null); // a true tie would be tie_break
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 8, margin: 0 }]), null); // margin, if present, must be > 0
});

test('reason invariant — tie_break (positive + negatives)', () => {
  assert.notEqual(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, tie: true, margin: 0 }]), null);
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, margin: 0 }]), null); // tie:true required
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, tie: false, margin: 0 }]), null); // tie must be true
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, tie: true }]), null); // margin required
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, tie: true, margin: 3 }]), null); // margin must be exactly 0
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 1, candidateIndex: 0, tie: true, margin: 0 }]), null); // needs >= 2 candidates
});

test('reason invariant — fallback (positive + negatives)', () => {
  assert.notEqual(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'template', reason: 'fallback', candidateCount: 1, candidateIndex: 0 }]), null);
  assert.notEqual(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'template', reason: 'fallback', candidateCount: 3, candidateIndex: 2, score: 4 }]), null); // a score is allowed
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'template', reason: 'fallback', candidateCount: 2, candidateIndex: 0, tie: true }]), null); // not a tie resolution
  assert.equal(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'template', reason: 'fallback', candidateCount: 2, candidateIndex: 0, margin: 1 }]), null); // not a margin-based win
});

test('sanitizer rejects a row that violates its reason invariant (poisoned carrier)', () => {
  const c = structuredClone(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'support', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, tie: true, margin: 0 }]));
  delete c.rows[0].tie; // tie_break with no tie => invalid
  assert.equal(_sanitizeDecisionEvidenceV1(c), null);
  const c2 = structuredClone(_buildDecisionEvidenceV1([{ slotIndex: 0, slot: 'support', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, tie: true, margin: 0 }]));
  c2.rows[0].margin = 4; // margin must be exactly 0
  assert.equal(_sanitizeDecisionEvidenceV1(c2), null);
});

// =========================================================================
// Numeric validation / no cross-type coercion
// =========================================================================
test('numeric validation: candidateIndex >= candidateCount => null; NaN/Infinity/neg => null', () => {
  assert.equal(_buildDecisionEvidenceV1([row(0, { candidateCount: 3, candidateIndex: 3 })]), null);
  const c = structuredClone(_buildDecisionEvidenceV1([row(0, { score: 1 })]));
  c.rows[0].score = Number.POSITIVE_INFINITY;
  assert.equal(_sanitizeDecisionEvidenceV1(c), null);
  const c2 = structuredClone(_buildDecisionEvidenceV1([row(0, { score: 1, margin: 1 })]));
  c2.rows[0].margin = -0.5; // negative margin
  assert.equal(_sanitizeDecisionEvidenceV1(c2), null);
});

test('string-typed number (privacy: no cross-type coercion) => null', () => {
  const c = structuredClone(_buildDecisionEvidenceV1([row(0)]));
  c.rows[0].candidateCount = '3'; // string in a numeric field
  assert.equal(_sanitizeDecisionEvidenceV1(c), null);
});

test('bad inputs to builder => null', () => {
  assert.equal(_buildDecisionEvidenceV1(null), null);
  assert.equal(_buildDecisionEvidenceV1('nope'), null);
  assert.equal(_buildDecisionEvidenceV1({ length: 1, 0: row(0) }), null); // array-like, not a real array
  assert.equal(_buildDecisionEvidenceV1([]), null);        // no rows
  assert.equal(_buildDecisionEvidenceV1([{}]), null);       // no valid rows
  assert.equal(_buildDecisionEvidenceV1([row(0, { slotIndex: SLOT_INDEX_MAX })]), null); // slotIndex out of range
});

// =========================================================================
// v2 COEXISTENCE — v2 lives ALONGSIDE v1; neither accepts the other's carrier,
// and each keeps the full privacy/bounds/immutability/fail-closed guarantees.
// =========================================================================

// A minimal valid v2 producer row using a v2-only truthful final reason.
const v2row = (i, over = {}) => ({
  slotIndex: i,
  slot: 'support',
  reason: 'llm_pick', // v2-only reason: NO score/margin/tie
  candidateCount: 5,
  candidateIndex: 2,
  ...over,
});

test('v2 version + reason allowlist constants', () => {
  assert.equal(DECISION_EVIDENCE_VERSION_V2, 2);
  assert.deepEqual([...DECISION_REASONS_V2], [
    'llm_pick', 'policy_override', 'story_rescue', 'best_score', 'only_candidate', 'fallback', 'tie_break',
  ]);
});

test('v2 builds a carrier with the new truthful final reasons (no fabricated numeric)', () => {
  const built = _buildDecisionEvidenceV2([
    { slotIndex: 0, slot: 'hero', reason: 'llm_pick', candidateCount: 6, candidateIndex: 3 },
    { slotIndex: 1, slot: 'circle', reason: 'policy_override', candidateCount: 4, candidateIndex: 1 },
    { slotIndex: 2, slot: 'support', reason: 'story_rescue', candidateCount: 5, candidateIndex: 2 },
    { slotIndex: 3, slot: 'template', reason: 'fallback', candidateCount: 2, candidateIndex: 1 },
    { slotIndex: 4, slot: 'support', reason: 'best_score', candidateCount: 3, candidateIndex: 0, score: 8, margin: 1.5, tie: false },
    { slotIndex: 5, slot: 'support', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, score: 6, tie: true, margin: 0 },
    { slotIndex: 6, slot: 'support', reason: 'only_candidate', candidateCount: 1, candidateIndex: 0 },
  ]);
  assert.notEqual(built, null);
  assert.equal(built.version, 2);
  assert.equal(built.rows.length, 7);
  assert.deepEqual(built.rows.map((r) => r.reason), [
    'llm_pick', 'policy_override', 'story_rescue', 'fallback', 'best_score', 'tie_break', 'only_candidate',
  ]);
  // idempotent through the v2 sanitizer
  assert.deepEqual(_sanitizeDecisionEvidenceV2(built), built);
  // deep-frozen like v1
  assert.ok(Object.isFrozen(built) && Object.isFrozen(built.rows) && Object.isFrozen(built.rows[0]));
  assert.ok(byteLen(built) <= MAX_BYTES);
});

test('v2 truthful final reasons FORBID score/margin/tie (no fake numeric)', () => {
  assert.equal(_buildDecisionEvidenceV2([v2row(0, { score: 9 })]), null);
  assert.equal(_buildDecisionEvidenceV2([v2row(0, { margin: 1 })]), null);
  assert.equal(_buildDecisionEvidenceV2([v2row(0, { tie: true })]), null);
  assert.equal(_buildDecisionEvidenceV2([v2row(0, { reason: 'policy_override', score: 5 })]), null);
  assert.equal(_buildDecisionEvidenceV2([v2row(0, { reason: 'story_rescue', margin: 0 })]), null);
});

test('v2 solver-style reasons ENFORCE FULL explicit provenance', () => {
  // best_score full provenance: score present + margin>0 + tie:false present.
  assert.notEqual(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 8, margin: 1.5, tie: false }]), null);
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0 }]), null); // no score
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 8, tie: false }]), null); // no margin
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 8, margin: 1.5 }]), null); // no tie
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 8, margin: 0, tie: false }]), null); // margin must be > 0
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'best_score', candidateCount: 2, candidateIndex: 0, score: 8, margin: 1.5, tie: true }]), null); // tie must be false
  // tie_break full provenance: score present + margin:0 + tie:true present.
  assert.notEqual(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, score: 6, tie: true, margin: 0 }]), null);
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, tie: true, margin: 0 }]), null); // no score
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, score: 6, tie: true, margin: 3 }]), null); // margin must be 0
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, score: 6, margin: 0 }]), null); // no tie
  // only_candidate must have candidateCount 1
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'only_candidate', candidateCount: 2, candidateIndex: 0 }]), null);
});

test('v2 DIRECT BUILDER: fallback FORBIDS score/margin/tie; core matches the producer', () => {
  // fallback carrying a score => rejected (heuristic default is NOT a scored win)
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'template', reason: 'fallback', candidateCount: 2, candidateIndex: 1, score: 4 }]), null);
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'template', reason: 'fallback', candidateCount: 2, candidateIndex: 1, margin: 1 }]), null);
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'template', reason: 'fallback', candidateCount: 2, candidateIndex: 1, tie: false }]), null);
  // a clean fallback (no numeric) is accepted
  assert.notEqual(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'template', reason: 'fallback', candidateCount: 2, candidateIndex: 1 }]), null);
});

test('v2 DIRECT BUILDER: tie_break row missing score => rejected', () => {
  assert.equal(_buildDecisionEvidenceV2([{ slotIndex: 0, slot: 'hero', reason: 'tie_break', candidateCount: 2, candidateIndex: 0, tie: true, margin: 0 }]), null);
});

test('VERSION ISOLATION: v1 sanitizer rejects a v2 carrier; v2 sanitizer rejects a v1 carrier', () => {
  const v2 = _buildDecisionEvidenceV2([v2row(0)]);
  const v1 = _buildDecisionEvidenceV1([row(0)]);
  assert.notEqual(v2, null);
  assert.notEqual(v1, null);
  assert.equal(v2.version, 2);
  assert.equal(v1.version, 1);
  assert.equal(_sanitizeDecisionEvidenceV1(v2), null); // v1 rejects version 2
  assert.equal(_sanitizeDecisionEvidenceV2(v1), null); // v2 rejects version 1
});

test('REASON ISOLATION: v1 rejects a v2-only reason even if version is coerced to 1', () => {
  const c = structuredClone(_buildDecisionEvidenceV2([v2row(0)]));
  c.version = 1; // pretend it is a v1 carrier
  assert.equal(_sanitizeDecisionEvidenceV1(c), null); // llm_pick is not a v1 reason
});

test('v2 keeps privacy/immutability/hostile-input guarantees', () => {
  // privacy: a URL in a string field => null
  const poisoned = structuredClone(_buildDecisionEvidenceV2([v2row(0)]));
  poisoned.rows[0].slot = 'https://evil.example/x.jpg';
  assert.equal(_sanitizeDecisionEvidenceV2(poisoned), null);
  // immutability: cannot mutate a returned v2 carrier
  const built = _buildDecisionEvidenceV2([v2row(0)]);
  assert.throws(() => { built.rows[0].reason = 'best_score'; }, TypeError);
  // hostile accessor field, getter invoked 0 times
  let calls = 0;
  const evil = { slotIndex: 0, reason: 'llm_pick', candidateCount: 2, candidateIndex: 0 };
  Object.defineProperty(evil, 'slot', { enumerable: true, configurable: true, get() { calls++; return 'hero'; } });
  const carrier = { version: 2, scoringSchema: 1, totalRows: 1, emittedRows: 1, droppedRows: 0, capped: false, truncated: false, rows: [evil] };
  assert.equal(_sanitizeDecisionEvidenceV2(carrier), null);
  assert.equal(calls, 0);
});

test('v2 bounds: row cap + byte budget behave like v1', () => {
  const rows = [];
  for (let i = 0; i < MAX_ROWS + 4; i++) rows.push(v2row(i));
  const built = _buildDecisionEvidenceV2(rows);
  assert.notEqual(built, null);
  assert.equal(built.totalRows, MAX_ROWS + 4);
  assert.equal(built.emittedRows, MAX_ROWS);
  assert.equal(built.capped, true);
  // byte seam cannot loosen the 8 KiB ceiling
  const big = _buildDecisionEvidenceV2([v2row(0)], { maxBytes: 10 * 1024 * 1024 });
  assert.ok(byteLen(big) <= MAX_BYTES);
});
