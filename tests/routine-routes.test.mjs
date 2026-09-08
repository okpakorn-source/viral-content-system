/* eslint-disable no-await-in-loop -- Exercise each method and auth case sequentially with shared import sentinels. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { authenticate, createHandler } from '../src/lib/routine/handler.mjs';

const routePaths = ['health', 'news', 'jobs', 'jobs/[jobId]', 'results', 'results/[caseId]/select', '[[...path]]'];
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

test('actual route files: switch off returns 404 for every verb without evaluating runtime or legacy imports', async () => {
  const previous = process.env.ROUTINE_API;
  delete process.env.ROUTINE_API;
  let forbiddenImports = 0;
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.includes('runtime.mjs') || specifier.startsWith('@/') || /(?:services|supabase|persistStore|input-engine)/.test(specifier)) {
        forbiddenImports++;
        throw new Error('OFF PARITY: forbidden module evaluated');
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    for (const path of routePaths) {
      const route = await import(`../src/app/api/routine/${path}/route.js`);
      for (const method of methods) {
        const response = await route[method](new Request('http://localhost/api/routine/test', { method }), { params: Promise.resolve({}) });
        assert.equal(response.status, 404, `${path} ${method}`);
        assert.equal((await response.json()).errorType, 'ROUTINE_API_DISABLED');
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
    }
    assert.equal(forbiddenImports, 0);
  } finally {
    hook.deregister();
    if (previous === undefined) delete process.env.ROUTINE_API;
    else process.env.ROUTINE_API = previous;
  }
});

test('fresh process import sentinel proves route entry graph is dormant', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    delete process.env.ROUTINE_API;
    let attempts = 0;
    registerHooks({resolve(specifier, context, next) {
      if (specifier.includes('runtime.mjs') || specifier.startsWith('@/')) { attempts++; throw Error('legacy import'); }
      return next(specifier, context);
    }});
    const route = await import(${JSON.stringify(new URL('../src/app/api/routine/news/route.js', import.meta.url).href)});
    const res = await route.POST(new Request('http://localhost/api/routine/news', {method:'POST'}));
    assert.equal(res.status,404);
    assert.equal(attempts,0);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('all supported operations reject absent/wrong routine key before loading dependencies', async () => {
  for (const operation of ['health', 'news', 'jobs', 'job', 'results', 'select']) {
    for (const [configured, supplied] of [[undefined, undefined], [undefined, 'wrong'], ['expected', undefined], ['expected', 'wrong']]) {
      let loads = 0;
      const handler = createHandler(operation, { env: () => ({ ROUTINE_API: '1', ROUTINE_API_KEY: configured, DISCORD_API_SECRET: 'bot-only' }), load: () => { loads++; throw Error('forbidden'); } });
      const headers = { 'x-api-key': 'bot-only', ...(supplied ? { 'x-routine-key': supplied } : {}) };
      const response = await handler(new Request('http://localhost', { method: 'POST', headers }));
      assert.equal(response.status, 401);
      assert.equal((await response.json()).errorType, 'ROUTINE_UNAUTHORIZED');
      assert.equal(loads, 0);
    }
  }
});

test('timing-safe comparator receives equal length digests even for wrong-length keys', () => {
  const calls = [];
  const compare = (a, b) => { calls.push([a.length, b.length]); return a.equals(b); };
  const env = { ROUTINE_API: '1', ROUTINE_API_KEY: 'expected-test-value' };
  assert.throws(() => authenticate(new Request('http://localhost', { headers: { 'x-routine-key': 'x' } }), env, compare), { errorType: 'ROUTINE_UNAUTHORIZED' });
  authenticate(new Request('http://localhost', { headers: { 'x-routine-key': env.ROUTINE_API_KEY } }), env, compare);
  assert.deepEqual(calls, [[32, 32], [32, 32]]);
  const source = readFileSync(new URL('../src/lib/routine/handler.mjs', import.meta.url), 'utf8');
  assert.match(source, /import\s*\{[^}]*timingSafeEqual[^}]*\}\s*from 'node:crypto'/);
  assert.match(source, /compare = timingSafeEqual/);
});

test('correct key dispatches once with awaited Next params; unsupported methods and select remain JSON', async () => {
  const env = { ROUTINE_API: '1', ROUTINE_API_KEY: 'test-routine-key' };
  const request = method => new Request('http://localhost/api/routine/jobs/abc', { method, headers: { 'x-routine-key': env.ROUTINE_API_KEY } });
  let loads = 0;
  const load = async () => { loads++; return { dispatch: async (op, req, params, suppliedEnv) => {
    assert.equal(op, 'job'); assert.equal(req.method, 'GET'); assert.deepEqual(params, { jobId: 'abc' }); assert.equal(suppliedEnv, env);
    return { status: 200, body: { success: true, status: 'queued' } };
  } }; };
  const handler = createHandler('job', { env: () => env, load });
  assert.equal((await handler(request('GET'), { params: Promise.resolve({ jobId: 'abc' }) })).status, 200);
  assert.equal(loads, 1);
  const unsupported = await handler(request('POST'));
  assert.equal(unsupported.status, 405);
  assert.equal((await unsupported.json()).errorType, 'ROUTINE_METHOD_NOT_ALLOWED');
  const selection = await createHandler('select', { env: () => env, load })(request('POST'));
  assert.equal(selection.status, 501);
  assert.equal((await selection.json()).errorType, 'ROUTINE_NOT_IMPLEMENTED');
  assert.equal(loads, 1);
});

test('unexpected dependency errors are sanitized; no credentials or raw error message in JSON', async () => {
  const secret = 'SENSITIVE_SENTINEL';
  const handler = createHandler('health', { env: () => ({ ROUTINE_API: '1', ROUTINE_API_KEY: secret }), load: async () => { throw Error(secret); } });
  const response = await handler(new Request('http://localhost', { headers: { 'x-routine-key': secret } }));
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.ok(!text.includes(secret));
  assert.equal(JSON.parse(text).errorType, 'ROUTINE_INTERNAL_ERROR');
});
