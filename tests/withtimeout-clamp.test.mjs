// ★ 1 ก.ย. 69 — withTimeoutSignal ต้อง "หั่นงบให้พอดีเวลาที่เหลือ" ไม่ใช่โยนทิ้งเมื่อจองงบเต็มไม่ได้ (บั๊กระดับกลาง)
//   ผู้ตรวจไขว้ชี้: เทสเดิมใช้ ms เล็ก (<60s) จึงไม่เคยแตะเส้น clamp — ไฟล์นี้คุมเส้นนั้นโดยตรง
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPipelineDeadline, runWithPipelineDeadline } from '../src/lib/utils/pipelineDeadline.js';
import { withTimeoutSignal } from '../src/lib/utils/withTimeout.js';

function fakeClock(start = 0) {
  let now = start; const timers = new Map(); let id = 0;
  return {
    now: () => now,
    setTimer(cb, delay) { const t = { id: ++id, at: now + delay, cb, unref() {} }; timers.set(t.id, t); return t; },
    clearTimer(t) { timers.delete(t?.id); },
  };
}
function deadlineIn(ms) {
  const clock = fakeClock();
  return createPipelineDeadline({ deadlineAt: ms, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
}
// จับค่า delay ที่ withTimeoutSignal ตั้งให้ตัวเอง (ใช้ setTimeout จริง) — unref กันเทสค้าง
async function captureDelays(run) {
  const real = globalThis.setTimeout; const delays = [];
  globalThis.setTimeout = (fn, d, ...a) => { delays.push(d); const t = real(fn, d, ...a); t?.unref?.(); return t; };
  try { return { result: await run(), delays }; } finally { globalThis.setTimeout = real; }
}

test('เหลือ 70s แต่ขั้นขอ 180s → ต้องเริ่มงาน และหั่นงบเหลือ 65s (ไม่โยนทิ้ง)', async () => {
  let starts = 0;
  const { result, delays } = await captureDelays(() =>
    runWithPipelineDeadline(deadlineIn(70_000), () =>
      withTimeoutSignal(() => { starts += 1; return Promise.resolve('เขียนทัน'); }, 180_000, 'generate_A1')));
  assert.equal(starts, 1, 'ต้องได้ลองเขียนจริง');
  assert.equal(result, 'เขียนทัน');
  assert.ok(delays.includes(65_000), `ต้องหั่นเหลือ 65s (เหลือ 70s − เผื่อ 5s) แต่ตั้งไว้ ${JSON.stringify(delays)}`);
});

test('เหลือ 62s (อยู่ในช่วง 60–65s) → หักเผื่อ 5s ตรงๆ ได้ 57s ไม่ถูกดันกลับขึ้น 60s', async () => {
  const { delays } = await captureDelays(() =>
    runWithPipelineDeadline(deadlineIn(62_000), () =>
      withTimeoutSignal(() => Promise.resolve('ok'), 180_000, 'generate_A1')));
  assert.ok(delays.includes(57_000), `ต้อง 57s แต่ได้ ${JSON.stringify(delays)}`);
});

test('เหลือ 50s (ต่ำกว่าพื้น 60s) → ยังปฏิเสธก่อนเริ่มเหมือนเดิม', async () => {
  let starts = 0;
  await assert.rejects(
    runWithPipelineDeadline(deadlineIn(50_000), () =>
      withTimeoutSignal(() => { starts += 1; return Promise.resolve('ห้ามถึง'); }, 180_000, 'generate_A1')),
    e => e?.errorType === 'PIPELINE_DEADLINE_EXCEEDED');
  assert.equal(starts, 0);
});

test('ขั้นสั้น (35s) เหลือ 50s → ไม่ถูกหั่น ใช้งบเดิม 35s', async () => {
  const { delays } = await captureDelays(() =>
    runWithPipelineDeadline(deadlineIn(50_000), () =>
      withTimeoutSignal(() => Promise.resolve('ok'), 35_000, 'card_picker')));
  assert.ok(delays.includes(35_000), `งบเดิมต้องอยู่ ${JSON.stringify(delays)}`);
  assert.ok(!delays.includes(45_000), 'ต้องไม่ถูกหั่น');
});
