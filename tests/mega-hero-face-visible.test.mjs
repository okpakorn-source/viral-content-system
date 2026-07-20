// ============================================================
// 🧪 MEGA_HERO_FACE_VISIBLE (20 ก.ค. 69) — hero ต้อง "เห็นหน้าจริง" ไม่ใช่แค่ faceCount===1
// kill-switch: MEGA_HERO_FACE_VISIBLE (default OFF, ต้อง '1' ถึงเปิด — polarity ตรงข้าม hero guards เดิม)
//   + MEGA_HERO_FACE_VISIBLE_MIN (default 0 = แค่ faceBox วัดได้ก็พอ; >0 = จับหน้าจิ๋วกว่าเกณฑ์ด้วย)
// ------------------------------------------------------------
// บั๊ก: ภาพหันหลัง/บังหน้า → Gemini คืน faceBox=null (schema "ไม่มีใบหน้าให้ null") แต่ faceCount ยังนับ "จำนวนคน"
//   → ภาพหลังหัวคนเดียว = faceCount 1 = "เดี่ยว" ผ่านทุกด่าน ขึ้น hero เงียบๆ (ไม่มีด่านไหนถามว่า "เห็นหน้าไหม")
// พิสูจน์ (s6_slots):
//   (a) OFF        : hero หลังหัว (faceBox=null) + พูลมีภาพเห็นหน้า → ยังปล่อยหลังหัวขึ้น hero (บั๊กเดิม = byte-parity)
//   (b) ON + สำรอง : hero หลังหัว + พูลมีภาพเห็นหน้าเดี่ยว → สลับเป็นภาพเห็นหน้า
//   (c) ON + ไร้สำรอง: hero หลังหัว + พูลไม่มีภาพเห็นหน้า → HOLD (quality_hold / insufficient_assets) ไม่ปล่อยหลังหัว
//   (d) ON + เห็นหน้าอยู่แล้ว: hero มี faceBox ปกติ → ไม่แตะ (พฤติกรรมเดิม)
//   (e) ON + MIN=0.25 (ปิด prominence): hero หน้าจิ๋ว faceH=0.10 + พูลมีหน้าใหญ่ → สลับ (เกณฑ์ MIN ทำงาน)
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

// เดินสาย legacy ล้วน (ปิด shadow/routing switches) — เทสเฉพาะด่าน face-visible ไม่ให้ solver/semantic เปลี่ยนเส้นทาง
for (const k of [
  'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_REF_SHOT_AUTHORITY', 'MEGA_SLOT_SOLVER_LIVE',
  'MEGA_REF_HERO_V2', 'MEGA_ROLE_READINESS', 'MEGA_FINAL_DECISION_EVIDENCE_V2', 'MEGA_CROSS_CASE_BORROW',
]) delete process.env[k];

const { s6_slots } = await import('@/lib/megaAdapters');

const HERO = 'เป็กกี้';

// withEnv: on=false → ลบ (default OFF) · on=true → '1' · min=null → ลบ · promOff → ปิด prominence ด้วย
const withFaceVisible = async ({ on = false, min = null, promOff = false } = {}, fn) => {
  const prev = {
    on: process.env.MEGA_HERO_FACE_VISIBLE,
    min: process.env.MEGA_HERO_FACE_VISIBLE_MIN,
    prom: process.env.MEGA_HERO_PROMINENCE,
  };
  if (on) process.env.MEGA_HERO_FACE_VISIBLE = '1'; else delete process.env.MEGA_HERO_FACE_VISIBLE;
  if (min != null) process.env.MEGA_HERO_FACE_VISIBLE_MIN = String(min); else delete process.env.MEGA_HERO_FACE_VISIBLE_MIN;
  if (promOff) process.env.MEGA_HERO_PROMINENCE = '0';
  try { return await fn(); } finally {
    for (const [envKey, k] of [['MEGA_HERO_FACE_VISIBLE', 'on'], ['MEGA_HERO_FACE_VISIBLE_MIN', 'min'], ['MEGA_HERO_PROMINENCE', 'prom']]) {
      if (prev[k] === undefined) delete process.env[envKey]; else process.env[envKey] = prev[k];
    }
  }
};

function mkJob() {
  return {
    dossier: {
      images: { caseId: 'CASE-HERO-FACE-VISIBLE' },
      compass: {
        angle: 'มุมทดสอบ hero ต้องเห็นหน้า', primaryEmotion: 'warm', secondaryEmotions: [],
        mainCharacters: [{ name: HERO, role: 'hero' }],
        visualDreamShots: [], doNotUse: [],
      },
      desk: { title: 'ข่าวทดสอบ hero face-visible' },
      refMatch: { styleName: 'test-ref', typeMatched: false, imagePath: '', reason: 'weak-match-test' },
      artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
    },
  };
}

// hero "หลังหัว": faceCount=1 (Gemini เห็นว่ามีคน 1) แต่ faceBox=null (มองไม่เห็นหน้า) — ขนาดจริงพอ heroSizeOk
const backHead = () => ({
  id: 'BACKHEAD-1',
  imageUrl: 'https://cdn.test/BACKHEAD-1.jpg',
  realWidth: 1200, realHeight: 1500,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'warm', note: 'หันหลัง', newsScene: true, quality: 8,
    faceBox: null,
  },
});
// hero "เห็นหน้าชัด": faceBox h=0.40 (หน้ากิน 40% เฟรม)
const facedSolo = () => ({
  id: 'FACED-1',
  imageUrl: 'https://cdn.test/FACED-1.jpg',
  realWidth: 1200, realHeight: 1500,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'warm', note: '', newsScene: true, quality: 7,
    faceBox: { x: 0.3, y: 0.15, w: 0.35, h: 0.40 },
  },
});
// hero "หน้าจิ๋ว": faceBox h=0.10 (หน้ากินแค่ 10% เฟรม) — ใช้เทสเกณฑ์ MIN
const facedSmall = () => ({
  id: 'SMALL-1',
  imageUrl: 'https://cdn.test/SMALL-1.jpg',
  realWidth: 1200, realHeight: 1500,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: HERO, persons: [HERO],
    category: 'face-emotional', emotion: 'warm', note: '', newsScene: true, quality: 9,
    faceBox: { x: 0.45, y: 0.1, w: 0.08, h: 0.10 },
  },
});

const brainPicks = (img) => ({
  slotDirectorBrain: async () => ({ slots: { hero: { id: img.id, reason: 'brain เลือก (stub)' } }, note: 'stub-brain' }),
});
const fetchStub = (pool) => async (url) => (String(url).includes('/api/images/') ? { success: true, images: pool } : (() => { throw new Error('unexpected fetch: ' + url); })());
const commonDeps = (pool, brainImg) => ({
  ...brainPicks(brainImg),
  fetchJson: fetchStub(pool),
  findImagesByPerson: async () => [],   // ไม่มีให้ยืมข้ามเคส (เทส face-visible ล้วน)
  checkUrlAlive: async () => true,
});

// (a) OFF — บั๊กเดิม: หลังหัวขึ้น hero ทั้งที่พูลมีภาพเห็นหน้า (byte-parity)
test('(a) OFF (default): hero หลังหัว (faceBox=null) + พูลมีภาพเห็นหน้า → ยังปล่อยหลังหัว (บั๊กเดิม byte-parity)', async () => {
  await withFaceVisible({ on: false }, async () => {
    const bh = backHead();
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: commonDeps([bh, facedSolo()], bh) });
    assert.equal(r.status, 'done', 'OFF: ต้องไม่ HOLD (พฤติกรรมเดิม)');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'BACKHEAD-1', 'OFF: hero ยังเป็นภาพหลังหัว (บั๊กเดิม)');
  });
});

// (b) ON + มีสำรอง → สลับเป็นภาพเห็นหน้า
test('(b) ON + hero หลังหัว + พูลมีภาพเห็นหน้าเดี่ยว → สลับเป็นภาพเห็นหน้า', async () => {
  await withFaceVisible({ on: true }, async () => {
    const bh = backHead();
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: commonDeps([bh, facedSolo()], bh) });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'FACED-1', 'ON: hero ต้องสลับเป็นภาพเห็นหน้า');
  });
});

// (c) ON + ไม่มีสำรอง → HOLD (ไม่ปล่อยหลังหัว)
test('(c) ON + hero หลังหัว + พูลไม่มีภาพเห็นหน้า → HOLD (insufficient_assets)', async () => {
  await withFaceVisible({ on: true }, async () => {
    const bh = backHead();
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: commonDeps([bh], bh) });
    assert.equal(r.status, 'quality_hold', 'ON+ไร้สำรอง: ต้อง HOLD ไม่ปล่อยหลังหัว');
    assert.equal(r.holdStatus, 'insufficient_assets');
    assert.ok(r.dossierPatch.pickImages.heroFaceVisibleHold, 'ต้องแนบ heroFaceVisibleHold meta');
    assert.equal(r.dossierPatch.pickImages.heroFaceVisibleHold.imageId, 'BACKHEAD-1');
  });
});

// (d) ON + hero เห็นหน้าอยู่แล้ว → ไม่แตะ
test('(d) ON + hero เห็นหน้าอยู่แล้ว (faceBox ปกติ) → ไม่แตะ (พฤติกรรมเดิม)', async () => {
  await withFaceVisible({ on: true }, async () => {
    const fs = facedSolo();
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: commonDeps([fs], fs) });
    assert.equal(r.status, 'done', 'hero เห็นหน้าแล้ว → ไม่ HOLD');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'FACED-1', 'คงภาพเดิม (เห็นหน้าดีอยู่แล้ว)');
  });
});

// (e) ON + MIN=0.25 (ปิด prominence เพื่อ isolate) — หน้าจิ๋วต้องถูกสลับด้วยเกณฑ์ MIN ของ face-visible เอง
test('(e) ON + MIN=0.25 (prominence OFF): hero หน้าจิ๋ว faceH=0.10 + พูลมีหน้าใหญ่ → สลับ (เกณฑ์ MIN ทำงาน)', async () => {
  await withFaceVisible({ on: true, min: 0.25, promOff: true }, async () => {
    const sm = facedSmall();
    const r = await s6_slots(mkJob(), { origin: 'http://mock', _deps: commonDeps([sm, facedSolo()], sm) });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.pickImages.slots.hero?.id, 'FACED-1', 'หน้าจิ๋ว<0.25 → สลับเป็นหน้าใหญ่ (MIN ล้วน ไม่พึ่ง prominence)');
  });
});
