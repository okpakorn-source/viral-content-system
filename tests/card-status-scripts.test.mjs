// ข้อสอบสคริปต์คลังการ์ด v2 (scripts/card-status/*.mjs — F13 ของแบบ 3 ก.ย. 69)
// รัน: node --test tests/card-status-scripts.test.mjs
// กติกา: ห้ามแตะ store จริง/DB — ทุกข้อใช้ fixture + store สตับในหน่วยความจำ · ไฟล์เขียนเฉพาะ tmpdir
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// โหลดโมดูลแบบ dynamic ใน try — โมดูลพังต้องเห็นเป็นข้อสอบแดงข้อแรก ไม่ใช่ runner ล่มทั้งไฟล์
let schema; let armsMod; let backupMod; let migrateMod; let restoreMod; let loadError = null;
try {
  schema = await import('../scripts/card-status/plan-schema.mjs');
  armsMod = await import('../scripts/card-status/build-arms.mjs');
  backupMod = await import('../scripts/card-status/backup.mjs');
  migrateMod = await import('../scripts/card-status/migrate.mjs');
  restoreMod = await import('../scripts/card-status/restore.mjs');
} catch (e) {
  loadError = e;
}

test('โมดูลทั้ง 5 โหลดได้ (ไม่มี side effect/แตะ store ตอน import)', () => {
  assert.equal(loadError, null, `import พัง: ${loadError?.stack}`);
});
if (loadError) process.exit(1);

const { validatePlans, deriveNewCardId, canonicalCardsJson, jsonEqual, EXPECTED_COUNTS } = schema;
const { applyPlans, buildArms, LADDER_ARMS, ARM_FIXED_NOW } = armsMod;
const { writeBackup, readBackupFile } = backupMod;
const { runMigrate, buildReverseScript } = migrateMod;
const { runRestore, planRestoreFromBackup } = restoreMod;

// ── fixture การ์ดเต็มสคีมาจริง (27 field + updatedAt) ──────────────────────────
const PHRASE = 'จบที่ใจความหรืออวยพรสั้นๆ';
function makeCard(n, over = {}) {
  const card = {
    id: `prompt_0000000${n}`,
    promptName: `[ช่วยเหลือกัน-ชื่นชม] การ์ดที่ ${n}`,
    promptText: `คุณคือแอดมินเพจ การ์ด ${n} เล่าเรื่องธรรมชาติ เข้าเรื่องทันที`,
    category: 'ช่วยเหลือกัน',
    tone: 'อบอุ่น',
    hookStyle: 'เข้าเรื่องทันที',
    structure: 'โครง 3 ย่อหน้า',
    writingStyle: 'แอดมินเพจ',
    emotionalType: '',
    ctaStyle: 'ไม่มี CTA บังคับ — จบที่ใจความหรืออวยพรสั้น',
    shareTrigger: 'เล่าความดีให้ชัด',
    commentTrigger: 'เล่าให้อยากคุยต่อ',
    exampleContent: 'ตัวอย่างเนื้อหา',
    visualImagination: 'ภาพการกระทำจริง',
    narrativeArchetype: 'น้ำใจคนไทย',
    sourceContentId: `src-${n}`,
    doNot: ['ห้ามเกริ่นยาว'],
    exampleHooks: ['ฮุกตัวอย่าง'],
    conflictTags: [],
    emotionalTags: ['ซึ้ง'],
    targetCategories: ['ช่วยเหลือกัน'],
    emotionalArc: { open: 'โล่งใจ', middle: 'ซาบซึ้ง', close: `อนุโมทนา และ${PHRASE}` },
    dnaTemplate: { rhythm_formula: 'เปิดชัด', language_formula: 'คำง่าย', emotion_formula: 'อุ่น', structure_formula: `สามช่วง ${PHRASE}` },
    viralScore: 85,
    usageCount: 3,
    successCount: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
  for (const [k, v] of Object.entries(card)) if (v === undefined) delete card[k];
  return card;
}
function makeStore() {
  return [
    makeCard(1),
    makeCard(2, { promptText: `เกริ่นเก่าเล่าอ้อมไปมา ถึงจุดจบท่อนเปิด แล้วเนื้อเรื่องหลักตามมา ${PHRASE}` }),
    makeCard(3),
    makeCard(4),
    makeCard(5, { category: 'ฮีโร่ชาวบ้าน', promptName: '[ฮีโร่ชาวบ้าน-ชื่นชม] การ์ดที่ 5' }),
    makeCard(6, { promptText: `เล่าเรื่องแล้ว${PHRASE} เสมอ` }),
    makeCard(7),
    makeCard(8, { updatedAt: undefined }), // ใบไม่มี updatedAt — ทดสอบ unset ใน reverse-script
  ];
}
function makeNewCard(over = {}) {
  const nc = makeCard(0, {
    promptName: '[คดีความ-เห็นใจ] ใบใหม่เล่าคดีอย่างเป็นธรรม',
    category: 'คดีความ',
    ctaStyle: '',
    promptText: 'ใช้เมื่อ: ข่าวคดีความ เล่าตามข้อเท็จจริง ไม่ฟันธงแทนศาล',
    doNot: ['ห้ามฟันธงผิด-ถูกแทนศาล', 'ห้ามเรียกสถานะคู่ความผิด'],
    targetCategories: ['คดีความ'],
    usageCount: 0,
    successCount: 0,
    viralScore: 83,
    status: 'proposed',
    sourceContentId: '',
    ...over,
  });
  delete nc.id;
  delete nc.createdAt;
  delete nc.updatedAt;
  return nc;
}
function makePlans(over = {}) {
  return {
    planCards: {
      version: 1,
      surgery: {
        prompt_00000001: {
          promptName: '[ช่วยเหลือกัน-ชื่นชม] ผ่าตัดใหม่ scenario+เดิมพัน',
          promptText: 'ผ่าตัดแล้ว เปิดด้วย scenario และเดิมพันจริงของคนในข่าว',
          hookStyle: 'ภาพเดิมพันจริง',
          exampleHooks: ['ฮุกใหม่ 1', 'ฮุกใหม่ 2'],
          doNot: ['ห้ามวลีสำเร็จรูป'],
          emotionalArc: { open: 'เปิดใหม่', middle: 'กลางใหม่', close: 'ปิดใหม่' },
        },
      },
      rename: {
        prompt_00000002: { promptName: '[ช่วยเหลือกัน-ซึ้งใจ] ชื่อธีมชนะ', promptTextHead: 'หัวเปิดใหม่ 600 ตัวแรกแบบ scenario', replaceUntil: 'ถึงจุดจบท่อนเปิด' },
      },
      newCards: [makeNewCard()],
      ...over.planCards,
    },
    planOps: {
      version: 1,
      sweep: {
        ctaStyle: '',
        promptTextRemovePatterns: [PHRASE],
        structureRemovePatterns: [],
        emotionalArcCloseRemovePatterns: [` และ${PHRASE}`],
        dnaTemplateRemovePatterns: [` ${PHRASE}`],
        perCardPromptTextRemovePatterns: { prompt_00000006: [' เสมอ$'] },
        notes: 'fixture',
      },
      archive: ['prompt_00000004', 'prompt_00000007'],
      names: { prompt_00000003: '[ช่วยเหลือกัน-อบอุ่น] ชื่อจัดระเบียบ', prompt_00000007: '[ช่วยเหลือกัน-ซึ้ง] ใบพักเปลี่ยนชื่อ' },
      merge: { prompt_00000005: { category: 'ช่วยเหลือกัน' } },
      viralScoreRemap: { prompt_00000003: 90 },
      evidence: { prompt_00000004: 'กรรมการต่ำสุดเสถียร' },
      ...over.planOps,
    },
  };
}
const NO_COUNTS = { expectedCounts: null };

/** store สตับ — สัญญาเดียวกับ persistStore: update ประทับ updatedAt เสมอ (ทั้ง object/function form) */
function makeStubStore(initialCards) {
  let items = structuredClone(initialCards);
  const calls = { update: [], add: [], remove: [], getAll: 0 };
  return {
    calls,
    items: () => structuredClone(items),
    async getAll() { calls.getAll += 1; return structuredClone(items); },
    async add(item) {
      if (items.some((i) => i.id === item.id)) throw new Error(`duplicate: ${item.id}`);
      items.push(structuredClone(item));
      calls.add.push(structuredClone(item));
      return item;
    },
    async update(id, updateFn) {
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0) throw new Error(`ไม่พบ id: ${id}`);
      if (typeof updateFn === 'function') items[idx] = updateFn(structuredClone(items[idx]));
      else Object.assign(items[idx], structuredClone(updateFn));
      items[idx].updatedAt = new Date().toISOString(); // ตรงพฤติกรรมจริง persistStore.js:331,460
      calls.update.push({ id, payload: typeof updateFn === 'function' ? '(fn)' : structuredClone(updateFn) });
      return structuredClone(items[idx]);
    },
    async remove(id) {
      const before = items.length;
      items = items.filter((i) => i.id !== id);
      if (items.length === before) throw new Error(`ไม่พบ id: ${id}`);
      calls.remove.push(id);
      return { removed: true };
    },
  };
}
const stripUpdatedAt = (c) => { const x = structuredClone(c); delete x.updatedAt; return x; };
const errsJoined = (r) => r.errors.join('\n');

// ── validator ────────────────────────────────────────────────────────────────
test('validator: แผน fixture ที่ถูกต้องผ่าน (ไม่ใช้เกณฑ์จำนวนของแบบ)', () => {
  const r = validatePlans(makePlans(), makeStore(), NO_COUNTS);
  assert.equal(r.ok, true, errsJoined(r));
  assert.equal(r.counts.surgery, 1);
  assert.equal(r.counts.archive, 2);
  assert.equal(r.derivedNewIds.length, 1);
});

test('validator: เกณฑ์จำนวนตามแบบ 11/5/3/27/27/2/19 กัดจริง (fixture เล็กต้องไม่ผ่าน)', () => {
  const r = validatePlans(makePlans(), makeStore());
  assert.equal(r.ok, false);
  for (const k of Object.keys(EXPECTED_COUNTS)) {
    assert.ok(r.errors.some((e) => e.includes(`จำนวน ${k}`)), `ต้องมี error จำนวนของ ${k}`);
  }
});

test('validator: meta ระดับบนยอมให้มีได้ (inert) · key แปลกปลอมอื่นยัง error', () => {
  const plans = makePlans();
  plans.planCards.meta = { createdBy: 'สาย cards' };
  plans.planOps.meta = { createdBy: 'สาย ops' };
  const ok = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(ok.ok, true, errsJoined(ok));
  plans.planCards.extraTop = 1;
  const bad = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('"extraTop"')));
});

test('validator: id ไม่มีใน store = error (ทุกส่วน)', () => {
  const plans = makePlans();
  plans.planCards.surgery.prompt_deadbeef = { promptText: 'x' };
  plans.planOps.archive = [...plans.planOps.archive, 'ffffffff'];
  const r = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('surgery') && e.includes('prompt_deadbeef')));
  assert.ok(r.errors.some((e) => e.includes('archive') && e.includes('ffffffff')));
});

test('validator: field นอกสคีมา/field ห้ามแก้ = error', () => {
  const plans = makePlans();
  plans.planCards.surgery.prompt_00000001.fooBar = 'x';
  plans.planCards.surgery.prompt_00000001.usageCount = 99;
  const r = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('"fooBar"')));
  assert.ok(r.errors.some((e) => e.includes('"usageCount"')));
});

test('validator: regex คอมไพล์ไม่ได้ = error', () => {
  const plans = makePlans();
  plans.planOps.sweep.promptTextRemovePatterns = ['(ไม่ปิดวงเล็บ'];
  const r = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('คอมไพล์ไม่ได้')));
});

test('validator: rename ที่หา replaceUntil ไม่เจอ = error', () => {
  const plans = makePlans();
  plans.planCards.rename.prompt_00000002.replaceUntil = 'ข้อความที่ไม่มีจริง';
  const r = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('replaceUntil')));
});

test('validator: ใบใหม่ผิดกติกา = error (status/ctaStyle/ขาด field/มี id)', () => {
  const plans = makePlans();
  plans.planCards.newCards = [
    makeNewCard({ status: 'active' }),
    makeNewCard({ promptName: '[คดีความ-x] ใบสอง', ctaStyle: 'สรุปตอนจบ' }),
    (() => { const c = makeNewCard({ promptName: '[คดีความ-x] ใบสาม' }); delete c.tone; c.id = 'prompt_zzz'; return c; })(),
  ];
  const r = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('newCards[0]') && e.includes('proposed')));
  assert.ok(r.errors.some((e) => e.includes('newCards[1]') && e.includes('ctaStyle')));
  assert.ok(r.errors.some((e) => e.includes('newCards[2]') && e.includes('"tone"')));
  assert.ok(r.errors.some((e) => e.includes('newCards[2]') && e.includes('"id"')));
});

test('validator: sweep.ctaStyle ต้องเป็นค่าว่างตามมติ F3', () => {
  const plans = makePlans();
  plans.planOps.sweep.ctaStyle = 'ปิดเรื่องแบบ callback';
  const r = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('sweep.ctaStyle')));
});

test('validator: ซ้อนกันข้ามส่วนที่ขัดกัน = error (surgery∩rename · rename∩names · archive∩surgery)', () => {
  const plans = makePlans();
  plans.planCards.rename.prompt_00000001 = { promptName: '[x] a', promptTextHead: 'คุณคือแอดมินเพจ', replaceUntil: 'การ์ด 1' };
  plans.planOps.names.prompt_00000002 = '[x] ชนกับ rename';
  plans.planOps.archive = ['prompt_00000001'];
  const r = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith('rename prompt_00000001')));
  assert.ok(r.errors.some((e) => e.startsWith('names prompt_00000002')));
  assert.ok(r.errors.some((e) => e.startsWith('archive prompt_00000001')));
});

test('validator: id ย่อ 8 hex ถูก canonicalize เป็น id เต็ม', () => {
  const plans = makePlans();
  delete plans.planOps.names.prompt_00000003;
  plans.planOps.names['00000003'] = '[ช่วยเหลือกัน-อบอุ่น] ชื่อจัดระเบียบ';
  plans.planOps.viralScoreRemap = { '00000003': 90 };
  const r = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r.ok, true, errsJoined(r));
  assert.ok('prompt_00000003' in r.canonical.planOps.names);
  assert.equal(r.canonical.planOps.viralScoreRemap.prompt_00000003, 90);
});

// ── applyPlans / build-arms ──────────────────────────────────────────────────
function validated(storeCards = makeStore(), plans = makePlans()) {
  const r = validatePlans(plans, storeCards, NO_COUNTS);
  assert.equal(r.ok, true, errsJoined(r));
  return r;
}

test('applyPlans (arm): ใช้แผนครบทุกก้อนอย่างถูกลำดับ + ไม่แก้ input เดิม', () => {
  const store = makeStore();
  const snapshotBefore = JSON.stringify(store);
  const r = validated(store);
  const applied = applyPlans(store, r.canonical, { mode: 'arm' });
  assert.equal(JSON.stringify(store), snapshotBefore, 'ห้าม mutate storeCards');

  const byId = new Map(applied.cards.map((c) => [c.id, c]));
  // archive = ตัดออกจากไฟล์แขน (Gate 1 ไม่มีตัวกรอง F7)
  assert.equal(byId.has('prompt_00000004'), false);
  assert.equal(byId.has('prompt_00000007'), false);
  // surgery ทับ field + sweep เก็บ dnaTemplate ต่อ
  const c1 = byId.get('prompt_00000001');
  assert.equal(c1.promptText, 'ผ่าตัดแล้ว เปิดด้วย scenario และเดิมพันจริงของคนในข่าว');
  assert.equal(c1.emotionalArc.close, 'ปิดใหม่');
  assert.equal(c1.dnaTemplate.structure_formula, 'สามช่วง');
  // rename = ต่อหัวใหม่ + เนื้อหลัง replaceUntil คงเดิม (แต่โดนกวาดวลีท้าย)
  const c2 = byId.get('prompt_00000002');
  assert.ok(c2.promptText.startsWith('หัวเปิดใหม่ 600 ตัวแรกแบบ scenario'));
  assert.ok(c2.promptText.includes('แล้วเนื้อเรื่องหลักตามมา'));
  assert.ok(!c2.promptText.includes('เกริ่นเก่าเล่าอ้อม'));
  assert.ok(!c2.promptText.includes(PHRASE), 'sweep ต้องเก็บวลีในเนื้อหลัง rename ด้วย');
  // names + viralScoreRemap
  const c3 = byId.get('prompt_00000003');
  assert.equal(c3.promptName, '[ช่วยเหลือกัน-อบอุ่น] ชื่อจัดระเบียบ');
  assert.equal(c3.viralScore, 90);
  // merge หมวด
  assert.equal(byId.get('prompt_00000005').category, 'ช่วยเหลือกัน');
  // sweep ทั้งคลัง: ctaStyle ว่าง + วลีหายจาก promptText/arc.close/dna
  for (const c of applied.cards) {
    assert.equal(c.ctaStyle, '', `ctaStyle ต้องว่าง: ${c.id}`);
    assert.ok(!String(c.promptText).includes(PHRASE), `วลีต้องหายจาก promptText: ${c.id}`);
    assert.ok(!String(c.emotionalArc.close).includes(PHRASE), `วลีต้องหายจาก arc.close: ${c.id}`);
    assert.ok(!Object.values(c.dnaTemplate).some((v) => String(v).includes(PHRASE)), `วลีต้องหายจาก dna: ${c.id}`);
  }
  // ใบใหม่: id deterministic + active ในแขน + createdAt คงที่
  assert.equal(applied.newCards.length, 1);
  const newId = deriveNewCardId('[คดีความ-เห็นใจ] ใบใหม่เล่าคดีอย่างเป็นธรรม');
  assert.equal(applied.newCards[0].id, newId);
  const nc = byId.get(newId);
  assert.equal(nc.status, 'active');
  assert.equal(nc.createdAt, ARM_FIXED_NOW);
  assert.equal(applied.cards.length, 8 - 2 + 1);
  // สถิติกวาด
  assert.equal(applied.sweepStats.ctaStyle, 8, 'การ์ดเดิมทั้ง 8 ใบ ctaStyle ไม่ว่าง');
  const ptRule = applied.sweepStats.rules.find((x) => x.field === 'promptText');
  assert.equal(ptRule.cards, 2, 'c2 (เนื้อหลัง rename) + c6');
  // per-card: ลบเฉพาะใบที่ระบุ หลัง regex กลาง
  assert.equal(byId.get('prompt_00000006').promptText, 'เล่าเรื่องแล้ว');
  const pcRule = applied.sweepStats.rules.find((x) => x.group === 'perCardPromptText');
  assert.deepEqual(pcRule, { group: 'perCardPromptText', field: 'promptText@prompt_00000006', source: ' เสมอ$', cards: 1 });
});

test('validator: per-card sweep — id ต้องมีใน store · pattern หลุด u-flag = error (สัญญา gu ของแผน ops)', () => {
  const plans = makePlans();
  plans.planOps.sweep.perCardPromptTextRemovePatterns = { prompt_deadbeef: ['x'] };
  const r1 = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes('perCardPromptTextRemovePatterns') && e.includes('prompt_deadbeef')));
  const plans2 = makePlans();
  plans2.planOps.sweep.promptTextRemovePatterns = ['\\-']; // ผ่านใต้ flag g เฉยๆ แต่ต้องแดงใต้ gu
  const r2 = validatePlans(plans2, makeStore(), NO_COUNTS);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes('คอมไพล์ไม่ได้')));
});

test('validator: pattern ที่ไม่เจอในคลังเลย = warning (จับวลีในแบบที่ไม่ตรงกับ store จริง)', () => {
  const plans = makePlans();
  plans.planOps.sweep.promptTextRemovePatterns = [PHRASE, 'สตริงที่ไม่มีทางเจอในคลังนี้'];
  const r = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(r.ok, true, errsJoined(r));
  assert.ok(r.warnings.some((w) => w.includes('ไม่เจอในใบไหนเลย') && w.includes('สตริงที่ไม่มีทางเจอ')));
  assert.ok(!r.warnings.some((w) => w.includes('ไม่เจอในใบไหนเลย') && w.includes(PHRASE)), 'pattern ที่เจอจริงห้ามโดนเตือน');
});

test('applyPlans (arm): sections จำกัดก้อนได้ตามบันได §6.4 (B1 ไม่แตะผ่าตัด/ชื่อ/พัก)', () => {
  const store = makeStore();
  const r = validated(store);
  const applied = applyPlans(store, r.canonical, { mode: 'arm', sections: LADDER_ARMS.B1 });
  const byId = new Map(applied.cards.map((c) => [c.id, c]));
  assert.equal(applied.cards.length, 8, 'B1 ไม่ตัดใบพัก ไม่เพิ่มใบใหม่');
  assert.ok(byId.get('prompt_00000001').promptText.startsWith('คุณคือแอดมินเพจ'), 'surgery ต้องไม่ทำงานใน B1');
  assert.equal(byId.get('prompt_00000003').viralScore, 90);
  assert.equal(byId.get('prompt_00000003').promptName, '[ช่วยเหลือกัน-ชื่นชม] การ์ดที่ 3', 'names ต้องไม่ทำงานใน B1');
  assert.equal(byId.get('prompt_00000006').ctaStyle, '');
});

test('applyPlans: ลำดับ apply คงที่ตาม SECTION_ORDER (names ก่อน surgery — ชื่อจาก surgery ชนะ)', () => {
  const store = makeStore();
  const plans = makePlans();
  plans.planOps.names.prompt_00000001 = '[ช่วยเหลือกัน-x] ชื่อกลไกจาก F10';
  const r = validatePlans(plans, store, NO_COUNTS);
  assert.equal(r.ok, true, errsJoined(r));
  assert.ok(r.warnings.some((w) => w.includes('names prompt_00000001')), 'ต้องเตือนชื่อสองแหล่ง');
  const applied = applyPlans(store, r.canonical, { mode: 'arm' });
  const c1 = applied.cards.find((c) => c.id === 'prompt_00000001');
  assert.equal(c1.promptName, '[ช่วยเหลือกัน-ชื่นชม] ผ่าตัดใหม่ scenario+เดิมพัน');
});

test('buildArms: deterministic (สลับลำดับ input = ไบต์เดิม) + C เท่ากับ B ทุกไบต์ + A คือ store เดิม', () => {
  const plans = makePlans();
  const out1 = buildArms(makeStore(), plans, { expectedCounts: null });
  const out2 = buildArms([...makeStore()].reverse(), plans, { expectedCounts: null });
  assert.equal(out1.files.A, out2.files.A);
  assert.equal(out1.files.B, out2.files.B);
  assert.equal(out1.files.report, out2.files.report);
  assert.equal(out1.files.C, out1.files.B, 'C = B ไบต์ต่อไบต์');
  assert.equal(out1.files.A, canonicalCardsJson(makeStore()), 'A = store จริงตามเดิม (canonical)');
  assert.equal(JSON.parse(out1.files.A).length, 8);
  assert.equal(JSON.parse(out1.files.B).length, 7);
  assert.ok(out1.files.report.includes('diff-report'), 'มีรายงาน');
  assert.ok(out1.files.report.includes(deriveNewCardId('[คดีความ-เห็นใจ] ใบใหม่เล่าคดีอย่างเป็นธรรม')));
  // ข้อติงผู้ตรวจ (MUT4): สลับลำดับ key ในใบทุกชั้น (สถานการณ์จริง: Supabase jsonb กับ mirror คืน key คนละลำดับ)
  // → ไฟล์แขนต้องไบต์เดิมเป๊ะ (สัญญา C==B/paired A-B ของ Gate 1 ยืนบน canonical bytes = sortKeysDeep)
  // (diff-report ไม่อยู่ในสัญญาไบต์ — ค่า before ในรายงานพิมพ์ตามลำดับ key ของ input เพื่อให้คนอ่านเทียบของจริง)
  const reverseKeysDeep = (v) => (Array.isArray(v) ? v.map(reverseKeysDeep)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeysDeep(x)]))
      : v);
  const out3 = buildArms(makeStore().map(reverseKeysDeep), plans, { expectedCounts: null });
  assert.equal(out3.files.A, out1.files.A, 'key คนละลำดับในใบ → ไบต์ A ต้องเดิม (sortKeysDeep ใน canonicalCardsJson)');
  assert.equal(out3.files.B, out1.files.B, 'key คนละลำดับในใบ → ไบต์ B ต้องเดิม');
});

test('buildArms: แผนไม่ผ่าน validator ต้อง throw (ค่าเริ่มต้นใช้เกณฑ์จำนวนของแบบ)', () => {
  assert.throws(() => buildArms(makeStore(), makePlans()), /จำนวน/);
});

// ── migrate ──────────────────────────────────────────────────────────────────
const throwingHooks = {
  writeBackup: () => { throw new Error('dry-run ห้ามเรียก writeBackup'); },
  writeReverse: () => { throw new Error('dry-run ห้ามเรียก writeReverse'); },
};

test('migrate dry-run: ไม่เขียน store และไม่เรียก hooks เขียนไฟล์ใดๆ', async () => {
  const stub = makeStubStore(makeStore());
  const result = await runMigrate({ store: stub, plans: makePlans(), expectedCounts: null, hooks: throwingHooks });
  assert.equal(result.dryRun, true);
  assert.equal(stub.calls.update.length, 0);
  assert.equal(stub.calls.add.length, 0);
  assert.equal(stub.calls.remove.length, 0);
  assert.ok(result.summary.cardsChanged > 0);
  assert.deepEqual(result.applied.archivedIds, ['prompt_00000004', 'prompt_00000007']);
});

test('migrate --apply: backup ก่อน → reverse-script → เขียนรายใบ → ตรวจกลับผ่าน', async () => {
  const stub = makeStubStore(makeStore());
  const written = { backup: null, reverse: null };
  const result = await runMigrate({
    store: stub,
    plans: makePlans(),
    expectedCounts: null,
    apply: true,
    label: 'test-apply',
    now: '2026-09-03T10:00:00.000Z',
    hooks: {
      writeBackup: (cards, { label }) => { written.backup = { count: cards.length, label }; return { count: cards.length, file: '(mem)', sha256: 'x' }; },
      writeReverse: (reverse, { label }) => { written.reverse = { reverse, label }; return { file: '(mem)' }; },
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result.verify?.mismatches));
  assert.equal(written.backup.count, 8, 'backup ต้องเกิดก่อนและครบทุกใบ');
  const items = stub.items();
  const byId = new Map(items.map((c) => [c.id, c]));
  // archive ใน store จริง = ตั้ง status ไม่ลบใบ (F6)
  assert.equal(byId.get('prompt_00000004').status, 'archived');
  assert.equal(byId.get('prompt_00000007').status, 'archived');
  assert.equal(items.length, 9, '8 ใบเดิม + ใบใหม่ 1 (archive ไม่ลบ)');
  const newId = deriveNewCardId('[คดีความ-เห็นใจ] ใบใหม่เล่าคดีอย่างเป็นธรรม');
  assert.equal(byId.get(newId).status, 'proposed', 'ใบใหม่ตอน migrate ต้องเป็น proposed');
  assert.equal(byId.get(newId).createdAt, '2026-09-03T10:00:00.000Z');
  // reverse-script เก็บค่าเดิมทุก field ที่แตะ
  const rs = written.reverse.reverse;
  assert.equal(rs.kind, 'card-restore-script');
  assert.equal(rs.updates.prompt_00000001.set.promptText, makeStore()[0].promptText);
  assert.equal(rs.updates.prompt_00000001.set.updatedAt, '2026-08-01T00:00:00.000Z');
  assert.ok(rs.updates.prompt_00000004.unset.includes('status'), 'status เดิมไม่มี → ต้อง unset');
  assert.ok(rs.updates.prompt_00000008.unset.includes('updatedAt'), 'ใบไม่มี updatedAt → ต้อง unset');
  assert.deepEqual(rs.removes, [{ id: newId, promptName: '[คดีความ-เห็นใจ] ใบใหม่เล่าคดีอย่างเป็นธรรม' }]);
});

test('migrate --apply: idempotent — รันซ้ำรอบสองไม่มีอะไรให้เขียน', async () => {
  const stub = makeStubStore(makeStore());
  const hooks = { writeBackup: (cards) => ({ count: cards.length }), writeReverse: () => ({ file: '(mem)' }) };
  const r1 = await runMigrate({ store: stub, plans: makePlans(), expectedCounts: null, apply: true, label: 'round1', hooks });
  assert.equal(r1.ok, true);
  const r2 = await runMigrate({ store: stub, plans: makePlans(), expectedCounts: null, apply: true, label: 'round2', hooks });
  assert.equal(r2.ok, true);
  assert.equal(r2.written.updated, 0, 'รอบสองต้องไม่มี field ให้แก้');
  assert.equal(r2.written.added, 0, 'รอบสองต้องไม่ add ใบใหม่ซ้ำ');
});

test('migrate --apply: backup นับแถวไม่ตรง = หยุดก่อนเขียน store', async () => {
  const stub = makeStubStore(makeStore());
  await assert.rejects(
    runMigrate({
      store: stub,
      plans: makePlans(),
      expectedCounts: null,
      apply: true,
      hooks: { writeBackup: () => ({ count: 999 }), writeReverse: () => ({ file: '(mem)' }) },
    }),
    /นับแถวไม่ตรง/,
  );
  assert.equal(stub.calls.update.length + stub.calls.add.length, 0, 'ห้ามมีการเขียนใดๆ เกิดขึ้น');
});

test('migrate --apply: สวิตช์ถอย CARD_MIGRATE_APPLY=0 ปิดการเขียน (dry-run ยังใช้ได้)', async () => {
  const stub = makeStubStore(makeStore());
  await assert.rejects(
    runMigrate({ store: stub, plans: makePlans(), expectedCounts: null, apply: true, hooks: throwingHooks, env: { CARD_MIGRATE_APPLY: '0' } }),
    /CARD_MIGRATE_APPLY=0/,
  );
  assert.equal(stub.calls.update.length + stub.calls.add.length, 0);
  const dry = await runMigrate({ store: stub, plans: makePlans(), expectedCounts: null, apply: false, hooks: throwingHooks, env: { CARD_MIGRATE_APPLY: '0' } });
  assert.equal(dry.dryRun, true);
});

test('migrate --apply: ตรวจกลับหลังเขียนกัดจริง — store ที่เขียนหาย 1 ใบต้องถูกจับได้', async () => {
  const stub = makeStubStore(makeStore());
  const realUpdate = stub.update.bind(stub);
  stub.update = async (id, payload) => {
    if (id === 'prompt_00000006') { stub.calls.update.push({ id, payload: '(กลืนหาย)' }); return { id }; } // เขียนหายเงียบๆ
    return realUpdate(id, payload);
  };
  const result = await runMigrate({
    store: stub,
    plans: makePlans(),
    expectedCounts: null,
    apply: true,
    hooks: { writeBackup: (cards) => ({ count: cards.length }), writeReverse: () => ({ file: '(mem)' }) },
  });
  assert.equal(result.ok, false, 'verify ต้องไม่ผ่าน');
  assert.ok(result.verify.mismatches.some((m) => m.startsWith('prompt_00000006')));
});

// ── reverse-script → restore ─────────────────────────────────────────────────
test('restore จาก reverse-script: คืนสภาพเดิมทุกไบต์ทุก field (ยกเว้น updatedAt ที่ store ประทับเอง)', async () => {
  const original = makeStore();
  const stub = makeStubStore(original);
  const applyResult = await runMigrate({
    store: stub,
    plans: makePlans(),
    expectedCounts: null,
    apply: true,
    label: 'to-restore',
    hooks: { writeBackup: (cards) => ({ count: cards.length }), writeReverse: () => ({ file: '(mem)' }) },
  });
  assert.equal(applyResult.ok, true);
  const restoreResult = await runRestore({ store: stub, data: applyResult.reverse, apply: true });
  assert.equal(restoreResult.ok, true, JSON.stringify(restoreResult.verify?.mismatches));
  const items = stub.items();
  assert.equal(items.length, original.length, 'ใบใหม่ต้องถูกถอนออก');
  const byId = new Map(items.map((c) => [c.id, c]));
  for (const orig of original) {
    const cur = byId.get(orig.id);
    assert.ok(cur, `ใบ ${orig.id} ต้องยังอยู่`);
    assert.deepEqual(stripUpdatedAt(cur), stripUpdatedAt(orig), `ใบ ${orig.id} ต้องกลับเป็นไบต์เดิม (นอกจาก updatedAt)`);
    assert.ok(!('status' in cur), `field status ที่เดิมไม่มีต้องถูกลบ: ${orig.id}`);
  }
});

test('restore dry-run: ไม่เขียนอะไร', async () => {
  const stub = makeStubStore(makeStore());
  const applyResult = await runMigrate({
    store: stub,
    plans: makePlans(),
    expectedCounts: null,
    apply: true,
    hooks: { writeBackup: (cards) => ({ count: cards.length }), writeReverse: () => ({ file: '(mem)' }) },
  });
  const before = JSON.stringify(stub.items());
  const dry = await runRestore({ store: stub, data: applyResult.reverse, apply: false });
  assert.equal(dry.dryRun, true);
  assert.equal(JSON.stringify(stub.items()), before);
  assert.equal(stub.calls.remove.length, 0);
});

test('restore: ถอนใบใหม่เฉพาะเมื่อชื่อตรงกับตอน import (กันลบผิดใบ)', async () => {
  const stub = makeStubStore(makeStore());
  const applyResult = await runMigrate({
    store: stub,
    plans: makePlans(),
    expectedCounts: null,
    apply: true,
    hooks: { writeBackup: (cards) => ({ count: cards.length }), writeReverse: () => ({ file: '(mem)' }) },
  });
  const newId = applyResult.reverse.removes[0].id;
  await stub.update(newId, { promptName: 'ถูกคนแก้ชื่อไปแล้ว' });
  const restoreResult = await runRestore({ store: stub, data: applyResult.reverse, apply: true });
  assert.equal(restoreResult.ok, false);
  assert.ok(restoreResult.written.failed.some((f) => f.id === newId));
  assert.ok(stub.items().some((c) => c.id === newId), 'ใบที่ชื่อไม่ตรงต้องไม่ถูกลบ');
});

test('restore จาก backup รายใบ (--ids) + กติกาต้องระบุ --ids/--all', async () => {
  const original = makeStore();
  const stub = makeStubStore(original);
  await stub.update('prompt_00000003', { promptName: 'โดนแก้มั่ว', viralScore: 1 });
  assert.throws(() => planRestoreFromBackup(original, {}), /--ids|--all/);
  const result = await runRestore({ store: stub, data: { version: 1, kind: 'card-backup', items: original }, ids: ['00000003'], apply: true });
  assert.equal(result.ok, true, JSON.stringify(result.verify?.mismatches));
  const c3 = stub.items().find((c) => c.id === 'prompt_00000003');
  assert.deepEqual(stripUpdatedAt(c3), stripUpdatedAt(original[2]));
});

// ── backup ───────────────────────────────────────────────────────────────────
test('backup: เขียนไฟล์+sha256 ตรงเนื้อจริง · ห้ามทับ label เดิม · อ่านกลับตรวจ sha ได้', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-backup-test-'));
  try {
    const cards = makeStore();
    const out = writeBackup(cards, { label: 'unittest', outDir: dir, createdAt: '2026-09-03T00:00:00.000Z' });
    assert.equal(out.count, 8);
    const raw = fs.readFileSync(out.file, 'utf8');
    assert.equal(schema.sha256Hex(raw), out.sha256);
    const sidecar = fs.readFileSync(out.shaFile, 'utf8');
    assert.ok(sidecar.startsWith(out.sha256));
    assert.ok(sidecar.includes('card-backup-unittest.json'));
    const back = readBackupFile(out.file);
    assert.equal(back.data.count, 8);
    assert.ok(jsonEqual(back.items, cards), 'items ต้องตรงกับที่ดัมพ์ทุกไบต์');
    assert.throws(() => writeBackup(cards, { label: 'unittest', outDir: dir }), /ห้ามเขียนทับ/);
    fs.writeFileSync(out.file, raw.replace('"count": 8', '"count": 9'), 'utf8');
    assert.throws(() => readBackupFile(out.file), /sha256 ไม่ตรง/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── reverse-script builder (หน่วยย่อย) ───────────────────────────────────────
test('buildReverseScript: เก็บ updatedAt เดิมเสมอ แม้ไม่ใช่ field ที่แผนแตะ', () => {
  const store = makeStore();
  const r = validated(store);
  const applied = applyPlans(store, r.canonical, { mode: 'migrate', now: '2026-09-03T10:00:00.000Z' });
  const rs = buildReverseScript(store, applied, { label: 'x', createdAt: 'now' });
  for (const [id, u] of Object.entries(rs.updates)) {
    const hasSet = 'updatedAt' in u.set;
    const hasUnset = u.unset.includes('updatedAt');
    assert.ok(hasSet || hasUnset, `${id} ต้องมีข้อมูลคืน updatedAt`);
  }
});

// ── ด่านกันแขนแล็บค้าง (ข้อติงผู้ตรวจ 3 ก.ย. 69) ─────────────────────────────
// เทสนี้อยู่ท้ายไฟล์: loadEnvLocal ใน getRealStore โหลด .env.local จริงเข้า process.env (read-only —
// ไม่เขียนไฟล์/ไม่แตะ store เพราะ throw ก่อนถึง import persistStore และก่อน process.chdir)
test('getRealStore: CARD_LIBRARY_LAB=1 ค้างอยู่ต้อง throw ทันที (กัน backup/migrate เห็น overlay store ติดป้ายของจริง)', async () => {
  const prev = process.env.CARD_LIBRARY_LAB;
  const cwdBefore = process.cwd();
  process.env.CARD_LIBRARY_LAB = '1';
  try {
    await assert.rejects(schema.getRealStore(), /CARD_LIBRARY_LAB=1/);
    await assert.rejects(schema.getRealStore({ allowFileStore: true }), /CARD_LIBRARY_LAB=1/, 'allowFileStore ต้องข้ามด่านนี้ไม่ได้');
    assert.equal(process.cwd(), cwdBefore, 'ต้อง throw ก่อน process.chdir');
  } finally {
    if (prev === undefined) delete process.env.CARD_LIBRARY_LAB;
    else process.env.CARD_LIBRARY_LAB = prev;
  }
});

// ── ด่าน replaceUntil ซ้ำ (Fable ตรวจ 3 ก.ย. 69: applyPlans ตัดที่ตำแหน่งแรก — ซ้ำ = ตัดผิดท่อนเงียบๆ) ──
test('validator: rename ที่ replaceUntil ปรากฏมากกว่าหนึ่งครั้ง = error · ครั้งเดียว = ผ่าน', () => {
  const plans = makePlans();
  const store = makeStore();
  store[1].promptText = `เกริ่นเก่าเล่าอ้อมไปมา ถึงจุดจบท่อนเปิด แล้วเนื้อเรื่องหลักตามมา ถึงจุดจบท่อนเปิด ${PHRASE}`;
  const dup = validatePlans(plans, store, NO_COUNTS);
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.some((e) => e.includes('rename prompt_00000002') && e.includes('ปรากฏ 2 ครั้ง')));
  const ok = validatePlans(plans, makeStore(), NO_COUNTS);
  assert.equal(ok.ok, true, errsJoined(ok));
});

// ── ด่านผู้ตัดสินอ้างอิง F11-v2 (รอบหักล้าง 3 ก.ย. 69 รอบ 2): คีย์โค้ดทุกตัวใน NEW_CATS_KEYWORDS ต้องถูก SHOULD หมวดตัวเองรับ ──
// ไม่งั้นป้ายที่เข้าหมวดใหม่ด้วยคีย์นั้น (ถูกจริง มีเทสค้ำ) จะถูกพรีเช็คนับเป็น false-positive · และ NOT ต้องไม่ลบคีย์โค้ดจนหาย
test('precheck-oracle: SHOULD หมวดตัวเองรับคีย์ NEW_CATS_KEYWORDS ครบทุกตัว · NOT ไม่กลืนคีย์ · lookahead พระคุณ(?!เจ้า) ทำงาน', async () => {
  const oracle = await import('../scripts/card-status/precheck-oracle.mjs');
  const src = fs.readFileSync(new URL('../src/lib/ai/semanticClusters.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = src.slice(src.indexOf('const NEW_CATS_KEYWORDS = {'), src.indexOf('};', src.indexOf('const NEW_CATS_KEYWORDS = {')));
  const entries = [...block.matchAll(/^\s*'([^']+)':\s*'([^']+)',/gmu)].map((m) => [m[1], m[2]]);
  assert.ok(entries.length >= 100, `อ่านคีย์จาก source ได้ ${entries.length} ตัว (ต้อง ≥100)`);
  const miss = entries.filter(([k, cat]) => oracle.NEW_CATS.includes(cat) && !oracle.shouldBe(k).includes(cat));
  assert.deepEqual(miss, [], `คีย์ที่ SHOULD หมวดตัวเองไม่รับ: ${miss.map(([k, c]) => `${k}→${c}`).join(', ')}`);
  // lookahead / NOT
  assert.deepEqual(oracle.shouldBe('พระคุณเจ้าเทศน์'), ['ศาสนา-งานบุญ']);
  assert.deepEqual(oracle.shouldBe('ตอบแทนพระคุณพ่อแม่'), []);
  assert.deepEqual(oracle.shouldBe('ความเป็นธรรม'), []);
  assert.deepEqual(oracle.shouldBe('ศาลรัฐธรรมนูญ'), ['คดีความ'], "'ธรรมนูญ' ต้องไม่ทำให้ตกศาสนา");
  assert.deepEqual(oracle.shouldBe('การแข่งขันความสามารถ'), []);
  assert.deepEqual(oracle.shouldBe('ความโชคดีของครอบครัว'), []);
  assert.deepEqual(oracle.shouldBe('ขาดทุนมหาศาล'), []);
  assert.equal(oracle.scoutOk('กบ ปภัสรา ถวายมงกุฎ-สายสะพายให้วัด', 'ศาสนา-งานบุญ'), true, 'ถวาย…วัด = ศาสนา (SCOUT บริบท)');
  assert.equal(oracle.scoutOk('ถวายพระพรชัยมงคล', 'ศาสนา-งานบุญ'), false, 'ถวายพระพร = ราชสำนัก ไม่ใช่ศาสนา');
});
