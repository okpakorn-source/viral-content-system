// ============================================================
// 🧪 MEGA_HERO_SOLO_ONLY (20 ก.ค. 69) — hero ต้องใช้ "ภาพเดี่ยวจริง" (faceCount===1) เท่านั้น
// kill-switch: MEGA_HERO_SOLO_ONLY (default ON, '0' = พฤติกรรมเดิม synth-crop byte-parity)
// ------------------------------------------------------------
// ลำดับบังคับ (ผู้ใช้เคาะ): (1) เดี่ยวในพูล → (2) ยืมเดี่ยวคนเดียวกัน(hero)จากเคสอื่น → (3) ไม่ได้ = HOLD (ห้ามครอปภาพคู่)
// พิสูจน์ (s6_slots):
//   (a) OFF ('0')  : พูลไม่มีเดี่ยว → synth crop ทำงานเดิม (ได้ _heroFaceCrop) = byte-parity + ไม่ยืม
//   (b) ON + พูลมีเดี่ยว → ใช้เดี่ยว (solo-swap เดิม) ไม่ยืม ไม่ครอป
//   (c) ON + ไม่มีเดี่ยว + ยืมได้ (mock คืน solo) → ใช้ borrowed solo (newsScene:false) ไม่มี _heroFaceCrop
//   (d) ON + ไม่มีเดี่ยว + ยืมไม่ได้ (mock คืน []) → HOLD (quality_hold / insufficient_assets) ไม่มีภาพคู่ขึ้น hero
//   (e) ON + ไม่มีเดี่ยว + ยืมได้แต่เป็น "ภาพคู่" (mock คืน couple) → กรองทิ้ง (รับเฉพาะเดี่ยว) → HOLD
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
// + CROSS_CASE_BORROW ปิด เพื่อให้ borrow ที่ยิงเป็น "SOLO_ONLY-scoped" (hero solo) ไม่ใช่ legacy borrow ทุกคน
for (const k of [
  'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_REF_SHOT_AUTHORITY', 'MEGA_SLOT_SOLVER_LIVE',
  'MEGA_REF_HERO_V2', 'MEGA_ROLE_READINESS', 'MEGA_FINAL_DECISION_EVIDENCE_V2', 'MEGA_CROSS_CASE_BORROW',
]) delete process.env[k];

const { s6_slots } = await import('@/lib/megaAdapters');

const HERO_MIN_SHORT_SIDE = 700; // ../src/lib/imageQualityConfig.js (single source of truth)
const HERO = 'เป็กกี้';
const OTHER = 'คิว';

// withEnv สำหรับ MEGA_HERO_SOLO_ONLY: v=null → ลบ (default ON) · v='0' → OFF
const withSoloOnly = async (v, fn) => {
  const prev = process.env.MEGA_HERO_SOLO_ONLY;
  if (v == null) delete process.env.MEGA_HERO_SOLO_ONLY; else process.env.MEGA_HERO_SOLO_ONLY = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.MEGA_HERO_SOLO_ONLY; else process.env.MEGA_HERO_SOLO_ONLY = prev; }
};

function mkJob() {
  return {
    dossier: {
      images: { caseId: 'CASE-HERO-SOLO-ONLY' },
      compass: {
        angle: 'มุมทดสอบ hero ภาพเดี่ยวเท่านั้น', primaryEmotion: 'warm', secondaryEmotions: [],
        mainCharacters: [{ name: HERO, role: 'hero' }, { name: OTHER, role: 'someone_else' }],
        visualDreamShots: [], doNotUse: [],
      },
      desk: { title: 'ข่าวทดสอบ hero solo-only' },
      // refMatch หลวม (typeMatched:false) → _refDNA=null → _cropGuard ไม่ทำงาน (เดินสาย legacy ล้วน)
      refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
      artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
    },
  };
}

// ภาพคู่ [เป็กกี้, คิว] — กรอบหน้าใหญ่พอครอปแล้วผ่านเกณฑ์ (realWidth 2400 → shortSide หลังครอป ~840px)
const coupleBig = (person = HERO) => ({
  id: 'COUPLE-1',
  imageUrl: 'https://cdn.test/COUPLE-1.jpg',
  realWidth: 2400, realHeight: 1500,
  triage: {
    relevant: true, clean: true, faceCount: 2, person, persons: [HERO, OTHER],
    category: 'group', emotion: 'happy', note: '', newsScene: true, quality: 8,
    faceBox: { x: 0.1, y: 0.15, w: 0.25, h: 0.35 },
    peopleBox: { x: 0.05, y: 0.1, w: 0.6, h: 0.6 },
  },
});
// ภาพเดี่ยวของ hero ในเคสนี้
const solo = () => ({
  id: 'SOLO-1',
  imageUrl: 'https://cdn.test/SOLO-1.jpg',
  realWidth: 1200, realHeight: 1500,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'warm', note: '', newsScene: true, quality: 7,
  },
});
// ภาพเดี่ยว hero จาก "เคสอื่น" (ต้นฉบับ 100% — ยืมมา ไม่เจน)
const borrowedSolo = () => ({
  id: 'BORROW-SOLO-1',
  imageUrl: 'https://cdn.test/BORROW-SOLO-1.jpg',
  realWidth: 1200, realHeight: 1500, caseId: 'OTHER-CASE-Z',
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'warm', note: '', newsScene: true, quality: 8,
  },
});
// ภาพคู่จากเคสอื่น (ใช้พิสูจน์: ยืมได้แต่เป็นคู่ → ต้องถูกกรองทิ้ง)
const borrowedCouple = () => ({
  id: 'BORROW-COUPLE-1',
  imageUrl: 'https://cdn.test/BORROW-COUPLE-1.jpg',
  realWidth: 2400, realHeight: 1500, caseId: 'OTHER-CASE-Y',
  triage: {
    relevant: true, clean: true, faceCount: 2, person: HERO, persons: [HERO, OTHER],
    category: 'group', emotion: 'happy', note: '', newsScene: true, quality: 8,
  },
});

const NO_BRAIN = { slotDirectorBrain: async () => { throw new Error('test-stub-no-brain'); } };
const brainPicksCouple = (coupleImg) => ({
  slotDirectorBrain: async () => ({ slots: { hero: { id: coupleImg.id, reason: 'brain เลือกภาพคู่ (stub)' } }, note: 'stub-brain' }),
});
const fetchStub = (pool) => async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected fetch: ' + url); })());

// (a) OFF — พูลไม่มีเดี่ยว → synth crop เดิมทำงาน (byte-parity MEGA_HERO_SINGLE) + ไม่ยืม
test('(a) OFF (MEGA_HERO_SOLO_ONLY=0): พูลไม่มีเดี่ยว → synth crop เดิม (_heroFaceCrop) = byte-parity + ไม่แตะ findImagesByPerson', async () => {
  await withSoloOnly('0', async () => {
    const calls = [];
    const couple = coupleBig();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(couple), fetchJson: fetchStub([couple]), findImagesByPerson: async (a) => { calls.push(a); return [borrowedSolo()]; } },
    });
    assert.equal(r.status, 'done');
    const hero = r.dossierPatch.pickImages.slots.hero;
    assert.equal(hero?.id, 'COUPLE-1', 'ยังเป็นภาพเดิม (ครอปจากใบเดียวกัน)');
    assert.ok(hero?._heroFaceCrop, 'OFF ต้องได้ _heroFaceCrop จาก synth crop เดิม');
    assert.equal(calls.length, 0, 'OFF (CROSS ปิดด้วย) ต้องไม่ยืมข้ามเคส');
  });
});

// (b) ON + พูลมีเดี่ยว → ใช้เดี่ยว (solo-swap เดิม) ไม่ยืม ไม่ครอป
test('(b) ON + พูลมีภาพเดี่ยว → ใช้เดี่ยว (solo-swap เดิม) ไม่ยืม ไม่ครอป', async () => {
  await withSoloOnly(null, async () => {
    const calls = [];
    const couple = coupleBig();
    const soloImg = solo();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(couple), fetchJson: fetchStub([couple, soloImg]), findImagesByPerson: async (a) => { calls.push(a); return [borrowedSolo()]; } },
    });
    assert.equal(r.status, 'done');
    const hero = r.dossierPatch.pickImages.slots.hero;
    assert.equal(hero?.id, 'SOLO-1');
    assert.equal(hero?.faces, 1);
    assert.ok(!hero?._heroFaceCrop, 'มีเดี่ยวจริง → ไม่พึ่ง synth crop');
    assert.equal(calls.length, 0, 'มีเดี่ยวในพูลแล้ว → ไม่ต้องยืม');
  });
});

// (c) ON + ไม่มีเดี่ยว + ยืมได้ → ใช้ borrowed solo
test('(c) ON + พูลไม่มีเดี่ยว + ยืมได้ (mock คืน solo) → ใช้ borrowed solo (newsScene:false) ไม่มี _heroFaceCrop', async () => {
  await withSoloOnly(null, async () => {
    const calls = [];
    const couple = coupleBig();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(couple), fetchJson: fetchStub([couple]), findImagesByPerson: async (a) => { calls.push(a); return [borrowedSolo()]; } },
    });
    assert.equal(r.status, 'done');
    const hero = r.dossierPatch.pickImages.slots.hero;
    assert.equal(hero?.id, 'BORROW-SOLO-1', 'hero ต้องเป็นภาพเดี่ยวที่ยืมมา');
    assert.equal(hero?.faces, 1);
    assert.equal(hero?.newsScene, false, 'ภาพยืมติดป้าย newsScene:false');
    assert.ok(!hero?._heroFaceCrop, 'ใช้เดี่ยวจริง (ยืม) → ไม่มี synth crop ภาพคู่');
    // เรียก findImagesByPerson เฉพาะชื่อ role=hero + อาร์กิวเมนต์ถูกต้อง
    assert.equal(calls.length, 1);
    assert.equal(calls[0].personName, HERO);
    assert.equal(calls[0].excludeCaseId, 'CASE-HERO-SOLO-ONLY');
    assert.equal(calls[0].minShortSide, HERO_MIN_SHORT_SIDE);
    assert.equal(calls[0].limit, 6);
  });
});

// (g) audit Finding 2: ON + solo "สกปรก" (clean:false) ในพูล → ไม่นับว่ามีเดี่ยว → ต้องยืมต่อ (ไม่ HOLD เกิน)
//   ก่อนฟิกซ์: hasSolo=true (นับ solo สกปรก) → ข้าม borrow → solo สกปรกถูกกรองจาก sorted → hero คงเป็นคู่ → HOLD ผิด
test('(g) ON + solo สกปรก (clean:false) → hasSolo ไม่บล็อก borrow → ใช้ borrowed solo (audit Finding 2)', async () => {
  await withSoloOnly(null, async () => {
    const calls = [];
    const couple = coupleBig();
    const dirtySoloImg = { ...solo(), id: 'DIRTY-SOLO-1', triage: { ...solo().triage, clean: false } };
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(couple), fetchJson: fetchStub([couple, dirtySoloImg]), findImagesByPerson: async (a) => { calls.push(a); return [borrowedSolo()]; } },
    });
    assert.equal(r.status, 'done');
    const hero = r.dossierPatch.pickImages.slots.hero;
    assert.equal(hero?.id, 'BORROW-SOLO-1', 'solo สกปรกไม่นับว่ามีเดี่ยว → ต้องยืม clean solo (ไม่ HOLD, ไม่ใช้ solo สกปรก)');
    assert.equal(calls.length, 1, 'solo สกปรกต้องไม่บล็อก borrow (Finding 2)');
  });
});

// (d) ON + ไม่มีเดี่ยว + ยืมไม่ได้ → HOLD (ห้ามครอปภาพคู่)
test('(d) ON + พูลไม่มีเดี่ยว + ยืมไม่ได้ (mock คืน []) → HOLD (quality_hold / insufficient_assets) ไม่มีภาพคู่ขึ้น hero', async () => {
  await withSoloOnly(null, async () => {
    const calls = [];
    const couple = coupleBig();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(couple), fetchJson: fetchStub([couple]), findImagesByPerson: async (a) => { calls.push(a); return []; } },
    });
    assert.equal(r.status, 'quality_hold');
    assert.equal(r.nextAction, 'hold');
    assert.equal(r.holdStatus, 'insufficient_assets');
    assert.equal(r.dossierPatch.pickImages.heroSingleFaceHold?.reason, 'solo_only_no_couple_crop', 'เหตุ HOLD ต้องระบุว่า SOLO_ONLY ไม่ครอปภาพคู่');
    // hero สุดท้ายยังเป็นภาพคู่ (id COUPLE, 2 หน้า) แต่ห้ามปล่อยเป็นผล done + ห้ามแนบ _heroFaceCrop
    assert.ok(!r.dossierPatch.pickImages.slots.hero?._heroFaceCrop, 'ห้ามครอปภาพคู่ (ไม่มี _heroFaceCrop)');
    assert.equal(calls.length, 1, 'ต้องพยายามยืมก่อนถึงจะ HOLD');
  });
});

// (e) ON + ไม่มีเดี่ยว + ยืมได้แต่เป็นภาพคู่ → กรองทิ้ง (รับเฉพาะเดี่ยว) → HOLD
test('(e) ON + พูลไม่มีเดี่ยว + ยืมได้แต่เป็น "ภาพคู่" → กรองทิ้ง (รับเฉพาะ faceCount===1) → HOLD', async () => {
  await withSoloOnly(null, async () => {
    const couple = coupleBig();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...brainPicksCouple(couple), fetchJson: fetchStub([couple]), findImagesByPerson: async () => [borrowedCouple()] },
    });
    assert.equal(r.status, 'quality_hold', 'ยืมมาแต่เป็นภาพคู่ → ไม่รับ → ยังไม่มีเดี่ยว → HOLD');
    assert.equal(r.holdStatus, 'insufficient_assets');
    assert.ok(!r.dossierPatch.pickImages.slots.hero?._heroFaceCrop);
  });
});

// (f) fallback tier (brain ล่ม) — ON + ยืมได้ → fallback ก็ต้องเลือก borrowed solo (ไม่ตกภาพคู่/ไม่ HOLD)
test('(f) ON + brain ล่ม + พูลไม่มีเดี่ยว + ยืมได้ → fallback เลือก borrowed solo (done, ไม่ HOLD)', async () => {
  await withSoloOnly(null, async () => {
    const couple = coupleBig();
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...NO_BRAIN, fetchJson: fetchStub([couple]), findImagesByPerson: async () => [borrowedSolo()] },
    });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'BORROW-SOLO-1');
    assert.ok(!r.dossierPatch.pickImages.slots.hero?._heroFaceCrop);
  });
});
