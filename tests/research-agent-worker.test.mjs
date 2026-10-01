// ============================================================
// 🧪 tests/research-agent-worker.test.mjs — worker เอเจนต์รีเสิร์ช (SPEC-v2 ส่วน 4 · 6 · 8 · ข้อ 16/17/18/19)
// ★ 1 ต.ค. 69 (research agent v2 เลน A) — HTTP ปลอม (fetch) + ตัวรัน Codex/API ปลอม + นาฬิกามือ (ไม่รอเวลาจริง ไม่มี unref)
// ตรวจ: ค่าตั้งเริ่มต้นตามสเปก · lease/heartbeat/report ผ่าน x-research-secret · ระเบียนตรงสัญญา 2.2 ·
//       โฟลเดอร์งาน (README/tools/TASK/out) · ยก medium ตามกติกา (บันทึกทุกครั้ง) · โควตา ≤15% เตือน ≤5% สลับ หมด = API ·
//       Codex ล้ม → สำรอง API · ข้ามงาน (ข่าวว่าง/เลยเส้นตาย) · ธงหยุด · ลองส่งซ้ำเฉพาะเน็ต/5xx/429 · log หมุนเวียน ·
//       retention โฟลเดอร์งาน · งบเครื่องมือรายเดือน · ไม่มีค่าความลับในระเบียน/log
// กลายพันธุ์ 5 แบบ (patch research-agent-worker.mjs จริงในโฟลเดอร์ชั่วคราว → ข้อตรวจต้องแดง)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importPatchedModule } from './helpers/temp-module.mjs';
import { settleWithin } from './helpers/fake-deadline.mjs';
import * as worker from '../scripts/research-agent-worker.mjs';
import * as browserLock from '../scripts/research-agent/browserLock.mjs';
import { validateCardRecord } from '../scripts/research-agent/schema.mjs';

const REAL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_URL = new URL('../scripts/research-agent-worker.mjs', import.meta.url);
const SRC = readFileSync(SRC_URL, 'utf8').replace(/\r\n/g, '\n');
const FIX = (name) => JSON.parse(readFileSync(new URL(`./fixtures/research-agent/${name}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const SECRET = 'test-secret-value-123456';
const OPENAI = 'sk-test-openai-key-0123456789';
const RAW = 'หัวข้อ: ชาวสวีเดนสวมขาเทียม ช่วยชาวบ้านราชบุรีตักทรายใส่กระสอบรับมือน้ำขึ้นสูง\nสาวรายหนึ่งเล่า เรื่องราวสุดประทับใจเกิดขึ้นที่ราชบุรี';
const NOW = Date.parse('2026-10-01T05:16:00.000Z');
const JOB = {
  id: 'q_0123456789abcdef', workflowId: 'unify_q_0123456789abcdef', rawText: RAW, sourceUrls: ['https://www.facebook.com/x/posts/1', 'javascript:alert(1)'],
  userId: 'discord-1', status: 'leased', attempt: 1, createdAt: '2026-10-01T05:15:38.248Z', deadlineAt: '2026-10-01T05:22:38.248Z',
};

async function mutant(find, replace, name) {
  assert.ok(SRC.includes(find), `ไม่พบจุดกลายพันธุ์ ${name}`);
  const patched = SRC.replace(find, replace).split('import.meta.url').join(JSON.stringify(SRC_URL.href));
  return importPatchedModule(patched, SRC_URL, `ra-worker-${name}`);
}
const LOCK_URL = new URL('../scripts/research-agent/browserLock.mjs', import.meta.url);
const LOCK_SRC = readFileSync(LOCK_URL, 'utf8').replace(/\r\n/g, '\n');
async function lockMutant(find, replace, name) {
  assert.ok(LOCK_SRC.includes(find), `ไม่พบจุดกลายพันธุ์ ${name}`);
  return importPatchedModule(LOCK_SRC.replace(find, replace), LOCK_URL, `ra-lock-${name}`);
}
/** promise ที่เทสปลดเอง (ไม่พึ่ง timer) */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
/** วนผ่าน setImmediate จนเงื่อนไขจริง (ไม่ใช้ timer) · settleWithin กันค้างแบบแดงข้อเดียว · หมดเวลาแล้ววงวนต้องหยุดด้วย */
async function until(cond, label, ms = 2_000) {
  let alive = true;
  try {
    await settleWithin((async () => {
      while (alive && !cond()) await new Promise((r) => setImmediate(r)); // eslint-disable-line no-await-in-loop -- รอสัญญาณทีละรอบ
    })(), label, ms);
  } finally { alive = false; }
}

function setup(mod = worker, envOverrides = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'ra-worker-'));
  const env = {
    RESEARCH_AGENT_API_BASE: 'http://localhost:3999', RESEARCH_AGENT_SECRET: SECRET, RESEARCH_AGENT_WORKER_ID: 'w1',
    RESEARCH_AGENT_WORKDIR: join(tmp, 'work'), OPENAI_API_KEY: OPENAI, ...envOverrides,
  };
  const cfg = mod.loadConfig(env, { repoRoot: REAL_ROOT });
  cfg.logDir = join(tmp, 'logs');
  cfg.stopFile = join(cfg.logDir, 'research-agent.stop');
  cfg.browserLockFile = join(tmp, 'browser.lock'); // ห้ามแตะล็อกจริงใต้ temp ของเครื่อง (worker จริงอาจรันอยู่)
  return { tmp, env, cfg, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}
function clock(start = NOW) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
function codexStub(results, c) {
  const calls = [];
  const depsCalls = [];
  const fn = async (p, d) => {
    calls.push(p);
    depsCalls.push(d);
    const r = results[Math.min(calls.length - 1, results.length - 1)];
    if (c) c.advance(90_000);
    return typeof r === 'function' ? r(p) : r;
  };
  fn.calls = calls;
  fn.depsCalls = depsCalls;
  return fn;
}
const okCodex = (json, extra = {}) => ({ ok: true, brain: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'main', json, tokensUsed: 5000, elapsedMs: 90_000, timedOut: false, warning: null, ...extra });
const quotaStub = (map = {}) => async (name) => map[name] || { account: name, status: 'OK', remainingPct: 80 };
function everyStub() {
  const reg = [];
  const every = (ms, fn) => { const r = { ms, fn, stopped: false }; reg.push(r); return () => { r.stopped = true; }; };
  every.reg = reg;
  return every;
}
function collectLog() {
  const lines = [];
  const log = (level, msg) => lines.push(`${level} ${msg}`);
  log.lines = lines;
  return log;
}
const HARD_EMPTY = {
  complexity: 'สูง',
  plan: [{ question: 'ต้นทางคือโพสต์ใด', why_valuable: 'กันข่าวเก่า', decided: 'ค้น', reason: 'ไม่มีลิงก์' }],
  origin_post: { url: null, source_name: '', date: 'ไม่ทราบ', confidence: 0 },
  story_date_estimate: 'ไม่ทราบ', stale_news_warning: null, cards: [], raw_corrections: [], flags: ['ORIGIN_NOT_FOUND'], skipped: [],
  tool_log: [{ tool: 'serper', args: 'ขาเทียม ราชบุรี', ok: true, note: 'ไม่พบ', ms: 900 }, { tool: 'serper', args: 'สวีเดน ทราย', ok: true, note: 'ไม่พบ', ms: 800 }],
};
/** ตัวกันพลาด: ทุกเส้นที่ไม่ได้ฉีดตัวปลอมไว้ต้อง "ล้มดังๆ" แทนการเรียก Codex/API/โควตาจริง (เทสห้ามยิงของจริงเด็ดขาด) */
const NO_REAL = Object.freeze({
  runCodex: async () => { throw new Error('เทสห้ามเรียก Codex จริง'); },
  runApi: async () => { throw new Error('เทสห้ามเรียก API จริง'); },
  readQuota: async () => { throw new Error('เทสห้ามอ่านโควตาจริง'); },
});
function processCtx(s, deps, extra = {}) {
  return { cfg: s.cfg, env: s.env, state: { cooldown: {} }, deps: { ...NO_REAL, log: collectLog(), every: everyStub(), heartbeat: async () => ({}), ...deps }, ...extra };
}

/** fetch ปลอมของ route เลน B */
function apiFetch({ leaseJobs = [], report = [200], heartbeat = 200 } = {}) {
  const calls = [];
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const impl = async (u, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(u), headers: init.headers, body });
    if (String(u).endsWith('/api/research/lease')) return resp(200, { success: true, job: leaseJobs.length ? leaseJobs.shift() : null });
    if (String(u).endsWith('/api/research/heartbeat')) return resp(heartbeat, heartbeat === 200 ? { success: true } : { success: false, error: 'x' });
    if (String(u).endsWith('/api/research/report')) {
      const st = report.length > 1 ? report.shift() : report[0];
      if (st === 0) throw new Error('fetch failed');
      return resp(st, st === 200 ? { success: true } : { success: false, error: 'บอกไม่ได้', errorType: 'X' });
    }
    throw new Error(`route ไม่รู้จัก ${u}`);
  };
  return { impl, calls };
}

// ── ข้อตรวจที่ใช้ซ้ำ ──
async function checkStopFlag(mod) {
  const s = setup(mod);
  try {
    mkdirSync(s.cfg.logDir, { recursive: true });
    writeFileSync(s.cfg.stopFile, 'stop');
    const f = apiFetch({ leaseJobs: [JOB] });
    const api = mod.createApi({ apiBase: s.cfg.apiBase, secret: s.cfg.secret, workerId: s.cfg.workerId, fetchImpl: f.impl, sleep: async () => {} });
    const why = await settleWithin(mod.workerLoop({ cfg: s.cfg, api, env: s.env, once: true, deps: { ...NO_REAL, sleep: async () => {}, log: collectLog(), every: everyStub(), now: () => NOW } }), 'stop');
    assert.equal(why, 'stopped');
    assert.equal(f.calls.length, 0, 'มีธงหยุด = ห้ามขอรับงานใหม่');
  } finally { s.cleanup(); }
}
async function checkEscalationOnlyWhenHard(mod) {
  const s = setup(mod);
  try {
    const c = clock();
    const normal = { ...HARD_EMPTY, complexity: 'กลาง' };
    const runCodex = codexStub([okCodex(normal), okCodex(FIX('lab-out-result.json'))], c);
    const { record } = await settleWithin(mod.processJob(JOB, processCtx(s, { runCodex, readQuota: quotaStub(), now: c.now })), 'no-escalate');
    assert.equal(runCodex.calls.length, 1, 'ข่าวไม่ยาก = ห้ามยก medium');
    assert.equal(record.brain.effort, 'low');
  } finally { s.cleanup(); }
}
async function checkHeartbeat(mod) {
  const s = setup(mod);
  try {
    const c = clock();
    const beats = [];
    const every = everyStub();
    const ctx = processCtx(s, { runCodex: codexStub([okCodex(FIX('lab-out-result.json'))], c), readQuota: quotaStub(), now: c.now, every, heartbeat: async (id, extra) => { beats.push({ id, extra }); return {}; } });
    await settleWithin(mod.processJob(JOB, ctx), 'heartbeat');
    assert.ok(beats.length >= 1, 'ต้องส่ง heartbeat ทันทีที่เริ่มงาน');
    assert.equal(beats[0].id, JOB.id);
    assert.equal(every.reg.length, 1);
    assert.equal(every.reg[0].ms, 30_000, 'heartbeat ทุก 30 วิ');
    assert.equal(every.reg[0].stopped, true, 'จบงานต้องหยุด heartbeat');
  } finally { s.cleanup(); }
}
async function checkQuotaSwitch(mod) {
  const s = setup(mod, { RESEARCH_AGENT_CODEX_ACCOUNTS: 'main,b' });
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(FIX('lab-out-result.json'))], c);
    const { record } = await settleWithin(mod.processJob(JOB, processCtx(s, {
      runCodex, now: c.now,
      readQuota: quotaStub({ main: { account: 'main', status: 'OK', remainingPct: 3 }, b: { account: 'b', status: 'OK', remainingPct: 40 } }),
    })), 'quota');
    assert.equal(runCodex.calls[0].account, 'b', 'main เหลือ ≤5% → ต้องสลับไป b');
    assert.equal(record.brain.account, 'b');
    assert.ok(!record.flags.includes('QUOTA_LOW'));
  } finally { s.cleanup(); }
}
/** สัญญา body กับ route เลน B (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69 · contract-check mismatch #1 #2) */
async function checkProtocolBodies(mod) {
  const s = setup(mod);
  try {
    const c = clock();
    const f = apiFetch({ leaseJobs: [JOB] });
    const api = mod.createApi({ apiBase: s.cfg.apiBase, secret: s.cfg.secret, workerId: s.cfg.workerId, fetchImpl: f.impl, sleep: async () => {} });
    const deps = { ...NO_REAL, runCodex: codexStub([okCodex(FIX('lab-out-result.json'))], c), readQuota: quotaStub(), now: c.now, log: collectLog(), every: everyStub(), sleep: async () => {} };
    assert.equal(await settleWithin(mod.workerLoop({ cfg: s.cfg, api, env: s.env, once: true, deps }), 'protocol'), 'done');
    const lease = f.calls.find((x) => x.url.endsWith('/api/research/lease'));
    const beat = f.calls.find((x) => x.url.endsWith('/api/research/heartbeat'));
    assert.deepEqual(lease.body, { workerId: 'w1', version: mod.PROTOCOL }, 'lease = {workerId, version}');
    assert.deepEqual(beat.body, { jobId: JOB.id, workerId: 'w1', version: mod.PROTOCOL, account: 'main', quota: { remainingPct: 80 } },
      'heartbeat = {jobId, workerId, version, account, quota:{remainingPct}} (route B อ่าน body.quota?.remainingPct)');
    // ไม่รู้บัญชี/โควตา (โหมด API) = ไม่ส่งช่องนั้น · ช่องแปลกปลอมถูกทิ้ง
    const f2 = apiFetch();
    const api2 = mod.createApi({ apiBase: s.cfg.apiBase, secret: s.cfg.secret, workerId: 'w1', fetchImpl: f2.impl, sleep: async () => {} });
    await api2.heartbeat(JOB.id, { remainingPct: null, quotaPct: 50, evil: 'x' });
    assert.deepEqual(f2.calls[0].body, { jobId: JOB.id, workerId: 'w1', version: mod.PROTOCOL });
  } finally { s.cleanup(); }
}
async function checkNoRetryOn4xx(mod) {
  const f = apiFetch({ report: [400] });
  const api = mod.createApi({ apiBase: 'http://localhost:3999', secret: SECRET, workerId: 'w1', fetchImpl: f.impl, sleep: async () => {} });
  await assert.rejects(() => api.report('q_1', { x: 1 }), (e) => e.status === 400);
  assert.equal(f.calls.length, 1, '4xx = ห้ามลองซ้ำ (กันส่งผลซ้ำ/ทับ)');
}

test('1. ค่าตั้งเริ่มต้นตามสเปก 2.5 · RESEARCH_AGENT_TOOLS จำกัดเครื่องมือ/เบราว์เซอร์ · ตรวจค่าตั้งบังคับ', () => {
  const c = worker.loadConfig({}, { repoRoot: REAL_ROOT });
  assert.equal(c.maxCalls, 24);
  assert.equal(c.maxMinutes, 6);
  assert.equal(c.effort, 'low');
  assert.equal(c.allowMedium, true);
  assert.equal(c.brain, 'codex');
  assert.equal(c.quotaAlertPct, 15);
  assert.equal(c.toolBudgetUsdMonth, 10);
  assert.equal(c.mode, 'shadow');
  assert.equal(c.tools.length, 12);
  assert.equal(c.browser, true);
  assert.deepEqual(c.accounts, ['main']);
  assert.equal(c.heartbeatMs, 30_000);
  assert.equal(c.idleMs, 10_000, 'ว่าง = ถามงานทุก 10 วิ');
  assert.equal(worker.loadConfig({ RESEARCH_AGENT_IDLE_MS: '500' }, { repoRoot: REAL_ROOT }).idleMs, 1000, 'ไม่ต่ำกว่า 1 วิ');
  assert.ok(c.workdirRoot.startsWith(tmpdir()), 'โฟลเดอร์งานอยู่นอก repo (กัน Codex โหลด AGENTS.md ของโปรเจกต์)');
  const r = worker.loadConfig({ RESEARCH_AGENT_TOOLS: 'serper, wiki ,nope', RESEARCH_AGENT_ALLOW_MEDIUM: '0', RESEARCH_AGENT_BRAIN: 'api', RESEARCH_AGENT_MAX_CALLS: '999', RESEARCH_AGENT_MODE: 'assist' }, { repoRoot: REAL_ROOT });
  assert.deepEqual(r.tools, ['serper', 'wiki']);
  assert.equal(r.browser, false);
  assert.equal(r.restrictedTools, true);
  assert.equal(r.allowMedium, false);
  assert.equal(r.brain, 'api');
  assert.equal(r.maxCalls, 80, 'เพดานสูงสุด');
  assert.equal(r.mode, 'assist');
  assert.equal(worker.loadConfig({ RESEARCH_AGENT_TOOLS: 'serper,browser' }, { repoRoot: REAL_ROOT }).browser, true);
  assert.equal(worker.configProblems(c).length, 2);
  assert.match(worker.configProblems({ ...c, secret: 'x', apiBase: 'http://example.com' }).join(' '), /localhost/);
  assert.deepEqual(worker.configProblems({ ...c, secret: 'x', apiBase: 'https://example.com' }), []);
  assert.deepEqual(worker.configProblems({ ...c, secret: 'x', apiBase: 'http://localhost:3000' }), []);
  assert.equal(c.codexBin, 'codex');
  assert.match(worker.configProblems({ ...c, secret: 'x', apiBase: 'https://example.com', codexBin: 'codex & calc' }).join(' '), /CODEX_BIN/);
  assert.deepEqual(worker.configProblems({ ...c, secret: 'x', apiBase: 'https://example.com', codexBin: 'C:\\Program Files\\codex\\codex.cmd' }), []);
  // ข้อตัดสินผู้คุมงาน 1 ต.ค. 69: ทำขนาน (ค่าเริ่มต้น 2 · เพดาน 4) · เกณฑ์ข่าวเก่า env (ค่าเริ่มต้น 7) · ล็อกเบราว์เซอร์ใต้ temp ของผู้ใช้
  assert.equal(c.concurrency, 2, 'ไม่ตั้ง = รับพร้อมกัน 2 งาน');
  assert.equal(worker.loadConfig({ RESEARCH_AGENT_CONCURRENCY: '1' }, { repoRoot: REAL_ROOT }).concurrency, 1);
  assert.equal(worker.loadConfig({ RESEARCH_AGENT_CONCURRENCY: '99' }, { repoRoot: REAL_ROOT }).concurrency, worker.MAX_CONCURRENCY);
  assert.equal(worker.loadConfig({ RESEARCH_AGENT_CONCURRENCY: '0' }, { repoRoot: REAL_ROOT }).concurrency, 1);
  assert.equal(c.staleDays, 7, 'ไม่ตั้ง = ข่าวเก่ากว่า 7 วัน');
  assert.equal(worker.loadConfig({ RESEARCH_AGENT_STALE_DAYS: '3' }, { repoRoot: REAL_ROOT }).staleDays, 3);
  assert.equal(worker.loadConfig({ RESEARCH_AGENT_STALE_DAYS: 'x' }, { repoRoot: REAL_ROOT }).staleDays, 7);
  assert.equal(c.browserLockFile, join(tmpdir(), 'research-agent-browser.lock'), 'ล็อกเดียวต่อผู้ใช้ (ไม่ผูก WORKDIR)');
  assert.equal(c.browserLockStaleMs, ((6 + 1) * 2 + 5) * 60_000, 'ล็อกค้าง = นานกว่ารอบ low+medium + 5 นาที');
  // --check บอกว่า .env.local มีคีย์ของ web-agent ไหม (คืน true/false เท่านั้น ไม่คืนค่า)
  const root = mkdtempSync(join(tmpdir(), 'ra-envl-'));
  try {
    writeFileSync(join(root, '.env.local'), 'OPENAI_API_KEY=sk-test-0123456789\nEMPTY_ONE=\n');
    assert.equal(worker.envLocalHas('OPENAI_API_KEY', { repoRoot: root }), true);
    assert.equal(worker.envLocalHas('EMPTY_ONE', { repoRoot: root }), false);
    assert.equal(worker.envLocalHas('OPENAI_API_KEY', { repoRoot: join(root, 'ไม่มี') }), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('2. งานปกติ (fixture out): ระเบียนตรงสัญญา 2.2 · โฟลเดอร์งานครบ · ใบงานมีข่าวดิบ · เพดานเวลาไม่เกินเส้นตาย', async () => {
  const s = setup();
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(FIX('lab-out-result.json'))], c);
    const { record, summary } = await settleWithin(worker.processJob(JOB, processCtx(s, { runCodex, readQuota: quotaStub(), now: c.now })), 'process');
    assert.deepEqual(validateCardRecord(record), []);
    assert.equal(record.id, JOB.id);
    assert.equal(record.status, 'done');
    assert.equal(record.mode, 'shadow');
    assert.deepEqual(record.brain, { kind: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'main', quotaPctAfter: 80 });
    assert.equal(record.cards.length, 1);
    assert.equal(record.cards[0].gate, 'pass');
    assert.deepEqual(record.flags, ['ORIGIN_NOT_FOUND']);
    assert.equal(record.usage.tool_calls, 12);
    assert.equal(record.usage.minutes, 1.5);
    assert.equal(record.usage.codexTokens, 5000);
    assert.equal(summary.status, 'done');
    const call = runCodex.calls[0];
    const wd = join(s.cfg.workdirRoot, JOB.id);
    assert.equal(call.workdir, wd);
    assert.equal(call.effort, 'low');
    assert.equal(call.account, 'main');
    assert.deepEqual(runCodex.depsCalls[0], { bin: 'codex' }, 'ค่าเริ่มต้น = codex ใน PATH');
    assert.equal(call.repoRoot, s.cfg.repoRoot, 'ส่งรากโปรเจกต์ให้เครื่องมือหา .env.local');
    assert.equal(worker.REPO_ROOT, REAL_ROOT.replace(/[\\/]+$/, ''), 'รากโปรเจกต์ของ worker = โฟลเดอร์เหนือ scripts/');
    assert.ok(call.timeoutMs <= 7 * 60_000 && call.timeoutMs > 6 * 60_000, `timeout ${call.timeoutMs}`);
    assert.ok(call.prompt.includes(RAW));
    assert.ok(call.prompt.includes('https://www.facebook.com/x/posts/1'));
    assert.ok(!call.prompt.includes('javascript:alert'), 'ลิงก์ที่ไม่ใช่ http(s) ถูกกรอง');
    assert.equal(readFileSync(join(wd, 'TASK.txt'), 'utf8').replace(/\r\n/g, '\n'), call.prompt);
    assert.ok(existsSync(join(wd, 'README-TOOLS.md')));
    assert.ok(existsSync(join(wd, 'out')));
    assert.ok(existsSync(join(wd, 'tools', 'serper.mjs')), 'tools/ ใช้งานได้ (junction หรือสำเนา)');
    assert.ok(existsSync(join(s.cfg.logDir, `tool-spend-${new Date(NOW).toISOString().slice(0, 7)}.json`)));
  } finally { s.cleanup(); }
});

test('2b. fixture out2 (การ์ดอ้างเพจเราเอง · เรียกเกินงบ) → staff_only ทุกใบ + OVER_BUDGET · ไม่ยก medium (ไม่ได้ประเมินว่ายาก)', async () => {
  const s = setup();
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(FIX('lab-out2-result.json'))], c);
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s, { runCodex, readQuota: quotaStub(), now: c.now })), 'out2');
    assert.deepEqual(validateCardRecord(record), []);
    assert.equal(record.status, 'done');
    assert.equal(record.cards.length, 3);
    assert.ok(record.cards.every((card) => card.gate === 'staff_only' && /OWN_PAGE_SOURCE/.test(card.gate_reason)));
    assert.ok(record.flags.includes('ORIGIN_NOT_FOUND') && record.flags.includes('OVER_BUDGET'));
    assert.equal(record.usage.tool_calls, 25);
    assert.equal(runCodex.calls.length, 1);
  } finally { s.cleanup(); }
});

test('3. ยก medium: ข่าวยาก + ผล low ว่าง/ไม่พบต้นทาง + เวลาเหลือ → รันซ้ำ medium · บันทึก brain.effort + tool_log', async () => {
  const s = setup();
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(HARD_EMPTY), okCodex(FIX('lab-out-result.json'), { effort: 'medium' })], c);
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s, { runCodex, readQuota: quotaStub(), now: c.now })), 'escalate');
    assert.equal(runCodex.calls.length, 2);
    assert.deepEqual(runCodex.calls.map((x) => x.effort), ['low', 'medium']);
    assert.match(runCodex.calls[1].prompt, /## รอบก่อนหน้า \(effort low\)/);
    assert.match(runCodex.calls[1].prompt, /ระดับความคิดรอบนี้: medium/);
    assert.ok(runCodex.calls[1].timeoutMs < runCodex.calls[0].timeoutMs, 'รอบ medium ใช้เวลาที่เหลือ');
    assert.equal(record.brain.effort, 'medium');
    assert.equal(record.cards.length, 1, 'ใช้ผลรอบ medium ที่ดีกว่า');
    const note = record.tool_log.find((t) => t.tool === 'worker' && t.args === 'effort low→medium');
    assert.ok(note, 'ต้องบันทึกการยก medium ทุกครั้ง');
    assert.match(note.note, /ใช้ผลรอบ medium/);
    assert.equal(record.usage.tool_calls, 2 + 12, 'นับเครื่องมือทั้งสองรอบ');
    assert.deepEqual(validateCardRecord(record), []);
    assert.ok(existsSync(join(s.cfg.workdirRoot, JOB.id, 'TASK-medium.txt')));
  } finally { s.cleanup(); }
});

test('4. ไม่ยก medium เมื่อ: ข่าวไม่ยาก · ปิดสวิตช์ · เวลาเหลือน้อย', async () => {
  await checkEscalationOnlyWhenHard(worker);
  const s = setup(worker, { RESEARCH_AGENT_ALLOW_MEDIUM: '0' });
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(HARD_EMPTY)], c);
    await settleWithin(worker.processJob(JOB, processCtx(s, { runCodex, readQuota: quotaStub(), now: c.now })), 'off');
    assert.equal(runCodex.calls.length, 1);
  } finally { s.cleanup(); }
  const s2 = setup();
  try {
    const c = clock(Date.parse('2026-10-01T05:21:30.000Z')); // เหลือ ~68 วิก่อนเส้นตาย
    const runCodex = codexStub([okCodex(HARD_EMPTY)], null);
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s2, { runCodex, readQuota: quotaStub(), now: c.now })), 'late');
    assert.equal(runCodex.calls.length, 1);
    assert.ok(runCodex.calls[0].timeoutMs <= 68_248 - 5000 + 1, 'เพดานเวลาไม่เกินเส้นตายของงาน');
    assert.equal(record.brain.effort, 'low');
  } finally { s2.cleanup(); }
});

test('5. โควตา: ≤5% สลับบัญชี · ≤15% ธง QUOTA_LOW · ทุกบัญชีหมด → โหมด API + API_FALLBACK', async () => {
  await checkQuotaSwitch(worker);
  const s = setup(worker, { RESEARCH_AGENT_CODEX_ACCOUNTS: 'main,b' });
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(FIX('lab-out-result.json'))], c);
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s, {
      runCodex, now: c.now, readQuota: quotaStub({ main: { account: 'main', status: 'OK', remainingPct: 12 } }),
    })), 'low');
    assert.ok(record.flags.includes('QUOTA_LOW'));
    assert.equal(record.brain.quotaPctAfter, 12);
  } finally { s.cleanup(); }
  const s2 = setup(worker, { RESEARCH_AGENT_CODEX_ACCOUNTS: 'main,b' });
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(FIX('lab-out-result.json'))], c);
    const apiCalls = [];
    const runApi = async (p) => { apiCalls.push(p); c.advance(60_000); return { ok: true, brain: 'api', effort: 'low', account: 'api', json: FIX('lab-out-result.json'), costUsd: 0.12, tokensUsed: 9000 }; };
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s2, {
      runCodex, runApi, now: c.now,
      readQuota: quotaStub({ main: { account: 'main', status: 'FULL', remainingPct: 0 }, b: { account: 'b', status: 'OK', remainingPct: 2 } }),
    })), 'api');
    assert.equal(runCodex.calls.length, 0);
    assert.equal(apiCalls.length, 1);
    assert.equal(apiCalls[0].apiKey, OPENAI);
    assert.match(apiCalls[0].prompt, /web_search/);
    assert.equal(record.brain.kind, 'api');
    assert.equal(record.brain.account, 'api');
    assert.ok(record.flags.includes('QUOTA_LOW') && record.flags.includes('API_FALLBACK'));
    assert.ok(record.usage.costUsd >= 0.12, 'ค่า API จริงถูกบวกเข้า usage');
    assert.deepEqual(validateCardRecord(record), []);
  } finally { s2.cleanup(); }
});

test('6. Codex ล้ม → สำรอง API (มีคีย์) · ไม่มีคีย์ = failed + AGENT_FAILED · โควตาหมดกลางงาน = พักบัญชี', async () => {
  const s = setup();
  try {
    const c = clock();
    const runCodex = codexStub([{ ok: false, errorType: 'CODEX_UNAVAILABLE', error: 'ไม่พบ codex', json: null }], c);
    const runApi = async () => ({ ok: true, json: FIX('lab-out-result.json'), costUsd: 0.05 });
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s, { runCodex, runApi, readQuota: quotaStub(), now: c.now })), 'fallback');
    assert.equal(record.status, 'done');
    assert.equal(record.brain.kind, 'api');
    assert.ok(record.flags.includes('API_FALLBACK') && record.flags.includes('BRAIN_UNAVAILABLE'));
    assert.ok(record.tool_log.some((t) => t.tool === 'worker' && /CODEX_UNAVAILABLE/.test(t.note)));
  } finally { s.cleanup(); }
  const s2 = setup(worker, { OPENAI_API_KEY: '' });
  try {
    const c = clock();
    const state = { cooldown: {} };
    const runCodex = codexStub([{ ok: false, errorType: 'CODEX_QUOTA', error: 'usage limit', json: null }], c);
    const ctx = processCtx(s2, { runCodex, readQuota: quotaStub(), now: c.now });
    ctx.state = state;
    const { record } = await settleWithin(worker.processJob(JOB, ctx), 'nokey');
    assert.equal(record.status, 'failed');
    assert.ok(record.flags.includes('AGENT_FAILED'));
    assert.deepEqual(validateCardRecord(record), []);
    assert.ok(state.cooldown.main > c.now(), 'บัญชีโควตาหมดถูกพัก');
  } finally { s2.cleanup(); }
});

test('6b. ผลผิดสัญญา 2.2 (ขาด plan/origin_post) = failed ไม่ใช่ done (ด่าน 1) · มีคีย์ = ลองสำรอง API', async () => {
  const s = setup(worker, { OPENAI_API_KEY: '' });
  try {
    const c = clock();
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s, { runCodex: codexStub([okCodex({ cards: [], tool_log: [] })], c), readQuota: quotaStub(), now: c.now })), 'bad-schema');
    assert.equal(record.status, 'failed');
    assert.ok(record.flags.includes('AGENT_FAILED'));
    assert.ok(record.tool_log.some((t) => t.tool === 'worker' && /ผลผิดสัญญา 2\.2/.test(t.note)));
    assert.deepEqual(validateCardRecord(record), []);
  } finally { s.cleanup(); }
  const s2 = setup();
  try {
    const c = clock();
    const apiCalls = [];
    const runApi = async (p) => { apiCalls.push(p); return { ok: true, json: FIX('lab-out-result.json'), costUsd: 0.02 }; };
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s2, { runCodex: codexStub([okCodex({ cards: [] })], c), runApi, readQuota: quotaStub(), now: c.now })), 'bad-schema-api');
    assert.equal(apiCalls.length, 1);
    assert.equal(record.status, 'done');
    assert.equal(record.brain.kind, 'api');
  } finally { s2.cleanup(); }
});

test('7. ข้ามงาน: ข่าวดิบว่าง → skipped EMPTY_RAW · เลยเส้นตาย → skipped DEADLINE_PASSED · jobId ผิดรูป → ไม่รายงาน', async () => {
  const s = setup();
  try {
    const runCodex = codexStub([okCodex(HARD_EMPTY)]);
    const a = await worker.processJob({ ...JOB, rawText: '   ' }, processCtx(s, { runCodex, readQuota: quotaStub(), now: () => NOW }));
    assert.equal(a.record.status, 'skipped');
    assert.deepEqual(a.record.flags, ['EMPTY_RAW']);
    assert.deepEqual(validateCardRecord(a.record), []);
    const b = await worker.processJob(JOB, processCtx(s, { runCodex, readQuota: quotaStub(), now: () => Date.parse('2026-10-01T05:22:30.000Z') }));
    assert.equal(b.record.status, 'skipped');
    assert.deepEqual(b.record.flags, ['DEADLINE_PASSED']);
    const c = await worker.processJob({ ...JOB, id: '../../etc' }, processCtx(s, { runCodex, readQuota: quotaStub(), now: () => NOW }));
    assert.equal(c.record, null);
    assert.equal(runCodex.calls.length, 0);
  } finally { s.cleanup(); }
});

test('8. ลูป: lease → heartbeat → report (x-research-secret · {jobId, workerId, result}) · ไม่มีงาน = idle · ธงหยุด = ไม่ขอรับงาน', async () => {
  await checkStopFlag(worker);
  await checkHeartbeat(worker);
  await checkProtocolBodies(worker);
  const s = setup();
  try {
    const c = clock();
    const f = apiFetch({ leaseJobs: [JOB] });
    const api = worker.createApi({ apiBase: s.cfg.apiBase, secret: s.cfg.secret, workerId: s.cfg.workerId, fetchImpl: f.impl, sleep: async () => {} });
    const deps = { ...NO_REAL, runCodex: codexStub([okCodex(FIX('lab-out-result.json'))], c), readQuota: quotaStub(), now: c.now, log: collectLog(), every: everyStub(), sleep: async () => {} };
    const why = await settleWithin(worker.workerLoop({ cfg: s.cfg, api, env: s.env, once: true, deps }), 'loop');
    assert.equal(why, 'done');
    const routes = f.calls.map((x) => x.url.replace('http://localhost:3999', ''));
    assert.deepEqual(routes, ['/api/research/lease', '/api/research/heartbeat', '/api/research/report']);
    for (const call of f.calls) {
      assert.equal(call.headers['x-research-secret'], SECRET);
      assert.equal(call.headers['x-research-worker-version'], worker.PROTOCOL);
    }
    assert.deepEqual(f.calls[0].body, { workerId: 'w1', version: worker.PROTOCOL });
    assert.equal(f.calls[1].body.jobId, JOB.id);
    assert.equal(f.calls[1].body.workerId, 'w1');
    assert.equal(f.calls[1].body.version, worker.PROTOCOL);
    const rep = f.calls[2].body;
    assert.deepEqual(Object.keys(rep).sort(), ['jobId', 'result', 'workerId']);
    assert.equal(rep.jobId, JOB.id);
    assert.deepEqual(validateCardRecord(rep.result), []);
    const idle = await settleWithin(worker.workerLoop({ cfg: s.cfg, api, env: s.env, once: true, deps }), 'idle');
    assert.equal(idle, 'idle');
  } finally { s.cleanup(); }
});

test('9. ส่งผล: ลองซ้ำเฉพาะเน็ต/5xx/429 (≤3) · 4xx ไม่ลองซ้ำ · ส่งไม่สำเร็จไม่ทำให้ลูปพัง', async () => {
  const f = apiFetch({ report: [503, 0, 200] });
  const sleeps = [];
  const api = worker.createApi({ apiBase: 'http://localhost:3999', secret: SECRET, workerId: 'w1', fetchImpl: f.impl, sleep: async (ms) => { sleeps.push(ms); } });
  await settleWithin(api.report('q_1', { x: 1 }), 'retry');
  assert.equal(f.calls.length, 3);
  assert.deepEqual(sleeps, [500, 1000]);
  await checkNoRetryOn4xx(worker);
  const s = setup();
  try {
    const c = clock();
    const bad = apiFetch({ leaseJobs: [JOB], report: [500] });
    const api2 = worker.createApi({ apiBase: s.cfg.apiBase, secret: s.cfg.secret, workerId: 'w1', fetchImpl: bad.impl, sleep: async () => {} });
    const log = collectLog();
    const why = await settleWithin(worker.workerLoop({ cfg: s.cfg, api: api2, env: s.env, once: true, deps: { ...NO_REAL, runCodex: codexStub([okCodex(FIX('lab-out-result.json'))], c), readQuota: quotaStub(), now: c.now, log, every: everyStub(), sleep: async () => {} } }), 'report-fail');
    assert.equal(why, 'done');
    assert.equal(bad.calls.filter((x) => x.url.endsWith('/report')).length, 3);
    assert.ok(log.lines.some((l) => /ส่งผลงาน .* ไม่สำเร็จ/.test(l)));
  } finally { s.cleanup(); }
});

test('10. ไม่มีค่าความลับในระเบียน/log แม้เอเจนต์พิมพ์ออกมา', async () => {
  const s = setup();
  try {
    const c = clock();
    const leaky = FIX('lab-out-result.json');
    leaky.fact_cards[0].claim += ` ${SECRET}`;
    leaky.tool_log.push({ tool: 'exec_command', args: `echo ${OPENAI}`, ok: true, note: `secret=${SECRET}` });
    const log = collectLog();
    const ctx = processCtx(s, { runCodex: codexStub([okCodex(leaky)], c), readQuota: quotaStub(), now: c.now, log });
    const { record } = await settleWithin(worker.processJob(JOB, ctx), 'leak');
    const blob = JSON.stringify(record);
    assert.ok(!blob.includes(SECRET) && !blob.includes(OPENAI));
    assert.ok(!log.lines.join('\n').includes(SECRET));
    assert.deepEqual(worker.secretValuesOf({ A_KEY: '12345678', B: 'zzzzzzzzzz', C_TOKEN: 'short' }), ['12345678']);
  } finally { s.cleanup(); }
});

test('11. log หมุนเวียน (ขนาดเพดาน × จำนวนไฟล์) + ปิดคีย์ · retention โฟลเดอร์งาน · งบเครื่องมือรายเดือนเตือนเมื่อถึง', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-log-'));
  try {
    const log = worker.createLogger({ logDir: join(dir, 'logs'), maxBytes: 300, keep: 2, echo: false, secretValues: [SECRET], now: () => NOW });
    for (let i = 0; i < 40; i++) log('INFO', `บรรทัด ${i} ${SECRET}`);
    const files = readdirSync(join(dir, 'logs')).sort();
    assert.deepEqual(files, ['worker.log', 'worker.log.1', 'worker.log.2']);
    const all = files.map((f) => readFileSync(join(dir, 'logs', f), 'utf8').replace(/\r\n/g, '\n')).join('');
    assert.ok(!all.includes(SECRET));
    assert.match(all, /\[REDACTED\]/);
    const root = join(dir, 'work');
    for (let i = 0; i < 5; i++) {
      mkdirSync(join(root, `q_${i}`), { recursive: true });
      utimesSync(join(root, `q_${i}`), new Date(NOW + i * 1000), new Date(NOW + i * 1000));
    }
    assert.equal(worker.pruneWorkdirs({ root, keep: 2 }), 3);
    assert.deepEqual(readdirSync(root).sort(), ['q_3', 'q_4']);
    const st1 = worker.addMonthSpend({ logDir: join(dir, 'logs'), costUsd: 0.004, capUsd: 0.01, now: () => NOW });
    assert.equal(st1.reached, false);
    const st2 = worker.addMonthSpend({ logDir: join(dir, 'logs'), costUsd: 0.007, capUsd: 0.01, now: () => NOW });
    assert.equal(st2.reached, true);
    assert.equal(st2.spentAfter, 0.011);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const s = setup(worker, { RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH: '0.001' });
  try {
    const c = clock();
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s, { runCodex: codexStub([okCodex(FIX('lab-out-result.json'))], c), readQuota: quotaStub(), now: c.now })), 'budget');
    assert.ok(record.flags.includes('TOOL_BUDGET_MONTH'), 'ถึงเพดาน $/เดือน = ธงเตือน (ไม่หยุดงาน)');
    assert.equal(record.status, 'done');
  } finally { s.cleanup(); }
});

test('12. โฟลเดอร์งาน: junction ไม่ทำลายต้นทางตอนลบ · จำกัดเครื่องมือ = สำเนาเฉพาะที่เปิด (+ตัวช่วย)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-wd-'));
  try {
    const toolsDir = join(REAL_ROOT, 'scripts', 'research-tools');
    const a = worker.prepareWorkdir({ root: dir, jobId: 'q_a', toolsDir, taskText: 'งาน' });
    assert.equal(a.toolsMode === 'junction' ? lstatSync(join(a.dir, 'tools')).isSymbolicLink() : true, true);
    worker.pruneWorkdirs({ root: dir, keep: 0 });
    assert.ok(existsSync(join(toolsDir, 'serper.mjs')), 'ลบโฟลเดอร์งานต้องไม่ลบเครื่องมือจริง');
    const b = worker.prepareWorkdir({ root: dir, jobId: 'q_b', toolsDir, tools: ['serper', 'wiki'], restricted: true, taskText: 'งาน' });
    assert.equal(b.toolsMode, 'copy');
    assert.deepEqual(readdirSync(join(b.dir, 'tools')).sort(), ['.repo-root', '_alias-hooks.mjs', '_common.mjs', 'serper.mjs', 'wiki.mjs']);
    assert.equal(readFileSync(join(b.dir, 'tools', '.repo-root'), 'utf8').replace(/\r\n/g, '\n'), REAL_ROOT.replace(/[\\/]+$/, ''), 'สำเนาบอกรากโปรเจกต์ให้เครื่องมือหา .env.local');
    assert.throws(() => worker.prepareWorkdir({ root: dir, jobId: '..\\x', toolsDir, taskText: '' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── ทำขนาน + เบราว์เซอร์ทีละงาน + limits + เกณฑ์ข่าวเก่า (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69) ──
const JOB2 = { ...JOB, id: 'q_fedcba9876543210', workflowId: 'unify_q_fedcba9876543210' };
const JOB3 = { ...JOB, id: 'q_00000000000000aa', workflowId: 'unify_q_00000000000000aa' };

/** ลูปจริง CONCURRENCY=2: สองงานรันพร้อมกัน · เต็มแล้วไม่ขอเพิ่ม · เบราว์เซอร์ได้งานเดียว · ธงหยุดรองานค้างส่งผลครบก่อนออก */
async function checkConcurrentLoop(mod) {
  const s = setup(mod, { RESEARCH_AGENT_CONCURRENCY: '2' });
  try {
    const f = apiFetch({ leaseJobs: [JOB, JOB2, JOB3] });
    const api = mod.createApi({ apiBase: s.cfg.apiBase, secret: s.cfg.secret, workerId: 'w1', fetchImpl: f.impl, sleep: async () => {} });
    const gates = {};
    const prompts = {};
    const runCodex = async (p) => {
      const id = basename(p.workdir);
      prompts[id] = p.prompt;
      gates[id] = deferred();
      await gates[id].promise;
      return okCodex(FIX('lab-out-result.json'));
    };
    let settled = null;
    const loop = mod.workerLoop({
      cfg: s.cfg, api, env: s.env,
      deps: { ...NO_REAL, runCodex, readQuota: quotaStub(), now: () => NOW, log: collectLog(), every: everyStub(), sleep: async () => {} },
    }).then((why) => { settled = why; return why; });
    await until(() => gates[JOB.id] && gates[JOB2.id], 'สองงานต้องรันพร้อมกัน (CONCURRENCY=2)');
    const leases = () => f.calls.filter((x) => x.url.endsWith('/api/research/lease')).length;
    assert.equal(leases(), 2, 'เต็ม 2 ช่องแล้วห้ามของานที่ 3');
    assert.match(prompts[JOB.id], /เบราว์เซอร์: เปิด/, 'งานแรกได้ล็อกเบราว์เซอร์');
    assert.match(prompts[JOB2.id], /เบราว์เซอร์: ปิด — ห้ามใช้เบราว์เซอร์ในงานนี้/, 'งานที่สองต้องถูกตัด browser ออกจาก TOOLS');
    assert.equal(browserLock.readBrowserLock(s.cfg.browserLockFile).jobId, JOB.id);
    mkdirSync(s.cfg.logDir, { recursive: true });
    writeFileSync(s.cfg.stopFile, 'stop'); // ธงหยุดระหว่างทำ
    gates[JOB.id].resolve();
    await until(() => f.calls.some((x) => x.url.endsWith('/api/research/report') && x.body.jobId === JOB.id), 'งานแรกส่งผล');
    await until(() => !existsSync(s.cfg.browserLockFile), 'งานแรกจบ = คืนล็อกเบราว์เซอร์');
    assert.equal(settled, null, 'ยังมีงานค้าง = ห้ามออกจากลูปก่อนงานนั้นส่งผล');
    gates[JOB2.id].resolve();
    assert.equal(await settleWithin(loop, 'loop stop'), 'stopped');
    const reports = f.calls.filter((x) => x.url.endsWith('/api/research/report'));
    assert.deepEqual(reports.map((x) => x.body.jobId).sort(), [JOB.id, JOB2.id].sort(), 'ส่งผลครบทั้งสองงาน');
    assert.equal(leases(), 2, 'มีธงหยุดแล้วห้ามของานที่ 3');
    const second = reports.find((x) => x.body.jobId === JOB2.id).body.result;
    assert.deepEqual(validateCardRecord(second), []);
    const note = second.tool_log.find((t) => t.tool === 'worker' && t.args === 'browser-lock');
    assert.ok(note && /q_0123456789abcdef/.test(note.note) && /ตัด browser ออกจาก TOOLS/.test(note.note), 'บันทึกการตัดเบราว์เซอร์ + งานที่ถืออยู่ใน tool_log');
    const first = reports.find((x) => x.body.jobId === JOB.id).body.result;
    assert.ok(!first.tool_log.some((t) => t.args === 'browser-lock'));
  } finally { s.cleanup(); }
}

/** ตัวล็อกเบราว์เซอร์ (โมดูล browserLock.mjs) */
function checkBrowserLockUnit(m) {
  const dir = mkdtempSync(join(tmpdir(), 'ra-lock-'));
  try {
    const file = join(dir, 'sub', 'browser.lock');
    const base = { file, staleMs: 60_000, now: () => NOW, host: 'pc1', isPidAlive: () => true };
    const a = m.acquireBrowserLock({ ...base, jobId: 'q_a', pid: 100 });
    assert.equal(a.ok, true);
    const held = m.readBrowserLock(file);
    assert.deepEqual([held.pid, held.host, held.jobId], [100, 'pc1', 'q_a']);
    const b = m.acquireBrowserLock({ ...base, jobId: 'q_b', pid: 200 });
    assert.equal(b.ok, false, 'โปรเซสอื่นที่ยังมีชีวิตถืออยู่ = ห้ามแย่ง');
    assert.equal(b.holder.jobId, 'q_a');
    assert.equal(m.acquireBrowserLock({ ...base, jobId: 'q_b', pid: 100, heldInProcess: (id) => id === 'q_a' }).ok, false, 'งานในโปรเซสเดียวกันยังถือ = ห้ามแย่ง');
    assert.equal(m.releaseBrowserLock({ file, jobId: 'q_b', pid: 100 }), false, 'ห้ามลบล็อกของงานอื่น');
    assert.ok(existsSync(file));
    assert.equal(a.release(), true);
    assert.ok(!existsSync(file));
    // pid เจ้าของ (เครื่องเดียวกัน) ตายแล้ว → ยึดคืน
    assert.equal(m.acquireBrowserLock({ ...base, jobId: 'q_dead', pid: 300 }).ok, true);
    const c = m.acquireBrowserLock({ ...base, jobId: 'q_c', pid: 400, isPidAlive: (p) => p !== 300 });
    assert.equal(c.ok, true);
    assert.match(c.takeover.staleReason, /จบไปแล้ว/);
    assert.equal(m.readBrowserLock(file).jobId, 'q_c');
    // ค้างในโปรเซสเดียวกัน (ปล่อยรอบก่อนพลาด · ไม่มีงานไหนถือ) → ยึดคืน
    const d = m.acquireBrowserLock({ ...base, jobId: 'q_d', pid: 400, heldInProcess: () => false });
    assert.equal(d.ok, true);
    assert.match(d.takeover.staleReason, /โปรเซสนี้/);
    // เครื่องอื่น (เช็ค pid ไม่ได้) → ต้องนานเกิน staleMs ก่อน
    writeFileSync(file, JSON.stringify({ pid: 1, host: 'pc2', jobId: 'q_far', at: new Date(NOW - 30_000).toISOString() }));
    assert.equal(m.acquireBrowserLock({ ...base, jobId: 'q_e', pid: 500, isPidAlive: () => false }).ok, false, 'เครื่องอื่น + ยังไม่เกินเวลา = ห้ามแย่ง');
    writeFileSync(file, JSON.stringify({ pid: 1, host: 'pc2', jobId: 'q_far', at: new Date(NOW - 61_000).toISOString() }));
    const e = m.acquireBrowserLock({ ...base, jobId: 'q_e', pid: 500 });
    assert.equal(e.ok, true);
    assert.match(e.takeover.staleReason, /นานเกิน/);
    // ไฟล์อ่านไม่ออก: ใหม่ = อาจกำลังถูกเขียน (ห้ามแย่ง) · เก่ากว่า 60 วิ = ยึดคืน
    writeFileSync(file, '{oops');
    assert.equal(m.acquireBrowserLock({ ...base, jobId: 'q_f', pid: 600, now: () => Date.now() }).ok, false);
    assert.equal(m.acquireBrowserLock({ ...base, jobId: 'q_f', pid: 600, now: () => Date.now() + 61_000 }).ok, true);
    assert.equal(m.pidAlive(process.pid), true);
    assert.equal(m.pidAlive(-1), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** job.limits จาก lease ไม่ถูกใช้ในเฟส 1 (งบ/สมอง/effort มาจาก env ของ worker เท่านั้น) */
async function checkLimitsIgnored(mod) {
  const s = setup(mod);
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(FIX('lab-out-result.json'))], c);
    const job = { ...JOB, limits: { maxCalls: 3, maxMinutes: 1, effort: 'medium', tools: ['serper'], brain: 'api' } };
    const { record } = await settleWithin(mod.processJob(job, processCtx(s, { runCodex, readQuota: quotaStub(), now: c.now })), 'limits');
    assert.equal(runCodex.calls.length, 1, 'สมอง = codex ตาม env ของ worker (ไม่ใช่ limits.brain)');
    const call = runCodex.calls[0];
    assert.equal(call.effort, 'low');
    assert.match(call.prompt, /เรียกเครื่องมือไม่เกิน 24 ครั้ง · เวลารวมไม่เกิน 6 นาที/);
    assert.ok(call.timeoutMs > 6 * 60_000, 'เพดานเวลาจาก MAX_MINUTES ของ worker');
    assert.ok(!record.flags.includes('OVER_BUDGET'), 'งบนับจาก env ของ worker (24) — ถ้าใช้ limits (3) เครื่องมือ 12 ครั้งจะเกินงบ');
  } finally { s.cleanup(); }
}

/** RESEARCH_AGENT_STALE_DAYS → ด่าน (ธง STALE_NEWS อย่างเดียว) + ใบงานบอกเกณฑ์เดียวกัน */
async function checkStaleDaysEnv(mod) {
  const story = { ...FIX('lab-out-result.json'), story_date_estimate: '2026-09-27' }; // 4 วันก่อนพนักงานส่ง (2026-10-01T05:15Z)
  const s = setup(mod, { RESEARCH_AGENT_STALE_DAYS: '3' });
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(story)], c);
    const { record } = await settleWithin(mod.processJob(JOB, processCtx(s, { runCodex, readQuota: quotaStub(), now: c.now })), 'stale-3');
    assert.ok(record.flags.includes('STALE_NEWS'), 'เกณฑ์ 3 วัน: เรื่อง 4 วันก่อน = ธง');
    assert.equal(record.status, 'done', 'ธงอย่างเดียว ไม่หยุดงาน');
    assert.match(runCodex.calls[0].prompt, /เกณฑ์ข่าวเก่า: [^\n]*เกิน 3 วัน/);
  } finally { s.cleanup(); }
  const s2 = setup(mod);
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(story)], c);
    const { record } = await settleWithin(mod.processJob(JOB, processCtx(s2, { runCodex, readQuota: quotaStub(), now: c.now })), 'stale-7');
    assert.ok(!record.flags.includes('STALE_NEWS'), 'ค่าเริ่มต้น 7 วัน: เรื่อง 4 วันก่อน = ไม่ใช่ข่าวเก่า');
    assert.match(runCodex.calls[0].prompt, /เกณฑ์ข่าวเก่า: [^\n]*เกิน 7 วัน/);
  } finally { s2.cleanup(); }
}

test('13. ทำขนาน (RESEARCH_AGENT_CONCURRENCY=2) · เต็มแล้วไม่ขอเพิ่ม · เบราว์เซอร์ทีละงาน (งานที่ล็อกไม่ได้ตัด browser + tool_log) · ธงหยุดรองานค้างส่งผลครบ', async () => {
  await checkConcurrentLoop(worker);
});

test('14. ล็อกเบราว์เซอร์: ได้/ไม่ได้/ปล่อย · ยึดคืนล็อกค้าง (pid ตาย · ค้างในโปรเซส · นานเกิน · ไฟล์เสีย) · ไม่ลบล็อกของงานอื่น', () => {
  checkBrowserLockUnit(browserLock);
});

test('14b. ล็อกเบราว์เซอร์ในงานจริง: Codex ล้ม → คืนล็อกก่อนรอบ API · ปิดเบราว์เซอร์ใน TOOLS / สมอง api = ไม่แตะล็อก', async () => {
  const s = setup();
  try {
    const c = clock();
    const seen = {};
    const runCodex = async () => { seen.duringCodex = existsSync(s.cfg.browserLockFile); c.advance(60_000); return { ok: false, errorType: 'CODEX_EXIT', error: 'x', json: null }; };
    const runApi = async () => { seen.duringApi = existsSync(s.cfg.browserLockFile); return { ok: true, json: FIX('lab-out-result.json'), costUsd: 0.01 }; };
    const { record } = await settleWithin(worker.processJob(JOB, processCtx(s, { runCodex, runApi, readQuota: quotaStub(), now: c.now })), 'fallback-lock');
    assert.equal(record.brain.kind, 'api');
    assert.deepEqual(seen, { duringCodex: true, duringApi: false }, 'ถือล็อกระหว่าง Codex · คืนก่อนรอบ API (ไม่มีเบราว์เซอร์)');
    assert.ok(!existsSync(s.cfg.browserLockFile));
  } finally { s.cleanup(); }
  for (const env of [{ RESEARCH_AGENT_TOOLS: 'serper,wiki' }, { RESEARCH_AGENT_BRAIN: 'api' }]) {
    const s2 = setup(worker, env);
    try {
      const c = clock();
      const lockCalls = [];
      const deps = {
        runCodex: codexStub([okCodex(FIX('lab-out-result.json'))], c), runApi: async () => ({ ok: true, json: FIX('lab-out-result.json'), costUsd: 0 }),
        readQuota: quotaStub(), now: c.now, acquireBrowserLock: (id) => { lockCalls.push(id); return { ok: true, release: () => true }; },
      };
      const { record } = await settleWithin(worker.processJob(JOB, processCtx(s2, deps)), `no-browser ${Object.keys(env)[0]}`); // eslint-disable-line no-await-in-loop
      assert.equal(record.status, 'done');
      assert.deepEqual(lockCalls, [], `${JSON.stringify(env)} = ไม่มีเบราว์เซอร์ ไม่ต้องล็อก`);
    } finally { s2.cleanup(); }
  }
});

test('15. job.limits จาก lease ไม่ถูกใช้ในเฟส 1 (contract-check #3) — งบ/สมอง/effort จาก env ของ worker', () => checkLimitsIgnored(worker));

test('16. RESEARCH_AGENT_STALE_DAYS: ด่านติดธง STALE_NEWS ตามเกณฑ์ (ไม่หยุดงาน) + ใบงานบอกเกณฑ์เดียวกัน · ใบขอไม่มี deadlineAt = createdAt + 15 นาที', async () => {
  await checkStaleDaysEnv(worker);
  const s = setup();
  try {
    const c = clock();
    const runCodex = codexStub([okCodex(FIX('lab-out-result.json'))], c);
    const job = { ...JOB, createdAt: new Date(NOW - 10 * 60_000).toISOString(), deadlineAt: undefined };
    const { record } = await settleWithin(worker.processJob(job, processCtx(s, { runCodex, readQuota: quotaStub(), now: c.now })), 'fallback-deadline');
    assert.equal(record.status, 'done', 'ส่งมา 10 นาทีแล้ว ยังไม่เลยเส้นตายสำรอง 15 นาที (เท่าฝั่งเว็บ)');
    assert.ok(runCodex.calls[0].timeoutMs <= 5 * 60_000 - 5000, 'เพดานเวลาไม่เกินเส้นตายสำรอง');
    assert.equal(worker.FALLBACK_DEADLINE_MIN, 15);
  } finally { s.cleanup(); }
});

// ── กลายพันธุ์ (ต้องแดง) ──
test('M1 กลายพันธุ์: ไม่สนธงหยุด (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant('if (fs.existsSync(cfg.stopFile)) {', 'if (false) {', 'no-stop');
  await assert.rejects(() => checkStopFlag(m));
});

test('M2 กลายพันธุ์: ยก medium โดยไม่ดูความยาก (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant("g1.complexity === 'high'", 'true', 'escalate-always');
  await assert.rejects(() => checkEscalationOnlyWhenHard(m));
});

test('M3 กลายพันธุ์: ไม่ส่ง heartbeat (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant('      beat();\n      stopBeat = deps.every(cfg.heartbeatMs, beat);', '      stopBeat = () => {};', 'no-heartbeat');
  await assert.rejects(() => checkHeartbeat(m));
});

test('M4 กลายพันธุ์: ไม่ดูโควตาตอนเลือกบัญชี (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant('chooseAccount(cfg.accounts, quotas, { alertPct: cfg.quotaAlertPct })', 'chooseAccount(cfg.accounts, {}, { alertPct: cfg.quotaAlertPct })', 'ignore-quota');
  await assert.rejects(() => checkQuotaSwitch(m));
});

test('M5 กลายพันธุ์: ลองส่งซ้ำแม้ 4xx (ข้อตรวจต้องแดง)', async () => {
  const m = await mutant('const retryable = e.status === 0 || e.status === 429 || e.status >= 500;', 'const retryable = true;', 'retry-4xx');
  await assert.rejects(() => checkNoRetryOn4xx(m));
});

test('M6 กลายพันธุ์: ไม่สน RESEARCH_AGENT_CONCURRENCY — ทำทีละงาน (ข้อตรวจทำขนานต้องแดง)', async () => {
  const m = await mutant('const limit = once ? 1 : Math.min(MAX_CONCURRENCY, Math.max(1, Number(cfg.concurrency) || 1));', 'const limit = 1;', 'no-concurrency');
  await assert.rejects(() => checkConcurrentLoop(m));
});

test('M7 กลายพันธุ์: ล็อกเบราว์เซอร์ไม่ได้แต่ยังเปิดเบราว์เซอร์ให้งาน (ข้อตรวจทำขนานต้องแดง)', async () => {
  const m = await mutant('          browserOn = false;\n          const holder', '          const holder', 'browser-not-cut');
  await assert.rejects(() => checkConcurrentLoop(m));
});

test('M8 กลายพันธุ์: ธงหยุดแล้วออกเลยไม่รองานที่ค้าง (ข้อตรวจทำขนานต้องแดง)', async () => {
  const m = await mutant('        await Promise.all(active.values());\n', '', 'stop-no-wait');
  await assert.rejects(() => checkConcurrentLoop(m));
});

test('M9 กลายพันธุ์: heartbeat ส่งโควตาแบบเก่า quotaPct (ข้อตรวจสัญญา body ต้องแดง)', async () => {
  const m = await mutant('body.quota = { remainingPct };', 'body.quotaPct = remainingPct;', 'quota-old-shape');
  await assert.rejects(() => checkProtocolBodies(m));
});

test('M10 กลายพันธุ์: lease ไม่ส่ง version (ข้อตรวจสัญญา body ต้องแดง)', async () => {
  const m = await mutant("post('/api/research/lease', { workerId, version: PROTOCOL }, 15000)", "post('/api/research/lease', { workerId }, 15000)", 'lease-no-version');
  await assert.rejects(() => checkProtocolBodies(m));
});

test('M11 กลายพันธุ์: worker เอา job.limits มาใช้เป็นงบ (ข้อตรวจ limits ต้องแดง)', async () => {
  const m = await mutant(
    'const baseBudget = { maxCalls: cfg.maxCalls, maxMinutes: cfg.maxMinutes };',
    'const baseBudget = { maxCalls: (rawJob.limits && rawJob.limits.maxCalls) || cfg.maxCalls, maxMinutes: cfg.maxMinutes };',
    'use-limits',
  );
  await assert.rejects(() => checkLimitsIgnored(m));
});

test('M12 กลายพันธุ์: ไม่ส่ง RESEARCH_AGENT_STALE_DAYS เข้าด่าน (ข้อตรวจเกณฑ์ข่าวเก่าต้องแดง)', async () => {
  const m = await mutant('maxMinutes: cfg.maxMinutes, staleDays: cfg.staleDays, secretValues })', 'maxMinutes: cfg.maxMinutes, secretValues })', 'stale-not-passed');
  await assert.rejects(() => checkStaleDaysEnv(m));
});

test('M13 กลายพันธุ์: ล็อกเบราว์เซอร์แย่งได้แม้เจ้าของยังมีชีวิต (ข้อตรวจตัวล็อกต้องแดง)', async () => {
  const m = await lockMutant("if (!why) return { ok: false, holder: cur, reason: 'มีงานอื่นใช้อยู่' };", '', 'steal-live-lock');
  assert.throws(() => checkBrowserLockUnit(m));
});
