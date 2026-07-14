// Focused OFFLINE adversarial test — src/lib/refHeroCandidateEvidence.js
// No network, no LLM, no IO. Proves the P1-E1 FINAL correction (independent re-review = HOLD):
//   ★ PRIMITIVE DORMANT SENTINEL: the builder IGNORES its argument and returns exactly one immutable primitive
//     literal, making ZERO Object/Reflect/WeakMap/Proxy/deepFreeze calls. There is no object/array/status result,
//     hence no field to mutate and no positive path — and no ambient intrinsic whose poisoning could change the
//     result. Same-realm primordial poisoning (pre- OR post-import) cannot capture a marker, forge a positive, or
//     mutate the result. Shape/base/crop validation + trusted positive producer are DEFERRED to a separate realm.
import assert from 'node:assert/strict';
import * as MOD from '../src/lib/refHeroCandidateEvidence.js';
import {
  buildRefHeroCandidateEvidence,
  REF_HERO_EVIDENCE_DORMANT,
  REF_HERO_WIRING_NOTE,
} from '../src/lib/refHeroCandidateEvidence.js';

const MODURL = new URL('../src/lib/refHeroCandidateEvidence.js', import.meta.url).href;
const SENTINEL = 'DORMANT_NO_TRUSTED_PRODUCER';

let n = 0, failed = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log(`ok ${n} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${n} - ${name}`); console.error(String((e && e.stack) || e)); }
}

await test('P1-E1: exports are primitive strings + ONE argument-ignoring builder; NO mint/registry/diagnostic/object export', () => {
  const FORBIDDEN = [
    'mint', 'REGISTRY', 'verifyInternalBindingIntegrity', '_computeBindingIntegrity', 'REF_HERO_BINDING_INTEGRITY',
    'WIRING_STATUS', 'MEASUREMENT_KIND', 'REQUIRED_HERO_FIELDS', 'REQUIRED_GLOBAL_FIELDS',
    'issueRefHeroProducerMarker', '_issueProducerMarker', '_attestSearch', 'attestCandidateCropReadiness',
  ];
  for (const nm of FORBIDDEN) assert.equal(typeof MOD[nm], 'undefined', `${nm} must NOT be exported`);
  const names = Object.keys(MOD);
  assert.deepEqual(names.filter((k) => typeof MOD[k] === 'function'), ['buildRefHeroCandidateEvidence'], 'only the builder is a callable export');
  // EVERY non-function export is a PRIMITIVE string ⇒ no object/array export ⇒ no mutable surface, no Object.freeze reliance
  for (const k of names) {
    if (k === 'buildRefHeroCandidateEvidence') continue;
    assert.equal(typeof MOD[k], 'string', `${k} must be a primitive string export`);
  }
  // the builder IGNORES its argument and returns exactly the primitive sentinel (a string, no object to mutate)
  for (const arg of [undefined, null, {}, [], 'x', 42, Symbol('s'), { producer: {}, measurements: {}, cropContext: {} }]) {
    assert.equal(buildRefHeroCandidateEvidence(arg), SENTINEL);
    assert.equal(typeof buildRefHeroCandidateEvidence(arg), 'string');
  }
  assert.equal(REF_HERO_EVIDENCE_DORMANT, SENTINEL);
  assert.equal(buildRefHeroCandidateEvidence(), REF_HERO_EVIDENCE_DORMANT);
});

await test('P1-E1: builder is a NON-CONSTRUCTABLE arrow — no .prototype; ordinary call returns the exact primitive; new builder() and Reflect.construct(builder,[]) both throw TypeError (cannot discard the primitive to yield a fresh object)', () => {
  assert.equal(buildRefHeroCandidateEvidence.prototype, undefined, 'arrow builder has no .prototype');
  assert.equal(buildRefHeroCandidateEvidence({ any: 1 }), SENTINEL, 'ordinary call returns the exact primitive');
  assert.equal(typeof buildRefHeroCandidateEvidence({ any: 1 }), 'string');
  assert.throws(() => new buildRefHeroCandidateEvidence(), TypeError, 'new builder() must throw TypeError');
  assert.throws(() => Reflect.construct(buildRefHeroCandidateEvidence, []), TypeError, 'Reflect.construct(builder, []) must throw TypeError');
  assert.throws(() => Reflect.construct(buildRefHeroCandidateEvidence, [{ any: 1 }]), TypeError);
});

await test('P1-E1: WIRING note (primitive string) documents deferral; does NOT claim a deep-frozen object or current schema validation', () => {
  assert.equal(typeof REF_HERO_WIRING_NOTE, 'string');
  assert.match(REF_HERO_WIRING_NOTE, /deferred/i);
  assert.match(REF_HERO_WIRING_NOTE, /isolated/i);
  assert.match(REF_HERO_WIRING_NOTE, /does NOT return a deep-frozen object/i);
});

await test('P1-E1: PRE-import HOSTILE poison (WeakMap get/set + Reflect.apply throw/record; Object.freeze mutates/no-ops; Object.isFrozen/keys/gOPD/getPrototypeOf + Reflect.ownKeys throw) then FRESH import SUCCEEDS; restore; exact sentinel, no wrapper invoked, no marker capture, only builder callable, repeated calls exact-equal', async () => {
  const real = {
    wmSet: WeakMap.prototype.set, wmGet: WeakMap.prototype.get, apply: Reflect.apply,
    freeze: Object.freeze, isFrozen: Object.isFrozen, keys: Object.keys,
    gopd: Object.getOwnPropertyDescriptor, getProto: Object.getPrototypeOf, ownKeys: Reflect.ownKeys,
  };
  const hit = {}; const bump = (nm) => { hit[nm] = (hit[nm] || 0) + 1; };
  const captured = [];
  let mod, importErr = null, freshR1, freshR2;
  try {
    WeakMap.prototype.set = function (k, v) { bump('wmSet'); captured.push({ k, v }); throw new Error('poison'); };
    WeakMap.prototype.get = function (k) { bump('wmGet'); captured.push({ get: k }); throw new Error('poison'); };
    Reflect.apply = function () { bump('apply'); throw new Error('poison'); };
    Object.freeze = function (o) { bump('freeze'); if (o && typeof o === 'object') { try { o.authenticated = true; if (o.claims) for (const k in o.claims) if (o.claims[k]) o.claims[k].value = true; } catch { /* ignore */ } } return o; };
    Object.isFrozen = function () { bump('isFrozen'); throw new Error('poison'); };
    Object.keys = function () { bump('keys'); throw new Error('poison'); };
    Object.getOwnPropertyDescriptor = function () { bump('gopd'); throw new Error('poison'); };
    Object.getPrototypeOf = function () { bump('getProto'); throw new Error('poison'); };
    Reflect.ownKeys = function () { bump('ownKeys'); throw new Error('poison'); };
    try { mod = await import(MODURL + '?poison=' + process.hrtime.bigint()); } catch (e) { importErr = e; }
    // invoke the FRESH builder while poison is STILL ACTIVE — it must trigger no intrinsic (no poison wrapper fires)
    if (mod && typeof mod.buildRefHeroCandidateEvidence === 'function') {
      freshR1 = mod.buildRefHeroCandidateEvidence({ any: 1 });
      freshR2 = mod.buildRefHeroCandidateEvidence(Symbol('x'));
    }
  } finally {
    WeakMap.prototype.set = real.wmSet; WeakMap.prototype.get = real.wmGet; Reflect.apply = real.apply;
    Object.freeze = real.freeze; Object.isFrozen = real.isFrozen; Object.keys = real.keys;
    Object.getOwnPropertyDescriptor = real.gopd; Object.getPrototypeOf = real.getProto; Reflect.ownKeys = real.ownKeys;
  }
  // import SUCCEEDS because the module calls NONE of these intrinsics
  assert.equal(importErr, null, `fresh import must succeed under poison (module calls no intrinsic): ${importErr && importErr.message}`);
  // ★ poison hit map stays EMPTY after BOTH module init AND the fresh-builder invocation (zero intrinsic calls anywhere)
  assert.deepEqual(hit, {}, 'no poison wrapper invoked during import OR fresh-builder invocation');
  assert.equal(captured.length, 0, 'no marker/record captured during import or invocation');
  // ★ the ?query import is a DISTINCT module instance — its builder identity differs from the canonical (static) import
  assert.notEqual(mod.buildRefHeroCandidateEvidence, buildRefHeroCandidateEvidence, 'fresh ?query-import builder identity differs from the canonical import');
  // (restored) inspect
  assert.equal(typeof mod.verifyInternalBindingIntegrity, 'undefined');
  assert.equal(typeof mod.REF_HERO_BINDING_INTEGRITY, 'undefined');
  assert.deepEqual(Object.keys(mod).filter((k) => typeof mod[k] === 'function'), ['buildRefHeroCandidateEvidence'], 'only the builder is callable');
  assert.equal(freshR1, SENTINEL, 'exact primitive sentinel from the fresh builder (invoked under poison)');
  assert.equal(freshR1, freshR2, 'repeated calls exact-equal (byte-identical primitive)');
  assert.equal(typeof freshR1, 'string', 'result is a primitive string (no object to mutate)');
});

await test('P1-E1: POST-import HOSTILE patches during invocation + Proxy/revoked/accessor inputs — builder returns the same primitive, invokes no intrinsic, observes no input trap/getter', async () => {
  const trap = {}; const bumpT = (nm) => { trap[nm] = (trap[nm] || 0) + 1; };
  const proxy = new Proxy({}, {
    get() { bumpT('get'); throw new Error('t'); },
    getOwnPropertyDescriptor() { bumpT('gopd'); throw new Error('t'); },
    ownKeys() { bumpT('ownKeys'); throw new Error('t'); },
    has() { bumpT('has'); throw new Error('t'); },
    getPrototypeOf() { bumpT('getProto'); throw new Error('t'); },
  });
  const acc = {};
  Object.defineProperty(acc, 'producer', { enumerable: true, configurable: true, get() { bumpT('get'); throw new Error('t'); } });
  const { proxy: rp, revoke } = Proxy.revocable({}, {}); revoke();

  const real = {
    freeze: Object.freeze, isFrozen: Object.isFrozen, keys: Object.keys, gopd: Object.getOwnPropertyDescriptor,
    getProto: Object.getPrototypeOf, wmSet: WeakMap.prototype.set, wmGet: WeakMap.prototype.get,
    apply: Reflect.apply, ownKeys: Reflect.ownKeys,
  };
  const hit = {}; const bump = (nm) => { hit[nm] = (hit[nm] || 0) + 1; };
  const results = [];
  try {
    // HOSTILE patches active DURING the builder invocation — mirror the PRE-import set exactly
    Object.freeze = function (o) { bump('freeze'); if (o && typeof o === 'object') { try { o.authenticated = true; } catch { /* ignore */ } } return o; };
    Object.isFrozen = function () { bump('isFrozen'); throw new Error('p'); };
    Object.keys = function () { bump('keys'); throw new Error('p'); };
    Object.getOwnPropertyDescriptor = function () { bump('gopd'); throw new Error('p'); };
    Object.getPrototypeOf = function () { bump('getProto'); throw new Error('p'); };
    WeakMap.prototype.set = function () { bump('wmSet'); throw new Error('p'); };
    WeakMap.prototype.get = function () { bump('wmGet'); throw new Error('p'); };
    Reflect.apply = function () { bump('apply'); throw new Error('p'); };
    Reflect.ownKeys = function () { bump('ownKeys'); throw new Error('p'); };
    for (const arg of [proxy, acc, rp, undefined, null, 42, 'x', Symbol('s'), {}, [], proxy]) {
      results.push(buildRefHeroCandidateEvidence(arg)); // collect under poison; assert after restore
    }
  } finally {
    Object.freeze = real.freeze; Object.isFrozen = real.isFrozen; Object.keys = real.keys;
    Object.getOwnPropertyDescriptor = real.gopd; Object.getPrototypeOf = real.getProto;
    WeakMap.prototype.set = real.wmSet; WeakMap.prototype.get = real.wmGet;
    Reflect.apply = real.apply; Reflect.ownKeys = real.ownKeys;
  }
  for (const r of results) assert.equal(r, SENTINEL, 'exact sentinel under hostile patch + hostile input');
  assert.deepEqual(hit, {}, 'builder invoked NO intrinsic (no poison wrapper fired)');
  assert.deepEqual(trap, {}, 'builder observed NO input trap/getter');
});

await test('determinism: repeated calls are byte/exact equal primitives (no object identity, no mutation surface)', () => {
  const a = buildRefHeroCandidateEvidence({ x: 1 });
  const b = buildRefHeroCandidateEvidence({ y: 2 });
  const c = buildRefHeroCandidateEvidence();
  assert.equal(a, SENTINEL);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(typeof a, 'string');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

console.log(`\n# ref-hero-candidate-evidence: ${n} tests, ${failed} failed`);
if (failed) process.exit(1);
