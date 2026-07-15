// ============================================================
// Batch 5B1 pinned-AI fault/negative regression suite
// ------------------------------------------------------------
// Offline only: real s5PinnedAi + aiClient are exercised with a local fetch double.
// Persistence, progress, NextResponse, costStore, and usageLogger are process-local stubs.
// No real provider/network, secrets, env values, or filesystem writes are used.
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const AI_URL = new URL('../src/lib/aiClient.js', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

const STUB_NEXT = _mod(`
export const NextResponse = {
  json: (body, init) => ({ _body: body, status: (init && init.status) || 200, json: async () => body }),
};
`);

const STUB_CASE_STORE = _mod(`
const state = () => globalThis.__B5_CASESTORE || {};
export async function addCase(input) {
  const s = state();
  (s.addCalls ||= []).push(input);
  if (s.addError) throw s.addError;
  return s.addResult || { id: 'AC-TEST', createdAt: '2026-07-15T00:00:00.000Z' };
}
export async function getCase(id) {
  const s = state();
  (s.getCalls ||= []).push(id);
  return s.caseRecord || null;
}
export async function updateCase(id, patch) {
  const s = state();
  (s.updateCalls ||= []).push({ id, patch });
  if (s.updateError) throw s.updateError;
  return s.updateResult || { ...(s.caseRecord || {}), ...patch };
}
`);

const STUB_PROGRESS = _mod(`
const state = () => globalThis.__B5_PROGRESS || {};
export function reporter(jobId) {
  const fn = (...args) => { const s = state(); (s.calls ||= []).push({ jobId, args }); };
  fn.onRetry = (...args) => { const s = state(); (s.retryCalls ||= []).push(args); };
  return fn;
}
export function doneProgress(...args) { const s = state(); (s.done ||= []).push(args); }
export function failProgress(...args) { const s = state(); (s.fail ||= []).push(args); }
`);

const STUB_COST = _mod(`
const state = () => globalThis.__B5_BOOKKEEPING || {};
export async function recordLLM(...args) {
  const s = state();
  s.recordCalls = (s.recordCalls || 0) + 1;
  if (s.recordMode === 'hang') return new Promise(() => {});
  if (s.recordMode === 'throw') throw new Error('BOOKKEEPING_FAILURE');
  return null;
}
`);

const STUB_USAGE = _mod(`
const state = () => globalThis.__B5_BOOKKEEPING || {};
export async function logApiUsage(...args) {
  const s = state();
  s.logCalls = (s.logCalls || 0) + 1;
  if (s.logMode === 'hang') return new Promise(() => {});
  if (s.logMode === 'throw') throw new Error('USAGE_LOG_FAILURE');
  return null;
}
`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier === '@/lib/caseStore') return { url: ${JSON.stringify(STUB_CASE_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/progress') return { url: ${JSON.stringify(STUB_PROGRESS)}, shortCircuit: true };
  if (specifier === '@/lib/ai/usageLogger') return { url: ${JSON.stringify(STUB_USAGE)}, shortCircuit: true };
  if (specifier === './costStore.js' && context.parentURL === ${JSON.stringify(AI_URL)}) {
    return { url: ${JSON.stringify(STUB_COST)}, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const mapped = new URL(
      specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'),
      ${JSON.stringify(SRC_ROOT)},
    ).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ABORT_CONTROLLER = globalThis.AbortController;
after(() => {
  if (ORIGINAL_FETCH) globalThis.fetch = ORIGINAL_FETCH;
  else delete globalThis.fetch;
  globalThis.AbortController = ORIGINAL_ABORT_CONTROLLER;
  delete globalThis.__B5_CASESTORE;
  delete globalThis.__B5_PROGRESS;
  delete globalThis.__B5_BOOKKEEPING;
});

const {
  runStrictPinned,
  resolvePin,
  readStoredPin,
  validateAnalysisV1Structure,
  validateKeywordsV1Structure,
  KEYWORD_LIST_KEYS,
} = await import('../src/lib/s5PinnedAi.js');
const { callBrain } = await import('../src/lib/aiClient.js');
const { POST: analyzePOST } = await import('../src/app/api/analyze/route.js');
const { POST: keywordsPOST } = await import('../src/app/api/keywords/route.js');

const TEST_KEY = 'batch5-test-key';
const PIN = Object.freeze({ provider: 'anthropic', model: 'batch5-pinned-model' });
const ANALYSIS_SCHEMA_VERSION = 'analysis.v1';
const NEWS_TEXT = 'A neutral test article with enough content for the strict analyze route.';
const RAW_OUTPUT_SECRET = 'RAW_OUTPUT_MUST_NOT_ESCAPE';
const PROVIDER_BODY_SECRET = 'PROVIDER_BODY_MUST_NOT_ESCAPE';

const VALID_ANALYSIS = Object.freeze({
  headline: 'Test headline',
  summary: 'Test summary',
  characters: [],
  content: {
    what_happened: 'A test event happened',
    key_events: [],
    location: 'Test location',
    time: 'Test time',
    numbers_facts: [],
  },
  context: {
    background: 'Test background',
    why_notable: 'Test relevance',
    emotional_tone: 'Test tone',
    tone_evidence: 'Test evidence',
    key_moment: 'Test moment',
  },
  confidence: 'สูง',
  missing_info: [],
});

const VALID_KEYWORDS = Object.freeze({
  subjects: [],
  ...Object.fromEntries(KEYWORD_LIST_KEYS.map((key) => [key, []])),
});

const makeAnalyzeMeta = (overrides = {}) => ({
  provider: PIN.provider,
  model: PIN.model,
  schema: ANALYSIS_SCHEMA_VERSION,
  usage: { input_tokens: 1, output_tokens: 1 },
  requestedProvider: PIN.provider,
  requestedModel: PIN.model,
  actualProvider: PIN.provider,
  actualModel: PIN.model,
  actualModelVersion: null,
  schemaVersion: ANALYSIS_SCHEMA_VERSION,
  attemptCount: 1,
  repairCount: 0,
  ...overrides,
});

const clone = (value) => structuredClone(value);
const json = (value) => JSON.stringify(value);
const requestOf = (body) => ({ json: async () => body });

async function flush(turns = 12) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

async function captureRejection(promiseOrFactory) {
  try {
    if (typeof promiseOrFactory === 'function') await promiseOrFactory();
    else await promiseOrFactory;
  } catch (error) {
    return error;
  }
  assert.fail('expected rejection');
}

async function withEnv(values, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function setCaseStore(state = {}) {
  const full = {
    addCalls: [],
    getCalls: [],
    updateCalls: [],
    ...state,
  };
  globalThis.__B5_CASESTORE = full;
  return full;
}

function setProgress() {
  const state = { calls: [], retryCalls: [], done: [], fail: [] };
  globalThis.__B5_PROGRESS = state;
  return state;
}

function useBookkeeping(state = {}) {
  const full = { recordMode: 'resolve', logMode: 'resolve', ...state };
  globalThis.__B5_BOOKKEEPING = full;
  return full;
}

function responseStep({ text = '', actualModel = PIN.model, omitModel = false, status = 200, body = PROVIDER_BODY_SECRET } = {}) {
  return { text, actualModel, omitModel, status, body };
}

function installFetch(steps) {
  const saved = globalThis.fetch;
  const calls = [];
  const stats = { bodyReads: 0, activeRequests: 0, pendingRequests: [] };
  let index = 0;

  globalThis.fetch = (url, options = {}) => {
    const step = typeof steps === 'function' ? steps({ index, calls }) : steps[index];
    index++;
    calls.push({ url: String(url), options });
    if (!step) return Promise.reject(new Error('UNEXPECTED_FETCH_CALL'));
    if (step.throw !== undefined) return Promise.reject(step.throw);
    if (step.pending) {
      return new Promise((resolve, reject) => {
        const request = { resolve, reject, settled: false, signal: options.signal };
        stats.pendingRequests.push(request);
        stats.activeRequests++;
        const settle = (fn, value) => {
          if (request.settled) return;
          request.settled = true;
          stats.activeRequests--;
          fn(value);
        };
        request.resolve = (value) => settle(resolve, value);
        request.reject = (value) => settle(reject, value);
        const onAbort = () => request.reject(Object.assign(new Error('FETCH_ABORTED'), { name: 'AbortError' }));
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener?.('abort', onAbort, { once: true });
      });
    }

    const status = step.status ?? 200;
    const payload = { content: [{ type: 'text', text: step.text ?? '' }], usage: { input_tokens: 1, output_tokens: 1 } };
    if (!step.omitModel) payload.model = step.actualModel;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => { stats.bodyReads++; return step.body ?? ''; },
    });
  };

  return {
    calls,
    stats,
    restore() {
      if (saved) globalThis.fetch = saved;
      else delete globalThis.fetch;
    },
  };
}

function createFakeTimers() {
  const savedSetTimeout = globalThis.setTimeout;
  const savedClearTimeout = globalThis.clearTimeout;
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  globalThis.setTimeout = (fn, delay = 0, ...args) => {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, Number(delay) || 0), fn, args });
    return id;
  };
  globalThis.clearTimeout = (id) => { timers.delete(id); };

  function nextDue(target) {
    let selected = null;
    for (const [id, timer] of timers) {
      if (timer.at > target) continue;
      if (!selected || timer.at < selected.timer.at || (timer.at === selected.timer.at && id < selected.id)) {
        selected = { id, timer };
      }
    }
    return selected;
  }

  function advanceSync(ms) {
    const target = now + Math.max(0, Number(ms) || 0);
    while (true) {
      const due = nextDue(target);
      if (!due) break;
      now = due.timer.at;
      timers.delete(due.id);
      due.timer.fn(...due.timer.args);
    }
    now = target;
  }

  return {
    advanceSync,
    now: () => now,
    pendingCount: () => timers.size,
    restore() {
      globalThis.setTimeout = savedSetTimeout;
      globalThis.clearTimeout = savedClearTimeout;
      timers.clear();
    },
  };
}

function createTrackedAbortControllers() {
  const saved = globalThis.AbortController;
  const controllers = [];

  class TrackedSignal {
    constructor() {
      this.aborted = false;
      this.reason = undefined;
      this.listeners = new Map();
    }
    addEventListener(type, fn, options = {}) {
      if (type === 'abort' && typeof fn === 'function') this.listeners.set(fn, { once: Boolean(options?.once) });
    }
    removeEventListener(type, fn) {
      if (type === 'abort') this.listeners.delete(fn);
    }
    listenerCount() { return this.listeners.size; }
    abort(reason) {
      if (this.aborted) return;
      this.aborted = true;
      this.reason = reason;
      for (const [fn, options] of [...this.listeners]) {
        if (options.once) this.listeners.delete(fn);
        try { fn({ type: 'abort' }); } catch { /* EventTarget abort dispatch does not leak listener errors. */ }
      }
    }
  }

  class TrackedAbortController {
    constructor() {
      this.signal = new TrackedSignal();
      controllers.push(this);
    }
    abort(reason) { this.signal.abort(reason); }
  }

  globalThis.AbortController = TrackedAbortController;
  return {
    controllers,
    restore() { globalThis.AbortController = saved; },
  };
}

function strictOptions(overrides = {}) {
  return {
    system: 'test-system',
    user: 'test-user',
    maxTokens: 100,
    temperature: 0,
    pin: PIN,
    validate: validateAnalysisV1Structure,
    ...overrides,
  };
}

async function expectStrictError(steps, overrides = {}) {
  const fetcher = installFetch(steps);
  try {
    const error = await captureRejection(() => runStrictPinned(strictOptions(overrides)));
    return { error, fetcher };
  } finally {
    fetcher.restore();
  }
}

// ============================================================
// A — pin, identity, and route persistence
test('A1 analyze persists one exact frozen pin; keywords reads that pin despite changed env', async () => {
  await withEnv({
    ANALYSIS_PROVIDER: 'anthropic',
    ANALYSIS_MODEL: PIN.model,
    ANTHROPIC_API_KEY: TEST_KEY,
    OPENAI_API_KEY: undefined,
  }, async () => {
    const store = setCaseStore({ addResult: { id: 'AC-PIN', createdAt: '2026-07-15T00:00:00.000Z' } });
    setProgress();
    const analyzeFetch = installFetch([responseStep({ text: json(VALID_ANALYSIS), actualModel: PIN.model })]);
    try {
      const analyzed = await analyzePOST(requestOf({ newsText: NEWS_TEXT }));
      assert.strictEqual(analyzed.status, 200);
      assert.strictEqual(analyzed._body.success, true);
      assert.deepStrictEqual(
        { provider: analyzed._body.meta.provider, model: analyzed._body.meta.model },
        PIN,
      );
      assert.deepStrictEqual(
        { requestedProvider: store.addCalls[0].meta.requestedProvider, requestedModel: store.addCalls[0].meta.requestedModel },
        { requestedProvider: PIN.provider, requestedModel: PIN.model },
      );
      assert.strictEqual(Object.isFrozen(resolvePin()), true, 'resolved pin is immutable');
      assert.strictEqual(analyzeFetch.calls.length, 1);
    } finally {
      analyzeFetch.restore();
    }

    store.caseRecord = {
      id: 'AC-PIN',
      newsText: NEWS_TEXT,
      analysis: clone(VALID_ANALYSIS),
      meta: store.addCalls[0].meta,
    };
    await withEnv({
      ANALYSIS_PROVIDER: 'openai',
      ANALYSIS_MODEL: 'env-must-not-win',
      OPENAI_API_KEY: TEST_KEY,
      ANTHROPIC_API_KEY: TEST_KEY,
    }, async () => {
      const keywordFetch = installFetch([responseStep({ text: json(VALID_KEYWORDS), actualModel: PIN.model })]);
      try {
        const keyed = await keywordsPOST(requestOf({ caseId: 'AC-PIN' }));
        assert.strictEqual(keyed.status, 200);
        assert.strictEqual(keyed._body.success, true);
        assert.strictEqual(store.updateCalls.length, 1);
        assert.strictEqual(keywordFetch.calls.length, 1);
        assert.match(keywordFetch.calls[0].url, /anthropic/);
        const payload = JSON.parse(keywordFetch.calls[0].options.body);
        assert.strictEqual(payload.model, PIN.model);
        assert.strictEqual(keyed._body.meta.requestedModel, PIN.model);
      } finally {
        keywordFetch.restore();
      }
    });
  });
});

test('A2 malformed pin and stored-meta shapes fail closed before provider calls', async () => {
  const getterState = { getterCalls: 0, trapCalls: 0 };
  const accessorPin = { provider: PIN.provider };
  Object.defineProperty(accessorPin, 'model', {
    enumerable: true,
    get() { getterState.getterCalls++; throw new Error('PIN_GETTER_MUST_NOT_RUN'); },
  });
  const trappedPin = new Proxy({ provider: PIN.provider, model: PIN.model }, {
    get() { getterState.trapCalls++; throw new Error('PIN_TRAP_MUST_NOT_RUN'); },
    ownKeys() { getterState.trapCalls++; throw new Error('PIN_TRAP_MUST_NOT_RUN'); },
    getOwnPropertyDescriptor() { getterState.trapCalls++; throw new Error('PIN_TRAP_MUST_NOT_RUN'); },
  });
  const revocable = Proxy.revocable({ provider: PIN.provider, model: PIN.model }, {});
  revocable.revoke();
  const symbolPin = { provider: PIN.provider, model: PIN.model, [Symbol('extra')]: true };
  const customProtoPin = Object.create({ inherited: true });
  customProtoPin.provider = PIN.provider;
  customProtoPin.model = PIN.model;
  const invalidPins = [
    undefined,
    { provider: PIN.provider },
    { provider: 'other', model: PIN.model },
    { provider: PIN.provider, model: PIN.model, extra: true },
    accessorPin,
    symbolPin,
    trappedPin,
    revocable.proxy,
    new Date(),
    [],
    customProtoPin,
  ];

  await withEnv({ ANTHROPIC_API_KEY: TEST_KEY, ANALYSIS_PROVIDER: 'anthropic', ANALYSIS_MODEL: PIN.model }, async () => {
    for (const pin of invalidPins) {
      const { error, fetcher } = await expectStrictError([], { pin });
      assert.strictEqual(error.errorType, 'PIN_INVALID');
      assert.strictEqual(error.provenance.attemptCount, 0);
      assert.strictEqual(error.provenance.repairCount, 0);
      assert.strictEqual(fetcher.calls.length, 0);
    }
  });
  assert.strictEqual(getterState.getterCalls, 0);
  assert.strictEqual(getterState.trapCalls, 0);

  const accessorMeta = {};
  let metaGetterCalls = 0;
  Object.defineProperty(accessorMeta, 'requestedProvider', {
    enumerable: true,
    get() { metaGetterCalls++; throw new Error('META_GETTER_MUST_NOT_RUN'); },
  });
  const metaProxy = new Proxy({ requestedProvider: PIN.provider, requestedModel: PIN.model }, {
    get() { getterState.trapCalls++; throw new Error('META_TRAP_MUST_NOT_RUN'); },
  });
  const metaRevocable = Proxy.revocable({ requestedProvider: PIN.provider, requestedModel: PIN.model }, {});
  metaRevocable.revoke();
  const extraMeta = { ...makeAnalyzeMeta(), extra: true };
  const symbolMeta = { ...makeAnalyzeMeta(), [Symbol('extra')]: true };
  const invalidMeta = [
    undefined,
    {},
    { requestedProvider: PIN.provider },
    { requestedProvider: 'other', requestedModel: PIN.model },
    extraMeta,
    accessorMeta,
    symbolMeta,
    metaProxy,
    metaRevocable.proxy,
    new Date(),
  ];
  assert.deepStrictEqual(readStoredPin(makeAnalyzeMeta()), PIN, 'full analyze-success meta remains a valid stored pin');
  for (const meta of invalidMeta) assert.strictEqual(readStoredPin(meta), null);
  assert.strictEqual(metaGetterCalls, 0);
  assert.strictEqual(getterState.trapCalls, 0);
});

test('A3 resolved and stored model IDs reject blank, padded, and overlong values without trimming', async () => {
  const badModels = [` ${PIN.model}`, `${PIN.model} `, '   ', 'x'.repeat(257)];
  for (const model of badModels) {
    await withEnv({ ANALYSIS_PROVIDER: 'anthropic', ANALYSIS_MODEL: model, ANTHROPIC_API_KEY: TEST_KEY }, async () => {
      assert.throws(resolvePin, (error) => error?.errorType === 'INVALID_RESOLVED_MODEL');
    });
    assert.strictEqual(readStoredPin({ requestedProvider: PIN.provider, requestedModel: model }), null);
  }
});

test('A4 provider actualModel is literal identity evidence and identity failures are terminal', async () => {
  await withEnv({ ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    for (const step of [
      responseStep({ text: json(VALID_ANALYSIS), omitModel: true }),
      responseStep({ text: json(VALID_ANALYSIS), actualModel: '' }),
      responseStep({ text: json(VALID_ANALYSIS), actualModel: ` ${PIN.model}` }),
    ]) {
      const { error, fetcher } = await expectStrictError([step]);
      assert.strictEqual(error.errorType, 'MODEL_IDENTITY_MISSING');
      assert.strictEqual(error.provenance.actualModel, null);
      assert.strictEqual(error.provenance.attemptCount, 1);
      assert.strictEqual(error.provenance.repairCount, 0);
      assert.strictEqual(fetcher.calls.length, 1);
    }

    const mismatch = await expectStrictError([responseStep({ text: json(VALID_ANALYSIS), actualModel: 'provider-other-model' })]);
    assert.strictEqual(mismatch.error.errorType, 'MODEL_PIN_MISMATCH');
    assert.strictEqual(mismatch.error.provenance.actualModel, 'provider-other-model');
    assert.strictEqual(mismatch.error.provenance.attemptCount, 1);
    assert.strictEqual(mismatch.fetcher.calls.length, 1);
  });
});

test('A5 repair response with missing model replaces prior actualModel with null', async () => {
  await withEnv({ ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    const invalid = clone(VALID_ANALYSIS);
    invalid.summary = '';
    const { error, fetcher } = await expectStrictError([
      responseStep({ text: json(invalid), actualModel: PIN.model }),
      responseStep({ text: json(VALID_ANALYSIS), omitModel: true }),
    ]);
    assert.strictEqual(error.errorType, 'MODEL_IDENTITY_MISSING');
    assert.strictEqual(error.provenance.actualModel, null);
    assert.strictEqual(error.provenance.attemptCount, 2);
    assert.strictEqual(error.provenance.repairCount, 1);
    assert.strictEqual(fetcher.calls.length, 2);
  });
});

// ============================================================
// B — abort, bounds, safe error normalization, and redaction
test('B1 child 45s timeout aborts the owned provider signal and settles through recordLLM/logApiUsage hangs', async () => {
  await withEnv({ ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    for (const mode of ['record', 'log']) {
      const clock = createFakeTimers();
      const aborts = createTrackedAbortControllers();
      const bookkeeping = useBookkeeping(mode === 'record' ? { recordMode: 'hang' } : { logMode: 'hang' });
      const fetcher = installFetch([responseStep({ text: json(VALID_ANALYSIS), actualModel: PIN.model })]);
      try {
        const outcome = runStrictPinned(strictOptions({ cost: { step: 'test' } }));
        await flush();
        assert.ok(fetcher.calls[0].options.signal, 'real owned AbortSignal reaches provider fetch');
        clock.advanceSync(45000);
        const error = await captureRejection(outcome);
        assert.strictEqual(error.errorType, 'ATTEMPT_TIMEOUT');
        assert.strictEqual(error.provenance.attemptCount, 1);
        assert.strictEqual(fetcher.stats.activeRequests, 0);
        assert.strictEqual(clock.pendingCount(), 0);
        assert.ok(aborts.controllers.length >= 2);
        assert.ok(aborts.controllers.every((controller) => controller.signal.listenerCount() === 0));
        assert.strictEqual(bookkeeping.recordCalls >= 1, true);
        if (mode === 'log') assert.strictEqual(bookkeeping.logCalls >= 1, true);
      } finally {
        fetcher.restore();
        aborts.restore();
        clock.restore();
        delete globalThis.__B5_BOOKKEEPING;
      }
    }
  });
});

test('B2 parent 120s deadline wins over a late repair child deadline and cleans all listeners/timers', async () => {
  await withEnv({ ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    const clock = createFakeTimers();
    const aborts = createTrackedAbortControllers();
    const bookkeeping = useBookkeeping();
    const fetcher = installFetch([
      responseStep({ text: json(VALID_ANALYSIS), actualModel: PIN.model }),
      responseStep({ text: json(VALID_ANALYSIS), actualModel: PIN.model }),
    ]);
    let validationCalls = 0;
    try {
      const validate = (value) => {
        validationCalls++;
        if (validationCalls === 1) {
          clock.advanceSync(80000);
          bookkeeping.recordMode = 'hang';
          bookkeeping.logMode = 'hang';
          return { ok: false, reason: 'TEST_SCHEMA_FAILURE' };
        }
        return validateAnalysisV1Structure(value);
      };
      const outcome = runStrictPinned(strictOptions({ validate, cost: { step: 'test' } }));
      await flush();
      assert.strictEqual(clock.now(), 80000);
      assert.strictEqual(validationCalls, 1);
      clock.advanceSync(40000);
      const error = await captureRejection(outcome);
      assert.strictEqual(error.errorType, 'DEADLINE_EXCEEDED');
      assert.strictEqual(error.provenance.attemptCount, 2);
      assert.strictEqual(error.provenance.repairCount, 1);
      assert.strictEqual(error.provenance.actualModel, PIN.model);
      assert.strictEqual(fetcher.calls.length, 2);
      assert.strictEqual(fetcher.stats.activeRequests, 0);
      assert.strictEqual(clock.pendingCount(), 0);
      assert.ok(aborts.controllers.every((controller) => controller.signal.listenerCount() === 0));
    } finally {
      fetcher.restore();
      aborts.restore();
      clock.restore();
      delete globalThis.__B5_BOOKKEEPING;
    }
  });
});

test('B3 generation/repair bounds and repair gating stay at generation<=2, repair<=1, total<=3', async () => {
  await withEnv({ ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    const invalid = clone(VALID_ANALYSIS);
    invalid.summary = '';

    const success = await (async () => {
      const { error, fetcher } = await (async () => {
        const h = installFetch([responseStep({ text: json(VALID_ANALYSIS), actualModel: PIN.model })]);
        try {
          const result = await runStrictPinned(strictOptions());
          return { error: null, result, fetcher: h };
        } catch (error) {
          return { error, fetcher: h };
        }
      })();
      return { error, fetcher };
    })();
    assert.strictEqual(success.error, null);
    assert.strictEqual(success.fetcher.calls.length, 1);
    assert.strictEqual(success.fetcher.stats.activeRequests, 0);
    success.fetcher.restore();

    const repaired = await (async () => {
      const h = installFetch([
        responseStep({ text: json(invalid), actualModel: PIN.model }),
        responseStep({ text: json(VALID_ANALYSIS), actualModel: PIN.model }),
      ]);
      try {
        return { result: await runStrictPinned(strictOptions()), fetcher: h };
      } finally {
        if (globalThis.fetch !== ORIGINAL_FETCH) h.restore();
      }
    })();
    assert.strictEqual(repaired.result.provenance.attemptCount, 2);
    assert.strictEqual(repaired.result.provenance.repairCount, 1);
    assert.strictEqual(repaired.fetcher.calls.length, 2);

    const exhausted = await expectStrictError([
      responseStep({ status: 503, body: PROVIDER_BODY_SECRET }),
      responseStep({ status: 503, body: PROVIDER_BODY_SECRET }),
    ]);
    assert.strictEqual(exhausted.error.errorType, 'AI_BUSY');
    assert.strictEqual(exhausted.error.provenance.attemptCount, 2);
    assert.strictEqual(exhausted.error.provenance.repairCount, 0);
    assert.strictEqual(exhausted.fetcher.calls.length, 2);

    const totalThree = await expectStrictError([
      responseStep({ status: 503, body: PROVIDER_BODY_SECRET }),
      responseStep({ text: json(invalid), actualModel: PIN.model }),
      responseStep({ status: 503, body: PROVIDER_BODY_SECRET }),
    ]);
    assert.strictEqual(totalThree.error.errorType, 'AI_BUSY');
    assert.strictEqual(totalThree.error.provenance.attemptCount, 3);
    assert.strictEqual(totalThree.error.provenance.repairCount, 1);
    assert.strictEqual(totalThree.fetcher.calls.length, 3);
  });
});

test('B4 strict provider non-2xx redacts body and onRetry receives only fixed safe data', async () => {
  await withEnv({ ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    const retries = [];
    const { error, fetcher } = await expectStrictError(
      [
        responseStep({ status: 503, body: PROVIDER_BODY_SECRET }),
        responseStep({ status: 503, body: PROVIDER_BODY_SECRET }),
      ],
      { onRetry: (...args) => retries.push(args) },
    );
    assert.strictEqual(error.errorType, 'AI_BUSY');
    assert.strictEqual(error.message, 'AI provider ไม่ว่างชั่วคราว');
    assert.strictEqual(error.message.includes(PROVIDER_BODY_SECRET), false);
    assert.strictEqual(fetcher.stats.bodyReads, 0);
    assert.ok(retries.length >= 1);
    for (const args of retries) {
      assert.strictEqual(args.length, 3);
      assert.strictEqual(typeof args[0], 'number');
      assert.strictEqual(typeof args[1], 'number');
      assert.deepStrictEqual(Object.keys(args[2]).sort(), ['errorType', 'message']);
      assert.strictEqual(args[2].message.includes(PROVIDER_BODY_SECRET), false);
    }
  });
});

test('B5 strict errors normalize primitive, frozen/sealed, accessor, proxy, revoked-proxy, and proxy-prototype throws safely', async () => {
  await withEnv({ ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    let accessorGetterCalls = 0;
    let trapCalls = 0;
    const accessorError = {};
    Object.defineProperty(accessorError, 'message', {
      enumerable: true,
      get() { accessorGetterCalls++; throw new Error('ERROR_GETTER_MUST_NOT_RUN'); },
    });
    const trapError = new Proxy({}, {
      get() { trapCalls++; throw new Error('ERROR_TRAP_MUST_NOT_RUN'); },
      ownKeys() { trapCalls++; throw new Error('ERROR_TRAP_MUST_NOT_RUN'); },
      getOwnPropertyDescriptor() { trapCalls++; throw new Error('ERROR_TRAP_MUST_NOT_RUN'); },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const proxyPrototype = new Proxy({}, {
      get() { trapCalls++; throw new Error('PROTO_TRAP_MUST_NOT_RUN'); },
      getPrototypeOf() { trapCalls++; throw new Error('PROTO_TRAP_MUST_NOT_RUN'); },
    });
    const ordinaryWithProxyPrototype = Object.create(proxyPrototype);
    Object.defineProperty(ordinaryWithProxyPrototype, 'message', { value: 'RAW_SECRET', enumerable: true });
    const frozenError = Object.freeze(new Error('FROZEN_RAW_SECRET'));
    const sealedError = Object.seal(new Error('SEALED_RAW_SECRET'));
    const rawErrors = [
      'primitive raw throw',
      frozenError,
      sealedError,
      accessorError,
      trapError,
      revoked.proxy,
      ordinaryWithProxyPrototype,
    ];
    for (const raw of rawErrors) {
      const { error, fetcher } = await expectStrictError([{ throw: raw }]);
      assert.ok(error instanceof Error);
      assert.notStrictEqual(error, raw);
      assert.strictEqual(error.errorType, 'PROVIDER_ERROR');
      assert.strictEqual(error.provenance.errorType, error.errorType);
      assert.strictEqual(Object.isFrozen(error.provenance), true);
      assert.strictEqual(error.message, 'AI provider request failed');
      assert.ok(error.message.length <= 128);
      assert.strictEqual(error.message.includes('RAW_SECRET'), false);
      assert.strictEqual(fetcher.calls.length, 1);
    }
    assert.strictEqual(accessorGetterCalls, 0);
    assert.strictEqual(trapCalls, 0);
  });
});

// ============================================================
// C — exact JSON and schema contracts
test('C1 analysis and keywords schemas reject extras, missing keys, coercion, sparse arrays, accessors, symbols, proxies, and exotics', () => {
  assert.strictEqual(validateAnalysisV1Structure(clone(VALID_ANALYSIS)).ok, true);
  const analysisCases = [];

  const missing = clone(VALID_ANALYSIS);
  delete missing.summary;
  analysisCases.push(missing);
  const extra = clone(VALID_ANALYSIS);
  extra.extra = true;
  analysisCases.push(extra);
  const nestedExtra = clone(VALID_ANALYSIS);
  nestedExtra.content.extra = true;
  analysisCases.push(nestedExtra);
  const coercion = clone(VALID_ANALYSIS);
  coercion.confidence = 1;
  analysisCases.push(coercion);
  const sparse = clone(VALID_ANALYSIS);
  sparse.content.key_events = new Array(1);
  analysisCases.push(sparse);
  const symbolExtra = clone(VALID_ANALYSIS);
  symbolExtra[Symbol('extra')] = true;
  analysisCases.push(symbolExtra);
  const accessor = clone(VALID_ANALYSIS);
  let getterCalls = 0;
  Object.defineProperty(accessor, 'headline', { enumerable: true, get() { getterCalls++; return 'bad'; } });
  analysisCases.push(accessor);
  let proxyTrapCalls = 0;
  analysisCases.push(new Proxy(clone(VALID_ANALYSIS), {
    ownKeys() { proxyTrapCalls++; throw new Error('SCHEMA_PROXY_TRAP'); },
  }));
  analysisCases.push(new Date());
  for (const value of analysisCases) assert.strictEqual(validateAnalysisV1Structure(value).ok, false);
  assert.strictEqual(getterCalls, 0);
  assert.strictEqual(proxyTrapCalls, 0);

  const validKeywords = clone(VALID_KEYWORDS);
  validKeywords.subjects = [
    { name: 'Person', role: 'subject', must_have: true, kind: 'person', owner: '' },
    { name: 'Object', role: 'property', must_have: false, kind: 'object', owner: 'Owner' },
  ];
  assert.strictEqual(validateKeywordsV1Structure(validKeywords).ok, true);
  const personOwner = clone(validKeywords);
  personOwner.subjects[0].owner = 'Not empty';
  assert.strictEqual(validateKeywordsV1Structure(personOwner).ok, false);
  const objectOwner = clone(validKeywords);
  objectOwner.subjects[1].owner = '';
  assert.strictEqual(validateKeywordsV1Structure(objectOwner).ok, false);
  const kind = clone(validKeywords);
  kind.subjects[0].kind = 'other';
  assert.strictEqual(validateKeywordsV1Structure(kind).ok, false);
  const mustHave = clone(validKeywords);
  mustHave.subjects[0].must_have = 'true';
  assert.strictEqual(validateKeywordsV1Structure(mustHave).ok, false);
  const missingList = clone(validKeywords);
  delete missingList.hashtags;
  assert.strictEqual(validateKeywordsV1Structure(missingList).ok, false);
  const unknownList = clone(validKeywords);
  unknownList.unknown = [];
  assert.strictEqual(validateKeywordsV1Structure(unknownList).ok, false);
});

test('C2 strict parser accepts full JSON only and never fence-strips or brace-extracts', async () => {
  await withEnv({ ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    const fenced = '```json\n' + json(VALID_ANALYSIS) + '\n```';
    const withPrefix = 'explanation ' + json(VALID_ANALYSIS);
    for (const text of [fenced, withPrefix]) {
      const { error, fetcher } = await expectStrictError([
        responseStep({ text, actualModel: PIN.model }),
        responseStep({ text, actualModel: PIN.model }),
      ]);
      assert.strictEqual(error.errorType, 'JSON_PARSE_FAILED');
      assert.strictEqual(error.provenance.attemptCount, 2);
      assert.strictEqual(error.provenance.repairCount, 1);
      assert.strictEqual(fetcher.calls.length, 2);
    }
  });
});

test('C3 non-enumerable required fields and array indexes fail while normal fixtures pass without getters or traps', () => {
  assert.deepStrictEqual(readStoredPin(makeAnalyzeMeta()), PIN);
  const hiddenMeta = makeAnalyzeMeta();
  Object.defineProperty(hiddenMeta, 'actualModelVersion', { value: null, enumerable: false });
  assert.strictEqual(readStoredPin(hiddenMeta), null);

  assert.strictEqual(validateAnalysisV1Structure(clone(VALID_ANALYSIS)).ok, true);
  const hiddenAnalysis = clone(VALID_ANALYSIS);
  Object.defineProperty(hiddenAnalysis, 'summary', { value: hiddenAnalysis.summary, enumerable: false });
  assert.strictEqual(validateAnalysisV1Structure(hiddenAnalysis).ok, false);

  const normalArrayAnalysis = clone(VALID_ANALYSIS);
  normalArrayAnalysis.content.key_events = ['one event'];
  assert.strictEqual(validateAnalysisV1Structure(normalArrayAnalysis).ok, true);
  const hiddenIndexAnalysis = clone(normalArrayAnalysis);
  Object.defineProperty(hiddenIndexAnalysis.content.key_events, '0', { value: 'one event', enumerable: false });
  assert.strictEqual(validateAnalysisV1Structure(hiddenIndexAnalysis).ok, false);

  let getterCalls = 0;
  const accessorAnalysis = clone(VALID_ANALYSIS);
  Object.defineProperty(accessorAnalysis, 'headline', {
    enumerable: true,
    get() { getterCalls++; return 'must not be read'; },
  });
  assert.strictEqual(validateAnalysisV1Structure(accessorAnalysis).ok, false);

  let trapCalls = 0;
  const proxyAnalysis = new Proxy(clone(VALID_ANALYSIS), {
    ownKeys() { trapCalls++; throw new Error('C3_PROXY_TRAP'); },
  });
  assert.strictEqual(validateAnalysisV1Structure(proxyAnalysis).ok, false);
  assert.strictEqual(getterCalls, 0);
  assert.strictEqual(trapCalls, 0);
});

// ============================================================
// D — routes, compatibility, redaction, and persistence failures
test('D1 legacy callBrain remains callable without a forced pin and exposes actualModel additively', async () => {
  await withEnv({ ANALYSIS_PROVIDER: 'anthropic', ANALYSIS_MODEL: 'legacy-model', ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    const fetcher = installFetch([responseStep({ text: 'legacy-response', actualModel: 'legacy-reported-model' })]);
    try {
      const result = await callBrain({ system: 'legacy-system', user: 'legacy-user' });
      assert.strictEqual(result.provider, 'anthropic');
      assert.strictEqual(result.model, 'legacy-model');
      assert.strictEqual(result.actualModel, 'legacy-reported-model');
      assert.strictEqual(result.text, 'legacy-response');
      assert.strictEqual(fetcher.calls.length, 1);
    } finally {
      fetcher.restore();
    }
  });
});

test('D2 strict terminal route responses align top-level/meta errorType and omit raw output/news/prompt data', async () => {
  await withEnv({ ANALYSIS_PROVIDER: 'anthropic', ANALYSIS_MODEL: PIN.model, ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    const invalidText = `{"partial":"${RAW_OUTPUT_SECRET}"}`;
    const fetcher = installFetch([
      responseStep({ text: invalidText, actualModel: PIN.model }),
      responseStep({ text: invalidText, actualModel: PIN.model }),
    ]);
    try {
      const response = await analyzePOST(requestOf({ newsText: NEWS_TEXT }));
      assert.strictEqual(response.status, 502);
      assert.strictEqual(response._body.errorType, response._body.meta.errorType);
      assert.strictEqual(response._body.meta.actualModel, PIN.model);
      const serialized = JSON.stringify(response._body);
      assert.strictEqual(serialized.includes(RAW_OUTPUT_SECRET), false);
      assert.strictEqual(serialized.includes(NEWS_TEXT), false);
      assert.strictEqual(serialized.includes('test-system'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(response._body, 'raw'), false);
    } finally {
      fetcher.restore();
    }

    const store = setCaseStore({ caseRecord: { id: 'AC-ERR', newsText: NEWS_TEXT, analysis: clone(VALID_ANALYSIS), meta: makeAnalyzeMeta() } });
    const keywordFetch = installFetch([
      responseStep({ text: invalidText, actualModel: PIN.model }),
      responseStep({ text: invalidText, actualModel: PIN.model }),
    ]);
    try {
      const response = await keywordsPOST(requestOf({ caseId: 'AC-ERR' }));
      assert.strictEqual(response.status, 502);
      assert.strictEqual(response._body.errorType, response._body.meta.errorType);
      assert.strictEqual(JSON.stringify(response._body).includes(RAW_OUTPUT_SECRET), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(response._body, 'raw'), false);
      assert.strictEqual(store.updateCalls.length, 0);
    } finally {
      keywordFetch.restore();
    }
  });
});

test('D3 addCase/updateCase failures are typed 500 store failures with no false success or follow-on admission', async () => {
  await withEnv({ ANALYSIS_PROVIDER: 'anthropic', ANALYSIS_MODEL: PIN.model, ANTHROPIC_API_KEY: TEST_KEY }, async () => {
    const analyzeStore = setCaseStore({ addError: new Error('STORAGE_SECRET_ANALYZE') });
    const analyzeFetch = installFetch([responseStep({ text: json(VALID_ANALYSIS), actualModel: PIN.model })]);
    try {
      const response = await analyzePOST(requestOf({ newsText: NEWS_TEXT }));
      assert.strictEqual(response.status, 500);
      assert.strictEqual(response._body.errorType, 'STORE_WRITE_FAILED');
      assert.strictEqual(response._body.success, false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(response._body, 'analysis'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(response._body, 'meta'), false);
      assert.strictEqual(JSON.stringify(response._body).includes('STORAGE_SECRET_ANALYZE'), false);
      assert.strictEqual(analyzeStore.addCalls.length, 1);
    } finally {
      analyzeFetch.restore();
    }

    const keywordStore = setCaseStore({
      caseRecord: { id: 'AC-STORE', newsText: NEWS_TEXT, analysis: clone(VALID_ANALYSIS), meta: makeAnalyzeMeta() },
      updateError: new Error('STORAGE_SECRET_KEYWORDS'),
    });
    const keywordFetch = installFetch([responseStep({ text: json(VALID_KEYWORDS), actualModel: PIN.model })]);
    try {
      const response = await keywordsPOST(requestOf({ caseId: 'AC-STORE' }));
      assert.strictEqual(response.status, 500);
      assert.strictEqual(response._body.errorType, 'STORE_WRITE_FAILED');
      assert.strictEqual(response._body.success, false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(response._body, 'keywords'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(response._body, 'meta'), false);
      assert.strictEqual(JSON.stringify(response._body).includes('STORAGE_SECRET_KEYWORDS'), false);
      assert.strictEqual(keywordStore.updateCalls.length, 1);
    } finally {
      keywordFetch.restore();
    }
  });
});

test('D4 malformed stored meta reaches PIN_MISSING without resolving env or calling a provider', async () => {
  await withEnv({ ANALYSIS_PROVIDER: 'openai', ANALYSIS_MODEL: 'env-fallback-must-not-run', ANTHROPIC_API_KEY: TEST_KEY, OPENAI_API_KEY: TEST_KEY }, async () => {
    let getterCalls = 0;
    const meta = {};
    Object.defineProperty(meta, 'requestedProvider', {
      enumerable: true,
      get() { getterCalls++; throw new Error('META_ROUTE_GETTER_MUST_NOT_RUN'); },
    });
    const store = setCaseStore({ caseRecord: { id: 'AC-META', newsText: NEWS_TEXT, analysis: clone(VALID_ANALYSIS), meta } });
    const fetcher = installFetch([]);
    try {
      const response = await keywordsPOST(requestOf({ caseId: 'AC-META' }));
      assert.strictEqual(response.status, 502);
      assert.strictEqual(response._body.errorType, 'PIN_MISSING');
      assert.strictEqual(fetcher.calls.length, 0);
      assert.strictEqual(store.getCalls.length, 1);
    } finally {
      fetcher.restore();
    }
    assert.strictEqual(getterCalls, 0);
  });
});
