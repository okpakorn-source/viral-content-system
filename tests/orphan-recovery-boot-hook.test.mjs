// ============================================================
// 🩹 recoverOrphanJobsOnBoot (29 ก.ค. 69, แบตช์เสถียรภาพ) — src/instrumentation-node.js
// ------------------------------------------------------------
// พิสูจน์: (1) เรียกครั้งแรก → เรียก recoverOrphanJobs จริง 1 ครั้ง (2) เรียกซ้ำในโปรเซสเดียวกัน (เช่น dev
//   hot-reload เรียก register() ซ้ำ) → ไม่สแกนซ้ำ (idempotent — กันงาน local ที่ยังรันสดอยู่จริงในโปรเซสเดียวกัน
//   ถูกเข้าใจผิดว่ากำพร้า เพราะ claimedAt ค้างเกิน 90 วิได้ตามปกติระหว่าง callOnce ยาวๆ)
//   (3) recoverOrphanJobs throw → ไม่ throw ออกนอก (ไม่กระทบการบูตเซิร์ฟเวอร์)
// harness: stub './lib/quickTestJobs.js' (relative จาก src/instrumentation-node.js) ผ่าน globalThis counter
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

const STUB_QTJ = _mod(`
export async function recoverOrphanJobs() {
  globalThis.__TEST_RECOVER_CALLS = (globalThis.__TEST_RECOVER_CALLS || 0) + 1;
  if (globalThis.__TEST_RECOVER_SHOULD_THROW) throw new Error('recoverOrphanJobs ล้มจำลอง');
  return { scanned: 1, recovered: 1, failed: 0, on: true };
}
`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === './lib/quickTestJobs.js' || specifier.endsWith('/lib/quickTestJobs.js')) {
    return { url: ${JSON.stringify(STUB_QTJ)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook));

const { recoverOrphanJobsOnBoot, startOrphanRescan } = await import('../src/instrumentation-node.js');

test('เรียกครั้งแรก → recoverOrphanJobs ถูกเรียกจริง 1 ครั้ง', async () => {
  globalThis.__TEST_RECOVER_CALLS = 0;
  globalThis.__ORPHAN_RECOVERY_RAN = false;
  await recoverOrphanJobsOnBoot();
  assert.equal(globalThis.__TEST_RECOVER_CALLS, 1);
});

test('เรียกซ้ำในโปรเซสเดียวกัน (จำลอง dev hot-reload เรียก register() ซ้ำ) → ไม่สแกนซ้ำ (idempotent)', async () => {
  globalThis.__TEST_RECOVER_CALLS = 0;
  globalThis.__ORPHAN_RECOVERY_RAN = false;
  await recoverOrphanJobsOnBoot();
  await recoverOrphanJobsOnBoot();
  await recoverOrphanJobsOnBoot();
  assert.equal(globalThis.__TEST_RECOVER_CALLS, 1, 'เรียก 3 ครั้ง แต่ recoverOrphanJobs จริงต้องรันแค่ 1 ครั้ง');
});

test('recoverOrphanJobs throw ข้างใน → ไม่ throw ออกมานอก recoverOrphanJobsOnBoot (ไม่กระทบการบูต)', async () => {
  globalThis.__TEST_RECOVER_CALLS = 0;
  globalThis.__ORPHAN_RECOVERY_RAN = false;
  globalThis.__TEST_RECOVER_SHOULD_THROW = true;
  await assert.doesNotReject(() => recoverOrphanJobsOnBoot());
  globalThis.__TEST_RECOVER_SHOULD_THROW = false;
});

// ============================================================
// 🩹 29 ก.ค. 69 (Opus เก็บเล็ก — หลัง hotfix ผ่าน) — ประตูกัน cloud: register() รันทุก process start รวม Vercel
//   lambda ด้วย คิว dispatch='local'/'team' เป็นของเครื่องทีมเท่านั้น cloud ต้องไม่แตะเลย (แม้แต่อ่าน)
// ============================================================
test('recoverOrphanJobsOnBoot: platform ไม่ใช่ win32 (cloud/Vercel lambda) → ไม่เรียก recoverOrphanJobs เลย ไม่แม้แต่ตั้ง __ORPHAN_RECOVERY_RAN', async () => {
  globalThis.__TEST_RECOVER_CALLS = 0;
  globalThis.__ORPHAN_RECOVERY_RAN = false;
  await recoverOrphanJobsOnBoot({ platform: 'linux' });
  assert.equal(globalThis.__TEST_RECOVER_CALLS, 0, 'cloud ต้องไม่เรียก recoverOrphanJobs เลย');
});

test('recoverOrphanJobsOnBoot: platform=win32 (เครื่องทีม) → ทำงานปกติเหมือนเดิม (default param = process.platform จริง)', async () => {
  globalThis.__TEST_RECOVER_CALLS = 0;
  globalThis.__ORPHAN_RECOVERY_RAN = false;
  await recoverOrphanJobsOnBoot({ platform: 'win32' });
  assert.equal(globalThis.__TEST_RECOVER_CALLS, 1, 'เครื่องทีม (win32) ต้องทำงานปกติ ไม่ถูกกันโดยประตูใหม่');
});

// ============================================================
// 🩹 29 ก.ค. 69 คืน — startOrphanRescan (Opus fix #4, บั๊กจุดที่ 2): สแกนซ้ำเป็นรอบ ไม่ใช่แค่ตอนบูต
// harness: ฉีด _deps.setInterval (แทนตัวจริง — เทสเรียก tick() ตรงๆ แทนรอเวลาจริง) + _deps.recoverOrphanJobs
//   (แทน dynamic import จริง) ตามแพทเทิร์นเดียวกับ tests/orphan-job-recovery.test.mjs
// ============================================================
const resetRescanGlobals = () => {
  delete globalThis.__ORPHAN_RESCAN_STARTED;
  delete globalThis.__ORPHAN_RESCAN_HANDLE;
};

// ★ 29 ก.ค. 69 (Opus เก็บเล็ก): ประตูกัน cloud เดียวกับ recoverOrphanJobsOnBoot ด้านบน
test('startOrphanRescan: platform ไม่ใช่ win32 (cloud/Vercel lambda) → ไม่ตั้ง interval เลย (คืน null, ไม่แตะ setInterval แม้แต่ครั้งเดียว)', () => {
  resetRescanGlobals();
  let setIntervalCalled = false;
  const fakeSetInterval = () => { setIntervalCalled = true; return { unref: () => {} }; };
  const handle = startOrphanRescan({ platform: 'linux', _deps: { setInterval: fakeSetInterval } });
  assert.equal(handle, null, 'cloud ต้องไม่ตั้ง interval เลย');
  assert.ok(!setIntervalCalled, 'ต้องไม่เรียก setInterval แม้แต่ครั้งเดียวบน cloud');
});

test('startOrphanRescan: platform=win32 (เครื่องทีม) → ตั้ง interval ปกติเหมือนเดิม (default param = process.platform จริง)', () => {
  resetRescanGlobals();
  let setIntervalCalled = false;
  const fakeSetInterval = () => { setIntervalCalled = true; return { unref: () => {} }; };
  const handle = startOrphanRescan({ platform: 'win32', _deps: { setInterval: fakeSetInterval } });
  assert.ok(handle, 'เครื่องทีม (win32) ต้องตั้ง interval ได้ปกติ ไม่ถูกกันโดยประตูใหม่');
  assert.ok(setIntervalCalled);
});

test('startOrphanRescan: ตั้ง interval จริง (ส่ง _deps.setInterval เอง) ด้วยคาบเวลาตาม intervalMs ที่ส่งมา', () => {
  resetRescanGlobals();
  let capturedMs = null, capturedFn = null;
  const fakeSetInterval = (fn, ms) => { capturedFn = fn; capturedMs = ms; return { unref: () => {} }; };
  const handle = startOrphanRescan({ intervalMs: 5000, _deps: { setInterval: fakeSetInterval } });
  assert.equal(capturedMs, 5000);
  assert.equal(typeof capturedFn, 'function');
  assert.ok(handle && typeof handle.tick === 'function', 'ต้องคืน handle มี tick ให้เทสเรียกตรงได้');
});

test('startOrphanRescan: tick() เรียก recoverOrphanJobs จริง 1 ครั้งต่อ 1 tick', async () => {
  resetRescanGlobals();
  let calls = 0;
  const fakeSetInterval = () => ({ unref: () => {} });
  const handle = startOrphanRescan({ _deps: { setInterval: fakeSetInterval, recoverOrphanJobs: async () => { calls++; return { scanned: 1, recovered: 1, failed: 0, on: true }; } } });
  await handle.tick();
  assert.equal(calls, 1);
  await handle.tick();
  assert.equal(calls, 2, 'เรียก tick() ซ้ำ (จำลอง interval ยิงหลายรอบ) ต้องเรียก recoverOrphanJobs ทุกครั้งที่ไม่ซ้อนกัน');
});

test('startOrphanRescan: guard กันซ้อน — tick() รอบใหม่ระหว่างรอบเก่ายังไม่จบ (recoverOrphanJobs ช้า) ต้องถูกข้าม ไม่ยิงซ้อน', async () => {
  resetRescanGlobals();
  let calls = 0;
  let resolveFirst;
  // ★ เฉพาะการเรียกครั้งแรกที่ "ช้า" (ค้างรอ resolveFirst จำลอง recoverOrphanJobs กำลังทำงานอยู่) — ครั้งถัดไป
  //   (หลัง inFlight ปลดล็อกแล้ว) ต้อง resolve ปกติทันที ไม่งั้นเทสจะค้างรอ resolveFirst ที่ไม่มีใครเรียกซ้ำอีก
  const recoverOrphanJobsMock = () => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
    return Promise.resolve({ scanned: 0, recovered: 0, failed: 0, on: true });
  };
  const fakeSetInterval = () => ({ unref: () => {} });
  const handle = startOrphanRescan({ _deps: { setInterval: fakeSetInterval, recoverOrphanJobs: recoverOrphanJobsMock } });
  const p1 = handle.tick(); // รอบแรกยังไม่จบ (ค้างรอ resolveFirst)
  const p2 = handle.tick(); // รอบสองยิงมาซ้อน — ต้องถูก guard ข้ามทันที (ไม่เรียก recoverOrphanJobs ซ้ำ)
  await p2; // รอบสองต้อง resolve ทันทีเพราะถูกข้าม (ไม่รอ resolveFirst)
  assert.equal(calls, 1, 'ระหว่างรอบแรกยังไม่จบ รอบสองต้องไม่เรียก recoverOrphanJobs ซ้ำ (กันยิงซ้อน)');
  resolveFirst({ scanned: 0, recovered: 0, failed: 0, on: true });
  await p1;
  await handle.tick(); // รอบแรกจบแล้ว (inFlight ปลดล็อกแล้ว) → รอบถัดไปต้องเรียกได้ปกติ
  assert.equal(calls, 2, 'หลังรอบก่อนจบแล้ว (inFlight ปลดล็อก) รอบถัดไปต้องเรียก recoverOrphanJobs ได้ตามปกติ');
});

test('startOrphanRescan: MEGA_ORPHAN_RESCAN=0 → ไม่ตั้ง interval เลย (คืน null ทันที ไม่แตะ setInterval)', () => {
  resetRescanGlobals();
  let setIntervalCalled = false;
  const fakeSetInterval = () => { setIntervalCalled = true; return { unref: () => {} }; };
  const handle = startOrphanRescan({ env: { MEGA_ORPHAN_RESCAN: '0' }, _deps: { setInterval: fakeSetInterval } });
  assert.equal(handle, null);
  assert.ok(!setIntervalCalled, 'ปิดสวิตช์ต้องไม่เรียก setInterval เลยด้วยซ้ำ');
});

test('startOrphanRescan: เรียกซ้ำในโปรเซสเดียวกัน (เช่น register() ถูกเรียกซ้ำตอน dev hot-reload) → ไม่ตั้ง interval ซ้ำ (idempotent)', () => {
  resetRescanGlobals();
  let setIntervalCallCount = 0;
  const fakeSetInterval = () => { setIntervalCallCount++; return { unref: () => {} }; };
  const h1 = startOrphanRescan({ _deps: { setInterval: fakeSetInterval } });
  const h2 = startOrphanRescan({ _deps: { setInterval: fakeSetInterval } });
  const h3 = startOrphanRescan({ _deps: { setInterval: fakeSetInterval } });
  assert.equal(setIntervalCallCount, 1, 'เรียก startOrphanRescan 3 ครั้ง แต่ setInterval จริงต้องถูกตั้งแค่ 1 ครั้ง');
  assert.equal(h2, h1, 'เรียกซ้ำต้องคืน handle เดิม ไม่ใช่ null หรือ handle ใหม่');
  assert.equal(h3, h1);
});

test('startOrphanRescan: default intervalMs (ไม่ส่ง intervalMs/env) → 120000ms (120 วิ) ตามที่ระบุ', () => {
  resetRescanGlobals();
  let capturedMs = null;
  const fakeSetInterval = (fn, ms) => { capturedMs = ms; return { unref: () => {} }; };
  startOrphanRescan({ env: {}, _deps: { setInterval: fakeSetInterval } });
  assert.equal(capturedMs, 120000);
});

test('startOrphanRescan: env MEGA_ORPHAN_RESCAN_MS ปรับคาบเวลาได้', () => {
  resetRescanGlobals();
  let capturedMs = null;
  const fakeSetInterval = (fn, ms) => { capturedMs = ms; return { unref: () => {} }; };
  startOrphanRescan({ env: { MEGA_ORPHAN_RESCAN_MS: '30000' }, _deps: { setInterval: fakeSetInterval } });
  assert.equal(capturedMs, 30000);
});

test('startOrphanRescan: tick() ที่ recoverOrphanJobs throw ข้างใน → ไม่ throw ออกมานอก tick() (ไม่กระทบเซิร์ฟเวอร์) + ปลด inFlight ให้รอบถัดไปทำงานต่อได้', async () => {
  resetRescanGlobals();
  let calls = 0;
  const fakeSetInterval = () => ({ unref: () => {} });
  const handle = startOrphanRescan({ _deps: { setInterval: fakeSetInterval, recoverOrphanJobs: async () => { calls++; throw new Error('ล้มจำลอง'); } } });
  await assert.doesNotReject(() => handle.tick());
  await assert.doesNotReject(() => handle.tick());
  assert.equal(calls, 2, 'แม้รอบก่อน throw ก็ต้องปลด inFlight ให้รอบถัดไปยังเรียกได้ปกติ (ไม่ค้างล็อกถาวร)');
});
