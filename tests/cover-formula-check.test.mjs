// ============================================================
// 🧪 cover-formula-check.test.mjs — evaluateCoverFormula (เฟส D-2, dormant, 29 ก.ค. 69)
// ------------------------------------------------------------
// ครอบทุก check ทั้งเคสผ่าน/ตก/ข้อมูลขาด (pass:null) + ธง qcFlags fallback + score aggregation
// PURE ล้วน — เทสตรง ไม่ต้อง stub อะไรเลย (ไฟล์เดียวที่ import คือ slotSolver.js ซึ่งก็ PURE เช่นกัน)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCoverFormula,
  HERO_FACE_SHARE_MIN_PCT,
  HERO_FACE_SHARE_MAX_PCT,
  HERO_FACE_SHARE_MEDIAN_PCT,
} from '../src/lib/coverFormulaCheck.js';

function getCheck(result, key) {
  const c = result.checks.find((x) => x.key === key);
  assert.ok(c, `check ${key} must exist in result`);
  return c;
}

// ── input ว่างเปล่า/ไม่มีเลย ──
test('input ว่างเปล่า ({}) — ทุก check pass:null, score:null (วัดไม่ได้อะไรเลย ไม่ใช่ fail)', () => {
  const r = evaluateCoverFormula({});
  assert.equal(r.checks.length, 6, 'ต้องมี 6 checks เสมอ');
  for (const c of r.checks) {
    assert.equal(c.pass, null, `${c.key} ต้อง pass:null เมื่อไม่มีข้อมูลเลย`);
  }
  assert.equal(r.score, null, 'score ต้อง null เมื่อวัดไม่ได้เลยสักข้อ');
});

test('ไม่ส่ง argument เลย (default {}) — ไม่ throw', () => {
  assert.doesNotThrow(() => evaluateCoverFormula());
});

// ============================================================
// 1) face_share_hero
// ============================================================
test('face_share_hero: ค่าอยู่ในช่วง 40-46 → pass true', () => {
  const r = evaluateCoverFormula({ slots: [{ role: 'hero', faceSharePct: HERO_FACE_SHARE_MEDIAN_PCT }] });
  const c = getCheck(r, 'face_share_hero');
  assert.equal(c.pass, true);
  assert.equal(c.value, 44);
});
test('face_share_hero: ขอบล่าง/ขอบบนพอดี (inclusive) → pass true', () => {
  const lo = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', faceSharePct: HERO_FACE_SHARE_MIN_PCT }] }), 'face_share_hero');
  const hi = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', faceSharePct: HERO_FACE_SHARE_MAX_PCT }] }), 'face_share_hero');
  assert.equal(lo.pass, true, 'ขอบล่าง 40 ต้องผ่าน (inclusive)');
  assert.equal(hi.pass, true, 'ขอบบน 46 ต้องผ่าน (inclusive)');
});
test('face_share_hero: เล็กไป (30%) → pass false', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', faceSharePct: 30 }] }), 'face_share_hero');
  assert.equal(c.pass, false);
  assert.match(c.note, /เล็กไป/);
});
test('face_share_hero: ใหญ่ไป (60%) → pass false', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', faceSharePct: 60 }] }), 'face_share_hero');
  assert.equal(c.pass, false);
  assert.match(c.note, /ใหญ่ไป/);
});
test('face_share_hero: ไม่มี hero slot เลย → pass null', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'context', faceSharePct: 44 }] }), 'face_share_hero');
  assert.equal(c.pass, null);
  assert.match(c.note, /ไม่มี hero slot/);
});
test('face_share_hero: มี hero slot แต่ faceSharePct ไม่มี → pass null', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero' }] }), 'face_share_hero');
  assert.equal(c.pass, null);
});
test('face_share_hero: ไม่มี faceSharePct แต่มีธง hero_face_unmeasured → pass null (บอกตรงๆ ว่าวัดไม่ได้)', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero' }], qcFlags: ['hero_face_unmeasured'] }), 'face_share_hero');
  assert.equal(c.pass, null, 'ธง hero_face_unmeasured ต้องทำให้ null');
});
test('face_share_hero: มี faceSharePct โดยตรง → ข้อมูลตรงชนะ ธง hero_face_unmeasured ไม่ถูกดูเลย (structured data มาก่อนเสมอ)', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', faceSharePct: 44 }], qcFlags: ['hero_face_unmeasured'] }), 'face_share_hero');
  assert.equal(c.pass, true, 'faceSharePct ตรงมีค่าจริง ต้องใช้ค่านั้นตัดสิน ไม่ปล่อยให้ธง (ที่ควรมาคู่กับ faceSharePct=null เท่านั้น) มาทับ');
  assert.equal(c.value, 44);
});
test('face_share_hero: ไม่มี faceSharePct แต่มีธง face_share_out:hero:<pct> → ใช้ค่าจากธงแทน (fail เสมอเพราะธงนี้แปลว่านอกช่วง)', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero' }], qcFlags: ['face_share_out:hero:62.5'] }), 'face_share_hero');
  assert.equal(c.pass, false);
  assert.equal(c.value, 62.5);
  assert.match(c.note, /จากธง qcFlags/);
});

// ============================================================
// 2) evidence_present
// ============================================================
test('evidence_present: ไม่มีช่องไหนมี triage.newsScene → pass null', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero' }, { role: 'context' }] }), 'evidence_present');
  assert.equal(c.pass, null);
});
test('evidence_present: มีอย่างน้อย 1 ช่อง newsScene=true → pass true', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', triage: { newsScene: false } }, { role: 'action', triage: { newsScene: true } }] }), 'evidence_present');
  assert.equal(c.pass, true);
  assert.equal(c.value, 1);
});
test('evidence_present: วัดได้ทุกช่องแต่ไม่มีใครเป็น newsScene จริง → pass false', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', triage: { newsScene: false } }, { role: 'context', triage: { newsScene: false } }] }), 'evidence_present');
  assert.equal(c.pass, false);
  assert.equal(c.value, 0);
});

// ============================================================
// 3) no_baked_text
// ============================================================
test('no_baked_text: ไม่มีช่องไหนมี triage.textOverlay → pass null', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero' }] }), 'no_baked_text');
  assert.equal(c.pass, null);
});
test('no_baked_text: ทุกช่อง textOverlay<=1 → pass true', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', triage: { textOverlay: 0 } }, { role: 'context', triage: { textOverlay: 1 } }] }), 'no_baked_text');
  assert.equal(c.pass, true);
  assert.equal(c.value, 0);
});
test('no_baked_text: มีช่อง textOverlay>1 → pass false', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', triage: { textOverlay: 0 } }, { role: 'action', triage: { textOverlay: 2 } }] }), 'no_baked_text');
  assert.equal(c.pass, false);
  assert.equal(c.value, 1);
  assert.match(c.note, /action/);
});

// ============================================================
// 4) no_dup
// ============================================================
test('no_dup: น้อยกว่า 2 ช่องมี pHash64/ไม่มีธง duplicate_scene → pass null', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero', triage: { pHash64: 'a'.repeat(16) } }] }), 'no_dup');
  assert.equal(c.pass, null);
});
test('no_dup: 2 ช่องขึ้นไป pHash64 ต่างกันมาก (hamming เกินเกณฑ์) → pass true', () => {
  const c = getCheck(evaluateCoverFormula({
    slots: [
      { role: 'hero', triage: { pHash64: '0'.repeat(16) } },
      { role: 'context', triage: { pHash64: 'f'.repeat(16) } }, // ต่างกันสุดขั้ว
    ],
  }), 'no_dup');
  assert.equal(c.pass, true);
  assert.equal(c.value, 0);
});
test('no_dup: pHash64 เหมือนกันเป๊ะ (hamming=0) → pass false', () => {
  const c = getCheck(evaluateCoverFormula({
    slots: [
      { role: 'action', triage: { pHash64: 'abc123abc123abc1' } },
      { role: 'moment', triage: { pHash64: 'abc123abc123abc1' } },
    ],
  }), 'no_dup');
  assert.equal(c.pass, false);
  assert.equal(c.value, 1);
  assert.match(c.note, /action↔moment|moment↔action/);
});
test('no_dup: ไม่มี pHash64 เลยแต่มีธง duplicate_scene:<a>:<b> → ใช้ธงแทน, pass false', () => {
  const c = getCheck(evaluateCoverFormula({
    slots: [{ role: 'action' }, { role: 'moment' }],
    qcFlags: ['duplicate_scene:action:moment'],
  }), 'no_dup');
  assert.equal(c.pass, false);
  assert.equal(c.value, 1);
});
test('no_dup: 3 ช่อง มีคู่ซ้ำ 1 คู่ + อีกช่องไม่ซ้ำใคร → นับคู่ซ้ำแค่ 1', () => {
  const c = getCheck(evaluateCoverFormula({
    slots: [
      { role: 'hero', triage: { pHash64: '0'.repeat(16) } },
      { role: 'action', triage: { pHash64: '0'.repeat(16) } }, // ซ้ำกับ hero
      { role: 'context', triage: { pHash64: 'f'.repeat(16) } }, // ไม่ซ้ำใคร
    ],
  }), 'no_dup');
  assert.equal(c.pass, false);
  assert.equal(c.value, 1);
});

// ============================================================
// 5) face_visible_subslots
// ============================================================
test('face_visible_subslots: ไม่มีช่อง action/moment/reaction/circle เลย → pass null', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero' }, { role: 'context' }] }), 'face_visible_subslots');
  assert.equal(c.pass, null);
  assert.match(c.note, /ไม่มีช่อง/);
});
test('face_visible_subslots: มีช่องคนแต่ไม่มี faceVisible ให้วัด → pass null', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'reaction' }] }), 'face_visible_subslots');
  assert.equal(c.pass, null);
});
test('face_visible_subslots: ทุกช่องคน faceVisible=2 → pass true', () => {
  const c = getCheck(evaluateCoverFormula({
    slots: [{ role: 'action', faceVisible: 2 }, { role: 'reaction', faceVisible: 2 }],
  }), 'face_visible_subslots');
  assert.equal(c.pass, true);
  assert.equal(c.value, '2/2');
});
test('face_visible_subslots: มีช่องคนที่ faceVisible<2 → pass false', () => {
  const c = getCheck(evaluateCoverFormula({
    slots: [{ role: 'action', faceVisible: 2 }, { role: 'reaction', faceVisible: 0 }],
  }), 'face_visible_subslots');
  assert.equal(c.pass, false);
  assert.match(c.note, /reaction/);
});
test('face_visible_subslots: ไม่มี faceVisible แต่มีธง blind_crop:<slot> ตรงกับช่องที่มีจริง → นับเป็นไม่เห็นหน้า', () => {
  const c = getCheck(evaluateCoverFormula({
    slots: [{ role: 'reaction' }],
    qcFlags: ['blind_crop:reaction'],
  }), 'face_visible_subslots');
  assert.equal(c.pass, false);
});
test('face_visible_subslots: เทมเพลตไม่มี panel คนเลย (panelCount ให้มา) → note บอกเหตุผลจาก template', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero' }], template: { panelCount: 1 } }), 'face_visible_subslots');
  assert.equal(c.pass, null);
  assert.match(c.note, /panelCount=1/);
});

// ============================================================
// 6) circle_distinct
// ============================================================
test('circle_distinct: template.hasCircle=false → pass null (ไม่เกี่ยว)', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [], template: { hasCircle: false } }), 'circle_distinct');
  assert.equal(c.pass, null);
  assert.match(c.note, /ไม่มีวงกลม/);
});
test('circle_distinct: ไม่มี circle slot → pass null', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'hero' }] }), 'circle_distinct');
  assert.equal(c.pass, null);
});
test('circle_distinct: circle.sameAsHeroPerson=false → pass true', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'circle', sameAsHeroPerson: false }] }), 'circle_distinct');
  assert.equal(c.pass, true);
});
test('circle_distinct: circle.sameAsHeroPerson=true → pass false', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'circle', sameAsHeroPerson: true }] }), 'circle_distinct');
  assert.equal(c.pass, false);
});
test('circle_distinct: ไม่มี sameAsHeroPerson แต่มีธง circle_same_person_as_hero → pass false', () => {
  const c = getCheck(evaluateCoverFormula({ slots: [{ role: 'circle' }], qcFlags: ['circle_same_person_as_hero'] }), 'circle_distinct');
  assert.equal(c.pass, false);
  assert.equal(c.value, true);
});

// ============================================================
// score aggregation
// ============================================================
test('score: ทุก check ผ่านหมด (เท่าที่วัดได้) → 100', () => {
  const r = evaluateCoverFormula({
    slots: [
      { role: 'hero', faceSharePct: 44, triage: { newsScene: true, textOverlay: 0 } },
    ],
  });
  // เฉพาะ face_share_hero + evidence_present + no_baked_text วัดได้ (3 ข้อ) ที่เหลือ null
  const measurable = r.checks.filter((c) => c.pass !== null);
  assert.ok(measurable.length >= 1);
  assert.ok(measurable.every((c) => c.pass === true));
  assert.equal(r.score, 100);
});
test('score: ผสมผ่าน/ตก → เปอร์เซ็นต์ตรงตามสัดส่วนที่วัดได้จริง (ไม่รวม null เข้าตัวหาร)', () => {
  const r = evaluateCoverFormula({
    slots: [
      { role: 'hero', faceSharePct: 44 }, // pass true
      { role: 'action', triage: { textOverlay: 5 } }, // no_baked_text pass false
    ],
  });
  const measurable = r.checks.filter((c) => c.pass !== null);
  const passCount = measurable.filter((c) => c.pass).length;
  assert.equal(r.score, Math.round((passCount / measurable.length) * 100));
});
test('score: มี checks ผ่าน 6/6 (ยัดข้อมูลครบทุกอย่าง) → 100 พอดี', () => {
  const full = evaluateCoverFormula({
    slots: [
      { role: 'hero', faceSharePct: 44, faceVisible: 2, triage: { newsScene: true, textOverlay: 0, pHash64: '0'.repeat(16) } },
      { role: 'action', faceVisible: 2, triage: { newsScene: false, textOverlay: 0, pHash64: 'f'.repeat(16) } },
      { role: 'moment', faceVisible: 2, triage: { textOverlay: 0, pHash64: '3'.repeat(16) } },
      { role: 'reaction', faceVisible: 2, triage: { textOverlay: 0, pHash64: '5'.repeat(16) } },
      { role: 'circle', faceVisible: 2, sameAsHeroPerson: false, triage: { textOverlay: 0, pHash64: '9'.repeat(16) } },
    ],
    template: { panelCount: 5, hasCircle: true },
  });
  assert.equal(full.checks.length, 6);
  assert.ok(full.checks.every((c) => c.pass === true), JSON.stringify(full.checks, null, 2));
  assert.equal(full.score, 100);
});

// ============================================================
// determinism / purity
// ============================================================
test('deterministic: input เดิม → ผลเดิมทุกครั้ง (deepEqual)', () => {
  const input = {
    slots: [
      { role: 'hero', faceSharePct: 44, triage: { newsScene: true, textOverlay: 0, pHash64: 'abc123abc123abc1' } },
      { role: 'circle', sameAsHeroPerson: false },
    ],
    qcFlags: [],
    template: { panelCount: 2, hasCircle: true },
  };
  const a = evaluateCoverFormula(JSON.parse(JSON.stringify(input)));
  const b = evaluateCoverFormula(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(a, b);
});
test('ไม่ mutate input ที่ส่งเข้ามา', () => {
  const input = { slots: [{ role: 'hero', faceSharePct: 44 }], qcFlags: ['x'] };
  const snapshot = JSON.parse(JSON.stringify(input));
  evaluateCoverFormula(input);
  assert.deepEqual(input, snapshot);
});
