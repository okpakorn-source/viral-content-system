// ============================================================
// candidate-identity-verifier.test.mjs — B4 SHADOW (identity-verifier authority)
// ------------------------------------------------------------
// Unit tests for src/lib/candidateIdentityVerifier.js — the authority that measures
// "is the face in THIS candidate image the SAME individual as a VERIFIED reference?"
// producing identityConfidence (0..1) + identityVerified (>=0.75).
//
// 💰 COST SAFETY IS THE POINT OF THIS FILE. The module makes a REAL billed vision call
// when MEGA_IDENTITY_VERIFIER==='1'. Every test injects a spy `callAI` double via `deps`
// so NO real network is ever hit, and asserts exactly how many times the double fired:
//   (a) flag OFF (default + every near-'1' value) ⇒ callAI NEVER invoked, result absent
//   (b) flag ON ⇒ callAI fires exactly once; cache-hit skips re-call; per-round ceiling
//       (=12) caps calls; _resetIdentityRound restores the budget
//   (c) untrusted provenance / personId mismatch / missing pixels ⇒ absent, ZERO calls
//       (rejected BEFORE spending money) · out-of-range vision confidence ⇒ absent
//   (d) timeout ⇒ absent (silent)
//   (e) cache read/write goes through an INJECTED fs (in-memory) — the disk is never touched
// Plus a source guard: the _rhCastCandidate/_rhHeroCandidate quarantine is byte-unchanged
// and the megaAdapters identity bridge is gated behind the MEGA_REF_HERO_V2 flag.
//
// Offline: measureCandidateIdentity imported directly; callAI + fs 100% injected (DI).
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  measureCandidateIdentity,
  _resetIdentityRound,
  _flushIdentityWrites,
  _clearIdentityCaches,
  _identityCacheKey,
  IDENTITY_CONFIDENCE_MIN,
  IDENTITY_PROMPT_VERSION,
  IDENTITY_SCOPE,
} = await import('../src/lib/candidateIdentityVerifier.js');

const PER_ROUND_CEILING = 12; // MAX_IDENTITY_VISION_CALLS_PER_ROUND (module-local const)

let passed = 0, failed = 0;
const test = async (name, fn) => {
  // isolate module state between cases: caches + per-round vision budget + concurrency slots
  _clearIdentityCaches();
  _resetIdentityRound();
  try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}`); console.error(String((e && e.stack) || e)); }
};

// ---------- doubles ----------
// callAI spy — records invocation count; returns whatever `impl` yields (the module awaits
// callAI's return directly and feeds it to the JSON-strict confidence parser).
const spyCallAI = (impl) => {
  const fn = (...args) => { fn.calls += 1; fn.lastArgs = args[0]; return impl(...args); };
  fn.calls = 0;
  fn.lastArgs = null;
  return fn;
};
const callThrows = spyCallAI(() => { throw new Error('callAI must not be invoked'); });

// in-memory fs — proves cache never touches disk. readFile/writeFile/mkdir only.
const makeFakeFs = () => {
  const store = new Map();
  return {
    store,
    async readFile(p) {
      if (store.has(p)) return store.get(p);
      const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e;
    },
    async writeFile(p, data) { store.set(p, data); },
    async mkdir() { /* no-op — dir creation is best-effort in the module */ },
  };
};

// ---------- fixtures ----------
const PERSON = 'person_alpha';
const REF_IMG = { dataUrl: 'data:image/jpeg;base64,REFERENCEPIXELS' };
const CAND_IMG = { dataUrl: 'data:image/jpeg;base64,CANDIDATEPIXELS' };
const FAKE_CACHE_PATH = 'FAKEDIR/identity-cache.json';

const mkCandidate = (imageHash, image = CAND_IMG) => ({ imageHash, image });
const mkClaim = (personId = PERSON) => ({ personId });
// trusted, traceable reference evidence of the SAME claimed person (enrolled cast asset)
const mkRef = (over = {}) => ({
  personId: PERSON,
  provenance: 'enrolled_cast_reference',
  referenceHash: 'refhash-1',
  image: REF_IMG,
  ...over,
});

const onEnv = (v = '1') => ({ MEGA_IDENTITY_VERIFIER: v });
const visionOk = (conf) => () => ({ identity_confidence: conf, same_person: conf >= IDENTITY_CONFIDENCE_MIN });

// ============================================================
// (a) FLAG OFF — default + every "near-1" value ⇒ NEVER calls vision, result absent
// ============================================================
await test('a1: flag OFF (env absent) ⇒ absent + zero callAI, even with valid ref+pixels', async () => {
  const spy = spyCallAI(visionOk(0.99));
  const r = await measureCandidateIdentity({
    candidate: mkCandidate('img-off'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: {}, fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(r, undefined, 'OFF ⇒ absent');
  assert.equal(spy.calls, 0, 'OFF ⇒ vision never attempted');
});

await test('a2: every near-"1" env value is treated as OFF (strict === "1") ⇒ absent, zero calls', async () => {
  for (const v of [undefined, '', '0', ' 1', '1 ', '01', 'true', 'TRUE', 'yes', 'on', 1, 'idv1']) {
    _clearIdentityCaches(); _resetIdentityRound();
    const spy = spyCallAI(visionOk(0.99));
    const env = v === undefined ? {} : { MEGA_IDENTITY_VERIFIER: v };
    const r = await measureCandidateIdentity({
      candidate: mkCandidate('img-near1'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
      deps: { env, fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.equal(r, undefined, `env value ${JSON.stringify(v)} ⇒ OFF ⇒ absent`);
    assert.equal(spy.calls, 0, `env value ${JSON.stringify(v)} ⇒ no vision`);
  }
});

await test('a3: flag OFF still SERVES a cache hit (cache-only) without any vision', async () => {
  const ffs = makeFakeFs();
  const key = _identityCacheKey('img-cached', PERSON, IDENTITY_PROMPT_VERSION);
  const seeded = { scope: IDENTITY_SCOPE, personId: PERSON, identityConfidence: 0.9, identityVerified: true, promptVersion: IDENTITY_PROMPT_VERSION };
  ffs.store.set(FAKE_CACHE_PATH, JSON.stringify({ [key]: { ts: 1, result: seeded } }));
  const r = await measureCandidateIdentity({
    candidate: mkCandidate('img-cached'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: {}, fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: callThrows },
  });
  assert.deepEqual(r, seeded, 'OFF returns the cached measurement verbatim');
  assert.equal(callThrows.calls, 0, 'cache hit ⇒ no vision even conceptually');
});

// ============================================================
// (b) FLAG ON — one call, cache reuse, per-round ceiling, budget reset
// ============================================================
await test('b1: ON ⇒ vision fires exactly once; result carries confidence + threshold verdict', async () => {
  const spy = spyCallAI(visionOk(0.82));
  const r = await measureCandidateIdentity({
    candidate: mkCandidate('img-on-1'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(spy.calls, 1, 'exactly one billed vision call');
  assert.ok(r && typeof r === 'object', 'measured result present');
  assert.equal(r.scope, IDENTITY_SCOPE);
  assert.equal(r.personId, PERSON);
  assert.equal(r.identityConfidence, 0.82);
  assert.equal(r.identityVerified, true, '0.82 >= 0.75 ⇒ verified');
  assert.equal(r.promptVersion, IDENTITY_PROMPT_VERSION);
  assert.ok(Object.isFrozen(r), 'result is frozen/detached');
  // vision was fed BOTH images: reference (IMAGE 1) then candidate (IMAGE 2)
  assert.ok(Array.isArray(spy.lastArgs.imageContents) && spy.lastArgs.imageContents.length === 2, 'two images sent');
});

await test('b2: threshold 0.75 is the exact cut — 0.75 verified, 0.7499 not', async () => {
  assert.equal(IDENTITY_CONFIDENCE_MIN, 0.75, 'documented threshold');
  for (const [conf, expected] of [[0.75, true], [0.7499, false], [0.9, true], [0.5, false], [1, true], [0, false]]) {
    _clearIdentityCaches(); _resetIdentityRound();
    const spy = spyCallAI(visionOk(conf));
    const r = await measureCandidateIdentity({
      candidate: mkCandidate('img-thr-' + conf), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
      deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.equal(spy.calls, 1, `conf ${conf} ⇒ one call`);
    assert.equal(r.identityConfidence, conf);
    assert.equal(r.identityVerified, expected, `conf ${conf} ⇒ verified=${expected}`);
  }
});

await test('b3: cache hit — second identical measure returns the SAME result WITHOUT re-calling vision', async () => {
  const ffs = makeFakeFs();
  const spy = spyCallAI(visionOk(0.8));
  const args = {
    candidate: mkCandidate('img-reuse'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
  };
  const r1 = await measureCandidateIdentity(args);
  const r2 = await measureCandidateIdentity(args); // same (image hash, personId, prompt version)
  assert.equal(spy.calls, 1, 'second call served from MEM cache — vision fired only once');
  assert.deepEqual(r2, r1, 'cache-hit result identical');
});

await test('b4: per-round ceiling caps vision at 12; _resetIdentityRound restores the budget', async () => {
  const spy = spyCallAI(visionOk(0.8));
  const runOne = (i) => measureCandidateIdentity({
    candidate: mkCandidate('img-ceil-' + i), // unique ⇒ always a cache miss ⇒ tries vision
    claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  const results = [];
  for (let i = 0; i < PER_ROUND_CEILING + 3; i++) results.push(await runOne(i)); // 15 attempts, ceiling 12
  assert.equal(spy.calls, PER_ROUND_CEILING, `exactly ${PER_ROUND_CEILING} billed calls this round`);
  for (let i = 0; i < PER_ROUND_CEILING; i++) assert.ok(results[i], `attempt ${i} measured`);
  for (let i = PER_ROUND_CEILING; i < results.length; i++) assert.equal(results[i], undefined, `attempt ${i} over ceiling ⇒ absent`);
  // new S6 round: budget reset ⇒ vision available again
  _resetIdentityRound();
  const after = await runOne(999);
  assert.ok(after, 'after reset ⇒ measured again');
  assert.equal(spy.calls, PER_ROUND_CEILING + 1, 'one more call consumed after reset');
});

// ============================================================
// (c) REJECT-BEFORE-SPENDING — untrusted / mismatched / missing pixels ⇒ absent, ZERO calls
// ============================================================
await test('c1: untrusted provenance ⇒ absent, vision NEVER attempted (even ON)', async () => {
  for (const prov of ['triage_guess', 'name_label', 'raw_scrape', '', undefined]) {
    _clearIdentityCaches(); _resetIdentityRound();
    const spy = spyCallAI(visionOk(0.99));
    const r = await measureCandidateIdentity({
      candidate: mkCandidate('img-prov'), claimedPerson: mkClaim(),
      referenceEvidence: mkRef({ provenance: prov }),
      deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.equal(r, undefined, `provenance ${JSON.stringify(prov)} untrusted ⇒ absent`);
    assert.equal(spy.calls, 0, 'untrusted reference ⇒ money never spent');
  }
});

await test('c2: reference personId ≠ claimed personId ⇒ absent, zero calls (no cross-person leak)', async () => {
  const spy = spyCallAI(visionOk(0.99));
  const r = await measureCandidateIdentity({
    candidate: mkCandidate('img-mismatch'), claimedPerson: mkClaim('person_alpha'),
    referenceEvidence: mkRef({ personId: 'person_beta' }),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(r, undefined, 'reference of a different person ⇒ absent');
  assert.equal(spy.calls, 0);
});

await test('c3: missing referenceHash (not traceable) ⇒ absent, zero calls', async () => {
  const spy = spyCallAI(visionOk(0.99));
  const r = await measureCandidateIdentity({
    candidate: mkCandidate('img-noref'), claimedPerson: mkClaim(),
    referenceEvidence: mkRef({ referenceHash: '' }),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(r, undefined);
  assert.equal(spy.calls, 0);
});

await test('c4: missing pixels (candidate OR reference) ⇒ absent, zero calls', async () => {
  // candidate has a bindable imageHash but NO image ⇒ vision cannot run ⇒ never calls
  const spyA = spyCallAI(visionOk(0.99));
  const rA = await measureCandidateIdentity({
    candidate: { imageHash: 'img-nopix' }, claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spyA },
  });
  assert.equal(rA, undefined, 'no candidate pixels ⇒ absent');
  assert.equal(spyA.calls, 0, 'no candidate pixels ⇒ vision not attempted');
  // reference has no image ⇒ same
  _clearIdentityCaches(); _resetIdentityRound();
  const spyB = spyCallAI(visionOk(0.99));
  const rB = await measureCandidateIdentity({
    candidate: mkCandidate('img-nopix2'), claimedPerson: mkClaim(),
    referenceEvidence: mkRef({ image: null }),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spyB },
  });
  assert.equal(rB, undefined, 'no reference pixels ⇒ absent');
  assert.equal(spyB.calls, 0);
});

await test('c5: no bindable candidate image hash / no claimed personId ⇒ absent, zero calls', async () => {
  const spy = spyCallAI(visionOk(0.99));
  const noHash = await measureCandidateIdentity({
    candidate: { image: CAND_IMG }, claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(noHash, undefined, 'no image identity hash ⇒ absent');
  const noPerson = await measureCandidateIdentity({
    candidate: mkCandidate('img-x'), claimedPerson: { personId: '' }, referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(noPerson, undefined, 'no claimed personId ⇒ absent');
  assert.equal(spy.calls, 0, 'neither attempted vision');
});

await test('c6: out-of-range / malformed vision confidence ⇒ absent (guard rejects bad output)', async () => {
  // note: Number(null)===0 is a VALID in-range confidence, so null is NOT an out-of-range case
  for (const bad of [1.5, -0.1, NaN, 'high', {}, undefined]) {
    _clearIdentityCaches(); _resetIdentityRound();
    const spy = spyCallAI(() => ({ identity_confidence: bad }));
    const r = await measureCandidateIdentity({
      candidate: mkCandidate('img-badconf'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
      deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.equal(r, undefined, `vision confidence ${JSON.stringify(bad)} out of [0,1] ⇒ absent`);
    assert.equal(spy.calls, 1, 'the call happened, but the malformed result is discarded (not cached)');
  }
  // a non-object vision response is also absent
  _clearIdentityCaches(); _resetIdentityRound();
  const spy2 = spyCallAI(() => 'not-json');
  const r2 = await measureCandidateIdentity({
    candidate: mkCandidate('img-nonobj'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy2 },
  });
  assert.equal(r2, undefined);
});

// ============================================================
// (d) TIMEOUT ⇒ absent (silent)
// ============================================================
await test('d1: vision call exceeding the per-call timeout ⇒ absent, nothing cached', async () => {
  const ffs = makeFakeFs();
  const spy = spyCallAI(() => new Promise(() => { /* never settles */ }));
  const r = await measureCandidateIdentity({
    candidate: mkCandidate('img-timeout'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy, visionTimeoutMs: 15 },
  });
  assert.equal(r, undefined, 'timeout ⇒ absent');
  assert.equal(spy.calls, 1, 'the call was attempted then abandoned on timeout');
  await _flushIdentityWrites();
  assert.ok(!ffs.store.has(FAKE_CACHE_PATH), 'timeout result is never written to cache');
});

await test('d2: callAI throwing ⇒ absent (fail-closed), nothing cached', async () => {
  const ffs = makeFakeFs();
  const spy = spyCallAI(() => { throw new Error('provider 500'); });
  const r = await measureCandidateIdentity({
    candidate: mkCandidate('img-throw'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(r, undefined);
  await _flushIdentityWrites();
  assert.ok(!ffs.store.has(FAKE_CACHE_PATH), 'thrown vision ⇒ no cache write');
});

// ============================================================
// (e) CACHE via INJECTED fs — write then read, disk never touched
// ============================================================
await test('e1: successful measure writes to the INJECTED fs under the (hash,person,version) key', async () => {
  const ffs = makeFakeFs();
  const spy = spyCallAI(visionOk(0.88));
  const r = await measureCandidateIdentity({
    candidate: mkCandidate('img-e1'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy, now: () => 42 },
  });
  assert.ok(r, 'measured');
  await _flushIdentityWrites(); // background file write is best-effort — flush for assertion
  assert.ok(ffs.store.has(FAKE_CACHE_PATH), 'cache file written through the injected fs');
  const persisted = JSON.parse(ffs.store.get(FAKE_CACHE_PATH));
  const key = _identityCacheKey('img-e1', PERSON, IDENTITY_PROMPT_VERSION);
  assert.ok(persisted[key], 'entry stored under the exact cache key');
  assert.equal(persisted[key].ts, 42, 'timestamp from injected clock (no real Date)');
  assert.equal(persisted[key].result.identityConfidence, 0.88);
});

await test('e2: file-cache warm — a FRESH module cache reads the entry from injected fs, no re-call', async () => {
  const ffs = makeFakeFs();
  const seedSpy = spyCallAI(visionOk(0.79));
  const args = (spy) => ({
    candidate: mkCandidate('img-e2'), claimedPerson: mkClaim(), referenceEvidence: mkRef(),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  await measureCandidateIdentity(args(seedSpy));
  await _flushIdentityWrites();
  assert.equal(seedSpy.calls, 1);
  // drop mem cache + file-cache-loaded flag; the entry must be re-read from the injected fs
  _clearIdentityCaches();
  const r = await measureCandidateIdentity(args(callThrows));
  assert.ok(r, 'served from file cache after cold mem');
  assert.equal(r.identityConfidence, 0.79);
  assert.equal(callThrows.calls, 0, 'file-cache hit ⇒ vision never re-attempted');
});

await test('e3: cache key isolates (image hash, personId, prompt version) — no field bleed', () => {
  // deterministic + length-prefixed: boundary between fields cannot be confused
  const k = _identityCacheKey('img', PERSON, IDENTITY_PROMPT_VERSION);
  assert.equal(k, _identityCacheKey('img', PERSON, IDENTITY_PROMPT_VERSION), 'deterministic');
  assert.notEqual(_identityCacheKey('ab', 'c', 'v'), _identityCacheKey('a', 'bc', 'v'), 'no field bleed a|bc');
  assert.notEqual(_identityCacheKey('img', PERSON, 'idv1'), _identityCacheKey('img', PERSON, 'idv2'), 'prompt version bump invalidates');
  assert.notEqual(_identityCacheKey('img1', PERSON, 'v'), _identityCacheKey('img2', PERSON, 'v'), 'different image ⇒ different key');
});

// ============================================================
// (f) SOURCE GUARD — quarantine byte-unchanged + bridge gated by MEGA_REF_HERO_V2
// ============================================================
await test('f1: _rhCastCandidate / _rhHeroCandidate consume identity authority (Batch 6 unquarantine); identity bridge flag-gated', () => {
  const src = fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  // Batch 6 UNQUARANTINE: identity now elevates ONLY from the caller-resolved validated carrier —
  // cast identityVerified from identityById.verified, hero identityConfidence from identityById.
  // Absent carrier ⇒ false/undefined ⇒ the legacy HOLD stands (never derived from triage/label).
  const castStart = src.indexOf('function _rhCastCandidate(');
  const castEnd = src.indexOf('function _rhHeroCandidate(');
  const heroEnd = src.indexOf('function ', castEnd + 20);
  assert.ok(castStart !== -1 && castEnd > castStart && heroEnd > castEnd, 'both consumer fns present');
  assert.ok(/const identityVerified = evidence\?\.identityVerified === true;/.test(src.slice(castStart, castEnd)), '_rhCastCandidate identityVerified reads the validated evidence carrier');
  assert.ok(!/identityVerified: false/.test(src.slice(castStart, castEnd)), '_rhCastCandidate no longer hardcodes identityVerified:false');
  assert.ok(/const identityConfidence = \(m && Number.isFinite\(m.identityConfidence\)\)/.test(src.slice(castEnd, heroEnd)), '_rhHeroCandidate identityConfidence reads the validated metrics carrier');
  assert.ok(!/const identityConfidence = undefined;/.test(src.slice(castEnd, heroEnd)), '_rhHeroCandidate no longer hardcodes identityConfidence=undefined');
  // exactly one bridge call site, sitting AFTER the last MEGA_REF_HERO_V2 gate ⇒ flag OFF skips it
  const calls = src.match(/await _buildIdentityEvidenceV1\(/g) || [];
  assert.equal(calls.length, 1, 'exactly one identity bridge call site');
  const lastGate = src.lastIndexOf('if (_refHeroV2On)');
  const callAt = src.indexOf('await _buildIdentityEvidenceV1(');
  assert.ok(lastGate !== -1 && callAt > lastGate, 'identity bridge call is inside the flag-gated block');
  // authorityEvidence carries the detached shadow key
  assert.ok(/identityById: _rhIdentityById/.test(src), 'authorityEvidence.identityById wired (shadow)');
});

console.log(`\n# ${passed}/${passed + failed} passed`);
if (failed) { process.exitCode = 1; throw new Error(`${failed} test(s) failed`); }
