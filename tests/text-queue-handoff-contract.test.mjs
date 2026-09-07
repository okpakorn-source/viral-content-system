// Production-coupled contract for the raw-text queue handoff.
// In-memory only: no AI, HTTP, Supabase, server, secret, or external write.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import {
  createPipelineDeadline,
  getActivePipelineDeadline,
  runWithPipelineDeadline,
} from '../src/lib/utils/pipelineDeadline.js';

const TESTS = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(TESTS, '..');
const paths = {
  queue: join(ROOT, 'src', 'lib', 'services', 'queueService.js'),
  queueAdd: join(ROOT, 'src', 'app', 'api', 'queue', 'add', 'route.js'),
  worker: join(ROOT, 'src', 'app', 'api', 'queue', 'worker', 'route.js'),
  process: join(ROOT, 'src', 'app', 'api', 'auto', 'process', 'route.js'),
  status: join(ROOT, 'src', 'app', 'api', 'queue', 'status', 'route.js'),
  page: join(ROOT, 'src', 'app', 'content', 'new', 'page.js'),
};
const production = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);

const RAW = 'สุนารี มีอาชีพเกษตรกรเป็นอาชีพหลัก เป็นอาชีพพ่ออาชีพแม่ที่สุนารีรักมาก และอาชีพนักร้องเป็นอาชีพเสริมมาโดยตลอด เกิดและเติบโตในครอบครัวชาวนาที่มีพี่น้อง 11 คน ต้องช่วยพ่อแม่ทำนาตั้งแต่อายุ 8–9 ขวบ ตื่นตี 4 ตี 5 เพื่อต้อนควายไปทำนา  ตลอดระยะเวลา 42–43 ปีในวงการบันเทิงไม่เคยเลิกทำนา ยังคงปลูกข้าว ปลูกผัก เลี้ยงปลา และนำไปแบ่งปันเพื่อนบ้าน มีการนำผลผลิตมาขายถุงละ 20 บาท โดยมองว่าเงินทุกบาทมีค่า';
const ORIGINAL_PAYLOAD = Object.freeze({
  input: RAW,
  images: [],
  contentLength: 'long',
  preset: 'feature-r55',
  userId: 'codex-r55-contract',
  deskMeta: { desk: 'quality', editor: 'owner' },
  workflowId: 'owner-workflow-r55',
  jobType: 'news',
});

function parseModule(source) {
  return parse(source, { sourceType: 'module', plugins: ['jsx'] });
}

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key === 'comments' || key === 'tokens') continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit, node);
    }
  }
}

function topLevelFunctionNode(source, name) {
  const ast = parseModule(source);
  const matches = [];
  for (const statement of ast.program.body) {
    const candidate = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (candidate?.type === 'FunctionDeclaration' && candidate.id?.name === name) matches.push(candidate);
  }
  assert.equal(matches.length, 1, `ต้องพบ executable top-level function ${name} เพียงหนึ่งตัว`);
  return matches[0];
}

function extractTopLevelFunction(source, name) {
  const node = topLevelFunctionNode(source, name);
  return source.slice(node.start, node.end);
}

function extractVariableInitializer(source, name) {
  const ast = parseModule(source);
  const matches = [];
  walk(ast.program, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier'
        && node.id.name === name && node.init) matches.push(node.init);
  });
  assert.equal(matches.length, 1, `ต้องพบ executable variable ${name} เพียงหนึ่งตัว`);
  return source.slice(matches[0].start, matches[0].end);
}

function extractUseCallbackArgument(source, name) {
  const ast = parseModule(source);
  const matches = [];
  walk(ast.program, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id?.name !== name) return;
    if (node.init?.type === 'CallExpression' && node.init.callee?.name === 'useCallback'
        && node.init.arguments[0]) matches.push(node.init.arguments[0]);
  });
  assert.equal(matches.length, 1, `ต้องพบ useCallback ${name} เพียงหนึ่งตัว`);
  return source.slice(matches[0].start, matches[0].end);
}

function extractQueueUiAssignmentBlock(source) {
  const ast = parseModule(source);
  let ownerBlock = null;
  let startIndex = -1;
  walk(ast.program, (node, parent) => {
    if (ownerBlock || node.type !== 'ExpressionStatement' || parent?.type !== 'BlockStatement') return;
    const call = node.expression;
    if (call?.type === 'CallExpression' && call.callee?.name === 'setUniversalDetection') {
      ownerBlock = parent;
      startIndex = parent.body.indexOf(node);
    }
  });
  assert.ok(ownerBlock && startIndex >= 0, 'ต้องพบบล็อก UI ที่เริ่ม setUniversalDetection');
  let endIndex = -1;
  for (let index = startIndex; index < ownerBlock.body.length; index += 1) {
    const statement = ownerBlock.body[index];
    const call = statement?.type === 'ExpressionStatement' ? statement.expression : null;
    if (call?.type === 'CallExpression' && call.callee?.name === 'setAutoLog') {
      endIndex = index;
      break;
    }
  }
  assert.ok(endIndex >= startIndex, 'ต้องพบบล็อก UI จนถึง setAutoLog');
  return source.slice(ownerBlock.body[startIndex].start, ownerBlock.body[endIndex].end);
}

function assertPageFinalizationWiring(pageSource = production.page) {
  const ast = parseModule(pageSource);
  const calls = [];
  walk(ast.program, (node, parent) => {
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier'
        && node.callee.name === 'finalizeQueueArchive') calls.push({ node, parent });
  });
  assert.equal(calls.length, 2, 'ทางเข้าข่าวทั้งสองจุดต้องยืนยัน archive ก่อนล้าง recovery token');
  const archiveOwners = [];
  for (const { node, parent } of calls) {
    assert.equal(parent?.type, 'AwaitExpression', 'การยืนยัน archive ต้อง await ให้รู้ผลจริง');
    assert.equal(node.arguments.length, 6, 'finalizeQueueArchive ต้องรับข้อมูลครบรวม recovery token');
    const archiveCheck = node.arguments[0];
    assert.equal(archiveCheck?.type, 'BinaryExpression');
    assert.equal(archiveCheck?.operator, '===');
    assert.equal(archiveCheck?.right?.type, 'BooleanLiteral');
    assert.equal(archiveCheck?.right?.value, true, 'ต้องเชื่อ archiveSaved เฉพาะเมื่อผลจริงเป็น true');
    assert.ok(
      archiveCheck?.left?.type === 'MemberExpression'
        || archiveCheck?.left?.type === 'OptionalMemberExpression',
      'argument แรกต้องอ่าน archiveSaved จากผลจริง',
    );
    assert.equal(archiveCheck.left.property?.name, 'archiveSaved');
    assert.equal(archiveCheck.left.object?.type, 'Identifier');
    archiveOwners.push(archiveCheck.left.object.name);
    const hasPayloadProperty = (argument, propertyName) => {
      let found = false;
      walk(argument, (candidate) => {
        if ((candidate.type === 'MemberExpression' || candidate.type === 'OptionalMemberExpression')
            && candidate.property?.name === propertyName) found = true;
      });
      return found;
    };
    assert.ok(hasPayloadProperty(node.arguments[1], 'newsData'), 'argument 2 ต้องส่ง newsData จริง');
    assert.ok(hasPayloadProperty(node.arguments[2], 'breakdownData'), 'argument 3 ต้องส่ง breakdownData จริง');
    assert.equal(node.arguments[3]?.type, 'Identifier');
    assert.equal(node.arguments[3]?.name, 'coverBase64', 'argument 4 ต้องส่งปกของผลนี้');
    assert.equal(node.arguments[4]?.type, 'ObjectExpression');
    const metadataKeys = node.arguments[4].properties.map(property => property.key?.name).sort();
    assert.deepEqual(metadataKeys, ['sourceType', 'workflowId'], 'argument 5 ต้องส่ง metadata ข่าวครบ');
    assert.equal(node.arguments[5]?.type, 'Identifier');
    assert.equal(node.arguments[5]?.name, 'recoveryToken', 'argument สุดท้ายต้องเป็น token ของงานที่จบ');
  }
  assert.deepEqual(archiveOwners.sort(), ['data', 'queueResult']);
}

function responseJson(payload, options = {}) {
  const status = options?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    payload,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function makeStore(rows = new Map()) {
  return {
    rows,
    async getAll() { return [...rows.values()].map(clone); },
    async findById(id) { return rows.has(id) ? clone(rows.get(id)) : null; },
    async add(row) {
      if (rows.has(row.id)) throw new Error('duplicate key value violates unique constraint');
      rows.set(row.id, clone(row));
      return clone(row);
    },
    async update(id, update) {
      if (!rows.has(id)) return null;
      const current = clone(rows.get(id));
      const next = typeof update === 'function' ? await update(current) : { ...current, ...update };
      rows.set(id, clone(next));
      return clone(next);
    },
    async remove(id) { return rows.delete(id); },
  };
}

function makeFakeSupabase(rows, hooks = {}) {
  return {
    from(table) {
      assert.equal(table, 'store_items');
      const state = { conditions: [], filters: [], updatePayload: null, selected: null };
      const query = {
        select(columns) {
          state.selected = columns;
          if (!state.updatePayload) return query;
          const idCondition = state.conditions.find(([field]) => field === 'id');
          const storeCondition = state.conditions.find(([field]) => field === 'store_name');
          if (!idCondition || storeCondition?.[1] !== 'job_queue') {
            return Promise.resolve({ data: [], error: null });
          }
          const id = idCondition[1];
          const current = rows.get(id);
          const matches = Boolean(current) && state.filters.every(([field, op, expected]) => {
            const key = field.replace(/^data->>/, '');
            if (op === 'in') return expected.map(String).includes(String(current?.[key] ?? ''));
            assert.equal(op, 'eq');
            return String(current?.[key] ?? '') === String(expected ?? '');
          });
          if (!matches) return Promise.resolve({ data: [], error: null });
          rows.set(id, clone(state.updatePayload.data));
          const written = rows.get(id);
          return Promise.resolve({
            data: columns === 'id' ? [{ id }] : [{ data: clone(written) }],
            error: null,
          });
        },
        update(payload) { state.updatePayload = payload; return query; },
        eq(field, value) { state.conditions.push([field, value]); return query; },
        filter(field, op, value) { state.filters.push([field, op, value]); return query; },
        in(field, values) { state.filters.push([field, 'in', values]); return query; },
        is(field, value) { state.filters.push([field, 'eq', value]); return query; },
        async single() {
          const id = state.conditions.find(([field]) => field === 'id')?.[1];
          const storeName = state.conditions.find(([field]) => field === 'store_name')?.[1];
          if (storeName !== 'job_queue' || !rows.has(id)) {
            return { data: null, error: { message: 'not found' } };
          }
          const snapshot = clone(rows.get(id));
          if (hooks.afterSingle) await hooks.afterSingle({ id, snapshot: clone(snapshot), rows });
          return { data: { data: snapshot }, error: null };
        },
      };
      return query;
    },
  };
}

function makeAtomicQueueRuntime(rows, queueSource = production.queue, supabaseHooks = {}) {
  const declarations = [
    '_readQueueJobSupabase',
    '_atomicClaimSupabase',
    '_staleAttemptError',
    '_atomicUpdateClaimedSupabase',
    '_matchesQueueState',
    '_atomicTransitionSupabase',
  ].map(name => extractTopLevelFunction(queueSource, name)).join('\n');
  return new Function(
    'getSupabase',
    `const QUEUE_STORE = 'job_queue';\n${declarations}\nreturn { _atomicClaimSupabase, _atomicUpdateClaimedSupabase, _atomicTransitionSupabase };`,
  )(() => makeFakeSupabase(rows, supabaseHooks));
}

function localQueueTransitionSources(queueSource) {
  return [
    '_queueCasMissError',
    '_matchesQueueState',
    '_transitionQueueJob',
    '_restoreReplacementPredecessors',
  ].map(name => extractTopLevelFunction(queueSource, name)).join('\n');
}

function makeEnqueueJob(store, atomicRuntime, queueSource = production.queue) {
  const fingerprint = extractTopLevelFunction(queueSource, '_queuePayloadFingerprint');
  const hash = extractTopLevelFunction(queueSource, '_contentHashId');
  const enqueue = extractTopLevelFunction(queueSource, 'enqueueJob');
  return new Function(
    'createHash', 'uuidv4', 'getQueueStore', 'withEnqueueLock', 'console',
    'isSupabaseReady', '_atomicTransitionSupabase',
    `${fingerprint}\n${hash}\n${localQueueTransitionSources(queueSource)}\n${enqueue}; return enqueueJob;`,
  )(
    createHash,
    () => 'uuid-unused',
    async () => store,
    fn => fn(),
    { log() {}, warn() {}, error() {} },
    () => true,
    atomicRuntime._atomicTransitionSupabase,
  );
}

function makeGetNextPendingJobs(store, atomicRuntime, queueSource = production.queue) {
  const claim = extractTopLevelFunction(queueSource, 'getNextPendingJobs');
  let attemptNumber = 0;
  return new Function(
    'getQueueStore', 'withEnqueueLock', 'isSupabaseReady', '_atomicClaimSupabase',
    'uuidv4', 'console', 'process', '_startupResetDone',
    `${claim}; return getNextPendingJobs;`,
  )(
    async () => store,
    fn => fn(),
    () => true,
    atomicRuntime._atomicClaimSupabase,
    () => `attempt-r55-${++attemptNumber}`,
    { log() {}, warn() {} },
    { platform: 'win32', env: { QUEUE_LOCAL_NEWS: '1' } },
    true,
  );
}

function makeUpdateJobStatus(store, atomicRuntime, queueSource = production.queue) {
  const stale = extractTopLevelFunction(queueSource, '_staleAttemptError');
  const update = extractTopLevelFunction(queueSource, 'updateJobStatus');
  return new Function(
    'getQueueStore', 'isSupabaseReady', '_atomicUpdateClaimedSupabase',
    `${stale}\n${update}; return updateJobStatus;`,
  )(
    async () => store,
    () => true,
    atomicRuntime._atomicUpdateClaimedSupabase,
  );
}

function makeGetJobStatus(store, queueSource = production.queue) {
  const get = extractTopLevelFunction(queueSource, 'getJobStatus');
  return new Function('getQueueStore', `${get}; return getJobStatus;`)(async () => store);
}

function makeProcessPost({
  queueService,
  waitForWriter,
  onWriter = () => {},
  writerError = null,
  serverArchiveResult = true,
  processSource = production.process,
}) {
  const helpers = [
    'validateVersionWriterProvenance',
    'prepareEnhancedAnalysisResult',
    'compactDelegatedVersions',
  ].map(name => extractTopLevelFunction(processSource, name)).join('\n');
  const originalHandler = extractTopLevelFunction(processSource, 'handlePost');
  const handler = originalHandler.replace(
    /const queueService = await import\(['"]@\/lib\/services\/queueService['"]\);/,
    'const queueService = queueServiceDependency;',
  );
  assert.notEqual(handler, originalHandler, 'test harness ต้องแทนเฉพาะ dynamic queue import');
  const hardDeadlineReporter = extractTopLevelFunction(processSource, 'reportHardDeadlineFailure');
  const hardDeadlineRunner = extractTopLevelFunction(processSource, 'runProcessWithDeadline');

  const legacyData = {
    newsData: { newsTitle: 'สุนารีกับอาชีพที่รัก', newsBody: RAW },
    breakdownData: { primaryCategory: 'บุคคล', possible_angles: [{ angle: 'รากชีวิต' }] },
    analysisResult: {
      usedModel: 'claude-fable-5',
      usedModels: ['claude-fable-5'],
      versions: [
        { title: 'ฉบับหนึ่ง', content: 'เนื้อข่าวฉบับหนึ่ง', usedModel: 'claude-fable-5' },
        { title: 'ฉบับสอง', content: 'เนื้อข่าวฉบับสอง', usedModel: 'claude-fable-5' },
      ],
    },
    usedPromptInfo: { name: 'Existing Library Card', source: 'library' },
    totalTimeSeconds: 12.5,
    providerUsed: 'raw-text',
    log: ['production-coupled-contract'],
  };
  const quiet = { step() {}, error() {}, info() {}, warn() {}, log() {} };
  let writerCalls = 0;
  const serverArchiveCalls = [];
  const processAutoFlowText = async (input) => {
    writerCalls += 1;
    onWriter(input);
    if (waitForWriter) await waitForWriter;
    if (writerError) throw writerError;
    return { success: true, data: clone(legacyData) };
  };
  const processFunctions = new Function(
    'NextResponse', 'rlog', 'logPipeline', 'detectInputType', 'routePipeline',
    'process', 'isSupabaseReady', 'ensureWorkflow', 'processAutoFlowText',
    'bbSaveTrace', 'saveToArchiveServerSide', 'randomUUID', 'queueServiceDependency',
    'getActivePipelineDeadline', 'isPipelineDeadlineError',
    'runWithPipelineDeadline', 'DEADLINE_QUEUE_REPORT_MS',
    `${helpers}\n${handler}\n${hardDeadlineReporter}\n${hardDeadlineRunner}; return {
      direct: (request) => handlePost(request, Date.now()),
      hard: (request, deadline) => runProcessWithDeadline(request, Date.now(), deadline, {}),
    };`,
  )(
    { json: responseJson },
    quiet,
    async () => {},
    input => ({
      inputType: 'plain_text', primaryUrl: null, hasText: true, hasUrls: false,
      hasImage: false, textContent: input, label: 'ข้อความล้วน', confidence: 1, platform: 'text',
    }),
    () => ({
      useEnhancedPipeline: true,
      pipelineId: 'article_pipeline_enhanced',
      pipeline: { id: 'article_pipeline_enhanced', label: 'ข่าวข้อความ', icon: '📝' },
    }),
    { env: { TEXT_ONLY_MODE: '1' } },
    () => true,
    async (_id, context) => {
      assert.equal(context.rawInput, RAW);
      assert.equal(context.sourceType, 'plain_text');
    },
    processAutoFlowText,
    () => {},
    async (...args) => {
      serverArchiveCalls.push(args);
      return serverArchiveResult;
    },
    () => 'direct-uuid-unused',
    queueService,
    getActivePipelineDeadline,
    error => error?.errorType === 'PIPELINE_DEADLINE_EXCEEDED',
    runWithPipelineDeadline,
    20_000,
  );
  return {
    post: processFunctions.direct,
    postWithDeadline: processFunctions.hard,
    getWriterCalls: () => writerCalls,
    getServerArchiveCalls: () => clone(serverArchiveCalls),
  };
}

class TimerTracker {
  constructor({ autoFire = false } = {}) {
    this.autoFire = autoFire;
    this.nextId = 0;
    this.active = new Set();
    this.fired = 0;
  }
  setTimeout = (callback) => {
    const id = ++this.nextId;
    this.active.add(id);
    if (this.autoFire) {
      setImmediate(() => {
        if (!this.active.delete(id)) return;
        this.fired += 1;
        callback();
      });
    }
    return id;
  };
  clearTimeout = (id) => { this.active.delete(id); };
}

function makeWorkerPost({ getNextPendingJobs, updateJobStatus, fetch, timers, workerSource = production.worker }) {
  const classify = extractTopLevelFunction(workerSource, 'classifyQueueFetchFailure');
  const post = extractTopLevelFunction(workerSource, 'POST');
  return new Function(
    'NextResponse', 'getNextPendingJobs', 'updateJobStatus', 'cleanupStaleJobs', 'logger',
    'process', 'fetch', 'NEWS_DEADLINE_MS', 'NEWS_PIPELINE_BUDGET_MS', 'getNewsAgent', 'setTimeout', 'clearTimeout',
    `${classify}\n${post}; return POST;`,
  )(
    { json: responseJson }, getNextPendingJobs, updateJobStatus, async () => 0,
    { info() {}, warn() {}, error() {} }, { env: { QUEUE_FETCH_LONG_AGENT: '0' } },
    fetch, 770_000, 700_000, () => undefined, timers.setTimeout, timers.clearTimeout,
  );
}

function makeQueueAddPost({ enqueueJob, createStore, fetch, timers, queueAddSource = production.queueAdd }) {
  const post = extractTopLevelFunction(queueAddSource, 'POST');
  return new Function(
    'NextResponse', 'enqueueJob', 'createStore', 'logger', 'isSupabaseReady',
    'process', 'fetch', 'setTimeout',
    `${post}; return POST;`,
  )(
    { json: responseJson }, enqueueJob, createStore, { info() {}, warn() {}, error() {} },
    () => true, { env: { TEXT_ONLY_MODE: '1', API_SECRET_KEY: 'test-key' } }, fetch, timers.setTimeout,
  );
}

function makeStatusGet({ getJobStatus, statusSource = production.status }) {
  const get = extractTopLevelFunction(statusSource, 'GET');
  return new Function(
    'NextResponse', 'getJobStatus', 'getQueueOverview', 'cleanupStaleJobs', 'logger', 'fetch',
    `let _lastCleanupAt = Date.now(); let _lastReviveAt = Date.now();\n${get}; return GET;`,
  )(
    { json: responseJson }, getJobStatus,
    async () => ({ pending: 0, processing: 0, completed: 1, failed: 0 }),
    async () => 0, { info() {}, error() {} },
    async () => { throw new Error('status must not wake a worker in this contract'); },
  );
}

function makeRecoveryHelpers(pageSource = production.page) {
  const declarations = [
    'readQueueRecoveryToken', 'queueRecoveryTokenMatches', 'clearQueueRecoveryTokenIfOwned',
  ].map(name => extractTopLevelFunction(pageSource, name)).join('\n');
  return new Function(`${declarations}; return { readQueueRecoveryToken, queueRecoveryTokenMatches, clearQueueRecoveryTokenIfOwned };`)();
}

function makeSubmitViaQueue(fetch, localStorage, timers, state, pageSource = production.page) {
  const declaration = extractVariableInitializer(pageSource, 'submitViaQueue');
  const recovery = makeRecoveryHelpers(pageSource);
  const set = name => value => {
    state[name] = value;
    if (name === 'queueStatus') state.queueStatusHistory.push(value);
  };
  return new Function(
    'fetch', 'setQueueJobId', 'setQueuePosition', 'setQueueStatus', 'setQueuePolling',
    'setAutoProgress', 'setRecoveryJob', 'localStorage', 'AbortSignal', 'console', 'setTimeout',
    'clearQueueRecoveryTokenIfOwned', `return (${declaration});`,
  )(
    fetch, set('queueJobId'), set('queuePosition'), set('queueStatus'), set('queuePolling'),
    set('autoProgress'), set('recoveryJob'), localStorage, { timeout: () => ({}) },
    { log() {}, warn() {} }, timers.setTimeout, recovery.clearQueueRecoveryTokenIfOwned,
  );
}

function applyNormalQueueUiState(result, state, pageSource = production.page) {
  const block = extractQueueUiAssignmentBlock(pageSource);
  const set = name => value => { state[name] = value; };
  return new Function(
    'data', 'resolvedAnalysis', 'setUniversalDetection', 'setNewsData', 'setBreakdownData',
    'setAnalysisResult', 'setWorkflowId', 'setSourceType', 'setAutoLog', `${block}; return true;`,
  )(
    result, result.analysisResult, set('detection'), set('newsData'), set('breakdownData'),
    set('analysisResult'), set('workflowId'), set('sourceType'), set('log'),
  );
}

function makeFinalizeQueueArchive({ autoSaveToArchive, setArchiveSavedFlag, localStorage, setError, pageSource = production.page }) {
  const declaration = extractUseCallbackArgument(pageSource, 'finalizeQueueArchive');
  const recovery = makeRecoveryHelpers(pageSource);
  return new Function(
    'autoSaveToArchive', 'setArchiveSavedFlag', 'clearQueueRecoveryTokenIfOwned',
    'localStorage', 'setError', `return (${declaration});`,
  )(
    autoSaveToArchive, setArchiveSavedFlag, recovery.clearQueueRecoveryTokenIfOwned,
    localStorage, setError,
  );
}

function makeLocalStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, turns = 40) {
  if (predicate() || turns <= 0) return predicate();
  await new Promise(resolve => setImmediate(resolve));
  return waitFor(predicate, turns - 1);
}

async function assertAtomicClaimContract(queueSource = production.queue) {
  const rows = new Map();
  const jobId = 'q_atomic_r55';
  rows.set(jobId, {
    id: jobId, payload: clone(ORIGINAL_PAYLOAD), status: 'pending', attemptId: null,
    createdAt: new Date().toISOString(),
  });
  const atomic = makeAtomicQueueRuntime(rows, queueSource);
  const [first, second] = await Promise.all([
    atomic._atomicClaimSupabase(jobId, 'attempt-a', '2026-08-21T00:00:00.000Z'),
    atomic._atomicClaimSupabase(jobId, 'attempt-b', '2026-08-21T00:00:00.001Z'),
  ]);
  const winners = [first, second].filter(Boolean);
  assert.equal(winners.length, 1, 'สอง worker ต้อง claim pending row เดียวได้คนเดียว');
  assert.equal(rows.get(jobId).status, 'processing');
  assert.equal(rows.get(jobId).attemptId, winners[0].attemptId);
  const completed = await atomic._atomicUpdateClaimedSupabase(
    jobId, winners[0].attemptId, 'completed', { result: { success: true } },
  );
  assert.equal(completed.status, 'completed');
  const deadlineFailed = await atomic._atomicUpdateClaimedSupabase(
    jobId,
    winners[0].attemptId,
    'failed',
    { errorType: 'PIPELINE_DEADLINE_EXCEEDED' },
    ['processing', 'completed'],
  );
  assert.equal(deadlineFailed.status, 'failed', 'hard deadline ต้องแก้ completed ของ attempt เดิมเป็น failed ได้');
  await assert.rejects(
    atomic._atomicUpdateClaimedSupabase(jobId, 'attempt-stale', 'failed', { error: 'stale' }),
    error => error?.errorType === 'STALE_QUEUE_ATTEMPT',
  );
}

async function assertAttemptCommitFence(queueSource = production.queue) {
  const rows = new Map();
  const jobId = 'q_attempt_race_r55';
  rows.set(jobId, {
    id: jobId,
    payload: clone(ORIGINAL_PAYLOAD),
    status: 'processing',
    attemptId: 'attempt-a',
    startedAt: '2026-08-21T00:00:00.000Z',
  });
  let switched = false;
  const atomic = makeAtomicQueueRuntime(rows, queueSource, {
    async afterSingle({ id }) {
      if (switched || id !== jobId) return;
      switched = true;
      rows.set(jobId, {
        ...clone(rows.get(jobId)),
        status: 'processing',
        attemptId: 'attempt-b',
        startedAt: '2026-08-21T00:00:01.000Z',
      });
    },
  });
  await assert.rejects(
    atomic._atomicUpdateClaimedSupabase(
      jobId,
      'attempt-a',
      'completed',
      { result: { stale: true } },
    ),
    error => error?.errorType === 'STALE_QUEUE_ATTEMPT',
  );
  assert.equal(rows.get(jobId).status, 'processing');
  assert.equal(rows.get(jobId).attemptId, 'attempt-b');
  assert.equal(rows.get(jobId).result, undefined, 'ผลจาก attempt A ห้ามเขียนทับ attempt B ที่ชนะแล้ว');
}

async function runContract(overrides = {}) {
  const queueSource = overrides.queueSource || production.queue;
  const queueAddSource = overrides.queueAddSource || production.queueAdd;
  const workerSource = overrides.workerSource || production.worker;
  const processSource = overrides.processSource || production.process;
  const statusSource = overrides.statusSource || production.status;
  const pageSource = overrides.pageSource || production.page;
  const serverArchiveResult = overrides.serverArchiveResult ?? true;
  assertPageFinalizationWiring(pageSource);

  const events = [];
  const rows = new Map();
  const store = makeStore(rows);
  const atomic = makeAtomicQueueRuntime(rows, queueSource);
  const enqueueJob = makeEnqueueJob(store, atomic, queueSource);
  const getNextPendingJobs = makeGetNextPendingJobs(store, atomic, queueSource);
  const actualUpdateJobStatus = makeUpdateJobStatus(store, atomic, queueSource);
  const getJobStatus = makeGetJobStatus(store, queueSource);
  const statusUpdates = [];
  const updateJobStatus = async (...args) => {
    statusUpdates.push(args);
    return actualUpdateJobStatus(...args);
  };

  const writerGate = deferred();
  let writerGateReleased = false;
  const releaseWriter = () => {
    if (!writerGateReleased) {
      writerGateReleased = true;
      writerGate.resolve();
    }
  };
  let forwardedPayload = null;
  let processResponse = null;
  const processRuntime = makeProcessPost({
    queueService: { getJobStatus, updateJobStatus },
    waitForWriter: writerGate.promise,
    onWriter(input) {
      assert.equal(input.text, RAW);
      assert.equal(input.workflowId, ORIGINAL_PAYLOAD.workflowId);
    },
    serverArchiveResult,
    processSource,
  });

  const processFetch = async (url, options) => {
    events.push('process-fetch');
    assert.equal(url, 'http://127.0.0.1:3963/api/auto/process');
    forwardedPayload = JSON.parse(options.body);
    const expectedJob = [...rows.values()].find(row => row.status === 'processing');
    assert.ok(expectedJob, 'worker ต้อง claim งานก่อนเรียก process');
    processResponse = await processRuntime.post({
      headers: { get: () => '' }, json: async () => forwardedPayload, url,
    });
    events.push('process-completed');
    return processResponse;
  };

  const workerTimers = new TimerTracker();
  const workerPost = makeWorkerPost({
    getNextPendingJobs, updateJobStatus, fetch: processFetch, timers: workerTimers, workerSource,
  });
  let workerPromise = null;
  let workerResponse = null;
  const queueAddFetch = (url, options) => {
    events.push('worker-fetch');
    assert.equal(url, 'http://127.0.0.1:3963/api/queue/worker');
    workerPromise = workerPost({
      headers: { get: name => options.headers?.[name] || options.headers?.[name.toLowerCase()] || '' },
      nextUrl: { origin: 'http://127.0.0.1:3963' },
    }).then((response) => {
      workerResponse = response;
      events.push('worker-responded');
      return response;
    });
    return workerPromise;
  };

  const queueAddTimers = new TimerTracker({ autoFire: true });
  const genericStore = { getAll: async () => [], add: async () => ({}), remove: async () => true };
  const queueAddPost = makeQueueAddPost({
    enqueueJob,
    createStore: name => (name === 'job_queue' ? store : genericStore),
    fetch: queueAddFetch,
    timers: queueAddTimers,
    queueAddSource,
  });
  const statusGet = makeStatusGet({ getJobStatus, statusSource });
  let addResponded = false;
  const apiStatuses = [];
  const browserFetch = async (url, options = {}) => {
    if (url === '/api/queue/add') {
      events.push('browser-add');
      const payload = JSON.parse(options.body);
      const response = await queueAddPost({
        headers: { get: name => options.headers?.[name] || options.headers?.[name.toLowerCase()] || '' },
        json: async () => payload,
        nextUrl: { origin: 'http://127.0.0.1:3963' },
      });
      addResponded = true;
      events.push('browser-add-responded');
      return response;
    }
    if (url.startsWith('/api/queue/status?id=')) {
      events.push('browser-status');
      const response = await statusGet({
        url: `http://127.0.0.1:3963${url}`,
        nextUrl: { origin: 'http://127.0.0.1:3963' },
      });
      apiStatuses.push(response.payload.status);
      if (response.payload.status === 'processing') setImmediate(releaseWriter);
      return response;
    }
    throw new Error(`unexpected browser URL: ${url}`);
  };

  const localStorage = makeLocalStorage();
  const uiTimers = new TimerTracker({ autoFire: true });
  const state = { queueStatusHistory: [] };
  const submitViaQueue = makeSubmitViaQueue(browserFetch, localStorage, uiTimers, state, pageSource);
  // ติด rejection handler ทันที: mutation บางแบบล้มก่อน harness รอ add response หลาย event-loop turns
  const submitOutcome = submitViaQueue(clone(ORIGINAL_PAYLOAD)).then(
    value => ({ ok: true, value }),
    error => ({ ok: false, error }),
  );
  const unwrapSubmit = async () => {
    const outcome = await submitOutcome;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };

  try {
    const returnedBeforeWorker = await waitFor(() => addResponded, 50);
    if (!returnedBeforeWorker) {
      releaseWriter();
      await submitOutcome;
      throw new Error('queue/add ต้องตอบหลังเพดาน 3 วินาทีโดยไม่รอ worker ทำข่าวเสร็จ');
    }
    const submitted = await unwrapSubmit();
    releaseWriter();
    if (workerPromise) await workerPromise;

    assert.ok(processResponse, 'process route ต้องคืน response จริง');
    const finalPayload = processResponse.payload;
    assert.equal(finalPayload.archiveSaved, serverArchiveResult,
      'response/job ต้องรักษาผลบันทึก server จริงเพื่อให้ UI ตัดสินใจ fallback');
    assert.deepEqual(processRuntime.getServerArchiveCalls(), [[{
      newsData: finalPayload.newsData,
      breakdownData: finalPayload.breakdownData,
      sourceType: 'plain_text',
      sourceUrl: '',
      workflowId: ORIGINAL_PAYLOAD.workflowId,
      archivedBy: ORIGINAL_PAYLOAD.userId,
      coverImage: null,
    }]], 'process route ต้องเรียก server archive จริงหนึ่งครั้งด้วยผลข่าวก้อนเดิมก่อนรายงานสำเร็จ');
    const jobId = forwardedPayload?._queueJobId;
    const job = jobId ? await store.findById(jobId) : null;
    assert.ok(job, 'งานคิวต้องยังอ่านได้');
    assert.equal(workerResponse?.status, 200, 'worker ต้องจบ HTTP 200 หลัง route self-report');
    assert.equal(workerResponse?.payload?.success, true);
    assert.equal(workerResponse?.payload?.processed, 1);
    assert.equal(statusUpdates.filter(call => call[1] === 'completed').length, 2,
      'route และ worker ต้องพยายาม complete โดย attempt fence กลืนตัวซ้ำอย่างปลอดภัย');
    assert.equal(job.status, 'completed');
    assert.deepEqual(job.result, finalPayload);
    assert.deepEqual(job.payload, ORIGINAL_PAYLOAD);
    assert.deepEqual(forwardedPayload, {
      ...ORIGINAL_PAYLOAD, _queueJobId: jobId, _queueAttemptId: job.attemptId,
    });
    assert.deepEqual(submitted.result, finalPayload);
    assert.ok(apiStatuses.includes('processing'), 'UI ต้องเห็น processing ก่อน completed');
    assert.ok(apiStatuses.includes('completed'), 'UI ต้องเห็น completed พร้อมผล');
    assert.ok(state.queueStatusHistory.includes('pending'));
    assert.ok(state.queueStatusHistory.includes('processing'));
    assert.ok(state.queueStatusHistory.includes('completed'));
    assert.ok(events.indexOf('browser-add-responded') < events.indexOf('process-completed'));

    applyNormalQueueUiState(submitted.result, state, pageSource);
    assert.equal(state.workflowId, ORIGINAL_PAYLOAD.workflowId);
    assert.equal(state.sourceType, 'plain_text');
    assert.equal(state.newsData.newsBody, RAW);
    assert.strictEqual(state.analysisResult, submitted.result.analysisResult);
    assert.equal(state.analysisResult.versions.length, 2);

    assert.ok(localStorage.getItem('vf_last_job'), 'ก่อน archive ยืนยัน UI ต้องเก็บ recovery token');
    let clientArchiveCalls = 0;
    const finalizeQueueArchive = makeFinalizeQueueArchive({
      autoSaveToArchive: async () => { clientArchiveCalls += 1; return true; },
      setArchiveSavedFlag: value => { state.archiveSaved = value; },
      localStorage,
      setError: value => { state.error = value; },
      pageSource,
    });
    assert.equal(await finalizeQueueArchive(
      finalPayload.archiveSaved, finalPayload.newsData, finalPayload.breakdownData, null,
      { sourceType: 'plain_text', workflowId: finalPayload.workflowId }, submitted.recoveryToken,
    ), true);
    assert.equal(clientArchiveCalls, serverArchiveResult ? 0 : 1,
      serverArchiveResult
        ? 'server archive สำเร็จแล้วต้องไม่บันทึก client ซ้ำ'
        : 'server archive ล้มต้องเรียก client fallback หนึ่งครั้ง');
    assert.equal(localStorage.getItem('vf_last_job'), null, 'archive สำเร็จต้องล้าง token ของงานเดิม');
    assert.equal(workerTimers.active.size, 0, 'worker ต้อง clear deadline timer ทุกเส้นทาง');
    assert.equal(queueAddTimers.active.size, 0, 'timer 3 วินาทีของ queue/add ต้องยิงและจบ');
    assert.equal(uiTimers.active.size, 0, 'poll timers ที่ใช้แล้วต้องไม่ค้าง');
    assert.equal((await getNextPendingJobs(1)).length, 0, 'งาน completed ห้ามถูก claim ซ้ำ');
    await assert.rejects(
      actualUpdateJobStatus(jobId, 'failed', { error: 'stale writer' }, { expectedAttemptId: 'attempt-old' }),
      error => error?.errorType === 'STALE_QUEUE_ATTEMPT',
    );
    return { job, finalPayload, forwardedPayload, state };
  } finally {
    releaseWriter();
    if (workerPromise) await workerPromise.catch(() => {});
  }
}

async function assertProcessRejectsTamperedQueueContext(processSource = production.process) {
  const scenarios = [
    ['input', body => ({ ...body, input: `${body.input} ปลอม` })],
    ['images', body => ({ ...body, images: ['data:image/png;base64,AAAA'] })],
    ['contentLength', body => ({ ...body, contentLength: 'short' })],
    ['preset', body => ({ ...body, preset: 'tampered-preset' })],
    ['userId', body => ({ ...body, userId: 'tampered-user' })],
    ['deskMeta', body => ({ ...body, deskMeta: { desk: 'other' } })],
    ['workflowId', body => ({ ...body, workflowId: 'tampered-workflow' })],
    ['attemptId', body => ({ ...body, _queueAttemptId: 'attempt-other' })],
    ['jobId', body => ({ ...body, _queueJobId: 'q_context_other' })],
    ['status', body => body, row => ({ ...row, status: 'pending' })],
  ];

  await Promise.all(scenarios.map(async ([label, mutateBody, mutateRow = row => row]) => {
    const rows = new Map();
    const jobId = 'q_context_r55';
    const attemptId = 'attempt-context-r55';
    const row = mutateRow({
      id: jobId,
      payload: clone(ORIGINAL_PAYLOAD),
      status: 'processing',
      attemptId,
      createdAt: new Date().toISOString(),
    });
    rows.set(jobId, row);
    const store = makeStore(rows);
    const atomic = makeAtomicQueueRuntime(rows);
    const updateJobStatus = makeUpdateJobStatus(store, atomic);
    const getJobStatus = makeGetJobStatus(store);
    const runtime = makeProcessPost({ queueService: { getJobStatus, updateJobStatus }, processSource });
    const originalBody = {
      ...clone(ORIGINAL_PAYLOAD),
      _queueJobId: jobId,
      _queueAttemptId: attemptId,
    };
    const response = await runtime.post({
      headers: { get: () => '' },
      json: async () => mutateBody(originalBody),
      url: 'http://127.0.0.1:3963/api/auto/process',
    });
    assert.equal(response.status, 500, `${label} ปลอมต้องถูกปฏิเสธ`);
    assert.equal(response.payload.errorType, 'QUEUE_CONTEXT_INVALID', label);
    assert.equal(response.payload.failedStep, 'queue_context', label);
    assert.equal(runtime.getWriterCalls(), 0, `${label} ไม่ตรงต้องหยุดก่อนเรียก writer/AI`);
    assert.equal(runtime.getServerArchiveCalls().length, 0, `${label} ไม่ตรงต้องไม่แตะคลังข่าว`);
  }));
}

async function assertSuccessfulNewsSurvivesQueueStatusFailure(processSource = production.process) {
  const jobId = 'q_success_persist_r83';
  const attemptId = 'attempt-success-persist-r83';
  let completedAttempts = 0;
  let failedAttempts = 0;
  const queueService = {
    async getJobStatus(id) {
      assert.equal(id, jobId);
      return {
        id: jobId,
        payload: clone(ORIGINAL_PAYLOAD),
        status: 'processing',
        attemptId,
      };
    },
    async updateJobStatus(id, status, _extra, options) {
      assert.equal(id, jobId);
      assert.equal(options?.expectedAttemptId, attemptId);
      if (status === 'completed') {
        completedAttempts += 1;
        const error = new Error('จำลองฐานคิวเขียน completed ไม่สำเร็จ');
        error.errorType = 'QUEUE_STATUS_PERSIST_FAILED';
        throw error;
      }
      if (status === 'failed') failedAttempts += 1;
      return true;
    },
  };
  const runtime = makeProcessPost({ queueService, processSource });
  const response = await runtime.post({
    headers: { get: () => '' },
    json: async () => ({
      ...clone(ORIGINAL_PAYLOAD),
      _queueJobId: jobId,
      _queueAttemptId: attemptId,
    }),
    url: 'http://127.0.0.1:3963/api/auto/process',
  });
  assert.equal(response.status, 200, 'ข่าวที่เขียนเสร็จต้องยังตอบ 200');
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.queueStatusPersisted, false,
    'ต้องบอก worker ว่า route self-report กลับคิวไม่สำเร็จ');
  assert.equal(runtime.getWriterCalls(), 1, 'ต้องจ่ายงานเขียนเพียงรอบเดียว');
  assert.equal(completedAttempts, 1, 'route ต้องพยายาม self-report completed หนึ่งครั้ง');
  assert.equal(failedAttempts, 0, 'ห้ามตีข่าวที่สร้างเสร็จแล้วเป็น failed');
}

async function assertArchiveRecoverySemantics(pageSource = production.page) {
  assertPageFinalizationWiring(pageSource);
  const token = { jobId: 'q_archive_r55', at: 55 };
  const makeCase = ({ currentToken = token, clientSaved }) => {
    const storage = makeLocalStorage();
    storage.setItem('vf_last_job', JSON.stringify(currentToken));
    const state = { errors: [], flags: [], clientCalls: [] };
    const finalize = makeFinalizeQueueArchive({
      autoSaveToArchive: async (...args) => {
        state.clientCalls.push(args);
        return clientSaved;
      },
      setArchiveSavedFlag: value => state.flags.push(value),
      localStorage: storage,
      setError: value => state.errors.push(value),
      pageSource,
    });
    return { storage, state, finalize };
  };
  const server = makeCase({ clientSaved: false });
  assert.equal(await server.finalize(true, {}, {}, null, {}, token), true);
  assert.equal(server.storage.getItem('vf_last_job'), null);
  assert.equal(server.state.clientCalls.length, 0);
  const newsData = { newsTitle: 'สุนารี', newsBody: RAW };
  const breakdownData = { primaryCategory: 'บุคคล' };
  const coverBase64 = 'data:image/png;base64,cover-r55';
  const metadata = { sourceType: 'plain_text', workflowId: 'owner-workflow-r55' };
  const client = makeCase({ clientSaved: true });
  assert.equal(await client.finalize(
    false,
    newsData,
    breakdownData,
    coverBase64,
    metadata,
    token,
  ), true);
  assert.equal(client.storage.getItem('vf_last_job'), null);
  assert.deepEqual(client.state.clientCalls, [[newsData, breakdownData, coverBase64, metadata]],
    'client fallback ต้องได้รับข่าว/ประเด็น/ปก/metadata ก้อนเดิมครบ');
  const failed = makeCase({ clientSaved: false });
  assert.equal(await failed.finalize(false, {}, {}, null, {}, token), false);
  assert.ok(failed.storage.getItem('vf_last_job'), 'archive สองฝั่งล้มต้องเก็บ recovery token');
  assert.equal(failed.state.errors.length, 1);
  const newerToken = { jobId: 'q_newer_r55', at: 56 };
  const newer = makeCase({ currentToken: newerToken, clientSaved: true });
  assert.equal(await newer.finalize(false, {}, {}, null, {}, token), true);
  assert.deepEqual(JSON.parse(newer.storage.getItem('vf_last_job')), newerToken,
    'งานเก่าห้ามล้าง recovery token ของงานใหม่กว่า');
}

function replaceOnce(source, search, replacement, label) {
  const next = source.replace(search, replacement);
  assert.notEqual(next, source, `สร้าง mutation ไม่สำเร็จ: ${label}`);
  return next;
}

function mutateEnhancedResponseAnalysis(source) {
  const anchor = source.indexOf('        const responsePayload = {', source.indexOf('if (delegateRes.success)'));
  const end = source.indexOf('        return respond(responsePayload);', anchor);
  assert.ok(anchor >= 0 && end > anchor);
  const segment = source.slice(anchor, end);
  const mutated = replaceOnce(segment, /\n\s{10}analysisResult,/, '\n          analysisResult: null,', 'enhanced response analysisResult');
  return source.slice(0, anchor) + mutated + source.slice(end);
}

function mutateEnhancedResponseArchive(source) {
  const anchor = source.indexOf('        const responsePayload = {', source.indexOf('if (delegateRes.success)'));
  const end = source.indexOf('        return respond(responsePayload);', anchor);
  assert.ok(anchor >= 0 && end > anchor);
  const segment = source.slice(anchor, end);
  const mutated = replaceOnce(
    segment,
    /\n\s{10}archiveSaved,/,
    '\n          archiveSaved: true,',
    'enhanced response archiveSaved',
  );
  return source.slice(0, anchor) + mutated + source.slice(end);
}

test('parser อ่านเฉพาะ declaration ที่รันจริง และ page ผูก archive ครบสองทาง', () => {
  const trap = '/* function target() { return "comment"; } */\nfunction target() { throw new Error("real"); }';
  const extracted = extractTopLevelFunction(trap, 'target');
  assert.match(extracted, /throw new Error\("real"\)/);
  assert.doesNotMatch(extracted, /comment/);
  assertPageFinalizationWiring();
});

test('queue ingress แปลง legacy { text } เป็น input ก่อนเก็บและส่ง worker', async () => {
  async function run(queueAddSource = production.queueAdd) {
    let queuedPayload = null;
    const post = makeQueueAddPost({
      enqueueJob: async payload => {
        queuedPayload = clone(payload);
        return { jobId: 'q_text_alias', position: 1, queuesAhead: 0, status: 'pending' };
      },
      createStore: () => ({ getAll: async () => [] }),
      fetch: async () => responseJson({ success: true }),
      timers: new TimerTracker({ autoFire: true }),
      queueAddSource,
    });
    const response = await post({
      headers: { get: () => '' },
      json: async () => ({ text: RAW, images: [], contentLength: 'long', jobType: 'news' }),
      nextUrl: { origin: 'http://127.0.0.1:3963' },
    });
    assert.equal(response.status, 200);
    assert.equal(queuedPayload?.input, RAW,
      'payload ที่บันทึกคิวต้องมี input จริงเพื่อให้ process context เทียบค่าเดียวกัน');
    return queuedPayload;
  }

  const payload = await run();
  assert.equal(payload.text, RAW, 'เก็บ alias เดิมได้ แต่ input ต้องเป็นสัญญาหลัก');

  const mutation = production.queueAdd.replace(
    "    if (!isCoverJob && !payload.input) {\n      payload.input = payload.url || payload.text;\n    }",
    '    void 0;',
  );
  assert.notEqual(mutation, production.queueAdd);
  await assert.rejects(run(mutation));
});

test('Supabase CAS จริง: สอง worker claim ได้คนเดียว และ attempt เปลี่ยนกลาง commit เขียนทับไม่ได้', async () => {
  await assertAtomicClaimContract();
  await assertAttemptCommitFence();
});

test('ข่าวข้อความ: add → CAS claim → worker → process → status → UI → archive ส่งก้อนเดียวครบ', async () => {
  await runContract();
});

test('server archive ล้ม: false ต้องถึง job/UI แล้ว client fallback จึงล้าง recovery token', async () => {
  await runContract({ serverArchiveResult: false });
});

test('process route ตรวจ payload ทุกช่องกับ attempt เจ้าของก่อนเรียก AI', async () => {
  await assertProcessRejectsTamperedQueueContext();
});

test('deadline ระหว่าง writer: process route คืน 504 และปิดคิวเป็น failed ด้วยสาเหตุเดิม', async () => {
  const jobId = 'q_deadline_contract';
  const attemptId = 'attempt_deadline_contract';
  const queueJob = {
    id: jobId,
    status: 'processing',
    attemptId,
    payload: clone(ORIGINAL_PAYLOAD),
  };
  const updates = [];
  const deadlineError = new Error('เวลารวมของระบบข่าวครบกำหนด');
  deadlineError.code = 'PIPELINE_DEADLINE_EXCEEDED';
  deadlineError.errorType = 'PIPELINE_DEADLINE_EXCEEDED';
  deadlineError.failedStep = 'pipeline_deadline';
  deadlineError.deadlineStep = 'write_A1';
  const runtime = makeProcessPost({
    queueService: {
      getJobStatus: async id => (id === jobId ? clone(queueJob) : null),
      updateJobStatus: async (...args) => {
        updates.push(args);
        return { ...queueJob, status: args[1], ...args[2] };
      },
    },
    writerError: deadlineError,
  });
  const response = await runtime.post({
    headers: { get: () => '' },
    json: async () => ({ ...clone(ORIGINAL_PAYLOAD), _queueJobId: jobId, _queueAttemptId: attemptId }),
    url: 'http://127.0.0.1:3963/api/auto/process',
  });
  assert.equal(response.status, 504);
  assert.equal(response.payload.errorType, 'PIPELINE_DEADLINE_EXCEEDED');
  assert.equal(response.payload.failedStep, 'pipeline_deadline');
  assert.equal(response.payload.deadlineStep, 'write_A1');
  assert.equal(response.payload.queueStatusPersisted, true);
  assert.equal(runtime.getWriterCalls(), 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], jobId);
  assert.equal(updates[0][1], 'failed');
  assert.equal(updates[0][2].errorType, 'PIPELINE_DEADLINE_EXCEEDED');
  assert.equal(updates[0][2].failedStep, 'pipeline_deadline');
  assert.deepEqual(updates[0][3], { expectedAttemptId: attemptId });
});

test('hard deadline ยิงระหว่าง await ที่ไม่รับ signal: route ต้องจบ 504 และงานมาช้าห้าม complete ทับ failed', async () => {
  const jobId = 'q_hard_deadline_contract';
  const attemptId = 'attempt_hard_deadline_contract';
  const writerGate = deferred();
  const statuses = [];
  let persistedStatus = 'processing';
  const queueJob = {
    id: jobId,
    status: 'processing',
    attemptId,
    payload: clone(ORIGINAL_PAYLOAD),
  };
  const runtime = makeProcessPost({
    queueService: {
      getJobStatus: async () => clone(queueJob),
      updateJobStatus: async (_id, status, extra, options) => {
        assert.deepEqual(options, status === 'failed'
          ? { expectedAttemptId: attemptId, expectedStatuses: ['processing', 'completed'] }
          : { expectedAttemptId: attemptId });
        statuses.push(status);
        if (persistedStatus !== 'processing') {
          const stale = new Error('attempt is no longer processing');
          stale.errorType = 'STALE_QUEUE_ATTEMPT';
          throw stale;
        }
        persistedStatus = status;
        return { ...queueJob, ...extra, status };
      },
    },
    waitForWriter: writerGate.promise,
  });
  const deadline = createPipelineDeadline({ deadlineAt: Date.now() + 30 });
  const response = await runtime.postWithDeadline({
    headers: { get: () => '' },
    json: async () => ({ ...clone(ORIGINAL_PAYLOAD), _queueJobId: jobId, _queueAttemptId: attemptId }),
    url: 'http://127.0.0.1:3963/api/auto/process',
  }, deadline);
  assert.equal(response.status, 504);
  assert.equal(response.payload.errorType, 'PIPELINE_DEADLINE_EXCEEDED');
  assert.equal(response.payload.queueStatusPersisted, true);
  assert.equal(persistedStatus, 'failed');
  assert.deepEqual(statuses, ['failed']);

  writerGate.resolve();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(persistedStatus, 'failed');
  assert.equal(statuses.includes('completed'), false);
});

test('deadline ชน completed ที่กำลังเขียน: failed ของ attempt เดิมต้องชนะเสมอ', async () => {
  const jobId = 'q_terminal_race_contract';
  const attemptId = 'attempt_terminal_race_contract';
  const completionStarted = deferred();
  const releaseCompletion = deferred();
  const statuses = [];
  let persistedStatus = 'processing';
  const queueJob = {
    id: jobId,
    status: 'processing',
    attemptId,
    payload: clone(ORIGINAL_PAYLOAD),
  };
  const runtime = makeProcessPost({
    queueService: {
      getJobStatus: async () => clone(queueJob),
      updateJobStatus: async (_id, status, extra, options) => {
        statuses.push(status);
        if (status === 'completed') {
          assert.deepEqual(options, { expectedAttemptId: attemptId });
          completionStarted.resolve();
          await releaseCompletion.promise;
          if (persistedStatus !== 'processing') {
            const stale = new Error('deadline already terminalized this attempt');
            stale.errorType = 'STALE_QUEUE_ATTEMPT';
            throw stale;
          }
          persistedStatus = 'completed';
        } else {
          assert.deepEqual(options, {
            expectedAttemptId: attemptId,
            expectedStatuses: ['processing', 'completed'],
          });
          assert.ok(['processing', 'completed'].includes(persistedStatus));
          persistedStatus = 'failed';
        }
        return { ...queueJob, ...extra, status };
      },
    },
    waitForWriter: Promise.resolve(),
  });
  const deadline = createPipelineDeadline({ deadlineAt: Date.now() + 250 });
  const responsePromise = runtime.postWithDeadline({
    headers: { get: () => '' },
    json: async () => ({ ...clone(ORIGINAL_PAYLOAD), _queueJobId: jobId, _queueAttemptId: attemptId }),
    url: 'http://127.0.0.1:3963/api/auto/process',
  }, deadline);

  await Promise.race([
    completionStarted.promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('completion ไม่เริ่มภายในเวลา')), 2_000)),
  ]);
  const response = await responsePromise;
  assert.equal(response.status, 504);
  assert.equal(response.payload.queueStatusPersisted, true);
  assert.equal(persistedStatus, 'failed');
  releaseCompletion.resolve();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(persistedStatus, 'failed');
  assert.deepEqual(statuses, ['completed', 'failed']);
});

test('ข่าวสำเร็จแต่ self-report คิวล้ม: ยังคืน 200 และไม่แปลงข่าวเป็น failed', async () => {
  await assertSuccessfulNewsSurvivesQueueStatusFailure();
});

test('archive/recovery: server สำเร็จ, client fallback, ล้มสองฝั่ง และ token งานใหม่', async () => {
  await assertArchiveRecoverySemantics();
});

test('mutations สำคัญทั้งหมดต้องแดง ห้าม contract เขียวหลอก', async (t) => {
  await t.test('CAS pending predicate', async () => {
    const source = replaceOnce(
      production.queue, ".filter('data->>status', 'eq', 'pending')",
      ".filter('data->>status', 'eq', 'processing')", 'pending claim predicate',
    );
    await assert.rejects(assertAtomicClaimContract(source));
  });
  await t.test('CAS attempt predicate survives read-to-commit race', async () => {
    const source = replaceOnce(
      production.queue,
      /\s*\.filter\('data->>attemptId', 'eq', expectedAttemptId\)/,
      '',
      'attempt commit predicate',
    );
    await assert.rejects(assertAttemptCommitFence(source));
  });
  await t.test('hard deadline CAS must override completed of the same attempt', async () => {
    const source = replaceOnce(
      production.queue,
      ".in('data->>status', expectedStatuses)",
      ".filter('data->>status', 'eq', 'processing')",
      'deadline terminal status set',
    );
    await assert.rejects(assertAtomicClaimContract(source));
  });
  await t.test('comment shadow cannot hide broken executable enqueue', async () => {
    const commentedGoodCopy = extractTopLevelFunction(production.queue, 'enqueueJob');
    const shadowed = `/*\n${commentedGoodCopy}\n*/\n${production.queue}`;
    const realNode = topLevelFunctionNode(shadowed, 'enqueueJob');
    const source = `${shadowed.slice(0, realNode.start)}async function enqueueJob() { throw new Error('real enqueue broken'); }${shadowed.slice(realNode.end)}`;
    await assert.rejects(runContract({ queueSource: source }));
  });
  await t.test('worker forwards every payload field', async () => {
    const source = replaceOnce(
      production.worker,
      /body: JSON\.stringify\(\{ \.\.\.job\.payload, _queueJobId: job\.id, _queueAttemptId: job\.attemptId \}\)/,
      'body: JSON.stringify({ input: job.payload.input, _queueJobId: job.id, _queueAttemptId: job.attemptId })',
      'worker full payload',
    );
    await assert.rejects(runContract({ workerSource: source }));
  });
  await t.test('worker forwards attempt ownership', async () => {
    const source = replaceOnce(
      production.worker, '_queueAttemptId: job.attemptId', '_queueAttemptId: null', 'worker attempt',
    );
    await assert.rejects(runContract({ workerSource: source }));
  });
  await t.test('process self-reports completion', async () => {
    const source = replaceOnce(
      production.process, "          await markQueueJob('completed', { result: payload, completedAt });",
      '          // mutation: completion self-report removed', 'process self-report',
    );
    await assert.rejects(runContract({ processSource: source }));
  });
  await t.test('success response must survive queue completion persistence failure', async () => {
    const source = replaceOnce(
      production.process,
      '            return NextResponse.json({ ...payload, queueStatusPersisted: false }, { status });',
      '            throw queuePersistError;',
      'success response queue persistence fallback',
    );
    await assert.rejects(assertSuccessfulNewsSurvivesQueueStatusFailure(source));
  });
  await t.test('status returns final result', async () => {
    const source = replaceOnce(
      production.status, '      result: jobStatus.result,', '      result: null,', 'status result',
    );
    await assert.rejects(runContract({ statusSource: source }));
  });
  await t.test('page runs archive finalization', async () => {
    const source = replaceOnce(
      production.page, 'await finalizeQueueArchive(', 'await (async () => true)(', 'page archive finalization',
    );
    await assert.rejects(runContract({ pageSource: source }));
  });
  await t.test('page trusts the real server archiveSaved result', async () => {
    let source = replaceOnce(
      production.page,
      'queueResult?.archiveSaved === true',
      'true',
      'legacy queue archiveSaved result',
    );
    source = replaceOnce(
      source,
      'data.archiveSaved === true',
      'true',
      'universal queue archiveSaved result',
    );
    await assert.rejects(runContract({ pageSource: source }));
  });
  await t.test('client archive fallback receives the original result payload', async () => {
    const source = replaceOnce(
      production.page,
      'await autoSaveToArchive(newsDataArg, breakdownDataArg, coverBase64Arg, metadataOverride)',
      'await autoSaveToArchive(null, null, null, {})',
      'client archive fallback payload',
    );
    await assert.rejects(assertArchiveRecoverySemantics(source));
  });
  await t.test('archive call sites forward news data, breakdown, cover and metadata', async () => {
    const source = replaceOnce(
      production.page,
      '        data.data.newsData,',
      '        null,',
      'archive call-site newsData',
    );
    await assert.rejects(runContract({ pageSource: source }));
  });
  await t.test('page forwards the owned recovery token into finalization', async () => {
    const source = replaceOnce(
      production.page,
      /(\n\s*)recoveryToken,(\s*\n\s*\);)/,
      '$1null,$2',
      'page recovery token argument',
    );
    await assert.rejects(runContract({ pageSource: source }));
  });
  await t.test('queue add returns before worker completion', async () => {
    const source = replaceOnce(
      production.queueAdd,
      /await Promise\.race\(\[\s*workerPromise,\s*new Promise\(r => setTimeout\(r, 3000\)\)\s*\]\);/,
      'await workerPromise;', 'queue add non-blocking race',
    );
    await assert.rejects(runContract({ queueAddSource: source }));
  });
  await t.test('worker clears deadline timer', async () => {
    const source = replaceOnce(
      production.worker, '          clearTimeout(timeout);',
      '          // mutation: worker timer leaked', 'worker clearTimeout',
    );
    await assert.rejects(runContract({ workerSource: source }));
  });
  await t.test('worker absorbs stale second completion', async () => {
    const source = replaceOnce(
      production.worker,
      /logger\.info\(`\[Queue Worker\] ⏭️ Job \$\{job\.id\.slice\(0, 8\)\}[^;]+;\s*return null;/,
      'throw statusError;', 'worker stale completion catch',
    );
    await assert.rejects(runContract({ workerSource: source }));
  });
  await t.test('process response keeps analysis result', async () => {
    const source = mutateEnhancedResponseAnalysis(production.process);
    await assert.rejects(runContract({ processSource: source }));
  });
  await t.test('process reports archive success only after calling the server archive', async () => {
    const source = replaceOnce(
      production.process,
      'archiveSaved = await saveToArchiveServerSide({',
      'archiveSaved = await (async () => true)({',
      'server archive call',
    );
    await assert.rejects(runContract({ processSource: source }));
  });
  await t.test('process preserves server archive false so UI can run fallback', async () => {
    const source = mutateEnhancedResponseArchive(production.process);
    await assert.rejects(runContract({ processSource: source, serverArchiveResult: false }));
  });
  await t.test('process validates every queued context field', async () => {
    const source = replaceOnce(
      production.process, /\s*\|\| String\(queuedInput\) !== input/,
      '', 'process input context gate',
    );
    await assert.rejects(assertProcessRejectsTamperedQueueContext(source));
  });
});
