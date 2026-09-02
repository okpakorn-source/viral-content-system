// ★ 1 ก.ย. 69 — ด่านล้างคำเสี่ยงห้ามเปลี่ยนข้อเท็จจริง (บั๊กระดับสูง: คนรอด → คนตาย)
import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeOutput } from '../src/lib/ai/safetyFilter.js';

test('ผูกคอแต่ช่วยทัน ต้องไม่กลายเป็นเสียชีวิต', () => {
  const out = sanitizeOutput('เพื่อนบ้านพบว่าเขาผูกคอแต่ช่วยไว้ทัน ตอนนี้ปลอดภัยแล้ว');
  assert.ok(!out.includes('เสียชีวิต'), `ห้ามมีคำว่าเสียชีวิต: ${out}`);
  assert.ok(!out.includes('ผูกคอ'), 'คำเสี่ยงต้องถูกแทน');
});

test('ผูกคอตาย (ตายจริง) ยังแทนเป็นถ้อยคำสุภาพได้', () => {
  const out = sanitizeOutput('พบว่าผูกคอตายในห้อง');
  assert.ok(out.includes('เสียชีวิตอย่างน่าเศร้า'));
});

test('ฆ่าตัวตาย ต้องไม่กลายเป็นภาษาพัง "ทำให้เสียชีวิตตัวตาย"', () => {
  const out = sanitizeOutput('ญาติเผยว่าเขาฆ่าตัวตายเมื่อคืน');
  assert.ok(!out.includes('ทำให้เสียชีวิตตัวตาย'), out);
  assert.ok(!out.includes('ฆ่าตัวตาย'));
});

test('ศัพท์ปกติ ยาฆ่าเชื้อ / ฆ่าแมลง ต้องไม่ถูกแตะ', () => {
  const s = 'หมอสั่งยาฆ่าเชื้อ และเกษตรกรใช้ยาฆ่าแมลง';
  assert.equal(sanitizeOutput(s), s);
});

test('ฆ่า เดี่ยวๆ ยังถูกแทน (ไม่ได้ปิดกฎเดิม)', () => {
  const out = sanitizeOutput('ผู้ต้องหาสารภาพว่าฆ่าเหยื่อ');
  assert.ok(!out.includes('ฆ่า'));
  assert.ok(out.includes('ทำให้เสียชีวิต'));
});

test('กระโดดตึกแต่รอด ต้องไม่ถูกเขียนว่าเสียชีวิต', () => {
  const out = sanitizeOutput('เขากระโดดตึกแต่รอดชีวิตอย่างปาฏิหาริย์');
  assert.ok(!out.includes('เสียชีวิต'), out);
  assert.ok(!out.includes('กระโดดตึก'));
});

test('ไม่อยากตาย ต้องไม่กลายเป็น "ไม่ภาวะเครียดสะสม"', () => {
  const out = sanitizeOutput('เธอบอกว่าไม่อยากตาย อยากอยู่กับลูก');
  assert.ok(!out.includes('ไม่ภาวะ'), out);
});

test('อยากตาย (ไม่มีคำปฏิเสธนำหน้า) ยังถูกแทน', () => {
  const out = sanitizeOutput('เขาเคยบอกว่าอยากตาย');
  assert.ok(!out.includes('อยากตาย'));
});
