// Production-coupled tests for raw-news workflow initialization.
// In-memory only: no AI, HTTP, Supabase, server, or external writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(TESTS, '..');
const workflowPath = join(ROOT, 'src', 'lib', 'workflow', 'workflowEngine.js');
const routePath = join(ROOT, 'src', 'app', 'api', 'auto', 'process', 'route.js');
const workflowSource = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const routeSource = readFileSync(routePath, 'utf8').replace(/\r\n/g, '\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function makeEnsureWorkflow(prisma, source = workflowSource) {
  const start = source.indexOf('const _workflowInitLocks = new Map();');
  const end = source.indexOf('// โหลด workflow', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบบล็อก workflow init จริง');
  const block = source.slice(start, end).replace(/^export /gm, '');
  return new Function('prisma', `${block}; return ensureWorkflow;`)(prisma);
}

function makeWorkflowModel(initialRows = []) {
  const rows = new Map(initialRows.map(row => [row.id, { ...row }]));
  const calls = { find: 0, create: 0, update: 0 };
  const model = {
    async findUnique({ where }) {
      calls.find += 1;
      return rows.has(where.id) ? { ...rows.get(where.id) } : null;
    },
    async create({ data }) {
      calls.create += 1;
      const id = data.id || `generated-${calls.create}`;
      if (rows.has(id)) {
        const error = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        throw error;
      }
      const row = { ...data, id };
      rows.set(id, row);
      return { ...row };
    },
    async update({ where, data }) {
      calls.update += 1;
      const current = rows.get(where.id);
      if (!current) return null;
      const row = { ...current, ...data };
      rows.set(where.id, row);
      return { ...row };
    },
  };
  return { prisma: { workflowRun: model }, rows, calls, model };
}

function assertRouteWorkflowInit(source = routeSource) {
  assert.match(source, /import \{ randomUUID \} from 'crypto';/);
  assert.match(source, /import \{ ensureWorkflow \} from '@\/lib\/workflow\/workflowEngine';/);
  assert.match(source, /import \{ isSupabaseReady \} from '@\/lib\/supabase';/);
  assert.match(
    source,
    /const _wfId = workflowId\s*\|\| \(isFromQueue \? `unify_\$\{_queueJobId\}` : `unify_\$\{randomUUID\(\)\}`\);/,
  );

  const textBranch = source.indexOf('      if (isTextDelegate) {');
  const urlBranch = source.indexOf('      } else {', textBranch);
  const textBlock = source.slice(textBranch, urlBranch);
  const ensureIndex = textBlock.indexOf('await ensureWorkflow(_wfId, {');
  const delegateIndex = textBlock.indexOf('delegateRes = await processAutoFlowText({');
  assert.ok(textBranch >= 0 && urlBranch > textBranch, 'ต้องพบ text/url delegate branches');
  assert.ok(textBlock.indexOf('if (!isSupabaseReady())') >= 0, 'ข่าวข้อความต้อง fail-closed เมื่อฐานถาวรไม่พร้อม');
  assert.ok(ensureIndex >= 0 && delegateIndex > ensureIndex, 'ต้อง ensure workflow ก่อนเรียก text AI pipeline');
  assert.match(textBlock, /sourceType: 'plain_text',\s*rawInput: textDelegateInput,/);
  assert.match(textBlock, /errorType: 'WORKFLOW_PERSISTENCE_UNAVAILABLE'/);
  assert.match(textBlock, /errorType: contextConflict \? 'WORKFLOW_CONTEXT_CONFLICT' : 'WORKFLOW_INIT_FAILED'/);
  assert.match(textBlock, /failedStep: 'workflow_init'/);

  const urlBlockEnd = source.indexOf('\n      }\n\n      if (delegateRes.success)', urlBranch);
  const urlBlock = source.slice(urlBranch, urlBlockEnd);
  assert.doesNotMatch(urlBlock, /ensureWorkflow|isSupabaseReady/);
}

function makeRouteRespond(source, { isFromQueue, markQueueJob }) {
  const start = source.indexOf('    const respond = async (payload, status = 200) => {');
  const end = source.indexOf('    // งานคิวเดิมต้องใช้ workflow เดิมทุก attempt', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบบล็อก respond จริง');
  const declaration = source.slice(start, end);
  const NextResponse = {
    json(payload, { status }) {
      return { payload, status };
    },
  };
  return new Function(
    'NextResponse',
    'isFromQueue',
    'markQueueJob',
    `${declaration}; return respond;`,
  )(NextResponse, isFromQueue, markQueueJob);
}

function makeTextDelegateRunner(source = routeSource) {
  const branchStart = source.indexOf('      if (isTextDelegate) {');
  const bodyStart = source.indexOf('{', branchStart) + 1;
  const branchEnd = source.indexOf('      } else {', bodyStart);
  assert.ok(branchStart >= 0 && bodyStart > branchStart && branchEnd > bodyStart,
    'ต้องพบบล็อก text delegate จริง');
  const body = source.slice(bodyStart, branchEnd);
  return new AsyncFunction(
    'detection', 'input', 'isSupabaseReady', 'respond', 'ensureWorkflow', '_wfId',
    'addLog', 'rlog', 'processAutoFlowText', 'contentLength', 'preset', '_delegateUser', 'body',
    'getActivePipelineDeadline',
    `let delegateRes;${body}\nreturn delegateRes;`,
  );
}

async function assertExecutableTextWorkflowInit(source = routeSource) {
  const runTextBranch = makeTextDelegateRunner(source);
  const base = {
    detection: { textContent: 'ข่าวดิบเต็ม' },
    input: 'ข่าวสำรอง',
    _wfId: 'unify_job-1',
    addLog() {},
    rlog: { error() {} },
    contentLength: 'medium',
    preset: '',
    _delegateUser: undefined,
    body: { deskMeta: null },
  };

  const unavailableEvents = [];
  const unavailableMarks = [];
  const unavailableRespond = makeRouteRespond(source, {
    isFromQueue: true,
    markQueueJob: async (...args) => { unavailableMarks.push(args); },
  });
  const unavailable = await runTextBranch(
    base.detection, base.input,
    () => false,
    unavailableRespond,
    async () => { unavailableEvents.push('ensure'); },
    base._wfId, base.addLog, base.rlog,
    async () => { unavailableEvents.push('ai'); },
    base.contentLength, base.preset, base._delegateUser, base.body, () => null,
  );
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.payload.failedStep, 'workflow_init');
  assert.deepEqual(unavailableEvents, [], 'ฐานถาวรไม่พร้อมต้องไม่ ensure และไม่เรียก AI');
  assert.equal(unavailableMarks.length, 1);
  assert.equal(unavailableMarks[0][0], 'failed');
  assert.equal(unavailableMarks[0][1].failedStep, 'workflow_init');

  const failedEvents = [];
  const failedMarks = [];
  const failedRespond = makeRouteRespond(source, {
    isFromQueue: true,
    markQueueJob: async (...args) => { failedMarks.push(args); },
  });
  const failed = await runTextBranch(
    base.detection, base.input,
    () => true,
    failedRespond,
    async () => {
      failedEvents.push('ensure');
      throw new Error('database unavailable');
    },
    base._wfId, base.addLog, base.rlog,
    async () => { failedEvents.push('ai'); },
    base.contentLength, base.preset, base._delegateUser, base.body, () => null,
  );
  assert.equal(failed.status, 503);
  assert.deepEqual(failedEvents, ['ensure'], 'ensure ล้มต้องไม่เรียก AI');
  assert.equal(failedMarks.length, 1);
  assert.equal(failedMarks[0][0], 'failed');
  assert.equal(failedMarks[0][1].errorType, 'WORKFLOW_INIT_FAILED');

  const successEvents = [];
  const directRespond = makeRouteRespond(source, {
    isFromQueue: false,
    markQueueJob: async () => { throw new Error('direct request ห้ามแตะคิว'); },
  });
  const delegated = await runTextBranch(
    base.detection, base.input,
    () => true,
    directRespond,
    async (id, context) => {
      successEvents.push('ensure');
      assert.equal(id, base._wfId);
      assert.deepEqual(context, { sourceType: 'plain_text', rawInput: 'ข่าวดิบเต็ม' });
    },
    base._wfId, base.addLog, base.rlog,
    async (payload) => {
      successEvents.push('ai');
      assert.equal(payload.workflowId, base._wfId);
      assert.equal(payload.text, 'ข่าวดิบเต็ม');
      return { success: true };
    },
    base.contentLength, base.preset, base._delegateUser, base.body, () => null,
  );
  assert.deepEqual(successEvents, ['ensure', 'ai']);
  assert.deepEqual(delegated, { success: true });
}

test('workflow init: สร้าง exact ID พร้อม raw/source ก่อน stage update', async () => {
  const fake = makeWorkflowModel();
  const ensureWorkflow = makeEnsureWorkflow(fake.prisma);
  const row = await ensureWorkflow('unify_job-1', {
    sourceType: 'text',
    rawInput: 'ข่าวดิบเต็ม',
  });
  assert.deepEqual(row, {
    id: 'unify_job-1',
    currentStep: 'input',
    sourceType: 'plain_text',
    rawInput: 'ข่าวดิบเต็ม',
  });
  assert.equal(fake.calls.create, 1);
  assert.equal(fake.rows.size, 1);
});

test('workflow init: ID เดิมข่าวเดิมต้อง reuse ไม่ reset และเติมเฉพาะช่องว่าง', async () => {
  const existing = {
    id: 'unify-existing', currentStep: 'breakdown', sourceType: 'plain_text',
    rawInput: 'ข่าวเดิม', breakdownData: '{"kept":true}',
  };
  const fake = makeWorkflowModel([existing]);
  const ensureWorkflow = makeEnsureWorkflow(fake.prisma);
  const reused = await ensureWorkflow('unify-existing', {
    sourceType: 'text', rawInput: 'ข่าวเดิม',
  });
  assert.equal(fake.calls.create, 0);
  assert.equal(fake.calls.update, 0);
  assert.equal(reused.currentStep, 'breakdown');
  assert.equal(reused.breakdownData, '{"kept":true}');

  fake.rows.set('unify-empty', {
    id: 'unify-empty', currentStep: 'input', sourceType: null, rawInput: null,
  });
  const completed = await ensureWorkflow('unify-empty', {
    sourceType: 'plain_text', rawInput: 'เติมครั้งเดียว',
  });
  assert.equal(completed.currentStep, 'input');
  assert.equal(completed.sourceType, 'plain_text');
  assert.equal(completed.rawInput, 'เติมครั้งเดียว');
  assert.equal(fake.calls.update, 1);
});

test('workflow init: ID เดิมแต่คนละข่าวหรือคนละ source ต้องหยุด', async () => {
  const fake = makeWorkflowModel([{
    id: 'unify-conflict', currentStep: 'analyzed', sourceType: 'plain_text', rawInput: 'ข่าว A',
  }]);
  const ensureWorkflow = makeEnsureWorkflow(fake.prisma);
  await assert.rejects(
    ensureWorkflow('unify-conflict', { sourceType: 'plain_text', rawInput: 'ข่าว B' }),
    error => error?.code === 'WORKFLOW_CONTEXT_CONFLICT',
  );
  await assert.rejects(
    ensureWorkflow('unify-conflict', { sourceType: 'url', rawInput: 'ข่าว A' }),
    error => error?.code === 'WORKFLOW_CONTEXT_CONFLICT',
  );
  assert.equal(fake.calls.create, 0);
  assert.equal(fake.calls.update, 0);
});

test('workflow init: concurrent caller และ cross-process duplicate ต้องเหลือผู้ชนะหนึ่งแถว', async () => {
  const fake = makeWorkflowModel();
  const ensureWorkflow = makeEnsureWorkflow(fake.prisma);
  const [a, b, c] = await Promise.all([
    ensureWorkflow('unify-race', { sourceType: 'plain_text', rawInput: 'ข่าวเดียว' }),
    ensureWorkflow('unify-race', { sourceType: 'plain_text', rawInput: 'ข่าวเดียว' }),
    ensureWorkflow('unify-race', { sourceType: 'plain_text', rawInput: 'ข่าวเดียว' }),
  ]);
  assert.equal(fake.calls.create, 1);
  assert.equal(fake.rows.size, 1);
  assert.deepEqual([a.id, b.id, c.id], ['unify-race', 'unify-race', 'unify-race']);

  const cross = makeWorkflowModel();
  let firstFind = true;
  cross.model.findUnique = async ({ where }) => {
    cross.calls.find += 1;
    if (firstFind) {
      firstFind = false;
      return null;
    }
    return cross.rows.has(where.id) ? { ...cross.rows.get(where.id) } : null;
  };
  cross.model.create = async ({ data }) => {
    cross.calls.create += 1;
    cross.rows.set(data.id, { ...data }); // จำลองอีก process ชนะก่อน error กลับมา
    const error = new Error('duplicate key');
    error.code = '23505';
    throw error;
  };
  const raceWinner = await makeEnsureWorkflow(cross.prisma)('unify-cross', {
    sourceType: 'plain_text', rawInput: 'ข่าวเดียว',
  });
  assert.equal(raceWinner.id, 'unify-cross');
  assert.equal(cross.calls.create, 1);
  assert.ok(cross.calls.find >= 2);
});

test('workflow init: create ล้มจริงต้อง reject และ lock ต้องปล่อยให้ลองใหม่ได้', async () => {
  const fake = makeWorkflowModel();
  let fail = true;
  const originalCreate = fake.model.create;
  fake.model.create = async args => {
    if (fail) throw new Error('database unavailable');
    return originalCreate(args);
  };
  const ensureWorkflow = makeEnsureWorkflow(fake.prisma);
  await assert.rejects(
    ensureWorkflow('unify-retry', { sourceType: 'plain_text', rawInput: 'ข่าว' }),
    /database unavailable/,
  );
  fail = false;
  const retried = await ensureWorkflow('unify-retry', {
    sourceType: 'plain_text', rawInput: 'ข่าว',
  });
  assert.equal(retried.id, 'unify-retry');
  assert.equal(fake.rows.size, 1);
});

test('route contract: queue retry ใช้ job ID, direct ใช้ UUID และ ensure อยู่ก่อน AI เฉพาะ text', async () => {
  assertRouteWorkflowInit();
  await assertExecutableTextWorkflowInit();
});

test('mutations: ถอด exact ID/race reread/route ensure หรือย้อนใช้ Date.now ต้องถูกจับ', async () => {
  const noExactId = workflowSource.replace('\n          id,\n          currentStep:', '\n          currentStep:');
  assert.notEqual(noExactId, workflowSource);
  const fakeNoId = makeWorkflowModel();
  const noIdRow = await makeEnsureWorkflow(fakeNoId.prisma, noExactId)('unify-exact', {
    sourceType: 'plain_text', rawInput: 'ข่าว',
  });
  assert.notEqual(noIdRow.id, 'unify-exact');

  const noWinnerRead = workflowSource.replace(
    '      const winner = await prisma.workflowRun.findUnique({ where: { id } });',
    '      const winner = null;',
  );
  assert.notEqual(noWinnerRead, workflowSource);
  const cross = makeWorkflowModel();
  cross.model.create = async ({ data }) => {
    cross.rows.set(data.id, { ...data });
    throw new Error('duplicate key');
  };
  await assert.rejects(
    makeEnsureWorkflow(cross.prisma, noWinnerRead)('unify-cross', {
      sourceType: 'plain_text', rawInput: 'ข่าว',
    }),
    /duplicate key/,
  );

  const routeMutations = [
    routeSource.replace('          await ensureWorkflow(_wfId, {', '          await Promise.resolve({ id: _wfId }); // ensure removed\n          void ({'),
    routeSource.replace('`unify_${randomUUID()}`', "'unify_' + Date.now()"),
    routeSource.replace('`unify_${_queueJobId}`', '`unify_${_queueAttemptId}`'),
  ];
  for (const [index, mutated] of routeMutations.entries()) {
    assert.notEqual(mutated, routeSource, `route mutation ${index + 1} ต้องเกิดจริง`);
    assert.throws(() => assertRouteWorkflowInit(mutated));
  }

  const commentedEnsure = routeSource.replace(
    /          await ensureWorkflow\(_wfId, \{[\s\S]*?          \}\);/,
    '          /* ensureWorkflow disabled */',
  );
  assert.notEqual(commentedEnsure, routeSource, 'mutation ปิด ensure ต้องเกิดจริง');
  await assert.rejects(assertExecutableTextWorkflowInit(commentedEnsure));

  const guardStart = routeSource.indexOf('        if (!isSupabaseReady()) {');
  const guardEnd = routeSource.indexOf('        try {', guardStart);
  assert.ok(guardStart >= 0 && guardEnd > guardStart, 'ต้องพบบล็อก availability guard');
  const commentedGuard = `${routeSource.slice(0, guardStart)}        /* availability guard disabled */\n${routeSource.slice(guardEnd)}`;
  await assert.rejects(assertExecutableTextWorkflowInit(commentedGuard));
});
