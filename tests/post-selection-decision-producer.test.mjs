// Deterministic tests for the Post-Selection Decision Producer.
// Run WITHOUT node_modules:  node --test tests/post-selection-decision-producer.test.mjs
// Every assertion is deterministic (no time, no randomness, no IO).
//
// The modules under test are bare `.js` files that use ESM `export`; Node's
// automatic module-syntax detection (runtime here is v24) loads them as ES
// modules, so this .mjs imports them with named ESM imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { produceFinalDecisionEvidence } from '../src/lib/postSelectionDecisionProducer.js';
import { _sanitizeDecisionEvidenceV2 } from '../src/lib/decisionEvidence.js';

// --- trace builders -------------------------------------------------------
const slotTrace = (over = {}) => ({
  slotIndex: 0,
  slot: 'hero',
  stage: 'llm',
  candidateCount: 5,
  chosenIndex: 2,
  ...over,
});
const trace = (slots, over = {}) => ({
  version: 2,
  slotCount: slots.length,
  slots,
  ...over,
});
const ok = (r) => { assert.equal(r.decisionComplete, true); assert.notEqual(r.evidence, null); return r.evidence; };
const incomplete = (r) => { assert.equal(r.decisionComplete, false); assert.equal(r.evidence, null); };

// =========================================================================
// CORE TRUTHFULNESS — LLM pick is not a scored/fallback win
// =========================================================================
test('an LLM pick with NO score is labeled llm_pick — never best_score or fallback', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([slotTrace({ candidateCount: 5, chosenIndex: 2 })])));
  const row = ev.rows[0];
  assert.equal(row.reason, 'llm_pick');
  assert.notEqual(row.reason, 'best_score');
  assert.notEqual(row.reason, 'fallback');
  assert.equal('score' in row, false);
  assert.equal('margin' in row, false);
  assert.equal('tie' in row, false);
  assert.equal(ev.version, 2);
});

test('an llm stage carrying a fabricated score => incomplete (no fake numeric)', () => {
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ score: 9 })])));
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ margin: 1 })])));
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ tie: true })])));
});

// =========================================================================
// SOLVER-vs-FINAL MISMATCH + circle-alt outside top3
// =========================================================================
test('solver-vs-final mismatch: the FINAL (llm) stage wins, not a solver top pick', () => {
  // The solver's top would have been index 0; the final LLM pick is index 4.
  // The producer reads only the explicit final trace => llm_pick at index 4.
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'circle', stage: 'llm', candidateCount: 6, chosenIndex: 4 }),
  ])));
  assert.equal(ev.rows[0].reason, 'llm_pick');
  assert.equal(ev.rows[0].candidateIndex, 4);
  assert.equal('score' in ev.rows[0], false);
});

test('a circle-alt chosen OUTSIDE the top3 is represented at its true index', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'circle', stage: 'policy_override', candidateCount: 9, chosenIndex: 7 }),
  ])));
  assert.equal(ev.rows[0].reason, 'policy_override');
  assert.equal(ev.rows[0].candidateIndex, 7); // outside any top3
});

// =========================================================================
// candidateCount is REAL — never top3.length
// =========================================================================
test('a >3-candidate pool yields the REAL candidateCount, never top3.length (3)', () => {
  for (const n of [4, 8, 25, 1000]) {
    const ev = ok(produceFinalDecisionEvidence(trace([
      slotTrace({ candidateCount: n, chosenIndex: 1 }),
    ])));
    assert.equal(ev.rows[0].candidateCount, n);
    assert.notEqual(ev.rows[0].candidateCount, 3);
  }
});

// =========================================================================
// ROUNDED-EQUALITY IS NOT A TIE
// =========================================================================
test('near-equal solver scores with explicit tie:false are best_score, not tie_break', () => {
  // margin is a tiny but real gap (rounds to ~0) with tie EXPLICITLY false — must
  // stay best_score, margin preserved (rounded equality is never guessed as a tie).
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 3, chosenIndex: 0, score: 7.0004, margin: 0.0004, tie: false }),
  ])));
  assert.equal(ev.rows[0].reason, 'best_score');
  assert.notEqual(ev.rows[0].reason, 'tie_break');
  assert.equal(ev.rows[0].margin, 0.0004); // real gap preserved, not collapsed to 0
  assert.equal(ev.rows[0].score, 7.0004);
  assert.equal(ev.rows[0].tie, false);     // full provenance carried explicitly
});

test('a genuine tie requires explicit tie:true AND margin:0 AND a real score (full provenance)', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 2, chosenIndex: 0, score: 6, tie: true, margin: 0 }),
  ])));
  assert.equal(ev.rows[0].reason, 'tie_break');
  assert.equal(ev.rows[0].tie, true);
  assert.equal(ev.rows[0].margin, 0);
  assert.equal(ev.rows[0].score, 6);
});

test('a "tie" claimed with a non-zero (rounded) margin cannot sneak through => incomplete', () => {
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 2, chosenIndex: 0, score: 6, tie: true, margin: 0.3 }),
  ])));
  // tie:false with margin:0 is not a best_score either — full provenance is missing
  // (no score, and margin must be > 0) => incomplete, never silently promoted.
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 2, chosenIndex: 0, tie: false, margin: 0 }),
  ])));
});

// =========================================================================
// SOLVER provenance reasons (only with EXACT provenance)
// =========================================================================
test('solver only_candidate (candidateCount 1, index 0)', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 1, chosenIndex: 0 }),
  ])));
  assert.equal(ev.rows[0].reason, 'only_candidate');
});

test('solver best_score REQUIRES full provenance (score + margin>0 + tie:false)', () => {
  ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 3, chosenIndex: 1, score: 8, margin: 1.2, tie: false }),
  ])));
  // missing score => incomplete
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 3, chosenIndex: 1, margin: 1.2, tie: false }),
  ])));
  // missing margin => incomplete (margin REQUIRED, must be > 0)
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 3, chosenIndex: 1, score: 8, tie: false }),
  ])));
  // missing tie => incomplete (tie REQUIRED, never inferred)
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 3, chosenIndex: 1, score: 8, margin: 1.2 }),
  ])));
  // best_score margin must be a real gap (>0)
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'solver', candidateCount: 3, chosenIndex: 1, score: 8, margin: 0, tie: false }),
  ])));
});

// =========================================================================
// HERO OVERRIDE / STORY RESCUE reflected as the TRUTHFUL final primary
// =========================================================================
test('hero-size / solo-face override reflected as policy_override at the final index', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'hero', stage: 'policy_override', candidateCount: 4, chosenIndex: 2 }),
  ])));
  assert.equal(ev.rows[0].slot, 'hero');
  assert.equal(ev.rows[0].reason, 'policy_override');
  assert.equal(ev.rows[0].candidateIndex, 2);
  assert.equal('score' in ev.rows[0], false);
});

test('story-fit rescue reflected as story_rescue at the final index', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'support', stage: 'story_rescue', candidateCount: 5, chosenIndex: 3 }),
  ])));
  assert.equal(ev.rows[0].reason, 'story_rescue');
  assert.equal(ev.rows[0].candidateIndex, 3);
  assert.equal('margin' in ev.rows[0], false);
});

test('fallback stage => fallback reason, no numeric', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slot: 'template', stage: 'fallback', candidateCount: 2, chosenIndex: 1 }),
  ])));
  assert.equal(ev.rows[0].reason, 'fallback');
  assert.equal('score' in ev.rows[0], false);
});

// =========================================================================
// MULTI-SLOT full arbitration (mixed stages) — every slot represented
// =========================================================================
test('a full mixed-stage arbitration produces one truthful row per final slot', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slotIndex: 0, slot: 'hero', stage: 'policy_override', candidateCount: 6, chosenIndex: 3 }),
    slotTrace({ slotIndex: 1, slot: 'circle', stage: 'llm', candidateCount: 5, chosenIndex: 4 }),
    slotTrace({ slotIndex: 2, slot: 'support', stage: 'story_rescue', candidateCount: 7, chosenIndex: 2 }),
    slotTrace({ slotIndex: 3, slot: 'template', stage: 'fallback', candidateCount: 2, chosenIndex: 1 }),
    slotTrace({ slotIndex: 4, slot: 'support', stage: 'solver', candidateCount: 4, chosenIndex: 0, score: 6.5, margin: 0.75, tie: false }),
  ])));
  assert.equal(ev.totalRows, 5);
  assert.equal(ev.emittedRows, 5);
  assert.equal(ev.droppedRows, 0);
  assert.equal(ev.capped, false);
  assert.equal(ev.truncated, false);
  assert.deepEqual(ev.rows.map((r) => r.reason), ['policy_override', 'llm_pick', 'story_rescue', 'fallback', 'best_score']);
  assert.deepEqual(ev.rows.map((r) => r.slotIndex), [0, 1, 2, 3, 4]);
});

// =========================================================================
// COMPLETENESS — a missing stage / missing slot => incomplete => null
// =========================================================================
test('a missing arbitration stage => incomplete => null (never a partial carrier)', () => {
  const slots = [
    slotTrace({ slotIndex: 0, slot: 'hero', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    { slotIndex: 1, slot: 'circle', candidateCount: 3, chosenIndex: 0 }, // no `stage`
  ];
  incomplete(produceFinalDecisionEvidence(trace(slots)));
});

test('declared slotCount but fewer slot entries => incomplete', () => {
  incomplete(produceFinalDecisionEvidence({
    version: 2, slotCount: 3, slots: [slotTrace({ slotIndex: 0 }), slotTrace({ slotIndex: 1 })],
  }));
});

test('declared slotCount but MORE slot entries => incomplete', () => {
  incomplete(produceFinalDecisionEvidence({
    version: 2, slotCount: 1, slots: [slotTrace({ slotIndex: 0 }), slotTrace({ slotIndex: 1 })],
  }));
});

test('an incomplete solver stage (missing chosenIndex) => incomplete', () => {
  const em = { slotIndex: 0, slot: 'support', stage: 'solver', candidateCount: 3 };
  incomplete(produceFinalDecisionEvidence(trace([em])));
});

// =========================================================================
// COMPLETENESS = DENSE INDEX SET — the observed final slotIndex set MUST equal
// the dense range 0..slotCount-1, not merely a unique set of the right size.
// =========================================================================
test('slotCount=2 with indices {0,2} (right cardinality, wrong set) => incomplete/null', () => {
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slotIndex: 0, slot: 'hero', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 2, slot: 'circle', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
  ])));
});

test('an index >= slotCount (oversize) => incomplete/null', () => {
  // slotCount=3, indices {0,1,5}: cardinality matches but 5 is out of the dense range.
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slotIndex: 0, slot: 'hero', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 1, slot: 'circle', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 5, slot: 'support', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
  ])));
});

test('a duplicate index (dense-set violation) => incomplete/null', () => {
  // slotCount=2, indices {1,1}: duplicate primary key => not the dense set {0,1}.
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slotIndex: 1, slot: 'hero', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 1, slot: 'circle', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
  ])));
});

test('a missing index (hole in the dense set) => incomplete/null', () => {
  // slotCount=4, indices {0,1,2,4}: index 3 is missing from the dense range.
  incomplete(produceFinalDecisionEvidence(trace([
    slotTrace({ slotIndex: 0, slot: 'hero', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 1, slot: 'circle', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 2, slot: 'support', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 4, slot: 'template', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
  ])));
});

test('the dense range 0..slotCount-1 (in any order) => complete', () => {
  // Positive control: exactly {0,1,2} present => decisionComplete with every slot.
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slotIndex: 2, slot: 'support', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 0, slot: 'hero', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 1, slot: 'circle', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
  ])));
  assert.deepEqual(ev.rows.map((r) => r.slotIndex), [0, 1, 2]);
  assert.equal(ev.emittedRows, 3);
});

// =========================================================================
// PARTIAL-CARRIER GUARD — a byte squeeze that would drop a slot => incomplete
// =========================================================================
test('a byte budget too small to hold every slot => incomplete, never partial', () => {
  const slots = [];
  for (let i = 0; i < 6; i++) slots.push(slotTrace({ slotIndex: i, slot: 'support', stage: 'llm', candidateCount: 3, chosenIndex: 0 }));
  // A generous budget keeps all slots.
  const full = ok(produceFinalDecisionEvidence(trace(slots)));
  assert.equal(full.emittedRows, 6);
  // A tiny budget would truncate — the producer must fail closed, not emit a partial carrier.
  incomplete(produceFinalDecisionEvidence(trace(slots), { maxBytes: 300 }));
});

// =========================================================================
// DETERMINISM
// =========================================================================
test('deterministic: same trace => byte-identical result', () => {
  const t = trace([
    slotTrace({ slotIndex: 0, slot: 'hero', stage: 'policy_override', candidateCount: 6, chosenIndex: 3 }),
    slotTrace({ slotIndex: 1, slot: 'support', stage: 'solver', candidateCount: 4, chosenIndex: 0, score: 6.5, margin: 0.75, tie: false }),
  ]);
  const a = produceFinalDecisionEvidence(t);
  const b = produceFinalDecisionEvidence(t);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a.evidence), JSON.stringify(b.evidence));
});

test('slot entries in any order are emitted ascending by slotIndex (deterministic)', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slotIndex: 2, slot: 'support', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 0, slot: 'hero', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
    slotTrace({ slotIndex: 1, slot: 'circle', stage: 'llm', candidateCount: 3, chosenIndex: 0 }),
  ])));
  assert.deepEqual(ev.rows.map((r) => r.slotIndex), [0, 1, 2]);
});

// =========================================================================
// IMMUTABILITY — result + evidence deep-frozen
// =========================================================================
test('result and evidence are deep-frozen; mutation throws', () => {
  const r = produceFinalDecisionEvidence(trace([slotTrace()]));
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.evidence));
  assert.ok(Object.isFrozen(r.evidence.rows));
  assert.ok(Object.isFrozen(r.evidence.rows[0]));
  assert.throws(() => { r.decisionComplete = false; }, TypeError);
  assert.throws(() => { r.evidence.rows[0].reason = 'best_score'; }, TypeError);
  assert.throws(() => { r.evidence.rows.push({}); }, TypeError);
});

test('the incomplete sentinel is a frozen { decisionComplete:false, evidence:null }', () => {
  const r = produceFinalDecisionEvidence(null);
  assert.deepEqual(r, { decisionComplete: false, evidence: null });
  assert.ok(Object.isFrozen(r));
});

// =========================================================================
// BOUNDS
// =========================================================================
test('slotCount above the row cap => incomplete', () => {
  const slots = [];
  for (let i = 0; i < 25; i++) slots.push(slotTrace({ slotIndex: i, slot: 'support', stage: 'llm', candidateCount: 3, chosenIndex: 0 }));
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: 25, slots }));
});

test('slotCount 0 / negative / non-int => incomplete', () => {
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: 0, slots: [] }));
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: -1, slots: [slotTrace()] }));
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: 1.5, slots: [slotTrace()] }));
});

test('a produced carrier round-trips through the v2 sanitizer unchanged', () => {
  const ev = ok(produceFinalDecisionEvidence(trace([
    slotTrace({ slotIndex: 0, slot: 'hero', stage: 'llm', candidateCount: 4, chosenIndex: 1 }),
    slotTrace({ slotIndex: 1, slot: 'support', stage: 'solver', candidateCount: 3, chosenIndex: 0, score: 5.5, margin: 1, tie: false }),
  ])));
  assert.deepEqual(_sanitizeDecisionEvidenceV2(ev), ev);
});

// =========================================================================
// PRIVACY — untrusted trace strings can never leak into the carrier
// =========================================================================
test('a URL / free-text in the slot field => incomplete (not a role token)', () => {
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ slot: 'https://evil.example/x.jpg' })])));
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ slot: 'John Doe' })])));
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ slot: 'ทราย' })])));
});

test('an unknown stage token => incomplete', () => {
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ stage: 'best_score' })]))); // a reason token, not a stage
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ stage: 'q=1&x=2' })])));
});

test('version must be 2', () => {
  incomplete(produceFinalDecisionEvidence({ version: 1, slotCount: 1, slots: [slotTrace()] }));
  incomplete(produceFinalDecisionEvidence({ slotCount: 1, slots: [slotTrace()] })); // missing version
});

// =========================================================================
// HOSTILE INPUT — descriptor-only ingestion, getter/[[Get]] invoked 0 times
// =========================================================================
test('hostile accessor slot field => incomplete, getter invoked 0 times', () => {
  let calls = 0;
  const st = { slotIndex: 0, stage: 'llm', candidateCount: 3, chosenIndex: 0 };
  Object.defineProperty(st, 'slot', { enumerable: true, configurable: true, get() { calls++; return 'hero'; } });
  incomplete(produceFinalDecisionEvidence(trace([st])));
  assert.equal(calls, 0);
});

test('accessor slot ENTRY (array index getter) => incomplete, getter invoked 0 times', () => {
  let calls = 0;
  const slots = [];
  Object.defineProperty(slots, 0, { enumerable: true, configurable: true, get() { calls++; throw new Error('boom'); } });
  assert.equal(slots.length, 1);
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: 1, slots }));
  assert.equal(calls, 0);
});

test('top-level Proxy read via descriptors only — [[Get]] invoked 0 times', () => {
  let gets = 0;
  const inner = { version: 2, slotCount: 1, slots: [slotTrace()] };
  const p = new Proxy(inner, { get(t, k, r) { gets++; return Reflect.get(t, k, r); } });
  produceFinalDecisionEvidence(p);
  assert.equal(gets, 0);
});

test('Proxy with throwing getPrototypeOf trap => incomplete', () => {
  const inner = { version: 2, slotCount: 1, slots: [slotTrace()] };
  const p = new Proxy(inner, { getPrototypeOf() { throw new Error('nope'); } });
  incomplete(produceFinalDecisionEvidence(p));
});

test('exotic-proto trace (class instance) => incomplete', () => {
  class Weird { constructor() { this.version = 2; this.slotCount = 1; this.slots = [slotTrace()]; } }
  incomplete(produceFinalDecisionEvidence(new Weird()));
});

test('inherited (non-own) slot field is NOT honored (proto rejected)', () => {
  const proto = { candidateCount: 3 };
  const st = Object.create(proto);
  st.slotIndex = 0; st.slot = 'hero'; st.stage = 'llm'; st.chosenIndex = 0;
  incomplete(produceFinalDecisionEvidence(trace([st])));
});

test('symbol own key on a slot trace => incomplete', () => {
  const st = slotTrace();
  st[Symbol('x')] = 1;
  incomplete(produceFinalDecisionEvidence(trace([st])));
});

test('unknown own key on a slot trace => incomplete (strict allowlist)', () => {
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ note: 'hero' })])));
});

test('unknown top-level key => incomplete', () => {
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: 1, slots: [slotTrace()], extra: 1 }));
});

test('an exotic array subclass for slots => incomplete', () => {
  class MyArr extends Array {}
  const slots = new MyArr();
  slots.push(slotTrace());
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: 1, slots }));
});

test('a sparse slots array (hole) => incomplete', () => {
  const slots = [];
  slots[0] = slotTrace({ slotIndex: 0 });
  slots[2] = slotTrace({ slotIndex: 2 }); // index 1 is a hole
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: 3, slots }));
});

// =========================================================================
// DUPLICATE / NUMERIC / TYPE anomalies
// =========================================================================
test('duplicate slotIndex across slot traces => incomplete (fail-closed)', () => {
  incomplete(produceFinalDecisionEvidence({
    version: 2, slotCount: 2,
    slots: [slotTrace({ slotIndex: 0 }), slotTrace({ slotIndex: 0, slot: 'circle' })],
  }));
});

test('chosenIndex >= candidateCount => incomplete', () => {
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ candidateCount: 3, chosenIndex: 3 })])));
});

test('string-typed numeric (no cross-type coercion) => incomplete', () => {
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ candidateCount: '5' })])));
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ chosenIndex: '2' })])));
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ slotIndex: 0, slot: 'support', stage: 'solver', candidateCount: 2, chosenIndex: 0, score: '5' })])));
});

test('non-finite / negative numerics => incomplete', () => {
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ slot: 'support', stage: 'solver', candidateCount: 2, chosenIndex: 0, score: Number.POSITIVE_INFINITY })])));
  incomplete(produceFinalDecisionEvidence(trace([slotTrace({ slot: 'support', stage: 'solver', candidateCount: 2, chosenIndex: 0, score: 5, margin: -0.5 })])));
});

test('slots not an array => incomplete', () => {
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: 1, slots: { 0: slotTrace(), length: 1 } }));
  incomplete(produceFinalDecisionEvidence({ version: 2, slotCount: 1, slots: null }));
});

test('bad top-level inputs => incomplete', () => {
  incomplete(produceFinalDecisionEvidence(null));
  incomplete(produceFinalDecisionEvidence('nope'));
  incomplete(produceFinalDecisionEvidence(42));
  incomplete(produceFinalDecisionEvidence([slotTrace()])); // an array is not a plain trace object
});
