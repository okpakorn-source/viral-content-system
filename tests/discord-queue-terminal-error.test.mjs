import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { makeQueueTerminalError, isQueueTerminalError, selectQualityWarnings } = require('../discord-bot/queue-errors.js');

test('ข้อความล้มภาษาไทยถูกติดป้าย terminal และส่งเหตุผลจริงทันที', () => {
  const error = makeQueueTerminalError({
    error: 'ระบบฐานข้อมูลขัดข้อง',
    errorType: 'STORE_FAILED',
    failedStep: 'workflow_persist',
  });
  assert.equal(error.message, 'ระบบฐานข้อมูลขัดข้อง');
  assert.equal(error.code, 'QUEUE_JOB_FAILED');
  assert.equal(error.failedStep, 'workflow_persist');
  assert.equal(isQueueTerminalError(error), true);
});

test('network poll error ทั่วไปไม่ถูกปลอมเป็น terminal', () => {
  assert.equal(isQueueTerminalError(new Error('ECONNRESET')), false);
});

test('คำเตือนพนักงานต้องขึ้นก่อน แม้อยู่ลำดับที่ 3', () => {
  const visible = selectQualityWarnings([
    'Correction V1 ล้ม',
    'V1/V2 ยังคล้ายกัน',
    'V1 เพิ่มปริมาณน้ำหนึ่งแก้ว — ให้พนักงานตรวจบริบทก่อนโพสต์',
  ], 2);
  assert.deepEqual(visible, [
    'V1 เพิ่มปริมาณน้ำหนึ่งแก้ว — ให้พนักงานตรวจบริบทก่อนโพสต์',
    'Correction V1 ล้ม',
  ]);
});

test('Discord wiring ไม่เดาคำว่า failed และแสดง warning จริง', () => {
  const source = readFileSync(new URL('../discord-bot/index.js', import.meta.url), 'utf8');
  assert.match(source, /throw makeQueueTerminalError\(st\)/u);
  assert.match(source, /if \(isQueueTerminalError\(pollErr\)/u);
  assert.doesNotMatch(source, /pollErr\.message\?\.includes\('failed'\)/u);
  assert.match(source, /selectQualityWarnings\(qualityWarnings, 2\)/u);
  assert.match(source, /จุดให้พนักงานตรวจ/u);
});
