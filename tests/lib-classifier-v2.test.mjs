// 🗂️ ข้อสอบตัวจำแนกหมวดหอสมุดครู V2 (LIB_CLASSIFIER_V2) — 2 ก.ย. 69
// รัน: node --test tests/lib-classifier-v2.test.mjs (ไม่ต้องตั้ง env — ข้อสอบตั้ง/ล้าง env เอง)
// import โค้ดจริงตรงๆ (ห้ามก๊อปฟังก์ชันมาเทส)
//
// ผลทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนโค้ดไบต์เดิม (ทำจริง 2 ก.ย. 69 ด้วย harness ที่คืนไบต์เดิม):
//   C1 คืน default ชั้นใหญ่ (ขั้น 4 return 'ดราม่าครอบครัว' แทน null)       → แดง 4 ข้อ (หลวงปู่ · ไม่มี default · อินพุตพิการ · สวิตช์)
//   C2 ให้หมวดหัวข้ออ่านจากประโยคโครงเรื่องด้วย (เติม 'เหรียญ' ใน LIB_V2_SHAPES ชั้นกีฬา) → แดง 2 ข้อ (หลวงปู่ · หมวดหัวข้อจากป้ายเท่านั้น)
//   C3 กลับสวิตช์ (`=== '0'`)                                                → แดง 2 ข้อ (สวิตช์ · source contract)
//   C4 ถอด 'การศึกษา' ออกจากตารางป้าย + 'เรียนจบ'/'ปริญญา' ออกจากรูปเรื่อง  → แดง 1 ข้อ (คุณยาย)
//   C5 ถอด 'กีฬา' ออกจากตารางป้าย                                           → แดง 1 ข้อ (แชมป์แข่งรถ)
//   C6 (ผู้ตรวจไขว้ 2 ก.ย. 69) เกราะ SUPABASE_DISABLED=1 ในข้อ getViralFewshotBlock — พิสูจน์ด้วย mock นับคำขอ + env ชี้ Supabase ไปที่ mock:
//      มีเกราะ = 0 คำขอ · ถอดเกราะ = GET /rest/v1/viral_examples 1 ครั้ง (ยิง DB จริงถ้าเชลล์มี .env.local) · harness: scratchpad/classifier-guard-proof.mjs
//   พฤติกรรมสวิตช์ =0 บนท่อจริง (สมุดจดหมวด 'ดราม่าครอบครัว' · ค่าเริ่มต้นจด null) อยู่ที่ tests/teacher-rank-v2.test.mjs ข้อ 13ก/13ง
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pickLibraryCategory, pickLibraryCategoryV2, resolveLibraryCategory, LIB_SHELVES, getViralFewshotBlock,
} from '../src/lib/services/viralFewshot.js';

const SRC = readFileSync(new URL('../src/lib/services/viralFewshot.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ตั้ง/ล้าง env แบบคืนสภาพเสมอ
const withEnv = (name, value, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const old = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return fn(); } finally { if (had) process.env[name] = old; else delete process.env[name]; }
};

// ═══ เคสจริงจากสมุดประวัติ 2 ก.ย. 69 (breakdown สาย TEXT ให้ primaryCategory ป้ายสั้น + archetype เป็นประโยคอิสระ) ═══
// ① หลวงปู่ศิลามอบทองคำ 16 บาท สร้างเหรียญที่ระลึก — ของเดิมตกชั้น 'ข่าวกีฬา' เพราะคำ 'เหรียญ' ในประโยคโครงเรื่อง
const LUANGPU = [
  { category: 'ศาสนา', emotionalTags: ['ศรัทธา', 'ซาบซึ้ง', 'ชื่นชม'], archetype: 'พระเกจิมอบทองคำให้จัดสร้างเหรียญที่ระลึกเพื่อสาธุชน' },
  { category: 'สังคม', emotionalTags: ['ศรัทธา', 'ชื่นชม'], archetype: 'พระเกจิมอบทองคำให้จัดสร้างเหรียญที่ระลึก', humanAngles: ['การให้โดยไม่หวังสิ่งตอบแทน'] },
  { category: 'สังคม', emotionalTags: ['ชื่นชม'], archetype: 'พระเกจิมอบทองคำให้จัดสร้างเหรียญที่ระลึก' },
];
// ② คุณยายเรียนจบปริญญาตรี — ของเดิมไม่ตรงคีย์ไหน → ตก default 'ดราม่าครอบครัว'
const YAI = [
  { category: 'การศึกษา', emotionalTags: ['ชื่นชม', 'ภูมิใจ', 'อบอุ่น'], archetype: 'คุณยายวัย 72 เรียนจบปริญญาตรีสมใจ' },
  { category: 'สังคม', emotionalTags: ['ชื่นชม', 'ประทับใจ'], archetype: 'คุณยายวัย 72 ไม่ยอมแพ้ เรียนจบปริญญาตรีสมใจ' },
];
// ③ ดาราคว้าแชมป์แข่งรถ 2 รุ่น
const RACE = { category: 'กีฬา', emotionalTags: ['ภูมิใจ', 'ชื่นชม'], archetype: 'ดาราสาวพิสูจน์ตัวเองบนสนามแข่งรถจนคว้าแชมป์ 2 รุ่น' };

test('① หลวงปู่มอบทองคำ: V2 ต้องไม่ใช่ ข่าวกีฬา — ได้ ช่วยเหลือกัน (ชั้นที่มีธีมพระสงฆ์/ศรัทธา/การให้) หรือ null', () => {
  for (const c of LUANGPU) {
    const v2 = pickLibraryCategoryV2(c);
    assert.notEqual(v2, 'ข่าวกีฬา', `V2 ห้ามตกชั้นกีฬา: ${JSON.stringify(c)}`);
    assert.ok(v2 === null || v2 === 'ช่วยเหลือกัน', `ต้องเป็น ช่วยเหลือกัน หรือ null แต่ได้ ${v2}`);
  }
  assert.equal(pickLibraryCategoryV2(LUANGPU[0]), 'ช่วยเหลือกัน', 'ป้าย ศาสนา → ช่วยเหลือกัน');
  assert.equal(pickLibraryCategoryV2(LUANGPU[1]), 'ช่วยเหลือกัน', 'humanAngles "การให้" → ช่วยเหลือกัน');
  assert.equal(pickLibraryCategoryV2(LUANGPU[2]), null, 'ไม่มีสัญญาณชั้นไหน → null (ไม่ให้โบนัสหมวดใคร)');
  // ข้อสอบนี้กัดของจริง: ตัวเดิมตกชั้นกีฬาทั้ง 3 แบบ (ถ้าวันหน้าใครแก้ตัวเดิม บรรทัดนี้จะบอก)
  for (const c of LUANGPU) assert.equal(pickLibraryCategory(c), 'ข่าวกีฬา', 'ตัวเดิม (บั๊กที่แก้) = ข่าวกีฬา');
});

test('② คุณยายเรียนจบ ป.ตรี: V2 → สู้ชีวิต หรือ พลิกชีวิต (ไม่ใช่ ดราม่าครอบครัว)', () => {
  for (const c of YAI) {
    const v2 = pickLibraryCategoryV2(c);
    assert.ok(['สู้ชีวิต', 'พลิกชีวิต'].includes(v2), `ได้ ${v2}: ${JSON.stringify(c)}`);
    assert.equal(pickLibraryCategory(c), 'ดราม่าครอบครัว', 'ตัวเดิม (บั๊กที่แก้) = default ชั้นครอบครัว');
  }
});

test('③ แชมป์แข่งรถ: V2 → ข่าวกีฬา (อ่านหมวดหัวข้อจากป้ายหมวดหลัก)', () => {
  assert.equal(pickLibraryCategoryV2(RACE), 'ข่าวกีฬา');
  assert.equal(pickLibraryCategoryV2({ category: 'มอเตอร์สปอร์ต', archetype: 'นักแข่งหน้าใหม่คว้าแชมป์' }), 'ข่าวกีฬา');
  assert.equal(pickLibraryCategoryV2({ category: 'นักกีฬาทีมชาติคว้าเหรียญ' }), 'ข่าวกีฬา', 'ป้ายยาวที่ขึ้นต้นด้วยคำกีฬา');
});

test('ไม่มี default ชั้นใหญ่: แมปไม่ได้ต้องคืน null (ตัวเดิมคืน ดราม่าครอบครัว)', () => {
  assert.equal(pickLibraryCategoryV2({ category: 'xyz' }), null);
  assert.equal(pickLibraryCategoryV2({}), null);
  assert.equal(pickLibraryCategoryV2({ category: 'กฎหมายใหม่มีผลบังคับใช้' }), null, 'กฎหมาย ไม่ใช่ หมา (เกราะเดิม) และไม่ตก default');
  assert.equal(pickLibraryCategory({ category: 'xyz' }), 'ดราม่าครอบครัว', 'ตัวเดิมยังมี default (ไว้ให้สวิตช์ =0 ถอยได้)');
});

test('หมวดหัวข้อ (กีฬา/การเมือง/บันเทิง/สัตว์) อ่านจากป้ายหมวดหลักเท่านั้น — คำนามในประโยคโครงเรื่องไม่ทำให้ตกชั้น', () => {
  assert.notEqual(pickLibraryCategoryV2({ category: 'สังคม', archetype: 'ชาวบ้านมอบเหรียญทองให้ทีมชาติ' }), 'ข่าวกีฬา');
  assert.notEqual(pickLibraryCategoryV2({ category: 'สังคม', archetype: 'ดาราดังช่วยเหลือชาวบ้าน' }), 'ข่าวบันเทิง');
  assert.equal(pickLibraryCategoryV2({ category: 'สังคม', archetype: 'ดาราดังช่วยเหลือชาวบ้าน' }), 'ช่วยเหลือกัน', 'รูปเรื่อง "ช่วยเหลือ" ยังอ่านได้');
});

test('ชื่อชั้นตรงตัว 14 ชั้น (การ์ด/สายเก่าส่งชื่อชั้นมาเอง) → ชั้นนั้น ทั้งทาง category และ archetype', () => {
  assert.equal(LIB_SHELVES.length, 14);
  for (const lib of LIB_SHELVES) {
    assert.equal(pickLibraryCategoryV2({ category: lib }), lib);
    assert.equal(pickLibraryCategoryV2({ category: 'สังคม', archetype: lib }), lib);
  }
});

test('ลำดับขั้น: ป้ายหมวดหลักชนะรูปเรื่อง · รูปเรื่องชนะอารมณ์ · อารมณ์เศร้าอย่างเดียว → ข่าวเศร้า', () => {
  assert.equal(pickLibraryCategoryV2({ category: 'ครอบครัวและความทรงจำ', emotionalTags: ['อบอุ่น', 'อาลัย'], archetype: 'ลูกชายย้อนความทรงจำถึงพ่อผู้จากไป' }), 'ดราม่าครอบครัว', 'คำหน้าสุดของป้ายชนะ');
  assert.equal(pickLibraryCategoryV2({ category: 'ทั่วไป', emotionalTags: ['เศร้า', 'ซึ้ง'], archetype: 'หนุ่มรอแฟนที่สถานีทั้งคืน' }), 'ข่าวเศร้า');
  assert.equal(pickLibraryCategoryV2({ category: 'ทั่วไป', emotionalTags: ['เศร้า'], archetype: 'ลูกกตัญญูดูแลแม่ป่วยติดเตียง' }), 'ดราม่าครอบครัว', 'รูปเรื่องมาก่อนอารมณ์');
  assert.equal(pickLibraryCategoryV2({ category: 'อาชญากรรม', emotionalTags: ['โกรธ'], archetype: 'ผู้ถูกกระทำ' }), 'ข่าวเตือนใจ', 'อาชญากรรม มีทางเข้าแล้ว (ตัวเดิมตกชั้นครอบครัว)');
});

test('ทนอินพุตพิการทุกช่อง (null / สตริงเดี่ยว / ตัวเลข) — ไม่โยน', () => {
  assert.equal(pickLibraryCategoryV2(null), null);
  assert.equal(pickLibraryCategoryV2({ emotionalTags: 'เศร้า' }), 'ข่าวเศร้า');
  assert.equal(pickLibraryCategoryV2({ category: 5, emotionalTags: 7, archetype: null, humanAngles: 'การให้', conflictTags: undefined }), 'ช่วยเหลือกัน');
});

// ═══ สวิตช์ LIB_CLASSIFIER_V2 — รับเฉพาะ '0' ตรงตัว = ถอยตัวเดิมทุกเคส ═══
test('สวิตช์: ไม่ตั้ง/ตั้ง 1/ค่าอื่น = V2 · ตั้ง "0" ตรงตัว = ตัวเดิมเป๊ะ (รวม default ชั้นใหญ่)', () => {
  const inputs = [...LUANGPU, ...YAI, RACE, { category: 'xyz' }, { category: 'ทั่วไป', emotionalTags: ['สุนัข', 'อบอุ่น'] }];
  withEnv('LIB_CLASSIFIER_V2', undefined, () => {
    for (const c of inputs) assert.equal(resolveLibraryCategory(c), pickLibraryCategoryV2(c), 'ไม่ตั้ง env = V2');
    assert.equal(resolveLibraryCategory({ category: 'xyz' }), null);
  });
  withEnv('LIB_CLASSIFIER_V2', '1', () => { for (const c of inputs) assert.equal(resolveLibraryCategory(c), pickLibraryCategoryV2(c)); });
  withEnv('LIB_CLASSIFIER_V2', 'off', () => { assert.equal(resolveLibraryCategory({ category: 'xyz' }), null, "'off' ไม่ใช่ '0' ตรงตัว → ยังเป็น V2"); });
  withEnv('LIB_CLASSIFIER_V2', '0', () => {
    for (const c of inputs) assert.equal(resolveLibraryCategory(c), pickLibraryCategory(c), `=0 ต้องเท่าตัวเดิม: ${JSON.stringify(c)}`);
    assert.equal(resolveLibraryCategory({ category: 'xyz' }), 'ดราม่าครอบครัว', '=0 คืน default ชั้นใหญ่แบบเดิม');
    assert.equal(resolveLibraryCategory(LUANGPU[0]), 'ข่าวกีฬา', '=0 คืนบั๊กเดิม (พิสูจน์ว่าสวิตช์ถอยจริง)');
  });
});

// ═══ ต่อสายใน getViralFewshotBlock: รับ null ได้ ไม่พัง + สัญญาระดับ source ═══
// (พฤติกรรมสวิตช์ =0 บนท่อจริงกับ PostgREST จำลอง — สมุดจดหมวดตัวเดิม 'ดราม่าครอบครัว' — อยู่ที่ tests/teacher-rank-v2.test.mjs ข้อ 13ง)
// ตั้ง/ล้าง env หลายตัวแบบรอ async ให้จบก่อนคืนสภาพ (withEnv ตัวบนคืนสภาพทันทีที่ได้ promise — ใช้กับฟังก์ชัน async ไม่ได้)
const withEnvAsync = async (vars, fn) => {
  const saved = Object.entries(vars).map(([name]) => [name, Object.prototype.hasOwnProperty.call(process.env, name), process.env[name]]);
  for (const [name, value] of Object.entries(vars)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  try { return await fn(); } finally { for (const [name, had, old] of saved) { if (had) process.env[name] = old; else delete process.env[name]; } }
};
test('getViralFewshotBlock: หมวด null (V2) ไม่โยน — ยังได้ Style Pack (กัน Supabase จริงด้วย SUPABASE_DISABLED=1 เฉพาะข้อนี้)', async () => {
  // ผู้ตรวจไขว้ 2 ก.ย. 69: ถ้าเชลล์มี NEXT_PUBLIC_SUPABASE_URL/KEY (export จาก .env.local) ข้อนี้จะยิง DB จริง → ปิดด้วย SUPABASE_DISABLED=1 แล้วถอนคืนหลังเทส
  const out = await withEnvAsync({ LIB_CLASSIFIER_V2: undefined, SUPABASE_DISABLED: '1' }, () => getViralFewshotBlock({ category: 'xyz', emotionalTags: [], archetype: '', noHistory: true }));
  assert.equal(typeof out, 'string');
  assert.ok(out.includes('VIRAL STYLE PACK'), 'ต้องได้ Style Pack แม้ไม่มีหมวด');
  assert.ok(!out.includes('=== 📚'), 'ห้ามมีบล็อกครู — พิสูจน์ว่าไม่ได้อ่านคลังจาก DB จริง');
});

test('source contract: จุดเรียกใช้ resolveLibraryCategory (ประตูสวิตช์จุดเดียว) และมีเกราะ noShelf กัน .eq(category, null)', () => {
  assert.match(SRC, /const libCat = resolveLibraryCategory\(\{ category, emotionalTags, archetype, conflictTags, humanAngles \}\)/u);
  assert.match(SRC, /const noShelf = libCat == null;/u);
  assert.match(SRC, /const wide = mode \|\| shortlistOn \|\| noShelf;/u);
  assert.match(SRC, /crossCat = \(shortlistOn && !pool\.length\) \|\| noShelf/u, 'หัวบล็อกห้ามประกาศหมวดที่ไม่มี');
  assert.match(SRC, /process\.env\.LIB_CLASSIFIER_V2 !== '0'/u, 'สวิตช์รับเฉพาะ 0 ตรงตัว');
  // ตัวเดิมยังอยู่ครบ (ทางถอย) — ห้ามลบ
  assert.match(SRC, /return best \|\| 'ดราม่าครอบครัว';/u);
});
