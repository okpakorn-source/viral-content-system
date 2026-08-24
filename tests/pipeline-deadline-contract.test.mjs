import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createPipelineDeadline,
  getActivePipelineDeadline,
  PipelineDeadlineError,
  preparePipelineSignal,
  resolvePipelineDeadlineAt,
  resolveNewsQueueTiming,
  rethrowPipelineDeadline,
  runWithPipelineDeadline,
} from '../src/lib/utils/pipelineDeadline.js';
import { withTimeoutSignal } from '../src/lib/utils/withTimeout.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(`${ROOT}/${path}`, 'utf8');

function geminiRequestOptionsFromSource() {
  const source = read('src/lib/ai/geminiClient.js');
  const start = source.indexOf('export function buildGeminiRequestOptions(');
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start);
  const declaration = source.slice(start, end).replace('export function', 'function');
  return new Function(`${declaration}; return buildGeminiRequestOptions;`)();
}

function fakeClock(start = 0) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(callback, delay) {
      const timer = { id: ++nextId, at: now + delay, callback, unref() {} };
      timers.set(timer.id, timer);
      return timer;
    },
    clearTimer(timer) { timers.delete(timer?.id); },
    pendingTimers() { return timers.size; },
    advance(ms) {
      now += ms;
      const due = [...timers.values()].filter(timer => timer.at <= now);
      for (const timer of due) {
        timers.delete(timer.id);
        timer.callback();
      }
    },
  };
}

test('เวลาไม่พอสำหรับขั้น AI ต้องปฏิเสธก่อนเริ่ม network factory', async () => {
  const clock = fakeClock();
  const deadline = createPipelineDeadline({
    deadlineAt: 100,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  let starts = 0;
  await assert.rejects(
    runWithPipelineDeadline(deadline, () => withTimeoutSignal(() => {
      starts += 1;
      return Promise.resolve('illegal');
    }, 180, 'late_ai')),
    error => error?.errorType === 'PIPELINE_DEADLINE_EXCEEDED'
      && error?.failedStep === 'pipeline_deadline',
  );
  assert.equal(starts, 0);
});

test('deadline กลางต้อง abort signal ของ HTTP จริง ไม่ใช่แค่หยุดรอ', async () => {
  const clock = fakeClock();
  const deadline = createPipelineDeadline({
    deadlineAt: 1_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  let observedAbort = false;
  const pending = runWithPipelineDeadline(deadline, () => withTimeoutSignal(
    signal => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort = true;
        reject(signal.reason);
      }, { once: true });
    }),
    800,
    'pending_ai',
  ));
  await Promise.resolve();
  clock.advance(1_000);
  await assert.rejects(pending, error => error?.errorType === 'PIPELINE_DEADLINE_EXCEEDED');
  assert.equal(observedAbort, true);
});

test('deadline กลางต้องบังคับให้ handler จบ แม้ค้างใน await ที่ไม่รับ signal', async () => {
  const clock = fakeClock();
  const deadline = createPipelineDeadline({
    deadlineAt: 1_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const neverSettles = new Promise(() => {});
  const pending = runWithPipelineDeadline(deadline, () => neverSettles);
  clock.advance(1_000);
  await assert.rejects(
    pending,
    error => error?.errorType === 'PIPELINE_DEADLINE_EXCEEDED'
      && error?.failedStep === 'pipeline_deadline',
  );
  assert.equal(clock.pendingTimers(), 0);
});

test('deadline ที่หมดก่อนเข้า route ต้องปฏิเสธทันทีและห้ามเริ่ม handler', async () => {
  const clock = fakeClock(1_000);
  const deadline = createPipelineDeadline({
    deadlineAt: 999,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  let entered = 0;
  await assert.rejects(
    runWithPipelineDeadline(deadline, async () => { entered += 1; return 'must-not-run'; }),
    error => error?.errorType === 'PIPELINE_DEADLINE_EXCEEDED',
  );
  assert.equal(entered, 0);
  assert.equal(clock.pendingTimers(), 0);
});

test('typed deadline ห้ามถูก catch แล้วเริ่ม fallback ตัวใหม่', async () => {
  const clock = fakeClock();
  const deadline = createPipelineDeadline({
    deadlineAt: 100,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  let primaryStarts = 0;
  let fallbackStarts = 0;
  await assert.rejects(runWithPipelineDeadline(deadline, async () => {
    try {
      await withTimeoutSignal(() => {
        primaryStarts += 1;
        return Promise.resolve();
      }, 180, 'primary');
    } catch (error) {
      rethrowPipelineDeadline(error, 'primary');
      fallbackStarts += 1;
    }
  }), error => error?.errorType === 'PIPELINE_DEADLINE_EXCEEDED');
  assert.equal(primaryStarts, 0);
  assert.equal(fallbackStarts, 0);
});

test('client signal ถูกผูกกับ deadline และ header ขยายเวลาเกินเพดานไม่ได้', async () => {
  const clock = fakeClock(5_000);
  const deadline = createPipelineDeadline({
    deadlineAt: 6_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  let linked;
  const task = runWithPipelineDeadline(deadline, async () => {
    linked = preparePipelineSignal(undefined, 'client', 500);
    assert.equal(linked.aborted, false);
    await new Promise(resolve => linked.addEventListener('abort', resolve, { once: true }));
  });
  await Promise.resolve();
  clock.advance(1_000);
  await assert.rejects(task, error => error?.errorType === 'PIPELINE_DEADLINE_EXCEEDED');
  assert.equal(linked.aborted, true);
  assert.equal(resolvePipelineDeadlineAt('9999999999999', 10_000, 700_000), 710_000);
  assert.equal(resolvePipelineDeadlineAt('50000', 10_000, 700_000), 50_000);
  assert.equal(resolvePipelineDeadlineAt('bad', 10_000, 700_000), 710_000);
  assert.deepEqual(resolveNewsQueueTiming('770000'), {
    workerDeadlineMs: 770_000,
    pipelineBudgetMs: 700_000,
  });
  assert.deepEqual(resolveNewsQueueTiming('120000'), {
    workerDeadlineMs: 120_000,
    pipelineBudgetMs: 50_000,
  });
  assert.deepEqual(resolveNewsQueueTiming('70000'), {
    workerDeadlineMs: 770_000,
    pipelineBudgetMs: 700_000,
  });
  assert.deepEqual(resolveNewsQueueTiming('790000'), {
    workerDeadlineMs: 770_000,
    pipelineBudgetMs: 700_000,
  });
});

test('AsyncLocalStorage แยก deadline ของคำขอพร้อมกัน และ dispose ไม่ทิ้ง timer/งานลูก', async () => {
  const clockA = fakeClock(0);
  const clockB = fakeClock(10_000);
  const deadlineA = createPipelineDeadline({
    deadlineAt: 1_000,
    now: clockA.now,
    setTimer: clockA.setTimer,
    clearTimer: clockA.clearTimer,
  });
  const deadlineB = createPipelineDeadline({
    deadlineAt: 12_000,
    now: clockB.now,
    setTimer: clockB.setTimer,
    clearTimer: clockB.clearTimer,
  });
  let childA;
  let childB;
  await Promise.all([
    runWithPipelineDeadline(deadlineA, async () => {
      assert.strictEqual(getActivePipelineDeadline(), deadlineA);
      childA = preparePipelineSignal(undefined, 'request_a', 100);
      await Promise.resolve();
      assert.strictEqual(getActivePipelineDeadline(), deadlineA);
    }),
    runWithPipelineDeadline(deadlineB, async () => {
      assert.strictEqual(getActivePipelineDeadline(), deadlineB);
      childB = preparePipelineSignal(undefined, 'request_b', 100);
      await Promise.resolve();
      assert.strictEqual(getActivePipelineDeadline(), deadlineB);
    }),
  ]);
  assert.equal(childA.aborted, true);
  assert.equal(childB.aborted, true);
  assert.equal(clockA.pendingTimers(), 0);
  assert.equal(clockB.pendingTimers(), 0);
  assert.equal(getActivePipelineDeadline(), null);
});

test('หลายมุมที่ทำงานพร้อมกันต้องไม่เขียนทับชื่อ deadlineStep กัน', () => {
  const clock = fakeClock();
  const deadline = createPipelineDeadline({
    deadlineAt: 1_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  deadline.assertCanStart('angle_1', 100);
  deadline.assertCanStart('angle_2', 100);
  clock.advance(1_000);
  assert.equal(deadline.signal.reason?.deadlineStep, 'pipeline');
  deadline.dispose();
});

test('parent abort ต้องหยุด factory ของ stage และถอด listener หลังจบ', async () => {
  const parent = new AbortController();
  let observedAbort = false;
  const pending = withTimeoutSignal(
    signal => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort = true;
        reject(signal.reason);
      }, { once: true });
    }),
    5_000,
    'stage_parent_abort',
    parent.signal,
  );
  const reason = new PipelineDeadlineError('parent');
  parent.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(observedAbort, true);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort(reason);
  assert.throws(
    () => preparePipelineSignal(alreadyAborted.signal, 'must_not_start', 1),
    error => error === reason,
  );
});

test('Gemini request options ส่ง timeout และ signal เป็นอาร์กิวเมนต์ชั้นนอก', () => {
  const buildGeminiRequestOptions = geminiRequestOptionsFromSource();
  const signal = new AbortController().signal;
  assert.deepEqual(buildGeminiRequestOptions(signal), { timeout: 15000, signal });
  assert.deepEqual(buildGeminiRequestOptions(), { timeout: 15000 });
});

test('production wiring ส่ง deadline จาก worker ถึง route/AI, Sol audit สองรอบ และ editor หนึ่งครั้ง', () => {
  const worker = read('src/app/api/queue/worker/route.js');
  const route = read('src/app/api/auto/process/route.js');
  const rawGate = read('src/lib/services/rawFactCompletenessGate.js');
  const autoFlow = read('src/lib/services/autoFlowServiceText.js');
  assert.match(worker, /x-news-pipeline-deadline-at/u);
  assert.match(worker, /NEWS_PIPELINE_BUDGET_MS/u);
  assert.match(route, /runWithPipelineDeadline\(\s*deadline/u);
  assert.match(route, /status: deadlineFailure \? 504 : 500/u);
  assert.match(rawGate, /assertCanStart\('raw_fact_audit_initial', 180_000\)/u);
  assert.match(rawGate, /assertCanStart\('raw_fact_editor', 180_000\)/u);
  assert.match(rawGate, /assertCanStart\('raw_fact_audit_final', 180_000\)/u);
  assert.equal((rawGate.match(/await repairBatch\(/gu) || []).length, 1);
  assert.match(autoFlow, /throwIfExpired\('final_workflow_persist'\)/u);
  assert.doesNotMatch(autoFlow, /throwIfExpired\('final_success_log'\)/u,
    'หลัง authoritative save แล้ว final telemetry ห้ามเปลี่ยนข่าวสำเร็จเป็น deadline failure');
  assert.match(autoFlow, /settleTelemetryWithinReserve/u,
    'post-persist telemetry ต้องมี response reserve แบบ bounded');
  assert.match(autoFlow, /\{ signal: finalDeadline\?\.signal \}/u);
  for (const client of ['openai.js', 'claudeClient.js', 'geminiClient.js']) {
    assert.match(read(`src/lib/ai/${client}`), /preparePipelineSignal/u);
  }
  assert.match(read('src/lib/ai/geminiClient.js'), /generateContent\(prompt, buildGeminiRequestOptions\(requestSignal\)\)/u);
  assert.doesNotMatch(read('src/lib/ai/geminiClient.js'), /requestOptions:\s*\{\s*timeout: 15000/u);
});

function deadlineFactoryFromSource(source) {
  const start = source.indexOf('export function createPipelineDeadline(');
  const end = source.indexOf('\nexport function runWithPipelineDeadline', start);
  assert.ok(start >= 0 && end > start);
  const fn = source.slice(start, end).replace('export function', 'function');
  return new Function('AbortController', 'PipelineDeadlineError', `${fn}; return createPipelineDeadline;`)(
    AbortController,
    PipelineDeadlineError,
  );
}

function deadlineRunnerFromSource(source) {
  const start = source.indexOf('export function runWithPipelineDeadline');
  const end = source.indexOf('\nexport function getActivePipelineDeadline', start);
  assert.ok(start >= 0 && end > start);
  const fn = source.slice(start, end).replace('export function', 'function');
  const deadlineStorage = { run: (_deadline, runner) => runner() };
  return new Function('deadlineStorage', 'PipelineDeadlineError', `${fn}; return runWithPipelineDeadline;`)(
    deadlineStorage,
    PipelineDeadlineError,
  );
}

test('mutation: ถอด preflight หรือ controller.abort แล้วข้อสอบต้องจับได้', () => {
  const source = read('src/lib/utils/pipelineDeadline.js');
  const noPreflight = deadlineFactoryFromSource(source.replace(
    'if (controller.signal.aborted || remainingMs() < required) {',
    'if (false) {',
  ));
  const noAbort = deadlineFactoryFromSource(source.replace(
    'if (!controller.signal.aborted) controller.abort(timeoutError());',
    'if (!controller.signal.aborted) void timeoutError();',
  ));

  const clockA = fakeClock();
  const brokenA = noPreflight({ deadlineAt: 10, now: clockA.now, setTimer: clockA.setTimer, clearTimer: clockA.clearTimer });
  assert.doesNotThrow(() => brokenA.assertCanStart('illegal', 20));
  brokenA.dispose();

  const clockB = fakeClock();
  const brokenB = noAbort({ deadlineAt: 10, now: clockB.now, setTimer: clockB.setTimer, clearTimer: clockB.clearTimer });
  clockB.advance(10);
  assert.equal(brokenB.signal.aborted, false);
  brokenB.dispose();
});

test('mutation: ถอด hard Promise.race แล้ว await ที่ค้างต้องไม่ถูกนับว่าปลอดภัย', async () => {
  const source = read('src/lib/utils/pipelineDeadline.js');
  const brokenRunner = deadlineRunnerFromSource(source.replace(
    'return await Promise.race([Promise.resolve().then(fn), deadlineReached]);',
    'deadlineReached.catch(() => {}); return await Promise.resolve().then(fn);',
  ));
  const clock = fakeClock();
  const deadline = createPipelineDeadline({
    deadlineAt: 10,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  let settled = false;
  brokenRunner(deadline, () => new Promise(() => {})).finally(() => { settled = true; });
  clock.advance(10);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false, 'mutant ไม่มี hard race จึงยังค้าง — production test ต้องไม่ยอมรับ');
  deadline.dispose();
});
