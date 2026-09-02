// ★ 1 ก.ย. 69 — แทนคำต้องห้ามต้องเคารพกันชน whitelist (บั๊กระดับสูง+กลาง: ศัพท์แพทย์ถูกทำลาย)
import assert from 'node:assert/strict';
import test from 'node:test';
import { guardedReplace, sortLongestFirst } from '../src/lib/correction/guardedReplace.js';

const BLOOD = {
  type: 'forbidden_word', text: 'เลือด', suggestion: 'ร่องรอยเหตุการณ์',
  patternSource: '(?<!เส้น|หลอด|ลิ่ม|เม็ด|ฟอก|ดัน|บริจาค|สาย|เกล็ด|กระแส|ถ่าย|ปั๊ม|เติม|ห้าม)เลือด(?!ดี|ข้น|ฝาด|จาง|ผสม|กำเดา)',
  patternFlags: 'g',
};
const KILL = { type: 'forbidden_word', text: 'ฆ่า', suggestion: 'ก่อเหตุ', patternSource: 'ฆ่า(?!เชื้อ|แมลง)', patternFlags: 'g' };

test('แทนทุกตำแหน่ง: เส้นเลือด (ศัพท์แพทย์) ต้องรอด เลือดเดี่ยวถูกแทน', () => {
  const out = guardedReplace('เส้นเลือดในสมองแตก และมีเลือดออกมาก', BLOOD, { all: true });
  assert.ok(out.includes('เส้นเลือดในสมองแตก'), out);
  assert.ok(out.includes('ร่องรอยเหตุการณ์ออกมาก'), out);
});

test('แทนตำแหน่งเดียว: ต้องข้าม whitelist ที่อยู่ก่อน แล้วไปแทนตัวจริง', () => {
  const out = guardedReplace('หมอให้ยาฆ่าเชื้อ ก่อนที่คนร้ายจะฆ่าเหยื่อ', KILL, { all: false });
  assert.ok(out.includes('ยาฆ่าเชื้อ'), out);
  assert.ok(out.includes('ก่อเหตุเหยื่อ'), out);
});

test('ไม่มี pattern → พฤติกรรมเดิม (แทนตำแหน่งแรกดิบๆ)', () => {
  const raw = { type: 'engagement_bait', text: 'แชร์ด่วน', suggestion: '' };
  assert.equal(guardedReplace('แชร์ด่วน! ข่าวนี้ แชร์ด่วน', raw, { all: false }), '! ข่าวนี้ แชร์ด่วน');
  assert.equal(guardedReplace('แชร์ด่วน! ข่าวนี้ แชร์ด่วน', raw, { all: true }), '! ข่าวนี้ ');
});

test('pattern พัง → ไม่ล้ม ถอยพฤติกรรมเดิม', () => {
  const bad = { ...KILL, patternSource: '(' };
  assert.equal(guardedReplace('ฆ่า', bad), 'ก่อเหตุ');
});

test('sortLongestFirst: ฆ่าตัวตาย มาก่อน ฆ่า', () => {
  const s = sortLongestFirst([{ text: 'ฆ่า' }, { text: 'ฆ่าตัวตาย' }, { text: 'ศพ' }]);
  assert.deepEqual(s.map(x => x.text), ['ฆ่าตัวตาย', 'ฆ่า', 'ศพ']);
});
