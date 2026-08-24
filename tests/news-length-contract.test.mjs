import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPublishableAnalysisResult,
  countPublishableThaiWords,
  countFinalVersionSources,
  enforceTextNewsPublicationFloor,
  resolveFinalUsedPreset,
} from '../src/lib/utils/publishablePostText.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const POLICY_SOURCE = read('../src/lib/ai/legacyLengthRules.js');
const TEXT_SOURCE = read('../src/lib/services/summarizeServiceText.js');
const URL_SOURCE = read('../src/lib/services/summarizeService.js');
const ROUTER_SOURCE = read('../src/lib/ai/aiRouter.js');
const OPENAI_SOURCE = read('../src/lib/ai/openai.js');
const CLAUDE_SOURCE = read('../src/lib/ai/claudeClient.js');
const AUTO_FLOW_SOURCE = read('../src/lib/services/autoFlowServiceText.js');
const PUBLISHABLE_SOURCE = read('../src/lib/utils/publishablePostText.js');
const SHARED_SYSTEM_BASELINE_554D028 = [
  '- ความยาว: ประเมินจาก "เนื้อข่าวดิบที่ได้รับ" ก่อนว่ามีสาระจริงมากแค่ไหน แล้วเขียนให้พอดีกับสาระที่มีจริง',
  '  · อย่างน้อย 180 คำ ไม่มีเพดานสูงสุด — เนื้อดิบน้อยให้จบแถวช่วงล่างของกรอบ เนื้อดิบแน่นค่อยไล่ขึ้นช่วงบน',
  '  · ⚠️ พอดีแล้วต้องพอ — ห้ามหาคำมาเติม ห้ามเล่าซ้ำ ห้ามขยายความลอยๆ เพียงเพื่อให้ถึงตัวเลข',
  '  · ⚠️ และห้ามตัดข้อเท็จจริงสำคัญทิ้งเพื่อให้สั้น — ครบก่อน แล้วค่อยกระชับ',
  '- แบ่งเป็น 3 ย่อหน้า คั่นย่อหน้าด้วยบรรทัดว่าง (ไม่มีโควตาจำนวนประโยคต่อย่อหน้า — ย่อหน้าสั้นยาวไม่เท่ากันได้ตามเนื้อที่มี)',
].join('\n');

async function importData(source, tag) {
  const encoded = Buffer.from(`${source}\n//# sourceURL=${tag}.mjs`, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${tag}-${Date.now()}-${Math.random()}`);
}

function assertNoUpperCap(text, floor, label) {
  assert.match(text, new RegExp(`อย่างน้อย\\s+${floor}\\s+คำ`, 'u'), `${label} ต้องประกาศพื้น ${floor} คำ`);
  assert.match(text, /ไม่มีเพดานสูงสุด/u, `${label} ต้องประกาศว่าไม่มีเพดาน`);
  assert.doesNotMatch(text, new RegExp(`${floor}\\s*[-–]\\s*\\d+`, 'u'), `${label} ห้ามแอบคืนกรอบบน`);
  assert.doesNotMatch(text, /สูงสุดไม่เกิน\s*\d+\s*คำ/u, `${label} ห้ามมีเพดานตัวเลข`);
}

async function loadCurrentPolicy(source = POLICY_SOURCE, tag = 'policy') {
  const oldLegacy = process.env.LEGACY_LENGTH_RULES;
  const oldByContent = process.env.LENGTH_BY_CONTENT;
  delete process.env.LEGACY_LENGTH_RULES;
  delete process.env.LENGTH_BY_CONTENT;
  try {
    return await importData(source, tag);
  } finally {
    if (oldLegacy === undefined) delete process.env.LEGACY_LENGTH_RULES;
    else process.env.LEGACY_LENGTH_RULES = oldLegacy;
    if (oldByContent === undefined) delete process.env.LENGTH_BY_CONTENT;
    else process.env.LENGTH_BY_CONTENT = oldByContent;
  }
}

async function assertPolicyContract(source = POLICY_SOURCE, tag = 'policy-contract') {
  const policy = await loadCurrentPolicy(source, tag);
  assert.equal(Object.isFrozen(policy.NEW_LENGTH_CFG), true, 'ก้อน TEXT ต้องถูก freeze');
  assert.deepEqual({ ...policy.NEW_LENGTH_CFG }, {
    min: 146,
    max: null,
    paragraphs: '3',
    paraDesc: '3 ย่อหน้า',
    sentences: '3-5',
  });

  const sharedOpenAI = policy.ironRule5LengthLine('openai');
  const sharedClaude = policy.ironRule5LengthLine('claude');
  assert.equal(sharedOpenAI, SHARED_SYSTEM_BASELINE_554D028, 'shared OpenAI ต้อง byte-parity กับ 554d028');
  assert.equal(sharedClaude, SHARED_SYSTEM_BASELINE_554D028, 'shared Claude ต้อง byte-parity กับ 554d028');
  assertNoUpperCap(sharedOpenAI, 180, 'shared OpenAI system');
  assertNoUpperCap(sharedClaude, 180, 'shared Claude system');
  assert.doesNotMatch(sharedOpenAI, /อย่างน้อย\s+146\s+คำ/u);
  assert.doesNotMatch(sharedClaude, /อย่างน้อย\s+146\s+คำ/u);

  assertNoUpperCap(policy.ironRule5LengthLine('openai', true), 146, 'TEXT OpenAI writer system');
  assertNoUpperCap(policy.ironRule5LengthLine('claude', true), 146, 'TEXT Claude writer system');
  assertNoUpperCap(policy.lengthLineAnalyze(policy.NEW_LENGTH_CFG), 146, 'TEXT analyze prompt');
  assertNoUpperCap(policy.lengthLineMix(policy.NEW_LENGTH_CFG), 146, 'TEXT mix prompt');
  assert.match(policy.analyzeJsonContentHint(policy.NEW_LENGTH_CFG), /อย่างน้อย 146 คำ/u);
  assert.equal(policy.sentenceQuotaLine(policy.NEW_LENGTH_CFG), '', 'โหมดปกติห้ามคืนโควตาประโยค');
  assert.doesNotMatch(
    policy.finalReminderLengthClause(policy.NEW_LENGTH_CFG),
    /\b(?:146|180|269|300|350)\b/u,
    'คำย้ำท้ายต้องไม่สร้างตัวเลขคู่แข่งอีกชุด',
  );
}

function extractWriteOptionBlocks(source) {
  return [...source.matchAll(/callSmartAI\('write',\s*\{([\s\S]{0,500}?)\}\)/gu)].map((match) => match[1]);
}

function assertTextServiceWiring(source = TEXT_SOURCE) {
  assert.equal(
    (source.match(/lenCfg\s*=\s*\{\s*\.\.\.NEW_LENGTH_CFG\s*\};/gu) || []).length,
    1,
    'ทุกปุ่มความยาวใน TEXT ต้องรวมที่ NEW_LENGTH_CFG จุดเดียว',
  );
  assert.match(source, /lengthLineAnalyze\(lenCfg\)/u, 'analyze ต้องใส่กฎความยาวใน prompt จริง');
  assert.match(source, /lengthLineMix\(lenCfg\)/u, 'mix ต้องใส่กฎความยาวใน prompt จริง');
  const blocks = extractWriteOptionBlocks(source);
  assert.equal(blocks.length, 2, 'TEXT ต้องมี writer analyze+mix สองจุดเท่านั้น');
  for (const [index, block] of blocks.entries()) {
    assert.match(block, /textNewsLengthPolicy:\s*true/u, `writer จุด ${index + 1} ต้องเปิดสิทธิ์ 146`);
  }
}

function assertFinalPublicationGateWiring(source = AUTO_FLOW_SOURCE) {
  const afterFact = source.indexOf('finalVersions = factOutcome.passingVersions;');
  const gate = source.indexOf('const lengthOutcome = enforceTextNewsPublicationFloor(finalVersions,');
  const finalSnapshot = source.indexOf('const analysisResult = buildPublishableAnalysisResult({');
  assert.ok(afterFact >= 0 && gate > afterFact, 'ด่านคำต้องอยู่หลัง factual editor/final audit');
  assert.ok(finalSnapshot > gate, 'ด่านคำต้องอยู่ก่อน final snapshot/save/response');
  const gateBlock = source.slice(gate, finalSnapshot);
  assert.match(gateBlock, /minimumWords:\s*NEW_LENGTH_CFG\.min/u);
  assert.match(gateBlock, /finalVersions = lengthOutcome\.passingVersions/u);
  assert.doesNotMatch(gateBlock, /callSmartAI|callAI|performSummarize|repairRawFactContents/u,
    'ด่านสุดท้ายห้ามเพิ่ม AI call หรือ writer loop');
  assert.match(source, /&& !isLegacyLengthOn\(\)/u, 'สวิตช์ legacy ต้อง bypass ด่านใหม่ครบ');
  assert.match(source, /lengthGate: textLengthGateSummary/u, 'ผลสุดท้ายต้องเก็บหลักฐานจำนวนคำ');
}

const TANGMO_FINAL_V1 = `เงินก้อนแรกจากการทำงานของน้องแตงโม ปุณณดา ถูกนำไปมอบให้คุณยายและคุณย่า คนละ 10,000 บาท นั่นคือสิ่งที่ลูกสาวของแจ๊ส ชวนชื่น และแจง ปุณณาสา ทำเมื่อมีรายได้ก้อนแรกจากการทำงาน ภาพนั้นจึงยิ่งอบอุ่นขึ้นไปอีก

ผู้ใหญ่สองคนในครอบครัวได้รับเงินก้อนแรกจากการทำงานของเธอ และถ้าย้อนมาดูเส้นทางที่ผ่านมา จะเห็นว่าเธอเดินมาไกลไม่น้อย น้องแตงโมสอบเทียบจบ ม.6 ตั้งแต่อายุ 16 ปี ตอนนี้ทำงานเป็นนางแบบดาวรุ่ง มีทั้งงานถ่ายแบบและงานอีเวนต์แฟชั่นต่างๆ ที่น่าทึ่งกว่านั้น นอกจากเวทีแฟชั่น เธอยังเป็นนักกีฬาไอซ์สเก็ตทีมชาติไทย และนักแข่งรถอีกด้วย หลายบทบาทในคนเดียว ทั้งงานแฟชั่น ไอซ์สเก็ต และสนามแข่งรถ

หลายสนาม หลายเวที ส่วนเงินก้อนแรกจากการทำงานถูกนำไปมอบให้คุณยายและคุณย่า คนละ 10,000 บาท เท่ากัน`;

const TANGMO_FINAL_V2 = `น้องแตงโม ปุณณดา สอบเทียบจบ ม.6 ในวัย 16 ปี ส่วนเงินก้อนแรกจากการทำงาน เธอนำไปมอบให้คุณยายและคุณย่า คนละ 10,000 บาท

น้องแตงโมคือลูกสาวของแจ๊ส ชวนชื่น และแจง ปุณณาสา วันนี้เธอทำงานเป็นนางแบบดาวรุ่ง มีทั้งงานถ่ายแบบและงานอีเวนต์แฟชั่นต่างๆ แต่เรื่องน่าชื่นชมไม่ได้อยู่แค่ตรงนั้น เพราะนอกลานถ่ายแบบ เธอยังเป็นนักกีฬาไอซ์สเก็ตทีมชาติไทย และเป็นนักแข่งรถอีกด้วย เด็กคนหนึ่งมีหลายบทบาทพร้อมกัน ทั้งงานแฟชั่น ไอซ์สเก็ต และสนามแข่งรถ

เงินก้อนแรกจากการทำงานนั้นเดินทางไปถึงมือคุณยายและคุณย่า คนละ 10,000 บาท`;

const makeWords = count => Array.from({ length: count }, (_, index) => `คำ${index + 1}`).join(' ');

async function assertFinalFloorHelperContract(source = PUBLISHABLE_SOURCE, tag = 'final-floor-helper') {
  const helper = await importData(source, tag);
  const noSpaces = { content: 'น้องแตงโมมอบเงินก้อนแรกให้คุณยายและคุณย่า' };
  assert.ok(helper.countPublishableThaiWords(noSpaces) > 1, 'ต้องตัดคำไทยที่ไม่มีช่องว่างด้วย Segmenter');
  const v145 = { content: makeWords(145) };
  const v146 = { content: makeWords(146) };
  const v1000 = { content: makeWords(1000) };
  const outcome = helper.enforceTextNewsPublicationFloor([v145, v146, v1000], { minimumWords: 146 });
  assert.deepEqual(outcome.checks.map(item => [item.wordCount, item.passes]), [
    [145, false], [146, true], [1000, true],
  ]);
}

function replaceNth(source, needle, replacement, nth) {
  let found = 0;
  return source.replaceAll(needle, (match) => {
    found += 1;
    return found === nth ? replacement : match;
  });
}

function transformRouter(source) {
  let transformed = source;
  const replacements = [
    ["import { callAI } from './openai.js';", `
const callAI = async (args) => {
  globalThis.__LENGTH_ROUTER_CALLS__.push({ provider: 'openai', ...args });
  const step = globalThis.__LENGTH_OPENAI_PLAN__.shift() || 'ok';
  if (step === 'throw') throw new Error('openai-test-failure');
  return { ok: true, _modelUsed: args.model };
};`],
    ["import { callClaude, isClaudeAvailable } from './claudeClient.js';", `
const isClaudeAvailable = () => globalThis.__LENGTH_CLAUDE_AVAILABLE__ !== false;
const callClaude = async (args) => {
  globalThis.__LENGTH_ROUTER_CALLS__.push({ provider: 'claude', ...args });
  const step = globalThis.__LENGTH_CLAUDE_PLAN__.shift() || 'ok';
  if (step === 'throw') throw new Error('claude-test-failure');
  return { ok: true, _modelUsed: args.model };
};`],
    ["import { callGemini, isGeminiAvailable } from './geminiClient.js';", "const callGemini = async () => ({ ok: true }); const isGeminiAvailable = () => false;"],
    ["import { MODEL_PRIMARY } from './modelConfig.js';", "const MODEL_PRIMARY = 'gpt-5.6-sol';"],
    ["import { rethrowPipelineDeadline } from '../utils/pipelineDeadline.js';", 'const rethrowPipelineDeadline = () => {};'],
    ["import { withTimeoutSignal } from '../utils/withTimeout.js';", 'const withTimeoutSignal = (factory, _ms, _step, parent) => factory(parent || new AbortController().signal);'],
  ];
  for (const [from, to] of replacements) {
    assert.ok(transformed.includes(from), `router test หา import ไม่เจอ: ${from}`);
    transformed = transformed.replace(from, to);
  }
  return transformed;
}

async function assertRouterBehavior(source = ROUTER_SOURCE, tag = 'router') {
  const router = await importData(transformRouter(source), tag);

  globalThis.__LENGTH_ROUTER_CALLS__ = [];
  globalThis.__LENGTH_CLAUDE_PLAN__ = ['throw', 'throw'];
  globalThis.__LENGTH_OPENAI_PLAN__ = ['ok'];
  globalThis.__LENGTH_CLAUDE_AVAILABLE__ = true;
  await router.callSmartAI('write', { prompt: 'TEXT', textNewsLengthPolicy: true });
  assert.deepEqual(
    globalThis.__LENGTH_ROUTER_CALLS__.map((call) => [call.model, call.textNewsLengthPolicy]),
    [
      ['claude-opus-4-8', true],
      ['claude-fable-5', true],
      ['gpt-5.6-sol', true],
    ],
    'Opus→Fable→Sol ต้องรับสิทธิ์ 146 ครบทุกไม้',
  );

  globalThis.__LENGTH_ROUTER_CALLS__ = [];
  globalThis.__LENGTH_CLAUDE_PLAN__ = ['ok'];
  globalThis.__LENGTH_OPENAI_PLAN__ = [];
  await router.callSmartAI('write', { prompt: 'URL/default writer' });
  assert.equal(globalThis.__LENGTH_ROUTER_CALLS__[0]?.textNewsLengthPolicy, false, 'writer ที่ไม่ opt-in ต้องคงสัญญาเดิม');

  globalThis.__LENGTH_ROUTER_CALLS__ = [];
  globalThis.__LENGTH_CLAUDE_PLAN__ = [];
  globalThis.__LENGTH_OPENAI_PLAN__ = ['ok'];
  await router.callSmartAI('breakdown', { prompt: 'breakdown', textNewsLengthPolicy: true });
  assert.equal(globalThis.__LENGTH_ROUTER_CALLS__[0]?.textNewsLengthPolicy, false, 'งาน non-writer ต้องตัด true ที่ส่งมาผิดทิ้ง');
}

function replaceClientFactory(source, signature, endMarker, replacement) {
  const start = source.indexOf(signature);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end >= 0, `หา client factory ไม่เจอ: ${signature}`);
  return source.slice(0, start) + replacement + source.slice(end + 2);
}

function transformOpenAI(source) {
  let transformed = source
    .replace("import OpenAI from 'openai';", 'class OpenAI {}')
    .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};')
    .replace("import { sanitizeOutput } from './safetyFilter';", 'const sanitizeOutput = (value) => value;')
    .replace("import { MODEL_PRIMARY } from './modelConfig.js';", "const MODEL_PRIMARY = 'gpt-5.6-sol';")
    .replace(/import \{ ironRule5LengthLine, legacyLengthRule \}[^\n]*\n/u, "const ironRule5LengthLine = (_side, enabled) => enabled ? 'POLICY_146' : 'POLICY_180'; const legacyLengthRule = () => '';\n")
    .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/u, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n');
  transformed = replaceClientFactory(
    transformed,
    'export function getOpenAIClient() {',
    '\n}\n\n/**\n * เรียก AI',
    'export function getOpenAIClient() { return globalThis.__LENGTH_OPENAI_CLIENT__; }',
  );
  return transformed;
}

async function assertOpenAIClientBehavior(source = OPENAI_SOURCE, tag = 'openai-client') {
  const calls = [];
  globalThis.__LENGTH_OPENAI_CLIENT__ = { chat: { completions: { create: async (body) => {
    calls.push(body);
    return { choices: [{ message: { content: '{}' } }], usage: {} };
  } } } };
  const client = await importData(transformOpenAI(source), tag);
  await client.callAI({ prompt: 'default', allowModelFallback: false });
  await client.callAI({ prompt: 'TEXT', allowModelFallback: false, textNewsLengthPolicy: true });
  assert.match(calls[0].messages[0].content, /POLICY_180/u, 'OpenAI default system ต้องคง 180');
  assert.doesNotMatch(calls[0].messages[0].content, /POLICY_146/u);
  assert.match(calls[1].messages[0].content, /POLICY_146/u, 'OpenAI TEXT writer ต้องได้ 146');
}

function transformClaude(source) {
  let transformed = source
    .replace("import Anthropic from '@anthropic-ai/sdk';", 'class Anthropic {}')
    .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};')
    .replace("import { sanitizeOutput } from './safetyFilter';", 'const sanitizeOutput = (value) => value;')
    .replace(/import \{ ironRule5LengthLine, legacyLengthRule \}[^\n]*\n/u, "const ironRule5LengthLine = (_side, enabled) => enabled ? 'POLICY_146' : 'POLICY_180'; const legacyLengthRule = () => '';\n")
    .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/u, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n');
  transformed = replaceClientFactory(
    transformed,
    'function getClaudeClient() {',
    '\n}\n\n/**\n * เรียก Claude',
    'function getClaudeClient() { return globalThis.__LENGTH_CLAUDE_CLIENT__; }',
  );
  return transformed;
}

async function assertClaudeClientBehavior(source = CLAUDE_SOURCE, tag = 'claude-client') {
  const calls = [];
  globalThis.__LENGTH_CLAUDE_CLIENT__ = { messages: { create: async (body) => {
    calls.push(body);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: {} };
  } } };
  const client = await importData(transformClaude(source), tag);
  await client.callClaude({ prompt: 'default', model: 'claude-opus-4-8', retryWithoutEffort: false });
  await client.callClaude({ prompt: 'TEXT', model: 'claude-opus-4-8', retryWithoutEffort: false, textNewsLengthPolicy: true });
  assert.match(calls[0].system, /POLICY_180/u, 'Claude default system ต้องคง 180');
  assert.doesNotMatch(calls[0].system, /POLICY_146/u);
  assert.match(calls[1].system, /POLICY_146/u, 'Claude TEXT writer ต้องได้ 146');
}

test('สัญญาความยาว: TEXT writer ขั้นต่ำ 146 คำ ไม่มีเพดาน; shared system คง 180 เดิม', async () => {
  await assertPolicyContract();
  assertTextServiceWiring();
  assert.doesNotMatch(URL_SOURCE, /textNewsLengthPolicy/u, 'ท่อ URL ต้องไม่ opt-in กฎ 146');
});

test('Router ส่ง 146 เฉพาะ TEXT writer ครบ Opus→Fable→Sol และกัน non-writer', async () => {
  await assertRouterBehavior();
});

test('OpenAI และ Claude สร้าง system prompt ตามสิทธิ์จริง ไม่ใช่แค่มี option ใน source', async () => {
  await assertOpenAIClientBehavior();
  await assertClaudeClientBehavior();
});

test('mutation: พื้นเก่า/เพดาน/จุดใส่ prompt/สิทธิ์ TEXT หาย ต้องถูกจับ', async () => {
  const oldFloor = POLICY_SOURCE.replace(/min:\s*146,\s*max:\s*null/u, 'min: 180, max: null');
  assert.notEqual(oldFloor, POLICY_SOURCE);
  await assert.rejects(assertPolicyContract(oldFloor, 'old-floor'));

  const capped = POLICY_SOURCE.replace(/min:\s*146,\s*max:\s*null/u, 'min: 146, max: 269');
  assert.notEqual(capped, POLICY_SOURCE);
  await assert.rejects(assertPolicyContract(capped, 'capped'));

  const missingTextOptIn = TEXT_SOURCE.replace('          textNewsLengthPolicy: true,\n', '');
  assert.notEqual(missingTextOptIn, TEXT_SOURCE);
  assert.throws(() => assertTextServiceWiring(missingTextOptIn));

  const missingAnalyzeLine = TEXT_SOURCE.replace('lengthLineAnalyze(lenCfg)', "'ไม่มี length contract'");
  assert.notEqual(missingAnalyzeLine, TEXT_SOURCE);
  assert.throws(() => assertTextServiceWiring(missingAnalyzeLine));

  const missingMixLine = TEXT_SOURCE.replace('lengthLineMix(lenCfg)', "'ไม่มี length contract'");
  assert.notEqual(missingMixLine, TEXT_SOURCE);
  assert.throws(() => assertTextServiceWiring(missingMixLine));
});

test('mutation: Router ทำสิทธิ์รั่วหรือทำ fallback ใดหล่น ต้องถูกจับ', async () => {
  const leakedNonWriter = ROUTER_SOURCE.replace(
    "const useTextNewsLengthPolicy = task === 'write' && textNewsLengthPolicy === true;",
    'const useTextNewsLengthPolicy = textNewsLengthPolicy === true;',
  );
  assert.notEqual(leakedNonWriter, ROUTER_SOURCE);
  await assert.rejects(assertRouterBehavior(leakedNonWriter, 'router-leak'));

  const missingOpus = replaceNth(
    ROUTER_SOURCE,
    'maxRetries: 0, retryWithoutEffort: false, textNewsLengthPolicy,',
    'maxRetries: 0, retryWithoutEffort: false,',
    1,
  );
  assert.notEqual(missingOpus, ROUTER_SOURCE);
  await assert.rejects(assertRouterBehavior(missingOpus, 'router-opus-missing'));

  const missingFable = replaceNth(
    ROUTER_SOURCE,
    'maxRetries: 0, retryWithoutEffort: false, textNewsLengthPolicy,',
    'maxRetries: 0, retryWithoutEffort: false,',
    2,
  );
  assert.notEqual(missingFable, ROUTER_SOURCE);
  await assert.rejects(assertRouterBehavior(missingFable, 'router-fable-missing'));

  const missingSol = ROUTER_SOURCE.replace(
    'allowModelFallback: false, maxRetries: 0, textNewsLengthPolicy,',
    'allowModelFallback: false, maxRetries: 0,',
  );
  assert.notEqual(missingSol, ROUTER_SOURCE);
  await assert.rejects(assertRouterBehavior(missingSol, 'router-sol-missing'));
});

test('mutation: client ไม่ส่งสิทธิ์เข้า system prompt ต้องถูกจับ', async () => {
  const openaiDropped = OPENAI_SOURCE.replace(
    "ironRule5LengthLine('openai', textNewsLengthPolicy)",
    "ironRule5LengthLine('openai')",
  );
  assert.notEqual(openaiDropped, OPENAI_SOURCE);
  await assert.rejects(assertOpenAIClientBehavior(openaiDropped, 'openai-dropped'));

  const claudeDropped = CLAUDE_SOURCE.replace(
    "ironRule5LengthLine('claude', textNewsLengthPolicy)",
    "ironRule5LengthLine('claude')",
  );
  assert.notEqual(claudeDropped, CLAUDE_SOURCE);
  await assert.rejects(assertClaudeClientBehavior(claudeDropped, 'claude-dropped'));
});

test('โหมดถอย LEGACY_LENGTH_RULES=1 ยังชนะสิทธิ์ 146 และคืนกฎเดิม', async () => {
  const oldLegacy = process.env.LEGACY_LENGTH_RULES;
  process.env.LEGACY_LENGTH_RULES = '1';
  try {
    const policy = await importData(POLICY_SOURCE, 'legacy-policy');
    const legacyCfg = { min: 165, max: 350, paraDesc: '3 ย่อหน้า', sentences: '3-5' };
    assert.equal(policy.lengthLineAnalyze(legacyCfg), 'ความยาวบังคับ 165-350 คำ');
    assert.equal(policy.lengthLineMix(legacyCfg), 'ต้องยาวอย่างน้อย 165 คำ ถึง 350 คำ');
    assert.match(policy.sentenceQuotaLine(legacyCfg), /3-5 ประโยค/u);
    assert.equal(
      policy.ironRule5LengthLine('claude', true),
      policy.LEGACY_LENGTH_TEXT.ironRule5LengthClaude,
      'legacy Claude ต้องคืน snapshot เดิมทุกไบต์แม้ caller ขอ 146',
    );
    assert.equal(
      policy.ironRule5LengthLine('openai', true),
      policy.LEGACY_LENGTH_TEXT.ironRule5LengthOpenAI,
      'legacy OpenAI ต้องคืน snapshot เดิมทุกไบต์แม้ caller ขอ 146',
    );
  } finally {
    if (oldLegacy === undefined) delete process.env.LEGACY_LENGTH_RULES;
    else process.env.LEGACY_LENGTH_RULES = oldLegacy;
  }
});

test('ผล canary จริงหลัง Sol editor: 179 คำผ่าน, 131 คำถูกกัก โดยไม่แก้ object/content', () => {
  const v1 = { content: TANGMO_FINAL_V1, promptId: 'card-a', usedModel: 'claude-opus-4-8' };
  const v2 = { content: TANGMO_FINAL_V2, promptId: 'card-b', usedModel: 'claude-opus-4-8' };
  assert.equal(countPublishableThaiWords(v1), 179);
  assert.equal(countPublishableThaiWords(v2), 131);
  const outcome = enforceTextNewsPublicationFloor([v1, v2], { minimumWords: 146 });
  assert.equal(outcome.status, 'partial');
  assert.deepEqual(outcome.checks, [
    { version: 1, wordCount: 179, passes: true },
    { version: 2, wordCount: 131, passes: false },
  ]);
  assert.deepEqual(outcome.passingVersions, [v1]);
  assert.deepEqual(outcome.quarantinedVersions, [v2]);
  assert.strictEqual(outcome.passingVersions[0], v1, 'ฉบับผ่านต้องเป็น object เดิม รักษา card/model provenance');
  assert.equal(v1.content, TANGMO_FINAL_V1, 'ด่านห้ามเขียน/เติม content');
  assert.equal(v2.content, TANGMO_FINAL_V2, 'ฉบับถูกกักก็ห้ามแก้ content');

  const presetA = { promptId: 'card-a', promptName: 'การ์ด A' };
  const presetB = { promptId: 'card-b', promptName: 'การ์ด B' };
  assert.deepEqual(countFinalVersionSources(outcome.passingVersions), { classic: 1, enhanced: 0 });
  assert.strictEqual(
    resolveFinalUsedPreset(outcome.passingVersions, new Map([['card-a', presetA], ['card-b', presetB]]), presetB),
    presetA,
    'การ์ดสุดท้ายต้องมาจากฉบับที่รอด ไม่ใช่ฉบับถูกกัก',
  );
  const analysis = buildPublishableAnalysisResult({
    primaryResult: { summary: 'ห้ามพาร่างเก่าติดมา' },
    usedPreset: presetA,
    usedModel: 'claude-opus-4-8',
    usedModels: ['claude-opus-4-8'],
    versions: outcome.passingVersions,
    researchItems: [],
    qualityWarnings: ['กัก V2'],
    lengthGate: {
      status: outcome.status,
      minimumWords: outcome.minimumWords,
      checks: outcome.checks,
    },
  });
  assert.equal(analysis.summary, TANGMO_FINAL_V1);
  assert.deepEqual(analysis.versions, [v1]);
  assert.equal(analysis.lengthGate.minimumWords, 146);
  assert.doesNotMatch(JSON.stringify(analysis), new RegExp(TANGMO_FINAL_V2.slice(0, 40), 'u'));
});

test('ขอบเขต final floor: 145 กัก, 146 ผ่าน, ข่าวยาว 1,000 คำผ่านโดยไม่มีเพดาน', () => {
  const v145 = { content: makeWords(145) };
  const v146 = { content: makeWords(146) };
  const v1000 = { content: makeWords(1000) };
  const outcome = enforceTextNewsPublicationFloor([v145, v146, v1000], { minimumWords: 146 });
  assert.deepEqual(outcome.checks.map(item => [item.wordCount, item.passes]), [
    [145, false], [146, true], [1000, true],
  ]);
  assert.deepEqual(outcome.passingVersions, [v146, v1000]);
});

test('ตัวนับใช้ Thai word segmentation และ fail-closed เมื่อ runtime ไม่มี Segmenter', () => {
  const noSpaces = { content: 'น้องแตงโมมอบเงินก้อนแรกให้คุณยายและคุณย่า' };
  assert.equal(noSpaces.content.trim().split(/\s+/u).length, 1, 'fixture ต้องพิสูจน์ว่า whitespace split ใช้ไม่ได้');
  assert.ok(countPublishableThaiWords(noSpaces) > 1, 'Intl.Segmenter ต้องแยกคำไทยที่ไม่มีช่องว่าง');
  assert.throws(
    () => countPublishableThaiWords(noSpaces, { segmenterCtor: null }),
    error => error?.errorType === 'TEXT_NEWS_WORD_COUNTER_UNAVAILABLE'
      && error?.failedStep === 'auto_text_length_gate',
  );
});

test('zero-pass คืน typed review failure และไม่เผยร่างเป็นผลสำเร็จ', () => {
  const shortVersions = [{ content: makeWords(20) }, { content: makeWords(145) }];
  assert.throws(
    () => enforceTextNewsPublicationFloor(shortVersions, { minimumWords: 146 }),
    error => error?.errorType === 'TEXT_NEWS_LENGTH_REVIEW_REQUIRED'
      && error?.failedStep === 'auto_text_length_gate'
      && error?.lengthGate?.publishable === false
      && error?.lengthGate?.status === 'length_review'
      && JSON.stringify(error.lengthGate).includes('content') === false,
  );
});

test('production wiring บังคับ final floor หลังทุก rewrite และก่อน save โดยไม่เพิ่ม AI call', async () => {
  assertFinalPublicationGateWiring();
  assert.match(PUBLISHABLE_SOURCE, /wordCount >= minimumWords/u, 'boundary ต้องรวม 146 ด้วย >=' );
  await assertFinalFloorHelperContract();

  const removedGate = AUTO_FLOW_SOURCE.replace(
    'const lengthOutcome = enforceTextNewsPublicationFloor(finalVersions,',
    'const lengthOutcome = { passingVersions: finalVersions, checks: [], quarantinedVersions: [], status: \'passed\', minimumWords: 146 }; void (',
  );
  assert.notEqual(removedGate, AUTO_FLOW_SOURCE);
  assert.throws(() => assertFinalPublicationGateWiring(removedGate), 'ลบด่านจริงแล้วข้อสอบต้องแดง');

  const movedBeforeFact = AUTO_FLOW_SOURCE
    .replace('const lengthOutcome = enforceTextNewsPublicationFloor(finalVersions,', 'const lengthOutcomeMoved = enforceTextNewsPublicationFloor(finalVersions,')
    .replace('finalVersions = factOutcome.passingVersions;', 'const lengthOutcome = enforceTextNewsPublicationFloor(finalVersions, { minimumWords: NEW_LENGTH_CFG.min });\n      finalVersions = factOutcome.passingVersions;');
  assert.throws(() => assertFinalPublicationGateWiring(movedBeforeFact), 'ย้ายด่านก่อน factual editor แล้วต้องแดง');

  const whitespaceCounter = PUBLISHABLE_SOURCE.replace(
    "const segmenter = new Segmenter('th', { granularity: 'word' });",
    "return getPublishablePostText(version).split(/\\s+/u).filter(Boolean).length; const segmenter = new Segmenter('th', { granularity: 'word' });",
  );
  assert.notEqual(whitespaceCounter, PUBLISHABLE_SOURCE);
  await assert.rejects(assertFinalFloorHelperContract(whitespaceCounter, 'whitespace-counter'),
    'เปลี่ยนเป็น whitespace split แล้วข้อสอบคำไทยต้องแดง');

  const strictGreaterThan = PUBLISHABLE_SOURCE.replace('wordCount >= minimumWords', 'wordCount > minimumWords');
  assert.notEqual(strictGreaterThan, PUBLISHABLE_SOURCE);
  await assert.rejects(assertFinalFloorHelperContract(strictGreaterThan, 'strict-greater-than'),
    'เปลี่ยน >= เป็น > แล้ว boundary 146 ต้องแดง');
});
