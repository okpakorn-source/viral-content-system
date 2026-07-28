// ============================================================
// 🧪 MEGA_RULES_V3 — เลน megaAdapters.js: ป้าย heroSourceAvoid + ส่ง rulesV3On เข้า brain
// ------------------------------------------------------------
// เคส 28 ก.ค. 69 — เจ้าของสั่ง: "กติกาเก่าที่เป็นตัวถ่วงกติกาใหม่ ให้ลบ/เขียนใหม่ได้ เพราะของใหม่พิสูจน์จากงานจริง
// 478 ใบ" — ป้ายเดิม "เลี่ยงเป็น hero: เฟรมคลิป (คุณภาพต่ำ/เบลอ...)" ขัดคัมภีร์ v3 ก.5 ตรงๆ ("ภาพดิบจากคลิป/CCTV/
// เซลฟี่ใช้เป็น hero ได้ — ความดิบ = ความจริง — ขอแค่แสงเห็นหน้า และไม่มีภาพ press ที่หน้าชัดกว่าให้ใช้")
// พิสูจน์:
//   (1) default (ไม่ตั้ง MEGA_RULES_V3) → ป้ายข้อความกลางแบบ v3 (ถอดคำว่า "เลี่ยง")
//   (2) MEGA_RULES_V3=0 → ป้ายข้อความเดิมทุก byte (rollback)
//   (3) MEGA_HERO_SOURCE_POLICY=0 → ไม่มีป้ายเลยไม่ว่า MEGA_RULES_V3 จะเป็นอะไร (สวิตช์แม่เดิมยังคุมอยู่)
//   (4) rulesV3On ถูกส่งเข้า slotDirectorBrain จริง (ตรงกับ env MEGA_RULES_V3)
// ไม่ยิง LLM/network จริง (fetchJson stub คืน pool ปลอม + slotDirectorBrain stub จับ args) deterministic ล้วน
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

// ล้าง shadow switches ที่อาจเปลี่ยนเส้นทางไปสาย semantic/solver/ref-hero-v2 (เดินสาย legacy ล้วน)
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
      images: { caseId: 'CASE-RULESV3-HEROSRC' },
      compass: {
        angle: 'มุมทดสอบ hero source', primaryEmotion: 'neutral', secondaryEmotions: [],
        mainCharacters: [{ name: 'ทดสอบ', role: 'hero' }], visualDreamShots: [], doNotUse: [],
      },
      desk: { title: 'ข่าวทดสอบป้าย hero source' },
      // typeMatched:false → ไม่มี semContract → เดินสาย legacy ล้วน (ไม่ต้องมี refDNA/crop-guard)
      refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
      artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
    },
  };
}

const fetchStub = (pool) => async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected fetch: ' + url); })());

const CLIP_IMG = {
  id: 'CLIP-1', imageUrl: 'https://cdn.test/CLIP-1.jpg', platform: 'clip',
  triage: { relevant: true, clean: true, faceCount: 1, person: 'ทดสอบ', persons: ['ทดสอบ'], category: 'face-emotional', note: '', newsScene: true, quality: 8 },
};
const PRESS_IMG = {
  id: 'PRESS-1', imageUrl: 'https://cdn.test/PRESS-1.jpg', platform: 'press',
  triage: { relevant: true, clean: true, faceCount: 1, person: 'ทดสอบ', persons: ['ทดสอบ'], category: 'context', note: '', newsScene: true, quality: 7 },
};

const OLD_LABEL = 'เลี่ยงเป็น hero: เฟรมคลิป (คุณภาพต่ำ/เบลอ — ใช้ภาพข่าว press เป็น hero ถ้ามีทางเลือก)';
const NEW_LABEL = 'hero จากเฟรมคลิป/CCTV/เซลฟี่ได้ปกติเมื่อแสงเห็นหน้าชัด — ใช้ภาพข่าว press แทนเฉพาะเมื่อมีใบที่หน้าชัดกว่าจริง';

test('(1) default (ไม่ตั้ง MEGA_RULES_V3): heroSourceAvoid = ข้อความกลางแบบ v3 (ถอดคำว่า "เลี่ยง")', async () => {
  await withEnv('MEGA_RULES_V3', null, async () => {
    let capturedMeta = null;
    const brain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'CLIP-1' } }, note: 'stub' }; } };
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([CLIP_IMG, PRESS_IMG]) } });
    assert.equal(r.status, 'done');
    const clip = capturedMeta.find((m) => m.id === 'CLIP-1');
    assert.equal(clip.heroSourceAvoid, NEW_LABEL, 'ป้าย default ต้องเป็นข้อความกลางแบบ v3 เป๊ะ');
    assert.ok(!clip.heroSourceAvoid.includes('เลี่ยง'), 'ต้องไม่มีคำว่า "เลี่ยง" อีกต่อไปตามที่เจ้าของสั่ง');
    const press = capturedMeta.find((m) => m.id === 'PRESS-1');
    assert.ok(!press.heroSourceAvoid, 'ภาพ press (ไม่ใช่เฟรมคลิป) ต้องไม่มีป้ายนี้เลย');
  });
});

test('(2) MEGA_RULES_V3=0: heroSourceAvoid = ข้อความเดิมทุก byte (rollback)', async () => {
  await withEnv('MEGA_RULES_V3', '0', async () => {
    let capturedMeta = null;
    const brain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'CLIP-1' } }, note: 'stub' }; } };
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([CLIP_IMG, PRESS_IMG]) } });
    assert.equal(r.status, 'done');
    const clip = capturedMeta.find((m) => m.id === 'CLIP-1');
    assert.equal(clip.heroSourceAvoid, OLD_LABEL, 'MEGA_RULES_V3=0 ต้องได้ข้อความเดิมทุก byte เป๊ะ (rollback)');
  });
});

test('(3) MEGA_HERO_SOURCE_POLICY=0: ไม่มีป้ายเลย ไม่ว่า MEGA_RULES_V3 จะเป็นอะไร (สวิตช์แม่เดิมยังคุมอยู่)', async () => {
  await withEnv('MEGA_HERO_SOURCE_POLICY', '0', async () => {
    await withEnv('MEGA_RULES_V3', null, async () => {
      let capturedMeta = null;
      const brain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'CLIP-1' } }, note: 'stub' }; } };
      const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([CLIP_IMG, PRESS_IMG]) } });
      assert.equal(r.status, 'done');
      const clip = capturedMeta.find((m) => m.id === 'CLIP-1');
      assert.ok(!clip.heroSourceAvoid, 'สวิตช์แม่ปิด → ไม่มีป้ายเลย แม้ MEGA_RULES_V3 จะ default ON');
    });
  });
});

test('(4) rulesV3On ถูกส่งเข้า slotDirectorBrain จริง — ตรงกับ env MEGA_RULES_V3 (default true / "0"=false)', async () => {
  await withEnv('MEGA_RULES_V3', null, async () => {
    let capturedArgs = null;
    const brain = { slotDirectorBrain: async (args) => { capturedArgs = args; return { slots: { hero: { id: 'CLIP-1' } }, note: 'stub' }; } };
    await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([CLIP_IMG, PRESS_IMG]) } });
    assert.equal(capturedArgs.rulesV3On, true, 'default (env ไม่ตั้ง) ต้องส่ง rulesV3On:true');
  });
  await withEnv('MEGA_RULES_V3', '0', async () => {
    let capturedArgs = null;
    const brain = { slotDirectorBrain: async (args) => { capturedArgs = args; return { slots: { hero: { id: 'CLIP-1' } }, note: 'stub' }; } };
    await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...brain, fetchJson: fetchStub([CLIP_IMG, PRESS_IMG]) } });
    assert.equal(capturedArgs.rulesV3On, false, 'MEGA_RULES_V3=0 ต้องส่ง rulesV3On:false');
  });
});
