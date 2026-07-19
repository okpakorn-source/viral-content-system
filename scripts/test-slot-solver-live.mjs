// ============================================================
// 🧮 Phase 1 — Solver Live Canary harness (19 ก.ค. 69, สเปคผู้บัญชาการ sol.)
// ------------------------------------------------------------
// ครอบ: OFF=ผล LLM เดิม byte-parity · ON=solver ชนะเมื่อ LLM เลือกต่าง (ผ่าน gate เดิมทุกด่าน) ·
//   deterministic ซ้ำหลายรอบ · hero ผิดคนถูกตัด (atomic validator, unit) · id ซ้ำ/ช่องโหว่/malformed →
//   fallback ทั้งชุด + ติดป้าย s6_authority (unit + integration) · เปลี่ยน env กลางฟังก์ชันไม่มีผล (TOCTOU) ·
//   shadow diagnostics เดิมยังอยู่ (solverShadow/solverShadowV2)
//
// รูปแบบ loader เดียวกับ scripts/test-semantic-selection.mjs: alias '@/lib/*' → src/* แบบ data:URL hook
// (ไม่มีไฟล์ loader แยก) — '@/lib/aiClient' stub ให้ throw เสมอ (การันตีไม่มีการยิง LLM จริง) +
// stub '@/lib/services/multiAgentImageScraper' (ตัด sharp/cheerio/@google/generative-ai ออกจากเส้นเทส)
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const AI_STUB = _mod('export function callBrain(a){ throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
// getSourceScore ต้องเป็นฟังก์ชันจริง (buildSolverPlan เช็ค typeof === 'function') แต่ห้ามยิงเน็ต/โหลด
// sharp/cheerio/@google/generative-ai — คืนค่ากลางเสมอ (เหมือน "ไม่รู้จักโดเมน" ของจริง)
const STUB_SCRAPER = _mod('export function getSourceScore(){ return 4; }');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/services/multiAgentImageScraper') return { url: ${JSON.stringify(STUB_SCRAPER)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook));

// env สะอาดก่อน import (module-level const หลายตัวอ่านตอน import ครั้งเดียว)
delete process.env.MEGA_SEMANTIC_SELECTION;
delete process.env.MEGA_SELECTION_SPEC;
delete process.env.MEGA_REF_SHOT_AUTHORITY;
delete process.env.MEGA_REF_HERO_V2;
delete process.env.MEGA_CANDIDATE_LEDGER;
delete process.env.MEGA_FINAL_DECISION_EVIDENCE_V2;
delete process.env.MEGA_ROLE_READINESS;
delete process.env.MEGA_SLOT_SOLVER_LIVE; // เริ่มด้วย OFF เสมอ — เทสตั้งเองต่อเคส

const { s6_slots, buildSolverPlan, validateSolverPlanAtomic } = await import('../src/lib/megaAdapters.js');

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

// ---------- fixtures ----------
const IMG = (id, over = {}, t = {}) => ({
  id,
  imageUrl: `https://cdn.test/${id}.jpg`,
  width: 800, height: 1000, realWidth: 900, realHeight: 1200,
  ...over,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: null, persons: [],
    category: 'context', emotion: 'warm', note: '', newsScene: true, quality: 7,
    ...t,
  },
});

const mkJob = () => ({
  dossier: {
    images: { caseId: 'SOLVER-LIVE-TEST' },
    compass: {
      angle: 'มุมทดสอบ solver-live', primaryEmotion: 'warm', secondaryEmotions: [],
      mainCharacters: [{ name: 'Alice', role: 'hero' }, { name: 'Bob', role: 'related' }],
      visualDreamShots: [], doNotUse: [],
    },
    desk: { title: 'ข่าวทดสอบ solver-live canary' },
    // ★ ต้องตรึง refMatch เอง — s6_slots auto-pick ref จากคลังจริงแบบ "สุ่มจากคะแนนใกล้กัน" เมื่อไม่มี refMatch
    //   (ไม่ deterministic + panelCount ของ ref จริงอาจตัด activeSlots เหลือ <5 ช่อง) → ปักเป็น weak-match ว่าง
    //   ชัดเจน (typeMatched:false → _refDNA=null · dna:{} ไม่มี panelCount → activeSlots = SLOT_ORDER เต็ม 5 ช่อง)
    refMatch: { dna: {}, styleName: 'no-ref-fixture', imagePath: '', reason: 'test fixture: no ref', typeMatched: false },
    // ไม่มี artBrief โดยตั้งใจ — legacy mode ล้วน (SLOT_ORDER 5 ช่อง hero/reaction/action/context/circle)
  },
});

const mkDeps = ({ pool, brainAnswer, brainThrows = false, captures, onFetch = null }) => ({
  slotDirectorBrain: async (args) => {
    captures.brainArgs.push(args);
    if (brainThrows) throw new Error('BRAIN_FORCED_FAIL_IN_TEST');
    return { slots: brainAnswer, note: 'mock-llm' };
  },
  fetchJson: async (url) => {
    captures.fetches.push(String(url));
    if (onFetch) onFetch(String(url));
    if (String(url).includes('/api/images/')) return { success: true, images: pool };
    throw new Error('unexpected fetch in test: ' + url);
  },
});

// พูล A: hero=Alice (A1 แต้มสูง / A2 แต้มต่ำกว่าแต่ยังผ่านทุกด่าน) · circle=Bob (B1 แต้มสูง) ·
//   เหลือ B2/C1/C2/D1 ให้ reaction/action/context เลือกได้ครบ ไม่มีช่องโหว่ทั้งสองฝั่ง (solver/legacy)
const POOL_DISAGREE = [
  IMG('A1', { realWidth: 900, realHeight: 1200 }, { person: 'Alice', faceCount: 1, quality: 9, sharpness: 50, category: 'face-emotional' }),
  IMG('A2', { realWidth: 750, realHeight: 1000 }, { person: 'Alice', faceCount: 1, quality: 5, sharpness: 15, category: 'face-neutral' }),
  IMG('B1', { realWidth: 900, realHeight: 1200 }, { person: 'Bob', faceCount: 1, quality: 9, sharpness: 50, category: 'face-emotional' }),
  IMG('B2', { realWidth: 800, realHeight: 1000 }, { person: 'Bob', faceCount: 1, quality: 6, sharpness: 30, category: 'context' }),
  IMG('C1', { realWidth: 1000, realHeight: 1300 }, { person: null, faceCount: 0, quality: 7, sharpness: 35, category: 'context' }),
  IMG('C2', { realWidth: 900, realHeight: 1200 }, { person: null, faceCount: 0, quality: 6, sharpness: 28, category: 'context' }),
  IMG('D1', { realWidth: 850, realHeight: 1100 }, { person: 'Bob', faceCount: 1, quality: 7, sharpness: 32, category: 'context' }),
];
const BRAIN_ANSWER_DISAGREE = {
  hero: { id: 'A2', reason: 'llm pick (deliberately weaker than A1)', backups: [] },
  circle: { id: 'B1', reason: 'llm', backups: [] },
  reaction: { id: 'B2', reason: 'llm', backups: [] },
  action: { id: 'C1', reason: 'llm', backups: [] },
  context: { id: 'C2', reason: 'llm', backups: [] },
};

const withSolverLive = async (on, fn) => {
  if (on) process.env.MEGA_SLOT_SOLVER_LIVE = '1'; else delete process.env.MEGA_SLOT_SOLVER_LIVE;
  try { return await fn(); } finally { delete process.env.MEGA_SLOT_SOLVER_LIVE; }
};

// ============================================================
// TIER 1 — validateSolverPlanAtomic (pure export, ไม่มี IO) — ครอบ hole/duplicate/out-of-universe/
//   hero-identity-fail/malformed โดยตรง ไม่ต้อง mock s6_slots ทั้งฟังก์ชัน
// ============================================================

await test('atomic: แผนครบ+unique+hero ผ่าน identity → ok:true', () => {
  const solved = { assignments: [
    { slotId: 'hero', imageId: 'A1', total: 90 },
    { slotId: 'circle', imageId: 'B1', total: 80 },
  ] };
  const r = validateSolverPlanAtomic({
    solved, activeSlots: ['hero', 'circle'],
    universeIds: new Set(['A1', 'B1']), heroSlotId: 'hero', heroValidIds: new Set(['A1']),
  });
  assert.equal(r.ok, true);
  assert.equal(r.bySlot.get('hero').imageId, 'A1');
});

await test('atomic: ช่องโหว่ (imageId null) → ok:false reason HOLE', () => {
  const solved = { assignments: [
    { slotId: 'hero', imageId: 'A1', total: 90 },
    { slotId: 'circle', imageId: null, total: 0 },
  ] };
  const r = validateSolverPlanAtomic({
    solved, activeSlots: ['hero', 'circle'],
    universeIds: new Set(['A1', 'B1']), heroSlotId: 'hero', heroValidIds: new Set(['A1']),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'HOLE');
  assert.equal(r.slot, 'circle');
});

await test('atomic: id ซ้ำข้ามช่อง → ok:false reason DUPLICATE', () => {
  const solved = { assignments: [
    { slotId: 'hero', imageId: 'A1', total: 90 },
    { slotId: 'circle', imageId: 'A1', total: 80 }, // ซ้ำกับ hero
  ] };
  const r = validateSolverPlanAtomic({
    solved, activeSlots: ['hero', 'circle'],
    universeIds: new Set(['A1', 'B1']), heroSlotId: 'hero', heroValidIds: new Set(['A1']),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'DUPLICATE');
});

await test('atomic: id นอก universe → ok:false reason OUT_OF_UNIVERSE', () => {
  const solved = { assignments: [
    { slotId: 'hero', imageId: 'GHOST-ID', total: 90 },
    { slotId: 'circle', imageId: 'B1', total: 80 },
  ] };
  const r = validateSolverPlanAtomic({
    solved, activeSlots: ['hero', 'circle'],
    universeIds: new Set(['A1', 'B1']), heroSlotId: 'hero', heroValidIds: new Set(['A1']),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'OUT_OF_UNIVERSE');
  assert.equal(r.slot, 'hero');
});

await test('atomic: hero ผิดคน (ไม่อยู่ใน heroValidIds) → ok:false reason HERO_IDENTITY_FAIL — ถูกตัด', () => {
  const solved = { assignments: [
    { slotId: 'hero', imageId: 'B1', total: 95 }, // B1 = Bob แต่ hero ต้องเป็น Alice
    { slotId: 'circle', imageId: 'A1', total: 80 },
  ] };
  const r = validateSolverPlanAtomic({
    solved, activeSlots: ['hero', 'circle'],
    universeIds: new Set(['A1', 'B1']), heroSlotId: 'hero', heroValidIds: new Set(['A1']), // เฉพาะ A1 คือ Alice ตัวจริง
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'HERO_IDENTITY_FAIL');
  assert.equal(r.imageId, 'B1');
});

await test('atomic: solved malformed (null/ไม่มี assignments array) → ok:false reason MALFORMED', () => {
  assert.equal(validateSolverPlanAtomic({ solved: null, activeSlots: ['hero'], universeIds: new Set(), heroSlotId: 'hero', heroValidIds: new Set() }).reason, 'MALFORMED');
  assert.equal(validateSolverPlanAtomic({ solved: {}, activeSlots: ['hero'], universeIds: new Set(), heroSlotId: 'hero', heroValidIds: new Set() }).reason, 'MALFORMED');
  assert.equal(validateSolverPlanAtomic({ solved: { assignments: 'not-array' }, activeSlots: ['hero'], universeIds: new Set(), heroSlotId: 'hero', heroValidIds: new Set() }).reason, 'MALFORMED');
});

// ============================================================
// TIER 2 — buildSolverPlan (helper เดียวที่ shadow + live ใช้ร่วมกัน) — deterministic + throw บน input พัง
// ============================================================

await test('buildSolverPlan: deterministic — input เดิมเรียกกี่ครั้งก็ได้ output byte เดิม', async () => {
  const args = {
    activeSlots: ['hero', 'reaction', 'action', 'context', 'circle'],
    sorted: POOL_DISAGREE,
    compass: { mainCharacters: [{ name: 'Alice' }, { name: 'Bob' }] },
    orders: [],
    heroNames: ['Alice'],
    storyFitOf: () => null,
    sceneKeyOf: () => null,
    isClean: () => true,
    realShortSideOf: (x) => { const rw = Number(x.realWidth), rh = Number(x.realHeight); return (rw > 0 && rh > 0) ? Math.min(rw, rh) : null; },
  };
  const p1 = await buildSolverPlan(args);
  const p2 = await buildSolverPlan(args);
  assert.equal(JSON.stringify(p1.solved), JSON.stringify(p2.solved), 'solved ต้องเหมือนกันทุก byte เมื่อ input เดิม');
  assert.equal(typeof p1.normShot, 'function', 'ต้อง export normShot ให้ผู้เรียก reuse (ห้ามนิยามซ้ำ 2 ที่)');
  assert.ok(Array.isArray(p1.solved.assignments) && p1.solved.assignments.length === 5);
});

await test('buildSolverPlan: input พัง (sorted ไม่ใช่ array) → throw (ผู้เรียกต้อง try/catch เอง)', async () => {
  await assert.rejects(() => buildSolverPlan({
    activeSlots: ['hero'], sorted: null, compass: {}, orders: [], heroNames: [],
    storyFitOf: () => null, sceneKeyOf: () => null, isClean: () => true, realShortSideOf: () => null,
  }));
});

// ============================================================
// TIER 3 — full-integration ผ่าน s6_slots จริง (brain/fetchJson ฉีด, ไม่ยิง LLM/HTTP จริง)
// ============================================================

await test('SOLVER_LIVE=off: ผล LLM เดิมเป๊ะ + ไม่มี s6_authority + solverShadow ยังอยู่ (byte-parity OFF)', async () => {
  await withSolverLive(false, async () => {
    const captures = { brainArgs: [], fetches: [] };
    const out = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: POOL_DISAGREE, brainAnswer: BRAIN_ANSWER_DISAGREE, captures }) });
    assert.equal(out.status, 'done');
    const pi = out.dossierPatch.pickImages;
    assert.equal(pi.slots.hero.id, 'A2', 'OFF ต้องได้ตัวเลือก LLM เดิม (A2) ไม่ใช่ solver (A1)');
    assert.equal(pi.slots.circle.id, 'B1');
    assert.equal(pi.slots.reaction.id, 'B2');
    assert.equal(pi.slots.action.id, 'C1');
    assert.equal(pi.slots.context.id, 'C2');
    assert.equal('s6_authority' in pi, false, 'OFF ต้องไม่มี field s6_authority เลย (byte-parity dossier เดิม)');
    assert.equal('solverInvalidReason' in pi, false, 'OFF ต้องไม่มี field solverInvalidReason เลย');
    assert.ok(pi.solverShadow && pi.solverShadow.v === 1, 'shadow diagnostics เดิม (v1) ต้องยังทำงานแม้ live=off');
    assert.ok(typeof pi.solverShadow.agree === 'number' && Array.isArray(pi.solverShadow.perSlot));
    const heroShadow = pi.solverShadow.perSlot.find((s) => s.slot === 'hero');
    assert.equal(heroShadow.llm, 'A2');
    assert.equal(heroShadow.solver, 'A1', 'shadow log ต้องเห็นว่า solver อยากได้ A1 (ต่างจาก LLM) แม้ live=off ไม่ตัดสินจริง');
    assert.equal(heroShadow.match, false);
  });
});

await test('SOLVER_LIVE=on: solver ชนะเมื่อ LLM เลือกต่าง (hero A1 แทน A2) + s6_authority=slotSolver + ผ่าน gate เดิมครบ', async () => {
  await withSolverLive(true, async () => {
    const captures = { brainArgs: [], fetches: [] };
    const out = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: POOL_DISAGREE, brainAnswer: BRAIN_ANSWER_DISAGREE, captures }) });
    assert.equal(out.status, 'done');
    const pi = out.dossierPatch.pickImages;
    assert.equal(pi.s6_authority, 'slotSolver');
    assert.equal('solverInvalidReason' in pi, false, 'solver ชนะจริง (ไม่ fallback) → ไม่ควรมี solverInvalidReason');
    assert.equal(pi.slots.hero.id, 'A1', 'ON ต้องได้ตัวเลือก solver (A1) ชนะ LLM (A2)');
    assert.match(pi.slots.hero.reason, /solver/i, 'reason ต้องระบุที่มาว่าเป็น solver');
    // ผ่าน gate เดิมครบ: ทุกช่อง unique id, ไม่มีช่องซ้ำ, hero ต้องเป็นคน Alice จริง (ผ่าน identity hard rule เดิม)
    const ids = Object.values(pi.slots).map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'ทุกช่องต้อง id ไม่ซ้ำกัน (ผ่านด่าน duplicate เดิม)');
    assert.ok(pi.solverShadow && pi.solverShadow.v === 1, 'shadow diagnostics เดิมต้องยังอยู่แม้ live=on');
    assert.ok(pi.solverShadowV2, 'solverShadowV2 เดิมต้องยังอยู่แม้ live=on');
  });
});

await test('SOLVER_LIVE=on: deterministic ซ้ำหลายรอบ — output เหมือนกันทุก byte', async () => {
  await withSolverLive(true, async () => {
    const run = async () => {
      const captures = { brainArgs: [], fetches: [] };
      const out = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: POOL_DISAGREE, brainAnswer: BRAIN_ANSWER_DISAGREE, captures }) });
      return out.dossierPatch.pickImages.slots;
    };
    const r1 = await run();
    const r2 = await run();
    const r3 = await run();
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), 'รอบ 1 กับ 2 ต้อง byte เดิม');
    assert.equal(JSON.stringify(r2), JSON.stringify(r3), 'รอบ 2 กับ 3 ต้อง byte เดิม');
  });
});

await test('SOLVER_LIVE=on แต่แผน solver ไม่ผ่าน atomic (hero ไม่มีใครตรงคนเลย) → ทั้งชุดถอยไป LLM (llm_fallback) ไม่ใช่ solver ผิดคน', async () => {
  await withSolverLive(true, async () => {
    // พูลไม่มีภาพ Alice เลยสักใบ — ทั้ง solver และ legacy gate ต้อง reject hero ทุกตัวเลือก (identity hard rule เดิม)
    const poolNoAlice = [
      IMG('B1', { realWidth: 900, realHeight: 1200 }, { person: 'Bob', faceCount: 1, quality: 9, sharpness: 50, category: 'face-emotional' }),
      IMG('B2', { realWidth: 800, realHeight: 1000 }, { person: 'Bob', faceCount: 1, quality: 6, sharpness: 30, category: 'context' }),
      IMG('C1', { realWidth: 1000, realHeight: 1300 }, { person: null, faceCount: 0, quality: 7, sharpness: 35, category: 'context' }),
      IMG('C2', { realWidth: 900, realHeight: 1200 }, { person: null, faceCount: 0, quality: 6, sharpness: 28, category: 'context' }),
    ];
    // brain (LLM) เผลอเสนอ Bob เป็น hero — ด่านโค้ดเดิม (_identityOk) ต้องตัดทิ้งเหมือนเดิมไม่ว่า live on/off
    const answerWrongHero = {
      hero: { id: 'B1', reason: 'llm เผลอเสนอผิดคน', backups: [] },
      circle: { id: 'B2', reason: 'llm', backups: [] },
      reaction: { id: 'C1', reason: 'llm', backups: [] },
      action: { id: 'C2', reason: 'llm', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [] };
    const out = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: poolNoAlice, brainAnswer: answerWrongHero, captures }) });
    assert.equal(out.status, 'failed', 'ไม่มีภาพ hero ถูกคนเลย → ต้อง fail (ห้ามฝืนทำปกผิดคน — กฎเดิม)');
    assert.equal(out.dossierPatch.pickImages.s6_authority, 'llm_fallback', 'solver ไม่ผ่าน atomic (hero HOLE) แต่ brain ยังทำงานได้ → ป้ายต้องเป็น llm_fallback ไม่ใช่ slotSolver');
    assert.equal(out.dossierPatch.pickImages.solverInvalidReason, 'HOLE', 'ต้องบันทึกเหตุผลที่ solver ไม่ผ่านไว้ใน dossier ด้วย (debuggability)');
    assert.ok(!out.dossierPatch.pickImages.slots.hero, 'hero ต้องว่าง (ทั้งสองฝั่งตัดผิดคนเหมือนกัน)');
  });
});

await test('SOLVER_LIVE=on + brain ก็ล่มด้วย → s6_authority=legacy_fallback (heuristic ล้วน)', async () => {
  await withSolverLive(true, async () => {
    const poolNoAlice = [
      IMG('B1', { realWidth: 900, realHeight: 1200 }, { person: 'Bob', faceCount: 1, quality: 9, sharpness: 50, category: 'face-emotional' }),
      IMG('B2', { realWidth: 800, realHeight: 1000 }, { person: 'Bob', faceCount: 1, quality: 6, sharpness: 30, category: 'context' }),
      IMG('C1', { realWidth: 1000, realHeight: 1300 }, { person: null, faceCount: 0, quality: 7, sharpness: 35, category: 'context' }),
      IMG('C2', { realWidth: 900, realHeight: 1200 }, { person: null, faceCount: 0, quality: 6, sharpness: 28, category: 'context' }),
    ];
    const captures = { brainArgs: [], fetches: [] };
    const out = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: poolNoAlice, brainAnswer: {}, brainThrows: true, captures }) });
    assert.equal(out.status, 'failed');
    assert.equal(out.dossierPatch.pickImages.s6_authority, 'legacy_fallback', 'brain ล่มด้วย → heuristic ล้วน ต้องติดป้าย legacy_fallback');
    assert.equal(out.dossierPatch.pickImages.solverInvalidReason, 'HOLE');
  });
});

await test('เปลี่ยน MEGA_SLOT_SOLVER_LIVE กลางฟังก์ชัน (หลัง entry) ไม่มีผล — snapshot ตอนเข้าฟังก์ชันเท่านั้น (TOCTOU-proof)', async () => {
  delete process.env.MEGA_SLOT_SOLVER_LIVE; // เริ่มด้วย OFF
  const captures = { brainArgs: [], fetches: [] };
  let flippedInsideFetch = false;
  const out = await s6_slots(mkJob(), {
    origin: 'http://mock',
    _deps: mkDeps({
      pool: POOL_DISAGREE, brainAnswer: BRAIN_ANSWER_DISAGREE, captures,
      onFetch: (url) => {
        if (String(url).includes('/api/images/') && !flippedInsideFetch) {
          flippedInsideFetch = true;
          process.env.MEGA_SLOT_SOLVER_LIVE = '1'; // แอบเปิดกลางทาง (หลัง SOLVER_LIVE ถูก snapshot ไปแล้วตอน entry)
        }
      },
    }),
  });
  delete process.env.MEGA_SLOT_SOLVER_LIVE;
  assert.ok(flippedInsideFetch, 'ต้องยืนยันว่า fetchJson ถูกเรียกจริง (แปลว่า flip เกิดขึ้นกลางการทำงานจริง)');
  assert.equal(out.status, 'done');
  const pi = out.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'A2', 'ผลต้องยังเป็น LLM เดิม (A2) — flip กลางทางต้องไม่มีผลย้อนหลัง');
  assert.equal('s6_authority' in pi, false, 'ต้องไม่มี s6_authority โผล่ — SOLVER_LIVE snapshot ไว้เป็น false ตั้งแต่ entry แล้ว');
});

console.log(`1..${passed}`);
