// ============================================================
// crop-guard.test.mjs — เลน A · P1 ด่านครอป + P3 หักคะแนนหน้าชิดขอบ "ก่อนเลือกรูป"
//   (1) computeCropGuard PURE — สูตร cover-fit upscale / heroEligible fail-closed / edgePenalty
//   (2) s6_slots wiring — pre-brain ป้าย meta · post-brain hard swap · violation flag · OFF byte-identical
//   ไม่ยิง LLM/network/store จริง (loader stubs + injected fakes) · deterministic ล้วน
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const AI_STUB = _mod('export function callBrain(a){ if (globalThis.__MEGA_AI) return globalThis.__MEGA_AI(a); throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// pin gates ที่ไม่เกี่ยวออกให้หมด (isolate crop guard) ก่อน import — module-level constants อ่านครั้งเดียวตอน import
process.env.S6_REAL_SIZE_GATE = '0';   // อย่าให้ด่านขนาดจริงเดิมสลับ hero แทน
process.env.S6_STORY_FIT = '0';        // ปิด story-fit rescue
process.env.MEGA_QUARANTINE = '0';     // ปิดกักกันขนาด
process.env.POOL_CLEAN_GATE = '0';     // พูลไม่ถูกกรอง clean
process.env.MEGA_S6_MIN_CLEAN = '0';   // ไม่ตัด clean=false
process.env.MEGA_SOLVER_DIAGNOSTICS_V2 = '0';
delete process.env.MEGA_SEMANTIC_SELECTION; // legacy mode
delete process.env.MEGA_SELECTION_SPEC;
delete process.env.MEGA_REF_HERO_V2;
delete process.env.MEGA_ROLE_READINESS;
delete process.env.MEGA_FINAL_DECISION_EVIDENCE_V2;

const { computeCropGuard, HERO_UPSCALE_MAX, SLOT_UPSCALE_MAX } = await import('../src/lib/cropGuard.js');
const { s6_slots } = await import('../src/lib/megaAdapters.js');
const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };

// ── ช่อง hero ของ DNA ทดสอบ = 'main' 540×1350 (คำนวณจริงจาก dnaToTemplateSpec) ──
const DNA = (() => {
  const refs = JSON.parse(fs.readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
  const rec = refs.find((r) => r.id === 'REF-mrbqalpo-h1r1');
  assert.ok(rec?.dna, 'ref DNA ต้องมี');
  return rec.dna;
})();
const SPEC = dnaToTemplateSpec(DNA);
const HERO = SPEC.slots.find((s) => s.id === 'main');
assert.ok(HERO && HERO.w === 540 && HERO.h === 1350, `hero slot 540×1350 (ได้ ${HERO?.w}×${HERO?.h})`);

// ═══════════════════════ (1) computeCropGuard — PURE UNIT ═══════════════════════

await test('upscale: ภาพใหญ่ (1200×1600) heroEligible=true · cover-fit = 0.844', async () => {
  const g = computeCropGuard({ pool: [{ id: 'BIG', realWidth: 1200, realHeight: 1600 }], templateSpec: SPEC });
  const r = g.byId.get('BIG');
  assert.equal(r.hasRealDims, true);
  assert.ok(Math.abs(r.heroUpscale - Math.max(540 / 1200, 1350 / 1600)) < 1e-9, 'heroUpscale cover-fit ถูก');
  assert.equal(r.heroEligible, true);
});

await test('upscale: ภาพเล็ก (800×1000) heroEligible=false · ยืด 1.35× เกิน 1.2×', async () => {
  const g = computeCropGuard({ pool: [{ id: 'SMALL', realWidth: 800, realHeight: 1000 }], templateSpec: SPEC });
  const r = g.byId.get('SMALL');
  assert.ok(Math.abs(r.heroUpscale - 1.35) < 1e-9, `heroUpscale=1.35 (ได้ ${r.heroUpscale})`);
  assert.ok(r.heroUpscale > HERO_UPSCALE_MAX, 'เกินเพดาน hero');
  assert.equal(r.heroEligible, false);
  // 800×1000 ยัง fit ช่องรอง (540×446 → max(0.675,0.446)=0.675 ≤ 1.6)
  assert.equal(r.slotEligible, true);
});

await test('fail-closed: ไม่มี realWidth/realHeight → hasRealDims=false · heroEligible=false', async () => {
  const g = computeCropGuard({ pool: [
    { id: 'NODIM' },                                  // ไม่มี dims เลย
    { id: 'SHORTONLY', triage: { realShortSide: 900 } }, // มีแค่ short side (ไม่รู้ aspect)
    { id: 'ZERO', realWidth: 0, realHeight: 1000 },      // 0 = ไม่ valid
  ], templateSpec: SPEC });
  for (const id of ['NODIM', 'SHORTONLY', 'ZERO']) {
    const r = g.byId.get(id);
    assert.equal(r.hasRealDims, false, `${id} hasRealDims=false`);
    assert.equal(r.heroEligible, false, `${id} heroEligible=false (fail-closed)`);
    assert.equal(r.heroUpscale, HERO ? r.heroUpscale : null); // heroUpscale=null เพราะ dims=null
    assert.equal(r.heroUpscale, null);
  }
});

await test('edgePenalty: หน้าชิดขอบ → penalty สูง · หน้ากลางเฟรม → 0 · ไม่มี faceBox → 0 neutral', async () => {
  const g = computeCropGuard({ pool: [
    { id: 'EDGE', realWidth: 1200, realHeight: 1600, triage: { faceBox: { x1: 0.0, y1: 0.0, x2: 0.3, y2: 0.3 } } }, // ชิดมุมบนซ้าย
    { id: 'CENTER', realWidth: 1200, realHeight: 1600, triage: { faceBox: { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 } } }, // กลาง
    { id: 'NOFACE', realWidth: 1200, realHeight: 1600 },
  ], templateSpec: SPEC });
  assert.ok(g.byId.get('EDGE').edgePenalty > 0.9, 'ชิดขอบ penalty สูง');
  assert.equal(g.byId.get('CENTER').edgePenalty, 0, 'กลางเฟรม penalty=0');
  assert.equal(g.byId.get('NOFACE').edgeCut, null, 'ไม่มี faceBox → edgeCut=null');
  assert.equal(g.byId.get('NOFACE').edgePenalty, 0, 'ไม่มี faceBox → penalty 0 neutral (ไม่ลงโทษ)');
});

await test('deterministic: เรียกซ้ำ input เดียวกัน ได้ guards เท่ากันเป๊ะ', async () => {
  const pool = [{ id: 'A', realWidth: 800, realHeight: 1000 }, { id: 'B', realWidth: 1200, realHeight: 1600 }];
  const a = computeCropGuard({ pool, templateSpec: SPEC });
  const b = computeCropGuard({ pool, templateSpec: SPEC });
  assert.equal(JSON.stringify(a.guards), JSON.stringify(b.guards));
});

await test('backstop: input พิสดาร (null / templateSpec หาย) → โครงว่างปลอดภัย ไม่ throw', async () => {
  assert.deepEqual(computeCropGuard(null).guards, []);
  assert.equal(computeCropGuard({ pool: [{ id: 'X', realWidth: 800, realHeight: 1000 }] }).heroSlot, null);
});

// ═══════════════════════ (2) s6_slots WIRING ═══════════════════════

const IMG = (id, t = {}, top = {}) => ({ id, imageUrl: `https://cdn.test/${id}.jpg`, thumbnailUrl: '', width: 800, height: 1000, realWidth: 900, realHeight: 1200, ...top, triage: { relevant: true, clean: true, faceCount: 1, person: null, persons: [], category: 'context', emotion: 'warm', note: '', newsScene: true, quality: 7, ...t } });
const CHARS = [{ name: 'ดวงเดือน', role: 'hero' }];
const mkJob = () => ({ dossier: { images: { caseId: 'CG-TEST' }, compass: { angle: 'มุมทดสอบ', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: CHARS, visualDreamShots: [], doNotUse: [] }, desk: { title: 'ข่าวทดสอบครอป' }, refMatch: { dna: DNA, styleName: 'ref-test', typeMatched: true, imagePath: '/ref-covers/test.jpg' } } });
const mkDeps = ({ pool, answer, captures }) => ({
  slotDirectorBrain: async (args) => { captures.brainArgs.push(args); return { slots: answer, note: 'mock' }; },
  fetchJson: async (url) => { captures.fetches.push(url); if (String(url).includes('/api/images/')) return { success: true, images: pool }; throw new Error('unexpected fetch: ' + url); },
});
const setPrefilter = (v) => { if (v === null) delete process.env.MEGA_CROP_PREFILTER; else process.env.MEGA_CROP_PREFILTER = v; };

// hero person ดวงเดือน · SMALL=ยืด 1.35× (ineligible) · BIG=0.844× (eligible)
const SMALL = IMG('SMALL', { person: 'ดวงเดือน', category: 'face-emotional' }, { realWidth: 800, realHeight: 1000 });
const BIG = IMG('BIG', { person: 'ดวงเดือน', category: 'face-neutral' }, { realWidth: 1200, realHeight: 1600 });
const F1 = IMG('F1', { category: 'context', faceCount: 0 }, { realWidth: 1200, realHeight: 900 });
const F2 = IMG('F2', { category: 'action', faceCount: 0 }, { realWidth: 1200, realHeight: 900 });
const F3 = IMG('F3', { category: 'context', faceCount: 0 }, { realWidth: 1200, realHeight: 900 });

await test('pre-brain: meta ติดป้าย heroCropBlock เฉพาะรูปที่ heroEligible=false (SMALL) — สมองเห็น', async () => {
  setPrefilter('1');
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'BIG', reason: 'x', backups: [] }, reaction: { id: 'SMALL', reason: 'x', backups: [] }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [SMALL, BIG, F1, F2, F3], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  const mSmall = meta.find((m) => m.id === 'SMALL');
  const mBig = meta.find((m) => m.id === 'BIG');
  assert.ok(mSmall.heroCropBlock && /ห้ามเป็น hero/.test(mSmall.heroCropBlock), 'SMALL ติดป้ายห้าม hero');
  assert.ok(!('heroCropBlock' in mBig), 'BIG ไม่ติดป้าย (eligible)');
});

await test('post-brain (a): brain ตั้ง SMALL เป็น hero → สลับกับช่อง reaction ที่ถือ BIG (crop-safe คนเดียวกัน)', async () => {
  setPrefilter('1');
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'SMALL', reason: 'x', backups: [] }, reaction: { id: 'BIG', reason: 'x', backups: [] }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [SMALL, BIG, F1, F2, F3], answer, captures }) });
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'BIG', 'hero สลับเป็น BIG');
  assert.equal(pi.slots.reaction.id, 'SMALL', 'reaction รับ SMALL เดิม');
  assert.equal(pi.cropGuard.swapped, true);
  assert.equal(pi.cropGuard.violation, false);
  assert.equal(pi.cropGuard.heroEligible, true, 'hero สุดท้าย crop-safe');
});

await test('post-brain (b): ไม่มีช่องอื่นถือ hero-safe แต่พูลมี BIG ว่าง → ดึงจากพูลเป็น hero', async () => {
  setPrefilter('1');
  const captures = { brainArgs: [], fetches: [] };
  // brain assign ครบทุกช่องด้วย filler (คนละคน) · BIG (hero-person, eligible) ไม่ถูก assign → ว่างในพูล
  const F4 = IMG('F4', { category: 'face-neutral', faceCount: 1 }, { realWidth: 1200, realHeight: 1600 }); // person null (คนละคน hero)
  const answer = { hero: { id: 'SMALL', reason: 'x', backups: [] }, reaction: { id: 'F4' }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [SMALL, BIG, F4, F1, F2, F3], answer, captures }) });
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'BIG', 'hero ดึง BIG จากพูล');
  assert.equal(pi.cropGuard.swapped, true);
  assert.equal(pi.cropGuard.violation, false);
  assert.ok((pi.slots.hero.backups || []).map(String).includes('SMALL'), 'SMALL เดิมตกไป backups');
});

await test('post-brain (c): ไม่มี hero-safe เลย → ปล่อยผ่านพร้อมธง cropGuardViolation (ไม่ fail งาน)', async () => {
  setPrefilter('1');
  const captures = { brainArgs: [], fetches: [] };
  // พูลมีแต่ SMALL (hero-person, ineligible) + filler คนละคน/ยืดเกิน → ไม่มี hero-safe คนเดียวกัน
  const SMALL2 = IMG('SMALL2', { person: 'ดวงเดือน', category: 'face-neutral' }, { realWidth: 700, realHeight: 900 }); // max(540/700,1350/900)=1.5 ineligible
  const answer = { hero: { id: 'SMALL', reason: 'x', backups: [] }, reaction: { id: 'SMALL2' }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [SMALL, SMALL2, F1, F2, F3], answer, captures }) });
  const pi = s6.dossierPatch.pickImages;
  assert.equal(s6.status !== 'failed', true, 'ไม่ fail งาน');
  assert.equal(pi.slots.hero.id, 'SMALL', 'hero คงเดิม (ไม่มีตัวเลือก)');
  assert.equal(pi.cropGuard.violation, true, 'ติดธง violation');
  assert.equal(pi.cropGuard.swapped, false);
});

await test('OFF byte-identical: MEGA_CROP_PREFILTER=0 → ไม่มีป้าย meta · ไม่มี cropGuard key · hero = brain pick (ไม่สลับ)', async () => {
  setPrefilter('0');
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'SMALL', reason: 'x', backups: [] }, reaction: { id: 'BIG', reason: 'x', backups: [] }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [SMALL, BIG, F1, F2, F3], answer, captures }) });
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'SMALL', 'OFF: hero = brain pick เดิม (ไม่สลับ)');
  assert.ok(!('cropGuard' in pi), 'OFF: ไม่มี cropGuard key ใน pickImages');
  for (const m of captures.brainArgs[0].imagesMeta) assert.ok(!('heroCropBlock' in m), 'OFF: meta ไม่มี heroCropBlock');
  setPrefilter(null);
});

console.log(`\n1..${passed}`);
