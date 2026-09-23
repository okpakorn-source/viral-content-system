// 🔏 ข้อสอบชุด 2 ของสวิตช์ opus-5-5 (★ 23 ก.ย. 69 เจ้าของสั่ง)
//   (B)  claudeClient: opus-5-5 ห้าม effort=low → ยกเป็น medium (ครอบทั้ง effort ต่อการเรียก + env CLAUDE_WRITE_EFFORT) · รุ่นอื่นไม่โดน
//   (C)  aiClient.callAnthropic: ตระกูลคิดเอง /^claude-(opus-5|fable)/ → max_tokens ≥16000 + output_config.effort
//        (ANALYSIS_EFFORT || medium · opus-5-5 ห้าม low) · opus-4-8/รุ่นอื่น payload เดิมทุกไบต์
//   (D1) claudeClient: ตัวคูณแคชอ่านใน /cost = 0.05 เฉพาะ opus-5-5 ($0.20 ÷ $4) · รุ่นอื่นคง 0.1
// ไม่มี API/network/DB — import สำเนาซอร์สจริงผ่าน data: URL (stub เฉพาะ SDK/log/retry/import สัมพัทธ์) + fetch/SDK ปลอม
//
// วิธีรัน:  node --test tests/opus55-effort-cost.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่ากัดจริง — แก้เฉพาะสำเนาในหน่วยความจำ ไม่แตะไฟล์จริง · ตั้งโหมดไหนเทสต้องแดง):
//   OPUS55_EC_MUTATION=client-no-clamp | client-clamp-all-models | client-cache-mul | client-cache-mul-all
//                    | aiclient-no-raise | aiclient-no-effort | aiclient-no-clamp | aiclient-all-models
// ชุดนี้ไม่ได้ตรวจ: คุณภาพ/เวลาตอบจริงของ opus-5-5 (ต้องยิง API จริง) · เส้น OpenAI ของ aiClient (ไม่ได้แก้)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CLIENT = '../src/lib/ai/claudeClient.js';
const AI_CLIENT = '../src/lib/aiClient.js';
const NEW = 'claude-opus-5-5';
const OLD = 'claude-opus-4-8';
const CLAMP_WARN = '[Claude] ⚠️ opus-5-5 ห้าม effort=low (เจ้าของสั่ง 23 ก.ย. 69) → ยกเป็น medium';
const AI_CLAMP_WARN = '[aiClient] ⚠️ opus-5-5 ห้าม effort=low (เจ้าของสั่ง 23 ก.ย. 69) → ยกเป็น medium';

// [ไฟล์, สตริงในซอร์สปัจจุบัน, สตริงหลังกลายพันธุ์]
const MUTATIONS = {
  'client-no-clamp': [CLIENT, "if (/^claude-opus-5-5/.test(model) && writeEffort === 'low') {", 'if (false) {'],
  'client-clamp-all-models': [CLIENT, "if (/^claude-opus-5-5/.test(model) && writeEffort === 'low') {", "if (writeEffort === 'low') {"],
  'client-cache-mul': [CLIENT, 'const _cacheReadMul = /^claude-opus-5-5/.test(model) ? 0.05 : 0.1;', 'const _cacheReadMul = 0.1;'],
  'client-cache-mul-all': [CLIENT, 'const _cacheReadMul = /^claude-opus-5-5/.test(model) ? 0.05 : 0.1;', 'const _cacheReadMul = 0.05;'],
  'aiclient-no-raise': [AI_CLIENT, 'payload.max_tokens = Math.max(maxTokens, 16000);', ''],
  'aiclient-no-effort': [AI_CLIENT, 'payload.output_config = { effort };', ''],
  'aiclient-no-clamp': [AI_CLIENT, "if (/^claude-opus-5-5/.test(model) && effort === 'low') {", 'if (false) {'],
  'aiclient-all-models': [AI_CLIENT, 'if (/^claude-(opus-5|fable)/.test(model)) {', 'if (/^claude-/.test(model)) {'],
};
const MUTATION = process.env.OPUS55_EC_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const read = (rel) => {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const m = MUTATIONS[MUTATION];
  if (!m || m[0] !== rel) return src;
  assert.ok(src.includes(m[1]), `mutation ${MUTATION}: หาสตริงต้นทางใน ${rel} ไม่เจอ`);
  return src.replace(m[1], m[2]);
};
const importData = (source, tag) => {
  const encoded = Buffer.from(`${source}\n//# sourceURL=${tag}.mjs`, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${tag}-${Date.now()}-${Math.random()}`);
};
const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k];
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};
// เก็บ console.warn ไว้ตรวจ + ปิด console.log ที่รก
const captureConsole = async (fn) => {
  const warns = [];
  const origWarn = console.warn; const origLog = console.log;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  console.log = () => {};
  try { return { value: await fn(), warns }; } finally { console.warn = origWarn; console.log = origLog; }
};

// ═══ claudeClient: สำเนาซอร์สจริง + SDK ปลอม + logApiUsage ปลอม (จับค่า /cost) ═══
const transformClaude = (source) => {
  let out = source
    .replace("import Anthropic from '@anthropic-ai/sdk';", 'class Anthropic {}')
    .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = (args) => { globalThis.__EC_USAGE__.push(args); };')
    .replace("import { sanitizeOutput } from './safetyFilter';", 'const sanitizeOutput = (value) => value;')
    .replace(/import \{ ironRule5LengthLine, legacyLengthRule \}[^\n]*\n/u, "const ironRule5LengthLine = () => ''; const legacyLengthRule = () => '';\n")
    .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/u, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n');
  const start = out.indexOf('function getClaudeClient() {');
  const end = out.indexOf('\n}\n\n/**\n * เรียก Claude', start);
  assert.ok(start >= 0 && end >= 0, 'หา getClaudeClient block ไม่เจอ');
  out = out.slice(0, start) + 'function getClaudeClient() { return globalThis.__EC_CLAUDE_CLIENT__; }' + out.slice(end + 2);
  assert.doesNotMatch(out, /^import\s/m, 'ต้อง stub import ครบ (data: URL resolve relative import ไม่ได้)');
  return out;
};

const runClaude = async ({ env = {}, usage = {}, ...args }) => {
  const bodies = [];
  globalThis.__EC_USAGE__ = [];
  globalThis.__EC_CLAUDE_CLIENT__ = { messages: { create: async (body) => {
    bodies.push(body);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage };
  } } };
  const { value, warns } = await captureConsole(() => withEnv(
    { CLAUDE_WRITE_MODEL: undefined, CLAUDE_WRITE_EFFORT: undefined, LOG_FULL_PROMPT: undefined, ...env },
    async () => {
      const mod = await importData(transformClaude(read(CLIENT)), 'opus55-ec-claude-client');
      await mod.callClaude({ prompt: 'x', retryWithoutEffort: false, ...args });
      return { body: bodies[0], count: bodies.length, usage: globalThis.__EC_USAGE__ };
    },
  ));
  return { ...value, warns };
};

// ═══ (B) effort ขั้นต่ำของ opus-5-5 ใน claudeClient ═══
test('(e1) opus-5-5 + effort ต่อการเรียก low → ส่ง medium จริง + เตือนใน log', async () => {
  const { body, count, warns } = await runClaude({ model: NEW, effort: 'low' });
  assert.equal(count, 1, 'ต้องยิง request เดียว');
  assert.deepEqual(body.output_config, { effort: 'medium' }, 'opus-5-5 ห้าม low → ต้องยกเป็น medium (ถอด clamp = แดง)');
  assert.ok(warns.includes(CLAMP_WARN), 'ต้องมี console.warn ตามสเปก');
});

test('(e2) opus-5-5 + effort ต่อการเรียก high → high ไม่ถูกแตะ', async () => {
  const { body, warns } = await runClaude({ model: NEW, effort: 'high' });
  assert.deepEqual(body.output_config, { effort: 'high' });
  assert.equal(warns.includes(CLAMP_WARN), false, 'ไม่ใช่ low ต้องไม่เตือน');
});

test('(e3) opus-5-5 + env CLAUDE_WRITE_EFFORT=low (ไม่ส่ง effort ต่อการเรียก) → medium', async () => {
  const { body, warns } = await runClaude({ model: NEW, env: { CLAUDE_WRITE_EFFORT: 'low' } });
  assert.deepEqual(body.output_config, { effort: 'medium' }, 'ค่า low จาก env ต้องถูกยกเหมือนกัน');
  assert.ok(warns.includes(CLAMP_WARN));
});

test('(e4) opus-4-8 (ปุ่มถอยกลับ) + low → ยังเป็น low ทั้งจาก per-call และ env · ไม่เตือน', async () => {
  const perCall = await runClaude({ model: OLD, effort: 'low' });
  assert.deepEqual(perCall.body.output_config, { effort: 'low' }, 'รุ่นอื่นห้ามโดน clamp (clamp ทุกรุ่น = แดง)');
  assert.equal(perCall.warns.includes(CLAMP_WARN), false);
  const fromEnv = await runClaude({ model: OLD, env: { CLAUDE_WRITE_EFFORT: 'low' } });
  assert.deepEqual(fromEnv.body.output_config, { effort: 'low' });
});

// ═══ (D1) ตัวคูณแคชอ่านที่ส่งให้ /cost ═══
test('(d1) inputTokens ที่ส่ง logApiUsage: opus-5-5 คิดแคชอ่าน 0.05× · opus-4-8/opus-5 คง 0.1× · แคชเขียน 1.25× ทุกรุ่น', async () => {
  const usage = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000 };
  const costInput = async (model) => {
    const r = await runClaude({ model, usage });
    assert.equal(r.usage.length, 1, `${model}: ต้องเรียก logApiUsage 1 ครั้ง`);
    assert.equal(r.usage[0].model, model);
    assert.equal(r.usage[0].outputTokens, 500);
    return r.usage[0].inputTokens;
  };
  assert.equal(await costInput(NEW), 4000, 'opus-5-5: 1000 + 2000×1.25 + 10000×0.05 = 4000 (ย้อนเป็น 0.1 = 4500 → แดง)');
  assert.equal(await costInput(OLD), 4500, 'opus-4-8: 1000 + 2000×1.25 + 10000×0.1 = 4500 (เดิมทุกไบต์)');
  assert.equal(await costInput('claude-opus-5'), 4500, 'opus-5 ห้ามโดน 0.05 (prefix ต้องเจาะ opus-5-5 เท่านั้น)');
});

// ═══ aiClient: สำเนาซอร์สจริง + fetch ปลอม (stub retry/costStore/usageLogger/honestyDna) ═══
const transformAiClient = (source) => {
  const out = source
    .replace(/^import \{ withRetry \} from '\.\/retry\.js';[^\n]*\n/m, 'const withRetry = async (fn) => fn();\n')
    .replace(/^import \{ recordLLM \} from '\.\/costStore\.js';[^\n]*\n/m, 'const recordLLM = async () => {};\n')
    .replace(/^import \{ logApiUsage \} from '\.\/ai\/usageLogger\.js';[^\n]*\n/m, 'const logApiUsage = async () => {};\n')
    .replace(/^import \{ AI_HONESTY_DNA, honestyDnaOn \} from '\.\/aiHonestyDna\.js';[^\n]*\n/m, "const AI_HONESTY_DNA = ''; const honestyDnaOn = () => false;\n");
  assert.doesNotMatch(out, /^import\s/m, 'ต้อง stub import ครบ (data: URL resolve relative import ไม่ได้)');
  return out;
};

const runBrain = async ({ model, maxTokens, env = {} }) => {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, raw: opts.body, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{}' }], model, usage: {} }) };
  };
  try {
    const { value, warns } = await captureConsole(() => withEnv(
      { ANTHROPIC_API_KEY: 'test-key', ANALYSIS_EFFORT: undefined, ANALYSIS_SEND_TEMPERATURE: undefined, ...env },
      async () => {
        const { callBrain } = await importData(transformAiClient(read(AI_CLIENT)), 'opus55-ec-ai-client');
        await callBrain({ system: 's', user: 'u', maxTokens, forceProvider: 'anthropic', forceModel: model });
        return calls;
      },
    ));
    assert.equal(value.length, 1, `${model}: ต้องยิง fetch ครั้งเดียว`);
    assert.equal(value[0].url, 'https://api.anthropic.com/v1/messages');
    return { ...value[0], warns };
  } finally {
    if (origFetch) globalThis.fetch = origFetch; else delete globalThis.fetch;
  }
};

test('(a1) aiClient opus-5-5 (/api/analyze 4000 · /api/keywords 3500) → max_tokens 16000 + effort medium · ไม่ส่ง temperature', async () => {
  for (const maxTokens of [4000, 3500]) {
    const { body } = await runBrain({ model: NEW, maxTokens });
    assert.equal(body.max_tokens, 16000, `maxTokens ${maxTokens} ต้องถูกยกเป็น 16000 (ช่วงคิดกินเพดานร่วม)`);
    assert.deepEqual(body.output_config, { effort: 'medium' }, 'ต้องส่ง effort ชัดเจน (ไม่ตั้ง ANALYSIS_EFFORT = medium)');
    assert.equal('temperature' in body, false, 'opus-5-5 ไม่รับ temperature');
  }
  const big = await runBrain({ model: NEW, maxTokens: 20000 });
  assert.equal(big.body.max_tokens, 20000, 'เพดานที่สูงกว่า 16000 อยู่แล้วต้องคงเดิม (Math.max)');
});

test('(a2) aiClient opus-5-5 + ANALYSIS_EFFORT=low → medium + เตือน · ANALYSIS_EFFORT=high → high', async () => {
  const low = await runBrain({ model: NEW, maxTokens: 4000, env: { ANALYSIS_EFFORT: 'low' } });
  assert.deepEqual(low.body.output_config, { effort: 'medium' }, 'opus-5-5 ห้าม low (ถอด clamp = แดง)');
  assert.ok(low.warns.includes(AI_CLAMP_WARN), 'ต้องมี console.warn');
  const high = await runBrain({ model: NEW, maxTokens: 4000, env: { ANALYSIS_EFFORT: 'high' } });
  assert.deepEqual(high.body.output_config, { effort: 'high' });
  assert.equal(high.warns.includes(AI_CLAMP_WARN), false);
});

test('(a3) aiClient opus-4-8 → payload เดิมทุกไบต์ (ไม่ยกเพดาน · ไม่มี output_config) แม้ตั้ง ANALYSIS_EFFORT', async () => {
  const expected = JSON.stringify({ model: OLD, max_tokens: 4000, system: 's', messages: [{ role: 'user', content: 'u' }] });
  const plain = await runBrain({ model: OLD, maxTokens: 4000 });
  assert.equal(plain.raw, expected, 'opus-4-8 ต้องได้ JSON เดิมทุกไบต์ (ครอบทุกรุ่น = แดง)');
  const withEffortEnv = await runBrain({ model: OLD, maxTokens: 4000, env: { ANALYSIS_EFFORT: 'high' } });
  assert.equal(withEffortEnv.raw, expected, 'ANALYSIS_EFFORT ต้องไม่มีผลกับรุ่นนอกตระกูลคิดเอง');
});

test('(a4) aiClient ตระกูลเดียวกันรุ่นอื่น (fable-5) ได้เพดาน 16000 + effort high (ค่าเริ่มต้น API เดิม) แต่ clamp low เจาะเฉพาะ opus-5-5', async () => {
  const fable = await runBrain({ model: 'claude-fable-5', maxTokens: 4000 });
  assert.equal(fable.body.max_tokens, 16000);
  assert.deepEqual(fable.body.output_config, { effort: 'high' }, 'รุ่นที่ไม่ใช่ 5-5 ต้องได้ high = ค่าเริ่มต้น API เดิม (พฤติกรรมไม่เปลี่ยน)');
  const fableLow = await runBrain({ model: 'claude-fable-5', maxTokens: 4000, env: { ANALYSIS_EFFORT: 'low' } });
  assert.deepEqual(fableLow.body.output_config, { effort: 'low' }, 'clamp ต้องไม่ลามไปรุ่นอื่น');
  assert.equal(fableLow.warns.includes(AI_CLAMP_WARN), false);
});

// ═══ (F) ขอบ regex ของ clamp — opus-5 (ไม่ใช่ 5-5) ต้องไม่โดน (ผู้ตรวจรอบสุดท้าย 23 ก.ย. 69: ขยาย regex เป็น /^claude-opus-5/ แล้วเทสต้องแดง) ═══
test('(e5) claudeClient opus-5 + low → คง low ไม่เตือน (clamp เจาะเฉพาะ opus-5-5)', async () => {
  const { body, warns } = await runClaude({ model: 'claude-opus-5', effort: 'low' });
  assert.deepEqual(body.output_config, { effort: 'low' }, 'opus-5 ต้องไม่ถูก clamp (regex ลามเป็น /^claude-opus-5/ = แดง)');
  assert.equal(warns.includes(CLAMP_WARN), false);
});
test('(a5) aiClient opus-5 + ANALYSIS_EFFORT=low → คง low ไม่เตือน · ไม่ตั้ง env → high (ค่าเริ่มต้น API เดิม)', async () => {
  const low = await runBrain({ model: 'claude-opus-5', maxTokens: 4000, env: { ANALYSIS_EFFORT: 'low' } });
  assert.deepEqual(low.body.output_config, { effort: 'low' }, 'opus-5 ต้องไม่ถูก clamp (regex ลาม = แดง)');
  assert.equal(low.warns.includes(AI_CLAMP_WARN), false);
  const plain = await runBrain({ model: 'claude-opus-5', maxTokens: 4000 });
  assert.deepEqual(plain.body.output_config, { effort: 'high' }, 'opus-5 ไม่ตั้ง env ต้องได้ high (= ค่าเริ่มต้น API ก่อนชุดนี้)');
  assert.equal(plain.body.max_tokens, 16000);
});
