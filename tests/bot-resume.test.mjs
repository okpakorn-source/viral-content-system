// ★ 2 ก.ย. 69 — บอทดิสคอร์ดจำงานข้ามรีสตาร์ต (ข้อ 12): discord-bot/index.js
//   โหลดบอทจริงแบบอ่านข้อความแล้วแทน require('discord.js'/'axios'/'dotenv') ด้วยตัวปลอม (ไม่ต้องมี node_modules ของบอท)
//   setTimeout ถูกแทนด้วยตัวเร็ว (0ms) เพื่อไม่ต้องรอ 3 วิต่อรอบ poll · ไม่ต้องตั้ง env ใดๆ
//   รัน: node --test tests/bot-resume.test.mjs
//
// ผลการทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนโค้ด (ยิงจริง 2 ก.ย. 69 ด้วยสคริปต์ทุบ-เทส-คืนไฟล์ byte-exact · 15 ข้อ):
//   MB1 RESUME_MAX_AGE_MS 30 นาที → 300 นาที → แดง 1: 'งานค้างเกิน 30 นาที → แก้ข้อความ ⏱️ + ลบ ไม่ poll'
//   MB2 ตัด trackingDelete ใน finally ของ processNewsJob → แดง 2: 'เส้นทางปกติ: จดสมุดหลัง ack …' + 'instance อื่นรับช่วง …'
//   MB3 ตัด trackingUpsert ในเส้นทางปกติ → แดง 2: 'เส้นทางปกติ: จดสมุดหลัง ack …' + 'instance อื่นรับช่วง …'
//   MB4 trackingTakenByOther คืน false เสมอ → แดง 1: 'instance อื่นรับช่วงไปแล้ว → ตัวเก่าเงียบ …'
//   MB5 envFlag รับค่าอื่นนอกจาก '0'/'1' (เช่น 'off' = ปิด) → แดง 1: 'สวิตช์รับเฉพาะ 0/1 …'
//   ★ กับดักที่เจอตอนเขียนเทส: ตัวปลอมของสมุด tracking ต้องทำ upsert จริง (ทับ instance) ไม่งั้นบอทที่กู้งาน
//     จะเห็น instance เก่าในสมุดแล้ว "ยอมเงียบ" ตามกติกา — ไม่ใช่บั๊กของบอท
//   ── รอบแก้ตามผู้ตรวจไขว้ 2 ก.ย. 69 (19 ข้อ · ยิงจริงด้วยสคริปต์ทุบ-เทส-คืนไฟล์ byte-exact ตรวจ sha256) ──
//   MB6 trackingTakenByOther: สมุดว่าง=false (fail-open ของเดิม) → แดง 1: 'overlap ตอน redeploy …'
//   MB7 ตัด registeredJobs.add ใน trackingUpsert → แดง 1: 'overlap ตอน redeploy …'
//   MB8 ตัดด่าน success:true ใน trackingTakenByOther (200 แต่ success:false ถูกตีว่าสมุดว่าง) → แดง 1: 'overlap …' (ส่วน p3)
//   MB9 finally ของ resumeTrackedJob ถอนสมุดไม่มีเงื่อนไข (M-B ของผู้ตรวจ) → แดง 2: 'instance ที่สามรับช่วง …' + 'ได้ SIGTERM ระหว่าง poll …'
//       · ตัดเฉพาะ !handedOff → แดง 'instance ที่สาม …' · ตัดเฉพาะ !shuttingDown → แดง 'ได้ SIGTERM …'
//   MB10 finally ของ processNewsJob ตัด !shuttingDown → แดง 1: 'ได้ SIGTERM ระหว่าง poll …'
//   MB11 isDiscordGoneError คืน true เสมอ (ทุก error = หายจริง — ของเดิม) → แดง 1: 'Discord ล้มชั่วคราวตอนกู้งาน …'
//   MB12 isDiscordGoneError คืน false เสมอ → แดง 1: 'ห้อง/ข้อความหายจริง (10003/10008/50001) …'
//   MB13 ล้มชั่วคราว+ค้างเกิน 30 นาที ยังไม่ถอนสมุด (ตัด !isStale ช่อง channel) → แดง 1: 'Discord ล้มชั่วคราว …'
//   MB14 ช่อง message: ล้มชั่วคราวถูกตีว่าหายจริง (ตัดบรรทัด skipResume) → แดง 1: 'Discord ล้มชั่วคราว …'
//   MB15 ตัด 50001 ออกจากรายการหายจริง → แดง 1: 'ห้อง/ข้อความหายจริง …'
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const botUrl = new URL('../discord-bot/index.js', import.meta.url);
const botPath = fileURLToPath(botUrl);
const src = readFileSync(botUrl, 'utf8');
const realRequire = createRequire(botUrl);

const STALE_TEXT = '⏱️ งานนี้ค้างตอนระบบรีสตาร์ต ดูผลได้ในหน้าตรวจงาน';
const TRACKING_URL = 'http://api.test/api/bot/tracking';

class FakeEmbed {
  constructor() { this.data = {}; }
  setColor(c) { this.data.color = c; return this; }
  setTitle(t) { this.data.title = t; return this; }
  setDescription(d) { this.data.description = d; return this; }
  setFooter(f) { this.data.footer = f; return this; }
}

// axios ปลอม: /api/queue/add · /api/queue/status (ลำดับสถานะที่ตั้งไว้ ตัวสุดท้ายค้าง)
//   · /api/bot/tracking ทำตัวเหมือน route จริง: GET (กรอง ?jobId=) · POST = upsert ตาม jobId · DELETE ?jobId=
function makeAxios({ statuses = [], tracking = [], addResponse } = {}) {
  const calls = { get: [], post: [], delete: [] };
  let statusIdx = 0;
  const jobIdOf = (url) => { const m = url.match(/jobId=([^&]+)/); return m ? decodeURIComponent(m[1]) : null; };
  const api = {
    failTracking: false,
    async get(url, opts) {
      calls.get.push({ url, headers: opts?.headers });
      if (url.startsWith(TRACKING_URL)) {
        if (api.failTracking) throw new Error('tracking down');
        const wanted = jobIdOf(url);
        const items = tracking.filter((e) => !wanted || e.jobId === wanted).map((e) => ({ ...e }));
        return { data: { success: true, count: items.length, items } };
      }
      if (url.includes('/api/queue/status')) {
        const st = statuses[Math.min(statusIdx, statuses.length - 1)];
        statusIdx++;
        return { data: st };
      }
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body, opts) {
      calls.post.push({ url, body, headers: opts?.headers });
      if (url.includes('/api/queue/add')) return { data: addResponse || { success: true, jobId: 'JOB1', position: 1, queuesAhead: 0 } };
      if (url.startsWith(TRACKING_URL)) {
        if (api.failTracking) throw new Error('tracking down');
        const idx = tracking.findIndex((e) => e.jobId === body.jobId);
        const row = { ...(idx >= 0 ? tracking[idx] : {}), ...body, id: `bt_${body.jobId}` };
        if (idx >= 0) tracking[idx] = row; else tracking.push(row);
        return { data: { success: true, created: idx < 0, item: row } };
      }
      if (url.includes('/api/queue/worker')) return { data: { success: true } };
      throw new Error(`unexpected POST ${url}`);
    },
    async delete(url, opts) {
      calls.delete.push({ url, headers: opts?.headers });
      if (api.failTracking) throw new Error('tracking down');
      const wanted = jobIdOf(url);
      const idx = tracking.findIndex((e) => e.jobId === wanted);
      if (idx >= 0) tracking.splice(idx, 1);
      return { data: { success: true, removed: idx >= 0 } };
    },
  };
  return { axios: api, calls, tracking };
}

function makeProcessingMsg(id, channelId = 'CH1') {
  const edits = [];
  return { id, channelId, edits, edit: async (c) => { edits.push(typeof c === 'string' ? c : c.content); }, delete: async () => {} };
}

function makeSourceMsg(id, processingMsg, channelId = 'CH1') {
  const replies = [];
  const reactions = [];
  return {
    id, channelId, guildId: 'G1', author: { id: 'U1', tag: 'user#0' }, replies, reactions,
    reply: async (o) => { replies.push(o); return processingMsg; },
    react: async (e) => { reactions.push(e); },
  };
}

// error รูปทรงเดียวกับ DiscordAPIError ของ discord.js v14 (code = รหัส JSON ของ Discord · status = HTTP)
//   หายจริง: 10003 Unknown Channel · 10008 Unknown Message · 50001 Missing Access
function discordError(code, message, status = 404) {
  return Object.assign(new Error(message), { name: 'DiscordAPIError', code, status });
}

// messages[id] เป็น Error = fetch โยน error นั้น (ใช้จำลอง 429/5xx/สายหลุด) · ไม่มี = Unknown Message (10008)
function makeChannel(messages = {}) {
  const sends = [];
  const fetch = async (id) => {
    const m = messages[id];
    if (m instanceof Error) throw m;
    if (!m) throw discordError(10008, 'Unknown Message');
    return m;
  };
  return { sends, send: async (o) => { sends.push(o); }, messages: { fetch } };
}

function loadBot({ env = {}, axios, channels = {} } = {}) {
  const handlers = {};
  const procHandlers = {}; // process.on('SIGTERM'/...) ของบอท — เทสยิงสัญญาณปิดตัวได้
  class FakeClient {
    constructor(opts) {
      this.opts = opts;
      this.user = { tag: 'bot#0' };
      this.loggedIn = false;
      // channels[id] เป็น Error = fetch โยน error นั้น · ไม่มี = Unknown Channel (10003)
      this.channels = { fetch: async (id) => {
        const ch = channels[id];
        if (ch instanceof Error) throw ch;
        if (!ch) throw discordError(10003, 'Unknown Channel');
        return ch;
      } };
    }
    once(evt, fn) { (handlers[evt] ||= []).push(fn); }
    on(evt, fn) { (handlers[evt] ||= []).push(fn); }
    async login() { this.loggedIn = true; }
    async destroy() {}
  }
  const discord = { Client: FakeClient, GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4 }, EmbedBuilder: FakeEmbed };
  const fakeRequire = (name) => {
    if (name === 'dotenv') return { config() {} };
    if (name === 'discord.js') return discord;
    if (name === 'axios') return axios;
    return realRequire(name); // 'os', './queue-errors' ของจริง
  };
  const mod = { exports: {} };
  const logs = [];
  const fakeConsole = {
    log: (...a) => logs.push(a.map(String).join(' ')),
    warn: (...a) => logs.push(a.map(String).join(' ')),
    error: (...a) => logs.push(a.map(String).join(' ')),
  };
  const fakeProcess = {
    env: { API_URL: 'http://api.test/api/auto/process', API_KEY: 'S3CRET', ...env },
    on: (evt, fn) => { (procHandlers[evt] ||= []).push(fn); },
    exit() {},
  };
  const fastTimeout = (fn) => setTimeout(fn, 0);
  new Function('require', 'module', 'exports', 'process', 'console', 'setTimeout', src)(
    fakeRequire, mod, mod.exports, fakeProcess, fakeConsole, fastTimeout);
  return { bot: mod.exports, handlers, procHandlers, logs, client: mod.exports._client };
}

const NEWS_TEXT = 'ข่าวยาวพอสมควรสำหรับทดสอบระบบจำงานข้ามรีสตาร์ตของบอทดิสคอร์ด';
const tick = () => new Promise((r) => setTimeout(r, 0));

const completedResult = () => ({
  success: true,
  data: {
    caseId: 'CASE1',
    newsData: { newsTitle: 'หลวงปู่ศิลา' },
    analysisResult: { versions: [{ content: 'เนื้อข่าว V1', style: 'Classic', _source: 'classic' }], qualityWarnings: [] },
  },
});
const DONE = () => ({ success: true, status: 'completed', result: completedResult() });
const PROCESSING = () => ({ success: true, status: 'processing' });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const entry = (over = {}) => ({
  id: 'bt_JOB1', jobId: 'JOB1', channelId: 'CH1', messageId: 'P1', sourceMessageId: 'M1', guildId: 'G1', userId: 'U1',
  instance: 'oldhost_dead1', startedAt: ago(5), queueUrl: 'http://api.test/api/queue/add', ...over,
});

test('node --check discord-bot/index.js ผ่าน', () => {
  execFileSync(process.execPath, ['--check', botPath], { stdio: 'pipe' });
});

test('โหลดในเทส = ไม่ล็อกอิน · ยังผูก ready + messageCreate เหมือนเดิม', () => {
  const { axios } = makeAxios();
  const { client, handlers } = loadBot({ axios });
  assert.equal(client.loggedIn, false);
  assert.equal(handlers.ready?.length, 1);
  assert.equal(handlers.messageCreate?.length, 1);
});

test('URL สมุด tracking แตกมาจาก API_URL เดียวกับคิว (3 รูปแบบเดิม)', () => {
  const { axios } = makeAxios();
  const a = loadBot({ axios, env: { API_URL: 'http://api.test/api/auto/process' } }).bot;
  assert.equal(a.buildQueueUrl(), 'http://api.test/api/queue/add');
  assert.equal(a.buildTrackingUrl(), TRACKING_URL);
  const b = loadBot({ axios, env: { API_URL: 'http://x.test/api/auto/stream' } }).bot;
  assert.equal(b.buildQueueUrl(), 'http://x.test/api/queue/add');
  assert.equal(b.buildTrackingUrl(), 'http://x.test/api/bot/tracking');
  const c = loadBot({ axios, env: { API_URL: 'http://y.test/api/anything/else' } }).bot;
  assert.equal(c.buildTrackingUrl(), 'http://y.test/api/bot/tracking');
  assert.deepEqual(a.buildApiHeaders(), { 'Content-Type': 'application/json', 'x-api-key': 'S3CRET' });
  const noKey = loadBot({ axios, env: { API_KEY: '' } }).bot;
  assert.deepEqual(noKey.buildApiHeaders(), { 'Content-Type': 'application/json' });
});

test('งานค้างเกิน 30 นาที → แก้ข้อความ ⏱️ + ลบออกจากสมุด ไม่ poll คิว', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const { axios, calls } = makeAxios({ statuses: [DONE()], tracking: [entry({ startedAt: ago(31) })] });
  const { bot, logs } = loadBot({ axios, channels: { CH1: makeChannel({ P1: p1, M1: m1 }) } });
  const summary = await bot.resumeTrackedJobs();
  assert.equal(summary.stale, 1);
  assert.equal(summary.total, 1);
  assert.deepEqual(p1.edits, [STALE_TEXT]);
  assert.equal(calls.delete.length, 1);
  assert.equal(calls.delete[0].url, `${TRACKING_URL}?jobId=JOB1`);
  assert.equal(calls.get.filter((c) => c.url.includes('/api/queue/status')).length, 0, 'ต้องไม่ poll คิวเลย');
  assert.equal(m1.replies.length, 0);
  assert.ok(logs.some((l) => l.includes('🩹 กู้งานค้าง 1 งาน')), 'ต้องมี log บรรทัดกู้งาน');
  // 29 นาที = ยังไม่เก่า → ต้องตามต่อ ไม่ใช่ ⏱️
  const p2 = makeProcessingMsg('P2');
  const m2 = makeSourceMsg('M2', p2);
  const fresh = makeAxios({ statuses: [DONE()], tracking: [entry({ startedAt: ago(29), messageId: 'P2', sourceMessageId: 'M2' })] });
  const bot2 = loadBot({ axios: fresh.axios, channels: { CH1: makeChannel({ P2: p2, M2: m2 }) } }).bot;
  const s2 = await bot2.resumeTrackedJobs();
  assert.equal(s2.resumed, 1);
  assert.ok(!p2.edits.includes(STALE_TEXT));
});

test('งานปกติ → รับช่วง (upsert instance ตัวเอง) แล้ว poll ต่อจน completed → โพสต์ผลเหมือนเส้นทางปกติ → ลบสมุด', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const old = entry();
  const { axios, calls, tracking } = makeAxios({ statuses: [PROCESSING(), PROCESSING(), DONE()], tracking: [old] });
  const { bot, logs } = loadBot({ axios, channels: { CH1: makeChannel({ P1: p1, M1: m1 }) } });
  const summary = await bot.resumeTrackedJobs();
  assert.equal(summary.resumed, 1);
  assert.ok(logs.some((l) => l.includes('🩹 กู้งานค้าง 1 งาน')));

  // รับช่วง: POST tracking ด้วย instance ของตัวเอง ก่อนเริ่ม poll คิว
  const claim = calls.post.find((c) => c.url === TRACKING_URL);
  assert.ok(claim, 'ต้อง POST รับช่วงงาน');
  assert.equal(claim.body.jobId, 'JOB1');
  assert.equal(claim.body.messageId, 'P1');
  assert.equal(claim.body.sourceMessageId, 'M1');
  assert.notEqual(claim.body.instance, 'oldhost_dead1');
  assert.match(claim.body.instance, /_[a-z0-9]+$/);
  assert.equal(claim.body.startedAt, old.startedAt, 'startedAt ต้องคงเวลาเริ่มเดิม (กฎ 30 นาทีนับจากเริ่มจริง)');
  assert.equal(claim.headers['x-bot-secret'], 'S3CRET');
  assert.equal(claim.headers['x-api-key'], 'S3CRET');
  const firstPollIdx = calls.get.findIndex((c) => c.url.includes('/api/queue/status'));
  assert.ok(firstPollIdx >= 0);
  assert.ok(calls.post.indexOf(claim) >= 0, 'claim ต้องเกิดก่อน poll');
  assert.equal(tracking.length, 0, 'จบงานแล้วสมุดต้องว่าง');

  // poll คิวด้วย header เดิม จน completed
  const polls = calls.get.filter((c) => c.url.includes('/api/queue/status?id=JOB1'));
  assert.equal(polls.length, 3);
  assert.equal(polls[0].headers['x-api-key'], 'S3CRET');

  // ผลลัพธ์รูปแบบเดิมทุกไบต์
  const finalEdit = p1.edits[p1.edits.length - 1];
  assert.match(finalEdit, /^✅ \*\*สร้างข่าวสำเร็จ!\*\* 1 เวอร์ชัน \| ใช้เวลา \d+\.\ds\n📰 \*\*หลวงปู่ศิลา\*\*\n🔗 ดูผลลัพธ์เต็ม: http:\/\/api\.test\/generation-logs\/CASE1$/u);
  assert.ok(p1.edits.some((e) => e.includes('⚡ **Auto Pipeline V2** กำลังประมวลผล')), 'ระหว่าง processing ต้องโชว์ progress เดิม');
  assert.equal(m1.replies.length, 2, 'embed เวอร์ชัน 1 + สรุป research 1');
  const versionEmbed = m1.replies[0].embeds[0];
  assert.equal(versionEmbed.data.title, '[Classic] หลวงปู่ศิลา');
  assert.equal(versionEmbed.data.description, 'เนื้อข่าว V1');
  assert.equal(m1.replies[1].embeds[0].data.title, '📄 เขียนจากเนื้อต้นฉบับอย่างเดียว');
  assert.deepEqual(m1.reactions, ['✅']);

  // จบงาน → ลบออกจากสมุด 1 ครั้ง
  assert.deepEqual(calls.delete.map((c) => c.url), [`${TRACKING_URL}?jobId=JOB1`]);
});

test('คิวบอก completed ตั้งแต่รอบแรก (งานเสร็จระหว่างรีสตาร์ต) → โพสต์ผลทันที', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const { axios, calls } = makeAxios({ statuses: [DONE()], tracking: [entry()] });
  const { bot } = loadBot({ axios, channels: { CH1: makeChannel({ P1: p1, M1: m1 }) } });
  await bot.resumeTrackedJobs();
  assert.equal(calls.get.filter((c) => c.url.includes('/api/queue/status')).length, 1);
  assert.match(p1.edits[p1.edits.length - 1], /^✅ \*\*สร้างข่าวสำเร็จ!\*\*/u);
  assert.equal(m1.replies.length, 2);
});

test('ห้อง/ข้อความหายจริง (10003/10008/50001) → ลบออกจากสมุด ข้ามเงียบ ไม่แก้อะไร', async () => {
  const p1 = makeProcessingMsg('P1');
  const t = makeAxios({ statuses: [DONE()], tracking: [
    entry({ channelId: 'CH-gone' }),                                   // 10003 Unknown Channel
    entry({ jobId: 'JOB2', messageId: 'P-gone' }),                      // 10008 Unknown Message
    entry({ jobId: 'JOB3', channelId: 'CH-noaccess' }),                 // 50001 Missing Access (บอทถูกถอดสิทธิ์ห้อง)
  ] });
  const channels = { CH1: makeChannel({ P1: p1 }), 'CH-noaccess': discordError(50001, 'Missing Access', 403) };
  const { bot } = loadBot({ axios: t.axios, channels });
  const summary = await bot.resumeTrackedJobs();
  assert.equal(summary.dropped, 3);
  assert.equal(summary.skipped, 0);
  assert.deepEqual(t.calls.delete.map((c) => c.url).sort(), [`${TRACKING_URL}?jobId=JOB1`, `${TRACKING_URL}?jobId=JOB2`, `${TRACKING_URL}?jobId=JOB3`]);
  assert.equal(t.tracking.length, 0);
  assert.equal(p1.edits.length, 0);
  assert.equal(t.calls.get.filter((c) => c.url.includes('/api/queue/status')).length, 0);
});

test('Discord ล้มชั่วคราวตอนกู้งาน (429/5xx/สายหลุด) → ข้ามรอบนี้ ไม่ลบสมุด ไม่แตะข้อความ · ถ้าค้างเกิน 30 นาทีแล้วค่อยถอน', async () => {
  const p1 = makeProcessingMsg('P1');
  const rateLimited = Object.assign(new Error('You are being rate limited.'), { name: 'RateLimitError', status: 429 });
  const serverDown = discordError(0, 'Internal Server Error', 500); // DiscordAPIError code 0 = General error
  const netDrop = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  const t = makeAxios({ statuses: [DONE()], tracking: [
    entry({ channelId: 'CH-429' }),
    entry({ jobId: 'JOB2', channelId: 'CH-500' }),
    entry({ jobId: 'JOB3', messageId: 'P-net' }),
    entry({ jobId: 'JOB4', channelId: 'CH-429', startedAt: ago(31) }), // ล้มชั่วคราว "และ" ค้างเกิน 30 นาที → ถอนสมุด (ไม่งั้นค้างชั่วนิรันดร์)
  ] });
  const channels = { CH1: makeChannel({ P1: p1, 'P-net': netDrop }), 'CH-429': rateLimited, 'CH-500': serverDown };
  const { bot, logs } = loadBot({ axios: t.axios, channels });
  const summary = await bot.resumeTrackedJobs();
  assert.equal(summary.skipped, 3, '429 / 5xx / ECONNRESET ต้องข้าม ไม่ใช่ทิ้ง');
  assert.equal(summary.dropped, 1, 'ตัวที่ค้างเกิน 30 นาทีถอนสมุดได้');
  assert.deepEqual(t.calls.delete.map((c) => c.url), [`${TRACKING_URL}?jobId=JOB4`]);
  assert.deepEqual(t.tracking.map((e) => e.jobId).sort(), ['JOB1', 'JOB2', 'JOB3'], 'สมุดของ 3 งานที่ล้มชั่วคราวต้องยังอยู่ให้รอบหน้าลองใหม่');
  assert.equal(p1.edits.length, 0);
  assert.equal(t.calls.get.filter((c) => c.url.includes('/api/queue/status')).length, 0, 'ไม่ poll คิวเมื่อยังไม่มีข้อความให้โพสต์');
  assert.equal(t.calls.post.filter((c) => c.url === TRACKING_URL).length, 0, 'ไม่รับช่วงงานที่ยังดึงข้อความไม่ได้');
  assert.ok(logs.some((l) => l.includes('คงสมุดไว้ ลองใหม่รอบหน้า')));
});

test('ข้อความต้นทางของคนส่งถูกลบ → ยังโพสต์ผลลงห้องเดิมได้ (channel.send) ไม่พัง', async () => {
  const p1 = makeProcessingMsg('P1');
  const ch = makeChannel({ P1: p1 }); // ไม่มี M1
  const { axios } = makeAxios({ statuses: [DONE()], tracking: [entry()] });
  const { bot } = loadBot({ axios, channels: { CH1: ch } });
  const summary = await bot.resumeTrackedJobs();
  assert.equal(summary.resumed, 1);
  assert.equal(ch.sends.length, 2);
  assert.equal(ch.sends[0].embeds[0].data.title, '[Classic] หลวงปู่ศิลา');
});

test('งานที่กู้มาแล้วคิวบอก failed → แจ้ง ❌ ในข้อความเดิม + ลบสมุด', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const { axios, calls } = makeAxios({ statuses: [{ success: true, status: 'failed', error: 'ระบบฐานข้อมูลขัดข้อง', errorType: 'STORE_FAILED' }], tracking: [entry()] });
  const { bot } = loadBot({ axios, channels: { CH1: makeChannel({ P1: p1, M1: m1 }) } });
  const summary = await bot.resumeTrackedJobs();
  assert.equal(summary.failed, 1);
  assert.equal(p1.edits[p1.edits.length - 1], '❌ เกิดข้อผิดพลาดในการประมวลผล: ระบบฐานข้อมูลขัดข้อง');
  assert.equal(m1.replies.length, 0);
  assert.equal(calls.delete.length, 1);
});

test('สมุดว่าง → ไม่มี log กู้งาน · อ่านสมุดไม่ได้ → บอทตื่นต่อได้เงียบๆ', async () => {
  const empty = makeAxios({ tracking: [] });
  const a = loadBot({ axios: empty.axios });
  const s = await a.bot.resumeTrackedJobs();
  assert.equal(s.total, 0);
  assert.ok(!a.logs.some((l) => l.includes('🩹 กู้งานค้าง')));
  const down = makeAxios({ tracking: [entry()] });
  down.axios.failTracking = true;
  const b = loadBot({ axios: down.axios });
  const s2 = await b.bot.resumeTrackedJobs();
  assert.equal(s2.total, 0);
});

test('ready handler ของบอทเรียกกู้งานเอง (คืน promise ให้รอได้)', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const { axios, calls } = makeAxios({ statuses: [DONE()], tracking: [entry()] });
  const { handlers, logs } = loadBot({ axios, channels: { CH1: makeChannel({ P1: p1, M1: m1 }) } });
  await handlers.ready[0]();
  assert.ok(calls.get.some((c) => c.url === TRACKING_URL), 'ตอนตื่นต้อง GET รายการงานค้าง');
  assert.ok(logs.some((l) => l.includes('BOT_BUILD=') && l.includes('resume=on')));
  assert.match(p1.edits[p1.edits.length - 1], /^✅ \*\*สร้างข่าวสำเร็จ!\*\*/u);
});

test('เส้นทางปกติ: จดสมุดหลัง ack (jobId/messageId/channel/คนส่ง/instance) → โพสต์ผล → ถอนสมุด · สมุดล่มไม่ทำงานหลักพัง', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const { axios, calls } = makeAxios({ statuses: [PROCESSING(), DONE()], tracking: [] });
  const { bot } = loadBot({ axios });
  await bot.processNewsJob({ message: m1, content: 'ข่าวยาวพอสมควรสำหรับทดสอบระบบจำงานข้ามรีสตาร์ตของบอทดิสคอร์ด', processingMsg: null, addedAt: Date.now() });

  assert.equal(m1.replies[0], 'รับทราบครับ! กำลังอ่านข้อมูลและปั้นบทความไวรัล รอสักครู่นะครับ ⚡...');
  const reg = calls.post.find((c) => c.url === TRACKING_URL);
  assert.ok(reg, 'ต้อง POST จดสมุดหลังได้ jobId + ack');
  assert.equal(reg.body.jobId, 'JOB1');
  assert.equal(reg.body.channelId, 'CH1');
  assert.equal(reg.body.messageId, 'P1');
  assert.equal(reg.body.sourceMessageId, 'M1');
  assert.equal(reg.body.guildId, 'G1');
  assert.equal(reg.body.userId, 'U1');
  assert.equal(reg.body.queueUrl, 'http://api.test/api/queue/add');
  assert.match(reg.body.instance, /_[a-z0-9]+$/);
  assert.ok(Number.isFinite(Date.parse(reg.body.startedAt)));
  assert.equal(reg.headers['x-bot-secret'], 'S3CRET');
  // ลำดับ: จดสมุด "ก่อน" poll คิวครั้งแรก · ถอนสมุด "หลัง" โพสต์ผล
  const addIdx = calls.post.findIndex((c) => c.url.includes('/api/queue/add'));
  assert.ok(addIdx < calls.post.indexOf(reg));
  assert.match(p1.edits[p1.edits.length - 1], /^✅ \*\*สร้างข่าวสำเร็จ!\*\* 1 เวอร์ชัน/u);
  assert.equal(m1.replies.length, 3); // ack + embed เวอร์ชัน + สรุป research
  assert.deepEqual(m1.reactions, ['✅']);
  assert.deepEqual(calls.delete.map((c) => c.url), [`${TRACKING_URL}?jobId=JOB1`]);

  // สมุดล่มทั้ง POST/GET/DELETE → งานหลักยังจบสมบูรณ์เหมือนเดิม
  const p2 = makeProcessingMsg('P2');
  const m2 = makeSourceMsg('M2', p2);
  const down = makeAxios({ statuses: [DONE()], tracking: [] });
  down.axios.failTracking = true;
  const { bot: bot2 } = loadBot({ axios: down.axios });
  await bot2.processNewsJob({ message: m2, content: 'ข่าวยาวพอสมควรสำหรับทดสอบระบบจำงานข้ามรีสตาร์ตของบอทดิสคอร์ด', processingMsg: null, addedAt: Date.now() });
  assert.match(p2.edits[p2.edits.length - 1], /^✅ \*\*สร้างข่าวสำเร็จ!\*\*/u);
  assert.deepEqual(m2.reactions, ['✅']);
});

test('instance อื่นรับช่วงไปแล้ว → ตัวเก่าเงียบ ไม่โพสต์ผล ไม่ลบสมุดของเขา · ถ้ายังเป็นของตัวเอง → โพสต์ปกติ', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const { axios, calls, tracking } = makeAxios({ statuses: [DONE()], tracking: [] });
  const { bot, logs } = loadBot({ axios });
  // จำลอง: หลังตัวนี้จดสมุด บอทตัวใหม่ (redeploy) เขียนทับ instance เป็นของมัน
  const origPost = axios.post;
  axios.post = async (url, body, opts) => {
    const r = await origPost(url, body, opts);
    if (url === TRACKING_URL) tracking.find((e) => e.jobId === body.jobId).instance = 'newhost_alive9';
    return r;
  };
  await bot.processNewsJob({ message: m1, content: 'ข่าวยาวพอสมควรสำหรับทดสอบระบบจำงานข้ามรีสตาร์ตของบอทดิสคอร์ด', processingMsg: null, addedAt: Date.now() });
  assert.equal(m1.replies.length, 1, 'มีแค่ ack — ห้ามโพสต์ embed ซ้ำ');
  assert.ok(!p1.edits.some((e) => e.startsWith('✅')), 'ห้ามขึ้น ✅ สำเร็จ');
  assert.ok(!p1.edits.some((e) => e.startsWith('❌')), 'ห้ามขึ้น ❌ ด้วย (ไม่ใช่ error)');
  assert.deepEqual(m1.reactions, []);
  assert.equal(calls.delete.length, 0, 'สมุดเป็นของตัวใหม่ ห้ามลบ');
  assert.equal(tracking[0].instance, 'newhost_alive9');
  assert.ok(logs.some((l) => l.includes('รับช่วงไปแล้ว')));

  // ยังเป็นของตัวเอง (instance ตรง) → โพสต์ปกติ + ลบสมุด
  const p2 = makeProcessingMsg('P2');
  const m2 = makeSourceMsg('M2', p2);
  const t2 = makeAxios({ statuses: [DONE()], tracking: [] });
  const { bot: bot2 } = loadBot({ axios: t2.axios });
  await bot2.processNewsJob({ message: m2, content: 'ข่าวยาวพอสมควรสำหรับทดสอบระบบจำงานข้ามรีสตาร์ตของบอทดิสคอร์ด', processingMsg: null, addedAt: Date.now() });
  assert.match(p2.edits[p2.edits.length - 1], /^✅ \*\*สร้างข่าวสำเร็จ!\*\*/u);
  assert.equal(t2.calls.delete.length, 1);
  assert.equal(t2.tracking.length, 0);
});

test('overlap ตอน redeploy: ตัวใหม่กู้งานเสร็จก่อนแล้วถอนสมุด → ตัวเก่าเห็นสมุดว่างต้องเงียบ (ห้ามโพสต์ผลชุดที่ 2)', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const shared = []; // สมุดเดียวกัน (เซิร์ฟเวอร์เดียว) ทั้ง 2 instance
  let newBotDone = false;
  const oldT = makeAxios({ statuses: [], tracking: shared });
  // คิวฝั่งตัวเก่า: processing จนกว่าตัวใหม่จะโพสต์ผลเสร็จ → completed (ตัวเก่า poll ห่างได้ถึง 3 วิ จึงเห็นทีหลัง)
  const oldGet = oldT.axios.get;
  oldT.axios.get = async (url, opts) => {
    if (url.includes('/api/queue/status')) { oldT.calls.get.push({ url, headers: opts?.headers }); return { data: newBotDone ? DONE() : PROCESSING() }; }
    return oldGet(url, opts);
  };
  const oldBot = loadBot({ axios: oldT.axios });
  const oldRun = oldBot.bot.processNewsJob({ message: m1, content: NEWS_TEXT, processingMsg: null, addedAt: Date.now() });
  while (!oldT.calls.post.some((c) => c.url === TRACKING_URL)) await tick(); // รอตัวเก่าจดสมุดก่อน
  assert.equal(shared.length, 1);

  // ตัวใหม่ตื่น → กู้งาน → รับช่วง → คิวบอก completed → โพสต์ผล → ถอนสมุด
  const newT = makeAxios({ statuses: [DONE()], tracking: shared });
  const newBot = loadBot({ axios: newT.axios, channels: { CH1: makeChannel({ P1: p1, M1: m1 }) } });
  const summary = await newBot.bot.resumeTrackedJobs();
  assert.equal(summary.resumed, 1);
  assert.equal(shared.length, 0, 'ตัวใหม่โพสต์ผลแล้วถอนสมุด');
  assert.equal(newT.calls.delete.length, 1);

  // ตัวเก่าเพิ่งเห็น completed → GET ?jobId ได้ว่าง → ต้องรู้ว่ามีคนปิดงานแทนแล้ว
  newBotDone = true;
  await oldRun;
  assert.equal(p1.edits.filter((e) => e.startsWith('✅')).length, 1, 'ข้อความ ✅ ต้องมีชุดเดียว (ของตัวใหม่)');
  assert.equal(m1.replies.length, 3, 'ack ของตัวเก่า + embed เวอร์ชัน + สรุป research ของตัวใหม่ — ห้ามมีชุดที่ 2');
  assert.deepEqual(m1.reactions, ['✅']);
  assert.equal(oldT.calls.delete.length, 0, 'ตัวเก่าไม่ได้โพสต์ ก็ต้องไม่ยิงถอนสมุด');
  assert.ok(oldBot.logs.some((l) => l.includes('รับช่วงไปแล้ว')));

  // fail-open ยังคงเดิมเฉพาะกรณี "ไม่เคยจดสมุดสำเร็จ" (401/สายพัง) → สมุดว่างไม่ใช่สัญญาณคนอื่น → โพสต์ปกติ
  const p2 = makeProcessingMsg('P2');
  const m2 = makeSourceMsg('M2', p2);
  const t2 = makeAxios({ statuses: [DONE()], tracking: [] });
  const origPost = t2.axios.post;
  t2.axios.post = async (url, body, opts) => {
    if (url === TRACKING_URL) { t2.calls.post.push({ url, body, headers: opts?.headers }); throw Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } }); }
    return origPost(url, body, opts);
  };
  const { bot: bot2 } = loadBot({ axios: t2.axios });
  await bot2.processNewsJob({ message: m2, content: NEWS_TEXT, processingMsg: null, addedAt: Date.now() });
  assert.match(p2.edits[p2.edits.length - 1], /^✅ \*\*สร้างข่าวสำเร็จ!\*\*/u, 'จดสมุดไม่สำเร็จ → สมุดว่างต้องไม่ทำให้ผลหาย');
  assert.equal(m2.replies.length, 3);

  // จดสำเร็จ แต่ตอนเช็คก่อนโพสต์ เซิร์ฟเวอร์ตอบ 200 ที่ไม่ใช่คำตอบสมุด (success:false / body แปลก) → ไม่ใช่ "สมุดอ่านได้จริง" → fail-open
  const p3 = makeProcessingMsg('P3');
  const m3 = makeSourceMsg('M3', p3);
  const t3 = makeAxios({ statuses: [DONE()], tracking: [] });
  const origGet3 = t3.axios.get;
  t3.axios.get = async (url, opts) => {
    if (url.startsWith(`${TRACKING_URL}?jobId=`)) { t3.calls.get.push({ url, headers: opts?.headers }); return { data: { success: false, error: 'proxy hiccup' } }; }
    return origGet3(url, opts);
  };
  const { bot: bot3 } = loadBot({ axios: t3.axios });
  await bot3.processNewsJob({ message: m3, content: NEWS_TEXT, processingMsg: null, addedAt: Date.now() });
  assert.match(p3.edits[p3.edits.length - 1], /^✅ \*\*สร้างข่าวสำเร็จ!\*\*/u, 'คำตอบที่ไม่ใช่ success:true ต้องไม่ถูกตีความว่า "สมุดว่าง=คนอื่นปิดแล้ว"');
  assert.equal(m3.replies.length, 3);
  assert.equal(t3.calls.delete.length, 1);
});

test('งานที่กู้มาแล้วถูก instance ที่สามรับช่วงต่อ → handedoff=1 ไม่ถอนสมุดของเขา ไม่โพสต์ผล', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const t = makeAxios({ statuses: [PROCESSING(), DONE()], tracking: [entry()] });
  const origPost = t.axios.post;
  t.axios.post = async (url, body, opts) => {
    const r = await origPost(url, body, opts);
    // หลังตัวนี้รับช่วง (upsert instance ตัวเอง) instance ที่สามเขียนทับต่อทันที
    if (url === TRACKING_URL) t.tracking.find((e) => e.jobId === body.jobId).instance = 'thirdhost_c0ffee';
    return r;
  };
  const { bot, logs } = loadBot({ axios: t.axios, channels: { CH1: makeChannel({ P1: p1, M1: m1 }) } });
  const summary = await bot.resumeTrackedJobs();
  assert.equal(summary.handedoff, 1);
  assert.equal(summary.resumed, 0);
  assert.equal(summary.failed, 0);
  assert.equal(t.calls.delete.length, 0, 'สมุดเป็นของตัวที่สาม ห้ามถอน');
  assert.equal(t.tracking.length, 1);
  assert.equal(t.tracking[0].instance, 'thirdhost_c0ffee');
  assert.ok(!p1.edits.some((e) => e.startsWith('✅') || e.startsWith('❌')), 'ห้ามขึ้น ✅/❌');
  assert.equal(m1.replies.length, 0);
  assert.deepEqual(m1.reactions, []);
  assert.ok(logs.some((l) => l.includes('รับช่วงไปแล้ว')));
});

test('ได้ SIGTERM ระหว่าง poll (redeploy) → จบงานแล้วต้องไม่ถอนสมุด เก็บไว้ให้ตัวใหม่ตามต่อ (ทั้งเส้นทางกู้และเส้นทางปกติ)', async () => {
  // เส้นทางกู้
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const t = makeAxios({ statuses: [PROCESSING(), DONE()], tracking: [entry()] });
  const loaded = loadBot({ axios: t.axios, channels: { CH1: makeChannel({ P1: p1, M1: m1 }) } });
  assert.equal(loaded.procHandlers.SIGTERM?.length, 1);
  const origGet = t.axios.get;
  t.axios.get = async (url, opts) => {
    const r = await origGet(url, opts);
    if (url.includes('/api/queue/status') && r.data.status === 'processing') loaded.procHandlers.SIGTERM[0]('SIGTERM'); // Railway ส่ง SIGTERM กลาง poll
    return r;
  };
  await loaded.bot.resumeTrackedJobs();
  assert.ok(loaded.logs.some((l) => l.includes('ได้รับ SIGTERM')));
  assert.equal(t.calls.delete.length, 0, 'กำลังปิดตัว → ห้ามถอนสมุด');
  assert.equal(t.tracking.length, 1);

  // เส้นทางปกติ
  const p2 = makeProcessingMsg('P2');
  const m2 = makeSourceMsg('M2', p2);
  const t2 = makeAxios({ statuses: [PROCESSING(), DONE()], tracking: [] });
  const loaded2 = loadBot({ axios: t2.axios });
  const origGet2 = t2.axios.get;
  t2.axios.get = async (url, opts) => {
    const r = await origGet2(url, opts);
    if (url.includes('/api/queue/status') && r.data.status === 'processing') loaded2.procHandlers.SIGTERM[0]('SIGTERM');
    return r;
  };
  await loaded2.bot.processNewsJob({ message: m2, content: NEWS_TEXT, processingMsg: null, addedAt: Date.now() });
  assert.equal(t2.calls.post.filter((c) => c.url === TRACKING_URL).length, 1, 'จดสมุดไปแล้วก่อนได้ SIGTERM');
  assert.equal(t2.calls.delete.length, 0);
  assert.equal(t2.tracking.length, 1);
});

test('สวิตช์ BOT_RESUME_TRACKING=0 → ไม่แตะสมุดเลย ทั้งตอนตื่นและเส้นทางปกติ (พฤติกรรมเดิม)', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const { axios, calls } = makeAxios({ statuses: [DONE()], tracking: [entry()] });
  const { bot, handlers, logs } = loadBot({ axios, env: { BOT_RESUME_TRACKING: '0' } });
  const s = await handlers.ready[0]();
  assert.equal(s.total, 0);
  assert.ok(logs.some((l) => l.includes('resume=off')));
  await bot.processNewsJob({ message: m1, content: 'ข่าวยาวพอสมควรสำหรับทดสอบระบบจำงานข้ามรีสตาร์ตของบอทดิสคอร์ด', processingMsg: null, addedAt: Date.now() });
  assert.match(p1.edits[p1.edits.length - 1], /^✅ \*\*สร้างข่าวสำเร็จ!\*\*/u);
  assert.equal(calls.get.filter((c) => c.url.startsWith(TRACKING_URL)).length, 0);
  assert.equal(calls.post.filter((c) => c.url.startsWith(TRACKING_URL)).length, 0);
  assert.equal(calls.delete.length, 0);
});

test('สวิตช์รับเฉพาะ 0/1 ตรงตัว — ค่าอื่น (off/false/ว่าง) = ค่าเริ่มต้นเปิด', async () => {
  for (const v of ['off', 'false', '', 'no']) {
    const { axios, calls } = makeAxios({ tracking: [] });
    const { bot } = loadBot({ axios, env: { BOT_RESUME_TRACKING: v } });
    await bot.resumeTrackedJobs();
    assert.equal(calls.get.filter((c) => c.url === TRACKING_URL).length, 1, `ค่า '${v}' ต้องยังเปิด`);
  }
  const { axios, calls } = makeAxios({ tracking: [] });
  const { bot } = loadBot({ axios, env: { BOT_RESUME_TRACKING: '1' } });
  await bot.resumeTrackedJobs();
  assert.equal(calls.get.length, 1);
});
