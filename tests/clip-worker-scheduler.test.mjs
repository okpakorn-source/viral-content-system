/**
 * ข้อสอบมาตรการ F — clip-worker รับงานขนาน (เจ้าของเคาะ 9 ก.ย. 69 "วันนึงต้องทำหลายงาน")
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 จุดตายที่ต้องกัน:
 *   1. เกินเพดาน = สมอง CLI โดน BRAIN_BUSY ถอยลงท่อเดิมเงียบๆ (คุณภาพตก) → maxActive ห้ามเกิน concurrency
 *   2. concurrency=1 ต้องเท่าพฤติกรรมเดิมเป๊ะ (ทีละงาน) — กันถอยหลัง
 *   3. pause ต้องหยุด "หยิบใหม่" เท่านั้น งานที่ทำอยู่ห้ามหลุด (สัญญาไฟล์ธง 8 ก.ย.)
 *   4. pullJob ล้ม / runJob โยน ต้องไม่ล้มทั้ง worker
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runWorkerLoop, clampConcurrency } from '../scripts/lib/clip-worker-scheduler.mjs';

const shortSleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2)));
const settle = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 1)); };
function deferred() {
  let resolve; const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function harness({ concurrency, jobs, runJobImpl }) {
  const state = { started: [], active: 0, maxActive: 0, gates: new Map(), pulls: 0, logs: [], stop: false };
  state.paused = false;
  const queue = [...jobs];
  state.loopP = runWorkerLoop({
    concurrency,
    pullJob: async () => { state.pulls += 1; return queue.shift() || null; },
    runJob: runJobImpl || ((job) => {
      state.active += 1; state.maxActive = Math.max(state.maxActive, state.active);
      state.started.push(job.id);
      const d = deferred(); state.gates.set(job.id, d);
      return d.promise.finally(() => { state.active -= 1; });
    }),
    isPaused: () => state.paused,
    sleep: shortSleep, idleMs: 2, errMs: 2,
    log: (kind, e) => state.logs.push([kind, String(e?.message || e)]),
    onPause: () => state.logs.push(['pause']),
    onResume: () => state.logs.push(['resume']),
    shouldStop: () => state.stop,
  });
  // ปิดลูปให้เสมอ (แม้ assertion ตก) — กัน runner แขวนเพราะลูปกำพร้า
  state.shutdown = async () => {
    state.stop = true;
    for (const [, d] of state.gates) d.resolve();
    await state.loopP;
  };
  return state;
}

test('concurrency=2: เริ่มพร้อมกัน 2 งาน · งานที่ 3 ต้องรอช่องว่าง · ห้ามเกิน 2 เด็ดขาด', async (t) => {
  const s = harness({ concurrency: 2, jobs: [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }] });
  t.after(() => s.shutdown());
  await settle();
  assert.deepEqual(s.started, ['j1', 'j2'], 'ต้องเริ่มแค่ 2 งานแรก (งาน 3 รอ)');
  assert.equal(s.maxActive, 2);
  s.gates.get('j1').resolve();
  await settle(12);
  assert.deepEqual(s.started, ['j1', 'j2', 'j3'], 'พองานแรกจบ งานที่ 3 ต้องถูกหยิบ');
  assert.equal(s.maxActive, 2, 'ตลอดชีวิตห้ามเกินเพดาน 2');
});

test('concurrency=1: พฤติกรรมเดิมทีละงาน — งาน 2 เริ่มได้ต่อเมื่องานแรกจบแล้วเท่านั้น', async (t) => {
  const s = harness({ concurrency: 1, jobs: [{ id: 'j1' }, { id: 'j2' }] });
  t.after(() => s.shutdown());
  await settle();
  assert.deepEqual(s.started, ['j1'], 'ห้ามหยิบงาน 2 ระหว่างงานแรกยังทำอยู่');
  s.gates.get('j1').resolve();
  await settle(12);
  assert.deepEqual(s.started, ['j1', 'j2']);
  assert.equal(s.maxActive, 1, 'ทีละงานจริงๆ');
});

test('pause: มีช่องว่างก็ห้ามหยิบงานใหม่ แต่งานที่ทำอยู่ทำต่อจนจบ', async (t) => {
  const s = harness({ concurrency: 2, jobs: [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }] });
  t.after(() => s.shutdown());
  await settle();
  assert.deepEqual(s.started, ['j1', 'j2'], 'สองงานแรกเริ่มก่อน pause · j3 รอในคิว');
  // ช่องเต็มอยู่ → ลูปพักรอช่องว่าง (ยังไม่เห็นธง — ถูกต้อง เพราะ pause มีผลแค่การหยิบใหม่)
  s.paused = true;
  s.gates.get('j1').resolve(); // ช่องว่างเกิดระหว่าง pause — จุดล่อให้หยิบ j3 ถ้าโค้ดผิด
  await settle(8);
  assert.deepEqual(s.started, ['j1', 'j2'], 'มีช่องว่างแล้วก็ห้ามหยิบ j3 ระหว่าง pause');
  assert.equal(s.logs.filter(([k]) => k === 'pause').length, 1, 'log pause ครั้งเดียว');
  const pullsWhilePaused = s.pulls;
  await settle(8);
  assert.equal(s.pulls, pullsWhilePaused, 'ระหว่าง pause ห้ามเรียก pullJob เพิ่ม');
  // งานที่ค้างจบได้ตามปกติระหว่าง pause
  s.gates.get('j2').resolve();
  await settle(4);
  assert.equal(s.active, 0, 'งานค้างต้องจบได้แม้ pause อยู่');
  s.paused = false;
  await settle(10);
  assert.equal(s.logs.filter(([k]) => k === 'resume').length, 1, 'ปลด pause ต้อง log รับงานต่อ');
  assert.deepEqual(s.started, ['j1', 'j2', 'j3'], 'ปลด pause แล้ว j3 ต้องถูกหยิบ');
});

test('pullJob ล้ม: ลง log แล้วถอยไปลองใหม่ — worker ไม่ตาย งานถัดไปยังมา', async (t) => {
  let first = true;
  const started = [];
  let stop = false;
  const loopP = runWorkerLoop({
    concurrency: 1,
    pullJob: async () => {
      if (first) { first = false; throw new Error('เน็ตสะดุด'); }
      return started.length ? null : { id: 'j1' };
    },
    runJob: async (job) => { started.push(job.id); },
    sleep: shortSleep, idleMs: 2, errMs: 2,
    log: () => {},
    shouldStop: () => stop,
  });
  t.after(async () => { stop = true; await loopP; });
  await settle(12);
  assert.deepEqual(started, ['j1'], 'หลัง pull ล้มหนึ่งครั้ง งานต้องยังถูกหยิบต่อ');
});

test('runJob โยน error (ไม่ควรเกิด): จับลง log ปล่อยช่องว่าง แล้วรับงานถัดไปต่อ', async (t) => {
  const started = [];
  const logs = [];
  let stop = false;
  const queue = [{ id: 'ระเบิด' }, { id: 'j2' }];
  const loopP = runWorkerLoop({
    concurrency: 1,
    pullJob: async () => queue.shift() || null,
    runJob: async (job) => {
      if (job.id === 'ระเบิด') throw new Error('บึ้ม');
      started.push(job.id);
    },
    sleep: shortSleep, idleMs: 2, errMs: 2,
    log: (kind, e) => logs.push([kind, String(e?.message || e)]),
    shouldStop: () => stop,
  });
  t.after(async () => { stop = true; await loopP; });
  await settle(12);
  assert.deepEqual(started, ['j2'], 'งานถัดไปต้องยังถูกทำ');
  assert.ok(logs.some(([k, m]) => k === 'job-crash' && m.includes('บึ้ม')), 'ต้องเห็นร่องรอยงานที่ระเบิด');
});

test('clampConcurrency: ค่าเพี้ยนทุกแบบ = 1 (พฤติกรรมเดิม) · เพดาน 4', () => {
  for (const raw of [undefined, null, '', 'x', 0, -3, 2.5, '1.5', {}]) {
    assert.equal(clampConcurrency(raw), 1, `${String(raw)} ต้องได้ 1`);
  }
  assert.equal(clampConcurrency(2), 2);
  assert.equal(clampConcurrency('2'), 2);
  assert.equal(clampConcurrency(4), 4);
  assert.equal(clampConcurrency(9), 4, 'เกินเพดานต้องถูกกดเหลือ 4');
});

test('เดินสายจริงใน scripts/clip-worker.mjs — ลูปจริงใช้ scheduler ไม่ใช่โมดูลลอย', () => {
  const src = readFileSync(new URL('../scripts/clip-worker.mjs', import.meta.url), 'utf8');
  assert.match(src, /clip-worker-scheduler\.mjs/, 'ต้อง import scheduler');
  assert.match(src, /clampConcurrency\(process\.env\.CLIP_WORKER_CONCURRENCY\)/, 'เพดานต้องมาจาก env ผ่านตัว clamp');
  assert.match(src, /runWorkerLoop\(\{/, 'loop() ต้องมอบงานให้ scheduler');
  assert.match(src, /concurrency:\s*CONCURRENCY/, 'ต้องส่งเพดานเข้า scheduler จริง');
  assert.match(src, /async function runJob\(job\)/, 'ชีวิตหนึ่งงานต้องถูกแยกเป็น runJob');
  assert.ok(!/for \(;;\) \{/.test(src), 'ลูปเก่าต้องถูกถอดออก (ห้ามมีสองลูปซ้อน)');
});
