// ============================================================
// 🧪 tests/research-watchdog-digest.test.mjs — ตัวเฝ้า worker ค้นคว้า + ล้มติดกัน + สรุปรายวัน DM เจ้าของ (ฝั่งบอท · Railway)
// ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7)
// ------------------------------------------------------------
// โค้ดที่ตรวจ: discord-bot/researchCard.js (createResearchWatchdog · renderDigestMessage · digestSlotAt · parseWatchStatus · hub ผลบัตร
//   ใน deliverCard/deliverEditor) + จุด start (ready) / stop (gracefulShutdown) ใน discord-bot/index.js
//   + สัญญาข้ามฝั่งกับ route ตัวจริง: /api/research/status → parseWatchStatus · /api/research/bot-state (cas/409) · /api/research/digest (ตัวเลขจริง)
// นาฬิกาปลอมล้วน: setInterval/clearInterval ฉีด (เทสยิง callback เอง) · now() ฉีด · setTimeout ของบัตรเป็นตัวปลอม · ไม่มี timer จริง
//   ไม่ unref · ทุก await ที่อาจค้างครอบ settleWithin (tests/helpers/fake-deadline.mjs — บทเรียน CI node 22)
// ข้อสอบ (สเปกส่วน 12 ข้อ 7): สวิตช์ปิด = no-op (index.js ถอดบล็อก W7 แล้วเท่ากันทุกไบต์ · บล็อก W7 ไม่มีคำที่ตัวถอดเลน C/W3 จับ)
//   · ออฟไลน์ ≥ 10 นาทีนับจาก lastSeenAt → DM ครั้งเดียว → ซ้ำที่ 60 นาที → กลับ online = DM เขียว · ติดต่อ route ไม่ได้ ≥ 3 ≠ ออฟไลน์ (≤ 1/ชม.)
//   · เว็บปิด = ไม่เฝ้า · ล้มติดกัน 3/6 ผ่านบัตรจริง (createResearchCards → hub) + รีเซ็ตเมื่อ done · สรุป 07:30 เวลาไทยทนรีสตาร์ต (state ปลอม
//   + route จริง) · สองบอททับกันส่งครั้งเดียว · จองค้างของบอทที่ตาย ≥ 10 นาทีรับต่อได้ · ดึงสรุปล้มลองใหม่ 5 นาที ≤ 12 ครั้ง
//   · env เวลา/ปิดสรุป · ข้อความ ≤ 1,800 + escape · DM ล้ม → ห้อง ADMIN_LOG_CHANNEL_ID → log
// mutation (ท้ายไฟล์ · ต้องแดงจริง 16 แบบ): MB1–MB16 (ดูชื่อข้อ)
// ============================================================
/* eslint-disable no-await-in-loop -- เทสเดินนาฬิกาเสมือนทีละรอบโดยตั้งใจ (ลำดับเวลาต้องเรียง ห้ามขนาน) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { settleWithin } from './helpers/fake-deadline.mjs';
import { createFakeSupabase, installResearchHooks, srcUrl } from './helpers/research-web-fakes.mjs';
import { createTableSupabase, digestFixture, DIGEST_SINCE, DIGEST_UNTIL } from './helpers/research-digest-fakes.mjs';

installResearchHooks({
  stubs: {
    '@/lib/supabase': 'export const isSupabaseReady = () => globalThis.__W7_SB_READY !== false; export const getSupabase = () => globalThis.__W7_SB;',
  },
});

const cardUrl = new URL('../discord-bot/researchCard.js', import.meta.url);
const botUrl = new URL('../discord-bot/index.js', import.meta.url);
const CARD_SRC = readFileSync(cardUrl, 'utf8').replace(/\r\n/g, '\n');
const BOT_SRC = readFileSync(botUrl, 'utf8').replace(/\r\n/g, '\n');
const cardRequire = createRequire(cardUrl);
const botRequire = createRequire(botUrl);

const statusRoute = await import(srcUrl('app/api/research/status/route.js'));
const stateRoute = await import(srcUrl('app/api/research/bot-state/route.js'));
const digestRoute = await import(srcUrl('app/api/research/digest/route.js'));
const digestLib = await import(srcUrl('lib/research-agent/digest.js'));

function loadCardModule(src = CARD_SRC) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', src)(cardRequire, mod, mod.exports);
  return mod.exports;
}
const RC = loadCardModule();

// patch ซอร์สแบบต้องติดจริง (ไม่เจอ = แดง กันกลายพันธุ์ที่ไม่เปลี่ยนอะไร)
function mutate(source, from, to) {
  assert.ok(source.includes(from), `mutation ต้องเจอข้อความต้นทาง: ${from.slice(0, 80)}`);
  return source.split(from).join(to);
}
const cardMutant = (from, to) => loadCardModule(mutate(CARD_SRC, from, to));

const API = 'http://api.test';
const OWNER = '800000000000000001';
const ADMIN_CH = '600000000000000001';
const SEC = 1000;
const MIN = 60 * SEC;
const DAY = 24 * 60 * MIN;
const ON = Object.freeze({ RESEARCH_AGENT: '1', RESEARCH_AGENT_OWNER_DISCORD_ID: OWNER });
const QUIET = Object.freeze({ ...ON, RESEARCH_DIGEST: '0' }); // ข้อที่ไม่ได้ทดสอบสรุปรายวัน
const T0 = Date.UTC(2026, 9, 2, 3, 0, 0); // 2 ต.ค. 69 10:00 เวลาไทย
const AT_0730 = Date.UTC(2026, 9, 2, 0, 30, 0); // 2 ต.ค. 69 07:30 เวลาไทย
const CHECK_HINT = 'ตรวจเครื่อง worker: node scripts/research-agent-worker.mjs --check';
const flush = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

class FakeEmbed {
  constructor() { this.data = {}; }
  setColor(c) { this.data.color = c; return this; }
  setTitle(t) { this.data.title = t; return this; }
  setDescription(d) { this.data.description = d; return this; }
  addFields(...fields) { (this.data.fields ||= []).push(...fields.flat()); return this; }
  setFooter(f) { this.data.footer = f; return this; }
}

async function withEnv(vars, fn) {
  const keys = ['RESEARCH_AGENT', 'RESEARCH_AGENT_MODE', 'DISCORD_API_SECRET'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// ── ของปลอมฝั่งบอท ──────────────────────────────────────────────
function makeIntervals() {
  const list = [];
  return {
    list,
    setInterval: (fn, ms) => { const handle = { fn, ms, cleared: false }; list.push(handle); return handle; },
    clearInterval: (handle) => { if (handle && typeof handle === 'object') handle.cleared = true; },
  };
}

function makeLogger() {
  const logs = [];
  const push = (...a) => logs.push(a.map(String).join(' '));
  return { logs, log: push, warn: push, error: push };
}

/** client ของ discord.js ปลอม: DM (users.fetch → send) · ห้อง (channels.fetch → send) */
function makeClient({ dm = 'ok', channel = 'ok' } = {}) {
  const dms = [];
  const posts = [];
  const lookups = [];
  return {
    dms,
    posts,
    lookups,
    users: {
      fetch: async (id) => {
        lookups.push(['user', id]);
        if (dm === 'unknown') throw Object.assign(new Error('Unknown User'), { code: 10013 });
        return {
          id,
          send: async (payload) => {
            if (dm === 'closed') throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
            dms.push({ to: id, ...clone(payload) });
            return { id: `dm${dms.length}` };
          },
        };
      },
    },
    channels: {
      fetch: async (id) => {
        lookups.push(['channel', id]);
        if (channel === 'missing') throw Object.assign(new Error('Missing Access'), { code: 50001 });
        return {
          id,
          send: async (payload) => {
            if (channel === 'fail') throw new Error('Missing Permissions');
            posts.push({ channelId: id, ...clone(payload) });
            return { id: `c${posts.length}` };
          },
        };
      },
    },
  };
}

/** คำตอบ GET /api/research/status รูปเดียวกับ route จริง (สัญญาตรวจกับ route จริงในข้อ "สัญญาข้ามฝั่ง") */
function statusBody({ online = true, lastSeenMs = null, enabled = true, quotaPct = 63 } = {}) {
  const seen = lastSeenMs === null ? null : new Date(lastSeenMs).toISOString();
  if (!enabled) return { success: true, enabled: false, mode: 'write', status: 'disabled', offlineAfterMs: 600000, workers: [], lastSeenAt: null, quota: null, queue: null };
  return {
    success: true,
    enabled: true,
    mode: 'write',
    status: online ? 'online' : 'offline',
    offlineAfterMs: 600000,
    lastSeenAt: seen,
    workers: seen ? [{ workerId: 'owner-pc', lastSeenAt: seen, online, quota: { pct: quotaPct, account: 'main', at: seen } }] : [],
    quota: quotaPct === null ? null : { pct: quotaPct, account: 'main', at: seen, alertPct: 15, low: quotaPct <= 15 },
  };
}
const netError = () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' });
const httpError = (status, data = { success: false, error: 'x', errorType: 'X' }) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

/** store bot-state ปลอม (ความหมายเดียวกับ route จริง: expectedRevision ไม่ตรง = 409 BOT_STATE_CONFLICT + ค่าล่าสุด) */
function makeStateStore(initialState = null, { revision = 3 } = {}) {
  const store = {
    item: initialState ? { id: 'daily-digest', state: clone(initialState), revision, createdAt: '2026-09-30T00:30:00.000Z', updatedAt: '2026-10-01T00:31:00.000Z' } : null,
    reads: 0,
    writes: [],
    read() {
      store.reads += 1;
      return { data: { success: true, key: 'daily-digest', item: clone(store.item) } };
    },
    write(body) {
      store.writes.push(clone(body));
      const current = store.item ? store.item.revision : 0;
      if (body.key !== 'daily-digest' || body.expectedRevision !== current) {
        throw httpError(409, { success: false, error: 'conflict', errorType: 'BOT_STATE_CONFLICT', item: clone(store.item) });
      }
      store.item = { id: 'daily-digest', state: clone(body.state), revision: current + 1, createdAt: store.item?.createdAt || 'x', updatedAt: 'y' };
      return { data: { success: true, key: 'daily-digest', item: clone(store.item) } };
    },
  };
  return store;
}

// คำตอบ /api/research/digest ตัวอย่าง = ผลของโค้ดสรุปตัวจริง (digest.js) บนแถวตัวอย่าง (timers ปลอม — ไม่มี timer จริง)
const DIGEST_BODY_FIXED = await (async () => {
  const sb = createTableSupabase();
  for (const [table, rows] of Object.entries(digestFixture())) sb.insertRows(table, rows);
  const range = digestLib.parseDigestRange({ since: DIGEST_SINCE, until: DIGEST_UNTIL }, Date.now());
  const digest = await digestLib.collectResearchDigest({ sb, range, timers: { setTimeout: () => null, clearTimeout() {} } });
  return { success: true, enabled: true, mode: 'write', ...digest };
})();
const DIGEST_BODY = () => clone(DIGEST_BODY_FIXED);

function makeWatchHttp({ statusAt, state, digestAt }) {
  const calls = [];
  let statusN = 0;
  return {
    calls,
    async get(url, opts) {
      const u = new URL(url);
      calls.push({ method: 'get', path: u.pathname, query: Object.fromEntries(u.searchParams), headers: clone(opts?.headers), timeout: opts?.timeout });
      if (u.pathname === '/api/research/status') {
        statusN += 1;
        const res = statusAt(statusN);
        if (res instanceof Error) throw res;
        return { data: clone(res) };
      }
      if (u.pathname === '/api/research/bot-state') return state.read(u.searchParams.get('key'));
      if (u.pathname === '/api/research/digest') {
        const res = digestAt(Object.fromEntries(u.searchParams));
        if (res instanceof Error) throw res;
        return { data: clone(res) };
      }
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body, opts) {
      const u = new URL(url);
      calls.push({ method: 'post', path: u.pathname, body: clone(body), headers: clone(opts?.headers) });
      if (u.pathname === '/api/research/bot-state') return state.write(body);
      throw new Error(`unexpected POST ${url}`);
    },
  };
}

/** ตัวเฝ้าพร้อมของปลอมครบ · fire() = ยิงรอบเฝ้า 1 ครั้ง (callback ของ setInterval ตัวจริงที่โมดูลตั้ง) แล้วรอข้อความส่งจบ */
function makeWatch({
  env = QUIET, mod = RC, clock = { t: T0 }, statusAt = (t) => statusBody({ online: true, lastSeenMs: t }),
  state = makeStateStore(), digestAt = () => DIGEST_BODY(), client = makeClient(), instance = 'botA_1', http = null,
  isShuttingDown = () => false,
} = {}) {
  const transport = http || makeWatchHttp({ statusAt: (n) => statusAt(clock.t, n), state, digestAt });
  const intervals = makeIntervals();
  const logger = makeLogger();
  const w = mod.createResearchWatchdog({
    env,
    http: transport,
    client,
    logger,
    instance,
    isShuttingDown,
    buildApiUrl: (path) => `${API}${path}`,
    buildApiHeaders: () => ({ 'Content-Type': 'application/json', 'x-api-key': 'S3CRET' }),
    now: () => clock.t,
    setInterval: intervals.setInterval,
    clearInterval: intervals.clearInterval,
  });
  const fire = async (label = 'รอบเฝ้า') => {
    const handle = intervals.list.find((h) => !h.cleared);
    assert.ok(handle, `${label}: ต้องมี interval ที่ยังไม่ถูกล้าง`);
    const result = await settleWithin(Promise.resolve(handle.fn()), label);
    await settleWithin(w.flush(), `${label} (รอข้อความ)`);
    return result;
  };
  const at = (t, label) => { clock.t = t; return fire(label || new Date(t).toISOString()); };
  return { w, http: transport, intervals, logger, client, clock, state, fire, at };
}

// ============================================================
// 1) สวิตช์ปิด = no-op · index.js
// ============================================================
function checkOff(mod = RC) {
  for (const env of [{}, { RESEARCH_AGENT: '0' }, { RESEARCH_AGENT: ' 1' }, { RESEARCH_AGENT: 'true' }, { RESEARCH_AGENT_OWNER_DISCORD_ID: OWNER, ADMIN_LOG_CHANNEL_ID: ADMIN_CH }]) {
    const h = makeWatch({ env, mod });
    assert.equal(h.w.enabled, false, JSON.stringify(env));
    assert.equal(h.w.start(), false, 'ปิด = start ไม่ทำอะไร');
    assert.equal(h.intervals.list.length, 0, 'ปิด = ไม่ตั้ง interval');
    assert.equal(h.w.stop(), false);
    assert.equal(h.w.noteOutcome({ kind: 'card', jobId: 'q_x', status: 'failed', flags: [] }), null);
    assert.deepEqual(h.http.calls, [], 'ปิด = ไม่ยิง HTTP');
    assert.deepEqual(h.logger.logs, [], 'ปิด = ไม่ log');
  }
}

test('สวิตช์ปิด (ไม่ตั้ง/0/" 1"/true) = no-op ทุกเมธอด: ไม่ตั้ง interval ไม่ยิง HTTP ไม่ log ไม่นับผลบัตร', async () => {
  checkOff();
  const h = makeWatch({ env: {} });
  assert.equal(await h.w.tick(), 'idle', 'ปิด = รอบเฝ้าไม่ทำอะไร');
  assert.deepEqual(h.http.calls, []);
});

// บล็อกที่ W7 เติมใน discord-bot/index.js (ตรงทุกไบต์) — ถอดออก = ไฟล์ก่อนมี W7
const W7_BOT_BLOCKS = [
  [
    '',
    '// ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7): ตัวเฝ้า worker ค้นคว้า (ออฟไลน์ ≥ 10 นาที) + ล้มติดกัน ≥ 3 + สรุปรายวัน 07:30',
    '//   → DM เจ้าของ (สำรอง: ห้อง ADMIN_LOG_CHANNEL_ID → log) · โมดูลเดียวกับบัตร (discord-bot/researchCard.js) · สวิตช์อ่านจาก env ของบอทเอง',
    "//   (ตรงตัว '1' แบบ envFlag · ปิด = ทุกเมธอด no-op) · สร้างตอนโหลดแบบเงียบ · เริ่มใน ready (setInterval 60 วิ) · หยุดใน gracefulShutdown",
    '//   ไม่ผูก event/ตัวฟังเพิ่ม · URL/กุญแจชุดเดียวกับคิว (buildQueueUrl/buildApiHeaders)',
    "const { createResearchWatchdog } = require('./researchCard');",
    'const researchWatchdog = createResearchWatchdog({',
    '  env: process.env,',
    '  http: axios,',
    '  client,',
    "  buildApiUrl: (path) => buildQueueUrl().replace('/api/queue/add', path),",
    '  buildApiHeaders,',
    '  isShuttingDown: () => shuttingDown,',
    '  instance: BOT_INSTANCE,',
    '  logger: console,',
    '  now: () => Date.now(),',
    '  setInterval,',
    '  clearInterval,',
    '});',
  ],
  ['  researchWatchdog.start(); // ★ 2 ต.ค. 69 (W7): เริ่มตัวเฝ้า worker ค้นคว้า + สรุปรายวัน (สวิตช์ปิด = no-op · ไม่โยน · ไม่รอ)'],
  ['  researchWatchdog.stop(); // ★ 2 ต.ค. 69 (W7): ล้าง setInterval ของตัวเฝ้า (ไม่ได้เริ่ม/สวิตช์ปิด = no-op)'],
];

function stripW7(src) {
  let out = src;
  for (const block of W7_BOT_BLOCKS) {
    const chunk = `${block.join('\n')}\n`;
    assert.equal(out.split(chunk).length, 2, `บล็อก W7 ต้องเจอครั้งเดียว: ${block.find((l) => l.trim()).slice(0, 60)}`);
    out = out.replace(chunk, () => '');
  }
  assert.ok(!/researchWatchdog|createResearchWatchdog/u.test(out), 'ถอดแล้วต้องไม่เหลือร่องรอย W7');
  return out;
}

/** โหลด discord-bot/index.js จริงด้วยของปลอม (แบบ tests/bot-resume) + setInterval/clearInterval ปลอม · ไม่ล็อกอิน */
function loadBotIndex({ env = {}, src = BOT_SRC, cardSrc = CARD_SRC, statusAt = () => statusBody({ online: false, lastSeenMs: T0 - 15 * MIN }), state = makeStateStore() } = {}) {
  const handlers = {};
  const procHandlers = {};
  const intervals = makeIntervals();
  const timeouts = [];
  const calls = [];
  const logs = [];
  const discordClient = makeClient();
  const clock = { t: T0 };
  const axios = {
    async get(url, opts) {
      calls.push(['get', url, clone(opts?.headers)]);
      const u = new URL(url);
      if (u.pathname === '/api/bot/tracking') return { data: { success: true, count: 0, items: [] } };
      if (u.pathname === '/api/research/status') return { data: clone(statusAt(clock.t)) };
      if (u.pathname === '/api/research/bot-state') return state.read();
      if (u.pathname === '/api/research/digest') return { data: DIGEST_BODY() };
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body, opts) {
      calls.push(['post', url, clone(body), clone(opts?.headers)]);
      if (new URL(url).pathname === '/api/research/bot-state') return state.write(body);
      throw new Error(`unexpected POST ${url}`);
    },
    async delete(url) { calls.push(['delete', url]); return { data: { success: true } }; },
    async patch(url) { calls.push(['patch', url]); return { data: { success: true } }; },
  };
  class FakeClient {
    constructor(opts) {
      this.opts = opts;
      this.user = { id: '900000000000000001', tag: 'bot#0' };
      this.users = discordClient.users;
      this.channels = discordClient.channels;
      this.destroyed = false;
    }
    once(evt, fn) { (handlers[evt] ||= []).push(fn); }
    on(evt, fn) { (handlers[evt] ||= []).push(fn); }
    async login() {}
    async destroy() { this.destroyed = true; }
  }
  const discord = {
    Client: FakeClient,
    GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, GuildMessageReactions: 1024 },
    Partials: { Message: 3, Reaction: 5 },
    EmbedBuilder: FakeEmbed,
  };
  const cardModule = loadCardModule(cardSrc);
  const fakeRequire = (name) => {
    if (name === 'dotenv') return { config() {} };
    if (name === 'discord.js') return discord;
    if (name === 'axios') return axios;
    if (name === './researchCard') return cardModule;
    if (name === 'os') { const os = botRequire('os'); return Object.assign(Object.create(os), { hostname: () => 'testhost' }); }
    return botRequire(name); // './queue-errors' ของจริง
  };
  const mod = { exports: {} };
  const push = (...a) => logs.push(a.map(String).join(' '));
  const fakeConsole = { log: push, warn: push, error: push };
  const fakeProcess = {
    env: { API_URL: `${API}/api/auto/process`, API_KEY: 'S3CRET', ...env },
    on: (evt, fn) => { (procHandlers[evt] ||= []).push(fn); },
    exit() {},
  };
  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(clock.t); else super(...args); }
    static now() { return clock.t; }
  }
  const fakeMath = Object.assign(Object.create(Math), { random: () => 0.5 });
  const fakeSetTimeout = (fn, ms) => { const handle = { fn, ms }; timeouts.push(handle); return handle; };
  new Function('require', 'module', 'exports', 'process', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'Math', src)(
    fakeRequire, mod, mod.exports, fakeProcess, fakeConsole, fakeSetTimeout, () => {}, intervals.setInterval, intervals.clearInterval, FakeDate, fakeMath);
  return { bot: mod.exports, handlers, procHandlers, intervals, timeouts, calls, logs, clock, discord: discordClient, state };
}

/** ตื่น (ready) → รอบเฝ้า 1 รอบ (ถ้ามี interval) → SIGTERM — คืนบันทึกทั้งหมดไว้เทียบ */
async function runBotLifecycle(opts) {
  const b = loadBotIndex(opts);
  const afterLoad = { intervals: b.intervals.list.length, logs: [...b.logs] };
  await settleWithin(Promise.resolve(b.handlers.ready[0]()), 'ready');
  const afterReady = { intervals: b.intervals.list.map((h) => h.ms) };
  if (b.intervals.list.length > 0) await settleWithin(Promise.resolve(b.intervals.list[0].fn()), 'รอบเฝ้าผ่าน index.js');
  await settleWithin(Promise.resolve(b.procHandlers.SIGTERM[0]('SIGTERM')), 'SIGTERM');
  return {
    b,
    afterLoad,
    afterReady,
    record: clone({ logs: b.logs, calls: b.calls, intervals: b.intervals.list.map((h) => [h.ms, h.cleared]), timeouts: b.timeouts.map((t) => t.ms), dms: b.discord.dms, posts: b.discord.posts }),
  };
}

function checkBotWiring(r) {
  assert.equal(r.afterLoad.intervals, 0, 'โหลดเฉยๆ ยังไม่ตั้ง interval');
  assert.ok(!r.afterLoad.logs.some((l) => l.includes('[ResearchWatch]')), 'สร้างแบบเงียบ (ลายนิ้วมือ bot-research-card ไม่เปลี่ยน)');
  assert.deepEqual(r.afterReady.intervals, [60000], 'ready = setInterval ทุก 60 วิ ตัวเดียว');
  const { record } = r;
  assert.ok(record.logs.some((l) => l.startsWith('[ResearchWatch] 👀 เริ่มตัวเฝ้า worker ค้นคว้า')), 'log ตอนเริ่ม');
  assert.equal(record.dms.length, 2, 'รอบแรก: 🔴 ออฟไลน์ + 📊 สรุปรอบล่าสุดที่ยังไม่เคยส่ง');
  assert.equal(record.dms[0].content, `🔴 worker ค้นคว้าออฟไลน์ตั้งแต่ 09:45 (2 ต.ค. 69) — ข่าวกำลังออกแบบไม่มีรีเสิร์ช · ${CHECK_HINT}`);
  assert.ok(record.dms[1].content.startsWith('📊 สรุปรีเสิร์ช 2 ต.ค. 69 (1 ต.ค. 69 07:30 → 2 ต.ค. 69 07:30)'));
  const research = record.calls.filter((c) => c[1].startsWith(`${API}/api/research/`));
  assert.ok(research.length >= 4 && research.every((c) => c[c.length - 1]['x-api-key'] === 'S3CRET'), 'ใช้ API_URL/API_KEY ชุดเดียวกับคิว');
  assert.deepEqual(record.intervals, [[60000, true]], 'SIGTERM = ล้าง interval');
  assert.ok(record.logs.some((l) => l.startsWith('[ResearchWatch] ⏹️ หยุดตัวเฝ้า')));
  assert.deepEqual(record.timeouts, [2500], 'ปิดตัวนุ่มนวลเดิม (exit หลัง 2.5 วิ)');
}

test('index.js ต่อสายจริง (สวิตช์เปิด): โหลด = เงียบ · ready → setInterval 60 วิ → รอบเฝ้าใช้ API_URL/API_KEY เดิม → DM เจ้าของ · SIGTERM → ล้าง interval', async () => {
  checkBotWiring(await runBotLifecycle({ env: ON }));
});

test('index.js สวิตช์ปิด: ถอดบล็อก W7 แล้วบอททำงานเท่ากันทุกไบต์ (ready/SIGTERM · log · HTTP · timer) · บล็อก W7 ไม่มีคำที่ตัวถอดเลน C (bot-research-card) / W3 จับ', async () => {
  const legacySrc = stripW7(BOT_SRC);
  for (const env of [{}, { RESEARCH_AGENT: '0' }, { RESEARCH_AGENT: ' 1' }, { RESEARCH_AGENT: 'true' }, { RESEARCH_AGENT_OWNER_DISCORD_ID: OWNER, ADMIN_LOG_CHANNEL_ID: ADMIN_CH }]) {
    const current = await runBotLifecycle({ env });
    const legacy = await runBotLifecycle({ env, src: legacySrc });
    assert.deepEqual(current.record, legacy.record, `${JSON.stringify(env)}: เท่ากันทุกไบต์`);
    assert.deepEqual(current.record.intervals, [], 'ปิด = ไม่มี interval');
    assert.ok(current.record.logs.length > 0, 'บันทึกครอบคลุมจริง (ไม่ใช่ว่างทั้งคู่)');
  }
  const w7Code = W7_BOT_BLOCKS.map((block) => block.join('\n')).join('\n');
  assert.ok(!/RESEARCH_AGENT|\bresearch\./u.test(w7Code), 'บล็อก W7 ห้ามมี RESEARCH_AGENT/research. (ตัวถอดเลน C ใน bot-research-card จะไม่รู้จัก)');
  assert.ok(!/researchHold|queueResearchHold|holdExtraMs|research_hold/u.test(w7Code), 'ห้ามชนตัวถอด W3');
  assert.ok(!/client\.(on|once)\(|process\.on\(/u.test(w7Code), 'ไม่ผูก event/ตัวฟังเพิ่ม (handlerCounts ของลายนิ้วมือเดิม)');
});

// ============================================================
// 2) ตัวเฝ้า worker
// ============================================================
async function scenarioOffline({ mod = RC } = {}) {
  const lastSeen = T0 - 4 * MIN; // 09:56 เวลาไทย
  let phase = 'offline';
  const h = makeWatch({
    mod,
    statusAt: (t) => (phase === 'offline' ? statusBody({ online: false, lastSeenMs: lastSeen }) : statusBody({ online: true, lastSeenMs: t })),
  });
  assert.equal(h.w.start(), true);
  const counts = {};
  for (let m = 0; m <= 66; m += 1) {
    await h.at(T0 + m * MIN, `นาที ${m}`);
    counts[m] = h.client.dms.length;
  }
  phase = 'online';
  for (let m = 80; m <= 82; m += 1) {
    await h.at(T0 + m * MIN, `นาที ${m}`);
    counts[m] = h.client.dms.length;
  }
  return { h, counts };
}

function checkOffline({ h, counts }) {
  assert.equal(counts[5], 0, 'ออฟไลน์มา 9 นาที (นับจาก lastSeenAt) = ยังไม่แจ้ง');
  assert.equal(counts[6], 1, 'ครบ 10 นาที = แจ้งครั้งแรก');
  assert.equal(counts[65], 1, 'ภายใน 60 นาทีหลังแจ้ง = ไม่ซ้ำ');
  assert.equal(counts[66], 2, 'ครบ 60 นาทียังออฟไลน์ = ซ้ำ');
  assert.equal(counts[80], 3, 'กลับ online = แจ้งเขียว');
  assert.equal(counts[82], 3, 'online ต่อ = เงียบ');
  const [first, repeat, green] = h.client.dms;
  assert.equal(first.to, OWNER);
  assert.equal(first.content, `🔴 worker ค้นคว้าออฟไลน์ตั้งแต่ 09:56 (2 ต.ค. 69) — ข่าวกำลังออกแบบไม่มีรีเสิร์ช · ${CHECK_HINT}`);
  assert.deepEqual(first.allowedMentions, { parse: [] }, 'DM ไม่ mention ใคร');
  assert.equal(repeat.content, `🔴 worker ค้นคว้ายังออฟไลน์ (ตั้งแต่ 09:56 (2 ต.ค. 69) · 70 นาทีแล้ว) — ข่าวกำลังออกแบบไม่มีรีเสิร์ช · ${CHECK_HINT}`);
  assert.equal(green.content, '🟢 worker กลับมาแล้ว (ออฟไลน์ไป 84 นาที)');
  assert.equal(h.client.posts.length, 0);
  const statusCalls = h.http.calls.filter((c) => c.path === '/api/research/status');
  assert.equal(statusCalls.length, 70, 'ถาม status ทุกรอบ');
  assert.ok(statusCalls.every((c) => c.headers['x-api-key'] === 'S3CRET' && !('x-research-secret' in c.headers)), 'กุญแจบอทเดิม · ไม่ส่งความลับ worker');
  assert.ok(h.http.calls.every((c) => c.path === '/api/research/status'), 'ปิดสรุป = ไม่แตะ bot-state/digest');
}

test('ออฟไลน์ ≥ 10 นาที (นับจาก lastSeenAt) → DM ครั้งเดียว → ซ้ำที่ 60 นาที → กลับ online = DM เขียว (ออฟไลน์ไป x นาที)', async () => {
  checkOffline(await scenarioOffline());
});

async function scenarioContact({ mod = RC } = {}) {
  // นาที 0 online → นาที 1–70 ติดต่อ route ไม่ได้ (สลับ เน็ตหลุด / HTTP 503 / ตอบผิดรูป) → นาที 71+ กลับมา (worker online)
  const failAt = (m) => (m % 3 === 1 ? netError() : m % 3 === 2 ? httpError(503) : { success: true, enabled: true, status: 'weird' });
  const h = makeWatch({
    mod,
    statusAt: (t) => { const m = Math.round((t - T0) / MIN); return m === 0 || m >= 71 ? statusBody({ online: true, lastSeenMs: t }) : failAt(m); },
  });
  h.w.start();
  const counts = {};
  for (let m = 0; m <= 72; m += 1) {
    await h.at(T0 + m * MIN, `นาที ${m}`);
    counts[m] = h.client.dms.length;
  }
  // ระหว่างออฟไลน์ที่แจ้งแล้ว ติดต่อไม่ได้ไม่ล้างสถานะ worker → กลับมาเห็น online = 🟢
  let phase = 'offline';
  const g = makeWatch({
    mod,
    statusAt: (t) => (phase === 'offline' ? statusBody({ online: false, lastSeenMs: T0 - 15 * MIN }) : phase === 'down' ? netError() : statusBody({ online: true, lastSeenMs: t })),
  });
  g.w.start();
  await g.at(T0, 'ออฟไลน์');
  phase = 'down';
  for (let m = 1; m <= 5; m += 1) await g.at(T0 + m * MIN, `ติดต่อไม่ได้ ${m}`);
  const sinceDuringDown = g.w.snapshot().offlineSince;
  phase = 'online';
  await g.at(T0 + 6 * MIN, 'กลับมา');
  return { h, counts, g, sinceDuringDown };
}

function checkContact({ h, counts, g, sinceDuringDown }) {
  assert.equal(counts[2], 0, 'ล้ม 2 ครั้ง = ยังไม่แจ้ง');
  assert.equal(counts[3], 1, 'ล้มครั้งที่ 3 = แจ้ง');
  assert.equal(counts[62], 1, 'ภายในชั่วโมง = ไม่ซ้ำ');
  assert.equal(counts[63], 2, 'ครบชั่วโมงยังล้ม = ซ้ำ');
  assert.equal(counts[72], 2, 'กลับมาติดต่อได้ (worker online) = ไม่มีแจ้งเพิ่ม');
  assert.ok(h.client.dms.every((d) => d.content.startsWith('⚠️ บอทติดต่อ Vercel ไม่ได้')), 'ติดต่อไม่ได้ ≠ worker ออฟไลน์ (ไม่มี 🔴/🟢)');
  assert.equal(h.client.dms[0].content, '⚠️ บอทติดต่อ Vercel ไม่ได้ (ล้มติดกัน 3 ครั้ง · ตอบผิดรูป) — ยังไม่รู้สถานะ worker ค้นคว้า (ไม่นับเป็นออฟไลน์) · ตรวจ Vercel/เน็ตของ Railway');
  assert.match(h.client.dms[1].content, /^⚠️ บอทติดต่อ Vercel ไม่ได้ \(ล้มติดกัน 63 ครั้ง · ตอบผิดรูป\)/u);
  assert.ok(h.logger.logs.some((l) => l.includes('✅ ติดต่อ Vercel ได้แล้ว (หลังล้มติดกัน 70 ครั้ง)')));
  assert.equal(h.w.snapshot().offlineAlertAt, null);
  assert.deepEqual(g.client.dms.map((d) => d.content.slice(0, 2)), ['🔴', '⚠️', '🟢'], 'สถานะ worker ค้างข้ามช่วงติดต่อไม่ได้ (ไม่ล้าง ไม่เดา)');
  assert.equal(sinceDuringDown, T0 - 15 * MIN);
  assert.equal(g.client.dms[2].content, '🟢 worker กลับมาแล้ว (ออฟไลน์ไป 21 นาที)');
}

test('ติดต่อ route ไม่ได้ (เน็ต/HTTP/ตอบผิดรูป) ≠ worker ออฟไลน์: ล้ม 3 ครั้งติด → ⚠️ ≤ 1 ครั้ง/ชม. · สถานะ worker คงค่าล่าสุด', async () => {
  checkContact(await scenarioContact());
});

test('เว็บปิดระบบค้นคว้า (enabled:false) = ไม่เฝ้าออฟไลน์ (log ครั้งเดียว) · เปิดกลับแล้วออฟไลน์เกิน 10 นาที = แจ้งทันที · worker ไม่เคยมีชีพจร = นับจากครั้งแรกที่เห็น', async () => {
  let phase = 'disabled';
  const h = makeWatch({
    statusAt: () => (phase === 'disabled' ? statusBody({ enabled: false }) : phase === 'offline' ? statusBody({ online: false, lastSeenMs: T0 - 30 * MIN }) : statusBody({ online: false, lastSeenMs: null, quotaPct: null })),
  });
  h.w.start();
  for (let m = 0; m < 30; m += 1) await h.at(T0 + m * MIN);
  assert.equal(h.client.dms.length, 0);
  assert.equal(h.logger.logs.filter((l) => l.includes('⏸️ เว็บปิดระบบค้นคว้า')).length, 1);
  phase = 'offline';
  await h.at(T0 + 30 * MIN);
  assert.equal(h.client.dms.length, 1);
  assert.match(h.client.dms[0].content, /^🔴 worker ค้นคว้าออฟไลน์ตั้งแต่ 09:30 \(2 ต\.ค\. 69\)/u);
  // ไม่มี lastSeenAt (ไม่เคยเห็น worker): นับจากครั้งแรกที่ตัวเฝ้าเห็นออฟไลน์
  const n = makeWatch({ statusAt: () => statusBody({ online: false, lastSeenMs: null, quotaPct: null }) });
  n.w.start();
  for (let m = 0; m <= 9; m += 1) await n.at(T0 + m * MIN);
  assert.equal(n.client.dms.length, 0, '9 นาทีหลังเห็นครั้งแรก = ยัง');
  await n.at(T0 + 10 * MIN);
  assert.equal(n.client.dms.length, 1);
  assert.match(n.client.dms[0].content, /^🔴 worker ค้นคว้าออฟไลน์ตั้งแต่ 10:00 \(2 ต\.ค\. 69\) · ยังไม่เคยเห็นชีพจร worker — /u);
});

// ============================================================
// 3) ล้มติดกัน (ผลจากบัตรจริง → hub → ตัวเฝ้า)
// ============================================================
/** บัตรข้อเท็จจริงตัวจริง (createResearchCards) ที่ client เดียวกับตัวเฝ้า · deliver = งาน 1 งานได้การ์ด (+ใบที่สอง) ในรอบถามแรก */
function makeCardsHarness({ mod = RC, client }) {
  const sched = { now: T0, timers: [] };
  const responses = new Map();
  const http = {
    async get(url) {
      const u = new URL(url);
      if (u.pathname === '/api/research/cards') return { data: clone(responses.get(u.searchParams.get('jobId'))) };
      if (u.pathname === '/api/research/status') return { data: statusBody({ online: true, lastSeenMs: sched.now, quotaPct: 80 }) };
      if (u.pathname === '/api/bot/posted') return { data: { success: true, item: null } };
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body) {
      if (new URL(url).pathname === '/api/bot/posted') return { data: { success: true, item: { ...body } } };
      throw new Error(`unexpected POST ${url}`);
    },
  };
  const logger = makeLogger();
  const ctl = mod.createResearchCards({
    enabled: true,
    env: {},
    http,
    EmbedBuilder: FakeEmbed,
    client,
    buildApiUrl: (path) => `${API}${path}`,
    buildApiHeaders: () => ({ 'x-api-key': 'S3CRET' }),
    logger,
    now: () => sched.now,
    setTimeout: (fn, ms) => { const t = { fn, at: sched.now + ms, cleared: false }; sched.timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
  });
  let seq = 0;
  const channelSends = [];
  async function deliver(jobId, { card, editor = null }) {
    responses.set(jobId, {
      success: true, jobId, found: true, enabled: true, mode: 'write', request: { status: 'done' },
      cards: { id: jobId, revision: 1, mode: 'write', plan: [], cards: [], raw_corrections: [], ...card }, summary: null, editor,
    });
    const replies = [];
    const message = {
      id: `70000000000000${String(++seq).padStart(4, '0')}`, channelId: 'CH1', guild: { ownerId: OWNER }, replies,
      channel: { send: async (p) => { channelSends.push(clone(p)); return { id: 'x' }; } },
      reply: async (payload) => { replies.push(payload); return { id: `90000000000000${String(++seq).padStart(4, '0')}`, react: async () => {} }; },
    };
    ctl.watch({ jobId, message, processingMsg: null });
    const timer = sched.timers.filter((t) => !t.cleared).at(-1);
    timer.cleared = true;
    sched.now = timer.at;
    await settleWithin(Promise.resolve(timer.fn()), `รอบถามบัตร ${jobId}`);
    for (let i = 0; i < 5; i += 1) await flush();
    return message;
  }
  return { ctl, deliver, logger, channelSends };
}

const editorRecord = (status) => ({ id: 'x', status, mode: 'write', used_cards: [], corrections: [], additions: [], not_used: [], suggested_dimensions: [], staff_notes: [], warnings: [], flags: [], reason: status === 'done' ? null : 'เหตุทดสอบ' });

async function scenarioStreak({ mod = RC } = {}) {
  const client = makeClient();
  const h = makeWatch({ mod, client });
  h.w.start();
  const cards = makeCardsHarness({ mod, client });
  const after = [];
  const step = async (fn) => { await fn(); await settleWithin(h.w.flush(), 'ส่งแจ้งล้มติดกัน'); after.push(client.dms.length); };
  await step(() => cards.deliver('q_wd_fail_001', { card: { status: 'failed', flags: ['ENCODING_BROKEN'] } }));
  await step(() => cards.deliver('q_wd_fail_002', { card: { status: 'done', flags: [] }, editor: editorRecord('failed') }));
  await step(() => cards.deliver('q_wd_fail_003', { card: { status: 'failed', flags: ['AGENT_FAILED', 'BRAIN_UNAVAILABLE'] } }));
  const n = [];
  const note = (event) => n.push(h.w.noteOutcome(event));
  note({ kind: 'card', jobId: 'q_wd_skip_004', status: 'skipped', flags: [] }); // ไม่นับ ไม่รีเซ็ต
  note({ kind: 'editor', jobId: 'q_wd_fail_003', status: 'not_ready' }); // ไม่นับ
  note({ kind: 'card', jobId: 'q_wd_fail_001', status: 'failed', flags: [] }); // งานเดิม = ไม่นับซ้ำ
  note({ kind: 'card', jobId: 'q_wd_fail_005', status: 'failed', flags: [] });
  note({ kind: 'card', jobId: 'q_wd_fail_006', status: 'failed', flags: [] });
  await settleWithin(h.w.flush(), 'flush');
  after.push(client.dms.length);
  note({ kind: 'editor', jobId: 'q_wd_fail_007', status: 'failed' }); // ครบ 6
  await settleWithin(h.w.flush(), 'flush');
  after.push(client.dms.length);
  note({ kind: 'card', jobId: 'q_wd_done_008', status: 'done', flags: [] }); // รีเซ็ต
  note({ kind: 'card', jobId: 'q_wd_fail_009', status: 'failed', flags: [] });
  note({ kind: 'card', jobId: 'q_wd_fail_010', status: 'failed', flags: [] });
  note({ kind: 'card', jobId: 'q_wd_fail_011', status: 'failed', flags: [] });
  await settleWithin(h.w.flush(), 'flush');
  after.push(client.dms.length);
  return { h, client, cards, after, n };
}

function checkStreak({ client, cards, after, n }) {
  assert.deepEqual(after, [0, 0, 1, 1, 2, 3], 'แจ้งที่ 3 · 6 · และ 3 ใหม่หลังรีเซ็ต');
  assert.deepEqual(n, [null, null, 3, 4, 5, 6, 0, 1, 2, 3], 'ความยาว streak หลังแต่ละผล');
  assert.equal(client.dms[0].content,
    `🔴 รีเสิร์ชล้มติดกัน 3 ข่าว — ล่าสุด: q\\_wd\\_fail\\_003 (สมอง Codex ใช้ไม่ได้) · q\\_wd\\_fail\\_002 (บรรณาธิการล้ม) · q\\_wd\\_fail\\_001 (ไฟล์ผลเข้ารหัสผิด) · ${CHECK_HINT}`);
  assert.ok(client.dms[1].content.startsWith('🔴 รีเสิร์ชล้มติดกัน 6 ข่าว — ล่าสุด: q\\_wd\\_fail\\_007 (บรรณาธิการล้ม) · q\\_wd\\_fail\\_006 (รีเสิร์ชล้ม) · q\\_wd\\_fail\\_005 (รีเสิร์ชล้ม) · '));
  assert.ok(client.dms[2].content.startsWith('🔴 รีเสิร์ชล้มติดกัน 3 ข่าว — ล่าสุด: q\\_wd\\_fail\\_011 (รีเสิร์ชล้ม) · q\\_wd\\_fail\\_010'));
  assert.ok(client.dms.every((d) => d.to === OWNER && d.allowedMentions.parse.length === 0));
  // บัตรยังทำงานเดิม: ทุกงานได้บัตร (job 2 ได้ใบที่สองด้วย) · ธง BRAIN_UNAVAILABLE ยังเตือนในห้องแบบ W5 เดิม
  assert.ok(cards.logger.logs.filter((l) => l.includes('โพสต์บัตรข้อเท็จจริง')).length === 3);
  assert.ok(cards.logger.logs.some((l) => l.includes('โพสต์ใบที่สอง (ผลบรรณาธิการ) job q_wd_fail_00')));
  assert.equal(cards.channelSends.length, 1);
}

test('ล้มติดกัน ≥ 3 งาน (บัตรจริง: การ์ด failed · ธง ENCODING_BROKEN/BRAIN_UNAVAILABLE/AGENT_FAILED · บรรณาธิการ failed) → DM พร้อม jobId 3 ตัวล่าสุด · ซ้ำที่ 6 · done รีเซ็ต · skipped/not_ready/งานเดิมไม่นับ', async () => {
  checkStreak(await scenarioStreak());
});

test('hub ผลบัตร: ไม่มีตัวเฝ้าที่ start = บัตรไม่สร้าง event · stop แล้วเลิกฟัง · client คนละตัวไม่รั่วถึงกัน', async () => {
  const client = makeClient();
  const seen = [];
  const cards = makeCardsHarness({ client });
  await cards.deliver('q_hub_001', { card: { status: 'failed', flags: [] } });
  const off = RC.subscribeCardOutcomes(client, (e) => seen.push(e));
  await cards.deliver('q_hub_002', { card: { status: 'done', flags: ['STALE_NEWS'] }, editor: editorRecord('done') });
  off();
  await cards.deliver('q_hub_003', { card: { status: 'failed', flags: [] } });
  assert.deepEqual(seen, [
    { kind: 'card', jobId: 'q_hub_002', status: 'done', flags: ['STALE_NEWS'] },
    { kind: 'editor', jobId: 'q_hub_002', status: 'done' },
  ]);
  const other = makeClient();
  const otherSeen = [];
  RC.subscribeCardOutcomes(other, (e) => otherSeen.push(e));
  await makeCardsHarness({ client }).deliver('q_hub_004', { card: { status: 'failed', flags: [] } });
  assert.deepEqual(otherSeen, [], 'บอทคนละตัวไม่เห็นผลของกัน');
  const h = makeWatch({ client });
  h.w.start();
  h.w.stop();
  await makeCardsHarness({ client }).deliver('q_hub_005', { card: { status: 'failed', flags: [] } });
  assert.equal(h.w.snapshot().streak, 0, 'stop แล้วเลิกฟังผลบัตร');
});

// ============================================================
// 4) สรุปรายวัน
// ============================================================
async function scenarioDigest({ mod = RC } = {}) {
  const state = makeStateStore({ lastSentKey: '2026-10-01', sentAt: '2026-10-01T00:30:05.000Z', status: 'sent' }, { revision: 7 });
  const clock = { t: AT_0730 - 2 * MIN };
  const queries = [];
  const digestAt = (q) => { queries.push(q); return DIGEST_BODY(); };
  const client = makeClient();
  const a = makeWatch({ mod, env: ON, clock, state, digestAt, client, instance: 'botA_1' });
  a.w.start();
  const timeline = [];
  for (const m of [-2, -1, 0, 1, 2]) {
    await a.at(AT_0730 + m * MIN, `A ${m}`);
    timeline.push([m, client.dms.length, state.reads]);
  }
  a.w.stop();
  // รีสตาร์ต: instance ใหม่ หน่วยความจำว่าง · สถานะเดิมอยู่ store
  const b = makeWatch({ mod, env: ON, clock, state, digestAt, client, instance: 'botB_2' });
  b.w.start();
  await b.at(AT_0730 + 5 * MIN, 'B หลังรีสตาร์ต');
  timeline.push([5, client.dms.length, state.reads]);
  await b.at(AT_0730 + DAY - MIN, 'B วันรุ่งขึ้น 07:29');
  timeline.push(['next-1', client.dms.length, state.reads]);
  await b.at(AT_0730 + DAY, 'B วันรุ่งขึ้น 07:30');
  timeline.push(['next', client.dms.length, state.reads]);
  return { a, b, state, queries, timeline, client };
}

function checkDigest({ state, queries, timeline, client }) {
  assert.deepEqual(timeline, [
    [-2, 0, 1], // 07:28 รอบล่าสุดคือ 1 ต.ค. ซึ่งส่งแล้ว (อ่าน store ครั้งเดียว)
    [-1, 0, 1], // 07:29 จำแล้ว ไม่อ่านซ้ำ
    [0, 1, 2], // 07:30 ส่ง
    [1, 1, 2],
    [2, 1, 2],
    [5, 1, 3], // รีสตาร์ต: อ่าน store → ส่งแล้ว = ไม่ส่งซ้ำ
    ['next-1', 1, 3],
    ['next', 2, 4],
  ]);
  assert.deepEqual(queries, [
    { since: '2026-10-01T00:30:00.000Z', until: '2026-10-02T00:30:00.000Z' },
    { since: '2026-10-02T00:30:00.000Z', until: '2026-10-03T00:30:00.000Z' },
  ], 'ช่วง = เมื่อวาน 07:30 → วันนี้ 07:30 (เวลาไทย)');
  assert.deepEqual(state.writes.map((w) => [w.expectedRevision, w.state.status, w.state.claimKey ?? null, w.state.lastSentKey, w.state.instance]), [
    [7, 'sending', '2026-10-02', '2026-10-01', 'botA_1'],
    [8, 'sent', null, '2026-10-02', 'botA_1'],
    [9, 'sending', '2026-10-03', '2026-10-02', 'botB_2'],
    [10, 'sent', null, '2026-10-03', 'botB_2'],
  ], 'จองแบบ cas ก่อนส่ง → บันทึกว่าส่งแล้ว');
  assert.equal(state.writes[1].state.via, 'dm');
  const [d1, d2] = client.dms;
  assert.ok(d1.content.startsWith('📊 สรุปรีเสิร์ช 2 ต.ค. 69 (1 ต.ค. 69 07:30 → 2 ต.ค. 69 07:30)'), d1.content.slice(0, 80));
  assert.ok(d2.content.startsWith('📊 สรุปรีเสิร์ช 3 ต.ค. 69 (2 ต.ค. 69 07:30 → 3 ต.ค. 69 07:30)'));
  assert.ok(d1.content.length <= 1800 && d2.content.length <= 1800, 'ข้อความ ≤ 1,800 ตัวอักษร');
  assert.equal(d1.to, OWNER);
  assert.deepEqual(d1.allowedMentions, { parse: [] });
}

test('สรุปรายวัน 07:30 เวลาไทย: 07:29 ไม่ส่ง · 07:30 ส่ง (ช่วงเมื่อวาน→วันนี้) · ทนรีสตาร์ต (store bot-state) · วันรุ่งขึ้นส่งใหม่ · ≤ 1,800 ตัวอักษร', async () => {
  checkDigest(await scenarioDigest());
});

async function scenarioOverlap({ mod = RC } = {}) {
  const state = makeStateStore({ lastSentKey: '2026-10-01', status: 'sent' }, { revision: 2 });
  const clock = { t: AT_0730 };
  const client = makeClient();
  const a = makeWatch({ mod, env: ON, clock, state, client, instance: 'botA' });
  const b = makeWatch({ mod, env: ON, clock, state, client, instance: 'botB' });
  a.w.start();
  b.w.start();
  await settleWithin(Promise.all([a.fire('A'), b.fire('B')]), 'สองบอทพร้อมกัน');
  const afterRace = client.dms.length;
  await b.at(AT_0730 + 5 * MIN, 'B 07:35');
  await a.at(AT_0730 + 6 * MIN, 'A 07:36');
  return { state, client, afterRace, logs: [...a.logger.logs, ...b.logger.logs] };
}

function checkOverlap({ state, client, afterRace, logs }) {
  assert.equal(afterRace, 1, 'สองบอทถึงเวลาพร้อมกัน = ส่งครั้งเดียว');
  assert.equal(client.dms.length, 1, 'ลองซ้ำทีหลังก็ไม่ส่งซ้ำ');
  assert.equal(state.item.state.lastSentKey, '2026-10-02');
  assert.ok(logs.some((l) => /instance อื่นเขียนก่อน|instance อื่นกำลังส่ง|ส่งไปแล้ว/u.test(l)), 'ฝั่งที่แพ้บอกเหตุใน log');
}

test('สองบอททับกันช่วง redeploy: ถึง 07:30 พร้อมกัน → จอง cas ชนะคนเดียว → ส่งครั้งเดียว · ลองซ้ำทีหลังเห็นว่าส่งแล้ว', async () => {
  checkOverlap(await scenarioOverlap());
});

test('จองค้างของบอทที่ตาย: < 10 นาที = รอ (ลองทุก 5 นาที) · ≥ 10 นาที = รับต่อแล้วส่ง · จองค้างของตัวเอง (ชื่อเดิม) = รับต่อทันที', async () => {
  const state = makeStateStore({ lastSentKey: '2026-10-01', status: 'sending', claimKey: '2026-10-02', claimedAt: '2026-10-02T00:30:10.000Z', instance: 'dead_bot' }, { revision: 5 });
  const h = makeWatch({ env: ON, state, instance: 'botC' });
  h.w.start();
  const counts = [];
  for (const m of [1, 2, 6, 11]) {
    await h.at(AT_0730 + m * MIN);
    counts.push([m, h.client.dms.length, state.reads]);
  }
  assert.deepEqual(counts, [[1, 0, 1], [2, 0, 1], [6, 0, 2], [11, 1, 3]], 'รอเว้น 5 นาที · ครบ 10 นาทีหลังจองจึงรับต่อ');
  assert.equal(state.item.state.lastSentKey, '2026-10-02');
  assert.ok(h.logger.logs.some((l) => l.includes('instance อื่นกำลังส่ง')));
  const own = makeStateStore({ lastSentKey: '2026-10-01', status: 'sending', claimKey: '2026-10-02', claimedAt: '2026-10-02T00:30:10.000Z', instance: 'botD' }, { revision: 2 });
  const d = makeWatch({ env: ON, state: own, instance: 'botD' });
  d.w.start();
  await d.at(AT_0730 + MIN);
  assert.equal(d.client.dms.length, 1, 'จองค้างของตัวเอง (ก่อนรีสตาร์ตชื่อเดิม) = ส่งต่อได้เลย');
});

test('บอทกำลังปิดตัว (SIGTERM ช่วง redeploy) ระหว่างดึงสรุป → ไม่ส่ง (client กำลังถูกตัด) + ปล่อยจอง → instance ใหม่รับไปส่งครั้งเดียว', async () => {
  const state = makeStateStore({ lastSentKey: '2026-10-01', status: 'sent' }, { revision: 4 });
  const clock = { t: AT_0730 };
  const client = makeClient();
  let down = false;
  const old = makeWatch({ env: ON, clock, state, client, instance: 'oldBot', isShuttingDown: () => down, digestAt: () => { down = true; return DIGEST_BODY(); } });
  old.w.start();
  await old.fire('ตัวเก่า (SIGTERM มาระหว่างดึงสรุป)');
  assert.equal(client.dms.length, 0, 'ตัวเก่าไม่ส่ง');
  assert.deepEqual([state.item.state.status, state.item.state.claimKey, state.item.state.lastError], ['failed', null, 'shutdown'], 'ปล่อยจองแล้ว');
  const fresh = makeWatch({ env: ON, clock, state, client, instance: 'newBot' });
  fresh.w.start();
  await fresh.at(AT_0730 + MIN, 'ตัวใหม่');
  assert.equal(client.dms.length, 1, 'ตัวใหม่ส่งครั้งเดียว');
  assert.equal(state.item.state.lastSentKey, '2026-10-02');
});

test('ดึงสรุปล้ม: ปล่อยจอง (failed) → ลองใหม่ 5 นาทีถัดไป → ส่งครั้งเดียว · ล้มครบ 12 ครั้ง = ส่งฉบับ "ดึงสรุปไม่ได้" แล้วเลิกจนรอบหน้า', async () => {
  const state = makeStateStore({ lastSentKey: '2026-10-01', status: 'sent' }, { revision: 1 });
  let fails = 1;
  const h = makeWatch({ env: ON, state, digestAt: () => (fails-- > 0 ? httpError(500) : DIGEST_BODY()) });
  h.w.start();
  await h.at(AT_0730);
  assert.equal(h.client.dms.length, 0);
  for (const m of [1, 2, 3, 4]) await h.at(AT_0730 + m * MIN);
  assert.equal(state.reads, 1, 'ไม่ถามซ้ำก่อนครบ 5 นาที');
  await h.at(AT_0730 + 5 * MIN);
  assert.equal(h.client.dms.length, 1);
  assert.deepEqual(state.writes.map((w) => w.state.status), ['sending', 'failed', 'sending', 'sent']);
  assert.equal(state.writes[1].state.lastError, 'HTTP 500');
  assert.ok(!h.client.dms[0].content.includes('ดึงสรุปจาก Vercel ไม่ได้'));
  // ล้มตลอด: ครั้งที่ 12 (08:25) ส่งฉบับบอกว่าดึงไม่ได้ · หลังจากนั้นเงียบจนรอบหน้า
  const s2 = makeStateStore({ lastSentKey: '2026-10-01', status: 'sent' }, { revision: 1 });
  const g = makeWatch({ env: ON, state: s2, digestAt: () => httpError(503) });
  g.w.start();
  for (let k = 0; k < 12; k += 1) await g.at(AT_0730 + k * 5 * MIN, `ครั้งที่ ${k + 1}`);
  assert.equal(g.client.dms.length, 1);
  assert.ok(g.client.dms[0].content.startsWith('📊 สรุปรีเสิร์ช 2 ต.ค. 69'));
  assert.ok(g.client.dms[0].content.includes('⚠️ ดึงสรุปจาก Vercel ไม่ได้ (HTTP 503)'));
  assert.equal(s2.item.state.lastSentKey, '2026-10-02');
  await g.at(AT_0730 + 70 * MIN);
  assert.equal(g.client.dms.length, 1);
  assert.equal(s2.reads, 12, 'ครบรอบแล้วไม่ถามอีก');
});

test('env: RESEARCH_DIGEST=0 ปิดเฉพาะสรุป · HOUR/MINUTE เลื่อนเวลา (09:05) · ค่าผิดรูป = 07:30 · ไม่มีปลายทาง = เตือนตอนเริ่ม', async () => {
  const off = makeWatch({ env: QUIET, state: makeStateStore() });
  off.w.start();
  await off.at(AT_0730);
  await off.at(AT_0730 + DAY);
  assert.ok(off.http.calls.every((c) => c.path === '/api/research/status'), 'ปิดสรุป = ไม่แตะ bot-state/digest');
  assert.ok(off.logger.logs.some((l) => l.includes('สรุปรายวัน ปิด (RESEARCH_DIGEST=0)')));
  const queries = [];
  const nine = makeWatch({
    env: { ...ON, RESEARCH_DIGEST_HOUR: '9', RESEARCH_DIGEST_MINUTE: '05' },
    state: makeStateStore({ lastSentKey: '2026-10-01', status: 'sent' }),
    digestAt: (q) => { queries.push(q); return DIGEST_BODY(); },
  });
  nine.w.start();
  await nine.at(AT_0730);
  await nine.at(Date.UTC(2026, 9, 2, 2, 4, 0)); // 09:04
  assert.equal(nine.client.dms.length, 0);
  await nine.at(Date.UTC(2026, 9, 2, 2, 5, 0)); // 09:05
  assert.equal(nine.client.dms.length, 1);
  assert.deepEqual(queries, [{ since: '2026-10-01T02:05:00.000Z', until: '2026-10-02T02:05:00.000Z' }]);
  assert.ok(nine.logger.logs.some((l) => l.includes('สรุปรายวัน 09:05 เวลาไทย')));
  for (const [hour, minute] of [['24', '60'], ['x', '-1'], ['7.5', '3O'], ['', '']]) {
    const w = makeWatch({ env: { ...ON, RESEARCH_DIGEST_HOUR: hour, RESEARCH_DIGEST_MINUTE: minute } });
    const { digestHour, digestMinute } = w.w.snapshot().settings;
    assert.deepEqual([digestHour, digestMinute], [7, 30], `${hour}/${minute} = ค่าเริ่มต้น`);
  }
  assert.deepEqual(RC.digestSlotAt(Date.UTC(2026, 9, 1, 23, 0, 0)), { key: '2026-10-01', startMs: Date.UTC(2026, 8, 30, 0, 30), endMs: Date.UTC(2026, 9, 1, 0, 30) }, '06:00 เวลาไทย = ยังเป็นรอบเมื่อวาน');
  const nobody = makeWatch({ env: { RESEARCH_AGENT: '1' } });
  nobody.w.start();
  assert.ok(nobody.logger.logs.some((l) => l.includes('⚠️ ไม่มีปลายทางแจ้งเตือน')));
});

// ── ข้อความสรุป ──
const SLOT_FIXTURE = RC.digestSlotAt(Date.parse(DIGEST_UNTIL));

test('ข้อความสรุปรายวัน: ตัวเลขครบตามสเปก (ข่าว · เข้าเนื้อ/ไม่ทัน/ไม่ผ่าน/ล้ม/เข้ารหัสผิด · แก้/เพิ่ม · ธง · เวลา · ค่าใช้จ่าย · โควตา · 👍👎 · ข่าวที่ควรดู + ลิงก์)', () => {
  const text = RC.renderDigestMessage(DIGEST_BODY(), { slot: SLOT_FIXTURE, quota: { pct: 63, account: 'main' }, caseUrl: (id) => `${API}/generation-logs/${id}` });
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 11), [
    '📊 สรุปรีเสิร์ช 21 ก.ย. 69 (20 ก.ย. 69 07:30 → 21 ก.ย. 69 07:30)',
    '📰 ข่าวทั้งหมด 7 · ผ่านระบบใหม่ 6 (write 4 · assist 1 · shadow 1)',
    '🧾 เข้าเนื้อ 1 · ไม่ทัน 1 · ไม่ผ่านเกณฑ์ 1 · ล้ม 1 · ไฟล์เข้ารหัสผิด 1',
    '✏️ แก้ข้อผิดรวม 2 จุด · เพิ่มข้อมูลรวม 3 จุด',
    '⏱️ เฉลี่ย: รอการ์ด 1.8 นาที · บรรณาธิการ 41 วิ · ทั้งท่อ 6.2 นาที',
    '🚩 ธง: ข่าวเก่า 1 · ขัดต้นฉบับ 1 · ยืนยันต้นทางไม่ได้ 1 · ไฟล์เข้ารหัสผิด 1 · เอเจนต์ล้ม 1',
    '🤖 เอเจนต์ 4 งาน (สำเร็จ 2 · ล้ม 1 · ข้าม 1) · เฉลี่ย 3.6 นาที/งาน',
    '💵 ค่าเครื่องมือ $0.030 · AI ประมาณ $5.95 (2347 ครั้ง · ทุกงานในช่วง)',
    '🔋 โควตา Codex ล่าสุด 63% (บัญชี main)',
    '👍👎 ใบแรก 👍 1 👎 2 · ใบสอง 👍 0 👎 1 · ได้ 👎: q\\_digest\\_a, q\\_digest\\_b, q\\_digest\\_old',
    '👀 ข่าวที่ควรดู:',
  ]);
  assert.equal(lines.length, 14);
  assert.match(lines[11], /^• #06501 เนย-แจม สามพี่น้องช่วยกันผ่อนบ้านให้แม่ ยาวมาก\S*… — แก้ 2 · เพิ่ม 3 · 👎 1 <http:\/\/api\.test\/generation-logs\/06501>$/u);
  assert.equal(lines[12], '• #06502 พยาบาล ICU — 👎 1 <http://api.test/generation-logs/06502>');
  assert.equal(lines[13], '• q\\_digest\\_old — 👎 1');
  assert.ok(text.length <= 1800);
});

test('ข้อความสรุป: ≤ 1,800 ตัวอักษรเสมอ (ตัดรายการข่าวที่ควรดูก่อน ตัวเลขหลักอยู่ครบ) · escape markdown/mention · ส่วนที่อ่านไม่ได้บอกชัด · ดึงไม่ได้ทั้งก้อนยังส่ง', () => {
  const big = DIGEST_BODY();
  big.watchlist = Array.from({ length: 3 }, (_, i) => ({ jobId: `q_big_${i}`, caseId: `0${i}`, title: `**ด่วน** <@123> @everyone [คลิก](http://evil.test) ${'ก'.repeat(300)}`, corrections: 9, additions: 9, down: 9 }));
  big.errors = Array.from({ length: 9 }, (_, i) => `generation_logs: ${'x'.repeat(200)}${i}`);
  big.cards.votes.downJobs = Array.from({ length: 10 }, (_, i) => ({ jobId: `q_${'d'.repeat(60)}_${i}`, down: 1 }));
  const text = RC.renderDigestMessage(big, { slot: SLOT_FIXTURE, quota: null, caseUrl: (id) => `https://x.test/${'a'.repeat(700)}/${id}` });
  assert.ok(text.length <= 1800, `ยาว ${text.length}`);
  for (const head of ['📊 สรุปรีเสิร์ช', '📰 ข่าวทั้งหมด 7', '🧾 เข้าเนื้อ 1', '💵 ค่าเครื่องมือ', '🔋 โควตา Codex ล่าสุด: ไม่ทราบ', '⚠️ ข้อมูลไม่ครบ:']) assert.ok(text.includes(head), head);
  const small = RC.renderDigestMessage({ ...big, errors: [] }, { slot: SLOT_FIXTURE, caseUrl: () => null });
  assert.ok(small.includes('• #00 \\*\\*ด่วน\\*\\* \\<@123\\> @everyone \\[คลิก\\]('), 'ชื่อข่าว = DATA (escape · ตัด ≤ 50 ตัวอักษร)');
  assert.ok(!/(^|[^\\])<@123>/u.test(small), 'ไม่มี mention ดิบ');
  assert.ok(!/(^|[^\\])\[คลิก\]\(/u.test(small), 'ไม่มี masked link ดิบ');
  const partial = RC.renderDigestMessage({ ...DIGEST_BODY(), news: null, aiCost: null, errors: ['generation_logs: timeout', 'api_usage_logs: query_error'], enabled: false }, { slot: SLOT_FIXTURE });
  for (const head of ['⏸️ ระบบค้นคว้าฝั่งเว็บปิดอยู่', '📰 ข่าว: อ่านไม่ได้', 'AI: อ่านไม่ได้', '⚠️ ข้อมูลไม่ครบ: generation\\_logs: timeout · api\\_usage\\_logs: query\\_error']) assert.ok(partial.includes(head), head);
  const none = RC.renderDigestMessage(null, { slot: SLOT_FIXTURE, error: 'HTTP 503' });
  assert.deepEqual(none.split('\n'), [
    '📊 สรุปรีเสิร์ช 21 ก.ย. 69 (20 ก.ย. 69 07:30 → 21 ก.ย. 69 07:30)',
    '⚠️ ดึงสรุปจาก Vercel ไม่ได้ (HTTP 503) — ตัวเลขด้านล่างไม่ครบ · ดู log บอท/สถานะ Vercel',
    '📰 ข่าว: อ่านไม่ได้',
    '🚩 การ์ด/ธง: อ่านไม่ได้',
    '💵 ค่าเครื่องมือ: อ่านไม่ได้ · AI: อ่านไม่ได้',
    '🔋 โควตา Codex ล่าสุด: ไม่ทราบ',
  ]);
});

// ============================================================
// 5) ส่งหาเจ้าของ: DM → ห้องสำรอง → log
// ============================================================
async function fallbackCase({ mod = RC, env, dm = 'ok', channel = 'ok' }) {
  const client = makeClient({ dm, channel });
  const h = makeWatch({ mod, client, env: { ...env, RESEARCH_DIGEST: '0' }, statusAt: () => statusBody({ online: false, lastSeenMs: T0 - 20 * MIN }) });
  h.w.start();
  await h.at(T0);
  return h;
}

async function checkFallback(mod = RC) {
  const RED = `🔴 worker ค้นคว้าออฟไลน์ตั้งแต่ 09:40 (2 ต.ค. 69) — ข่าวกำลังออกแบบไม่มีรีเสิร์ช · ${CHECK_HINT}`;
  const ok = await fallbackCase({ mod, env: { ...ON, ADMIN_LOG_CHANNEL_ID: ADMIN_CH } });
  assert.equal(ok.client.dms.length, 1);
  assert.deepEqual(ok.client.lookups, [['user', OWNER]], 'DM ได้ = ไม่แตะห้องสำรอง');
  const closed = await fallbackCase({ mod, env: { ...ON, ADMIN_LOG_CHANNEL_ID: ADMIN_CH }, dm: 'closed' });
  assert.deepEqual(closed.client.posts, [{ channelId: ADMIN_CH, content: `<@${OWNER}> ${RED}`, allowedMentions: { parse: [], users: [OWNER] } }], 'DM ล้ม → ห้องสำรองพร้อม mention เจ้าของคนเดียว');
  assert.ok(closed.logger.logs.some((l) => l.includes('DM เจ้าของไม่สำเร็จ (worker-offline): Cannot send messages to this user — ส่งห้อง ADMIN_LOG_CHANNEL_ID แทน')));
  const unknown = await fallbackCase({ mod, env: { ...ON, ADMIN_LOG_CHANNEL_ID: ADMIN_CH }, dm: 'unknown' });
  assert.equal(unknown.client.posts.length, 1);
  const both = await fallbackCase({ mod, env: { ...ON, ADMIN_LOG_CHANNEL_ID: ADMIN_CH }, dm: 'closed', channel: 'fail' });
  assert.equal(both.client.posts.length, 0);
  assert.ok(both.logger.logs.some((l) => l.startsWith('[ResearchWatch] ⚠️ แจ้งเจ้าของไม่ได้ (worker-offline · ส่งไม่สำเร็จ): 🔴 worker ค้นคว้าออฟไลน์')), 'ล้มทั้งสองทาง = log');
  const noOwner = await fallbackCase({ mod, env: { RESEARCH_AGENT: '1', ADMIN_LOG_CHANNEL_ID: ADMIN_CH } });
  assert.deepEqual(noOwner.client.posts, [{ channelId: ADMIN_CH, content: RED, allowedMentions: { parse: [] } }], 'ไม่มี owner id = ห้อง ไม่ mention');
  assert.deepEqual(noOwner.client.lookups, [['channel', ADMIN_CH]]);
  const nowhere = await fallbackCase({ mod, env: { RESEARCH_AGENT: '1' } });
  assert.deepEqual(nowhere.client.lookups, [], 'ไม่มีปลายทาง = ไม่แตะ Discord');
  assert.ok(nowhere.logger.logs.some((l) => l.includes('แจ้งเจ้าของไม่ได้ (worker-offline · ไม่ตั้ง RESEARCH_AGENT_OWNER_DISCORD_ID / ADMIN_LOG_CHANNEL_ID (ข้าม))')));
}

test('ส่งหาเจ้าของ: DM ได้ = DM อย่างเดียว · DM ล้ม (ปิด DM/หา user ไม่เจอ) → ห้อง ADMIN_LOG_CHANNEL_ID + mention เจ้าของ → ล้มอีก = log · ไม่มี owner = ห้อง · ไม่มีทั้งคู่ = ข้าม + log', () => checkFallback());

// ============================================================
// 6) สัญญาข้ามฝั่งกับ route ตัวจริง (Supabase ปลอม)
// ============================================================
/** ส่งคำขอของบอทเข้า route ตัวจริง · ไม่ใช่ 2xx = โยนแบบ axios ({response:{status,data}}) */
async function viaRoute(handler, request) {
  const res = await settleWithin(Promise.resolve(handler(request)), 'route');
  const data = await res.json();
  if (res.status >= 400) throw Object.assign(new Error(`Request failed with status code ${res.status}`), { response: { status: res.status, data } });
  return { data };
}

/** http ของบอทที่ต่อ route จริง: status/bot-state/digest (กุญแจ x-api-key ของบอท = DISCORD_API_SECRET ฝั่งเว็บ) */
function routeHttp(calls = []) {
  return {
    calls,
    async get(url, opts) {
      const u = new URL(url);
      calls.push({ method: 'get', path: u.pathname });
      const req = new Request(`http://localhost${u.pathname}${u.search}`, { method: 'GET', headers: opts?.headers || {} });
      if (u.pathname === '/api/research/status') return viaRoute(() => statusRoute.GET(req), req);
      if (u.pathname === '/api/research/bot-state') return viaRoute(stateRoute.GET, req);
      if (u.pathname === '/api/research/digest') return viaRoute(digestRoute.GET, req);
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body, opts) {
      const u = new URL(url);
      calls.push({ method: 'post', path: u.pathname, body: clone(body) });
      const req = new Request(`http://localhost${u.pathname}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(opts?.headers || {}) }, body: JSON.stringify(body) });
      if (u.pathname === '/api/research/bot-state') return viaRoute(stateRoute.POST, req);
      throw new Error(`unexpected POST ${url}`);
    },
  };
}

async function withFakeDigestTimers(fn) {
  const saved = { ...digestLib.digestTimers };
  digestLib.digestTimers.setTimeout = () => ({ fake: true });
  digestLib.digestTimers.clearTimeout = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(digestLib.digestTimers, saved);
  }
}

test('สัญญาข้ามฝั่ง: คำตอบจริงของ /api/research/status → parseWatchStatus (online/offline/โควตา/เว็บปิด) ตรงกับที่ตัวเฝ้าตีความ', async () => {
  const sb = createFakeSupabase();
  globalThis.__W7_SB = sb;
  globalThis.__W7_SB_READY = true;
  const nowMs = Date.now();
  const seed = (minutesAgo, pct) => {
    const seen = new Date(nowMs - minutesAgo * MIN).toISOString();
    sb.rows.clear();
    sb.seed('rworker_owner-pc', 'research-workers', { id: 'owner-pc', workerId: 'owner-pc', lastSeenAt: seen, lastEvent: 'heartbeat', quota: { pct, account: 'b', at: seen }, revision: 4 }, seen);
    return Date.parse(seen);
  };
  await withEnv({ RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'write' }, async () => {
    const seenOnline = seed(2, 42);
    const online = await (await statusRoute.GET()).json();
    assert.deepEqual(RC.parseWatchStatus(online), { enabled: true, online: true, lastSeenMs: seenOnline, quota: { pct: 42, account: 'b' } });
    const seenOffline = seed(15, 12);
    const offline = await (await statusRoute.GET()).json();
    assert.deepEqual(RC.parseWatchStatus(offline), { enabled: true, online: false, lastSeenMs: seenOffline, quota: { pct: 12, account: 'b' } });
    sb.rows.clear();
    const empty = await (await statusRoute.GET()).json();
    assert.deepEqual(RC.parseWatchStatus(empty), { enabled: true, online: false, lastSeenMs: null, quota: null }, 'ไม่มี worker เลย = ออฟไลน์ (ไม่เคยเห็นชีพจร)');
  });
  await withEnv({}, async () => {
    const disabled = await (await statusRoute.GET()).json();
    assert.deepEqual(RC.parseWatchStatus(disabled), { enabled: false, online: false, lastSeenMs: null, quota: null });
  });
  for (const bad of [null, { success: false }, { success: true, enabled: true, status: 'weird' }, 'x']) assert.equal(RC.parseWatchStatus(bad), null, JSON.stringify(bad));
});

test('สัญญาข้ามฝั่ง: บอท ↔ /api/research/bot-state + /api/research/digest ตัวจริง — ส่งครั้งเดียว ทนรีสตาร์ต · สองบอทพร้อมกันชน 409 คนเดียว · ตัวเลขใน DM มาจาก route จริง', async () => {
  await withEnv({ RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'write', DISCORD_API_SECRET: 'S3CRET' }, () => withFakeDigestTimers(async () => {
    const sb = createTableSupabase();
    for (const [table, rows] of Object.entries(digestFixture())) sb.insertRows(table, rows);
    globalThis.__W7_SB = sb;
    globalThis.__W7_SB_READY = true;
    const clock = { t: Date.parse(DIGEST_UNTIL) }; // 21 ก.ย. 69 07:30 เวลาไทย = ช่วงของแถวตัวอย่าง
    const client = makeClient();
    const calls = [];
    const statusAt = () => statusBody({ online: true, lastSeenMs: clock.t, quotaPct: 55 });
    const mk = (instance) => {
      const http = routeHttp(calls);
      const statusGet = http.get;
      http.get = async (url, opts) => (new URL(url).pathname === '/api/research/status' ? { data: statusAt() } : statusGet(url, opts));
      return makeWatch({ env: ON, clock, client, instance, http });
    };
    const a = mk('botA');
    const b = mk('botB');
    a.w.start();
    b.w.start();
    await settleWithin(Promise.all([a.fire('A'), b.fire('B')]), 'สองบอทพร้อมกัน (route จริง)');
    assert.equal(client.dms.length, 1, 'ส่งครั้งเดียว');
    const doc = sb.rowsOf('store_items').find((r) => r.id === 'bstate_daily-digest');
    assert.equal(doc.data.state.lastSentKey, '2026-09-21');
    assert.equal(doc.data.state.status, 'sent');
    a.w.stop();
    const c = mk('botC'); // รีสตาร์ต
    c.w.start();
    await c.at(clock.t + 5 * MIN, 'รีสตาร์ต');
    assert.equal(client.dms.length, 1, 'รีสตาร์ตแล้วไม่ส่งซ้ำ (อ่านจาก route จริง)');
    const text = client.dms[0].content;
    for (const head of [
      '📊 สรุปรีเสิร์ช 21 ก.ย. 69 (20 ก.ย. 69 07:30 → 21 ก.ย. 69 07:30)',
      '📰 ข่าวทั้งหมด 7 · ผ่านระบบใหม่ 6 (write 4 · assist 1 · shadow 1)',
      '🧾 เข้าเนื้อ 1 · ไม่ทัน 1 · ไม่ผ่านเกณฑ์ 1 · ล้ม 1 · ไฟล์เข้ารหัสผิด 1',
      '💵 ค่าเครื่องมือ $0.030 · AI ประมาณ $5.95 (2347 ครั้ง · ทุกงานในช่วง)',
      '🔋 โควตา Codex ล่าสุด 55% (บัญชี main)',
      '• #06502 พยาบาล ICU — 👎 1 <http://api.test/generation-logs/06502>',
    ]) assert.ok(text.includes(head), head);
    const posts = calls.filter((x) => x.method === 'post');
    assert.deepEqual(posts.map((p) => [p.body.expectedRevision, p.body.state.status]).sort(), [[0, 'sending'], [0, 'sending'], [1, 'sent']].sort(),
      'สองบอทจองด้วย revision 0 พร้อมกัน → route ให้ผ่านคนเดียว (อีกคน 409) → คนชนะบันทึก sent');
    const digestCalls = calls.filter((x) => x.path === '/api/research/digest');
    assert.equal(digestCalls.length, 1, 'ดึงสรุปครั้งเดียว');
  }));
});

// ============================================================
// 7) mutation — ข้อสอบชุดเดียวกับข้างบนต้องแดง (ของจริงเขียว)
// ============================================================
test('mutation MB1: เกณฑ์ออฟไลน์ 10 นาที → 0 (แจ้งทันทีที่เห็น) → ข้อออฟไลน์แดง', async () => {
  const mod = cardMutant('const WORKER_OFFLINE_ALERT_MS = 10 * 60 * 1000;', 'const WORKER_OFFLINE_ALERT_MS = 0;');
  const r = await scenarioOffline({ mod });
  assert.equal(r.counts[0], 1, 'กลายพันธุ์ต้องแจ้งเร็วจริง');
  assert.throws(() => checkOffline(r), /ยังไม่แจ้ง/u);
});

test('mutation MB2: ไม่กันซ้ำ 60 นาที → แจ้งทุกรอบ → ข้อออฟไลน์แดง', async () => {
  const mod = cardMutant('    } else if (t - watch.offlineAlertAt >= OFFLINE_REPEAT_MS) {', '    } else if (true) {');
  const r = await scenarioOffline({ mod });
  assert.ok(r.counts[65] > 10);
  assert.throws(() => checkOffline(r), /ไม่ซ้ำ/u);
});

test('mutation MB3: ไม่ส่ง 🟢 ตอน worker กลับมา → ข้อออฟไลน์แดง', async () => {
  const mod = cardMutant('    if (status.online) {\n      if (watch.offlineAlertAt !== null) {', '    if (status.online) {\n      if (false) {');
  const r = await scenarioOffline({ mod });
  assert.equal(r.counts[80], 2);
  assert.throws(() => checkOffline(r), /เขียว/u);
});

test('mutation MB4: ตีความติดต่อไม่ได้เป็น worker ออฟไลน์ → ข้อติดต่อไม่ได้แดง (มี 🔴)', async () => {
  const mod = cardMutant('    watch.contactFails += 1;\n',
    "    watch.contactFails += 1;\n    if (watch.offlineAlertAt === null) { watch.offlineAlertAt = t; await notify('🔴 worker ค้นคว้าออฟไลน์ (เดาจากติดต่อไม่ได้)', 'guess'); }\n");
  const r = await scenarioContact({ mod });
  assert.ok(r.h.client.dms.some((d) => d.content.startsWith('🔴')));
  assert.throws(() => checkContact(r));
});

test('mutation MB5: แจ้งติดต่อไม่ได้ตั้งแต่ครั้งแรก (เกณฑ์ 3 → 1) → ข้อติดต่อไม่ได้แดง', async () => {
  const mod = cardMutant('const CONTACT_FAIL_ALERT_AT = 3;', 'const CONTACT_FAIL_ALERT_AT = 1;');
  const r = await scenarioContact({ mod });
  assert.equal(r.counts[1], 1);
  assert.throws(() => checkContact(r), /ยังไม่แจ้ง/u);
});

test('mutation MB6: แจ้งล้มติดกันทุก 2 งาน (3 → 2) → ข้อล้มติดกันแดง', async () => {
  const mod = cardMutant('const FAIL_STREAK_STEP = 3;', 'const FAIL_STREAK_STEP = 2;');
  const r = await scenarioStreak({ mod });
  assert.throws(() => checkStreak(r), /แจ้งที่ 3/u);
});

test('mutation MB7: done ไม่รีเซ็ต (นับล้มทั้งหมด) → ข้อล้มติดกันแดง', async () => {
  const mod = cardMutant("    for (let i = list.length - 1; i >= 0 && list[i][1].verdict === 'failed'; i--) failed.push(list[i]);",
    "    for (let i = list.length - 1; i >= 0; i--) if (list[i][1].verdict === 'failed') failed.push(list[i]);");
  const r = await scenarioStreak({ mod });
  assert.throws(() => checkStreak(r));
});

test('mutation MB8: บัตรไม่ส่งผลให้ตัวเฝ้า (ถอดบรรทัด emit ใน deliverCard) → ข้อล้มติดกันแดง', async () => {
  const mod = cardMutant('    emitCardOutcome(client, () => cardOutcomeEvent(state.jobId, card));\n', '');
  const r = await scenarioStreak({ mod });
  assert.equal(r.after[2], 0, 'กลายพันธุ์ต้องทำให้ไม่แจ้งจริง');
  assert.throws(() => checkStreak(r));
});

test('mutation MB9: สรุปรายวันไม่ดูว่าส่งแล้ว (store) → รีสตาร์ตแล้วส่งซ้ำ → ข้อสรุปรายวันแดง', async () => {
  const mod = cardMutant('    if (state.lastSentKey === slot.key) {', '    if (false) {');
  const r = await scenarioDigest({ mod });
  assert.throws(() => checkDigest(r));
});

test('mutation MB10: คิดรอบสรุปเป็น UTC (ไม่บวกเวลาไทย) → ส่งผิดเวลา/ผิดช่วง → ข้อสรุปรายวันแดง', async () => {
  const mod = cardMutant('  const local = t + BANGKOK_OFFSET_MS;\n  let endLocal', '  const local = t;\n  let endLocal');
  const r = await scenarioDigest({ mod });
  assert.throws(() => checkDigest(r));
});

test('mutation MB11: ไม่มีทางสำรองห้อง ADMIN_LOG_CHANNEL_ID → ข้อส่งหาเจ้าของแดง', async () => {
  const mod = cardMutant("    if (adminChannelId && client?.channels && typeof client.channels.fetch === 'function') {", '    if (false) {');
  await assert.rejects(checkFallback(mod));
});

test('mutation MB12: ไม่บีบความยาวข้อความ (ไม่ตัดรายการข่าวที่ควรดู) → ข้อ ≤ 1,800 แดง', () => {
  const mod = cardMutant("  return fitDigestText(lines, watch.length > 0 ? ['👀 ข่าวที่ควรดู:', ...watch] : [], DIGEST_MAX_CHARS);",
    "  return [...lines, '👀 ข่าวที่ควรดู:', ...watch].join('\\n');");
  const big = DIGEST_BODY();
  big.watchlist = Array.from({ length: 3 }, (_, i) => ({ jobId: `q_big_${i}`, caseId: `0${i}`, title: 'ก'.repeat(300), corrections: 1, additions: 0, down: 1 }));
  const text = mod.renderDigestMessage(big, { slot: SLOT_FIXTURE, caseUrl: (id) => `https://x.test/${'a'.repeat(700)}/${id}` });
  assert.ok(text.length > 1800, 'กลายพันธุ์ต้องยาวเกินจริง');
});

test('mutation MB13: index.js ไม่หยุดตัวเฝ้าตอนปิดตัว → interval ค้าง → ข้อต่อสาย index.js แดง', async () => {
  const src = mutate(BOT_SRC, '  researchWatchdog.stop(); // ★ 2 ต.ค. 69 (W7): ล้าง setInterval ของตัวเฝ้า (ไม่ได้เริ่ม/สวิตช์ปิด = no-op)\n', '');
  const r = await runBotLifecycle({ env: ON, src });
  assert.throws(() => checkBotWiring(r), /ล้าง interval/u);
});

test('mutation MB14: index.js ไม่เริ่มตัวเฝ้าใน ready → ไม่มี interval → ข้อต่อสาย index.js แดง', async () => {
  const src = mutate(BOT_SRC, '  researchWatchdog.start(); // ★ 2 ต.ค. 69 (W7): เริ่มตัวเฝ้า worker ค้นคว้า + สรุปรายวัน (สวิตช์ปิด = no-op · ไม่โยน · ไม่รอ)\n', '');
  const r = await runBotLifecycle({ env: ON, src });
  assert.throws(() => checkBotWiring(r), /setInterval/u);
});

test('mutation MB15: ส่งสรุปโดยไม่จอง cas (จองชนแล้วยังส่ง) → สองบอทส่งซ้ำ → ข้อสองบอททับกันแดง', async () => {
  const mod = cardMutant('    if (!claim.ok) {', '    if (false) {');
  const r = await scenarioOverlap({ mod });
  assert.ok(r.client.dms.length >= 2, 'กลายพันธุ์ต้องส่งซ้ำจริง');
  assert.throws(() => checkOverlap(r), /ส่งครั้งเดียว/u);
});

test('mutation MB17: ไม่เช็คการปิดตัวก่อนส่งสรุป → ตัวเก่าส่งเข้า client ที่กำลังถูกตัด/ไม่ปล่อยจอง → ข้อ SIGTERM ระหว่างดึงสรุปแดง', async () => {
  const mod = cardMutant('    if (!started || isShuttingDown()) {\n      // บอทกำลังปิดตัว', '    if (false) {\n      // บอทกำลังปิดตัว');
  const state = makeStateStore({ lastSentKey: '2026-10-01', status: 'sent' }, { revision: 4 });
  let down = false;
  const old = makeWatch({ mod, env: ON, clock: { t: AT_0730 }, state, isShuttingDown: () => down, digestAt: () => { down = true; return DIGEST_BODY(); } });
  old.w.start();
  await old.fire('ตัวเก่า (กลายพันธุ์)');
  assert.equal(old.client.dms.length, 1, 'กลายพันธุ์ต้องส่งจากตัวเก่าจริง');
  assert.throws(() => assert.equal(old.client.dms.length, 0, 'ตัวเก่าไม่ส่ง'));
  assert.notEqual(state.item.state.lastError, 'shutdown', 'กลายพันธุ์ไม่ปล่อยจอง');
});

test('mutation MB16: ไม่ดูสวิตช์ (เปิดเสมอ) → ข้อสวิตช์ปิดแดง', () => {
  const mod = cardMutant("  const enabled = typeof options.enabled === 'boolean' ? options.enabled : String(env.RESEARCH_AGENT ?? '') === '1';", '  const enabled = true;');
  assert.throws(() => checkOff(mod));
});
