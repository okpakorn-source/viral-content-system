// ============================================================
// 💧 MEGA_WATERMARK_GUARD — C3 (29 ก.ค. 69, แบตช์ C "ด่านลายน้ำ") — s6_slots (megaAdapters.js)
// ------------------------------------------------------------
// C3: meta ภาพที่ url มาจากโดเมนที่มักมีลายน้ำ (blogspot/pantip/เว็บสะสมรูป) → แปะป้าย soft
//   m.watermarkSourceAvoid = "แหล่งมักมีลายน้ำ — เลือกเมื่อไม่มีทางอื่น" (แพทเทิร์นเดียวกับ heroSourceAvoid ที่มีอยู่
//   แล้ว — ไม่ hard block, แค่คำแนะนำให้สมอง LLM เห็นใน JSON row) — เดียวกับ MEGA_WATERMARK_GUARD ของ C1/C2
// ใช้ harness เดียวกับ tests/mega-rules-v3-hero-source.test.mjs (s6_slots + stub slotDirectorBrain จับ imagesMeta)
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
  'MEGA_CROP_PREFILTER',
]) delete process.env[k];

const { s6_slots } = await import('@/lib/megaAdapters');

const withEnv = async (name, v, fn) => {
  const prev = process.env[name];
  if (v == null) delete process.env[name]; else process.env[name] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; }
};

function mkJob() {
  return {
    dossier: {
      images: { caseId: 'CASE-WMGUARD-C3' },
      compass: {
        angle: 'มุมทดสอบแหล่งลายน้ำ', primaryEmotion: 'neutral', secondaryEmotions: [],
        mainCharacters: [{ name: 'ทดสอบ', role: 'hero' }], visualDreamShots: [], doNotUse: [],
      },
      desk: { title: 'ข่าวทดสอบป้ายแหล่งลายน้ำ' },
      refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
      artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
    },
  };
}

const fetchStub = (pool) => async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected fetch: ' + url); })());

const BLOGSPOT_IMG = {
  id: 'BLOG-1', imageUrl: 'https://someuser.blogspot.com/img/photo1.jpg', platform: 'web',
  triage: { relevant: true, clean: true, faceCount: 1, person: 'ทดสอบ', persons: ['ทดสอบ'], category: 'face-emotional', note: '', newsScene: true, quality: 7 },
};
const PANTIP_IMG = {
  id: 'PANTIP-1', imageUrl: 'https://pantip.com/topic/12345/photo.jpg', platform: 'web',
  triage: { relevant: true, clean: true, faceCount: 1, person: 'ทดสอบ', persons: ['ทดสอบ'], category: 'context', note: '', newsScene: true, quality: 7 },
};
const PRESS_IMG = {
  id: 'PRESS-1', imageUrl: 'https://thairath.co.th/content/photo.jpg', platform: 'press',
  triage: { relevant: true, clean: true, faceCount: 1, person: 'ทดสอบ', persons: ['ทดสอบ'], category: 'context', note: '', newsScene: true, quality: 8 },
};

test('C3-1: default (MEGA_WATERMARK_GUARD ไม่ตั้ง) — ภาพจาก blogspot/pantip ได้ป้าย watermarkSourceAvoid, ภาพ press ไม่ได้ป้าย', async () => {
  await withEnv('MEGA_WATERMARK_GUARD', null, async () => {
    let capturedMeta = null;
    const brain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'PRESS-1' } }, note: 'stub' }; } };
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([BLOGSPOT_IMG, PANTIP_IMG, PRESS_IMG]) } });
    assert.equal(r.status, 'done');
    const blog = capturedMeta.find((m) => m.id === 'BLOG-1');
    const pantip = capturedMeta.find((m) => m.id === 'PANTIP-1');
    const press = capturedMeta.find((m) => m.id === 'PRESS-1');
    assert.equal(blog.watermarkSourceAvoid, 'แหล่งมักมีลายน้ำ — เลือกเมื่อไม่มีทางอื่น', 'blogspot ต้องได้ป้าย');
    assert.equal(pantip.watermarkSourceAvoid, 'แหล่งมักมีลายน้ำ — เลือกเมื่อไม่มีทางอื่น', 'pantip ต้องได้ป้ายเดียวกัน');
    assert.ok(!press.watermarkSourceAvoid, 'ภาพข่าว press ต้องไม่ได้ป้ายนี้เลย');
  });
});

test('C3-2: MEGA_WATERMARK_GUARD=0 → ไม่มีป้ายเลยแม้ url มาจาก blogspot/pantip จริง (ปิดทั้งชุด C1/C2/C3 ด้วยสวิตช์เดียว)', async () => {
  await withEnv('MEGA_WATERMARK_GUARD', '0', async () => {
    let capturedMeta = null;
    const brain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'PRESS-1' } }, note: 'stub' }; } };
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([BLOGSPOT_IMG, PANTIP_IMG, PRESS_IMG]) } });
    assert.equal(r.status, 'done');
    const blog = capturedMeta.find((m) => m.id === 'BLOG-1');
    assert.ok(!blog.watermarkSourceAvoid, 'ปิด flag ต้องไม่มีป้ายเลย');
  });
});

test('C3-3: ไม่ hard-block — พูลมีแต่ blogspot/pantip (ไม่มีทางเลือก press) ยังเลือกใช้ได้ตามเดิม (แค่มีป้ายติดมาด้วย)', async () => {
  await withEnv('MEGA_WATERMARK_GUARD', null, async () => {
    let capturedMeta = null;
    const brain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'BLOG-1' } }, note: 'stub' }; } };
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([BLOGSPOT_IMG, PANTIP_IMG]) } });
    assert.equal(r.status, 'done', 'ต้องยังสำเร็จได้ปกติ — ป้ายเป็นแค่คำแนะนำ ไม่ใช่ hard block');
    const blog = capturedMeta.find((m) => m.id === 'BLOG-1');
    assert.ok(blog.watermarkSourceAvoid, 'ยังมีป้ายติดมาด้วยแม้จะถูกเลือกใช้จริง');
  });
});

test('C3-4: URL ปกติที่ไม่ตรงโดเมนใดในรายชื่อ (thairath/kapook) → ไม่ได้ป้าย', async () => {
  await withEnv('MEGA_WATERMARK_GUARD', null, async () => {
    let capturedMeta = null;
    const brain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'PRESS-1' } }, note: 'stub' }; } };
    await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([PRESS_IMG]) } });
    const press = capturedMeta.find((m) => m.id === 'PRESS-1');
    assert.ok(!press.watermarkSourceAvoid);
  });
});
