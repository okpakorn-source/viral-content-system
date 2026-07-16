// ============================================================
// 🧪 B0 — weak-match "note บังคับรูป" leak regression (16 ก.ค. 69)
// ------------------------------------------------------------
// บั๊ก: เมื่อข่าวไม่ตรงแนว ref (typeMatched=false / weak) ระบบตั้งใจ strip เนื้อหาบังคับ
//   (subject/shot/storyFlow ฯลฯ) ออกก่อนใช้ DNA — แต่ dnaToTemplateSpec สร้าง note
//   "ตามปกเป้า: {role} = {subject} ({shot}·{emotion})" จาก template.slots ซึ่ง "ไม่ถูก strip"
//   → note บังคับช็อต/คนรั่วเข้าพรอมป์ Director (coverDirectorService templateText) แม้ weak match.
// แก้: S6/S7 sanitize DNA ด้วย sanitizeRefDnaForWeakMatch (template.slots เหลือ geometry ล้วน + ธง
//   _contentSanitized) → dnaToTemplateSpec งดสร้าง note.
//
// ⚠️ SYNTHETIC FIXTURE: DNA ในไฟล์นี้สังเคราะห์ล้วน ไม่มี fs/network/LLM · refTemplate.js เป็น pure
//   (ไม่มี import) → import ตรงได้ ไม่ต้อง loader hook.
// ============================================================
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dnaToTemplateSpec, sanitizeRefDnaForWeakMatch } from '../src/lib/refTemplate.js';

// ── ref DNA สังเคราะห์: hero + support + circle พร้อมเนื้อหา (subject/shot/emotion) ที่ห้ามรั่วตอน weak ──
function makeRefDNA() {
  return {
    layoutType: 'triptych',
    panelCount: 4,
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
      slots: [
        { role: 'hero', pos: 'left', subject: 'ผู้ต้องหา', shot: 'closeup', emotion: 'ตกใจ', faceSizePct: 40, xPct: 0, yPct: 0, wPct: 60, hPct: 100, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'reaction', pos: 'top-right', subject: 'ญาติผู้เสียหาย', shot: 'medium', emotion: 'เศร้า', faceSizePct: 30, xPct: 60, yPct: 0, wPct: 40, hPct: 50, zIndex: 0, border: true, borderColor: '#FFFFFF', borderWidthPct: 2 },
        { role: 'context', pos: 'bottom-right', subject: 'สถานที่เกิดเหตุ', shot: 'wide', emotion: '', faceSizePct: 0, xPct: 60, yPct: 50, wPct: 40, hPct: 50, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        { role: 'face', shape: 'circle', subject: 'พยาน', shot: 'closeup', emotion: 'จริงจัง', pos: 'center-right', xPct: 66, yPct: 8, wPct: 24, hPct: 24, zIndex: 4, border: true, borderColor: '#FFFFFF', borderWidthPct: 2 },
      ],
    },
  };
}

// การ strip ที่ S6 (megaAdapters ~3157) และ S7 fallback (~5160) ใช้ — byte-identical ทั้งสองจุด
function weakStrip(dna) {
  return sanitizeRefDnaForWeakMatch({ ...dna, slots: [], neededShots: [], storyFlow: '', compositionLogic: '' });
}

// เก็บ subject/shot ทุกช่องของ DNA (ไว้ค้นหาการรั่วใน spec JSON)
function contentTokens(dna) {
  const out = [];
  for (const s of (dna.template?.slots || [])) {
    for (const k of ['subject', 'shot', 'emotion']) if (s[k]) out.push(String(s[k]));
  }
  return [...new Set(out)];
}

// ★ B0 fix (ผู้ตรวจเคาะ): role + faceSizePct = layout-structural (คงไว้) · การรั่วเนื้อหาอยู่ที่ note เท่านั้น
//   (ปิดด้วยธง _contentSanitized) — role ให้ hero-resolution/refSlotMeta · faceSizePct = เป้าครอปหน้า
const GEOMETRY_KEYS = ['xPct', 'yPct', 'wPct', 'hPct', 'shape', 'zIndex', 'border', 'borderColor', 'borderWidthPct', 'pos', 'role', 'faceSizePct'];
const FORBIDDEN_SLOT_KEYS = ['subject', 'shot', 'emotion']; // เนื้อหาบังคับรูป/พรอมป์ Director — ต้อง strip · role/faceSizePct = โครง

test('strong match (typeMatched=true) — ทุกช่องมี note ครบเหมือนเดิม (byte-identical)', () => {
  const dna = makeRefDNA();
  const spec = dnaToTemplateSpec(dna); // strong = ใช้ DNA ดิบ ไม่ผ่าน sanitize
  assert.ok(spec && Array.isArray(spec.slots) && spec.slots.length >= 3, 'strong ต้องได้ spec ที่มีช่อง ≥3');
  for (const s of spec.slots) {
    assert.equal(typeof s.note, 'string', `ช่อง ${s.id} ต้องมี note (strong)`);
    assert.match(s.note, /^ตามปกเป้า:/, 'note ต้องขึ้นต้น "ตามปกเป้า:"');
  }
  // เนื้อหา subject/shot ต้องปรากฏใน note ของ strong (พฤติกรรมเดิม)
  const blob = JSON.stringify(spec);
  assert.ok(blob.includes('ผู้ต้องหา'), 'strong note ต้องมี subject ของ hero');
  assert.ok(blob.includes('closeup'), 'strong note ต้องมี shot');
});

test('weak match — spec ไม่มี note/subject/shot ทุกช่อง (ทั้งเส้น S6 และ S7 ใช้ strip เดียวกัน)', () => {
  const dna = makeRefDNA();
  const tokens = contentTokens(dna);
  assert.ok(tokens.length >= 3, 'fixture ต้องมี subject/shot ให้ทดสอบการรั่ว');

  for (const lane of ['S6', 'S7']) { // ทั้งสองจุด strip ด้วย expression เดียวกัน
    const weakDNA = weakStrip(dna);
    const spec = dnaToTemplateSpec(weakDNA);
    assert.ok(spec && Array.isArray(spec.slots) && spec.slots.length >= 3, `[${lane}] weak ยังต้องได้โครง (geometry) ใช้ได้`);

    for (const s of spec.slots) {
      assert.ok(!('note' in s), `[${lane}] ช่อง ${s.id} ต้องไม่มี property note (weak)`);
    }
    const blob = JSON.stringify(spec);
    for (const tok of tokens) {
      assert.ok(!blob.includes(tok), `[${lane}] spec ต้องไม่รั่วเนื้อหา "${tok}" (weak)`);
    }
  }
});

test('weak match — template.slots (ที่ไหลต่อ) เหลือเฉพาะ geometry, ไม่มี subject/shot/emotion (role/faceSizePct = โครง คงไว้)', () => {
  const dna = makeRefDNA();
  const weakDNA = weakStrip(dna);
  assert.equal(weakDNA._contentSanitized, true, 'ต้องติดธง _contentSanitized');
  for (const s of weakDNA.template.slots) {
    for (const k of FORBIDDEN_SLOT_KEYS) {
      assert.ok(!(k in s), `template.slot ต้องไม่มี "${k}" (weak)`);
    }
    for (const k of Object.keys(s)) {
      assert.ok(GEOMETRY_KEYS.includes(k), `template.slot คีย์ "${k}" ไม่ใช่ geometry ที่อนุญาต`);
    }
  }
});

test('weak match — ธง _contentSanitized อยู่รอด JSON round-trip (composer/queue อ่าน payload ที่ serialize)', () => {
  const dna = makeRefDNA();
  const weakDNA = weakStrip(dna);
  const roundTripped = JSON.parse(JSON.stringify(weakDNA)); // จำลอง persist → queue → composer
  assert.equal(roundTripped._contentSanitized, true, 'ธงต้องอยู่รอด serialize (enumerable)');
  const spec = dnaToTemplateSpec(roundTripped);
  for (const s of spec.slots) {
    assert.ok(!('note' in s), `หลัง round-trip ช่อง ${s.id} ต้องยังไม่มี note`);
  }
  const blob = JSON.stringify(spec);
  for (const tok of contentTokens(dna)) {
    assert.ok(!blob.includes(tok), `หลัง round-trip ต้องไม่รั่ว "${tok}"`);
  }
});

test('sanitize ไม่ mutate DNA ต้นฉบับในคลัง (คืน object ใหม่)', () => {
  const dna = makeRefDNA();
  const before = JSON.stringify(dna);
  const weakDNA = sanitizeRefDnaForWeakMatch(dna);
  assert.notEqual(weakDNA, dna, 'ต้องคืน object ใหม่');
  assert.notEqual(weakDNA.template, dna.template, 'template ต้องเป็น object ใหม่');
  assert.equal(JSON.stringify(dna), before, 'DNA ต้นฉบับต้องไม่ถูกแก้');
  assert.equal(dna.template.slots[0].subject, 'ผู้ต้องหา', 'slot ต้นฉบับต้องยังมี subject');
});

test('deterministic — weak strip + dnaToTemplateSpec คืนผลเท่ากันทุกครั้ง', () => {
  const dna = makeRefDNA();
  const a = dnaToTemplateSpec(weakStrip(dna));
  const b = dnaToTemplateSpec(weakStrip(dna));
  assert.deepEqual(a, b, 'ผล weak ต้อง deterministic');
  const s1 = dnaToTemplateSpec(makeRefDNA());
  const s2 = dnaToTemplateSpec(makeRefDNA());
  assert.deepEqual(s1, s2, 'ผล strong ต้อง deterministic');
});

// ============================================================
// 🧪 B0 fix (ผู้ตรวจเคาะ) — hero 'main' resolution ต้องรอด weak-match sanitize
// ------------------------------------------------------------
// บั๊กที่กันไว้: ถ้า sanitize strip 'role' ทิ้ง → dnaToTemplateSpec หา hero ('main') ไม่เจอ →
//   fallback ไปเลือก "สี่เหลี่ยมใหญ่สุด" (refTemplate.js ~237) → บน ref ที่ hero ไม่ใช่ช่องใหญ่สุด
//   (mirror REF-mrbq6y74-on6u) main จะกลายเป็นคนละช่อง (พิกัดผิด) — เทสชุดเดิมจับไม่ได้
//   เพราะ makeRefDNA() มี hero เป็นช่องใหญ่สุดพอดี (fallback บังเอิญได้ช่องเดียวกัน)
// ------------------------------------------------------------
// fixture: hero = ช่อง "ไม่ใช่ใหญ่สุด" (context เต็มความกว้างด้านบน = ใหญ่สุด)
function makeHeroNotLargestDNA() {
  return {
    layoutType: 'triptych',
    panelCount: 3,
    slots: [
      { role: 'context', subject: 'สถานที่', shot: 'wide', emotion: '' },
      { role: 'hero', subject: 'ตัวเอก', shot: 'closeup', emotion: 'ตกใจ' },
    ],
    template: {
      seamStyle: 'feather',
      featherPx: 8,
      slots: [
        // context = แถบบนเต็มกว้าง = พื้นที่ใหญ่สุด (100×55)
        { role: 'context', pos: 'top', subject: 'สถานที่เกิดเหตุ', shot: 'wide', emotion: '', faceSizePct: 0, xPct: 0, yPct: 0, wPct: 100, hPct: 55, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        // hero = ล่างซ้าย (55×45) เล็กกว่า context — role เท่านั้นที่บอกว่าเป็น hero
        { role: 'hero', pos: 'bottom-left', subject: 'ตัวเอก', shot: 'closeup', emotion: 'ตกใจ', faceSizePct: 62, xPct: 0, yPct: 55, wPct: 55, hPct: 45, zIndex: 0, border: false, borderColor: '-', borderWidthPct: 1.5 },
        // reaction = ล่างขวา (45×45)
        { role: 'reaction', pos: 'bottom-right', subject: 'ญาติ', shot: 'medium', emotion: 'เศร้า', faceSizePct: 30, xPct: 55, yPct: 55, wPct: 45, hPct: 45, zIndex: 0, border: true, borderColor: '#FFFFFF', borderWidthPct: 2 },
      ],
    },
  };
}

test('B0 — weak match: hero (main) id + geometry ตรงกับ pre-sanitize (hero ไม่ใช่ช่องใหญ่สุด)', () => {
  const dna = makeHeroNotLargestDNA();
  const specPre = dnaToTemplateSpec(dna);           // pre-sanitize (raw DNA, มี role)
  const specWeak = dnaToTemplateSpec(weakStrip(dna)); // post-sanitize (weak)

  const mainPre = specPre.slots.find((s) => s.id === 'main');
  const mainWeak = specWeak.slots.find((s) => s.id === 'main');
  assert.ok(mainPre, 'pre-sanitize ต้องมีช่อง main (จาก role hero)');
  assert.ok(mainWeak, 'weak ต้องยังมีช่อง main (role คงไว้ → hero-resolution ทำงาน)');

  // เรขาคณิต main ต้องเท่ากันทุก field (พิสูจน์ว่า role รอด sanitize → เลือกช่องเดิม)
  for (const k of ['x', 'y', 'w', 'h']) {
    assert.equal(mainWeak[k], mainPre[k], `main.${k} weak ต้องเท่า pre-sanitize`);
  }

  // ★ กัน fallback "ช่องใหญ่สุด": main ต้อง NOT ใช่ช่องพื้นที่มากสุดใน spec —
  //   ถ้า role ถูก strip main จะกลายเป็นช่อง context (ใหญ่สุด) → assertion นี้พัง
  const areaOf = (s) => s.w * s.h;
  const largest = specWeak.slots.filter((s) => s.shape !== 'circle').sort((a, b) => areaOf(b) - areaOf(a))[0];
  assert.notEqual(mainWeak.id === largest.id && areaOf(mainWeak) === areaOf(largest), true,
    'main (hero) ต้องไม่ใช่ช่องสี่เหลี่ยมใหญ่สุด — พิสูจน์ว่าเลือกจาก role ไม่ใช่ area fallback');
  assert.ok(areaOf(largest) > areaOf(mainWeak), 'ต้องมีช่อง (context) ใหญ่กว่า hero — ยืนยัน fixture "hero ไม่ใช่ใหญ่สุด"');
});

// ============================================================
// 🧪 B0.3 (ผู้ตรวจเคาะ) — faceSizePct = crop geometry → ต้องรอด sanitize (กัน _faceTargetShare หายเงียบ)
// ------------------------------------------------------------
// การตัดสิน: KEEP faceSizePct (เป็นเป้าครอปหน้า ไม่ใช่ subject/คน) → weak match ยังครอปหน้าตาม ref
//   composer (megaComposerService ~1199) อ่าน refSlotMeta[i].faceSizePct → _faceTargetShare (ช่วง 15–95)
//   ถ้า sanitize strip ทิ้ง = weak match เสีย face-targeting เงียบๆ — guard นี้กันไม่ให้ regress
// ============================================================
test('B0.3 — weak match: faceSizePct คงอยู่ทุกช่อง → _faceTargetShare ไม่หายเงียบ', () => {
  const dna = makeHeroNotLargestDNA();
  const weakDNA = weakStrip(dna);
  const srcSlots = dna.template.slots;
  const outSlots = weakDNA.template.slots;
  assert.equal(outSlots.length, srcSlots.length, 'จำนวนช่องต้องเท่าเดิม');

  outSlots.forEach((s, i) => {
    assert.equal(s.faceSizePct, srcSlots[i].faceSizePct, `ช่อง ${i} ต้องคง faceSizePct หลัง sanitize`);
  });

  // จำลองการ derive ของ composer: pct อยู่ในช่วง 15–95 → ต้องได้ _faceTargetShare (ไม่ null/หาย)
  const heroSrc = srcSlots.find((s) => s.role === 'hero');
  const heroOut = outSlots.find((s) => s.role === 'hero'); // role คงไว้ → หาช่อง hero ได้
  assert.ok(heroOut, 'role คงไว้ → composer refSlotMeta หา heroT ได้');
  const pct = Number(heroOut.faceSizePct);
  assert.ok(pct >= 15 && pct <= 95, 'faceSizePct ของ hero ต้องยังอยู่ในช่วงที่ composer ใช้ตั้ง _faceTargetShare');
  assert.equal(+(pct / 100).toFixed(3), +(Number(heroSrc.faceSizePct) / 100).toFixed(3), '_faceTargetShare ที่ derive ได้ต้องเท่าค่า ref เดิม');
});
