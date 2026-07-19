// ============================================================
// 🧪 MEGA_CLUTTER_GUARD — มือ B: megaAdapters.js s6_slots (สมองคัดช่องย่อย)
// ------------------------------------------------------------
// kill-switch: MEGA_CLUTTER_GUARD (default ON — !== '0'; '0'=ปิด=byte-parity)
// สัญญา: triage.busy 0-2 ต่อภาพ (0=สะอาด, 1=มีพื้นหลังบ้าง, 2=ลายตา) จากตาคัด (Gemini)
//
// พิสูจน์ 5 งานตามสเปกกลาง (CLUTTER_GUARD_SPEC.md section มือ B):
//   (1) meta ส่งให้ LLM director เห็น field busy (OFF=ไม่มีเลย / ON=มีเฉพาะใบที่ตาส่งมา + clamp 0-2)
//   (2) penalty k*busy (k=0.15) ใน _combinedStory — แยกพิสูจน์จากชั้นกรอง tier ด้วยเคส busy<=1 เท่ากันหมด (tie)
//   (3) บูสต์ +2 หมวด group/context ถูกตัดเฉพาะ busy===2 (ไม่ตัดที่ busy=1) — พิสูจน์ผ่าน quality-tie เผย stable order
//   (4) tier กรอง busy<=1 ก่อน ทั้งช่องย่อยทั่วไป (context) และ circle
//   (5) ทุกใบเหลือ busy===2 เท่ากันหมด → เลือกคุณภาพแทน story-fit
// ทุกเทสยืนยันคู่ ON/OFF: OFF ต้องเป็น byte-parity (busy ไม่มีผลใดๆ แม้ field จะมีอยู่ในข้อมูลจริง)
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

// ล้าง shadow switches ที่อาจเปลี่ยนเส้นทางไปสาย semantic/solver/ref-hero-v2 (เทสนี้ต้องเดินสาย legacy ล้วน — เหมือน mega-hero-prominence.test.mjs)
for (const k of [
  'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_REF_SHOT_AUTHORITY', 'MEGA_SLOT_SOLVER_LIVE',
  'MEGA_REF_HERO_V2', 'MEGA_ROLE_READINESS', 'MEGA_FINAL_DECISION_EVIDENCE_V2', 'MEGA_CROSS_CASE_BORROW',
  'MEGA_CLUTTER_GUARD',
]) delete process.env[k];

const { s6_slots } = await import('@/lib/megaAdapters');

const HERO = 'มะปราง';
const OTHER = 'ต้นหอม';

const withEnv = async (name, v, fn) => {
  const prev = process.env[name];
  if (v == null) delete process.env[name]; else process.env[name] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; }
};

function mkJob({ storyQueries } = {}) {
  return {
    dossier: {
      images: { caseId: 'CASE-CLUTTER-GUARD', ...(storyQueries ? { storyQueries } : {}) },
      compass: {
        angle: 'มุมทดสอบ clutter guard', primaryEmotion: 'neutral', secondaryEmotions: [],
        mainCharacters: [{ name: HERO, role: 'hero' }, { name: OTHER, role: 'someone_else' }],
        visualDreamShots: [], doNotUse: [],
      },
      desk: { title: 'ข่าวทดสอบช่องย่อยลายตา' },
      // refMatch แบบ "หลวม" (typeMatched:false) → ไม่มี semContract → เดินสาย legacy ล้วน (เหมือนเทส HERO_PROMINENCE)
      refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
      artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
    },
  };
}

const fetchStub = (pool) => async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected fetch: ' + url); })());
const NO_BRAIN = { slotDirectorBrain: async () => { throw new Error('test-stub-no-brain'); } };

// ---- fixtures พื้นฐาน ----
const heroImg = () => ({
  id: 'HERO-1', imageUrl: 'https://cdn.test/HERO-1.jpg', realWidth: 1400, realHeight: 1750,
  triage: { relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO], category: 'face-emotional', note: '', newsScene: true, quality: 10, faceBox: { x: 0.3, y: 0.1, w: 0.3, h: 0.45 } },
});
const reactionFiller = () => ({ id: 'REACT-1', imageUrl: 'https://cdn.test/REACT-1.jpg', triage: { relevant: true, clean: true, faceCount: 1, person: OTHER, persons: [OTHER], category: 'other', note: '', newsScene: true, quality: 9.5 } });
const actionFiller = () => ({ id: 'ACTION-1', imageUrl: 'https://cdn.test/ACTION-1.jpg', triage: { relevant: true, clean: true, faceCount: 0, person: null, persons: [], category: 'context', note: '', newsScene: true, quality: 8 } });
const contextFiller = () => ({ id: 'CONTEXT-1', imageUrl: 'https://cdn.test/CONTEXT-1.jpg', triage: { relevant: true, clean: true, faceCount: 0, person: null, persons: [], category: 'document', note: '', newsScene: true, quality: 7 } });

test('MEGA_CLUTTER_GUARD default (unset) = ON: meta มี field busy (unset → เปิด, !== "0" semantics)', async () => {
  await withEnv('MEGA_CLUTTER_GUARD', null, async () => {
    let capturedMeta = null;
    const captureBrain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'HERO-1' } }, note: 'stub' }; } };
    const pool = [heroImg(), { id: 'X1', imageUrl: 'https://cdn.test/X1.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 5, busy: 2 } }];
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...captureBrain, fetchJson: fetchStub(pool) } });
    assert.equal(r.status, 'done');
    const x1 = capturedMeta.find((m) => m.id === 'X1');
    assert.ok(x1 && x1.busy === 2, 'default ON (unset): busy ต้องอยู่ใน meta');
  });
});

test('MEGA_CLUTTER_GUARD OFF (explicit "0"): เหมือน unset — ไม่มี field busy ใน meta', async () => {
  await withEnv('MEGA_CLUTTER_GUARD', '0', async () => {
    let capturedMeta = null;
    const captureBrain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'HERO-1' } }, note: 'stub' }; } };
    const pool = [heroImg(), { id: 'X1', imageUrl: 'https://cdn.test/X1.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 5, busy: 2 } }];
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...captureBrain, fetchJson: fetchStub(pool) } });
    assert.equal(r.status, 'done');
    for (const m of capturedMeta) assert.ok(!('busy' in m), `"0" ต้องเท่ากับ OFF — ไม่มี busy ใน meta (id=${m.id})`);
  });
});

test('MEGA_CLUTTER_GUARD ON: meta มี field busy เฉพาะใบที่ตาส่งมาจริง + clamp เข้ากรอบ 0-2', async () => {
  await withEnv('MEGA_CLUTTER_GUARD', '1', async () => {
    let capturedMeta = null;
    const captureBrain = { slotDirectorBrain: async ({ imagesMeta }) => { capturedMeta = imagesMeta; return { slots: { hero: { id: 'HERO-1' } }, note: 'stub' }; } };
    const pool = [
      heroImg(),
      { id: 'B1', imageUrl: 'https://cdn.test/B1.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 5, busy: 1 } },
      { id: 'B5', imageUrl: 'https://cdn.test/B5.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 5, busy: 5 } }, // เกินเพดาน → clamp เป็น 2
      { id: 'BNEG', imageUrl: 'https://cdn.test/BNEG.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 5, busy: -3 } }, // ติดลบ → clamp เป็น 0
      { id: 'BNONE', imageUrl: 'https://cdn.test/BNONE.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 5 } }, // ไม่มี busy เลย → undefined (neutral)
    ];
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...captureBrain, fetchJson: fetchStub(pool) } });
    assert.equal(r.status, 'done');
    const byId = (id) => capturedMeta.find((m) => m.id === id);
    assert.equal(byId('B1').busy, 1, 'busy=1 ต้องผ่านตรงๆ');
    assert.equal(byId('B5').busy, 2, 'busy=5 (เกินเพดาน) ต้อง clamp เหลือ 2');
    assert.equal(byId('BNEG').busy, 0, 'busy=-3 (ติดลบ) ต้อง clamp เหลือ 0');
    assert.equal(byId('BNONE').busy, undefined, 'ไม่มี triage.busy → meta.busy ต้องเป็น undefined');
    assert.ok(!('busy' in JSON.parse(JSON.stringify(byId('BNONE')))), 'หลัง JSON.stringify (ตัวจริงที่ส่งเข้า prompt) ต้องไม่มี field busy เลยสำหรับใบที่ไม่มีสัญญาณ');
  });
});

test('OFF byte-parity ทั้ง pipeline: มี/ไม่มี field triage.busy ให้ผลเลือกภาพเหมือนกันเป๊ะ (busy เป็น neutral เมื่อปิดสวิตช์)', async () => {
  const mkPool = (withBusy) => [
    heroImg(), reactionFiller(), actionFiller(),
    { id: 'CTX-HI', imageUrl: 'https://cdn.test/CTX-HI.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 9, ...(withBusy ? { busy: 2 } : {}) } },
    { id: 'CTX-LO', imageUrl: 'https://cdn.test/CTX-LO.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 4, ...(withBusy ? { busy: 0 } : {}) } },
  ];
  const run = (withBusy) => withEnv('MEGA_CLUTTER_GUARD', '0', async () => {
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(mkPool(withBusy)) } });
    assert.equal(r.status, 'done');
    return r.dossierPatch.pickImages;
  });
  const withField = await run(true);
  const withoutField = await run(false);
  assert.equal(JSON.stringify(withField), JSON.stringify(withoutField), 'OFF: มี/ไม่มี field triage.busy ต้องให้ผล pickImages เหมือนกันทุก byte');
  assert.equal(withField.slots.context?.id, 'CTX-HI', 'OFF ต้องเลือกคุณภาพสูงสุด (CTX-HI) โดยไม่สนใจ busy');
});

test('ช่องย่อย (context) fallback: ON กรอง busy=2 ออกก่อนเสมอ (เลือก busy<=1 แม้คุณภาพต่ำกว่า) / OFF ยังเลือกคุณภาพสูงสุดเหมือนเดิม', async () => {
  const pool = () => [
    heroImg(), reactionFiller(), actionFiller(),
    { id: 'CTX-BUSY', imageUrl: 'https://cdn.test/CTX-BUSY.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 9, busy: 2 } },
    { id: 'CTX-CLEAN', imageUrl: 'https://cdn.test/CTX-CLEAN.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 4, busy: 0 } },
  ];
  const rOff = await withEnv('MEGA_CLUTTER_GUARD', '0', () => s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  const rOn = await withEnv('MEGA_CLUTTER_GUARD', '1', () => s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  assert.equal(rOff.status, 'done'); assert.equal(rOn.status, 'done');
  assert.equal(rOff.dossierPatch.pickImages.slots.context?.id, 'CTX-BUSY', 'OFF ต้องเลือกคุณภาพสูงสุด (CTX-BUSY) เหมือนพฤติกรรมเดิม (busy ไม่มีผล)');
  assert.equal(rOn.dossierPatch.pickImages.slots.context?.id, 'CTX-CLEAN', 'ON ต้องเลี่ยง busy=2 แม้คุณภาพต่ำกว่า — เลือก CTX-CLEAN (busy=0)');
});

test('circle fallback: ON เลี่ยง busy=2 (แม้มีหน้า+คุณภาพสูงกว่า) ไปเลือกใบ busy<=1 / OFF ยังได้ใบ busy=2 คุณภาพสูงกว่าเหมือนเดิม', async () => {
  const pool = () => [
    heroImg(), reactionFiller(), actionFiller(), contextFiller(),
    { id: 'CIR-BUSY2', imageUrl: 'https://cdn.test/CIR-BUSY2.jpg', triage: { relevant: true, clean: true, faceCount: 1, person: 'คนที่สาม', persons: ['คนที่สาม'], category: 'other', quality: 6, busy: 2, faceBox: { x: 0.3, y: 0.2, w: 0.2, h: 0.25 } } },
    { id: 'CIR-BUSY1', imageUrl: 'https://cdn.test/CIR-BUSY1.jpg', triage: { relevant: true, clean: true, faceCount: 1, person: 'คนที่สี่', persons: ['คนที่สี่'], category: 'other', quality: 3, busy: 1, faceBox: { x: 0.3, y: 0.2, w: 0.2, h: 0.20 } } },
  ];
  const rOff = await withEnv('MEGA_CLUTTER_GUARD', '0', () => s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  const rOn = await withEnv('MEGA_CLUTTER_GUARD', '1', () => s6_slots(mkJob(), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  assert.equal(rOff.status, 'done'); assert.equal(rOn.status, 'done');
  assert.equal(rOff.dossierPatch.pickImages.slots.circle?.id, 'CIR-BUSY2', 'OFF ต้องได้ใบ busy=2 คุณภาพสูงกว่า (CIR-BUSY2) เหมือนพฤติกรรมเดิม');
  assert.equal(rOn.dossierPatch.pickImages.slots.circle?.id, 'CIR-BUSY1', 'ON ต้องเลี่ยง busy=2 — เลือก CIR-BUSY1 (busy=1) แม้คุณภาพต่ำกว่า');
});

test('_combinedStory penalty (k=0.15): busy สูงกว่าแพ้แม้ story-fit เท่ากันเป๊ะ (ON) / OFF ไม่สนใจ busy เลย (ลำดับเดิมชนะ)', async () => {
  // ทั้งสองใบ category='other' (ไม่เข้า relCat/hint) → storyFit เท่ากัน (=3 พื้นฐาน) ต่างกันแค่ busy
  // จงใจใส่ตัว busy=1 ไว้ "ก่อน" ในลำดับพูล — ถ้า penalty ไม่ทำงาน (OFF) ลำดับเดิมต้องชนะ (stable sort)
  const pool = () => [
    heroImg(), reactionFiller(), actionFiller(),
    { id: 'CTX-BUSY1', imageUrl: 'https://cdn.test/CTX-BUSY1.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 5, busy: 1 } },
    { id: 'CTX-BUSY0', imageUrl: 'https://cdn.test/CTX-BUSY0.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 5, busy: 0 } },
  ];
  const rOff = await withEnv('MEGA_CLUTTER_GUARD', '0', () => s6_slots(mkJob({ storyQueries: ['dummy_query'] }), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  const rOn = await withEnv('MEGA_CLUTTER_GUARD', '1', () => s6_slots(mkJob({ storyQueries: ['dummy_query'] }), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  assert.equal(rOff.status, 'done'); assert.equal(rOn.status, 'done');
  assert.equal(rOff.dossierPatch.pickImages.slots.context?.id, 'CTX-BUSY1', 'OFF: quality/story เท่ากัน → คงลำดับเดิม (ตัวแรกในพูลชนะ) ไม่สนใจ busy');
  assert.equal(rOn.dossierPatch.pickImages.slots.context?.id, 'CTX-BUSY0', 'ON: penalty 0.15×busy ต้องพลิกผลลัพธ์ให้ busy ต่ำกว่าชนะ แม้อยู่หลังในลำดับ');
});

test('group/context บูสต์ +2 ถูกตัดเฉพาะ busy===2 พอดี (ไม่ตัดที่ busy=1) — พิสูจน์ผ่าน OFF มีบูสต์จริง vs ON บูสต์หาย', async () => {
  // relCatCand: category='family' (เข้า STORY_CAT_RE relCat) — "family" ไม่ตรง SLOT_CATEGORY_HINT.context (กัน hint-tier แย่งซีน)
  // ทั้งคู่ busy=2 คุณภาพเท่ากัน (5) → ถ้าตัดบูสต์ถูกต้อง: story-fit เท่ากัน → เสมอ → stable-sort คงลำดับเดิม (ตัวแรกชนะ)
  //   ถ้าตัดบูสต์ผิด/ไม่ตัด: relCatCand ยังได้ +2 → ชนะจริงด้วยคะแนน (ไม่ใช่แค่ลำดับ) ไม่ว่าจะอยู่ตำแหน่งไหน
  const pool = () => [
    heroImg(), reactionFiller(), actionFiller(),
    { id: 'CTX-FIRST-OTHER', imageUrl: 'https://cdn.test/CTX-FIRST-OTHER.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 5, busy: 2 } },
    { id: 'CTX-SECOND-FAMILY', imageUrl: 'https://cdn.test/CTX-SECOND-FAMILY.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'family', quality: 5, busy: 2 } },
  ];
  const rOff = await withEnv('MEGA_CLUTTER_GUARD', '0', () => s6_slots(mkJob({ storyQueries: ['dummy_query'] }), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  const rOn = await withEnv('MEGA_CLUTTER_GUARD', '1', () => s6_slots(mkJob({ storyQueries: ['dummy_query'] }), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  assert.equal(rOff.status, 'done'); assert.equal(rOn.status, 'done');
  assert.equal(rOff.dossierPatch.pickImages.slots.context?.id, 'CTX-SECOND-FAMILY', 'OFF: บูสต์ +2 หมวด family ต้องยังทำงานปกติ (busy ไม่มีผลตอนปิดสวิตช์) → ชนะแม้อยู่หลังในลำดับ');
  assert.equal(rOn.dossierPatch.pickImages.slots.context?.id, 'CTX-FIRST-OTHER', 'ON: บูสต์ +2 ต้องถูกตัดที่ busy=2 → คะแนนเสมอกัน → คงลำดับเดิม (ตัวแรกชนะ) ไม่ใช่ CTX-SECOND-FAMILY');
});

test('ทุกใบเหลือ busy===2 เท่ากันหมด: ON เลือกคุณภาพสูงสุดแทน story-fit / OFF ยังเลือกตาม story-fit เหมือนเดิม', async () => {
  // candLowQHighStory: quality ต่ำ แต่ query ตรง storyQueries → fromStory +4 (บูสต์นี้ "ไม่ถูกตัด" แม้ busy=2 — สเปกตัดเฉพาะ relCat +2)
  // candHighQ: quality สูง แต่ story-fit ธรรมดา (พื้นฐาน 3 เท่านั้น)
  const pool = () => [
    heroImg(), reactionFiller(), actionFiller(),
    { id: 'CAND-LOWQ-HISTORY', imageUrl: 'https://cdn.test/CAND-LOWQ-HISTORY.jpg', query: 'dummy_query', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'family', quality: 3, busy: 2 } },
    { id: 'CAND-HIGHQ', imageUrl: 'https://cdn.test/CAND-HIGHQ.jpg', triage: { relevant: true, clean: true, faceCount: 0, persons: [], category: 'other', quality: 9, busy: 2 } },
  ];
  const rOff = await withEnv('MEGA_CLUTTER_GUARD', '0', () => s6_slots(mkJob({ storyQueries: ['dummy_query'] }), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  const rOn = await withEnv('MEGA_CLUTTER_GUARD', '1', () => s6_slots(mkJob({ storyQueries: ['dummy_query'] }), { origin: 'http://mock', _deps: { ...NO_BRAIN, fetchJson: fetchStub(pool()) } }));
  assert.equal(rOff.status, 'done'); assert.equal(rOn.status, 'done');
  assert.equal(rOff.dossierPatch.pickImages.slots.context?.id, 'CAND-LOWQ-HISTORY', 'OFF: ต้องเลือกตาม story-fit เดิม (fromStory +4 ชนะ) ไม่สนใจ busy');
  assert.equal(rOn.dossierPatch.pickImages.slots.context?.id, 'CAND-HIGHQ', 'ON: ทุกใบ busy=2 เท่ากันหมด → ต้องเปลี่ยนไปเลือกคุณภาพสูงสุดแทน story-fit');
});
