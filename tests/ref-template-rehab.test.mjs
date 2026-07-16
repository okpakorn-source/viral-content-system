// ============================================================
// ref-template-rehab.test.mjs (R5a) — กู้พิกัดเทมเพลตให้ตรงตะเข็บจริง (PURE, ไม่มี AI)
// ------------------------------------------------------------
// สังเคราะห์ภาพคอลลาจด้วย sharp (ตะเข็บที่พิกัดรู้แน่) + template ที่ "เพี้ยน" จากตะเข็บจริง แล้วตรวจว่า:
//   1) template เพี้ยน ~25px → กู้แล้ว offset≈0 + score พุ่ง
//   2) confidence ต่ำ (ภาพสีเดียว ไม่มีตะเข็บ) → ไม่แตะ (changed=false)
//   3) เลื่อนเกิน 60px (fidelityDetail สังเคราะห์) → ยกเลิกทั้งใบ (fail-closed)
//   4) หลังกู้ + sync → resolveRefSlotView ยังสะอาด (0 dangling/unmatched)
//   5) idempotent — กู้ซ้ำใบที่กู้แล้ว (มี _rehabbed) = ไม่เปลี่ยน
//   6) _geomBeforeRehab ครบทุกช่องที่ขยับ (rollback ต่อช่อง) + ช่องที่ไม่ขยับต้องไม่มี
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { measureTemplateFidelity } from '../src/lib/refTemplateFidelity.js';
import { rehabilitateTemplate, REHAB_ENGINE_VERSION } from '../src/lib/refTemplateRehab.js';
import { dnaToTemplateSpec } from '../src/lib/refTemplate.js';
import { syncDnaSlotsToTemplate } from '../src/lib/refCoverLibrary.js';
import { resolveRefSlotView } from '../src/lib/refSlotContract.js';

const W = 1080, H = 1350;

// ภาพ 3 บล็อก: ซ้ายเต็มสูง (แดง) | ขวาบน (น้ำเงิน) | ขวาล่าง (เขียว)
//   ตะเข็บแนวตั้งจริง x=540 · ตะเข็บแนวนอนจริง (ครึ่งขวา) y=675
async function makeCollage() {
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 20, g: 20, b: 20 } } })
    .composite([
      { input: { create: { width: 540, height: H, channels: 3, background: { r: 220, g: 30, b: 30 } } }, left: 0, top: 0 },
      { input: { create: { width: 540, height: 675, channels: 3, background: { r: 30, g: 30, b: 220 } } }, left: 540, top: 0 },
      { input: { create: { width: 540, height: 675, channels: 3, background: { r: 30, g: 200, b: 30 } } }, left: 540, top: 675 },
    ]).jpeg({ quality: 95 }).toBuffer();
}
async function makeSolid() {
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg({ quality: 95 }).toBuffer();
}

// DNA ที่ตะเข็บแนวตั้งเพี้ยนไป ~52.3% (ตะเข็บจริง 50%) → spec ~562px คลาดจาก 540 ~22px
function makeDistortedRecord() {
  return {
    id: 'SYN', imagePath: '/x.jpg',
    dna: {
      template: { seamStyle: 'hard', featherPx: 0, slots: [
        { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 52.3, hPct: 100 },
        { role: 'context', shape: 'rect', xPct: 52.3, yPct: 0, wPct: 47.7, hPct: 50 },
        { role: 'evidence', shape: 'rect', xPct: 52.3, yPct: 50, wPct: 47.7, hPct: 50 },
      ] },
      slots: [{ role: 'hero' }, { role: 'context' }, { role: 'evidence' }],
    },
  };
}

const measure = (img, dna) => measureTemplateFidelity({ imageBuffer: img, templateSpec: dnaToTemplateSpec(dna) });

test('1) template เพี้ยน ~25px → กู้แล้ว offset≈0 + score พุ่ง', async () => {
  const img = await makeCollage();
  const rec = makeDistortedRecord();
  const f0 = await measure(img, rec.dna);
  assert.equal(f0.confidence, 'ok');
  assert.ok(f0.worstOffsetPx >= 15, `ก่อนกู้ต้องคลาดชัด (ได้ ${f0.worstOffsetPx})`);

  const reh = rehabilitateTemplate({ record: rec, fidelityDetail: f0, now: '2026-07-16T00:00:00Z' });
  assert.equal(reh.changed, true, 'ต้องกู้จริง');
  assert.ok(reh.movedBoundaries >= 1);
  assert.equal(reh.rehabFlag.engineVersion, REHAB_ENGINE_VERSION);

  const f1 = await measure(img, { ...rec.dna, template: { ...rec.dna.template, slots: reh.slots } });
  assert.ok(f1.worstOffsetPx <= 6, `หลังกู้ต้องตรง (ได้ ${f1.worstOffsetPx})`);
  assert.ok(f1.score > f0.score, `score ต้องพุ่ง (${f0.score}→${f1.score})`);
  const vSeam = f1.boundaries.find((b) => b.type === 'v' && !b.lowConfidence);
  assert.ok(vSeam && vSeam.offsetPx <= 5, `ตะเข็บตั้งหลังกู้ต้อง≈0 (ได้ ${vSeam?.offsetPx})`);

  // ★ ไม่ mutate record เดิม (PURE)
  assert.equal(rec.dna.template.slots[0].wPct, 52.3, 'record เดิมต้องไม่ถูกแตะ');
});

test('2) confidence ต่ำ (ภาพสีเดียว ไม่มีตะเข็บ) → ไม่แตะ (changed=false)', async () => {
  const img = await makeSolid();
  const rec = makeDistortedRecord();
  const f0 = await measure(img, rec.dna);
  assert.equal(f0.confidence, 'low', 'สีเดียว → low');
  const reh = rehabilitateTemplate({ record: rec, fidelityDetail: f0, now: 'Z' });
  assert.equal(reh.changed, false, 'ไม่มี boundary มั่นใจ → ไม่ขยับ');
  assert.equal(reh.rehabFlag, null);
  // slots ที่คืนต้อง deep-equal ของเดิม (ไม่มี _geomBeforeRehab)
  assert.deepEqual(reh.slots, rec.dna.template.slots);
});

test('3) เลื่อนเกิน 60px (fidelityDetail สังเคราะห์) → ยกเลิกทั้งใบ (fail-closed)', async () => {
  const rec = makeDistortedRecord();
  const spec = dnaToTemplateSpec(rec.dna);
  const vEdge = spec.slots.find((s) => s.id === 'main'); // ขอบขวา main = ตะเข็บตั้ง
  const coord = Math.round(vEdge.x + vEdge.w);
  // fabricate: ตะเข็บจริงอยู่ห่าง 70px (> MAX_MOVE_PX 60) — เกิน SEARCH_RADIUS ของ R1 จริง (มั่ว)
  const fakeDetail = { boundaries: [
    { type: 'v', coord, foundCoord: coord - 70, offsetPx: 70, confidence: 0.6, prominence: 0.9, lowConfidence: false, slotIds: ['main', 'context_1', 'evidence_2'] },
  ] };
  const reh = rehabilitateTemplate({ record: rec, fidelityDetail: fakeDetail, now: 'Z' });
  assert.equal(reh.aborted, true, 'เลื่อน >60px ต้อง fail-closed');
  assert.equal(reh.changed, false);
  assert.equal(reh.slots, null, 'ยกเลิกทั้งใบ → ไม่คืน slots');
  assert.ok(/> 60/.test(reh.reason), `เหตุผลต้องบอกเกิน 60 (ได้ ${reh.reason})`);
});

test('4) หลังกู้ + sync → resolveRefSlotView ยังสะอาด (0 dangling/unmatched)', async () => {
  const img = await makeCollage();
  const rec = makeDistortedRecord();
  const f0 = await measure(img, rec.dna);
  const reh = rehabilitateTemplate({ record: rec, fidelityDetail: f0, now: 'Z' });
  assert.equal(reh.changed, true);
  const syncedDnaSlots = syncDnaSlotsToTemplate(rec.dna.slots, reh.slots);
  const dna = { template: { slots: reh.slots }, slots: syncedDnaSlots };
  const v = resolveRefSlotView(dna, { mode: 'template_v1' });
  assert.deepEqual(v.diagnostics.danglingDnaRoles.map((d) => d.role), [], 'ไม่มี dangling');
  assert.deepEqual(v.views.filter((x) => !x.semanticMatched).map((x) => x.role), [], 'ไม่มี unmatched');
});

test('5) idempotent — กู้ซ้ำใบที่กู้แล้ว (มี _rehabbed) = ไม่เปลี่ยน', async () => {
  const img = await makeCollage();
  const rec = makeDistortedRecord();
  const f0 = await measure(img, rec.dna);
  const reh1 = rehabilitateTemplate({ record: rec, fidelityDetail: f0, now: 'Z' });
  assert.equal(reh1.changed, true);

  // จำลองสคริปต์เขียนกลับ: template.slots ใหม่ + ธง _rehabbed
  const rec2 = { ...rec, dna: { ...rec.dna, template: { ...rec.dna.template, slots: reh1.slots }, _rehabbed: reh1.rehabFlag } };
  const f1 = await measure(img, rec2.dna);
  const reh2 = rehabilitateTemplate({ record: rec2, fidelityDetail: f1, now: 'Z' });
  assert.equal(reh2.changed, false, 'ใบที่กู้แล้ว → no-op');
  assert.equal(reh2.reason, 'already-rehabbed');
  assert.deepEqual(reh2.slots, reh1.slots, 'slots ต้องเท่าเดิมเป๊ะ');
});

test('6) _geomBeforeRehab ครบทุกช่องที่ขยับ + ค่าเดิมถูกต้อง', async () => {
  const img = await makeCollage();
  const rec = makeDistortedRecord();
  const f0 = await measure(img, rec.dna);
  const reh = rehabilitateTemplate({ record: rec, fidelityDetail: f0, now: 'Z' });
  assert.equal(reh.changed, true);

  const orig = rec.dna.template.slots;
  let movedCount = 0;
  reh.slots.forEach((s, i) => {
    const geometryChanged =
      s.xPct !== orig[i].xPct || s.yPct !== orig[i].yPct || s.wPct !== orig[i].wPct || s.hPct !== orig[i].hPct;
    if (geometryChanged) {
      movedCount++;
      assert.ok(s._geomBeforeRehab, `ช่อง#${i} ขยับแล้วต้องมี _geomBeforeRehab`);
      assert.deepEqual(s._geomBeforeRehab, {
        xPct: orig[i].xPct, yPct: orig[i].yPct, wPct: orig[i].wPct, hPct: orig[i].hPct,
      }, `ช่อง#${i} _geomBeforeRehab ต้องเก็บพิกัดเดิมครบ`);
    } else {
      assert.equal(s._geomBeforeRehab, undefined, `ช่อง#${i} ไม่ขยับ → ต้องไม่มี _geomBeforeRehab`);
    }
  });
  assert.ok(movedCount >= 1, 'ต้องมีช่องที่ขยับอย่างน้อย 1');
});
