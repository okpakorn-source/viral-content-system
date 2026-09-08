import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createPipeline } from '../src/lib/routine/pipeline.mjs';
import { detectInputType } from '../src/lib/input-engine/detector.js';
import {
  createPipelineDeadline,
  getActivePipelineDeadline,
  isPipelineDeadlineError,
  PipelineDeadlineError,
  runWithPipelineDeadline,
} from '../src/lib/utils/pipelineDeadline.js';

const TEXT = 'ข่าวต้นฉบับบรรทัดแรกเพื่อทดสอบระบบ\n\nบรรทัดที่สองคงข้อความและย่อหน้าตามเดิม';
const RESULT = { success: true, data: { analysisResult: { versions: [{ content: 'news' }] } } };

// The original router's only import reads provider env keys. Stub that pure lookup,
// retaining its actual route selection without importing any service or database.
const routerSource = await readFile(new URL('../src/lib/input-engine/router.js', import.meta.url), 'utf8');
const routerForTest = routerSource.replace(
  "import { readEnvKey } from '@/lib/providers/baseProvider';",
  'const readEnvKey = () => null;',
);
assert.notEqual(routerForTest, routerSource, 'Original router import changed; update the explicit test seam.');
const { routePipeline } = await import(`data:text/javascript;base64,${Buffer.from(routerForTest).toString('base64')}`);

function setup({ env = {}, execution = {}, dependencies = {} } = {}) {
  const calls = [];
  let deadline;
  const pipeline = createPipeline({
    detectInputType(input, images) {
      calls.push(['detect', input, images]);
      return detectInputType(input, images);
    },
    routePipeline,
    createPipelineDeadline(options) {
      calls.push(['deadline', options]);
      deadline = createPipelineDeadline({ ...options, now: () => 1234 });
      return deadline;
    },
    runWithPipelineDeadline,
    isPipelineDeadlineError,
    now: () => 1234,
    env,
    async loadExecutionDependencies(delegate) {
      calls.push(['load', delegate]);
      return {
        isSupabaseReady: () => true,
        async ensureWorkflow(...args) { calls.push(['workflow', ...args]); },
        async processAutoFlowText(args) {
          calls.push(['text', args]);
          assert.equal(getActivePipelineDeadline(), deadline);
          return RESULT;
        },
        async processAutoFlow(args) { calls.push(['url', args]); return RESULT; },
        ...execution,
      };
    },
    ...dependencies,
  });
  return { pipeline, calls, getDeadline: () => deadline };
}

function fails(type, status) {
  return error => {
    assert.equal(error.errorType, type);
    assert.equal(error.status, status);
    return true;
  };
}

test('text delegates unchanged arguments after durable workflow initialization', async () => {
  const { pipeline, calls, getDeadline } = setup();
  const plan = pipeline.prepare({ input: `  ${TEXT}\n`, contentLength: 'long' }, 'news');
  assert.deepEqual(calls, [['detect', `  ${TEXT}\n`, []]]);
  assert.equal(plan.delegate, 'text');
  assert.equal(await pipeline.execute(plan, 'routine_test_123'), RESULT);
  assert.deepEqual(calls.slice(1), [
    ['deadline', { deadlineAt: 701234 }],
    ['load', 'text'],
    ['workflow', 'routine_test_123', { sourceType: 'plain_text', rawInput: TEXT }],
    ['text', {
      url: null, text: TEXT, sourceType: 'plain_text', contentLength: 'long',
      preset: '', workflowId: 'routine_test_123', user: undefined, deskMeta: null,
    }],
  ]);
  assert.equal(getDeadline().signal.aborted, true, 'Original deadline cleanup aborts remaining child work.');
});

test('enhanced URL delegates exact original arguments without sourceType or text workflow initialization', async () => {
  const { pipeline, calls } = setup({ env: { TEXT_ONLY_MODE: '0' } });
  const input = 'https://example.com/article/123';
  const plan = pipeline.prepare({ input });
  assert.equal(plan.delegate, 'url');
  await pipeline.execute(plan, 'routine_url_123');
  assert.deepEqual(calls.find(call => call[0] === 'url'), ['url', {
    url: input, text: input, contentLength: 'medium', preset: '',
    workflowId: 'routine_url_123', user: undefined, deskMeta: null,
  }]);
  assert.equal(calls.some(call => call[0] === 'workflow'), false);
});

test('text-only gate defaults closed for URLs and short malformed URL markers in queue mode', () => {
  for (const env of [{}, { TEXT_ONLY_MODE: '1' }]) {
    const { pipeline, calls } = setup({ env });
    assert.throws(() => pipeline.prepare({ input: 'https://example.com/news' }, 'news'), fails('TEXT_ONLY_MODE', 400));
    assert.throws(() => pipeline.prepare({ input: `${TEXT} http://x` }, 'jobs'), fails('TEXT_ONLY_MODE', 400));
    assert.equal(calls.some(call => call[0] === 'load'), false);
  }
});

test('queue preserves garbled-input ratio and length thresholds', () => {
  const { pipeline } = setup();
  assert.throws(() => pipeline.prepare({ input: '?'.repeat(31) }, 'jobs'), fails('GARBLED_INPUT', 400));
  assert.doesNotThrow(() => pipeline.prepare({ input: '?'.repeat(30) }, 'jobs'));
  assert.doesNotThrow(() => pipeline.prepare({ input: '?'.repeat(12) + 'a'.repeat(28) }, 'jobs'));
  assert.throws(() => pipeline.prepare({ input: '?'.repeat(13) + 'a'.repeat(27) }, 'jobs'), fails('GARBLED_INPUT', 400));
});

test('nondelegated inputs remain queue-only instead of being rerouted to the article service', () => {
  const { pipeline, calls } = setup({ env: { TEXT_ONLY_MODE: '0' } });
  for (const input of [
    'https://youtu.be/example123',
    'https://example.com/one https://example.com/two',
    `https://example.com/news ${TEXT}`,
    'short text',
  ]) {
    assert.throws(() => pipeline.prepare({ input }, 'news'), fails('ROUTINE_UNSUPPORTED_INPUT', 400));
    assert.equal(pipeline.prepare({ input }, 'jobs').delegate, null);
  }
  assert.equal(calls.some(call => call[0] === 'load'), false);
});

test('empty and invalid inputs are rejected before loading news dependencies', () => {
  const { pipeline, calls } = setup();
  assert.throws(() => pipeline.prepare({ input: ' \n' }), fails('EMPTY_INPUT', 400));
  assert.throws(() => pipeline.prepare({ input: 2 }), fails('INVALID_REQUEST_FIELDS', 400));
  assert.throws(() => pipeline.prepare({ input: TEXT, contentLength: 'large' }), fails('INVALID_REQUEST_FIELDS', 400));
  assert.equal(calls.some(call => call[0] === 'load'), false);
});

test('missing workflow persistence prevents AI service calls', async () => {
  const { pipeline, calls } = setup({ execution: { isSupabaseReady: () => false } });
  await assert.rejects(pipeline.execute(pipeline.prepare({ input: TEXT }), 'routine_db_123'), fails('WORKFLOW_PERSISTENCE_UNAVAILABLE', 503));
  assert.equal(calls.some(call => call[0] === 'workflow' || call[0] === 'text'), false);
});

test('failed workflow initialization and context conflicts prevent AI service calls', async () => {
  await Promise.all([false, true].map(async conflict => {
    const { pipeline, calls } = setup({ execution: {
      async ensureWorkflow() {
        throw Object.assign(new Error('private database details'), conflict ? { code: 'WORKFLOW_CONTEXT_CONFLICT' } : {});
      },
    } });
    await assert.rejects(pipeline.execute(pipeline.prepare({ input: TEXT }), 'routine_init_123'),
      fails(conflict ? 'WORKFLOW_CONTEXT_CONFLICT' : 'WORKFLOW_INIT_FAILED', conflict ? 409 : 503));
    assert.equal(calls.some(call => call[0] === 'text'), false);
  }));
});

test('deadline expiring while workflow initializes prevents the subsequent AI call', async () => {
  let clock = 100;
  const { pipeline, calls } = setup({
    dependencies: {
      now: () => clock,
      createPipelineDeadline: options => createPipelineDeadline({ ...options, now: () => clock }),
    },
    execution: { async ensureWorkflow() { clock += 700_001; } },
  });
  await assert.rejects(pipeline.execute(pipeline.prepare({ input: TEXT }), 'routine_deadline_123'), fails('PIPELINE_DEADLINE_EXCEEDED', 504));
  assert.equal(calls.some(call => call[0] === 'text'), false);
});

test('original hard deadline bounds a stalled service and retains a safe error', async () => {
  let expire;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { pipeline } = setup({
    dependencies: {
      createPipelineDeadline: options => createPipelineDeadline({
        ...options, now: () => 1234,
        setTimer: callback => { expire = callback; return { unref() {} }; },
        clearTimer() {},
      }),
    },
    execution: { processAutoFlowText() { entered(); return new Promise(() => {}); } },
  });
  const pending = pipeline.execute(pipeline.prepare({ input: TEXT }), 'routine_stall_123');
  await started;
  expire();
  await assert.rejects(pending, fails('PIPELINE_DEADLINE_EXCEEDED', 504));
});

test('upstream failures sanitize messages and only retain valid error types', async () => {
  await Promise.all([true, false].flatMap(returned =>
    ['NEWS_QUALITY_FAILED', 'secret-token?'].map(async errorType => {
      const failure = { success: false, errorType, error: 'private upstream content' };
      const { pipeline } = setup({ execution: {
        async processAutoFlowText() {
          if (returned) return failure;
          throw Object.assign(new Error('private upstream content'), failure);
        },
      } });
      await assert.rejects(pipeline.execute(pipeline.prepare({ input: TEXT }), 'routine_fail_123'), error => {
        assert.equal(error.status, 502);
        assert.equal(error.errorType, errorType === 'NEWS_QUALITY_FAILED' ? errorType : 'ROUTINE_PIPELINE_FAILED');
        assert.equal(error.message.includes('private'), false);
        return true;
      });
    }),
  ));
});

test('deadline errors from services retain timeout classification', async () => {
  const { pipeline } = setup({ execution: {
    async processAutoFlowText() { throw new PipelineDeadlineError('writer', 'private step details'); },
  } });
  await assert.rejects(pipeline.execute(pipeline.prepare({ input: TEXT }), 'routine_expired_123'), fails('PIPELINE_DEADLINE_EXCEEDED', 504));
});

test('plans not produced by this adapter cannot load a service', async () => {
  const { pipeline, calls } = setup();
  await assert.rejects(pipeline.execute({ delegate: 'url' }, 'routine_forged_123'), fails('ROUTINE_UNSUPPORTED_INPUT', 400));
  assert.deepEqual(calls, []);
});
