// ============================================================
// 🩹 เฟส B-2 (29 ก.ค. 69 — ต่อจาก B-1 c201f9e) — หลักฐาน AC-0210/MCV-ms5wwdv2sy2: ช่องบน 2 ช่องได้ภาพเดียวกัน
//   เกือบเป๊ะ (มุมกว้าง+ซูมช็อตเดิม) — dup gate เดิมจับไม่ได้
// ------------------------------------------------------------
// ข้อ 1 MEGA_SUBSLOT_FACE_GATE: ช่องคน (reaction/action/circle) หัวขาด/ไม่เห็นหน้า → สลับหาใบเห็นหน้า
// ข้อ 4 MEGA_CIRCLE_NOT_HERO: วงกลมเป็นคนเดียวกับ hero → สลับหาคนอื่น
// ข้อ 5 MEGA_WM_KEPT_BACKUP: watermarkKept เข้าวง BS (backup swap) แทนจบแค่ธง
// ทดสอบ _runSecondEye (ข้อ 1, 4) โดยตรง — แพทเทิร์นเดียวกับ tests/mega-second-eye.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';

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

const { _runSecondEye } = await import('../src/lib/megaAdapters.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };
const setEnv = (k, v) => { if (v === null || v === undefined) delete process.env[k]; else process.env[k] = v; };
const mkFetch = () => async () => ({ data: 'ZmFrZQ==', mimeType: 'image/jpeg' });
const mkById = (records) => new Map(records.map((r) => [String(r.id), r]));
const mkSlots = (picks) => Object.fromEntries(Object.entries(picks).map(([role, p]) => [role, { ...p }]));
const activeSlots = ['hero', 'reaction', 'action', 'context', 'circle'];

// ============================================================
// ข้อ 1 — MEGA_SUBSLOT_FACE_GATE
// ============================================================
await test('B2(1) reaction หัวขาด (faceVisible=0) + มี backup เห็นหน้าเต็ม (faceVisible=2) ในพูล → สลับจริง', async () => {
  setEnv('MEGA_SUBSLOT_FACE_GATE', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'rb1', imageUrl: 'https://x/rb1.jpg' }, // สำรองของ reaction
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: ['rb1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 }; // hero โอเค
          if (i === 1) return { index: 1, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0 }; // reaction หัวขาด
          return { index: 2, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 }; // backup เห็นหน้าเต็ม
        }),
      }),
    },
  });
  assert.equal(slots.reaction.id, 'rb1', 'reaction ต้องสลับไปใบที่เห็นหน้า');
  assert.equal(r.faceGateReplaced, 1);
  assert.ok(!slots.reaction._secondEyeSubSlotFlag, 'สลับสำเร็จ ไม่ควรมีธงค้าง');
});

await test('B2(1) action ไม่มีคนเลย (faceCount=0) + ไม่มี backup เห็นหน้าเลย → คงเดิม + ติดธง subslot_no_face', async () => {
  setEnv('MEGA_SUBSLOT_FACE_GATE', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'a1', imageUrl: 'https://x/a1.jpg' },
    { id: 'ab1', imageUrl: 'https://x/ab1.jpg' }, // backup ก็ไม่มีหน้าเหมือนกัน
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, action: { id: 'a1', backups: ['ab1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'action'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 };
          return { index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0 };
        }),
      }),
    },
  });
  assert.equal(slots.action.id, 'a1', 'ไม่มีตัวเลือกเห็นหน้าจริง — ต้องคงเดิม');
  assert.equal(slots.action._secondEyeSubSlotFlag, 'subslot_no_face');
  assert.equal(r.faceGateReplaced, 0);
});

await test('B2(1) ปกสายวัตถุ/สถานที่ (พูลทั้งหมดไม่มีหน้าใครเลย) → ข้ามด่านนี้ทั้งก้อน ไม่ติดธง subslot_no_face มั่ว', async () => {
  setEnv('MEGA_SUBSLOT_FACE_GATE', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' }, // hero เองก็เป็นภาพวัตถุ
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0 })),
      }),
    },
  });
  assert.ok(!slots.reaction._secondEyeSubSlotFlag, 'ปกไร้คนทั้งใบ — ไม่ควรบังคับหาหน้าที่ไม่มีอยู่จริง');
  assert.equal(r.faceGateReplaced, 0);
});

await test('B2(1) context (ไม่ใช่ช่องคน) หัวขาด/ไม่มีหน้า → ไม่ถูกด่านนี้แตะเลย (context เป็นวัตถุ/สถานที่ได้ปกติ)', async () => {
  setEnv('MEGA_SUBSLOT_FACE_GATE', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'c1', imageUrl: 'https://x/c1.jpg' },
    { id: 'cb1', imageUrl: 'https://x/cb1.jpg' },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, context: { id: 'c1', backups: ['cb1'] } });
  await _runSecondEye({
    slots, activeSlots: ['hero', 'context'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 0
          ? { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 }
          : { index: i, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0 })),
      }),
    },
  });
  assert.equal(slots.context.id, 'c1', 'context ไม่ใช่ช่องคน — ไม่ควรถูกสลับ');
  assert.ok(!slots.context._secondEyeSubSlotFlag, 'context ไม่ควรติดธง subslot_no_face เลย');
});

await test('B2(1) kill-switch=0 → ไม่ทำงานเลย แม้หัวขาดจริงและมี backup เห็นหน้า', async () => {
  setEnv('MEGA_SUBSLOT_FACE_GATE', '0');
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
    { id: 'rb1', imageUrl: 'https://x/rb1.jpg' },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: ['rb1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 };
          if (i === 1) return { index: 1, textFound: '', faceBox: null, faceCount: 0, faceVisible: 0 };
          return { index: 2, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 };
        }),
      }),
    },
  });
  setEnv('MEGA_SUBSLOT_FACE_GATE', null);
  assert.equal(slots.reaction.id, 'r1', 'flag ปิด — ต้องคงเดิมทุกอย่าง (byte-parity)');
  assert.equal(r.faceGateReplaced, 0);
  assert.ok(!slots.reaction._secondEyeSubSlotFlag);
});

// ============================================================
// ข้อ 4 — MEGA_CIRCLE_NOT_HERO
// ============================================================
await test('B2(4) circle เป็นคนเดียวกับ hero (sameAsHeroPerson=true) + มี backup เป็นคนอื่น → สลับจริง', async () => {
  setEnv('MEGA_CIRCLE_NOT_HERO', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' }, // circle เดิม = คนเดียวกับ hero
    { id: 'cib1', imageUrl: 'https://x/cib1.jpg' }, // backup = คนละคน
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, circle: { id: 'ci1', backups: ['cib1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 };
          if (i === 1) return { index: 1, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2, sameAsHeroPerson: true };
          return { index: 2, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2, sameAsHeroPerson: false };
        }),
      }),
    },
  });
  assert.equal(slots.circle.id, 'cib1', 'circle ต้องสลับไปคนอื่น');
  assert.equal(r.circleNotHeroReplaced, 1);
  assert.ok(!slots.circle._secondEyeSubSlotFlag);
});

await test('B2(4) circle เป็นคนเดียวกับ hero + ไม่มี backup เป็นคนอื่นเลย → คงเดิม + ติดธง circle_same_as_hero', async () => {
  setEnv('MEGA_CIRCLE_NOT_HERO', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
    { id: 'cib1', imageUrl: 'https://x/cib1.jpg' }, // backup ก็เป็นคนเดียวกับ hero
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, circle: { id: 'ci1', backups: ['cib1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 };
          return { index: i, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2, sameAsHeroPerson: true };
        }),
      }),
    },
  });
  assert.equal(slots.circle.id, 'ci1');
  assert.equal(slots.circle._secondEyeSubSlotFlag, 'circle_same_as_hero');
  assert.equal(r.circleNotHeroReplaced, 0);
});

await test('B2(4) circle เป็นคนอื่นอยู่แล้ว (sameAsHeroPerson=false) → ไม่ทำอะไรเลย (ไม่มีปัญหาให้แก้)', async () => {
  setEnv('MEGA_CIRCLE_NOT_HERO', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, circle: { id: 'ci1', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => (i === 0
          ? { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 }
          : { index: 1, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2, sameAsHeroPerson: false })),
      }),
    },
  });
  assert.equal(slots.circle.id, 'ci1');
  assert.ok(!slots.circle._secondEyeSubSlotFlag);
  assert.equal(r.circleNotHeroReplaced, 0);
});

await test('B2(4) kill-switch=0 → ไม่ทำงานเลย แม้ circle เป็นคนเดียวกับ hero จริงและมีตัวเลือกอื่น', async () => {
  setEnv('MEGA_CIRCLE_NOT_HERO', '0');
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' },
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg' },
    { id: 'cib1', imageUrl: 'https://x/cib1.jpg' },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, circle: { id: 'ci1', backups: ['cib1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => {
          if (i === 0) return { index: 0, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 };
          if (i === 1) return { index: 1, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2, sameAsHeroPerson: true };
          return { index: 2, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2, sameAsHeroPerson: false };
        }),
      }),
    },
  });
  setEnv('MEGA_CIRCLE_NOT_HERO', null);
  assert.equal(slots.circle.id, 'ci1', 'flag ปิด — ต้องคงเดิม (byte-parity)');
  assert.equal(r.circleNotHeroReplaced, 0);
  assert.ok(!slots.circle._secondEyeSubSlotFlag);
});

// ============================================================
// ข้อ 2 — MEGA_SLOT_DEDUP_STRICT (pHash64 hamming, ไม่ใช้ LLM — คำนวณจาก triage.pHash64 ที่มีอยู่แล้ว)
// ------------------------------------------------------------
// threshold hamming≤10 (PHASH_DUP_HAMMING_MAX, slotSolver.js — ค่าเดียวกับ duplicate_scene เดิมที่ megaComposerService.js ใช้)
// hex 16 ตัว = 64 บิต: '000...0' vs '000...7' → XOR nibble สุดท้าย 0^7=0111 → popcount 3 (ใกล้ ≤10)
//                       '000...0' vs 'fff...f' → XOR ทุก nibble = f (1111) ×16 → popcount 64 (ไกลมาก)
// ============================================================
const PHASH_NEAR = '0000000000000000';
const PHASH_NEAR_DUP = '0000000000000007'; // hamming = 3 (≤10 → ถือว่าซ้ำ)
const PHASH_FAR = 'ffffffffffffffff'; // hamming = 64 (ไกลมาก ไม่ซ้ำ)
const PHASH_FAR2 = '3333333333333333'; // อีกค่าที่ไกลจากทั้ง PHASH_NEAR/PHASH_NEAR_DUP/PHASH_FAR (กันชนกันเองระหว่าง hero กับ backup ในเทส)

await test('B2(2) reaction+action pHash64 ใกล้กันมาก (hamming=3) + ทั้งคู่มีหน้า (จุดที่ duplicate_scene เดิมพลาด) + มี backup pHash ไกล → สลับจริง', async () => {
  setEnv('MEGA_SLOT_DEDUP_STRICT', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { pHash64: PHASH_FAR } },
    { id: 'r1', imageUrl: 'https://x/r1.jpg', triage: { pHash64: PHASH_NEAR } },
    { id: 'a1', imageUrl: 'https://x/a1.jpg', triage: { pHash64: PHASH_NEAR_DUP } }, // ใกล้กับ r1 มาก (hamming=3)
    { id: 'ab1', imageUrl: 'https://x/ab1.jpg', triage: { pHash64: PHASH_FAR2 } }, // backup ของ action — ไกลจากทุกช่อง (รวมถึง hero เอง กันชนกันเอง)
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] }, action: { id: 'a1', backups: ['ab1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      // ★ ทั้ง reaction และ action ตาสองเห็นว่า "มีหน้าจริงทั้งคู่" — จุดที่ duplicate_scene เดิม (composer, aHash)
      //   ยกเว้นไปเพราะเกณฑ์ "ฝั่งใดฝั่งหนึ่งไร้หน้า" — dedup-strict ต้องไม่ยกเว้นแบบนั้น
      callGeminiVision: async ({ images }) => ({
        results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 })),
      }),
    },
  });
  assert.equal(slots.action.id, 'ab1', 'action (ลำดับหลัง reaction ใน SLOT_CANON_ORDER) ต้องถูกสลับ (ระหว่างช่องย่อยด้วยกัน — ไม่มีใครเป็น hero)');
  assert.equal(slots.reaction.id, 'r1', 'reaction ไม่ต้องถูกแตะ');
  assert.equal(r.dedupStrictReplaced, 1);
  assert.ok(!slots.action._secondEyeSubSlotFlag);
});

await test('B2(2) hero+circle pHash64 ใกล้กันมาก → hero ชนะเสมอ circle ถูกสลับ (ไม่มี backup → ติดธง subslot_dedup_strict)', async () => {
  setEnv('MEGA_SLOT_DEDUP_STRICT', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { pHash64: PHASH_NEAR } },
    { id: 'ci1', imageUrl: 'https://x/ci1.jpg', triage: { pHash64: PHASH_NEAR_DUP } }, // ใกล้กับ hero มาก
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, circle: { id: 'ci1', backups: [] } }); // ไม่มี backup เลย
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'circle'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 })) }),
    },
  });
  assert.equal(slots.hero.id, 'h1', 'hero ต้องไม่ถูกแตะ (ชนะเสมอ)');
  assert.equal(slots.circle.id, 'ci1', 'ไม่มี backup — circle คงเดิม');
  assert.equal(slots.circle._secondEyeSubSlotFlag, 'subslot_dedup_strict');
  assert.equal(r.dedupStrictReplaced, 0);
});

await test('B2(2) pHash64 ไกลกันมาก (hamming=64) → ไม่ถือว่าซ้ำ ไม่ทำอะไรเลย', async () => {
  setEnv('MEGA_SLOT_DEDUP_STRICT', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { pHash64: PHASH_FAR } },
    { id: 'r1', imageUrl: 'https://x/r1.jpg', triage: { pHash64: PHASH_NEAR } },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 })) }),
    },
  });
  assert.equal(slots.reaction.id, 'r1');
  assert.ok(!slots.reaction._secondEyeSubSlotFlag);
  assert.equal(r.dedupStrictReplaced, 0);
});

await test('B2(2) pHash64 ไม่มีค่า (null — ภาพเก่า/วัดไม่ได้) → fail-open ไม่เช็ค ไม่ throw', async () => {
  setEnv('MEGA_SLOT_DEDUP_STRICT', null);
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg' }, // ไม่มี triage เลย
    { id: 'r1', imageUrl: 'https://x/r1.jpg' },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 })) }),
    },
  });
  assert.equal(slots.reaction.id, 'r1');
  assert.equal(r.dedupStrictReplaced, 0);
});

await test('B2(2) kill-switch=0 → ไม่ทำงานเลย แม้ pHash64 ใกล้กันมากและมี backup ปลอดภัย', async () => {
  setEnv('MEGA_SLOT_DEDUP_STRICT', '0');
  const records = [
    { id: 'h1', imageUrl: 'https://x/h1.jpg', triage: { pHash64: PHASH_FAR } },
    { id: 'r1', imageUrl: 'https://x/r1.jpg', triage: { pHash64: PHASH_NEAR } },
    { id: 'a1', imageUrl: 'https://x/a1.jpg', triage: { pHash64: PHASH_NEAR_DUP } },
    { id: 'ab1', imageUrl: 'https://x/ab1.jpg', triage: { pHash64: PHASH_FAR } },
  ];
  const slots = mkSlots({ hero: { id: 'h1', backups: [] }, reaction: { id: 'r1', backups: [] }, action: { id: 'a1', backups: ['ab1'] } });
  const r = await _runSecondEye({
    slots, activeSlots: ['hero', 'reaction', 'action'], byId: mkById(records),
    _deps: {
      fetchImageB64: mkFetch(),
      callGeminiVision: async ({ images }) => ({ results: images.map((_, i) => ({ index: i, textFound: '', faceBox: null, faceCount: 1, faceVisible: 2 })) }),
    },
  });
  setEnv('MEGA_SLOT_DEDUP_STRICT', null);
  assert.equal(slots.action.id, 'a1', 'flag ปิด — ต้องคงเดิมทุกอย่าง (byte-parity)');
  assert.equal(r.dedupStrictReplaced, 0);
  assert.ok(!slots.action._secondEyeSubSlotFlag);
});

// ============================================================
// ข้อ 5 — MEGA_WM_KEPT_BACKUP (megaComposerService.js BS trigger)
// ------------------------------------------------------------
// BS (megaComposerService.js) ไม่มี _deps injection ให้ควบคุม traceSink โดยตรง (ต่างจาก _runSecondEye) และ
// การจำลอง "watermarkKept:true จริงผ่าน composeAndVerify เต็มท่อ" ต้องคุมเรขาคณิตครอปละเอียดมาก (การครอปจริง
// ผ่านหลายชั้นก่อนถึงจุด avoidWatermarkEdgePx) — ยืนยันด้วยการอ่านซอร์สตรง (แพทเทิร์นเดียวกับ 4 trigger เดิม
// circleAvoidNeedsBackup/refineNeedsBackup/cleanNeedsBackup/peopleNeedsBackup ที่ regression suite เดิมพิสูจน์
// กลไก accept/reject ของ BS ถูกต้องอยู่แล้ว — งานนี้แค่เพิ่ม watermarkKept เป็น trigger ที่ 5 ด้วยรูปแบบเดียวกันเป๊ะ)
// ============================================================
await test('B2(5) เสียบจริง: BS trigger condition มี tt.watermarkKept ร่วมกับ 4 ธงเดิม + gate ด้วย _wmKeptBackupOn()', () => {
  const src = fs.readFileSync(new URL('../src/lib/services/megaComposerService.js', import.meta.url), 'utf8');
  assert.match(src, /function _wmKeptBackupOn\(\)\s*\{\s*return process\.env\.MEGA_WM_KEPT_BACKUP !== '0';\s*\}/, 'ต้องมี kill-switch helper แบบเดียวกับ trigger เดิมทุกตัว (default ON)');
  assert.match(
    src,
    /tt\.circleAvoidNeedsBackup === true \|\| tt\.refineNeedsBackup === true \|\| tt\.cleanNeedsBackup === true \|\| tt\.peopleNeedsBackup === true \|\| \(_wmKeptBackupOn\(\) && tt\.watermarkKept === true\)/,
    'watermarkKept ต้องเป็น trigger ที่ 5 ในเงื่อนไขเดียวกับ 4 ตัวเดิม (ไม่ใช่ if แยก — เดิน accept/reject เดียวกันเป๊ะ)',
  );
});

await test('B2(5) เสียบจริง: traceQcFlags() (ตัวคำนวณ _preFlagN/_newFlagN ที่ BS ใช้ตัดสินรับ/ปฏิเสธ) รู้จัก watermarkKept อยู่แล้ว (มาจากแบตช์ C ก่อนหน้า ไม่ต้องแก้จุดนั้น)', () => {
  const src = fs.readFileSync(new URL('../src/lib/services/megaComposerService.js', import.meta.url), 'utf8');
  assert.match(src, /if \(tt\.watermarkKept\) out\.push\('watermark_kept'\);/, 'traceQcFlags ต้องนับ watermark_kept อยู่แล้ว — BS เทียบ "ธงน้อยกว่า" ได้ถูกต้องทันทีที่ trigger เพิ่มเข้าไป');
});

console.log(`\n# mega-slot-defect-gate-b2 (items 1+2+4+5): ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
