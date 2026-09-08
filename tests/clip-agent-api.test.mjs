/* eslint-disable no-await-in-loop -- เคสทดสอบใช้ store/env ร่วมกัน จึงต้องอ่านเขียนตามลำดับ */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// ย้าย cwd และปิด Supabase ก่อน import แอป เพื่อให้ทุก store ใช้ข้อมูลชั่วคราวเท่านั้น
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const originalCwd = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), 'clip-agent-api-'));
const envNames = ['SUPABASE_DISABLED', 'CLIP_AGENT_API_KEY', 'CLIP_AGENT_POLL_INTERVAL_MS', 'CLIP_AGENT_WAIT_CAP_SEC'];
const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const storeNames = ['clip-jobs', 'clip-insights', 'clip-transcripts'];
const snapshot = (path) => {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  return { size: stat.size, mtimeMs: stat.mtimeMs, hash: createHash('sha256').update(readFileSync(path)).digest('hex') };
};
const realDataBefore = Object.fromEntries(storeNames.map(name => [name, snapshot(join(repoRoot, 'data', `${name}.json`))]));
process.chdir(tempRoot);
process.env.SUPABASE_DISABLED = '1';
process.env.CLIP_AGENT_API_KEY = 'clip-agent-integration-test-key';
process.env.CLIP_AGENT_POLL_INTERVAL_MS = '10';
delete process.env.CLIP_AGENT_WAIT_CAP_SEC;
mkdirSync(join(tempRoot, 'data'));

after(() => {
  try {
    assert.equal(process.cwd(), tempRoot, 'all application/store operations remain inside the disposable cwd');
    for (const name of storeNames) {
      assert.deepEqual(snapshot(join(repoRoot, 'data', `${name}.json`)), realDataBefore[name], `${name}: real project data was untouched`);
    }
  } finally {
    process.chdir(originalCwd);
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
    const insideTemp = relative(resolve(tmpdir()), resolve(tempRoot));
    assert.ok(insideTemp && !insideTemp.startsWith('..') && !isAbsolute(insideTemp), 'cleanup target is a child of the OS temp directory');
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// แก้เฉพาะ alias/นามสกุลโมดูล ใช้ NextResponse และ persistStore ตัวจริง
const loader = `
  const src = ${JSON.stringify(new URL('../src/', import.meta.url).href)};
  const nextServer = ${JSON.stringify(new URL('../node_modules/next/server.js', import.meta.url).href)};
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') return nextResolve(nextServer, context);
    if (specifier.startsWith('@/')) {
      const path = specifier.slice(2);
      return nextResolve(new URL(/\\.[a-z]+$/i.test(path) ? path : path + '.js', src).href, context);
    }
    try { return await nextResolve(specifier, context); }
    catch (error) {
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z]+$/i.test(specifier)) {
        return nextResolve(specifier + '.js', context);
      }
      throw error;
    }
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const { createStore } = await import(new URL('../src/lib/persistStore.js', import.meta.url));
const { compactResult } = await import(new URL('../src/lib/services/clipAgent/compactResult.js', import.meta.url));
const { POST: submit } = await import(new URL('../src/app/api/clip-agent/submit/route.js', import.meta.url));
const { GET: status } = await import(new URL('../src/app/api/clip-agent/status/route.js', import.meta.url));
const { GET: result } = await import(new URL('../src/app/api/clip-agent/result/route.js', import.meta.url));
const { POST: legacySubmit } = await import(new URL('../src/app/api/clip-transcript/submit/route.js', import.meta.url));
const stores = Object.fromEntries(storeNames.map(name => [name, createStore(name)]));
const jobs = stores['clip-jobs'];
const insights = stores['clip-insights'];
const transcripts = stores['clip-transcripts'];
const key = 'clip-agent-integration-test-key';
const clipUrl = 'https://www.youtube.com/watch?v=clip-agent-test';
const heartbeatId = '__clip_worker_heartbeat__';
const archive = JSON.parse(readFileSync(new URL('./fixtures/clip-topic-v2/archive-3.json', import.meta.url), 'utf8'));
const composed = JSON.parse(readFileSync(new URL('./fixtures/clip-topic-v2/mae-phen-compose.json', import.meta.url), 'utf8'));
const { insight: _legacyInsight, ...composedMetadata } = archive.find(row => row.id === composed.id);
const v2Record = { ...composedMetadata, insight: { topicsV2: composed.doc } };

beforeEach(async () => {
  process.env.SUPABASE_DISABLED = '1';
  process.env.CLIP_AGENT_API_KEY = key;
  process.env.CLIP_AGENT_POLL_INTERVAL_MS = '10';
  delete process.env.CLIP_AGENT_WAIT_CAP_SEC;
  for (const store of Object.values(stores)) await store.removeAll();
});

function request(path, { body, raw, headers = { 'x-clip-agent-key': key }, method = body === undefined && raw === undefined ? 'GET' : 'POST' } = {}) {
  return new Request(`http://localhost${path}`, {
    method, headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(method === 'POST' ? { body: raw === undefined ? JSON.stringify(body) : raw } : {}),
  });
}
const submitRequest = (body = { url: clipUrl }, options = {}) => request('/api/clip-agent/submit', { body, ...options });
const statusRequest = (id, query = '', options = {}) => request(`/api/clip-agent/status?${id === undefined ? '' : `id=${encodeURIComponent(id)}`}${query}`, options);
const resultRequest = (query = '', options = {}) => request(`/api/clip-agent/result?${query}`, options);
async function responseBody(response, expectedStatus = 200) {
  assert.equal(response.status, expectedStatus);
  assert.match(response.headers.get('content-type'), /application\/json/);
  return response.json();
}
const job = (overrides = {}) => ({
  id: 'job-test', url: clipUrl, kind: 'insight', platform: 'youtube', status: 'pending',
  createdAt: '2026-09-08T00:00:00.000Z', ...overrides,
});
const caseRow = (overrides = {}) => ({
  id: 'case-test', url: clipUrl, platform: 'youtube', title: 'ข่าวทดสอบ',
  createdAt: '2026-09-08T00:00:00.000Z', insight: { headline: 'พาดหัวทดสอบ', overview: 'เนื้อทดสอบ' }, ...overrides,
});
async function assertError(response, httpStatus, errorType) {
  const body = await responseBody(response, httpStatus);
  assert.equal(body.ok, false);
  assert.equal(body.errorType, errorType);
  return body;
}
const routes = [
  ['submit', submit, () => submitRequest()],
  ['status', status, () => statusRequest('auth-job')],
  ['result', result, () => resultRequest('id=auth-case')],
];

test('all agent routes fail closed with exact disabled and unauthorized contracts', async () => {
  delete process.env.CLIP_AGENT_API_KEY;
  for (const [name, handler, makeRequest] of routes) {
    assert.deepEqual(await responseBody(await handler(makeRequest()), 503), {
      ok: false, errorType: 'AGENT_API_DISABLED', error: 'ยังไม่ได้ตั้ง CLIP_AGENT_API_KEY',
    }, name);
  }
  process.env.CLIP_AGENT_API_KEY = key;
  for (const headers of [{}, { 'x-clip-agent-key': 'wrong' }, { 'x-clip-agent-key': `${key.slice(0, -1)}X` }, { authorization: 'Bearer wrong' }]) {
    for (const [name, handler, makeRequest] of routes) {
      const original = makeRequest();
      const unauthorized = new Request(original, { headers });
      assert.deepEqual(await responseBody(await handler(unauthorized), 401), { ok: false, errorType: 'UNAUTHORIZED' }, name);
    }
  }
  assert.deepEqual(await jobs.getAll({ authoritative: true }), []);
});

test('each route accepts both API key and Bearer authentication', async () => {
  await jobs.add(job({ id: 'auth-job' }));
  await insights.add(caseRow({ id: 'auth-case' }));
  for (const headers of [{ 'x-clip-agent-key': key }, { authorization: `Bearer ${key}` }]) {
    assert.equal((await responseBody(await submit(submitRequest({ url: `${clipUrl}-${Object.keys(headers)[0]}` }, { headers })), 202)).ok, true);
    assert.equal((await responseBody(await status(statusRequest('auth-job', '', { headers })))).ok, true);
    assert.equal((await responseBody(await result(resultRequest('id=auth-case', { headers })))).ok, true);
  }
});

test('submit separates invalid URLs, unsupported platforms, and malformed request types', async () => {
  for (const url of [undefined, null, 12, '', 'not a url', 'ftp://youtube.com/video', 'https://', 'https://youtube.com:bad/watch']) {
    await assertError(await submit(submitRequest({ url })), 400, 'BAD_URL');
  }
  for (const url of ['https://example.com/video', 'https://youtube.com.example.org/video', 'https://example.org/?next=youtube.com']) {
    await assertError(await submit(submitRequest({ url })), 400, 'UNSUPPORTED_PLATFORM');
  }
  for (const body of [null, [], true, 'text',
    { url: clipUrl, kind: 'hunt' }, { url: clipUrl, kind: 12 }, { url: clipUrl, kind: null },
    { url: clipUrl, force: 'true' }, { url: clipUrl, force: 1 }, { url: clipUrl, user: 42 }]) {
    await assertError(await submit(submitRequest(body)), 400, 'BAD_REQUEST');
  }
  await assertError(await submit(submitRequest(undefined, { raw: '{broken-json' })), 400, 'BAD_REQUEST');
  assert.deepEqual(await jobs.getAll({ authoritative: true }), []);
});

test('submit 202 has the complete response shape and persists defaults in the real store', async () => {
  const body = await responseBody(await submit(submitRequest()), 202);
  assert.match(body.jobId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(body, { ok: true, jobId: body.jobId, status: 'pending', position: 1, platform: 'youtube', dup: false, statusUrl: `/api/clip-agent/status?id=${body.jobId}` });
  const saved = await jobs.findById(body.jobId);
  assert.equal(saved.kind, 'insight');
  assert.equal(saved.tidy, false);
  assert.equal(saved.force, undefined);
  assert.equal(saved.user, 'codex-agent');
  assert.equal(saved.url, clipUrl);
  assert.ok(existsSync(join(tempRoot, 'data', 'clip-jobs.json')));
  const transcript = await responseBody(await submit(submitRequest({ url: 'https://www.tiktok.com/@test/video/123', kind: 'transcript', force: true, user: 'agent-user' })), 202);
  assert.equal(transcript.platform, 'tiktok');
  const savedTranscript = await jobs.findById(transcript.jobId);
  assert.equal(savedTranscript.kind, 'transcript');
  assert.equal(savedTranscript.force, true);
  assert.equal(savedTranscript.user, 'agent-user');
});

test('active jobs deduplicate across force and all retry states without an age window', async () => {
  for (const activeStatus of ['pending', 'processing', 'retry_wait']) {
    await jobs.removeAll();
    await jobs.add(job({ id: `active-${activeStatus}`, status: activeStatus, createdAt: '2020-01-01T00:00:00.000Z' }));
    for (const force of [false, true]) {
      const body = await responseBody(await submit(submitRequest({ url: clipUrl, force })), 202);
      assert.equal(body.jobId, `active-${activeStatus}`);
      assert.equal(body.status, activeStatus);
      assert.equal(body.dup, true);
      assert.deepEqual(Object.keys(body).sort(), ['ok', 'jobId', 'status', 'position', 'platform', 'dup', 'statusUrl'].sort());
      assert.equal((await jobs.getAll({ authoritative: true })).length, 1);
    }
  }
});

test('legacy submit retains entire success, duplicate, BAD_URL and unsupported response bodies', async () => {
  const first = await responseBody(await legacySubmit(submitRequest()));
  assert.deepEqual(first, { success: true, jobId: first.jobId, status: 'pending', position: 1, platform: 'youtube' });
  assert.deepEqual(await responseBody(await legacySubmit(submitRequest())), {
    success: true, jobId: first.jobId, status: 'pending', dup: true, message: 'คลิปนี้อยู่ในคิวแล้ว (กำลังทำ/รอลองใหม่)',
  });
  assert.deepEqual(await responseBody(await legacySubmit(submitRequest({ url: 'bad' })), 400), {
    success: false, error: 'กรุณาวางลิงก์คลิป (http/https)', errorType: 'MISSING_URL',
  });
  assert.deepEqual(await responseBody(await legacySubmit(submitRequest({ url: 'https://example.com/video' })), 400), {
    success: false, error: 'ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)', errorType: 'UNSUPPORTED_URL',
  });
});

test('legacy submit keeps hunt/model separation and permissive tidy/user/kind normalization', async () => {
  const first = await responseBody(await legacySubmit(submitRequest({ url: clipUrl, kind: 'hunt', model: 'gemini-3.7-flash', tidy: 'yes', user: 'ก'.repeat(70) })));
  const saved = await jobs.findById(first.jobId);
  assert.equal(saved.kind, 'hunt');
  assert.equal(saved.model, 'gemini-3.7-flash');
  assert.equal(saved.tidy, true);
  assert.equal(saved.user, 'ก'.repeat(40));
  const second = await responseBody(await legacySubmit(submitRequest({ url: clipUrl, kind: 'hunt', model: 'gemini-3.6-flash' })));
  assert.notEqual(second.jobId, first.jobId);
  const third = await responseBody(await legacySubmit(submitRequest({ url: clipUrl, kind: 'nonsense', model: 'disallowed', user: 123, tidy: 0 })));
  assert.notEqual(third.jobId, first.jobId);
  const normalized = await jobs.findById(third.jobId);
  assert.equal(normalized.kind, 'insight');
  assert.equal(normalized.model, undefined);
  assert.equal(normalized.user, '123');
  assert.equal(normalized.tidy, false);
  const unnamed = await responseBody(await legacySubmit(submitRequest({ url: `${clipUrl}-unnamed`, user: '' })));
  assert.equal((await jobs.findById(unnamed.jobId)).user, 'ไม่ระบุชื่อ');
  const permissive = await responseBody(await legacySubmit(submitRequest({ url: 'https://example.org/?next=youtube.com', force: 'yes' })));
  assert.equal(permissive.platform, 'youtube');
  assert.equal((await jobs.findById(permissive.jobId)).force, true);
});

test('legacy cleanup keeps the >50 threshold and removes oldest terminal rows only', async () => {
  const terminalRows = Array.from({ length: 50 }, (_, index) => job({
    id: `old-${index}`, url: `${clipUrl}-${index}`, status: ['done', 'error', 'cancelled'][index % 3],
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
  await jobs.addMany(terminalRows);
  await responseBody(await legacySubmit(submitRequest({ url: `${clipUrl}-first` })));
  assert.equal((await jobs.getAll({ authoritative: true })).length, 51);
  assert.ok(await jobs.findById('old-0'), '50 existing rows do not trigger cleanup');
  await responseBody(await legacySubmit(submitRequest({ url: `${clipUrl}-second` })));
  assert.equal((await jobs.getAll({ authoritative: true })).length, 51);
  assert.equal(await jobs.findById('old-0'), null, '51 existing rows delete exactly one oldest terminal row');
  assert.ok(await jobs.findById('old-1'));
  await jobs.removeAll();
  await jobs.addMany(Array.from({ length: 52 }, (_, index) => job({ id: `active-${index}`, url: `${clipUrl}-${index}` })));
  await responseBody(await legacySubmit(submitRequest({ url: `${clipUrl}-extra` })));
  assert.equal((await jobs.getAll({ authoritative: true })).length, 53, 'active work is never removed to satisfy a numeric cap');
});

test('status returns JOB_NOT_FOUND for missing IDs, unknown IDs and heartbeat metadata', async () => {
  await jobs.add({ id: heartbeatId, lastSeenAt: new Date().toISOString() });
  for (const id of [undefined, 'missing', heartbeatId]) {
    assert.deepEqual(await responseBody(await status(statusRequest(id)), 404), { ok: false, errorType: 'JOB_NOT_FOUND' });
  }
});

test('status pending position excludes heartbeat/retry/finished rows and exposes stable default fields', async () => {
  await jobs.addMany([
    job({ id: 'ahead', createdAt: '2026-09-07T00:00:00.000Z' }),
    job({ id: 'processing', status: 'processing' }),
    job({ id: 'retry', status: 'retry_wait' }),
    job({ id: 'finished', status: 'done' }),
    job({ id: heartbeatId, status: 'pending', createdAt: '2000-01-01T00:00:00.000Z' }),
    job(),
    job({ id: 'behind', createdAt: '2026-09-09T00:00:00.000Z' }),
  ]);
  const body = await responseBody(await status(statusRequest('job-test')));
  assert.equal(body.position, 3);
  assert.equal(body.status, 'pending');
  assert.equal(body.timedOut, false);
  assert.equal(body.result, null);
  assert.equal(body.error, '');
  assert.equal(body.statusNote, '');
  assert.equal(body.attempts, 0);
  assert.equal(body.nextRetryAt, null);
  assert.equal(body.lastError, '');
  assert.equal(body.startedAt, null);
  assert.equal(body.doneAt, null);
  assert.equal(body.createdAt, '2026-09-08T00:00:00.000Z');
  assert.equal(body.platform, 'youtube');
  assert.equal(body.kind, 'insight');
  assert.equal(body.user, '');
  assert.deepEqual(Object.keys(body).sort(), [
    'ok', 'jobId', 'status', 'position', 'attempts', 'statusNote', 'lastError', 'error',
    'createdAt', 'startedAt', 'doneAt', 'nextRetryAt', 'platform', 'kind', 'user', 'result', 'timedOut',
  ].sort());
});

test('done status returns a compact saved result by default and original data for full=1', async () => {
  await jobs.add(job({ status: 'done', result: v2Record }));
  const compact = await responseBody(await status(statusRequest('job-test')));
  assert.equal(compact.timedOut, false);
  assert.equal(compact.position, 0);
  assert.deepEqual(compact.result, compactResult(v2Record));
  assert.deepEqual((await responseBody(await status(statusRequest('job-test', '&full=1')))).result, v2Record);
  assert.deepEqual(await jobs.findById('job-test'), job({ status: 'done', result: v2Record }), 'read endpoints preserve stored evidence');
});

test('done status understands actual flat worker insight and transcript payloads and keeps full raw', async () => {
  const source = archive[1];
  const workerInsight = { id: source.id, platform: source.platform, ...source.insight, cachedAt: source.createdAt };
  await jobs.add(job({ result: workerInsight, status: 'done', url: source.url }));
  const insightBody = await responseBody(await status(statusRequest('job-test')));
  assert.equal(insightBody.result.caseId, source.id);
  assert.equal(insightBody.result.url, source.url);
  assert.equal(insightBody.result.headline, source.insight.headline);
  assert.equal(insightBody.result.title, source.insight.headline);
  assert.equal(insightBody.result.createdAt, source.createdAt);
  assert.deepEqual(insightBody.result.subStories, source.insight.subStories.map(story => ({ title: story.topic, text: story.rawData })));
  assert.deepEqual((await responseBody(await status(statusRequest('job-test', '&full=1')))).result, workerInsight);
  const workerTranscript = { id: 'transcript-worker', platform: 'youtube', caption: 'คำบรรยายคลิป', rawText: 'ต้นฉบับคำพูด', tidyText: 'คำพูดเรียบเรียง', classify: { type: 'interview' } };
  await jobs.update('job-test', { result: workerTranscript, kind: 'transcript' });
  assert.deepEqual((await responseBody(await status(statusRequest('job-test')))).result, {
    caseId: 'transcript-worker', url: source.url, platform: 'youtube', title: 'คำบรรยายคลิป', text: 'ต้นฉบับคำพูด', createdAt: null,
  });
  assert.deepEqual((await responseBody(await status(statusRequest('job-test', '&full=1')))).result, workerTranscript);
});

test('long poll observes an external file write after the real persistStore cache was primed', async () => {
  const pending = job();
  await jobs.add(pending);
  assert.equal((await jobs.getAll())[0].status, 'pending');
  let writerError;
  const started = performance.now();
  // เขียนไฟล์ตรงจำลอง worker คนละโปรเซส สถานะจึงต้องอ่าน authoritative ข้าม cache เดิม
  const timer = setTimeout(() => {
    try { writeFileSync(join(tempRoot, 'data', 'clip-jobs.json'), JSON.stringify([{ ...pending, status: 'done', result: v2Record }])); }
    catch (error) { writerError = error; }
  }, 40);
  try {
    const body = await responseBody(await status(statusRequest('job-test', '&wait=2')));
    assert.equal(writerError, undefined);
    assert.equal(body.status, 'done');
    assert.equal(body.timedOut, false);
    assert.deepEqual(body.result, compactResult(v2Record));
    assert.ok(performance.now() - started < 1_500, 'terminal work returns before the requested two-second wait');
  } finally { clearTimeout(timer); }
});

test('fractional waits and a fractional environment cap return timedOut=true without a long test delay', async () => {
  await jobs.add(job());
  const started = performance.now();
  const fractional = await responseBody(await status(statusRequest('job-test', '&wait=0.03')));
  assert.equal(fractional.status, 'pending');
  assert.equal(fractional.timedOut, true);
  assert.ok(performance.now() - started >= 20, 'fractional wait is not rounded down to zero');
  process.env.CLIP_AGENT_WAIT_CAP_SEC = '0.03';
  const cappedStarted = performance.now();
  const capped = await responseBody(await status(statusRequest('job-test', '&wait=30')));
  assert.equal(capped.timedOut, true);
  assert.ok(performance.now() - cappedStarted < 1_000, 'environment cap bounds the requested wait');
});

test('status uses a two-second polling interval when the test override is absent', { timeout: 5_000 }, async () => {
  delete process.env.CLIP_AGENT_POLL_INTERVAL_MS;
  const pending = job();
  await jobs.add(pending);
  await jobs.getAll();
  const started = performance.now();
  const timer = setTimeout(() => writeFileSync(join(tempRoot, 'data', 'clip-jobs.json'), JSON.stringify([{ ...pending, status: 'done', result: v2Record }])), 40);
  try {
    const body = await responseBody(await status(statusRequest('job-test', '&wait=3')));
    assert.equal(body.status, 'done');
    assert.equal(body.timedOut, false);
    assert.ok(performance.now() - started >= 1_700, 'the default poll is two seconds, while tests otherwise override it to ten milliseconds');
  } finally { clearTimeout(timer); }
});

test('status wait defaults to zero, while error and cancelled are immediate terminal states', async () => {
  await jobs.add(job({ status: 'retry_wait', statusNote: 'รอลองใหม่', attempts: 2, nextRetryAt: '2026-09-08T01:00:00.000Z', lastError: 'upstream unavailable' }));
  const started = performance.now();
  const waiting = await responseBody(await status(statusRequest('job-test')));
  assert.equal(waiting.timedOut, false);
  assert.equal(waiting.position, 0);
  assert.equal(waiting.statusNote, 'รอลองใหม่');
  assert.equal(waiting.attempts, 2);
  assert.equal(waiting.nextRetryAt, '2026-09-08T01:00:00.000Z');
  assert.equal(waiting.lastError, 'upstream unavailable');
  assert.ok(performance.now() - started < 1_000);
  for (const terminal of ['error', 'cancelled']) {
    await jobs.update('job-test', { status: terminal, error: 'ถอดไม่สำเร็จ', cancelledAt: terminal === 'cancelled' ? '2026-09-08T01:00:00.000Z' : null });
    const terminalStarted = performance.now();
    const body = await responseBody(await status(statusRequest('job-test', '&wait=2')));
    assert.equal(body.status, terminal);
    assert.equal(body.timedOut, false);
    assert.equal(body.error, terminal === 'error' ? 'ถอดไม่สำเร็จ' : '');
    assert.equal(body.result, null);
    assert.ok(performance.now() - terminalStarted < 1_000);
  }
});

test('result looks up exact URL, prefers chosen, sorts newest first, and lets ID win over URL', async () => {
  const selected = caseRow({ id: 'chosen-old', chosen: true, createdAt: '2020-01-01T00:00:00.000Z' });
  const recent = caseRow({ id: 'newest', createdAt: '2026-09-08T02:00:00.000Z' });
  await insights.addMany([recent, selected, caseRow({ id: 'prefix', url: `${clipUrl}-other`, createdAt: '2099-01-01T00:00:00.000Z' })]);
  assert.deepEqual(await responseBody(await result(resultRequest(`url=${encodeURIComponent(clipUrl)}`))), { ok: true, result: compactResult(selected) });
  assert.deepEqual(await responseBody(await result(resultRequest(`id=newest&url=${encodeURIComponent(clipUrl)}`))), { ok: true, result: compactResult(recent) });
  await insights.update('chosen-old', { chosen: false });
  assert.deepEqual((await responseBody(await result(resultRequest(`url=${encodeURIComponent(clipUrl)}`)))).result, compactResult(recent));
  const chosenNew = caseRow({ id: 'chosen-new', chosen: true, createdAt: '2021-01-01T00:00:00.000Z' });
  await insights.update('chosen-old', { chosen: true });
  await insights.add(chosenNew);
  assert.deepEqual((await responseBody(await result(resultRequest(`url=${encodeURIComponent(clipUrl)}`)))).result, compactResult(chosenNew));
  assert.deepEqual((await responseBody(await result(resultRequest('id=newest&full=1')))).result, recent);
});

test('result defaults to insight, supports actual transcript writer fields and full output, and returns 404', async () => {
  const insight = caseRow();
  const transcript = { id: 'case-test', url: clipUrl, platform: 'youtube', caption: 'คำบรรยาย', rawText: 'ต้นฉบับคำพูดครบทุกบรรทัด', tidyText: 'ข้อความเรียบเรียง', classify: { type: 'interview' }, createdAt: '2026-09-08T00:00:00.000Z' };
  await insights.add(insight);
  await transcripts.add(transcript);
  assert.deepEqual(await responseBody(await result(resultRequest('id=case-test'))), { ok: true, result: compactResult(insight) });
  assert.deepEqual(await responseBody(await result(resultRequest('id=case-test&kind=transcript'))), { ok: true, result: compactResult(transcript, 'transcript') });
  assert.deepEqual(await responseBody(await result(resultRequest('id=case-test&kind=transcript&full=1'))), { ok: true, result: transcript });
  for (const query of ['', 'id=missing', `url=${encodeURIComponent(`${clipUrl}-unknown`)}`, `id=missing&url=${encodeURIComponent(clipUrl)}`]) {
    assert.deepEqual(await responseBody(await result(resultRequest(query)), 404), { ok: false, errorType: 'CASE_NOT_FOUND' });
  }
});

test('route 500 failures keep typed errors and do not expose primary-store details or secrets', async () => {
  const secret = 'DO-NOT-RETURN-store-secret';
  for (const [name, handler, makeRequest, storeName, errorType] of [
    ['submit', submit, () => submitRequest(), 'clip-jobs', 'SUBMIT_ERROR'],
    ['status', status, () => statusRequest('job-test'), 'clip-jobs', 'STATUS_ERROR'],
    ['result', result, () => resultRequest('id=case-test'), 'clip-insights', 'RESULT_ERROR'],
  ]) {
    const path = join(tempRoot, 'data', `${storeName}.json`);
    writeFileSync(path, `{${secret}`);
    try {
      const body = await assertError(await handler(makeRequest()), 500, errorType);
      assert.equal(typeof body.error, 'string', name);
      assert.match(body.error, /[ก-๙]/, name);
      assert.equal(JSON.stringify(body).includes(secret), false, name);
      assert.equal(JSON.stringify(body).includes(tempRoot), false, name);
    } finally {
      writeFileSync(path, '[]');
      await stores[storeName].getAll({ authoritative: true });
    }
  }
});

test('compactResult maps the real topics v2 fixture without evidence or raw payload duplication (<25% bytes)', () => {
  const before = structuredClone(v2Record);
  const compact = compactResult(v2Record);
  assert.equal(compact.caseId, composed.id);
  assert.equal(compact.mainStory, composed.doc.mainStory);
  assert.equal(compact.stories.length, composed.doc.stories.length);
  for (const [index, story] of composed.doc.stories.entries()) {
    assert.deepEqual(compact.stories[index], {
      id: story.id, topic: story.topic, story: story.story, highlight: story.highlight,
      facts: story.facts.map(fact => fact.text),
      quotes: story.quotes.map(quote => ({ text: quote.text, speaker: quote.speaker, verified: quote.verification === 'verified' ? true : quote.verification === 'unverified' ? false : null })),
      sharePct: story.sharePct, quality: story.quality,
    });
  }
  assert.deepEqual(compact.warnings, []);
  assert.equal('subStories' in compact, false);
  assert.equal('insight' in compact, false);
  assert.equal('evidence' in compact, false);
  assert.equal('rawData' in compact, false);
  const ratio = Buffer.byteLength(JSON.stringify(compact), 'utf8') / Buffer.byteLength(JSON.stringify(v2Record), 'utf8');
  assert.ok(ratio < 0.25, `real v2 fixture JSON byte ratio is ${ratio.toFixed(4)}`);
  assert.deepEqual(v2Record, before);
});

test('compactResult keeps real legacy prose and warnings while omitting heavy archives and diagnostics', () => {
  for (const saved of archive) {
    const compact = compactResult(saved);
    assert.equal(compact.caseId, saved.id);
    assert.equal(compact.mainStory, saved.insight.mainStory ?? null);
    assert.deepEqual(compact.stories, []);
    assert.deepEqual(compact.subStories, saved.insight.subStories.map(story => ({ title: story.topic, text: story.rawData })));
    assert.deepEqual(compact.keyPoints, saved.insight.keyPoints.map(point => typeof point === 'string' ? point : [point.point, point.detail].filter(Boolean).join(': ')));
    const detail = (d) => [d.why ?? d.message ?? d.note, d.got !== undefined || d.want !== undefined ? `got=${JSON.stringify(d.got ?? null)} want=${JSON.stringify(d.want ?? null)}` : null, d.why && d.note ? d.note : null].filter(Boolean).join(' · ');
    assert.deepEqual(compact.warnings, [...saved.insight.editorialWarnings, ...saved.insight.brain.degradations.map(value => [value.type, detail(value) || null].filter(Boolean).join(': '))]);
    assert.equal(compact.status, saved.insight.brain.status);
    assert.equal(compact.brain.engine, saved.insight.engine);
    assert.equal('check' in compact.brain, false);
    assert.equal('steps' in compact.brain, false);
    assert.equal('rawData' in compact, false);
  }
  assert.ok(compactResult(archive[2]).warnings.includes('repair-failed: BRAIN_TIMEOUT'));
  assert.ok(archive.some(saved => compactResult(saved).warnings.includes('repair-capped: got=12 want=17')), 'got/want details of real degradations survive');
});

test('compactResult is null-safe and preserves true quote verification, receipt, money and raw transcript fields', () => {
  for (const sparse of [undefined, null, {}, [], 3, 'text', { insight: { topicsV2: { stories: [null, {}] }, keyPoints: false } }]) {
    const compact = compactResult(sparse);
    assert.equal(compact.caseId, null);
    assert.ok(Array.isArray(compact.stories));
    assert.ok(Array.isArray(compact.keyPoints));
    assert.ok(Array.isArray(compact.warnings));
    assert.doesNotThrow(() => JSON.stringify(compact));
    assert.equal(compactResult(sparse, 'transcript').text, null);
  }
  const saved = { id: 'metadata-test', insight: {
    mainStory: 'fallback story', engine: 'clip-brain',
    editorialWarnings: ['ตรวจชื่อก่อนเผยแพร่'],
    topicsV2: { stories: [{ quotes: [{ text: 'ยืนยัน', speaker: 'คนหนึ่ง', verification: 'verified' }, { text: 'ยังไม่ตรวจ', verification: 'pending' }, { text: 'ไม่ตรง', verification: 'unverified' }, {}] }] },
    brain: { elapsedMs: 1234, costs: { planUSD: 0.25, repairUSD: 0.5, tokens: 900000 }, degradations: [{ type: 'repair-failed', why: 'BRAIN_TIMEOUT' }], topicsV2: { ok: true, gate: { passed: true }, stories: 1, elapsedMs: 500 } },
  } };
  const compact = compactResult(saved);
  assert.equal(compact.mainStory, 'fallback story');
  assert.deepEqual(compact.stories[0].quotes.map(quote => quote.verified), [true, null, false, null], 'pending = ยังไม่ตรวจ → null');
  assert.deepEqual(compact.warnings, ['ตรวจชื่อก่อนเผยแพร่', 'repair-failed: BRAIN_TIMEOUT']);
  assert.equal(compact.brain.costUSD, 0.75);
  assert.equal(compact.elapsedMs, 1234);
  assert.deepEqual(compact.brain.topicsV2, saved.insight.brain.topicsV2);
  compact.brain.topicsV2.gate.passed = false;
  assert.equal(saved.insight.brain.topicsV2.gate.passed, true);
  assert.deepEqual(compactResult({ id: 'transcript', rawText: 'ต้นฉบับ', tidyText: 'เรียบเรียง', caption: 'คำบรรยาย' }, 'transcript'), {
    caseId: 'transcript', url: null, platform: null, title: 'คำบรรยาย', text: 'ต้นฉบับ', createdAt: null,
  });
});

// ── Fable 8 ก.ย. 69: อ่านแถวเดียวให้ถูกโหมด store (กัน egress Supabase) ──
const { readRowFresh } = await import(new URL('../src/lib/services/clipAgent/storeRead.js', import.meta.url));

test('readRowFresh uses a single-row findById in Supabase mode and an authoritative file read otherwise', async () => {
  const calls = [];
  const fake = {
    findById: async (id) => { calls.push(['findById', id]); return id === 'hit' ? { id, status: 'done' } : null; },
    getAll: async (opts) => { calls.push(['getAll', opts]); return [{ id: '__clip_worker_heartbeat__' }, { id: 'hit', status: 'pending' }]; },
  };
  assert.deepEqual(await readRowFresh(fake, 'hit', { supabase: true, retryDelayMs: 1 }), { id: 'hit', status: 'done' });
  assert.equal(await readRowFresh(fake, 'miss', { supabase: true, retryDelayMs: 1 }), null);
  assert.deepEqual(calls, [['findById', 'hit'], ['findById', 'miss'], ['findById', 'miss']], 'Supabase mode never scans the whole table (a miss is re-read once)');
  calls.length = 0;
  assert.deepEqual(await readRowFresh(fake, 'hit', { supabase: false }), { id: 'hit', status: 'pending' });
  assert.equal(await readRowFresh(fake, 'miss', { supabase: false }), null);
  assert.deepEqual(calls, [['getAll', { authoritative: true }], ['getAll', { authoritative: true }]], 'file mode must bypass the stale in-memory cache');
  assert.equal(await readRowFresh(fake, '', { supabase: true, retryDelayMs: 1 }), null);
  assert.equal(await readRowFresh({ findById: async () => undefined }, 'x', { supabase: true, retryDelayMs: 1 }), null, 'undefined from the store normalises to null');
});

test('status never exposes the worker heartbeat row as a job, and result?id= reads the archive row directly', async () => {
  await jobs.add({ id: heartbeatId, lastSeenAt: '2026-09-08T00:00:00.000Z', status: 'alive' });
  await assertError(await status(statusRequest(heartbeatId)), 404, 'JOB_NOT_FOUND');
  await insights.add(caseRow({ id: 'case-direct' }));
  const body = await responseBody(await result(resultRequest('id=case-direct')));
  assert.equal(body.ok, true);
  assert.equal(body.result.caseId, 'case-direct');
  assert.equal(body.result.headline, 'พาดหัวทดสอบ');
});

// ── Fable 8 ก.ย. 69 (จากวงตรวจไขว้): กันสะดุดชั่วคราว · ล้าง URL ก่อนค้น · ธง lowQuality · env ว่าง ──
const { cleanClipUrl } = await import(new URL('../src/lib/services/clipAgent/clipUrl.js', import.meta.url));

test('readRowFresh retries one transient null in Supabase mode before giving up', async () => {
  let n = 0;
  const flaky = { findById: async () => (++n === 1 ? null : { id: 'j', status: 'processing' }), getAll: async () => { throw new Error('must not scan'); } };
  assert.deepEqual(await readRowFresh(flaky, 'j', { supabase: true, retryDelayMs: 1 }), { id: 'j', status: 'processing' });
  assert.equal(n, 2, 'exactly one retry');
  n = 0;
  assert.equal(await readRowFresh({ findById: async () => { n++; return null; } }, 'gone', { supabase: true, retryDelayMs: 1 }), null);
  assert.equal(n, 2, 'a genuinely missing row costs two single-row reads, never a table scan');
});

test('status returns the last seen state instead of 404 when the row vanishes mid-wait, but 404 when never seen', async () => {
  const pending = job();
  await jobs.add(pending);
  const timer = setTimeout(() => writeFileSync(join(tempRoot, 'data', 'clip-jobs.json'), '[]'), 40);
  try {
    const body = await responseBody(await status(statusRequest('job-test', '&wait=0.3')));
    assert.equal(body.status, 'pending');
    assert.equal(body.jobId, 'job-test');
    assert.equal(body.timedOut, true, 'reported as a timed-out wait, not as a lost job');
  } finally { clearTimeout(timer); }
  await assertError(await status(statusRequest('job-test', '&wait=0.05')), 404, 'JOB_NOT_FOUND');
});

test('a blank CLIP_AGENT_WAIT_CAP_SEC means the default cap, not a zero cap', async () => {
  await jobs.add(job());
  process.env.CLIP_AGENT_WAIT_CAP_SEC = '';
  const started = performance.now();
  const body = await responseBody(await status(statusRequest('job-test', '&wait=0.05')));
  assert.equal(body.timedOut, true, 'the request actually waited');
  assert.ok(performance.now() - started >= 40, 'blank env must not collapse the wait to zero');
});

test('a blank CLIP_AGENT_API_KEY keeps the API disabled and an invalid result kind is a 400', async () => {
  process.env.CLIP_AGENT_API_KEY = '';
  await assertError(await status(statusRequest('x')), 503, 'AGENT_API_DISABLED');
  process.env.CLIP_AGENT_API_KEY = key;
  await assertError(await result(resultRequest('id=x&kind=hunt')), 400, 'BAD_REQUEST');
});

test('result?url= finds archive rows stored under the cleaned canonical URL', async () => {
  assert.equal(cleanClipUrl('https://youtu.be/Vf8UDY5EC9Q?si=abc'), 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q');
  assert.equal(cleanClipUrl('https://www.youtube.com/shorts/Vf8UDY5EC9Q'), 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q');
  assert.equal(cleanClipUrl('https://www.tiktok.com/@a/video/1?fbclid=x&utm_source=y&_r=1'), 'https://www.tiktok.com/@a/video/1?_r=1');
  await insights.add(caseRow({ id: 'canon', url: 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q' }));
  for (const q of ['https://youtu.be/Vf8UDY5EC9Q?si=abc', 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q&feature=share', 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q']) {
    const body = await responseBody(await result(resultRequest(`url=${encodeURIComponent(q)}`)));
    assert.equal(body.result.caseId, 'canon', q);
  }
  await assertError(await result(resultRequest(`url=${encodeURIComponent('https://youtu.be/AAAAAAAAAAA')}`)), 404, 'CASE_NOT_FOUND');
});

test('compact result surfaces lowQuality flags, counts array receipts, keeps pending quotes unverified(null) and full degradation details', () => {
  const flagged = compactResult({ id: 'c', url: clipUrl, platform: 'youtube', lowQuality: true, qualityNote: 'ผลอาจไม่สมบูรณ์: สั้นเกิน', headline: 'h',
    brain: { topicsV2: { ok: true, stories: [{ id: 's1' }, { id: 's2' }] }, degradations: [{ type: 'segment-incomplete', got: 3, want: 5, note: 'ท่อนหาย' }, { type: 'reviewer-unavailable', why: 'BRAIN_AUTH' }] },
    topicsV2: { stories: [{ id: 's1', quotes: [{ text: 'q', verification: 'pending' }, { text: 'r', verification: 'unverified' }, { text: 'v', verification: 'verified' }] }] } });
  assert.equal(flagged.lowQuality, true);
  assert.equal(flagged.qualityNote, 'ผลอาจไม่สมบูรณ์: สั้นเกิน');
  assert.equal(flagged.brain.topicsV2.stories, 2);
  assert.deepEqual(flagged.stories[0].quotes.map(q => q.verified), [null, false, true]);
  assert.deepEqual(flagged.warnings, ['segment-incomplete: ท่อนหาย · got=3 want=5', 'reviewer-unavailable: BRAIN_AUTH']);
  const nested = compactResult(caseRow({ insight: { headline: 'h', lowQuality: true, qualityNote: 'n' } }));
  assert.equal(nested.lowQuality, true);
  assert.equal(nested.qualityNote, 'n');
  const clean = compactResult(caseRow());
  assert.equal(clean.lowQuality, false);
  assert.equal(clean.qualityNote, null);
});
