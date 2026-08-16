/**
 * ข้อสอบ: ด่านจับของเกิน (ตัวผ่า) ต้อง "ปิด" เป็นค่าเริ่มต้น — 16 ส.ค. 69
 *
 * เจ้าของสั่ง "ตัวผ่าปิดเลย ไม่ใช้" (ถาวร) → ความปลอดภัยห้ามพึ่ง env
 * ข้อสอบนี้ยิงค่า FAB_GATE ทุกรูปแบบที่ Vercel/เชลล์อาจส่งมา แล้วยืนยันว่า:
 *   - ไม่ตั้ง / ค่าอะไรก็ตามที่ไม่ใช่ 1|on|true|yes  → ถูกข้าม (ไม่เรียก AI สักครั้ง = ไม่เสียเงิน)
 *   - 1 / "1" / ' 1 ' / on / TRUE                    → ตัวผ่าทำงาน (เปิดคืนได้จริง)
 * และ fail-open เสมอ: ถูกข้าม = คืนเนื้อเดิมครบทุกตัวอักษร ห้ามทำข่าวหาย
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const sourceCode = readFileSync(new URL('../src/lib/correction/fabricationGate.js', import.meta.url), 'utf8');
const runtimeStart = sourceCode.indexOf('const GATE_CHECK_SYS');
assert.ok(runtimeStart >= 0, 'ต้องหา GATE_CHECK_SYS ใน fabricationGate จริงได้');
const runtimeSource = sourceCode
  .slice(runtimeStart)
  .replace('export async function fabricationGate', 'async function fabricationGate');

const suspect = 'ผู้ก่อเหตุเป็นนักบินอวกาศลับจากดาวอังคาร';
const source = `ต้นฉบับระบุเพียงว่าเจ้าหน้าที่กำลังตรวจสอบเหตุการณ์และประชาชนปลอดภัย ${'ข้อมูลยืนยันจากต้นฉบับ '.repeat(6)}`;
const content = `บทความรายงานเหตุการณ์ตามข้อมูลเบื้องต้น ${suspect} ${'เนื้อหาส่วนที่ยืนยันได้ยังคงเดิมและไม่ควรถูกตัด '.repeat(6)}`;
const fixedContent = content.replace(suspect, '').trim();

function makeGate() {
  const calls = { ai: 0, claude: 0 };
  const callAI = async () => {
    calls.ai++;
    return calls.ai === 1 ? { fabrications: [suspect] } : { confirmed: [suspect] };
  };
  const callClaude = async () => { calls.claude++; return { content: fixedContent }; };
  const fabricationGate = new Function(
    'callAI', 'callClaude', 'isClaudeAvailable', 'MODEL_FAST_CHEAP',
    `${runtimeSource}\nreturn fabricationGate;`,
  )(callAI, callClaude, () => true, 'test-model');
  return { fabricationGate, calls };
}

// รันหนึ่งเคสด้วยค่า env ที่กำหนด แล้วคืนผล + log ที่ระบบพิมพ์ออกมา
async function runWithEnv(value) {
  const saved = process.env.FAB_GATE;
  if (value === undefined) delete process.env.FAB_GATE; else process.env.FAB_GATE = value;
  const originalLog = console.log;
  const logs = [];
  console.log = (...parts) => logs.push(parts.map(String).join(' '));
  try {
    const { fabricationGate, calls } = makeGate();
    const result = await fabricationGate(content, source);
    return { result, calls, logs };
  } finally {
    console.log = originalLog;
    if (saved === undefined) delete process.env.FAB_GATE; else process.env.FAB_GATE = saved;
  }
}

// ค่าที่ต้อง "ปิด" (ครอบกับดัก vercel env add ติดอัญประกาศ/เว้นวรรค + ค่าขยะ + ค่าที่ไม่ตั้ง)
const OFF_CASES = [
  ['ไม่ตั้งค่าเลย', undefined],
  ['สตริงว่าง', ''],
  ['เว้นวรรคล้วน', '   '],
  ['0', '0'],
  ['"0" ติดอัญประกาศ', '"0"'],
  ["'0' ติดอัญประกาศเดี่ยว", "'0'"],
  ['" 0 " เว้นวรรค', ' 0 '],
  ['OFF', 'OFF'],
  ['off', 'off'],
  ['false', 'false'],
  ['"false"', '"false"'],
  ['no', 'no'],
  ['2 (ค่าที่ไม่รู้จัก)', '2'],
  ['ขยะ abc!@#', 'abc!@#'],
  ['ค่าไทย ปิด', 'ปิด'],
];

// ค่าที่ต้อง "เปิด" (ทางถอยกลับต้องใช้ได้จริง ไม่งั้นกลายเป็นโค้ดตายกู้ไม่ขึ้น)
const ON_CASES = [
  ['1', '1'],
  ['"1" ติดอัญประกาศ', '"1"'],
  ["' 1 ' เว้นวรรค+อัญประกาศ", " '1' "],
  ['on', 'on'],
  ['ON', 'ON'],
  ['true', 'true'],
  ['TRUE', 'TRUE'],
  ['yes', 'yes'],
];

for (const [label, value] of OFF_CASES) {
  test(`ปิดตัวผ่าเมื่อ FAB_GATE = ${label}`, async () => {
    const { result, calls, logs } = await runWithEnv(value);
    assert.equal(result.debug.skipped, 'FAB_GATE_OFF', 'ต้องบันทึกเหตุผลที่ข้ามลงกล่องดำ');
    assert.equal(result.debug.checked, false, 'ห้ามนับว่าตรวจแล้ว');
    assert.equal(result.debug.fixed, false, 'ห้ามแตะเนื้อ');
    assert.equal(calls.ai, 0, 'ห้ามเรียก AI แม้ครั้งเดียว (ไม่เสียเงิน)');
    assert.equal(calls.claude, 0, 'ห้ามเรียกตัวผ่า');
    assert.equal(result.content, content, 'fail-open: เนื้อเดิมต้องคืนครบทุกตัวอักษร');
    assert.ok(logs.some((l) => l.includes('[FabGate]') && l.includes('FAB_GATE=1')),
      'ต้องมี log อ่านออกว่าข้ามเพราะอะไร + บอกวิธีเปิดคืน');
  });
}

for (const [label, value] of ON_CASES) {
  test(`เปิดตัวผ่าคืนได้เมื่อ FAB_GATE = ${label}`, async () => {
    const { result, calls } = await runWithEnv(value);
    assert.equal(result.debug.skipped, undefined, 'ไม่ควรถูกข้าม');
    assert.equal(result.debug.checked, true, 'ต้องตรวจจริง');
    assert.equal(calls.ai, 2, 'ต้องเดินครบ 2 ชั้นยืนยัน');
    assert.equal(calls.claude, 1, 'ต้องเรียกตัวผ่าหนึ่งครั้ง');
    assert.equal(result.debug.fixed, true, 'ต้องผ่าจริง');
    assert.equal(result.content, fixedContent);
  });
}

test('ค่า env ต้องอ่านตอนเรียก ไม่ใช่ตอน import (สลับค่ากลางคันได้)', async () => {
  const off1 = await runWithEnv('0');
  const on = await runWithEnv('1');
  const off2 = await runWithEnv(undefined);
  assert.equal(off1.calls.ai, 0);
  assert.equal(on.calls.ai, 2);
  assert.equal(off2.calls.ai, 0, 'กลับมาปิดได้ในโปรเซสเดียวกัน = ไม่ถูก cache ตอน import');
});

test('ปิดอยู่แล้วต้องไม่พังแม้เนื้อ/ต้นฉบับเป็น null (fail-open ห้ามทำข่าวหาย)', async () => {
  const saved = process.env.FAB_GATE;
  delete process.env.FAB_GATE;
  const originalLog = console.log;
  console.log = () => {};
  try {
    const { fabricationGate } = makeGate();
    const a = await fabricationGate(null, null);
    const b = await fabricationGate('', undefined);
    assert.equal(a.content, null);
    assert.equal(b.content, '');
    assert.equal(a.debug.skipped, 'FAB_GATE_OFF');
  } finally {
    console.log = originalLog;
    if (saved === undefined) delete process.env.FAB_GATE; else process.env.FAB_GATE = saved;
  }
});
