// ============================================================
// 🧪 BATCH-2 V2 fail-fast regression — offline unit fixture
// ------------------------------------------------------------
// Targets:
//   src/app/api/cover-ref-test/route.js  (runCoverRefTest)
//     • B2 pre-flight   — MEGA_REF_HERO_V2=1 without MEGA_STRICT_RENDER=1 ⇒ 422 STRICT_CONFIG_MISMATCH at t=0
//     • N1 compass gate — V2 mode + compass fail/empty ⇒ 422 COMPASS_REQUIRED_FOR_V2 before paying for search
//     • #8 clipframe    — bounded wait loop (≤6), clipframe fail/wait ≠ whole-job fail
//     • boundary gate   — content<100 / combined<200 ⇒ 400 NO_CONTENT (Codex batch-1 boundary note)
//   src/app/api/mega/tick/route.js       (_v2HoldDecision)
//     • N1-zombie bounded hold — refHeroV2.hold marker counts up, fails on 3rd; non-marker waits untouched
//
// OFFLINE 100%: every heavy leaf module is replaced by a process-local data:URL stub via a register() loader
//   hook (same technique as tests/ac0099-strict-ref-test.test.mjs). The route drives all pipeline stages
//   through its DI `deps` seam, so the real stage bodies are never reached — the stubs only need to LINK.
//   global.fetch is a bomb (no real network). No fs/db/env mutation (env is passed through deps, not process.env).
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

// ---- process-local module stubs (link-only; overridden at runtime by route deps) ----
const STUB_BRAINS = _mod(`export function compassBrain(){ throw new Error('REAL_BRAIN_FORBIDDEN_IN_TEST'); }`);
const STUB_ADAPTERS = _mod(`
const boom = (n) => async () => { throw new Error('REAL_'+n+'_FORBIDDEN_IN_TEST'); };
export const s5_case = boom('s5_case');
export const s5_keywords = boom('s5_keywords');
export const s5_search = boom('s5_search');
export const s5_triage = boom('s5_triage');
export const s5_clipframe = boom('s5_clipframe');
export const s6_slots = boom('s6_slots');
export const s7_cover = boom('s7_cover');
// stateful delegation (sol R2: ต้องเทส POST wiring จริง) — Proxy resolve ตอน access ให้เทสสลับ flow ได้ per-test
export const STAGE_FLOW = new Proxy({}, { get: (t, k) => (globalThis.__B2_STAGE_FLOW || {})[k] });
export async function unclaimCard(...a){ return globalThis.__B2_UNCLAIM ? globalThis.__B2_UNCLAIM(...a) : null; }
`);
const STUB_QC = _mod(`export function evaluateCoverQc(){ throw new Error('REAL_QC_FORBIDDEN_IN_TEST'); }`);
const STUB_COMPOSER = _mod(`
export async function composeAndVerify(){ throw new Error('REAL_COMPOSE_FORBIDDEN_IN_TEST'); }
export function _strictActivate(){ throw new Error('REAL_STRICT_ACTIVATE_FORBIDDEN_IN_TEST'); }
`);
const STUB_STORE = _mod(`export async function buildImagesRouteResponse(){ throw new Error('REAL_IMAGESTORE_FORBIDDEN_IN_TEST'); }`);
const STUB_JOBSTORE = _mod(`
// stateful delegation (sol R2) — default = ค่าว่างเดิม, เทส POST ฉีดผ่าน globalThis.__B2_JOBSTORE
const g = () => globalThis.__B2_JOBSTORE || {};
export const newJob = async (...a) => (g().newJob ? g().newJob(...a) : null);
export const listJobs = async (...a) => (g().listJobs ? g().listJobs(...a) : []);
export const getJob = async (...a) => (g().getJob ? g().getJob(...a) : null);
export const updateJob = async (...a) => (g().updateJob ? g().updateJob(...a) : null);
export const addRun = async (...a) => (g().addRun ? g().addRun(...a) : null);
export const findDoneRun = async (...a) => (g().findDoneRun ? g().findDoneRun(...a) : null);
export const listRuns = async (...a) => (g().listRuns ? g().listRuns(...a) : []);
export const getFlags = async () => (g().getFlags ? g().getFlags() : { id: 'mega-flags', paused: false, consecutiveFails: 0 });
export const setFlags = async (...a) => (g().setFlags ? g().setFlags(...a) : null);
`);
const STUB_LEASE = _mod(`
export async function acquireTickLease(){ return { ok: true, token: 't' }; }
export async function releaseTickLease(){ return null; }
`);
const STUB_NEXT = _mod(`export const NextResponse = { json: (obj, init) => ({ _body: obj, status: (init && init.status) || 200, json: async () => obj }) };`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/megaBrains') return { url: ${JSON.stringify(STUB_BRAINS)}, shortCircuit: true };
  if (specifier === '@/lib/megaAdapters') return { url: ${JSON.stringify(STUB_ADAPTERS)}, shortCircuit: true };
  if (specifier === '@/lib/coverQcGate') return { url: ${JSON.stringify(STUB_QC)}, shortCircuit: true };
  if (specifier === '@/lib/services/megaComposerService') return { url: ${JSON.stringify(STUB_COMPOSER)}, shortCircuit: true };
  if (specifier === '@/lib/imageStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/megaJobStore') return { url: ${JSON.stringify(STUB_JOBSTORE)}, shortCircuit: true };
  if (specifier === '@/lib/megaTickLease') return { url: ${JSON.stringify(STUB_LEASE)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// ---- fetch bomb BEFORE importing targets (no real network is ever allowed) ----
const ORIG_FETCH_DESC = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let fetchBombCalls = 0;
globalThis.fetch = () => { fetchBombCalls++; throw new Error('NETWORK_BOMB: global.fetch is forbidden in this test'); };
after(() => { if (ORIG_FETCH_DESC) Object.defineProperty(globalThis, 'fetch', ORIG_FETCH_DESC); else delete globalThis.fetch; });

const { runCoverRefTest } = await import('../src/app/api/cover-ref-test/route.js');
const { _v2HoldDecision, _holdReset, _v2ConfigMismatch, POST: tickPOST } = await import('../src/app/api/mega/tick/route.js');

// ============================================================
// tick POST integration harness (sol R2: pure-helper เทสอย่างเดียวพิสูจน์ wiring ไม่ได้)
//   ยิง POST จริงผ่าน stub delegation — บันทึกทุก updateJob/unclaimCard/setFlags
//   หมายเหตุ env: tick ไม่มี DI seam จึงต้อง mutate process.env จริงแบบ save/restore (แพทเทิร์นเดียวกับ withEnvMap ของ ac0099)
// ============================================================
async function runTickPOST({ env = {}, jobs = [], flow = {} }) {
  const calls = { updates: [], unclaims: 0, flags: [] };
  globalThis.__B2_STAGE_FLOW = flow;
  globalThis.__B2_UNCLAIM = () => { calls.unclaims++; return null; };
  globalThis.__B2_JOBSTORE = {
    listJobs: async () => jobs,
    updateJob: async (id, patch) => { calls.updates.push({ id, patch }); },
    setFlags: async (f) => { calls.flags.push(f); },
  };
  const KEYS = ['MEGA_REF_HERO_V2', 'MEGA_STRICT_RENDER'];
  const saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try {
    const res = await tickPOST({ nextUrl: { origin: 'http://test-origin' } });
    return { body: res._body, status: res.status, calls };
  } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    delete globalThis.__B2_STAGE_FLOW; delete globalThis.__B2_UNCLAIM; delete globalThis.__B2_JOBSTORE;
  }
}
const waitMarked = (h) => ({ status: 'waiting', nextAction: 'wait', dossierPatch: { pickImages: { refHeroV2: { ok: false, hold: h } } } });
const waitPlain = () => ({ status: 'waiting', nextAction: 'wait' });

// ============================================================
// route harness — drives runCoverRefTest with fully-stubbed stages via its DI deps seam.
//   env is injected through deps (route reads _env = deps.env), so no process.env mutation is needed.
// ============================================================
function harness(opts = {}) {
  const { env = {}, compassImpl, s5caseImpl, clipframeImpl, s6Impl } = opts;
  const calls = { compass: 0, s5_case: 0, s5_keywords: 0, s5_search: 0, s5_triage: 0, s5_clipframe: 0, s6_slots: 0, s7_cover: 0 };
  const done = () => ({ status: 'done', nextAction: 'continue' });
  const deps = {
    // stub the latch resolver so we never dynamic-import refSlotContract; guards read _env directly anyway.
    resolveLatchReport: async (e) => ({ canonicalLatch: 'MEGA_STRICT_RENDER', armed: e.MEGA_STRICT_RENDER === '1', armedProducer: e.MEGA_STRICT_RENDER === '1', _source: 'test-stub' }),
    compassBrain: async (args) => {
      calls.compass++;
      if (typeof compassImpl === 'function') return compassImpl(args, calls.compass);
      return { angle: 'มุมทดสอบ', primaryEmotion: 'warm', mainCharacters: [{ name: 'ก', role: 'hero' }], visualDreamShots: [] };
    },
    s5_case: async (job, o) => { calls.s5_case++; return (typeof s5caseImpl === 'function') ? s5caseImpl(job, o, calls.s5_case) : done(); },
    s5_keywords: async () => { calls.s5_keywords++; return done(); },
    s5_search: async () => { calls.s5_search++; return done(); },
    s5_triage: async () => { calls.s5_triage++; return done(); },
    s5_clipframe: async (job, o) => { calls.s5_clipframe++; return (typeof clipframeImpl === 'function') ? clipframeImpl(job, o, calls.s5_clipframe) : done(); },
    s6_slots: async (job, o) => { calls.s6_slots++; return (typeof s6Impl === 'function') ? s6Impl(job, o, calls.s6_slots) : { status: 'failed', nextAction: 'fail', summary: 'stub-s6-stop' }; },
    s7_cover: async () => { calls.s7_cover++; return { status: 'failed', nextAction: 'fail', summary: 'stub-s7-stop' }; },
    clipframeWaitMs: 0, // เทสห้าม sleep จริง (route default 5000ms ระหว่างรอบ clipframe wait)
    env,
  };
  return { deps, calls };
}
const bodyOf = (n) => 'ก'.repeat(n);
const GOOD_INPUT = { content: bodyOf(250), newsTitle: 'หัวข่าวทดสอบแบตช์สอง' };

// ============================================================ 1 — B2 pre-flight
test('1 V2 alone (no MEGA_STRICT_RENDER) → 422 STRICT_CONFIG_MISMATCH at t=0; compass never called', async () => {
  const { deps, calls } = harness({ env: { MEGA_REF_HERO_V2: '1' } });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(res.status, 422, `status (got ${res.status} ${JSON.stringify(res.body?.errorType)})`);
  assert.strictEqual(res.body.errorType, 'STRICT_CONFIG_MISMATCH');
  assert.strictEqual(res.body.holdReason, 'v2_producer_without_render_latch');
  assert.strictEqual(res.body.effectiveMode, 'strict');
  assert.strictEqual(res.body.authority, null);
  assert.strictEqual(calls.compass, 0, 'compass stub must not be called (decided before compass)');
  assert.strictEqual(calls.s5_case, 0, 's5_case never reached');
});

// ============================================================ 2 — N1 compass gate (empty mainCharacters)
test('2 V2+RENDER, compass returns no mainCharacters → 422 COMPASS_REQUIRED_FOR_V2; s5_case never called', async () => {
  const { deps, calls } = harness({
    env: { MEGA_REF_HERO_V2: '1', MEGA_STRICT_RENDER: '1' },
    compassImpl: () => ({ angle: 'x', primaryEmotion: 'warm', mainCharacters: [], visualDreamShots: [] }),
  });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(res.status, 422, `status (got ${res.status} ${JSON.stringify(res.body?.errorType)})`);
  assert.strictEqual(res.body.errorType, 'COMPASS_REQUIRED_FOR_V2');
  assert.strictEqual(res.body.holdReason, 'compass_empty_for_v2');
  assert.strictEqual(calls.compass, 1, 'compass evaluated exactly once');
  assert.strictEqual(calls.s5_case, 0, 's5_case stub must not be called (die before paying for search)');
});

// ============================================================ 3 — N1 compass gate (throw)
test('3 V2+RENDER, compass throws → 422 COMPASS_REQUIRED_FOR_V2; s5_case never called', async () => {
  const { deps, calls } = harness({
    env: { MEGA_REF_HERO_V2: '1', MEGA_STRICT_RENDER: '1' },
    compassImpl: () => { throw new Error('compass boom'); },
  });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(res.status, 422, `status (got ${res.status} ${JSON.stringify(res.body?.errorType)})`);
  assert.strictEqual(res.body.errorType, 'COMPASS_REQUIRED_FOR_V2');
  assert.strictEqual(calls.compass, 1);
  assert.strictEqual(calls.s5_case, 0);
});

// ============================================================ 4 — flag OFF parity (no new 422 at compass)
test('4 flag OFF, compass throws → original behavior: no V2 422 here, s5_case reached', async () => {
  const { deps, calls } = harness({
    env: {},
    compassImpl: () => { throw new Error('compass boom'); },
    s5caseImpl: () => ({ status: 'failed', nextAction: 'fail', summary: 's5 stop' }),
  });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(calls.compass, 1, 'compass attempted');
  assert.strictEqual(calls.s5_case, 1, 's5_case reached — original behavior preserved (compass fail ≠ whole-job fail when flag OFF)');
  assert.notStrictEqual(res.body.errorType, 'COMPASS_REQUIRED_FOR_V2');
  assert.notStrictEqual(res.body.errorType, 'STRICT_CONFIG_MISMATCH');
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.body.errorType, 'S5_CASE_FAILED');
});

// ============================================================ 5 — #8 s5_clipframe bounded wait loop
test('5a s5_clipframe wait×2 then done → called 3 times, proceeds to s6', async () => {
  const { deps, calls } = harness({
    env: {},
    clipframeImpl: (job, o, n) => (n <= 2 ? { status: 'waiting', nextAction: 'wait' } : { status: 'done', nextAction: 'continue' }),
  });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(calls.s5_clipframe, 3, 'clipframe called until non-wait (3 times)');
  assert.strictEqual(calls.s6_slots, 1, 's6 runs after clipframe resolves');
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.body.errorType, 'S6_SLOTS_FAILED');
});

test('5b s5_clipframe wait forever → bounded to 6 calls, still proceeds (clipframe wait ≠ whole-job fail)', async () => {
  const { deps, calls } = harness({
    env: {},
    clipframeImpl: () => ({ status: 'waiting', nextAction: 'wait' }),
  });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(calls.s5_clipframe, 6, 'bounded at 6 iterations');
  assert.strictEqual(calls.s6_slots, 1, 'proceeds to s6 (job is not failed at clipframe)');
  assert.strictEqual(res.body.errorType, 'S6_SLOTS_FAILED', 'failure surfaces at s6, not clipframe');
});

test('5c s5_clipframe returns failed once → NOT a whole-job fail (proceeds to s6, no S5_CLIPFRAME_FAILED)', async () => {
  const { deps, calls } = harness({
    env: {},
    clipframeImpl: () => ({ status: 'failed', nextAction: 'fail', summary: 'clipframe boom' }),
  });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(calls.s5_clipframe, 1, 'clipframe called once (failed, non-wait → loop breaks)');
  assert.strictEqual(calls.s6_slots, 1, 'clipframe failure does not abort the job — s6 still runs');
  assert.strictEqual(res.body.errorType, 'S6_SLOTS_FAILED');
});

// ============================================================ S6 waiting — route hold short-circuit
test('S6 waiting with a V2 hold marker → 422 STRICT_HOLD, exact hold reason, and no S7', async () => {
  const holdReason = 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS';
  const { deps, calls } = harness({
    env: { MEGA_REF_HERO_V2: '1', MEGA_STRICT_RENDER: '1' },
    s6Impl: () => ({
      status: 'waiting',
      nextAction: 'wait',
      summary: 'S6 waiting for sufficient cast assets',
      dossierPatch: { pickImages: { refHeroV2: { v: 1, ok: false, hold: holdReason } } },
    }),
  });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.body.errorType, 'STRICT_HOLD');
  assert.strictEqual(res.body.holdReason, holdReason);
  assert.notStrictEqual(res.body.holdReason, 'ref_hero_v2_carrier_not_ok');
  assert.strictEqual(calls.s7_cover, 0, 'S6 hold must short-circuit before S7');
});

test('S6 marker-less waiting → exact summary fallback and no S7', async () => {
  const summary = 'S6 waiting for operator review';
  const { deps, calls } = harness({
    env: { MEGA_STRICT_RENDER: '1' },
    s6Impl: () => ({ status: 'waiting', nextAction: 'wait', summary }),
  });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(res.body.holdReason, summary);
  assert.strictEqual(calls.s7_cover, 0, 'marker-less S6 wait must also short-circuit before S7');
});

// ============================================================ 6 — boundary gate (Codex batch-1 note)
test('6 boundary gate: content<100 → 400; combined<200 → 400; combined≥200 → passes (compass called)', async () => {
  // (a) content 99 chars → 400 NO_CONTENT, compass never reached
  {
    const { deps, calls } = harness({ env: {} });
    const res = await runCoverRefTest({ content: bodyOf(99), newsTitle: '' }, deps);
    assert.strictEqual(res.status, 400, `(a) status (got ${res.status})`);
    assert.strictEqual(res.body.errorType, 'NO_CONTENT');
    assert.strictEqual(calls.compass, 0);
  }
  // (b) content 100 + empty title → combined 100 (<200) → 400 NO_CONTENT
  {
    const { deps, calls } = harness({ env: {} });
    const res = await runCoverRefTest({ content: bodyOf(100), newsTitle: '' }, deps);
    assert.strictEqual(res.status, 400, `(b) status (got ${res.status})`);
    assert.strictEqual(res.body.errorType, 'NO_CONTENT');
    assert.strictEqual(calls.compass, 0);
  }
  // (c) content 150 + long title (60) → combined 212 (≥200) → passes gate, compass called
  {
    const { deps, calls } = harness({ env: {}, s5caseImpl: () => ({ status: 'failed', nextAction: 'fail', summary: 'stop' }) });
    const res = await runCoverRefTest({ content: bodyOf(150), newsTitle: 'ห'.repeat(60) }, deps);
    assert.strictEqual(calls.compass, 1, '(c) passes gate → compass called');
    assert.notStrictEqual(res.body.errorType, 'NO_CONTENT');
    assert.strictEqual(res.status, 502);
  }
  // (d) content 200 + empty title → combined 200 (≥200) → passes gate, compass called
  {
    const { deps, calls } = harness({ env: {}, s5caseImpl: () => ({ status: 'failed', nextAction: 'fail', summary: 'stop' }) });
    const res = await runCoverRefTest({ content: bodyOf(200), newsTitle: '' }, deps);
    assert.strictEqual(calls.compass, 1, '(d) passes gate → compass called');
    assert.notStrictEqual(res.body.errorType, 'NO_CONTENT');
    assert.strictEqual(res.status, 502);
  }
  // (e) combined exactly 199 → 400 (off-by-one ขอบล่างด่านสอง — audit sol แบตช์ 2)
  {
    const { deps, calls } = harness({ env: {} });
    const res = await runCoverRefTest({ content: bodyOf(150), newsTitle: 'ห'.repeat(47) }, deps); // 47+2+150 = 199
    assert.strictEqual(res.status, 400, `(e) status (got ${res.status})`);
    assert.strictEqual(res.body.errorType, 'NO_CONTENT');
    assert.strictEqual(calls.compass, 0);
  }
  // (f) join('\n\n') semantics: title 1 ตัว + content 197 → 1+2+197 = 200 → ผ่าน (ถ้าต่อสตริงเฉยๆ = 198 ต้องตก — พิสูจน์ตัวเชื่อม 2 ตัวอักษร)
  {
    const { deps, calls } = harness({ env: {}, s5caseImpl: () => ({ status: 'failed', nextAction: 'fail', summary: 'stop' }) });
    const res = await runCoverRefTest({ content: bodyOf(197), newsTitle: 'ก' }, deps);
    assert.strictEqual(calls.compass, 1, '(f) join เติม \\n\\n 2 ตัว → รวม 200 → ผ่าน gate');
    assert.strictEqual(res.status, 502);
  }
});

// ============================================================ 7 — compass มี element แต่ไร้ name (pin พฤติกรรม — audit code-auditor)
test('7 V2+RENDER, compass mainCharacters=[{}] (ไม่มี name) → guard ไม่ยิง เดินต่อถึง s5_case (S6 เป็นผู้ hold เองภายหลัง)', async () => {
  const { deps, calls } = harness({
    env: { MEGA_REF_HERO_V2: '1', MEGA_STRICT_RENDER: '1' },
    compassImpl: () => ({ angle: 'x', primaryEmotion: 'warm', mainCharacters: [{}], visualDreamShots: [] }),
    s5caseImpl: () => ({ status: 'failed', nextAction: 'fail', summary: 'stop' }),
  });
  const res = await runCoverRefTest(GOOD_INPUT, deps);
  assert.strictEqual(calls.compass, 1);
  assert.strictEqual(calls.s5_case, 1, 'guard เช็คแค่ length — [{}] ผ่าน (fail-fast เป็น subset ของเงื่อนไข S6 เท่านั้น)');
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.body.errorType, 'S5_CASE_FAILED');
});

// ============================================================ tick — _v2HoldDecision pure unit
test('T1 tick _v2HoldDecision: waiting WITHOUT refHeroV2.hold marker → isV2Hold false (byte-identical wait path)', () => {
  // s7 strict_render_not_armed dormancy (Checkpoint C design) — no dossierPatch
  assert.deepStrictEqual(
    _v2HoldDecision({}, { status: 'waiting', nextAction: 'wait', summary: 'strict_render_not_armed' }),
    { isV2Hold: false, holdCount: 0, shouldFail: false, holdCode: null },
  );
  // s5_triage/s5_search-style waiting with an unrelated dossierPatch — even a stale counter must not trigger
  assert.deepStrictEqual(
    _v2HoldDecision({ refHeroV2HoldCount: 5 }, { status: 'waiting', nextAction: 'wait', dossierPatch: { images: { keywordsCount: 3 } } }),
    { isV2Hold: false, holdCount: 0, shouldFail: false, holdCode: null },
  );
  // pickImages present but no refHeroV2 key (legacy s6) — untouched
  assert.deepStrictEqual(
    _v2HoldDecision({ refHeroV2HoldCount: 2 }, { status: 'waiting', nextAction: 'wait', dossierPatch: { pickImages: { slots: {} } } }),
    { isV2Hold: false, holdCount: 0, shouldFail: false, holdCode: null },
  );
  // ★ audit sol: marker ต้องเป็นสตริง REF_HERO_V2* — truthy รูปอื่นห้ามนับเด็ดขาด
  assert.deepStrictEqual(
    _v2HoldDecision({ refHeroV2HoldCount: 2 }, { status: 'waiting', nextAction: 'wait', dossierPatch: { pickImages: { refHeroV2: { hold: 'SOME_OTHER_HOLD' } } } }),
    { isV2Hold: false, holdCount: 0, shouldFail: false, holdCode: null },
  );
  assert.deepStrictEqual(
    _v2HoldDecision({}, { status: 'waiting', nextAction: 'wait', dossierPatch: { pickImages: { refHeroV2: { hold: true } } } }),
    { isV2Hold: false, holdCount: 0, shouldFail: false, holdCode: null },
  );
});

test('T2 tick _v2HoldDecision: refHeroV2.hold marker counts up 1→2→3 and fails on the 3rd consecutive round', () => {
  const mk = (h) => ({ status: 'waiting', nextAction: 'wait', dossierPatch: { pickImages: { refHeroV2: { v: 1, ok: false, hold: h } } } });
  assert.deepStrictEqual(
    _v2HoldDecision({}, mk('REF_HERO_V2_NO_CURRENT_NEWS_PEOPLE')),
    { isV2Hold: true, holdCount: 1, shouldFail: false, holdCode: 'REF_HERO_V2_NO_CURRENT_NEWS_PEOPLE' },
  );
  assert.deepStrictEqual(
    _v2HoldDecision({ refHeroV2HoldCount: 1 }, mk('REF_HERO_V2_NO_CURRENT_NEWS_PEOPLE')),
    { isV2Hold: true, holdCount: 2, shouldFail: false, holdCode: 'REF_HERO_V2_NO_CURRENT_NEWS_PEOPLE' },
  );
  const third = _v2HoldDecision({ refHeroV2HoldCount: 2 }, mk('REF_HERO_V2_STORY_BUILD_FAILED'));
  assert.deepStrictEqual(
    third,
    { isV2Hold: true, holdCount: 3, shouldFail: true, holdCode: 'REF_HERO_V2_STORY_BUILD_FAILED' },
    'the 3rd consecutive hold flips shouldFail true and carries the hold code for the failed-job summary',
  );
});

// ============================================================ T3/T4 — consecutive semantics + config mismatch (audit sol/code-auditor)
test('T3 tick consecutive semantics: _holdReset รีเซ็ตตัวนับเมื่อคั่นด้วยผลอื่น · งานไม่มี field = patch ว่าง (write เดิมทุก byte)', () => {
  const mk = (h) => ({ status: 'waiting', nextAction: 'wait', dossierPatch: { pickImages: { refHeroV2: { hold: h } } } });
  // hold 2 ครั้ง → คั่นด้วย non-marker (retry/continue/wait ธรรมดา จำลอง merge patch จาก _holdReset) → hold ใหม่นับ 1 ไม่ใช่ 3
  let job = {};
  job = { ...job, refHeroV2HoldCount: _v2HoldDecision(job, mk('REF_HERO_V2_X')).holdCount };
  job = { ...job, refHeroV2HoldCount: _v2HoldDecision(job, mk('REF_HERO_V2_X')).holdCount };
  assert.strictEqual(job.refHeroV2HoldCount, 2);
  job = { ...job, ..._holdReset(job) };
  assert.strictEqual(job.refHeroV2HoldCount, 0, 'ผลอื่นคั่น → รีเซ็ต');
  const again = _v2HoldDecision(job, mk('REF_HERO_V2_X'));
  assert.deepStrictEqual({ c: again.holdCount, f: again.shouldFail }, { c: 1, f: false }, 'นับใหม่จาก 1 — ต้อง "ติดกันจริง" 3 รอบถึงปิดงาน');
  // งานปกติ (ไม่มี field) → patch ว่าง = ก้อน updateJob เดิมทุก byte
  assert.deepStrictEqual(_holdReset({}), {});
  assert.deepStrictEqual(_holdReset({ refHeroV2HoldCount: 0 }), {});
  assert.deepStrictEqual(_holdReset(null), {});
});

test('T4 tick _v2ConfigMismatch: V2 เดี่ยว = true (พักสายพาน t=0) · ครบคู่/ปิดหมด/render เดี่ยว = false', () => {
  assert.strictEqual(_v2ConfigMismatch({ MEGA_REF_HERO_V2: '1' }), true);
  assert.strictEqual(_v2ConfigMismatch({ MEGA_REF_HERO_V2: '1', MEGA_STRICT_RENDER: '1' }), false);
  assert.strictEqual(_v2ConfigMismatch({}), false);
  assert.strictEqual(_v2ConfigMismatch({ MEGA_STRICT_RENDER: '1' }), false);
  assert.strictEqual(_v2ConfigMismatch(undefined), false);
});

test('T5 tick synthetic hold (sol R2): carrier ค้างในแฟ้ม + latch ปิด + wait ไร้ marker → นับเป็น hold · latch เปิด/ไม่มี carrier = ไม่แตะ', () => {
  const carrierJob = { refHeroV2HoldCount: 0, dossier: { pickImages: { refHeroV2: { ok: true } } } };
  // rollback scenario: V2 ปิดแล้ว latch ปิด → synthetic hold
  assert.deepStrictEqual(
    _v2HoldDecision(carrierJob, waitPlain(), {}),
    { isV2Hold: true, holdCount: 1, shouldFail: false, holdCode: 'REF_HERO_V2_CARRIER_WITHOUT_RENDER_LATCH' },
  );
  // ครบ 3 → ปิดงาน
  assert.strictEqual(_v2HoldDecision({ ...carrierJob, refHeroV2HoldCount: 2 }, waitPlain(), {}).shouldFail, true);
  // latch เปิด = เส้นทางปกติ (S7 เดินได้จริง) — ห้ามนับ
  assert.deepStrictEqual(
    _v2HoldDecision(carrierJob, waitPlain(), { MEGA_STRICT_RENDER: '1' }),
    { isV2Hold: false, holdCount: 0, shouldFail: false, holdCode: null },
  );
  // ไม่มี carrier ในแฟ้ม (งาน legacy/V1 strict dormancy ของ Checkpoint C) — ห้ามแตะแม้ latch ปิด
  assert.deepStrictEqual(
    _v2HoldDecision({ dossier: {} }, waitPlain(), {}),
    { isV2Hold: false, holdCount: 0, shouldFail: false, holdCode: null },
  );
  // non-wait ไม่เข้าเงื่อนไข synthetic
  assert.deepStrictEqual(
    _v2HoldDecision(carrierJob, { status: 'done', nextAction: 'continue' }, {}),
    { isV2Hold: false, holdCount: 0, shouldFail: false, holdCode: null },
  );
  // ★ sol R3: S7 เช็ค carrier แบบ own-property — carrier ค้างเป็น null/false ก็ยังทำ S7 wait ตลอดกาล ต้องนับด้วย
  assert.strictEqual(
    _v2HoldDecision({ dossier: { pickImages: { refHeroV2: null } } }, waitPlain(), {}).holdCode,
    'REF_HERO_V2_CARRIER_WITHOUT_RENDER_LATCH',
    'falsy carrier (own-property) ต้องเข้าตัวนับ synthetic',
  );
  assert.strictEqual(
    _v2HoldDecision({ dossier: { pickImages: { refHeroV2: false } } }, waitPlain(), {}).isV2Hold,
    true,
  );
  // pickImages ไม่มี key refHeroV2 เลย → ไม่แตะ (ขอบเขต own-property แท้)
  assert.strictEqual(
    _v2HoldDecision({ dossier: { pickImages: { slots: {} } } }, waitPlain(), {}).isV2Hold,
    false,
  );
});

// ============================================================ I — tick POST integration (sol R2: พิสูจน์ wiring จริง)
test('I1 tick POST: env V2 เดี่ยว → 503 STRICT_CONFIG_MISMATCH ก่อนแตะงานใดๆ (ไม่มี updateJob เลย)', async () => {
  const { body, status, calls } = await runTickPOST({ env: { MEGA_REF_HERO_V2: '1' }, jobs: [{ id: 'JX', status: 'waiting', stage: 't', dossier: {} }] });
  assert.strictEqual(status, 503);
  assert.strictEqual(body.errorType, 'STRICT_CONFIG_MISMATCH');
  assert.strictEqual(body.success, false);
  assert.strictEqual(calls.updates.length, 0, 'preflight ต้องมาก่อน job pick — งานห้ามถูกแตะ');
  assert.strictEqual(calls.unclaims, 0);
});

test('I2 tick POST: marked hold ครั้งที่ 3 → updateJob failed/red + unclaimCard 1 ครั้ง + ไม่ bump breaker', async () => {
  const job = { id: 'J1', status: 'waiting', stage: 't6', refHeroV2HoldCount: 2, dossier: {} };
  const flow = { t6: { label: 'เทส s6', next: 't7', run: async () => waitMarked('REF_HERO_V2_TEST_HOLD') } };
  const { calls } = await runTickPOST({ env: {}, jobs: [job], flow });
  const failedUpdate = calls.updates.find((u) => u.patch?.status === 'failed');
  assert.ok(failedUpdate, `ต้องมี updateJob failed (got ${JSON.stringify(calls.updates.map((u) => u.patch?.status))})`);
  assert.strictEqual(failedUpdate.patch.refHeroV2HoldCount, 3);
  assert.strictEqual(failedUpdate.patch.quality, 'red');
  assert.ok(String(failedUpdate.patch.summary || '').includes('REF_HERO_V2_TEST_HOLD'), 'summary ต้องพก hold code');
  assert.strictEqual(calls.unclaims, 1, 'ต้องคืนการ์ดเหมือนทุกเส้น failed');
  assert.strictEqual(calls.flags.length, 0, 'ห้าม bump/แตะ consecutiveFails (นโยบายแนว act===hold)');
});

test('I3 tick POST: wait ไร้ marker + งานมีตัวนับค้าง → updateJob waiting + รีเซ็ตตัวนับ + ไม่ unclaim', async () => {
  const job = { id: 'J2', status: 'waiting', stage: 't6', refHeroV2HoldCount: 2, dossier: {} };
  const flow = { t6: { label: 'เทส s6', next: 't7', run: async () => waitPlain() } };
  // ★ latch เปิดไว้ — กัน synthetic hold เข้ามาปน (เทสนี้พิสูจน์ reset spread ล้วนๆ)
  const { calls } = await runTickPOST({ env: { MEGA_STRICT_RENDER: '1' }, jobs: [job], flow });
  const w = calls.updates.find((u) => u.patch?.status === 'waiting');
  assert.ok(w, `ต้องมี updateJob waiting (got ${JSON.stringify(calls.updates.map((u) => u.patch?.status))})`);
  assert.strictEqual(w.patch.refHeroV2HoldCount, 0, 'ผลอื่นคั่น → ตัวนับต้องถูกรีเซ็ต (consecutive จริง)');
  assert.strictEqual(calls.unclaims, 0);
});

test('I4 tick POST: rollback scenario — carrier ค้าง + V2 ปิด + latch ปิด + wait ไร้ marker ครั้งที่ 3 → ปิดงาน + คืนการ์ด', async () => {
  const job = { id: 'J3', status: 'waiting', stage: 't7', refHeroV2HoldCount: 2, dossier: { pickImages: { refHeroV2: { ok: true } } } };
  const flow = { t7: { label: 'เทส s7', next: 'cover_ready', run: async () => waitPlain() } };
  const { calls } = await runTickPOST({ env: {}, jobs: [job], flow });
  const failedUpdate = calls.updates.find((u) => u.patch?.status === 'failed');
  assert.ok(failedUpdate, 'synthetic hold ต้องปิดงานได้จริงผ่าน POST');
  assert.ok(String(failedUpdate.patch.summary || '').includes('REF_HERO_V2_CARRIER_WITHOUT_RENDER_LATCH'));
  assert.strictEqual(calls.unclaims, 1);
});

// ============================================================ R — operator retry ต้องรีเซ็ตตัวนับ (sol R3 Medium)
test('R1 mega POST action=retry: งาน failed ที่มีตัวนับ hold ค้าง → patch ต้องรีเซ็ต refHeroV2HoldCount=0 (หน้าต่างใหม่ 3 รอบ)', async () => {
  const { POST: megaPOST } = await import('../src/app/api/mega/route.js');
  const updates = [];
  globalThis.__B2_JOBSTORE = {
    getJob: async () => ({ id: 'J9', status: 'failed', quality: 'red', stage: 't6', refHeroV2HoldCount: 3 }),
    updateJob: async (id, patch) => { updates.push({ id, patch }); return { id, ...patch }; },
  };
  try {
    const res = await megaPOST({ json: async () => ({ action: 'retry', id: 'J9' }) });
    assert.strictEqual(res._body.success, true);
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].patch.refHeroV2HoldCount, 0, 'retry = โอกาสใหม่ — ตัวนับต้องล้าง');
    assert.strictEqual(updates[0].patch.status, 'running');
  } finally {
    delete globalThis.__B2_JOBSTORE;
  }
});

test('R2 mega POST action=retry: งานปกติ (ไม่มีตัวนับ) → patch ไม่มี key refHeroV2HoldCount (พฤติกรรมเดิมเป๊ะ)', async () => {
  const { POST: megaPOST } = await import('../src/app/api/mega/route.js');
  const updates = [];
  globalThis.__B2_JOBSTORE = {
    getJob: async () => ({ id: 'J8', status: 'failed', quality: 'red', stage: 't3' }),
    updateJob: async (id, patch) => { updates.push({ id, patch }); return { id, ...patch }; },
  };
  try {
    await megaPOST({ json: async () => ({ action: 'retry', id: 'J8' }) });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(updates[0].patch, 'refHeroV2HoldCount'), false, 'งานไม่มี field → patch เดิมทุก key');
  } finally {
    delete globalThis.__B2_JOBSTORE;
  }
});

// ============================================================ W — clipframe delay จริง (sol R2: เทส delay 0 ไม่พิสูจน์ production sleep)
test('W clipframe wait จริงมี delay ระหว่างรอบ (ฉีด 30ms → 2 รอบ wait ต้องใช้เวลา ≥50ms)', async () => {
  const { deps, calls } = harness({
    env: {},
    clipframeImpl: (job, o, n) => (n <= 2 ? { status: 'waiting', nextAction: 'wait' } : { status: 'done', nextAction: 'continue' }),
  });
  deps.clipframeWaitMs = 30;
  const t0 = Date.now();
  await runCoverRefTest(GOOD_INPUT, deps);
  const elapsed = Date.now() - t0;
  assert.strictEqual(calls.s5_clipframe, 3);
  assert.ok(elapsed >= 50, `2 รอบ wait × 30ms ต้อง ≥50ms (got ${elapsed}ms)`);
});

// sanity: no real network was ever touched
test('Z no real network touched (fetch bomb count stays 0)', () => {
  assert.strictEqual(fetchBombCalls, 0, `fetch bomb must never fire (got ${fetchBombCalls})`);
});
