// ★ 1 ก.ย. 69 — L4.5 ห้ามลบเนื้อข่าวจริงเป็นท่อน (บั๊กระดับกลาง)
import assert from 'node:assert/strict';
import test from 'node:test';
import { scrubHallucinatedPlaces } from '../src/lib/correction/placeScrub.js';

test('ท่อนยาวหลังคำว่าโรงพยาบาล ต้องไม่ถูกลบ (ไม่ใช่ชื่อเฉพาะ)', () => {
  const content = 'พ่อรีบพาลูกส่งโรงพยาบาลใกล้บ้านทันทีที่รู้ว่าอาการหนัก จนปลอดภัย';
  const source = 'พ่อพาลูกส่งโรงพยาบาลใกล้บ้าน';
  const { content: out, scrubbed } = scrubHallucinatedPlaces(content, source);
  assert.equal(out, content);
  assert.equal(scrubbed.length, 0);
});

test('ชื่อสถานที่หลอนสั้นๆ ที่ไม่มีในต้นฉบับ ยังถูกล้าง', () => {
  const content = 'เหตุเกิดที่ โรงพยาบาลบ้านโป่ง เมื่อคืน';
  const source = 'เหตุเกิดที่โรงพยาบาลแห่งหนึ่งในราชบุรี';
  const { content: out, scrubbed } = scrubHallucinatedPlaces(content, source);
  assert.ok(out.includes('เหตุเกิดที่ โรงพยาบาล เมื่อคืน'), out);
  assert.equal(scrubbed.length, 1);
});

test('ชื่อที่มีจริงในต้นฉบับ ต้องไม่ถูกแตะ', () => {
  const content = 'ส่งตัวไป โรงพยาบาลศิริราช ทันที';
  const source = 'นำส่งโรงพยาบาลศิริราช';
  const { content: out } = scrubHallucinatedPlaces(content, source);
  assert.equal(out, content);
});

test('ไม่มีต้นฉบับ = ไม่ล้างอะไรเลย', () => {
  const content = 'ที่ วัดสมมติ แห่งหนึ่ง';
  assert.equal(scrubHallucinatedPlaces(content, '').content, content);
});
