/* eslint-disable no-await-in-loop -- Each invalid request must finish its independent assertion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config, readInput, normalizeResult } from '../src/lib/routine/core.mjs';

const body = { input: 'ข่าวต้นฉบับสำหรับการทดสอบซึ่งยาวเกินยี่สิบตัวอักษร', routine: 'morning-news' };
const request = (value, headers = {}) => new Request('http://localhost/api/routine/news', { method: 'POST', headers, body: JSON.stringify(value) });
const rejects = (promise, errorType) => assert.rejects(promise, { status: 400, errorType });

test('request allowlist never admits model, prompt, preset, images, user, or workflow overrides', async () => {
  for (const key of ['model', 'prompt', 'preset', 'images', 'userId', 'workflowId', 'deskMeta', 'detection', '_queueJobId']) {
    await rejects(readInput(request({ ...body, [key]: 'override' }), config({})), 'ROUTINE_INVALID_REQUEST');
  }
});

test('input limits include exact twenty-character boundary and chunked encoded body limits', async () => {
  assert.equal((await readInput(request({ ...body, input: 'ก'.repeat(20) }), config({}))).input.length, 20);
  await rejects(readInput(request({ ...body, input: 'ก'.repeat(19) }), config({})), 'ROUTINE_INVALID_INPUT');
  await rejects(readInput(request({ ...body, input: ' '.repeat(25) }), config({})), 'ROUTINE_INVALID_INPUT');
  await rejects(readInput(request({ ...body, input: 123 }), config({})), 'ROUTINE_INVALID_INPUT');
  await rejects(readInput(request({ ...body, input: 'ก'.repeat(20001) }), config({})), 'ROUTINE_INPUT_TOO_LARGE');
  const oversized = new Request('http://localhost', { method: 'POST', body: ' '.repeat(20000) });
  await rejects(readInput(oversized, config({ ROUTINE_MAX_INPUT_CHARS: '20' })), 'ROUTINE_INPUT_TOO_LARGE');
  await rejects(readInput(request(body, { 'content-length': '999999' }), config({})), 'ROUTINE_INPUT_TOO_LARGE');
});

test('JSON, routine names, and existing contentLength values have explicit errors', async () => {
  await rejects(readInput(new Request('http://localhost', { method: 'POST', body: '{broken' }), config({})), 'ROUTINE_INVALID_JSON');
  for (const value of [null, [], 10, 'text']) await rejects(readInput(request(value), config({})), 'ROUTINE_INVALID_REQUEST');
  for (const routine of ['', 'Upper', 'with_space', 'ไทย', 'a'.repeat(41), undefined]) {
    await rejects(readInput(request({ ...body, routine }), config({})), 'ROUTINE_INVALID_ROUTINE');
  }
  for (const contentLength of ['short', 'medium', 'long']) {
    assert.equal((await readInput(request({ ...body, contentLength }), config({}))).contentLength, contentLength);
  }
  assert.equal((await readInput(request(body), config({}))).contentLength, 'medium');
  for (const contentLength of [null, '', 'xl', 5]) await rejects(readInput(request({ ...body, contentLength }), config({})), 'ROUTINE_INVALID_CONTENT_LENGTH');
});

test('idempotency headers/body agree and are bounded', async () => {
  assert.equal((await readInput(request(body, { 'idempotency-key': 'one' }), config({}))).idempotencyKey, 'one');
  assert.equal((await readInput(request(body, { idempotencyKey: 'two' }), config({}))).idempotencyKey, 'two');
  assert.equal((await readInput(request({ ...body, idempotencyKey: 'same' }, { 'idempotency-key': 'same' }), config({}))).idempotencyKey, 'same');
  await rejects(readInput(request({ ...body, idempotencyKey: 'different' }, { 'idempotency-key': 'same' }), config({})), 'ROUTINE_INVALID_IDEMPOTENCY_KEY');
  for (const idempotencyKey of ['', '   ', 7, 'a'.repeat(201)]) await rejects(readInput(request({ ...body, idempotencyKey }), config({})), 'ROUTINE_INVALID_IDEMPOTENCY_KEY');
});

test('defaults are safe and malformed configuration fails closed including zero admission caps', () => {
  assert.deepEqual(config({}), { dailyUsd: 10, dailyJobs: 10, estimate: 1, maxConcurrent: 2, maxInputChars: 20000 });
  for (const env of [
    { ROUTINE_DAILY_USD: 'NaN' }, { ROUTINE_DAILY_JOBS: '1.5' }, { ROUTINE_DAILY_USD: '-1' },
    { ROUTINE_EST_USD_PER_JOB: '0' }, { ROUTINE_MAX_CONCURRENT: 'Infinity' }, { ROUTINE_MAX_INPUT_CHARS: '19' },
  ]) assert.throws(() => config(env), { status: 503, errorType: 'ROUTINE_CONFIG_INVALID' });
  assert.equal(config({ ROUTINE_DAILY_USD: '0' }).dailyUsd, 0);
  assert.equal(config({ ROUTINE_DAILY_JOBS: '0' }).dailyJobs, 0);
  assert.equal(config({ ROUTINE_MAX_CONCURRENT: '0' }).maxConcurrent, 0);
});

test('response uses original per-version provenance without inventing missing case or model', () => {
  const raw = { success: true, data: { analysisResult: { versions: [{ content: 'ต้นฉบับ\n\nย่อหน้าสอง', usedModel: 'original-writer', promptName: 'original-card', promptSource: 'library', wordCount: 120, paragraphs: 2 }] } } };
  const result = normalizeResult(raw, 'routine_example_00000000-0000-4000-8000-000000000001', 500, 1);
  assert.equal(result.versions[0].content, raw.data.analysisResult.versions[0].content);
  assert.equal(result.versions[0].usedModel, 'original-writer');
  assert.equal(result.versions[0].promptName, 'original-card');
  assert.equal(result.versions[0].promptSource, 'library');
  assert.ok(!Object.hasOwn(result, 'caseId'));
  assert.deepEqual(result.cost, { usd: 1, estimated: true });
  assert.deepEqual(result.pipeline, raw.data); // Public values survive compaction; object identity is not part of JSON.
  assert.throws(() => normalizeResult({ success: true, data: { versions: [] } }, 'workflow', 0, 1), { errorType: 'ROUTINE_RESULT_UNAVAILABLE' });
});
