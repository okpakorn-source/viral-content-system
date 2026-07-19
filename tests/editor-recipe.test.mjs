// เทส PURE ของ src/lib/editorRecipe.js — ครอบ pct→px, circle→diameter, mapping semantic/legacy, pool prefer-rehosted
// รัน: node --test tests/editor-recipe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEditorRecipe,
  slotsFromTemplate,
  slotsFromManifest,
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

// ★ 18 ก.ค. 69 (บั๊ก AC-0147 ภาพหาย/สลับใน editor): manifest ชี้ URL ต้นทางดิบ (TikTok ฯลฯ ที่เบราว์เซอร์
//   โหลดไม่ได้เพราะบล็อก hotlink) แต่ภาพเดียวกันมี thumbnailUrl ที่ rehost แล้ว → ต้องยกระดับเป็น rehost
test('manifest url ดิบ + ภาพเดียวกันมี thumbnailUrl rehost → ยกระดับเป็น rehost (ไม่ปล่อย URL ที่เบราว์เซอร์โหลดไม่ได้)', () => {
  const RAW = 'https://www.tiktok.com/api/img/?itemId=999&location=0';
  const TH_REHOST = 'https://abc.supabase.co/storage/v1/object/public/acs-frames/x1.jpg';
  const job = legacyJob();
  job.dossier.cover.manifest = { slots: [{ slot: 'main', imageUrl: RAW }] };
  const imgs = [{ id: 'X1', imageUrl: RAW, thumbnailUrl: TH_REHOST, note: '', person: '' }];
  const r = buildEditorRecipe({ job, caseImages: imgs });
  assert.strictEqual(r.imagesBySlot.main, TH_REHOST, 'ต้องเลือก thumbnailUrl ที่ rehost แทน URL ดิบ');
});

// ============================================================ 19 ก.ค. 69: ด่านกันเหนียว — compose ไม่มี ref (dna ว่าง)
// manifest.slots พก geometry ต่อช่อง (composer แนบ x/y/w/h/shape/zIndex) → editor สร้าง slot จาก manifest ได้ (ไม่จอดำ)
test('slotsFromManifest: px 1080×1350 (ไม่มี canvas = ถือ 1080×1350) → map ตรง + circle→diameter + role/id คงคอนเวนชัน', () => {
  const ms = [
    { slot: 'main', imageUrl: 'u1', x: 0, y: 0, w: 616, h: 1350, shape: 'rect', zIndex: 0 },
    { slot: 'right_bottom', imageUrl: 'u2', x: 616, y: 540, w: 464, h: 810, shape: 'rect', zIndex: 0, border: '#FFD700', borderWidth: 6 },
    { slot: 'circle', imageUrl: 'u3', x: 34, y: 940, w: 380, h: 380, shape: 'circle', zIndex: 4, border: '#FFFFFF', borderWidth: 14 },
  ];
  const slots = slotsFromManifest(ms, null);
  assert.equal(slots.length, 3);
  const main = slots.find((s) => s.id === 'main');
  assert.equal(main.role, 'hero'); // id 'main' → role hero (เท่า slotsFromSpec)
  assert.equal(main.x, 0); assert.equal(main.y, 0); assert.equal(main.w, 616); assert.equal(main.h, 1350);
  const rb = slots.find((s) => s.id === 'right_bottom');
  assert.equal(rb.border, '#FFD700'); assert.equal(rb.borderWidth, 6); assert.equal(rb.draggable, true);
  const circ = slots.find((s) => s.shape === 'circle');
  assert.equal(circ.id, 'circle');
  assert.equal(circ.diameter, 380); // w→diameter
  assert.equal(circ.w, undefined); // วงกลมไม่มี w/h
  assert.equal(circ.border, '#FFFFFF'); assert.equal(circ.zIndex, 4);
});

test('slotsFromManifest: canvas 1200×1350 → สเกลกว้างลง 1080 (x/w×0.9) · สูง 1:1 · ไม่ล้นขอบขวา', () => {
  // vt_ref_tri จริง (fallback ไม่มี ref): main w660, right_top x666 — ต้นทาง 1200 กว้าง
  const ms = [
    { slot: 'main', imageUrl: 'u1', x: 0, y: 0, w: 660, h: 1350, shape: 'rect', zIndex: 0 },
    { slot: 'right_top', imageUrl: 'u2', x: 666, y: 0, w: 534, h: 448, shape: 'rect', zIndex: 0 },
  ];
  const slots = slotsFromManifest(ms, { w: 1200, h: 1350 });
  const main = slots.find((s) => s.id === 'main');
  assert.equal(main.w, Math.round(660 * 1080 / 1200)); // 594
  assert.equal(main.h, 1350); // สูง 1:1
  const rt = slots.find((s) => s.id === 'right_top');
  assert.equal(rt.x, Math.round(666 * 1080 / 1200)); // 599
  // ขวาสุดของช่องขวา ต้องไม่เกิน 1080 (ไม่ล้นขอบ)
  assert.ok(rt.x + rt.w <= 1080, 'ช่องขวาต้องอยู่ในผืน editor 1080');
});

test('slotsFromManifest: manifest slot ไม่มี geometry (มีแค่ slot/imageUrl) → ข้าม (ไม่มั่ว)', () => {
  const ms = [
    { slot: 'main', imageUrl: 'u1' }, // ไม่มี x/y/w/h
    { slot: 'circle', imageUrl: 'u2', x: 34, y: 940, w: 380, h: 380, shape: 'circle', zIndex: 4 },
  ];
  const slots = slotsFromManifest(ms, null);
  assert.equal(slots.length, 1, 'ช่องไม่มี geometry ถูกข้าม');
  assert.equal(slots[0].id, 'circle');
});

test('buildEditorRecipe: ไม่มี dna + manifest มี geometry → สร้าง slot จาก manifest + ภาพ map ลงถูก (ไม่จอดำ)', () => {
  const REHOST_A = 'https://abc.supabase.co/storage/v1/object/public/acs-frames/a.jpg';
  const job = {
    id: 'NOREF-1',
    status: 'cover_ready',
    dossier: {
      desk: { title: 'ข่าวไม่มี ref จากคลัง' },
      images: { caseId: 'AC-7777' },
      refMatch: { dna: null, styleName: null }, // ★ ไม่มี ref → dna ว่าง (ตรงกับ cover-ref-test/page.js เมื่อ matchedRef ว่าง)
      pickImages: { slots: {} }, // ว่าง — ภาพต่อช่องยึด manifest
      cover: {
        qcVerdict: { pass: null, reasons: [], advisory: [] },
        manifest: {
          canvasW: 1200, canvasH: 1350, // fallback vt_faces_circle
          slots: [
            { slot: 'main', imageUrl: 'https://ext.example/main.jpg', x: 0, y: 0, w: 648, h: 1350, shape: 'rect', zIndex: 0 },
            { slot: 'top_right', imageUrl: REHOST_A, x: 648, y: 0, w: 552, h: 672, shape: 'rect', zIndex: 0 },
            { slot: 'circle', imageUrl: 'https://ext.example/c.jpg', x: 40, y: 876, w: 446, h: 446, shape: 'circle', zIndex: 4, border: '#FFFFFF', borderWidth: 8 },
          ],
        },
      },
    },
  };
  const r = buildEditorRecipe({ job, caseImages: [] });
  // slots สร้างจาก manifest (เดิม = ว่าง → จอดำ)
  assert.equal(r.template.slots.length, 3, 'ต้องมี 3 ช่องจาก manifest');
  assert.ok(r.template.slots.find((s) => s.id === 'main'), 'มีช่อง main');
  assert.ok(r.template.slots.find((s) => s.shape === 'circle'), 'มีช่องวงกลม');
  // ภาพ map ลงครบทุกช่อง (manifest override) — ไม่จอดำ
  assert.equal(r.imagesBySlot.main, 'https://ext.example/main.jpg');
  assert.equal(r.imagesBySlot.top_right, REHOST_A);
  assert.equal(r.imagesBySlot.circle, 'https://ext.example/c.jpg');
  // สเกล 1200→1080: main w648 → 583
  const main = r.template.slots.find((s) => s.id === 'main');
  assert.equal(main.w, Math.round(648 * 1080 / 1200));
});

test('buildEditorRecipe: มี dna (path เดิม) → ไม่แตะ slotsFromManifest (พฤติกรรมเดิม 100% แม้มี manifest geometry)', () => {
  const job = legacyJob();
  // ใส่ manifest ที่ "มี geometry" ด้วย — path มี dna ต้องยึด slotsFromSpec เดิม ไม่ตกไป slotsFromManifest
  job.dossier.cover.manifest = {
    canvasW: 1080, canvasH: 1350,
    slots: [{ slot: 'main', imageUrl: 'https://ext.example/x.jpg', x: 999, y: 999, w: 111, h: 111, shape: 'rect', zIndex: 0 }],
  };
  const r = buildEditorRecipe({ job, caseImages: caseImages() });
  assert.equal(r.template.slots.length, 5, 'ยังเป็น 5 ช่องจาก dna (ไม่ใช่ 1 ช่องจาก manifest)');
  const main = r.template.slots.find((s) => s.id === 'main');
  assert.notEqual(main.x, 999, 'geometry ต้องมาจาก dna/spec เดิม ไม่ใช่ manifest');
});
