// 🔏 ข้อสอบข้อ 7 (25 ต.ค. 69 · ผลทดสอบท่อทีละขั้น): callAI ต้องส่งพารามิเตอร์ตระกูลใหม่ให้ gpt-6 ด้วย
//   บั๊กเดิม: isNewModel ดูแค่ gpt-5/o1/o3 → gpt-6.1-sol ได้ temperature + max_tokens → OpenAI ตอบ 400
//   → callAI ตกไป gpt-5.6-terra เงียบๆ (ตั้งสวิตช์ CARD_PICKER_MODEL=gpt-6.1-sol แล้วจริงๆ ได้ terra)
//   ใช้ openai.js จริง + OpenAI SDK จริง แทนเฉพาะ fetch (แบบเดียวกับ tests/breakdown-single-fallback-mc05)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';

const srcUrl = (rel) => new URL(rel, import.meta.url);
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};

let s = readFileSync(srcUrl('../src/lib/ai/openai.js'), 'utf8');
s = mustReplace(s, "import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};', 'stub usageLogger');
s = mustReplace(s, "import { sanitizeOutput } from './safetyFilter';", "import { sanitizeOutput } from './safetyFilter.js';", 'safetyFilter .js');
s = mustReplace(s, 'const apiKey = process.env.OPENAI_API_KEY;', "const apiKey = 'offline-test-no-network';", 'คีย์ปลอม');
s = mustReplace(s, 'openaiClient = new OpenAI({ apiKey });',
  "openaiClient = new OpenAI({ apiKey, baseURL: 'http://127.0.0.1:9/v1', fetch: (url, init) => globalThis.__GPT6_FETCH__(url, init) });",
  'SDK จริง + fetch ปลอม');
const { callAI } = await importPatchedModule(s, srcUrl('../src/lib/ai/openai.js'), 'openai-gpt6');

/** เซิร์ฟเวอร์ปลอม: เหมือน OpenAI จริง — รุ่นตระกูลใหม่ที่ได้ max_tokens/temperature≠1 ตอบ 400 */
function serve(newFamily) {
  const hits = [];
  globalThis.__GPT6_FETCH__ = async (url, init) => {
    const body = JSON.parse(init.body);
    hits.push(body);
    const strict = newFamily.some((p) => body.model.startsWith(p));
    if (strict && ('max_tokens' in body || ('temperature' in body && body.temperature !== 1))) {
      return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens'", type: 'invalid_request_error' } }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      id: 'chatcmpl-gpt6', object: 'chat.completion', created: 0, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return hits;
}

test('A1 gpt-6.1-sol / gpt-6-astra: max_completion_tokens + ไม่ส่ง temperature/max_tokens + ไม่ตกไป terra', async () => {
  for (const model of ['gpt-6.1-sol', 'gpt-6-astra']) {
    const hits = serve(['gpt-5', 'gpt-6']);
    const res = await callAI({ prompt: 'ตอบ JSON', model, temperature: 0.3, maxTokens: 1234, maxRetries: 0 });
    assert.deepEqual(hits.map((h) => h.model), [model], `${model}: ต้องยิงรุ่นนี้นัดเดียว ไม่ถอยไป terra`);
    assert.equal(hits[0].max_completion_tokens, 1234);
    assert.ok(!('max_tokens' in hits[0]) && !('temperature' in hits[0]), `${model}: ห้ามส่ง max_tokens/temperature`);
    assert.equal(res._modelUsed ?? model, model);
  }
});

test('A2 ของเดิมไม่เปลี่ยน: gpt-5.6-sol ตระกูลใหม่ · gpt-4o ยังได้ temperature + max_tokens', async () => {
  let hits = serve(['gpt-5', 'gpt-6']);
  await callAI({ prompt: 'ตอบ JSON', model: 'gpt-5.6-sol', temperature: 0.3, maxTokens: 900, maxRetries: 0 });
  assert.deepEqual(hits.map((h) => [h.model, h.max_completion_tokens, 'temperature' in h]), [['gpt-5.6-sol', 900, false]]);
  hits = serve(['gpt-5', 'gpt-6']);
  await callAI({ prompt: 'ตอบ JSON', model: 'gpt-4o', temperature: 0.3, maxTokens: 900, maxRetries: 0 });
  assert.deepEqual(hits.map((h) => [h.model, h.max_tokens, h.temperature]), [['gpt-4o', 900, 0.3]]);
});
