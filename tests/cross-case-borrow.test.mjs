// ============================================================
// 🧪 s6_slots — ยืมรูปข้ามเคส (cross-case image borrow), kill-switch MEGA_CROSS_CASE_BORROW
// ------------------------------------------------------------
// พิสูจน์: (1) OFF (default) = ไม่ยืมเลย ไม่มี field ใหม่ใน dossier (byte-parity legacy)
//          (2) ON + ตัวละครหลักไม่มีภาพหน้าดีในเคส → ยืมจากเคสอื่น (ผ่าน _deps.findImagesByPerson DI) ติดป้าย
//              borrowed/newsScene:false → ใช้ได้เฉพาะ hero/reaction/circle ห้ามลง context/action
//          (3) ยืมพัง (findImagesByPerson throw) → s6 ไม่ล้ม เดินจบปกติ
// เทคนิค: @/ alias resolve ผ่าน loader hook (แบบเดียวกับ s5-keywords-empty-guard.test.mjs) — ไม่ยิงเครือข่ายจริง
//   (brain/fetchJson/findImagesByPerson ฉีดผ่าน _deps ทั้งหมด)
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

// ล้าง shadow switches ทั้งหมดที่อาจเปลี่ยนเส้นทางไปสาย semantic/solver/ref-hero-v2 (เทสนี้ต้องเดินสาย legacy ล้วน)
for (const k of [
  'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_REF_SHOT_AUTHORITY', 'MEGA_SLOT_SOLVER_LIVE',
  'MEGA_REF_HERO_V2', 'MEGA_ROLE_READINESS', 'MEGA_FINAL_DECISION_EVIDENCE_V2',
]) delete process.env[k];

const { s6_slots } = await import('@/lib/megaAdapters');

const HERO_MIN_SHORT_SIDE = 700; // ../src/lib/imageQualityConfig.js (single source of truth — เทียบค่าคงที่เดียวกัน)

const IMG = (id, t = {}, top = {}) => ({
  id,
  imageUrl: `https://cdn.test/${id}.jpg`,
  thumbnailUrl: '',
  ...top,
  triage: { relevant: true, clean: true, faceCount: 1, person: null, persons: [], category: 'context', emotion: 'warm', note: '', newsScene: true, quality: 7, ...t },
});

const CASE_ID = 'CASE-CURRENT';
const PERSON = 'สมชาย ใจดี';

function mkJob() {
  return {
    dossier: {
      images: { caseId: CASE_ID },
      compass: { angle: 'มุมทดสอบยืมรูป', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: [{ name: PERSON, role: 'hero' }], visualDreamShots: [], doNotUse: [] },
      desk: { title: 'ข่าวทดสอบ cross-case borrow' },
      // ★ refMatch แบบ "หลวม" (typeMatched:false, ไม่มี dna) — กัน _refDNA/panelCount ตัด activeSlots +
      //   ให้ตรง branch "artBrief ที่มีอยู่แล้ว, unmarked" (ไม่เรียก artBriefBrain จริง)
      refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
      artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
    },
  };
}

const NO_BRAIN = { slotDirectorBrain: async () => { throw new Error('test-stub-no-brain'); } };
const fetchStub = (pool) => async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected fetch: ' + url); })());

const BASE = IMG('BASE-1', { person: 'คนอื่นในข่าว', category: 'context' }, { realWidth: 900, realHeight: 1200 });
const BORROW_1 = IMG('BORROW-1', { person: PERSON, category: 'face-emotional' }, { realWidth: 1200, realHeight: 1500, caseId: 'OTHER-CASE-A' });
const BORROW_2 = IMG('BORROW-2', { person: PERSON, category: 'context' }, { realWidth: 1200, realHeight: 1500, caseId: 'OTHER-CASE-B' });

const withEnv = async (v, fn) => {
  const prev = process.env.MEGA_CROSS_CASE_BORROW;
  if (v == null) delete process.env.MEGA_CROSS_CASE_BORROW; else process.env.MEGA_CROSS_CASE_BORROW = v;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.MEGA_CROSS_CASE_BORROW; else process.env.MEGA_CROSS_CASE_BORROW = prev; }
};

test('cross-case borrow OFF (default): ไม่เรียก findImagesByPerson เลย ไม่มี crossCaseBorrow ใน dossier', async () => {
  await withEnv(null, async () => {
    const calls = [];
    // มีภาพหน้าดีของตัวเอกอยู่แล้วในเคส (ไม่พึ่งยืม) — กันชนด่านเดิม "ไม่มีภาพตัวเอกที่ถูกคนเลย" ที่ไม่เกี่ยวกับ feature นี้
    const heroGradeInCase = IMG('IN-CASE-HERO', { person: PERSON, category: 'face-emotional' }, { realWidth: 1200, realHeight: 1500 });
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...NO_BRAIN, fetchJson: fetchStub([BASE, heroGradeInCase]), findImagesByPerson: async (a) => { calls.push(a); return [BORROW_1]; } },
    });
    assert.equal(r.status, 'done');
    assert.equal(calls.length, 0, 'ไม่ควรแตะ findImagesByPerson เลยตอน OFF');
    assert.ok(!('crossCaseBorrow' in r.dossierPatch.pickImages), 'OFF ต้องไม่มี field crossCaseBorrow');
  });
});

test('cross-case borrow ON: ตัวละครหลักไม่มีภาพหน้าดี → ยืมมาติดป้าย borrowed/newsScene:false — ลงได้เฉพาะ hero/circle ห้ามลง context/action', async () => {
  await withEnv('1', async () => {
    const calls = [];
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: {
        ...NO_BRAIN,
        fetchJson: fetchStub([BASE]),
        findImagesByPerson: async (args) => { calls.push(args); return [BORROW_1, BORROW_2]; },
      },
    });
    assert.equal(r.status, 'done');

    // เรียก findImagesByPerson ถูกอาร์กิวเมนต์
    assert.equal(calls.length, 1);
    assert.equal(calls[0].personName, PERSON);
    assert.equal(calls[0].excludeCaseId, CASE_ID);
    assert.equal(calls[0].minShortSide, HERO_MIN_SHORT_SIDE);
    assert.equal(calls[0].limit, 6);

    // dossier บอกยืมกี่ใบ/ใคร (additive field เฉพาะ ON)
    assert.deepEqual(r.dossierPatch.pickImages.crossCaseBorrow, { borrowedCount: 2, borrowedPersons: [PERSON] });

    const slots = r.dossierPatch.pickImages.slots;
    // hero/circle ใช้ภาพยืมได้จริง + ป้าย newsScene:false ติดมาด้วย
    assert.equal(slots.hero?.id, 'BORROW-1');
    assert.equal(slots.hero?.newsScene, false);
    assert.equal(slots.circle?.id, 'BORROW-2');
    assert.equal(slots.circle?.newsScene, false);
    // context/action ต้องไม่ได้ภาพยืม — ในเคสนี้ผู้สมัครที่เหลือมีแต่ภาพยืม (BORROW-2 ตรง hint พอดี)
    // → กติกา face-slots-only บล็อกจนช่องว่าง (ไม่ใช่หลุดเข้าไป)
    assert.equal(slots.action, null, 'action ต้องไม่ได้ภาพยืม (ว่างไปเลยดีกว่าลงผิดกติกา)');
    assert.equal(slots.context, null, 'context ต้องไม่ได้ภาพยืม (ว่างไปเลยดีกว่าลงผิดกติกา)');
    // reaction ได้ภาพในเคสเดิม (ไม่ใช่ภาพยืม) — พิสูจน์ borrow ไม่ได้แย่งช่องที่มีตัวเลือกจริงอยู่แล้วเสมอไป
    assert.equal(slots.reaction?.id, 'BASE-1');
  });
});

test('cross-case borrow ON แต่ findImagesByPerson พัง (throw) → s6 ไม่ throw ออกมา (เดินต่อไปจบด้วยผลลัพธ์ปกติ)', async () => {
  await withEnv('1', async () => {
    // เคสนี้ตัวเอกไม่มีภาพหน้าดีในเคสเลย + ยืมก็พัง → ไม่มีภาพตัวเอกให้ใช้จริง ๆ สักใบ
    // s6 ต้องคืน "ผลลัพธ์ควบคุมได้" ตามด่านเดิม (ที่มีอยู่ก่อน feature นี้) ไม่ใช่ throw ค้าง/unhandled — พิสูจน์ try/catch ของ borrow ทำงาน
    let threw = false;
    let r;
    try {
      r = await s6_slots(mkJob(), {
        origin: 'http://mock',
        _deps: { ...NO_BRAIN, fetchJson: fetchStub([BASE]), findImagesByPerson: async () => { throw new Error('boom-borrow'); } },
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 's6_slots ต้องไม่ throw ออกมาแม้ findImagesByPerson พัง');
    assert.equal(r.status, 'failed'); // ด่านเดิม (ไม่เกี่ยวกับ feature นี้): ไม่มีภาพตัวเอกที่ถูกคนเลย → fail แบบควบคุมได้ ไม่ใช่ crash
    assert.equal(r.dossierPatch.pickImages.slots.hero, null);
  });
});

test('cross-case borrow ON แต่ตัวละครหลักมีภาพหน้าดีอยู่แล้วในเคส → ไม่ยืม (ไม่แตะ findImagesByPerson)', async () => {
  await withEnv('1', async () => {
    const calls = [];
    const heroGradeInCase = IMG('IN-CASE-HERO', { person: PERSON, category: 'face-emotional' }, { realWidth: 1200, realHeight: 1500 });
    const r = await s6_slots(mkJob(), {
      origin: 'http://mock',
      _deps: { ...NO_BRAIN, fetchJson: fetchStub([BASE, heroGradeInCase]), findImagesByPerson: async (a) => { calls.push(a); return [BORROW_1]; } },
    });
    assert.equal(r.status, 'done');
    assert.equal(calls.length, 0, 'มีภาพหน้าดีในเคสแล้ว ไม่ควรยืม');
    assert.deepEqual(r.dossierPatch.pickImages.crossCaseBorrow, { borrowedCount: 0, borrowedPersons: [] });
  });
});
