// ============================================================
// 🧪 MEGA_HERO_PROMINENCE (19 ก.ค. 69) — เกณฑ์ "หน้าเด่น/ใหญ่" ในการเลือก HERO + วงกลม
// kill-switch: MEGA_HERO_PROMINENCE (default ON, '0' = พฤติกรรมเดิม byte-parity)
// ------------------------------------------------------------
// ปัญหาจริง (AC-0160): hero ได้ภาพ "แม่นอนหน้าเล็ก ~16-20% ของเฟรม + backdrop 60%" เพราะเกณฑ์เลือก hero
// เดิมเป็น pass/fail ล้วน (ถูกคน/faceCount==1/≥700px/clean) ไม่เคยวัด "หน้ากิน %เฟรม" เลย — วงกลมได้ภาพไร้หน้า
// (ก้อนสี) เพราะ fallback เดิมไม่บังคับ faceCount≥1
//
// พิสูจน์ (s6_slots):
//   (1) OFF → meta ที่ส่งให้สมองไม่มี field faceH เลย (byte-parity ต่อ prompt)
//   (2) ON  → meta มี faceH (0-1 ปัดสองตำแหน่ง) เฉพาะใบที่วัด faceBox ได้ ใบที่วัดไม่ได้ไม่มี field
//   (3) hero fallback tier: quality เท่ากัน → ON เลือกภาพหน้าใหญ่ก่อนเสมอ / OFF เลือกตามลำดับเดิม (ไม่สนใจหน้าใหญ่/เล็ก)
//   (4) circle fallback: ON เลือกภาพ "มีหน้า" ก่อนภาพไร้หน้า (กันก้อนสี) / OFF ยังได้ภาพไร้หน้าเหมือนเดิม (arr[0])
//   (5) faceBox หายทุกใบ → ไม่ crash และพฤติกรรม ON เท่ากับ OFF (เกณฑ์ใหม่ถูกข้ามเงียบๆ)
//   (6) hero-swap guard: brain เลือก hero หน้าเล็กมาตรงๆ + พูลมีคนเดียวกันหน้าใหญ่กว่า+ขนาดพอ → ON สลับ / OFF ไม่สลับ
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

// ล้าง shadow switches ที่อาจเปลี่ยนเส้นทางไปสาย semantic/solver/ref-hero-v2 (เทสนี้ต้องเดินสาย legacy ล้วน)
for (const k of [
  'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_REF_SHOT_AUTHORITY', 'MEGA_SLOT_SOLVER_LIVE',
  'MEGA_REF_HERO_V2', 'MEGA_ROLE_READINESS', 'MEGA_FINAL_DECISION_EVIDENCE_V2', 'MEGA_CROSS_CASE_BORROW',
]) delete process.env[k];

const { s6_slots } = await import('@/lib/megaAdapters');

const HERO = 'มะปราง';
const OTHER = 'ต้นหอม';

const withEnv = async (name, v, fn) => {
  const prev = process.env[name];
  if (v == null) delete process.env[name]; else process.env[name] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; }
};

function mkJob() {
  return {
    dossier: {
      images: { caseId: 'CASE-HERO-PROMINENCE' },
      compass: {
        angle: 'มุมทดสอบ hero หน้าเด่น', primaryEmotion: 'warm', secondaryEmotions: [],
        mainCharacters: [{ name: HERO, role: 'hero' }, { name: OTHER, role: 'someone_else' }],
        visualDreamShots: [], doNotUse: [],
      },
      desk: { title: 'ข่าวทดสอบ hero หน้าเด่น' },
      // refMatch แบบ "หลวม" (typeMatched:false) → ไม่มี semContract → เดินสาย legacy ล้วน (เหมือนเทส HERO_SINGLE เดิม)
      refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
      artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
    },
  };
}

const fetchStub = (pool) => async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected fetch: ' + url); })());
const NO_BRAIN = { slotDirectorBrain: async () => { throw new Error('test-stub-no-brain'); } };

// ---- fixtures: hero (หน้าเล็ก vs หน้าใหญ่ — quality เท่ากันทั้งคู่, ขนาดไฟล์จริงผ่านเกณฑ์ heroSizeOk ทั้งคู่) ----
const heroSmallFace = () => ({
  id: 'HSMALL',
  imageUrl: 'https://cdn.test/HSMALL.jpg',
  realWidth: 1400,
  realHeight: 1750,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'warm', note: '', newsScene: true, quality: 8,
    faceBox: { x: 0.35, y: 0.1, w: 0.15, h: 0.10 }, // faceH=0.10 (เล็ก — ต่ำกว่าเกณฑ์ 0.30)
  },
});
const heroBigFace = () => ({
  id: 'HBIG',
  imageUrl: 'https://cdn.test/HBIG.jpg',
  realWidth: 1400,
  realHeight: 1750,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'warm', note: '', newsScene: true, quality: 8,
    faceBox: { x: 0.30, y: 0.1, w: 0.35, h: 0.40 }, // faceH=0.40 (ใหญ่ — ผ่านเกณฑ์ 0.30)
  },
});
// เหมือน heroSmallFace/heroBigFace แต่ "ไม่มี faceBox เลย" (วัดไม่ได้) — คนละ id กันชนกับสองใบบน
const heroNoBoxA = () => { const x = heroSmallFace(); x.id = 'HNOBOX-A'; x.imageUrl = 'https://cdn.test/HNOBOX-A.jpg'; delete x.triage.faceBox; return x; };
const heroNoBoxB = () => { const x = heroBigFace(); x.id = 'HNOBOX-B'; x.imageUrl = 'https://cdn.test/HNOBOX-B.jpg'; delete x.triage.faceBox; return x; };

test('MEGA_HERO_PROMINENCE OFF: meta ส่งให้สมองไม่มี field faceH เลย (byte-parity)', async () => {
  await withEnv('MEGA_HERO_PROMINENCE', '0', async () => {
    let capturedMeta = null;
    const captureBrain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'HBIG' } }, note: 'stub' }; } };
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...captureBrain, fetchJson: fetchStub([heroBigFace()]) } });
    assert.equal(r.status, 'done');
    assert.ok(Array.isArray(capturedMeta) && capturedMeta.length >= 1);
    for (const m of capturedMeta) assert.ok(!('faceH' in m), `OFF ต้องไม่มี faceH ใน meta (id=${m.id})`);
  });
});

test('MEGA_HERO_PROMINENCE ON (default): meta มี faceH (0-1 ปัดสองตำแหน่ง) เฉพาะใบที่วัด faceBox ได้', async () => {
  await withEnv('MEGA_HERO_PROMINENCE', null, async () => {
    let capturedMeta = null;
    const noBox = heroNoBoxA();
    const captureBrain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'HBIG' } }, note: 'stub' }; } };
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...captureBrain, fetchJson: fetchStub([heroBigFace(), noBox]) } });
    assert.equal(r.status, 'done');
    const mBig = capturedMeta.find((m) => m.id === 'HBIG');
    const mNoBox = capturedMeta.find((m) => m.id === noBox.id);
    assert.ok(mBig, 'ต้องเห็น HBIG ใน meta');
    assert.equal(mBig.faceH, 0.4, 'faceH ต้องเท่ากับ h ของ faceBox (ปัด 2 ตำแหน่ง)');
    // faceH: undefined (ไม่ใช่ null) — property key มีอยู่ใน object ดิบ (`in` เป็น true) แต่ JSON.stringify
    //   (ตัวจริงที่ส่งเข้า prompt ผ่าน megaBrains.js) ต้องตัดทิ้งเงียบๆ — เช็คที่ผลลัพธ์ serialize จริง ไม่ใช่ object ดิบ
    assert.ok(mNoBox, 'ต้องเห็นใบไม่มี faceBox ใน meta ด้วย');
    assert.equal(mNoBox.faceH, undefined, 'ใบที่ไม่มี faceBox ต้องได้ faceH เป็น undefined');
    assert.ok(!('faceH' in JSON.parse(JSON.stringify(mNoBox))), 'หลัง JSON.stringify (ตัวจริงที่ส่งเข้า prompt) ต้องไม่มี field faceH เลย');
  });
});

test('hero fallback tier: quality เท่ากัน → ON เลือกภาพหน้าใหญ่ก่อนเสมอ (แม้อยู่หลังในลำดับ)', async () => {
  await withEnv('MEGA_HERO_PROMINENCE', null, async () => {
    // ลำดับพูล: หน้าเล็กมาก่อน หน้าใหญ่มาทีหลัง — ถ้าเกณฑ์ใหม่ไม่ทำงาน ตัวหน้าเล็ก (มาก่อน) จะชนะแทน
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroSmallFace(), heroBigFace()]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'HBIG', 'ON ต้องเลือกภาพหน้าใหญ่ (HBIG) แม้อยู่หลังในลำดับคุณภาพ');
  });
});

test('hero fallback tier: OFF → เลือกตามลำดับเดิม (ไม่สนใจหน้าใหญ่/เล็ก) — ตัวแรกในลำดับชนะ', async () => {
  await withEnv('MEGA_HERO_PROMINENCE', '0', async () => {
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroSmallFace(), heroBigFace()]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'HSMALL', 'OFF ต้องเลือกตามลำดับเดิม (ใบแรกที่ผ่านเกณฑ์เดิม) ไม่สนใจขนาดหน้า');
  });
});

test('faceBox หายทั้งพูล → ไม่ crash และ ON ให้ผลเหมือน OFF (เกณฑ์ใหม่ถูกข้ามเงียบๆ)', async () => {
  const runWith = (flag) => withEnv('MEGA_HERO_PROMINENCE', flag, async () => {
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...NO_BRAIN, fetchJson: fetchStub([heroNoBoxA(), heroNoBoxB()]) },
    });
    assert.equal(r.status, 'done');
    return r.dossierPatch.pickImages.slots.hero?.id;
  });
  const onId = await runWith(null);
  const offId = await runWith('0');
  assert.equal(onId, 'HNOBOX-A', 'ไม่มี faceBox เลย → เกณฑ์ใหม่ไม่เข้าเกณฑ์ → ถอยไปตัวแรกตามลำดับเดิม');
  assert.equal(onId, offId, 'ON กับ OFF ต้องเลือกใบเดียวกันเมื่อวัด faceH ไม่ได้เลยทั้งพูล');
});

// ---- fixtures: วงกลม (ต้องมี filler ให้ hero/reaction/action/context กินตามลำดับ SLOT_ORDER ก่อนถึงคิว circle) ----
const heroImg = () => ({
  id: 'HERO-1', imageUrl: 'https://cdn.test/HERO-1.jpg', realWidth: 1400, realHeight: 1750,
  triage: { relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO], category: 'face-emotional', note: '', newsScene: true, quality: 10, faceBox: { x: 0.3, y: 0.1, w: 0.3, h: 0.45 } },
});
const reactionFiller = () => ({ id: 'REACT-1', imageUrl: 'https://cdn.test/REACT-1.jpg', triage: { relevant: true, clean: true, faceCount: 1, person: OTHER, persons: [OTHER], category: 'other', note: '', newsScene: true, quality: 9 } });
const actionFiller = () => ({ id: 'ACTION-1', imageUrl: 'https://cdn.test/ACTION-1.jpg', triage: { relevant: true, clean: true, faceCount: 0, person: null, persons: [], category: 'context', note: '', newsScene: true, quality: 8 } });
const contextFiller = () => ({ id: 'CONTEXT-1', imageUrl: 'https://cdn.test/CONTEXT-1.jpg', triage: { relevant: true, clean: true, faceCount: 0, person: null, persons: [], category: 'document', note: '', newsScene: true, quality: 7 } });
const circleBlob = () => ({ id: 'CIRCLE-BLOB', imageUrl: 'https://cdn.test/CIRCLE-BLOB.jpg', triage: { relevant: true, clean: true, faceCount: 0, person: null, persons: [], category: 'other', note: '', newsScene: true, quality: 6 } });
const circleFaced = () => ({ id: 'CIRCLE-FACED', imageUrl: 'https://cdn.test/CIRCLE-FACED.jpg', triage: { relevant: true, clean: true, faceCount: 1, person: OTHER, persons: [OTHER], category: 'other', note: '', newsScene: true, quality: 5, faceBox: { x: 0.3, y: 0.2, w: 0.2, h: 0.20 } } });
const circlePool = () => [heroImg(), reactionFiller(), actionFiller(), contextFiller(), circleBlob(), circleFaced()];

test('circle fallback: ON เลือกภาพ "มีหน้า" ก่อนภาพไร้หน้า (กันก้อนสีขึ้นวง)', async () => {
  await withEnv('MEGA_HERO_PROMINENCE', null, async () => {
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(circlePool()) } });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.circle?.id, 'CIRCLE-FACED', 'ON ต้องเลือกใบมีหน้า (CIRCLE-FACED) ก่อนใบไร้หน้าคุณภาพสูงกว่า');
  });
});

test('circle fallback: OFF → ยังได้ภาพไร้หน้าเหมือนเดิม (arr[0] ตามคุณภาพ)', async () => {
  await withEnv('MEGA_HERO_PROMINENCE', '0', async () => {
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(circlePool()) } });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.circle?.id, 'CIRCLE-BLOB', 'OFF ต้องคงพฤติกรรมเดิม (arr[0] คุณภาพสูงสุดที่เหลือ แม้ไร้หน้า)');
  });
});

// ---- hero-swap guard: brain เลือก hero หน้าเล็กมาตรงๆ (ไม่ผ่าน fallback) ----
const brainPicks = (id) => ({ slotDirectorBrain: async () => ({ slots: { hero: { id, reason: 'brain เลือกตรง (stub)' } }, note: 'stub-brain' }) });

test('hero-swap guard: brain เลือกหน้าเล็กตรงๆ + พูลมีคนเดียวกันหน้าใหญ่กว่า+ขนาดพอ → ON สลับ', async () => {
  await withEnv('MEGA_HERO_PROMINENCE', null, async () => {
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicks('HSMALL'), fetchJson: fetchStub([heroSmallFace(), heroBigFace()]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'HBIG', 'ON ต้องสลับจาก HSMALL (หน้าเล็ก) ไป HBIG (หน้าใหญ่กว่า)');
    assert.match(r.dossierPatch.pickImages.slots.hero?.reason || '', /หน้าเด่น/, 'reason ต้องระบุว่าเป็นการบังคับสลับหน้าเด่น');
  });
});

test('hero-swap guard: OFF → ไม่สลับ แม้ brain เลือกหน้าเล็กและพูลมีตัวเลือกหน้าใหญ่กว่า', async () => {
  await withEnv('MEGA_HERO_PROMINENCE', '0', async () => {
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicks('HSMALL'), fetchJson: fetchStub([heroSmallFace(), heroBigFace()]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'HSMALL', 'OFF ต้องคงภาพที่ brain เลือก (ไม่มีด่านสลับหน้าเด่นทำงาน)');
  });
});
