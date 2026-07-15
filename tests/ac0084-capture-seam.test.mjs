// ============================================================
// 🧪 AC-0084 operator-capture seam — offline regression (R1.6A AUDIT FIX)
// ------------------------------------------------------------
// Target: src/app/api/cover-ref-test/route.js
//   exports under test: _createCaptureClaimGate, handleCoverRefTestPost,
//   runCoverRefTest, runS7CaptureOnly, POST.
//
// R1.6A fixes an independent read-only audit's P1/P2 findings against the R1.6
// capture-only branch:
//   P1-1 snapshot corroboration: imageCaseSnapshot.images must be non-empty;
//     every row plain with canonical id+imageUrl; no duplicate row id/url;
//     every slot PRIMARY's id+imageUrl must match exactly one row; every
//     referenced BACKUP id must match exactly one row. Fails closed with typed
//     CAPTURE_* before S7 ever runs.
//   P1-2 ref authority: this capture closes ref-authority/W3-3, not ordinary
//     strict only — MEGA_REF_SHOT_AUTHORITY==='1' is now a required FIFTH
//     latch, and BOTH artBrief.refShotAuthority and pickImages.refShotAuthority
//     are required present (plain-shape only). Equality/staleness is NOT
//     recomputed here (no JSON.stringify comparator) — it is left entirely to
//     the REAL s7_cover producer's own canonical authority validation, which
//     surfaces a mismatch as a genuine 'waiting' -> CAPTURE_S7_NOT_DONE.
//   P1-3 pre-await proof: a genuinely deferred req.json() promise proves the
//     claim is settled before ANY body is read, under true concurrency (not
//     just Promise.all interleaving).
//   P2 assurance: complete forbidden ledgers (aiClient/coverQcGate/composer/
//     imageStore/archive/fs), exact SelectionSpec field assertions (not just
//     "object shaped"), and "byte-for-byte" wording corrected to
//     structural/deep parity wherever the comparison is deepStrictEqual on a
//     JS object (only the raw queueBody string is genuinely byte-level).
//   P2 size wording: CAPTURE_MAX_BYTES is documented (and tested) as a
//     UTF-8-byte bound on the POST-PARSE payload, not a raw request/chars bound.
//
// ── ASSURANCE BOUNDARY ───────────────────────────────────────────────────────
// This file lets the REAL src/lib/megaAdapters.js, src/lib/megaBrains.js,
// src/lib/refSlotContract.js, src/lib/refTemplate.js, and
// src/lib/imageQualityConfig.js resolve and run. The only stubbed leaf is
// src/lib/aiClient.js's callBrain (the true network/LLM boundary) — every real
// brain function (compassBrain/slotDirectorBrain/artBriefBrain/preflightBrain/
// judgeBrain/templateV1PersonAuthority) is the ACTUAL production code; we just
// always inject our own slotDirectorBrain/artBriefBrain via s6_slots's `_deps`
// seam so the real LLM-calling ones are never reached (callBrain leak-counted
// to prove it). coverQcGate/megaComposerService/imageStore/megaCoverArchive
// stay stubbed+leak-counted (unreachable from the capture-only path; the
// ordinary path always overrides them via deps in every test here).
// R1.6B wording fix: this offline harness proves the SEAM adds zero incremental EXTERNAL or WRITE I/O
// (no network, no fs write, no db) — it is NOT a claim of zero I/O whatsoever: the FIXTURE BUILD below
// intentionally does one local, read-only fs.readFileSync of the tracked data/ref-cover-library.json (a
// checked-in data file, not a network fetch or a write), to derive a genuine ref DNA record rather than
// hand-forging one. That single local read is the one deliberate exception and is disclosed here explicitly.
// This harness does NOT prove a genuine live capture is safe, and does NOT claim the resulting hashes/markers
// are cryptographic proof of provenance — a replay proves the S7 contract given the supplied inputs, nothing
// about how those inputs were obtained. See the route's own evidenceDisclaimer. LIVE remains HOLD pending a
// separate policy/change decision.
// The module-loader register() hook below is PROCESS-LOCAL: it only affects module resolution within this
// test process's lifetime and is never installed globally or written to disk.
//
// The FIXTURE_JOB below is built ONCE, offline, by running the REAL s6_slots
// (with MEGA_REF_SHOT_AUTHORITY=1, template_v1 engaged) against synthetic
// images + a hand-computed marker (via the REAL resolveRefSlotView/
// buildRefSlotContract — the same two functions megaBrains.js's own
// _templateV1Prep calls; we are not recreating the authority logic, only its
// thin wrapper, since injecting a fake artBriefBrain is required to avoid a
// real LLM call). It is a TEST FIXTURE — NOT real AC-0099 data, NOT real
// operator evidence.
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { register } from 'node:module';

// ---- R1.6B hermetic import-time env (fix): megaAdapters.js reads a number of switches as MODULE-TOP-LEVEL
// `const X = process.env.Y !== '0'`-style snapshots, evaluated ONCE at import — not just inside function
// bodies. To make this file's behavior independent of whatever the invoking shell happens to have set (not
// relying on ambient env), every env var megaAdapters.js reads anywhere (module-top-level OR call-time,
// including the five fixture/strict/ref-authority switches this file itself drives) is explicitly captured
// and CLEARED to a known clean slate BEFORE the production modules are ever imported below. Each is restored
// to its exact original value (present or absent) in cleanup.
const ENV_KEYS_TOUCHED = [
  // fixture/strict/ref-authority switches this file drives (call-time reads inside s6_slots/s7_cover, but
  // cleared before import too, per audit, for a fully hermetic slate regardless of where they're read)
  'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_STRICT_PRODUCER', 'MEGA_STRICT_RENDER', 'MEGA_REF_SHOT_AUTHORITY',
  // WAVE1A ref-hero-v2 (V2) flag the Group-C fixture/tests below drive (call-time read inside s6_slots/s7_cover) —
  // cleared to a clean slate before import too, per this file's hermetic contract, and restored exactly in cleanup.
  'MEGA_REF_HERO_V2',
  'MEGA_COVER_ORIGIN', 'MEGA_AC0084_CAPTURE_ONESHOT', 'MEGA_ROLE_READINESS', 'MEGA_STABLE_ORDER',
  // megaAdapters.js MODULE-TOP-LEVEL snapshots (evaluated once at import — genuinely hermetic-sensitive)
  'MEGA_MIN_EXTRACT_CHARS', 'MEGA_MIN_RELEVANT_IMAGES', 'MEGA_SEARCH_INITIAL_BATCH', 'MEGA_LENS', 'MEGA_LENS_SEEDS',
  'MEGA_YT_PARALLEL', 'MEGA_YT_WAIT_MIN', 'MEGA_S6_MIN_CLEAN', 'S6_REAL_SIZE_GATE', 'S6_STORY_FIT',
  'MEGA_SOLVER_DIAGNOSTICS_V2', 'MEGA_REF_ROLE_CONTRACT', 'MEGA_SOLVER_FAIR_UNIVERSE', 'MEGA_SELECTION_TRACE',
  'POOL_CLEAN_GATE', 'IMG_AUTO_PROFILE', 'IMG_GAP_SEARCH', 'MEGA_HERO_GRADE_HARD', 'MEGA_SHARPNESS_GATE',
  'MEGA_QUARANTINE', 'MEGA_CLIPFRAME_MIN_CLEAN_FACES', 'MEGA_CLIPFRAME_MIN_CLEAN_STORY', 'MEGA_SOLVER_SHADOW',
  // R1.6C fix: these were missed from the list above despite the file's claim to cover "every megaAdapters
  // env read" — MEGA_CANDIDATE_LEDGER and MEGA_FINAL_DECISION_EVIDENCE_V2 execute (call-time reads) inside
  // the real s6_slots call our own FIXTURE BUILD makes below; MEGA_QUEUE_ORIGIN/MEGA_SEARCH_PROVENANCE/
  // MEGA_SEARCH_SHADOW_V2/MEGA_SEARCH_OUTCOME_SHADOW_V1/SERPER_API_KEY are read elsewhere in megaAdapters.js
  // (not on the s6_slots/s7_cover path this file exercises, but included so the whole-file "every env read"
  // claim stays accurate rather than scoped only to the paths currently exercised).
  'MEGA_CANDIDATE_LEDGER', 'MEGA_FINAL_DECISION_EVIDENCE_V2', 'MEGA_QUEUE_ORIGIN', 'MEGA_SEARCH_OUTCOME_SHADOW_V1',
  'MEGA_SEARCH_PROVENANCE', 'MEGA_SEARCH_SHADOW_V2', 'SERPER_API_KEY',
];
const ORIG_ENV = Object.fromEntries(ENV_KEYS_TOUCHED.map((k) => [k, process.env[k]]));
const ORIG_FETCH_DESC = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const ORIG_DATE_NOW = Date.now;
const ORIG_LEAK = globalThis.__CAP_LEAK;
const ORIG_FS_WRITEFILE = fsp.writeFile;
const ORIG_FS_MKDIR = fsp.mkdir;
function restoreExactOriginals() {
  for (const k of ENV_KEYS_TOUCHED) { if (ORIG_ENV[k] === undefined) delete process.env[k]; else process.env[k] = ORIG_ENV[k]; }
  if (ORIG_FETCH_DESC) Object.defineProperty(globalThis, 'fetch', ORIG_FETCH_DESC); else delete globalThis.fetch;
  Date.now = ORIG_DATE_NOW;
  if (ORIG_LEAK === undefined) delete globalThis.__CAP_LEAK; else globalThis.__CAP_LEAK = ORIG_LEAK;
  fsp.writeFile = ORIG_FS_WRITEFILE;
  fsp.mkdir = ORIG_FS_MKDIR;
}
after(() => restoreExactOriginals());
// clear every touched key to a clean slate BEFORE any production module import below — this is what makes
// the module-top-level snapshots (and everything else) deterministic regardless of ambient shell env
for (const k of ENV_KEYS_TOUCHED) delete process.env[k];

function leak(name) {
  globalThis.__CAP_LEAK = globalThis.__CAP_LEAK || {};
  globalThis.__CAP_LEAK[name] = (globalThis.__CAP_LEAK[name] || 0) + 1;
}
// real fs writes are structurally unreachable from every code path this file exercises (runS7CaptureOnly has
// no persist/archive param at all; the ordinary path always overrides persistCoverImage/loadArchive via deps
// or short-circuits before reaching them) — this bomb is defense-in-depth, proving it explicitly rather than
// only by absence-of-evidence
fsp.writeFile = async (...args) => { leak('fsWriteFile'); throw new Error('FS_WRITE_FORBIDDEN_IN_TEST: ' + String(args[0]).slice(0, 80)); };
fsp.mkdir = async (...args) => { leak('fsMkdir'); throw new Error('FS_MKDIR_FORBIDDEN_IN_TEST: ' + String(args[0]).slice(0, 80)); };

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const STUB_AICLIENT = _mod(`
export function callBrain(){ globalThis.__CAP_LEAK = globalThis.__CAP_LEAK || {}; globalThis.__CAP_LEAK.callBrain = (globalThis.__CAP_LEAK.callBrain||0)+1; throw new Error('LLM_FORBIDDEN_IN_TEST'); }
`);
const STUB_QC = _mod(`
export function evaluateCoverQc(){ globalThis.__CAP_LEAK = globalThis.__CAP_LEAK || {}; globalThis.__CAP_LEAK.evaluateCoverQc = (globalThis.__CAP_LEAK.evaluateCoverQc||0)+1; throw new Error('QC_FORBIDDEN_IN_TEST'); }
`);
// composeAndVerify stays a throwing bomb (proves capture-only NEVER composes). _strictActivate is re-exported from
// the REAL module — it is a PURE, IO-free validator (the real megaComposerService has only light top-level imports;
// sharp/executeCover are dynamic-imported inside functions, so this pulls no heavy deps) — this is required by the
// P1-R2 shared-seam design so runS7CaptureOnly validates the wire through the SAME activation the composer uses.
const STUB_COMPOSER = _mod(`
export async function composeAndVerify(){ globalThis.__CAP_LEAK = globalThis.__CAP_LEAK || {}; globalThis.__CAP_LEAK.composeAndVerify = (globalThis.__CAP_LEAK.composeAndVerify||0)+1; throw new Error('COMPOSE_FORBIDDEN_IN_TEST'); }
export { _strictActivate } from ${JSON.stringify(new URL('lib/services/megaComposerService.js', SRC_ROOT).href)};
`);
const STUB_IMAGESTORE = _mod(`
export async function buildImagesRouteResponse(){ globalThis.__CAP_LEAK = globalThis.__CAP_LEAK || {}; globalThis.__CAP_LEAK.buildImagesRouteResponse = (globalThis.__CAP_LEAK.buildImagesRouteResponse||0)+1; throw new Error('IMAGESTORE_FORBIDDEN_IN_TEST'); }
`);
const STUB_ARCHIVE = _mod(`
export async function addMegaCover(){ globalThis.__CAP_LEAK = globalThis.__CAP_LEAK || {}; globalThis.__CAP_LEAK.addMegaCover = (globalThis.__CAP_LEAK.addMegaCover||0)+1; throw new Error('ARCHIVE_FORBIDDEN_IN_TEST'); }
`);
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };');
// megaBrains/megaAdapters/imageQualityConfig/refSlotContract/refTemplate are NOT stubbed — real production code.
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(STUB_AICLIENT)}, shortCircuit: true };
  if (specifier === '@/lib/coverQcGate') return { url: ${JSON.stringify(STUB_QC)}, shortCircuit: true };
  if (specifier === '@/lib/services/megaComposerService') return { url: ${JSON.stringify(STUB_COMPOSER)}, shortCircuit: true };
  if (specifier === '@/lib/imageStore') return { url: ${JSON.stringify(STUB_IMAGESTORE)}, shortCircuit: true };
  if (specifier === '@/lib/megaCoverArchive') return { url: ${JSON.stringify(STUB_ARCHIVE)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// ---- fetch bomb BEFORE dynamic import of the target (no real network ever) ----
let fetchBombCalls = 0;
globalThis.fetch = () => { fetchBombCalls++; throw new Error('NETWORK_BOMB: global.fetch is forbidden in this test'); };

const { _createCaptureClaimGate, handleCoverRefTestPost, runCoverRefTest, runS7CaptureOnly, POST } = await import('../src/app/api/cover-ref-test/route.js');
const { s6_slots, s7_cover, _dnaHashFor } = await import('../src/lib/megaAdapters.js');
const { resolveRefSlotView, buildRefSlotContract, validateStrictRenderActivation } = await import('../src/lib/refSlotContract.js');
// Batch 4B V2-hold fixture helpers — imported via the REAL relative path (NOT '@/lib/imageStore'), so they bypass the
// leak-counted STUB the module hook installs for '@/lib/imageStore'; calling them never touches __CAP_LEAK (B18 stays 0).
const { buildImagesRouteResponse: realBuildImagesRouteResponse } = await import('../src/lib/imageStore.js');
const { buildCandidateFactsV1 } = await import('../src/lib/candidateFactAuthority.js');

// ---- Date.now fixing (byte determinism) ----
const REAL_NOW = ORIG_DATE_NOW;
const FIXED_TS = 1770000000000;
async function withFixedNow(fn) {
  Date.now = () => FIXED_TS;
  try { return await fn(); } finally { Date.now = REAL_NOW; }
}
async function withEnvMap(map, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(map)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const cloneJson = (v) => JSON.parse(JSON.stringify(v));

// ============================================================
// FIXTURE BUILD — run the REAL s6_slots ONCE, offline, with MEGA_REF_SHOT_AUTHORITY=1 (template_v1 engaged),
// against synthetic images, to produce a genuinely valid post-S6 dossier carrying a REAL paired
// artBrief.refShotAuthority + pickImages.refShotAuthority marker. TEST FIXTURE ONLY.
// ============================================================
const CAPTURE_HOST = 'http://127.0.0.2:3900';
const LATCH_KEY = 'MEGA_AC0084_CAPTURE_ONESHOT';
const CAPTURE_SCHEMA = 'ac0084-s7-capture-v1';
const FIXTURE_CASE_ID = 'CAP-0084-FIXTURE';
const FIXTURE_BUILD_ENV = { MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1', MEGA_STRICT_PRODUCER: '1', MEGA_STRICT_RENDER: '1', MEGA_REF_SHOT_AUTHORITY: '1' };

const IMG = (id, t = {}, top = {}) => ({
  id,
  imageUrl: `https://cdn.test/${id}.jpg`,
  thumbnailUrl: '',
  source: 'SynthNews Desk',
  sourceLink: `https://source.test/${id}`,
  width: 800, height: 1000, realWidth: 900, realHeight: 1200,
  ...top,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: null, persons: [],
    category: 'context', emotion: 'warm', note: '', newsScene: true, quality: 7,
    realShortSide: 900, sharpness: 80,
    ...t,
  },
});
const HERO_NAME = 'ทดสอบเอก';
const SECOND_NAME = 'ทดสอบโท';
const F_HERO = IMG('F-HERO-OK', { person: HERO_NAME, category: 'face-emotional', faceBox: { x1: 0.35, y1: 0.20, x2: 0.65, y2: 0.55 }, realShortSide: 1200, note: 'ตัวเอกหน้าชัดกลางภาพ (fixture)' }, { realWidth: 1300, realHeight: 1200 });
const F_CIRC = IMG('F-CIRC', { person: SECOND_NAME, category: 'face-neutral', faceBox: { x1: 0.35, y1: 0.22, x2: 0.62, y2: 0.52 }, note: 'บุคคลที่สอง (fixture)' });
const F_CTX = [
  IMG('F-CTX-1', { person: null, faceCount: 0, category: 'context', note: 'สถานที่ (fixture)' }),
  IMG('F-CTX-2', { person: null, faceCount: 0, category: 'document', note: 'เอกสาร (fixture)' }),
  IMG('F-CTX-3', { person: null, faceCount: 0, category: 'context', note: 'บรรยากาศ (fixture)' }),
];
const F_JUNK = Array.from({ length: 8 }, (_, i) => IMG(`F-JUNK-${String(i + 1).padStart(2, '0')}`, { person: null, faceCount: 0, category: 'other', quality: 3, note: `ภาพประกอบทดสอบ ${i + 1}` }));
const FIXTURE_POOL = [F_HERO, F_CIRC, ...F_CTX, ...F_JUNK];
const FIXTURE_CHARS = [{ name: HERO_NAME, role: 'hero' }, { name: SECOND_NAME, role: 'related' }];

// real DNA from the local library (tracked, same record already proven valid by tests/ac0099-strict-ref-test.test.mjs)
const refs = JSON.parse(fs.readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
const FIXTURE_REF_REC = refs.find((r) => r.id === 'REF-mrbqalpo-h1r1');
assert.ok(FIXTURE_REF_REC?.dna, 'fixture-build: ref DNA REF-mrbqalpo-h1r1 must exist in local library');
const FIXTURE_DNA = FIXTURE_REF_REC.dna;
const FIXTURE_REF_ID = FIXTURE_REF_REC.id;
const FIXTURE_DNA_HASH = _dnaHashFor(FIXTURE_DNA);
const FIXTURE_REF_BOUND_AT = new Date(FIXED_TS).toISOString();

// marker: the SAME two-function call megaBrains.js's own _templateV1Prep makes (real resolveRefSlotView +
// buildRefSlotContract) — we port only the thin wrapper, not the authority logic, because injecting our own
// artBriefBrain (to avoid a real LLM call) means we must supply what the real one would have attached.
const FIXTURE_VIEW = resolveRefSlotView(FIXTURE_DNA, { mode: 'template_v1' });
const FIXTURE_CONTRACT = buildRefSlotContract({ refDNA: FIXTURE_DNA, mode: 'template_v1' });
assert.strictEqual(FIXTURE_CONTRACT.authority?.axisReady, true, 'fixture-build: real buildRefSlotContract must report axisReady for REF-mrbqalpo-h1r1');
const FIXTURE_MARKER = Object.freeze({ v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: FIXTURE_CONTRACT.authority.effectiveViewHash });
const FIXTURE_ORDERS = FIXTURE_VIEW.views.map((v) => ({
  i: v.index, role: v.role, pos: v.pos || '', shot: v.shot || '', emotion: v.emotion || '', faceSizePct: v.faceSizePct || null,
  want: 'ทดสอบ', personHint: v.role === 'hero' ? HERO_NAME : v.role === 'reaction' ? SECOND_NAME : null,
}));
const FIXTURE_ANSWER = {
  hero: { id: 'F-HERO-OK', reason: 'ตัวเอก', backups: [] },
  context: { id: 'F-CTX-1', reason: 'สถานที่', backups: [] },
  action: { id: 'F-CTX-3', reason: 'บรรยากาศ', backups: [] },
  moment: { id: 'F-CTX-2', reason: 'หลักฐาน', backups: [] },
  reaction: { id: 'F-CIRC', reason: 'คนที่สอง', backups: [] },
};
const mkFixtureRefMatch = () => ({ dna: FIXTURE_DNA, styleName: 'capture-fixture', typeMatched: true, imagePath: '/ref-covers/capture-fixture.jpg', refId: FIXTURE_REF_ID, dnaHash: FIXTURE_DNA_HASH, refBoundAt: FIXTURE_REF_BOUND_AT });

const FIXTURE_BUILD_RESULT = await withEnvMap(FIXTURE_BUILD_ENV, () => withFixedNow(async () => {
  const job = {
    id: 'CAPTURE-FIXTURE-JOB',
    dossier: {
      images: { caseId: FIXTURE_CASE_ID },
      compass: { angle: 'มุมทดสอบ capture-only', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: FIXTURE_CHARS, visualDreamShots: [], doNotUse: [] },
      desk: { title: 'ข่าวทดสอบ capture-only fixture' },
      refMatch: mkFixtureRefMatch(),
      // template_v1 fresh-arm resume shape: artBrief pre-marked, pickImages not yet present — s6_slots reads
      // this, validates the marker's shape+person-authority, and echoes it (paired) into pickImages itself.
      artBrief: { storyNote: 'เรื่องทดสอบ fixture', orders: FIXTURE_ORDERS, refShotAuthority: FIXTURE_MARKER },
    },
  };
  const deps = {
    artBriefBrain: async () => { throw new Error('fixture-build: artBriefBrain must not be called — artBrief is pre-set'); },
    slotDirectorBrain: async () => ({ slots: FIXTURE_ANSWER, note: 'synthetic-fixture' }),
    fetchJson: async (url) => {
      if (String(url).includes('/api/images/')) return { success: true, images: FIXTURE_POOL };
      throw new Error('fixture-build: unexpected fetch ' + url);
    },
  };
  const s6 = await s6_slots(job, { origin: 'http://mock', _deps: deps });
  assert.strictEqual(s6.status, 'done', `fixture-build: s6_slots must complete done (got ${s6.status} ${s6.summary || ''})`);
  Object.assign(job.dossier, s6.dossierPatch);
  assert.ok(job.dossier.pickImages?.refShotAuthority, 'fixture-build: real S6 must echo a paired refShotAuthority marker into pickImages');
  return job;
}));
// FROZEN fixture — every test below works off a fresh cloneJson() of this, never the live object
const FIXTURE_JOB = Object.freeze(cloneJson(FIXTURE_BUILD_RESULT));
const FIXTURE_SNAPSHOT = Object.freeze({ caseId: FIXTURE_CASE_ID, images: FIXTURE_POOL });

function mkPayload(jobMutator, snapshotOverride) {
  const job = cloneJson(FIXTURE_JOB);
  if (typeof jobMutator === 'function') jobMutator(job);
  return { schema: CAPTURE_SCHEMA, job, imageCaseSnapshot: snapshotOverride !== undefined ? snapshotOverride : cloneJson(FIXTURE_SNAPSHOT) };
}
const CAPTURE_RUN_ENV = { ...FIXTURE_BUILD_ENV, MEGA_COVER_ORIGIN: CAPTURE_HOST };
async function runCapture(payload, deps, envOverride) {
  return withEnvMap(envOverride || CAPTURE_RUN_ENV, () => withFixedNow(() => runS7CaptureOnly(payload, deps || {})));
}

// ============================================================
// Group A — capture claim gate + handleCoverRefTestPost branch (granted ⇒ ONLY captureRunner,
// mismatch ⇒ ONLY the ordinary runner, never both, never a fallback)
// ============================================================
function mkSpy(result) {
  const calls = [];
  const fn = async (input, deps) => { calls.push({ input, deps }); return typeof result === 'function' ? result(input, deps) : result; };
  fn.calls = calls;
  return fn;
}
function mkJsonResponder() {
  const calls = [];
  const fn = (body, init) => { const r = { body, status: (init && init.status) || 200 }; calls.push(r); return r; };
  fn.calls = calls;
  return fn;
}
function mkReq(origin, jsonImpl = async () => ({ schema: CAPTURE_SCHEMA })) {
  return { nextUrl: { origin }, json: jsonImpl };
}

test('A1 exact origin+latch grants the claim; ONLY captureRunner is called (never the ordinary runner); response passes through', async () => {
  const gate = _createCaptureClaimGate();
  const runner = mkSpy({ status: 200, body: { success: true, marker: 'should-never-run' } });
  const captureRunner = mkSpy({ status: 200, body: { success: true, mode: 'capture_only', marker: 'A1' } });
  const jsonResponder = mkJsonResponder();
  const out = await handleCoverRefTestPost({ req: mkReq(CAPTURE_HOST), runner, captureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder });
  assert.strictEqual(captureRunner.calls.length, 1, 'captureRunner called exactly once');
  assert.strictEqual(runner.calls.length, 0, 'ordinary runner NEVER called on a granted claim');
  assert.deepStrictEqual(captureRunner.calls[0].deps, { env: { [LATCH_KEY]: '1' } }, 'captureRunner receives only {env} — structural deep-equal, no extra fields');
  assert.strictEqual(out.status, 200);
  assert.deepStrictEqual(out.body, { success: true, mode: 'capture_only', marker: 'A1' });
});

test('A2 near/hostile origins and non-exact latch values never match and never consume; ordinary runner runs (never captureRunner); the SAME gate then still grants a genuinely exact claim to ONLY captureRunner', async () => {
  const gate = _createCaptureClaimGate();
  const cases = [
    { label: 'subdomain-suffix', origin: CAPTURE_HOST + '.evil.com', env: { [LATCH_KEY]: '1' } },
    { label: 'https-not-http', origin: 'https://127.0.0.2:3900', env: { [LATCH_KEY]: '1' } },
    { label: 'off-by-one-ip', origin: 'http://127.0.0.3:3900', env: { [LATCH_KEY]: '1' } },
    { label: 'trailing-slash', origin: CAPTURE_HOST + '/', env: { [LATCH_KEY]: '1' } },
    { label: 'latch-trailing-space', origin: CAPTURE_HOST, env: { [LATCH_KEY]: '1 ' } },
    { label: 'latch-number-1', origin: CAPTURE_HOST, env: { [LATCH_KEY]: 1 } },
    { label: 'latch-absent', origin: CAPTURE_HOST, env: {} },
  ];
  for (const c of cases) {
    const runner = mkSpy({ status: 200, body: { success: true, marker: c.label } });
    const captureRunner = mkSpy({ status: 200, body: { success: true, marker: 'should-never-run' } });
    const jsonResponder = mkJsonResponder();
    const out = await handleCoverRefTestPost({ req: mkReq(c.origin), runner, captureRunner, env: c.env, claimGate: gate, jsonResponder });
    assert.strictEqual(runner.calls.length, 1, `${c.label}: ordinary runner still called normally`);
    assert.strictEqual(captureRunner.calls.length, 0, `${c.label}: captureRunner never called on a mismatch`);
    assert.deepStrictEqual(runner.calls[0].deps, {}, `${c.label}: ordinary runner deps are exactly {} — no capture-only fields/args, no behavior drift`);
    assert.strictEqual(out.status, 200, `${c.label}: no 409, normal passthrough status`);
    assert.deepStrictEqual(out.body, { success: true, marker: c.label }, `${c.label}: body passthrough unchanged`);
  }
  const finalRunner = mkSpy({ status: 200, body: { success: true, marker: 'should-never-run' } });
  const finalCaptureRunner = mkSpy({ status: 200, body: { success: true, marker: 'A2-final-valid' } });
  const finalJsonResponder = mkJsonResponder();
  const finalOut = await handleCoverRefTestPost({ req: mkReq(CAPTURE_HOST), runner: finalRunner, captureRunner: finalCaptureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder: finalJsonResponder });
  assert.strictEqual(finalCaptureRunner.calls.length, 1, 'final exact claim reaches captureRunner');
  assert.strictEqual(finalRunner.calls.length, 0, 'final exact claim never touches the ordinary runner');
  assert.strictEqual(finalOut.status, 200);
  assert.deepStrictEqual(finalOut.body, { success: true, marker: 'A2-final-valid' });
});

test('A3 the claim happens synchronously before req.json() — a rejecting json() does not undo consumption; captureRunner still receives the fallback empty body', async () => {
  const gate = _createCaptureClaimGate();
  const runner = mkSpy({ status: 200, body: { success: true } });
  const captureRunner = mkSpy({ status: 200, body: { success: true, mode: 'capture_only' } });
  const jsonResponder = mkJsonResponder();
  const badReq = mkReq(CAPTURE_HOST, async () => { throw new Error('json boom'); });
  const out1 = await handleCoverRefTestPost({ req: badReq, runner, captureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder });
  assert.strictEqual(captureRunner.calls.length, 1, 'captureRunner still ran despite json() rejecting');
  assert.deepStrictEqual(captureRunner.calls[0].input, {}, 'captureRunner receives the {} fallback body from the swallowed json() rejection');
  assert.strictEqual(runner.calls.length, 0);
  assert.strictEqual(out1.status, 200);

  const out2 = await handleCoverRefTestPost({ req: mkReq(CAPTURE_HOST), runner, captureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder });
  assert.strictEqual(captureRunner.calls.length, 1, 'second call never reaches captureRunner again — claim already consumed');
  assert.strictEqual(out2.status, 409);
  assert.strictEqual(out2.body.errorType, 'OPERATOR_CAPTURE_ALREADY_USED');
});

test('A3b P1-3 pre-await proof via a GENUINELY DEFERRED req.json() promise: while the first request is suspended before its body resolves, a second exact request is immediately typed 409 with zero body reads and zero runner calls; releasing the first afterward yields exactly one capture call', async () => {
  const gate = _createCaptureClaimGate();
  let releaseFirstJson;
  const firstJsonPromise = new Promise((resolve) => { releaseFirstJson = resolve; });
  let firstJsonReadCount = 0;
  const firstReq = { nextUrl: { origin: CAPTURE_HOST }, json: async () => { firstJsonReadCount++; return firstJsonPromise; } };
  const runner = mkSpy({ status: 200, body: { success: true, marker: 'should-never-run' } });
  const captureRunner = mkSpy({ status: 200, body: { success: true, marker: 'first' } });
  const jsonResponder = mkJsonResponder();

  // start the first request but do NOT await it — it must suspend inside req.json()
  const firstPromise = handleCoverRefTestPost({ req: firstReq, runner, captureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder });
  await Promise.resolve(); await Promise.resolve(); // let microtasks run up to the suspension point
  assert.strictEqual(firstJsonReadCount, 1, 'first request already called req.json() once and is now suspended awaiting it');
  assert.strictEqual(captureRunner.calls.length, 0, 'capture runner not yet called — first request still suspended on body read');

  // second exact request while the first is STILL suspended: must be rejected immediately, without reading
  // its own body or touching either runner — this is the real proof the claim was decided before any body I/O
  let secondJsonReadCount = 0;
  const secondReq = { nextUrl: { origin: CAPTURE_HOST }, json: async () => { secondJsonReadCount++; return {}; } };
  const secondOut = await handleCoverRefTestPost({ req: secondReq, runner, captureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder });
  assert.strictEqual(secondOut.status, 409);
  assert.strictEqual(secondOut.body.errorType, 'OPERATOR_CAPTURE_ALREADY_USED');
  assert.strictEqual(secondJsonReadCount, 0, 'second request never read its own body (=0 reads)');
  assert.strictEqual(captureRunner.calls.length, 0, 'capture runner still =0 after the second rejected request');
  assert.strictEqual(runner.calls.length, 0, 'ordinary runner still =0');

  // release the first request's body — NOW it may complete
  releaseFirstJson({ schema: CAPTURE_SCHEMA });
  const firstOut = await firstPromise;
  assert.strictEqual(captureRunner.calls.length, 1, 'exactly one capture-runner call total, from the first request only');
  assert.strictEqual(runner.calls.length, 0);
  assert.strictEqual(firstOut.status, 200);
  assert.deepStrictEqual(firstOut.body, { success: true, marker: 'first' });
});

test('A4 concurrent Promise.all: exactly one captureRunner invocation total, the other gets a typed 409 before reaching either runner', async () => {
  const gate = _createCaptureClaimGate();
  const runner = mkSpy({ status: 200, body: { success: true, marker: 'should-never-run' } });
  const captureRunner = mkSpy({ status: 200, body: { success: true, marker: 'A4' } });
  const jsonResponder = mkJsonResponder();
  const [r1, r2] = await Promise.all([
    handleCoverRefTestPost({ req: mkReq(CAPTURE_HOST), runner, captureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder }),
    handleCoverRefTestPost({ req: mkReq(CAPTURE_HOST), runner, captureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder }),
  ]);
  assert.strictEqual(captureRunner.calls.length, 1, 'captureRunner invoked exactly once across both concurrent requests');
  assert.strictEqual(runner.calls.length, 0, 'ordinary runner never invoked');
  const statuses = [r1.status, r2.status].sort((a, b) => a - b);
  assert.deepStrictEqual(statuses, [200, 409]);
  const rejected = r1.status === 409 ? r1 : r2;
  assert.strictEqual(rejected.body.errorType, 'OPERATOR_CAPTURE_ALREADY_USED');
});

test('A5 captureRunner throwing on the first valid claim still leaves the one-shot consumed', async () => {
  const gate = _createCaptureClaimGate();
  const throwingCaptureRunner = async () => { throw new Error('capture runner boom'); };
  const runner = mkSpy({ status: 200, body: { success: true } });
  const jsonResponder = mkJsonResponder();
  const out1 = await handleCoverRefTestPost({ req: mkReq(CAPTURE_HOST), runner, captureRunner: throwingCaptureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder });
  assert.strictEqual(out1.status, 500);
  assert.strictEqual(out1.body.errorType, 'UNEXPECTED');
  const okCaptureRunner = mkSpy({ status: 200, body: { success: true } });
  const out2 = await handleCoverRefTestPost({ req: mkReq(CAPTURE_HOST), runner, captureRunner: okCaptureRunner, env: { [LATCH_KEY]: '1' }, claimGate: gate, jsonResponder });
  assert.strictEqual(okCaptureRunner.calls.length, 0, 'second call never reaches captureRunner — first throwing call already consumed the claim');
  assert.strictEqual(runner.calls.length, 0);
  assert.strictEqual(out2.status, 409);
});

test('A6 mismatch preserves the ordinary runner result exactly, with structural/deep parity (deepStrictEqual — this is an object comparison, not a byte comparison), no wrapping, no capture fields — omitted vs explicit-false vs default all identical', async () => {
  const runnerResult = { status: 201, body: { success: true, custom: 'field', nested: { a: 1, b: [1, 2, 3] } } };
  const scenarios = [
    { label: 'env-omitted', origin: 'http://localhost:3000', env: undefined },
    { label: 'env-explicit-empty', origin: 'http://localhost:3000', env: {} },
    { label: 'env-latch-explicit-false-string', origin: 'http://localhost:3000', env: { [LATCH_KEY]: 'false' } },
    { label: 'right-latch-wrong-origin', origin: 'http://localhost:3000', env: { [LATCH_KEY]: '1' } },
  ];
  const bodies = [];
  for (const s of scenarios) {
    const gate = _createCaptureClaimGate();
    const runner = mkSpy(runnerResult);
    const captureRunner = mkSpy({ status: 200, body: { success: true, marker: 'should-never-run' } });
    const jsonResponder = mkJsonResponder();
    const out = await handleCoverRefTestPost({ req: mkReq(s.origin, async () => ({ content: 'plain' })), runner, captureRunner, env: s.env, claimGate: gate, jsonResponder });
    assert.strictEqual(captureRunner.calls.length, 0, `${s.label}: captureRunner never touched`);
    assert.strictEqual(runner.calls.length, 1, `${s.label}: ordinary runner called once`);
    assert.deepStrictEqual(runner.calls[0].deps, {}, `${s.label}: ordinary runner deps exactly {} — no capture fields present at all`);
    assert.strictEqual(out.status, runnerResult.status, `${s.label}: status structural parity`);
    assert.deepStrictEqual(out.body, runnerResult.body, `${s.label}: body structural/deep parity (deepStrictEqual)`);
    bodies.push(out.body);
  }
  for (let i = 1; i < bodies.length; i++) assert.deepStrictEqual(bodies[i], bodies[0], `scenario ${i} body structurally identical to scenario 0`);
});

test('A7 the REAL exported POST() delegates through actual production wiring for BOTH branches (see file-header assurance boundary — coverQcGate/composer/imageStore/archive are still stubbed; megaBrains/megaAdapters/refSlotContract/refTemplate are real)', async () => {
  const savedLatch = process.env[LATCH_KEY];
  const fetchBombBefore = fetchBombCalls;
  try {
    delete process.env[LATCH_KEY];
    const mismatchReq = { nextUrl: { origin: 'http://localhost:3000' }, json: async () => ({ content: 'สั้นเกินไป', newsTitle: 'x' }) };
    const outMismatch = await POST(mismatchReq);
    assert.strictEqual(outMismatch.status, 400, `mismatch branch NO_CONTENT status (got ${outMismatch.status})`);
    assert.strictEqual(outMismatch._body?.errorType, 'NO_CONTENT');

    process.env[LATCH_KEY] = '1';
    const grantedReq = { nextUrl: { origin: CAPTURE_HOST }, json: async () => ({ notASchema: true }) };
    const outGranted = await POST(grantedReq);
    assert.strictEqual(outGranted.status, 400, `granted branch schema-mismatch status (got ${outGranted.status} ${JSON.stringify(outGranted._body?.errorType)})`);
    assert.strictEqual(outGranted._body?.errorType, 'CAPTURE_SCHEMA_MISMATCH');
    assert.strictEqual(outGranted._body?.success, false);
    assert.strictEqual(outGranted._body?.mode, 'capture_only');

    const outSecond = await POST({ nextUrl: { origin: CAPTURE_HOST }, json: async () => ({ notASchema: true }) });
    assert.strictEqual(outSecond.status, 409, `second real POST call must be rejected by the now-consumed singleton (got ${outSecond.status})`);
    assert.strictEqual(outSecond._body?.errorType, 'OPERATOR_CAPTURE_ALREADY_USED');
  } finally {
    if (savedLatch === undefined) delete process.env[LATCH_KEY]; else process.env[LATCH_KEY] = savedLatch;
  }
  assert.strictEqual(fetchBombCalls, fetchBombBefore, 'no network touched by the real POST wrapper on either short-circuit path');
});

// ============================================================
// Group B — runS7CaptureOnly: fail-closed guard matrix + happy path + non-mutation + full ledgers
// ============================================================

test('B1 fail-closed on malformed/non-plain/cyclic top-level input, and oversized measured in REAL UTF-8 bytes (not JS char length)', async () => {
  const cases = [
    { label: 'null', input: null },
    { label: 'array', input: [] },
    { label: 'string', input: 'nope' },
    { label: 'number', input: 42 },
  ];
  for (const c of cases) {
    const out = await runCapture(c.input);
    assert.strictEqual(out.status, 400, `${c.label}: status`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_INPUT_NOT_PLAIN_OBJECT', `${c.label}: errorType`);
  }
  const cyclic = { schema: CAPTURE_SCHEMA };
  cyclic.self = cyclic;
  const outCyclic = await runCapture(cyclic);
  assert.strictEqual(outCyclic.status, 400);
  assert.strictEqual(outCyclic.body.errorType, 'CAPTURE_INPUT_NOT_SERIALIZABLE');

  const oversized = { schema: CAPTURE_SCHEMA, job: { dossier: { padding: 'x'.repeat(2_000_000) } } };
  const outOversized = await runCapture(oversized);
  assert.strictEqual(outOversized.status, 400);
  assert.strictEqual(outOversized.body.errorType, 'CAPTURE_INPUT_TOO_LARGE');

  // P2 size-wording proof: a Thai string whose JS .length (UTF-16 code units) is WELL under 1,000,000, but
  // whose UTF-8 byte length (each Thai codepoint here = 3 bytes) is OVER 1,000,000. If the guard were counting
  // JS chars (or the char-per-byte-1 assumption implied by "chars"), this would be ACCEPTED — it must be
  // REJECTED, proving TextEncoder byte-counting is real, not documentation-only.
  const thaiChar = 'ท'; // 3 bytes in UTF-8
  const charCount = 400_000; // .length=400,000 (<1,000,000) — but 400,000*3=1,200,000 UTF-8 bytes (>1,000,000)
  const bigThai = thaiChar.repeat(charCount);
  assert.ok(bigThai.length < 1_000_000, 'sanity: JS char length is under the byte cap');
  assert.ok(Buffer.byteLength(JSON.stringify({ schema: CAPTURE_SCHEMA, job: { dossier: { padding: bigThai } } }), 'utf8') > 1_000_000, 'sanity: real UTF-8 byte length is over the byte cap');
  const outThaiOversized = await runCapture({ schema: CAPTURE_SCHEMA, job: { dossier: { padding: bigThai } } });
  assert.strictEqual(outThaiOversized.status, 400, `thai-byte-oversized: status (got ${outThaiOversized.status} ${JSON.stringify(outThaiOversized.body?.errorType)})`);
  assert.strictEqual(outThaiOversized.body.errorType, 'CAPTURE_INPUT_TOO_LARGE', 'thai-byte-oversized: rejected on UTF-8 byte length, not JS char length');
});

test('B2 fail-closed on schema mismatch and missing job/dossier/imageCaseSnapshot/case-id-mismatch', async () => {
  const cases = [
    { label: 'schema-missing', payload: { job: cloneJson(FIXTURE_JOB), imageCaseSnapshot: cloneJson(FIXTURE_SNAPSHOT) }, errorType: 'CAPTURE_SCHEMA_MISMATCH', status: 400 },
    { label: 'schema-wrong-string', payload: { schema: 'not-the-schema', job: cloneJson(FIXTURE_JOB), imageCaseSnapshot: cloneJson(FIXTURE_SNAPSHOT) }, errorType: 'CAPTURE_SCHEMA_MISMATCH', status: 400 },
    { label: 'job-missing', payload: { schema: CAPTURE_SCHEMA, imageCaseSnapshot: cloneJson(FIXTURE_SNAPSHOT) }, errorType: 'CAPTURE_DOSSIER_MISSING', status: 400 },
    { label: 'dossier-missing', payload: { schema: CAPTURE_SCHEMA, job: { id: 'x' }, imageCaseSnapshot: cloneJson(FIXTURE_SNAPSHOT) }, errorType: 'CAPTURE_DOSSIER_MISSING', status: 400 },
    { label: 'snapshot-missing', payload: { schema: CAPTURE_SCHEMA, job: cloneJson(FIXTURE_JOB) }, errorType: 'CAPTURE_IMAGE_SNAPSHOT_MISSING', status: 400 },
    { label: 'snapshot-case-id-mismatch', payload: { schema: CAPTURE_SCHEMA, job: cloneJson(FIXTURE_JOB), imageCaseSnapshot: { caseId: 'WRONG-CASE-ID', images: FIXTURE_POOL } }, errorType: 'CAPTURE_IMAGE_CASE_MISMATCH', status: 422 },
  ];
  for (const c of cases) {
    const out = await runCapture(c.payload);
    assert.strictEqual(out.status, c.status, `${c.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
    assert.strictEqual(out.body.errorType, c.errorType, `${c.label}: errorType`);
    assert.strictEqual(out.body.success, false, `${c.label}: success=false`);
    assert.ok(!Object.prototype.hasOwnProperty.call(out.body, 'queueBody'), `${c.label}: no queueBody leaked on failure`);
  }
});

test('B3 P1-1 snapshot corroboration: images missing/non-array/empty, plain-row shape, duplicate row id/url — all fail closed before S7', async () => {
  const missingCases = [
    { label: 'images-key-missing', snap: { caseId: FIXTURE_CASE_ID } },
    { label: 'images-non-array-string', snap: { caseId: FIXTURE_CASE_ID, images: 'not-an-array' } },
    { label: 'images-non-array-object', snap: { caseId: FIXTURE_CASE_ID, images: { 0: F_HERO } } },
    { label: 'images-empty-array', snap: { caseId: FIXTURE_CASE_ID, images: [] } },
  ];
  for (const c of missingCases) {
    const out = await runCapture(mkPayload(null, c.snap));
    assert.strictEqual(out.status, 422, `${c.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_IMAGE_SNAPSHOT_EMPTY', `${c.label}: errorType`);
  }
  const rowInvalidCases = [
    { label: 'row-not-object', images: [...FIXTURE_POOL, 'not-an-object'] },
    { label: 'row-missing-id', images: [...FIXTURE_POOL, { imageUrl: 'https://cdn.test/no-id.jpg' }] },
    { label: 'row-missing-url', images: [...FIXTURE_POOL, { id: 'NO-URL-ROW' }] },
    { label: 'row-array', images: [...FIXTURE_POOL, ['not', 'plain']] },
  ];
  for (const c of rowInvalidCases) {
    const out = await runCapture(mkPayload(null, { caseId: FIXTURE_CASE_ID, images: c.images }));
    assert.strictEqual(out.status, 422, `${c.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_SNAPSHOT_ROW_INVALID', `${c.label}: errorType`);
  }
  const dupIdOut = await runCapture(mkPayload(null, { caseId: FIXTURE_CASE_ID, images: [...FIXTURE_POOL, { id: 'F-HERO-OK', imageUrl: 'https://cdn.test/DIFFERENT.jpg' }] }));
  assert.strictEqual(dupIdOut.status, 422);
  assert.strictEqual(dupIdOut.body.errorType, 'CAPTURE_SNAPSHOT_DUPLICATE_ROW');
  const dupUrlOut = await runCapture(mkPayload(null, { caseId: FIXTURE_CASE_ID, images: [...FIXTURE_POOL, { id: 'A-DIFFERENT-ID', imageUrl: F_HERO.imageUrl }] }));
  assert.strictEqual(dupUrlOut.status, 422);
  assert.strictEqual(dupUrlOut.body.errorType, 'CAPTURE_SNAPSHOT_DUPLICATE_ROW');
});

test('B4 P1-1 snapshot corroboration: every slot PRIMARY id+url must match exactly one snapshot row (missing/mismatched); referenced BACKUPS (missing/malformed/valid non-vacuous) are checked the same way', async () => {
  const missingPrimary = await runCapture(mkPayload((job) => { job.dossier.pickImages.slots.hero.id = 'NOT-IN-SNAPSHOT'; }));
  assert.strictEqual(missingPrimary.status, 422, `missing-primary: status (got ${missingPrimary.status} ${JSON.stringify(missingPrimary.body?.errorType)})`);
  assert.strictEqual(missingPrimary.body.errorType, 'CAPTURE_SNAPSHOT_PRIMARY_MISMATCH');

  const mismatchedPrimary = await runCapture(mkPayload((job) => { job.dossier.pickImages.slots.hero.imageUrl = 'https://cdn.test/WRONG-URL-FOR-THIS-ID.jpg'; }));
  assert.strictEqual(mismatchedPrimary.status, 422, `mismatched-primary: status`);
  assert.strictEqual(mismatchedPrimary.body.errorType, 'CAPTURE_SNAPSHOT_PRIMARY_MISMATCH');

  const missingBackup = await runCapture(mkPayload((job) => { job.dossier.pickImages.slots.hero.backups = ['NOT-IN-SNAPSHOT-EITHER']; }));
  assert.strictEqual(missingBackup.status, 422, `missing-backup: status`);
  assert.strictEqual(missingBackup.body.errorType, 'CAPTURE_SNAPSHOT_BACKUP_MISMATCH');

  const malformedBackup = await runCapture(mkPayload((job) => { job.dossier.pickImages.slots.hero.backups = [{ id: 'F-JUNK-01' }]; })); // object, not scalar id
  assert.strictEqual(malformedBackup.status, 422, `malformed-backup: status`);
  assert.strictEqual(malformedBackup.body.errorType, 'CAPTURE_SNAPSHOT_BACKUP_MISMATCH');

  // R1.6C: own backups PRESENT but not an array at all — INCLUDING null — must fail typed BEFORE the
  // array-or-empty coercion, not be silently treated the same as "no backups". Each case also proves S7 (and
  // therefore the queue seam) is NEVER reached: the injected s7_cover spy would record a call if invoked.
  const nonArrayBackupsCases = [
    { label: 'backups-string', v: 'not-an-array' },
    { label: 'backups-object', v: { 0: 'F-JUNK-01' } },
    { label: 'backups-number', v: 123 },
    { label: 'backups-null', v: null },
  ];
  for (const c of nonArrayBackupsCases) {
    const s7Calls = [];
    const spyS7 = async (...args) => { s7Calls.push(args); return { status: 'done', nextAction: 'continue', summary: 'SHOULD_NEVER_BE_REACHED' }; };
    const out = await runCapture(mkPayload((job) => { job.dossier.pickImages.slots.hero.backups = c.v; }), { s7_cover: spyS7 });
    assert.strictEqual(out.status, 422, `${c.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_SLOT_BACKUPS_INVALID', `${c.label}: errorType — distinct from CAPTURE_SNAPSHOT_BACKUP_MISMATCH, caught before any array-element check`);
    assert.strictEqual(s7Calls.length, 0, `${c.label}: s7_cover (and therefore the queue interceptor) must never be called — rejected before S7`);
    assert.ok(!Object.prototype.hasOwnProperty.call(out.body, 'queueCalls') || out.body.queueCalls === 0, `${c.label}: no queue call attempted`);
  }
  // omitted key (no own 'backups' property at all) must still be treated as [] — a legitimate vacuous case,
  // not a rejection — sanity-checking the guard doesn't over-fire on the ordinary "no backups" shape
  const omittedOut = await runCapture(mkPayload((job) => { delete job.dossier.pickImages.slots.hero.backups; }));
  assert.strictEqual(omittedOut.status, 200, `omitted-backups-key: status (got ${omittedOut.status} ${JSON.stringify(omittedOut.body?.errorType)}) — omission must still mean []`);

  // NON-VACUOUS valid backup: real id, present in the snapshot — passes the guard and (proven in B16) survives
  // all the way through the real S7 producer into the wire's slotPlan + selectionSpec.
  const validBackup = await runCapture(mkPayload((job) => { job.dossier.pickImages.slots.hero.backups = ['F-JUNK-01']; }));
  assert.strictEqual(validBackup.status, 200, `valid-non-vacuous-backup: status (got ${validBackup.status} ${JSON.stringify(validBackup.body?.errorType)})`);
});

test('B5 fail-closed when strict switches are not exactly \'1\' — the four ordinary latches AND the fifth ref-authority latch (separately diagnosable), plus MEGA_COVER_ORIGIN mismatch', async () => {
  const switchCases = [
    { label: 'semantic-off', env: { ...CAPTURE_RUN_ENV, MEGA_SEMANTIC_SELECTION: '0' } },
    { label: 'spec-off', env: { ...CAPTURE_RUN_ENV, MEGA_SELECTION_SPEC: undefined } },
    { label: 'producer-truthy-not-exact', env: { ...CAPTURE_RUN_ENV, MEGA_STRICT_PRODUCER: 'true' } },
    { label: 'render-padded', env: { ...CAPTURE_RUN_ENV, MEGA_STRICT_RENDER: '1 ' } },
  ];
  for (const c of switchCases) {
    const out = await runCapture(mkPayload(), {}, c.env);
    assert.strictEqual(out.status, 422, `${c.label}: status`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_STRICT_SWITCHES_NOT_ARMED', `${c.label}: errorType`);
  }
  const refAuthCases = [
    { label: 'ref-authority-absent', env: { ...CAPTURE_RUN_ENV, MEGA_REF_SHOT_AUTHORITY: undefined } },
    { label: 'ref-authority-off', env: { ...CAPTURE_RUN_ENV, MEGA_REF_SHOT_AUTHORITY: '0' } },
    { label: 'ref-authority-truthy-not-exact', env: { ...CAPTURE_RUN_ENV, MEGA_REF_SHOT_AUTHORITY: 'true' } },
  ];
  for (const c of refAuthCases) {
    const out = await runCapture(mkPayload(), {}, c.env);
    assert.strictEqual(out.status, 422, `${c.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_REF_AUTHORITY_NOT_ARMED', `${c.label}: errorType — separately diagnosable from the four ordinary switches`);
  }
  const originCases = [
    { label: 'cover-origin-localhost', env: { ...CAPTURE_RUN_ENV, MEGA_COVER_ORIGIN: 'http://localhost:3000' } },
    { label: 'cover-origin-missing', env: { ...CAPTURE_RUN_ENV, MEGA_COVER_ORIGIN: undefined } },
    { label: 'cover-origin-trailing-slash', env: { ...CAPTURE_RUN_ENV, MEGA_COVER_ORIGIN: CAPTURE_HOST + '/' } },
  ];
  for (const c of originCases) {
    const out = await runCapture(mkPayload(), {}, c.env);
    assert.strictEqual(out.status, 422, `${c.label}: status`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_COVER_ORIGIN_MISMATCH', `${c.label}: errorType`);
  }
});

test('B6 fail-closed when pickImages is missing slots/slotOrder/heroSlotId/slotContractHash', async () => {
  const mutators = [
    { label: 'slots-empty', fn: (job) => { job.dossier.pickImages.slots = {}; } },
    { label: 'slotOrder-too-short', fn: (job) => { job.dossier.pickImages.slotOrder = job.dossier.pickImages.slotOrder.slice(0, 2); } },
    { label: 'slotOrder-missing', fn: (job) => { delete job.dossier.pickImages.slotOrder; } },
    { label: 'heroSlotId-not-in-order', fn: (job) => { job.dossier.pickImages.heroSlotId = 'not-a-real-slot'; } },
    { label: 'heroSlotId-missing', fn: (job) => { delete job.dossier.pickImages.heroSlotId; } },
    { label: 'slotContractHash-missing', fn: (job) => { delete job.dossier.pickImages.slotContractHash; } },
    { label: 'slotOrder-entry-not-in-slots', fn: (job) => { job.dossier.pickImages.slotOrder = [...job.dossier.pickImages.slotOrder, 'ghost-slot-id']; } },
  ];
  for (const m of mutators) {
    const out = await runCapture(mkPayload(m.fn));
    assert.strictEqual(out.status, 422, `${m.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_PICKIMAGES_INCOMPLETE', `${m.label}: errorType`);
  }
});

test('B6b R1.6D fail-closed on duplicate slotOrder entries', async () => {
  const out = await runCapture(mkPayload((job) => {
    const pick = job.dossier.pickImages;
    pick.slotOrder = [pick.slotOrder[0], ...pick.slotOrder]; // duplicate the first entry
  }));
  assert.strictEqual(out.status, 422, `status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
  assert.strictEqual(out.body.errorType, 'CAPTURE_PICKIMAGES_INCOMPLETE', 'duplicate slotOrder entries are rejected before the exact-set-size check can even run');
});

test('B6c R1.6D fail-closed: a ghost slot key present in pickImages.slots but OUTSIDE slotOrder must be rejected (CAPTURE_SLOT_SET_MISMATCH) before S7/queue — real s7_cover gathers backup ids from Object.values(slots), not just slotOrder, so an extra key could otherwise smuggle backups past the corroboration guard that only walks slotOrder', async () => {
  const ghostCases = [
    { label: 'ghost-backups-null', ghostSlot: { id: 'F-JUNK-02', imageUrl: 'https://cdn.test/F-JUNK-02.jpg', backups: null } },
    { label: 'ghost-backups-unresolved-id-array', ghostSlot: { id: 'F-JUNK-02', imageUrl: 'https://cdn.test/F-JUNK-02.jpg', backups: ['NOT-IN-ANY-SNAPSHOT-ROW'] } },
    { label: 'ghost-backups-resolved-snapshot-id-array', ghostSlot: { id: 'F-JUNK-02', imageUrl: 'https://cdn.test/F-JUNK-02.jpg', backups: ['F-JUNK-03'] } }, // a REAL, resolvable snapshot id — the exact shape that would otherwise sneak an unowned extra row into the wire
  ];
  for (const c of ghostCases) {
    const s7Calls = [];
    const spyS7 = async (...args) => { s7Calls.push(args); return { status: 'done', nextAction: 'continue', summary: 'SHOULD_NEVER_BE_REACHED' }; };
    const out = await runCapture(mkPayload((job) => {
      job.dossier.pickImages.slots.ghost = c.ghostSlot; // NOT added to slotOrder — a stale/extra key
    }), { s7_cover: spyS7 });
    assert.strictEqual(out.status, 422, `${c.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_SLOT_SET_MISMATCH', `${c.label}: errorType`);
    assert.strictEqual(s7Calls.length, 0, `${c.label}: s7_cover (and therefore the queue interceptor) must never be called`);
    assert.ok(!Object.prototype.hasOwnProperty.call(out.body, 'queueCalls') || out.body.queueCalls === 0, `${c.label}: no queue call attempted`);
    assert.ok(!Object.prototype.hasOwnProperty.call(out.body, 'queueBody'), `${c.label}: no queueBody leaked`);
  }
});

test('B7 fail-closed on duplicate primary candidate id/url', async () => {
  const out = await runCapture(mkPayload((job) => {
    const pick = job.dossier.pickImages;
    const keys = pick.slotOrder;
    assert.ok(keys.length >= 2, 'fixture must have >=2 slots to test duplicate binding');
    const [k0, k1] = keys;
    pick.slots[k1] = { ...pick.slots[k1], id: pick.slots[k0].id, imageUrl: 'https://cdn.test/DIFFERENT-URL.jpg' };
  }));
  assert.strictEqual(out.status, 422, `status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
  assert.strictEqual(out.body.errorType, 'CAPTURE_DUPLICATE_CANDIDATE');
});

test('B8 fail-closed on missing ref identity fields (dna/refId+dnaHash/refBoundAt)', async () => {
  const mutators = [
    { label: 'dna-missing', fn: (job) => { delete job.dossier.refMatch.dna; } },
    { label: 'refId-and-dnaHash-missing', fn: (job) => { delete job.dossier.refMatch.refId; delete job.dossier.refMatch.dnaHash; } },
    { label: 'refBoundAt-missing', fn: (job) => { delete job.dossier.refMatch.refBoundAt; } },
    { label: 'refMatch-missing-entirely', fn: (job) => { delete job.dossier.refMatch; } },
  ];
  for (const m of mutators) {
    const out = await runCapture(mkPayload(m.fn));
    assert.strictEqual(out.status, 422, `${m.label}: status`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_REF_IDENTITY_MISSING', `${m.label}: errorType`);
  }
});

test('B9 P1-2 ref-shot marker: BOTH sides required present (our guard checks shape only); one side missing is caught by us; unequal markers / effectiveViewHash / slotContractHash mutation are NOT judged by us — they flow to the REAL S7 producer, which HOLDs on its own canonical authority validation', async () => {
  const missingCases = [
    { label: 'pickImages-marker-missing', fn: (job) => { delete job.dossier.pickImages.refShotAuthority; } },
    { label: 'artBrief-marker-missing', fn: (job) => { delete job.dossier.artBrief.refShotAuthority; } },
    { label: 'artBrief-missing-entirely', fn: (job) => { delete job.dossier.artBrief; } },
    { label: 'pickImages-marker-not-object', fn: (job) => { job.dossier.pickImages.refShotAuthority = 'not-an-object'; } },
  ];
  for (const m of missingCases) {
    const out = await runCapture(mkPayload(m.fn));
    assert.strictEqual(out.status, 422, `${m.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_REF_SHOT_MARKER_MISSING', `${m.label}: caught by OUR guard (presence/shape only)`);
  }
  const realS7Cases = [
    { label: 'effectiveViewHash-mutated-on-pickImages-only', fn: (job) => { job.dossier.pickImages.refShotAuthority = { ...job.dossier.pickImages.refShotAuthority, effectiveViewHash: 'deadbeef' }; } },
    { label: 'slotContractHash-mutated', fn: (job) => { job.dossier.pickImages.slotContractHash = 'totally-different-hash-00000000'; } },
    { label: 'artBrief-marker-mode-mutated', fn: (job) => { job.dossier.artBrief.refShotAuthority = { ...job.dossier.artBrief.refShotAuthority, mode: 'legacy' }; } },
    // PAIRED-stale: BOTH sides carry the SAME stale effectiveViewHash — passes our own guard (present + shape
    // valid + we don't check equality) AND passes s7_cover's own pairing check (canonicalMarkersEqual: they
    // ARE equal to each other) — but the real S7 rebuild-freshness gate independently recomputes the contract
    // from refDNA and compares against this (stale, but internally-consistent) marker, and still HOLDs. This
    // is the case that actually proves the freshness check is real, not just the pairing check.
    { label: 'paired-stale-same-hash-both-sides', fn: (job) => { const stale = { ...job.dossier.pickImages.refShotAuthority, effectiveViewHash: 'deadbeef' }; job.dossier.pickImages.refShotAuthority = stale; job.dossier.artBrief.refShotAuthority = { ...stale }; } },
  ];
  for (const c of realS7Cases) {
    const out = await runCapture(mkPayload(c.fn));
    assert.strictEqual(out.status, 422, `${c.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)} ${JSON.stringify(out.body?.holdReason)})`);
    assert.strictEqual(out.body.errorType, 'CAPTURE_S7_NOT_DONE', `${c.label}: NOT one of our CAPTURE_REF_SHOT_* types — the real S7 producer caught this on its own, proving we deferred the equality/staleness decision to it`);
    assert.strictEqual(out.body.s7Status, 'waiting', `${c.label}: real S7 genuinely returned status='waiting', not a fabricated hold`);
    // every authority-mutation case must reach zero queue attempts — S7 HOLDs before ever touching the queue seam
    assert.strictEqual(out.body.queueCalls, 0, `${c.label}: queueCalls===0 — S7 held before any queue attempt`);
    // R1.6C: the PAIRED-stale case specifically must be caught by S7's rebuild-freshness comparison (not
    // merely its pairing/equality check, which this case deliberately satisfies) — lock the proof to that
    // exact branch by requiring the real holdReason/summary text to mention "rebuild".
    if (c.label === 'paired-stale-same-hash-both-sides') {
      assert.match(String(out.body.holdReason || ''), /rebuild/i, `${c.label}: holdReason must reference the rebuild-freshness gate specifically (got ${JSON.stringify(out.body.holdReason)})`);
    }
  }
});

// ---- fake-s7 driven guards: seam/payload-level failures — these exercise the SAME makeStrictFetchJson
//      interceptor the ordinary path uses, plus runS7CaptureOnly's own post-S7 checks. Every fake s7 here
//      first passes ALL the pre-checks above (valid fixture), so execution genuinely reaches the
//      interceptor/S7 layer being tested.
const FAKE_WIRE_OK = JSON.stringify({ composer: 'mega', newsTitle: 'x', slotPlan: [], selectionSpec: { refId: FIXTURE_REF_ID }, realizedTemplate: { id: 'x' } });
const FAKE_WIRE_STALE = JSON.stringify({ composer: 'mega', newsTitle: 'x', slotPlan: [], selectionSpec: { refId: 'REF-SOMETHING-ELSE-ENTIRELY' }, realizedTemplate: { id: 'x' } });
const FAKE_WIRE_MIXED = JSON.stringify({ composer: 'mega', newsTitle: 'x', slotPlan: [], selectionSpec: { refId: FIXTURE_REF_ID } }); // realizedTemplate key omitted entirely

function ledgerFetch(deps, ledger) {
  return async (url, opts) => { ledger.push({ url: String(url), method: String(opts?.method || 'GET'), body: opts?.body ?? null }); return deps.fetchJson(url, opts); };
}

test('B10 fail-closed: S7 not-done (waiting)', async () => {
  const s7 = async () => ({ status: 'waiting', nextAction: 'wait', summary: 'test-hold-capture-only' });
  const out = await runCapture(mkPayload(), { s7_cover: s7 });
  assert.strictEqual(out.status, 422);
  assert.strictEqual(out.body.errorType, 'CAPTURE_S7_NOT_DONE');
  assert.strictEqual(out.body.holdReason, 'test-hold-capture-only');
});

test('B11 fail-closed: S7 done but zero queue calls (payload never captured) — full ledger recorded, empty', async () => {
  const ledger = [];
  const s7 = async (job, { _deps }) => { void ledgerFetch(_deps, ledger); return { status: 'done', nextAction: 'continue', summary: 'no queue call' }; };
  const out = await runCapture(mkPayload(), { s7_cover: s7 });
  assert.strictEqual(out.status, 422);
  assert.strictEqual(out.body.errorType, 'CAPTURE_PAYLOAD_MISSING');
  assert.deepStrictEqual(ledger, [], 'ledger empty — S7 genuinely never attempted the queue seam');
});

test('B12 fail-closed: second queue call is rejected by the real interceptor — full ledger (url/method/body) recorded for both attempts; the in-memory image-case reader\'s own args are ALSO ledgered (GET call for backups, exact caseId url)', async () => {
  const ledger = [];
  const s7 = async (job, { _deps }) => {
    const f = ledgerFetch(_deps, ledger);
    await f(`${CAPTURE_HOST}/api/images/${FIXTURE_CASE_ID}`, {});
    await f(`${CAPTURE_HOST}/api/queue/add`, { method: 'POST', body: FAKE_WIRE_OK });
    await f(`${CAPTURE_HOST}/api/queue/add`, { method: 'POST', body: FAKE_WIRE_OK });
    return { status: 'done', nextAction: 'continue', summary: 'unreachable' };
  };
  const out = await runCapture(mkPayload(), { s7_cover: s7 });
  assert.strictEqual(out.status, 422);
  assert.strictEqual(out.body.errorType, 'SEAM_SECOND_QUEUE_CALL');
  assert.strictEqual(ledger.length, 3, 'reader GET + both queue attempts all recorded in the ledger, not just a count');
  assert.strictEqual(ledger[0].url, `${CAPTURE_HOST}/api/images/${FIXTURE_CASE_ID}`, 'in-memory reader GET: exact url (caseId embedded)');
  assert.strictEqual(ledger[0].method, 'GET');
  assert.strictEqual(ledger[1].url, `${CAPTURE_HOST}/api/queue/add`);
  assert.strictEqual(ledger[1].method, 'POST');
  assert.strictEqual(ledger[1].body, FAKE_WIRE_OK);
  assert.deepStrictEqual(ledger[2], ledger[1], 'second queue attempt identical args to the first (same url/method/body)');
});

test('B13 fail-closed: non-string queue body, invalid-JSON queue body, mixed strict pair, and an out-of-whitelist request — real interceptor guards', async () => {
  const cases = [
    { label: 'non-string-body', s7: async (job, { _deps }) => { await _deps.fetchJson(`${CAPTURE_HOST}/api/queue/add`, { method: 'POST', body: { not: 'a string' } }); return { status: 'done', nextAction: 'continue', summary: 'x' }; }, errorType: 'SEAM_QUEUE_BODY_NOT_STRING' },
    { label: 'invalid-json-body', s7: async (job, { _deps }) => { await _deps.fetchJson(`${CAPTURE_HOST}/api/queue/add`, { method: 'POST', body: '{not valid json' }); return { status: 'done', nextAction: 'continue', summary: 'x' }; }, errorType: 'SEAM_QUEUE_BODY_INVALID_JSON' },
    { label: 'mixed-strict-pair', s7: async (job, { _deps }) => { await _deps.fetchJson(`${CAPTURE_HOST}/api/queue/add`, { method: 'POST', body: FAKE_WIRE_MIXED }); return { status: 'done', nextAction: 'continue', summary: 'x' }; }, errorType: 'SEAM_STRICT_PAIR_MIXED' },
    { label: 'out-of-whitelist-path', s7: async (job, { _deps }) => { await _deps.fetchJson(`${CAPTURE_HOST}/api/not-whitelisted`, { method: 'GET' }); return { status: 'done', nextAction: 'continue', summary: 'x' }; }, errorType: 'SEAM_WHITELIST_REJECT' },
  ];
  for (const c of cases) {
    const out = await runCapture(mkPayload(), { s7_cover: c.s7 });
    assert.strictEqual(out.status, 422, `${c.label}: status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
    assert.strictEqual(out.body.errorType, c.errorType, `${c.label}: errorType`);
  }
});

// P1-R2: capture-only is now CONSUMER-EQUIVALENT — it validates the wire through the SAME pure activation seam the
// composer uses (_strictActivate) and may return success ONLY from canonical validated activation data. This wire
// carries an invalid realizedTemplate ({id:'x'}) — a wire the consumer WOULD reject — so it must HOLD with the
// consumer's own typed reason BEFORE any ref-identity/success step (proving no shallow field peek, no unsafe success).
test('B14 fail-closed (P1-R2): a wire the CONSUMER rejects (invalid strict carrier) HOLDs via the shared activation validator, before any success', async () => {
  const s7 = async (job, { _deps }) => { await _deps.fetchJson(`${CAPTURE_HOST}/api/queue/add`, { method: 'POST', body: FAKE_WIRE_STALE }); return { status: 'done', nextAction: 'continue', summary: 'ok' }; };
  const out = await runCapture(mkPayload(), { s7_cover: s7 });
  assert.strictEqual(out.status, 422);
  assert.strictEqual(out.body.errorType, 'CAPTURE_STRICT_CONTRACT_REJECT', 'invalid strict carrier ⇒ typed HOLD from the shared validator (not a shallow ref check)');
  assert.strictEqual(out.body.holdReason, 'STRICT_RENDER_CONTRACT_INVALID', "the consumer's own V1 typed HOLD is surfaced (wire never reaches success)");
});

test('B15 HAPPY PATH: real s7_cover, real interceptor, real ref-authority template_v1 — status 200, honest replay/operator-supplied labeling, raw queueBody strictEqual (byte-level), queuePayload deepEqual JSON.parse(queueBody) (structural), wire carries EXACT SelectionSpec fields (not merely object-shaped): mode/source/counts.*/diagnostics.*/strictReady/hashes, >=3 primaries, jobType/userId; snapshot->slotPlan/spec primary correspondence proven per-slot; every forbidden dependency stayed at zero NEW calls', async () => {
  const leakBefore = JSON.stringify(globalThis.__CAP_LEAK || {});
  const out = await runCapture(mkPayload());
  assert.strictEqual(out.status, 200, `status (got ${out.status} ${JSON.stringify(out.body?.errorType)} ${JSON.stringify(out.body?.holdReason)})`);
  assert.strictEqual(out.body.success, true);
  assert.strictEqual(out.body.mode, 'capture_only');
  assert.strictEqual(out.body.evidenceKind, 'replay_operator_supplied');
  assert.match(out.body.evidenceDisclaimer, /NOT a fresh\/live pipeline run/, 'disclaimer honestly states this is not a fresh/live run');
  assert.match(out.body.evidenceDisclaimer, /NO cryptographic authenticity guarantee/, 'disclaimer honestly states no cryptographic authenticity claim');
  assert.strictEqual(typeof out.body.queueBody, 'string');
  assert.strictEqual(out.body.queueBody, JSON.stringify(JSON.parse(out.body.queueBody)), 'sanity: queueBody is exactly its own canonical JSON re-serialization (no stray whitespace)');
  assert.deepStrictEqual(out.body.queuePayload, JSON.parse(out.body.queueBody), 'queuePayload structural/deep-equal to JSON.parse(queueBody)');

  const wire = out.body.queuePayload;
  assert.strictEqual(wire.jobType, 'cover');
  assert.strictEqual(typeof wire.userId, 'string');
  assert.ok(wire.userId.length > 0);
  assert.ok(Array.isArray(wire.slotPlan) && wire.slotPlan.length >= 3, `wire.slotPlan has >=3 entries (got ${wire.slotPlan?.length})`);

  const spec = wire.selectionSpec;
  assert.ok(spec, 'wire carries selectionSpec (strict pair)');
  assert.strictEqual(spec.mode, 'ref_slot_exact', 'spec.mode exact value, not merely "is a string"');
  assert.strictEqual(spec.source, 'template.slots', 'spec.source exact value — proves template_v1/ref-authority actually engaged, not the legacy ref_slot_exact-without-template path');
  assert.strictEqual(spec.strictReady, true);
  assert.deepStrictEqual(spec.counts, { total: 5, mapped: 5, unmapped: 0, missingPrimary: 0, duplicatePrimary: 0, duplicatePrimaryUrl: 0, semanticFallback: 0 }, 'spec.counts exact field-by-field, not merely object-shaped');
  assert.ok(spec.diagnostics && typeof spec.diagnostics === 'object', 'spec.diagnostics is an object');
  assert.deepStrictEqual(spec.diagnostics.extraPlannedKeys, [], 'diagnostics.extraPlannedKeys exact empty array');
  assert.deepStrictEqual(spec.diagnostics.invalidPrimary, [], 'diagnostics.invalidPrimary exact empty array');
  assert.deepStrictEqual(spec.diagnostics.aliasPrimaryUrls, [], 'diagnostics.aliasPrimaryUrls exact empty array — no primary shares a URL alias with another slot');
  assert.deepStrictEqual(spec.diagnostics.duplicateBackupsDropped, [], 'diagnostics.duplicateBackupsDropped exact empty array — this fixture has zero backups, so nothing was dropped');
  assert.ok(!('missingRefId' in spec.diagnostics) || spec.diagnostics.missingRefId === false, 'diagnostics.missingRefId absent or exactly false');
  for (const h of ['specHash', 'backupPoolHash', 'replayHash']) {
    assert.strictEqual(typeof spec[h], 'string', `spec.${h} is a string`);
    assert.match(spec[h], /^[0-9a-f]{8}$/, `spec.${h} is exactly 8 lowercase hex chars (fnv1a32), not merely nonblank`);
  }
  assert.ok(Array.isArray(spec.slots) && spec.slots.length >= 3, `spec.slots has >=3 entries (got ${spec.slots?.length})`);
  assert.strictEqual(spec.refId, FIXTURE_REF_ID);
  assert.strictEqual(out.body.refId, FIXTURE_REF_ID);
  assert.strictEqual(out.body.imageCaseId, FIXTURE_CASE_ID);

  // P1-1 happy-path proof: exact snapshot -> slotPlan/spec primary correspondence, per slot
  const snapshotById = new Map(FIXTURE_POOL.map((r) => [String(r.id), r]));
  for (const specSlot of spec.slots) {
    const row = snapshotById.get(String(specSlot.primary.candidateId));
    assert.ok(row, `spec slot ${specSlot.refSlotId}: primary.candidateId resolves to a real snapshot row`);
    assert.strictEqual(specSlot.primary.imageUrl, row.imageUrl, `spec slot ${specSlot.refSlotId}: primary.imageUrl matches the snapshot row's imageUrl`);
    const wireRows = wire.slotPlan.filter((r) => r.refSlotId === specSlot.refSlotId);
    assert.strictEqual(wireRows.length, 1, `spec slot ${specSlot.refSlotId}: exactly one wire slotPlan row`);
    assert.strictEqual(wireRows[0].url, row.imageUrl, `spec slot ${specSlot.refSlotId}: wire slotPlan url matches the same snapshot row`);
  }

  // R1.6B: call the REAL validateStrictRenderActivation directly on the captured wire (the same function
  // route.js's own makeStrictFetchJson/_strictWireGate path used to gate this wire before it was ever
  // accepted) — an independent second opinion from the actual production validator, not a re-derivation.
  const decision = validateStrictRenderActivation({ selectionSpec: wire.selectionSpec, realizedTemplate: wire.realizedTemplate });
  assert.strictEqual(decision.decision, 'strict_ready', `real validateStrictRenderActivation independently agrees the wire is strict_ready (got ${decision.decision} reasons=${JSON.stringify(decision.reasons)})`);
  assert.strictEqual(decision.active, true, 'decision.active exactly true');
  assert.deepStrictEqual(decision.reasons, [], 'zero reasons on a genuinely ready wire');
  assert.ok(decision.authority && Array.isArray(decision.authority.slots), 'decision.authority.slots present');
  assert.strictEqual(decision.authority.refId, spec.refId, 'authority.refId matches wire selectionSpec.refId');
  assert.strictEqual(decision.authority.specHash, spec.specHash, 'authority.specHash matches wire selectionSpec.specHash');
  assert.strictEqual(decision.authority.backupPoolHash, spec.backupPoolHash, 'authority.backupPoolHash matches wire selectionSpec.backupPoolHash');
  assert.strictEqual(decision.authority.replayHash, spec.replayHash, 'authority.replayHash matches wire selectionSpec.replayHash');
  const decisionSlotIds = new Set(decision.authority.slots.map((s) => s.refSlotId));
  const specSlotIds = new Set(spec.slots.map((s) => s.refSlotId));
  assert.deepStrictEqual(decisionSlotIds, specSlotIds, 'authority slot set (refSlotId) matches the wire selectionSpec slot set exactly');
  for (const as of decision.authority.slots) {
    const specSlot = spec.slots.find((s) => s.refSlotId === as.refSlotId);
    assert.ok(specSlot, `authority slot ${as.refSlotId} has a matching wire spec slot`);
    assert.strictEqual(as.primary.candidateId, specSlot.primary.candidateId, `authority slot ${as.refSlotId}: primary.candidateId matches`);
    assert.strictEqual(as.primary.imageUrl, specSlot.primary.imageUrl, `authority slot ${as.refSlotId}: primary.imageUrl matches`);
  }

  assert.strictEqual(JSON.stringify(globalThis.__CAP_LEAK || {}), leakBefore, 'zero NEW calls to any forbidden dependency during the happy path (aiClient/coverQcGate/composer/imageStore/archive/fs)');
});

test('B16 P1-1 happy-path NON-VACUOUS backup correspondence: a real backup id survives real S7 into both selectionSpec.slots[].backups AND wire.slotPlan as a backupForRefSlotId row, both traceable to the exact snapshot row', async () => {
  const backupCandidateId = 'F-JUNK-01';
  const out = await runCapture(mkPayload((job) => { job.dossier.pickImages.slots.hero.backups = [backupCandidateId]; }));
  assert.strictEqual(out.status, 200, `status (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
  const backupRow = FIXTURE_POOL.find((r) => String(r.id) === backupCandidateId);
  assert.ok(backupRow, 'sanity: the backup id used here is a real snapshot row');

  const spec = out.body.queuePayload.selectionSpec;
  const heroSpecSlot = spec.slots.find((s) => s.refSlotId === 'hero');
  assert.ok(heroSpecSlot, 'spec has a hero slot');
  assert.ok(Array.isArray(heroSpecSlot.backups) && heroSpecSlot.backups.length >= 1, 'hero spec slot carries a non-vacuous backups array');
  const specBackup = heroSpecSlot.backups.find((b) => String(b.candidateId) === backupCandidateId);
  assert.ok(specBackup, 'spec backup entry for our injected candidate id exists');
  assert.strictEqual(specBackup.imageUrl, backupRow.imageUrl, 'spec backup imageUrl matches the exact snapshot row');

  const wireBackupRows = out.body.queuePayload.slotPlan.filter((r) => r.backupForRefSlotId === 'hero');
  assert.strictEqual(wireBackupRows.length, 1, 'exactly one wire slotPlan row backing the hero slot');
  assert.strictEqual(wireBackupRows[0].url, backupRow.imageUrl, 'wire backup row url matches the exact snapshot row');
});

test('B17 does not mutate the supplied dossier/snapshot', async () => {
  const pristineJob = cloneJson(FIXTURE_JOB);
  const pristineSnapshot = cloneJson(FIXTURE_SNAPSHOT);
  const mutableJob = cloneJson(FIXTURE_JOB); // NOT frozen — a real mutation would succeed silently if it happened
  const mutableSnapshot = cloneJson(FIXTURE_SNAPSHOT);
  const payload = { schema: CAPTURE_SCHEMA, job: mutableJob, imageCaseSnapshot: mutableSnapshot };
  const out = await runCapture(payload);
  assert.strictEqual(out.status, 200, `happy path must succeed for this to be a meaningful non-mutation proof (got ${out.status} ${JSON.stringify(out.body?.errorType)})`);
  assert.deepStrictEqual(mutableJob, pristineJob, 'job object unchanged after the call');
  assert.deepStrictEqual(mutableSnapshot, pristineSnapshot, 'imageCaseSnapshot object unchanged after the call');
  assert.deepStrictEqual(payload.job, pristineJob, 'the exact object reference passed in is still unchanged');
});

// ============================================================
// Group C — WAVE1A ref-hero-v2 (V2) coverage: a GENUINE V2-only wire produced by the REAL four-foundation S6
//   producer + REAL S7 V2 producer + REAL refSlotContract validator (NOT handcrafted/blessed), exercised through
//   BOTH the ordinary full-route runCoverRefTest seam AND the retained runS7CaptureOnly _strictActivate seam.
//   Same real DNA record (REF-mrbqalpo-h1r1) as the V1 fixture above; genuine measured evidence (the recipe proven
//   in tests/mega-semantic-selection.test.mjs to drive the real V2 producer). Flag-gated: MEGA_REF_HERO_V2=1
//   (+ semantic/spec) at S6, MEGA_STRICT_RENDER=1 at S7 — default OFF everywhere else.
// ============================================================
const V2_CASE_ID = 'CAP-0084-V2-FIXTURE';
const V2_ENV = { MEGA_REF_HERO_V2: '1', MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' };
// genuine measured evidence + readiness + Global scores (the V2 four-foundation path fail-closes without these)
const RH_EV = { identityConfidence: 0.9, faceShare: 0.15, headroom: 0.15, visibleBodyRegion: 'half_body', occlusion: 0.05, edgeCut: 0.02, cleanliness: 0.9 };
const RH_RD = { searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true };
const RH_SC = { semanticScore: 700, qualityScore: 700, slotFitScore: 700 };
const v2Img = (id, { person = null, sceneKey } = {}) => ({
  id, imageUrl: `https://cdn.test/${id}.jpg`, thumbnailUrl: '', source: 'SynthNews Desk', sourceLink: `https://source.test/${id}`,
  width: 900, height: 1200, realWidth: 900, realHeight: 1200,
  // ★ AC-0107: genuine normalized raw faceBox (big centred face ⇒ crop-SAFE for the realized hero slot) — additive,
  //   independent of the shot-class evidence, so the V2 producer's new crop-safe hero eligibility approves this hero.
  triage: { relevant: true, clean: true, faceCount: 1, person, persons: person ? [person] : [], category: 'face-emotional', emotion: 'warm', note: `${id} ${sceneKey}`, newsScene: true, quality: 8, realShortSide: 900, sharpness: 80, faceBox: { x1: 0.30, y1: 0.12, x2: 0.70, y2: 0.60 }, ...RH_EV, ...RH_RD, ...RH_SC, sceneKey },
});
const V2_POOL = () => [
  v2Img('V-L1', { person: 'Lisa', sceneKey: 'sceneL' }),
  v2Img('V-N1', { person: 'Nene', sceneKey: 'sceneN' }),
  v2Img('V-C1', { person: 'Ctx1', sceneKey: 'sceneC1' }),
  v2Img('V-C2', { person: 'Ctx2', sceneKey: 'sceneC2' }),
  v2Img('V-C3', { person: 'Ctx3', sceneKey: 'sceneC3' }),
];
const V2_CHARS = [{ name: 'Lisa', role: 'hero' }, { name: 'Nene', role: 'reaction' }, { name: 'Ctx1', role: 'context' }, { name: 'Ctx2', role: 'context' }, { name: 'Ctx3', role: 'context' }];
const V2_PICKS = { hero: { id: 'V-L1', reason: 'x', backups: [] }, context: { id: 'V-C1', reason: 'x', backups: [] }, action: { id: 'V-C2', reason: 'x', backups: [] }, moment: { id: 'V-C3', reason: 'x', backups: [] }, reaction: { id: 'V-N1', reason: 'x', backups: [] } };
const mkV2RefMatch = () => ({ dna: FIXTURE_DNA, styleName: 'v2-fixture', typeMatched: true, imagePath: '/ref-covers/v2-fixture.jpg', refId: FIXTURE_REF_ID, dnaHash: FIXTURE_DNA_HASH, refBoundAt: FIXTURE_REF_BOUND_AT });
const mkV2S6Deps = () => ({
  slotDirectorBrain: async () => ({ slots: V2_PICKS, note: 'v2-fixture' }),
  artBriefBrain: async () => { throw new Error('v2 fixture: artBriefBrain must not be called — artBrief is pre-set'); },
  fetchJson: async (url) => { if (String(url).includes('/api/images/')) return { success: true, images: V2_POOL() }; throw new Error('v2 fixture: unexpected fetch ' + url); },
});

// ── Batch 4B quarantine: producer HOLD จนกว่ามี readiness producer จริง — เคาะ Option B 15 ก.ค. 69 ──
//   Group C เดิมสร้าง carrier V2 จริง (s6 status 'done', refHeroV2.ok===true) แล้วพิสูจน์ว่า W3-3 route/capture-only
//   ส่ง carrier ที่ถูกต้องต่อ composer — ดีไซน์เก่าก่อนกักกัน. ตอนนี้ท่อ V2 ON เดินสาย real four-foundation producer
//   แล้ว fail-closed เป็น typed HOLD: identity/crop verifier ยังไม่มีในระบบ (Batch 4A/4B ⇒ _rhCastCandidate hardcode
//   cropSafe/identityVerified=false) ⇒ cast ไม่มี asset ผ่าน ⇒ REF_HERO_V2_INSUFFICIENT_CAST_ASSETS ⇒ ไม่มี carrier ให้
//   S7/composer. converge สไตล์ batch3/batch4: (ก) ON ⇒ waiting + typed HOLD ก่อน brain · (ข) OFF ⇒ ไม่มี refHeroV2 key.
//   หมายเหตุ: authority ป้อนผ่าน _deps.readImagesAuthority (real builder, relative import) — producer ไม่แตะ imageStore
//   stub เลย ⇒ B18 leak ledger ยังเป็น 0.
const V2_HOLD_ENV = { ...V2_ENV, MEGA_HERO_GRADE_HARD: '0' };
const v2FactsFor = () => buildCandidateFactsV1({
  verdicts: { relevant: true, clean: true, newsScene: true },
  resolution: { decodedBuffer: true, provenance: 'full', width: 1000, height: 1400 },
  faceBox: { x: 0.30, y: 0.12, w: 0.40, h: 0.48 },
});
// snapshot rows carrying genuine validated candidateFacts (the real image-store authority the V2 producer consumes)
const v2HoldRows = () => V2_CHARS.map(({ name }, i) => {
  const id = ['V-L1', 'V-N1', 'V-C1', 'V-C2', 'V-C3'][i];
  return {
    id, caseId: V2_CASE_ID, platform: 'google', imageUrl: `https://cdn.test/${id}.jpg`, thumbnailUrl: '',
    source: 'SynthNews Desk', sourceLink: `https://source.test/${id}`,
    width: 1000, height: 1400, realWidth: 1000, realHeight: 1400,
    triage: { relevant: true, clean: true, newsScene: true, person: name, persons: [name], faceCount: 1, faceBox: { x1: 0.30, y1: 0.12, x2: 0.70, y2: 0.60 }, candidateFacts: v2FactsFor() },
  };
});
const v2Shadow = (ids) => ({ version: 2, totalCandidates: ids.length, emittedCandidates: ids.length, truncatedCandidates: 0, capped: false, candidates: ids.map((candidateId, index) => ({ candidateId, provider: 'google', queryIndex: 0, providerRank: index + 1 })) });
async function v2AuthResponse(rows) {
  const snapshot = { scope: 'case_image_store_snapshot_v1', caseId: V2_CASE_ID, complete: true, truncated: false, count: rows.length, rows };
  const response = await realBuildImagesRouteResponse(V2_CASE_ID, '1', { readImagesSnapshot: async (cid) => { if (cid !== V2_CASE_ID) throw new Error('unexpected case'); return snapshot; } });
  assert.strictEqual(response.status, 200, 'real image-store authority fixture builds a 200');
  assert.strictEqual(response.body?.success, true, 'real image-store authority fixture is successful');
  return response;
}
function v2HoldJob(rows) {
  return { id: 'V2-HOLD-JOB', dossier: {
    images: { caseId: V2_CASE_ID, searchStats: [{ platform: 'google', found: rows.length, added: rows.length, searchShadowV2: v2Shadow(rows.map((r) => r.id)) }] },
    compass: { angle: 'มุมทดสอบ v2', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: V2_CHARS, visualDreamShots: [], doNotUse: [] },
    desk: { title: 'ข่าวทดสอบ ref-hero-v2 fixture' },
    refMatch: mkV2RefMatch(),
    artBrief: { storyNote: 'เรื่องทดสอบ v2 fixture', orders: [] },
  } };
}
// ON path: the REAL four-foundation producer via the injected in-process image authority ⇒ typed HOLD before the brain.
async function runV2Hold(rows = v2HoldRows()) {
  const response = await v2AuthResponse(rows);
  const captures = { brainArgs: [] };
  const s6 = await withEnvMap(V2_HOLD_ENV, () => withFixedNow(() => s6_slots(v2HoldJob(rows), { origin: 'http://mock', _deps: {
    readImagesAuthority: async (cid) => { if (cid !== V2_CASE_ID) throw new Error('unexpected authority case'); return response; },
    slotDirectorBrain: async (a) => { captures.brainArgs.push(a); throw new Error('brain must not run on a typed V2 HOLD'); },
  } })));
  return { s6, captures };
}

test('C1 (Batch 4B) flag ON ⇒ the REAL four-foundation S6 producer fail-closes to a typed HOLD (waiting + REF_HERO_V2_INSUFFICIENT_CAST_ASSETS) before the brain — no carrier reaches S7/composer; no NEW forbidden-dependency leak', async () => {
  const leakBefore = JSON.stringify(globalThis.__CAP_LEAK || {});
  const fetchBombBefore = fetchBombCalls;
  const { s6, captures } = await runV2Hold();
  assert.strictEqual(s6.status, 'waiting', 'ON: producer fail-closes (no crop/identity verifier ⇒ cast HOLD)');
  assert.deepStrictEqual(s6.dossierPatch?.pickImages?.refHeroV2, { v: 1, ok: false, hold: 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS' });
  assert.strictEqual(captures.brainArgs.length, 0, 'brain NOT called on a typed HOLD (pre-brain sentinel)');
  assert.strictEqual(fetchBombCalls, fetchBombBefore, 'no global.fetch touched (authority rode the injected in-process seam)');
  assert.strictEqual(JSON.stringify(globalThis.__CAP_LEAK || {}), leakBefore, 'no NEW forbidden-dependency calls (imageStore/composer/qc/archive untouched — real authority builder is not the leak-counted stub)');
});

test('C2 (Batch 4B) the typed HOLD is deterministic under input reordering (no positional/order dependence)', async () => {
  const a = (await runV2Hold(v2HoldRows())).s6.dossierPatch?.pickImages?.refHeroV2;
  const b = (await runV2Hold(v2HoldRows().reverse())).s6.dossierPatch?.pickImages?.refHeroV2;
  assert.deepStrictEqual(a, b, 'row order cannot alter the typed hold');
  assert.deepStrictEqual(a, { v: 1, ok: false, hold: 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS' });
});

test('C3 (Batch 4B) flag OFF ⇒ no refHeroV2 key (additive-only; the V2 producer adds nothing when unset) — legacy semantic-only path unchanged, no NEW leak', async () => {
  const leakBefore = JSON.stringify(globalThis.__CAP_LEAK || {});
  const off = await withEnvMap({ MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' }, () => withFixedNow(() => s6_slots(v2HoldJob(v2HoldRows()), { origin: 'http://mock', _deps: mkV2S6Deps() })));
  assert.strictEqual(off.status, 'done', 'OFF: semantic-only pipeline completes unchanged');
  assert.ok(!('refHeroV2' in off.dossierPatch.pickImages), 'OFF: pickImages has no refHeroV2 key');
  assert.strictEqual(JSON.stringify(globalThis.__CAP_LEAK || {}), leakBefore, 'no NEW forbidden-dependency calls on the legacy path');
});

test('B18 global.fetch bomb, real-fs-write bomb, and the complete forbidden-dependency leak ledger (aiClient.callBrain/coverQcGate/composer/imageStore/archive/fs) are all empty across the whole file', async () => {
  assert.strictEqual(fetchBombCalls, 0, `fetch bomb calls = ${fetchBombCalls}`);
  const leak = globalThis.__CAP_LEAK || {};
  const total = Object.values(leak).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 0, `forbidden-dependency leak total = ${total} (${JSON.stringify(leak)})`);
  for (const key of ['callBrain', 'evaluateCoverQc', 'composeAndVerify', 'buildImagesRouteResponse', 'addMegaCover', 'fsWriteFile', 'fsMkdir']) {
    assert.strictEqual(leak[key] || 0, 0, `leak.${key} must be 0`);
  }
});
