// ============================================================
// ref-cover-grade.test.mjs — เกรดเทมเพลต ref (R3) ทุกเส้น + ประตูพูล OFF/ON + idempotent
// ------------------------------------------------------------
// PURE offline: computeTemplateGrade / refPoolGateOpen ไม่มี env/IO/AI
//   ใช้ dna จริง 1 ใบจากคลัง (ผ่าน dnaToTemplateSpec แน่) เป็นฐาน แล้ว override _fidelity/_reproducible
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTemplateGrade, refPoolGateOpen, GRADE_ENGINE_VERSION } from '../src/lib/refCoverGrade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(__dirname, '..', 'data', 'ref-cover-library.json');
const library = JSON.parse(fs.readFileSync(LIB, 'utf8'));
// dna ฐานที่ผ่าน dnaToTemplateSpec แน่ (ทุกใบในคลังผ่าน) — clone มา override ต่อเคส
const BASE_DNA = structuredClone(library[0].dna);

// สร้าง record สังเคราะห์: clone dna ฐาน + set _fidelity/_reproducible/_duplicateOf ตามต้องการ
function mk({ score, confidence = 'ok', reproducible = true, worstOffsetPx = 10, duplicateOf, dropFidelity, dropTemplate } = {}) {
  const dna = structuredClone(BASE_DNA);
  delete dna._templateGrade;
  delete dna._duplicateOf; // กันค่าติดมาจาก BASE_DNA
  dna._reproducible = reproducible;
  if (dropTemplate) delete dna.template; // ทำให้ dnaToTemplateSpec คืน null
  if (dropFidelity) { delete dna._fidelity; }
  else dna._fidelity = { score, confidence, worstOffsetPx };
  const rec = { id: 'SYN', imagePath: '/ref-covers/x.jpg', dna };
  // _duplicateOf อยู่ที่ระดับบนของ record (ตำแหน่งจริงที่ repair-ref-library.mjs เขียน) — ไม่ใช่ใน dna
  if (duplicateOf) rec._duplicateOf = duplicateOf;
  return rec;
}

// ── เกรดพื้นฐานจาก _fidelity ──
test('A: score≥85 + repro true + offset เล็ก → A', () => {
  assert.equal(computeTemplateGrade(mk({ score: 90 })).grade, 'A');
});
test('B: score 70-84 → B', () => {
  assert.equal(computeTemplateGrade(mk({ score: 75 })).grade, 'B');
});
test('C: score 50-69 → C', () => {
  assert.equal(computeTemplateGrade(mk({ score: 60 })).grade, 'C');
});
test('F: score < 50 → F', () => {
  assert.equal(computeTemplateGrade(mk({ score: 40 })).grade, 'F');
});
test('F: confidence=low (score null) → F', () => {
  const g = computeTemplateGrade(mk({ score: null, confidence: 'low' }));
  assert.equal(g.grade, 'F');
  assert.ok(g.reasons.some((r) => /confidence=low/.test(r)));
});

// ── modifier ลดขั้น ──
test('modifier: A แต่ repro=false → ลดเป็น B', () => {
  assert.equal(computeTemplateGrade(mk({ score: 90, reproducible: false })).grade, 'B');
});
test('modifier: A แต่ worstOffsetPx>30 → ลดเป็น B', () => {
  assert.equal(computeTemplateGrade(mk({ score: 90, worstOffsetPx: 35 })).grade, 'B');
});
test('modifier ซ้อน: B(75) + repro false + offset>30 → ลดสองขั้นเป็น F', () => {
  const g = computeTemplateGrade(mk({ score: 75, reproducible: false, worstOffsetPx: 35 }));
  assert.equal(g.grade, 'F');
  assert.ok(g.reasons.some((r) => /_reproducible=false/.test(r)));
  assert.ok(g.reasons.some((r) => /worstOffsetPx/.test(r)));
});
test('modifier: C(60) + repro false → ลดเป็น F', () => {
  assert.equal(computeTemplateGrade(mk({ score: 60, reproducible: false })).grade, 'F');
});
test('modifier ไม่ทำให้ต่ำกว่า F: score<50 + repro false → ยัง F (ไม่ throw/ต่ำกว่านั้น)', () => {
  assert.equal(computeTemplateGrade(mk({ score: 30, reproducible: false, worstOffsetPx: 40 })).grade, 'F');
});

// ── ประตู F ทันที ──
test('F ทันที: _duplicateOf มีค่า → F แม้ score สูง', () => {
  const g = computeTemplateGrade(mk({ score: 95, duplicateOf: 'REF-orig' }));
  assert.equal(g.grade, 'F');
  assert.ok(g.reasons.some((r) => /ใบซ้ำ/.test(r)));
});
// ── regression: ใบซ้ำจริงในคลัง เก็บธงที่ record._duplicateOf (top-level) ที่ repair script เขียน ──
//   กันบัคเดิม (อ่าน dna._duplicateOf ผิดตำแหน่ง → ใบซ้ำจริงหลุดเป็นเกรดสูง + ผ่านประตู ON)
test('regression: ใบซ้ำจริงในคลัง (record._duplicateOf) → F + ถูกตัดจากพูล ON', () => {
  const REAL_DUPS = ['REF-mrbq76vs-652r', 'REF-mrbqalpo-h1r1'];
  const envOn = { REF_TEMPLATE_GRADE_GATE: '1' };
  for (const id of REAL_DUPS) {
    const rec = library.find((x) => x.id === id);
    assert.ok(rec, `ต้องมีใบซ้ำจริง ${id} ในคลัง`);
    assert.ok(rec._duplicateOf, `${id} ต้องมีธง _duplicateOf ที่ระดับ record (ตำแหน่งจริง)`);
    assert.equal(rec.dna?._duplicateOf, undefined, `${id} ธงต้องไม่อยู่ใน dna (พิสูจน์อ่านผิดที่=หลุด)`);
    const g = computeTemplateGrade(rec);
    assert.equal(g.grade, 'F', `${id} ใบซ้ำจริงต้องได้ F (ได้ ${g.grade})`);
    assert.ok(g.reasons.some((r) => /ใบซ้ำ/.test(r)), `${id} เหตุผลต้องบอกว่าใบซ้ำ`);
    assert.equal(refPoolGateOpen(rec, envOn), false, `${id} ใบซ้ำจริงต้องถูกตัดจากพูล ON`);
  }
});

test('F ทันที: ไม่มี imagePath → F', () => {
  const rec = mk({ score: 95 }); delete rec.imagePath;
  assert.equal(computeTemplateGrade(rec).grade, 'F');
});
test('F ทันที: ไม่มี dna → F', () => {
  assert.equal(computeTemplateGrade({ id: 'X', imagePath: '/x.jpg' }).grade, 'F');
});
test('F ทันที: dnaToTemplateSpec ไม่ผ่าน (ไม่มี template) → F', () => {
  const g = computeTemplateGrade(mk({ score: 95, dropTemplate: true }));
  assert.equal(g.grade, 'F');
  assert.ok(g.reasons.some((r) => /dnaToTemplateSpec/.test(r)));
});
test('F ทันที: ไม่มี _fidelity → F', () => {
  const g = computeTemplateGrade(mk({ dropFidelity: true }));
  assert.equal(g.grade, 'F');
  assert.ok(g.reasons.some((r) => /_fidelity/.test(r)));
});
test('_humanVerified ไม่มีผลต่อเกรด (score ต่ำ+verified ก็ยัง F)', () => {
  const rec = mk({ score: 40 }); rec.dna._humanVerified = true;
  assert.equal(computeTemplateGrade(rec).grade, 'F');
});

test('engineVersion แนบทุกผล', () => {
  assert.equal(computeTemplateGrade(mk({ score: 90 })).engineVersion, GRADE_ENGINE_VERSION);
});

// ── idempotent ──
test('idempotent: คิดซ้ำได้ผลเท่าเดิมเป๊ะ', () => {
  const rec = mk({ score: 77, reproducible: false });
  assert.deepEqual(computeTemplateGrade(rec), computeTemplateGrade(rec));
});
test('idempotent: เขียน _templateGrade ลง dna แล้วคิดใหม่ได้เกรดเดิม', () => {
  const rec = mk({ score: 88 });
  const g1 = computeTemplateGrade(rec);
  rec.dna._templateGrade = g1; // จำลองสคริปต์เขียนกลับ
  assert.deepEqual(computeTemplateGrade(rec), g1);
});

// ── ประตูพูล: OFF byte-identical กับตัวกรองเดิม "ก่อน R5b" ──
//   ★ ตัวกรองเดิมก่อน R5b = `dna && imagePath && !_derived && _reproducible!==false`
//     (ก่อน R5b คลังไม่มี variant _derived เลย — ต้องกัน variant ออกจากพูล OFF ให้ byte-identical)
test('gate OFF: refPoolGateOpen === ตัวกรองเดิม (dna+imagePath+!_derived+_reproducible!==false) ทุกใบในคลังจริง', () => {
  const envOff = {}; // ไม่มี REF_TEMPLATE_GRADE_GATE
  for (const rec of library) {
    const legacy = !!(rec.dna && rec.imagePath && !rec.dna._derived && rec.dna._reproducible !== false);
    assert.equal(refPoolGateOpen(rec, envOff), legacy, `พูล OFF ต้องตรงตัวกรองเดิม: ${rec.id}`);
  }
});
test('gate OFF: pool ที่ป้อน pickBestRef เท่าเดิม (จำนวน+สมาชิกตรง)', () => {
  const envOff = {};
  const legacyPool = library.filter((x) => x.dna && x.imagePath && !x.dna._derived && x.dna._reproducible !== false).map((x) => x.id);
  const newPool = library.filter((x) => refPoolGateOpen(x, envOff)).map((x) => x.id);
  assert.deepEqual(newPool, legacyPool);
});

// ── ★ R5b regression: OFF-gate parity คลัง 33 ใบ ↔ backup 21 ใบ (ก่อนกลั่นโครงลูก) ──
//   บัค R5b: OFF branch `return dna._reproducible !== false` ปล่อย variant 12 ใบ (ไม่มี _reproducible) หลุดพูล OFF
//   เทสเดิมข้างบนเคย "ผ่าน" บัคนี้ เพราะนิยาม legacy ก็ปล่อย _derived ผ่านเหมือนกัน (สองฝั่งพลาดตรงกัน = ตรวจไม่เจอ)
//   ด่านจริงที่ปิดช่องโหว่: พูล OFF เหนือคลัง 33 ใบ (มี _derived 12) ต้อง "เท่ากับ" พูล OFF เหนือ backup 21 ใบ
//     (backup = คลังก่อน R5b ไม่มี _derived เลย) — ถ้ามี variant ใดหลุด OFF จำนวน/สมาชิกจะไม่ตรง = จับได้ทันที
test('gate OFF: พูลคลัง 33 ใบ == พูล backup 21 ใบ (ไม่มี _derived หลุด OFF เข้ามาเลย)', () => {
  const BACKUP = path.join(__dirname, '..', 'backup', 'ref-library_2026-07-16-r5b', 'ref-cover-library.json');
  const backup = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  assert.equal(backup.length, 21, 'backup ต้องเป็นคลังก่อน R5b 21 ใบ');
  assert.equal(backup.filter((r) => r?.dna?._derived).length, 0, 'backup ต้องไม่มี variant _derived');
  assert.ok(library.filter((r) => r?.dna?._derived).length >= 1, 'คลังปัจจุบันต้องมี variant _derived (พิสูจน์ด่านมีของให้จับ)');

  const envOff = {};
  const backupPool = backup.filter((x) => refPoolGateOpen(x, envOff)).map((x) => x.id).sort();
  const libraryPool = library.filter((x) => refPoolGateOpen(x, envOff)).map((x) => x.id).sort();
  assert.deepEqual(libraryPool, backupPool, 'พูล OFF ของคลัง 33 ใบ ต้องเท่าพูล OFF ของ backup 21 ใบเป๊ะ (ไม่มี variant หลุด)');
});
test('gate OFF: refPoolGateOpen(variant, {}) === false ทุก variant _derived ในคลัง', () => {
  const envOff = {};
  const variants = library.filter((r) => r?.dna?._derived);
  assert.ok(variants.length >= 1, 'ต้องมี variant _derived ในคลังให้ตรวจ');
  for (const v of variants) {
    assert.equal(refPoolGateOpen(v, envOff), false, `${v.id} (variant) ต้องถูกกันออกจากพูล OFF`);
  }
});

// ── ประตูพูล: ON กรองถูก (เฉพาะ A/B ไม่ซ้ำ) ──
test('gate ON: รับเฉพาะเกรด A/B และไม่มี _duplicateOf', () => {
  const envOn = { REF_TEMPLATE_GRADE_GATE: '1' };
  const passed = library.filter((x) => refPoolGateOpen(x, envOn));
  for (const rec of passed) {
    const g = computeTemplateGrade(rec).grade;
    assert.ok(g === 'A' || g === 'B', `${rec.id} ผ่านประตูต้องเป็น A/B (ได้ ${g})`);
    assert.ok(!rec.dna._duplicateOf, `${rec.id} ผ่านประตูต้องไม่ใช่ใบซ้ำ`);
  }
  // คลังจริงหลังกู้ R5a (A:2 B:9 = 11) + R5b กลั่นโครงลูก (derive-ref-variants.mjs):
  //   variant จากแม่ A → เกรด B ผ่านประตู (2 แม่ A × mirror+panelreduce = 4 ใบ) · variant จากแม่ B → C ไม่ผ่าน
  //   → 11 + 4 = 15 ใบผ่านประตู (ถ้ากลั่น/เพดานเปลี่ยน อัปเดตเลขนี้)
  assert.equal(passed.length, 15, `คลังจริงต้องมี 15 ใบเกรด A/B หลังกู้ R5a + กลั่น R5b (ได้ ${passed.length})`);
});
test('gate ON: ใบซ้ำถูกตัดแม้เกรดฐานสูง', () => {
  const envOn = { REF_TEMPLATE_GRADE_GATE: '1' };
  const dupRec = mk({ score: 95, duplicateOf: 'REF-orig' });
  assert.equal(refPoolGateOpen(dupRec, envOn), false);
});
test('gate ON: ใบเกรด B ที่ repro=false ยังผ่าน (repro ยุบเป็น modifier แล้ว)', () => {
  const envOn = { REF_TEMPLATE_GRADE_GATE: '1' };
  const bRepFalse = mk({ score: 90, reproducible: false }); // A→ลด→B
  assert.equal(computeTemplateGrade(bRepFalse).grade, 'B');
  assert.equal(refPoolGateOpen(bRepFalse, envOn), true, 'B ต้องผ่านแม้ repro=false (OFF จะตัดทิ้ง)');
  assert.equal(refPoolGateOpen(bRepFalse, {}), false, 'OFF: repro=false ถูกตัดเหมือนเดิม');
});
test('gate ON: สวิตช์ต้องเป็น "1" เป๊ะ ("true"/"" ไม่เปิด → พฤติกรรม OFF)', () => {
  const cRec = mk({ score: 60 }); // เกรด C — ON ตัด, OFF รับ
  assert.equal(refPoolGateOpen(cRec, { REF_TEMPLATE_GRADE_GATE: 'true' }), true);
  assert.equal(refPoolGateOpen(cRec, { REF_TEMPLATE_GRADE_GATE: '1' }), false);
});

// ★ R3 audit mustFix: เกรดที่ "บันทึกไว้จริง" ในคลังต้องตรงกับเครื่องคิดเสมอ (กันค่าค้างแบบเคส REF-mrbqalpo C→F)
//   โดยเฉพาะใบ duplicate ทั้งสอง — stored ต้องเป็น F เท่ากับ recompute ไม่ใช่ค่าเก่าก่อนติดธง
test('stored _templateGrade ในคลังจริงตรงกับ recompute ทุกใบ (รวม duplicate = F)', () => {
  const dups = ['REF-mrbq76vs-652r', 'REF-mrbqalpo-h1r1'];
  for (const rec of library) {
    const stored = rec?.dna?._templateGrade?.grade;
    const fresh = computeTemplateGrade(rec).grade;
    assert.equal(stored, fresh, `${rec.id}: stored=${stored} ≠ recompute=${fresh} — รัน node scripts/grade-ref-library.mjs`);
  }
  for (const id of dups) {
    const rec = library.find((r) => r.id === id);
    assert.ok(rec, `ต้องมี ${id} ในคลัง`);
    assert.equal(rec?.dna?._templateGrade?.grade, 'F', `${id} เป็น duplicate — stored grade ต้องเป็น F`);
  }
});

// ============================================================ REF_POOL_PIN (17 ก.ค. — เทสทีละเทมเพลต)
test('PIN: ตั้ง REF_POOL_PIN = เหลือเฉพาะ id นั้น (ใบอื่นแม้เกรด A ก็ไม่ผ่าน)', () => {
  const env = { REF_POOL_PIN: 'REF-PINNED', REF_TEMPLATE_GRADE_GATE: '1' };
  const pinned = { id: 'REF-PINNED', imagePath: '/x.jpg', dna: mk({ score: 60 }) }; // เกรดต่ำก็ผ่านเมื่อถูกปัก
  const gradeA = { id: 'REF-OTHER', imagePath: '/y.jpg', dna: mk({ score: 95 }) };
  assert.equal(refPoolGateOpen(pinned, env), true);
  assert.equal(refPoolGateOpen(gradeA, env), false);
});

test('PIN: core ยังบังคับ (ใบปักที่ไม่มี dna/imagePath = ไม่ผ่าน) + pin ว่าง/ช่องว่าง = พฤติกรรมเดิม', () => {
  const env = { REF_POOL_PIN: 'REF-PINNED' };
  assert.equal(refPoolGateOpen({ id: 'REF-PINNED', dna: mk({ score: 90 }) }, env), false, 'ไม่มี imagePath');
  assert.equal(refPoolGateOpen({ id: 'REF-PINNED', imagePath: '/x.jpg' }, env), false, 'ไม่มี dna');
  const noPin = { REF_POOL_PIN: '  ' };
  const normal = { id: 'REF-N', imagePath: '/n.jpg', dna: mk({ score: 90 }) };
  assert.equal(refPoolGateOpen(normal, noPin), refPoolGateOpen(normal, {}), 'pin ช่องว่าง = เหมือนไม่ตั้ง');
});
