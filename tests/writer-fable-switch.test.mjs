// 🔏 ข้อสอบลำดับนักเขียนข่าว: Opus 4.8 → Fable 5 → GPT-5.6 Sol อย่างละ 1 request
// รัน Router จริงด้วย fake clients แล้วรัน client policy จริงด้วย fake SDK — ไม่มี API/network
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

let pass = 0;
let fail = 0;
const t = (name, cond) => {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
};

const importTemp = async (relativePath, source) => {
  const url = new URL(relativePath, import.meta.url);
  writeFileSync(url, source);
  try {
    return await import(url.href + '?t=' + Date.now() + Math.random());
  } finally {
    rmSync(url, { force: true });
  }
};

// ── 1) Router จริง: พิสูจน์ลำดับ/จำนวน/ตัวเลือกห้าม retry ──
let routerSource = readFileSync(new URL('../src/lib/ai/aiRouter.js', import.meta.url), 'utf8');
const routerStubs = [
  ["import { callClaude, isClaudeAvailable } from './claudeClient.js';", `
const isClaudeAvailable = () => globalThis.__CLAUDE_AVAILABLE__ !== false;
const callClaude = async (args) => {
  globalThis.__CALLS__.push({ fn: 'claude', ...args });
  const plan = globalThis.__CLAUDE_PLAN__.shift() || 'ok';
  if (plan === 'hang') {
    return new Promise((_, reject) => args.signal?.addEventListener('abort', () => reject(args.signal.reason), { once: true }));
  }
  if (plan === 'throw') throw new Error('mock-claude-down');
  if (plan === 'refusal') throw new Error('Claude ปฏิเสธการเขียน (refusal)');
  return { content: 'จากโมเดล ' + args.model, _modelUsed: args.model };
};`],
  ["import { callAI } from './openai.js';", `
const callAI = async (args) => {
  globalThis.__CALLS__.push({ fn: 'gpt', ...args });
  const plan = globalThis.__GPT_PLAN__.shift() || 'ok';
  if (plan === 'throw') throw new Error('mock-gpt-down');
  return { content: 'gpt', _modelUsed: args.model };
};`],
];
for (const [from, to] of routerStubs) {
  if (!routerSource.includes(from)) throw new Error('stub ไม่เจอ: ' + from);
  routerSource = routerSource.replace(from, to);
}
routerSource = routerSource.replace(/import \{ callGemini[^\n]*\n/, 'const callGemini = async () => ({ content: "gemini" }); const isGeminiAvailable = () => false;\n');
routerSource = routerSource.replace(/import \{ MODEL_PRIMARY[^\n]*\n/, "const MODEL_PRIMARY = 'gpt-5.6-sol';\n");
const productionTimeoutsPresent = /opus:\s*90_000[\s\S]*fable:\s*75_000[\s\S]*sol:\s*90_000/.test(routerSource);
// ใช้ utility จริง แต่ย่อเวลาเฉพาะสำเนาในข้อสอบให้ timeout เกิดในไม่กี่มิลลิวินาที
routerSource = routerSource
  .replace('opus: 90_000', 'opus: 5')
  .replace('fable: 75_000', 'fable: 5')
  .replace('sol: 90_000', 'sol: 5');
const router = await importTemp('../src/lib/ai/_router-under-test.tmp.mjs', routerSource);
const callSmartAI = router.callSmartAI;

const reset = ({ claude = [], gpt = [], available = true } = {}) => {
  globalThis.__CALLS__ = [];
  globalThis.__CLAUDE_PLAN__ = [...claude];
  globalThis.__GPT_PLAN__ = [...gpt];
  globalThis.__CLAUDE_AVAILABLE__ = available;
  delete process.env.CLAUDE_WRITE_MODEL;
  delete process.env.CLAUDE_WRITE_FALLBACK_MODEL;
};

reset();
await callSmartAI('write', { prompt: 'x' });
t('1 ปกติเรียก Opus 4.8 เพียงครั้งเดียว',
  globalThis.__CALLS__.length === 1
  && globalThis.__CALLS__[0].model === 'claude-opus-4-8'
  && globalThis.__CALLS__[0].maxRetries === 0
  && globalThis.__CALLS__[0].retryWithoutEffort === false);

reset({ claude: ['throw'] });
const fableResult = await callSmartAI('write', { prompt: 'x' });
t('2 Opus ล้มจึงเรียก Fable ครั้งเดียว',
  globalThis.__CALLS__.map(c => c.model).join('|') === 'claude-opus-4-8|claude-fable-5'
  && fableResult.model === 'claude-fable-5'
  && globalThis.__CALLS__[1].maxRetries === 0
  && globalThis.__CALLS__[1].retryWithoutEffort === false);

reset({ claude: ['refusal'] });
await callSmartAI('write', { prompt: 'x' });
t('3 Claude refusal ถอย Fable โดยไม่ข้ามขั้น',
  globalThis.__CALLS__.map(c => c.model).join('|') === 'claude-opus-4-8|claude-fable-5');

reset({ claude: ['throw', 'throw'] });
const solResult = await callSmartAI('write', { prompt: 'x' });
const solCall = globalThis.__CALLS__[2];
t('4 Opus+Fable ล้มจึงเรียก Sol หนึ่งครั้งแบบห้าม Terra/SDK retry',
  globalThis.__CALLS__.map(c => `${c.fn}:${c.model}`).join('|')
    === 'claude:claude-opus-4-8|claude:claude-fable-5|gpt:gpt-5.6-sol'
  && solCall.allowModelFallback === false
  && solCall.maxRetries === 0
  && solResult.model === 'gpt-5.6-sol');

reset({ claude: ['throw', 'throw'], gpt: ['throw'] });
let exhausted = false;
try { await callSmartAI('write', { prompt: 'x' }); } catch { exhausted = true; }
t('5 ทั้งสามล้มแล้วจบทันที ไม่มี Sol/Terra รอบเพิ่ม',
  exhausted && globalThis.__CALLS__.map(c => c.model).join('|')
    === 'claude-opus-4-8|claude-fable-5|gpt-5.6-sol');

reset({ claude: ['hang', 'throw'] });
await Promise.race([
  callSmartAI('write', { prompt: 'x' }),
  new Promise((_, reject) => setTimeout(() => reject(new Error('writer-timeout-test-watchdog')), 500)),
]);
t('5.1 Opus หมดเวลาเฉพาะตัวแล้ว Fable และ Sol ยังทำหน้าที่สำรองอย่างละครั้ง',
  globalThis.__CALLS__.map(c => c.model).join('|')
    === 'claude-opus-4-8|claude-fable-5|gpt-5.6-sol'
  && productionTimeoutsPresent);

reset();
process.env.CLAUDE_WRITE_MODEL = 'claude-fable-5';
process.env.CLAUDE_WRITE_FALLBACK_MODEL = 'claude-opus-5';
await callSmartAI('write', { prompt: 'x' });
t('6 ค่า env เก่าบน Vercel ไม่ทับลำดับนักเขียนข่าว',
  globalThis.__CALLS__.length === 1 && globalThis.__CALLS__[0].model === 'claude-opus-4-8');

reset({ gpt: ['throw'] });
await callSmartAI('breakdown', { prompt: 'x' });
const breakdownGpt = globalThis.__CALLS__[0];
const breakdownClaude = globalThis.__CALLS__[1];
t('7 สาย Breakdown เดิมไม่ถูกล็อก no-fallback/no-retry ตามนักเขียน',
  breakdownGpt.fn === 'gpt'
  && breakdownGpt.allowModelFallback === undefined
  && breakdownGpt.maxRetries === undefined
  && breakdownClaude.fn === 'claude'
  && breakdownClaude.model === undefined);

reset({ claude: ['throw'] });
const ac = new AbortController();
ac.abort();
try { await callSmartAI('write', { prompt: 'x', signal: ac.signal }); } catch {}
t('8 deadline abort แล้วไม่เริ่ม Fable/Sol เพิ่ม', globalThis.__CALLS__.length === 1);

reset({ available: false });
await callSmartAI('write', { prompt: 'x' });
t('9 ไม่มี Claude key จึงเรียก Sol ครั้งเดียวโดยตรง',
  globalThis.__CALLS__.length === 1
  && globalThis.__CALLS__[0].model === 'gpt-5.6-sol'
  && globalThis.__CALLS__[0].allowModelFallback === false);

// ── 2) callAI จริง: พิสูจน์ว่า allowModelFallback=false ปิด Terra และส่ง maxRetries=0 ถึง SDK ──
let openaiSource = readFileSync(new URL('../src/lib/ai/openai.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
openaiSource = openaiSource
  .replace("import OpenAI from 'openai';", 'class OpenAI {}')
  .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};')
  .replace("import { sanitizeOutput } from './safetyFilter';", 'const sanitizeOutput = (v) => v;')
  .replace("import { MODEL_PRIMARY } from './modelConfig.js';", "const MODEL_PRIMARY = 'gpt-5.6-sol';")
  .replace(/import \{ ironRule5LengthLine, legacyLengthRule \}[^\n]*\n/, "const ironRule5LengthLine = () => ''; const legacyLengthRule = () => '';\n")
  .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n');
const clientStart = openaiSource.indexOf('export function getOpenAIClient() {');
const clientEndMarker = '\n}\n\n/**\n * เรียก AI';
const clientEnd = openaiSource.indexOf(clientEndMarker, clientStart);
if (clientStart < 0 || clientEnd < 0) throw new Error('หา getOpenAIClient block ไม่เจอ');
openaiSource = openaiSource.slice(0, clientStart)
  + 'export function getOpenAIClient() { return globalThis.__OPENAI_CLIENT__; }'
  + openaiSource.slice(clientEnd + 2);
const openaiModule = await importTemp('../src/lib/ai/_openai-under-test.tmp.mjs', openaiSource);

const setOpenAIPlan = (plan) => {
  globalThis.__OPENAI_CALLS__ = [];
  globalThis.__OPENAI_PLAN__ = [...plan];
  globalThis.__OPENAI_CLIENT__ = { chat: { completions: { create: async (body, options) => {
    globalThis.__OPENAI_CALLS__.push({ body, options });
    const step = globalThis.__OPENAI_PLAN__.shift() || 'ok';
    if (step === 'throw') throw new Error('mock-openai-down');
    return { choices: [{ message: { content: '{}' } }], usage: {} };
  } } } };
};

setOpenAIPlan(['throw']);
try {
  await openaiModule.callAI({ prompt: 'x', model: 'gpt-5.6-sol', allowModelFallback: false, maxRetries: 0 });
} catch {}
t('10 callAI exact-mode ยิง Sol request เดียวและส่ง maxRetries=0 ถึง SDK',
  globalThis.__OPENAI_CALLS__.length === 1
  && globalThis.__OPENAI_CALLS__[0].body.model === 'gpt-5.6-sol'
  && globalThis.__OPENAI_CALLS__[0].options.maxRetries === 0);

setOpenAIPlan(['throw', 'ok']);
await openaiModule.callAI({ prompt: 'x', model: 'gpt-5.6-sol' });
t('11 callAI งานอื่นยังคง fallback Sol→Terra เหมือนเดิม',
  globalThis.__OPENAI_CALLS__.map(c => c.body.model).join('|') === 'gpt-5.6-sol|gpt-5.6-terra'
  && globalThis.__OPENAI_CALLS__.every(c => c.options?.maxRetries === undefined));

// ── 3) callClaude จริง: พิสูจน์ว่า writer ปิด SDK retry และ effort compatibility retry ──
let claudeSource = readFileSync(new URL('../src/lib/ai/claudeClient.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
claudeSource = claudeSource
  .replace("import Anthropic from '@anthropic-ai/sdk';", 'class Anthropic {}')
  .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};')
  .replace("import { sanitizeOutput } from './safetyFilter';", 'const sanitizeOutput = (v) => v;')
  .replace(/import \{ ironRule5LengthLine, legacyLengthRule \}[^\n]*\n/, "const ironRule5LengthLine = () => ''; const legacyLengthRule = () => '';\n")
  .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n');
const claudeClientStart = claudeSource.indexOf('function getClaudeClient() {');
const claudeClientEndMarker = '\n}\n\n/**\n * เรียก Claude';
const claudeClientEnd = claudeSource.indexOf(claudeClientEndMarker, claudeClientStart);
if (claudeClientStart < 0 || claudeClientEnd < 0) throw new Error('หา getClaudeClient block ไม่เจอ');
claudeSource = claudeSource.slice(0, claudeClientStart)
  + 'function getClaudeClient() { return globalThis.__CLAUDE_CLIENT__; }'
  + claudeSource.slice(claudeClientEnd + 2);
const claudeModule = await importTemp('../src/lib/ai/_claude-under-test.tmp.mjs', claudeSource);
globalThis.__CLAUDE_CALLS__ = [];
globalThis.__CLAUDE_CLIENT__ = { messages: { create: async (body, options) => {
  globalThis.__CLAUDE_CALLS__.push({ body, options });
  throw new Error('output_config unsupported');
} } };
try {
  await claudeModule.callClaude({
    prompt: 'x', model: 'claude-opus-4-8', maxRetries: 0, retryWithoutEffort: false,
  });
} catch {}
t('12 callClaude writer-mode ยิง request เดียว ส่ง maxRetries=0 และไม่ retry effort',
  globalThis.__CLAUDE_CALLS__.length === 1
  && globalThis.__CLAUDE_CALLS__[0].options.maxRetries === 0);

// ── 4) Service ต้องไม่เรียก GPT รอบสองหลัง Router จบครบสามโมเดล ──
const textService = readFileSync(new URL('../src/lib/services/summarizeServiceText.js', import.meta.url), 'utf8');
const legacyService = readFileSync(new URL('../src/lib/services/summarizeService.js', import.meta.url), 'utf8');
t('13 text service ไม่มี write_fallback/mix_fallback ซ้ำหลัง SmartAI',
  !textService.includes("'write_fallback'")
  && !textService.includes("'mix_fallback'")
  && (textService.match(/270000, '(?:write|mix)_inner'/g) || []).length === 2);
t('14 legacy mix ไม่มี catch ที่ยิง callAI ซ้ำหลัง callSmartAI write',
  !/callSmartAI\('write',[\s\S]{0,500}catch[\s\S]{0,250}callAI/.test(legacyService));

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
