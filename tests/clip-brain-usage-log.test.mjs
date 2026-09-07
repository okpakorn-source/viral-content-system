/** Offline usage accounting tests: no real Gemini, CLI, Prisma, or database calls. */
import assert from 'node:assert/strict';
import { test, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';

const SRC = new URL('../src/', import.meta.url).href;
const PIPE_URL = new URL('../src/lib/services/clipBrain/clipBrainPipeline.js', import.meta.url);
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
    if (spec === '../../ai/usageLogger.js' && ctx.parentURL === ${JSON.stringify(PIPE_URL.href)}) {
      return { url: ${JSON.stringify(loggerModule)}, shortCircuit: true };
    }
    if (spec === './brainRunner.js' && ctx.parentURL === ${JSON.stringify(PIPE_URL.href)}) {
      return { url: 'data:text/javascript,export async function runBrain() { return { ok: false, errorType: "TEST_OFFLINE" }; }', shortCircuit: true };
    }
    if (spec === '@/lib/services/clipAI/openai') {
      return { url: 'data:text/javascript,export function callAI() { throw new Error("Unexpected AI call"); }', shortCircuit: true };
    }
    if (spec.startsWith('@/')) return next(new URL(spec.slice(2) + (hasExt(spec) ? '' : '.js'), ${JSON.stringify(SRC)}).href, ctx);
    if ((spec.startsWith('./') || spec.startsWith('../')) && !hasExt(spec)) {
      try { return await next(spec + '.js', ctx); } catch { /* Try the original specifier. */ }
    }
    return next(spec, ctx);
  }
`));

const { callClipGeminiVideo } = await import(VIDEO_URL.href);
const { runClipBrainPipeline } = await import(PIPE_URL.href);
const { llmCost } = await import(new URL('../src/lib/costRates.js', import.meta.url).href);
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
function shortResponses(usages = USAGES) {
  return [response({ headline: 'Clip topic', clipDurationSec: 60, timeline: [] }, usages[0]),
    response(INSIGHT, usages[1]), response({ transcription: 'Short truth' }, usages[2])];
}
function pipelineOpts(extra = {}) {
  return { url: CLIP_URL, isYouTube: true, durationSec: 60, model: MODEL, usageLogger: () => {}, ...extra };
}
function records(brain) { return brain.steps.filter((s) => typeof s.ok === 'boolean'); }
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

for (const [name, callback] of [
  ['sync throw', () => { throw new Error('logger offline'); }],
  ['async rejection', async () => { throw new Error('logger offline'); }],
  ['pending promise', () => new Promise(() => {})],
]) {
  test(`onUsage ${name} cannot fail, retry, or block Gemini`, { timeout: 2000 }, async () => {
    const calls = mockSequence([response()]);
    const r = await callClipGeminiVideo({ ...BASE, onUsage: callback });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(r.receipt.attempts.length, 1);
  });
  test(`pipeline usageLogger ${name} cannot fail, retry, or block transcription`, { timeout: 2000 }, async () => {
    const calls = mockSequence(shortResponses());
    const r = await runClipBrainPipeline(pipelineOpts({ usageLogger: callback }));
    assert.equal(r.ok, true);
    assert.equal(calls.length, 3);
    assert.equal(r.brain.usage.totalTokens, 7025);
  });
}

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

for (const isYouTube of [true, false]) {
  test(`pipeline preserves legacy fields and sums usage for ${isYouTube ? 'URL' : 'file'} input`, async () => {
    const fetches = mockSequence(shortResponses());
    const logged = [];
    const r = await runClipBrainPipeline(pipelineOpts({ isYouTube, videoBuffer: Buffer.alloc(12000), usageLogger: (u) => logged.push(u) }));
    assert.equal(r.ok, true);
    assert.equal(fetches.length, 3);
    const features = ['clipBrain-map', 'clipBrain-segment', 'clipBrain-truth'];
    assert.deepEqual(logged, USAGES.map((u, i) => expectedEvent(u, features[i], isYouTube ? 'gemini_video' : 'gemini_video_file')));
    const steps = records(r.brain);
    assert.equal(steps.length, 3);
    for (const [i, s] of steps.entries()) {
      assert.equal(s.inputTokens, USAGES[i].promptTokenCount);
      assert.equal(s.outputTokens, USAGES[i].candidatesTokenCount);
      assert.equal(s.cachedTokens, USAGES[i].cachedContentTokenCount);
      assert.equal(s.tokens, USAGES[i].totalTokenCount);
      assert.equal(r.brain.costs[s.name], s.tokens);
      assert.equal(s.model, MODEL);
      assert.equal(s.ok, true);
      assert.equal(typeof s.ms, 'number');
    }
    assert.deepEqual(r.brain.usage, {
      inputTokens: 6000, outputTokens: 900, cachedTokens: 2600, totalTokens: 7025,
      cachedPct: Math.round(2600 / 6000 * 100),
      estUsd: USAGES.reduce((sum, u) => sum + llmCost('gemini', MODEL, u.promptTokenCount, u.candidatesTokenCount), 0),
    });
    assert.ok(r.brain.usage.estUsd > 0, 'Unknown model uses the existing Gemini estimate');
    assert.equal(r.brain.totalTokens, 7025);
    assert.equal(r.spentTokens, 7025);
  });
}

test('parallel segments each get their own usage event and are summed', async () => {
  const usages = [USAGES[0], USAGES[1], USAGES[1], USAGES[2]];
  const calls = mockSequence([response({ headline: 'Long clip', timeline: [] }, usages[0]),
    response(INSIGHT, usages[1]), response(INSIGHT, usages[2]), response({ transcription: 'Short truth' }, usages[3])]);
  const logged = [];
  const r = await runClipBrainPipeline(pipelineOpts({ durationSec: 1200, usageLogger: (u) => logged.push(u) }));
  assert.equal(r.ok, true);
  assert.equal(calls.length, 4);
  assert.deepEqual(logged.map((u) => u.feature), ['clipBrain-map', 'clipBrain-segment', 'clipBrain-segment', 'clipBrain-truth']);
  assert.deepEqual(calls.slice(1, 3).map((c) => c.body.contents[0].parts[0].videoMetadata), [
    { startOffset: '0s', endOffset: '600s' }, { startOffset: '600s', endOffset: '1200s' },
  ]);
  assert.deepEqual(records(r.brain).map((s) => s.cachedTokens), usages.map((u) => u.cachedContentTokenCount));
  assert.equal(r.brain.usage.inputTokens, 9000);
  assert.equal(r.brain.usage.cachedTokens, 3500);
  assert.equal(r.brain.usage.totalTokens, 10675);
});

test('pipeline totals include failed attempts and estimate each actual fallback model', async () => {
  const fallback = 'gemini-2.0-flash';
  process.env.CLIP_GEMINI_FALLBACK_MODELS = fallback;
  mockSequence([response({}, USAGES[0], { finishReason: 'MAX_TOKENS' }), ...shortResponses()]);
  const logged = [];
  const r = await runClipBrainPipeline(pipelineOpts({ usageLogger: (u) => logged.push(u) }));
  assert.equal(r.ok, true);
  assert.equal(logged.length, 4);
  assert.deepEqual(logged.map((u) => u.model), [MODEL, fallback, MODEL, MODEL]);
  const mapStep = records(r.brain)[0];
  assert.equal(mapStep.inputTokens, 2000);
  assert.equal(mapStep.outputTokens, 400);
  assert.equal(mapStep.cachedTokens, 1400);
  assert.equal(mapStep.attempts, 2);
  assert.equal(mapStep.tokens, 1250, 'Legacy tokens remain final-response usage');
  assert.equal(r.brain.totalTokens, 7025);
  assert.equal(r.brain.usage.totalTokens, 8275);
  assert.equal(r.brain.usage.estUsd, logged.reduce((sum, u) => sum + llmCost('gemini', u.model, u.inputTokens, u.outputTokens), 0));
});

test('terminal Gemini failure still accounts for usage before pipeline returns', async () => {
  mockSequence([response({}, USAGES[0], { finishReason: 'MAX_TOKENS' })]);
  const logged = [];
  const r = await runClipBrainPipeline(pipelineOpts({ usageLogger: (u) => logged.push(u) }));
  assert.equal(r.ok, false);
  assert.equal(logged.length, 1);
  assert.equal(r.brain.usage.totalTokens, 1250);
  assert.equal(records(r.brain)[0].cachedTokens, 700);
  assert.equal(records(r.brain)[0].ok, false);
});

test('zero or absent usage never gives NaN; cached percentage stays within 0-100', async () => {
  mockSequence(shortResponses([null, {}, { promptTokenCount: 0, cachedContentTokenCount: 1, totalTokenCount: 0 }]));
  const zero = await runClipBrainPipeline(pipelineOpts());
  assert.equal(zero.ok, true);
  assert.equal(zero.brain.usage.cachedPct, 0);
  assert.equal(zero.brain.usage.estUsd, 0);
  assert.equal(records(zero.brain)[0].inputTokens, 0);
  mockSequence(shortResponses([null, null, { promptTokenCount: 1, cachedContentTokenCount: 2, totalTokenCount: 1 }]));
  const clamped = await runClipBrainPipeline(pipelineOpts());
  assert.equal(clamped.brain.usage.cachedPct, 100);
  const noSource = await runClipBrainPipeline({});
  assert.deepEqual(noSource.brain.usage, { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, cachedPct: 0, estUsd: 0 });
});

test('CLIP_USAGE_LOG=0 disables injected and default loggers while retaining accounting', async () => {
  assert.equal(loggerState.loaded, 0, 'Import and injected loggers must not load the DB logger');
  process.env.CLIP_USAGE_LOG = '0';
  let calls = 0;
  const checkDisabled = async (usageLogger) => {
    mockSequence(shortResponses());
    const r = await runClipBrainPipeline(pipelineOpts({ usageLogger }));
    assert.equal(r.ok, true);
    assert.equal(r.brain.usage.cachedTokens, 2600);
  };
  await checkDisabled(() => { calls++; });
  await checkDisabled(undefined);
  assert.equal(calls, 0);
  await nextTurn();
  assert.equal(loggerState.loaded, 0);
});

test('default logger is lazily imported and receives all three usage records', { timeout: 3000 }, async () => {
  assert.equal(loggerState.loaded, 0);
  const logged = new Promise((resolve) => {
    loggerState.onLogged = () => { if (loggerState.calls.length === 3) resolve(); };
  });
  mockSequence(shortResponses());
  const r = await runClipBrainPipeline(pipelineOpts({ usageLogger: undefined }));
  assert.equal(r.ok, true);
  await logged;
  assert.equal(loggerState.loaded, 1);
  assert.deepEqual(loggerState.calls.map((u) => u.feature), ['clipBrain-map', 'clipBrain-segment', 'clipBrain-truth']);
  assert.equal(loggerState.calls[0].provider, 'gemini_video');
});

test('clip modules have no static usageLogger/DB/Prisma imports', () => {
  for (const url of [PIPE_URL, VIDEO_URL]) {
    const source = readFileSync(url, 'utf8');
    assert.doesNotMatch(source, /^import.*usageLogger/m);
    assert.doesNotMatch(source, /^import\s+[\s\S]*?\sfrom\s+['"][^'"]*(?:usageLogger|prisma|\/db(?:\.js)?)['"]/m);
  }
  assert.match(readFileSync(PIPE_URL, 'utf8'), /await import\('\.\.\/\.\.\/ai\/usageLogger\.js'\)/);
});
