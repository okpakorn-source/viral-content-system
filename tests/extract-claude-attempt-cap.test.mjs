// 🔏 ข้อสอบเพดานต่อไม้ของ claude-extract (PL-07 / CFG-01 / MC-03 / BUG-03) — src/lib/ai/aiRouter.js
// ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ)
//
// บั๊กที่ปิด (ผู้ตรวจยืนยัน 8 คน): EXTRACT_PRIMARY=claude → chain สกัด [claude-extract, gemini, gpt4o] แต่ claude-extract เรียก callClaude
//   ด้วย signal ของ stage ตรงๆ ไม่มีเพดานของตัวเอง (SDK 600s) → Claude ช้า/ค้างกินงบขั้น extract (180s) จนหมด → stage abort →
//   callSmartAI เห็น signal.aborted แล้วโยนทันที → gemini/gpt ไม่เคยได้ทำงาน → งานล้ม failedStep=extract
// สิ่งที่ล็อกไว้:
//   A. สวิตช์ EXTRACT_CLAUDE_ATTEMPT_MS: ไม่ตั้ง/ว่าง/ค่าเพี้ยน = 90000 · ตัวเลข = เพดาน · 0/off/legacy/false/no = โหมดถอย (null)
//      + ความสัมพันธ์งบ: เพดาน claude + gemini (timeout ในตัว 15s จาก geminiClient.js) + เผื่อ gpt ≥ 60s ≤ งบขั้น extract (อ่านจาก autoFlowServiceText.js)
//   B. ค่าเริ่มต้น (นาฬิกาเสมือน · withTimeoutSignal ขั้น extract จริง · เส้นตายรวมจริง createPipelineDeadline ผ่าน manualPipelineDeadline):
//      claude ค้าง → ครบ 90s ยกเลิก HTTP จริง → gemini ทำงานที่ 90s ภายในงบ 180s · claude ช้า 95s → ตัดที่ 90s → gemini ·
//      claude ค้าง + gemini ล้ม → gpt ที่ 90s · claude ตอบ 30s → ผล claude ไม่มี timer ค้าง · stage ถูกยกเลิก/เส้นตายรวมหมด = โยนต่อ ไม่ถอย ·
//      ไม่มี signal ของ stage (สาย URL) ก็ยังตัดที่ 90s
//   C. โหมดถอย EXTRACT_CLAUDE_ATTEMPT_MS=0 = เดิมทุกไบต์: signal ของ stage ตัวเดียวกัน · claude ค้าง → gemini ไม่ถูกเรียกเลย → stage ล้มที่ 180s (บั๊กเดิม)
//      · claude ช้า 95s → ได้ผล claude ที่ 95s · ไม่มี signal ของ stage → ไม่มีเพดาน รอไปเรื่อยๆ
// เวลา: ห้ามรอ timer จริง — setTimeout/Date ใช้ mock.timers ของ node:test (นาฬิกาเสมือน · ขยับทีละ 500ms + flush ด้วย setImmediate จริงที่ ref อยู่)
//   · เส้นตายรวม = manualPipelineDeadline (tests/helpers/fake-deadline.mjs) · รอผลท้ายข้อผ่าน settleWithin หลังคืน timer จริง (แดงข้อเดียว ไม่ลามทั้งไฟล์ · node 22)
//   · ไม่มี unref ที่ไหนเลย (บทเรียน CI node 22 — ดูหัว tests/helpers/fake-deadline.mjs)
//
// วิธีรัน:  node --test tests/extract-claude-attempt-cap.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่าข้อสอบกัดจริง — เทสต้องแดง · แก้เฉพาะสำเนาในหน่วยความจำ ไม่แตะไฟล์ใน repo):
//   EXTRACT_CAP_TEST_MUTATION=no-cap            ค่าเริ่มต้นเรียก claude ตรงด้วย signal ของ stage (ถอดเพดาน) — บั๊กเดิมกลับมา
//   EXTRACT_CAP_TEST_MUTATION=no-legacy-switch  EXTRACT_CLAUDE_ATTEMPT_MS=0 ไม่ได้โหมดถอย (ยังครอบเพดาน)
//   EXTRACT_CAP_TEST_MUTATION=default-off       ไม่ตั้ง env = โหมดถอย (ค่าเริ่มต้นไม่ใช่เส้นใหม่)
//   EXTRACT_CAP_TEST_MUTATION=cap-170s          ค่าเริ่มต้นเพดาน 170s (เหลือเวลาให้ gemini/gpt ไม่พอในงบขั้น)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';
import { manualPipelineDeadline, settleWithin } from './helpers/fake-deadline.mjs';
import { runWithPipelineDeadline, isPipelineDeadlineError } from '../src/lib/utils/pipelineDeadline.js';
import { withTimeoutSignal } from '../src/lib/utils/withTimeout.js';

const MUTATION = process.env.EXTRACT_CAP_TEST_MUTATION || '';
const KNOWN_MUTATIONS = ['no-cap', 'no-legacy-switch', 'default-off', 'cap-170s'];
if (MUTATION && !KNOWN_MUTATIONS.includes(MUTATION)) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};
const codeOnly = (src) => src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

// ── Router จริง + stub 3 client (withTimeoutSignal / pipelineDeadline / taskSystemPrompts = ของจริง) ──
let routerSource = readSrc('../src/lib/ai/aiRouter.js');
routerSource = mustReplace(routerSource, "import { callClaude, isClaudeAvailable } from './claudeClient.js';",
  "const isClaudeAvailable = () => true; const callClaude = (args) => globalThis.__XCAP_AI__('claude', args);", 'stub claudeClient');
routerSource = mustReplace(routerSource, /import \{ callGemini[^\n]*\n/,
  "const isGeminiAvailable = () => true; const callGemini = (args) => globalThis.__XCAP_AI__('gemini', args);\n", 'stub geminiClient');
routerSource = mustReplace(routerSource, "import { callAI } from './openai.js';",
  "const callAI = (args) => globalThis.__XCAP_AI__('gpt', args);", 'stub openai');
routerSource = mustReplace(routerSource, /import \{ MODEL_PRIMARY[^\n]*\n/, "const MODEL_PRIMARY = 'gpt-5.6-sol';\n", 'stub modelConfig');

if (MUTATION === 'no-cap') {
  routerSource = mustReplace(routerSource,
    ": await runWriterAttempt(_callExtractClaude, _extractAttemptMs, 'extract_claude', signal);",
    ': await _callExtractClaude(signal);', 'mutation no-cap');
} else if (MUTATION === 'no-legacy-switch') {
  routerSource = mustReplace(routerSource, 'if (EXTRACT_CLAUDE_ATTEMPT_LEGACY_VALUES.has(v)) return null;', '/* mutated */', 'mutation no-legacy-switch');
} else if (MUTATION === 'default-off') {
  routerSource = mustReplace(routerSource, 'if (raw == null) return EXTRACT_CLAUDE_ATTEMPT_DEFAULT_MS;', 'if (raw == null) return null;', 'mutation default-off');
} else if (MUTATION === 'cap-170s') {
  routerSource = mustReplace(routerSource, 'export const EXTRACT_CLAUDE_ATTEMPT_DEFAULT_MS = 90_000;',
    'export const EXTRACT_CLAUDE_ATTEMPT_DEFAULT_MS = 170_000;', 'mutation cap-170s');
}

const router = await importPatchedModule(routerSource, new URL('../src/lib/ai/aiRouter.js', import.meta.url), 'extract-cap-router');
const { callSmartAI, extractClaudeAttemptMs, EXTRACT_CLAUDE_ATTEMPT_DEFAULT_MS } = router;

// งบขั้น extract จริงจาก autoFlowServiceText.js (regex เดียวกับ tests/opus55-timeouts.test.mjs) + timeout ในตัวของ gemini จาก geminiClient.js
const EXTRACT_STAGE_MS = (() => {
  const auto = codeOnly(readSrc('../src/lib/services/autoFlowServiceText.js'));
  const m = [...auto.matchAll(/withTimeoutSignal\(\(stageSignal\) => performSummarize\(\{\s*text: rawText,[\s\S]*?mode: 'extract',[\s\S]*?\}\),\s*([\d_]+),\s*'extract'\)/g)];
  assert.equal(m.length, 1, 'autoFlowServiceText: ต้องเจอขั้น extract พอดี 1 จุด');
  return Number(m[0][1].replace(/_/g, ''));
})();
const GEMINI_OWN_TIMEOUT_MS = (() => {
  const src = codeOnly(readSrc('../src/lib/ai/geminiClient.js'));
  const m = src.match(/timeout:\s*([\d_]+)\s*,/);
  assert.ok(m, 'geminiClient: ต้องเจอ timeout ในตัว');
  return Number(m[1].replace(/_/g, ''));
})();
const GPT_MIN_RESERVE_MS = 60_000; // เผื่อ gpt4o (sol→terra) อย่างน้อย 60s ในงบขั้น

// ── AI ปลอม: จดทุกคำขอ + เวลาเสมือน · เคารพ signal เหมือน SDK (abort → reject ด้วย reason) · ตอบตามแผน ──
const calls = [];
let plan = {};
let T0 = 0;
const vnow = () => Date.now() - T0; // Date ถูก mock ในข้อที่ใช้นาฬิกาเสมือน
const reasonOf = (sig) => (sig.reason instanceof Error ? sig.reason : Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }));
globalThis.__XCAP_AI__ = (fn, args) => {
  const call = { fn, args, signal: args.signal, at: vnow(), abortedAtCall: !!args.signal?.aborted, abortedAt: null, abortReason: null };
  calls.push(call);
  const sig = args.signal;
  if (sig && typeof sig.addEventListener === 'function') {
    sig.addEventListener('abort', () => { call.abortedAt = vnow(); call.abortReason = sig.reason; }, { once: true });
  }
  const p = plan[fn] || { mode: 'ok', after: 0 };
  if (p.mode === 'throw') return Promise.reject(new Error(`mock-${fn}-down`));
  return new Promise((resolve, reject) => {
    let timer = null;
    const onAbort = () => { if (timer) clearTimeout(timer); timer = null; reject(reasonOf(sig)); };
    if (sig && typeof sig.addEventListener === 'function') {
      if (sig.aborted) { onAbort(); return; }
      sig.addEventListener('abort', onAbort, { once: true });
    }
    const answer = () => {
      timer = null;
      sig?.removeEventListener?.('abort', onAbort);
      const model = fn === 'gemini' ? 'gemini-3.6-flash' : args.model;
      const out = { news_title: `จาก ${fn}`, news_body: `เนื้อจาก ${fn}` };
      Object.defineProperty(out, '_modelUsed', { value: model, enumerable: false });
      resolve(out);
    };
    if (p.mode === 'ok') {
      if (p.after > 0) timer = setTimeout(answer, p.after); // setTimeout ถูก mock → timer เสมือน ไม่มี handle จริง
      else answer();
    }
    // mode 'hang' = ไม่ตอบจนกว่าจะถูกยกเลิก
  });
};

const withEnv = async (pairs, fn) => {
  const prior = {};
  for (const [k, v] of Object.entries(pairs)) { prior[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};
const quietConsole = () => {
  const prior = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  return () => { console.log = prior.log; console.warn = prior.warn; console.error = prior.error; };
};
const flush = () => new Promise((resolve) => setImmediate(resolve)); // setImmediate จริง (ไม่ mock) = handle ที่ ref ค้ำ loop ระหว่างรอ
/** ขยับนาฬิกาเสมือนทีละ step + flush ระหว่างก้าว (timer ที่ถูกตั้งหลัง await ถึงจะเกิดทันก้าวถัดไป) */
const advance = async (timers, ms, step = 500) => {
  await flush();
  let left = ms;
  while (left > 0) {
    const d = Math.min(step, left);
    timers.tick(d);
    left -= d;
    await flush();
  }
};
/** จับผลของ promise แบบไม่โยน + เวลาเสมือนที่จบ */
const capture = (promise) => {
  const box = { state: 'pending', value: undefined, error: undefined, at: null };
  box.done = promise.then(
    (value) => { box.state = 'resolved'; box.value = value; box.at = vnow(); return box; },
    (error) => { box.state = 'rejected'; box.error = error; box.at = vnow(); return box; },
  );
  return box;
};

/**
 * รันขั้น extract แบบท่อจริง: runWithPipelineDeadline(เส้นตายรวม 700s เสมือน) → withTimeoutSignal(…, EXTRACT_STAGE_MS, 'extract') → callSmartAI('extract')
 * (autoFlowServiceText → performSummarize → callSmartAI ส่ง stageSignal ต่อ — ตัดชั้น performSummarize ออก เพราะข้อสอบวัดกลไกเวลาของ router)
 */
const startStage = ({ stage = true, deadline = true } = {}) => {
  const seen = { stageSignal: null, md: null };
  const run = () => (stage
    ? withTimeoutSignal((stageSignal) => { seen.stageSignal = stageSignal; return callSmartAI('extract', { prompt: 'ข่าวทดสอบ', signal: stageSignal }); },
      EXTRACT_STAGE_MS, 'extract')
    : callSmartAI('extract', { prompt: 'ข่าวทดสอบ' }));
  let promise;
  if (deadline) {
    seen.md = manualPipelineDeadline(700_000);
    promise = runWithPipelineDeadline(seen.md.deadline, run);
  } else {
    promise = Promise.resolve().then(run);
  }
  return { box: capture(promise), seen };
};

/** ครอบข้อที่ใช้นาฬิกาเสมือน: เปิด mock (setTimeout+Date) → ทำงาน → คืน timer จริง → รอผลท้ายผ่าน settleWithin */
const virtualCase = async (t, env, body) => withEnv({ EXTRACT_PRIMARY: 'claude', EXTRACT_CLAUDE_ATTEMPT_MS: undefined, EXTRACT_CLAUDE_MODEL: undefined, ...env }, async () => {
  calls.length = 0;
  plan = {};
  const restoreConsole = quietConsole();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
  T0 = Date.now();
  let pendingBox = null;
  try {
    pendingBox = await body(t.mock.timers, (box) => { pendingBox = box; return box; });
  } finally {
    t.mock.timers.reset();
    restoreConsole();
  }
  return pendingBox;
});
const byFn = (fn) => calls.filter((c) => c.fn === fn);

// ═══ A) สวิตช์ + ความสัมพันธ์งบ ═══
test('A1 EXTRACT_CLAUDE_ATTEMPT_MS: ไม่ตั้ง/ว่าง/ค่าเพี้ยน = 90000 · ตัวเลข = เพดาน · 0/off/legacy/false/no = โหมดถอย (null)', async () => {
  assert.equal(EXTRACT_CLAUDE_ATTEMPT_DEFAULT_MS, 90_000, 'ค่าเริ่มต้นตามสเปก 90s');
  for (const v of [undefined, '', '  ', 'abc', '-5', 'NaN']) {
    await withEnv({ EXTRACT_CLAUDE_ATTEMPT_MS: v }, () => assert.equal(extractClaudeAttemptMs(), 90_000, `ต้อง 90000: ${JSON.stringify(v)}`));
  }
  await withEnv({ EXTRACT_CLAUDE_ATTEMPT_MS: '45000' }, () => assert.equal(extractClaudeAttemptMs(), 45_000));
  await withEnv({ EXTRACT_CLAUDE_ATTEMPT_MS: ' "60000" ' }, () => assert.equal(extractClaudeAttemptMs(), 60_000));
  for (const v of ['0', 'off', 'legacy', 'false', 'no', 'OFF', '"0"', ' Legacy ']) {
    await withEnv({ EXTRACT_CLAUDE_ATTEMPT_MS: v }, () => assert.equal(extractClaudeAttemptMs(), null, `ต้องถอย: ${JSON.stringify(v)}`));
  }
});

test('A2 งบขั้น extract พอให้ตัวสำรอง: เพดาน claude + gemini (timeout ในตัว) + เผื่อ gpt 60s ≤ งบขั้น extract จริง', () => {
  assert.ok(EXTRACT_STAGE_MS >= 180_000, `งบขั้น extract ${EXTRACT_STAGE_MS}ms (อ่านจาก autoFlowServiceText.js)`);
  assert.equal(GEMINI_OWN_TIMEOUT_MS, 15_000, 'gemini มีเพดานในตัว 15s (geminiClient.js)');
  const need = EXTRACT_CLAUDE_ATTEMPT_DEFAULT_MS + GEMINI_OWN_TIMEOUT_MS + GPT_MIN_RESERVE_MS;
  assert.ok(need <= EXTRACT_STAGE_MS,
    `claude ${EXTRACT_CLAUDE_ATTEMPT_DEFAULT_MS} + gemini ${GEMINI_OWN_TIMEOUT_MS} + gpt ${GPT_MIN_RESERVE_MS} = ${need}ms ต้อง ≤ งบขั้น ${EXTRACT_STAGE_MS}ms`);
});

// ═══ B) ค่าเริ่มต้น — นาฬิกาเสมือน ═══
test('B1 ค่าเริ่มต้น: claude ค้าง → ครบ 90s ยกเลิก HTTP จริง → gemini ทำงานที่ 90s · ขั้น extract จบที่ 90s ภายในงบ 180s', async (t) => {
  let seen;
  const box = await virtualCase(t, {}, async (timers, keep) => {
    plan = { claude: { mode: 'hang' }, gemini: { mode: 'ok', after: 0 } };
    const started = startStage();
    seen = started.seen;
    keep(started.box);
    await advance(timers, 89_500);
    assert.equal(byFn('gemini').length, 0, 'ก่อนครบเพดาน 90s ต้องยังไม่ถอย');
    assert.equal(started.box.state, 'pending');
    await advance(timers, 500);
    return started.box;
  });
  await settleWithin(box.done, 'B1 ขั้น extract ไม่คืนผล');
  assert.equal(box.state, 'resolved', `ขั้น extract ต้องสำเร็จด้วยตัวสำรอง (ได้ ${box.error?.message})`);
  assert.equal(box.value.model, 'gemini-3.6-flash');
  assert.deepEqual(calls.map((c) => c.fn), ['claude', 'gemini'], 'ลำดับ chain เดิม claude → gemini');
  const [claude, gemini] = calls;
  assert.equal(claude.at, 0);
  assert.equal(claude.abortedAt, 90_000, 'ต้องยกเลิก request ของ claude จริงที่ 90s');
  assert.match(String(claude.abortReason?.message), /TIMEOUT: extract_claude/u, 'เหตุยกเลิก = เพดานต่อไม้ extract_claude');
  assert.notEqual(claude.signal, seen.stageSignal, 'claude ต้องได้ signal ต่อไม้ (ไม่ใช่ signal ของ stage ตรงๆ)');
  assert.equal(gemini.signal, seen.stageSignal, 'gemini ได้ signal ของ stage ตามเดิม');
  assert.equal(gemini.abortedAtCall, false, 'เพดานไม้ต้องไม่ยกเลิก stage (ตอนเริ่ม gemini stage ยังไม่ถูกยกเลิก)');
  assert.equal(gemini.at, 90_000, 'gemini เริ่มที่ 90s');
  assert.ok(gemini.at + GEMINI_OWN_TIMEOUT_MS <= EXTRACT_STAGE_MS, 'gemini (รวม timeout ในตัว) ต้องจบได้ภายในงบขั้น');
  assert.equal(box.at, 90_000, 'ขั้น extract จบที่ 90s (เดิมล้มที่ 180s)');
});

test('B2 ค่าเริ่มต้น: claude ช้า 95s (ตอบหลังเพดาน) → ถูกตัดที่ 90s → gemini รับช่วง (แลกกับรอ claude — ถอยได้ด้วย EXTRACT_CLAUDE_ATTEMPT_MS)', async (t) => {
  const box = await virtualCase(t, {}, async (timers, keep) => {
    plan = { claude: { mode: 'ok', after: 95_000 }, gemini: { mode: 'ok', after: 3_000 } };
    const { box: b } = startStage();
    keep(b);
    await advance(timers, 100_000);
    return b;
  });
  await settleWithin(box.done, 'B2 ขั้น extract ไม่คืนผล');
  assert.equal(box.state, 'resolved');
  assert.equal(box.value.model, 'gemini-3.6-flash');
  assert.equal(calls[0].abortedAt, 90_000);
  assert.equal(calls[1].at, 90_000);
  assert.equal(box.at, 93_000, 'gemini ตอบใน 3s → ขั้นจบที่ 93s');
});

test('B3 ค่าเริ่มต้น: claude ค้าง + gemini ล้ม → gpt4o ปิดท้ายที่ 90s (ลำดับ chain เดิม)', async (t) => {
  const box = await virtualCase(t, {}, async (timers, keep) => {
    plan = { claude: { mode: 'hang' }, gemini: { mode: 'throw' }, gpt: { mode: 'ok', after: 20_000 } };
    const { box: b } = startStage();
    keep(b);
    await advance(timers, 120_000);
    return b;
  });
  await settleWithin(box.done, 'B3 ขั้น extract ไม่คืนผล');
  assert.equal(box.state, 'resolved', `ต้องได้ผลจาก gpt (ได้ ${box.error?.message})`);
  assert.deepEqual(calls.map((c) => c.fn), ['claude', 'gemini', 'gpt']);
  assert.equal(box.value.model, 'gpt-5.6-sol');
  assert.equal(calls[2].at, 90_000);
  assert.equal(box.at, 110_000, 'gpt ตอบใน 20s → ขั้นจบที่ 110s < 180s');
});

// B4 ไม่ใช้เส้นตายรวม: dispose ของ runWithPipelineDeadline ยกเลิกคำขอที่ค้างตอนจบ request (ของจริงโดยตั้งใจ) จะบังการตรวจ timer เพดานไม้
test('B4 ค่าเริ่มต้น: claude ตอบใน 30s → ผล claude ไม่เรียกตัวสำรอง · timer เพดานไม้ถูกเก็บ (ไม่ยกเลิกย้อนหลัง)', async (t) => {
  const box = await virtualCase(t, {}, async (timers, keep) => {
    plan = { claude: { mode: 'ok', after: 30_000 } };
    const { box: b } = startStage({ deadline: false });
    keep(b);
    await advance(timers, 30_000);
    assert.equal(b.state, 'resolved', 'claude ตอบแล้วต้องจบทันที');
    await advance(timers, 200_000); // เลยเพดานไม้/งบขั้นไปไกล — ไม่มี timer ค้างมายิงย้อน
    return b;
  });
  await settleWithin(box.done, 'B4 ขั้น extract ไม่คืนผล');
  assert.equal(box.value.model, 'claude-opus-5-5');
  assert.deepEqual(calls.map((c) => c.fn), ['claude']);
  assert.equal(box.at, 30_000);
  assert.equal(calls[0].abortedAt, null, 'ห้ามมี abort ย้อนหลังหลังได้ผลแล้ว (timer ของเพดานไม้ต้องถูก clear)');
});

test('B5 ค่าเริ่มต้น: stage ถูกยกเลิกระหว่างไม้ claude (ตั้งเพดานไม้ 300s > งบขั้น) → โยน TIMEOUT: extract ต่อ ไม่ถอย gemini (ความหมายเดิม)', async (t) => {
  const box = await virtualCase(t, { EXTRACT_CLAUDE_ATTEMPT_MS: '300000' }, async (timers, keep) => {
    plan = { claude: { mode: 'hang' } };
    const { box: b } = startStage();
    keep(b);
    await advance(timers, EXTRACT_STAGE_MS);
    return b;
  });
  await settleWithin(box.done, 'B5 ขั้น extract ไม่คืนผล');
  assert.equal(box.state, 'rejected');
  assert.match(box.error.message, /^TIMEOUT: extract /u);
  assert.equal(box.error.failedStep, 'extract');
  assert.equal(byFn('gemini').length, 0, 'stage ถูกยกเลิก = ห้ามเริ่มตัวสำรอง (เสียเงินฟรี)');
});

test('B6 ค่าเริ่มต้น: เส้นตายรวมหมดระหว่างไม้ claude → PipelineDeadlineError ทะลุออก ไม่ถูกกลืนเป็นการถอย', async (t) => {
  const box = await virtualCase(t, {}, async (timers, keep) => {
    plan = { claude: { mode: 'hang' }, gemini: { mode: 'ok', after: 0 } };
    const { box: b, seen } = startStage();
    keep(b);
    await advance(timers, 50_000);
    seen.md.expire();
    await advance(timers, 500);
    return b;
  });
  await settleWithin(box.done, 'B6 ขั้น extract ไม่คืนผล');
  assert.equal(box.state, 'rejected');
  assert.ok(isPipelineDeadlineError(box.error), `ต้องเป็น PipelineDeadlineError (ได้ ${box.error?.name}: ${box.error?.message})`);
  assert.equal(byFn('gemini').length, 0);
});

test('B7 ค่าเริ่มต้น: ไม่มี signal ของ stage/เส้นตายรวม (สาย URL · /api/summarize) → ยังตัด claude ที่ 90s แล้ว gemini รับช่วง', async (t) => {
  const box = await virtualCase(t, {}, async (timers, keep) => {
    plan = { claude: { mode: 'hang' }, gemini: { mode: 'ok', after: 0 } };
    const { box: b } = startStage({ stage: false, deadline: false });
    keep(b);
    await advance(timers, 90_000);
    return b;
  });
  await settleWithin(box.done, 'B7 callSmartAI ไม่คืนผล');
  assert.equal(box.state, 'resolved');
  assert.equal(box.value.model, 'gemini-3.6-flash');
  assert.ok(calls[0].signal instanceof AbortSignal, 'ต้องส่ง signal ต่อไม้ให้ claude แม้ caller ไม่ส่ง');
  assert.equal(calls[0].abortedAt, 90_000);
});

// ═══ C) โหมดถอย EXTRACT_CLAUDE_ATTEMPT_MS=0 — เดิมทุกไบต์ (ทำซ้ำบั๊กเดิม) ═══
test('C1 โหมดถอย: claude ค้าง → 95s ยังไม่ถอย · signal ของ stage ตัวเดียวกัน · ครบ 180s ขั้นล้ม TIMEOUT: extract โดย gemini ไม่เคยถูกเรียก (บั๊กเดิม)', async (t) => {
  let seen;
  const box = await virtualCase(t, { EXTRACT_CLAUDE_ATTEMPT_MS: '0' }, async (timers, keep) => {
    plan = { claude: { mode: 'hang' }, gemini: { mode: 'ok', after: 0 } };
    const started = startStage();
    seen = started.seen;
    keep(started.box);
    await advance(timers, 95_000);
    assert.equal(byFn('gemini').length, 0, 'โหมดถอย: 95s แล้วยังไม่มีตัวสำรอง');
    assert.equal(started.box.state, 'pending');
    await advance(timers, EXTRACT_STAGE_MS - 95_000);
    return started.box;
  });
  await settleWithin(box.done, 'C1 ขั้น extract ไม่คืนผล');
  assert.equal(calls[0].signal, seen.stageSignal, 'โหมดถอย: ส่ง signal ของ stage ตรงๆ (เดิม)');
  assert.equal(box.state, 'rejected');
  assert.match(box.error.message, /^TIMEOUT: extract /u);
  assert.equal(box.error.failedStep, 'extract');
  assert.equal(box.at, EXTRACT_STAGE_MS);
  assert.equal(byFn('gemini').length, 0, 'โหมดถอย: gemini ไม่เคยได้ทำงาน (บั๊กเดิม)');
});

test('C2 โหมดถอย: claude ช้า 95s → ได้ผล claude ที่ 95s (ไม่มีเพดานไม้)', async (t) => {
  const box = await virtualCase(t, { EXTRACT_CLAUDE_ATTEMPT_MS: 'legacy' }, async (timers, keep) => {
    plan = { claude: { mode: 'ok', after: 95_000 } };
    const { box: b } = startStage();
    keep(b);
    await advance(timers, 95_000);
    return b;
  });
  await settleWithin(box.done, 'C2 ขั้น extract ไม่คืนผล');
  assert.equal(box.state, 'resolved');
  assert.equal(box.value.model, 'claude-opus-5-5');
  assert.equal(box.at, 95_000);
  assert.deepEqual(calls.map((c) => c.fn), ['claude']);
});

test('C3 โหมดถอย: ไม่มี signal ของ stage (สาย URL) → claude ได้ signal undefined · 200s แล้วยังค้างไม่ถอย (ไม่มีเพดานเลย)', async (t) => {
  const box = await virtualCase(t, { EXTRACT_CLAUDE_ATTEMPT_MS: 'off' }, async (timers, keep) => {
    plan = { claude: { mode: 'hang' }, gemini: { mode: 'ok', after: 0 } };
    const { box: b } = startStage({ stage: false, deadline: false });
    keep(b);
    await advance(timers, 200_000);
    return b;
  });
  assert.equal(box.state, 'pending', 'โหมดถอย: ไม่มีเพดาน = ค้างต่อ (ของเดิม)');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal, undefined, 'โหมดถอย: args เดิม signal undefined');
  // สัญญา claude ปลอมค้างถาวรโดยไม่มี timer/handle ใดๆ — ไม่ await (ไม่ค้ำ process)
});
