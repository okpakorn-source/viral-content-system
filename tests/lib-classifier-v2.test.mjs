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

// ═══════════════════════════════════════════════════════════════════════════════════
// 🧭 3 ก.ย. 69 (R234-ค) — บริบทตัวจำแนก conflictTags/humanAngles + สวิตช์ LIB_CLASSIFIER_CONTEXT
// ตัวจำแนก V2 รับ conflictTags/humanAngles อยู่แล้ว (ขั้น 2 รูปเรื่อง) — ของใหม่คือ "ประตูส่งของ"
// buildLibClassifierContext ใน promptMatcher.js (อ่านสวิตช์จุดเดียว) + จุดเรียก summarizeServiceText
// spread ก้อนนี้เข้า getViralFewshotBlock — ปิดสวิตช์/ไม่มีข้อมูล = ก้อนว่าง = อาร์กิวเมนต์เดิมทุกไบต์
// promptMatcher import '@/lib/ai/semanticClusters' (alias ของ Next ที่ node เปล่าไม่รู้จัก) → โหลดผ่าน
// resolve hook แบบเดียวกับ tests/ai-honesty-dna.test.mjs แล้ว dynamic import ในบล็อก try
// (ห้าม import promptMatcher ระดับบนไฟล์ — alias ล้มจะพาทั้งไฟล์เทสล้มไปด้วย)
// ═══════════════════════════════════════════════════════════════════════════════════
const { register } = await import('node:module');
const _SRC_ROOT = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return nextResolve(new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(_SRC_ROOT)}).href, context);
  }
  return nextResolve(specifier, context);
}`));
let PM = null, PM_ERR = '';
try { PM = await import('../src/lib/services/promptMatcher.js'); } catch (e) { PM_ERR = String((e && e.message) || e); }
const _pm = () => { assert.ok(PM && typeof PM.buildLibClassifierContext === 'function', `โหลด promptMatcher จริงไม่ได้ (ห้ามก๊อปฟังก์ชันมาเทส): ${PM_ERR}`); return PM; };

// ── เคสสนามจริง: news-r233-run/result-P2fix-บันเทิง-05233.json (breakdown จริงจากท่อ TEXT, คัดลอกตรงตัว) ──
// ป้ายหมวดหลักไม่แมปตาราง → ของเดิมตกขั้น 3 เป็น 'ข่าวเศร้า' เพราะคำ 'สูญเสีย' ในแท็กอารมณ์
// ทั้งที่เรื่องจริงคือคู่ชีวิต/ครอบครัวประคองกันช่วงผ่าตัด → ที่ตั้งใจคือ 'ดราม่าครอบครัว'
const FIELD_05233 = {
  category: 'ความรักและชีวิตคู่ในช่วงเจ็บป่วย',
  emotionalTags: ['ซาบซึ้ง', 'เป็นห่วง', 'หวาดกลัวการสูญเสีย', 'อบอุ่น', 'เหนื่อยแต่ไม่ยอมปล่อยมือ'],
  archetype: 'คู่ชีวิตจับมือกันผ่านวันที่หนักที่สุด',
};
const FIELD_05233_CTX = {
  conflictTags: ['ความไม่แน่นอนของอาการป่วยกับอนาคตครอบครัว', 'ความเหนื่อยของผู้ดูแลกับหน้าที่ประคองคนรัก', 'ความกลัวการสูญเสียกับการพยายามเข้มแข็ง'],
  humanAngles: ['การอยู่ข้างคนรักในวันที่ต้องเข้ารับการผ่าตัด', 'ความกลัวของสามีระหว่างนั่งรอหน้าห้องผ่าตัด', 'ภาระทางใจของผู้ป่วยที่พูดน้อยลง นอนหลับยาก และคิดมาก', 'ความเหนื่อยของผู้ดูแลที่ยังต้องพยายามเข้มแข็ง', 'ความหมายของคู่ชีวิตในวันที่ชีวิตหนักที่สุด', 'ความห่วงลูกที่ยังเล็กเมื่อครอบครัวเผชิญความไม่แน่นอน'],
};
// ── เคสสร้าง "คีย์เวิร์ดหลอก/ป้ายไม่แมป" (ค่า conflictTags จาก enum จริงในพรอมต์ breakdown) ──
const LABOR = { category: 'เศรษฐกิจ', emotionalTags: ['โกรธ', 'เห็นใจ'], archetype: 'ลูกจ้างวัย 55 ถูกเลิกจ้างกะทันหันโดยไม่ได้รับเงินชดเชย' };
const LABOR_CTX = { conflictTags: ['การเอาเปรียบ', 'ความเหลื่อมล้ำ'] };
const CAFE = { category: 'ไลฟ์สไตล์', emotionalTags: ['ชื่นชม'], archetype: 'หนุ่มออฟฟิศลาออกมาเปิดร้านกาแฟเล็กๆ ของตัวเอง' };
const CAFE_CTX = { humanAngles: ['จุดเปลี่ยนของชีวิต', 'ความกล้าเริ่มต้นใหม่'] };
const RESCUE = { category: 'ทั่วไป', emotionalTags: ['เศร้า', 'ซึ้ง'], archetype: 'ชายชราเดินเก็บขยะกลางสายฝน' };
const RESCUE_CTX = { humanAngles: ['น้ำใจของคนแปลกหน้า'] };
// [ก่อน→หลัง] ทั้ง 4 เคส: หมวดต้อง "เปลี่ยนตามที่ตั้งใจ" เมื่อได้บริบท
const CTX_CASES = [
  ['สนาม 05233', FIELD_05233, FIELD_05233_CTX, 'ข่าวเศร้า', 'ดราม่าครอบครัว'],
  ['แรงงานถูกเอาเปรียบ', LABOR, LABOR_CTX, null, 'moral conflict'],
  ['ลาออกเปิดร้านกาแฟ', CAFE, CAFE_CTX, null, 'พลิกชีวิต'],
  ['ฝนตกมีคนช่วย', RESCUE, RESCUE_CTX, 'ข่าวเศร้า', 'ช่วยเหลือกัน'],
];

test('🧭 มี context → หมวดเปลี่ยนตามที่ตั้งใจ (เคสสนามจริง 1 + เคสคีย์เวิร์ดหลอก 3) · ไม่มี context = ผลเดิม', () => {
  for (const [name, base, ctx, before, after] of CTX_CASES) {
    assert.equal(pickLibraryCategoryV2(base), before, `${name}: ไม่มี context ต้องได้ ${before}`);
    assert.equal(pickLibraryCategoryV2({ ...base, ...ctx }), after, `${name}: มี context ต้องได้ ${after}`);
  }
});

test('🧭 buildLibClassifierContext (ค่าเริ่มต้นเปิด): spread เข้าตัวจำแนกจริงแล้วได้หมวดใหม่ครบ 4 เคส', () => {
  const { buildLibClassifierContext } = _pm();
  withEnv('LIB_CLASSIFIER_CONTEXT', undefined, () => {
    for (const [name, base, ctx, , after] of CTX_CASES) {
      const built = buildLibClassifierContext(ctx);
      assert.equal(pickLibraryCategoryV2({ ...base, ...built }), after, `${name}: ผ่านประตูแล้วต้องได้ ${after}`);
    }
    // คืนเฉพาะช่องที่มีค่า — ช่องที่ไม่ได้ส่ง/ว่าง ห้ามโผล่ไปทับ default ปลายทาง
    assert.deepEqual(buildLibClassifierContext(LABOR_CTX), { conflictTags: LABOR_CTX.conflictTags });
    assert.deepEqual(buildLibClassifierContext({ conflictTags: [], humanAngles: [] }), {});
    assert.deepEqual(buildLibClassifierContext({}), {});
  });
});

test('🧭 ป้ายหมวดหลักยังชนะบริบทเสมอ (ขั้น 1 ก่อนขั้น 2) — บริบทห้ามลากข่าวกีฬาออกจากชั้นกีฬา', () => {
  const race = { category: 'กีฬา', emotionalTags: ['ภูมิใจ'], archetype: 'นักวิ่งหนุ่มคว้าแชมป์มาราธอน' };
  assert.equal(pickLibraryCategoryV2(race), 'ข่าวกีฬา');
  assert.equal(pickLibraryCategoryV2({ ...race, humanAngles: ['ครอบครัวหนุนหลัง'], conflictTags: ['ความยากจนกับความฝัน'] }), 'ข่าวกีฬา', 'มีบริบทครอบครัว/สู้ชีวิต ป้ายกีฬาก็ยังชนะ');
});

test('🧭 สวิตช์ LIB_CLASSIFIER_CONTEXT: =0 ตรงตัว → {} ทุกอินพุต = อาร์กิวเมนต์เดิมทุกไบต์ · ไม่ตั้ง/1/off = เปิด', () => {
  const { buildLibClassifierContext, libClassifierContextOn } = _pm();
  withEnv('LIB_CLASSIFIER_CONTEXT', '0', () => {
    assert.equal(libClassifierContextOn(), false);
    for (const [name, base, ctx, before] of CTX_CASES) {
      const built = buildLibClassifierContext(ctx);
      assert.deepEqual(built, {}, `${name}: =0 ต้องได้ก้อนว่าง`);
      assert.equal(pickLibraryCategoryV2({ ...base, ...built }), before, `${name}: =0 spread แล้วต้องเท่าผลเดิม (${before})`);
    }
  });
  withEnv('LIB_CLASSIFIER_CONTEXT', undefined, () => { assert.equal(libClassifierContextOn(), true); assert.ok(buildLibClassifierContext(LABOR_CTX).conflictTags, 'ไม่ตั้ง env = เปิด'); });
  withEnv('LIB_CLASSIFIER_CONTEXT', '1', () => assert.equal(libClassifierContextOn(), true));
  withEnv('LIB_CLASSIFIER_CONTEXT', 'off', () => assert.ok(buildLibClassifierContext(LABOR_CTX).conflictTags, "'off' ไม่ใช่ '0' ตรงตัว → ยังเปิด (แผนเดียวกับ LIB_CLASSIFIER_V2)"));
});

test('🧭 สายตัวเดิม (LIB_CLASSIFIER_V2=0) เมิน context สนิท — บริบทไม่รั่วไปเปลี่ยนพฤติกรรมทางถอย', () => {
  withEnv('LIB_CLASSIFIER_V2', '0', () => {
    for (const [name, base, ctx] of CTX_CASES) {
      assert.equal(resolveLibraryCategory({ ...base, ...ctx }), resolveLibraryCategory(base), `${name}: ตัวเดิมต้องได้ผลเดียวกันไม่ว่ามี context ไหม`);
      assert.equal(resolveLibraryCategory({ ...base, ...ctx }), pickLibraryCategory(base), `${name}: และต้องเท่าตัวเดิมเป๊ะ`);
    }
  });
});

test('🧭 ตัวล้างชนิดของประตู: สตริงเดี่ยว/ตัวเลข/null/ก้อนพิการ — ไม่โยน และคืนรูปที่ตัวจำแนกกินได้', () => {
  const { buildLibClassifierContext } = _pm();
  withEnv('LIB_CLASSIFIER_CONTEXT', undefined, () => {
    assert.deepEqual(buildLibClassifierContext({ conflictTags: 'การเอาเปรียบ', humanAngles: 7 }), { conflictTags: ['การเอาเปรียบ'], humanAngles: ['7'] });
    assert.deepEqual(buildLibClassifierContext({ conflictTags: [null, '', '  ', 'ความเหลื่อมล้ำ', { junk: 1 }] }), { conflictTags: ['ความเหลื่อมล้ำ'] });
    assert.deepEqual(buildLibClassifierContext(null), {});
    assert.deepEqual(buildLibClassifierContext('ขยะ'), {});
    // emotionalTags เป็นช่องเสริมตามสเปก — ส่งมาก็ผ่านประตูได้ (จุดเรียกจริงไม่ส่ง เพราะอาร์กิวเมนต์เดิมส่งอยู่แล้ว)
    assert.deepEqual(buildLibClassifierContext({ emotionalTags: ['เศร้า'] }), { emotionalTags: ['เศร้า'] });
  });
});

test('🧭 source contract: สวิตช์อ่านจุดเดียวใน promptMatcher + จุดเรียก summarizeServiceText spread _libCtx จริง', () => {
  const PM_SRC = readFileSync(new URL('../src/lib/services/promptMatcher.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(PM_SRC, /process\.env\.LIB_CLASSIFIER_CONTEXT !== '0'/u, 'สวิตช์รับเฉพาะ 0 ตรงตัว (default เปิด)');
  assert.equal((PM_SRC.match(/LIB_CLASSIFIER_CONTEXT/g) || []).length <= 3, true, 'อ่าน env จุดเดียว (ชื่อโผล่ได้แค่ในคอมเมนต์+จุดอ่าน)');
  const SST = readFileSync(new URL('../src/lib/services/summarizeServiceText.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(SST, /buildLibClassifierContext.*await import\('@\/lib\/services\/promptMatcher'\)|await import\('@\/lib\/services\/promptMatcher'\)[\s\S]{0,200}buildLibClassifierContext/u, 'จุดเรียกโหลดประตูจาก promptMatcher แบบ dynamic');
  assert.match(SST, /conflictTags: newsAnalysis\?\.conflictTags \|\| actualBreakdown\?\.conflictTags \|\| \[\]/u, 'บริบทมาจาก DNA จริง (newsAnalysis→breakdown)');
  assert.match(SST, /humanAngles: newsAnalysis\?\.humanAngles \|\| actualBreakdown\?\.humanAngles \|\| \[\]/u);
  assert.match(SST, /getViralFewshotBlock\(\{[\s\S]{0,1400}\.\.\._libCtx,/u, 'spread _libCtx เข้าอาร์กิวเมนต์ getViralFewshotBlock');
  assert.match(SST, /catch \{ _libCtx = \{\};/u, 'โหลดประตูล้ม = ก้อนว่าง ห้ามล้มท่อครู');
});
