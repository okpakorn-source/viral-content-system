// ============================================================
// ref-library-repair.test.mjs — R2 sync + duplicate-flag migration (16 ก.ค. 69)
// ------------------------------------------------------------
// ยืน invariant ของ:
//   · syncDnaSlotsToTemplate  (helper แชร์ระหว่าง PATCH กับ migration)
//   · planRepair / applyRepairPlan (scripts/repair-ref-library.mjs)
// ตรวจ: role คง(เนื้อหาเดิม) / role หาย→ตัด / role ใหม่→minimal ไม่มโน · idempotent ·
//        duplicate flag ถูกใบ(ใหม่กว่า) · field อื่น byte-unchanged · resolveRefSlotView สะอาด
// PURE offline — ไม่แตะไฟล์คลังจริง (สร้าง fixture ในหน่วยความจำ)
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDnaSlotsToTemplate, posFromGeometry } from '../src/lib/refCoverLibrary.js';
import { planRepair, applyRepairPlan } from '../scripts/repair-ref-library.mjs';
import { resolveRefSlotView } from '../src/lib/refSlotContract.js';

const clean = (dna) => {
  const v = resolveRefSlotView(dna, { mode: 'template_v1' });
  return {
    unmatched: v.views.filter((x) => !x.semanticMatched).map((x) => x.role),
    dangling: v.diagnostics.danglingDnaRoles.map((x) => x.role),
  };
};

// ── syncDnaSlotsToTemplate ─────────────────────────────────

test('sync: role คงอยู่ → คงเนื้อหาเดิมทั้ง entry (desc/subject/shot)', () => {
  const dnaSlots = [
    { role: 'hero', subject: 'ผู้หญิง', shot: 'closeup', desc: 'ซ้าย · closeup · ผู้หญิง', pos: 'ซ้าย' },
    { role: 'context', subject: 'ห้อง', shot: 'medium', desc: 'บนขวา · medium · ห้อง', pos: 'บนขวา' },
  ];
  const tplSlots = [
    { role: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
    { role: 'context', xPct: 50, yPct: 0, wPct: 50, hPct: 50 },
  ];
  const out = syncDnaSlotsToTemplate(dnaSlots, tplSlots);
  assert.deepEqual(out, dnaSlots, 'ทุกช่อง match → entry เดิมครบ ไม่แตะเนื้อหา');
  assert.equal(out[0].desc, 'ซ้าย · closeup · ผู้หญิง', 'desc เดิมคง');
});

test('sync: role หายจาก template → ตัด dna slot นั้นทิ้ง', () => {
  const dnaSlots = [
    { role: 'hero', subject: 'a', shot: 'closeup' },
    { role: 'evidence', subject: 'stale', shot: 'medium' }, // template ไม่มี evidence แล้ว
    { role: 'context', subject: 'c', shot: 'medium' },
  ];
  const tplSlots = [
    { role: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
    { role: 'context', xPct: 50, yPct: 0, wPct: 50, hPct: 100 },
  ];
  const out = syncDnaSlotsToTemplate(dnaSlots, tplSlots);
  assert.deepEqual(out.map((s) => s.role), ['hero', 'context'], 'evidence ถูกตัด');
  assert.ok(!out.some((s) => s.subject === 'stale'), 'ไม่มี entry stale หลงเหลือ');
});

test('sync: role ใหม่ใน template → เพิ่ม entry ขั้นต่ำ {role,pos} เท่านั้น (ห้ามมโน subject/shot)', () => {
  const dnaSlots = [{ role: 'hero', subject: 'a', shot: 'closeup', desc: 'x' }];
  const tplSlots = [
    { role: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
    { role: 'reaction', xPct: 60, yPct: 70, wPct: 30, hPct: 25 }, // ใหม่ (ล่างขวา)
  ];
  const out = syncDnaSlotsToTemplate(dnaSlots, tplSlots);
  assert.equal(out.length, 2);
  const added = out[1];
  assert.deepEqual(Object.keys(added).sort(), ['pos', 'role'], 'entry ใหม่มีแค่ role+pos');
  assert.equal(added.role, 'reaction');
  assert.equal(added.pos, 'ล่างขวา', 'pos มาจาก geometry');
  assert.equal(added.subject, undefined, 'ห้ามมโน subject');
  assert.equal(added.shot, undefined, 'ห้ามมโน shot');
  assert.equal(added.desc, undefined, 'ห้ามมโน desc');
});

test('sync: ผลลัพธ์ทำให้ resolveRefSlotView สะอาด (0 dangling + 0 unmatched)', () => {
  const tplSlots = [
    { role: 'hero', xPct: 0, yPct: 0, wPct: 47, hPct: 100 },
    { role: 'context', xPct: 47, yPct: 0, wPct: 53, hPct: 37 },
    { role: 'evidence', xPct: 47, yPct: 37, wPct: 51, hPct: 28 },
    { role: 'moment', xPct: 47, yPct: 65, wPct: 53, hPct: 35 },
    { role: 'reaction', shape: 'circle', xPct: 7, yPct: 60, wPct: 36, hPct: 29 },
  ];
  const dnaSlots = [ // ค้าง: มี moment ซ้ำ (dangling) + ไม่มี reaction (unmatched)
    { role: 'hero' }, { role: 'context' }, { role: 'evidence' }, { role: 'moment' }, { role: 'moment' },
  ];
  const synced = syncDnaSlotsToTemplate(dnaSlots, tplSlots);
  const dna = { template: { slots: tplSlots }, slots: synced };
  const c = clean(dna);
  assert.deepEqual(c.dangling, [], 'ไม่มี dangling');
  assert.deepEqual(c.unmatched, [], 'ไม่มี unmatched');
});

test('sync: idempotent — dna.slots ที่ align แล้ว ป้อนซ้ำ = เท่าเดิม', () => {
  const tplSlots = [
    { role: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
    { role: 'context', xPct: 50, yPct: 0, wPct: 50, hPct: 100 },
  ];
  const dnaSlots = [{ role: 'hero', subject: 'a' }, { role: 'context', subject: 'c' }];
  const once = syncDnaSlotsToTemplate(dnaSlots, tplSlots);
  const twice = syncDnaSlotsToTemplate(once, tplSlots);
  assert.deepEqual(twice, once, 'รันซ้ำไม่เปลี่ยน');
  assert.deepEqual(once, dnaSlots, 'align อยู่แล้ว = คงเดิม');
});

test('sync: template ว่าง → คืน dna.slots เดิม (กันลบเกลี้ยง)', () => {
  const dnaSlots = [{ role: 'hero' }, { role: 'context' }];
  assert.deepEqual(syncDnaSlotsToTemplate(dnaSlots, []), dnaSlots);
  assert.deepEqual(syncDnaSlotsToTemplate(dnaSlots, undefined), dnaSlots);
});

test('sync: duplicate role ใน template → จับคู่ nth-to-nth คง content ต่อ occurrence', () => {
  const tplSlots = [
    { role: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 50 },
    { role: 'hero', xPct: 0, yPct: 50, wPct: 50, hPct: 50 },
    { role: 'context', xPct: 50, yPct: 0, wPct: 50, hPct: 100 },
  ];
  const dnaSlots = [
    { role: 'hero', subject: 'H1' }, { role: 'hero', subject: 'H2' }, { role: 'context', subject: 'C' },
  ];
  const out = syncDnaSlotsToTemplate(dnaSlots, tplSlots);
  assert.deepEqual(out.map((s) => s.subject), ['H1', 'H2', 'C'], 'สอง hero คงครบตามลำดับ');
  assert.deepEqual(clean({ template: { slots: tplSlots }, slots: out }), { unmatched: [], dangling: [] });
});

test('posFromGeometry: deterministic zones + null เมื่อ geometry ไม่ครบ', () => {
  assert.equal(posFromGeometry({ xPct: 0, yPct: 0, wPct: 40, hPct: 40 }), 'บนซ้าย');
  assert.equal(posFromGeometry({ xPct: 55, yPct: 55, wPct: 45, hPct: 45 }), 'ล่างขวา');
  assert.equal(posFromGeometry({ xPct: 30, yPct: 30, wPct: 40, hPct: 40 }), 'กลาง');
  assert.equal(posFromGeometry({ xPct: 0, yPct: 60, wPct: 100, hPct: 40 }), 'ล่าง');
  assert.equal(posFromGeometry({ xPct: 0, yPct: 0, wPct: 'x', hPct: 40 }), null);
});

// ── planRepair / applyRepairPlan (migration) ──────────────

function fixture() {
  return [
    { // ต้องซ่อม: evidence dangling + reaction unmatched
      id: 'A', uploadedAt: '2026-01-01T00:00:00Z', imagePath: '/x/a.jpg',
      dna: {
        _fidelity: { score: 88 }, panelCount: 3,
        template: { slots: [
          { role: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
          { role: 'context', xPct: 50, yPct: 0, wPct: 50, hPct: 50 },
          { role: 'reaction', xPct: 55, yPct: 60, wPct: 40, hPct: 35 },
        ] },
        slots: [{ role: 'hero', subject: 'h' }, { role: 'context', subject: 'c' }, { role: 'evidence', subject: 'stale' }],
      },
    },
    { // สะอาดอยู่แล้ว — ต้องไม่แตะ
      id: 'B', uploadedAt: '2026-01-02T00:00:00Z', imagePath: '/x/b.jpg',
      dna: {
        _fidelity: { score: 90 }, panelCount: 2,
        template: { slots: [
          { role: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
          { role: 'context', xPct: 50, yPct: 0, wPct: 50, hPct: 100 },
        ] },
        slots: [{ role: 'hero', subject: 'h' }, { role: 'context', subject: 'c' }],
      },
    },
    // duplicate pair: C (เก่ากว่า) = ต้นฉบับ, D (ใหม่กว่า) = ต้องติดธง
    { id: 'C', uploadedAt: '2026-01-03T00:00:00Z', imagePath: '/x/c.jpg', dna: { panelCount: 1, template: { slots: [{ role: 'hero', xPct: 0, yPct: 0, wPct: 100, hPct: 100 }] }, slots: [{ role: 'hero' }] } },
    { id: 'D', uploadedAt: '2026-01-04T00:00:00Z', imagePath: '/x/d.jpg', dna: { panelCount: 1, template: { slots: [{ role: 'hero', xPct: 0, yPct: 0, wPct: 100, hPct: 100 }] }, slots: [{ role: 'hero' }] } },
  ];
}

// hash: C และ D ภาพเดียวกัน (byte-identical จำลอง)
const hashMap = () => new Map([['A', 'ha'], ['B', 'hb'], ['C', 'hcd'], ['D', 'hcd']]);

test('migration: ซ่อม (ก) — dna.slots align + คงใบสะอาดไว้เดิม', () => {
  const recs = fixture();
  const plan = planRepair(recs, hashMap());
  const a = plan.results.find((r) => r.id === 'A');
  const b = plan.results.find((r) => r.id === 'B');
  assert.equal(a.slotsChanged, true, 'A ต้องถูกซ่อม');
  assert.deepEqual(a.after.dnaRoles, ['hero', 'context', 'reaction'], 'evidence ตัด, reaction เพิ่ม');
  assert.equal(b.slotsChanged, false, 'B สะอาด → ไม่แตะ dna.slots');
});

test('migration: ซ่อม (ข) — ใบใหม่กว่าติดธง _duplicateOf ชี้ต้นฉบับ (ใบเก่าไม่ติด)', () => {
  const recs = fixture();
  const plan = planRepair(recs, hashMap());
  const c = plan.results.find((r) => r.id === 'C');
  const d = plan.results.find((r) => r.id === 'D');
  assert.equal(c.duplicateOf, null, 'ต้นฉบับ (เก่ากว่า) ไม่ติดธง');
  assert.equal(d.duplicateOf, 'C', 'ใบใหม่กว่าติดธงชี้ C');
  applyRepairPlan(recs, plan);
  assert.equal(recs.find((r) => r.id === 'D')._duplicateOf, 'C');
  assert.equal(recs.find((r) => r.id === 'C')._duplicateOf, undefined, 'ไม่ลบ record ใด (soft-flag)');
  assert.equal(recs.length, 4, 'record ครบ 4 ไม่มีการลบ');
});

test('migration: field อื่น byte-unchanged (รวม _fidelity ของ R1)', () => {
  const recs = fixture();
  const before = JSON.parse(JSON.stringify(recs));
  const plan = planRepair(recs, hashMap());
  applyRepairPlan(recs, plan);
  for (const rec of recs) {
    const b = before.find((x) => x.id === rec.id);
    const strip = (o) => { const j = JSON.parse(JSON.stringify(o)); delete j._duplicateOf; if (j.dna) delete j.dna.slots; return j; };
    assert.deepEqual(strip(rec), strip(b), `${rec.id}: field อื่นต้องไม่เปลี่ยน`);
    if (b.dna?._fidelity) assert.deepEqual(rec.dna._fidelity, b.dna._fidelity, `${rec.id}: _fidelity คงเดิม`);
  }
});

test('migration: idempotent — apply แล้ว plan รอบสองต้องไม่มีอะไรเปลี่ยน', () => {
  const recs = fixture();
  applyRepairPlan(recs, planRepair(recs, hashMap()));
  const snapshot = JSON.parse(JSON.stringify(recs));
  const plan2 = planRepair(recs, hashMap());
  assert.ok(plan2.results.every((r) => !r.changed), 'รอบสองต้อง 0 change');
  applyRepairPlan(recs, plan2);
  assert.deepEqual(recs, snapshot, 'apply ซ้ำไม่เปลี่ยน byte ใด');
});

test('migration: ทุกใบสะอาดหลังซ่อม (resolveRefSlotView 0 dangling/unmatched)', () => {
  const recs = fixture();
  applyRepairPlan(recs, planRepair(recs, hashMap()));
  for (const rec of recs) {
    const c = clean(rec.dna);
    assert.deepEqual(c, { unmatched: [], dangling: [] }, `${rec.id} ต้องสะอาด`);
  }
});
