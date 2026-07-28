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

const { recoverOrphanJobsOnBoot } = await import('../src/instrumentation-node.js');

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
