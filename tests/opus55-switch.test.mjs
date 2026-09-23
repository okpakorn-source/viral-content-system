// 🔏 ข้อสอบสวิตช์ opus-4-8 → opus-5-5 ทุกขั้นระบบข่าว (★ 23 ก.ย. 69 เจ้าของสั่ง)
// ไม่มี API/network/DB — อ่านซอร์สจริง + import สำเนาซอร์สจริงผ่าน data: URL (stub เฉพาะ SDK/DB/log)
//
// วิธีรัน:  node --test tests/opus55-switch.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่ากัดจริง — ตั้งโหมดไหนเทสต้องแดง · แก้เฉพาะสำเนาในหน่วยความจำ ไม่แตะไฟล์จริง):
//   OPUS55_TEST_MUTATION=router-primary | router-extract | router-extract-log | client-default | s5-pin
//                       | news-filter | client-sampling-regex | client-thinking-regex
//                       | price-modelconfig | price-usagelogger | cost-rates | usage-label
//                       | cost-rates-set1   (★ 23 ก.ย. 69 ชุด 2: ย้อนแถว costRates กลับสูตร ×0.8 ของชุด 1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const NEW = 'claude-opus-5-5';
const OLD = 'claude-opus-4-8';

const ROUTER = '../src/lib/ai/aiRouter.js';
const CLIENT = '../src/lib/ai/claudeClient.js';
const S5 = '../src/lib/s5PinnedAi.js';
const FILTER = '../src/lib/services/newsFilterService.js';
const MODEL_CONFIG = '../src/lib/ai/modelConfig.js';
const USAGE_LOGGER = '../src/lib/ai/usageLogger.js';
const COST_RATES = '../src/lib/costRates.js';
const USAGE_ROUTE = '../src/app/api/usage/route.js';

// [ไฟล์, สตริงในซอร์สปัจจุบัน, สตริงหลังย้อน] — ย้อนทีละจุด
const MUTATIONS = {
  'router-primary': [ROUTER, "const _primary = 'claude-opus-5-5';", "const _primary = 'claude-opus-4-8';"],
  'router-extract': [ROUTER, "model: process.env.EXTRACT_CLAUDE_MODEL || 'claude-opus-5-5',", "model: process.env.EXTRACT_CLAUDE_MODEL || 'claude-opus-4-8',"],
  'router-extract-log': [ROUTER, "EXTRACT_CLAUDE_MODEL || 'claude-opus-5-5'}", "EXTRACT_CLAUDE_MODEL || 'claude-opus-4-8'}"],
  'client-default': [CLIENT, "process.env.CLAUDE_WRITE_MODEL || 'claude-opus-5-5';", "process.env.CLAUDE_WRITE_MODEL || 'claude-opus-4-8';"],
  's5-pin': [S5, "(process.env.ANALYSIS_PIN_MODEL || 'claude-opus-5-5')", "(process.env.ANALYSIS_PIN_MODEL || 'claude-opus-4-8')"],
  'news-filter': [FILTER, "process.env.NEWS_FILTER_MODEL || 'claude-opus-5-5';", "process.env.NEWS_FILTER_MODEL || 'claude-opus-4-8';"],
  'client-sampling-regex': [CLIENT, '/^claude-(opus-4-[78]|fable|sonnet-5|opus-5)/', '/^claude-(opus-4-[78]|fable|sonnet-5)/'],
  'client-thinking-regex': [CLIENT, 'const _thinkingOn = /^claude-(opus-5|fable)/', 'const _thinkingOn = /^claude-(fable)/'],
  'price-modelconfig': [MODEL_CONFIG, "  'claude-opus-5-5': { input: 4.0, output: 20.0 },\n", ''],
  'price-usagelogger': [USAGE_LOGGER, "  'claude-opus-5-5': { input: 4.0, output: 20.0 },\n", ''],
  // ★ 23 ก.ย. 69 (เจ้าของสั่ง · ชุด 2): สตริงต้นทางตามแถวใหม่ราคาจริง 4/20
  //   (ของเดิมชุด 1: แถวสูตร RATE_CLAUDE_OPUS_IN||15 ×4/5 · RATE_CLAUDE_OPUS_OUT||75 ×4/5)
  'cost-rates': [COST_RATES, "  'claude-opus-5-5': { in: num(process.env.RATE_CLAUDE_OPUS55_IN, 4), out: num(process.env.RATE_CLAUDE_OPUS55_OUT, 20) },\n", ''],
  'cost-rates-set1': [COST_RATES, '{ in: num(process.env.RATE_CLAUDE_OPUS55_IN, 4), out: num(process.env.RATE_CLAUDE_OPUS55_OUT, 20) }', '{ in: num(process.env.RATE_CLAUDE_OPUS_IN, 15) * 4 / 5, out: num(process.env.RATE_CLAUDE_OPUS_OUT, 75) * 4 / 5 }'],
  'usage-label': [USAGE_ROUTE, 'เขียน opus-5-5 ×2 มุม+เกลา', 'เขียน opus-4-8 ×2 มุม+เกลา'],
};
const MUTATION = process.env.OPUS55_TEST_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const read = (rel) => {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const m = MUTATIONS[MUTATION];
  if (!m || m[0] !== rel) return src;
  assert.ok(src.includes(m[1]), `mutation ${MUTATION}: หาสตริงต้นทางใน ${rel} ไม่เจอ`);
  return src.replace(m[1], m[2]);
};
// ตัดบรรทัดคอมเมนต์ทิ้ง — คอมเมนต์ประวัติ "(ของเดิม: ... 'claude-opus-4-8')" ต้องไม่ทำให้ข้อสอบหลงผิดทั้งสองทาง
const codeOnly = (src) => src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

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

const onlyDefault = (code, re, label) => {
  const hits = [...code.matchAll(re)].map((m) => m[1]);
  assert.equal(hits.length, 1, `${label}: ต้องเจอจุดนี้ในโค้ดจริงพอดี 1 จุด (เจอ ${hits.length})`);
  assert.equal(hits[0], NEW, `${label}: default ต้องเป็น ${NEW} (เจอ ${hits[0]})`);
};

// ═══ (a) ค่า default ทุกจุดของระบบข่าวเป็น opus-5-5 และไม่มี opus-4-8 เหลือในโค้ดจริงของ 4 ไฟล์ ═══
test('(a) default ทั้ง 6 จุดใน 4 ไฟล์ = claude-opus-5-5 · ไม่มี claude-opus-4-8 เหลือในโค้ด (นอกคอมเมนต์ประวัติ)', () => {
  const router = codeOnly(read(ROUTER));
  onlyDefault(router, /const _primary = '([^']+)';/g, 'aiRouter นักเขียนหลัก (_primary)');
  onlyDefault(router, /model: process\.env\.EXTRACT_CLAUDE_MODEL \|\| '([^']+)',/g, 'aiRouter ขั้นสกัด (claude-extract)');
  onlyDefault(router, /extract primary = \$\{process\.env\.EXTRACT_CLAUDE_MODEL \|\| '([^']+)'\}/g, 'aiRouter log ประกาศสวิตช์สกัด');

  const client = codeOnly(read(CLIENT));
  onlyDefault(client, /const DEFAULT_WRITE_MODEL = process\.env\.CLAUDE_WRITE_MODEL \|\| '([^']+)';/g, 'claudeClient DEFAULT_WRITE_MODEL');

  const s5 = codeOnly(read(S5));
  onlyDefault(s5, /process\.env\.ANALYSIS_PIN_MODEL \|\| '([^']+)'/g, 's5PinnedAi ANALYSIS_PIN_MODEL');

  const filter = codeOnly(read(FILTER));
  onlyDefault(filter, /const NEWS_FILTER_MODEL = process\.env\.NEWS_FILTER_MODEL \|\| '([^']+)';/g, 'newsFilterService NEWS_FILTER_MODEL');

  for (const [label, code] of [['aiRouter', router], ['claudeClient', client], ['s5PinnedAi', s5], ['newsFilterService', filter]]) {
    assert.equal(code.includes(`'${OLD}'`), false, `${label}: ห้ามมี '${OLD}' เหลือในโค้ดจริง`);
  }
});

// ═══ (b) ตารางราคา ═══
test('(b1) modelConfig.MODEL_COSTS: claude-opus-5-5 = 4.0/20.0 และคงแถว claude-opus-4-8 = 5.0/25.0 ไว้', async () => {
  const src = read(MODEL_CONFIG);
  assert.doesNotMatch(src, /^import\s/m, 'modelConfig ต้องไม่มี import (โหลดผ่าน data: URL)');
  const { MODEL_COSTS } = await importData(src, 'opus55-model-config');
  assert.deepEqual(MODEL_COSTS[NEW], { input: 4.0, output: 20.0 });
  assert.deepEqual(MODEL_COSTS[OLD], { input: 5.0, output: 25.0 }, 'แถวประวัติ/ปุ่มถอยกลับต้องยังอยู่');
});

test('(b2) usageLogger: มีแถว claude-opus-5-5 ของตัวเอง + /cost คิด 4/20 จริง (ไม่หลุดไปราคา opus-5 5/25)', async () => {
  const src = read(USAGE_LOGGER);
  const rows = codeOnly(src).match(/^\s*'claude-opus-5-5': \{ input: 4\.0, output: 20\.0 \},$/gm) || [];
  assert.equal(rows.length, 1, 'usageLogger PRICING ต้องมีแถว claude-opus-5-5 = 4.0/20.0 ของตัวเองพอดี 1 แถว');

  const { MODEL_COSTS } = await importData(read(MODEL_CONFIG), 'opus55-model-config-b2');
  const stubbed = src
    .replace("import { prisma } from '../db.js';",
      'const prisma = { apiUsageLog: { async create(args) { globalThis.__OPUS55_USAGE__ = args; return args; } } };')
    .replace("import { MODEL_COSTS } from './modelConfig.js';", `const MODEL_COSTS = ${JSON.stringify(MODEL_COSTS)};`);
  assert.doesNotMatch(stubbed, /^import\s/m, 'ต้อง stub import ครบ (data: URL resolve relative import ไม่ได้)');
  const { logApiUsage } = await importData(stubbed, 'opus55-usage-logger');
  const costOf = async (model, inputTokens = 1_000_000, outputTokens = 1_000_000) => {
    globalThis.__OPUS55_USAGE__ = null;
    const origLog = console.log; console.log = () => {};
    try { await logApiUsage({ provider: 'anthropic', model, inputTokens, outputTokens }); }
    finally { console.log = origLog; }
    assert.ok(globalThis.__OPUS55_USAGE__, `${model}: ต้องถึง prisma.apiUsageLog.create`);
    return globalThis.__OPUS55_USAGE__.data.costUsd;
  };
  assert.equal(await costOf(NEW), 24, 'opus-5-5: 1M×$4 + 1M×$20 = $24');
  assert.equal(await costOf(`${NEW}-20260923`), 24, 'ชื่อมี suffix ต้องจับแถว opus-5-5 (ยาวกว่า) ก่อน opus-5');
  assert.equal(await costOf('claude-opus-5'), 30, 'ราคา opus-5 เดิมต้องไม่เปลี่ยน');
  assert.equal(await costOf(OLD), 30, 'ราคา opus-4-8 เดิมต้องไม่เปลี่ยน');
});

// ★ 23 ก.ย. 69 (เจ้าของสั่ง · ชุด 2): แถว opus-5-5 เลิกสูตร ×0.8 → ราคาจริง 4/20 + env ของตัวเอง RATE_CLAUDE_OPUS55_IN/OUT
//   (ของเดิมชุด 1: ข้อนี้คาด 12/60 เมื่อไม่ตั้ง env · llmCost 72 · ตั้ง RATE_CLAUDE_OPUS_IN/OUT=5/25 แล้ว 5.5 ได้ 4/20 ตาม)
test('(b3) costRates (ตารางประมาณการระบบปก/คลิป): opus-5-5 = ราคาจริง 4/20 · ปรับด้วย env ของตัวเอง · ไม่ผูก env แถว 4.8', async () => {
  const src = read(COST_RATES);
  assert.doesNotMatch(src, /^import\s/m);
  const clean = { RATE_CLAUDE_OPUS_IN: undefined, RATE_CLAUDE_OPUS_OUT: undefined, RATE_CLAUDE_OPUS55_IN: undefined, RATE_CLAUDE_OPUS55_OUT: undefined };
  const noEnv = await withEnv(clean, () => importData(src, 'opus55-cost-rates-default'));
  assert.deepEqual(noEnv.LLM_RATES[NEW], { in: 4, out: 20 }, 'ไม่ตั้ง env: ราคาจริง $4/$20 ต่อ 1M token');
  assert.equal(noEnv.llmCost('anthropic', NEW, 1e6, 1e6), 24, 'ต้องไม่ตกไป PROVIDER_DEFAULT 15/75 (= 90) และไม่ใช่สูตรชุด 1 (= 72)');
  assert.equal(noEnv.llmCost('anthropic', OLD, 1e6, 1e6), 90, 'แถว opus-4-8 เดิมคงเดิม');
  const env48 = await withEnv({ ...clean, RATE_CLAUDE_OPUS_IN: '5', RATE_CLAUDE_OPUS_OUT: '25' },
    () => importData(src, 'opus55-cost-rates-env48'));
  assert.deepEqual(env48.LLM_RATES[NEW], { in: 4, out: 20 }, 'env ของแถว 4.8 ต้องไม่ลากราคา 5.5 ตามอีกต่อไป');
  assert.deepEqual(env48.LLM_RATES[OLD], { in: 5, out: 25 }, 'env ของแถว 4.8 ยังคุมแถว 4.8 ตามเดิม');
  const env55 = await withEnv({ ...clean, RATE_CLAUDE_OPUS55_IN: '4.4', RATE_CLAUDE_OPUS55_OUT: '22' },
    () => importData(src, 'opus55-cost-rates-env55'));
  assert.deepEqual(env55.LLM_RATES[NEW], { in: 4.4, out: 22 }, 'env ของรุ่นนี้เอง RATE_CLAUDE_OPUS55_IN/OUT ต้องมีผล');
});

test('(b4) usage route: ป้าย note เปลี่ยนชื่อรุ่นเป็น opus-5-5 อย่างเดียว ตัวเลข usd คงเดิม', () => {
  const code = codeOnly(read(USAGE_ROUTE));
  assert.ok(code.includes("note: 'สกัด+แตกประเด็น terra+เขียน opus-5-5 ×2 มุม+เกลา"), 'ป้ายต้องเป็น opus-5-5');
  assert.equal(code.includes('เขียน opus-4-8 ×2 มุม+เกลา'), false, 'ป้ายในโค้ดห้ามเหลือ opus-4-8');
  assert.ok(code.includes("news: { usd: 0.28, label: 'ข่าว 1 งาน (2 เวอร์ชัน)'"), 'ตัวเลข usd ห้ามแก้');
});

// ═══ (c) opus-5-5 ถูกจัดเป็น "ห้าม sampling" + "คิดเสมอ" — ทั้ง regex ในซอร์สและพฤติกรรม callClaude จริง ═══
const regexFromSource = (code, re, label) => {
  const m = code.match(re);
  assert.ok(m, `${label}: หา regex ในซอร์สไม่เจอ`);
  const lit = m[1];
  const cut = lit.lastIndexOf('/');
  return new RegExp(lit.slice(1, cut), lit.slice(cut + 1));
};

test('(c1) regex ในซอร์ส claudeClient ครอบ claude-opus-5-5 ทั้ง modelRejectsSampling และ _thinkingOn', () => {
  const code = codeOnly(read(CLIENT));
  const sampling = regexFromSource(code, /function modelRejectsSampling\(model\) \{\n\s*return (\/.+\/)\.test\(model\);/, 'modelRejectsSampling');
  const thinking = regexFromSource(code, /const _thinkingOn = (\/.+\/)\.test\(model\);/, '_thinkingOn');
  assert.equal(sampling.test(NEW), true, 'opus-5-5 ต้องถูกตัด temperature/top_p/top_k (API 400)');
  assert.equal(thinking.test(NEW), true, 'opus-5-5 คิดเสมอ ต้องได้เพดาน ≥16000');
  assert.equal(sampling.test('gpt-5.6-sol'), false, 'regex ต้องไม่กว้างจนจับรุ่นอื่น');
});

const transformClaude = (source) => {
  let out = source
    .replace("import Anthropic from '@anthropic-ai/sdk';", 'class Anthropic {}')
    .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};')
    .replace("import { sanitizeOutput } from './safetyFilter';", 'const sanitizeOutput = (value) => value;')
    .replace(/import \{ ironRule5LengthLine, legacyLengthRule \}[^\n]*\n/u, "const ironRule5LengthLine = () => ''; const legacyLengthRule = () => '';\n")
    .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/u, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n');
  const start = out.indexOf('function getClaudeClient() {');
  const end = out.indexOf('\n}\n\n/**\n * เรียก Claude', start);
  assert.ok(start >= 0 && end >= 0, 'หา getClaudeClient block ไม่เจอ');
  out = out.slice(0, start) + 'function getClaudeClient() { return globalThis.__OPUS55_CLAUDE_CLIENT__; }' + out.slice(end + 2);
  assert.doesNotMatch(out, /^import\s/m, 'ต้อง stub import ครบ (data: URL resolve relative import ไม่ได้)');
  return out;
};

const runClaude = async (envModel, args) => {
  const bodies = [];
  globalThis.__OPUS55_CLAUDE_CLIENT__ = { messages: { create: async (body) => {
    bodies.push(body);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: {} };
  } } };
  const origLog = console.log; console.log = () => {};
  try {
    return await withEnv({ CLAUDE_WRITE_MODEL: envModel, CLAUDE_WRITE_EFFORT: undefined, LOG_FULL_PROMPT: undefined }, async () => {
      const mod = await importData(transformClaude(read(CLIENT)), 'opus55-claude-client');
      const result = await mod.callClaude(args);
      return { body: bodies[0], result, count: bodies.length };
    });
  } finally { console.log = origLog; }
};

test('(c2) callClaude ไม่ระบุ model → claude-opus-5-5 · ไม่ส่ง temperature/top_p/top_k/thinking · effort medium · max_tokens ≥16000', async () => {
  const { body, result, count } = await runClaude(undefined, { prompt: 'x', maxTokens: 4000, temperature: 0.7 });
  assert.equal(count, 1);
  assert.equal(body.model, NEW, 'DEFAULT_WRITE_MODEL ต้องเป็น opus-5-5');
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) {
    assert.equal(k in body, false, `ห้ามส่ง ${k} ให้ opus-5-5 (API ตอบ 400)`);
  }
  assert.deepEqual(body.output_config, { effort: 'medium' }, 'ต้องส่ง effort ชัดเจน (ค่าเริ่มต้น API ของ 5.5 = medium อยู่แล้ว แต่ไม่พึ่ง)');
  assert.equal(body.max_tokens, 16000, 'ช่วงคิดกิน max_tokens ร่วม — เพดาน 4000 ต้องถูกยกเป็น 16000');
  assert.equal(result.ok, true);
  assert.equal(result._modelUsed, NEW, 'provenance ต้องติดชื่อโมเดลจริง');
});

test('(c3) ปุ่มถอยกลับ CLAUDE_WRITE_MODEL=claude-opus-4-8 ยังได้พฤติกรรม 4.8 เดิม (ไม่ยกเพดาน · ไม่ส่ง temperature)', async () => {
  const { body } = await runClaude(OLD, { prompt: 'x', maxTokens: 4000, temperature: 0.7 });
  assert.equal(body.model, OLD);
  assert.equal('temperature' in body, false);
  assert.equal(body.max_tokens, 4000, '4.8 ไม่ส่ง thinking = ไม่คิด → เพดานเดิม');
});
