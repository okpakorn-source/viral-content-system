// 🔏 ด่านเดาเพศชั้นสุดท้าย (25 ต.ค. 69) — รอบ 3 หลังผู้ตรวจรอบ 3 FAIL: เจ้าของเลือก "เตือนอย่างเดียว ไม่แก้เนื้อ"
//   ต้นฉบับใช้ "เธอ" เอง = ไม่เตือน · ต้นฉบับมีผู้หญิง = ป้าย "เช็คว่าหมายถึงใคร" · ต้นฉบับไม่บอกเพศ = ป้าย "น่าจะเดาเพศ"
//   เนื้อข่าวไม่ถูกแก้ทุกกรณี (เดิมแทน "เจ้าตัว" แล้วชี้ผิดคนเมื่อเรื่องมีหลายคน — เคสเมล บี/เนเน่) · ถอย GENDER_NEUTRAL_FIX=0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { neutralizeGuessedGender, isGenderNeutralFixEnabled, rawGenderCase, GENDER_WARNING_TEXT, GENDER_GUESS_WARNING_TEXT } from '../src/lib/services/genderNeutral.js';

const RAW_NO_FEMALE = 'พว.กนกวรรณ สืบสำราญ พยาบาลวิชาชีพชำนาญการ จอดรถลงไปช่วยชายวัย 60 ปี ที่หมดสติ';
const RAW_WITH_GRANDMA = 'พว.กนกวรรณ สืบสำราญ พยาบาลวิชาชีพชำนาญการ จอดรถลงไปช่วยคุณยายวัย 81 ปี ที่หมดสติ';
const withEnv = (v, fn) => { const k = process.env.GENDER_NEUTRAL_FIX; if (v === undefined) delete process.env.GENDER_NEUTRAL_FIX; else process.env.GENDER_NEUTRAL_FIX = v; try { return fn(); } finally { if (k === undefined) delete process.env.GENDER_NEUTRAL_FIX; else process.env.GENDER_NEUTRAL_FIX = k; } };

test('A1 ต้นฉบับไม่บอกเพศใคร (เคสเมล บี): ห้ามแก้เนื้อ · ติดป้าย "น่าจะเดาเพศ" เฉพาะฉบับที่มี "เธอ" · "พวกเธอ"/"มาเธอร์" ไม่นับ', () => withEnv(undefined, () => {
  const v1 = { content: 'เมล บีไม่ได้มองแค่เสียงร้อง เธอชี้ว่าเสียงร้องเป๊ะ', title: 't' };
  const v2 = { content: 'พวกเธอในงานมาเธอร์เดย์' };
  const r = neutralizeGuessedGender([v1, v2], 'เมล บี ชมเนเน่ ว่าเสียงร้องเป๊ะ เต้นเก่ง');
  assert.equal(r.case, 'none');
  assert.equal(r.versions[0].content, v1.content, 'ห้ามแก้เนื้อ');
  assert.equal(r.versions[0]._genderWarning, GENDER_GUESS_WARNING_TEXT);
  assert.equal(r.versions[0]._genderNeutralized, undefined);
  assert.equal(r.versions[1], v2, 'ไม่มี "เธอ" เดี่ยว = ตัวเดิม');
  assert.deepEqual([r.changed, r.warned], [[], [1]]);
  assert.equal(v1._genderWarning, undefined, 'ห้ามแก้ของเดิม');
}));

test('A2 ต้นฉบับมีผู้หญิง (คุณยาย): ห้ามแก้เนื้อ · ป้าย "เช็คว่าหมายถึงใคร"', () => withEnv(undefined, () => {
  const v1 = { content: 'พว.กนกวรรณปั๊มหัวใจคุณยาย จนเธอกลับมาหายใจ' };
  const v2 = { content: 'พว.กนกวรรณปั๊มหัวใจคุณยายจนกลับมาหายใจ' };
  const r = neutralizeGuessedGender([v1, v2], RAW_WITH_GRANDMA);
  assert.equal(r.case, 'female');
  assert.equal(r.versions[0].content, v1.content);
  assert.equal(r.versions[0]._genderWarning, GENDER_WARNING_TEXT);
  assert.equal(r.versions[1], v2);
  assert.equal(neutralizeGuessedGender([{ content: 'เธอไม่รอช้า' }], RAW_NO_FEMALE).versions[0]._genderWarning, GENDER_GUESS_WARNING_TEXT);
}));

test('A3 คำบอกว่ามีผู้หญิงในต้นฉบับ (รวมคำที่ผู้ตรวจรอบ 3 ยิงหลุด) · คำที่ไม่ใช่คนไม่นับ', () => {
  for (const raw of ['หญิงอุ้มลูกป่วย', 'นางสาวมาลี', 'น.ส.มาลี', 'สาวโรงงาน', 'นาง สมศรี', 'ด.ญ.แพรวา', 'คุณยายวัย 81', 'แม่ของเขา', 'ภรรยาของเขา',
    'แม่ค้าข้างทาง', 'บอกว่าขอบคุณค่ะ', 'ดิฉันขอบคุณ', 'พระนางในละคร',
    // ผู้ตรวจรอบ 3
    'แม่น้องแบงค์ เล่าว่าลูกป่วยหนัก', 'ทันทีที่นางสมศรีเห็น', 'โดยนางมาลีบอกว่า', 'แม่นางเอกละคร', 'แม่บ้านประจำตึก',
    'พญ.สมศรี ผ่าตัดทั้งคืน', 'ทพญ.วารี', 'อาม่าวัย 90', 'เจ๊ขายข้าวมันไก่', 'ซิ้มหน้าร้าน', 'ลูกสะใภ้ดูแลแม่สามี', 'ภิกษุณีรูปหนึ่ง']) {
    assert.equal(rawGenderCase(raw), 'female', raw);
  }
  for (const raw of ['ชายวัย 60 ปีพลัดตกแม่น้ำ', 'ยิงประตูได้แม่นยำ', 'นักเตะคนนี้ยิงแม่น ทุกนัด', 'ขุนนางในสมัยก่อน', 'แม่ทัพนายกอง',
    // รอบ 4 (ผู้ตรวจรอบ 4): คำที่ไม่ใช่ผู้หญิง
    'ติดป้ายทะเบียนรถ', 'ขยายผลการสอบสวน', 'ย่านการค้า', 'อย่าลืมพกน้ำ', 'ชายชาวแม่สอด', 'ยิงแม่นมาก', 'สาวกของศาสนา']) {
    assert.equal(rawGenderCase(raw), 'none', raw);
  }
  assert.equal(rawGenderCase('เธอบอกว่าไม่เป็นไร'), 'pronoun');
  // รอบ 4: "พวกเธอ" / "มาเธอร์แคร์" / "พระเจ้าลูกเธอ" ในต้นฉบับ ไม่นับว่าต้นฉบับใช้ "เธอ" เรียกคน
  for (const raw of ['ทักทายพวกเธอทุกคน', 'ร้านมาเธอร์แคร์', 'สมเด็จพระเจ้าลูกเธอ เสด็จ']) assert.notEqual(rawGenderCase(raw), 'pronoun', raw);
});

test('A4 ต้นฉบับใช้ "เธอ" เอง = ไม่เตือน · สวิตช์ถอย/อินพุตพัง = ไม่แตะ ไม่ล้ม', () => {
  withEnv(undefined, () => {
    const x = { content: 'เธอไม่รอช้า' };
    const r = neutralizeGuessedGender([x], 'เธอเดินเข้ามา');
    assert.equal(r.versions[0], x);
    assert.deepEqual([r.changed, r.warned], [[], []]);
    assert.equal(neutralizeGuessedGender([x], '').versions[0], x);
    assert.equal(neutralizeGuessedGender(null, RAW_NO_FEMALE).versions, null);
    assert.deepEqual(neutralizeGuessedGender([null, { content: 5 }], RAW_NO_FEMALE).warned, []);
  });
  for (const v of ['0', 'off', 'false', 'no', '"0"']) withEnv(v, () => {
    assert.equal(isGenderNeutralFixEnabled(), false, v);
    const x = { content: 'เธอไม่รอช้า' };
    assert.equal(neutralizeGuessedGender([x], RAW_NO_FEMALE).versions[0], x);
  });
});

test('B1 ต่อเข้าท่อ: หลังด่านความยาว ก่อนติดป้ายข้อมูลหาย และก่อนประกอบผล', () => {
  const src = readFileSync(new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ neutralizeGuessedGender \} from '@\/lib\/services\/genderNeutral'/u);
  const floor = src.indexOf('enforceTextNewsPublicationFloor(finalVersions');
  const fix = src.indexOf('neutralizeGuessedGender(finalVersions, groundingSourceText)');
  const facts = src.indexOf('annotateMissingRawFacts(finalVersions, groundingSourceText)');
  const build = src.indexOf('buildPublishableAnalysisResult({');
  assert.ok(floor > 0 && fix > floor && facts > fix && build > facts);
});
