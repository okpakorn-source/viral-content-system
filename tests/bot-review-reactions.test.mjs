// ★ 2 ก.ย. 69 — ปุ่มพนักงานในดิสคอร์ด + คำเตือนจากท่อใต้ผลข่าว (ข้อ 6): discord-bot/index.js
//   👍 ผ่าน=good · 👎 ไม่ผ่าน=bad · 📌 ใช้แล้ว=used → PATCH /api/generation-logs/<caseId> {status, reviewNote} (endpoint เดียวกับหน้าเว็บ)
//   บรรทัดเตือนใต้เนื้อข่าวแต่ละเวอร์ชัน: _missingFacts (L4.7) / _diversityWarning / _viralScore (รองรับล่วงหน้า)
//   โหลดบอทจริงแบบอ่านข้อความแล้วแทน require('discord.js'/'axios'/'dotenv') ด้วยตัวปลอม (แบบเดียวกับ tests/bot-resume.test.mjs)
//   ผลจากคิวใช้ "รูปทรงจริง" ที่ /api/auto/process คืน: caseId อยู่ที่ data.generationLog.caseId (พิสูจน์จาก data/job_queue.json 11/11 งาน)
//   รัน: node --test tests/bot-review-reactions.test.mjs
//
// ผลการทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนโค้ด (ยิงจริง 2 ก.ย. 69 ด้วยสคริปต์ทุบ-เทส-คืนไฟล์ byte-exact ตรวจ sha256 · กัด 24/24):
//   MR1 ตัด intent GuildMessageReactions → แดง 1: 'ตั้งค่า client …'          MR2 partials ว่าง → แดง 1: 'ตั้งค่า client …'
//   MR3 👎→'good' → แดง 4: mapReactionToStatus + รีสตาร์ต + partial + ครั้งล่าสุดชนะ
//   MR4 ไม่เติมบรรทัดความคล้าย → แดง 3: buildWarningLines + เส้นทางปกติ + เส้นทางกู้
//   MR5 ตัด path จริง data.generationLog.caseId → แดง 7 (ลิงก์/ปุ่ม/PATCH หายทั้งแผง)
//   MR6 ไม่กันบอทกดเอง → แดง 1: 'ไม่ยิง PATCH …'                 MR7 ไม่รู้ caseId ก็ยิงต่อ → แดง 2: 'ไม่ยิง PATCH …' + 'บอทรีสตาร์ต …'
//   MR8 ตัด fallback อ่าน caseId จากลิงก์ → แดง 3: รีสตาร์ต + partial + ยาวเกิน 2000
//   MR9 เกณฑ์ สูง 70→90 → แดง 2: buildWarningLines + เนื้อยาวเกิน 3800
//   MR10 ไม่แทนที่บรรทัด 📝 เดิม (งอกซ้อน) → แดง 1: 'กดซ้ำ/กดหลายปุ่ม …'
//   MR11 ไม่ตัดส่วนเติมให้พอเพดาน 4096 → แดง 1: buildWarningTail
//   MR12 ไม่ต่อคิวต่อข้อความ (กดรัวแข่งกัน) → แดง 1: 'กดซ้ำ/กดหลายปุ่ม …' (กัดเพราะตัวปลอมตอบ used ช้ากว่า good 15ms)
//   MR13 ไม่เช็คว่าข้อความเป็นของบอท → แดง 1: 'ไม่ยิง PATCH …'      MR14 body.status ส่ง 'good' ตลอด → แดง 5
//   MR15 ฟัง reaction แม้สวิตช์ปิด → แดง 1: 'ตั้งค่า client …'       MR16 ติดปุ่มแม้สวิตช์ปิด → แดง 1: 'ไม่ยิง PATCH …' (ส่วนสวิตช์ปิด)
//   MR17 ตัดการติดปุ่มหลัง ✅ → แดง 3: เส้นทางปกติ + เนื้อยาว + เส้นทางกู้
//   MR18 PATCH ล้มก็ขึ้น "บันทึกแล้ว" → แดง 1: 'PATCH ล้ม …'         MR19 ไม่ตรวจ success:true ของคำตอบ PATCH → แดง 1: 'PATCH ล้ม …'
//   MR20 ไม่ fetch ข้อความ partial → แดง 1: 'ข้อความ/reaction เป็น partial …'   MR21 ยาวเกิน 2000 ก็ยัง edit → แดง 1: 'ข้อความผลยาว …'
//   MR22 ไม่จำ messageId→caseId → แดง 3: เส้นทางปกติ + เนื้อยาว + เส้นทางกู้
//   MR23 ตัด _viralScore → แดง 2: buildWarningLines + เนื้อยาว       MR24 ตัดบรรทัดตกข้อเท็จจริง → แดง 3: buildWarningLines + เส้นทางปกติ + เนื้อยาว
//   ทุกตัว: tests/bot-resume.test.mjs ยังเขียว 19/19 (ฟีเจอร์นี้ไม่แตะเส้นทางเดิม)
//   ★ กับดักที่เจอตอนเขียนเทส: (1) 'review=off' อยู่ใน log ตอน ready — ต้องเรียก handlers.ready ก่อนเช็ค (2) เส้นทางกู้ไม่มี ack → embed V1 = replies[0]
//     (3) เทสกดรัวต้องให้ตัวปลอมตอบช้าเฉพาะสถานะแรก ไม่งั้น "ไม่ต่อคิว" ก็ผ่านโดยบังเอิญ (MR12 กัดหลังเพิ่ม delayMs)
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

const BOT_USER_ID = 'BOT77';
const TRACKING_URL = 'http://api.test/api/bot/tracking';
const reviewUrl = (caseId) => `http://api.test/api/generation-logs/${caseId}`;
// ข้อความจริงจาก data/job_queue.json (annotateDiversityWarning ใน autoFlowServiceText)
const DIVERSITY_TEXT = '2 เวอร์ชันยังคล้ายกัน 48% · เปิดซ้ำ — ส่งฉบับเดิมให้พนักงานอ่านเลือกโดยไม่เขียนซ้ำ เพื่อลดเวลาและค่า API';
const NEWS_TEXT = 'ข่าวยาวพอสมควรสำหรับทดสอบปุ่มพนักงานในดิสคอร์ดของบอทดิสคอร์ดสร้างข่าว';

class FakeEmbed {
  constructor() { this.data = {}; }
  setColor(c) { this.data.color = c; return this; }
  setTitle(t) { this.data.title = t; return this; }
  setDescription(d) { this.data.description = d; return this; }
  setFooter(f) { this.data.footer = f; return this; }
}

// axios ปลอม: /api/queue/add · /api/queue/status (ลำดับสถานะ ตัวสุดท้ายค้าง) · /api/bot/tracking (upsert/GET/DELETE เหมือน route จริง)
//   · PATCH /api/generation-logs/<caseId> จดทุกครั้ง — ตั้ง patch.throws / patch.response ให้ล้มหรือตอบไม่รับได้
function makeAxios({ statuses = [], tracking = [], patch = {} } = {}) {
  const calls = { get: [], post: [], delete: [], patch: [] };
  let statusIdx = 0;
  const jobIdOf = (url) => { const m = url.match(/jobId=([^&]+)/); return m ? decodeURIComponent(m[1]) : null; };
  const api = {
    async get(url, opts) {
      calls.get.push({ url, headers: opts?.headers });
      if (url.startsWith(TRACKING_URL)) {
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
      if (url.includes('/api/queue/add')) return { data: { success: true, jobId: 'JOB1', position: 1, queuesAhead: 0 } };
      if (url.startsWith(TRACKING_URL)) {
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
      const idx = tracking.findIndex((e) => e.jobId === jobIdOf(url));
      if (idx >= 0) tracking.splice(idx, 1);
      return { data: { success: true, removed: idx >= 0 } };
    },
    async patch(url, body, opts) {
      calls.patch.push({ url, body, headers: opts?.headers });
      // delayMs[status] = จำลองเซิร์ฟเวอร์ตอบช้าเฉพาะบางสถานะ (เทสลำดับ "ครั้งล่าสุดชนะ" ตอนกดรัว)
      if (patch.delayMs?.[body.status]) await new Promise((r) => setTimeout(r, patch.delayMs[body.status]));
      if (patch.throws) throw patch.throws;
      if (patch.response) return { data: patch.response };
      return { data: { success: true, caseId: url.split('/').pop(), status: body.status } };
    },
  };
  return { axios: api, calls, tracking, patch };
}

// ข้อความผลของบอท (ack → progress → ✅) — เก็บ content ล่าสุดไว้ให้ handleReaction อ่านลิงก์ 🔗 ได้ + ไทม์ไลน์ edit/react เรียงลำดับ
function makeProcessingMsg(id, { channelId = 'CH1', authorId = BOT_USER_ID, content = '', partial = false } = {}) {
  const msg = {
    id, channelId, content, partial, author: { id: authorId },
    edits: [], reactions: [], replies: [], timeline: [],
    edit: async (c) => { const text = typeof c === 'string' ? c : c.content; msg.edits.push(text); msg.content = text; msg.timeline.push(`edit:${text.slice(0, 6)}`); },
    react: async (e) => { msg.reactions.push(e); msg.timeline.push(`react:${e}`); },
    reply: async (o) => { msg.replies.push(o); },
    delete: async () => {},
  };
  return msg;
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

// MessageReaction ปลอม (discord.js v14): emoji.name = ตัวอีโมจิ · partial → fetch() คืนตัวเองแบบเต็ม
function makeReaction(emoji, message, { partial = false, fetch } = {}) {
  const r = { emoji: { name: emoji }, message, partial, fetched: 0 };
  r.fetch = fetch || (async () => { r.fetched++; r.partial = false; return r; });
  return r;
}
const human = (over = {}) => ({ id: 'U1', bot: false, username: 'somchai', globalName: 'สมชาย', ...over });

function discordError(code, message, status = 404) {
  return Object.assign(new Error(message), { name: 'DiscordAPIError', code, status });
}

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
  const procHandlers = {};
  class FakeClient {
    constructor(opts) {
      this.opts = opts;
      this.user = { id: BOT_USER_ID, tag: 'bot#0' };
      this.loggedIn = false;
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
  const discord = {
    Client: FakeClient,
    GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, GuildMessageReactions: 1024 },
    Partials: { User: 1, Channel: 2, Message: 3, Reaction: 5 },
    EmbedBuilder: FakeEmbed,
  };
  const fakeRequire = (name) => {
    if (name === 'dotenv') return { config() {} };
    if (name === 'discord.js') return discord;
    if (name === 'axios') return axios;
    return realRequire(name);
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

// ผลจากคิว "รูปทรงจริง" (result ของ /api/auto/process ที่ worker เก็บทั้งก้อน): caseId อยู่ที่ data.generationLog.caseId
const v1 = () => ({ content: 'เนื้อข่าว V1', style: '[A1] เรื่องเล่าอบอุ่น', _source: 'classic', _diversityWarning: DIVERSITY_TEXT });
const v2 = () => ({
  content: 'เนื้อข่าว V2', style: '[A2] ช่วยเหลือกัน', _source: 'enhanced', _diversityWarning: DIVERSITY_TEXT,
  _missingFacts: { checked: 9, coverage: 0.778, missing: [{ type: 'number', text: '209,678 บาท' }, { type: 'detail', text: 'ห่วงเรื่องการขับรถ' }] },
});
const realResult = ({ caseId = '05268', versions = [v1(), v2()] } = {}) => ({
  success: true,
  data: {
    newsData: { newsTitle: 'ลุงสามล้อ' },
    analysisResult: { versions, qualityWarnings: [] },
    generationLog: { error: null, caseId, success: true },
  },
});
const DONE = (result = realResult()) => ({ success: true, status: 'completed', result });
const PROCESSING = () => ({ success: true, status: 'processing' });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

// รันเส้นทางปกติจนโพสต์ผล → คืนบอท+ข้อความผล (ใช้เป็นฐานของเทสกดปุ่ม)
async function runToSuccess({ env, statuses = [PROCESSING(), DONE()], patch } = {}) {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const t = makeAxios({ statuses, patch });
  const loaded = loadBot({ axios: t.axios, env });
  await loaded.bot.processNewsJob({ message: m1, content: NEWS_TEXT, processingMsg: null, addedAt: Date.now() });
  return { ...loaded, calls: t.calls, p1, m1, axiosFake: t.axios };
}

test('node --check discord-bot/index.js ผ่าน', () => {
  execFileSync(process.execPath, ['--check', botPath], { stdio: 'pipe' });
});

test('ตั้งค่า client: intent GuildMessageReactions + partials Message/Reaction · ฟัง messageReactionAdd เมื่อสวิตช์เปิด · ปิด = ไม่ผูก (ของเดิมยังครบ)', () => {
  const { axios } = makeAxios();
  const on = loadBot({ axios });
  assert.ok(on.client.opts.intents.includes(1024), 'ต้องขอ intent GuildMessageReactions (1024 ในตัวปลอม)');
  assert.deepEqual(on.client.opts.intents.slice(0, 3), [1, 2, 4], 'intent เดิม 3 ตัวต้องอยู่ครบและลำดับเดิม');
  assert.deepEqual(on.client.opts.partials, [3, 5], 'partials ต้องมี Message + Reaction (รับ reaction บนข้อความก่อนรีสตาร์ต)');
  assert.equal(on.handlers.messageReactionAdd?.length, 1);
  assert.equal(on.handlers.ready?.length, 1);
  assert.equal(on.handlers.messageCreate?.length, 1);
  assert.equal(on.client.loggedIn, false);
  const off = loadBot({ axios, env: { BOT_REVIEW_REACTIONS: '0' } });
  assert.equal(off.handlers.messageReactionAdd, undefined, 'สวิตช์ปิด = ไม่ฟัง reaction');
  assert.equal(off.handlers.messageCreate?.length, 1);
});

test('log ตอนตื่น (BOT_BUILD) บอกสถานะสวิตช์ review=on/off — ไว้ยืนยันบน Railway ว่ารุ่นนี้ขึ้นแล้ว', async () => {
  const on = loadBot({ axios: makeAxios().axios });
  await on.handlers.ready[0]();
  assert.ok(on.logs.some((l) => l.includes('BOT_BUILD=') && l.includes('review=on') && l.includes('resume=on')));
  const off = loadBot({ axios: makeAxios().axios, env: { BOT_REVIEW_REACTIONS: '0' } });
  await off.handlers.ready[0]();
  assert.ok(off.logs.some((l) => l.includes('BOT_BUILD=') && l.includes('review=off')));
});

test('mapReactionToStatus: 👍→good · 👎→bad · 📌→used · อื่น/ว่าง→null · รับทั้ง string / MessageReaction / emoji object', () => {
  const { bot } = loadBot({ axios: makeAxios().axios });
  assert.equal(bot.mapReactionToStatus('👍'), 'good');
  assert.equal(bot.mapReactionToStatus('👎'), 'bad');
  assert.equal(bot.mapReactionToStatus('📌'), 'used');
  assert.equal(bot.mapReactionToStatus({ emoji: { name: '👎' } }), 'bad');
  assert.equal(bot.mapReactionToStatus({ name: '📌' }), 'used');
  for (const bad of ['🔥', '✅', '⏳', '', null, undefined, {}, { emoji: { name: 'thumbsup' } }]) {
    assert.equal(bot.mapReactionToStatus(bad), null, `${String(bad)} ต้องไม่แมป`);
  }
});

test('buildWarningLines: ตกข้อเท็จจริง → ความคล้าย → โอกาสปัง (เรียงตามนี้) · ไม่มีอะไร = [] · สวิตช์ปิด = []', () => {
  const { bot } = loadBot({ axios: makeAxios().axios });
  assert.deepEqual(bot.buildWarningLines({ content: 'x' }), []);
  assert.deepEqual(bot.buildWarningLines(null), []);
  assert.deepEqual(bot.buildWarningLines({ _missingFacts: { checked: 3, missing: [] } }), [], 'missing ว่าง = ไม่เตือน');
  assert.deepEqual(bot.buildWarningLines({ _missingFacts: { checked: 0, missing: [], skipped: 'no_source' } }), []);
  assert.deepEqual(bot.buildWarningLines(v2()), [
    '⚠️ อาจตกข้อเท็จจริง: 209,678 บาท · ห่วงเรื่องการขับรถ',
    `⚠️ ${DIVERSITY_TEXT}`,
  ]);
  // เกิน 5 จุด → โชว์ 5 + (+n)
  const seven = { _missingFacts: { missing: ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ', 'ช'].map((t) => ({ type: 'name', text: t })) } };
  assert.deepEqual(bot.buildWarningLines(seven), ['⚠️ อาจตกข้อเท็จจริง: ก · ข · ค · ง · จ (+2)']);
  // รายการเป็นสตริงล้วนก็อ่านได้
  assert.deepEqual(bot.buildWarningLines({ _missingFacts: { missing: ['10 ส.ค. 2569'] } }), ['⚠️ อาจตกข้อเท็จจริง: 10 ส.ค. 2569']);
  // ความคล้ายอย่างเดียว
  assert.deepEqual(bot.buildWarningLines(v1()), [`⚠️ ${DIVERSITY_TEXT}`]);
  assert.deepEqual(bot.buildWarningLines({ _diversityWarning: '   ' }), [], 'สตริงว่าง = ไม่เตือน');
  // โอกาสปัง (รองรับล่วงหน้า): เลข / สตริงเลข / object · ระดับ ≥70 สูง · ≥40 กลาง · ต่ำกว่า ต่ำ
  assert.deepEqual(bot.buildWarningLines({ _viralScore: 85 }), ['🔥 โอกาสปัง: สูง (85/100)']);
  assert.deepEqual(bot.buildWarningLines({ _viralScore: 70 }), ['🔥 โอกาสปัง: สูง (70/100)']);
  assert.deepEqual(bot.buildWarningLines({ _viralScore: 69.4 }), ['🔥 โอกาสปัง: กลาง (69/100)']);
  assert.deepEqual(bot.buildWarningLines({ _viralScore: 40 }), ['🔥 โอกาสปัง: กลาง (40/100)']);
  assert.deepEqual(bot.buildWarningLines({ _viralScore: '39' }), ['🔥 โอกาสปัง: ต่ำ (39/100)']);
  assert.deepEqual(bot.buildWarningLines({ _viralScore: { score: 12 } }), ['🔥 โอกาสปัง: ต่ำ (12/100)']);
  assert.deepEqual(bot.buildWarningLines({ _viralScore: { total: 91 } }), ['🔥 โอกาสปัง: สูง (91/100)']);
  for (const bad of [150, -1, 'abc', null, undefined, {}, { score: 'x' }, NaN]) {
    assert.deepEqual(bot.buildWarningLines({ _viralScore: bad }), [], `_viralScore=${String(bad)} ต้องไม่โชว์`);
  }
  // ครบทั้งสาม → ลำดับคงที่
  const all = bot.buildWarningLines({ ...v2(), _viralScore: 77 });
  assert.equal(all.length, 3);
  assert.ok(all[0].startsWith('⚠️ อาจตกข้อเท็จจริง'));
  assert.equal(all[1], `⚠️ ${DIVERSITY_TEXT}`);
  assert.equal(all[2], '🔥 โอกาสปัง: สูง (77/100)');
  // สวิตช์ปิด = ไม่เติมอะไรเลย
  const off = loadBot({ axios: makeAxios().axios, env: { BOT_REVIEW_REACTIONS: '0' } }).bot;
  assert.deepEqual(off.buildWarningLines({ ...v2(), _viralScore: 77 }), []);
});

test('buildWarningTail: เว้นบรรทัดแล้วต่อท้าย · รวมกับเนื้อแล้วไม่เกินเพดาน embed 4096 · เนื้อเต็มเพดาน = ไม่เติม', () => {
  const { bot } = loadBot({ axios: makeAxios().axios });
  assert.equal(bot.buildWarningTail('เนื้อ', []), '');
  assert.equal(bot.buildWarningTail('เนื้อ', ['⚠️ ก', '🔥 ข']), '\n\n⚠️ ก\n🔥 ข');
  const tail = bot.buildWarningTail('ก'.repeat(4090), ['⚠️ อาจตกข้อเท็จจริง: 209,678 บาท']);
  assert.equal(tail.length, 6, 'เหลือที่ 6 ตัว → ตัดให้พอดี');
  assert.equal(bot.buildWarningTail('ก'.repeat(4096), ['⚠️ x']), '');
  assert.equal(bot.buildWarningTail('ก'.repeat(5000), ['⚠️ x']), '');
});

test('เส้นทางปกติ (ผลรูปทรงจริงจากคิว): ลิงก์ 🔗 ได้ caseId จาก data.generationLog · ติดปุ่ม 👍👎📌 หลัง ✅ · embed เติมบรรทัดเตือนท้ายเนื้อ · จำ messageId→caseId', async () => {
  const { bot, p1, m1, logs } = await runToSuccess();
  const finalEdit = p1.edits[p1.edits.length - 1];
  assert.match(finalEdit, /^✅ \*\*สร้างข่าวสำเร็จ!\*\* 2 เวอร์ชัน \| ใช้เวลา \d+\.\ds\n📰 \*\*ลุงสามล้อ\*\*\n🔗 ดูผลลัพธ์เต็ม: http:\/\/api\.test\/generation-logs\/05268$/u,
    'ข้อความ ✅ รูปแบบเดิม + ลิงก์ที่ได้ caseId จาก data.generationLog.caseId (path จริง)');
  assert.deepEqual(p1.reactions, ['👍', '👎', '📌'], 'ปุ่ม 3 อันเรียงตามนี้บนข้อความผล');
  const successAt = p1.timeline.findIndex((e) => e.startsWith('edit:✅'));
  const firstReactAt = p1.timeline.findIndex((e) => e.startsWith('react:'));
  assert.ok(successAt >= 0 && firstReactAt > successAt, `ต้องติดปุ่มหลังแก้ข้อความเป็น ✅ (timeline: ${p1.timeline.join(' > ')})`);
  assert.equal(bot.reviewCaseFor('P1'), '05268');
  assert.equal(bot.reviewCaseFor('P-unknown'), null);
  // embed เวอร์ชัน: เนื้อเดิม + เว้นบรรทัด + คำเตือน (V1 มีแค่ความคล้าย · V2 มีตกข้อเท็จจริงด้วย)
  assert.equal(m1.replies.length, 4, 'ack + embed V1 + embed V2 + สรุป research');
  assert.equal(m1.replies[1].embeds[0].data.title, '[[A1] เรื่องเล่าอบอุ่น] ลุงสามล้อ');
  assert.equal(m1.replies[1].embeds[0].data.description, `เนื้อข่าว V1\n\n⚠️ ${DIVERSITY_TEXT}`);
  assert.equal(m1.replies[2].embeds[0].data.description, `เนื้อข่าว V2\n\n⚠️ อาจตกข้อเท็จจริง: 209,678 บาท · ห่วงเรื่องการขับรถ\n⚠️ ${DIVERSITY_TEXT}`);
  assert.equal(m1.replies[3].embeds[0].data.title, '📄 เขียนจากเนื้อต้นฉบับอย่างเดียว');
  assert.deepEqual(m1.reactions, ['✅'], 'reaction ✅ บนข้อความต้นทางยังเหมือนเดิม');
  assert.ok(!logs.some((l) => l.includes('ไม่ติดปุ่มตรวจ')));

  // เวอร์ชันไม่มีคำเตือนเลย → description = เนื้อเดิมทุกไบต์ (ไม่มีบรรทัดว่างงอก)
  const plain = await runToSuccess({ statuses: [DONE(realResult({ versions: [{ content: 'เนื้อล้วน', style: 'Classic', _source: 'classic' }] }))] });
  assert.equal(plain.m1.replies[1].embeds[0].data.description, 'เนื้อล้วน');
  assert.deepEqual(plain.p1.reactions, ['👍', '👎', '📌']);

  // ผลไม่มี caseId เลย (ไม่มี generationLog) → ไม่มีลิงก์ ไม่ติดปุ่ม (กดแล้วบันทึกไม่ได้) + เตือนใน log · งานหลักยังจบปกติ
  const noCase = realResult();
  delete noCase.data.generationLog;
  const nc = await runToSuccess({ statuses: [DONE(noCase)] });
  assert.match(nc.p1.edits[nc.p1.edits.length - 1], /^✅ \*\*สร้างข่าวสำเร็จ!\*\* 2 เวอร์ชัน/u);
  assert.ok(!nc.p1.edits[nc.p1.edits.length - 1].includes('🔗'));
  assert.deepEqual(nc.p1.reactions, []);
  assert.equal(nc.bot.reviewCaseFor('P1'), null);
  assert.ok(nc.logs.some((l) => l.includes('ไม่ติดปุ่มตรวจ')));
  assert.deepEqual(nc.m1.reactions, ['✅']);

  // รูปทรงเก่า (data.caseId) ยังอ่านได้เหมือนเดิม
  const legacy = { success: true, data: { caseId: 'CASE9', newsData: { newsTitle: 'เก่า' }, analysisResult: { versions: [v1()], qualityWarnings: [] } } };
  const lg = await runToSuccess({ statuses: [DONE(legacy)] });
  assert.ok(lg.p1.edits[lg.p1.edits.length - 1].endsWith('/generation-logs/CASE9'));
  assert.equal(lg.bot.reviewCaseFor('P1'), 'CASE9');
});

test('เนื้อยาวเกิน 3800 + คำเตือนครบ → description ไม่เกิน 4096 และเนื้อ 3800 ตัวแรกไม่ถูกแตะ · react ล้มไม่ทำงานหลักพัง', async () => {
  const long = { content: 'ก'.repeat(5000), style: 'X', _source: 'classic', _diversityWarning: DIVERSITY_TEXT, _viralScore: 88,
    _missingFacts: { missing: ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ', 'ช'].map((t) => ({ type: 'name', text: t })) } };
  const { m1, p1 } = await runToSuccess({ statuses: [DONE(realResult({ versions: [long] }))] });
  const d = m1.replies[1].embeds[0].data.description;
  assert.ok(d.length <= 4096, `description ยาว ${d.length}`);
  assert.ok(d.startsWith('ก'.repeat(3800)));
  assert.equal(d.slice(3800, 3802), '\n\n');
  assert.ok(d.includes('⚠️ อาจตกข้อเท็จจริง: ก · ข · ค · ง · จ (+2)'));
  assert.ok(d.includes('🔥 โอกาสปัง: สูง (88/100)'));
  assert.deepEqual(p1.reactions, ['👍', '👎', '📌']);

  // react โยน error (เช่น Missing Permissions 50013) → เตือนใน log แล้วไปต่อ ยังโพสต์ embed + ✅ ครบ
  const p2 = makeProcessingMsg('P2');
  p2.react = async (e) => { throw discordError(50013, `Missing Permissions ${e}`, 403); };
  const m2 = makeSourceMsg('M2', p2);
  const t = makeAxios({ statuses: [DONE()] });
  const { bot, logs } = loadBot({ axios: t.axios });
  await bot.processNewsJob({ message: m2, content: NEWS_TEXT, processingMsg: null, addedAt: Date.now() });
  assert.equal(m2.replies.length, 4);
  assert.deepEqual(m2.reactions, ['✅']);
  assert.equal(logs.filter((l) => l.includes('ติดปุ่ม') && l.includes('ไม่สำเร็จ')).length, 3);
  assert.equal(bot.reviewCaseFor('P2'), '05268', 'ติดปุ่มไม่ได้ก็ยังจำ caseId ไว้ (คนอาจกดอีโมจิเองได้)');
});

test('กด 👍 บนข้อความผล → PATCH /api/generation-logs/<caseId> {status:good, reviewNote} ด้วย header เดิม → เติมบรรทัด "📝 บันทึกแล้ว ✅ ผ่าน โดย @ชื่อ" ท้ายข้อความ', async () => {
  const { bot, calls, p1 } = await runToSuccess();
  const before = p1.content;
  const r = await bot.handleReaction(makeReaction('👍', p1), human());
  assert.equal(r.ok, true);
  assert.equal(r.caseId, '05268');
  assert.equal(r.status, 'good');
  assert.equal(r.notified, 'edited');
  assert.equal(calls.patch.length, 1);
  assert.equal(calls.patch[0].url, reviewUrl('05268'));
  assert.equal(calls.patch[0].body.status, 'good');
  assert.match(calls.patch[0].body.reviewNote, /Discord 👍 ✅ ผ่าน โดย สมชาย \(U1\)/u);
  assert.deepEqual(Object.keys(calls.patch[0].body).sort(), ['reviewNote', 'status'], 'body เหมือนหน้าเว็บ: status + reviewNote เท่านั้น');
  assert.equal(calls.patch[0].headers['x-api-key'], 'S3CRET');
  assert.equal(calls.patch[0].headers['Content-Type'], 'application/json');
  assert.equal(p1.content, `${before}\n📝 บันทึกแล้ว ✅ ผ่าน โดย @สมชาย`, 'ข้อความเดิมคงทุกไบต์ + เติมบรรทัดท้าย 1 บรรทัด');
  assert.ok(p1.content.startsWith('✅ **สร้างข่าวสำเร็จ!**'));
  assert.equal(p1.replies.length, 0, 'ไม่ตอบข้อความใหม่ (แก้ในข้อความผลแทน)');
  // ชื่อที่โชว์: displayName > globalName > username > tag > id
  const r2 = await bot.handleReaction(makeReaction('📌', p1), human({ id: 'U2', globalName: null, username: 'nok_editor' }));
  assert.equal(r2.ok, true);
  assert.equal(calls.patch[1].body.status, 'used');
  assert.match(calls.patch[1].body.reviewNote, /📌 ใช้แล้ว โดย nok_editor \(U2\)/u);
  assert.ok(p1.content.endsWith('\n📝 บันทึกแล้ว 📌 ใช้แล้ว โดย @nok_editor'));
});

test('ไม่ยิง PATCH: บอทกดเอง (user.bot / id ตรงบอท) · อีโมจิไม่ใช่ 3 ปุ่ม · ข้อความไม่ใช่ของบอท · ไม่รู้ caseId · สวิตช์ปิด', async () => {
  const { bot, calls, p1 } = await runToSuccess();
  const before = p1.content;
  assert.deepEqual(await bot.handleReaction(makeReaction('👍', p1), human({ id: BOT_USER_ID, bot: true, username: 'bot' })), { ok: false, skipped: 'bot' });
  assert.deepEqual(await bot.handleReaction(makeReaction('👍', p1), human({ id: BOT_USER_ID, bot: undefined })), { ok: false, skipped: 'bot' }, 'id ตรงบอทก็พอ (กัน user.bot หาย)');
  assert.deepEqual(await bot.handleReaction(makeReaction('👍', p1), human({ id: 'OTHERBOT', bot: true })), { ok: false, skipped: 'bot' });
  assert.deepEqual(await bot.handleReaction(makeReaction('🔥', p1), human()), { ok: false, skipped: 'emoji' });
  assert.deepEqual(await bot.handleReaction(makeReaction('✅', p1), human()), { ok: false, skipped: 'emoji' });
  const notOurs = makeProcessingMsg('X1', { authorId: 'U9', content: 'ดูผล http://api.test/generation-logs/05268' });
  assert.deepEqual(await bot.handleReaction(makeReaction('👍', notOurs), human()), { ok: false, skipped: 'not_ours' });
  const noAuthor = makeProcessingMsg('X2', { content: 'ดูผล http://api.test/generation-logs/05268' });
  delete noAuthor.author;
  assert.deepEqual(await bot.handleReaction(makeReaction('👍', noAuthor), human()), { ok: false, skipped: 'not_ours' }, 'ไม่รู้ผู้เขียน = ไม่เสี่ยง');
  const unknown = makeProcessingMsg('X3', { content: '⚡ **Auto Pipeline V2** กำลังประมวลผล...' });
  assert.deepEqual(await bot.handleReaction(makeReaction('👍', unknown), human()), { ok: false, skipped: 'no_case' });
  assert.deepEqual(await bot.handleReaction(null, human()), { ok: false, skipped: 'no_args' });
  assert.deepEqual(await bot.handleReaction(makeReaction('👍', p1), null), { ok: false, skipped: 'no_args' });
  assert.equal(calls.patch.length, 0, 'ทุกกรณีข้างบนห้ามยิง PATCH');
  assert.equal(p1.content, before);
  assert.equal(unknown.content, '⚡ **Auto Pipeline V2** กำลังประมวลผล...');

  // สวิตช์ปิด: ไม่ติดปุ่ม ไม่เติมคำเตือน ไม่รับ reaction — ข้อความผลเหมือนเดิมทุกไบต์
  const off = await runToSuccess({ env: { BOT_REVIEW_REACTIONS: '0' } });
  assert.deepEqual(off.p1.reactions, []);
  assert.equal(off.m1.replies[1].embeds[0].data.description, 'เนื้อข่าว V1');
  assert.match(off.p1.edits[off.p1.edits.length - 1], /🔗 ดูผลลัพธ์เต็ม: http:\/\/api\.test\/generation-logs\/05268$/u, 'ลิงก์ path จริงยังขึ้นแม้ปิดสวิตช์ (เป็นการแก้ path ไม่ใช่ฟีเจอร์ปุ่ม)');
  assert.deepEqual(await off.bot.handleReaction(makeReaction('👍', off.p1), human()), { ok: false, skipped: 'off' });
  assert.equal(off.calls.patch.length, 0);
  // ค่าอื่นนอกจาก '0' = เปิด (แบบเดียวกับ BOT_RESUME_TRACKING)
  for (const v of ['off', 'false', '', 'no']) {
    const l = loadBot({ axios: makeAxios().axios, env: { BOT_REVIEW_REACTIONS: v } });
    assert.equal(l.handlers.messageReactionAdd?.length, 1, `ค่า '${v}' ต้องยังเปิด`);
  }
  const one = loadBot({ axios: makeAxios().axios, env: { BOT_REVIEW_REACTIONS: '1' } });
  assert.equal(one.handlers.messageReactionAdd?.length, 1);
});

test('บอทรีสตาร์ต (แผนที่ในหน่วยความจำว่าง) → อ่าน caseId จากลิงก์ 🔗 ในข้อความผล · 👎 → bad · ลิงก์ผิดรูป/ไม่มี = ไม่บันทึก', async () => {
  const t = makeAxios();
  const { bot } = loadBot({ axios: t.axios });
  assert.equal(bot.reviewCaseFor('P1'), null);
  const p1 = makeProcessingMsg('P1', { content: '✅ **สร้างข่าวสำเร็จ!** 2 เวอร์ชัน | ใช้เวลา 250.3s\n📰 **ลุงสามล้อ**\n🔗 ดูผลลัพธ์เต็ม: http://api.test/generation-logs/05266' });
  const r = await bot.handleReaction(makeReaction('👎', p1), human());
  assert.equal(r.ok, true);
  assert.equal(t.calls.patch.length, 1);
  assert.equal(t.calls.patch[0].url, reviewUrl('05266'));
  assert.equal(t.calls.patch[0].body.status, 'bad');
  assert.ok(p1.content.endsWith('\n📝 บันทึกแล้ว ❌ ไม่ผ่าน โดย @สมชาย'));
  assert.ok(p1.content.startsWith('✅ **สร้างข่าวสำเร็จ!** 2 เวอร์ชัน | ใช้เวลา 250.3s\n📰 **ลุงสามล้อ**\n🔗 ดูผลลัพธ์เต็ม: http://api.test/generation-logs/05266\n'));
  // ลิงก์ของโดเมนอื่นก็อ่านได้ (บอทเก่าที่ API_URL ต่างกัน) — ใช้เฉพาะเลขเคส ยิงไป API_URL ของตัวเอง
  const p2 = makeProcessingMsg('P2', { content: '🔗 ดูผลลัพธ์เต็ม: https://viral.vercel.app/generation-logs/05201' });
  await bot.handleReaction(makeReaction('📌', p2), human());
  assert.equal(t.calls.patch[1].url, reviewUrl('05201'));
  // ไม่มีลิงก์ / ลิงก์ไม่มีเลขเคส → ไม่ยิง
  const p3 = makeProcessingMsg('P3', { content: '🔗 ดูผลลัพธ์เต็ม: http://api.test/generation-logs/' });
  assert.deepEqual(await bot.handleReaction(makeReaction('👍', p3), human()), { ok: false, skipped: 'no_case' });
  assert.equal(t.calls.patch.length, 2);
});

test('ข้อความ/reaction เป็น partial (ไม่อยู่ในแคชหลังรีสตาร์ต) → fetch ก่อนแล้วค่อยบันทึก · fetch ล้ม (Unknown Message) = ข้ามเงียบ ไม่ยิง', async () => {
  const t = makeAxios();
  const { bot, logs } = loadBot({ axios: t.axios });
  // reaction partial → fetch() คืนตัวเต็มที่มี message
  const full = makeProcessingMsg('P1', { content: '🔗 ดูผลลัพธ์เต็ม: http://api.test/generation-logs/05268' });
  const partialReaction = makeReaction('👍', { id: 'P1', partial: true, author: null, content: null }, { partial: true });
  partialReaction.fetch = async () => { partialReaction.fetched++; partialReaction.partial = false; partialReaction.message = full; return partialReaction; };
  const r = await bot.handleReaction(partialReaction, human());
  assert.equal(r.ok, true);
  assert.equal(partialReaction.fetched, 1);
  assert.equal(t.calls.patch[0].url, reviewUrl('05268'));
  assert.ok(full.content.endsWith('📝 บันทึกแล้ว ✅ ผ่าน โดย @สมชาย'));
  // message partial → message.fetch() คืนข้อความเต็ม (content + author)
  const fetchedMsg = makeProcessingMsg('P2', { content: '🔗 ดูผลลัพธ์เต็ม: http://api.test/generation-logs/05267' });
  const partialMsg = { id: 'P2', partial: true, author: null, content: null, fetched: 0, fetch: async () => { partialMsg.fetched++; return fetchedMsg; } };
  const r2 = await bot.handleReaction(makeReaction('👎', partialMsg), human());
  assert.equal(r2.ok, true);
  assert.equal(partialMsg.fetched, 1);
  assert.equal(t.calls.patch[1].url, reviewUrl('05267'));
  assert.equal(t.calls.patch[1].body.status, 'bad');
  assert.ok(fetchedMsg.content.endsWith('📝 บันทึกแล้ว ❌ ไม่ผ่าน โดย @สมชาย'));
  // fetch โยน Unknown Message → ข้ามเงียบ
  const gone = { id: 'P3', partial: true, author: null, content: null, fetch: async () => { throw discordError(10008, 'Unknown Message'); } };
  assert.deepEqual(await bot.handleReaction(makeReaction('👍', gone), human()), { ok: false, skipped: 'fetch_failed' });
  assert.equal(t.calls.patch.length, 2);
  assert.ok(logs.some((l) => l.includes('ดึงข้อความที่ถูกกดไม่ได้')));
  // อีโมจิไม่ใช่ปุ่ม → ไม่ต้อง fetch เลย (ไม่เปลืองคำขอ Discord)
  const lazy = makeReaction('🔥', { id: 'P4', partial: true, fetch: async () => { throw new Error('must not fetch'); } }, { partial: true });
  lazy.fetch = async () => { throw new Error('must not fetch reaction'); };
  assert.deepEqual(await bot.handleReaction(lazy, human()), { ok: false, skipped: 'emoji' });
});

test('กดซ้ำ/กดหลายปุ่ม = ครั้งล่าสุดชนะ: PATCH เรียงตามลำดับกด · บรรทัด 📝 มีบรรทัดเดียว (แทนที่ ไม่งอกซ้อน) · กดรัวพร้อมกันก็เรียงถูก', async () => {
  // เซิร์ฟเวอร์ตอบ 'used' ช้ากว่า 'good' 15ms — ถ้าไม่ต่อคิวต่อข้อความ ปุ่มที่กดก่อน (📌) จะไปเขียนทับผลของปุ่มที่กดทีหลัง (👍)
  const { bot, calls, p1 } = await runToSuccess({ patch: { delayMs: { used: 15 } } });
  const base = p1.content;
  await bot.handleReaction(makeReaction('👍', p1), human());
  await bot.handleReaction(makeReaction('👎', p1), human({ id: 'U2', globalName: 'สมหญิง' }));
  assert.deepEqual(calls.patch.map((c) => c.body.status), ['good', 'bad']);
  const lines = p1.content.split('\n').filter((l) => l.startsWith('📝 บันทึกแล้ว'));
  assert.deepEqual(lines, ['📝 บันทึกแล้ว ❌ ไม่ผ่าน โดย @สมหญิง']);
  assert.equal(p1.content, `${base}\n📝 บันทึกแล้ว ❌ ไม่ผ่าน โดย @สมหญิง`);
  // กดรัวไม่รอกัน: 📌 แล้ว 👍 → PATCH ต้องเรียง used → good และผลสุดท้าย = ✅ ผ่าน
  const results = await Promise.all([
    bot.handleReaction(makeReaction('📌', p1), human()),
    bot.handleReaction(makeReaction('👍', p1), human({ id: 'U3', globalName: 'สมศักดิ์' })),
  ]);
  assert.deepEqual(results.map((r) => r.ok), [true, true]);
  assert.deepEqual(calls.patch.map((c) => c.body.status), ['good', 'bad', 'used', 'good']);
  assert.equal(p1.content, `${base}\n📝 บันทึกแล้ว ✅ ผ่าน โดย @สมศักดิ์`);
  assert.equal(p1.content.split('📝 บันทึกแล้ว').length - 1, 1, 'มีบรรทัด 📝 เดียวเท่านั้น');
});

test('PATCH ล้ม (สายพัง) หรือเซิร์ฟเวอร์ตอบ success:false → ไม่แตะข้อความ ไม่โยน error · แก้ข้อความไม่ได้ = ยังถือว่าบันทึกแล้ว', async () => {
  const down = await runToSuccess({ patch: { throws: Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }) } });
  const before = down.p1.content;
  const r = await down.bot.handleReaction(makeReaction('👍', down.p1), human());
  assert.equal(r.ok, false);
  assert.equal(r.caseId, '05268');
  assert.match(r.error, /500/);
  assert.equal(down.calls.patch.length, 1, 'ยิงแล้ว 1 ครั้ง (ล้ม)');
  assert.equal(down.p1.content, before, 'ล้ม = ห้ามขึ้น "บันทึกแล้ว"');
  assert.ok(down.logs.some((l) => l.includes('บันทึกเคส 05268 ไม่สำเร็จ')));

  const rejected = await runToSuccess({ patch: { response: { success: false, error: 'status ต้องเป็น good, bad, unreviewed หรือ used', errorType: 'INVALID_STATUS' } } });
  const before2 = rejected.p1.content;
  const r2 = await rejected.bot.handleReaction(makeReaction('👎', rejected.p1), human());
  assert.equal(r2.ok, false);
  assert.match(r2.error, /INVALID|status/u);
  assert.equal(rejected.p1.content, before2);

  // PATCH สำเร็จแต่ Discord แก้ข้อความไม่ได้ (เช่น 50001) → คืน ok:true notified:'failed' ไม่โยน
  const ok = await runToSuccess();
  ok.p1.edit = async () => { throw discordError(50001, 'Missing Access', 403); };
  ok.p1.reply = async () => { throw discordError(50001, 'Missing Access', 403); };
  const r3 = await ok.bot.handleReaction(makeReaction('👍', ok.p1), human());
  assert.equal(r3.ok, true);
  assert.equal(r3.notified, 'failed');
  assert.equal(ok.calls.patch.length, 1);

  // handler ที่ผูกกับ client ต้องไม่โยนออกไปแม้ข้างในพัง (กัน unhandled rejection ทำบอทล้ม)
  const t = makeAxios();
  const { handlers, logs } = loadBot({ axios: t.axios });
  const evil = { emoji: { get name() { throw new Error('boom'); } }, message: null };
  assert.doesNotThrow(() => handlers.messageReactionAdd[0](evil, human()));
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(logs.some((l) => l.includes('จัดการ reaction ล้ม')));
  assert.equal(t.calls.patch.length, 0);
});

test('ข้อความผลยาวจนเติมบรรทัดแล้วเกิน 2000 → ตอบเป็นข้อความสั้นแทนการแก้ (ไม่ให้ Discord ปัด)', async () => {
  const t = makeAxios();
  const { bot } = loadBot({ axios: t.axios });
  const longContent = `✅ **สร้างข่าวสำเร็จ!**\n${'ข'.repeat(1900)}\n🔗 ดูผลลัพธ์เต็ม: http://api.test/generation-logs/05268`;
  const p1 = makeProcessingMsg('P1', { content: longContent });
  const r = await bot.handleReaction(makeReaction('👍', p1), human());
  assert.equal(r.ok, true);
  assert.equal(r.notified, 'replied');
  assert.equal(p1.content, longContent, 'ไม่แก้ข้อความเดิม');
  assert.deepEqual(p1.replies, ['📝 บันทึกแล้ว ✅ ผ่าน โดย @สมชาย']);
  assert.equal(t.calls.patch.length, 1);
});

test('เส้นทางกู้หลังรีสตาร์ต (resumeTrackedJobs) โพสต์ผลแล้วก็ติดปุ่ม 3 อัน + จำ caseId เหมือนเส้นทางปกติ', async () => {
  const p1 = makeProcessingMsg('P1');
  const m1 = makeSourceMsg('M1', p1);
  const entry = { id: 'bt_JOB1', jobId: 'JOB1', channelId: 'CH1', messageId: 'P1', sourceMessageId: 'M1', guildId: 'G1', userId: 'U1',
    instance: 'oldhost_dead1', startedAt: ago(5), queueUrl: 'http://api.test/api/queue/add' };
  const t = makeAxios({ statuses: [PROCESSING(), DONE()], tracking: [entry] });
  const { bot } = loadBot({ axios: t.axios, channels: { CH1: makeChannel({ P1: p1, M1: m1 }) } });
  const summary = await bot.resumeTrackedJobs();
  assert.equal(summary.resumed, 1);
  assert.match(p1.edits[p1.edits.length - 1], /🔗 ดูผลลัพธ์เต็ม: http:\/\/api\.test\/generation-logs\/05268$/u);
  assert.deepEqual(p1.reactions, ['👍', '👎', '📌']);
  assert.equal(bot.reviewCaseFor('P1'), '05268');
  assert.equal(m1.replies.length, 3, 'เส้นทางกู้ไม่มี ack (ข้อความผลมีอยู่แล้ว): embed V1 + V2 + สรุป research');
  assert.equal(m1.replies[0].embeds[0].data.description, `เนื้อข่าว V1\n\n⚠️ ${DIVERSITY_TEXT}`);
  assert.equal(t.tracking.length, 0, 'จบงานแล้วสมุดว่างเหมือนเดิม');
  // กดปุ่มบนข้อความที่กู้มา → บันทึกได้
  const r = await bot.handleReaction(makeReaction('📌', p1), human());
  assert.equal(r.ok, true);
  assert.equal(t.calls.patch[0].url, reviewUrl('05268'));
  assert.equal(t.calls.patch[0].body.status, 'used');
});
