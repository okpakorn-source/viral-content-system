// ============================================================
// 🧪 tests/queue-parallel.test.mjs — ท่อข่าวขนาน: เขียนข่าวพร้อมกันหลายงานบน Vercel (SPEC-v3 ส่วน 11 · W6)
// ------------------------------------------------------------
// ★ 2 ต.ค. 69 (ท่อข่าวขนาน · SPEC-v3 ส่วน 11 · W6) — ไฟล์ใหม่ · เจ้าของสั่ง 2 ต.ค. 69 13:30
//   "เวลาต่อข่าวเท่าเดิมได้ แค่อยากให้ไม่ต้องต่อคิวกัน เพราะพนักงานเป็นสิบ"
//   A. src/lib/services/queueConcurrency.js getNewsConcurrency — ไม่ตั้ง/ว่าง/'abc'/0/-1 = 1 · 99 = 10 · ทศนิยมปัดลง ·
//      ทน space/เครื่องหมายคำพูด · อ่าน env ที่ส่งมาทุกครั้ง · ไม่โยน · ไฟล์ pure
//   B. getNextPendingJobs ตัวจริง (src/lib/services/queueService.js · persistStore/supabase/uuid ปลอม · claim ผ่าน CAS ปลอม ·
//      process.platform ปลอม · ตัวช่วยเพดานห่อจดการเรียก):
//      B1 ไม่ตั้ง env (และค่าที่ได้ 1) = ผลเท่าซอร์สที่ถอด W6 ทุกไบต์ (งานที่หยิบ · แถว · log · คำสั่งฐาน · คำสั่ง store)
//         ทุกเครื่อง × หลายโลก × limit 1/3 · ไม่ตั้ง = ไม่เรียกตัวช่วยเลย
//      B2 =3: หยิบได้ 3 ตามลำดับ createdAt เมื่อ processingHere 0 · worker (limit=1) หยิบทีละงานจนครบ 3 แล้ว "Concurrency limit 3/3"
//      B3 processingHere นับถูก: processing 2 → หยิบ 1 · 3 → [] · ปกที่วิ่งบนเครื่องทีมไม่กินช่องข่าวของ Vercel
//      B4 hold (W3) + =3: งานที่รอรีเสิร์ชถูกข้าม แล้วเติมช่องด้วยงานถัดไปที่ไม่ hold
//      B5 ค่าผิดรูป 'abc'/0/-1/99 → เพดาน 1/1/1/10 (นับงานที่หยิบ + log บรรทัด Concurrency limit แสดงเพดานใหม่)
//      B6 win32 ไม่มี QUEUE_LOCAL_NEWS → ข่าวไม่ถูกหยิบเหมือนเดิม + เพดานคง 1 · win32 + QUEUE_LOCAL_NEWS=1 / Vercel + QUEUE_COVER_ON_VERCEL=1
//         → ข่าวขนานได้ แต่ปก/คลิปคงทีละ 1 (มีวิ่งอยู่ = ไม่หยิบเพิ่ม · ว่าง = งานเก่าสุดงานเดียว)
//      B7 อ่าน env ทุกครั้งที่เรียก (เปลี่ยนค่ากลางทางมีผลรอบถัดไปทันที · ไม่ cache)
//      B8 worker route ไม่เปลี่ยน: ยังขอ getNextPendingJobs(1) และไม่มี self-fetch worker→worker (บทเรียน 508 · 24 มิ.ย. 69)
//   C. GET /api/queue/status ตัวจริง — self-heal ปลุก worker เมื่อ processing < เพดาน: 1 < 3 → ปลุก · 3 → ไม่ปลุก · 99 → เพดาน 10 ·
//      ไม่ตั้ง env/ค่าที่ได้ 1 = เท่าซอร์สที่ถอด W6 ทุกไบต์ (ตาราง pending × processing + เส้นเวลา throttle) · throttle 20 วิเดิม
//   D. .env.example [Vercel] + คู่มือ (ตาราง env · วิธีถอย · ส่วน 16 · ตารางไฟล์) + ทะเบียน tests/news-suite.json
//   E. mutation 13 แบบ — ข้อสอบต้องแดงทุกแบบ (ของจริงเขียวในข้อด้านบน)
// ไม่มี timer จริง: route ใช้นาฬิกา Date.now ฉีด · ตัวช่วย hold ใช้ timer ฉีด (ไม่ถูกยิง) · ไม่ unref · await ครอบ settleWithin
// (tests/helpers/fake-deadline.mjs) · ไม่ต่อเน็ต (fetch ปลอม) · ไม่แตะ DB จริง · ไม่เขียนไฟล์ใน repo (ซอร์สที่ถอด W6/กลายพันธุ์
// โหลดผ่าน data: URL) · อ่านซอร์ส normalize CRLF→LF
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';
import { settleWithin } from './helpers/fake-deadline.mjs';
import { importSource, installResearchHooks, replaceOnce, ROOT, srcUrl } from './helpers/research-web-fakes.mjs';

// ── hook โมดูล: '@/…' → ไฟล์จริงใต้ src หรือตัวปลอม · 'uuid' ปลอม (attemptId คงที่) ───────────────────────
const SB_STUB = 'export const isSupabaseReady = () => globalThis.__QP.sbReady !== false; export const getSupabase = () => globalThis.__QP.sb;';
const hooks = installResearchHooks({
  stubs: {
    '@/lib/supabase': SB_STUB,
    '@/lib/persistStore': 'export const createStore = (...a) => globalThis.__QP.createStore(...a);',
    // /api/queue/status import จากโมดูลนี้ — ตัวปลอมคุม overview ได้ (queueService ตัวจริงโหลดตรงด้วย file URL ไม่ผ่าน specifier นี้)
    '@/lib/services/queueService': [
      'export const getJobStatus = (...a) => globalThis.__QP.getJobStatus(...a);',
      'export const getQueueOverview = (...a) => globalThis.__QP.getQueueOverview(...a);',
      'export const cleanupStaleJobs = (...a) => globalThis.__QP.cleanupStaleJobs(...a);',
    ].join('\n'),
    '@/lib/logger': 'export const createLogger = (name) => new Proxy({}, { get: (_, level) => (...a) => globalThis.__QP.routeLogs.push(name + ":" + String(level) + ":" + a.join(" ")) });',
    uuid: 'export const v4 = () => globalThis.__QP.uuid();',
  },
  parentStubs: [{ specifier: '../supabase.js', parentEndsWith: '/lib/services/queueService.js', source: SB_STUB }],
});

// '@/lib/services/queueConcurrency' → ตัวห่อของจริง: จดค่าที่ตัวช่วยคืนทุกครั้ง (พิสูจน์ "ไม่ตั้ง env = ไม่เรียกตัวช่วย")
const CONC_FILE_URL = srcUrl('lib/services/queueConcurrency.js');
const CONC_WRAPPER = [
  `import * as real from ${JSON.stringify(CONC_FILE_URL)};`,
  `export * from ${JSON.stringify(CONC_FILE_URL)};`,
  'export function getNewsConcurrency(env) {',
  '  const value = real.getNewsConcurrency(env);',
  '  if (globalThis.__QP) globalThis.__QP.concCalls.push(value);',
  '  return value;',
  '}',
].join('\n');
hooks.overrides.set('@/lib/services/queueConcurrency', `data:text/javascript,${encodeURIComponent(CONC_WRAPPER)}`);

// '@/lib/research-agent/queueHold' (W3 · queueService dynamic import ในโหมด write) → ตัวห่อของจริง: จดงานที่ส่งเข้า + ฉีดนาฬิกา/timer ปลอม
const HOLD_FILE_URL = srcUrl('lib/research-agent/queueHold.js');
const HOLD_WRAPPER = [
  `import * as real from ${JSON.stringify(HOLD_FILE_URL)};`,
  `export * from ${JSON.stringify(HOLD_FILE_URL)};`,
  'export async function applyResearchHold(jobs, options = {}) {',
  '  globalThis.__QP.holdCalls.push(Array.isArray(jobs) ? jobs.map((j) => j && j.id) : null);',
  '  return real.applyResearchHold(jobs, { ...options, ...(globalThis.__QP.holdOpts || {}) });',
  '}',
].join('\n');
hooks.overrides.set('@/lib/research-agent/queueHold', `data:text/javascript,${encodeURIComponent(HOLD_WRAPPER)}`);

// queueService ตั้ง setInterval 60 วิ (watchdog) ตอนโหลดถ้ายังไม่มี — กันไว้ก่อน import (ไม่มี timer จริงในเทส)
globalThis.__queueWatchdog = globalThis.__queueWatchdog || 'disabled-in-test';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SRC = Object.freeze({
  conc: read('src/lib/services/queueConcurrency.js'),
  queue: read('src/lib/services/queueService.js'),
  status: read('src/app/api/queue/status/route.js'),
  worker: read('src/app/api/queue/worker/route.js'),
  env: read('.env.example'),
  doc: read('docs/RESEARCH-AGENT.md'),
  suite: read('tests/news-suite.json'),
});

const concMod = await import(CONC_FILE_URL);
const queueMod = await import(srcUrl('lib/services/queueService.js'));
const statusRoute = await import(srcUrl('app/api/queue/status/route.js'));

// ── ค่าคงที่/ของปลอมร่วม ─────────────────────────────────────────────
const NOW = Date.UTC(2026, 9, 2, 6, 30, 0); // 13:30 เวลาไทย (เวลาที่เจ้าของสั่ง)
const SEC = 1000;
const MIN = 60 * SEC;
const C3 = Object.freeze({ QUEUE_NEWS_CONCURRENCY: '3' });
const WRITE = Object.freeze({ RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'write' });
const iso = (ms) => new Date(ms).toISOString();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const flush = () => new Promise((resolve) => setImmediate(resolve));
let seq = 0;
const tag = (name) => `${name}-${++seq}`;
const ids = (jobs) => jobs.map((j) => j.id);
const pad2 = (n) => String(n).padStart(2, '0');

function newsJob(id, minutesAgo, extra = {}) {
  return {
    id, userId: 'discord-bot', payload: { input: `ข่าวทดสอบ ${id}`, jobType: 'news' }, status: 'pending', attemptId: null,
    position: 1, result: null, error: null, createdAt: iso(NOW - minutesAgo * MIN), startedAt: null, completedAt: null, ...extra,
  };
}
const coverJob = (id, minutesAgo) => ({ ...newsJob(id, minutesAgo), payload: { input: 'ปกทดสอบ', jobType: 'cover' } });
const mineclipJob = (id, minutesAgo) => ({ ...newsJob(id, minutesAgo), payload: { input: 'https://www.youtube.com/watch?v=abc', jobType: 'mineclip' } });
/** งานที่กำลังวิ่ง (processing) — เริ่มเมื่อ startedMinAgo นาทีก่อน */
const running = (job, startedMinAgo = 1) => ({ ...job, status: 'processing', attemptId: `run-${job.id}`, startedAt: iso(NOW - startedMinAgo * MIN) });
const newsBatch = (n, prefix = 'q_news', oldestMin = 30) => Array.from({ length: n }, (_, i) => newsJob(`${prefix}${pad2(i + 1)}`, oldestMin - i));
const runBatch = (n) => Array.from({ length: n }, (_, i) => running(newsJob(`q_run0${pad2(i + 1)}`, 90 - i), 5));

/** ใบขอค้นคว้ารูปสัญญา 2.1 — ageMs = อายุ ณ NOW (แบบ tests/research-queue-hold.test.mjs) */
function researchRequest(jobId, { status = 'queued', ageMs = 45 * SEC, deadlineMin = 15, ...extra } = {}) {
  const created = NOW - ageMs;
  return {
    id: jobId, workflowId: `unify_${jobId}`, rawText: 'เนื้อข่าว', sourceUrls: [], userId: 'discord-bot', status,
    attempt: status === 'queued' ? 0 : 1, createdAt: iso(created), deadlineAt: iso(created + deadlineMin * MIN), revision: 1, ...extra,
  };
}
const workerSeen = (agoMs, workerId = 'w-main') => ({ id: workerId, workerId, lastSeenAt: iso(NOW - agoMs), lastEvent: 'lease', revision: 2 });

/** timer ปลอม (ตัวช่วย hold ฉีดใช้แทน setTimeout จริง) — ในเทสนี้ไม่มีใครยิง · จดไว้พิสูจน์ว่าไม่ค้าง */
function fakeTimers() {
  const live = new Set();
  return {
    setTimer(fn, ms) { const t = { fn, ms }; live.add(t); return t; },
    clearTimer(t) { live.delete(t); },
    pending: () => live.size,
  };
}

/**
 * โลกปลอม: ตาราง store_items ในหน่วยความจำ (job_queue + research-requests + research-workers) · Supabase ปลอมที่รองรับทั้ง
 * claim แบบ CAS ของ queueService (single/filter/update+select) และ getDoc/listDocs ของ research-agent/store.js (maybeSingle/order/limit)
 * calls = คำสั่งฐานตามลำดับ · storeCalls = คำสั่ง queue store (getAll/update) ตามลำดับ
 */
function makeWorld({ jobs = [], requests = [], workers = [workerSeen(20 * SEC)] } = {}) {
  const rows = new Map();
  const calls = [];
  const storeCalls = [];
  for (const job of jobs) rows.set(job.id, { id: job.id, store_name: 'job_queue', data: clone(job), updated_at: job.createdAt });
  for (const r of requests) rows.set(`rreq_${r.id}`, { id: `rreq_${r.id}`, store_name: 'research-requests', data: clone(r), updated_at: r.createdAt });
  for (const w of workers) rows.set(`rworker_${w.workerId}`, { id: `rworker_${w.workerId}`, store_name: 'research-workers', data: clone(w), updated_at: w.lastSeenAt });
  const field = (row, col) => {
    if (col === 'id' || col === 'store_name' || col === 'updated_at') return row[col] ?? null;
    const m = /^data->>(\w+)$/.exec(col);
    if (!m) throw new Error(`fake sb: column ${col}`);
    const v = row.data?.[m[1]];
    return v === undefined || v === null ? null : String(v);
  };
  const world = {
    rows, calls, storeCalls, timers: fakeTimers(),
    job: (id) => clone(rows.get(id)?.data ?? null),
    snapshot: () => [...rows.values()].map((r) => clone(r)),
  };
  function exec(st) {
    calls.push({ op: st.op, eqs: clone(st.eqs) });
    const hit = [...rows.values()].filter((row) => st.eqs.every(([col, val]) => field(row, col) === (val === null ? null : String(val))));
    if (st.op === 'update') {
      for (const row of hit) Object.assign(row, clone(st.payload));
      return { data: hit.map((r) => (st.returning === 'data' ? { data: clone(r.data) } : { id: r.id })), error: null };
    }
    if (st.op !== 'select') throw new Error(`fake sb: op ${st.op}`);
    let list = hit;
    if (st.order) {
      const [col, asc] = st.order;
      list = [...list].sort((a, b) => (String(field(a, col)) < String(field(b, col)) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (Number.isInteger(st.limit)) list = list.slice(0, st.limit);
    const shaped = list.map((r) => (st.cols === 'data' ? { data: clone(r.data) } : { id: r.id, data: clone(r.data) }));
    if (st.single) return shaped.length ? { data: shaped[0], error: null } : { data: null, error: { message: 'not found' } };
    if (st.maybe) return { data: shaped[0] ?? null, error: null };
    return { data: shaped, error: null };
  }
  world.sb = {
    from(table) {
      assert.equal(table, 'store_items');
      const st = { op: 'select', cols: null, returning: null, eqs: [], single: false, maybe: false, order: null, limit: null, payload: null };
      const api = {
        select(cols) { if (st.op === 'select') st.cols = cols; else st.returning = cols; return api; },
        eq(col, val) { st.eqs.push([col, val]); return api; },
        filter(col, op, val) { assert.equal(op, 'eq'); st.eqs.push([col, val]); return api; },
        order(col, opts = {}) { st.order = [col, opts.ascending !== false]; return api; },
        limit(n) { st.limit = n; return api; },
        single() { st.single = true; return api; },
        maybeSingle() { st.maybe = true; return api; },
        update(payload) { st.op = 'update'; st.payload = payload; return api; },
        then(resolve, reject) { return Promise.resolve().then(() => exec(st)).then(resolve, reject); },
      };
      return api;
    },
  };
  world.queueStore = {
    async getAll() { storeCalls.push(['getAll']); return [...rows.values()].filter((r) => r.store_name === 'job_queue').map((r) => clone(r.data)); },
    async findById(id) { storeCalls.push(['findById', id]); const r = rows.get(id); return r && r.store_name === 'job_queue' ? clone(r.data) : null; },
    async update(id, fn) { storeCalls.push(['update', id]); const r = rows.get(id); const next = fn(clone(r.data)); r.data = clone(next); return clone(next); },
  };
  return world;
}

/** สถานะร่วมของ stub ('@/lib/supabase' · persistStore · uuid · queueService ของ route · ตัวห่อเพดาน/hold · logger) */
function freshState(world, extra = {}) {
  let n = 0;
  const state = {
    sb: world.sb, sbReady: true, createStore: () => world.queueStore, uuid: () => `attempt-${++n}`,
    holdOpts: { now: () => NOW, timers: world.timers }, holdCalls: [], concCalls: [], routeLogs: [],
    getJobStatus: async () => null,
    getQueueOverview: async () => ({ pending: 0, processing: 0, total: 0, busy: false, estimatedWaitMinutes: 0 }),
    cleanupStaleJobs: async () => 0,
    ...extra,
  };
  globalThis.__QP = state;
  return state;
}

const ENV_KEYS = Object.freeze(['QUEUE_NEWS_CONCURRENCY', 'QUEUE_LOCAL_NEWS', 'QUEUE_COVER_ON_VERCEL', 'QUEUE_ATOMIC_CLAIM',
  'RESEARCH_AGENT', 'RESEARCH_AGENT_MODE', 'RESEARCH_AGENT_HOLD_MS', 'RESEARCH_AGENT_WAIT_MS']);
/** ตั้ง env เฉพาะรอบนี้ (ล้างทุกคีย์ที่เกี่ยวก่อน → ไม่ขึ้นกับ env ของเครื่องที่รันเทส) แล้วคืนค่าเดิมเสมอ */
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

/** แกล้งเป็นเครื่อง Vercel (linux) / เครื่องทีม (win32) ตลอดการเรียกหนึ่งครั้ง แล้วคืนของเดิมเสมอ (CI ubuntu กับเครื่อง Windows ได้ผลเดียวกัน) */
async function withPlatform(platform, fn) {
  if (process.platform === platform) return fn();
  const desc = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...desc, value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', desc);
  }
}

/** จับ console ระหว่าง fn (queueService log ผ่าน console ตรง) แล้วคืนของเดิมเสมอ */
async function captureConsole(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => lines.push(`log:${a.map(String).join(' ')}`);
  console.warn = (...a) => lines.push(`warn:${a.map(String).join(' ')}`);
  console.error = (...a) => lines.push(`error:${a.map(String).join(' ')}`);
  try {
    const value = await fn();
    return { value, lines };
  } finally {
    Object.assign(console, saved);
  }
}

/** เวลาจริงที่ queueService ใส่ตอน claim (new Date()) → ค่าคงที่ ก่อนเทียบ 2 ฉบับ */
function normalizeTimes(value) {
  if (Array.isArray(value)) return value.map(normalizeTimes);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
    (['startedAt', 'updatedAt', 'updated_at'].includes(k) && typeof v === 'string' && v) ? '<time>' : normalizeTimes(v)]));
}

/** เรียก getNextPendingJobs หนึ่งครั้งบนโลกปัจจุบัน (globalThis.__QP) */
async function callQueue(mod, { env = {}, platform = 'linux', limit = 1 } = {}) {
  return settleWithin(
    withPlatform(platform, () => withEnv(env, () => captureConsole(() => mod.getNextPendingJobs(limit)))),
    `getNextPendingJobs(${limit}) ${platform} ${JSON.stringify(env)}`,
    5_000,
  );
}

/** โลกใหม่ + เรียกหนึ่งครั้ง → { claimed, lines, world, st } */
async function runQueue(mod, spec, opts = {}) {
  const world = makeWorld(clone(spec));
  const st = freshState(world);
  const { value, lines } = await callQueue(mod, opts);
  return { claimed: value, lines, world, st };
}

/**
 * เรียกครั้งแรกของโมดูลบน win32 = startup-reset (งานปก/คลิปค้าง processing → pending · ครั้งเดียวต่อโมดูล) — วอร์มด้วยโลกว่างก่อน
 * ทุกฉบับ (ตัวจริง/สำเนา/ฉบับถอด/กลายพันธุ์) จึงเริ่มสถานะเดียวกัน ไม่ขึ้นกับว่าเครื่องที่รันเทสเป็น Windows หรือ Linux
 */
async function warm(mod) {
  freshState(makeWorld({}));
  await callQueue(mod, { platform: 'win32' });
  return mod;
}
await warm(queueMod);

const queueImportable = (src) => replaceOnce(src, "from '../supabase.js';", "from '@/lib/supabase';", 'queueService supabase import');
const loadQueueCopy = async (src, name) => warm(await importSource(queueImportable(src), tag(name)));

// ── ซอร์สที่ถอด W6 (ฉบับก่อนแก้ทุกไบต์) ──────────────────────────────────────
/** ตัดบล็อก [บรรทัดที่มี marker … ถึงโค้ด code (ตรงทุกตัวอักษร)] แทนด้วย before · บรรทัดคั่นกลางต้องเป็นคอมเมนต์ล้วน (กันตัดโค้ดจริงทิ้งเงียบๆ) */
function replaceBlock(src, marker, code, before, label) {
  const at = src.indexOf(marker);
  assert.ok(at >= 0 && src.indexOf(marker, at + 1) === -1, `${label}: marker ต้องเจอครั้งเดียว`);
  const lineStart = src.lastIndexOf('\n', at) + 1;
  const codeAt = src.indexOf(code, lineStart);
  assert.ok(codeAt >= lineStart, `${label}: ไม่เจอโค้ดหลัง marker`);
  const between = src.slice(lineStart, codeAt).split('\n').filter((l) => l !== '');
  assert.ok(between.length > 0 && between.every((l) => /^\s*\/\//.test(l)), `${label}: ระหว่าง marker กับโค้ดต้องเป็นคอมเมนต์ล้วน`);
  return src.slice(0, lineStart) + before + src.slice(codeAt + code.length);
}
const W6_TRACE = /W6|getNewsConcurrency|QUEUE_NEWS_CONCURRENCY|queueConcurrency|_teamCapOn|_teamNext|newsMax/;

const Q_MAX_NOW = [
  '    const maxConcurrency = (process.env.QUEUE_NEWS_CONCURRENCY !== undefined && (!isLocalMachine || localNewsOverride))',
  '      ? getNewsConcurrency(process.env)',
  '      : 1;',
  '',
].join('\n');
const Q_TEAM_NOW = [
  '    const _teamCapOn = maxConcurrency > 1;',
  "    const _teamNext = _teamCapOn && !allJobs.some(j => j.status === 'processing' && canRunHere(j) && !isNewsJob(j))",
  '      ? (allJobs',
  "        .filter(j => j.status === 'pending' && canRunHere(j) && !isNewsJob(j))",
  '        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] ?? null)',
  '      : null;',
  '',
].join('\n');
const Q_FILTER_NOW = "      .filter(j => j.status === 'pending' && canRunHere(j) && (!_teamCapOn || isNewsJob(j) || j === _teamNext)) // ★ W6 ของเดิม: .filter(j => j.status === 'pending' && canRunHere(j))\n";
const Q_FILTER_BEFORE = "      .filter(j => j.status === 'pending' && canRunHere(j))\n";

function stripQueueW6(src) {
  let out = replaceBlock(src, '// ★ 2 ต.ค. 69 (ท่อข่าวขนาน · SPEC-v3 ส่วน 11 · W6): เพดานงานข่าวพร้อมกันต่อเครื่อง',
    "import { getNewsConcurrency } from '@/lib/services/queueConcurrency';\n", '', 'queue import');
  out = replaceBlock(out, '    // ★ 2 ต.ค. 69 (ท่อข่าวขนาน · SPEC-v3 ส่วน 11 · W6): เจ้าของสั่ง', Q_MAX_NOW, '    const maxConcurrency = 1;\n', 'queue max');
  out = replaceBlock(out, '    // ★ 2 ต.ค. 69 (ท่อข่าวขนาน · SPEC-v3 ส่วน 11 · W6): เพดาน > 1 ใช้กับ', Q_TEAM_NOW, '', 'queue team cap');
  out = replaceOnce(out, Q_FILTER_NOW, Q_FILTER_BEFORE, 'queue pending filter');
  assert.ok(!W6_TRACE.test(out), 'ถอดแล้วต้องไม่เหลือร่องรอย W6');
  assert.ok(out.includes('    const maxConcurrency = 1;\n') && out.includes('applyResearchHold'), 'ฉบับถอด W6 = ค่าคงที่ 1 เดิม + hold ของ W3 ยังอยู่');
  return out;
}

const S_HEAL_NOW = [
  '        const newsMax = getNewsConcurrency(process.env); // ★ W6: ไม่ตั้ง env = 1',
  '        if (ov.pending > 0 && ov.processing < newsMax) {',
  '          logger.info(ov.processing === 0 // ★ W6: ไม่มีงานวิ่ง = ข้อความเดิมทุกไบต์ · มีงานวิ่งแต่ยังมีช่อง = บอกจำนวนที่วิ่ง/เพดาน',
  '            ? `[Queue Status] 🚑 Self-heal: ${ov.pending} pending แต่ไม่มี worker วิ่ง — ปลุก worker`',
  '            : `[Queue Status] 🚑 Self-heal: ${ov.pending} pending · วิ่งอยู่ ${ov.processing}/${newsMax} งาน — ปลุก worker หยิบงานเพิ่ม`);',
  '',
].join('\n');
const S_HEAL_BEFORE = [
  '        if (ov.pending > 0 && ov.processing === 0) {',
  '          logger.info(`[Queue Status] 🚑 Self-heal: ${ov.pending} pending แต่ไม่มี worker วิ่ง — ปลุก worker`);',
  '',
].join('\n');

function stripRouteW6(src) {
  let out = replaceBlock(src, '// ★ 2 ต.ค. 69 (ท่อข่าวขนาน · SPEC-v3 ส่วน 11 · W6): เพดานงานข่าวพร้อมกัน — ตัวช่วยเดียวกับตัวหยิบงาน',
    "import { getNewsConcurrency } from '@/lib/services/queueConcurrency';\n", '', 'route import');
  out = replaceBlock(out, '    // ★ 2 ต.ค. 69 (ท่อข่าวขนาน · SPEC-v3 ส่วน 11 · W6): ปลุกเมื่อ',
    '    if (now - _lastReviveAt > 20_000) {\n', '    if (now - _lastReviveAt > 20_000) {\n', 'route heal comment');
  out = replaceOnce(out, S_HEAL_NOW, S_HEAL_BEFORE, 'route heal');
  assert.ok(!W6_TRACE.test(out), 'ถอดแล้วต้องไม่เหลือร่องรอย W6');
  assert.ok(out.includes('researchHold'), 'ฉบับถอด W6 ยังมีช่อง researchHold ของ W3');
  return out;
}

// ============================================================
// A. ตัวช่วย getNewsConcurrency
// ============================================================
async function checkHelper(m) {
  const g = m.getNewsConcurrency;
  const cases = [
    [undefined, 1, 'ไม่ตั้ง'], ['', 1, 'ว่าง'], ['   ', 1, 'ช่องว่างล้วน'], ['abc', 1, 'อ่านไม่ได้'], ['3abc', 1, 'ตัวเลขปนตัวอักษร'],
    ['0', 1, 'ศูนย์'], ['-1', 1, 'ติดลบ'], ['0.5', 1, 'ทศนิยมต่ำกว่า 1'], ['Infinity', 1, 'อนันต์'], ['NaN', 1, 'NaN'],
    ['1', 1, 'หนึ่ง'], ['2', 2, 'สอง'], ['3', 3, 'สาม'], ['8', 8, 'ค่าแผน production'], ['10', 10, 'เพดานพอดี'],
    ['11', 10, 'เกินเพดาน'], ['99', 10, 'เพดาน 10'], ['1e3', 10, 'สัญกรณ์วิทยาศาสตร์'],
    ['2.9', 2, 'ทศนิยมปัดลง'], [' 4 ', 4, 'space หัวท้าย'], ['"5"', 5, 'คำพูดคู่จาก Vercel'], ["'6'", 6, 'คำพูดเดี่ยว'], [' "7" ', 7, 'space + คำพูด'],
  ];
  for (const [raw, want, label] of cases) {
    const env = raw === undefined ? {} : { QUEUE_NEWS_CONCURRENCY: raw };
    assert.equal(g(env), want, `${label}: ${JSON.stringify(raw)} → ${want}`);
  }
  assert.equal(g(null), 1, 'env null = 1');
  assert.equal(g({ get QUEUE_NEWS_CONCURRENCY() { throw new Error('boom'); } }), 1, 'อ่าน env แล้วโยน = 1 (ไม่โยนต่อ)');
  assert.equal(await withEnv({}, () => g()), 1, 'ไม่ส่ง env = อ่าน process.env (ไม่ตั้ง = 1)');
  assert.equal(await withEnv({ QUEUE_NEWS_CONCURRENCY: '5' }, () => g()), 5, 'ไม่ส่ง env = อ่าน process.env ตอนเรียก');
  assert.equal(m.QUEUE_NEWS_CONCURRENCY_DEFAULT, 1);
  assert.equal(m.QUEUE_NEWS_CONCURRENCY_MAX, 10);
}

test('A1 getNewsConcurrency: ไม่ตั้ง/ว่าง/อ่านไม่ได้/0/-1 = 1 · 99 = 10 · ทศนิยมปัดลง · ทน space/คำพูด · ไม่โยน · อ่าน env ตอนเรียก', async () => {
  await checkHelper(concMod);
});

test('A2 queueConcurrency.js เป็นไฟล์ pure (ไม่มี import) · ทั้งตัวหยิบงานและ /api/queue/status ใช้ตัวช่วยตัวเดียวกัน (ไม่เขียนสูตรอ่าน env ซ้ำ)', () => {
  assert.ok(!/^\s*import\s/m.test(SRC.conc) && !/\bimport\(/.test(SRC.conc), 'ตัวช่วยต้องไม่มี import');
  const line = "import { getNewsConcurrency } from '@/lib/services/queueConcurrency';";
  assert.equal(SRC.queue.split(line).length - 1, 1, 'queueService import ตัวช่วย');
  assert.equal(SRC.status.split(line).length - 1, 1, 'queue/status import ตัวช่วย');
  for (const [name, src] of [['queueService', SRC.queue], ['queue/status', SRC.status]]) {
    const reads = src.match(/QUEUE_NEWS_CONCURRENCY/g) || [];
    const parses = src.match(/getNewsConcurrency\(process\.env\)/g) || [];
    assert.equal(parses.length, 1, `${name}: เรียกตัวช่วยจุดเดียว`);
    assert.ok(!/parseInt|Number\(process\.env\.QUEUE_NEWS_CONCURRENCY/.test(src), `${name}: ห้ามแปลงค่า env เอง`);
    assert.ok(reads.length >= 1, `${name}: อ้างชื่อ env ในคอมเมนต์/ตัวเช็ค`);
  }
});

// ============================================================
// B. getNextPendingJobs ตัวจริง
// ============================================================
const PARITY_ENVS = Object.freeze([
  ['ไม่ตั้ง', {}],
  ["ว่าง ''", { QUEUE_NEWS_CONCURRENCY: '' }],
  ["'1'", { QUEUE_NEWS_CONCURRENCY: '1' }],
  ["'abc'", { QUEUE_NEWS_CONCURRENCY: 'abc' }],
  ["'0'", { QUEUE_NEWS_CONCURRENCY: '0' }],
  ["'-1'", { QUEUE_NEWS_CONCURRENCY: '-1' }],
]);
/** [ชื่อ, platform, env ของเครื่อง, หยิบข่าวได้ไหม] */
const MACHINES = Object.freeze([
  ['Vercel (linux)', 'linux', {}, true],
  ['เครื่องทีม (win32)', 'win32', {}, false],
  ['เครื่องทีม + QUEUE_LOCAL_NEWS=1', 'win32', { QUEUE_LOCAL_NEWS: '1' }, true],
  ['Vercel + QUEUE_COVER_ON_VERCEL=1', 'linux', { QUEUE_COVER_ON_VERCEL: '1' }, true],
]);
const PARITY_WORLDS = () => [
  { jobs: [newsJob('q_news03', 3), newsJob('q_news01', 5), newsJob('q_news02', 4)] },
  { jobs: [running(newsJob('q_run001', 9)), newsJob('q_news01', 5), newsJob('q_news02', 4)] },
  { jobs: [coverJob('q_cover1', 6), newsJob('q_news01', 5), mineclipJob('q_mine01', 4), coverJob('q_cover2', 3)] },
  { jobs: [running(coverJob('q_cvrun1', 9)), coverJob('q_cover1', 6), newsJob('q_news01', 5)] },
  { jobs: [running(newsJob('q_run001', 9)), running(newsJob('q_run002', 8)), coverJob('q_cover1', 6), newsJob('q_news01', 5)] },
  { jobs: [newsJob('q_fbreel', 5, { payload: { input: 'https://www.facebook.com/reel/123456', jobType: 'news' } }), newsJob('q_news01', 4)] },
  { jobs: [] },
];

async function checkUnsetParity(current, legacy) {
  let compared = 0;
  for (const [envLabel, envVars] of PARITY_ENVS) {
    for (const [machine, platform, machineEnv, canPickNews] of MACHINES) {
      for (const [i, spec] of PARITY_WORLDS().entries()) {
        for (const limit of [1, 3]) {
          const opts = { env: { ...machineEnv, ...envVars }, platform, limit };
          const a = await runQueue(current, spec, opts);
          const b = await runQueue(legacy, spec, opts);
          const where = `${envLabel} · ${machine} · โลก #${i} · limit ${limit}`;
          assert.deepEqual(normalizeTimes(clone(a.claimed)), normalizeTimes(clone(b.claimed)), `${where}: งานที่หยิบ`);
          assert.deepEqual(normalizeTimes(a.world.snapshot()), normalizeTimes(b.world.snapshot()), `${where}: แถวหลังหยิบ`);
          assert.deepEqual(a.lines, b.lines, `${where}: log`);
          assert.deepEqual(a.world.calls, b.world.calls, `${where}: คำสั่งฐาน`);
          assert.deepEqual(a.world.storeCalls, b.world.storeCalls, `${where}: คำสั่ง store`);
          const helperExpected = Object.hasOwn(envVars, 'QUEUE_NEWS_CONCURRENCY') && canPickNews ? [1] : [];
          assert.deepEqual(a.st.concCalls, helperExpected, `${where}: ${helperExpected.length ? 'ตัวช่วยคืน 1' : 'ไม่ตั้ง env/เครื่องหยิบข่าวไม่ได้ = ไม่เรียกตัวช่วย'}`);
          compared += 1;
        }
      }
    }
  }
  return compared;
}

test('B1 ไม่ตั้ง QUEUE_NEWS_CONCURRENCY (และค่าที่ได้ 1): ผลเท่าซอร์สที่ถอด W6 ทุกไบต์ — งานที่หยิบ/แถว/log/คำสั่งฐาน/คำสั่ง store · ไม่ตั้ง = ไม่เรียกตัวช่วย', async (t) => {
  const legacy = await loadQueueCopy(stripQueueW6(SRC.queue), 'queue-legacy');
  const current = await loadQueueCopy(SRC.queue, 'queue-current');
  const copies = await checkUnsetParity(current, legacy);
  const real = await checkUnsetParity(queueMod, legacy); // ไฟล์จริง (import '../supabase.js' ผ่าน hook ของ parent) ต้องได้ผลเดียวกัน
  t.diagnostic(`เทียบซอร์สที่ถอด W6: สำเนา ${copies} กรณี + ไฟล์จริง ${real} กรณี (ค่า env ${PARITY_ENVS.length} × เครื่อง ${MACHINES.length} × โลก ${PARITY_WORLDS().length} × limit 2)`);
  assert.equal(copies, PARITY_ENVS.length * MACHINES.length * PARITY_WORLDS().length * 2);
  // ควบคุม: ตั้ง =3 ด้วยโลกเดียวกัน ฉบับปัจจุบันต้องต่างจากซอร์สที่ถอด W6 (เทสนี้มองเห็นการเปลี่ยนจริง)
  const spec = { jobs: newsBatch(4) };
  const a = await runQueue(current, spec, { env: C3, limit: 3 });
  const b = await runQueue(legacy, spec, { env: C3, limit: 3 });
  assert.deepEqual([ids(a.claimed), ids(b.claimed)], [['q_news01', 'q_news02', 'q_news03'], ['q_news01']]);
});

async function checkParallelPick(mod) {
  // ตารางเรียงสลับ — ต้องหยิบตาม createdAt (เก่าสุดก่อน)
  const spec = { jobs: [newsJob('q_news03', 3), newsJob('q_news01', 5), newsJob('q_news05', 1), newsJob('q_news02', 4), newsJob('q_news04', 2)] };
  const r = await runQueue(mod, spec, { env: C3, limit: 3 });
  assert.deepEqual(ids(r.claimed), ['q_news01', 'q_news02', 'q_news03'], '=3 + ไม่มีงานวิ่ง → หยิบ 3 งานเก่าสุดตามลำดับ createdAt');
  assert.deepEqual(r.claimed.map((j) => [j.status, j.attemptId]), [['processing', 'attempt-1'], ['processing', 'attempt-2'], ['processing', 'attempt-3']]);
  for (const id of ['q_news01', 'q_news02', 'q_news03']) assert.equal(r.world.job(id).status, 'processing', `${id}: claim ลงฐาน`);
  for (const id of ['q_news04', 'q_news05']) assert.equal(r.world.job(id).status, 'pending', `${id}: ยังรอ`);
  assert.ok(r.lines.includes('log:[QueueService] 🔄 Claimed 3 job(s): q_news01, q_news02, q_news03'), r.lines.join('\n'));
  assert.ok(!r.lines.some((l) => l.includes('Concurrency limit')));
  assert.deepEqual(r.st.concCalls, [3], 'เรียกตัวช่วยครั้งเดียวต่อรอบ');
}

async function checkWorkerOneAtATime(mod) {
  const world = makeWorld({ jobs: newsBatch(5) });
  freshState(world);
  const rounds = [];
  for (let i = 0; i < 4; i += 1) rounds.push(await callQueue(mod, { env: C3, limit: 1 }));
  assert.deepEqual(rounds.map((r) => ids(r.value)), [['q_news01'], ['q_news02'], ['q_news03'], []],
    'worker ขอ limit=1 ต่อครั้ง → 3 invocation = 3 ข่าววิ่งพร้อมกัน · ครั้งที่ 4 เต็มเพดาน');
  assert.ok(rounds[3].lines.includes('log:[QueueService] ⏸️ Concurrency limit (เครื่องนี้) 3/3 — งานเครื่องอื่นไม่นับ'), 'log แสดงเพดานใหม่');
  await world.queueStore.update('q_news01', (j) => ({ ...j, status: 'completed' })); // ข่าวแรกเขียนเสร็จ → ว่าง 1 ช่อง
  const next = await callQueue(mod, { env: C3, limit: 1 });
  assert.deepEqual(ids(next.value), ['q_news04'], 'ช่องว่าง = หยิบงานถัดไปทันที');
}

test('B2 QUEUE_NEWS_CONCURRENCY=3: หยิบได้ 3 ตามลำดับ createdAt เมื่อ processingHere 0 · worker (limit=1) หยิบทีละงานจนเต็ม 3 แล้ว log "3/3"', async () => {
  await checkParallelPick(queueMod);
  await checkWorkerOneAtATime(queueMod);
});

async function checkProcessingHere(mod) {
  const two = await runQueue(mod, { jobs: [...runBatch(2), ...newsBatch(3)] }, { env: C3, limit: 3 });
  assert.deepEqual(ids(two.claimed), ['q_news01'], 'processing 2 → ว่าง 1 ช่อง → หยิบ 1 (แม้ขอ 3)');
  const three = await runQueue(mod, { jobs: [...runBatch(3), ...newsBatch(2)] }, { env: C3, limit: 3 });
  assert.deepEqual(three.claimed, [], 'processing 3 = เต็ม');
  assert.ok(three.lines.includes('log:[QueueService] ⏸️ Concurrency limit (เครื่องนี้) 3/3 — งานเครื่องอื่นไม่นับ'));
  // ปกที่วิ่งบนเครื่องทีมไม่กินช่องข่าวของ Vercel (นับแยกตามเครื่องเหมือนเดิม)
  const mixed = await runQueue(mod, { jobs: [running(coverJob('q_cvrun1', 9)), ...runBatch(2), ...newsBatch(2)] }, { env: C3, limit: 3 });
  assert.deepEqual(ids(mixed.claimed), ['q_news01'], 'Vercel นับเฉพาะข่าวที่วิ่ง (2) → ว่าง 1');
}

test('B3 processingHere นับจากแถวจริงทุกครั้ง: processing 2 → หยิบ 1 · 3 → [] + log 3/3 · ปกบนเครื่องทีมไม่กินช่องข่าว', async () => {
  await checkProcessingHere(queueMod);
});

async function checkHoldFill(mod) {
  const env = { ...C3, ...WRITE };
  const spec = () => ({
    jobs: [newsJob('q_hold01', 6), newsJob('q_free02', 5), newsJob('q_hold03', 4), newsJob('q_free04', 3), newsJob('q_free05', 2), newsJob('q_free06', 1)],
    requests: [
      researchRequest('q_hold01'), researchRequest('q_free02', { status: 'done' }), researchRequest('q_hold03', { status: 'leased' }),
      researchRequest('q_free05', { status: 'failed' }),
    ],
  });
  const r = await runQueue(mod, spec(), { env, limit: 3 });
  assert.deepEqual(ids(r.claimed), ['q_free02', 'q_free04', 'q_free05'], 'งานที่รอรีเสิร์ชถูกข้าม · เติมช่องด้วยงานถัดไปที่ไม่ hold ตามลำดับ');
  for (const id of ['q_hold01', 'q_hold03', 'q_free06']) assert.equal(r.world.job(id).status, 'pending', `${id}: ยัง pending`);
  assert.deepEqual(r.st.holdCalls, [['q_hold01', 'q_free02', 'q_hold03', 'q_free04', 'q_free05', 'q_free06']], 'ตัวช่วย hold ได้งาน pending ทั้งหมด (ก่อน slice)');
  assert.deepEqual(r.lines.filter((l) => l.includes('⏳')), ['log:[QueueService] ⏳ hold q_hold01 รอรีเสิร์ช (อายุ 45s/360s) · q_hold03 (อายุ 45s/360s)']);
  assert.equal(r.world.timers.pending(), 0, 'timer ปลอมของตัวช่วยถูก clear (ไม่มี timer จริง)');
  // มีข่าววิ่งอยู่ 2 → ว่าง 1 ช่อง → งานแรกที่ไม่ hold
  const busy = await runQueue(mod, { ...spec(), jobs: [...runBatch(2), ...spec().jobs] }, { env, limit: 3 });
  assert.deepEqual(ids(busy.claimed), ['q_free02']);
  // worker (limit=1) ทีละรอบ → free02 → free04 → free05 → เต็ม 3/3 (งาน hold ไม่นับ processing)
  const world = makeWorld(spec());
  freshState(world);
  const rounds = [];
  for (let i = 0; i < 4; i += 1) rounds.push(await callQueue(mod, { env, limit: 1 }));
  assert.deepEqual(rounds.map((x) => ids(x.value)), [['q_free02'], ['q_free04'], ['q_free05'], []]);
  assert.ok(rounds[3].lines.includes('log:[QueueService] ⏸️ Concurrency limit (เครื่องนี้) 3/3 — งานเครื่องอื่นไม่นับ'));
}

test('B4 คิวชะลอรีเสิร์ช (W3) + =3: งานที่ hold ถูกข้ามแล้วเติมงานถัดไปจนเต็มช่อง · งาน hold ยัง pending ไม่นับ processing', async () => {
  await checkHoldFill(queueMod);
});

async function checkMalformedEnv(mod) {
  for (const [raw, want] of [['abc', 1], ['0', 1], ['-1', 1], ['99', 10], [' "4" ', 4], ['2.9', 2]]) {
    const r = await runQueue(mod, { jobs: newsBatch(12) }, { env: { QUEUE_NEWS_CONCURRENCY: raw }, limit: 20 });
    assert.equal(r.claimed.length, want, `${JSON.stringify(raw)} → หยิบได้ ${want} งาน`);
    assert.deepEqual(r.st.concCalls, [want]);
    const full = await runQueue(mod, { jobs: [...runBatch(want), newsJob('q_news01', 5)] }, { env: { QUEUE_NEWS_CONCURRENCY: raw }, limit: 1 });
    assert.deepEqual(full.claimed, [], `${JSON.stringify(raw)}: วิ่งอยู่ ${want} = เต็ม`);
    assert.ok(full.lines.includes(`log:[QueueService] ⏸️ Concurrency limit (เครื่องนี้) ${want}/${want} — งานเครื่องอื่นไม่นับ`), `${JSON.stringify(raw)}: log แสดงเพดาน ${want}`);
  }
}

test("B5 ค่าผิดรูป 'abc'/0/-1/99 → เพดาน 1/1/1/10 (+ ' \"4\" ' = 4 · 2.9 = 2) — นับงานที่หยิบ + log Concurrency limit แสดงเพดานใหม่", async () => {
  await checkMalformedEnv(queueMod);
});

async function checkTeamMachine(mod) {
  // เครื่องทีม (win32) ไม่เปิด QUEUE_LOCAL_NEWS: ข่าวไม่ถูกหยิบเหมือนเดิม · เพดานคง 1 แม้ตั้ง env (ไม่อ่านตัวช่วยเลย)
  const r1 = await runQueue(mod, { jobs: [newsJob('q_news01', 9), coverJob('q_cover1', 6), newsJob('q_news02', 5), coverJob('q_cover2', 3)] },
    { env: C3, platform: 'win32', limit: 3 });
  assert.deepEqual(ids(r1.claimed), ['q_cover1'], 'เครื่องทีมหยิบปกได้ทีละ 1');
  for (const id of ['q_news01', 'q_news02', 'q_cover2']) assert.equal(r1.world.job(id).status, 'pending', `${id}: ไม่ถูกหยิบ`);
  assert.ok(r1.lines.includes('log:[QueueService] ⏭️ ข้าม 2 งานที่เป็นของอีกเครื่อง (คลิป→เครื่องทีม | ข่าว→Vercel)'));
  assert.deepEqual(r1.st.concCalls, [], 'เครื่องที่หยิบข่าวไม่ได้ ไม่อ่านเพดานข่าว');
  const r2 = await runQueue(mod, { jobs: [running(coverJob('q_cvrun1', 9)), coverJob('q_cover1', 6), newsJob('q_news01', 5)] },
    { env: C3, platform: 'win32', limit: 1 });
  assert.deepEqual(r2.claimed, [], 'ปกวิ่งอยู่ 1 = เต็ม');
  assert.ok(r2.lines.includes('log:[QueueService] ⏸️ Concurrency limit (เครื่องนี้) 1/1 — งานเครื่องอื่นไม่นับ'), 'เพดานเครื่องทีมคง 1');
}

async function checkTeamCap(mod) {
  const local = { ...C3, QUEUE_LOCAL_NEWS: '1' };
  // เครื่องทีม + QUEUE_LOCAL_NEWS=1 (ทางหนีไฟตอน Vercel ล่ม): ปกวิ่งอยู่ → ข่าวเติมช่องที่เหลือ · ปกงานที่สองรอ (ไม่ค้างหลังปกที่เก่ากว่า)
  const busySpec = { jobs: [running(coverJob('q_cvrun1', 9)), coverJob('q_cover1', 7), newsJob('q_news01', 5), newsJob('q_news02', 4), newsJob('q_news03', 3)] };
  const r3 = await runQueue(mod, busySpec, { env: local, platform: 'win32', limit: 3 });
  assert.deepEqual(ids(r3.claimed), ['q_news01', 'q_news02'], 'ปก 1 + ข่าว 2 = 3 · ปกงานที่สองไม่ถูกหยิบ');
  assert.equal(r3.world.job('q_cover1').status, 'pending');
  const r3w = await runQueue(mod, busySpec, { env: local, platform: 'win32', limit: 1 });
  assert.deepEqual(ids(r3w.claimed), ['q_news01'], 'worker limit=1: ปกเก่ากว่าแต่ปกวิ่งอยู่แล้ว → ข้ามไปหยิบข่าว');
  // ไม่มีงานเครื่องทีมวิ่ง: ปก/คลิปหลายงานรอ → หยิบเฉพาะงานเก่าสุดงานเดียว + ข่าวเติมช่อง
  const r4 = await runQueue(mod, { jobs: [coverJob('q_cover1', 7), mineclipJob('q_mine01', 6), newsJob('q_news01', 5)] }, { env: local, platform: 'win32', limit: 3 });
  assert.deepEqual(ids(r4.claimed), ['q_cover1', 'q_news01'], 'ปก/คลิปทีละ 1 · ข่าวเติมช่อง');
  assert.equal(r4.world.job('q_mine01').status, 'pending');
  // Vercel + QUEUE_COVER_ON_VERCEL=1: ปก (ไม่มีลิงก์คลิป) วิ่งบน Vercel ได้ แต่ทีละ 1 เหมือนกัน
  const r5 = await runQueue(mod, { jobs: [coverJob('q_cover1', 7), coverJob('q_cover2', 6), newsJob('q_news01', 5), newsJob('q_news02', 4)] },
    { env: { ...C3, QUEUE_COVER_ON_VERCEL: '1' }, platform: 'linux', limit: 3 });
  assert.deepEqual(ids(r5.claimed), ['q_cover1', 'q_news01', 'q_news02']);
  const r6 = await runQueue(mod, { jobs: [running(coverJob('q_cvrun1', 9)), coverJob('q_cover1', 7), newsJob('q_news01', 5)] },
    { env: { ...C3, QUEUE_COVER_ON_VERCEL: '1' }, platform: 'linux', limit: 1 });
  assert.deepEqual(ids(r6.claimed), ['q_news01'], 'Vercel ที่มีปกวิ่งอยู่ → ไม่หยิบปกเพิ่ม หยิบข่าวแทน');
}

test('B6 เครื่องทีม: win32 ไม่มี QUEUE_LOCAL_NEWS → ข่าวไม่ถูกหยิบเหมือนเดิม + เพดานคง 1 · QUEUE_LOCAL_NEWS=1/QUEUE_COVER_ON_VERCEL=1 → ข่าวขนานได้ ปก/คลิปคงทีละ 1', async () => {
  await checkTeamMachine(queueMod);
  await checkTeamCap(queueMod);
});

async function checkEnvPerCall(mod) {
  const world = makeWorld({ jobs: newsBatch(6) });
  const st = freshState(world);
  const a = await callQueue(mod, { env: { QUEUE_NEWS_CONCURRENCY: '2' }, limit: 5 });
  assert.deepEqual(ids(a.value), ['q_news01', 'q_news02']);
  const b = await callQueue(mod, { env: { QUEUE_NEWS_CONCURRENCY: '4' }, limit: 5 });
  assert.deepEqual(ids(b.value), ['q_news03', 'q_news04'], 'ยกเพดานเป็น 4 → หยิบเพิ่มอีก 2 ทันที (ไม่ต้องโหลดโมดูลใหม่)');
  const c = await callQueue(mod, { env: {}, limit: 5 });
  assert.deepEqual(c.value, []);
  assert.ok(c.lines.includes('log:[QueueService] ⏸️ Concurrency limit (เครื่องนี้) 4/1 — งานเครื่องอื่นไม่นับ'), 'ลบ env = กลับเป็น 1 ทันที');
  assert.deepEqual(st.concCalls, [2, 4], 'อ่านตัวช่วยเฉพาะรอบที่ตั้ง env');
}

test('B7 อ่าน env ทุกครั้งที่เรียก (ไม่ cache) — เปลี่ยนค่ากลางทาง/ลบทิ้งมีผลรอบถัดไปทันที', async () => {
  await checkEnvPerCall(queueMod);
});

test('B8 worker route ไม่เปลี่ยน: ยังขอ getNextPendingJobs(1) ครั้งเดียวต่อ invocation · ไม่มีสตริง /api/queue/worker ในโค้ด (ไม่มี self-fetch worker→worker)', () => {
  assert.equal(SRC.worker.split('const jobs = await getNextPendingJobs(1);').length - 1, 1);
  assert.equal((SRC.worker.match(/getNextPendingJobs\(/g) || []).length, 1, 'เรียก getNextPendingJobs ที่เดียว (บรรทัด import ไม่มีวงเล็บ)');
  const ast = parse(SRC.worker, { sourceType: 'module' });
  const literals = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'StringLiteral') literals.push(node.value);
    if (node.type === 'TemplateElement') literals.push(node.value.cooked ?? node.value.raw);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'comments' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value);
    }
  };
  walk(ast.program);
  assert.ok(literals.some((s) => s.includes('/api/auto/process')), 'ตัวตรวจเห็นสตริงในโค้ดจริง (ควบคุม)');
  assert.ok(!literals.some((s) => s.includes('/api/queue/worker')), 'worker ห้ามยิง /api/queue/worker หาตัวเอง');
});

// ============================================================
// C. GET /api/queue/status ตัวจริง — self-heal
// ============================================================
function statusRequest() {
  const url = 'http://api.test/api/queue/status';
  return Object.assign(new Request(url), { nextUrl: new URL(url) });
}
const WORKER_POST = Object.freeze(['http://api.test/api/queue/worker', 'POST']);

/**
 * GET หนึ่งครั้ง (ไม่ส่ง id = ภาพรวมคิว) ด้วยนาฬิกา Date.now ฉีด + fetch ปลอม (จดการปลุก worker) + overview ปลอม
 * self-heal เป็น fire-and-forget (.then) → flush ให้วิ่งจบก่อนคืน env/fetch/นาฬิกา
 */
async function routeGet(route, { env = {}, overview = { pending: 0, processing: 0 }, at = NOW } = {}) {
  const calls = { overview: 0, cleanup: 0, fetch: [] };
  const ov = { ...overview, total: overview.pending + overview.processing, busy: overview.processing > 0, estimatedWaitMinutes: (overview.pending + overview.processing) * 3 };
  const st = freshState(makeWorld({}), {
    getQueueOverview: async () => { calls.overview += 1; return clone(ov); },
    cleanupStaleJobs: async () => { calls.cleanup += 1; return 0; },
  });
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  globalThis.fetch = async (url, init) => { calls.fetch.push([String(url), init?.method ?? 'GET']); return new Response('{"success":true}'); };
  Date.now = () => at;
  try {
    const { status, body } = await settleWithin(withEnv(env, async () => {
      const res = await route.GET(statusRequest());
      for (let i = 0; i < 5; i += 1) await flush();
      return { status: res.status, body: await res.json() };
    }), 'GET /api/queue/status', 5_000);
    return { status, body, ...calls, logs: [...st.routeLogs], concCalls: [...st.concCalls] };
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
}
const loadRoute = (src = SRC.status, name = 'status') => importSource(src, tag(name)); // โมดูลใหม่ = สถานะ throttle ใหม่

async function checkRouteWake(load) {
  const r = await routeGet(await load(), { env: C3, overview: { pending: 2, processing: 1 } });
  assert.deepEqual(r.fetch, [WORKER_POST], '=3 · processing 1 < 3 → ปลุก worker');
  assert.ok(r.logs.includes('QUEUE_STATUS:info:[Queue Status] 🚑 Self-heal: 2 pending · วิ่งอยู่ 1/3 งาน — ปลุก worker หยิบงานเพิ่ม'), r.logs.join('\n'));
  assert.equal(r.overview, 2, 'self-heal อ่าน overview 1 ครั้ง + คำตอบ 1 ครั้ง');
  assert.deepEqual([r.status, r.body.success, r.body.pending, r.body.processing], [200, true, 2, 1], 'คำตอบภาพรวมคิวเดิม');
  const grid = [
    [C3, 2, 0, true], [C3, 2, 2, true], [C3, 1, 3, false], [C3, 5, 4, false], [C3, 0, 1, false], [C3, 0, 0, false],
    [{ QUEUE_NEWS_CONCURRENCY: '99' }, 3, 9, true], [{ QUEUE_NEWS_CONCURRENCY: '99' }, 3, 10, false],
  ];
  for (const [env, pending, processing, wake] of grid) {
    const x = await routeGet(await load(), { env, overview: { pending, processing } });
    assert.deepEqual(x.fetch, wake ? [WORKER_POST] : [], `${JSON.stringify(env)} pending ${pending} processing ${processing} → ${wake ? 'ปลุก' : 'ไม่ปลุก'}`);
    if (!wake) assert.ok(!x.logs.some((l) => l.includes('Self-heal')), 'ไม่ปลุก = ไม่มี log self-heal');
  }
  const idle = await routeGet(await load(), { env: C3, overview: { pending: 2, processing: 0 } });
  assert.ok(idle.logs.includes('QUEUE_STATUS:info:[Queue Status] 🚑 Self-heal: 2 pending แต่ไม่มี worker วิ่ง — ปลุก worker'), 'ไม่มีงานวิ่ง = ข้อความเดิม');
}

test('C1 /api/queue/status self-heal: =3 → processing 1 < 3 ปลุก · 3 ไม่ปลุก · =99 เพดาน 10 · log บอกจำนวนที่วิ่ง/เพดาน (ไม่มีงานวิ่ง = ข้อความเดิม)', async () => {
  await checkRouteWake(() => loadRoute());
  // ไฟล์จริง (โมดูลเดียวตลอด) — เว้นนาฬิกา > 20 วิทุกครั้งให้พ้น throttle
  let at = NOW;
  const real = async (env, pending, processing) => routeGet(statusRoute, { env, overview: { pending, processing }, at: (at += 61 * SEC) });
  assert.deepEqual((await real(C3, 2, 1)).fetch, [WORKER_POST]);
  assert.deepEqual((await real(C3, 2, 3)).fetch, []);
  assert.deepEqual((await real({}, 2, 1)).fetch, [], 'ไฟล์จริง ไม่ตั้ง env = เดิม (มีงานวิ่ง = ไม่ปลุก)');
  assert.deepEqual((await real({}, 2, 0)).fetch, [WORKER_POST]);
});

async function checkRouteParity(loadCurrent, loadLegacy) {
  for (const [label, env] of PARITY_ENVS) {
    for (const pending of [0, 1, 3]) {
      for (const processing of [0, 1, 2, 5]) {
        const a = await routeGet(await loadCurrent(), { env, overview: { pending, processing } });
        const b = await routeGet(await loadLegacy(), { env, overview: { pending, processing } });
        const where = `${label} · pending ${pending} · processing ${processing}`;
        assert.deepEqual([a.status, a.body, a.fetch, a.logs, a.overview, a.cleanup], [b.status, b.body, b.fetch, b.logs, b.overview, b.cleanup], `${where}: เท่าซอร์สที่ถอด W6`);
        assert.deepEqual(a.fetch, pending > 0 && processing === 0 ? [WORKER_POST] : [], `${where}: เงื่อนไขเดิม processing === 0`);
      }
    }
  }
}

/** เส้นเวลา throttle 20 วิ: t0 ปลุก · +10s/+20s พอดี ไม่ปลุก (ไม่อ่าน overview ซ้ำ) · +20.001s ปลุก · +30s ไม่ · +41s ปลุก */
async function throttleTimeline(route, env, overview) {
  const out = [];
  for (const dt of [0, 10 * SEC, 20 * SEC, 20 * SEC + 1, 30 * SEC, 41 * SEC]) {
    const r = await routeGet(route, { env, overview, at: NOW + dt });
    out.push([r.fetch.length, r.overview]);
  }
  return out;
}
const THROTTLE_WANT = [[1, 2], [0, 1], [0, 1], [1, 2], [0, 1], [1, 2]];

async function checkRouteThrottle(load) {
  assert.deepEqual(await throttleTimeline(await load(), C3, { pending: 2, processing: 1 }), THROTTLE_WANT, '=3 · throttle 20 วิเดิม');
}

test('C2 /api/queue/status ไม่ตั้ง env/ค่าที่ได้ 1: คำตอบ/การปลุก/log/การอ่าน overview เท่าซอร์สที่ถอด W6 ทุกไบต์ (ตาราง pending × processing) · throttle 20 วิเดิม', async () => {
  const legacySrc = stripRouteW6(SRC.status);
  await checkRouteParity(() => loadRoute(), () => loadRoute(legacySrc, 'status-legacy'));
  await checkRouteThrottle(() => loadRoute());
  const legacyTimeline = await throttleTimeline(await loadRoute(legacySrc, 'status-legacy'), {}, { pending: 2, processing: 0 });
  const currentTimeline = await throttleTimeline(await loadRoute(), {}, { pending: 2, processing: 0 });
  assert.deepEqual(currentTimeline, legacyTimeline, 'ไม่ตั้ง env: เส้นเวลา throttle เท่าเดิม');
  assert.deepEqual(currentTimeline, THROTTLE_WANT);
});

// ============================================================
// D. เอกสาร + ทะเบียนเทส
// ============================================================
test('D เอกสาร/ทะเบียน: .env.example [Vercel] QUEUE_NEWS_CONCURRENCY (คอมเมนต์) · คู่มือ ตาราง env/วิธีถอย/ส่วน 16/ตารางไฟล์ · news-suite', () => {
  assert.match(SRC.env, /^# \[Vercel\] ท่อข่าวขนาน:[^\n]*\n(?:#[^\n]*\n)*# QUEUE_NEWS_CONCURRENCY=8$/mu);
  const block = SRC.env.slice(SRC.env.indexOf('# [Vercel] ท่อข่าวขนาน:'));
  assert.ok(block.includes('ไม่ตั้ง/ว่าง/อ่านไม่ได้/< 1 = 1') && block.includes('เพดาน 10'), 'บอกค่าเริ่มต้น + เพดาน');
  assert.ok(!/^\s*QUEUE_NEWS_CONCURRENCY\s*=/m.test(SRC.env), 'ตัวอย่างต้องเป็นคอมเมนต์ (ไม่เปิดเอง)');
  const lines = SRC.doc.split('\n');
  assert.ok(lines.some((l) => l.startsWith('| `QUEUE_NEWS_CONCURRENCY` | Vercel | 1 ')), 'ตาราง env');
  assert.ok(lines.some((l) => l.startsWith('| กลับไปเขียนข่าวทีละงาน') && l.includes('`QUEUE_NEWS_CONCURRENCY=1` → Redeploy')), 'วิธีถอย');
  assert.ok(SRC.doc.includes('- **ท่อข่าวขนาน (W6 · SPEC-v3 ส่วน 11'), 'ส่วน 16');
  assert.ok(lines.some((l) => l.includes('`tests/queue-parallel.test.mjs`') && l.includes('| W6 |')), 'ตารางไฟล์');
  assert.ok(JSON.parse(SRC.suite).include.includes('tests/queue-parallel.test.mjs'), 'ลงทะเบียนใน tests/news-suite.json');
});

// ============================================================
// E. mutation — ข้อสอบต้องแดงทุกแบบ (ของจริงเขียวในข้อด้านบน)
// ============================================================
const queueMutant = (edits, label) => {
  let src = SRC.queue;
  for (const [from, to] of edits) src = replaceOnce(src, from, to, label);
  return loadQueueCopy(src, `queue-${label}`);
};
const concMutant = (from, to, label) => importSource(replaceOnce(SRC.conc, from, to, label), tag(`conc-${label}`));
const routeMutantLoader = (from, to, label) => {
  const src = replaceOnce(SRC.status, from, to, label);
  return () => loadRoute(src, `status-${label}`);
};

/**
 * กลายพันธุ์ต้องแดงด้วย assertion ของข้อสอบ "ตามเหตุที่ตั้งใจ" (ข้อความตรง re) — ไม่ใช่ error อื่น (โหลดโมดูลพัง/TypeError)
 * พิมพ์บรรทัดแรกของข้อความไว้ใน diagnostic ให้ผู้ตรวจเห็นว่าแดงเพราะอะไร
 */
async function mustBite(t, promise, re) {
  let caught = null;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'กลายพันธุ์แล้วข้อสอบยังเขียว = ข้อสอบไม่กัด');
  assert.ok(caught instanceof assert.AssertionError, `ต้องแดงด้วย assertion ของข้อสอบ (ได้ ${caught?.name}: ${caught?.message})`);
  assert.match(caught.message, re);
  t.diagnostic(String(caught.message).split('\n')[0].slice(0, 180));
}

test('E. mutation 13 แบบ — ข้อสอบต้องแดงทุกแบบ (ด้วย assertion ตามเหตุที่ตั้งใจ)', async (t) => {
  await t.test('M1 queueService: เพดานคงที่ 1 (ไม่อ่าน env) → ตั้ง =3 แล้วยังทีละข่าว', async (tt) => {
    await mustBite(tt, checkParallelPick(await queueMutant([['      ? getNewsConcurrency(process.env)\n', '      ? 1\n']], 'M1')),
      /=3 \+ ไม่มีงานวิ่ง → หยิบ 3 งานเก่าสุด/u);
  });
  await t.test('M2 queueService: เรียกตัวช่วยแม้ไม่ตั้ง env → ไม่ใช่ "เดิมทุกไบต์"', async (tt) => {
    const legacy = await loadQueueCopy(stripQueueW6(SRC.queue), 'queue-legacy-M2');
    await mustBite(tt, checkUnsetParity(await queueMutant([['process.env.QUEUE_NEWS_CONCURRENCY !== undefined && ', '']], 'M2'), legacy),
      /ไม่ตั้ง · Vercel \(linux\) · โลก #0 · limit 1: ไม่ตั้ง env\/เครื่องหยิบข่าวไม่ได้ = ไม่เรียกตัวช่วย/u);
  });
  await t.test('M3 queueService: ใช้เพดานข่าวกับทุกเครื่อง (ไม่ดูว่าเครื่องหยิบข่าวได้ไหม) → เครื่องทีมอ่านเพดานข่าว', async (tt) => {
    await mustBite(tt, checkTeamMachine(await queueMutant([[' && (!isLocalMachine || localNewsOverride))', ')']], 'M3')),
      /เครื่องที่หยิบข่าวไม่ได้ ไม่อ่านเพดานข่าว/u);
  });
  await t.test('M4 queueService: ไม่มีเพดานงานเครื่องทีม → ปก/คลิปวิ่งซ้อนเกิน 1', async (tt) => {
    await mustBite(tt, checkTeamCap(await queueMutant([['(!_teamCapOn || isNewsJob(j) || j === _teamNext)', 'true']], 'M4')),
      /ปก 1 \+ ข่าว 2 = 3 · ปกงานที่สองไม่ถูกหยิบ/u);
  });
  await t.test('M5 queueService: เครื่องทีมว่างแล้วหยิบปก/คลิปได้หลายงานในรอบเดียว (ไม่จำกัดงานเก่าสุดงานเดียว)', async (tt) => {
    await mustBite(tt, checkTeamCap(await queueMutant([['|| j === _teamNext)', '|| _teamNext !== null)']], 'M5')),
      /ปก\/คลิปทีละ 1 · ข่าวเติมช่อง/u);
  });
  await t.test('M6 queueService: availableSlots ไม่หัก processingHere → วิ่งเกินเพดาน', async (tt) => {
    await mustBite(tt, checkProcessingHere(await queueMutant([['Math.min(limit, maxConcurrency - processingHere)', 'Math.min(limit, maxConcurrency)']], 'M6')),
      /processing 2 → ว่าง 1 ช่อง → หยิบ 1/u);
  });
  await t.test('M7 queueService: จำค่าเพดานครั้งแรกไว้ (cache) → เปลี่ยน env ไม่มีผลจน redeploy', async (tt) => {
    await mustBite(tt, checkEnvPerCall(await queueMutant([
      ["const QUEUE_STORE = 'job_queue';", "const QUEUE_STORE = 'job_queue';\nlet __w6MaxCache;"],
      ['      ? getNewsConcurrency(process.env)\n', '      ? (__w6MaxCache ??= getNewsConcurrency(process.env))\n'],
    ], 'M7')), /ยกเพดานเป็น 4 → หยิบเพิ่มอีก 2 ทันที/u);
  });
  await t.test('M8 queueConcurrency: ไม่มีเพดาน 10 → ค่าพิมพ์ผิด (99) เปิดงานพร้อมกันไม่จำกัด', async (tt) => {
    await mustBite(tt, checkHelper(await concMutant('return Math.min(QUEUE_NEWS_CONCURRENCY_MAX, n);', 'return n;', 'M8')),
      /เกินเพดาน: "11" → 10/u);
  });
  await t.test('M9 queueConcurrency: ไม่บีบค่าต่ำกว่า 1 → 0/-1 ทำให้คิวหยุดหยิบงานทั้งหมด', async (tt) => {
    await mustBite(tt, checkHelper(await concMutant('if (!Number.isFinite(n) || n < 1) return QUEUE_NEWS_CONCURRENCY_DEFAULT;', 'if (!Number.isFinite(n)) return QUEUE_NEWS_CONCURRENCY_DEFAULT;', 'M9')),
      /ศูนย์: "0" → 1/u);
  });
  await t.test('M10 queue/status: คงเงื่อนไข processing === 0 → มีข่าววิ่ง 1 งานแล้วไม่ปลุกหยิบงานเพิ่ม', async (tt) => {
    await mustBite(tt, checkRouteWake(routeMutantLoader('ov.processing < newsMax) {', 'ov.processing === 0) {', 'M10')),
      /=3 · processing 1 < 3 → ปลุก worker/u);
  });
  await t.test('M11 queue/status: ใช้ <= → เต็มเพดานแล้วยังปลุก', async (tt) => {
    await mustBite(tt, checkRouteWake(routeMutantLoader('ov.processing < newsMax) {', 'ov.processing <= newsMax) {', 'M11')),
      /pending 1 processing 3 → ไม่ปลุก/u);
  });
  await t.test('M12 queue/status: ถอด throttle 20 วิ → ปลุกทุก poll (3 วิ)', async (tt) => {
    await mustBite(tt, checkRouteThrottle(routeMutantLoader('if (now - _lastReviveAt > 20_000) {', 'if (true) {', 'M12')),
      /=3 · throttle 20 วิเดิม/u);
  });
  await t.test('M13 queue/status: เพดานตายตัว 8 (ไม่ใช้ตัวช่วย) → ไม่ตั้ง env แล้วพฤติกรรมเปลี่ยน', async (tt) => {
    const legacySrc = stripRouteW6(SRC.status);
    await mustBite(tt, checkRouteParity(routeMutantLoader('const newsMax = getNewsConcurrency(process.env);', 'const newsMax = 8;', 'M13'), () => loadRoute(legacySrc, 'status-legacy-M13')),
      /ไม่ตั้ง · pending 1 · processing 1: เท่าซอร์สที่ถอด W6/u);
  });
});
