// ============================================================
// 🧪 PL-13 / Q6 — เก็บคลังหลังจบท่อแบบ best-effort ไม่ล้ำเส้นตาย (tests/archive-best-effort-pl13.test.mjs)
// ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ)
// ------------------------------------------------------------
// บั๊ก: src/app/api/auto/process/route.js — ท่อ TEXT บันทึกเคสเสร็จแล้ว แต่ route ยัง await เก็บคลัง (getAll + AI จัดหมวด ≤20s + add)
//   ภายใน Promise.race ของ runWithPipelineDeadline → เส้นตายหมดระหว่างนั้น → reportHardDeadlineFailure ตีงานเป็น failed (504)
//   → บอทขึ้น ❌ → ทีมส่งซ้ำ = จ่ายทั้งท่อซ้ำ
// แก้: saveArchiveBestEffort — งบรอคลัง = min(เหลือ − สำรอง 15s, 30s) · ไม่พอสำรอง = ข้ามคลัง · ไม่พอ AI = เก็บด้วยหมวดค่าเริ่มต้น
//   (skipClassify ไม่ยิง AI) · คลังช้าเกินงบ = เลิกรอ · ทุกกรณีบันทึก archive_skipped แล้วส่งข่าว completed · ถอย ARCHIVE_BEST_EFFORT=0
// วิธีเทส: ตัดฟังก์ชันจริงจาก route.js / newsArchiveService.js ด้วย AST (แบบ text-queue-handoff-contract + archive-save-truth)
//   เส้นตาย = manualPipelineDeadline (นาฬิกาหยุดนิ่ง เทสกดยิงเอง) · timer งบรอคลัง = timer ปลอมที่เทสยิงเอง
//   ห้ามรอ timer จริง/ห้าม unref: ทุก await ที่รอสัญญาณครอบ settleWithin · การตรวจ "ยังไม่ตอบ" ใช้ setImmediate ไม่กี่รอบ
// mutation: ตัด race งบรอคลัง / ตัดทางข้ามเมื่อไม่พอสำรอง / ตัด skipClassify / service ยิง AI แม้ skipClassify → ต้องแดง
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { manualPipelineDeadline, settleWithin } from './helpers/fake-deadline.mjs';
import {
  getActivePipelineDeadline,
  isPipelineDeadlineError,
  runWithPipelineDeadline,
} from '../src/lib/utils/pipelineDeadline.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ROUTE_SOURCE = read('../src/app/api/auto/process/route.js');
const ARCHIVE_SERVICE_SOURCE = read('../src/lib/services/newsArchiveService.js');

function extractTopLevel(source, predicate, label) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const hits = [];
  for (const node of ast.program.body) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (declaration && predicate(declaration)) hits.push(declaration);
  }
  assert.equal(hits.length, 1, `ต้องพบ ${label} ระดับบนสุดพอดี 1 ตัว (พบ ${hits.length})`);
  return source.slice(hits[0].start, hits[0].end);
}
const fn = (name) => (node) => node.type === 'FunctionDeclaration' && node.id?.name === name;
const constNamed = (name) => (node) => node.type === 'VariableDeclaration' && node.declarations.some((d) => d.id?.name === name);
const extractFn = (source, name) => extractTopLevel(source, fn(name), name);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function waitFor(predicate, turns = 40) {
  if (predicate() || turns <= 0) return predicate();
  await new Promise((resolve) => setImmediate(resolve));
  return waitFor(predicate, turns - 1);
}
function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeout(callback, ms) { const t = { callback, ms, cleared: false, unref() {} }; timers.push(t); return t; },
    clearTimeout(t) { if (t) t.cleared = true; },
    fire(ms) {
      const t = timers.find((item) => item.ms === ms && !item.cleared);
      assert.ok(t, `ต้องมี timer ${ms}ms ที่ยังไม่ถูก clear (มี: ${timers.map((item) => `${item.ms}${item.cleared ? 'x' : ''}`).join(',')})`);
      t.cleared = true;
      t.callback();
    },
  };
}

// ── ตัว helper จริง (หน่วย) ──
function loadBestEffort(source = ROUTE_SOURCE) {
  return new Function('saveToArchiveServerSide', `${extractFn(source, 'saveArchiveBestEffort')}; return saveArchiveBestEffort;`)(
    async () => { throw new Error('หน่วยนี้ต้องส่ง save เอง'); },
  );
}
const fixedDeadline = (remainingMs) => ({ remainingMs: () => remainingMs });
const ARGS = Object.freeze({ newsData: { newsTitle: 'หัวข้อ', newsBody: 'เนื้อ' }, workflowId: 'wf-pl13' });

test('หน่วย saveArchiveBestEffort: 4 ช่วงเวลา (เหลือ 60s/30s/10s + คลังค้าง) และ save ล้ม', async () => {
  const saveArchiveBestEffort = loadBestEffort();
  // เหลือ 60s → เก็บเต็ม (AI จัดหมวด) รอได้ ≤30s
  {
    const t = fakeTimers(); const calls = [];
    const out = await saveArchiveBestEffort(ARGS, { deadline: fixedDeadline(60_000), save: async (a) => { calls.push(a); return true; }, setTimer: t.setTimeout, clearTimer: t.clearTimeout });
    assert.deepEqual(out, { saved: true, skipped: null });
    assert.deepEqual(calls, [ARGS], 'args เดิมทุกคีย์ ไม่มี skipClassify');
    assert.deepEqual(t.timers.map((x) => [x.ms, x.cleared]), [[30_000, true]]);
  }
  // เหลือ 30s → งบ 15s < AI 20s + DB 10s → เก็บด้วยหมวดค่าเริ่มต้น ไม่ยิง AI
  {
    const t = fakeTimers(); const calls = [];
    const out = await saveArchiveBestEffort(ARGS, { deadline: fixedDeadline(30_000), save: async (a) => { calls.push(a); return true; }, setTimer: t.setTimeout, clearTimer: t.clearTimeout });
    assert.equal(out.saved, true);
    assert.deepEqual(out.skipped, { event: 'archive_skipped', reason: 'classify_skipped', remainingMs: 30_000, waitBudgetMs: 15_000, classifySkipped: true });
    assert.deepEqual(calls, [{ ...ARGS, skipClassify: true }]);
  }
  // เหลือ 10s (≤ สำรอง 15s) → ข้ามคลังทั้งขั้น ไม่เรียก save ไม่ตั้ง timer
  {
    const t = fakeTimers(); let called = 0;
    const out = await saveArchiveBestEffort(ARGS, { deadline: fixedDeadline(10_000), save: async () => { called += 1; return true; }, setTimer: t.setTimeout, clearTimer: t.clearTimeout });
    assert.deepEqual(out, { saved: false, skipped: { event: 'archive_skipped', reason: 'deadline_reserve', remainingMs: 10_000, waitBudgetMs: 0, classifySkipped: true } });
    assert.equal(called, 0);
    assert.equal(t.timers.length, 0);
  }
  // เหลือ 60s แต่คลังค้าง (DB/AI ไม่ตอบ) → timer งบ 30s ยิง → เลิกรอ saved=false
  {
    const t = fakeTimers(); const gate = deferred(); let called = 0;
    const pending = saveArchiveBestEffort(ARGS, { deadline: fixedDeadline(60_000), save: () => { called += 1; return gate.promise; }, setTimer: t.setTimeout, clearTimer: t.clearTimeout });
    await waitFor(() => called === 1 && t.timers.length === 1);
    t.fire(30_000);
    const out = await settleWithin(pending, 'งบรอคลังยิงแล้ว helper ต้องคืนผลทันที');
    assert.deepEqual(out, { saved: false, skipped: { event: 'archive_skipped', reason: 'archive_wait_budget', remainingMs: 60_000, waitBudgetMs: 30_000, classifySkipped: false } });
    gate.resolve(true); // งานเบื้องหลังจบทีหลังได้ ไม่กระทบผลที่คืนไปแล้ว
  }
  // save โยน → saved=false ไม่ throw
  {
    const t = fakeTimers();
    const out = await saveArchiveBestEffort(ARGS, { deadline: fixedDeadline(60_000), save: async () => { throw new Error('db down'); }, setTimer: t.setTimeout, clearTimer: t.clearTimeout });
    assert.deepEqual(out, { saved: false, skipped: null });
    assert.equal(t.timers[0].cleared, true);
  }
});

// ── ชั้นคลังจริง: route saveToArchiveServerSide → newsArchiveService.saveNewsArchive (AI เป็นตัวปลอม) ──
function makeRealArchiveSave({ callAI, added }, serviceSource = ARCHIVE_SERVICE_SOURCE) {
  const serviceSlice = [
    extractTopLevel(serviceSource, constNamed('STORE'), 'STORE'),
    extractTopLevel(serviceSource, constNamed('DUPLICATE_KEY_RE'), 'DUPLICATE_KEY_RE'),
    extractFn(serviceSource, 'saveNewsArchive'),
  ].join('\n');
  const createStore = () => ({ getAll: async () => [], add: async (item) => { added.push(item); return item; }, findById: async () => null });
  const saveNewsArchive = new Function('createHash', 'createStore', 'callAI', 'MODEL_FAST', `${serviceSlice}\nreturn saveNewsArchive;`)(createHash, createStore, callAI, 'test-model');
  return new Function('saveNewsArchive', `return (${extractFn(ROUTE_SOURCE, 'saveToArchiveServerSide')});`)(saveNewsArchive);
}

test('ชั้นคลังจริง: skipClassify = ไม่ยิง AI (ไม่เสียเงิน) เก็บหมวด "ทั่วไป" · ไม่ส่ง = ยิง AI เหมือนเดิม', async () => {
  const original = console.warn; const warns = [];
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const aiCalls = []; const added = [];
    const save = makeRealArchiveSave({ callAI: async (args) => { aiCalls.push(args); return { category: 'สังคม', summary: 's', tags: ['t'] }; }, added });
    const newsData = { newsTitle: 'หัวข้อ PL13', newsBody: 'เนื้อข่าว PL13' };
    assert.equal(await save({ newsData, workflowId: 'wf-a', skipClassify: true }), true);
    assert.equal(aiCalls.length, 0, 'skipClassify ต้องไม่ยิง AI');
    assert.equal(added[0].category, 'ทั่วไป');
    assert.ok(warns.some((w) => w.includes('archive_skipped')));
    assert.equal(await save({ newsData: { ...newsData, newsBody: 'อีกข่าว' }, workflowId: 'wf-b' }), true);
    assert.equal(aiCalls.length, 1, 'ปกติต้องยิง AI จัดหมวดเหมือนเดิม');
    assert.equal(added[1].category, 'สังคม');
  } finally {
    console.warn = original;
  }
});

// ── ประกอบ route จริง: handlePost + reportHardDeadlineFailure + runProcessWithDeadline ──
const RAW = 'ลุงสมชายคนเก็บขยะวัย 62 ปี เก็บกระเป๋าสตางค์ที่มีเงินสด 25,000 บาทได้ข้างถนนหน้าตลาดเช้า แล้วนำไปคืนเจ้าของที่สถานีตำรวจทันที';
const PAYLOAD = Object.freeze({ input: RAW, images: [], contentLength: 'long', preset: '', userId: 'pl13-user', deskMeta: null, workflowId: 'wf-pl13' });

function makeRoute({ env = {}, archive, source = ROUTE_SOURCE }) {
  const helpers = ['validateVersionWriterProvenance', 'prepareEnhancedAnalysisResult', 'compactDelegatedVersions', 'saveArchiveBestEffort']
    .map((name) => extractFn(source, name)).join('\n');
  const originalHandler = extractFn(source, 'handlePost');
  const handler = originalHandler.replace(
    /const queueService = await import\(['"]@\/lib\/services\/queueService['"]\);/,
    'const queueService = queueServiceDependency;',
  );
  assert.notEqual(handler, originalHandler, 'harness ต้องแทนเฉพาะ dynamic queue import');
  const statuses = [];
  let persisted = 'processing';
  const jobId = 'q_pl13';
  const attemptId = 'attempt_pl13';
  const queueService = {
    getJobStatus: async () => ({ id: jobId, status: 'processing', attemptId, payload: { ...PAYLOAD } }),
    updateJobStatus: async (_id, status, extra, options) => {
      statuses.push(status);
      const allowed = options?.expectedStatuses || ['processing'];
      if (!allowed.includes(persisted)) {
        const stale = new Error('attempt is no longer processing'); stale.errorType = 'STALE_QUEUE_ATTEMPT'; throw stale;
      }
      persisted = status;
      return { id: jobId, ...extra, status };
    },
  };
  const legacyData = {
    newsData: { newsTitle: 'ลุงเก็บขยะคืนเงิน', newsBody: RAW },
    breakdownData: { primaryCategory: 'ข่าวน้ำดี' },
    analysisResult: { usedModel: 'claude-opus-5-5', usedModels: ['claude-opus-5-5'], versions: [{ title: 'ฉบับหนึ่ง', content: 'เนื้อข่าวฉบับหนึ่ง', usedModel: 'claude-opus-5-5' }] },
    usedPromptInfo: { name: 'การ์ด' }, totalTimeSeconds: 690, log: [],
  };
  const timers = fakeTimers();
  const runs = [];
  const trackedRun = (deadline, fnToRun) => runWithPipelineDeadline(deadline, () => { const r = fnToRun(); runs.push(r); return r; });
  const quiet = { step() {}, error() {}, info() {}, warn() {}, log() {} };
  const built = new Function(
    'NextResponse', 'rlog', 'logPipeline', 'detectInputType', 'routePipeline', 'process', 'isSupabaseReady', 'ensureWorkflow',
    'processAutoFlowText', 'bbSaveTrace', 'saveToArchiveServerSide', 'randomUUID', 'queueServiceDependency',
    'getActivePipelineDeadline', 'isPipelineDeadlineError', 'runWithPipelineDeadline', 'DEADLINE_QUEUE_REPORT_MS',
    'setTimeout', 'clearTimeout',
    `${helpers}\n${handler}\n${extractFn(source, 'reportHardDeadlineFailure')}\n${extractFn(source, 'runProcessWithDeadline')}
     return (request, deadline) => runProcessWithDeadline(request, Date.now(), deadline, {});`,
  )(
    { json: (payload, init = {}) => ({ status: init?.status ?? 200, payload }) },
    quiet,
    async () => {},
    (input) => ({ inputType: 'plain_text', primaryUrl: null, hasText: true, hasUrls: false, hasImage: false, textContent: input, label: 'ข้อความล้วน', confidence: 1, platform: 'text' }),
    () => ({ useEnhancedPipeline: true, pipelineId: 'article_pipeline_enhanced', pipeline: { id: 'article_pipeline_enhanced', label: 'ข่าวข้อความ', icon: '📝' } }),
    { env: { TEXT_ONLY_MODE: '1', ...env } },
    () => true,
    async () => {},
    async () => ({ success: true, data: structuredClone(legacyData) }), // ท่อจบ + บันทึกเคสแล้ว (saveAnalysis อยู่ใน autoFlow)
    () => {},
    archive,
    () => 'uuid-unused',
    queueService,
    getActivePipelineDeadline,
    isPipelineDeadlineError,
    trackedRun,
    20_000,
    timers.setTimeout,
    timers.clearTimeout,
  );
  const request = { headers: { get: () => '' }, json: async () => ({ ...PAYLOAD, _queueJobId: jobId, _queueAttemptId: attemptId }), url: 'http://127.0.0.1:3963/api/auto/process' };
  return { post: (deadline) => built(request, deadline), statuses, getPersisted: () => persisted, timers, runs };
}

function hangingArchive() {
  const gate = deferred();
  const calls = [];
  return { gate, calls, save: (args) => { calls.push(args); return gate.promise; } };
}

async function runHangingArchiveScenario({ env = {}, source } = {}) {
  const archive = hangingArchive();
  const route = makeRoute({ env, archive: archive.save, source });
  const hardDeadline = manualPipelineDeadline(60_000); // ท่อจบตอนเหลือ 60s แต่คลัง (AI/DB) ค้าง
  let response = null;
  const pending = route.post(hardDeadline.deadline).then((r) => { response = r; return r; });
  await waitFor(() => archive.calls.length === 1);
  assert.equal(archive.calls.length, 1, 'route ต้องเริ่มเก็บคลัง');
  return { archive, route, hardDeadline, pending, getResponse: () => response };
}

test('Q6 เดิม (ARCHIVE_BEST_EFFORT=0): คลังค้างจนเส้นตายยิง → งานที่บันทึกเคสแล้วถูกตี failed 504 (ทำซ้ำบั๊ก)', async () => {
  const s = await runHangingArchiveScenario({ env: { ARCHIVE_BEST_EFFORT: '0' } });
  s.hardDeadline.expire();
  const response = await settleWithin(s.pending, 'route ต้องตอบหลังเส้นตายยิง');
  assert.equal(response.status, 504);
  assert.equal(response.payload.errorType, 'PIPELINE_DEADLINE_EXCEEDED');
  assert.equal(s.route.getPersisted(), 'failed', 'บั๊กเดิม: ข่าวเสร็จแต่คิวเป็น failed → บอท ❌ → ส่งซ้ำจ่ายซ้ำ');
  s.archive.gate.resolve(true);
  await settleWithin(Promise.allSettled(s.route.runs), 'งานที่มาช้าต้องจบ');
  assert.equal(s.route.statuses.includes('completed'), false);
});

test('Q6 ใหม่ (ค่าเริ่มต้น): คลังค้าง → เลิกรอที่งบ 30s (ก่อนเส้นตาย) → completed 200 + archive_skipped · เส้นตายไม่ได้ยิงเลย', async () => {
  const s = await runHangingArchiveScenario();
  assert.equal(s.getResponse(), null, 'ยังไม่ควรตอบก่อนงบรอคลังหมด');
  s.route.timers.fire(30_000);
  const response = await settleWithin(s.pending, 'งบรอคลังหมดแล้ว route ต้องตอบทันที');
  assert.equal(response.status, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.archiveSaved, false, 'ไม่ได้ยืนยันคลัง → UI ใช้ client fallback ตามสัญญาเดิม');
  assert.equal(response.payload.archiveSkipped.event, 'archive_skipped');
  assert.equal(response.payload.archiveSkipped.reason, 'archive_wait_budget');
  assert.ok(response.payload.debug.log.some((line) => line.includes('archive_skipped (archive_wait_budget)')));
  assert.deepEqual(s.route.statuses, ['completed']);
  assert.equal(s.route.getPersisted(), 'completed');
  assert.equal(s.hardDeadline.timers[0].cleared, true, 'route จบก่อนเส้นตาย (dispose timer แล้ว)');
  s.archive.gate.resolve(true); // คลังเบื้องหลังจบทีหลัง — ห้ามเปลี่ยนสถานะ
  await settleWithin(Promise.allSettled(s.route.runs), 'งานต้องจบ');
  assert.equal(s.route.getPersisted(), 'completed');
});

test('Q6 ใหม่: เหลือ 20s → เก็บคลังโดยไม่ยิง AI (skipClassify) · เหลือ 10s → ข้ามคลัง · ทั้งคู่ completed + archive_skipped', async () => {
  for (const [remaining, reason, expectCall] of [[20_000, 'classify_skipped', true], [10_000, 'deadline_reserve', false]]) {
    const calls = [];
    const route = makeRoute({ archive: async (args) => { calls.push(args); return true; } });
    const deadline = manualPipelineDeadline(remaining);
    const response = await settleWithin(route.post(deadline.deadline), `เหลือ ${remaining}ms route ต้องตอบ`);
    assert.equal(response.status, 200, String(remaining));
    assert.equal(response.payload.archiveSkipped.reason, reason, String(remaining));
    assert.equal(route.getPersisted(), 'completed', String(remaining));
    assert.equal(calls.length, expectCall ? 1 : 0, String(remaining));
    if (expectCall) {
      assert.equal(calls[0].skipClassify, true);
      assert.equal(response.payload.archiveSaved, true);
    } else {
      assert.equal(response.payload.archiveSaved, false);
    }
  }
});

test('Q6 ใหม่: เหลือเวลาพอ → เก็บคลังปกติ (args เดิม ไม่มี archiveSkipped) · เดิมก็ผลเดียวกัน', async () => {
  for (const env of [{}, { ARCHIVE_BEST_EFFORT: '0' }]) {
    const calls = [];
    const route = makeRoute({ env, archive: async (args) => { calls.push(args); return true; } });
    const response = await settleWithin(route.post(manualPipelineDeadline(300_000).deadline), 'route ต้องตอบ');
    assert.equal(response.status, 200);
    assert.equal(response.payload.archiveSaved, true);
    assert.equal('archiveSkipped' in response.payload, false);
    assert.deepEqual(Object.keys(calls[0]), ['newsData', 'breakdownData', 'sourceType', 'sourceUrl', 'workflowId', 'archivedBy', 'coverImage']);
  }
});

test('สวิตช์ ARCHIVE_BEST_EFFORT: 0/legacy/off/false/no (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = เส้นเดิม · ค่าอื่น = ใหม่', async () => {
  for (const [value, expectNew] of [['0', false], [' Legacy ', false], ['"off"', false], ['FALSE', false], ['no', false], ['1', true], ['', true], ['on', true]]) {
    const calls = [];
    const route = makeRoute({ env: { ARCHIVE_BEST_EFFORT: value }, archive: async (args) => { calls.push(args); return true; } });
    const response = await settleWithin(route.post(manualPipelineDeadline(10_000).deadline), `ค่า ${value}`);
    // เหลือ 10s: ใหม่ = ข้ามคลัง (ไม่เรียก) · เดิม = เรียกคลังตรงเหมือนเดิม
    assert.equal(calls.length, expectNew ? 0 : 1, `ค่า "${value}"`);
    assert.equal(response.status, 200);
  }
});

test('mutation: ตัด race งบรอคลัง / ตัดทางข้ามเมื่อไม่พอสำรอง / ตัด skipClassify / service ยิง AI แม้ skipClassify → ต้องแดง', async () => {
  // M1: รอคลังตรงๆ ไม่มีงบ → คลังค้างแล้ว route ไม่ตอบแม้งบหมด (กลับไปเสี่ยงชนเส้นตายแบบเดิม)
  const m1Source = ROUTE_SOURCE.replace('const outcome = await Promise.race([archiveRun, budgetRun]);', 'const outcome = await archiveRun; void budgetRun;');
  assert.notEqual(m1Source, ROUTE_SOURCE, 'สร้าง M1 ไม่ได้');
  const s = await runHangingArchiveScenario({ source: m1Source });
  s.route.timers.fire(30_000);
  assert.equal(await waitFor(() => s.getResponse() !== null, 20), false, 'M1: route ต้องยังไม่ตอบ (ข้อสอบงบรอคลังกัดจริง)');
  s.archive.gate.resolve(true);
  await settleWithin(s.pending, 'M1 ปล่อยคลังแล้วต้องจบ');
  await settleWithin(Promise.allSettled(s.route.runs), 'M1 งานต้องจบ');

  // M2: ตัดทางข้ามเมื่อไม่พอสำรอง → เหลือ 10s ยังเรียกคลัง
  const m2Source = ROUTE_SOURCE.replace("if (!(waitBudgetMs > 0)) return { saved: false, skipped: skipped('deadline_reserve', true) };", '');
  assert.notEqual(m2Source, ROUTE_SOURCE, 'สร้าง M2 ไม่ได้');
  const m2 = loadBestEffort(m2Source);
  const t = fakeTimers(); let m2Calls = 0;
  const m2Out = await m2(ARGS, { deadline: fixedDeadline(10_000), save: async () => { m2Calls += 1; return true; }, setTimer: t.setTimeout, clearTimer: t.clearTimeout });
  assert.ok(m2Calls === 1 || m2Out.skipped?.reason !== 'deadline_reserve', 'M2 ต้องเปลี่ยนผล (ข้อสอบช่วงไม่พอสำรองกัดจริง)');

  // M3: ตัด skipClassify → เหลือ 30s ยังยิง AI
  const m3Source = ROUTE_SOURCE.replace('save(classifySkipped ? { ...archiveArgs, skipClassify: true } : archiveArgs)', 'save(archiveArgs)');
  assert.notEqual(m3Source, ROUTE_SOURCE, 'สร้าง M3 ไม่ได้');
  const m3Calls = [];
  const t3 = fakeTimers();
  await loadBestEffort(m3Source)(ARGS, { deadline: fixedDeadline(30_000), save: async (a) => { m3Calls.push(a); return true; }, setTimer: t3.setTimeout, clearTimer: t3.clearTimeout });
  assert.notEqual(m3Calls[0].skipClassify, true, 'M3 ต้องทำให้ skipClassify หาย (ข้อสอบกัดจริง)');

  // M4: service ยิง AI แม้ skipClassify
  const m4Source = ARCHIVE_SERVICE_SOURCE.replace('const aiResult = skipClassify ? null : await callAI({', 'const aiResult = await callAI({');
  assert.notEqual(m4Source, ARCHIVE_SERVICE_SOURCE, 'สร้าง M4 ไม่ได้');
  const aiCalls = []; const added = [];
  const original = console.warn; console.warn = () => {};
  try {
    await makeRealArchiveSave({ callAI: async (a) => { aiCalls.push(a); return {}; }, added }, m4Source)({ newsData: { newsTitle: 'x', newsBody: 'y' }, skipClassify: true });
  } finally { console.warn = original; }
  assert.equal(aiCalls.length, 1, 'M4: ยิง AI แม้สั่งข้าม (ข้อสอบชั้นคลังกัดจริง)');
});
