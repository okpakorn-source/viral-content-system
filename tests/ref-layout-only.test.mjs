// ============================================================
// 🧪 R4 — layout-only ref sanitize (MEGA_REF_LAYOUT_ONLY, default ON) (16 ก.ค. 69)
// ------------------------------------------------------------
// คำสั่งเจ้าของระบบ (เคาะแล้ว): "ref เอาแค่เทมเพลตกับรายละเอียดที่ดี เช่นความสะอาดตา สื่อสารดี —
//   ไม่ใช่บังคับช่องไหนต้องใส่ภาพอะไร การเลือกภาพเป็นหน้าที่สมองเลือกรูปให้ตรงข่าว" → ใช้กับ "ทุก match"
//   (ไม่ใช่แค่ weak). สวิตช์ MEGA_REF_LAYOUT_ONLY default ON (ปิดเมื่อ ==='0' เป๊ะ = ref-first เดิม byte-identical).
//
// เทสนี้เป็น PURE offline (refTemplate.js ไม่มี import/fs/network) — จำลอง "expression ที่ wire จริง" ใช้ที่
//   S6 pickBestRef (megaAdapters ~3160) · S6 lockedRef (~3136) · S7 legacy fallback (~5173) — ทั้งสามจุด
//   ผลิต dna ที่ strong→sanitizeRefDnaLayoutOnly / weak→sanitizeRefDnaForWeakMatch (B0) เหมือนกัน. โครง S6/S7
//   ตัวจริงต้อง loader hook (ทดสอบใน ac0099/mega-semantic ที่ inject refMatch อยู่แล้ว) — ที่นี่ยืน invariant
//   ของ sanitizer + ผลที่ไหลเข้า dnaToTemplateSpec (spec/payload) แทน.
// ============================================================
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dnaToTemplateSpec, sanitizeRefDnaForWeakMatch, sanitizeRefDnaLayoutOnly } from '../src/lib/refTemplate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── ref DNA สังเคราะห์ครบเครื่อง: content (subject/shot/emotion) + style + panelCount + seamStyle/featherPx ──
function makeRefDNA() {
  return {
    layoutType: 'triptych',
    panelCount: 4,
    matchNewsType: 'crime',
    // ★ R4 fix (ผู้ตรวจเคาะ): top-level emotion/matchEmotion = match metadata ที่ "เก็บไว้" (author-intended, lower risk) —
    //   จงใจตั้งให้ "ชนกับ emotion ระดับช่อง" ('ตกใจ' = hero slot emotion) เพื่อพิสูจน์ว่า leak-scan ต้อง collision-aware
    //   (ถ้าใช้ sentinel ไม่ชน จะได้ false confidence — สแกน slot emotion ผ่านทั้งที่ระบบยังรั่ว field อื่น)
    emotion: 'ตกใจ',
    matchEmotion: 'ตกใจ',
    // ★ R4 fix: subjectsRelation = per-slot subject dictation ระดับบน (เช่น "วงกลม=คู่หูคนสนิท") — semantically เท่า slots[].subject
    //   layout-only ต้องตัดทิ้ง · ใช้ token เฉพาะที่ไม่ทับ slot subject เพื่อพิสูจน์ว่า "field นี้เอง" ถูกตัด (พบรั่วจริง 15/21 ในคลัง)
    subjectsRelation: 'ฮีโร่=นักการเมืองคนดัง, ขวาบน=มวลชนผู้ชุมนุม, วงกลม=คู่หูคนสนิท',
    style: { tone: 'dark', palette: ['#101010', '#ff2b2b'], hasText: true, effects: ['vignette'] },
    storyFlow: 'เปิดด้วยฮีโร่ → รีแอคชั่น → บริบท',
    compositionLogic: 'hero ซ้ายใหญ่ · วงกลมหน้าคนขวาบน',
    neededShots: ['closeup', 'wide'],
    slots: [
      { role: 'hero', subject: 'ผู้ต้องหา', shot: 'closeup', emotion: 'ตกใจ' },
      { role: 'reaction', subject: 'ญาติผู้เสียหาย', shot: 'medium', emotion: 'เศร้า' },
    ],
    template: {
      seamStyle: 'feather',
      featherPx: 22,
      panelCount: 4,
      slots: [
        { role: 'hero', pos: 'left', subject: 'ผู้ต้องหา', shot: 'closeup', emotion: 'ตกใจ', faceSizePct: 40, xPct: 0, yPct: 0, wPct: 60, hPct: 100, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'reaction', pos: 'top-right', subject: 'ญาติผู้เสียหาย', shot: 'medium', emotion: 'เศร้า', faceSizePct: 30, xPct: 60, yPct: 0, wPct: 40, hPct: 50, zIndex: 0, border: true, borderColor: '#FFFFFF', borderWidthPct: 2 },
        { role: 'context', pos: 'bottom-right', subject: 'สถานที่เกิดเหตุ', shot: 'wide', emotion: '', faceSizePct: 0, xPct: 60, yPct: 50, wPct: 40, hPct: 50, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'face', shape: 'circle', subject: 'พยาน', shot: 'closeup', emotion: 'จริงจัง', pos: 'center-right', faceSizePct: 55, xPct: 66, yPct: 8, wPct: 24, hPct: 24, zIndex: 4, border: true, borderColor: '#FFFFFF', borderWidthPct: 2 },
      ],
    },
  };
}

// fixture: hero = ช่อง "ไม่ใช่ใหญ่สุด" (context เต็มความกว้างด้านบน = ใหญ่สุด) — พิสูจน์ role รอด sanitize
function makeHeroNotLargestDNA() {
  return {
    layoutType: 'triptych',
    panelCount: 3,
    style: { tone: 'warm', palette: ['#fff'], hasText: false, effects: [] },
    slots: [
      { role: 'context', subject: 'สถานที่', shot: 'wide', emotion: '' },
      { role: 'hero', subject: 'ตัวเอก', shot: 'closeup', emotion: 'ตกใจ' },
    ],
    template: {
      seamStyle: 'feather', featherPx: 8,
      slots: [
        { role: 'context', pos: 'top', subject: 'สถานที่เกิดเหตุ', shot: 'wide', emotion: '', faceSizePct: 0, xPct: 0, yPct: 0, wPct: 100, hPct: 55, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'hero', pos: 'bottom-left', subject: 'ตัวเอก', shot: 'closeup', emotion: 'ตกใจ', faceSizePct: 62, xPct: 0, yPct: 55, wPct: 55, hPct: 45, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'reaction', pos: 'bottom-right', subject: 'ญาติ', shot: 'medium', emotion: 'เศร้า', faceSizePct: 30, xPct: 55, yPct: 55, wPct: 45, hPct: 45, zIndex: 0, border: true, borderColor: '#FFFFFF', borderWidthPct: 2 },
      ],
    },
  };
}

// ── expression ที่ wire จริงใช้ (มิเรอร์ megaAdapters — S6 pickBestRef/lockedRef + S7 fallback) ──
//   strong: layoutOnly ? sanitizeRefDnaLayoutOnly(dna) : dna(ดิบ) · weak: sanitizeRefDnaForWeakMatch (B0) ทุกสวิตช์
function wireResolve(dna, { weak, layoutOnly }) {
  if (weak) return sanitizeRefDnaForWeakMatch({ ...dna, slots: [], neededShots: [], storyFlow: '', compositionLogic: '' });
  return layoutOnly ? sanitizeRefDnaLayoutOnly(dna) : dna;
}

// content tokens (subject/shot/emotion ทุกช่อง) ไว้ค้นการรั่วใน spec/dna JSON
// ★ R4 fix (ผู้ตรวจ): collision-aware — ตัด token ที่ตรงกับ top-level emotion/matchEmotion (match metadata ที่ "เก็บไว้"
//   ทั้ง B0 และ layout-only) ออกจาก leak-set · มิฉะนั้น slot emotion ที่ชนกับ emotion ระดับบน ('ตกใจ') จะฟ้อง false-positive
//   ทั้งที่ field นั้นเป็นของที่ตั้งใจเก็บ — leak-set จึงเหลือเฉพาะ token ที่ "ต้องหาย" จริง
function contentTokens(dna) {
  const keep = new Set([dna.emotion, dna.matchEmotion].map((v) => String(v || '').trim()).filter(Boolean));
  const out = [];
  const push = (v) => { const s = String(v || '').trim(); if (s && !keep.has(s)) out.push(s); };
  for (const s of (dna.template?.slots || [])) for (const k of ['subject', 'shot', 'emotion']) push(s[k]);
  for (const s of (dna.slots || [])) for (const k of ['subject', 'shot', 'emotion']) push(s[k]);
  push(dna.storyFlow);
  push(dna.compositionLogic);
  return [...new Set(out)];
}

// subjectsRelation = per-slot subject dictation ระดับบน (เช่น "วงกลม=คู่หูคนสนิท") — layout-only ต้องตัดทิ้ง
//   คืน "สตริงเต็ม + ทุก segment" เพื่อยืนยันว่า field นี้เองหายจาก JSON.stringify(sanitized) (ไม่ใช่แค่ slots)
function subjectsRelationTokens(dna) {
  const raw = String(dna.subjectsRelation || '').trim();
  if (!raw) return [];
  const parts = raw.split(/[,·]/).map((s) => s.trim()).filter(Boolean);
  return [...new Set([raw, ...parts])];
}

const LAYOUT_SLOT_KEYS = ['xPct', 'yPct', 'wPct', 'hPct', 'shape', 'zIndex', 'border', 'borderColor', 'borderWidthPct', 'pos', 'role'];
const FORBIDDEN_SLOT_KEYS = ['subject', 'shot', 'emotion', 'faceSizePct']; // layout-only ตัด faceSizePct ด้วย (ต่างจาก weak)
const FORBIDDEN_TOP_KEYS = ['neededShots', 'storyFlow', 'compositionLogic'];

// ============================================================ ON + strong (แกนหลัก R4)
test('ON + strong — sanitizeRefDnaLayoutOnly: template.slots เหลือ geometry+role, ตัด subject/shot/emotion/faceSizePct', () => {
  const dna = makeRefDNA();
  const out = wireResolve(dna, { weak: false, layoutOnly: true });
  assert.equal(out._contentSanitized, true, 'ต้องติดธง _contentSanitized');
  for (const s of out.template.slots) {
    for (const k of FORBIDDEN_SLOT_KEYS) assert.ok(!(k in s), `template.slot ต้องไม่มี "${k}" (layout-only)`);
    assert.ok('role' in s, 'template.slot ต้องคง role (โครงเลย์เอาต์)');
    for (const k of Object.keys(s)) assert.ok(LAYOUT_SLOT_KEYS.includes(k), `template.slot คีย์ "${k}" ไม่ใช่ layout key ที่อนุญาต`);
  }
  // geometry ครบทุกช่องที่ ref มี
  out.template.slots.forEach((s, i) => {
    for (const k of ['xPct', 'yPct', 'wPct', 'hPct']) assert.equal(s[k], dna.template.slots[i][k], `geometry ${k} ช่อง ${i} ต้องเท่า ref`);
  });
});

test('ON + strong — เก็บ style/panelCount/matchNewsType/layoutType/seamStyle/featherPx (คุณภาพ "สะอาดตา สื่อสารดี")', () => {
  const dna = makeRefDNA();
  const out = wireResolve(dna, { weak: false, layoutOnly: true });
  assert.deepEqual(out.style, dna.style, 'style ต้องคงครบ');
  assert.equal(out.panelCount, 4, 'panelCount ต้องคง');
  assert.equal(out.matchNewsType, 'crime', 'matchNewsType (ใช้ตอน match) ต้องคง');
  assert.equal(out.emotion, 'ตกใจ', 'emotion ระดับบน (match metadata) ต้องคง — แม้ค่าชนกับ emotion ระดับช่อง');
  assert.equal(out.matchEmotion, 'ตกใจ', 'matchEmotion (match metadata) ต้องคง');
  assert.equal(out.layoutType, 'triptych', 'layoutType ต้องคง');
  // ★ R4 fix (ผู้ตรวจ): subjectsRelation = การบังคับช่อง → ต้องถูกตัดทิ้งที่ระดับบน
  assert.ok(!('subjectsRelation' in out), 'ระดับบนต้องตัด subjectsRelation (per-slot subject dictation)');
  assert.equal(out.template.seamStyle, 'feather', 'template.seamStyle ต้องคง');
  assert.equal(out.template.featherPx, 22, 'template.featherPx ต้องคง');
  // ตัด field ที่ไหลเข้าสมองเลือกภาพ
  for (const k of FORBIDDEN_TOP_KEYS) assert.ok(!(k in out), `ระดับบนต้องตัด "${k}"`);
  assert.ok(!('slots' in out), 'ระดับบนต้องตัด slots(บรรยาย)');
});

test('ON + strong — spec (dnaToTemplateSpec) ไม่มี note และไม่รั่ว subject/shot/emotion/storyFlow/subjectsRelation ที่ใดเลย', () => {
  const dna = makeRefDNA();
  const tokens = contentTokens(dna);
  const relTokens = subjectsRelationTokens(dna);
  assert.ok(tokens.length >= 4, 'fixture ต้องมี content ให้ทดสอบการรั่ว');
  assert.ok(relTokens.length >= 3, 'fixture ต้องมี subjectsRelation แตก segment ให้ทดสอบการรั่ว');

  // ทั้ง S6 lane และ S7 lane ใช้ expression เดียวกัน → ผลเท่ากันทุกไบต์
  for (const lane of ['S6', 'S7']) {
    const sanitized = wireResolve(dna, { weak: false, layoutOnly: true });
    const spec = dnaToTemplateSpec(sanitized);
    assert.ok(spec && Array.isArray(spec.slots) && spec.slots.length >= 3, `[${lane}] ยังต้องได้โครง spec ใช้ได้`);
    for (const s of spec.slots) assert.ok(!('note' in s), `[${lane}] ช่อง ${s.id} ต้องไม่มี note (layout-only)`);
    // ★ R4 fix (ผู้ตรวจ): ค้นทั้ง spec และ dna ที่ไหลเข้า payload/composer — subjectsRelation ต้องหายด้วย (ไม่ใช่แค่ slots/spec)
    const blob = JSON.stringify(spec) + JSON.stringify(sanitized);
    for (const tok of tokens) assert.ok(!blob.includes(tok), `[${lane}] ต้องไม่รั่วเนื้อหา "${tok}"`);
    for (const tok of relTokens) assert.ok(!blob.includes(tok), `[${lane}] ต้องไม่รั่ว subjectsRelation "${tok}"`);
  }
});

test('ON + strong — role รอด sanitize → hero (main) เลือกถูกช่อง แม้ hero ไม่ใช่ช่องใหญ่สุด', () => {
  const dna = makeHeroNotLargestDNA();
  const specPre = dnaToTemplateSpec(dna);                                   // raw (มี role)
  const specLO = dnaToTemplateSpec(wireResolve(dna, { weak: false, layoutOnly: true }));
  const mainPre = specPre.slots.find((s) => s.id === 'main');
  const mainLO = specLO.slots.find((s) => s.id === 'main');
  assert.ok(mainPre && mainLO, 'ต้องมีช่อง main ทั้งก่อน/หลัง sanitize (role → hero-resolution)');
  for (const k of ['x', 'y', 'w', 'h']) assert.equal(mainLO[k], mainPre[k], `main.${k} layout-only ต้องเท่า raw`);
  const areaOf = (s) => s.w * s.h;
  const largest = specLO.slots.filter((s) => s.shape !== 'circle').sort((a, b) => areaOf(b) - areaOf(a))[0];
  assert.ok(areaOf(largest) > areaOf(mainLO), 'main (hero) ต้องไม่ใช่ช่องใหญ่สุด — พิสูจน์เลือกจาก role ไม่ใช่ area fallback');
});

// ============================================================ OFF ('0') + strong: byte-identical ref-first
test("OFF ('0') + strong — ผ่านค่า ref ดิบ ไม่แตะ → spec byte-identical กับ ref-first เดิม", () => {
  const dna = makeRefDNA();
  const off = wireResolve(dna, { weak: false, layoutOnly: false });
  assert.strictEqual(off, dna, "OFF strong ต้องคืน object เดิม (ref ดิบ ไม่มี clone/strip)");
  const specOff = dnaToTemplateSpec(off);
  const specRaw = dnaToTemplateSpec(makeRefDNA()); // output ก่อนแก้ (ref-first ล้วน)
  assert.deepEqual(specOff, specRaw, 'OFF strong spec ต้อง deep-equal กับ ref-first เดิม');
  // ref-first มี note + content ครบ (พฤติกรรมเดิม)
  const blob = JSON.stringify(specOff);
  assert.ok(blob.includes('ผู้ต้องหา') && blob.includes('closeup'), 'OFF strong ต้องคง note/content เดิม');
  for (const s of specOff.slots) assert.equal(typeof s.note, 'string', `OFF strong ช่อง ${s.id} ต้องมี note`);
});

// ============================================================ weak: B0 เดิมไม่ว่าสวิตช์ไหน
test('weak — พฤติกรรม B0 เดิมทั้ง ON และ OFF (geometry+role+faceSizePct คงไว้, ตัด subject/shot/emotion, มีธง)', () => {
  const dna = makeRefDNA();
  const tokens = contentTokens(dna);
  for (const layoutOnly of [true, false]) {
    const weakDNA = wireResolve(dna, { weak: true, layoutOnly });
    // ต้องเท่ากับ B0 helper ตรงๆ (ไม่ขึ้นกับสวิตช์)
    const b0 = sanitizeRefDnaForWeakMatch({ ...dna, slots: [], neededShots: [], storyFlow: '', compositionLogic: '' });
    assert.deepEqual(weakDNA, b0, `weak (switch=${layoutOnly}) ต้องเท่า B0 helper เป๊ะ`);
    assert.equal(weakDNA._contentSanitized, true, 'weak ต้องติดธง');
    for (const s of weakDNA.template.slots) {
      for (const k of ['subject', 'shot', 'emotion']) assert.ok(!(k in s), `weak template.slot ต้องไม่มี "${k}"`);
      assert.ok('faceSizePct' in s || s.faceSizePct === undefined, 'weak คง faceSizePct (B0)'); // B0 เก็บ faceSizePct
    }
    const spec = dnaToTemplateSpec(weakDNA);
    for (const s of spec.slots) assert.ok(!('note' in s), `weak spec ช่อง ${s.id} ต้องไม่มี note`);
    const blob = JSON.stringify(spec) + JSON.stringify(weakDNA);
    for (const tok of tokens) assert.ok(!blob.includes(tok), `weak ต้องไม่รั่ว "${tok}"`);
  }
});

test('weak vs layout-only ต่างกันตรง faceSizePct + style — พิสูจน์เป็นคนละระดับ sanitize', () => {
  const dna = makeRefDNA();
  const weakDNA = sanitizeRefDnaForWeakMatch({ ...dna, slots: [], neededShots: [], storyFlow: '', compositionLogic: '' });
  const loDNA = sanitizeRefDnaLayoutOnly(dna);
  // weak เก็บ faceSizePct (B0) · layout-only ไม่เก็บ
  assert.ok('faceSizePct' in weakDNA.template.slots[0], 'weak ต้องมี faceSizePct');
  assert.ok(!('faceSizePct' in loDNA.template.slots[0]), 'layout-only ต้องไม่มี faceSizePct');
  // weak strip top-level (empty) · layout-only เก็บ style
  assert.deepEqual(loDNA.style, dna.style, 'layout-only เก็บ style');
});

// ============================================================ ไม่ mutate + deterministic
test('sanitizeRefDnaLayoutOnly ไม่ mutate DNA ต้นฉบับในคลัง (คืน object ใหม่)', () => {
  const dna = makeRefDNA();
  const before = JSON.stringify(dna);
  const out = sanitizeRefDnaLayoutOnly(dna);
  assert.notEqual(out, dna, 'ต้องคืน object ใหม่');
  assert.notEqual(out.template, dna.template, 'template ต้องเป็น object ใหม่');
  assert.equal(JSON.stringify(dna), before, 'DNA ต้นฉบับต้องไม่ถูกแก้');
  assert.equal(dna.template.slots[0].subject, 'ผู้ต้องหา', 'slot ต้นฉบับต้องยังมี subject');
});

test('deterministic — ทุกเคส (ON/OFF/weak) คืนผลเท่ากันทุกครั้ง', () => {
  const mk = () => makeRefDNA();
  for (const opts of [{ weak: false, layoutOnly: true }, { weak: false, layoutOnly: false }, { weak: true, layoutOnly: true }, { weak: true, layoutOnly: false }]) {
    const a = dnaToTemplateSpec(wireResolve(mk(), opts));
    const b = dnaToTemplateSpec(wireResolve(mk(), opts));
    assert.deepEqual(a, b, `ผล deterministic (${JSON.stringify(opts)})`);
  }
});

test('sanitizeRefDnaLayoutOnly — guard null/non-object คืนค่าเดิม (ไม่ throw)', () => {
  assert.equal(sanitizeRefDnaLayoutOnly(null), null);
  assert.equal(sanitizeRefDnaLayoutOnly(undefined), undefined);
  assert.equal(sanitizeRefDnaLayoutOnly('x'), 'x');
  // dna ไม่มี template → คืน {..., _contentSanitized} ไม่ throw
  const out = sanitizeRefDnaLayoutOnly({ panelCount: 3 });
  assert.equal(out._contentSanitized, true);
  assert.equal(out.panelCount, 3);
});

// ============================================================ REAL DNA (data/ref-cover-library.json)
// ★ R4 fix (ผู้ตรวจ): รัน sanitizer กับ "DNA จริง" ในคลัง — fixture สังเคราะห์อาจพลาด field ที่รั่วจริง
//   (ก่อนแก้ subjectsRelation รั่ว 15/21 entry ทั้งที่ suite ผ่าน 10/10). พิสูจน์ว่า subjectsRelation จริงถูกตัดจริง.
test('REAL ref-cover-library.json — sanitizeRefDnaLayoutOnly ตัด subjectsRelation จริงทุก entry (ไม่รั่วเข้า JSON)', () => {
  const libPath = path.join(__dirname, '..', 'data', 'ref-cover-library.json');
  assert.ok(fs.existsSync(libPath), 'ต้องมี data/ref-cover-library.json ในคลัง');
  const arr = JSON.parse(fs.readFileSync(libPath, 'utf8'));
  assert.ok(Array.isArray(arr) && arr.length > 0, 'คลัง ref ต้องเป็น array ไม่ว่าง');

  const withRel = arr.filter((e) => e && e.dna && typeof e.dna.subjectsRelation === 'string' && e.dna.subjectsRelation.trim());
  assert.ok(withRel.length > 0, 'ต้องมี entry จริงที่มี subjectsRelation ให้ทดสอบการตัด');

  let checkedSlots = 0;
  for (const entry of withRel) {
    const rawRel = entry.dna.subjectsRelation.trim();
    const out = sanitizeRefDnaLayoutOnly(entry.dna);
    // ต้นฉบับในคลังต้องไม่ถูก mutate
    assert.equal(entry.dna.subjectsRelation, rawRel, `entry ${entry.id}: ต้นฉบับ subjectsRelation ต้องไม่ถูกแก้`);
    // subjectsRelation ต้องถูกตัดทั้งที่ key และในสตริง JSON ทั้งก้อน (ไหลเข้า payload/composer)
    assert.ok(!('subjectsRelation' in out), `entry ${entry.id}: ต้องตัด key subjectsRelation`);
    assert.ok(!JSON.stringify(out).includes(rawRel), `entry ${entry.id}: subjectsRelation จริงต้องไม่รั่วใน JSON`);
    assert.equal(out._contentSanitized, true, `entry ${entry.id}: ต้องติดธง _contentSanitized`);
    // template.slots จริง (มี subject/shot/emotion) ต้องเหลือ geometry+role
    for (const s of (out.template?.slots || [])) {
      for (const k of FORBIDDEN_SLOT_KEYS) assert.ok(!(k in s), `entry ${entry.id}: template.slot ต้องไม่มี "${k}"`);
      for (const k of Object.keys(s)) assert.ok(LAYOUT_SLOT_KEYS.includes(k), `entry ${entry.id}: slot key "${k}" ไม่ใช่ layout key`);
      checkedSlots++;
    }
  }
  assert.ok(checkedSlots > 0, 'ต้องมี template.slot จริงถูกตรวจอย่างน้อย 1 ช่อง');
});
