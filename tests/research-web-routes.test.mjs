// ============================================================
// 🧪 tests/research-web-routes.test.mjs — route /api/research/* + hook ใน /api/queue/add (Research Agent v2 · เลน B · 1 ต.ค. 69)
// ------------------------------------------------------------
// เรียก handler ตัวจริงตรงๆ ด้วย Request จริง (ไม่เปิดเซิร์ฟเวอร์) · Supabase = ตัวปลอมในหน่วยความจำ · 'next/server' = ตัวปลอม
//   (NextResponse.json = Response.json · after() เก็บ callback) · ไม่ต่อเน็ต ไม่แตะ DB จริง ไม่เขียนไฟล์ใน repo
// /api/queue/add (ไฟล์ล็อก): ปิดสวิตช์ต้อง "เหมือนต้นฉบับทุกไบต์" — เทียบกับซอร์สเดียวกันที่ถอด hook รีเสิร์ชออก
//   (คำตอบ JSON + การเรียก enqueueJob/createStore/fetch + ไม่ import โมดูลรีเสิร์ช + ไม่เรียก after)
// mutation (ข้อสุดท้าย): secretMatches คืน true เสมอ · ถอดเงื่อนไข RESEARCH_AGENT ใน queue/add · เกณฑ์ online ไม่มีเพดาน ·
//   cards ส่ง tool_log เสมอ · report ไม่เช็คเจ้าของใบขอ ·
//   ★ รอบข้อตัดสินผู้คุมงาน 1 ต.ค. 69 (contract-check #1 #2 #3): lease กลับมาส่ง limits · heartbeat ไม่อ่าน quota.remainingPct /
//   ไม่อ่าน quotaPct ของ worker รุ่นแรก · version อ่านแต่ body (ไม่สำรอง header) / อ่านแต่ header (ไม่อ่าน body)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentResultOut1, agentResultOut2, createFakeSupabase, importSource, installResearchHooks, replaceOnce, ROOT, srcUrl,
} from './helpers/research-web-fakes.mjs';

const hooks = installResearchHooks({
  stubs: {
    '@/lib/supabase': 'export const isSupabaseReady = () => globalThis.__RA_SB_READY !== false; export const getSupabase = () => globalThis.__RA_SB;',
    '@/lib/services/queueService': 'export const enqueueJob = (...a) => globalThis.__RA_Q.enqueueJob(...a);',
    '@/lib/persistStore': 'export const createStore = (...a) => globalThis.__RA_Q.createStore(...a);',
    '@/lib/logger': `export const createLogger = (name) => new Proxy({}, { get: (_, level) => (...a) => globalThis.__RA_Q?.log?.(name, String(level), a.join(' ')) });`,
  },
});

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SOURCES = {
  http: read('src/lib/research-agent/http.js'),
  lease: read('src/app/api/research/lease/route.js'),
  heartbeat: read('src/app/api/research/heartbeat/route.js'),
  status: read('src/app/api/research/status/route.js'),
  cards: read('src/app/api/research/cards/route.js'),
  report: read('src/app/api/research/report/route.js'),
  queueAdd: read('src/app/api/queue/add/route.js'),
};

const routes = {
  lease: await import(srcUrl('app/api/research/lease/route.js')),
  heartbeat: await import(srcUrl('app/api/research/heartbeat/route.js')),
  report: await import(srcUrl('app/api/research/report/route.js')),
  cards: await import(srcUrl('app/api/research/cards/route.js')),
  feedback: await import(srcUrl('app/api/research/feedback/route.js')),
  status: await import(srcUrl('app/api/research/status/route.js')),
};
const store = await import(srcUrl('lib/research-agent/store.js'));

const SECRET = 'research-S3CRET-01';
const BOT_KEY = 'bot-K3Y-0001';
const ENV_KEYS = ['RESEARCH_AGENT', 'RESEARCH_AGENT_MODE', 'RESEARCH_AGENT_SECRET', 'DISCORD_API_SECRET', 'RESEARCH_AGENT_WAIT_MS',
  'RESEARCH_AGENT_MAX_MINUTES', 'RESEARCH_AGENT_MAX_CALLS', 'RESEARCH_AGENT_EFFORT', 'RESEARCH_AGENT_ALLOW_MEDIUM', 'RESEARCH_AGENT_TOOLS',
  'RESEARCH_AGENT_BRAIN', 'RESEARCH_AGENT_QUOTA_ALERT_PCT', 'RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH', 'RESEARCH_AGENT_DEADLINE_MIN',
  'TEXT_ONLY_MODE', 'API_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

async function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const ON = { RESEARCH_AGENT: '1', RESEARCH_AGENT_SECRET: SECRET, DISCORD_API_SECRET: BOT_KEY };

function freshSb() {
  const sb = createFakeSupabase();
  globalThis.__RA_SB = sb;
  globalThis.__RA_SB_READY = true;
  return sb;
}

function post(path, body, headers = {}) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const get = (path, headers = {}) => new Request(`http://localhost${path}`, { method: 'GET', headers });
const worker = (extra = {}) => ({ 'x-research-secret': SECRET, ...extra });
const bot = (extra = {}) => ({ 'x-api-key': BOT_KEY, ...extra });

async function call(handler, req) {
  const res = await handler(req);
  return { status: res.status, body: await res.json() };
}

async function seedRequest(jobId, extra = {}) {
  const storage = store.createResearchStorage({ sb: globalThis.__RA_SB });
  await storage.createRequest({ jobId, rawText: `ข่าวดิบของ ${jobId}`, sourceUrls: ['https://news.example.test/a'], userId: 'discord-7', ...extra });
  return storage;
}

// ── ยืนยันตัวตน ──────────────────────────────────────────────────
async function assertWorkerAuth(leaseRoute = routes.lease) {
  const sb = freshSb();
  await withEnv({ RESEARCH_AGENT: '1' }, async () => {
    for (const [name, route, body] of [
      ['lease', leaseRoute, { workerId: 'w1' }],
      ['heartbeat', routes.heartbeat, { workerId: 'w1', jobId: 'q_1' }],
      ['report', routes.report, { workerId: 'w1', jobId: 'q_1', result: {} }],
    ]) {
      const res = await call(route.POST, post(`/api/research/${name}`, body, worker()));
      assert.equal(res.status, 503, `${name}: ไม่ตั้ง secret ต้องปิดประตู`);
      assert.equal(res.body.errorType, 'RESEARCH_SECRET_NOT_CONFIGURED');
    }
  });
  await withEnv({ RESEARCH_AGENT: '1', RESEARCH_AGENT_SECRET: SECRET }, async () => {
    for (const headers of [{}, { 'x-research-secret': 'research-S3CRET-02' }, { 'x-api-key': SECRET }]) {
      const res = await call(leaseRoute.POST, post('/api/research/lease', { workerId: 'w1' }, headers));
      assert.equal(res.status, 401, JSON.stringify(Object.keys(headers)));
      assert.equal(res.body.errorType, 'RESEARCH_UNAUTHORIZED');
      assert.doesNotMatch(JSON.stringify(res.body), /S3CRET/);
    }
  });
  assert.equal(sb.calls.length, 0, 'ปฏิเสธก่อนแตะฐานเสมอ');
}

test('worker routes: ไม่ตั้ง RESEARCH_AGENT_SECRET = 503 ปิดประตู · กุญแจผิด (ยาวเท่ากัน)/ไม่ส่ง = 401 · ไม่แตะฐาน', () => assertWorkerAuth());

async function assertBotAuth(cardsRoute = routes.cards) {
  const sb = freshSb();
  await withEnv({ RESEARCH_AGENT: '1' }, async () => {
    const res = await call(cardsRoute.GET, get('/api/research/cards?jobId=q_1', bot()));
    assert.equal(res.status, 403);
    assert.equal(res.body.errorType, 'BOT_SECRET_NOT_CONFIGURED');
    const fb = await call(routes.feedback.POST, post('/api/research/feedback', { jobId: 'q_1', cardId: 'R1', vote: 'up', userId: 'u1' }, bot()));
    assert.equal(fb.status, 403);
  });
  await withEnv({ RESEARCH_AGENT: '1', DISCORD_API_SECRET: BOT_KEY }, async () => {
    for (const headers of [{}, { 'x-api-key': 'bot-K3Y-0002' }, { 'x-research-secret': BOT_KEY }]) {
      const res = await call(cardsRoute.GET, get('/api/research/cards?jobId=q_1', headers));
      assert.equal(res.status, 401);
      assert.equal(res.body.errorType, 'UNAUTHORIZED');
    }
    assert.equal(sb.calls.length, 0);
    assert.equal((await call(cardsRoute.GET, get('/api/research/cards?jobId=q_1', { 'x-bot-secret': ` ${BOT_KEY}\n` }))).status, 200,
      'trim เหมือน /api/bot/tracking');
    assert.equal((await call(cardsRoute.GET, get('/api/research/cards?jobId=q_1', bot()))).status, 200);
  });
}

test('cards/feedback: กุญแจบอทแบบ /api/bot/tracking — ไม่ตั้ง DISCORD_API_SECRET = 403 · ผิด/ไม่ส่ง = 401 · x-bot-secret/x-api-key (trim) ผ่าน', () => assertBotAuth());

// ── lease / heartbeat ────────────────────────────────────────────
async function assertLeaseShape(leaseRoute = routes.lease) {
  const sb = freshSb();
  await withEnv({ RESEARCH_AGENT_SECRET: SECRET }, async () => {
    const off = await call(leaseRoute.POST, post('/api/research/lease', { workerId: 'w1' }, worker()));
    assert.deepEqual(off, { status: 200, body: { success: true, enabled: false, mode: 'shadow', job: null } });
    assert.equal(sb.calls.length, 0);
  });
  // ตั้งค่างานของ worker บน Vercel ไว้ด้วย — lease ต้องไม่ส่งต่อ (ข้อตัดสิน 1 ต.ค. 69 · contract-check #3)
  const workerSideEnv = {
    RESEARCH_AGENT_MAX_CALLS: '30', RESEARCH_AGENT_MAX_MINUTES: '9', RESEARCH_AGENT_EFFORT: 'medium', RESEARCH_AGENT_ALLOW_MEDIUM: '0',
    RESEARCH_AGENT_TOOLS: 'serper,fetch-page', RESEARCH_AGENT_BRAIN: 'api', RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH: '5', RESEARCH_AGENT_QUOTA_ALERT_PCT: '20',
  };
  await withEnv({ ...ON, ...workerSideEnv, RESEARCH_AGENT_MODE: 'assist' }, async () => {
    await seedRequest('q_first', { channelId: '42', sourceMessageId: '4242' });
    await seedRequest('q_second');
    const bad = await call(leaseRoute.POST, post('/api/research/lease', { workerId: 'bad id with spaces' }, worker()));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.errorType, 'VALIDATION_ERROR');
    const notJson = await call(leaseRoute.POST, post('/api/research/lease', '{oops', worker()));
    assert.equal(notJson.status, 400);
    assert.equal(notJson.body.errorType, 'INVALID_JSON');
    // สัญญาใหม่: lease body {workerId, version}
    const res = await call(leaseRoute.POST, post('/api/research/lease', { workerId: 'owner-pc', version: 'research-lease-v1' }, worker()));
    assert.equal(res.status, 200);
    const { job } = res.body;
    assert.deepEqual(Object.keys(job).sort(), ['attempt', 'channelId', 'createdAt', 'deadlineAt', 'id', 'jobId', 'leasedAt', 'mode', 'rawText',
      'sourceMessageId', 'sourceUrls', 'userId', 'workflowId'].sort(), 'job ไม่มี limits (ค่างานอยู่ฝั่ง worker ในเฟส 1)');
    assert.equal(job.jobId, 'q_first');
    assert.equal(job.id, 'q_first');
    assert.equal(job.workflowId, 'unify_q_first');
    assert.equal(job.rawText, 'ข่าวดิบของ q_first');
    assert.deepEqual(job.sourceUrls, ['https://news.example.test/a']);
    assert.equal(job.channelId, '42');
    assert.equal(job.sourceMessageId, '4242');
    assert.equal(job.attempt, 1);
    assert.equal(job.mode, 'assist');
    assert.equal(Date.parse(job.deadlineAt) - Date.parse(job.createdAt), 15 * 60_000, 'เส้นตายใบขอ 15 นาที (RESEARCH_AGENT_DEADLINE_MIN ไม่ตั้ง · MAX_MINUTES ไม่เกี่ยว)');
    const presence = sb.doc('rworker_owner-pc');
    assert.equal(presence.currentJobId, 'q_first');
    assert.equal(presence.version, 'research-lease-v1', 'version จาก body ของ lease ถึงชีพจร');
    assert.equal((await call(leaseRoute.POST, post('/api/research/lease', { workerId: 'team-pc' }, worker()))).body.job.jobId, 'q_second');
    assert.equal((await call(leaseRoute.POST, post('/api/research/lease', { workerId: 'team-pc' }, worker()))).body.job, null);
  });
}

test('lease: ปิดสวิตช์ = enabled:false ไม่แตะฐาน · เปิด = แจกใบเก่าสุดพร้อม rawText/sourceUrls/deadline 15 นาที/mode ไม่มี limits · version ถึงชีพจร · หมดงาน = null · workerId ผิด = 400', () => assertLeaseShape());

test('heartbeat: ถือใบอยู่ = ok · คนอื่น = 409 RESEARCH_LEASE_LOST · ไม่พบ = 404 · ไม่มี jobId = แตะชีพจร (quota)', async () => {
  const sb = freshSb();
  await withEnv(ON, async () => {
    await seedRequest('q_hb');
    await call(routes.lease.POST, post('/api/research/lease', { workerId: 'w1' }, worker()));
    const ok = await call(routes.heartbeat.POST, post('/api/research/heartbeat', { workerId: 'w1', jobId: 'q_hb' }, worker()));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.status, 'leased');
    const lost = await call(routes.heartbeat.POST, post('/api/research/heartbeat', { workerId: 'w2', jobId: 'q_hb' }, worker()));
    assert.equal(lost.status, 409);
    assert.equal(lost.body.errorType, 'RESEARCH_LEASE_LOST');
    const missing = await call(routes.heartbeat.POST, post('/api/research/heartbeat', { workerId: 'w1', jobId: 'q_none' }, worker()));
    assert.equal(missing.status, 404);
    assert.equal(missing.body.errorType, 'RESEARCH_REQUEST_NOT_FOUND');
    const idle = await call(routes.heartbeat.POST, post('/api/research/heartbeat', { workerId: 'w9', quota: 9, account: 'c' }, worker()));
    assert.deepEqual(idle.body, { success: true, ok: true, jobId: null });
    assert.deepEqual(sb.doc('rworker_w9').quota.pct, 9);
    const badJob = await call(routes.heartbeat.POST, post('/api/research/heartbeat', { workerId: 'w1', jobId: '../etc' }, worker()));
    assert.equal(badJob.status, 400);
  });
});

/**
 * สัญญา heartbeat ข้ามเลน A↔B (ข้อตัดสิน 1 ต.ค. 69 · contract-check #1 #2): โควตาระหว่างทำงานต้องถึง /api/research/status
 * ก่อนงานจบ (บอทเลน C เตือนเจ้าของได้ทันที ไม่ต้องรอ /report) — รับทั้งรูปใหม่และรูปของ worker รุ่นแรก
 */
async function assertHeartbeatContract(hbRoute = routes.heartbeat) {
  freshSb();
  await withEnv(ON, async () => {
    await seedRequest('q_beat');
    await call(routes.lease.POST, post('/api/research/lease', { workerId: 'pc-new', version: 'research-lease-v1' }, worker()));
    // worker สัญญาใหม่: {jobId, workerId, version: PROTOCOL, account, quota: {remainingPct}} — header เก่ายังติดมาด้วยได้ แต่ body ชนะ
    const beat = await call(hbRoute.POST, post('/api/research/heartbeat',
      { jobId: 'q_beat', workerId: 'pc-new', version: 'research-lease-v2', account: 'b', quota: { remainingPct: 13 } },
      worker({ 'x-research-worker-version': 'research-lease-v1' })));
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
    const mid = await call(routes.status.GET, get('/api/research/status'));
    assert.deepEqual([mid.body.quota?.pct, mid.body.quota?.account, mid.body.quota?.low], [13, 'b', true],
      'โควตา 13% ระหว่างทำงานต้องขึ้น low ที่ /status ก่อนงานจบ');
    // worker รุ่นแรก: {workerId, account, quotaPct} + เวอร์ชันทาง header x-research-worker-version
    const old = await call(hbRoute.POST, post('/api/research/heartbeat', { workerId: 'pc-old', account: 'c', quotaPct: 55 },
      worker({ 'x-research-worker-version': 'research-lease-v1' })));
    assert.equal(old.status, 200, JSON.stringify(old.body));
    // เวอร์ชันหน้าตาไม่ปลอดภัย = ไม่บันทึก (status เป็นหน้าสาธารณะ)
    await call(hbRoute.POST, post('/api/research/heartbeat', { workerId: 'pc-odd', version: '<b>x</b>', quota: { remainingPct: 70 } }, worker()));
    const status = await call(routes.status.GET, get('/api/research/status'));
    const byId = Object.fromEntries(status.body.workers.map((w) => [w.workerId, w]));
    assert.deepEqual([byId['pc-new'].quota?.pct, byId['pc-new'].quota?.account, byId['pc-new'].version], [13, 'b', 'research-lease-v2']);
    assert.deepEqual([byId['pc-old'].quota?.pct, byId['pc-old'].quota?.account, byId['pc-old'].version], [55, 'c', 'research-lease-v1']);
    assert.deepEqual([byId['pc-odd'].quota?.pct, byId['pc-odd'].version], [70, null]);
  });
}

test('heartbeat สัญญา 1 ต.ค. 69: quota.remainingPct + version ใน body ถึง /status ทันที (low ≤ 15%) · worker รุ่นแรก quotaPct + header version ก็ถึง · version แปลก = ไม่บันทึก', () => assertHeartbeatContract());

// ── report ───────────────────────────────────────────────────────
async function assertReportOwnership(reportRoute = routes.report) {
  freshSb();
  await withEnv(ON, async () => {
    await seedRequest('q_own');
    await call(routes.lease.POST, post('/api/research/lease', { workerId: 'w1' }, worker()));
    const stranger = await call(reportRoute.POST, post('/api/research/report', { jobId: 'q_own', workerId: 'w2', result: agentResultOut1() }, worker()));
    assert.equal(stranger.status, 409, 'worker ที่ไม่ได้ถือใบห้ามส่งผลทับ');
    assert.equal(stranger.body.errorType, 'RESEARCH_LEASE_LOST');
    assert.equal(globalThis.__RA_SB.doc('rcard_q_own'), null);
  });
}

test('report: เก็บการ์ด (ด่านซ้ำฝั่งเว็บ) + ปิดใบขอ · ส่งซ้ำ = duplicate · worker อื่น = 409 · ไม่พบ = 404 · result ผิดชนิด = 400 · body ใหญ่ = 413', async () => {
  await assertReportOwnership();
  const sb = freshSb();
  await withEnv(ON, async () => {
    await seedRequest('q_rep');
    await call(routes.lease.POST, post('/api/research/lease', { workerId: 'w1' }, worker()));
    const res = await call(routes.report.POST, post('/api/research/report', { jobId: 'q_rep', workerId: 'w1', result: agentResultOut2() }, worker()));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'done');
    assert.equal(res.body.cardsCount, 3);
    assert.equal(res.body.passCount, 0, 'การ์ดจากเพจเราเองต้องไม่ผ่านถึงนักเขียน');
    assert.equal(res.body.requestStatus, 'done');
    assert.equal(res.body.requestClosed, true);
    assert.ok(res.body.gateChanges >= 3);
    assert.equal(sb.doc('rcard_q_rep').mode, 'shadow', 'mode = สวิตช์ฝั่งเว็บ');
    assert.equal(sb.doc('rworker_w1').quota.pct, 12, 'โควตาจาก brain.quotaPctAfter ถึงชีพจร');
    const dup = await call(routes.report.POST, post('/api/research/report', { jobId: 'q_rep', workerId: 'w1', result: agentResultOut1() }, worker()));
    assert.equal(dup.status, 200);
    assert.equal(dup.body.duplicate, true);
    assert.equal(sb.doc('rcard_q_rep').cards.length, 3, 'ส่งซ้ำไม่เขียนทับ');
    const missing = await call(routes.report.POST, post('/api/research/report', { jobId: 'q_none', workerId: 'w1', result: agentResultOut1() }, worker()));
    assert.equal(missing.status, 404);
    const badResult = await call(routes.report.POST, post('/api/research/report', { jobId: 'q_rep', workerId: 'w1', result: [1] }, worker()));
    assert.equal(badResult.status, 400);
    const huge = await call(routes.report.POST, post('/api/research/report', `{"pad":"${'x'.repeat(1_000_001)}"}`, worker()));
    assert.equal(huge.status, 413);
    assert.equal(huge.body.errorType, 'RESEARCH_BODY_TOO_LARGE');
    await seedRequest('q_schema');
    await call(routes.lease.POST, post('/api/research/lease', { workerId: 'w1' }, worker()));
    const schemaBad = await call(routes.report.POST, post('/api/research/report', { jobId: 'q_schema', workerId: 'w1', result: { status: 'done', cards: 'x' } }, worker()));
    assert.equal(schemaBad.status, 200);
    assert.equal(schemaBad.body.status, 'failed');
    assert.ok(schemaBad.body.schemaErrors.length > 0);
    assert.equal(sb.doc('rreq_q_schema').status, 'failed');
  });
});

// ── cards / feedback ─────────────────────────────────────────────
async function assertCardsShape(cardsRoute = routes.cards) {
  const sb = freshSb();
  await withEnv(ON, async () => {
    const storage = await seedRequest('q_cards');
    const before = await call(cardsRoute.GET, get('/api/research/cards?jobId=q_cards', bot()));
    assert.equal(before.body.found, false);
    assert.equal(before.body.request.status, 'queued');
    assert.equal(before.body.cards, null);
    assert.equal(JSON.stringify(before.body).includes('ข่าวดิบของ'), false, 'ไม่ส่ง rawText ให้บอท');
    await storage.leaseNext({ workerId: 'w1' });
    await storage.report({ jobId: 'q_cards', workerId: 'w1', result: agentResultOut1(), mode: 'shadow' });
    const after = await call(cardsRoute.GET, get('/api/research/cards?jobId=q_cards', bot()));
    assert.equal(after.body.found, true);
    assert.equal(after.body.request.status, 'done');
    assert.equal(after.body.mode, 'shadow');
    assert.equal(after.body.cards.cards[0].id, 'R1');
    assert.equal('tool_log' in after.body.cards, false, 'tool_log ไม่ส่งเว้นแต่ full=1');
    assert.equal(after.body.cards.toolLogCount, 2);
    assert.deepEqual(after.body.summary.flags, ['ORIGIN_NOT_FOUND']);
    const full = await call(cardsRoute.GET, get('/api/research/cards?jobId=q_cards&full=1', bot()));
    assert.equal(full.body.cards.tool_log.length, 2);
    const unknown = await call(cardsRoute.GET, get('/api/research/cards?jobId=q_unknown', bot()));
    assert.deepEqual([unknown.status, unknown.body.found, unknown.body.request], [200, false, null]);
    assert.equal((await call(cardsRoute.GET, get('/api/research/cards?jobId=../../x', bot()))).status, 400);
  });
  return sb;
}

test('cards: ยังไม่มีการ์ด = found:false + สถานะใบขอ · มีแล้ว = เอกสาร 2.2 ไม่มี tool_log (เว้น full=1) · ไม่ส่ง rawText · jobId ผิด = 400', () => assertCardsShape());

test('feedback: validation 400 · ยังไม่มีการ์ด 404 · การ์ดไม่มี 404 · บันทึกและนับโหวต · ผู้ใช้เดิมโหวตซ้ำ = แทนที่', async () => {
  freshSb();
  await withEnv(ON, async () => {
    const send = (body) => call(routes.feedback.POST, post('/api/research/feedback', body, bot()));
    for (const body of [
      { jobId: 'q_fb', cardId: 'X1', vote: 'up', userId: 'u1' },
      { jobId: 'q_fb', cardId: 'R1', vote: 'meh', userId: 'u1' },
      { jobId: 'q_fb', cardId: 'R1', vote: 'up', userId: '' },
      { jobId: '', cardId: 'R1', vote: 'up', userId: 'u1' },
    ]) assert.equal((await send(body)).status, 400, JSON.stringify(body));
    assert.equal((await send({ jobId: 'q_fb', cardId: 'R1', vote: 'up', userId: 'u1' })).body.errorType, 'RESEARCH_CARDS_NOT_FOUND');
    const storage = await seedRequest('q_fb');
    await storage.leaseNext({ workerId: 'w1' });
    await storage.report({ jobId: 'q_fb', workerId: 'w1', result: agentResultOut1(), mode: 'shadow' });
    assert.equal((await send({ jobId: 'q_fb', cardId: 'R5', vote: 'up', userId: 'u1' })).body.errorType, 'RESEARCH_CARD_NOT_FOUND');
    const one = await send({ jobId: 'q_fb', cardId: 'R1', vote: 'up', userId: 'discord-111' });
    assert.deepEqual(one.body.votes, { up: 1, down: 0 });
    await send({ jobId: 'q_fb', cardId: 'R1', vote: 'up', userId: 'discord-222' });
    const changed = await send({ jobId: 'q_fb', cardId: 'R1', vote: 'down', userId: 'discord-111' });
    assert.deepEqual(changed.body.votes, { up: 1, down: 1 }, 'ผู้ใช้เดิมเปลี่ยนใจ = แทนที่ ไม่นับซ้ำ');
    const all = await send({ jobId: 'q_fb', cardId: 'all', vote: 'up', userId: 'owner' });
    assert.equal(all.status, 200);
  });
});

// ── status ───────────────────────────────────────────────────────
async function assertStatus(statusRoute = routes.status) {
  const sb = freshSb();
  await withEnv({ RESEARCH_AGENT_SECRET: SECRET }, async () => {
    const off = await call(statusRoute.GET, get('/api/research/status'));
    assert.equal(off.body.status, 'disabled');
    assert.equal(off.body.enabled, false);
    assert.equal(sb.calls.length, 0, 'ปิดสวิตช์ไม่แตะฐาน');
  });
  await withEnv(ON, async () => {
    const offline = await call(statusRoute.GET, get('/api/research/status'));
    assert.equal(offline.body.status, 'offline', 'ไม่มี worker เลย = offline');
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    sb.seed('rworker_old-pc', 'research-workers', { id: 'old-pc', workerId: 'old-pc', lastSeenAt: old, lastEvent: 'lease', revision: 1, quota: { pct: 50, account: 'main', at: old } }, old);
    assert.equal((await call(statusRoute.GET, get('/api/research/status'))).body.status, 'offline', 'ชีพจรเก่ากว่า 10 นาที = offline');
    await seedRequest('q_live');
    await call(routes.lease.POST, post('/api/research/lease', { workerId: 'owner-pc', quota: { pct: 14, account: 'b' } }, worker()));
    await seedRequest('q_wait');
    const live = await call(statusRoute.GET, get('/api/research/status'));
    assert.equal(live.body.status, 'online');
    assert.deepEqual([live.body.quota.pct, live.body.quota.account, live.body.quota.low, live.body.quota.alertPct], [14, 'b', true, 15]);
    assert.deepEqual([live.body.queue.queued, live.body.queue.leased, live.body.queue.staleLeased], [1, 1, 0]);
    assert.equal(live.body.workers.find((w) => w.workerId === 'owner-pc').online, true);
    assert.equal(live.body.workers.find((w) => w.workerId === 'old-pc').online, false);
    const text = JSON.stringify(live.body);
    for (const secret of [SECRET, BOT_KEY, 'ข่าวดิบของ', 'q_live']) assert.equal(text.includes(secret), false, `status ห้ามมี ${secret.slice(0, 8)}`);
    assert.equal(live.body.settings.secretConfigured, true);
  });
}

test('status: ปิดสวิตช์ = disabled ไม่แตะฐาน · ไม่มี/เก่า > 10 นาที = offline · มีชีพจร = online · quota ≤ 15% = low · ไม่มี secret/เนื้อข่าว/jobId', () => assertStatus());

test('ฐานล้ม: ทุก route ตอบ 503 RESEARCH_STORAGE_UNAVAILABLE (try/catch + errorType) ไม่มีข้อความดิบจาก DB', async () => {
  await withEnv(ON, async () => {
    const cases = [
      ['lease', () => routes.lease.POST(post('/api/research/lease', { workerId: 'w1' }, worker()))],
      ['heartbeat', () => routes.heartbeat.POST(post('/api/research/heartbeat', { workerId: 'w1', jobId: 'q_1' }, worker()))],
      ['report', () => routes.report.POST(post('/api/research/report', { workerId: 'w1', jobId: 'q_1', result: agentResultOut1() }, worker()))],
      ['cards', () => routes.cards.GET(get('/api/research/cards?jobId=q_1', bot()))],
      ['feedback', () => routes.feedback.POST(post('/api/research/feedback', { jobId: 'q_1', cardId: 'R1', vote: 'up', userId: 'u1' }, bot()))],
      ['status', () => routes.status.GET(get('/api/research/status'))],
    ];
    for (const [name, run] of cases) {
      const sb = freshSb();
      sb.failNext(50, { mode: name === 'cards' ? 'throw' : 'error' });
      const res = await run();
      const body = await res.json();
      assert.equal(res.status, 503, `${name}: ${JSON.stringify(body)}`);
      assert.equal(body.success, false);
      assert.equal(body.errorType, 'RESEARCH_STORAGE_UNAVAILABLE', name);
      assert.doesNotMatch(JSON.stringify(body), /SECRET/, `${name}: ห้ามส่งข้อความดิบจาก DB`);
    }
    globalThis.__RA_SB_READY = false;
    const notReady = await routes.status.GET(get('/api/research/status'));
    assert.equal(notReady.status, 503);
    globalThis.__RA_SB_READY = true;
  });
});

// ── /api/queue/add (ไฟล์ล็อก) ────────────────────────────────────
const QUEUE_HOOK_START = '\n\n    // ★ 1 ต.ค. 69 (Research Agent v2 · เลน B · SPEC-v2 ส่วน 1/2.1';
const QUEUE_HOOK_END = '    \n    // 4. Trigger the worker';

/** ซอร์ส /api/queue/add ที่ถอด hook รีเสิร์ชออก (= ต้นฉบับก่อนเลน B) */
function stripQueueAddHook(source) {
  const start = source.indexOf(QUEUE_HOOK_START);
  const end = source.indexOf(QUEUE_HOOK_END, start);
  assert.ok(start > 0 && end > start, 'ต้องพบบล็อก hook รีเสิร์ชใน queue/add');
  const stripped = `${source.slice(0, start)}\n${source.slice(end)}`;
  return replaceOnce(stripped, "import { NextResponse, after } from 'next/server';", "import { NextResponse } from 'next/server';", 'queue-add import');
}

function queueHarness() {
  const q = { enqueued: [], storeCalls: [], fetches: [], logs: [] };
  q.enqueueJob = async (payload, userId) => {
    q.enqueued.push({ payload: JSON.parse(JSON.stringify(payload)), userId });
    return { jobId: 'q_0123456789abcdef', position: 1, queuesAhead: 0, status: 'pending' };
  };
  q.createStore = (name) => ({
    add: async (item) => { q.storeCalls.push(['add', name, item.id?.replace(/\d{10,}.*$/, '<ts>')]); return item; },
    getAll: async () => { q.storeCalls.push(['getAll', name]); return []; },
    remove: async (id) => { q.storeCalls.push(['remove', name, id]); return { removed: true }; },
  });
  q.log = (name, level, text) => q.logs.push([level, text]);
  return q;
}

async function runQueueAdd(mod, payload, { headers = { 'x-api-key': 'test-key' } } = {}) {
  const q = queueHarness();
  globalThis.__RA_Q = q;
  globalThis.__RA_AFTER = [];
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  const realRandom = Math.random;
  Math.random = () => 0.5; // route เดิมสุ่ม prune msg-claims 3% + สุ่ม id ping — ตรึงค่าให้สองรอบที่เทียบกันเดินทางเดียวกัน
  const resolvedBefore = hooks.resolved.length;
  globalThis.fetch = async (url, init) => { q.fetches.push([String(url), init?.method, init?.headers?.['x-api-key'] ? 'key' : 'none']); return new Response('{}'); };
  globalThis.setTimeout = (fn, ms, ...args) => (ms === 3000 ? { fake3s: true } : realSetTimeout(fn, ms, ...args)); // เพดาน 3 วิของ route: ไม่ใช้นาฬิกาจริง
  try {
    const req = new Request('http://127.0.0.1:3963/api/queue/add', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) });
    const res = await mod.POST(req);
    return { status: res.status, body: await res.json(), q, after: globalThis.__RA_AFTER, researchImports: hooks.resolved.slice(resolvedBefore).filter((s) => s.startsWith('@/lib/research-agent/')) };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
    Math.random = realRandom;
  }
}

const NEWS_PAYLOAD = {
  input: 'ชาวสวีเดนสวมขาเทียม 1 ข้าง ช่วยชาวบ้านราชบุรีตักทรายใส่กระสอบรับมือน้ำขึ้นสูง สาวรายหนึ่งเล่าเรื่องราวสุดประทับใจ',
  contentLength: 'short', userId: 'discord-555', _botInstance: 'host_ab12', _msgId: '1290000000000000001',
  sourceUrls: ['https://www.facebook.com/someone/posts/1', 'not-a-url'],
};

async function assertQueueAddParity(currentMod, originalMod) {
  await withEnv({ TEXT_ONLY_MODE: '1', API_SECRET_KEY: 'test-key' }, async () => {
    for (const payload of [NEWS_PAYLOAD, { ...NEWS_PAYLOAD, jobType: 'cover', newsTitle: 'ปก', input: undefined }, { text: `ทำใหม่ ${NEWS_PAYLOAD.input}` }]) {
      freshSb();
      const now = await runQueueAdd(currentMod, payload);
      const before = await runQueueAdd(originalMod, payload);
      assert.deepEqual(now.body, before.body, 'คำตอบคิวต้องเหมือนต้นฉบับทุกไบต์เมื่อปิดสวิตช์');
      assert.equal(now.status, before.status);
      assert.deepEqual(now.q.enqueued, before.q.enqueued);
      assert.deepEqual(now.q.storeCalls, before.q.storeCalls);
      assert.deepEqual(now.q.fetches, before.q.fetches);
      assert.deepEqual(now.researchImports, [], 'ปิดสวิตช์ห้าม import โมดูลรีเสิร์ช');
      assert.equal(now.after.length, 0, 'ปิดสวิตช์ห้ามเรียก after()');
      assert.equal(globalThis.__RA_SB.calls.length, 0, 'ปิดสวิตช์ห้ามแตะ store รีเสิร์ช');
    }
  });
}

test('queue/add (ไฟล์ล็อก): ปิดสวิตช์ = เหมือนต้นฉบับทุกไบต์ (เทียบซอร์สที่ถอด hook) · ไม่ import/ไม่ after/ไม่แตะ store รีเสิร์ช', async () => {
  const current = await import(srcUrl('app/api/queue/add/route.js'));
  const original = await importSource(stripQueueAddHook(SOURCES.queueAdd), 'queue-add-original');
  assert.doesNotMatch(stripQueueAddHook(SOURCES.queueAdd), /research|after\(/i, 'ซอร์สต้นฉบับที่ถอดแล้วต้องไม่มี hook หลงเหลือ');
  await assertQueueAddParity(current, original);
});

test('queue/add: เปิดสวิตช์ = สร้างใบขอ research-requests หลังเข้าคิว (sourceUrls สะอาด · msgId) ผ่าน after() · ล้ม = คำตอบคิวเดิม · งานปกไม่สร้าง', async () => {
  const current = await import(srcUrl('app/api/queue/add/route.js'));
  await withEnv({ TEXT_ONLY_MODE: '1', API_SECRET_KEY: 'test-key', RESEARCH_AGENT: '1' }, async () => {
    const sb = freshSb();
    const off = await withEnv({ TEXT_ONLY_MODE: '1', API_SECRET_KEY: 'test-key' }, () => runQueueAdd(current, NEWS_PAYLOAD));
    const on = await runQueueAdd(current, NEWS_PAYLOAD);
    assert.deepEqual(on.body, off.body, 'คำตอบคิวไม่เปลี่ยนเมื่อเปิดสวิตช์');
    assert.equal(on.after.length, 1);
    await Promise.all(on.after.map((fn) => fn()));
    const doc = sb.doc('rreq_q_0123456789abcdef');
    assert.ok(doc, 'ต้องมีใบขอของ jobId นี้');
    assert.equal(doc.rawText, NEWS_PAYLOAD.input);
    assert.deepEqual(doc.sourceUrls, ['https://www.facebook.com/someone/posts/1']);
    assert.equal(doc.sourceMessageId, NEWS_PAYLOAD._msgId);
    assert.equal(doc.userId, 'discord-555');
    assert.equal(Date.parse(doc.deadlineAt) - Date.parse(doc.createdAt), 15 * 60_000, 'ไม่ตั้ง RESEARCH_AGENT_DEADLINE_MIN = 15 นาที');
    assert.equal(on.q.enqueued[0].payload.sourceUrls.length, 2, 'payload คิวไม่ถูกแก้ (ไม่กระทบ fingerprint/worker)');

    const sb25 = freshSb();
    await withEnv({ TEXT_ONLY_MODE: '1', API_SECRET_KEY: 'test-key', RESEARCH_AGENT: '1', RESEARCH_AGENT_DEADLINE_MIN: '25' }, async () => {
      const custom = await runQueueAdd(current, NEWS_PAYLOAD);
      await Promise.all(custom.after.map((fn) => fn()));
    });
    const doc25 = sb25.doc('rreq_q_0123456789abcdef');
    assert.equal(Date.parse(doc25.deadlineAt) - Date.parse(doc25.createdAt), 25 * 60_000, 'env RESEARCH_AGENT_DEADLINE_MIN บน Vercel ถึงใบขอ');

    const broken = freshSb();
    broken.failNext(5, { kind: 'insert' });
    const failed = await runQueueAdd(current, NEWS_PAYLOAD);
    await Promise.all(failed.after.map((fn) => fn()));
    assert.deepEqual([failed.status, failed.body], [on.status, on.body], 'สร้างใบขอล้ม = คำตอบคิวเดิม');
    assert.ok(failed.q.logs.some(([level, text]) => level === 'warn' && /research request skipped/.test(text)));
    assert.equal(broken.rows.size, 0);

    freshSb();
    const cover = await runQueueAdd(current, { jobType: 'cover', newsTitle: 'ปกข่าว', content: 'x' });
    assert.equal(cover.after.length, 0, 'งานปกไม่สร้างใบขอ');
  });
});

// ── mutation ─────────────────────────────────────────────────────
test('mutation: ทุบด่าน/สวิตช์แล้วข้อสอบต้องแดง (และของจริงเขียว)', async () => {
  // 1) secretMatches คืน true เสมอ → กุญแจผิดผ่านได้
  const mutatedHttp = replaceOnce(SOURCES.http, "  if (typeof given !== 'string' || typeof expected !== 'string' || !given || !expected) return false;\n  return timingSafeEqual(digest(given), digest(expected));",
    '  return true;', 'secretMatches');
  hooks.overrides.set('@/lib/research-agent/http', `data:text/javascript;base64,${Buffer.from(mutatedHttp).toString('base64')}`);
  try {
    const leaseMut = await importSource(SOURCES.lease, 'lease-mut-auth');
    await assert.rejects(assertWorkerAuth(leaseMut), 'secretMatches=true: ข้อสอบกุญแจต้องแดง');
    const cardsMut = await importSource(SOURCES.cards, 'cards-mut-auth');
    await assert.rejects(assertBotAuth(cardsMut), 'secretMatches=true: ข้อสอบกุญแจบอทต้องแดง');
  } finally {
    hooks.overrides.delete('@/lib/research-agent/http');
  }
  // 2) queue/add ถอดเงื่อนไข RESEARCH_AGENT → ปิดสวิตช์แล้วยังสร้างใบขอ
  const queueMut = await importSource(replaceOnce(SOURCES.queueAdd, '(process.env.RESEARCH_AGENT && _isNewsGenJob)', '(_isNewsGenJob)', 'queue gate'), 'queue-add-mut');
  const original = await importSource(stripQueueAddHook(SOURCES.queueAdd), 'queue-add-original-2');
  await assert.rejects(assertQueueAddParity(queueMut, original), 'ถอดสวิตช์: ข้อสอบ byte-parity ต้องแดง');
  // 3) เกณฑ์ online ไม่มีเพดานเวลา → worker ที่ตายแล้วยังนับ online
  const statusMut = await importSource(replaceOnce(SOURCES.status, 'online: known && nowMs - seenMs <= RESEARCH_AGENT_OFFLINE_AFTER_MS,', 'online: known,', 'online window'), 'status-mut');
  await assert.rejects(assertStatus(statusMut), 'online ไม่มีเพดาน: ข้อสอบต้องแดง');
  // 4) cards ส่งเอกสารเต็ม (tool_log) เสมอ
  const cardsMut = await importSource(replaceOnce(SOURCES.cards, '  if (full) return doc;', '  return doc;', 'cards full'), 'cards-mut-full');
  await assert.rejects(assertCardsShape(cardsMut), 'cards ส่ง tool_log เสมอ: ข้อสอบต้องแดง');
  // 5) report ไม่เช็คเจ้าของใบขอ (ตัดคำตอบ 409)
  const reportMut = await importSource(replaceOnce(SOURCES.report, "    if (outcome.outcome === 'lost') {", "    if (false) {", 'report lost'), 'report-mut');
  await assert.rejects(assertReportOwnership(reportMut), 'report ไม่ตอบ 409: ข้อสอบต้องแดง');
  // 6) lease กลับมาส่ง limits (contract-check #3)
  const leaseLimitsMut = await importSource(replaceOnce(SOURCES.lease, '    mode,\n  };\n}', '    mode,\n    limits: { maxCalls: 24 },\n  };\n}', 'lease limits'), 'lease-mut-limits');
  await assert.rejects(assertLeaseShape(leaseLimitsMut), 'lease ส่ง limits: ข้อสอบต้องแดง');
  // 7–10) heartbeat อ่านโควตา/เวอร์ชันไม่ครบทั้งสองรูป (contract-check #1 #2)
  const QUOTA_LINE = '    const quota = workerQuotaFromBody(parsed.body);';
  const VERSION_LINE = '    const version = workerVersionFrom(req, parsed.body);';
  const hbMutations = [
    ['ไม่อ่าน quota.remainingPct', QUOTA_LINE, '    const quota = workerQuotaFromBody({ account: parsed.body.account, quotaPct: parsed.body.quotaPct });'],
    ['ไม่อ่าน quotaPct ของ worker รุ่นแรก', QUOTA_LINE, '    const quota = workerQuotaFromBody({ account: parsed.body.account, quota: parsed.body.quota });'],
    ['version อ่านแต่ body', VERSION_LINE, '    const version = parsed.body.version;'],
    ['version อ่านแต่ header', VERSION_LINE, '    const version = workerVersionFrom(req, {});'],
  ];
  for (const [index, [label, search, replacement]] of hbMutations.entries()) {
    const hbMut = await importSource(replaceOnce(SOURCES.heartbeat, search, replacement, label), `heartbeat-mut-${index}`);
    await assert.rejects(assertHeartbeatContract(hbMut), `${label}: ข้อสอบต้องแดง`);
  }
  // ของจริงเขียว
  await assertWorkerAuth();
  await assertBotAuth();
  await assertStatus();
  await assertCardsShape();
  await assertReportOwnership();
  await assertLeaseShape();
  await assertHeartbeatContract();
  await assertQueueAddParity(await import(srcUrl('app/api/queue/add/route.js')), original);
});
