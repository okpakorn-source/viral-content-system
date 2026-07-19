// ============================================================
// 🧪 นโยบาย C (19 ก.ค. 69) — HERO ต้องเป็น "คนเดียว (ตัวเอก) เด่นเสมอ" ตั้งแต่การเลือกภาพ
// kill-switch: MEGA_HERO_SINGLE (default ON, '0' = พฤติกรรมเดิม byte-parity)
// ------------------------------------------------------------
// พิสูจน์ (s6_slots):
//   (1) OFF → พฤติกรรมเดิมเป๊ะ: hero ยังเป็นภาพคู่ได้ถ้าพูลไม่มีภาพเดี่ยว (ไม่มี synth crop/ไม่มี hold)
//   (2) ON + พูลมีภาพเดี่ยวถูกคนอยู่แล้ว → สลับภาพเดี่ยว (เดิม) ไม่แตะ
//   (3) ON + พูลไม่มีภาพเดี่ยว + หน้า hero ใหญ่พอ → ครอปจากภาพคู่ (_heroFaceCrop) แทนการ HOLD
//   (4) ON + พูลไม่มีภาพเดี่ยว + หน้า hero เล็กเกิน (ครอปแล้ว shortSide<700) → HOLD (insufficient_assets)
//   (5) ON + พูลไม่มีภาพเดี่ยว + กล่องหน้าเป็นของ "ตัวประกอบ" ไม่ใช่ hero (แมปตัวตนไม่ได้) → HOLD ไม่เดาครอปคนผิด
//   (6) fallback tier (brain ล่ม): หน้าเดี่ยว+ขนาดพอ ต้องชนะภาพคู่เสมอเมื่อมี
// พิสูจน์ (s5_search): hasSingleFace gate ต้องผูก heroNames — หน้าเดี่ยวของ "ตัวประกอบ" ไม่นับว่า "พอ" อีกต่อไป
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
// เทส s5_search gate ต้องกด staged-search ให้หยุดเช็คตั้งแต่แหล่งที่ 2 (ปกติต้องค้นครบ 4 แหล่งถึงจะเช็ค)
process.env.MEGA_SEARCH_INITIAL_BATCH = '2';
process.env.MEGA_MIN_RELEVANT_IMAGES = '1';
// ★ 20 ก.ค.: pin MEGA_HERO_SOLO_ONLY=0 — ไฟล์นี้พิสูจน์ synth-crop ของ MEGA_HERO_SINGLE (นโยบาย C) ซึ่งฟีเจอร์ใหม่
//   SOLO_ONLY (default ON) มาแทนที่โดยเจตนา (borrow-or-HOLD ห้ามครอปภาพคู่) — ปักปิดเพื่อคง synth-crop path ให้เทสเดิมพิสูจน์ได้
process.env.MEGA_HERO_SOLO_ONLY = '0';

const { s6_slots, s5_search } = await import('@/lib/megaAdapters');

const HERO_MIN_SHORT_SIDE = 700; // ../src/lib/imageQualityConfig.js (single source of truth)
const HERO = 'เป็กกี้';
const OTHER = 'คิว';

const withEnv = async (name, v, fn) => {
  const prev = process.env[name];
  if (v == null) delete process.env[name]; else process.env[name] = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; }
};

function mkJob() {
  return {
    dossier: {
      images: { caseId: 'CASE-HERO-SINGLE' },
      compass: {
        angle: 'มุมทดสอบ hero หน้าเดี่ยว', primaryEmotion: 'warm', secondaryEmotions: [],
        mainCharacters: [{ name: HERO, role: 'hero' }, { name: OTHER, role: 'someone_else' }],
        visualDreamShots: [], doNotUse: [],
      },
      desk: { title: 'ข่าวทดสอบ hero หน้าเดี่ยว' },
      // refMatch แบบ "หลวม" (typeMatched:false) → _refDNA=null → _cropGuard ไม่ทำงาน (เทสนี้เช็คด่าน shortSide ล้วน)
      refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
      artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
    },
  };
}

// ภาพคู่ [เป็กกี้, คิว] — กรอบหน้าใหญ่พอครอปแล้วผ่านเกณฑ์ (realWidth 2400 → shortSide หลังครอป ~840px)
const coupleBig = (person = HERO) => ({
  id: 'COUPLE-1',
  imageUrl: 'https://cdn.test/COUPLE-1.jpg',
  realWidth: 2400,
  realHeight: 1500,
  triage: {
    relevant: true, clean: true, faceCount: 2, person, persons: [HERO, OTHER],
    category: 'group', emotion: 'happy', note: '', newsScene: true, quality: 8,
    faceBox: { x: 0.1, y: 0.15, w: 0.25, h: 0.35 },
    peopleBox: { x: 0.05, y: 0.1, w: 0.6, h: 0.6 },
  },
});
// เหมือนกันแต่ไฟล์เล็ก — ครอปแล้ว shortSide < 700 (realWidth 900 → ~315px)
const coupleSmall = () => ({
  ...coupleBig(),
  id: 'COUPLE-SMALL-1',
  imageUrl: 'https://cdn.test/COUPLE-SMALL-1.jpg',
  realWidth: 900,
  realHeight: 700,
});
const solo = () => ({
  id: 'SOLO-1',
  imageUrl: 'https://cdn.test/SOLO-1.jpg',
  realWidth: 1200,
  realHeight: 1500,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'warm', note: '', newsScene: true, quality: 7,
  },
});

const NO_BRAIN = { slotDirectorBrain: async () => { throw new Error('test-stub-no-brain'); } };
const brainPicksCouple = (coupleImg) => ({
  slotDirectorBrain: async () => ({ slots: { hero: { id: coupleImg.id, reason: 'brain เลือกภาพคู่ (stub)' } }, note: 'stub-brain' }),
});
const fetchStub = (pool) => async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected fetch: ' + url); })());

test('MEGA_HERO_SINGLE OFF: พฤติกรรมเดิมเป๊ะ — ไม่มีภาพเดี่ยวในพูล → hero ยังเป็นภาพคู่ (ไม่มี synth crop/ไม่มี hold)', async () => {
  await withEnv('MEGA_HERO_SINGLE', '0', async () => {
    const couple = coupleBig();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(couple), fetchJson: fetchStub([couple]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'COUPLE-1');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.faces, 2);
    assert.ok(!r.dossierPatch.pickImages.slots.hero?._heroFaceCrop, 'OFF ต้องไม่มี _heroFaceCrop');
    assert.ok(!('heroSingleFaceHold' in r.dossierPatch.pickImages), 'OFF ต้องไม่มี heroSingleFaceHold');
  });
});

test('MEGA_HERO_SINGLE ON: พูลมีภาพเดี่ยวถูกคนอยู่แล้ว → สลับภาพเดี่ยว (solo-swap เดิม ไม่แตะ)', async () => {
  await withEnv('MEGA_HERO_SINGLE', null, async () => {
    const couple = coupleBig();
    const soloImg = solo();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(couple), fetchJson: fetchStub([couple, soloImg]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'SOLO-1');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.faces, 1);
    assert.ok(!r.dossierPatch.pickImages.slots.hero?._heroFaceCrop, 'มี solo จริงต้องไม่ไปพึ่ง synth crop');
  });
});

test('MEGA_HERO_SINGLE ON: ไม่มีภาพเดี่ยว + หน้า hero ใหญ่พอ → ครอปจากภาพคู่ (_heroFaceCrop) แทนการ HOLD', async () => {
  await withEnv('MEGA_HERO_SINGLE', null, async () => {
    const couple = coupleBig();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(couple), fetchJson: fetchStub([couple]) },
    });
    assert.equal(r.status, 'done');
    const heroSlot = r.dossierPatch.pickImages.slots.hero;
    assert.equal(heroSlot?.id, 'COUPLE-1', 'ยังเป็นภาพเดิม (ครอปจากใบเดียวกัน ไม่ใช่สลับภาพ)');
    assert.ok(heroSlot?._heroFaceCrop, 'ต้องมี _heroFaceCrop แนบมา');
    const c = heroSlot._heroFaceCrop;
    assert.ok(c.w > 0 && c.h > 0 && c.x >= 0 && c.y >= 0 && c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001, 'กรอบครอปต้อง normalized ถูกต้อง');
    // ครอปต้องเล็กกว่าเต็มภาพ (ตัดคนที่ 2 ออกจริง ไม่ใช่ทั้งภาพ)
    assert.ok(c.w < 1 && c.h < 1);
  });
});

test('MEGA_HERO_SINGLE ON: ไม่มีภาพเดี่ยว + หน้า hero เล็กเกิน (ครอปแล้ว shortSide<700) → HOLD ไม่ใช่ภาพคู่', async () => {
  await withEnv('MEGA_HERO_SINGLE', null, async () => {
    const coupleS = coupleSmall();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(coupleS), fetchJson: fetchStub([coupleS]) },
    });
    assert.equal(r.status, 'quality_hold');
    assert.equal(r.nextAction, 'hold');
    assert.equal(r.holdStatus, 'insufficient_assets');
    assert.equal(r.dossierPatch.pickImages.heroSingleFaceHold.reason, 'crop_too_small');
    assert.ok(r.dossierPatch.pickImages.heroSingleFaceHold.shortSide < HERO_MIN_SHORT_SIDE);
  });
});

test('MEGA_HERO_SINGLE ON: กล่องหน้าเป็นของตัวประกอบ (person ไม่ตรง hero) → แมปตัวตนไม่ได้ → HOLD (ห้ามเดาครอปคนผิด)', async () => {
  await withEnv('MEGA_HERO_SINGLE', null, async () => {
    const coupleWrongPerson = coupleBig(OTHER); // triage.person = 'คิว' (ไม่ใช่ hero) แม้ persons มี hero อยู่ด้วย
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(coupleWrongPerson), fetchJson: fetchStub([coupleWrongPerson]) },
    });
    assert.equal(r.status, 'quality_hold');
    assert.equal(r.holdStatus, 'insufficient_assets');
    assert.equal(r.dossierPatch.pickImages.heroSingleFaceHold.reason, 'no_identity_mapped_box');
  });
});

test('MEGA_HERO_SINGLE ON: fallback tier (brain ล่ม) — หน้าเดี่ยว+ขนาดพอ ต้องชนะภาพคู่เสมอเมื่อมี', async () => {
  await withEnv('MEGA_HERO_SINGLE', null, async () => {
    const couple = coupleBig();
    const soloImg = solo();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      // NO_BRAIN → img เริ่มจาก null เสมอ → เข้าทาง fallback pickFrom ตรงๆ (ไม่ผ่าน soft-swap block)
      _deps: { ...NO_BRAIN, fetchJson: fetchStub([couple, soloImg]) },
    });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'SOLO-1', 'fallback ต้องเลือกหน้าเดี่ยวก่อนภาพคู่');
  });
});

// ============================================================
// s5_search: hasSingleFace gate ต้องผูก heroNames (ไม่ใช่หน้าเดี่ยวของใครก็ได้)
// ============================================================
function mkJobS5(extraImagesState = {}) {
  return {
    dossier: {
      images: { caseId: 'CASE-S5-GATE', searchedPlatforms: ['google'], ...extraImagesState },
      compass: { mainCharacters: [{ name: HERO, role: 'hero' }, { name: OTHER, role: 'someone_else' }] },
      desk: { title: 'ข่าวทดสอบ s5 gate' },
    },
  };
}

const soloRelevantOfOther = { id: 'S5-OTHER-SOLO', triage: { relevant: true, clean: true, faceCount: 1, person: OTHER, persons: [OTHER], category: 'face-emotional', quality: 7 } };

test('s5_search: หน้าเดี่ยวของ "ตัวประกอบ" เท่านั้นในพูล → ไม่นับว่า "พอ" (ต้องเป็นหน้าเดี่ยวของ hero) — ON', async () => {
  await withEnv('MEGA_HERO_SINGLE', null, async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/images/CASE-S5-GATE')) {
        return { status: 200, json: async () => ({ success: true, images: [soloRelevantOfOther] }) };
      }
      throw new Error('unexpected global fetch: ' + url);
    };
    try {
      // ต้องมีภาพ clean+relevant ≥ MIN_RELEVANT_IMAGES(1) จาก POST search เพื่อให้ enough=true ก่อนเช็ค hasSingleFace
      const searchPool = [{ id: 'CLEAN-1', triage: { relevant: true, clean: true } }];
      const r = await s5_search(mkJobS5(), {
        origin: 'http://mock',
        _deps: { fetchJson: async () => ({ success: true, found: 1, added: 1, images: searchPool }) },
      });
      // ยังไม่พอ (หน้าเดี่ยวของตัวประกอบไม่นับ) → เดินหน้าค้นแหล่งถัดไปต่อ (ไม่หยุดเงียบๆ)
      assert.equal(r.status, 'waiting');
      assert.equal(r.nextAction, 'wait');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

test('s5_search: MEGA_HERO_SINGLE=0 → พฤติกรรมเดิมเป๊ะ (หน้าเดี่ยวของใครก็ได้นับว่าพอ)', async () => {
  await withEnv('MEGA_HERO_SINGLE', '0', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/images/CASE-S5-GATE')) {
        return { status: 200, json: async () => ({ success: true, images: [soloRelevantOfOther] }) };
      }
      throw new Error('unexpected global fetch: ' + url);
    };
    try {
      const searchPool = [{ id: 'CLEAN-1', triage: { relevant: true, clean: true } }];
      const r = await s5_search(mkJobS5(), {
        origin: 'http://mock',
        _deps: { fetchJson: async () => ({ success: true, found: 1, added: 1, images: searchPool }) },
      });
      // OFF: หน้าเดี่ยวของใครก็ได้นับว่าพอ → หยุดค้น (status done, staged skip)
      assert.equal(r.status, 'done');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
