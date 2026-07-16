// ============================================================
// ref-template-variants.test.mjs (R5b) — กลั่นโครงลูกจากใบแม่ A/B (PURE, ไม่มี AI/IO)
// ------------------------------------------------------------
// ครอบ: mirror คณิตถูก (สมมาตร + mirror×2=เดิม) · panel-reduce ปิดผืนเต็ม (ไม่ทับ/ไม่โหว่) ·
//       crop-safe-boost ทุกช่องผ่านเกณฑ์หลังปรับ · variant ไม่ sane ถูกทิ้ง · เกรด derived ถูกเพดาน
//       (แม่ A→B, แม่ B→C) · ใบปกติเกรดเดิมไม่เปลี่ยน · idempotent · แม่ไม่ถูก mutate (byte-unchanged)
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveTemplateVariants, mirrorHorizontal, panelReduce, cropSafeBoost, isVariantSane,
  HERO_MIN_SHORT_PX, SECONDARY_MIN_SHORT_PCT, CANVAS_W, CANVAS_H,
} from '../src/lib/refTemplateVariants.js';
import { computeTemplateGrade } from '../src/lib/refCoverGrade.js';
import { dnaToTemplateSpec } from '../src/lib/refTemplate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(__dirname, '..', 'data', 'ref-cover-library.json');
const library = JSON.parse(fs.readFileSync(LIB, 'utf8'));

// สร้างใบแม่สังเคราะห์ที่ผ่าน dnaToTemplateSpec + คุมเกรดผ่าน _fidelity
function mkMother(slots, { score = 90, confidence = 'ok', reproducible = true, worstOffsetPx = 10 } = {}) {
  return {
    id: 'MOM', imagePath: '/ref-covers/x.jpg', styleName: 's',
    dna: {
      layoutType: 'test', panelCount: slots.length,
      template: { seamStyle: 'feather', featherPx: 14, slots },
      slots: slots.filter((s) => s.shape !== 'circle').map((s) => ({ role: s.role, subject: 'x', shot: 'medium' })),
      matchNewsType: ['human-interest'], matchEmotion: ['ดีใจ'], emotion: 'ดีใจ',
      style: { tone: 'อุ่น' },
      _reproducible: reproducible,
      _fidelity: { score, confidence, worstOffsetPx },
    },
  };
}
const rect = (role, x, y, w, h, extra = {}) => ({ role, shape: 'rect', xPct: x, yPct: y, wPct: w, hPct: h, border: false, ...extra });
const circ = (role, x, y, w, h) => ({ role, shape: 'circle', xPct: x, yPct: y, wPct: w, hPct: h, border: true, borderColor: '#FFFFFF', borderWidthPct: 2 });

// โครงมาตรฐาน: hero ซ้ายเต็มสูง + ขวาบน/ล่าง + วงกลม (4 rect... เอา 2 rect ขวา = 3 rect + circle)
const LAYOUT_HERO_LEFT = [
  rect('hero', 0, 0, 50, 100),
  rect('pair', 50, 0, 50, 54),
  rect('reaction', 50, 54, 50, 46),
  circ('moment', 9, 66, 36, 29),
];

// ── (ก) mirror ─────────────────────────────────────────────
test('mirror: x` = 100 − x − w ทุกช่อง (y/w/h เดิม)', () => {
  const out = mirrorHorizontal(LAYOUT_HERO_LEFT);
  out.forEach((s, i) => {
    const o = LAYOUT_HERO_LEFT[i];
    assert.equal(s.xPct, 100 - o.xPct - o.wPct, `${o.role} xPct สลับถูก`);
    assert.equal(s.yPct, o.yPct); assert.equal(s.wPct, o.wPct); assert.equal(s.hPct, o.hPct);
  });
});
test('mirror: hero ซ้าย→ขวา + วงกลมสลับข้าง', () => {
  const out = mirrorHorizontal(LAYOUT_HERO_LEFT);
  const hero = out.find((s) => s.role === 'hero');
  assert.equal(hero.xPct, 50, 'hero ไปฝั่งขวา');
  assert.equal(hero.pos, 'ขวา', 'pos ป้ายไทยสลับเป็นขวา');
  const circle = out.find((s) => s.role === 'moment');
  assert.equal(circle.xPct, 100 - 9 - 36); // 55
});
test('mirror สองครั้ง = geometry เดิม (สมมาตรแท้)', () => {
  const twice = mirrorHorizontal(mirrorHorizontal(LAYOUT_HERO_LEFT));
  twice.forEach((s, i) => {
    const o = LAYOUT_HERO_LEFT[i];
    for (const k of ['xPct', 'yPct', 'wPct', 'hPct']) assert.equal(s[k], o[k], `${o.role}.${k} กลับเป็นเดิม`);
  });
});

// ── (ข) panel-reduce ───────────────────────────────────────
// ตรวจ tiling ของ "เฉพาะ rect" (วงกลมลอยทับ) ว่าปิดผืน 100×100 เต็ม ไม่ทับ/ไม่โหว่
function rectTiling(slots) {
  const rects = slots.filter((s) => s.shape !== 'circle').map((s) => ({
    x1: s.xPct, y1: s.yPct, x2: s.xPct + s.wPct, y2: s.yPct + s.hPct,
  }));
  let area = 0, overlap = 0;
  for (const r of rects) area += (r.x2 - r.x1) * (r.y2 - r.y1);
  for (let a = 0; a < rects.length; a++) {
    for (let b = a + 1; b < rects.length; b++) {
      const A = rects[a], B = rects[b];
      const ix = Math.max(0, Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1));
      const iy = Math.max(0, Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1));
      overlap += ix * iy;
    }
  }
  return { area, overlap, count: rects.length };
}
test('panel-reduce: ตัดช่องรองเล็กสุด → เหลือ rect น้อยลง 1', () => {
  const out = panelReduce(LAYOUT_HERO_LEFT);
  assert.ok(out, 'ต้องกลั่นได้');
  const before = rectTiling(LAYOUT_HERO_LEFT).count;
  const after = rectTiling(out).count;
  assert.equal(after, before - 1, 'rect หายไป 1 ช่อง');
  assert.ok(!out.some((s) => s.role === 'reaction'), 'reaction (h46, เล็กสุด) ถูกตัด');
  assert.ok(out.some((s) => s.role === 'hero'), 'hero คงอยู่');
  assert.ok(out.some((s) => s.shape === 'circle'), 'วงกลมคงอยู่');
});
test('panel-reduce: พื้นที่รวมเต็มผืน (10000) ไม่ทับ (overlap≈0) ไม่โหว่', () => {
  const out = panelReduce(LAYOUT_HERO_LEFT);
  const t = rectTiling(out);
  assert.ok(Math.abs(t.area - 10000) < 1, `พื้นที่ rect รวมต้อง≈10000 (ได้ ${t.area})`);
  assert.ok(t.overlap < 1, `ต้องไม่ทับ (overlap ${t.overlap})`);
});
test('panel-reduce: ช่องข้างเคียงขยายเข้าปิด (pair สูงเต็ม 100)', () => {
  const out = panelReduce(LAYOUT_HERO_LEFT);
  const pair = out.find((s) => s.role === 'pair');
  assert.equal(pair.hPct, 100, 'pair ขยายลงเต็มความสูงแทน reaction ที่ตัด');
});
test('panel-reduce: rect < 3 → คืน null (ตัดแล้วเหลือไม่พอ)', () => {
  const twoRect = [rect('hero', 0, 0, 50, 100), rect('side', 50, 0, 50, 100), circ('m', 9, 66, 36, 29)];
  assert.equal(panelReduce(twoRect), null);
});

// ── (ค) crop-safe-boost ────────────────────────────────────
// hero กว้างพอผ่าน 700px + ช่องรองบนขวา "เกือบหลุด" (h20 → ด้านสั้น 20% < 22) แก้ได้ใน 4%
const LAYOUT_MARGINAL = [
  rect('hero', 0, 0, 66, 100),      // ด้านสั้น = 66%*1080 = 712.8px ≥700 ผ่าน
  rect('top', 66, 0, 34, 20),       // ด้านสั้น = 20% < 22 → fail (ขาด 2%)
  rect('bottom', 66, 20, 34, 80),   // ด้านสั้น = 34% ผ่าน
  circ('moment', 10, 70, 30, 24),
];
function cropOk(slots) {
  const heroI = 0;
  return slots.every((s, i) => {
    if (s.shape === 'circle') return true;
    const w = s.wPct, h = s.hPct;
    if (i === heroI) return Math.min((w / 100) * CANVAS_W, (h / 100) * CANVAS_H) >= HERO_MIN_SHORT_PX - 1e-6;
    return Math.min(w, h) >= SECONDARY_MIN_SHORT_PCT - 1e-6;
  });
}
test('crop-boost: ก่อนปรับมีช่องหลุด (top h20)', () => {
  assert.equal(cropOk(LAYOUT_MARGINAL), false);
});
test('crop-boost: หลังปรับ ทุกช่อง rect ผ่านเกณฑ์', () => {
  const out = cropSafeBoost(LAYOUT_MARGINAL);
  assert.ok(out, 'ต้อง boost ได้ (เกือบหลุด แก้ได้ใน 4%)');
  assert.equal(cropOk(out), true, 'ทุกช่องผ่านเกณฑ์หลังปรับ');
  const top = out.find((s) => s.role === 'top');
  const bottom = out.find((s) => s.role === 'bottom');
  assert.ok(top.hPct >= SECONDARY_MIN_SHORT_PCT - 1e-6, `top ด้านสั้นถึงเกณฑ์ (ได้ ${top.hPct})`);
  assert.ok(top.hPct - 20 <= 4 + 1e-6, 'ขยับ ≤4% ต่อขอบ');
  assert.equal(Math.round((top.hPct + bottom.hPct) * 100) / 100, 100, 'top+bottom ยังปิดผืน (รวม 100)');
  assert.equal(bottom.yPct, top.hPct, 'ตะเข็บเลื่อนพร้อมกัน (ไม่มีร่อง/ทับ)');
});
test('crop-boost: ไม่มีช่องหลุด → คืน null (ไม่ต้อง boost)', () => {
  assert.equal(cropSafeBoost(LAYOUT_HERO_LEFT), null);
});
test('crop-boost: หลุดเกินเอื้อม >4% → คืน null (ข้าม)', () => {
  // hero ซ้ายเต็มสูง w50 = 540px ต่ำกว่า 700 ไกล (ต้อง 64.8% ขาด 14.8% > 4) → ข้าม
  assert.equal(cropSafeBoost(LAYOUT_HERO_LEFT.map((s) => s)), null);
});

// ── sane gate ──────────────────────────────────────────────
test('isVariantSane: dnaToTemplateSpec ไม่ผ่าน → ok:false', () => {
  const bad = { template: { slots: [rect('a', 0, 0, 100, 100)] } }; // 1 ช่อง = คอลลาจไม่ได้
  const r = isVariantSane(bad, dnaToTemplateSpec(mkMother(LAYOUT_HERO_LEFT).dna));
  assert.equal(r.ok, false);
});
test('isVariantSane: IoU แย่กว่าแม่ (ช่องทับกันหนัก) → ok:false', () => {
  const motherSpec = dnaToTemplateSpec(mkMother(LAYOUT_HERO_LEFT).dna);
  // ช่องทับกันเกือบสนิท (dnaToTemplateSpec ปล่อยผ่านเป็น inset/overlap) — IoU สูงกว่าแม่ที่ปูเรียบ
  const overlapDna = { template: { slots: [
    rect('a', 0, 0, 60, 100), rect('b', 5, 5, 55, 90), rect('c', 55, 0, 45, 100),
  ] } };
  const r = isVariantSane(overlapDna, motherSpec);
  // อาจ ok:false เพราะ IoU หรือช่องหลุด — ต้องไม่ผ่านแบบ sane เต็ม
  if (r.ok) assert.fail('โครงทับกันหนักไม่ควร sane');
});

// ── deriveTemplateVariants: เกรด derived ถูกเพดาน ──────────
test('derive: แม่ A → variant เกรด B (ลดหนึ่งขั้น)', () => {
  const momA = mkMother(LAYOUT_HERO_LEFT, { score: 92 });
  assert.equal(computeTemplateGrade(momA).grade, 'A');
  const vs = deriveTemplateVariants(momA, { now: 'T' });
  assert.ok(vs.length >= 1, 'ต้องมี variant');
  for (const v of vs) {
    assert.equal(computeTemplateGrade(v).grade, 'B', `${v.id} แม่ A → B`);
    assert.equal(v.dna._derived.motherGrade, 'A');
    assert.equal(v.dna._fidelity, undefined, 'variant ห้ามมี _fidelity (ไม่ได้วัดจริง)');
    assert.equal(v.imagePath, momA.imagePath, 'imagePath ชี้ภาพแม่ (provenance)');
    assert.deepEqual(v.dna.matchNewsType, momA.dna.matchNewsType, 'metadata match สืบทอด');
  }
});
test('derive: แม่ B → variant เกรด C (ห้ามเกิน B)', () => {
  const momB = mkMother(LAYOUT_HERO_LEFT, { score: 75 });
  assert.equal(computeTemplateGrade(momB).grade, 'B');
  const vs = deriveTemplateVariants(momB, { now: 'T' });
  assert.ok(vs.length >= 1);
  for (const v of vs) assert.equal(computeTemplateGrade(v).grade, 'C', `${v.id} แม่ B → C`);
});
test('derive: แม่เกรด C/F → ไม่กลั่น (คืน [])', () => {
  const momC = mkMother(LAYOUT_HERO_LEFT, { score: 60 });
  assert.equal(computeTemplateGrade(momC).grade, 'C');
  assert.deepEqual(deriveTemplateVariants(momC, { now: 'T' }), []);
});
test('derive: geometry ไม่ sane → variant นั้นถูกทิ้ง (F ถ้าหลุด spec)', () => {
  // variant record ที่ dnaToTemplateSpec พังต้องได้ F จากเส้น derived
  const brokenVariant = { id: 'V', imagePath: '/x.jpg', dna: {
    template: { slots: [rect('a', 0, 0, 100, 100)] }, // 1 ช่อง → spec null
    _derived: { fromRefId: 'MOM', motherGrade: 'A', method: 'mirror', at: 'T', engineVersion: 'v' },
  } };
  assert.equal(computeTemplateGrade(brokenVariant).grade, 'F');
});

// ── ใบปกติเกรดเดิมไม่เปลี่ยน (เส้น derived ไม่กระทบ non-derived) ──
test('ใบปกติในคลังจริง: เกรด stored == recompute (เส้น derived ไม่แตะ)', () => {
  for (const rec of library) {
    if (rec?.dna?._derived) continue; // เฉพาะใบปกติ
    const stored = rec?.dna?._templateGrade?.grade;
    if (stored) assert.equal(computeTemplateGrade(rec).grade, stored, `${rec.id} เกรดเดิมต้องไม่เปลี่ยน`);
  }
});

// ── idempotent + ไม่ mutate แม่ (record เดิม byte-unchanged) ──
test('derive: idempotent — เรียกซ้ำ now เดียวกัน = ผลเท่าเดิมเป๊ะ', () => {
  const mom = mkMother(LAYOUT_HERO_LEFT, { score: 92 });
  const a = deriveTemplateVariants(mom, { now: 'T' });
  const b = deriveTemplateVariants(mom, { now: 'T' });
  assert.deepEqual(b, a);
});
test('derive: PURE — ไม่ mutate record แม่ (byte-unchanged)', () => {
  const mom = mkMother(LAYOUT_HERO_LEFT, { score: 92 });
  const snapshot = structuredClone(mom);
  deriveTemplateVariants(mom, { now: 'T' });
  assert.deepEqual(mom, snapshot, 'แม่ต้องไม่ถูกแตะแม้ byte เดียว');
});
test('derive: variant id = REF-<แม่>-v<method>', () => {
  const mom = { ...mkMother(LAYOUT_HERO_LEFT, { score: 92 }), id: 'REF-abc-123' };
  const vs = deriveTemplateVariants(mom, { now: 'T' });
  for (const v of vs) assert.ok(v.id.startsWith('REF-abc-123-v'), `${v.id} รูปแบบ id ถูก`);
});

// ── real library: ใบแม่ A/B กลั่นได้จริง + variant ผ่าน dnaToTemplateSpec ──
test('real: ใบแม่ A/B ในคลังกลั่น variant ที่วางช่องได้จริง', () => {
  const mothers = library.filter((r) => !r?.dna?._derived).filter((r) => {
    const g = computeTemplateGrade(r).grade; return g === 'A' || g === 'B';
  });
  assert.ok(mothers.length >= 2, 'ต้องมีใบแม่ A/B');
  for (const mom of mothers.slice(0, 4)) {
    for (const v of deriveTemplateVariants(mom, { now: 'T' })) {
      assert.ok(dnaToTemplateSpec(v.dna), `${v.id} ต้องผ่าน dnaToTemplateSpec`);
      const g = computeTemplateGrade(v).grade;
      assert.ok(['B', 'C'].includes(g), `${v.id} เกรด derived ต้อง B/C (ได้ ${g})`);
    }
  }
});
