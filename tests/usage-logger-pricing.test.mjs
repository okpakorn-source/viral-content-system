// ============================================================
// 💸 usage-logger-pricing.test.mjs — /cost ต้องไม่ลง $0 ให้ claude-opus-5 / gemini-3.6-flash
// ------------------------------------------------------------
// บริบท: COST-AUDIT.md ข้อ 2-A/2-B (29 ก.ค. 69) พบว่าตารางราคาใน usageLogger.js ไม่มี 2 โมเดลนี้เลย
//   ทั้งที่เป็นโมเดลเขียนจริง/ตาจริงของท่อปกตั้งแต่ 26 ก.ค. → ทุก call ถูกบันทึก costUsd=0 เงียบๆ
// เทสนี้พิสูจน์ว่าหลังเพิ่ม 2 บรรทัดในตาราง PRICING แล้ว logApiUsage คำนวณ costUsd ได้ถูกต้อง (ไม่ใช่ 0)
// ------------------------------------------------------------
// usageLogger.js import '../db.js' (prisma) ตรงๆ — เทสนี้ไม่อยากแตะ DB จริง (Supabase/SQLite) จึง stub
// เฉพาะ '../db.js' ผ่าน node:module register() hook (แพทเทิร์นเดียวกับ tests/pickbestref-fidelity.test.mjs)
// แล้วดัก payload ที่ logApiUsage ส่งเข้า prisma.apiUsageLog.create เพื่อตรวจ costUsd จริงที่คำนวณได้
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { importPatchedModule } from './helpers/temp-module.mjs';

const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

// stub prisma: เก็บ payload ล่าสุดไว้ที่ globalThis ให้เทสอ่านได้ ไม่แตะ DB จริง
const STUB_DB = _mod(`
  export const prisma = {
    apiUsageLog: {
      async create(args) {
        globalThis.__CACHE_AUDIT_WRITES?.push(args);
        if (globalThis.__CACHE_AUDIT_DB_FAIL) throw new Error('test database unavailable');
        globalThis.__USAGE_LOG_CAPTURED = args;
        return args;
      }
    }
  };
`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '../db.js' && context.parentURL && context.parentURL.includes('usageLogger.js')) {
    return { url: ${JSON.stringify(STUB_DB)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook));

const { logApiUsage } = await import('../src/lib/ai/usageLogger.js');

test('claude-opus-5: คิดราคาได้จริง (ไม่ใช่ 0) ตามชั้น opus-4-8 (5.0/25.0 ต่อ 1M token)', async () => {
  globalThis.__USAGE_LOG_CAPTURED = null;
  await logApiUsage({ provider: 'anthropic', model: 'claude-opus-5', inputTokens: 1_000_000, outputTokens: 1_000_000 });
  const captured = globalThis.__USAGE_LOG_CAPTURED;
  assert.ok(captured, 'ต้องเรียกถึง prisma.apiUsageLog.create');
  assert.equal(captured.data.costUsd, 30, 'input 1M×$5 + output 1M×$25 = $30');
});

test('gemini-3.6-flash: คิดราคาได้จริง (ไม่ใช่ 0) ยืมชั้น gemini-3.5-flash (1.50/9.00 ต่อ 1M token)', async () => {
  globalThis.__USAGE_LOG_CAPTURED = null;
  await logApiUsage({ provider: 'google', model: 'gemini-3.6-flash', inputTokens: 1_000_000, outputTokens: 1_000_000 });
  const captured = globalThis.__USAGE_LOG_CAPTURED;
  assert.ok(captured, 'ต้องเรียกถึง prisma.apiUsageLog.create');
  assert.equal(captured.data.costUsd, 10.5, 'input 1M×$1.50 + output 1M×$9.00 = $10.50');
});

// ★ 23 ก.ย. 69 (เจ้าของสั่ง): opus-4-8 → opus-5-5 — ราคาทางการ $4/$20 ต้องได้จากแถวตรงตัว
//   ไม่ใช่ตกไป partial-match 'claude-opus-5' (5/25) — ถอดแถว 'claude-opus-5-5' ทั้งสองตารางแล้วเคสนี้ต้องแดง (ได้ 30 แทน 24)
test('claude-opus-5-5: คิดราคาตรงแถวของตัวเอง 4.0/20.0 ต่อ 1M token (ไม่ใช่ 5/25 ของ opus-5)', async () => {
  globalThis.__USAGE_LOG_CAPTURED = null;
  await logApiUsage({ provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000 });
  const captured = globalThis.__USAGE_LOG_CAPTURED;
  assert.ok(captured, 'ต้องเรียกถึง prisma.apiUsageLog.create');
  assert.equal(captured.data.costUsd, 24, 'input 1M×$4 + output 1M×$20 = $24');
});

test('claude-opus-5-5: ตัวคูณ token เศษส่วนคิดถูกสัดส่วน', async () => {
  globalThis.__USAGE_LOG_CAPTURED = null;
  await logApiUsage({ provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 12000, outputTokens: 3000 });
  const expected = (12000 / 1_000_000) * 4.0 + (3000 / 1_000_000) * 20.0;
  assert.ok(Math.abs(globalThis.__USAGE_LOG_CAPTURED.data.costUsd - expected) < 1e-9);
});

test('claude-opus-5: ตัวคูณ token เศษส่วนคิดถูกสัดส่วน (regression กันพิมพ์ราคาผิดหลักสิบ)', async () => {
  globalThis.__USAGE_LOG_CAPTURED = null;
  await logApiUsage({ provider: 'anthropic', model: 'claude-opus-5', inputTokens: 2900, outputTokens: 900 });
  const captured = globalThis.__USAGE_LOG_CAPTURED;
  const expected = (2900 / 1_000_000) * 5.0 + (900 / 1_000_000) * 25.0;
  assert.ok(Math.abs(captured.data.costUsd - expected) < 1e-9);
  assert.ok(captured.data.costUsd > 0, 'ต้องไม่ใช่ 0 — นี่คือบั๊กเดิมที่ COST-AUDIT.md ชี้ (ข้อ 2-A)');
});

// Cache audit: real client + real pricing, mocked SDK/DB; never use paid APIs.
const CLIENT_URL = new URL('../src/lib/ai/claudeClient.js', import.meta.url);
const JSON_SUFFIX = '\n\nตอบเป็น JSON เท่านั้น ห้ามมี text อื่นนอก JSON';
const CACHE_USAGE = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000 };

async function runClaude({ args = {}, response = {}, sdkError, dbFail = false } = {}) {
  const requests = [], writes = [], logs = [];
  const previousFetch = globalThis.fetch;
  const previousEnv = { ...process.env };
  const previousConsole = { log: console.log, warn: console.warn, error: console.error };
  globalThis.__CACHE_AUDIT_WRITES = writes;
  globalThis.__CACHE_AUDIT_DB_FAIL = dbFail;
  globalThis.__CACHE_AUDIT_CLIENT = { messages: { create: async (body, options) => {
    requests.push({ body: structuredClone(body), options });
    if (sdkError) throw sdkError;
    return {
      id: 'msg_cache_test', _request_id: 'req_cache_test', model: body.model,
      stop_reason: 'end_turn', usage: CACHE_USAGE,
      content: [{ type: 'text', text: '{"news":"ต้นฉบับเดิม"}' }], ...response,
    };
  } } };
  globalThis.fetch = () => { throw new Error('Network is forbidden in cache regression tests'); };
  for (const level of Object.keys(previousConsole)) console[level] = (...parts) => logs.push(parts.join(' '));
  for (const key of ['CLAUDE_WRITE_MODEL', 'CLAUDE_WRITE_EFFORT', 'LEGACY_LENGTH_RULES', 'RISK_WORDS_LEGACY', 'LOG_FULL_PROMPT']) delete process.env[key];
  process.env.ANTHROPIC_API_KEY = 'test-only-no-network';
  try {
    const source = readFileSync(CLIENT_URL, 'utf8')
      .replace("import Anthropic from '@anthropic-ai/sdk';", 'const Anthropic = class { constructor() { return globalThis.__CACHE_AUDIT_CLIENT; } };')
      .replace("from './usageLogger';", "from './usageLogger.js';")
      .replace("import { sanitizeOutput } from './safetyFilter';", 'const sanitizeOutput = (value) => value;');
    const client = await importPatchedModule(source, CLIENT_URL, 'cache-usage-client');
    let result, error;
    try {
      result = await client.callClaude({ prompt: 'ต้นฉบับข่าวทดสอบ', model: 'claude-opus-4-8', effort: 'medium', maxTokens: 16000, ...args });
    } catch (e) { error = e; }
    await Promise.resolve(); // let the mocked asynchronous DB write finish
    const events = logs.filter(s => s.startsWith('[Anthropic Usage] ')).map(s => JSON.parse(s.slice('[Anthropic Usage] '.length)));
    return { requests, writes, logs, events, result, error };
  } finally {
    globalThis.fetch = previousFetch;
    for (const [level, fn] of Object.entries(previousConsole)) console[level] = fn;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    delete globalThis.__CACHE_AUDIT_WRITES;
    delete globalThis.__CACHE_AUDIT_DB_FAIL;
    delete globalThis.__CACHE_AUDIT_CLIENT;
  }
}

test('refusal usage is recorded exactly once before throwing to the existing fallback', async () => {
  const r = await runClaude({ response: { stop_reason: 'refusal', content: [{ type: 'text', text: '{"partial":true}' }] } });
  assert.match(r.error?.message || '', /refusal/);
  assert.equal(r.result, undefined, 'partial refusal must never become successful content');
  assert.equal(r.requests.length, 1);
  assert.equal(r.writes.length, 1, 'billed refusal usage must not be discarded');
  assert.equal(r.writes[0].data.inputTokens, 4500);
  assert.equal(r.writes[0].data.costUsd, 0.035);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].stopReason, 'refusal');
});

test('raw cache counters stay separate from weighted DB tokens and preserve existing prices', async () => {
  for (const [model, weighted, cost] of [['claude-opus-4-8', 4500, 0.035], ['claude-opus-5-5', 4000, 0.026]]) {
    const r = await runClaude({ args: { model, promptBlocks: [{ text: 'กติกาคงที่', cache: true }, { text: 'ข้อมูลข่าว' }] } });
    assert.equal(r.error, undefined);
    assert.equal(r.writes.length, 1);
    assert.equal(r.writes[0].data.inputTokens, weighted);
    assert.ok(Math.abs(r.writes[0].data.costUsd - cost) < 1e-12);
    assert.equal(r.events.length, 1);
    const e = r.events[0];
    assert.equal(e.inputTokens, 1000);
    assert.equal(e.cacheCreationInputTokens, 2000);
    assert.equal(e.cacheReadInputTokens, 10000);
    assert.equal(e.totalInputTokens, 13000);
    assert.equal(e.weightedInputTokens, weighted);
    assert.equal(e.requestId, 'req_cache_test');
    assert.equal(e.messageId, 'msg_cache_test');
    assert.equal(e.cacheBreakpoints, 1);
    assert.equal(e.promptMode, 'blocks');
    assert.equal(e.usageReported, true);
    assert.equal(e.model, model);
    assert.ok(Math.abs(e.costUsd - cost) < 1e-12);
    assert.deepEqual(Object.keys(r.writes[0].data).sort(), ['provider', 'model', 'inputTokens', 'outputTokens', 'costUsd', 'feature', 'userId'].sort(), 'no DB schema changes');
  }
});

test('zero-cache and absent usage are distinguishable; no prompt text or keys in telemetry', async () => {
  for (const usage of [{ input_tokens: 42, output_tokens: 5 }, undefined]) {
    const r = await runClaude({ response: { usage } });
    assert.equal(r.events.length, 1);
    const e = r.events[0];
    assert.equal(e.cacheCreationInputTokens, 0);
    assert.equal(e.cacheReadInputTokens, 0);
    assert.equal(e.cacheBreakpoints, 0);
    assert.equal(e.promptMode, 'text');
    assert.equal(e.usageReported, usage !== undefined);
    const eventText = JSON.stringify(e);
    assert.equal(eventText.includes('ต้นฉบับข่าวทดสอบ'), false);
    assert.equal(eventText.includes('test-only-no-network'), false);
  }
});

test('HTTP errors do not manufacture usage; invalid JSON and empty responses still log once', async () => {
  const failed = await runClaude({ sdkError: new Error('HTTP 503') });
  assert.match(failed.error.message, /HTTP 503/);
  assert.equal(failed.writes.length, 0);
  assert.equal(failed.events.length, 0);
  for (const content of [[], [{ type: 'text', text: 'not json' }]]) {
    const r = await runClaude({ response: { content } });
    assert.ok(r.error);
    assert.equal(r.writes.length, 1);
    assert.equal(r.events.length, 1);
  }
});

test('DB failure leaves cache telemetry available and preserves success/refusal behavior', async () => {
  for (const stop_reason of ['end_turn', 'refusal']) {
    const r = await runClaude({ dbFail: true, response: { stop_reason } });
    assert.equal(r.events.length, 1);
    assert.equal(r.writes.length, 1);
    assert.ok(r.logs.some(s => s.includes('Failed to save usage log')));
    if (stop_reason === 'refusal') assert.match(r.error.message, /refusal/);
    else { assert.equal(r.error, undefined); assert.equal(r.result.news, 'ต้นฉบับเดิม'); }
  }
});

test('writer request is byte-identical to audited main 862e72d0; normal JSON and model metadata survive', async () => {
  const r = await runClaude();
  assert.equal(r.error, undefined);
  const hash = createHash('sha256').update(JSON.stringify(r.requests[0].body)).digest('hex');
  assert.equal(hash, '396ed92a99eba22bb5b0b8e0470379637e35e25dd28557dbed518c68065591a6');
  assert.equal(r.result.news, 'ต้นฉบับเดิม');
  assert.equal(r.result._modelUsed, 'claude-opus-4-8');
  assert.equal(Object.keys(r.result).includes('_modelUsed'), false);
});

test('cache breakpoints, static prefix, JSON suffix and empty-block fallback are unchanged', async () => {
  for (const variable of ['ข่าว ก', 'ข่าว ข']) {
    const r = await runClaude({ args: {
      systemPrompt: 'ระบบเดิม', prompt: 'สำรอง',
      promptBlocks: [{ text: '  ', cache: true }, { text: 'กติกาคงที่', cache: true }, { text: variable }],
    } });
    assert.equal(r.requests[0].body.system, 'ระบบเดิม');
    assert.deepEqual(r.requests[0].body.messages[0].content, [
      { type: 'text', text: 'กติกาคงที่', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: variable + JSON_SUFFIX },
    ]);
  }
  const r = await runClaude({ args: { prompt: 'สำรอง', promptBlocks: [{ text: '', cache: true }] } });
  assert.equal(r.requests[0].body.messages[0].content, 'สำรอง' + JSON_SUFFIX);
  assert.equal(r.events[0].cacheBreakpoints, 0);
});
