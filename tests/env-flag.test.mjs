// ★ 1 ก.ย. 69 — สวิตช์ต้องอ่านค่าทน (บั๊กระดับกลาง+ต่ำ 4 จุด)
import assert from 'node:assert/strict';
import test from 'node:test';
import { envOn, envStr } from '../src/lib/utils/envFlag.js';

const K = 'ENVFLAG_TEST_X';
const set = v => { if (v === undefined) delete process.env[K]; else process.env[K] = v; };

test('รับ 1 / true / on / yes ทุกตัวพิมพ์ + ช่องว่าง + อัญประกาศ', () => {
  for (const v of ['1', 'true', 'TRUE', ' on ', 'Yes', '"1"', "'true'", '"true" ']) {
    set(v); assert.equal(envOn(K), true, `ค่า ${JSON.stringify(v)} ต้องเป็น true`);
  }
});

test('รับ 0 / false / off / no / ว่าง เป็น false', () => {
  for (const v of ['0', 'false', 'OFF', 'no', '', '""']) {
    set(v); assert.equal(envOn(K), false, `ค่า ${JSON.stringify(v)} ต้องเป็น false`);
  }
});

test('ไม่ตั้ง → ใช้ค่าเริ่มต้นที่ส่งมา', () => {
  set(undefined);
  assert.equal(envOn(K), false);
  assert.equal(envOn(K, true), true);
});

test('ค่าอ่านไม่ออก → ค่าเริ่มต้น ไม่ล้ม', () => {
  set('maybe'); assert.equal(envOn(K), false); assert.equal(envOn(K, true), true);
});

test('envStr ตัดอัญประกาศและช่องว่าง', () => {
  set(' "per_angle" '); assert.equal(envStr(K), 'per_angle');
  set(undefined); assert.equal(envStr(K), '');
});
