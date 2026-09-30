// ============================================================
// 🧪 tests/breakdown-single-fallback-mc05.test.mjs — ขั้นแตกประเด็น (breakdown) มีเจ้าของ fallback ชั้นเดียว
// ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ) — MC-05 / PL-20 / OV-14 / CFG-09 (เลน D · T5)
// ------------------------------------------------------------
// บั๊กที่ปิด (ผู้ตรวจ 6 คนยืนยันด้วยการจำลองออฟไลน์จากโค้ดจริง) — src/lib/services/summarizeServiceText.js กิ่ง breakdown:
//   ชั้น 1 SDK retry ค่าเริ่มต้น 2 ครั้ง (ไม่ส่ง maxRetries) × ชั้น 2 callAI สลับรุ่นเอง (allowModelFallback ค่าเริ่มต้น true:
//   sol→[sol,terra] · terra→[terra,sol]) × ชั้น 3 catch ของ service เรียก terra ซ้ำ → พรอมต์เดิมถูกยิง sol→terra→terra→sol ได้ 4 นัด
//   (HTTP 5xx ล้วน = 12 request) · CFG-09 คอมเมนต์งบ autoFlowServiceText บอก "gpt-5.5 200s + gpt-4o 60s + เผื่อ 40s" (จริง 200+90 เหลือ ~10s)
// แก้: ค่าเริ่มต้นส่ง allowModelFallback:false + maxRetries:0 ให้ทั้ง sol และ terra (แบบ writer-sol ใน aiRouter) → sol 1 นัด → terra 1 นัด จบ
//   ถอยกลับ: BREAKDOWN_SINGLE_FALLBACK=0 (0/off/false/no/legacy) = args เดิมทุกไบต์
//
// วิธีทดสอบ (ไม่มี API/network · ไม่เขียนไฟล์ลง src — โหลดสำเนาผ่าน tests/helpers/temp-module.mjs):
//   - กิ่ง breakdown ตัดจากซอร์สจริง (แบบ tests/fact-source-policy-s9) รันด้วย dependency จริง: callAI = openai.js จริง + OpenAI SDK จริง
//     (fetch ถูกแทนด้วยเซิร์ฟเวอร์ปลอมในหน่วยความจำ · baseURL 127.0.0.1:9 กันหลุด) · withTimeoutSignal/pipelineDeadline จริง ·
//     assertBreakdownAngleContract จริง · แม่แบบพรอมต์ + buildBreakdownPrompt + system สั้นจริง
//   - รูป production: runWithPipelineDeadline + withTimeoutSignal(300s,'breakdown') ชั้นนอกแบบ autoFlowServiceText (stage signal ลงกิ่ง)
//   - เวลา (กติกา CI node 22): เส้นตายรวม = manualPipelineDeadline (tests/helpers/fake-deadline.mjs) · timer ≥60s (stage 300s · sol 200s ·
//     terra 90s · timeout 600s ของ SDK) ถูกแทนเป็น timer มือที่เทสกดยิงเอง — ไม่มีการรอเวลาจริง · ทุก await ที่อาจค้างครอบ settleWithin
//     (timer ref ค้ำ loop) · ไม่เรียก unref · SDK retry: เซิร์ฟเวอร์ปลอมตอบ 5xx พร้อม retry-after-ms: 0 → SDK sleep(0) แล้วยิงซ้ำตามจริง
//
// สิ่งที่ล็อกไว้:
//   A. สวิตช์: ไม่ตั้ง/ว่าง/ค่าอื่น = ใหม่ · 0/off/false/no/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย
//   B. เวลา (รูป production): B1 โจทย์หลัก sol หมดเวลา 200s → terra ถูกเรียก 1 ครั้งเท่านั้น · B2 sol หมดเวลา + terra 5xx (ถอย = วน sol ซ้ำ) ·
//      B3 ทางไม่มี abort (ถอย = terra ถูกยิงซ้ำเบื้องหลังหลังขั้นจบแล้ว) · B4 เส้นตายรวมหมดระหว่าง sol = ไม่เริ่ม terra
//   C. ล้มเร็ว 6 สถานการณ์ × 2 โหมด: ใหม่ ≤ sol 1 + terra 1 และ args มีสองคีย์ · ถอย = ลำดับเดิมตามผลจำลองของผู้ตรวจ + args เดิมทุกไบต์
//   D. ซอร์ส: สอง call spread _bdCallGuard · ตัวอ่านสวิตช์จุดเดียว · คอมเมนต์งบ autoFlow ตรงตัวเลขจริงในซอร์ส (CFG-09)
//   E. mutation 6 แบบ (แก้เฉพาะสำเนาในหน่วยความจำ · ต้องแดงทุกตัว)
//
// วิธีรัน:  node --test tests/breakdown-single-fallback-mc05.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';
import { manualPipelineDeadline, settleWithin } from './helpers/fake-deadline.mjs';
import { runWithPipelineDeadline, rethrowPipelineDeadline, isPipelineDeadlineError } from '../src/lib/utils/pipelineDeadline.js';
import { withTimeoutSignal } from '../src/lib/utils/withTimeout.js';
import { getPrompt } from '../src/lib/ai/promptStoreText.js';
import { slimSystem, BREAKDOWN_SYSTEM_PROMPT } from '../src/lib/ai/taskSystemPrompts.js';
import { buildBreakdownPrompt } from '../src/lib/ai/factSourcePolicy.js';

const SOL = 'gpt-5.6-sol';
const TERRA = 'gpt-5.6-terra';
const srcUrl = (rel) => new URL(rel, import.meta.url);
const readSrc = (rel) => readFileSync(srcUrl(rel), 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
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
const silenceConsole = () => {
  const prior = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.debug = () => {};
  return () => Object.assign(console, prior);
};

const TEXT_SRC = readSrc('../src/lib/services/summarizeServiceText.js');
const AUTO_SRC = readSrc('../src/lib/services/autoFlowServiceText.js');
const OPENAI_SRC = readSrc('../src/lib/ai/openai.js');

// env ที่อาจเปลี่ยนผล — ล็อกเป็นค่าเริ่มต้นของ production ระหว่างทดสอบ
const BASE_ENV = {
  WITHTIMEOUT_ABORT: undefined, SYSTEM_PROMPT_SLIM: undefined, SANITIZE_LEGACY: undefined, NARRATIVE_LEGACY: undefined,
  LOG_FULL_PROMPT: undefined, RISK_WORDS_LEGACY: undefined, LEGACY_LENGTH_RULES: undefined, OPENAI_LOG: undefined,
};
const NEW = { ...BASE_ENV, BREAKDOWN_SINGLE_FALLBACK: undefined };
const LEGACY = { ...BASE_ENV, BREAKDOWN_SINGLE_FALLBACK: '0' };
const MODES = { new: NEW, legacy: LEGACY };

// args ที่กิ่งส่งให้ callAI — ของเดิมก่อนแก้ (ลำดับคีย์เดิม) และของใหม่ (เพิ่มสองคีย์หลัง model · ไม่แทรกกลาง maxTokens→signal→sanitizeScope
// ที่ tests/safety-filter-word-boundary W1 · fact-source-policy-s9 E2 · system-prompt-slim-ov04 G1/H7 ล็อกรูปซอร์สไว้)
const OLD_KEYS = ['prompt', 'model', 'temperature', 'maxTokens', 'signal', 'sanitizeScope', 'systemPrompt'];
const NEW_KEYS = ['prompt', 'model', 'allowModelFallback', 'maxRetries', 'temperature', 'maxTokens', 'signal', 'sanitizeScope', 'systemPrompt'];

// ── ของจริงจากซอร์ส ────────────────────────────────────────────
function extractTopLevelFunction(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `ไม่พบ function marker: ${marker}`);
  const end = text.indexOf('\n}', start);
  assert.ok(end > start, `ไม่พบจุดจบ function: ${marker}`);
  return text.slice(start, end + 2);
}
const assertBreakdownAngleContract = new Function(
  `${extractTopLevelFunction(TEXT_SRC, 'export function assertBreakdownAngleContract(').replace('export function', 'function')}; return assertBreakdownAngleContract;`,
)();

/** กิ่ง breakdown ของ summarizeServiceText จริง (ตัดจากซอร์ส · รายชื่อ dependency เดียวกับ tests/fact-source-policy-s9) */
function makeBreakdownBranch(serviceSource = TEXT_SRC) {
  const start = serviceSource.indexOf("  if (mode === 'breakdown') {");
  const end = serviceSource.indexOf('  // ===== MODE: analyze', start);
  assert.ok(start >= 0 && end > start, 'ไม่พบกิ่ง breakdown ในซอร์ส');
  const body = [
    'return async function runBreakdown(args, deps) {',
    "  const { text, rawSourceText, newsTitle, customPrompt, workflowId, signal, mode = 'breakdown' } = args;",
    '  const { getPrompt, getWorkflow, withTimeoutSignal, callAI, MODEL_BREAKDOWN, MODEL_HEAVY_FALLBACK, slimSystem, BREAKDOWN_SYSTEM_PROMPT,',
    '    assertBreakdownAngleContract, rethrowPipelineDeadline, saveBreakdown, MasterAgent, logPipeline, buildBreakdownPrompt } = deps;',
    '  const _pipelineStart = Date.now();',
    serviceSource.slice(start, end),
    "  throw new Error('กิ่ง breakdown ไม่ return');",
    '};',
  ].join('\n');
  return new Function(body)();
}
const BRANCH = makeBreakdownBranch();

/** callAI ของ openai.js จริง + OpenAI SDK จริง — แทนเฉพาะ fetch (เซิร์ฟเวอร์ปลอม) · usageLogger (prisma) · คีย์ (ไม่ใช้ env) */
async function loadRealCallAI() {
  let s = OPENAI_SRC;
  s = mustReplace(s, "import { logApiUsage } from './usageLogger';", 'const logApiUsage = () => {};', 'stub usageLogger');
  s = mustReplace(s, "import { sanitizeOutput } from './safetyFilter';", "import { sanitizeOutput } from './safetyFilter.js';", 'safetyFilter .js');
  s = mustReplace(s, 'const apiKey = process.env.OPENAI_API_KEY;', "const apiKey = 'offline-test-no-network';", 'คีย์ปลอม ไม่อ่าน env');
  s = mustReplace(s, 'openaiClient = new OpenAI({ apiKey });',
    "openaiClient = new OpenAI({ apiKey, baseURL: 'http://127.0.0.1:9/v1', fetch: (url, init) => globalThis.__MC05_FETCH__(url, init) });",
    'SDK จริง + fetch ปลอม');
  assert.match(s, /^import OpenAI from 'openai';$/m, 'ต้องใช้ OpenAI SDK จริง (ชั้น SDK retry อยู่ในนั้น)');
  const mod = await importPatchedModule(s, srcUrl('../src/lib/ai/openai.js'), 'openai-mc05');
  return mod.callAI;
}
const realCallAI = await loadRealCallAI();

// ── เซิร์ฟเวอร์ปลอม (แทน fetch ของ SDK) ─────────────────────────
const angles = (n) => ({
  core_story: 'กระบะเสียหลักชนต้นไม้ คนขับเจ็บสาหัส',
  key_points: [{ point: 'ชนต้นไม้ริมถนนสาย 304' }, { point: 'คนขับวัย 45 ปีเจ็บสาหัส' }],
  best_main_angle: { angle_name: 'มุม 1', why_best: 'ใกล้ตัวคนขับทางไกล' },
  possible_angles: Array.from({ length: n }, (_, i) => ({ angle_name: `มุม ${i + 1}`, description: `คำอธิบายมุม ${i + 1}` })),
});
const completion = (model, content) => new Response(JSON.stringify({
  id: 'chatcmpl-mc05', object: 'chat.completion', created: 0, model,
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 7, completion_tokens: 7, total_tokens: 14 },
}), { status: 200, headers: { 'content-type': 'application/json' } });
const httpError = (status) => new Response(JSON.stringify({ error: { message: `upstream ปลอม ${status}`, type: 'server_error' } }),
  { status, headers: { 'content-type': 'application/json', 'retry-after-ms': '0' } });
function reply(kind, model) {
  switch (kind) {
    case 'ok4': return completion(model, JSON.stringify(angles(4)));
    case 'ok3': return completion(model, JSON.stringify(angles(3)));
    case 'ok5': return completion(model, JSON.stringify(angles(5)));
    case 'empty': return completion(model, ''); // โดนบิลแต่เนื้อว่าง (reasoning ใช้เพดานหมด)
    case '500': return httpError(500); // SDK retry ได้
    case '400': return httpError(400); // SDK ไม่ retry
    default: throw new Error('แผนเซิร์ฟเวอร์ไม่รู้จัก: ' + kind);
  }
}

/** plan = { [model]: [kind ของนัดที่ 1, นัดที่ 2, …] } (เกินความยาว = ใช้ตัวสุดท้าย) · 'hang' = ค้างจนถูก abort หรือเทส release */
function makeServer(plan) {
  const hits = [];
  const waiters = [];
  const count = (model) => hits.filter((h) => h.model === model).length;
  const notify = () => {
    for (const w of [...waiters]) if (w.pred()) { waiters.splice(waiters.indexOf(w), 1); w.resolve(); }
  };
  const headerOf = (headers, name) => (headers && typeof headers.get === 'function' ? headers.get(name) : headers?.[name]) ?? null;
  async function fetch(url, init) {
    const body = JSON.parse(init.body);
    const model = body.model;
    const seq = plan[model] || [];
    const n = count(model) + 1;
    const hit = {
      model, n, url: String(url), kind: seq[Math.min(n, seq.length) - 1],
      retryCount: headerOf(init.headers, 'x-stainless-retry-count'),
      maxCompletion: body.max_completion_tokens, system: body.messages?.[0]?.content, user: body.messages?.[1]?.content,
      aborted: false, release: null,
    };
    hits.push(hit);
    notify();
    if (hit.kind !== 'hang') return reply(hit.kind, model);
    return new Promise((resolve, reject) => {
      hit.release = (kind) => resolve(reply(kind, model));
      const onAbort = () => {
        hit.aborted = true;
        reject(init.signal.reason instanceof Error ? init.signal.reason : Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      if (init.signal?.aborted) onAbort(); else init.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
  const until = (pred, label) => settleWithin(new Promise((resolve) => {
    if (pred()) resolve(); else waiters.push({ pred, resolve });
  }), `รอเซิร์ฟเวอร์ปลอม: ${label}`, 5_000);
  return { fetch, hits, count, until, models: () => hits.map((h) => h.model) };
}

// ── timer มือสำหรับเพดานเวลายาว (≥60s) — เทสกดยิงเอง ไม่รอเวลาจริง ─────────
function installManualLongTimers(minMs = 60_000) {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const created = [];
  globalThis.setTimeout = function manualLongSetTimeout(callback, ms, ...args) {
    if (typeof callback === 'function' && Number(ms) >= minMs) {
      const timer = { ms: Number(ms), fired: false, cleared: false, callback: () => callback(...args) };
      created.push(timer);
      return timer;
    }
    return realSet(callback, ms, ...args);
  };
  globalThis.clearTimeout = function manualLongClearTimeout(timer) {
    if (created.includes(timer)) { timer.cleared = true; return undefined; }
    return realClear(timer);
  };
  const live = (ms) => created.filter((t) => t.ms === ms && !t.fired && !t.cleared);
  return {
    created,
    live,
    fire(ms) {
      const pending = live(ms);
      assert.equal(pending.length, 1, `ต้องมี timer ${ms}ms ค้างอยู่ 1 ตัวพอดีก่อนเทสกดยิง (มี ${pending.length})`);
      pending[0].fired = true;
      pending[0].callback();
    },
    restore() { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; },
  };
}

// ── ตัวรันกิ่ง ───────────────────────────────────────────────
const NEWS = {
  title: 'กระบะเสียหลักชนต้นไม้สาย 304 คนขับเจ็บสาหัส',
  raw: 'รถกระบะเสียหลักชนต้นไม้ริมถนนสาย 304 ช่วง อ.กบินทร์บุรี คนขับวัย 45 ปี บาดเจ็บสาหัส กู้ภัยนำส่ง รพ.เจ้าพระยาอภัยภูเบศร เหตุเกิดคืนวันที่ 14 ก.ย. ตำรวจสันนิษฐานว่าหลับใน',
  extracted: 'รถกระบะเสียหลักชนต้นไม้ริมถนนสาย 304 ช่วง อ.กบินทร์บุรี คนขับวัย 45 ปี บาดเจ็บหนัก กู้ภัยนำส่ง รพ.เจ้าพระยาอภัยภูเบศร เหตุเกิดคืนวันที่ 14 ก.ย. ตำรวจสันนิษฐานว่าหลับใน',
};

/**
 * รันกิ่ง breakdown จริง 1 รอบ
 * production=true: runWithPipelineDeadline(manual) + withTimeoutSignal(300s,'breakdown') ชั้นนอก ส่ง stage signal ลงกิ่ง (แบบ autoFlowServiceText)
 * production=false: เรียกกิ่งตรง signal ไม่มี ไม่มีเส้นตาย (ทาง withTimeout แบบไม่ abort)
 * drive({server,timers,manual,outcome}) = ขั้นตอนของสถานการณ์ (กดยิง timer/ปล่อย request) — await ทุกตัวต้องผ่าน settleWithin
 */
async function runBreakdown({ plan, branch = BRANCH, production = true, remainingMs = 700_000, drive = async () => {} }) {
  const server = makeServer(plan);
  const timers = installManualLongTimers();
  const calls = [];
  const logs = [];
  globalThis.__MC05_FETCH__ = server.fetch;
  const deps = {
    getPrompt,
    getWorkflow: async () => null,
    withTimeoutSignal,
    callAI: (args) => {
      const promise = realCallAI(args);
      promise.catch(() => {});
      calls.push({ args: { ...args }, keys: Object.keys(args), promise });
      return promise;
    },
    MODEL_BREAKDOWN: SOL, MODEL_HEAVY_FALLBACK: TERRA,
    slimSystem, BREAKDOWN_SYSTEM_PROMPT,
    assertBreakdownAngleContract, rethrowPipelineDeadline,
    saveBreakdown: async () => {}, MasterAgent: class {}, logPipeline: async (entry) => { logs.push(entry); },
    buildBreakdownPrompt,
  };
  const args = { text: NEWS.extracted, rawSourceText: NEWS.raw, newsTitle: NEWS.title, customPrompt: '', workflowId: undefined };
  const restoreConsole = silenceConsole();
  try {
    let manual = null;
    let run;
    if (production) {
      manual = manualPipelineDeadline(remainingMs);
      run = runWithPipelineDeadline(manual.deadline,
        () => withTimeoutSignal((stageSignal) => branch({ ...args, signal: stageSignal }, deps), 300000, 'breakdown'));
    } else {
      run = branch({ ...args, signal: undefined }, deps);
    }
    const outcome = run.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
    await drive({ server, timers, manual, outcome });
    const settled = await settleWithin(outcome, 'กิ่ง breakdown ต้องจบ (สำเร็จหรือล้ม) ไม่ค้าง', 5_000);
    // request ที่วิ่งเบื้องหลัง (ทาง withTimeout ไม่ abort) ต้องจบก่อนนับ — กันนับขาด
    await settleWithin(Promise.allSettled(calls.map((c) => c.promise)), 'callAI ทุกนัด (รวมที่วิ่งเบื้องหลัง) ต้องจบ', 5_000);
    return { ...settled, hits: server.hits, models: server.models(), count: server.count, calls, logs, timers };
  } finally {
    restoreConsole();
    timers.restore();
    delete globalThis.__MC05_FETCH__;
  }
}

/** ตรวจ args ของทุกนัดที่กิ่งส่งให้ callAI + ตรวจ request ที่ถึง SDK จริง (พรอมต์เดียวกัน · เพดาน 24000 · system สั้น) */
function assertArgs(res, mode, label) {
  assert.ok(res.calls.length >= 1, `${label}: ต้องมีการเรียก callAI`);
  for (const [i, c] of res.calls.entries()) {
    const tag = `${label} callAI #${i + 1} (${c.args.model})`;
    if (mode === 'new') {
      assert.deepEqual(c.keys, NEW_KEYS, `${tag}: โหมดใหม่ args = ชุดเดิม + allowModelFallback/maxRetries หลัง model`);
      assert.equal(c.args.allowModelFallback, false, `${tag}: ห้ามให้ callAI สลับรุ่นเอง`);
      assert.equal(c.args.maxRetries, 0, `${tag}: ห้ามให้ SDK retry`);
    } else {
      assert.deepEqual(c.keys, OLD_KEYS, `${tag}: โหมดถอย args ต้องเดิมทุกไบต์ (ไม่มีสองคีย์ใหม่)`);
    }
    assert.equal(c.args.temperature, 0.4, tag);
    assert.equal(c.args.maxTokens, 24000, tag);
    assert.equal(c.args.sanitizeScope, 'facts', `${tag}: args S1 คงเดิม`);
    assert.equal(c.args.systemPrompt, BREAKDOWN_SYSTEM_PROMPT, `${tag}: args S8 คงเดิม`);
    assert.equal(c.args.prompt, res.calls[0].args.prompt, `${tag}: พรอมต์เดียวกันทุกนัด`);
  }
  assert.deepEqual(res.calls.map((c) => c.args.model).slice(0, 1), [SOL], `${label}: นัดแรกของ service = sol`);
  for (const h of res.hits) {
    assert.equal(h.url, 'http://127.0.0.1:9/v1/chat/completions', `${label}: เซิร์ฟเวอร์ปลอมเท่านั้น`);
    assert.equal(h.maxCompletion, 24000, `${label}: max_completion_tokens`);
    assert.equal(h.system, BREAKDOWN_SYSTEM_PROMPT, `${label}: system สั้นงานแตกประเด็น`);
    assert.equal(h.user, res.hits[0].user, `${label}: request ทุกตัวใช้พรอมต์เดิม`);
  }
}

// ── สถานการณ์ล้มเร็ว (ไม่มี timeout · ไม่มี request ค้าง) — ใช้เป็น oracle ของ mutation ได้ (แดงเร็ว ไม่ค้าง) ─────────
//   ลำดับ "ถอย" = ผลจำลองของผู้ตรวจใน ledger (MC-05 S1/S2 · PL-20 B/C · OV-14 A) บวกชั้น SDK retry จริง
const FAST = [
  { name: 'happy: sol ตอบ 4 มุม', plan: { [SOL]: ['ok4'] },
    new: { models: [SOL], ok: true }, legacy: { models: [SOL], ok: true } },
  { name: 'sol ผิดสัญญา 5 มุม → terra ตอบ 4 มุม (ทาง fallback ตามสัญญายังอยู่)', plan: { [SOL]: ['ok5'], [TERRA]: ['ok4'] },
    new: { models: [SOL, TERRA], ok: true }, legacy: { models: [SOL, TERRA], ok: true } },
  { name: 'HTTP 500 ทุกนัด (OV-14 A · ซ้อน 3 ชั้น)', plan: { [SOL]: ['500'], [TERRA]: ['500'] },
    new: { models: [SOL, TERRA], ok: false, error: /500/ },
    legacy: { models: [SOL, SOL, SOL, TERRA, TERRA, TERRA, TERRA, TERRA, TERRA, SOL, SOL, SOL], ok: false, error: /OpenAI call failed for all models/ } },
  { name: 'sol ตอบว่าง(โดนบิล) → terra 3 มุม → terra 500 → sol 4 มุม (MC-05 S1)', plan: { [SOL]: ['empty', 'ok4'], [TERRA]: ['ok3', '500'] },
    new: { models: [SOL, TERRA], ok: false, error: /BREAKDOWN_ANGLE_COUNT:3\/4/ },
    legacy: { models: [SOL, TERRA, TERRA, TERRA, TERRA, SOL], ok: true } },
  { name: 'sol ผิดสัญญา 3 มุม → terra 500 (PL-20 C · sol ที่เพิ่งถูกปัดตกถูกเรียกซ้ำ)', plan: { [SOL]: ['ok3'], [TERRA]: ['500'] },
    new: { models: [SOL, TERRA], ok: false, error: /500/ },
    legacy: { models: [SOL, TERRA, TERRA, TERRA, SOL], ok: false, error: /BREAKDOWN_ANGLE_COUNT:3\/4/ } },
  { name: 'sol 400 → terra 3 มุม → terra 4 มุม (PL-20 B · terra พรอมต์เดิมซ้ำ)', plan: { [SOL]: ['400'], [TERRA]: ['ok3', 'ok4'] },
    new: { models: [SOL, TERRA], ok: false, error: /BREAKDOWN_ANGLE_COUNT:3\/4/ },
    legacy: { models: [SOL, TERRA, TERRA], ok: true } },
];

/** behaviorOnly = ตัดส่วนตรวจ args ออก (ใช้ใน mutation เพื่อพิสูจน์ว่าลำดับ request ที่ถึง API จับได้เองโดยไม่พึ่งการตรวจ args) */
async function assertFastOracle(mode, branch = BRANCH, { behaviorOnly = false } = {}) {
  for (const sc of FAST) {
    const want = sc[mode];
    const res = await withEnv(MODES[mode], () => runBreakdown({ plan: sc.plan, branch }));
    const label = `[${mode}] ${sc.name}`;
    assert.deepEqual(res.models, want.models, `${label}: ลำดับ request ที่ถึง API`);
    assert.equal(res.ok, want.ok, `${label}: ผลของขั้น${res.ok ? '' : ` (error: ${res.error?.message})`}`);
    if (want.error) assert.match(res.error?.message || '', want.error, `${label}: ข้อความ error`);
    if (mode === 'new') {
      assert.ok(res.count(SOL) <= 1 && res.count(TERRA) <= 1, `${label}: ใหม่ต้องไม่เกิน sol 1 + terra 1`);
      assert.ok(res.hits.every((h) => h.retryCount === null || h.retryCount === '0'), `${label}: ใหม่ต้องไม่มี SDK retry`);
      assert.equal(res.calls.length, res.hits.length, `${label}: ใหม่ = 1 callAI ต่อ 1 request`);
    }
    if (!behaviorOnly) assertArgs(res, mode, label);
  }
}
const BEHAVIOR_CAUGHT = /ลำดับ request|ไม่เกิน sol 1 \+ terra 1|ไม่มี SDK retry|1 callAI ต่อ 1 request/;

// ═══ A) สวิตช์ ═══
test('A1 สวิตช์ BREAKDOWN_SINGLE_FALLBACK: ไม่ตั้ง/ว่าง/ค่าอื่น = ใหม่ · 0/off/false/no/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย args เดิมทุกไบต์', async () => {
  const cases = [
    [undefined, 'new'], ['', 'new'], ['1', 'new'], ['on', 'new'], ['true', 'new'], ['yes', 'new'], ['ใหม่', 'new'],
    ['0', 'legacy'], ['off', 'legacy'], ['false', 'legacy'], ['no', 'legacy'], ['legacy', 'legacy'],
    [' LEGACY ', 'legacy'], ['"0"', 'legacy'], ["'Off'", 'legacy'], [' "no" ', 'legacy'],
  ];
  for (const [value, mode] of cases) {
    const res = await withEnv({ ...BASE_ENV, BREAKDOWN_SINGLE_FALLBACK: value }, () => runBreakdown({ plan: { [SOL]: ['ok4'] } }));
    assert.equal(res.ok, true, JSON.stringify(value));
    assert.deepEqual(res.calls[0].keys, mode === 'new' ? NEW_KEYS : OLD_KEYS, `ค่า ${JSON.stringify(value)} ต้องได้โหมด ${mode}`);
  }
});

// ═══ B) เวลา (รูป production + timer มือ) ═══
test('B1 (โจทย์หลัก) sol หมดเวลา 200s → terra ถูกเรียก 1 ครั้งเท่านั้น แล้วจบด้วยผล terra — ทั้ง 2 โหมด · ใหม่ไม่มี SDK retry', async () => {
  for (const mode of ['new', 'legacy']) {
    const res = await withEnv(MODES[mode], () => runBreakdown({
      plan: { [SOL]: ['hang'], [TERRA]: ['ok4'] },
      drive: async ({ server, timers }) => {
        await server.until(() => server.count(SOL) === 1, 'sol นัดแรกถึง API');
        assert.equal(timers.live(300000).length, 1, 'stage 300s ต้องค้างอยู่');
        assert.equal(timers.live(90000).length, 0, 'ยังไม่เริ่ม fallback ก่อน sol หมดเวลา');
        timers.fire(200000); // sol ครบ 200s (breakdown_primary_inner)
      },
    }));
    const label = `[${mode}] B1`;
    assert.equal(res.ok, true, `${label}: ต้องจบด้วยผล terra (error: ${res.error?.message})`);
    assert.deepEqual(res.models, [SOL, TERRA], `${label}: ลำดับ request`);
    assert.equal(res.count(TERRA), 1, `${label}: terra ถูกเรียก 1 ครั้งเท่านั้น`);
    assert.equal(res.hits[0].aborted, true, `${label}: request ของ sol ต้องถูกยกเลิกจริงตอนหมดเวลา`);
    assert.equal(res.value.success, true);
    assert.equal(res.value.data.possible_angles.length, 4);
    assert.deepEqual(res.calls.map((c) => c.args.model), [SOL, TERRA], `${label}: callAI sol 1 + terra 1`);
    const success = res.logs.find((l) => l.step === 'breakdown' && l.status === 'success');
    assert.equal(success?.model, TERRA, `${label}: log บันทึกโมเดลที่ได้ผลจริง`);
    assert.equal(res.timers.created.filter((t) => t.ms === 90000).length, 1, `${label}: fallback terra ได้หน้าต่าง 90s หนึ่งครั้ง`);
    assert.ok(res.timers.created.every((t) => t.fired || t.cleared), `${label}: timer ของขั้นต้องถูกเก็บครบ (ไม่ค้าง)`);
    if (mode === 'new') assert.ok(res.hits.every((h) => h.retryCount === null || h.retryCount === '0'), `${label}: ไม่มี SDK retry`);
    assertArgs(res, mode, label);
  }
});

test('B2 sol หมดเวลา → terra HTTP 500: ใหม่ = จบที่ terra นัดเดียว (ไม่วน sol) · ถอย = SDK ยิง terra 3 นัด + วน sol ที่เพิ่งหมดเวลาอีกรอบจนหมดหน้าต่าง 90s', async () => {
  for (const mode of ['new', 'legacy']) {
    const res = await withEnv(MODES[mode], () => runBreakdown({
      plan: { [SOL]: ['hang'], [TERRA]: ['500'] },
      drive: async ({ server, timers }) => {
        await server.until(() => server.count(SOL) === 1, 'sol นัดแรก');
        timers.fire(200000);
        if (mode === 'legacy') {
          await server.until(() => server.count(SOL) === 2, 'ถอย: callAI(terra) ถอยกลับไป sol');
          timers.fire(90000); // หน้าต่าง breakdown_fallback หมด
        }
      },
    }));
    const label = `[${mode}] B2`;
    assert.equal(res.ok, false, label);
    if (mode === 'new') {
      assert.deepEqual(res.models, [SOL, TERRA], `${label}: ใหม่ sol 1 → terra 1 จบ`);
      assert.match(res.error.message, /500/, `${label}: error ของ terra ส่งต่อทันที`);
      assert.equal(res.timers.live(90000).length, 0, `${label}: ไม่ต้องรอหน้าต่าง 90s`);
    } else {
      assert.deepEqual(res.models, [SOL, TERRA, TERRA, TERRA, SOL], `${label}: ถอย = ลำดับเดิม (SDK retry ×2 + วน sol)`);
      assert.deepEqual(res.hits.filter((h) => h.model === TERRA).map((h) => h.retryCount), ['0', '1', '2'], `${label}: ชั้น SDK retry ของเดิม`);
      assert.match(res.error.message, /TIMEOUT: breakdown_fallback/, `${label}: ถอยจบด้วยหมดหน้าต่าง fallback`);
    }
    assertArgs(res, mode, label);
  }
});

test('B3 ทางไม่มี abort (ไม่มีเส้นตาย/stage signal · WITHTIMEOUT_ABORT ไม่ตั้ง): sol หมดเวลาแล้วล้มทีหลัง → ใหม่ terra 1 นัด · ถอย terra ถูกยิงซ้ำเบื้องหลังหลังขั้นคืนผลแล้ว', async () => {
  for (const mode of ['new', 'legacy']) {
    const res = await withEnv(MODES[mode], () => runBreakdown({
      production: false,
      plan: { [SOL]: ['hang', '500'], [TERRA]: ['ok4'] },
      drive: async ({ server, timers, outcome }) => {
        await server.until(() => server.count(SOL) === 1, 'sol นัดแรก');
        timers.fire(200000); // withTimeout แบบไม่ abort: เลิกรอ แต่ request ของ sol ยังวิ่งต่อ
        const done = await settleWithin(outcome, 'ขั้น breakdown ต้องคืนผลจาก terra ก่อน', 5_000);
        assert.equal(done.ok, true, `[${mode}] B3: ขั้นต้องสำเร็จด้วย terra`);
        assert.equal(server.hits[0].aborted, false, `[${mode}] B3: ทางนี้ไม่มีการยกเลิก request จริง`);
        server.hits[0].release('500'); // sol ที่ค้างอยู่ล้มทีหลัง (หลังขั้นจบแล้ว)
      },
    }));
    const label = `[${mode}] B3`;
    if (mode === 'new') {
      assert.deepEqual(res.models, [SOL, TERRA], `${label}: ใหม่ = ไม่มี request เบื้องหลังเพิ่ม`);
      assert.equal(res.count(TERRA), 1, `${label}: terra ถูกเรียก 1 ครั้งเท่านั้น`);
    } else {
      assert.deepEqual(res.models, [SOL, TERRA, SOL, SOL, TERRA], `${label}: ถอย = SDK retry sol + โซ่ใน callAI ยิง terra ซ้ำเบื้องหลัง`);
      assert.equal(res.count(TERRA), 2, `${label}: ถอย terra ถูกเรียก 2 ครั้ง (ครั้งที่ 2 ผลถูกทิ้ง)`);
    }
    assertArgs(res, mode, label);
  }
});

test('B4 เส้นตายรวมหมดระหว่างรอ sol → โยน PIPELINE_DEADLINE ทันที ไม่เริ่ม terra ทั้ง 2 โหมด', async () => {
  for (const mode of ['new', 'legacy']) {
    const res = await withEnv(MODES[mode], () => runBreakdown({
      plan: { [SOL]: ['hang'], [TERRA]: ['ok4'] },
      drive: async ({ server, manual }) => {
        await server.until(() => server.count(SOL) === 1, 'sol นัดแรก');
        manual.expire();
      },
    }));
    const label = `[${mode}] B4`;
    assert.equal(res.ok, false, label);
    assert.ok(isPipelineDeadlineError(res.error), `${label}: ต้องเป็น PIPELINE_DEADLINE (ได้ ${res.error?.message})`);
    assert.deepEqual(res.models, [SOL], `${label}: ไม่เริ่ม terra หลังเส้นตายรวมหมด`);
    assert.equal(res.hits[0].aborted, true, `${label}: sol ถูกยกเลิกจริง`);
    assertArgs(res, mode, label);
  }
});

// ═══ C) ล้มเร็ว 6 สถานการณ์ × 2 โหมด ═══
test('C1 ใหม่ (ค่าเริ่มต้น): ทุกสถานการณ์ยิงไม่เกิน sol 1 + terra 1 · ไม่มี SDK retry · args มี allowModelFallback:false + maxRetries:0 · พรอมต์เดียวกัน', async () => {
  await assertFastOracle('new');
});

test('C2 ถอย BREAKDOWN_SINGLE_FALLBACK=0: ลำดับเดิมตามผลจำลองของผู้ตรวจ (sol→terra→terra→sol · 5xx ล้วน 12 request) · args เดิมทุกไบต์', async () => {
  await assertFastOracle('legacy');
});

// ═══ D) ซอร์ส ═══
function assertSourceWiring(src = TEXT_SRC, autoSrc = AUTO_SRC) {
  const start = src.indexOf("  if (mode === 'breakdown') {");
  const end = src.indexOf('  // ===== MODE: analyze', start);
  const branch = src.slice(start, end);
  const code = branch.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal((code.match(/const _bdCallGuard = _bdSingleFallback \? \{ allowModelFallback: false, maxRetries: 0 \} : \{\};/g) || []).length, 1, 'guard ประกาศครั้งเดียว');
  assert.equal((code.match(/process\.env\.BREAKDOWN_SINGLE_FALLBACK/g) || []).length, 1, 'ตัวอ่านสวิตช์จุดเดียว');
  assert.equal((src.match(/process\.env\.BREAKDOWN_SINGLE_FALLBACK/g) || []).length, 1, 'ทั้งไฟล์อ่านสวิตช์จุดเดียว');
  for (const model of ['MODEL_BREAKDOWN', 'MODEL_HEAVY_FALLBACK']) {
    const re = new RegExp(`callAI\\(\\{ prompt, model: ${model}, \\.\\.\\._bdCallGuard, temperature: 0\\.4, maxTokens: 24000, signal: requestSignal, sanitizeScope: 'facts', \\.\\.\\.slimSystem\\(BREAKDOWN_SYSTEM_PROMPT\\) \\}\\)`, 'g');
    assert.equal((code.match(re) || []).length, 1, `${model}: ต้อง spread _bdCallGuard หลัง model (คงลำดับคีย์เดิมของ args ที่เหลือ)`);
  }
  // CFG-09: คอมเมนต์งบของ stage ต้องตรงตัวเลขจริงในซอร์ส (inner + fallback + ส่วนเผื่อ)
  const innerMs = Number(/(\d+),\n\s+'breakdown_primary_inner',/.exec(branch)?.[1]);
  const fbMs = Number(/(\d+),\n\s+'breakdown_fallback',/.exec(branch)?.[1]);
  const line = autoSrc.split('\n').find((l) => l.includes("'breakdown'); // ★ 300s (10 ก.ค. 69)"));
  assert.ok(line, 'ไม่พบบรรทัดงบ breakdown ใน autoFlowServiceText');
  const outerMs = Number(/\}\), (\d+), 'breakdown'\);/.exec(line)?.[1]);
  assert.ok(innerMs > 0 && fbMs > 0 && outerMs > 0, 'อ่านตัวเลขงบจากซอร์สไม่ได้');
  const comment = line.slice(line.indexOf('//'));
  assert.ok(comment.includes(`sol ${innerMs / 1000}s`) && comment.includes(`terra ${fbMs / 1000}s`), `คอมเมนต์ต้องบอก sol ${innerMs / 1000}s + terra ${fbMs / 1000}s`);
  assert.ok(comment.includes(`= ${(innerMs + fbMs) / 1000}s`), `คอมเมนต์ต้องบอกผลรวมชั้นใน ${(innerMs + fbMs) / 1000}s`);
  assert.ok(comment.includes(`~${(outerMs - innerMs - fbMs) / 1000}s`), `คอมเมนต์ต้องบอกส่วนเผื่อจริง ~${(outerMs - innerMs - fbMs) / 1000}s`);
  assert.ok(comment.includes('★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ)'), 'คอมเมนต์ต้องมีป้ายแคมเปญ');
}

test('D1 ซอร์ส: sol/terra spread _bdCallGuard หลัง model · สวิตช์อ่านจุดเดียว · คอมเมนต์งบ autoFlow ตรงตัวเลขจริงในซอร์ส (CFG-09)', () => {
  assertSourceWiring();
});

// ═══ E) mutation — แก้เฉพาะสำเนาในหน่วยความจำ ต้องแดงทุกตัว ═══
const SOL_CALL = "callAI({ prompt, model: MODEL_BREAKDOWN, ..._bdCallGuard, temperature: 0.4, maxTokens: 24000, signal: requestSignal, sanitizeScope: 'facts',";
const TERRA_CALL = "callAI({ prompt, model: MODEL_HEAVY_FALLBACK, ..._bdCallGuard, temperature: 0.4, maxTokens: 24000, signal: requestSignal, sanitizeScope: 'facts',";
const GUARD = 'const _bdCallGuard = _bdSingleFallback ? { allowModelFallback: false, maxRetries: 0 } : {};';

// E1–E4: แดง 2 ทาง — (ก) ลำดับ request ที่ถึง API เพียงอย่างเดียว (behaviorOnly) (ข) oracle เต็ม (args + ลำดับ)
test('E1 mutation: sol ไม่ส่ง guard (callAI ถอย terra เอง + SDK retry) → oracle โหมดใหม่ต้องแดง', async () => {
  const m = mustReplace(TEXT_SRC, SOL_CALL, SOL_CALL.replace(' ..._bdCallGuard,', ''), 'E1');
  await assert.rejects(() => assertFastOracle('new', makeBreakdownBranch(m), { behaviorOnly: true }), BEHAVIOR_CAUGHT);
  await assert.rejects(() => assertFastOracle('new', makeBreakdownBranch(m)));
  assert.throws(() => assertSourceWiring(m), /MODEL_BREAKDOWN: ต้อง spread _bdCallGuard/);
});

test('E2 mutation: terra ไม่ส่ง guard (terra ถอยกลับ sol ใน callAI + SDK retry) → oracle โหมดใหม่ต้องแดง', async () => {
  const m = mustReplace(TEXT_SRC, TERRA_CALL, TERRA_CALL.replace(' ..._bdCallGuard,', ''), 'E2');
  await assert.rejects(() => assertFastOracle('new', makeBreakdownBranch(m), { behaviorOnly: true }), BEHAVIOR_CAUGHT);
  await assert.rejects(() => assertFastOracle('new', makeBreakdownBranch(m)));
  assert.throws(() => assertSourceWiring(m), /MODEL_HEAVY_FALLBACK: ต้อง spread _bdCallGuard/);
});

test('E3 mutation: guard ไม่มี maxRetries:0 (ปิดแค่สลับรุ่น) → SDK retry ยังซ้อน ต้องแดง', async () => {
  const m = mustReplace(TEXT_SRC, GUARD, GUARD.replace('{ allowModelFallback: false, maxRetries: 0 }', '{ allowModelFallback: false }'), 'E3');
  await assert.rejects(() => assertFastOracle('new', makeBreakdownBranch(m), { behaviorOnly: true }), BEHAVIOR_CAUGHT);
  await assert.rejects(() => assertFastOracle('new', makeBreakdownBranch(m)));
});

test('E4 mutation: สวิตช์ไม่มีผล (guard ว่างเสมอ = พฤติกรรมเดิม) → oracle โหมดใหม่ต้องแดง · สวิตช์กลับด้าน → ทั้งสองโหมดแดง', async () => {
  const always = mustReplace(TEXT_SRC, GUARD, 'const _bdCallGuard = {};', 'E4a');
  await assert.rejects(() => assertFastOracle('new', makeBreakdownBranch(always), { behaviorOnly: true }), BEHAVIOR_CAUGHT);
  await assert.rejects(() => assertFastOracle('new', makeBreakdownBranch(always)));
  const inverted = mustReplace(TEXT_SRC, 'const _bdSingleFallback = !/^(?:0|off|false|no|legacy)$/i.test(', 'const _bdSingleFallback = /^(?:0|off|false|no|legacy)$/i.test(', 'E4b');
  await assert.rejects(() => assertFastOracle('new', makeBreakdownBranch(inverted), { behaviorOnly: true }), BEHAVIOR_CAUGHT);
  await assert.rejects(() => assertFastOracle('legacy', makeBreakdownBranch(inverted), { behaviorOnly: true }), BEHAVIOR_CAUGHT);
  await assert.rejects(() => assertFastOracle('legacy', makeBreakdownBranch(inverted)));
});

test('E5 mutation: โหมดถอยไม่เดิมทุกไบต์ (ใส่ allowModelFallback:true ตอนถอย) → oracle โหมดถอยต้องแดง', async () => {
  const m = mustReplace(TEXT_SRC, GUARD, GUARD.replace(': {};', ': { allowModelFallback: true };'), 'E5');
  await assert.rejects(() => assertFastOracle('legacy', makeBreakdownBranch(m)), /เดิมทุกไบต์/);
});

test('E6 mutation: คอมเมนต์งบ autoFlow กลับเป็นของเดิม "เผื่อ 40s" → ด่านซอร์สต้องแดง', () => {
  const line = AUTO_SRC.split('\n').find((l) => l.includes("'breakdown'); // ★ 300s (10 ก.ค. 69)"));
  const oldLine = "  }), 300000, 'breakdown'); // ★ 300s (10 ก.ค. 69) = inner gpt-5.5 200s + fallback gpt-4o 60s + เผื่อ 40s — ห้ามต่ำกว่าผลรวมชั้นใน ไม่งั้น job ตายทั้งงานทั้งที่ fallback กำลังจะรอด";
  const m = mustReplace(AUTO_SRC, line, oldLine, 'E6');
  assert.throws(() => assertSourceWiring(TEXT_SRC, m), /คอมเมนต์ต้องบอก/);
});
