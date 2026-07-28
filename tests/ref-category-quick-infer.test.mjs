// ============================================================
// 🎯 inferRefCategory + MEGA_REF_CAT_QUICK (29 ก.ค. 69, แบตช์ 2) — src/lib/refCoverMatch.js + megaAdapters.js
// ------------------------------------------------------------
// พิสูจน์จริงจากเจ้าของ: "compose เส้นทางลัด (mega/compose-test) ยังได้ ref ใบเดิม เพราะไม่มีสัญญาณหมวด" —
//   route.js สร้าง desk:{title: compass.angle} เปล่าๆ ไม่มี category เลย → refCategoryHint() คืน '' เสมอ
// แก้: inferRefCategory(text) — กลไกคำนวณล้วน (ตาราง keyword→11 หมวด เทียบ substring) ไม่มี LLM call เพิ่ม —
//   เป็น fallback เฉพาะตอน desk.category ว่างเท่านั้น (desk มีจริง = ชนะเสมอ ไม่แตะ) หลัง MEGA_REF_CAT_QUICK
//   (default ON, '0' = ปิด byte-parity เดิม)
// พิสูจน์: (ก) เนื้อจริงแนวคอร์ปัส (heroDesc/storyShape จาก _research-igdara-15k/analysis/all-478.json ยืนยัน
//   ธีมแล้ว — ประโยคเทสเป็นสำนวนหัวข่าวจริงที่ผู้เขียนสร้างให้ตรงธีมคอร์ปัส เพราะฟิลด์ในไฟล์เป็นบันทึกนักวิเคราะห์
//   เชิงองค์ประกอบภาพ ไม่ใช่ข้อความหัวข่าวดิบให้ก็อปมาทดสอบตรงๆ) → หมวดถูกต้อง (ข) เนื้อกำกวม/ไม่มีคำชี้ชัด → ''
//   (ค) desk.category มาก่อนเสมอ ไม่ให้ inferRefCategory ทับ (ง) flag ปิด → ไม่ทำงานเลย (byte-parity)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import fs from 'node:fs';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const STUB_REFLIB = _mod('export async function listRefCovers(n){ return []; }');

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

const { inferRefCategory, refCategoryHint, REF_CATEGORY_KEYWORDS } = await import('../src/lib/refCoverMatch.js');

// ============================================================
// (ก) เนื้อจริงแนวคอร์ปัส — ยืนยันธีมจาก _research-igdara-15k/analysis/all-478.json (contentType จริง) ก่อนเขียน
//   เทส: อาลัย(24 ใบ) / กตัญญู(25) / สู้ชีวิต(22) / น้ำใจคนดัง(44) / สัตว์(4) / ความยุติธรรม(25) ล้วนมีจริงในคลัง
// ============================================================
test('(ก) อาลัย: "แม่ค้าขนมวัย 86 ปี เสียชีวิตอย่างสงบ จากไปทิ้งรอยยิ้มไว้ในใจลูกค้า" → อาลัย', () => {
  assert.equal(inferRefCategory('แม่ค้าขนมวัย 86 ปี เสียชีวิตอย่างสงบ จากไปทิ้งรอยยิ้มไว้ในใจลูกค้า'), 'อาลัย');
});

test('(ก) กตัญญู: "สาวทำงาน 15 ปี ซื้อบ้านให้แม่ตอบแทนบุญคุณที่เลี้ยงดูมา" → กตัญญู', () => {
  assert.equal(inferRefCategory('สาวทำงาน 15 ปี ซื้อบ้านให้แม่ตอบแทนบุญคุณที่เลี้ยงดูมา'), 'กตัญญู');
});

test('(ก) สู้ชีวิต: "ไรเดอร์เอ็นขาดยังวิ่งงานหาเช้ากินค่ำเลี้ยงลูก" → สู้ชีวิต', () => {
  assert.equal(inferRefCategory('ไรเดอร์เอ็นขาดยังวิ่งงานหาเช้ากินค่ำเลี้ยงลูก'), 'สู้ชีวิต');
});

test('(ก) น้ำใจคนดัง: "ดารามอบเงินช่วยเหลือครอบครัวยากไร้หลังเห็นข่าว" → น้ำใจคนดัง', () => {
  assert.equal(inferRefCategory('ดารามอบเงินช่วยเหลือครอบครัวยากไร้หลังเห็นข่าว'), 'น้ำใจคนดัง');
});

test('(ก) สัตว์: "หมาจรจัดถูกทิ้งข้างวัด สุนัขผอมโซรอคนใจดีมารับไปเลี้ยง" → สัตว์', () => {
  assert.equal(inferRefCategory('หมาจรจัดถูกทิ้งข้างวัด สุนัขผอมโซรอคนใจดีมารับไปเลี้ยง'), 'สัตว์');
});

test('(ก) ความยุติธรรม: "เหยื่อแจ้งความดำเนินคดี ทนายเรียกร้องความเป็นธรรมให้ผู้เสียหาย" → ความยุติธรรม', () => {
  assert.equal(inferRefCategory('เหยื่อแจ้งความดำเนินคดี ทนายเรียกร้องความเป็นธรรมให้ผู้เสียหาย'), 'ความยุติธรรม');
});

// เพิ่มอีก 4 หมวดที่เหลือ (ครบ 10/11 ตามที่โจทย์ระบุคีย์เวิร์ดชัด)
test('(ก) ความรักคู่: "คู่รักแต่งงานครบรอบแต่ง 10 ปี ยังหวานเหมือนวันแรก" → ความรักคู่', () => {
  assert.equal(inferRefCategory('คู่รักแต่งงานครบรอบแต่ง 10 ปี ยังหวานเหมือนวันแรก'), 'ความรักคู่');
});

test('(ก) พลิกชีวิต: "อดีตนักร้องดังผันตัวทำนา วันนี้กลายเป็นเกษตรกรมีความสุข" → พลิกชีวิต', () => {
  assert.equal(inferRefCategory('อดีตนักร้องดังผันตัวทำนา วันนี้กลายเป็นเกษตรกรมีความสุข'), 'พลิกชีวิต');
});

test('(ก) เด็กดี: "เด็กเก็บเงินคืนเจ้าของ ครูชื่นชมนักเรียนทำดี" → เด็กดี', () => {
  assert.equal(inferRefCategory('เด็กเก็บเงินคืนเจ้าของ ครูชื่นชมนักเรียนทำดี'), 'เด็กดี');
});

test('(ก) ความรักครอบครัว: "พ่อลูกกอดกันน้ำตาซึม ครอบครัวอบอุ่นที่ทุกคนอิจฉา" → ความรักครอบครัว', () => {
  assert.equal(inferRefCategory('พ่อลูกกอดกันน้ำตาซึม ครอบครัวอบอุ่นที่ทุกคนอิจฉา'), 'ความรักครอบครัว');
});

// ============================================================
// (ข) เนื้อกำกวม / ไม่มีคำชี้ชัดหมวดไหนเลย → '' (ห้ามเดา)
// ============================================================
test('(ข) ข้อความทั่วไปไม่มีคำชี้ชัดหมวดไหนเลย → คืนค่าว่าง', () => {
  assert.equal(inferRefCategory('วันนี้อากาศดีมาก ผู้คนออกมาเดินเล่นที่สวนสาธารณะกันเยอะ'), '');
});

test('(ข) ข้อความว่างเปล่า/null/undefined → คืนค่าว่าง ไม่ throw', () => {
  assert.equal(inferRefCategory(''), '');
  assert.equal(inferRefCategory(null), '');
  assert.equal(inferRefCategory(undefined), '');
});

test('(ข) คำกว้างเดี่ยวๆ ที่ไม่ผูกหมวดพิเศษ (เช่น "ช่วยเหลือ" ลอยๆ ไม่มี anchor) → ไม่ชัด คืนค่าว่าง', () => {
  // "ช่วยเหลือ" เดี่ยวๆ ไม่ใช่ term ของหมวดไหนเลยในตาราง (ต้องมี anchor คู่ เช่น "ดารา+ช่วยเหลือ") — กันทายมั่ว
  assert.equal(inferRefCategory('มีคนช่วยเหลือกันในเหตุการณ์นี้'), '');
});

test('(ข) คะแนนเสมอกันระหว่าง 2 หมวด (มีคำชี้ชัดของทั้งคู่เท่ากัน) → ไม่เดา คืนค่าว่าง', () => {
  // "กตัญญู" (กตัญญู hit 1) ปนกับ "เสียชีวิต" (อาลัย hit 1) — คะแนนเท่ากันพอดี (1 vs 1) → ห้ามเดา
  assert.equal(inferRefCategory('กตัญญู เสียชีวิต'), '');
});

// ============================================================
// (ค) desk.category มาก่อนเสมอ — inferRefCategory ห้ามทับ (ทดสอบ pattern การประกอบที่ใช้จริงทั้ง 2 จุดเสียบ)
// ============================================================
function composeHintLikeCallSite(deskCategory, text, flagOn = true) {
  // จำลอง pattern เป๊ะที่ใช้จริงใน megaAdapters.js ทั้ง 2 จุด (S6 + S7 fallback) — ใช้ฟังก์ชันจริงทั้งคู่ ไม่ mock
  let hint = refCategoryHint(deskCategory);
  if (!hint && flagOn) hint = inferRefCategory(text);
  return hint;
}

test('(ค) desk.category ตรง mapping อยู่แล้ว (เช่น "กตัญญู/ครอบครัวอบอุ่น") → ใช้ของเดิมเสมอ ไม่เรียก/ไม่ให้ inferRefCategory ทับ', () => {
  // เนื้อความเป็นเรื่อง "อาลัย" ล้วนๆ (ถ้า infer เองจะได้ 'อาลัย') แต่ desk.category บอกว่าเป็น "กตัญญู/ครอบครัวอบอุ่น" อยู่แล้ว
  const text = 'คุณยายเสียชีวิตอย่างสงบ จากไปอย่างอบอุ่นในอ้อมกอดครอบครัว';
  assert.equal(inferRefCategory(text), 'อาลัย', 'sanity: ถ้า infer เองต้องได้อาลัย (พิสูจน์ว่าถ้าไม่กันไว้จะทับผิด)');
  const result = composeHintLikeCallSite('กตัญญู/ครอบครัวอบอุ่น', text, true);
  assert.equal(result, 'กตัญญู', 'desk.category ต้องชนะเสมอ ไม่ว่าเนื้อความจะชี้ไปหมวดอื่นแค่ไหน');
});

test('(ค) desk.category ว่าง → ตกไปใช้ inferRefCategory (flag ON)', () => {
  const result = composeHintLikeCallSite('', 'ไรเดอร์เอ็นขาดยังวิ่งงานหาเช้ากินค่ำ', true);
  assert.equal(result, 'สู้ชีวิต');
});

test('(ค) desk.category มีแต่ map ไม่เจอ (คำแปลก ไม่อยู่ใน DESK_TO_REF_CATEGORY) → refCategoryHint ว่าง → ตกไป infer ต่อ', () => {
  const result = composeHintLikeCallSite('หมวดที่ไม่มีในระบบ', 'ไรเดอร์เอ็นขาดยังวิ่งงานหาเช้ากินค่ำ', true);
  assert.equal(result, 'สู้ชีวิต', 'desk.category ที่ map ไม่เจอ ต้องปฏิบัติเหมือนว่างเปล่า (fallback ไป infer)');
});

// ============================================================
// (ง) flag ปิด (MEGA_REF_CAT_QUICK='0') → inferRefCategory ไม่ถูกเรียกเลยที่จุดเสียบ (byte-parity เดิม)
// ============================================================
test('(ง) flag ปิด: desk.category ว่าง + flag OFF → ไม่ตกไป infer เลย (คืนค่าว่างเหมือน HEAD เดิมก่อนแก้)', () => {
  const result = composeHintLikeCallSite('', 'ไรเดอร์เอ็นขาดยังวิ่งงานหาเช้ากินค่ำ', false);
  assert.equal(result, '', 'flag OFF ต้องพฤติกรรมเดิมทุก byte — ไม่มีสัญญาณหมวดเพิ่มเลย');
});

test('(ง) flag เปิด/ปิด ไม่กระทบกรณี desk.category มีอยู่แล้ว (เส้นทางเดิมไม่ถูกแตะเลยไม่ว่ากรณีใด)', () => {
  const text = 'ไรเดอร์เอ็นขาดยังวิ่งงานหาเช้ากินค่ำ';
  assert.equal(composeHintLikeCallSite('กตัญญู/ครอบครัวอบอุ่น', text, true), 'กตัญญู');
  assert.equal(composeHintLikeCallSite('กตัญญู/ครอบครัวอบอุ่น', text, false), 'กตัญญู');
});

// ============================================================
// ตรวจการเสียบจริงในซอร์ส megaAdapters.js — ยืนยันทั้ง 2 จุด (S6 + S7 fallback) เสียบ pattern เดียวกัน
//   จริง ไม่ใช่แค่ฟังก์ชันมีอยู่เฉยๆ (แพทเทิร์นเดียวกับ tests/candidate-hero-vision.test.mjs ที่อ่านซอร์สตรงเช็ค)
// ============================================================
test('เสียบจริงในซอร์ส: megaAdapters.js import inferRefCategory ครบ 2 จุด (S6 + S7 fallback)', () => {
  const src = fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  const importHits = src.match(/pickBestRef, refCategoryHint, inferRefCategory\s*}\s*=\s*await import\('@\/lib\/refCoverMatch'\)/g) || [];
  assert.equal(importHits.length, 2, 'ต้องมี 2 จุดเสียบ import inferRefCategory คู่กับ refCategoryHint เป๊ะ');
  const gateHits = src.match(/if \(!_catHint && process\.env\.MEGA_REF_CAT_QUICK !== '0'\)/g) || [];
  assert.equal(gateHits.length, 2, 'ต้องมีเงื่อนไข gate MEGA_REF_CAT_QUICK ครบ 2 จุดเสียบ');
});

// ============================================================
// ตารางคีย์เวิร์ด — ยืนยันครบ 11 หมวด + ไม่มีหมวดไหนว่างเปล่า
// ============================================================
test('REF_CATEGORY_KEYWORDS: ครบ 11 หมวดตามคัมภีร์ v3 — ไม่มีหมวดไหนว่าง (อย่างน้อย 1 คำต่อหมวด)', () => {
  const categories = Object.keys(REF_CATEGORY_KEYWORDS);
  assert.equal(categories.length, 11);
  for (const cat of categories) {
    assert.ok(REF_CATEGORY_KEYWORDS[cat].length >= 1, `${cat} ต้องมีคีย์เวิร์ดอย่างน้อย 1 คำ`);
  }
});
