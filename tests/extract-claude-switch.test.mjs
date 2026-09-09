// 🔏 ข้อสอบสวิตช์ขั้นสกัดข้อเท็จจริง: EXTRACT_PRIMARY=claude → claude-opus-4-8 นำ chain (9 ก.ย. 69 เจ้าของสั่ง)
// ค่าเริ่มต้น (ไม่ตั้ง env) ต้องเป็นพฤติกรรมเดิมทุกไบต์: chain = ['gemini','gpt4o'] ไม่มีการเรียก callClaude
// รัน Router จริงด้วย fake clients — ไม่มี API/network (แม่แบบเดียวกับ tests/writer-fable-switch.test.mjs)
//
// วิธีรัน:      node --test tests/extract-claude-switch.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่าข้อสอบกัดจริง — เทสต้องแดง):
//   EXTRACT_SWITCH_TEST_MUTATION=no-env-guard        ถอดเงื่อนไข env (สวิตช์เปิดตลอด)
//   EXTRACT_SWITCH_TEST_MUTATION=order-swap          สลับลำดับ claude-extract ไปท้าย gemini
//   EXTRACT_SWITCH_TEST_MUTATION=leak-length-policy  ส่ง textNewsLengthPolicy เข้า callClaude
//   EXTRACT_SWITCH_TEST_MUTATION=hardcoded-model     ล็อกโมเดลตายตัว ไม่อ่าน EXTRACT_CLAUDE_MODEL
// รอบแก้ 1 (9 ก.ย. 69 · finding M1/M2/L1 ผู้ตรวจอิสระ) เพิ่ม 2 โหมด:
//   EXTRACT_SWITCH_TEST_MUTATION=no-extract-system   ถอด systemPrompt เฉพาะขั้นสกัด (กลับไปได้ system สายเขียน)
//   EXTRACT_SWITCH_TEST_MUTATION=no-extract-effort   ถอด effort รายนัด (กลับไปผูก CLAUDE_WRITE_EFFORT)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const importTemp = async (relativePath, source) => {
  const url = new URL(relativePath, import.meta.url);
  writeFileSync(url, source);
  try {
    return await import(url.href + '?t=' + Date.now() + Math.random());
  } finally {
    rmSync(url, { force: true });
  }
};

const mustReplace = (src, from, to, label) => {
  const out = typeof from === 'string' ? src.replace(from, to) : src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};

// ── สร้าง Router จริง + stub 3 client (บันทึกทุก call ลง globalThis.__XCALLS__) ──
let routerSource = readFileSync(new URL('../src/lib/ai/aiRouter.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
routerSource = mustReplace(routerSource,
  "import { callClaude, isClaudeAvailable } from './claudeClient.js';", `
const isClaudeAvailable = () => globalThis.__X_CLAUDE_AVAILABLE__ !== false;
const callClaude = async (args) => {
  globalThis.__XCALLS__.push({ fn: 'claude', ...args });
  const plan = globalThis.__X_CLAUDE_PLAN__.shift() || 'ok';
  if (plan === 'throw') throw new Error('mock-claude-down');
  if (plan === 'null') return null;
  if (plan === 'empty-string') return '';
  return { news_title: 'จาก claude', news_body: 'เนื้อจาก claude ยาวพอเกณฑ์', _modelUsed: args.model };
};`, 'stub claudeClient');
routerSource = mustReplace(routerSource, /import \{ callGemini[^\n]*\n/, `
const isGeminiAvailable = () => globalThis.__X_GEMINI_AVAILABLE__ !== false;
const callGemini = async (args) => {
  globalThis.__XCALLS__.push({ fn: 'gemini', ...args });
  const plan = globalThis.__X_GEMINI_PLAN__.shift() || 'ok';
  if (plan === 'throw') throw new Error('mock-gemini-down');
  return { news_title: 'จาก gemini', news_body: 'เนื้อจาก gemini ยาวพอเกณฑ์', _modelUsed: 'gemini-3.6-flash' };
};
`, 'stub geminiClient');
routerSource = mustReplace(routerSource,
  "import { callAI } from './openai.js';", `
const callAI = async (args) => {
  globalThis.__XCALLS__.push({ fn: 'gpt', ...args });
  const plan = globalThis.__X_GPT_PLAN__.shift() || 'ok';
  if (plan === 'throw') throw new Error('mock-gpt-down');
  return { news_title: 'จาก gpt', news_body: 'เนื้อจาก gpt ยาวพอเกณฑ์', _modelUsed: args.model };
};`, 'stub openai');
routerSource = mustReplace(routerSource, /import \{ MODEL_PRIMARY[^\n]*\n/, "const MODEL_PRIMARY = 'gpt-5.6-sol';\n", 'stub modelConfig');

// ── โหมดกลายพันธุ์ (ใช้พิสูจน์ว่าข้อสอบกัด — ปกติไม่ตั้ง = โค้ดจริงล้วน) ──
const MUTATION = process.env.EXTRACT_SWITCH_TEST_MUTATION || '';
if (MUTATION === 'no-env-guard') {
  routerSource = mustReplace(routerSource,
    "if (process.env.EXTRACT_PRIMARY === 'claude' && isClaudeAvailable()) {",
    'if (isClaudeAvailable()) {', 'mutation no-env-guard');
} else if (MUTATION === 'order-swap') {
  routerSource = mustReplace(routerSource,
    "        chain.push('claude-extract');\n      }\n      if (isGeminiAvailable()) chain.push('gemini');",
    "      }\n      if (isGeminiAvailable()) chain.push('gemini');\n      if (process.env.EXTRACT_PRIMARY === 'claude' && isClaudeAvailable()) chain.push('claude-extract');",
    'mutation order-swap');
} else if (MUTATION === 'leak-length-policy') {
  routerSource = mustReplace(routerSource,
    'prompt, temperature, maxTokens, signal,\n        systemPrompt: systemPrompt || EXTRACT_CLAUDE_SYSTEM_PROMPT,',
    'prompt, temperature, maxTokens, signal, textNewsLengthPolicy,\n        systemPrompt: systemPrompt || EXTRACT_CLAUDE_SYSTEM_PROMPT,',
    'mutation leak-length-policy');
} else if (MUTATION === 'no-extract-system') {
  // รอบแก้ 1 (M1): ถอด systemPrompt เฉพาะขั้นสกัด — กลับไปส่งค่าจาก caller (undefined = system สายเขียน)
  routerSource = mustReplace(routerSource,
    'systemPrompt: systemPrompt || EXTRACT_CLAUDE_SYSTEM_PROMPT,',
    'systemPrompt,', 'mutation no-extract-system');
} else if (MUTATION === 'no-extract-effort') {
  // รอบแก้ 1 (M2): ถอด effort รายนัด — กลับไปผูก CLAUDE_WRITE_EFFORT ของสายเขียน
  routerSource = mustReplace(routerSource,
    "effort: process.env.EXTRACT_CLAUDE_EFFORT || 'medium',\n        ",
    '', 'mutation no-extract-effort');
} else if (MUTATION === 'hardcoded-model') {
  routerSource = mustReplace(routerSource,
    "model: process.env.EXTRACT_CLAUDE_MODEL || 'claude-opus-4-8',",
    "model: 'claude-opus-4-8',", 'mutation hardcoded-model');
} else if (MUTATION) {
  throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
}
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const router = await importTemp('../src/lib/ai/_extract-switch-under-test.tmp.mjs', routerSource);
const callSmartAI = router.callSmartAI;

// ── เครื่องมือ: reset โลก + ดัก console.log เพื่ออ่าน chain จริงจากบรรทัด Cascading Chain ──
const reset = ({ claude = [], gemini = [], gpt = [], claudeAvailable = true, geminiAvailable = true } = {}) => {
  globalThis.__XCALLS__ = [];
  globalThis.__X_CLAUDE_PLAN__ = [...claude];
  globalThis.__X_GEMINI_PLAN__ = [...gemini];
  globalThis.__X_GPT_PLAN__ = [...gpt];
  globalThis.__X_CLAUDE_AVAILABLE__ = claudeAvailable;
  globalThis.__X_GEMINI_AVAILABLE__ = geminiAvailable;
  delete process.env.EXTRACT_PRIMARY;
  delete process.env.EXTRACT_CLAUDE_MODEL;
  delete process.env.EXTRACT_CLAUDE_EFFORT;
  delete process.env.CLAUDE_WRITE_EFFORT;
};

const runExtract = async (opts = {}) => {
  const logs = [];
  const origLog = console.log; const origWarn = console.warn; const origError = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  let out, err;
  try { out = await callSmartAI('extract', { prompt: 'x', ...opts }); }
  catch (e) { err = e; }
  finally { console.log = origLog; console.warn = origWarn; console.error = origError; }
  const chainLine = logs.find((l) => l.includes('Cascading Chain:')) || '';
  const m = chainLine.match(/Cascading Chain: \[(.*)\]/);
  const chain = m ? m[1].split(' ➡️ ') : [];
  return { out, err, logs, chain };
};
const calls = () => globalThis.__XCALLS__;

// ═══ 1) ไม่ตั้ง env = พฤติกรรมเดิมทุกไบต์ ═══
test('1 ไม่ตั้ง env → chain = [gemini, gpt4o] เดิมเป๊ะ และไม่มีการเรียก callClaude', async () => {
  reset();
  const { out, chain } = await runExtract();
  assert.deepEqual(chain, ['gemini', 'gpt4o'], 'chain ต้องเท่าของเดิมทุกตัว');
  assert.equal(calls().some((c) => c.fn === 'claude'), false, 'ห้ามเรียก callClaude เมื่อไม่ตั้ง env');
  assert.equal(calls()[0].fn, 'gemini');
  assert.equal(calls()[0].temperature, 0.2, 'defaultTemp เดิม 0.2');
  assert.equal(calls()[0].maxTokens, 4000, 'defaultMaxTokens เดิม 4000');
  assert.equal(out.model, 'gemini-3.6-flash');
});

// ═══ 2) EXTRACT_PRIMARY=claude → claude นำ · สำเร็จแล้วไม่แตะ gemini ═══
test('2 เปิดสวิตช์ → callClaude ก่อนด้วย claude-opus-4-8 temp 0.2 maxTokens 4000 ไม่มี textNewsLengthPolicy · ไม่เรียก gemini', async () => {
  reset();
  process.env.EXTRACT_PRIMARY = 'claude';
  const { out, chain, logs } = await runExtract();
  assert.deepEqual(chain, ['claude-extract', 'gemini', 'gpt4o'], 'gemini→gpt4o ต้องยังเป็นตัวสำรองตามลำดับเดิม');
  assert.equal(calls().length, 1, 'สำเร็จครั้งแรกต้องจบ ไม่เรียกตัวสำรอง');
  const c = calls()[0];
  assert.equal(c.fn, 'claude');
  assert.equal(c.model, 'claude-opus-4-8');
  assert.equal(c.temperature, 0.2);
  assert.equal(c.maxTokens, 4000);
  assert.equal('textNewsLengthPolicy' in c, false, 'ห้ามส่ง textNewsLengthPolicy (สิทธิ์สายเขียน TEXT เท่านั้น)');
  assert.equal(out.model, 'claude-opus-4-8', 'usedModel ที่ logPipeline ใช้ต้องเป็นโมเดลจริง');
  assert.ok(logs.includes('[SmartAI] extract primary = claude-opus-4-8 (EXTRACT_PRIMARY=claude)'),
    'ต้องมี log บรรทัดประกาศสวิตช์ตามสเปก');
});

// ═══ 3) claude ล้ม → ตกไป gemini แล้ว gpt4o ตามลำดับเดิม ═══
test('3.1 claude throw → gemini รับช่วง', async () => {
  reset({ claude: ['throw'] });
  process.env.EXTRACT_PRIMARY = 'claude';
  const { out } = await runExtract();
  assert.deepEqual(calls().map((c) => c.fn), ['claude', 'gemini']);
  assert.equal(out.model, 'gemini-3.6-flash');
});

test('3.2 claude คืนผลว่าง (null) → ต้อง throw ภายในแล้วตกไป gemini', async () => {
  reset({ claude: ['null'] });
  process.env.EXTRACT_PRIMARY = 'claude';
  const { out } = await runExtract();
  assert.deepEqual(calls().map((c) => c.fn), ['claude', 'gemini']);
  assert.equal(out.model, 'gemini-3.6-flash');
});

test('3.3 claude คืนผลว่าง (สตริงเปล่า) → ตกไป gemini', async () => {
  reset({ claude: ['empty-string'] });
  process.env.EXTRACT_PRIMARY = 'claude';
  const { out } = await runExtract();
  assert.deepEqual(calls().map((c) => c.fn), ['claude', 'gemini']);
  assert.equal(out.model, 'gemini-3.6-flash');
});

test('3.4 claude + gemini ล้มทั้งคู่ → gpt4o ปิดท้ายตามลำดับ', async () => {
  reset({ claude: ['throw'], gemini: ['throw'] });
  process.env.EXTRACT_PRIMARY = 'claude';
  const { out } = await runExtract();
  assert.deepEqual(calls().map((c) => c.fn), ['claude', 'gemini', 'gpt'], 'ลำดับต้อง claude→gemini→gpt4o');
  assert.equal(out.model, 'gpt-5.6-sol');
});

// ═══ 4) เทียบตรงตัวเท่านั้น — ค่าเพี้ยนทุกแบบต้องไม่เปิดสวิตช์ ═══
for (const bad of ['Claude', '1', ' claude']) {
  test(`4 EXTRACT_PRIMARY=${JSON.stringify(bad)} → ไม่เปิดสวิตช์ chain เดิมเป๊ะ`, async () => {
    reset();
    process.env.EXTRACT_PRIMARY = bad;
    const { chain } = await runExtract();
    assert.deepEqual(chain, ['gemini', 'gpt4o']);
    assert.equal(calls().some((c) => c.fn === 'claude'), false);
  });
}

// ═══ 5) EXTRACT_CLAUDE_MODEL ทับโมเดลได้ ═══
test('5 EXTRACT_CLAUDE_MODEL=claude-fable-5 → เรียกโมเดลนั้นจริง', async () => {
  reset();
  process.env.EXTRACT_PRIMARY = 'claude';
  process.env.EXTRACT_CLAUDE_MODEL = 'claude-fable-5';
  const { out } = await runExtract();
  assert.equal(calls()[0].model, 'claude-fable-5');
  assert.equal(out.model, 'claude-fable-5');
});

// ═══ 6) ไม่มี ANTHROPIC key → สวิตช์เปิดก็ต้องไม่พัง chain เดิม ═══
test('6 เปิดสวิตช์แต่ isClaudeAvailable=false → chain เดิม ไม่เรียก claude', async () => {
  reset({ claudeAvailable: false });
  process.env.EXTRACT_PRIMARY = 'claude';
  const { chain } = await runExtract();
  assert.deepEqual(chain, ['gemini', 'gpt4o']);
  assert.equal(calls().some((c) => c.fn === 'claude'), false);
});

// ═══ 7) รอบแก้ 1 (M1+L1) — systemPrompt เฉพาะขั้นสกัด: กฎสกัดล้วน ไม่มีกฎสายเขียน/wordlist + maxRetries 0 + ส่งต่อ signal เดิม ═══
test('7 claude-extract ส่ง systemPrompt กฎสกัด (ห้ามแต่งเรื่อง+JSON) ไม่มี FACEBOOK SAFETY / HUMAN WRITING DNA / hook · maxRetries=0 · signal เดิม', async () => {
  reset();
  process.env.EXTRACT_PRIMARY = 'claude';
  const ac = new AbortController();
  await runExtract({ signal: ac.signal });
  const c = calls()[0];
  assert.equal(c.fn, 'claude');
  assert.equal(typeof c.systemPrompt, 'string', 'ต้องส่ง systemPrompt เฉพาะขั้นสกัดเสมอ (ไม่ส่ง = ได้ system สายเขียนของ claudeClient)');
  // ต้องมี: บทบาทผู้สกัด + กฎยกตรงจาก claudeClient (ห้ามแต่งเรื่อง / JSON เท่านั้น)
  assert.ok(c.systemPrompt.includes('ผู้สกัดข้อเท็จจริง'), 'บทบาทผู้สกัดข้อเท็จจริง');
  assert.ok(c.systemPrompt.includes('[กฎที่ 2: ห้ามแต่งเรื่อง]'), 'กฎห้ามแต่งเรื่องต้องอยู่ครบ');
  assert.ok(c.systemPrompt.includes('ต้องตรงกับข่าวต้นฉบับ 100%'), 'กฎยึดต้นฉบับต้องอยู่ครบ');
  assert.ok(c.systemPrompt.includes('[กฎที่ 4: JSON เท่านั้น]'), 'กฎ JSON ต้องอยู่ครบ');
  assert.ok(c.systemPrompt.includes('ตอบเป็น JSON เท่านั้น'), 'คำสั่ง JSON ต้องอยู่ครบ');
  // ห้ามมี: กฎสายเขียน + wordlist (ต้นเหตุ euphemize ขั้นสกัด + โทเคนเข้า ~5,000/นัด)
  assert.equal(c.systemPrompt.includes('FACEBOOK SAFETY'), false, 'ห้ามมี FACEBOOK SAFETY wordlist ในขั้นสกัด');
  assert.equal(c.systemPrompt.includes('ห้ามใช้คำเสี่ยง'), false, 'ห้ามมีรายการคำเสี่ยง/คำแทนในขั้นสกัด');
  assert.equal(c.systemPrompt.includes('HUMAN WRITING DNA'), false, 'ห้ามมีกฎนักเขียนในขั้นสกัด');
  assert.equal(c.systemPrompt.includes('hook'), false, 'ห้ามมีกฎโครงสร้าง hook (กฎที่ 5 สายเขียน)');
  assert.equal(c.systemPrompt.includes('กฎที่ 5'), false, 'กฎที่ 5-6 เป็นของสายเขียนเท่านั้น');
  // L1: ล็อก SDK retry + เคารพ signal จากชั้นนอก (withTimeoutSignal)
  assert.equal(c.maxRetries, 0, 'maxRetries ต้องเป็น 0 กัน SDK retry ซ้อนกินงบ stage');
  assert.equal(c.signal, ac.signal, 'ต้องส่งต่อ signal เดิมไม่เปลี่ยน');
});

// ═══ 8) รอบแก้ 1 (M2) — effort ขั้นสกัดแยกขาดจาก CLAUDE_WRITE_EFFORT สายเขียน ═══
test('8.1 ไม่ตั้ง EXTRACT_CLAUDE_EFFORT → effort=medium แม้ CLAUDE_WRITE_EFFORT=high (ไม่ผูกสายเขียน)', async () => {
  reset();
  process.env.EXTRACT_PRIMARY = 'claude';
  process.env.CLAUDE_WRITE_EFFORT = 'high'; // จูนสายเขียน — ขั้นสกัดต้องไม่เปลี่ยนตามเงียบๆ
  await runExtract();
  assert.equal(calls()[0].effort, 'medium', 'ต้องส่ง effort รายนัด = medium (per-call ชนะ env ใน callClaude)');
});

test('8.2 EXTRACT_CLAUDE_EFFORT=high → ส่ง effort=high', async () => {
  reset();
  process.env.EXTRACT_PRIMARY = 'claude';
  process.env.EXTRACT_CLAUDE_EFFORT = 'high';
  await runExtract();
  assert.equal(calls()[0].effort, 'high');
});
