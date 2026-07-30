// ============================================================
// crop-guard.test.mjs — เลน A · P1 ด่านครอป + P3 หักคะแนนหน้าชิดขอบ "ก่อนเลือกรูป"
//   (1) computeCropGuard PURE — สูตร cover-fit upscale / heroEligible fail-closed / edgePenalty
//       + TIER2 options (heroUpscaleMax override / heroDimsSoft) — PURE เหมือนเดิม ไม่อ่าน env ในไฟล์นี้
//   (2) s6_slots wiring — pre-brain ป้าย meta · post-brain hard swap · violation flag · OFF byte-identical
//       + TIER2: เพดานยืด default ใหม่ 1.35 (override/clamp ผ่าน MEGA_HERO_UPSCALE_MAX) · dims-soft default ON
//       (kill MEGA_HERO_DIMS_SOFT=0) · candidate-filter/ranking กัน dims-unknown แซง measured ตอนสลับอัตโนมัติ ·
//       สวิตช์แม่ MEGA_TIER2_OFF=1
//   ★ ปักหมุด 11 เทสเดิม (ก่อน TIER2) ด้วย MEGA_HERO_UPSCALE_MAX=1.2 + MEGA_HERO_DIMS_SOFT=0 = พฤติกรรมเดิมเป๊ะ
//   ไม่ยิง LLM/network/store จริง (loader stubs + injected fakes) · deterministic ล้วน
// ============================================================
import assert from 'node:assert/strict';
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
process.env.MEGA_HERO_MIN_SOURCE = '0'; // isolate cropGuard เดิม; AC-0232 gate มี integration/kill-switch tests แยก
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

// ── ช่อง hero ของ DNA ทดสอบ = 'main' 540×1350 (จำลอง DNA ปกจริงแบบมินิมอล ฝัง "ในเทสเอง" — 27 ก.ค. 69
//   หลังตรวจพบว่า data/ref-cover-library.json เป็นไฟล์ live ที่แก้ไปมา ใบอ้างอิงเดิม REF-mrbqalpo-h1r1 หาย
//   ไปแล้วจากคลังจริง ทำให้เทสนี้ throw ที่ module top-level ก่อนรันเทสข้อไหนเลยด้วยซ้ำ — ฝัง DNA ขั้นต่ำที่นี่
//   กันเทสพังเพราะข้อมูล production เปลี่ยน ไม่ใช่เพราะโค้ด cropGuard/megaAdapters พัง) ──
//   layout: ซ้ายเต็มสูง (hero, 50%×100%) + บนขวา/ล่างขวา (2 ช่องรอง) = ครบเงื่อนไข dnaToTemplateSpec
//   (rects≥2, slots≥3) พอดี — คำนวณจริงผ่าน dnaToTemplateSpec (ไม่ hardcode พิกัด px เอง)
const DNA = {
  layoutType: 'fixture-hero-left-half',
  template: {
    slots: [
      { role: 'hero', pos: 'ซ้ายเต็มสูง', xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
      { role: 'context', pos: 'บนขวา', xPct: 50, yPct: 0, wPct: 50, hPct: 50 },
      { role: 'action', pos: 'ล่างขวา', xPct: 50, yPct: 50, wPct: 50, hPct: 50 },
    ],
  },
};
const SPEC = dnaToTemplateSpec(DNA);
const HERO = SPEC?.slots?.find((s) => s.id === 'main');
assert.ok(HERO && HERO.w === 540 && HERO.h === 1350, `hero slot 540×1350 (ได้ ${HERO?.w}×${HERO?.h})`);

// ═══════════════════════ (1) computeCropGuard — PURE UNIT ═══════════════════════

await test('upscale: ภาพใหญ่ (1200×1600) heroEligible=true · cover-fit = 0.844', async () => {
  const g = computeCropGuard({ pool: [{ id: 'BIG', realWidth: 1200, realHeight: 1600 }], templateSpec: SPEC });
  const r = g.byId.get('BIG');
  assert.equal(r.hasRealDims, true);
  assert.ok(Math.abs(r.heroUpscale - Math.max(540 / 1200, 1350 / 1600)) < 1e-9, 'heroUpscale cover-fit ถูก');
  assert.equal(r.heroEligible, true);
});

await test('upscale: ภาพเล็ก (800×1000) heroEligible=false (default params) · ยืด 1.35× เกิน 1.2×', async () => {
  // ★ ไม่ส่ง heroUpscaleMax/heroDimsSoft → คงพฤติกรรม "เดิมก่อน TIER2" เป๊ะ (default ภายในฟังก์ชัน = HERO_UPSCALE_MAX 1.2 / hard-ban)
  const g = computeCropGuard({ pool: [{ id: 'SMALL', realWidth: 800, realHeight: 1000 }], templateSpec: SPEC });
  const r = g.byId.get('SMALL');
  assert.ok(Math.abs(r.heroUpscale - 1.35) < 1e-9, `heroUpscale=1.35 (ได้ ${r.heroUpscale})`);
  assert.ok(r.heroUpscale > HERO_UPSCALE_MAX, 'เกินเพดาน hero (ค่าคงที่เดิม 1.2 — ยังผูกกับ renderer)');
  assert.equal(r.heroEligible, false);
  // 800×1000 ยัง fit ช่องรอง (540×446 → max(0.675,0.446)=0.675 ≤ 1.6)
  assert.equal(r.slotEligible, true);
});

await test('fail-closed: ไม่มี realWidth/realHeight → hasRealDims=false · heroEligible=false (default params)', async () => {
  const g = computeCropGuard({ pool: [
    { id: 'NODIM' },                                  // ไม่มี dims เลย
    { id: 'SHORTONLY', triage: { realShortSide: 900 } }, // มีแค่ short side (ไม่รู้ aspect)
    { id: 'ZERO', realWidth: 0, realHeight: 1000 },      // 0 = ไม่ valid
  ], templateSpec: SPEC });
  for (const id of ['NODIM', 'SHORTONLY', 'ZERO']) {
    const r = g.byId.get(id);
    assert.equal(r.hasRealDims, false, `${id} hasRealDims=false`);
    assert.equal(r.heroEligible, false, `${id} heroEligible=false (fail-closed default)`);
    assert.equal(r.heroUpscale, HERO ? r.heroUpscale : null); // heroUpscale=null เพราะ dims=null
    assert.equal(r.heroUpscale, null);
  }
});

await test('dimension authority: realShortSide fallback is opt-in; default remains legacy dims-unknown', async () => {
  const input = {
    pool: [{
      id: 'SHORT-ASPECT',
      width: 800,
      height: 1000,
      triage: { realShortSide: 900 },
    }],
    templateSpec: SPEC,
  };
  const legacy = computeCropGuard(input).byId.get('SHORT-ASPECT');
  assert.equal(legacy.hasRealDims, false);
  assert.equal(legacy.realWidth, null);
  assert.equal(legacy.realHeight, null);
  assert.equal(legacy.heroUpscale, null);

  const r = computeCropGuard({ ...input, dimsFromShortSide: true }).byId.get('SHORT-ASPECT');
  assert.equal(r.hasRealDims, true);
  assert.equal(r.realWidth, 900);
  assert.equal(r.realHeight, 1125);
  assert.ok(Math.abs(r.heroUpscale - 1.2) < 1e-9);
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

// ── TIER2: options ใหม่ (heroUpscaleMax override / heroDimsSoft) — ยังคง PURE (ส่งผ่าน input เท่านั้น) ──

await test('TIER2 options: heroUpscaleMax override = 1.35 → SMALL (ยืด 1.35× พอดี) กลายเป็น eligible', async () => {
  const g = computeCropGuard({ pool: [{ id: 'SMALL', realWidth: 800, realHeight: 1000 }], templateSpec: SPEC, heroUpscaleMax: 1.35 });
  const r = g.byId.get('SMALL');
  assert.ok(Math.abs(r.heroUpscale - 1.35) < 1e-9);
  assert.equal(r.heroEligible, true, 'ยืด 1.35× ผ่านเพดานที่ระบุ 1.35 พอดี (<=)');
});

await test('TIER2 options: heroDimsSoft=true → วัดขนาดไม่ได้ กลายเป็น eligible (ไม่ hard-ban)', async () => {
  const g = computeCropGuard({ pool: [{ id: 'NODIM' }], templateSpec: SPEC, heroDimsSoft: true });
  const r = g.byId.get('NODIM');
  assert.equal(r.hasRealDims, false);
  assert.equal(r.heroEligible, true, 'soft mode: วัดไม่ได้ไม่ hard-ban อีกต่อไป');
});

await test('TIER2 options: heroDimsSoft=false (หรือไม่ระบุ) → วัดขนาดไม่ได้ ยัง hard-ban เหมือนเดิมทั้งคู่', async () => {
  const g1 = computeCropGuard({ pool: [{ id: 'NODIM' }], templateSpec: SPEC, heroDimsSoft: false });
  assert.equal(g1.byId.get('NODIM').heroEligible, false);
  const g2 = computeCropGuard({ pool: [{ id: 'NODIM' }], templateSpec: SPEC }); // ไม่ระบุเลย = default เดิม
  assert.equal(g2.byId.get('NODIM').heroEligible, false);
});

await test('TIER2 options: วัดขนาดได้แต่ยืดเกินเพดานที่ระบุ → ยัง hard-ban ทั้งสองโหมด dims (คนละเงื่อนไขกัน)', async () => {
  const gSoft = computeCropGuard({ pool: [{ id: 'SMALL', realWidth: 800, realHeight: 1000 }], templateSpec: SPEC, heroUpscaleMax: 1.2, heroDimsSoft: true });
  assert.equal(gSoft.byId.get('SMALL').heroEligible, false, 'ยืด 1.35× เกินเพดาน 1.2 ที่ระบุ → hard-ban แม้ dims-soft on (dims-soft คุมแค่ "วัดไม่ได้" ไม่คุม "วัดได้แต่ยืดเกิน")');
});

await test('TIER2 options: computeCropGuard คืน heroUpscaleMax/heroDimsSoft ที่ใช้จริงกลับมาด้วย (ให้ caller log ตรงกัน)', async () => {
  const g = computeCropGuard({ pool: [], templateSpec: SPEC, heroUpscaleMax: 1.4, heroDimsSoft: true });
  assert.equal(g.heroUpscaleMax, 1.4);
  assert.equal(g.heroDimsSoft, true);
  const gDefault = computeCropGuard({ pool: [], templateSpec: SPEC });
  assert.equal(gDefault.heroUpscaleMax, HERO_UPSCALE_MAX);
  assert.equal(gDefault.heroDimsSoft, false);
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
// ★ TIER2: ปักหมุดเพดาน/โหมด dims ให้เท่าพฤติกรรม "เดิมก่อน TIER2" — ใช้ในเทส 11 ข้อเดิมด้านล่างทั้งหมด
const setHeroCap = (v) => { if (v === null) delete process.env.MEGA_HERO_UPSCALE_MAX; else process.env.MEGA_HERO_UPSCALE_MAX = v; };
const setDimsSoft = (v) => { if (v === null) delete process.env.MEGA_HERO_DIMS_SOFT; else process.env.MEGA_HERO_DIMS_SOFT = v; };
const setTier2Off = (v) => { if (v === null) delete process.env.MEGA_TIER2_OFF; else process.env.MEGA_TIER2_OFF = v; };

// hero person ดวงเดือน · SMALL=ยืด 1.35× (ineligible เมื่อเพดานปักหมุด 1.2 — ดูโค้ดแต่ละเทส) · BIG=0.844× (eligible เสมอ)
const SMALL = IMG('SMALL', { person: 'ดวงเดือน', category: 'face-emotional' }, { realWidth: 800, realHeight: 1000 });
const BIG = IMG('BIG', { person: 'ดวงเดือน', category: 'face-neutral' }, { realWidth: 1200, realHeight: 1600 });
const F1 = IMG('F1', { category: 'context', faceCount: 0 }, { realWidth: 1200, realHeight: 900 });
const F2 = IMG('F2', { category: 'action', faceCount: 0 }, { realWidth: 1200, realHeight: 900 });
const F3 = IMG('F3', { category: 'context', faceCount: 0 }, { realWidth: 1200, realHeight: 900 });

// ★ ปักหมุด 11 ข้อเดิม (ก่อน TIER2): MEGA_HERO_UPSCALE_MAX=1.2 + MEGA_HERO_DIMS_SOFT=0 = พฤติกรรมเดิม byte-identical
//   (เพดานเดิม 1.2 ผูกกับ HERO_UPSCALE_MAX ในไฟล์ cropGuard.js · dims-unknown hard-ban เหมือนก่อนมี TIER2)
//   ไม่ปักหมุดแบบนี้ → SMALL (1.35×) จะผ่านเพดาน default ใหม่ 1.35 พอดี ทำให้ 4 เทสด้านล่างพัง (ตามที่ตรวจพบ)

await test('pre-brain: meta ติดป้าย heroCropBlock เฉพาะรูปที่ heroEligible=false (SMALL) — สมองเห็น', async () => {
  setPrefilter('1'); setHeroCap('1.2'); setDimsSoft('0');
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
  setPrefilter('1'); setHeroCap('1.2'); setDimsSoft('0');
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
  setPrefilter('1'); setHeroCap('1.2'); setDimsSoft('0');
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
  setPrefilter('1'); setHeroCap('1.2'); setDimsSoft('0');
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
  setPrefilter('0'); setHeroCap('1.2'); setDimsSoft('0');
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'SMALL', reason: 'x', backups: [] }, reaction: { id: 'BIG', reason: 'x', backups: [] }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [SMALL, BIG, F1, F2, F3], answer, captures }) });
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'SMALL', 'OFF: hero = brain pick เดิม (ไม่สลับ)');
  assert.ok(!('cropGuard' in pi), 'OFF: ไม่มี cropGuard key ใน pickImages');
  for (const m of captures.brainArgs[0].imagesMeta) assert.ok(!('heroCropBlock' in m), 'OFF: meta ไม่มี heroCropBlock');
  setPrefilter(null); setHeroCap(null); setDimsSoft(null);
});

// ═══════════════════════ (3) TIER2 — default ใหม่ / dims-soft / clamp / สวิตช์แม่ / candidate-rank ═══════════════════════

await test('TIER2 default (ไม่ตั้ง env ใดๆ): เพดานยืด=1.35 → SMALL (1.35×) เป็น hero-eligible ไม่มีป้ายห้าม', async () => {
  setPrefilter('1'); setHeroCap(null); setDimsSoft(null);
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'SMALL', reason: 'x', backups: [] }, reaction: { id: 'BIG', reason: 'x', backups: [] }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [SMALL, BIG, F1, F2, F3], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  const mSmall = meta.find((m) => m.id === 'SMALL');
  assert.ok(!('heroCropBlock' in mSmall), 'default 1.35× → SMALL ไม่ติดป้ายห้าม hero อีกต่อไป');
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'SMALL', 'default: hero คงเป็น SMALL (ไม่ต้องสลับ เพราะ eligible แล้ว)');
  assert.equal(pi.cropGuard.swapped, false);
  assert.equal(pi.cropGuard.heroEligible, true);
});

await test('TIER2 dims-soft (default ON): วัดขนาดไม่ได้ → ป้าย soft heroDimsAvoid (ไม่ใช่ heroCropBlock) + ไม่ถูกสลับออกถ้าสมองเลือกเป็น hero', async () => {
  setPrefilter('1'); setHeroCap(null); setDimsSoft(null);
  const UNKNOWN = IMG('UNKNOWN', { person: 'ดวงเดือน', category: 'face-neutral' }, { realWidth: undefined, realHeight: undefined });
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'UNKNOWN', reason: 'x', backups: [] }, reaction: { id: 'BIG', reason: 'x', backups: [] }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [UNKNOWN, BIG, F1, F2, F3], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  const mUnknown = meta.find((m) => m.id === 'UNKNOWN');
  assert.ok(!('heroCropBlock' in mUnknown), 'soft mode: ไม่มีป้ายห้ามแข็ง');
  // ★ ข้อ 6 (27 ก.ค. 69 — งบ prompt IMG_META_BUDGET): ย่อป้ายจาก "เลี่ยงเป็น hero: วัดขนาดจริงไม่ได้ (เลือกได้เมื่อ...)"
  //   เหลือ "เลี่ยง hero: วัดขนาดไม่ได้" (ใจความเดิม สั้นลงกันงบ prompt บวม) — เช็คคำที่ยังต้องอยู่แน่ๆ แทน exact string เดิม
  assert.ok(mUnknown.heroDimsAvoid && /เลี่ยง/.test(mUnknown.heroDimsAvoid) && /hero/.test(mUnknown.heroDimsAvoid) && /วัดขนาด/.test(mUnknown.heroDimsAvoid), `soft mode: มีป้ายแนะนำ (soft) แทน (ได้ "${mUnknown.heroDimsAvoid}")`);
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'UNKNOWN', 'post-brain ไม่สลับ UNKNOWN ออก (heroEligible=true ในโหมด soft — ห้าม post-brain วนเตะใบที่สมองเพิ่งเลือก)');
  assert.equal(pi.cropGuard.swapped, false);
  assert.equal(pi.cropGuard.violation, false);
  assert.equal(pi.cropGuard.heroEligible, true);
});

await test('TIER2 kill-switch: MEGA_HERO_DIMS_SOFT=0 → วัดขนาดไม่ได้กลับเป็น hard-ban (เดิมเป๊ะ) + ถูกสลับออกถ้าสมองเลือกเป็น hero', async () => {
  setPrefilter('1'); setHeroCap(null); setDimsSoft('0');
  const UNKNOWN = IMG('UNKNOWN', { person: 'ดวงเดือน', category: 'face-neutral' }, { realWidth: undefined, realHeight: undefined });
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'UNKNOWN', reason: 'x', backups: [] }, reaction: { id: 'BIG', reason: 'x', backups: [] }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [UNKNOWN, BIG, F1, F2, F3], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  const mUnknown = meta.find((m) => m.id === 'UNKNOWN');
  assert.ok(mUnknown.heroCropBlock && /วัดขนาดจริงไม่ได้/.test(mUnknown.heroCropBlock), 'hard mode: ป้ายห้ามแข็งกลับมา');
  assert.ok(!('heroDimsAvoid' in mUnknown), 'hard mode: ไม่มีป้าย soft (คนละโหมดกัน)');
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'BIG', 'hard mode: สลับ hero ออกจาก UNKNOWN ไปเป็น BIG (crop-safe)');
  assert.equal(pi.cropGuard.swapped, true);
  setDimsSoft(null);
});

await test('TIER2 clamp: MEGA_HERO_UPSCALE_MAX="10" (เกินเพดานปลอดภัย 1.6) → clamp เหลือ 1.6 จริง (พิสูจน์ด้วยภาพยืด 2.0×)', async () => {
  setPrefilter('1'); setHeroCap('10'); setDimsSoft(null);
  // TOOBIG ยืด max(540/270,1350/675) = 2.0× — ถ้า clamp ไม่ทำงาน (ใช้ 10 ตรงๆ) จะ eligible ไม่มีป้าย
  const TOOBIG = IMG('TOOBIG', { person: 'ดวงเดือน', category: 'face-neutral' }, { realWidth: 270, realHeight: 675 });
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'TOOBIG', reason: 'x', backups: [] }, reaction: { id: 'BIG', reason: 'x', backups: [] }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [TOOBIG, BIG, F1, F2, F3], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  const mToobig = meta.find((m) => m.id === 'TOOBIG');
  assert.ok(mToobig.heroCropBlock, 'ต้องมีป้ายห้าม (พิสูจน์ clamp เหลือ 1.6 จริง — ถ้าใช้ "10" ตรงๆ 2.0× จะผ่านสบายๆ ไม่มีป้าย)');
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'BIG', 'สลับออกจาก TOOBIG ไปเป็น BIG (crop-safe) — ยืนยัน clamp มีผลจริงถึงชั้น post-brain ด้วย');
  setHeroCap(null);
});

await test('สวิตช์แม่ MEGA_TIER2_OFF=1: เพดานกลับ 1.2 ตรงๆ + dims กลับ hard — ชนะ env อื่นที่ตั้งสวนทางไว้เสมอ', async () => {
  setPrefilter('1');
  setHeroCap('1.35'); setDimsSoft('1'); // ตั้งสวนทางตั้งใจ — TIER2_OFF ต้องชนะทุกอัน
  setTier2Off('1');
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'SMALL', reason: 'x', backups: [] }, reaction: { id: 'BIG', reason: 'x', backups: [] }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [SMALL, BIG, F1, F2, F3], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  const mSmall = meta.find((m) => m.id === 'SMALL');
  assert.ok(mSmall.heroCropBlock, 'TIER2_OFF=1: SMALL (1.35×) ต้องกลับมาโดนแบน (เพดานจริง=1.2 ไม่ใช่ 1.35 ที่ตั้งสวนทางไว้)');
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, 'BIG', 'สลับออกจาก SMALL (เหมือนพฤติกรรมเดิมก่อน TIER2 ทุกกรณี)');
  setTier2Off(null); setHeroCap(null); setDimsSoft(null);
});

await test('TIER2 candidate-rank (post-brain reselect): dims-unknown ห้ามแซง measured แม้ edgePenalty เป็นกลาง 0', async () => {
  // hero ที่สมองเลือก = TOOBIG2 (2.0×) ไม่ผ่านแม้เพดาน default 1.35 → เข้า branch (b) reselect-from-pool
  // ช่องอื่นเป็นคนละคน (identity ไม่ตรง) → บังคับให้ไม่มี swap-in-plan (a) เหลือแต่ผู้สมัครในพูลที่ไม่ถูกใช้
  //   • UNKNOWN_CAND: hasRealDims=false → eligible=true ในโหมด soft (default) แต่ไม่มี faceBox → edgePenalty=0 (เป็นกลาง)
  //   • MEASURED_CAND: hasRealDims=true, วัดได้จริง+ผ่านเพดาน (0.844×) แต่มี faceBox ใกล้มุม → edgePenalty>0
  //   ก่อนแก้บั๊ก: จัดอันดับด้วย edgePenalty ก่อนเสมอ → UNKNOWN_CAND (0) จะ "ชนะ" MEASURED_CAND (>0) ผิดที่ผิดทาง
  //   หลังแก้: ต้อง "วัดขนาดได้จริง" มาก่อนเสมอ (ทั้ง candidate filter + _cgRank) → ต้องได้ MEASURED_CAND เท่านั้น
  setPrefilter('1'); setHeroCap(null); setDimsSoft(null); // default: cap 1.35 / soft ON
  const TOOBIG2 = IMG('TOOBIG2', { person: 'ดวงเดือน', category: 'face-neutral' }, { realWidth: 270, realHeight: 675 }); // 2.0× ไม่ผ่านแม้ default 1.35
  const FA = IMG('FA', { category: 'context', faceCount: 0 }, { realWidth: 1200, realHeight: 900 }); // คนละคน (person null)
  const FB = IMG('FB', { category: 'action', faceCount: 0 }, { realWidth: 1200, realHeight: 900 });
  const FC = IMG('FC', { category: 'context', faceCount: 0 }, { realWidth: 1200, realHeight: 900 });
  const FD = IMG('FD', { category: 'context', faceCount: 0 }, { realWidth: 1200, realHeight: 900 });
  const UNKNOWN_CAND = IMG('UNKNOWN_CAND', { person: 'ดวงเดือน', category: 'face-neutral' }, { realWidth: undefined, realHeight: undefined });
  const MEASURED_CAND = IMG('MEASURED_CAND', { person: 'ดวงเดือน', category: 'face-neutral', faceBox: { x1: 0.05, y1: 0.05, x2: 0.35, y2: 0.35 } }, { realWidth: 1200, realHeight: 1600 });
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'TOOBIG2', reason: 'x', backups: [] }, reaction: { id: 'FA' }, action: { id: 'FB' }, context: { id: 'FC' }, circle: { id: 'FD' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [TOOBIG2, FA, FB, FC, FD, UNKNOWN_CAND, MEASURED_CAND], answer, captures }) });
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.cropGuard.swapped, true, 'ต้องสลับ hero ออกจาก TOOBIG2 (ไม่ผ่านเพดานแม้ default)');
  assert.equal(pi.slots.hero.id, 'MEASURED_CAND', 'ต้องได้ MEASURED_CAND (วัดขนาดได้จริง) — ห้ามได้ UNKNOWN_CAND (วัดไม่ได้ แม้ edgePenalty เป็นกลาง 0)');
});

await test('F8 probe E: MEGA_HERO_MIN_SOURCE=0 keeps realShortSide-only row on legacy soft label and hero pick', async () => {
  setPrefilter('1'); setHeroCap(null); setDimsSoft(null);
  const SHORT_ASPECT = IMG(
    'SHORT-ASPECT-HERO',
    { person: 'ดวงเดือน', category: 'face-neutral', realShortSide: 400 },
    { width: 1600, height: 900, realWidth: undefined, realHeight: undefined },
  );
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'SHORT-ASPECT-HERO', reason: 'x', backups: [] }, reaction: { id: 'BIG' }, action: { id: 'F1' }, context: { id: 'F2' }, circle: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [SHORT_ASPECT, BIG, F1, F2, F3], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta.find((m) => m.id === SHORT_ASPECT.id);
  assert.ok(meta.heroDimsAvoid && /เลี่ยง/.test(meta.heroDimsAvoid), 'OFF: ต้องคงป้าย soft แบบ origin/main');
  assert.equal('heroCropBlock' in meta, false, 'OFF: ห้ามตี realShortSide-only เป็นขนาดจริงแล้ว hard-ban');
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, SHORT_ASPECT.id, 'OFF: hero ต้องคง brain pick แบบ origin/main');
  assert.equal(pi.cropGuard.swapped, false);
  assert.equal(pi.cropGuard.heroEligible, true);
});

await test('F8 probe G: MEGA_HERO_MIN_SOURCE=0 keeps realShortSide-only candidate out of automatic reselection', async () => {
  setPrefilter('1'); setHeroCap(null); setDimsSoft(null);
  const BLOCKED = IMG('BLOCKED-HERO', { person: 'ดวงเดือน', category: 'face-neutral' }, { realWidth: 270, realHeight: 675 });
  const UNKNOWN_CAND = IMG(
    'SHORT-ASPECT-CAND',
    { person: 'ดวงเดือน', category: 'face-neutral', realShortSide: 1200 },
    { width: 1600, height: 900, realWidth: undefined, realHeight: undefined },
  );
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: BLOCKED.id, reason: 'x', backups: [] }, reaction: { id: 'F1' }, action: { id: 'F2' }, context: { id: 'F3' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [BLOCKED, F1, F2, F3, UNKNOWN_CAND], answer, captures }) });
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.hero.id, BLOCKED.id, 'OFF: dims-unknown candidate must not replace the blocked hero');
  assert.equal(pi.cropGuard.swapped, false);
  assert.equal(pi.cropGuard.violation, true);
});

console.log(`\n1..${passed}`);
