import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const [handler, core] = await Promise.all(['handler', 'core'].map(async name =>
  (await readFile(new URL('../src/lib/routine/' + name + '.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n'),
));
const sources = { handler, core, errorsUrl: new URL('../src/lib/routine/errors.mjs', import.meta.url).href };

// Source travels over stdin: Windows command lines cannot hold the full modules.
// The child executes this same behavioral suite against baseline and each mutant.
const childSuite = String.raw`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sources = JSON.parse(readFileSync(0, 'utf8'));
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(
  source.replaceAll("'./errors.mjs'", JSON.stringify(sources.errorsUrl)),
).toString('base64');
const { createHandler } = await import(moduleUrl(sources.handler));
const { createCore } = await import(moduleUrl(sources.core));
const INPUT = 'Verified source news text for the isolated routine mutation fixture.';
const KEY = 'mutation-fixture-key';
const clone = value => value === undefined ? undefined : structuredClone(value);
const timestamp = Date.parse('2026-09-08T05:00:00Z');

function fixture(overrides = {}) {
  const rows = new Map();
  let sequence = 0;
  const counters = { loads: 0, executes: 0, enqueues: 0 };
  const rowKey = (store, id) => store + ':' + id;
  const storage = {
    async get(store, id) { return clone(rows.get(rowKey(store, id)) ?? null); },
    async insert(store, id, data) {
      const key = rowKey(store, id);
      if (rows.has(key)) return false;
      rows.set(key, clone(data));
      return true;
    },
    async cas(store, id, revision, data) {
      const key = rowKey(store, id);
      if (rows.get(key)?.revision !== revision) return false;
      rows.set(key, clone(data));
      return true;
    },
    async remove(store, id, revision) {
      const key = rowKey(store, id);
      const current = rows.get(key);
      if (!current || (revision !== undefined && current.revision !== revision)) return false;
      return rows.delete(key);
    },
    async list(store, { since, routine } = {}) {
      return [...rows].filter(([key]) => key.startsWith(store + ':')).map(([, value]) => clone(value))
        .filter(value => (since === undefined || value.createdAt >= since)
          && (routine === undefined || value.routine === routine));
    },
    async activeQueue() {
      return [...rows].filter(([key]) => key.startsWith('job_queue:')).map(([, value]) => clone(value))
        .filter(job => job.payload?.workflowId?.startsWith('routine_')
          && ['pending', 'processing', 'staging', 'recovering'].includes(job.status));
    },
    async enqueue(payload, id) {
      counters.enqueues++;
      const job = { id, payload: clone(payload), status: 'pending', createdAt: new Date(timestamp).toISOString() };
      rows.set(rowKey('job_queue', id), clone(job));
      return clone(job);
    },
    async getJob(id) { return clone(rows.get(rowKey('job_queue', id)) ?? null); },
    async generation(id) { return clone(rows.get(rowKey('generation_logs', id)) ?? null); },
  };
  const core = createCore({
    storage,
    pipeline: {
      prepare(body, mode) { return { input: body.input, mode }; },
      async execute() {
        counters.executes++;
        return { success: true, data: { analysisResult: { versions: [{
          content: 'An isolated successful news version.', usedModel: 'gpt-5.6-sol', promptName: 'fixture',
        }] }, generationLog: { caseId: 'fixture-case', success: true } } };
      },
    },
    now: () => timestamp,
    uuid: () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0'),
  });
  const environment = { ROUTINE_API: '1', ROUTINE_API_KEY: KEY, ...overrides };
  return {
    counters,
    seed(store, id, data) { rows.set(rowKey(store, id), clone(data)); },
    async request(operation, { body = {}, key = KEY, params = {} } = {}) {
      const submit = operation === 'news' || operation === 'jobs';
      const request = new Request('http://mutation.test/api/routine/' + operation, {
        method: submit ? 'POST' : 'GET',
        headers: { 'x-routine-key': key, ...(submit ? { 'content-type': 'application/json' } : {}) },
        ...(submit ? { body: JSON.stringify({ input: INPUT, routine: 'morning', ...body }) } : {}),
      });
      const handle = createHandler(operation, {
        env: () => environment,
        async load() { counters.loads++; return core; },
      });
      const response = await handle(request, { params: Promise.resolve(params) });
      return { status: response.status, body: await response.json() };
    },
  };
}

test('switch gate denies disabled requests before loading runtime', async () => {
  const f = fixture({ ROUTINE_API: undefined });
  const result = await f.request('health');
  assert.equal(result.status, 404, 'GUARD_SWITCH');
  assert.equal(f.counters.loads, 0, 'GUARD_SWITCH_RUNTIME');
});

test('auth gate denies incorrect keys before loading runtime', async () => {
  const f = fixture();
  const result = await f.request('health', { key: 'incorrect-fixture-key' });
  assert.equal(result.status, 401, 'GUARD_AUTH');
  assert.equal(f.counters.loads, 0, 'GUARD_AUTH_RUNTIME');
});

test('daily budget rejects an unaffordable reservation before enqueue', async () => {
  const f = fixture({ ROUTINE_DAILY_USD: '0.5', ROUTINE_EST_USD_PER_JOB: '1' });
  const result = await f.request('jobs');
  assert.equal(result.status, 429, 'GUARD_DAILY_BUDGET');
  assert.equal(result.body.errorType, 'ROUTINE_DAILY_CAP', 'GUARD_DAILY_TYPE');
  assert.equal(f.counters.enqueues, 0, 'GUARD_DAILY_ENQUEUE');
});

test('concurrency reservation admits only one simultaneous submission', async () => {
  const f = fixture({ ROUTINE_MAX_CONCURRENT: '1' });
  const results = await Promise.all([
    f.request('jobs', { body: { routine: 'one' } }),
    f.request('jobs', { body: { routine: 'two' } }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [202, 429], 'GUARD_CONCURRENCY');
  assert.equal(f.counters.enqueues, 1, 'GUARD_CONCURRENCY_ENQUEUE');
});

test('workflow prefix excludes a foreign queue job even with a matching stored record', async () => {
  const f = fixture();
  const workflowId = 'unify_discord_existing';
  const jobId = 'legacy-job';
  f.seed('job_queue', jobId, { id: jobId, status: 'pending', payload: { workflowId } });
  f.seed('routine_meter', 'routine_record_' + workflowId, { kind: 'job', jobId, workflowId });
  const result = await f.request('job', { params: { jobId } });
  assert.equal(result.status, 404, 'GUARD_PREFIX');
  assert.equal(result.body.errorType, 'ROUTINE_NOT_FOUND', 'GUARD_PREFIX_TYPE');
});

test('idempotency replay does not execute a second news generation', async () => {
  const f = fixture();
  const options = { body: { idempotencyKey: 'mutation-fixture-idempotency' } };
  const first = await f.request('news', options);
  const second = await f.request('news', options);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(f.counters.executes, 1, 'GUARD_IDEMPOTENCY');
  assert.equal(second.body.workflowId, first.body.workflowId, 'GUARD_IDEMPOTENCY_WORKFLOW');
});
`;

const operators = [
  {
    name: 'remove feature switch gate', module: 'handler', marker: 'GUARD_SWITCH',
    testName: 'switch gate denies disabled requests before loading runtime',
    target: /^  if \(env\.ROUTINE_API !== '1'\) \{\n    throw new RoutineError\(404,[^\n]*\n  }\n/m,
  },
  {
    name: 'remove API key authentication gate', module: 'handler', marker: 'GUARD_AUTH',
    testName: 'auth gate denies incorrect keys before loading runtime',
    target: /^  if \(!configured \|\| !supplied \|\| !equal\) \{\n    throw new RoutineError\(401,[^\n]*\n  }\n/m,
  },
  {
    name: 'remove daily budget admission guard', module: 'core', marker: 'GUARD_DAILY_BUDGET',
    testName: 'daily budget rejects an unaffordable reservation before enqueue',
    target: /^      if \(today\.jobs >= caps\.dailyJobs \|\| today\.usd \+ caps\.estimate > caps\.dailyUsd \+ 1e-9\) fail\(429, 'ROUTINE_DAILY_CAP',[^\n]*\n/m,
  },
  {
    name: 'remove concurrency admission guard', module: 'core', marker: 'GUARD_CONCURRENCY',
    testName: 'concurrency reservation admits only one simultaneous submission',
    target: /^      if \(count >= caps\.maxConcurrent\) fail\(429, 'ROUTINE_BUSY',[^\n]*\n/m,
  },
  {
    name: 'remove foreign workflow prefix guard', module: 'core', marker: 'GUARD_PREFIX',
    testName: 'workflow prefix excludes a foreign queue job even with a matching stored record',
    target: /^    if \(!WORKFLOW\.test\(workflowId \|\| ''\)\) fail\(404, 'ROUTINE_NOT_FOUND',[^\n]*\n/m,
  },
  {
    name: 'remove idempotency claim and replay', module: 'core', marker: 'GUARD_IDEMPOTENCY',
    testName: 'idempotency replay does not execute a second news generation',
    target: /^    const idem = await claim\(body, mode, workflowId\);\n/m,
    replacement: '    const idem = null;\n',
  },
];

function runChild(input) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return spawnSync(process.execPath, ['--input-type=module', '--test-reporter=tap', '-e', childSuite], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
    windowsHide: true, env,
  });
}

function diagnose(context, name, result) {
  context.diagnostic(name + ': child exit=' + result.status + ', signal=' + (result.signal || 'none'));
  for (const line of result.stdout.trimEnd().split(/\r?\n/)) context.diagnostic('child TAP | ' + line);
  if (result.stderr.trim()) context.diagnostic('child stderr | ' + result.stderr.trim());
}

let baseline;
test('mutation baseline: all six guard contracts pass unchanged production source', context => {
  baseline = runChild(sources);
  diagnose(context, 'baseline', baseline);
  assert.equal(baseline.error, undefined, 'Baseline child must launch and finish normally.');
  assert.equal(baseline.signal, null);
  assert.equal(baseline.status, 0);
  assert.match(baseline.stdout, /^# tests 6$/m);
  assert.match(baseline.stdout, /^# pass 6$/m);
  assert.match(baseline.stdout, /^# fail 0$/m);
});

for (const operator of operators) {
  test('mutation killed: ' + operator.name, context => {
    assert.equal(baseline?.status, 0, 'Run mutations only after the unchanged baseline passes.');
    const source = sources[operator.module];
    const matches = [...source.matchAll(new RegExp(operator.target.source, operator.target.flags + 'g'))];
    assert.equal(matches.length, 1, 'Mutation must remove exactly one known production guard.');
    const mutated = source.replace(operator.target, operator.replacement || '');
    assert.notEqual(mutated, source);
    const result = runChild({ ...sources, [operator.module]: mutated });
    diagnose(context, operator.name, result);
    assert.equal(result.error, undefined, 'A process launch failure or timeout is not a killed mutation.');
    assert.equal(result.signal, null, 'A process crash is not a killed mutation.');
    assert.equal(result.status, 1, 'Mutated behavior must produce a failing node:test exit.');
    assert.match(result.stdout, /^# tests 6$/m);
    assert.match(result.stdout, /^# pass 5$/m);
    assert.match(result.stdout, /^# fail 1$/m);
    const failures = result.stdout.split(/\r?\n/).filter(line => /^not ok \d+ - /.test(line));
    assert.equal(failures.length, 1);
    assert.ok(failures[0].endsWith(' - ' + operator.testName), 'The intended behavioral assertion must fail.');
    assert.match(result.stdout, /code: 'ERR_ASSERTION'/);
    assert.ok(result.stdout.includes(operator.marker), 'The targeted guard assertion must diagnose the failure.');
    assert.doesNotMatch(result.stdout + result.stderr, /SyntaxError|ReferenceError|ERR_MODULE_NOT_FOUND|ERR_INVALID_URL/);
    context.diagnostic('KILLED ' + operator.marker + ': targeted assertion failed; child exit=1; remaining contracts passed=5.');
  });
}
