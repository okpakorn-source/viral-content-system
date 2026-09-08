import test from 'node:test';
import assert from 'node:assert/strict';
import { createCore, thaiDay, actualCost } from '../src/lib/routine/core.mjs';
import { RoutineError, errorReply } from '../src/lib/routine/errors.mjs';

const INPUT = 'เนื้อข่าวต้นฉบับที่ยืนยันแล้วสำหรับทดสอบระบบรับงานข่าว';
const GUARD = 'routine_guard_v1';
const clone = value => value === undefined ? undefined : structuredClone(value);
const failure = () => new RoutineError(503, 'ROUTINE_STORAGE_UNAVAILABLE', 'Storage unavailable');
const rawSuccess = (cost = undefined) => ({
  success: true,
  data: { versions: [{ content: 'ข่าวที่เขียนสำเร็จ', usedModel: 'gpt-5.6-sol' }], generationLog: { caseId: '00042', success: true } },
  ...(cost === undefined ? {} : { cost }),
});

function setup({ env = {}, execute = async () => rawSuccess(), hook = () => {} } = {}) {
  let time = Date.parse('2026-09-08T05:00:00Z');
  let sequence = 0;
  const rows = new Map();
  const calls = [];
  const plans = [];
  const submissions = [];
  const key = (store, id) => `${store}:${id}`;
  const event = async (method, ...args) => { calls.push([method, ...clone(args)]); await hook(method, ...args); };
  const storage = {
    async get(store, id) { await event('get', store, id); return clone(rows.get(key(store, id)) ?? null); },
    async insert(store, id, data) {
      await event('insert', store, id, data);
      if (rows.has(key(store, id))) return false;
      rows.set(key(store, id), clone(data));
      return true;
    },
    async cas(store, id, revision, data) {
      await event('cas', store, id, revision, data);
      if (rows.get(key(store, id))?.revision !== revision) return false;
      rows.set(key(store, id), clone(data));
      return true;
    },
    async remove(store, id, revision) {
      await event('remove', store, id, revision);
      const current = rows.get(key(store, id));
      if (!current || (revision !== undefined && current.revision !== revision)) return false;
      return rows.delete(key(store, id));
    },
    async list(store, { routine, since } = {}) {
      await event('list', store, { routine, since });
      return [...rows].filter(([id]) => id.startsWith(`${store}:`)).map(([, data]) => clone(data))
        .filter(data => (routine === undefined || data.routine === routine) && (since === undefined || data.createdAt >= since));
    },
    async activeQueue() {
      await event('activeQueue');
      return [...rows].filter(([id]) => id.startsWith('job_queue:')).map(([, data]) => clone(data))
        .filter(job => job.payload?.workflowId?.startsWith('routine_') && ['pending', 'processing', 'staging', 'recovering'].includes(job.status));
    },
    async getJob(id) { await event('getJob', id); return clone(rows.get(key('job_queue', id)) ?? null); },
    async enqueue(payload, id) {
      await event('enqueue', payload, id);
      submissions.push(clone({ payload, id }));
      const job = { id, payload: clone(payload), userId: 'discord-bot', status: 'pending', createdAt: new Date(time).toISOString() };
      rows.set(key('job_queue', id), job);
      return clone(job);
    },
    async generation(id) { await event('generation', id); return clone(rows.get(key('generation_logs', id)) ?? null); },
  };
  const core = createCore({
    storage,
    pipeline: { prepare(body, mode) { plans.push(clone({ body, mode })); return { input: body.input, mode }; }, execute: (...args) => execute(...args) },
    now: () => time,
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  });
  const config = { ROUTINE_API_KEY: 'unit-test-key', ...env };
  const dispatch = async (operation, body = {}, { params = {}, query = '', headers = {} } = {}) => {
    const request = new Request(`http://unit.test/api/routine/${operation}${query}`, operation === 'news' || operation === 'jobs'
      ? { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ input: INPUT, routine: 'morning', ...body }) }
      : {});
    try { return await core.dispatch(operation, request, params, config); }
    catch (error) { return errorReply(error); }
  };
  return {
    dispatch, storage, rows, calls, plans, submissions,
    setTime(value) { time = value; },
    time: () => time,
    get(store, id) { return clone(rows.get(key(store, id))); },
    set(store, id, value) { rows.set(key(store, id), clone(value)); },
  };
}

test('Thai accounting day changes exactly at 17:00 UTC; actual cost requires explicit unestimated numeric cost', () => {
  assert.equal(thaiDay(Date.parse('2026-09-08T16:59:59.999Z')), '2026-09-08');
  assert.equal(thaiDay(Date.parse('2026-09-08T17:00:00Z')), '2026-09-09');
  assert.equal(actualCost({ cost: { usd: 0.25 } }), 0.25);
  assert.equal(actualCost({ usage: { costUsd: 0 } }), 0);
  assert.equal(actualCost({ cost: { usd: 3, estimated: true } }), undefined);
  assert.equal(actualCost({ usage: { costUsd: '0.2' } }), undefined);
  assert.equal(actualCost({ cost: { usd: -1 } }), undefined);
});

test('simultaneous async admissions enforce shared CAS concurrency and daily caps', async () => {
  const f = setup({ env: { ROUTINE_MAX_CONCURRENT: '1' } });
  const results = await Promise.all([f.dispatch('jobs', { routine: 'one' }), f.dispatch('jobs', { routine: 'two' })]);
  assert.deepEqual(results.map(result => result.status).sort(), [202, 429]);
  assert.equal(f.submissions.length, 1);
  assert.equal(f.get('routine_meter', GUARD).days['2026-09-08'].jobs, 1);
  const daily = setup({ env: { ROUTINE_DAILY_JOBS: '1', ROUTINE_MAX_CONCURRENT: '10' } });
  assert.equal((await daily.dispatch('jobs')).status, 202);
  assert.equal((await daily.dispatch('jobs', { routine: 'other' })).body.errorType, 'ROUTINE_DAILY_CAP');
  const money = setup({ env: { ROUTINE_DAILY_USD: '0.5', ROUTINE_EST_USD_PER_JOB: '1' } });
  assert.equal((await money.dispatch('jobs')).body.errorType, 'ROUTINE_DAILY_CAP');
  assert.equal(money.submissions.length, 0);
});

test('queued and running routine jobs count together while expired sync leases are excluded', async () => {
  const f = setup({ env: { ROUTINE_MAX_CONCURRENT: '1' } });
  f.set('routine_lease', 'expired', { workflowId: 'routine_expired_00000000-0000-4000-8000-000000000999', expiresAt: f.time() - 1 });
  const first = await f.dispatch('jobs');
  assert.equal(first.status, 202);
  const job = f.get('job_queue', first.body.jobId);
  f.set('job_queue', job.id, { ...job, status: 'processing' });
  assert.equal((await f.dispatch('jobs', { routine: 'other' })).body.errorType, 'ROUTINE_BUSY');
});

test('sync pipeline receives unmodified input and expected mode; cost settlement and lease release are durable', async () => {
  const f = setup({ execute: async (plan, workflowId) => {
    assert.equal(plan.input, INPUT);
    assert.equal(plan.mode, 'news');
    const lease = f.get('routine_lease', workflowId);
    assert.equal(lease.expiresAt, f.time() + 900000);
    return rawSuccess({ usd: 0.4, estimated: false });
  } });
  const result = await f.dispatch('news', { idempotencyKey: 'sync-1' });
  assert.equal(result.status, 200);
  assert.equal(result.body.caseId, '00042');
  assert.deepEqual(result.body.cost, { usd: 0.4, estimated: false });
  assert.ok(Math.abs(f.get('routine_meter', GUARD).days['2026-09-08'].usd - 0.4) < 1e-9);
  assert.equal(f.get('routine_lease', result.body.workflowId), undefined);
  assert.equal((await f.dispatch('news', { idempotencyKey: 'sync-1' })).body.workflowId, result.body.workflowId);
  assert.equal(f.plans.length, 1);
});

test('async enqueue preserves bot payload defaults and every retry resolves to the same job', async () => {
  const f = setup();
  const requests = await Promise.all([f.dispatch('jobs', { idempotencyKey: 'async-1' }), f.dispatch('jobs', { idempotencyKey: 'async-1' })]);
  const accepted = requests.find(reply => reply.status === 202);
  assert.ok(accepted);
  assert.equal(f.submissions.length, 1);
  const replay = await f.dispatch('jobs', { idempotencyKey: 'async-1' });
  assert.deepEqual(replay, accepted);
  assert.deepEqual(f.submissions[0].payload, { input: INPUT, images: [], contentLength: 'medium', preset: '', workflowId: accepted.body.workflowId });
  assert.equal((await f.dispatch('news', { idempotencyKey: 'async-1' })).status, 409);
  assert.equal((await f.dispatch('jobs', { idempotencyKey: 'async-1', input: `${INPUT} เปลี่ยนเนื้อหา` })).body.errorType, 'ROUTINE_IDEMPOTENCY_CONFLICT');
  f.setTime(f.time() + 86400000 + 1);
  const expired = await f.dispatch('jobs', { idempotencyKey: 'async-1' });
  assert.equal(expired.status, 202);
  assert.notEqual(expired.body.jobId, accepted.body.jobId);
});

test('uncertain async write retains its receipt and idempotency key recovers a committed job without another enqueue', async () => {
  const f = setup();
  const original = f.storage.enqueue;
  f.storage.enqueue = async (...args) => { await original(...args); throw failure(); };
  const first = await f.dispatch('jobs', { idempotencyKey: 'uncertain' });
  assert.equal(first.status, 503);
  const recovered = await f.dispatch('jobs', { idempotencyKey: 'uncertain' });
  assert.equal(recovered.status, 202);
  assert.equal(recovered.body.jobId, f.submissions[0].id);
  assert.equal(f.submissions.length, 1);
});

test('health is read-only; persistence failures stop admission before enqueue or pipeline execution', async () => {
  const healthy = setup();
  assert.equal((await healthy.dispatch('health')).status, 200);
  assert.equal(healthy.rows.size, 0);
  assert.equal(healthy.calls.some(call => ['insert', 'cas', 'remove', 'enqueue'].includes(call[0])), false);
  const broken = setup({ hook(method) { if (method === 'activeQueue') throw failure(); } });
  assert.equal((await broken.dispatch('jobs')).status, 503);
  assert.equal(broken.submissions.length, 0);
});

test('foreign queue jobs and nonfacade routine ids are excluded from status and results', async () => {
  const f = setup();
  f.set('job_queue', 'foreign', { id: 'foreign', status: 'completed', payload: { workflowId: 'auto_bot' }, result: rawSuccess() });
  f.set('job_queue', 'unregistered', { id: 'unregistered', status: 'completed', payload: { workflowId: 'routine_other_00000000-0000-4000-8000-000000000999' }, result: rawSuccess() });
  assert.equal((await f.dispatch('job', {}, { params: { jobId: 'foreign' } })).status, 404);
  assert.equal((await f.dispatch('job', {}, { params: { jobId: 'unregistered' } })).status, 404);
  assert.deepEqual((await f.dispatch('results')).body.items, []);
  assert.equal(f.calls.some(call => call[0] === 'generation'), false);
});

test('sync pipeline errors release their lease and retain conservative daily charge', async () => {
  const f = setup({ execute: async () => { throw new Error('pipeline stopped'); } });
  const result = await f.dispatch('news', { idempotencyKey: 'failure' });
  assert.equal(result.status, 500);
  assert.equal([...f.rows.keys()].some(id => id.startsWith('routine_lease:')), false);
  const ledger = f.get('routine_meter', GUARD);
  assert.deepEqual(ledger.days['2026-09-08'], { jobs: 1, usd: 1 });
  assert.ok(Object.values(ledger.entries).every(entry => entry.state === 'settled'));
});

test('successful sync result survives a transient settlement failure and remains replayable', async () => {
  let blocked = false;
  const f = setup({ hook(method, store, id, revision, data) {
    if (!blocked && method === 'cas' && store === 'routine_meter' && id === GUARD && Object.values(data.entries).some(entry => entry.state === 'settled')) {
      blocked = true;
      throw failure();
    }
  } });
  await f.dispatch('news', { idempotencyKey: 'result-retention' });
  const records = [...f.rows.values()].filter(record => record.kind === 'job');
  assert.equal(records.length, 1);
  assert.equal(records[0].result?.versions[0]?.content, 'ข่าวที่เขียนสำเร็จ');
  const replay = await f.dispatch('news', { idempotencyKey: 'result-retention' });
  assert.equal(replay.status, 200);
  assert.equal(f.plans.length, 1);
});

test('malformed live-lease state fails closed instead of admitting work with unknown concurrency', async () => {
  const f = setup();
  f.set('routine_lease', 'broken', { workflowId: 'routine_unknown_x', expiresAt: 'not-a-timestamp' });
  const result = await f.dispatch('jobs');
  assert.equal(result.status, 503);
  assert.equal(f.submissions.length, 0);
});

test('persistent CAS contention has a finite admission retry limit and never starts work', async () => {
  const f = setup();
  let misses = 0;
  const original = f.storage.cas;
  f.storage.cas = async (store, id, ...args) => {
    if (store === 'routine_meter' && id === GUARD) { misses++; return false; }
    return original(store, id, ...args);
  };
  const response = await f.dispatch('jobs', { idempotencyKey: 'contention' });
  assert.equal(response.status, 429);
  assert.equal(misses, 12);
  assert.equal(f.submissions.length, 0);
  assert.equal([...f.rows.keys()].some(id => id.startsWith('routine_idem:')), false);
});

test('a lease-release error does not prevent settlement or erase successful sync content', async () => {
  const f = setup({ hook(method, store) { if (method === 'remove' && store === 'routine_lease') throw failure(); } });
  const response = await f.dispatch('news', { idempotencyKey: 'release-failure' });
  assert.equal(response.status, 200);
  assert.equal(response.body.maintenancePending, true);
  assert.equal(response.body.versions[0].content, 'ข่าวที่เขียนสำเร็จ');
  assert.equal(f.get('routine_meter', GUARD).entries[response.body.workflowId].state, 'settled');
  assert.ok(f.get('routine_lease', response.body.workflowId));
  assert.equal((await f.dispatch('news', { idempotencyKey: 'release-failure' })).status, 200);
  assert.equal(f.plans.length, 1);
});

test('an uncertain result write is reconciled without replacing already committed success with an error', async () => {
  const f = setup();
  const original = f.storage.cas;
  let timedOut = false;
  f.storage.cas = async (store, id, revision, data) => {
    const won = await original(store, id, revision, data);
    if (!timedOut && won && store === 'routine_meter' && data.result) { timedOut = true; throw failure(); }
    return won;
  };
  const response = await f.dispatch('news', { idempotencyKey: 'uncertain-result' });
  assert.equal(response.status, 200);
  assert.equal(response.body.caseId, '00042');
  assert.equal((await f.dispatch('news', { idempotencyKey: 'uncertain-result' })).body.caseId, '00042');
  assert.equal(f.plans.length, 1);
});

test('malformed daily accounting counters fail closed', async () => {
  const f = setup();
  f.set('routine_meter', GUARD, { revision: 'broken', entries: {}, days: { '2026-09-08': { jobs: 'invalid', usd: 'invalid' } } });
  assert.equal((await f.dispatch('jobs')).status, 503);
  assert.equal(f.submissions.length, 0);
});

test('completed owned jobs expose stored versions, settle actual cost once, and filter result listings', async () => {
  const f = setup();
  const accepted = await f.dispatch('jobs');
  const job = f.get('job_queue', accepted.body.jobId);
  f.set('job_queue', job.id, { ...job, status: 'completed', result: rawSuccess({ usd: 0.2 }), startedAt: '2026-09-08T05:00:00Z', completedAt: '2026-09-08T05:01:00Z' });
  const result = await f.dispatch('job', {}, { params: { jobId: job.id } });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'done');
  assert.equal(result.body.result.versions[0].usedModel, 'gpt-5.6-sol');
  assert.equal(result.body.result.timing.ms, 60000);
  await f.dispatch('job', {}, { params: { jobId: job.id } });
  assert.ok(Math.abs(f.get('routine_meter', GUARD).days['2026-09-08'].usd - 0.2) < 1e-9);
  assert.equal((await f.dispatch('results', {}, { query: '?routine=morning&limit=1' })).body.items.length, 1);
  assert.equal((await f.dispatch('results', {}, { query: '?routine=other' })).body.items.length, 0);
});
