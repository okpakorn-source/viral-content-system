// ============================================================
// 🧪 MEGA_HERO_FRONTAL (21 ก.ค. 69) — hero ต้อง "เห็นเต็มหน้า" (faceFront=2) เท่านั้น
// ------------------------------------------------------------
// เคสจริง AC-0166: hero ได้ภาพมุมข้าง/ก้มหน้า (ร้องไห้ข้างรถ) ทั้งที่ทุกเกณฑ์เดิมผ่านหมด
// (หน้าเดี่ยว✓ ใหญ่ 30%✓ สะอาด✓ อารมณ์ตรง✓) — ระบบไม่มีสัญญาณ "มุมหน้า" เลยสักชั้น
// สายใหม่: ตาคัดตอบ faceFront 0-2 → triage เก็บ → สมอง+ด่านโค้ดเอา 2 เท่านั้น → ไม่มี = HOLD
// พิสูจน์:
//   ชั้นป้าย (buildTriage): (a) frontalOn:true + item มี faceFront → triage.faceFront ติดมา
//                           (b) item มี faceFront + ไม่ส่ง frontalOn → null (กัน mismatch แบบบั๊ก busyOn)
//                           (c) frontalOn:true + item ไม่มี faceFront → null (fail-closed)
//   ชั้นเลือก (s6_slots):   (d) OFF: hero มุมข้าง (faceFront=1) → ปล่อยผ่าน (บั๊กเดิม byte-parity)
//                           (e) ON + พูลมีเต็มหน้า → สลับเป็น faceFront=2
//                           (f) ON + ไม่มีเต็มหน้า → HOLD (insufficient_assets + heroFrontalHold)
//                           (g) ON + field ไม่มี (ภาพเก่า) → ไม่แตะ ไม่ HOLD (fail-open)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

for (const k of [
  'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_REF_SHOT_AUTHORITY', 'MEGA_SLOT_SOLVER_LIVE',
  'MEGA_REF_HERO_V2', 'MEGA_ROLE_READINESS', 'MEGA_FINAL_DECISION_EVIDENCE_V2', 'MEGA_CROSS_CASE_BORROW',
]) delete process.env[k];

const { buildTriage } = await import('@/lib/libraryTriage.js');
const { s6_slots } = await import('@/lib/megaAdapters');

// ── ชั้นป้าย ──
const evidence = Object.freeze({
  requestedModel: 'gemini-2.5-flash', actualModel: null, actualModelVersion: null,
  modelMatchMode: 'exact', provider: 'gemini', schemaVersion: 'gemini-classify-frames.v1',
  attemptCount: 1, repairCount: 0,
});
const triItem = (extra = {}) => ({
  index: 0, category: 'face-emotional', quality: 8, relevant: true, newsScene: true,
  person: 'ป๊อก', persons: ['ป๊อก'], emotion: 'sad', clean: true,
  faceCount: 1, faceBox: { x: 0.3, y: 0.1, w: 0.3, h: 0.35 }, peopleBox: null, note: 'ทดสอบ', ...extra,
});
const triSrc = { im: { id: 'IMG-1', source: 'google' }, realWidth: 1200, realHeight: 1500, measuredFrom: 'full' };
const triOpts = (extra = {}) => ({ strict: true, evidence, caseId: 'CASE-FRONTAL', batchIndex: 0, resultIndex: 0, fileTagOn: true, ...extra });

test('(a) ชั้นป้าย: frontalOn:true + item มี faceFront=1 → triage.faceFront=1 ติดมา', () => {
  const t = buildTriage(triItem({ faceFront: 1 }), triSrc, triOpts({ frontalOn: true }));
  assert.ok(t, 'ต้องได้ triage');
  assert.equal(t.faceFront, 1, 'ป้าย faceFront ต้องส่งต่อ');
});

test('(b) ชั้นป้าย: item มี faceFront + ไม่ส่ง frontalOn → null (กัน mismatch แบบบั๊ก busyOn)', () => {
  assert.equal(buildTriage(triItem({ faceFront: 2 }), triSrc, triOpts()), null);
});

test('(c) ชั้นป้าย: frontalOn:true + item ไม่มี faceFront → null (fail-closed คีย์ขาด)', () => {
  assert.equal(buildTriage(triItem(), triSrc, triOpts({ frontalOn: true })), null);
});

// ★ ความทนที่เทสสดแบตช์ 10 รูปจับได้ (21 ก.ค.): Gemini ตอบ null ได้ทั้ง faceFront (ภาพไม่มีคน) และ
//   newsScene (ตัดสินไม่ได้ — prompt มีคำ null ชักนำ) — บังคับ bool/int ล้วน = ใบเดียว null ล่มทั้งแบตช์
test('(c2) ชั้นป้าย: faceFront=null (ภาพไม่มีคน) → ผ่าน + triage.faceFront=null (fail-open ปลายทาง)', () => {
  const t = buildTriage(triItem({ faceFront: null }), triSrc, triOpts({ frontalOn: true }));
  assert.ok(t, 'null = ไม่รู้ ต้องไม่ล่มแบตช์');
  assert.equal(t.faceFront, null);
});

test('(c3) ชั้นป้าย: newsScene=null (ตาตัดสินไม่ได้) → ผ่าน ไม่ล่มแบตช์ (ความเปราะแฝงเดิม)', () => {
  const t = buildTriage(triItem({ newsScene: null, faceFront: 2 }), triSrc, triOpts({ frontalOn: true }));
  assert.ok(t, 'newsScene null ต้องไม่ reject');
  assert.equal(t.newsScene, null, 'เก็บ null ตรงๆ (consumer ใช้ !== false = ไม่ปฏิเสธ)');
});

// ── ชั้นเลือก ──
const HERO = 'เป็กกี้';
const withFrontal = async (on, fn) => {
  const prev = process.env.MEGA_HERO_FRONTAL;
  if (on) process.env.MEGA_HERO_FRONTAL = '1'; else delete process.env.MEGA_HERO_FRONTAL;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.MEGA_HERO_FRONTAL; else process.env.MEGA_HERO_FRONTAL = prev; }
};
const mkJob = () => ({
  dossier: {
    images: { caseId: 'CASE-HERO-FRONTAL' },
    compass: { angle: 'ทดสอบเต็มหน้า', primaryEmotion: 'sad', secondaryEmotions: [], mainCharacters: [{ name: HERO, role: 'hero' }], visualDreamShots: [], doNotUse: [] },
    desk: { title: 'ข่าวทดสอบ hero เต็มหน้า' },
    refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
    artBrief: { storyNote: 'ทดสอบ', orders: [] },
  },
});
const imgOf = (id, faceFront, extraTriage = {}) => ({
  id, imageUrl: `https://cdn.test/${id}.jpg`, realWidth: 1200, realHeight: 1500,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'sad', note: '', newsScene: true, quality: 8,
    faceBox: { x: 0.3, y: 0.1, w: 0.3, h: 0.35 },
    ...(faceFront != null ? { faceFront } : {}),
    ...extraTriage,
  },
});
const brainPicks = (img) => ({ slotDirectorBrain: async () => ({ slots: { hero: { id: img.id, reason: 'stub' } }, note: 'stub' }) });
const deps = (pool, brainImg) => ({ ...brainPicks(brainImg), fetchJson: async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected: ' + url); })()), findImagesByPerson: async () => [], checkUrlAlive: async () => true });

test('(d) OFF: hero มุมข้าง (faceFront=1) → ปล่อยผ่าน (บั๊กเดิม byte-parity)', async () => {
  await withFrontal(false, async () => {
    const side = imgOf('SIDE-1', 1);
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: deps([side, imgOf('FRONT-1', 2)], side) });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'SIDE-1', 'OFF: มุมข้างยังหลุด (เดิม)');
  });
});

test('(e) ON + พูลมีเต็มหน้า → สลับเป็น faceFront=2', async () => {
  await withFrontal(true, async () => {
    const side = imgOf('SIDE-1', 1);
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: deps([side, imgOf('FRONT-1', 2)], side) });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'FRONT-1', 'ON: ต้องสลับเป็นภาพเต็มหน้า');
  });
});

test('(f) ON + ไม่มีเต็มหน้า → HOLD (insufficient_assets + heroFrontalHold)', async () => {
  await withFrontal(true, async () => {
    const side = imgOf('SIDE-1', 1);
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: deps([side], side) });
    assert.equal(r.status, 'quality_hold');
    assert.equal(r.holdStatus, 'insufficient_assets');
    assert.equal(r.dossierPatch.pickImages.heroFrontalHold?.imageId, 'SIDE-1');
    assert.equal(r.dossierPatch.pickImages.heroFrontalHold?.faceFront, 1);
  });
});

test('(g) ON + field ไม่มี (ภาพเก่า) → ไม่แตะ ไม่ HOLD (fail-open)', async () => {
  await withFrontal(true, async () => {
    const legacy = imgOf('LEGACY-1', null);
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: deps([legacy], legacy) });
    assert.equal(r.status, 'done', 'field ไม่มี = ไม่ตัดสิน เดินต่อปกติ');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'LEGACY-1');
  });
});
