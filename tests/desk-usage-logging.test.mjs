import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const AI_RAW_URL = new URL('../src/lib/services/newsDesk/aiRaw.js', import.meta.url).href;
const DNA_EXTRACTOR_URL = new URL('../src/lib/services/newsDesk/dnaExtractor.js', import.meta.url).href;
const moduleUrl = (body) => `data:text/javascript,${encodeURIComponent(body)}`;

const STUB_OPENAI = moduleUrl(`
export function getOpenAIClient() {
  return globalThis.__DESK_USAGE_TEST_STATE?.client || null;
}
`);

const STUB_USAGE = moduleUrl(`
export function logApiUsage(payload) {
  const state = globalThis.__DESK_USAGE_TEST_STATE;
  if (!state) throw new Error('DESK_USAGE_TEST_STATE_MISSING');
  state.logAttempts.push(payload);
  if (state.logMode === 'sync-throw') throw new Error('USAGE_LOG_SYNC_FAILURE');
  if (state.logMode === 'async-reject') return Promise.reject(new Error('USAGE_LOG_ASYNC_FAILURE'));
  return Promise.resolve(null);
}
`);

const STUB_STORE = moduleUrl(`
export function createStore(name) {
  const state = globalThis.__DESK_USAGE_TEST_STATE;
  if (!state) throw new Error('DESK_USAGE_TEST_STATE_MISSING');
  state.storeNames.push(name);
  return {
    async getAll() { return state.storeRecords; },
    async add(record) {
      state.storeWrites.push({ type: 'add', record });
      state.storeRecords = [...state.storeRecords, record];
      return record;
    },
    async update(id, updater) {
      const current = state.storeRecords.find((record) => record.id === id);
      const record = updater(current);
      state.storeWrites.push({ type: 'update', id, record });
      state.storeRecords = state.storeRecords.filter((item) => item.id !== id).concat(record);
      return record;
    },
  };
}
`);

const STUB_CONFIG = moduleUrl(`
export const DESK_MODEL_FAST = 'gpt-5.6-luna';
export const DESK_MODEL_BRAIN = 'gpt-5.6-terra';
`);

const hook = `
import { readFile } from 'node:fs/promises';
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(STUB_OPENAI)}, shortCircuit: true };
  if (specifier === '@/lib/ai/usageLogger') return { url: ${JSON.stringify(STUB_USAGE)}, shortCircuit: true };
  if (specifier === '@/lib/persistStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/services/deskModelConfig') return { url: ${JSON.stringify(STUB_CONFIG)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(
      specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'),
      ${JSON.stringify(SRC_ROOT)},
    ).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url === ${JSON.stringify(AI_RAW_URL)} || url === ${JSON.stringify(DNA_EXTRACTOR_URL)}) {
    return { format: 'module', source: await readFile(new URL(url), 'utf8'), shortCircuit: true };
  }
  return nextLoad(url, context);
}`;
register(moduleUrl(hook));

const ORIGINAL_FETCH = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const ORIGINAL_WARN = console.warn;
const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;
const TEST_KEY = 'offline-desk-test-key';
const RAW_SYSTEM = `คุณเป็นบรรณาธิการข่าวไทยมืออาชีพ ตอบเป็น JSON ที่ถูกต้องเท่านั้น ตาม schema ที่ระบุใน prompt
กฎเหล็ก: ใช้เฉพาะข้อเท็จจริงจากข้อมูลที่ให้มา ห้ามแต่งเติม/บิดเบือน · ชื่อคน ตัวเลข สถานที่ คำพูด ต้องตรงต้นฉบับ 100% ห้ามเปลี่ยน/ย่อ/ตัด/แทนคำในชื่อเฉพาะ`;

process.env.OPENAI_API_KEY = TEST_KEY;
console.warn = (...args) => {
  const state = globalThis.__DESK_USAGE_TEST_STATE;
  if (state) state.warnings.push(args);
  else ORIGINAL_WARN(...args);
};

after(() => {
  if (ORIGINAL_FETCH) Object.defineProperty(globalThis, 'fetch', ORIGINAL_FETCH);
  else delete globalThis.fetch;
  console.warn = ORIGINAL_WARN;
  if (ORIGINAL_OPENAI_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  delete globalThis.__DESK_USAGE_TEST_STATE;
});

function providerResponse(content = '{"ok":true}', usage = { prompt_tokens: 11, completion_tokens: 7 }) {
  return { choices: [{ message: { content } }], usage };
}

function resetState(steps = []) {
  const state = {
    steps: [...steps],
    sdkPayloads: [],
    logAttempts: [],
    logMode: 'ok',
    warnings: [],
    networkBombCalls: 0,
    fetchCalls: [],
    storeNames: [],
    storeRecords: [],
    storeWrites: [],
  };
  state.client = {
    chat: {
      completions: {
        create: async (payload) => {
          state.sdkPayloads.push(JSON.parse(JSON.stringify(payload)));
          const step = state.steps.shift();
          if (!step) throw new Error('UNEXPECTED_OPENAI_SDK_CALL');
          if (step.error) throw step.error;
          return step.response;
        },
      },
    },
  };
  globalThis.__DESK_USAGE_TEST_STATE = state;
  globalThis.fetch = () => {
    state.networkBombCalls += 1;
    throw new Error('NETWORK_FORBIDDEN');
  };
  return state;
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

const { callRawJSON } = await import('../src/lib/services/newsDesk/aiRaw.js');
const { extractDna } = await import('../src/lib/services/newsDesk/dnaExtractor.js');

test('callRawJSON logs exactly once with a desk:<caller> feature and provider usage', async () => {
  const state = resetState([{ response: providerResponse('{"answer":42}', { prompt_tokens: 9, completion_tokens: 4 }) }]);
  const result = await callRawJSON({ prompt: 'payload-one', model: 'gpt-5.6-terra', caller: 'unit-route' });

  assert.deepEqual(result, { answer: 42 });
  assert.equal(state.sdkPayloads.length, 1);
  assert.deepEqual(state.logAttempts, [{
    provider: 'openai',
    model: 'gpt-5.6-terra',
    inputTokens: 9,
    outputTokens: 4,
    feature: 'desk:unit-route',
  }]);
  assert.match(state.logAttempts[0].feature, /^desk:/);
  assert.equal(state.networkBombCalls, 0);
});

test('omitting caller safely uses desk:unknown and does not throw', async () => {
  const state = resetState([{ response: providerResponse('{"safe":true}') }]);
  const result = await callRawJSON({ prompt: 'no-caller', model: 'gpt-5.6-terra' });

  assert.deepEqual(result, { safe: true });
  assert.equal(state.logAttempts.length, 1);
  assert.equal(state.logAttempts[0].feature, 'desk:unknown');
});

test('a synchronous usage logger failure is fail-open for the main result', async () => {
  const state = resetState([{ response: providerResponse('{"main":"ok"}') }]);
  state.logMode = 'sync-throw';

  const result = await callRawJSON({ prompt: 'sync-log-failure', model: 'gpt-5.6-terra', caller: 'sync-case' });
  assert.deepEqual(result, { main: 'ok' });
  assert.equal(state.logAttempts.length, 1);
  assert.equal(state.warnings.length, 1);
  assert.match(String(state.warnings[0][1]), /USAGE_LOG_SYNC_FAILURE/);
});

test('an asynchronous usage logger rejection is fail-open and handled', async () => {
  const state = resetState([{ response: providerResponse('{"main":"ok"}') }]);
  state.logMode = 'async-reject';

  const result = await callRawJSON({ prompt: 'async-log-failure', model: 'gpt-5.6-terra', caller: 'async-case' });
  await flushMicrotasks();
  assert.deepEqual(result, { main: 'ok' });
  assert.equal(state.logAttempts.length, 1);
  assert.equal(state.warnings.length, 1);
  assert.match(String(state.warnings[0][1]), /USAGE_LOG_ASYNC_FAILURE/);
});

test('a failed primary attempt plus a successful fallback logs only the completed call', async () => {
  const state = resetState([
    { error: new Error('PRIMARY_FAILED_BEFORE_RESPONSE') },
    { response: providerResponse('{"fallback":true}', { prompt_tokens: 6, completion_tokens: 2 }) },
  ]);

  const result = await callRawJSON({ prompt: 'fallback', model: 'gpt-5.6-luna', caller: 'fallback-case' });
  assert.deepEqual(result, { fallback: true });
  assert.deepEqual(state.sdkPayloads.map((payload) => payload.model), ['gpt-5.6-luna', 'gpt-5.6-terra']);
  assert.equal(state.logAttempts.length, 1);
  assert.equal(state.logAttempts[0].model, 'gpt-5.6-terra');
  assert.equal(state.logAttempts[0].feature, 'desk:fallback-case');
});

test('every completed provider response is logged once even when empty content triggers fallback', async () => {
  const state = resetState([
    { response: providerResponse('', { prompt_tokens: 3, completion_tokens: 0 }) },
    { response: providerResponse('{"recovered":true}', { prompt_tokens: 5, completion_tokens: 2 }) },
  ]);

  const result = await callRawJSON({ prompt: 'empty-then-fallback', model: 'gpt-5.6-luna', caller: 'empty-case' });
  assert.deepEqual(result, { recovered: true });
  assert.equal(state.sdkPayloads.length, 2);
  assert.deepEqual(state.logAttempts.map((entry) => entry.model), ['gpt-5.6-luna', 'gpt-5.6-terra']);
  assert.equal(state.logAttempts.length, state.sdkPayloads.length);
});

test('OpenAI SDK payload retains exact GPT-5 and legacy fields; caller never leaks', async () => {
  let state = resetState([{ response: providerResponse('{"kind":"new"}') }]);
  await callRawJSON({
    prompt: 'exact-new-prompt', model: 'gpt-5.6-terra', temperature: 0.23, maxTokens: 1234, caller: 'payload-check',
  });
  assert.deepEqual(state.sdkPayloads[0], {
    model: 'gpt-5.6-terra',
    messages: [{ role: 'system', content: RAW_SYSTEM }, { role: 'user', content: 'exact-new-prompt' }],
    max_completion_tokens: 1234,
    response_format: { type: 'json_object' },
  });
  assert.equal(Object.hasOwn(state.sdkPayloads[0], 'caller'), false);

  state = resetState([{ response: providerResponse('{"kind":"legacy"}') }]);
  await callRawJSON({
    prompt: 'exact-legacy-prompt', model: 'gpt-4o', temperature: 0.23, maxTokens: 4321, caller: 'payload-check',
  });
  assert.deepEqual(state.sdkPayloads[0], {
    model: 'gpt-4o',
    messages: [{ role: 'system', content: RAW_SYSTEM }, { role: 'user', content: 'exact-legacy-prompt' }],
    temperature: 0.23,
    max_tokens: 4321,
    response_format: { type: 'json_object' },
  });
  assert.equal(Object.hasOwn(state.sdkPayloads[0], 'caller'), false);
});

const DNA_CSV = `ชื่อ,ความรู้สึก
"เด็กหญิงตัวอย่างสอบติดหมอหลังช่วยแม่ขายของทุกวัน",400
"คุณตาตัวอย่างเก็บเงินคืนเจ้าของครบทุกบาท",300
"แม่เลี้ยงเดี่ยวตัวอย่างทำงานส่งลูกเรียนจนจบ",200
"ชายพิการตัวอย่างฝึกอาชีพเลี้ยงครอบครัวสำเร็จ",100`;

const rawTheme = (name, react) => ({ themes: [{
  name,
  dna: `ดีเอ็นเอ ${name}`,
  category: 'สู้ชีวิต',
  newsQueries: [`ข่าว ${name}`],
  clipQueries: [`คลิป ${name}`],
  exampleReact: react,
}] });

const mergedThemes = { themes: [{
  name: 'แนวรวม',
  dna: 'ดีเอ็นเอรวม',
  category: 'สู้ชีวิต',
  newsQueries: ['ข่าวแนวรวม'],
  clipQueries: ['คลิปแนวรวม'],
  weight: 9,
}] };

function installDnaFetch(state, dataSteps) {
  globalThis.fetch = async (input, options = {}) => {
    const index = state.fetchCalls.length;
    const body = JSON.parse(options.body);
    state.fetchCalls.push({ url: String(input), options: { ...options }, body });
    const data = dataSteps[index];
    if (!data) throw new Error(`UNEXPECTED_DNA_FETCH_${index}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 20 + index, completion_tokens: 5 + index },
      }),
      text: async () => '',
    };
  };
}

async function runDnaFixture({ logMode = 'ok' } = {}) {
  const state = resetState();
  state.logMode = logMode;
  installDnaFetch(state, [rawTheme('แนวเด็ก', 400), rawTheme('แนวคนดี', 300), mergedThemes]);
  const result = await extractDna(DNA_CSV, { topN: 4, batch: 2 });
  await flushMicrotasks();
  return { state, result };
}

test('dnaExtractor logs every chunk and consolidation, routes FAST/FAST/BRAIN, and preserves HTTP payload fields', async () => {
  const { state, result } = await runDnaFixture();
  assert.equal(state.fetchCalls.length, 3);
  assert.deepEqual(state.fetchCalls.map((call) => call.url), Array(3).fill('https://api.openai.com/v1/chat/completions'));
  assert.deepEqual(state.fetchCalls.map((call) => call.body.model), ['gpt-5.6-luna', 'gpt-5.6-luna', 'gpt-5.6-terra']);
  assert.deepEqual(state.logAttempts.map((entry) => entry.model), ['gpt-5.6-luna', 'gpt-5.6-luna', 'gpt-5.6-terra']);
  assert.deepEqual(state.logAttempts.map((entry) => entry.feature), Array(3).fill('desk:dna-extract'));
  assert.equal(state.logAttempts.length, state.fetchCalls.length);

  for (const [index, call] of state.fetchCalls.entries()) {
    assert.equal(call.options.method, 'POST');
    assert.deepEqual(call.options.headers, {
      Authorization: `Bearer ${TEST_KEY}`,
      'Content-Type': 'application/json',
    });
    assert.deepEqual(Object.keys(call.body).sort(), ['max_tokens', 'messages', 'model', 'response_format', 'temperature']);
    assert.deepEqual(call.body.response_format, { type: 'json_object' });
    assert.equal(Object.hasOwn(call.body, 'caller'), false);
    assert.equal(call.body.messages.length, 1);
    assert.equal(call.body.messages[0].role, 'user');
    if (index < 2) {
      assert.equal(call.body.max_tokens, 3500);
      assert.equal(call.body.temperature, 0.3);
    } else {
      assert.equal(call.body.max_tokens, 4000);
      assert.equal(call.body.temperature, 0.2);
    }
  }

  assert.match(state.fetchCalls[0].body.messages[0].content, /\[400\].+\[300\]/s);
  assert.match(state.fetchCalls[1].body.messages[0].content, /\[200\].+\[100\]/s);
  assert.match(state.fetchCalls[2].body.messages[0].content, /แนวเด็ก/);
  assert.match(state.fetchCalls[2].body.messages[0].content, /แนวคนดี/);
  assert.equal(result.themeCount, 1);
  assert.equal(result.themes[0].name, 'แนวรวม');
  assert.equal(state.storeWrites.length, 1);
  assert.equal(state.storeWrites[0].type, 'add');
});

test('dnaExtractor remains successful when usage logging throws synchronously', async () => {
  const { state, result } = await runDnaFixture({ logMode: 'sync-throw' });
  assert.equal(result.themeCount, 1);
  assert.equal(result.themes[0].name, 'แนวรวม');
  assert.equal(state.logAttempts.length, 3);
  assert.equal(state.warnings.length, 3);
  assert.equal(state.storeWrites.length, 1);
});
