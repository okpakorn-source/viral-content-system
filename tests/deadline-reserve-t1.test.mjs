// ============================================================
// ⏱️ tests/deadline-reserve-t1.test.mjs — การจองเวลาของท่อข่าว: "เวลาขั้นต่ำเพื่อเริ่ม" แยกจาก "เพดาน"
// ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ) — T1: PL-03 / MC-02 / BUG-02
// ------------------------------------------------------------
// บั๊ก: withTimeoutSignal เรียก assertCanStart(step, เพดานเต็ม) → generate_A (420s) ต้องเหลือ ≥ 420s · ด่าน RAW จอง 180s ×3
//   เคส ledger: สกัด 40 + sol หมดเวลา 200 + terra 42 + blueprint 30 + การ์ด 10 = 322s → "เวลาเหลือ 378000ms ไม่พอสำหรับขั้น generate_A1
//   ที่ต้องมี 420000ms" (504 หลังจ่ายเงิน) · หลัง audit + editor เหลือ 170s → "…raw_fact_audit_final ที่ต้องมี 180000ms"
// แก้ (ที่เดียว): src/lib/utils/pipelineDeadline.js — assertCanStart ตรวจแค่ขั้นต่ำเพื่อเริ่ม (ตาราง STEP_MIN_START_TABLE: ค่าเริ่มต้น 60s ·
//   generate_A* / write_inner 90s · raw_fact_* 45s · extract 30s · ปรับด้วย env) · เพดานจริง min(เพดาน, เหลือ − 5s) ·
//   preparePipelineSignal ที่จองเกินขั้นต่ำ (ด่าน RAW) ได้ตัวตัดคำขอเพิ่ม + src/lib/utils/withTimeout.js (withTimeoutSignal → reservePipelineStepMs)
//   ไม่แตะ call site ใน autoFlowServiceText / summarizeServiceText / rawFactCompletenessGate · สวิตช์ถอย DEADLINE_RESERVE_LEGACY=1
// ทุกข้อที่เกี่ยวกับพฤติกรรมรันทั้ง 2 โหมด (ค่าเริ่มต้น / DEADLINE_RESERVE_LEGACY=1) ด้วยเส้นตายรวมตัวจริงจาก tests/helpers/fake-deadline.mjs
//   (manualPipelineDeadline + advance · settleWithin) — ไม่มี timer จริงเป็นตัวขับผล ไม่มี unref ไม่ยิง API/DB
//   timer ของ withTimeoutSignal ที่ต้องอ่านเพดานจริง = ดักแบบ synchronous ระหว่างเรียก (captureStepTimers) → ไม่ถูกตั้งจริงเลย
//   AbortSignal.timeout ของคำขอด่าน RAW = ดักแบบ synchronous เช่นกัน (captureAbortTimeouts)
// วิธีรัน:  node --test tests/deadline-reserve-t1.test.mjs
// โหมดกลายพันธุ์ (แก้เฉพาะสำเนาในหน่วยความจำ ไม่แตะไฟล์จริง · ตั้งโหมดไหนเทสต้องแดง):
//   DEADLINE_RESERVE_T1_MUTATION = full-reserve | no-tail | no-clamp | switch-dead | legacy-lax | table-write | table-raw
//                                  | table-extract | env-ignored | request-no-cut | request-cut-all | withtimeout-unwired
// ไม่ได้ตรวจ: เวลาจริงของโมเดล (ตัวเลขในเคสมาจาก ledger/log production) · route 504/คิว (tests/text-queue-handoff-contract) ·
//   callSolAuditor ตัวจริง (ต้องมี OpenAI client — ข้อ E จำลองคำขอด้วยรูปเรียกเดียวกับซอร์ส + ข้อ G2 ตรึงรูปเรียกในซอร์ส)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { manualPipelineDeadline, settleWithin } from './helpers/fake-deadline.mjs';
import { importPatchedGraph } from './helpers/temp-module.mjs';

const srcUrl = (rel) => new URL(rel, import.meta.url);
const PIPELINE = '../src/lib/utils/pipelineDeadline.js';
const WITH_TIMEOUT = '../src/lib/utils/withTimeout.js';
const GATE = '../src/lib/services/rawFactCompletenessGate.js';

// [ไฟล์, สตริงในซอร์สปัจจุบัน, สตริงหลังกลายพันธุ์]
const MUTATIONS = {
  'full-reserve': [PIPELINE, ': stepStartRequirementMs(requestedStep, requiredMs);', ': Math.max(0, Number(requiredMs) || 0);'],
  'no-tail': [PIPELINE, 'const room = Math.max(remaining - PIPELINE_TAIL_RESERVE_MS, Math.min(remaining, 1_000));', 'const room = remaining;'],
  'no-clamp': [PIPELINE, 'const effective = stepEffectiveTimeoutMs(capMs, remaining);', 'const effective = capMs;'],
  'switch-dead': [PIPELINE, 'return RESERVE_LEGACY_ON_VALUES.has(cleanDeadlineEnv(raw).toLowerCase());', 'return false;'],
  'legacy-lax': [PIPELINE, 'const required = isDeadlineReserveLegacy()', 'const required = false'],
  'table-write': [PIPELINE, "{ step: 'generate_A*', ms: 90_000,", "{ step: 'generate_A*', ms: 60_000,"],
  'table-raw': [PIPELINE, "{ step: 'raw_fact_*', ms: 45_000,", "{ step: 'raw_fact_*', ms: 60_000,"],
  'table-extract': [PIPELINE, "{ step: 'extract', ms: 30_000,", "{ step: 'extract', ms: 60_000,"],
  'env-ignored': [PIPELINE, '? envMinStartMs(rule.env, rule.ms)', '? rule.ms'],
  'request-no-cut': [PIPELINE, 'return composeAbortSignals(signal, deadline.signal, requestTailCutSignal(step, requiredMs, remaining));',
    'return composeAbortSignals(signal, deadline.signal);'],
  'request-cut-all': [PIPELINE, 'if (!Number.isFinite(cap) || cap <= stepMinStartMs(step)) return undefined;', 'if (!Number.isFinite(cap)) return undefined;'],
  'withtimeout-unwired': [WITH_TIMEOUT, 'if (pipelineDeadline) ms = reservePipelineStepMs(pipelineDeadline, stepName, ms);',
    'pipelineDeadline?.assertCanStart(stepName, ms);'],
};
const MUTATION = process.env.DEADLINE_RESERVE_T1_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const readSrc = (rel) => {
  const src = readFileSync(srcUrl(rel), 'utf8').replace(/\r\n/g, '\n');
  const m = MUTATIONS[MUTATION];
  if (!m || m[0] !== rel) return src;
  assert.ok(src.includes(m[1]), `mutation ${MUTATION}: หาสตริงต้นทางใน ${rel} ไม่เจอ`);
  return src.replace(m[1], m[2]);
};
// ตัดบรรทัดคอมเมนต์ทิ้ง — คอมเมนต์ประวัติ "(ของเดิม: …)" ต้องไม่ทำให้ข้อสอบสายไฟหลงไปจับโค้ดเก่า
const codeOnly = (src) => src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

// กราฟ: pipelineDeadline (กลายพันธุ์ได้) ← withTimeout / ด่าน RAW ชี้ฉบับเดียวกัน (AsyncLocalStorage เดียวกัน) · import อื่นชี้ไฟล์จริง
const graph = await importPatchedGraph({
  pipelineDeadline: { source: readSrc(PIPELINE), originalUrl: srcUrl(PIPELINE) },
  withTimeout: { source: readSrc(WITH_TIMEOUT), originalUrl: srcUrl(WITH_TIMEOUT), links: { './pipelineDeadline.js': 'pipelineDeadline' } },
  gate: { source: readSrc(GATE), originalUrl: srcUrl(GATE), links: { '../utils/pipelineDeadline.js': 'pipelineDeadline' } },
});
const PD = graph.pipelineDeadline;
const { withTimeoutSignal } = graph.withTimeout;
const { enforceRawFactCompleteness } = graph.gate;

// ── ตัวช่วย ────────────────────────────────────────────────────
const MODES = ['default', 'legacy'];
async function withEnv(vars, fn) {
  const prior = {};
  for (const [k, v] of Object.entries(vars)) {
    prior[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const MIN_ENV_NAMES = ['DEADLINE_MIN_START_DEFAULT_MS', 'DEADLINE_MIN_START_WRITE_MS', 'DEADLINE_MIN_START_RAW_FACT_MS', 'DEADLINE_MIN_START_EXTRACT_MS'];
const cleanMinEnv = Object.fromEntries(MIN_ENV_NAMES.map((k) => [k, undefined]));
const inMode = (mode, fn) => withEnv({ ...cleanMinEnv, DEADLINE_RESERVE_LEGACY: mode === 'legacy' ? '1' : undefined }, fn);
// เงียบ console.warn (log หั่นเพดาน) แต่เก็บไว้ตรวจ
async function quietWarn(fn) {
  const logs = [];
  const prior = console.warn;
  console.warn = (...args) => logs.push(args.map(String).join(' '));
  try { return { value: await fn(), logs }; } finally { console.warn = prior; }
}
/**
 * ดัก timer ที่ withTimeoutSignal ตั้ง "ระหว่างเรียกแบบ synchronous" (เพดานจริงของขั้น + ขั้นซ้อนที่เริ่มทันที)
 * timer ไม่ถูกตั้งจริงเลย (handle ปลอม · clearTimeout ของจริงกับ handle ปลอม = ไม่ทำอะไร) → ไม่มี timer จริงค้าง/ไม่ต้อง unref
 * เทสยิง timer เองได้ด้วย timers[i].fire() (จำลองเพดานของขั้นหมดก่อนเส้นตายรวม)
 */
function captureStepTimers(start) {
  const realSetTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = { delay, fire: () => callback(...args) };
    timers.push(timer);
    return timer;
  };
  try {
    return { result: start(timers), timers };
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}
/** ดัก AbortSignal.timeout ระหว่างเรียกแบบ synchronous (เพดานต่อคำขอ HTTP) — คืน signal ธรรมดาที่ไม่มี timer */
function captureAbortTimeouts(fn) {
  const real = AbortSignal.timeout;
  const delays = [];
  AbortSignal.timeout = (ms) => { delays.push(ms); return new AbortController().signal; };
  try {
    return { value: fn(), delays, error: null };
  } catch (error) {
    return { value: null, delays, error };
  } finally {
    AbortSignal.timeout = real;
  }
}
const deadlineErr = (step, required) => (error) => PD.isPipelineDeadlineError(error)
  && error.deadlineStep === step
  && (required == null || error.message.includes(`ที่ต้องมี ${required}ms`));
/** เส้นตายรวมจำลอง (เหลือ remainingMs · นาฬิกาหยุดนิ่ง เดินด้วย md.advance) จาก createPipelineDeadline ของกราฟ (กลายพันธุ์ถึง) */
const manual = (remainingMs) => manualPipelineDeadline(remainingMs, { createPipelineDeadline: PD.createPipelineDeadline });
function underDeadline(remainingMs, fn) {
  const md = manual(remainingMs);
  return { md, promise: PD.runWithPipelineDeadline(md.deadline, () => fn(md)) };
}
/** เรียก assertCanStart ตรง (ด่าน RAW ใช้รูปนี้) — คืน { remaining } หรือ { error } */
function tryStart(remainingMs, step, requiredMs) {
  const md = manual(remainingMs);
  try {
    return { remaining: md.deadline.assertCanStart(step, requiredMs), error: null };
  } catch (error) {
    return { remaining: null, error };
  } finally {
    md.deadline.dispose();
  }
}

// ═══ A) ตาราง + ฟังก์ชันบริสุทธิ์ ═══════════════════════════════════
test('A1 ตาราง: generate_A*/write_inner 90s · raw_fact_* 45s · extract 30s · ขั้นอื่น 60s · ค่าที่ใช้ = min(เพดาน, ตาราง)', () => inMode('default', () => {
  for (const s of ['generate_A1', 'generate_A2', 'generate_A', 'write_inner']) assert.equal(PD.stepMinStartMs(s), 90_000, s);
  for (const s of ['raw_fact_audit_initial', 'raw_fact_editor', 'raw_fact_audit_final', 'raw_fact_audit']) assert.equal(PD.stepMinStartMs(s), 45_000, s);
  assert.equal(PD.stepMinStartMs('extract'), 30_000);
  for (const s of ['breakdown', 'breakdown_primary_inner', 'breakdown_fallback', 'blueprint', 'blueprint:มุมคน', 'smart_research', 'mix_inner',
    'writer_opus', 'correction:L4.6:claude-opus-5', 'openai:gpt-5.6-luna', 'extract_inner', 'unknown', '']) {
    assert.equal(PD.stepMinStartMs(s), 60_000, JSON.stringify(s));
  }
  assert.equal(PD.stepStartRequirementMs('generate_A1', 420_000), 90_000);
  assert.equal(PD.stepStartRequirementMs('raw_fact_audit_final', 180_000), 45_000);
  assert.equal(PD.stepStartRequirementMs('extract', 180_000), 30_000);
  assert.equal(PD.stepStartRequirementMs('breakdown', 300_000), 60_000);
  // เพดานต่ำกว่าตาราง = ต้องเหลือเท่าเพดานเดิม (client 15s · correction/smart_research 60s · ขั้นจิ๋วในเทสเก่า)
  assert.equal(PD.stepStartRequirementMs('openai:gpt-5.6-luna', 15_000), 15_000);
  assert.equal(PD.stepStartRequirementMs('correction:L3A', 60_000), 60_000);
  assert.equal(PD.stepStartRequirementMs('smart_research', 60_000), 60_000);
  assert.equal(PD.stepStartRequirementMs('late_ai', 180), 180);
}));

test('A2 env ปรับตาราง (ทนช่องว่าง/อัญประกาศ) · ว่าง/ค่าเพี้ยน/ติดลบ = ค่าในตาราง', async () => {
  await withEnv({ DEADLINE_MIN_START_WRITE_MS: '120000', DEADLINE_MIN_START_RAW_FACT_MS: '"30000"', DEADLINE_MIN_START_EXTRACT_MS: ' 15000 ', DEADLINE_MIN_START_DEFAULT_MS: '45000' }, () => {
    assert.equal(PD.stepMinStartMs('generate_A1'), 120_000);
    assert.equal(PD.stepMinStartMs('write_inner'), 120_000);
    assert.equal(PD.stepMinStartMs('raw_fact_audit_final'), 30_000);
    assert.equal(PD.stepMinStartMs('extract'), 15_000);
    assert.equal(PD.stepMinStartMs('breakdown'), 45_000);
    assert.equal(PD.stepStartRequirementMs('generate_A1', 100_000), 100_000, 'ยังไม่เกินเพดาน');
  });
  for (const bad of ['', 'abc', '-5', 'NaN']) {
    await withEnv({ DEADLINE_MIN_START_WRITE_MS: bad, DEADLINE_MIN_START_DEFAULT_MS: bad }, () => {
      assert.equal(PD.stepMinStartMs('generate_A1'), 90_000, JSON.stringify(bad));
      assert.equal(PD.stepMinStartMs('breakdown'), 60_000, JSON.stringify(bad));
    });
  }
});

test('A3 เพดานที่ใช้จริง = min(เพดาน, เหลือ − 5s) · เคส ledger 378s→373s · 170s→165s · เหลือพอ = เพดานเดิม', () => {
  assert.equal(PD.stepEffectiveTimeoutMs(420_000, 378_000), 373_000);
  assert.equal(PD.stepEffectiveTimeoutMs(180_000, 170_000), 165_000);
  assert.equal(PD.stepEffectiveTimeoutMs(420_000, 700_000), 420_000);
  assert.equal(PD.stepEffectiveTimeoutMs(420_000, 425_000), 420_000);
  assert.equal(PD.stepEffectiveTimeoutMs(60_000, 62_000), 57_000);
  assert.equal(PD.stepEffectiveTimeoutMs(800, 1_000), 800, 'เทสเก่าเส้นตายหลักมิลลิวินาทีไม่เปลี่ยน');
  assert.equal(PD.stepEffectiveTimeoutMs(420_000, null), 420_000, 'ไม่รู้เวลาที่เหลือ = เพดานเดิม');
  assert.equal(PD.stepEffectiveTimeoutMs('x', 5_000), 'x');
});

test('A4 คุณสมบัติ: ไม่เกินเพดาน · ไม่เกินเวลาที่เหลือ · เหลือ ≥ 6s = กันท้าย 5s พอดี · ยิ่งเหลือมากยิ่งได้ไม่น้อยลง (ทุกเพดาน × ทุกเวลาที่เหลือ)', () => {
  const caps = [180, 800, 15_000, 35_000, 60_000, 90_000, 120_000, 150_000, 180_000, 200_000, 300_000, 350_000, 420_000];
  let checked = 0;
  for (const cap of caps) {
    let prev = -Infinity;
    for (let remaining = 0; remaining <= 720_000; remaining += 250) {
      const eff = PD.stepEffectiveTimeoutMs(cap, remaining);
      assert.ok(eff <= cap, `cap ${cap} rem ${remaining} → ${eff}`);
      assert.ok(eff <= remaining || remaining === 0, `เกินเส้นตายรวม: cap ${cap} rem ${remaining} → ${eff}`);
      if (remaining >= 6_000) assert.equal(eff, Math.min(cap, remaining - 5_000));
      assert.ok(eff >= prev, `ไม่ monotonic ที่ cap ${cap} rem ${remaining}`);
      prev = eff;
      checked += 1;
    }
  }
  assert.ok(checked > 30_000, `ตรวจจริง ${checked} จุด`);
});

test('A5 สวิตช์ DEADLINE_RESERVE_LEGACY: 1/true/on/yes/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย · ไม่ตั้ง/ว่าง/0/off/no/false/ค่าอื่น = ค่าเริ่มต้น', async () => {
  for (const v of ['1', 'true', ' on ', '"yes"', "'LEGACY'", 'True']) {
    await withEnv({ DEADLINE_RESERVE_LEGACY: v }, () => assert.equal(PD.isDeadlineReserveLegacy(), true, JSON.stringify(v)));
  }
  for (const v of [undefined, '', '0', 'off', 'no', 'false', 'yes please']) {
    await withEnv({ DEADLINE_RESERVE_LEGACY: v }, () => assert.equal(PD.isDeadlineReserveLegacy(), false, JSON.stringify(v)));
  }
});

// ═══ B) assertCanStart (createPipelineDeadline ตัวจริง — รูปที่ด่าน RAW เรียกตรง) ═══
for (const mode of MODES) {
  test(`B1 [${mode}] assertCanStart เคส ledger + ด่าน RAW + ขั้นเพดานต่ำ`, () => inMode(mode, () => {
    const legacy = mode === 'legacy';
    // เคส ledger: เหลือ 378s ขั้นเขียนเพดาน 420s
    const gen = tryStart(378_000, 'generate_A1', 420_000);
    if (legacy) assert.equal(gen.error?.message, 'เวลาเหลือ 378000ms ไม่พอสำหรับขั้น generate_A1 ที่ต้องมี 420000ms');
    else assert.equal(gen.remaining, 378_000);
    // เหลือ 20s → ยังโยนทั้ง 2 โหมด (ต่ำกว่าขั้นต่ำ 90s)
    assert.ok(deadlineErr('generate_A1', legacy ? 420_000 : 90_000)(tryStart(20_000, 'generate_A1', 420_000).error));
    // เหลือ 80s → ขั้นเขียนต้องมี 90s (ไม่ใช่ 60s ค่าเริ่มต้น)
    assert.ok(deadlineErr('generate_A1', legacy ? 420_000 : 90_000)(tryStart(80_000, 'generate_A1', 420_000).error));
    // ขั้นสกัดเหลือ 40s → ค่าเริ่มต้นเริ่มได้ (ขั้นต่ำ 30s)
    const ex = tryStart(40_000, 'extract', 180_000);
    if (legacy) assert.ok(deadlineErr('extract', 180_000)(ex.error)); else assert.equal(ex.remaining, 40_000);
    // ด่าน RAW รูปเรียกตรง: เหลือ 170s / 50s / 40s
    for (const step of ['raw_fact_audit_initial', 'raw_fact_editor', 'raw_fact_audit_final']) {
      const r170 = tryStart(170_000, step, 180_000);
      if (legacy) assert.equal(r170.error?.message, `เวลาเหลือ 170000ms ไม่พอสำหรับขั้น ${step} ที่ต้องมี 180000ms`);
      else assert.equal(r170.remaining, 170_000, step);
      const r50 = tryStart(50_000, step, 180_000);
      if (legacy) assert.ok(deadlineErr(step, 180_000)(r50.error)); else assert.equal(r50.remaining, 50_000, `${step} ขั้นต่ำ 45s`);
      assert.ok(deadlineErr(step, legacy ? 180_000 : 45_000)(tryStart(40_000, step, 180_000).error), step);
    }
    // ขั้นเพดานต่ำกว่าตาราง = เหมือนเดิมทุกโหมด
    assert.ok(deadlineErr('openai:gpt-5.6-luna', 15_000)(tryStart(14_000, 'openai:gpt-5.6-luna', 15_000).error));
    assert.equal(tryStart(15_000, 'openai:gpt-5.6-luna', 15_000).remaining, 15_000);
    assert.ok(deadlineErr('correction:L4.6:claude-opus-5', 60_000)(tryStart(59_000, 'correction:L4.6:claude-opus-5', 60_000).error));
    assert.ok(deadlineErr('late_ai', 180)(tryStart(100, 'late_ai', 180).error));
  }));
}

// ═══ C) withTimeoutSignal ตัวจริง + เส้นตายรวมจำลอง ═══════════════
for (const mode of MODES) {
  test(`C1 [${mode}] เคส ledger (เหลือ 378s) ขั้นเขียน generate_A1 เพดาน 420s`, () => inMode(mode, async () => {
    let starts = 0;
    let timers = [];
    const { promise } = underDeadline(378_000, () => {
      const captured = captureStepTimers(() => withTimeoutSignal(() => { starts += 1; return Promise.resolve('ข่าว'); }, 420_000, 'generate_A1'));
      timers = captured.timers;
      return captured.result;
    });
    if (mode === 'legacy') {
      await assert.rejects(settleWithin(promise, 'C1 legacy'), (error) => deadlineErr('generate_A1', 420_000)(error)
        && error.message === 'เวลาเหลือ 378000ms ไม่พอสำหรับขั้น generate_A1 ที่ต้องมี 420000ms');
      assert.equal(starts, 0, 'โหมดถอย: ปฏิเสธก่อนเรียกนักเขียน (บั๊กเดิม)');
      assert.equal(timers.length, 0);
    } else {
      const { value, logs } = await quietWarn(() => settleWithin(promise, 'C1 default'));
      assert.equal(value, 'ข่าว');
      assert.equal(starts, 1, 'ค่าเริ่มต้น: ต้องได้เรียกนักเขียน');
      assert.deepEqual(timers.map((t) => t.delay), [373_000], 'เพดานจริง = min(420s, 378s − 5s)');
      assert.ok(logs.some((l) => l.includes('generate_A1') && l.includes('373s')), 'ต้องมี log บอกว่าหั่นเพดาน');
    }
  }));

  test(`C2 [${mode}] เหลือ 20s / 80s (ต่ำกว่าขั้นต่ำ 90s) → ยังปฏิเสธก่อนเริ่ม ไม่เรียก factory · ขั้นสกัดเหลือ 40s`, () => inMode(mode, async () => {
    let starts = 0;
    for (const remaining of [20_000, 80_000]) {
      const { promise } = underDeadline(remaining, () => withTimeoutSignal(() => { starts += 1; return Promise.resolve('x'); }, 420_000, 'generate_A1'));
      await assert.rejects(settleWithin(promise, `C2 ${remaining}`), deadlineErr('generate_A1', mode === 'legacy' ? 420_000 : 90_000));
    }
    assert.equal(starts, 0);
    let timers = [];
    const ex = underDeadline(40_000, () => {
      const captured = captureStepTimers(() => withTimeoutSignal(() => Promise.resolve('สกัดแล้ว'), 180_000, 'extract'));
      timers = captured.timers;
      return captured.result;
    });
    if (mode === 'legacy') {
      await assert.rejects(settleWithin(ex.promise, 'C2 extract legacy'), deadlineErr('extract', 180_000));
    } else {
      assert.equal((await quietWarn(() => settleWithin(ex.promise, 'C2 extract'))).value, 'สกัดแล้ว');
      assert.deepEqual(timers.map((t) => t.delay), [35_000]);
    }
  }));

  test(`C3 [${mode}] เส้นตายรวมยังตัดขั้นที่ถูกหั่น (ไม่มีขั้นไหนรันเกินเส้นตาย) · เพดานของขั้นหมดก่อนเส้นตาย`, () => inMode(mode, async () => {
    // เหลือ 421s: โหมดถอยก็เริ่มได้ (421 ≥ 420) → เทียบได้ทั้ง 2 โหมด
    for (const how of ['deadline', 'step-cap']) {
      let sawAbort = false;
      let started;
      const ready = new Promise((resolve) => { started = resolve; });
      let stepPromise;
      let timers = [];
      const { md, promise } = underDeadline(421_000, () => {
        const captured = captureStepTimers(() => withTimeoutSignal((signal) => new Promise((_, reject) => {
          signal.addEventListener('abort', () => { sawAbort = true; reject(signal.reason); }, { once: true });
        }), 420_000, 'generate_A1'));
        stepPromise = captured.result;
        stepPromise.catch(() => {});
        timers = captured.timers;
        started();
        return stepPromise;
      });
      promise.catch(() => {});
      await quietWarn(() => settleWithin(ready, `C3 ${how}: ขั้นต้องเริ่ม`));
      assert.deepEqual(timers.map((t) => t.delay), [mode === 'legacy' ? 420_000 : 416_000]);
      if (how === 'deadline') {
        md.expire();
        await assert.rejects(settleWithin(promise, 'C3 outer'), PD.isPipelineDeadlineError);
        await assert.rejects(settleWithin(stepPromise, 'C3 step'), PD.isPipelineDeadlineError);
      } else {
        timers[0].fire(); // เพดานของขั้นเองหมด (416s ค่าเริ่มต้น) — ก่อนเส้นตายรวม 421s
        const cut = (error) => /^TIMEOUT: generate_A1 ใช้เวลาเกิน (416|420)s/u.test(error.message) && error.failedStep === 'generate_A1';
        await assert.rejects(settleWithin(stepPromise, 'C3 step-cap'), cut);
        await assert.rejects(settleWithin(promise, 'C3 outer step-cap'), cut);
      }
      assert.equal(sawAbort, true, `${how}: HTTP ของขั้นต้องถูกยกเลิกจริง`);
    }
  }));

  test(`C4 [${mode}] ขั้นซ้อน generate_A1 → write_inner → writer_opus ใช้หลักเดียวกันทุกชั้น`, () => inMode(mode, async () => {
    const nested = () => withTimeoutSignal((s1) => withTimeoutSignal((s2) => withTimeoutSignal(
      () => Promise.resolve('ok'), 150_000, 'writer_opus', s2), 350_000, 'write_inner', s1), 420_000, 'generate_A1');
    for (const [remaining, expected] of [[378_000, [373_000, 350_000, 150_000]], [100_000, [95_000, 95_000, 95_000]], [700_000, [420_000, 350_000, 150_000]]]) {
      let timers = [];
      const { promise } = underDeadline(remaining, () => {
        const captured = captureStepTimers(nested);
        timers = captured.timers;
        return captured.result;
      });
      if (mode === 'legacy' && remaining < 420_000) {
        await assert.rejects(settleWithin(promise, `C4 legacy ${remaining}`), deadlineErr('generate_A1', 420_000));
        assert.equal(timers.length, 0);
      } else {
        const { value } = await quietWarn(() => settleWithin(promise, `C4 ${remaining}`));
        assert.equal(value, 'ok');
        assert.deepEqual(timers.map((t) => t.delay), expected, `เหลือ ${remaining}`);
      }
    }
  }));

  test(`C5 [${mode}] ขั้นเพดานต่ำ (correction 60s = ขั้นต่ำ) เริ่มเงื่อนไขเดิม · ไม่มีเส้นตายรวม = เพดานเดิมไม่ตรวจ`, () => inMode(mode, async () => {
    let timers = [];
    const ok = underDeadline(62_000, () => {
      const captured = captureStepTimers(() => withTimeoutSignal(() => Promise.resolve('ตรวจแล้ว'), 60_000, 'correction:L4.6:claude-opus-5'));
      timers = captured.timers;
      return captured.result;
    });
    assert.equal((await quietWarn(() => settleWithin(ok.promise, 'C5 ok'))).value, 'ตรวจแล้ว');
    assert.deepEqual(timers.map((t) => t.delay), [mode === 'legacy' ? 60_000 : 57_000], 'ค่าเริ่มต้นกันท้าย 5s');
    let starts = 0;
    const late = underDeadline(59_000, () => withTimeoutSignal(() => { starts += 1; return Promise.resolve('x'); }, 60_000, 'correction:L3A'));
    await assert.rejects(settleWithin(late.promise, 'C5 late'), deadlineErr('correction:L3A', 60_000));
    assert.equal(starts, 0, 'correction ที่เวลาไม่พอเพดานต้องไม่ถูกเรียก (ไม่จ่ายเงิน · fail-open ตามสัญญา S7)');
    const none = captureStepTimers(() => withTimeoutSignal(() => Promise.resolve('ok'), 420_000, 'generate_A1'));
    assert.equal(await settleWithin(none.result, 'C5 none'), 'ok');
    assert.deepEqual(none.timers.map((t) => t.delay), [420_000]);
    assert.equal(PD.reservePipelineStepMs(null, 'generate_A1', 420_000), 420_000);
  }));
}

// ═══ D) preparePipelineSignal: คำขอด่าน RAW (จองเพดาน 180s) vs client ทั่วไป (15s) ═══
for (const mode of MODES) {
  test(`D1 [${mode}] คำขอ Sol ด่าน RAW เหลือ 170s: preparePipelineSignal(AbortSignal.timeout(180_000), 'raw_fact_audit', 180_000)`, () => inMode(mode, async () => {
    const { md, promise } = underDeadline(170_000, async () => {
      const out = captureAbortTimeouts(() => PD.preparePipelineSignal(AbortSignal.timeout(180_000), 'raw_fact_audit', 180_000));
      return { ...out, abortedAtStart: out.value?.aborted ?? null };
    });
    const out = (await quietWarn(() => settleWithin(promise, 'D1'))).value;
    if (mode === 'legacy') {
      assert.deepEqual(out.delays, [180_000]);
      assert.ok(deadlineErr('raw_fact_audit', 180_000)(out.error), 'โหมดถอย: ต้องเหลือเต็ม 180s');
    } else {
      assert.equal(out.error, null);
      assert.deepEqual(out.delays, [180_000, 165_000], 'ตัวตัดคำขอเพิ่ม = min(180s, 170s − 5s)');
      assert.equal(out.abortedAtStart, false);
      assert.equal(md.deadline.signal.aborted, true, 'จบงานแล้ว dispose ยกเลิกสัญญาณลูกตามสัญญาเดิม');
      assert.equal(out.value.aborted, true, 'สัญญาณคำขอผูกกับเส้นตายรวมจริง');
    }
    // เหลือเต็ม → ไม่มีตัวตัดเพิ่มทั้ง 2 โหมด · เหลือ 40s → ปฏิเสธก่อนยิง
    const full = underDeadline(700_000, async () => captureAbortTimeouts(() => PD.preparePipelineSignal(AbortSignal.timeout(180_000), 'raw_fact_editor', 180_000)));
    const fullOut = await settleWithin(full.promise, 'D1 full');
    assert.equal(fullOut.error, null);
    assert.deepEqual(fullOut.delays, [180_000]);
    const tooLate = underDeadline(40_000, async () => captureAbortTimeouts(() => PD.preparePipelineSignal(AbortSignal.timeout(180_000), 'raw_fact_audit', 180_000)));
    assert.ok(deadlineErr('raw_fact_audit', mode === 'legacy' ? 180_000 : 45_000)((await settleWithin(tooLate.promise, 'D1 late')).error));
  }));

  test(`D2 [${mode}] client ทั่วไป (15s ≤ ขั้นต่ำ) ไม่ถูกแตะ: ไม่มีตัวตัดเพิ่ม · คืน deadline.signal ตัวเดิม · เหลือ 14s ยังปฏิเสธ`, () => inMode(mode, async () => {
    const { md, promise } = underDeadline(16_000, async (clock) => {
      const out = captureAbortTimeouts(() => PD.preparePipelineSignal(undefined, 'openai:gpt-5.6-luna', 15_000));
      return { ...out, same: out.value === clock.deadline.signal };
    });
    const out = await settleWithin(promise, 'D2');
    assert.equal(out.error, null);
    assert.deepEqual(out.delays, []);
    assert.equal(out.same, true);
    assert.equal(md.deadline.signal.aborted, true);
    const late = underDeadline(14_000, async () => captureAbortTimeouts(() => PD.preparePipelineSignal(undefined, 'claude:claude-opus-5-5', 15_000)));
    assert.ok(deadlineErr('claude:claude-opus-5-5', 15_000)((await settleWithin(late.promise, 'D2 late')).error));
  }));
}

// ═══ E) ด่าน RAW (enforceRawFactCompleteness ตัวจริง · Sol ปลอมเดินนาฬิกา + ขอสัญญาณคำขอรูปเดียวกับ callSolAuditor) ═══
const RAW = 'ลุงสมชายอายุ 70 ปี เก็บขยะขายมา 20 ปี นำเงินเก็บ 50,000 บาท บริจาคให้โรงเรียนบ้านเกิด';
const VERSION = { title: 'หัวข่าว', content: 'ลุงสมชายวัย 70 ปี เก็บขยะขายมา 20 ปี แล้วนำเงินทั้งหมดบริจาคให้โรงเรียน' };
function solMock(md, { auditMs = 60_000, editorMs = 60_000 } = {}) {
  const calls = { audit: 0, editor: 0, requestCuts: [] };
  const request = (step) => {
    // รูปเรียกเดียวกับ callSolAuditor / callSolFactEditor (ตรึงในซอร์สด้วยข้อ G2)
    const out = captureAbortTimeouts(() => PD.preparePipelineSignal(AbortSignal.timeout(180_000), step, 180_000));
    if (out.error) throw out.error;
    calls.requestCuts.push(out.delays);
  };
  const audit = async () => {
    calls.audit += 1;
    request('raw_fact_audit');
    if (calls.audit === 1) {
      md.advance(auditMs);
      return { ok: false, failingVersionIndexes: [0], issues: [{ versionIndex: 0, original: 'ทั้งหมด', reasonCode: 'UNSUPPORTED_FACT', reason: 'RAW บอก 50,000 บาท' }], missingFacts: [], contextHash: 'hash-1', model: 'gpt-5.6-sol' };
    }
    return { ok: true, failingVersionIndexes: [], issues: [], missingFacts: [], contextHash: 'hash-2', model: 'gpt-5.6-sol' };
  };
  const repairBatch = async ({ versions }) => {
    calls.editor += 1;
    request('raw_fact_editor');
    md.advance(editorMs);
    return [{ versionIndex: 0, version: { ...versions[0], content: 'ลุงสมชายวัย 70 ปี เก็บขยะขายมา 20 ปี แล้วนำเงินเก็บ 50,000 บาทบริจาคให้โรงเรียนบ้านเกิด' } }];
  };
  return { calls, audit, repairBatch };
}

for (const mode of MODES) {
  test(`E1 [${mode}] เคส ledger ด่าน RAW: เริ่ม 290s · audit 60s + editor 60s → เหลือ 170s → audit รอบสุดท้าย`, () => inMode(mode, async () => {
    let sol;
    const { md, promise } = underDeadline(290_000, (clock) => {
      sol = solMock(clock);
      return enforceRawFactCompleteness({ rawText: RAW, versions: [VERSION], audit: sol.audit, repairBatch: sol.repairBatch });
    });
    if (mode === 'legacy') {
      await assert.rejects(settleWithin(promise, 'E1 legacy'), (error) => deadlineErr('raw_fact_audit_final', 180_000)(error)
        && error.message === 'เวลาเหลือ 170000ms ไม่พอสำหรับขั้น raw_fact_audit_final ที่ต้องมี 180000ms');
      assert.deepEqual({ audit: sol.calls.audit, editor: sol.calls.editor }, { audit: 1, editor: 1 }, 'โหมดถอย: จ่าย audit + editor แล้วทิ้งทั้งงาน (บั๊กเดิม)');
    } else {
      const { value: out } = await quietWarn(() => settleWithin(promise, 'E1 default'));
      assert.deepEqual({ audit: sol.calls.audit, editor: sol.calls.editor }, { audit: 2, editor: 1 }, 'ค่าเริ่มต้น: audit รอบสุดท้ายได้รัน');
      assert.deepEqual(sol.calls.requestCuts, [[180_000], [180_000], [180_000, 165_000]], 'audit รอบสุดท้ายรันด้วยเพดาน 165s (170s − 5s)');
      assert.equal(out.passingVersions.length, 1);
      assert.match(out.passingVersions[0].content, /50,000 บาท/u);
    }
    assert.equal(md.deadline.remainingMs(), 170_000);
  }));

  test(`E2 [${mode}] ด่าน RAW เริ่มตอนเหลือ 50s / 20s`, () => inMode(mode, async () => {
    let sol;
    const at50 = underDeadline(50_000, (clock) => {
      sol = solMock(clock, { auditMs: 1_000, editorMs: 1_000 });
      return enforceRawFactCompleteness({ rawText: RAW, versions: [VERSION], audit: sol.audit, repairBatch: sol.repairBatch });
    });
    if (mode === 'legacy') {
      await assert.rejects(settleWithin(at50.promise, 'E2 50 legacy'), deadlineErr('raw_fact_audit_initial', 180_000));
      assert.deepEqual(sol.calls.audit, 0);
    } else {
      const { value: out } = await quietWarn(() => settleWithin(at50.promise, 'E2 50'));
      assert.deepEqual({ audit: sol.calls.audit, editor: sol.calls.editor }, { audit: 2, editor: 1 }, 'ขั้นต่ำด่าน RAW 45s');
      assert.equal(out.passingVersions.length, 1);
    }
    const at20 = underDeadline(20_000, (clock) => {
      sol = solMock(clock);
      return enforceRawFactCompleteness({ rawText: RAW, versions: [VERSION], audit: sol.audit, repairBatch: sol.repairBatch });
    });
    await assert.rejects(settleWithin(at20.promise, 'E2 20'), deadlineErr('raw_fact_audit_initial', mode === 'legacy' ? 180_000 : 45_000));
    assert.deepEqual({ audit: sol.calls.audit, editor: sol.calls.editor }, { audit: 0, editor: 0 }, 'ต่ำกว่าขั้นต่ำ = ปฏิเสธก่อนจ่าย Sol');
  }));
}

// ═══ F) ไทม์ไลน์ท่อ TEXT (withTimeoutSignal ตัวจริงซ้อนชั้นแบบท่อจริง · AI ปลอมเดินนาฬิกา) ═══
async function ledgerTimeline(md, paid = []) {
  const ai =(name, ms, result = 'ok') => async () => { paid.push(name); md.advance(ms); return result; };
  await withTimeoutSignal(ai('extract', 40_000), 180_000, 'extract');
  await withTimeoutSignal(async (stageSignal) => {
    try {
      await withTimeoutSignal(async () => {
        paid.push('breakdown_sol');
        md.advance(200_000); // sol ชนเพดาน 200s ของตัวเอง
        throw Object.assign(new Error('TIMEOUT: breakdown_primary_inner ใช้เวลาเกิน 200s (ยกเลิก request จริงแล้ว)'), { failedStep: 'breakdown_primary_inner' });
      }, 200_000, 'breakdown_primary_inner', stageSignal);
    } catch (primaryErr) {
      PD.rethrowPipelineDeadline(primaryErr, 'breakdown_primary_inner');
      await withTimeoutSignal(ai('breakdown_terra', 42_000), 90_000, 'breakdown_fallback', stageSignal);
    }
  }, 300_000, 'breakdown');
  await withTimeoutSignal(ai('blueprint', 30_000), 120_000, 'blueprint');
  paid.push('cards');
  md.advance(10_000); // เลือกการ์ด (callAI จองแค่ 15s ต่อคำขอ — ไม่ผ่าน withTimeoutSignal)
  const atWrite = md.deadline.remainingMs();
  const writeTimers = [];
  // 2 มุมเริ่มพร้อมกัน (ขนาน) → นาฬิกาเดินครั้งเดียวตามนักเขียนที่ช้าสุด
  const angles = await Promise.all([1, 2].map((n) => {
    const captured = captureStepTimers(() => withTimeoutSignal((s1) => withTimeoutSignal((s2) => withTimeoutSignal(
      async () => { paid.push(`writer_A${n}`); return `ข่าวมุม ${n}`; }, 150_000, 'writer_opus', s2), 350_000, 'write_inner', s1), 420_000, `generate_A${n}`));
    writeTimers.push(captured.timers.map((t) => t.delay));
    return captured.result;
  }));
  md.advance(40_000);
  return { paid, atWrite, angles, writeTimers };
}

for (const mode of MODES) {
  test(`F1 [${mode}] ไทม์ไลน์ ledger 322s (สกัด 40 · sol หมดเวลา 200 · terra 42 · blueprint 30 · การ์ด 10) → ขั้นเขียน`, () => inMode(mode, async () => {
    let result = null;
    const paid = [];
    const { md, promise } = underDeadline(700_000, async (clock) => {
      const out = await ledgerTimeline(clock, paid);
      result = out;
      return out;
    });
    if (mode === 'legacy') {
      let remainingAtFail = null;
      await assert.rejects(settleWithin(promise, 'F1 legacy'), (error) => {
        remainingAtFail = md.deadline.remainingMs();
        return deadlineErr('generate_A1', 420_000)(error) && error.message.includes('เวลาเหลือ 378000ms');
      });
      assert.equal(remainingAtFail, 378_000);
      assert.equal(result, null, 'โหมดถอย: งานตายที่ขั้นเขียน = 504');
      assert.deepEqual(paid, ['extract', 'breakdown_sol', 'breakdown_terra', 'blueprint', 'cards'], 'จ่ายครบทุกขั้นก่อนเขียน แต่นักเขียนไม่ถูกเรียก');
    } else {
      const { value } = await quietWarn(() => settleWithin(promise, 'F1 default'));
      assert.equal(value.atWrite, 378_000);
      assert.deepEqual(value.angles, ['ข่าวมุม 1', 'ข่าวมุม 2']);
      assert.deepEqual(value.paid, ['extract', 'breakdown_sol', 'breakdown_terra', 'blueprint', 'cards', 'writer_A1', 'writer_A2']);
      assert.deepEqual(value.writeTimers, [[373_000, 350_000, 150_000], [373_000, 350_000, 150_000]], 'เริ่มเขียนด้วยเพดาน 373s');
      assert.equal(md.deadline.remainingMs(), 338_000, 'ข่าวเสร็จที่ 362s ของงบ 700s');
    }
  }));

  test(`F2 [${mode}] ไม่มีขั้นใดเกิน 700s: ทุกขั้นกินเพดานของตัวเองเต็ม (กรณีเลวสุด) ตามลำดับท่อ`, () => inMode(mode, async () => {
    const BUDGET = 700_000;
    const log = [];
    // ขั้นกินเวลาเท่าเพดานที่ได้จริงเต็มก้อน (อ่านจาก timer ที่ดักได้) · ข้อยกเว้น = ขั้นถูกปฏิเสธก่อนเริ่ม
    const burn = (md, timers) => { const t = timers[timers.length - 1].delay; md.advance(Math.min(t, md.deadline.remainingMs() - 1)); return t; };
    const step = async (md, name, cap, inner) => {
      const startedAt = BUDGET - md.deadline.remainingMs();
      try {
        const out = captureStepTimers((timers) => withTimeoutSignal(async () => {
          const eff = timers[timers.length - 1].delay;
          log.push({ name, startedAt, eff });
          if (inner) return inner(timers);
          burn(md, timers);
          return name;
        }, cap, name));
        return await out.result;
      } catch (error) {
        if (!PD.isPipelineDeadlineError(error)) throw error;
        log.push({ name, startedAt, rejected: true });
        return null;
      }
    };
    const { promise } = underDeadline(BUDGET, async (md) => {
      await step(md, 'extract', 180_000);
      await step(md, 'breakdown_primary_inner', 200_000);
      await step(md, 'breakdown_fallback', 90_000);
      await step(md, 'blueprint', 120_000);
      const wrote = await step(md, 'generate_A1', 420_000, (timers) => {
        // ขั้นซ้อน write_inner → writer_opus เริ่มทันทีแบบ synchronous (timer ถูกดักในหน้าต่างเดียวกัน)
        const w = withTimeoutSignal(() => withTimeoutSignal(async () => { burn(md, timers); return 'ข่าว'; }, 150_000, 'writer_opus'), 350_000, 'write_inner');
        log.push({ name: 'write_inner', eff: timers[timers.length - 2]?.delay }, { name: 'writer_opus', eff: timers[timers.length - 1]?.delay });
        return w;
      });
      if (wrote === null) return BUDGET - md.deadline.remainingMs(); // ท่อจริง: ขั้นเขียนถูกปฏิเสธ = งานตาย 504 ตรงนี้
      for (const n of [1, 2, 3]) await step(md, `correction:L${n}`, 60_000);
      await step(md, 'raw_fact_audit_initial', 180_000);
      return BUDGET - md.deadline.remainingMs();
    });
    const { value: usedMs } = await quietWarn(() => settleWithin(promise, 'F2'));
    assert.ok(usedMs <= BUDGET, `ใช้ไป ${usedMs}ms`);
    for (const entry of log) {
      if (entry.rejected || entry.startedAt == null) continue;
      assert.ok(entry.startedAt + entry.eff <= BUDGET - (mode === 'legacy' ? 0 : 5_000), `${entry.name} เริ่ม ${entry.startedAt} + ${entry.eff} เกินเส้นตาย`);
    }
    const started = log.filter((e) => e.startedAt != null && !e.rejected).map((e) => e.name);
    const rejected = log.filter((e) => e.rejected).map((e) => e.name);
    if (mode === 'legacy') {
      // บั๊กเดิม: สกัด 180 + sol 200 + terra 90 + blueprint 120 = 590s → เหลือ 110s แต่ขั้นเขียนต้องมี 420s → ถูกปฏิเสธ (ไม่ได้เขียนเลย)
      assert.deepEqual(started, ['extract', 'breakdown_primary_inner', 'breakdown_fallback', 'blueprint']);
      assert.deepEqual(rejected, ['generate_A1']);
      assert.equal(usedMs, 590_000);
    } else {
      // ใหม่: สกัด 180 → sol 200 → terra 90 → blueprint 120 = 590s · เหลือ 110s ≥ 90s → เขียนด้วย 105s → เหลือท้าย 5s
      assert.deepEqual(started, ['extract', 'breakdown_primary_inner', 'breakdown_fallback', 'blueprint', 'generate_A1']);
      assert.deepEqual(log.filter((e) => e.name === 'generate_A1' || e.name === 'write_inner' || e.name === 'writer_opus').map((e) => e.eff), [105_000, 105_000, 105_000]);
      assert.deepEqual(rejected, ['correction:L1', 'correction:L2', 'correction:L3', 'raw_fact_audit_initial'], 'เหลือ 5s ท้าย = ขั้นหลังเขียนถูกปฏิเสธก่อนจ่าย');
      assert.equal(usedMs, 695_000);
    }
  }));
}

// ═══ G) สายไฟในซอร์สจริง (ตัดคอมเมนต์ทิ้ง) ═══════════════════════
test('G1 withTimeoutSignal จองผ่าน reservePipelineStepMs ที่เดียว — ไม่เหลือ assertCanStart(stepName, ms) ตรง', () => {
  const code = codeOnly(readSrc(WITH_TIMEOUT));
  assert.equal(code.split('if (pipelineDeadline) ms = reservePipelineStepMs(pipelineDeadline, stepName, ms);').length - 1, 1);
  assert.doesNotMatch(code, /assertCanStart\(/u);
  assert.match(code, /reservePipelineStepMs,[^\n]*\n\} from '\.\/pipelineDeadline\.js';/u);
});

test('G2 ด่าน RAW ยังส่งเพดานต่อคำขอเป็น requiredMs (ตัวตัดคำขอของ preparePipelineSignal จึงทำงาน) · ไม่มี stepBudget.js ค้าง', () => {
  const gate = codeOnly(readSrc(GATE));
  for (const step of ['raw_fact_audit', 'raw_fact_editor']) {
    assert.match(gate, new RegExp(`preparePipelineSignal\\(\\s*AbortSignal\\.timeout\\(180_000\\),\\s*'${step}',\\s*180_000,?\\s*\\)`, 'u'), step);
  }
  for (const step of ['raw_fact_audit_initial', 'raw_fact_editor', 'raw_fact_audit_final']) {
    assert.match(gate, new RegExp(`assertCanStart\\('${step}', 180_000\\)`, 'u'), step);
  }
  assert.throws(() => readFileSync(srcUrl('../src/lib/utils/stepBudget.js')), { code: 'ENOENT' });
});
