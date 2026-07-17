// ============================================================
// 🧪 แบตช์ F — Cover QC Hardening (pure gate) — 17 ก.ค.
// ------------------------------------------------------------
// ทดสอบ coverQcGate.evaluateCoverQc ล้วน (ไม่มี compose/IO/LLM) โดยฉีด qcFlags ตรง + คุม env kill-switch:
//   F1 face_overflow hard/killed (manual_review ทุก mode) · F2 duplicate_person_panels route ·
//   F3 duplicate_scene route · F4 เพดานยืดวงกลม 1.2x · F5 hero_face_unmeasured advisory ·
//   + "ทุก switch OFF = พฤติกรรมเดิม byte-parity" (ธงเดิมยังตัดเหมือนเดิม / ธงใหม่ไม่ตัด)
//
// เป้าจริง: ปกใบตุ๊ก (face 107.5% + คนซ้ำ 3 ช่อง) และใบเก้า (ฉากซ้ำ panel↔circle) ต้องไม่ผ่าน gate
//   แต่เคสปกติ (benign) ต้องผ่านเหมือนเดิม
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { evaluateCoverQc } = await import('../src/lib/coverQcGate.js');

// ── env helper: ล้าง key ที่เกี่ยวข้องก่อนทุกเทส แล้ว set override ชั่วคราว คืนค่าเดิมเสมอ (กัน leak ข้ามเทส) ──
const F_ENV_KEYS = [
  'MEGA_HARD_QC', 'MEGA_TECH_RULES_MODE',
  'MEGA_FACE_OVERFLOW_HARD', 'MEGA_PERSON_DIVERSITY', 'MEGA_SCENE_DEDUP', 'MEGA_CIRCLE_STRICT_UPSCALE',
  'MEGA_STRETCH_RELAX', // นโยบายยืดเต็มช่อง 17 ก.ค.
];
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of F_ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } // baseline = default (ทุก F ON, ไม่ bypass)
  for (const [k, v] of Object.entries(overrides || {})) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); }
  finally { for (const k of F_ENV_KEYS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const advHas = (v, sub) => (v.advisory || []).some((a) => String(a).includes(sub));

// ============================================================ F1 — face_overflow
test('F1 default: face_overflow:hero:107.5 (ใบตุ๊ก) ⇒ pass:false + manual_review', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['face_overflow:hero:107.5'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'manual_review');
    assert.ok(v.reasons.some((r) => r.includes('face_overflow')));
  });
});

test('F1 default: face_overflow ช่องรอง (reaction_1) ก็ตัด — ทุก slot ไม่ใช่แค่ hero', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['face_overflow:reaction_1:120'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'manual_review');
  });
});

test('F1 ไม่ขึ้นกับ MEGA_TECH_RULES_MODE: mode=advisory + face_overflow ⇒ ยัง manual_review', () => {
  withEnv({ MEGA_TECH_RULES_MODE: 'advisory' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['face_overflow:hero:107.5'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'manual_review');
  });
});

test('F1 kill-switch MEGA_FACE_OVERFLOW_HARD=0 ⇒ advisory (pass:true, ธงยังรายงานใน advisory)', () => {
  withEnv({ MEGA_FACE_OVERFLOW_HARD: '0' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['face_overflow:hero:107.5'] });
    assert.strictEqual(v.pass, true);
    assert.ok(advHas(v, 'face_overflow'));
  });
});

// ============================================================ F2 — duplicate_person_panels
test('F2 default: duplicate_person_panels:tuk:3 ⇒ pass:false + manual_review', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['duplicate_person_panels:tuk:3'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'manual_review');
  });
});

test('F2 kill-switch MEGA_PERSON_DIVERSITY=0 ⇒ advisory (pass:true)', () => {
  withEnv({ MEGA_PERSON_DIVERSITY: '0' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['duplicate_person_panels:tuk:3'] });
    assert.strictEqual(v.pass, true);
    assert.ok(advHas(v, 'คนเดียวกินหลายช่อง'));
  });
});

// ============================================================ F3 — duplicate_scene
test('F3 default: duplicate_scene:panel_2:circle (ใบเก้า) ⇒ pass:false + manual_review', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['duplicate_scene:panel_2:circle'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'manual_review');
  });
});

test('F3 kill-switch MEGA_SCENE_DEDUP=0 ⇒ advisory (pass:true)', () => {
  withEnv({ MEGA_SCENE_DEDUP: '0' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['duplicate_scene:panel_2:circle'] });
    assert.strictEqual(v.pass, true);
    assert.ok(advHas(v, 'ฉากซ้ำ'));
  });
});

// ============================================================ นโยบายยืดเต็มช่อง (เจ้าของสั่ง 17 ก.ค. — "อย่าให้ภาพเล็กเป็นตัวทำพัง")
test('STRETCH_RELAX=1: hero ยืด 1.88x ⇒ pass:true + ธงลง advisory (ไม่ needs_gap_search)', () => {
  withEnv({ MEGA_STRETCH_RELAX: '1' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['upscaled:main:1.88'] });
    assert.strictEqual(v.pass, true);
    assert.strictEqual(v.suggestedStatus, null);
    assert.ok(v.advisory.some((a) => a.includes('1.88') && a.includes('MEGA_STRETCH_RELAX')));
  });
});

test('STRETCH_RELAX=1: วงกลม/ช่องรองยืดเกิน ก็ advisory หมด — แต่ธง content (คนซ้ำ/หน้าเกินช่อง) ยังตัดเหมือนเดิม', () => {
  withEnv({ MEGA_STRETCH_RELAX: '1' }, () => {
    assert.strictEqual(evaluateCoverQc({ qcFlags: ['upscaled:circle:1.39'] }).pass, true);
    assert.strictEqual(evaluateCoverQc({ qcFlags: ['upscale_soft:reaction_1:2.5'] }).pass, true);
    const v = evaluateCoverQc({ qcFlags: ['upscaled:main:1.88', 'duplicate_person_panels:tuk:3'] });
    assert.strictEqual(v.pass, false, 'relax ยืดเท่านั้น — คนซ้ำยังตัด');
    assert.strictEqual(v.suggestedStatus, 'manual_review');
    const v2 = evaluateCoverQc({ qcFlags: ['upscaled:main:1.88', 'face_overflow:evidence_2:107.5'] });
    assert.strictEqual(v2.pass, false, 'relax ยืดเท่านั้น — หน้าเกินช่องยังตัด');
  });
});

test('STRETCH_RELAX unset/0: พฤติกรรมเดิมเป๊ะ (ยืดเกินเพดาน = needs_gap_search)', () => {
  withEnv({}, () => {
    assert.strictEqual(evaluateCoverQc({ qcFlags: ['upscaled:main:1.88'] }).pass, false);
  });
  withEnv({ MEGA_STRETCH_RELAX: '0' }, () => {
    assert.strictEqual(evaluateCoverQc({ qcFlags: ['upscaled:main:1.88'] }).pass, false);
  });
});

// ============================================================ F4 — circle strict upscale ceiling
test('F4 default: upscaled:circle:1.39 ⇒ pass:false + needs_gap_search (เพดาน 1.2x)', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['upscaled:circle:1.39'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'needs_gap_search');
    assert.ok(v.reasons.some((r) => r.includes('วงกลม')));
  });
});

test('F4 default: upscale_soft:circle_1:1.39 ก็ตัด (id ขึ้นต้น circle)', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['upscale_soft:circle_1:1.39'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'needs_gap_search');
  });
});

test('F4 kill-switch MEGA_CIRCLE_STRICT_UPSCALE=0 ⇒ circle กลับเพดาน 1.6x ⇒ 1.39 ผ่าน (byte-parity)', () => {
  withEnv({ MEGA_CIRCLE_STRICT_UPSCALE: '0' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['upscaled:circle:1.39'] });
    assert.strictEqual(v.pass, true);
  });
});

test('F4 ช่องรองปกติ (reaction_1) ยังใช้เพดาน 1.6x ⇒ 1.39 ผ่านทั้งเปิด/ปิดสวิตช์ (ไม่ regress)', () => {
  withEnv({}, () => {
    assert.strictEqual(evaluateCoverQc({ qcFlags: ['upscaled:reaction_1:1.39'] }).pass, true);
  });
  withEnv({ MEGA_CIRCLE_STRICT_UPSCALE: '0' }, () => {
    assert.strictEqual(evaluateCoverQc({ qcFlags: ['upscaled:reaction_1:1.39'] }).pass, true);
  });
});

test('F4 hero ยังเพดาน 1.2x เสมอ (ไม่เกี่ยวสวิตช์วงกลม): upscaled:main:1.39 ⇒ fail', () => {
  withEnv({ MEGA_CIRCLE_STRICT_UPSCALE: '0' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['upscaled:main:1.39'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'needs_gap_search');
  });
});

// ============================================================ F5 — hero_face_unmeasured (advisory เสมอ)
test('F5 hero_face_unmeasured ⇒ advisory เท่านั้น (pass:true, ไม่ gating)', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['hero_face_unmeasured'] });
    assert.strictEqual(v.pass, true);
    assert.ok(advHas(v, 'hero วัดหน้าไม่ได้'));
  });
});

// ============================================================ เคสจริงรวม (ตุ๊ก / เก้า)
test('ใบตุ๊ก: face_overflow + duplicate_person_panels พร้อมกัน ⇒ manual_review', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['face_overflow:hero:107.5', 'duplicate_person_panels:tuk:3', 'face_share_out:hero:107.5'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'manual_review');
  });
});

test('ใบเก้า: duplicate_scene + hero_face_unmeasured ⇒ manual_review + advisory เห็น hero unmeasured', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['duplicate_scene:panel_2:circle', 'hero_face_unmeasured'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'manual_review');
    assert.ok(advHas(v, 'hero วัดหน้าไม่ได้'));
  });
});

// ============================================================ byte-parity: ทุก F switch OFF
test('ทุก F switch OFF: ธงใหม่ทั้งชุด ⇒ pass:true (ไม่มีตัวใด gating — พฤติกรรมเดิมก่อนแบตช์ F)', () => {
  withEnv({
    MEGA_FACE_OVERFLOW_HARD: '0', MEGA_PERSON_DIVERSITY: '0', MEGA_SCENE_DEDUP: '0', MEGA_CIRCLE_STRICT_UPSCALE: '0',
  }, () => {
    const v = evaluateCoverQc({ qcFlags: [
      'face_overflow:hero:107.5',
      'duplicate_person_panels:tuk:3',
      'duplicate_scene:panel_2:circle',
      'hero_face_unmeasured',
      'upscaled:circle:1.39',
    ] });
    assert.strictEqual(v.pass, true);
  });
});

test('ทุก F switch OFF: ธงเดิมยังตัดเหมือนเดิม (upscaled:main:2.69 ⇒ needs_gap_search / hero_gate_error ⇒ manual_review)', () => {
  withEnv({
    MEGA_FACE_OVERFLOW_HARD: '0', MEGA_PERSON_DIVERSITY: '0', MEGA_SCENE_DEDUP: '0', MEGA_CIRCLE_STRICT_UPSCALE: '0',
  }, () => {
    const a = evaluateCoverQc({ qcFlags: ['upscaled:main:2.69'] });
    assert.strictEqual(a.pass, false);
    assert.strictEqual(a.suggestedStatus, 'needs_gap_search');
    const b = evaluateCoverQc({ qcFlags: ['hero_gate_error'] });
    assert.strictEqual(b.pass, false);
    assert.strictEqual(b.suggestedStatus, 'manual_review');
  });
});

// ============================================================ เคสปกติ (benign) ต้องผ่านเหมือนเดิม
test('เคสปกติ benign (feather_capped/hero_pose/upscale_soft ช่องรอง ≤1.6) ⇒ pass:true ทั้งก่อน/หลังแบตช์ F', () => {
  const benign = ['feather_capped', 'hero_pose:front', 'upscale_soft:reaction_1:1.30', 'enhanced:hero:1.1'];
  withEnv({}, () => { assert.strictEqual(evaluateCoverQc({ qcFlags: benign }).pass, true); });
  withEnv({ MEGA_FACE_OVERFLOW_HARD: '0', MEGA_PERSON_DIVERSITY: '0', MEGA_SCENE_DEDUP: '0', MEGA_CIRCLE_STRICT_UPSCALE: '0' },
    () => { assert.strictEqual(evaluateCoverQc({ qcFlags: benign }).pass, true); });
});

test('MEGA_HARD_QC=0 ยัง bypass ทั้งด่าน แม้มีธงแบตช์ F (pass:true)', () => {
  withEnv({ MEGA_HARD_QC: '0' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['face_overflow:hero:107.5', 'duplicate_person_panels:tuk:3'] });
    assert.strictEqual(v.pass, true);
  });
});

// ============================================================ นโยบายคนซ้ำได้ (เจ้าของสั่ง 17 ก.ค. — "ข่าวดาราคนซ้ำหลายช่องคือปกติ ขอแค่เกี่ยว+สะอาด")
test('PERSON_DIVERSITY=0: duplicate_person_panels + circle_same_person_as_hero ⇒ advisory ทั้งคู่ (pass:true)', () => {
  withEnv({ MEGA_PERSON_DIVERSITY: '0' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['duplicate_person_panels:ดารา:4', 'circle_same_person_as_hero'] });
    assert.strictEqual(v.pass, true);
    assert.strictEqual(v.suggestedStatus, null);
    assert.ok(advHas(v, 'นโยบายคนซ้ำได้'));
  });
});

test('PERSON_DIVERSITY=0: ด่านความสะอาดยังเข้มเหมือนเดิม (face_overflow/circle_face_overlap hard)', () => {
  withEnv({ MEGA_PERSON_DIVERSITY: '0', MEGA_TECH_RULES_MODE: 'hard' }, () => {
    assert.strictEqual(evaluateCoverQc({ qcFlags: ['face_overflow:hero:110'] }).pass, false, 'หน้าเกินช่องยังตัด');
    assert.strictEqual(evaluateCoverQc({ qcFlags: ['circle_face_overlap:main'] }).pass, false, 'วงทับหน้ายังตัด (hard mode)');
  });
});

test('PERSON_DIVERSITY unset: circle_same_person_as_hero ยัง hard เดิมเป๊ะ (parity)', () => {
  withEnv({}, () => {
    const v = evaluateCoverQc({ qcFlags: ['circle_same_person_as_hero'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'manual_review');
  });
});

// ============================================================ circle near vs overlap (17 ก.ค. — เคสจริงปกตุ๊ก)
test('circle_face_near (แค่ใกล้ ไม่ทับ) ⇒ advisory เสมอ แม้ hard mode', () => {
  withEnv({ MEGA_TECH_RULES_MODE: 'hard' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['circle_face_near:main'] });
    assert.strictEqual(v.pass, true);
    assert.ok(advHas(v, 'ไม่ทับ'));
  });
});

test('circle_face_overlap (ทับจริง) ⇒ ยัง hard ใน hard mode เหมือนเดิม', () => {
  withEnv({ MEGA_TECH_RULES_MODE: 'hard' }, () => {
    const v = evaluateCoverQc({ qcFlags: ['circle_face_overlap:main'] });
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.suggestedStatus, 'manual_review');
  });
});
