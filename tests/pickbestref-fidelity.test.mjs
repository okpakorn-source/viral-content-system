// ============================================================
// 🎯 pickbestref-fidelity.test.mjs — pickBestRef ต้องถ่วงน้ำหนัก fidelity/grade (19 ก.ค.)
// ------------------------------------------------------------
// บั๊ก: pickBestRef เดิมให้คะแนนแค่ matchNewsType(+3)/emotion(+2)/role/(+0.5×n)/_humanVerified(+1.5)
//   ไม่ดู fidelity/geometry เลย → เลือกใบ grade C (ถอด geometry เพี้ยน) ได้ทั้งที่มีใบ grade B/A แม่นกว่า
//   ในคลังเดียวกัน (เคสเป็กกี้ REF-mrraukej-6ky5 grade C → ปกวงกลมล้น/hero ยืด)
// แก้: เพิ่ม refFidelityBonus (exported จาก src/lib/refCoverMatch.js) บวกคะแนนเข้าไปแบบ additive เดียว
//   ตาม grade ปัจจุบัน (recompute ผ่าน computeTemplateGrade จริง รวม R6 human-verified floor):
//     A→+2 · B→+1 · C→+0 · F→-3 · kill-switch MEGA_REF_FIDELITY_PREF==='0' → ปิด (คืน 0 เสมอ)
//   ตั้งใจให้เพดาน (+2) ต่ำกว่า matchNewsType (+3) เสมอ — แนวข่าวตรงต้องชนะก่อนเสมอ
// ------------------------------------------------------------
// refCoverMatch.js import ผ่าน alias '@/lib/...' (webpack/Next เท่านั้น) — node --test ธรรมดา resolve
//   alias นี้ไม่ได้ ต้องใช้ node:module register() หลอก resolve '@/lib/refCoverLibrary' (ปกติเป็น
//   persistStore ที่มี Supabase/fs) ให้เป็น stub คุมพูลได้จาก globalThis — ส่วน '@/lib/refCoverGrade'
//   (+ refTemplate.js ภายใน) ให้ resolve ไปไฟล์จริงเสมอ (ไม่ stub) → computeTemplateGrade/dnaToTemplateSpec
//   เป็นของจริง 100% (แพทเทิร์นเดียวกับ tests/ac0107-compose-test-parity.test.mjs ที่มีอยู่แล้วในคลัง)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

// stub เดียว: listRefCovers คืนพูลที่เทสตั้งไว้ผ่าน globalThis.__PBF_POOL (คุมได้ต่อเทส ไม่แตะ Supabase/fs จริง)
const STUB_REFLIB = _mod('export async function listRefCovers(n){ return globalThis.__PBF_POOL || []; }');

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/refCoverLibrary') return { url: ${JSON.stringify(STUB_REFLIB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook));

const { pickBestRef, refFidelityBonus } = await import('../src/lib/refCoverMatch.js');

// dna ฐานจริงจากคลัง (ผ่าน dnaToTemplateSpec แน่ — มี template.slots 5 ช่อง ครบเงื่อนไข refPoolGateOpen)
const LIB = path.join(__dirname, '..', 'data', 'ref-cover-library.json');
const library = JSON.parse(fs.readFileSync(LIB, 'utf8'));
const BASE_DNA = structuredClone(library[0].dna);

// สร้าง ref record สังเคราะห์: clone dna ฐาน + override _fidelity/matchNewsType/ฯลฯ ตามเคส
function mkRef(id, { score, confidence = 'ok', worstOffsetPx = 10, reproducible = true, humanVerified = false, duplicateOf, matchNewsType = [] } = {}) {
  const dna = structuredClone(BASE_DNA);
  delete dna._templateGrade;
  delete dna._duplicateOf;
  delete dna._humanVerified;
  if (humanVerified) dna._humanVerified = true;
  dna._reproducible = reproducible;
  dna.matchNewsType = matchNewsType;
  if (score === undefined) delete dna._fidelity;
  else dna._fidelity = { score, confidence, worstOffsetPx };
  const rec = { id, imagePath: `/ref-covers/${id}.jpg`, dna };
  if (duplicateOf) rec._duplicateOf = duplicateOf;
  return rec;
}

const SIGNALS = { text: 'ข่าว human-interest ครอบครัวอบอุ่นวันนี้', emotion: '' };

// ============================================================
// ① refFidelityBonus — helper PURE เทสตรง (ครอบทุกขั้นเกรด + kill-switch + R6 floor)
// ============================================================
test('refFidelityBonus: grade A (score≥85) → +2', () => {
  assert.equal(refFidelityBonus(mkRef('A1', { score: 92 })), 2);
});
test('refFidelityBonus: grade B (score 70-84) → +1', () => {
  assert.equal(refFidelityBonus(mkRef('B1', { score: 75 })), 1);
});
test('refFidelityBonus: grade C (score 50-69) → 0', () => {
  assert.equal(refFidelityBonus(mkRef('C1', { score: 60 })), 0);
});
test('refFidelityBonus: grade F (score<50) → -3', () => {
  assert.equal(refFidelityBonus(mkRef('F1', { score: 30 })), -3);
});
test('refFidelityBonus: grade F (_duplicateOf) → -3 แม้ score สูง', () => {
  assert.equal(refFidelityBonus(mkRef('F2', { score: 95, duplicateOf: 'REF-orig' })), -3);
});
test('refFidelityBonus: R6 human-verified floor (score 40 → ลอยเป็น B) → +1', () => {
  assert.equal(refFidelityBonus(mkRef('HV1', { score: 40, humanVerified: true })), 1);
});
test('refFidelityBonus: kill-switch MEGA_REF_FIDELITY_PREF=0 → 0 เสมอไม่ว่า grade อะไร', () => {
  const env = { MEGA_REF_FIDELITY_PREF: '0' };
  assert.equal(refFidelityBonus(mkRef('A2', { score: 95 }), env), 0);
  assert.equal(refFidelityBonus(mkRef('F3', { score: 20 }), env), 0);
  assert.equal(refFidelityBonus(mkRef('HV2', { score: 40, humanVerified: true }), env), 0);
});
test('refFidelityBonus: ไม่มี _fidelity เลย → computeTemplateGrade ได้ F (ไม่ throw) → -3', () => {
  assert.equal(refFidelityBonus(mkRef('NF1', { score: undefined })), -3);
});

// ============================================================
// ② pickBestRef — integration (พูลจริงผ่าน stub listRefCovers)
// ============================================================
test('pickBestRef: content เท่ากัน (matchNewsType hit เดียวกัน) grade A ชนะ grade C ขาด (gap 2 > MARGIN 1 → เหลือผู้ชนะเดียว)', async () => {
  const refA = mkRef('REF-A', { score: 92, matchNewsType: ['human-interest'] }); // grade A → +2 → total 5
  const refC = mkRef('REF-C', { score: 60, matchNewsType: ['human-interest'] }); // grade C → +0 → total 3
  globalThis.__PBF_POOL = [refA, refC];
  const result = await pickBestRef(SIGNALS);
  assert.equal(result.ref.id, 'REF-A', 'grade A ต้องชนะเมื่อ content score เท่ากัน');
  assert.equal(result.score, 5);
  assert.ok(!/สุ่ม/.test(result.reason), 'ควรเหลือผู้ชนะเดียว ไม่ใช่กลุ่มใกล้กัน');
});

test('pickBestRef: grade F ถูกกดจนคะแนนรวม ≤0 → ไม่นับเป็นแนวตรง (กันเลือกใบพัง) แม้ matchNewsType ตรง', async () => {
  const refF = mkRef('REF-F', { score: 30, matchNewsType: ['human-interest'] }); // typeHit +3, grade F -3 = 0
  globalThis.__PBF_POOL = [refF];
  const result = await pickBestRef(SIGNALS);
  assert.equal(result.typeMatched, false, 'ถูกกดจนคะแนน 0 → ไม่ถูกนับว่าแมตช์');
  assert.match(result.reason, /ไม่มีแนวตรง/);
  assert.equal(result.ref.id, 'REF-F', 'พูลมีใบเดียว → fallback เป็นปกล่าสุด (generic) ตามพฤติกรรมเดิม');
});

test('pickBestRef: MEGA_REF_FIDELITY_PREF=0 → grade F ไม่ถูกกด กลับมาตรง matchNewsType เหมือนเดิม (byte-parity)', async () => {
  const refF = mkRef('REF-F', { score: 30, matchNewsType: ['human-interest'] });
  globalThis.__PBF_POOL = [refF];
  process.env.MEGA_REF_FIDELITY_PREF = '0';
  try {
    const result = await pickBestRef(SIGNALS);
    assert.equal(result.typeMatched, true, 'ปิดสวิตช์ → typeHit +3 ไม่ถูกหักด้วย fidelity อีกต่อไป');
    assert.equal(result.score, 3);
  } finally {
    delete process.env.MEGA_REF_FIDELITY_PREF;
  }
});

test('pickBestRef: matchNewsType ตรง (grade C) ยังชนะ matchNewsType ไม่ตรง (grade B) — แนวข่าวตรงมีน้ำหนักเหนือ fidelity เสมอ', async () => {
  const refMatchC = mkRef('REF-CM', { score: 60, matchNewsType: ['human-interest'] }); // typeHit+3, grade C+0 = 3
  const refNoMatchB = mkRef('REF-BN', { score: 75, matchNewsType: ['อาชญากรรมรุนแรง'] }); // typeHit 0, grade B+1 = 1
  globalThis.__PBF_POOL = [refMatchC, refNoMatchB];
  const result = await pickBestRef(SIGNALS);
  assert.equal(result.ref.id, 'REF-CM', 'matchNewsType ตรงต้องชนะแม้ fidelity ต่ำกว่า');
  assert.equal(result.typeMatched, true);
  assert.equal(result.score, 3);
});

test('pickBestRef: content เท่ากัน grade B(+1) vs grade C(+0) — gap เท่า MARGIN พอดี (ยังอยู่กลุ่มใกล้กันทั้งคู่) แต่ bestScore ขยับตาม fidelity จริง (ไม่ใช่ค่าเสมอ 3 แบบเดิม)', async () => {
  const refB = mkRef('REF-B', { score: 75, matchNewsType: ['human-interest'] }); // 3+1=4
  const refC2 = mkRef('REF-C2', { score: 60, matchNewsType: ['human-interest'] }); // 3+0=3
  globalThis.__PBF_POOL = [refB, refC2];
  const result = await pickBestRef(SIGNALS);
  assert.equal(result.score, 4, 'bestScore ต้องขยับขึ้นเป็น 4 ตาม fidelity ของ REF-B (พิสูจน์เทอมถูกบวกจริง)');
  assert.match(result.reason, /สุ่ม 1\/2/, 'gap=1=MARGIN พอดี → ทั้งคู่ยังอยู่กลุ่มใกล้กัน (inclusive) แต่ REF-B มีน้ำหนักมากกว่า');

  // เทียบ kill-switch: ปิดแล้วต้องเสมอเป๊ะที่ 3 (ไม่มีเทอม fidelity เลย = พฤติกรรมเดิมก่อนแก้)
  process.env.MEGA_REF_FIDELITY_PREF = '0';
  try {
    const result2 = await pickBestRef(SIGNALS);
    assert.equal(result2.score, 3, 'ปิดสวิตช์ → คะแนนเสมอเป๊ะที่ 3 เหมือนพฤติกรรมเดิมก่อนแก้ (byte-parity)');
    assert.match(result2.reason, /สุ่ม 1\/2/);
  } finally {
    delete process.env.MEGA_REF_FIDELITY_PREF;
  }
});
