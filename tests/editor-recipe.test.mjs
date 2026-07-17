// เทส PURE ของ src/lib/editorRecipe.js — ครอบ pct→px, circle→diameter, mapping semantic/legacy, pool prefer-rehosted
// รัน: node --test tests/editor-recipe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEditorRecipe,
  slotsFromTemplate,
  assignSlots,
  isRecipeReady,
  isRehostedUrl,
} from '../src/lib/editorRecipe.js';

const REHOST = 'https://ajyhujuxvmdhypmnpfny.supabase.co/storage/v1/object/public/acs-frames/x.jpg';
const EXT = 'https://static.thairath.co.th/media/abc.jpg';

// โครง dna.template.slots จริงจาก MG-0009/MG-0013 (prod) — 5 ช่อง hero/context/evidence/moment/reaction(circle)
function legacyJob() {
  return {
    id: 'MG-TEST',
    status: 'cover_ready',
    dossier: {
      desk: { title: 'ตุ๊ก ญาณี ชี้แจงข่าวลือป่วยหนัก' },
      images: { caseId: 'AC-9999' },
      refMatch: {
        styleName: 'ref-style-x',
        dna: {
          layoutFamily: 'hero-left-collage',
          template: {
            slots: [
              { pos: 'ซ้ายเต็มสูง', hPct: 100, role: 'hero', wPct: 47, xPct: 0, yPct: 0, shape: 'rect', border: false, zIndex: 0, borderColor: '-', borderWidthPct: 0 },
              { pos: 'บนขวา', hPct: 37, role: 'context', wPct: 53, xPct: 47, yPct: 0, shape: 'rect', border: false, zIndex: 0, borderColor: '-', borderWidthPct: 0 },
              { pos: 'inset', hPct: 28, role: 'evidence', wPct: 51, xPct: 47, yPct: 37, shape: 'rect', border: true, zIndex: 3, borderColor: '#00FF00', borderWidthPct: 1.5 },
              { pos: 'ขวาล่าง', hPct: 35, role: 'moment', wPct: 53, xPct: 47, yPct: 65, shape: 'rect', border: false, zIndex: 0, borderColor: '-', borderWidthPct: 0 },
              { hPct: 29, role: 'reaction', wPct: 36, xPct: 7, yPct: 60, shape: 'circle', border: true, zIndex: 4, borderColor: '#FFFFFF', borderWidthPct: 2 },
            ],
          },
        },
      },
      pickImages: {
        slots: {
          hero: { id: 'AC-9999-17', person: 'ตุ๊ก', imageUrl: EXT, backups: ['AC-9999-24'] },
          action: { id: 'AC-9999-19', person: 'ตุ๊ก', imageUrl: EXT, backups: [] },
          circle: { id: 'AC-9999-1', person: 'แผลที่เข่า', imageUrl: EXT, backups: [] },
          context: { id: 'AC-9999-7', person: 'ตุ๊ก', imageUrl: EXT, backups: [] },
          reaction: { id: 'AC-9999-172', person: 'ท็อป', imageUrl: REHOST, backups: [] },
        },
      },
      cover: {
        qcVerdict: { pass: true, reasons: [], advisory: ['หน้ากินช่อง context_1'] },
      },
    },
  };
}

// caseImages: AC-9999-17 มีทั้ง rehosted (imageUrl) — ใช้ทดสอบ prefer-rehosted แทน EXT ใน pickImages
function caseImages() {
  return [
    { id: 'AC-9999-17', imageUrl: REHOST, thumbnailUrl: REHOST, note: 'hero', person: 'ตุ๊ก', width: 800, height: 1000 },
    { id: 'AC-9999-19', imageUrl: EXT, thumbnailUrl: EXT, note: 'moment', person: 'ตุ๊ก' },
    { id: 'AC-9999-1', imageUrl: EXT, thumbnailUrl: REHOST, note: 'evidence', person: 'แผล' },
    { id: 'AC-9999-7', imageUrl: EXT, thumbnailUrl: '', note: 'context', person: 'ตุ๊ก' },
    { id: 'AC-9999-172', imageUrl: REHOST, thumbnailUrl: REHOST, note: 'reaction', person: 'ท็อป' },
    { id: 'AC-9999-88', imageUrl: REHOST, thumbnailUrl: REHOST, note: 'extra', person: 'มดดำ' },
  ];
}

test('isRehostedUrl แยก supabase storage ออกจากเว็บนอก', () => {
  assert.equal(isRehostedUrl(REHOST), true);
  assert.equal(isRehostedUrl(EXT), false);
  assert.equal(isRehostedUrl(null), false);
});

test('slotsFromTemplate: pct→px + circle→diameter + คง zIndex/border + id convention', () => {
  const slots = slotsFromTemplate(legacyJob().dossier.refMatch.dna.template.slots);
  assert.equal(slots.length, 5);

  // hero → id 'main', pct(0,0,47,100) → px(0,0,508,1350)
  const hero = slots.find((s) => s.id === 'main');
  assert.ok(hero, 'ต้องมีช่อง main (hero)');
  assert.equal(hero.x, 0);
  assert.equal(hero.y, 0);
  assert.equal(hero.w, Math.round(0.47 * 1080)); // 508
  assert.equal(hero.h, 1350);
  assert.equal(hero.zIndex, 0);

  // evidence: border เขียว คงไว้ + draggable
  const ev = slots.find((s) => s.role === 'evidence');
  assert.equal(ev.border, '#00FF00');
  assert.ok(ev.borderWidth >= 4);
  assert.equal(ev.zIndex, 3);
  assert.equal(ev.draggable, true);

  // reaction circle → shape circle + diameter (จาก wPct 36) ไม่มี w/h
  const circ = slots.find((s) => s.shape === 'circle');
  assert.equal(circ.id, 'circle');
  assert.equal(circ.diameter, Math.round(0.36 * 1080)); // 389
  assert.equal(circ.x, Math.round(0.07 * 1080));        // 76
  assert.equal(circ.y, Math.round(0.60 * 1350));        // 810
  assert.equal(circ.w, undefined);
  assert.equal(circ.zIndex, 4);
  assert.equal(circ.border, '#FFFFFF');
});

test('assignSlots legacy: role/alias map ครบทั้ง 5 ช่องตรงความหมาย', () => {
  const job = legacyJob();
  const slots = slotsFromTemplate(job.dossier.refMatch.dna.template.slots);
  const map = assignSlots(slots, job.dossier.pickImages.slots, null);
  // main←hero, context_1←context, evidence_2←circle(หลักฐาน), moment_3←action, circle←reaction
  const idOf = (role) => slots.find((s) => s.role === role).id;
  assert.equal(map[idOf('hero')], 'hero');
  assert.equal(map[idOf('context')], 'context');
  assert.equal(map[idOf('evidence')], 'circle');
  assert.equal(map[idOf('moment')], 'action');
  assert.equal(map[idOf('reaction')], 'reaction');
  // ไม่มี key ซ้ำ — ใช้ครบทั้ง 5 ไม่ชน
  assert.equal(new Set(Object.values(map)).size, 5);
});

test('assignSlots semantic: refSlotId ตรง id → จับคู่ตรงตัว, ที่เหลือ positional ตาม slotOrder', () => {
  const slots = slotsFromTemplate(legacyJob().dossier.refMatch.dna.template.slots);
  // pickImages เวอร์ชัน semantic: entry มี refSlotId ชี้ id ที่ derive (main/circle) + slotOrder
  const pick = {
    a: { id: 'x1', refSlotId: 'main', imageUrl: REHOST },
    b: { id: 'x2', refSlotId: 'circle', imageUrl: REHOST },
    c: { id: 'x3', refSlotId: 'zzz', imageUrl: REHOST },
    d: { id: 'x4', refSlotId: 'yyy', imageUrl: REHOST },
    e: { id: 'x5', refSlotId: 'www', imageUrl: REHOST },
  };
  const order = ['a', 'b', 'c', 'd', 'e'];
  const map = assignSlots(slots, pick, order);
  // main↔a, circle↔b จับตรง refSlotId
  assert.equal(map['main'], 'a');
  assert.equal(map['circle'], 'b');
  // ช่องที่เหลือได้ c/d/e ตาม positional (ไม่ซ้ำ)
  const vals = Object.values(map);
  assert.equal(new Set(vals).size, 5);
  assert.ok(vals.includes('c') && vals.includes('d') && vals.includes('e'));
});

test('buildEditorRecipe: imagesBySlot prefer-rehosted (id ตรง → ใช้ supabase แทน url เว็บนอกใน pickImages)', () => {
  const recipe = buildEditorRecipe({ job: legacyJob(), caseImages: caseImages() });
  // hero: pickImages.imageUrl=EXT แต่ caseImages[AC-9999-17].imageUrl=REHOST → ต้องได้ REHOST
  assert.equal(recipe.imagesBySlot['main'], REHOST);
  // evidence(circle→AC-9999-1): caseImages thumbnailUrl=REHOST → prefer rehosted
  const evId = recipe.template.slots.find((s) => s.role === 'evidence').id;
  assert.equal(recipe.imagesBySlot[evId], REHOST);
  // context(AC-9999-7): ไม่มี rehosted เลย → คง EXT
  const ctxId = recipe.template.slots.find((s) => s.role === 'context').id;
  assert.equal(recipe.imagesBySlot[ctxId], EXT);
});

test('buildEditorRecipe: pool prefer-rehosted + โครง + qc + template id', () => {
  const recipe = buildEditorRecipe({ job: legacyJob(), caseImages: caseImages() });
  assert.equal(recipe.canvasW, 1080);
  assert.equal(recipe.canvasH, 1350);
  assert.equal(recipe.template.id, 'recipe-MG-TEST');
  assert.equal(recipe.template.slots.length, 5);
  // pool: 6 ใบ, ใบที่ imageUrl=EXT แต่ thumbnailUrl=REHOST → url เลือก REHOST
  assert.equal(recipe.pool.length, 6);
  const evPool = recipe.pool.find((p) => p.id === 'AC-9999-1');
  assert.equal(evPool.url, REHOST); // prefer rehosted จาก thumbnailUrl
  // qc pass true
  assert.equal(recipe.qc.pass, true);
});

test('buildEditorRecipe: qc pass=false → summary+reasons ให้คนแก้', () => {
  const job = legacyJob();
  job.dossier.cover.qcVerdict = { pass: false, reasons: ['ภาพเล็ก', 'หน้าเบลอ'], advisory: [] };
  const recipe = buildEditorRecipe({ job, caseImages: caseImages() });
  assert.equal(recipe.qc.pass, false);
  assert.deepEqual(recipe.qc.reasons, ['ภาพเล็ก', 'หน้าเบลอ']);
  assert.match(recipe.qc.summary, /ไม่ผ่าน/);
});

test('buildEditorRecipe: ไม่มี cover.qcVerdict (งานล้มก่อนถึง QC) → pass=null ไม่ throw', () => {
  const job = legacyJob();
  delete job.dossier.cover;
  const recipe = buildEditorRecipe({ job, caseImages: caseImages() });
  assert.equal(recipe.qc.pass, null);
  assert.equal(recipe.template.slots.length, 5);
});

test('isRecipeReady: ต้องมีทั้ง pickImages.slots + refMatch.dna.template.slots', () => {
  assert.equal(isRecipeReady(legacyJob()), true);
  assert.equal(isRecipeReady({ id: 'x', dossier: {} }), false);
  assert.equal(isRecipeReady({ id: 'x', dossier: { pickImages: { slots: { hero: {} } } } }), false);
  assert.equal(isRecipeReady(null), false);
});

// ============================================================ manifest = ความจริงสุดท้าย (17 ก.ค. — บั๊กปกจริง ≠ ผังใน editor)
test('manifest.slots มี → imagesBySlot ยึดผังประกอบจริง (ทับ role-mapping) เฉพาะ id ที่แมตช์ช่อง', () => {
  const job = legacyJob();
  // composer สลับจริง: main ได้ภาพ 88 (ไม่ใช่ 17 ตามแผน S6) + มี id แปลกปลอมที่ไม่ใช่ช่องจริง
  job.dossier.cover.manifest = {
    slots: [
      { slot: 'main', imageUrl: 'https://ext.example/final-main.jpg' },
      { slot: 'circle', imageUrl: REHOST },
      { slot: 'slot_ผี', imageUrl: 'https://ext.example/ghost.jpg' },
    ],
  };
  const r = buildEditorRecipe({ job, caseImages: caseImages() });
  assert.strictEqual(r.imagesBySlot.main, 'https://ext.example/final-main.jpg', 'ยึด manifest ไม่ใช่แผน S6');
  assert.strictEqual(r.imagesBySlot.circle, REHOST);
  assert.ok(!('slot_ผี' in r.imagesBySlot), 'id ที่ไม่ใช่ช่องจริงถูกทิ้ง');
});

test('manifest url ตรงกับภาพในพูล → ยกระดับเป็น URL rehost ของภาพเดียวกัน', () => {
  const job = legacyJob();
  const extUrl = caseImages()[1].imageUrl; // AC-9999-19 = EXT ในพูล
  job.dossier.cover.manifest = { slots: [{ slot: 'main', imageUrl: extUrl }] };
  const r = buildEditorRecipe({ job, caseImages: caseImages() });
  assert.strictEqual(r.imagesBySlot.main, extUrl, 'พูลใบนี้ไม่มี rehost → คง url จริง');
});

test('ไม่มี manifest → role-mapping เดิมเป๊ะ (งานที่ยังไม่เคยประกอบ)', () => {
  const job = legacyJob();
  delete job.dossier.cover.manifest;
  const r = buildEditorRecipe({ job, caseImages: caseImages() });
  assert.ok(r.imagesBySlot.main, 'ยังมีภาพจาก role-mapping');
});
