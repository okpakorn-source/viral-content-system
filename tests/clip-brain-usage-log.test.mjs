/** Offline usage accounting tests: no real Gemini, CLI, Prisma, or database calls.
 *  ★ 26 ต.ค. 69 เฟส 4: เครื่องยนต์เดิม (clipBrainPipeline) ถูกลบ — เหลือเทสมิเตอร์ของตัวดูคลิป (clipGeminiVideo) ที่เครื่องยนต์ช่องเดียวใช้ */
import assert from 'node:assert/strict';
import { test, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';

const SRC = new URL('../src/', import.meta.url).href;
const VIDEO_URL = new URL('../src/lib/services/clipBrain/clipGeminiVideo.js', import.meta.url);
const loggerKey = Symbol.for('clip-brain-usage-log.test.logger');
const loggerState = { loaded: 0, calls: [], onLogged: null };
globalThis[loggerKey] = loggerState;
after(() => { delete globalThis[loggerKey]; });

// Keep real normalization and planning; replace only external AI/DB boundaries.
const loggerModule = 'data:text/javascript,' + encodeURIComponent(`
  const state = globalThis[Symbol.for('clip-brain-usage-log.test.logger')];
  state.loaded++;
  export async function logApiUsage(usage) {
    state.calls.push(usage);
    state.onLogged?.();
  }
`);
register('data:text/javascript,' + encodeURIComponent(`
  const hasExt = (s) => /\\.[a-zA-Z0-9]{1,5}$/.test(s);
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) return next(new URL(spec.slice(2) + (hasExt(spec) ? '' : '.js'), ${JSON.stringify(SRC)}).href, ctx);
    if ((spec.startsWith('./') || spec.startsWith('../')) && !hasExt(spec)) {
      try { return await next(spec + '.js', ctx); } catch { /* Try the original specifier. */ }
    }
    return next(spec, ctx);
  }
`));

const { callClipGeminiVideo } = await import(VIDEO_URL.href);
const ENV_KEYS = ['GEMINI_VIDEO_API_KEY', 'GEMINI_API_KEY', 'CLIP_SAFE_TEXT', 'CLIP_USAGE_LOG',
  'CLIP_GEMINI_MAX_ATTEMPTS', 'CLIP_GEMINI_FALLBACK_MODELS'];
let savedEnv, savedFetch;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { GEMINI_VIDEO_API_KEY: 'offline-test-key', CLIP_SAFE_TEXT: '0', CLIP_GEMINI_MAX_ATTEMPTS: '1' });
  savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected fetch: test fixture missing'); };
  loggerState.calls = [];
  loggerState.onLogged = null;
});
afterEach(async () => {
  await nextTurn(); // Surface any unhandled asynchronous callback rejection within the test.
  globalThis.fetch = savedFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const MODEL = 'gemini-3.7-flash';
const CLIP_URL = 'https://www.youtube.com/watch?v=offline-test';
const BASE = { youtubeUrl: CLIP_URL, prompt: 'Read the clip', model: MODEL, maxAttempts: 1, fallbackModels: [] };
const USAGES = [
  { promptTokenCount: 1000, candidatesTokenCount: 200, cachedContentTokenCount: 700, totalTokenCount: 1250 },
  { promptTokenCount: 3000, candidatesTokenCount: 600, cachedContentTokenCount: 900, totalTokenCount: 3650 },
  { promptTokenCount: 2000, candidatesTokenCount: 100, cachedContentTokenCount: 1000, totalTokenCount: 2125 },
];
const INSIGHT = { headline: 'Clip topic', clipType: 'monologue', rawData: 'The speaker describes the event.', quotes: [], subStories: [] };
function response(data = {}, usage = USAGES[0], { text = JSON.stringify(data), finishReason = 'STOP', status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    ...(usage === null ? {} : { usageMetadata: usage }),
  }) };
}
function mockSequence(responses) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const index = calls.length;
    calls.push({ model: decodeURIComponent(url.split('/models/')[1].split(':')[0]), body: JSON.parse(opts.body) });
    assert.ok(index < responses.length, 'No unexpected Gemini requests');
    return responses[index];
  };
  return calls;
}
function expectedEvent(usage, feature, provider = 'gemini_video', model = MODEL) {
  return { provider, model, inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0, cachedTokens: usage.cachedContentTokenCount || 0,
    totalTokens: usage.totalTokenCount ?? ((usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0)), feature };
}

for (const [provider, source] of [
  ['gemini_video', { youtubeUrl: CLIP_URL }],
  ['gemini_video_file', { youtubeUrl: '', videoBuffer: Buffer.alloc(12000) }],
]) {
  test(`onUsage reports exact metadata once for ${provider}`, async () => {
    const calls = mockSequence([response({ answer: 'ok' })]);
    const usageCalls = [];
    const r = await callClipGeminiVideo({ ...BASE, ...source, feature: 'clipBrain-map', onUsage: (u) => usageCalls.push(u) });
    assert.equal(r.ok, true);
    assert.deepEqual(usageCalls, [expectedEvent(USAGES[0], 'clipBrain-map', provider)]);
    assert.equal(calls.length, 1);
    assert.deepEqual(r.receipt.usage, USAGES[0]);
    assert.equal('onUsage' in calls[0].body, false);
    assert.equal('feature' in calls[0].body, false);
  });
}

test('missing cached/total counts default safely; absent usage produces no callback', async () => {
  mockSequence([response({}, { promptTokenCount: 12, candidatesTokenCount: 3 }), response({}, null)]);
  const calls = [];
  const opts = { ...BASE, onUsage: (u) => calls.push(u) };
  assert.equal((await callClipGeminiVideo(opts)).ok, true);
  assert.equal((await callClipGeminiVideo(opts)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cachedTokens, 0);
  assert.equal(calls[0].totalTokens, 15);
});

test('onUsage remains optional', async () => {
  mockSequence([response()]);
  assert.equal((await callClipGeminiVideo(BASE)).ok, true);
});

test('retry logs both invalid JSON and successful response once each', async (t) => {
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, _ms, ...args) => realTimeout(fn, 0, ...args));
  const calls = mockSequence([response({}, USAGES[0], { text: '{broken' }), response({}, USAGES[1])]);
  const logged = [];
  const r = await callClipGeminiVideo({ ...BASE, maxAttempts: 2, feature: 'clipBrain-segment', onUsage: (u) => logged.push(u) });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(logged, USAGES.slice(0, 2).map((u) => expectedEvent(u, 'clipBrain-segment')));
  assert.deepEqual(r.receipt.attempts.map((a) => a.usage), USAGES.slice(0, 2));
  assert.deepEqual(r.receipt.usage, USAGES[1], 'Legacy receipt still describes the final successful response');
});

test('HTTP failure with usage is logged before fallback with the actual model', async () => {
  const fallback = 'gemini-2.0-flash';
  const calls = mockSequence([response({}, USAGES[0], { text: '', status: 503 }), response({}, USAGES[1])]);
  const logged = [];
  const r = await callClipGeminiVideo({ ...BASE, fallbackModels: [fallback], feature: 'clipBrain-truth', onUsage: (u) => logged.push(u) });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map((c) => c.model), [MODEL, fallback]);
  assert.deepEqual(logged, [expectedEvent(USAGES[0], 'clipBrain-truth'), expectedEvent(USAGES[1], 'clipBrain-truth', 'gemini_video', fallback)]);
});

test('clip modules have no static usageLogger/DB/Prisma imports', () => {
  const SINGLE_URL = new URL('../src/lib/services/clipSingle/pipeline.js', import.meta.url);
  for (const url of [VIDEO_URL, SINGLE_URL]) {
    const source = readFileSync(url, 'utf8');
    assert.doesNotMatch(source, /^import.*usageLogger/m);
    assert.doesNotMatch(source, /^import\s+[\s\S]*?\sfrom\s+['"][^'"]*(?:usageLogger|prisma|\/db(?:\.js)?)['"]/m);
  }
  // มิเตอร์ของเครื่องยนต์ช่องเดียวอยู่ที่ประตู insight แบบโหลดตอนใช้ (มิเตอร์ล้มต้องไม่ล้มงาน)
  const route = readFileSync(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8');
  assert.match(route, /await import\('@\/lib\/ai\/usageLogger'\)/);
});
