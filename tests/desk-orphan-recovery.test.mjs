// P7 — desk orphan recovery opt-in guard
// Offline only: storage, clock, logger, and interval are injected; no real queue/Supabase/files are touched.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORPHAN_KINDS,
  ORPHAN_LEGACY_STALE_MS,
  ORPHAN_MAX_ROUNDS,
  ORPHAN_STALE_MS,
  recoverOrphanJobs,
} from '../src/lib/quickTestJobs.js';
import { startOrphanRescan } from '../src/instrumentation-node.js';

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const DEAD_BOOT_ID = 'boot_dead_before_p7';
const CURRENT_BOOT_ID = 'boot_current_p7_test';
const isoAgo = (ms) => new Date(NOW - ms).toISOString();

function mkJob(overrides = {}) {
  return {
    id: 'p7_job',
    kind: 'desk_harvest',
    dispatch: 'local',
    status: 'running',
    label: 'P7 offline fixture',
    input: {},
    progress: { step: 'กำลังล่าข่าว', pct: 25 },
    result: null,
    error: null,
    retries: 0,
    ownerBootId: DEAD_BOOT_ID,
    ownerPort: '3900',
    createdAt: isoAgo(10 * 60 * 1000),
    claimedAt: isoAgo(10 * 60 * 1000),
    startedAt: isoAgo(10 * 60 * 1000),
    finishedAt: null,
    ...overrides,
  };
}

function mkDeps(initialJobs) {
  const store = new Map(initialJobs.map((job) => [job.id, structuredClone(job)]));
  const saved = [];
  const logs = [];
  return {
    store,
    saved,
    logs,
    listJobs: async () => Array.from(store.values()).map((job) => structuredClone(job)),
    saveJob: async (job) => {
      const copy = structuredClone(job);
      store.set(copy.id, copy);
      saved.push(copy);
      return copy;
    },
    log: (...args) => logs.push(args.join(' ')),
    bootId: CURRENT_BOOT_ID,
    port: '3900',
    now: () => NOW,
  };
}

async function run(initialJobs, env = {}) {
  const deps = mkDeps(initialJobs);
  const result = await recoverOrphanJobs({ env, _deps: deps });
  return { deps, result };
}

function assertOriginPending(updated, original, expectedRetries = 1) {
  assert.equal(updated.status, 'pending');
  assert.equal(updated.dispatch, 'team');
  assert.equal(updated.retries, expectedRetries);
  assert.equal(updated.claimedAt, null);
  assert.ok(updated.recoveredAt);
  assert.match(updated.progress.step, new RegExp(`${expectedRetries}/${ORPHAN_MAX_ROUNDS}`));
  assert.equal(updated.kind, original.kind);
  assert.deepEqual(updated.input, original.input);
}

test('default: desk_harvest ค้าง 10 นาทีไม่ถูกกู้และไม่ถูกเขียนทับ', async () => {
  const job = mkJob();
  const { deps, result } = await run([job]);

  assert.deepEqual(result, { scanned: 0, recovered: 0, failed: 0, on: true });
  assert.equal(deps.saved.length, 0);
  assert.deepEqual(deps.store.get(job.id), job);
});

test("DESK_ORPHAN_RECOVERY ต้องเท่ากับ '1' ตรงตัวเท่านั้น; ค่าอื่นยังข้าม desk_*", async () => {
  await Promise.all(['0', 'true', '01', ' 1 '].map(async (value) => {
    const job = mkJob({ id: `desk_disabled_${value.trim() || 'blank'}` });
    const { deps, result } = await run([job], { DESK_ORPHAN_RECOVERY: value });
    assert.equal(result.scanned, 0, `value=${JSON.stringify(value)}`);
    assert.equal(deps.saved.length, 0, `value=${JSON.stringify(value)}`);
  }));
});

test('DESK_ORPHAN_RECOVERY=1: desk_harvest กลับไปกู้เหมือน origin/main ทุกขั้น', async () => {
  const job = mkJob({ retries: 2 });
  const { deps, result } = await run([job], { DESK_ORPHAN_RECOVERY: '1' });

  assert.deepEqual(result, { scanned: 1, recovered: 1, failed: 0, on: true });
  assertOriginPending(deps.store.get(job.id), job, 3);
});

test('default ครอบคลุม desk_harvest/desk_search/desk_chief: ทุกชนิดถูกข้าม', async () => {
  const deskKinds = ORPHAN_KINDS.filter((kind) => kind.startsWith('desk_'));
  const jobs = deskKinds.map((kind, index) => mkJob({ id: `desk_${index}`, kind }));
  const { deps, result } = await run(jobs);

  assert.deepEqual(deskKinds, ['desk_harvest', 'desk_search', 'desk_chief']);
  assert.equal(result.scanned, 0);
  assert.equal(result.recovered, 0);
  assert.equal(deps.saved.length, 0);
  for (const job of jobs) assert.deepEqual(deps.store.get(job.id), job);
});

test('parity ปก compose: switch ใหม่ทั้งไม่ตั้ง/ปิด/เปิด ให้ผล origin/main เดิม', async () => {
  await Promise.all([{}, { DESK_ORPHAN_RECOVERY: '0' }, { DESK_ORPHAN_RECOVERY: '1' }].map(async (env) => {
    const job = mkJob({ id: `compose_${env.DESK_ORPHAN_RECOVERY ?? 'unset'}`, kind: 'compose' });
    const { deps, result } = await run([job], env);
    assert.deepEqual(result, { scanned: 1, recovered: 1, failed: 0, on: true });
    assertOriginPending(deps.store.get(job.id), job);
  }));
});

test('parity ปก ref: switch ใหม่ทั้งไม่ตั้ง/ปิด/เปิด ให้ผล origin/main เดิม', async () => {
  await Promise.all([{}, { DESK_ORPHAN_RECOVERY: '0' }, { DESK_ORPHAN_RECOVERY: '1' }].map(async (env) => {
    const job = mkJob({ id: `ref_${env.DESK_ORPHAN_RECOVERY ?? 'unset'}`, kind: 'ref' });
    const { deps, result } = await run([job], env);
    assert.deepEqual(result, { scanned: 1, recovered: 1, failed: 0, on: true });
    assertOriginPending(deps.store.get(job.id), job);
  }));
});

test('mixed queue default: ข้าม desk แต่ compose/ref ยังถูกกู้และนับผลเหมือนเดิม', async () => {
  const desk = mkJob({ id: 'mixed_desk' });
  const compose = mkJob({ id: 'mixed_compose', kind: 'compose' });
  const ref = mkJob({ id: 'mixed_ref', kind: 'ref' });
  const { deps, result } = await run([desk, compose, ref]);

  assert.deepEqual(result, { scanned: 2, recovered: 2, failed: 0, on: true });
  assert.deepEqual(deps.store.get(desk.id), desk);
  assertOriginPending(deps.store.get(compose.id), compose);
  assertOriginPending(deps.store.get(ref.id), ref);
});

test('ค่าคงที่ฝั่งปกไม่เปลี่ยนจาก origin/main: kinds, STALE_MS, legacy stale, MAX_ROUNDS', () => {
  assert.deepEqual(ORPHAN_KINDS, ['compose', 'ref', 'desk_harvest', 'desk_search', 'desk_chief']);
  assert.equal(ORPHAN_STALE_MS, 90 * 1000);
  assert.equal(ORPHAN_LEGACY_STALE_MS, 40 * 60 * 1000);
  assert.equal(ORPHAN_MAX_ROUNDS, 6);
});

test('MEGA_ORPHAN_RECOVERY=0 ยังปิดทั้งระบบก่อนอ่านคลัง แม้ DESK_ORPHAN_RECOVERY=1', async () => {
  let listCalls = 0;
  const result = await recoverOrphanJobs({
    env: { MEGA_ORPHAN_RECOVERY: '0', DESK_ORPHAN_RECOVERY: '1' },
    _deps: {
      listJobs: async () => { listCalls++; return [mkJob()]; },
      saveJob: async () => assert.fail('kill-switch ต้องไม่เขียนคลัง'),
    },
  });

  assert.deepEqual(result, { scanned: 0, recovered: 0, failed: 0, on: false });
  assert.equal(listCalls, 0);
});

test('desk ที่ถูกข้ามมี log 1 บรรทัดระบุ job/kind/switch และไม่แก้ schema หรืองาน', async () => {
  const job = mkJob({ id: 'desk_trace', kind: 'desk_search' });
  const { deps } = await run([job]);

  assert.equal(deps.logs.length, 1);
  assert.match(deps.logs[0], /desk_trace/);
  assert.match(deps.logs[0], /desk_search/);
  assert.match(deps.logs[0], /DESK_ORPHAN_RECOVERY/);
  assert.equal(deps.saved.length, 0);
  assert.deepEqual(deps.store.get(job.id), job);
});

test('desk ยังไม่ stale ไม่ถูกกู้และไม่สร้าง skip log เท็จ', async () => {
  const job = mkJob({ claimedAt: isoAgo(30 * 1000), startedAt: isoAgo(30 * 1000) });
  const { deps, result } = await run([job]);

  assert.equal(result.scanned, 0);
  assert.equal(deps.saved.length, 0);
  assert.equal(deps.logs.length, 0);
});

test('desk retries=6: default ไม่ mark failed; opt-in=1 ใช้เพดานเดิมและ mark failed', async () => {
  const job = mkJob({ id: 'desk_round_limit', retries: ORPHAN_MAX_ROUNDS });
  const disabled = await run([job]);
  assert.equal(disabled.result.failed, 0);
  assert.equal(disabled.deps.saved.length, 0);

  const enabled = await run([job], { DESK_ORPHAN_RECOVERY: '1' });
  assert.deepEqual(enabled.result, { scanned: 1, recovered: 0, failed: 1, on: true });
  assert.equal(enabled.deps.store.get(job.id).status, 'failed');
  assert.equal(enabled.deps.store.get(job.id).retries, ORPHAN_MAX_ROUNDS + 1);
});

test('startOrphanRescan ยังตั้งรอบ 120 วินาที และ tick ที่มีแต่ desk ค้างไม่กู้', async () => {
  delete globalThis.__ORPHAN_RESCAN_STARTED;
  delete globalThis.__ORPHAN_RESCAN_HANDLE;
  const job = mkJob({ id: 'rescan_desk' });
  const deps = mkDeps([job]);
  let capturedMs = null;
  let recoveryCalls = 0;
  const handle = startOrphanRescan({
    platform: 'win32',
    env: {},
    _deps: {
      setInterval: (_fn, ms) => {
        capturedMs = ms;
        return { unref() {} };
      },
      recoverOrphanJobs: async () => {
        recoveryCalls++;
        return recoverOrphanJobs({ env: {}, _deps: deps });
      },
    },
  });

  assert.ok(handle);
  assert.equal(capturedMs, 120000);
  await handle.tick();
  assert.equal(recoveryCalls, 1);
  assert.equal(deps.saved.length, 0);
  assert.deepEqual(deps.store.get(job.id), job);
});
