// ============================================================
// 🎯 ref-category-rotation.test.mjs (29 ก.ค. 69) — เจ้าของถาม "ทำไม ref template ไม่เคยเปลี่ยน"
// ------------------------------------------------------------
// แก้ 3 จุด: (1) ติดป้ายหมวด (คัมภีร์ v3 11 หมวด) ให้ ref เพจจริง 20 ใบ (data/ref-cover-library.json — ดูสคริปต์
//   แยกที่รันแล้ว ไม่ใช่ส่วนของเทสนี้) (2) สะพานคำศัพท์ DESK_TO_REF_CATEGORY + refCategoryHint (refCoverMatch.js)
//   แปล "หมวดเคสข่าว" (DESK_CATEGORIES, deskBrain.js) → "หมวด ref" (สูตรรายหมวด, coverPagePlaybook.js) — เติม
//   เข้า signals.text ตอน compose (megaAdapters.js ทั้ง 2 จุดเรียก pickBestRef) (3) MEGA_REF_VARIETY_MARGIN
//   ปรับ MARGIN ได้ (default ค่าเดิม=1)
// harness: stub @/lib/refCoverLibrary (พูลควบคุมได้ผ่าน globalThis) — @/lib/refCoverGrade ของจริง 100%
//   (แพทเทิร์นเดียวกับ tests/pickbestref-fidelity.test.mjs ที่มีอยู่แล้วในคลัง)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

const STUB_REFLIB = _mod('export async function listRefCovers(n){ return globalThis.__RCR_POOL || []; }');

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/refCoverLibrary') return { url: ${JSON.stringify(STUB_REFLIB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook));

const { pickBestRef, refCategoryHint, DESK_TO_REF_CATEGORY } = await import('../src/lib/refCoverMatch.js');

const LIB = path.join(__dirname, '..', 'data', 'ref-cover-library.json');
const library = JSON.parse(fs.readFileSync(LIB, 'utf8'));
const BASE_DNA = structuredClone(library[0].dna);

function mkRef(id, { matchNewsType = [], humanVerified = false } = {}) {
  const dna = structuredClone(BASE_DNA);
  delete dna._templateGrade;
  delete dna._duplicateOf;
  delete dna._humanVerified;
  delete dna._fidelity; // ไม่มี fidelity เลย → refFidelityBonus fallback -3 (grade F จาก computeTemplateGrade เมื่อไม่มีข้อมูล)
  // ★ กัน grade F ลาก matched score ติดลบจนหลุดเกณฑ์ typeMatched (>0) — ให้ทุกใบ humanVerified เพื่อคุมตัวแปรทดสอบ
  //   ให้เหลือแค่ matchNewsType เป็นตัวตัดสินหลักอย่างเดียว (ไม่ปนกับ fidelity ที่ไม่ใช่จุดสนใจของเทสชุดนี้)
  dna._humanVerified = true;
  dna._reproducible = true;
  dna.matchNewsType = matchNewsType;
  return { id, imagePath: `/ref-covers/${id}.jpg`, dna };
}

// ═══════════════════════════ ① refCategoryHint / DESK_TO_REF_CATEGORY — unit ═══════════════════════════

test('refCategoryHint: หมวดเคสที่แปลได้ → คืนหมวด ref ตรงตาราง', () => {
  assert.equal(refCategoryHint('กตัญญู/ครอบครัวอบอุ่น'), 'กตัญญู');
  assert.equal(refCategoryHint('สู้ชีวิต'), 'สู้ชีวิต');
  assert.equal(refCategoryHint('ความรัก/แต่งงาน'), 'ความรักคู่');
  assert.equal(refCategoryHint('คนดังทำดี/ติดดิน'), 'น้ำใจคนดัง');
  assert.equal(refCategoryHint('น้ำใจ/ช่วยเหลือ'), 'น้ำใจคนธรรมดา');
  assert.equal(refCategoryHint('ดราม่าสังคม'), 'ความยุติธรรม');
  assert.equal(refCategoryHint('อาชญากรรม/คดีดัง'), 'ความยุติธรรม');
});

test('refCategoryHint: หมวดเคสที่แปลไม่ได้ (ไม่อยู่ในตาราง) → คืนสตริงว่าง (ไม่เดา ไม่ throw)', () => {
  assert.equal(refCategoryHint('กระแสรายวัน'), '');
  assert.equal(refCategoryHint('บันเทิงกระแส'), '');
  assert.equal(refCategoryHint('กีฬา'), '');
  assert.equal(refCategoryHint('อื่นๆ'), '');
  assert.equal(refCategoryHint('หมวดที่ไม่มีอยู่จริง'), '');
});

test('refCategoryHint: input พัง (null/undefined/ตัวเลข) → คืนสตริงว่างเสมอ ไม่ throw', () => {
  assert.equal(refCategoryHint(null), '');
  assert.equal(refCategoryHint(undefined), '');
  assert.equal(refCategoryHint(''), '');
  assert.equal(refCategoryHint(123), '');
});

test('DESK_TO_REF_CATEGORY: ทุกค่าปลายทางต้องอยู่ใน 11 หมวดคัมภีร์ v3 (สูตรรายหมวด coverPagePlaybook.js)', () => {
  const V3_CATEGORIES = new Set([
    'น้ำใจคนดัง', 'กตัญญู', 'อาลัย', 'ความยุติธรรม', 'พลิกชีวิต', 'สู้ชีวิต',
    'เด็กดี', 'ความรักคู่', 'ความรักครอบครัว', 'สัตว์', 'น้ำใจคนธรรมดา',
  ]);
  for (const [deskCat, refCat] of Object.entries(DESK_TO_REF_CATEGORY)) {
    assert.ok(V3_CATEGORIES.has(refCat), `${deskCat} → "${refCat}" ต้องเป็นหนึ่งใน 11 หมวดคัมภีร์ v3`);
  }
});

// ═══════════════════════════ ② pickBestRef — หมวดเคสจับคู่ ref ถูกใบ (integration ผ่าน stub pool) ═══════════════════════════

test('pickBestRef: เติม category hint เข้า text → จับคู่ ref หมวดตรง ("กตัญญู") ชนะ ref หมวดอื่น (แม้ตัวเนื้อข่าวไม่มีคำหมวดตรงๆ)', async () => {
  const refKatanyu = mkRef('REF-KATANYU', { matchNewsType: ['กตัญญู'] });
  const refLove = mkRef('REF-LOVE', { matchNewsType: ['ความรักคู่'] });
  globalThis.__RCR_POOL = [refKatanyu, refLove];
  const catHint = refCategoryHint('กตัญญู/ครอบครัวอบอุ่น'); // = 'กตัญญู'
  const result = await pickBestRef({ text: [catHint, 'ลูกชายพาแม่ไปเที่ยวทะเลครั้งแรกในชีวิต'].join(' '), emotion: '' });
  assert.equal(result.ref.id, 'REF-KATANYU', 'category hint ต้องพา ref หมวดกตัญญูชนะ แม้ประโยคเล่าเรื่องไม่มีคำว่า "กตัญญู" ตรงๆ');
  assert.equal(result.typeMatched, true);
});

test('pickBestRef: ไม่เติม category hint (สตริงว่าง) → ผลเหมือนพฤติกรรมเดิมเป๊ะ (byte-parity เมื่อไม่มี mapping/ไม่มี field หมวด)', async () => {
  const refKatanyu = mkRef('REF-KATANYU', { matchNewsType: ['กตัญญู'] });
  const refLove = mkRef('REF-LOVE', { matchNewsType: ['ความรักคู่'] });
  globalThis.__RCR_POOL = [refKatanyu, refLove];
  const withoutHint = await pickBestRef({ text: ['', 'ลูกชายพาแม่ไปเที่ยวทะเลครั้งแรกในชีวิต'].filter(Boolean).join(' '), emotion: '' });
  const withEmptyHint = await pickBestRef({ text: [refCategoryHint('หมวดไม่รู้จัก'), 'ลูกชายพาแม่ไปเที่ยวทะเลครั้งแรกในชีวิต'].filter(Boolean).join(' '), emotion: '' });
  assert.deepEqual(withoutHint, withEmptyHint, 'หมวดที่แปลไม่ได้ (คืนค่าว่าง) ต้องให้ผลเหมือนไม่เติม hint เลยทุกประการ');
  assert.equal(withoutHint.typeMatched, false, 'ไม่มีคำหมวดตรงเลย (ไม่มี hint) → ไม่ควรแมตช์ทั้งคู่ (พิสูจน์ hint คือตัวที่ทำให้แมตช์ในเทสก่อนหน้า ไม่ใช่ประโยคเล่าเรื่องเอง)');
});

test('pickBestRef: เคสหมวด "สู้ชีวิต" กับเคสหมวด "ความรักคู่" (คนละเคส คนละ category hint) → ได้ต้นแบบ ref คนละใบกัน', async () => {
  const refFight = mkRef('REF-FIGHT', { matchNewsType: ['สู้ชีวิต'] });
  const refRomance = mkRef('REF-ROMANCE', { matchNewsType: ['ความรักคู่'] });
  globalThis.__RCR_POOL = [refFight, refRomance];

  const caseA = await pickBestRef({ text: [refCategoryHint('สู้ชีวิต'), 'เรื่องราวความพยายามของหนุ่มขายลอตเตอรี่'].join(' '), emotion: '' });
  const caseB = await pickBestRef({ text: [refCategoryHint('ความรัก/แต่งงาน'), 'เรื่องราวความรักของคู่รักวัยเกษียณ'].join(' '), emotion: '' });

  assert.equal(caseA.ref.id, 'REF-FIGHT');
  assert.equal(caseB.ref.id, 'REF-ROMANCE');
  assert.notEqual(caseA.ref.id, caseB.ref.id, 'คนละหมวดเคส ต้องได้ต้นแบบคนละใบ (ไม่ใช่ผู้ชนะเกรดสูงสุดใบเดียวกันทุกครั้ง)');
});

test('pickBestRef: seedKey เดิม + พูล/เนื้อหาเดิม → ได้ ref ใบเดิมทุกครั้ง (deterministic, ไม่ใช่สุ่มจริง)', async () => {
  const refA = mkRef('REF-A', { matchNewsType: ['อาลัย'] });
  const refB = mkRef('REF-B', { matchNewsType: ['อาลัย'] }); // หมวดเดียวกัน คะแนนเท่ากัน → อยู่กลุ่มใกล้กัน (candidates)
  globalThis.__RCR_POOL = [refA, refB];
  const signals = { text: [refCategoryHint('เตือนภัย/อุทาหรณ์') /* ไม่ mapped จริงๆ ใช้แค่โครง */, 'อาลัยการจากไปของคุณยาย'].filter(Boolean).join(' '), emotion: '' };
  const opts = { seedKey: 'CASE-FIXED-SEED-001' };
  const results = await Promise.all([1, 2, 3].map(() => pickBestRef(signals, opts)));
  const ids = results.map((r) => r.ref.id);
  assert.ok(ids.every((id) => id === ids[0]), `seedKey เดิม re-run 3 รอบต้องได้ ref ใบเดิมเสมอ (ได้ ${JSON.stringify(ids)})`);
});

// ═══════════════════════════ ③ MEGA_REF_VARIETY_MARGIN — env override (default เดิมเมื่อไม่ตั้ง) ═══════════════════════════

test('MARGIN: ไม่ตั้ง MEGA_REF_VARIETY_MARGIN → พฤติกรรมเดิมเป๊ะ (MARGIN=1, gap>1 = ผู้ชนะเดียว ไม่สุ่ม)', async () => {
  delete process.env.MEGA_REF_VARIETY_MARGIN;
  // gap ระหว่าง 2 ใบ: ใบเดียวมี matchNewsType hit (+3) อีกใบไม่มีเลย (+0) → gap=3 > MARGIN default(1) → ผู้ชนะเดียว
  const refHit = mkRef('REF-HIT', { matchNewsType: ['กตัญญู'] });
  const refMiss = mkRef('REF-MISS', { matchNewsType: ['ไม่เกี่ยวอะไรเลย'] });
  globalThis.__RCR_POOL = [refHit, refMiss];
  const result = await pickBestRef({ text: [refCategoryHint('กตัญญู/ครอบครัวอบอุ่น'), 'ลูกดูแลแม่ยามแก่เฒ่า'].join(' '), emotion: '' });
  assert.equal(result.ref.id, 'REF-HIT');
  assert.ok(!/สุ่ม/.test(result.reason), 'gap 3 > MARGIN default 1 → ต้องเป็นผู้ชนะเดียว ไม่ใช่กลุ่มสุ่ม');
});

test('MARGIN: ตั้ง MEGA_REF_VARIETY_MARGIN กว้างขึ้น → ดึงใบที่คะแนนใกล้กันเข้ากลุ่มหมุนเวียนได้มากขึ้น (เดิม gap เกิน MARGIN default จะไม่เข้ากลุ่ม)', async () => {
  // REF-A: matchNewsType hit (+3) + fidelity grade A score 92 (+2) = 5 · REF-B: matchNewsType hit เหมือนกัน (+3)
  //   + fidelity grade C score 60 (+0) = 3 → gap = 2 > MARGIN default(1) → ปกติ REF-B หลุดกลุ่ม (REF-A ชนะเดี่ยว)
  //   ตั้ง MARGIN=2 (>= gap) ให้ REF-B เข้ากลุ่มหมุนเวียนได้ (candidates filter ใช้ >= bestScore-MARGIN)
  const dnaA = structuredClone(BASE_DNA);
  delete dnaA._humanVerified; dnaA._reproducible = true; dnaA.matchNewsType = ['กตัญญู']; dnaA._fidelity = { score: 92, confidence: 'ok', worstOffsetPx: 5 };
  const refA = { id: 'REF-A', imagePath: '/ref-covers/REF-A.jpg', dna: dnaA };
  const dnaB = structuredClone(BASE_DNA);
  delete dnaB._humanVerified; dnaB._reproducible = true; dnaB.matchNewsType = ['กตัญญู']; dnaB._fidelity = { score: 60, confidence: 'ok', worstOffsetPx: 20 };
  const refB = { id: 'REF-B', imagePath: '/ref-covers/REF-B.jpg', dna: dnaB };
  globalThis.__RCR_POOL = [refA, refB];
  const signals = { text: [refCategoryHint('กตัญญู/ครอบครัวอบอุ่น'), 'ลูกดูแลแม่ยามแก่เฒ่า'].join(' '), emotion: '' };

  delete process.env.MEGA_REF_VARIETY_MARGIN;
  const defaultResult = await pickBestRef(signals);
  assert.equal(defaultResult.ref.id, 'REF-A', 'default MARGIN=1: gap 2 > 1 → REF-A ชนะเดี่ยว');
  assert.ok(!/สุ่ม/.test(defaultResult.reason));

  process.env.MEGA_REF_VARIETY_MARGIN = '2';
  try {
    const widerResult = await pickBestRef(signals);
    assert.match(widerResult.reason, /สุ่ม 1\/2/, 'MARGIN=2: gap 2 <= 2 → ทั้งสองใบต้องอยู่กลุ่มหมุนเวียนเดียวกัน');
  } finally {
    delete process.env.MEGA_REF_VARIETY_MARGIN;
  }
});

test('MARGIN: ค่า env พังรูปแบบ (ไม่ใช่ตัวเลข/ติดลบ) → fallback MARGIN=1 ค่าเดิม (fail-safe)', async () => {
  const refHit = mkRef('REF-HIT2', { matchNewsType: ['กตัญญู'] });
  const refMiss = mkRef('REF-MISS2', { matchNewsType: ['ไม่เกี่ยวอะไรเลย'] });
  globalThis.__RCR_POOL = [refHit, refMiss];
  const signals = { text: [refCategoryHint('กตัญญู/ครอบครัวอบอุ่น'), 'ลูกดูแลแม่ยามแก่เฒ่า'].join(' '), emotion: '' };
  for (const badVal of ['abc', '-5', '']) {
    process.env.MEGA_REF_VARIETY_MARGIN = badVal;
    try {
      const result = await pickBestRef(signals);
      assert.equal(result.ref.id, 'REF-HIT2', `ค่าพังรูปแบบ (${JSON.stringify(badVal)}) ต้อง fallback MARGIN=1 (ผู้ชนะเดียวเหมือนเดิม)`);
    } finally {
      delete process.env.MEGA_REF_VARIETY_MARGIN;
    }
  }
});
