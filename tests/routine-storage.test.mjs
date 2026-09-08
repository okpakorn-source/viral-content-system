import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../src/lib/routine/storage.mjs';

function fixture(responses = [], add = async () => {}) {
  const calls = [];
  const sb = {
    from(table) {
      const call = { table, operations: [] };
      calls.push(call);
      const query = {};
      for (const method of ['select', 'eq', 'filter', 'gte', 'gt', 'order', 'range', 'maybeSingle', 'insert', 'update', 'delete']) {
        query[method] = (...args) => {
          call.operations.push([method, ...args]);
          return query;
        };
      }
      query.then = (resolve, reject) => {
        const response = responses.shift();
        if (response instanceof Error) return Promise.reject(response).then(resolve, reject);
        return Promise.resolve(response).then(resolve, reject);
      };
      return query;
    },
  };
  const stores = [];
  const storage = createStorage({ sb, createStore: name => { stores.push(name); return { add }; } });
  return { storage, calls, stores };
}

let rowSequence = 0;
const row = data => ({ id: String(data?.id ?? `row-${++rowSequence}`), data });
const ok = data => ({ data, error: null });
const failsClosed = error => error.status === 503 && error.errorType === 'ROUTINE_STORAGE_UNAVAILABLE'
  && !error.message.includes('SECRET');
const queueFailsClosed = error => error.status === 503 && error.errorType === 'ROUTINE_QUEUE_UNAVAILABLE'
  && !error.message.includes('SECRET');

test('authoritative reads distinguish missing rows from all persistence errors', async () => {
  const { storage, calls, stores } = fixture([
    ok(null), { data: null, error: { message: 'SECRET database detail' } }, new Error('SECRET transport'), ok({ data: [] }),
  ]);
  assert.equal(await storage.get('routine_meter', 'missing'), null);
  await assert.rejects(storage.get('routine_meter', 'failed'), failsClosed);
  await assert.rejects(storage.get('routine_meter', 'network'), failsClosed);
  await assert.rejects(storage.get('routine_meter', 'invalid'), failsClosed);
  assert.deepEqual(calls[0].operations.slice(0, 3), [['select', 'data'], ['eq', 'store_name', 'routine_meter'], ['eq', 'id', 'missing']]);
  assert.deepEqual(stores, []);
});

test('insert is an atomic unique-key claim; only PostgreSQL 23505 is a miss', async () => {
  const { storage, calls } = fixture([
    ok([{ id: 'lock' }]), { error: { code: '23505', message: 'SECRET duplicate' } },
    { error: { code: '42501', message: 'SECRET denied' } }, ok([]),
  ]);
  assert.equal(await storage.insert('routine_lease', 'lock', { revision: 1 }), true);
  assert.equal(await storage.insert('routine_lease', 'lock', { revision: 1 }), false);
  await assert.rejects(storage.insert('routine_lease', 'lock', {}), failsClosed);
  await assert.rejects(storage.insert('routine_lease', 'lock', {}), failsClosed);
  const inserted = calls[0].operations.find(op => op[0] === 'insert')[1];
  assert.equal(inserted.store_name, 'routine_lease');
  assert.equal(inserted.id, 'lock');
  assert.deepEqual(inserted.data, { revision: 1 });
});

test('numeric idempotency timestamps become ISO timestamptz values without altering JSON data', async () => {
  const { storage, calls } = fixture([ok([{ id: 'idem' }])]);
  const createdAt = Date.parse('2026-09-08T05:00:00Z');
  await storage.insert('routine_idem', 'idem', { createdAt });
  const inserted = calls[0].operations.find(op => op[0] === 'insert')[1];
  assert.equal(inserted.created_at, '2026-09-08T05:00:00.000Z');
  assert.equal(inserted.data.createdAt, createdAt);
});

test('CAS and removal fence writes with namespace, row id, and expected revision', async () => {
  const { storage, calls } = fixture([ok([{ id: 'lock' }]), ok([]), ok([{ id: 'lock' }]), { error: { message: 'SECRET' } }]);
  assert.equal(await storage.cas('routine_lease', 'lock', 4, { revision: 5 }), true);
  assert.equal(await storage.cas('routine_lease', 'lock', 4, { revision: 5 }), false);
  assert.equal(await storage.remove('routine_lease', 'lock', 5), true);
  await assert.rejects(storage.remove('routine_lease', 'lock', 5), failsClosed);
  for (const index of [0, 1, 2]) {
    assert.ok(calls[index].operations.some(op => op[0] === 'eq' && op[1] === 'store_name' && op[2] === 'routine_lease'));
    assert.ok(calls[index].operations.some(op => op[0] === 'eq' && op[1] === 'id' && op[2] === 'lock'));
    assert.ok(calls[index].operations.some(op => op[0] === 'eq' && op[1] === 'data->>revision' && op[2] === (index === 2 ? 5 : 4)));
  }
});

test('list paginates deterministically and rejects partial, oversized, or malformed reads', async () => {
  const first = Array.from({ length: 1000 }, (_, id) => row({ id }));
  const { storage, calls } = fixture([ok(first), ok([row({ id: 1000 })]), ok([])]);
  assert.equal((await storage.list('routine_meter', { since: '2026-09-08', routine: 'morning' })).length, 1001);
  assert.ok(calls[1].operations.some(op => op[0] === 'range' && op[1] === 0 && op[2] === 999));
  assert.ok(calls[1].operations.some(op => op[0] === 'gt' && op[1] === 'id' && op[2] === '999'));
  assert.ok(calls[0].operations.some(op => op[0] === 'order' && op[1] === 'id'));
  assert.ok(calls[0].operations.some(op => op[0] === 'eq' && op[1] === 'data->>routine' && op[2] === 'morning'));
  assert.ok(calls[0].operations.some(op => op[0] === 'gte' && op[1] === 'created_at' && op[2] === '2026-09-08T00:00:00.000Z'));
  await assert.rejects(fixture([ok(first), { error: { message: 'SECRET page 2' } }]).storage.list('routine_meter'), failsClosed);
  await assert.rejects(fixture([ok([row({}), row({})])]).storage.list('routine_meter', { limit: 1 }), failsClosed);
  await assert.rejects(fixture([ok([row(null)])]).storage.list('routine_meter'), failsClosed);
  await assert.rejects(fixture().storage.list('routine_meter', { limit: 10001 }), failsClosed);
});

test('active queue uses literal routine prefix and includes transitional reservations', async () => {
  const statuses = ['pending', 'processing', 'staging', 'recovering', 'queued', 'running', 'completed', 'failed', 'cancelled', 'superseded'];
  const jobs = statuses.map((status, id) => ({ id: String(id), status, payload: { workflowId: 'routine_morning_123' } }));
  const { storage, calls } = fixture([ok(jobs.map(row)), ok([])]);
  assert.deepEqual((await storage.activeQueue()).map(job => job.status), statuses.slice(0, 6));
  assert.ok(calls[0].operations.some(op => op[0] === 'filter' && op[1] === 'data->payload->>workflowId' && op[3] === 'routine\\_%'));
  await assert.rejects(fixture([ok([row({ ...jobs[0], status: 'mystery' })]), ok([])]).storage.activeQueue(), queueFailsClosed);
  await assert.rejects(fixture([ok([row({ ...jobs[0], payload: { workflowId: 'routineXwrong_1' } })]), ok([])]).storage.activeQueue(), queueFailsClosed);
  await assert.rejects(fixture([{ error: { message: 'SECRET status read' } }]).storage.getJob('job'), queueFailsClosed);
});

test('short server-limited pages continue until empty; repeated keys and page-limit exhaustion fail closed', async () => {
  const { storage, calls } = fixture([ok([row({ id: 'a' })]), ok([row({ id: 'b' })]), ok([])]);
  assert.deepEqual(await storage.list('routine_lease'), [{ id: 'a' }, { id: 'b' }]);
  assert.ok(calls[1].operations.some(op => op[0] === 'gt' && op[1] === 'id' && op[2] === 'a'));
  assert.ok(calls[2].operations.some(op => op[0] === 'gt' && op[1] === 'id' && op[2] === 'b'));
  await assert.rejects(fixture([ok([row({ id: 'a' })]), ok([row({ id: 'a' })])]).storage.list('routine_lease'), failsClosed);
  const endless = Array.from({ length: 100 }, (_, id) => ok([row({ id: String(id) })]));
  const bounded = fixture(endless);
  await assert.rejects(bounded.storage.list('routine_lease'), failsClosed);
  assert.equal(bounded.calls.length, 100);
});

test('queue insertion preserves the existing bot/worker shape and verifies committed ownership', async () => {
  const payload = { input: 'news text', images: [], contentLength: 'medium', preset: '', workflowId: 'routine_morning_abc' };
  let written;
  const job = { id: 'fixed-job-id', payload, status: 'pending' };
  const { storage, stores } = fixture([ok(row(job))], async item => { written = item; });
  assert.deepEqual(await storage.enqueue(payload, job.id), job);
  assert.deepEqual(stores, ['job_queue']);
  assert.deepEqual(Object.keys(written).sort(), ['id', 'userId', 'payload', 'status', 'attemptId', 'position', 'result', 'error', 'createdAt', 'startedAt', 'completedAt'].sort());
  assert.equal(written.userId, 'discord-bot');
  assert.equal(Object.hasOwn(written.payload, 'userId'), false);
  assert.equal(written.status, 'pending');
  for (const field of ['attemptId', 'result', 'error', 'startedAt', 'completedAt']) assert.equal(written[field], null);
  assert.equal(written.position, 1);
  assert.ok(Number.isFinite(Date.parse(written.createdAt)));
  await assert.rejects(fixture([ok(row({ ...job, payload: { workflowId: 'routine_other_abc' } }))]).storage.enqueue(payload, job.id), queueFailsClosed);
  await assert.rejects(fixture([], async () => { throw new Error('SECRET write failure'); }).storage.enqueue(payload, job.id), queueFailsClosed);
});

test('job reads never follow replacement links; generation reads preserve verified arrays', async () => {
  const job = { id: 'routine-job', status: 'superseded', supersededBy: 'bot-job' };
  const { storage, calls } = fixture([ok(row(job)), ok({ case_id: '00001', versions: '[{"content":"news"}]' }), ok({ case_id: 'bad', versions: 'bad json' }), ok(null)]);
  assert.deepEqual(await storage.getJob(job.id), job);
  assert.equal(calls.length, 1);
  assert.deepEqual((await storage.generation('00001')).versions, [{ content: 'news' }]);
  await assert.rejects(storage.generation('bad'), failsClosed);
  assert.equal(await storage.generation('missing'), null);
});
