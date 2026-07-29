// ============================================================
// 🧪 keywords-dream-schema.test.mjs — validateKeywordsV1Structure รองรับ dream_shot_queries (optional)
// ------------------------------------------------------------
// บริบท: lane2 เฟส A ข้อ 2 (29 ก.ค. 69 — ปิดเงื่อนไข Opus) — keywordPrompt.js's dormant dreamBlock สั่ง AI เติม
//   คีย์ "dream_shot_queries" เมื่อ compass.visualDreamShots ไม่ว่าง แต่ guardExactObject (s5PinnedAi.js) เดิม
//   เช็คจำนวนคีย์ตรงเป๊ะ — ถ้าไม่รองรับ คำตอบที่มีคีย์นี้จะโดนตัดเป็น SCHEMA_VALIDATION_FAILED ทันที
// พิสูจน์: (a) คำตอบเก่า (ไม่มีคีย์นี้เลย) ผ่านเหมือนเดิมทุกไบต์ — out.dream_shot_queries เติม [] ให้ (ไม่ throw/ไม่พัง)
//   (b) คำตอบใหม่ (มีคีย์นี้ ค่าถูกต้อง) ผ่าน + ค่าจริงถูกส่งกลับ (c) คำตอบใหม่ที่ dream_shot_queries ผิดรูปแบบ
//   (ไม่ใช่ array/มี element ไม่ใช่ string/เกิน MAX_LIST) → ปฏิเสธด้วย reason ชัดเจน (ไม่ปนกับคีย์อื่น)
//   (d) คีย์แถมอื่นที่ไม่รู้จัก (ไม่ใช่ dream_shot_queries) ยังโดนปฏิเสธเหมือนเดิม (ไม่ได้เปิดช่องกว้างเกิน)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateKeywordsV1Structure } from '../src/lib/s5PinnedAi.js';

// ฟิกซ์เจอร์ฐาน — สคีมาเดิมครบทุกคีย์ (ไม่มี dream_shot_queries) ตรงตาม KEYWORDS_TOP_KEYS เป๊ะ
function baseRaw(overrides = {}) {
  return {
    subjects: [{ name: 'สมชาย', role: 'ตัวเอก', must_have: true, kind: 'person', owner: '' }],
    queries_th: ['สมชาย สัมภาษณ์'],
    queries_en: [],
    object_queries: [],
    scene_place: [],
    moment_action: [],
    emotion: [],
    source_show: [],
    hashtags: [],
    relationship_archive: [],
    lifestyle_travel: [],
    family_album: [],
    landmark_context: [],
    ...overrides,
  };
}

test('dormant: คำตอบเก่า (ไม่มี dream_shot_queries เลย) → ผ่านเหมือนเดิมทุกไบต์ + out.dream_shot_queries เติม [] ให้', () => {
  const raw = baseRaw();
  const r = validateKeywordsV1Structure(raw);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.dream_shot_queries, [], 'ไม่มีคีย์นี้มาเลย ต้อง default เป็น [] เสมอ (uniform ให้ผู้เรียกอ่านตรงๆ ได้)');
  // ค่าฟิลด์อื่นทั้งหมดต้องเหมือนพฤติกรรมเดิมทุกประการ (ไม่ใช่แค่ ok:true เฉยๆ)
  assert.equal(r.value.subjects.length, 1);
  assert.equal(r.value.subjects[0].name, 'สมชาย');
  assert.deepEqual(r.value.queries_th, ['สมชาย สัมภาษณ์']);
});

test('เปิดใช้จริง: คำตอบมี dream_shot_queries ที่ถูกต้อง (string array) → ผ่าน + ค่าจริงถูกส่งกลับตรงๆ', () => {
  const raw = baseRaw({ dream_shot_queries: ['สมชายยืนหน้าบ้านเก่า', 'สมชายกอดลูก'] });
  const r = validateKeywordsV1Structure(raw);
  assert.equal(r.ok, true, `ต้องผ่าน ได้ ${JSON.stringify(r)}`);
  assert.deepEqual(r.value.dream_shot_queries, ['สมชายยืนหน้าบ้านเก่า', 'สมชายกอดลูก']);
});

test('เปิดใช้จริง: dream_shot_queries เป็น [] เปล่าๆ (compass มีแต่ไม่มีอะไรให้แปล) → ผ่านปกติ', () => {
  const raw = baseRaw({ dream_shot_queries: [] });
  const r = validateKeywordsV1Structure(raw);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.dream_shot_queries, []);
});

test('ปฏิเสธ: dream_shot_queries ไม่ใช่ array (string/number/object) → reason ชี้เฉพาะคีย์นี้ ไม่ปนคีย์อื่น', () => {
  for (const bad of ['ไม่ใช่ array', 42, {}, null]) {
    const raw = baseRaw({ dream_shot_queries: bad });
    const r = validateKeywordsV1Structure(raw);
    assert.equal(r.ok, false, `ต้องปฏิเสธ (ได้ ${JSON.stringify(bad)})`);
    assert.equal(r.reason, 'dream_shot_queries', `reason ต้องชี้เฉพาะคีย์นี้ (ได้ ${JSON.stringify(bad)} → reason=${r.reason})`);
  }
});

test('ปฏิเสธ: dream_shot_queries มี element ไม่ใช่ string (ปนตัวเลข/object) → reason ชี้เฉพาะคีย์นี้', () => {
  const raw = baseRaw({ dream_shot_queries: ['ปกติ', 42] });
  const r = validateKeywordsV1Structure(raw);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'dream_shot_queries');
});

test('ปฏิเสธ: dream_shot_queries เป็น string ว่างเปล่า/blank ใน array → reason ชี้เฉพาะคีย์นี้ (เกณฑ์เดียวกับคีย์อื่นทุกตัว)', () => {
  const raw = baseRaw({ dream_shot_queries: ['ปกติ', '   '] });
  const r = validateKeywordsV1Structure(raw);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'dream_shot_queries');
});

test('ปฏิเสธ: คีย์แถมอื่นที่ไม่รู้จัก (ไม่ใช่ dream_shot_queries) ยังโดนตัดเหมือนเดิม — ไม่ได้เปิดช่องกว้างเกินไปกว่าที่ตั้งใจ', () => {
  const raw = baseRaw({ some_random_extra_key: ['ผี'] });
  const r = validateKeywordsV1Structure(raw);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'TOP_LEVEL_SHAPE', 'คีย์แถมอื่นที่ไม่ใช่ dream_shot_queries ต้องยังโดนปฏิเสธเหมือนเดิมทุกประการ');
});

test('ปฏิเสธ: มีทั้ง dream_shot_queries (ถูกต้อง) และคีย์แถมอื่นพร้อมกัน → ยังโดนตัด (dream_shot_queries เดียวเท่านั้นที่ได้รับการยกเว้น)', () => {
  const raw = baseRaw({ dream_shot_queries: ['ok'], another_extra: 1 });
  const r = validateKeywordsV1Structure(raw);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'TOP_LEVEL_SHAPE');
});

test('ปฏิเสธ: raw เป็น proxy/null/array (ไม่ใช่ plain object) → ยังปฏิเสธเหมือนเดิม ไม่ throw แม้มีการเช็ค dream_shot_queries เพิ่มเข้ามา', () => {
  assert.equal(validateKeywordsV1Structure(null).ok, false);
  assert.equal(validateKeywordsV1Structure([]).ok, false);
  assert.equal(validateKeywordsV1Structure(new Proxy({}, {})).ok, false);
  assert.equal(validateKeywordsV1Structure('string').ok, false);
  assert.equal(validateKeywordsV1Structure(undefined).ok, false);
});

test('ปฏิเสธ: dream_shot_queries เกิน MAX_LIST (200 ตาม readStringArray เดิม) → reason ชี้เฉพาะคีย์นี้', () => {
  const raw = baseRaw({ dream_shot_queries: Array.from({ length: 201 }, (_, i) => `ช็อต${i}`) });
  const r = validateKeywordsV1Structure(raw);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'dream_shot_queries');
});

console.log('keywords-dream-schema: all tests defined via node:test — see summary above');
