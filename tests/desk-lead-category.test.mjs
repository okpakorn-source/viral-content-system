// ============================================================
// 🧪 เทสตัวจัดหมวดลีด (2 ส.ค. 69) — เจ้าของสั่ง "หมวดหมู่การแสดงผลข่าวให้ชัด"
// ------------------------------------------------------------
// สาระที่ต้องพิสูจน์:
//   ① ผลจาก AI (extract.insight.category) ต้องชนะการเทียบคำเสมอ
//   ② archetype จริงบนโต๊ะ (ที่พบบ่อยสุด 8 อัน) ต้องเข้าหมวดที่คนอ่านแล้วเห็นด้วย
//   ③ 🔴 เดาไม่ได้ต้องบอกว่า "ยังไม่จัดหมวด" — ห้ามยัดลงหมวดใดหมวดหนึ่งให้ดูเหมือนรู้
//   ④ ป้ายอมตะ/กระแส ผูกกับหมวดเท่านั้น · หมวดกำกวม (คนดัง) ต้องไม่ติดป้าย
//   ⑤ ของพัง/ว่าง ต้องไม่ throw (การ์ดห้ามจอขาวเพราะป้ายหมวด)
// ไม่มี AI · ไม่มีเน็ต — เทียบคำล้วน
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { categorizeLead, freshTagOf, countByCategory, LEAD_CATEGORIES, UNKNOWN_CATEGORY } =
  await import('../src/lib/services/deskV2/leadCategory.js');

// ── ① ผลจาก AI ชนะเสมอ ──
test('① AI เคยตัดสินไว้ (insight.category) → ใช้อันนั้น ไม่ต้องเทียบคำ', () => {
  const lead = {
    clusterArchetype: 'ดาราคนดังโดนดราม่าถล่มหนัก ทัวร์ลง', // คำพวกนี้ชี้ไป drama
    extract: { insight: { category: 'น้ำใจ/ทำดี' } },       // แต่ AI บอกว่าน้ำดี
  };
  const c = categorizeLead(lead);
  assert.equal(c.key, 'namdee', 'ต้องเชื่อผล AI ไม่ใช่คำในหัวข้อ');
  assert.equal(c.source, 'ai');
});

test('① หมวด AI ที่ไม่รู้จัก → ตกไปเทียบคำตามปกติ (ไม่พัง ไม่เงียบ)', () => {
  const c = categorizeLead({ clusterArchetype: 'หนุ่มบริจาคเงินระดมทุนค่าผ่าตัด', extract: { insight: { category: 'หมวดประหลาด' } } });
  assert.equal(c.key, 'help');
  assert.equal(c.source, 'keyword');
});

// ── ② archetype จริงจากคลัง (นับจากลีด 274 ใบ) ──
const REAL = [
  ['ดาราที่ไม่ได้ใช้เงินกับความหรู แต่ทุ่มรายได้ดูแลครอบครัว', 'namdee'],
  ['ลูกสาวคนดังผู้เป็นเดอะแบกครอบครัว ถูกกดปมมานาน', 'namdee'],
  ['เศรษฐีใจบุญจากจุดเริ่มต้นเล็กๆ ตอบแทนสังคมด้วยเงินก้อนใหญ่', 'namdee'],
  ['เด็กชนบทฐานะยากจนออกจากบ้านไปสู้ชีวิตในเมืองใหญ่', 'commoner'],
  ['คำสารภาพรักแบบเจ็บลึก ไม่เช็กมือถือไม่ใช่เพราะไว้ใจ', 'interview'],
  ['คู่รักคนดังผ่านมรสุมยาวนาน แต่ยังยึดครอบครัวไว้ได้', 'celeb'],
];
for (const [archetype, want] of REAL) {
  test(`② "${archetype.slice(0, 26)}…" → ${want}`, () => {
    assert.equal(categorizeLead({ clusterArchetype: archetype }).key, want);
  });
}

// ── ③ เดาไม่ได้ = ต้องบอกตรงๆ ──
test('③ ข้อความที่ไม่เข้าหมวดไหนเลย → ยังไม่จัดหมวด (ห้ามยัดลงหมวดมั่ว)', () => {
  const c = categorizeLead({ clusterArchetype: 'ผู้สมัครการเมืองเสนอนโยบายงบประมาณรอบใหม่' });
  assert.equal(c.key, 'unknown');
  assert.equal(c.label, UNKNOWN_CATEGORY.label);
});

test('③ เจอคำบอกใบ้คำเดียว (คะแนนไม่ถึงเกณฑ์) → ยังไม่จัดหมวด', () => {
  const c = categorizeLead({ clusterArchetype: 'เรื่องเล่าจากรายการหนึ่ง' }); // 'รายการ' = weak 1 คะแนน
  assert.equal(c.key, 'unknown', 'คะแนน 1 ต้องไม่พอ — ต้องมีหลักฐานมากกว่านี้');
});

// ── ④ ป้ายอมตะ/กระแส ──
test('④ ดราม่า → 🔥 กระแส · ช่วยเหลือ → ♾️ อมตะ · คนดัง → ไม่ติดป้าย', () => {
  assert.equal(freshTagOf({ clusterArchetype: 'ดราม่าเดือด ทัวร์ลงหนัก' })?.key, 'trend');
  assert.equal(freshTagOf({ clusterArchetype: 'ระดมทุนบริจาคค่าผ่าตัดให้เด็ก' })?.key, 'timeless');
  assert.equal(freshTagOf({ clusterArchetype: 'คู่รักคนดังผ่านมรสุมยาวนาน แต่ยังยึดครอบครัวไว้ได้' }), null,
    'คนดังมีทั้งอมตะและกระแส — ต้องไม่ติดป้ายมั่ว');
  assert.equal(freshTagOf({ clusterArchetype: 'เรื่องอะไรก็ไม่รู้' }), null, 'ไม่รู้หมวด = ไม่ติดป้าย');
});

// ── ⑤ ของพัง/ว่าง ต้องไม่ throw ──
test('⑤ ของว่าง/พัง → คืน "ยังไม่จัดหมวด" ไม่ throw (การ์ดห้ามจอขาว)', () => {
  for (const bad of [null, undefined, {}, { clusterArchetype: '' }, 'ไม่ใช่ออบเจกต์', 123, { extract: null }]) {
    const c = categorizeLead(bad);
    assert.equal(c.key, 'unknown');
  }
});

test('⑤ นับต่อหมวด: คืนครบทุกคีย์ (รวม 0) และผลรวมเท่าจำนวนลีด', () => {
  const leads = [
    { clusterArchetype: 'ระดมทุนบริจาคค่าผ่าตัด' },
    { clusterArchetype: 'ดราม่าเดือด ทัวร์ลง' },
    { clusterArchetype: 'อะไรสักอย่างที่ไม่เข้าหมวด' },
  ];
  const n = countByCategory(leads);
  for (const c of LEAD_CATEGORIES) assert.ok(typeof n[c.key] === 'number', `ต้องมีคีย์ ${c.key} เสมอ (ปุ่มกรองจะได้ไม่หาย)`);
  assert.equal(Object.values(n).reduce((a, b) => a + b, 0), 3, 'ผลรวมต้องเท่าจำนวนลีด — ห้ามนับซ้ำ/ตกหล่น');
  assert.equal(n.help, 1);
  assert.equal(n.drama, 1);
  assert.equal(n.unknown, 1);
});

test('⑤ countByCategory ของพัง → ไม่ throw', () => {
  assert.doesNotThrow(() => countByCategory(null));
  assert.doesNotThrow(() => countByCategory('ไม่ใช่อาเรย์'));
});
