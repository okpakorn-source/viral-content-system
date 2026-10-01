// ============================================================
// 🧪 tests/research-web-pipeline.test.mjs — Research Agent v2 ในท่อข่าว (เลน B · 1 ต.ค. 69 · SPEC-v2 ส่วน 3/9/10)
// ------------------------------------------------------------
// ส่วน A readCards (poll สั้น fail-open): นาฬิกา/timer ปลอมที่เทสเดินเอง — ไม่มี timer จริง ไม่พึ่ง unref
//   (บทเรียน CI node 22) · เส้นตายรวมใช้ manualPipelineDeadline (tests/helpers/fake-deadline.mjs) · await ครอบ settleWithin
// ส่วน B processAutoFlowText ตัวจริงทั้งฟังก์ชัน (แบบ tests/partial-angles-pl08) — '@/…' อื่นเป็นตัวปลอมในหน่วยความจำ ·
//   ปิดสวิตช์ต้อง "เหมือนซอร์สที่ถอด hook ทุกไบต์" (ผล/บันทึก/อินพุตนักเขียน · ยกเว้นตัวเลขเวลา) · shadow/assist ไม่แตะนักเขียน
// ส่วน C generationLogger allowlist (ไม่ส่งคีย์ = pipeline_info เดิมทุกไบต์) · usageLogger ราคา gpt-6-* (astra ทางการ $10/$50 ·
//   sol/luna ค่าประมาณ — ดู TODO)
// mutation (ข้อท้ายไฟล์): shadow รอ · ตัดเพดานงบเส้นตาย · ปิดสวิตช์แล้วยัง poll · autoFlow ถอดสวิตช์/ตัดการแนบ/ตัด pipeline_info ·
//   generationLogger ใส่ jobId เสมอ · ถอดราคา gpt-6-astra / กลับค่าประมาณเดิม 10/60 / สลับช่อง in-out
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manualPipelineDeadline, settleWithin } from './helpers/fake-deadline.mjs';
import { importPatchedModule } from './helpers/temp-module.mjs';
import { runWithPipelineDeadline } from '../src/lib/utils/pipelineDeadline.js';
import {
  agentResultOut1, createFakeSupabase, importSource, installResearchHooks, replaceOnce, ROOT, srcUrl,
} from './helpers/research-web-fakes.mjs';

const fnStub = (names) => names.map((n) => `export const ${n} = (...a) => globalThis.__RAP.${n}(...a);`).join('\n');
const SUPABASE_STUB = 'export const isSupabaseReady = () => globalThis.__RA_SB_READY !== false; export const getSupabase = () => globalThis.__RA_SB;';
const GENLOG_SUPABASE_STUB = `export const isSupabaseReady = () => true;
export const getSupabase = () => ({ from: () => { const q = { select: () => q, order: () => q, limit: () => q,
  insert: (row) => { (globalThis.__RA_GENLOG ||= []).push(row); return Promise.resolve({ error: null }); },
  then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject) }; return q; } });`;
const hooks = installResearchHooks({
  stubs: {
    '@/lib/supabase': SUPABASE_STUB,
    [srcUrl('lib/supabase.js')]: GENLOG_SUPABASE_STUB, // generationLogger ฉบับ patch (import สัมพัทธ์ถูกทำเป็น URL เต็ม)
    '@/lib/scraper/index.js': fnStub(['extractContent']),
    '@/lib/services/tiktokService': fnStub(['transcribeTiktok']),
    '@/lib/services/youtubeService': fnStub(['transcribeYoutube']),
    '@/lib/services/metaReelsService': fnStub(['transcribeMetaReel', 'isMetaVideoUrl']),
    '@/lib/services/researchService': fnStub(['performResearch']),
    '@/lib/utils/researchSwitch': fnStub(['isNewsResearchOn']),
    '@/lib/services/summarizeServiceText': fnStub(['performSummarize', 'getTopPrompts']),
    '@/lib/services/achievementResearch': fnStub(['smartResearch']),
    '@/lib/services/generationLogger': fnStub(['logGeneration']),
    '@/lib/auth': fnStub(['getSession']),
    '@/lib/pipelineLogger': fnStub(['logPipeline']),
    '@/lib/logger': fnStub(['createLogger']),
    '@/lib/correction/correctionPipeline': fnStub(['runCorrectionPipeline']),
    '@/lib/services/rawFactCompletenessGate': fnStub(['enforceRawFactCompleteness', 'isRawFactCompletenessGateEnabled', 'persistFactualReviewOrThrow']),
    '@/lib/workflow/workflowEngine': fnStub(['saveAnalysis', 'saveFactualReview']),
    '@/lib/ai/builtinFallbackPrompt': fnStub(['getBuiltinFallbackPrompt']),
    '@/lib/ai/legacyLengthRules': `${fnStub(['isLegacyLengthOn'])}\nexport const NEW_LENGTH_CFG = Object.freeze({ min: 146 });`,
    '@/lib/input-engine/narrativePayloadText': fnStub(['assignAngleClosings', 'closingTailMatches']),
    '@/lib/ai/factSourcePolicy': fnStub(['breakdownRawSourceArgs']),
    '@/lib/ai/cardAuthority': fnStub(['isCardAuthorityR6Enabled']),
    '@/lib/utils/textCleaner': fnStub(['cleanScrapedText']),
    'next/headers': fnStub(['cookies']),
  },
  parentStubs: [
    { specifier: '../supabase.js', parentEndsWith: '/generationLogger.js', source: GENLOG_SUPABASE_STUB },
    { specifier: '../db.js', parentEndsWith: '/usageLogger.js', source: 'export const prisma = { apiUsageLog: { create: async (args) => { (globalThis.__RA_USAGE ||= []).push(args); return args; } } };' },
  ],
});

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SRC = {
  readCards: read('src/lib/research-agent/readCards.js'),
  autoFlow: read('src/lib/services/autoFlowServiceText.js'),
  genLog: read('src/lib/services/generationLogger.js'),
  usage: read('src/lib/ai/usageLogger.js'),
};
const readCards = await import(srcUrl('lib/research-agent/readCards.js'));
const { buildResearchCardsDoc } = await import(srcUrl('lib/research-agent/cardsSchema.js'));

const JOB = 'q_ra1';
const WF = `unify_${JOB}`;
const NOW_ISO = '2026-10-01T06:05:00.000Z';
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

function fakeClock(start = 1_000_000) {
  let t = start;
  const timers = new Set();
  return {
    now: () => t,
    timers: {
      setTimer(fn, ms) { const h = { at: t + Math.max(0, Number(ms) || 0), fn }; timers.add(h); return h; },
      clearTimer(h) { timers.delete(h); },
    },
    pending: () => timers.size,
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        await flush();
        const due = [...timers].filter((h) => h.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at;
        timers.delete(due);
        due.fn();
      }
      t = target;
      await flush();
    },
  };
}

const cardDoc = (mode = 'shadow', result = agentResultOut1()) => buildResearchCardsDoc(result, { jobId: JOB, mode, nowIso: NOW_ISO }).doc;
const FAR = '2026-12-31T00:00:00.000Z';

function fakeStorage({ card = null, request = { id: JOB, status: 'leased', deadlineAt: FAR }, workers = [] } = {}) {
  const st = { card, request, workers, reads: 0, fail: 0, hang: false, gate: null };
  return {
    st,
    async getCards() {
      st.reads += 1;
      if (st.fail > 0) { st.fail -= 1; throw new Error('SECRET read failure'); }
      if (st.hang) return new Promise(() => {});
      if (st.gate) await st.gate;
      return clone(st.card);
    },
    async getRequest() { return clone(st.request); },
    async listWorkers() { return clone(st.workers); },
  };
}

function startPoll({ env = { RESEARCH_AGENT: '1' }, storage = fakeStorage(), clock = fakeClock(), deadline = null, logs = [], workflowId = WF, mod = readCards, loadStorage } = {}) {
  const poll = mod.startResearchAgentPoll({
    workflowId, deadline, env, now: clock.now, timers: clock.timers,
    loadStorage: loadStorage || (async () => storage),
    logPipeline: async (entry) => { logs.push(entry); },
  });
  return { poll, clock, storage, logs };
}

/** settle ต้องจบ "โดยไม่เดินนาฬิกา" (shadow/ผลสุดท้าย/งบหมด) — ถ้ายังรออยู่หลัง flush = แดง */
async function settleNow(poll) {
  const result = await Promise.race([poll.settle(), flush().then(() => 'STILL_WAITING')]);
  assert.notEqual(result, 'STILL_WAITING', 'settle ต้องไม่รอ (ท่อห้ามช้าลง)');
  return result;
}

// ── ส่วน A: readCards ─────────────────────────────────────────────
async function assertOffNull(mod) {
  let loads = 0;
  for (const env of [{}, { RESEARCH_AGENT: '0' }, { RESEARCH_AGENT: 'true' }]) {
    const clock = fakeClock(); // ฉีดนาฬิกาปลอมเสมอ — ฉบับกลายพันธุ์ที่เผลอเริ่ม poll จะได้ไม่ทิ้ง timer จริงค้าง process
    const handle = mod.startResearchAgentPoll({ workflowId: WF, env, now: clock.now, timers: clock.timers,
      loadStorage: async () => { loads += 1; return fakeStorage(); }, logPipeline: async () => {} });
    assert.equal(handle, null, JSON.stringify(env));
  }
  await flush();
  assert.equal(loads, 0, 'ปิดสวิตช์ = ไม่แตะฐาน');
}

test('readCards: ปิดสวิตช์ = null ไม่แตะฐาน · workflowId ไม่ใช่ unify_ = no_job', async () => {
  await assertOffNull(readCards);
  const { poll } = startPoll({ workflowId: 'auto_123' });
  await flush();
  const run = await settleNow(poll);
  assert.equal(run.summary.status, 'no_job');
  assert.equal(run.pipelineInfo.jobId, null);
});

test('readCards shadow: การ์ดเสร็จแล้ว = done + สรุปย่อ (ไม่มีเนื้อการ์ด) · ไม่รอ · log step research-agent · ไม่มี timer ค้าง', async () => {
  const { poll, clock, logs } = startPoll({ storage: fakeStorage({ card: cardDoc() }) });
  await flush();
  const run = await settleNow(poll);
  assert.equal(run.summary.status, 'done');
  assert.equal(run.summary.waitedMs, 0);
  assert.deepEqual(run.analysis, { status: 'done', mode: 'shadow', cardsCount: 1, flags: ['ORIGIN_NOT_FOUND'] });
  assert.equal(run.pipelineInfo.jobId, JOB);
  assert.equal(run.pipelineInfo.workflowId, WF);
  assert.deepEqual(run.pipelineInfo.researchAgent.brain, { kind: 'codex', model: 'gpt-6-astra', effort: 'low' });
  assert.equal(run.pipelineInfo.researchAgent.passCount, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].step, 'research-agent');
  assert.equal(logs[0].status, 'success');
  assert.equal(logs[0].metadata.cards, 1);
  assert.equal(clock.pending(), 0, 'ต้องไม่มี timer ค้าง');
});

async function assertShadowNoWait(mod) {
  const { poll, clock } = startPoll({ mod, storage: fakeStorage({ request: { id: JOB, status: 'leased', deadlineAt: FAR } }) });
  await flush();
  const run = await settleNow(poll);
  assert.equal(run.summary.status, 'pending');
  assert.equal(run.summary.requestStatus, 'leased');
  assert.equal(run.summary.waitedMs, 0);
  assert.equal(clock.pending(), 0, 'หยุด poll แล้วต้องไม่เหลือ timer');
}

test('readCards shadow: ยังไม่เสร็จ = pending ทันทีหลัง Blueprint (ท่อไม่รอ แม้ตั้ง WAIT_MS)', async () => {
  await assertShadowNoWait(readCards);
  const { poll } = startPoll({ env: { RESEARCH_AGENT: '1', RESEARCH_AGENT_WAIT_MS: '90000' }, storage: fakeStorage() });
  await flush();
  assert.equal((await settleNow(poll)).summary.status, 'pending');
});

test('readCards shadow: settle ระหว่างอ่านรอบแรก = รอแค่รอบนั้น (≤ 1.5 วิ) · อ่านค้าง = หมดเวลาแล้วไปต่อ', async () => {
  let release;
  const storage = fakeStorage({ card: cardDoc() });
  storage.st.gate = new Promise((resolve) => { release = resolve; });
  const { poll, clock } = startPoll({ storage });
  await flush();
  const pending = poll.settle();
  await flush();
  release();
  const run = await settleWithin(pending, 'settle ต้องจบเมื่ออ่านรอบที่วิ่งจบ');
  assert.equal(run.summary.status, 'done');
  assert.equal(clock.pending(), 0);

  const hang = fakeStorage();
  hang.st.hang = true;
  const h = startPoll({ storage: hang });
  await flush();
  const waiting = h.poll.settle();
  await h.clock.advance(1_500);
  const late = await settleWithin(waiting, 'grace 1.5 วิต้องปล่อย');
  assert.equal(late.summary.status, 'pending');
  assert.ok(late.summary.waitedMs <= 1_500);
});

test('readCards assist: การ์ดมาระหว่างรอ → ได้การ์ด (poll ทุก 5 วิ) · analysis มีการ์ด (ไม่รวม dropped)/raw_corrections/origin', async () => {
  const env = { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' };
  const storage = fakeStorage();
  const { poll, clock } = startPoll({ env, storage });
  await flush();
  const waiting = poll.settle();
  await clock.advance(5_000);
  assert.equal(storage.st.reads, 2, 'poll รอบ 2 ที่ 5 วิ');
  const result = { ...agentResultOut1(), raw_corrections: [{ field: 'จังหวัด', raw_value: 'ราชบุรี', source_value: 'ราชบุรี (อ.เมือง)', source_url: 'https://news.example.test/r', confidence: 0.7 }],
    cards: [...agentResultOut1().cards, { ...agentResultOut1().cards[0], id: 'R2', gate: 'dropped' }] };
  storage.st.card = cardDoc('assist', result);
  await clock.advance(5_000);
  const run = await settleWithin(waiting, 'assist ต้องได้การ์ดรอบที่ 3');
  assert.equal(run.summary.status, 'done');
  assert.equal(run.summary.polls, 3);
  assert.equal(run.summary.waitedMs, 10_000);
  assert.equal(run.analysis.mode, 'assist');
  assert.deepEqual(run.analysis.cards.map((c) => c.id), ['R1'], 'dropped ไม่ส่งให้บอท/หน้าเว็บ');
  assert.equal(run.analysis.raw_corrections.length, 1);
  assert.ok(run.analysis.flags.includes('RAW_CONTRADICTION'));
  assert.ok('origin_post' in run.analysis);
  assert.equal(clock.pending(), 0);
});

test('readCards assist: ไม่มาภายใน RESEARCH_AGENT_WAIT_MS = pending ตอนหมดหน้าต่าง (ไม่รอเกิน)', async () => {
  const { poll, clock } = startPoll({ env: { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist', RESEARCH_AGENT_WAIT_MS: '15000' } });
  await flush();
  const waiting = poll.settle();
  await clock.advance(14_999);
  assert.equal(await Promise.race([waiting.then(() => 'done'), flush().then(() => 'waiting')]), 'waiting');
  await clock.advance(1);
  const run = await settleWithin(waiting, 'หน้าต่าง 15 วิต้องปิด');
  assert.equal(run.summary.status, 'pending');
  assert.equal(run.summary.waitedMs, 15_000);
  assert.equal(clock.pending(), 0);
});

async function assertDeadlineReserve(mod) {
  const env = { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' };
  const deadlineWith = (remaining) => ({
    signal: new AbortController().signal,
    remainingMs: () => remaining,
    assertCanStart() { throw new Error('readCards ห้ามเรียก assertCanStart (จองงบเส้นตาย)'); },
  });
  const tight = startPoll({ mod, env, deadline: deadlineWith(490_000) });
  await flush();
  const waiting = tight.poll.settle();
  await tight.clock.advance(10_000);
  const run = await settleWithin(waiting, 'เหลือ 490 วิ → รอได้แค่ 10 วิ');
  assert.equal(run.summary.waitedMs, 10_000, 'รอได้เฉพาะส่วนที่เกินกันชน 480 วิ');
  const none = startPoll({ mod, env, deadline: deadlineWith(400_000) });
  await flush();
  const immediate = await settleNow(none.poll);
  assert.equal(immediate.summary.waitedMs, 0, 'เหลือ ≤ 480 วิ = ไม่รอเลย (ไม่กินงบ generate)');
}

test('readCards: เส้นตายรวม — รอได้เฉพาะเวลาที่เกินกันชน 480 วิ · ไม่เรียก assertCanStart', () => assertDeadlineReserve(readCards));

test('readCards: deadline abort ระหว่างรอ = จบทันที (manualPipelineDeadline.expire)', async () => {
  const manual = manualPipelineDeadline(700_000);
  const { poll } = startPoll({ env: { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' }, deadline: manual.deadline });
  await flush();
  const waiting = poll.settle();
  await flush();
  manual.expire();
  const run = await settleWithin(waiting, 'abort ต้องปล่อย settle');
  assert.equal(run.summary.status, 'pending');
});

test('readCards fail-open: โหลดฐานล้ม = unavailable · อ่านล้ม 3 ครั้งติด = error · อ่านค้าง = หมดเวลาแล้ว poll ต่อ · log ล้มไม่กระทบ · ไม่โยน', async () => {
  const down = startPoll({ loadStorage: async () => { throw new Error('SECRET supabase down'); } });
  await flush();
  assert.equal((await settleNow(down.poll)).summary.status, 'unavailable');

  const env = { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' };
  const failing = fakeStorage();
  failing.st.fail = 99;
  const f = startPoll({ env, storage: failing });
  await flush();
  const waitingF = f.poll.settle();
  await f.clock.advance(10_000);
  assert.equal((await settleWithin(waitingF, 'อ่านล้ม 3 ครั้งต้องจบ')).summary.status, 'error');

  const hanging = fakeStorage();
  hanging.st.hang = true;
  const h = startPoll({ env, storage: hanging });
  await flush();
  const waitingH = h.poll.settle();
  await h.clock.advance(4_000);
  assert.equal(hanging.st.reads, 1);
  await h.clock.advance(5_000);
  assert.equal(hanging.st.reads, 2, 'อ่านค้างหมดเวลาแล้วต้อง poll รอบใหม่');
  await h.clock.advance(4_000 + 5_000 + 4_000);
  assert.equal((await settleWithin(waitingH, 'อ่านค้าง 3 ครั้งต้องจบ')).summary.status, 'error');

  const badLog = readCards.startResearchAgentPoll({ workflowId: WF, env: { RESEARCH_AGENT: '1' }, loadStorage: async () => fakeStorage({ card: cardDoc() }),
    now: fakeClock().now, timers: fakeClock().timers, logPipeline: () => { throw new Error('log down'); } });
  await flush();
  assert.equal((await settleNow(badLog)).summary.status, 'done');
});

test('readCards: worker ออฟไลน์ (ใบขอยัง queued + ไม่มีชีพจร ≤ 10 นาที) = offline ไม่รอ · มีชีพจร = รอตามปกติ', async () => {
  const env = { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' };
  const clock = fakeClock(Date.parse('2026-10-01T06:00:00.000Z'));
  const offline = startPoll({ env, clock, storage: fakeStorage({ request: { id: JOB, status: 'queued', deadlineAt: FAR }, workers: [{ lastSeenAt: '2026-10-01T05:40:00.000Z' }] }) });
  await flush();
  assert.equal((await settleNow(offline.poll)).summary.status, 'offline');
  const online = startPoll({ env, clock: fakeClock(Date.parse('2026-10-01T06:00:00.000Z')), storage: fakeStorage({ request: { id: JOB, status: 'queued', deadlineAt: FAR }, workers: [{ lastSeenAt: '2026-10-01T05:59:00.000Z' }] }) });
  await flush();
  const waiting = online.poll.settle();
  assert.equal(await Promise.race([waiting.then(() => 'done'), flush().then(() => 'waiting')]), 'waiting', 'worker ยังอยู่ = รอได้');
  await online.clock.advance(90_000);
  await settleWithin(waiting, 'หน้าต่างต้องปิด');
});

test('readCards: ใบขอเลย deadline (queued/leased) = expired เลิกรอทันที · ใบขอ failed = failed', async () => {
  const env = { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' };
  for (const status of ['queued', 'leased']) {
    const clock = fakeClock(Date.parse('2026-10-01T06:10:00.000Z'));
    const { poll } = startPoll({ env, clock, storage: fakeStorage({ request: { id: JOB, status, deadlineAt: '2026-10-01T06:07:00.000Z' }, workers: [{ lastSeenAt: '2026-10-01T06:09:00.000Z' }] }) });
    await flush();
    assert.equal((await settleNow(poll)).summary.status, 'expired', status);
  }
  const failed = startPoll({ env, storage: fakeStorage({ request: { id: JOB, status: 'failed', deadlineAt: FAR } }) });
  await flush();
  assert.equal((await settleNow(failed.poll)).summary.status, 'failed');
  const none = startPoll({ env, storage: fakeStorage({ request: null }) });
  await flush();
  assert.equal((await settleNow(none.poll)).summary.status, 'no_request', 'งานที่ไม่มีใบขอ (เช่นเว็บยิงตรง) = ไม่รอ');
});

test('readCards: โค้ดไม่ใช้ withTimeoutSignal/assertCanStart/import pipelineDeadline (ไม่จองงบเส้นตายรวม)', () => {
  const code = SRC.readCards.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /withTimeoutSignal|assertCanStart|reservePipelineStepMs|preparePipelineSignal/);
  assert.doesNotMatch(code, /from '@\/lib\/utils\/(withTimeout|pipelineDeadline)'/);
});

// ── ส่วน B: processAutoFlowText ตัวจริง ─────────────────────────────
const THAI_BODY = 'ชาวสวีเดนสวมขาเทียม 1 ข้าง ช่วยชาวบ้านราชบุรีตักทรายใส่กระสอบรับมือน้ำขึ้นสูงอย่างไม่ย่อท้อ สาวรายหนึ่งเล่าว่าเขาทำงานเคียงข้างคนในพื้นที่ทั้งวัน และบอกว่าเราทุกคนทำอะไรบางอย่างได้ ';
const LONG_CONTENT = (tag) => Array.from({ length: 3 }, (_, i) => `ย่อหน้า ${i + 1} ของ ${tag}: ${THAI_BODY}${THAI_BODY}`).join('\n\n');
const ANGLES = [{ angle_name: 'มุมน้ำใจข้ามชาติ', description: 'ชาวต่างชาติช่วยชาวบ้าน' }, { angle_name: 'มุมขาเทียม', description: 'ข้อจำกัดไม่ใช่อุปสรรค' }];

function freshState() {
  const S = {
    saved: [], genLogs: [], pipelineLogs: [], writerInputs: [],
    extractContent: async () => ({ success: false }), transcribeTiktok: async () => ({ success: false }),
    transcribeYoutube: async () => ({ success: false }), transcribeMetaReel: async () => ({ success: false }), isMetaVideoUrl: () => false,
    performResearch: async () => ({ items: [] }), isNewsResearchOn: () => false, smartResearch: async () => null,
    logGeneration: async (args) => { S.genLogs.push(clone(args)); return { success: true, caseId: '06499' }; },
    getSession: async () => null,
    logPipeline: async (entry) => { S.pipelineLogs.push(clone(entry)); },
    createLogger: () => new Proxy({}, { get: () => () => {} }),
    isRawFactCompletenessGateEnabled: () => false,
    enforceRawFactCompleteness: async () => { throw new Error('ด่าน RAW ปิดในเทสนี้'); },
    persistFactualReviewOrThrow: async () => ({}), saveFactualReview: async () => ({}),
    saveAnalysis: async (id, analysisResult, presetId) => { S.saved.push(clone({ id, analysisResult, presetId })); return { id }; },
    getBuiltinFallbackPrompt: () => ({ id: 'fallback_builtin', promptName: 'Built-in' }),
    isLegacyLengthOn: () => false, assignAngleClosings: () => [], closingTailMatches: () => false,
    breakdownRawSourceArgs: () => ({}), isCardAuthorityR6Enabled: () => false, cleanScrapedText: (s) => s,
    cookies: async () => ({ get: () => undefined }),
    runCorrectionPipeline: async (versions) => versions.map((v) => ({ ...v, _correctionApplied: true })),
    getTopPrompts: async ({ excludePromptIds = [] }) => {
      const n = excludePromptIds.length + 1;
      return { prompts: [{ id: `card_${n}`, promptName: `การ์ด ${n}`, tone: 'อบอุ่น', hookStyle: 'เปิดด้วยภาพ', _matchScore: 90, _matchType: 'AI_PICKED' }],
        newsAnalysis: { category: 'ข่าวน้ำดี' }, _promptLib: [{ id: 'lib' }], _catalogPicks: [] };
    },
    performSummarize: async (input) => {
      const { signal, ...rest } = input;
      S.writerInputs.push(clone(rest));
      if (input.mode === 'extract') return { success: true, data: { newsTitle: 'ชาวสวีเดนขาเทียมช่วยชาวบ้านราชบุรี', newsBody: THAI_BODY.repeat(2) } };
      if (input.mode === 'breakdown') return { success: true, data: { key_points: ['ช่วยตักทราย', 'สวมขาเทียม'], primaryCategory: 'ข่าวน้ำดี', core_story: 'น้ำใจ', possible_angles: ANGLES } };
      if (input.mode === 'blueprint') return { success: true, data: { blueprint: { core_emotion: 'ซึ้ง', emotional_timeline: [] } } };
      const cardId = input.presetPrompt?.id;
      return { success: true, data: { usedModel: 'claude-opus-5-5',
        versions: [{ style: 'แนว', title: `พาดหัว ${cardId}`, content: LONG_CONTENT(cardId) }],
        usedPreset: { id: 'library', name: `การ์ด ${cardId}`, source: 'library', promptId: cardId, promptName: `การ์ด ${cardId}` },
        debug: { promptMatchReason: 'stub' } } };
    },
  };
  return S;
}
globalThis.__RAP = freshState(); // autoFlowServiceText เรียก createLogger ตอนโหลด

const RA_ENV_KEYS = ['RESEARCH_AGENT', 'RESEARCH_AGENT_MODE', 'RESEARCH_AGENT_WAIT_MS', 'RESEARCH_AGENT_MAX_MINUTES', 'PARTIAL_ANGLES'];
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(RA_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of RA_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const k of RA_ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const AUTO_FLOW_URL = srcUrl('lib/services/autoFlowServiceText.js');
const cut = (source, start, end) => {
  const i = source.indexOf(start);
  const j = source.indexOf(end, i);
  assert.ok(i >= 0 && j > i && source.indexOf(start, i + 1) < 0, `ต้องพบบล็อก hook: ${start.slice(0, 50)}`);
  return source.slice(0, i) + source.slice(j);
};
/** autoFlowServiceText ที่ถอด hook รีเสิร์ชทั้ง 4 จุดออก (= ต้นฉบับก่อนเลน B — ตรวจไบต์ตรงกับ backup แล้วตอนเขียน) */
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 · เลน W1): + ถอด hook โหมด write 3 จุด (จุดเสียบหลังสกัด · มุมเสนอใน args แตกประเด็น ·
//   ข้อเท็จจริงการ์ดใน correctionResearchFacts) — ซอร์สที่ถอดแล้วยังเป็น "ก่อนมีรีเสิร์ชเอเจนต์" (บล็อก writerRawSourceText ที่ย้ายที่ = ข้อความเดิม)
//   ข้อสอบเดิมไม่เปลี่ยน — ปิดสวิตช์ต้องเหมือนซอร์สนี้ทุกไบต์ (ครอบ hook โหมด write ด้วย) · ซอร์สถอดเฉพาะโหมด write อยู่ใน tests/research-write-pipeline
function stripAutoFlowHook(source) {
  let s = cut(source, '  // ★ 1 ต.ค. 69 (Research Agent v2 · เลน B · SPEC-v2 ส่วน 9 · ไฟล์ล็อก', '  const [bpSettled, srSettled] = await Promise.allSettled([');
  s = cut(s, '  // ★ 1 ต.ค. 69 (Research Agent v2): ปิดรอบอ่านการ์ด', '  const stepGenStart = Date.now();');
  s = cut(s, '  // ★ 1 ต.ค. 69 (Research Agent v2 · เลน B · SPEC-v2 ส่วน 3/9)', '  const generationLogAttempt = await settleTelemetryWithinReserve(');
  s = cut(s, '        // ★ 1 ต.ค. 69 (Research Agent v2): {researchAgent, jobId, workflowId}', '      },\n      userId: _user.userId,');
  s = cut(s, '  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3) — จุดเสียบหลังขั้นสกัด', '  // ★ 21 ส.ค. 69: เก็บข้อความที่ผู้ใช้วางไว้แยกจาก newsData.newsBody');
  s = cut(s, '    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3): มุมเสนอ', "  }), 300000, 'breakdown');");
  s = cut(s, '    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3): + ข้อเท็จจริงของการ์ด', '    .filter(Boolean)\n    .join(');
  assert.doesNotMatch(s, /_researchWrite/, 'ซอร์สที่ถอดแล้วต้องไม่มี hook โหมด write หลงเหลือ');
  assert.doesNotMatch(s, /research-agent|_researchAgent/, 'ซอร์สที่ถอดแล้วต้องไม่มี hook หลงเหลือ');
  return s;
}

async function runPipeline(mod, { env = {}, seed = null, sbReady = true } = {}) {
  globalThis.__RAP = freshState();
  const S = globalThis.__RAP;
  const sb = createFakeSupabase();
  globalThis.__RA_SB = sb;
  globalThis.__RA_SB_READY = sbReady;
  if (seed) seed(sb);
  const resolvedBefore = hooks.resolved.length;
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const { deadline } = manualPipelineDeadline(700_000);
  try {
    const res = await withEnv(env, () => settleWithin(runWithPipelineDeadline(deadline, () => mod.processAutoFlowText({
      text: THAI_BODY.repeat(2), sourceType: 'plain_text', workflowId: WF, user: { userId: 'discord-555', userName: 'tester' },
    })), 'processAutoFlowText ไม่จบ (ตัวปลอมตอบทันที — ห้ามค้าง)'));
    return { res, S, sb, researchImports: hooks.resolved.slice(resolvedBefore).filter((s) => s.startsWith('@/lib/research-agent/')) };
  } finally {
    Object.assign(console, original);
  }
}

/** ตัดตัวเลขเวลา (ต่างกันตามความเร็วเครื่อง) ออกก่อนเทียบไบต์ */
function comparable(run) {
  const data = clone(run.res.data);
  delete data.totalTimeSeconds;
  delete data.stepTimings;
  const genLogs = run.S.genLogs.map((args) => ({ ...args, pipelineInfo: { ...args.pipelineInfo, totalTime: 0, stepTimings: null } }));
  const text = JSON.stringify({ data, genLogs, saved: run.S.saved, writer: run.S.writerInputs, pipelineLogs: run.S.pipelineLogs.map(({ duration, ...e }) => e) });
  return text.replace(/\d+\.\d+s/g, 'Xs');
}

const seedDone = (mode = 'shadow', result = agentResultOut1()) => (sb) => {
  sb.seed(`rreq_${JOB}`, 'research-requests', { id: JOB, workflowId: WF, status: 'done', deadlineAt: FAR, revision: 3 });
  sb.seed(`rcard_${JOB}`, 'research-cards', cardDoc(mode, result));
};

async function assertAutoFlowOffParity(current, original) {
  const now = await runPipeline(current);
  const before = await runPipeline(original);
  assert.equal(now.res.success, true);
  assert.equal(comparable(now), comparable(before), 'ปิดสวิตช์: ผล/บันทึก/อินพุตนักเขียน ต้องเหมือนซอร์สที่ถอด hook ทุกไบต์');
  assert.deepEqual(now.researchImports, [], 'ปิดสวิตช์ห้าม import โมดูลรีเสิร์ช');
  assert.equal(now.sb.calls.length, 0, 'ปิดสวิตช์ห้ามแตะ store รีเสิร์ช');
  assert.equal('researchAgent' in now.res.data.analysisResult, false);
  for (const key of ['researchAgent', 'jobId', 'workflowId']) assert.equal(key in now.S.genLogs[0].pipelineInfo, false, key);
}

test('autoFlow ปิดสวิตช์ (ไม่ตั้ง RESEARCH_AGENT): เหมือนซอร์สที่ถอด hook ทุกไบต์ · ไม่ import · ไม่แตะ store รีเสิร์ช', async () => {
  const current = await import(AUTO_FLOW_URL);
  const original = await importSource(stripAutoFlowHook(SRC.autoFlow), 'autoflow-original');
  await assertAutoFlowOffParity(current, original);
});

async function assertShadowWiring(mod, off) {
  const on = await runPipeline(mod, { env: { RESEARCH_AGENT: '1' }, seed: seedDone() });
  assert.equal(on.res.success, true);
  assert.deepEqual(on.res.data.analysisResult.researchAgent, { status: 'done', mode: 'shadow', cardsCount: 1, flags: ['ORIGIN_NOT_FOUND'] });
  const info = on.S.genLogs[0].pipelineInfo;
  assert.equal(info.researchAgent?.status, 'done');
  assert.equal(info.researchAgent.mode, 'shadow');
  assert.equal(info.researchAgent.cardsCount, 1);
  assert.equal(info.jobId, JOB);
  assert.equal(info.workflowId, WF);
  assert.ok(on.S.pipelineLogs.some((e) => e.step === 'research-agent' && e.status === 'success'));
  assert.ok(on.res.data.log.some((line) => line.includes('🔎 shadow: done')));
  assert.equal(JSON.stringify(on.S.writerInputs), JSON.stringify(off.S.writerInputs), 'shadow ห้ามแตะอินพุตนักเขียน/blueprint/breakdown');
  assert.equal(JSON.stringify(on.S.saved), JSON.stringify(off.S.saved), 'snapshot ที่บันทึก (ผ่านด่านแล้ว) ต้องไบต์เดิม');
}

test('autoFlow shadow: analysisResult.researchAgent = {status,mode,cardsCount,flags} · pipeline_info ได้ researchAgent/jobId/workflowId · นักเขียน/snapshot ไม่เปลี่ยน', async () => {
  const current = await import(AUTO_FLOW_URL);
  const off = await runPipeline(current);
  await assertShadowWiring(current, off);
});

test('autoFlow assist: การ์ด/raw_corrections/origin ถึง analysisResult (บอทแสดง) · ยังไม่ส่งนักเขียน/ด่าน', async () => {
  const current = await import(AUTO_FLOW_URL);
  const off = await runPipeline(current);
  const result = { ...agentResultOut1(), raw_corrections: [{ field: 'อำเภอ', raw_value: 'ราชบุรี', source_value: 'เมืองราชบุรี', source_url: 'https://news.example.test/r', confidence: 0.7 }] };
  const on = await runPipeline(current, { env: { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' }, seed: seedDone('assist', result) });
  const ra = on.res.data.analysisResult.researchAgent;
  assert.equal(ra.mode, 'assist');
  assert.equal(ra.cards.length, 1);
  assert.equal(ra.cards[0].gate, 'pass');
  assert.equal(ra.raw_corrections.length, 1);
  assert.ok(ra.flags.includes('RAW_CONTRADICTION'));
  assert.equal(JSON.stringify(on.S.writerInputs), JSON.stringify(off.S.writerInputs), 'assist เฟส 1 ห้ามส่งการ์ดเข้านักเขียน');
  assert.equal(JSON.stringify(on.S.genLogs[0].pipelineInfo).includes('ขอแรงช่วยกรอกกระสอบทราย'), false, 'pipeline_info ไม่เก็บเนื้อการ์ด');
});

test('autoFlow fail-open: ฐานรีเสิร์ชไม่พร้อม/อ่านล้ม/โมดูลพัง → ข่าวสำเร็จตามปกติ', async () => {
  const current = await import(AUTO_FLOW_URL);
  const unready = await runPipeline(current, { env: { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' }, sbReady: false });
  assert.equal(unready.res.success, true);
  assert.equal(unready.res.data.analysisResult.researchAgent.status, 'unavailable');
  const failing = await runPipeline(current, { env: { RESEARCH_AGENT: '1' }, seed: (sb) => sb.failNext(99, { mode: 'throw' }) });
  assert.equal(failing.res.success, true);
  assert.ok(['pending', 'error'].includes(failing.res.data.analysisResult.researchAgent.status));
  hooks.overrides.set('@/lib/research-agent/readCards', `data:text/javascript,${encodeURIComponent('throw new Error("module boom");')}`);
  try {
    const fresh = await importSource(SRC.autoFlow, 'autoflow-modfail');
    const broken = await runPipeline(fresh, { env: { RESEARCH_AGENT: '1' }, seed: seedDone() });
    assert.equal(broken.res.success, true);
    assert.equal('researchAgent' in broken.res.data.analysisResult, false);
    assert.equal('researchAgent' in broken.S.genLogs[0].pipelineInfo, false);
  } finally {
    hooks.overrides.delete('@/lib/research-agent/readCards');
  }
});

// ── ส่วน C: generationLogger + usageLogger ─────────────────────────
const GENLOG_URL = new URL('../src/lib/services/generationLogger.js', import.meta.url);
function stripGenLog(source) {
  let s = cut(source, '// ★ 1 ต.ค. 69 (Research Agent v2 · เลน B · SPEC-v2 ส่วน 9/10)', '// ─── Main Log Function');
  s = cut(s, '        ...compactResearchAgentPipelineInfo(pipelineInfo),', '      },\n      userId: userId ||');
  return s;
}
const GEN_ARGS = () => ({
  sourceType: 'plain_text', newsTitle: 'ชาวสวีเดน', sourceText: 'ข่าว',
  versions: [{ title: 't', content: 'เนื้อ', usedModel: 'claude-opus-5-5' }],
  pipelineInfo: { contentLength: 'short', totalTime: 12.5, promptName: 'การ์ด 1', promptSource: 'library', promptScore: 90,
    promptMatchType: 'MATCHED', promptId: 'card_1', newsType: 'ข่าวน้ำดี', writerModels: ['claude-opus-5-5'],
    stepTimings: { extract: '1.0' }, desk: null, blueprint: 'ซึ้ง', researchCount: 0 },
});

async function pipelineInfoOf(mod, args) {
  globalThis.__RA_GENLOG = [];
  const result = await mod.logGeneration(args);
  assert.equal(result.success, true, result.error);
  return globalThis.__RA_GENLOG[0].pipeline_info;
}

async function assertGenLogParity(current, original) {
  const now = await pipelineInfoOf(current, GEN_ARGS());
  const before = await pipelineInfoOf(original, GEN_ARGS());
  assert.equal(JSON.stringify(now), JSON.stringify(before), 'ไม่ส่งคีย์รีเสิร์ช = pipeline_info เดิมทุกไบต์ (รวมลำดับคีย์)');
  assert.deepEqual(Object.keys(now), ['contentLength', 'totalTime', 'promptName', 'promptSource', 'promptScore', 'promptMatchType', 'promptId', 'newsType', 'writerModels', 'stepTimings', 'desk']);
}

test('generationLogger: ไม่ส่งคีย์รีเสิร์ช = pipeline_info เหมือนซอร์สที่ถอดของใหม่ทุกไบต์ · ส่งมา = researchAgent ย่อ + jobId + workflowId', async () => {
  const current = await import(GENLOG_URL.href);
  const original = await importPatchedModule(stripGenLog(SRC.genLog), GENLOG_URL, 'genlog-original');
  await assertGenLogParity(current, original);
  const args = GEN_ARGS();
  args.pipelineInfo.researchAgent = { status: 'done', mode: 'shadow', cardsCount: 2, passCount: 1, flags: Array.from({ length: 30 }, (_, i) => `FLAG_${i}`),
    requestStatus: 'done', revision: 3, brain: { kind: 'codex', model: 'gpt-6-astra', effort: 'low', secret: 'nope' }, ms: 1234, waitedMs: 0, polls: 2,
    cards: [{ claim: 'ไม่ควรถูกเก็บ' }] };
  args.pipelineInfo.jobId = JOB;
  args.pipelineInfo.workflowId = WF;
  const info = await pipelineInfoOf(current, args);
  assert.equal(info.jobId, JOB);
  assert.equal(info.workflowId, WF);
  assert.equal(info.researchAgent.flags.length, 20);
  assert.deepEqual(info.researchAgent.brain, { kind: 'codex', model: 'gpt-6-astra', effort: 'low' });
  assert.equal('cards' in info.researchAgent, false, 'ไม่เก็บเนื้อการ์ดใน pipeline_info');
  assert.equal(info.blueprint, undefined, 'คีย์เดิมที่ allowlist ทิ้งยังถูกทิ้งเหมือนเดิม');
});

const USAGE_URL = new URL('../src/lib/ai/usageLogger.js', import.meta.url);
async function costOf(mod, model, inputTokens = 1_000_000, outputTokens = 1_000_000) {
  globalThis.__RA_USAGE = [];
  await mod.logApiUsage({ provider: 'openai', model, inputTokens, outputTokens });
  return globalThis.__RA_USAGE[0].data.costUsd;
}
async function assertGpt6Prices(mod) {
  // astra = ราคาทางการ $10/1M in · $50/1M out (1 ต.ค. 69 · ค่าเดียวกับ pricing.mjs เลน A) — แยก in/out กันสลับช่อง
  assert.equal(await costOf(mod, 'gpt-6-astra', 1_000_000, 0), 10, 'astra input $10/1M');
  assert.equal(await costOf(mod, 'gpt-6-astra', 0, 1_000_000), 50, 'astra output $50/1M');
  assert.equal(await costOf(mod, 'gpt-6-astra'), 60);
  assert.equal(await costOf(mod, 'gpt-6-astra-2026-09-01'), 60, 'ชื่อมีวันที่ต่อท้ายต้องจับแถวเดียวกัน');
  assert.equal(await costOf(mod, 'gpt-6-sol'), 35);
  assert.equal(await costOf(mod, 'gpt-6-luna'), 7);
  assert.equal(await costOf(mod, 'gpt-5.6-sol'), 35, 'แถวเดิมไม่เปลี่ยน');
  assert.equal(await costOf(mod, 'gpt-5.6-luna'), 7);
}

test('usageLogger: astra ราคาทางการ $10/$50 ต่อ 1M (1 ต.ค. 69) · sol/luna ค่าประมาณ (TODO ยืนยัน) ไม่เป็น $0 · แถวเดิมไม่เปลี่ยน', async () => {
  const quiet = console.log;
  console.log = () => {};
  try { await assertGpt6Prices(await import(USAGE_URL.href)); } finally { console.log = quiet; }
});

// ── mutation ─────────────────────────────────────────────────────
test('mutation: ทุบสวิตช์/เพดาน/การต่อสายแล้วข้อสอบต้องแดง (และของจริงเขียว)', async () => {
  const rcMutations = [
    ['shadow รอเหมือน assist', '      const windowEnd = Math.min(startedAt + waitMs, budgetEnd);', '      const windowEnd = Math.min(startedAt + waitMs + 60_000, budgetEnd);', assertShadowNoWait],
    ['ตัดกันชนงบเส้นตาย', '      const budgetEnd = Number.isFinite(remaining) ? settleStartedAt + Math.max(0, remaining - reserveMs) : Number.POSITIVE_INFINITY;', '      const budgetEnd = Number.POSITIVE_INFINITY;', assertDeadlineReserve],
    ['ปิดสวิตช์แล้วยัง poll', '  if (!isResearchAgentOn(env)) return null;\n  const mode', '  const mode', assertOffNull],
  ];
  for (const [index, [label, search, replacement, check]] of rcMutations.entries()) {
    const mutated = await importSource(replaceOnce(SRC.readCards, search, replacement, label), `readcards-mut-${index}`);
    await assert.rejects(Promise.resolve().then(() => check(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  const original = await importSource(stripAutoFlowHook(SRC.autoFlow), 'autoflow-original-m');
  const off = await runPipeline(await import(AUTO_FLOW_URL));
  const afMutations = [
    ['ถอดสวิตช์ (เปิดตลอด)', '  const _researchAgentPoll = process.env.RESEARCH_AGENT\n', '  const _researchAgentPoll = true\n', (m) => assertAutoFlowOffParity(m, original)],
    ['ตัดการแนบ analysisResult.researchAgent', '  if (_researchAgentRun) analysisResult.researchAgent = _researchAgentRun.analysis;\n', '', (m) => assertShadowWiring(m, off)],
    ['ตัด pipeline_info รีเสิร์ช', '        ...(_researchAgentRun ? _researchAgentRun.pipelineInfo : {}),\n', '', (m) => assertShadowWiring(m, off)],
  ];
  for (const [index, [label, search, replacement, check]] of afMutations.entries()) {
    const mutated = await importSource(replaceOnce(SRC.autoFlow, search, replacement, label), `autoflow-mut-${index}`);
    await assert.rejects(Promise.resolve().then(() => check(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  const genMut = await importPatchedModule(replaceOnce(SRC.genLog, "  if (typeof source.jobId === 'string' && source.jobId) out.jobId = source.jobId.slice(0, 120);",
    '  out.jobId = source.jobId ?? null;', 'genlog jobId'), GENLOG_URL, 'genlog-mut');
  const genOriginal = await importPatchedModule(stripGenLog(SRC.genLog), GENLOG_URL, 'genlog-original-m');
  await assert.rejects(assertGenLogParity(genMut, genOriginal), 'ใส่ jobId เสมอ: byte-parity ต้องแดง');
  const ASTRA_ROW = "  'gpt-6-astra': { input: 10.0, output: 50.0 },\n";
  const usageMutations = [
    ['ถอดราคา astra', ''],
    ['astra กลับเป็นค่าประมาณเดิม 10/60', "  'gpt-6-astra': { input: 10.0, output: 60.0 },\n"],
    ['astra สลับช่อง in/out', "  'gpt-6-astra': { input: 50.0, output: 10.0 },\n"],
  ];
  const quiet = console.log;
  console.log = () => {};
  try {
    for (const [index, [label, replacement]] of usageMutations.entries()) {
      const usageMut = await importPatchedModule(replaceOnce(SRC.usage, ASTRA_ROW, replacement, label), USAGE_URL, `usage-mut-${index}`);
      await assert.rejects(assertGpt6Prices(usageMut), `${label}: ข้อสอบต้องแดง`);
    }
    await assertGpt6Prices(await import(USAGE_URL.href));
  } finally { console.log = quiet; }
  // ของจริงเขียว
  await assertShadowNoWait(readCards);
  await assertDeadlineReserve(readCards);
  await assertOffNull(readCards);
  await assertAutoFlowOffParity(await import(AUTO_FLOW_URL), original);
  await assertShadowWiring(await import(AUTO_FLOW_URL), off);
  await assertGenLogParity(await import(GENLOG_URL.href), genOriginal);
});
