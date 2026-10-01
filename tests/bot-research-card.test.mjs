// ============================================================
// ★ 1 ต.ค. 69 (Research Agent v2 · เฟส 1 · เลน C discord · SPEC-v2 ส่วน 7 / 11-C) — บัตรข้อเท็จจริงในดิสคอร์ด
//   discord-bot/researchCard.js (โมดูลใหม่) · จุดเรียกใน discord-bot/index.js · src/app/api/bot/posted/route.js (ใหม่)
//   สวิตช์ RESEARCH_AGENT=1 (env ของบอทบน Railway) — ไม่ตั้ง/ค่าอื่น = บอทเดิมทุกไบต์
// ------------------------------------------------------------
// วิธีโหลด: อ่านซอร์สจริงแล้วรันใน new Function (แบบ tests/bot-resume.test.mjs) แทน discord.js/axios/dotenv ด้วยตัวปลอม
//   + นาฬิกาเสมือน: scheduler เรียงตามเวลา (setTimeout/clearTimeout ปลอม) + Date ปลอม — ไม่มี timer จริง ไม่มี unref
//   ทุก await ที่รอบอท/โมดูลครอบ settleWithin (tests/helpers/fake-deadline.mjs) — ค้าง = แดงข้อเดียว (บทเรียน CI node 22)
// byte-parity: ถอดจุดเรียกของเลนนี้ออกจากซอร์สบอท (stripLaneC) แล้วเทียบ "บันทึกทุกการกระทำ" ของบอท 2 ฉบับเมื่อปิดสวิตช์
//   (HTTP ทุกคำขอ+body+header · ข้อความ/embed/reaction ใน Discord · timer ที่ตั้ง · log · intents/partials · ตัวฟัง event) ต้องตรงกันทุกไบต์
// กลายพันธุ์ (mutation) อยู่ท้ายไฟล์ (M1–M14): patch ซอร์สเป็นสตริง (mutate ยืนยันว่าเจอข้อความต้นทาง) แล้วข้อยืนยันชุดเดียวกับเทสหลักต้อง "แดง"
// ผลทุบไฟล์จริง (ยิงจริง 1 ต.ค. 69 ด้วยสคริปต์ทุบ-เทส-คืนไฟล์ byte-exact ตรวจ sha256 · กัด 7/7 · คืนแล้วเขียวครบ):
//   X1 researchCard enabled=true เสมอ → แดง 4 (applySourceUrls · สวิตช์ปิด · byte-parity · M1)
//   X2 index.js ตัด applySourceUrls → แดง 5 (byte-parity · เส้นทางจริง · M1 · M2 · M11)
//   X3 route ใช้ jobId ตรงๆ เป็น id แถว → แดง 4 (route ×3 · M6)    X4 ไม่หยุดหลังหาง 10 นาที → แดง 3 (หาง · ออฟไลน์ · M3)
//   X5 บัตรไม่ปิด mention → แดง 2 (ระหว่างรองาน · M4)               X6 intent reaction ไม่ผูก RESEARCH_AGENT → แดง 4
//   X7 route ไม่ fail-closed → แดง 1
//   r2 X8 researchCard ไม่อ่านคีย์ "cards" (บั๊กที่ผู้ตรวจจับ · ทุบไฟล์จริงแล้วคืน sha256 ตรง) → แดง 6 (สัญญาเลน B ×4 · M13 · M14)
//      ขณะเดียวกันชุดเดิม 42 ข้อเขียวครบทั้งที่บัตรไม่มีวันขึ้น = รอบ r1 เขียวหลอกเพราะป้อนแต่ {card} ที่เลน B ไม่เคยส่ง
//   + จำลองเส้นทาง node 22 บน node 24 (preload ทำ keepAlive ของ node:test เป็น unref — กลุ่มควบคุมที่รอ timer unref ถูกตัดจริง) → ไฟล์นี้เขียวครบ
// ★ r2 (ผู้ตรวจอิสระ FAIL ข้อ 1): LANE_B_CARDS = body ที่ handler GET /api/research/cards ตัวจริงของเลน B ส่ง (แถวการ์ดอยู่ใต้คีย์ "cards")
//   ใช้ 4 ข้อ: ฟังก์ชัน (pickCardRecord/buildCardView) · ตัวควบคุมระหว่างรองาน (queued → leased → done) · จบงาน (failed · expired)
//   · เส้นทางจริงของ index.js (ข้อยืนยันชุดเดียวกับ checkBotOn)
// ★ r3 1 ต.ค. 69 (ข้อตัดสินผู้คุมงานหลังตรวจสัญญาข้ามเลน — C:\tmp\research-agent-lab\contract-check.json):
//   #4 route /api/bot/posted เรียก saveBotPosted/getBotPosted ของเลน B (ไม่ใช้ persistStore ตรง) — เทสฉีด store ปลอมแทน
//      '@/lib/research-agent/store' ผ่านพารามิเตอร์ (import ทุกบรรทัดของ route ต้องเป็นโมดูลที่เทสเตรียม ไม่งั้นแดง · ไม่พึ่งไฟล์เลน B)
//      store ปลอมเลียนรูปแถวที่จับจากการรันฟังก์ชันจริงของเลน B (แถว bposted_<jobId> · data.id = jobId · revision · createdAt
//      · postedAt ตามที่บอทส่ง) + เส้นทางจริงต่อสายถึง route จริง (บอท → route → store ปลอม) กันบอทส่งของที่ route ไม่รับ (resultMsgIds เกิน 50)
//   #7 ไม่ส่ง x-research-secret (Railway ตั้งไว้ = เตือนใน log ไม่พิมพ์ค่า) · #8 เลน B ตอบ enabled:false (จับจากการรัน handler จริง) → เลิกถาม
//   #9 raw_corrections ป้ายลิงก์ = ชื่อโดเมน · หาง 10 → 15 นาที · เตือนโควตาที่ 15% พอดี (16% ไม่เตือน)
//   กลายพันธุ์ใหม่ M15–M24 (ท้ายไฟล์) · M6 เดิม (route ใช้ jobId ตรงเป็น id แถว) แทนด้วย M6 (r3) route ไม่ส่ง researchCardMsgId ต่อ
//   — id แถวเป็นของ store เลน B แล้ว · X3/X7 ด้านบนเป็นผลทุบ route ฉบับ r1 (persistStore) เก็บไว้เป็นประวัติ
// ชุดนี้ไม่ได้ตรวจ: discord.js/axios/Railway/Vercel ของจริง · route เลน B หลังรวมเลน (ฟิกซ์เจอร์จับ 1 ต.ค. — เลน B เปลี่ยนรูปทรงต้องจับใหม่)
//   · store เลน B ตัวจริง (เทสของเลน B + tests/research-xlane-gate.test.mjs ดูแล — ไฟล์นี้ห้าม import ข้าม worktree)
//   · /api/research/status ใช้รูปย่อ (status/quota.pct/quota.account — คีย์เดียวกับเลน B) · node 22 ของจริง (CI เป็นผู้ตัดสิน)
// รัน: node --test tests/bot-research-card.test.mjs (ไม่ต้องตั้ง env · ไม่ยิงเน็ต · ไม่มีค่าใช้จ่าย)
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 4 + สัญญา 8.1/8.2 · เลน W2): ส่วนที่ 6 ท้ายไฟล์ = "ใบที่สอง" (ผลบรรณาธิการ)
//   renderEditorCard 4 สถานะ (pure) · ทาง ก (ผลข่าวพก editor → noteJobResult) · ทาง ข (ช่อง editor ของคำตอบการ์ด/ถามต่อในหาง)
//   · กันโพสต์ซ้ำ (bot-posted.editorMsgId) · 👍/👎 → feedback เดิมติด kind:'editor' · ต่อสายจริง index.js + route
//   · byte-parity โหมดอื่น: ลายนิ้วมือที่จับจากโค้ดเฟส 1 (827336d7 ก่อนแก้ W2) + ฉบับถอดจุดเรียก W2 · mutation MW1–MW9
//   stripLaneC ถอดบล็อก W2 (LANE_W2_INSERTS) ด้วย = ฉบับก่อนมีรีเสิร์ช · store ปลอมเก็บ editorMsgId ตาม store จริงที่แก้คู่กัน
// ============================================================
/* eslint-disable no-await-in-loop -- เทสเดินนาฬิกาเสมือนทีละก้าว/ทีละสถานการณ์โดยตั้งใจ (ลำดับเวลาต้องเรียง ห้ามขนาน) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto'; // ★ 1 ต.ค. 69 (SPEC-v3 · W2): ลายนิ้วมือ byte-parity โหมด shadow/assist (ส่วนที่ 6)
import { settleWithin } from './helpers/fake-deadline.mjs';

const botUrl = new URL('../discord-bot/index.js', import.meta.url);
const cardUrl = new URL('../discord-bot/researchCard.js', import.meta.url);
const routeUrl = new URL('../src/app/api/bot/posted/route.js', import.meta.url);
const BOT_SRC = readFileSync(botUrl, 'utf8').replace(/\r\n/g, '\n');
const CARD_SRC = readFileSync(cardUrl, 'utf8').replace(/\r\n/g, '\n');
const ROUTE_SRC = readFileSync(routeUrl, 'utf8').replace(/\r\n/g, '\n');
const realRequire = createRequire(botUrl);

const API = 'http://api.test';
const BOT_ID = '900000000000000001';
const OWNER_ID = '800000000000000001';
const STAFF_ID = '700000000000000001';
const JOB = 'q_0123456789abcdef';
const START = Date.UTC(2026, 9, 1, 3, 0, 0); // 10:00 เวลาไทย
const SEC = 1000;
const MIN = 60 * SEC;
const ON = Object.freeze({ RESEARCH_AGENT: '1' });
const SRC_URL = 'https://www.facebook.com/localnews/posts/1649392430310047/';
const NEWS_TEXT = 'ชาวต่างชาติใส่ขาเทียมช่วยกรอกกระสอบทรายกั้นน้ำที่ราชบุรี ชาวบ้านชื่นชมน้ำใจ';
const NEWS_WITH_URL = `${NEWS_TEXT} ${SRC_URL}`;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// ── patch ซอร์สแบบต้องติดจริง (กันกลายพันธุ์ที่ไม่เปลี่ยนอะไรแล้วเทสเขียวหลอก) ──
function mutate(source, from, to) {
  assert.ok(source.includes(from), `mutation ต้องเจอข้อความต้นทาง: ${from.slice(0, 80)}`);
  return source.split(from).join(to);
}

// ── นาฬิกาเสมือน: timer เรียงตามเวลา · step() = เดินไปถึง timer ถัดไปแล้วยิง (รอ promise ที่ callback คืน) ──
function makeScheduler(start = START) {
  let now = start;
  let seq = 0;
  const queue = [];
  const delays = [];
  return {
    now: () => now,
    setTimeout: (fn, ms = 0) => {
      const delay = Math.max(0, Number(ms) || 0);
      const timer = { id: ++seq, at: now + delay, fn, cleared: false };
      queue.push(timer);
      delays.push(delay);
      return timer;
    },
    clearTimeout: (timer) => { if (timer && typeof timer === 'object') timer.cleared = true; },
    pending: () => queue.filter((t) => !t.cleared).length,
    delays,
    advance(ms) { now += ms; },
    async step() {
      const live = queue.filter((t) => !t.cleared).sort((a, b) => a.at - b.at || a.id - b.id);
      if (live.length === 0) return false;
      const timer = live[0];
      queue.splice(queue.indexOf(timer), 1);
      if (timer.at > now) now = timer.at;
      const ret = timer.fn();
      if (ret && typeof ret.then === 'function') {
        // รอ promise ที่ callback คืน (รอบถามของโมดูล) แต่ไม่รอไม่จบ — คำขอที่ค้างจริง (เทส fail-open) ต้องไม่ทำให้นาฬิกาค้าง
        let settled = false;
        ret.then(() => { settled = true; }, () => { settled = true; });
        for (let i = 0; i < 20 && !settled; i++) await flush();
      } else {
        await flush();
      }
      return true;
    },
  };
}

function makeFakeDate(sched) {
  return class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(sched.now());
      else super(...args);
    }
    static now() { return sched.now(); }
  };
}

// วิ่งงาน async พร้อมเดินนาฬิกาเสมือนจนงานจบ (ไม่มี timer เหลือแต่งานไม่จบ = แดงพร้อมข้อความ)
async function drive(sched, promise, label, maxSteps = 4000) {
  let settled = false;
  let failure = null;
  let value;
  promise.then((v) => { settled = true; value = v; }, (e) => { settled = true; failure = e; });
  const loop = (async () => {
    for (let i = 0; i < maxSteps; i++) {
      await flush();
      if (settled) return;
      const fired = await sched.step();
      if (!fired) {
        await flush();
        if (!settled) throw new Error(`${label}: ไม่มี timer เหลือแต่งานยังไม่จบ`);
      }
    }
    throw new Error(`${label}: เกิน ${maxSteps} ก้าว`);
  })();
  await settleWithin(loop, label, 15_000);
  if (failure) throw failure;
  return value;
}

// เดินนาฬิกาจน timer หมด (การตามบัตรเลิกเอง) · คืนจำนวนก้าว
async function drain(sched, label, maxSteps = 4000) {
  const loop = (async () => {
    for (let i = 0; i < maxSteps; i++) {
      await flush();
      if (sched.pending() === 0) return i;
      await sched.step();
    }
    throw new Error(`${label}: timer ไม่หมดใน ${maxSteps} ก้าว`);
  })();
  return settleWithin(loop, label, 15_000);
}

class FakeEmbed {
  constructor() { this.data = {}; }
  setColor(c) { this.data.color = c; return this; }
  setTitle(t) { this.data.title = t; return this; }
  setDescription(d) { this.data.description = d; return this; }
  addFields(...fields) { (this.data.fields ||= []).push(...fields.flat()); return this; }
  setFooter(f) { this.data.footer = f; return this; }
}
const embedOf = (title) => new FakeEmbed().setTitle(title).setDescription('เนื้อ');

// ── โลก Discord ปลอม: ห้องเดียว · id แบบ snowflake เรียงตามเวลาสร้าง · ข้อความบอท reply = มี reference ──
function makeWorld({ record = () => {} } = {}) {
  let seq = 1000000000000000000n;
  const nextId = () => String(++seq);
  const channel = { id: 'CH1', history: [], sends: [] };
  const world = { channel, messages: new Map(), failReplyTo: new Set() };
  const ser = (payload) => (typeof payload === 'string' ? payload : {
    content: payload?.content ?? null,
    embeds: (payload?.embeds || []).map((e) => clone(e.data ?? e)),
    allowedMentions: payload?.allowedMentions ?? null,
  });
  function botMessage(payload, referenceId) {
    const msg = {
      id: nextId(),
      channelId: channel.id,
      channel,
      guild: { ownerId: OWNER_ID },
      author: { id: BOT_ID, bot: true },
      reference: referenceId ? { messageId: referenceId } : null,
      content: typeof payload === 'string' ? payload : (payload?.content ?? ''),
      embeds: (payload && typeof payload === 'object' && Array.isArray(payload.embeds) ? payload.embeds : [])
        .map((e) => ({ title: e.data?.title, footer: e.data?.footer, data: e.data })),
      payload,
      partial: false,
      edits: [],
      reactions: [],
      replies: [],
      async edit(c) {
        const text = typeof c === 'string' ? c : c.content;
        msg.content = text;
        msg.edits.push(text);
        record('edit', { id: msg.id, content: text });
        return msg;
      },
      async react(e) { msg.reactions.push(e); record('react', { id: msg.id, emoji: e }); },
      async reply(p) { return replyTo(msg, p); },
      async fetch() { return msg; },
      async delete() { record('delete', { id: msg.id }); },
    };
    channel.history.push(msg);
    world.messages.set(msg.id, msg);
    return msg;
  }
  async function replyTo(target, payload) {
    if (world.failReplyTo.has(target.id)) {
      record('reply_failed', { to: target.id });
      throw Object.assign(new Error('Invalid Form Body (message_reference: Unknown message)'), { code: 50035 });
    }
    record('reply', { to: target.id, payload: ser(payload) });
    target.replies.push(payload);
    return botMessage(payload, target.id);
  }
  channel.send = async (payload) => {
    record('send', { channel: channel.id, payload: ser(payload) });
    channel.sends.push(payload);
    return botMessage(payload, null);
  };
  channel.messages = {
    fetch: async (arg) => {
      if (arg && typeof arg === 'object') {
        const after = BigInt(arg.after ?? 0);
        const list = channel.history.filter((m) => BigInt(m.id) > after).slice(0, arg.limit ?? 50);
        return new Map(list.map((m) => [m.id, m]));
      }
      const m = world.messages.get(String(arg));
      if (!m) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      return m;
    },
  };
  function staffMessage(content = NEWS_WITH_URL) {
    const msg = {
      id: nextId(),
      channelId: channel.id,
      channel,
      guildId: 'G1',
      guild: { ownerId: OWNER_ID },
      author: { id: STAFF_ID, tag: 'staff#0', bot: false },
      content,
      replies: [],
      reactions: [],
      async reply(p) { return replyTo(msg, p); },
      async react(e) { msg.reactions.push(e); record('react', { id: msg.id, emoji: e }); },
    };
    channel.history.push(msg);
    world.messages.set(msg.id, msg);
    return msg;
  }
  return Object.assign(world, { staffMessage, botMessage, ser });
}

// ── API ฝั่งเว็บ (เลน B + route ของเลนนี้) ปลอม: การ์ด / สถานะ / bot-posted (รวมแถวแบบ route จริง) / feedback ──
const httpError = (status, data = {}) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
const EMPTY = () => ({ success: true, card: null });

// ★ r3: เรียก handler จริงของ route /api/bot/posted ด้วยคำขอแบบที่ Next ส่ง (url · headers.get ไม่สนตัวพิมพ์ · json())
async function callRoute(handler, url, headers, body) {
  const lower = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const req = {
    url,
    headers: { get: (name) => (lower[String(name).toLowerCase()] === undefined ? null : String(lower[String(name).toLowerCase()])) },
    json: async () => clone(body),
  };
  return handler(req);
}

// postedRoute = { GET, POST } ของ route จริง (loadRoute) → /api/bot/posted ไม่ใช้แผนที่ปลอม แต่วิ่งผ่าน route + store ปลอมของเลน B
//   (แบบ axios: route ตอบ ≥ 400 = โยน error ที่มี response) · routeResponses เก็บ {method, status, body} ทุกครั้ง
function makeApi({ now = () => START, record = () => {}, cards = EMPTY, status = () => ({ success: true, status: 'online' }),
  feedback = () => ({ success: true }), postedGet = null, postedPost = null, postedRoute = null } = {}) {
  const calls = [];
  const posted = new Map();
  const routeResponses = [];
  let cardPolls = 0;
  const viaRoute = async (method, handler, url, headers, body) => {
    const res = await callRoute(handler, url, headers, body);
    routeResponses.push({ method, status: res.status, body: clone(res.body) });
    if (res.status >= 400) throw httpError(res.status, res.body);
    return { data: res.body };
  };
  const respond = (r) => {
    if (r instanceof Error) throw r;
    if (r && typeof r.then === 'function') return r;
    return { data: r };
  };
  const http = {
    async get(url, opts) {
      const entry = { method: 'get', url, headers: clone(opts?.headers), at: now() };
      calls.push(entry);
      record('http', { method: 'get', url, headers: entry.headers });
      if (url.startsWith(`${API}/api/research/cards?`)) {
        const jobId = new URL(url).searchParams.get('jobId');
        return respond(cards(jobId, cardPolls++));
      }
      if (url === `${API}/api/research/status`) return respond(status());
      if (url.startsWith(`${API}/api/bot/posted?`)) {
        const jobId = new URL(url).searchParams.get('jobId');
        if (postedRoute) return viaRoute('get', postedRoute.GET, url, opts?.headers);
        if (postedGet) return respond(postedGet(jobId, posted));
        return { data: { success: true, item: posted.has(jobId) ? clone(posted.get(jobId)) : null } };
      }
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body, opts) {
      const entry = { method: 'post', url, body: clone(body), headers: clone(opts?.headers), at: now() };
      calls.push(entry);
      record('http', { method: 'post', url, body: entry.body, headers: entry.headers });
      if (url === `${API}/api/bot/posted`) {
        if (postedRoute) return viaRoute('post', postedRoute.POST, url, opts?.headers, body);
        if (postedPost) return respond(postedPost(body));
        const prev = posted.get(body.jobId) || { sourceMessageId: null, processingMsgId: null, resultMsgIds: [], caseId: null, researchCardMsgId: null, postedAt: null };
        posted.set(body.jobId, { ...prev, ...clone(body) });
        return { data: { success: true } };
      }
      if (url === `${API}/api/research/feedback`) return respond(feedback(body));
      throw new Error(`unexpected POST ${url}`);
    },
  };
  return {
    http,
    calls,
    posted,
    routeResponses,
    cardPolls: () => cardPolls,
    cardGets: () => calls.filter((c) => c.method === 'get' && c.url.startsWith(`${API}/api/research/cards?`)),
    postedWrites: () => calls.filter((c) => c.method === 'post' && c.url === `${API}/api/bot/posted`),
    feedbackPosts: () => calls.filter((c) => c.method === 'post' && c.url === `${API}/api/research/feedback`),
  };
}

function loadCardModule(src = CARD_SRC) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', src)(realRequire, mod, mod.exports);
  return mod.exports;
}
const RC = loadCardModule();

function makeCtl({ env = {}, api = null, sched = makeScheduler(), enabled = true, mod = RC, shutting = () => false } = {}) {
  const logs = [];
  const logger = {
    log: (...a) => logs.push(a.map(String).join(' ')),
    warn: (...a) => logs.push(a.map(String).join(' ')),
    error: (...a) => logs.push(a.map(String).join(' ')),
  };
  const realApi = api || makeApi({ now: sched.now });
  const ctl = mod.createResearchCards({
    enabled,
    env,
    http: realApi.http,
    EmbedBuilder: FakeEmbed,
    client: { user: { id: BOT_ID } },
    buildApiUrl: (path) => `${API}${path}`,
    buildApiHeaders: () => ({ 'Content-Type': 'application/json', 'x-api-key': 'S3CRET' }),
    buildBotHeaders: () => ({ 'Content-Type': 'application/json', 'x-api-key': 'S3CRET', 'x-bot-secret': 'S3CRET' }),
    isShuttingDown: shutting,
    logger,
    now: sched.now,
    setTimeout: sched.setTimeout,
    clearTimeout: sched.clearTimeout,
  });
  return { ctl, api: realApi, sched, logs };
}

function setupJob(world) {
  const source = world.staffMessage(NEWS_WITH_URL);
  const ack = world.botMessage('รับทราบครับ! กำลังอ่านข้อมูลและปั้นบทความไวรัล รอสักครู่นะครับ ⚡...', source.id);
  return { source, ack };
}

// แถว research-cards (สเปก 2.2) — เนื้อจริงย่อจากผลเอเจนต์ C:\tmp\research-agent-lab\out2\result.json (1 ต.ค. 69)
function cardDone() {
  return {
    id: JOB,
    revision: 1,
    status: 'done',
    mode: 'shadow',
    brain: { kind: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'main', quotaPctAfter: 62 },
    plan: [
      { question: 'ใครเป็นผู้โพสต์ต้นฉบับและเผยแพร่เมื่อใด', why_valuable: 'ตรวจคำอ้างบุคคล สถานที่ และข่าวเก่า', decided: 'ค้น', reason: 'ข่าวดิบไม่มีชื่อผู้เล่าหรือ URL' },
      { question: 'ประวัติส่วนตัว ที่อยู่ และเหตุสูญเสียขาของชายในเรื่อง', why_valuable: 'ไม่จำเป็นต่อการยืนยันการช่วยเหลือ', decided: 'ไม่ค้น', reason: 'เป็นบุคคลทั่วไป ไม่ขุดข้อมูลส่วนตัว' },
    ],
    origin_post: { url: 'ไม่พบ', source_name: 'ไม่พบผู้เล่าหรือโพสต์ต้นฉบับ', date: 'ไม่ทราบ', confidence: 0 },
    story_date_estimate: 'ไม่ทราบ',
    stale_news_warning: 'ยังตรวจไม่ได้ว่าเป็นข่าวเก่าหรือไม่: ไม่พบโพสต์ต้นฉบับหรือวันเกิดเหตุ',
    cards: [
      {
        id: 'R1', claim: 'พบโพสต์เพจที่เล่าเรื่องเดียวกัน แต่เผยแพร่หลังเวลาส่งข่าวดิบ จึงใช้เป็นต้นทางเดิมไม่ได้', value_type: 'ต้นทาง',
        why_it_adds_value: 'แยกโพสต์เผยแพร่ซ้ำออกจากพยานต้นทาง', evidence_quote: 'สาวรายหนึ่งได้เจอเขาทำงานอยู่ตรงนั้น แล้วนำเรื่องนี้มาเล่าต่อ',
        source_url: 'https://www.facebook.com/somepage/posts/pfbid02xtm', source_name: 'เพจข่าวท้องถิ่น / Facebook',
        source_date: '2026-10-01T05:51:22.000Z', confidence: 0.99, contradicts_raw: false, identity: 'generic', gate: 'pass',
      },
      {
        id: 'R2', claim: 'โพสต์เผยแพร่ซ้ำมียอดแชร์ 1 ครั้งและแสดง 2 ความคิดเห็น ณ เวลาตรวจ', value_type: 'ตัวเลข-บริบท',
        why_it_adds_value: 'ตัวเลขตรวจสอบได้', evidence_quote: '2 comments 1 share', source_url: 'https://www.facebook.com/somepage/posts/pfbid02xtm',
        source_name: 'เพจข่าวท้องถิ่น / Facebook', source_date: '2026-10-01', confidence: 0.55, contradicts_raw: false, identity: 'generic',
        gate: 'staff_only', gate_reason: 'confidence<0.6',
      },
      {
        id: 'R3', claim: 'ข้อความที่ด่านคำต้องห้ามตัดทิ้ง', value_type: 'อื่นๆ', evidence_quote: 'x'.repeat(30), source_url: 'https://example.com/x',
        source_name: 'x', source_date: '2026-10-01', confidence: 0.9, contradicts_raw: false, identity: 'generic', gate: 'dropped', gate_reason: 'blacklist',
      },
    ],
    raw_corrections: [],
    flags: ['ORIGIN_NOT_FOUND', 'STALE_NEWS'],
    skipped: ['ไม่ค้นประวัติส่วนตัวหรือสาเหตุการสูญเสียขา'],
    tool_log: [{ tool: 'serper', args: 'ชาวต่างชาติ ขาเทียม ราชบุรี', ok: true, note: '', ms: 900 }],
    usage: { tool_calls: 25, minutes: 4.86, costUsd: 0.01 },
    feedback: [],
    createdAt: '2026-10-01T05:56:00.000Z',
    updatedAt: '2026-10-01T05:56:00.000Z',
  };
}

function cardContradiction() {
  const card = cardDone();
  card.mode = 'assist';
  card.flags = ['RAW_CONTRADICTION'];
  card.origin_post = { url: 'https://news.example.com/a/123', source_name: 'ข่าวตัวอย่าง', date: '2026-09-30', confidence: 0.9 };
  card.raw_corrections = [{ field: 'อายุ', raw_value: '45 ปี', source_value: '54 ปี', source_url: 'https://news.example.com/a/123', confidence: 0.9 }];
  card.cards = [{ ...card.cards[0], id: 'R1', claim: 'ต้นทางระบุว่าชายคนนี้อายุ 54 ปี ไม่ใช่ 45 ปี', contradicts_raw: true, identity: 'verified', confidence: 0.9 }];
  return card;
}

// ── คำตอบจริงของเลน B: GET /api/research/cards → jsonOk({jobId, found, enabled, mode, request, cards, summary}) ──
//   ★ 1 ต.ค. 69 r2 (ผู้ตรวจอิสระ FAIL ข้อ 1): ต้นทาง = worktree เลน B C:\tmp\news-ra-b — src/app/api/research/cards/route.js:48-56
//   (sha256 02fe113a…) + src/lib/research-agent/http.js jsonOk = {success:true, ...body} + cardsSchema.js buildResearchCardsDoc (de28be29…)
//   จับจากการรัน handler GET ตัวจริงของเลน B บน Supabase ปลอมของเลน B (tests/helpers/research-web-fakes.mjs) ด้วยกุญแจทดสอบ
//   ผลเอเจนต์จริง (C:\tmp\research-agent-lab\out\result.json ผ่าน agentResultOut1 ของเลน B) + storage.report โหมด shadow · jobId = JOB
//   คัดลอก body ทุกคีย์ทุกค่า (JSON.stringify ตรงตัว) — ห้ามแก้ให้เข้ากับโค้ดบอท: เลน B เปลี่ยนรูปทรงเมื่อไร ให้จับใหม่แล้วแทนทั้งก้อน
//   pendingQueued/pendingLeased = ยังไม่มีการ์ด (cards:null · บอทถามต่อ) · done = แถว research-cards (object) อยู่ใต้คีย์ "cards"
//   unknown = ไม่มีใบขอของงานนี้ (request:null) · failed = worker รายงานล้ม (แถว status failed) · expired = ใบขอเลย deadline ก่อนมี worker หยิบ
const LANE_B_CARDS = Object.freeze({
  pendingQueued: {"success":true,"jobId":"q_0123456789abcdef","found":false,"enabled":true,"mode":"shadow","request":{"status":"queued","attempt":0,"createdAt":"2026-10-01T03:00:00.000Z","deadlineAt":"2026-10-01T03:07:00.000Z","leasedAt":null,"reportedAt":null,"sourceUrlCount":1},"cards":null,"summary":null},
  pendingLeased: {"success":true,"jobId":"q_0123456789abcdef","found":false,"enabled":true,"mode":"shadow","request":{"status":"leased","attempt":1,"createdAt":"2026-10-01T03:00:00.000Z","deadlineAt":"2026-10-01T03:07:00.000Z","leasedAt":"2026-10-01T03:00:20.000Z","reportedAt":null,"sourceUrlCount":1},"cards":null,"summary":null},
  done: {"success":true,"jobId":"q_0123456789abcdef","found":true,"enabled":true,"mode":"shadow","request":{"status":"done","attempt":1,"createdAt":"2026-10-01T03:00:00.000Z","deadlineAt":"2026-10-01T03:07:00.000Z","leasedAt":"2026-10-01T03:00:20.000Z","reportedAt":"2026-10-01T03:02:40.000Z","sourceUrlCount":1},"cards":{"id":"q_0123456789abcdef","revision":1,"status":"done","mode":"shadow","brain":{"kind":"codex","model":"gpt-6-astra","effort":"low","account":"main","quotaPctAfter":72},"plan":[{"question":"ต้นทางของเรื่องชายชาวสวีเดนสวมขาเทียมคือโพสต์ใด และเผยแพร่เมื่อใด","why_valuable":"ยืนยันเรื่องหลักและป้องกันนำข่าวเก่ามาเล่าเป็นข่าวปัจจุบัน","decided":"ค้น","reason":"ข่าวดิบไม่มีลิงก์ ชื่อผู้โพสต์ หรือวันเกิดเหตุ"},{"question":"มีหลักฐานรองรับสัญชาติ การสวมขาเทียม และคำพูดท้ายข่าวหรือไม่","why_valuable":"ป้องกันระบุสัญชาติและอ้างคำพูดผิดคน","decided":"ค้น","reason":"เป็นองค์ประกอบสำคัญของข่าว แต่ยังไม่มีแหล่งอ้างอิง"},{"question":"ชายคนนี้มีประวัติส่วนตัวหรือสาเหตุการสูญเสียขาอย่างไร","why_valuable":"ไม่ได้ช่วยยืนยันเหตุการณ์ที่รายงาน","decided":"ไม่ค้น","reason":"เป็นข้อมูลส่วนตัวของคนธรรมดาและไม่จำเป็นต่อข่าว"}],"origin_post":{"url":null,"source_name":"ไม่พบต้นทางที่ตรงกับเรื่องชายชาวสวีเดน","date":"ไม่ทราบ","confidence":0},"story_date_estimate":"ไม่ทราบ","stale_news_warning":"ยังตรวจไม่ได้ว่าเป็นข่าวเก่าเล่าใหม่หรือไม่: ไม่พบต้นทางเรื่องชายชาวสวีเดนและวันที่เผยแพร่","cards":[{"id":"R1","claim":"เพจตาเป้มีโพสต์ขอแรงช่วยกรอกกระสอบทรายกั้นน้ำที่เขื่อนเทศบาลเมืองราชบุรี แต่ข้อความที่ดึงได้ยังไม่เชื่อมโยงกับชายชาวสวีเดนในข่าวดิบ","value_type":"อื่นๆ","why_it_adds_value":"เป็นหลักฐานบริบทในพื้นที่เท่านั้น ไม่ใช้ยืนยันสัญชาติ ขาเทียม วันเกิดเหตุ หรือคำพูดของชายในข่าว","evidence_quote":"ขอแรงช่วยกรอกกระสอบทราย กั้นน้ำที่เขื่อนเทศบาลเมืองราชบุรี เวลานี้ครับ","source_url":"https://www.facebook.com/tapeanews/posts/1649392430310047/","source_name":"ตาเป้ (Facebook)","source_date":"ไม่ทราบวันเผยแพร่แน่นอน","confidence":0.95,"contradicts_raw":false,"identity":"generic","gate":"pass"}],"raw_corrections":[],"flags":["ORIGIN_NOT_FOUND"],"skipped":["ไม่ค้นชื่อจริง ที่อยู่ ครอบครัว หรือประวัติสุขภาพของชายในข่าว เพราะไม่จำเป็นต่อการตรวจเหตุการณ์"],"usage":{"tool_calls":12,"minutes":2.75,"costUsd":0.004},"feedback":[],"createdAt":"2026-10-01T03:02:40.000Z","updatedAt":"2026-10-01T03:02:40.000Z","toolLogCount":2},"summary":{"status":"done","cardsCount":1,"passCount":1,"staffOnlyCount":0,"droppedCount":0,"flags":["ORIGIN_NOT_FOUND"]}},
  unknown: {"success":true,"jobId":"q_0123456789abcdef","found":false,"enabled":true,"mode":"shadow","request":null,"cards":null,"summary":null},
  failed: {"success":true,"jobId":"q_0123456789abcdef","found":true,"enabled":true,"mode":"shadow","request":{"status":"failed","attempt":1,"createdAt":"2026-10-01T03:00:00.000Z","deadlineAt":"2026-10-01T03:07:00.000Z","leasedAt":"2026-10-01T03:00:20.000Z","reportedAt":"2026-10-01T03:02:40.000Z","sourceUrlCount":1},"cards":{"id":"q_0123456789abcdef","revision":1,"status":"failed","mode":"shadow","brain":null,"plan":[],"origin_post":null,"story_date_estimate":null,"stale_news_warning":null,"cards":[],"raw_corrections":[],"flags":[],"skipped":["codex ล้ม"],"usage":{"tool_calls":0,"minutes":0,"costUsd":0},"feedback":[],"createdAt":"2026-10-01T03:02:40.000Z","updatedAt":"2026-10-01T03:02:40.000Z","toolLogCount":0},"summary":{"status":"failed","cardsCount":0,"passCount":0,"staffOnlyCount":0,"droppedCount":0,"flags":[]}},
  expired: {"success":true,"jobId":"q_0123456789abcdef","found":false,"enabled":true,"mode":"shadow","request":{"status":"expired","attempt":0,"createdAt":"2026-10-01T03:00:00.000Z","deadlineAt":"2026-10-01T03:07:00.000Z","leasedAt":null,"reportedAt":null,"sourceUrlCount":1},"cards":null,"summary":null},
  // ★ r3 (mismatch #8): เว็บปิดสวิตช์ — จับจากการรัน handler GET ตัวจริงของเลน B (route.js sha256 02fe113a… · modes.js d5520dc2…)
  //   โดยไม่ตั้ง RESEARCH_AGENT ใดๆ + DISCORD_API_SECRET ทดสอบ บน Supabase ปลอมของเลน B (สคริปต์จับอยู่ใน scratchpad ไม่ใช่ไฟล์โปรเจกต์)
  disabled: {"success":true,"jobId":"q_0123456789abcdef","found":false,"enabled":false,"mode":"shadow","request":null,"cards":null,"summary":null},
});
const laneB = (name) => clone(LANE_B_CARDS[name]);
// ★ r3: เจ้าของปิดสวิตช์เว็บหลังการ์ดถูกเขียนแล้ว — handler เดียวกันตอบ enabled:false พร้อมแถวการ์ด (สร้างจาก done ไม่ได้จับจากการรัน)
const laneBDoneButDisabled = () => ({ ...laneB('done'), enabled: false });

const RESULT_TEXT = '✅ **สร้างข่าวสำเร็จ!** 2 เวอร์ชัน | ใช้เวลา 25.0s\n📰 **ลุงสามล้อ**\n🔗 ดูผลลัพธ์เต็ม: http://api.test/generation-logs/05268';
async function postResultLikeBot(world, source, ack) {
  await ack.edit({ content: RESULT_TEXT });
  const other = world.staffMessage('ข้อความคนอื่นในห้องเดียวกัน');
  const v1 = await source.reply({ embeds: [embedOf('[A1] ลุงสามล้อ')] });
  await other.reply('บอทตอบงานอื่นแทรกกลาง');
  const v2 = await source.reply({ embeds: [embedOf('[A2] ลุงสามล้อ')] });
  const sum = await source.reply({ embeds: [embedOf('📄 เขียนจากเนื้อต้นฉบับอย่างเดียว')] });
  return [v1.id, v2.id, sum.id];
}

const cardReplies = (msg) => msg.replies.filter((p) => p && typeof p === 'object' && (p.embeds || []).some((e) => String(e.data?.title || '').includes('🧾 บัตรข้อเท็จจริง')));
const cardMessageOf = (world, sourceId) => [...world.messages.values()].find((m) => m.reference?.messageId === sourceId && m.embeds.some((e) => String(e.title || '').includes('🧾')));

// ============================================================
// 1) ส่วนบริสุทธิ์ของโมดูล
// ============================================================
test('node --check: discord-bot/index.js + discord-bot/researchCard.js ผ่าน', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(botUrl)], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', fileURLToPath(cardUrl)], { stdio: 'pipe' });
});

test('splitSourceUrls: แยกลิงก์ http(s) · ตัดเครื่องหมายท้าย · วงเล็บคู่ในลิงก์ · <ลิงก์> · [ข้อความ](ลิงก์) · ไม่ซ้ำ · ≤ 10 · ลิงก์ปลอมคงไว้', () => {
  const r = RC.splitSourceUrls('ข่าวชาวสวีเดนช่วยกรอกกระสอบทราย ราชบุรี https://www.facebook.com/tapeanews/posts/1649392430310047/ ดูต่อ (https://en.wikipedia.org/wiki/Foo_(bar)). และ <https://x.com/a?b=1>, [คลิป](https://y.com/z) ซ้ำ https://x.com/a?b=1');
  assert.deepEqual(r.sourceUrls, [
    'https://www.facebook.com/tapeanews/posts/1649392430310047/',
    'https://en.wikipedia.org/wiki/Foo_(bar)',
    'https://x.com/a?b=1',
    'https://y.com/z',
  ]);
  assert.equal(r.text, 'ข่าวชาวสวีเดนช่วยกรอกกระสอบทราย ราชบุรี ดูต่อ. และ, คลิป ซ้ำ');
  assert.equal(RC.splitSourceUrls('บรรทัดแรก https://a.com/x\nบรรทัดสอง').text, 'บรรทัดแรก\nบรรทัดสอง', 'ขึ้นบรรทัดเดิมต้องคงไว้');
  assert.deepEqual(RC.splitSourceUrls('ไม่มีลิงก์เลย'), { sourceUrls: [], text: 'ไม่มีลิงก์เลย' });
  assert.deepEqual(RC.splitSourceUrls('https:// เปล่า ftp://a.com/x').sourceUrls, [], 'ลิงก์เปล่า/ไม่ใช่ http(s) ไม่นับ');
  assert.equal(RC.splitSourceUrls('https:// เปล่า').text, 'https:// เปล่า', 'ลิงก์ใช้ไม่ได้คงไว้ในเนื้อ');
  const many = Array.from({ length: 12 }, (_, i) => `https://s${i}.com/p`).join(' ');
  const r12 = RC.splitSourceUrls(`ข่าว ${many}`);
  assert.equal(r12.sourceUrls.length, 10);
  assert.equal(r12.text, 'ข่าว');
  assert.deepEqual(RC.splitSourceUrls(undefined), { sourceUrls: [], text: '' });
});

test('applySourceUrls: ปิด = payload เดิมทุกไบต์ (ไม่มีคีย์ sourceUrls) · เปิด = sourceUrls + input ตัดลิงก์ · เหลือ < 20 ตัวอักษร = url mode เดิม', () => {
  const base = (input = NEWS_WITH_URL) => ({ input, images: [], contentLength: 'short', userId: 'discord-U1', _botInstance: 'h_x', _msgId: 'M1' });
  const off = makeCtl({ enabled: false }).ctl;
  const p0 = base();
  assert.equal(off.applySourceUrls(p0, NEWS_WITH_URL), p0);
  assert.deepEqual(p0, base());
  assert.deepEqual(Object.keys(p0), Object.keys(base()));

  const on = makeCtl().ctl;
  const p1 = on.applySourceUrls(base(), NEWS_WITH_URL);
  assert.equal(p1.input, NEWS_TEXT);
  assert.deepEqual(p1.sourceUrls, [SRC_URL]);
  assert.deepEqual(Object.keys(p1), [...Object.keys(base()), 'sourceUrls'], 'คีย์อื่นไม่แตะ แค่เติม sourceUrls ท้าย');
  assert.deepEqual({ ...p1, input: null, sourceUrls: null }, { ...base(), input: null, sourceUrls: null });

  const t20 = 'ก'.repeat(20);
  const p20 = on.applySourceUrls(base(`${t20} https://a.com/x`), `${t20} https://a.com/x`);
  assert.equal(p20.input, t20, 'เหลือ 20 ตัวอักษรพอดี = ส่งเป็นข้อความ');
  const t19 = 'ก'.repeat(19);
  const p19 = on.applySourceUrls(base(`${t19} https://a.com/x`), `${t19} https://a.com/x`);
  assert.equal(p19.input, `${t19} https://a.com/x`, 'เหลือ < 20 = url mode เดิม (input เดิม)');
  assert.deepEqual(p19.sourceUrls, ['https://a.com/x']);

  const plain = 'ข่าวยาวพอสมควรที่ไม่มีลิงก์ประกอบเลยแม้แต่ลิงก์เดียว';
  const p3 = on.applySourceUrls(base(plain), plain);
  assert.equal(p3.input, plain);
  assert.deepEqual(p3.sourceUrls, []);
  assert.equal(on.applySourceUrls(null, NEWS_WITH_URL), null, 'ข้อมูลแปลกต้องไม่โยน');
});

function checkShadowCardView(v) {
  assert.equal(v.title, '🧪 ทดลอง · 🧾 บัตรข้อเท็จจริง');
  assert.equal(v.color, '#f59e0b');
  const lines = v.description.split('\n');
  assert.equal(lines[0], '_ทดลอง: ข่าวยังไม่ใช้บัตรนี้ — ช่วยกด 👍/👎 ว่าบัตรมีประโยชน์ไหม_');
  const planIdx = lines.indexOf('**แผนเอเจนต์**');
  assert.ok(planIdx > 0, 'ต้องมีหัวข้อแผนเอเจนต์');
  assert.equal(lines[planIdx + 1], '🔎 ใครเป็นผู้โพสต์ต้นฉบับและเผยแพร่เมื่อใด');
  assert.equal(lines[planIdx + 2], '⏭️ ประวัติส่วนตัว ที่อยู่ และเหตุสูญเสียขาของชายในเรื่อง — เป็นบุคคลทั่วไป ไม่ขุดข้อมูลส่วนตัว');
  assert.equal(lines.length, planIdx + 3, 'แผน 1 บรรทัด/ข้อ — ไม่มีบรรทัดเกิน');
  assert.equal(v.fields.length, 2, 'การ์ด gate=dropped ห้ามแสดง');
  assert.deepEqual(v.fields[0], {
    name: 'R1 · ความมั่นใจ 99%',
    value: 'พบโพสต์เพจที่เล่าเรื่องเดียวกัน แต่เผยแพร่หลังเวลาส่งข่าวดิบ จึงใช้เป็นต้นทางเดิมไม่ได้\n📎 [เพจข่าวท้องถิ่น / Facebook](https://www.facebook.com/somepage/posts/pfbid02xtm) · 2026-10-01T05:51:22.000Z',
  });
  assert.equal(v.fields[1].name, 'R2 · ความมั่นใจ 55% · 👀 เฉพาะพนักงาน');
  assert.equal(v.footer, `jobId: ${JOB} · gpt-6-astra low · 25 ครั้ง · 4.9 นาที · กด 👍/👎 ให้คะแนนบัตรนี้`);
  assert.equal(v.reactable, true);
}

test('บัตร (shadow): หัว 🧪 ทดลอง · แผน 1 บรรทัด/ข้อ (🔎 ค้น · ⏭️ ไม่ค้น+เหตุผล) · การ์ด claim/แหล่งลิงก์/วันที่/ความมั่นใจ · dropped ไม่แสดง · staff_only ติดป้าย · ท้ายบัตรมี jobId', () => {
  checkShadowCardView(RC.buildCardView(cardDone(), JOB));
  const live = RC.buildCardView({ ...cardDone(), mode: 'assist' }, JOB);
  assert.equal(live.title, '🧾 บัตรข้อเท็จจริง', 'โหมด assist = บัตรจริง ไม่มีป้ายทดลอง');
  assert.ok(!live.description.includes('ทดลอง'));
  assert.equal(live.color, '#3b82f6');
  assert.equal(RC.buildCardView({ ...cardDone(), mode: undefined }, JOB).title, '🧪 ทดลอง · 🧾 บัตรข้อเท็จจริง', 'ไม่ระบุโหมด = ถือเป็นทดลอง');
  const { embed, view } = RC.buildCardEmbed(FakeEmbed, cardDone(), JOB);
  assert.equal(embed.data.title, view.title);
  assert.deepEqual(embed.data.fields, view.fields);
  assert.deepEqual(embed.data.footer, { text: view.footer });
});

test('ธงพนักงาน: 🔍 ยืนยันต้นทางไม่ได้ · ⚠️ ข่าวเก่า · 🧭 ต้นทาง: ลิงก์ · ❗ ขัดต้นฉบับ raw → source พร้อมลิงก์ · การ์ดขัดต้นฉบับติด ❗ · สีแดง', () => {
  const v1 = RC.buildCardView(cardDone(), JOB);
  assert.ok(v1.description.includes('\n🔍 ยืนยันต้นทางไม่ได้ — ข่าวทำตามปกติ\n'));
  assert.ok(v1.description.includes('\n⚠️ ข่าวเก่า: ยังตรวจไม่ได้ว่าเป็นข่าวเก่าหรือไม่: ไม่พบโพสต์ต้นฉบับหรือวันเกิดเหตุ\n'));
  assert.ok(!v1.description.includes('🧭'), 'ไม่พบต้นทาง (url "ไม่พบ") ห้ามขึ้น 🧭');
  const v2 = RC.buildCardView(cardContradiction(), JOB);
  assert.ok(v2.description.includes('🧭 ต้นทาง: [ข่าวตัวอย่าง](https://news.example.com/a/123) · 2026-09-30 · มั่นใจ 90%'));
  assert.ok(v2.description.includes('❗ ขัดต้นฉบับ: อายุ: "45 ปี" → "54 ปี" ([news.example.com](https://news.example.com/a/123))'));
  assert.equal(v2.fields[0].name, 'R1 · ความมั่นใจ 90% · ❗ ขัดต้นฉบับ · 🪪 ยืนยันตัวตน');
  assert.equal(v2.color, '#ef4444');
  const noList = RC.buildCardView({ ...cardDone(), flags: ['RAW_CONTRADICTION'] }, JOB);
  assert.ok(noList.description.includes('❗ ขัดต้นฉบับ — ดูการ์ดที่ติด ❗ ด้านล่าง'));
  const v3 = RC.buildCardView({ ...cardDone(), flags: ['BROWSER_WRONG_ACCOUNT', 'QUOTA_LOW', 'NEW_FLAG_X', 'bad flag!'] }, JOB);
  assert.ok(v3.description.includes('🛑 เบราว์เซอร์ล็อกอินบัญชีอื่น — เอเจนต์หยุดใช้เบราว์เซอร์แล้ว (เจ้าของตรวจเครื่อง)'));
  assert.ok(v3.description.includes('🔋 โควตาเอเจนต์ใกล้หมด'));
  assert.ok(v3.description.includes('🏷️ NEW\\_FLAG\\_X'));
  assert.ok(!v3.description.includes('bad flag'), 'ธงรูปแปลกไม่แสดง');
  assert.ok(!v3.description.includes('🔍'), 'ไม่มีธง ORIGIN_NOT_FOUND = ไม่ขึ้น 🔍');
});

// ★ r3 (mismatch #9): raw_corrections ตามสัญญา 2.2 = {field, raw_value, source_value, source_url, confidence} ไม่มี source_name
//   → ป้ายลิงก์ = ชื่อโดเมนของ source_url เสมอ · มีช่องชื่อแหล่งนอกสัญญาติดมา (ยังไม่ผ่านด่าน) ก็ห้ามขึ้นบัตร · ลิงก์ใช้ไม่ได้ = ไม่มีวงเล็บลิงก์
function checkCorrectionDomain(mod = RC) {
  const card = cardContradiction();
  card.raw_corrections = [
    { field: 'อายุ', raw_value: '45 ปี', source_value: '54 ปี', source_url: 'https://www.news.example.com/a/123', confidence: 0.9, source_name: 'ชื่อแหล่งนอกสัญญา' },
    { field: 'จังหวัด', raw_value: 'ราชบุรี', source_value: 'กาญจนบุรี', source_url: 'ไม่พบ', confidence: 0.7 },
  ];
  const view = mod.buildCardView(card, JOB);
  assert.deepEqual(view.description.split('\n').filter((l) => l.startsWith('❗ ขัดต้นฉบับ:')), [
    '❗ ขัดต้นฉบับ: อายุ: "45 ปี" → "54 ปี" ([news.example.com](https://www.news.example.com/a/123))',
    '❗ ขัดต้นฉบับ: จังหวัด: "ราชบุรี" → "กาญจนบุรี"',
  ], 'ป้ายลิงก์ของ raw_corrections ต้องเป็นชื่อโดเมน (ตัด www.) ไม่ใช่ชื่อแหล่งนอกสัญญา');
  assert.ok(!view.description.includes('ชื่อแหล่งนอกสัญญา'), 'ช่องนอกสัญญาห้ามขึ้นบัตร');
}

test('raw_corrections (r3 · mismatch #9): ป้ายลิงก์ = ชื่อโดเมนของ source_url โดยตั้งใจ — ช่อง source_name นอกสัญญาไม่อ่าน · ลิงก์ใช้ไม่ได้ = ไม่มีลิงก์', () => {
  checkCorrectionDomain();
});

function checkCardIsData(v) {
  const all = [v.description, ...v.fields.map((f) => f.value), ...v.fields.map((f) => f.name)].join('\n');
  assert.ok(!/(^|[^\\])\[คลิกเลย\]\(https:\/\/evil/u.test(all), 'masked link จากเว็บต้องถูก escape');
  assert.ok(all.includes('\\[คลิกเลย\\](https://evil.example/phish)'));
  assert.ok(all.includes('\\*\\*ด่วน\\*\\*'));
  assert.ok(all.includes('\\<@123456789012345678\\>'));
  assert.ok(all.includes('\\|\\|สปอยล์\\|\\|'));
  assert.ok(!all.includes('javascript:'), 'ลิงก์ที่ไม่ใช่ http(s) ห้ามโผล่');
  assert.ok(v.fields[0].value.endsWith('📎 แหล่ง\\](https://evil.example) · 2026-10-01'), 'ชื่อแหล่งที่พยายามปิดวงเล็บต้องถูก escape และไม่มีลิงก์');
  assert.ok(all.includes('🔎 \\[x\\](https://evil.example)'));
}

function evilCard() {
  const card = cardDone();
  card.cards = [{ id: 'R1', claim: 'ดู [คลิกเลย](https://evil.example/phish) **ด่วน** <@123456789012345678> ||สปอยล์||', source_url: 'javascript:alert(1)', source_name: 'แหล่ง](https://evil.example)', source_date: '2026-10-01', confidence: 0.9, gate: 'pass' }];
  card.plan = [{ question: '[x](https://evil.example)', decided: 'ค้น' }];
  return card;
}

test('เนื้อการ์ด = DATA: กัน masked link/ตัวหนา/สปอยล์/mention · ลิงก์ javascript: ไม่ทำลิงก์ · ข้อมูลยาวผิดปกติยังอยู่ในเพดาน embed ของ Discord', () => {
  checkCardIsData(RC.buildCardView(evilCard(), JOB));
  const huge = cardDone();
  huge.flags = ['STALE_NEWS', 'ORIGIN_NOT_FOUND'];
  huge.plan = Array.from({ length: 40 }, (_, i) => ({ question: `คำถามข้อ ${i} ${'ก'.repeat(300)}`, decided: i % 2 ? 'ไม่ค้น' : 'ค้น', reason: 'ข'.repeat(300) }));
  huge.cards = Array.from({ length: 8 }, (_, i) => ({
    id: `R${i + 1}`, claim: `${'ค'.repeat(4990)}*_~|`, source_url: `https://example.com/${'p'.repeat(1500)}`,
    source_name: 'ง'.repeat(500), source_date: 'จ'.repeat(500), confidence: 0.8, gate: 'pass',
  }));
  huge.stale_news_warning = 'ฉ'.repeat(5000);
  const hv = RC.buildCardView(huge, JOB);
  assert.ok(hv.title.length <= 256);
  assert.ok(hv.description.length >= 1 && hv.description.length <= 4096);
  assert.ok(hv.footer.length >= 1 && hv.footer.length <= 2048);
  assert.ok(hv.footer.startsWith(`jobId: ${JOB}`), 'ท้ายบัตรต้องมี jobId เสมอ (ใช้ตอนกด 👍👎 หลังรีสตาร์ต)');
  assert.ok(hv.fields.length >= 1 && hv.fields.length <= 25);
  for (const f of hv.fields) {
    assert.ok(f.name.length >= 1 && f.name.length <= 256);
    assert.ok(f.value.length >= 1 && f.value.length <= 1024, `field ยาว ${f.value.length}`);
    assert.ok(!/\]\(https:\/\/example\.com\/p{600}/u.test(f.value), 'ลิงก์ยาวเกินห้ามทำเป็น markdown link');
  }
  const total = hv.title.length + hv.description.length + hv.footer.length + hv.fields.reduce((s, f) => s + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, `รวมทั้งก้อน ${total} ต้องไม่เกิน 6000 (เพดาน Discord)`);
  assert.ok(hv.description.includes('… (+'), 'แผนยาวเกินงบต้องบอกจำนวนบรรทัดที่ตัด');
});

test('อ่านคำตอบเลน B แบบทนรูปทรง: pickCardRecord (card/item/data/items/กางทั้งก้อน · หลาย revision = ล่าสุด) · parseStatus (offline/quota/account)', () => {
  const rec = cardDone();
  for (const body of [{ success: true, card: rec }, { success: true, item: rec }, { success: true, data: rec },
    { success: true, items: [{ ...rec, revision: 1 }] }, { success: true, ...rec }]) {
    assert.equal(RC.pickCardRecord(body)?.status, 'done', JSON.stringify(Object.keys(body)));
  }
  assert.equal(RC.pickCardRecord({ success: true, items: [{ ...rec, revision: 1, mode: 'shadow' }, { ...rec, revision: 3, mode: 'assist' }] }).mode, 'assist');
  for (const body of [null, {}, 'x', { success: false, card: rec }, { success: true, card: null }, { success: true, status: 'queued' }]) {
    assert.equal(RC.pickCardRecord(body), null, JSON.stringify(body));
  }
  assert.deepEqual(RC.parseStatus({ success: true, status: 'offline' }), { offline: true, quotaPct: null, quotaLow: false, account: null });
  assert.deepEqual(RC.parseStatus({ success: true, status: 'online', quota: { pct: 12.4, account: 'b' } }), { offline: false, quotaPct: 12.4, quotaLow: false, account: 'b' });
  assert.equal(RC.parseStatus({ success: true, worker: { status: 'offline', quotaPct: 40 } }).offline, true);
  assert.equal(RC.parseStatus({ success: true, worker: { status: 'offline', quotaPct: 40 } }).quotaPct, 40);
  assert.equal(RC.parseStatus({ success: true, flags: ['QUOTA_LOW'] }).quotaLow, true);
  assert.equal(RC.parseStatus({ success: false }), null);
  assert.equal(RC.parseStatus(null), null);
});

// ★ r2 (ผู้ตรวจอิสระ FAIL ข้อ 1): คำตอบจริงของเลน B — แถวการ์ดอยู่ใต้คีย์ "cards" (object) · เดิม pickCardRecord ไม่อ่านคีย์นี้
//   = fetchCard ได้ 'wait' ทุกรอบ บอทถามทุก 20 วิจนหมดหาง 10 นาทีโดยไม่โพสต์บัตรเลย · ต้องแดงถ้าถอด 'cards' ออกจากรายชื่อคีย์ (M13)
function checkLaneBContract(mod = RC) {
  const done = laneB('done');
  const rec = mod.pickCardRecord(done);
  assert.ok(rec, 'คำตอบจริงของเลน B ต้องอ่านแถวการ์ดออก (อ่านไม่ออก = บัตรไม่เคยขึ้นหลังรวมเลน)');
  assert.equal(rec, done.cards, 'แถวที่ได้ = ก้อนใต้คีย์ cards ตรงตัว (ไม่ใช่ request/summary ที่มี status เหมือนกัน)');
  assert.deepEqual([rec.status, rec.mode, rec.cards.map((c) => c.id)], ['done', 'shadow', ['R1']]);
  assert.equal(mod.pickCardRecord(laneB('failed'))?.status, 'failed', 'worker รายงานล้ม = แถว failed ใต้คีย์ cards');
  for (const name of ['pendingQueued', 'pendingLeased', 'unknown', 'expired']) {
    assert.equal(mod.pickCardRecord(laneB(name)), null, `${name}: cards:null = ยังไม่มีบัตร ห้ามเดาจาก request/summary`);
  }
  // หน้าตาบัตรจากแถวจริงของเลน B (ค่าคาดหวังดึงจากฟิกซ์เจอร์ — ข้อความไม่มีอักขระ markdown จึงไม่ถูก escape)
  const view = mod.buildCardView(rec, JOB);
  const plan = rec.plan;
  const card = rec.cards[0];
  assert.deepEqual(plan.map((p) => p.decided), ['ค้น', 'ค้น', 'ไม่ค้น']);
  assert.equal(view.title, '🧪 ทดลอง · 🧾 บัตรข้อเท็จจริง');
  assert.deepEqual(view.description.split('\n'), [
    mod.constants.SHADOW_LEAD,
    '🔍 ยืนยันต้นทางไม่ได้ — ข่าวทำตามปกติ',
    '',
    '**แผนเอเจนต์**',
    `🔎 ${plan[0].question}`,
    `🔎 ${plan[1].question}`,
    `⏭️ ${plan[2].question} — ${plan[2].reason}`,
  ]);
  assert.deepEqual(view.fields, [{
    name: 'R1 · ความมั่นใจ 95%',
    value: `${card.claim}\n📎 [${card.source_name}](${card.source_url}) · ${card.source_date}`,
  }]);
  assert.equal(view.footer, `jobId: ${JOB} · gpt-6-astra low · 12 ครั้ง · 2.8 นาที · กด 👍/👎 ให้คะแนนบัตรนี้`);
  assert.equal(view.reactable, true);
  assert.equal(view.color, '#f59e0b');
}

test('สัญญาเลน B ตัวจริง (r2): คำตอบที่ handler เลน B ส่งจริง — แถวใต้คีย์ "cards" อ่านออก · ยังไม่มีการ์ด/ไม่มีใบขอ/หมดอายุ = null · บัตรแสดงแผน/การ์ด/ธงครบ', () => {
  checkLaneBContract();
});

// ============================================================
// 2) ตัวควบคุม (นาฬิกาเสมือน · HTTP/Discord ปลอม)
// ============================================================
test('สวิตช์ปิด: ทุกเมธอด no-op — ไม่ตั้ง timer ไม่ยิง HTTP ไม่โพสต์ ไม่ log · handleReaction = off', async () => {
  const world = makeWorld();
  const { ctl, api, sched, logs } = makeCtl({ enabled: false });
  const { source, ack } = setupJob(world);
  assert.equal(ctl.enabled, false);
  assert.equal(ctl.watch({ jobId: JOB, message: source, processingMsg: ack }), null);
  assert.equal(ctl.jobEnded(JOB, {}), null);
  assert.deepEqual(await ctl.handleReaction({ emoji: { name: '👍' }, message: ack }, { id: STAFF_ID }), { ok: false, skipped: 'off' });
  assert.equal(sched.delays.length, 0);
  assert.equal(api.calls.length, 0);
  assert.deepEqual(logs, []);
  assert.equal(source.replies.length, 0);
});

async function scenarioCardDuringWait({ mod = RC } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: (jobId, n) => (n >= 2 ? { success: true, card: cardDone() } : EMPTY()) });
  const { ctl } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  for (let i = 0; i < 3; i++) await settleWithin(sched.step(), `รอบถามที่ ${i + 1}`);
  const afterThree = { now: sched.now(), cardGets: api.cardGets().map((c) => ({ url: c.url, at: c.at, key: c.headers['x-api-key'] })) };
  await settleWithin(ctl.jobEnded(JOB, {}), 'jobEnded');
  const reason = await settleWithin(done, 'การตามบัตรจบ');
  return { world, api, sched, source, ack, afterThree, reason };
}

function checkCardDuringWait(r) {
  assert.deepEqual(r.afterThree.cardGets, [0, 1, 2].map((i) => ({ url: `${API}/api/research/cards?jobId=${JOB}`, at: START + (i + 1) * 20 * SEC, key: 'S3CRET' })), 'ถามทุก 20 วิด้วยกุญแจเดิมของบอท');
  const replies = cardReplies(r.source);
  assert.equal(replies.length, 1, 'บัตรต้อง reply ใต้ข้อความพนักงาน 1 ครั้ง');
  assert.deepEqual(replies[0].allowedMentions, { parse: [], repliedUser: false }, 'บัตรห้าม mention ใคร');
  checkShadowCardView({ ...replies[0].embeds[0].data, footer: replies[0].embeds[0].data.footer.text, reactable: true });
  const cardMsg = cardMessageOf(r.world, r.source.id);
  assert.deepEqual(cardMsg.reactions, ['👍', '👎']);
  const writes = r.api.postedWrites();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { jobId: JOB, channelId: 'CH1', sourceMessageId: r.source.id, processingMsgId: r.ack.id, researchCardMsgId: cardMsg.id });
  assert.equal(writes[0].headers['x-bot-secret'], 'S3CRET');
  const check = r.api.calls.findIndex((c) => c.method === 'get' && c.url === `${API}/api/bot/posted?jobId=${JOB}`);
  assert.ok(check >= 0 && check < r.api.calls.indexOf(writes[0]), 'ก่อนโพสต์ต้องเช็ค bot-posted ว่ามีใครโพสต์แล้วหรือยัง');
  assert.equal(r.reason, 'card');
  assert.equal(r.api.cardGets().length, 3, 'บัตรขึ้นแล้วห้ามถามซ้ำ (จอดรอจบงานแทน)');
  assert.equal(r.sched.pending(), 0, 'จบแล้วต้องไม่ทิ้ง timer');
}

test('ระหว่างรองาน: ถามการ์ดทุก 20 วิ → การ์ดมา → reply บัตรใต้ข้อความพนักงาน (ไม่ mention) + 👍👎 + จด bot-posted · หยุดถาม · งานจบแล้วเลิกตาม', async () => {
  checkCardDuringWait(await scenarioCardDuringWait());
});

async function scenarioTail({ mod = RC } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now });
  const { ctl } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'รอบแรก');
  sched.advance(5 * SEC);
  const resultIds = await postResultLikeBot(world, source, ack);
  const endedAt = sched.now();
  await settleWithin(ctl.jobEnded(JOB, { handedOff: false, shuttingDown: false }), 'jobEnded');
  await drain(sched, 'หางหลังจบงาน');
  const reason = await settleWithin(done, 'การตามบัตรจบ');
  return { world, api, sched, source, ack, resultIds, endedAt, reason };
}

function checkTail(r) {
  const writes = r.api.postedWrites();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, {
    jobId: JOB, channelId: 'CH1', sourceMessageId: r.source.id, processingMsgId: r.ack.id,
    resultMsgIds: r.resultIds, postedAt: new Date(r.endedAt).toISOString(), caseId: '05268',
  }, 'resultMsgIds = เฉพาะ reply ของบอทใต้ข้อความนี้ เรียงตามเวลา · caseId จากลิงก์ ✅');
  const gets = r.api.cardGets();
  const tail = gets.filter((c) => c.at >= r.endedAt);
  assert.equal(tail[0].at, r.endedAt, 'งานจบต้องถามทันที 1 ครั้ง');
  assert.ok(tail.every((c) => c.at <= r.endedAt + 15 * MIN), 'ถามต่อได้ไม่เกิน 15 นาทีหลังจบงาน');
  assert.ok(tail.at(-1).at - r.endedAt > 10 * MIN, `หาง 15 นาที (r3): รอบสุดท้ายต้องเลย 10 นาทีหลังจบงาน (ได้ ${(tail.at(-1).at - r.endedAt) / SEC} วิ)`);
  assert.equal(gets.length, 47, 'รอบแรก 1 + ถามทันที 1 + ทุก 20 วิอีก 45 รอบ (40s…920s)');
  assert.equal(r.reason, 'tail_done');
  assert.equal(r.source.replies.length, 3, 'ไม่มีการ์ด + เครื่องค้นคว้าออนไลน์ = ไม่โพสต์อะไรเพิ่ม');
  assert.equal(r.sched.pending(), 0);
}

// ★ r3 (mismatch #7): บอทไม่ส่ง x-research-secret ไม่ว่ากรณีใด — เป็นความลับของ worker (เลน B ตรวจบอทด้วย x-bot-secret/x-api-key = DISCORD_API_SECRET)
//   Railway ตั้ง RESEARCH_AGENT_SECRET ไว้ = เตือนใน log ตอนเปิดให้ลบ 1 ครั้ง (ไม่พิมพ์ค่า) · ไม่ตั้ง = ไม่เตือน
async function scenarioHeaders({ mod = RC } = {}) {
  const runs = [];
  for (const env of [{}, { RESEARCH_AGENT_SECRET: ' R5ECRET\n' }]) {
    const world = makeWorld();
    const sched = makeScheduler();
    const api = makeApi({ now: sched.now, cards: () => ({ success: true, card: cardDone() }) });
    const { ctl, logs } = makeCtl({ api, sched, env, mod });
    const { source, ack } = setupJob(world);
    ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
    await settleWithin(sched.step(), 'รอบแรก');
    await settleWithin(ctl.handleReaction({ emoji: { name: '👍' }, message: cardMessageOf(world, source.id) }, { id: STAFF_ID, bot: false }), 'กด 👍');
    runs.push({ env, calls: api.calls, logs });
  }
  return runs;
}

function checkHeaders(runs) {
  const SECRET_WARNING = '[Research] ⚠️ env ของบอทมี RESEARCH_AGENT_SECRET';
  assert.equal(runs.length, 2);
  for (const { env, calls, logs } of runs) {
    const label = env.RESEARCH_AGENT_SECRET ? 'ตั้ง RESEARCH_AGENT_SECRET' : 'ไม่ตั้ง';
    const research = calls.filter((c) => c.url.startsWith(`${API}/api/research/`));
    assert.deepEqual([...new Set(research.map((c) => new URL(c.url).pathname))].sort(), ['/api/research/cards', '/api/research/feedback', '/api/research/status']);
    for (const c of research) {
      assert.equal(c.headers['x-api-key'], 'S3CRET', c.url);
      assert.ok(!Object.hasOwn(c.headers, 'x-research-secret'), `${label} ${c.url}: ห้ามส่ง x-research-secret (ความลับของ worker)`);
    }
    const posted = calls.filter((x) => x.url.startsWith(`${API}/api/bot/posted`));
    assert.equal(posted.length, 2, 'เช็คก่อนโพสต์ 1 + จดหลังโพสต์บัตร 1');
    for (const c of posted) {
      assert.ok(!Object.hasOwn(c.headers, 'x-research-secret'), 'secret ของรีเสิร์ชห้ามไปกับ bot-posted');
      assert.equal(c.headers['x-bot-secret'], 'S3CRET');
    }
    assert.ok(!logs.some((l) => l.includes('R5ECRET') || l.includes('S3CRET')), 'ห้าม log ค่ากุญแจ');
    assert.equal(logs.filter((l) => l.startsWith(SECRET_WARNING)).length, env.RESEARCH_AGENT_SECRET ? 1 : 0,
      `${label}: ตั้ง secret ของ worker บนบอท = เตือนให้ลบ 1 ครั้ง · ไม่ตั้ง = ไม่เตือน`);
  }
}

test('header (r3 · mismatch #7): /api/research/* ใช้ x-api-key เดิมของบอทอย่างเดียว — ไม่ส่ง x-research-secret แม้ Railway ตั้ง RESEARCH_AGENT_SECRET (เตือนใน log ให้ลบ ไม่พิมพ์ค่า) · bot-posted ใช้ x-bot-secret', async () => {
  checkHeaders(await scenarioHeaders());
});

test('งานจบหลังโพสต์ผล: จด bot-posted (caseId จากลิงก์ ✅ · resultMsgIds เฉพาะ reply ของบอทใต้ข้อความนี้) · ถามทันที · ถามต่อทุก 20 วิไม่เกิน 15 นาที (r3) แล้วเลิกเงียบ', async () => {
  checkTail(await scenarioTail());
});

test('เครื่องค้นคว้าออฟไลน์: งานจบ + status offline + ยังไม่มีการ์ด → ป้าย 🔌 ใต้ข้อความพนักงาน 1 ครั้งแล้วเลิกตาม · status อ่านไม่ได้ = ไม่ติดป้าย', async () => {
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, status: () => ({ success: true, status: 'offline', lastHeartbeatAt: '2026-10-01T02:40:00.000Z' }) });
  const { ctl } = makeCtl({ api, sched });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await postResultLikeBot(world, source, ack);
  await settleWithin(ctl.jobEnded(JOB, {}), 'jobEnded');
  assert.equal(await settleWithin(done, 'การตามบัตรจบ'), 'offline');
  const labels = source.replies.filter((p) => p && p.content === RC.constants.OFFLINE_TEXT);
  assert.equal(labels.length, 1);
  assert.deepEqual(labels[0].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(sched.pending(), 0, 'ออฟไลน์แล้วเลิกตาม ไม่ถามต่อ');

  const w2 = makeWorld();
  const s2 = makeScheduler();
  const a2 = makeApi({ now: s2.now, status: () => httpError(500, { success: false }) });
  const c2 = makeCtl({ api: a2, sched: s2 }).ctl;
  const j2 = setupJob(w2);
  const d2 = c2.watch({ jobId: JOB, message: j2.source, processingMsg: j2.ack });
  await settleWithin(c2.jobEnded(JOB, {}), 'jobEnded (status ล่ม)');
  await drain(s2, 'หาง (status ล่ม)');
  assert.equal(await settleWithin(d2, 'จบ'), 'tail_done');
  assert.equal(j2.source.replies.length, 0, 'อ่านสถานะไม่ได้ ห้ามเดาว่าออฟไลน์');
});

test('การถามการ์ด fail-open: 404/500/สายหลุด = ถามต่อ · 401/403 = เลิกตามทันที · errorType *_DISABLED = เลิก · request expired = เลิก', async () => {
  const seq = [httpError(404, { success: false, errorType: 'NOT_FOUND' }), httpError(500), new Error('socket hang up'), { success: true, card: cardDone() }];
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: (jobId, n) => seq[Math.min(n, seq.length - 1)] });
  const { ctl } = makeCtl({ api, sched });
  const { source, ack } = setupJob(world);
  ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  for (let i = 0; i < 4; i++) await settleWithin(sched.step(), `รอบ ${i + 1}`);
  assert.equal(cardReplies(source).length, 1, 'ล้มชั่วคราว 3 รอบแล้วรอบที่ 4 ได้การ์ด = โพสต์');

  for (const [label, response, reason] of [
    ['401', httpError(401, { success: false, errorType: 'UNAUTHORIZED' }), 'http_401'],
    ['403', httpError(403, { success: false, errorType: 'RESEARCH_SECRET_NOT_CONFIGURED' }), 'http_403'],
    ['ปิดฝั่งเว็บ', { success: false, errorType: 'RESEARCH_AGENT_DISABLED' }, 'disabled'],
    ['คำขอหมดอายุ', { success: true, card: null, request: { status: 'expired' } }, 'request_expired'],
  ]) {
    const w = makeWorld();
    const s = makeScheduler();
    const a = makeApi({ now: s.now, cards: () => response });
    const c = makeCtl({ api: a, sched: s }).ctl;
    const j = setupJob(w);
    const d = c.watch({ jobId: JOB, message: j.source, processingMsg: j.ack });
    await settleWithin(s.step(), `รอบแรก ${label}`);
    assert.equal(await settleWithin(d, label), reason, label);
    assert.equal(s.pending(), 0, `${label}: ต้องเลิกตามทันที`);
    assert.equal(a.cardGets().length, 1, `${label}: ห้ามถามซ้ำ`);
  }
});

// ★ r3 (mismatch #8): เว็บปิดสวิตช์ — เลน B ตอบ success:true + enabled:false (request/cards null · จับจากการรัน handler จริง)
//   → เลิกถามหลังถามครั้งแรก (เดิมวนทุก 20 วิจนหมดหาง) · การ์ดค้างจากก่อนปิด (enabled:false + แถวการ์ด) ก็ไม่โพสต์ — สวิตช์เว็บเป็นตัวหลัก
//   · งานจบทีหลังไม่ถามซ้ำ ไม่แตะ bot-posted · /api/research/status ตอนปิด = 'disabled' (ไม่ใช่ offline → ไม่ติดป้าย ไม่เตือนโควตา)
const LANE_B_STATUS_DISABLED = () => ({
  success: true, enabled: false, mode: 'shadow', status: 'disabled', offlineAfterMs: 600000, workers: [], lastSeenAt: null,
  quota: null, queue: null, settings: { waitMs: 0, maxMinutes: 6, quotaAlertPct: 15, secretConfigured: false },
});

async function scenarioWebDisabled({ mod = RC } = {}) {
  const out = {};
  for (const [name, body] of [['disabled', () => laneB('disabled')], ['doneButDisabled', laneBDoneButDisabled]]) {
    const world = makeWorld();
    const sched = makeScheduler();
    const api = makeApi({ now: sched.now, cards: body, status: LANE_B_STATUS_DISABLED });
    const { ctl, logs } = makeCtl({ api, sched, mod });
    const { source, ack } = setupJob(world);
    const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
    await settleWithin(sched.step(), `${name} รอบแรก`);
    sched.advance(5 * SEC);
    await postResultLikeBot(world, source, ack);
    const ended = ctl.jobEnded(JOB, {});
    if (ended) await settleWithin(ended, `${name} jobEnded`);
    await drain(sched, `${name} หลังจบงาน`);
    out[name] = {
      reason: await settleWithin(done, `${name} จบ`),
      ended,
      polls: api.cardGets().length,
      cardReplies: cardReplies(source),
      postedCalls: api.calls.filter((c) => c.url.startsWith(`${API}/api/bot/posted`)).length,
      otherReplies: source.replies.filter((p) => typeof p === 'object' && p?.content === RC.constants.OFFLINE_TEXT).length,
      sends: world.channel.sends.length,
      pending: sched.pending(),
      logs,
    };
  }
  return out;
}

function checkWebDisabled(r) {
  for (const name of ['disabled', 'doneButDisabled']) {
    const x = r[name];
    assert.equal(x.reason, 'disabled', `${name}: เว็บปิดสวิตช์ (enabled:false) ต้องเลิกตาม`);
    assert.equal(x.polls, 1, `${name}: ถามครั้งเดียวแล้วหยุด ห้ามวนทุก 20 วิจนหมดหาง`);
    assert.equal(x.ended, null, `${name}: งานจบหลังเลิกตามแล้ว = ไม่ทำอะไรต่อ`);
    assert.equal(x.cardReplies.length, 0, `${name}: ห้ามโพสต์บัตร (สวิตช์เว็บเป็นตัวหลัก)`);
    assert.equal(x.postedCalls, 0, `${name}: ไม่แตะ bot-posted`);
    assert.equal(x.otherReplies + x.sends, 0, `${name}: ไม่ติดป้ายออฟไลน์ ไม่เตือนโควตา`);
    assert.equal(x.pending, 0, `${name}: ไม่ทิ้ง timer`);
    assert.ok(x.logs.some((l) => l.includes('เลิกตามบัตร') && l.includes('(disabled)')), `${name}: log เหตุเลิกตาม`);
  }
}

test('เว็บปิดสวิตช์ (r3 · mismatch #8): เลน B ตอบ enabled:false → เลิกถามหลังครั้งแรก ไม่วนจนหมดหาง · การ์ดค้างจากก่อนปิดก็ไม่โพสต์ · งานจบทีหลังไม่ถามซ้ำ ไม่จด bot-posted', async () => {
  checkWebDisabled(await scenarioWebDisabled());
});

// ★ r3 ("เทส 15% พอดี"): เจ้าของข้อ 16 "เหลือ 15% ให้เตือน" → เกณฑ์รวมค่าเท่ากัน (≤ 15)
//   วันที่ 1: /status เหลือ 15% พอดี → เตือน · วันที่ 2: เหลือ 16% → ไม่เตือน · วันที่ 3: status ไม่มีโควตาแต่บัตรบอก brain.quotaPctAfter 15 → เตือน
async function scenarioQuotaBoundary({ mod = RC } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  let statusQuota = { pct: 15, account: 'c' };
  let card = null;
  const api = makeApi({
    now: sched.now,
    status: () => ({ success: true, status: 'online', quota: statusQuota }),
    cards: () => (card ? { success: true, card: clone(card) } : EMPTY()),
  });
  const { ctl } = makeCtl({ api, sched, mod });
  const runJob = async (jobId) => {
    const { source, ack } = setupJob(world);
    const done = ctl.watch({ jobId, message: source, processingMsg: ack });
    await settleWithin(sched.step(), `รอบแรก ${jobId}`);
    await settleWithin(ctl.jobEnded(jobId, { handedOff: true }), `ปิด ${jobId}`);
    await settleWithin(done, `จบ ${jobId}`);
  };
  await runJob('q_day1');
  const day1 = world.channel.sends.length;
  sched.advance(24 * 60 * MIN);
  statusQuota = { pct: 16, account: 'c' };
  await runJob('q_day2');
  const day2 = world.channel.sends.length;
  sched.advance(24 * 60 * MIN);
  statusQuota = null;
  card = { ...cardDone(), brain: { ...cardDone().brain, quotaPctAfter: 15 } };
  await runJob('q_day3');
  return { world, day1, day2, total: world.channel.sends.length };
}

function checkQuotaBoundary(r) {
  assert.equal(r.day1, 1, 'เหลือ 15% พอดี = ถึงเกณฑ์ ≤15% ต้องเตือน');
  assert.ok(r.world.channel.sends[0].content.startsWith(`<@${OWNER_ID}> 🔋 โควตาเอเจนต์ค้นคว้าเหลือ 15% (บัญชี c) — ถึงเกณฑ์เตือน ≤15%`));
  assert.equal(r.day2, 1, 'เหลือ 16% ยังไม่ถึงเกณฑ์ ห้ามเตือน');
  assert.equal(r.total, 2, 'บัตรบอกเหลือ 15% พอดี (brain.quotaPctAfter) ก็ต้องเตือน');
  assert.ok(r.world.channel.sends[1].content.includes('เหลือ 15% (บัญชี main)'));
}

test('เตือนโควตาที่ 15% พอดี (r3): status เหลือ 15% → เตือน · 16% → ไม่เตือน · บัตร brain.quotaPctAfter 15 → เตือน (เกณฑ์ ≤ ไม่ใช่ <)', async () => {
  checkQuotaBoundary(await scenarioQuotaBoundary());
});

// ★ r2: ตัวควบคุมกับคำตอบจริงของเลน B ตลอดสาย — queued (20 วิ) → leased (40 วิ) → done (60 วิ) ระหว่างรองาน
async function scenarioLaneB({ mod = RC } = {}) {
  const seq = ['pendingQueued', 'pendingLeased', 'done'];
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: (jobId, n) => laneB(seq[Math.min(n, seq.length - 1)]) });
  const { ctl } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  for (let i = 0; i < 3; i++) await settleWithin(sched.step(), `เลน B รอบถามที่ ${i + 1}`);
  const atThirdPoll = cardReplies(source).length;
  await settleWithin(ctl.jobEnded(JOB, {}), 'เลน B jobEnded');
  await drain(sched, 'เลน B หลังจบงาน');
  const reason = await settleWithin(done, 'เลน B การตามบัตรจบ');
  return { world, api, sched, source, ack, atThirdPoll, reason };
}

function checkLaneB(r) {
  assert.equal(r.atThirdPoll, 1, 'คำตอบเลน B รอบที่ 3 (done) ต้องโพสต์บัตรทันทีระหว่างรองาน');
  const replies = cardReplies(r.source);
  assert.equal(replies.length, 1, 'บัตรขึ้นใต้ข้อความพนักงาน 1 ใบ');
  assert.equal(replies[0].embeds[0].data.title, '🧪 ทดลอง · 🧾 บัตรข้อเท็จจริง');
  assert.deepEqual(replies[0].allowedMentions, { parse: [], repliedUser: false });
  const cardMsg = cardMessageOf(r.world, r.source.id);
  assert.deepEqual(cardMsg.reactions, ['👍', '👎']);
  const writes = r.api.postedWrites();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { jobId: JOB, channelId: 'CH1', sourceMessageId: r.source.id, processingMsgId: r.ack.id, researchCardMsgId: cardMsg.id });
  assert.deepEqual(r.api.cardGets().map((c) => c.at - START), [20 * SEC, 40 * SEC, 60 * SEC], 'ถาม 3 รอบ (queued · leased · done) แล้วหยุด');
  assert.equal(r.reason, 'card');
  assert.equal(r.sched.pending(), 0, 'จบแล้วต้องไม่ทิ้ง timer');
}

test('สัญญาเลน B ตัวจริง (r2) ระหว่างรองาน: queued → leased → done → บัตรขึ้นรอบที่ 3 (60 วิ) + 👍👎 + จด bot-posted · หยุดถาม · งานจบแล้วเลิกตาม', async () => {
  checkLaneB(await scenarioLaneB());
});

// ★ r2: worker รายงานล้ม (แถว failed ใต้ "cards") → บัตรสีเทา · ใบขอหมดอายุ (request.status expired · cards null) → เลิกตามหลังถามครั้งแรก
async function scenarioLaneBEnds({ mod = RC } = {}) {
  const out = {};
  for (const name of ['failed', 'expired']) {
    const world = makeWorld();
    const sched = makeScheduler();
    const api = makeApi({ now: sched.now, cards: () => laneB(name) });
    const { ctl } = makeCtl({ api, sched, mod });
    const { source, ack } = setupJob(world);
    const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
    await settleWithin(sched.step(), `เลน B ${name} รอบแรก`);
    await settleWithin(ctl.jobEnded(JOB, {}), `เลน B ${name} jobEnded`);
    await drain(sched, `เลน B ${name} หลังจบงาน`);
    out[name] = {
      reason: await settleWithin(done, `เลน B ${name} จบ`),
      replies: cardReplies(source),
      cardMsg: cardMessageOf(world, source.id),
      polls: api.cardGets().length,
      pending: sched.pending(),
    };
  }
  return out;
}

function checkLaneBEnds(r) {
  assert.equal(r.failed.replies.length, 1, 'worker รายงานล้ม = บัตรสีเทาบอกพนักงาน 1 ใบ');
  assert.ok(r.failed.replies[0].embeds[0].data.description.includes('⚠️ รีเสิร์ชข่าวนี้ไม่สำเร็จ'));
  assert.equal(r.failed.replies[0].embeds[0].data.color, '#6b7280');
  assert.deepEqual(r.failed.cardMsg.reactions, [], 'บัตร failed ไม่ต้องให้คะแนน');
  assert.equal(r.failed.reason, 'card');
  assert.equal(r.failed.polls, 1, 'บัตรขึ้นแล้วห้ามถามซ้ำ');
  assert.equal(r.expired.reason, 'request_expired', 'ใบขอหมดอายุ = การ์ดไม่มาแล้ว ต้องเลิกตาม');
  assert.equal(r.expired.replies.length, 0);
  assert.equal(r.expired.polls, 1, 'ใบขอหมดอายุแล้วห้ามถามซ้ำ');
  for (const name of ['failed', 'expired']) assert.equal(r[name].pending, 0, `${name}: ไม่ทิ้ง timer`);
}

test('สัญญาเลน B ตัวจริง (r2) จบงาน: worker รายงานล้ม → บัตรสีเทาไม่ติด 👍👎 · ใบขอหมดอายุ → เลิกตามหลังถามครั้งแรก ไม่โพสต์', async () => {
  checkLaneBEnds(await scenarioLaneBEnds());
});

test('ส่งต่อ instance อื่น / กำลังปิดตัว → เลิกตามเงียบ ไม่โพสต์ ไม่จด ไม่ทิ้ง timer', async () => {
  for (const [flags, reason] of [[{ handedOff: true }, 'handed_off'], [{ shuttingDown: true }, 'shutdown']]) {
    const world = makeWorld();
    const { ctl, api, sched } = makeCtl({ api: makeApi({ cards: () => ({ success: true, card: cardDone() }) }) });
    const { source, ack } = setupJob(world);
    const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
    assert.equal(ctl.jobEnded(JOB, flags), null);
    assert.equal(await settleWithin(done, reason), reason);
    assert.equal(sched.pending(), 0);
    assert.equal(api.calls.length, 0);
    assert.equal(source.replies.length, 0);
  }
  let down = false;
  const world = makeWorld();
  const { ctl, api, sched } = makeCtl({ api: makeApi({ cards: () => ({ success: true, card: cardDone() }) }), shutting: () => down });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  down = true; // SIGTERM ระหว่างรอ
  await settleWithin(sched.step(), 'รอบหลัง SIGTERM');
  assert.equal(await settleWithin(done, 'shutdown'), 'shutdown');
  assert.equal(api.calls.length, 0);
  assert.equal(source.replies.length, 0);
});

async function scenarioDedupe({ mod = RC } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: () => ({ success: true, card: cardDone() }) });
  api.posted.set(JOB, { jobId: JOB, channelId: 'CH1', researchCardMsgId: '1999999999999999999' });
  const { ctl } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'รอบแรก');
  await postResultLikeBot(world, source, ack);
  await settleWithin(ctl.jobEnded(JOB, {}), 'jobEnded');
  return { world, api, sched, source, reason: await settleWithin(done, 'จบ') };
}

function checkDedupe(r) {
  assert.equal(cardReplies(r.source).length, 0, 'มี instance อื่นโพสต์บัตรไว้แล้ว → ห้ามโพสต์ซ้ำ');
  assert.equal(r.reason, 'card');
  const last = r.api.postedWrites().at(-1);
  assert.equal(last.body.researchCardMsgId, '1999999999999999999', 'จด bot-posted ตอนจบงานต้องอ้างบัตรเดิม');
}

test('กันบัตรซ้ำข้าม instance (ช่วง redeploy ทับกัน): bot-posted มี researchCardMsgId แล้ว → ไม่โพสต์ซ้ำ · อ่าน bot-posted ไม่ได้ → โพสต์ (fail-open)', async () => {
  checkDedupe(await scenarioDedupe());
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: () => ({ success: true, card: cardDone() }), postedGet: () => httpError(502) });
  const { ctl } = makeCtl({ api, sched });
  const { source, ack } = setupJob(world);
  ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'รอบแรก');
  assert.equal(cardReplies(source).length, 1, 'อ่านไม่ได้ = ยอมเสี่ยงซ้ำดีกว่าบัตรหาย');
});

test('ข้อความพนักงานถูกลบ (reply ล้ม) → โพสต์บัตรใต้ข้อความ ack ของบอทแทน · โพสต์ไม่ได้เลย = ลองใหม่รอบหน้า', async () => {
  const world = makeWorld();
  const { ctl, api, sched } = makeCtl({ api: makeApi({ cards: () => ({ success: true, card: cardDone() }) }) });
  const { source, ack } = setupJob(world);
  world.failReplyTo.add(source.id);
  world.failReplyTo.add(ack.id);
  ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'รอบแรก (โพสต์ไม่ได้ทั้งคู่)');
  assert.equal(api.postedWrites().length, 0);
  assert.equal(sched.pending(), 1, 'โพสต์ไม่ได้ = ตั้งรอบถามใหม่');
  world.failReplyTo.delete(ack.id);
  await settleWithin(sched.step(), 'รอบสอง');
  assert.equal(cardReplies(ack).length, 1, 'ต้องไปขึ้นใต้ข้อความ ack');
  assert.equal(cardReplies(source).length, 0);
  assert.equal(api.postedWrites().length, 1);
});

test('งานล้ม (ack เป็น ❌): ไม่จด bot-posted ตอนจบงาน · ยังถามการ์ดต่อ ≤ 15 นาที · การ์ดมาทีหลังก็ยังโพสต์ (โหมดทดลองเก็บคะแนนได้)', async () => {
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: (jobId, n) => (n >= 4 ? { success: true, card: cardDone() } : EMPTY()) });
  const { ctl } = makeCtl({ api, sched });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await ack.edit('❌ เกิดข้อผิดพลาดในการประมวลผล: ระบบฐานข้อมูลขัดข้อง');
  await settleWithin(ctl.jobEnded(JOB, {}), 'jobEnded');
  assert.equal(api.postedWrites().length, 0, 'ไม่ได้โพสต์ผล = ไม่จด bot-posted');
  await drain(sched, 'หาง');
  assert.equal(await settleWithin(done, 'จบ'), 'card');
  assert.equal(cardReplies(source).length, 1);
  const writes = api.postedWrites();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.postedAt, undefined, 'งานล้มไม่มีเวลาโพสต์ผล');
  assert.equal(writes[0].body.resultMsgIds, undefined);
});

// รอบถามที่ "ค้างอยู่" ตอนงานจบ แล้วเพิ่งได้บัตร — afterJob ที่ต่อคิวไว้ต้องยังได้จดผลข่าวลง bot-posted
async function scenarioRaceCardWhileJobEnds({ mod = RC } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = makeApi({
    now: sched.now,
    cards: (jobId, n) => (n === 0 ? gate.then(() => ({ data: { success: true, card: cardDone() } })) : { success: true, card: cardDone() }),
  });
  const { ctl } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'รอบแรก (คำขอการ์ดยังค้าง)');
  const resultIds = await postResultLikeBot(world, source, ack);
  const ended = ctl.jobEnded(JOB, {});
  release(); // บัตรมาถึงหลังงานจบ — รอบถามเดิมไปต่อก่อน afterJob ที่ต่อคิว
  await settleWithin(ended, 'afterJob');
  const reason = await settleWithin(done, 'จบ');
  return { api, source, resultIds, reason, sched };
}

function checkRace(r) {
  assert.equal(r.reason, 'card');
  assert.equal(cardReplies(r.source).length, 1);
  const row = r.api.posted.get(JOB);
  assert.equal(row.caseId, '05268', 'บัตรที่เจอตอนงานเพิ่งจบ ต้องไม่ทำให้ผลข่าวหายจาก bot-posted');
  assert.deepEqual(row.resultMsgIds, r.resultIds);
  assert.ok(row.researchCardMsgId);
  assert.equal(r.sched.pending(), 0);
}

test('race: รอบถามที่ค้างอยู่ตอนงานจบเพิ่งเจอบัตร → บัตรขึ้น + bot-posted ยังมีผลข่าวครบ (afterJob ที่ต่อคิวไม่ถูกข้าม)', async () => {
  checkRace(await scenarioRaceCardWhileJobEnds());
});

async function scenarioReactions({ mod = RC } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: () => ({ success: true, card: cardDone() }) });
  const { ctl } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'โพสต์บัตร');
  const cardMsg = cardMessageOf(world, source.id);
  const react = (emoji, message, user) => settleWithin(ctl.handleReaction({ emoji: { name: emoji }, message }, user), `reaction ${emoji}`);
  const human = { id: STAFF_ID, bot: false, username: 'somchai' };
  const results = {
    up: await react('👍', cardMsg, human),
    down: await react('👎', cardMsg, { ...human, id: '700000000000000002' }),
    botSelf: await react('👍', cardMsg, { id: BOT_ID, bot: true }),
    botFlag: await react('👎', cardMsg, { id: '600000000000000001', bot: true }),
    otherEmoji: await react('🔥', cardMsg, human),
    resultMsg: await react('👍', ack, human),
    staffMsg: await react('👍', source, human),
  };
  return { world, api, sched, ctl, cardMsg, results, human };
}

function checkReactions(r) {
  assert.deepEqual(r.results.up, { ok: true, jobId: JOB, vote: 'up', userId: `discord-${STAFF_ID}` });
  assert.equal(r.results.down.vote, 'down');
  assert.equal(r.results.botSelf.skipped, 'bot', 'บอทติดปุ่มเอง = ห้ามนับเป็นคะแนน');
  assert.equal(r.results.botFlag.skipped, 'bot');
  assert.equal(r.results.otherEmoji.skipped, 'emoji');
  assert.equal(r.results.resultMsg.skipped, 'not_card', 'ข้อความผลข่าวไม่ใช่บัตร');
  assert.equal(r.results.staffMsg.skipped, 'not_ours');
  assert.deepEqual(r.api.feedbackPosts().map((c) => c.body), [
    { jobId: JOB, cardId: 'all', vote: 'up', userId: `discord-${STAFF_ID}` },
    { jobId: JOB, cardId: 'all', vote: 'down', userId: 'discord-700000000000000002' },
  ]);
  assert.equal(r.api.feedbackPosts()[0].headers['x-api-key'], 'S3CRET');
}

test('👍/👎 ของคนบนบัตร → POST /api/research/feedback {jobId, cardId:"all", vote, userId:"discord-<id>"} · บอทกดเอง/อีโมจิอื่น/ข้อความผล/ข้อความคน = ข้าม', async () => {
  const r = await scenarioReactions();
  checkReactions(r);
  // หลังรีสตาร์ต (แผนที่ในหน่วยความจำว่าง) → อ่าน jobId จากท้ายบัตร · reaction/ข้อความเป็น partial → ดึงเต็มก่อน
  const fresh = makeCtl({ api: makeApi() });
  const partialMsg = { id: r.cardMsg.id, partial: true, fetch: async () => r.cardMsg };
  const reaction = { emoji: { name: '👍' }, partial: true, message: partialMsg, fetch: async () => ({ message: partialMsg }) };
  const res = await settleWithin(fresh.ctl.handleReaction(reaction, r.human), 'reaction หลังรีสตาร์ต');
  assert.deepEqual(res, { ok: true, jobId: JOB, vote: 'up', userId: `discord-${STAFF_ID}` });
  assert.equal(RC.jobIdFromCardMessage({ embeds: [{ title: '[A1] ข่าว', footer: { text: `jobId: ${JOB}` } }] }), null, 'embed ที่ไม่ใช่บัตรห้ามนับ');
  // เซิร์ฟเวอร์ไม่รับ/ล่ม → ok:false (ล้มเงียบ)
  const bad = makeCtl({ api: makeApi({ feedback: () => ({ success: false, error: 'บัตรไม่มีแล้ว', errorType: 'NOT_FOUND' }) }) });
  assert.equal((await settleWithin(bad.ctl.handleReaction({ emoji: { name: '👍' }, message: r.cardMsg }, r.human), 'feedback ไม่รับ')).ok, false);
  const broken = makeCtl({ api: makeApi({ feedback: () => httpError(500) }) });
  assert.equal((await settleWithin(broken.ctl.handleReaction({ emoji: { name: '👎' }, message: r.cardMsg }, r.human), 'feedback ล่ม')).ok, false);
});

async function scenarioQuota({ mod = RC, env = {} } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  let pct = 12;
  const api = makeApi({ now: sched.now, status: () => ({ success: true, status: 'online', quota: { pct, account: 'b' } }) });
  const { ctl } = makeCtl({ api, sched, mod, env });
  const runJob = async (jobId) => {
    const { source, ack } = setupJob(world);
    const done = ctl.watch({ jobId, message: source, processingMsg: ack });
    await settleWithin(sched.step(), `รอบแรก ${jobId}`);
    await settleWithin(ctl.jobEnded(jobId, { handedOff: true }), `ปิด ${jobId}`);
    await settleWithin(done, `จบ ${jobId}`);
  };
  await runJob('q_job1');
  sched.advance(2 * MIN);
  await runJob('q_job2'); // วันเดียวกัน (เวลาไทย) → ห้ามเตือนซ้ำ
  const sameDay = world.channel.sends.length;
  sched.advance(15 * 60 * MIN); // ข้ามเที่ยงคืนเวลาไทย
  await runJob('q_job3');
  const nextDay = world.channel.sends.length;
  pct = 40;
  sched.advance(26 * 60 * MIN);
  await runJob('q_job4'); // วันใหม่แต่เหลือ 40% → ไม่เตือน
  return { world, sameDay, nextDay, total: world.channel.sends.length };
}

function checkQuota(r, ownerId = OWNER_ID) {
  assert.equal(r.sameDay, 1, 'วันเดียวกันเตือนครั้งเดียว');
  assert.equal(r.nextDay, 2, 'วันใหม่ (เวลาไทย) เตือนได้อีก');
  assert.equal(r.total, 2, 'เหลือ 40% ไม่เตือน');
  const first = r.world.channel.sends[0];
  assert.ok(first.content.startsWith(`<@${ownerId}> 🔋 โควตาเอเจนต์ค้นคว้าเหลือ 12% (บัญชี b) — ถึงเกณฑ์เตือน ≤15%`));
  assert.deepEqual(first.allowedMentions, { parse: [], users: [ownerId] }, 'mention ได้เฉพาะเจ้าของ');
}

test('เตือนโควตา ≤ 15%: mention เจ้าของเซิร์ฟเวอร์ในห้องเดิม วันละครั้ง (วันตามเวลาไทย) · 40% ไม่เตือน · env RESEARCH_AGENT_OWNER_DISCORD_ID ชนะ · ธง QUOTA_LOW ในบัตรก็เตือน · ส่งล้มลองใหม่ได้', async () => {
  checkQuota(await scenarioQuota());
  const custom = '500000000000000009';
  checkQuota(await scenarioQuota({ env: { RESEARCH_AGENT_OWNER_DISCORD_ID: custom } }), custom);
  // เกณฑ์ปรับได้ · ค่าเพี้ยน = 15
  const r30 = await scenarioQuota({ env: { RESEARCH_AGENT_QUOTA_ALERT_PCT: '50' } });
  assert.equal(r30.total, 3, 'เกณฑ์ 50% → 40% ก็เตือน (วันใหม่)');
  // ธง QUOTA_LOW / quotaPctAfter ในบัตร
  const world = makeWorld();
  const { ctl, sched } = makeCtl({ api: makeApi({ status: () => ({ success: true, status: 'online' }), cards: () => ({ success: true, card: { ...cardDone(), flags: ['QUOTA_LOW'], brain: { ...cardDone().brain, quotaPctAfter: 9 } } }) }) });
  const { source, ack } = setupJob(world);
  ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'บัตรธง QUOTA_LOW');
  assert.equal(world.channel.sends.length, 1);
  assert.ok(world.channel.sends[0].content.includes('เหลือ 9%'));
  // ส่งล้ม → ยังไม่นับว่าเตือนแล้ว (รอบหน้าลองใหม่)
  const w2 = makeWorld();
  let fail = true;
  const realSend = w2.channel.send;
  w2.channel.send = async (p) => { if (fail) throw new Error('Missing Permissions'); return realSend(p); };
  const q2 = makeCtl({ api: makeApi({ status: () => ({ success: true, quota: { pct: 5 } }) }) });
  for (const id of ['q_a', 'q_b']) {
    const j = setupJob(w2);
    q2.ctl.watch({ jobId: id, message: j.source, processingMsg: j.ack });
  }
  await settleWithin(q2.sched.step(), 'งาน a (ส่งล้ม)');
  fail = false;
  q2.sched.advance(2 * MIN); // ให้แคชสถานะหมดอายุ
  await settleWithin(q2.sched.step(), 'งาน b');
  assert.equal(w2.channel.sends.length, 1, 'ส่งล้มครั้งแรก → งานถัดไปเตือนได้');
});

test('บัตรสถานะ failed/skipped → โพสต์บัตรสีเทาบอกเหตุ ไม่ติด 👍👎', async () => {
  const failedView = RC.buildCardView({ ...cardDone(), status: 'failed', cards: [], plan: [] }, JOB);
  assert.equal(failedView.color, '#6b7280');
  assert.ok(failedView.description.includes('⚠️ รีเสิร์ชข่าวนี้ไม่สำเร็จ — ข่าวทำตามปกติจากเนื้อที่ส่งมา'));
  assert.equal(failedView.reactable, false);
  assert.ok(!failedView.footer.includes('👍'));
  const skippedView = RC.buildCardView({ ...cardDone(), status: 'skipped', cards: [], plan: [], flags: [], skipped: ['เรื่องเสี่ยงกฎหมาย'] }, JOB);
  assert.ok(skippedView.description.startsWith('⏭️ เอเจนต์ข้ามข่าวนี้: เรื่องเสี่ยงกฎหมาย — ข่าวทำตามปกติ'));
  const world = makeWorld();
  const { ctl, sched } = makeCtl({ api: makeApi({ cards: () => ({ success: true, card: { ...cardDone(), status: 'failed', cards: [] } }) }) });
  const { source, ack } = setupJob(world);
  ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'บัตร failed');
  assert.equal(cardReplies(source).length, 1);
  assert.deepEqual(cardMessageOf(world, source.id).reactions, [], 'บัตร failed ไม่ต้องให้คะแนน');
});

test('ตาข่ายนิรภัย: ไม่มี jobEnded เลย → เลิกตามที่ 90 นาที · จอดหลังโพสต์บัตรก็เลิกที่เพดานเดียวกัน · ตามพร้อมกันเกิน 50 งาน = เลิกงานเก่าสุด', async () => {
  const world = makeWorld();
  const { ctl, sched, api } = makeCtl();
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await drain(sched, 'ถามจนชนเพดาน');
  assert.equal(await settleWithin(done, 'hard cap'), 'hard_cap');
  assert.equal(api.cardGets().length, 269, 'ถามทุก 20 วิ ตั้งแต่ 20s ถึง 89:40 นาที');

  const w2 = makeWorld();
  const p = makeCtl({ api: makeApi({ cards: () => ({ success: true, card: cardDone() }) }) });
  const j2 = setupJob(w2);
  const d2 = p.ctl.watch({ jobId: JOB, message: j2.source, processingMsg: j2.ack });
  await settleWithin(p.sched.step(), 'โพสต์บัตร');
  assert.equal(p.sched.pending(), 1, 'จอดรอจบงาน 1 timer');
  await drain(p.sched, 'จอดจนชนเพดาน');
  assert.equal(await settleWithin(d2, 'จอดชนเพดาน'), 'hard_cap');
  assert.equal(p.sched.now() - START, RC.constants.HARD_CAP_MS);

  const w3 = makeWorld();
  const many = makeCtl();
  const j0 = setupJob(w3);
  const first = many.ctl.watch({ jobId: 'q_first', message: j0.source, processingMsg: j0.ack });
  for (let i = 0; i < 50; i++) {
    many.sched.advance(1);
    const j = setupJob(w3);
    many.ctl.watch({ jobId: `q_n${i}`, message: j.source, processingMsg: j.ack });
  }
  assert.equal(await settleWithin(first, 'evicted'), 'evicted');
  assert.equal(many.ctl.activeJobIds().length, 50);
});

// ============================================================
// 3) ต่อสายจริงใน discord-bot/index.js
// ============================================================
// บล็อกที่เลน C เติมใน index.js (ตรงทุกไบต์) — ถอดออกได้ = ฉบับก่อนมีเลนนี้ (ใช้เทียบ byte-parity)
const LANE_C_INSERTS = [
  ['// ★ 1 ต.ค. 69 (research v2 · เลน C): บัตรข้อเท็จจริงจากเอเจนต์ค้นคว้า — โมดูลแยก (axios/EmbedBuilder/นาฬิกาฉีดจากไฟล์นี้ ไม่ require เอง)',
    "const { createResearchCards } = require('./researchCard');"],
  ["// ★ 1 ต.ค. 69 (research v2 · เลน C · SPEC-v2 ส่วน 7): บัตรข้อเท็จจริงจากเอเจนต์ค้นคว้า — ค่าเริ่มต้น=ปิด · เปิด: RESEARCH_AGENT=1 (รับ '1' ตรงตัวแบบ envFlag)",
    '//   ปิด = บอทเดิมทุกไบต์ (payload คิว · intents · partials · listener · คำขอ HTTP ไม่เปลี่ยน)',
    '//   เปิด = แยกลิงก์ → sourceUrls · ตามการ์ดทุก 20 วิ · reply 🧾 ใต้ข้อความพนักงาน · 👍👎 → feedback · เตือนโควตา (ดู discord-bot/researchCard.js)',
    "const RESEARCH_AGENT = envFlag('RESEARCH_AGENT', false);"],
  ['',
    '// ★ 1 ต.ค. 69 (research v2 · เลน C): ตัวจัดการบัตรข้อเท็จจริง — สวิตช์ปิด = ทุกเมธอด no-op (ไม่ตั้ง timer ไม่ยิง HTTP ไม่แตะ payload)',
    '//   เส้นทางข่าวเรียกแบบไม่รอ (fail-open): รีเสิร์ชล้ม/ช้า/ออฟไลน์ ข่าวไม่ล้ม ไม่ช้าลง · URL/กุญแจชุดเดียวกับคิว+สมุด (buildQueueUrl/buildApiHeaders/buildTrackingHeaders)',
    'const research = createResearchCards({',
    '  enabled: RESEARCH_AGENT,',
    '  env: process.env,',
    '  http: axios,',
    '  EmbedBuilder,',
    '  client,',
    "  buildApiUrl: (path) => buildQueueUrl().replace('/api/queue/add', path),",
    '  buildApiHeaders,',
    '  buildBotHeaders: buildTrackingHeaders,',
    '  isShuttingDown: () => shuttingDown,',
    '  logger: console,',
    '  now: () => Date.now(),',
    '  setTimeout,',
    '  clearTimeout,',
    '});'],
  ['    // ★ 1 ต.ค. 69 (research v2 · เลน C · เจ้าของข้อ 2): RESEARCH_AGENT=1 → ลิงก์ในข้อความแยกเป็น payload.sourceUrls',
    '    //   (+ input ที่ตัดลิงก์ ถ้าเหลือ ≥ 20 ตัวอักษร · สั้นกว่านั้น = url mode เดิม) · ปิด = payload เดิมทุกไบต์',
    '    research.applySourceUrls(payload, content);'],
  ['    // ★ 1 ต.ค. 69 (research v2 · เลน C): ได้ jobId + ack แล้ว → เริ่มถามบัตรข้อเท็จจริงทุก 20 วิ (ไม่รอ · สวิตช์ปิด = no-op)',
    '    research.watch({ jobId, message, processingMsg });'],
  ['    // ★ 1 ต.ค. 69 (research v2 · เลน C): งานจบ → ถามบัตรต่ออีก ≤ 15 นาที + จด bot-posted ถ้าโพสต์ผลแล้ว (ไม่รอ · ส่งต่อ instance อื่น/ปิดตัว = เลิกตาม)',
    '    research.jobEnded(trackedJobId, { handedOff, shuttingDown });'],
  ['  research.watch({ jobId, message, processingMsg }); // ★ 1 ต.ค. 69 (research v2 · เลน C): งานที่กู้มาก็ตามบัตรต่อ (สวิตช์ปิด = no-op)'],
  ['    research.jobEnded(jobId, { handedOff, shuttingDown }); // ★ 1 ต.ค. 69 (research v2 · เลน C)'],
  ['',
    '// ★ 1 ต.ค. 69 (research v2 · เลน C): 👍/👎 บนบัตรข้อเท็จจริง → POST /api/research/feedback · ผูกเฉพาะตอน RESEARCH_AGENT=1',
    '//   ตัวฟังปุ่มรีวิวด้านบนข้ามบัตรเอง (บัตรไม่มีลิงก์ /generation-logs/ ในเนื้อข้อความ) · ตัวนี้ข้ามข้อความผลข่าวเอง (ไม่มี "jobId:" ท้ายบัตร)',
    'if (RESEARCH_AGENT) {',
    "  client.on('messageReactionAdd', (reaction, user) => {",
    '    research.handleReaction(reaction, user).catch((err) => {',
    '      console.warn(`[Research] 🩹 จัดการ reaction บนบัตรล้ม (ไม่กระทบงานหลัก): ${String(err?.message || err).slice(0, 80)}`);',
    '    });',
    '  });',
    '}'],
];
const LANE_C_REPLACES = [
  [['    //   ★ 1 ต.ค. 69 (research v2 · เลน C): บัตรข้อเท็จจริงรับ 👍👎 ด้วย → ขอ intent นี้เมื่อ RESEARCH_AGENT=1 ด้วย (ปิดทั้งคู่ = เหมือนเดิม)',
    '    ...((BOT_REVIEW_REACTIONS || RESEARCH_AGENT) ? [GatewayIntentBits.GuildMessageReactions] : []),'],
  ['    ...(BOT_REVIEW_REACTIONS ? [GatewayIntentBits.GuildMessageReactions] : []),']],
  [['  //   ★ 1 ต.ค. 69 (research v2 · เลน C): บัตรที่โพสต์ก่อนรีสตาร์ตก็ต้องรับ 👍👎 ได้ → ประกาศเมื่อ RESEARCH_AGENT=1 ด้วย',
    '  ...((BOT_REVIEW_REACTIONS || RESEARCH_AGENT) ? { partials: [Partials.Message, Partials.Reaction] } : {}),'],
  ['  ...(BOT_REVIEW_REACTIONS ? { partials: [Partials.Message, Partials.Reaction] } : {}),']],
];

// ★ 1 ต.ค. 69 (SPEC-v3 · เลน W2): บล็อกที่ W2 เติมใน index.js (ตรงทุกไบต์) — ถอดคู่กับเลน C = ฉบับก่อนมีรีเสิร์ช (byte-parity ปิดสวิตช์)
//   ถอดเฉพาะ W2 (stripW2) = ฉบับเฟส 1 — ใช้พิสูจน์ว่าจุดเรียกใหม่ไม่เปลี่ยนอะไรเลยเมื่อไม่ใช่โหมด write
const LANE_W2_INSERTS = [
  ['',
    '    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.2 · เลน W2): ผลข่าวพก analysisResult.researchAgent.editor (ผลบรรณาธิการ) มาด้วย',
    '    //   → ตัวจัดการบัตรจำไว้ แล้วโพสต์ "ใบที่สอง" ตอนงานจบ (ต่อท้ายผลข่าว) · ไม่ยิง HTTP ไม่โพสต์ตรงนี้ · สวิตช์ปิด/ไม่ใช่โหมด write = no-op',
    '    research.noteJobResult(jobId, data);'],
];

function stripW2(src) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  let out = src;
  for (const block of LANE_W2_INSERTS) {
    const chunk = block.join(eol) + eol;
    assert.equal(out.split(chunk).length, 2, `บล็อก W2 ต้องเจอครั้งเดียว: ${block.find((l) => l.trim()).slice(0, 60)}`);
    out = out.replace(chunk, () => '');
  }
  assert.ok(!/noteJobResult/u.test(out), 'ถอดแล้วต้องไม่เหลือจุดเรียก W2');
  return out;
}

function stripLaneC(src) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  let out = stripW2(src); // ★ W2 ของเดิม: let out = src; — ถอดจุดเรียก W2 ก่อน แล้วถอดเลน C ตามเดิมทุกบรรทัด
  for (const block of LANE_C_INSERTS) {
    const chunk = block.join(eol) + eol;
    assert.equal(out.split(chunk).length, 2, `บล็อกเลน C ต้องเจอครั้งเดียว: ${block.find((l) => l.trim()).slice(0, 60)}`);
    out = out.replace(chunk, () => '');
  }
  for (const [now, before] of LANE_C_REPLACES) {
    const chunk = now.join(eol);
    assert.equal(out.split(chunk).length, 2, `บรรทัดแก้ของเลน C ต้องเจอครั้งเดียว: ${now[1].trim().slice(0, 60)}`);
    out = out.replace(chunk, () => before.join(eol));
  }
  assert.ok(!/createResearchCards|RESEARCH_AGENT|\bresearch\./u.test(out), 'ถอดแล้วต้องไม่เหลือร่องรอยเลน C');
  return out;
}
// คำนวณตอนใช้ (ไม่ใช่ตอนโหลดไฟล์) — จุดเรียกหาย/ถูกแก้ = แดงเฉพาะข้อที่เกี่ยว ไม่ล่มทั้งไฟล์
let legacyBotSrcCache = null;
const legacyBotSrc = () => (legacyBotSrcCache ??= stripLaneC(BOT_SRC));

function makeBotAxios({ record, api, statuses, sched }) {
  const calls = [];
  const tracking = [];
  let statusIdx = 0;
  const log = (method, url, body, headers) => {
    const entry = { method, url, body: clone(body), headers: clone(headers), at: sched.now() };
    calls.push(entry);
    record('http', { method, url, body: entry.body, headers: entry.headers });
  };
  const isApi = (url) => url.startsWith(`${API}/api/research/`) || url.startsWith(`${API}/api/bot/posted`);
  const jobIdOf = (url) => new URL(url).searchParams.get('jobId');
  return {
    calls,
    tracking,
    async get(url, opts) {
      if (isApi(url)) return api.http.get(url, opts);
      log('get', url, undefined, opts?.headers);
      if (url.startsWith(`${API}/api/bot/tracking`)) {
        const wanted = jobIdOf(url);
        const items = tracking.filter((e) => !wanted || e.jobId === wanted).map(clone);
        return { data: { success: true, count: items.length, items } };
      }
      if (url.startsWith(`${API}/api/queue/status?`)) {
        const st = statuses[Math.min(statusIdx, statuses.length - 1)];
        statusIdx++;
        return { data: clone(st) };
      }
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body, opts) {
      if (isApi(url)) return api.http.post(url, body, opts);
      log('post', url, body, opts?.headers);
      if (url === `${API}/api/queue/add`) return { data: { success: true, jobId: JOB, position: 1, queuesAhead: 0 } };
      if (url === `${API}/api/bot/tracking`) {
        const idx = tracking.findIndex((e) => e.jobId === body.jobId);
        const row = { ...(idx >= 0 ? tracking[idx] : {}), ...clone(body), id: `bt_${body.jobId}` };
        if (idx >= 0) tracking[idx] = row; else tracking.push(row);
        return { data: { success: true, created: idx < 0, item: row } };
      }
      if (url === `${API}/api/queue/worker`) return { data: { success: true } };
      throw new Error(`unexpected POST ${url}`);
    },
    async delete(url, opts) {
      log('delete', url, undefined, opts?.headers);
      const idx = tracking.findIndex((e) => e.jobId === jobIdOf(url));
      if (idx >= 0) tracking.splice(idx, 1);
      return { data: { success: true, removed: idx >= 0 } };
    },
    async patch(url, body, opts) {
      log('patch', url, body, opts?.headers);
      return { data: { success: true, caseId: url.split('/').pop(), status: body.status } };
    },
  };
}

function loadBot({ botSrc = BOT_SRC, cardSrc = CARD_SRC, env = {}, axios, sched, channels = {} } = {}) {
  const handlers = {};
  class FakeClient {
    constructor(opts) {
      this.opts = opts;
      this.user = { id: BOT_ID, tag: 'bot#0' };
      this.loggedIn = false;
      this.channels = { fetch: async (id) => {
        if (!channels[id]) throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
        return channels[id];
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
    Partials: { Message: 3, Reaction: 5 },
    EmbedBuilder: FakeEmbed,
  };
  const cardModule = loadCardModule(cardSrc);
  const fakeRequire = (name) => {
    if (name === 'dotenv') return { config() {} };
    if (name === 'discord.js') return discord;
    if (name === 'axios') return axios;
    if (name === './researchCard') return cardModule;
    return realRequire(name); // 'os', './queue-errors' ของจริง
  };
  const mod = { exports: {} };
  const logs = [];
  const fakeConsole = {
    log: (...a) => logs.push(a.map(String).join(' ')),
    warn: (...a) => logs.push(a.map(String).join(' ')),
    error: (...a) => logs.push(a.map(String).join(' ')),
  };
  const fakeProcess = { env: { API_URL: `${API}/api/auto/process`, API_KEY: 'S3CRET', ...env }, on() {}, exit() {} };
  const fakeMath = Object.assign(Object.create(Math), { random: () => 0.5 }); // BOT_INSTANCE คงที่ → เทียบบันทึก 2 ฉบับได้ตรงตัว
  new Function('require', 'module', 'exports', 'process', 'console', 'setTimeout', 'clearTimeout', 'Date', 'Math', botSrc)(
    fakeRequire, mod, mod.exports, fakeProcess, fakeConsole, sched.setTimeout, sched.clearTimeout, makeFakeDate(sched), fakeMath);
  return { bot: mod.exports, handlers, logs, client: mod.exports._client };
}

const PROCESSING = () => ({ success: true, status: 'processing' });
const RESULT = () => ({
  success: true,
  data: {
    newsData: { newsTitle: 'ลุงสามล้อ' },
    analysisResult: {
      versions: [
        { content: 'เนื้อข่าว V1', style: '[A1] เรื่องเล่าอบอุ่น', _source: 'classic' },
        { content: 'เนื้อข่าว V2', style: '[A2] ช่วยเหลือกัน', _source: 'enhanced' },
      ],
      qualityWarnings: [],
    },
    generationLog: { error: null, caseId: '05268', success: true },
  },
});
const DONE = () => ({ success: true, status: 'completed', result: RESULT() });
const longJob = () => [...Array.from({ length: 15 }, PROCESSING), DONE()];

async function runBotScenario({ botSrc = BOT_SRC, cardSrc = CARD_SRC, env = {}, content = NEWS_WITH_URL, statuses = longJob(),
  cards = EMPTY, status, feedback, mode = 'normal', drainResearch = true, routeSrc = null } = {}) {
  const sched = makeScheduler();
  const transcript = [];
  const record = (kind, data) => transcript.push(clone([kind, data]));
  const world = makeWorld({ record });
  // ★ r3: routeSrc = ต่อ /api/bot/posted เข้า route ตัวจริง (store ปลอมของเลน B · นาฬิกาเดียวกัน) แทนแผนที่ปลอม
  const store = routeSrc ? makeBotPostedStorage({ now: sched.now }) : null;
  const api = makeApi({ now: sched.now, record, cards, status, feedback, postedRoute: store ? loadRoute({ src: routeSrc, store }) : null });
  const axios = makeBotAxios({ record, api, statuses, sched });
  const loaded = loadBot({ botSrc, cardSrc, env, axios, sched, channels: { CH1: world.channel } });
  const source = world.staffMessage(content);
  if (mode === 'resume') {
    const ack = world.botMessage('รับทราบครับ! กำลังอ่านข้อมูลและปั้นบทความไวรัล รอสักครู่นะครับ ⚡...', source.id);
    axios.tracking.push({
      id: `bt_${JOB}`, jobId: JOB, channelId: 'CH1', messageId: ack.id, sourceMessageId: source.id, guildId: 'G1', userId: STAFF_ID,
      instance: 'oldhost_dead1', startedAt: new Date(START - 2 * MIN).toISOString(), queueUrl: `${API}/api/queue/add`,
    });
    await drive(sched, loaded.bot.resumeTrackedJobs(), 'resumeTrackedJobs');
  } else {
    await drive(sched, loaded.bot.processNewsJob({ message: source, content, processingMsg: null, addedAt: sched.now() }), 'processNewsJob');
  }
  const pendingAfterJob = sched.pending();
  if (drainResearch) await drain(sched, 'timer หลังงานจบ');
  const handlerCounts = Object.fromEntries(Object.entries(loaded.handlers).map(([k, v]) => [k, v.length]));
  return {
    transcript, calls: axios.calls, api, world, source, loaded, sched, pendingAfterJob, store,
    clientOpts: clone(loaded.client.opts), handlerCounts, logs: [...loaded.logs], delays: [...sched.delays], pending: sched.pending(),
  };
}

function checkParity(current, legacy, label) {
  assert.deepEqual(current.transcript, legacy.transcript, `${label}: บันทึกการกระทำต้องตรงกันทุกไบต์`);
  assert.deepEqual(current.clientOpts, legacy.clientOpts, `${label}: intents/partials`);
  assert.deepEqual(current.handlerCounts, legacy.handlerCounts, `${label}: ตัวฟัง event`);
  assert.deepEqual(current.logs, legacy.logs, `${label}: log`);
  assert.deepEqual(current.delays, legacy.delays, `${label}: timer ที่ตั้ง`);
  assert.equal(current.pending, 0, `${label}: ไม่เหลือ timer`);
}

test('byte-parity: ไม่ตั้ง RESEARCH_AGENT (หรือค่าที่ไม่ใช่ "1") → บอทตรงกับฉบับถอดจุดเรียกเลน C ทุกไบต์ — payload คิว · header · ข้อความ/embed/reaction · timer · log · intents/partials/ตัวฟัง', async () => {
  for (const env of [{}, { RESEARCH_AGENT: '0' }, { RESEARCH_AGENT: 'true' }, { RESEARCH_AGENT: ' 1' }, { BOT_REVIEW_REACTIONS: '1' }]) {
    for (const mode of ['normal', 'resume']) {
      const label = `${JSON.stringify(env)} ${mode}`;
      const legacy = await runBotScenario({ botSrc: legacyBotSrc(), env, mode });
      const current = await runBotScenario({ env, mode });
      checkParity(current, legacy, label);
    }
  }
  // ยืนยันว่าบันทึกครอบคลุมจริง (ไม่ใช่ว่างทั้งคู่) และ payload เดิมยังส่งลิงก์ใน input ตามเดิม
  const off = await runBotScenario();
  const add = off.calls.find((c) => c.url === `${API}/api/queue/add`);
  assert.equal(add.body.input, NEWS_WITH_URL);
  assert.deepEqual(Object.keys(add.body), ['input', 'images', 'contentLength', 'userId', '_botInstance', '_msgId']);
  assert.ok(!off.transcript.some(([kind, d]) => kind === 'http' && /\/api\/(research|bot\/posted)/u.test(d.url)), 'ปิดสวิตช์ห้ามแตะ endpoint รีเสิร์ช');
  assert.ok(off.transcript.some(([kind, d]) => kind === 'edit' && d.content.startsWith('✅ **สร้างข่าวสำเร็จ!**')));
  assert.ok(off.transcript.length > 30);
  assert.deepEqual(off.clientOpts.intents, [1, 2, 4]);
  assert.equal(off.clientOpts.partials, undefined);
  assert.equal(off.handlerCounts.messageReactionAdd, undefined);
  assert.ok(!off.logs.some((l) => l.includes('[Research]')));
});

const CARD_AT_SECOND_POLL = (jobId, n) => (n >= 1 ? { success: true, card: cardDone() } : EMPTY());
// ★ r2: คำตอบจริงของเลน B บนเส้นทางเดียวกัน — queued ที่ 20 วิ → done ที่ 40 วิ (ระหว่างรองาน · จังหวะเดียวกับ CARD_AT_SECOND_POLL)
const LANE_B_AT_SECOND_POLL = (jobId, n) => laneB(n >= 1 ? 'done' : 'pendingQueued');

async function scenarioBotOn({ botSrc = BOT_SRC, cardSrc = CARD_SRC, env = ON, cards = CARD_AT_SECOND_POLL } = {}) {
  return runBotScenario({ botSrc, cardSrc, env, cards });
}

function checkBotOn(r) {
  const add = r.calls.find((c) => c.url === `${API}/api/queue/add`);
  assert.equal(add.body.input, NEWS_TEXT, 'ลิงก์ถูกตัดออกจาก input');
  assert.deepEqual(add.body.sourceUrls, [SRC_URL]);
  assert.deepEqual(Object.keys(add.body), ['input', 'images', 'contentLength', 'userId', '_botInstance', '_msgId', 'sourceUrls']);
  assert.deepEqual(r.clientOpts.intents, [1, 2, 4, 1024], 'ต้องขอ intent reaction (บัตรรับ 👍👎)');
  assert.deepEqual(r.clientOpts.partials, [3, 5]);
  assert.equal(r.handlerCounts.messageReactionAdd, 1);
  // ลำดับใต้ข้อความพนักงาน: ack → บัตร (มาระหว่างรองาน t=40s) → เวอร์ชัน 1, 2 → สรุป research
  const titles = r.source.replies.map((p) => (typeof p === 'string' ? 'ack' : String(p.embeds?.[0]?.data?.title || '')));
  assert.deepEqual(titles, [
    'ack',
    '🧪 ทดลอง · 🧾 บัตรข้อเท็จจริง',
    '[[A1] เรื่องเล่าอบอุ่น] ลุงสามล้อ',
    '[[A2] ช่วยเหลือกัน] ลุงสามล้อ',
    '📄 เขียนจากเนื้อต้นฉบับอย่างเดียว',
  ]);
  const ack = [...r.world.messages.values()].find((m) => m.reference?.messageId === r.source.id && m.edits.length > 0);
  assert.ok(ack.content.startsWith('✅ **สร้างข่าวสำเร็จ!** 2 เวอร์ชัน'), 'ผลข่าวโพสต์ครบเหมือนเดิม');
  assert.deepEqual(r.source.reactions, ['✅']);
  const cardMsg = cardMessageOf(r.world, r.source.id);
  assert.deepEqual(cardMsg.reactions, ['👍', '👎']);
  const row = r.api.posted.get(JOB);
  const resultIds = [...r.world.messages.values()]
    .filter((m) => m.reference?.messageId === r.source.id && m.id !== ack.id && m.id !== cardMsg.id).map((m) => m.id);
  assert.deepEqual(row, {
    sourceMessageId: r.source.id, processingMsgId: ack.id, resultMsgIds: resultIds, caseId: '05268', researchCardMsgId: cardMsg.id,
    postedAt: row.postedAt, jobId: JOB, channelId: 'CH1',
  });
  assert.ok(Number.isFinite(Date.parse(row.postedAt)));
  assert.equal(resultIds.length, 3);
  assert.equal(r.pending, 0, 'จบแล้วไม่ทิ้ง timer');
}

test('RESEARCH_AGENT=1 เส้นทางจริง: payload แยกลิงก์ · intent+partials+ตัวฟัง · บัตรขึ้นระหว่างรองาน · ผลข่าวโพสต์ครบ · งานจบ → bot-posted มี caseId จาก ✅ จริง + resultMsgIds + researchCardMsgId', async () => {
  checkBotOn(await scenarioBotOn());
});

test('RESEARCH_AGENT=1 เส้นทางจริง + คำตอบจริงของเลน B (r2): บัตรขึ้นระหว่างรองาน · ผลข่าวโพสต์ครบ · bot-posted ครบ — ข้อยืนยันชุดเดียวกับเส้นทางจริง', async () => {
  checkBotOn(await scenarioBotOn({ cards: LANE_B_AT_SECOND_POLL }));
});

test('RESEARCH_AGENT=1 + BOT_REVIEW_REACTIONS=1: ตัวฟัง 2 ตัว · 👍 บนบัตร = feedback อย่างเดียว · 👍 บนข้อความผล = PATCH รีวิวอย่างเดียว', async () => {
  const r = await scenarioBotOn({ env: { ...ON, BOT_REVIEW_REACTIONS: '1' } });
  assert.equal(r.handlerCounts.messageReactionAdd, 2);
  const cardMsg = cardMessageOf(r.world, r.source.id);
  const ack = [...r.world.messages.values()].find((m) => m.reference?.messageId === r.source.id && m.edits.length > 0);
  const human = { id: STAFF_ID, bot: false, username: 'somchai' };
  const fire = async (message) => {
    for (const handler of r.loaded.handlers.messageReactionAdd) handler({ emoji: { name: '👍' }, message, partial: false }, human);
    for (let i = 0; i < 6; i++) await flush();
  };
  await settleWithin(fire(cardMsg), '👍 บนบัตร');
  assert.equal(r.api.feedbackPosts().length, 1);
  assert.equal(r.calls.filter((c) => c.method === 'patch').length, 0, 'บัตรห้ามโดนบันทึกเป็นรีวิวข่าว');
  await settleWithin(fire(ack), '👍 บนผลข่าว');
  assert.equal(r.calls.filter((c) => c.method === 'patch').length, 1);
  assert.equal(r.calls.find((c) => c.method === 'patch').url, `${API}/api/generation-logs/05268`);
  assert.equal(r.api.feedbackPosts().length, 1, 'ข้อความผลข่าวห้ามโดนนับเป็นคะแนนบัตร');
});

test('เส้นทางกู้หลังรีสตาร์ต (resumeTrackedJob) ก็ตามบัตรต่อ → บัตรขึ้นใต้ข้อความพนักงาน · bot-posted ครบ', async () => {
  const r = await runBotScenario({ env: ON, mode: 'resume', cards: () => ({ success: true, card: cardDone() }) });
  assert.equal(cardReplies(r.source).length, 1);
  const row = r.api.posted.get(JOB);
  assert.equal(row.caseId, '05268');
  assert.ok(row.researchCardMsgId);
  assert.equal(row.resultMsgIds.length, 3);
  assert.equal(r.pending, 0);
});

test('fail-open: endpoint รีเสิร์ช/bot-posted ล่มทุกตัว หรือค้างไม่ตอบ → ข่าวโพสต์ผลครบ ตรงกับตอนปิดสวิตช์ทุกข้อความ (ช้าลง 0 วิ) · ไม่มีบัตร', async () => {
  const discordOnly = (t) => t.filter(([kind]) => kind !== 'http');
  const httpQueueOnly = (calls) => calls.filter((c) => !/\/api\/(research|bot\/posted)/u.test(c.url)).map((c) => [c.method, c.url, c.at]);
  // ล่ม: ทุกคำขอรีเสิร์ช/สถานะโยน error (เนื้อไม่มีลิงก์ → payload เท่ากันทั้งสองฝั่ง เทียบได้ตรงตัว)
  const broken = await runBotScenario({ env: ON, content: NEWS_TEXT, cards: () => httpError(500), status: () => new Error('ECONNRESET') });
  const offText = await runBotScenario({ content: NEWS_TEXT });
  assert.deepEqual(discordOnly(broken.transcript), discordOnly(offText.transcript), 'ข้อความใน Discord ต้องเหมือนตอนปิดสวิตช์');
  assert.deepEqual(httpQueueOnly(broken.calls), httpQueueOnly(offText.calls), 'จังหวะคิว/สมุดเหมือนเดิมทุกวินาที');
  assert.equal(broken.pending, 0);
  // ค้าง: คำขอการ์ดไม่ตอบเลย (promise ไม่จบ) → ข่าวไม่รอ
  const hung = await runBotScenario({ env: ON, content: NEWS_TEXT, cards: () => new Promise(() => {}), drainResearch: false });
  assert.deepEqual(discordOnly(hung.transcript), discordOnly(offText.transcript));
  assert.deepEqual(httpQueueOnly(hung.calls), httpQueueOnly(offText.calls));
});

// ============================================================
// 4) route /api/bot/posted — r3: ประตู HTTP ของบอท → saveBotPosted/getBotPosted ของเลน B (ไม่ใช่ persistStore ตรง)
// ============================================================
const routeExec = (src) => src
  .replace(/^import .*$/mg, '')
  .replace(/^export const .*$/mg, '')
  .replace(/^export async function (GET|POST)/mg, 'async function $1');

// import ทุกบรรทัดของ route → [{names, spec}] · รับรูปเดียว: import { a, b } from '…'; (บรรทัดเดียว) — รูปอื่น = แดง (โหลดแทนไม่ได้)
function routeImports(src) {
  return src.split('\n').filter((line) => /^import\s/u.test(line)).map((line) => {
    const m = /^import\s+\{([^}]*)\}\s+from\s+'([^']+)';\s*$/u.exec(line);
    assert.ok(m, `import ของ route ต้องเป็นรูป { ชื่อ } from '…' บรรทัดเดียว: ${line}`);
    return { names: m[1].split(',').map((s) => s.trim()).filter(Boolean), spec: m[2] };
  });
}

// ★ r3: store ปลอมของเลน B — เลียน saveBotPosted/getBotPosted ของ src/lib/research-agent/store.js (worktree เลน B · sha256 90298b80…)
//   รูปที่จับจากการรันฟังก์ชันจริงบน Supabase ปลอมของเลน B (1 ต.ค. 69 r3 · สคริปต์จับอยู่ใน scratchpad ไม่ใช่ไฟล์โปรเจกต์):
//   แถว store_items id 'bposted_<jobId>' · แถวใหม่ = {id: jobId, resultMsgIds: [], postedAt: null, ...ช่องที่ส่ง, createdAt, revision: 1, updatedAt}
//   เขียนซ้ำ = {...เดิม, ...ช่องที่ส่ง, id: jobId, revision+1, updatedAt} · id ทุกช่อง trim + [A-Za-z0-9_-]{1,100} (ไม่ผ่าน = ทิ้งเงียบ)
//   resultMsgIds ไม่ซ้ำ ≤ 50 · caseId ข้อความ (number → String) · postedAt เลข ms/ISO → ISO (ตามที่ส่ง)
//   jobId ผิดรูป = TypeError code RESEARCH_INVALID_INPUT · ฐานล่ม/ไม่พร้อม/cas ชนเกิน = ResearchStorageError (RESEARCH_STORAGE_UNAVAILABLE · 503)
//   ⚠️ เลน B แก้ไฟล์นี้ระหว่างรอบ r3 (ฉบับก่อน: postedAt = เวลาเขียนครั้งแรก · caseId เฉพาะเลข · resultMsgIds ≤ 20) — เปลี่ยนอีกต้องจับใหม่
const storageError = (message = 'ที่เก็บข้อมูลรีเสิร์ชใช้ไม่ได้ชั่วคราว') => Object.assign(new Error(message), {
  name: 'ResearchStorageError', errorType: 'RESEARCH_STORAGE_UNAVAILABLE', status: 503,
});
const B_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const bId = (value) => (typeof value === 'string' && B_ID_RE.test(value.trim()) ? value.trim() : null);
const bIso = (value) => {
  let ms = null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) ms = value;
  else if (typeof value === 'string' && value.trim()) ms = Date.parse(value.trim());
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

function makeBotPostedStorage({ now = () => START } = {}) {
  const rows = new Map(); // row id → data
  const calls = []; // ['load'] · ['save', input] · ['get', jobId]
  const failures = new Map(); // 'load' | 'save' | 'get' → () => Error (ใช้ครั้งเดียว)
  const take = (kind) => {
    const make = failures.get(kind);
    if (!make) return;
    failures.delete(kind);
    throw make();
  };
  const storage = {
    async saveBotPosted(input) {
      calls.push(['save', clone(input)]);
      take('save');
      const jobId = String(input?.jobId ?? input?.id ?? '');
      if (!B_ID_RE.test(jobId)) throw Object.assign(new TypeError('jobId ไม่ถูกต้อง'), { code: 'RESEARCH_INVALID_INPUT' });
      const patch = {};
      // ★ 1 ต.ค. 69 (SPEC-v3 สัญญา 8.2 · W2): store จริงเก็บ editorMsgId เพิ่ม (แก้คู่กันใน src/lib/research-agent/store.js) — ตัวปลอมตามให้ตรง
      for (const key of ['channelId', 'sourceMessageId', 'processingMsgId', 'researchCardMsgId', 'editorMsgId']) {
        const value = bId(input?.[key]);
        if (value) patch[key] = value;
      }
      if (Array.isArray(input?.resultMsgIds)) patch.resultMsgIds = [...new Set(input.resultMsgIds.map(bId).filter(Boolean))].slice(0, 50);
      const caseId = typeof input?.caseId === 'number'
        ? (Number.isSafeInteger(input.caseId) && input.caseId >= 0 ? String(input.caseId) : null)
        : bId(input?.caseId);
      if (caseId) patch.caseId = caseId;
      const postedAt = bIso(input?.postedAt);
      if (postedAt) patch.postedAt = postedAt;
      const iso = new Date(now()).toISOString();
      const rowId = `bposted_${jobId}`;
      const current = rows.get(rowId);
      const next = current
        ? { ...current, ...patch, id: jobId, revision: current.revision + 1, updatedAt: iso }
        : { id: jobId, resultMsgIds: [], postedAt: null, ...patch, createdAt: iso, revision: 1, updatedAt: iso };
      rows.set(rowId, clone(next));
      return clone(next);
    },
    async getBotPosted(jobId) {
      calls.push(['get', jobId]);
      take('get');
      return clone(rows.get(`bposted_${jobId}`) ?? null);
    },
  };
  return {
    rows,
    calls,
    doc: (jobId) => clone(rows.get(`bposted_${jobId}`) ?? null),
    failNext(kind, make) { failures.set(kind, make); },
    loadResearchStorage: async () => {
      calls.push(['load']);
      take('load');
      return storage;
    },
  };
}

// secret: null = ไม่ตั้ง env (fail-closed) · ไม่ส่ง = 'S3CRET'
//   import ทุกบรรทัดของ route ต้องเป็นโมดูลที่เทสเตรียม (next/server + store เลน B) — แอบกลับไปใช้ persistStore/โมดูลอื่น = แดงทันที
function loadRoute({ secret = 'S3CRET', src = ROUTE_SRC, store = makeBotPostedStorage() } = {}) {
  const NextResponse = { json: (body, init) => ({ body: clone(body), status: init?.status || 200 }) };
  const modules = {
    'next/server': { NextResponse },
    '@/lib/research-agent/store': { loadResearchStorage: store.loadResearchStorage },
  };
  const params = [];
  const args = [];
  for (const { names, spec } of routeImports(src)) {
    assert.ok(Object.hasOwn(modules, spec), `route import โมดูลที่เทสไม่ได้เตรียม: ${spec} (bot-posted ต้องผ่าน store ของเลน B เท่านั้น)`);
    for (const name of names) {
      assert.ok(Object.hasOwn(modules[spec], name), `${spec} ปลอมไม่มี export ${name}`);
      params.push(name);
      args.push(modules[spec][name]);
    }
  }
  const logs = [];
  const sink = (...a) => logs.push(a.map(String).join(' '));
  const env = {};
  if (secret !== null) env.DISCORD_API_SECRET = secret;
  const routes = new Function(...params, 'process', 'console', `${routeExec(src)}\nreturn { GET, POST };`)(
    ...args, { env }, { error: sink, warn: sink, log: sink });
  return { ...routes, store, logs };
}

const BAD_JSON = Symbol('bad json');
function routeReq({ body, botSecret, apiKey, query = '' } = {}) {
  return {
    url: `${API}/api/bot/posted${query}`,
    headers: { get: (name) => (name === 'x-bot-secret' ? botSecret || '' : name === 'x-api-key' ? apiKey || '' : '') },
    json: async () => {
      if (body === BAD_JSON) throw new SyntaxError('Unexpected token');
      return body;
    },
  };
}

async function checkRouteAuth(src = ROUTE_SRC) {
  const closed = loadRoute({ secret: null, src });
  for (const res of [await closed.GET(routeReq({ botSecret: 'x', query: `?jobId=${JOB}` })), await closed.POST(routeReq({ botSecret: 'x', body: { jobId: JOB, channelId: 'CH1' } }))]) {
    assert.equal(res.status, 403, 'ไม่ตั้ง DISCORD_API_SECRET ต้องปิดประตู (fail-closed)');
    assert.equal(res.body.errorType, 'BOT_SECRET_NOT_CONFIGURED');
  }
  assert.deepEqual(closed.store.calls, [], 'ปิดประตูต้องไม่แตะ store');
  assert.equal((await loadRoute({ secret: '   ', src }).GET(routeReq({ botSecret: '   ', query: `?jobId=${JOB}` }))).status, 403);
  const r = loadRoute({ src });
  assert.equal((await r.GET(routeReq({ query: `?jobId=${JOB}` }))).status, 401);
  assert.equal((await r.GET(routeReq({ botSecret: 'S3CREX', query: `?jobId=${JOB}` }))).status, 401);
  const denied = await r.POST(routeReq({ apiKey: 'nope', body: { jobId: JOB, channelId: 'CH1' } }));
  assert.equal(denied.status, 401);
  assert.equal(denied.body.errorType, 'UNAUTHORIZED');
  assert.deepEqual(r.store.calls, [], 'กุญแจผิดต้องไม่แตะ store');
  assert.equal((await r.GET(routeReq({ apiKey: ' S3CRET\n', query: `?jobId=${JOB}` }))).status, 200);
  assert.equal((await r.POST(routeReq({ botSecret: 'S3CRET\r\n', body: { jobId: JOB, channelId: 'CH1' } }))).status, 200);
}

test('route /api/bot/posted: ไม่ตั้ง DISCORD_API_SECRET → 403 ทุก method (fail-closed) · กุญแจผิด → 401 · ไม่ผ่านด่าน = ไม่โหลด store ของเลน B เลย · x-api-key/x-bot-secret มีช่องว่างท้ายก็ผ่าน', async () => {
  await checkRouteAuth();
});

// ★ r3 (mismatch #4): route = ประตูบางๆ ของ saveBotPosted/getBotPosted — ส่งต่อเฉพาะช่องสัญญา 2.3 ที่ผ่านด่าน (trim · ไม่ซ้ำ · caseId ข้อความ) ตรงตัว
async function scenarioRouteContract({ src = ROUTE_SRC } = {}) {
  const r = loadRoute({ src });
  const first = await r.POST(routeReq({ botSecret: 'S3CRET', body: { jobId: JOB, channelId: 'CH1', sourceMessageId: 'M1', processingMsgId: 'P1', researchCardMsgId: 'C1', extra: 'ห้ามส่งต่อ' } }));
  const second = await r.POST(routeReq({ botSecret: 'S3CRET', body: { jobId: ` ${JOB} `, channelId: 'CH1', resultMsgIds: ['R1', 'R2', ' R1'], caseId: '05268', postedAt: Date.UTC(2026, 9, 1, 3, 1) } }));
  const third = await r.POST(routeReq({ botSecret: 'S3CRET', body: { jobId: 'q_text', channelId: 'CH2', caseId: 'MCV-abc_1', postedAt: '2026-10-01T10:01:00+07:00' } }));
  const got = await r.GET(routeReq({ botSecret: 'S3CRET', query: `?jobId=${JOB}` }));
  const none = await r.GET(routeReq({ botSecret: 'S3CRET', query: '?jobId=q_nope' }));
  return { r, first, second, third, got, none };
}

function checkRouteContract(x) {
  for (const [label, res] of Object.entries({ first: x.first, second: x.second, third: x.third, got: x.got, none: x.none })) {
    assert.equal(res.status, 200, `${label}: ต้องสำเร็จ (ได้ ${res.status} ${res.body?.errorType || ''})`);
  }
  assert.deepEqual(x.r.store.calls, [
    ['load'], ['save', { jobId: JOB, channelId: 'CH1', sourceMessageId: 'M1', processingMsgId: 'P1', researchCardMsgId: 'C1' }],
    ['load'], ['save', { jobId: JOB, channelId: 'CH1', resultMsgIds: ['R1', 'R2'], caseId: '05268', postedAt: '2026-10-01T03:01:00.000Z' }],
    ['load'], ['save', { jobId: 'q_text', channelId: 'CH2', caseId: 'MCV-abc_1', postedAt: '2026-10-01T03:01:00.000Z' }],
    ['load'], ['get', JOB],
    ['load'], ['get', 'q_nope'],
  ], 'route ต้องส่งต่อ saveBotPosted/getBotPosted ของเลน B ตรงตัว: ช่องสัญญาเท่านั้น · trim · resultMsgIds ไม่ซ้ำ · caseId ข้อความไม่แปลง · postedAt เป็น ISO');
  const t0 = new Date(START).toISOString();
  assert.deepEqual(x.first.body, {
    success: true,
    item: { id: JOB, resultMsgIds: [], postedAt: null, channelId: 'CH1', sourceMessageId: 'M1', processingMsgId: 'P1', researchCardMsgId: 'C1', createdAt: t0, revision: 1, updatedAt: t0 },
  }, 'POST คืนเอกสารของเลน B ตรงตัว (data.id = jobId · มี revision · ยังไม่ส่งเวลาโพสต์ผล = postedAt null)');
  assert.equal(x.second.body.item.revision, 2, 'POST ซ้ำ = รวมแถวเดิม (cas · revision +1)');
  assert.equal(x.second.body.item.postedAt, '2026-10-01T03:01:00.000Z', 'postedAt ที่บอทส่ง (เลข ms) ถูกเก็บเป็น ISO');
  assert.deepEqual(x.got.body, { success: true, item: x.second.body.item }, 'GET คืนเอกสารล่าสุดของเลน B ตรงตัว');
  assert.equal(x.got.body.item.sourceMessageId, 'M1', 'ช่องที่ไม่ส่งรอบสองต้องคงค่าเดิม');
  assert.equal(x.got.body.item.researchCardMsgId, 'C1');
  assert.equal(x.got.body.item.caseId, '05268');
  assert.equal(x.third.body.item.caseId, 'MCV-abc_1', 'caseId เป็นข้อความได้ ไม่บังคับเลข (ข้อตัดสินผู้คุมงาน)');
  assert.deepEqual(x.none.body, { success: true, item: null });
  assert.deepEqual([...x.r.store.rows.keys()], [`bposted_${JOB}`, 'bposted_q_text'], 'แถวเดียวต่องานตามนิยามของเลน B');
}

test('route /api/bot/posted (r3 · mismatch #4): เรียก saveBotPosted/getBotPosted ของเลน B ตรงตัว — ช่องสัญญา 2.3 เท่านั้น · trim · resultMsgIds ไม่ซ้ำ · caseId ข้อความ · postedAt ISO · GET คืนเอกสารของเลน B · ไม่มี = item null', async () => {
  checkRouteContract(await scenarioRouteContract());
  assert.deepEqual(routeImports(ROUTE_SRC).map((i) => i.spec), ['next/server', '@/lib/research-agent/store'],
    'route import แค่ next/server + store ของเลน B (ห้าม persistStore ตรง = นิยามที่สอง)');
});

test('route /api/bot/posted: ข้อมูลผิดชนิด → 400 ไม่โหลด store · JSON พัง → 400 · GET ไม่ส่ง/jobId ผิดรูป → 400 · resultMsgIds 50 พอดีรับ 51 ไม่รับ', async () => {
  const r = loadRoute();
  const ok = { jobId: JOB, channelId: 'CH1' };
  const bad = [
    null, ['x'], {}, { jobId: JOB }, { jobId: 12, channelId: 'CH1' }, { jobId: ' ', channelId: 'CH1' }, { jobId: '../x', channelId: 'CH1' },
    { jobId: 'x'.repeat(101), channelId: 'CH1' }, { jobId: JOB, channelId: 'C H' },
    { ...ok, resultMsgIds: 'R1' }, { ...ok, resultMsgIds: [1] }, { ...ok, resultMsgIds: ['bad id!'] },
    { ...ok, resultMsgIds: Array.from({ length: 51 }, (_, i) => `R${i}`) },
    { ...ok, postedAt: 'not-a-date' }, { ...ok, postedAt: null }, { ...ok, caseId: 5 }, { ...ok, caseId: 'เคส 5' }, { ...ok, caseId: null },
    { ...ok, researchCardMsgId: { x: 1 } }, { ...ok, sourceMessageId: '' },
  ];
  for (const body of bad) {
    const res = await r.POST(routeReq({ botSecret: 'S3CRET', body }));
    assert.equal(res.status, 400, JSON.stringify(body)?.slice(0, 80));
    assert.equal(res.body.errorType, 'VALIDATION_ERROR');
  }
  const broken = await r.POST(routeReq({ botSecret: 'S3CRET', body: BAD_JSON }));
  assert.equal(broken.status, 400);
  assert.equal(broken.body.errorType, 'INVALID_JSON');
  for (const query of ['', '?jobId=', '?jobId=..%2Fx', `?jobId=${'x'.repeat(101)}`]) {
    const res = await r.GET(routeReq({ botSecret: 'S3CRET', query }));
    assert.equal(res.status, 400, `GET ${query}`);
    assert.equal(res.body.errorType, 'VALIDATION_ERROR');
  }
  assert.deepEqual(r.store.calls, [], 'ข้อมูลผิด = ไม่โหลด/ไม่เขียน store');
  const ok50 = await r.POST(routeReq({ botSecret: 'S3CRET', body: { ...ok, resultMsgIds: Array.from({ length: 50 }, (_, i) => `R${i}`) } }));
  assert.equal(ok50.status, 200, 'resultMsgIds 50 พอดี = รับ (เท่าที่ store เลน B เก็บ)');
  assert.equal(ok50.body.item.resultMsgIds.length, 50);
});

// ★ r3: error จาก store ของเลน B → 503 (ฐานใช้ไม่ได้) / 400 (store ว่าข้อมูลผิด) / 500 (อื่นๆ) · ไม่ส่งข้อความดิบกลับ
async function scenarioRouteErrors({ src = ROUTE_SRC } = {}) {
  const run = async (kind, make, method) => {
    const r = loadRoute({ src });
    r.store.failNext(kind, make);
    const res = method === 'GET'
      ? await r.GET(routeReq({ botSecret: 'S3CRET', query: `?jobId=${JOB}` }))
      : await r.POST(routeReq({ botSecret: 'S3CRET', body: { jobId: JOB, channelId: 'CH1', caseId: '05268' } }));
    return { status: res.status, body: res.body };
  };
  const down = (message) => () => storageError(message);
  return {
    loadDownGet: await run('load', down('ยังไม่ได้เชื่อม Supabase — ระบบรีเสิร์ชใช้ฐานกลางเท่านั้น'), 'GET'),
    loadDownPost: await run('load', down('ยังไม่ได้เชื่อม Supabase — ระบบรีเสิร์ชใช้ฐานกลางเท่านั้น'), 'POST'),
    casConflict: await run('save', down('บันทึก bot-posted ชนกับการเขียนอื่นเกินจำนวนครั้งที่กำหนด'), 'POST'),
    readDown: await run('get', down(), 'GET'),
    badInput: await run('save', () => Object.assign(new TypeError('jobId ไม่ถูกต้อง'), { code: 'RESEARCH_INVALID_INPUT' }), 'POST'),
    saveBug: await run('save', () => new Error('SECRET raw detail'), 'POST'),
    getBug: await run('get', () => new TypeError('SECRET cannot read properties'), 'GET'),
  };
}

function checkRouteErrors(x) {
  for (const name of ['loadDownGet', 'loadDownPost', 'casConflict', 'readDown']) {
    assert.equal(x[name].status, 503, `${name}: ที่เก็บของเลน B ใช้ไม่ได้ = 503`);
    assert.equal(x[name].body.errorType, 'RESEARCH_STORAGE_UNAVAILABLE', name);
  }
  assert.deepEqual([x.badInput.status, x.badInput.body.errorType], [400, 'VALIDATION_ERROR'], 'store ว่าข้อมูลผิด = 400');
  assert.deepEqual([x.saveBug.status, x.saveBug.body.errorType], [500, 'BOT_POSTED_WRITE_ERROR']);
  assert.deepEqual([x.getBug.status, x.getBug.body.errorType], [500, 'BOT_POSTED_READ_ERROR']);
  for (const [name, res] of Object.entries(x)) {
    assert.equal(res.body.success, false, name);
    assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0, `${name}: ต้องมีข้อความ error`);
    assert.ok(!JSON.stringify(res.body).includes('SECRET'), `${name}: ห้ามส่งข้อความดิบจาก error กลับ`);
  }
}

test('route /api/bot/posted (r3): store ของเลน B ใช้ไม่ได้ (โหลด/อ่าน/เขียน/cas ชน) → 503 RESEARCH_STORAGE_UNAVAILABLE · store ว่าข้อมูลผิด → 400 · error อื่น → 500 + errorType · ไม่ส่งข้อความดิบกลับ', async () => {
  checkRouteErrors(await scenarioRouteErrors());
});

// ★ r3: เส้นทางจริงทั้งสาย — บอท (index.js + researchCard.js) → route /api/bot/posted ตัวจริง → store ปลอมของเลน B
//   เช็คก่อนโพสต์บัตร (GET) → จดตอนโพสต์บัตร (POST) → จดผลข่าวตอนจบงาน (POST) · route ตอบ 200 ทุกครั้ง
//   แถวเดียว bposted_<jobId>: ข้อความต้นทาง/ack/บัตร/ผล 3 ใบ/caseId จาก ✅ จริง · revision 2
//   · createdAt = ตอนจดครั้งแรก (โพสต์บัตร) · postedAt = เวลาโพสต์ผลที่บอทส่งตอนจบงาน (ตอนโพสต์บัตรยังไม่ส่ง)
function checkBotRouteE2E(r) {
  assert.deepEqual(r.api.routeResponses.map((x) => [x.method, x.status]), [['get', 200], ['post', 200], ['post', 200]],
    'เช็คก่อนโพสต์บัตร → จดบัตร → จดผลข่าว · route ตอบ 200 ทุกครั้ง');
  const cardMsg = cardMessageOf(r.world, r.source.id);
  const ack = [...r.world.messages.values()].find((m) => m.reference?.messageId === r.source.id && m.edits.length > 0);
  const resultIds = [...r.world.messages.values()]
    .filter((m) => m.reference?.messageId === r.source.id && m.id !== ack.id && m.id !== cardMsg.id).map((m) => m.id);
  assert.equal(resultIds.length, 3);
  const writes = r.api.calls.filter((c) => c.method === 'post' && c.url === `${API}/api/bot/posted`);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.postedAt, undefined, 'ตอนโพสต์บัตร (ก่อนผลข่าว) ยังไม่มีเวลาโพสต์ผล');
  const doc = r.store.doc(JOB);
  assert.deepEqual({ ...doc, updatedAt: 'x' }, {
    id: JOB, resultMsgIds: resultIds, channelId: 'CH1', sourceMessageId: r.source.id, processingMsgId: ack.id,
    researchCardMsgId: cardMsg.id, caseId: '05268', postedAt: writes[1].body.postedAt, createdAt: new Date(writes[0].at).toISOString(),
    revision: 2, updatedAt: 'x',
  }, 'แถว bot-posted ตามนิยามเลน B ต้องมีผลข่าว + บัตรครบ');
  assert.ok(Date.parse(doc.postedAt) > Date.parse(doc.createdAt), 'postedAt = เวลาโพสต์ผล (หลังบัตรขึ้น) ไม่ใช่เวลาจดครั้งแรก');
  assert.deepEqual([...r.store.rows.keys()], [`bposted_${JOB}`]);
  assert.equal(cardReplies(r.source).length, 1);
  assert.equal(r.pending, 0);
}

test('เส้นทางจริงต่อสายถึง route (r3): บอท → /api/bot/posted ตัวจริง → store เลน B (ปลอม) — เช็คก่อนโพสต์บัตร · จดบัตร · จดผลข่าว · แถว bposted_<jobId> ครบ', async () => {
  checkBotRouteE2E(await runBotScenario({ env: ON, cards: LANE_B_AT_SECOND_POLL, routeSrc: ROUTE_SRC }));
});

// ★ r3: ข้อความผลเกิน 50 ใบ (เกินที่ store เลน B เก็บ / route รับ) → บอทส่งแค่ 50 ใบแรกตามเวลา → route ตอบ 200
//   (ถ้าเพดานบอทกับ route ไม่ตรงกัน route ตอบ 400 = ผลข่าวหายจาก bot-posted ทั้งก้อน — เคยเกือบเกิดจริงในรอบ r3: เลน B เปลี่ยน 20 → 50)
async function scenarioManyResults({ mod = RC } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  const store = makeBotPostedStorage({ now: sched.now });
  const api = makeApi({ now: sched.now, postedRoute: loadRoute({ store }) });
  const { ctl } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'รอบแรก');
  await ack.edit({ content: RESULT_TEXT });
  const ids = [];
  for (let i = 0; i < 52; i++) ids.push((await source.reply({ embeds: [embedOf(`[A${i}] ข่าว`)] })).id);
  await settleWithin(ctl.jobEnded(JOB, {}), 'jobEnded');
  await drain(sched, 'หาง');
  return { api, store, ids, reason: await settleWithin(done, 'จบ') };
}

function checkManyResults(r) {
  const writes = r.api.routeResponses.filter((x) => x.method === 'post');
  assert.equal(writes.length, 1, 'จดผลข่าวครั้งเดียวตอนจบงาน');
  assert.equal(writes[0].status, 200, `route ต้องรับ (ได้ ${writes[0].status} ${writes[0].body?.errorType || ''})`);
  const doc = r.store.doc(JOB);
  assert.deepEqual(doc.resultMsgIds, r.ids.slice(0, 50), 'เก็บ 50 ใบแรกตามเวลา');
  assert.equal(doc.caseId, '05268');
  assert.equal(r.reason, 'tail_done');
}

test('บอท ↔ route ตัวจริง (r3): ข้อความผล 52 ใบ → บอทส่ง resultMsgIds 50 ใบแรก (= ที่ store เลน B เก็บ) → route รับ 200 · ผลข่าวไม่หายจาก bot-posted', async () => {
  checkManyResults(await scenarioManyResults());
});

// ============================================================
// 5) กลายพันธุ์ (mutation) — patch ซอร์สแล้วข้อยืนยันชุดเดียวกับเทสหลักต้องแดง (กันเทสเขียวหลอก)
// ============================================================
const cardMutant = (from, to) => loadCardModule(mutate(CARD_SRC, from, to));

test('mutation M1: โมดูลเปิดเองแม้ไม่ตั้งสวิตช์ → byte-parity แดง', async () => {
  const src = mutate(CARD_SRC, 'const enabled = options.enabled === true;', 'const enabled = true;');
  const legacy = await runBotScenario({ botSrc: legacyBotSrc() });
  const current = await runBotScenario({ cardSrc: src });
  assert.throws(() => checkParity(current, legacy, 'M1'));
});

test('mutation M2: index.js ไม่ขอ intent reaction ตอน RESEARCH_AGENT=1 → เทสเส้นทางจริงแดง', async () => {
  const botSrc = mutate(BOT_SRC, '    ...((BOT_REVIEW_REACTIONS || RESEARCH_AGENT) ? [GatewayIntentBits.GuildMessageReactions] : []),',
    '    ...(BOT_REVIEW_REACTIONS ? [GatewayIntentBits.GuildMessageReactions] : []),');
  const r = await scenarioBotOn({ botSrc });
  assert.throws(() => checkBotOn(r), /intent reaction/u);
});

test('mutation M3: ไม่หยุดถามหลังหาง 15 นาที → เทสหางแดง (ถามจนชนเพดาน 90 นาที)', async () => {
  const mod = cardMutant("if (state.tailUntil !== null && t >= state.tailUntil) { endWatch(state, 'tail_done'); return; }", '');
  const r = await scenarioTail({ mod });
  assert.equal(r.reason, 'hard_cap');
  assert.throws(() => checkTail(r));
});

test('mutation M4: บัตรไม่ปิด mention → เทสระหว่างรองานแดง', async () => {
  const mod = cardMutant("const sent = await replyUnderSource(state, { embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });",
    'const sent = await replyUnderSource(state, { embeds: [embed] });');
  const r = await scenarioCardDuringWait({ mod });
  assert.throws(() => checkCardDuringWait(r), /mention/u);
});

test('mutation M5: ไม่ escape markdown → เทสเนื้อการ์ด = DATA แดง', () => {
  const mod = cardMutant('function escapeMd(value) {', "function escapeMd(value) { return String(value ?? '');");
  assert.throws(() => checkCardIsData(mod.buildCardView(evilCard(), JOB)), /escape/u);
});

// ★ r3: M6 เดิม (route ใช้ jobId ตรงๆ เป็น id แถว) ใช้ไม่ได้แล้ว — id แถวเป็นของ store เลน B → แทนด้วยกลายพันธุ์ของประตูใหม่
test('mutation M6 (r3): route ไม่ส่ง researchCardMsgId ต่อให้ store เลน B → บอทตัวอื่นไม่รู้ว่าโพสต์บัตรแล้ว → เทสต่อสายถึง route แดง', async () => {
  const routeSrc = mutate(ROUTE_SRC, "const OPTIONAL_ID_KEYS = ['sourceMessageId', 'processingMsgId', 'caseId', 'researchCardMsgId'];",
    "const OPTIONAL_ID_KEYS = ['sourceMessageId', 'processingMsgId', 'caseId'];");
  const r = await runBotScenario({ env: ON, cards: LANE_B_AT_SECOND_POLL, routeSrc });
  assert.equal(r.store.doc(JOB).researchCardMsgId, undefined, 'กลายพันธุ์ต้องทำให้แถวไม่มี researchCardMsgId จริง');
  assert.throws(() => checkBotRouteE2E(r), /บัตรครบ/u);
});

test('mutation M7: นับ reaction ของบอทเองเป็นคะแนน → เทส 👍👎 แดง', async () => {
  const mod = cardMutant("if (user.bot === true || (botId && idOf(user.id) === botId)) return { ok: false, skipped: 'bot' };", '');
  const r = await scenarioReactions({ mod });
  assert.throws(() => checkReactions(r));
});

test('mutation M8: เตือนโควตาไม่จำวัน → เตือนซ้ำวันเดียวกัน → เทสโควตาแดง', async () => {
  const mod = cardMutant('if (lastQuotaAlertDay === day) return false;', '');
  const r = await scenarioQuota({ mod });
  assert.throws(() => checkQuota(r), /ครั้งเดียว/u);
});

test('mutation M9: index.js ไม่แจ้งงานจบ (jobEnded) → bot-posted ไม่มีผลข่าว → เทสเส้นทางจริงแดง', async () => {
  const botSrc = mutate(BOT_SRC, '    research.jobEnded(trackedJobId, { handedOff, shuttingDown });', '');
  const r = await scenarioBotOn({ botSrc });
  assert.throws(() => checkBotOn(r));
});

test('mutation M10: ไม่เช็ค bot-posted ก่อนโพสต์ → บัตรซ้ำข้าม instance → เทสกันซ้ำแดง', async () => {
  const mod = cardMutant('if (priorCard) {', 'if (false) {');
  const r = await scenarioDedupe({ mod });
  assert.throws(() => checkDedupe(r), /ซ้ำ/u);
});

test('mutation M11: index.js ไม่แยกลิงก์ (ตัด applySourceUrls) → เทสเส้นทางจริงแดง', async () => {
  const botSrc = mutate(BOT_SRC, '    research.applySourceUrls(payload, content);', '');
  const r = await scenarioBotOn({ botSrc });
  assert.throws(() => checkBotOn(r), /ตัดออกจาก input/u);
});

test('mutation M12: จอดบัตรแล้วเลิกตามทันทีที่งานจบ (ข้าม afterJob ที่ต่อคิว) → เทส race แดง', async () => {
  const mod = cardMutant("if (state.resultChecked) endWatch(state, 'card');", "endWatch(state, 'card');");
  const r = await scenarioRaceCardWhileJobEnds({ mod });
  assert.throws(() => checkRace(r), /ผลข่าวหาย/u);
});

test('mutation M13 (r2): pickCardRecord ไม่อ่านคีย์ "cards" (บั๊กที่ผู้ตรวจจับ) → สัญญาเลน B แดงทุกระดับ (ฟังก์ชัน · ตัวควบคุม · จบงาน · เส้นทางจริง)', async () => {
  const cardSrc = mutate(CARD_SRC, "for (const key of ['card', 'cards', 'item', 'record', 'researchCard', 'data', 'result']) {",
    "for (const key of ['card', 'item', 'record', 'researchCard', 'data', 'result']) {");
  const mod = loadCardModule(cardSrc);
  assert.throws(() => checkLaneBContract(mod), /อ่านแถวการ์ดออก/u);
  const during = await scenarioLaneB({ mod });
  assert.equal(during.reason, 'tail_done', 'อ่านไม่ออก = ถามจนหมดหางโดยไม่มีบัตร');
  assert.throws(() => checkLaneB(during), /ระหว่างรองาน/u);
  const ends = await scenarioLaneBEnds({ mod });
  assert.equal(ends.failed.reason, 'request_failed', 'อ่านแถว failed ไม่ออก = เห็นแค่ใบขอ failed แล้วเลิกตามเงียบ');
  assert.throws(() => checkLaneBEnds(ends), /บัตรสีเทา/u);
  const e2e = await scenarioBotOn({ cardSrc, cards: LANE_B_AT_SECOND_POLL });
  assert.throws(() => checkBotOn(e2e));
});

test('mutation M14 (r2): ไม่อ่าน request.status ในคำตอบเลน B → ใบขอหมดอายุแล้วยังถามต่อจนหมดหาง → เทสจบงานของเลน B แดง', async () => {
  const mod = cardMutant("const requestStatus = String(body?.request?.status ?? body?.requestStatus ?? '');",
    "const requestStatus = String(body?.requestStatus ?? '');");
  const r = await scenarioLaneBEnds({ mod });
  assert.equal(r.expired.reason, 'tail_done');
  assert.throws(() => checkLaneBEnds(r), /หมดอายุ/u);
});

// ── r3: กลายพันธุ์ของข้อตัดสินผู้คุมงาน (ทุกข้อ patch ซอร์สจริงแบบต้องเจอข้อความต้นทาง แล้วข้อยืนยันชุดเดียวกับเทสหลักต้องแดง) ──
test('mutation M15 (r3 · #7): บอทกลับไปส่ง x-research-secret → เทส header แดง', async () => {
  const mod = cardMutant('const apiHeaders = () => ({ ...options.buildApiHeaders() });',
    "const apiHeaders = () => ({ ...options.buildApiHeaders(), ...(workerSecretOnBot ? { 'x-research-secret': str(env.RESEARCH_AGENT_SECRET) } : {}) });");
  const runs = await scenarioHeaders({ mod });
  assert.throws(() => checkHeaders(runs), /x-research-secret/u);
});

test('mutation M16 (r3 · #8): ไม่เช็ค enabled:false → ถามวนจนหมดหาง (และโพสต์การ์ดค้างทั้งที่เว็บปิด) → เทสเว็บปิดสวิตช์แดง', async () => {
  const mod = cardMutant("    if (body && body.enabled === false) return { kind: 'stop', reason: 'disabled' };\n", '');
  const r = await scenarioWebDisabled({ mod });
  assert.equal(r.disabled.reason, 'tail_done', 'กลายพันธุ์ต้องทำให้ถามจนหมดหางจริง');
  assert.equal(r.doneButDisabled.cardReplies.length, 1, 'กลายพันธุ์ต้องทำให้โพสต์การ์ดค้างจริง');
  assert.throws(() => checkWebDisabled(r), /เลิกตาม/u);
});

test('mutation M17 (r3 · #9): raw_corrections ใช้ source_name (นอกสัญญา) เป็นป้ายลิงก์ → เทสชื่อโดเมนแดง', () => {
  const mod = cardMutant('${link ? ` (${hostLink(link)})` : \'\'}', '${link ? ` (${mdLink(fix.source_name, link)})` : \'\'}');
  assert.throws(() => checkCorrectionDomain(mod), /ชื่อโดเมน/u);
});

test('mutation M18 (r3): หางกลับเป็น 10 นาที → เทสหาง 15 นาทีแดง', async () => {
  const mod = cardMutant('const TAIL_MS = 15 * 60 * 1000;', 'const TAIL_MS = 10 * 60 * 1000;');
  const r = await scenarioTail({ mod });
  assert.equal(r.reason, 'tail_done');
  assert.throws(() => checkTail(r), /รอบสุดท้ายต้องเลย 10 นาที/u);
});

test('mutation M19 (r3 · 15% พอดี): เกณฑ์เตือนโควตาเป็น < แทน ≤ → เหลือ 15% พอดีไม่เตือน → เทสขอบ 15% แดง', async () => {
  const mod = cardMutant('if (!low && !(hasPct && pct <= quotaAlertPct)) return false;', 'if (!low && !(hasPct && pct < quotaAlertPct)) return false;');
  const r = await scenarioQuotaBoundary({ mod });
  assert.equal(r.day1, 0, 'กลายพันธุ์ต้องทำให้ 15% ไม่เตือนจริง');
  assert.throws(() => checkQuotaBoundary(r), /15% พอดี/u);
});

test('mutation M20 (r3): เพดาน resultMsgIds ของบอทเกินที่ route รับ (60 > 50) → route ตอบ 400 ผลข่าวหายจาก bot-posted → เทสบอท↔route แดง', async () => {
  const mod = cardMutant('const MAX_RESULT_MSG_IDS = 50;', 'const MAX_RESULT_MSG_IDS = 60;');
  const r = await scenarioManyResults({ mod });
  assert.equal(r.api.routeResponses.find((x) => x.method === 'post')?.status, 400, 'กลายพันธุ์ต้องโดน route ปฏิเสธจริง');
  assert.throws(() => checkManyResults(r), /route ต้องรับ/u);
});

test('mutation M21 (r3 · #4): route ไม่ส่ง caseId ต่อให้ store เลน B → เทสสัญญา route แดง', async () => {
  const src = mutate(ROUTE_SRC, "const OPTIONAL_ID_KEYS = ['sourceMessageId', 'processingMsgId', 'caseId', 'researchCardMsgId'];",
    "const OPTIONAL_ID_KEYS = ['sourceMessageId', 'processingMsgId', 'researchCardMsgId'];");
  const x = await scenarioRouteContract({ src });
  assert.throws(() => checkRouteContract(x), /ส่งต่อ saveBotPosted/u);
});

test('mutation M22 (r3 · #4): route ตอบสำเร็จโดยไม่เรียก saveBotPosted ของเลน B → เทสสัญญา route + ต่อสายถึง route แดง', async () => {
  const src = mutate(ROUTE_SRC, 'const item = await storage.saveBotPosted(checked.input);', 'const item = { id: checked.input.jobId, ...checked.input };');
  const x = await scenarioRouteContract({ src });
  assert.throws(() => checkRouteContract(x), /ส่งต่อ saveBotPosted/u);
  const r = await runBotScenario({ env: ON, cards: LANE_B_AT_SECOND_POLL, routeSrc: src });
  assert.equal(r.store.doc(JOB), null, 'กลายพันธุ์ต้องทำให้ไม่มีแถวจริง');
  assert.throws(() => checkBotRouteE2E(r));
});

test('mutation M23 (r3): route ไม่แยกที่เก็บล่ม (503) ออกจาก error อื่น → เทส error ของ route แดง', async () => {
  const src = mutate(ROUTE_SRC, "if (error?.errorType === 'RESEARCH_STORAGE_UNAVAILABLE') {", 'if (false) {');
  const x = await scenarioRouteErrors({ src });
  assert.throws(() => checkRouteErrors(x), /503/u);
});

test('mutation M24 (r3): route ไม่ fail-closed ตอนไม่ตั้ง DISCORD_API_SECRET → เทสยืนยันตัวตนแดง', async () => {
  const src = mutate(ROUTE_SRC, '  if (!expected) {\n    return fail(403,', '  if (false) {\n    return fail(403,');
  await assert.rejects(checkRouteAuth(src), /fail-closed/u);
});

// ============================================================
// 6) ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 4 + สัญญา 8.1/8.2 · เลน W2) — ใบที่สอง "ผลบรรณาธิการเรียบเรียง"
// ------------------------------------------------------------
// ระเบียน editor = สัญญา 8.1 (W1 เป็นเจ้าของ: store research-editor · ช่อง editor ใน GET /api/research/cards · analysisResult.researchAgent.editor)
//   ฟิกซ์เจอร์ = ตัวอย่างในสัญญา 8.1 ตรงตัว (+ลิงก์จริงรูปแบบเดียวกัน) · คำตอบการ์ด = คำตอบจริงของเลน B (LANE_B_CARDS) + mode:'write' + ช่อง editor
//   ยังไม่ได้จับจาก handler ของ W1 (คนละ worktree · ห้าม import ข้าม) → รวมเลนแล้วต้องจับคำตอบจริงมาแทน (แบบ r2 ของเลน B)
// ผลข่าวจากคิว = รูปจริงที่จับจาก C:\tmp\research-agent-lab\e2e\hook-response.json (1 ต.ค. 69 · /api/auto/process ตัวจริง โหมด shadow):
//   analysisResult อยู่ทั้งบนสุดและใต้ data · researchAgent = {status, mode, cardsCount, flags} (+ editor เฉพาะโหมด write ตามสัญญา 8.1)
// byte-parity ของโหมดอื่น (สวิตช์เปิด · shadow/assist): ลายนิ้วมือ sha256 ของบันทึกการกระทำทั้งหมดต้องตรงกับที่จับจากโค้ดเฟส 1
//   (827336d7 ก่อนแก้ W2 · 1 ต.ค. 69) ทุกไบต์ — ทางปกติ + ทางกู้หลังรีสตาร์ต + การ์ดมาช้าในหาง · และตรงกับฉบับถอดจุดเรียก W2 ใน index.js
//   (เปลี่ยนตัวช่วยเทส makeWorld/makeApi/runBotScenario = ต้องจับลายนิ้วมือใหม่จากโค้ดเฟส 1 — ไม่ใช่แก้ให้ตรงโค้ดใหม่)
// ============================================================
const EDITOR_TITLES = RC.constants.EDITOR_TITLES;
const LIVE_CARD_TITLE = RC.constants.CARD_TITLE;

function resultWithResearch(researchAgent) {
  const r = RESULT();
  r.data.analysisResult.researchAgent = clone(researchAgent);
  r.analysisResult = clone(r.data.analysisResult);
  return r;
}
const jobWithResearch = (researchAgent) => [
  ...Array.from({ length: 15 }, PROCESSING),
  { success: true, status: 'completed', result: resultWithResearch(researchAgent) },
];

// แถว research-cards โหมด write (สัญญา 2.2 + 8.3) — ต้นทางพบ · R1–R3 มีแหล่ง (ใบที่สองทำลิงก์ R# จากตรงนี้) · R3 มี quote
function cardWrite() {
  const base = cardDone();
  return {
    ...base,
    mode: 'write',
    origin_post: { url: 'https://www.youtube.com/watch?v=tthk2709', source_name: 'ตีท้ายครัว', date: '2026-09-27', confidence: 0.92 },
    stale_news_warning: 'คลิปออกอากาศ 27 ก.ย. 69 ก่อนวันส่งข่าว 4 วัน',
    flags: ['STALE_NEWS'],
    cards: [
      { id: 'R1', claim: 'สามพี่น้องชื่อจริง สมชาย สมหญิง สมศรี ตามที่ออกรายการ', value_type: 'ตัวตน', why_it_adds_value: 'ชื่อจริงจากแหล่ง',
        evidence_quote: 'สามพี่น้อง สมชาย สมหญิง และสมศรี ออกรายการตีท้ายครัว', source_url: 'https://www.thairath.co.th/entertain/news/2800001',
        source_name: 'ไทยรัฐ', source_date: '2026-09-28', confidence: 0.92, contradicts_raw: false, identity: 'verified', gate: 'pass' },
      { id: 'R2', claim: 'บ้านราคา 18 ล้านบาท ตกแต่งเพิ่ม 3 ล้านบาท', value_type: 'ตัวเลข-บริบท', why_it_adds_value: 'ตัวเลขจริงแทนตัวเลขกลม',
        evidence_quote: 'บ้านหลังนี้ราคา 18 ล้าน ตกแต่งเพิ่มอีก 3 ล้าน', source_url: 'https://www.kapook.com/news/123', source_name: 'kapook',
        source_date: '2026-09-28', confidence: 0.9, contradicts_raw: true, identity: 'generic', gate: 'pass' },
      { id: 'R3', claim: 'ครอบครัวอยู่บ้านหลังนี้มา 5 ปีแล้ว', value_type: 'อื่นๆ', why_it_adds_value: 'แก้น้ำเสียง "ซื้อใหม่" ให้ตรงความจริง',
        evidence_quote: 'อยู่บ้านหลังนี้มาได้ 5 ปีแล้วค่ะ', source_url: 'https://www.youtube.com/watch?v=tthk2709', source_name: 'ตีท้ายครัว',
        source_date: '2026-09-27', confidence: 0.88, contradicts_raw: false, identity: 'generic', gate: 'pass',
        quote: { text: 'อยู่บ้านหลังนี้มาได้ 5 ปีแล้วค่ะ', speaker: 'สมหญิง', speaker_confidence: 0.93 } },
    ],
    raw_corrections: [{ field: 'ราคาบ้าน', raw_value: '20 ล้าน', source_value: '18+3 ล้าน', source_url: 'https://www.kapook.com/news/123', confidence: 0.9 }],
    suggested_dimensions: ['มุมพี่น้องช่วยกันผ่อนบ้าน'],
  };
}

// ระเบียน editor = ตัวอย่างในสัญญา 8.1 ตรงตัว (ลิงก์จริงรูปแบบเดียวกัน)
function editorDone() {
  return {
    id: JOB, status: 'done', mode: 'write',
    used_cards: ['R1', 'R3'],
    corrections: [{ field: 'ราคาบ้าน', from: '20 ล้าน', to: '18+3 ล้าน', source_url: 'https://www.kapook.com/news/123', source_name: 'kapook', card: 'R2' }],
    additions: [{ text: 'ชื่อจริงสามพี่น้อง สมชาย สมหญิง สมศรี', card: 'R1' }, { text: 'อยู่บ้านหลังนี้มา 5 ปี', card: 'R3' }],
    not_used: [{ card: 'R4', why: 'มั่นใจ 0.7 ต่ำกว่าเกณฑ์' }],
    suggested_dimensions: ['มุมพี่น้องช่วยกันผ่อนบ้าน'],
    staff_notes: ['วันจริงของคลิป: 27 ก.ย. 69 (ตีท้ายครัว)'],
    warnings: ['ตัดประโยคที่ตัวเลขไม่พบในแหล่ง 1 ประโยค'],
    flags: ['STALE_NEWS'],
    original_chars: 812, enriched_chars: 1310, ratio: 1.61,
    waitedMs: 48000, editorMs: 21000, model: 'claude-opus-5-5/medium',
    reason: '', updatedAt: '2026-10-01T03:05:00.000Z',
  };
}
const editorOf = (status, extra = {}) => ({
  id: JOB, status, mode: 'write', used_cards: [], corrections: [], additions: [], not_used: [], suggested_dimensions: [], staff_notes: [],
  warnings: [], flags: [], original_chars: 812, enriched_chars: 812, ratio: 1, waitedMs: 0, editorMs: 0, model: 'claude-opus-5-5/medium',
  reason: '', updatedAt: '2026-10-01T03:05:00.000Z', ...extra,
});

// คำตอบ GET /api/research/cards ตามสัญญา 8.1 — คำตอบจริงของเลน B + mode:'write' + ช่อง editor (null = ยังไม่มี)
function laneW1(name, editor = null) {
  const body = laneB(name);
  body.mode = 'write';
  if (body.cards) body.cards = cardWrite();
  body.editor = editor ? clone(editor) : null;
  return body;
}

const repliesTitled = (msg, title) => msg.replies.filter((p) => p && typeof p === 'object' && (p.embeds || []).some((e) => e.data?.title === title));
const messageTitled = (world, sourceId, title) => [...world.messages.values()]
  .find((m) => m.reference?.messageId === sourceId && m.embeds.some((e) => e.title === title));
const replyTitles = (msg) => msg.replies.map((p) => (typeof p === 'string' ? 'text' : String(p?.embeds?.[0]?.data?.title ?? p?.content ?? '')));
const descLines = (view) => view.description.split('\n');

// ── 6.1 หน้าตาใบที่สอง (pure) ──
function checkEditorDoneView(v) {
  assert.equal(v.title, '🧾 รีเสิร์ชเข้าเนื้อแล้ว — สิ่งที่เพิ่ม/แก้จากต้นฉบับ', 'หัว done ตามสัญญา 8.2 ตรงตัว');
  assert.deepEqual(descLines(v), [
    '❗ แก้: ราคาบ้าน: 20 ล้าน → 18+3 ล้าน · [kapook](https://www.kapook.com/news/123)',
    '➕ เพิ่ม: ชื่อจริงสามพี่น้อง สมชาย สมหญิง สมศรี (R1 [ไทยรัฐ](https://www.thairath.co.th/entertain/news/2800001))',
    '➕ เพิ่ม: อยู่บ้านหลังนี้มา 5 ปี (R3 [ตีท้ายครัว](https://www.youtube.com/watch?v=tthk2709))',
    '🧭 มุมเสนอ: มุมพี่น้องช่วยกันผ่อนบ้าน',
    '🗒️ หมายเหตุ: วันจริงของคลิป: 27 ก.ย. 69 (ตีท้ายครัว)',
    '⚠️ ธง: ข่าวเก่า · ตัดประโยคที่ตัวเลขไม่พบในแหล่ง 1 ประโยค',
    '🚫 ไม่ได้ใช้: R4 (มั่นใจ 0.7 ต่ำกว่าเกณฑ์)',
    '🔗 ต้นทาง: [ตีท้ายครัว](https://www.youtube.com/watch?v=tthk2709) · 2026-09-27',
  ], 'ลำดับตามสัญญา 8.2: ❗แก้ · ➕เพิ่ม · 🧭มุมเสนอ · 🗒️หมายเหตุ · ⚠️ธง/warnings · 🚫ไม่ได้ใช้ + ลิงก์ต้นทาง');
  assert.equal(v.footer, `jobId: ${JOB} · ใช้การ์ด R1 R3 · ยาว 1.61 เท่าของต้นฉบับ · รอการ์ด 48 วิ · เรียบเรียง 21 วิ · claude-opus-5-5/medium · กด 👍/👎 ให้คะแนนใบนี้`);
  assert.equal(v.color, '#ef4444', 'มีจุดแก้ตามแหล่ง = สีแดง');
  assert.equal(v.reactable, true);
  assert.equal(v.mainLines, 7);
}

test('ใบที่สอง (W2) renderEditorCard done: หัวตามสัญญา · ❗แก้ (field: from → to · แหล่ง) · ➕เพิ่ม + ลิงก์ R# จากบัตรใบแรก · 🧭 · 🗒️ · ⚠️ · 🚫 · 🔗 ต้นทาง · 👍/👎 · pure', () => {
  const record = editorDone();
  const ctx = { jobId: JOB, cards: cardWrite() };
  const before = clone(record);
  const v = RC.renderEditorCard(record, ctx);
  checkEditorDoneView(v);
  assert.equal(v.kind, 'editor');
  assert.equal(v.status, 'done');
  assert.deepEqual(record, before, 'ไม่แก้ระเบียนที่รับมา');
  assert.deepEqual(RC.renderEditorCard(record, ctx), v, 'pure: ข้อมูลเดิม = ผลเดิม');
  const noCtx = RC.renderEditorCard(record, { jobId: JOB });
  assert.ok(descLines(noCtx).includes('➕ เพิ่ม: ชื่อจริงสามพี่น้อง สมชาย สมหญิง สมศรี (R1)'), 'ไม่รู้แถวการ์ด = แสดงรหัส R# ไม่มีลิงก์');
  assert.ok(!noCtx.description.includes('🔗'), 'ไม่รู้ต้นทาง = ไม่มีบรรทัดลิงก์ต้นทาง');
  const { embed, view } = RC.buildEditorEmbed(FakeEmbed, record, ctx);
  assert.deepEqual(embed.data, { color: view.color, title: view.title, description: view.description, footer: { text: view.footer } });
  assert.equal(RC.renderEditorCard({ ...record, corrections: [] }, ctx).color, '#3b82f6', 'ไม่มีจุดแก้ = สีน้ำเงิน');
  assert.deepEqual(descLines(RC.renderEditorCard(editorOf('done'), ctx)), [
    '_ไม่มีรายการเพิ่ม/แก้ที่บันทึกไว้ — ดูเนื้อข่าวด้านบน_',
    '🔗 ต้นทาง: [ตีท้ายครัว](https://www.youtube.com/watch?v=tthk2709) · 2026-09-27',
  ]);
});

test('ใบที่สอง (W2) renderEditorCard not_ready/failed/skipped: หัวตามสัญญา 8.2 ตรงตัว · บรรทัดสถานะ/เหตุ · ⚠️ ธง · สีเหลือง/เทา · ไม่ติด 👍/👎', () => {
  assert.deepEqual({ ...EDITOR_TITLES }, {
    done: '🧾 รีเสิร์ชเข้าเนื้อแล้ว — สิ่งที่เพิ่ม/แก้จากต้นฉบับ',
    not_ready: '⏳ รีเสิร์ชไม่ทัน — ข่าวนี้เขียนจากต้นฉบับ',
    failed: '⚠️ บรรณาธิการล้ม — ใช้ต้นฉบับ',
    skipped: 'ℹ️ ไม่มีข้อมูลผ่านเกณฑ์ — ใช้ต้นฉบับ',
  });
  const nr = RC.renderEditorCard(editorOf('not_ready', { waitedMs: 300000 }), { jobId: JOB });
  assert.equal(nr.title, EDITOR_TITLES.not_ready);
  assert.deepEqual(descLines(nr), ['⏳ รอการ์ด 5 นาที แล้วยังไม่มา — นักเขียนใช้ต้นฉบับของพนักงาน · บัตรข้อเท็จจริงจะขึ้นตามมาเมื่อเอเจนต์ส่งผล']);
  assert.equal(nr.footer, `jobId: ${JOB} · claude-opus-5-5/medium`);
  assert.deepEqual([nr.color, nr.reactable], ['#f59e0b', false]);
  const failed = RC.renderEditorCard(editorOf('failed', { reason: 'ด่านเชิงกลตัดเกิน 30% ของส่วนเพิ่ม', warnings: ['ตัดประโยค 4 ใน 10'], waitedMs: 52000, editorMs: 31000 }), { jobId: JOB });
  assert.equal(failed.title, EDITOR_TITLES.failed);
  assert.deepEqual(descLines(failed), ['เหตุ: ด่านเชิงกลตัดเกิน 30% ของส่วนเพิ่ม — นักเขียนใช้ต้นฉบับของพนักงาน', '⚠️ ธง: ตัดประโยค 4 ใน 10']);
  assert.equal(failed.footer, `jobId: ${JOB} · รอการ์ด 52 วิ · เรียบเรียง 31 วิ · claude-opus-5-5/medium`);
  assert.deepEqual([failed.color, failed.reactable], ['#6b7280', false]);
  const skipped = RC.renderEditorCard(editorOf('skipped', { flags: ['ORIGIN_NOT_FOUND'] }), { jobId: JOB });
  assert.equal(skipped.title, EDITOR_TITLES.skipped);
  assert.deepEqual(descLines(skipped), ['เหตุ: ไม่มีการ์ดที่ผ่านเกณฑ์เข้าเนื้อข่าว — นักเขียนใช้ต้นฉบับของพนักงาน', '⚠️ ธง: ยืนยันต้นทางไม่ได้']);
  assert.deepEqual([skipped.color, skipped.reactable], ['#6b7280', false]);
  assert.equal(RC.renderEditorCard({ status: 'weird' }, { jobId: JOB }).title, EDITOR_TITLES.failed, 'สถานะไม่รู้จัก = แสดงแบบล้ม (ปลอดภัยไว้ก่อน)');
  assert.ok(RC.renderEditorCard(null, {}).footer.startsWith('jobId: unknown'));
});

function checkEditorCap(mod = RC) {
  const rec = editorOf('done', {
    corrections: Array.from({ length: 10 }, (_, i) => ({ field: `ช่อง${i}`, from: `${i}`, to: `${i + 1}`, source_url: `https://n.example/${i}`, source_name: `แหล่ง${i}` })),
    additions: Array.from({ length: 10 }, (_, i) => ({ text: `เพิ่ม${i}`, card: 'R1' })),
    suggested_dimensions: ['มุม 1', 'มุม 2', 'มุม 3'],
    staff_notes: ['โน้ต 1', 'โน้ต 2', 'โน้ต 3', 'โน้ต 4', 'โน้ต 5'],
    warnings: ['เตือน 1', 'เตือน 2'],
    flags: ['STALE_NEWS', 'ORIGIN_NOT_FOUND', 'RAW_CONTRADICTION'],
    not_used: Array.from({ length: 6 }, (_, i) => ({ card: `R${i + 4}`, why: 'ต่ำกว่าเกณฑ์' })),
  });
  const v = mod.renderEditorCard(rec, { jobId: JOB, cards: cardWrite() });
  const main = descLines(v).filter((l) => !l.startsWith('🔗 '));
  assert.equal(main.length, 8, `บรรทัดหลักต้องไม่เกิน 8 (ได้ ${main.length})`);
  assert.equal(v.mainLines, 8);
  assert.deepEqual(main, [
    '❗ แก้: ช่อง0: 0 → 1 · [แหล่ง0](https://n.example/0)',
    '❗ แก้: ช่อง1: 1 → 2 · [แหล่ง1](https://n.example/1)',
    '❗ แก้: ช่อง2: 2 → 3 · [แหล่ง2](https://n.example/2)',
    '… (+17 รายการ)',
    '🧭 มุมเสนอ: มุม 1 · มุม 2 · มุม 3',
    '🗒️ หมายเหตุ: โน้ต 1 · โน้ต 2 · โน้ต 3 (+2)',
    '⚠️ ธง: ข่าวเก่า · ยืนยันต้นทางไม่ได้ · ต้นฉบับขัดกับแหล่ง · เตือน 1 (+1)',
    '🚫 ไม่ได้ใช้: R4 (ต่ำกว่าเกณฑ์) · R5 (ต่ำกว่าเกณฑ์) · R6 (ต่ำกว่าเกณฑ์) (+3)',
  ], '❗ ก่อน ➕ · เกินที่เหลือสรุปบรรทัดเดียว · บรรทัดคงที่ครบ');
  const withHead = mod.renderEditorCard({ ...rec, status: 'not_ready', waitedMs: 300000 }, { jobId: JOB });
  assert.equal(withHead.mainLines, 8, 'มีบรรทัดสถานะ = ❗/➕ เหลือน้อยลง แต่รวมยังไม่เกิน 8');
  assert.equal(descLines(withHead)[3], '… (+18 รายการ)');
}

test('ใบที่สอง (W2): ≤ 8 บรรทัดหลัก (สเปก 8.2) — รายการเกิน = สรุป "… (+N รายการ)" · บรรทัดคงที่ไม่หาย · + ลิงก์ต้นทางไม่นับ', () => checkEditorCap());

function evilEditor() {
  return editorOf('done', {
    corrections: [{ field: '**ด่วน**', from: '[คลิกเลย](https://evil.example/phish)', to: '<@123456789012345678>', source_url: 'javascript:alert(1)', source_name: 'แหล่ง](https://evil.example)' }],
    additions: [{ text: '||สปอยล์|| @everyone', card: 'R1](https://evil.example)' }],
    suggested_dimensions: ['[x](https://evil.example)'],
    staff_notes: ['`โค้ด` ~~ขีด~~'],
    warnings: ['<#123456789012345678>'],
    flags: ['bad flag!', 'NEW_FLAG_X'],
    not_used: [{ card: '**R9**', why: '[y](https://evil.example)' }],
    model: '[m](https://evil.example)',
  });
}

function checkEditorIsData(v) {
  const all = `${v.description}\n${v.footer}`;
  assert.ok(!/(^|[^\\])\[คลิกเลย\]\(https:\/\/evil/u.test(all), 'masked link จากเนื้อ editor ต้องถูก escape');
  assert.ok(all.includes('\\[คลิกเลย\\](https://evil.example/phish)'));
  assert.ok(all.includes('\\*\\*ด่วน\\*\\*'));
  assert.ok(all.includes('\\<@123456789012345678\\>'));
  assert.ok(all.includes('\\|\\|สปอยล์\\|\\|'));
  assert.ok(all.includes('\\<#123456789012345678\\>'));
  assert.ok(!all.includes('javascript:'), 'ลิงก์ที่ไม่ใช่ http(s) ห้ามโผล่');
  assert.ok(all.includes('· แหล่ง\\](https://evil.example)'), 'ชื่อแหล่งที่พยายามปิดวงเล็บต้องถูก escape และไม่มีลิงก์');
  assert.ok(!all.includes('bad flag'), 'ธงรูปแปลกไม่แสดง');
  assert.ok(all.includes('NEW\\_FLAG\\_X'));
  assert.ok(all.includes('\\[m\\](https://evil.example)'), 'ชื่อโมเดลท้ายใบก็เป็น DATA');
}

test('ใบที่สอง (W2) = DATA: escape markdown/mention/masked link ทุกช่อง · ลิงก์ javascript: ไม่ทำลิงก์ · ข้อมูลยาวผิดปกติอยู่ในเพดาน embed ของ Discord', () => {
  checkEditorIsData(RC.renderEditorCard(evilEditor(), { jobId: JOB }));
  const huge = editorOf('done', {
    corrections: Array.from({ length: 8 }, () => ({ field: 'ฟ'.repeat(500), from: 'ก'.repeat(3000), to: 'ข'.repeat(3000), source_url: `https://e.example/${'p'.repeat(1500)}`, source_name: 'ง'.repeat(400) })),
    suggested_dimensions: Array.from({ length: 9 }, () => 'ม'.repeat(900)),
    staff_notes: ['น'.repeat(5000)], warnings: ['ว'.repeat(5000)], not_used: [{ card: 'R1', why: 'ย'.repeat(5000) }],
    model: 'm'.repeat(500), used_cards: Array.from({ length: 30 }, (_, i) => `R${i}`),
  });
  const hv = RC.renderEditorCard(huge, { jobId: JOB, cards: cardWrite() });
  assert.ok(hv.title.length <= 256);
  assert.ok(hv.description.length >= 1 && hv.description.length <= 4096, `description ${hv.description.length}`);
  assert.ok(hv.footer.length >= 1 && hv.footer.length <= 2048);
  assert.ok(hv.footer.startsWith(`jobId: ${JOB}`), 'ท้ายใบต้องมี jobId เสมอ (กด 👍👎 หลังรีสตาร์ต)');
  assert.ok(hv.title.length + hv.description.length + hv.footer.length <= 6000);
  assert.ok(!/\]\(https:\/\/e\.example\/p{600}/u.test(hv.description), 'ลิงก์ยาวเกินห้ามทำเป็น markdown link');
  assert.ok(hv.mainLines <= 8);
});

test('ใบที่สอง (W2): pickEditorRecord (ช่อง editor ระดับบน · ทนรูปใต้ cards) · researchAgentOfResult (บนสุด/ใต้ data) · editorJobIdFromMessage (หัว 4 แบบ + jobId ท้ายใบ)', () => {
  const ed = editorDone();
  assert.equal(RC.pickEditorRecord({ success: true, editor: ed }), ed);
  assert.equal(RC.pickEditorRecord({ success: true, cards: { status: 'done', editor: ed } }), ed);
  assert.equal(RC.pickEditorRecord(laneW1('done', ed))?.status, 'done');
  for (const body of [laneW1('done'), laneB('done'), { success: true, editor: { status: 'weird' } }, { success: false, editor: ed }, { success: true, editor: [ed] }, null, 'x']) {
    assert.equal(RC.pickEditorRecord(body), null, JSON.stringify(body)?.slice(0, 60));
  }
  const ra = { status: 'done', mode: 'write', editor: ed };
  assert.equal(RC.researchAgentOfResult({ analysisResult: { researchAgent: ra } }), ra);
  assert.equal(RC.researchAgentOfResult({ data: { analysisResult: { researchAgent: ra } } }), ra);
  assert.equal(RC.researchAgentOfResult(resultWithResearch(ra)).editor.status, 'done');
  for (const data of [RESULT(), {}, null, { analysisResult: { researchAgent: 'x' } }]) assert.equal(RC.researchAgentOfResult(data), null);
  for (const title of Object.values(EDITOR_TITLES)) {
    assert.equal(RC.editorJobIdFromMessage({ embeds: [{ title, footer: { text: `jobId: ${JOB} · ใช้การ์ด R1` } }] }), JOB, title);
  }
  assert.equal(RC.editorJobIdFromMessage({ embeds: [{ title: LIVE_CARD_TITLE, footer: { text: `jobId: ${JOB}` } }] }), null, 'บัตรใบแรกไม่ใช่ใบที่สอง');
  assert.equal(RC.jobIdFromCardMessage({ embeds: [{ title: EDITOR_TITLES.done, footer: { text: `jobId: ${JOB}` } }] }), null, 'ใบที่สองไม่ถูกนับเป็นบัตรใบแรก');
  assert.equal(RC.editorJobIdFromMessage({ embeds: [{ title: `${EDITOR_TITLES.done} ปลอม`, footer: { text: `jobId: ${JOB}` } }] }), null);
});

// ── 6.2 ตัวควบคุม: ทาง ก (ผลข่าวพก editor) ──
async function scenarioEditorFromResult({ mod = RC, note = true } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: (jobId, n) => laneW1(n >= 1 ? 'done' : 'pendingLeased') });
  const { ctl, logs } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  for (let i = 0; i < 2; i++) await settleWithin(sched.step(), `รอบถามที่ ${i + 1}`);
  const midJob = {
    cardGets: api.cardGets().length,
    factCards: repliesTitled(source, LIVE_CARD_TITLE).length,
    editorCards: repliesTitled(source, EDITOR_TITLES.done).length,
    pending: sched.pending(),
  };
  sched.advance(5 * SEC);
  const noted = note
    ? ctl.noteJobResult(JOB, resultWithResearch({ status: 'done', mode: 'write', cardsCount: 3, flags: ['STALE_NEWS'], editor: editorDone() }))
    : null;
  const resultIds = await postResultLikeBot(world, source, ack);
  const endedAt = sched.now();
  await settleWithin(ctl.jobEnded(JOB, {}), 'jobEnded');
  await drain(sched, 'หลังจบงาน');
  const reason = await settleWithin(done, 'การตามบัตรจบ');
  return { world, api, sched, ctl, source, ack, logs, noted, resultIds, endedAt, midJob, reason };
}

function checkEditorFromResult(r) {
  assert.equal(r.noted, 'done', 'noteJobResult จำ editor จากผลข่าว (ทาง ก)');
  assert.deepEqual(r.midJob, { cardGets: 2, factCards: 1, editorCards: 0, pending: 1 }, 'ระหว่างรองาน: บัตรใบแรกขึ้นตามเดิมแล้วจอด (ไม่ถามเพิ่ม)');
  assert.deepEqual(replyTitles(r.source), [LIVE_CARD_TITLE, '[A1] ลุงสามล้อ', '[A2] ลุงสามล้อ', '📄 เขียนจากเนื้อต้นฉบับอย่างเดียว', EDITOR_TITLES.done],
    'ใบที่สองขึ้นต่อท้ายผลข่าว (ใต้ข้อความพนักงานเดิม)');
  const editorReply = r.source.replies.at(-1);
  assert.deepEqual(editorReply.allowedMentions, { parse: [], repliedUser: false }, 'ใบที่สองห้าม mention ใคร');
  const data = editorReply.embeds[0].data;
  checkEditorDoneView({ ...data, footer: data.footer.text, reactable: true, mainLines: 7 });
  const editorMsg = messageTitled(r.world, r.source.id, EDITOR_TITLES.done);
  const cardMsg = messageTitled(r.world, r.source.id, LIVE_CARD_TITLE);
  assert.deepEqual(editorMsg.reactions, ['👍', '👎'], 'done = ติด 👍/👎 แบบใบแรก');
  const writes = r.api.postedWrites();
  assert.equal(writes.length, 3, 'จดบัตร → จดผลข่าว → จดใบที่สอง');
  assert.deepEqual(writes[2].body, {
    jobId: JOB, channelId: 'CH1', sourceMessageId: r.source.id, processingMsgId: r.ack.id, resultMsgIds: r.resultIds,
    postedAt: new Date(r.endedAt).toISOString(), caseId: '05268', researchCardMsgId: cardMsg.id, editorMsgId: editorMsg.id,
  }, 'bot-posted มี editorMsgId (กันโพสต์ซ้ำหลังรีสตาร์ต) + ช่องเดิมครบ');
  const postedGets = r.api.calls.filter((c) => c.method === 'get' && c.url === `${API}/api/bot/posted?jobId=${JOB}`);
  assert.equal(postedGets.length, 2, 'เช็ค bot-posted ก่อนโพสต์ทั้งสองใบ');
  assert.ok(r.api.calls.indexOf(postedGets[1]) < r.api.calls.indexOf(writes[2]));
  assert.equal(r.api.cardGets().length, 2, 'ทาง ก: ได้ใบที่สองจากผลข่าว — หลังจบงานไม่ต้องถามการ์ดเพิ่ม');
  assert.equal(r.reason, 'card');
  assert.equal(r.sched.pending(), 0, 'จบแล้วไม่ทิ้ง timer');
  assert.ok(r.logs.some((l) => l.includes(`โพสต์ใบที่สอง (ผลบรรณาธิการ) job ${JOB.slice(0, 12)} · done · 7 บรรทัด`)));
}

test('ใบที่สอง (W2) ทาง ก: ผลข่าวพก analysisResult.researchAgent.editor → noteJobResult → งานจบโพสต์ใบที่สองต่อท้ายผลข่าว + 👍👎 + bot-posted.editorMsgId · ไม่ถามการ์ดเพิ่ม', async () => {
  checkEditorFromResult(await scenarioEditorFromResult());
});

// ── 6.3 ตัวควบคุม: ทาง ข (ช่อง editor ของคำตอบการ์ด · ถามต่อในหาง) ──
async function scenarioEditorByPolling({ mod = RC, editorAt = 4 } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: (jobId, n) => laneW1(n >= 1 ? 'done' : 'pendingLeased', n >= editorAt ? editorDone() : null) });
  const { ctl } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  for (let i = 0; i < 2; i++) await settleWithin(sched.step(), `รอบถามที่ ${i + 1}`);
  sched.advance(5 * SEC);
  const noted = ctl.noteJobResult(JOB, resultWithResearch({ status: 'done', mode: 'write', cardsCount: 3, flags: [] }));
  await postResultLikeBot(world, source, ack);
  const endedAt = sched.now();
  await settleWithin(ctl.jobEnded(JOB, {}), 'jobEnded');
  await drain(sched, 'หาง');
  return { world, api, sched, source, noted, endedAt, reason: await settleWithin(done, 'การตามบัตรจบ') };
}

function checkEditorByPolling(r) {
  assert.equal(r.noted, null, 'ผลข่าวโหมด write ที่ไม่มี editor = ไม่มีอะไรจำ (ไปทางสำรอง)');
  const after = r.api.cardGets().map((c) => c.at - r.endedAt).filter((d) => d >= 0);
  assert.deepEqual(after, [0, 20 * SEC, 40 * SEC], 'ทาง ข: ถามทันทีตอนจบงาน แล้วทุก 20 วิจนช่อง editor มา (คำตอบที่ 5)');
  assert.equal(repliesTitled(r.source, EDITOR_TITLES.done).length, 1, 'ใบที่สองขึ้น 1 ครั้ง');
  assert.equal(repliesTitled(r.source, LIVE_CARD_TITLE).length, 1, 'บัตรใบแรกไม่ซ้ำ');
  assert.equal(r.reason, 'card');
  assert.equal(r.sched.pending(), 0);
}

test('ใบที่สอง (W2) ทาง ข: ผลข่าวไม่มี editor (โหมด write) → ถามการ์ดต่อทุก 20 วิหลังจบงานจนช่อง editor มา → โพสต์ใบที่สองแล้วเลิกตาม', async () => {
  checkEditorByPolling(await scenarioEditorByPolling());
});

test('ใบที่สอง (W2) ทาง ข หมดหาง: โหมด write แต่ editor ไม่มาเลย → ถามไม่เกิน 15 นาทีหลังจบงานแล้วเลิกเงียบ · บัตรใบแรกยังอยู่ ไม่มีใบที่สอง', async () => {
  const r = await scenarioEditorByPolling({ editorAt: Infinity });
  const after = r.api.cardGets().map((c) => c.at - r.endedAt).filter((d) => d >= 0);
  assert.equal(after[0], 0);
  assert.ok(after.every((d) => d < 15 * MIN), 'ถามได้ไม่เกิน 15 นาทีหลังจบงาน');
  assert.ok(after.at(-1) > 14 * MIN, 'ถามจนเกือบหมดหางจริง');
  assert.equal(after.length, 45, 'ถามทันที 1 + ทุก 20 วิอีก 44 รอบ (20s…880s)');
  assert.equal(r.reason, 'tail_done');
  assert.equal(repliesTitled(r.source, EDITOR_TITLES.done).length, 0);
  assert.equal(repliesTitled(r.source, LIVE_CARD_TITLE).length, 1);
  assert.equal(r.sched.pending(), 0);
});

test('ใบที่สอง (W2) not_ready ก่อนบัตรมา: ช่อง editor ระหว่างรองาน → ⏳ ขึ้นทันที (ไม่มี 👍👎) · ถามต่อจนบัตรใบแรกมา (การ์ดบัตรแบบเดิมเมื่อมา) · งานจบไม่โพสต์ซ้ำ', async () => {
  const notReady = editorOf('not_ready', { waitedMs: 300000, reason: 'รอการ์ดครบ 5 นาที' });
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: (jobId, n) => laneW1(n >= 3 ? 'done' : 'pendingLeased', n >= 1 ? notReady : null) });
  const { ctl } = makeCtl({ api, sched });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'รอบ 1');
  await settleWithin(sched.step(), 'รอบ 2 (editor not_ready)');
  const afterNotReady = replyTitles(source);
  await settleWithin(sched.step(), 'รอบ 3');
  await settleWithin(sched.step(), 'รอบ 4 (บัตรมา)');
  sched.advance(5 * SEC);
  assert.equal(ctl.noteJobResult(JOB, resultWithResearch({ status: 'not_ready', mode: 'write', cardsCount: 0, flags: [], editor: notReady })), 'not_ready');
  await postResultLikeBot(world, source, ack);
  await settleWithin(ctl.jobEnded(JOB, {}), 'jobEnded');
  await drain(sched, 'หาง');
  assert.equal(await settleWithin(done, 'จบ'), 'card');
  assert.deepEqual(afterNotReady, [EDITOR_TITLES.not_ready], '⏳ ขึ้นทันทีที่เห็นช่อง editor (ก่อนบัตรใบแรก)');
  assert.deepEqual(replyTitles(source), [EDITOR_TITLES.not_ready, LIVE_CARD_TITLE, '[A1] ลุงสามล้อ', '[A2] ลุงสามล้อ', '📄 เขียนจากเนื้อต้นฉบับอย่างเดียว']);
  assert.deepEqual(messageTitled(world, source.id, EDITOR_TITLES.not_ready).reactions, [], 'not_ready ไม่มีอะไรให้คะแนน');
  assert.equal(api.cardGets().length, 4, 'ได้ครบทั้งสองใบแล้ว งานจบไม่ถามเพิ่ม');
  assert.equal(sched.pending(), 0);
});

async function scenarioEditorDedupe({ mod = RC } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: (jobId, n) => laneW1(n >= 1 ? 'done' : 'pendingLeased') });
  api.posted.set(JOB, { jobId: JOB, channelId: 'CH1', editorMsgId: '1999999999999999998' });
  const { ctl, logs } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  for (let i = 0; i < 2; i++) await settleWithin(sched.step(), `รอบ ${i + 1}`);
  ctl.noteJobResult(JOB, resultWithResearch({ status: 'done', mode: 'write', cardsCount: 3, flags: [], editor: editorDone() }));
  await postResultLikeBot(world, source, ack);
  await settleWithin(ctl.jobEnded(JOB, {}), 'jobEnded');
  await drain(sched, 'หาง');
  return { world, api, sched, source, logs, reason: await settleWithin(done, 'จบ') };
}

function checkEditorDedupe(r) {
  assert.equal(repliesTitled(r.source, EDITOR_TITLES.done).length, 0, 'bot-posted มี editorMsgId แล้ว (instance อื่น/ก่อนรีสตาร์ต) → ห้ามโพสต์ใบที่สองซ้ำ');
  assert.equal(r.api.posted.get(JOB).editorMsgId, '1999999999999999998');
  assert.ok(r.logs.some((l) => l.includes('ใบที่สอง (ผลบรรณาธิการ) ของ job') && l.includes('โพสต์ไว้แล้ว')));
  assert.equal(r.api.cardGets().length, 2, 'รู้ว่าโพสต์แล้ว = เลิกตาม ไม่ถามต่อในหาง');
  assert.equal(r.reason, 'card');
  assert.equal(r.sched.pending(), 0);
}

test('ใบที่สอง (W2) กันโพสต์ซ้ำ: bot-posted.editorMsgId มีแล้ว → ไม่โพสต์ซ้ำ ไม่ถามต่อ · เว็บปิดสวิตช์ (enabled:false) แม้มีช่อง editor ค้าง → ไม่โพสต์', async () => {
  checkEditorDedupe(await scenarioEditorDedupe());
  const world = makeWorld();
  const sched = makeScheduler();
  const api = makeApi({ now: sched.now, cards: () => ({ ...laneW1('done', editorDone()), enabled: false }) });
  const { ctl } = makeCtl({ api, sched });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await settleWithin(sched.step(), 'รอบแรก (เว็บปิด)');
  assert.equal(await settleWithin(done, 'จบ'), 'disabled');
  assert.equal(source.replies.length, 0, 'สวิตช์เว็บเป็นตัวหลัก — ไม่โพสต์ทั้งสองใบ');
});

// ── 6.4 👍/👎 บนใบที่สอง → feedback เดิมติด kind:'editor' ──
async function scenarioEditorReactions({ mod = RC } = {}) {
  const r = await scenarioEditorFromResult({ mod });
  const editorMsg = messageTitled(r.world, r.source.id, EDITOR_TITLES.done);
  const cardMsg = messageTitled(r.world, r.source.id, LIVE_CARD_TITLE);
  const human = { id: STAFF_ID, bot: false };
  const react = (ctl, emoji, message, label) => settleWithin(ctl.handleReaction({ emoji: { name: emoji }, message }, human), label);
  const onEditor = await react(r.ctl, '👍', editorMsg, '👍 ใบที่สอง');
  const onCard = await react(r.ctl, '👎', cardMsg, '👎 ใบแรก');
  const fresh = makeCtl({ api: makeApi(), mod });
  const partialMsg = { id: editorMsg.id, partial: true, fetch: async () => editorMsg };
  const restarted = await settleWithin(fresh.ctl.handleReaction({ emoji: { name: '👎' }, partial: true, message: partialMsg, fetch: async () => ({ message: partialMsg }) }, human), 'หลังรีสตาร์ต');
  return { onEditor, onCard, restarted, bodies: r.api.feedbackPosts().map((c) => c.body), freshBodies: fresh.api.feedbackPosts().map((c) => c.body) };
}

function checkEditorReactions(x) {
  assert.deepEqual(x.onEditor, { ok: true, jobId: JOB, vote: 'up', userId: `discord-${STAFF_ID}`, kind: 'editor' });
  assert.deepEqual(x.onCard, { ok: true, jobId: JOB, vote: 'down', userId: `discord-${STAFF_ID}` }, 'ใบแรกผลเดิมทุกช่อง (ไม่มี kind)');
  assert.deepEqual(x.bodies, [
    { jobId: JOB, cardId: 'all', vote: 'up', userId: `discord-${STAFF_ID}`, kind: 'editor' },
    { jobId: JOB, cardId: 'all', vote: 'down', userId: `discord-${STAFF_ID}` },
  ], 'feedback ของใบที่สองลง /api/research/feedback เดิม (ช่อง research-cards.feedback) ติดป้าย kind:editor · ใบแรก body เดิม');
  assert.deepEqual(x.restarted, { ok: true, jobId: JOB, vote: 'down', userId: `discord-${STAFF_ID}`, kind: 'editor' }, 'หลังรีสตาร์ต: อ่านหัว+ท้ายใบที่สองได้');
  assert.deepEqual(x.freshBodies, [{ jobId: JOB, cardId: 'all', vote: 'down', userId: `discord-${STAFF_ID}`, kind: 'editor' }]);
}

test('ใบที่สอง (W2) 👍/👎 → /api/research/feedback เดิม ติด kind:"editor" (ไม่ทับคะแนนใบแรก) · ใบแรก body เดิม · หลังรีสตาร์ตรู้จากหัว+ท้ายใบ', async () => {
  checkEditorReactions(await scenarioEditorReactions());
});

// ── 6.5 ต่อสายจริง index.js (+ route /api/bot/posted ตัวจริง) ──
async function scenarioBotWrite({ botSrc = BOT_SRC, cardSrc = CARD_SRC, routeSrc = null } = {}) {
  return runBotScenario({
    botSrc, cardSrc, routeSrc, env: ON,
    cards: (jobId, n) => laneW1(n >= 1 ? 'done' : 'pendingQueued'),
    statuses: jobWithResearch({ status: 'done', mode: 'write', cardsCount: 3, flags: ['STALE_NEWS'], editor: editorDone() }),
  });
}

function checkBotWrite(r) {
  const titles = r.source.replies.map((p) => (typeof p === 'string' ? 'ack' : String(p.embeds?.[0]?.data?.title || '')));
  assert.deepEqual(titles, [
    'ack', LIVE_CARD_TITLE, '[[A1] เรื่องเล่าอบอุ่น] ลุงสามล้อ', '[[A2] ช่วยเหลือกัน] ลุงสามล้อ', '📄 เขียนจากเนื้อต้นฉบับอย่างเดียว', EDITOR_TITLES.done,
  ], 'โหมด write: บัตรใบแรก (ไม่มีป้ายทดลอง) ระหว่างรองาน → ผลข่าวครบ → ใบที่สองต่อท้าย');
  const editorMsg = messageTitled(r.world, r.source.id, EDITOR_TITLES.done);
  assert.ok(editorMsg, 'ต้องมีใบที่สองใต้ข้อความพนักงาน');
  assert.deepEqual(editorMsg.reactions, ['👍', '👎']);
  const row = r.store ? r.store.doc(JOB) : r.api.posted.get(JOB);
  assert.equal(row.editorMsgId, editorMsg.id, 'bot-posted ต้องมี editorMsgId');
  assert.equal(row.caseId, '05268');
  assert.equal(row.resultMsgIds.length, 3, 'ข้อความผลไม่รวมใบที่สอง');
  assert.ok(!row.resultMsgIds.includes(editorMsg.id));
  assert.equal(r.api.cardGets().length, 2, 'ทาง ก ผ่าน index.js จริง — ไม่ถามการ์ดหลังจบงาน');
  assert.equal(r.pending, 0, 'จบแล้วไม่ทิ้ง timer');
}

test('ใบที่สอง (W2) เส้นทางจริง index.js: pollJobUntilDone → noteJobResult(ผลข่าวจากคิว) → งานจบโพสต์ใบที่สอง · bot-posted.editorMsgId', async () => {
  checkBotWrite(await scenarioBotWrite());
});

test('ใบที่สอง (W2) ต่อสายถึง route /api/bot/posted ตัวจริง: editorMsgId ผ่าน route → store เลน B (ปลอม) · route ตอบ 200 ทุกครั้ง', async () => {
  const r = await scenarioBotWrite({ routeSrc: ROUTE_SRC });
  checkBotWrite(r);
  assert.deepEqual(r.api.routeResponses.map((x) => [x.method, x.status]), [['get', 200], ['post', 200], ['post', 200], ['get', 200], ['post', 200]],
    'บัตร: เช็ค→จด · ผลข่าว: จด · ใบที่สอง: เช็ค→จด');
  assert.equal(r.store.doc(JOB).revision, 3);
});

test('route /api/bot/posted (W2): editorMsgId ผ่านด่าน id เดียวกับช่องอื่น (trim) แล้วส่งต่อ saveBotPosted · ผิดรูป = 400 ไม่โหลด store · ไม่ส่ง = คำขอเดิม', async () => {
  const r = loadRoute();
  const ok = await r.POST(routeReq({ botSecret: 'S3CRET', body: { jobId: JOB, channelId: 'CH1', editorMsgId: ' E1 ' } }));
  assert.equal(ok.status, 200);
  assert.deepEqual(r.store.calls, [['load'], ['save', { jobId: JOB, channelId: 'CH1', editorMsgId: 'E1' }]]);
  assert.equal(ok.body.item.editorMsgId, 'E1');
  const r2 = loadRoute();
  for (const bad of [{ x: 1 }, '', 'bad id!', 'x'.repeat(101), null, 5]) {
    const res = await r2.POST(routeReq({ botSecret: 'S3CRET', body: { jobId: JOB, channelId: 'CH1', editorMsgId: bad } }));
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.errorType, 'VALIDATION_ERROR');
  }
  assert.deepEqual(r2.store.calls, [], 'ผิดรูป = ไม่แตะ store');
});

// ── 6.6 byte-parity โหมดอื่น (สวิตช์เปิด · shadow/assist) ──
// ลายนิ้วมือจับจากโค้ดเฟส 1 (827336d7 · ก่อนแก้ W2 · 1 ต.ค. 69) ด้วยตัวช่วยชุดนี้ทุกตัว — รันซ้ำ 2 รอบได้ค่าเดิม (นาฬิกา/id เสมือน)
const PHASE1_FINGERPRINTS = Object.freeze({
  'shadow normal': '73fb985ae366796c3af12f35a917f5dba4978bd0d6f26f56bc1fa5999741a10f',
  'shadow resume': '59888fe0340ba6b8e3a7d0c8d6b45d41b697241e7ac24aa90537abb8219c2fc9',
  'shadow late': '8b2efb2e9b16c49138ef370e0a17b220626eb8047a645d9755c8422c0fe2c658',
  'assist normal': 'a88590c8cc1592d30c56b4f003b3b505b329554ecd0cbba4a63776bd99826dee',
  'assist resume': 'f31ff9764647f85d44d2c1217871018e30b03bac7ff36acdd9925145ae4a02fb',
  'assist late': '8af62d45527afc22da2bcbffdaafa3a11e38655f25b37e0b0baefc6eaddd062b',
});

function botFingerprint(r) {
  return createHash('sha256').update(JSON.stringify({
    transcript: r.transcript, logs: r.logs, delays: r.delays, clientOpts: r.clientOpts, handlerCounts: r.handlerCounts, pending: r.pending,
  })).digest('hex');
}

// คำตอบจริงของเลน B ในโหมด shadow/assist (mode ทั้งคำตอบและแถวการ์ด) · ผลข่าวมี researchAgent ของโหมดนั้น (ไม่มี editor)
const laneBMode = (mode, doneAt = 1, waiting = 'pendingQueued') => (jobId, n) => {
  const body = laneB(n >= doneAt ? 'done' : waiting);
  body.mode = mode;
  if (body.cards) body.cards.mode = mode;
  return body;
};

function nonWriteScenarios() {
  const out = [];
  for (const mode of ['shadow', 'assist']) {
    for (const run of ['normal', 'resume']) {
      out.push([`${mode} ${run}`, { env: ON, mode: run, cards: laneBMode(mode), statuses: jobWithResearch({ status: 'done', mode, cardsCount: 1, flags: ['ORIGIN_NOT_FOUND'] }) }]);
    }
    out.push([`${mode} late`, { env: ON, cards: laneBMode(mode, 4, 'pendingLeased'), statuses: jobWithResearch({ status: 'not_ready', mode, cardsCount: 0, flags: [] }) }]);
  }
  return out;
}

async function nonWriteFingerprints({ cardSrc = CARD_SRC, botSrc = BOT_SRC } = {}) {
  const out = {};
  for (const [name, opts] of nonWriteScenarios()) out[name] = botFingerprint(await runBotScenario({ ...opts, cardSrc, botSrc }));
  return out;
}

test('byte-parity (W2 · สวิตช์เปิด · ไม่ใช่โหมด write): ลายนิ้วมือบอทโหมด shadow/assist ตรงกับโค้ดเฟส 1 ทุกไบต์ — ทางปกติ/กู้หลังรีสตาร์ต/การ์ดมาช้า', async () => {
  const current = await nonWriteFingerprints();
  assert.deepEqual(current, { ...PHASE1_FINGERPRINTS }, 'โหมดอื่นต้องเหมือนเฟส 1 ทุกไบต์ (ข้อความ · HTTP · timer · log)');
});

test('byte-parity (W2): จุดเรียก noteJobResult ใน index.js ไม่เปลี่ยนอะไรเลยเมื่อไม่ใช่โหมด write — บันทึกเท่ากับฉบับถอดจุดเรียก W2 ทุกไบต์', async () => {
  for (const [name, opts] of nonWriteScenarios()) {
    const current = await runBotScenario(opts);
    const legacy = await runBotScenario({ ...opts, botSrc: stripW2(BOT_SRC) });
    checkParity(current, legacy, name);
    assert.equal(repliesTitled(current.source, EDITOR_TITLES.done).length, 0, `${name}: ไม่มีใบที่สอง`);
  }
});

// ── 6.7 กลายพันธุ์ของ W2 (ต้องแดงจริง · ข้อยืนยันชุดเดียวกับเทสหลัก) ──
test('mutation MW1: noteJobResult ไม่จำ editor จากผลข่าว → ทาง ก แดง (ต้องถามจนหมดหาง ไม่มีใบที่สอง)', async () => {
  const mod = cardMutant('    noteJobResult(jobId, data) {\n      if (!enabled) return null;', '    noteJobResult(jobId, data) {\n      return null;');
  const r = await scenarioEditorFromResult({ mod });
  assert.equal(r.reason, 'tail_done', 'กลายพันธุ์ต้องทำให้ถามจนหมดหางจริง');
  assert.throws(() => checkEditorFromResult(r));
});

test('mutation MW2: เลิกถามทันทีหลังงานจบแม้ยังรอใบที่สอง (needsPoll ไม่ดู editor) → ทาง ข แดง', async () => {
  const mod = cardMutant('    return !state.cardMsgId || (state.jobEndedAt !== null && wantsEditor(state));', '    return !state.cardMsgId;');
  const r = await scenarioEditorByPolling({ mod });
  assert.equal(repliesTitled(r.source, EDITOR_TITLES.done).length, 0, 'กลายพันธุ์ต้องทำให้ไม่มีใบที่สองจริง');
  assert.throws(() => checkEditorByPolling(r), /ทาง ข/u);
});

test('mutation MW3: ไม่เช็ค bot-posted.editorMsgId ก่อนโพสต์ใบที่สอง → โพสต์ซ้ำข้าม instance → เทสกันซ้ำแดง', async () => {
  const mod = cardMutant('    if (priorEditor) {', '    if (false) {');
  const r = await scenarioEditorDedupe({ mod });
  assert.throws(() => checkEditorDedupe(r), /ซ้ำ/u);
});

test('mutation MW4: 👍/👎 บนใบที่สองไม่ติด kind:"editor" → คะแนนใบที่สองทับใบแรก → เทส feedback แดง', async () => {
  const mod = cardMutant("    if (editorJobId) body.kind = 'editor';\n", '');
  const x = await scenarioEditorReactions({ mod });
  assert.throws(() => checkEditorReactions(x), /kind/u);
});

test('mutation MW5: เพดานบรรทัดหลักของใบที่สอง 8 → 20 → เทส ≤ 8 บรรทัดแดง', () => {
  const mod = cardMutant('const EDITOR_MAIN_LINES = 8;', 'const EDITOR_MAIN_LINES = 20;');
  assert.throws(() => checkEditorCap(mod), /ไม่เกิน 8/u);
});

test('mutation MW6: ใบที่สองไม่ปิด mention → เทสทาง ก แดง', async () => {
  const from = '    const sent = await replyUnderSource(state, { embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });\n    if (!sent) return false;\n    state.editorMsgId = String(sent.id);';
  const mod = cardMutant(from, '    const sent = await replyUnderSource(state, { embeds: [embed] });\n    if (!sent) return false;\n    state.editorMsgId = String(sent.id);');
  const r = await scenarioEditorFromResult({ mod });
  assert.throws(() => checkEditorFromResult(r), /mention/u);
});

test('mutation MW7: index.js ไม่ส่งผลข่าวให้ noteJobResult → เส้นทางจริงโหมด write แดง (ไม่มีใบที่สอง)', async () => {
  const botSrc = mutate(BOT_SRC, '    research.noteJobResult(jobId, data);', '');
  const r = await scenarioBotWrite({ botSrc });
  assert.throws(() => checkBotWrite(r));
});

test('mutation MW8: route /api/bot/posted ไม่ส่ง editorMsgId ต่อ → แถว bot-posted ไม่มีใบที่สอง → เทสต่อสายถึง route แดง', async () => {
  const routeSrc = mutate(ROUTE_SRC, "const EDITOR_ID_KEYS = ['editorMsgId'];", 'const EDITOR_ID_KEYS = [];');
  const r = await scenarioBotWrite({ routeSrc });
  assert.equal(r.store.doc(JOB).editorMsgId, undefined, 'กลายพันธุ์ต้องทำให้แถวไม่มี editorMsgId จริง');
  assert.throws(() => checkBotWrite(r), /editorMsgId/u);
});

test('mutation MW9: ถือว่าทุกคำตอบเป็นโหมด write → shadow/assist ถามต่อในหางหาใบที่สอง → ลายนิ้วมือเฟส 1 แดง', async () => {
  const cardSrc = mutate(CARD_SRC, "writeMode: str(body?.mode) === 'write' }", 'writeMode: true }');
  const current = await nonWriteFingerprints({ cardSrc });
  assert.notDeepEqual(current, { ...PHASE1_FINGERPRINTS }, 'กลายพันธุ์ต้องเปลี่ยนพฤติกรรมโหมดอื่นจริง');
  assert.throws(() => assert.deepEqual(current, { ...PHASE1_FINGERPRINTS }));
});

// ── 6.8 กันถามสองสาย (W2): pollAgain หลังงานจบ + รอบถามที่ timer ยิงแล้วแต่ยังต่อคิวหลัง afterJob ──
//   afterJob ค้างรอคำตอบการ์ด → timer รอบถามยิง (รอบนั้นต่อคิวหลัง afterJob) → afterJob ได้บัตร (โหมด write ยังรอใบที่สอง) → pollAgain
//   → รอบที่ต่อคิวรันแล้ว schedule อีก → ต้องเหลือ timer ตัวเดียว (schedule ล้าง timer เดิม) ไม่ใช่ถามสองสายจนหมดหาง
async function scenarioQueuedTickRace({ mod = RC } = {}) {
  const world = makeWorld();
  const sched = makeScheduler();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = makeApi({ now: sched.now, cards: (jobId, n) => (n === 0 ? gate.then(() => ({ data: laneW1('done') })) : laneW1('done')) });
  const { ctl } = makeCtl({ api, sched, mod });
  const { source, ack } = setupJob(world);
  const done = ctl.watch({ jobId: JOB, message: source, processingMsg: ack });
  await postResultLikeBot(world, source, ack);
  const ended = ctl.jobEnded(JOB, {});
  for (let i = 0; i < 10; i++) await flush();
  await settleWithin(sched.step(), 'timer รอบถามยิงระหว่าง afterJob ค้าง');
  release();
  await settleWithin(ended, 'afterJob');
  for (let i = 0; i < 20; i++) await flush();
  const pendingAfterRace = sched.pending();
  await drain(sched, 'หาง');
  return { api, source, pendingAfterRace, reason: await settleWithin(done, 'จบ') };
}

function checkSingleChain(r) {
  assert.equal(r.pendingAfterRace, 1, 'หลัง race ต้องมี timer รอบถามตัวเดียว');
  assert.ok(r.api.cardGets().length <= 47, `ถามสายเดียวจนหมดหาง (ได้ ${r.api.cardGets().length} ครั้ง — สองสายจะราว 90)`);
  assert.equal(r.reason, 'tail_done');
  assert.equal(repliesTitled(r.source, LIVE_CARD_TITLE).length, 1, 'บัตรใบแรกขึ้นครั้งเดียว');
}

test('ใบที่สอง (W2) กันถามสองสาย: รอบถามที่ต่อคิวหลัง afterJob + pollAgain → timer เหลือตัวเดียว (schedule ล้าง timer เดิม)', async () => {
  checkSingleChain(await scenarioQueuedTickRace());
});

test('mutation MW10: schedule ไม่ล้าง timer เดิม → ถามสองสายหลัง race → เทสกันถามสองสายแดง', async () => {
  const from = '    if (state.timer) {\n      try { clearTimer(state.timer); } catch { /* timer หายไปแล้ว */ }\n      state.timer = null;\n    }\n    state.timer = setTimer(() => {';
  const mod = cardMutant(from, '    state.timer = setTimer(() => {');
  const r = await scenarioQueuedTickRace({ mod });
  assert.equal(r.pendingAfterRace, 2, 'กลายพันธุ์ต้องทำให้มี timer ซ้อนจริง');
  assert.throws(() => checkSingleChain(r), /ตัวเดียว/u);
});
