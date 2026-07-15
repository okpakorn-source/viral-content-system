// ============================================================
// 🧪 AC-0099 strict-ref-test regression — Wave E offline fixture (E1–E18)
// ------------------------------------------------------------
// ⚠️ SYNTHETIC FIXTURE ONLY: ทุก candidate id / faceBox / measurement ในไฟล์นี้
//    สังเคราะห์ขึ้นเพื่อจำลอง "รูปแบบ" ความพังของ AC-0099 (ตึก+หน้าจิ๋วขอบภาพ /
//    หัวแหว่ง) — ไม่ใช่และไม่อ้างข้อมูล cloud ของเคส AC-0099 จริง (ซึ่ง
//    UNAVAILABLE-LOCALLY). ref DNA ใช้ของจริงจากคลัง local (tracked ใน repo).
// - offline 100%: global.fetch = counting bomb (โยนทันทีถ้าถูกเรียก)
// - archive/persist = injected counters เท่านั้น — ห้ามแตะ fs/network/cloud
// - loader stub ตามแบบ scripts/test-semantic-selection.mjs (data:URL alias hook)
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

// ---- H1: snapshot exact originals BEFORE any mutation/import ----
const ENV_KEYS_TOUCHED = ['MEGA_SOLVER_SHADOW', 'MEGA_YT_PARALLEL', 'MEGA_HERO_GRADE_HARD', 'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_STRICT_PRODUCER', 'MEGA_STRICT_RENDER', 'MEGA_STRICT_RENDERER', 'MEGA_REF_SHOT_AUTHORITY', 'MEGA_ROLE_READINESS', 'MEGA_FINAL_DECISION_EVIDENCE_V2', 'MEGA_SEARCH_PROVENANCE', 'MEGA_SEARCH_SHADOW_V2', 'MEGA_SEARCH_OUTCOME_SHADOW_V1', 'MEGA_HARD_QC', 'MEGA_COVER_ORIGIN'];
const ORIG_ENV = Object.fromEntries(ENV_KEYS_TOUCHED.map((k) => [k, process.env[k]])); // undefined = ไม่มีเดิม
const ORIG_FETCH_DESC = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const ORIG_DATE_NOW = Date.now;
const ORIG_ARCH_LEAK = globalThis.__E_ARCH_LEAK;
function restoreExactOriginals() {
  for (const k of ENV_KEYS_TOUCHED) { if (ORIG_ENV[k] === undefined) delete process.env[k]; else process.env[k] = ORIG_ENV[k]; }
  if (ORIG_FETCH_DESC) Object.defineProperty(globalThis, 'fetch', ORIG_FETCH_DESC); else delete globalThis.fetch;
  Date.now = ORIG_DATE_NOW;
  if (ORIG_ARCH_LEAK === undefined) delete globalThis.__E_ARCH_LEAK; else globalThis.__E_ARCH_LEAK = ORIG_ARCH_LEAK;
}

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const AI_STUB = _mod('export function callBrain(a){ if (globalThis.__MEGA_AI) return globalThis.__MEGA_AI(a); throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
const STUB_IMAGESEARCH = _mod(`
export const PLATFORMS = ['google','google_news','facebook','tiktok','youtube'];
export function buildQueries(kw, maxQ){ const f = globalThis.__MEGA_SP; return f && f.buildQueries ? f.buildQueries(kw, maxQ) : ['q1','q2']; }
export async function searchImages(platform, q, opts){ return globalThis.__MEGA_SP.searchImages(platform, q, opts); }
export async function instagramProfile(){ return { images: [] }; }
export async function facebookProfile(){ return { images: [] }; }
`);
const STUB_TRIAGE = _mod('export async function vetImages(a){ return globalThis.__MEGA_SP.vetImages(a); }');
const STUB_STORE = _mod(`
export async function addImages(caseId, imgs){ return globalThis.__MEGA_SP.addImages(caseId, imgs); }
export async function readImages(caseId){ const f = globalThis.__MEGA_SP; return f && f.readImages ? f.readImages(caseId) : []; }
export async function buildImagesRouteResponse(caseId, q){ const f = globalThis.__MEGA_SP; if (f && f.buildImagesRouteResponse) return f.buildImagesRouteResponse(caseId, q); return { httpStatus: 200, success: true, images: [] }; }
`);
const STUB_CASE = _mod('export async function getCase(id){ return globalThis.__MEGA_SP && globalThis.__MEGA_SP.getCase ? globalThis.__MEGA_SP.getCase(id) : null; }');
const STUB_JUNK = _mod(`
export function isCatalogSource(x){ return false; }
export function isOwnPageSource(x){ return false; }
export function isMismatchedFbMedia(x){ return false; }
`);
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };');
// composer จริงลาก sharp/faceDetector — E-case ทุกตัวฉีด compose ผ่าน deps อยู่แล้ว → stub delegate (default โยน = กันหลุดใช้ของจริงเงียบๆ)
const STUB_COMPOSER = _mod('export async function composeAndVerify(p){ if (globalThis.__E_COMPOSE) return globalThis.__E_COMPOSE(p); throw new Error("REAL_COMPOSE_FORBIDDEN_IN_TEST"); }');
// archive จริงห้ามแตะ — default นับ leak (route ควรถูกฉีด loadArchive เสมอ)
const STUB_ARCHIVE = _mod('export async function addMegaCover(e){ globalThis.__E_ARCH_LEAK = (globalThis.__E_ARCH_LEAK||0)+1; return { id: "LEAK" }; }');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/imageSearch') return { url: ${JSON.stringify(STUB_IMAGESEARCH)}, shortCircuit: true };
  if (specifier === '@/lib/libraryTriage') return { url: ${JSON.stringify(STUB_TRIAGE)}, shortCircuit: true };
  if (specifier === '@/lib/imageStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/caseStore') return { url: ${JSON.stringify(STUB_CASE)}, shortCircuit: true };
  if (specifier === '@/lib/junkSources') return { url: ${JSON.stringify(STUB_JUNK)}, shortCircuit: true };
  if (specifier === '@/lib/services/megaComposerService') return { url: ${JSON.stringify(STUB_COMPOSER)}, shortCircuit: true };
  if (specifier === '@/lib/megaCoverArchive') return { url: ${JSON.stringify(STUB_ARCHIVE)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
// H1.1: setup (register/env/fetch) เองก็อาจ throw — ครอบด้วย try/catch แยก คืนต้นฉบับแล้ว rethrow
//   (ไม่ใช้ outer try เดียวเพราะ `let fetchBombCalls` ต้องอยู่นอก scope ของ try หลักที่ตามมา)
let fetchBombCalls = 0;
const results = [];
try {
  register('data:text/javascript,' + encodeURIComponent(hook));

  // ---- env hygiene ก่อน import (module-level consts) — เริ่มสะอาดทุกสวิตช์ ----
  process.env.MEGA_SOLVER_SHADOW = '0';
  process.env.MEGA_YT_PARALLEL = '0';
  process.env.MEGA_HERO_GRADE_HARD = '0';
  for (const k of ENV_KEYS_TOUCHED) if (!['MEGA_SOLVER_SHADOW', 'MEGA_YT_PARALLEL', 'MEGA_HERO_GRADE_HARD'].includes(k)) delete process.env[k];

  // ---- fetch bomb ก่อน dynamic import เป้าหมาย (E12 ต้องนับ import-time ด้วย) ----
  globalThis.fetch = () => { fetchBombCalls++; throw new Error('NETWORK_BOMB: global.fetch is forbidden in this test'); };
} catch (setupErr) {
  restoreExactOriginals();
  throw setupErr;
}

// ---- H1: ทั้งเนื้อไฟล์อยู่ใน outer try/finally — restore ต้นฉบับเป๊ะแม้ import/assert ล้ม (ครอบคลุม setup throw ข้างบนแล้ว + import/assert throw ข้างล่าง) ----
try {

const { s6_slots, s7_cover, _dnaHashFor } = await import('../src/lib/megaAdapters.js');
const { resolveStrictLatches, STRICT_LATCH_KEYS, validateStrictRenderActivation } = await import('../src/lib/refSlotContract.js');
const { evaluateCoverQc } = await import('../src/lib/coverQcGate.js');
const { runCoverRefTest } = await import('../src/app/api/cover-ref-test/route.js');

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

// ---------- SYNTHETIC fixture (ห้ามอ้าง cloud AC-0099) ----------
// H1-2: sourceLink ตรง deterministic ต่อทุกแถวปกติ (รวม BLDG/PARTIAL/HERO-OK) — กัน readiness ล้มเพราะขาด direct-source แทนเรขาคณิต
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
    realShortSide: 900, sharpness: 80, // production SHARPNESS_MIN_HERO=25 (imageQualityConfig.js) is a raw Laplacian-variance scale, NOT 0-1 — 80 passes deterministically
    ...t,
  },
});
const HERO_NAME = 'ดวงเดือน';
const SECOND_NAME = 'สรพงศ์ ชาตรี';
// R1: ตึก/บริบทใหญ่ + หน้าจิ๋วติดขอบ (สูง .07 < .16) ป้าย person ผิดเป็นตัวเอก — analog แผงหลัก AC-0099
const R1_BLDG = IMG('BLDG', { person: HERO_NAME, category: 'context', faceBox: { x1: 0.90, y1: 0.02, x2: 0.99, y2: 0.09 }, realShortSide: 1500, note: 'ตึกสูงกับท้องฟ้า มีคนตัวเล็กมากมุมล่าง' }, { realWidth: 2000, realHeight: 1500 });
// R2: หัวแหว่ง (y1=0 < 0.01 edge)
const R2_PARTIAL = IMG('PARTIAL', { person: HERO_NAME, category: 'face-neutral', faceBox: { x1: 0.30, y1: 0.0, x2: 0.70, y2: 0.40 }, note: 'ภาพครอปหัวแหว่งบนสุด' });
// R3: hero ถูกต้อง (หน้าตรง สูง .35 กลางภาพ shortSide 1200)
const R3_HERO = IMG('HERO-OK', { person: HERO_NAME, category: 'face-emotional', faceBox: { x1: 0.35, y1: 0.20, x2: 0.65, y2: 0.55 }, realShortSide: 1200, note: 'ตัวเอกหน้าชัดกลางภาพ' }, { realWidth: 1300, realHeight: 1200 });
// R4: บุคคลที่สอง (วงกลม/reaction)
const R4_CIRC = IMG('CIRC', { person: SECOND_NAME, category: 'face-neutral', faceBox: { x1: 0.35, y1: 0.22, x2: 0.62, y2: 0.52 }, note: 'บุคคลที่สองหน้าตรง' });
const CTX = [
  IMG('CTX-1', { person: null, faceCount: 0, category: 'context', note: 'สถานที่เกิดเหตุมุมกว้าง' }),
  IMG('CTX-2', { person: null, faceCount: 0, category: 'document', note: 'เอกสารบนโต๊ะ' }),
  IMG('CTX-3', { person: null, faceCount: 0, category: 'context', note: 'บรรยากาศงาน' }),
];
const JUNK = Array.from({ length: 16 }, (_, i) => IMG(`JUNK-${String(i + 1).padStart(2, '0')}`, { person: null, faceCount: 0, category: 'other', quality: 3, note: `ภาพประกอบทั่วไป ${i + 1}` }));
const POOL_FULL = [R1_BLDG, R2_PARTIAL, R3_HERO, R4_CIRC, ...CTX, ...JUNK];           // 23 raw rows, eligible จริงน้อย
const POOL_NO_VALID_HERO = [R1_BLDG, R2_PARTIAL, R4_CIRC, ...CTX, ...JUNK];           // ไม่มี hero ที่ readiness ยอมรับ
const CHARS = [{ name: HERO_NAME, role: 'hero' }, { name: SECOND_NAME, role: 'related' }];

// ref DNA ของจริงจากคลัง local (tracked) — บท hero/context/action/moment/reaction (reaction = circle)
const refs = JSON.parse(fs.readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
const REF_REC = refs.find((r) => r.id === 'REF-mrbqalpo-h1r1');
assert.ok(REF_REC?.dna, 'ref DNA REF-mrbqalpo-h1r1 must exist in local library');
const DNA = REF_REC.dna;
const ORDERS = [
  { i: 0, role: 'hero', want: 'ตัวเอกโคลสอัพ', personHint: HERO_NAME, shot: 'closeup' },
  { i: 4, role: 'reaction', want: 'คนที่เรื่องพาดถึง', personHint: SECOND_NAME, shot: 'closeup' },
];
const ANSWER_GOOD = {
  hero: { id: 'HERO-OK', reason: 'ตัวเอก', backups: [] },
  context: { id: 'CTX-1', reason: 'สถานที่', backups: [] },
  action: { id: 'CTX-3', reason: 'บรรยากาศ', backups: [] },
  moment: { id: 'CTX-2', reason: 'หลักฐาน', backups: [] },
  reaction: { id: 'CIRC', reason: 'คนที่สอง', backups: [] },
};
const ANSWER_BAD_BLDG = { ...ANSWER_GOOD, hero: { id: 'BLDG', reason: 'LLM หลอน เลือกตึก', backups: [] } };
const ANSWER_BAD_PARTIAL = { ...ANSWER_GOOD, hero: { id: 'PARTIAL', reason: 'LLM หลอน หัวแหว่ง', backups: [] } };

// identity ผูกต้นน้ำ (production stamp ที่ s5/ref-binding) — fixture ใส่ให้ครบแล้ว assert ว่า "รอด" ทุกชั้นไม่ถูกแก้
const REF_ID = REF_REC.id;
const DNA_HASH = _dnaHashFor(DNA);
const REF_BOUND_AT = new Date(FIXED_TS).toISOString();
const mkRefMatch = () => ({ dna: DNA, styleName: 'ref-test', typeMatched: true, imagePath: '/ref-covers/test.jpg', refId: REF_ID, dnaHash: DNA_HASH, refBoundAt: REF_BOUND_AT });
const mkJob = ({ pool = POOL_FULL, orders = ORDERS } = {}) => ({
  dossier: {
    images: { caseId: 'AC0099-SYN' },
    compass: { angle: 'มุมทดสอบ', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: CHARS, visualDreamShots: [], doNotUse: [] },
    desk: { title: 'ข่าวทดสอบ AC-0099 สังเคราะห์' },
    refMatch: mkRefMatch(),
    artBrief: { storyNote: 'เรื่องทดสอบ', orders },
  },
});
const mkDeps = ({ pool = POOL_FULL, brainAnswer = ANSWER_GOOD, captures, queueTransport } = {}) => ({
  ...(queueTransport ? { queueTransport } : {}),
  slotDirectorBrain: async (args) => { captures.brainArgs.push(args); return { slots: brainAnswer, note: 'synthetic' }; },
  fetchJson: async (url, opts) => {
    captures.fetches.push(String(url));
    if (String(url).includes('/api/images/')) return { success: true, images: pool };
    if (String(url).includes('/api/queue/add')) {
      captures.queueCalls = (captures.queueCalls || 0) + 1;
      captures.rawBodies.push(opts.body);
      captures.payload = JSON.parse(opts.body);
      return { success: true, jobId: 'JOB-AC0099-SYN' };
    }
    throw new Error('unexpected fetch in test: ' + url);
  },
});
const mkCaptures = () => ({ brainArgs: [], fetches: [], rawBodies: [], payload: null, queueCalls: 0 });
const SEM_ON = { MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' };
const STRICT_ON = { ...SEM_ON, MEGA_STRICT_PRODUCER: '1', MEGA_STRICT_RENDER: '1' };

// run real s6(+s7) with injected deps — คืน { s6, s7, captures, job }
async function runPipeline({ pool, brainAnswer, env, runS7 = true, s7Deps } = {}) {
  return withEnvMap(env || {}, () => withFixedNow(async () => {
    const captures = mkCaptures();
    const job = mkJob({ pool });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer, captures }) });
    let s7 = null;
    if (runS7 && s6.status === 'done') {
      Object.assign(job.dossier, s6.dossierPatch);
      s7 = await s7_cover(job, { origin: 'http://mock', _deps: { ...mkDeps({ pool, brainAnswer, captures }), ...(s7Deps || {}) } });
    }
    return { s6, s7, captures, job };
  }));
}

// ---------- route harness ----------
// stage stub มาตรฐาน (adapter convention) — เติม dossier พื้นฐานให้ครบ
const stg = (patch) => async (job) => ({ status: 'done', nextAction: 'continue', summary: 'stub', ...(patch ? { dossierPatch: typeof patch === 'function' ? patch(job) : patch } : {}) });
const baseDossierPatches = {
  compass: { compass: mkJob().dossier.compass },
  images: { images: { caseId: 'AC0099-SYN' } },
  refMatch: { refMatch: mkRefMatch(), artBrief: mkJob().dossier.artBrief, desk: mkJob().dossier.desk },
};
// s6/s7 stub producers
const s6StubDone = (slots) => async (job) => ({ status: 'done', nextAction: 'continue', summary: 'stub-s6', dossierPatch: { pickImages: { slots, note: 'stub', slotOrder: Object.keys(slots), heroSlotId: 'hero', semanticSelection: true, slotContractHash: 'stubhash' } } });
const WIRE_GOOD = JSON.stringify({
  composer: 'mega', newsTitle: 'ข่าวทดสอบ AC-0099 สังเคราะห์',
  slotPlan: [
    { url: 'https://cdn.test/HERO-OK.jpg', slot: 'main', isHero: true, refSlotId: 'hero' },
    { url: 'https://cdn.test/CIRC.jpg', slot: 'circle', refSlotId: 'reaction' },
    { url: 'https://cdn.test/CTX-1.jpg', slot: 'context_3', refSlotId: 'context' },
  ],
  refDNA: null, refImagePath: null,
});
const mkS7Stub = ({ wire = WIRE_GOOD, calls = 1, coverOrigin = 'http://localhost:3000' } = {}) => async (job, { _deps } = {}) => {
  for (let i = 0; i < calls; i++) await _deps.fetchJson(`${coverOrigin}/api/queue/add`, { method: 'POST', body: wire });
  return { status: 'done', nextAction: 'continue', summary: 'stub-s7 queued' };
};
const COVER_OK = { success: true, base64: 'data:image/jpeg;base64,QUMwMDk5', template: 'ref_dna', score: 'synthetic', caseId: 'AC0099-SYN', qcFlags: [] };
function mkRouteDeps({ s6 = s6StubDone({ hero: { id: 'HERO-OK', imageUrl: 'https://cdn.test/HERO-OK.jpg', refSlotId: 'hero' } }), s7 = mkS7Stub(), compose = async () => ({ ...COVER_OK }), qc, env = {}, counters }) {
  const c = counters;
  return {
    compassBrain: stg(baseDossierPatches.compass),
    s5_case: stg(baseDossierPatches.images),
    s5_keywords: stg(null),
    s5_search: stg(null),
    s5_triage: stg(baseDossierPatches.refMatch),
    s5_clipframe: stg(null),
    s6_slots: s6,
    s7_cover: s7,
    composeAndVerify: async (p) => { c.composeCalls++; c.composePayloads.push(p); return compose(p); },
    ...(qc ? { evaluateCoverQc: qc } : {}),
    readImageCase: async () => ({ httpStatus: 200, success: true, images: POOL_FULL }),
    loadArchive: async () => ({ addMegaCover: async (e) => { c.archiveCalls++; c.archiveEntries.push(e); return { id: 'ARC-1' }; } }),
    persistCoverImage: async () => { c.persistCalls++; return null; },
    env,
  };
}
const mkCounters = () => ({ composeCalls: 0, composePayloads: [], archiveCalls: 0, archiveEntries: [], persistCalls: 0 });
async function runRoute(input, depsOpts) {
  const counters = mkCounters();
  const deps = mkRouteDeps({ ...depsOpts, counters });
  const res = await withFixedNow(() => runCoverRefTest(input, deps));
  return { res, counters };
}
// เนื้อข่าวเต็ม (กติกา cover-test full-content — route ปัด NO_CONTENT ถ้าสั้น) · สังเคราะห์ล้วน deterministic
const INPUT = {
  content: [
    'ข่าวทดสอบ AC-0099 สังเคราะห์: เหตุการณ์ตัวอย่างสำหรับทดสอบสายพานทำปกแบบ strict เท่านั้น ไม่เกี่ยวข้องกับบุคคลจริงหรือเหตุการณ์จริงใดๆ ทั้งสิ้น',
    'เนื้อเรื่องสมมุติ: ดวงเดือนตัวเอกของเรื่องได้เดินทางไปยังสถานที่เกิดเหตุสมมุติเพื่อพบกับสรพงศ์ ชาตรี บุคคลที่สองของเรื่อง ทั้งสองได้พูดคุยกันถึงเหตุการณ์ที่เกิดขึ้นอย่างละเอียด',
    'รายละเอียดเพิ่มเติม: ภาพประกอบในคลังของเคสนี้ประกอบด้วยภาพตึกสูงที่มีคนตัวเล็กมากที่มุมภาพ ภาพครอปหัวแหว่ง ภาพตัวเอกหน้าชัดกลางภาพ และภาพบริบทอื่นๆ อีกจำนวนมาก',
    'จุดประสงค์: ใช้ตรวจว่าระบบเลือกภาพตัวเอกถูกต้อง ไม่เลือกภาพตึกหรือภาพหัวแหว่งมาเป็นภาพหลัก และตรวจว่าเส้นทาง strict ทำงานตามสัญญาทุกขั้นตอนโดยไม่หลุดไปสาย legacy เงียบๆ',
  ].join(' '),
  newsTitle: 'ข่าวทดสอบ AC-0099 สังเคราะห์',
};

// ---------- results table ----------
async function E(name, fn) {
  try { await fn(); results.push([name, 'PASS', '']); console.log(`ok - ${name}`); }
  catch (err) { results.push([name, 'FAIL', String(err && err.message || err).slice(0, 200)]); console.log(`not ok - ${name} :: ${String(err && err.message || err).slice(0, 200)}`); }
}
const j = (x) => JSON.stringify(x);

// ============================================================ E1
await E('E1 OFF byte parity (unset vs explicit OFF)', async () => {
  const offEnv1 = {};
  const offEnv2 = { MEGA_SEMANTIC_SELECTION: '0', MEGA_SELECTION_SPEC: '0', MEGA_STRICT_PRODUCER: '0', MEGA_STRICT_RENDER: '0', MEGA_ROLE_READINESS: '0' };
  const a = await runRoute(INPUT, { env: offEnv1 });
  const b = await runRoute(INPUT, { env: offEnv2 });
  // latch echo สะท้อนค่า env ดิบโดยออกแบบ (undefined vs '0') — business result ที่เหลือต้อง byte-identical
  const strip = (res) => { const c = JSON.parse(j(res)); if (c.body) { delete c.body.latchReport; delete c.body.strictLatches; delete c.body.latches; } return c; };
  assert.strictEqual(j(strip(a.res)), j(strip(b.res)), 'route result byte identical (minus raw latch echo)');
  assert.deepStrictEqual(a.counters.archiveEntries, b.counters.archiveEntries, 'archive payload identical');
  assert.strictEqual(j(a.counters.archiveEntries), j(b.counters.archiveEntries), 'archive byte identical');
  assert.strictEqual(a.counters.archiveCalls, b.counters.archiveCalls);
  // real S6 parity บน fixture เดียวกัน (dossier)
  const p1 = await runPipeline({ brainAnswer: ANSWER_BAD_BLDG, env: {}, runS7: false });
  const p2 = await runPipeline({ brainAnswer: ANSWER_BAD_BLDG, env: { MEGA_ROLE_READINESS: '0' }, runS7: false });
  assert.strictEqual(j(p1.s6), j(p2.s6), 'S6 dossier byte parity');
});

// ============================================================ E2
await E('E2 typed 422 + archive0 (S7 not-done / missing capture / consumer throw / compose fail / QC fail)', async () => {
  const cases = [
    { s7: async () => ({ status: 'waiting', nextAction: 'wait', summary: 'strict_render_not_armed' }) },
    { s7: async () => ({ status: 'done', nextAction: 'continue', summary: 'no queue call' }) }, // missing capture
    { compose: async () => { throw new Error('consumer boom'); } },
    { compose: async () => ({ success: false, error: 'compose fail' }) },
    { compose: async () => ({ ...COVER_OK, qcFlags: ['person_cut:slot2'] }) }, // QC fail (real evaluateCoverQc)
  ];
  for (const [i, c] of cases.entries()) {
    const { res, counters } = await runRoute(INPUT, { ...c });
    assert.strictEqual(res.status, 422, `case ${i} status 422 (got ${res.status} ${j(res.body?.errorType)})`);
    assert.ok(res.body && typeof res.body.errorType === 'string' && res.body.errorType, `case ${i} typed errorType`);
    assert.strictEqual(counters.archiveCalls, 0, `case ${i} archiveCalls=0`);
  }
});

// ============================================================ E3 + E6 (real s6→s7, strict armed)
let STRICT_RUN_1 = null, STRICT_RUN_2 = null;
await E('E3 raw queue body byte-identical across 2 identical fixed-time strict runs', async () => {
  STRICT_RUN_1 = await runPipeline({ brainAnswer: ANSWER_GOOD, env: STRICT_ON });
  STRICT_RUN_2 = await runPipeline({ brainAnswer: ANSWER_GOOD, env: STRICT_ON });
  assert.strictEqual(STRICT_RUN_1.s7?.status, 'done', `s7 run1 done (got ${STRICT_RUN_1.s7?.status} ${STRICT_RUN_1.s7?.summary})`);
  assert.strictEqual(STRICT_RUN_1.captures.queueCalls, 1, 'run1 exactly one queue POST');
  assert.strictEqual(STRICT_RUN_2.captures.queueCalls, 1, 'run2 exactly one queue POST');
  assert.strictEqual(STRICT_RUN_1.captures.rawBodies[0], STRICT_RUN_2.captures.rawBodies[0], 'raw body strings byte-identical');
});

await E('E6 exact deterministic strict-pair fields + per-slot exact link (no post-S6 swap)', async () => {
  assert.ok(STRICT_RUN_1?.s6 && STRICT_RUN_2?.s6, 'needs E3 strict runs');
  assert.strictEqual(STRICT_RUN_1.s6.status, 'done', `run1 s6 done (got ${STRICT_RUN_1.s6.status})`);
  assert.strictEqual(STRICT_RUN_2.s6.status, 'done', `run2 s6 done (got ${STRICT_RUN_2.s6.status})`);
  assert.strictEqual(STRICT_RUN_1.s7?.status, 'done', `run1 s7 done (got ${STRICT_RUN_1.s7?.status})`);
  assert.strictEqual(STRICT_RUN_2.s7?.status, 'done', `run2 s7 done (got ${STRICT_RUN_2.s7?.status})`);
  assert.strictEqual(STRICT_RUN_1.captures.queueCalls, 1, 'run1 queue1');
  assert.strictEqual(STRICT_RUN_2.captures.queueCalls, 1, 'run2 queue1');

  const p1 = STRICT_RUN_1.captures.payload, p2 = STRICT_RUN_2.captures.payload;
  const s1 = p1.selectionSpec, s2 = p2.selectionSpec;
  assert.ok(s1 && p1.realizedTemplate, 'strict pair present run1');
  assert.ok(s2 && p2.realizedTemplate, 'strict pair present run2');

  // H2A1.1: hash fields ต้องเป็น nonblank string จริง (ไม่ใช่ undefined/''/number) ก่อนเทียบ cross-run — กัน equality เท็จจาก undefined===undefined
  for (const spec of [s1, s2]) {
    for (const field of ['specHash', 'backupPoolHash', 'replayHash']) {
      assert.strictEqual(typeof spec[field], 'string', `spec.${field} is a string (got ${typeof spec[field]})`);
      assert.ok(spec[field].length > 0, `spec.${field} is nonblank (got ${j(spec[field])})`);
    }
  }

  // deterministic equality — fields that genuinely exist on the real spec object (verified against src/lib/refSlotContract.js buildSelectionSpec exact-authority branch)
  for (const field of ['specHash', 'backupPoolHash', 'replayHash', 'refId', 'strictReady']) {
    assert.strictEqual(s1[field], s2[field], `spec.${field} deterministic across runs (run1=${j(s1[field])} run2=${j(s2[field])})`);
  }
  assert.deepStrictEqual(s1.counts, s2.counts, 'spec.counts deterministic');
  assert.deepStrictEqual(s1, s2, 'complete selectionSpec deep-equal across runs');
  assert.deepStrictEqual(p1.realizedTemplate, p2.realizedTemplate, 'realizedTemplate deterministic');

  // REF_ID / strictReady / zero missing-duplicate-semanticFallback
  assert.strictEqual(s1.refId, REF_ID, 'spec.refId === bound REF_ID');
  assert.strictEqual(s1.strictReady, true, 'strictReady true');
  assert.strictEqual(s1.counts.missingPrimary, 0, 'zero missing primaries');
  assert.strictEqual(s1.counts.duplicatePrimary, 0, 'zero duplicate primaries');
  assert.strictEqual(s1.counts.duplicatePrimaryUrl, 0, 'zero duplicate primary URL aliases');
  assert.strictEqual(s1.counts.semanticFallback, 0, 'zero semanticFallback (exact-authority branch)');
  assert.strictEqual(s1.counts.unmapped, 0, 'zero unmapped slots');

  const pi1 = STRICT_RUN_1.s6.dossierPatch.pickImages, pi2 = STRICT_RUN_2.s6.dossierPatch.pickImages;
  assert.ok(pi1.slotContractHash, 'slotContractHash present');
  assert.strictEqual(pi1.slotContractHash, pi2.slotContractHash, 'slotContractHash deterministic');

  // exact per-spec-slot link, both runs: spec.slots[i].primary === matching S6 slot pick, and exactly one wire row same refSlotId+URL
  for (const [runLabel, run, spec, payload] of [['run1', STRICT_RUN_1, s1, p1], ['run2', STRICT_RUN_2, s2, p2]]) {
    const s6Slots = run.s6.dossierPatch.pickImages.slots;
    assert.strictEqual(spec.slots.length, Object.keys(s6Slots).length, `${runLabel}: spec.slots count === S6 slot count`);
    for (const slotEntry of spec.slots) {
      const s6slot = s6Slots[slotEntry.refSlotId];
      assert.ok(s6slot, `${runLabel}: spec slot ${slotEntry.refSlotId} exists in S6 slots`);
      assert.ok(slotEntry.primary, `${runLabel}: spec slot ${slotEntry.refSlotId} has a primary`);
      assert.strictEqual(slotEntry.primary.candidateId, String(s6slot.id), `${runLabel}: primary.candidateId === S6 pick id for ${slotEntry.refSlotId}`);
      assert.strictEqual(slotEntry.primary.imageUrl, s6slot.imageUrl, `${runLabel}: primary.imageUrl === S6 pick imageUrl for ${slotEntry.refSlotId}`);
      // H2A1.1: กรองด้วย refSlotId เท่านั้น (ห้ามกรองด้วย url ก่อนนับ — จะบัง false-positive ถ้า wire มีสอง row ชื่อ refSlotId เดียวกันแต่ url ต่างกัน)
      const wireRows = payload.slotPlan.filter((r) => r.refSlotId === slotEntry.refSlotId);
      assert.strictEqual(wireRows.length, 1, `${runLabel}: exactly one wire row for refSlotId=${slotEntry.refSlotId} (got ${wireRows.length})`);
      assert.strictEqual(wireRows[0].url, slotEntry.primary.imageUrl, `${runLabel}: sole wire row URL === spec primary.imageUrl for ${slotEntry.refSlotId}`);
      assert.strictEqual(wireRows[0].url, s6slot.imageUrl, `${runLabel}: sole wire row URL === S6 pick imageUrl for ${slotEntry.refSlotId}`);
    }
  }
});

// ============================================================ E4
await E('E4 exact queue-attempt accounting: success 1/1, prequeue-fail 0/0, double-call 2-attempted/1-accepted', async () => {
  // block-local counted S7 wrapper (ไม่ใช้ mkS7Stub ที่ block อื่นใช้ร่วม) — นับ "attempted" ฝั่ง caller เอง แยกจาก body.queueCalls ที่ seam ยอมรับจริง
  const mkCountedS7 = (calls) => {
    const state = { attempted: 0 };
    const s7 = async (job, { _deps } = {}) => {
      for (let i = 0; i < calls; i++) {
        state.attempted++;
        await _deps.fetchJson('http://localhost:3000/api/queue/add', { method: 'POST', body: WIRE_GOOD });
      }
      return { status: 'done', nextAction: 'continue', summary: 'counted-s7' };
    };
    return { s7, state };
  };

  // success: attempted=1, seam accepts it, compose runs exactly once
  const okC = mkCountedS7(1);
  const ok = await runRoute(INPUT, { s7: okC.s7 });
  assert.strictEqual(ok.res.status, 200, `success status exact 200 (got ${ok.res.status} ${j(ok.res.body?.errorType)})`);
  assert.strictEqual(ok.res.body?.success, true, 'success body.success exact true');
  assert.strictEqual(okC.state.attempted, 1, 'attempted queue calls = 1');
  assert.strictEqual(ok.counters.composeCalls, 1, 'compose exactly once');

  // prequeue failure: S7 fails BEFORE ever attempting a queue call — explicit local counter (incremented only if the
  // stub actually reaches _deps.fetchJson) proves zero attempts, alongside the seam's own accepted body.queueCalls=0
  let preAttempted = 0;
  const pre = await runRoute(INPUT, {
    s7: async (job, { _deps } = {}) => {
      const attemptQueue = () => { preAttempted++; return _deps.fetchJson('http://localhost:3000/api/queue/add', { method: 'POST', body: WIRE_GOOD }); };
      void attemptQueue; // จงใจไม่เรียก — S7 fail ก่อนถึงขั้นยิงคิวจริง; ถ้าโค้ดในอนาคตเผลอเรียก attemptQueue() ตรงนี้ preAttempted จะขยับให้ assert ด้านล่างจับได้ทันที
      return { status: 'failed', nextAction: 'fail', summary: 'pre-queue fail (synthetic)' };
    },
  });
  assert.strictEqual(pre.res.status, 422, `prequeue status exact 422 (got ${pre.res.status})`);
  assert.strictEqual(pre.res.body?.errorType, 'S7_FAILED', `errorType exact S7_FAILED (got ${j(pre.res.body?.errorType)})`);
  assert.strictEqual(preAttempted, 0, 'preAttempted local counter stays 0 — S7 stub never attempted a queue call before failing');
  assert.strictEqual(pre.res.body?.queueCalls, 0, `body.queueCalls exact 0 — seam-accepted count also 0 (got ${j(pre.res.body?.queueCalls)})`);
  assert.strictEqual(pre.counters.composeCalls, 0, 'prequeue: compose0');
  assert.strictEqual(pre.counters.persistCalls, 0, 'prequeue: persist0');
  assert.strictEqual(pre.counters.archiveCalls, 0, 'prequeue: archive0');

  // double call: attempted=2 (both invocations reach the seam), seam accepts the 1st then rejects the 2nd
  const dblC = mkCountedS7(2);
  const dbl = await runRoute(INPUT, { s7: dblC.s7 });
  assert.strictEqual(dblC.state.attempted, 2, 'attempted queue calls = 2');
  assert.strictEqual(dbl.res.status, 422, `double status exact 422 (got ${dbl.res.status})`);
  assert.strictEqual(dbl.res.body?.errorType, 'SEAM_SECOND_QUEUE_CALL', `errorType exact (got ${j(dbl.res.body?.errorType)})`);
  assert.strictEqual(dbl.res.body?.holdReason, dbl.res.body?.errorType, 'holdReason === errorType for seam reject (seamError sets holdReason=errorType when no extra.holdReason given)');
  assert.strictEqual(dbl.res.body?.queueCalls, 1, `body.queueCalls exact 1 — seam accepted the 1st before rejecting the 2nd (got ${j(dbl.res.body?.queueCalls)})`);
  assert.strictEqual(dbl.counters.composeCalls, 0, 'double: compose0');
  assert.strictEqual(dbl.counters.persistCalls, 0, 'double: persist0');
  assert.strictEqual(dbl.counters.archiveCalls, 0, 'double: archive0');
});

// ============================================================ E5 (real s6→s7 identity survival)
await E('E5 identity survives S6→wire→compose→response; archive once (no claim that archive payload stores identity)', async () => {
  assert.ok(STRICT_RUN_1, 'needs strict run');
  const rm = STRICT_RUN_1.job.dossier.refMatch;
  assert.strictEqual(rm.refId, REF_ID, 'S6 refId exact');
  assert.strictEqual(rm.dnaHash, DNA_HASH, 'S6 dnaHash exact');
  assert.strictEqual(rm.refBoundAt, REF_BOUND_AT, 'S6 refBoundAt exact');
  const spec = STRICT_RUN_1.captures.payload.selectionSpec;
  assert.strictEqual(spec.refId, rm.refId, 'wire selectionSpec.refId === S6 refId');
  // ผ่าน route จริง: real s6+s7 + compose/archive counters — ตาม S6→wire→compose→response; archive once
  // (real s6 ต้องเห็นคลังรูป — route อาจไม่ส่ง fetchJson เข้า s6 → wrapper เติม fallback pool fetch เอง ห้ามหลุด global.fetch)
  const poolFetch = async (url) => { if (String(url).includes('/api/images/')) return { success: true, images: POOL_FULL }; throw new Error('unexpected s6 fetch: ' + url); };
  const counters = mkCounters();
  const deps = {
    ...mkRouteDeps({ counters }),
    s6_slots: (job, opts) => s6_slots(job, { ...opts, _deps: { fetchJson: opts?._deps?.fetchJson || poolFetch, ...(opts?._deps || {}), slotDirectorBrain: async () => ({ slots: ANSWER_GOOD, note: 'synthetic' }) } }),
    s7_cover,
    env: STRICT_ON,
  };
  const out = await withEnvMap(STRICT_ON, () => withFixedNow(() => runCoverRefTest(INPUT, deps)));
  assert.strictEqual(out.status, 200, `route success status exact 200 (got ${out.status} ${j(out.body?.errorType)} ${j(out.body?.holdReason)})`);
  assert.strictEqual(out.body?.success, true, 'route success body.success exact true');
  assert.strictEqual(counters.composeCalls, 1, 'compose exactly once');
  assert.strictEqual(counters.archiveCalls, 1, 'archive exactly once');
  assert.strictEqual(counters.archiveEntries.length, 1, 'exactly one archive entry');
  const composeArg = counters.composePayloads[0];
  assert.ok(Object.prototype.hasOwnProperty.call(composeArg, 'selectionSpec') && Object.prototype.hasOwnProperty.call(composeArg, 'realizedTemplate'), 'compose args carry the strict pair (selectionSpec + realizedTemplate both present)');
  assert.strictEqual(composeArg.selectionSpec.refId, REF_ID, 'compose args selectionSpec.refId === REF_ID');
  // response.matchedRef — ซื่อสัตย์: นี่คือ route's own response shape (S6→wire→compose→response), ไม่ใช่ claim ว่า archive payload เก็บ identity
  const mref = out.body?.matchedRef || {};
  assert.strictEqual(mref.refId, REF_ID, `response matchedRef.refId exact (got ${j(mref.refId)})`);
  assert.strictEqual(mref.dnaHash, DNA_HASH, `response matchedRef.dnaHash exact (got ${j(mref.dnaHash)})`);
  assert.strictEqual(mref.refBoundAt, REF_BOUND_AT, `response matchedRef.refBoundAt exact (got ${j(mref.refBoundAt)})`);
  // ไม่ assert ว่า archive entry (counters.archiveEntries[0]) เก็บ identity fields ตรงๆ — production archive schema เก็บ trace/cover metadata เท่านั้น
});

// ============================================================ E7
await E('E7 missing/stale ref identity ⇒ typed 422, archive0, no synthesized fallback', async () => {
  // strict armed (env) แต่ identity ต้นน้ำหาย (refMatch ไม่มี refId/dnaHash) → real s7 ต้อง HOLD missing_ref_id → route 422 typed
  const noIdRefMatch = { dna: DNA, styleName: 'ref-test', typeMatched: true, imagePath: '/ref-covers/test.jpg' }; // ไม่มี refId/dnaHash/refBoundAt
  const poolFetch = async (url) => { if (String(url).includes('/api/images/')) return { success: true, images: POOL_FULL }; throw new Error('unexpected s6 fetch: ' + url); };
  const counters = mkCounters();
  const deps = {
    ...mkRouteDeps({ counters }),
    s5_triage: stg({ refMatch: noIdRefMatch, artBrief: mkJob().dossier.artBrief, desk: mkJob().dossier.desk }),
    s6_slots: (job, opts) => s6_slots(job, { ...opts, _deps: { fetchJson: opts?._deps?.fetchJson || poolFetch, ...(opts?._deps || {}), slotDirectorBrain: async () => ({ slots: ANSWER_GOOD, note: 'synthetic' }) } }),
    s7_cover,
    env: STRICT_ON,
  };
  const res = await withEnvMap(STRICT_ON, () => withFixedNow(() => runCoverRefTest(INPUT, deps)));
  assert.strictEqual(res.status, 422, `missing → 422 (got ${res.status} ${j(res.body?.errorType)} ${j(res.body?.holdReason)})`);
  // จริง: real s7_cover เองจับ missing identity ก่อนผลิต wire ใดๆ (s7.status='waiting') — route จึงตอบผ่านสาขา "S7 ไม่ done"
  // errorType='STRICT_HOLD', holdReason=s7.summary ดิบ (มี token 'missing_ref_id' เป็นหลักฐาน) — ไม่ใช่ route's own ref_identity_missing guard (นั่นทำงานเฉพาะเมื่อ wire ถูกจับมาแล้วแต่ identity หาย/ไม่ตรง)
  assert.strictEqual(res.body?.errorType, 'STRICT_HOLD', `typed STRICT_HOLD (got ${j(res.body?.errorType)})`);
  assert.ok(typeof res.body?.holdReason === 'string' && res.body.holdReason.includes('missing_ref_id'), `holdReason carries real s7 diagnostic missing_ref_id (got ${j(res.body?.holdReason)})`);
  assert.strictEqual(counters.composeCalls, 0, 'missing: compose0');
  assert.strictEqual(counters.persistCalls, 0, 'missing: persist0');
  assert.strictEqual(counters.archiveCalls, 0, 'missing: archive0');
  assert.ok(!j(res.body).includes(`"refId":"${REF_ID}"`), 'no synthesized refId in body');

  // H1-3: genuine stale/mismatched strict-pair — wire ครบคู่ (strictEngaged=true) แต่ spec.refId ≠ bound refId
  const staleWire = JSON.stringify({
    composer: 'mega', newsTitle: 'x',
    slotPlan: [{ url: 'https://cdn.test/HERO-OK.jpg', slot: 'main', isHero: true, refSlotId: 'hero' }],
    refDNA: null, refImagePath: null,
    selectionSpec: { refId: 'REF-OTHER-STALE-ID', v: 1, strictReady: true },
    realizedTemplate: { id: 'ref_dna', slots: [] },
  });
  const stale = await runRoute(INPUT, { env: STRICT_ON, s7: mkS7Stub({ wire: staleWire }) });
  assert.strictEqual(stale.res.status, 422, `stale → 422 (got ${stale.res.status} ${j(stale.res.body?.holdReason)})`);
  assert.strictEqual(stale.res.body?.errorType, 'STRICT_HOLD', 'typed STRICT_HOLD');
  assert.strictEqual(stale.res.body?.holdReason, 'ref_identity_stale', `holdReason exact ref_identity_stale (got ${j(stale.res.body?.holdReason)})`);
  assert.strictEqual(stale.counters.composeCalls, 0, 'stale: compose0');
  assert.strictEqual(stale.counters.persistCalls, 0, 'stale: persist0');
  assert.strictEqual(stale.counters.archiveCalls, 0, 'stale: archive0');
  assert.ok(!j(stale.res.body).includes('"refId":"REF-OTHER-STALE-ID"') || j(stale.res.body).includes('"specRefId"'), 'no silent fallback — mismatch surfaced, not swallowed');
});

// ============================================================ E8 / E9 / E10 (real s6 + readiness)
await E('E8 readiness ON: building/tiny-edge ⇒ exact failed/fail/INSUFFICIENT_HERO_GRADE, s7 never runs (real business logic, not harness skip)', async () => {
  const { s6, s7, captures } = await runPipeline({ pool: POOL_NO_VALID_HERO, brainAnswer: ANSWER_BAD_BLDG, env: { ...SEM_ON, MEGA_ROLE_READINESS: '1' } });
  assert.strictEqual(s6.status, 'failed', `status exact failed (got ${s6.status})`);
  assert.strictEqual(s6.nextAction, 'fail', `nextAction exact fail (got ${j(s6.nextAction)})`);
  assert.strictEqual(s6.reason, 'INSUFFICIENT_HERO_GRADE', `reason exact (got ${j(s6.reason)} summary=${j(s6.summary).slice(0, 150)})`);
  assert.strictEqual(s7, null, 's7 never invoked — runPipeline only calls s7 when s6.status===done, so s6 failure genuinely blocks downstream');
  assert.strictEqual(captures.queueCalls, 0, 'no downstream queue call');
  const committed = s6.dossierPatch?.pickImages?.slots?.[s6.dossierPatch?.pickImages?.heroSlotId];
  assert.ok(!committed || !['BLDG', 'PARTIAL'].includes(committed.id), 'BLDG/PARTIAL not committed as hero');
});
await E('E9 readiness ON: partial-head ⇒ exact failed/fail/INSUFFICIENT_HERO_GRADE, s7 never runs (real business logic, not harness skip)', async () => {
  const pool = [R2_PARTIAL, R4_CIRC, ...CTX, ...JUNK];
  const { s6, s7, captures } = await runPipeline({ pool, brainAnswer: ANSWER_BAD_PARTIAL, env: { ...SEM_ON, MEGA_ROLE_READINESS: '1' } });
  assert.strictEqual(s6.status, 'failed', `status exact failed (got ${s6.status})`);
  assert.strictEqual(s6.nextAction, 'fail', `nextAction exact fail (got ${j(s6.nextAction)})`);
  assert.strictEqual(s6.reason, 'INSUFFICIENT_HERO_GRADE', `reason exact (got ${j(s6.reason)})`);
  assert.strictEqual(s7, null, 's7 never invoked — genuine S6 failure blocks downstream, not a harness skip');
  assert.strictEqual(captures.queueCalls, 0, 'no downstream queue call');
  const committed = s6.dossierPatch?.pickImages?.slots?.[s6.dossierPatch?.pickImages?.heroSlotId];
  assert.ok(!committed || !['BLDG', 'PARTIAL'].includes(committed.id), 'BLDG/PARTIAL not committed as hero');
});
await E('E10 readiness OFF on same fixture = inert/legacy parity (bug reproduces)', async () => {
  const off1 = await runPipeline({ pool: POOL_NO_VALID_HERO, brainAnswer: ANSWER_BAD_BLDG, env: SEM_ON, runS7: false });
  const off2 = await runPipeline({ pool: POOL_NO_VALID_HERO, brainAnswer: ANSWER_BAD_BLDG, env: { ...SEM_ON, MEGA_ROLE_READINESS: '0' }, runS7: false });
  assert.strictEqual(j(off1.s6), j(off2.s6), 'OFF byte parity');
  assert.strictEqual(off1.s6.status, 'done', 'legacy completes (bug preserved when OFF)');
  const hero = off1.s6.dossierPatch.pickImages.slots[off1.s6.dossierPatch.pickImages.heroSlotId];
  assert.strictEqual(hero.id, 'BLDG', 'legacy picks the building (regression analog reproduced)');
});

// ============================================================ E11 (transport seam, platform override)
await E('E11 bypass requires BOTH exact queueTransport marker AND fetchJson function (platform-guard active)', async () => {
  const desc = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!desc || !desc.configurable) { throw new Error('STOP-E11: process.platform descriptor not configurable — cannot simulate non-win32 honestly'); }
  Object.defineProperty(process, 'platform', { ...desc, value: 'linux' });
  try {
    await withEnvMap({ ...STRICT_ON, MEGA_COVER_ORIGIN: undefined }, () => withFixedNow(async () => {
      // block-local prepare(captures): รัน real S6 จนจบ (status='done') แล้ว merge dossierPatch — คืน job พร้อมให้ s7_cover ใช้ต่อ
      const prepare = async (captures) => {
        const job = mkJob();
        const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ brainAnswer: ANSWER_GOOD, captures }) });
        assert.strictEqual(s6.status, 'done', `prepare(): S6 must complete done (got ${s6.status})`);
        Object.assign(job.dossier, s6.dossierPatch);
        return job;
      };

      // 1) BOTH exact marker + fetchJson function → bypass ผ่าน guard, ยิงคิวจริง 1 ครั้ง, body ถูกจับ 1 ก้อน
      const cBoth = mkCaptures();
      const jobBoth = await prepare(cBoth);
      const both = await s7_cover(jobBoth, { origin: 'http://mock', _deps: mkDeps({ brainAnswer: ANSWER_GOOD, captures: cBoth, queueTransport: 'cover_ref_test_in_process' }) });
      assert.strictEqual(both.status, 'done', `both present → done (got ${both.status} ${both.summary})`);
      assert.strictEqual(cBoth.queueCalls, 1, 'both: queueCalls exact 1');
      assert.strictEqual(cBoth.rawBodies.length, 1, 'both: rawBodies exact 1');

      // 2) transport-only (ไม่มี fetchJson) → guard กันตรง — exact waiting/wait, queueCalls0
      const cT = mkCaptures();
      const jobT = await prepare(cT);
      const tOnly = await s7_cover(jobT, { origin: 'http://mock', _deps: { queueTransport: 'cover_ref_test_in_process' } });
      assert.strictEqual(tOnly.status, 'waiting', `transport-only → exact waiting (got ${tOnly.status})`);
      assert.strictEqual(tOnly.nextAction, 'wait', `transport-only → exact wait (got ${j(tOnly.nextAction)})`);
      assert.strictEqual(cT.queueCalls, 0, 'transport-only: queueCalls exact 0');

      // 3) fetch-only (marker หาย) → guard กันตรง — exact waiting/wait, queueCalls0
      const cF = mkCaptures();
      const jobF = await prepare(cF);
      const fOnly = await s7_cover(jobF, { origin: 'http://mock', _deps: { fetchJson: mkDeps({ brainAnswer: ANSWER_GOOD, captures: cF }).fetchJson } });
      assert.strictEqual(fOnly.status, 'waiting', `fetch-only → exact waiting (got ${fOnly.status})`);
      assert.strictEqual(fOnly.nextAction, 'wait', `fetch-only → exact wait (got ${j(fOnly.nextAction)})`);
      assert.strictEqual(cF.queueCalls, 0, 'fetch-only: queueCalls exact 0');

      // 4) wrong-marker + fetchJson (สตริงผิด ไม่ใช่ exact sentinel) → guard กันตรง — exact waiting/wait, queueCalls0
      const cW = mkCaptures();
      const jobW = await prepare(cW);
      const wrongMarker = await s7_cover(jobW, { origin: 'http://mock', _deps: { ...mkDeps({ brainAnswer: ANSWER_GOOD, captures: cW }), queueTransport: 'wrong_sentinel_value' } });
      assert.strictEqual(wrongMarker.status, 'waiting', `wrong-marker+fetch → exact waiting (got ${wrongMarker.status})`);
      assert.strictEqual(wrongMarker.nextAction, 'wait', `wrong-marker+fetch → exact wait (got ${j(wrongMarker.nextAction)})`);
      assert.strictEqual(cW.queueCalls, 0, 'wrong-marker+fetch: queueCalls exact 0');
    }));
  } finally { Object.defineProperty(process, 'platform', desc); }
  const restored = Object.getOwnPropertyDescriptor(process, 'platform');
  assert.deepStrictEqual(restored, desc, 'process.platform descriptor deep-equals the saved original after restoration');
});

// ============================================================ E13
await E('E13 hero_unverified_kept + hero_gate_error ⇒ QC manual_review fail ⇒ route 422/archive0', async () => {
  for (const flag of ['hero_unverified_kept', 'hero_gate_error']) {
    const v = evaluateCoverQc({ qcFlags: [flag] });
    assert.strictEqual(v.pass, false, `${flag} pass=false`);
    assert.strictEqual(v.suggestedStatus, 'manual_review', `${flag} manual_review`);
    const { res, counters } = await runRoute(INPUT, { compose: async () => ({ ...COVER_OK, qcFlags: [flag] }) });
    assert.strictEqual(res.status, 422, `${flag} route 422`);
    assert.strictEqual(counters.archiveCalls, 0, `${flag} archive0`);
  }
});

// ============================================================ E14
await E('E14 MEGA_STRICT_RENDERER alone never arms (resolver + real route, exact)', async () => {
  // real resolver — alias-only report
  const alias = resolveStrictLatches({ MEGA_STRICT_RENDERER: '1' });
  assert.strictEqual(alias.armedRenderer, false, 'alias-only: armedRenderer exact false');
  assert.strictEqual(alias.armedProducer, false, 'alias-only: armedProducer exact false');
  assert.ok(alias.unknownStrictLikeKeys.includes('MEGA_STRICT_RENDERER'), 'alias-only: unknownStrictLikeKeys contains the alias');
  // real resolver — canonical four-core report
  const real = resolveStrictLatches({ MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1', MEGA_STRICT_PRODUCER: '1', MEGA_STRICT_RENDER: '1' });
  assert.strictEqual(real.armedProducer, true, 'canonical: armedProducer exact true');
  assert.strictEqual(real.armedRenderer, true, 'canonical: armedRenderer exact true');
  assert.strictEqual(STRICT_LATCH_KEYS[3], 'MEGA_STRICT_RENDER', 'canonical key literal is MEGA_STRICT_RENDER');

  // real route — alias-only stays legacy, exact
  const { res, counters } = await runRoute(INPUT, { env: { MEGA_STRICT_RENDERER: '1' } });
  assert.strictEqual(res.status, 200, `alias-only route status exact 200 (got ${res.status} ${j(res.body?.errorType)})`);
  assert.strictEqual(res.body?.success, true, 'alias-only route body.success exact true');
  assert.strictEqual(res.body?.effectiveMode, 'legacy', `alias-only route effectiveMode exact legacy (got ${j(res.body?.effectiveMode)})`);
  assert.ok(res.body?.strictLatches?.unknownStrictLikeKeys?.includes('MEGA_STRICT_RENDERER'), `response latch report surfaces the alias (got ${j(res.body?.strictLatches?.unknownStrictLikeKeys)})`);
  assert.strictEqual(counters.composeCalls, 1, 'alias-only: compose exactly once');
  assert.strictEqual(counters.archiveCalls, 1, 'alias-only: archive exactly once');
  const composeArg = counters.composePayloads[0];
  assert.strictEqual(Object.hasOwn(composeArg, 'selectionSpec'), false, 'alias-only: compose args have NO own selectionSpec');
  assert.strictEqual(Object.hasOwn(composeArg, 'realizedTemplate'), false, 'alias-only: compose args have NO own realizedTemplate');
});

// ============================================================ E15
await E('E15 strict-required cannot silently run legacy; both-or-neither + wire contract', async () => {
  // strict ARMED (env) แต่ s7 ผลิต wire แบบ legacy (ไม่มี strict pair) → route guard (frozen) ต้องยิงตรง — typed 422
  const { res, counters } = await runRoute(INPUT, { env: STRICT_ON });
  assert.strictEqual(res.status, 422, `strict-armed + legacy wire → 422 (got ${res.status} ${j(res.body?.errorType)} mode=${j(res.body?.effectiveMode)})`);
  assert.strictEqual(res.body?.errorType, 'STRICT_HOLD', 'typed STRICT_HOLD');
  assert.strictEqual(res.body?.holdReason, 'strict_wire_missing', `holdReason exact (got ${j(res.body?.holdReason)})`);
  assert.strictEqual(res.body?.effectiveMode, 'strict', 'reported as strict-mode hold');
  assert.strictEqual(counters.composeCalls, 0, 'strict_wire_missing: compose0');
  assert.strictEqual(counters.persistCalls, 0, 'strict_wire_missing: persist0');
  assert.strictEqual(counters.archiveCalls, 0, 'strict_wire_missing: archive0');
  // both-or-neither: wire มี selectionSpec แต่ไม่มี realizedTemplate → typed 422
  const badWire = JSON.stringify({ composer: 'mega', newsTitle: 'x', slotPlan: [{ url: 'https://cdn.test/HERO-OK.jpg', slot: 'main', isHero: true, refSlotId: 'hero' }], selectionSpec: { refId: 'X', v: 1 } });
  const mixed = await runRoute(INPUT, { s7: mkS7Stub({ wire: badWire }) });
  assert.strictEqual(mixed.res.status, 422, `mixed pair → 422 (got ${mixed.res.status})`);
  // wire contract จริง: strict payload จาก E3 ผ่าน validateStrictRenderActivation
  assert.ok(STRICT_RUN_1?.captures?.payload, 'needs strict run');
  const decision = validateStrictRenderActivation({ selectionSpec: STRICT_RUN_1.captures.payload.selectionSpec, realizedTemplate: STRICT_RUN_1.captures.payload.realizedTemplate });
  assert.ok(decision && (decision.ok === true || decision.active === true || decision.valid === true), `wire passes real activation contract (got ${j(decision)})`.slice(0, 300));
});

// ============================================================ E16 / E17
await E('E16 exact raw-pool count; bad director ⇒ AC-0107 crop-safe RESELECTION to HERO-OK (a safe alternative exists in-pool); good director exact upstream Hero (no OR/permissive branch)', async () => {
  // exact raw pool length actually present: 4 named rows (BLDG, PARTIAL, HERO-OK, CIRC) + 3 CTX + 16 JUNK = 23
  assert.strictEqual(POOL_FULL.length, 23, `raw synthetic pool length exact 23 (4 named + ${CTX.length} CTX + ${JUNK.length} JUNK) (got ${POOL_FULL.length})`);

  // bad director (LLM hallucinates BLDG — an unsafe non-hero of the SAME person) + readiness ON: the pool DOES contain
  // a crop-safe same-identity hero (HERO-OK), so AC-0107 P1-1 pre-carrier reselection deterministically swaps it in
  // BEFORE any HOLD ⇒ S6 done with hero exactly HERO-OK, and the hallucinated BLDG is never the hero. (No-safe-alt pools
  // still HOLD — proved by E8/E9/E19.) runS7:false ⇒ upstream-eligibility proof only.
  const bad = await runPipeline({ pool: POOL_FULL, brainAnswer: ANSWER_BAD_BLDG, env: { ...SEM_ON, MEGA_ROLE_READINESS: '1' }, runS7: false });
  assert.strictEqual(bad.s6.status, 'done', `bad director + safe alt ⇒ reselection recovers (got ${bad.s6.status} ${j(bad.s6.summary).slice(0, 120)})`);
  const badPi = bad.s6.dossierPatch.pickImages;
  const badHero = badPi.slots[badPi.heroSlotId];
  assert.strictEqual(badHero.id, 'HERO-OK', `bad director: hero reselected to the crop-safe HERO-OK (got ${badHero.id})`);
  assert.notStrictEqual(badHero.id, 'BLDG', 'bad director: hallucinated BLDG is NEVER the hero');

  // good director (authorized HERO-OK) + same pool/readiness ⇒ exact S6 done, canonical Hero exactly HERO-OK, never BLDG/PARTIAL
  // runS7:false deliberately — this block proves upstream eligibility (S6 picks the right hero), not downstream queue/compose gating (that is E3-E5/E11/E18's job)
  const good = await runPipeline({ pool: POOL_FULL, brainAnswer: ANSWER_GOOD, env: { ...SEM_ON, MEGA_ROLE_READINESS: '1' }, runS7: false });
  assert.strictEqual(good.s6.status, 'done', `good director: status exact done (got ${good.s6.status})`);
  const pi = good.s6.dossierPatch.pickImages;
  const hero = pi.slots[pi.heroSlotId];
  assert.strictEqual(hero.id, 'HERO-OK', `good director: canonical Hero exactly HERO-OK (got ${hero.id})`);
  assert.notStrictEqual(hero.id, 'BLDG', 'good director: Hero never BLDG');
  assert.notStrictEqual(hero.id, 'PARTIAL', 'good director: Hero never PARTIAL');
  assert.strictEqual(good.captures.queueCalls, 0, 'good director: queueCalls exact 0 (runS7:false — upstream-only proof)');
});
await E('E17 exact success: real selectionSpec-driven person-authority, structured-clone freeze proof, hero triple HERO-OK', async () => {
  await withEnvMap({ ...STRICT_ON, MEGA_ROLE_READINESS: '1' }, () => withFixedNow(async () => {
    const captures = mkCaptures();
    const job = mkJob();
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_FULL, brainAnswer: ANSWER_GOOD, captures }) });
    assert.strictEqual(s6.status, 'done', `S6 exact done (got ${s6.status})`);

    // structured deep clone taken IMMEDIATELY after S6, BEFORE merge/S7 — proves S7 never mutates the frozen S6 selection
    const pickImagesSnapshot = structuredClone(s6.dossierPatch.pickImages);

    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_FULL, brainAnswer: ANSWER_GOOD, captures }) });
    assert.strictEqual(s7.status, 'done', `S7 exact done (got ${s7.status})`);
    assert.strictEqual(captures.queueCalls, 1, 'queue exact 1');

    assert.deepStrictEqual(job.dossier.pickImages, pickImagesSnapshot, 'pickImages after S7 deep-equals the pre-merge/pre-S7 snapshot — no asset mutation after freeze');

    const canonicalHeroId = pickImagesSnapshot.heroSlotId;
    const hero = pickImagesSnapshot.slots[canonicalHeroId];
    assert.strictEqual(hero.id, 'HERO-OK', `S6 canonical hero exactly HERO-OK (got ${hero.id})`);

    const spec = captures.payload.selectionSpec;
    assert.ok(Array.isArray(spec?.slots) && spec.slots.length > 0, 'real selectionSpec.slots present');
    const uniq = (arr) => new Set(arr).size === arr.length;

    // ---- H2B2.1 #2: full bijection proof — S6 slot keys, spec.slots refSlotId, wire primary-row refSlotId all exact-equal sets, duplicate-free ----
    const s6RefSlotIds = Object.keys(pickImagesSnapshot.slots);
    const specRefSlotIds = spec.slots.map((s) => s.refSlotId);
    const wirePrimaryRows = captures.payload.slotPlan.filter((r) => r.refSlotId);
    const wireRefSlotIds = wirePrimaryRows.map((r) => r.refSlotId);
    assert.ok(uniq(s6RefSlotIds), 'S6 slot keys duplicate-free');
    assert.ok(uniq(specRefSlotIds), 'spec.slots refSlotId duplicate-free');
    assert.ok(uniq(wireRefSlotIds), 'wire primary-row refSlotId duplicate-free');
    assert.strictEqual(specRefSlotIds.length, s6RefSlotIds.length, `spec.slots cardinality === S6 slots cardinality (spec=${specRefSlotIds.length} s6=${s6RefSlotIds.length})`);
    assert.strictEqual(wireRefSlotIds.length, s6RefSlotIds.length, `wire primary-row cardinality === S6 slots cardinality (wire=${wireRefSlotIds.length} s6=${s6RefSlotIds.length})`);
    assert.deepStrictEqual(new Set(specRefSlotIds), new Set(s6RefSlotIds), 'spec.slots refSlotId set === S6 slots key set');
    assert.deepStrictEqual(new Set(wireRefSlotIds), new Set(s6RefSlotIds), 'wire primary-row refSlotId set === S6 slots key set');

    // composerSlotId: nonblank, unique, exactly equal the real realizedTemplate.slots id set
    const composerSlotIds = spec.slots.map((s) => s.composerSlotId);
    for (const cid of composerSlotIds) assert.ok(typeof cid === 'string' && cid.trim().length > 0, `composerSlotId nonblank (got ${j(cid)})`);
    assert.ok(uniq(composerSlotIds), 'composerSlotId duplicate-free');
    const realizedTemplateIds = (captures.payload.realizedTemplate?.slots || []).map((s) => s.id);
    assert.deepStrictEqual(new Set(composerSlotIds), new Set(realizedTemplateIds), 'spec composerSlotId set === real realizedTemplate.slots id set');

    // for EVERY spec slot: primary candidateId+imageUrl exactly match S6 pick; wire filtered by refSlotId ONLY, exactly one row, sole URL matches both
    for (const slotEntry of spec.slots) {
      const s6slot = pickImagesSnapshot.slots[slotEntry.refSlotId];
      assert.ok(s6slot, `spec slot ${slotEntry.refSlotId} exists in S6 slots`);
      assert.ok(slotEntry.primary, `spec slot ${slotEntry.refSlotId} has a primary`);
      assert.strictEqual(slotEntry.primary.candidateId, String(s6slot.id), `primary.candidateId === S6 pick id for ${slotEntry.refSlotId}`);
      assert.strictEqual(slotEntry.primary.imageUrl, s6slot.imageUrl, `primary.imageUrl === S6 pick imageUrl for ${slotEntry.refSlotId}`);
      const wireRows = captures.payload.slotPlan.filter((r) => r.refSlotId === slotEntry.refSlotId);
      assert.strictEqual(wireRows.length, 1, `exactly one wire row for refSlotId=${slotEntry.refSlotId} (got ${wireRows.length})`);
      assert.strictEqual(wireRows[0].url, slotEntry.primary.imageUrl, `sole wire row URL === spec primary.imageUrl for ${slotEntry.refSlotId}`);
      assert.strictEqual(wireRows[0].url, s6slot.imageUrl, `sole wire row URL === S6 pick imageUrl for ${slotEntry.refSlotId}`);
    }

    // ---- H2B2.1 #3: REAL identity-gate authority — mirrors megaAdapters.js _idGated(slot) = _isHeroSlot(slot) || nonblank wantPerson,
    //   joined by exact contract row id from the REAL slotContract the production brain call received (captures.brainArgs[0].slotContract),
    //   NOT a role/shape proxy. Test-only join — production/spec untouched.
    const slotContract = captures.brainArgs[0]?.slotContract;
    assert.ok(Array.isArray(slotContract) && slotContract.length > 0, 'real slotContract captured from the production brain call args');
    const identityBoundIds = slotContract
      .filter((row) => row.id === canonicalHeroId || (typeof row.wantPerson === 'string' && row.wantPerson.trim().length > 0))
      .map((row) => row.id);
    assert.ok(uniq(identityBoundIds), 'identity-bound contract ids duplicate-free');
    assert.ok(identityBoundIds.includes(canonicalHeroId), 'canonical hero slot id is identity-bound (matches _isHeroSlot)');
    const nonHeroWantPersonIds = identityBoundIds.filter((id) => id !== canonicalHeroId);
    assert.ok(nonHeroWantPersonIds.length > 0, 'at least one non-hero wantPerson-bound contract row exists');

    const identityBoundSpecSlots = spec.slots.filter((s) => identityBoundIds.includes(s.refSlotId));
    assert.strictEqual(identityBoundSpecSlots.length, identityBoundIds.length, 'identity-bound spec-slot join cardinality === identity-bound contract id count');
    assert.deepStrictEqual(new Set(identityBoundSpecSlots.map((s) => s.refSlotId)), new Set(identityBoundIds), 'identity-bound spec-slot refSlotId set === identity-bound contract id set');
    assert.ok(identityBoundSpecSlots.some((s) => s.refSlotId === canonicalHeroId), 'identity-bound join includes canonical hero');
    assert.ok(identityBoundSpecSlots.some((s) => nonHeroWantPersonIds.includes(s.refSlotId)), 'identity-bound join includes at least one non-hero wantPerson row');

    const poolById = new Map(POOL_FULL.map((r) => [String(r.id), r]));
    for (const slotEntry of identityBoundSpecSlots) {
      const candidateId = slotEntry.primary.candidateId;
      assert.ok(!['BLDG', 'PARTIAL'].includes(candidateId), `identity-bound slot ${slotEntry.refSlotId} must never be BLDG/PARTIAL (got ${candidateId})`);
      const contractRow = slotContract.find((row) => row.id === slotEntry.refSlotId);
      const wantPerson = typeof contractRow?.wantPerson === 'string' ? contractRow.wantPerson.trim() : '';
      if (wantPerson) {
        const candidateRec = poolById.get(String(candidateId));
        assert.ok(candidateRec, `candidateId ${candidateId} maps back to a real POOL_FULL row`);
        const persons = [candidateRec.triage?.person, ...(candidateRec.triage?.persons || [])].filter(Boolean);
        assert.ok(persons.includes(wantPerson), `slot ${slotEntry.refSlotId}: candidate ${candidateId} triage person/persons ${j(persons)} must include intended wantPerson ${j(wantPerson)}`);
      }
    }

    // ---- H2B2.1 #1: hero triple exactly HERO-OK — strict single-row filters, no find()/|| fallback ----
    const heroSpecRows = spec.slots.filter((s) => s.refSlotId === canonicalHeroId);
    assert.strictEqual(heroSpecRows.length, 1, `exactly one spec slot for canonical hero refSlotId (got ${heroSpecRows.length})`);
    const heroSpecSlot = heroSpecRows[0];
    const heroWireRows = captures.payload.slotPlan.filter((r) => r.refSlotId === canonicalHeroId);
    assert.strictEqual(heroWireRows.length, 1, `exactly one wire row for canonical hero refSlotId (got ${heroWireRows.length})`);
    assert.strictEqual(hero.id, 'HERO-OK', 'hero triple leg 1: S6 pick exactly HERO-OK');
    assert.strictEqual(heroSpecSlot.primary.candidateId, 'HERO-OK', 'hero triple leg 2: spec primary.candidateId exactly HERO-OK');
    assert.strictEqual(heroWireRows[0].url, 'https://cdn.test/HERO-OK.jpg', 'hero triple leg 3: wire row URL exactly HERO-OK');
  }));
});

// ============================================================ E18
await E('E18 exact local strict route twins: qc→persist→archive order, coverPath propagation, zero real fs/network', async () => {
  assert.ok(STRICT_RUN_1?.captures?.rawBodies?.[0], 'needs E3 strict run for the real strict wire');
  const realStrictWire = STRICT_RUN_1.captures.rawBodies[0]; // real strict wire from STRICT_RUN_1, not legacy WIRE_GOOD

  const fetchBombBefore = fetchBombCalls;
  const archLeakBefore = globalThis.__E_ARCH_LEAK || 0;

  // --- success twin: block-local event ledger + deps built from mkRouteDeps then overridden locally (no shared-helper edits) ---
  {
    const events = [];
    const counters = mkCounters();
    const deps = {
      ...mkRouteDeps({ counters, s7: mkS7Stub({ wire: realStrictWire }), env: STRICT_ON }),
      composeAndVerify: async (p) => { events.push('compose'); counters.composeCalls++; counters.composePayloads.push(p); return { ...COVER_OK }; },
      evaluateCoverQc: (...a) => { events.push('qc'); return evaluateCoverQc(...a); },
      persistCoverImage: async () => { events.push('persist'); counters.persistCalls++; return '/mega-covers/e18.jpg'; },
      loadArchive: async () => ({ addMegaCover: async (e) => { events.push('archive'); counters.archiveCalls++; counters.archiveEntries.push(e); return { id: 'ARC-E18-OK' }; } }),
    };
    const out = await withEnvMap(STRICT_ON, () => withFixedNow(() => runCoverRefTest(INPUT, deps)));
    assert.strictEqual(out.status, 200, `success twin status exact 200 (got ${out.status} ${j(out.body?.errorType)})`);
    assert.strictEqual(out.body?.success, true, 'success twin body.success exact true');
    assert.strictEqual(out.body?.effectiveMode, 'strict', `success twin effectiveMode exact strict (got ${j(out.body?.effectiveMode)})`);
    assert.strictEqual(counters.composeCalls, 1, 'success twin: compose exactly once');
    assert.strictEqual(counters.persistCalls, 1, 'success twin: persist exactly once');
    assert.strictEqual(counters.archiveCalls, 1, 'success twin: archive exactly once');
    assert.strictEqual(counters.archiveEntries.length, 1, 'success twin: exactly one archive entry');
    assert.deepStrictEqual(events, ['compose', 'qc', 'persist', 'archive'], `success twin event order exact (got ${j(events)})`);
    assert.strictEqual(counters.archiveEntries[0].coverPath, '/mega-covers/e18.jpg', 'success twin: archive entry carries the same coverPath persist returned');
  }

  // --- QC fail twin: same construction, compose succeeds but QC flags reject ---
  {
    const events = [];
    const counters = mkCounters();
    const deps = {
      ...mkRouteDeps({ counters, s7: mkS7Stub({ wire: realStrictWire }), env: STRICT_ON }),
      composeAndVerify: async (p) => { events.push('compose'); counters.composeCalls++; counters.composePayloads.push(p); return { ...COVER_OK, qcFlags: ['blank_image:x'] }; },
      evaluateCoverQc: (...a) => { events.push('qc'); return evaluateCoverQc(...a); },
      persistCoverImage: async () => { events.push('persist'); counters.persistCalls++; return '/mega-covers/should-not-run.jpg'; },
      loadArchive: async () => ({ addMegaCover: async (e) => { events.push('archive'); counters.archiveCalls++; counters.archiveEntries.push(e); return { id: 'ARC-E18-QCFAIL' }; } }),
    };
    const out = await withEnvMap(STRICT_ON, () => withFixedNow(() => runCoverRefTest(INPUT, deps)));
    assert.strictEqual(out.status, 422, `QC-fail twin status exact 422 (got ${out.status})`);
    assert.strictEqual(out.body?.errorType, 'QC_REJECTED', `QC-fail twin errorType exact (got ${j(out.body?.errorType)})`);
    assert.strictEqual(out.body?.holdReason, 'qc_failed', `QC-fail twin holdReason exact (got ${j(out.body?.holdReason)})`);
    assert.strictEqual(counters.composeCalls, 1, 'QC-fail twin: compose exactly once');
    assert.strictEqual(counters.persistCalls, 0, 'QC-fail twin: persist exactly 0');
    assert.strictEqual(counters.archiveCalls, 0, 'QC-fail twin: archive exactly 0');
    assert.deepStrictEqual(events, ['compose', 'qc'], `QC-fail twin event order exact (got ${j(events)})`);
  }

  assert.strictEqual(fetchBombCalls, fetchBombBefore, 'fetchBombCalls unchanged across both twins — zero real network');
  assert.strictEqual((globalThis.__E_ARCH_LEAK || 0), archLeakBefore, '__E_ARCH_LEAK unchanged across both twins — zero real fs/archive module use');
});

// ============================================================ E19 (AC-0107 hero crop-safety gap — production incident)
// Real /cover-ref-test incident: a LARGE source image passes the coarse WHOLE-IMAGE cover-fit readiness check, but the
// executor crops the hero FACE-AWARE (prominence) so the surviving region is far smaller than the whole image and the
// TRUE upscale is >1.2 (2.69× in prod: QC_REJECTED 'upscaled:main:2.69') — caught by hard QC only AFTER a full compose.
// The S6 readiness gate must now measure the FACE-AWARE hero crop and reject the unsafe hero BEFORE compose (zero archive).
//   SMALLFACE shares HERO-OK's EXACT real dims (so whole-image cover-fit is identical) and a MORE-central face (so
//   positional containment is at least as safe) and still clears the bigFace height floor — the ONLY discriminator is the
//   face SIZE, i.e. the face-aware crop. The coarse gate would accept it; the face-aware gate must reject it.
const R5_SMALLFACE = IMG('SMALLFACE', { person: HERO_NAME, category: 'face-emotional', faceBox: { x1: 0.41, y1: 0.41, x2: 0.59, y2: 0.59 }, realShortSide: 1200, note: 'ภาพใหญ่ หน้ากลางเฟรมแต่เล็ก (0.18×0.18 — เหนือ bigFace floor แต่ครอป hero ยืด >1.2×)' }, { realWidth: 1300, realHeight: 1200 });
const POOL_SMALLFACE = [R5_SMALLFACE, R4_CIRC, ...CTX, ...JUNK]; // no crop-safe hero in the pool
const ANSWER_SMALLFACE = { ...ANSWER_GOOD, hero: { id: 'SMALLFACE', reason: 'หน้ากลางเฟรม', backups: [] } };

await E('E19 AC-0107: big image + small CENTERED face clears coarse cover-fit/positional/bigFace, but the FACE-AWARE hero crop needs >1.2× ⇒ readiness ON rejects INSUFFICIENT_HERO_GRADE BEFORE compose (s7 never runs, zero archive); HERO-OK (same dims, bigger face) still passes — discriminator is the face-aware crop, not cover-fit', async () => {
  // the coarse gate could NOT have caught this: SMALLFACE shares HERO-OK's EXACT dims (whole-image cover-fit identical)
  // and a strictly-more-central face (positional containment at least as safe); only the face size differs.
  assert.strictEqual(R5_SMALLFACE.realWidth, R3_HERO.realWidth, 'SMALLFACE shares HERO-OK realWidth (cover-fit identical)');
  assert.strictEqual(R5_SMALLFACE.realHeight, R3_HERO.realHeight, 'SMALLFACE shares HERO-OK realHeight (cover-fit identical)');
  const fh = R5_SMALLFACE.triage.faceBox.y2 - R5_SMALLFACE.triage.faceBox.y1;
  assert.ok(fh > 0.16, 'SMALLFACE face height comfortably clears the bigFace floor (>0.16) — NOT caught by the prominence pre-check, so the rejection is genuinely the face-aware crop');
  assert.ok(fh < (R3_HERO.triage.faceBox.y2 - R3_HERO.triage.faceBox.y1), 'SMALLFACE face is SMALLER than HERO-OK (the only discriminator)');

  const { s6, s7, captures } = await runPipeline({ pool: POOL_SMALLFACE, brainAnswer: ANSWER_SMALLFACE, env: { ...SEM_ON, MEGA_ROLE_READINESS: '1' } });
  assert.strictEqual(s6.status, 'failed', `S6 fail-closed (got ${j(s6.status)})`);
  assert.strictEqual(s6.reason, 'INSUFFICIENT_HERO_GRADE', `reason exact (got ${j(s6.reason)} summary=${j(s6.summary).slice(0, 160)})`);
  assert.strictEqual(s7, null, 's7 never runs — unsafe hero rejected BEFORE compose (no wasted full-route compose)');
  assert.strictEqual(captures.queueCalls, 0, 'zero queue/compose attempted (zero archive)');

  // CONTROL: HERO-OK (same dims, BIGGER face) passes readiness ON ⇒ proves cover-fit is NOT the discriminator (the
  // face-aware crop is). Without the AC-0107 fix, SMALLFACE would have passed exactly like HERO-OK and only failed at QC.
  const good = await runPipeline({ pool: POOL_FULL, brainAnswer: ANSWER_GOOD, env: { ...SEM_ON, MEGA_ROLE_READINESS: '1' }, runS7: false });
  assert.strictEqual(good.s6.status, 'done', `HERO-OK (bigger face, same dims) passes readiness (got ${j(good.s6.status)} ${j(good.s6.summary).slice(0, 120)})`);
  assert.strictEqual(good.s6.dossierPatch.pickImages.slots.hero.id, 'HERO-OK', 'canonical hero = HERO-OK (safe)');
});

// ============================================================ E20 (AC-0107 full-route incident — the EXACT flag)
await E('E20 AC-0107 full-route: a compose output carrying the EXACT incident flag upscaled:main:2.69 ⇒ /cover-ref-test HARD QC ⇒ 422 QC_REJECTED + zero persist + zero archive (real runCoverRefTest + real evaluateCoverQc, not merely the verdict in isolation)', async () => {
  const INCIDENT = 'upscaled:main:2.69';
  // the shared hard gate rejects the exact incident flag
  const v = evaluateCoverQc({ qcFlags: [INCIDENT] });
  assert.strictEqual(v.pass, false, 'shared QC gate rejects the 2.69× hero stretch');
  assert.strictEqual(v.suggestedStatus, 'needs_gap_search', 'upscale fail ⇒ needs_gap_search (intended bounded recovery)');
  // full route: real runCoverRefTest + real evaluateCoverQc (hard 422 gate), compose double renders the incident output
  const { res, counters } = await runRoute(INPUT, { compose: async () => ({ ...COVER_OK, qcFlags: [INCIDENT] }) });
  assert.strictEqual(res.status, 422, `route 422 (got ${res.status})`);
  assert.strictEqual(res.body.errorType, 'QC_REJECTED', `errorType QC_REJECTED (got ${j(res.body.errorType)})`);
  assert.strictEqual(res.body.qcVerdict.pass, false, 'attached qcVerdict.pass=false');
  assert.ok(Array.isArray(res.body.qcVerdict.reasons) && res.body.qcVerdict.reasons.length > 0, 'QC reasons surfaced');
  assert.strictEqual(counters.persistCalls, 0, 'zero persist (no cover file written)');
  assert.strictEqual(counters.archiveCalls, 0, 'zero archive (Production zero-archive on QC fail)');
});

// ============================================================ E21 (AC-0107 P1-1 pre-carrier SAFE-HERO RESELECTION)
const R6_HERO2 = IMG('HERO-OK2', { person: HERO_NAME, category: 'face-emotional', faceBox: { x1: 0.34, y1: 0.19, x2: 0.66, y2: 0.56 }, realShortSide: 1250, note: 'ตัวเอกหน้าชัดอีกใบ (crop-safe)' }, { realWidth: 1350, realHeight: 1250 });
await E('E21 AC-0107 P1-1: (a) director picks a crop-UNSAFE hero (SMALLFACE) but a crop-SAFE same-identity alternative (HERO-OK) exists ⇒ pre-carrier reselection swaps it in (S6 done, hero=HERO-OK, never SMALLFACE, S7 enqueues ⇒ compose can proceed); (c) with TWO safe alternatives the pick is DETERMINISTIC across identical runs (tie/order stability)', async () => {
  const ansUnsafe = { ...ANSWER_GOOD, hero: { id: 'SMALLFACE', reason: 'director picked crop-unsafe', backups: [] } };
  // (a) safe alternative exists ⇒ reselected + compose proceeds
  const poolA = [R5_SMALLFACE, R3_HERO, R4_CIRC, ...CTX, ...JUNK];
  const a = await runPipeline({ pool: poolA, brainAnswer: ansUnsafe, env: { ...SEM_ON, MEGA_ROLE_READINESS: '1' } });
  assert.strictEqual(a.s6.status, 'done', `(a) reselection recovers ⇒ S6 done (got ${a.s6.status} ${j(a.s6.summary).slice(0, 120)})`);
  const aHero = a.s6.dossierPatch.pickImages.slots[a.s6.dossierPatch.pickImages.heroSlotId];
  assert.strictEqual(aHero.id, 'HERO-OK', `(a) hero reselected to the crop-safe same-person HERO-OK (got ${aHero.id})`);
  assert.notStrictEqual(aHero.id, 'SMALLFACE', '(a) the crop-unsafe SMALLFACE is NEVER the hero');
  assert.strictEqual(a.captures.queueCalls, 1, '(a) compose can proceed — S7 enqueued exactly once with the safe hero');
  assert.ok(a.s7 && a.s7.status !== 'failed', `(a) S7 did not fail on the reselected safe hero (got ${j(a.s7?.status)})`);

  // (c) two crop-safe same-identity alternatives ⇒ deterministic pick across identical runs
  const poolC = [R5_SMALLFACE, R3_HERO, R6_HERO2, R4_CIRC, ...CTX, ...JUNK];
  const c1 = await runPipeline({ pool: poolC, brainAnswer: ansUnsafe, env: { ...SEM_ON, MEGA_ROLE_READINESS: '1' }, runS7: false });
  const c2 = await runPipeline({ pool: poolC, brainAnswer: ansUnsafe, env: { ...SEM_ON, MEGA_ROLE_READINESS: '1' }, runS7: false });
  assert.strictEqual(c1.s6.status, 'done'); assert.strictEqual(c2.s6.status, 'done');
  const h1 = c1.s6.dossierPatch.pickImages.slots[c1.s6.dossierPatch.pickImages.heroSlotId].id;
  const h2 = c2.s6.dossierPatch.pickImages.slots[c2.s6.dossierPatch.pickImages.heroSlotId].id;
  assert.ok(['HERO-OK', 'HERO-OK2'].includes(h1), `(c) pick is one of the two crop-safe heroes (got ${h1})`);
  assert.strictEqual(h1, h2, `(c) DETERMINISTIC — identical runs pick the same safe hero (${h1} === ${h2})`);
});

// ============================================================ E12 (สุดท้าย — สะสมทั้งไฟล์)
await E('E12 global.fetch bomb remains uncalled (no network/self-HTTP anywhere)', async () => {
  assert.strictEqual(fetchBombCalls, 0, `fetch bomb calls = ${fetchBombCalls}`);
});

} finally {
  restoreExactOriginals();
}

// ---------- summary ----------
console.log('\n===== AC-0099 Wave E results =====');
for (const [name, verdict, msg] of results) console.log(`${verdict.padEnd(4)} | ${name}${msg ? ' :: ' + msg : ''}`);
const fails = results.filter(([, v]) => v === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed`);
console.log('restoration: env/fetch/Date.now/__E_ARCH_LEAK restored in outer finally = OK');
if (fails.length) { process.exitCode = 1; }
