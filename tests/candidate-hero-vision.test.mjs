// ============================================================
// candidate-hero-vision.test.mjs — B5 SHADOW (hero-vision authority)
// ------------------------------------------------------------
// Unit tests for src/lib/candidateHeroVision.js — the authority that measures the THREE
// remaining hero metrics heroShotContract requires but no producer exists for yet:
//   occlusion (0..1) · cleanliness (0..1) · visibleBodyRegion (enum, 6 steps).
// Unlike B4 (identity), B5 needs NO reference person — it measures the candidate image
// itself. All three fields are all-or-nothing: any invalid value ⇒ whole result absent.
//
// 💰 COST SAFETY IS THE POINT OF THIS FILE. The module makes a REAL billed vision call
// when MEGA_HERO_VISION==='1'. Every test injects a spy `callAI` double via `deps` so NO
// real network is ever hit, and asserts exactly how many times the double fired:
//   (a) flag OFF (default + every near-'1' value) ⇒ callAI NEVER invoked, result absent;
//       a cache hit is still served cache-only; no cache ⇒ absent
//   (b) flag ON ⇒ callAI fires exactly once, returns all 3 fields; cache-hit skips re-call;
//       per-round ceiling (=12) caps calls; _resetHeroVisionRound restores the budget
//   (c) enum wrong / out-of-range / malformed JSON ⇒ absent, NOT cached
//   (d) timeout / ceiling ⇒ absent (silent)
//   (e) cache read/write goes through an INJECTED fs (in-memory); key isolates
//       (imageHash, promptVersion) — a promptVersion bump re-measures
//   (f) enum mirrors heroShotContract exactly; quarantine byte-unchanged vs a0a3985;
//       bridge gated behind MEGA_REF_HERO_V2 (flag OFF ⇒ byte-identical wiring)
//
// Offline: measureHeroVision imported directly; callAI + fs 100% injected (DI).
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const {
  measureHeroVision,
  _resetHeroVisionRound,
  _flushHeroVisionWrites,
  _clearHeroVisionCaches,
  _heroVisionCacheKey,
  HERO_VISION_PROMPT_VERSION,
  HERO_VISION_SCOPE,
  HERO_VISION_BODY_REGIONS,
} = await import('../src/lib/candidateHeroVision.js');

const { VISIBLE_BODY_REGIONS } = await import('../src/lib/heroShotContract.js');

const PER_ROUND_CEILING = 12; // MAX_HERO_VISION_CALLS_PER_ROUND (module-local const)

let passed = 0, failed = 0;
const test = async (name, fn) => {
  // isolate module state between cases: caches + per-round vision budget + concurrency slots
  _clearHeroVisionCaches();
  _resetHeroVisionRound();
  try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}`); console.error(String((e && e.stack) || e)); }
};

// ---------- doubles ----------
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
const CAND_IMG = { dataUrl: 'data:image/jpeg;base64,CANDIDATEPIXELS' };
const FAKE_CACHE_PATH = 'FAKEDIR/hero-vision-cache.json';

const mkCandidate = (imageHash, image = CAND_IMG) => ({ imageHash, image });
const onEnv = (v = '1') => ({ MEGA_HERO_VISION: v });
// a well-formed vision response with all 3 fields
const visionOk = (occ = 0.1, clean = 0.9, region = 'head_shoulders') =>
  () => ({ occlusion: occ, cleanliness: clean, visible_body_region: region, evidence: 'x' });

// ============================================================
// (a) FLAG OFF — default + every "near-1" value ⇒ NEVER calls vision, result absent
// ============================================================
await test('a1: flag OFF (env absent) ⇒ absent + zero callAI, even with valid pixels', async () => {
  const spy = spyCallAI(visionOk());
  const r = await measureHeroVision({
    candidate: mkCandidate('img-off'),
    deps: { env: {}, fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(r, undefined, 'OFF ⇒ absent');
  assert.equal(spy.calls, 0, 'OFF ⇒ vision never attempted');
});

await test('a2: every near-"1" env value is treated as OFF (strict === "1") ⇒ absent, zero calls', async () => {
  for (const v of [undefined, '', '0', ' 1', '1 ', '01', 'true', 'TRUE', 'yes', 'on', 1, 'hv1']) {
    _clearHeroVisionCaches(); _resetHeroVisionRound();
    const spy = spyCallAI(visionOk());
    const env = v === undefined ? {} : { MEGA_HERO_VISION: v };
    const r = await measureHeroVision({
      candidate: mkCandidate('img-near1'),
      deps: { env, fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.equal(r, undefined, `env value ${JSON.stringify(v)} ⇒ OFF ⇒ absent`);
    assert.equal(spy.calls, 0, `env value ${JSON.stringify(v)} ⇒ no vision`);
  }
});

await test('a3: flag OFF still SERVES a cache hit (cache-only) without any vision', async () => {
  const ffs = makeFakeFs();
  const key = _heroVisionCacheKey('img-cached', HERO_VISION_PROMPT_VERSION);
  const seeded = { scope: HERO_VISION_SCOPE, occlusion: 0.05, cleanliness: 0.95, visibleBodyRegion: 'bust', promptVersion: HERO_VISION_PROMPT_VERSION };
  ffs.store.set(FAKE_CACHE_PATH, JSON.stringify({ [key]: { ts: 1, result: seeded } }));
  const r = await measureHeroVision({
    candidate: mkCandidate('img-cached'),
    deps: { env: {}, fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: callThrows },
  });
  assert.deepEqual(r, seeded, 'OFF returns the cached measurement verbatim');
  assert.equal(callThrows.calls, 0, 'cache hit ⇒ no vision even conceptually');
});

await test('a4: flag OFF + no cache ⇒ absent (cache-only, nothing to serve)', async () => {
  const r = await measureHeroVision({
    candidate: mkCandidate('img-nocache'),
    deps: { env: {}, fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: callThrows },
  });
  assert.equal(r, undefined, 'OFF + no cache ⇒ absent');
  assert.equal(callThrows.calls, 0);
});

// ============================================================
// (b) FLAG ON — one call (all 3 fields), cache reuse, per-round ceiling, budget reset
// ============================================================
await test('b1: ON ⇒ vision fires exactly once; result carries all 3 metrics + scope/version', async () => {
  const spy = spyCallAI(visionOk(0.12, 0.8, 'half_body'));
  const r = await measureHeroVision({
    candidate: mkCandidate('img-on-1'),
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(spy.calls, 1, 'exactly one billed vision call');
  assert.ok(r && typeof r === 'object', 'measured result present');
  assert.equal(r.scope, HERO_VISION_SCOPE);
  assert.equal(r.occlusion, 0.12);
  assert.equal(r.cleanliness, 0.8);
  assert.equal(r.visibleBodyRegion, 'half_body');
  assert.equal(r.promptVersion, HERO_VISION_PROMPT_VERSION);
  assert.ok(Object.isFrozen(r), 'result is frozen/detached');
  // vision was fed exactly ONE image (the candidate — no reference person)
  assert.ok(Array.isArray(spy.lastArgs.imageContents) && spy.lastArgs.imageContents.length === 1, 'exactly one image sent');
});

await test('b2: every enum token in the mirror is accepted verbatim', async () => {
  for (const region of HERO_VISION_BODY_REGIONS) {
    _clearHeroVisionCaches(); _resetHeroVisionRound();
    const spy = spyCallAI(visionOk(0.1, 0.9, region));
    const r = await measureHeroVision({
      candidate: mkCandidate('img-enum-' + region),
      deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.equal(spy.calls, 1, `region ${region} ⇒ one call`);
    assert.equal(r.visibleBodyRegion, region, `region ${region} passed through verbatim`);
  }
});

await test('b3: boundary values 0 and 1 are valid for occlusion + cleanliness (no clamp needed)', async () => {
  for (const [occ, clean] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    _clearHeroVisionCaches(); _resetHeroVisionRound();
    const spy = spyCallAI(visionOk(occ, clean, 'face_only'));
    const r = await measureHeroVision({
      candidate: mkCandidate(`img-bnd-${occ}-${clean}`),
      deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.ok(r, `occ=${occ} clean=${clean} ⇒ measured`);
    assert.equal(r.occlusion, occ);
    assert.equal(r.cleanliness, clean);
  }
});

await test('b4: cache hit — second identical measure returns the SAME result WITHOUT re-calling vision', async () => {
  const ffs = makeFakeFs();
  const spy = spyCallAI(visionOk(0.1, 0.85, 'bust'));
  const args = {
    candidate: mkCandidate('img-reuse'),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
  };
  const r1 = await measureHeroVision(args);
  const r2 = await measureHeroVision(args);
  assert.equal(spy.calls, 1, 'second call served from MEM cache — vision fired only once');
  assert.deepEqual(r2, r1, 'cache-hit result identical');
});

await test('b5: per-round ceiling caps vision at 12; _resetHeroVisionRound restores the budget', async () => {
  const spy = spyCallAI(visionOk());
  const runOne = (i) => measureHeroVision({
    candidate: mkCandidate('img-ceil-' + i), // unique ⇒ always a cache miss ⇒ tries vision
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  const results = [];
  for (let i = 0; i < PER_ROUND_CEILING + 3; i++) results.push(await runOne(i)); // 15 attempts, ceiling 12
  assert.equal(spy.calls, PER_ROUND_CEILING, `exactly ${PER_ROUND_CEILING} billed calls this round`);
  for (let i = 0; i < PER_ROUND_CEILING; i++) assert.ok(results[i], `attempt ${i} measured`);
  for (let i = PER_ROUND_CEILING; i < results.length; i++) assert.equal(results[i], undefined, `attempt ${i} over ceiling ⇒ absent`);
  _resetHeroVisionRound();
  const after = await runOne(999);
  assert.ok(after, 'after reset ⇒ measured again');
  assert.equal(spy.calls, PER_ROUND_CEILING + 1, 'one more call consumed after reset');
});

// ============================================================
// (c) STRICT PARSE — enum wrong / out-of-range / malformed ⇒ absent (all-or-nothing), NOT cached
// ============================================================
await test('c1: wrong / unknown enum token ⇒ absent, not cached (no silent map)', async () => {
  for (const bad of ['HEAD_SHOULDERS', 'headshoulders', 'torso', 'closeup', '', 'full body', null, 42]) {
    _clearHeroVisionCaches(); _resetHeroVisionRound();
    const ffs = makeFakeFs();
    const spy = spyCallAI(() => ({ occlusion: 0.1, cleanliness: 0.9, visible_body_region: bad }));
    const r = await measureHeroVision({
      candidate: mkCandidate('img-badenum'),
      deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.equal(r, undefined, `enum ${JSON.stringify(bad)} ⇒ absent`);
    assert.equal(spy.calls, 1, 'call happened but bad enum discarded');
    await _flushHeroVisionWrites();
    assert.ok(!ffs.store.has(FAKE_CACHE_PATH), 'bad enum ⇒ nothing cached');
  }
});

await test('c2: out-of-range / malformed occlusion OR cleanliness ⇒ absent, not cached', async () => {
  // Number(null)===0 is IN range, so null is not a bad case here; use genuinely bad values.
  for (const bad of [1.5, -0.1, NaN, 'high', {}, undefined]) {
    for (const which of ['occlusion', 'cleanliness']) {
      _clearHeroVisionCaches(); _resetHeroVisionRound();
      const ffs = makeFakeFs();
      const resp = { occlusion: 0.1, cleanliness: 0.9, visible_body_region: 'bust' };
      resp[which] = bad;
      const spy = spyCallAI(() => resp);
      const r = await measureHeroVision({
        candidate: mkCandidate('img-badnum'),
        deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
      });
      assert.equal(r, undefined, `${which}=${JSON.stringify(bad)} out of [0,1] ⇒ absent`);
      await _flushHeroVisionWrites();
      assert.ok(!ffs.store.has(FAKE_CACHE_PATH), `${which} bad ⇒ nothing cached`);
    }
  }
});

await test('c3: non-object / non-JSON vision response ⇒ absent', async () => {
  for (const resp of ['not-json', null, 123, [1, 2, 3]]) {
    _clearHeroVisionCaches(); _resetHeroVisionRound();
    const spy = spyCallAI(() => resp);
    const r = await measureHeroVision({
      candidate: mkCandidate('img-nonobj'),
      deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.equal(r, undefined, `response ${JSON.stringify(resp)} ⇒ absent`);
  }
});

await test('c4: partial result (one field missing) ⇒ absent — all-or-nothing (consumer needs 3)', async () => {
  const combos = [
    { cleanliness: 0.9, visible_body_region: 'bust' },                 // no occlusion
    { occlusion: 0.1, visible_body_region: 'bust' },                   // no cleanliness
    { occlusion: 0.1, cleanliness: 0.9 },                             // no region
  ];
  for (const resp of combos) {
    _clearHeroVisionCaches(); _resetHeroVisionRound();
    const ffs = makeFakeFs();
    const spy = spyCallAI(() => resp);
    const r = await measureHeroVision({
      candidate: mkCandidate('img-partial'),
      deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
    });
    assert.equal(r, undefined, `partial ${JSON.stringify(resp)} ⇒ absent`);
    await _flushHeroVisionWrites();
    assert.ok(!ffs.store.has(FAKE_CACHE_PATH), 'partial ⇒ nothing cached');
  }
});

await test('c5: no bindable candidate image hash ⇒ absent, zero calls', async () => {
  const spy = spyCallAI(visionOk());
  const r = await measureHeroVision({
    candidate: { image: CAND_IMG }, // pixels but no hash ⇒ cannot key cache ⇒ absent
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(r, undefined, 'no image identity hash ⇒ absent');
  assert.equal(spy.calls, 0, 'never attempted vision');
});

await test('c6: bindable hash but NO pixels ⇒ absent, vision not attempted', async () => {
  const spy = spyCallAI(visionOk());
  const r = await measureHeroVision({
    candidate: { imageHash: 'img-nopix' }, // hash present, no image
    deps: { env: onEnv(), fs: makeFakeFs(), cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(r, undefined, 'no candidate pixels ⇒ absent');
  assert.equal(spy.calls, 0, 'no pixels ⇒ vision not attempted');
});

// ============================================================
// (d) TIMEOUT / THROW ⇒ absent (silent)
// ============================================================
await test('d1: vision call exceeding the per-call timeout ⇒ absent, nothing cached', async () => {
  const ffs = makeFakeFs();
  const spy = spyCallAI(() => new Promise(() => { /* never settles */ }));
  const r = await measureHeroVision({
    candidate: mkCandidate('img-timeout'),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy, visionTimeoutMs: 15 },
  });
  assert.equal(r, undefined, 'timeout ⇒ absent');
  assert.equal(spy.calls, 1, 'the call was attempted then abandoned on timeout');
  await _flushHeroVisionWrites();
  assert.ok(!ffs.store.has(FAKE_CACHE_PATH), 'timeout result is never written to cache');
});

await test('d2: callAI throwing ⇒ absent (fail-closed), nothing cached', async () => {
  const ffs = makeFakeFs();
  const spy = spyCallAI(() => { throw new Error('provider 500'); });
  const r = await measureHeroVision({
    candidate: mkCandidate('img-throw'),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(r, undefined);
  await _flushHeroVisionWrites();
  assert.ok(!ffs.store.has(FAKE_CACHE_PATH), 'thrown vision ⇒ no cache write');
});

// ============================================================
// (e) CACHE via INJECTED fs — write/read, disk never touched; key isolates (hash, version)
// ============================================================
await test('e1: successful measure writes to the INJECTED fs under the (hash,version) key', async () => {
  const ffs = makeFakeFs();
  const spy = spyCallAI(visionOk(0.07, 0.88, 'three_quarter'));
  const r = await measureHeroVision({
    candidate: mkCandidate('img-e1'),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy, now: () => 42 },
  });
  assert.ok(r, 'measured');
  await _flushHeroVisionWrites();
  assert.ok(ffs.store.has(FAKE_CACHE_PATH), 'cache file written through the injected fs');
  const persisted = JSON.parse(ffs.store.get(FAKE_CACHE_PATH));
  const key = _heroVisionCacheKey('img-e1', HERO_VISION_PROMPT_VERSION);
  assert.ok(persisted[key], 'entry stored under the exact cache key');
  assert.equal(persisted[key].ts, 42, 'timestamp from injected clock (no real Date)');
  assert.equal(persisted[key].result.cleanliness, 0.88);
});

await test('e2: file-cache warm — a FRESH module cache reads the entry from injected fs, no re-call', async () => {
  const ffs = makeFakeFs();
  const seedSpy = spyCallAI(visionOk(0.09, 0.79, 'bust'));
  const args = (spy) => ({
    candidate: mkCandidate('img-e2'),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  await measureHeroVision(args(seedSpy));
  await _flushHeroVisionWrites();
  assert.equal(seedSpy.calls, 1);
  _clearHeroVisionCaches(); // drop mem + file-loaded flag; entry must be re-read from injected fs
  const r = await measureHeroVision(args(callThrows));
  assert.ok(r, 'served from file cache after cold mem');
  assert.equal(r.cleanliness, 0.79);
  assert.equal(callThrows.calls, 0, 'file-cache hit ⇒ vision never re-attempted');
});

await test('e3: cache key isolates (image hash, prompt version) — no field bleed; version bump re-measures', () => {
  const k = _heroVisionCacheKey('img', HERO_VISION_PROMPT_VERSION);
  assert.equal(k, _heroVisionCacheKey('img', HERO_VISION_PROMPT_VERSION), 'deterministic');
  assert.notEqual(_heroVisionCacheKey('ab', 'c'), _heroVisionCacheKey('a', 'bc'), 'no field bleed a|bc');
  assert.notEqual(_heroVisionCacheKey('img', 'hv1'), _heroVisionCacheKey('img', 'hv2'), 'prompt version bump invalidates');
  assert.notEqual(_heroVisionCacheKey('img1', 'v'), _heroVisionCacheKey('img2', 'v'), 'different image ⇒ different key');
});

await test('e4: promptVersion bump forces a re-measure (old cache entry does not satisfy the new key)', async () => {
  const ffs = makeFakeFs();
  // seed a cache entry under a STALE prompt version key — new key (current version) must miss
  const staleKey = _heroVisionCacheKey('img-ver', 'hv0-STALE');
  ffs.store.set(FAKE_CACHE_PATH, JSON.stringify({ [staleKey]: { ts: 1, result: { stale: true } } }));
  const spy = spyCallAI(visionOk(0.1, 0.9, 'bust'));
  const r = await measureHeroVision({
    candidate: mkCandidate('img-ver'),
    deps: { env: onEnv(), fs: ffs, cacheFile: FAKE_CACHE_PATH, callAI: spy },
  });
  assert.equal(spy.calls, 1, 'stale-version entry ignored ⇒ vision re-measures under current version');
  assert.equal(r.visibleBodyRegion, 'bust', 'fresh measurement returned');
});

// ============================================================
// (f) MIRROR + SOURCE GUARD — enum mirror; quarantine byte-unchanged vs a0a3985; bridge flag-gated
// ============================================================
await test('f1: HERO_VISION_BODY_REGIONS mirrors heroShotContract VISIBLE_BODY_REGIONS EXACTLY', () => {
  assert.deepEqual([...HERO_VISION_BODY_REGIONS], [...VISIBLE_BODY_REGIONS], 'enum tokens + order identical (no drift)');
});

await test('f2: _rhCastCandidate / _rhHeroCandidate consume heroVision (Batch 6 unquarantine); heroVision bridge flag-gated', () => {
  // normalize EOL: core.autocrlf checks out CRLF on Windows but git blobs are LF —
  // line-ending is a checkout artifact, not a content change, so compare LF-normalized.
  const nlf = (s) => s.replace(/\r\n/g, '\n');
  const src = nlf(fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8'));

  // ---- extract the (formerly quarantined) region [_rhCastCandidate .. _rhGlobalCandidate) ----
  const sliceRegion = (text) => {
    const a = text.indexOf('function _rhCastCandidate(');
    const b = text.indexOf('function _rhGlobalCandidate(');
    assert.ok(a !== -1 && b > a, 'consumer region boundaries found');
    return text.slice(a, b);
  };
  const nowRegion = sliceRegion(src);

  // ---- Batch 6 UNQUARANTINE: the two consumers no longer hardcode absent-authority verdicts; they
  //   elevate ONLY from the caller-resolved validated carriers (evidence.cropSafe/identityVerified and
  //   the hero `metrics` object built from identityById/metricsById/heroVisionById). heroVision supplies
  //   occlusion/cleanliness/visibleBodyRegion — three of the six hero metrics — so a hero candidate is
  //   now producible once every lane is present. Absent lane ⇒ undefined/null ⇒ the legacy HOLD stands. ----
  assert.ok(!/cropSafe: false,/.test(nowRegion), '_rhCastCandidate no longer hardcodes cropSafe:false');
  assert.ok(!/identityVerified: false,/.test(nowRegion), '_rhCastCandidate no longer hardcodes identityVerified:false');
  assert.ok(!/const identityConfidence = undefined;/.test(nowRegion), '_rhHeroCandidate no longer hardcodes identityConfidence=undefined');
  assert.ok(/const cropSafe = evidence\?\.cropSafe === true;/.test(nowRegion), 'cast cropSafe reads the validated evidence carrier');
  assert.ok(/const identityVerified = evidence\?\.identityVerified === true;/.test(nowRegion), 'cast identityVerified reads the validated evidence carrier');
  assert.ok(/const m = \(metrics && typeof metrics === 'object'\)/.test(nowRegion), '_rhHeroCandidate reads a validated per-candidate metrics carrier');
  // The heroVision-owned trio is sourced from that carrier (heroVisionById), never fabricated.
  for (const field of ['occlusion', 'cleanliness', 'visibleBodyRegion']) {
    assert.ok(new RegExp('const ' + field + ' = \\(m &&').test(nowRegion), field + ' is sourced from the metrics carrier');
  }

  // exactly one heroVision bridge call site, sitting AFTER the last MEGA_REF_HERO_V2 gate ⇒ flag OFF skips it
  const calls = src.match(/await _buildHeroVisionEvidenceV1\(/g) || [];
  assert.equal(calls.length, 1, 'exactly one heroVision bridge call site');
  const lastGate = src.lastIndexOf('if (_refHeroV2On)');
  const callAt = src.indexOf('await _buildHeroVisionEvidenceV1(');
  assert.ok(lastGate !== -1 && callAt > lastGate, 'heroVision bridge call is inside the flag-gated block');
  // authorityEvidence carries the detached shadow key
  assert.ok(/heroVisionById: _rhHeroVisionById/.test(src), 'authorityEvidence.heroVisionById wired (shadow)');
});

console.log(`\n# ${passed}/${passed + failed} passed`);
if (failed) { process.exitCode = 1; throw new Error(`${failed} test(s) failed`); }
