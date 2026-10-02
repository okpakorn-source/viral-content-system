// ============================================================
// 🧪 tests/research-web-digest.test.mjs — GET /api/research/digest + /api/research/bot-state (ฝั่งเว็บ · Vercel)
// ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7)
// ------------------------------------------------------------
// โค้ดที่ตรวจ: src/app/api/research/digest/route.js (ใหม่) · src/lib/research-agent/digest.js (ใหม่ · pure + ตัวอ่าน)
//   · src/app/api/research/bot-state/route.js (ใหม่) · src/lib/research-agent/store.js (เพิ่ม getBotState/saveBotState แบบ additive)
// วิธี: เรียก handler ตัวจริงด้วย Request จริง (ไม่เปิดเซิร์ฟเวอร์) · Supabase = ตัวปลอมในหน่วยความจำ (tests/helpers/research-digest-fakes.mjs
//   หลายตาราง · tests/helpers/research-web-fakes.mjs ตาราง store_items) · 'next/server' = ตัวปลอม · ไม่ต่อเน็ต ไม่แตะ DB จริง
// ไม่ใช้ timer จริง: เพดาน 8 วิ ทดสอบผ่านช่องฉีด digestTimers (route ใช้ตัวนี้) / timers ที่ส่งให้ collectResearchDigest — เทสยิงเอง
// ข้อสอบ: auth 403/401 (ปฏิเสธก่อนแตะฐาน) · ตัวเลขถูกตาม fixture ที่ไล่มือ (ข่าว · บรรณาธิการ · ธง · ค่าเครื่องมือ · ค่า AI 3 หน้า · 👍👎 ใบแรก/ใบสอง
//   ในช่วงเท่านั้น · ข่าวที่ควรดู) · ไม่คืนเนื้อข่าว (เลือกคอลัมน์ · ไม่มีข้อความ sentinel) · ส่วนล้ม = null + errors (200) · Supabase ไม่พร้อม = null ทั้งหมด
//   · หมดเวลา 8 วิ = ช่องนั้น null + abortSignal · หน้าที่ตอบหลังหมดเวลาไม่ขอหน้าถัดไป · ช่วงเวลา 400 · bot-state: auth · cas (409) · 400 · 503
//   · เอกสาร/env/ทะเบียนเทส
// mutation (ท้ายไฟล์ · ต้องแดงจริง ≥ 8): route ไม่ตรวจกุญแจ · โหวตไม่กรองช่วง · ใบสองนับเป็นใบแรก · อ่านค่า AI หน้าเดียว · ไม่มีเพดานเวลา
//   · ส่วนล้มทำล้มทั้งก้อน · ไม่จำกัดช่วง 8 วัน · ไม่กรอง until · route ตอบ 503 เมื่อไม่มี Supabase · bot-state ไม่เช็ค revision · route ไม่ส่ง 409
// ============================================================
/* eslint-disable no-await-in-loop -- เทสเรียก route ทีละกรณีตามลำดับโดยตั้งใจ (ที่เก็บ/นาฬิกาปลอมตัวเดียวกัน ห้ามขนาน) */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { settleWithin } from './helpers/fake-deadline.mjs';
import { createFakeSupabase, importSource, installResearchHooks, replaceOnce, ROOT, srcUrl } from './helpers/research-web-fakes.mjs';
import {
  createTableSupabase, digestFixture, DIGEST_EXPECTED, DIGEST_SINCE, DIGEST_UNTIL, NEWS_BODY_SENTINEL,
} from './helpers/research-digest-fakes.mjs';

installResearchHooks({
  stubs: {
    '@/lib/supabase': 'export const isSupabaseReady = () => globalThis.__RA_SB_READY !== false; export const getSupabase = () => globalThis.__RA_SB;',
  },
});

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SRC = Object.freeze({
  digest: read('src/lib/research-agent/digest.js'),
  route: read('src/app/api/research/digest/route.js'),
  stateRoute: read('src/app/api/research/bot-state/route.js'),
  store: read('src/lib/research-agent/store.js'),
  env: read('.env.example'),
  doc: read('docs/RESEARCH-AGENT.md'),
  suite: read('tests/news-suite.json'),
});

const digestLib = await import(srcUrl('lib/research-agent/digest.js'));
const digestRoute = await import(srcUrl('app/api/research/digest/route.js'));
const stateRoute = await import(srcUrl('app/api/research/bot-state/route.js'));
const store = await import(srcUrl('lib/research-agent/store.js'));

// ไม่มี timer จริงทั้งไฟล์: เพดาน 8 วิของ route (digestTimers = ช่องฉีดของ digest.js) เป็นตัวปลอมที่ไม่ยิงเอง — เทสยิงเองเฉพาะข้อหมดเวลา
//   ข้อสุดท้ายของส่วน route ตรวจว่าทุก timer ที่ route ตั้ง ถูกล้างแล้ว (ไม่รั่ว)
const fakeTimers = () => {
  const created = [];
  return {
    created,
    setTimeout: (cb, ms) => { const t = { cb, ms, cleared: false }; created.push(t); return t; },
    clearTimeout: (t) => { if (t && typeof t === 'object') t.cleared = true; },
  };
};
const ROUTE_TIMERS = fakeTimers();
digestLib.digestTimers.setTimeout = ROUTE_TIMERS.setTimeout;
digestLib.digestTimers.clearTimeout = ROUTE_TIMERS.clearTimeout;

const BOT_KEY = 'bot-K3Y-digest-0001';
const ENV_KEYS = ['RESEARCH_AGENT', 'RESEARCH_AGENT_MODE', 'DISCORD_API_SECRET'];
const ON = Object.freeze({ RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'write', DISCORD_API_SECRET: BOT_KEY });
const RANGE_QS = `since=${encodeURIComponent(DIGEST_SINCE)}&until=${encodeURIComponent(DIGEST_UNTIL)}`;
const flush = () => new Promise((resolve) => setImmediate(resolve));

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

const get = (path, headers = {}) => new Request(`http://localhost${path}`, { method: 'GET', headers });
const post = (path, body, headers = {}) => new Request(`http://localhost${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const bot = (extra = {}) => ({ 'x-api-key': BOT_KEY, ...extra });

async function call(handler, req) {
  const res = await settleWithin(Promise.resolve(handler(req)), 'route handler');
  return { status: res.status, body: await res.json() };
}

/** Supabase ปลอมหลายตารางที่มีแถวตัวอย่างครบ (ตั้งเป็นตัวที่ route ใช้) */
function seedDigestSb() {
  const sb = createTableSupabase();
  for (const [table, rows] of Object.entries(digestFixture())) sb.insertRows(table, rows);
  globalThis.__RA_SB = sb;
  globalThis.__RA_SB_READY = true;
  return sb;
}

function fixtureRange() {
  const range = digestLib.parseDigestRange({ since: DIGEST_SINCE, until: DIGEST_UNTIL }, Date.now());
  assert.equal(range.ok, true);
  return range;
}

/** ตัวเลขที่ถูก (ไล่มือใน helper) — ใช้ทั้งคำตอบ route และผลของ collectResearchDigest (รวมตัวกลายพันธุ์) */
function checkDigestNumbers(body, label = 'digest') {
  assert.equal(body.since, DIGEST_SINCE, `${label}: since`);
  assert.equal(body.until, DIGEST_UNTIL, `${label}: until`);
  assert.deepEqual(body.news, DIGEST_EXPECTED.news, `${label}: ตัวเลขข่าว/บรรณาธิการ`);
  assert.deepEqual(body.cards, DIGEST_EXPECTED.cards, `${label}: การ์ด/ธง/ค่าเครื่องมือ/👍👎`);
  assert.deepEqual(body.aiCost, DIGEST_EXPECTED.aiCost, `${label}: ค่า AI (api_usage_logs)`);
  assert.deepEqual(body.watchlist.map((w) => w.jobId), DIGEST_EXPECTED.watchJobIds, `${label}: ข่าวที่ควรดู (👎 ก่อน แล้ว corrections)`);
  const [first, second, third] = body.watchlist;
  assert.deepEqual({ ...first, title: null }, { jobId: 'q_digest_a', caseId: '06501', title: null, corrections: 2, additions: 3, down: 1 });
  assert.ok(first.title.startsWith('เนย-แจม') && first.title.length <= 60 && first.title.endsWith('…'), `${label}: ชื่อข่าวถูกตัด ≤ 60`);
  assert.deepEqual(second, { jobId: 'q_digest_b', caseId: '06502', title: 'พยาบาล ICU', corrections: 0, additions: 0, down: 1 });
  assert.deepEqual(third, { jobId: 'q_digest_old', caseId: null, title: null, corrections: 0, additions: 0, down: 1 });
  assert.equal(body.partial, false, `${label}: ไม่ partial`);
  assert.deepEqual(body.errors, []);
}

// ============================================================
// 1) GET /api/research/digest
// ============================================================
async function assertDigestAuth(route = digestRoute) {
  const sb = seedDigestSb();
  await withEnv({ RESEARCH_AGENT: '1' }, async () => {
    const res = await call(route.GET, get(`/api/research/digest?${RANGE_QS}`, bot()));
    assert.equal(res.status, 403, 'ไม่ตั้ง DISCORD_API_SECRET = ปิดประตู');
    assert.equal(res.body.errorType, 'BOT_SECRET_NOT_CONFIGURED');
  });
  await withEnv(ON, async () => {
    for (const headers of [{}, { 'x-api-key': 'bot-K3Y-digest-0002' }, { 'x-research-secret': BOT_KEY }]) {
      const res = await call(route.GET, get(`/api/research/digest?${RANGE_QS}`, headers));
      assert.equal(res.status, 401, JSON.stringify(Object.keys(headers)));
      assert.equal(res.body.errorType, 'UNAUTHORIZED');
      assert.doesNotMatch(JSON.stringify(res.body), /K3Y/u);
    }
  });
  assert.equal(sb.calls.length, 0, 'ปฏิเสธก่อนแตะฐานเสมอ');
  await withEnv(ON, async () => {
    for (const headers of [bot(), { 'x-bot-secret': `  ${BOT_KEY}\n` }]) {
      const res = await call(route.GET, get(`/api/research/digest?${RANGE_QS}`, headers));
      assert.equal(res.status, 200, 'กุญแจบอท (x-api-key / x-bot-secret · trim) ผ่าน');
    }
  });
}

test('digest route: auth — ไม่ตั้ง DISCORD_API_SECRET = 403 · กุญแจผิด/ไม่ส่ง/ใช้ x-research-secret = 401 · ปฏิเสธก่อนแตะฐาน · x-api-key/x-bot-secret ผ่าน', () => assertDigestAuth());

test('digest route: ตัวเลขถูกตาม fixture (ข่าว 7 · ผ่านระบบใหม่ 6 · เข้าเนื้อ/ไม่ทัน/ไม่ผ่าน/ล้ม · ธง · ค่าเครื่องมือ · ค่า AI 3 หน้า · 👍👎 ใบแรก/ใบสองในช่วง) · ไม่คืนเนื้อข่าว · query ตามช่วง', async () => {
  const sb = seedDigestSb();
  const res = await withEnv(ON, () => call(digestRoute.GET, get(`/api/research/digest?${RANGE_QS}`, bot())));
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.mode, 'write');
  checkDigestNumbers(res.body, 'route');
  assert.deepEqual(Object.keys(res.body).sort(), ['aiCost', 'cards', 'enabled', 'errors', 'mode', 'news', 'partial', 'since', 'success', 'until', 'watchlist']);
  // ไม่คืนเนื้อข่าว: เลือกเฉพาะคอลัมน์ตัวเลข/ชื่อข่าว · ข้อความในเนื้อข่าว/เวอร์ชัน/tool_log ไม่หลุดมา
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes(NEWS_BODY_SENTINEL), 'ห้ามมีเนื้อข่าว/เวอร์ชัน/tool_log ในคำตอบ');
  assert.ok(!/SECRET/u.test(text));
  const genCall = sb.calls.find((c) => c.table === 'generation_logs');
  assert.equal(genCall.cols, 'case_id,news_title,created_at,pipeline_info', 'generation_logs: ไม่เลือก source_text/versions');
  assert.deepEqual(genCall.filters, [['gte', 'created_at', DIGEST_SINCE], ['lt', 'created_at', DIGEST_UNTIL]]);
  assert.equal(genCall.limit, digestLib.DIGEST_GEN_LIMIT);
  const cardCall = sb.calls.find((c) => c.table === 'store_items');
  assert.deepEqual(cardCall.filters, [['eq', 'store_name', store.RESEARCH_CARDS_STORE], ['gte', 'updated_at', DIGEST_SINCE], ['lt', 'created_at', DIGEST_UNTIL]],
    'การ์ดที่สร้างก่อน until และเปลี่ยนตั้งแต่ since (โหวตในช่วงของการ์ดเก่าก็นับ)');
  assert.equal(digestLib.DIGEST_CARDS_STORE, store.RESEARCH_CARDS_STORE, 'ชื่อ store ตรงกับ store.js');
  const usageCalls = sb.calls.filter((c) => c.table === 'api_usage_logs');
  assert.deepEqual(usageCalls.map((c) => c.range), [[0, 999], [1000, 1999], [2000, 2999]], 'ค่า AI อ่านทีละ 1,000 แถวจนหน้าไม่เต็ม');
  assert.equal(usageCalls[0].cols, 'cost_usd,feature,created_at');
  assert.equal(sb.calls.every((c) => c.op === 'select'), true, 'route อ่านอย่างเดียว');
});

async function assertPartialSections(route = digestRoute) {
  await withEnv(ON, async () => {
    const cases = [
      ['generation_logs', 'error', 'news', 'generation_logs: query_error'],
      ['store_items', 'throw', 'cards', 'research_cards: exception'],
      ['api_usage_logs', 'error', 'aiCost', 'api_usage_logs: query_error'],
    ];
    for (const [table, mode, field, error] of cases) {
      const sb = seedDigestSb();
      sb.failNext(table, { mode });
      const res = await call(route.GET, get(`/api/research/digest?${RANGE_QS}`, bot()));
      assert.equal(res.status, 200, `${table}: ส่วนล้มต้องไม่ 500 ทั้งก้อน`);
      assert.equal(res.body[field], null, `${table}: ช่องนั้น null`);
      assert.deepEqual(res.body.errors, [error]);
      assert.equal(res.body.partial, true);
      for (const other of ['news', 'cards', 'aiCost'].filter((f) => f !== field)) assert.notEqual(res.body[other], null, `${table}: ช่อง ${other} ยังอยู่`);
      assert.ok(!/SECRET/u.test(JSON.stringify(res.body)), 'ไม่ส่งข้อความดิบจากฐาน');
    }
    // หน้าที่ 2 ของค่า AI ล้ม = ทั้งช่อง null (ไม่รายงานค่าครึ่งๆ)
    const sb2 = seedDigestSb();
    sb2.failNext('api_usage_logs', { mode: 'error', after: 1 });
    const page2 = await call(route.GET, get(`/api/research/digest?${RANGE_QS}`, bot()));
    assert.equal(page2.status, 200);
    assert.equal(page2.body.aiCost, null, 'หน้า 2 ล้ม = ไม่รายงานค่าครึ่งหน้าแรก');
    assert.deepEqual(page2.body.errors, ['api_usage_logs: query_error']);
    assert.equal(sb2.calls.filter((c) => c.table === 'api_usage_logs').length, 2);
    // ไม่ตั้ง Supabase = ทุกช่อง null (200 · partial) — บอทยังส่งสรุปพร้อมบอกว่าข้อมูลไม่ครบ
    globalThis.__RA_SB_READY = false;
    try {
      const res = await call(route.GET, get(`/api/research/digest?${RANGE_QS}`, bot()));
      assert.equal(res.status, 200);
      assert.deepEqual([res.body.news, res.body.cards, res.body.aiCost], [null, null, null]);
      assert.deepEqual(res.body.errors, ['generation_logs: supabase_unavailable', 'research_cards: supabase_unavailable', 'api_usage_logs: supabase_unavailable']);
      assert.deepEqual(res.body.watchlist, []);
    } finally {
      globalThis.__RA_SB_READY = true;
    }
  });
}

test('digest route: ส่วนไหนล้ม = ช่องนั้น null + errors (200 ไม่ 500 ทั้งก้อน · ไม่ส่งข้อความดิบ) · Supabase ไม่พร้อม = null ทั้งหมด', () => assertPartialSections());

test('digest route: bounded 8 วิ — ตาราง research-cards ไม่ตอบ → ครบเวลาแล้วช่องนั้น null (timeout) + ยกเลิกคำขอค้าง · ส่วนอื่นได้ครบ · timer ถูกล้างทุกทาง', async () => {
  await withEnv(ON, async () => {
    const before = ROUTE_TIMERS.created.length;
    const sb = seedDigestSb();
    sb.failNext('store_items', { mode: 'hang' });
    const pending = Promise.resolve(digestRoute.GET(get(`/api/research/digest?${RANGE_QS}`, bot())));
    for (let i = 0; i < 20 && ROUTE_TIMERS.created.length === before; i++) await flush();
    const timers = ROUTE_TIMERS.created.slice(before);
    assert.equal(timers.length, 1, 'ตั้งเพดานเวลาตัวเดียว');
    assert.equal(timers[0].ms, 8000, 'เพดาน 8 วิ (สเปกส่วน 12 ข้อ 4)');
    for (let i = 0; i < 20; i++) await flush(); // ส่วนอื่นอ่านเสร็จก่อน
    timers[0].cb(); // ครบ 8 วิ
    const res = await settleWithin(pending, 'route หลังหมดเวลา');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.cards, null);
    assert.deepEqual(body.errors, ['research_cards: timeout']);
    assert.deepEqual(body.news, DIGEST_EXPECTED.news);
    assert.deepEqual(body.aiCost, DIGEST_EXPECTED.aiCost);
    const hung = sb.signals.find((s) => s.table === 'store_items');
    assert.ok(hung && hung.signal.aborted, 'คำขอที่ค้างถูกยกเลิก (abortSignal)');
    assert.equal(timers[0].cleared, true, 'หมดเวลาแล้วก็ล้าง timer');
    // รอบปกติ: timer ถูกล้างเมื่ออ่านครบก่อนเวลา
    seedDigestSb();
    const ok = await call(digestRoute.GET, get(`/api/research/digest?${RANGE_QS}`, bot()));
    assert.equal(ok.status, 200);
    const all = ROUTE_TIMERS.created.slice(before);
    assert.equal(all.length, 2);
    assert.equal(all[1].cleared, true, 'อ่านเสร็จก่อนเวลา = ล้าง timer');
  });
});

test('collectResearchDigest: timers ฉีด — หน้าค่า AI ที่ตอบหลังหมดเวลาไม่ขอหน้าถัดไป · ช่องนั้น null · ผลส่วนอื่นครบ', async () => {
  const sb = seedDigestSb();
  sb.failNext('api_usage_logs', { mode: 'defer' });
  const timers = [];
  const fake = { setTimeout: (cb, ms) => { const t = { cb, ms, cleared: false }; timers.push(t); return t; }, clearTimeout: (t) => { if (t) t.cleared = true; } };
  const running = digestLib.collectResearchDigest({ sb, range: fixtureRange(), timers: fake, timeoutMs: 1234 });
  for (let i = 0; i < 20 && sb.deferred.length === 0; i++) await flush();
  assert.equal(sb.deferred.length, 1, 'หน้าแรกของค่า AI ค้างอยู่');
  assert.equal(timers[0].ms, 1234);
  timers[0].cb();
  sb.deferred[0].release(); // หน้าแรกตอบหลังหมดเวลา (เต็ม 1,000 แถว)
  const out = await settleWithin(running, 'collect หลังหมดเวลา');
  for (let i = 0; i < 10; i++) await flush();
  assert.equal(out.aiCost, null);
  assert.deepEqual(out.errors, ['api_usage_logs: timeout']);
  assert.equal(sb.calls.filter((c) => c.table === 'api_usage_logs').length, 1, 'หมดเวลาแล้วไม่ขอหน้าถัดไป');
  assert.deepEqual(out.news, DIGEST_EXPECTED.news);
  assert.deepEqual(out.cards, DIGEST_EXPECTED.cards);
  assert.equal(timers[0].cleared, true);
});

async function assertRangeRules(route = digestRoute) {
  seedDigestSb();
  await withEnv(ON, async () => {
    const now = Date.now();
    const bad = [
      ['since=x', 'since ต้องเป็นวันที่'],
      ['until=2026-99-99', 'until ต้องเป็นวันที่'],
      [`since=${encodeURIComponent(DIGEST_UNTIL)}&until=${encodeURIComponent(DIGEST_SINCE)}`, 'since ต้องมาก่อน until'],
      [`since=${encodeURIComponent('2026-09-01T00:00:00.000Z')}&until=${encodeURIComponent('2026-09-10T00:00:00.000Z')}`, 'ช่วงเวลายาวเกิน 8 วัน'],
      [`until=${encodeURIComponent(new Date(now + 60 * 60_000).toISOString())}`, 'until อยู่ในอนาคต'],
    ];
    for (const [qs, message] of bad) {
      const res = await call(route.GET, get(`/api/research/digest?${qs}`, bot()));
      assert.equal(res.status, 400, qs);
      assert.equal(res.body.errorType, 'VALIDATION_ERROR');
      assert.ok(res.body.error.startsWith(message), `${qs}: ${res.body.error}`);
    }
    // 8 วันพอดี = ได้ · ไม่ส่งช่วง = 24 ชม. ล่าสุดถึงตอนนี้
    const eight = await call(route.GET, get(`/api/research/digest?since=${encodeURIComponent('2026-09-01T00:00:00.000Z')}&until=${encodeURIComponent('2026-09-09T00:00:00.000Z')}`, bot()));
    assert.equal(eight.status, 200);
    const before = Date.now();
    const def = await call(route.GET, get('/api/research/digest', bot()));
    const after = Date.now();
    assert.equal(def.status, 200);
    const untilMs = Date.parse(def.body.until);
    assert.ok(untilMs >= before && untilMs <= after, 'until = ตอนนี้');
    assert.equal(untilMs - Date.parse(def.body.since), 24 * 60 * 60 * 1000, 'since = until − 24 ชม.');
  });
}

test('digest route: ช่วงเวลา — วันที่ผิดรูป/since ≥ until/ยาวเกิน 8 วัน/until ในอนาคต = 400 VALIDATION_ERROR · 8 วันพอดีได้ · ไม่ส่ง = 24 ชม. ล่าสุด', () => assertRangeRules());

test('digest.js pure: pipeline_info ข้อความ JSON · แถวผิดรูป · ธงเพดาน 12 · ข่าวที่ควรดู ≤ 3 (👎 ก่อน corrections) · ค่า AI ≤ 5 feature', () => {
  const { summary, byJob } = digestLib.summarizeNews([
    null, 'x', { case_id: 7, news_title: 'ก', pipeline_info: JSON.stringify({ totalTime: 10, jobId: 'q_str', researchAgent: { mode: 'write', status: 'weird', editor: { status: 'done', corrections: '2', additions: -1 } } }) },
    { case_id: 'bad id!', news_title: '', pipeline_info: { researchAgent: { mode: 'x', status: 'done' } } },
    { case_id: '1', pipeline_info: '{broken' },
  ]);
  assert.equal(summary.total, 3, 'นับเฉพาะแถวที่เป็น object');
  assert.equal(summary.withAgent, 2);
  assert.deepEqual(summary.modes, { shadow: 0, assist: 0, write: 1, other: 1 });
  assert.deepEqual(summary.agentStatus, { done: 1, other: 1 });
  assert.equal(summary.corrections, 2, 'ตัวเลขเป็นข้อความก็อ่านได้ · ติดลบ = 0');
  assert.equal(summary.additions, 0);
  assert.deepEqual([...byJob.values()], [{ jobId: 'q_str', caseId: '7', title: 'ก', corrections: 2, additions: 0 }]);
  const manyFlags = Array.from({ length: 15 }, (_, i) => `FLAG_${String(i).padStart(2, '0')}`);
  const cards = digestLib.summarizeCards([{ created_at: DIGEST_SINCE, data: { id: 'q_f', status: 'done', flags: [...manyFlags, 'bad flag', 3] } }],
    { sinceMs: Date.parse(DIGEST_SINCE), untilMs: Date.parse(DIGEST_UNTIL) });
  assert.equal(Object.keys(cards.flags).length, 12, 'ธงไม่เกิน 12');
  assert.ok(!Object.keys(cards.flags).includes('bad flag'));
  const watch = digestLib.buildWatchlist(new Map([
    ['q_1', { jobId: 'q_1', caseId: '1', title: 'a', corrections: 5, additions: 0 }],
    ['q_2', { jobId: 'q_2', caseId: '2', title: 'b', corrections: 1, additions: 0 }],
    ['q_3', { jobId: 'q_3', caseId: '3', title: 'c', corrections: 0, additions: 9 }],
  ]), [{ jobId: 'q_9', down: 2 }, { jobId: 'q_2', down: 1 }, { jobId: 'bad id', down: 5 }, { jobId: 'q_8', down: 0 }]);
  assert.deepEqual(watch.map((w) => [w.jobId, w.down, w.corrections]), [['q_9', 2, 0], ['q_2', 1, 1], ['q_1', 0, 5]], '👎 มาก→น้อย แล้ว corrections · ≤ 3 · ไม่มี corrections/👎 = ไม่อยู่');
  const usage = digestLib.summarizeUsage(Array.from({ length: 8 }, (_, i) => ({ cost_usd: i, feature: `f${i}` })));
  assert.equal(usage.byFeature.length, 5);
  assert.deepEqual(usage.byFeature.map((f) => f.feature), ['f7', 'f6', 'f5', 'f4', 'f3']);
  assert.equal(usage.usd, 28);
  const digest = digestLib.buildDigest({ range: { since: 'a', until: 'b' }, errors: ['x: y', '', 5] });
  assert.deepEqual(digest, { since: 'a', until: 'b', news: null, cards: null, aiCost: null, watchlist: [], partial: true, errors: ['x: y'] });
});

test('digest route: ไม่มี timer รั่ว — ทุกเพดาน 8 วิที่ route ตั้งในข้อด้านบนถูกล้างแล้ว (ทั้งไฟล์ไม่มี timer จริง)', () => {
  assert.ok(ROUTE_TIMERS.created.length >= 10, `route ตั้งเพดานทุกคำขอที่อ่านฐาน (${ROUTE_TIMERS.created.length})`);
  assert.ok(ROUTE_TIMERS.created.every((t) => t.ms === digestLib.DIGEST_TIMEOUT_MS && t.cleared), 'ล้างครบทุกตัว');
});

// ============================================================
// 2) /api/research/bot-state + store (additive)
// ============================================================
function freshStateSb() {
  const sb = createFakeSupabase();
  globalThis.__RA_SB = sb;
  globalThis.__RA_SB_READY = true;
  return sb;
}

async function assertBotStateRoute(route = stateRoute) {
  const sb = freshStateSb();
  const KEY = 'daily-digest';
  await withEnv({}, async () => {
    const r1 = await call(route.GET, get(`/api/research/bot-state?key=${KEY}`, bot()));
    assert.equal(r1.status, 403);
    assert.equal(r1.body.errorType, 'BOT_SECRET_NOT_CONFIGURED');
    const r2 = await call(route.POST, post('/api/research/bot-state', { key: KEY, expectedRevision: 0, state: {} }, bot()));
    assert.equal(r2.status, 403);
  });
  await withEnv(ON, async () => {
    for (const headers of [{}, { 'x-api-key': 'nope' }]) {
      assert.equal((await call(route.GET, get(`/api/research/bot-state?key=${KEY}`, headers))).status, 401);
      assert.equal((await call(route.POST, post('/api/research/bot-state', { key: KEY, expectedRevision: 0, state: {} }, headers))).status, 401);
    }
    assert.equal(sb.calls.length, 0, 'ปฏิเสธก่อนแตะฐาน');
    // ยังไม่มีแถว
    const empty = await call(route.GET, get(`/api/research/bot-state?key=${KEY}`, bot()));
    assert.deepEqual(empty, { status: 200, body: { success: true, key: KEY, item: null } });
    // จองครั้งแรก (expectedRevision 0 = ต้องยังไม่มีแถว)
    const claim = await call(route.POST, post('/api/research/bot-state', { key: KEY, expectedRevision: 0, state: { status: 'sending', claimKey: '2026-10-02' } }, bot()));
    assert.equal(claim.status, 200);
    assert.equal(claim.body.item.revision, 1);
    assert.deepEqual(claim.body.item.state, { status: 'sending', claimKey: '2026-10-02' });
    assert.equal(sb.doc('bstate_daily-digest').id, KEY, 'row id bstate_<key> · data.id = key');
    // อีก instance จองซ้ำด้วย 0 = ชน → 409 + ค่าล่าสุด
    const dup = await call(route.POST, post('/api/research/bot-state', { key: KEY, expectedRevision: 0, state: { status: 'sending', claimKey: '2026-10-02', instance: 'B' } }, bot()));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.errorType, 'BOT_STATE_CONFLICT');
    assert.equal(dup.body.item.revision, 1);
    assert.equal(dup.body.item.state.instance, undefined, 'ไม่ทับของคนจองก่อน');
    // เขียนต่อด้วย revision ที่ถูก
    const sent = await call(route.POST, post('/api/research/bot-state', { key: KEY, expectedRevision: 1, state: { status: 'sent', lastSentKey: '2026-10-02' } }, bot()));
    assert.equal(sent.status, 200);
    assert.equal(sent.body.item.revision, 2);
    // revision เก่า = ชน
    const stale = await call(route.POST, post('/api/research/bot-state', { key: KEY, expectedRevision: 1, state: { status: 'sent', lastSentKey: 'x' } }, bot()));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.item.state.lastSentKey, '2026-10-02');
    const read = await call(route.GET, get(`/api/research/bot-state?key=${KEY}`, bot()));
    assert.equal(read.body.item.revision, 2);
    assert.deepEqual(read.body.item.state, { status: 'sent', lastSentKey: '2026-10-02' });
    // ข้อมูลผิด = 400
    const badBodies = [
      { key: 'other', expectedRevision: 0, state: {} },
      { key: KEY, expectedRevision: -1, state: {} },
      { key: KEY, expectedRevision: 1.5, state: {} },
      { key: KEY, expectedRevision: '2', state: {} },
      { key: KEY, expectedRevision: 2, state: [] },
      { key: KEY, expectedRevision: 2, state: 'x' },
      { key: KEY, expectedRevision: 2, state: { big: 'x'.repeat(store.BOT_STATE_MAX_CHARS) } },
    ];
    for (const body of badBodies) {
      const res = await call(route.POST, post('/api/research/bot-state', body, bot()));
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(res.body.errorType, 'VALIDATION_ERROR');
    }
    assert.equal((await call(route.POST, post('/api/research/bot-state', '{oops', bot()))).status, 400);
    assert.equal((await call(route.GET, get('/api/research/bot-state?key=other', bot()))).status, 400);
    assert.equal((await call(route.GET, get('/api/research/bot-state', bot()))).status, 400);
    // ฐานใช้ไม่ได้ = 503 (ไม่ส่งข้อความดิบ)
    globalThis.__RA_SB_READY = false;
    try {
      const down = await call(route.GET, get(`/api/research/bot-state?key=${KEY}`, bot()));
      assert.equal(down.status, 503);
      assert.equal(down.body.errorType, 'RESEARCH_STORAGE_UNAVAILABLE');
    } finally {
      globalThis.__RA_SB_READY = true;
    }
    sb.failNext(1, { kind: 'select' });
    const err = await call(route.GET, get(`/api/research/bot-state?key=${KEY}`, bot()));
    assert.equal(err.status, 503);
    assert.doesNotMatch(JSON.stringify(err.body), /SECRET/u);
  });
}

test('bot-state route: auth 403/401 · ยังไม่มี = null · จอง (0) → ชนซ้ำ = 409 BOT_STATE_CONFLICT + ค่าล่าสุด · revision ถูกเขียนได้/เก่าชน · ข้อมูลผิด 400 · ฐานล้ม 503', () => assertBotStateRoute());

async function assertStoreBotState(mod = store) {
  const sb = createFakeSupabase();
  const storage = mod.createResearchStorage({ sb, now: () => Date.parse('2026-10-02T00:30:00.000Z') });
  assert.equal(await storage.getBotState('daily-digest'), null);
  const a = await storage.saveBotState('daily-digest', { lastSentKey: '2026-10-01' }, { expectedRevision: 0 });
  assert.equal(a.outcome, 'stored');
  assert.deepEqual(sb.doc('bstate_daily-digest'), { id: 'daily-digest', state: { lastSentKey: '2026-10-01' }, revision: 1, createdAt: '2026-10-02T00:30:00.000Z', updatedAt: '2026-10-02T00:30:00.000Z' });
  const b = await storage.saveBotState('daily-digest', { lastSentKey: 'x' }, { expectedRevision: 0 });
  assert.equal(b.outcome, 'conflict');
  assert.equal(b.item.revision, 1);
  const c = await storage.saveBotState('daily-digest', { lastSentKey: '2026-10-02' }, { expectedRevision: 1 });
  assert.equal(c.outcome, 'stored');
  assert.equal(c.item.revision, 2);
  assert.equal(c.item.createdAt, '2026-10-02T00:30:00.000Z', 'createdAt คงของเดิม');
  const d = await storage.saveBotState('daily-digest', { lastSentKey: 'y' }, { expectedRevision: 1 });
  assert.equal(d.outcome, 'conflict', 'revision เก่า = ชน');
  assert.equal(d.item.state.lastSentKey, '2026-10-02');
  const e = await storage.saveBotState('daily-digest', { lastSentKey: 'z' }, { expectedRevision: 5 });
  assert.equal(e.outcome, 'conflict', 'revision ล้ำหน้า = ชน');
  await assert.rejects(storage.getBotState('../x'), (err) => err.code === 'RESEARCH_INVALID_INPUT');
  await assert.rejects(storage.saveBotState('daily-digest', { a: 1 }, { expectedRevision: -1 }), (err) => err.code === 'RESEARCH_INVALID_INPUT');
  assert.equal(sb.doc('bstate_daily-digest').state.lastSentKey, '2026-10-02');
}

test('store (additive): getBotState/saveBotState — row bstate_<key> · insert เมื่อ 0 · cas ตาม revision · ชน = conflict + ค่าล่าสุด · key/revision ผิด = RESEARCH_INVALID_INPUT', () => assertStoreBotState());

// ============================================================
// 3) เอกสาร + env + ทะเบียนเทส
// ============================================================
test('docs/.env.example/news-suite: env ใหม่ [Railway] (RESEARCH_DIGEST · HOUR · MINUTE · ADMIN_LOG_CHANNEL_ID) เป็นคอมเมนต์ · คู่มือมีแถว env + ส่วน W7 + วิธีถอย · เทส 2 ไฟล์อยู่ในด่าน', () => {
  for (const name of ['RESEARCH_DIGEST', 'RESEARCH_DIGEST_HOUR', 'RESEARCH_DIGEST_MINUTE', 'ADMIN_LOG_CHANNEL_ID']) {
    assert.match(SRC.env, new RegExp(`^# ${name}=`, 'mu'), `.env.example มีตัวอย่าง ${name} (คอมเมนต์)`);
    assert.ok(!new RegExp(`^\\s*${name}\\s*=`, 'mu').test(SRC.env), `${name} ต้องเป็นคอมเมนต์ (ไม่เปิดเอง)`);
    assert.ok(SRC.doc.split('\n').some((l) => l.startsWith(`| \`${name}\` | Railway |`)), `คู่มือมีแถว env ${name}`);
  }
  assert.match(SRC.env, /^# \[Railway\][^\n]*สรุปรายวัน[^\n]*\n(?:#[^\n]*\n)*# RESEARCH_DIGEST=0$/mu);
  assert.ok(SRC.doc.includes('## 17. แจ้งเตือนเจ้าของ + สรุปรายวัน (W7'), 'คู่มือมีส่วน W7');
  assert.ok(SRC.doc.includes('`/api/research/digest`') && SRC.doc.includes('`/api/research/bot-state`'), 'คู่มือบอก route ใหม่');
  assert.ok(SRC.doc.split('\n').some((l) => l.startsWith('| ปิดสรุปรายวัน') && l.includes('`RESEARCH_DIGEST=0`')), 'วิธีถอย');
  const suite = JSON.parse(SRC.suite);
  for (const file of ['tests/research-web-digest.test.mjs', 'tests/research-watchdog-digest.test.mjs']) assert.ok(suite.include.includes(file), `ลงทะเบียน ${file}`);
});

// ============================================================
// 4) mutation — ข้อสอบต้องแดงทุกแบบ (ของจริงเขียวในข้อด้านบน)
// ============================================================
let mutantSeq = 0;
const tag = (label) => `w7web-${label}-${++mutantSeq}`;
const digestMutant = (from, to, label) => importSource(replaceOnce(SRC.digest, from, to, label), tag(label));
const routeMutant = (from, to, label) => importSource(replaceOnce(SRC.route, from, to, label), tag(label));
const stateRouteMutant = (from, to, label) => importSource(replaceOnce(SRC.stateRoute, from, to, label), tag(label));
const storeMutant = (from, to, label) => importSource(replaceOnce(SRC.store, from, to, label), tag(label));

async function collectWith(lib) {
  const sb = seedDigestSb();
  return { sb, out: await settleWithin(lib.collectResearchDigest({ sb, range: fixtureRange(), timers: fakeTimers() }), 'collect (mutant)') };
}

test('mutation MD1: route ไม่ตรวจกุญแจบอท → ข้อ auth แดง', async () => {
  const mod = await routeMutant('    const denied = checkBotKey(req);\n    if (denied) return denied;\n', '', 'no-auth');
  await assert.rejects(assertDigestAuth(mod));
});

test('mutation MD2: 👍👎 ไม่กรองตามเวลาที่กด → ตัวเลขโหวตแดง', async () => {
  const mod = await digestMutant("      if (!inWindow(Date.parse(String(vote.at ?? '')))) continue;\n", '', 'votes-no-window');
  const { out } = await collectWith(mod);
  assert.notDeepEqual(out.cards.votes, DIGEST_EXPECTED.cards.votes, 'กลายพันธุ์ต้องเปลี่ยนตัวเลขจริง');
  assert.throws(() => checkDigestNumbers(out, 'mutant'));
});

test('mutation MD3: โหวตใบที่สอง (kind editor) นับรวมใบแรก → ตัวเลขโหวตแดง', async () => {
  const mod = await digestMutant("const bucket = vote.kind === 'editor' ? out.votes.second : out.votes.first;", 'const bucket = out.votes.first;', 'editor-as-first');
  const { out } = await collectWith(mod);
  assert.deepEqual(out.cards.votes.second, { up: 0, down: 0 });
  assert.throws(() => checkDigestNumbers(out, 'mutant'));
});

test('mutation MD4: ค่า AI อ่านหน้าเดียว (ไม่ไล่หน้า) → ค่า AI แดง', async () => {
  const mod = await digestMutant('    if (result.data.length < DIGEST_USAGE_PAGE) return { rows, capped: false };', '    return { rows, capped: false };', 'usage-one-page');
  const { out, sb } = await collectWith(mod);
  assert.equal(sb.calls.filter((c) => c.table === 'api_usage_logs').length, 1);
  assert.throws(() => checkDigestNumbers(out, 'mutant'), /ค่า AI/u);
});

test('mutation MD5: ไม่มีเพดานเวลา (ไม่แข่งกับ deadline) → ตารางค้าง = route ค้าง → ข้อเพดาน 8 วิแดง', async () => {
  const mod = await digestMutant("    deadline.then(() => ({ ok: false, reason: 'timeout' })),\n", '', 'no-deadline');
  const sb = seedDigestSb();
  sb.failNext('store_items', { mode: 'hang' });
  const timers = [];
  const fake = { setTimeout: (cb, ms) => { const t = { cb, ms }; timers.push(t); return t; }, clearTimeout() {} };
  const running = mod.collectResearchDigest({ sb, range: fixtureRange(), timers: fake });
  for (let i = 0; i < 20; i++) await flush();
  timers[0].cb();
  await assert.rejects(settleWithin(running, 'collect ไม่มีเพดาน', 200), /รอเกิน/u);
});

test('mutation MD6: ส่วนล้มทำล้มทั้งก้อน (ไม่แปลงเป็น null) → ข้อส่วนล้มแดง', async () => {
  const mod = await digestMutant(
    "      .then((value) => ({ ok: true, value }), (error) => ({ ok: false, reason: error?.digestReason || 'exception' })),",
    '      .then((value) => ({ ok: true, value })),',
    'rethrow-section',
  );
  const sb = seedDigestSb();
  sb.failNext('generation_logs', { mode: 'error' });
  await assert.rejects(settleWithin(mod.collectResearchDigest({ sb, range: fixtureRange(), timers: fakeTimers() }), 'collect (mutant)'));
});

/** route ตัวจริงที่ import digest.js ฉบับกลายพันธุ์ (data: URL เดียวกัน = โมดูลตัวเดียวกับที่คืนให้เทส) */
async function routeWithDigest(digestSource, label) {
  const url = `data:text/javascript;base64,${Buffer.from(`${digestSource}\n//# sourceURL=${tag(label)}.mjs`, 'utf8').toString('base64')}`;
  const lib = await import(url);
  const timers = fakeTimers(); // โมดูลกลายพันธุ์มี digestTimers ของตัวเอง — แทนด้วยตัวปลอม (ไม่มี timer จริง)
  lib.digestTimers.setTimeout = timers.setTimeout;
  lib.digestTimers.clearTimeout = timers.clearTimeout;
  const route = await importSource(replaceOnce(SRC.route, "from '@/lib/research-agent/digest';", `from '${url}';`, label), tag(`${label}-route`));
  return { lib, route };
}

test('mutation MD7: ไม่จำกัดช่วง 8 วัน → ข้อช่วงเวลาแดง (route ตัวจริงกับ digest.js กลายพันธุ์)', async () => {
  const { lib, route } = await routeWithDigest(replaceOnce(SRC.digest, '  if (untilMs - sinceMs > DIGEST_MAX_RANGE_MS) return', '  if (false) return', 'no-max-range'), 'no-max-range');
  assert.equal(lib.parseDigestRange({ since: '2026-09-01T00:00:00.000Z', until: '2026-09-10T00:00:00.000Z' }, Date.now()).ok, true, 'กลายพันธุ์ต้องปล่อยช่วง 9 วันจริง');
  await assert.rejects(assertRangeRules(route), /ช่วงเวลายาวเกิน|400/u);
});

test('mutation MD8: generation_logs ไม่กรอง until (lt) → แถวที่ created_at = until หลุดเข้ามา → ตัวเลขข่าวแดง', async () => {
  const mod = await digestMutant(
    "    .select('case_id,news_title,created_at,pipeline_info')\n    .gte('created_at', range.since)\n    .lt('created_at', range.until)\n",
    "    .select('case_id,news_title,created_at,pipeline_info')\n    .gte('created_at', range.since)\n",
    'no-until',
  );
  const { out } = await collectWith(mod);
  assert.equal(out.news.total, 8);
  assert.throws(() => checkDigestNumbers(out, 'mutant'), /ตัวเลขข่าว/u);
});

test('mutation MD9: route ตอบ 503 เมื่อไม่มี Supabase (แทน null ทั้งก้อน) → ข้อส่วนล้มแดง', async () => {
  const mod = await routeMutant('    const sb = await loadSupabaseClient();\n', "    const sb = await loadSupabaseClient();\n    if (!sb) return jsonFail(503, 'x', 'NO_DB');\n", 'no-db-503');
  await assert.rejects(assertPartialSections(mod));
});

test('mutation MD10: bot-state ไม่เช็ค revision (เขียนทับเสมอ) → ข้อ cas แดง (สอง instance จองซ้ำได้)', async () => {
  const mod = await storeMutant(
    "      if (!current || current.revision !== input.expectedRevision) return { outcome: 'conflict', item: current };\n      const doc = { ...current, id: input.key, state: input.state, revision: input.expectedRevision + 1, updatedAt: iso };\n      if (await casDoc(BOT_STATE_STORE, rowId, input.expectedRevision, doc))",
    "      if (!current) return { outcome: 'conflict', item: current };\n      const doc = { ...current, id: input.key, state: input.state, revision: current.revision + 1, updatedAt: iso };\n      if (await casDoc(BOT_STATE_STORE, rowId, current.revision, doc))",
    'state-no-revision',
  );
  await assert.rejects(assertStoreBotState(mod));
});

test('mutation MD11: route bot-state ชนแล้วตอบ 200 (ไม่ส่ง 409) → ข้อ route แดง (บอทจะคิดว่าจองสำเร็จ)', async () => {
  const mod = await stateRouteMutant("    if (result.outcome === 'conflict') {", "    if (result.outcome === 'never') {", 'state-no-409');
  await assert.rejects(assertBotStateRoute(mod));
});
