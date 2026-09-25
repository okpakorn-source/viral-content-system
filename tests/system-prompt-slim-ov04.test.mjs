// 🔏 ข้อสอบ system prompt สั้นเฉพาะงาน (OV-04 / MC-16) — src/lib/ai/taskSystemPrompts.js + aiRouter.js + geminiClient.js
//   + จุดเรียก AI ใน summarizeServiceText.js (breakdown/blueprint/DNA/ตัวเลือกการ์ด/รีเสิร์ช/สกัด legacy) และ safeCorrectionService.js (L3B/L3A)
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S8 · เจ้าของอนุมัติ)
//
// บั๊กที่ปิด (ผู้ตรวจ 2 คนยืนยัน · วัดจากโค้ดจริงด้วย SDK ปลอม):
//   OV-04 — system prompt ค่าเริ่มต้นของ callAI (~5,958 ตัวอักษร) / callClaude (~3,890) = HUMAN WRITING DNA + "อย่างน้อย 180 คำ" + รายการคำเสี่ยง
//           แต่งานที่ไม่ใช่การเขียน (breakdown sol/terra · blueprint · วิเคราะห์ DNA · ตัวเลือกการ์ด B สาย luna · รีเสิร์ช · L3B/L3A) ไม่ส่ง systemPrompt
//           → ได้ก้อนนี้ ~7 นัด/ข่าว (โทเคนเข้า ~5,000/นัด) + คำสั่งขัดกันเอง (งาน JSON วิเคราะห์ถูกสั่งโครงโพสต์/ความยาว · L3B/L3A ถูกสั่ง 180 คำทั้งที่ "ห้ามยาวขึ้น")
//   MC-16 — chain สกัด: claude-extract ได้ system กฎสกัดล้วน แต่ตัวสำรอง gemini ได้ systemInstruction ฝัง (มีรายการคำห้าม) · gpt ได้ system สายเขียน → ผลสกัดต่างกันตามโมเดล
//
// สิ่งที่ล็อกไว้:
//   A. สวิตช์ SYSTEM_PROMPT_SLIM: ไม่ตั้ง/ว่าง/ค่าอื่น = เปิด · 0/off/false/no/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย · slimSystem/taskSystemPrompt ตามโหมด · 'write' ไม่แทรกเด็ดขาด
//   B. ข้อความ: EXTRACT_SYSTEM_PROMPT = บทบาท + กฎเหล็ก 1–4 ของ claudeClient.js ทุกไบต์ (= EXTRACT_CLAUDE_SYSTEM_PROMPT เดิม 1,411 ตัวอักษร) · system สั้นทุกตัว ≤1,800 ตัวอักษร
//      มีบรรทัด JSON + กฎที่ 2/4 · ไม่มี HUMAN WRITING DNA / FACEBOOK SAFETY / รายการคำห้าม / กฎที่ 5–6 / 180 คำ / hook · CARD_PICKER = สตริงเดียวกับสาย claude จุด B ในซอร์สจริง
//   C. aiRouter จริง (stub 3 client): ค่าเริ่มต้น chain สกัด claude→gemini→gpt ได้ EXTRACT_SYSTEM_PROMPT ทั้งสาม (MC-16) · caller ส่งเองชนะทั้งสาม · breakdown/analyze ได้ system วิเคราะห์ ·
//      task ที่ไม่มีในตาราง = ไม่แทรก · write (opus→fable→sol) systemPrompt = undefined ทั้งสามเหมือนเดิม · โหมดถอย: claude ยังได้ชุดสกัด (M1) · gemini/gpt args keys เดิมทุกตัว (ไม่มี systemPrompt แม้ caller ส่ง)
//   D. geminiClient จริง (SDK ปลอม): ไม่ส่ง systemPrompt = systemInstruction ฝังเดิมทุกไบต์ทั้ง 2 โหมด · ส่ง = ใช้ตรงตัว
//   E. openai/claudeClient จริง (SDK ปลอม): system นักเขียน (ไม่ส่ง systemPrompt + textNewsLengthPolicy) เท่ากันทุกไบต์ทั้ง 2 โหมด (ไม่ถูกแตะ) · ค่าเริ่มต้นยาว >3,000 มี DNA นักเขียน (ต้นทุนที่ปิด) · ส่ง system สั้นแล้วถูกใช้ตรงตัว
//   F. safeCorrect จริง (AI ปลอม): L3B/L3A ได้ system สั้นของงาน · เนื้อผลลัพธ์เท่ากับโหมดถอยทุกไบต์ (AI ปลอมตอบเหมือนกัน) · โหมดถอย keys = ของ S7 · ถอยครบ 2 สวิตช์ = keys ก่อนแคมเปญ · L3A_AI_FIX=legacy ไม่มี systemPrompt แม้สวิตช์เปิด
//   G. ซอร์ส summarizeServiceText/safeCorrectionService: ทุก call site ที่ไม่ใช่งานเขียนมี ...slimSystem(<ชุดของงาน>) · callSmartAI('write') 2 จุดไม่มี systemPrompt/slimSystem · สตริง system ของตัวเลือก A/B สาย claude เดิมอยู่ครบ · fixSentenceWithAILegacy ไม่แตะ
//   H. mutation 8 แบบ (แก้เฉพาะสำเนาในหน่วยความจำ · รันในไฟล์นี้เอง ต้องแดงทุกตัว): router ไม่แทรกค่าเริ่มต้น · gemini/gpt ไม่รับ spread · taskSystemPrompt แทรกให้ write ·
//      slimSystem ไม่สนสวิตช์ · callGemini ทิ้ง systemPrompt · L3B ไม่ส่ง · ซอร์ส breakdown ไม่ส่ง
//
// วิธีรัน:  node --test tests/system-prompt-slim-ov04.test.mjs   (ไม่มี API/network · ไม่เขียนไฟล์ลง src — โหลดผ่าน tests/helpers/temp-module.mjs)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule, importPatchedGraph } from './helpers/temp-module.mjs';
import * as TSP from '../src/lib/ai/taskSystemPrompts.js';

const srcUrl = (rel) => new URL(rel, import.meta.url);
const readSrc = (rel) => readFileSync(srcUrl(rel), 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};
const replaceBlock = (source, startMarker, endMarker, replacement, label) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('หา block ไม่เจอ: ' + label);
  return source.slice(0, start) + replacement + source.slice(end + 2);
};
const withEnv = async (pairs, fn) => {
  const prior = {};
  for (const [name, value] of Object.entries(pairs)) {
    prior[name] = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  try { return await fn(); } finally {
    for (const [name, value] of Object.entries(prior)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
};
const quiet = async (fn) => {
  const prior = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = prior.log; console.warn = prior.warn; console.error = prior.error; }
};
const keysOf = (o) => Object.keys(o);
const SLIM_ON = { SYSTEM_PROMPT_SLIM: undefined };
const SLIM_OFF = { SYSTEM_PROMPT_SLIM: '0' };

const ROUTER_SRC = readSrc('../src/lib/ai/aiRouter.js');
const TSP_SRC = readSrc('../src/lib/ai/taskSystemPrompts.js');
const GEMINI_SRC = readSrc('../src/lib/ai/geminiClient.js');
const OPENAI_SRC = readSrc('../src/lib/ai/openai.js');
const CLAUDE_SRC = readSrc('../src/lib/ai/claudeClient.js');
const TEXT_SRC = readSrc('../src/lib/services/summarizeServiceText.js');
const CORRECT_SRC = readSrc('../src/lib/correction/safeCorrectionService.js');

const JSON_LINE = 'ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt';
const IRON_PROMPTS = ['EXTRACT_SYSTEM_PROMPT', 'BREAKDOWN_SYSTEM_PROMPT', 'BLUEPRINT_SYSTEM_PROMPT', 'NEWS_DNA_SYSTEM_PROMPT', 'RESEARCH_SYSTEM_PROMPT',
  'CORRECTION_RISK_REWRITE_SYSTEM_PROMPT', 'CORRECTION_PHRASE_FIX_SYSTEM_PROMPT'];
// ของสายเขียน/รายการคำห้ามที่ห้ามรั่วเข้า system งานอื่น (ต้นเหตุ euphemize + โทเคน ~5,000/นัด)
const BANNED = ['HUMAN WRITING DNA', 'FACEBOOK SAFETY', 'ห้ามใช้คำเสี่ยง', 'ห้ามใช้:', 'กฎที่ 5', 'กฎที่ 6', 'อย่างน้อย 180 คำ', 'อย่างน้อย 146 คำ', 'ถ้าสะดุด', 'hook', 'AUTO CLEAN', 'FORBIDDEN'];

// ═══ A) สวิตช์ ═══
test('A1 SYSTEM_PROMPT_SLIM: ไม่ตั้ง/ว่าง/1/on/ค่าอื่น = เปิด · 0/off/false/no/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย', async () => {
  for (const v of [undefined, '', '  ', '1', 'on', 'true', 'x', 'slim']) {
    await withEnv({ SYSTEM_PROMPT_SLIM: v }, () => assert.equal(TSP.isSystemPromptSlim(), true, `ต้องเปิด: ${JSON.stringify(v)}`));
  }
  for (const v of ['0', 'off', 'false', 'no', 'legacy', ' 0 ', '"off"', 'OFF', "'Legacy'"]) {
    await withEnv({ SYSTEM_PROMPT_SLIM: v }, () => assert.equal(TSP.isSystemPromptSlim(), false, `ต้องถอย: ${JSON.stringify(v)}`));
  }
});

test('A2 slimSystem: เปิด = { systemPrompt } · ถอย/ไม่มีข้อความ = {} (args เดิมทุกไบต์) · taskSystemPrompt: caller ชนะ · write ไม่แทรก · task นอกตาราง = undefined', async () => {
  await withEnv(SLIM_ON, () => {
    assert.deepEqual(TSP.slimSystem('x'), { systemPrompt: 'x' });
    assert.deepEqual(TSP.slimSystem(''), {});
    assert.deepEqual(TSP.slimSystem(undefined), {});
    assert.equal(TSP.taskSystemPrompt('extract', undefined), TSP.EXTRACT_SYSTEM_PROMPT);
    assert.equal(TSP.taskSystemPrompt('extract', 'SYS-X'), 'SYS-X', 'caller ส่งเองต้องชนะ');
    assert.equal(TSP.taskSystemPrompt('breakdown', undefined), TSP.BREAKDOWN_SYSTEM_PROMPT);
    assert.equal(TSP.taskSystemPrompt('analyze', undefined), TSP.RESEARCH_SYSTEM_PROMPT);
    assert.equal(TSP.taskSystemPrompt('write', undefined), undefined, "'write' ห้ามแทรก system ใดๆ");
    assert.equal(TSP.taskSystemPrompt('general', undefined), undefined, 'task นอกตาราง = ไม่แทรก');
  });
  await withEnv(SLIM_OFF, () => {
    assert.deepEqual(TSP.slimSystem('x'), {}, 'โหมดถอยต้องคืน {}');
    assert.equal(TSP.taskSystemPrompt('extract', undefined), undefined, 'โหมดถอยไม่แทรกค่าเริ่มต้น');
    assert.equal(TSP.taskSystemPrompt('extract', 'SYS-X'), 'SYS-X', 'โหมดถอยยังส่งต่อค่าจาก caller (เหมือนเดิม)');
    assert.equal(TSP.taskSystemPrompt('write', undefined), undefined);
  });
});

// ═══ B) ข้อความ system ═══
test('B1 EXTRACT_SYSTEM_PROMPT = บทบาทผู้สกัด + บรรทัด JSON + กฎเหล็ก 1–4 ยกตรงจาก claudeClient.js ทุกไบต์ (= EXTRACT_CLAUDE_SYSTEM_PROMPT เดิม 1,411 ตัวอักษร)', () => {
  const ci = CLAUDE_SRC.indexOf('=== กฎเหล็ก DNA ระบบ (IRON RULES');
  const c5 = CLAUDE_SRC.indexOf('\n\n[กฎที่ 5', ci);
  assert.ok(ci >= 0 && c5 > ci, 'ต้องหากฎเหล็กใน claudeClient.js เจอ');
  const ironFromClaude = CLAUDE_SRC.slice(ci, c5) + '\n\n=== จบกฎเหล็ก DNA ===';
  assert.equal(TSP.IRON_RULES_1_TO_4, ironFromClaude, 'กฎเหล็ก 1–4 ต้องเท่า claudeClient ทุกไบต์ (ไม่เขียนกฎใหม่ ไม่ตัดกฎ)');
  assert.equal(TSP.EXTRACT_SYSTEM_PROMPT, `คุณเป็น AI ผู้สกัดข้อเท็จจริงจากเนื้อข่าว\n${JSON_LINE}\n\n${ironFromClaude}`);
  assert.equal(TSP.EXTRACT_SYSTEM_PROMPT.length, 1411, 'ความยาวเท่าก้อนเดิมของรอบแก้ M1 (9 ก.ย. 69)');
});

test('B2 system สั้นทุกตัว: ≤1,800 ตัวอักษร · มีบรรทัด JSON + กฎที่ 2/4 · ลงท้ายด้วยกฎเหล็ก · ไม่มีกฎสายเขียน/รายการคำห้าม · CARD_PICKER = สตริงสาย claude จุด B ในซอร์สจริง', () => {
  for (const name of IRON_PROMPTS) {
    const sys = TSP[name];
    assert.equal(typeof sys, 'string', name);
    assert.ok(sys.length >= 1300 && sys.length <= 1800, `${name}: ต้องสั้น (ได้ ${sys.length} ตัวอักษร · ของเดิมสายเขียน ~5,958 / ~3,890)`);
    assert.ok(sys.includes(JSON_LINE), `${name}: ต้องมีบรรทัด JSON`);
    assert.ok(sys.includes('[กฎที่ 2: ห้ามแต่งเรื่อง]'), `${name}: กฎที่ 2`);
    assert.ok(sys.includes('[กฎที่ 4: JSON เท่านั้น]'), `${name}: กฎที่ 4`);
    assert.ok(sys.endsWith(TSP.IRON_RULES_1_TO_4), `${name}: ต้องลงท้ายด้วยกฎเหล็ก 1–4 ก้อนเดียวกัน`);
    for (const banned of BANNED) assert.ok(!sys.includes(banned), `${name}: ห้ามมี "${banned}"`);
  }
  assert.ok(TSP.CARD_PICKER_SYSTEM_PROMPT.length < 120);
  for (const banned of BANNED) assert.ok(!TSP.CARD_PICKER_SYSTEM_PROMPT.includes(banned));
  const literal = TEXT_SRC.match(/systemPrompt: '([^']+)', \/\/ กัน DNA 9KB ของ callClaude ยัดฟรี/u);
  assert.ok(literal, 'ต้องหาสตริง system ของจุด B สาย claude ในซอร์สเจอ');
  assert.equal(TSP.CARD_PICKER_SYSTEM_PROMPT, literal[1], 'สาย luna ต้องได้สตริงเดียวกับสาย claude');
  assert.match(TSP.BREAKDOWN_SYSTEM_PROMPT, /แตกประเด็น/u);
  assert.match(TSP.BLUEPRINT_SYSTEM_PROMPT, /ห้ามเขียนเนื้อหาจริง/u);
  assert.match(TSP.CORRECTION_RISK_REWRITE_SYSTEM_PROMPT, /ห้ามยาวขึ้น/u);
  assert.match(TSP.CORRECTION_PHRASE_FIX_SYSTEM_PROMPT, /ห้ามยาวขึ้น/u);
});

test('B3 TASK_SYSTEM_PROMPT: freeze · มีแค่ extract/breakdown/analyze (ไม่มี write)', () => {
  assert.equal(Object.isFrozen(TSP.TASK_SYSTEM_PROMPT), true);
  assert.deepEqual(keysOf(TSP.TASK_SYSTEM_PROMPT), ['extract', 'breakdown', 'analyze']);
  assert.equal(TSP.TASK_SYSTEM_PROMPT.extract, TSP.EXTRACT_SYSTEM_PROMPT);
  assert.equal(TSP.TASK_SYSTEM_PROMPT.breakdown, TSP.BREAKDOWN_SYSTEM_PROMPT);
  assert.equal(TSP.TASK_SYSTEM_PROMPT.analyze, TSP.RESEARCH_SYSTEM_PROMPT);
});

// ═══ C) aiRouter จริง — stub 3 client บันทึก args + keys (แม่แบบ tests/extract-claude-switch) · โหลดเป็นกราฟกับ taskSystemPrompts (mutation ถึงกัน) ═══
function routerStubbed(src) {
  src = mustReplace(src, "import { callClaude, isClaudeAvailable } from './claudeClient.js';", `
const isClaudeAvailable = () => globalThis.__S8_CLAUDE_AVAILABLE__ !== false;
const callClaude = async (args) => {
  globalThis.__S8_CALLS__.push({ fn: 'claude', keys: Object.keys(args), args });
  const plan = globalThis.__S8_PLAN__.claude.shift() || 'ok';
  if (plan === 'throw') throw new Error('mock-claude-down');
  return { news_title: 'จาก claude', news_body: 'เนื้อจาก claude ยาวพอเกณฑ์', _modelUsed: args.model };
};`, 'stub claude');
  src = mustReplace(src, /import \{ callGemini[^\n]*\n/u, `
const isGeminiAvailable = () => globalThis.__S8_GEMINI_AVAILABLE__ !== false;
const callGemini = async (args) => {
  globalThis.__S8_CALLS__.push({ fn: 'gemini', keys: Object.keys(args), args });
  const plan = globalThis.__S8_PLAN__.gemini.shift() || 'ok';
  if (plan === 'throw') throw new Error('mock-gemini-down');
  return { news_title: 'จาก gemini', news_body: 'เนื้อจาก gemini ยาวพอเกณฑ์', _modelUsed: 'gemini-3.6-flash' };
};
`, 'stub gemini');
  src = mustReplace(src, "import { callAI } from './openai.js';", `
const callAI = async (args) => {
  globalThis.__S8_CALLS__.push({ fn: 'gpt', keys: Object.keys(args), args });
  const plan = globalThis.__S8_PLAN__.gpt.shift() || 'ok';
  if (plan === 'throw') throw new Error('mock-gpt-down');
  return { news_title: 'จาก gpt', news_body: 'เนื้อจาก gpt ยาวพอเกณฑ์', _modelUsed: args.model };
};`, 'stub openai');
  src = mustReplace(src, /import \{ MODEL_PRIMARY[^\n]*\n/u, "const MODEL_PRIMARY = 'gpt-5.6-sol';\n", 'stub modelConfig');
  return src;
}
async function loadRouter({ routerSrc = ROUTER_SRC, tspSrc = TSP_SRC } = {}) {
  const graph = await importPatchedGraph({
    tsp: { source: tspSrc, originalUrl: srcUrl('../src/lib/ai/taskSystemPrompts.js') },
    router: { source: routerStubbed(routerSrc), originalUrl: srcUrl('../src/lib/ai/aiRouter.js'), links: { './taskSystemPrompts.js': 'tsp' } },
  });
  return graph.router.callSmartAI;
}
const reset = (plan = {}) => {
  globalThis.__S8_CALLS__ = [];
  globalThis.__S8_PLAN__ = { claude: [...(plan.claude || [])], gemini: [...(plan.gemini || [])], gpt: [...(plan.gpt || [])] };
  globalThis.__S8_CLAUDE_AVAILABLE__ = plan.claudeAvailable !== false;
  globalThis.__S8_GEMINI_AVAILABLE__ = plan.geminiAvailable !== false;
};
const calls = () => globalThis.__S8_CALLS__;
const run = (callSmartAI, task, opts = {}) => quiet(() => callSmartAI(task, { prompt: 'ข่าวทดสอบ', ...opts }));
const GEMINI_KEYS_LEGACY = ['prompt', 'temperature', 'maxTokens', 'signal', 'sanitizeScope'];
const GPT_KEYS_LEGACY = ['prompt', 'temperature', 'maxTokens', 'model', 'signal', 'textNewsLengthPolicy', 'sanitizeScope'];

/** ค่าเริ่มต้น (สวิตช์เปิด): chain สกัดทั้ง 3 โมเดลได้ EXTRACT_SYSTEM_PROMPT · caller ชนะ · breakdown/analyze ได้ system วิเคราะห์ · task นอกตาราง ไม่แทรก */
async function assertRouterSlim(callSmartAI) {
  await withEnv({ ...SLIM_ON, EXTRACT_PRIMARY: 'claude' }, async () => {
    reset({ claude: ['throw'], gemini: ['throw'] });
    const out = await run(callSmartAI, 'extract');
    assert.deepEqual(calls().map((c) => c.fn), ['claude', 'gemini', 'gpt'], 'ลำดับ chain เดิม');
    for (const c of calls()) assert.equal(c.args.systemPrompt, TSP.EXTRACT_SYSTEM_PROMPT, `${c.fn}: ต้องได้ชุดสกัดเดียวกัน (MC-16)`);
    assert.deepEqual(calls()[1].keys, [...GEMINI_KEYS_LEGACY, 'systemPrompt'], 'gemini: args เดิม + systemPrompt ต่อท้าย');
    assert.deepEqual(calls()[2].keys, [...GPT_KEYS_LEGACY, 'systemPrompt'], 'gpt: args เดิม + systemPrompt ต่อท้าย');
    assert.equal(calls()[2].args.textNewsLengthPolicy, false, 'สิทธิ์ 146 ยังไม่รั่วเข้าขั้นสกัด');
    assert.equal(calls()[0].args.maxRetries, 0, 'claude-extract ยังส่ง maxRetries 0 (L1 เดิม)');
    assert.equal(out.model, 'gpt-5.6-sol');

    reset({ claude: ['throw'], gemini: ['throw'] });
    await run(callSmartAI, 'extract', { systemPrompt: 'SYS-X' });
    assert.deepEqual(calls().map((c) => c.args.systemPrompt), ['SYS-X', 'SYS-X', 'SYS-X'], 'caller ส่งเองต้องชนะทุกโมเดล');
  });
  await withEnv({ ...SLIM_ON, EXTRACT_PRIMARY: undefined }, async () => {
    reset({ gemini: ['throw'] });
    await run(callSmartAI, 'extract');
    assert.deepEqual(calls().map((c) => [c.fn, c.args.systemPrompt === TSP.EXTRACT_SYSTEM_PROMPT]), [['gemini', true], ['gpt', true]], 'ไม่ตั้ง env: gemini→gpt ก็ได้ชุดสกัด');

    reset({ gpt: ['throw'] });
    await run(callSmartAI, 'breakdown');
    assert.deepEqual(calls().map((c) => [c.fn, c.args.systemPrompt === TSP.BREAKDOWN_SYSTEM_PROMPT]), [['gpt', true], ['claude', true]], 'breakdown: sol→claude ได้ system แตกประเด็น');

    reset();
    await run(callSmartAI, 'analyze');
    assert.equal(calls()[0].fn, 'gpt');
    assert.equal(calls()[0].args.systemPrompt, TSP.RESEARCH_SYSTEM_PROMPT, 'analyze (รีเสิร์ช): ได้ system รีเสิร์ช');

    reset();
    await run(callSmartAI, 'general');
    assert.equal(calls()[0].fn, 'gpt');
    assert.deepEqual(calls()[0].keys, GPT_KEYS_LEGACY, 'task นอกตาราง: ไม่แทรก (args เดิม)');
  });
}

/** งานเขียน: opus→fable→sol ต้องไม่ได้ systemPrompt ใดๆ ทั้ง 2 โหมด (system นักเขียนเดิมทุกไบต์) */
async function assertWriteUntouched(callSmartAI) {
  for (const env of [SLIM_ON, SLIM_OFF]) {
    await withEnv(env, async () => {
      reset({ claude: ['throw', 'throw'] });
      await run(callSmartAI, 'write', { textNewsLengthPolicy: true });
      assert.deepEqual(calls().map((c) => c.args.model), ['claude-opus-5-5', 'claude-fable-5', 'gpt-5.6-sol'], 'โซ่นักเขียนเดิม');
      for (const c of calls()) assert.equal(c.args.systemPrompt, undefined, `${c.args.model}: นักเขียนต้องไม่ได้ systemPrompt (${JSON.stringify(env)})`);
      assert.deepEqual(calls().map((c) => c.args.textNewsLengthPolicy), [true, true, true], 'สิทธิ์ 146 เดิมครบทุกไม้');
    });
  }
}

/** โหมดถอย SYSTEM_PROMPT_SLIM=0: claude-extract ยังได้ชุดสกัด (M1) · gemini/gpt args keys เดิมทุกตัว ไม่มี systemPrompt แม้ caller ส่ง · breakdown/analyze ไม่แทรก */
async function assertRouterLegacy(callSmartAI) {
  await withEnv({ ...SLIM_OFF, EXTRACT_PRIMARY: 'claude' }, async () => {
    reset({ claude: ['throw'], gemini: ['throw'] });
    await run(callSmartAI, 'extract');
    assert.deepEqual(calls().map((c) => c.fn), ['claude', 'gemini', 'gpt']);
    assert.equal(calls()[0].args.systemPrompt, TSP.EXTRACT_SYSTEM_PROMPT, 'โหมดถอย: claude-extract ยังได้ชุดสกัดตามรอบแก้ M1');
    assert.deepEqual(calls()[1].keys, GEMINI_KEYS_LEGACY, 'โหมดถอย: gemini args เดิมทุกตัว (ไม่มี systemPrompt)');
    assert.deepEqual(calls()[2].keys, GPT_KEYS_LEGACY, 'โหมดถอย: gpt args เดิมทุกตัว (ไม่มี systemPrompt)');

    reset({ claude: ['throw'], gemini: ['throw'] });
    await run(callSmartAI, 'extract', { systemPrompt: 'SYS-X' });
    assert.equal(calls()[0].args.systemPrompt, 'SYS-X', 'โหมดถอย: claude ยังรับค่าจาก caller (เหมือนเดิม)');
    assert.deepEqual(calls()[1].keys, GEMINI_KEYS_LEGACY, 'โหมดถอย: gemini ทิ้งค่าจาก caller (เหมือนเดิม)');
    assert.deepEqual(calls()[2].keys, GPT_KEYS_LEGACY, 'โหมดถอย: gpt ทิ้งค่าจาก caller (เหมือนเดิม)');
  });
  await withEnv({ ...SLIM_OFF, EXTRACT_PRIMARY: undefined }, async () => {
    reset({ gpt: ['throw'] });
    await run(callSmartAI, 'breakdown');
    assert.deepEqual(calls()[0].keys, GPT_KEYS_LEGACY, 'โหมดถอย breakdown: gpt args เดิม');
    assert.equal(calls()[1].fn, 'claude');
    assert.equal(calls()[1].args.systemPrompt, undefined, 'โหมดถอย breakdown: claude สำรองไม่ได้ system วิเคราะห์');
    reset();
    await run(callSmartAI, 'analyze');
    assert.deepEqual(calls()[0].keys, GPT_KEYS_LEGACY, 'โหมดถอย analyze: gpt args เดิม');
  });
}

test('C1 ค่าเริ่มต้น: chain สกัด claude→gemini→gpt ได้ EXTRACT_SYSTEM_PROMPT ทั้งสาม (MC-16) · caller ชนะ · breakdown/analyze ได้ system วิเคราะห์ · task นอกตารางไม่แทรก', async () => {
  await assertRouterSlim(await loadRouter());
});

test('C2 งานเขียน opus→fable→sol ไม่ได้ systemPrompt ทั้ง 2 โหมด (system นักเขียนเดิมทุกไบต์) · สิทธิ์ 146 เดิม', async () => {
  await assertWriteUntouched(await loadRouter());
});

test('C3 โหมดถอย SYSTEM_PROMPT_SLIM=0: claude-extract ยังได้ชุดสกัด (M1) · gemini/gpt args เดิมทุกตัว แม้ caller ส่ง systemPrompt · breakdown/analyze ไม่แทรก', async () => {
  await assertRouterLegacy(await loadRouter());
});

// ═══ D) geminiClient จริง — SDK ปลอมจด systemInstruction ═══
function geminiStubbed(src) {
  src = src
    .replace("import { GoogleGenerativeAI } from '@google/generative-ai';", 'class GoogleGenerativeAI {}')
    .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};')
    .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/u, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n')
    .replace("import { sanitizeOutput } from './safetyFilter';", "import { sanitizeOutput } from './safetyFilter.js';");
  return replaceBlock(src, 'function getGeminiClient() {', '\n}\n\n// Google SDK รับ request options',
    "function getGeminiClient() { return { getGenerativeModel: (cfg) => { globalThis.__S8_GEMINI_SYS__ = cfg.systemInstruction; return { generateContent: async () => ({ response: { text: () => '{\"ok\":1}', usageMetadata: {} } }) }; } }; }", 'gemini client');
}
const loadGemini = (src = GEMINI_SRC) => importPatchedModule(geminiStubbed(src), srcUrl('../src/lib/ai/geminiClient.js'), 'gemini-s8');
const geminiSys = async (g, args) => { globalThis.__S8_GEMINI_SYS__ = null; await quiet(() => g.callGemini({ prompt: 'x', ...args })); return String(globalThis.__S8_GEMINI_SYS__); };

async function assertGeminiHonorsSystem(g) {
  const withSys = await geminiSys(g, { systemPrompt: TSP.EXTRACT_SYSTEM_PROMPT });
  assert.equal(withSys, TSP.EXTRACT_SYSTEM_PROMPT, 'ส่ง systemPrompt = systemInstruction ตรงตัว');
  const legacyEnvSys = await withEnv(SLIM_OFF, () => geminiSys(g, { systemPrompt: TSP.EXTRACT_SYSTEM_PROMPT }));
  assert.equal(legacyEnvSys, TSP.EXTRACT_SYSTEM_PROMPT, 'client ไม่อ่านสวิตช์เอง (ประตูอยู่ที่ router/slimSystem)');
}

test('D1 callGemini ไม่ส่ง systemPrompt = systemInstruction ฝังเดิมทุกไบต์ทั้ง 2 โหมด (มี FACEBOOK SAFETY ตามเดิม) · D2 ส่ง = ใช้ตรงตัว', async () => {
  const g = await loadGemini();
  const on = await withEnv(SLIM_ON, () => geminiSys(g, {}));
  const off = await withEnv(SLIM_OFF, () => geminiSys(g, {}));
  assert.equal(on, off, 'ไม่ส่ง systemPrompt: ก้อนฝังต้องเท่ากันทุกไบต์ทั้ง 2 โหมด');
  assert.ok(on.startsWith('คุณเป็น AI assistant ที่ต้องตอบเป็น JSON เท่านั้น'), 'ก้อนฝังเดิม');
  assert.ok(on.includes('=== FACEBOOK SAFETY RULES ===') && on.includes('ห้ามใช้คำเสี่ยง'), 'ก้อนฝังเดิมยังมีรายการคำห้าม (ของเดิมไม่แตะ)');
  assert.ok(on.length > 500);
  await assertGeminiHonorsSystem(g);
});

// ═══ E) openai/claudeClient จริง — SDK ปลอมจด system ที่ส่งจริง ═══
const stubCommon = (src) => src
  .replace("import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};')
  .replace(/import \{ preparePipelineSignal, rethrowPipelineDeadline \}[^\n]*\n/u, 'const preparePipelineSignal = (signal) => signal; const rethrowPipelineDeadline = () => {};\n')
  .replace("import { sanitizeOutput } from './safetyFilter';", "import { sanitizeOutput } from './safetyFilter.js';");
async function loadWriterClients() {
  let openaiSrc = stubCommon(OPENAI_SRC).replace("import OpenAI from 'openai';", 'class OpenAI {}').replace("import { MODEL_PRIMARY } from './modelConfig.js';", "const MODEL_PRIMARY = 'gpt-5.6-sol';");
  openaiSrc = replaceBlock(openaiSrc, 'export function getOpenAIClient() {', '\n}\n\n/**\n * เรียก AI',
    "export function getOpenAIClient() { return { chat: { completions: { create: async (body) => { globalThis.__S8_OPENAI_SYS__ = body.messages[0].content; return { choices: [{ message: { content: '{\"ok\":1}' } }], usage: {} }; } } } }; }", 'openai client');
  let claudeSrc = stubCommon(CLAUDE_SRC).replace("import Anthropic from '@anthropic-ai/sdk';", 'class Anthropic {}');
  claudeSrc = replaceBlock(claudeSrc, 'function getClaudeClient() {', '\n}\n\n/**\n * เรียก Claude',
    "function getClaudeClient() { return { messages: { create: async (body) => { globalThis.__S8_CLAUDE_SYS__ = body.system; return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '{\"ok\":1}' }] }; } } }; }", 'claude client');
  const [openai, claude] = await Promise.all([
    importPatchedModule(openaiSrc, srcUrl('../src/lib/ai/openai.js'), 'openai-s8'),
    importPatchedModule(claudeSrc, srcUrl('../src/lib/ai/claudeClient.js'), 'claude-s8'),
  ]);
  const openaiSys = async (args) => { globalThis.__S8_OPENAI_SYS__ = null; await quiet(() => openai.callAI({ prompt: 'x', allowModelFallback: false, ...args })); return String(globalThis.__S8_OPENAI_SYS__); };
  const claudeSys = async (args) => { globalThis.__S8_CLAUDE_SYS__ = null; await quiet(() => claude.callClaude({ prompt: 'x', model: 'claude-opus-5-5', retryWithoutEffort: false, ...args })); return String(globalThis.__S8_CLAUDE_SYS__); };
  return { openaiSys, claudeSys };
}

test('E1 system นักเขียน (ไม่ส่ง systemPrompt + textNewsLengthPolicy) เท่ากันทุกไบต์ทั้ง 2 โหมด — ไม่ถูกแตะ · E2 ค่าเริ่มต้นยาว >3,000 มี DNA นักเขียน (ต้นทุนที่ S8 ปิดให้งานอื่น) · ส่ง system สั้น = ใช้ตรงตัว', async () => {
  const { openaiSys, claudeSys } = await loadWriterClients();
  const wOn = await withEnv(SLIM_ON, () => openaiSys({ textNewsLengthPolicy: true }));
  const wOff = await withEnv(SLIM_OFF, () => openaiSys({ textNewsLengthPolicy: true }));
  assert.equal(wOn, wOff, 'openai: system นักเขียนต้องเท่ากันทุกไบต์');
  assert.ok(wOn.length > 5000 && wOn.includes('HUMAN WRITING DNA') && wOn.includes('อย่างน้อย 146 คำ'), 'openai: system นักเขียนเดิม (DNA + พื้น 146)');
  const cOn = await withEnv(SLIM_ON, () => claudeSys({ textNewsLengthPolicy: true }));
  const cOff = await withEnv(SLIM_OFF, () => claudeSys({ textNewsLengthPolicy: true }));
  assert.equal(cOn, cOff, 'claude: system นักเขียนต้องเท่ากันทุกไบต์');
  assert.ok(cOn.length > 3000 && cOn.includes('HUMAN WRITING DNA') && cOn.includes('อย่างน้อย 146 คำ'), 'claude: system นักเขียนเดิม');

  // ค่าเริ่มต้นของงานที่ไม่ส่ง systemPrompt (= สิ่งที่ OV-04 จ่ายอยู่) — ยังเป็นก้อนเดิม เผื่อ caller ที่ยังไม่ส่ง
  const dOpenai = await openaiSys({});
  assert.ok(dOpenai.length > 5000 && dOpenai.includes('อย่างน้อย 180 คำ') && dOpenai.includes('FACEBOOK SAFETY'), 'openai default = system สายเขียน 180 คำ + wordlist (ไม่แตะ)');
  const dClaude = await claudeSys({});
  assert.ok(dClaude.length > 3000 && dClaude.includes('อย่างน้อย 180 คำ'), 'claude default = system สายเขียน 180 คำ (ไม่แตะ)');

  // ส่ง system สั้นแล้ว client ต้องใช้ตรงตัว (ไม่ต่อกฎสายเขียนเพิ่ม)
  assert.equal(await openaiSys({ systemPrompt: TSP.BREAKDOWN_SYSTEM_PROMPT }), TSP.BREAKDOWN_SYSTEM_PROMPT);
  assert.equal(await claudeSys({ systemPrompt: TSP.CORRECTION_RISK_REWRITE_SYSTEM_PROMPT }), TSP.CORRECTION_RISK_REWRITE_SYSTEM_PROMPT);
});

// ═══ F) safeCorrect จริง — L3B/L3A (AI ปลอม deterministic · แม่แบบ tests/correction-ai-timeout-pl11) ═══
function correctStubbed(src) {
  src = mustReplace(src, "import { callAI } from '@/lib/ai/openai';", 'const callAI = async (args) => globalThis.__S8_L3_AI__(args);', 'correct stub openai');
  src = mustReplace(src, "import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'gpt-5.6-luna';", 'correct stub modelConfig');
  src = mustReplace(src, "import { keyNumbersOf, hasKeyNumber } from './flagFixerService';", 'const keyNumbersOf = () => []; const hasKeyNumber = () => true;', 'correct stub flagFixer');
  return src;
}
async function loadCorrect({ correctSrc = CORRECT_SRC, tspSrc = TSP_SRC } = {}) {
  const graph = await importPatchedGraph({
    tsp: { source: tspSrc, originalUrl: srcUrl('../src/lib/ai/taskSystemPrompts.js') },
    correct: { source: correctStubbed(correctSrc), originalUrl: srcUrl('../src/lib/correction/safeCorrectionService.js'), links: { '../ai/taskSystemPrompts.js': 'tsp' } },
  });
  return graph.correct.safeCorrect;
}
const l3calls = [];
let l3answer = () => { throw new Error('mock: ยังไม่ตั้งคำตอบ'); };
globalThis.__S8_L3_AI__ = async (args) => { l3calls.push({ keys: keysOf(args), args }); return l3answer(args); };
const l3reset = () => { l3calls.length = 0; };
const runL3 = (safeCorrect, content, issues) => quiet(() => safeCorrect(content, issues));

// ข่าว 4 กลุ่ม (อาชญากรรม/อุบัติเหตุ/ราชาศัพท์/สถานที่) — L3B ใช้คำ "เลือด" (aiRewrite) · L3A ใช้วลี AI "ทั้งนี้/ดังกล่าว"
const NEWS = {
  crime: 'ตำรวจ สน.บางนา จับกุมชายวัย 34 ปี ผู้ต้องสงสัยชิงทรัพย์ร้านทอง 3 ร้าน พบคราบเลือดบนพื้นหน้าร้าน ทั้งนี้ ผู้ต้องหาให้การรับสารภาพแล้ว',
  accident: 'รถกระบะเสียหลักชนต้นไม้ริมถนนสาย 304 อ.กบินทร์บุรี เวลา 02.30 น. คนขับวัย 27 ปี มีเลือดไหลที่ศีรษะ ถูกนำส่งโรงพยาบาล ทั้งนี้ ถนนช่วงดังกล่าวไม่มีไฟส่องสว่าง',
  royal: 'ประชาชนกว่า 2,000 คนเฝ้ารับเสด็จ เมื่อเสด็จพระราชดำเนินไปทรงเปิดอาคารเรียนหลังใหม่ของโรงเรียนบ้านหนองแวง จ.ขอนแก่น ทั้งนี้ นักเรียน 320 คนได้เข้าใช้อาคารดังกล่าวตั้งแต่ภาคเรียนนี้',
  place: 'น้ำท่วมขยายวงกว้างใน อ.เมือง จ.สุโขทัย ระดับน้ำในถนนจรดวิถีถ่องสูงกว่า 40 เซนติเมตร ชาวบ้าน 150 ครัวเรือนอพยพไปวัดคูหาสุวรรณ ทั้งนี้ โรงเรียนในพื้นที่ดังกล่าวประกาศปิด 4 แห่ง',
};
const L3B_ISSUE = { type: 'forbidden_word', text: 'เลือด', suggestion: 'ร่องรอยเหตุการณ์', severity: 'medium', location: 0 };
const wording = (text) => ({ type: 'ai_wording', text, location: 0, severity: 'medium', suggestion: 'ลบหรือเปลี่ยนเป็นภาษาคนพูดจริง' });
const L3A_ISSUES = [wording('ทั้งนี้'), wording('ดังกล่าว')];
const sentenceFromPrompt = (args) => (args.prompt.match(/ประโยคเดิม: ([^\n]*)/u) || [])[1] || '';
const l3bEditor = (args) => ({ content: (args.prompt.match(/=== เนื้อหา ===\n([\s\S]*?)\n=== จบ ===/u) || [])[1].replace('เลือด', 'ร่องรอยบางอย่าง') });
const l3aEditor = (args) => ({ sentence: sentenceFromPrompt(args).replace(/ทั้งนี้ |ดังกล่าว/gu, '').replace(/  +/g, ' ').trim() });
const L3_KEYS_S7 = ['model', 'temperature', 'maxTokens', 'prompt', 'signal'];

async function assertL3bSlim(safeCorrect) {
  for (const group of ['crime', 'accident']) {
    l3reset(); l3answer = l3bEditor;
    const slim = await withEnv(SLIM_ON, () => runL3(safeCorrect, NEWS[group], [L3B_ISSUE]));
    assert.equal(l3calls.length, 1, `${group}: L3B เรียก AI 1 ครั้ง`);
    assert.equal(l3calls[0].args.systemPrompt, TSP.CORRECTION_RISK_REWRITE_SYSTEM_PROMPT, `${group}: L3B ต้องได้ system สั้นงานเกลาคำเสี่ยง`);
    assert.deepEqual(l3calls[0].keys, [...L3_KEYS_S7, 'systemPrompt'], `${group}: args = ของ S7 + systemPrompt ต่อท้าย`);
    assert.equal(l3calls[0].args.maxTokens, 8000);
    assert.ok(slim.corrections.some((c) => c.type === 'ai_context_rewrite'), `${group}: ผลถูกใช้จริง`);
    assert.ok(slim.correctedContent.includes('ร่องรอยบางอย่าง') && !slim.correctedContent.includes('เลือด'));

    l3reset(); l3answer = l3bEditor;
    const legacy = await withEnv(SLIM_OFF, () => runL3(safeCorrect, NEWS[group], [L3B_ISSUE]));
    assert.deepEqual(l3calls[0].keys, L3_KEYS_S7, `${group}: โหมดถอย = args ของ S7 (ไม่มี systemPrompt)`);
    assert.equal(legacy.correctedContent, slim.correctedContent, `${group}: ข้อความผลลัพธ์เท่ากันทุกไบต์ทั้ง 2 โหมด (AI ปลอมตอบเหมือนกัน)`);
    assert.deepEqual(legacy.corrections.map((c) => c.type), slim.corrections.map((c) => c.type));
  }
}

test('F1 L3B: ค่าเริ่มต้นได้ system สั้นงานเกลาคำเสี่ยง (args S7 + systemPrompt) · โหมดถอย = args S7 · เนื้อผลลัพธ์เท่ากันทุกไบต์ · ถอยครบ 2 สวิตช์ = args ก่อนแคมเปญ', async () => {
  const safeCorrect = await loadCorrect();
  await assertL3bSlim(safeCorrect);
  l3reset(); l3answer = l3bEditor;
  await withEnv({ ...SLIM_OFF, CORRECTION_AI_TIMEOUT_MS: '0' }, () => runL3(safeCorrect, NEWS.crime, [L3B_ISSUE]));
  assert.deepEqual(l3calls[0].keys, ['model', 'temperature', 'maxTokens', 'prompt'], 'ถอย S7+S8 = args เดิมก่อนแคมเปญทุกไบต์');
});

test('F2 L3A: ทุกคำขอได้ system สั้นงานเกลาวลี · วลี AI หายเหมือนโหมดถอย · ตัวเลข/ชื่อ/ราชาศัพท์คงเดิม · L3A_AI_FIX=legacy ไม่มี systemPrompt แม้สวิตช์เปิด', async () => {
  const safeCorrect = await loadCorrect();
  for (const [group, content] of Object.entries(NEWS)) {
    l3reset(); l3answer = l3aEditor;
    const slim = await withEnv(SLIM_ON, () => runL3(safeCorrect, content, L3A_ISSUES));
    assert.ok(l3calls.length >= 1, `${group}: L3A ต้องเรียก AI`);
    for (const c of l3calls) {
      assert.equal(c.args.systemPrompt, TSP.CORRECTION_PHRASE_FIX_SYSTEM_PROMPT, `${group}: L3A ต้องได้ system สั้นงานเกลาวลี`);
      assert.deepEqual(c.keys, [...L3_KEYS_S7, 'systemPrompt']);
      assert.equal(c.args.maxTokens, 2000);
    }
    assert.ok(!slim.correctedContent.includes('ทั้งนี้') && !slim.correctedContent.includes('ดังกล่าว'), `${group}: วลี AI ต้องหาย`);
    const numbers = (t) => (t.match(/[0-9๐-๙]+(?:[.,:][0-9๐-๙]+)*/g) || []).join(' ');
    assert.equal(numbers(slim.correctedContent), numbers(content), `${group}: ตัวเลขคงเดิม`);
    if (group === 'royal') assert.ok(slim.correctedContent.includes('เสด็จพระราชดำเนิน'), 'ราชาศัพท์คงเดิม');

    l3reset(); l3answer = l3aEditor;
    const legacy = await withEnv(SLIM_OFF, () => runL3(safeCorrect, content, L3A_ISSUES));
    for (const c of l3calls) assert.deepEqual(c.keys, L3_KEYS_S7, `${group}: โหมดถอย = args ของ S7`);
    assert.equal(legacy.correctedContent, slim.correctedContent, `${group}: ข้อความผลลัพธ์เท่ากันทุกไบต์ทั้ง 2 โหมด`);
  }
  l3reset(); l3answer = () => ({ sentence: 'x' });
  await withEnv({ ...SLIM_ON, L3A_AI_FIX: 'legacy' }, () => runL3(safeCorrect, NEWS.crime, L3A_ISSUES));
  assert.ok(l3calls.length >= 1);
  for (const c of l3calls) assert.deepEqual(c.keys, ['model', 'temperature', 'maxTokens', 'prompt'], 'fixSentenceWithAILegacy ต้องเดิมทุกไบต์ (ไม่มี systemPrompt/signal)');
});

// ═══ G) ซอร์ส: ทุก call site ที่ไม่ใช่งานเขียนส่ง system สั้น · งานเขียนไม่แตะ ═══
function assertTextWiring(src = TEXT_SRC) {
  assert.match(src, /import \{ slimSystem, [^\n]*\} from '@\/lib\/ai\/taskSystemPrompts';/u, 'ต้อง import จาก taskSystemPrompts');
  const block = (start, end) => {
    const i = src.indexOf(start);
    assert.ok(i >= 0, 'หา call site ไม่เจอ: ' + start);
    const j = src.indexOf(end, i);
    assert.ok(j > i, 'หาจุดจบ call site ไม่เจอ: ' + start);
    return src.slice(i, j + end.length);
  };
  assert.match(block('callAI({ prompt, model: MODEL_BREAKDOWN,', '}),'), /\.\.\.slimSystem\(BREAKDOWN_SYSTEM_PROMPT\)/u, 'breakdown sol');
  assert.match(block('callAI({ prompt, model: MODEL_HEAVY_FALLBACK,', '}),'), /\.\.\.slimSystem\(BREAKDOWN_SYSTEM_PROMPT\)/u, 'breakdown terra');
  assert.match(block('const blueprintResult = await callAI({', '});'), /\.\.\.slimSystem\(BLUEPRINT_SYSTEM_PROMPT\)/u, 'blueprint');
  assert.equal((src.match(/\.\.\.slimSystem\(NEWS_DNA_SYSTEM_PROMPT\)/gu) || []).length, 2, 'วิเคราะห์ DNA 2 จุด (analyze STAGE 1 + getTopPrompts STAGE 1)');
  assert.match(block("callSmartAI('analyze', {", '})'), /\.\.\.slimSystem\(RESEARCH_SYSTEM_PROMPT\)/u, 'รีเสิร์ช (router)');
  assert.match(block('callAI({ prompt: researchPrompt,', '})'), /\.\.\.slimSystem\(RESEARCH_SYSTEM_PROMPT\)/u, 'รีเสิร์ช (ถอย)');
  assert.match(block('_pick = await callAI({', '});'), /\.\.\.slimSystem\(CARD_PICKER_SYSTEM_PROMPT\)/u, 'ตัวเลือกการ์ด B สาย luna');
  assert.ok((src.match(/\.\.\.slimSystem\(CARD_PICKER_SYSTEM_PROMPT\)/gu) || []).length >= 5, 'ตัวเลือกการ์ด: จุด B luna + STAGE 2.5 (luna/gemini/callAI)');
  assert.match(src, /callAI\(\{ prompt, temperature: 0\.2, sanitizeScope: 'facts', \.\.\.slimSystem\(EXTRACT_SYSTEM_PROMPT\) \}\)/u, 'สกัด legacy');
  const writeBlocks = [...src.matchAll(/callSmartAI\('write',\s*\{([\s\S]{0,500}?)\}\)/gu)].map((m) => m[1]);
  assert.equal(writeBlocks.length, 2, 'นักเขียน analyze+mix สองจุด');
  for (const b of writeBlocks) assert.doesNotMatch(b, /systemPrompt|slimSystem/u, 'งานเขียนห้ามส่ง system ใดๆ (system นักเขียนเดิมทุกไบต์)');
  assert.equal((src.match(/systemPrompt: 'คุณเป็นบรรณารักษ์คัดการ์ดพร้อมท์ ตอบเป็น JSON ตามที่สั่งเท่านั้น'/gu) || []).length, 2, 'ตัวเลือก A เดิม 2 จุด');
  assert.equal((src.match(/systemPrompt: 'คุณเป็นผู้เชี่ยวชาญเลือกการ์ดพร้อมท์ข่าวไวรัล ตอบเป็น JSON ตามที่สั่งเท่านั้น'/gu) || []).length, 1, 'ตัวเลือก B สาย claude เดิม');
}
function assertCorrectWiring(src = CORRECT_SRC) {
  assert.match(src, /import \{ slimSystem, CORRECTION_RISK_REWRITE_SYSTEM_PROMPT, CORRECTION_PHRASE_FIX_SYSTEM_PROMPT \} from '\.\.\/ai\/taskSystemPrompts\.js';/u);
  const l3b = src.slice(src.indexOf("correctionAiCall('correction:L3B'"), src.indexOf('}), { signal: options?.signal });'));
  assert.match(l3b, /\.\.\.slimSystem\(CORRECTION_RISK_REWRITE_SYSTEM_PROMPT\)/u, 'L3B');
  const l3a = src.slice(src.indexOf("correctionAiCall('correction:L3A'"), src.indexOf('}), { signal: run.signal });'));
  assert.match(l3a, /\.\.\.slimSystem\(CORRECTION_PHRASE_FIX_SYSTEM_PROMPT\)/u, 'L3A');
  const legacyFn = src.slice(src.indexOf('async function fixSentenceWithAILegacy'));
  assert.doesNotMatch(legacyFn, /slimSystem|systemPrompt/u, 'fixSentenceWithAILegacy ต้องเดิมทุกไบต์');
}

test('G1 ซอร์ส summarizeServiceText: 13 จุดที่ไม่ใช่งานเขียนส่ง system สั้น · นักเขียน 2 จุดไม่แตะ · สตริงตัวเลือก A/B สาย claude เดิมครบ · G2 safeCorrectionService: L3B/L3A ส่ง · legacy fn ไม่แตะ', () => {
  assertTextWiring();
  // นับเฉพาะโค้ด (ขึ้นต้นบรรทัดหรือหลัง ", ") — คอมเมนต์ประวัติเอ่ย "...slimSystem(" หลังเครื่องหมาย ": " ไม่นับ
  assert.equal((TEXT_SRC.match(/(?:^\s*|, )\.\.\.slimSystem\(/gmu) || []).length, 13, 'จำนวนจุดที่ส่ง system สั้นใน summarizeServiceText (breakdown 2 · DNA 2 · ตัวเลือกการ์ด 5 · blueprint 1 · รีเสิร์ช 2 · สกัด legacy 1)');
  assertCorrectWiring();
});

// ═══ H) mutation — แก้เฉพาะสำเนาในหน่วยความจำ ต้องแดงทุกตัว ═══
test('H1 router: ถอดค่าเริ่มต้นระดับ router (taskSystemPrompt) → gemini/gpt ไม่ได้ชุดสกัด ต้องถูกจับ', async () => {
  const m = mustReplace(ROUTER_SRC, 'const systemPrompt = taskSystemPrompt(task, systemPromptOpt);', 'const systemPrompt = systemPromptOpt;', 'H1');
  await assert.rejects(async () => assertRouterSlim(await loadRouter({ routerSrc: m })));
});

test('H2 router: gemini/gpt4o ไม่ spread slimSystem → ตัวสำรองไม่ได้ system ต้องถูกจับ', async () => {
  const noGemini = mustReplace(ROUTER_SRC, 'return callGemini({ prompt, temperature, maxTokens, signal, sanitizeScope, ...slimSystem(systemPrompt) });',
    'return callGemini({ prompt, temperature, maxTokens, signal, sanitizeScope });', 'H2 gemini');
  await assert.rejects(async () => assertRouterSlim(await loadRouter({ routerSrc: noGemini })));
  const noGpt = mustReplace(ROUTER_SRC, 'return callAI({ prompt, temperature, maxTokens, model: MODEL_PRIMARY, signal, textNewsLengthPolicy, sanitizeScope, ...slimSystem(systemPrompt) });',
    'return callAI({ prompt, temperature, maxTokens, model: MODEL_PRIMARY, signal, textNewsLengthPolicy, sanitizeScope });', 'H2 gpt');
  await assert.rejects(async () => assertRouterSlim(await loadRouter({ routerSrc: noGpt })));
});

test('H3 taskSystemPrompt เสียการ์ด write (ถอดเงื่อนไข task === \'write\') + ตารางมี write / ค่าเริ่มต้นครอบทุก task → system นักเขียนถูกแตะ ต้องถูกจับ', async () => {
  const GUARD = "if (callerSystemPrompt || task === 'write' || !isSystemPromptSlim()) return callerSystemPrompt;";
  const noGuard = mustReplace(TSP_SRC, GUARD, 'if (callerSystemPrompt || !isSystemPromptSlim()) return callerSystemPrompt;', 'H3 guard');
  // (ก) ถอดการ์ด + ใครสักคนเติม write เข้าตาราง
  const tableWrite = mustReplace(noGuard, '  analyze: RESEARCH_SYSTEM_PROMPT,\n});', '  analyze: RESEARCH_SYSTEM_PROMPT,\n  write: EXTRACT_SYSTEM_PROMPT,\n});', 'H3 table');
  await assert.rejects(async () => assertWriteUntouched(await loadRouter({ tspSrc: tableWrite })));
  // (ข) ถอดการ์ด + ค่าเริ่มต้นครอบทุก task
  const catchAll = mustReplace(noGuard, 'return TASK_SYSTEM_PROMPT[task];', 'return TASK_SYSTEM_PROMPT[task] || BREAKDOWN_SYSTEM_PROMPT;', 'H3 catch-all');
  await assert.rejects(async () => assertWriteUntouched(await loadRouter({ tspSrc: catchAll })));
  // การ์ดยังอยู่ = ต่อให้ตารางมี write ก็ไม่แทรก (พิสูจน์ว่าการ์ดคือด่านจริง)
  const tableWriteGuarded = mustReplace(TSP_SRC, '  analyze: RESEARCH_SYSTEM_PROMPT,\n});', '  analyze: RESEARCH_SYSTEM_PROMPT,\n  write: EXTRACT_SYSTEM_PROMPT,\n});', 'H3 guarded');
  await assertWriteUntouched(await loadRouter({ tspSrc: tableWriteGuarded }));
});

test('H4 slimSystem ไม่สนสวิตช์ (SYSTEM_PROMPT_SLIM=0 ยังส่ง) → โหมดถอยไม่คืน args เดิม ต้องถูกจับทั้ง router และ L3B', async () => {
  const m = mustReplace(TSP_SRC, 'if (!systemPrompt || !isSystemPromptSlim()) return {};', 'if (!systemPrompt) return {};', 'H4');
  await assert.rejects(async () => assertRouterLegacy(await loadRouter({ tspSrc: m })));
  await assert.rejects(async () => assertL3bSlim(await loadCorrect({ tspSrc: m })));
});

test('H5 callGemini ทิ้ง systemPrompt (systemInstruction ฝังเสมอ) ต้องถูกจับ', async () => {
  const BT = String.fromCharCode(96);
  const m = mustReplace(GEMINI_SRC, 'systemInstruction: systemPrompt || ' + BT, 'systemInstruction: ' + BT, 'H5');
  await assert.rejects(async () => assertGeminiHonorsSystem(await loadGemini(m)));
});

test('H6 L3B ไม่ส่ง system สั้น ต้องถูกจับ', async () => {
  const m = mustReplace(CORRECT_SRC, /\n\s*\.\.\.slimSystem\(CORRECTION_RISK_REWRITE_SYSTEM_PROMPT\),[^\n]*\n/u, '\n', 'H6');
  await assert.rejects(async () => assertL3bSlim(await loadCorrect({ correctSrc: m })));
});

test('H7 ซอร์ส: breakdown sol ไม่ส่ง system สั้น / นักเขียนส่ง systemPrompt ต้องถูกจับ', () => {
  const noBreakdown = mustReplace(TEXT_SRC, ", ...slimSystem(BREAKDOWN_SYSTEM_PROMPT) }),\n          200000,", ' }),\n          200000,', 'H7 breakdown');
  assert.throws(() => assertTextWiring(noBreakdown));
  const writerLeak = mustReplace(TEXT_SRC, "callSmartAI('write', { prompt: multiPrompt,", "callSmartAI('write', { prompt: multiPrompt, ...slimSystem(BREAKDOWN_SYSTEM_PROMPT),", 'H7 writer');
  assert.throws(() => assertTextWiring(writerLeak));
});
