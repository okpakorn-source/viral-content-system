// ============================================================
// 🧪 tests/research-write-pipeline.test.mjs — Research Agent v2 โหมด write ในท่อข่าว (SPEC-v3 ส่วน 3/8 · เลน W1)
// ------------------------------------------------------------
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3) — ไฟล์ใหม่
//   A. readCards.waitResearchCards — นาฬิกา/timer ปลอมที่เทสเดินเอง (ไม่มี timer จริง · ไม่ unref) + เส้นตายรวมปลอม (manualPipelineDeadline):
//      การ์ดมาแล้ว/มาระหว่างรอ · maxWait นับจากเริ่มท่อ · กันชน 480s · abort · offline/expired/no_request · อ่านล้ม · ปิดสวิตช์
//   B. writeStage.runResearchWriteStage — wait/editor/AI/ที่เก็บฉีดได้: done/not_ready/skipped/failed/งบไม่พอ/บันทึกล้ม/พังกลางทาง (fail-open)
//   C. processAutoFlowText ตัวจริง (แบบ tests/research-web-pipeline) — '@/…' อื่นเป็นตัวปลอม · callClaude ปลอม (ไม่ยิง API จริง):
//      write done = ฉบับเสริมถึงแตกประเด็น/blueprint/การ์ด/รีเสิร์ชต่อมุม/นักเขียน/correction/ด่าน RAW + มุมเสนอ + การ์ดเป็น researchFacts
//      not_ready/บรรณาธิการล้ม/ด่านตัด = อินพุตทุกขั้นเท่าปิดสวิตช์ทุกไบต์ · ช่อง PRE-GENERATE ไม่ poll ซ้ำ · สาย URL ไม่เข้าโหมด write
//      ปิดสวิตช์/shadow/assist = เหมือนซอร์สที่ถอด hook โหมด write ทุกไบต์ (เทียบผลชุดเดียวกับ research-web-pipeline) + ไม่ import writeStage
//   D. store research-editor (สัญญา 8.1 · ไม่เก็บฉบับเสริมเต็ม) · GET /api/research/cards ช่อง editor · cardsSchema ฟิลด์ใหม่ 8.3
//      (ผลเก่าไบต์เดิม) · generationLogger allowlist editor · modes write 300000
//   E. mutation ≥ 8 แบบ — ข้อสอบต้องแดงทุกแบบ ของจริงเขียว
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

const fnStub = (names) => names.map((n) => `export const ${n} = (...a) => globalThis.__RWP.${n}(...a);`).join('\n');
const SUPABASE_STUB = 'export const isSupabaseReady = () => globalThis.__RA_SB_READY !== false; export const getSupabase = () => globalThis.__RA_SB;';
const GENLOG_SUPABASE_STUB = `export const isSupabaseReady = () => true;
export const getSupabase = () => ({ from: () => { const q = { select: () => q, order: () => q, limit: () => q,
  insert: (row) => { (globalThis.__RW_GENLOG ||= []).push(row); return Promise.resolve({ error: null }); },
  then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject) }; return q; } });`;
const hooks = installResearchHooks({
  stubs: {
    '@/lib/supabase': SUPABASE_STUB,
    [srcUrl('lib/supabase.js')]: GENLOG_SUPABASE_STUB,
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
    '@/lib/ai/cardAuthority': fnStub(['isCardAuthorityR6Enabled']),
    '@/lib/utils/textCleaner': fnStub(['cleanScrapedText']),
    '@/lib/ai/claudeClient': fnStub(['callClaude']),
    'next/headers': fnStub(['cookies']),
  },
  parentStubs: [{ specifier: '../supabase.js', parentEndsWith: '/generationLogger.js', source: GENLOG_SUPABASE_STUB }],
});

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SRC = {
  readCards: read('src/lib/research-agent/readCards.js'),
  writeStage: read('src/lib/research-agent/writeStage.js'),
  store: read('src/lib/research-agent/store.js'),
  schema: read('src/lib/research-agent/cardsSchema.js'),
  modes: read('src/lib/research-agent/modes.js'),
  route: read('src/app/api/research/cards/route.js'),
  autoFlow: read('src/lib/services/autoFlowServiceText.js'),
  genLog: read('src/lib/services/generationLogger.js'),
};
const readCards = await import(srcUrl('lib/research-agent/readCards.js'));
const writeStage = await import(srcUrl('lib/research-agent/writeStage.js'));
const storeMod = await import(srcUrl('lib/research-agent/store.js'));
const schema = await import(srcUrl('lib/research-agent/cardsSchema.js'));
const modes = await import(srcUrl('lib/research-agent/modes.js'));
const cardsRoute = await import(srcUrl('app/api/research/cards/route.js'));
const GENLOG_URL = new URL('../src/lib/services/generationLogger.js', import.meta.url);
const genLog = await import(GENLOG_URL.href);
const AUTO_FLOW_URL = srcUrl('lib/services/autoFlowServiceText.js');

const JOB = 'q_rw1';
const WF = `unify_${JOB}`;
const NOW_ISO = '2026-10-01T06:05:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const FAR = '2026-12-31T00:00:00.000Z';
const WRITE_ENV = Object.freeze({ RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'write' });
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** นาฬิกา + timer ปลอม (เทสเดินเอง) · บันทึก args ของ setTimer ไว้พิสูจน์ว่าไม่ขอ background/unref */
function fakeClock(start = NOW_MS) {
  let t = start;
  const timers = new Set();
  const calls = [];
  return {
    now: () => t,
    calls,
    timers: {
      setTimer(fn, ms, ...rest) { calls.push(rest); const h = { at: t + Math.max(0, Number(ms) || 0), fn }; timers.add(h); return h; },
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

// ── fixture ข่าว (ชาวสวีเดนขาเทียม — ผลจริงของเอเจนต์ out1) ──────────────
const RAW_TEXT = 'ชาวสวีเดนสวมขาเทียม 1 ข้าง ช่วยชาวบ้านราชบุรีตักทรายใส่กระสอบรับมือน้ำขึ้นสูงอย่างไม่ย่อท้อ สาวรายหนึ่งเล่าว่าเขาทำงานเคียงข้างคนในพื้นที่ทั้งวัน และบอกว่าเราทุกคนทำอะไรบางอย่างได้';
const ADDED = 'ช่วงเดียวกันมีการขอแรงช่วยกรอกกระสอบทรายกั้นน้ำที่เขื่อนเทศบาลเมืองราชบุรี';
const ENRICHED_LINES = [
  'ชาวสวีเดนสวมขาเทียม 1 ข้าง ช่วยชาวบ้านราชบุรีตักทรายใส่กระสอบรับมือน้ำขึ้นสูงอย่างไม่ย่อท้อ',
  ADDED,
  'สาวรายหนึ่งเล่าว่าเขาทำงานเคียงข้างคนในพื้นที่ทั้งวัน และบอกว่าเราทุกคนทำอะไรบางอย่างได้',
];
const ENRICHED_PROSE = ENRICHED_LINES.join(' ');
const AGENT_DIM = 'มุมน้ำใจข้ามชาติในวันน้ำขึ้น';
const EDITOR_DIM = 'มุมชุมชนช่วยกันกั้นน้ำ';
const R1_CLAIM = agentResultOut1().cards[0].claim;
const claudeReplyOk = () => ({
  enriched_source: ENRICHED_LINES.join('\n'),
  used_cards: ['R1'],
  corrections: [],
  additions: [{ text: 'มีการขอแรงกรอกกระสอบทรายที่เขื่อนเทศบาลเมืองราชบุรี', card: 'R1' }],
  not_used: [],
  suggested_dimensions: [EDITOR_DIM],
  staff_notes: ['ยังไม่พบโพสต์ต้นทางของชายชาวสวีเดน'],
  warnings: [],
});
const writeAgentResult = () => ({ ...agentResultOut1(), suggested_dimensions: [AGENT_DIM] });
const cardDoc = (mode = 'write', result = writeAgentResult()) => schema.buildResearchCardsDoc(result, { jobId: JOB, mode, nowIso: NOW_ISO }).doc;

function fakeStorage({ card = null, request = { id: JOB, status: 'leased', deadlineAt: FAR }, workers = [] } = {}) {
  const st = { card, request, workers, reads: 0, fail: 0, hang: false };
  return {
    st,
    async getCards() {
      st.reads += 1;
      if (st.fail > 0) { st.fail -= 1; throw new Error('SECRET read failure'); }
      if (st.hang) return new Promise(() => {});
      return clone(st.card);
    },
    async getRequest() { return clone(st.request); },
    async listWorkers() { return clone(st.workers); },
  };
}

// ── A. waitResearchCards ─────────────────────────────────────────
function startWait({ env = WRITE_ENV, storage = fakeStorage(), clock = fakeClock(), deadline = null, mod = readCards, logs = [], ...extra } = {}) {
  let loads = 0;
  const promise = mod.waitResearchCards({
    workflowId: WF, env, now: clock.now, timers: clock.timers, deadline,
    loadStorage: async () => { loads += 1; return storage; },
    logPipeline: async (entry) => { logs.push(entry); },
    ...extra,
  });
  return { promise, clock, storage, logs, loads: () => loads };
}
const doneNow = async (promise, label) => {
  const result = await Promise.race([promise, flush().then(() => 'STILL_WAITING')]);
  assert.notEqual(result, 'STILL_WAITING', `${label}: ต้องจบโดยไม่ต้องเดินนาฬิกา`);
  return result;
};
const deadlineWith = (remaining) => ({
  signal: new AbortController().signal,
  remainingMs: () => remaining,
  assertCanStart() { throw new Error('ห้ามจองงบเส้นตาย (assertCanStart)'); },
});

async function assertWaitOff(mod) {
  for (const env of [{}, { RESEARCH_AGENT: '0', RESEARCH_AGENT_MODE: 'write' }]) {
    const w = startWait({ env, mod });
    assert.equal(await doneNow(w.promise, 'ปิดสวิตช์'), null);
    assert.equal(w.loads(), 0, 'ปิดสวิตช์ = ไม่แตะฐาน');
  }
}

async function assertWaitArrives(mod) {
  const ready = startWait({ mod, storage: fakeStorage({ card: cardDoc() }) });
  const run = await doneNow(ready.promise, 'การ์ดมาแล้ว');
  assert.equal(run.summary.status, 'done');
  assert.equal(run.summary.mode, 'write');
  assert.equal(run.summary.polls, 1);
  assert.equal(run.summary.waitedMs, 0);
  assert.equal(run.outcome.card.id, JOB);
  assert.equal(run.analysis.cards.length, 1, 'write แนบการ์ดแบบ assist');
  assert.equal(ready.logs.length, 1);
  assert.equal(ready.logs[0].step, 'research-agent');
  assert.match(ready.logs[0].detail, /รอหลังสกัด/);
  assert.equal(ready.clock.pending(), 0, 'ต้องไม่มี timer ค้าง');

  const later = startWait({ mod });
  await flush();
  assert.equal(later.storage.st.reads, 1);
  await later.clock.advance(5_000);
  assert.equal(later.storage.st.reads, 2, 'poll ทุก 5 วิ');
  later.storage.st.card = cardDoc();
  await later.clock.advance(5_000);
  const arrived = await settleWithin(later.promise, 'การ์ดมาระหว่างรอต้องได้');
  assert.equal(arrived.summary.status, 'done');
  assert.equal(arrived.summary.waitedMs, 10_000);
  assert.equal(arrived.summary.polls, 3);
  assert.equal(later.clock.pending(), 0);
  assert.ok(later.clock.calls.every((rest) => rest.length === 0), 'timer ของ waitResearchCards ไม่ขอ background/unref');
}

async function assertWaitFromPipelineStart(mod) {
  const clock = fakeClock();
  const w = startWait({ mod, clock, startedAt: clock.now() - 290_000, maxWaitMs: 300_000 });
  await flush();
  await clock.advance(9_999);
  assert.equal(await Promise.race([w.promise.then(() => 'done'), flush().then(() => 'waiting')]), 'waiting');
  await clock.advance(1);
  const run = await settleWithin(w.promise, 'หน้าต่าง 300 วิ นับจากเริ่มท่อ ต้องปิดที่ 10 วิ');
  assert.equal(run.summary.status, 'pending');
  assert.equal(run.summary.waitedMs, 10_000, 'ขั้นก่อนหน้าใช้ไป 290 วิ → รอได้อีก 10 วิ');
  // ไม่ส่ง maxWaitMs = ค่า env ของโหมด write (300000)
  const c2 = fakeClock();
  const w2 = startWait({ mod, clock: c2, startedAt: c2.now() - 299_000 });
  await flush();
  await c2.advance(1_000);
  assert.equal((await settleWithin(w2.promise, 'ค่าเริ่มต้น 300 วิ')).summary.waitedMs, 1_000);
}

async function assertWaitReserve(mod) {
  const tight = startWait({ mod, deadline: deadlineWith(490_000) });
  await flush();
  await tight.clock.advance(10_000);
  const run = await settleWithin(tight.promise, 'เหลือ 490 วิ → รอได้ 10 วิ');
  assert.equal(run.summary.waitedMs, 10_000, 'รอได้เฉพาะส่วนที่เกินกันชน 480 วิ');
  const none = startWait({ mod, deadline: deadlineWith(400_000) });
  const immediate = await doneNow(none.promise, 'เหลือ ≤ 480 วิ');
  assert.equal(immediate.summary.waitedMs, 0, 'ไม่กินงบ generate');
  assert.equal(none.storage.st.reads, 1, 'ยังอ่าน 1 รอบ (การ์ดมาแล้วได้ใช้)');
  const readyTight = startWait({ mod, deadline: deadlineWith(100_000), storage: fakeStorage({ card: cardDoc() }) });
  assert.equal((await doneNow(readyTight.promise, 'งบหมดแต่การ์ดมาแล้ว')).summary.status, 'done');
}

async function assertWaitAbortAndFinals(mod) {
  const manual = manualPipelineDeadline(700_000);
  const aborted = startWait({ mod, deadline: manual.deadline });
  await flush();
  manual.expire();
  const run = await settleWithin(aborted.promise, 'abort ต้องปล่อยทันที');
  assert.equal(run.summary.status, 'pending');
  assert.equal(aborted.clock.pending(), 0);
  const clock = fakeClock(Date.parse('2026-10-01T06:00:00.000Z'));
  const offline = startWait({ mod, clock, storage: fakeStorage({ request: { id: JOB, status: 'queued', deadlineAt: FAR }, workers: [{ lastSeenAt: '2026-10-01T05:40:00.000Z' }] }) });
  assert.equal((await doneNow(offline.promise, 'offline')).summary.status, 'offline');
  const expired = startWait({ mod, clock: fakeClock(Date.parse('2026-10-01T06:10:00.000Z')), storage: fakeStorage({ request: { id: JOB, status: 'leased', deadlineAt: '2026-10-01T06:07:00.000Z' } }) });
  assert.equal((await doneNow(expired.promise, 'expired')).summary.status, 'expired');
  const failed = startWait({ mod, storage: fakeStorage({ request: { id: JOB, status: 'failed', deadlineAt: FAR } }) });
  assert.equal((await doneNow(failed.promise, 'failed')).summary.status, 'failed');
  const none = startWait({ mod, storage: fakeStorage({ request: null }) });
  assert.equal((await doneNow(none.promise, 'no_request')).summary.status, 'no_request');
  const noJob = startWait({ mod, workflowId: 'auto_123' });
  assert.equal((await doneNow(noJob.promise, 'no_job')).summary.status, 'no_job');
}

async function assertWaitFailOpen(mod) {
  const down = startWait({ mod });
  const downRun = await mod.waitResearchCards({ workflowId: WF, env: WRITE_ENV, now: down.clock.now, timers: down.clock.timers,
    loadStorage: async () => { throw new Error('SECRET supabase down'); }, logPipeline: async () => {} });
  assert.equal(downRun.summary.status, 'unavailable');
  const failing = fakeStorage();
  failing.st.fail = 99;
  const f = startWait({ mod, storage: failing });
  await flush();
  await f.clock.advance(10_000);
  assert.equal((await settleWithin(f.promise, 'อ่านล้ม 3 ครั้งต้องจบ')).summary.status, 'error');
  const custom = startWait({ mod, read: async () => ({ final: true, card: cardDoc() }) });
  assert.equal((await doneNow(custom.promise, 'ตัวอ่านฉีด')).summary.status, 'done');
  assert.equal(custom.loads(), 0, 'ฉีด read = ไม่โหลดฐาน');
  const badLog = await mod.waitResearchCards({ workflowId: WF, env: WRITE_ENV, now: fakeClock().now, timers: fakeClock().timers,
    loadStorage: async () => fakeStorage({ card: cardDoc() }), logPipeline: () => { throw new Error('log down'); } });
  assert.equal(badLog.summary.status, 'done', 'บันทึกล้มไม่กระทบ');
}

test('A1 waitResearchCards: ปิดสวิตช์ = null ไม่แตะฐาน', () => assertWaitOff(readCards));
test('A2 waitResearchCards: การ์ดมาแล้ว = จบทันที (1 รอบ · log research-agent) · มาระหว่างรอ = poll ทุก 5 วิ · timer ไม่ขอ unref · ไม่มี timer ค้าง', () => assertWaitArrives(readCards));
test('A3 waitResearchCards: หน้าต่างรอนับจากเริ่มท่อ (startedAt) · ไม่ส่ง maxWaitMs = 300000 ของโหมด write', () => assertWaitFromPipelineStart(readCards));
test('A4 waitResearchCards: เส้นตายรวม — รอเฉพาะส่วนที่เกินกันชน 480 วิ · เหลือน้อยกว่า = อ่านรอบเดียว (การ์ดมาแล้วยังได้ใช้)', () => assertWaitReserve(readCards));
test('A5 waitResearchCards: abort ปล่อยทันที · offline/expired/failed/no_request/no_job = เลิกรอทันที', () => assertWaitAbortAndFinals(readCards));
test('A6 waitResearchCards fail-open: ฐานล้ม = unavailable · อ่านล้ม 3 ครั้ง = error · ตัวอ่านฉีดได้ · log ล้มไม่กระทบ · ไม่โยน', () => assertWaitFailOpen(readCards));

test('A7 waitResearchCards: ไม่ใช้ withTimeoutSignal/assertCanStart (ไม่จองงบเส้นตาย) · buildResearchAgentRun ไม่ส่ง editor = รูปเดิม', () => {
  const start = SRC.readCards.indexOf('export async function waitResearchCards(');
  const body = SRC.readCards.slice(start).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(body, /withTimeoutSignal|assertCanStart|reservePipelineStepMs|preparePipelineSignal|unref/);
  const base = readCards.buildResearchAgentRun({ outcome: { card: cardDoc('assist') }, mode: 'assist', jobId: JOB, workflowId: WF, ms: 1, waitedMs: 1, polls: 1 });
  assert.equal('editor' in base.analysis, false);
  assert.equal('editor' in base.summary, false);
  assert.equal('original_preview' in base.analysis, false);
});

// ── B. runResearchWriteStage ─────────────────────────────────────
function manualTimers() {
  const list = [];
  return {
    list,
    setTimer(fn, ms) { const t = { fn, ms, cleared: false }; list.push(t); return t; },
    clearTimer(t) { if (t) t.cleared = true; },
    pending() { return list.filter((t) => !t.cleared).length; },
  };
}

async function runStage(mod = writeStage, {
  env = WRITE_ENV, outcome = { final: true, card: cardDoc() }, reply = claudeReplyOk, remaining = null, saveFails = false,
  workflowId = WF, wait, extra = {},
} = {}) {
  const sb = createFakeSupabase();
  const storage = storeMod.createResearchStorage({ sb, now: () => NOW_MS });
  const logs = [];
  const invokes = [];
  const waits = [];
  const timers = manualTimers();
  const res = await settleWithin(mod.runResearchWriteStage({
    workflowId, rawText: RAW_TEXT, newsData: { newsTitle: 'ชาวสวีเดนขาเทียม', newsBody: RAW_TEXT }, pipelineStartedAt: NOW_MS - 30_000,
    env, now: () => NOW_MS, timers,
    deadline: remaining === null ? null : deadlineWith(remaining),
    wait: wait || (async (args) => {
      waits.push(args);
      const run = readCards.buildResearchAgentRun({ outcome, mode: 'write', jobId: JOB, workflowId: WF, ms: 48_000, waitedMs: 48_000, polls: 10 });
      return { ...run, outcome };
    }),
    invoke: async (args) => { invokes.push(args); return reply(args); },
    loadStorage: async () => (saveFails ? { saveEditorResult: async () => { throw new Error('SECRET db down'); } } : storage),
    logPipeline: async (entry) => { logs.push(entry); },
    ...extra,
  }), 'runResearchWriteStage ต้องจบ (ทุกอย่างปลอมตอบทันที)');
  return { res, sb, logs, invokes, waits, timers };
}

async function assertStageDone(mod) {
  const { res, sb, logs, invokes, waits, timers } = await runStage(mod);
  assert.equal(res.status, 'done', JSON.stringify(res?.record));
  assert.equal(res.enrichedSource, ENRICHED_PROSE);
  assert.equal(res.originalRawText, RAW_TEXT);
  assert.equal(waits.length, 1);
  assert.equal(waits[0].maxWaitMs, 300_000, 'โหมด write รอได้ 300 วิ');
  assert.equal(waits[0].startedAt, NOW_MS - 30_000, 'นับจากเริ่มท่อ');
  assert.equal(waits[0].jobId, JOB);
  assert.equal(invokes.length, 1);
  assert.equal(invokes[0].effort, 'medium');
  assert.match(res.breakdownArgs.customPrompt, /^มุมเสนอ \(ตัวเลือก ไม่บังคับ\)/);
  assert.ok(res.breakdownArgs.customPrompt.includes(AGENT_DIM) && res.breakdownArgs.customPrompt.includes(EDITOR_DIM));
  assert.ok(res.researchFacts.some((f) => f.includes(R1_CLAIM)), 'ข้อเท็จจริงการ์ดที่ใช้ไป correction');
  const stored = sb.doc(`redit_${JOB}`);
  assert.ok(stored, 'บันทึก store research-editor (row redit_<jobId>)');
  assert.equal(stored.id, JOB);
  assert.equal(stored.status, 'done');
  assert.equal(stored.mode, 'write');
  assert.deepEqual(stored.used_cards, ['R1']);
  assert.equal(stored.additions.length, 1);
  assert.equal(stored.model, 'claude-opus-5-5/medium');
  assert.equal(stored.waitedMs, 48_000);
  assert.equal(stored.original_chars, RAW_TEXT.length);
  assert.equal(stored.enriched_chars, ENRICHED_PROSE.length);
  assert.equal(stored.ratio, Math.round((ENRICHED_PROSE.length / RAW_TEXT.length) * 100) / 100);
  assert.equal('enriched_source' in stored, false, 'ห้ามเก็บฉบับเสริมเต็ม (สัญญา 8.1)');
  assert.ok(stored.enriched_preview.length <= 400);
  assert.deepEqual(stored.suggested_dimensions, [AGENT_DIM, EDITOR_DIM]);
  assert.ok(stored.flags.includes('ORIGIN_NOT_FOUND'));
  assert.equal(res.saved, true);
  assert.deepEqual(res.record, stored, 'ระเบียนใน analysisResult = ระเบียนที่เก็บ');
  assert.deepEqual(res.run.analysis.editor, stored);
  assert.equal(res.run.analysis.original_preview, RAW_TEXT);
  assert.equal(res.run.analysis.mode, 'write');
  assert.deepEqual(res.run.pipelineInfo.researchAgent.editor, { status: 'done', used: 1, corrections: 0, additions: 1, ratio: stored.ratio, waitedMs: 48_000, editorMs: stored.editorMs });
  assert.equal(res.run.pipelineInfo.jobId, JOB);
  assert.deepEqual(await res.poll.settle(), res.run, 'ช่อง PRE-GENERATE ได้ผลเดียวกัน (ไม่ poll ซ้ำ)');
  const editorLog = logs.find((l) => l.step === 'research-editor');
  assert.ok(editorLog, 'pipeline_logs step research-editor');
  assert.equal(editorLog.status, 'success');
  assert.deepEqual(editorLog.metadata.used, ['R1']);
  assert.equal(editorLog.metadata.corrections, 0);
  assert.equal(editorLog.metadata.additions, 1);
  assert.match(res.logLine, /^✍️ write: ฉบับเสริมแทนต้นฉบับ/);
  assert.equal(timers.pending(), 0, 'timer ของบรรณาธิการ/บันทึกต้องถูก clear');
}

async function assertStageNotDone(mod) {
  const pending = await runStage(mod, { outcome: { final: false, status: 'pending', request: { status: 'leased' } } });
  assert.equal(pending.res.status, 'not_ready');
  assert.equal(pending.res.enrichedSource, null);
  assert.equal(pending.res.breakdownArgs, null);
  assert.deepEqual(pending.res.researchFacts, []);
  assert.equal(pending.invokes.length, 0);
  assert.match(pending.res.record.reason, /ยังไม่มา/);
  assert.equal(pending.sb.doc(`redit_${JOB}`).status, 'not_ready', 'บันทึกทุกสถานะ');
  assert.equal('original_preview' in pending.res.run.analysis, false, 'ไม่ได้แทนต้นฉบับ = ไม่มีพรีวิวต้นฉบับ');
  assert.match(pending.res.logLine, /^⏳ write: รีเสิร์ชไม่ทัน/);
  assert.equal(pending.logs.find((l) => l.step === 'research-editor').status, 'warning');
  for (const [status, re] of [['expired', /หมดอายุ/], ['offline', /ออฟไลน์/], ['no_request', /ไม่มีใบขอ/], ['unavailable', /ใช้ไม่ได้/], ['error', /ล้ม/]]) {
    const r = await runStage(mod, { outcome: { final: true, status } });
    assert.equal(r.res.status, 'not_ready', status);
    assert.match(r.res.record.reason, re, status);
  }
  const reqFailed = await runStage(mod, { outcome: { final: true, status: 'failed' } });
  assert.equal(reqFailed.res.status, 'skipped');
  const skippedDoc = await runStage(mod, { outcome: { final: true, card: { ...cardDoc(), status: 'skipped', cards: [] } } });
  assert.equal(skippedDoc.res.status, 'skipped');
  assert.equal(skippedDoc.invokes.length, 0);
  const lowDoc = cardDoc('write', { ...writeAgentResult(), cards: [{ ...agentResultOut1().cards[0], confidence: 0.7 }] });
  const noUsable = await runStage(mod, { outcome: { final: true, card: lowDoc } });
  assert.equal(noUsable.res.status, 'skipped');
  assert.equal(noUsable.invokes.length, 0, 'ไม่มีการ์ดผ่านเกณฑ์ = ไม่เรียกโมเดล');
  assert.equal(noUsable.res.record.model, null);
  assert.deepEqual(noUsable.res.record.not_used.map((n) => n.card), ['R1']);
  const failed = await runStage(mod, { reply: () => { throw new Error('SECRET 529'); } });
  assert.equal(failed.res.status, 'failed');
  assert.equal(failed.res.enrichedSource, null);
  assert.equal(failed.res.breakdownArgs, null, 'ล้ม = ไม่ส่งมุมเสนอ (มุมอาจอิงข้อเท็จจริงที่นักเขียนไม่ได้รับ)');
  assert.deepEqual(failed.res.researchFacts, []);
  assert.equal('original_preview' in failed.res.run.analysis, false);
  assert.equal(failed.res.record.model, 'claude-opus-5-5/medium');
  assert.deepEqual(failed.res.record.used_cards, [], 'ล้ม = ไม่ได้ใช้การ์ดเข้าเนื้อ');
  assert.doesNotMatch(JSON.stringify(failed.res.record), /SECRET/);
  assert.match(failed.res.logLine, /^⚠️ write: บรรณาธิการล้ม/);
}

async function assertStageBudget(mod) {
  const short = await runStage(mod, { remaining: 430_000 });
  assert.equal(short.res.status, 'failed');
  assert.match(short.res.record.reason, /งบเวลาท่อเหลือไม่พอ/);
  assert.equal(short.invokes.length, 0, 'งบไม่พอ = ไม่เรียกบรรณาธิการ (ไม่กินงบแตกประเด็น/นักเขียน)');
  const enough = await runStage(mod, { remaining: 470_000 });
  assert.equal(enough.res.status, 'done');
  assert.equal(enough.timers.list[0].ms, 50_000, 'งบบรรณาธิการ = เวลาที่เหลือ − 420 วิ (ไม่เกิน 60 วิ)');
  const plenty = await runStage(mod, { remaining: 600_000 });
  assert.equal(plenty.timers.list[0].ms, 60_000);
}

async function assertStageFailOpen(mod) {
  const saveFails = await runStage(mod, { saveFails: true });
  assert.equal(saveFails.res.status, 'done', 'บันทึกล้ม = ข่าวยังได้ฉบับเสริม');
  assert.equal(saveFails.res.saved, false);
  assert.equal(saveFails.res.record.status, 'done');
  for (const env of [{}, { RESEARCH_AGENT: '1' }, { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' }, { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'rewrite' }]) {
    const off = await runStage(mod, { env });
    assert.equal(off.res, null, JSON.stringify(env));
    assert.equal(off.waits.length, 0, `${JSON.stringify(env)}: ไม่รอ`);
  }
  assert.equal((await runStage(mod, { workflowId: 'auto_1' })).res, null, 'งานนอกคิวไม่มีใบขอ');
  assert.equal((await runStage(mod, { wait: async () => { throw new Error('boom'); } })).res, null, 'พังกลางทาง = null (ท่อเดิม)');
  assert.equal((await runStage(mod, { wait: async () => null })).res, null);
}

test('B1 writeStage done: รอ 300 วิจากเริ่มท่อ → บรรณาธิการ → ระเบียน 8.1 ลง store (ไม่เก็บฉบับเสริมเต็ม) · มุมเสนอ/ข้อเท็จจริงการ์ด · analysis/pipelineInfo.editor · log research-editor', () => assertStageDone(writeStage));
test('B2 writeStage not_ready/skipped/failed: เขียนจากต้นฉบับ · บันทึกทุกสถานะ · ไม่มีการ์ดผ่านเกณฑ์ไม่เรียกโมเดล · ไม่รั่วข้อความ error', () => assertStageNotDone(writeStage));
test('B3 writeStage งบเวลา: เหลือ < 435 วิ = ไม่เรียกบรรณาธิการ · งบ = min(60 วิ, เหลือ − 420 วิ)', () => assertStageBudget(writeStage));
test('B4 writeStage fail-open: บันทึกล้มยังได้ผล · โหมดอื่น/ไม่มี jobId/พังกลางทาง = null', () => assertStageFailOpen(writeStage));

// ── C. processAutoFlowText ตัวจริง ─────────────────────────────────
const THAI_BODY = 'ชาวสวีเดนสวมขาเทียม 1 ข้าง ช่วยชาวบ้านราชบุรีตักทรายใส่กระสอบรับมือน้ำขึ้นสูงอย่างไม่ย่อท้อ สาวรายหนึ่งเล่าว่าเขาทำงานเคียงข้างคนในพื้นที่ทั้งวัน และบอกว่าเราทุกคนทำอะไรบางอย่างได้ ';
const LONG_CONTENT = (tag) => Array.from({ length: 3 }, (_, i) => `ย่อหน้า ${i + 1} ของ ${tag}: ${THAI_BODY}${THAI_BODY}`).join('\n\n');
const ANGLES = [{ angle_name: 'มุมน้ำใจข้ามชาติ', description: 'ชาวต่างชาติช่วยชาวบ้าน' }, { angle_name: 'มุมขาเทียม', description: 'ข้อจำกัดไม่ใช่อุปสรรค' }];
const EXTRACTED_BODY = 'ชาวสวีเดนสวมขาเทียมช่วยชาวบ้านราชบุรีตักทรายรับมือน้ำขึ้น สาวรายหนึ่งเล่าว่าเขาทำงานทั้งวัน';

function freshState() {
  const S = {
    saved: [], genLogs: [], pipelineLogs: [], inputs: [], topPrompts: [], researchCalls: [], corrections: [], rawGate: [], claude: [],
    claudeReply: claudeReplyOk,
    extractContent: async () => ({ success: true, text: RAW_TEXT }), transcribeTiktok: async () => ({ success: false }),
    transcribeYoutube: async () => ({ success: false }), transcribeMetaReel: async () => ({ success: false }), isMetaVideoUrl: () => false,
    performResearch: async (args) => { const { signal, ...rest } = args; S.researchCalls.push(clone(rest)); return { items: [] }; },
    isNewsResearchOn: () => false, smartResearch: async () => null,
    logGeneration: async (args) => { S.genLogs.push(clone(args)); return { success: true, caseId: '06501' }; },
    getSession: async () => null,
    logPipeline: async (entry) => { S.pipelineLogs.push(clone(entry)); },
    createLogger: () => new Proxy({}, { get: () => () => {} }),
    isRawFactCompletenessGateEnabled: () => true,
    enforceRawFactCompleteness: async ({ rawText, versions }) => {
      S.rawGate.push(rawText);
      return { versions, passingVersions: versions, repairedIndexes: [],
        finalAudit: { failingVersionIndexes: [], issues: [], missingFacts: [], model: 'gpt-5.6-sol', contextHash: 'h-rw' } };
    },
    persistFactualReviewOrThrow: async () => ({}), saveFactualReview: async () => ({}),
    saveAnalysis: async (id, analysisResult, presetId) => { S.saved.push(clone({ id, analysisResult, presetId })); return { id }; },
    getBuiltinFallbackPrompt: () => ({ id: 'fallback_builtin', promptName: 'Built-in' }),
    isLegacyLengthOn: () => false, assignAngleClosings: () => [], closingTailMatches: () => false,
    isCardAuthorityR6Enabled: () => false, cleanScrapedText: (s) => s,
    cookies: async () => ({ get: () => undefined }),
    callClaude: async (args) => { const { signal, ...rest } = args; S.claude.push(clone(rest)); return S.claudeReply(args); },
    runCorrectionPipeline: async (versions, newsData, breakdownData, researchFacts, rawSourceText) => {
      S.corrections.push(clone({ newsBody: newsData?.newsBody, researchFacts, rawSourceText }));
      return versions.map((v) => ({ ...v, _correctionApplied: true }));
    },
    getTopPrompts: async (args) => {
      S.topPrompts.push(clone({ text: args.text, focusAngle: args.focusAngle }));
      const n = (args.excludePromptIds || []).length + 1;
      return { prompts: [{ id: `card_${n}`, promptName: `การ์ด ${n}`, tone: 'อบอุ่น', hookStyle: 'เปิดด้วยภาพ', _matchScore: 90, _matchType: 'AI_PICKED' }],
        newsAnalysis: { category: 'ข่าวน้ำดี' }, _promptLib: [{ id: 'lib' }], _catalogPicks: [] };
    },
    performSummarize: async (input) => {
      const { signal, ...rest } = input;
      S.inputs.push(clone(rest));
      if (input.mode === 'extract') return { success: true, data: { newsTitle: 'ชาวสวีเดนขาเทียมช่วยชาวบ้านราชบุรี', newsBody: EXTRACTED_BODY } };
      if (input.mode === 'breakdown') return { success: true, data: { key_points: ['ช่วยตักทราย'], primaryCategory: 'ข่าวน้ำดี', core_story: 'น้ำใจ', possible_angles: ANGLES } };
      if (input.mode === 'blueprint') return { success: true, data: { blueprint: { core_emotion: 'ซึ้ง', emotional_timeline: [] } } };
      const id = input.presetPrompt?.id;
      return { success: true, data: { usedModel: 'claude-opus-5-5',
        versions: [{ style: 'แนว', title: `พาดหัว ${id}`, content: LONG_CONTENT(id) }],
        usedPreset: { id: 'library', name: `การ์ด ${id}`, source: 'library', promptId: id, promptName: `การ์ด ${id}` },
        debug: { promptMatchReason: 'stub' } } };
    },
  };
  return S;
}
globalThis.__RWP = freshState(); // autoFlowServiceText เรียก createLogger ตอนโหลด

const ENV_KEYS = ['RESEARCH_AGENT', 'RESEARCH_AGENT_MODE', 'RESEARCH_AGENT_WAIT_MS', 'NARRATIVE_LEGACY', 'PARTIAL_ANGLES'];
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const cut = (source, start, end) => {
  const i = source.indexOf(start);
  const j = source.indexOf(end, i);
  assert.ok(i >= 0 && j > i && source.indexOf(start, i + 1) < 0, `ต้องพบบล็อก: ${start.slice(0, 60)}`);
  return source.slice(0, i) + source.slice(j);
};
/** autoFlowServiceText ที่ถอดเฉพาะ hook โหมด write (= ซอร์สก่อนเลน W1 · hook shadow/assist ของเลน B คงอยู่) */
function stripWriteHook(source) {
  let s = cut(source, '  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3) — จุดเสียบหลังขั้นสกัด', '  // ★ 21 ส.ค. 69: เก็บข้อความที่ผู้ใช้วางไว้แยกจาก newsData.newsBody');
  s = cut(s, '    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3): มุมเสนอ', "  }), 300000, 'breakdown');");
  s = cut(s, '    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3): + ข้อเท็จจริงของการ์ด', '    .filter(Boolean)\n    .join(');
  s = cut(s, '  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3): โหมด write ที่ขั้นหลังสกัด', '  const _researchAgentPoll = process.env.RESEARCH_AGENT\n');
  s = replaceOnce(s, "    ? (_researchWrite?.poll ? Promise.resolve(_researchWrite.poll) : import('@/lib/research-agent/readCards')", "    ? import('@/lib/research-agent/readCards')", 'region1-a');
  s = replaceOnce(s, '      .catch(() => null))\n    : null;', '      .catch(() => null)\n    : null;', 'region1-b');
  assert.doesNotMatch(s, /_researchWrite|writeStage/, 'ซอร์สที่ถอดแล้วต้องไม่มี hook โหมด write');
  assert.match(s, /startResearchAgentPoll/, 'hook shadow/assist ของเลน B ต้องยังอยู่');
  return s;
}

async function runPipeline(mod, { env = {}, seed = null, url = null, text = RAW_TEXT, configure = null } = {}) {
  globalThis.__RWP = freshState();
  const S = globalThis.__RWP;
  if (configure) configure(S);
  const sb = createFakeSupabase();
  globalThis.__RA_SB = sb;
  globalThis.__RA_SB_READY = true;
  if (seed) seed(sb);
  const before = hooks.resolved.length;
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const { deadline } = manualPipelineDeadline(700_000);
  try {
    const res = await withEnv(env, () => settleWithin(runWithPipelineDeadline(deadline, () => mod.processAutoFlowText({
      ...(url ? { url } : { text, sourceType: 'plain_text' }), workflowId: WF, user: { userId: 'discord-777', userName: 'tester' },
    })), 'processAutoFlowText ไม่จบ (ตัวปลอมตอบทันที — ห้ามค้าง)'));
    return { res, S, sb, imports: hooks.resolved.slice(before).filter((s) => s.startsWith('@/lib/research-agent/')) };
  } finally {
    Object.assign(console, original);
  }
}

function comparable(run) {
  const data = clone(run.res.data);
  delete data.totalTimeSeconds;
  delete data.stepTimings;
  const genLogs = run.S.genLogs.map((args) => ({ ...args, pipelineInfo: { ...args.pipelineInfo, totalTime: 0, stepTimings: null } }));
  const text = JSON.stringify({
    data, genLogs, saved: run.S.saved, inputs: run.S.inputs, topPrompts: run.S.topPrompts, research: run.S.researchCalls,
    corrections: run.S.corrections, rawGate: run.S.rawGate, pipelineLogs: run.S.pipelineLogs.map(({ duration, ...e }) => e),
  });
  return text.replace(/\d+\.\d+s/g, 'Xs').replace(/"(ms|waitedMs)":\d+/g, '"$1":0');
}
const writerInputs = (run) => JSON.stringify({
  inputs: run.S.inputs, topPrompts: run.S.topPrompts, research: run.S.researchCalls, corrections: run.S.corrections, rawGate: run.S.rawGate,
});

const seedDone = (mode = 'write', result = writeAgentResult()) => (sb) => {
  sb.seed(`rreq_${JOB}`, 'research-requests', { id: JOB, workflowId: WF, status: 'done', deadlineAt: FAR, revision: 3 });
  sb.seed(`rcard_${JOB}`, 'research-cards', cardDoc(mode, result));
};
const seedPending = (sb) => sb.seed(`rreq_${JOB}`, 'research-requests', { id: JOB, workflowId: WF, status: 'leased', deadlineAt: FAR, revision: 2 });

async function assertWriteDoneWiring(mod) {
  const run = await runPipeline(mod, { env: WRITE_ENV, seed: seedDone() });
  assert.equal(run.res.success, true);
  const S = run.S;
  const byMode = (mode) => S.inputs.filter((i) => i.mode === mode);
  assert.equal(byMode('extract')[0].text, RAW_TEXT, 'ขั้นสกัดยังอ่านต้นฉบับเดิม');
  const breakdown = byMode('breakdown')[0];
  assert.equal(breakdown.text, ENRICHED_PROSE, 'แตกประเด็น: เนื้อ = ฉบับเสริม (newsData.newsBody)');
  assert.equal(breakdown.rawSourceText, ENRICHED_PROSE, 'แตกประเด็น: RAW จริง = ฉบับเสริม (breakdownRawSourceArgs)');
  assert.match(breakdown.customPrompt, /^มุมเสนอ \(ตัวเลือก ไม่บังคับ\) จากฝ่ายค้นคว้า: 1\) มุมน้ำใจข้ามชาติในวันน้ำขึ้น · 2\) มุมชุมชนช่วยกันกั้นน้ำ/);
  assert.equal(byMode('blueprint')[0].text, ENRICHED_PROSE);
  for (const w of byMode('analyze')) {
    assert.equal(w.text, ENRICHED_PROSE, 'นักเขียน: เนื้อ = ฉบับเสริม');
    assert.equal(w.rawSourceText, ENRICHED_PROSE, 'นักเขียน: RAW-FIRST = ฉบับเสริม (writerRawSourceText)');
  }
  assert.ok(S.topPrompts.length > 0 && S.topPrompts.every((t) => t.text === ENRICHED_PROSE), 'ตัวเลือกการ์ดเห็นฉบับเสริม');
  assert.ok(S.researchCalls.length > 0 && S.researchCalls.every((r) => r.newsBody === ENRICHED_PROSE), 'รีเสิร์ชต่อมุมเห็นฉบับเสริม');
  assert.equal(S.corrections.length, 1);
  assert.equal(S.corrections[0].newsBody, ENRICHED_PROSE);
  assert.equal(S.corrections[0].rawSourceText, ENRICHED_PROSE, 'correction/grounding ยึดฉบับเสริม');
  assert.ok(String(S.corrections[0].researchFacts || '').includes(R1_CLAIM), 'correctionResearchFacts มีข้อเท็จจริงการ์ดที่ใช้');
  assert.deepEqual(S.rawGate, [ENRICHED_PROSE], 'ด่าน RAW ใช้ฉบับเสริมเป็นความจริง');
  assert.equal(S.claude.length, 1);
  assert.equal(S.claude[0].model, 'claude-opus-5-5');
  assert.equal(S.claude[0].effort, 'medium');
  const ra = run.res.data.analysisResult.researchAgent;
  assert.equal(ra.mode, 'write');
  assert.equal(ra.editor.status, 'done');
  assert.deepEqual(ra.editor.used_cards, ['R1']);
  assert.equal(ra.original_preview, RAW_TEXT, 'ต้นฉบับเดิมเก็บใน original_preview (≤400)');
  assert.equal(ra.cards.length, 1, 'การ์ดยังแนบให้บอทแบบ assist');
  const info = S.genLogs[0].pipelineInfo;
  assert.equal(info.researchAgent.mode, 'write');
  assert.equal(info.researchAgent.editor.status, 'done');
  assert.equal(info.researchAgent.editor.used, 1);
  assert.equal(info.jobId, JOB);
  const stored = run.sb.doc(`redit_${JOB}`);
  assert.equal(stored.status, 'done');
  assert.equal('enriched_source' in stored, false);
  assert.equal(S.pipelineLogs.filter((l) => l.step === 'research-agent').length, 1, 'ช่อง PRE-GENERATE ใช้ผลรอบหลังสกัด ไม่ poll/ไม่บันทึกซ้ำ');
  assert.equal(S.pipelineLogs.filter((l) => l.step === 'research-editor' && l.status === 'success').length, 1);
  assert.ok(run.res.data.log.some((line) => line.includes('ResearchWrite: ✍️ write: ฉบับเสริมแทนต้นฉบับ')));
  assert.equal(run.res.data.newsData.newsBody, ENRICHED_PROSE, 'ผลที่ส่งกลับ/คลังได้ newsBody ฉบับเสริม');
  assert.ok(run.imports.includes('@/lib/research-agent/writeStage'));
}

async function assertWriteFallbacks(mod) {
  const off = await runPipeline(mod);
  const cases = [
    ['not_ready (การ์ดไม่มา · WAIT_MS=0)', { env: { ...WRITE_ENV, RESEARCH_AGENT_WAIT_MS: '0' }, seed: seedPending }, 'not_ready'],
    ['บรรณาธิการล้ม', { env: WRITE_ENV, seed: seedDone(), configure: (S) => { S.claudeReply = () => { throw new Error('SECRET 529'); }; } }, 'failed'],
    ['ด่านเชิงกลตัดเกิน 30%', { env: WRITE_ENV, seed: seedDone(), configure: (S) => {
      S.claudeReply = () => ({ ...claudeReplyOk(), enriched_source: [...ENRICHED_LINES, 'ทั้งหมดใช้งบ 9,999,999 บาท', 'นายสมศักดิ์ ใจดี ผู้ใหญ่บ้านเล่าว่าเขามาจากเมืองโกเธนเบิร์ก', 'มีอาสาสมัคร 450 คนจากจังหวัดกาญจนบุรีมาช่วย'].join('\n') });
    } }, 'failed'],
    ['การ์ดสถานะ skipped', { env: WRITE_ENV, seed: seedDone('write', { status: 'skipped', brain: { kind: 'codex' }, flags: ['EMPTY_RAW'], skipped: ['ข่าวดิบว่าง'] }) }, 'skipped'],
  ];
  for (const [label, opts, status] of cases) {
    const run = await runPipeline(mod, opts);
    assert.equal(run.res.success, true, label);
    assert.equal(writerInputs(run), writerInputs(off), `${label}: อินพุตทุกขั้น (แตกประเด็น/นักเขียน/การ์ด/รีเสิร์ช/correction/ด่าน RAW) = ปิดสวิตช์ทุกไบต์`);
    assert.equal(run.res.data.analysisResult.researchAgent.editor.status, status, label);
    assert.equal(run.sb.doc(`redit_${JOB}`).status, status, `${label}: บันทึกทุกสถานะ`);
    assert.equal(run.res.data.newsData.newsBody, EXTRACTED_BODY, `${label}: newsBody เดิม`);
    assert.equal(run.S.pipelineLogs.filter((l) => l.step === 'research-agent').length, 1, `${label}: ไม่ poll ซ้ำที่ PRE-GENERATE`);
    assert.doesNotMatch(JSON.stringify(run.res.data.analysisResult.researchAgent), /SECRET/, label);
  }
}

async function assertWriteOnlyText(mod) {
  const run = await runPipeline(mod, { env: { ...WRITE_ENV, RESEARCH_AGENT_WAIT_MS: '0' }, url: 'https://news.example.test/story/1', seed: seedDone() });
  assert.equal(run.res.success, true);
  assert.equal(run.imports.includes('@/lib/research-agent/writeStage'), false, 'สาย URL ไม่เข้าโหมด write (เฟสนี้รองรับเฉพาะสายข้อความ)');
  assert.equal(run.S.claude.length, 0);
  const ra = run.res.data.analysisResult.researchAgent;
  assert.equal(ra.mode, 'write');
  assert.equal('editor' in ra, false, 'สาย URL = แนบการ์ดแบบ assist (ช่อง PRE-GENERATE เดิม)');
  assert.equal(run.S.pipelineLogs.filter((l) => l.step === 'research-agent').length, 1);
}

async function assertLaneBParity(current, laneBOnly) {
  const scenarios = [
    ['ปิดสวิตช์', {}],
    ['shadow', { env: { RESEARCH_AGENT: '1' }, seed: seedDone('shadow', agentResultOut1()) }],
    ['assist', { env: { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' }, seed: seedDone('assist', agentResultOut1()) }],
    ['assist ไม่มีการ์ด', { env: { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist', RESEARCH_AGENT_WAIT_MS: '0' }, seed: seedPending }],
  ];
  for (const [label, opts] of scenarios) {
    const now = await runPipeline(current, opts);
    const before = await runPipeline(laneBOnly, opts);
    assert.equal(now.res.success, true, label);
    assert.equal(comparable(now), comparable(before), `${label}: ต้องเหมือนซอร์สก่อนเลน W1 ทุกไบต์ (ผล/บันทึก/อินพุตทุกขั้น)`);
    assert.equal(now.imports.includes('@/lib/research-agent/writeStage'), false, `${label}: ห้าม import โมดูลโหมด write`);
    assert.equal(now.sb.calls.some((c) => (c.filters || []).some(([, v]) => String(v).startsWith('redit_'))), false, `${label}: ไม่แตะ store research-editor`);
  }
}

test('C1 autoFlow write done: ฉบับเสริมถึงแตกประเด็น/blueprint/การ์ด/รีเสิร์ช/นักเขียน/correction/ด่าน RAW · มุมเสนอ · researchFacts · editor ใน analysis/pipeline_info/store · PRE-GENERATE ไม่ซ้ำ', async () => {
  await assertWriteDoneWiring(await import(AUTO_FLOW_URL));
});
test('C2 autoFlow write not_ready/บรรณาธิการล้ม/ด่านตัด/การ์ด skipped: อินพุตทุกขั้นเท่าปิดสวิตช์ทุกไบต์ · บันทึกทุกสถานะ', async () => {
  await assertWriteFallbacks(await import(AUTO_FLOW_URL));
});
test('C3 autoFlow write สาย URL: ไม่ import writeStage · ไม่เรียกบรรณาธิการ · แนบการ์ดแบบเดิม', async () => {
  await assertWriteOnlyText(await import(AUTO_FLOW_URL));
});
test('C4 autoFlow ปิดสวิตช์/shadow/assist: เหมือนซอร์สก่อนเลน W1 ทุกไบต์ · ไม่ import writeStage · ไม่แตะ research-editor', async () => {
  const laneBOnly = await importSource(stripWriteHook(SRC.autoFlow), 'autoflow-lane-b-only');
  await assertLaneBParity(await import(AUTO_FLOW_URL), laneBOnly);
});

// ── D. store · route · cardsSchema · generationLogger · modes ──────────
async function assertEditorStore(mod) {
  const sb = createFakeSupabase();
  let t = NOW_MS;
  const storage = mod.createResearchStorage({ sb, now: () => t });
  assert.equal(await storage.getEditorResult(JOB), null);
  const first = await storage.saveEditorResult(JOB, {
    status: 'done', used_cards: ['R1', 'R1', 'x'], enriched_source: 'เนื้อเต็มห้ามเก็บ', enriched_preview: 'ก'.repeat(900),
    corrections: [{ field: 'ราคา', from: 20, to: '18', source_url: 'javascript:alert(1)', card: 'R1' }],
    additions: [{ text: 'เพิ่ม', card: 'R9x' }], flags: ['stale_news', 'bad flag'], waitedMs: 1_234.6, ratio: 1.456, secret: 'nope',
  });
  assert.equal(sb.rows.get(`redit_${JOB}`).store_name, 'research-editor');
  assert.equal(first.id, JOB);
  assert.equal(first.revision, 1);
  assert.equal(first.mode, 'write');
  assert.deepEqual(first.used_cards, ['R1']);
  assert.equal('enriched_source' in first, false);
  assert.equal('secret' in first, false, 'เก็บเฉพาะช่องในสัญญา 8.1');
  assert.equal(first.enriched_preview.length, 400);
  assert.deepEqual(first.corrections, [{ field: 'ราคา', from: '20', to: '18', source_url: null, source_name: '', card: 'R1' }]);
  assert.deepEqual(first.additions, [{ text: 'เพิ่ม', card: null }]);
  assert.deepEqual(first.flags, ['STALE_NEWS']);
  assert.equal(first.waitedMs, 1235);
  assert.equal(first.ratio, 1.46);
  for (const key of ['not_used', 'suggested_dimensions', 'staff_notes', 'warnings']) assert.deepEqual(first[key], [], key);
  t += 60_000;
  const second = await storage.saveEditorResult(JOB, { status: 'weird', reason: 'r' });
  assert.equal(second.revision, 2);
  assert.equal(second.status, 'failed', 'สถานะนอกสัญญา = failed');
  assert.equal(second.createdAt, first.createdAt, 'createdAt คงของเดิม (upsert)');
  assert.notEqual(second.updatedAt, first.updatedAt);
  assert.deepEqual(await storage.getEditorResult(JOB), second);
  await assert.rejects(storage.saveEditorResult('../x', {}), /jobId/);
  // สัญญา 8.2: bot-posted รับ editorMsgId (บอทเลน W2 จดข้อความใบที่สอง) · ช่องเดิมคงอยู่
  const posted = await storage.saveBotPosted({ jobId: JOB, channelId: 'CH1', researchCardMsgId: 'C1', editorMsgId: 'E1' });
  assert.equal(posted.editorMsgId, 'E1');
  assert.equal(posted.researchCardMsgId, 'C1');
  const postedAgain = await storage.saveBotPosted({ jobId: JOB, editorMsgId: 'bad id!' });
  assert.equal(postedAgain.editorMsgId, 'E1', 'ค่าผิดรูป = คงค่าเดิม');
  sb.failNext(5, { mode: 'throw' });
  await assert.rejects(storage.saveEditorResult(JOB, { status: 'done' }), (e) => e.errorType === 'RESEARCH_STORAGE_UNAVAILABLE' && !/SECRET/.test(e.message));
}

const BOT_KEY = 'rw-bot-key';
async function callRoute(route, path, headers = { 'x-bot-secret': BOT_KEY }) {
  const res = await route.GET(new Request(`http://localhost${path}`, { headers }));
  return { status: res.status, body: await res.json() };
}
async function assertCardsRoute(route) {
  const saved = { DISCORD_API_SECRET: process.env.DISCORD_API_SECRET, RESEARCH_AGENT: process.env.RESEARCH_AGENT };
  process.env.DISCORD_API_SECRET = BOT_KEY;
  process.env.RESEARCH_AGENT = '1';
  try {
    const sb = createFakeSupabase();
    globalThis.__RA_SB = sb;
    globalThis.__RA_SB_READY = true;
    seedDone()(sb);
    const before = await callRoute(route, `/api/research/cards?jobId=${JOB}`);
    assert.equal(before.status, 200);
    assert.equal(before.body.editor, null, 'ยังไม่มีผลบรรณาธิการ = null');
    for (const key of ['success', 'jobId', 'found', 'enabled', 'mode', 'request', 'cards', 'summary']) assert.ok(key in before.body, `ช่องเดิม ${key} ต้องอยู่`);
    assert.equal(before.body.found, true);
    const storage = storeMod.createResearchStorage({ sb, now: () => NOW_MS });
    const record = await storage.saveEditorResult(JOB, { status: 'not_ready', reason: 'การ์ดยังไม่มา', waitedMs: 300_000 });
    const after = await callRoute(route, `/api/research/cards?jobId=${JOB}`);
    assert.deepEqual(after.body.editor, record);
    assert.deepEqual({ ...after.body, editor: null }, before.body, 'ช่องเดิมทุกช่องไม่เปลี่ยน');
    sb.failNext(1, { kind: 'select', mode: 'throw', where: (kind, filters) => filters.some(([, v]) => v === `redit_${JOB}`) });
    const editorDown = await callRoute(route, `/api/research/cards?jobId=${JOB}`);
    assert.equal(editorDown.status, 200, 'อ่านผลบรรณาธิการล้ม ≠ อ่านการ์ดล้ม');
    assert.equal(editorDown.body.editor, null);
    assert.equal(editorDown.body.found, true);
    sb.failNext(50, { mode: 'throw' });
    const down = await callRoute(route, `/api/research/cards?jobId=${JOB}`);
    assert.equal(down.status, 503);
    assert.equal(down.body.errorType, 'RESEARCH_STORAGE_UNAVAILABLE');
    assert.equal((await callRoute(route, `/api/research/cards?jobId=${JOB}`, {})).status, 401);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function stripSchemaWrite(source) {
  let s = cut(source, '  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): คงคำพูดตรงของการ์ด', '  const reasonText = ');
  s = cut(s, '    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.3): มุมเสนอ — มีคีย์', '    flags: [...flags].slice(0, MAX_FLAGS),');
  return s;
}
async function assertSchemaFields(mod, original) {
  const results = [agentResultOut1(), { status: 'skipped', brain: { kind: 'codex' }, flags: ['EMPTY_RAW'], skipped: ['ว่าง'] }, { status: 'done', cards: 'x' }];
  for (const result of results) {
    const now = mod.buildResearchCardsDoc(clone(result), { jobId: JOB, mode: 'write', nowIso: NOW_ISO });
    const before = original.buildResearchCardsDoc(clone(result), { jobId: JOB, mode: 'write', nowIso: NOW_ISO });
    assert.equal(JSON.stringify(now), JSON.stringify(before), `ผลเก่าที่ไม่มีฟิลด์ใหม่ต้องได้เอกสารเดิมทุกไบต์ (${result.status})`);
    assert.equal('suggested_dimensions' in now.doc, false);
  }
  const card = agentResultOut1().cards[0];
  const withFields = {
    ...agentResultOut1(),
    suggested_dimensions: ['  มุมหนึ่ง  ', 'มุมหนึ่ง', '', 'ม'.repeat(200), 'มุมสาม', 'มุมสี่'],
    cards: [
      { ...card, quote: { text: 'ค'.repeat(500), speaker: 'ผ'.repeat(100), speaker_confidence: 0.95 } },
      { ...card, id: 'R2', quote: { text: 'คำพูด', speaker: 'เนย', speaker_confidence: 7 } },
      { ...card, id: 'R3', quote: { text: '   ', speaker: 'เนย', speaker_confidence: 1 } },
      { ...card, id: 'R4', quote: 'ไม่ใช่ object' },
    ],
  };
  const built = mod.buildResearchCardsDoc(withFields, { jobId: JOB, mode: 'write', nowIso: NOW_ISO });
  assert.deepEqual(built.doc.suggested_dimensions, ['มุมหนึ่ง', 'ม'.repeat(120), 'มุมสาม'], '≤3 · ≤120 ตัวอักษร · ตัดว่าง/ซ้ำ');
  assert.deepEqual(built.doc.cards[0].quote, { text: 'ค'.repeat(300), speaker: 'ผ'.repeat(80), speaker_confidence: 0.95 });
  assert.deepEqual(built.doc.cards[1].quote, { text: 'คำพูด', speaker: 'เนย', speaker_confidence: 0 }, 'ความมั่นใจนอกช่วง = 0');
  assert.equal('quote' in built.doc.cards[2], false, 'text ว่าง = ไม่ใส่');
  assert.equal('quote' in built.doc.cards[3], false);
  const plain = mod.buildResearchCardsDoc({ ...agentResultOut1(), cards: withFields.cards.map(({ quote, ...rest }) => rest) }, { jobId: JOB, mode: 'write', nowIso: NOW_ISO });
  assert.deepEqual(built.gateChanges, plain.gateChanges, 'ฟิลด์ใหม่ไม่ทำให้ด่านบีบ/ตัดการ์ด');
  assert.deepEqual(built.doc.cards.map((c) => c.gate), plain.doc.cards.map((c) => c.gate));
  assert.deepEqual(mod.buildResearchCardsDoc({ ...agentResultOut1(), suggested_dimensions: 'ไม่ใช่ array' }, { jobId: JOB, mode: 'write', nowIso: NOW_ISO }).doc.suggested_dimensions, []);
}

function assertGenLogEditor(mod) {
  const base = { researchAgent: { status: 'done', mode: 'assist', cardsCount: 1, passCount: 1, flags: [], requestStatus: 'done', revision: 2, brain: null, ms: 1, waitedMs: 1, polls: 1 }, jobId: JOB, workflowId: WF };
  assert.equal('editor' in mod.compactResearchAgentPipelineInfo(base).researchAgent, false, 'ไม่ส่ง editor = ไม่มีคีย์ (shadow/assist เดิม)');
  const withEditor = mod.compactResearchAgentPipelineInfo({ ...base, researchAgent: { ...base.researchAgent, mode: 'write',
    editor: { status: 'done', used: 2, corrections: 1, additions: 3, ratio: 1.6, waitedMs: 48_000, editorMs: 21_000, enriched_source: 'ห้ามหลุด', used_cards: ['R1'] } } });
  assert.deepEqual(withEditor.researchAgent.editor, { status: 'done', used: 2, corrections: 1, additions: 3, ratio: 1.6, waitedMs: 48_000, editorMs: 21_000 });
  assert.deepEqual(mod.compactResearchAgentPipelineInfo({ researchAgent: { editor: [] } }).researchAgent.editor, undefined);
}

function assertModesWrite(mod) {
  assert.equal(mod.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'write' }), 300_000);
  assert.equal(mod.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'write', RESEARCH_AGENT_WAIT_MS: '999999' }), 300_000);
  assert.equal(mod.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'write', RESEARCH_AGENT_WAIT_MS: '120000' }), 120_000);
  assert.equal(mod.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'assist' }), 90_000, 'assist เดิม');
  assert.equal(mod.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'assist', RESEARCH_AGENT_WAIT_MS: '999999' }), 180_000, 'assist เพดานเดิม');
  assert.equal(mod.getResearchAgentWaitMs({ RESEARCH_AGENT_MODE: 'shadow', RESEARCH_AGENT_WAIT_MS: '300000' }), 0);
  assert.equal(mod.getResearchAgentConfig({ RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'write' }).waitMs, 300_000);
}

test('D1 store research-editor: row redit_<jobId> · allowlist สัญญา 8.1 (ไม่เก็บฉบับเสริมเต็ม · พรีวิว ≤400) · upsert revision/createdAt · ฐานล้ม = 503 ไม่รั่ว', () => assertEditorStore(storeMod));
test('D2 GET /api/research/cards: + ช่อง editor (ไม่มี = null) · ช่องเดิมคงทุกช่อง · อ่าน editor ล้ม ≠ การ์ดล้ม · ฐานล้ม 503 · กุญแจบอทเดิม', () => assertCardsRoute(cardsRoute));
test('D3 cardsSchema 8.3: ผลเก่าไบต์เดิม · suggested_dimensions ≤3/≤120 · quote {text≤300, speaker≤80, 0–1} · ด่านไม่เปลี่ยนเพราะฟิลด์ใหม่', async () => {
  await assertSchemaFields(schema, await importSource(stripSchemaWrite(SRC.schema), 'schema-before-w1'));
});
test('D4 generationLogger: editor ฉบับย่อเฉพาะตัวเลข (allowlist) · ไม่ส่ง = ไม่มีคีย์', () => assertGenLogEditor(genLog));
test('D5 modes: write ค่าเริ่มต้น/เพดาน 300000 · assist/shadow เดิม · config สะท้อนค่า', () => assertModesWrite(modes));

// ── E. mutation ───────────────────────────────────────────────────
test('E mutation: ทุบสายไฟโหมด write แล้วข้อสอบต้องแดง (และของจริงเขียว)', async () => {
  const laneBOnly = await importSource(stripWriteHook(SRC.autoFlow), 'autoflow-lane-b-only-m');
  const afMutations = [
    ['ไม่แทน rawText ด้วยฉบับเสริม', '    rawText = _researchWrite.enrichedSource; // ฉบับเสริม = ความจริงหลัก (writerRawSourceText/grounding/ด่าน RAW อ่านจากตัวแปรนี้)\n', '', assertWriteDoneWiring],
    ['ไม่แทน newsData.newsBody', '    newsData.newsBody = _researchWrite.enrichedSource;\n', '', assertWriteDoneWiring],
    ['ไม่ส่งมุมเสนอเข้าแตกประเด็น', '    ...(_researchWrite?.breakdownArgs || {}),\n', '', assertWriteDoneWiring],
    ['ไม่ส่งการ์ดเข้า correctionResearchFacts', '    .concat(_researchWrite?.researchFacts || [])\n', '', assertWriteDoneWiring],
    ['PRE-GENERATE poll ซ้ำในโหมด write', '    ? (_researchWrite?.poll ? Promise.resolve(_researchWrite.poll) : import(', '    ? (false ? null : import(', assertWriteDoneWiring],
    ['ถอดตัวกรองโหมด (shadow/assist import writeStage)', "  const _researchWrite = (process.env.RESEARCH_AGENT && /write/i.test(process.env.RESEARCH_AGENT_MODE || '')\n", '  const _researchWrite = (process.env.RESEARCH_AGENT\n', (m) => assertLaneBParity(m, laneBOnly)],
    ['สาย URL เข้าโหมด write', "      && (detectedType === 'text' || detectedType === 'plain_text'))\n    ? await import('@/lib/research-agent/writeStage')", "      && true)\n    ? await import('@/lib/research-agent/writeStage')", assertWriteOnlyText],
  ];
  for (const [index, [label, search, replacement, check]] of afMutations.entries()) {
    // eslint-disable-next-line no-await-in-loop -- โหลดซอร์สกลายพันธุ์ทีละแบบ
    const mutated = await importSource(replaceOnce(SRC.autoFlow, search, replacement, label), `autoflow-w1-mut-${index}`);
    // eslint-disable-next-line no-await-in-loop -- ตรวจทีละแบบ
    await assert.rejects(Promise.resolve().then(() => check(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  const unitMutations = [
    [SRC.readCards, 'readCards: ไม่เคารพกันชนเส้นตาย', '  const budgetEnd = Number.isFinite(remaining) ? begin + Math.max(0, remaining - reserveMs) : Number.POSITIVE_INFINITY;', '  const budgetEnd = Number.POSITIVE_INFINITY;', assertWaitReserve],
    [SRC.readCards, 'readCards: หน้าต่างนับจากตอนเริ่มรอ ไม่ใช่เริ่มท่อ', '  const origin = Number.isFinite(startedAt) ? startedAt : begin;', '  const origin = begin;', assertWaitFromPipelineStart],
    [SRC.readCards, 'readCards: ปิดสวิตช์ยังอ่าน', '  if (!isResearchAgentOn(env)) return null; // ปิดสวิตช์ = ไม่แตะฐาน ไม่รอ (แบบเดียวกับ startResearchAgentPoll)\n', '', assertWaitOff],
    [SRC.writeStage, 'writeStage: ไม่เช็คงบก่อนเรียกบรรณาธิการ', '      } else if (budget < EDITOR_MIN_BUDGET_MS) {', '      } else if (false) {', assertStageBudget],
    [SRC.writeStage, 'writeStage: ไม่บันทึกผลบรรณาธิการ', '      return storage.saveEditorResult(jobId, rawRecord);', '      return null;', assertStageDone],
    [SRC.writeStage, 'writeStage: บรรณาธิการล้มแล้วยังส่งมุมเสนอ/ข้อเท็จจริง/พรีวิวต้นฉบับ', "    const done = status === 'done';", "    const done = status === 'done' || status === 'failed';", assertStageNotDone],
    [SRC.store, 'store: เก็บฉบับเสริมเต็ม (หลุด allowlist)', '  const doc = {\n    id: jobId,\n    status: RESEARCH_EDITOR_STATUSES', '  const doc = {\n    ...src,\n    id: jobId,\n    status: RESEARCH_EDITOR_STATUSES', assertEditorStore],
    [SRC.store, 'store: bot-posted ทิ้ง editorMsgId', "'researchCardMsgId', 'editorMsgId']) {", "'researchCardMsgId']) {", assertEditorStore],
    [SRC.route, 'route: ไม่ส่งช่อง editor', '      editor: editor || null, // ★ 1 ต.ค. 69 (โหมด write · สัญญา 8.1): ไม่มี = null\n', '', assertCardsRoute],
    [SRC.modes, 'modes: write กลับเป็น 90000/180000', '  if (mode === \'write\') {', '  if (false) {', assertModesWrite],
  ];
  for (const [index, [source, label, search, replacement, check]] of unitMutations.entries()) {
    // eslint-disable-next-line no-await-in-loop -- โหลดซอร์สกลายพันธุ์ทีละแบบ
    const mutated = await importSource(replaceOnce(source, search, replacement, label), `w1-unit-mut-${index}`);
    // eslint-disable-next-line no-await-in-loop -- ตรวจทีละแบบ
    await assert.rejects(Promise.resolve().then(() => check(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  const schemaBefore = await importSource(stripSchemaWrite(SRC.schema), 'schema-before-w1-m');
  const schemaMutations = [
    ['cardsSchema: ทิ้ง quote', '  if (quote) out.quote = quote;\n', ''],
    ['cardsSchema: เติม suggested_dimensions ให้ผลเก่าเสมอ', "    ...(Object.hasOwn(source, 'suggested_dimensions') ? { suggested_dimensions: normalizeSuggestedDimensions(source.suggested_dimensions) } : {}),",
      '    suggested_dimensions: normalizeSuggestedDimensions(source.suggested_dimensions),'],
  ];
  for (const [index, [label, search, replacement]] of schemaMutations.entries()) {
    // eslint-disable-next-line no-await-in-loop -- โหลดซอร์สกลายพันธุ์ทีละแบบ
    const mutated = await importSource(replaceOnce(SRC.schema, search, replacement, label), `schema-w1-mut-${index}`);
    // eslint-disable-next-line no-await-in-loop -- ตรวจทีละแบบ
    await assert.rejects(Promise.resolve().then(() => assertSchemaFields(mutated, schemaBefore)), `${label}: ข้อสอบต้องแดง`);
  }
  const genMut = await importPatchedModule(replaceOnce(SRC.genLog, '      ...(ra.editor && typeof ra.editor === \'object\' && !Array.isArray(ra.editor) ? {', '      ...(false ? {', 'genlog editor'), GENLOG_URL, 'genlog-w1-mut');
  assert.throws(() => assertGenLogEditor(genMut), 'generationLogger ทิ้ง editor: ข้อสอบต้องแดง');
  // ของจริงเขียวกับข้อสอบชุดเดียวกัน
  const current = await import(AUTO_FLOW_URL);
  await assertWriteDoneWiring(current);
  await assertWriteOnlyText(current);
  await assertLaneBParity(current, laneBOnly);
  await assertWaitReserve(readCards);
  await assertWaitFromPipelineStart(readCards);
  await assertWaitOff(readCards);
  await assertStageBudget(writeStage);
  await assertStageDone(writeStage);
  await assertStageNotDone(writeStage);
  await assertEditorStore(storeMod);
  await assertCardsRoute(cardsRoute);
  assertModesWrite(modes);
  await assertSchemaFields(schema, schemaBefore);
  assertGenLogEditor(genLog);
});
