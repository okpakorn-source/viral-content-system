// Production-coupled contract: post-persist telemetry must never discard paid news.
// In-memory only: no AI, HTTP, Supabase, server, or external writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(TESTS, '..');
const source = readFileSync(
  join(ROOT, 'src', 'lib', 'services', 'autoFlowServiceText.js'),
  'utf8',
).replace(/\r\n/g, '\n');

function actualSettler(productionSource = source) {
  const start = productionSource.indexOf('export async function settleTelemetryWithinReserve(');
  const end = productionSource.indexOf('export async function processAutoFlowText(', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบ telemetry settler ตัวจริง');
  const declaration = productionSource.slice(start, end)
    .replace('export async function', 'async function');
  return new Function('getActivePipelineDeadline',
    `${declaration}; return settleTelemetryWithinReserve;`)(() => null);
}

function assertProductionWiring(productionSource = source) {
  const start = productionSource.indexOf('  // === GENERATION LOG:');
  const afterSave = productionSource.slice(start, productionSource.indexOf('  return {', start));
  assert.equal((afterSave.match(/settleTelemetryWithinReserve\(/g) || []).length, 2,
    'Generation Log และ final health log ต้องอยู่นอก critical path ทั้งคู่');
  assert.doesNotMatch(afterSave, /throwIfExpired\(['"](?:generation_log|final_success_log)/,
    'หลังบันทึกข่าวแล้ว telemetry deadline ห้ามเปลี่ยนงานเป็น failed');
  assert.match(afterSave, /const generationLogAttempt = await settleTelemetryWithinReserve\(\(\) => logGeneration\(/);
  assert.match(afterSave, /\(\) => logPipeline\(/);
}

test('telemetry สำเร็จในเวลา: คืนค่าจริงตามเดิม', async () => {
  const settle = actualSettler();
  const result = await settle(async () => ({ success: true, caseId: '00457' }), {
    deadline: { remainingMs: () => 20_000 },
  });
  assert.deepEqual(result, { status: 'completed', value: { success: true, caseId: '00457' } });
});

test('telemetry โยน error รวมถึง deadline: กลายเป็นสถานะ failed ไม่ทิ้งข่าว', async () => {
  const settle = actualSettler();
  const error = new Error('deadline');
  error.errorType = 'PIPELINE_DEADLINE_EXCEEDED';
  const result = await settle(async () => { throw error; }, {
    deadline: { remainingMs: () => 20_000 },
  });
  assert.equal(result.status, 'failed');
  assert.strictEqual(result.error, error);
});

test('telemetry ค้าง: timeout คืนการควบคุมโดยไม่รอ task และไม่วนซ้ำ', async () => {
  const settle = actualSettler();
  let calls = 0;
  const pending = new Promise(() => {});
  const result = await settle(() => {
    calls += 1;
    return pending;
  }, {
    deadline: { remainingMs: () => 20_000 },
    setTimer: callback => { queueMicrotask(callback); return { unref() {} }; },
    clearTimer: () => {},
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 'timeout', error: 'telemetry timeout' });
});

test('เวลาเหลืออยู่ใน response reserve: ข้าม telemetry ก่อนเริ่ม task', async () => {
  const settle = actualSettler();
  let calls = 0;
  const result = await settle(() => { calls += 1; }, {
    deadline: { remainingMs: () => 9_999 },
    reserveMs: 10_000,
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, { status: 'skipped', error: 'response reserve' });
});

test('production ใช้ตัวกัน telemetry ทั้งสองจุด และ mutation ย้อน critical path ต้องแดง', () => {
  assertProductionWiring();
  const mutated = source.replace(
    'const generationLogAttempt = await settleTelemetryWithinReserve(() => logGeneration(',
    'const generationLogAttempt = await logGeneration(',
  );
  assert.notEqual(mutated, source);
  assert.throws(() => assertProductionWiring(mutated));
});
