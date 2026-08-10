import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const sourceCode = readFileSync(new URL('../src/lib/correction/fabricationGate.js', import.meta.url), 'utf8');
const runtimeStart = sourceCode.indexOf('const GATE_CHECK_SYS');
assert.ok(runtimeStart >= 0, 'ต้องหา GATE_CHECK_SYS ใน fabricationGate จริงได้');
const runtimeSource = sourceCode
  .slice(runtimeStart)
  .replace('export async function fabricationGate', 'async function fabricationGate');

function makeGate({ confirmation = 'success' } = {}) {
  const calls = { ai: 0, claude: 0 };
  const callAI = async () => {
    calls.ai++;
    if (calls.ai === 1) return { fabrications: [suspect] };
    if (confirmation === 'throw') throw new Error('confirmation unavailable');
    if (confirmation === 'malformed') return { result: 'not-an-array' };
    return { confirmed: [suspect] };
  };
  const callClaude = async () => {
    calls.claude++;
    return { content: fixedContent };
  };
  const fabricationGate = new Function(
    'callAI',
    'callClaude',
    'isClaudeAvailable',
    'MODEL_FAST_CHEAP',
    `${runtimeSource}\nreturn fabricationGate;`,
  )(callAI, callClaude, () => true, 'test-model');
  return { fabricationGate, calls };
}

async function captureWarnings(fn) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...parts) => warnings.push(parts.map(String).join(' '));
  try {
    return { value: await fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

const suspect = 'ผู้ก่อเหตุเป็นนักบินอวกาศลับจากดาวอังคาร';
const source = `ต้นฉบับระบุเพียงว่าเจ้าหน้าที่กำลังตรวจสอบเหตุการณ์และประชาชนปลอดภัย ${'ข้อมูลยืนยันจากต้นฉบับ '.repeat(6)}`;
const content = `บทความรายงานเหตุการณ์ตามข้อมูลเบื้องต้น ${suspect} ${'เนื้อหาส่วนที่ยืนยันได้ยังคงเดิมและไม่ควรถูกตัด '.repeat(6)}`;
const fixedContent = content.replace(suspect, '').trim();

test('ชั้นยืนยัน throw ต้อง fail-open และห้ามเรียกตัวตัดเนื้อ', async () => {
  const { fabricationGate, calls } = makeGate({ confirmation: 'throw' });
  const { value, warnings } = await captureWarnings(() => fabricationGate(content, source));
  assert.equal(value.content, content);
  assert.equal(value.debug.fixed, false);
  assert.equal(value.debug.fixSkipped, 'confirmation-failed');
  assert.equal(calls.ai, 2);
  assert.equal(calls.claude, 0);
  assert.ok(warnings.some((line) => line.includes('confirmation unavailable') && line.includes('fail-open')));
});

test('ชั้นยืนยันตอบ malformed ต้อง fail-open และห้ามเรียกตัวตัดเนื้อ', async () => {
  const { fabricationGate, calls } = makeGate({ confirmation: 'malformed' });
  const { value, warnings } = await captureWarnings(() => fabricationGate(content, source));
  assert.equal(value.content, content);
  assert.equal(value.debug.fixed, false);
  assert.equal(value.debug.fixSkipped, 'confirmation-invalid-response');
  assert.equal(calls.ai, 2);
  assert.equal(calls.claude, 0);
  assert.ok(warnings.some((line) => line.includes('รูปแบบไม่ถูกต้อง') && line.includes('fail-open')));
});

test('ยืนยันสำเร็จยังเดิน happy path และเรียกตัวตัดเนื้อหนึ่งครั้ง', async () => {
  const { fabricationGate, calls } = makeGate({ confirmation: 'success' });
  const result = await fabricationGate(content, source);
  assert.equal(result.content, fixedContent);
  assert.equal(result.debug.fixed, true);
  assert.equal(result.debug.confirmed, 1);
  assert.equal(calls.ai, 2);
  assert.equal(calls.claude, 1);
});
