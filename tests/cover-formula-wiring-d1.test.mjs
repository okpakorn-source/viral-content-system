// ============================================================
// 🧪 cover-formula-wiring-d1.test.mjs — เฟส D ข้อ 1 (29 ก.ค. 69, "เสียบ coverFormulaCheck เข้าท่อจริง")
// ------------------------------------------------------------
// ★ แก้รอบ 2 (Opus พิสูจน์): รอบแรกส่งแค่ qcFlags+template เข้า evaluateCoverFormula (ไม่ส่ง slots เลย) — ได้
//   null ทุก 6 ข้อเสมอ เพราะ fallback regex ใน coverFormulaCheck.js (เช่น /^face_share_out:hero:.../) รอ
//   canonical role name ตรงตัว แต่ธงจริงที่ระบบ emit (measureTechRules ใน megaComposerService.js) ใช้ composer
//   slotId จริง (main/circle/context/reaction_1 ฯลฯ) — พิสูจน์จากเคสจริง MCV-ms6ac5atfg4: ธงคือ
//   face_share_out:main:16 ไม่ใช่ face_share_out:hero:16
// แก้จริง: เพิ่ม formulaRoleOfSlotId (composer slotId → canonical role) + buildFormulaInputFromCoverResult
// (ประกอบ {slots, template} จาก pickImages.slots/manifest.slots/qcFlags จริง) ทั้งคู่ export เป็น PURE function
// ให้เทสตรงได้ — s7_wait เรียกทั้งคู่แทนโค้ด inline เดิม
// ★ บั๊กที่เจอจากโพรบของตัวเอง (ไม่ใช่ Opus บอก): coverFormulaCheck.js ใช้ num(v)=Number(v)+isFinite check —
//   Number(null)===0 (finite!) ทำให้ faceSharePct/faceVisible/triage.textOverlay ถ้าใส่ null จะถูกตีความว่า
//   "วัดได้ค่า 0" ไม่ใช่ "วัดไม่ได้" — ต้องใช้ undefined สำหรับ 3 ฟิลด์นี้เท่านั้น (ฟิลด์อื่นเช็คด้วย typeof
//   ปลอดภัยกับ null) — มีเทสเฉพาะกันบั๊กนี้ไม่ให้กลับมา (ข้อ 4 ด้านล่าง)
// ------------------------------------------------------------
// harness:
//   (1) formulaRoleOfSlotId + buildFormulaInputFromCoverResult: PURE export เรียกตรง
//   (2) พิสูจน์ด้วยข้อมูลจริงจากเคส MCV-ms6ac5atfg4 (qcFlags จริงจาก data/mega-cover-runs.json) — ต้องได้ check
//       ตัดสินจริง (ไม่ null) รวมทั้ง face_share_hero=fail จาก face_share_out:main:16
//   (3) source-assertion: จุด wiring ใน megaAdapters.js/megaCoverArchive.js/dev-progress-server.mjs
//   (4) กันบั๊ก null-vs-undefined กลับมา (num() coercion gotcha)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const {
  evaluateCoverFormula,
  formulaRoleOfSlotId,
  buildFormulaInputFromCoverResult,
} = await import('@/lib/coverFormulaCheck');
const { pickLatestCovers } = await import('../scripts/dev-progress-server.mjs');
const adaptersSrc = readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
const archiveSrc = readFileSync(new URL('../src/lib/megaCoverArchive.js', import.meta.url), 'utf8');

// ═══════════════════════════ (1) formulaRoleOfSlotId — PURE unit ═══════════════════════════

test('formulaRoleOfSlotId: "main" (composer slotId จริงของ hero — ไม่ใช่ "hero" ตรงตัว) → "hero"', () => {
  assert.equal(formulaRoleOfSlotId('main'), 'hero');
});

test('formulaRoleOfSlotId: shape==="circle" ชนะเสมอไม่ว่า slotId จะเป็นอะไร', () => {
  assert.equal(formulaRoleOfSlotId('r_circle_2', 'circle'), 'circle');
});

test('formulaRoleOfSlotId: prefix context_2/evidence_3/action_1/moment_1/reaction_1 → role ตามจริง (evidence รวมเข้า context)', () => {
  assert.equal(formulaRoleOfSlotId('context_2'), 'context');
  assert.equal(formulaRoleOfSlotId('evidence_3'), 'context');
  assert.equal(formulaRoleOfSlotId('action_1'), 'action');
  assert.equal(formulaRoleOfSlotId('moment_1'), 'moment');
  assert.equal(formulaRoleOfSlotId('reaction_1'), 'reaction');
});

test('formulaRoleOfSlotId: slotId ไม่รู้จัก (เช่น pair_3/victim_5) → null (ไม่เดา)', () => {
  assert.equal(formulaRoleOfSlotId('pair_3'), null);
  assert.equal(formulaRoleOfSlotId('victim_5'), null);
  assert.equal(formulaRoleOfSlotId(''), null);
  assert.equal(formulaRoleOfSlotId(undefined), null);
});

// ═══ (2) พิสูจน์ด้วยข้อมูลจริงจากเคส MCV-ms6ac5atfg4 (data/mega-cover-runs.json ของจริง — manifest เป็น null ในเคสนี้) ═══

const REAL_QCFLAGS_MS6AC5ATFG4 = [
  'border_trimmed:context', 'hero_unverified_kept', 'hero_pose:three_quarter', 'upscale_soft:main:1.47',
  'crop_tightened:circle', 'face_small:circle:0.55', 'face_share_out:main:16', 'headroom_out:main:44.2',
  'face_share_out:circle:55', 'ladder_break:reaction_1:pair_3:0', 'circle_face_overlap:main',
];

test('[เคสจริง MCV-ms6ac5atfg4, qcFlags-only — manifest=null ตรงกับ record จริง] face_share_hero ต้อง fail จาก face_share_out:main:16 (ไม่ใช่ null)', () => {
  const { slots, template } = buildFormulaInputFromCoverResult({ qcFlags: REAL_QCFLAGS_MS6AC5ATFG4, manifestSlots: null, pickImagesSlots: null });
  const heroSlot = slots.find((s) => s.role === 'hero');
  assert.ok(heroSlot, 'ต้องมี slot role=hero ในผลลัพธ์ (แปลงจาก composer slotId "main" สำเร็จ)');
  assert.equal(heroSlot.faceSharePct, 16, 'ค่าต้องมาจาก face_share_out:main:16 จริง (ไม่ใช่เดา/ค่าคงที่)');
  const fc = evaluateCoverFormula({ slots, qcFlags: REAL_QCFLAGS_MS6AC5ATFG4, template });
  const heroCheck = fc.checks.find((c) => c.key === 'face_share_hero');
  assert.equal(heroCheck.pass, false, 'ต้อง fail จริง (16% ต่ำกว่าเป้า 36-48%) — ไม่ใช่ null เหมือนบั๊กเดิม');
  assert.equal(heroCheck.value, 16);
  // ★ ข้อ 4 (Opus): assert ว่าเป็นค่าจริง ไม่ใช่ตอกหมุด 0/0
  const measurable = fc.checks.filter((c) => c.pass !== null);
  assert.ok(measurable.length >= 1, `ต้องมีอย่างน้อย 1 check ตัดสินจริงแม้ในเคส qcFlags-only ที่บางที่สุด (ได้ ${measurable.length})`);
});

test('[เคสจริง MCV-ms6ac5atfg4 + pickImages.slots สมจริง — สภาพจริงตอน s7_wait รันจริง] ต้องได้ check ตัดสินจริง ≥3 ข้อ', () => {
  // pickImages.slots ไม่ถูกเก็บใน archived record (data/mega-cover-runs.json ไม่มี dossier) — แต่ "มีอยู่จริง" ใน
  // job.dossier.pickImages.slots ตอน s7_wait รันจริงเสมอ (S6 เขียนไว้ก่อนเข้า S7 แล้ว) — จำลองให้สมจริงตามบริบท
  // ธงจริงของเคสนี้ (มี context/circle/reaction_1 อยู่ในธง)
  const pickImagesSlots = {
    hero: { id: 'A1', person: 'สมชาย', category: 'context', newsScene: true },
    circle: { id: 'A2', person: 'สมหญิง', category: 'face-neutral', newsScene: true },
    context: { id: 'A3', person: null, category: 'context', newsScene: false },
    reaction: { id: 'A4', person: 'สมหญิง', category: 'face-neutral', newsScene: true },
  };
  const { slots, template } = buildFormulaInputFromCoverResult({ qcFlags: REAL_QCFLAGS_MS6AC5ATFG4, manifestSlots: null, pickImagesSlots });
  const fc = evaluateCoverFormula({ slots, qcFlags: REAL_QCFLAGS_MS6AC5ATFG4, template });
  const measurable = fc.checks.filter((c) => c.pass !== null);
  assert.ok(measurable.length >= 3, `ต้องได้ check ตัดสินจริง ≥3 ข้อ (Opus บอก ≥2-3) — ได้ ${measurable.length}: ${measurable.map((c) => c.key).join(', ')}`);
  assert.equal(fc.checks.find((c) => c.key === 'face_share_hero').pass, false);
  assert.equal(fc.checks.find((c) => c.key === 'evidence_present').pass, true, 'มี newsScene=true 3 ช่อง (hero/circle/reaction)');
  assert.equal(fc.checks.find((c) => c.key === 'circle_distinct').pass, true, 'คนละคนกับ hero จริง (สมหญิง≠สมชาย)');
  assert.equal(typeof fc.score, 'number', 'score ต้องเป็นตัวเลขจริง (มี check วัดได้แล้ว) ไม่ใช่ null');
});

test('buildFormulaInputFromCoverResult: manifest.slots มีจริง (measured.faceSharePct) → ใช้ค่านั้นแทน qcFlags (แม่นกว่า)', () => {
  const manifestSlots = [{ slot: 'main', shape: 'rect', measured: { faceSharePct: 38.5, headroomPct: 10 } }];
  const { slots } = buildFormulaInputFromCoverResult({ qcFlags: ['face_share_out:main:16'], manifestSlots, pickImagesSlots: null });
  const hero = slots.find((s) => s.role === 'hero');
  assert.equal(hero.faceSharePct, 38.5, 'manifest.measured ต้องชนะ qcFlags เมื่อมีทั้งคู่ (แม่นกว่า — เลขจริงของรอบประกอบนี้)');
});

test('buildFormulaInputFromCoverResult: sameAsHeroPerson เทียบชื่อจาก pickImages.slots ตรงๆ (แม่นกว่าเดาจาก qcFlags)', () => {
  const pickImagesSlots = { hero: { person: 'สมชาย ใจดี' }, circle: { person: 'สมชาย ใจดี' } };
  const { slots } = buildFormulaInputFromCoverResult({ qcFlags: [], manifestSlots: null, pickImagesSlots });
  assert.equal(slots.find((s) => s.role === 'circle').sameAsHeroPerson, true, 'ชื่อเดียวกัน (ไม่สนตัวพิมพ์ใหญ่เล็ก/ช่องว่างหัวท้าย) → true');
});

test('buildFormulaInputFromCoverResult: blind_crop/person_cut flag → faceVisible=0 (ยืนยันไม่ผ่านแน่ๆ)', () => {
  const { slots } = buildFormulaInputFromCoverResult({ qcFlags: ['blind_crop:reaction_1'], manifestSlots: null, pickImagesSlots: null });
  assert.equal(slots.find((s) => s.role === 'reaction').faceVisible, 0);
});

test('ทุก field ว่างเปล่าทั้งหมด (ไม่มี qcFlags/manifest/pickImages เลย) → slots ว่าง, ไม่ throw', () => {
  const { slots, template } = buildFormulaInputFromCoverResult({});
  assert.deepEqual(slots, []);
  assert.equal(template.panelCount, null);
  assert.equal(template.hasCircle, false);
  const fc = evaluateCoverFormula({ slots, qcFlags: [], template });
  assert.equal(fc.score, null);
  assert.ok(fc.checks.every((c) => c.pass === null));
});

// ═══ (3) กันบั๊ก null-vs-undefined (num() coercion) กลับมา — บั๊กที่เจอจากการโพรบของตัวเองระหว่างแก้รอบนี้ ═══

test('[กันบั๊กกลับมา] role ที่ไม่มีข้อมูล faceSharePct/faceVisible เลย ต้องไม่ถูกนับเป็น "วัดได้ค่า 0" — ต้องเป็น pass:null ไม่ใช่ pass:true/false มั่ว', () => {
  // role "action" ไม่มีสัญญาณอะไรเข้ามาเลย (ไม่มีใน qcFlags/manifest/pickImages) — ต้องไม่ปรากฏใน slots เลยด้วยซ้ำ
  // (ensure() ถูกเรียกเฉพาะ role ที่มีสัญญาณจริงอย่างน้อย 1 อย่าง) — ทดสอบทางอ้อมผ่าน face_visible_subslots:
  // ส่ง reaction ที่มีแค่ newsScene (ไม่มี faceVisible/blind_crop/person_cut เลย) → ต้องไม่ถูกนับเป็น measured
  const pickImagesSlots = { reaction: { newsScene: true } }; // ไม่มี faceVisible signal ใดๆ เลย
  const { slots } = buildFormulaInputFromCoverResult({ qcFlags: [], manifestSlots: null, pickImagesSlots });
  const reactionSlot = slots.find((s) => s.role === 'reaction');
  assert.equal(reactionSlot.faceVisible, undefined, 'ต้องเป็น undefined (ไม่ใช่ null) กัน Number(null)=0 ทำให้ num() เข้าใจผิดว่าวัดได้ค่า 0');
  const fc = evaluateCoverFormula({ slots, qcFlags: [], template: {} });
  const fv = fc.checks.find((c) => c.key === 'face_visible_subslots');
  assert.equal(fv.pass, null, 'ต้อง degrade เป็น null (วัดไม่ได้จริง) — ถ้าเป็นบั๊กเดิมจะได้ pass:false (value 0/1) ผิดๆ');
});

test('[กันบั๊กกลับมา] role ที่ไม่มี faceSharePct เลย ต้องไม่ถูกนับว่า "หน้าเล็ก 0%" — ต้อง undefined ไม่ใช่ null', () => {
  const { slots } = buildFormulaInputFromCoverResult({ qcFlags: [], manifestSlots: null, pickImagesSlots: { hero: { newsScene: true } } });
  const hero = slots.find((s) => s.role === 'hero');
  assert.equal(hero.faceSharePct, undefined, 'ไม่มีสัญญาณ faceSharePct เลย ต้องเป็น undefined');
  const fc = evaluateCoverFormula({ slots, qcFlags: [], template: {} });
  const fsh = fc.checks.find((c) => c.key === 'face_share_hero');
  assert.equal(fsh.pass, null, 'ต้อง degrade เป็น null (ไม่ใช่ fail มั่วจาก 0%)');
});

test('[กันบั๊กกลับมา] triage.textOverlay ไม่มีสัญญาณ → undefined ไม่ใช่ null (กัน no_baked_text pass:true มั่ว)', () => {
  const { slots } = buildFormulaInputFromCoverResult({ qcFlags: [], manifestSlots: null, pickImagesSlots: { hero: { newsScene: true } } });
  const hero = slots.find((s) => s.role === 'hero');
  assert.equal(hero.triage.textOverlay, undefined);
  const fc = evaluateCoverFormula({ slots, qcFlags: [], template: {} });
  const nbt = fc.checks.find((c) => c.key === 'no_baked_text');
  assert.equal(nbt.pass, null, 'ต้อง degrade เป็น null (ไม่ใช่ pass:true มั่วจากค่า textOverlay=0 ที่ไม่ได้วัดจริง)');
});

// ═══════════════════════════ (4) source-assertion: megaAdapters.js wiring ═══════════════════════════

test('source: kill-switch MEGA_FORMULA_CHECK คุมการเรียก evaluateCoverFormula (default ON, \'0\'=ไม่เรียก)', () => {
  assert.ok(/if \(process\.env\.MEGA_FORMULA_CHECK !== '0'\) \{/.test(adaptersSrc));
});

test('source: s7_wait เรียก buildFormulaInputFromCoverResult (ไม่ใช่โค้ด inline เดิมที่ลืมส่ง slots)', () => {
  assert.ok(/const \{ slots: _formulaSlots, template: _formulaTemplate \} = buildFormulaInputFromCoverResult\(\{/.test(adaptersSrc));
  assert.ok(/manifestSlots: r\.manifest\?\.slots,/.test(adaptersSrc));
  assert.ok(/pickImagesSlots: job\.dossier\.pickImages\?\.slots,/.test(adaptersSrc));
});

test('source: evaluateCoverFormula รับ slots จริงแล้ว (ไม่ใช่แค่ qcFlags+template แบบรอบแรกที่ผิด)', () => {
  assert.ok(/const _fc = evaluateCoverFormula\(\{ slots: _formulaSlots, qcFlags: _qcFlags, template: _formulaTemplate \}\);/.test(adaptersSrc));
});

test('source: formulaScore ถูกคำนวณจาก checks จริง (passed/total derive จาก measurable checks)', () => {
  assert.ok(/const _measurable = _fc\.checks\.filter\(\(c\) => c\.pass !== null\);/.test(adaptersSrc));
  assert.ok(/formulaScore = \{ passed: _measurable\.filter\(\(c\) => c\.pass === true\)\.length, total: _measurable\.length, score: _fc\.score, checks: _fc\.checks \};/.test(adaptersSrc));
});

test('source: log แยก "วัดไม่ได้ (n ข้อ)" ออกจาก "ผ่าน x/y" ชัดเจน (ข้อ 3 ของ Opus)', () => {
  assert.ok(/const _unmeasurableCount = _fc\.checks\.length - _measurable\.length;/.test(adaptersSrc));
  assert.ok(/ผ่าน \$\{formulaScore\.passed\}\/\$\{formulaScore\.total\} ข้อที่วัดได้ · วัดไม่ได้ \$\{_unmeasurableCount\} ข้อ/.test(adaptersSrc));
});

test('source: formulaScore เรียกล้มต้อง console.warn (advisory เท่านั้น) ไม่ throw ทะลุขึ้นไปกระทบ s7_wait', () => {
  assert.ok(/console\.warn\('\[MEGA S7\] formula-check ล้ม \(advisory เท่านั้น ไม่กระทบปก\): '/.test(adaptersSrc));
});

test('source: formulaScore แนบเข้า coverCore ทุก path (object ปกติ; null เฉพาะ kill-switch)', () => {
  assert.ok(/formulaScore, \/\/ AC-0232: default path always carries an object; explicit MEGA_FORMULA_CHECK=0 carries null/.test(adaptersSrc));
});

test('source: formulaScore ถูกส่งต่อไปยัง addMegaCover ด้วย (ต้องถึงคลังจริง ไม่ใช่แค่ dossierPatch)', () => {
  assert.ok(/qcFlags: Array\.isArray\(r\.qcFlags\) \? r\.qcFlags : \[\], formulaScore \}\); \/\/ audit: ธงคุณภาพ\+formulaScore ต้องถึงคลังจากทางหลัก/.test(adaptersSrc));
});

test('source: qcVerdict (การตัดสินใจเข้าคลัง/ผ่าน QC) ไม่ถูกแตะเลย — formulaScore เป็น advisory จริง ไม่มีผลต่อ pass/fail', () => {
  const qcVerdictLine = adaptersSrc.match(/const qcVerdict = evaluateCoverQc\(\{[^}]+\}\);/);
  assert.ok(qcVerdictLine, 'ต้องหาบรรทัดคำนวณ qcVerdict เจอ');
  assert.ok(!/formulaScore/.test(qcVerdictLine[0]), 'evaluateCoverQc ต้องไม่รับ formulaScore เป็น input เลย (advisory ล้วน แยกจากด่านตัดสินใจ)');
});

// ═══════════════════════════ (5) source-assertion: megaCoverArchive.js entry shape ═══════════════════════════

test('source: archive boundary resolve/persist formulaScore ทุก record และคง kill-switch', () => {
  assert.ok(/export async function resolveArchiveFormulaScore\(rec = \{\}\)/.test(archiveSrc));
  assert.ok(/if \(process\.env\.MEGA_FORMULA_CHECK === '0'\) return null;/.test(archiveSrc));
  assert.ok(/const formulaScore = await resolveArchiveFormulaScore\(rec\);/.test(archiveSrc));
  assert.ok(/formulaScore, \/\/ AC-0232: every new archive record has the field/.test(archiveSrc));
  assert.doesNotMatch(archiveSrc, /import\(['"]@\/lib\/megaAdapters['"]\)/);
  assert.match(archiveSrc, /from ['"]\.\/coverFormulaCheck\.js['"]/);
});

// ═══════════════════════════ (6) dev-progress-server.mjs — pickLatestCovers coverFormulaScore mapping ═══════════════════════════

test('pickLatestCovers: record มี formulaScore object จริง → coverFormulaScore แสดง {passed,total,score}', () => {
  const [c] = pickLatestCovers([
    { id: 'x1', at: '2026-07-29T00:00:00Z', title: 't', formulaScore: { passed: 4, total: 6, score: 67, checks: [{ key: 'a' }] } },
  ], 1);
  assert.deepEqual(c.coverFormulaScore, { passed: 4, total: 6, score: 67 }, 'ต้อง map มาแค่ 3 ฟิลด์ที่ต้องโชว์ (ไม่ต้องพก checks ดิบทั้งก้อนไปการ์ด UI)');
});

test('pickLatestCovers: record ไม่มี formulaScore เลย (เรคคอร์ดเก่า/ปิดสวิตช์) → coverFormulaScore เป็น null', () => {
  const [c] = pickLatestCovers([{ id: 'x2', at: '2026-07-29T00:00:00Z', title: 't' }], 1);
  assert.equal(c.coverFormulaScore, null);
});

test('pickLatestCovers: input_unavailable is hidden instead of rendering formula 0/0', () => {
  const [c] = pickLatestCovers([{
    id: 'x-unavailable',
    at: '2026-07-29T00:00:00Z',
    title: 't',
    formulaScore: {
      passed: 0,
      total: 0,
      score: null,
      checks: [],
      reason: 'input_unavailable',
    },
  }], 1);
  assert.equal(c.coverFormulaScore, null);
});

test('pickLatestCovers: formulaScore เพี้ยน (ไม่ใช่ object เช่น string/number) → coverFormulaScore เป็น null ไม่ throw', () => {
  const [c1] = pickLatestCovers([{ id: 'x3', at: '2026-07-29T00:00:00Z', title: 't', formulaScore: 'oops' }], 1);
  assert.equal(c1.coverFormulaScore, null);
  const [c2] = pickLatestCovers([{ id: 'x4', at: '2026-07-29T00:00:00Z', title: 't', formulaScore: 42 }], 1);
  assert.equal(c2.coverFormulaScore, null);
});

test('source: dev-progress-server.mjs ตั้งใจใช้ชื่อ coverFormulaScore (ไม่ใช่ formulaScore เฉยๆ) กันชนกับ formulaScore ระดับบอร์ดจาก dev-progress-board.json', () => {
  const src = readFileSync(new URL('../scripts/dev-progress-server.mjs', import.meta.url), 'utf8');
  assert.ok(/c\.formulaScore\.reason !== 'input_unavailable'/.test(src), 'input_unavailable ต้องไม่แสดงเป็นสูตร 0/0');
  assert.ok(/formulaScore: boardData\.formulaScore \|\| null/.test(src), 'formulaScore ระดับบอร์ด (คนละก้อน) ต้องยังอยู่เหมือนเดิม ไม่ถูกแทนที่');
});

console.log('cover-formula-wiring-d1: all tests defined via node:test — see summary above');
