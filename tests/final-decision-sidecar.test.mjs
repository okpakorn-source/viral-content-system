// ============================================================
// 🧾 D-sidecar wiring — Final-Decision Evidence v2 in s6_slots (integration)
//   Offline self-contained harness (loader stubs + injected _deps fakes) —
//   ไม่ยิง LLM/network/store จริง · พิสูจน์: kill-switch exact-'1' + TOCTOU latch ·
//   OFF inert เต็มตัว (import counter 0 / seam getter 0 / golden parity) ·
//   ON = trace truthful (llm/policy_override/fallback/story_rescue) จาก mutation site จริง ·
//   universe = ลิสต์ที่สมองเห็นก่อน arbitration เท่านั้น · fail-closed omission ทุกรู
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';

// ---------- loader hook: '@/' mapping + stub modules + D-module import counter ----------
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const AI_STUB = _mod('export function callBrain(a){ throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
const STUB_IMAGESEARCH = _mod(`
export const PLATFORMS = ['google','google_news','facebook','tiktok','youtube'];
export function buildQueries(){ return ['q1']; }
export async function searchImages(){ return []; }
export async function instagramProfile(){ return { images: [] }; }
export async function facebookProfile(){ return { images: [] }; }
`);
const STUB_TRIAGE = _mod('export async function vetImages(){ return { vetted: [], kept: 0, dropped: 0, failed: 0 }; }');
const STUB_STORE = _mod('export async function addImages(){ return { added: 0, total: 0, byPlatform: {}, images: [] }; }\nexport async function readImages(){ return []; }');
const STUB_CASE = _mod('export async function getCase(){ return {}; }');
const STUB_JUNK = _mod('export function isCatalogSource(){ return false; }\nexport function isOwnPageSource(){ return false; }\nexport function isMismatchedFbMedia(){ return false; }');
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, status: (init && init.status) || 200, json: async () => obj }) };');

const { port1, port2 } = new MessageChannel();
const dModuleImports = []; // specifier ของโมดูล D ทุกครั้งที่ตัว resolver เห็น (นับ dynamic import จริง)
port1.on('message', (m) => dModuleImports.push(String(m)));
port1.unref();

const hook = `
let _port = null;
export function initialize(data) { _port = data && data.port; }
export async function resolve(specifier, context, nextResolve) {
  const s = String(specifier);
  if (_port && /postSelectionDecisionProducer|decisionEvidence/.test(s)) _port.postMessage(s);
  if (s === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (s === '@/lib/imageSearch') return { url: ${JSON.stringify(STUB_IMAGESEARCH)}, shortCircuit: true };
  if (s === '@/lib/libraryTriage') return { url: ${JSON.stringify(STUB_TRIAGE)}, shortCircuit: true };
  if (s === '@/lib/imageStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (s === '@/lib/caseStore') return { url: ${JSON.stringify(STUB_CASE)}, shortCircuit: true };
  if (s === '@/lib/junkSources') return { url: ${JSON.stringify(STUB_JUNK)}, shortCircuit: true };
  if (s === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (s.startsWith('@/')) {
    const mapped = new URL(s.slice(2) + (s.endsWith('.js') || s.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook), { parentURL: import.meta.url, data: { port: port2 }, transferList: [port2] });

// pin call-time/ambient switches ก่อน import (deterministic — sidecar flag คุมรายเทสด้านล่าง)
process.env.MEGA_SOLVER_SHADOW = '0';
// ★ รอบ 2 (hostile-toJSON fixtures): mirror ฝั่ง solver-diag เป็น legacy Wave3 ที่ stringify meta ทุก job (ก่อน D เกิด และ
//   ไม่ใช่ขอบเขต D) — ปิดใน harness ไม่ให้ fixture hostile ถูก serialize โดยสายที่ไม่ใช่ D · ตัวแปรฝั่งนั้น
//   (solverDiagLlmVisibleIds/rawLlmSlotIds) ถูกบริโภคเฉพาะใต้ MEGA_SOLVER_SHADOW ซึ่ง pin '0' อยู่แล้ว = ไม่มีผลสังเกตได้อื่น
process.env.MEGA_SOLVER_DIAGNOSTICS_V2 = '0';
delete process.env.MEGA_SEMANTIC_SELECTION;
delete process.env.MEGA_SELECTION_SPEC;
delete process.env.MEGA_REF_SHOT_AUTHORITY;
delete process.env.MEGA_CANDIDATE_LEDGER;
delete process.env.MEGA_FINAL_DECISION_EVIDENCE_V2;

const ADAPTERS_PATH = new URL('../src/lib/megaAdapters.js', import.meta.url);
const { s6_slots, _finalDecisionEvidenceFlag } = await import(ADAPTERS_PATH.href);
await delay(80); // flush ข้อความ resolver (hooks thread → main)
const importCountAtLoad = dModuleImports.length; // ต้องเป็น 0 — ไม่มี static import โมดูล D จากสาย adapters

// ---------- fixtures ----------
const FLAG = 'MEGA_FINAL_DECISION_EVIDENCE_V2';
const IMG = (id, q, t = {}, top = {}) => ({
  id,
  imageUrl: `https://cdn.test/${id}.jpg`,
  width: 800, height: 1000,
  realWidth: 900, realHeight: 1200,
  ...top,
  triage: { relevant: true, clean: true, faceCount: 1, person: null, persons: [], category: 'other', emotion: 'warm', note: '', newsScene: true, quality: q, ...t },
});
// พูลหลัก: 8 ใบดิบ → 1 ใบ relevant=false ถูกกันก่อนถึงสมอง → จักรวาลที่สมองเห็น = 7 ใบ (พิสูจน์ prompt-boundary)
const POOL = () => [
  IMG('img-solo', 10, { person: 'สมชาย ใจดี', faceCount: 1, category: 'face-neutral' }),
  IMG('img-multi', 9, { person: 'สมชาย ใจดี', faceCount: 3, category: 'group' }),
  IMG('img-react', 8, { person: 'สมหญิง รักดี', faceCount: 1, category: 'face-emotional' }),
  IMG('img-ctx-low', 7, { person: 'สมชาย ใจดี', faceCount: 1, category: 'other' }),
  IMG('img-ctx-story', 6, { person: 'สมหญิง รักดี', faceCount: 2, category: 'family' }, { query: 'ครอบครัวสมชาย' }),
  IMG('img-action', 5, { person: null, faceCount: 0, category: 'context' }),
  IMG('img-circle', 4, { person: 'สมหญิง รักดี', faceCount: 1, category: 'face-emotional' }),
  IMG('img-junk', 3, { relevant: false }),
];
// สมองเลือก: hero=ภาพหลายหน้า (โดน solo-swap = policy_override) · reaction/circle รอด (llm) ·
// action ไม่ตอบ (fallback) · context ได้ภาพ story ต่ำ (โดน story_rescue ทีหลัง)
const ANSWER = () => ({
  hero: { id: 'img-multi', reason: 'สมองเลือก' },
  reaction: { id: 'img-react', reason: 'สมองเลือก' },
  context: { id: 'img-ctx-low', reason: 'สมองเลือก' },
  circle: { id: 'img-circle', reason: 'สมองเลือก' },
});
const mkJob = () => ({
  id: 'job-d-sidecar',
  dossier: {
    images: { caseId: 'D-CASE', storyQueries: ['ครอบครัวสมชาย'] },
    compass: {
      angle: 'มุมทดสอบ',
      primaryEmotion: 'warm',
      secondaryEmotions: [],
      mainCharacters: [{ name: 'สมชาย ใจดี', role: 'hero' }, { name: 'สมหญิง รักดี', role: 'supporter' }],
      visualDreamShots: [],
    },
    desk: { title: 'ข่าวทดสอบ D sidecar' },
    refMatch: { styleName: 'ref-x', reason: 'loose', typeMatched: false }, // ปิดสาย ref/artBrief (legacy 5 ช่องเต็ม)
  },
});
const mkDeps = ({ pool, answer, onFetch, onBrain, captures } = {}) => ({
  slotDirectorBrain: async (args) => {
    if (captures) captures.brains.push(args);
    if (onBrain) onBrain(args);
    return { slots: answer ?? {}, note: 'mock-note' };
  },
  artBriefBrain: async () => { throw new Error('artBriefBrain must not be called'); },
  fetchJson: async (url) => {
    if (onFetch) onFetch();
    if (String(url).includes('/api/images/')) return { success: true, images: pool };
    throw new Error('unexpected fetch: ' + url);
  },
});
// seam getter counter — พิสูจน์ "diagnostic getter reads = 0 เมื่อ OFF" (ทางเดียวที่ D แตะของนอก)
const withSeamCounter = (deps, counter, value) => {
  Object.defineProperty(deps, 'produceFinalDecisionEvidence', {
    get() { counter.reads++; return value; },
    enumerable: true, configurable: true,
  });
  return deps;
};
const setFlag = (v) => { if (v === null) delete process.env[FLAG]; else process.env[FLAG] = v; };
const runS6 = async ({ flag = null, pool, answer, deps, job } = {}) => {
  const prev = Object.prototype.hasOwnProperty.call(process.env, FLAG) ? process.env[FLAG] : null;
  setFlag(flag);
  try {
    return await s6_slots(job ?? mkJob(), { origin: 'http://mock', _deps: deps ?? mkDeps({ pool: pool ?? POOL(), answer: answer ?? ANSWER() }) });
  } finally { setFlag(prev); }
};
const stripSidecar = (r) => { const c = { ...r }; delete c.decisionEvidence; return c; };
const EXPECTED_ROWS = [
  { slotIndex: 0, slot: 'hero', reason: 'policy_override', candidateCount: 7, candidateIndex: 0 },
  { slotIndex: 1, slot: 'support', reason: 'llm_pick', candidateCount: 7, candidateIndex: 2 },
  { slotIndex: 2, slot: 'support', reason: 'fallback', candidateCount: 7, candidateIndex: 1 },
  { slotIndex: 3, slot: 'support', reason: 'story_rescue', candidateCount: 7, candidateIndex: 4 },
  { slotIndex: 4, slot: 'circle', reason: 'llm_pick', candidateCount: 7, candidateIndex: 6 },
];

let goldenOff = null; // ผลธุรกิจ legacy (flag unset) — ฐานเทียบ byte-parity ทุกเคส

// ── 1) predicate matrix (รวม number 1 — ค่าที่ process.env เก็บไม่ได้จริง) ──
test('switch predicate: exact string "1" only — unset/"0"/"true"/"1 "/" 1"/number 1/boolean all OFF', () => {
  for (const v of [undefined, null, '', '0', 'true', '1 ', ' 1', '01', 1, true]) {
    assert.equal(_finalDecisionEvidenceFlag(v), false, `flag(${JSON.stringify(v)}) must be OFF`);
  }
  assert.equal(_finalDecisionEvidenceFlag('1'), true);
});

// ── 2) behavioral matrix + OFF golden parity + OFF counters ZERO ──
test('OFF matrix: unset/"0"/"true"/"1 " inert — golden deep-equality + import counter 0 + seam getter 0', async () => {
  const seam = { reads: 0 };
  goldenOff = await runS6({ flag: null, deps: withSeamCounter(mkDeps({ pool: POOL(), answer: ANSWER() }), seam, undefined) });
  assert.equal(goldenOff.status, 'done');
  assert.ok(!('decisionEvidence' in goldenOff), 'OFF must not add the key');
  assert.equal(goldenOff.dossierPatch.pickImages.slots.hero.id, 'img-solo');
  for (const v of ['0', 'true', '1 ', ' 1', '']) {
    const r = await runS6({ flag: v, deps: withSeamCounter(mkDeps({ pool: POOL(), answer: ANSWER() }), seam, undefined) });
    assert.ok(!('decisionEvidence' in r), `flag=${JSON.stringify(v)} must be inert`);
    assert.deepStrictEqual(r, goldenOff, `flag=${JSON.stringify(v)} business result must equal legacy golden`);
  }
  assert.equal(seam.reads, 0, 'OFF: seam getter must never be read');
  await delay(80);
  assert.equal(dModuleImports.length - importCountAtLoad, 0, 'OFF: zero dynamic imports of D modules');
  assert.equal(importCountAtLoad, 0, 'loading megaAdapters must not import D modules statically');
});

// ── 3) TOCTOU: latch ก่อน await แรก (flip ระหว่าง await แรกทั้งสองทิศ) ──
test('TOCTOU: flag latched before first await — mid-await flips follow the entry snapshot', async () => {
  // OFF ตอนเข้า → flip ON กลาง fetch แรก = ยังต้อง OFF ทั้งงาน (ผลเท่า golden ทุก byte)
  const flippedOn = await runS6({
    flag: null,
    deps: mkDeps({ pool: POOL(), answer: ANSWER(), onFetch: () => { process.env[FLAG] = '1'; } }),
  });
  delete process.env[FLAG];
  assert.ok(!('decisionEvidence' in flippedOn), 'entry OFF snapshot must win');
  assert.deepStrictEqual(flippedOn, goldenOff);
  // ON ตอนเข้า → flip OFF กลาง fetch แรก = ยังต้อง ON (sidecar ครบ)
  const flippedOff = await runS6({
    flag: '1',
    deps: mkDeps({ pool: POOL(), answer: ANSWER(), onFetch: () => { delete process.env[FLAG]; } }),
  });
  assert.ok('decisionEvidence' in flippedOff, 'entry ON snapshot must win');
  assert.deepStrictEqual([...flippedOff.decisionEvidence.rows.map((r) => ({ ...r }))], EXPECTED_ROWS);
});

// ── 4) ON mixed scenario: 4 stages truthful + dense slotIndex + universe = prompt list + parity ──
test('ON: llm + policy_override + fallback + story_rescue recorded truthfully from real mutation sites', async () => {
  const captures = { brains: [] };
  const on = await runS6({ flag: '1', deps: mkDeps({ pool: POOL(), answer: ANSWER(), captures }) });
  assert.equal(on.status, 'done');
  // ตัวจริงต่อช่อง (พฤติกรรมธุรกิจเดิม) — ยืนยันว่า stage ที่อ้างตรงกับกลไกที่เกิดจริง
  const s = on.dossierPatch.pickImages.slots;
  assert.equal(s.hero.id, 'img-solo', 'hero = solo-swap (policy_override site)');
  assert.equal(s.reaction.id, 'img-react', 'reaction = surviving brain pick (llm)');
  assert.equal(s.action.id, 'img-multi', 'action = heuristic fallback');
  assert.equal(s.context.id, 'img-ctx-story', 'context = story rescue swap');
  assert.equal(s.circle.id, 'img-circle', 'circle = surviving brain pick (llm)');
  // sidecar ครบและตรงเป๊ะ
  const ev = on.decisionEvidence;
  assert.equal(ev.version, 2);
  assert.equal(ev.scoringSchema, 1);
  assert.equal(ev.totalRows, 5);
  assert.equal(ev.emittedRows, 5);
  assert.equal(ev.droppedRows, 0);
  assert.equal(ev.capped, false);
  assert.equal(ev.truncated, false);
  assert.deepStrictEqual(ev.rows.map((r) => ({ ...r })), EXPECTED_ROWS, 'dense slotIndex + roles + stages + frozen-universe indices');
  // prompt-boundary: candidateCount = ลิสต์ที่สมองเห็นจริง (7) — ไม่ใช่พูลดิบ (8) / ช่องที่เต็ม (5)
  assert.equal(captures.brains.length, 1);
  assert.equal(captures.brains[0].imagesMeta.length, 7, 'brain saw exactly 7 candidates');
  assert.ok(ev.rows.every((r) => r.candidateCount === 7));
  assert.notEqual(ev.rows[0].candidateCount, 8, 'never the raw pool size');
  assert.notEqual(ev.rows[0].candidateCount, 5, 'never the post-gate/filled pool size');
  // parity: ตัด sidecar แล้วผลธุรกิจต้องเท่า legacy golden ทุก byte
  assert.deepStrictEqual(stripSidecar(on), goldenOff);
  // dynamic import ของ producer เกิดจริง (ครั้งแรก) เฉพาะสาย ON
  await delay(80);
  assert.ok(dModuleImports.length - importCountAtLoad >= 1, 'ON path dynamically imported the producer');
  assert.ok(dModuleImports.every((m) => /postSelectionDecisionProducer|decisionEvidence/.test(m)));
});

// ── 5) sidecar privacy: ไม่มี id ดิบ / ชื่อคน / URL / trace ดิบ ใน serialized sidecar ──
test('privacy: serialized decisionEvidence carries only allowlisted tokens + numbers', async () => {
  const on = await runS6({ flag: '1' });
  const ser = JSON.stringify(on.decisionEvidence);
  for (const leak of ['img-', 'สมชาย', 'สมหญิง', 'http', 'cdn.test', 'stage', 'chosenIndex', 'imageUrl', 'query']) {
    assert.ok(!ser.includes(leak), `sidecar must not contain ${JSON.stringify(leak)}`);
  }
  const TOKENS = new Set(['hero', 'circle', 'support', 'llm_pick', 'policy_override', 'story_rescue', 'fallback', 'best_score', 'only_candidate', 'tie_break']);
  for (const row of on.decisionEvidence.rows) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string') assert.ok(TOKENS.has(v), `row.${k}=${v} must be an allowlisted token`);
      else assert.ok(typeof v === 'number', `row.${k} must be token or number`);
    }
  }
});

// ── 6) duplicate id ในจักรวาล = กำกวม → omit ทั้ง sidecar (ธุรกิจเดินปกติ + parity) ──
test('duplicate candidate ids in the prompt universe => sidecar omitted, business unchanged', async () => {
  const dupPool = () => [...POOL(), IMG('img-react', 3.5, { person: 'สมหญิง รักดี' })]; // id ซ้ำท้ายคิว
  const on = await runS6({ flag: '1', pool: dupPool() });
  assert.equal(on.status, 'done');
  assert.ok(!('decisionEvidence' in on), 'ambiguous universe must omit the sidecar');
  const off = await runS6({ flag: null, pool: dupPool() });
  assert.deepStrictEqual(on, off, 'business result must be byte-equal to legacy for the same input');
});

// ── 7) ตัวจริงอยู่นอกจักรวาลที่สมองเห็น (id เปลี่ยนหลังจับจักรวาล) → omit ──
test('final chosen id outside the frozen prompt universe => sidecar omitted', async () => {
  const pool = POOL();
  const hijack = () => { pool[0].id = 'img-hijack'; }; // สมอง (หลังจับจักรวาล) สลับ id ของ candidate อันดับหนึ่ง
  const answer = { ...ANSWER(), hero: { id: 'img-hijack', reason: 'x' } };
  const on = await runS6({ flag: '1', deps: mkDeps({ pool, answer, onBrain: hijack }) });
  assert.equal(on.status, 'done');
  assert.equal(on.dossierPatch.pickImages.slots.hero.id, 'img-hijack', 'business accepted the post-universe id');
  assert.ok(!('decisionEvidence' in on), 'id not in the frozen universe must omit the whole sidecar');
});

// ── 8) producer throw / malformed result → omit + ธุรกิจเท่า golden (ผ่าน seam — ไม่ import เพิ่ม) ──
test('producer throw / malformed results => sidecar omitted, business unchanged', async () => {
  const cases = [
    () => { throw new Error('producer exploded'); },
    () => null,
    () => undefined,
    () => ({ decisionComplete: false, evidence: null }),
    () => ({ decisionComplete: true, evidence: null }),
    () => ({ decisionComplete: 'true', evidence: { version: 2 } }),
    () => 'not-an-object',
  ];
  for (const [i, produce] of cases.entries()) {
    const seam = { reads: 0 };
    const deps = withSeamCounter(mkDeps({ pool: POOL(), answer: ANSWER() }), seam, produce);
    const r = await runS6({ flag: '1', deps });
    assert.ok(!('decisionEvidence' in r), `case ${i}: malformed/throwing producer must omit`);
    assert.deepStrictEqual(r, goldenOff, `case ${i}: business result unchanged`);
    assert.ok(seam.reads >= 1, `case ${i}: seam must actually be consulted when ON`);
  }
});

// ── 9) hero-failure shape: spread มีอยู่แต่ omit (trace ไม่ครบ) + parity ON vs OFF ──
test('hero-failure return: sidecar omitted (incomplete trace) and ON === OFF byte-for-byte', async () => {
  const strangers = () => [
    IMG('st-1', 9, { person: 'คนแปลกหน้า หนึ่ง', faceCount: 1 }),
    IMG('st-2', 8, { person: 'คนแปลกหน้า สอง', faceCount: 1 }),
    IMG('st-3', 7, { person: 'คนแปลกหน้า สาม', faceCount: 1, category: 'context' }),
  ];
  const on = await runS6({ flag: '1', pool: strangers(), answer: {} });
  const off = await runS6({ flag: null, pool: strangers(), answer: {} });
  assert.equal(on.status, 'failed');
  assert.equal(off.status, 'failed');
  assert.ok(!('decisionEvidence' in on), 'hero missing => trace incomplete => omit');
  assert.deepStrictEqual(on, off, 'hero-failure shape parity after (empty) strip');
});

// ── 10) normal-shape parity ซ้ำแบบ explicit strip (คู่กับข้อ 9 = ครบทั้งสอง shape) ──
test('normal return parity: ON minus decisionEvidence deep-equals legacy OFF', async () => {
  const on = await runS6({ flag: '1' });
  assert.ok('decisionEvidence' in on);
  assert.deepStrictEqual(stripSidecar(on), goldenOff);
  assert.ok(!('decisionEvidence' in stripSidecar(on)));
});

// ═══ Codex D P1 — CANDIDATE-UNIVERSE HONESTY (prompt-budget mirror proof) ═══
// สมองจริง (slotDirectorBrain) ตัด prompt ที่ IMG_META_BUDGET=18000 (JSON.stringify ต่อใบ + len+2) —
// D ห้ามอ้าง candidateCount = meta ทั้งก้อนถ้าสมองจริงเห็นไม่ครบ · proof มาจาก mirror ใน adapter เท่านั้น
// (ไม่ใช่จากสิ่งที่ brain fn ฉีดเทสรายงาน — brain fn ได้ meta เต็มก้อนเสมอ)

// พูล 240 แถวยาว (uniform): cap 80 เข้า meta → มิเรอร์งบ 18000 เห็นจริงแค่ 53/80 (probe 240 แถวของ Codex D)
// person เติม 'x' 150 ตัว → meta line = 336 chars (+2 = 338) → floor(18000/338) = 53 ใบพอดี
const BIG_PERSON = 'สมชาย ใจดี ' + 'x'.repeat(150);
const bigPool = () => Array.from({ length: 240 }, (_, i) =>
  IMG(`cand-${String(i).padStart(3, '0')}`, 5, { person: BIG_PERSON, faceCount: 1, category: 'face-neutral' }));
const BIG_ANSWER = () => ({
  hero: { id: 'cand-079', reason: 'x' },      // อยู่ใน meta (80 ใบหลัง cap) แต่ "เกินสายตา" สมอง production (เห็นแค่ 53)
  reaction: { id: 'cand-001', reason: 'x' },
  action: { id: 'cand-002', reason: 'x' },
  context: { id: 'cand-003', reason: 'x' },
  circle: { id: 'cand-004', reason: 'x' },
});
// สูตรงบ production เดียวกับ megaBrains.js (IMG_META_BUDGET=18000) — ใช้วัด "สายตาจริง" จาก meta ที่ capture ได้
const budgetVisible = (imagesMeta) => {
  let vis = 0, len = 0;
  for (const m of imagesMeta) { const ln = JSON.stringify(m); if (len + ln.length + 2 > 18000) break; len += ln.length + 2; vis++; }
  return vis;
};
// ภาพ padding ปรับความยาวได้ (quality ต่ำสุด → ท้ายคิว sorted → เป็นใบสุดท้ายของ meta เสมอ)
const PAD_IMG = (extra) => IMG('img-pad', 0.5, { person: 'พยาน เสริม' + 'x'.repeat(extra), faceCount: 0, category: 'other', emotion: 'calm' });
const padPool = (extra) => [...POOL(), PAD_IMG(extra)];
// คาลิเบรตจากของจริง: รัน 1 รอบ วัด Σ(line+2) ของ meta ที่ capture → slack ถึงเพดาน 18000 พอดี
const padSlack = async () => {
  const cap = { brains: [] };
  await runS6({ flag: '1', deps: mkDeps({ pool: padPool(0), answer: ANSWER(), captures: cap }) });
  const total = cap.brains[0].imagesMeta.reduce((t, m) => t + JSON.stringify(m).length + 2, 0);
  assert.ok(total > 0 && total < 18000, 'base fixture must start under the budget');
  return 18000 - total;
};

// ── 13) truncation จริง (probe 240 แถว · เห็น 53/80) ⇒ omit ทั้ง sidecar — ห้ามใช้ prefix/ห้ามเดา ──
test('candidate-universe honesty: 240 long rows, brain-visible 53 => decisionEvidence absent + parity', async () => {
  const captures = { brains: [] };
  const seam = { reads: 0 };
  const on = await runS6({ flag: '1', deps: withSeamCounter(mkDeps({ pool: bigPool(), answer: BIG_ANSWER(), captures }), seam, undefined) });
  assert.equal(on.status, 'done');
  // brain fn (ฉีดเทส) ได้ meta เต็มก้อน 80 ใบ — ธุรกิจรับ pick นอกสายตา production ได้ตามเดิม
  assert.equal(captures.brains.length, 1);
  const fullMeta = captures.brains[0].imagesMeta;
  assert.equal(fullMeta.length, 80, 'injected brain receives the FULL (capped-80) meta');
  assert.equal(budgetVisible(fullMeta), 53, 'production mirror proves the real brain saw exactly 53/80');
  assert.equal(String(on.dossierPatch.pickImages.slots.hero.id), 'cand-079', 'business accepted a beyond-visible pick (unchanged)');
  // จักรวาลไม่ครบสายตา → omit ทั้งก้อน + ห้ามแตะ producer seam เลย
  assert.ok(!('decisionEvidence' in on), 'truncated prompt => the WHOLE sidecar must be omitted');
  assert.equal(seam.reads, 0, 'invalid universe => producer seam never consulted');
  const off = await runS6({ flag: null, pool: bigPool(), answer: BIG_ANSWER() });
  assert.deepStrictEqual(on, off, 'business byte-parity with legacy OFF on the same input');
});

// ── 14) ชนเพดาน 18000 พอดี (ทุกใบยังมองเห็น) ⇒ sidecar อยู่ครบ candidateCount/candidateIndex ตรงจักรวาลจริง ──
test('exact 18000-byte boundary, everything visible => sidecar present with truthful count/index', async () => {
  const slack = await padSlack();
  const captures = { brains: [] };
  const on = await runS6({ flag: '1', deps: mkDeps({ pool: padPool(slack), answer: ANSWER(), captures }) });
  assert.equal(on.status, 'done');
  const metaB = captures.brains[0].imagesMeta;
  assert.equal(metaB.reduce((t, m) => t + JSON.stringify(m).length + 2, 0), 18000, 'fixture sits exactly on the boundary');
  assert.equal(budgetVisible(metaB), metaB.length, 'boundary (== budget) still fully visible');
  assert.ok('decisionEvidence' in on, 'fully-visible universe => sidecar present');
  const ids = metaB.map((m) => String(m.id));
  assert.equal(new Set(ids).size, 8, 'universe = 7 + pad, unique');
  const ev = on.decisionEvidence;
  assert.equal(ev.totalRows, 5);
  assert.equal(ev.emittedRows, 5);
  const slotNames = ['hero', 'reaction', 'action', 'context', 'circle'];
  ev.rows.forEach((r, i) => {
    assert.equal(r.slotIndex, i);
    assert.equal(r.candidateCount, 8, 'candidateCount = the full brain-visible universe (never a truncated prefix)');
    const finalId = String(on.dossierPatch.pickImages.slots[slotNames[i]].id);
    assert.equal(r.candidateIndex, ids.indexOf(finalId), `row ${i}: candidateIndex maps to the true universe position`);
  });
  const off = await runS6({ flag: null, pool: padPool(slack), answer: ANSWER() });
  assert.deepStrictEqual(stripSidecar(on), off, 'ON minus sidecar == OFF on the same padded pool');
});

// ── 15) เกินเพดาน 1 byte / 1 แถว ⇒ omit (ธุรกิจเดินปกติ + parity) ──
test('one byte / one row over the boundary => sidecar absent, business unchanged', async () => {
  const slack = await padSlack();
  // (a) เกิน 1 byte: ใบท้ายคิวหลุดสายตา (เห็น 7/8)
  const overByte = await runS6({ flag: '1', pool: padPool(slack + 1) });
  assert.equal(overByte.status, 'done');
  assert.ok(!('decisionEvidence' in overByte), 'one byte over => omitted');
  const offByte = await runS6({ flag: null, pool: padPool(slack + 1) });
  assert.deepStrictEqual(overByte, offByte, 'byte-parity (one-byte-over pool)');
  // (b) เกิน 1 แถว: pool ชนเพดานพอดีแล้วเพิ่มอีกใบ (เห็น 8/9)
  const overRowPool = () => [...padPool(slack), IMG('img-extra', 0.2, { person: 'คนเกิน งบ', faceCount: 0, category: 'other', emotion: 'calm' })];
  const capRow = { brains: [] };
  const overRow = await runS6({ flag: '1', deps: mkDeps({ pool: overRowPool(), answer: ANSWER(), captures: capRow }) });
  assert.equal(overRow.status, 'done');
  assert.equal(capRow.brains[0].imagesMeta.length, 9, 'brain fn still receives all 9');
  assert.equal(budgetVisible(capRow.brains[0].imagesMeta), 8, 'production mirror cuts the 9th row');
  assert.ok(!('decisionEvidence' in overRow), 'one row over => omitted');
  const offRow = await runS6({ flag: null, pool: overRowPool(), answer: ANSWER() });
  assert.deepStrictEqual(overRow, offRow, 'byte-parity (one-row-over pool)');
});

// ── 16) brain ฉีดเทส "อวดว่าเห็นครบ" + picks ทั้งหมดอยู่ใน prefix ที่มองเห็น ⇒ ยัง omit — proof มาจาก mirror เท่านั้น ──
test('injected brain claiming full visibility cannot trick D — and no truncated-prefix fallback', async () => {
  const answer = {
    hero: { id: 'cand-000', reason: 'x' }, reaction: { id: 'cand-001', reason: 'x' }, action: { id: 'cand-002', reason: 'x' },
    context: { id: 'cand-003', reason: 'x' }, circle: { id: 'cand-004', reason: 'x' },
  }; // ทุก pick อยู่ในสายตา production (index < 53) — จักรวาลก็ยังไม่ครบ ห้ามถอยไปใช้ prefix เป็นจักรวาล
  const deps = mkDeps({ pool: bigPool(), answer });
  deps.slotDirectorBrain = async (args) => ({ slots: answer, note: `saw all ${args.imagesMeta.length} images` }); // คำอ้างของ brain ไม่มีน้ำหนัก
  const on = await runS6({ flag: '1', deps });
  assert.equal(on.status, 'done');
  assert.equal(String(on.dossierPatch.pickImages.slots.hero.id), 'cand-000');
  assert.ok(!('decisionEvidence' in on), 'brain-side claims must never substitute for the production budget mirror proof');
});

// ═══ Codex D P1 รอบ 2 — SERIALIZATION-STABILITY PROOF (walk-first · descriptor-only · ห้าม invoke) ═══
// meta.persons (และ field อื่น) พก object จาก caller ได้ — toJSON ที่ stateful/ขว้างทำให้ proof สองรอบ "id ตรงกัน"
// แต่ stringify รอบของสมองจริง (ทีหลัง) ได้ byte ต่าง/โดนตัดงบ · การ์ด: เดินโครงสร้างแบบ descriptor-safe ก่อนแตะ
// stringify ใดๆ — เจอ toJSON/accessor/โครงแปลกที่ไหน = omit ทั้ง sidecar โดยไม่ invoke แม้ครั้งเดียว
const hostilePool = (mut) => { const p = POOL(); mut(p); return p; };

// ── 17) (a) toJSON ขว้าง exception ⇒ absent + ธุรกิจเดิม + hostile ไม่ถูก invoke เลย ──
test('hostile throwing toJSON in meta graph => sidecar absent, business unchanged, never invoked', async () => {
  let invoked = 0;
  const mk = () => hostilePool((p) => { p[1].triage.persons = [{ toJSON() { invoked++; throw new Error('boom'); } }]; });
  const seam = { reads: 0 };
  const on = await runS6({ flag: '1', deps: withSeamCounter(mkDeps({ pool: mk(), answer: ANSWER() }), seam, undefined) });
  assert.equal(on.status, 'done');
  assert.ok(!('decisionEvidence' in on), 'unserializable-safe graph cannot be proven => omit');
  assert.equal(seam.reads, 0, 'invalid universe => producer seam never consulted');
  const off = await runS6({ flag: null, pool: mk(), answer: ANSWER() });
  assert.deepStrictEqual(on, off, 'business byte-parity ON vs OFF on the same hostile pool');
  assert.equal(invoked, 0, 'descriptor-safe detection must never invoke the hostile toJSON');
});

// ── 18) (b) stateful toJSON โตขึ้นทุกครั้ง (รอบสมองจริงจะโดนตัดงบ) ⇒ absent + ไม่ถูก invoke ──
test('stateful growing toJSON (brain-side stringify would truncate) => absent, never invoked', async () => {
  let calls = 0;
  const mk = () => hostilePool((p) => { p[2].triage.persons = [{ toJSON() { calls++; return 'x'.repeat(4000 * calls); } }]; });
  const on = await runS6({ flag: '1', pool: mk() });
  assert.equal(on.status, 'done');
  assert.ok(!('decisionEvidence' in on), 'stability unprovable => omit (never trust two matching passes)');
  const off = await runS6({ flag: null, pool: mk() });
  assert.deepStrictEqual(on, off, 'business byte-parity on the same hostile pool');
  assert.equal(calls, 0, 'proof must be structural — the stateful toJSON must never run');
});

// ── 19) (c) แถวไม่มี id ⇒ absent + ธุรกิจเดิม ──
test('missing id on a meta row => sidecar absent, business unchanged', async () => {
  const mk = () => { const p = POOL(); delete p[5].id; return p; }; // img-action สูญ id (แถวยัง serialize ได้ปกติ)
  const on = await runS6({ flag: '1', pool: mk() });
  assert.equal(on.status, 'done');
  assert.ok(!('decisionEvidence' in on), 'a row without an own primitive id => ambiguous universe => omit');
  const off = await runS6({ flag: null, pool: mk() });
  assert.deepStrictEqual(on, off, 'business byte-parity on the same pool');
});

// ── 20) (d) เสถียรสองรอบ proof แต่รอบที่สาม (ฝั่งสมอง) ต่าง — counter-based toJSON ⇒ absent + brain input เดิมแท้ ──
test('proof-to-brain boundary: toJSON stable for two passes, different on the third => absent, brain input untouched', async () => {
  let n = 0;
  const sneaky = { toJSON() { n++; return n <= 2 ? 'tiny' : 'x'.repeat(30000); } }; // สองรอบแรกตรงกัน รอบสามระเบิดงบ
  const mk = () => hostilePool((p) => { p[4].triage.persons = [sneaky]; });
  const captures = { brains: [] };
  const on = await runS6({ flag: '1', deps: mkDeps({ pool: mk(), answer: ANSWER(), captures }) });
  assert.equal(on.status, 'done');
  assert.ok(!('decisionEvidence' in on), 'byte-equal proof passes must NOT be trusted — structural rejection wins');
  // brain ได้ meta ก้อนจริงเดิม (ห้าม clone/แทนที่/mutate) — sneaky ตัวเดิมอยู่ใน persons และยังไม่เคยถูกเรียก
  const metaRow = captures.brains[0].imagesMeta.find((m) => m.id === 'img-ctx-story');
  assert.ok(metaRow && metaRow.persons[0] === sneaky, 'brain receives the ORIGINAL untouched persons reference');
  assert.equal(n, 0, 'no proof pass may have invoked the counter-based toJSON');
  const off = await runS6({ flag: null, deps: mkDeps({ pool: mk(), answer: ANSWER() }) });
  assert.deepStrictEqual(on, off, 'business byte-parity on the same hostile pool');
});

// ── 11) static scan: E ห้ามแตะ megaAdapters เด็ดขาด · F (cropReadiness) อนุญาตเฉพาะสะพาน B3 ที่เจ้าของอนุมัติ ──
// ★ 16 ก.ค. 69: เดิม assert ว่า F/E ต้อง absent ทั้งหมด — เฟส 4 B3 (c77070a) wire candidateCropReadiness
//   เข้า bridge อย่างถูกต้องตามแผนที่เคาะแล้ว จึงคุมแบบเจาะจงแทน: non-comment ต้องมีบรรทัดเดียว
//   และต้องเป็น dynamic import ใต้ DI seam เท่านั้น (การ wiring เพิ่มใดๆ นอกเหนือนี้ = พังทันทีเหมือนเดิม)
test('static: no searchQuality* in megaAdapters.js; candidateCropReadiness only via approved B3 bridge import', () => {
  const src = fs.readFileSync(ADAPTERS_PATH, 'utf8');
  assert.ok(!/searchQualityMeasurement|searchQualityMetrics/.test(src), 'E modules must stay absent from runtime wiring');
  const hits = src.split('\n').filter((l) => l.includes('candidateCropReadiness') && !/^\s*(\/\/|\*)/.test(l));
  assert.equal(hits.length, 1, 'candidateCropReadiness must appear in exactly ONE non-comment line (the B3 bridge import)');
  assert.ok(/deps\?\.cropReadinessApi \|\| await import\('@\/lib\/candidateCropReadiness'\)/.test(hits[0]), 'the single reference must be the DI-guarded dynamic import inside _buildCropReadinessEvidenceV1');
});

// ── 12) static scope: โค้ด D ใหม่ไม่แตะระบบต้องห้าม + โครงตามสเปก ──
test('static: D-sidecar code stays in scope (no forbidden systems) and wiring shape is exact', () => {
  const src = fs.readFileSync(ADAPTERS_PATH, 'utf8');
  const lines = src.split('\n');
  const dLines = lines.filter((l) => /_dEvidenceOn|_dTrace|_dUniverse|_dSidecar|_dStage|_dPreSwap|_dIdOf|_dRows|_dRec|_dFinalId|_dIdx|_dProduce|_dRes|_finalDecisionEvidenceFlag|postSelectionDecisionProducer/.test(l));
  assert.ok(dLines.length >= 20, 'D wiring lines must exist');
  // สอง "บรรทัด return" มี legacy tokens ของเดิมร่วมบรรทัด (spread ถูกฝังใน shape เดิม) — ตัว spread เอง
  // ถูกตรวจ exact-shape แยกด้านล่างแล้ว จึงคัดออกจากสแกน scope (ห้ามคัดบรรทัด D อื่นใดออก)
  const SPREAD = '...(_dSidecar ? { decisionEvidence: _dSidecar } : {})';
  const dScopeLines = dLines.filter((l) => !l.includes(SPREAD));
  assert.equal(dLines.length - dScopeLines.length, 2, 'exactly the two return-shape lines are excluded');
  const forbidden = /slotPlan|rawBody|s7_cover|SelectionSpec|selectionSpec|strictRender|renderer|refSlotContract|solverShadow|candidateLedger|\/api\/queue/;
  for (const l of dScopeLines) assert.ok(!forbidden.test(l), `D line touches forbidden system: ${l.trim().slice(0, 120)}`);
  // producer ถูกอ้างที่เดียว (dynamic import ใต้การ์ด ON) และไม่มี static import ของโมดูล D
  assert.equal((src.match(/postSelectionDecisionProducer/g) || []).length, 1, 'exactly one guarded reference to the producer');
  assert.ok(!/^import[^\n]*(postSelectionDecisionProducer|decisionEvidence)/m.test(src), 'no static import of D modules');
  // spread additive อันเดียวต่อ shape — สองจุดพอดี (normal + hero-failure)
  assert.equal((src.match(/\.\.\.\(_dSidecar \? \{ decisionEvidence: _dSidecar \} : \{\}\)/g) || []).length, 2, 'one conditional spread per return shape');
  // latch ต้องมาก่อน await แรกจริงของ s6_slots (await _jf(... อ่านคลังรูป) — ไม่นับคำ 'await' ในคอมเมนต์)
  const fnStart = src.indexOf('export async function s6_slots');
  const latchAt = src.indexOf('_finalDecisionEvidenceFlag(process.env.MEGA_FINAL_DECISION_EVIDENCE_V2)', fnStart);
  const firstAwait = src.indexOf('await _jf(', fnStart);
  assert.ok(fnStart > 0 && latchAt > fnStart && firstAwait > fnStart && latchAt < firstAwait, 'flag latch must precede the first await in s6_slots');
});
